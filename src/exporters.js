/**
 * src/exporters.js
 *
 * Deterministic, zero-network training-dataset exporters over Versieve's sanitized outputs.
 *
 * Input (`perceived`) is either
 *   - a `perceive()` / `perceiveMulti()` result (uses `blocks[].maskedText`, never `originalText`), or
 *   - a vaulted `buildAmnesiacCorpus()` result (uses `samples[].content`).
 * Readable-identity corpora carry raw, unmasked text and are REFUSED (fail closed).
 *
 * Emitted schemas (one JSON object per JSONL line):
 *   - llama-factory-sharegpt : { conversations: [{ from: 'system'|'human'|'gpt', value }], metadata }
 *   - llama-factory-alpaca   : { instruction, input, output, metadata }
 *   - unsloth                : { messages: [{ role: 'system'|'user'|'assistant', content }], metadata }
 *   - oumi                   : { messages: [{ role, content }], metadata: { source, entityIds, receiptSha256 } }
 *   - nemo                   : { id, text, filename, source_type, redaction_count, entity_ids, receipt_sha256 }
 *   - document-qa            : { messages: [...], metadata } knowledge-bearing QA over resolved entity records
 *   - ib-ptlm               : { id, maskedText, viewA, viewB, metadata } paired disjoint-surrogate counterfactual views
 *                             (viewA from poolA / viewB from poolB; piiSpans carry label -100; nonPiiSegments[i] is
 *                              the identical non-PII text in both views so a trainer can align causal positions)
 *
 * Every export returns `{ format, jsonl, records, manifest, manifestJson }`. The manifest is the sidecar
 * provenance record: `{ receiptSha256, format, recordCount, zeroEgress: true, ... }`. No timestamps are
 * emitted, so identical inputs yield byte-identical output.
 *
 * Every exported text is (a) scrubbed of hidden-channel Unicode, (b) checked against every known
 * redacted raw value, and (c) re-scanned with the local PII/secret scanners. Any residual hit throws.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { scanRecordsForPII } from './clean-and-tokenize.js';
import { scanEnterprisePiiAndSecrets } from './secret-scanner.js';

export const EXPORTER_ENGINE_VERSION = 'versieve-exporters-v1';
export const EXPORT_MANIFEST_SCHEMA = 'versieve-training-export-v1';
export const DEFAULT_EXPORT_SYSTEM_PROMPT = 'Answer strictly from the provided sanitized context.';

/** Transparent policy semantics shared by `versieve sanitize` and `versieve footprint`. */
export const POLICY_VERDICT_MAP = Object.freeze({
  KEEP: 'allow',
  ABSTAIN: 'redact',
  DROP: 'deny',
});

export const POLICY_VERDICT_SEMANTICS = Object.freeze([
  Object.freeze({
    verdict: 'KEEP',
    policy: 'allow',
    meaning: 'Nothing required masking or stripping; content may be released unchanged.',
  }),
  Object.freeze({
    verdict: 'ABSTAIN',
    policy: 'redact',
    meaning: 'Entities were masked and/or hidden channels stripped; only the redacted form may be released.',
  }),
  Object.freeze({
    verdict: 'DROP',
    policy: 'deny',
    meaning: 'A residual leak or irreversibility failure was found; nothing is released (fail closed).',
  }),
]);

export function mapPolicyVerdict(verdict) {
  const key = String(verdict ?? '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(POLICY_VERDICT_MAP, key)) {
    throw new TypeError(`mapPolicyVerdict: unknown verdict ${JSON.stringify(verdict)} (expected KEEP|ABSTAIN|DROP)`);
  }
  return POLICY_VERDICT_MAP[key];
}

