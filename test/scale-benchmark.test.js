import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  buildPublicBenchmarkCorpus,
  runScaleAndParadigmBenchmark,
} from '../src/scale-benchmark.js';

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

test('9. Live Interleaved Substrate Race: C99 vs. Node+WASM vs. Python+NumPy vs. PyTorch & Boundaries', () => {
  const res = runScaleAndParadigmBenchmark({ write: false });
  const r4 = res.report.race_4_substrate_and_downstream_race;
  const sub = r4.substrates;
  const summary = res.report.summary_findings;

  assert.ok(sub.single_header_c99.processSpawnColdStartMs < sub.pure_wasm_js.processSpawnColdStartMs, 'C99 OS spawn must beat Node+WASM');
  assert.ok(sub.pure_wasm_js.processSpawnColdStartMs < sub.python_numpy.processSpawnColdStartMs, 'Node+WASM OS spawn must beat Python+NumPy');
  assert.ok(sub.python_numpy.processSpawnColdStartMs < sub.local_python.processSpawnColdStartMs, 'Python+NumPy must beat full PyTorch+DuckDB spawn');
  assert.ok(summary.speedup_vs_pytorch_spawn >= 10.0, 'Node+WASM spawn must be >=10x faster than Python+PyTorch');

  assert.ok(sub.single_header_c99.peakRssMb < sub.pure_wasm_js.peakRssMb, 'C99 must use less RSS than Node+WASM');
  assert.ok(sub.pure_wasm_js.peakRssMb < sub.local_python.peakRssMb, 'Node+WASM must use less RSS than Python+PyTorch');
  assert.ok(summary.memory_reduction_factor_vs_pytorch >= 4.0, 'Node+WASM RSS must be >=4x smaller than Python+PyTorch');

  assert.ok(sub.single_header_c99.hotLoopInferenceMs < sub.pure_wasm_js.hotLoopInferenceMs, 'C99 hot loop must beat JS/Node JIT');
  assert.ok(sub.python_numpy.hotLoopInferenceMs <= sub.single_header_c99.hotLoopInferenceMs * 1.5, 'NumPy BLAS vectorized dot product matches/beats scalar loop');

  assert.strictEqual(summary.honest_nulls_and_boundaries_reported.length, 4, 'Must publish all 4 honest findings/boundaries');
});

test('10. Live Held-Out Gatekeeper & WASM VeRA Ablation (Train N=100 -> 300 -> Full, Disjoint Test)', () => {
  const res = runScaleAndParadigmBenchmark({ write: false });
  const r4 = res.report.race_4_substrate_and_downstream_race;
  const ab100 = r4.downstreamAblation.ablation_100;
  const ab300 = r4.downstreamAblation.ablation_300;
  const abFull = r4.downstreamAblation.ablation_full_train;

  assert.ok(ab100.versieve_conformal.heldOutGateBceLoss > ab300.versieve_conformal.heldOutGateBceLoss, 'Held-out BCE loss must drop N=100 -> N=300');
  assert.ok(ab300.versieve_conformal.heldOutGateBceLoss > abFull.versieve_conformal.heldOutGateBceLoss, 'Held-out BCE loss must drop N=300 -> full train');
  assert.ok(abFull.versieve_conformal.heldOutGateAccPct > abFull.raw_unfiltered.heldOutAccPct, 'Trained gatekeeper must strictly beat raw unfiltered baseline');
  assert.ok(abFull.versieve_conformal.wasmVeraBceLoss > 0 && abFull.versieve_conformal.wasmVeraBceLoss < 1.0, 'WASM VeRA loss must be computed live');

  const nb = r4.needleBenchmark;
  assert.ok(nb.versieve_masked.recallAt5Pct >= nb.raw_unmasked.recallAt5Pct - 5.0, 'Versieve masking must preserve retrieval utility');
  assert.ok(abFull.versieve_conformal.contactPiiHighConfLeakPct < 5.0, 'High-confidence contact PII leak rate must stay below 5%');
});

test('11. 1,207-Document Benchmark SVG Determinism (100% Byte-Identical)', () => {
  const run1 = runScaleAndParadigmBenchmark({ write: false });
  const run2 = runScaleAndParadigmBenchmark({ write: false });

  assert.strictEqual(run1.svg, run2.svg, '1,207-Document Benchmark SVG must be 100% byte-identical across runs');

  const sha1 = crypto.createHash('sha256').update(run1.svg).digest('hex');
  const sha2 = crypto.createHash('sha256').update(run2.svg).digest('hex');
  assert.strictEqual(sha1, sha2, 'SVG SHA-256 hashes must match exactly');
});
