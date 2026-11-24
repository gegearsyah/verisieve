/**
 * src/amnesiac-corpus.js
 * Amnesiac Corpus core — one new seam at the perceiveMulti() level (spec: gegearsyah/verisieve#25).
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
 * One new public seam (spec: gegearsyah/verisieve#25): deterministic, entity-indexed
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
      samples.push({ id, source, sourceRange, role, system: READABLE_SYSTEM_PROMPT, spans: blockSpans, content, entities });
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

  // Stage K1: composed corpus (readable identity) — the join is the training unit. One composed
  // sample per resolved entity rendering its cross-document evidence blocks with per-sample
  // multi-source provenance, under the canonicalized versioned composition policies.
  if (composed) {
    const { composed: composedSamples, composedIndex } = composeReadableSamples(samples, entityIndex);
    const composedJsonl = composedSamples.map((s) => JSON.stringify(composedSampleLine(s))).join('\n') + (composedSamples.length ? '\n' : '');
    const composedReceipt = {
      engine: AMNESIAC_ENGINE_VERSION,
      engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
      corpusSha256: sha256Hex(composedJsonl),
      sampleCount: composedSamples.length,
      entityCount: composedIndex.length,
      identity,
      compositionPolicy: COMPOSITION_POLICY,
      viewDigest: sha256Hex(JSON.stringify(view ?? null)),
    };
    return { jsonl: composedJsonl, samples: composedSamples, entityIndex: composedIndex, receipt: composedReceipt };
  }

  const jsonl = serialize(samples);
  const receipt = {
    engine: AMNESIAC_ENGINE_VERSION,
    engineVersionSha256: AMNESIAC_ENGINE_VERSION_SHA256,
    corpusSha256: sha256Hex(jsonl),
    sampleCount: samples.length,
    entityCount: entityIndex.length,
    ...(readable ? { identity } : {}),
    viewDigest: sha256Hex(JSON.stringify(view ?? null)),
  };
  // Readable mode has no certificate ceremony and no placeholder-masking recipe: the general
  // mode emits none of the vault's protection machinery, only the corpus and its receipt.
  if (readable) return { jsonl, samples, entityIndex, receipt };
  const certificates = computeCertificates(samples);
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
  // Readable mode erases by raw byte spans (mechanical regeneration; no protection claim);
  // vaulted mode erases by token occurrences over masked content.
  const readable = state.receipt.identity === 'readable';
  // Composed readable corpus: re-prove erasure on the composed corpus, do not inherit it.
  const composed = readable && state.receipt.compositionPolicy === COMPOSITION_POLICY;
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
  const receipt = {
    ...state.receipt,
    corpusSha256: sha256Hex(jsonl),
    entityCount: regeneratedEntityIndex.length,
    // Composed retraction changes the sample count; span-removal samples keep their identity.
    ...(composed ? { sampleCount: regeneratedSamples.length } : {}),
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
    diffVerified: true,
  };
  diffReceipt.diffReceiptSha256 = sha256Hex(JSON.stringify(diffReceipt));
  // Readable mode carries no certificate ceremony; erasure is plain mechanical regeneration.
  if (readable) return { jsonl, samples: regeneratedSamples, entityIndex: regeneratedEntityIndex, receipt, diffReceipt };
  const certificates = computeCertificates(regeneratedSamples);
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
