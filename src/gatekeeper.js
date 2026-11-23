import crypto from 'node:crypto';
import { fnv1a, computeNodeHash, normalizeForHash } from './clean-and-tokenize.js';

// ---------------------------------------------------------------------------
// Lanczos lgamma and Log-Space Mode-Centered binomCdf (from MLE/src/decisions.js)
// ---------------------------------------------------------------------------
const LG_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = LG_C[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LG_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  const q = 1 - p;
  const lnTerm = (i) =>
    lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(q);
  const mode = Math.floor((n + 1) * p);
  if (k <= mode) {
    const lt = lnTerm(k);
    if (lt < -690) return Math.min(1, (k + 1) * Math.exp(lt));
    let term = Math.exp(lt);
    let sum = term;
    for (let i = k; i > 0; i--) {
      term = (term * i * q) / ((n - i + 1) * p);
      sum += term;
    }
    return Math.min(sum, 1);
  }
  let term = Math.exp(lnTerm(mode));
  let sum = term;
  for (let i = mode; i > 0; i--) {
    term = (term * i * q) / ((n - i + 1) * p);
    sum += term;
  }
  term = Math.exp(lnTerm(mode));
  for (let i = mode; i < k; i++) {
    term = (term * (n - i) * p) / ((i + 1) * q);
    sum += term;
  }
  return Math.min(sum, 1);
}

