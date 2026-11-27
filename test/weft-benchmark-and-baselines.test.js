import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// W1 contract test: external behavior only. The runner is executed as a child
// process against a small deterministic estate; the tests read the artifact and
// never reach into model internals. Model-backed baselines are pointed at
// nonexistent ids so the suite passes without any downloaded model or GPU.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'run-weft-baseline-shootout.py');
const ARTIFACT = path.join(ROOT, 'results', 'weft-baselines.json');
const PYTHON = process.env.PYTHON || 'python';
const BASELINES = [
  'bm25',
  'model2vec_static_threshold',
  'minilm_l6_cosine',
  'bertopic_style',
  'local_llm_judge',
];
const BUCKETS = ['cross_department', 'cross_modality', 'identity_overlap', 'identity_disjoint'];
const SPLITS = ['leave_one_department_out', 'leave_one_modality_out'];
// Built from fragments so this compliance check does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'fir' + 'st'];

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDigest = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);

function assertMetricBlock(m, where) {
  assert.ok(m && typeof m === 'object', `${where} must be an object`);
  for (const key of ['precision', 'recall', 'f1']) {
    assert.ok(isNum(m[key]) && m[key] >= 0 && m[key] <= 1, `${where}.${key} must be a rate`);
  }
  for (const key of ['truePositivePairs', 'falsePositivePairs', 'falseNegativePairs', 'truthPositivePairs', 'predictedPositivePairs']) {
    assert.ok(Number.isInteger(m[key]) && m[key] >= 0, `${where}.${key} must be a non-negative integer`);
  }
}

function assertRateBlock(m, where) {
  assert.ok(m && typeof m === 'object', `${where} must be an object`);
  for (const key of ['precision', 'recall', 'f1']) {
    assert.ok(isNum(m[key]) && m[key] >= 0 && m[key] <= 1, `${where}.${key} must be a rate`);
  }
}

function assertRanBaseline(name, b, config) {
  assert.equal(b.status, 'ran', `${name} fixture status`);
  assert.equal(b.seed, config.seed, `${name} must record the run seed`);
  assert.equal(b.resamples, config.resamples, `${name} must record the resample count`);
  assert.ok(typeof b.license === 'string' && b.license.length > 0, `${name} must record a licence`);
  assert.ok(b.modelDigest === null || isDigest(b.modelDigest), `${name} model digest must be null or sha-256`);
  assert.ok(isNum(b.artifactBytes) && b.artifactBytes >= 0, `${name} artifact size`);
  assert.ok(isNum(b.artifactMB) && b.artifactMB >= 0, `${name} artifact MB`);
  assert.ok(isNum(b.latencyMsPerPair) && b.latencyMsPerPair >= 0, `${name} latency`);
  assert.ok(typeof b.thresholdSelection === 'string', `${name} threshold selection disclosed`);
  assertMetricBlock(b.pairwise, `${name}.pairwise`);
  assert.ok(b.falseMerge && Number.isInteger(b.falseMerge.count) && b.falseMerge.count >= 0, `${name}.falseMerge.count`);
  assert.ok(isNum(b.falseMerge.rate) && b.falseMerge.rate >= 0 && b.falseMerge.rate <= 1, `${name}.falseMerge.rate`);
  assert.ok(Array.isArray(b.abstainAtTargetError) && b.abstainAtTargetError.length === 2, `${name} abstain rows`);
  for (const row of b.abstainAtTargetError) {
    assert.ok(row.alpha === 0.05 || row.alpha === 0.10, `${name} abstain alpha`);
    assert.ok(isNum(row.coverage) && row.coverage >= 0 && row.coverage <= 1, `${name} abstain coverage`);
    assert.ok(isNum(row.achievedFalseMergeRate) && row.achievedFalseMergeRate <= row.alpha, `${name} abstain error bound`);
  }
  for (const bucket of BUCKETS) {
    assertMetricBlock(b.buckets[bucket], `${name}.buckets.${bucket}`);
  }
  for (const split of SPLITS) {
    assert.ok(b.splits[split] && typeof b.splits[split] === 'object', `${name}.splits.${split}`);
  }
  if (b.sampled) {
    assert.ok(Number.isInteger(b.evaluatedPairs) && b.evaluatedPairs > 0, `${name} sampled pair count`);
  } else {
    assertRateBlock(b.bCubed, `${name}.bCubed`);
    assertMetricBlock(b.conllStyle, `${name}.conllStyle`);
    assert.ok(b.blastRadius && Number.isInteger(b.blastRadius.maxThemesPerCluster), `${name}.blastRadius`);
  }
}

