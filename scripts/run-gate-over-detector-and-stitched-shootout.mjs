#!/usr/bin/env node
/**
 * scripts/run-gate-over-detector-and-stitched-shootout.mjs
 *
 * Node.js evaluation & T2 adapter integration engine for T8 (#35 / #27 User Stories 8-9):
 *   1. Wraps external detectors (Presidio, GLiNER-Edge, Hybrid) via Versieve's T2 pluggable
 *      Stage 3B detector adapter contract (`createDetectorAdapter`, `perceive`) to verify
 *      zero-egress local adapter execution, provenance tagging, and conformal risk stats.
 *   2. Trains the 520-dim detector-informed logistic gatekeeper (`trainGatekeeper`) and
 *      calibrates document-clustered `HC-CRC` (`calibrateClusterRobustGatekeeper`) and
 *      streaming `E-LTT` (`calibrateStreamingEProcessGatekeeper`) over TAB splits
 *      (60 train / 67 cal / 127 held-out rulings).
 *   3. Evaluates Gate-Over-Best-Detector (HC-CRC / E-LTT wrapping Presidio / GLiNER vs.
 *      detector alone and plain confidence thresholds) at fixed/matched Safe Yield, with
 *      exact Wilson 95% CIs, document-cluster bootstrap 95% CIs (seed 42, 1,000 resamples),
 *      and paired document-level permutation tests (seed 42, 5,000 resamples).
 *   4. Evaluates the Stitched-Baseline Shootout (Presidio + detect-secrets + forensic check
 *      + plain confidence threshold vs. Versieve HC-CRC / E-LTT) on identical held-out TAB.
 *
 * Modes:
 *   --mode scan-stage3a --in <json> --out <json>
 *   --mode evaluate-tab-gates --in <json> --out <json>
 *   --fixture-input <json> --out <json>   (CPU-safe synthetic CI contract mode)
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTokenizer, extractFeatureRow } from '../src/clean-and-tokenize.js';
import { scanEnterprisePiiAndSecrets } from '../src/secret-scanner.js';
import {
  createDetectorAdapter,
  perceive,
} from '../src/perceive.js';
import {
  trainGatekeeper,
  calibrateClusterRobustGatekeeper,
  calibrateStreamingEProcessGatekeeper,
  decideGatekeeper,
  binomCdf,
} from '../src/gatekeeper.js';

const FORENSIC_HIDDEN_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u0000]/g;

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wilsonIntervalPct(k, n, z = 1.959963984540054) {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return [
    Number((Math.max(0, center - half) * 100).toFixed(2)),
    Number((Math.min(1, center + half) * 100).toFixed(2)),
  ];
}

/**
 * Document-cluster bootstrap 95% CI for ratio metrics (safe yield, conditional FPR,
 * end-to-end residual leak of released) so intra-document correlation is respected.
 */
function clusterBootstrapCI(docStats, metricFn, { bootstraps = 1000, seed = 42 } = {}) {
  const n = docStats.length;
  if (n === 0 || bootstraps <= 0) return [0, 0];
  const rng = mulberry32(seed);
  const samples = new Array(bootstraps);
  for (let b = 0; b < bootstraps; b++) {
    let released = 0;
    let keptUnsafe = 0;
    let keptSafe = 0;
    let totalUnsafe = 0;
    let totalSafe = 0;
    let residualLeak = 0;
    for (let i = 0; i < n; i++) {
      const d = docStats[Math.floor(rng() * n)];
      released += d.released;
      keptUnsafe += d.keptUnsafe;
      keptSafe += d.keptSafe;
      totalUnsafe += d.totalUnsafe;
      totalSafe += d.totalSafe;
      residualLeak += d.residualLeak;
    }
    samples[b] = metricFn({ released, keptUnsafe, keptSafe, totalUnsafe, totalSafe, residualLeak });
  }
  samples.sort((a, b) => a - b);
  return [
    Number(samples[Math.floor(0.025 * bootstraps)].toFixed(2)),
    Number(samples[Math.min(bootstraps - 1, Math.floor(0.975 * bootstraps))].toFixed(2)),
  ];
}

