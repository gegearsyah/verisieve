import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { binomCdf } from '../src/gatekeeper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, 'results', 'reviewer-tab-and-ltt-benchmarks.json');

// Pinned SHA-256 of JSON.stringify(preT7Object, null, 2) for the 10 pre-T7 baseline keys
// in results/reviewer-tab-and-ltt-benchmarks.json (guarantees byte-identical preservation).
const PRE_T7_BASELINE_KEYS = [
  'generatedAt',
  'dataset',
  'devNomaskFilterTermsLearned',
  'optThresholds',
  'allMaskableAblation',
  'allMaskableSignificance',
  'personComparison',
  'personSignificance',
  'prCurves',
  'nonCircularGroundTruthLtt',
];
const PRE_T7_BASELINE_SHA256 = '8364d63fc8c56b523f1434bc35cf57256703207186b9757c3af83ad73f34d262';

// Reference Angelopoulos et al. (2021, LTT arXiv:2110.01052) exact binomial tail p-values
// P(Bin(n, p) <= k) cross-checked against scipy.stats.binom.cdf across small, medium, and large n.
const LTT_BINOM_REFERENCE_TABLE = [
  // [k, n, p, exactScipyBinomCdf]
  [0, 10, 0.05, 0.5987369392383789],
  [1, 20, 0.10, 0.3917469981251681],
  [0, 67, 0.01, 0.5099857462495656],
  [0, 67, 0.02, 0.2583134806688347],
  [0, 67, 0.05, 0.03217225885613068],
  [2, 67, 0.10, 0.030719325917297983],
  [0, 299, 0.01, 0.049536256637662465],
  [0, 350, 0.01, 0.02967003845097719],
  [3, 350, 0.02, 0.0796755937781575],
  [10, 350, 0.05, 0.03526974137116386],
  [24, 350, 0.10, 0.02610612806398395],
  [4, 916, 0.01, 0.049004130768853064],
  [33, 916, 0.05, 0.026788097821434445],
  [76, 916, 0.10, 0.04536022099362622],
  [40, 1000, 0.05, 0.08063657325669099],
  [230, 5000, 0.05, 0.10176421488625545],
  [480, 5000, 0.10, 0.17923038420381807],
];

test('shipped binomCdf matches Angelopoulos et al. LTT / scipy.stats.binom.cdf reference values to < 1e-11', () => {
  assert.equal(binomCdf(-1, 100, 0.05), 0);
  assert.equal(binomCdf(100, 100, 0.05), 1);
  assert.equal(binomCdf(0, 100, 0), 1);

  for (const [k, n, p, expected] of LTT_BINOM_REFERENCE_TABLE) {
    const actual = binomCdf(k, n, p);
    const diff = Math.abs(actual - expected);
    assert.ok(
      diff < 1e-11,
      `binomCdf(${k}, ${n}, ${p}) = ${actual}, expected ${expected} (diff=${diff})`
    );
  }

  // Monotonicity invariants of LTT p-value: non-decreasing in k, non-increasing in p
  for (const n of [25, 67, 350, 916]) {
    for (const p of [0.01, 0.05, 0.10, 0.20]) {
      let prev = -1;
      for (let k = 0; k <= Math.min(n, 40); k++) {
        const cur = binomCdf(k, n, p);
        assert.ok(cur >= prev - 1e-14, `binomCdf must be non-decreasing in k at n=${n}, p=${p}`);
        prev = cur;
      }
    }
    const alphas = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20];
    for (const k of [0, 2, 5]) {
      let prevPVal = 2.0;
      for (const a of alphas) {
        const cur = binomCdf(k, n, a);
        assert.ok(cur <= prevPVal + 1e-14, `binomCdf must be non-increasing in alpha at n=${n}, k=${k}`);
        prevPVal = cur;
      }
    }
  }
});

test('results/reviewer-tab-and-ltt-benchmarks.json preserves all pre-T7 baseline fields byte-identically', () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const baselineSlice = {};
  for (const k of PRE_T7_BASELINE_KEYS) {
    assert.ok(Object.hasOwn(artifact, k), `missing committed baseline key: ${k}`);
    baselineSlice[k] = artifact[k];
  }
  const actualSha = crypto
    .createHash('sha256')
    .update(JSON.stringify(baselineSlice, null, 2))
    .digest('hex');
  assert.equal(
    actualSha,
    PRE_T7_BASELINE_SHA256,
    'existing committed baseline fields in reviewer-tab-and-ltt-benchmarks.json were modified!'
  );
});

