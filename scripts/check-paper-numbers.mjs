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

const M = tex('versieve-multimodal-sanitization-benchmark.tex');
const L = tex('versieve-local-training-benchmark.tex');
const E = tex('versieve-extraction-redaction-benchmark.tex');

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
for (const mod of ['versieve_clean', 'versieve_sql', 'versieve_graph', 'versieve_dl', 'versieve_media']) {
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
ok('secrets:wasm.steady', f1(R3.versieve_media_wasm.steadyStateCliWithIoMs), M);
ok('secrets:gitleaks.steady', f1(R3.gitleaks_v8_30_1.steadyState1xMs), M);
ok('secrets:posFiles', String(R3.positiveFiles), M);
ok('secrets:negFiles', String(R3.negativeFiles), M);
ok('secrets:totalKB', f1(R3.totalBytes1x / 1000), M); // "78.1 KB"
// derived speedups from the artifact's own steady-state MB/s
ok('secrets:vsYelp', f1(R3.versieve_media_wasm.steadyStateMBps / R3.yelp_detect_secrets.steadyStateMBps), M);
ok('secrets:vsGitleaksCold', f1(R3.gitleaks_v8_30_1.cold1xWallMs / R3.versieve_media_wasm.cold1xWallMs), M);

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
ok('ptlm:zeroEchoDenominator', '$0$ of $210$', L);
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
// The paper quotes the peak, not the uneven nonzero minimum.
ok('sweep:oosMax', `reaches up to $${P(f1(Math.max(...nonzeroOos)))}$ at $240$ steps`, L);
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
// Paper 2 delegates downstream QA and canary measurements to the companion
// local-training study. The raw-vs-safe drop range is checked against L above.
const q15 = MODELS.qwen15b;
ok('td:q15.safe.refusalPct', P(f1(100 * q15.heldout_50q_summary.T2_CHAT_SAFE_LORA.in_scope_false_refusal_count / 40)), L);
ok('td:q15.safe.seenEchoCount', `${q15.seen_20q_summary.T2_CHAT_SAFE_LORA.pii_tag_echo_count}/20`, L);

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
ok('r2:lookalikeCtx', `${Math.round(LG.lookalikeLinesTested * LG.versieve_context_fp_pct / 100)}/${LG.lookalikeLinesTested}`, E);

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
  ok(`abl:${k}.gateBce`, fz4(e.versieve_conformal.heldOutGateBceLoss), E);
  ok(`abl:${k}.gateAcc`, P(f0(e.versieve_conformal.heldOutGateAccPct)), E);
  ok(`abl:${k}.veraBce`, fz4(e.versieve_conformal.wasmVeraBceLoss), E);
  ok(`abl:${k}.leak`, P(f2(e.versieve_conformal.contactPiiHighConfLeakPct)), E);
  ok(`abl:${k}.regexBce`, fz4(e.naive_regex.heldOutBceLoss), E);
  ok(`abl:${k}.regexAcc`, P(f1(e.naive_regex.heldOutAccPct)), E);
  ok(`abl:${k}.rawAcc`, P(f1(e.raw_unfiltered.heldOutAccPct)), E);
  ok(`abl:${k}.rawExp`, P(f0(e.raw_unfiltered.contactPiiExposurePct)), E);
}
ok('abl:bceReduction', P(f1(SC.summary_findings.post_training_gate_bce_loss_reduction_pct)), E);
const ND = R4S.needleBenchmark;
ok('needle:rawR5', P(f1(ND.raw_unmasked.recallAt5Pct)), E);
ok('needle:rawR1', P(f1(ND.raw_unmasked.recallAt1Pct)), E);
ok('needle:maskedR5', P(f1(ND.versieve_masked.recallAt5Pct)), E);
ok('needle:maskedR1', P(f1(ND.versieve_masked.recallAt1Pct)), E);
ok('needle:regexR5', P(f1(ND.naive_regex_corrupted.recallAt5Pct)), E);