function pairedDocPermutationPValue(ratesA, ratesB, { permutations = 5000, seed = 42 } = {}) {
  const diffs = ratesA.map((a, i) => a - ratesB[i]);
  const n = diffs.length;
  if (n === 0 || permutations <= 0) return 1.0;
  const obs = Math.abs(diffs.reduce((s, d) => s + d, 0) / n);
  if (obs <= 1e-12) return 1.0;
  const rng = mulberry32(seed);
  let ge = 0;
  for (let p = 0; p < permutations; p++) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += rng() < 0.5 ? diffs[i] : -diffs[i];
    }
    if (Math.abs(acc / n) >= obs - 1e-12) ge++;
  }
  return Number(((ge + 1) / (permutations + 1)).toFixed(5));
}

export function scanForensicTextAnomalies(text) {
  const s = String(text || '');
  const matches = s.match(FORENSIC_HIDDEN_RE) || [];
  return {
    anomalyCount: matches.length,
    hasAnomaly: matches.length > 0,
  };
}

function buildFeatureItem(row, tok, useDetectorSignals = true) {
  const txt = row.text || '';
  const enc = tok.encode(txt);
  const detCount = useDetectorSignals ? Number(row.detCount || 0) : 0;
  const maxConf = useDetectorSignals ? Number(row.maxConf || 0) : 0;
  const meanConf = useDetectorSignals ? Number(row.meanConf || 0) : 0;
  const secretCount = useDetectorSignals ? Number(row.secretCount || 0) : 0;
  const forensicCount = useDetectorSignals ? Number(row.forensicAnomalyCount || 0) : 0;
  const spanCoverage = useDetectorSignals ? Number(row.spanCoverage || 0) : 0;
  const conf = useDetectorSignals ? Math.max(0.05, 1.0 - maxConf) : 1.0;

  const feat = extractFeatureRow(
    { text: txt, cleanText: txt, piiCount: detCount, piiHits: [], sourceMode: 'tab_echr', confidence: conf },
    enc
  );
  const arr = Array.from(feat);
  if (useDetectorSignals) {
    arr[512] = Math.min(1.0, maxConf);
    arr[513] = Math.min(1.0, detCount / 5.0);
    arr[514] = detCount > 0 ? 1.0 : 0.0;
    arr[515] = Math.min(1.0, meanConf);
    arr[516] = Math.min(1.0, spanCoverage);
    arr[517] = secretCount > 0 || forensicCount > 0 ? 1.0 : 0.0;
  }

  // Plain confidence score: p_safe = 1 - max_conf (or 0 if secret/forensic anomaly triggered)
  const plainSafeScore =
    secretCount > 0 || forensicCount > 0
      ? 0.0
      : Math.max(0.0, Math.min(1.0, 1.0 - maxConf));

  return {
    doc_id: row.doc_id || 'doc_unknown',
    text: txt,
    features: arr,
    ySafe: row.unsafe ? 0 : 1,
    residualUnsafe: Boolean(row.residualUnsafe),
    detCount,
    maxConf,
    plainSafeScore,
    spans: row.spans || [],
  };
}

function groupByDocCluster(items, getProb) {
  const byDoc = new Map();
  for (const it of items) {
    const cid = it.doc_id || 'doc_0';
    if (!byDoc.has(cid)) byDoc.set(cid, []);
    byDoc.get(cid).push({
      prob: getProb(it),
      labelSafe: it.ySafe,
    });
  }
  return Array.from(byDoc.entries()).map(([clusterId, blocks]) => ({ clusterId, blocks }));
}

