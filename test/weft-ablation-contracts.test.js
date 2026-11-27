import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// W4 contract test: external behavior only. The ablation runner is executed as a
// child process. No GPU, no downloads, and no training run are required: the
// fail-closed path is exercised with CUDA hidden, the committed artifact is
// schema-checked, and the append-only writer is exercised on a temp artifact.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-weft-ablations.py');
const ARTIFACT = path.join(ROOT, 'results', 'weft-ablations.json');
const W3_ARTIFACT = path.join(ROOT, 'results', 'weft-specialist-training.json');
const TRAIN = path.join(ROOT, 'results', 'weft-training-pairs', 'train.jsonl');
const RECEIPT = path.join(ROOT, 'results', 'weft-training-pairs', 'receipt.json');
const HARNESS = path.join(ROOT, 'scripts', 'run-weft-baseline-shootout.py');
const PYTHON = process.env.PYTHON || 'python';
const STAGES = ['bare', 'adversary', 'set-conditioning', 'triangle', 'modality'];
const EXTRAS = ['adversary', 'set-conditioning', 'triangle', 'modality'];
// Built from fragments so this compliance check does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'fir' + 'st'];
const REMOVED_WORDING = ['identity', 'removed'].join('-');

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDigest = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const inRate = (x) => isNum(x) && x >= 0 && x <= 1;

function lfDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function rawDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runScript(args, env = {}) {
  return spawnSync(PYTHON, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function lastJsonLine(text) {
  const line = String(text).trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}

function assertMetricBlock(m, where) {
  assert.ok(m && typeof m === 'object', `${where} must be an object`);
  for (const key of ['precision', 'recall', 'f1']) {
    assert.ok(inRate(m[key]), `${where}.${key} must be a rate`);
  }
  for (const key of ['truePositivePairs', 'falsePositivePairs', 'falseNegativePairs', 'truthPositivePairs', 'predictedPositivePairs']) {
    assert.ok(Number.isInteger(m[key]) && m[key] >= 0, `${where}.${key} must be a non-negative integer`);
  }
}

function expectedExtras(stage) {
  if (stage === 'bare') return [];
  return [stage];
}

test('W4 1: runtime absent fails closed with a typed error and writes nothing', () => {
  assert.ok(fs.existsSync(SCRIPT), 'the ablation runner must exist');
  const before = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT) : null;
  const result = runScript(['--device', 'cuda'], { CUDA_VISIBLE_DEVICES: '' });
  assert.equal(result.status, 2, `typed failure must exit nonzero, got ${result.status}`);
  const error = lastJsonLine(result.stderr);
  assert.equal(error.error, 'WEFT_ABLATION_RUNTIME_UNAVAILABLE');
  assert.match(error.detail, /CUDA/i);
  const after = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT) : null;
  assert.deepEqual(after, before, 'a fail-closed run must not append or alter the artifact');
});

test('W4 2: plan mode records stages, extras, seeds, and the W3 baseline without a runtime', () => {
  const result = runScript(['--mode', 'plan']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.kind, 'weft-ablations-plan');
  assert.equal(plan.ticket, 'W4');
  assert.ok(Number.isInteger(plan.seeds.run));
  assert.deepEqual(plan.stages.map((s) => s.stage), STAGES, 'the six stages are planned');
  for (const stage of plan.stages) {
    assert.deepEqual(stage.extras, expectedExtras(stage.stage), `${stage.stage} extras are explicit`);
  }
  assert.equal(plan.baseline.metric, 'identity_disjoint_cross_department_pairwise_f1');
  assert.ok(inRate(plan.baseline.f1), 'the W3 bare baseline F1 is recorded');
  assert.equal(plan.baseline.artifact, 'results/weft-specialist-training.json');
  assert.ok(Number.isInteger(plan.baseline.harness.estateSeed));
  assert.equal(plan.trainingData.trainSha256, lfDigest(TRAIN), 'the LF-normalized training digest is pinned');
  assert.equal(plan.trainingData.trainSha256, JSON.parse(fs.readFileSync(RECEIPT, 'utf8')).trainJsonlSha256);
  assert.ok(Number.isInteger(plan.trainingData.pairCount) && plan.trainingData.pairCount > 0);
  assert.equal(plan.identitySuppression.wording, 'identity-blind');
  assert.match(plan.identitySuppression.caveat, /Elazar & Goldberg/);
  assert.match(plan.deviceRequirement, /CUDA/);
});

