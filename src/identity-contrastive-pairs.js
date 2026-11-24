/**
 * src/identity-contrastive-pairs.js — Stage K2: identity-contrastive pair compiler.
 *
 * compileIdentityContrastivePairs(state, options) compiles SFT identity-binding pairs
 * deterministically from a readable-mode per-block Amnesiac Corpus state — the output of
 * src/amnesiac-corpus.js `buildAmnesiacCorpus(inputs, { identity: 'readable' })`. The pair
 * compiler is a training-data engineering surface: deterministic, over the enterprise's own
 * resolved graph (readable canonical anchors `ent:<class>:<canonical>`); the vaulted variant
 * is a later stage and fails loudly here.
 *
 * Policy `pairs-v1` (canonicalized, versioned — trap 18: pair selection is a policy, not a fact):
 * - positives: every unordered pair of an entity's evidence blocks from DIFFERENT sources,
 *   rendered as a two-message SFT sample (user shows both records labeled with their source;
 *   assistant emits the readable canonical id + canonical name);
 * - negatives: same-class, different-entity pairs, one block per entity (first block in
 *   canonical block order; a pair whose chosen blocks coincide is skipped), rendered the same
 *   way with the two ids + names as the target (the model must SPLIT them);
 * - block order: source name, then source byte offset, then block id; negative entities in
 *   readable-id order;
 * - hardness bins (surface-form similarity of the two canonical anchors): the similarity is
 *   normalized Levenshtein over lowercased strings (1 − editDistance / max(len)); `homonym`
 *   = identical canonical strings (possible only across classes, and therefore unreachable
 *   for same-class negatives since readable ids are unique by construction — recorded if any
 *   ever appear), `near` ≥ 0.8, `far` < 0.8;
 * - anti-triviality (research note §4 risk 3): `far` negatives are NOT emitted by default —
 *   far pairs are trivially separable and give the model a surface-similarity shortcut while
 *   contributing no binding gradient. Default emits positives + near negatives only;
 *   options.includeFarNegatives opts in for the negative-hardness sweep later;
 * - entity-disjoint holdout (research note §4 risk 2 — designed in BEFORE any capability
 *   claim): every k-th entity in canonical id order (k = ceil(1/holdoutFraction)) is held
 *   out of all pair generation; its blocks remain as context in other pairs so the K3
 *   experiment can measure unseen-entity binding on exactly those entities;
 * - determinism: pair ids are sha256 content digests (`pair\0` + both block ids + the target
 *   entity id(s)); the JSONL is fixed-ordered by pair id; same (state, options) →
 *   byte-identical bytes. No timestamps, no randomness.
 *
 * Zero WASM bytes; the identity target is never circularly scored here (no GT, no scorer).
 */
import crypto from 'node:crypto';

const PAIR_POLICY = 'pairs-v1';
const NEAR_THRESHOLD = 0.8;

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Normalized Levenshtein similarity over lowercased strings: 1 − editDistance / max(len).
// Simple, deterministic, documented — the bin threshold is the policy version's contract.
function similarity(a, b) {
  const s = String(a).toLowerCase();
  const t = String(b).toLowerCase();
  if (s === t) return 1;
  if (!s.length || !t.length) return 0;
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[t.length] / Math.max(s.length, t.length);
}

function hardnessBin(a, b) {
  if (String(a).toLowerCase() === String(b).toLowerCase()) return 'homonym';
  return similarity(a, b) >= NEAR_THRESHOLD ? 'near' : 'far';
}

// Canonical block order: same rule as the composed-corpus evidence order (source name, then
// byte offset; derived-format blocks with no range last, then block id).
const blockOrder = (a, b) => {
  if ((a.sourceRange == null) !== (b.sourceRange == null)) return a.sourceRange == null ? 1 : -1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.sourceRange && b.sourceRange && a.sourceRange[0] !== b.sourceRange[0]) return a.sourceRange[0] - b.sourceRange[0];
  return a.id < b.id ? -1 : 1;
};

function pairLine(p) {
  return {
    id: p.id,
    kind: p.kind,
    ...(p.kind === 'positive' ? { entityId: p.entityId } : { entityIds: p.entityIds, hardness: p.hardness }),
    blockIds: p.blockIds,
    sources: p.sources,
    messages: p.messages,
  };
}

/**
 * Compile identity-contrastive SFT pairs from a readable per-block corpus state.
 * `state` = { samples, entityIndex, receipt } with receipt.identity === 'readable'.
 * `options`: { holdoutFraction = 0.2, includeFarNegatives = false }.
 * Returns { jsonl, pairs, receipt } — jsonl/pairs fixed-ordered by pair id.
 */