function evaluateDecisionMask(testItems, releasedFlags, { seed = 42, bootstraps = 1000 } = {}) {
  const byDoc = new Map();
  let totalUnsafe = 0;
  let totalSafe = 0;
  let keptUnsafe = 0;
  let keptSafe = 0;
  let residualLeak = 0;

  for (let i = 0; i < testItems.length; i++) {
    const it = testItems[i];
    const rel = Boolean(releasedFlags[i]);
    const cid = it.doc_id || 'doc_0';
    if (!byDoc.has(cid)) {
      byDoc.set(cid, {
        doc_id: cid,
        released: 0,
        keptUnsafe: 0,
        keptSafe: 0,
        totalUnsafe: 0,
        totalSafe: 0,
        residualLeak: 0,
      });
    }
    const ds = byDoc.get(cid);
    if (it.ySafe === 0) {
      totalUnsafe++;
      ds.totalUnsafe++;
    } else {
      totalSafe++;
      ds.totalSafe++;
    }
    if (rel) {
      ds.released++;
      if (it.ySafe === 0) {
        keptUnsafe++;
        ds.keptUnsafe++;
      } else {
        keptSafe++;
        ds.keptSafe++;
      }
      if (it.residualUnsafe) {
        residualLeak++;
        ds.residualLeak++;
      }
    }
  }

  const autoReleased = keptUnsafe + keptSafe;
  const docStats = Array.from(byDoc.values());

  const condFprPct = totalUnsafe > 0 ? Number(((keptUnsafe / totalUnsafe) * 100).toFixed(2)) : 0;
  const safeYieldPct = totalSafe > 0 ? Number(((keptSafe / totalSafe) * 100).toFixed(2)) : 0;
  const autoReleasePct = testItems.length > 0 ? Number(((autoReleased / testItems.length) * 100).toFixed(2)) : 0;
  const e2eLeakOfReleasedPct = autoReleased > 0 ? Number(((residualLeak / autoReleased) * 100).toFixed(2)) : 0;
  const e2eLeakOfUnsafePct = totalUnsafe > 0 ? Number(((residualLeak / totalUnsafe) * 100).toFixed(2)) : 0;
  const e2eLeakOfAllPct = testItems.length > 0 ? Number(((residualLeak / testItems.length) * 100).toFixed(2)) : 0;

  const e2eLeakBootCI = clusterBootstrapCI(
    docStats,
    (s) => (s.released > 0 ? (s.residualLeak / s.released) * 100 : 0),
    { bootstraps, seed }
  );
  const safeYieldBootCI = clusterBootstrapCI(
    docStats,
    (s) => (s.totalSafe > 0 ? (s.keptSafe / s.totalSafe) * 100 : 0),
    { bootstraps, seed: seed + 1 }
  );
  const condFprBootCI = clusterBootstrapCI(
    docStats,
    (s) => (s.totalUnsafe > 0 ? (s.keptUnsafe / s.totalUnsafe) * 100 : 0),
    { bootstraps, seed: seed + 2 }
  );

  // Per-document residual leak rate on released paragraphs (0 if doc had 0 released)
  const perDocLeakRate = docStats.map((d) => (d.released > 0 ? d.residualLeak / d.released : 0));
  const perDocLeakCount = docStats.map((d) => d.residualLeak);

  return {
    testConditionalFprPct: condFprPct,
    testConditionalFprBootstrap95CI: condFprBootCI,
    testSafeYieldPct: safeYieldPct,
    testSafeYieldBootstrap95CI: safeYieldBootCI,
    overallAutoReleasePct: autoReleasePct,
    autoReleasedCount: autoReleased,
    keptUnsafe,
    keptSafe,
    e2eResidualLeakCount: residualLeak,
    e2eResidualLeakOfReleasedPct: e2eLeakOfReleasedPct,
    e2eResidualLeakOfReleasedWilson95CI: wilsonIntervalPct(residualLeak, autoReleased),
    e2eResidualLeakOfReleasedBootstrap95CI: e2eLeakBootCI,
    e2eResidualLeakOfUnsafePct: e2eLeakOfUnsafePct,
    e2eResidualLeakOfAllPct: e2eLeakOfAllPct,
    _perDocLeakRate: perDocLeakRate,
    _perDocLeakCount: perDocLeakCount,
  };
}

