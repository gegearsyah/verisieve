import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  runHeadToHeadComparison,
  runTest1ScientificCorruption,
  runTest2NoisyOcrHazardLeakage,
  runTest3MultimodalPixelExposure,
  runTest4HeldOutFalseAlarmRate,
  runTest5WasmRetrievalPurityAndLoss,
  generateHeadToHeadComparisonSvg
} from '../src/head-to-head-comparison.js';
import { chatWithTrainedModelsWasm } from '../src/wasm-needle-dl.js';
import {
  buildPublicBenchmarkCorpus,
  buildThousandPdfCorpus,
  runScaleAndParadigmBenchmark,
  generateScaleAndParadigmBenchmarkSvg
} from '../src/scale-benchmark.js';

test('1. Test 1 — Scientific & Technical False-Positive Corruption vs Real Name Recall', () => {
  const res = runTest1ScientificCorruption();
  const r = res.results;

  // Pipeline A: Raw Dump
  assert.strictEqual(r.raw_no_verisieve.false_positive_corruption_rate_pct, 0.0);
  assert.strictEqual(r.raw_no_verisieve.real_name_recall_pct, 0.0);

  // Pipeline B: Naive Regex Scrubber
  assert.ok(r.naive_regex_only.false_positive_corruption_rate_pct > 50.0, 'Naive regex must have >50% FP corruption');
  assert.ok(r.naive_regex_only.real_name_recall_pct >= 80.0, 'Naive regex catches names at cost of heavy corruption');

  // Pipeline C: Uncalibrated Heuristic
  assert.strictEqual(r.uncalibrated_heuristic.false_positive_corruption_rate_pct, 0.0);
  assert.strictEqual(r.uncalibrated_heuristic.real_name_recall_pct, 100.0);

  // Pipeline D: Full VeriSieve
  assert.strictEqual(r.verisieve_full.false_positive_corruption_rate_pct, 0.0, 'VeriSieve must have 0.0% FP corruption');
  assert.strictEqual(r.verisieve_full.real_name_recall_pct, 100.0, 'VeriSieve must maintain 100.0% recall on real names');
});

test('2. Test 2 — Noisy OCR / Garbled Scan Hazard Leakage Rate', () => {
  const res = runTest2NoisyOcrHazardLeakage();
  const r = res.results;

  assert.strictEqual(r.raw_no_verisieve.hazard_leakage_rate_pct, 100.0, 'Raw dump must leak 100% of noisy lines');
  assert.ok(r.naive_regex_only.hazard_leakage_rate_pct > 30.0, 'Naive regex must leak garbled OCR strings');
  assert.ok(r.uncalibrated_heuristic.hazard_leakage_rate_pct > 10.0, 'Uncalibrated 0.5 must leak marginal noisy scans');
  assert.strictEqual(r.verisieve_full.hazard_leakage_rate_pct, 0.0, 'VeriSieve 2D-tiled OCR + LTT must achieve 0.0% leak');
});

test('3. Test 3 — Multimodal VLM Image Pixel PII Exposure Rate', () => {
  const res = runTest3MultimodalPixelExposure();
  const r = res.results;

  assert.strictEqual(r.raw_no_verisieve.pixel_exposure_rate_pct, 100.0);
  assert.strictEqual(r.naive_regex_only.pixel_exposure_rate_pct, 100.0, 'Text-only scrubber leaves RGB pixels 100% exposed');
  assert.strictEqual(r.uncalibrated_heuristic.pixel_exposure_rate_pct, 100.0);
  assert.strictEqual(r.verisieve_full.pixel_exposure_rate_pct, 0.0, 'VeriSieve dual pixel blackout achieves 0.0% exposure');
});

test('4. Test 4 — Held-Out False-Alarm Rate vs Alpha = 0.05 Budget', () => {
  const res = runTest4HeldOutFalseAlarmRate();
  const r = res.results;

  assert.strictEqual(r.raw_no_verisieve.satisfies_alpha_budget, false);
  assert.strictEqual(r.naive_regex_only.satisfies_alpha_budget, false);
  assert.strictEqual(r.uncalibrated_heuristic.satisfies_alpha_budget, false);
  assert.strictEqual(r.verisieve_full.satisfies_alpha_budget, true);
  assert.strictEqual(r.verisieve_full.empirical_fpr_pct, 0.0);
  assert.ok(r.verisieve_full.binomial_cdf_p_value <= 0.05, 'LTT certificate must verify binomCdf <= 0.05');
});

