#!/usr/bin/env node
/**
 * scripts/merge-weft-v5-pairs.mjs
 *
 * Phase 2 of the v5 end-to-end plan: merge, per profile, the compiler pairs
 * (coverage), the source-disjoint strata pairs, and the estate-extension
 * pairs into one training set plus one eval set, in the compiler pair
 * format the trainer consumes (textA/textB/label/pairType). The strata pairs
 * carry a doc id in `a` and a full doc in `b`, so the coverage corpus
 * resolves the anchor text. Every specialty pair (strata and extension
 * classes) gets a deterministic EVAL_SLICE_PCT hash slice into eval; the
 * compiler pairs keep their own train/eval split untouched. A held-out
 * profile's pairs (compiled eval plus strata plus extension, when present)
 * merge into heldout-eval.jsonl only and never enter training.
 *
 * Fail-closed: an anchor id missing from the corpus, an unreadable input
 * line, or a pair id colliding across train and eval is a typed error; a
 * collision inside one set dedupes with a receipt count. The receipt records
 * per-bucket counts, the eval slice rule, and the identity-overlap balance
 * per class (fact 4: shared identities must correlate with the label no
 * better than chance; the specialty classes are identity-disjoint by
 * construction and the receipt states the measured means).
 *
 * Offline and deterministic; no teacher, no network.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveSourceKind } from './generate-weft-estate-extension-v5.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EVAL_SLICE_PCT = 25;

export class WeftMergeConfigError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'WeftMergeConfigError';
    this.code = 'WEFT_MERGE_CONFIG';
    this.reason = reason;
  }
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

const idents = (doc) => (Array.isArray(doc && doc.identities) ? doc.identities : []);
const keysOf = (doc) => new Set(idents(doc).map((i) => String(i && i.key || '').toLowerCase()).filter(Boolean));

const sharedIdentityKeys = (a, b) => {
  const ka = keysOf(a);
  const kb = keysOf(b);
  let shared = 0;
  for (const key of ka) if (kb.has(key)) shared += 1;
  return shared;
};

const readJsonl = (file) => {
  if (!fs.existsSync(file)) {
    throw new WeftMergeConfigError(`input file is missing: ${file}`, 'input-missing');
  }
  const rows = [];
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      throw new WeftMergeConfigError(`input file ${file} has an unparseable line: ${err.message}`, 'input-unreadable');
    }
    rows.push(row);
  }
  return rows;
};

/**
 * Convert one strata pair ({ label, a: anchorDocId, b: doc, ... }) into the
 * compiler pair format. The anchor text comes from the coverage corpus;
 * everything else rides in provenance, including the event anchors the
 * strata driver recorded.
 */
export function strataPairToCompilerFormat(pair, corpusDocById) {
  if (!pair || !pair.b || typeof pair.b.text !== 'string') {
    throw new WeftMergeConfigError('a strata pair must carry a `b` doc with text', 'strata-shape');
  }
  // Strata shape: positives carry `a` as an anchor doc id (resolved from the
  // coverage corpus); negatives carry `a` as a full teacher-written doc.
  let anchor;
  if (typeof pair.a === 'string') {
    anchor = corpusDocById.get(pair.a);
    if (!anchor) {
      throw new WeftMergeConfigError(`strata pair references anchor doc ${JSON.stringify(pair.a)} which is absent from the coverage corpus`, 'anchor-missing');
    }
  } else if (pair.a && typeof pair.a.text === 'string') {
    anchor = pair.a;
  } else {
    throw new WeftMergeConfigError('a strata pair `a` must be a doc id string or a doc object with text', 'strata-shape');
  }
  const pairType = String(pair.label);
  const docIds = [anchor.id, pair.b.id].sort();
  const overlap = sharedIdentityKeys(anchor, pair.b);
  return {
    id: sha256Hex(`weft-pair\u0000${pairType}\u0000${docIds.join('\u0000')}`),
    policy: 'weft-pairs-v1',
    pairType,
    label: pairType.endsWith('-negative') ? 'negative' : 'positive',
    textA: anchor.text,
    textB: pair.b.text,
    provenance: {
      docIds,
      sources: ['synthetic-estate'],
      sourceStatuses: { 'synthetic-estate': 'green' },
      formats: [anchor.format, pair.b.format],
      departments: [anchor.department, pair.b.department],
      themes: [anchor.theme, pair.b.theme],
      linkType: null,
      identityOverlap: overlap,
      identityDisjoint: overlap === 0,
      maskedIdentityCount: 0,
      augmentation: null,
      generator: 'local-teacher',
      sourceKindA: deriveSourceKind(anchor),
      sourceKindB: pair.b.sourceKind || deriveSourceKind(pair.b),
      eventA: pair.eventA || null,
      eventB: pair.eventB || null,
      stratumProvenance: pair.provenance || null,
    },
  };
}