test('Dunn, Lee, and HG-CRC guarantee baselines satisfy alpha-monotonicity and split invariants', () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const t7b = artifact.t7GuaranteeBaselines;
  assert.ok(t7b, 'missing t7GuaranteeBaselines in artifact');

  const expectedAlphas = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20];
  assert.deepEqual(t7b.methodology.alphas, expectedAlphas);
  assert.equal(t7b.methodology.delta, 0.05);
  assert.equal(t7b.methodology.subsamplingSeed, 42);
  assert.equal(t7b.methodology.repeatedSubsamplingDraws, 200);
  assert.equal(t7b.methodology.calibrationSplit.nUnsafeClusters, 67);
  assert.equal(t7b.methodology.calibrationSplit.nUnsafeParagraphs, 916);
  assert.equal(t7b.methodology.heldOutTestSplit.nRulings, 127);
  assert.equal(t7b.methodology.heldOutTestSplit.nTotalParagraphs, 1999);
  assert.equal(t7b.methodology.heldOutTestSplit.nUnsafeParagraphs, 1623);
  assert.equal(t7b.methodology.heldOutTestSplit.nSafeParagraphs, 376);

  const baselineNames = [
    'dunnSubsamplingSingleDraw',
    'dunnRepeatedSubsamplingPooling',
    'leeClusterWeightedSplit',
    'leeClusterWeightedHighProbHb',
    'hgCrcGroupConditional',
  ];

  for (const name of baselineNames) {
    const rows = t7b[name];
    assert.ok(Array.isArray(rows) && rows.length === expectedAlphas.length, `invalid sweep for ${name}`);
    assert.deepEqual(rows.map((r) => r.alpha), expectedAlphas);

    let seenCertified = false;
    let prevTau = Infinity;
    let prevFpr = -1;
    let prevYield = -1;
    let prevAutoRel = -1;

    for (const r of rows) {
      if (!r.certified) {
        assert.equal(seenCertified, false, `${name}: certification cannot revert from true to false at alpha=${r.alpha}`);
        assert.equal(r.threshold, null);
        assert.equal(r.autoReleasedCount, 0);
        assert.equal(r.testConditionalFprPct, 0);
        assert.equal(r.testSafeYieldPct, 0);
      } else {
        seenCertified = true;
        assert.ok(typeof r.threshold === 'number' && r.threshold > 0 && r.threshold < 1);
        assert.ok(r.threshold <= prevTau + 1e-12, `${name}: threshold must be non-increasing in alpha`);
        prevTau = r.threshold;
      }
      assert.ok(r.testConditionalFprPct >= prevFpr - 1e-12, `${name}: FPR must be non-decreasing in alpha`);
      assert.ok(r.testSafeYieldPct >= prevYield - 1e-12, `${name}: Safe Yield must be non-decreasing in alpha`);
      assert.ok(r.overallAutoReleasePct >= prevAutoRel - 1e-12, `${name}: Auto-Release must be non-decreasing in alpha`);
      prevFpr = r.testConditionalFprPct;
      prevYield = r.testSafeYieldPct;
      prevAutoRel = r.overallAutoReleasePct;
    }
  }

  // HG-CRC simultaneous global+subgroup risk control must be at least as conservative as global Lee split
  for (let i = 0; i < expectedAlphas.length; i++) {
    const lee = t7b.leeClusterWeightedSplit[i];
    const hg = t7b.hgCrcGroupConditional[i];
    if (hg.certified) {
      assert.equal(lee.certified, true);
      assert.ok(
        hg.threshold >= lee.threshold - 1e-12,
        `HG-CRC threshold (${hg.threshold}) must be >= Lee global threshold (${lee.threshold}) at alpha=${hg.alpha}`
      );
      assert.ok(
        hg.worstSubgroupTestFprPct <= hg.alpha * 100 + 1e-9,
        `HG-CRC worst-subgroup held-out FPR (${hg.worstSubgroupTestFprPct}%) exceeded budget at alpha=${hg.alpha}`
      );
    }
  }
});

