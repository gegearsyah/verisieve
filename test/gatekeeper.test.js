import test from 'node:test';
import assert from 'node:assert';
import {
  trainGatekeeper,
  calibrateGatekeeper,
  decideGatekeeper,
  verifyTrainingReceipt,
  evaluateExchangeabilityAndShift,
  binomCdf,
  trainMultiAxisGatekeeper,
  calibrateMultiAxisGatekeeper,
  decideMultiAxisGatekeeper
} from '../src/gatekeeper.js';
import { fnv1a, extractFeatureRow, createTokenizer } from '../src/clean-and-tokenize.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// 1. Training determinism & cryptographic receipt replay
// ---------------------------------------------------------------------------
test('Training determinism & cryptographic receipt replay', () => {
  const featureRows = [
    new Float32Array(520).fill(0.8),
    new Float32Array(520).fill(0.2),
    new Float32Array(520).fill(0.9),
    new Float32Array(520).fill(0.1)
  ];
  const labels = [1, 0, 1, 0];

  const bundle1 = trainGatekeeper(featureRows, labels, { seed: 42 });
  const bundle2 = trainGatekeeper(featureRows, labels, { seed: 42 });

  // Determinism check
  assert.strictEqual(bundle1.receipt.weightsSha256, bundle2.receipt.weightsSha256);
  assert.strictEqual(bundle1.receipt.dataSha256, bundle2.receipt.dataSha256);

  // Valid receipt replay passes
  const isValid = verifyTrainingReceipt(bundle1, featureRows, labels, { seed: 42 });
  assert.strictEqual(isValid, true);

  // Tampered receipt weightsSha256 fails validation against replayed weights
  const tamperedBundle = JSON.parse(JSON.stringify(bundle1));
  tamperedBundle.receipt.weightsSha256 = '0'.repeat(64);
  const isTamperedValid = verifyTrainingReceipt(tamperedBundle, featureRows, labels, { seed: 42 });
  assert.strictEqual(isTamperedValid, false);

  // T3: Tampered live weights or bias MUST fail even with an untouched valid receipt
  const mutatedWeights = JSON.parse(JSON.stringify(bundle1));
  mutatedWeights.weights[0] = (mutatedWeights.weights[0] || 0) + 0.5;
  assert.strictEqual(verifyTrainingReceipt(mutatedWeights, featureRows, labels, { seed: 42 }), false);

  const mutatedBias = JSON.parse(JSON.stringify(bundle1));
  mutatedBias.bias += 0.5;
  assert.strictEqual(verifyTrainingReceipt(mutatedBias, featureRows, labels, { seed: 42 }), false);
});

// ---------------------------------------------------------------------------
// 2. binomCdf mathematical accuracy
// ---------------------------------------------------------------------------
test('binomCdf mathematical accuracy against exact binomial probabilities', () => {
  const c0 = binomCdf(0, 20, 0.05);
  const expectedC0 = Math.pow(0.95, 20);
  assert.ok(Math.abs(c0 - expectedC0) < 1e-4);

  const c20 = binomCdf(20, 20, 0.05);
  assert.strictEqual(c20, 1);
});