export class ExportError extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`);
    this.name = 'ExportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// Hidden-channel stripping (text level)
// ---------------------------------------------------------------------------

const HTML_COMMENT_RX = /<!--[\s\S]*?-->/g;
const ZERO_WIDTH_RX = /[\u200B-\u200D\u2060\uFEFF\u180E\u00AD]/gu;
const BIDI_RX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const INVISIBLE_MATH_RX = /[\u2061-\u2064]/gu;
const TAG_CHAR_RX = /[\u{E0000}-\u{E007F}]/gu;
const CONTROL_RX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function countAndStrip(text, rx) {
  let n = 0;
  const out = text.replace(rx, () => {
    n += 1;
    return '';
  });
  return [out, n];
}

/**
 * Removes hidden-channel carriers from text: HTML comments, zero-width / soft-hyphen characters,
 * bidi overrides, invisible math operators, Unicode tag characters and C0 control characters.
 * Returns `{ text, counts }`; `counts.total` is the number of stripped items.
 */
export function stripHiddenChannelsFromText(input, options = {}) {
  let text = String(input ?? '');
  const counts = { htmlComments: 0, zeroWidth: 0, bidiControls: 0, invisibleOperators: 0, tagCharacters: 0, controlCharacters: 0 };
  if (options.stripHtmlComments !== false) [text, counts.htmlComments] = countAndStrip(text, HTML_COMMENT_RX);
  [text, counts.zeroWidth] = countAndStrip(text, ZERO_WIDTH_RX);
  [text, counts.bidiControls] = countAndStrip(text, BIDI_RX);
  [text, counts.invisibleOperators] = countAndStrip(text, INVISIBLE_MATH_RX);
  [text, counts.tagCharacters] = countAndStrip(text, TAG_CHAR_RX);
  [text, counts.controlCharacters] = countAndStrip(text, CONTROL_RX);
  counts.invisibleUnicode =
    counts.zeroWidth + counts.bidiControls + counts.invisibleOperators + counts.tagCharacters + counts.controlCharacters;
  counts.total = counts.invisibleUnicode + counts.htmlComments;
  return { text, counts };
}

// ---------------------------------------------------------------------------
// Residual (shadow) audit + numeric integrity (pure, reusable by the CLI)
// ---------------------------------------------------------------------------

const PLACEHOLDER_RX = /<[A-Za-z]+:[A-Za-z0-9_]+>|\[[A-Z][A-Z_]*(?:[:_ ][A-Za-z0-9_:-]*)?\]/g;
const VAULT_TOKEN_EXACT_RX = /^<(?:PII|SECRET):[A-Za-z0-9_]+>$/;
const RESIDUAL_IGNORED_TYPES = new Set(['name_likely']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsRawValue(haystack, rawValue) {
  const needle = String(rawValue ?? '').trim();
  if (needle.length < 3) return false;
  const startsWord = /^[\p{L}\p{N}_]/u.test(needle);
  const endsWord = /[\p{L}\p{N}_]$/u.test(needle);
  const pattern = `${startsWord ? '(?<![\\p{L}\\p{N}_])' : ''}${escapeRegex(needle)}${endsWord ? '(?![\\p{L}\\p{N}_])' : ''}`;
  return new RegExp(pattern, 'iu').test(haystack);
}

/**
 * Post-redaction shadow audit: re-scans sanitized text for (1) any known raw redacted value and
 * (2) any span the local PII / secret scanners still detect. `residualSpans === 0` => PASS.
 */
export function shadowAuditText(sanitizedText, options = {}) {
  const rawText = String(sanitizedText ?? '');
  const text = rawText.replace(PLACEHOLDER_RX, ' ');
  const allow = new Set((options.allowValues || []).map((v) => String(v).toLowerCase()));
  const knownValues = Array.from(
    new Set((options.knownRawValues || []).map((v) => String(v ?? '')).filter((v) => v.trim().length >= 3))
  );
  const residual = [];
  for (const v of knownValues) {
    if (allow.has(v.toLowerCase())) continue;
    if (containsRawValue(text, v)) residual.push({ check: 'known_redacted_value', type: 'redacted_value', length: v.length });
  }
  for (const item of scanRecordsForPII(text)) {
    if (RESIDUAL_IGNORED_TYPES.has(item.type)) continue;
    if (allow.has(String(item.value).toLowerCase())) continue;
    residual.push({ check: 'pii_rescan', type: item.type, length: String(item.value).length });
  }
  const sec = scanEnterprisePiiAndSecrets(text);
  for (const span of sec.spans || []) {
    const val = String(span.value ?? text.slice(span.start, span.end));
    if (VAULT_TOKEN_EXACT_RX.test(val)) continue;
    if (RESIDUAL_IGNORED_TYPES.has(span.type) && span.source === 'regex_stage3a') continue;
    if (allow.has(val.toLowerCase())) continue;
    residual.push({ check: 'secret_rescan', type: span.type, length: val.length });
  }
  return {
    status: residual.length === 0 ? 'PASS' : 'FAIL',
    residualSpans: residual.length,
    residual,
    checks: ['known_redacted_value', 'pii_rescan', 'secret_rescan'],
  };
}

const NUMBER_RX = /\d+(?:[.,]\d+)*/g;

function numberMultiset(text) {
  const m = new Map();
  for (const n of String(text).replace(PLACEHOLDER_RX, ' ').match(NUMBER_RX) || []) {
    m.set(n, (m.get(n) || 0) + 1);
  }
  return m;
}

/**
 * Numeric-integrity check: every number that is NOT part of a redacted span must survive sanitization
 * unchanged. Numbers inside redacted PII spans are ignored. Status is `PASS` or `FLAGGED`.
 */
export function checkNumericIntegrity(originalText, sanitizedText, redactedValues = []) {
  let remaining = String(originalText ?? '');
  const values = Array.from(new Set(redactedValues.map((v) => String(v ?? '')).filter((v) => v.length > 0))).sort(
    (a, b) => b.length - a.length
  );
  for (const v of values) remaining = remaining.split(v).join(' ');
  const before = numberMultiset(remaining);
  const after = numberMultiset(sanitizedText);
  const altered = [];
  let checked = 0;
  for (const [num, count] of before) {
    checked += count;
    const have = after.get(num) || 0;
    if (have < count) altered.push({ value: num, expected: count, found: have });
  }
  altered.sort((a, b) => (a.value < b.value ? -1 : 1));
  return {
    status: altered.length === 0 ? 'PASS' : 'FLAGGED',
    checkedNumbers: checked,
    alteredNumbers: altered.length,
    altered,
  };
}

// ---------------------------------------------------------------------------
// Normalisation of perceive() / amnesiac-corpus results into export records
// ---------------------------------------------------------------------------

function uniq(list) {
  return Array.from(new Set(list));
}

function resolveReceiptSha256(perceived, records) {
  return (
    perceived?.receipt?.receiptSha256 ||
    perceived?.receipt?.corpusSha256 ||
    sha256Hex(records.map((r) => `${r.id}\u0000${r.text}`).join('\u0001'))
  );
}

function normalizePerceived(perceived, options = {}) {
  if (!perceived || typeof perceived !== 'object') {
    throw new TypeError('exporters: expected a perceive() / buildAmnesiacCorpus() result object');
  }
  const records = [];
  const knownRawValues = [];
  const entityLookup = new Map();
  let hiddenStripped = 0;

  if (Array.isArray(perceived.samples) && !Array.isArray(perceived.blocks)) {
    if (perceived.receipt?.identity === 'readable' || perceived.receipt?.compositionPolicy) {
      throw new ExportError(
        'EXPORT_READABLE_IDENTITY_REFUSED',
        'readable / composed amnesiac corpora contain raw unmasked text; build the corpus with the default vaulted identity'
      );
    }
    for (const s of perceived.samples) {
      if (typeof s?.content !== 'string' || s.spans !== undefined || typeof s.system === 'string') {
        throw new ExportError('EXPORT_READABLE_IDENTITY_REFUSED', 'corpus sample is not a vaulted sample');
      }
      const stripped = stripHiddenChannelsFromText(s.content);
      hiddenStripped += stripped.counts.total;
      if (!stripped.text.trim()) continue;
      const entityIds = uniq((s.entities || []).map(String));
      records.push({
        id: String(s.id),
        blockId: String(s.id),
        source: String(s.source || 'document'),
        role: String(s.role || 'PROSE'),
        modality: 'document',
        text: stripped.text,
        entityIds,
        redactionCount: Number.isInteger(s.detectedCount) ? s.detectedCount : entityIds.length,
        sourceRange: Array.isArray(s.sourceRange) ? s.sourceRange.slice() : null,
        entities: [],
      });
    }
    for (const e of perceived.entityIndex || []) {
      entityLookup.set(String(e.entityId), { entityId: String(e.entityId), entityType: String(e.class || 'ENTITY'), token: String(e.token ?? e.entityId) });
    }
  } else if (Array.isArray(perceived.blocks)) {
    for (const blk of perceived.blocks) {
      if (blk?.policyAction === 'deny') continue; // gate DROP => never exported
      const masked = blk?.maskedText;
      if (typeof masked !== 'string') {
        throw new ExportError('EXPORT_UNMASKED_BLOCK', `block ${blk?.blockId ?? '?'} has no maskedText; refusing to export raw text`);
      }
      for (const e of blk.entities || []) {
        if (typeof blk.originalText === 'string' && Number.isInteger(e.start) && Number.isInteger(e.end)) {
          knownRawValues.push(blk.originalText.slice(e.start, e.end));
        }
        if (e.entityId && !entityLookup.has(String(e.entityId))) {
          entityLookup.set(String(e.entityId), {
            entityId: String(e.entityId),
            entityType: String(e.type || 'ENTITY'),
            token: String(e.token ?? e.entityId),
          });
        }
      }
      const stripped = stripHiddenChannelsFromText(masked);
      hiddenStripped += stripped.counts.total;
      if (!stripped.text.trim()) continue;
      const entityIds = uniq((blk.entities || []).map((e) => e.entityId).filter(Boolean).map(String));
      const source = String(blk.source || 'document');
      const blockId = String(blk.blockId ?? `b${records.length + 1}`);
      records.push({
        id: sha256Hex(`${source}\u0000${blockId}\u0000${stripped.text}`).slice(0, 32),
        blockId,
        source,
        role: String(blk.structRole || 'PARAGRAPH'),
        modality: String(blk.modality || 'document'),
        text: stripped.text,
        entityIds,
        redactionCount: (blk.entities || []).length,
        sourceRange: null,
        entities: (blk.entities || []).filter((e) => e.entityId).map((e) => String(e.entityId)),
      });
    }
    for (const rv of perceived.redactedValues || []) knownRawValues.push(rv?.value);
  } else {
    throw new TypeError('exporters: input has neither `blocks` (perceive) nor `samples` (vaulted amnesiac corpus)');
  }

  const result = {
    records,
    knownRawValues: uniq(knownRawValues.map((v) => String(v ?? '')).filter((v) => v.trim().length >= 3)),
    entityLookup,
    receiptSha256: resolveReceiptSha256(perceived, records),
    hiddenStripped,
    allowValues: (options.allowValues || []).map(String),
  };
  assertNoResidual(result.records.map((r) => r.text), result, 'exported record');
  return result;
}

/** Fail-closed leak guard applied to every text that is about to be emitted. */
function assertNoResidual(texts, norm, label) {
  for (let i = 0; i < texts.length; i++) {
    const audit = shadowAuditText(texts[i], { knownRawValues: norm.knownRawValues, allowValues: norm.allowValues });
    if (audit.status !== 'PASS') {
      throw new ExportError(
        'EXPORT_RESIDUAL_PII',
        `${label} #${i + 1} still contains ${audit.residualSpans} residual sensitive span(s) (${uniq(audit.residual.map((r) => r.type)).join(', ')}); refusing to export`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Result assembly
