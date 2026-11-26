import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parseScaleBenchmarkArgs,
  scoreAi4PrivacyPredictions,
  wilsonIntervalPct,
} from '../scripts/run-scale-benchmark.mjs';
import {
  evaluateTabShootoutPayload,
  scanForensicTextAnomalies,
} from '../scripts/run-gate-over-detector-and-stitched-shootout.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SCALE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-scale-benchmark.mjs');
const SHOOTOUT_MJS = path.join(REPO_ROOT, 'scripts', 'run-gate-over-detector-and-stitched-shootout.mjs');

function makeSyntheticAi4PrivacyFixture() {
  return [
    {
      id: 'syn_1',
      source_text: 'Contact Alice Rivera at alice.rivera@example.org or 415-555-0192 from 192.168.1.10.',
      privacy_mask: [
        { value: 'Alice', start: 8, end: 13, label: 'FIRSTNAME' },
        { value: 'Rivera', start: 14, end: 20, label: 'LASTNAME' },
        { value: 'alice.rivera@example.org', start: 24, end: 48, label: 'EMAIL' },
        { value: '415-555-0192', start: 52, end: 64, label: 'PHONENUMBER' },
        { value: '192.168.1.10', start: 70, end: 82, label: 'IPV4' },
      ],
    },
    {
      id: 'syn_2',
      source_text: 'Wire IBAN DE89370400440532013000 on 2025-04-12 for Bob Stone.',
      privacy_mask: [
        { value: 'DE89370400440532013000', start: 10, end: 32, label: 'IBAN' },
        { value: '2025-04-12', start: 36, end: 46, label: 'DATE' },
        { value: 'Bob', start: 51, end: 54, label: 'FIRSTNAME' },
        { value: 'Stone', start: 55, end: 60, label: 'LASTNAME' },
      ],
    },
    {
      id: 'syn_3',
      source_text: 'Account 9988776655 belongs to Clara Zhao in Berlin.',
      privacy_mask: [
        { value: '9988776655', start: 8, end: 18, label: 'ACCOUNTNUMBER' },
        { value: 'Clara', start: 30, end: 35, label: 'FIRSTNAME' },
        { value: 'Zhao', start: 36, end: 40, label: 'LASTNAME' },
        { value: 'Berlin', start: 44, end: 50, label: 'CITY' },
      ],
    },
    {
      id: 'syn_4',
      source_text: 'Portal https://portal.example.org/u/42 logged SSN 123-45-6789 at 14:30.',
      privacy_mask: [
        { value: 'https://portal.example.org/u/42', start: 7, end: 38, label: 'URL' },
        { value: '123-45-6789', start: 50, end: 61, label: 'SSN' },
        { value: '14:30', start: 65, end: 70, label: 'TIME' },
      ],
    },
  ];
}

