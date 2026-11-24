#!/usr/bin/env node
/**
 * Noisy-estate exact-match baseline scorer (the binding trivial-baseline gate of
 * docs/2026-11-24-noisy-estate-benchmark-spec.md §7/§8.1).
 *
 * Reads the frozen answer key (fixtures/noisy-estate-manifest.json — benchmark
 * machinery, never the engine) and scores an exact-match resolution:
 * transitive closure over identically normalized mention surfaces, where
 * normalization = lowercase + strip punctuation + collapse whitespace, nothing
 * fancier. Scoring is person-level and mention-keyed: pairwise P/R/F1, B-cubed,
 * false-merge rate (the N6 collision pairs are the designed stress case),
 * false-split rate with miss attribution by noise type (N1-N8), and Q3
 * disambiguation accuracy (a question misses when the closure merges the target
 * person with its collision twin).
 *
 * Output: results/noisy-estate-baseline.json (the floor Stage K5 must beat).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
const OUT_PATH = path.join(ROOT, 'results/noisy-estate-baseline.json');

// Identical recipe on both sides of the benchmark (spec §7).
const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const mentions = manifest.mentions;

// string groups: the predicted clusters (closure over identical normalized strings)
const groups = new Map(); // norm -> {indices: [], persons: Set}
for (let i = 0; i < mentions.length; i++) {
  const key = normalize(mentions[i].surface);
  if (!groups.has(key)) groups.set(key, { indices: [], persons: new Set() });
  const g = groups.get(key);
  g.indices.push(i);
  g.persons.add(mentions[i].personId);
}
const indexOf = new Map();
for (const [key, g] of groups) for (const idx of g.indices) indexOf.set(idx, key);

const personOf = (i) => mentions[i].personId;
const byPerson = new Map();
for (let i = 0; i < mentions.length; i++) {
  if (!byPerson.has(personOf(i))) byPerson.set(personOf(i), []);
  byPerson.get(personOf(i)).push(i);
}
const C2 = (n) => (n * (n - 1)) / 2;

// --- pairwise ---------------------------------------------------------------
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
const predictedPairs = tp + (groups.values().reduce((n, g) => n + C2(g.indices.length), 0) - tp);
const fp = predictedPairs - tp;

// false merges on the designed N6 collision pairs
const twinOf = new Map();
for (const pair of manifest.world.collisionPairs) {
  twinOf.set(pair.personIds[0], pair.personIds[1]);
  twinOf.set(pair.personIds[1], pair.personIds[0]);
}
let collisionFalseMerges = 0;
for (const g of groups.values()) {
  const persons = [...g.persons];
  for (let a = 0; a < persons.length; a++) {
    for (let b = a + 1; b < persons.length; b++) {
      if (twinOf.get(persons[a]) === persons[b]) {
        // the group holds mentions of both pair members: count the cross pairs
        const inA = g.indices.filter((i) => personOf(i) === persons[a]).length;
        const inB = g.indices.filter((i) => personOf(i) === persons[b]).length;
        collisionFalseMerges += inA * inB;
      }
    }
  }
}

// --- false splits + miss attribution by noise type ---------------------------
const noiseTypes = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
const noiseHistogram = Object.fromEntries([...noiseTypes, 'none'].map((k) => [k, 0]));
const comboHistogram = {};
let splitPairs = 0;
for (const indices of byPerson.values()) {
  const member = new Map(); // norm -> indices of this person
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

// --- B-cubed -----------------------------------------------------------------
let bP = 0;
let bR = 0;
for (let i = 0; i < mentions.length; i++) {
  const g = groups.get(indexOf.get(i));
  const same = g.indices.filter((j) => personOf(j) === personOf(i)).length;
  bP += same / g.indices.length;
  bR += same / byPerson.get(personOf(i)).length;
}
const bCubed = {
  precision: bP / mentions.length,
  recall: bR / mentions.length,
  f1: (2 * (bP / mentions.length) * (bR / mentions.length)) / ((bP / mentions.length) + (bR / mentions.length)),
};

// --- Q3 disambiguation -------------------------------------------------------
let q3Correct = 0;
const q3Questions = manifest.questions.filter((q) => q.stratum === 'Q3');
for (const q of q3Questions) {
  const merged = [...groups.values()].some((g) => g.persons.has(q.personId) && q.collisionWith && g.persons.has(q.collisionWith));
  if (!merged) q3Correct++;
}

// --- gate (spec §8.1) --------------------------------------------------------
const pairwise = {
  precision: tp / predictedPairs,
  recall: tp / truthPairs,
  f1: (2 * tp) / (predictedPairs + truthPairs),
  truthPositivePairs: truthPairs,
  predictedPositivePairs: predictedPairs,
  truePositivePairs: tp,
};
const gate = {
  recallBelow90: pairwise.recall < 0.9,
  atLeastOneFalseMerge: collisionFalseMerges >= 1,
  pass: pairwise.recall < 0.9 && collisionFalseMerges >= 1,
};
const results = {
  kind: 'noisy-estate-exact-match-baseline',
  version: manifest.version,
  seed: manifest.seed,
  estateSha256: manifest.estateSha256,
  normalization: 'lowercase + strip punctuation (non letter/number chars become spaces) + collapse whitespace; nothing else',
  clustering: 'transitive closure over identically normalized mention surfaces (name, email, phone, nickname, initials, stale-record, format variants); each mention is keyed by its single manifest surface',
  note: 'The floor Stage K5 must sit under. Miss attribution = noise types present across the two mentions of each false split (pairs may carry several). Q3 accuracy = share of collision questions where the closure does not merge the target with its collision twin; a false merge on a collision pair IS the Q3 miss mode.',
  counts: {
    people: manifest.world.people.length,
    mentions: mentions.length,
    documents: manifest.documents.length,
    stringGroups: groups.size,
  },
  pairwise,
  bCubed,
  falseMerges: {
    count: fp,
    rate: fp / predictedPairs,
    onCollisionPairs: collisionFalseMerges,
  },
  falseSplits: {
    count: splitPairs,
    rate: splitPairs / truthPairs,
    noiseHistogram,
    combinationHistogram: comboHistogram,
  },
  q3: {
    accuracy: q3Questions.length ? q3Correct / q3Questions.length : 0,
    correct: q3Correct,
    total: q3Questions.length,
  },
  gate,
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
  pairwise: { precision: pairwise.precision, recall: pairwise.recall, f1: pairwise.f1 },
  bCubed: results.bCubed,
  falseMerges: results.falseMerges,
  falseSplitRate: results.falseSplits.rate,
  q3: results.q3,
  gate,
  out: 'results/noisy-estate-baseline.json',
}));
