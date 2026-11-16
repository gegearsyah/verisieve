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
