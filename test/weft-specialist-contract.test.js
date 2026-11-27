import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// W3 contract test: external behavior only. The trainer is executed as a child process.
// No GPU, no downloaded weights, and no training run are required: the fail-closed path is
// exercised with CUDA hidden, and the committed artifact is schema-checked. The Kaggle
// notebook recipe and the plan output must be complete without a runtime.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'train-weft-specialist.py');
const ARTIFACT = path.join(ROOT, 'results', 'weft-specialist-training.json');
const TRAIN = path.join(ROOT, 'results', 'weft-training-pairs', 'train.jsonl');
const RECEIPT = path.join(ROOT, 'results', 'weft-training-pairs', 'receipt.json');
const FULLSCALE_TRAIN = path.join(ROOT, 'results', 'weft-training-pairs-fullscale-live-v2', 'train.jsonl');
const FULLSCALE_RECEIPT = path.join(ROOT, 'results', 'weft-training-pairs-fullscale-live-v2', 'receipt.json');
const PYTHON = process.env.PYTHON || 'python';
const BUCKETS = ['cross_department', 'cross_modality', 'identity_overlap', 'identity_disjoint'];
// Built from fragments so this compliance check does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'fir' + 'st'];

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDigest = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);

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
    assert.ok(isNum(m[key]) && m[key] >= 0 && m[key] <= 1, `${where}.${key} must be a rate`);
  }
  for (const key of ['truePositivePairs', 'falsePositivePairs', 'falseNegativePairs', 'truthPositivePairs', 'predictedPositivePairs']) {
    assert.ok(Number.isInteger(m[key]) && m[key] >= 0, `${where}.${key} must be a non-negative integer`);
  }
}

test('W3 1: runtime absent fails closed with a typed error and writes nothing', () => {
  assert.ok(fs.existsSync(SCRIPT), 'the trainer must exist');
  const before = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT) : null;
  const result = runScript(['--device', 'cuda'], { CUDA_VISIBLE_DEVICES: '' });
  assert.equal(result.status, 2, `typed failure must exit nonzero, got ${result.status}`);
  const error = lastJsonLine(result.stderr);
  assert.equal(error.error, 'WEFT_TRAINING_RUNTIME_UNAVAILABLE');
  assert.match(error.detail, /CUDA/i);
  const after = fs.existsSync(ARTIFACT) ? fs.readFileSync(ARTIFACT) : null;
  assert.deepEqual(after, before, 'a fail-closed run must not append or alter the artifact');
});

test('W3 2: plan mode records seeds, base licence/digest, and the training-data digest without a runtime', () => {
  const result = runScript(['--mode', 'plan']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.kind, 'weft-specialist-plan');
  assert.equal(plan.ticket, 'W3');
  assert.ok(Number.isInteger(plan.seeds.run));
  assert.equal(plan.baseEncoder.modelId, 'sentence-transformers/all-MiniLM-L6-v2');
  assert.equal(plan.baseEncoder.license, 'Apache-2.0');
  assert.equal(typeof plan.baseEncoder.localWeights, 'boolean');
  if (plan.baseEncoder.localWeights) {
    assert.ok(isDigest(plan.baseEncoder.digest), 'the base-encoder digest must be sha-256');
  } else {
    assert.equal(plan.baseEncoder.digest, null, 'an absent cache is recorded as absent, never invented');
  }
  assert.equal(plan.trainingData.trainSha256, lfDigest(TRAIN), 'the LF-normalized training digest is pinned');
  assert.equal(plan.trainingData.trainSha256, JSON.parse(fs.readFileSync(RECEIPT, 'utf8')).trainJsonlSha256,
    'the trainer pins the same digest as the W2 receipt');
  assert.ok(Number.isInteger(plan.trainingData.pairCount) && plan.trainingData.pairCount > 0);
  for (const key of ['epochs', 'batchSize', 'learningRateBase', 'temperature', 'hardNegativeTopK',
    'hubPower', 'lossWeights', 'themeDim', 'architecture', 'excludedByTicket']) {
    assert.ok(plan.hyperparameters[key] !== undefined, `plan must record hyperparameter ${key}`);
  }
  assert.match(plan.deviceRequirement, /CUDA/);
});