// ---------------------------------------------------------------------------

function buildResult(format, framework, records, norm, extra = {}) {
  const jsonl = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  const entityIds = uniq(records.flatMap((r) => r.metadata?.entityIds || r.metadata?.entityId || r.entity_ids || []));
  const manifest = {
    schema: EXPORT_MANIFEST_SCHEMA,
    engine: EXPORTER_ENGINE_VERSION,
    format,
    framework,
    recordCount: records.length,
    receiptSha256: norm.receiptSha256,
    datasetSha256: sha256Hex(jsonl),
    entityCount: entityIds.length,
    zeroEgress: true,
    rawTextEmitted: false,
    ...extra,
  };
  return { format, jsonl, records, manifest, manifestJson: JSON.stringify(manifest, null, 2) + '\n' };
}

function commonMetadata(rec, norm) {
  return {
    source: rec.source,
    blockId: rec.blockId,
    role: rec.role,
    entityIds: rec.entityIds,
    redactionCount: rec.redactionCount,
    sourceRange: rec.sourceRange,
    receiptSha256: norm.receiptSha256,
  };
}

function promptsFor(rec, options) {
  return {
    system: options.systemPrompt ?? DEFAULT_EXPORT_SYSTEM_PROMPT,
    instruction: options.instruction ?? `Summarize the key record from ${rec.source} (${rec.role}).`,
  };
}

