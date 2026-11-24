#!/usr/bin/env node
/**
 * Stage 1 anti-drift receipt (docs/2026-11-24-versieve-novelty-and-remediation-handoff.md):
 * every checked paper number must be computed from a checked-in raw artifact
 * (results/*.json, shipped WASM binaries, or the checked-in training script) and
 * literally appear in the corresponding paper/*.tex. Unsourced numbers are
 * deleted from the papers, never hand-tuned. Derived ratios (speedups, deltas)
 * are recomputed here from the same raw fields the papers quote.
 *
 * Known coverage gaps (recorded as deviations in the handoff Run Record, §8):
 * tab:extraction (Paper 3 T1 corpus baseline), tab:cag-ppr / tab:trackc (CAG
 * benchmark), and the T1 flat-baseline paragraph have no checked-in results
 * JSON; figure PDFs may embed pre-remediation numbers until Stage 3 regenerates.
 */
import { readFileSync, statSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const j = f => JSON.parse(readFileSync(new URL('results/' + f, ROOT), 'utf8'));
const tex = f => readFileSync(new URL('paper/' + f, ROOT), 'utf8');

const SECRETS = j('reviewer-secrets-audio-pprl-benchmarks.json');
const TAB = j('reviewer-tab-and-ltt-benchmarks.json');
const SC = j('scale-and-paradigm-benchmark.json');
const TD = j('track-d-ptlm-ablation.json');
const TE = j('track-e-paper-benchmarks.json');
const GC = j('gccrc-cross-modal-benchmark.json');
const TRAINER = readFileSync(new URL('scripts/run-track-d-fair-lora.py', ROOT), 'utf8');

const M = tex('verisieve-multimodal-sanitization-benchmark.tex');
const L = tex('verisieve-local-training-benchmark.tex');
const E = tex('verisieve-extraction-redaction-benchmark.tex');

let fails = 0;
let checks = 0;
const ok = (label, needle, haystack) => {
  checks++;
  if (!haystack.includes(needle)) {
    fails++;
    console.error(`FAIL [${label}] expected to find: ${needle}`);
  }
};
// half-up rounding: toFixed alone loses .xx5 ties to float representation
const f = (v, d) => (Math.round(v * 10 ** d + 1e-6) / 10 ** d).toFixed(d);
const f0 = v => f(v, 0), f1 = v => f(v, 1), f2 = v => f(v, 2), f3 = v => f(v, 3), f4 = v => f(v, 4);
const comma = v => f0(v).replace(/\B(?=(\d{3})+(?!\d))/g, '{,}');
const P = s => s + '\\%'; // tex percent form

/* ---------------- Paper 3 (multimodal): WASM binaries ---------------- */
for (const mod of ['verisieve_clean', 'verisieve_sql', 'verisieve_graph', 'verisieve_dl', 'verisieve_media']) {
  ok(`wasm:${mod}`, comma(statSync(new URL(`vendor/wasm/${mod}.wasm`, ROOT)).size), M);
}
ok('wasm:media.caption', '$204{,}031$\\,B', M);

/* ---------------- Paper 3: tab:secrets + Exp.3 prose (expR3) ---------------- */
const R3 = SECRETS.expR3_externalSecrets;
for (const [k, row] of Object.entries(R3)) {
  if (typeof row !== 'object') continue;
  ok(`secrets:${k}.rec`, P(f2(row.recallPct)), M);
  ok(`secrets:${k}.f1`, P(f2(row.f1Pct)), M);
  ok(`secrets:${k}.cold`, f1(row.cold1xWallMs), M);
  ok(`secrets:${k}.mbps`, f2(row.steadyStateMBps), M);
}
ok('secrets:yelp.steady', f1(R3.yelp_detect_secrets.steadyState1xMs), M);
ok('secrets:wasm.steady', f1(R3.verisieve_media_wasm.steadyStateCliWithIoMs), M);
ok('secrets:gitleaks.steady', f1(R3.gitleaks_v8_30_1.steadyState1xMs), M);
ok('secrets:posFiles', String(R3.positiveFiles), M);
ok('secrets:negFiles', String(R3.negativeFiles), M);
ok('secrets:totalKB', f1(R3.totalBytes1x / 1000), M); // "78.1 KB"
// derived speedups from the artifact's own steady-state MB/s
ok('secrets:vsYelp', f1(R3.verisieve_media_wasm.steadyStateMBps / R3.yelp_detect_secrets.steadyStateMBps), M);
ok('secrets:vsGitleaksCold', f1(R3.gitleaks_v8_30_1.cold1xWallMs / R3.verisieve_media_wasm.cold1xWallMs), M);

/* ---------------- Paper 3: Exp.4 audio (expR4, Stage 2 honest self-seeded re-run) ---------------- */
const R4 = SECRETS.expR4_endToEndWhisperAudio;
const PRE = R4.preExposure;
const CONDS = R4.conditions;
ok('audio:calls', String(R4.callsEvaluated), M);
ok('audio:tokens', String(R4.totalPlantedPiiTokens), M);
ok('audio:pre', P(f2(PRE.exposureOfPlantedPct)), M);
ok('audio:preCI', `[${f1(PRE.wilson95CI[0])}\\%, ${f1(PRE.wilson95CI[1])}\\%]`, M);
ok('audio:post', P(f2(CONDS.isolated.leakageOfPlantedPct)), M);
ok('audio:postCI', `[${f1(CONDS.isolated.wilson95CI[0])}\\%, ${f1(CONDS.isolated.wilson95CI[1])}\\%]`, M);
ok('audio:srmp', P(f2(CONDS.srmpSelfSeeded.leakageOfPlantedPct)), M);
ok('audio:srmpCI', `[${f2(CONDS.srmpSelfSeeded.wilson95CI[0])}\\%, ${f2(CONDS.srmpSelfSeeded.wilson95CI[1])}\\%]`, M);
ok('audio:dropPP', f2(CONDS.srmpSelfSeeded.absoluteDropPercentagePoints), M);
ok('audio:relative', P(f2(CONDS.srmpSelfSeeded.relativeReductionOfExposedPct)), M);
ok('audio:zeroLeak', `${CONDS.srmpSelfSeeded.callsWithZeroLeak}/${R4.callsEvaluated}`, M);
ok('audio:isolatedZeroLeak', `${CONDS.isolated.callsWithZeroLeak}/${R4.callsEvaluated}`, M);
ok('audio:retention', P(f1(CONDS.srmpSelfSeeded.nonPiiContextRetentionPct)), M);
ok('audio:residualRatio', f1(CONDS.isolated.leakageOfPlantedPct / CONDS.srmpSelfSeeded.leakageOfPlantedPct), M);
ok('audio:fuzzy', P(f2(CONDS.fuzzyBaseline.leakageOfPlantedPct)), M);
ok('audio:fuzzyCI', `[${f2(CONDS.fuzzyBaseline.wilson95CI[0])}\\%, ${f2(CONDS.fuzzyBaseline.wilson95CI[1])}\\%]`, M);
ok('audio:fuzzyZeroLeak', `${CONDS.fuzzyBaseline.callsWithZeroLeak}/${R4.callsEvaluated}`, M);
ok('audio:wrong', P(f2(CONDS.srmpWrongRecord.leakageOfPlantedPct)), M);
ok('audio:wrongCI', `[${f1(CONDS.srmpWrongRecord.wilson95CI[0])}\\%, ${f1(CONDS.srmpWrongRecord.wilson95CI[1])}\\%]`, M);
ok('audio:partial', P(f2(CONDS.srmpPartialAnchors.leakageOfPlantedPct)), M);
ok('audio:partialCI', `[${f1(CONDS.srmpPartialAnchors.wilson95CI[0])}\\%, ${f1(CONDS.srmpPartialAnchors.wilson95CI[1])}\\%]`, M);
ok('audio:absentFrac', `${CONDS.srmpSelfSeeded.absentFromAnchorsTokens}/${R4.totalPlantedPiiTokens}`, M);
ok('audio:absentLeaked', String(CONDS.srmpSelfSeeded.absentLeakedTokens), M);
ok('audio:avgAnchors', f2(CONDS.srmpSelfSeeded.avgAnchorsPerCall), M);

/* ---------------- Paper 3: Exp.5 PPRL (expR5) ---------------- */
const R5 = SECRETS.expR5_pprlRealityCheck;
const scale5 = R5.scale500CommonNamesCollision;
ok('pprl:levF1', P(f2(R5.plaintextLevenshteinCeiling.f1Pct)), M);
ok('pprl:levP', P(f1(R5.plaintextLevenshteinCeiling.precisionPct)), M);
ok('pprl:jwF1', P(f2(R5.plaintextJaroWinklerCeiling.f1Pct)), M);
ok('pprl:jwP', P(f1(R5.plaintextJaroWinklerCeiling.precisionPct)), M);
ok('pprl:pprlF1', P(f2(R5.wasmSaltedBloomSoundexPprl.f1Pct)), M);
ok('pprl:pprlP', P(f1(R5.wasmSaltedBloomSoundexPprl.precisionPct)), M);
ok('pprl:pairs', comma(scale5.allPairsNegativeCount), M);
ok('pprl:falseDevPct', P(f2(scale5.pprlFalseLinkRateAtDevThrPct)), M);
ok('pprl:falseDev', comma(scale5.pprlFalseLinksAtDevThr), M);
ok('pprl:strictPct', P(f3(scale5.pprlFalseLinkRateAtStrict075Pct)), M);
ok('pprl:strict', comma(scale5.pprlFalseLinksAtStrict075), M);
ok('pprl:jwPct', P(f3(scale5.plaintextJaroWinklerFalseLinkRatePct)), M);
ok('pprl:jwLinks', comma(scale5.plaintextJaroWinklerFalseLinks), M);
ok('pprl:strictFold', f0(scale5.pprlFalseLinksAtDevThr / scale5.pprlFalseLinksAtStrict075), M);
ok('pprl:jwFold', f1(scale5.plaintextJaroWinklerFalseLinkRatePct / scale5.pprlFalseLinkRateAtStrict075Pct), M);

/* ---------------- Paper 3: Unicode NFKC baseline (expR6 + track-e) ---------------- */
const R6 = SECRETS.expR6_unicodeNfkcBaseline;
ok('unicode:zwsp', P(f2(R6.zwsp.pythonNfkcRegexPct)), M);
ok('unicode:zwspShort', P(f1(R6.zwsp.pythonNfkcRegexPct)), M); // fig caption 29.9%
ok('unicode:homoglyph', P(f1(R6.homoglyph.pythonNfkcRegexPct)), M);
ok('unicode:fullwidth', P(f1(R6.fullwidth.pythonNfkcRegexPct)), M);
const EU = TE.exp1_piiAndEvasion.adversarialUnicodeEvasion;
ok('unicode:wasmZwsp', P(f2(EU.zwsp.wasmRecallPct)), M);
ok('unicode:wasmHomoglyph', P(f1(EU.homoglyph.wasmRecallPct)), M);

/* ---------------- Paper 3: tab:tab-bench (TAB ablation + person) ---------------- */
for (const [k, e] of Object.entries(TAB.allMaskableAblation)) {
  ok(`tab:${k}.p`, f2(e.precisionPct), M);
  ok(`tab:${k}.r`, f2(e.recallPct), M);
  ok(`tab:${k}.f1`, f2(e.f1Pct), M);
  ok(`tab:${k}.ci`, `[${f1(e.f1Bootstrap95CI[0])}, ${f1(e.f1Bootstrap95CI[1])}]`, M);
  ok(`tab:${k}.direct`, f2(e.directRecallPct), M);
}
for (const [k, e] of Object.entries(TAB.personComparison)) {
  ok(`person:${k}.p`, f2(e.precisionPct), M);
  ok(`person:${k}.r`, f2(e.recallPct), M);
  ok(`person:${k}.f1`, f2(e.f1Pct), M);
  ok(`person:${k}.ci`, `[${f1(e.f1Bootstrap95CI[0])}, ${f1(e.f1Bootstrap95CI[1])}]`, M);
  ok(`person:${k}.direct`, f2(e.directRecallPct), M);
}
for (const [k, e] of Object.entries(TAB.prCurves.srmpPerson[5])) {
  if (['precisionPct', 'recallPct', 'f1Pct', 'directRecallPct'].includes(k))
    ok(`pr:srmp70.${k}`, f2(e), M);
}
ok('pr:dev70.f1', P(f2(TAB.prCurves.devFilteredPerson[5].f1Pct)), M); // 27.88 baseline
ok('tab:devFilterTerms', String(TAB.devNomaskFilterTermsLearned), M);
// derived lesson numbers quoted in prose
const A = TAB.allMaskableAblation;
ok('tab:fpRemoved', comma(A.vanillaGlinerAtOptThr.fp - A.devFilteredGlinerAtOptThr.fp), M);
ok('tab:fpVanilla', comma(A.vanillaGlinerAtOptThr.fp), M);
ok('tab:fpDevFilt', comma(A.devFilteredGlinerAtOptThr.fp), M);
ok('tab:devFiltGain', f2(A.devFilteredGlinerAtOptThr.f1Pct - A.vanillaGlinerAtOptThr.f1Pct), M);
ok('tab:personGain', f2(TAB.personComparison.devFilteredGlinerPerson.f1Pct - TAB.personComparison.paper1Regex.f1Pct), M);
const srmpRecovered = TAB.personComparison.vanillaGlinerPerson.fn - TAB.personComparison.srmpWasmGlinerPerson.fn;
ok('tab:personSpans', String(TAB.prCurves.devFilteredPerson[5].tp + TAB.prCurves.devFilteredPerson[5].fn), M);
ok('tab:srmpRecovered', String(srmpRecovered), M);
ok('tab:srmpTau70Gain', f2(TAB.prCurves.srmpPerson[5].recallPct - TAB.prCurves.devFilteredPerson[5].recallPct), M);
ok('tab:allMaskSpans', comma(A.stage3aWasmOnly.tp + A.stage3aWasmOnly.fn), M);
ok('tab:directSpans', String(A.stage3aWasmOnly.directTotal), M);
ok('tab:directPersonSpans', String(TAB.prCurves.srmpPerson[5].directTotal), M);
ok('tab:presidioP', f4(TAB.allMaskableSignificance.hybridDevFilteredVsPresidioFairP), M); // p=0.0002
ok('tab:personPresidioP', f4(TAB.personSignificance.devFilteredGlinerVsPresidioP), M);
// Stage 3: paired per-document permutation tests (SR-MP vs dev-filtered and vs dumb propagation)
ok('tab:srmpVsDevFilteredP', f4(TAB.personSignificance.srmpVsDevFilteredP), M); // p=0.0448
ok('tab:srmpVsDumbP', f4(TAB.personSignificance.srmpVsDumbPropagationP), M);
ok('tab:srmpVsDevFilteredTau070P', f4(TAB.personSignificance.srmpVsDevFilteredTau070P), M);
ok('tab:srmpVsDumbTau070P', f4(TAB.personSignificance.srmpVsDumbPropagationTau070P), M);
ok('pr:dumb70.f1', P(f2(TAB.prCurves.dumbPerson[5].f1Pct)), M); // lessons prose: dumb tau=0.70 F1

/* ---------------- Paper 3: tab:gt-ltt (non-circular ground truth) ---------------- */
// tex shows only these (regime, alpha) rows; parenthetical is the leak COUNT
const GT = TAB.nonCircularGroundTruthLtt;
const SHOWN = {
  textOnly520dLtt: [0.01, 0.05],
  nerMaxConfBaselineLtt: [0.01, 0.05, 0.10],
  detectorInformedHybridLtt: [0.01, 0.05, 0.10],
  documentClusteredHcCrc: [0.01, 0.02, 0.05, 0.10],
  streamingMartingaleELtt: [0.05, 0.10],
};
for (const [name, alphas] of Object.entries(SHOWN)) {
  for (const e of GT[name]) {
    if (!alphas.includes(e.alpha)) continue;
    ok(`gt:${name}.a${e.alpha}.fpr`, P(f2(e.testConditionalFprPct)), M);
    ok(`gt:${name}.a${e.alpha}.rel`, P(f2(e.overallAutoReleasePct)), M);
    ok(`gt:${name}.a${e.alpha}.yield`, P(f2(e.testSafeYieldPct)), M);
    ok(`gt:${name}.a${e.alpha}.leak`, P(f2(e.e2eResidualLeakOfReleasedPct)), M);
    ok(`gt:${name}.a${e.alpha}.leakCount`, `($${e.e2eResidualLeakCount}$)`, M);
  }
}
ok('gt:eLtt.notCertified', 'E_{\\max}{=}1', M);
const hcByA = a => GT.documentClusteredHcCrc.find(e => e.alpha === a);
ok('gt:hcCrc.a15.fpr', P(f2(hcByA(0.15).testConditionalFprPct)), M); // prose: 12.57 <= 15%
ok('gt:hcCrc.a20.fpr', P(f2(hcByA(0.20).testConditionalFprPct)), M); // prose: 15.77 <= 20%
ok('gt:icc', f4(hcByA(0.01).intraClusterCorrelation), M);
ok('gt:deff', f2(hcByA(0.01).designEffect), M);
ok('gt:neff', String(hcByA(0.01).effectiveSampleSize), M);
ok('gt:clusters', String(hcByA(0.01).nUnsafeClusters), M);
ok('gt:calUnsafe', String(GT.splits.calUnsafe), M);
ok('gt:testTotal', comma(GT.splits.testTotal), M);
ok('gt:testUnsafe', comma(GT.splits.testUnsafe), M);
ok('gt:testSafe', String(GT.splits.testSafe), M);
ok('gt:safeRate', P(f1(100 * GT.splits.testSafe / GT.splits.testTotal)), M);
ok('gt:unsafeRate', P(f1(100 * GT.splits.testUnsafe / GT.splits.testTotal)), M);
const eLtt05 = GT.streamingMartingaleELtt.find(e => e.alpha === 0.05);
const eLtt10 = GT.streamingMartingaleELtt.find(e => e.alpha === 0.10);
ok('gt:eLtt05.maxE', f2(eLtt05.maxEValue), M);
ok('gt:eLtt10.maxE', f2(eLtt10.maxEValue), M);
ok('gt:eLtt05.step', `${eLtt05.stoppingClusterStep}/${hcByA(0.01).nUnsafeClusters}`, M);
ok('gt:eLtt10.step', `${eLtt10.stoppingClusterStep}/${hcByA(0.01).nUnsafeClusters}`, M);

/* ---------------- Paper 3: GC-CRC cross-modal claims ---------------- */
const G = GC.regimes;
ok('gccrc:isolatedF1', P(f2(G.isolatedHybridTau060.f1Pct)), M);
ok('gccrc:isolatedFollowup', P(f1(G.isolatedHybridTau060.crossModalFollowupRecallPct)), M);
ok('gccrc:tau020fp', String(G.isolatedHybridTau020.falsePositives), M);
ok('gccrc:tau060fp', String(G.isolatedHybridTau060.falsePositives), M);
ok('gccrc:followup', P(f2(G.versieveGcCrc.crossModalFollowupRecallPct)), M);
ok('gccrc:linkRate', P(f2(G.versieveGcCrc.crossModalLinkRatePct)), M);
ok('gccrc:fp', String(G.versieveGcCrc.falsePositives), M);
ok('gccrc:precision', P(f2(G.versieveGcCrc.precisionPct)), M);
ok('gccrc:f1', P(f2(G.versieveGcCrc.f1Pct)), M);

/* ---------------- Paper 3: tab:micro (track-e) ---------------- */
const EN = TE.exp2_enronEmails;
ok('micro:emails', comma(EN.emailCount), M);
ok('micro:spans', comma(EN.totalPiiSpansDetected), M);
ok('micro:throughput', comma(EN.throughputEmailsPerSec), M);
const forensics = EN.forensicContainerMicroBench.map(e => e.medianMs);
ok('micro:forensicMin', f3(Math.min(...forensics)), M);
ok('micro:forensicMax', f3(Math.max(...forensics)), M);
ok('micro:bombMs', f3(TE.exp5_scaleSecurityAndCrossModalGraph.archiveDefense.bombAbortMs), M);
const AD = TE.exp5_scaleSecurityAndCrossModalGraph.archiveDefense;
ok('micro:bombRatio', comma(Math.floor(AD.bombUncompressedMB * 1024 * 1024 / AD.bombCompressedBytes)), M);
const blast = TE.exp5_scaleSecurityAndCrossModalGraph.crossModalGdprBlastRadius.at(-1);
ok('micro:blocks', comma(blast.blocks), M);
ok('micro:edges', comma(blast.edges), M);
ok('micro:blastMs', f3(blast.blastRadiusMedianMs), M);

/* ---------------- Paper 1 (local training): tab:canary + tab:trackd-3model ---------------- */
const MODELS = TD.models;
const CANARY_ARMS = { BASE: 'Base', T2_CHAT_RAW_LORA: 'Raw', T2_CHAT_SAFE_LORA: 'Safe', T2_CHAT_PTLM_LORA: 'PT-LM' };
for (const [mk, mod] of Object.entries(MODELS)) {
  for (const [ak, label] of Object.entries(CANARY_ARMS)) {
    const c = mod.canary_exposure[ak];
    ok(`canary:${mk}.${label}.all12`, f2(c.all_12_bits), L);
    ok(`canary:${mk}.${label}.rep20`, f2(c.rep_20x_bits), L);
    ok(`canary:${mk}.${label}.rank1`, `${c.rank1_count}/12`, L);
  }
}
const ARMS = ['BASE_CLOSED_BOOK', 'T2_CHAT_RAW_LORA', 'T2_CHAT_SAFE_LORA', 'T2_CHAT_PTLM_LORA',
  'T3_CHAT_SAFE_LORA_PLUS_PPR', 'T0_BASE_PLUS_GRAPH_PPR'];
for (const [mk, mod] of Object.entries(MODELS)) {
  for (const ak of ARMS) {
    const h = mod.heldout_50q_summary[ak], s = mod.seen_20q_summary[ak];
    ok(`td:${mk}.${ak}.echoHeld`, P(f0(h.pii_tag_echo_pct)), L);
    ok(`td:${mk}.${ak}.echoSeen`, P(f0(s.pii_tag_echo_pct)), L);
    ok(`td:${mk}.${ak}.refusal`, P(f1(h.in_scope_false_refusal_pct)), L);
    ok(`td:${mk}.${ak}.f1`, f3(h.in_f1), L);
    ok(`td:${mk}.${ak}.ci`, `[${f3(h.in_f1_ci95[0])}, ${f3(h.in_f1_ci95[1])}]`, L);
    ok(`td:${mk}.${ak}.kp`, P(f1(h.kp_recall_pct)), L);
    ok(`td:${mk}.${ak}.judgeIn`, P(f1(h.judge_in_pct)), L);
    ok(`td:${mk}.${ak}.judgeAll`, P(f1(h.judge_all_pct)), L);
    // tex reports only the cross-family judge's All score (in parentheses), never its In score
    if (h.llama_judge_all_pct != null) ok(`td:${mk}.${ak}.llamaAll`, P(f1(h.llama_judge_all_pct)), L);
    ok(`td:${mk}.${ak}.seenF1`, f3(s.in_f1), L);
    ok(`td:${mk}.${ak}.seenJudge`, P(f1(s.judge_all_pct)), L);
    if (s.llama_judge_all_pct != null) ok(`td:${mk}.${ak}.seenLlama`, P(f1(s.llama_judge_all_pct)), L);
    ok(`td:${mk}.${ak}.lat`, f2(h.mean_latency_s), L);
  }
}
// significance p-values quoted in prose
for (const [mk, mod] of Object.entries(MODELS)) {
  const sig = mod.significance_tests;
  ok(`sig:${mk}.pprVsSafe`, f4(sig.heldout_ppr_vs_safe_lora_f1_p), L); // 0.0005
  ok(`sig:${mk}.pprVsSafeJudge`, f3(sig.heldout_ppr_vs_safe_lora_judge_p), L); // 0.001
  ok(`sig:${mk}.ptlmVsSafeSeen`, f3(sig.seen_ptlm_vs_safe_lora_f1_p), L);
}
ok('sig:q15.ptlmVsSafeHeld', f2(MODELS.qwen15b.significance_tests.heldout_ptlm_vs_safe_lora_f1_p), L); // 0.01
// PT-LM masked-subword range, training budget, and PT-LM zero-echo claim
const pctlms = Object.values(TD.train_metas).filter(m => m.arm === 'ptlm');
ok('ptlm:maskedMin', P(f2(Math.min(...pctlms.map(m => m.masked_subword_pct)))), L);
ok('ptlm:maskedMax', P(f2(Math.max(...pctlms.map(m => m.masked_subword_pct)))), L);
ok('ptlm:steps', String(pctlms[0].max_steps), L);
ok('ptlm:rowsRawSafe', comma(TD.train_metas.qwen05b_raw.train_rows), L);
const ptlmEchoTotal = Object.values(MODELS)
  .reduce((n, m) => n + m.heldout_50q_summary.T2_CHAT_PTLM_LORA.pii_tag_echo_count
    + m.seen_20q_summary.T2_CHAT_PTLM_LORA.pii_tag_echo_count, 0);
ok('ptlm:zeroEchoDenominator', `0/210`, L);
if (ptlmEchoTotal !== 0) { fails++; console.error(`FAIL [ptlm:zeroEcho] PT-LM echo count sum = ${ptlmEchoTotal}, expected 0`); }
checks++;
// hyperparameters verified against the checked-in trainer and quoted in tex
ok('trainer:lr', 'lr: float = 2e-4', TRAINER);
ok('trainer:bs', 'per_device_train_batch_size=2', TRAINER);
ok('trainer:ga', 'gradient_accumulation_steps=4', TRAINER);
ok('trainer:maxlen', '= 768', TRAINER);
ok('trainer:lrInTex', '2\\mathrm{e}{-4}', L);
ok('trainer:maxlenInTex', '$768$', L);
// PT-LM recipe-robustness sweep (Paper 3 sec:ptlm-sweep; results/track-d-ptlm-sweep.json)
const SWP = j('track-d-ptlm-sweep.json');
const SW = Object.values(SWP.combos);
if (SW.length !== 18) { fails++; console.error(`FAIL [sweep:count] expected 18 combos, got ${SW.length}`); }
checks++;
// grid origin reproduces the committed single-point PT-LM held-out receipts (value-vs-value)
for (const [tag, mk] of [['qwen05b-baseline', 'qwen05b'], ['qwen15b-baseline', 'qwen15b'], ['lfm3-baseline', 'lfm3']]) {
  checks++;
  if (SWP.combos[tag].summaries.heldout_50q.judge_in_pct !== MODELS[mk].heldout_50q_summary.T2_CHAT_PTLM_LORA.judge_in_pct) {
    fails++; console.error(`FAIL [sweep:repro.${tag}] sweep baseline judge != committed PT-LM receipt`);
  }
}
// canary non-leakage: every trained combo at or below its model's untrained base
for (const c of SW) {
  checks++;
  if (c.canary_exposure.all_12_bits > TD.models[c.key].canary_exposure.BASE.all_12_bits) {
    fails++; console.error(`FAIL [sweep:leak.${c.key}] trained canary ${c.canary_exposure.all_12_bits} exceeds base ${TD.models[c.key].canary_exposure.BASE.all_12_bits}`);
  }
}
ok('sweep:canaryTrainedRange', `${f2(Math.min(...SW.map(c => c.canary_exposure.all_12_bits)))}$--$${f2(Math.max(...SW.map(c => c.canary_exposure.all_12_bits)))}`, L);
ok('sweep:strictJudgeRange', `${P(f1(Math.min(...SW.map(c => c.summaries.heldout_50q.judge_in_pct))))}$--$${P(f1(Math.max(...SW.map(c => c.summaries.heldout_50q.judge_in_pct))))}`, L);
ok('sweep:llamaJudgeRange', `${P(f1(Math.min(...SW.map(c => c.summaries.heldout_50q.llama_judge_in_pct))))}$--$${P(f1(Math.max(...SW.map(c => c.summaries.heldout_50q.llama_judge_in_pct))))}`, L);
const nonzeroOos = SW.map(c => c.summaries.heldout_50q.oos_abstention_pct).filter(v => v > 0);
ok('sweep:oosRange', `${P(f1(Math.min(...nonzeroOos)))}$--$${P(f1(Math.max(...nonzeroOos)))}`, L);
// dual-judge row-level agreement on the partial-credit threshold (score >= 1 of 0-2)
const agreePct = SW.map(c => {
  let a = 0, n = 0;
  for (const rows of Object.values(c.rows)) for (const r of rows) { n++; if ((r.judge_score >= 1) === (r.llama_judge_score >= 1)) a++; }
  return 100 * a / n;
});
ok('sweep:agreeRange', `${f1(Math.min(...agreePct))}\\%$--$${f1(Math.max(...agreePct))}\\%`, L);
// every table cell in tab:ptlm-sweep traces to the sweep artifact
for (const [tag, c] of Object.entries(SWP.combos)) {
  const h = c.summaries.heldout_50q, s = c.summaries.seen_20q;
  ok(`sweep:${tag}.heldJudge`, P(f1(h.judge_in_pct)), L);
  ok(`sweep:${tag}.llamaJudge`, P(f1(h.llama_judge_in_pct)), L);
  ok(`sweep:${tag}.oos`, P(f1(h.oos_abstention_pct)), L);
  ok(`sweep:${tag}.seenJudge`, P(f1(s.judge_in_pct)), L);
  ok(`sweep:${tag}.canary`, f2(c.canary_exposure.all_12_bits), L);
}
// 20x canary exposure ranges and per-model drops quoted in both papers
const rawRep = Object.values(MODELS).map(m => m.canary_exposure.T2_CHAT_RAW_LORA.rep_20x_bits);
ok('canary:rawRange', `${f2(Math.min(...rawRep))}$--$${f2(Math.max(...rawRep))}`, L);
const safeRep = Object.values(MODELS).map(m => m.canary_exposure.T2_CHAT_SAFE_LORA.rep_20x_bits);
ok('canary:safeRange', `${f2(Math.min(...safeRep))}$--$${f2(Math.max(...safeRep))}`, L);
// Paper 1: drops span raw-vs-safe AND raw-vs-PTLM across models (4.74--5.77)
const drops = Object.values(MODELS).flatMap(m => [
  m.canary_exposure.T2_CHAT_RAW_LORA.rep_20x_bits - m.canary_exposure.T2_CHAT_SAFE_LORA.rep_20x_bits,
  m.canary_exposure.T2_CHAT_RAW_LORA.rep_20x_bits - m.canary_exposure.T2_CHAT_PTLM_LORA.rep_20x_bits,
]);
ok('canary:dropMin', f2(Math.min(...drops)), L);
ok('canary:dropMax', f2(Math.max(...drops)), L);
// Paper 2 (abstract + §trackc): raw-vs-safe drops (4.93--5.70)
const dropsSafe = Object.values(MODELS).map(m =>
  m.canary_exposure.T2_CHAT_RAW_LORA.rep_20x_bits - m.canary_exposure.T2_CHAT_SAFE_LORA.rep_20x_bits);
ok('canary:bitsSavedMin', f2(Math.min(...dropsSafe)), E);
ok('canary:bitsSavedMax', f2(Math.max(...dropsSafe)), E);
// Paper 2 error-inspection counts on Qwen2.5-1.5B
const q15 = MODELS.qwen15b;
ok('td:q15.t0.refusalCount', `${q15.heldout_50q_summary.T0_BASE_PLUS_GRAPH_PPR.in_scope_false_refusal_count}/40`, E);
ok('td:q15.t0.echoCount', `${q15.heldout_50q_summary.T0_BASE_PLUS_GRAPH_PPR.pii_tag_echo_count}/40`, E);
ok('td:q15.refusalRange', `${q15.heldout_50q_summary.T2_CHAT_RAW_LORA.in_scope_false_refusal_count}$--$${q15.heldout_50q_summary.T2_CHAT_SAFE_LORA.in_scope_false_refusal_count}/40`, E);
ok('td:q15.safe.refusalCount', `${q15.heldout_50q_summary.T2_CHAT_SAFE_LORA.in_scope_false_refusal_count}/40`, E);
ok('td:q15.safe.seenEchoCount', `${q15.seen_20q_summary.T2_CHAT_SAFE_LORA.pii_tag_echo_count}/20`, E);

/* ---------------- Paper 2 (extraction/redaction): idea_1 micro ---------------- */
const I1 = SC.idea_1_text_capture_bench;
ok('idea1:stripPct', P(f1(I1.htmlBoilerplateStrip.strippedPct)), E);
ok('idea1:rawB', String(I1.htmlBoilerplateStrip.rawBytes), E);
ok('idea1:cleanB', String(I1.htmlBoilerplateStrip.cleanBytes), E);
ok('idea1:htmlMs', f3(I1.htmlBoilerplateStrip.latencyMs), E);
ok('idea1:docxChars', String(I1.docxExtraction.extractedChars), E);
ok('idea1:docxMs', f3(I1.docxExtraction.latencyMs), E);
ok('idea1:chunks', String(I1.deduplication.inputChunks), E);
ok('idea1:unique', String(I1.deduplication.uniqueChunksRetained), E);
ok('idea1:jaccard', f2(I1.deduplication.jaccardThreshold), E);
ok('idea1:dedupMs', f3(I1.deduplication.latencyMs), E);
ok('idea1:manifestPrefix', I1.manifestVerification.manifestSha256Prefix, E);
ok('idea1:sources', String(I1.manifestVerification.totalSources), E);
ok('idea1:tokens', String(I1.manifestVerification.totalTokens), E);
ok('idea1:totalMs', f3(I1.totalIdea1BenchMs), E);

/* ---------------- Paper 2: PMC PDF extraction ---------------- */
const PMC = SC.race_1_born_digital_vs_tiled_ocr.pmc_pdf_eval;
ok('pmc:pdfs', String(PMC.totalPdfs), E);
ok('pmc:cmap', String(PMC.withToUnicodeCmapStreams), E);
ok('pmc:hex', String(PMC.withHexDecodedLines), E);
ok('pmc:lines', comma(PMC.totalReadableLines), E);
ok('pmc:words', comma(PMC.totalReadableWords), E);
ok('pmc:totalMs', f2(PMC.totalLatencyMs), E);
ok('pmc:avgMs', f2(PMC.avgLatencyPerPdfMs), E);
ok('pmc:minMs', f2(Math.min(...PMC.perPdfResults.map(p => p.latencyMs))), E);
ok('pmc:maxMs', f2(Math.max(...PMC.perPdfResults.map(p => p.latencyMs))), E);

/* ---------------- Paper 2: tab:funsd ---------------- */
const FU = SC.race_1_born_digital_vs_tiled_ocr.funsd_scanned_eval;
ok('funsd:forms', String(FU.totalFormsMeasured), E);
ok('funsd:words', comma(FU.totalWordsMeasured), E);
ok('funsd:scanMs', f2(FU.geometryScanMs), E);
ok('funsd:tiles', String(FU.avgTilesPerForm2D), E);
for (const [k, m] of Object.entries(FU.modes)) {
  ok(`funsd:${k}.survived`, comma(m.wordsSurvived), E);
  ok(`funsd:${k}.rate`, P(f2(m.wordRecallPct)), E);
}
ok('funsd:seamLoss', P(f2(FU.modes.tile_2d_zero_overlap.seamCutLossPct)), E);

/* ---------------- Paper 2: regex ceiling + PubMedQA FP (race_2) ---------------- */
const A4P = SC.race_2_pii_disambiguation_regex_ceiling.ai4privacy_ground_truth;
ok('r2:contact', P(f1(A4P.contact_card_ipv4_recall_pct)), E);
ok('r2:contactSpans', A4P.contact_spans, E);
ok('r2:targeted', P(f1(A4P.targeted_8_pattern_recall_pct)), E);
ok('r2:targetedSpans', A4P.targeted_spans, E);
ok('r2:bare', P(f1(A4P.unstructured_bare_name_recall_pct)), E);
ok('r2:bareSpans', A4P.bare_name_spans, E);
ok('r2:all26', P(f1(A4P.all_26_structured_pii_recall_pct)), E);
ok('r2:allSpans', A4P.all_structured_spans, E);
const PQ = SC.race_2_pii_disambiguation_regex_ceiling.pubmedqa_clinical_eval;
ok('r2:devWords', comma(PQ.train_split_250.totalWords), E);
ok('r2:testWords', comma(PQ.test_split_250.totalWords), E);
ok('r2:devNaive', P(f1(PQ.train_split_250.naive_doc_fp_pct)), E);
ok('r2:devCtx', P(f1(PQ.train_split_250.context_doc_fp_pct)), E);
ok('r2:testNaive', P(f1(PQ.test_split_250.naive_doc_fp_pct)), E);
ok('r2:testCtx', P(f1(PQ.test_split_250.context_doc_fp_pct)), E);
ok('r2:devPer1kNaive', f2(PQ.train_split_250.naive_hits_per_1k_words), E);
ok('r2:devPer1kCtx', f2(PQ.train_split_250.context_hits_per_1k_words), E);
ok('r2:testPer1kNaive', f2(PQ.test_split_250.naive_hits_per_1k_words), E);
ok('r2:testPer1kCtx', f2(PQ.test_split_250.context_hits_per_1k_words), E);
ok('r2:reduction', f2(PQ.hit_reduction_ratio_test), E);
ok('r2:excluded', String(PQ.excluded_words_count), E);
// tex prints the lookalike guard as "4/5 to 1/5", not percentages
const LG = PQ.lookalike_guard_eval;
ok('r2:lookalikeNaive', `${Math.round(LG.lookalikeLinesTested * LG.naive_regex_fp_pct / 100)}/${LG.lookalikeLinesTested}`, E);
ok('r2:lookalikeCtx', `${Math.round(LG.lookalikeLinesTested * LG.verisieve_context_fp_pct / 100)}/${LG.lookalikeLinesTested}`, E);

/* ---------------- Paper 2: corpus + tab:ltt + tab:multiaxis (race_3) ---------------- */
const R3C = SC.race_3_ltt_conformal_calibration;
ok('r3:totalDocs', comma(R3C.split.nTotal), E);
ok('r3:unsafePct', P(f2(R3C.unsafePrevalence.fullCorpusPct)), E);
ok('r3:nCal', String(R3C.split.nCal), E);
ok('r3:nTest', String(R3C.split.nTest), E);
ok('r3:nCalUnsafe', String(R3C.split.nCalUnsafe), E);
for (const [key, e] of Object.entries(R3C.alphaSweep)) {
  ok(`ltt:${key}.tau`, f2(e.tauKeep), E);
  ok(`ltt:${key}.fpr`, P(f2(e.testCondFprPct)), E);
  ok(`ltt:${key}.joint`, P(f2(e.testJointRiskPct)), E);
  ok(`ltt:${key}.yield`, P(f2(e.safeRetentionYieldPct)), E);
  ok(`ltt:${key}.abs`, P(f2(e.abstentionRatePct)), E);
}
ok('ltt:uncal.tau', f2(R3C.uncalibratedBaseline.tauKeep), E);
ok('ltt:uncal.fpr', P(f2(R3C.uncalibratedBaseline.testCondFprPct)), E);
ok('ltt:uncal.joint', P(f2(R3C.uncalibratedBaseline.testJointRiskPct)), E);
ok('ltt:uncal.yield', P(f2(R3C.uncalibratedBaseline.safeRetentionYieldPct)), E);
const FIN = R3C.finiteSampleBoundaryAnalysis;
ok('finite:jointBinom', f4(FIN.jointRisk.binomCdfZero), E); // 0.0486
ok('finite:condBinom', f4(FIN.conditionalRisk.alpha_0_01.binomCdfZero), E); // 0.1261
ok('finite:requiredN', String(FIN.conditionalRisk.alpha_0_01.requiredN), E); // 299
const WD = R3C.withinDomainPubmedComparison;
ok('within:count', String(WD.testPubmedCount), E);
ok('within:gate', P(f1(WD.gate520AccPct)), E);
ok('within:regex', P(f1(WD.contactRegexAccPct)), E);
ok('within:anyPii', P(f1(WD.anyPiiRegexAccPct)), E);
const MA = R3C.customerLabelMultiAxisEval;
ok('ma:train', String(MA.trainCount), E);
ok('ma:cal', String(MA.calCount), E);
ok('ma:held', String(MA.heldOutTestCount), E);
for (const [axis, e] of Object.entries(MA.axes)) {
  if (e.heldOutRecallPct != null) ok(`ma:${axis}.recall`, P(f1(e.heldOutRecallPct)), E);
  if (e.heldOutPrecisionPct != null) ok(`ma:${axis}.precision`, P(f1(e.heldOutPrecisionPct)), E);
  ok(`ma:${axis}.abstain`, P(f1(e.abstentionRatePct)), E);
  ok(`ma:${axis}.tauKeep`, f2(e.tauKeep), E);
  ok(`ma:${axis}.tauDrop`, f2(e.tauDrop), E);
}
ok('ma:kept', String(MA.conjunctionPolicy.keptCount), E);
ok('ma:abstained', String(MA.conjunctionPolicy.abstainedCount), E);
ok('ma:dropped', String(MA.conjunctionPolicy.droppedCount), E);
ok('ma:abstainPct', P(f1(MA.conjunctionPolicy.conjunctionAbstentionPct)), E);

/* ---------------- Paper 2: tab:substrates + tab:ablation (race_4) ---------------- */
const R4S = SC.race_4_substrate_and_downstream_race;
const SUB = { single_header_c99: 'c99', pure_wasm_js: 'wasm', python_numpy: 'numpy' };
for (const [k, name] of Object.entries(SUB)) {
  const e = R4S.substrates[k];
  ok(`sub:${name}.spawn`, f2(e.processSpawnColdStartMs), E);
  ok(`sub:${name}.rss`, f2(e.peakRssMb), E);
  ok(`sub:${name}.warm`, f3(e.hotLoopInferenceMs), E);
  if (e.importMs != null) ok(`sub:${name}.import`, f2(e.importMs), E);
  if (e.inProcessWarmWasmInitMs != null) ok(`sub:${name}.init`, f3(e.inProcessWarmWasmInitMs), E);
}
// torch row prints integer-comma seconds and 1-dp RSS in the tex
const TORCH = R4S.substrates.local_python;
ok('sub:torch.spawn', comma(TORCH.processSpawnColdStartMs), E);
ok('sub:torch.rss', f1(TORCH.peakRssMb), E);
ok('sub:torch.warm', f2(TORCH.hotLoopInferenceMs), E);
ok('sub:torch.bigImport', comma(TORCH.frameworkImportMs), E);
ok('sub:c99.outlier', f1(Math.max(...R4S.substrates.single_header_c99.spawnSamplesMs)), E); // 549.9 ms
ok('sub:torch.outlier', f1(Math.max(...TORCH.spawnSamplesMs) / 1000), E); // 41.9 s
ok('sub:speedup', f1(SC.summary_findings.speedup_vs_pytorch_spawn), E);
ok('sub:memReduction', f1(SC.summary_findings.memory_reduction_factor_vs_pytorch), E);
// tex trims trailing zeros on BCE values (0.189, not 0.1890)
const fz4 = v => f(v, 4).replace(/(\.\d*?)0+$/, '$1');
for (const [k, e] of Object.entries(R4S.downstreamAblation)) {
  ok(`abl:${k}.gateBce`, fz4(e.verisieve_conformal.heldOutGateBceLoss), E);
  ok(`abl:${k}.gateAcc`, P(f0(e.verisieve_conformal.heldOutGateAccPct)), E);
  ok(`abl:${k}.veraBce`, fz4(e.verisieve_conformal.wasmVeraBceLoss), E);
  ok(`abl:${k}.leak`, P(f2(e.verisieve_conformal.contactPiiHighConfLeakPct)), E);
  ok(`abl:${k}.regexBce`, fz4(e.naive_regex.heldOutBceLoss), E);
  ok(`abl:${k}.regexAcc`, P(f1(e.naive_regex.heldOutAccPct)), E);
  ok(`abl:${k}.rawAcc`, P(f1(e.raw_unfiltered.heldOutAccPct)), E);
  ok(`abl:${k}.rawExp`, P(f0(e.raw_unfiltered.contactPiiExposurePct)), E);
}
ok('abl:bceReduction', P(f1(SC.summary_findings.post_training_gate_bce_loss_reduction_pct)), E);
const ND = R4S.needleBenchmark;
ok('needle:rawR5', P(f1(ND.raw_unmasked.recallAt5Pct)), E);
ok('needle:rawR1', P(f1(ND.raw_unmasked.recallAt1Pct)), E);
ok('needle:maskedR5', P(f1(ND.verisieve_masked.recallAt5Pct)), E);
ok('needle:maskedR1', P(f1(ND.verisieve_masked.recallAt1Pct)), E);
ok('needle:regexR5', P(f1(ND.naive_regex_corrupted.recallAt5Pct)), E);

/* ---------------- Paper 4 (graph-grounded corpus): artifacts ---------------- */
const ABL = j('amnesiac-corpus-ablation.json');
const CBS = j('company-brain-slice.json');
const APB = j('argon-parity-benchmark.json');
const CG = tex('verisieve-graph-grounded-enterprise-corpus.tex');
{
  const wasmTotal = ['verisieve_clean', 'verisieve_sql', 'verisieve_graph', 'verisieve_dl', 'verisieve_media']
    .reduce((n, m) => n + statSync(new URL(`vendor/wasm/${m}.wasm`, ROOT)).size, 0);
  ok('corpus:wasm.total', `$${comma(wasmTotal)}$\\,B`, CG);
  ok('corpus:egress', '$0$\\,B', CG);
  checks++;
  if (CBS.p3.receipt.networkSurfacesArmed.length !== 9) { fails++; console.error('FAIL [corpus:surfaces] expected 9 armed network surfaces'); }
  ok('corpus:surfaces.prose', 'nine network entry points', CG);

  const E = ABL.estate;
  ok('corpus:estate.files', `${f0(E.fileCount)}-file`, CG);
  ok('corpus:estate.departments', `${f0(E.departments.length)}-department`, CG);
  ok('corpus:estate.modalities', `across ${f0(E.modalities.length)} modalities`, CG);
  ok('corpus:estate.gtEntities', `${f0(E.groundTruthEntityCount)} ground-truth entities`, CG);
  ok('corpus:estate.corpusEntities', `${f0(E.corpusIndexedEntityCount)} corpus entities`, CG);
  ok('corpus:estate.indexed', `the ${f0(E.corpusIndexedEntityCount)} indexed entities`, CG);
  ok('corpus:cert.pass', P(f4(ABL.certificates.passRate * 100)), CG);
  ok('corpus:cert.lower', P(f4(ABL.certificates.certifiedPassRateLowerBound * 100)), CG);
  ok('corpus:cert.passing', `${f0(Math.round(ABL.certificates.passRate * ABL.corpus.sampleCount))} of ${f0(ABL.corpus.sampleCount)} samples`, CG);
  const cls = ABL.certificates.classes;
  ok('corpus:class.PERSON', `PERSON $${f0(cls.PERSON.detectedCount)}$`, CG);
  ok('corpus:class.EMAIL', `EMAIL $${f0(cls.EMAIL.detectedCount)}$`, CG);
  ok('corpus:class.PHONE', `PHONE $${f0(cls.PHONE.detectedCount)}$`, CG);
  ok('corpus:class.DOB', `DATE\\_OF\\_BIRTH $${f0(cls.DATE_OF_BIRTH.detectedCount)}$`, CG);
  ok('corpus:class.ADDRESS', `ADDRESS $${f0(cls.ADDRESS.detectedCount)}$`, CG);
  for (const [k, c] of Object.entries(cls)) {
    checks++;
    if (c.missedCount !== 0) { fails++; console.error(`FAIL [corpus:class.${k}.missed] expected 0 misses, got ${c.missedCount}`); }
  }
  ok('corpus:class.GITHUB_PAT.prose', 'GITHUB\\_PAT', CG);

  const lm = CBS.p2.linkMetric;
  ok('corpus:link.gt', `${f0(lm.gtLinks)} (entity, department-pair)`, CG);
  ok('corpus:link.recovered', `recovers all ${f0(lm.recoveredLinks)}`, CG);
  ok('corpus:link.precision', `F1 at $${f0(lm.precision * 100)}\\%$`, CG);
  checks++;
  if (lm.falsePositives !== 0) { fails++; console.error('FAIL [corpus:link.fp] expected 0 false positives'); }
  ok('corpus:link.fp.prose', 'zero false positives', CG);
  const er = CBS.p2.entityResolution;
  ok('corpus:link.persons', `all ${f0(er.gtPersonCount)} ground-truth people`, CG);
  checks++;
  if (er.gtEntitiesObserved !== er.gtPersonCount) { fails++; console.error('FAIL [corpus:link.personsObserved] gtEntitiesObserved != gtPersonCount'); }
  const cg = CBS.p4.connectionGraph;
  ok('corpus:graph.nodes', `${f0(cg.nodeCount)} nodes and ${f0(cg.edgeCount)} edges`, CG);
  const RSB = j('reviewer-secrets-audio-pprl-benchmarks.json');
  ok('corpus:pprl.falselink', P(f2(RSB.expR5_pprlRealityCheck.scale500CommonNamesCollision.pprlFalseLinkRateAtDevThrPct)), CG);

  for (const [frac, pct] of [['0.01', '1\\%'], ['0.05', '5\\%'], ['0.2', '20\\%']]) {
    const fr = ABL.fractions[frac];
    ok(`corpus:erase.${pct}.entities`, `${pct} & ${f0(fr.selectedEntityCount)} &`, CG);
    ok(`corpus:erase.${pct}.spans`, `${f0(fr.byteDiff.removedSpanBytes)}\\,B`, CG);
    ok(`corpus:erase.${pct}.delta`, `$-${f0(-fr.byteDiff.measuredDeltaBytes)}$\\,B`, CG);
    checks++;
    if (!fr.byteDiff.exact) { fails++; console.error(`FAIL [corpus:erase.${pct}.exact] byte-diff not exact`); }
  }

  const W = APB.workspaces;
  const w1 = W.W1.metrics;
  ok('corpus:argon.w1', `${f0(w1.diagramEdgeF1Pct.baseline)} / ${f0(w1.chartSeriesMatchPct.baseline)} & ${f0(w1.diagramEdgeF1Pct.versieve)} / ${f0(w1.chartSeriesMatchPct.versieve)}`, CG);
  const w2 = W.W2.metrics;
  ok('corpus:argon.w2.relerr', f4(w2.chartMeanRelErrPct.versieve), CG);
  ok('corpus:argon.w2.within2', `${f0(w2.chartRelErrWithin2pct.baseline)} & ${f0(w2.chartRelErrWithin2pct.versieve)}`, CG);
  const w3 = W.W3.metrics;
  ok('corpus:argon.w3.purity', `${f2(w3.speakerPurityPct.baseline)} & ${f0(w3.speakerPurityPct.versieve)}`, CG);
  ok('corpus:argon.w3.intent', `${f2(w3.prosodicIntentAccuracyPct.baseline)} & ${f0(w3.prosodicIntentAccuracyPct.versieve)}`, CG);
  const w4 = W.W4.metrics;
  ok('corpus:argon.w4', `${f0(w4.deicticGroundingRecallPct.baseline)} & ${f0(w4.deicticGroundingRecallPct.versieve)}`, CG);
  const w5 = W.W5.metrics;
  ok('corpus:argon.w5', `${f0(w5.sqlExactMatchPct.baseline)} & ${f0(w5.sqlExactMatchPct.versieve)}`, CG);
  const w6 = W.W6.metrics;
  ok('corpus:argon.w6', `${f0(w6.crossModalEntityLinkPct.baseline)} / ${f0(w6.multiHopQaParityPct.baseline)} & ${f0(w6.crossModalEntityLinkPct.versieve)} / ${f0(w6.multiHopQaParityPct.versieve)}`, CG);
}

/* ---------------- Paper 4: K3 head-to-head, K4 failure modes, K6 open estate ---------------- */
const KH = j('track-k-composition-head-to-head.json');
const FM = j('composed-corpus-failure-modes.json');
const OE = j('open-estate-baseline.json');
const NB = j('noisy-estate-baseline.json');
const NMAN = JSON.parse(readFileSync(new URL('fixtures/noisy-estate-manifest.json', ROOT), 'utf8'));
const K7 = j('track-k7-cag-vs-rag-vs-bm25.json');
const K7X = j('track-k7-bm25-contexts.json');
{
  // K3 estate + budget
  const K3E = KH.estate;
  ok('k3:estate.docs', `$${comma(K3E.documentCount)}$ documents over five text modalities`, CG);
  ok('k3:estate.people', `$${comma(NB.counts.people)}$ people, $${comma(NB.counts.mentions)}$ person mentions`, CG);
  ok('k3:estate.collisions', `${comma(NMAN.world.collisionPairs.length)} same-name collision pairs`, CG);
  ok('k3:floor.recall', `recall $${f2(NB.pairwise.recall * 100)}\\%$`, CG);
  ok('k3:floor.prec', `precision $${f2(NB.pairwise.precision * 100)}\\%$ with $${comma(NB.falseMerges.count)}$ false merges`, CG);
  ok('k3:estate.strata', `$${comma(K3E.strata.Q1)}$ single-document (Q1), $${comma(K3E.strata.Q2)}$ cross-document (Q2), and $${comma(K3E.strata.Q3)}$ disambiguation`, CG);
  checks++;
  if (K3E.questions !== 60) { fails++; console.error(`FAIL [k3:estate.q] expected 60 questions, got ${K3E.questions}`); }
  ok('k3:estate.q.prose', 'Sixty eval questions live only in the manifest', CG);
  ok('k3:budget', `budget of $${comma(KH.budget.budget)}$ training tokens`, CG);
  const CAN = KH.buildReceipts.canaries;
  ok('k3:canaries', `a ${comma(CAN.rows)}-row canary batch (${comma(CAN.canaryCount)} canaries at 1, 5, and 20 repetitions)`, CG);

  // K3 table: every cell recomputed from per-row answers
  const emOf = (arm, stratum) => 100 * arm.rows.filter(r => r.exact_match && (!stratum || r.stratum === stratum)).length / arm.rows.filter(r => !stratum || r.stratum === stratum).length;
  const judge = arm => arm.rows.reduce((s, r) => s + r.judge_score, 0) / arm.rows.length;
  const llama = arm => arm.rows.reduce((s, r) => s + r.llama_judge_score, 0) / arm.rows.length;
  const K3_ROWS = [
    ['flat', 'Flat 800-char chunks'],
    ['per_block', 'Per-block (readable)'],
    ['composed', 'Composed'],
    ['composed_pairs', 'Composed + pairs'],
    ['per_block_vaulted', 'Per-block (vaulted)'],
    ['retrieval', 'Graph-PPR retrieval'],
    ['base', 'Base (no fine-tune)'],
  ];
  for (const [key, label] of K3_ROWS) {
    const a = KH.arms[key];
    ok(`k3:row.${key}`, `${label} & ${f1(emOf(a, 'Q1'))} & ${f1(emOf(a, 'Q2'))} & ${f1(emOf(a, 'Q3'))} & ${f1(emOf(a))} & ${f2(judge(a))} & ${f2(llama(a))}`, CG);
  }
  const agr = Object.values(KH.judgeAgreement).map(v => v.rowAgreementPct);
  ok('k3:judge.agreement', `($${f1(Math.min(...agr))}$ to $${f1(Math.max(...agr))}\\%$ across arms)`, CG);

  // K3 reading paragraph
  const ratio = emOf(KH.arms.retrieval) / emOf(KH.arms.composed);
  ok('k3:ratio', `$${f1(ratio)}$ times the best trained arm`, CG);
  ok('k3:retrieval.q2', `and $${P(f1(emOf(KH.arms.retrieval, 'Q2')))}$ on the cross-document stratum`, CG);
  const PA = KH.budget.perArm;
  ok('k3:pairs.displaced', `only $${comma(PA.composed_pairs.post.rows)}$ rows with $${comma(PA.composed_pairs.post.learnableTokens)}$ learnable tokens survived (against $${comma(PA.composed.post.rows)}$ rows and $${comma(PA.composed.post.learnableTokens)}$ learnable tokens for composed alone)`, CG);
  ok('k3:vaulted.masked', `masks $${f2(PA.per_block_vaulted.pre.masked_subword_pct)}\\%$ of subwords`, CG);
  const TRAINED = ['flat', 'per_block', 'composed', 'composed_pairs', 'per_block_vaulted'];
  const bits = TRAINED.map(k => KH.arms[k].canaryExposure.all_12_bits);
  ok('k3:canary.range', `($${f2(Math.min(...bits))}$ to $${f2(Math.max(...bits))}$ bits over the ${comma(CAN.canaryCount)} canaries`, CG);
  ok('k3:canary.base', `against $${f2(KH.arms.base.canaryExposure.all_12_bits)}$ bits for the untrained base`, CG);
  ok('k3:ppl.composed', `composed at $${f1(KH.arms.composed.fluency.perplexity)}$ against base at $${f1(KH.arms.base.fluency.perplexity)}$`, CG);
  ok('k3:ppl.vaulted', `worst for vaulted ($${f1(KH.arms.per_block_vaulted.fluency.perplexity)}$)`, CG);

  // K4 failure modes
  const FR = FM.falseMergeAmplification.rates;
  const at = r => FR.find(x => x.rate === r);
  ok('k4:amp.25', `$${f4(at(0.25).composed.corruptionRate)}$ of its world-mappable occurrences against $${f4(at(0.25).perBlock.corruptionRate)}$ for per-block, an amplification factor of $${f2(at(0.25).amplificationFactor)}$`, CG);
  ok('k4:amp.50', `the rates are $${f4(at(0.5).composed.corruptionRate)}$ against $${f4(at(0.5).perBlock.corruptionRate)}$, a factor of $${f2(at(0.5).amplificationFactor)}$`, CG);
  ok('k4:amp.low', `composed already sits at $${f4(at(0.05).composed.corruptionRate)}$ and $${f4(at(0.1).composed.corruptionRate)}$`, CG);
  const occ = FR.filter(x => x.rate > 0).map(x => x.perBlock.falseIdentityOccurrences);
  ok('k4:falseId.range', `($${comma(Math.min(...occ))}$ to $${comma(Math.max(...occ))}$ occurrences across the ladder)`, CG);
  const HD = FM.hubDuplication;
  ok('k4:hub.samples', `($${comma(HD.analyzedSamples)}$ samples`, CG);
  ok('k4:hub.pairs', `$${comma(HD.overall.nearDuplicatePairs)}$ near-duplicate pairs of which $${comma(HD.overall.exactDuplicatePairs)}$ are exact duplicates`, CG);
  ok('k4:hub.fraction', `(fraction $${f1(HD.overall.nearDuplicateSampleFraction)}$)`, CG);
  ok('k4:hub.cap.prose', 'samples truncated by the hub cap are the near-duplicate-free ones', CG);
  checks++;
  if (HD.hub.hubSamples !== 6) { fails++; console.error(`FAIL [k4:hub.cap] expected 6 cap-truncated samples, got ${HD.hub.hubSamples}`); }

  // K6 open estate
  const OL = OE.layers.layerO, RL = OE.layers.layerR;
  ok('k6:layerR.docs', `${f0(RL.scoring.documents)} meeting transcripts from AMI and ICSI`, CG);
  ok('k6:layerR.people', `whose ${f0(RL.scoring.people)} corpus-labeled people`, CG);
  ok('k6:layerO.cast', `a ${f0(OL.scoring.people)}-person overlay cast`, CG);
  ok('k6:layerO.floor', `pairwise recall $${f2(OL.pairwise.recall * 100)}\\%$, precision $${f2(OL.pairwise.precision * 100)}\\%$, and $${comma(OL.falseMerges.count)}$ false merges`, CG);
  ok('k6:layerO.collisions', `on the ${f0(OL.scoring.collisionPairs)} designed collision pairs`, CG);
  ok('k6:layerR.ungated', `recall $${f0(RL.pairwise.recall * 100)}\\%$ at precision $${f2(RL.pairwise.precision * 100)}\\%$`, CG);
  const EN = OE.enron.scores;
  ok('k6:enron.floor', `pairwise recall $${f2(EN.pairwise.recall * 100)}\\%$ and precision $${f2(EN.pairwise.precision * 100)}\\%$`, CG);
  ok('k6:enron.merges', `with $${comma(EN.falseMerges.count)}$ false merges of which $${comma(EN.falseMerges.onCollisionPairs)}$ fall on designed collision pairs`, CG);
  checks++;
  if (!OE.enron.archiveSha256 || !OE.enron.sliceDir.startsWith('external')) { fails++; console.error('FAIL [k6:enron.pin] the committed artifact must carry the external Enron aggregates and archive pin'); }

  // K7 non-training arms (BM25 lexical control and CAG over composed records)
  const B7 = K7.arms.bm25_retrieval, C7 = K7.arms.cag, H7 = K7.arms.cag_hybrid;
  const k7 = (a, s) => a.eval[s].exactMatchPct;
  ok('k7:caption', 'The three K7 arms train nothing and were scored by exact match only', CG);
  ok('k7:row.bm25', `BM25 retrieval (K7) & ${f1(k7(B7, 'Q1'))} & ${f1(k7(B7, 'Q2'))} & ${f1(k7(B7, 'Q3'))} & ${f1(k7(B7, 'all'))} & -- & -- \\\\`, CG);
  ok('k7:row.cag', `CAG over composed records (K7) & ${f1(k7(C7, 'Q1'))} & ${f1(k7(C7, 'Q2'))} & ${f1(k7(C7, 'Q3'))} & ${f1(k7(C7, 'all'))} & -- & -- \\\\`, CG);
  ok('k7:bm25.topK', `feeding top-${K7X.bm25.topK} contexts`, CG);
  ok('k7:bm25.prose', `$${P(f1(k7(B7, 'all')))}$ overall ($${P(f1(k7(B7, 'Q1')))}$ Q1, $${P(f1(k7(B7, 'Q2')))}$ Q2, $${P(f1(k7(B7, 'Q3')))}$ Q3)`, CG);
  const graphEm = emOf(KH.arms.retrieval);
  ok('k7:graph.overall', `the graph retriever's $${P(f1(graphEm))}$ within noise at $n{=}${K7.estate.questions}$`, CG);
  ok('k7:graph.honest', `on this estate the graph's contribution is not retrieval quality`, CG);
  ok('k7:strata.prose', `at stratum sizes of $${B7.eval.Q1.n}$, $${B7.eval.Q2.n}$, and $${B7.eval.Q3.n}$`, CG);
  ok('k7:q3.bm25', `BM25 answers $${B7.q3Disambiguation.exactMatchCount}$ of $${B7.q3Disambiguation.n}$`, CG);
  const gq3 = KH.arms.retrieval.rows.filter(r => r.stratum === 'Q3');
  ok('k7:q3.graph', `Graph-PPR $${gq3.filter(r => r.exact_match).length}$ of $${gq3.length}$`, CG);
  ok('k7:q3.cag', `the cache arm $${C7.q3Disambiguation.exactMatchCount}$ of $${C7.q3Disambiguation.n}$`, CG);
  ok('k7:cache.unit', `$${K7.cacheUnit.selectedRecords}$ composed per-entity records selected by greedy set-cover over the $${K7.cacheUnit.questionPersons}$ unique question persons and $${K7.cacheUnit.prefillTokens}$ prefill tokens`, CG);
  ok('k7:cag.overall', `$${P(f1(k7(C7, 'all')))}$ against $${P(f1(graphEm))}$ and $${P(f1(k7(B7, 'all')))}$`, CG);
  ok('k7:cag.q3', `leads on disambiguation ($${P(f1(k7(C7, 'Q3')))}$, $${C7.q3Disambiguation.exactMatchCount}$ of $${C7.q3Disambiguation.n}$)`, CG);
  ok('k7:cag.q1', `trails on single-document questions ($${P(f1(k7(C7, 'Q1')))}$ against BM25's $${P(f1(k7(B7, 'Q1')))}$)`, CG);
  ok('k7:tokens.amortization', `appends $${C7.tokenAccounting.appendedTokensMean}$ mean tokens after the one-time prefill, against $${f0(B7.tokenAccounting.promptTokensMean)}$ mean prompt tokens`, CG);
  const hsel = H7.rows.map(r => r.selectedRecords);
  ok('k7:row.hybrid', `CAG hybrid routing (K7) & ${f1(k7(H7, 'Q1'))} & ${f1(k7(H7, 'Q2'))} & ${f1(k7(H7, 'Q3'))} & ${f1(k7(H7, 'all'))} & -- & -- \\\\`, CG);
  ok('k7:q3.hybrid', `and the hybrid routing arm $${H7.q3Disambiguation.exactMatchCount}$ of $${H7.q3Disambiguation.n}$`, CG);
  ok('k7:hybrid.records', `the person's $${Math.min(...hsel)}$ or $${Math.max(...hsel)}$ subject records`, CG);
  ok('k7:hybrid.overall', `$${P(f1(k7(H7, 'all')))}$ overall ($${P(f1(k7(H7, 'Q1')))}$ Q1, $${P(f1(k7(H7, 'Q2')))}$ Q2, $${P(f1(k7(H7, 'Q3')))}$ Q3, $${H7.q3Disambiguation.exactMatchCount}$ of $${H7.q3Disambiguation.n}$ disambiguation)`, CG);
  ok('k7:hybrid.hedge', `at $n{=}${K7.estate.questions}$ this is one estate's measurement`, CG);
  ok('k7:hybrid.prefill', `a mean of $${f0(H7.tokenAccounting.prefillTokensMean)}$ prefill tokens rebuilds the cache per question`, CG);
  ok('k7:hybrid.appended', `still appends only $${H7.tokenAccounting.appendedTokensMean}$ mean tokens`, CG);

  // Exact binomial (Clopper-Pearson) 95% intervals, computed from committed rows
  const lgamma = (() => { const t = [0]; for (let i = 1; i < 500; i++) t[i] = t[i - 1] + Math.log(i); return n => t[n]; })();
  const binomCdf = (k, n, p) => { if (k >= n) return 1; if (k < 0) return 0; let s = 0; for (let i = 0; i <= k; i++) s += Math.exp(lgamma(n) - lgamma(i) - lgamma(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p)); return Math.min(1, Math.max(0, s)); };
  const solveP = (k, n, target) => { let lo = 0, hi = 1; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (binomCdf(k, n, m) > target) lo = m; else hi = m; } return (lo + hi) / 2; };
  const cp95 = (k, n) => [k === 0 ? 0 : solveP(k - 1, n, 0.975), k === n ? 1 : solveP(k, n, 0.025)];
  const cnt = arm => arm.rows.filter(r => r.exact_match).length;
  const emAll = arm => f1(100 * cnt(arm) / arm.rows.length);
  const ci = arm => { const [lo, hi] = cp95(cnt(arm), arm.rows.length); return [f1(100 * lo), f1(100 * hi)]; };
  const [plo, phi] = ci(KH.arms.retrieval), [blo, bhi] = ci(B7), [clo, chi] = ci(C7), [hlo, hhi] = ci(H7), [mlo, mhi] = ci(KH.arms.composed), [pblo, pbhi] = ci(KH.arms.per_block), [flo, fhi] = ci(KH.arms.flat), [baslo, bashi] = ci(KH.arms.base);
  ok('k7:ci.ppr', `Graph-PPR $${P(emAll(KH.arms.retrieval))}$, interval $${plo}$ to $${phi}$`, CG);
  ok('k7:ci.bm25', `BM25 $${P(f1(k7(B7, 'all')))}$, $${blo}$ to $${bhi}$`, CG);
  ok('k7:ci.cag', `CAG $${P(k7(C7, 'all'))}$, $${clo}$ to $${chi}$`, CG);
  ok('k7:ci.hybrid', `$${P(k7(H7, 'all'))}$ ($${hlo}$ to $${hhi}$)`, CG);
  ok('k7:ci.composed', `at $${P(emAll(KH.arms.composed))}$ ($${mlo}$ to $${mhi}$)`, CG);
  ok('k7:ci.perblock', `against $${P(emAll(KH.arms.per_block))}$ ($${pblo}$ to $${pbhi}$) per-block`, CG);
  ok('k7:ci.flat', `$${P(emAll(KH.arms.flat))}$ ($${flo}$ to $${fhi}$) flat`, CG);
  ok('k7:ci.base', `$${P(emAll(KH.arms.base))}$ ($${baslo}$ to $${bashi}$) for the untrained base`, CG);
  ok('k7:bm25.params', `(Okapi BM25, $k_1{=}${K7X.bm25.k1}$, $b{=}${K7X.bm25.b}$, $${K7X.pool.passages}$ passages`, CG);
  ok('k7:setcover', `greedy set-cover over the $${K7.cacheUnit.questionPersons}$ unique question persons`, CG);
  ok('k7:abstract.controls', `a lexical BM25 control ties the graph retriever ($${P(f1(k7(B7, 'all')))}$ against $${P(emAll(KH.arms.retrieval))}$, overlapping $95\\%$ intervals at $n{=}${K7.estate.questions}$)`, CG);
  ok('k7:abstract.cag', `the composed records cached as one fixed unit tie the retrieval arms ($${P(k7(C7, 'all'))}$)`, CG);
  ok('k7:abstract.hybrid', `answers $${P(k7(H7, 'all'))}$, the strongest arm measured`, CG);
  ok('k7:abstract.router', `pays off as a retrieval index and, in the strongest measured arm, as a router`, CG);
  ok('k7:conclusion.router', `and, in the strongest measured arm, as a router ($${P(k7(H7, 'all'))}$ when each question's cache is prefilled from the asked person's own records, against $${P(f1(k7(B7, 'all')))}$ for the lexical control)`, CG);
}

/* ---------------- Word bans (founder rule, all three papers) ---------------- */
for (const [name, body] of [['M', M], ['L', L], ['E', E], ['CG', CG]]) {
  for (const [label, re] of [
    ['mathematically grounded', /mathematically\s+grounded/i],
    ['eliminates/eliminating', /eliminat/i],
    ['novelty "first"', /\b(?:first to|the first|for the first time|our first)\b/i],
  ]) {
    checks++;
    if (re.test(body)) {
      fails++;
      console.error(`FAIL [${name}:word-ban] banned phrase: ${label}`);
    }
  }
}

console.log(`\n${checks} paper-number checks, ${fails} failure${fails === 1 ? '' : 's'}`);
process.exit(fails ? 1 : 0);
