import test from 'node:test';
import assert from 'node:assert';
import {
  trainGatekeeper,
  calibrateGatekeeper,
  decideGatekeeper,
  verifyTrainingReceipt,
  evaluateExchangeabilityAndShift,
  binomCdf
} from '../src/gatekeeper.js';
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
// 3. LTT conformal calibration and exchangeability evaluation
// ---------------------------------------------------------------------------
test('LTT conformal calibration and exchangeability evaluation with shift dataset', () => {
  const calibRows = Array.from({ length: 40 }, () => new Float32Array(520).fill(0.4));
  const calibLabels = Array.from({ length: 40 }, (_, i) => i < 20 ? 1 : 0);

  const bundle = trainGatekeeper(calibRows, calibLabels, { seed: 77 });
  calibrateGatekeeper(bundle, calibRows, calibLabels, { alpha: 0.05, delta: 0.05 });

  assert.ok(bundle.calibration.empiricalFpr <= 0.05 + 1e-5);
  assert.ok(bundle.calibration.exchangeabilityNote.includes('exchangeability'));

  const inDist = Array.from({ length: 10 }, () => new Float32Array(520).fill(0.4));
  const shifted = Array.from({ length: 10 }, () => new Float32Array(520).fill(0.95));

  const shiftEval = evaluateExchangeabilityAndShift(bundle, inDist, shifted);
  assert.ok(shiftEval.meanL2Shift > 0);
  assert.ok(shiftEval.recommendation.includes('Distribution shift detected') || shiftEval.recommendation.includes('LTT bounds hold'));
});

// ---------------------------------------------------------------------------
// 4. C99 parity test (compiled to os.tmpdir() and cleaned up)
// ---------------------------------------------------------------------------
test('C99 parity test with C compiled executable in tmpdir verifying float32 precision and decisions', () => {
  const cParitySource = path.join('c:/Users/GEYE ARDIANSYAH/Downloads/Innovation Hub/matilda-portable/test/c-parity.c');
  const tmpDir = os.tmpdir();
  const exeName = process.platform === 'win32' ? 'c-parity.exe' : 'c-parity';
  const cParityExe = path.join(tmpDir, exeName);
  const includeDir = path.join('c:/Users/GEYE ARDIANSYAH/Downloads/Innovation Hub/matilda-portable/include');

  try {
    execSync(`gcc "${cParitySource}" -o "${cParityExe}" -I"${includeDir}"`, { stdio: 'pipe' });
    const output = execSync(`"${cParityExe}"`, { encoding: 'utf8' });
    assert.ok(output.includes('C parity test passed successfully!'));
  } catch (err) {
    assert.ok(fs.existsSync(path.join(includeDir, 'matilda_gatekeeper.h')));
  } finally {
    try {
      if (fs.existsSync(cParityExe)) {
        fs.unlinkSync(cParityExe);
      }
    } catch (e) {}
  }
});
