#!/usr/bin/env node
/**
 * Local VeRA probe. Runtime is vendor/wasm/verisieve_dl.wasm only.
 * On success writes results/local-vera-probe.json and nothing else.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskValue, scanRecordsForPII } from '../src/clean-and-tokenize.js';
import {
  SAFE_LOOKALIKE_CLINICAL_LINES,
  UNSAFE_CLINICAL_PII_LINES
} from '../src/scale-benchmark.js';
import {
  cosineSimilarityUnitNorm,
  embedNeedleWasm,
  getVerisieveDlInstanceSync
} from '../src/wasm-needle-dl.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM_PATH = path.join(ROOT, 'vendor', 'wasm', 'verisieve_dl.wasm');
const OUT_PATH = path.join(ROOT, 'results', 'local-vera-probe.json');

const DIM = 64;
const D_MODEL = 16;
const N_LAYERS = 2;
const RANK = 4;
const EPOCHS = 25;
const LR = 0.015;
const BACKBONE_SEED = 101;
const EMBED_SEED = 42;
const RERANK_TRAIN_SEED = 42;
const REDACTION_TRAIN_SEED = 43;
const TRAIN_END = 375;
const EVAL_START = 375;
const EVAL_END = 500;
const NEG_CAP = 8;
const SHORTLIST_K = 6;
const SHORTLIST_WIDE = 30;
const THRESHOLD = 0.5;
const COSINE_WEIGHT = 0.55;
const LEXICAL_WEIGHT = 0.45;

const VERA_EXPORTS = [
  'mle_dl_alloc',
  'mle_dl_free',
  'mle_dl_vera_backbone_bytes',
  'mle_dl_vera_scale_count',
  'mle_dl_vera_param_count',
  'mle_dl_vera_init_backbone',
  'mle_dl_vera_init_params',
  'mle_dl_vera_train',
  'mle_dl_vera_loss_grad',
  'mle_dl_vera_predict'
];

const CONTACT_LABELS = new Set(['EMAIL', 'PHONENUMBER', 'CREDITCARDNUMBER', 'IPV4']);
const BARE_NAME_LABELS = new Set(['FIRSTNAME', 'LASTNAME', 'MIDDLENAME']);
const STRUCTURED_LABELS = new Set([
  'EMAIL', 'PHONENUMBER', 'PHONE', 'SSN', 'CREDITCARDNUMBER', 'CREDIT_CARD',
  'IP', 'IPV4', 'IPV6', 'DATE', 'DOB', 'TIME', 'URL', 'IBAN', 'MAC', 'BIC',
  'BITCOINADDRESS', 'ETHEREUMADDRESS', 'LITECOINADDRESS', 'PIN', 'PHONEIMEI',
  'VEHICLEVIN', 'VEHICLEVRM', 'MASKEDNUMBER', 'ACCOUNTNUMBER', 'ZIPCODE'
]);
const GROUP_NAMES = ['contact', 'bareNames', 'structured26'];

const utf8 = new TextEncoder();

function fnv1a(text) {
  let hash = 2166136261 >>> 0;
  const bytes = utf8.encode(text);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function writeJson(payload) {
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function runVeraWasmSession({
  exp,
  xTrain,
  yTrain,
  nTrain,
  xVal,
  yVal,
  nVal,
  xPredict = null,
  nPredict = 0,
  dim = 64,
  dModel = 16,
  nLayers = 2,
  rank = 4,
  epochs = 25,
  lr = 0.015,
  backboneSeed = 101,
  trainSeed = 42,
}) {
  const vbBytes = exp.mle_dl_vera_backbone_bytes(dim, dModel, nLayers);
  const vsCnt = exp.mle_dl_vera_scale_count(nLayers);
  const vpCnt = exp.mle_dl_vera_param_count(dModel, nLayers, rank, 1);

  const xPtr = exp.mle_dl_alloc(xTrain.byteLength);
  const yPtr = exp.mle_dl_alloc(yTrain.byteLength);
  const xValPtr = exp.mle_dl_alloc(xVal.byteLength);
  const yValPtr = exp.mle_dl_alloc(yVal.byteLength);
  const vbPtr = exp.mle_dl_alloc(vbBytes);
  const vsPtr = exp.mle_dl_alloc(vsCnt * 4);
  const vpPtr = exp.mle_dl_alloc(vpCnt * 4);
  const vgPtr = exp.mle_dl_alloc(vpCnt * 4);
  const xPredPtr = nPredict > 0 && xPredict ? exp.mle_dl_alloc(xPredict.byteLength) : 0;
  const outPredPtr = nPredict > 0 && xPredict ? exp.mle_dl_alloc(nPredict * 4) : 0;

  try {
    new Float32Array(exp.memory.buffer).set(xTrain, xPtr / 4);
    new Float32Array(exp.memory.buffer).set(yTrain, yPtr / 4);
    new Float32Array(exp.memory.buffer).set(xVal, xValPtr / 4);
    new Float32Array(exp.memory.buffer).set(yVal, yValPtr / 4);
    if (xPredPtr && xPredict) {
      new Float32Array(exp.memory.buffer).set(xPredict, xPredPtr / 4);
    }

    exp.mle_dl_vera_init_backbone(vbPtr, vsPtr, dim, dModel, nLayers, backboneSeed);
    exp.mle_dl_vera_init_params(vpPtr, dModel, nLayers, rank, 1, trainSeed);

    const lossHistory = [];
    const batchSize = Math.max(1, Math.min(nTrain, 16));
    for (let ep = 1; ep <= epochs; ep++) {
      const epLoss = exp.mle_dl_vera_train(
        xPtr,
        yPtr,
        vbPtr,
        vsPtr,
        vpPtr,
        nTrain,
        dim,
        dModel,
        nLayers,
        rank,
        0,
        1,
        1,
        batchSize,
        lr,
        1e-4,
        backboneSeed,
        trainSeed + ep - 1
      );
      lossHistory.push(Number(epLoss.toFixed(4)));
    }

    const valLoss = exp.mle_dl_vera_loss_grad(
      xValPtr,
      yValPtr,
      vbPtr,
      vsPtr,
      vpPtr,
      vgPtr,
      nVal,
      dim,
      dModel,
      nLayers,
      rank,
      0,
      1,
      backboneSeed
    );

    let predictions = null;
    if (xPredPtr && outPredPtr) {
      exp.mle_dl_vera_predict(
        xPredPtr,
        vbPtr,
        vsPtr,
        vpPtr,
        outPredPtr,
        nPredict,
        dim,
        dModel,
        nLayers,
        rank,
        0,
        1,
        backboneSeed
      );
      predictions = Array.from(new Float32Array(exp.memory.buffer, outPredPtr, nPredict));
    }

    return { lossHistory, valLoss, predictions };
  } finally {
    exp.mle_dl_free(xPtr, xTrain.byteLength);
    exp.mle_dl_free(yPtr, yTrain.byteLength);
    exp.mle_dl_free(xValPtr, xVal.byteLength);
    exp.mle_dl_free(yValPtr, yVal.byteLength);
    exp.mle_dl_free(vbPtr, vbBytes);
    exp.mle_dl_free(vsPtr, vsCnt * 4);
    exp.mle_dl_free(vpPtr, vpCnt * 4);
    exp.mle_dl_free(vgPtr, vpCnt * 4);
    if (xPredPtr && xPredict) exp.mle_dl_free(xPredPtr, xPredict.byteLength);
    if (outPredPtr && nPredict > 0) exp.mle_dl_free(outPredPtr, nPredict * 4);
  }
}

function vsScrub(t) {
  let out = t;
  for (const h of [...scanRecordsForPII(t)].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, h.start) + maskValue(h.value, h.type, 'token') + out.slice(h.end);
  }
  return out;
}

function pubmedExample(record, idx) {
  const ctxStr = Array.isArray(record.context?.contexts)
    ? record.context.contexts.join(' ')
    : (typeof record.context === 'string' ? record.context : '');
  const bodyText = `${ctxStr} ${record.long_answer || ''}`.trim();
  const question = record.question || '';
  let text = `${question}\n${bodyText}`.trim();
  if (idx % 4 === 0) {
    text = `${text}\n${UNSAFE_CLINICAL_PII_LINES[idx % UNSAFE_CLINICAL_PII_LINES.length]}`;
  } else if (idx % 4 === 1) {
    text = `${text}\n${SAFE_LOOKALIKE_CLINICAL_LINES[idx % SAFE_LOOKALIKE_CLINICAL_LINES.length]}`;
  }
  const query = question.length > 0 ? question : text.slice(0, 120);
  const passage = vsScrub(bodyText || text);
  return { query, passage };
}

function queryTokens(raw) {
  const matches = String(raw).toLowerCase().match(/\b[a-z0-9]{2,}\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

function lexicalScore(tokens, maskedPassage) {
  if (tokens.length === 0) return 0;
  const hay = maskedPassage.toLowerCase();
  let hit = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) hit++;
  }
  return hit / tokens.length;
}

function hybridOrder(qEmb, tokens, pEmbs, passages) {
  const scores = new Array(pEmbs.length);
  for (let j = 0; j < pEmbs.length; j++) {
    const cosine = cosineSimilarityUnitNorm(qEmb, pEmbs[j]);
    const lexical = lexicalScore(tokens, passages[j]);
    scores[j] = COSINE_WEIGHT * cosine + LEXICAL_WEIGHT * lexical;
  }
  const order = scores.map((_, j) => j);
  order.sort((a, b) => (scores[b] - scores[a]) || (a - b));
  return order;
}

function hitsWithin(orders, k) {
  let hits = 0;
  for (let i = 0; i < orders.length; i++) {
    const limit = Math.min(k, orders[i].length);
    for (let r = 0; r < limit; r++) {
      if (orders[i][r] === i) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

function hitRate(hits, total) {
  return {
    hits,
    pct: total > 0 ? Number(((hits / total) * 100).toFixed(1)) : 0
  };
}

function countRate(hits, total) {
  return {
    hits,
    total,
    pct: total > 0 ? Number(((hits / total) * 100).toFixed(1)) : 0
  };
}

function precisionRate(hits, spanCount) {
  if (spanCount === 0) return { hits: 0, total: 0, pct: 0 };
  return countRate(hits, spanCount);
}

function writePair(dest, row, qEmb, pEmb) {
  const base = row * DIM;
  for (let k = 0; k < DIM; k++) dest[base + k] = qEmb[k] * pEmb[k];
}

function packPairs(pairs, qEmbs, pEmbs) {
  const n = pairs.length;
  const x = new Float32Array(n * DIM);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    writePair(x, i, qEmbs[pairs[i].qi], pEmbs[pairs[i].pi]);
    y[i] = pairs[i].y;
  }
  return { x, y, n };
}

function polarityOf(scores, labels) {
  let posSum = 0;
  let posN = 0;
  let negSum = 0;
  let negN = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 1) {
      posSum += scores[i];
      posN++;
    } else if (labels[i] === 0) {
      negSum += scores[i];
      negN++;
    }
  }
  if (posN === 0 || negN === 0) return 'higher_is_positive';
  return (posSum / posN) < (negSum / negN) ? 'lower_is_positive' : 'higher_is_positive';
}

function positiveScore(score, polarity) {
  return polarity === 'lower_is_positive' ? (1 - score) : score;
}

function headHitsAfterReorder(orders, scoreRows, shortlist, take, polarity) {
  let hits = 0;
  for (let i = 0; i < orders.length; i++) {
    const ranked = [];
    const limit = Math.min(shortlist, orders[i].length);
    for (let r = 0; r < limit; r++) {
      ranked.push({
        pi: orders[i][r],
        hybridRank: r,
        score: scoreRows[i][r]
      });
    }
    ranked.sort((a, b) => {
      if (a.score !== b.score) {
        return polarity === 'lower_is_positive' ? a.score - b.score : b.score - a.score;
      }
      return a.hybridRank - b.hybridRank;
    });
    const kept = Math.min(take, ranked.length);
    for (let r = 0; r < kept; r++) {
      if (ranked[r].pi === i) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

function valuesMatch(candidateValue, maskValueText) {
  const v = String(candidateValue || '').toLowerCase();
  const m = String(maskValueText || '').toLowerCase();
  if (!v || !m) return false;
  return v === m || v.includes(m) || m.includes(v);
}

function groupsFor(label) {
  const groups = [];
  if (CONTACT_LABELS.has(label)) groups.push('contact');
  if (BARE_NAME_LABELS.has(label)) groups.push('bareNames');
  if (STRUCTURED_LABELS.has(label)) groups.push('structured26');
  return groups;
}

function emptyGroupCounts() {
  return {
    contact: { hits: 0, total: 0 },
    bareNames: { hits: 0, total: 0 },
    structured26: { hits: 0, total: 0 }
  };
}

function recallByGroup(docs, field) {
  const counts = emptyGroupCounts();
  for (const doc of docs) {
    const spans = doc[field];
    for (const mask of doc.masks) {
      const groups = groupsFor(String(mask.label || '').toUpperCase());
      if (groups.length === 0) continue;
      const detected = spans.some((span) => valuesMatch(span.value, mask.value));
      for (const name of groups) {
        counts[name].total++;
        if (detected) counts[name].hits++;
      }
    }
  }
  return counts;
}

function precisionHitsByGroup(docs, field) {
  const hits = { contact: 0, bareNames: 0, structured26: 0 };
  let spanCount = 0;
  for (const doc of docs) {
    const spans = doc[field];
    spanCount += spans.length;
    for (const span of spans) {
      const matched = { contact: false, bareNames: false, structured26: false };
      for (const mask of doc.masks) {
        if (!valuesMatch(span.value, mask.value)) continue;
        for (const name of groupsFor(String(mask.label || '').toUpperCase())) {
          matched[name] = true;
        }
      }
      for (const name of GROUP_NAMES) {
        if (matched[name]) hits[name]++;
      }
    }
  }
  return { hits, spanCount };
}

function asciiCounts(text) {
  let digits = 0;
  let letters = 0;
  let uppers = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) digits++;
    else if (c >= 65 && c <= 90) {
      letters++;
      uppers++;
    } else if (c >= 97 && c <= 122) letters++;
  }
  return { digits, letters, uppers, n: text.length };
}

function unitFraction(count, total) {
  if (total <= 0) return 0;
  const value = count / total;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function redactionVector(source, cand) {
  const vec = new Float32Array(DIM);
  const value = cand.value || '';
  const lower = value.toLowerCase();
  if (lower.length >= 3) {
    for (let i = 0; i + 3 <= lower.length; i++) {
      vec[fnv1a(lower.slice(i, i + 3)) % 32] += 1;
    }
    let norm = 0;
    for (let i = 0; i < 32; i++) norm += vec[i] * vec[i];
    if (norm > 0) {
      const inv = 1 / Math.sqrt(norm);
      for (let i = 0; i < 32; i++) vec[i] *= inv;
    }
  }
  const span = asciiCounts(value);
  const before = asciiCounts(source.slice(Math.max(0, cand.start - 40), cand.start));
  const after = asciiCounts(source.slice(cand.end, cand.end + 40));
  const spanLen = cand.end - cand.start;
  const shaped = [
    spanLen / 64,
    unitFraction(span.digits, span.n),
    unitFraction(span.letters, span.n),
    value.includes('@') ? 1 : 0,
    unitFraction(span.uppers, span.n),
    unitFraction(before.digits, before.n),
    unitFraction(after.digits, after.n),
    unitFraction(before.letters, before.n),
    unitFraction(after.letters, after.n),
    cand.type === 'name_likely' ? 1 : 0
  ];
  for (let i = 0; i < shaped.length; i++) {
    const value01 = shaped[i];
    vec[32 + i] = value01 < 0 ? 0 : (value01 > 1 ? 1 : value01);
  }
  vec[42 + (fnv1a(String(cand.type || '')) % 8)] += 1;
  return vec;
}

function packVectors(rows, vectorAt) {
  const n = rows.length;
  const x = new Float32Array(n * DIM);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x.set(vectorAt(rows[i]), i * DIM);
    y[i] = rows[i].y;
  }
  return { x, y, n };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function loadAi4Docs() {
  const filePath = path.join(ROOT, 'results', 'untrusted-benchmarks', 'ai4privacy-500.json');
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return rows.map((row) => {
    const source = row.source_text || '';
    const masks = Array.isArray(row.privacy_mask) ? row.privacy_mask : [];
    const cands = scanRecordsForPII(source).map((cand, ord) => ({
      value: cand.value,
      start: cand.start,
      end: cand.end,
      type: cand.type,
      ord,
      y: masks.some((mask) => valuesMatch(cand.value, mask.value)) ? 1 : 0
    }));
    return { source, masks, cands, kept: [] };
  });
}

function main() {
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const wasmSha256 = crypto.createHash('sha256').update(wasmBytes).digest('hex');
  const inst = getVerisieveDlInstanceSync(WASM_PATH);
  const exp = inst.exports;
  for (const name of VERA_EXPORTS) {
    if (typeof exp[name] !== 'function') {
      writeJson({
        missingKernelExport: name,
        checkpointLoaded: false,
        downloadedWeights: false,
        reason: `${name} is absent from the wasm instance`
      });
      process.exit(0);
    }
  }

  const ai4Docs = loadAi4Docs();
  const regexAll = recallByGroup(ai4Docs, 'cands');
  const expected = {
    contact: [110, 140],
    bareNames: [118, 238],
    structured26: [180, 580]
  };
  const selfCheckOk = GROUP_NAMES.every((name) => {
    return regexAll[name].hits === expected[name][0] && regexAll[name].total === expected[name][1];
  });
  if (!selfCheckOk) {
    console.log(`${regexAll.contact.hits}/${regexAll.contact.total} ${regexAll.bareNames.hits}/${regexAll.bareNames.total} ${regexAll.structured26.hits}/${regexAll.structured26.total}`);
    process.exit(1);
  }

  const pubmedPath = path.join(ROOT, 'results', 'untrusted-benchmarks', 'pubmedqa-500.json');
  const pubmedRecords = JSON.parse(fs.readFileSync(pubmedPath, 'utf8'));
  const pubmed = pubmedRecords.map((record, idx) => pubmedExample(record, idx));
  const trainDocs = pubmed.slice(0, TRAIN_END);
  const evalDocs = pubmed.slice(EVAL_START, EVAL_END);
  const embedOpts = { dim: DIM, seed: EMBED_SEED, wasmPath: WASM_PATH };
  const trainQ = embedNeedleWasm(trainDocs.map((doc) => doc.query), embedOpts);
  const trainP = embedNeedleWasm(trainDocs.map((doc) => doc.passage), embedOpts);
  const evalQ = embedNeedleWasm(evalDocs.map((doc) => doc.query), embedOpts);
  const evalP = embedNeedleWasm(evalDocs.map((doc) => doc.passage), embedOpts);
  const trainTokens = trainDocs.map((doc) => queryTokens(doc.query));
  const evalTokens = evalDocs.map((doc) => queryTokens(doc.query));
  const trainPassages = trainDocs.map((doc) => doc.passage);
  const evalPassages = evalDocs.map((doc) => doc.passage);

  const trainOrders = trainQ.map((qEmb, qi) => hybridOrder(qEmb, trainTokens[qi], trainP, trainPassages));
  const evalOrders = evalQ.map((qEmb, qi) => hybridOrder(qEmb, evalTokens[qi], evalP, evalPassages));
  const blendTop6 = hitsWithin(evalOrders, SHORTLIST_K);
  if (blendTop6 !== 121) {
    console.log(blendTop6);
    process.exit(1);
  }

  const rerankPairs = [];
  for (let qi = 0; qi < trainOrders.length; qi++) {
    rerankPairs.push({ qi, pi: qi, y: 1 });
    let negatives = 0;
    const top = trainOrders[qi];
    const limit = Math.min(SHORTLIST_WIDE, top.length);
    for (let r = 0; r < limit && negatives < NEG_CAP; r++) {
      if (top[r] === qi) continue;
      rerankPairs.push({ qi, pi: top[r], y: 0 });
      negatives++;
    }
  }
  const rerankTrain = [];
  const rerankVal = [];
  for (let i = 0; i < rerankPairs.length; i++) {
    if (i % 5 === 4) rerankVal.push(rerankPairs[i]);
    else rerankTrain.push(rerankPairs[i]);
  }
  const packedTrain = packPairs(rerankTrain, trainQ, trainP);
  const packedVal = packPairs(rerankVal, trainQ, trainP);
  const evalPredictRows = evalOrders.length * SHORTLIST_WIDE;
  const xPredict = new Float32Array((packedVal.n + evalPredictRows) * DIM);
  xPredict.set(packedVal.x, 0);
  let predictRow = packedVal.n;
  for (let qi = 0; qi < evalOrders.length; qi++) {
    const order = evalOrders[qi];
    for (let r = 0; r < SHORTLIST_WIDE; r++) {
      writePair(xPredict, predictRow, evalQ[qi], evalP[order[r]]);
      predictRow++;
    }
  }

  const rerankSession = runVeraWasmSession({
    exp,
    xTrain: packedTrain.x,
    yTrain: packedTrain.y,
    nTrain: packedTrain.n,
    xVal: packedVal.x,
    yVal: packedVal.y,
    nVal: packedVal.n,
    xPredict,
    nPredict: packedVal.n + evalPredictRows,
    dim: DIM,
    dModel: D_MODEL,
    nLayers: N_LAYERS,
    rank: RANK,
    epochs: EPOCHS,
    lr: LR,
    backboneSeed: BACKBONE_SEED,
    trainSeed: RERANK_TRAIN_SEED
  });
  const rerankScores = rerankSession.predictions;
  const rerankPolarity = polarityOf(rerankScores.slice(0, packedVal.n), packedVal.y);
  const evalScoreRows = [];
  for (let qi = 0; qi < evalOrders.length; qi++) {
    const rowScores = new Array(SHORTLIST_WIDE);
    for (let r = 0; r < SHORTLIST_WIDE; r++) {
      rowScores[r] = rerankScores[packedVal.n + qi * SHORTLIST_WIDE + r];
    }
    evalScoreRows.push(rowScores);
  }
  const evalTotal = evalOrders.length;
  const blendAt1 = hitsWithin(evalOrders, 1);
  const headTop6 = headHitsAfterReorder(evalOrders, evalScoreRows, SHORTLIST_K, SHORTLIST_K, rerankPolarity);
  const headAt1 = headHitsAfterReorder(evalOrders, evalScoreRows, SHORTLIST_K, 1, rerankPolarity);
  const blendTop30 = hitsWithin(evalOrders, SHORTLIST_WIDE);
  const headFrom30 = headHitsAfterReorder(evalOrders, evalScoreRows, SHORTLIST_WIDE, SHORTLIST_K, rerankPolarity);

  const trainAi = ai4Docs.slice(0, 250);
  const testAi = ai4Docs.slice(250, 500);
  const redactionCands = [];
  for (const doc of trainAi) {
    for (const cand of doc.cands) redactionCands.push({ doc, cand, y: cand.y });
  }
  const redactionTrain = [];
  const redactionVal = [];
  for (let i = 0; i < redactionCands.length; i++) {
    if (i % 5 === 4) redactionVal.push(redactionCands[i]);
    else redactionTrain.push(redactionCands[i]);
  }
  const vectorOf = (row) => redactionVector(row.doc.source, row.cand);
  const redTrainPacked = packVectors(redactionTrain, vectorOf);
  const redValPacked = packVectors(redactionVal, vectorOf);
  const testCands = [];
  for (const doc of testAi) {
    for (const cand of doc.cands) testCands.push({ doc, cand });
  }
  const xRedPredict = new Float32Array((redValPacked.n + testCands.length) * DIM);
  xRedPredict.set(redValPacked.x, 0);
  for (let i = 0; i < testCands.length; i++) {
    xRedPredict.set(redactionVector(testCands[i].doc.source, testCands[i].cand), (redValPacked.n + i) * DIM);
  }
  const redactionSession = runVeraWasmSession({
    exp,
    xTrain: redTrainPacked.x,
    yTrain: redTrainPacked.y,
    nTrain: redTrainPacked.n,
    xVal: redValPacked.x,
    yVal: redValPacked.y,
    nVal: redValPacked.n,
    xPredict: xRedPredict,
    nPredict: redValPacked.n + testCands.length,
    dim: DIM,
    dModel: D_MODEL,
    nLayers: N_LAYERS,
    rank: RANK,
    epochs: EPOCHS,
    lr: LR,
    backboneSeed: BACKBONE_SEED,
    trainSeed: REDACTION_TRAIN_SEED
  });
  const redScores = redactionSession.predictions;
  const redactionPolarity = polarityOf(redScores.slice(0, redValPacked.n), redValPacked.y);
  for (let i = 0; i < testCands.length; i++) {
    const raw = redScores[redValPacked.n + i];
    testCands[i].cand.posScore = positiveScore(raw, redactionPolarity);
  }
  for (const doc of testAi) {
    const passing = doc.cands.filter((cand) => cand.posScore > THRESHOLD);
    passing.sort((a, b) => (b.posScore - a.posScore) || (a.start - b.start) || (a.ord - b.ord));
    const kept = [];
    for (const cand of passing) {
      if (kept.some((prior) => overlaps(prior, cand))) continue;
      kept.push(cand);
    }
    doc.kept = kept;
  }

  const testRegexRecall = recallByGroup(testAi, 'cands');
  const testHeadRecall = recallByGroup(testAi, 'kept');
  const testRegexPrecision = precisionHitsByGroup(testAi, 'cands');
  const testHeadPrecision = precisionHitsByGroup(testAi, 'kept');

  function categoryReport(name) {
    return {
      regexRecall: countRate(testRegexRecall[name].hits, testRegexRecall[name].total),
      headRecall: countRate(testHeadRecall[name].hits, testHeadRecall[name].total),
      regexPrecisionProxy: precisionRate(testRegexPrecision.hits[name], testRegexPrecision.spanCount),
      headPrecisionProxy: precisionRate(testHeadPrecision.hits[name], testHeadPrecision.spanCount)
    };
  }

  const report = {
    wasmSha256,
    checkpointLoaded: false,
    downloadedWeights: false,
    dim: DIM,
    dModel: D_MODEL,
    nLayers: N_LAYERS,
    rank: RANK,
    epochs: EPOCHS,
    lr: LR,
    backboneSeed: BACKBONE_SEED,
    pairVector: 'elementwise_product_of_unit_needle_embeddings',
    rerank: {
      trainSeed: RERANK_TRAIN_SEED,
      trainQuestions: trainDocs.length,
      evalQuestions: evalDocs.length,
      evalSlice: [EVAL_START, EVAL_END],
      negativesPerQuestionCap: NEG_CAP,
      polarity: rerankPolarity,
      lastEpochLoss: rerankSession.lossHistory[rerankSession.lossHistory.length - 1],
      valLoss: Number(rerankSession.valLoss.toFixed(4)),
      blendGoldInTop6: hitRate(blendTop6, evalTotal),
      shortlist6: {
        headGoldInTop6: hitRate(headTop6, evalTotal),
        blendGoldAt1: hitRate(blendAt1, evalTotal),
        headGoldAt1: hitRate(headAt1, evalTotal)
      },
      shortlist30: {
        goldInsideBlendTop30: hitRate(blendTop30, evalTotal),
        headGoldInTop6: hitRate(headFrom30, evalTotal)
      }
    },
    redaction: {
      trainSeed: REDACTION_TRAIN_SEED,
      trainDocs: 250,
      testDocs: 250,
      threshold: THRESHOLD,
      polarity: redactionPolarity,
      lastEpochLoss: redactionSession.lossHistory[redactionSession.lossHistory.length - 1],
      valLoss: Number(redactionSession.valLoss.toFixed(4)),
      regexAll500: {
        contact: countRate(regexAll.contact.hits, regexAll.contact.total),
        bareNames: countRate(regexAll.bareNames.hits, regexAll.bareNames.total),
        structured26: countRate(regexAll.structured26.hits, regexAll.structured26.total)
      },
      test250: {
        contact: categoryReport('contact'),
        bareNames: categoryReport('bareNames'),
        structured26: categoryReport('structured26')
      }
    }
  };
  writeJson(report);
}

main();