function makeSyntheticTabShootoutPayload(seed = 42) {
  const buildSplit = (prefix, nDocs, unsafeEvery = 2) => {
    const rows = [];
    for (let d = 0; d < nDocs; d++) {
      const docId = `${prefix}_doc_${d}`;
      const isUnsafeDoc = d % unsafeEvery === 0;
      for (let p = 0; p < 3; p++) {
        const unsafe = isUnsafeDoc && p < 2;
        const missedByDetector = unsafe && p === 1 && d % 3 === 0;
        const text = unsafe
          ? `Applicant Markus Pentikainen born 1974 filed case ${1000 + d}/19 in Helsinki district court paragraph ${p}.`
          : `The Court reiterates general principles of statutory interpretation under the Convention in paragraph ${p}.`;
        const spans = unsafe && !missedByDetector
          ? [{ start: 10, end: 28, type: 'PERSON', score: 0.88 }]
          : [];
        rows.push({
          doc_id: docId,
          text,
          unsafe,
          detCount: spans.length,
          maxConf: spans.length > 0 ? 0.88 : 0.0,
          meanConf: spans.length > 0 ? 0.88 : 0.0,
          spanCoverage: spans.length > 0 ? 18 / text.length : 0.0,
          secretCount: 0,
          forensicAnomalyCount: 0,
          residualUnsafe: missedByDetector,
          spans,
        });
      }
    }
    return rows;
  };

  const train = buildSplit('tr', 24, 2);
  const cal = buildSplit('cal', 80, 1); // 80 unsafe clusters so alpha=0.05 certifies cleanly
  const testRows = buildSplit('te', 30, 2);

  return {
    seed,
    bootstraps: 120,
    permutations: 250,
    alphas: [0.05, 0.10, 0.20],
    arms: [
      {
        id: 'presidio_plus_stage3a',
        label: 'Synthetic Stage 3A + Presidio',
        provenanceTag: 'versieve:stage3a+presidio',
        train,
        cal,
        test: testRows,
      },
      {
        id: 'gliner_plus_stage3a',
        label: 'Synthetic Stage 3A + GLiNER-Edge',
        provenanceTag: 'versieve:stage3a+gliner-edge',
        train,
        cal,
        test: testRows,
      },
      {
        id: 'stitched_presidio_detect_secrets_forensic',
        label: 'Synthetic Stitched Stack',
        provenanceTag: 'stitched:presidio+detect-secrets+forensic',
        train,
        cal,
        test: testRows,
      },
    ],
  };
}