function stripInternalMetrics(obj) {
  const out = { ...obj };
  delete out._perDocLeakRate;
  delete out._perDocLeakCount;
  return out;
}

/**
 * Verifies live T2 pluggable Stage 3B detector adapter integration (`createDetectorAdapter` + `perceive`)
 * on a deterministic sample of held-out blocks for this detector arm.
 */
async function verifyT2DetectorAdapterIntegration(armId, sampleItems, provenanceTag) {
  const sample = sampleItems.slice(0, Math.min(8, sampleItems.length));
  const byText = new Map();
  for (const it of sample) {
    byText.set(it.text, it.spans || []);
  }

  const adapter = createDetectorAdapter({
    id: `t8-${armId}`,
    kind: 'text',
    provenanceTag,
    detect: async ({ kind, text }) => {
      if (kind !== 'text') return [];
      const spans = byText.get(text) || [];
      return spans
        .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start && s.end <= text.length)
        .map((s) => ({
          entityType: String(s.type || s.label || 'PII').toUpperCase(),
          start: s.start,
          end: s.end,
          score: Math.max(0, Math.min(1, Number(s.score ?? 0.85))),
          provenanceTag,
        }));
    },
  });

  let pluggedSpansTotal = 0;
  let blocksVerified = 0;
  let provenanceMatched = 0;
  for (const it of sample) {
    const res = await perceive(it.text, {
      filePath: `${it.doc_id}.txt`,
      detectors: [adapter],
      workspaceSalt: `t8-adapter-${armId}`,
    });
    blocksVerified++;
    pluggedSpansTotal += res.conformalRiskStats?.pluggedTextSpansCount || 0;
    if ((res.conformalRiskStats?.detectorAdapterIds || []).includes(`t8-${armId}`)) {
      provenanceMatched++;
    }
  }

  return {
    adapterId: adapter.id,
    provenanceTag: adapter.provenanceTag,
    localOnly: adapter.localOnly,
    blocksVerified,
    provenanceMatched,
    pluggedSpansTotal,
    t2ContractVerified: blocksVerified === sample.length && provenanceMatched === sample.length,
  };
}

/**
 * Sweeps plain confidence thresholds (`p_safe = 1 - max_conf >= tau`) on testItems and
 * returns the curve + best-matched operating point achieving safeYield >= targetSafeYieldPct.
 */
function buildPlainThresholdCurve(testItems, { seed = 42, bootstraps = 1000 } = {}) {
  const thresholds = [0.0, 0.05, 0.10, 0.14, 0.15, 0.16, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.99];
  const curve = [];
  for (const tau of thresholds) {
    const flags = testItems.map((it) => it.plainSafeScore >= tau);
    const m = evaluateDecisionMask(testItems, flags, { seed, bootstraps });
    curve.push({ threshold: tau, ...m });
  }
  return curve;
}

function findMatchedSafeYieldPoint(curve, targetSafeYieldPct) {
  // Find operating point with safeYield >= targetSafeYieldPct closest to targetSafeYieldPct (equal-yield match)
  const qualifying = curve.filter((pt) => pt.testSafeYieldPct >= targetSafeYieldPct - 0.01);
  if (qualifying.length > 0) {
    qualifying.sort(
      (a, b) =>
        Math.abs(a.testSafeYieldPct - targetSafeYieldPct) - Math.abs(b.testSafeYieldPct - targetSafeYieldPct) ||
        a.e2eResidualLeakOfReleasedPct - b.e2eResidualLeakOfReleasedPct
    );
    return { matched: true, exactYieldAchievable: true, point: qualifying[0] };
  }
  // Fallback: closest safe yield available on the curve
  const sorted = [...curve].sort(
    (a, b) => Math.abs(a.testSafeYieldPct - targetSafeYieldPct) - Math.abs(b.testSafeYieldPct - targetSafeYieldPct)
  );
  return { matched: false, exactYieldAchievable: false, point: sorted[0] };
}

