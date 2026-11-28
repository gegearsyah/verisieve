/**
 * src/amnesiac-corpus.js
 * Amnesiac Corpus core — one new seam at the perceiveMulti() level (spec: gegearsyah/versieve#25).
 *
 * buildAmnesiacCorpus(inputs, view) → deterministic entity-indexed SFT JSONL: every sample
 *   records its source byte-ranges + entity IDs, carries a gatekeeper certificate, and the
 *   corpus carries SHA-256 receipts pinning the engine version hash. `view.identity`
 *   ('vaulted' = default, unchanged; 'readable' = explicit opt-in general mode: unmasked
 *   content, canonical readable entity anchors, no certificate ceremony) is part of the view.
 *   `view.composition` ('per-block' = default, unchanged; 'composed' = readable-only relational
 *   composition: ONE sample per resolved entity rendering its cross-document evidence blocks,
 *   under canonicalized versioned policies receipted as `compositionPolicy`).
 * eraseEntity(state, entityId) → regenerated corpus whose byte-diff vs the original is
 *   exactly the erased entity's spans, proven by a diff receipt that fails loudly
 *   instead of emitting a subtly-wrong corpus.
 *
 * The corpus is a pure function of (inputs, view, engine version): no timestamps, no
 * unseeded randomness, fixed JSON key order, content-digest sample IDs and ordering.
 * Zero egress: the corpus path performs no network I/O.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { perceiveMulti, computeEgoGraphTelemetry } from './perceive.js';
export { computeEgoGraphTelemetry };
import { scanEnterprisePiiAndSecrets } from './secret-scanner.js';
import { binomCdf } from './gatekeeper.js';
import { agglomerateThemeNodes, THEME_POLICY_VERSION } from './weft-theme-linker.js';
export { THEME_POLICY_VERSION };

export const AMNESIAC_ENGINE_VERSION = 'versieve-amnesiac-corpus-v1';
// The theme policy version (W6) enters the engine hash: one bump for every corpus, so an
// erasure drift check can never mix theme policy versions.
export const AMNESIAC_ENGINE_VERSION_SHA256 = crypto
  .createHash('sha256')
  .update(AMNESIAC_ENGINE_VERSION + '+' + THEME_POLICY_VERSION)
  .digest('hex');

// Deterministic seeded LoRA retrain recipe shipped with every export — the retrain half of the Art. 17 claim.
export const AMNESIAC_TRAINING_RECIPE = Object.freeze({
  family: 'lora',
  seed: 42,
  placeholderMasking: 'labels[-100] on <PII:...>/<SECRET:...> spans (PT-LM)',
  hyperparameters: Object.freeze({ r: 16, alpha: 32, lr: 2e-4, steps: 80, batch: '2x4 grad-accum', maxLen: 768 }),
});

const SYSTEM_PROMPT = 'Answer strictly from the provided sanitized context.';
// Readable (general) mode: the user's own data, their own model — no sanitizer framing.
const READABLE_SYSTEM_PROMPT = 'Answer strictly from the provided context.';

// Stage K1 composition policies — canonicalized versioned pure functions (adversarial finding 6:
// selection, ordering and caps are policies, not facts). The policy version — not the engine
// version — invalidates composed receipts: the default per-block path's bytes are unchanged.
const COMPOSITION_POLICY = 'composed-v1';
const COMPOSED_BLOCK_CAP = 8;

// Canonical block order: source name lexicographically, then source byte offset ascending;
// derived-format blocks (no byte range) after byte-ranged ones (same name order, then block id).
const composedBlockOrder = (a, b) => {
  if ((a.sourceRange == null) !== (b.sourceRange == null)) return a.sourceRange == null ? 1 : -1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.sourceRange && b.sourceRange) {
    if (a.sourceRange[0] !== b.sourceRange[0]) return a.sourceRange[0] - b.sourceRange[0];
    if (a.sourceRange[1] !== b.sourceRange[1]) return a.sourceRange[1] - b.sourceRange[1];
  }
  return a.id < b.id ? -1 : 1;
};

// Render one composed sample body from its contributing blocks: every block as its own segment
// prefixed with the labeled source tag, block-local entity spans mapped into render coordinates.
function renderComposedBlocks(blocks) {
  let content = '';
  const spans = {};
  for (const b of blocks) {
    if (content) content += '\n';
    const base = content.length + `[${b.source}] `.length;
    content += `[${b.source}] ${b.content}`;
    for (const [eid, blockSpans] of Object.entries(b.spans || {})) {
      for (const [s0, e0] of blockSpans) (spans[eid] ||= []).push([base + s0, base + e0]);
    }
  }
  for (const eid of Object.keys(spans)) spans[eid].sort((x, y) => x[0] - y[0]);
  return { content, spans };
}

// Composed sample lines: per-sample multi-source provenance + the composed entity (sampleLine
// for per-block samples is untouched).
function composedSampleLine(s) {
  return {
    id: s.id,
    target: s.target,
    sources: s.sources,
    entities: s.entities,
    messages: [
      { role: 'system', content: READABLE_SYSTEM_PROMPT },
      { role: 'user', content: `Summarize everything the estate records about ${s.canonical}.` },
      { role: 'assistant', content: s.content },
    ],
  };
}

// Relational sample composition (readable identity): for each resolved entity, ONE composed
// SFT sample rendering its evidence blocks in canonical order under the v1 hub cap. Returns
// the composed samples plus the composed entity index (each entity re-pointed at its sample).
function composeReadableSamples(samples, perBlockIndex) {
  const blocksOf = new Map();
  for (const s of samples) {
    for (const eid of s.entities) {
      let list = blocksOf.get(eid);
      if (!list) blocksOf.set(eid, (list = []));
      list.push(s);
    }
  }
  const composed = [];
  for (const meta of perBlockIndex) {
    const all = (blocksOf.get(meta.entityId) || []).slice().sort(composedBlockOrder);
    const rendered = all.slice(0, COMPOSED_BLOCK_CAP);
    const blockRecs = rendered.map((b) => ({
      id: b.id,
      source: b.source,
      sourceRange: b.sourceRange,
      content: b.content,
      spans: b.spans || {},
      blockId: b.blockId ?? null,
    }));
    const { content, spans } = renderComposedBlocks(blockRecs);
    const entities = [];
    for (const b of rendered) {
      for (const eid of b.entities) if (!entities.includes(eid)) entities.push(eid);
    }
    // Internal-only bookkeeping: blocks + render-coordinate spans (erasure input), the
    // canonical value (user message), and the hub-cap truncation count. Never serialized.
    composed.push({
      id: sha256Hex(`composed\u0000${meta.entityId}\u0000${sha256Hex(content)}`),
      target: meta.entityId,
      canonical: meta.token,
      entities,
      content,
      spans,
      blocks: blockRecs,
      truncatedBlocks: Math.max(0, all.length - COMPOSED_BLOCK_CAP),
      sources: rendered.map((b) => ({ source: b.source, sourceRange: b.sourceRange })),
    });
  }
  composed.sort((a, b) => (a.id < b.id ? -1 : 1));
  // The composed index re-points each entity at its composed sample (not the per-block ones).
  const composedIndex = perBlockIndex.map((e) => ({
    ...e,
    sampleIds: composed.filter((s) => s.entities.includes(e.entityId)).map((s) => s.id).sort(),
  }));
  return { composed, composedIndex };
}

const DELTA = 0.05;
const WORKSPACE_SALT = 'versieve-amnesiac-v1';
const VAULT_PLACEHOLDER_RX = /^<(?:PII|SECRET):[A-Za-z0-9_]+>$/;

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Typed fail-closed errors for eraseEntity targets (weft-theme-linker pattern: Error with a code).
const eraseTargetError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * Certified (1−δ) binomial lower bound for k successes in n trials: solves
 * P(X >= k | n, p) = δ by fixed-sequence Learn-Then-Test inversion over the repo's
 * existing binomCdf kernel (gatekeeper.js) — no new binary weight.
 */