test('W4 3: committed artifact — one entry per stage, honest deltas, probe battery, decision evidence', () => {
  assert.ok(fs.existsSync(ARTIFACT), 'results/weft-ablations.json must be committed');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.equal(artifact.kind, 'weft-ablations');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.appendOnly, true);
  assert.ok(Array.isArray(artifact.entries) && artifact.entries.length >= STAGES.length);
  assert.equal(new Set(artifact.entries.map((e) => e.runId)).size, artifact.entries.length,
    'run ids are unique across appended entries');

  const w3 = JSON.parse(fs.readFileSync(W3_ARTIFACT, 'utf8')).entries.find((e) => e.ticket === 'W3');
  const baselineF1 = w3.evaluation.specialist.identityDisjointCrossDepartment.f1;
  const receipt = JSON.parse(fs.readFileSync(RECEIPT, 'utf8'));

  for (const stage of STAGES) {
    const matches = artifact.entries.filter((e) => e.stage === stage);
    assert.ok(matches.length >= 1, `stage ${stage} must have a recorded entry`);
    const entry = matches.at(-1);
    assert.ok(isDigest(entry.runId));
    assert.equal(entry.ticket, 'W4');
    assert.equal(entry.status, 'ran');
    assert.ok(entry.createdAt && !Number.isNaN(Date.parse(entry.createdAt)));
    assert.deepEqual(entry.extras, expectedExtras(stage), `${stage} carries only its own extra`);

    for (const key of ['python', 'numpy', 'torch', 'evaluation', 'resampleSeed', 'probe']) {
      assert.ok(Number.isInteger(entry.seeds[key]), `entry must record the ${key} seed`);
    }

    const base = entry.baseEncoder;
    assert.equal(base.modelId, 'sentence-transformers/all-MiniLM-L6-v2');
    assert.equal(base.license, 'Apache-2.0');
    assert.ok(isDigest(base.digest));
    assert.match(base.licenseVerifiedFrom, /weft-baselines/);
    assert.ok(Number.isInteger(base.parameterCount) && base.parameterCount >= 20e6 && base.parameterCount <= 25e6,
      `${stage} specialist parameter count is ~23M, got ${base.parameterCount}`);

    const data = entry.trainingData;
    assert.equal(data.trainSha256, lfDigest(TRAIN));
    assert.equal(data.trainSha256, receipt.trainJsonlSha256);
    assert.equal(data.licenceTrace.baseEncoder, 'Apache-2.0');
    assert.equal(data.licenceTrace.usedSources['synthetic-estate'], 'green');

    assert.deepEqual(entry.hyperparameters.extrasEnabled, expectedExtras(stage), `${stage} hyperparameters name only its extra`);
    for (const extra of EXTRAS) {
      const key = { adversary: 'adversary', 'set-conditioning': 'setConditioning', triangle: 'triangle', modality: 'modality' }[extra];
      if (entry.extras.includes(extra)) {
        assert.ok(entry.hyperparameters.extraWeights[key] > 0, `${stage} enables the ${extra} weight`);
      } else {
        assert.equal(entry.hyperparameters.extraWeights[key], 0, `${stage} leaves the ${extra} weight at zero`);
      }
    }

    const env = entry.environment;
    assert.equal(env.device, 'cpu', 'the committed artifact is the fixture-scale CPU run');
    assert.ok(typeof env.computeDisclosure === 'string' && /CPU/.test(env.computeDisclosure)
      && /fixture/.test(env.computeDisclosure), 'the compute scale must be disclosed next to the numbers');

    const training = entry.training;
    assert.ok(Number.isInteger(training.epochsRun) && training.epochsRun > 0);
    assert.equal(training.lossHistory.length, training.epochsRun);
    for (const row of training.lossHistory) assert.ok(isNum(row.loss), 'every epoch logs a finite loss');

    const evaluation = entry.evaluation;
    assert.equal(evaluation.harness.estateVersion, 'weft-synthetic-v1');
    assert.equal(evaluation.harness.estateSeed, entry.seeds.evaluation);
    assert.ok(isDigest(evaluation.harness.estateSha256));
    assert.ok(Number.isInteger(evaluation.harness.pairs) && evaluation.harness.pairs > 0);
    assertMetricBlock(evaluation.specialist.identityDisjointCrossDepartment,
      `${stage}.specialist.identityDisjointCrossDepartment`);

    const delta = evaluation.deltaVsW3Bare;
    assert.equal(delta.metric, 'identity_disjoint_cross_department_pairwise_f1');
    assert.equal(delta.baseline.f1, baselineF1, 'the delta is measured against the committed W3 bare specialist');
    assert.equal(delta.stageF1, evaluation.specialist.identityDisjointCrossDepartment.f1);
    assert.ok(Math.abs(delta.delta - (delta.stageF1 - delta.baseline.f1)) < 1e-12,
      'the delta is the honest difference');
    if (delta.delta > 0) assert.equal(delta.status, 'positive');
    else if (delta.delta < 0) assert.equal(delta.status, 'negative');
    else assert.equal(delta.status, 'zero');
    if (stage === 'bare') {
      assert.ok(Math.abs(delta.delta) < 1e-12, 'the retrained bare stage reproduces the W3 bare specialist');
    }

    const battery = entry.probeBattery;
    assert.ok(battery.target && battery.target.length > 0);
    assert.ok(Number.isInteger(battery.classes) && battery.classes > 1);
    assert.ok(Number.isInteger(battery.documents) && battery.documents > 0);
    assert.ok(inRate(battery.chanceAccuracy) && battery.chanceAccuracy > 0);
    assert.ok(inRate(battery.majorityBaseline));
    assert.ok(inRate(battery.linear.testAccuracy), 'the linear post-hoc probe reports accuracy');
    assert.ok(inRate(battery.nonlinearMlp.testAccuracy), 'H2 requires a nonlinear post-hoc probe');
    assert.ok(Number.isInteger(battery.nonlinearMlp.hidden) && battery.nonlinearMlp.hidden > 0);
    assert.match(battery.wording, /identity-blind/);
    assert.ok(!JSON.stringify(battery).toLowerCase().includes(REMOVED_WORDING));

    const suppression = entry.identitySuppression;
    assert.equal(suppression.wording, 'identity-blind');
    assert.match(suppression.h2Metric, /post-hoc/i);
    assert.match(suppression.caveat, /Elazar & Goldberg/);
    const adversary = suppression.inTrainingAdversary;
    assert.equal(adversary.enabled, entry.extras.includes('adversary'), 'the GRL adversary is recorded per stage');
    if (adversary.enabled) {
      assert.equal(adversary.accuracyHistory.length, training.epochsRun, 'the adversary records its training accuracy');
      assert.ok(inRate(adversary.finalAccuracy));
    } else {
      assert.equal(adversary.accuracyHistory.length, 0);
      assert.equal(adversary.finalAccuracy, null);
    }
    const inlp = suppression.postHocInlp;
    assert.equal(inlp.enabled, true, 'the INLP post-hoc option is recorded for the founder decision');
    for (const key of ['probeAccuracyBefore', 'probeAccuracyAfter']) {
      assert.ok(inRate(inlp[key].linear) && inRate(inlp[key].nonlinearMlp), `INLP ${key} probe accuracies`);
    }
    assert.ok(inRate(inlp.linkF1Before) && inRate(inlp.linkF1After), 'INLP link-F1 retention is measured');
    assert.ok(Array.isArray(inlp.iterationsOnTheme) && Array.isArray(inlp.iterationsOnPooled));
    for (const row of [...inlp.iterationsOnTheme, ...inlp.iterationsOnPooled]) {
      assert.ok(Number.isInteger(row.iteration) && Number.isInteger(row.removedDirections) && row.removedDirections > 0);
      assert.ok(inRate(row.linearProbeAccuracy) && inRate(row.nonlinearProbeAccuracy));
    }
    assert.match(suppression.founderDecision, /pending/i);
  }
});