/**
 * Evaluates a single detector arm (detector alone, detector + plain confidence threshold,
 * detector + IID LTT, detector + HC-CRC, detector + E-LTT) on TAB train/cal/test paragraphs.
 */
export async function evaluateDetectorArm(armSpec, { alphas = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20], seed = 42, bootstraps = 1000, permutations = 5000 } = {}) {
  const tok = createTokenizer();
  const trItems = armSpec.train.map((r) => buildFeatureItem(r, tok, true));
  const caItems = armSpec.cal.map((r) => buildFeatureItem(r, tok, true));
  const teItems = armSpec.test.map((r) => buildFeatureItem(r, tok, true));

  // Verify T2 pluggable Stage 3B detector adapter contract on held-out sample
  const t2Verification = await verifyT2DetectorAdapterIntegration(
    armSpec.id,
    teItems,
    armSpec.provenanceTag || `t8:${armSpec.id}`
  );

  // 1. Detector alone (no gate: 100% auto-release after detector redaction)
  const detectorAloneMetrics = evaluateDecisionMask(
    teItems,
    teItems.map(() => true),
    { seed, bootstraps }
  );

  // 2. Detector + plain uncalibrated confidence threshold curve (including tau=0.50)
  const plainCurveFull = buildPlainThresholdCurve(teItems, { seed, bootstraps });
  const plainTau050 = plainCurveFull.find((p) => p.threshold === 0.50);

  // 3. Detector-informed 520-dim logistic gatekeeper (seed 42, matching Paper D)
  const bundle = trainGatekeeper(
    trItems.map((x) => x.features),
    trItems.map((x) => x.ySafe),
    { epochs: 20, lr: 0.30, l2: 1e-4, seed }
  );
  const getProb = (x) => decideGatekeeper(bundle, x.features).prob;
  const calProbs = caItems.map(getProb);
  const teProbs = teItems.map(getProb);
  const calClusters = groupByDocCluster(caItems, getProb);
  const calUnsafeN = caItems.filter((x) => x.ySafe === 0).length;

  // 3a. Naive IID LTT sweep (for comparison)
  const iidLttSweep = alphas.map((alpha) => {
    let tauKeep = 1.0;
    let certified = false;
    let calPValue = null;
    for (let step = 1; step <= 99; step++) {
      const t = step / 100;
      let k = 0;
      for (let i = 0; i < caItems.length; i++) {
        if (caItems[i].ySafe === 0 && calProbs[i] >= t) k++;
      }
      const pv = binomCdf(k, calUnsafeN, alpha);
      if (pv <= 0.05) {
        tauKeep = Number(t.toFixed(2));
        calPValue = Number(pv.toFixed(5));
        certified = true;
        break;
      }
    }
    const flags = teProbs.map((p) => certified && p >= tauKeep);
    const m = evaluateDecisionMask(teItems, flags, { seed, bootstraps });
    return { alpha, certified, threshold: certified ? tauKeep : null, calPValue, ...stripInternalMetrics(m) };
  });

  // 3b. Document-Clustered HC-CRC sweep + matched-safe-yield comparison vs. detector alone & plain threshold
  const hcCrcRaw = alphas.map((alpha) => {
    const res = calibrateClusterRobustGatekeeper({ ...bundle }, calClusters, { alpha, delta: 0.05 });
    const cc = res.clusterCalibration;
    const flags = teProbs.map((p) => cc.certified && p >= cc.tauKeep);
    const m = evaluateDecisionMask(teItems, flags, { seed, bootstraps });
    return {
      alpha,
      certified: cc.certified,
      threshold: cc.certified ? cc.tauKeep : null,
      calPValue: cc.pValue,
      intraClusterCorrelation: cc.intraClusterCorrelation,
      designEffect: cc.designEffect,
      effectiveSampleSize: cc.effectiveSampleSize,
      nUnsafeClusters: cc.nUnsafeClusters,
      metrics: m,
    };
  });

  const hcCrcSweep = hcCrcRaw.map((entry) => {
    const m = entry.metrics;
    const matchedPlain = findMatchedSafeYieldPoint(plainCurveFull, m.testSafeYieldPct);
    const permVsAlone = pairedDocPermutationPValue(
      m._perDocLeakRate,
      detectorAloneMetrics._perDocLeakRate,
      { permutations, seed }
    );
    const permVsPlain = pairedDocPermutationPValue(
      m._perDocLeakRate,
      matchedPlain.point._perDocLeakRate,
      { permutations, seed: seed + 10 }
    );
    return {
      alpha: entry.alpha,
      certified: entry.certified,
      threshold: entry.threshold,
      calPValue: entry.calPValue,
      intraClusterCorrelation: entry.intraClusterCorrelation,
      designEffect: entry.designEffect,
      effectiveSampleSize: entry.effectiveSampleSize,
      nUnsafeClusters: entry.nUnsafeClusters,
      ...stripInternalMetrics(m),
      vsDetectorAlone: {
        detectorAloneE2eLeakPct: detectorAloneMetrics.e2eResidualLeakOfReleasedPct,
        detectorAloneE2eLeakCount: detectorAloneMetrics.e2eResidualLeakCount,
        absoluteLeakDropPctPts: Number((detectorAloneMetrics.e2eResidualLeakOfReleasedPct - m.e2eResidualLeakOfReleasedPct).toFixed(2)),
        pairedDocPermutationP: permVsAlone,
      },
      vsPlainThresholdAtMatchedSafeYield: {
        plainThreshold: matchedPlain.point.threshold,
        plainSafeYieldPct: matchedPlain.point.testSafeYieldPct,
        plainE2eLeakOfReleasedPct: matchedPlain.point.e2eResidualLeakOfReleasedPct,
        plainE2eLeakCount: matchedPlain.point.e2eResidualLeakCount,
        plainAutoReleasePct: matchedPlain.point.overallAutoReleasePct,
        absoluteLeakDropPctPts: Number((matchedPlain.point.e2eResidualLeakOfReleasedPct - m.e2eResidualLeakOfReleasedPct).toFixed(2)),
        pairedDocPermutationP: permVsPlain,
      },
    };
  });

  // 3c. Streaming Ville Martingale E-LTT sweep
  const eLttSweep = alphas.map((alpha) => {
    const res = calibrateStreamingEProcessGatekeeper({ ...bundle }, calClusters, { alpha, delta: 0.05 });
    const ec = res.eProcessCalibration;
    const flags = teProbs.map((p) => ec.certified && p >= ec.tauKeep);
    const m = evaluateDecisionMask(teItems, flags, { seed, bootstraps });
    const matchedPlain = findMatchedSafeYieldPoint(plainCurveFull, m.testSafeYieldPct);
    return {
      alpha,
      certified: ec.certified,
      threshold: ec.certified ? ec.tauKeep : null,
      maxEValue: ec.maxEValue,
      anytimePValue: ec.anytimePValue,
      stoppingClusterStep: ec.stoppingClusterStep,
      ...stripInternalMetrics(m),
      vsPlainThresholdAtMatchedSafeYield: {
        plainThreshold: matchedPlain.point.threshold,
        plainSafeYieldPct: matchedPlain.point.testSafeYieldPct,
        plainE2eLeakOfReleasedPct: matchedPlain.point.e2eResidualLeakOfReleasedPct,
        plainE2eLeakCount: matchedPlain.point.e2eResidualLeakCount,
        absoluteLeakDropPctPts: Number((matchedPlain.point.e2eResidualLeakOfReleasedPct - m.e2eResidualLeakOfReleasedPct).toFixed(2)),
      },
    };
  });

  return {
    id: armSpec.id,
    label: armSpec.label,
    t2AdapterVerification: t2Verification,
    detectorAlone: stripInternalMetrics(detectorAloneMetrics),
    plainConfidenceThresholdTau050: stripInternalMetrics(plainTau050),
    plainConfidenceThresholdCurve: plainCurveFull.map(stripInternalMetrics),
    iidLttSweep,
    hcCrcSweep,
    eLttSweep,
    _hcCrcRaw: hcCrcRaw,
    _plainCurveFull: plainCurveFull,
  };
}