// ---------------------------------------------------------------------------
// 3. LTT conformal calibration, fail-closed bounds, targetDropRecall & multi-axis topic checks
// ---------------------------------------------------------------------------
test('T3: LTT conformal calibration fails closed cleanly, rejects in-sample leakage, resolves targetDropRecall, and checks topic axis', () => {
  const makeVec = (val) => new Float32Array(520).fill(val);
  const trainRows = Array.from({ length: 40 }, (_, i) => makeVec(i < 20 ? 0.8 : -0.8));
  const trainLabels = Array.from({ length: 40 }, (_, i) => i < 20 ? 1 : 0);

  const bundle = trainGatekeeper(trainRows, trainLabels, { seed: 77, lr: 0.15, epochs: 40 });

  // Disjoint calibration check: passing training data fails closed
  assert.throws(
    () => calibrateGatekeeper(JSON.parse(JSON.stringify(bundle)), trainRows, trainLabels, { alpha: 0.05, delta: 0.05 }),
    /LTT_IN_SAMPLE_CALIBRATION_FORBIDDEN/
  );

  // n0 = 0 negatives -> certified: false, tauKeep: 1.0, tauDrop: 0.0
  const zeroNegCal = Array.from({ length: 10 }, () => makeVec(0.75));
  const zeroNegBundle = calibrateGatekeeper(JSON.parse(JSON.stringify(bundle)), zeroNegCal, new Array(10).fill(1), { alpha: 0.05, delta: 0.05 });
  assert.strictEqual(zeroNegBundle.calibration.certified, false);
  assert.strictEqual(zeroNegBundle.calibration.tauKeep, 1.0);
  assert.strictEqual(zeroNegBundle.calibration.tauDrop, 0.0);
  assert.notStrictEqual(decideGatekeeper(zeroNegBundle, makeVec(0.95)).action, 'KEEP_SAFE');

  // Small n0 = 20 (< 59 for alpha=0.05, delta=0.05) -> certified: false, tauKeep: 1.0 (no 0.76 heuristic, no negative tauDrop)
  const smallCalRows = Array.from({ length: 40 }, (_, i) => makeVec(i < 20 ? 0.72 : -0.72));
  const smallCalLabels = Array.from({ length: 40 }, (_, i) => i < 20 ? 1 : 0);
  const smallCalBundle = calibrateGatekeeper(JSON.parse(JSON.stringify(bundle)), smallCalRows, smallCalLabels, { alpha: 0.05, delta: 0.05 });
  assert.strictEqual(smallCalBundle.calibration.certified, false);
  assert.strictEqual(smallCalBundle.calibration.tauKeep, 1.0);
  assert.ok(smallCalBundle.calibration.tauDrop >= 0);

  // Certified n0 = 70 calibration split (heterogeneous negative probabilities for targetDropRecall)
  const largeCalRows = [];
  const largeCalLabels = [];
  for (let i = 0; i < 70; i++) {
    largeCalRows.push(makeVec(0.6 + (i % 5) * 0.04));
    largeCalLabels.push(1);
    largeCalRows.push(makeVec(-0.05 - (i / 70) * 0.75));
    largeCalLabels.push(0);
  }
  const calLowRecall = calibrateGatekeeper(JSON.parse(JSON.stringify(bundle)), largeCalRows, largeCalLabels, { alpha: 0.05, delta: 0.05, targetDropRecall: 0.40 });
  const calHighRecall = calibrateGatekeeper(JSON.parse(JSON.stringify(bundle)), largeCalRows, largeCalLabels, { alpha: 0.05, delta: 0.05, targetDropRecall: 0.95 });
  assert.strictEqual(calHighRecall.calibration.certified, true);
  assert.ok(calHighRecall.calibration.tauKeep < 1.0);
  assert.ok(calHighRecall.calibration.tauDrop >= 0 && calHighRecall.calibration.tauDrop < calHighRecall.calibration.tauKeep);
  assert.ok(calLowRecall.calibration.tauDrop <= calHighRecall.calibration.tauDrop, 'targetDropRecall must govern resolved tauDrop');
  assert.ok(calHighRecall.calibration.empiricalFpr <= 0.05 + 1e-5);
  assert.ok(calHighRecall.calibration.exchangeabilityNote.includes('exchangeability'));

  const inDist = Array.from({ length: 10 }, () => makeVec(0.4));
  const shifted = Array.from({ length: 10 }, () => makeVec(0.95));
  const shiftEval = evaluateExchangeabilityAndShift(calHighRecall, inDist, shifted);
  assert.ok(shiftEval.meanL2Shift > 0);
  assert.ok(shiftEval.recommendation.includes('Distribution shift detected') || shiftEval.recommendation.includes('LTT bounds hold'));

  // Multi-axis enforcement: topic axis drop or abstain governs conjunctionAction
  const stubMulti = {
    modelType: 'matilda-multiaxis-gatekeeper-v1',
    axes: ['safe', 'useful', 'topic'],
    models: {
      safe: { dim: 520, weights: Array.from(new Float32Array(520)), bias: 2.0, calibration: { certified: true, tauKeep: 0.7, tauDrop: 0.3 } },
      useful: { dim: 520, weights: Array.from(new Float32Array(520)), bias: 2.0, calibration: { certified: true, tauKeep: 0.7, tauDrop: 0.3 } },
      topic: { dim: 520, weights: Array.from(new Float32Array(520)), bias: -2.0, calibration: { certified: true, tauKeep: 0.7, tauDrop: 0.3 } },
    },
  };
  const dropOnTopic = decideMultiAxisGatekeeper(stubMulti, makeVec(0));
  assert.strictEqual(dropOnTopic.conjunctionAction, 'DROP_OR_QUARANTINE');
  stubMulti.models.topic.bias = 0.0; // prob = 0.50 in abstain zone [0.3, 0.7)
  const abstainOnTopic = decideMultiAxisGatekeeper(stubMulti, makeVec(0));
  assert.strictEqual(abstainOnTopic.conjunctionAction, 'ABSTAIN_HUMAN_REVIEW');
  assert.strictEqual(abstainOnTopic.abstained, true);
});

