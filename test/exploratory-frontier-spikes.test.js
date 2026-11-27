import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  combineConvexEValues,
  evaluateDualChannelEValue,
} from '../src/gatekeeper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const AC_CRC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-exploratory-ac-crc.py');
const IB_PTLM_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-exploratory-ib-ptlm.py');
const AC_CRC_JSON = path.join(REPO_ROOT, 'results', 'exploratory-ac-crc.json');
const IB_PTLM_JSON = path.join(REPO_ROOT, 'results', 'exploratory-ib-ptlm.json');

function resolvePythonBin() {
  const candidates = [
    process.env.VERSIEVE_GPU_PYTHON,
    'D:\\rtio-lfm3-gpu-env\\Scripts\\python.exe',
    'C:\\Python312\\python.exe',
    'python',
  ].filter(Boolean);
  for (const cand of candidates) {
    if (cand === 'python' || fs.existsSync(cand)) {
      const probe = spawnSync(cand, ['--version'], { encoding: 'utf8', timeout: 10000 });
      if (probe.status === 0) return cand;
    }
  }
  throw new Error('No working Python 3 interpreter found for exploratory frontier tests');
}

const PYTHON_BIN = resolvePythonBin();

test('JS combineConvexEValues & Python AC-CRC convex e-value math preserve E[E_joint] <= 1 under H_0 across arbitrary channel correlation', () => {
  // Exact cross-language algebraic parity
  const pyCode = [
    'import importlib.util, json, pathlib, sys',
    `spec = importlib.util.spec_from_file_location("accrc", ${JSON.stringify(AC_CRC_SCRIPT)})`,
    'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'pairs = [(0.4, 22.5, 0.7, 0.3), (18.0, 25.0, 0.5, 0.5), (35.2, 1.1, 0.3, 0.7), (0.0, 19.5, 0.25, 0.75)]',
    'out = [mod.combine_convex_e_values(a, b, w1, w2) for (a, b, w1, w2) in pairs]',
    'print(json.dumps(out))',
  ].join('\n');

  const proc = spawnSync(PYTHON_BIN, ['-c', pyCode], { encoding: 'utf8', timeout: 20000 });
  assert.equal(proc.status, 0, `Python parity helper failed: ${proc.stderr}`);
  const pyVals = JSON.parse(proc.stdout.trim());

  const pairs = [
    [0.4, 22.5, 0.7, 0.3],
    [18.0, 25.0, 0.5, 0.5],
    [35.2, 1.1, 0.3, 0.7],
    [0.0, 19.5, 0.25, 0.75],
  ];
  pairs.forEach(([e1, e2, w1, w2], idx) => {
    const jsVal = combineConvexEValues(e1, e2, { w1, w2 });
    assert.ok(Math.abs(jsVal - pyVals[idx]) < 1e-12, `Mismatch at index ${idx}: JS=${jsVal} vs Py=${pyVals[idx]}`);
    const dual = evaluateDualChannelEValue(e1, e2, { weights: [w1, w2], delta: 0.05 });
    assert.equal(dual.exceeded, jsVal >= 20.0);
  });

  // Deterministic exact finite-state distributions under H_0 with E[E1] <= 1 and E[E2] <= 1:
  // 1) Comonotonic (maximal positive dependence, rho = +1)
  // 2) Countermonotonic (maximal negative dependence, rho = -1)
  // 3) Independent product law (rho = 0)
  // 4) Heavy-tailed adversarial spike law (E = 19.8 with p=0.05, E = 0.01 with p=0.95 -> E[E] = 0.9995 <= 1)
  const marginalsA = [0.0, 0.4, 0.8, 2.8]; // uniform 1/4 -> mean = 1.0
  const marginalsB = [0.1, 0.3, 0.6, 3.0]; // uniform 1/4 -> mean = 1.0
  const weightsList = [
    { w1: 0.7, w2: 0.3 },
    { w1: 0.5, w2: 0.5 },
    { w1: 0.3, w2: 0.7 },
  ];

  for (const w of weightsList) {
    // Comonotonic
    const meanPos =
      marginalsA.reduce((acc, e1, i) => acc + combineConvexEValues(e1, marginalsB[i], w), 0) / 4;
    assert.ok(meanPos <= 1.0 + 1e-12, `Comonotonic E[E_joint] exceeded 1: ${meanPos}`);

    // Countermonotonic
    const meanNeg =
      marginalsA.reduce((acc, e1, i) => acc + combineConvexEValues(e1, marginalsB[3 - i], w), 0) / 4;
    assert.ok(meanNeg <= 1.0 + 1e-12, `Countermonotonic E[E_joint] exceeded 1: ${meanNeg}`);

    // Independent product
    let meanInd = 0;
    for (const e1 of marginalsA) {
      for (const e2 of marginalsB) {
        meanInd += combineConvexEValues(e1, e2, w) / 16;
      }
    }
    assert.ok(meanInd <= 1.0 + 1e-12, `Independent E[E_joint] exceeded 1: ${meanInd}`);

    // Heavy-tailed spike law: P(E1=19.8, E2=19.8)=0.05, P(E1=0.01, E2=0.01)=0.95
    const meanSpike =
      0.05 * combineConvexEValues(19.8, 19.8, w) + 0.95 * combineConvexEValues(0.01, 0.01, w);
    assert.ok(meanSpike <= 1.0, `Spike law E[E_joint] exceeded 1: ${meanSpike}`);
  }
});