/* ---------------- Paper 4 (graph-grounded corpus): artifacts ---------------- */
const ABL = j('amnesiac-corpus-ablation.json');
const CBS = j('company-brain-slice.json');
const APB = j('argon-parity-benchmark.json');
const CG = tex('versieve-graph-grounded-enterprise-corpus.tex');
{
  const wasmTotal = ['versieve_clean', 'versieve_sql', 'versieve_graph', 'versieve_dl', 'versieve_media']
    .reduce((n, m) => n + statSync(new URL(`vendor/wasm/${m}.wasm`, ROOT)).size, 0);
  ok('corpus:wasm.total', `$${comma(wasmTotal)}$\\,B`, CG);
  ok('corpus:egress', '$0$\\,B', CG);
  checks++;
  if (CBS.p3.receipt.networkSurfacesArmed.length !== 9) { fails++; console.error('FAIL [corpus:surfaces] expected 9 armed network surfaces'); }
  ok('corpus:surfaces.prose', 'nine network entry points', CG);

  const E = ABL.estate;
  ok('corpus:estate.files', `${f0(E.fileCount)} files`, CG);
  ok('corpus:estate.departments', `${f0(E.departments.length)} departments (IT, business, shared, meetings)`, CG);
  ok('corpus:estate.modalities', `and ${f0(E.modalities.length)} modalities`, CG);
  ok('corpus:estate.gtEntities', `${f0(E.groundTruthEntityCount)} ground-truth entities`, CG);
  ok('corpus:estate.corpusEntities', `${f0(E.corpusIndexedEntityCount)}-entity corpus`, CG);
  ok('corpus:estate.indexed', `the ${f0(E.corpusIndexedEntityCount)} indexed entities`, CG);
  ok('corpus:cert.pass', P(f4(ABL.certificates.passRate * 100)), CG);
  ok('corpus:cert.lower', P(f4(ABL.certificates.certifiedPassRateLowerBound * 100)), CG);
  ok('corpus:cert.passing', `${f0(Math.round(ABL.certificates.passRate * ABL.corpus.sampleCount))} of ${f0(ABL.corpus.sampleCount)} samples`, CG);
  const cls = ABL.certificates.classes;
  const fzTrim = v => f2(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
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
  // per-class certified recall lower bounds (S15 paragraph)
  ok('corpus:cert.class.PERSON', `PERSON $${fzTrim(cls.PERSON.certifiedRecallLowerBound * 100)}\\%$ over $${f0(cls.PERSON.detectedCount)}$ detections`, CG);
  ok('corpus:cert.class.EMAIL', `EMAIL $${fzTrim(cls.EMAIL.certifiedRecallLowerBound * 100)}\\%$ over $${f0(cls.EMAIL.detectedCount)}$`, CG);
  ok('corpus:cert.class.PHONE', `PHONE $${fzTrim(cls.PHONE.certifiedRecallLowerBound * 100)}\\%$ over $${f0(cls.PHONE.detectedCount)}$`, CG);
  ok('corpus:cert.class.DOB', `DATE\\_OF\\_BIRTH $${fzTrim(cls.DATE_OF_BIRTH.certifiedRecallLowerBound * 100)}\\%$ over $${f0(cls.DATE_OF_BIRTH.detectedCount)}$`, CG);
  ok('corpus:cert.class.ADDRESS', `ADDRESS $${fzTrim(cls.ADDRESS.certifiedRecallLowerBound * 100)}\\%$ over $${f0(cls.ADDRESS.detectedCount)}$`, CG);
  ok('corpus:cert.class.GITHUB_PAT', `GITHUB\\_PAT class $${fzTrim(cls.GITHUB_PAT.certifiedRecallLowerBound * 100)}\\%$ over its single detection`, CG);
  checks++;
  if (cls.GITHUB_PAT.detectedCount !== 1) { fails++; console.error(`FAIL [corpus:cert.class.GITHUB_PAT.count] expected 1 detection, got ${cls.GITHUB_PAT.detectedCount}`); }

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
  ok('corpus:argon.w1.edge', `diagram-edge F1 (\\%) & ${f0(w1.diagramEdgeF1Pct.baseline)} & ${f0(w1.diagramEdgeF1Pct.versieve)}`, CG);
  ok('corpus:argon.w1.chart', `chart-series match (\\%) & ${f0(w1.chartSeriesMatchPct.baseline)} & ${f0(w1.chartSeriesMatchPct.versieve)}`, CG);
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
  ok('corpus:argon.w6.link', `cross-modal link (\\%) & ${f0(w6.crossModalEntityLinkPct.baseline)} & ${f0(w6.crossModalEntityLinkPct.versieve)}`, CG);
  ok('corpus:argon.w6.qa', `multi-hop QA (\\%) & ${f0(w6.multiHopQaParityPct.baseline)} & ${f0(w6.multiHopQaParityPct.versieve)}`, CG);
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
  ok('k3:budget', `token budget capped at $${comma(KH.budget.budget)}$ training tokens`, CG);
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
  ok('k3:ratio', `$${f1(ratio)}$ times the composed arm's $${P(f1(emOf(KH.arms.composed)))}$`, CG);
  ok('k3:retrieval.q2', `and $${P(f1(emOf(KH.arms.retrieval, 'Q2')))}$ on the cross-document stratum`, CG);
  const PA = KH.budget.perArm;
  ok('k3:pairs.displaced', `only $${comma(PA.composed_pairs.post.rows)}$ rows with $${comma(PA.composed_pairs.post.learnableTokens)}$ learnable tokens survived (against $${comma(PA.composed.post.rows)}$ rows and $${comma(PA.composed.post.learnableTokens)}$ learnable tokens for composed alone)`, CG);
  ok('k3:vaulted.masked', `masks $${f2(PA.per_block_vaulted.pre.masked_subword_pct)}\\%$ of subwords`, CG);
  const TRAINED = ['flat', 'per_block', 'composed', 'composed_pairs', 'per_block_vaulted'];
  const bits = TRAINED.map(k => KH.arms[k].canaryExposure.all_12_bits);
  ok('k3:canary.range', `($${f2(Math.min(...bits))}$ to $${f2(Math.max(...bits))}$ bits over the ${comma(CAN.canaryCount)} canaries`, CG);
  ok('k3:canary.base', `against $${f2(KH.arms.base.canaryExposure.all_12_bits)}$ bits for the untrained base`, CG);
  ok('k3:ppl.composed', `composed moves to $${f1(KH.arms.composed.fluency.perplexity)}$`, CG);
  ok('k3:ppl.base', `every trained arm loses fluency against base ($${f1(KH.arms.base.fluency.perplexity)}$)`, CG);
  ok('k3:ppl.vaulted', `vaulted is worst at $${f1(KH.arms.per_block_vaulted.fluency.perplexity)}$, with zero placeholder emissions`, CG);
  // canary rank-1 agreement sentences (S11 rewrite)
  ok('k3:canary.batch', `The canary batch is ${comma(CAN.canaryCount)} planted canaries (email, phone, and name types)`, CG);
  ok('k3:canary.rank1', `every trained arm ranks $${f0(KH.arms.flat.canaryExposure.rank1_count)}$ of the $${f0(CAN.canaryCount)}$ canaries first, the base $${f0(KH.arms.base.canaryExposure.rank1_count)}$ of $${f0(CAN.canaryCount)}$`, CG);
  for (const t of TRAINED) {
    checks++;
    if (KH.arms[t].canaryExposure.rank1_count !== 8) { fails++; console.error(`FAIL [k3:canary.rank1.${t}] expected 8 rank-1 canaries, got ${KH.arms[t].canaryExposure.rank1_count}`); }
  }
  checks++;
  if (KH.arms.base.canaryExposure.rank1_count !== 3) { fails++; console.error(`FAIL [k3:canary.rank1.base] expected 3 rank-1 canaries, got ${KH.arms.base.canaryExposure.rank1_count}`); }
  const baseRank1 = KH.arms.base.canaryExposure.per_canary.filter(c => c.rank === 1);
  checks++;
  if (baseRank1.length !== 3 || !baseRank1.every(c => c.type === 'name')) { fails++; console.error(`FAIL [k3:canary.rank1.types] base rank-1 canaries are not the three name canaries`); }
  checks++;
  if (KH.arms.flat.fluency.heldOutCleanText.includes('10 fixed generic paragraphs') !== true) { fails++; console.error('FAIL [k3:fluency.text] heldOutCleanText no longer describes 10 fixed generic paragraphs'); }
  ok('k3:fluency.prose', `Held-out perplexity is measured on 10 fixed generic paragraphs ($${f0(KH.arms.flat.fluency.nllTokens)}$ tokens, no estate content)`, CG);
  for (const t of [...TRAINED, 'retrieval', 'base']) {
    checks++;
    if (KH.arms[t].fluency.placeholderEmissionCount !== 0) { fails++; console.error(`FAIL [k3:fluency.placeholder.${t}] expected 0 placeholder emissions, got ${KH.arms[t].fluency.placeholderEmissionCount}`); }
  }
  // budget truncation coverage needles (design paragraph + tab:k3 caption)
  ok('k3:coverage.tokens', `flat $${comma(PA.flat.post.totalTokens)}$, per-block $${comma(PA.per_block.post.totalTokens)}$, composed $${comma(PA.composed.post.totalTokens)}$, composed-plus-pairs $${comma(PA.composed_pairs.post.totalTokens)}$, vaulted $${comma(PA.per_block_vaulted.post.totalTokens)}$ tokens`, CG);
  ok('k3:coverage.rows', `flat keeps $${f0(PA.flat.post.rows)}$ of $${f0(PA.flat.pre.rows)}$ rows, per-block $${f0(PA.per_block.post.rows)}$ of $${f0(PA.per_block.pre.rows)}$, composed $${f0(PA.composed.post.rows)}$ of $${comma(PA.composed.pre.rows)}$ ($${f1(100 * PA.composed.post.rows / PA.composed.pre.rows)}\\%$; a separate receipted build`, CG);
  ok('k3:coverage.entities', `composed keeps $${comma(PA.composed.keptEntities)}$ distinct entities against per-block's $${comma(PA.per_block.keptEntities)}$`, CG);
  ok('k3:coverage.caption', `kept rows per arm: flat $${f0(PA.flat.post.rows)}/${f0(PA.flat.pre.rows)}$, per-block $${f0(PA.per_block.post.rows)}/${f0(PA.per_block.pre.rows)}$, composed $${f0(PA.composed.post.rows)}/${comma(PA.composed.pre.rows)}$, composed-plus-pairs $${f0(PA.composed_pairs.post.rows)}/${comma(PA.composed_pairs.pre.rows)}$, vaulted $${f0(PA.per_block_vaulted.post.rows)}/${f0(PA.per_block_vaulted.pre.rows)}$`, CG);
  checks++;
  if (PA.flat.keptEntities !== 0) { fails++; console.error(`FAIL [k3:coverage.flatEntities] flat should carry no entity list, got ${PA.flat.keptEntities}`); }

  // K4 failure modes
  const FR = FM.falseMergeAmplification.rates;
  const at = r => FR.find(x => x.rate === r);
  ok('k4:amp.25', `$${f4(at(0.25).composed.corruptionRate)}$ of its world-mappable occurrences against $${f4(at(0.25).perBlock.corruptionRate)}$ for per-block, an amplification factor of $${f2(at(0.25).amplificationFactor)}$`, CG);
  ok('k4:amp.50', `the rates are $${f4(at(0.5).composed.corruptionRate)}$ against $${f4(at(0.5).perBlock.corruptionRate)}$, a factor of $${f2(at(0.5).amplificationFactor)}$`, CG);
  ok('k4:amp.low', `composed already sits at $${f4(at(0.05).composed.corruptionRate)}$ and $${f4(at(0.1).composed.corruptionRate)}$`, CG);
  const occ = FR.filter(x => x.rate > 0).map(x => x.perBlock.falseIdentityOccurrences);
  ok('k4:falseId.range', `($${comma(Math.min(...occ))}$ to $${comma(Math.max(...occ))}$ occurrences across the ladder)`, CG);
  const HD = FM.hubDuplication;
  ok('k4:hub.samples', `carries $${comma(HD.analyzedSamples)}$ samples`, CG);
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
  // Layer R collapse numbers quoted in prose (S17 remediation): mentions, string groups, false merges
  ok('k6:layerR.collapse', `$${comma(RL.scoring.mentions)}$ mentions into $${comma(RL.scoring.stringGroups)}$ string groups`, CG);
  ok('k6:layerR.falseMerges', `$${comma(RL.falseMerges.count)}$ false merges, none on designed collision pairs`, CG);
  checks++;
  if (RL.falseMerges.onCollisionPairs !== 0) { fails++; console.error(`FAIL [k6:layerR.collision] expected 0 false merges on collision pairs, got ${RL.falseMerges.onCollisionPairs}`); }
  const EN = OE.enron.scores;
  ok('k6:enron.floor', `pairwise recall $${f2(EN.pairwise.recall * 100)}\\%$ and precision $${f2(EN.pairwise.precision * 100)}\\%$`, CG);
  ok('k6:enron.merges', `with $${comma(EN.falseMerges.count)}$ false merges of which $${comma(EN.falseMerges.onCollisionPairs)}$ fall on designed collision pairs`, CG);
  checks++;
  if (!OE.enron.archiveSha256 || !OE.enron.sliceDir.startsWith('external')) { fails++; console.error('FAIL [k6:enron.pin] the committed artifact must carry the external Enron aggregates and archive pin'); }

  // K7 non-training arms (BM25 lexical control and CAG over composed records)
  const B7 = K7.arms.bm25_retrieval, C7 = K7.arms.cag, H7 = K7.arms.cag_hybrid;
  const k7 = (a, s) => a.eval[s].exactMatchPct;
  ok('k7:caption', 'BM25, fixed-cache CAG, and the per-question hybrid routing arms train nothing; as a design choice they are scored by exact match only', CG);
  ok('k7:row.bm25', `BM25 retrieval & ${f1(k7(B7, 'Q1'))} & ${f1(k7(B7, 'Q2'))} & ${f1(k7(B7, 'Q3'))} & ${f1(k7(B7, 'all'))} & -- & -- & EM \\\\`, CG);
  ok('k7:row.cag', `CAG set-cover$^{\\ast}$ & ${f1(k7(C7, 'Q1'))} & ${f1(k7(C7, 'Q2'))} & ${f1(k7(C7, 'Q3'))} & ${f1(k7(C7, 'all'))} & -- & -- & EM \\\\`, CG);
  ok('k7:bm25.topK', `feeding top-${K7X.bm25.topK} contexts`, CG);
  ok('k7:bm25.prose', `$${P(f1(k7(B7, 'all')))}$ overall ($${P(f1(k7(B7, 'Q1')))}$ Q1, $${P(f1(k7(B7, 'Q2')))}$ Q2, $${P(f1(k7(B7, 'Q3')))}$ Q3)`, CG);
  const graphEm = emOf(KH.arms.retrieval);
  ok('k7:graph.overall', `numerically above the graph retriever's $${P(f1(graphEm))}$ and within noise at $n{=}${K7.estate.questions}$`, CG);
  ok('k7:graph.honest', `on this estate the graph's contribution is not retrieval quality`, CG);
  ok('k7:strata.prose', `at stratum sizes of $${B7.eval.Q1.n}$, $${B7.eval.Q2.n}$, and $${B7.eval.Q3.n}$`, CG);
  ok('k7:q3.bm25', `BM25 answers $${B7.q3Disambiguation.exactMatchCount}$ of $${B7.q3Disambiguation.n}$`, CG);
  const gq3 = KH.arms.retrieval.rows.filter(r => r.stratum === 'Q3');
  ok('k7:q3.graph', `Graph-PPR $${gq3.filter(r => r.exact_match).length}$ of $${gq3.length}$`, CG);
  ok('k7:q3.cag', `the cache arm $${C7.q3Disambiguation.exactMatchCount}$ of $${C7.q3Disambiguation.n}$`, CG);
  ok('k7:cache.unit', `$${K7.cacheUnit.selectedRecords}$ composed per-entity records selected by greedy set-cover over the $${K7.cacheUnit.questionPersons}$ unique question persons and $${comma(K7.cacheUnit.prefillTokens)}$ prefill tokens`, CG);
  ok('k7:cag.overall', `$${P(f1(k7(C7, 'all')))}$ against $${P(f1(graphEm))}$ and $${P(f1(k7(B7, 'all')))}$`, CG);
  ok('k7:cag.q3', `leads on disambiguation ($${P(f1(k7(C7, 'Q3')))}$, $${C7.q3Disambiguation.exactMatchCount}$ of $${C7.q3Disambiguation.n}$)`, CG);
  ok('k7:cag.q1', `trails on single-document questions ($${P(f1(k7(C7, 'Q1')))}$ against BM25's $${P(f1(k7(B7, 'Q1')))}$)`, CG);
  ok('k7:tokens.amortization', `appends $${C7.tokenAccounting.appendedTokensMean}$ mean tokens after the one-time prefill, against $${comma(f0(B7.tokenAccounting.promptTokensMean))}$ mean prompt tokens`, CG);
  const hsel = H7.rows.map(r => r.selectedRecords);
  ok('k7:row.hybrid', `CAG hybrid routing & ${f1(k7(H7, 'Q1'))} & ${f1(k7(H7, 'Q2'))} & ${f1(k7(H7, 'Q3'))} & ${f1(k7(H7, 'all'))} & -- & -- & EM \\\\`, CG);
  ok('k7:q3.hybrid', `and the hybrid routing arm $${H7.q3Disambiguation.exactMatchCount}$ of $${H7.q3Disambiguation.n}$`, CG);
  ok('k7:hybrid.records', `the person's $${Math.min(...hsel)}$ or $${Math.max(...hsel)}$ subject records`, CG);
  ok('k7:hybrid.overall', `$${P(f1(k7(H7, 'all')))}$ overall ($${P(f1(k7(H7, 'Q1')))}$ Q1, $${P(f1(k7(H7, 'Q2')))}$ Q2, $${P(f1(k7(H7, 'Q3')))}$ Q3, $${H7.q3Disambiguation.exactMatchCount}$ of $${H7.q3Disambiguation.n}$ disambiguation)`, CG);
  ok('k7:hybrid.hedge', `at $n{=}${K7.estate.questions}$ this is one estate's measurement`, CG);
  ok('k7:hybrid.prefill', `a mean of $${comma(f0(H7.tokenAccounting.prefillTokensMean))}$ prefill tokens rebuilds the cache per question`, CG);
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
  ok('k7:ci.ppr', `Graph-PPR $${P(emAll(KH.arms.retrieval))}$ ($${plo}$ to $${phi}$)`, CG);
  ok('k7:ci.bm25', `BM25 $${P(f1(k7(B7, 'all')))}$ ($${blo}$ to $${bhi}$)`, CG);
  ok('k7:ci.cag', `CAG $${P(k7(C7, 'all'))}$ ($${clo}$ to $${chi}$)`, CG);
  ok('k7:ci.hybrid', `hybrid routing $${P(k7(H7, 'all'))}$ ($${hlo}$ to $${hhi}$; routing given a correctly resolved identity), composed`, CG);
  ok('k7:ci.composed', `composed $${P(emAll(KH.arms.composed))}$ ($${mlo}$ to $${mhi}$), per-block`, CG);
  ok('k7:ci.perblock', `per-block $${P(emAll(KH.arms.per_block))}$ ($${pblo}$ to $${pbhi}$), flat`, CG);
  ok('k7:ci.flat', `flat $${P(emAll(KH.arms.flat))}$ ($${flo}$ to $${fhi}$), and base`, CG);
  ok('k7:ci.base', `base $${P(emAll(KH.arms.base))}$ ($${baslo}$ to $${bashi}$). Interval overlap`, CG);
  ok('k7:bm25.params', `(Okapi BM25~\\cite{robertson2009bm25}, $k_1{=}${K7X.bm25.k1}$, $b{=}${K7X.bm25.b}$, $${K7X.pool.passages}$ passages`, CG);
  ok('k7:setcover', `greedy set-cover over the $${K7.cacheUnit.questionPersons}$ unique question persons`, CG);
  ok('k7:abstract.controls', `Retrieval over the entity graph, with no fine-tuning, answers $${P(emAll(KH.arms.retrieval))}$ exactly ($${P(f1(emOf(KH.arms.retrieval, 'Q2')))}$ on the 24-question cross-document stratum); a lexical BM25 control answers $${P(f1(k7(B7, 'all')))}$, numerically above it and within noise at $n{=}${K7.estate.questions}$`, CG);
  ok('k7:abstract.cag', `It ties the retrieval arms overall, within noise at $n{=}${K7.estate.questions}$ ($${P(f1(k7(C7, 'all')))}$ against $${P(f1(graphEm))}$ and $${P(f1(k7(B7, 'all')))}$)`, CG);
  ok('k7:abstract.hybrid', `answers $${P(k7(H7, 'all'))}$; that is an upper bound on the router`, CG);
  ok('k7:abstract.router', `the graph pays off as a retrieval index, not as a training format`, CG);
  ok('k7:conclusion.router', `and, in the routing upper bound, as a router ($${P(k7(H7, 'all'))}$ when each question's cache is prefilled from the asked person's own records, given a correctly resolved identity rather than doing retrieval, against $${P(f1(k7(B7, 'all')))}$ for the lexical control)`, CG);

  // Exact McNemar over the committed per-question rows, Holm-corrected per claim family
  const mcnemarP = (Aa, Bb) => {
    const m = new Map(Aa.rows.map(r => [r.qid, !!r.exact_match]));
    let b = 0, c = 0;
    for (const r of Bb.rows) { const a = m.get(r.qid); if (a && !r.exact_match) b++; if (!a && r.exact_match) c++; }
    const n = b + c;
    return n === 0 ? 1 : Math.min(1, Math.max(0, 2 * binomCdf(Math.min(b, c), n, 0.5)));
  };
  const holm = ps => {
    const m = ps.length;
    const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    let run = 0;
    const out = new Array(m);
    for (let r = 0; r < m; r++) { run = Math.max(run, (m - r) * idx[r][0]); out[idx[r][1]] = Math.min(1, run); }
    return out;
  };
  const KARMS = {
    flat: KH.arms.flat, per_block: KH.arms.per_block, composed: KH.arms.composed,
    composed_pairs: KH.arms.composed_pairs, per_block_vaulted: KH.arms.per_block_vaulted,
    retrieval: KH.arms.retrieval, base: KH.arms.base,
    bm25_retrieval: B7, cag: C7, cag_hybrid: H7,
  };
  const qidSet = KARMS.per_block.rows.map(r => r.qid).join(',');
  for (const [k, a] of Object.entries(KARMS)) {
    checks++;
    if (a.rows.length !== 60 || a.rows.map(r => r.qid).join(',') !== qidSet) { fails++; console.error(`FAIL [k7:mcn.rows.${k}] expected 60 rows with the shared qid set`); }
  }
  // F1: hybrid vs the other three non-training arms
  const f1p = [mcnemarP(H7, B7), mcnemarP(H7, KH.arms.retrieval), mcnemarP(H7, C7)];
  const f1Adj = holm(f1p);
  ok('k7:mcn.f1', `the hybrid routing arm separates from CAG (raw $p{=}${f4(f1p[2])}$, adjusted $${f4(f1Adj[2])}$), from Graph-PPR (raw $${f4(f1p[1])}$, adjusted $${f4(f1Adj[1])}$), and from BM25 (raw $${f4(f1p[0])}$, adjusted $${f4(f1Adj[0])}$)`, CG);
  // F2: trained formats against one another and the base
  const f2p = [mcnemarP(KH.arms.composed, KH.arms.per_block), mcnemarP(KH.arms.composed, KH.arms.flat), mcnemarP(KH.arms.per_block, KH.arms.flat), mcnemarP(KH.arms.composed, KH.arms.base), mcnemarP(KH.arms.per_block, KH.arms.base)];
  const f2Adj = holm(f2p);
  ok('k7:mcn.f2', `composed against per-block $p{=}${f2(f2p[0])}$, composed against flat $${f2(f2p[1])}$, per-block against flat $${f2(f2p[2])}$, composed against base $${f2(f2p[3])}$, per-block against base $${f2(f2p[4])}$, none surviving correction`, CG);
  checks++;
  if (Math.min(...f2Adj) < 0.05) { fails++; console.error(`FAIL [k7:mcn.f2.adj] a trained-format comparison survives correction (min adjusted ${Math.min(...f2Adj)})`); }
  // F3: retrieval and fixed-cache arms against one another
  const f3p = [mcnemarP(B7, KH.arms.retrieval), mcnemarP(C7, KH.arms.retrieval), mcnemarP(C7, B7)];
  const f3Adj = holm(f3p);
  ok('k7:mcn.f3', `BM25 against Graph-PPR $${f2(f3p[0])}$, CAG against Graph-PPR $${f2(f3p[1])}$, CAG against BM25 $${f2(f3p[2])}$)`, CG);
  checks++;
  if (Math.min(...f3Adj) < 0.05) { fails++; console.error(`FAIL [k7:mcn.f3.adj] a retrieval-vs-cache comparison survives correction (min adjusted ${Math.min(...f3Adj)})`); }
  // F4: the twenty retrieval-or-cache-versus-trained comparisons
  const f4p = [KH.arms.retrieval, B7, C7, H7].flatMap(a => TRAINED.map(t => mcnemarP(a, KH.arms[t])));
  const f4AdjMax = Math.max(...holm(f4p));
  checks++;
  if (!(f4AdjMax < 1e-4)) { fails++; console.error(`FAIL [k7:mcn.f4.adj] F4 max adjusted p ${f4AdjMax} is not below 1e-4`); }
  ok('k7:mcn.f4', 'every retrieval or cache arm separates from every trained arm (adjusted $p < 10^{-4}$)', CG);
}

/* ---------------- README & cross-paper reconciliation (T1 / #28) ---------------- */
const README = readFileSync(new URL('README.md', ROOT), 'utf8');
const PKG = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const BIB_E = tex('versieve-extraction-redaction-benchmark.bib');
const BIB_M = tex('versieve-multimodal-sanitization-benchmark.bib');
const BIB_L = tex('versieve-local-training-benchmark.bib');
const BIB_CG = tex('versieve-graph-grounded-enterprise-corpus.bib');
const ALL_BIBS = [BIB_E, BIB_M, BIB_L, BIB_CG].join('\n');

{
  // 1. Conformal gate table. Post novelty-framing rewrite the full table moved
  // into Paper D tab:gt-ltt; only the FPR<=alpha list and the a=0.10 yield
  // survive verbatim in the README.
  ok('paperD:gate.header', '\\textbf{E2E Leak}', M);
  const commaPlain = v => f0(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const readmeGateRows = [
    ['naive10', GT.detectorInformedHybridLtt.find(e => e.alpha === 0.10)],
    ['hc01', hcByA(0.01)],
    ['hc02', hcByA(0.02)],
    ['hc05', hcByA(0.05)],
    ['hc10', hcByA(0.10)],
    ['hc15', hcByA(0.15)],
    ['hc20', hcByA(0.20)],
    ['eltt05', eLtt05],
    ['eltt10', eLtt10],
  ];
  // fields still quoted verbatim in the README prose
  const README_GATE_FIELDS = new Set([
    'naive10.fpr', 'hc01.fpr', 'hc02.fpr', 'hc05.fpr', 'hc10.fpr',
    'hc15.fpr', 'hc20.fpr', 'eltt05.fpr', 'hc10.yield',
  ]);
  for (const [tag, row] of readmeGateRows) {
    for (const [field, v] of Object.entries({
      fpr: row.testConditionalFprPct,
      yield: row.testSafeYieldPct,
      autoRel: row.overallAutoReleasePct,
      e2eLeak: row.e2eResidualLeakOfReleasedPct,
    })) {
      if (README_GATE_FIELDS.has(`${tag}.${field}`)) {
        ok(`readme:gate.${tag}.${field}`, `${f2(v)}%`, README);
      } else {
        ok(`paperD:gate.${tag}.${field}`, P(f2(v)), M);
      }
    }
    ok(`paperD:gate.${tag}.e2eCount`, `($${comma(row.e2eResidualLeakCount)}$)`, M);
  }

  // 2. Reconciled 5 WASM kernels, 18 MCP tools, 174 Unicode cases, CI test count
  const wasmFiles = ['versieve_clean', 'versieve_media', 'versieve_graph', 'versieve_dl', 'versieve_sql'];
  let wasmTotal = 0;
  for (const mod of wasmFiles) {
    const sz = statSync(new URL(`vendor/wasm/${mod}.wasm`, ROOT)).size;
    wasmTotal += sz;
    ok(`readme:wasm.${mod}`, `${commaPlain(sz)} B`, README);
    ok(`paperA:wasm.${mod}`, `${comma(sz)}$\\,B`, E);
  }
  ok('readme:wasm.total', `${commaPlain(wasmTotal)} B`, README);
  ok('paperA:wasm.total', `$${comma(wasmTotal)}$\\,B`, E);
  ok('paperA:wasm.five', 'Five standalone WASM binaries', E);
  ok('paperA:wasm.allFive', 'All five WebAssembly modules', E);

  const mcpSrc = readFileSync(new URL('src/mcp-server.js', ROOT), 'utf8');
  const mcpCount = [...mcpSrc.matchAll(/name:\s*'([a-z0-9_]+)'/g)].length;
  checks++;
  if (mcpCount !== 18) { fails++; console.error(`FAIL [mcp:count] expected 18 MCP tools in src/mcp-server.js, got ${mcpCount}`); }
  ok('readme:mcp.count', `**MCP server, ${mcpCount} tools.**`, README);
  ok('paperA:mcp.count', `exposes $${mcpCount}$ JSON-RPC tools`, E);
  ok('paperD:mcp.count', `exposes $${mcpCount}$ tools`, M);

  const unicodeTotal = EU.zwsp.total + EU.homoglyph.total + EU.fullwidth.total;
  // the case count was cut from the README retelling; it lives in Paper D Exp.2
  ok('paperD:unicode.caseTotal', `$${unicodeTotal}$ cases`, M);
  ok('paperD:unicode.total', `$${unicodeTotal}$ cases`, M);

  const ciTestFiles = [...PKG.scripts['test:ci'].matchAll(/test\/[a-zA-Z0-9._-]+\.test\.js/g)].map(m => m[0]);
  const ciTestCount = ciTestFiles.reduce((n, tf) => {
    const src = readFileSync(new URL(tf, ROOT), 'utf8');
    return n + (src.match(/^\s*(?:await\s+)?(?:test|it)\s*\(/gm) || []).length;
  }, 0);
  ok('readme:tests.count', `${ciTestCount} portable CI tests across ${ciTestFiles.length} files`, README);
  ok('paperA:tests.count', `runs $${ciTestCount}$ tests across $${ciTestFiles.length}$ test files`, E);
  ok('paperD:tests.count', `Node.js CI $${ciTestCount}$ tests across $${ciTestFiles.length}$ files`, M);

  // 3. README required disclosures: policy mapping, PyTorch+DuckDB comparator, caveats
  ok('readme:policy.keep', '`KEEP` | `allow`', README);
  ok('readme:policy.abstain', '`ABSTAIN` | `redact` / review', README);
  ok('readme:policy.drop', '`DROP` | `deny`', README);
  ok('readme:stitch.comparator', '`PyTorch+DuckDB` (NOT Presidio)', README);
  ok('readme:caveat.canaries', 'scanner-detectable formats', README);
  ok('readme:caveat.qwen15b', 'remains below the untrained base (`0.202`)', README);

  // 4. No duplicate 2026a/2026b companion reference in Paper D bib
  checks++;
  if (BIB_M.includes('@misc{ardiyansyah2026extraction') && BIB_M.includes('@misc{ardiyansyah2026versieve')) {
    fails++;
    console.error('FAIL [paperD:bib-dup] duplicate ardiyansyah2026extraction and ardiyansyah2026versieve entries');
  }

  // 5. All 18 primary-source verified prior-art arXiv citations present in paper/*.bib
  const REQUIRED_ARXIV = [
    '2404.07965', '2406.10209', '2505.03052', '2512.03310', '2610.22988', '2603.17217',
    '2606.21631', '2607.24562', '2608.18260', '2609.21340', '2503.13050', '2602.04364',
    '2505.16831', '2210.09126', '2506.20037', '2410.12418', '2310.07298', '2302.00539',
  ];
  for (const id of REQUIRED_ARXIV) {
    ok(`bib:arxiv:${id}`, id, ALL_BIBS);
  }
}

/* ---------------- Word bans, em-dash bans & rejected tools (README + all papers) ---------------- */
const ALL_DOCS = [
  ['README', README],
  ['M', M], ['L', L], ['E', E], ['CG', CG],
  ['BIB_M', BIB_M], ['BIB_L', BIB_L], ['BIB_E', BIB_E], ['BIB_CG', BIB_CG],
];
for (const [name, body] of ALL_DOCS) {
  for (const [label, re] of [
    ['mathematically grounded', /mathematically\s+grounded/i],
    ['mathematically certified', /mathematically\s+certified/i],
    ['eliminates/eliminating', /\beliminat(?:e|es|ed|ing)\b/i],
    ['novelty "first"', /\b(?:first to|the first|for the first time|our first)\b/i],
    ['unverified no-prior claim', /\b(?:to our knowledge[,\s]+no prior|not aware of a prior corpus)\b/i],
    ['unqualified 100% WASM tagline', /100%\s+locally\s+in\s+WebAssembly/i],
    ['rejected unverified tool', /\b(?:Cloak|OSpipe|open-redactor|ALDS|mask-llm)\b/i],
    ['unicode em-dash', /\u2014/],
  ]) {
    checks++;
    if (re.test(body)) {
      fails++;
      console.error(`FAIL [${name}:ban] prohibited pattern: ${label}`);
    }
  }
  // Zero LaTeX --- em-dashes in .tex/.bib and zero prose --- in README (excluding Markdown horizontal rules & table dividers)
  checks++;
  if (name === 'README') {
    const proseTripleDash = body.split(/\r?\n/).some(line =>
      line.includes('---') && !/^\s*---\s*$/.test(line) && !/^\|[\s|:-]+\|$/.test(line.trim())
    );
    if (proseTripleDash) {
      fails++;
      console.error('FAIL [README:em-dash] prose triple-hyphen em-dash found');
    }
  } else if (body.includes('---')) {
    fails++;
    console.error(`FAIL [${name}:em-dash] LaTeX --- em-dash found`);
  }
}

/* ---------------- T7 (#34): Paper D guarantee baselines, tau=0.70 CI, licenses and seeds ---------------- */
{
  const T7B = TAB.t7GuaranteeBaselines;
  const T7T = TAB.t7Tau070SrmpBootstrap;
  const T7L = TAB.t7CorpusLicensesAndSeeds;
  // tau=0.70 SR-MP bootstrap interval fills the former placeholder
  const ci70 = T7T.srmpPerson.f1Bootstrap95CI;
  ok('t7:tau70.ci', `$${f2(T7T.srmpPerson.f1Pct)}$ \\scriptsize{[${f1(ci70[0])}, ${f1(ci70[1])}]}`, M);
  checks++;
  if (T7T.seed !== 42 || T7T.bootstrapResamples !== 1000 || T7T.permutationResamplesPreserved !== 5000) {
    fails++; console.error('FAIL [t7:tau70.params] expected seed 42, 1000 bootstrap, 5000 permutations');
  }
  checks++;
  if (!/\\scriptsize\{--\}/.test(M)) {} else { fails++; console.error('FAIL [t7:tau70.placeholder] -- placeholder still present'); }
  checks++;
  if (T7T.srmpPerson.f1Pct !== TAB.prCurves.srmpPerson[5].f1Pct) { fails++; console.error('FAIL [t7:tau70.f1] re-run point estimate differs from committed'); }
  checks++;
  if (T7T.srmpPerson.perDocTp.length !== 127 || T7T.srmpPerson.perDocFp.length !== 127 || T7T.srmpPerson.perDocFn.length !== 127) {
    fails++; console.error('FAIL [t7:tau70.perDoc] per-document TP/FP/FN arrays must have 127 entries');
  }
  ok('t7:perm.5000', '$5{,}000$ paired permutations', M);
  // baseline table rows: every certified row is printed, uncertified rows print no numbers
  for (const key of ['dunnSubsamplingSingleDraw', 'dunnRepeatedSubsamplingPooling', 'leeClusterWeightedSplit', 'leeClusterWeightedHighProbHb', 'hgCrcGroupConditional']) {
    for (const e of T7B[key]) {
      if (!e.certified) continue;
      const row = `$${f2(e.threshold)}$ & $${f2(e.testConditionalFprPct)}\\%$ & $${f2(e.overallAutoReleasePct)}\\%$ & $${f2(e.testSafeYieldPct)}\\%$ & $${f2(e.e2eResidualLeakOfReleasedPct)}\\%$ ($${e.e2eResidualLeakCount}$)`;
      ok(`t7:${key}.a${e.alpha}`, row, M);
    }
  }
  ok('t7:hier.label', '\\label{tab:hier-baselines}', M);
  for (const k of ['dunn2022hierarchical', 'lee2023hierarchical', 'salem2026hgcrc']) ok(`t7:cite.${k}`, k, M);
  ok('t7:hier.splits', `$M_0{=}${T7B.methodology.calibrationSplit.nUnsafeClusters}$`, M);
  const hgS = T7B.methodology.hgCrcHierarchy;
  ok('t7:hg.short', `$N_m \\le ${hgS.calibrationMedianParagraphs}$, $M{=}${hgS.calClusterCounts.short_ruling}$`, M);
  ok('t7:hg.long', `$N_m > ${hgS.calibrationMedianParagraphs}$, $M{=}${hgS.calClusterCounts.long_ruling}$`, M);
  // HG-CRC worst-subgroup held-out FPR quoted in prose
  for (const e of T7B.hgCrcGroupConditional) {
    if (e.certified) ok(`t7:hg.worstSg.a${e.alpha}`, `$${f2(e.worstSubgroupTestFprPct)}\\% \\le ${f0(e.alpha * 100)}\\%$`, M);
  }
  // seeds and licenses recorded in the artifact and referenced in the paper
  checks++;
  if (T7B.methodology.subsamplingSeed !== 42 || T7L.seedsByExperiment.exp1_tabEchrBootstrapAndPermutation.seed !== 42) {
    fails++; console.error('FAIL [t7:seeds] expected recorded seed 42');
  }
  checks++;
  if (Object.keys(T7L.corporaAndModels).length < 10) { fails++; console.error('FAIL [t7:licenses] too few recorded corpus licenses'); }
  ok('t7:license.paragraph', 'per-corpus licenses (MIT for TAB ECHR', M);
  ok('t7:draws', `$${T7B.methodology.repeatedSubsamplingDraws}$ repeated-subsampling draws`, M);
}

/* ---------------- T8 (#35): Paper A R5 external NER & TAB shootout ---------------- */
{
  const EXT = SC.race_2_external_ner_baselines;
  checks++;
  if (!EXT || EXT.recordsEvaluated !== 500 || EXT.structured26DenominatorSpans !== 580 || EXT.seed !== 42 || EXT.bootstraps !== 1000) {
    fails++;
    console.error('FAIL [t8:r5.meta] expected 500 records, 580 26-tag spans, seed 42, 1000 bootstraps');
  }
  const rxArm = EXT.arms.versieve_regex_matched_protocol;
  const prArm = EXT.arms.presidio_en_core_web_lg;
  const glArm = EXT.arms.gliner_pii_edge_v1_0_int8;
  checks++;
  if (rxArm.structured26.valueMatchSpans !== A4P.all_structured_spans) {
    fails++;
    console.error(`FAIL [t8:r5.valueMatchParity] ${rxArm.structured26.valueMatchSpans} !== ${A4P.all_structured_spans}`);
  }
  for (const [tag, arm] of [['rx', rxArm], ['presidio', prArm], ['gliner', glArm]]) {
    const s26 = arm.structured26;
    const bn = arm.bareNames;
    const a56 = arm.all56Tags;
    ok(`t8:${tag}.rec26`, P(f2(s26.recallPct)), E);
    ok(`t8:${tag}.rec26Spans`, s26.spans, E);
    ok(`t8:${tag}.rec26CI`, `[$${f2(s26.recallWilson95CI[0])}, ${f2(s26.recallWilson95CI[1])}$]`, E);
    ok(`t8:${tag}.prec`, P(f2(s26.precisionPct)), E);
    ok(`t8:${tag}.precCI`, `[$${f2(s26.precisionWilson95CI[0])}, ${f2(s26.precisionWilson95CI[1])}$]`, E);
    ok(`t8:${tag}.f1`, P(f2(s26.f1Pct)), E);
    ok(`t8:${tag}.bare`, P(f2(bn.recallPct)), E);
    ok(`t8:${tag}.bareSpans`, bn.spans, E);
    ok(`t8:${tag}.all56Rec`, P(f2(a56.recallPct)), E);
  }
  ok('t8:presidio.f1CI', `[$${f2(prArm.structured26.f1Bootstrap95CI[0])}\\%, ${f2(prArm.structured26.f1Bootstrap95CI[1])}\\%$]`, E);
  ok('t8:gliner.f1CI', `[$${f2(glArm.structured26.f1Bootstrap95CI[0])}\\%, ${f2(glArm.structured26.f1Bootstrap95CI[1])}\\%$]`, E);
  ok('t8:presidio.medMs', f2(prArm.latencyMs.median), E);
  ok('t8:gliner.medMs', f2(glArm.latencyMs.median), E);
  ok('t8:presidio.ver', prArm.packageVersions['presidio-analyzer'], E);
  ok('t8:spacy.ver', prArm.packageVersions.spacy, E);
  ok('t8:spacyModel.ver', prArm.packageVersions.en_core_web_lg, E);
  ok('t8:onnx.ver', glArm.packageVersions.onnxruntime, E);

  const T8_TAB = j('t8-gate-over-detector-and-stitched-shootout.json');
  checks++;
  if (
    T8_TAB.seed !== 42 ||
    T8_TAB.bootstraps !== 1000 ||
    T8_TAB.splits.calClusters !== 67 ||
    T8_TAB.splits.testClusters !== 127 ||
    T8_TAB.splits.testParagraphs !== 1999 ||
    !T8_TAB.environment.models.glinerEdge.onnxSha256 ||
    !Array.isArray(T8_TAB.stitchedBaselineShootout) ||
    T8_TAB.stitchedBaselineShootout.length < 2
  ) {
    fails++;
    console.error('FAIL [t8:tabShootout] t8-gate-over-detector-and-stitched-shootout.json missing required provenance or splits');
  }
}

/* ---------------- T10 (#37): Paper B DA1 retrieval_engine & Paper C R4 3-seed ablation ---------------- */
{
  // 1. Paper B DA1: End-to-End Engine-Resolution Router (results/track-k-retrieval-engine.json)
  const KRE = j('track-k-retrieval-engine.json');
  const RE_ARM = KRE.arm;
  const RE_EV = RE_ARM.eval;
  const RE_CI = RE_ARM.clopperPearson95CI;
  const RE_CMP = KRE.comparisons;
  ok(
    't10:paperB.row.engine',
    `Engine-resolved router & ${f1(RE_EV.Q1.exactMatchPct)} & ${f1(RE_EV.Q2.exactMatchPct)} & ${f1(RE_EV.Q3.exactMatchPct)} & ${f1(RE_EV.all.exactMatchPct)} & ${f2(RE_EV.all.judgeMean)} & ${f2(RE_EV.all.llamaJudgeMean)} & EM$+$J \\\\`,
    CG
  );
  ok('t10:paperB.abstract.em', `entity identifiers answers $${P(f1(RE_EV.all.exactMatchPct))}$ ($${P(f1(RE_EV.Q1.exactMatchPct))}$ Q1, $${P(f1(RE_EV.Q2.exactMatchPct))}$ Q2, $${P(f1(RE_EV.Q3.exactMatchPct))}$ Q3`, CG);
  ok('t10:paperB.prose.q3Count', `$${RE_ARM.q3Disambiguation.exactMatchCount}$ of $${RE_ARM.q3Disambiguation.n}$ disambiguation`, CG);
  ok('t10:paperB.prose.ctxToks', `$${comma(Math.floor(RE_ARM.tokenAccounting.contextTokensMean))}.${String(f1(RE_ARM.tokenAccounting.contextTokensMean)).split('.')[1]}$ mean context tokens`, CG);
  ok('t10:paperB.prose.promptToks', `$${comma(Math.floor(RE_ARM.tokenAccounting.promptTokensMean))}.${String(f1(RE_ARM.tokenAccounting.promptTokensMean)).split('.')[1]}$ mean prompt tokens`, CG);
  ok('t10:paperB.prose.agree', `row agreement $${P(f1(KRE.judgeAgreement.rowAgreementPct))}$`, CG);
  ok('t10:paperB.ci.all', `$${P(f1(RE_EV.all.exactMatchPct))}$ ($${f1(RE_CI.all[0])}$ to $${f1(RE_CI.all[1])}$ overall`, CG);
  ok('t10:paperB.mcn.hybrid', `raw McNemar $p{=}${f4(RE_CMP.cag_hybrid.mcnemar.pValue)}$`, CG);
  ok('t10:paperB.perm.hybrid', `paired permutation $p{=}${f4(RE_CMP.cag_hybrid.pairedPermutation.pValue)}$`, CG);
  ok('t10:paperB.holm.hybrid', `Holm-adjusted $p{=}${f4(RE_CMP.cag_hybrid.mcnemar.holmAdjustedNonTrainingFamily)}$`, CG);
  ok('t10:paperB.mcn.bm25', `BM25 (raw McNemar $p{=}${f4(RE_CMP.bm25_retrieval.mcnemar.pValue)}$`, CG);
  ok('t10:paperB.mcn.ppr', `Graph-PPR (raw $p{=}${f4(RE_CMP.retrieval.mcnemar.pValue)}$`, CG);
  ok('t10:paperB.mcn.cag', `fixed-cache CAG (raw $p{=}${f4(RE_CMP.cag.mcnemar.pValue)}$`, CG);

  // 2. Paper C R4: Multi-Seed PT-LM Mechanism Ablation (results/track-d-ptlm-multiseed-ablation.json)
  const R4M = j('track-d-ptlm-multiseed-ablation.json');
  checks++;
  if (!Array.isArray(R4M.seeds) || R4M.seeds.length < 3 || !R4M.seeds.includes(42)) {
    fails++;
    console.error('FAIL [t10:paperC.seeds] expected >=3 seeds including 42 in track-d-ptlm-multiseed-ablation.json');
  }
  const R4_ARM_LABELS = {
    safe: '\\texttt{Safe}',
    masking_only: '\\texttt{Masking-only}',
    surrogate_only: '\\texttt{Surrogate-only}',
    ptlm: '\\texttt{PT-LM}',
  };
  for (const [mk, mod] of Object.entries(R4M.models)) {
    for (const [ak, label] of Object.entries(R4_ARM_LABELS)) {
      const a = mod.arms[ak];
      ok(`t10:r4.${mk}.${ak}.rows`, `${label} ($${a.trainRows}$)`, L);
      ok(`t10:r4.${mk}.${ak}.echoSeen`, P(f2(a.seen_pii_tag_echo_pct.mean)), L);
      ok(`t10:r4.${mk}.${ak}.echoHeld`, P(f2(a.heldout_pii_tag_echo_pct.mean)), L);
      ok(`t10:r4.${mk}.${ak}.falseRef`, P(f2(a.in_scope_false_refusal_pct.mean)), L);
      ok(
        `t10:r4.${mk}.${ak}.falseRefCI`,
        `[${f2(a.in_scope_false_refusal_pct.bootstrapCi95[0])}, ${f2(a.in_scope_false_refusal_pct.bootstrapCi95[1])}]`,
        L
      );
      ok(`t10:r4.${mk}.${ak}.oos`, P(f2(a.oos_abstention_pct.mean)), L);
      ok(`t10:r4.${mk}.${ak}.seenF1`, f4(a.seen_in_f1.mean), L);
      ok(
        `t10:r4.${mk}.${ak}.seenF1CI`,
        `[${f4(a.seen_in_f1.bootstrapCi95[0])}, ${f4(a.seen_in_f1.bootstrapCi95[1])}]`,
        L
      );
      ok(`t10:r4.${mk}.${ak}.heldF1`, f4(a.heldout_in_f1.mean), L);
      ok(
        `t10:r4.${mk}.${ak}.heldF1CI`,
        `[${f4(a.heldout_in_f1.bootstrapCi95[0])}, ${f4(a.heldout_in_f1.bootstrapCi95[1])}]`,
        L
      );
      ok(`t10:r4.${mk}.${ak}.canary`, f2(a.canary_all_12_bits.mean), L);
      ok(
        `t10:r4.${mk}.${ak}.canaryCI`,
        `[${f2(a.canary_all_12_bits.bootstrapCi95[0])}, ${f2(a.canary_all_12_bits.bootstrapCi95[1])}]`,
        L
      );
      ok(`t10:r4.${mk}.${ak}.qwenJudge`, P(f1(a.judge_heldout_in_pct.mean)), L);
      ok(`t10:r4.${mk}.${ak}.llamaJudge`, P(f1(a.llama_judge_heldout_all_pct.mean)), L);
    }
  }
  ok('t10:r4.q05.maskVsPtlmP', f4(R4M.models.qwen05b.paired_permutation_tests_seed_mean_f1.seen_ptlm_vs_masking_only_f1_p), L);
  ok('t10:r4.q15.maskVsPtlmP', f4(R4M.models.qwen15b.paired_permutation_tests_seed_mean_f1.seen_ptlm_vs_masking_only_f1_p), L);
  ok('t10:r4.lfm3.ptlmVsSafeP', f4(R4M.models.lfm3.paired_permutation_tests_seed_mean_f1.seen_ptlm_vs_safe_f1_p), L);
}

/* ---------------- U2: README Wave 2-3 claims ---------------- */
{
  const T8 = j('t8-gate-over-detector-and-stitched-shootout.json');
  const EASE = j('ease-benchmark.json');
  const COMP = j('competitor-benchmarks.json');
  const CPA = j('t11-cpa-attacker-audit.json');
  const CAN = j('t11-scanner-missed-canaries.json');
  const QA = j('t11-scale-qa-training.json');
  const IB = j('exploratory-ib-ptlm.json');
  const cPlain = v => f0(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cComma2 = v => { const s = f2(v); const [i, d] = s.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : ''); };

  // 1. T8 gate-over-best-detector + stitched shootout. Counts/yields the README
  // retelling dropped are retargeted to Paper D tab:gate-over-detector.
  const t8arm = T8.gateOverDetectorArms.presidio_plus_stage3a;
  ok('u2:t8.alone', `${f2(t8arm.detectorAlone.e2eResidualLeakOfReleasedPct)}%`, README);
  ok('paperD:t8.aloneCount', `($${comma(t8arm.detectorAlone.e2eResidualLeakCount)}$ paragraphs)`, M);
  for (const [tag, a] of [['hc01', 0.01], ['hc05', 0.05]]) {
    const e = t8arm.hcCrcSweep.find(e => e.alpha === a);
    if (tag === 'hc05') ok('paperD:t8.hc05.yield', P(f2(e.testSafeYieldPct)), M);
    else ok(`u2:t8.${tag}.yield`, `${f2(e.testSafeYieldPct)}%`, README);
    ok(`u2:t8.${tag}.e2e`, `${f2(e.e2eResidualLeakOfReleasedPct)}%`, README);
    ok(`paperD:t8.${tag}.count`, `($${comma(e.e2eResidualLeakCount)}$)`, M);
  }
  const t8cmp = T8.stitchedBaselineShootout[0].matchedSafeYieldComparisons.find(e => e.alpha === 0.01);
  ok('u2:t8.stitchedLeak', `${f2(t8cmp.stitchedE2eLeakOfReleasedPct)}%`, README);
  ok('u2:t8.stitchedP', `p=${f4(t8cmp.pairedDocPermutationP)}`, README);

  // 2. T9 measured ease + forensic parity
  const eas = EASE.versieve, easSt = EASE.stitchedPythonStack;
  ok('u2:ease.wasm', `${cPlain(eas.installFootprint.wasmBytes)} B`, README);
  ok('u2:ease.js', `${cPlain(eas.installFootprint.jsSrcBytes)} B`, README);
  ok('u2:ease.totalMb', f2(eas.installFootprint.totalCoreBytes / 1048576), README);
  ok('u2:ease.stitchedMb', f2(easSt.installFootprint.totalBytes / 1048576), README);
  ok('u2:ease.footprintRatio', `${f1(easSt.installFootprint.totalBytes / eas.installFootprint.totalCoreBytes)}x`, README);
  ok('u2:ease.runtimes', '**`1` (Node.js)**', README);
  ok('u2:ease.stitchedRuntimes', '`4`', README);
  ok('u2:ease.loc', '**`3 LOC`**', README);
  ok('u2:ease.stitchedLoc', '`26 LOC`', README);
  ok('u2:ease.cold', f2(eas.coldStart.medianMs), README);
  ok('u2:ease.stitchedCold', cComma2(easSt.coldStart.medianMs), README);
  ok('u2:ease.speedup', `${f2(easSt.coldStart.medianMs / eas.coldStart.medianMs)}x`, README);
  ok('u2:unmasker', `${COMP.unmaskerSpecimens.detectedCount}/${COMP.unmaskerSpecimens.totalCategories}`, README);
  ok('u2:mat2', `${COMP.mat2MetadataParity.zeroResidualCount}/${COMP.mat2MetadataParity.totalFixtures}`, README);
  const sl = COMP.screenleak.localRuns.versieve_builtin_wasm;
  ok('u2:screenleak.text', `${f2(sl.text.specimenZeroLeakRatePct)}%`, README);
  ok('u2:screenleak.textCount', `(\`${sl.text.specimenZeroLeakCount}/${sl.text.piiBearingSpecimens}\``, README);
  ok('u2:screenleak.image', `${f2(sl.image.imageZeroLeakRatePct)}%`, README);
  ok('u2:screenleak.imageIou', '`IoU >= 0.30`', README);
  ok('u2:screenleak.imageCount', `(\`${sl.image.zeroLeakFrameCount}/${sl.image.totalFrames}\``, README);

  // 3. T11 CPA attacker audit + scanner-missed canaries (details cut from the
  // README retelling; ambiguity sets / Fisher / pair count live in Paper D Exp.7)
  ok('u2:cpa.released', `${f1(CPA.released.top1ReIdRatePct)}%`, README);
  ok('paperD:cpa.releasedCadv', `mean ambiguity-set size $${f2(CPA.released.meanAmbiguitySetSize)}$`, M);
  ok('u2:cpa.withheld', `${f1(CPA.withheld.top1ReIdRatePct)}%`, README);
  ok('u2:cpa.withheldCadv', `${f2(CPA.withheld.meanAmbiguitySetSize)}`, README);
  ok('paperD:cpa.fisher', `Fisher exact two-sided $p = ${f1(CPA.hypothesisTests.fisherExactTop1.pValueTwoSided * 1e5)}\\times 10^{-5}$`, M);
  ok('u2:cpa.mcnemar', `${f1(CPA.hypothesisTests.withinRulingPairedAudit.mcnemarTwoSidedPValue * 1e5)}e-5`, README);
  ok('paperD:cpa.pairCount', `within-ruling paired audit on $${CPA.hypothesisTests.withinRulingPairedAudit.nPairs}$ pairs`, M);
  ok('u2:cpa.ppDelta', `${f1(CPA.hypothesisTests.withheldMinusReleasedTop1Pp)} pp`, README);
  const canA = CAN.arms.stage3a_ptlm.exposure.scannerMissedFormats;
  const canB = CAN.arms.stage3a_3b_ptlm.exposure.scannerMissedFormats;
  ok('u2:canary.stage3a.pts', f2(canA.meanExposureBits), README);
  ok('u2:canary.stage3a.r1', canA.r1Fraction, README);
  ok('u2:canary.stage3a3b.pts', f2(canB.meanExposureBits), README);
  ok('u2:canary.stage3a3b.r1', canB.r1Fraction, README);
  ok('u2:canary.unredacted', f2(CAN.arms.unredacted.exposure.scannerMissedFormats.meanExposureBits), README);

  // 4. T11 scale document-QA + T12 IB-PT-LM. Per-seed spread, composed arm and
  // row accounting were cut from the README retelling; retargeted to Paper C S-scale.
  ok('u2:qa.docqa', `${f2(QA.honestSummary.documentQaExactMatchMeanPct)}%`, README);
  ok('paperC:qa.docqaRiB', `${f2(QA.arms.document_qa.byStratum.all.seedExactMatchValues[0])}\\%`, L);
  ok('paperC:qa.composed', `${f2(QA.honestSummary.composedUncappedExactMatchMeanPct)}\\%`, L);
  ok('u2:qa.delta', `${f2(QA.comparisons.documentQa_vs_composedUncapped.exactMatchPctGap.meanGap)} pp`, README);
  ok('u2:qa.deltaP', `p=${f4(QA.comparisons.documentQa_vs_composedUncapped.exactMatchPctGap.pairedPermutationPValue)}`, README);
  ok('u2:qa.bm25', `${f2(QA.honestSummary.bm25RetrievalExactMatchPct)}%`, README);
  ok('u2:qa.bm25Gap', f2(QA.comparisons.documentQa_vs_bm25Retrieval.exactMatchPctGap.meanGap), README);
  ok('u2:qa.bm25GapP', `p=${f3(QA.comparisons.documentQa_vs_bm25Retrieval.exactMatchPctGap.pairedPermutationPValue)}`, README);
  ok('paperC:qa.tokRows', `$${comma(QA.arms.document_qa.tokenAccounting.rows)}$ rows`, L);
  ok('paperC:qa.truncated', `truncated rows $= ${QA.arms.document_qa.tokenAccounting.truncatedRows}$ for every training arm`, L);
  const iPt = IB.arms.pt_lm.aggregate, iIb = IB.arms.ib_pt_lm.aggregate;
  ok('u2:ib.ptBits', f2(iPt.contextualSurrogateInversionMeanBits.mean), README);
  // rank-1/delta/wall/beta receipts moved into Paper C's IB paragraph
  ok('paperC:ib.ptR1', `${f2(iPt.contextualSurrogateInversionR1Count.mean)}/12`, L);
  ok('u2:ib.ibBits', f2(iIb.contextualSurrogateInversionMeanBits.mean), README);
  ok('u2:ib.ibR1', `${f1(iIb.contextualSurrogateInversionR1Count.mean)}/12`, README);
  ok('paperC:ib.bitsDelta', `a $${f2(IB.deltas.ibPtLm_vs_ptLm.contextualSurrogateInversionMeanBits.mean)}$-bit change`, L);
  ok('u2:ib.probePt', `${f2(iPt.linearProbeIdentityAccPct.mean)}%`, README);
  ok('paperC:ib.probeChance', `chance $${f2(IB.arms.pt_lm.chanceProbeAccPct)}\\%$`, L);
  ok('u2:ib.probeIb', `${f2(iIb.linearProbeIdentityAccPct.mean)}%`, README);
  ok('paperC:ib.probeDelta', `$${f2(IB.deltas.ibPtLm_vs_ptLm.linearProbeIdentityAccPct.mean)}$\\,pp`, L);
  ok('u2:ib.wallRatio', `${f2(iIb.trainWallSec.mean / iPt.trainWallSec.mean)}x`, README);
  ok('paperC:ib.wallRange', `rises from $${f2(iPt.trainWallSec.mean)}$\\,s to`, L);
  ok('paperC:ib.wallIb', `to $${f2(iIb.trainWallSec.mean)}$\\,s per seed`, L);
  ok('paperC:ib.beta', `$\\beta{=}${f1(IB.hyperparameters.betaKl)}$`, L);
}

/* ---------------- U3: Papers C/D Wave 2-3 sync ---------------- */
const T8U3 = j('t8-gate-over-detector-and-stitched-shootout.json');
const CPAU3 = j('t11-cpa-attacker-audit.json');
const ACU3 = j('exploratory-ac-crc.json');
const SMU3 = j('t11-scanner-missed-canaries.json');
const QAU3 = j('t11-scale-qa-training.json');
const IBMU3 = j('exploratory-ib-ptlm.json');

/* ---- Paper D, Exp. 6: t8-gate-over-detector-and-stitched-shootout.json ---- */
const U3t8g = T8U3.gateOverDetectorArms;
const U3leakCell = r => `$${f2(r.e2eResidualLeakOfReleasedPct)}\\%$ ($${comma(r.e2eResidualLeakCount)}$)`;
const U3ciCell = r => `\\scriptsize{[${f1(r.e2eResidualLeakOfReleasedBootstrap95CI[0])}, ${f1(r.e2eResidualLeakOfReleasedBootstrap95CI[1])}]}`;
const U3fprCell = r => `$${f2(r.testConditionalFprPct)}\\%$ & $${f2(r.testSafeYieldPct)}\\%$`;

ok('u3:t8.splits', `$${comma(T8U3.splits.calParagraphs)}$ calibration paragraphs, $${T8U3.splits.calUnsafe}$ unsafe, across $${T8U3.splits.calClusters}$ calibration rulings; $${comma(T8U3.splits.testParagraphs)}$ held-out`, M);
ok('u3:t8.protocol', `seed~$${T8U3.seed}$, $${comma(T8U3.bootstraps)}$ bootstrap resamples, $${comma(T8U3.permutations)}$ paired permutations, $\\delta{=}0.05$`, M);
ok('u3:t8.distinctConfig', 'distinct gate configuration and are not comparable cell-for-cell with Table~\\ref{tab:gt-ltt}', M);

const U3alone = U3t8g.presidio_fair_echr.detectorAlone;
ok('u3:t8.row.alone', `\\textbf{Presidio + ECHR code (no gate)} & ${U3fprCell(U3alone)} & ${U3leakCell(U3alone)} & ${U3ciCell(U3alone)}`, M);
ok('u3:t8.f1.alone', `$${f2(U3alone.e2eResidualLeakOfReleasedPct)}\\%$ ($${comma(U3alone.e2eResidualLeakCount)}$ paragraphs) end-to-end residual leak into release (Wilson $95\\%$ CI $[${f2(U3alone.e2eResidualLeakOfReleasedWilson95CI[0])}\\%, ${f2(U3alone.e2eResidualLeakOfReleasedWilson95CI[1])}\\%]$)`, M);

const U3sh = T8U3.stitchedBaselineShootout[0];
const U3st05 = U3sh.stitchedUncalibratedTau050;
ok('u3:t8.row.stitchedTau', `Stitched stack, plain $\\tau{=}0.50$ & ${U3fprCell(U3st05)} & ${U3leakCell(U3st05)} & ${U3ciCell(U3st05)}`, M);
// plateau: identical operating point across every stitched grid threshold from 0.16 through 0.99
const U3plateau = U3t8g.stitched_presidio_detect_secrets_forensic.plainConfidenceThresholdCurve.filter(r => r.threshold >= 0.16);
const U3pl = U3plateau[0];
checks++;
if (f2(U3pl.threshold) !== '0.16' || f2(U3plateau[U3plateau.length - 1].threshold) !== '0.99' || U3plateau.length < 2) {
  fails++;
  console.error(`FAIL [u3:t8.plateau.range] expected grid thresholds 0.16 through 0.99, got ${U3pl.threshold}..${U3plateau[U3plateau.length - 1].threshold}`);
}
for (const r of U3plateau) {
  checks++;
  if (f2(r.testConditionalFprPct) !== f2(U3pl.testConditionalFprPct) || f2(r.testSafeYieldPct) !== f2(U3pl.testSafeYieldPct) ||
      f2(r.e2eResidualLeakOfReleasedPct) !== f2(U3pl.e2eResidualLeakOfReleasedPct) || r.e2eResidualLeakCount !== U3pl.e2eResidualLeakCount ||
      f2(r.e2eResidualLeakOfReleasedBootstrap95CI[0]) !== f2(U3pl.e2eResidualLeakOfReleasedBootstrap95CI[0]) ||
      f2(r.e2eResidualLeakOfReleasedBootstrap95CI[1]) !== f2(U3pl.e2eResidualLeakOfReleasedBootstrap95CI[1])) {
    fails++;
    console.error(`FAIL [u3:t8.plateau.equality] threshold ${r.threshold} diverges from ${U3pl.threshold}`);
  }
}
ok('u3:t8.plateau.row', `Stitched stack, plain $\\tau \\in [${f2(U3pl.threshold)}, ${f2(U3plateau[U3plateau.length - 1].threshold)}]$ & ${U3fprCell(U3pl)} & ${U3leakCell(U3pl)} & ${U3ciCell(U3pl)}`, M);
ok('u3:t8.plateau.prose', `every stitched plain-confidence threshold from $${f2(U3pl.threshold)}$ through $${f2(U3plateau[U3plateau.length - 1].threshold)}$ produces the identical operating point, so threshold tuning cannot improve the stitched release`, M);

const U3hc = a => U3t8g.presidio_plus_stage3a.hcCrcSweep.find(s => s.alpha === a);
const U3hc01 = U3hc(0.01), U3hc02 = U3hc(0.02), U3hc05 = U3hc(0.05);
checks++;
if (!U3hc01 || !U3hc02 || !U3hc05 || U3hc01.e2eResidualLeakCount !== 0) { fails++; console.error('FAIL [u3:t8.hc.sweep] expected alpha rows with zero leaks at alpha=0.01'); }
ok('u3:t8.row.hc01', `\\textbf{HC-CRC over Stage 3A + Presidio, $\\alpha{=}0.01$} & ${U3fprCell(U3hc01)} & $\\mathbf{${f2(U3hc01.e2eResidualLeakOfReleasedPct)}\\%}$ ($${U3hc01.e2eResidualLeakCount}$) & ${U3ciCell(U3hc01)}`, M);
ok('u3:t8.row.hc02', `HC-CRC over Stage 3A + Presidio, $\\alpha{=}0.02$ & ${U3fprCell(U3hc02)} & ${U3leakCell(U3hc02)} & ${U3ciCell(U3hc02)}`, M);
ok('u3:t8.row.hc05', `HC-CRC over Stage 3A + Presidio, $\\alpha{=}0.05$ & ${U3fprCell(U3hc05)} & ${U3leakCell(U3hc05)} & ${U3ciCell(U3hc05)}`, M);
ok('u3:t8.f2.zero', `releases $${U3hc01.e2eResidualLeakCount}$ unsafe paragraphs ($${f2(U3hc01.e2eResidualLeakOfReleasedPct)}\\%$ end-to-end leak, [0, 0] CI) at $${f2(U3hc01.testSafeYieldPct)}\\%$ Safe Yield`, M);
ok('u3:t8.f2.five', `certified at $\\alpha{=}0.05$ releases $${f2(U3hc05.e2eResidualLeakOfReleasedPct)}\\%$ ($${U3hc05.e2eResidualLeakCount}$) at $${f2(U3hc05.testSafeYieldPct)}\\%$ Safe Yield`, M);
const U3cmp01 = U3sh.matchedSafeYieldComparisons.find(c => c.alpha === 0.01);
checks++;
if (!U3cmp01 || U3cmp01.pairedDocPermutationP !== 0.0002 || U3cmp01.stitchedE2eLeakOfReleasedPct !== 9.06 || U3cmp01.versieveE2eLeakCount !== 0) { fails++; console.error('FAIL [u3:t8.shootout.artifact] alpha=0.01 matched-yield comparison mismatch'); }
ok('u3:t8.plateau.p', `paired per-document permutation, $p{=}${U3cmp01.pairedDocPermutationP}$`, M);

const U3glAlone = U3t8g.gliner_edge_dev_filtered.detectorAlone;
ok('u3:t8.row.glinerAlone', `\\textbf{GLiNER-Edge (no gate)} & ${U3fprCell(U3glAlone)} & ${U3leakCell(U3glAlone)} & ${U3ciCell(U3glAlone)}`, M);
const U3gl05 = U3t8g.gliner_edge_dev_filtered.hcCrcSweep.find(s => s.alpha === 0.05);
const U3glp05 = U3t8g.gliner_plus_stage3a.hcCrcSweep.find(s => s.alpha === 0.05);
ok('u3:t8.row.glinerGate', `GLiNER-Edge + HC-CRC, $\\alpha{=}0.05$ & ${U3fprCell(U3gl05)} & ${U3leakCell(U3gl05)} & ${U3ciCell(U3gl05)}`, M);
ok('u3:t8.row.glinerStage3a', `Stage 3A + GLiNER + HC-CRC, $\\alpha{=}0.05$ & ${U3fprCell(U3glp05)} & ${U3leakCell(U3glp05)} & ${U3ciCell(U3glp05)}`, M);
ok('u3:t8.boundary', `still releases $${f2(U3gl05.e2eResidualLeakOfReleasedPct)}\\%$ ($${U3gl05.e2eResidualLeakCount}$; with Stage 3A coupling $${f2(U3glp05.e2eResidualLeakOfReleasedPct)}\\%$) at roughly $40\\%$ Safe Yield`, M);
ok('u3:t8.glinerSize', `$${f1(T8U3.environment.models.glinerEdge.onnxBytes / 1e6)}$\\,MB GLiNER-Edge detector`, M);

/* ---- Paper D, Exp. 7: t11-cpa-attacker-audit.json + exploratory-ac-crc.json ---- */
ok('u3:cpa.protocol', `$k{=}${CPAU3.protocol.candidateSetSizeK}$-candidate ambiguity sets (chance rate $${f2(CPAU3.protocol.chanceTop1Pct)}\\%$)`, M);
ok('u3:cpa.split', `$100$ released and $100$ withheld test paragraphs of the $\\alpha{=}0.05$ split ($${comma(CPAU3.dataset.fullTestReleasedAlpha005)}$ released, $${comma(CPAU3.dataset.fullTestWithheldAlpha005)}$ withheld)`, M);
const U3t05 = CPAU3.hcCrcGate.thresholds['0.05'];
ok('u3:cpa.threshold', `$\\tau_{\\text{keep}}{=}${f2(U3t05.tauKeep)}$, $\\tau_{\\text{drop}}{=}${f2(U3t05.tauDrop)}$, $${U3t05.nUnsafeClusters}$ unsafe clusters`, M);
ok('u3:cpa.calibration', `calibrated at seed $${CPAU3.seed}$ with resamples and $${comma(CPAU3.permutationCount)}$ permutations`, M);
ok('u3:cpa.attacker', `\\texttt{qwen2.5:7b}, $7.6$B Q4\\_K\\_M`, M);

const U3rel = CPAU3.released, U3wth = CPAU3.withheld;
ok('u3:cpa.released.item', `$${U3rel.top1ReIdCount}/${U3rel.n} = \\mathbf{${f2(U3rel.top1ReIdRatePct)}\\%}$ top-1 re-identification (Clopper--Pearson $95\\%$ CI $[${f2(U3rel.top1ClopperPearson95CI[0])}\\%, ${f2(U3rel.top1ClopperPearson95CI[1])}\\%]$), mean ambiguity-set size $${f2(U3rel.meanAmbiguitySetSize)}$, residual detector leak $${U3rel.residualDetectorLeakPct}\\%$, zero singleton singling-out, empirical ambiguity coverage $${U3rel.empiricalCoveragePct}\\%$`, M);
ok('u3:cpa.withheld.item', `$${U3wth.top1ReIdCount}/${U3wth.n} = \\mathbf{${f2(U3wth.top1ReIdRatePct)}\\%}$ top-1 re-identification (Clopper--Pearson $95\\%$ CI $[${f2(U3wth.top1ClopperPearson95CI[0])}\\%, ${f2(U3wth.top1ClopperPearson95CI[1])}\\%]$), mean ambiguity-set size $${f2(U3wth.meanAmbiguitySetSize)}$, residual detector leak $${U3wth.residualDetectorLeakPct}\\%$, zero singleton singling-out, coverage $${U3wth.empiricalCoveragePct}\\%$`, M);
const U3hyp = CPAU3.hypothesisTests;
checks++;
if (U3hyp.withheldMinusReleasedTop1Pp !== 28 || U3hyp.fisherExactTop1.pValueTwoSided !== 0.000016) { fails++; console.error('FAIL [u3:cpa.hyp.artifact] gap/fisher mismatch'); }
ok('u3:cpa.gap', `$${f2(U3hyp.withheldMinusReleasedTop1Pp)}$\\,pp (bootstrap $95\\%$ CI $[${U3hyp.withheldMinusReleasedTop1Bootstrap95CI[0]}, ${U3hyp.withheldMinusReleasedTop1Bootstrap95CI[1]}]$); Fisher exact two-sided $p = ${f1(U3hyp.fisherExactTop1.pValueTwoSided * 1e5)}\\times 10^{-5}$; within-ruling paired audit on $100$ pairs: $${U3hyp.withinRulingPairedAudit.releasedOnlyReId}$ released-only versus $${U3hyp.withinRulingPairedAudit.withheldOnlyReId}$ withheld-only re-identifications, McNemar $p = ${f1(U3hyp.withinRulingPairedAudit.mcnemarTwoSidedPValue * 1e5)}\\times 10^{-5}$; ambiguity-set mean difference $+${f2(U3hyp.withinRulingPairedAudit.ambiguitySetMeanDiff)}$ (paired permutation $p{=}${U3hyp.withinRulingPairedAudit.pairedAmbiguityPermutationPValue}$)`, M);
ok('u3:cpa.floor', `The released residual sits $${f2(U3rel.top1ReIdRatePct - CPAU3.protocol.chanceTop1Pct)}$\\,pp above the $${CPAU3.protocol.chanceTop1Pct}\\%$ chance floor`, M);

const U3acBase = ACU3.baselines.hcCrcSingleChannel.metrics, U3acW = ACU3.weightSweep.w_05_05.metrics, U3acD = ACU3.deltasVsBaselines.w_05_05_vs_hc_crc;
ok('u3:ac.reid', `held-out released top-1 re-identification moves from $${f2(U3acBase.releasedTop1ReIdRatePct.mean)}\\%$ (single-channel HC-CRC) to $${f2(U3acW.releasedTop1ReIdRatePct.mean)}\\%$ ($${f2(ACU3.honestAssessment.balancedWeightDeltaTop1ReIdPctVsHcCrc)}$\\,pp; per-seed $${f2(U3acD.releasedTop1ReIdRatePct.perSeed[0])}$, $${f2(U3acD.releasedTop1ReIdRatePct.perSeed[1])}$, $${f2(U3acD.releasedTop1ReIdRatePct.perSeed[2])}$)`, M);
ok('u3:ac.leak', `the end-to-end detector leak moves from $${f2(U3acBase.e2eDetectorLeakRatePct.mean)}\\%$ to $${f2(U3acW.e2eDetectorLeakRatePct.mean)}\\%$ ($+${f2(ACU3.honestAssessment.balancedWeightDeltaDetectorLeakPctVsHcCrc)}$\\,pp) and Safe Yield is unchanged ($${f2(ACU3.honestAssessment.balancedWeightDeltaSafeYieldPctVsHcCrc)}$\\,pp)`, M);
const U3mc = ACU3.typeIErrorControlUnderH0.dependentChannelMonteCarlo;
checks++;
if (!U3mc.allRegimesPass || U3mc.nTrials !== 10000 || U3mc.horizon !== 80 || U3mc.byCorrelation.length !== 5 || U3mc.delta !== 0.05) { fails++; console.error('FAIL [u3:ac.mc.artifact] Monte Carlo control mismatch'); }
ok('u3:ac.mc', `($${comma(U3mc.nTrials)}$ trials across five copula correlations, horizon $${U3mc.horizon}$) holds $\\mathbb{E}[E^{\\text{joint}}] \\le 1$ with anytime exceedance`, M);
ok('u3:ac.exploratory', "the checked-in artifact carries the run's status as exploratory", M);
checks++;
if (ACU3.status !== 'exploratory') { fails++; console.error('FAIL [u3:ac.status] artifact status is not exploratory'); }

/* ---- Paper C, scanner-missed canaries + scale QA: t11*.json ---- */
const U3cs = SMU3.canarySuite;
ok('u3:sm.suite', `$${U3cs.totalCanaries}$-canary suite splits equally into $${U3cs.scannerCaughtCount}$ scanner-caught canaries`, L);
ok('u3:sm.turns', `$${U3cs.repetitions[0]}\\times$, $${U3cs.repetitions[1]}\\times$, and $${U3cs.repetitions[2]}\\times$ repetitions over $${U3cs.totalRepeatedTurns}$ repeated turns on $${U3cs.estateBackgroundDocs}$ background estate documents`, L);
const U3rec = SMU3.recipe;
ok('u3:sm.recipe', `LoRA $r{=}${U3rec.lora.r}$, $\\alpha{=}${U3rec.lora.alpha}$, $${U3rec.steps}$ steps, lr $2\\mathrm{e}{-4}$, seed $${SMU3.seed}$`, L);
const U3armBits = (id, stratum) => { const s = SMU3.arms[id].exposure[stratum]; return { b: f2(s.meanExposureBits), r1: s.r1Fraction }; };
ok('u3:sm.decoys', `$N{=}1{,}000$ decoys and rank-1 memorized counts per stratum` , L);
checks++;
if (SMU3.candidateDecoysPerCanary !== 1000 || SMU3.resampleCount !== 1000) { fails++; console.error('FAIL [u3:sm.decoys.artifact] decoy/resample counts mismatch'); }
const U3row = (id, label, bold) => {
  const c = U3armBits(id, 'scannerCaughtFormats'), m = U3armBits(id, 'scannerMissedFormats');
  const mk = bold ? v => `\\mathbf{${v}}` : v => v;
  return `${label} & $${mk(c.b)}$ ($${c.r1}$) & $${mk(m.b)}$ ($${m.r1}$)`;
};
ok('u3:sm.row.base', U3row('base', 'Base (untrained)', false), L);
ok('u3:sm.row.raw', U3row('unredacted', 'Raw unredacted chat', false), L);
ok('u3:sm.row.stage3a', U3row('stage3a_ptlm', 'Stage 3A + PT-LM', false), L);
ok('u3:sm.row.stage3a3b', U3row('stage3a_3b_ptlm', '\\textbf{Stage 3A + 3B + PT-LM}', true), L);
checks++;
const U3smHi = SMU3.honestSummary;
if (f2(U3smHi.stage3aRegexMissedFormatBits) !== f2(9.75) || U3smHi.stage3aRegexMissedFormatR1 !== '11/12' || f2(U3smHi.stage3a3bMissedFormatBits) !== f2(6.27)) { fails++; console.error('FAIL [u3:sm.honest] honestSummary mismatch'); }
const U3audit = SMU3.redactionAudit.stage3a_3b_srmp_gliner.scannerMissedFormats;
ok('u3:sm.audit', `$${U3audit.fullMaskedCount}$ fully masked, $${U3audit.partialMaskedCount}$ partial, and $${U3audit.unmaskedCount}$ unmasked`, L);
const U3auditCaught = SMU3.redactionAudit.stage3a_regex.scannerCaughtFormats;
ok('u3:sm.caught', `Stage 3A redaction fully masks $${U3auditCaught.fullMaskedCount}/${U3auditCaught.total}$ caught canaries`, L);
ok('u3:sm.maxbits', `(bits, max $${f2(Math.log2(SMU3.candidateDecoysPerCanary))}$)`, L);

const U3cap = QAU3.capRemovedNote;
const U3capNums = U3cap.match(/composed \(([\d,]+) rows -> (\d+) rows\) and flat \(([\d,]+) rows -> (\d+) rows\) to match per_block_vaulted's ([\d,]+)-token budget/);
checks++;
if (!U3capNums) { fails++; console.error('FAIL [u3:qa.cap] capRemovedNote shape changed'); }
ok('u3:qa.caprows', `$${comma(Number(U3capNums[1].replace(/,/g, '')))}$ to $${U3capNums[2]}$ rows and the flat corpus from $${comma(Number(U3capNums[3].replace(/,/g, '')))}$ to $${U3capNums[4]}$ rows`, L);
ok('u3:qa.capbudget', `$${comma(Number(U3capNums[5].replace(/,/g, '')))}$-token budget`, L);
const U3qs = QAU3.questionSuite.strataCounts;
ok('u3:qa.strata', `$${U3qs.K3_canonical}$ canonical K3, $${U3qs.Q1_ext}$ Q1, $${U3qs.Q2_ext}$ Q2, $${U3qs.Q3_ext}$ Q3, $${U3qs.Q4_directory}$ directory) over three seeds ($${QAU3.seeds[0]}$, $${QAU3.seeds[1]}$, $${QAU3.seeds[2]}$)`, L);
const U3tok = QAU3.arms.document_qa.tokenAccounting;
ok('u3:qa.tokens', `$${comma(U3tok.rows)}$ rows ($${comma(U3tok.totalTokens)}$ tokens, $${comma(U3tok.learnableTokens)}$ learnable)`, L);
const U3dq = QAU3.arms.document_qa.byStratum.all, U3cw = QAU3.arms.composed_uncapped.byStratum.all, U3fl = QAU3.arms.flat_uncapped.byStratum.all, U3bm = QAU3.arms.bm25_retrieval.eval.all;
checks++;
if (QAU3.arms.document_qa.tokenAccounting.truncatedRows !== 0) { fails++; console.error('FAIL [u3:qa.truncated] expected truncatedRows = 0'); }
ok('u3:qa.docqa', `\\texttt{document\\_qa} reaches $\\mathbf{${f2(U3dq.exactMatchMeanPct)}\\%}$ exact match $[${f2(U3dq.exactMatchBootstrap95CI[0])}, ${f2(U3dq.exactMatchBootstrap95CI[1])}]$ ($${f2(U3dq.seedExactMatchValues[0])}\\%$/$${f2(U3dq.seedExactMatchValues[1])}\\%$/$${f2(U3dq.seedExactMatchValues[2])}\\%$ per seed) against composed \\texttt{uncapped} at $${f2(U3cw.exactMatchMeanPct)}\\%$ $[${f2(U3cw.exactMatchBootstrap95CI[0])}, ${f2(U3cw.exactMatchBootstrap95CI[1])}]$`, L);
const U3cmpDc = QAU3.comparisons.documentQa_vs_composedUncapped;
ok('u3:qa.gap', `a $+${f2(U3cmpDc.exactMatchPctGap.meanGap)}$\\,pp gap $[${f2(U3cmpDc.exactMatchPctGap.bootstrap95CI[0])}, ${f2(U3cmpDc.exactMatchPctGap.bootstrap95CI[1])}]$ with paired permutation $p{=}0.0005$; flat \\texttt{uncapped} sits between at $${f2(U3fl.exactMatchMeanPct)}\\%$`, L);
ok('u3:qa.bm25', `Lexical BM25 retrieval answers $${f2(U3bm.exactMatchPct)}\\%$ $[${f2(U3bm.exactMatchBootstrap95CI[0])}, ${f2(U3bm.exactMatchBootstrap95CI[1])}]$`, L);
const U3cmpCb = QAU3.comparisons.composedUncapped_vs_bm25Retrieval, U3cmpDb = QAU3.comparisons.documentQa_vs_bm25Retrieval;
ok('u3:qa.gapToBm25', `narrows its exact-match gap to BM25 from $${f2(U3cmpCb.exactMatchPctGap.meanGap)}$\\,pp (composed versus BM25, $p{=}0.0005$) to $${f2(U3cmpDb.exactMatchPctGap.meanGap)}$\\,pp $[${f2(U3cmpDb.exactMatchPctGap.bootstrap95CI[0])}, ${f2(U3cmpDb.exactMatchPctGap.bootstrap95CI[1])}]$, which does not separate at this $n$ ($p{=}${f3(U3cmpDb.exactMatchPctGap.pairedPermutationPValue)}$)`, L);
const U3cmpF1 = U3cmpDc.tokenF1PctGap;
ok('u3:qa.f1', `mean token F1 is $${f2(QAU3.arms.document_qa.byStratum.all.tokenF1MeanPct)}$ against composed $${f2(U3cw.tokenF1MeanPct)}$ ($${f2(U3cmpF1.meanGap)}$\\,pp, $p{=}0.0005$)`, L);

/* ---- Paper C, IB-PT-LM: exploratory-ib-ptlm.json ---- */
checks++;
if (IBMU3.status !== 'exploratory' || IBMU3.hyperparameters.betaKl !== 0.2 || IBMU3.hyperparameters.effectiveBatchSize !== 8 || IBMU3.provenance.nTrainExamples !== 152 || IBMU3.provenance.nCanaries !== 12 || IBMU3.provenance.surrogatePoolAudit.poolOverlapCount !== 0 || String(IBMU3.seeds) !== '42,43,44') { fails++; console.error('FAIL [u3:ib.artifact] IB-PT-LM artifact header mismatch'); }
ok('u3:ib.header', `three seeds ($42$, $43$, $44$; $80$ steps, lr $2\\mathrm{e}{-4}$, effective batch $${IBMU3.hyperparameters.effectiveBatchSize}$, $${IBMU3.provenance.nTrainExamples}$ training examples, $${IBMU3.provenance.nCanaries}$ canaries)`, L);
ok('u3:ib.beta', `never re-introduces pressure to emit tags), $\\beta{=}${f1(IBMU3.hyperparameters.betaKl)}$`, L);
ok('u3:ib.pool', `Pool disjointness is audited and checked in ($${IBMU3.provenance.surrogatePoolAudit.poolOverlapCount}$ shared strings per surrogate category)`, L);
const U3pt = IBMU3.arms.pt_lm.aggregate, U3mo = IBMU3.arms.masking_only.aggregate, U3ib = IBMU3.arms.ib_pt_lm.aggregate, U3dIB = IBMU3.deltas.ibPtLm_vs_ptLm;
ok('u3:ib.pt.bits', `contextual surrogate-inversion exposure at $${f2(U3pt.contextualSurrogateInversionMeanBits.mean)}$ bits $[${f2(U3pt.contextualSurrogateInversionMeanBits.bootstrapCi95[0])}, ${f2(U3pt.contextualSurrogateInversionMeanBits.bootstrapCi95[1])}]$ under static \\texttt{PT-LM} ($${f2(U3pt.contextualSurrogateInversionR1Count.mean)}/12$ rank-1)`, L);
checks++;
for (const s of U3ib.contextualSurrogateInversionR1Count.perSeed) { if (s !== 0) { fails++; console.error('FAIL [u3:ib.r1] IB-PT-LM rank-1 nonzero in a seed'); } }
ok('u3:ib.bits', `brings it to $\\mathbf{${f2(U3ib.contextualSurrogateInversionMeanBits.mean)}}$ bits $[${f2(U3ib.contextualSurrogateInversionMeanBits.bootstrapCi95[0])}, ${f2(U3ib.contextualSurrogateInversionMeanBits.bootstrapCi95[1])}]$ ($0/12$ rank-1 in every seed), a $${f2(U3dIB.contextualSurrogateInversionMeanBits.mean)}$-bit change`, L);
ok('u3:ib.probe.pt', `an $8$-way linear probe on neighboring non-PII hidden-state identity (chance $${f2(12.5)}\\%$) reads $${f2(U3pt.linearProbeIdentityAccPct.mean)}\\%$ $[${f2(U3pt.linearProbeIdentityAccPct.bootstrapCi95[0])}, ${f2(U3pt.linearProbeIdentityAccPct.bootstrapCi95[1])}]$ under \\texttt{PT-LM} and $${f2(U3mo.linearProbeIdentityAccPct.mean)}\\%$ under \\texttt{Masking-only}`, L);
ok('u3:ib.probe.ib', `lowers it to $\\mathbf{${f2(U3ib.linearProbeIdentityAccPct.mean)}\\%}$ $[${f2(U3ib.linearProbeIdentityAccPct.bootstrapCi95[0])}, ${f2(U3ib.linearProbeIdentityAccPct.bootstrapCi95[1])}]$, $${f2(U3dIB.linearProbeIdentityAccPct.mean)}$\\,pp versus \\texttt{PT-LM}`, L);
const U3ratio = U3ib.trainWallSec.mean / U3pt.trainWallSec.mean;
ok('u3:ib.wall', `mean training wall-clock rises from $${f2(U3pt.trainWallSec.mean)}$\\,s to $${f2(U3ib.trainWallSec.mean)}$\\,s per seed ($\\approx ${Math.round(U3ratio * 100) / 100}\\times$)`, L);
ok('u3:ib.sideRaw', `Raw canary exposure changes by $${f2(U3dIB.rawCanaryMeanBits.mean)}$ bits with the bootstrap CI $[${f2(U3dIB.rawCanaryMeanBits.bootstrapCi95[0])}, ${f2(U3dIB.rawCanaryMeanBits.bootstrapCi95[1])}]$ including zero`, L);
ok('u3:ib.sideF1', `seen-document token F1 by $+${f2(U3dIB.seenDocTokenF1Pct.mean)}$\\,pp, and tag echo by $+${f2(U3dIB.tagEchoRatePct.mean)}$\\,pp versus \\texttt{Masking-only}`, L);
ok('u3:ib.exploratory', "The checked-in artifact carries this arm's status as exploratory.", L);

/* ---- U3 style guards ---- */
checks++;
for (const [nm, txt] of [['M', M], ['L', L]]) {
  if (txt.includes(String.fromCharCode(0x2014))) { fails++; console.error(`FAIL [u3:noEmDash.${nm}] Unicode em dash found in paper tex`); }
  if (/---/.test(txt)) { fails++; console.error(`FAIL [u3:noTripleDash.${nm}] '---' found in paper tex`); }
}

console.log(`\n${checks} paper-number checks, ${fails} failure${fails === 1 ? '' : 's'}`);
process.exit(fails ? 1 : 0);
