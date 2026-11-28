import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// W5 contract test: external behavior only. The exporter is executed as a child process.
// No torch, no downloaded weights, and no QAT run are required: the fail-closed path is
// exercised with the weights absent, and plan/notebook emission must be complete without a
// runtime. The latency ledger is append-only and tolerated as not-yet-present.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'export-weft-quantized.py');
const LEDGER = path.join(ROOT, 'results', 'weft-export-latency.json');
const TRAIN = path.join(ROOT, 'results', 'weft-training-pairs-fullscale-live-v4', 'train.jsonl');
const EVAL = path.join(ROOT, 'results', 'weft-training-pairs-fullscale-live-v4', 'eval.jsonl');
const PYTHON = process.env.PYTHON || 'python';
// Built from fragments so this compliance check does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'fir' + 'st'];

const isDigest = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const lineCount = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).length;

function lfDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
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

test('W5 1: absent weights fail closed with a typed error and write nothing', () => {
  assert.ok(fs.existsSync(SCRIPT), 'the exporter must exist');
  const before = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER) : null;
  // The fail-closed path needs weights to be ABSENT: local machines can carry the real
  // W4-v4 weights in models/weft-specialist, so point the exporter at a missing dir.
  const result = runScript(['--model-dir', path.join(ROOT, 'models', 'weft-specialist-absent-w5-failclosed')]);
  assert.equal(result.status, 2, `typed failure must exit nonzero, got ${result.status}`);
  const error = lastJsonLine(result.stderr);
  assert.equal(error.error, 'WEFT_WEIGHTS_MISSING');
  const after = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER) : null;
  assert.deepEqual(after, before, 'a fail-closed run must not create or alter the ledger');
});

test('W5 2: plan mode records the W5 recipe and honest data digests without torch', () => {
  const result = runScript(['--mode', 'plan']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.kind, 'weft-export-plan');
  assert.equal(plan.ticket, 'W5');
  assert.deepEqual(plan.bitWidths, [2, 3, 4]);
  assert.equal(plan.seed, 20261127);
  for (const key of ['headLr', 'epochs', 'calibFrac', 'alphas', 'delta', 'modelDir', 'outLedger']) {
    assert.ok(plan[key] !== undefined, `plan must record ${key}`);
  }
  assert.equal(typeof plan.weightsPresent, 'boolean');
  const modelsDir = path.join(ROOT, 'models', 'weft-specialist');
  const weightDigests = Object.entries(plan).filter(([key, value]) => isDigest(value) && !/^(train|eval)Sha256$/.test(key));
  if (fs.existsSync(modelsDir)) {
    assert.equal(plan.weightsPresent, true, 'an existing models/weft-specialist is recorded as present');
    assert.ok(weightDigests.length > 0, 'present weights must carry a 64-hex model digest');
  } else {
    assert.equal(plan.weightsPresent, false, 'absent weights are recorded as absent, never invented');
    assert.equal(weightDigests.length, 0, 'absent weights must not carry an invented digest');
  }
  if (fs.existsSync(TRAIN)) {
    assert.equal(plan.trainSha256, lfDigest(TRAIN), 'the LF-normalized training digest is pinned');
    assert.equal(plan.trainRows, lineCount(TRAIN), 'the training row count matches the jsonl');
  }
  if (fs.existsSync(EVAL)) {
    assert.equal(plan.evalSha256, lfDigest(EVAL), 'the LF-normalized eval digest is pinned');
    assert.equal(plan.evalRows, lineCount(EVAL), 'the eval row count matches the jsonl');
  }
});

test('W5 3: the Kaggle notebook is a 2x T4 fail-closed recipe', () => {
  const result = runScript(['--emit-kaggle-notebook']);
  assert.equal(result.status, 0, result.stderr);
  const notebook = JSON.parse(result.stdout);
  assert.equal(notebook.nbformat, 4);
  assert.ok(Array.isArray(notebook.cells) && notebook.cells.length >= 2);
  assert.equal(notebook.metadata.kaggle.gpuCount, 2);
  const source = notebook.cells.map((c) => [].concat(c.source).join('')).join('\n');
  assert.match(source, /T4/, 'the recipe names the 2x T4 runtime');
  assert.match(source, /export-weft-quantized\.py --device cuda/, 'Kaggle is where the exporter executes');
  assert.match(source, /fail.closed/i, 'local scripts stay fail-closed');
});

test('W5 4: the export ledger, once present, is an append-only W5 ledger', () => {
  if (!fs.existsSync(LEDGER)) return; // the ledger lands with an early GPU run; absence is honest.
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  assert.equal(ledger.kind, 'weft-export-latency');
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.appendOnly, true);
  assert.ok(Array.isArray(ledger.entries) && ledger.entries.length >= 1);
  for (const entry of ledger.entries) {
    assert.ok(isDigest(entry.runId), 'every entry records a sha-256 runId');
    assert.equal(entry.ticket, 'W5');
    assert.ok([2, 3, 4, 8].includes(entry.bitWidth) && Number.isInteger(entry.bitWidth), 'bit width is an exporter level');
    assert.equal(typeof entry.status, 'string');
    assert.ok(entry.artifact && typeof entry.artifact === 'object', 'every entry records the artifact');
    if (entry.artifact.path) assert.ok(isDigest(entry.artifact.sha256), 'a recorded artifact path needs a sha-256');
    assert.ok(entry.latency && typeof entry.latency.device === 'string', 'every entry records the measured device');
    assert.ok(!JSON.stringify(entry).includes('"TODO"'), 'the ledger is an honest record');
  }
});

test('W5 5: banned-word sweep over the new script, test, and ledger', (t) => {
  const sweep = (files) => {
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8').toLowerCase();
      for (const word of BANNED) assert.ok(!text.includes(word), `${path.basename(file)} must not contain a banned term`);
    }
  };
  // The test file and ledger are swept even while the exporter is still being written.
  sweep([fileURLToPath(import.meta.url), LEDGER].filter((file) => fs.existsSync(file)));
  if (!fs.existsSync(SCRIPT)) return t.skip('the parallel exporter has not landed yet');
  sweep([SCRIPT]);
});
