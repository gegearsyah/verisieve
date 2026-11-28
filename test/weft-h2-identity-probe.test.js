import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// H2 identity-blindness probe (issue #60) contract test, external behavior only:
// the probe script runs as a child process. The dependency-light self test
// exercises the ledger contract (content-addressed runId, append-only, temp
// file plus atomic rename, idempotence), the chance-baseline honesty block,
// and the fixed probe-family reporting, without torch models, ONNX
// artifacts, or the HF cache. The real-artifact assertion is skipped
// honestly, with a console note, on a checkout without the shipped
// quantized artifacts, because the weights are gitignored by standing rule.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-weft-h2-identity-probe.py');
const LEDGER = path.join(ROOT, 'results', 'weft-h2-identity-probe.json');
const NOTE = path.join(ROOT, 'docs', 'research-notes', '2026-11-28-h2-identity-probe.md');
const MODEL_CARD = path.join(ROOT, 'release', 'weft-specialist-v1', 'MODEL_CARD.md');
const MANIFEST = path.join(ROOT, 'release', 'weft-specialist-v1', 'RELEASE-MANIFEST.json');
const PYTHON = process.env.PYTHON || 'python';
// Built from fragments so this compliance check does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'identity-' + 'removed',
  'perceive' + ' everything', 'atomic' + ' knowledge'];