// ---------------------------------------------------------------------------
// Trainer exporters (synchronous, deterministic)
// ---------------------------------------------------------------------------

export function exportLlamaFactoryShareGPT(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  const records = norm.records.map((rec) => {
    const p = promptsFor(rec, options);
    return {
      conversations: [
        { from: 'system', value: p.system },
        { from: 'human', value: p.instruction },
        { from: 'gpt', value: rec.text },
      ],
      metadata: commonMetadata(rec, norm),
    };
  });
  return buildResult('llama-factory-sharegpt', 'LLaMA-Factory', records, norm);
}

export function exportLlamaFactoryAlpaca(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  const records = norm.records.map((rec) => {
    const p = promptsFor(rec, options);
    return { instruction: p.instruction, input: '', output: rec.text, metadata: commonMetadata(rec, norm) };
  });
  return buildResult('llama-factory-alpaca', 'LLaMA-Factory', records, norm);
}

export function exportUnslothJsonl(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  const records = norm.records.map((rec) => {
    const p = promptsFor(rec, options);
    return {
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: p.instruction },
        { role: 'assistant', content: rec.text },
      ],
      metadata: commonMetadata(rec, norm),
    };
  });
  return buildResult('unsloth', 'Unsloth', records, norm);
}

export function exportOumiJsonl(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  const records = norm.records.map((rec) => {
    const p = promptsFor(rec, options);
    return {
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: p.instruction },
        { role: 'assistant', content: rec.text },
      ],
      metadata: { source: rec.source, entityIds: rec.entityIds, receiptSha256: norm.receiptSha256 },
    };
  });
  return buildResult('oumi', 'Oumi', records, norm);
}

export function exportNemoCuratorJsonl(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  const records = norm.records.map((rec) => ({
    id: rec.id,
    text: rec.text,
    filename: path.basename(rec.source),
    source_type: rec.modality,
    redaction_count: rec.redactionCount,
    entity_ids: rec.entityIds,
    receipt_sha256: norm.receiptSha256,
  }));
  return buildResult('nemo', 'NeMo Curator', records, norm);
}

// ---------------------------------------------------------------------------
// Optional local document-grounded QA export adapter
// ---------------------------------------------------------------------------

const EGRESS_PATCH_TARGETS = [
  [globalThis, 'fetch', 'fetch'],
  [http, 'request', 'http.request'],
  [http, 'get', 'http.get'],
  [https, 'request', 'https.request'],
  [https, 'get', 'https.get'],
  [net, 'connect', 'net.connect'],
  [net, 'createConnection', 'net.createConnection'],
];

function isThenable(x) {
  return x !== null && (typeof x === 'object' || typeof x === 'function') && typeof x.then === 'function';
}

/**
 * Runs `fn` while every network entry point throws and records the attempt. Preserves synchronous
 * execution when `fn` returns synchronously, and stays armed across async microtasks if `fn` returns
 * a Promise. Any attempted network call is fatal even if `fn` catches the thrown error.
 */
