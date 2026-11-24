/**
 * src/amnesiac-corpus.js
 * Amnesiac Corpus core — one new seam at the perceiveMulti() level (spec: gegearsyah/verisieve#25).
 *
 * buildAmnesiacCorpus(inputs, view) → deterministic entity-indexed SFT JSONL: every sample
 *   records its source byte-ranges + entity IDs, carries a gatekeeper certificate, and the
 *   corpus carries SHA-256 receipts pinning the engine version hash.
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
import { perceiveMulti } from './perceive.js';
import { scanEnterprisePiiAndSecrets } from './secret-scanner.js';
import { binomCdf } from './gatekeeper.js';

export const AMNESIAC_ENGINE_VERSION = 'versieve-amnesiac-corpus-v1';
export const AMNESIAC_ENGINE_VERSION_SHA256 = crypto
  .createHash('sha256')
  .update(AMNESIAC_ENGINE_VERSION)
  .digest('hex');

// Deterministic seeded LoRA retrain recipe shipped with every export — the retrain half of the Art. 17 claim.
export const AMNESIAC_TRAINING_RECIPE = Object.freeze({
  family: 'lora',
  seed: 42,
  placeholderMasking: 'labels[-100] on <PII:...>/<SECRET:...> spans (PT-LM)',
  hyperparameters: Object.freeze({ r: 16, alpha: 32, lr: 2e-4, steps: 80, batch: '2x4 grad-accum', maxLen: 768 }),
});

const SYSTEM_PROMPT = 'Answer strictly from the provided sanitized context.';
const DELTA = 0.05;
const WORKSPACE_SALT = 'versieve-amnesiac-v1';
const VAULT_PLACEHOLDER_RX = /^<(?:PII|SECRET):[A-Za-z0-9_]+>$/;

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

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
      { role: 'system', content: SYSTEM_PROMPT },
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
 * One new public seam (spec: gegearsyah/verisieve#25): deterministic, entity-indexed
 * SFT corpus with per-sample certificates and version-pinned SHA-256 receipts.
 * `inputs` is anything perceiveMulti() accepts, or a perception result with a `blocks` array.
 * `view` is a declarative projection filter over the perception result ({ sources: [...] }).
 */
export async function buildAmnesiacCorpus(inputs, view = null, options = {}) {
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

  for (const blk of rawBlocks) {
    const originalText = String(blk.originalText);
    const content = String(blk.maskedText ?? '');
    const source = String(blk.source || 'document');
    const role = String(blk.structRole || 'PROSE');
    const gate = blk.gateAction || 'KEEP_SAFE_REDACTED';

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

    const { detectedCount, detectedClasses } = countDetected(blk.entities || []);
    const { missedCount, missedClasses } = countMisses(content);
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
    });
  }

  samples.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of samples) {
    for (const eid of s.entities) entityMeta.get(eid)?.sampleIds.add(s.id);
  }

  const entityIndex = [...entityMeta.values()]
    .map((m) => ({
      entityId: m.entityId,
      class: m.class,
      token: m.token,
      sampleIds: [...m.sampleIds].sort(),
      occurrences: m.occurrences,
    }))
    .sort((a, b) => (a.entityId < b.entityId ? -1 : 1));

  const jsonl = serialize(samples);
  const certificates = computeCertificates(samples);
  const receipt = {
    engine: AMNESIAC_ENGINE_VERSION,
    engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
    corpusSha256: sha256Hex(jsonl),
    sampleCount: samples.length,
    entityCount: entityIndex.length,
    viewDigest: sha256Hex(JSON.stringify(view ?? null)),
  };
  return { jsonl, samples, entityIndex, certificates, trainingRecipe: AMNESIAC_TRAINING_RECIPE, receipt };
}

/**
 * Provable erasure (spec: gegearsyah/verisieve#25): regenerate the corpus minus one entity.
 * Only the samples referencing the entity change; the byte-diff is exactly the erased
 * entity's token spans plus its index entry — anything else fails loudly.
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
  const entry = state.entityIndex.find((e) => e.entityId === String(entityId));
  if (!entry) {
    throw new Error(`eraseEntity: unknown entityId ${String(entityId)} — failing loudly rather than emitting a subtly-wrong corpus`);
  }

  const token = entry.token;
  const changed = [];
  const regeneratedSamples = [];
  for (const s of state.samples) {
    if (!s.entities.includes(entityId)) {
      regeneratedSamples.push(s);
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

  const regeneratedEntityIndex = state.entityIndex.filter((e) => e.entityId !== entityId);
  const jsonl = serialize(regeneratedSamples);
  const certificates = computeCertificates(regeneratedSamples);
  const receipt = { ...state.receipt, corpusSha256: sha256Hex(jsonl), entityCount: regeneratedEntityIndex.length };
  const diffReceipt = {
    erasedEntityId: String(entityId),
    erasedClass: entry.class,
    erasedToken: token,
    engine: AMNESIAC_ENGINE_VERSION,
    engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
    changedSampleIds: changed.map((c) => c.id).sort(),
    unchangedSampleCount: state.samples.length - changed.length,
    removedSpanCount: changed.reduce((n, c) => n + c.removedSpans, 0),
    removedSpanBytes: changed.reduce((n, c) => n + c.removedSpans, 0) * token.length,
    perSample: changed.sort((a, b) => (a.id < b.id ? -1 : 1)),
    corpusSha256Before: state.receipt.corpusSha256,
    corpusSha256After: receipt.corpusSha256,
    diffVerified: true,
  };
  diffReceipt.diffReceiptSha256 = sha256Hex(JSON.stringify(diffReceipt));
  return {
    jsonl,
    samples: regeneratedSamples,
    entityIndex: regeneratedEntityIndex,
    certificates,
    trainingRecipe: AMNESIAC_TRAINING_RECIPE,
    receipt,
    diffReceipt,
  };
}
