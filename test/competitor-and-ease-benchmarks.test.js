/**
 * test/competitor-and-ease-benchmarks.test.js
 * External-behavior contract tests for Issue #36 ([T9] Competitor Benchmarks & Objective Ease Benchmark).
 *
 * Verifies:
 *  1. `screenleak` multi-modal adapter (text + rendered RGB image IoU >= 0.30 zero-leak rate,
 *     pixel blackout verification, optional local ONNX `gliner-pii-edge` fail-closed vs reproduced-local,
 *     and strict separation of `reproduced-local` vs `self-reported-leaderboard` provenance).
 *  2. `osint-shifu/unmasker` 27-detector forensic specimen suite (exact 27 deterministic categories,
 *     honest `detectedCategories`/`missedCategories`/`coveragePct`, and non-fabricated `externalCliAvailable`).
 *  3. `MAT2` multi-format metadata-stripping parity across PDF, PNG, JPEG, WAV, MP4, DOCX, and EML
 *     (`afterMetadataResidualBytes === 0`, exact `strippedFields`, honest `externalMat2CliAvailable`).
 *  4. Objective Ease Benchmark (`vendor/wasm/*.wasm` 388,797 B + `src/` JS footprint vs local Python stack,
 *     runtime counts, executable minimal snippet LOC, cold-start spawnSync median >= 5 runs, deterministic
 *     schema, and README-ready `markdownTable` free of banned words, em-dashes, and unverified tool names).
 *  5. Committed `results/competitor-benchmarks.json` and `results/ease-benchmark.json` artifact integrity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { computeBoxIoU } from '../src/perceive.js';
import {
  runCompetitorBenchmarks,
  runScreenleakBenchmark,
  runUnmaskerSpecimenSuite,
  runMat2MetadataParity,
} from '../scripts/run-competitor-benchmarks.mjs';
import { runEaseBenchmark } from '../scripts/run-ease-benchmark.mjs';

const COMPETITOR_JSON_PATH = path.resolve('results/competitor-benchmarks.json');
const EASE_JSON_PATH = path.resolve('results/ease-benchmark.json');

const EXPECTED_27_UNMASKER_CATEGORIES = [
  'pdf_covered_text_under_black_bar',
  'pdf_incremental_revision_leak',
  'pdf_rendering_mode_3',
  'pdf_white_on_white_text',
  'pdf_tiny_sublegible_font',
  'pdf_off_page_text',
  'pdf_metadata',
  'docx_vanish_text',
  'docx_white_text',
  'docx_tiny_text',
  'docx_comments_and_revisions',
  'xlsx_very_hidden_sheet',
  'xlsx_pivot_cache',
  'xlsx_comments',
  'pptx_speaker_notes',
  'pptx_hidden_slides',
  'eml_tracking_headers',
  'eml_nested_zip_eml_attachments',
  'msg_cfbf_streams',
  'unicode_zero_width',
  'unicode_bidi_controls',
  'unicode_homoglyphs',
  'unicode_fullwidth',
  'exif_jpeg_metadata',
  'png_text_itxt_metadata',
  'wav_riff_info_metadata',
  'mp4_udta_meta_metadata',
];

const EXPECTED_MAT2_FORMATS = ['pdf', 'png', 'jpeg', 'wav', 'mp4', 'docx', 'eml'];

const BANNED_PROSE_PATTERNS = [
  ['mathematically grounded', /mathematically\s+grounded/i],
  ['mathematically certified', /mathematically\s+certified/i],
  ['eliminates/eliminating', /\beliminat(?:e|es|ed|ing)\b/i],
  ['novelty "first"', /\b(?:first to|the first|for the first time|our first)\b/i],
  ['unverified no-prior claim', /\b(?:to our knowledge[,\s]+no prior|not aware of a prior corpus)\b/i],
  ['unqualified 100% WASM tagline', /100%\s+locally\s+in\s+WebAssembly/i],
  ['rejected unverified tool', /\b(?:Cloak|OSpipe|open-redactor|ALDS|mask-llm)\b/i],
  ['unicode em-dash', /\u2014/],
];

test('T9.1: screenleak benchmark adapter evaluates text + image IoU >= 0.30 deterministically, separates provenance, and fails closed on missing ONNX weights', async () => {
  const runA = await runScreenleakBenchmark({ seed: 42, includeOptionalOnnx: false });
  const runB = await runScreenleakBenchmark({ seed: 42, includeOptionalOnnx: false });

  // Deterministic scores across runs (ignoring wall-clock timestamps/latencies)
  assert.deepEqual(runA.localRuns.versieve_builtin_wasm.text, runB.localRuns.versieve_builtin_wasm.text);
  assert.deepEqual(runA.localRuns.versieve_builtin_wasm.image, runB.localRuns.versieve_builtin_wasm.image);

  const builtin = runA.localRuns.versieve_builtin_wasm;
  assert.equal(builtin.sourceType, 'reproduced-local');
  assert.equal(builtin.zeroEgress, true);
  assert.equal(builtin.requiresExternalWeights, false);

  // Text metrics contract
  assert.ok(builtin.text.totalSpecimens >= 12);
  assert.ok(builtin.text.piiBearingSpecimens >= 10);
  assert.ok(builtin.text.benignSpecimens >= 2);
  assert.ok(builtin.text.totalGroundTruthSpans >= 25);
  assert.ok(builtin.text.specimenZeroLeakRatePct >= 0 && builtin.text.specimenZeroLeakRatePct <= 100);
  assert.ok(builtin.text.spanRecallPct > 60 && builtin.text.spanRecallPct <= 100);
  assert.ok(builtin.text.spanPrecisionPct > 70 && builtin.text.spanPrecisionPct <= 100);
  assert.ok(Array.isArray(builtin.text.zeroLeakWilson95CI) && builtin.text.zeroLeakWilson95CI.length === 2);

  // Image IoU >= 0.30 metrics contract
  assert.equal(builtin.image.iouThreshold, 0.3);
  assert.ok(builtin.image.totalFrames >= 8);
  assert.ok(builtin.image.totalGroundTruthBoxes >= 16);
  assert.ok(builtin.image.regionRecallAtIou030Pct >= 75, `Expected region recall >= 75%, got ${builtin.image.regionRecallAtIou030Pct}%`);
  assert.ok(builtin.image.imageZeroLeakRatePct >= 70, `Expected image zero-leak >= 70%, got ${builtin.image.imageZeroLeakRatePct}%`);
  assert.ok(builtin.image.meanMatchedIou >= 0.3, `Mean matched IoU must be >= 0.30, got ${builtin.image.meanMatchedIou}`);
  assert.equal(builtin.image.pixelRedactionVerified, true);

  // Independently verify computeBoxIoU >= 0.30 on recorded per-frame matched box pairs
  for (const frame of builtin.image.perFrameResults) {
    for (const match of frame.matchedPairs) {
      const recomputedIou = computeBoxIoU(match.predictedBox, match.groundTruthBox);
      assert.ok(recomputedIou >= 0.3, `Recorded match IoU ${recomputedIou} fell below 0.30`);
      assert.ok(Math.abs(recomputedIou - match.iou) < 1e-3);
    }
  }

  // Missing optional ONNX weights must fail closed cleanly and never fabricate scores
  const missingWeightsRun = await runScreenleakBenchmark({
    seed: 42,
    includeOptionalOnnx: true,
    onnxModelPath: path.resolve('nonexistent-weights-dir/missing_gliner.onnx'),
  });
  const onnxMissing = missingWeightsRun.localRuns.versieve_plus_gliner_pii_edge_onnx;
  assert.equal(onnxMissing.available, false);
  assert.equal(onnxMissing.failClosedCheckPassed, true);
  assert.equal(onnxMissing.failClosedErrorCode, 'DETECTOR_WEIGHTS_MISSING');
  assert.equal(onnxMissing.text, null, 'Must never fabricate metrics when optional ONNX weights are absent');

  // Cited external baselines must be strictly labeled self-reported-leaderboard and never mixed into localRuns
  assert.ok(Array.isArray(runA.citedExternalBaselines) && runA.citedExternalBaselines.length >= 2);
  for (const ext of runA.citedExternalBaselines) {
    assert.equal(ext.sourceType, 'self-reported-leaderboard');
    assert.equal(ext.comparableToLocalRun, false);
    assert.equal(typeof ext.provenanceNote, 'string');
    assert.ok(ext.provenanceNote.length > 20);
  }
  const screenpipeRow = runA.citedExternalBaselines.find((b) => b.id === 'screenpipe_local_models');
  const presidioRow = runA.citedExternalBaselines.find((b) => b.id === 'microsoft_presidio_on_screenleak');
  assert.ok(screenpipeRow && presidioRow);
  assert.equal(screenpipeRow.selfReportedTextZeroLeakPct, 86.7);
  assert.equal(screenpipeRow.selfReportedImageZeroLeakIou030Pct, 98.9);
  assert.equal(presidioRow.selfReportedTextZeroLeakPct, 35.4);
  assert.equal(presidioRow.selfReportedImageZeroLeakIou030Pct, 0.5);
});

test('T9.2: unmasker 27-detector specimen suite covers all 27 forensic categories deterministically and reports missing CLI honestly', async () => {
  const suiteA = await runUnmaskerSpecimenSuite({ forceExternalCliUnavailable: true });
  const suiteB = await runUnmaskerSpecimenSuite({ forceExternalCliUnavailable: true });

  assert.equal(suiteA.sourceType, 'reproduced-local');
  assert.equal(suiteA.totalCategories, 27);
  assert.equal(suiteA.specimens.length, 27);
  assert.deepEqual(
    suiteA.specimens.map((s) => s.category),
    EXPECTED_27_UNMASKER_CATEGORIES
  );

  // Determinism across runs
  assert.deepEqual(suiteA.detectedCategories, suiteB.detectedCategories);
  assert.deepEqual(suiteA.missedCategories, suiteB.missedCategories);
  assert.equal(suiteA.coveragePct, suiteB.coveragePct);

  // Partition invariant: detected + missed === 27
  assert.equal(
    suiteA.detectedCategories.length + suiteA.missedCategories.length,
    27,
    'detectedCategories + missedCategories must partition all 27 categories'
  );
  const expectedPct = Number(((suiteA.detectedCategories.length / 27) * 100).toFixed(2));
  assert.equal(suiteA.coveragePct, expectedPct);
  assert.ok(suiteA.detectedCount >= 25, `Expected Versieve to detect >= 25/27 forensic categories, got ${suiteA.detectedCount}`);

  // Honest external CLI reporting (never fabricates external unmasker CLI runs)
  assert.equal(suiteA.externalCliAvailable, false);
  assert.equal(suiteA.externalCliPath, null);
  assert.equal(suiteA.externalCliResults, null);
});

test('T9.3: MAT2 metadata-stripping parity verifies 0 residual metadata bytes across all 7 formats and honest CLI probe', async () => {
  const mat2Res = await runMat2MetadataParity({ forceExternalCliUnavailable: true });

  assert.equal(mat2Res.sourceType, 'reproduced-local');
  assert.equal(mat2Res.externalMat2CliAvailable, false);
  assert.equal(mat2Res.externalMat2CliPath, null);
  assert.equal(mat2Res.externalMat2CliResults, null);

  assert.deepEqual(
    mat2Res.fixtures.map((f) => f.format),
    EXPECTED_MAT2_FORMATS
  );
  assert.equal(mat2Res.totalFixtures, 7);
  assert.equal(mat2Res.zeroResidualCount, 7);
  assert.equal(mat2Res.allZeroResidualVerified, true);

  for (const fix of mat2Res.fixtures) {
    assert.ok(fix.beforeMetadataResidualBytes > 0, `${fix.format} fixture must start with planted metadata bytes > 0`);
    assert.equal(fix.afterMetadataResidualBytes, 0, `${fix.format} must have 0 residual metadata bytes after scrubbing`);
    assert.ok(Array.isArray(fix.strippedFields) && fix.strippedFields.length >= 1, `${fix.format} must record strippedFields`);
    assert.ok(fix.beforeSha256 !== fix.afterSha256, `${fix.format} before/after SHA-256 must differ`);
    assert.equal(fix.zeroResidualVerified, true);
  }
});

test('T9.4: Objective Ease Benchmark measures footprint, runtimes, executable LOC, cold-start latency, and clean README markdown table', async () => {
  const ease = await runEaseBenchmark({ coldStartRuns: 5, seed: 42 });

  assert.equal(ease.seed, 42);
  assert.equal(ease.sourceType, 'reproduced-local');
  assert.ok(ease.hardware && typeof ease.hardware.cpuModel === 'string' && ease.hardware.totalMemBytes > 0);
  assert.ok(ease.versions && ease.versions.node.startsWith('v'));

  // 1. Install footprint: 5 zero-import WASM kernels = 388,797 B + src/*.js bytes
  const vs = ease.versieve;
  assert.equal(vs.wasmKernelCount, 5);
  assert.equal(vs.wasmAllZeroImports, true);
  assert.equal(vs.installFootprint.wasmBytes, 388797);
  assert.ok(vs.installFootprint.jsSrcBytes > 100_000);
  assert.equal(
    vs.installFootprint.totalCoreBytes,
    vs.installFootprint.wasmBytes + vs.installFootprint.jsSrcBytes
  );
  assert.equal(vs.requiredExternalRuntimesCount, 1);
  assert.deepEqual(vs.requiredExternalRuntimes, ['Node.js >= 22']);

  // 2. Lines of code to first redacted + receipted output (executed live to prove working snippet!)
  assert.ok(vs.minimalSnippet.loc >= 3 && vs.minimalSnippet.loc <= 10);
  assert.equal(vs.minimalSnippet.liveExecutionVerified, true);
  assert.equal(vs.minimalSnippet.redactedPiiLeakCount, 0);
  assert.match(vs.minimalSnippet.receiptSha256, /^[0-9a-f]{64}$/);

  // 3. Cold-start latency (>= 5 runs via spawnSync)
  assert.ok(vs.coldStart.runs >= 5);
  assert.equal(vs.coldStart.samplesMs.length, vs.coldStart.runs);
  assert.ok(vs.coldStart.medianMs > 0 && vs.coldStart.medianMs < 5000);

  // 4. Stitched Python comparator (real local C:\Python312 measurement when available, else honest fail-closed)
  const st = ease.stitchedPythonStack;
  assert.ok(st.requiredExternalRuntimesCount >= 3);
  assert.ok(st.minimalSnippet.loc > vs.minimalSnippet.loc);
  if (st.available) {
    assert.ok(st.installFootprint.totalBytes > 50 * 1024 * 1024, 'Presidio + spaCy + en_core_web_lg + detect-secrets must exceed 50 MB on disk');
    assert.ok(st.coldStart.runs >= 5);
    assert.equal(st.coldStart.samplesMs.length, st.coldStart.runs);
    assert.ok(st.coldStart.medianMs > vs.coldStart.medianMs, 'Python Presidio+spaCy cold start should exceed Node+WASM cold start');
    assert.ok(ease.ratios.footprintRatio > 20);
    assert.ok(ease.ratios.coldStartSpeedup > 1.0);
  } else {
    assert.equal(st.coldStart, null);
  }

  // Also verify fail-closed behavior when Python path is absent
  const missingPyEase = await runEaseBenchmark({
    coldStartRuns: 5,
    seed: 42,
    pythonExecutable: 'C:\\nonexistent_python_dir\\python.exe',
  });
  assert.equal(missingPyEase.stitchedPythonStack.available, false);
  assert.equal(missingPyEase.stitchedPythonStack.coldStart, null);

  // 5. README-ready Markdown table checks (valid GFM + zero banned words / em-dashes / rejected tools)
  assert.equal(typeof ease.markdownTable, 'string');
  assert.match(ease.markdownTable, /^\|.+\|$/m);
  assert.ok(ease.markdownTable.includes('388,797 B'));
  for (const [label, rx] of BANNED_PROSE_PATTERNS) {
    assert.equal(rx.test(ease.markdownTable), false, `markdownTable violated prose ban: ${label}`);
  }
  const proseTripleDash = ease.markdownTable
    .split(/\r?\n/)
    .some((line) => line.includes('---') && !/^\s*---\s*$/.test(line) && !/^\|[\s|:-]+\|$/.test(line.trim()));
  assert.equal(proseTripleDash, false, 'markdownTable must not contain prose --- em-dashes');
});

test('T9.5: Committed results/competitor-benchmarks.json and results/ease-benchmark.json exist and satisfy full provenance & schema contracts', async () => {
  assert.equal(fs.existsSync(COMPETITOR_JSON_PATH), true, 'Missing results/competitor-benchmarks.json');
  assert.equal(fs.existsSync(EASE_JSON_PATH), true, 'Missing results/ease-benchmark.json');

  const comp = JSON.parse(fs.readFileSync(COMPETITOR_JSON_PATH, 'utf8'));
  const ease = JSON.parse(fs.readFileSync(EASE_JSON_PATH, 'utf8'));

  assert.equal(comp.seed, 42);
  assert.ok(comp.environment && comp.environment.nodeVersion);
  assert.ok(comp.licenses && typeof comp.licenses === 'object');
  assert.equal(comp.screenleak.localRuns.versieve_builtin_wasm.sourceType, 'reproduced-local');
  assert.equal(comp.screenleak.localRuns.versieve_builtin_wasm.image.iouThreshold, 0.3);
  assert.ok(comp.screenleak.citedExternalBaselines.every((b) => b.sourceType === 'self-reported-leaderboard'));
  assert.equal(comp.unmaskerSpecimens.totalCategories, 27);
  assert.equal(comp.mat2MetadataParity.allZeroResidualVerified, true);
  assert.equal(comp.mat2MetadataParity.zeroResidualCount, 7);

  // Verify runCompetitorBenchmarks() matches committed structure
  const freshComp = await runCompetitorBenchmarks({ seed: 42, includeOptionalOnnx: false });
  assert.deepEqual(
    freshComp.unmaskerSpecimens.detectedCategories,
    comp.unmaskerSpecimens.detectedCategories
  );
  assert.equal(freshComp.mat2MetadataParity.zeroResidualCount, comp.mat2MetadataParity.zeroResidualCount);

  assert.equal(ease.seed, 42);
  assert.equal(ease.versieve.installFootprint.wasmBytes, 388797);
  assert.ok(ease.versieve.coldStart.runs >= 5);
  assert.ok(typeof ease.markdownTable === 'string' && ease.markdownTable.length > 100);
});