function withZeroEgressGuard(fn) {
  const violations = [];
  const saved = [];
  const restore = () => {
    for (const [obj, key, original] of saved) obj[key] = original;
  };
  for (const [obj, key, label] of EGRESS_PATCH_TARGETS) {
    if (!obj || typeof obj[key] !== 'function') continue;
    const original = obj[key];
    saved.push([obj, key, original]);
    obj[key] = function blockedEgress() {
      violations.push(label);
      throw new ExportError('ZERO_EGRESS_VIOLATION', `plugged generator attempted network egress via ${label}`);
    };
  }
  let raw;
  try {
    raw = fn();
  } catch (err) {
    restore();
    if (violations.length > 0) {
      throw new ExportError('ZERO_EGRESS_VIOLATION', `plugged generator attempted network egress via ${uniq(violations).join(', ')}`);
    }
    throw err;
  }
  if (isThenable(raw)) {
    return raw.then(
      (val) => {
        restore();
        if (violations.length > 0) {
          throw new ExportError('ZERO_EGRESS_VIOLATION', `plugged generator attempted network egress via ${uniq(violations).join(', ')}`);
        }
        return val;
      },
      (err) => {
        restore();
        if (violations.length > 0) {
          throw new ExportError('ZERO_EGRESS_VIOLATION', `plugged generator attempted network egress via ${uniq(violations).join(', ')}`);
        }
        throw err;
      }
    );
  }
  restore();
  if (violations.length > 0) {
    throw new ExportError('ZERO_EGRESS_VIOLATION', `plugged generator attempted network egress via ${uniq(violations).join(', ')}`);
  }
  return raw;
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

/** Resolved entity records: one per entityId with its cross-block facts and provenance locations. */
export function buildEntityRecords(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  return entityRecordsFromNorm(norm, options);
}

function entityRecordsFromNorm(norm, options = {}) {
  const maxBlocks = options.maxBlocksPerEntity ?? 3;
  const byEntity = new Map();
  for (const rec of norm.records) {
    for (const eid of rec.entityIds) {
      if (!byEntity.has(eid)) byEntity.set(eid, []);
      byEntity.get(eid).push(rec);
    }
  }
  const out = [];
  for (const eid of Array.from(byEntity.keys()).sort()) {
    const recs = byEntity.get(eid);
    const meta = norm.entityLookup.get(eid) || { entityId: eid, entityType: 'ENTITY', token: eid };
    const co = new Map();
    for (const r of recs) {
      for (const other of r.entityIds) {
        if (other === eid) continue;
        const m = norm.entityLookup.get(other) || { entityId: other, entityType: 'ENTITY', token: other };
        co.set(other, m);
      }
    }
    out.push({
      entityId: eid,
      entityType: meta.entityType,
      token: meta.token,
      occurrences: recs.length,
      sources: uniq(recs.map((r) => r.source)).sort(),
      blocks: recs.slice(0, maxBlocks).map((r) => ({
        blockId: r.blockId,
        source: r.source,
        role: r.role,
        text: r.text,
        sourceRange: r.sourceRange,
      })),
      provenance: recs.map((r) => ({ source: r.source, blockId: r.blockId, sourceRange: r.sourceRange })),
      coEntities: Array.from(co.values()).sort((a, b) => (a.entityId < b.entityId ? -1 : 1)),
    });
  }
  return out;
}

function clip(text, max) {
  const t = String(text);
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatLocation(p) {
  return `${p.source} [block ${p.blockId}${p.sourceRange ? `, bytes ${p.sourceRange[0]}-${p.sourceRange[1]}` : ''}]`;
}

/** Deterministic local templates (no model, no network). */
function templateQaPairs(record, options = {}) {
  const maxAnswer = options.maxAnswerChars ?? 1200;
  const label = `${record.token} (${record.entityType})`;
  const pairs = [];
  pairs.push({
    templateId: 'entity-locations',
    question: `Which documents mention ${label} and where?`,
    answer: `${label} appears in ${record.occurrences} block(s) across ${record.sources.length} source(s): ${record.provenance
      .map(formatLocation)
      .join('; ')}.`,
  });
  for (const b of record.blocks) {
    pairs.push({
      templateId: 'block-facts',
      question: `What does ${b.source} (${b.role}, block ${b.blockId}) state about ${label}?`,
      answer: clip(b.text, maxAnswer),
    });
  }
  if (record.occurrences > 1 && record.coEntities.length > 0) {
    pairs.push({
      templateId: 'cross-block-entities',
      question: `Which other entities are recorded alongside ${label} across blocks?`,
      answer: `${label} is recorded together with ${record.coEntities
        .map((c) => `${c.token} (${c.entityType})`)
        .join(', ')}.`,
    });
  }
  return pairs;
}

function validateQaPairs(pairs, entityId) {
  if (!Array.isArray(pairs)) {
    throw new ExportError('DOCUMENT_QA_GENERATOR_INVALID', `generator for ${entityId} must return an array of { question, answer }`);
  }
  return pairs.map((p, i) => {
    const question = p?.question ?? p?.q;
    const answer = p?.answer ?? p?.a;
    if (typeof question !== 'string' || !question.trim() || typeof answer !== 'string' || !answer.trim()) {
      throw new ExportError('DOCUMENT_QA_GENERATOR_INVALID', `generator pair #${i + 1} for ${entityId} needs non-empty string question and answer`);
    }
    return { templateId: typeof p.templateId === 'string' ? p.templateId : 'plugged', question, answer };
  });
}

function appendQaPairs(records, er, pairs, norm, system, isPlugged) {
  const cleanPairs = pairs.map((p) => ({
    templateId: p.templateId,
    question: stripHiddenChannelsFromText(p.question).text,
    answer: stripHiddenChannelsFromText(p.answer).text,
  }));
  assertNoResidual(
    cleanPairs.flatMap((p) => [p.question, p.answer]),
    norm,
    `QA pair for ${er.entityId}`
  );
  for (const p of cleanPairs) {
    records.push({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: p.question },
        { role: 'assistant', content: p.answer },
      ],
      metadata: {
        entityId: er.entityId,
        entityType: er.entityType,
        entityIds: [er.entityId, ...er.coEntities.map((c) => c.entityId)],
        templateId: p.templateId,
        generator: isPlugged ? 'plugged-local' : 'template',
        provenance: er.provenance,
        receiptSha256: norm.receiptSha256,
      },
    });
  }
}