test('W3 3: Kaggle recipe is a 2x T4 notebook with the founder guardrails', () => {
  const result = runScript(['--emit-kaggle-notebook']);
  assert.equal(result.status, 0, result.stderr);
  const notebook = JSON.parse(result.stdout);
  assert.equal(notebook.nbformat, 4);
  assert.ok(Array.isArray(notebook.cells) && notebook.cells.length >= 2);
  assert.equal(notebook.metadata.kaggle.gpuCount, 2);
  const source = notebook.cells.map((c) => [].concat(c.source).join('')).join('\n');
  assert.match(source, /T4/, 'the recipe names the 2x T4 runtime');
  assert.match(source, /public\/synthetic/, 'training data there is public/synthetic only');
  assert.match(source, /fail.closed/i, 'local scripts stay fail-closed');
  assert.match(source, /train-weft-specialist\.py --device cuda/, 'Kaggle is where the script executes');
});

test('W3 4: committed artifact schema — seeds, digests, licences, hyperparameters, evaluation', () => {
  assert.ok(fs.existsSync(ARTIFACT), 'results/weft-specialist-training.json must be committed');
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.equal(artifact.kind, 'weft-specialist-training');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.appendOnly, true);
  assert.ok(Array.isArray(artifact.entries) && artifact.entries.length >= 1);

  assert.equal(artifact.entries[0].ticket, 'W3', 'the W3 fixture entry must keep its place in the append-only prefix');
  assert.equal(artifact.entries[1].ticket, 'W4', 'the W4 live entry must keep its place in the append-only prefix');

  const entry = artifact.entries[artifact.entries.length - 1];
  assert.ok(isDigest(entry.runId));
  assert.equal(entry.ticket, 'W4-frz', 'the newest entry is the W4-frz frozen-base run');
  assert.equal(entry.status, 'ran');
  assert.ok(entry.createdAt && !Number.isNaN(Date.parse(entry.createdAt)));

  for (const key of ['python', 'numpy', 'torch', 'evaluation', 'resampleSeed']) {
    assert.ok(Number.isInteger(entry.seeds[key]), `entry must record the ${key} seed`);
  }

  const base = entry.baseEncoder;
  assert.equal(base.modelId, 'sentence-transformers/all-MiniLM-L6-v2');
  assert.equal(base.license, 'Apache-2.0');
  assert.ok(isDigest(base.digest), 'base-encoder digest');
  assert.match(base.licenseVerifiedFrom, /weft-baselines/);
  assert.ok(Number.isInteger(base.parameterCount) && base.parameterCount >= 20e6 && base.parameterCount <= 35e6,
    `specialist must be ~20-35M parameters, got ${base.parameterCount}`);
  assert.match(base.initialization, /never from scratch/);

  const data = entry.trainingData;
  assert.equal(data.trainSha256, lfDigest(FULLSCALE_TRAIN), 'training-data digest matches the committed full-scale pairs');
  assert.equal(data.trainSha256, JSON.parse(fs.readFileSync(FULLSCALE_RECEIPT, 'utf8')).trainJsonlSha256);
  assert.ok(isDigest(data.receiptSha256));
  assert.ok(Number.isInteger(data.pairCount) && data.pairCount > 0);

  for (const key of ['epochs', 'batchSize', 'learningRateBase', 'learningRateHeads', 'optimizer', 'temperature',
    'positiveWeight', 'hardNegativeTopK', 'hubPower', 'lossWeights', 'themeDim', 'anchorSetMax', 'excludedByTicket']) {
    assert.ok(entry.hyperparameters[key] !== undefined, `hyperparameters.${key} is required`);
  }
  assert.equal(entry.hyperparameters.optimizer, 'AdamW');
  assert.equal(entry.hyperparameters.anchorSetMax, 4, 'the anchor-set interface is recorded');
  assert.match(entry.hyperparameters.excludedByTicket, /adversary/);
  assert.match(entry.hyperparameters.excludedByTicket, /triangle/);

  const env = entry.environment;
  assert.ok(env.device === 'cpu' || env.device === 'cuda');
  assert.equal(typeof env.cudaAvailable, 'boolean');
  assert.ok(env.torch && env.transformers && env.python && env.platform, 'framework environment recorded');
  assert.ok(typeof env.computeDisclosure === 'string' && env.computeDisclosure.length > 0,
    'the compute scale must be disclosed next to the numbers');
  if (env.device === 'cpu') assert.match(env.computeDisclosure, /CPU/);

  const training = entry.training;
  assert.ok(Number.isInteger(training.epochsRun) && training.epochsRun > 0);
  assert.ok(Array.isArray(training.lossHistory) && training.lossHistory.length === training.epochsRun);
  for (const row of training.lossHistory) assert.ok(isNum(row.loss), 'every epoch must log a finite loss');
  assert.ok(isNum(training.wallSeconds) && training.wallSeconds >= 0);

  const evaluation = entry.evaluation;
  assert.ok(isDigest(evaluation.harness.scriptDigest), 'the W1 harness digest is recorded');
  assert.equal(evaluation.harness.estateVersion, 'weft-synthetic-v1');
  assert.equal(evaluation.harness.estateSeed, entry.seeds.evaluation);
  assert.ok(isDigest(evaluation.harness.estateSha256));
  assert.ok(Number.isInteger(evaluation.harness.pairs) && evaluation.harness.pairs > 0);

  for (const bucket of BUCKETS) assertMetricBlock(evaluation.specialist.buckets[bucket], `specialist.buckets.${bucket}`);
  assertMetricBlock(evaluation.specialist.identityDisjointCrossDepartment, 'specialist.identityDisjointCrossDepartment');
  assert.ok(Number.isInteger(evaluation.specialist.identityDisjointCrossDepartmentPairs));

  const competitor = evaluation.staticBaseline;
  assert.equal(competitor.modelId, 'minishlab/potion-base-32M');
  assert.equal(competitor.license, 'MIT');
  assert.ok(isDigest(competitor.modelDigest));
  assertMetricBlock(competitor.identityDisjoint, 'staticBaseline.identityDisjoint');
  assertMetricBlock(competitor.identityDisjointCrossDepartment, 'staticBaseline.identityDisjointCrossDepartment');

  const gate = evaluation.gate;
  assert.equal(gate.metric, 'identity_disjoint_cross_department_pairwise_f1');
  assert.ok(isNum(gate.specialist) && isNum(gate.baseline) && isNum(gate.delta));
  assert.ok(Math.abs(gate.delta - (gate.specialist - gate.baseline)) < 1e-12, 'delta is the honest difference');
  if (gate.delta > 0) {
    assert.equal(gate.status, 'beats_baseline');
  } else {
    assert.equal(gate.status, 'at_risk_negative_result', 'a non-positive delta must mark the release gate at risk');
  }
  assert.match(gate.releaseGate, /story 36/);

  const ptr = evaluation.evidencePointersSample;
  assert.equal(ptr.side, 'candidate');
  assert.ok(Array.isArray(ptr.spans) && ptr.spans.length > 0, 'extractive evidence pointers must be observable');
  for (const span of ptr.spans) {
    assert.ok(Number.isInteger(span.start) && Number.isInteger(span.end) && span.end > span.start, 'span offsets');
    assert.equal(typeof span.text, 'string');
  }
});

