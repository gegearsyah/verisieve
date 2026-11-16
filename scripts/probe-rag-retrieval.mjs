#!/usr/bin/env node
/**
 * Rank the needle's 125 held-out PubMedQA questions three ways:
 * cosine, lexical, and 0.55/0.45 hybrid on verisieve-masked bodies.
 * Cosine recall must match the published needle figures before any JSON is written.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRecordsForPII, maskValue } from '../src/clean-and-tokenize.js';
import { embedNeedleWasm, cosineSimilarityUnitNorm } from '../src/wasm-needle-dl.js';
import {
  UNSAFE_CLINICAL_PII_LINES,
  SAFE_LOOKALIKE_CLINICAL_LINES
} from '../src/scale-benchmark.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = 125;
const SLICE_START = 375;
const SLICE_END = 500;
const DIM = 64;
const SEED = 42;
const COSINE_WEIGHT = 0.55;
const LEXICAL_WEIGHT = 0.45;

function vsScrub(t) {
  let out = t;
  for (const h of [...scanRecordsForPII(t)].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, h.start) + maskValue(h.value, h.type, 'token') + out.slice(h.end);
  }
  return out;
}

function documentText(question, bodyText, idx) {
  const rawAbstract = `${question}\n${bodyText}`.trim();
  let text = rawAbstract;
  const isUnsafe = (idx % 4 === 0);
  const isHardLookalikeSafe = (idx % 4 === 1);
  if (isUnsafe) {
    text = `${text}\n${UNSAFE_CLINICAL_PII_LINES[idx % UNSAFE_CLINICAL_PII_LINES.length]}`;
  } else if (isHardLookalikeSafe) {
    text = `${text}\n${SAFE_LOOKALIKE_CLINICAL_LINES[idx % SAFE_LOOKALIKE_CLINICAL_LINES.length]}`;
  }
  return text;
}

function queryTokens(rawQuestion) {
  const matches = String(rawQuestion).toLowerCase().match(/\b[a-z0-9]{2,}\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

function lexicalScore(tokens, maskedChunk) {
  if (tokens.length === 0) return 0;
  const hay = maskedChunk.toLowerCase();
  let hit = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) hit++;
  }
  return hit / tokens.length;
}

function rankDesc(scores) {
  const order = scores.map((_, j) => j);
  order.sort((a, b) => (scores[b] - scores[a]) || (a - b));
  return order;
}

function hitsAt(order, gold, k) {
  for (let r = 0; r < k; r++) {
    if (order[r] === gold) return 1;
  }
  return 0;
}

function recall(hits) {
  return {
    hits,
    pct: Number(((hits / N) * 100).toFixed(1))
  };
}

function floorShare(count) {
  return {
    count,
    pct: Number(((count / N) * 100).toFixed(1))
  };
}

const pubmedPath = path.join(ROOT, 'results', 'untrusted-benchmarks', 'pubmedqa-500.json');
const records = JSON.parse(fs.readFileSync(pubmedPath, 'utf8'));
const heldOut = records.slice(SLICE_START, SLICE_END);

const rawQuestions = [];
const maskedBodies = [];
for (let offset = 0; offset < heldOut.length; offset++) {
  const idx = SLICE_START + offset;
  const r = heldOut[offset];
  const ctxStr = Array.isArray(r.context?.contexts)
    ? r.context.contexts.join(' ')
    : (typeof r.context === 'string' ? r.context : '');
  const bodyText = `${ctxStr} ${r.long_answer || ''}`.trim();
  const question = r.question || '';
  const text = documentText(question, bodyText, idx);
  rawQuestions.push(question || text.slice(0, 120));
  maskedBodies.push(vsScrub(bodyText || text));
}

const qEmbeds = embedNeedleWasm(rawQuestions, { dim: DIM, seed: SEED });
const cEmbeds = embedNeedleWasm(maskedBodies, { dim: DIM, seed: SEED });
const tokenLists = rawQuestions.map(queryTokens);

let cos1 = 0;
let cos5 = 0;
let lex1 = 0;
let lex5 = 0;
let hyb1 = 0;
let hyb5 = 0;
let hyb6 = 0;
let below15 = 0;
let below30 = 0;

for (let i = 0; i < heldOut.length; i++) {
  const cos = new Array(heldOut.length);
  const lex = new Array(heldOut.length);
  const hyb = new Array(heldOut.length);
  const tokens = tokenLists[i];
  for (let j = 0; j < heldOut.length; j++) {
    cos[j] = cosineSimilarityUnitNorm(qEmbeds[i], cEmbeds[j]);
    lex[j] = lexicalScore(tokens, maskedBodies[j]);
    hyb[j] = COSINE_WEIGHT * cos[j] + LEXICAL_WEIGHT * lex[j];
  }
  const cosOrder = rankDesc(cos);
  const lexOrder = rankDesc(lex);
  const hybOrder = rankDesc(hyb);
  cos1 += hitsAt(cosOrder, i, 1);
  cos5 += hitsAt(cosOrder, i, 5);
  lex1 += hitsAt(lexOrder, i, 1);
  lex5 += hitsAt(lexOrder, i, 5);
  hyb1 += hitsAt(hybOrder, i, 1);
  hyb5 += hitsAt(hybOrder, i, 5);
  hyb6 += hitsAt(hybOrder, i, 6);
  const best = hyb[hybOrder[0]];
  if (best < 0.15) below15++;
  if (best < 0.30) below30++;
}

const cosineRecallAt1 = recall(cos1);
const cosineRecallAt5 = recall(cos5);
if (cosineRecallAt1.pct !== 31.2 || cosineRecallAt5.pct !== 60) {
  console.log(cosineRecallAt1.pct);
  console.log(cosineRecallAt5.pct);
  process.exit(1);
}

const report = {
  task: "sandbox ranker on the needle's 125 held-out PubMedQA questions",
  text: 'verisieve_masked_body',
  dim: DIM,
  seed: SEED,
  candidateCount: N,
  slice: [SLICE_START, SLICE_END],
  rankers: {
    cosine: {
      queriesTested: N,
      recallAt1: cosineRecallAt1,
      recallAt5: cosineRecallAt5
    },
    lexical: {
      queriesTested: N,
      recallAt1: recall(lex1),
      recallAt5: recall(lex5)
    },
    hybrid_055_045: {
      queriesTested: N,
      cosineWeight: COSINE_WEIGHT,
      lexicalWeight: LEXICAL_WEIGHT,
      recallAt1: recall(hyb1),
      recallAt5: recall(hyb5),
      recallAt6: recall(hyb6),
      bestScoreBelow0_15: floorShare(below15),
      bestScoreBelow0_30: floorShare(below30)
    }
  }
};

const outPath = path.join(ROOT, 'results', 'rag-retrieval-probe.json');
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