function wrapGeneratorError(err, entityId) {
  if (err instanceof ExportError) return err;
  return new ExportError('DOCUMENT_QA_GENERATOR_FAILED', `local generator failed for ${entityId}: ${err?.message || err}`);
}

/**
 * Document-grounded QA SFT export over resolved entity records.
 * `options.generator(record, ctx) => [{ question, answer }]` (sync or async) is an optional local
 * generator; it runs under a zero-egress guard and the export fails closed if it throws, returns
 * malformed pairs, attempts network egress, or emits any raw/residual sensitive value.
 */
export function exportDocumentGroundedQA(perceived, options = {}) {
  const norm = normalizePerceived(perceived, options);
  const entityRecords = entityRecordsFromNorm(norm, options);
  const generator = options.generator;
  if (generator !== undefined && typeof generator !== 'function') {
    throw new TypeError('exportDocumentGroundedQA: options.generator must be a function (record, ctx) => qaPairs');
  }
  const records = [];
  const system = options.systemPrompt ?? DEFAULT_EXPORT_SYSTEM_PROMPT;
  const finish = () =>
    buildResult('document-qa', 'document-grounded-qa', records, norm, {
      generator: generator ? 'plugged-local' : 'template',
      entityRecordCount: entityRecords.length,
    });

  if (!generator) {
    for (const er of entityRecords) {
      appendQaPairs(records, er, templateQaPairs(er, options), norm, system, false);
    }
    return finish();
  }

  const ctx = deepFreeze({ receiptSha256: norm.receiptSha256, format: 'document-qa', zeroEgress: true });
  const runFrom = (startIdx) => {
    for (let i = startIdx; i < entityRecords.length; i++) {
      const er = entityRecords[i];
      const frozen = deepFreeze(JSON.parse(JSON.stringify(er)));
      let raw;
      try {
        raw = withZeroEgressGuard(() => generator(frozen, ctx));
      } catch (err) {
        throw wrapGeneratorError(err, er.entityId);
      }
      if (isThenable(raw)) {
        return raw.then(
          (resolved) => {
            const pairs = validateQaPairs(resolved, er.entityId);
            appendQaPairs(records, er, pairs, norm, system, true);
            return runFrom(i + 1);
          },
          (err) => {
            throw wrapGeneratorError(err, er.entityId);
          }
        );
      }
      const pairs = validateQaPairs(raw, er.entityId);
      appendQaPairs(records, er, pairs, norm, system, true);
    }
    return finish();
  };

  return runFrom(0);
}

// ---------------------------------------------------------------------------
// IB-PT-LM paired counterfactual surrogate export (verified semantics ported
// byte-compatibly from scripts/run-exploratory-ib-ptlm.py, T12)
// ---------------------------------------------------------------------------

/**
 * Disjoint surrogate pools for the IB-PT-LM counterfactual objective. Must mirror
 * `scripts/run-exploratory-ib-ptlm.py` `SURROGATE_POOLS` (poolA / poolB only): pool A and pool B
 * have ZERO shared values per category, verified by `verifyIbPtlmPoolsDisjoint`, so the two
 * views of the same masked span can never collapse to the same synthetic surface.
 */
export const IB_PTLM_SURROGATE_POOLS = Object.freeze({
  PERSON: Object.freeze({
    poolA: Object.freeze([
      'Dr. Arthur Pendelton', 'Dr. Beatrice Halvorsen', 'Dr. Cedric Montclair', 'Dr. Diana Korhonen',
      'Dr. Edward Bellamy', 'Dr. Fiona MacAllister', 'Dr. Gabriel Okafor', 'Dr. Helena Bergstrom',
      'Dr. Isaac Lindholm', 'Dr. Justine Beaumont', 'Dr. Kenneth Dalrymple', 'Dr. Lydia Vestergaard',
    ]),
    poolB: Object.freeze([
      'Dr. Martin Solberg', 'Dr. Natalie Ravenscroft', 'Dr. Oliver Lindqvist', 'Dr. Patricia Castellano',
      'Dr. Quentin Ashworth', 'Dr. Rebecca Sundqvist', 'Dr. Sebastian Delacroix', 'Dr. Theresa Nystrom',
      'Dr. Ulrich Lindemann', 'Dr. Valerie Kingsford', 'Dr. Wesley Hawthorne', 'Dr. Yvonne Lindberg',
    ]),
  }),
  EMAIL: Object.freeze({
    poolA: Object.freeze(Array.from({ length: 12 }, (_, i) => `liaison.alpha${10 + i}@pool-a-routing.example`)),
    poolB: Object.freeze(Array.from({ length: 12 }, (_, i) => `steward.bravo${50 + i}@pool-b-routing.example`)),
  }),
  PHONE: Object.freeze({
    poolA: Object.freeze(Array.from({ length: 12 }, (_, i) => `303-555-${String(120 + i).padStart(4, '0')}`)),
    poolB: Object.freeze(Array.from({ length: 12 }, (_, i) => `503-555-${String(240 + i).padStart(4, '0')}`)),
  }),
  SSN: Object.freeze({
    poolA: Object.freeze(Array.from({ length: 12 }, (_, i) => `284-31-${String(4100 + i).padStart(4, '0')}`)),
    poolB: Object.freeze(Array.from({ length: 12 }, (_, i) => `395-47-${String(6200 + i).padStart(4, '0')}`)),
  }),
  GENERIC: Object.freeze({
    poolA: Object.freeze(Array.from({ length: 12 }, (_, i) => `Charter Entity ${i + 1}`)),
    poolB: Object.freeze(Array.from({ length: 12 }, (_, i) => `Ledger Counterparty ${i + 1}`)),
  }),
});