test('W3 5: model artifact stays outside vendor/ and its digest/size match the committed bytes', () => {
  const entry = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).entries.at(-1);
  const artifact = entry.artifact;
  assert.ok(typeof artifact.path === 'string' && artifact.path.length > 0);
  assert.ok(!artifact.path.replace(/\\/g, '/').startsWith('vendor/'), 'model weights must not enter vendor/');
  assert.match(artifact.path, /^models\//, 'the un-quantized model lives in models/');
  assert.ok(Number.isInteger(artifact.bytes) && artifact.bytes > 0);
  assert.ok(isDigest(artifact.sha256));
  assert.equal(artifact.unquantized, true);
  assert.ok(Number.isInteger(artifact.fileCount) && artifact.fileCount > 0);

  const dir = path.join(ROOT, artifact.path);
  if (fs.existsSync(dir)) {
    const files = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(dir);
    const hash = crypto.createHash('sha256');
    for (const file of files.sort()) {
      hash.update(path.basename(file));
      hash.update('\u0000');
      hash.update(fs.readFileSync(file));
      hash.update('\u0000');
    }
    assert.equal(artifact.sha256, hash.digest('hex'), 'artifact digest must match the saved model bytes');
    assert.equal(artifact.bytes, files.reduce((n, f) => n + fs.statSync(f).size, 0));
  }
});

test('W3 6: the harness digest matches the checked-in W1 script when present', () => {
  const harness = path.join(ROOT, 'scripts', 'run-weft-baseline-shootout.py');
  if (!fs.existsSync(harness)) return; // W1 lands in a sibling ticket; the recorded digest is still validated as sha-256.
  const entry = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).entries.at(-1);
  // Accept the LF-normalized digest too: a CRLF checkout must not fail the content check.
  assert.ok([rawDigest(harness), lfDigest(harness)].includes(entry.evaluation.harness.scriptDigest),
    'evaluation must record the digest of the W1 harness actually used');
});

test('W3 7: banned-word sweep over the new script, test, and artifact', () => {
  for (const file of [SCRIPT, fileURLToPath(import.meta.url), ARTIFACT]) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const word of BANNED) assert.ok(!text.includes(word), `${path.basename(file)} must not contain a banned term`);
  }
});