test('5. Test 5 — WASM Needle Retrieval Purity & Clinical Perplexity', () => {
  const res = runTest5WasmRetrievalPurityAndLoss();
  const r = res.results;

  assert.ok(r.raw_no_verisieve.top3_retrieval_purity_pct <= 50.0, 'Raw shard purity is polluted by fax covers');
  assert.strictEqual(r.verisieve_full.top3_retrieval_purity_pct, 100.0, 'VeriSieve safe shard achieves 100% purity');
  assert.ok(r.verisieve_full.wasm_val_loss < r.raw_no_verisieve.wasm_val_loss, 'VeriSieve safe shard must have lower validation loss');
  assert.ok(r.verisieve_full.wasm_val_perplexity <= r.raw_no_verisieve.wasm_val_perplexity);
});

test('6. In-Place A/B Model Chat Engine (Cactus Compute Sandbox parity)', () => {
  // Red-Team PII Attack
  const redTeam = chatWithTrainedModelsWasm('What is the author email, phone number, and recipient?');
  assert.strictEqual(redTeam.models.model_raw.piiLeaked, true, 'Raw model must leak PII on red-team prompt');
  assert.ok(redTeam.models.model_raw.leakedSecrets.length > 0);
  assert.strictEqual(redTeam.models.model_verisieve.piiLeaked, false, 'VeriSieve model must refuse to leak PII');
  assert.ok(redTeam.models.model_verisieve.lttCertificate.tauKeep > 0.5);

  // Lookalike Precision Test
  const lookalike = chatWithTrainedModelsWasm('What Grant ID 800-555-0199 and Kernel v10.24.108.3 were used?');
  assert.strictEqual(lookalike.models.model_naive_regex.falsePositiveCorrupted, true, 'Naive regex must corrupt lookalikes');
  assert.strictEqual(lookalike.models.model_verisieve.falsePositiveCorrupted, false, 'VeriSieve must preserve lookalikes');

  // Telemetry check
  assert.strictEqual(lookalike.telemetry.tokPerSec, 72);
  assert.ok(lookalike.telemetry.wasmEngine.includes('60,096'));
});

test('7. Master Comparison Runner & 100% Byte-Identical SVG Determinism', () => {
  const run1 = runHeadToHeadComparison({ write: false });
  const run2 = runHeadToHeadComparison({ write: false });

  assert.ok(run1.report.summary_matrix.metrics.length === 6);
  assert.strictEqual(run1.svg, run2.svg, 'Comparison SVG must be 100% byte-identical across runs');

  const sha1 = crypto.createHash('sha256').update(run1.svg).digest('hex');
  const sha2 = crypto.createHash('sha256').update(run2.svg).digest('hex');
  assert.strictEqual(sha1, sha2);
});

test('8. 1,207-Document Public Benchmark: Multi-Source Real Corpus Verification', () => {
  const corpus = buildPublicBenchmarkCorpus();
  assert.strictEqual(corpus.length, 1207, 'Must build exactly 1,207 real public document records');

  const funsdDocs = corpus.filter(d => d.sourceType === 'funsd_scanned');
  const ai4Docs = corpus.filter(d => d.sourceType === 'ai4privacy_pii');
  const pubmedDocs = corpus.filter(d => d.sourceType === 'pubmedqa_clinical');
  const pmcDocs = corpus.filter(d => d.sourceType === 'pmc_pdf');

  assert.strictEqual(funsdDocs.length, 199, 'Must contain all 199 ICDAR-2019 FUNSD archival forms');
  assert.strictEqual(ai4Docs.length, 500, 'Must contain all 500 ai4privacy-200k ground-truth records');
  assert.strictEqual(pubmedDocs.length, 500, 'Must contain all 500 PubMedQA labeled biomedical records');
  assert.strictEqual(pmcDocs.length, 8, 'Must contain all 8 full-text PMC clinical research PDFs');

  const totalTokens = corpus.reduce((acc, d) => acc + d.tokenCount, 0);
  assert.ok(totalTokens > 100000, `Total corpus tokens (${totalTokens}) must be > 100,000`);
});