function runScript(args, env = {}) {
  return spawnSync(PYTHON, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function tempLedger(name) {
  return path.join(os.tmpdir(), `weft-h2-${name}-${process.pid}.json`);
}

function readLedger(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('H2 1: self-test run is deterministic, content-addressed, and a no-op on rerun', () => {
  const ledger = tempLedger('selftest');
  if (fs.existsSync(ledger)) fs.unlinkSync(ledger);
  const first = runScript(['--self-test', '--ledger', ledger]);
  assert.equal(first.status, 0, first.stderr);
  const summary = JSON.parse(first.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
  assert.equal(summary.noOp, false);
  assert.equal(summary.selfTest, true);
  const artifact = readLedger(ledger);
  assert.equal(artifact.kind, 'weft-h2-identity-probe');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.appendOnly, true);
  assert.equal(artifact.entries.length, 1);
  const entry = artifact.entries[0];
  assert.equal(entry.runId, summary.runId);
  // The runId is the sha256 of the canonical entry JSON without createdAt and
  // runId. The recompute runs in a python child, because the canonical form is
  // the writing interpreter's (python's) number formatting, not node's.
  const recompute = spawnSync(PYTHON, ['-I', '-c', `import json, sys, hashlib
entry = json.load(open(sys.argv[1]))['entries'][-1]
payload = {k: v for k, v in entry.items() if k not in ('createdAt', 'runId')}
print(hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest())`, ledger], { encoding: 'utf8' });
  assert.equal(recompute.status, 0, recompute.stderr);
  assert.equal(recompute.stdout.trim(), entry.runId,
    'the runId must be content-addressed over the canonical entry JSON');
  const second = runScript(['--self-test', '--ledger', ledger]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout.trim().split(/\r?\n/).filter(Boolean).pop()).noOp, true,
    'a rerun with unchanged inputs must be a no-op');
  assert.equal(readLedger(ledger).entries.length, 1, 'the rerun appended nothing');
  fs.unlinkSync(ledger);
});

test('H2 2: the ledger records the chance baseline, both fixed probe families, and honesty flags', () => {
  const ledger = tempLedger('selftest-fields');
  if (fs.existsSync(ledger)) fs.unlinkSync(ledger);
  const run = runScript(['--self-test', '--ledger', ledger]);
  assert.equal(run.status, 0, run.stderr);
  const entry = readLedger(ledger).entries[0];
  assert.deepEqual(entry.probeFamilies, ['mlp-relu-1x64', 'rbf-svm-c10-scale'],
    'the probe family is fixed and must be named');
  assert.ok(entry.task.probeFamily.includes('mlp') && entry.task.probeFamily.includes('svm'));
  const counts = entry.chance.evalIdentityCounts;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(entry.chance.evalFrequency,
    Math.max(...Object.values(counts)) / total,
    'the chance baseline must equal the majority-class frequency of the eval split');
  assert.ok(Object.values(counts).every((c) => c > 0), 'every identity key reaches the eval split');
  assert.equal(entry.task.note, 'post-hoc nonlinear attacker, not the in-training adversary');
  for (const [condition, block] of Object.entries(entry.conditions)) {
    assert.deepEqual(Object.keys(block.probes).sort(), entry.probeFamilies,
      `condition ${condition} must report both fixed probe families`);
    for (const probe of Object.values(block.probes)) {
      assert.equal(typeof probe.top1Accuracy, 'number');
      assert.equal(typeof probe.belowChance, 'boolean');
      assert.ok(probe.top1Accuracy >= 0 && probe.top1Accuracy <= 1);
      assert.equal(Math.abs(probe.accuracyVsChance - (probe.top1Accuracy - entry.chance.evalFrequency)) < 1e-9,
        true, 'accuracyVsChance must be the raw accuracy minus the chance baseline');
    }
  }
  fs.unlinkSync(ledger);
});

test('H2 3: absent shipped artifacts fail closed with a typed error and write nothing', () => {
  const ledger = tempLedger('fail-closed');
  if (fs.existsSync(ledger)) fs.unlinkSync(ledger);
  const before = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER) : null;
  const result = runScript(['--models-dir', path.join(ROOT, 'models', 'weft-h2-absent-probe-models'),
    '--ledger', ledger]);
  assert.equal(result.status, 2, `typed failure must exit 2, got ${result.status}`);
  const error = JSON.parse(result.stderr.trim().split(/\r?\n/).filter(Boolean).pop());
  assert.equal(error.error, 'WEFT_ARTIFACT_MISSING');
  assert.equal(error.kind, 'weft-h2-probe-error');
  assert.equal(fs.existsSync(ledger), false, 'a fail-closed run must not create the ledger');
  if (before !== null) {
    assert.deepEqual(fs.readFileSync(LEDGER), before, 'a fail-closed run must not alter the ledger');
  }
});

test('H2 4: a malformed corpus fails closed with typed errors, never silent skips', () => {
  const ledger = tempLedger('malformed');
  if (fs.existsSync(ledger)) fs.unlinkSync(ledger);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-h2-corpus-'));
  const malformed = path.join(dir, 'malformed.jsonl');
  fs.writeFileSync(malformed, '{"id":"a","text":"row one","identity":"person-a"}\n' +
    '{"id":"b","identity":"person-b"}\n');
  const result = runScript(['--corpus-jsonl', malformed, '--ledger', ledger]);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr.trim().split(/\r?\n/).filter(Boolean).pop()).error,
    'WEFT_CORPUS_MALFORMED');
  const empty = path.join(dir, 'empty.jsonl');
  fs.writeFileSync(empty, '');
  const emptyRun = runScript(['--corpus-jsonl', empty, '--ledger', ledger]);
  assert.equal(emptyRun.status, 2);
  assert.equal(JSON.parse(emptyRun.stderr.trim().split(/\r?\n/).filter(Boolean).pop()).error,
    'WEFT_CORPUS_MALFORMED', 'an empty corpus is a typed error, not a silent skip');
  const single = path.join(dir, 'single.jsonl');
  fs.writeFileSync(single, '{"id":"a","text":"row one","identity":"person-a"}\n' +
    '{"id":"b","text":"row two","identity":"person-a"}\n');
  const singleRun = runScript(['--corpus-jsonl', single, '--ledger', ledger]);
  assert.equal(singleRun.status, 2);
  assert.equal(JSON.parse(singleRun.stderr.trim().split(/\r?\n/).filter(Boolean).pop()).error,
    'WEFT_CORPUS_SINGLE_IDENTITY');
  assert.equal(fs.existsSync(ledger), false, 'no ledger entry on any fail-closed path');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('H2 5: the research note and the shipped prose stay inside the house wording rules', () => {
  assert.ok(fs.existsSync(NOTE), 'the H2 research note must exist');
  const lines = fs.readFileSync(NOTE, 'utf8').split(/\r?\n/);
  const titleLine = lines.findIndex((line) => line.startsWith('# '));
  assert.notEqual(titleLine, -1);
  const body = lines.filter((line, i) => i > titleLine).join('\n');
  for (const token of BANNED) assert.ok(!body.toLowerCase().includes(token),
    `banned literal in the H2 note body: ${token}`);
  assert.ok(!body.includes('—'), 'em-dashes are banned in the note body; the house title '
    + 'convention is the only allowed spine');
  const card = fs.readFileSync(MODEL_CARD, 'utf8');
  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  for (const text of [card, manifest]) {
    for (const token of BANNED) {
      assert.ok(!text.toLowerCase().includes(token),
        'this ticket must not alter the model card or the manifest');
    }
  }
});

test('H2 6: on a checkout with the shipped artifacts, the real probe is deterministic and pinned', (t) => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const roots = [path.join(ROOT, 'models'),
    path.resolve(ROOT, '..', '..', '..', 'models')];
  const present = roots.map((dir) =>
    manifest.artifacts.every((a) =>
      fs.existsSync(path.join(dir, 'weft-specialist-quantized', path.basename(a.path)))));
  const modelsDir = present.some(Boolean)
    ? path.resolve(roots[present.indexOf(true)], 'weft-specialist-quantized')
    : null;
  if (!modelsDir) {
    t.skip('the shipped quantized artifacts are absent on this checkout '
      + '(gitignored by standing rule); the recorded ledger from the artifact box is the '
      + 'source of truth');
    return;
  }
  const ledger = tempLedger('real');
  if (fs.existsSync(ledger)) fs.unlinkSync(ledger);
  const first = runScript(['--models-dir', modelsDir, '--ledger', ledger]);
  assert.equal(first.status, 0, first.stderr);
  const firstSummary = JSON.parse(first.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
  const second = runScript(['--models-dir', modelsDir, '--ledger', ledger]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout.trim().split(/\r?\n/).filter(Boolean).pop()).noOp, true,
    'the real probe is deterministic to the runId and a rerun is a no-op');
  const entry = readLedger(ledger).entries[0];
  assert.equal(entry.runId, firstSummary.runId);
  for (const artifact of manifest.artifacts) {
    const recorded = Object.values(entry.conditions).find(
      (condition) => condition.sha256 === artifact.sha256);
    assert.ok(recorded, `condition block must pin artifact ${artifact.id} sha256`);
  }
  assert.equal(fs.existsSync(LEDGER), true, 'the committed ledger exists');
  fs.unlinkSync(ledger);
});