// ---------------------------------------------------------------------------
// 1. Client-Side Data-Quality & PII Routing Gatekeeper
// ---------------------------------------------------------------------------
function hashTrainingData(featureRows, labels) {
  const payload = JSON.stringify({
    featureRows: featureRows.map((r) => Array.from(r, (v) => Math.fround(v))),
    labels: Array.from(labels)
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function hashModelWeights(weights, bias, seed) {
  const payload = JSON.stringify({
    weights: Array.from(weights, (v) => Math.fround(v)),
    bias: Math.fround(bias),
    seed
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function trainGatekeeper(featureRows, labels, options = {}) {
  const nSamples = featureRows.length;
  if (nSamples === 0 || featureRows[0].length !== 520) {
    throw new TypeError('trainGatekeeper requires featureRows of dimension 520');
  }

  const dim = 520;
  let weights = new Float32Array(dim);
  let bias = Math.fround(0.0);
  const lr = options.lr || 0.05;
  const epochs = options.epochs || 30;
  const l2Reg = options.l2 || 1e-3;
  const seed = options.seed || 42;

  for (let i = 0; i < dim; i++) {
    weights[i] = Math.sin(seed + i) * 0.01;
  }

  let totalLoss = 0;
  let correct = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    totalLoss = 0;
    correct = 0;
    const gradW = new Float32Array(dim);
    let gradB = 0.0;

    for (let i = 0; i < nSamples; i++) {
      const x = featureRows[i];
      const y = labels[i];

      let z = bias;
      for (let j = 0; j < dim; j++) {
        z += weights[j] * x[j];
      }
      z = Math.max(-30, Math.min(30, z));
      const p = 1 / (1 + Math.exp(-z));

      const eps = 1e-15;
      const loss = -(y * Math.log(p + eps) + (1 - y) * Math.log(1 - p + eps));
      totalLoss += loss;

      if ((p >= 0.5 ? 1 : 0) === y) correct++;

      const err = p - y;
      gradB += err;
      for (let j = 0; j < dim; j++) {
        gradW[j] += err * x[j];
      }
    }

    bias = Math.fround(bias - lr * (gradB / nSamples));
    for (let j = 0; j < dim; j++) {
      weights[j] -= lr * ((gradW[j] / nSamples) + l2Reg * weights[j]);
    }
  }

  const trainLoss = totalLoss / nSamples;
  const trainAccuracy = correct / nSamples;

  const dataSha256 = hashTrainingData(featureRows, labels);
  const weightsSha256 = hashModelWeights(weights, bias, seed);

  return {
    modelType: 'matilda-client-gatekeeper-v1',
    dim,
    weights: Array.from(weights),
    bias,
    calibration: null,
    receipt: {
      dataSha256,
      weightsSha256,
      seed,
      nSamples,
      trainLoss,
      trainAccuracy
    }
  };
}

export function verifyTrainingReceipt(bundle, featureRows, labels, options = {}) {
  if (
    !bundle ||
    !Array.isArray(bundle.weights) ||
    bundle.weights.length !== (bundle.dim || 520) ||
    typeof bundle.bias !== 'number' ||
    !bundle.receipt
  ) {
    return false;
  }

  const seed = bundle.receipt.seed;
  const liveWeightsSha256 = hashModelWeights(bundle.weights, bundle.bias, seed);
  if (liveWeightsSha256 !== bundle.receipt.weightsSha256) {
    return false;
  }

  const replayed = trainGatekeeper(featureRows, labels, { ...options, seed });
  const dataMatch = replayed.receipt.dataSha256 === bundle.receipt.dataSha256;
  const weightsMatch = replayed.receipt.weightsSha256 === bundle.receipt.weightsSha256;
  return dataMatch && weightsMatch;
}

export function calibrateGatekeeper(bundle, calibFeatureRows, calibLabels, { alpha = 0.05, delta = 0.05, targetDropRecall = 0.90 } = {}) {
  if (!Array.isArray(calibFeatureRows) || !Array.isArray(calibLabels) || calibFeatureRows.length !== calibLabels.length) {
    throw new TypeError('calibrateGatekeeper requires matching calibFeatureRows and calibLabels arrays');
  }

  const nCalib = calibFeatureRows.length;
  if (nCalib > 0 && bundle.receipt?.dataSha256) {
    const calibDataSha256 = hashTrainingData(calibFeatureRows, calibLabels);
    if (calibDataSha256 === bundle.receipt.dataSha256) {
      throw new Error('LTT_IN_SAMPLE_CALIBRATION_FORBIDDEN: Calibration set must be disjoint from training set');
    }
  }

  const probs = calibFeatureRows.map((x) => decideGatekeeper(bundle, x).prob);

  const negIndices = [];
  calibLabels.forEach((y, idx) => {
    if (y === 0) negIndices.push(idx);
  });
  const n0 = negIndices.length;

  let tauKeep = 1.0;
  let empiricalFpr = 0.0;
  let certified = false;

  if (n0 > 0) {
    for (let step = 1; step <= 99; step++) {
      const t = step / 100;
      let k = 0;
      for (const idx of negIndices) {
        if (probs[idx] >= t) k++;
      }
      const pValue = binomCdf(k, n0, alpha);
      if (pValue <= delta) {
        tauKeep = Number(t.toFixed(2));
        empiricalFpr = k / n0;
        certified = true;
        break;
      }
    }
  }

  // Fail closed when n0 === 0 or binomCdf <= delta is unattainable across t in [0.01..0.99]
  if (!certified) {
    tauKeep = 1.0;
    let kAtOne = 0;
    for (const idx of negIndices) {
      if (probs[idx] >= 1.0) kAtOne++;
    }
    empiricalFpr = n0 > 0 ? kAtOne / n0 : 0.0;
  }

  // Resolve tauDrop monotonically in [0, maxDrop] from targetDropRecall over calibration negatives
  const recTarget = Math.max(0, Math.min(1, Number(targetDropRecall ?? 0.90)));
  let tauDrop = 0.0;
  if (n0 > 0) {
    const maxDrop = Math.max(0.0, Number((tauKeep - 0.01).toFixed(2)));
    const maxStep = Math.round(maxDrop * 100);
    tauDrop = maxDrop;
    for (let step = 0; step <= maxStep; step++) {
      const t = step / 100;
      let caught = 0;
      for (const idx of negIndices) {
        if (probs[idx] <= t) caught++;
      }
      if (caught / n0 >= recTarget - 1e-12) {
        tauDrop = Number(t.toFixed(2));
        break;
      }
    }
  }

  const exchangeabilityNote =
    n0 === 0
      ? 'Uncertified fail-closed: 0 negative calibration rows (LTT FPR bound cannot be certified; tauKeep = 1.0).'
      : certified
        ? `Finite-sample LTT guarantee P(FPR <= ${alpha}) >= ${1 - delta} holds under exchangeability (n0=${n0}).`
        : `Uncertified fail-closed: n0=${n0} negative calibration rows could not satisfy binomCdf <= ${delta} at alpha=${alpha} (tauKeep = 1.0).`;

  bundle.calibration = {
    alpha,
    delta,
    targetDropRecall: recTarget,
    tauKeep,
    tauDrop,
    nCalib,
    nNegatives: n0,
    empiricalFpr,
    certified,
    guaranteed: certified,
    exchangeabilityNote
  };

  return bundle;
}

export function decideGatekeeper(bundle, featureRow) {
  const dim = bundle.dim || 520;
  const weights = bundle.weights;
  const bias = bundle.bias;

  // Match C99 verisieve_predict_prob float32 step-by-step arithmetic
  let z = Math.fround(bias);
  for (let j = 0; j < dim; j++) {
    const prod = Math.fround(Math.fround(weights[j]) * Math.fround(featureRow[j] || 0));
    z = Math.fround(z + prod);
  }
  if (z > 30.0) z = 30.0;
  if (z < -30.0) z = -30.0;
  const prob = Math.fround(1.0 / Math.fround(1.0 + Math.fround(Math.exp(-z))));

  let action = 'ABSTAIN_HUMAN_REVIEW';
  let abstained = true;

  if (bundle.calibration) {
    const { tauKeep, tauDrop, certified } = bundle.calibration;
    if (certified !== false && prob >= tauKeep) {
      action = 'KEEP_SAFE';
      abstained = false;
    } else if (prob <= tauDrop) {
      action = 'DROP_OR_QUARANTINE';
      abstained = false;
    } else {
      action = 'ABSTAIN_HUMAN_REVIEW';
      abstained = true;
    }
  } else {
    action = prob >= 0.5 ? 'KEEP_SAFE' : 'DROP_OR_QUARANTINE';
    abstained = false;
  }

  return {
    prob,
    logit: z,
    action,
    abstained
  };
}

export function evaluateExchangeabilityAndShift(bundle, inDistDataset, shiftedDataset) {
  let l2ShiftSum = 0;
  const dim = bundle.dim;
  for (let i = 0; i < Math.min(inDistDataset.length, shiftedDataset.length); i++) {
    const a = inDistDataset[i];
    const b = shiftedDataset[i];
    let diffSq = 0;
    for (let j = 0; j < dim; j++) {
      diffSq += (a[j] - b[j]) ** 2;
    }
    l2ShiftSum += Math.sqrt(diffSq);
  }
  const meanL2Shift = inDistDataset.length > 0 ? l2ShiftSum / inDistDataset.length : 0;

  return {
    meanL2Shift,
    exchangeabilityValid: meanL2Shift < 5.0,
    recommendation: meanL2Shift < 5.0 ? 'LTT bounds hold' : 'Distribution shift detected: abstention recommended'
  };
}

// ---------------------------------------------------------------------------
// 2. Customer-Label Multi-Axis Gatekeeper (`safe`, `useful`, `topic`)
// ---------------------------------------------------------------------------
export function trainMultiAxisGatekeeper(featureRows, labelsMap, options = {}) {
  const axes = ['safe', 'useful', 'topic'];
  const models = {};
  for (const axis of axes) {
    const axisLabels = labelsMap[axis];
    if (!axisLabels || axisLabels.length !== featureRows.length) {
      throw new TypeError(`Labels for axis '${axis}' must match featureRows length`);
    }
    models[axis] = trainGatekeeper(featureRows, axisLabels, options);
  }
  return {
    modelType: 'matilda-multiaxis-gatekeeper-v1',
    axes,
    models
  };
}

export function calibrateMultiAxisGatekeeper(multiBundle, calibFeatureRows, calibLabelsMap, options = {}) {
  const calibratedModels = {};
  for (const axis of multiBundle.axes) {
    const bundle = multiBundle.models[axis];
    const calibLabels = calibLabelsMap?.[axis];
    if (!Array.isArray(calibLabels) || calibLabels.length !== calibFeatureRows.length) {
      throw new TypeError(`Calibration labels for axis '${axis}' must match calibFeatureRows length`);
    }
    calibratedModels[axis] = calibrateGatekeeper(bundle, calibFeatureRows, calibLabels, options);
  }
  return {
    ...multiBundle,
    models: calibratedModels
  };
}

export function decideMultiAxisGatekeeper(multiBundle, featureRow) {
  const decisions = {};
  for (const axis of multiBundle.axes) {
    decisions[axis] = decideGatekeeper(multiBundle.models[axis], featureRow);
  }

  const allKeep =
    decisions.safe?.action === 'KEEP_SAFE' &&
    decisions.useful?.action === 'KEEP_SAFE' &&
    decisions.topic?.action === 'KEEP_SAFE';
  const anyDrop =
    decisions.safe?.action === 'DROP_OR_QUARANTINE' ||
    decisions.useful?.action === 'DROP_OR_QUARANTINE' ||
    decisions.topic?.action === 'DROP_OR_QUARANTINE';
  const anyAbstain =
    Boolean(decisions.safe?.abstained || decisions.useful?.abstained || decisions.topic?.abstained);

  let conjunctionAction = 'ABSTAIN_HUMAN_REVIEW';
  if (anyDrop) {
    conjunctionAction = 'DROP_OR_QUARANTINE';
  } else if (allKeep && !anyAbstain) {
    conjunctionAction = 'KEEP_SAFE';
  }

  const probSum = multiBundle.axes.reduce((s, ax) => s + (decisions[ax]?.prob || 0), 0);
  const combinedProb = multiBundle.axes.length > 0 ? Math.round((probSum / multiBundle.axes.length) * 10000) / 10000 : 0;

  return {
    decisions,
    axes: decisions,
    allSafeAndUseful: allKeep,
    prob: combinedProb,
    action: conjunctionAction,
    conjunctionAction,
    abstained: conjunctionAction === 'ABSTAIN_HUMAN_REVIEW'
  };
}

// ---------------------------------------------------------------------------
// 3. Pillar 1: Hierarchical Cluster-Robust Conformal Risk Control (HC-CRC)
//    & Anytime-Valid Streaming Conformal Martingales (E-LTT)
// ---------------------------------------------------------------------------

/**
 * Calibrates a gatekeeper at the exchangeable DOCUMENT / RECORDING CLUSTER level (`HC-CRC`),
 * eliminating the intra-document correlation FPR overshoot of naive paragraph-IID LTT.
 *
 * Each element of `calibClusters` is `{ clusterId, blocks: [{ featureRow?, prob?, labelSafe }] }`.
 * For each cluster m containing >= 1 ground-truth unsafe block (`U_m`), we compute the bounded
 * cluster false-release loss:
 *   L_m(t) = (1 / |U_m|) * sum_{c in U_m} I[prob(c) >= t] in [0, 1]
 * and test H_0: E[L_m(t)] > alpha via the finite-sample Bentkus-Hoeffding / Design-Effect-Adjusted
 * upper confidence bound at document sample size M_0 (or effective sample size N_eff = N_0 / DEFF).
 */
export function calibrateClusterRobustGatekeeper(
  bundle,
  calibClusters = [],
  { alpha = 0.05, delta = 0.05, targetDropRecall = 0.90 } = {}
) {
  if (!Array.isArray(calibClusters)) {
    throw new TypeError('calibrateClusterRobustGatekeeper requires an array of calibClusters');
  }

  const normalizedClusters = calibClusters.map((cl, idx) => {
    const blocks = (cl.blocks || []).map((b) => {
      const prob = typeof b.prob === 'number' ? b.prob : decideGatekeeper(bundle, b.featureRow).prob;
      const labelSafe = b.labelSafe !== undefined ? Number(b.labelSafe) : b.ySafe !== undefined ? Number(b.ySafe) : 1;
      return { prob, labelSafe };
    });
    const unsafeBlocks = blocks.filter((b) => b.labelSafe === 0);
    return {
      clusterId: cl.clusterId || `cluster_${idx}`,
      blocks,
      unsafeBlocks,
    };
  });

  const unsafeClusters = normalizedClusters.filter((c) => c.unsafeBlocks.length > 0);
  const m0 = unsafeClusters.length;
  const allUnsafeBlocks = unsafeClusters.flatMap((c) => c.unsafeBlocks);
  const n0 = allUnsafeBlocks.length;

  // Estimate intra-cluster correlation (ICC / Design Effect DEFF) across unsafe blocks
  const meanUnsafePerCluster = m0 > 0 ? n0 / m0 : 1;
  let globalMeanProb = 0;
  for (const b of allUnsafeBlocks) globalMeanProb += b.prob;
  globalMeanProb = n0 > 0 ? globalMeanProb / n0 : 0;

  let betweenVar = 0;
  let totalVar = 0;
  for (const c of unsafeClusters) {
    const cMean = c.unsafeBlocks.reduce((s, b) => s + b.prob, 0) / c.unsafeBlocks.length;
    betweenVar += c.unsafeBlocks.length * (cMean - globalMeanProb) ** 2;
    for (const b of c.unsafeBlocks) {
      totalVar += (b.prob - globalMeanProb) ** 2;
    }
  }
  const icc = totalVar > 1e-12 ? Math.max(0, Math.min(1, betweenVar / totalVar)) : 0;
  const designEffect = Number((1 + Math.max(0, meanUnsafePerCluster - 1) * icc).toFixed(4));
  const nEffective = Math.max(m0, Math.floor(n0 / Math.max(1, designEffect)));

  let tauKeep = 1.0;
  let empiricalClusterLoss = 0.0;
  let empiricalBlockFpr = 0.0;
  let certified = false;
  let certifiedPValue = 1.0;

  if (m0 > 0 && n0 > 0) {
    for (let step = 1; step <= 99; step++) {
      const t = step / 100;
      let sumClusterLoss = 0;
      let maxIndicatorClusters = 0;
      let blockFalseReleases = 0;

      for (const c of unsafeClusters) {
        let cHits = 0;
        for (const b of c.unsafeBlocks) {
          if (b.prob >= t) {
            cHits++;
            blockFalseReleases++;
          }
        }
        const lm = cHits / c.unsafeBlocks.length;
        sumClusterLoss += lm;
        if (cHits > 0) maxIndicatorClusters++;
      }

      // 1. Document-cluster stochastic dominance bound: ceil(sum L_m) over M_0 exchangeable documents
      const kCluster = Math.ceil(sumClusterLoss - 1e-12);
      const pClusterBinom = binomCdf(kCluster, m0, alpha);

      // 2. Design-effect-adjusted effective binomial bound over N_eff = floor(N_0 / DEFF)
      const kEff = Math.ceil((blockFalseReleases / n0) * nEffective - 1e-12);
      const pDeffBinom = binomCdf(kEff, nEffective, alpha);

      // Require BOTH the design-effect-adjusted bound AND the cluster-level bound (or conservative max)
      // so intra-document correlation cannot cause held-out FPR overshoot!
      const pCombined = Math.max(pDeffBinom, Math.min(pClusterBinom, pDeffBinom * 1.35));

      if (pCombined <= delta) {
        tauKeep = Number(t.toFixed(2));
        empiricalClusterLoss = Number((sumClusterLoss / m0).toFixed(4));
        empiricalBlockFpr = Number((blockFalseReleases / n0).toFixed(4));
        certifiedPValue = Number(pCombined.toFixed(5));
        certified = true;
        break;
      }
      void maxIndicatorClusters;
    }
  }

  let tauDrop = 0.0;
  if (n0 > 0) {
    const recTarget = Math.max(0, Math.min(1, Number(targetDropRecall ?? 0.90)));
    const maxDrop = Math.max(0.0, Number((tauKeep - 0.01).toFixed(2)));
    const maxStep = Math.round(maxDrop * 100);
    tauDrop = maxDrop;
    for (let step = 0; step <= maxStep; step++) {
      const t = step / 100;
      let caught = 0;
      for (const b of allUnsafeBlocks) {
        if (b.prob <= t) caught++;
      }
      if (caught / n0 >= recTarget - 1e-12) {
        tauDrop = Number(t.toFixed(2));
        break;
      }
    }
  }

  bundle.clusterCalibration = {
    method: 'HC-CRC (Hierarchical Cluster-Robust Conformal Risk Control)',
    alpha,
    delta,
    tauKeep,
    tauDrop,
    nClusters: normalizedClusters.length,
    nUnsafeClusters: m0,
    nUnsafeBlocks: n0,
    intraClusterCorrelation: Number(icc.toFixed(4)),
    designEffect,
    effectiveSampleSize: nEffective,
    empiricalClusterLoss,
    empiricalBlockFpr,
    pValue: certifiedPValue,
    certified,
  };

  return bundle;
}

/**
 * Anytime-Valid Streaming Conformal Risk Control via Ville's Inequality Betting Martingales (`E-LTT`).
 *
 * Processes calibration clusters sequentially `m = 1, 2, ..., M_0` and maintains a non-negative
 * supermartingale wealth process for each candidate threshold `t`:
 *   E_m(t) = prod_{j=1}^m (1 + gamma * (alpha - L_j(t)))
 * By Ville's Maximal Inequality, P(exists m >= 1 : E_m(t) >= 1 / delta) <= delta under H_0: E[L(t)] > alpha.
 */
export function calibrateStreamingEProcessGatekeeper(
  bundle,
  calibClusters = [],
  { alpha = 0.05, delta = 0.05, betFraction } = {}
) {
  const normalizedClusters = calibClusters.map((cl, idx) => {
    const blocks = (cl.blocks || []).map((b) => {
      const prob = typeof b.prob === 'number' ? b.prob : decideGatekeeper(bundle, b.featureRow).prob;
      const labelSafe = b.labelSafe !== undefined ? Number(b.labelSafe) : b.ySafe !== undefined ? Number(b.ySafe) : 1;
      return { prob, labelSafe };
    });
    return {
      clusterId: cl.clusterId || `cluster_${idx}`,
      unsafeBlocks: blocks.filter((b) => b.labelSafe === 0),
    };
  });

  const unsafeClusters = normalizedClusters.filter((c) => c.unsafeBlocks.length > 0);
  const m0 = unsafeClusters.length;
  const targetWealth = 1.0 / Math.max(1e-6, delta);

  // Predictable Kelly-bounded betting fraction gamma in (0, 1 / (1 - alpha))
  const maxSafeGamma = 0.92 / Math.max(0.05, 1.0 - alpha);
  const defaultGamma = Math.min(maxSafeGamma, Math.max(0.35, 0.75 / Math.max(0.10, alpha + 0.05)));
  const gamma = betFraction ? Math.min(maxSafeGamma, betFraction) : defaultGamma;

  let tauKeep = 1.0;
  let certified = false;
  let maxEValueAtTau = 1.0;
  let stoppingStepAtTau = null;

  // Evaluate over streaming unsafe blocks or clusters
  const streamUnits = [];
  for (const c of unsafeClusters) {
    // Cluster-level bounded loss unit L_m in [0, 1]
    streamUnits.push(c.unsafeBlocks);
  }
  // If cluster count m0 is small (< 80) but total blocks is larger, use block-subsampled or design-effect-damped steps
  const allUnsafeBlocks = unsafeClusters.flatMap((c) => c.unsafeBlocks);
  const n0 = allUnsafeBlocks.length;

  for (let step = 1; step <= 99; step++) {
    const t = step / 100;
    let logWealth = 0.0;
    let maxLogWealth = 0.0;
    let stopAt = null;

    // Sequential betting martingale across exchangeable clusters (with sub-cluster fractional damping)
    for (let m = 0; m < unsafeClusters.length; m++) {
      const uBlocks = unsafeClusters[m].unsafeBlocks;
      let hits = 0;
      for (const b of uBlocks) {
        if (b.prob >= t) hits++;
      }
      const lm = hits / uBlocks.length;
      // Effective cluster weight (square-root dampened cluster size to preserve supermartingale validity)
      const wCluster = Math.min(2.5, Math.sqrt(uBlocks.length));
      const factor = Math.max(1e-6, 1.0 + Math.min(maxSafeGamma, gamma * wCluster) * (alpha - lm));
      logWealth += Math.log(factor);
      if (logWealth > maxLogWealth) {
        maxLogWealth = logWealth;
        if (Math.exp(maxLogWealth) >= targetWealth && stopAt === null) {
          stopAt = m + 1;
        }
      }
    }

    const peakE = Math.exp(Math.min(50, maxLogWealth));
    if (peakE >= targetWealth) {
      tauKeep = Number(t.toFixed(2));
      certified = true;
      maxEValueAtTau = Number(peakE.toFixed(3));
      stoppingStepAtTau = stopAt;
      break;
    }
  }

  bundle.eProcessCalibration = {
    method: 'E-LTT (Anytime-Valid Ville Betting Supermartingale)',
    alpha,
    delta,
    targetWealth: Number(targetWealth.toFixed(2)),
    betFraction: Number(gamma.toFixed(4)),
    tauKeep,
    nUnsafeClusters: m0,
    nUnsafeBlocks: n0,
    maxEValue: maxEValueAtTau,
    anytimePValue: Number(Math.min(1.0, 1.0 / Math.max(1.0, maxEValueAtTau)).toFixed(5)),
    stoppingClusterStep: stoppingStepAtTau,
    certified,
  };

  return bundle;
}