export function compileIdentityContrastivePairs(state, options = {}) {
  if (!state || !Array.isArray(state.samples) || !Array.isArray(state.entityIndex) || !state.receipt) {
    throw new TypeError('compileIdentityContrastivePairs requires an Amnesiac Corpus state produced by buildAmnesiacCorpus');
  }
  if (state.receipt.identity !== 'readable') {
    throw new TypeError(
      `compileIdentityContrastivePairs: state.receipt.identity must be 'readable', got ${JSON.stringify(state.receipt.identity)} — the pair compiler consumes the readable per-block seam only (the vaulted pair variant is a later stage)`
    );
  }
  if (state.receipt.compositionPolicy) {
    throw new TypeError('compileIdentityContrastivePairs: composed-corpus state is not a pair-compiler input — build the per-block readable corpus (no view.composition)');
  }
  const holdoutFraction = options.holdoutFraction === undefined ? 0.2 : options.holdoutFraction;
  if (typeof holdoutFraction !== 'number' || !Number.isFinite(holdoutFraction) || holdoutFraction <= 0 || holdoutFraction >= 1) {
    throw new TypeError(`compileIdentityContrastivePairs: holdoutFraction must be a number in (0, 1), got ${JSON.stringify(holdoutFraction)}`);
  }
  const includeFarNegatives = options.includeFarNegatives === true;

  // Entity-disjoint holdout, reserved BEFORE any pair is emitted: every k-th entity in
  // canonical id order (k = ceil(1/fraction)); its blocks stay as context everywhere.
  const k = Math.ceil(1 / holdoutFraction);
  const holdout = new Set(state.entityIndex.filter((_, i) => i % k === 0).map((e) => e.entityId));

  const entityOf = new Map(state.entityIndex.map((e) => [e.entityId, e]));
  const blocksOf = new Map();
  for (const s of state.samples) {
    for (const eid of s.entities) {
      let list = blocksOf.get(eid);
      if (!list) blocksOf.set(eid, (list = []));
      list.push(s);
    }
  }
  for (const list of blocksOf.values()) list.sort(blockOrder);

  const pairs = [];
  const hardnessBins = { homonym: 0, near: 0, far: 0 }; // candidate negatives evaluated, pre-emit filter
  let crossModalPositiveCount = 0;

  // Positives: cross-source block pairs of the same non-holdout entity.
  for (const [entityId, blocks] of blocksOf) {
    if (holdout.has(entityId)) continue;
    const entity = entityOf.get(entityId);
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (a.source === b.source) continue;
        const extA = a.source.slice(a.source.lastIndexOf('.') + 1).toLowerCase();
        const extB = b.source.slice(b.source.lastIndexOf('.') + 1).toLowerCase();
        if (extA && extB && extA !== extB) crossModalPositiveCount += 1;
        pairs.push({
          id: sha256Hex(`pair\u0000${a.id}\u0000${b.id}\u0000${entityId}`),
          kind: 'positive',
          entityId,
          blockIds: [a.id, b.id],
          sources: [a.source, b.source],
          messages: [
            { role: 'user', content: `[${a.source}] ${a.content}\n[${b.source}] ${b.content}\n\nWhich single entity do both of these records describe?` },
            { role: 'assistant', content: `${entityId}\n${entity.token}` },
          ],
        });
      }
    }
  }

  // Negatives: same-class, different-entity, both non-holdout — one canonical first block each.
  const byClass = new Map();
  for (const e of state.entityIndex) {
    if (holdout.has(e.entityId) || !blocksOf.has(e.entityId)) continue;
    let list = byClass.get(e.class);
    if (!list) byClass.set(e.class, (list = []));
    list.push(e.entityId); // entityIndex is id-sorted, so members stay in readable-id order
  }
  for (const classEntityIds of byClass.values()) {
    for (let i = 0; i < classEntityIds.length; i++) {
      for (let j = i + 1; j < classEntityIds.length; j++) {
        const ea = entityOf.get(classEntityIds[i]);
        const eb = entityOf.get(classEntityIds[j]);
        const bin = hardnessBin(ea.token, eb.token);
        hardnessBins[bin] += 1;
        // anti-triviality: far pairs are skipped by default (see module comment), but the
        // evaluated bins are always recorded so the hardness sweep can see what was declined.
        if (bin === 'far' && !includeFarNegatives) continue;
        const blockA = blocksOf.get(ea.entityId)[0];
        let blockB = blocksOf.get(eb.entityId)[0];
        if (blockB.id === blockA.id) blockB = blocksOf.get(eb.entityId)[1];
        if (!blockB || blockB.id === blockA.id) continue;
        pairs.push({
          id: sha256Hex(`pair\u0000${blockA.id}\u0000${blockB.id}\u0000${ea.entityId}\u0000${eb.entityId}`),
          kind: 'negative',
          entityIds: [ea.entityId, eb.entityId],
          hardness: bin,
          blockIds: [blockA.id, blockB.id],
          sources: [blockA.source, blockB.source],
          messages: [
            { role: 'user', content: `[${blockA.source}] ${blockA.content}\n[${blockB.source}] ${blockB.content}\n\nWhich single entity do both of these records describe?` },
            { role: 'assistant', content: `${ea.entityId}\n${ea.token}\n${eb.entityId}\n${eb.token}` },
          ],
        });
      }
    }
  }

  pairs.sort((a, b) => (a.id < b.id ? -1 : 1));
  const jsonl = pairs.map((p) => JSON.stringify(pairLine(p))).join('\n') + (pairs.length ? '\n' : '');
  const positiveCount = pairs.filter((p) => p.kind === 'positive').length;
  const receipt = {
    policy: PAIR_POLICY,
    pairCount: pairs.length,
    positiveCount,
    negativeCount: pairs.length - positiveCount,
    crossModalPositiveCount,
    hardnessBins,
    holdoutEntityIds: [...holdout].sort(),
    holdoutFraction,
    sourceEntityCount: state.entityIndex.length,
    sourceSampleCount: state.samples.length,
    corpusSha256: state.receipt.corpusSha256,
    pairJsonlSha256: sha256Hex(jsonl),
  };
  return { jsonl, pairs, receipt };
}
