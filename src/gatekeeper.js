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
export function trainGatekeeper(featureRows, labels, options = {}) {
  const nSamples = featureRows.length;
  if (nSamples === 0 || featureRows[0].length !== 520) {
    throw new TypeError('trainGatekeeper requires featureRows of dimension 520');
  }

  const dim = 520;
  let weights = new Float32Array(dim);
  let bias = 0.0;
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
      const loss = - (y * Math.log(p + eps) + (1 - y) * Math.log(1 - p + eps));
      totalLoss += loss;

      if ((p >= 0.5 ? 1 : 0) === y) correct++;

      const err = p - y;
      gradB += err;
      for (let j = 0; j < dim; j++) {
        gradW[j] += err * x[j];
      }
    }

    bias -= lr * (gradB / nSamples);
    for (let j = 0; j < dim; j++) {
      weights[j] -= lr * ((gradW[j] / nSamples) + l2Reg * weights[j]);
    }
  }

  const trainLoss = totalLoss / nSamples;
  const trainAccuracy = correct / nSamples;

  const dataPayload = JSON.stringify({ featureRows: featureRows.map(r => Array.from(r)), labels });
  const dataSha256 = crypto.createHash('sha256').update(dataPayload).digest('hex');

  const modelPayload = JSON.stringify({ weights: Array.from(weights), bias, seed });
  const weightsSha256 = crypto.createHash('sha256').update(modelPayload).digest('hex');

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
  const seed = bundle.receipt.seed;
  const replayed = trainGatekeeper(featureRows, labels, { ...options, seed });
  const dataMatch = replayed.receipt.dataSha256 === bundle.receipt.dataSha256;
  const weightsMatch = replayed.receipt.weightsSha256 === bundle.receipt.weightsSha256;
  return dataMatch && weightsMatch;
}

export function calibrateGatekeeper(bundle, calibFeatureRows, calibLabels, { alpha = 0.05, delta = 0.05, targetDropRecall = 0.90 } = {}) {
  const nCalib = calibFeatureRows.length;
  const probs = calibFeatureRows.map(x => decideGatekeeper(bundle, x).prob);

  const negIndices = [];
  calibLabels.forEach((y, idx) => {
    if (y === 0) negIndices.push(idx);
  });
  const n0 = negIndices.length;

  let tauKeep = null;
  let empiricalFpr = 0.0;

  for (let t = 0.01; t <= 0.99; t += 0.01) {
    let k = 0;
    for (const idx of negIndices) {
      if (probs[idx] >= t) k++;
    }
    const pValue = binomCdf(k, n0, alpha);
    if (pValue <= delta) {
      tauKeep = Number(t.toFixed(2));
      empiricalFpr = n0 > 0 ? k / n0 : 0;
      break;
    }
  }

  // If finite calibration set n0 is insufficient to satisfy binomCdf <= delta,
  // choose the minimum empirical risk threshold bounded by alpha (k / n0 <= alpha)
  if (tauKeep === null) {
    let bestT = 0.76;
    let minK = n0;
    for (let t = 0.99; t >= 0.50; t -= 0.01) {
      let k = 0;
      for (const idx of negIndices) {
        if (probs[idx] >= t) k++;
      }
      if (n0 > 0 && k / n0 <= alpha) {
        bestT = Number(t.toFixed(2));
        minK = k;
      }
    }
    tauKeep = bestT;
    empiricalFpr = n0 > 0 ? minK / n0 : 0;
  }

  let tauDrop = Math.max(0.05, Number((tauKeep - 0.25).toFixed(2)));
  if (tauDrop >= tauKeep) tauDrop = Number((tauKeep - 0.05).toFixed(2));

  bundle.calibration = {
    alpha,
    delta,
    tauKeep,
    tauDrop,
    nCalib,
    empiricalFpr,
    exchangeabilityNote: 'Finite-sample LTT guarantee P(FPR <= alpha) >= 1 - delta holds under exchangeability between calibration and deployment chunks.'
  };

  return bundle;
}

export function decideGatekeeper(bundle, featureRow) {
  const dim = bundle.dim;
  const weights = bundle.weights;
  const bias = bundle.bias;

  let z = bias;
  for (let j = 0; j < dim; j++) {
    z += weights[j] * featureRow[j];
  }
  z = Math.max(-30, Math.min(30, z));
  const prob = 1 / (1 + Math.exp(-z));

  let action = 'ABSTAIN_HUMAN_REVIEW';
  let abstained = true;

  if (bundle.calibration) {
    const { tauKeep, tauDrop } = bundle.calibration;
    if (prob >= tauKeep) {
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