export function certifiedLowerBound(k, n, delta = DELTA) {
  if (n <= 0 || k <= 0) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // P(X >= k) is increasing in p; the certified lower bound is where it crosses δ from below
    if (1 - binomCdf(k - 1, n, mid) > delta) hi = mid;
    else lo = mid;
  }
  return Number(((lo + hi) / 2).toFixed(6));
}

// ---------------------------------------------------------------------------
// Optional canonical entity-sorted Merkle root over corpus spans (opt-in; never part of V1 digests)
// ---------------------------------------------------------------------------

export const MERKLE_ORDERING_SPEC = 'sorted by (entityId, sourceDocHash, byteRange[start,end], vaultedSpan) ascending; leaf=sha256("leaf\\0"+JSON([entityId,sourceDocHash,byteRange|null,vaultedSpan])); node=sha256("node\\0"+left+right); odd node promoted unchanged; empty=sha256("empty")';

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeMerkleRecord(r) {
  const range = Array.isArray(r.byteRange) && r.byteRange.length === 2 ? [Number(r.byteRange[0]), Number(r.byteRange[1])] : null;
  return {
    entityId: String(r.entityId),
    sourceDocHash: String(r.sourceDocHash),
    byteRange: range,
    vaultedSpan: String(r.vaultedSpan ?? ''),
  };
}

function compareMerkleRecords(a, b) {
  const c1 = cmpStr(a.entityId, b.entityId);
  if (c1) return c1;
  const c2 = cmpStr(a.sourceDocHash, b.sourceDocHash);
  if (c2) return c2;
  const ar = a.byteRange || [-1, -1];
  const br = b.byteRange || [-1, -1];
  if (ar[0] !== br[0]) return ar[0] - br[0];
  if (ar[1] !== br[1]) return ar[1] - br[1];
  return cmpStr(a.vaultedSpan, b.vaultedSpan);
}

function merkleLeafHash(rec) {
  return sha256Hex(`leaf\u0000${JSON.stringify([rec.entityId, rec.sourceDocHash, rec.byteRange, rec.vaultedSpan])}`);
}

function merkleNodeHash(l, r) {
  return sha256Hex(`node\u0000${l}${r}`);
}

function sortedUniqueMerkleRecords(records) {
  const seen = new Set();
  const out = [];
  for (const raw of records || []) {
    const rec = normalizeMerkleRecord(raw);
    const key = JSON.stringify([rec.entityId, rec.sourceDocHash, rec.byteRange, rec.vaultedSpan]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out.sort(compareMerkleRecords);
}

function buildMerkleLevels(leafHashes) {
  if (leafHashes.length === 0) return [[sha256Hex('empty')]];
  const levels = [leafHashes];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(i + 1 < cur.length ? merkleNodeHash(cur[i], cur[i + 1]) : cur[i]);
    }
    levels.push(next);
  }
  return levels;
}

/**
 * Pure canonical entity-sorted Merkle root. `records` = [{ entityId, sourceDocHash, byteRange, vaultedSpan }].
 * Input order never matters: records are canonically sorted and de-duplicated first.
 */
export function computeEntitySortedMerkleRoot(records) {
  const sorted = sortedUniqueMerkleRecords(records);
  const leaves = sorted.map(merkleLeafHash);
  const levels = buildMerkleLevels(leaves);
  return {
    merkleRoot: levels[levels.length - 1][0],
    leafCount: sorted.length,
    ordering: MERKLE_ORDERING_SPEC,
    orderingSpec: MERKLE_ORDERING_SPEC,
    leaves,
    records: sorted,
  };
}

/** Inclusion proof for one record (or leaf index): array of { sibling, position: 'left'|'right' } steps. */
export function computeMerkleProof(treeOrRecords, recordOrIndex) {
  const rawRecords = Array.isArray(treeOrRecords)
    ? treeOrRecords
    : Array.isArray(treeOrRecords?.records)
      ? treeOrRecords.records
      : [];
  const sorted = sortedUniqueMerkleRecords(rawRecords);
  let idx = -1;
  if (typeof recordOrIndex === 'number' && Number.isInteger(recordOrIndex)) {
    if (recordOrIndex >= 0 && recordOrIndex < sorted.length) idx = recordOrIndex;
  } else if (recordOrIndex && typeof recordOrIndex === 'object') {
    const norm = normalizeMerkleRecord(recordOrIndex);
    const target = JSON.stringify([norm.entityId, norm.sourceDocHash, norm.byteRange, norm.vaultedSpan]);
    idx = sorted.findIndex(
      (r) => JSON.stringify([r.entityId, r.sourceDocHash, r.byteRange, r.vaultedSpan]) === target
    );
  }
  if (idx === -1) throw new Error('computeMerkleProof: record is not a leaf of this tree');
  const levels = buildMerkleLevels(sorted.map(merkleLeafHash));
  const proof = [];
  let i = idx;
  for (let lvl = 0; lvl < levels.length - 1; lvl++) {
    const cur = levels[lvl];
    const sib = i % 2 === 0 ? i + 1 : i - 1;
    if (sib < cur.length) proof.push({ sibling: cur[sib], position: i % 2 === 0 ? 'right' : 'left' });
    i = Math.floor(i / 2);
  }
  return proof;
}

/** Verify an inclusion proof for `record` (or a precomputed leaf hash string) against `merkleRoot`. */
export function verifyMerkleProof(record, proof, merkleRoot) {
  let h = typeof record === 'string' ? record : merkleLeafHash(normalizeMerkleRecord(record));
  for (const step of proof || []) {
    h = step.position === 'left' ? merkleNodeHash(step.sibling, h) : merkleNodeHash(h, step.sibling);
  }
  return h === merkleRoot;
}

// Derive canonical (entity, source doc, byte range, vaulted span) records from a corpus state.
function corpusMerkleRecords(samples, entityIndex) {
  const tokenOf = new Map(entityIndex.map((e) => [e.entityId, e.token]));
  const records = [];
  for (const s of samples) {
    if (Array.isArray(s.blocks) && s.blocks.length > 0) {
      for (const b of s.blocks) {
        const blockEnts = b.spans ? Object.keys(b.spans).filter((eid) => (b.spans[eid] || []).length > 0) : [];
        for (const eid of blockEnts) {
          if (!(s.entities || []).includes(eid)) continue;
          records.push({
            entityId: eid,
            sourceDocHash: sha256Hex(String(b.source ?? '')),
            byteRange: b.sourceRange ?? null,
            vaultedSpan: tokenOf.get(eid) ?? '',
          });
        }
      }
      continue;
    }
    const srcs = Array.isArray(s.sources) ? s.sources : [{ source: s.source, sourceRange: s.sourceRange }];
    for (const eid of s.entities || []) {
      for (const src of srcs) {
        records.push({
          entityId: eid,
          sourceDocHash: sha256Hex(String(src.source ?? '')),
          byteRange: src.sourceRange ?? null,
          vaultedSpan: tokenOf.get(eid) ?? '',
        });
      }
    }
  }
  return records;
}