test('W4 4: append-only writer appends and refuses incompatible artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-abl-'));
  const out = path.join(dir, 'artifact.json');
  const initial = runScript(['--mode', 'append-probe', '--out', out]);
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(JSON.parse(initial.stdout).entries, 1);
  const initialEntry = JSON.parse(fs.readFileSync(out, 'utf8')).entries[0];

  const second = runScript(['--mode', 'append-probe', '--out', out]);
  assert.equal(second.status, 0, second.stderr);
  const artifact = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(artifact.appendOnly, true);
  assert.equal(artifact.entries.length, 2, 'a second run appends rather than overwrites');
  assert.deepEqual(artifact.entries[0], initialEntry, 'the prior entry is preserved byte-for-byte');

  const bad = path.join(dir, 'incompatible.json');
  fs.writeFileSync(bad, JSON.stringify({ kind: 'not-weft-ablations', appendOnly: true, entries: [] }));
  const before = fs.readFileSync(bad);
  const refused = runScript(['--mode', 'append-probe', '--out', bad]);
  assert.equal(refused.status, 2);
  assert.equal(lastJsonLine(refused.stderr).error, 'WEFT_ABLATION_ARTIFACT_INCOMPATIBLE');
  assert.deepEqual(fs.readFileSync(bad), before, 'an incompatible artifact is left untouched');
});

test('W4 5: harness digest matches the checked-in W1 script for every stage', () => {
  if (!fs.existsSync(HARNESS)) return; // W1 lands in a sibling ticket; the artifact is still schema-checked.
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const accepted = [rawDigest(HARNESS), lfDigest(HARNESS)];
  for (const entry of artifact.entries) {
    assert.ok(accepted.includes(entry.evaluation.harness.scriptDigest),
      `stage ${entry.stage} records the digest of the W1 harness actually used`);
  }
});

test('W4 6: banned-word sweep over the runner, test, and artifact', () => {
  for (const file of [SCRIPT, fileURLToPath(import.meta.url), ARTIFACT]) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const word of BANNED) {
      assert.ok(!text.includes(word), `${path.basename(file)} must not contain a banned term`);
    }
    assert.ok(!text.includes(REMOVED_WORDING), `${path.basename(file)} uses identity-blind wording only`);
  }
});