export const IB_PTLM_PLACEHOLDER_RX = /(<(?:PII|SECRET):[A-Za-z0-9_]+>)/g;

const IB_PTLM_TAG_RX = /^<(?:PII|SECRET):[A-Za-z0-9_]+>$/;

const IB_PTLM_CATEGORY_KEYS = ['PERSON', 'EMAIL', 'PHONE', 'SSN'];

function ibPtlmCategoryForTag(tag) {
  const inner = tag.replace(/^<|>$/g, '').split(':', 2).pop().toUpperCase();
  for (const cat of IB_PTLM_CATEGORY_KEYS) {
    if (inner.startsWith(cat)) return cat;
  }
  return 'GENERIC';
}

/** SHA-256 based deterministic pool index (mirrors `deterministic_tag_index` in the Python reference). */
function ibPtlmDeterministicIndex(tag, modulus) {
  const digest = crypto.createHash('sha256').update(tag, 'utf8').digest();
  return digest.readUInt32BE(0) % Math.max(1, modulus);
}

function ibPtlmSurrogateForTag(tag, poolKey) {
  const pools = IB_PTLM_SURROGATE_POOLS[ibPtlmCategoryForTag(tag)];
  return pools[poolKey][ibPtlmDeterministicIndex(tag, pools[poolKey].length)];
}

/** Verifies strict poolA/poolB disjointness per category; throws ExportError on any overlap. */
export function verifyIbPtlmPoolsDisjoint() {
  const categories = {};
  let overlapCount = 0;
  let poolACount = 0;
  let poolBCount = 0;
  for (const [category, pools] of Object.entries(IB_PTLM_SURROGATE_POOLS)) {
    const a = new Set(pools.poolA);
    const b = new Set(pools.poolB);
    const ov = pools.poolA.filter((v) => b.has(v)).length;
    overlapCount += ov;
    poolACount += a.size;
    poolBCount += b.size;
    categories[category] = {
      nPoolA: a.size,
      nPoolB: b.size,
      overlapPoolAPoolB: ov,
    };
  }
  if (overlapCount !== 0) {
    throw new ExportError('IB_PTLM_POOL_OVERLAP', `surrogate poolA and poolB overlap in ${overlapCount} value(s); refusing to export`);
  }
  return { categories, poolOverlapCount: overlapCount, poolACount, poolBCount, poolAuditSha256: sha256Hex(JSON.stringify(IB_PTLM_SURROGATE_POOLS)) };
}

/**
 * IB-PT-LM paired counterfactual training export. Each sanitized (masked / vaulted) sample emits
 * TWO records-bearing counterfactual views: viewA draws its per-tag surrogates exclusively from
 * poolA and viewB exclusively from poolB (deterministic SHA-256 index per placeholder tag, so the
 * same tag always resolves to the same surrogate; disjoint pools force `surrogateA != surrogateB`).
 * Both views keep the non-PII text byte-identical with per-view char spans, and every surrogate
 * span carries `label: -100`, so a causal trainer can align exactly the non-PII prediction
 * positions across views (mirrors `encode_aligned_counterfactual_pair`).
 */