// Opt-in telemetry attachments; returns { receiptExtra, resultExtra } (both empty by default).
function optionalTelemetry(samples, entityIndex, view, options, priorState = null) {
  const receiptExtra = {};
  const resultExtra = {};
  const wantMerkle = Boolean(
    options?.includeMerkleRoot === true ||
      view?.includeMerkleRoot === true ||
      priorState?.receipt?.merkleRoot !== undefined
  );
  const wantEgo = Boolean(
    options?.includeEgoGraphTelemetry === true ||
      view?.includeEgoGraphTelemetry === true ||
      priorState?.egoGraphTelemetry !== undefined ||
      priorState?.receipt?.egoGraphTelemetry !== undefined
  );
  if (wantMerkle) {
    const m = computeEntitySortedMerkleRoot(corpusMerkleRecords(samples, entityIndex));
    receiptExtra.merkleRoot = m.merkleRoot;
    receiptExtra.merkleLeafCount = m.leafCount;
    receiptExtra.merkleOrderingSpec = m.orderingSpec;
    receiptExtra.merkle = {
      merkleRoot: m.merkleRoot,
      leafCount: m.leafCount,
      orderingSpec: m.orderingSpec,
    };
    resultExtra.merkleTree = m;
  }
  if (wantEgo) {
    const t = computeEgoGraphTelemetry({ samples, entityIndex });
    resultExtra.egoGraphTelemetry = t;
    receiptExtra.egoGraphTelemetry = {
      entityCount: t.entityCount,
      equivalenceClassCount: t.equivalenceClassCount,
      minEquivalenceClassSize: t.minEquivalenceClassSize,
      maxEquivalenceClassSize: t.maxEquivalenceClassSize,
      singledOutCount: t.singledOutCount,
      singledOutEntities: t.singledOutEntities,
      telemetrySha256: t.telemetrySha256,
    };
    receiptExtra.egoGraphTelemetrySha256 = t.telemetrySha256;
  }
  return { receiptExtra, resultExtra };
}

function canonicalViewForDigest(view) {
  if (!view || typeof view !== 'object') return view ?? null;
  if (!('includeMerkleRoot' in view) && !('includeEgoGraphTelemetry' in view)) return view;
  const { includeMerkleRoot: _m, includeEgoGraphTelemetry: _e, ...rest } = view;
  return Object.keys(rest).length === 0 ? null : rest;
}

function normalizeClassName(type) {
  const u = String(type || 'CUSTOM').toUpperCase();
  return u === 'NAME_LIKELY' ? 'PERSON' : u;
}

// Rescan of each masked sample: any scanner hit that is not a vault placeholder is a detection the gate missed.
function countMisses(content) {
  if (!content) return { missedCount: 0, missedClasses: {} };
  const rescan = scanEnterprisePiiAndSecrets(content, {});
  const missedClasses = {};
  let missedCount = 0;
  for (const sp of rescan.spans || []) {
    const value = String(content).slice(sp.start, sp.end);
    if (VAULT_PLACEHOLDER_RX.test(value)) continue;
    const cls = normalizeClassName(sp.type);
    missedClasses[cls] = (missedClasses[cls] || 0) + 1;
    missedCount++;
  }
  return { missedCount, missedClasses };
}

function countDetected(entities) {
  const detectedClasses = {};
  let detectedCount = 0;
  for (const ent of entities) {
    if (!ent.entityId) continue;
    const cls = normalizeClassName(ent.type);
    detectedClasses[cls] = (detectedClasses[cls] || 0) + 1;
    detectedCount++;
  }
  return { detectedCount, detectedClasses };
}

async function perceiveInputs(inputs, options) {
  if (Array.isArray(inputs)) return perceiveMulti(inputs, options);
  if (inputs && typeof inputs === 'object' && Array.isArray(inputs.blocks)) return inputs;
  throw new TypeError('buildAmnesiacCorpus expects the input list perceiveMulti() accepts, or a perception result with a blocks array');
}

// Raw source bytes per input name, mirroring perceiveMulti's own input resolution, for byte-range provenance.
function collectSourceBytes(inputs) {
  const map = new Map();
  if (!Array.isArray(inputs)) return map;
  for (const item of inputs) {
    let name;
    let text = null;
    if (typeof item === 'string') {
      name = 'inline.txt';
      if (fs.existsSync(item) && fs.statSync(item).isFile()) continue; // file inputs carry no byte-locatable text stream
      text = item;
    } else if (item && typeof item === 'object') {
      name = item.name || item.source || 'input.txt';
      if (typeof item.text === 'string') text = item.text;
    }
    if (text !== null) {
      // Duplicate-named text inputs get disambiguated keys so a later colliding input can
      // never borrow the first input's bytes as provenance (blocks from the colliding input
      // simply resolve no byte range).
      let key = name;
      let n = 2;
      while (map.has(key)) key = `${name}#${n++}`;
      map.set(key, Buffer.from(text, 'utf8'));
    }
  }
  return map;
}

function sampleLine(s) {
  return {
    id: s.id,
    source: s.source,
    sourceRange: s.sourceRange,
    entities: s.entities,
    messages: [
      { role: 'system', content: s.system || SYSTEM_PROMPT },
      { role: 'user', content: `Summarize the key record from ${s.source} (${s.role}).` },
      { role: 'assistant', content: s.content },
    ],
  };
}

function serialize(samples) {
  return samples.map((s) => JSON.stringify(sampleLine(s))).join('\n') + (samples.length ? '\n' : '');
}

function computeCertificates(samples) {
  const perSample = samples.map((s) => ({
    id: s.id,
    gate: s.gate,
    risk: s.risk,
    detectedCount: s.detectedCount,
    missedCount: s.missedCount,
    certifiedPass: s.gate !== 'QUARANTINE_SECRET' && s.missedCount === 0,
  }));
  const classes = {};
  for (const cls of Object.keys(samples.reduce((acc, s) => ({ ...acc, ...s.detectedClasses, ...s.missedClasses }), {})).sort()) {
    classes[cls] = { detectedCount: 0, missedCount: 0 };
  }
  for (const s of samples) {
    for (const cls of Object.keys(s.detectedClasses)) {
      if (!classes[cls]) classes[cls] = { detectedCount: 0, missedCount: 0 };
      classes[cls].detectedCount += s.detectedClasses[cls];
    }
    for (const cls of Object.keys(s.missedClasses)) {
      if (!classes[cls]) classes[cls] = { detectedCount: 0, missedCount: 0 };
      classes[cls].missedCount += s.missedClasses[cls];
    }
  }
  const classesOut = {};
  // detection events per class: detected = spans the gate masked; missed = residual scanner hits — certified recall is the binomial bound at stated confidence
  for (const cls of Object.keys(classes).sort()) {
    const c = classes[cls];
    classesOut[cls] = { ...c, certifiedRecallLowerBound: certifiedLowerBound(c.detectedCount, c.detectedCount + c.missedCount) };
  }
  const total = samples.length;
  const passing = perSample.filter((p) => p.certifiedPass).length;
  return {
    statedConfidence: Number((1 - DELTA).toFixed(2)),
    delta: DELTA,
    calibrationMethod: 'Clopper-Pearson binomial lower bound at stated confidence (fixed-sequence Learn-Then-Test inversion over binomCdf)',
    perSample,
    classes: classesOut,
    passRate: total ? Number((passing / total).toFixed(6)) : 0,
    certifiedPassRateLowerBound: certifiedLowerBound(passing, total),
    quarantinedSampleIds: perSample.filter((p) => p.gate === 'QUARANTINE_SECRET').map((p) => p.id),
  };
}