// ---------------------------------------------------------------------------
// 4. Live cross-process C99 parity test (compiled with gcc, zero swallowed errors)
// ---------------------------------------------------------------------------
test('T3: live C99 parity compilation verifying UTF-8 fnv1a and float32 Math.fround predictions without swallowed errors', () => {
  const cParitySource = path.resolve('test/c-parity.c');
  const includeDir = path.resolve('include');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-c99-'));
  const ext = process.platform === 'win32' ? '.exe' : '';
  const staticExe = path.join(tmpDir, `c-parity${ext}`);
  const liveC = path.join(tmpDir, 'live-parity.c');
  const liveExe = path.join(tmpDir, `live-parity${ext}`);

  let compiler = 'gcc';
  if (process.platform === 'win32') {
    const msysGcc = 'C:/msys64/ucrt64/bin/gcc.exe';
    if (fs.existsSync(msysGcc)) compiler = msysGcc;
  }

  try {
    execSync(`"${compiler}" "${cParitySource}" -o "${staticExe}" -I"${includeDir}" -lm`, { stdio: 'pipe' });
    const output = execSync(`"${staticExe}"`, { encoding: 'utf8' });
    assert.ok(output.includes('C parity test passed successfully!'));

    const trainRows = Array.from({ length: 12 }, (_, i) => {
      const f = new Float32Array(520);
      f[i % 10] = i % 2 === 0 ? 0.9 : -0.9;
      f[513] = i % 2 === 0 ? 0.95 : 0.25;
      return f;
    });
    const trainLabels = trainRows.map((_, i) => (i % 2 === 0 ? 1 : 0));
    const liveBundle = trainGatekeeper(trainRows, trainLabels, { seed: 123, lr: 0.2, epochs: 25 });
    liveBundle.calibration = { certified: true, tauKeep: 0.72, tauDrop: 0.28 };

    const tok = createTokenizer();
    const textA = 'Clinical outcomes improved significantly with rehabilitation.';
    const textB = 'Patient email a@b.co phone +61 412 345 678';
    const xSafe = extractFeatureRow({ text: textA, confidence: 0.98 }, tok.encode(textA));
    const xUnsafe = extractFeatureRow({ text: textB, piiItems: [{ type: 'email', value: 'a@b.co' }], confidence: 0.4 }, tok.encode(textB));

    const utf8Sample = 'café-🧬';
    const jsUtf8Hash = fnv1a(utf8Sample);
    const jsDecSafe = decideGatekeeper(liveBundle, xSafe);
    const jsDecUnsafe = decideGatekeeper(liveBundle, xUnsafe);

    const fmtF32 = (arr) => Array.from(arr).map((v) => {
      const n = Math.fround(v);
      return Number.isInteger(n) ? `${n}.0f` : `${n}f`;
    }).join(', ');
    const biasNum = Math.fround(liveBundle.bias);
    const biasStr = Number.isInteger(biasNum) ? `${biasNum}.0f` : `${biasNum}f`;
    const src = `#include <stdio.h>
#include "verisieve.h"
int main(void) {
  unsigned int h = verisieve_fnv1a_32("caf\\xc3\\xa9-\\xf0\\x9f\\xa7\\xac");
  verisieve_gatekeeper_t gk;
  gk.dim = 520;
  gk.bias = ${biasStr};
  gk.tau_keep = ${liveBundle.calibration.tauKeep}f;
  gk.tau_drop = ${liveBundle.calibration.tauDrop}f;
  gk.has_calibration = 1;
  float w[520] = { ${fmtF32(liveBundle.weights)} };
  for (int i = 0; i < 520; i++) gk.weights[i] = w[i];
  float x1[520] = { ${fmtF32(xSafe)} };
  float x2[520] = { ${fmtF32(xUnsafe)} };
  printf("%08x %.9f %d %.9f %d\\n", h, verisieve_predict_prob(&gk, x1), verisieve_decide(&gk, x1), verisieve_predict_prob(&gk, x2), verisieve_decide(&gk, x2));
  return 0;
}
`;
    fs.writeFileSync(liveC, src, 'utf8');
    execSync(`"${compiler}" "${liveC}" -o "${liveExe}" -I"${includeDir}" -lm`, { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
    const [cHash, cProb1Str, cDec1Str, cProb2Str, cDec2Str] = execSync(`"${liveExe}"`, { encoding: 'utf8' }).trim().split(/\s+/);

    assert.strictEqual(cHash, jsUtf8Hash);
    assert.ok(Math.abs(Number(cProb1Str) - jsDecSafe.prob) < 1e-6, `Safe prob mismatch: C=${cProb1Str} JS=${jsDecSafe.prob}`);
    assert.ok(Math.abs(Number(cProb2Str) - jsDecUnsafe.prob) < 1e-6, `Unsafe prob mismatch: C=${cProb2Str} JS=${jsDecUnsafe.prob}`);
    const mapAction = (a) => (a === 'KEEP_SAFE' ? 1 : a === 'DROP_OR_QUARANTINE' ? 0 : 2);
    assert.strictEqual(Number(cDec1Str), mapAction(jsDecSafe.action));
    assert.strictEqual(Number(cDec2Str), mapAction(jsDecUnsafe.action));
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {}
  }
});