export function exportIbPtlmJsonl(perceived, options = {}) {
  const poolAudit = verifyIbPtlmPoolsDisjoint();
  const norm = normalizePerceived(perceived, options);
  const records = norm.records.map((rec) => {
    const segments = rec.text
      .split(IB_PTLM_PLACEHOLDER_RX)
      .map((chunk) => ({ isTag: IB_PTLM_TAG_RX.test(chunk), chunk }))
      .filter((seg) => seg.chunk.length > 0);
    const buildView = (poolKey) => {
      const view = { pool: poolKey, text: '', piiSpans: [], nonPiiSegments: [] };
      let cursor = 0;
      for (const seg of segments) {
        if (seg.isTag) {
          const surrogate = ibPtlmSurrogateForTag(seg.chunk, poolKey);
          // Disjoint pools guarantee surrogateA != surrogateB for the same tag; assert once here.
          const otherPool = IB_PTLM_SURROGATE_POOLS[ibPtlmCategoryForTag(seg.chunk)][poolKey === 'poolA' ? 'poolB' : 'poolA'];
          if (otherPool.includes(surrogate)) {
            throw new ExportError('IB_PTLM_POOL_OVERLAP', `surrogate for tag ${seg.chunk} leaked across pools`);
          }
          const start = cursor;
          view.text += surrogate;
          cursor += surrogate.length;
          view.piiSpans.push({ start, end: cursor, tag: seg.chunk, category: ibPtlmCategoryForTag(seg.chunk), surrogate, label: -100 });
        } else {
          const start = cursor;
          view.text += seg.chunk;
          cursor += seg.chunk.length;
          // Segment index is the alignment key: nonPiiSegments[i] holds the identical non-PII
          // text in both views, so a trainer can pair up causal prediction positions.
          view.nonPiiSegments.push({ index: view.nonPiiSegments.length, text: seg.chunk, start, end: cursor });
        }
      }
      return view;
    };
    const viewA = buildView('poolA');
    const viewB = buildView('poolB');
    assertIbPtlmViewNoResidual(viewA, viewB, norm, `block ${rec.blockId ?? rec.id}`);
    return {
      id: rec.id,
      maskedText: rec.text,
      viewA,
      viewB,
      metadata: {
        ...commonMetadata(rec, norm),
        surrogateChoice: 'sha256-deterministic-per-tag',
        surrogateViewAlignment: 'nonPiiSegments[i] is the identical text in both views',
      },
    };
  });
  return buildResult('ib-ptlm', 'IB-PT-LM', records, norm, { ibPtlm: poolAudit });
}

/**
 * Fail-closed leak guard for IB-PT-LM views. Unlike the other exporters, this format intentionally
 * emits realistic-looking synthetic personal names / emails / numbers, so a blind re-scan would flag
 * every synthetic surrogate. Instead: (1) any known raw redacted value in the emitted text is an
 * unconditional leak, and (2) the scanners re-run on the text with surrogate spans hidden behind
 * `PII:SURROGATE` tags (`PLACEHOLDER_RX` strips those, so only non-PII text is scanned).
 */
function assertIbPtlmViewNoResidual(viewA, viewB, norm, label) {
  for (const view of [viewA, viewB]) {
    for (const v of norm.knownRawValues) {
      if (containsRawValueStripPlaceholders(view.text, v)) {
        throw new ExportError('EXPORT_RESIDUAL_PII', `IB-PT-LM ${label} view leaks raw redacted value; refusing to export`);
      }
    }
    const hidden = hideSurrogateSpans(view);
    assertNoResidual([hidden], norm, `IB-PT-LM view (${label})`);
  }
}

// The `containsRawValue` check is mirrored with placeholder stripping (same as `shadowAuditText`).
function containsRawValueStripPlaceholders(haystack, rawValue) {
  return containsRawValue(String(haystack ?? '').replace(PLACEHOLDER_RX, ' '), rawValue);
}

function hideSurrogateSpans(view) {
  if (view.piiSpans.length === 0) return view.text;
  let out = '';
  let cursor = 0;
  for (const span of view.piiSpans) {
    out += view.text.slice(cursor, span.start) + '<PII:SURROGATE>';
    cursor = span.end;
  }
  out += view.text.slice(cursor);
  return out;
}

export const TRAINING_EXPORT_FORMATS = Object.freeze([
  'llama-factory-sharegpt',
  'llama-factory-alpaca',
  'unsloth',
  'oumi',
  'nemo',
  'document-qa',
  'ib-ptlm',
]);

const FORMAT_ALIASES = Object.freeze({
  sharegpt: 'llama-factory-sharegpt',
  alpaca: 'llama-factory-alpaca',
  'nemo-curator': 'nemo',
  qa: 'document-qa',
  ib_ptlm: 'ib-ptlm',
});

export function resolveTrainingFormat(format) {
  const key = String(format ?? '').toLowerCase();
  const resolved = FORMAT_ALIASES[key] || key;
  if (!TRAINING_EXPORT_FORMATS.includes(resolved)) {
    throw new TypeError(
      `exportTrainingDataset: unsupported format ${JSON.stringify(format)}; expected one of ${TRAINING_EXPORT_FORMATS.join(', ')}`
    );
  }
  return resolved;
}

export function exportTrainingDataset(perceived, options = {}) {
  const { format, ...rest } = options;
  switch (resolveTrainingFormat(format)) {
    case 'llama-factory-sharegpt':
      return exportLlamaFactoryShareGPT(perceived, rest);
    case 'llama-factory-alpaca':
      return exportLlamaFactoryAlpaca(perceived, rest);
    case 'unsloth':
      return exportUnslothJsonl(perceived, rest);
    case 'oumi':
      return exportOumiJsonl(perceived, rest);
    case 'nemo':
      return exportNemoCuratorJsonl(perceived, rest);
    case 'ib-ptlm':
      return exportIbPtlmJsonl(perceived, rest);
    default:
      return exportDocumentGroundedQA(perceived, rest);
  }
}

/** Writes `<jsonlPath>` and the sidecar provenance manifest `<jsonlPath>.manifest.json` (local FS only). */
export function writeTrainingDataset(result, jsonlPath) {
  const out = path.resolve(jsonlPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.jsonl);
  const manifestPath = `${out}.manifest.json`;
  fs.writeFileSync(manifestPath, result.manifestJson);
  return { jsonlPath: out, manifestPath };
}