/**
 * One new public seam (spec: gegearsyah/versieve#25): deterministic, entity-indexed
 * SFT corpus with per-sample certificates and version-pinned SHA-256 receipts.
 * `inputs` is anything perceiveMulti() accepts, or a perception result with a `blocks` array.
 * `view` is a declarative projection filter over the perception result ({ sources: [...] }).
 */
export async function buildAmnesiacCorpus(inputs, view = null, options = {}) {
  // Stage K0 mode seam: `view.identity: 'readable' | 'vaulted'` (vaulted = default, byte-identical
  // to the pre-seam behavior; readable = explicit opt-in general mode with no privacy machinery).
  const identity = view?.identity === undefined ? 'vaulted' : view.identity;
  if (identity !== 'readable' && identity !== 'vaulted') {
    throw new TypeError(`buildAmnesiacCorpus: view.identity must be 'readable' or 'vaulted', got ${JSON.stringify(identity)}`);
  }
  const readable = identity === 'readable';
  // Stage K1 composition seam: `view.composition: 'per-block' | 'composed'` (absent = 'per-block',
  // byte-identical to the pre-K1 corpus; composed samples are a schema extension of their own).
  const composition = view?.composition === undefined ? 'per-block' : view.composition;
  const composed = composition === 'composed';
  if (!composed && composition !== 'per-block') {
    throw new TypeError(`buildAmnesiacCorpus: view.composition must be 'per-block' or 'composed', got ${JSON.stringify(composition)}`);
  }
  if (composed && !readable) {
    throw new TypeError("buildAmnesiacCorpus: view.composition 'composed' currently requires view.identity 'readable' — composed private (vaulted) mode is a later stage");
  }
  const perceived = await perceiveInputs(inputs, { ...options, workspaceSalt: options.workspaceSalt || WORKSPACE_SALT });
  const sourceBytes = collectSourceBytes(inputs);
  const sourceCursors = new Map();
  const viewSources = Array.isArray(view?.sources) && view.sources.length > 0 ? view.sources.map(String) : null;

  const rawBlocks = (perceived.blocks || []).filter((blk) =>
    String(blk.originalText ?? '').trim() !== '' &&
    (!viewSources || viewSources.some((s) => String(blk.source || '').includes(s)))
  );

  const samples = [];
  const idSeen = new Set();
  const entityMeta = new Map();
  // Readable mode bookkeeping: every raw surface value that resolved to each (vault-salted) entity,
  // for the canonical-anchor rule, and per-sample spans for mechanical span-exact regeneration.
  const surfaces = readable ? new Map() : null;

  for (const blk of rawBlocks) {
    const originalText = String(blk.originalText);
    // Vaulted: masked content (placeholders over the user's own text). Readable: the user's own
    // text unmasked — names, addresses and secrets included; no protection machinery in the surface.
    const content = readable ? originalText : String(blk.maskedText ?? '');
    const source = String(blk.source || 'document');
    const role = String(blk.structRole || 'PROSE');

    let sourceRange = null;
    const bytes = sourceBytes.get(source);
    if (bytes) {
      const needle = Buffer.from(originalText, 'utf8');
      const cursor = sourceCursors.get(source) || 0;
      const at = bytes.indexOf(needle, cursor);
      if (at !== -1) {
        sourceRange = [at, at + needle.length];
        sourceCursors.set(source, at + needle.length);
      }
    }

    const entities = [];
    for (const ent of blk.entities || []) {
      if (!ent.entityId || entities.includes(ent.entityId)) continue;
      entities.push(ent.entityId);
      let meta = entityMeta.get(ent.entityId);
      if (!meta) {
        meta = { entityId: ent.entityId, class: normalizeClassName(ent.type), token: ent.token, sampleIds: new Set(), occurrences: 0 };
        entityMeta.set(ent.entityId, meta);
      }
      meta.occurrences += 1;
    }

    const baseId = sha256Hex(`${source}\u0000${sourceRange ? sourceRange.join(':') : 'x'}\u0000${sha256Hex(originalText)}`);
    let id = baseId;
    if (idSeen.has(id)) {
      if (sourceRange) {
        throw new Error(`buildAmnesiacCorpus: duplicate sample id ${id} at byte range ${sourceRange.join(':')} — the same source span was emitted twice; failing loudly instead of emitting an ambiguous corpus`);
      }
      // Derived-format blocks carry no byte range, so benign repeated content (a quoted
      // email line, two same-titled slides) legitimately collides — disambiguate deterministically.
      let dup = 2;
      while (idSeen.has(id)) id = sha256Hex(`${baseId}\u0000occ:${dup++}`);
    }
    idSeen.add(id);
    if (readable) {
      // Per-sample raw spans (offsets into the unmasked content = originalText) per entity, for
      // mechanical span-exact erasure. Internal bookkeeping only — never emitted into the JSONL.
      const blockSpans = {};
      for (const ent of blk.entities || []) {
        if (!ent.entityId || !Number.isInteger(ent.start) || !Number.isInteger(ent.end)) continue;
        const value = originalText.slice(ent.start, ent.end);
        let list = surfaces.get(ent.entityId);
        if (!list) {
          list = [];
          surfaces.set(ent.entityId, list);
        }
        list.push(value);
        (blockSpans[ent.entityId] ||= []).push([ent.start, ent.end]);
      }
      for (const eid of Object.keys(blockSpans)) blockSpans[eid].sort((a, b) => a[0] - b[0]);
      samples.push({ id, source, sourceRange, role, system: READABLE_SYSTEM_PROMPT, spans: blockSpans, content, entities, blockId: blk.blockId ?? null });
    } else {
      const gate = blk.gateAction || 'KEEP_SAFE_REDACTED';
      const { detectedCount, detectedClasses } = countDetected(blk.entities || []);
      const { missedCount, missedClasses } = countMisses(content);
      samples.push({
        id,
        source,
        sourceRange,
        role,
        gate,
        risk: Number((blk.coupledRiskScore ?? 0).toFixed(4)),
        content,
        entities,
        detectedCount,
        detectedClasses,
        missedCount,
        missedClasses,
        blockId: blk.blockId ?? null,
      });
    }
  }

  samples.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of samples) {
    for (const eid of s.entities) entityMeta.get(eid)?.sampleIds.add(s.id);
  }

  // Canonical readable-anchor rule: among every raw surface form that resolved to the same
  // entity (full name, titled alias, bare surname spans), the lexicographically smallest
  // surface value is the canonical anchor — deterministic and independent of mention order.
  let readableOf = null;
  if (readable) {
    readableOf = new Map();
    for (const m of entityMeta.values()) {
      const values = (surfaces.get(m.entityId) || []).filter((v) => v.trim() !== '').sort();
      // best effort when a derived-format input records an entity with no raw offsets
      const canonical = values[0] ?? m.token ?? m.entityId;
      readableOf.set(m.entityId, { id: `ent:${m.class.toLowerCase()}:${canonical}`, canonical });
    }
    // Distinct vaulted entities cannot share a raw surface value (value-salted identity: same
    // string → same vault ID → one entity), so readable ids are unique by construction. If that
    // invariant ever breaks, collisions would silently merge entities — fail loudly instead.
    const uniqueIds = new Set([...readableOf.values()].map((r) => r.id));
    if (uniqueIds.size !== readableOf.size) {
      throw new Error('buildAmnesiacCorpus: readable identity collision — distinct entities mapped to one readable id');
    }
    for (const s of samples) {
      s.entities = s.entities.map((eid) => readableOf.get(eid)?.id ?? eid);
      if (s.spans) {
        const remapped = {};
        for (const [eid, spans] of Object.entries(s.spans)) remapped[readableOf.get(eid)?.id ?? eid] = spans;
        s.spans = remapped;
      }
    }
  }

  const entityIndex = [...entityMeta.values()]
    .map((m) => {
      if (readable) {
        const r = readableOf.get(m.entityId);
        return { entityId: r.id, class: m.class, token: r.canonical, sampleIds: [...m.sampleIds].sort(), occurrences: m.occurrences };
      }
      return { entityId: m.entityId, class: m.class, token: m.token, sampleIds: [...m.sampleIds].sort(), occurrences: m.occurrences };
    })
    .sort((a, b) => (a.entityId < b.entityId ? -1 : 1));

  // W6 theme channel (2026-11-28 plan decisions 5 + 6): when the caller ran the seam with
  // theme linking, the corpus carries the scored chunk pairs plus each chunk's block
  // provenance, so eraseEntity can re-prove the agglomeration over the post-erasure
  // corpus with the same model sha and policy version. Pure bookkeeping: it never enters
  // the JSONL or the receipt.
  let themeState = null;
  if (perceived.themeLinks && perceived.themeChannel) {
    if (perceived.themeChannel.policyVersion !== THEME_POLICY_VERSION) {
      throw new Error(
        `buildAmnesiacCorpus: theme channel policy ${perceived.themeChannel.policyVersion} does not match the engine's ${THEME_POLICY_VERSION}; refuse to bookkeep a mixed policy corpus`
      );
    }
    const chunks = new Map();
    for (const link of perceived.themeLinks) {
      for (const [id, span] of [[link.a, link.aSpan], [link.b, link.bSpan]]) {
        if (!chunks.has(id)) chunks.set(id, { id, source: span ? span.source : null, blockId: span ? span.blockId ?? null : null });
      }
    }
    themeState = {
      policyVersion: perceived.themeChannel.policyVersion,
      modelSha256: perceived.themeChannel.modelSha256,
      policy: { joinThreshold: perceived.themeChannel.joinThreshold, simFloor: perceived.themeChannel.simFloor },
      nodes: perceived.themeNodes,
      pairs: perceived.themeLinks.map((l) => ({ a: l.a, b: l.b, linkProb: l.linkProb, themeSim: l.themeSim })),
      chunks: [...chunks.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    };
  }

  // Stage K1: composed corpus (readable identity) — the join is the training unit. One composed
  // sample per resolved entity rendering its cross-document evidence blocks with per-sample
  // multi-source provenance, under the canonicalized versioned composition policies.
  if (composed) {
    const { composed: composedSamples, composedIndex } = composeReadableSamples(samples, entityIndex);
    const composedJsonl = composedSamples.map((s) => JSON.stringify(composedSampleLine(s))).join('\n') + (composedSamples.length ? '\n' : '');
    const { receiptExtra, resultExtra } = optionalTelemetry(composedSamples, composedIndex, view, options);
    const composedReceipt = {
      engine: AMNESIAC_ENGINE_VERSION,
      engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
      corpusSha256: sha256Hex(composedJsonl),
      sampleCount: composedSamples.length,
      entityCount: composedIndex.length,
      identity,
      compositionPolicy: COMPOSITION_POLICY,
      viewDigest: sha256Hex(JSON.stringify(canonicalViewForDigest(view))),
      ...receiptExtra,
    };
    return {
      jsonl: composedJsonl,
      samples: composedSamples,
      entityIndex: composedIndex,
      ...resultExtra,
      ...(themeState ? { theme: themeState } : {}),
      receipt: composedReceipt,
    };
  }

  const jsonl = serialize(samples);
  const { receiptExtra, resultExtra } = optionalTelemetry(samples, entityIndex, view, options);
  const receipt = {
    engine: AMNESIAC_ENGINE_VERSION,
    engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
    corpusSha256: sha256Hex(jsonl),
    sampleCount: samples.length,
    entityCount: entityIndex.length,
    ...(readable ? { identity } : {}),
    viewDigest: sha256Hex(JSON.stringify(canonicalViewForDigest(view))),
    ...receiptExtra,
  };
  // Readable mode has no certificate ceremony and no placeholder-masking recipe: the general
  // mode emits none of the vault's protection machinery, only the corpus and its receipt.
  if (readable) return { jsonl, samples, entityIndex, ...resultExtra, ...(themeState ? { theme: themeState } : {}), receipt };
  const certificates = computeCertificates(samples);
  return {
    jsonl,
    samples,
    entityIndex,
    certificates,
    trainingRecipe: AMNESIAC_TRAINING_RECIPE,
    ...resultExtra,
    ...(themeState ? { theme: themeState } : {}),
    receipt,
  };
}