/**
 * Evaluates all arms and produces the Gate-Over-Best-Detector + Stitched-Baseline Shootout summary.
 */
export async function evaluateTabShootoutPayload(payload) {
  const alphas = payload.alphas || [0.01, 0.02, 0.05, 0.10, 0.15, 0.20];
  const seed = Number(payload.seed ?? 42);
  const bootstraps = Number(payload.bootstraps ?? 1000);
  const permutations = Number(payload.permutations ?? 5000);

  const armResults = {};
  const rawArms = {};
  for (const armSpec of payload.arms || []) {
    const res = await evaluateDetectorArm(armSpec, { alphas, seed, bootstraps, permutations });
    rawArms[armSpec.id] = res;
    const clean = { ...res };
    delete clean._hcCrcRaw;
    delete clean._plainCurveFull;
    armResults[armSpec.id] = clean;
  }

  // Build explicit Stitched-Baseline vs. Versieve HC-CRC / E-LTT shootout table at equal Safe Yield
  const stitchedRaw = rawArms.stitched_presidio_detect_secrets_forensic || rawArms.presidio_fair_echr || null;
  const versievePresidioRaw = rawArms.presidio_plus_stage3a || rawArms.presidio_fair_echr || null;
  const versieveGlinerRaw = rawArms.gliner_plus_stage3a || null;

  const stitchedShootout = [];
  if (stitchedRaw) {
    const compareTargets = [
      { key: 'versieve_hc_crc_over_presidio_stage3a', label: 'Versieve HC-CRC (Stage 3A + Presidio)', raw: versievePresidioRaw },
      { key: 'versieve_hc_crc_over_gliner_stage3a', label: 'Versieve HC-CRC (Stage 3A + GLiNER-Edge)', raw: versieveGlinerRaw },
    ].filter((t) => t.raw);

    for (const target of compareTargets) {
      const comparisons = [];
      for (const hcEntry of target.raw._hcCrcRaw) {
        if (!hcEntry.certified) continue;
        const m = hcEntry.metrics;
        const stitchedMatched = findMatchedSafeYieldPoint(stitchedRaw._plainCurveFull, m.testSafeYieldPct);
        const permP = pairedDocPermutationPValue(
          m._perDocLeakRate,
          stitchedMatched.point._perDocLeakRate,
          { permutations, seed }
        );
        comparisons.push({
          alpha: hcEntry.alpha,
          versieveSafeYieldPct: m.testSafeYieldPct,
          versieveCondFprPct: m.testConditionalFprPct,
          versieveAutoReleasePct: m.overallAutoReleasePct,
          versieveE2eLeakOfReleasedPct: m.e2eResidualLeakOfReleasedPct,
          versieveE2eLeakBootstrap95CI: m.e2eResidualLeakOfReleasedBootstrap95CI,
          versieveE2eLeakCount: m.e2eResidualLeakCount,
          stitchedPlainThreshold: stitchedMatched.point.threshold,
          stitchedSafeYieldPct: stitchedMatched.point.testSafeYieldPct,
          stitchedCondFprPct: stitchedMatched.point.testConditionalFprPct,
          stitchedAutoReleasePct: stitchedMatched.point.overallAutoReleasePct,
          stitchedE2eLeakOfReleasedPct: stitchedMatched.point.e2eResidualLeakOfReleasedPct,
          stitchedE2eLeakBootstrap95CI: stitchedMatched.point.e2eResidualLeakOfReleasedBootstrap95CI,
          stitchedE2eLeakCount: stitchedMatched.point.e2eResidualLeakCount,
          leakDeltaPctPts: Number((stitchedMatched.point.e2eResidualLeakOfReleasedPct - m.e2eResidualLeakOfReleasedPct).toFixed(2)),
          pairedDocPermutationP: permP,
        });
      }
      stitchedShootout.push({
        versieveArm: target.key,
        versieveLabel: target.label,
        stitchedArm: stitchedRaw.id,
        stitchedLabel: stitchedRaw.label,
        stitchedUncalibratedTau050: stitchedRaw.plainConfidenceThresholdTau050,
        stitchedNoGateAlone: stitchedRaw.detectorAlone,
        matchedSafeYieldComparisons: comparisons,
      });
    }
  }

  const firstArm = (payload.arms || [])[0];
  const splits = firstArm
    ? {
        trainParagraphs: firstArm.train.length,
        calParagraphs: firstArm.cal.length,
        calUnsafe: firstArm.cal.filter((x) => x.unsafe).length,
        calSafe: firstArm.cal.filter((x) => !x.unsafe).length,
        calClusters: new Set(firstArm.cal.map((x) => x.doc_id)).size,
        testParagraphs: firstArm.test.length,
        testUnsafe: firstArm.test.filter((x) => x.unsafe).length,
        testSafe: firstArm.test.filter((x) => !x.unsafe).length,
        testClusters: new Set(firstArm.test.map((x) => x.doc_id)).size,
      }
    : null;

  return {
    schemaVersion: 'versieve.t8.gate-over-detector-and-stitched-shootout.v1',
    seed,
    bootstraps,
    permutations,
    alphas,
    splits,
    gateOverDetectorArms: armResults,
    stitchedBaselineShootout: stitchedShootout,
  };
}

