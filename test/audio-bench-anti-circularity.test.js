import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Stage 2 anti-circularity receipt: the audio SR-MP benchmark must never seed
// its ring from the scoring key. Evaluator circularity is a proven failure mode
// in this repo (the original expR4 run seeded anchors from pii_checks).
const py = readFileSync(new URL('../scripts/run-reviewer-secrets-audio-pprl.py', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../scripts/tab-node-helper.mjs', import.meta.url), 'utf8');

test('no scoring token can reach SR-MP seed arguments (source guard)', () => {
  for (const line of py.split('\n')) {
    if (line.trim().startsWith('#')) continue; // comments cannot seed anything
    if (line.includes('contextAnchors')) {
      assert.ok(!line.includes('pii_checks'), `answer-key seeding must stay removed: ${line.trim()}`);
    }
  }
  // Runtime guards must be present in the benchmark harness.
  assert.ok(py.includes('ANTI-CIRCULARITY GUARD'), 'self-seeded guard assert missing');
  assert.ok(py.includes('valid_anchors'), 'anchor provenance guard (engine detections only) missing');
});

test('helper records every seeded anchor for provenance', () => {
  assert.ok(helper.includes('seededAnchors'), 'helper must export seededAnchors per call');
});

test('expR4 artifact declares self-seeded SR-MP with all honest conditions', () => {
  const r4 = JSON.parse(
    readFileSync(new URL('../results/reviewer-secrets-audio-pprl-benchmarks.json', import.meta.url), 'utf8'),
  ).expR4_endToEndWhisperAudio;
  assert.ok(String(r4.srmpSeeding).includes('self-seeded'), 'expR4 must declare self-seeded SR-MP');
  for (const cond of ['isolated', 'srmpSelfSeeded', 'fuzzyBaseline', 'srmpWrongRecord', 'srmpPartialAnchors']) {
    assert.ok(r4.conditions?.[cond], `missing honest condition in artifact: ${cond}`);
  }
  assert.equal(typeof r4.conditions.srmpSelfSeeded.absentFromAnchorsTokens, 'number',
    'recall-ceiling (absent-from-anchors) analysis missing');
});