/**
 * Source-anchor erasure (spec: gegearsyah/versieve#66): regenerate the corpus minus every
 * sample from one source. The diff must be pure deletion of exactly that source's sample
 * lines, and the diff receipt states the target's full footprint: removed samples and the
 * exact JSONL bytes deleted, which entities were removed versus merely shrunk, and the
 * theme-channel invalidation when a theme channel is present. Entity erasure semantics are
 * untouched; composed corpora fail closed instead of guessing at retraction semantics.
 */
function eraseSource(state, sourceName) {
  if (sourceName === '') {
    throw eraseTargetError('AMNESIAC_ERASE_TARGET_MALFORMED', "eraseEntity: a 'source:' target must name a source");
  }
  if (state.receipt.compositionPolicy === COMPOSITION_POLICY) {
    throw eraseTargetError(
      'AMNESIAC_ERASE_SOURCE_COMPOSED_UNSUPPORTED',
      'eraseEntity: source erasure is defined for per-block corpora only; composed corpora keep their proven entity-path erasure instead of unproven retraction semantics'
    );
  }
  const removed = state.samples.filter((s) => s.source === sourceName);
  if (removed.length === 0) {
    throw eraseTargetError(
      'AMNESIAC_ERASE_TARGET_UNKNOWN',
      `eraseEntity: unknown source anchor source:${sourceName}; failing loudly rather than emitting a subtly-wrong corpus`
    );
  }
  const removedIds = new Set(removed.map((s) => s.id));
  const remaining = state.samples.filter((s) => !removedIds.has(s.id));
  const jsonl = serialize(remaining);

  // Mechanical pure-deletion check: the surviving lines must be exactly the original lines
  // minus the removed samples' lines, in order (sample ids are unique, so a removed line can
  // never collide with a surviving one).
  const removedLines = new Set(removed.map((s) => JSON.stringify(sampleLine(s))));
  const survivingLines = String(state.jsonl).split('\n').filter(Boolean).filter((l) => !removedLines.has(l));
  const afterLines = jsonl.split('\n').filter(Boolean);
  if (afterLines.length !== survivingLines.length || afterLines.some((l, i) => l !== survivingLines[i])) {
    throw eraseTargetError(
      'AMNESIAC_ERASE_DIFF_MISMATCH',
      `eraseEntity: byte-diff for source:${sourceName} is not pure deletion of its sample lines; failing loudly instead of emitting a subtly-wrong corpus`
    );
  }

  // Entity index re-derivation: entities that lost samples keep their remaining sampleIds and
  // exactly-decremented occurrence counts (one occurrence per block); entities whose every
  // sample came from the erased source are dropped from the index and listed in the receipt.
  const removedEntityHits = new Map();
  for (const s of removed) {
    for (const eid of s.entities) removedEntityHits.set(eid, (removedEntityHits.get(eid) || 0) + 1);
  }
  const regeneratedEntityIndex = [];
  const removedEntityIds = [];
  const changedEntityIds = [];
  for (const e of state.entityIndex) {
    if (e.sampleIds.every((id) => !removedIds.has(id))) {
      regeneratedEntityIndex.push(e);
      continue;
    }
    const occurrences = e.occurrences - (removedEntityHits.get(e.entityId) || 0);
    if (occurrences < 0) {
      throw eraseTargetError(
        'AMNESIAC_ERASE_DIFF_MISMATCH',
        `eraseEntity: entity ${e.entityId} records more occurrences than samples removed for source:${sourceName}; rebuild the corpus instead of emitting a subtly-wrong one`
      );
    }
    const sampleIds = e.sampleIds.filter((id) => !removedIds.has(id));
    changedEntityIds.push(e.entityId);
    if (sampleIds.length === 0) {
      removedEntityIds.push(e.entityId);
      continue;
    }
    regeneratedEntityIndex.push({ ...e, sampleIds: [...sampleIds].sort(), occurrences });
  }

  // Same theme re-proof as entity erasure: all chunks anchored in removed samples are
  // invalidated, pairs through them are dropped (conservative), and the agglomeration is
  // re-derived over the survivors with the same policy version and model sha.
  let themeStateAfter = null;
  let themeDiffExtra = {};
  if (state.theme) {
    const themePolicy = { policyVersion: state.theme.policyVersion, joinThreshold: state.theme.policy.joinThreshold, simFloor: state.theme.policy.simFloor, anchorK: 0, modelSha256: state.theme.modelSha256 };
    const invalidatedBlockIds = new Set(removed.map((s) => s.blockId).filter(Boolean));
    const invalidatedChunkIds = new Set(
      state.theme.chunks.filter((c) => c.blockId !== null && invalidatedBlockIds.has(c.blockId)).map((c) => c.id)
    );
    const survivingPairs = state.theme.pairs.filter((p) => !invalidatedChunkIds.has(p.a) && !invalidatedChunkIds.has(p.b));
    const themeNodesBefore = agglomerateThemeNodes(state.theme.pairs, themePolicy);
    const themeAfter = agglomerateThemeNodes(survivingPairs, themePolicy);
    themeDiffExtra = {
      themeReDerived: true,
      themeNodeCountBefore: themeNodesBefore.nodes.length,
      themeNodeCountAfter: themeAfter.nodes.length,
      themeInvalidatedPairCount: state.theme.pairs.length - survivingPairs.length,
      changedThemeNodeIds: [
        ...new Set([
          ...themeNodesBefore.nodes.filter((n) => !themeAfter.nodes.some((m) => m.id === n.id)).map((n) => n.id),
          ...themeAfter.nodes.filter((n) => !themeNodesBefore.nodes.some((m) => m.id === n.id)).map((n) => n.id),
        ]),
      ].sort(),
    };
    themeStateAfter = {
      policyVersion: state.theme.policyVersion,
      modelSha256: state.theme.modelSha256,
      policy: state.theme.policy,
      nodes: themeAfter.nodes,
      pairs: survivingPairs,
      chunks: state.theme.chunks,
    };
  }

  const { receiptExtra, resultExtra } = optionalTelemetry(remaining, regeneratedEntityIndex, null, null, state);
  const receipt = {
    ...state.receipt,
    corpusSha256: sha256Hex(jsonl),
    sampleCount: remaining.length,
    entityCount: regeneratedEntityIndex.length,
    ...receiptExtra,
  };
  const removedSampleLineBytes = removed.reduce((n, s) => n + JSON.stringify(sampleLine(s)).length + 1, 0);
  const diffReceipt = {
    erasedTarget: `source:${sourceName}`,
    erasedTargetKind: 'source',
    erasedSource: sourceName,
    engine: AMNESIAC_ENGINE_VERSION,
    engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
    changedSampleIds: [],
    removedSampleIds: [...removedIds].sort(),
    removedSampleCount: removed.length,
    removedSampleLineBytes,
    removedEntityIds: removedEntityIds.sort(),
    changedEntityIds: changedEntityIds.sort(),
    unchangedSampleCount: remaining.length,
    removedSpanCount: 0,
    removedSpanBytes: 0,
    // The per-block corpus model records no cross-source reference field between samples, so
    // the receipt cannot assert that no surviving document references the erased source; the
    // theme channel is the one cross-block link the model carries and its invalidation is
    // receipted via the themeReDerived fields in this receipt. A real reference field waits for #59.
    crossReference: {
      detectedInSurvivingSamples: [],
      note: 'the per-block corpus model records no cross-source reference channel between samples, so the receipt cannot assert that no surviving document references the erased source; the theme channel is the one cross-block link the model carries and its invalidation is receipted via the themeReDerived fields in this receipt',
    },
    corpusSha256Before: state.receipt.corpusSha256,
    corpusSha256After: receipt.corpusSha256,
    ...themeDiffExtra,
    ...(state.receipt.merkleRoot !== undefined
      ? {
          merkleRootBefore: state.receipt.merkleRoot,
          merkleRootAfter: receipt.merkleRoot,
        }
      : {}),
    diffVerified: true,
  };
  diffReceipt.diffReceiptSha256 = sha256Hex(JSON.stringify(diffReceipt));
  // Readable mode carries no certificate ceremony; erasure is plain mechanical regeneration.
  if (state.receipt.identity === 'readable') {
    return {
      jsonl,
      samples: remaining,
      entityIndex: regeneratedEntityIndex,
      ...resultExtra,
      ...(themeStateAfter ? { theme: themeStateAfter } : {}),
      receipt,
      diffReceipt,
    };
  }
  const certificates = computeCertificates(remaining);
  return {
    jsonl,
    samples: remaining,
    entityIndex: regeneratedEntityIndex,
    certificates,
    trainingRecipe: AMNESIAC_TRAINING_RECIPE,
    ...resultExtra,
    ...(themeStateAfter ? { theme: themeStateAfter } : {}),
    receipt,
    diffReceipt,
  };
}