test('AC-CRC & IB-PT-LM CLI contracts: --help, --dry-run, and fail-closed exit code 2', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't12-frontier-cli-'));
  try {
    // 1. --help exits 0 on both scripts
    const helpAc = spawnSync(PYTHON_BIN, [AC_CRC_SCRIPT, '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(helpAc.status, 0, `AC-CRC --help failed: ${helpAc.stderr}`);
    assert.match(helpAc.stdout, /--dry-run/);

    const helpIb = spawnSync(PYTHON_BIN, [IB_PTLM_SCRIPT, '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(helpIb.status, 0, `IB-PT-LM --help failed: ${helpIb.stderr}`);
    assert.match(helpIb.stdout, /--dry-run/);

    // 2. --dry-run produces exploratory artifacts with >=3 seeds
    const dryAcOut = path.join(tmpDir, 'dry-ac-crc.json');
    const dryAc = spawnSync(PYTHON_BIN, [AC_CRC_SCRIPT, '--dry-run', '--out', dryAcOut], {
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(dryAc.status, 0, `AC-CRC --dry-run failed: ${dryAc.stderr}`);
    const dryAcJson = JSON.parse(fs.readFileSync(dryAcOut, 'utf8'));
    assert.equal(dryAcJson.status, 'exploratory');
    assert.equal(dryAcJson.dryRun, true);
    assert.ok(Array.isArray(dryAcJson.seeds) && dryAcJson.seeds.length >= 3);
    assert.equal(dryAcJson.typeIErrorControlUnderH0.dependentChannelMonteCarlo.allRegimesPass, true);

    const dryIbOut = path.join(tmpDir, 'dry-ib-ptlm.json');
    const dryIb = spawnSync(PYTHON_BIN, [IB_PTLM_SCRIPT, '--dry-run', '--out', dryIbOut], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(dryIb.status, 0, `IB-PT-LM --dry-run failed: ${dryIb.stderr}`);
    const dryIbJson = JSON.parse(fs.readFileSync(dryIbOut, 'utf8'));
    assert.equal(dryIbJson.status, 'exploratory');
    assert.equal(dryIbJson.dryRun, true);
    assert.ok(Array.isArray(dryIbJson.seeds) && dryIbJson.seeds.length >= 3);
    assert.equal(dryIbJson.provenance.surrogatePoolAudit.poolOverlapCount, 0);
    assert.equal(dryIbJson.provenance.alignmentSelfCheckPassed, true);

    // 3. Fail-closed exit code 2 on missing inputs / missing GPU runtime
    const missingPath = path.join(tmpDir, 'does-not-exist.json');
    const failAc = spawnSync(
      PYTHON_BIN,
      [AC_CRC_SCRIPT, '--cpa-json', missingPath, '--out', path.join(tmpDir, 'never.json')],
      { encoding: 'utf8', timeout: 15000 }
    );
    assert.equal(failAc.status, 2, `Expected AC-CRC fail-closed exit code 2, got ${failAc.status}`);
    const failAcPayload = JSON.parse(failAc.stderr.trim());
    assert.equal(failAcPayload.ok, false);

    const failIb = spawnSync(
      PYTHON_BIN,
      [IB_PTLM_SCRIPT, '--model-id', 'nonexistent-org/missing-model-xyz', '--out', path.join(tmpDir, 'never2.json')],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, VERSIEVE_FORCE_MISSING_GPU: '1' },
      }
    );
    assert.equal(failIb.status, 2, `Expected IB-PT-LM fail-closed exit code 2, got ${failIb.status}`);
    const failIbPayload = JSON.parse(failIb.stderr.trim());
    assert.equal(failIbPayload.ok, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Committed results/exploratory-ac-crc.json satisfies exploratory, >=3-seed, parity, and Type-I error invariants', () => {
  assert.ok(fs.existsSync(AC_CRC_JSON), 'results/exploratory-ac-crc.json must exist');
  const data = JSON.parse(fs.readFileSync(AC_CRC_JSON, 'utf8'));

  assert.equal(data.status, 'exploratory');
  assert.equal(data.dryRun, false);
  assert.deepEqual(data.seeds, [42, 43, 44]);
  assert.ok(data.provenance.cpaAuditJsonSha256 && data.provenance.cpaAuditJsonSha256.length === 64);
  assert.ok(data.provenance.tabBenchmarksJsonSha256 && data.provenance.tabBenchmarksJsonSha256.length === 64);
  assert.ok(data.provenance.gatekeeperJsSha256 && data.provenance.gatekeeperJsSha256.length === 64);

  // JS cross-check parity
  assert.equal(data.jsCrossCheck.verified, true);
  assert.ok(data.jsCrossCheck.maxAbsDiff < 1e-12);

  // Analytical + 10,000-trial dependent-channel Monte Carlo under H_0
  assert.equal(data.typeIErrorControlUnderH0.analyticalCheck.linearityOfExpectationVerified, true);
  const mc = data.typeIErrorControlUnderH0.dependentChannelMonteCarlo;
  assert.ok(mc.nTrials >= 10000);
  assert.equal(mc.allRegimesPass, true);
  assert.ok(mc.byCorrelation.length >= 5);

  // Weight sweep & baselines
  for (const key of ['w_10_00_detector_only', 'w_07_03', 'w_05_05', 'w_03_07']) {
    const entry = data.weightSweep[key];
    assert.ok(entry, `Missing weight sweep entry ${key}`);
    assert.equal(entry.perSeed.length, 3);
    for (const mk of ['releasedTop1ReIdRatePct', 'e2eDetectorLeakRatePct', 'safeYieldPct', 'releaseRatePct']) {
      assert.ok(Number.isFinite(entry.metrics[mk].mean), `Non-finite metric ${mk} on ${key}`);
      assert.equal(entry.metrics[mk].ci95.length, 2);
    }
  }
  assert.ok(data.baselines.hcCrcSingleChannel);
  assert.ok(data.baselines.eLttDetectorOnly);
  assert.ok(Number.isFinite(data.deltasVsBaselines.w_05_05_vs_hc_crc.releasedTop1ReIdRatePct.mean));
  assert.ok(typeof data.honestAssessment.summary === 'string' && data.honestAssessment.summary.length > 40);
});

test('Committed results/exploratory-ib-ptlm.json satisfies exploratory, >=3-seed, disjoint-surrogate, and probe invariants', () => {
  assert.ok(fs.existsSync(IB_PTLM_JSON), 'results/exploratory-ib-ptlm.json must exist');
  const data = JSON.parse(fs.readFileSync(IB_PTLM_JSON, 'utf8'));

  assert.equal(data.status, 'exploratory');
  assert.equal(data.dryRun, false);
  assert.deepEqual(data.seeds, [42, 43, 44]);
  assert.equal(data.hyperparameters.modelId, 'Qwen/Qwen2.5-0.5B-Instruct');
  assert.equal(data.hyperparameters.steps, 80);
  assert.equal(data.hyperparameters.learningRate, 2e-4);
  assert.ok(data.hyperparameters.betaKl > 0);

  // Provenance & disjoint surrogate pool check
  assert.equal(data.provenance.hardware.cudaAvailable, true);
  assert.equal(data.provenance.surrogatePoolAudit.poolOverlapCount, 0);
  assert.ok(data.provenance.model.configSha256 && data.provenance.model.configSha256.length === 64);

  for (const armKey of ['base', 'unredacted', 'masking_only', 'pt_lm', 'ib_pt_lm']) {
    const arm = data.arms[armKey];
    assert.ok(arm, `Missing arm ${armKey}`);
    if (armKey !== 'base') {
      assert.equal(arm.nSeeds, 3, `Expected 3 seeds on ${armKey}`);
      assert.equal(arm.perSeed.length, 3);
    }
    for (const mk of [
      'rawCanaryMeanBits',
      'rawCanaryR1Count',
      'directSurrogateMeanBits',
      'contextualSurrogateInversionMeanBits',
      'nonPiiSymmetricKl',
      'nonPiiHiddenCosineDistance',
      'linearProbeIdentityAccPct',
      'cosineCentroidProbeAccPct',
      'tagEchoRatePct',
      'seenDocTokenF1Pct',
    ]) {
      assert.ok(Number.isFinite(arm.aggregate[mk].mean), `Non-finite ${mk} on ${armKey}`);
      assert.equal(arm.aggregate[mk].bootstrapCi95.length, 2);
    }
  }

  // Honest deltas vs PT-LM and Masking-only
  assert.ok(Number.isFinite(data.deltas.ibPtLm_vs_ptLm.nonPiiSymmetricKl.mean));
  assert.ok(Number.isFinite(data.deltas.ibPtLm_vs_ptLm.linearProbeIdentityAccPct.mean));
  assert.ok(Number.isFinite(data.deltas.ibPtLm_vs_maskingOnly.tagEchoRatePct.mean));
  assert.ok(Number.isFinite(data.deltas.ibPtLm_vs_ptLm.seenDocTokenF1Pct.mean));
  assert.ok(typeof data.honestAssessment.summary === 'string' && data.honestAssessment.summary.length > 40);
});