function runFixture(out, extra = []) {
  const args = [
    RUNNER,
    '--fixture',
    '--no-judge',
    '--seed', '20261127',
    '--resamples', '32',
    '--static-model', 'weft-nonexistent/static',
    '--minilm-model', 'weft-nonexistent/minilm',
    '--judge-model', 'weft-nonexistent/judge',
    '--out', out,
    ...extra,
  ];
  execFileSync(PYTHON, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

function entryOf(artifact) {
  return artifact.entries[artifact.entries.length - 1];
}

test('W1 contract: committed artifact is append-only and schema-complete', () => {
  assert.ok(fs.existsSync(ARTIFACT), 'results/weft-baselines.json must be committed');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.equal(artifact.kind, 'weft-baselines');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.appendOnly, true);
  assert.ok(Array.isArray(artifact.entries) && artifact.entries.length >= 1, 'at least one real run entry');

  const entry = artifact.entries[0];
  assert.equal(entry.harness.kind, 'weft-baseline-shootout');
  assert.equal(entry.harness.schemaVersion, 1);
  assert.ok(isDigest(entry.harness.scriptDigest), 'harness records its script digest');
  assert.ok(isDigest(entry.runId), 'entry records a run id');
  assert.equal(entry.estate.version, 'weft-synthetic-v1');
  assert.ok(Number.isInteger(entry.estate.seed), 'estate seed recorded');
  assert.ok(isDigest(entry.estate.estateSha256), 'estate digest recorded');
  assert.deepEqual(entry.config.alphas, [0.05, 0.1]);
  assert.deepEqual(entry.config.buckets, BUCKETS);
  assert.deepEqual(entry.config.splits, SPLITS);
  assert.ok(Number.isInteger(entry.config.resamples) && entry.config.resamples >= 0);

  assert.equal(entry.sources.synthetic.status, 'ran');
  const baselines = entry.sources.synthetic.baselines;
  assert.deepEqual(Object.keys(baselines).sort(), [...BASELINES].sort(), 'all five baselines recorded');

  for (const name of BASELINES) {
    const b = baselines[name];
    assert.ok(['ran', 'unavailable'].includes(b.status), `${name} typed status`);
    if (b.status === 'unavailable') {
      assert.ok(typeof b.unavailableReason === 'string' && b.unavailableReason.length > 0, `${name} typed reason`);
      assert.ok(typeof b.detail === 'string' && b.detail.length > 0, `${name} reason detail`);
      assert.equal(b.pairwise, undefined, `${name} must not invent metrics when unavailable`);
      assert.equal(b.seed, entry.config.seed, `${name} must still record the run seed`);
      assert.equal(b.resamples, entry.config.resamples, `${name} must still record the resample count`);
      continue;
    }
    assertRanBaseline(name, b, entry.config);
  }

  assert.ok(['ran', 'unavailable'].includes(entry.sources.public_cdcr.status));
  if (entry.sources.public_cdcr.status === 'unavailable') {
    assert.ok(typeof entry.sources.public_cdcr.unavailableReason === 'string');
  }

  const text = JSON.stringify(artifact).toLowerCase();
  for (const word of BANNED) assert.ok(!text.includes(word), `committed artifact must not contain a banned term`);
});

test('W1 contract: runner executes on the synthetic estate and the three buckets are observable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-contract-'));
  const out = path.join(dir, 'weft-baselines.json');
  const artifact = runFixture(out);
  const entry = entryOf(artifact);
  const synthetic = entry.sources.synthetic;

  assert.ok(synthetic.documents >= 24, 'fixture estate carries enough documents');
  assert.ok(synthetic.pairs > 0, 'pairwise evaluation set is non-empty');

  const bm25 = synthetic.baselines.bm25;
  assertRanBaseline('bm25', bm25, entry.config);

  // The three bucket families are observable behavior on the scored pairs.
  for (const bucket of BUCKETS) {
    const m = bm25.buckets[bucket];
    assert.ok(m.truthPositivePairs > 0, `${bucket} carries same-theme positives`);
  }
  assert.ok(
    bm25.buckets.cross_department.truthPositivePairs > 0 && bm25.buckets.cross_department.predictedPositivePairs > 0,
    'cross-department links are emitted'
  );
  assert.ok(
    bm25.buckets.cross_modality.truthPositivePairs > 0 && bm25.buckets.cross_modality.predictedPositivePairs > 0,
    'cross-modality links are emitted'
  );
  assert.equal(
    bm25.buckets.identity_overlap.truthPositivePairs + bm25.buckets.identity_disjoint.truthPositivePairs,
    bm25.pairwise.truthPositivePairs,
    'identity-overlap and identity-disjoint partition same-theme pairs'
  );
  assert.ok(bm25.buckets.identity_overlap.truthPositivePairs > 0, 'identity-overlap positives exist');
  assert.ok(bm25.buckets.identity_disjoint.truthPositivePairs > 0, 'identity-disjoint positives exist');

  // Leave-one-out splits are keyed by real estate values.
  assert.ok(Object.keys(bm25.splits.leave_one_department_out).length >= 2, 'leave-one-department-out split');
  assert.ok(Object.keys(bm25.splits.leave_one_modality_out).length >= 2, 'leave-one-modality-out split');

  // Fail-closed baselines: nonexistent model ids must be typed unavailable with no numbers.
  for (const name of ['model2vec_static_threshold', 'minilm_l6_cosine']) {
    const b = synthetic.baselines[name];
    assert.equal(b.status, 'unavailable', `${name} fails closed without local weights`);
    assert.equal(b.unavailableReason, 'model_weights_not_local', `${name} typed reason`);
    assert.equal(b.pairwise, undefined);
  }
  assert.equal(synthetic.baselines.local_llm_judge.status, 'unavailable');
  assert.equal(synthetic.baselines.local_llm_judge.unavailableReason, 'disabled_by_flag');
  assert.ok(
    synthetic.baselines.bertopic_style.status === 'ran' ||
      typeof synthetic.baselines.bertopic_style.unavailableReason === 'string',
    'BERTopic-style baseline is ran or typed unavailable'
  );
  assert.ok(entry.sources.public_cdcr.status === 'unavailable' || entry.sources.public_cdcr.status === 'ran');
  if (entry.sources.public_cdcr.status === 'unavailable') {
    assert.ok(typeof entry.sources.public_cdcr.unavailableReason === 'string');
  }

  for (const word of BANNED) {
    assert.ok(!JSON.stringify(artifact).toLowerCase().includes(word), 'generated artifact must not contain a banned term');
  }
});

test('W1 contract: artifact is append-only across runs and prior entries are untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-append-'));
  const out = path.join(dir, 'weft-baselines.json');
  const one = runFixture(out);
  assert.equal(one.entries.length, 1);
  const original = JSON.stringify(one.entries[0]);

  const two = runFixture(out);
  assert.equal(two.entries.length, 2, 'a second run appends');
  assert.equal(JSON.stringify(two.entries[0]), original, 'the prior entry is preserved byte-for-byte');
  assert.notEqual(two.entries[1].runId, two.entries[0].runId, 'each run has its own id');
});
