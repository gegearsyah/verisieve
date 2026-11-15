#!/usr/bin/env node
/**
 * scripts/run-scale-benchmark.mjs
 * 
 * VeriSieve 1,207-Document Public Benchmark & Multi-Race Audit Runner
 * 1. Executes 1,207-Document Multi-Source Public Benchmark (PMC Clinical PDFs + FUNSD + ai4privacy + PubMedQA)
 * 2. Audits 4 Real Races:
 *    - Race 1: Born-Digital PDF Front Door vs. 2D Tiled OCR (and 4/8 CIDFont ToUnicode CMap null)
 *    - Race 2: PII Disambiguation & Honest Regex Ceiling (ai4privacy structured vs. bare names)
 *    - Race 3: Learn-Then-Test (LTT) Conformal Gatekeeper Calibration on N = 1,207 docs
 *    - Race 4: Same-Session Substrate & Downstream Training Race (C99 hot-loop win vs. JS/WASM)
 * 3. Verifies 100% byte-identical SVG determinism across independent passes
 * 4. Prints comprehensive MLSys-style audit report
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runScaleAndParadigmBenchmark } from '../src/scale-benchmark.js';

console.log('========================================================================');
console.log('   VERISIEVE — 1,207-DOCUMENT PUBLIC BENCHMARK & MULTI-RACE AUDIT       ');
console.log('   FUNSD (199) + ai4privacy (500) + PubMedQA (500) + PMC Full-Text (8)   ');
console.log('========================================================================\n');

const svgPath = path.resolve('docs/scale-and-paradigm-benchmark.svg');
const jsonPath = path.resolve('results/scale-and-paradigm-benchmark.json');

// Step 1: Execute Pass 1 with live Python measurement
console.log('1. Executing 1,207-Document Multi-Source Benchmark (Pass 1)...');
const t0 = performance.now();
const pass1 = runScaleAndParadigmBenchmark({
  write: true,
  runPythonSubprocess: true,
  timestamp: '2026-11-15T00:00:00.000Z'
});
const pass1Ms = Math.round(performance.now() - t0);

if (!fs.existsSync(svgPath) || !fs.existsSync(jsonPath)) {
  console.error('Expected benchmark output artifacts not found.');
  process.exit(1);
}

const svg1 = fs.readFileSync(svgPath, 'utf8');
const sha1 = crypto.createHash('sha256').update(svg1).digest('hex');
console.log(`   - Pass 1 Total Latency: ${pass1Ms.toLocaleString()} ms`);
console.log(`   - Pass 1 SVG SHA-256:   ${sha1}`);

// Step 2: Determinism Check Across Passes
console.log('\n2. Verifying Deterministic Byte-Identical Output Across Passes (Pass 2)...');
const pass2 = runScaleAndParadigmBenchmark({
  write: false,
  timestamp: '2026-11-15T00:00:00.000Z'
});
const sha2 = crypto.createHash('sha256').update(pass2.svg).digest('hex');
console.log(`   - Pass 2 SVG SHA-256:   ${sha2}`);

if (sha1 === sha2) {
  console.log('   ✓ SUCCESS: SVG visualization is 100% byte-identical across runs!');
} else {
  console.error('   ✗ FAILED: SVG visualization differs across runs!');
  process.exit(1);
}

// Read results JSON
const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const meta = report.corpus_metadata;
const r1 = report.race_1_born_digital_vs_tiled_ocr;
const r2 = report.race_2_pii_disambiguation_regex_ceiling;
const r3 = report.race_3_ltt_conformal_calibration;
const r4 = report.race_4_substrate_and_downstream_race;
const summary = report.summary_findings;

console.log('\n========================================================================');
console.log('            1,207-DOCUMENT PUBLIC BENCHMARK CORPUS AUDIT                ');
console.log('========================================================================');
console.log(` Total Distinct Documents:     ${meta.total_documents.toLocaleString().padEnd(8)} (100% Real Public External Data)`);
console.log(` ICDAR-2019 FUNSD Forms:       ${meta.funsd_scanned_forms.toString().padEnd(8)} (Archival Scanned Memos, Faxes, Forms)`);
console.log(` ai4privacy-200k Records:      ${meta.ai4privacy_records.toString().padEnd(8)} (Ground-Truth PII Spans & Masks)`);
console.log(` PubMedQA Labeled QA:          ${meta.pubmedqa_records.toString().padEnd(8)} (Biomedical Clinical Research QA)`);
console.log(` Born-Digital PMC PDFs:        ${meta.pmc_clinical_pdfs.toString().padEnd(8)} (Full-Text Open Access Clinical Trials)`);
console.log(` Documents Containing PII:     ${meta.documents_with_pii.toLocaleString().padEnd(8)} (Emails, Phones, Hospital Addrs)`);
console.log(` Documents With Lookalikes:    ${meta.documents_with_lookalikes.toLocaleString().padEnd(8)} (Technical & Clinical Entities)`);
console.log('------------------------------------------------------------------------');

console.log('\n========================================================================');
console.log('   RACE 1: BORN-DIGITAL PDF FRONT DOOR & 2D TILED LAYOUT GEOMETRY        ');
console.log('========================================================================');
console.log(` PMC Clean Stream Extraction:  ${r1.pmc_pdf_eval.cleanExtractedPdfs}/${r1.pmc_pdf_eval.totalPdfs} PDFs (${r1.pmc_pdf_eval.totalReadableLines} lines, ${r1.pmc_pdf_eval.totalReadableWords} words in ${r1.pmc_pdf_eval.totalLatencyMs} ms total / ${r1.pmc_pdf_eval.avgLatencyPerPdfMs} ms avg)`);
console.log(' FUNSD Scanned Forms (N = 199 forms, 30,595 bboxes) Geometric Survival:');
for (const [mode, m] of Object.entries(r1.funsd_scanned_eval.modes)) {
  console.log(`   - ${mode.padEnd(22)}: Bbox Survival ${String(m.bboxLegibilitySurvivalPct + '%').padEnd(8)} (${m.wordsSurvived} / ${r1.funsd_scanned_eval.totalWordsMeasured} words)`);
}

console.log('\n========================================================================');
console.log('   RACE 2: PII DISAMBIGUATION & HONEST REGEX CEILING                    ');
console.log('========================================================================');
console.log(` ai4privacy Core Contact/IPv4: ${r2.ai4privacy_ground_truth.contact_card_ipv4_recall_pct}% (${r2.ai4privacy_ground_truth.contact_spans})`);
console.log(` ai4privacy All 26 Struct Tags:${r2.ai4privacy_ground_truth.all_26_structured_pii_recall_pct}% (${r2.ai4privacy_ground_truth.all_structured_spans})`);
console.log(` ai4privacy Bare-Name Recall:  ${r2.ai4privacy_ground_truth.unstructured_bare_name_recall_pct}% (${r2.ai4privacy_ground_truth.bare_name_spans})`);
console.log(` PubMedQA Blind Test Title-Case: Naive ${r2.pubmedqa_clinical_eval.test_split_250.naive_hits_per_1k_words}/1k words -> Lexicon ${r2.pubmedqa_clinical_eval.test_split_250.context_hits_per_1k_words}/1k words (${r2.pubmedqa_clinical_eval.hit_reduction_ratio_test}x fewer hits)`);

console.log('\n========================================================================');
console.log('   RACE 3: LEARN-THEN-TEST (LTT) CONFORMAL GATEKEEPER CALIBRATION       ');
console.log('========================================================================');
console.log(` Split: n_train = ${r3.split.nTrain}, n_cal = ${r3.split.nCal} (unsafe = ${r3.split.nCalUnsafe}), n_test = ${r3.split.nTest} (unsafe = ${r3.split.nTestUnsafe})`);
console.log(' Alpha Budget | tau_keep | Cond FPR (%) | Joint Risk (%) | Safe Yield (%) | Abstain (%) | Status');
console.log('--------------+----------+--------------+----------------+----------------+-------------+-------------------');
for (const a of Object.values(r3.alphaSweep)) {
  console.log(` α = ${String(a.alpha.toFixed(2)).padEnd(5)}   | ${String(a.tauKeep.toFixed(2)).padEnd(8)} | ${String(a.testCondFprPct + '%').padEnd(12)} | ${String(a.testJointRiskPct + '%').padEnd(14)} | ${String(a.safeRetentionYieldPct + '%').padEnd(14)} | ${String(a.abstentionRatePct + '%').padEnd(11)} | ${a.status}`);
}
const ub = r3.uncalibratedBaseline;
console.log(` Uncalibrated | tau=${ub.tauKeep.toFixed(2)} | ${String(ub.testCondFprPct + '%').padEnd(12)} | ${String(ub.testJointRiskPct + '%').padEnd(14)} | ${String(ub.safeRetentionYieldPct + '%').padEnd(14)} | ${String(ub.abstentionRatePct + '%').padEnd(11)} | Uncontrolled`);

console.log('\n========================================================================');
console.log(`   RACE 4: ${r4.trialsPerSubstrate}-RUN INTERLEAVED SUBSTRATE & DOWNSTREAM ABLATION               `);
console.log('========================================================================');
console.log(` Single-Header C99 (12.4 KB):  OS Spawn ${r4.substrates.single_header_c99.processSpawnColdStartMs} ms | RSS ${r4.substrates.single_header_c99.peakRssMb} MB | Hot Loop ${r4.substrates.single_header_c99.hotLoopInferenceMs} ms`);
console.log(` Node + WASM (60.1 KB):        OS Spawn ${r4.substrates.pure_wasm_js.processSpawnColdStartMs} ms (in-proc ${r4.substrates.pure_wasm_js.inProcessWarmWasmInitMs} ms) | RSS ${r4.substrates.pure_wasm_js.peakRssMb} MB | Hot Loop ${r4.substrates.pure_wasm_js.hotLoopInferenceMs} ms`);
console.log(` Python + NumPy:               OS Spawn ${r4.substrates.python_numpy.processSpawnColdStartMs} ms (import ${r4.substrates.python_numpy.importMs} ms) | RSS ${r4.substrates.python_numpy.peakRssMb} MB | Hot Loop ${r4.substrates.python_numpy.hotLoopInferenceMs} ms`);
console.log(` Python + PyTorch + DuckDB:    OS Spawn ${r4.substrates.local_python.processSpawnColdStartMs} ms (import ${r4.substrates.local_python.frameworkImportMs} ms) | RSS ${r4.substrates.local_python.peakRssMb} MB`);

console.log('\n========================================================================');
console.log('                        SUMMARY VERIFICATION                            ');
console.log('========================================================================');
console.log(` OS Spawn Speedup vs. PyTorch:           ${summary.speedup_vs_pytorch_spawn}x faster (${r4.substrates.pure_wasm_js.processSpawnColdStartMs} ms vs. ${r4.substrates.local_python.processSpawnColdStartMs} ms)`);
console.log(` RAM Reduction vs. PyTorch:              ${summary.memory_reduction_factor_vs_pytorch}x smaller (${r4.substrates.pure_wasm_js.peakRssMb} MB vs. ${r4.substrates.local_python.peakRssMb} MB)`);
console.log(` C99 Hot-Loop vs. Node JIT:              ${summary.c99_hot_loop_speedup_vs_js}x faster (${r4.substrates.single_header_c99.hotLoopInferenceMs} ms vs. ${r4.substrates.pure_wasm_js.hotLoopInferenceMs} ms; NumPy BLAS: ${summary.numpy_hot_loop_ms} ms)`);
console.log(` Held-Out Gatekeeper Loss N=100->Full:   -${summary.post_training_gate_bce_loss_reduction_pct}% (${r4.downstreamAblation.ablation_100.verisieve_conformal.heldOutGateBceLoss} -> ${r4.downstreamAblation.ablation_full_train.verisieve_conformal.heldOutGateBceLoss}), Acc ${summary.post_training_gate_acc_full_train}%`);
console.log(` Held-Out Needle R@5 (125 Q->Body):      ${summary.needle_recall_at_5_verisieve}% (vs Raw ${r4.needleBenchmark.raw_unmasked.recallAt5Pct}%)`);
console.log('\n Honest Findings & Boundaries:');
for (const nullReport of summary.honest_nulls_and_boundaries_reported) {
  console.log(`   - ${nullReport}`);
}
console.log('========================================================================\n');
console.log(' Artifacts Written:');
console.log('   - results/scale-and-paradigm-benchmark.json');
console.log('   - docs/scale-and-paradigm-benchmark.svg\n');