test('tau=0.70 SR-MP bootstrap artifact stores seed 42, 1,000 resamples, 127-doc TP/FP/FN arrays, and corpus licenses', () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const t7t = artifact.t7Tau070SrmpBootstrap;
  assert.ok(t7t, 'missing t7Tau070SrmpBootstrap in artifact');
  assert.equal(t7t.threshold, 0.70);
  assert.equal(t7t.seed, 42);
  assert.equal(t7t.bootstrapResamples, 1000);
  assert.equal(t7t.permutationResamplesPreserved, 5000);

  const srmp = t7t.srmpPerson;
  assert.equal(srmp.perDocTp.length, 127);
  assert.equal(srmp.perDocFp.length, 127);
  assert.equal(srmp.perDocFn.length, 127);
  assert.equal(srmp.perDocTpFpFn.length, 127);

  const sumTp = srmp.perDocTp.reduce((a, b) => a + b, 0);
  const sumFp = srmp.perDocFp.reduce((a, b) => a + b, 0);
  const sumFn = srmp.perDocFn.reduce((a, b) => a + b, 0);
  assert.equal(sumTp, 251);
  assert.equal(sumFp, 22);
  assert.equal(sumFn, 707);
  assert.equal(srmp.f1Pct, 40.78);
  assert.deepEqual(srmp.f1Bootstrap95CI, [33.42, 47.29]);

  const licenses = artifact.t7CorpusLicensesAndSeeds;
  assert.ok(licenses && licenses.corporaAndModels && licenses.seedsByExperiment);
  for (const requiredKey of [
    'tabEchr',
    'pstuSyntheticSecrets',
    'yelpDetectSecretsTestData',
    'mbpp',
    'enronAeslc',
    'ai4privacy200k',
    'funsd',
    'libriSpeech',
    'localSyntheticAudioTts',
    'glinerPiiEdge',
  ]) {
    const entry = licenses.corporaAndModels[requiredKey];
    assert.ok(entry && typeof entry.license === 'string' && entry.license.length > 0, `missing license for ${requiredKey}`);
  }
  assert.equal(licenses.seedsByExperiment.exp1_tabEchrBootstrapAndPermutation.seed, 42);
  assert.equal(licenses.seedsByExperiment.exp2_tabGtLttAndGuaranteeBaselines.dunnSubsamplingSeed, 42);
  assert.equal(licenses.seedsByExperiment.exp3_externalSecretsAndUnicodeNfkc.stochastic, false);
  assert.equal(licenses.seedsByExperiment.exp4_audio25CallCrossModel.stochastic, false);
  assert.equal(licenses.seedsByExperiment.exp5_pprlAndGcCrcStressSuite.stochastic, false);
});

test('Python hierarchical conformal helper enforces monotonicity on synthetic cluster fixture', (t) => {
  const pyExe = fs.existsSync('C:\\Python312\\python.exe') ? 'C:\\Python312\\python.exe' : 'python';
  const probe = spawnSync(pyExe, ['-c', 'import scipy, numpy; print("ok")'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('Python with scipy/numpy unavailable on this host');
    return;
  }

  const pyCode = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("m", "scripts/run-reviewer-tab-and-ltt.py")',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'cal = [{"doc_id": f"c{i}", "totalParagraphs": 10 if i < 20 else 25, "group": "short_ruling" if i < 20 else "long_ruling", "unsafeProbs": [0.05 + 0.01 * (i % 15), 0.12 + 0.01 * (i % 10)]} for i in range(40)]',
    'test_items = [{"unsafe": i % 2 == 0, "residualUnsafe": i % 4 == 0, "group": "short_ruling" if i < 20 else "long_ruling"} for i in range(40)]',
    'test_probs = [0.05 + 0.02 * i for i in range(40)]',
    'res = m.evaluate_hierarchical_baselines_from_clusters(cal, test_items, test_probs, [0.05, 0.10, 0.20], delta=0.05, seed=42, n_draws=50)',
    'print(json.dumps(res))',
  ].join('; ');

  const run = spawnSync(pyExe, ['-c', pyCode], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  for (const key of Object.keys(parsed)) {
    const fprs = parsed[key].map((r) => r.testConditionalFprPct);
    assert.ok(fprs[0] <= fprs[1] && fprs[1] <= fprs[2], `non-monotone synthetic FPR for ${key}: ${fprs}`);
  }
});