/**
 * Provable erasure (spec: gegearsyah/versieve#25): regenerate the corpus minus one entity.
 * Only the samples referencing the entity change; the byte-diff is exactly the erased
 * entity's token spans plus its index entry — anything else fails loudly.
 * Spec gegearsyah/versieve#66 extends the target grammar: `source:NAME` erases a whole
 * source anchor with a pure-deletion, full-footprint diff receipt; `unit:` knowledge-unit
 * targets fail closed (typed AMNESIAC_ERASE_TARGET_UNRESOLVED) because no current corpus
 * model can resolve one; that representation lands with issue gegearsyah/versieve#59.
 */
export function eraseEntity(state, entityId) {
  if (!state || !Array.isArray(state.samples) || !Array.isArray(state.entityIndex) || !state.receipt) {
    throw new TypeError('eraseEntity requires an Amnesiac Corpus state produced by buildAmnesiacCorpus');
  }
  if (state.receipt.engineVersionSha256 !== AMNESIAC_ENGINE_VERSION_SHA256) {
    throw new Error(
      `engine version drift: corpus determinism receipt invalidated (built by ${String(state.receipt.engineVersionSha256).slice(0, 12)}…, running ${AMNESIAC_ENGINE_VERSION_SHA256.slice(0, 12)}…) — rebuild the corpus instead of silently regenerating bytes`
    );
  }
  // W6: a theme-carrying corpus must never be erased against a different theme policy
  // version (the engine hash already pins the current one; this rejects a hand-edited theme).
  if (state.theme) {
    if (state.theme.policyVersion !== THEME_POLICY_VERSION) {
      throw new Error(
        `theme policy version drift: corpus theme channel was built under ${String(state.theme.policyVersion)}, running ${THEME_POLICY_VERSION}; rebuild the corpus instead of silently regenerating bytes`
      );
    }
    if (!state.theme.modelSha256 || !Array.isArray(state.theme.pairs) || !Array.isArray(state.theme.chunks)) {
      throw new Error('eraseEntity: corpus carries a malformed theme channel; rebuild the corpus instead of silently regenerating bytes');
    }
  }
  // Target grammar (#66): `source:NAME` routes to source-anchor erasure, `unit:` must fail
  // closed (no knowledge-unit index exists until the #59 corpus representation lands), and
  // everything else keeps the legacy entity path unchanged for existing callers.
  if (typeof entityId !== 'string' || entityId.trim() === '') {
    throw eraseTargetError(
      'AMNESIAC_ERASE_TARGET_MALFORMED',
      `eraseEntity: erase target must be a non-empty entity id, a 'source:'-prefixed source anchor, or a 'unit:'-prefixed knowledge-unit id, got ${JSON.stringify(entityId ?? null)}`
    );
  }
  if (entityId.startsWith('source:')) return eraseSource(state, entityId.slice('source:'.length));
  if (entityId.startsWith('unit:')) {
    throw eraseTargetError(
      'AMNESIAC_ERASE_TARGET_UNRESOLVED',
      `eraseEntity: knowledge-unit target ${entityId} cannot be resolved because this corpus model carries no knowledge-unit index; the corpus representation that would resolve unit ids lands with issue gegearsyah/versieve#59, so failing closed instead of emitting a subtly-wrong corpus`
    );
  }
  const entry = state.entityIndex.find((e) => e.entityId === String(entityId));
  if (!entry) {
    throw eraseTargetError('AMNESIAC_ERASE_TARGET_UNKNOWN', `eraseEntity: unknown entityId ${String(entityId)}; failing loudly rather than emitting a subtly-wrong corpus`);
  }

  const token = entry.token;
  // Readable mode erases by raw byte spans (mechanical regeneration; no protection claim);
  // vaulted mode erases by token occurrences over masked content.
  const readable = state.receipt.identity === 'readable';
  // Composed readable corpus: re-prove erasure on the composed corpus, do not inherit it.
  const composed = readable && state.receipt.compositionPolicy === COMPOSITION_POLICY;
  // W6 theme re-proof bookkeeping: every source block a changed sample contributes, so the
  // theme pairs whose member chunks lost bytes under this erasure are dropped (conservative)
  // and the agglomeration is re-derived over the survivors with the same policy and model sha.
  const blocksChangedBySample = new Map();
  if (state.theme) {
    for (const s of state.samples) {
      const ids = [];
      if (s.blockId) ids.push(s.blockId);
      for (const b of s.blocks || []) if (b.blockId) ids.push(b.blockId);
      if (ids.length) blocksChangedBySample.set(s.id, ids);
    }
  }
  const themePolicy = state.theme
    ? { policyVersion: state.theme.policyVersion, joinThreshold: state.theme.policy.joinThreshold, simFloor: state.theme.policy.simFloor, anchorK: 0, modelSha256: state.theme.modelSha256 }
    : null;
  const themeNodesBefore = state.theme ? agglomerateThemeNodes(state.theme.pairs, themePolicy) : null;
  const changed = [];
  const regeneratedSamples = [];
  let retractedCount = 0;
  for (const s of state.samples) {
    if (!s.entities.includes(entityId)) {
      regeneratedSamples.push(s);
      continue;
    }
    if (readable) {
      // (a) the erased entity is the sample's TARGET: the whole sample is retracted —
      // the composed sample exists to render that entity.
      if (composed && s.target === entityId) {
        retractedCount += 1;
        changed.push({ id: s.id, retracted: true });
        continue;
      }
      const spans = (s.spans && s.spans[entityId]) || [];
      if (spans.length === 0) {
        throw new Error(`eraseEntity: sample ${s.id} lists readable entity ${entityId} but records no raw spans — rebuild the readable corpus instead of emitting a subtly-wrong one`);
      }
      let erasedContent = s.content;
      let removedBytes = 0;
      for (const [start, end] of spans.slice().sort((a, b) => b[0] - a[0])) {
        erasedContent = erasedContent.slice(0, start) + erasedContent.slice(end);
        removedBytes += end - start;
      }
      const spansWithoutEntity = { ...(s.spans || {}) };
      delete spansWithoutEntity[entityId];
      const regenerated = {
        ...s,
        content: erasedContent,
        entities: s.entities.filter((e) => e !== entityId),
        spans: spansWithoutEntity,
      };
      if (composed) {
        // (b) co-mentioned in a composed sample: remove the entity's raw spans from every
        // contributing block and re-derive the render-coordinate spans for the remainder.
        if (!Array.isArray(s.blocks)) {
          throw new Error(`eraseEntity: composed sample ${s.id} carries no block bookkeeping — rebuild the composed corpus instead of emitting a subtly-wrong one`);
        }
        regenerated.blocks = s.blocks.map((b) => {
          const blockSpans = (b.spans && b.spans[entityId]) || [];
          const declared = (b.entities || []).includes(entityId);
          if (declared && blockSpans.length === 0) {
            throw new Error(`eraseEntity: composed sample ${s.id} anchors readable entity ${entityId} in block ${b.id} but records no raw spans — rebuild the composed corpus instead of emitting a subtly-wrong one`);
          }
          if (blockSpans.length === 0) return b;
          let erasedBlockContent = b.content;
          for (const [start, end] of blockSpans.slice().sort((a, c) => c[0] - a[0])) {
            erasedBlockContent = erasedBlockContent.slice(0, start) + erasedBlockContent.slice(end);
          }
          const nextBlockSpans = { ...(b.spans || {}) };
          delete nextBlockSpans[entityId];
          return { ...b, content: erasedBlockContent, spans: nextBlockSpans };
        });
        const reRendered = renderComposedBlocks(regenerated.blocks);
        // The two derivations of the same erasure (render-span removal → the serialized line;
        // block-level removal → re-rendered spans for future erasures) must agree byte-for-byte.
        if (reRendered.content !== regenerated.content) {
          throw new Error(`eraseEntity: composed re-render diverges from span-removal for sample ${s.id} — failing loudly instead of emitting a subtly-wrong corpus`);
        }
        regenerated.spans = reRendered.spans;
      }
      const oldLine = JSON.stringify(composed ? composedSampleLine(s) : sampleLine(s));
      const newLine = JSON.stringify(composed ? composedSampleLine(regenerated) : sampleLine(regenerated));
      const expectedDelta = -(removedBytes + (JSON.stringify(s.entities).length - JSON.stringify(regenerated.entities).length));
      if (newLine.length - oldLine.length !== expectedDelta) {
        throw new Error(`eraseEntity: byte-diff for sample ${s.id} exceeds the erased entity's spans — failing loudly instead of emitting a subtly-wrong corpus`);
      }
      regeneratedSamples.push(regenerated);
      changed.push({ id: s.id, removedSpans: spans.length, removedBytes });
      continue;
    }
    const occurrences = s.content.split(token).length - 1;
    if (occurrences <= 0) {
      throw new Error(`eraseEntity: sample ${s.id} lists entity ${entityId} but its token is absent — failing loudly instead of emitting a subtly-wrong corpus`);
    }
    const detectedClasses = { ...s.detectedClasses };
    if (detectedClasses[entry.class] !== undefined) {
      detectedClasses[entry.class] -= occurrences;
      if (detectedClasses[entry.class] <= 0) delete detectedClasses[entry.class];
    }
    const erasedContent = s.content.split(token).join('');
    const regenerated = {
      ...s,
      content: erasedContent,
      entities: s.entities.filter((e) => e !== entityId),
      detectedCount: s.detectedCount - occurrences,
      detectedClasses,
      ...countMisses(erasedContent),
    };
    const oldLine = JSON.stringify(sampleLine(s));
    const newLine = JSON.stringify(sampleLine(regenerated));
    const expectedDelta = -(occurrences * token.length + (JSON.stringify(s.entities).length - JSON.stringify(regenerated.entities).length));
    if (newLine.length - oldLine.length !== expectedDelta) {
      throw new Error(`eraseEntity: byte-diff for sample ${s.id} exceeds the erased entity's spans — failing loudly instead of emitting a subtly-wrong corpus`);
    }
    regeneratedSamples.push(regenerated);
    changed.push({ id: s.id, removedSpans: occurrences });
  }

  const changedIds = changed
    .map((c) => c.id)
    .sort()
    .join('|');
  if (changedIds !== [...entry.sampleIds].sort().join('|')) {
    throw new Error(`eraseEntity: changed samples ${changedIds} do not match the erased entity's index ${entry.sampleIds.join('|')} — failing loudly instead of emitting a subtly-wrong corpus`);
  }

  // W6 theme re-proof (plan decision 6): re-run the same pure agglomeration over the
  // post-erasure corpus (same model sha, same policy version). Pairs whose member chunks
  // lost bytes under this erasure are dropped (invalidated, never re-scored here), and the
  // receipt reports before/after node counts plus the changed theme node ids.
  let themeAfter = null;
  let themeDiffExtra = {};
  let themeStateAfter = null;
  if (state.theme) {
    const invalidatedBlockIds = new Set();
    for (const c of changed) {
      for (const blockId of blocksChangedBySample.get(c.id) || []) invalidatedBlockIds.add(blockId);
    }
    const invalidatedChunkIds = new Set(
      state.theme.chunks.filter((c) => c.blockId !== null && invalidatedBlockIds.has(c.blockId)).map((c) => c.id)
    );
    const survivingPairs = state.theme.pairs.filter((p) => !invalidatedChunkIds.has(p.a) && !invalidatedChunkIds.has(p.b));
    themeAfter = agglomerateThemeNodes(survivingPairs, themePolicy);
    themeDiffExtra = {
      themeReDerived: true,
      themeNodeCountBefore: themeNodesBefore.nodes.length,
      themeNodeCountAfter: themeAfter.nodes.length,
      themeInvalidatedPairCount: state.theme.pairs.length - survivingPairs.length,
      changedThemeNodeIds: [
        ...new Set([
          ...themeNodesBefore.nodes.filter((n) => !themeAfter.nodes.some((m) => m.id === n.id)).map((n) => n.id),
          ...themeAfter.nodes.filter((n) => !themeNodesBefore.nodes.some((m) => m.id === n.id)).map((n) => n.id),
        ]),
      ].sort(),
    };
    themeStateAfter = {
      policyVersion: state.theme.policyVersion,
      modelSha256: state.theme.modelSha256,
      policy: state.theme.policy,
      nodes: themeAfter.nodes,
      pairs: survivingPairs,
      chunks: state.theme.chunks,
    };
  }

  const regeneratedEntityIndex = composed
    ? state.entityIndex
        .filter((e) => e.entityId !== entityId)
        .map((e) => ({
          ...e,
          sampleIds: regeneratedSamples.filter((s) => s.entities.includes(e.entityId)).map((s) => s.id).sort(),
        }))
    : state.entityIndex.filter((e) => e.entityId !== entityId);
  const jsonl = composed
    ? regeneratedSamples.map((s) => JSON.stringify(composedSampleLine(s))).join('\n') + (regeneratedSamples.length ? '\n' : '')
    : serialize(regeneratedSamples);
  const { receiptExtra, resultExtra } = optionalTelemetry(
    regeneratedSamples,
    regeneratedEntityIndex,
    null,
    null,
    state
  );
  const receipt = {
    ...state.receipt,
    corpusSha256: sha256Hex(jsonl),
    entityCount: regeneratedEntityIndex.length,
    // Composed retraction changes the sample count; span-removal samples keep their identity.
    ...(composed ? { sampleCount: regeneratedSamples.length } : {}),
    ...receiptExtra,
  };
  const removedSpanCount = changed.reduce((n, c) => n + (c.removedSpans || 0), 0);
  // Readable surfaces can diverge from one canonical token (aliases), so removed bytes are the
  // raw span bytes; vaulted surfaces are exact token occurrences.
  const removedSpanBytes = readable
    ? changed.reduce((n, c) => n + (c.removedBytes || 0), 0)
    : removedSpanCount * token.length;
  const diffReceipt = {
    erasedEntityId: String(entityId),
    erasedClass: entry.class,
    erasedToken: readable ? entry.token : token,
    engine: AMNESIAC_ENGINE_VERSION,
    engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
    changedSampleIds: changed.map((c) => c.id).sort(),
    unchangedSampleCount: state.samples.length - changed.length,
    removedSpanCount,
    removedSpanBytes,
    ...(composed
      ? {
          compositionPolicy: COMPOSITION_POLICY,
          retractedSampleCount: retractedCount,
          retractedSampleIds: changed.filter((c) => c.retracted).map((c) => c.id).sort(),
        }
      : {}),
    perSample: changed
      .map((c) => (readable ? (c.retracted ? { id: c.id, retracted: true } : { id: c.id, removedSpans: c.removedSpans }) : c))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    corpusSha256Before: state.receipt.corpusSha256,
    corpusSha256After: receipt.corpusSha256,
    ...themeDiffExtra,
    ...(state.receipt.merkleRoot !== undefined
      ? {
          merkleRootBefore: state.receipt.merkleRoot,
          merkleRootAfter: receipt.merkleRoot,
        }
      : {}),
    diffVerified: true,
  };
  diffReceipt.diffReceiptSha256 = sha256Hex(JSON.stringify(diffReceipt));
  // Readable mode carries no certificate ceremony; erasure is plain mechanical regeneration.
  if (readable) {
    return {
      jsonl,
      samples: regeneratedSamples,
      entityIndex: regeneratedEntityIndex,
      ...resultExtra,
      ...(themeStateAfter ? { theme: themeStateAfter } : {}),
      receipt,
      diffReceipt,
    };
  }
  const certificates = computeCertificates(regeneratedSamples);
  return {
    jsonl,
    samples: regeneratedSamples,
    entityIndex: regeneratedEntityIndex,
    certificates,
    trainingRecipe: AMNESIAC_TRAINING_RECIPE,
    ...resultExtra,
    ...(themeStateAfter ? { theme: themeStateAfter } : {}),
    receipt,
    diffReceipt,
  };
}
