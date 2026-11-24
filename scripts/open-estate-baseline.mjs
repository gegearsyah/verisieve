#!/usr/bin/env node
/**
 * Open-estate exact-match baseline scorer (Layered external-validity estate).
 *
 * Binding references:
 *   scripts/gen-open-estate.mjs / fixtures/open-estate-manifest.json (frozen answer key)
 *   docs/2026-11-24-noisy-estate-benchmark-spec.md Sections 7-8 (trivial-baseline gate)
 *   docs/2026-11-24-open-estate-dataset-hunt.md Section 5 (layered design: no metric
 *     may mix layers; gate binds on layer O only; layer R is reported as-is)
 *
 * Identical exact-match recipe on both layers, per layer separately:
 * transitive closure over identically normalized mention surfaces, where
 * normalization = lowercase + strip punctuation + collapse whitespace, nothing
 * fancier. Person-level, mention-keyed machinery copied from the noisy-estate
 * scorer (that script is a self-contained CLI, not an importable module): pairwise
 * P/R/F1, B-cubed, false-merge / false-split rates, miss attribution by noise type.
 *
 * Layer R (real identity; truth = corpus speaker labels): the exact-match baseline
 * collapses nothing by design there (QMSum role labels repeat verbatim), so it may
 * score high honestly; it is reported, never gated, and never mixed with layer O.
 *
 * Enron slice (conditional, external to the repository): when
 * OPEN_ESTATE_ENRON_SLICE points at the external slice, it is scored the same way
 * and recorded as an additional section; aggregates only (its manifest lives
 * outside the repository by founder ruling).
 *
 * Output: results/open-estate-baseline.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/open-estate-manifest.json');
// tests score into a temp copy (OPEN_ESTATE_BASELINE_OUT) so a no-env suite run never
// rewrites the committed artifact, whose Enron aggregates exist only where the external
// slice does (founder ruling; the artifact records the conditional status either way)
const OUT_PATH = process.env.OPEN_ESTATE_BASELINE_OUT
  ? path.resolve(process.env.OPEN_ESTATE_BASELINE_OUT)
  : path.join(ROOT, 'results/open-estate-baseline.json');

const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Person-level, mention-keyed scoring machinery (mirrors scripts/
// noisy-estate-baseline.mjs computation-for-computation).
// ---------------------------------------------------------------------------
function scoreMentions(mentions, collisionPairs) {
  const groups = new Map();
  for (let i = 0; i < mentions.length; i++) {
    const key = normalize(mentions[i].surface);
    if (!groups.has(key)) groups.set(key, { indices: [], persons: new Set() });
    const g = groups.get(key);
    g.indices.push(i);
    g.persons.add(mentions[i].personId);
  }
  const indexOf = new Map();
  for (const [key, g] of groups) for (const idx of g.indices) indexOf.set(idx, key);
  const byPerson = new Map();
  for (let i = 0; i < mentions.length; i++) {
    if (!byPerson.has(mentions[i].personId)) byPerson.set(mentions[i].personId, []);
    byPerson.get(mentions[i].personId).push(i);
  }
  const C2 = (n) => (n * (n - 1)) / 2;

  let truthPairs = 0;
  for (const indices of byPerson.values()) truthPairs += C2(indices.length);
  let tp = 0;
  for (const indices of byPerson.values()) {
    const byGroup = new Map();
    for (const idx of indices) {
      const key = indexOf.get(idx);
      if (!byGroup.has(key)) byGroup.set(key, 0);
      byGroup.set(key, byGroup.get(key) + 1);
    }
    for (const count of byGroup.values()) tp += C2(count);
  }
  let predictedPairs = 0;
  for (const g of groups.values()) predictedPairs += C2(g.indices.length);
  const fp = predictedPairs - tp;

  const twinOf = new Map();
  for (const pair of collisionPairs) {
    twinOf.set(pair.personIds[0], pair.personIds[1]);
    twinOf.set(pair.personIds[1], pair.personIds[0]);
  }
  let collisionFalseMerges = 0;
  for (const g of groups.values()) {
    const persons = [...g.persons];
    for (let a = 0; a < persons.length; a++) {
      for (let b = a + 1; b < persons.length; b++) {
        if (twinOf.get(persons[a]) === persons[b]) {
          const inA = g.indices.filter((i) => mentions[i].personId === persons[a]).length;
          const inB = g.indices.filter((i) => mentions[i].personId === persons[b]).length;
          collisionFalseMerges += inA * inB;
        }
      }
    }
  }

  const noiseTypes = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
  const noiseHistogram = Object.fromEntries([...noiseTypes, 'none'].map((k) => [k, 0]));
  const comboHistogram = {};
  let splitPairs = 0;
  for (const indices of byPerson.values()) {
    const member = new Map();
    for (const idx of indices) {
      const key = indexOf.get(idx);
      if (!member.has(key)) member.set(key, []);
      member.get(key).push(idx);
    }
    const keys = [...member.keys()];
    for (let a = 0; a < keys.length; a++) {
      for (let b = a + 1; b < keys.length; b++) {
        const left = member.get(keys[a]);
        const right = member.get(keys[b]);
        splitPairs += left.length * right.length;
        const noises = new Set();
        for (const i of [...left, ...right]) for (const n of mentions[i].noises) noises.add(n);
        const present = [...noises].filter((n) => noiseTypes.includes(n));
        const combo = present.length ? present.join('+') : 'none';
        comboHistogram[combo] = (comboHistogram[combo] || 0) + left.length * right.length;
        for (const n of present) noiseHistogram[n] += left.length * right.length;
        if (!present.length) noiseHistogram.none += left.length * right.length;
      }
    }
  }

  let bP = 0;
  let bR = 0;
  for (let i = 0; i < mentions.length; i++) {
    const g = groups.get(indexOf.get(i));
    const same = g.indices.filter((j) => mentions[j].personId === mentions[i].personId).length;
    bP += same / g.indices.length;
    bR += same / byPerson.get(mentions[i].personId).length;
  }
  const bPrec = bP / mentions.length;
  const bRec = bR / mentions.length;

  const pairwise = {
    precision: tp / predictedPairs,
    recall: tp / truthPairs,
    f1: (2 * tp) / (predictedPairs + truthPairs),
    truthPositivePairs: truthPairs,
    predictedPositivePairs: predictedPairs,
    truePositivePairs: tp,
  };
  const bCubed = {
    precision: bPrec,
    recall: bRec,
    f1: (2 * bPrec * bRec) / (bPrec + bRec),
  };
  return {
    counts: { people: byPerson.size, mentions: mentions.length, stringGroups: groups.size },
    pairwise,
    bCubed,
    falseMerges: { count: fp, rate: predictedPairs ? fp / predictedPairs : 0, onCollisionPairs: collisionFalseMerges },
    falseSplits: {
      count: splitPairs,
      rate: truthPairs ? splitPairs / truthPairs : 0,
      noiseHistogram,
      combinationHistogram: comboHistogram,
    },
  };
}

function gateOf(layerO) {
  const gate = {
    recallBelow90: layerO.pairwise.recall < 0.9,
    atLeastOneFalseMerge: layerO.falseMerges.onCollisionPairs >= 1,
    pass: layerO.pairwise.recall < 0.9 && layerO.falseMerges.onCollisionPairs >= 1,
  };
  return gate;
}

// ---------------------------------------------------------------------------
// Score the committed manifest: layer R and layer O separately, never mixed.
// ---------------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const layerO = scoreMentions(manifest.layerO.mentions, manifest.layerO.world.collisionPairs);
const layerR = scoreMentions(manifest.layerR.mentions, []);

const enronEnv = process.env.OPEN_ESTATE_ENRON_SLICE ? path.resolve(process.env.OPEN_ESTATE_ENRON_SLICE) : null;
let enron = null;
if (enronEnv) {
  const slicePath = path.join(enronEnv, 'open-estate-enron-slice-manifest.json');
  if (!fs.existsSync(slicePath)) {
    console.error(`open-estate baseline: OPEN_ESTATE_ENRON_SLICE is set but ${slicePath} does not exist`);
    process.exit(1);
  }
  const slice = JSON.parse(fs.readFileSync(slicePath, 'utf8'));
  const scored = scoreMentions(slice.mentions, slice.world.collisionPairs);
  enron = {
    note: 'Conditional Enron slice, external to the repository (founder ruling). Aggregate scores only; the slice manifest lives outside the repository. A false merge on a collision pair is the disambiguation miss mode here as on layer O.',
    // machine-neutral label: the absolute local path stays off the machine, the committed
    // artifact must not embed user paths (repo rule) and must stay byte-deterministic
    sliceDir: 'external (outside the repository): ' + path.basename(enronEnv),
    sourceUrl: slice.source.url,
    archiveSha256: slice.source.archiveSha256,
    scores: scored,
    gate: gateOf(scored),
  };
}

const gate = gateOf(layerO);
const results = {
  kind: 'open-estate-exact-match-baseline',
  version: manifest.version,
  seed: manifest.seed,
  estateSha256: manifest.estateSha256,
  normalization: 'lowercase + strip punctuation (non letter/number chars become spaces) + collapse whitespace; nothing else',
  clustering: 'transitive closure over identically normalized mention surfaces; per layer, never mixed; each mention is keyed by its single manifest surface',
  note: 'Layered external-validity estate. The gate binds on layer O (overlay identity, truth by construction) exactly as on the noisy estate: exact-match pairwise recall < 0.90 AND >= 1 false merge on the designed collision pairs. Layer R (real identity, truth = corpus speaker labels) is reported as-is, never gated, and every metric is computed per layer so no number mixes real and overlay identity. Audio carries no overlay and is scored by no pipeline in this item.',
  layers: {
    layerR: {
      note: 'Real identity layer; truth = corpus speaker labels (QMSum role handles, as distributed). The exact-match baseline collapses nothing by design here, so a high score is the honest, empty-achievement result; it is baseline for calibration only and never presented as an engine-adjacent win.',
      scoring: {
        people: manifest.layerR.people.length,
        documents: manifest.layerR.documents.length,
        ...layerR.counts,
      },
      pairwise: layerR.pairwise,
      bCubed: layerR.bCubed,
      falseMerges: layerR.falseMerges,
      falseSplits: layerR.falseSplits,
      gate: { applicable: false, reason: 'the gate binds on layer O only (spec Section 5: no metric mixes layers; layer O truth by construction)' },
    },
    layerO: {
      note: 'Overlay identity layer; truth by construction. Same scoring machinery, same normalization, same gate as the noisy estate.',
      scoring: {
        people: manifest.layerO.world.people.length,
        collisionPairs: manifest.layerO.world.collisionPairs.length,
        documents: manifest.layerO.documents.length,
        facts: manifest.layerO.facts.length,
        ...layerO.counts,
      },
      pairwise: layerO.pairwise,
      bCubed: layerO.bCubed,
      falseMerges: layerO.falseMerges,
      falseSplits: layerO.falseSplits,
      noiseSummary: manifest.layerO.noiseSummary,
      gate,
    },
  },
  gate,
  ...(enron ? { enron } : { enron: { omitted: 'OPEN_ESTATE_ENRON_SLICE was not set; the conditional Enron slice is scored only when generated on this machine; committed artifacts record aggregate scores only' } }),
};

function writeAtomic(abs, data) {
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, abs);
      return;
    } catch (e) {
      if (e.code !== 'EPERM' || attempt >= 10) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
writeAtomic(OUT_PATH, JSON.stringify(results, null, 2));
console.log(JSON.stringify({
  layerR: { pairwise: layerR.pairwise, bCubed: layerR.bCubed },
  layerO: { pairwise: layerO.pairwise, bCubed: layerO.bCubed, falseMerges: layerO.falseMerges },
  gate,
  ...(enron ? { enronGate: enron.gate } : {}),
  out: 'results/open-estate-baseline.json',
}));