test('run-scale-benchmark CLI flag parsing preserves default path and parses external NER flags', () => {
  const def = parseScaleBenchmarkArgs([]);
  assert.equal(def.withPresidio, false);
  assert.equal(def.withGliner, false);
  assert.equal(def.externalOnly, false);
  assert.equal(def.seed, 42);
  assert.equal(def.bootstraps, 1000);
  assert.deepEqual(def.unknownFlags, []);

  const parsed = parseScaleBenchmarkArgs([
    '--with-presidio',
    '--gliner',
    '--external-only',
    '--python', '/opt/py/bin/python3',
    '--spacy-model=en_core_web_sm',
    '--seed', '77',
    '--bootstraps=250',
  ]);
  assert.equal(parsed.withPresidio, true);
  assert.equal(parsed.withGliner, true);
  assert.equal(parsed.externalOnly, true);
  assert.equal(parsed.pythonPath, '/opt/py/bin/python3');
  assert.equal(parsed.spacyModel, 'en_core_web_sm');
  assert.equal(parsed.seed, 77);
  assert.equal(parsed.bootstraps, 250);

  const helpRun = spawnSync(process.execPath, [SCALE_SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(helpRun.status, 0);
  assert.match(helpRun.stdout, /--presidio/);
  assert.match(helpRun.stdout, /--gliner/);
});

test('run-scale-benchmark fails closed with structured JSON and leaves target artifact untouched when runtimes or weights are missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versieve-t8-failclosed-'));
  try {
    const ai4FixturePath = path.join(tmpDir, 'ai4-fixture.json');
    const outJsonPath = path.join(tmpDir, 'scale-out.json');
    const sentinel = { committedBaselineKey: 12345 };
    fs.writeFileSync(ai4FixturePath, JSON.stringify(makeSyntheticAi4PrivacyFixture()), 'utf8');
    fs.writeFileSync(outJsonPath, JSON.stringify(sentinel), 'utf8');

    // 1. Missing Python interpreter -> non-zero exit + structured JSON diagnostic
    const missingPy = spawnSync(
      process.execPath,
      [
        SCALE_SCRIPT,
        '--external-only',
        '--presidio',
        '--python', path.join(tmpDir, 'nonexistent-python-bin'),
        '--ai4privacy-path', ai4FixturePath,
        '--out-json', outJsonPath,
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(missingPy.status, 0, 'Must exit non-zero when Python runtime is missing');
    const diagPy = JSON.parse(missingPy.stderr.trim());
    assert.equal(diagPy.ok, false);
    assert.equal(diagPy.errorCode, 'EXTERNAL_RUNTIME_MISSING');
    assert.ok(Array.isArray(diagPy.missingRuntimes) && diagPy.missingRuntimes.includes('python'));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(outJsonPath, 'utf8')),
      sentinel,
      'Committed artifact must remain byte-untouched when external runtime fails closed'
    );

    // 2. Missing local GLiNER ONNX weights -> non-zero exit + structured JSON diagnostic
    const missingGliner = spawnSync(
      process.execPath,
      [
        SCALE_SCRIPT,
        '--external-only',
        '--gliner',
        '--gliner-model-dir', path.join(tmpDir, 'missing-gliner-dir'),
        '--ai4privacy-path', ai4FixturePath,
        '--out-json', outJsonPath,
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(missingGliner.status, 0, 'Must exit non-zero when GLiNER ONNX weights are missing');
    const diagGl = JSON.parse(missingGliner.stderr.trim());
    assert.equal(diagGl.ok, false);
    assert.equal(diagGl.errorCode, 'EXTERNAL_RUNTIME_MISSING');
    assert.ok(diagGl.missingRuntimes.includes('gliner_edge_onnx_weights'));
    assert.deepEqual(JSON.parse(fs.readFileSync(outJsonPath, 'utf8')), sentinel);

    // 3. Invalid CLI flag -> fail closed
    const badFlag = spawnSync(process.execPath, [SCALE_SCRIPT, '--bogus-flag'], { encoding: 'utf8' });
    assert.notEqual(badFlag.status, 0);
    const diagBad = JSON.parse(badFlag.stderr.trim());
    assert.equal(diagBad.ok, false);
    assert.equal(diagBad.errorCode, 'INVALID_CLI_FLAGS');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scoreAi4PrivacyPredictions computes exact 26-tag recall, precision, Wilson CI, and seeded bootstrap CI', () => {
  const records = makeSyntheticAi4PrivacyFixture();
  // Predictions hit EMAIL, PHONENUMBER, Alice (record 0), IBAN (record 1), URL, SSN (record 3), plus 1 false positive
  const preds = [
    [
      { start: 8, end: 13, type: 'PERSON', score: 0.9 },
      { start: 24, end: 48, type: 'EMAIL', score: 0.99 },
      { start: 52, end: 64, type: 'PHONE_NUMBER', score: 0.95 },
      { start: 0, end: 7, type: 'PERSON', score: 0.6 }, // false positive ("Contact")
    ],
    [{ start: 10, end: 32, type: 'IBAN_CODE', score: 0.95 }],
    [],
    [
      { start: 7, end: 38, type: 'URL', score: 0.92 },
      { start: 50, end: 61, type: 'US_SSN', score: 0.98 },
    ],
  ];

  const s42a = scoreAi4PrivacyPredictions(records, preds, { seed: 42, bootstraps: 200 });
  const s42b = scoreAi4PrivacyPredictions(records, preds, { seed: 42, bootstraps: 200 });
  assert.deepEqual(s42a, s42b, 'Identical seed must yield byte-identical scored metrics');

  // 26-tag GT spans in fixture: EMAIL, PHONENUMBER, IPV4 (3) + IBAN, DATE (2) + ACCOUNTNUMBER (1) + URL, SSN, TIME (3) = 9
  // Detected 26-tag spans: EMAIL, PHONENUMBER, IBAN, URL, SSN = 5 / 9 (55.56%)
  assert.equal(s42a.structured26.gtTotal, 9);
  assert.equal(s42a.structured26.tp, 5);
  assert.equal(s42a.structured26.spans, '5/9');
  assert.equal(s42a.structured26.recallPct, 55.56);
  assert.equal(s42a.structured26.valueMatchSpans, '5/9');
  assert.equal(s42a.structured26.valueMatchRecallPct, 55.56);
  // Total predictions = 7; 6 overlap true privacy_mask spans (including Alice PERSON), 1 FP ("Contact") -> 6/7 = 85.71%
  assert.equal(s42a.structured26.predTotal, 7);
  assert.equal(s42a.structured26.predTp, 6);
  assert.equal(s42a.structured26.precisionPct, 85.71);
  assert.deepEqual(s42a.structured26.recallWilson95CI, wilsonIntervalPct(5, 9));
});

test('Gate-Over-Best-Detector & Stitched Shootout CLI verifies T2 adapter contract, deterministic seed, and output schema', async () => {
  // Forensic hidden-channel text check
  assert.equal(scanForensicTextAnomalies('Clean legal ruling paragraph.').hasAnomaly, false);
  const hidden = scanForensicTextAnomalies('Sneaky\u200Bzero-width and \u202Ebidi override.');
  assert.equal(hidden.hasAnomaly, true);
  assert.equal(hidden.anomalyCount, 2);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versieve-t8-shootout-'));
  try {
    const inPath = path.join(tmpDir, 'fixture-in.json');
    const outPath1 = path.join(tmpDir, 'out-1.json');
    const outPath2 = path.join(tmpDir, 'out-2.json');
    const payload = makeSyntheticTabShootoutPayload(42);
    fs.writeFileSync(inPath, JSON.stringify(payload), 'utf8');

    const r1 = spawnSync(process.execPath, [SHOOTOUT_MJS, '--fixture-input', inPath, '--out', outPath1], { encoding: 'utf8' });
    assert.equal(r1.status, 0, `CLI run 1 failed: ${r1.stderr}`);
    const r2 = spawnSync(process.execPath, [SHOOTOUT_MJS, '--fixture-input', inPath, '--out', outPath2], { encoding: 'utf8' });
    assert.equal(r2.status, 0, `CLI run 2 failed: ${r2.stderr}`);

    const raw1 = fs.readFileSync(outPath1, 'utf8');
    const raw2 = fs.readFileSync(outPath2, 'utf8');
    assert.equal(raw1, raw2, 'Repeated runs with seed=42 must be 100% byte-identical');

    const report = JSON.parse(raw1);
    assert.equal(report.schemaVersion, 'versieve.t8.gate-over-detector-and-stitched-shootout.v1');
    assert.equal(report.seed, 42);
    assert.equal(report.splits.calClusters, 80);
    assert.equal(report.splits.testClusters, 30);

    for (const armKey of ['presidio_plus_stage3a', 'gliner_plus_stage3a', 'stitched_presidio_detect_secrets_forensic']) {
      const arm = report.gateOverDetectorArms[armKey];
      assert.ok(arm, `Missing arm ${armKey}`);
      assert.equal(arm.t2AdapterVerification.t2ContractVerified, true, `T2 adapter contract must pass on ${armKey}`);
      assert.equal(arm.t2AdapterVerification.localOnly, true);
      assert.equal(arm.hcCrcSweep.length, 3);
      assert.equal(arm.eLttSweep.length, 3);
      for (const row of arm.hcCrcSweep) {
        assert.equal(row.e2eResidualLeakOfReleasedBootstrap95CI.length, 2);
        assert.ok(typeof row.vsDetectorAlone.pairedDocPermutationP === 'number');
        assert.ok(typeof row.vsPlainThresholdAtMatchedSafeYield.plainE2eLeakOfReleasedPct === 'number');
      }
    }

    assert.equal(report.stitchedBaselineShootout.length, 2);
    for (const comp of report.stitchedBaselineShootout) {
      assert.ok(Array.isArray(comp.matchedSafeYieldComparisons));
      assert.ok(comp.matchedSafeYieldComparisons.length >= 1);
    }

    // Verify direct programmatic API seed sensitivity on resampled CIs
    const repSeed99 = await evaluateTabShootoutPayload(makeSyntheticTabShootoutPayload(99));
    assert.equal(repSeed99.seed, 99);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