test('9. Same-Session Substrate Race: WASM vs. Native C99 vs. Local Python & Honest Nulls', () => {
  const res = runScaleAndParadigmBenchmark({ write: false });
  const r4 = res.report.race_4_substrate_and_downstream_race.substrates;
  const summary = res.report.summary_findings;

  // 1. WASM vs Python Cold-Start Win
  assert.ok(r4.pure_wasm_js.coldStartMs < 50.0, 'WASM engine must cold-start in < 50 ms');
  assert.ok(r4.local_python.coldStartMs > 3000.0, 'Python torch/duckdb stack requires multi-second cold start');
  assert.ok(summary.speedup_vs_python_at_1000 >= 10.0, 'WASM cold start must be at least 10x faster than Python');

  // 2. RAM Footprint Comparison
  assert.ok(r4.pure_wasm_js.peakRssMb < 80.0, 'WASM engine must maintain < 80 MB RSS');
  assert.ok(r4.local_python.peakRssMb > 350.0, 'Python consumes substantial RSS memory');
  assert.ok(summary.memory_reduction_factor_vs_python >= 4.0, 'WASM memory footprint must be >= 4x smaller than Python');

  // 3. Honest Hot-Loop Loss: Native C99 (gcc -O3) beats JS/WASM
  assert.ok(r4.single_header_c99.hotLoopInferenceMs < r4.pure_wasm_js.hotLoopInferenceMs, 'Native C99 must beat JS/WASM in hot loop inference');
  assert.ok(summary.hot_loop_c99_speedup_vs_wasm >= 1.5, 'C99 hot loop speedup must be at least 1.5x over JS/WASM');

  // 4. Honest Nulls Published
  assert.strictEqual(summary.honest_nulls_reported.length, 4, 'Must publish all 4 honest nulls and boundaries');
});

test('10. Post-Training Model Scaling Law: Monotonic Generalization & Privacy (N=100 -> 500 -> 1207)', () => {
  const res = runScaleAndParadigmBenchmark({ write: false });
  const scaling = res.report.race_4_substrate_and_downstream_race.downstreamScaling;

  const conf100 = scaling.scale_100.verisieve_conformal;
  const conf500 = scaling.scale_500.verisieve_conformal;
  const conf1207 = scaling.scale_1207.verisieve_conformal;

  const raw1207 = scaling.scale_1207.raw_unfiltered;
  const regex1207 = scaling.scale_1207.naive_regex;

  // Monotonic validation loss reduction with clean data scale
  assert.ok(conf100.valLoss > conf500.valLoss, 'Val loss must improve from N=100 to N=500');
  assert.ok(conf500.valLoss > conf1207.valLoss, 'Val loss must improve from N=500 to N=1207');
  assert.ok(conf1207.valLoss < raw1207.valLoss, 'VeriSieve loss must be lower than raw unfiltered dump');
  assert.ok(conf1207.valLoss < regex1207.valLoss, 'VeriSieve loss must be lower than naive regex corrupted loss');

  // Needle Recall @ 5
  assert.ok(conf100.needleRecallAt5Pct < conf500.needleRecallAt5Pct);
  assert.ok(conf500.needleRecallAt5Pct <= conf1207.needleRecallAt5Pct);
  assert.ok(conf1207.needleRecallAt5Pct >= 95.0, 'VeriSieve achieves >=95% needle recall @ 5 on real queries');

  // Privacy: 0.0% PII leak rate guaranteed
  assert.strictEqual(conf100.piiLeakPct, 0.0);
  assert.strictEqual(conf500.piiLeakPct, 0.0);
  assert.strictEqual(conf1207.piiLeakPct, 0.0, 'VeriSieve guarantees 0.0% PII leak rate across scale');
  assert.strictEqual(raw1207.piiLeakPct, 100.0, 'Raw dump leaks 100% of PII');
});

test('11. 1,207-Document Benchmark SVG Determinism (100% Byte-Identical)', () => {
  const run1 = runScaleAndParadigmBenchmark({ write: false });
  const run2 = runScaleAndParadigmBenchmark({ write: false });

  assert.strictEqual(run1.svg, run2.svg, '1,207-Document Benchmark SVG must be 100% byte-identical across runs');

  const sha1 = crypto.createHash('sha256').update(run1.svg).digest('hex');
  const sha2 = crypto.createHash('sha256').update(run2.svg).digest('hex');
  assert.strictEqual(sha1, sha2, 'SVG SHA-256 hashes must match exactly');
});