function parseCliArgs(argv) {
  const out = { mode: null, inPath: null, outPath: null, fixtureInput: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--mode' && i + 1 < argv.length) out.mode = argv[++i];
    else if (a === '--in' && i + 1 < argv.length) out.inPath = argv[++i];
    else if (a === '--out' && i + 1 < argv.length) out.outPath = argv[++i];
    else if (a === '--fixture-input' && i + 1 < argv.length) out.fixtureInput = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/run-gate-over-detector-and-stitched-shootout.mjs [options]
  --mode scan-stage3a --in <docs.json> --out <out.json>
  --mode evaluate-tab-gates --in <payload.json> --out <out.json>
  --fixture-input <synthetic-payload.json> --out <out.json>
`);
    return;
  }

  if (args.mode === 'scan-stage3a') {
    if (!args.inPath || !args.outPath) {
      console.error(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGS', message: '--mode scan-stage3a requires --in and --out' }));
      process.exit(2);
    }
    const docs = JSON.parse(fs.readFileSync(args.inPath, 'utf8'));
    const results = docs.map((doc) => {
      const text = doc.text || '';
      const s3a = scanEnterprisePiiAndSecrets(text).spans.map((h) => ({
        start: h.start,
        end: h.end,
        type: String(h.type || '').toUpperCase(),
        category: h.category,
        score: h.category === 'secret' ? 0.95 : 0.85,
        source: 'stage3a',
      }));
      const forensic = scanForensicTextAnomalies(text);
      return {
        doc_id: doc.doc_id,
        stage3a: s3a,
        forensicAnomalyCount: forensic.anomalyCount,
      };
    });
    fs.writeFileSync(args.outPath, JSON.stringify(results), 'utf8');
    return;
  }

  if (args.mode === 'evaluate-tab-gates' || args.fixtureInput) {
    const srcPath = args.fixtureInput || args.inPath;
    if (!srcPath || !args.outPath) {
      console.error(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGS', message: 'Requires --in (or --fixture-input) and --out' }));
      process.exit(2);
    }
    const payload = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const report = await evaluateTabShootoutPayload(payload);
    fs.mkdirSync(path.dirname(path.resolve(args.outPath)), { recursive: true });
    fs.writeFileSync(args.outPath, JSON.stringify(report, null, 2), 'utf8');
    return;
  }

  console.error(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGS', message: 'Specify --mode scan-stage3a | --mode evaluate-tab-gates | --fixture-input <path>' }));
  process.exit(2);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, errorCode: 'EXECUTION_FAILED', message: err?.message || String(err) }));
    process.exit(1);
  });
}
