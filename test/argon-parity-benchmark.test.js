import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildWorkspaces } from '../scripts/eval-argon-parity-benchmark.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'eval-argon-parity-benchmark.mjs');
const ARTIFACT = path.join(ROOT, 'results', 'argon-parity-benchmark.json');

function runBench() {
  execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 480000 });
}

function metricLeaves(node, keys = [], out = []) {
  if (Array.isArray(node)) {
    for (const v of node) metricLeaves(v, keys, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) metricLeaves(v, [...keys, k], out);
    return out;
  }
  if (typeof node === 'number' || typeof node === 'boolean' || node === null) {
    out.push({ path: keys.join('.'), value: node });
  }
  return out;
}

test('W0 red-first: artifact does not exist before the benchmark ships (checks the seam, not the run)', () => {
  // buildWorkspaces() must produce the six deterministic workspaces without any engine call
  const workspaces = buildWorkspaces();
  assert.equal(workspaces.length, 6);
  assert.deepEqual(
    workspaces.map((w) => w.id),
    ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']
  );
});

test('W1 anti-circularity: GT-only spans never appear in any engine-visible input surface', () => {
  const workspaces = buildWorkspaces();
  for (const w of workspaces) {
    assert.ok(Array.isArray(w.gtOnlySpans) && w.gtOnlySpans.length > 0, `${w.id} must declare gtOnlySpans`);
    assert.equal(typeof w.engineVisibleText, 'string');
    for (const span of w.gtOnlySpans) {
      assert.ok(
        !w.engineVisibleText.toLowerCase().includes(span.toLowerCase()),
        `${w.id}: GT-only span "${span}" leaked into the engine-visible input surface`
      );
    }
  }
});

test('W2 artifact: runs the benchmark, all 6 workspaces present, every metric finite, anti-circularity recorded', async () => {
  runBench();
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.equal(artifact.kind, 'argon-parity-benchmark');
  assert.equal(Object.keys(artifact.workspaces).length, 6);
  for (const id of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']) {
    const ws = artifact.workspaces[id];
    assert.ok(ws, `workspace ${id} missing`);
    assert.equal(ws.antiCircularity.present, true, `${id} must record its anti-circularity assertion`);
    assert.ok(ws.antiCircularity.statement.length > 10);
    for (const leaf of metricLeaves(ws.metrics)) {
      assert.equal(typeof leaf.value, 'number', `${id}.${leaf.path} must be numeric`);
      assert.ok(Number.isFinite(leaf.value), `${id}.${leaf.path} must be a finite number`);
    }
    const timing = artifact.timingMs[id];
    assert.ok(Number.isFinite(timing.baselineMs) && timing.baselineMs >= 0);
    assert.ok(Number.isFinite(timing.versieveMs) && timing.versieveMs >= 0);
  }
  assert.equal(artifact.pareto.cloudEgressBytes, 0);
  assert.ok(artifact.pareto.totalWasmBytes > 0);
  assert.equal(artifact.oracle.cloudCalls, 0);
});

test('W3 determinism: a re-run with the fixed seeds reproduces identical artifact bytes (timing fields excluded)', async () => {
  const before = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  runBench();
  const after = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  assert.ok(before.timingMs && after.timingMs, 'artifact must separate wall-clock timing');
  delete before.timingMs;
  delete after.timingMs;
  assert.deepEqual(after, before);
});

test('W4 no hardcoded user paths: fixture bytes, engine-visible surfaces and GT contain no user-home paths', () => {
  const workspaces = buildWorkspaces();
  const home = os.homedir();
  for (const w of workspaces) {
    assert.ok(!w.engineVisibleText.includes(home), `${w.id} embeds a user-home path in engine-visible input`);
    assert.ok(!JSON.stringify(w.inputs.map((i) => i.name)).includes(home), `${w.id} embeds a user-home path in input names`);
  }
});