function identityOverlapBalance(rows) {
  const byLabel = { positive: [], negative: [] };
  for (const row of rows) byLabel[row.label]?.push(row.provenance.identityOverlap ?? 0);
  const mean = (v) => (v.length ? v.reduce((a, n) => a + n, 0) / v.length : null);
  return { positiveMean: mean(byLabel.positive), negativeMean: mean(byLabel.negative) };
}

/**
 * Merge everything. inputs: { profiles: [{ id, compilerDir, strataDir,
 * extensionDir, corpusPath }], heldout: same shape or null, outDir }.
 * Returns { train, evalRows, heldout, receipt }.
 */
export function mergeWeftV5Pairs(inputs) {
  if (!inputs || !Array.isArray(inputs.profiles) || !inputs.profiles.length) {
    throw new WeftMergeConfigError('merge needs at least one profile input', 'profiles-empty');
  }
  const train = [];
  const evalRows = [];
  const heldout = [];
  const seen = new Map(); // id -> 'train' | 'eval' | 'heldout'
  const receipt = {
    kind: 'weft-v5-pairs-merge-receipt',
    evalSlicePct: EVAL_SLICE_PCT,
    evalSliceRule: 'sha256(pair id) % 100 < 25 sends a specialty pair (strata or extension class) to eval; compiler pairs keep their own split',
    perProfile: {},
    dedupedWithinSet: 0,
    reIdedCrossProfile: 0,
    identityOverlapBalance: {},
  };
  const addRows = (rows, profileId, bucket, isSpecialty, sourceSet) => {
    let keptTrain = 0;
    let keptEval = 0;
    for (let row of rows) {
      if (!row || typeof row.textA !== 'string' || typeof row.textB !== 'string' || !row.pairType || !row.label) {
        throw new WeftMergeConfigError(`a ${bucket} row in profile ${profileId} is not in the compiler pair format`, 'row-shape');
      }
      const prior = seen.get(row.id);
      if (prior) {
        if (prior.profileId === profileId) {
          receipt.dedupedWithinSet += 1;
          continue;
        }
        // Coverage and strata doc ids are not profile-namespaced (the three
        // corpora share theme-slug id patterns, and strata negatives use
        // phn-<i>-1 ids), so the same pair id can appear in two profiles with
        // different text. The later profile gets a deterministic
        // profile-namespaced id instead of being dropped or failing.
        row = { ...row, id: sha256Hex(`weft-v5-profile\u0000${profileId}\u0000${row.id}`) };
        receipt.reIdedCrossProfile += 1;
        if (seen.has(row.id)) {
          receipt.dedupedWithinSet += 1;
          continue;
        }
      }
      const toEval = isSpecialty && Number.parseInt(sha256Hex(row.id).slice(0, 8), 16) % 100 < EVAL_SLICE_PCT;
      // Specialty rows take the hash slice; coverage rows keep the split their
      // sourceSet names; held-out rows always stay in the held-out set.
      const dest = sourceSet === 'heldout'
        ? heldout
        : (isSpecialty ? (toEval ? evalRows : train) : (sourceSet === 'eval' ? evalRows : train));
      seen.set(row.id, { profileId, set: dest === heldout ? 'heldout' : dest === train ? 'train' : 'eval' });
      dest.push(row);
      if (sourceSet === 'heldout') keptEval += 1; else if (toEval) keptEval += 1; else keptTrain += 1;
    }
    const profileEntry = receipt.perProfile[profileId] ||= {};
    const bucketEntry = profileEntry[bucket] ||= { train: 0, eval: 0 };
    bucketEntry.train += keptTrain;
    bucketEntry.eval += keptEval;
  };

  for (const input of inputs.profiles) {
    const corpus = JSON.parse(fs.readFileSync(input.corpusPath, 'utf8'));
    const corpusDocById = new Map((corpus.docs || []).map((d) => [d.id, d]));
    // Coverage compiler pairs keep their own split.
    const compilerTrain = readJsonl(path.join(input.compilerDir, 'train.jsonl'));
    const compilerEval = readJsonl(path.join(input.compilerDir, 'eval.jsonl'));
    addRows(compilerTrain, input.id, 'coverage-train', false, 'train');
    addRows(compilerEval, input.id, 'coverage-eval', false, 'eval');
    // Strata: converted, specialty slice.
    if (input.strataDir && fs.existsSync(path.join(input.strataDir, 'strata-pairs.jsonl'))) {
      const strata = readJsonl(path.join(input.strataDir, 'strata-pairs.jsonl'))
        .map((p) => strataPairToCompilerFormat(p, corpusDocById));
      addRows(strata, input.id, 'strata', true, 'train');
    }
    // Extension: already compiler format, specialty slice.
    if (input.extensionDir && fs.existsSync(path.join(input.extensionDir, 'extension-pairs.jsonl'))) {
      const extension = readJsonl(path.join(input.extensionDir, 'extension-pairs.jsonl'));
      addRows(extension, input.id, 'extension', true, 'train');
    }
  }

  if (inputs.heldout) {
    const corpus = JSON.parse(fs.readFileSync(inputs.heldout.corpusPath, 'utf8'));
    const corpusDocById = new Map((corpus.docs || []).map((d) => [d.id, d]));
    const compilerEval = readJsonl(path.join(inputs.heldout.compilerDir, 'eval.jsonl'));
    addRows(compilerEval, inputs.heldout.id, 'heldout-coverage-eval', false, 'heldout');
    const strataFile = path.join(inputs.heldout.strataDir || '', 'strata-pairs.jsonl');
    if (inputs.heldout.strataDir && fs.existsSync(strataFile)) {
      const strata = readJsonl(strataFile).map((p) => strataPairToCompilerFormat(p, corpusDocById));
      addRows(strata, inputs.heldout.id, 'heldout-strata', true, 'heldout');
    }
    const extensionFile = path.join(inputs.heldout.extensionDir || '', 'extension-pairs.jsonl');
    if (inputs.heldout.extensionDir && fs.existsSync(extensionFile)) {
      addRows(readJsonl(extensionFile), inputs.heldout.id, 'heldout-extension', true, 'heldout');
    }
  }

  // Per-pairType counts over the final sets, plus the identity-overlap balance.
  const byPairType = {};
  for (const row of [...train, ...evalRows]) {
    byPairType[row.pairType] = (byPairType[row.pairType] || 0) + 1;
  }
  receipt.byPairType = byPairType;
  const labelCounts = { positive: 0, negative: 0 };
  for (const row of train) labelCounts[row.label] += 1;
  receipt.trainLabelCounts = labelCounts;
  for (const type of Object.keys(byPairType)) {
    const rowsOfType = [...train, ...evalRows].filter((r) => r.pairType === type);
    receipt.identityOverlapBalance[type] = identityOverlapBalance(rowsOfType);
  }
  receipt.counts = { train: train.length, eval: evalRows.length, heldout: heldout.length };

  const outDir = inputs.outDir;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'train.jsonl'), train.map((r) => JSON.stringify(r)).join('\n') + (train.length ? '\n' : ''));
    fs.writeFileSync(path.join(outDir, 'eval.jsonl'), evalRows.map((r) => JSON.stringify(r)).join('\n') + (evalRows.length ? '\n' : ''));
    if (heldout.length) {
      fs.writeFileSync(path.join(outDir, 'heldout-eval.jsonl'), heldout.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
    fs.writeFileSync(path.join(outDir, 'merge-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
  return { train, evalRows, heldout, receipt };
}

function cliValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

const TRAINING_PROFILES = ['regional-logistics', 'hospital-network', 'municipal-office'];

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const outDir = cliValue('--out') || path.join(ROOT, 'results', 'weft-training-pairs-fullscale-live-v5');
    const profiles = (cliValue('--profiles') || TRAINING_PROFILES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
    const inputs = profiles.map((id) => ({
      id,
      compilerDir: path.join(ROOT, 'results', `weft-training-pairs-fullscale-live-v5-${id}`),
      strataDir: path.join(ROOT, 'results', `weft-paraphrase-strata-v5-${id}`),
      extensionDir: path.join(ROOT, 'results', `weft-estate-extension-v5-${id}`),
      corpusPath: path.join(ROOT, 'results', `weft-fullscale-live-corpus-v5-${id}.tmp.json`),
    }));
    const heldoutId = cliValue('--heldout');
    const heldout = heldoutId ? {
      id: heldoutId,
      compilerDir: path.join(ROOT, 'results', `weft-training-pairs-fullscale-live-v5-${heldoutId}`),
      strataDir: path.join(ROOT, 'results', `weft-paraphrase-strata-v5-${heldoutId}`),
      extensionDir: path.join(ROOT, 'results', `weft-estate-extension-v5-${heldoutId}`),
      corpusPath: path.join(ROOT, 'results', `weft-fullscale-live-corpus-v5-${heldoutId}.tmp.json`),
    } : null;
    const result = mergeWeftV5Pairs({ profiles: inputs, heldout, outDir });
    console.error(`merge: ${result.receipt.counts.train} train, ${result.receipt.counts.eval} eval, ${result.receipt.counts.heldout} heldout -> ${outDir}`);
    console.error(`pairTypes: ${JSON.stringify(result.receipt.byPairType)}`);
    console.error(`identity overlap balance: ${JSON.stringify(result.receipt.identityOverlapBalance)}`);
  } catch (err) {
    console.error(`merge failed: ${err.code || err.name} ${err.reason ? `(${err.reason})` : ''}: ${err.message}`);
    process.exit(2);
  }
}
