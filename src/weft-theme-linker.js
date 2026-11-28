/**
 * src/weft-theme-linker.js
 * W6 theme seam runtime (ticket gegearsyah/versieve#46), following the plan of
 * docs/research-notes/2026-11-28-w6-execution-plan.md.
 *
 * loadWeftThemeScorer(options) -> scorer over the committed W5 quantized pair graph
 *   artifact (linkProb + themeSim outputs). Fails closed with typed errors when the
 *   artifact, the onnxruntime-node runtime, or an embedded artifact pin is missing or
 *   mismatched: there is never a fallback similarity score.
 * agglomerateThemeNodes(pairs, policy) -> the pure, canonically ordered theme
 *   agglomeration (order-independent by construction: every sort happens inside).
 * shortlistPairs(chunks, n) -> deterministic lexical-overlap candidate shortlist,
 *   never pairing two chunks of one source item.
 *
 * Zero egress: the only dynamic import is the local onnxruntime-node package; no
 * network I/O happens anywhere on this path.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const THEME_POLICY_VERSION = 'weft-theme-agglomeration-v1';

export const DEFAULT_THEME_POLICY = Object.freeze({
  policyVersion: THEME_POLICY_VERSION,
  joinThreshold: 0.5,
  simFloor: 0.3,
  anchorK: 3,
  shortlistN: 64,
});

const DEFAULT_ARTIFACT_REL = 'models/weft-specialist-quantized/weft-int4.onnx';
const MAX_TOKENS = 128; // training max_length; the pair budget truncates from the longer side
const MAX_CHARS_PER_WORD = 100;
const SCORE_BATCH = 64;

const typedError = (code, message) => {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
};

const sha256Hex = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// ---------------------------------------------------------------------------
// ONNX model metadata, read straight from the protobuf (onnxruntime-node 1.31 does
// not expose metadata_props on its session object; no onnx npm dependency).
// ---------------------------------------------------------------------------

function readVarint(buf, p) {
  let value = 0n, shift = 0n;
  for (;;) {
    const byte = buf[p++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7n;
  }
  return [value, p];
}

// Scans only ModelProto field 14 (metadata_props: StringStringEntryProto key=f1, value=f2)
// and skips over every other top-level field, so an int4 artifact with an embedded
// tokenizer does not cost a full-graph parse.
function readOnnxMetadata(buf, artifactPath) {
  let p = 0;
  const meta = {};
  while (p < buf.length) {
    const [tag, p1] = readVarint(buf, p);
    p = p1;
    const field = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (wireType === 2) {
      const [len, p2] = readVarint(buf, p);
      p = p2;
      const lenNum = Number(len);
      if (field === 14) {
        let q = p;
        const end = p + lenNum;
        let key = null;
        let value = null;
        while (q < end) {
          const [t2, q1] = readVarint(buf, q);
          q = q1;
          const [l2, q2] = readVarint(buf, q);
          q = q2;
          const l2Num = Number(l2);
          if (Number(t2 >> 3n) === 1) key = buf.toString('utf8', q, q + l2Num);
          else if (Number(t2 >> 3n) === 2) value = buf.subarray(q, q + l2Num);
          q += l2Num;
        }
        if (key !== null) meta[key] = value === null ? null : value.toString('utf8');
      }
      p += lenNum;
    } else if (wireType === 0) {
      p = readVarint(buf, p)[1];
    } else if (wireType === 5) {
      p += 4;
    } else if (wireType === 1) {
      p += 8;
    } else {
      throw typedError('WEFT_THEME_ARTIFACT_MALFORMED', `cannot parse protobuf wire type ${wireType} in ${artifactPath}`);
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Pure-JS BertTokenizer (WordPiece). Vocab and special tokens come from the
// tokenizer JSON embedded in the artifact; nothing ships outside the artifact.
// ---------------------------------------------------------------------------

const PUNCT_CLASS = '\\p{P}!-/:-@[-' + String.fromCharCode(0x60) + '{-~';
const PUNCT_SPLIT_RX = new RegExp('([' + PUNCT_CLASS + '])', 'u');
const CJK_RX = /[\u1100-\u11FF\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/;

function basicNormalize(text) {
  // BERT basic tokenizer: drop control/zero-width characters, space-pad CJK,
  // strip accents (lowercase implies strip), lowercase, then punctuate-split.
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code < 32 && ch !== '\t' && ch !== '\n' && ch !== '\r') continue;
    if (code >= 127 && code <= 159) continue;
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfffb || code === 0xfffc || code === 0xfffd) continue;
    out += CJK_RX.test(ch) ? ' ' + ch + ' ' : ch;
  }
  out = out.normalize('NFD').replace(/\p{M}/gu, '');
  out = out.toLowerCase();
  const result = [];
  for (const word of out.split(/\s+/).filter(Boolean)) {
    for (const sub of word.split(PUNCT_SPLIT_RX)) {
      if (sub) result.push(sub);
    }
  }
  return result;
}

function buildWordPieceTokenizer(tokenizerJson) {
  if (!tokenizerJson || !tokenizerJson.model || tokenizerJson.model.type !== 'WordPiece' || !tokenizerJson.model.vocab) {
    throw typedError('WEFT_THEME_TOKENIZER_UNSUPPORTED', 'the embedded tokenizer JSON is not WordPiece');
  }
  const vocab = tokenizerJson.model.vocab;
  const idOf = (token) => {
    const id = vocab[token];
    return id === undefined ? null : id;
  };
  const clsId = idOf('[CLS]');
  const sepId = idOf('[SEP]');
  const padId = idOf('[PAD]');
  const unkId = idOf(tokenizerJson.model.unk_token || '[UNK]');
  if (clsId === null || sepId === null || padId === null || unkId === null) {
    throw typedError('WEFT_THEME_TOKENIZER_UNSUPPORTED', 'the embedded tokenizer JSON lacks the BERT special tokens');
  }
  const wordPiece = (word) => {
    if (word.length > MAX_CHARS_PER_WORD) return [unkId];
    const pieces = [];
    let at = 0;
    while (at < word.length) {
      let end = word.length;
      let matchId = null;
      while (at < end) {
        let candidate = word.slice(at, end);
        if (at > 0) candidate = '##' + candidate;
        const id = idOf(candidate);
        if (id !== null) {
          matchId = id;
          break;
        }
        end -= 1;
      }
      if (matchId === null) return [unkId];
      pieces.push(matchId);
      at = end;
    }
    return pieces;
  };
  // [CLS] A [SEP] B [SEP] leaves 125 content pieces under the 128 training max_length.
  const encodePair = (textA, textB) => {
    const idsA = [];
    for (const word of basicNormalize(textA)) idsA.push(...wordPiece(word));
    const idsB = [];
    for (const word of basicNormalize(textB)) idsB.push(...wordPiece(word));
    while (idsA.length + idsB.length > MAX_TOKENS - 3) {
      if (idsA.length >= idsB.length) idsA.pop();
      else idsB.pop();
    }
    return { idsA: [clsId, ...idsA, sepId], idsB: [clsId, ...idsB, sepId] };
  };
  return { encodePair, padId, vocabSize: Object.keys(vocab).length };
}

// ---------------------------------------------------------------------------
// Scorer over the committed W5 pair-graph artifact.
// ---------------------------------------------------------------------------

export async function loadWeftThemeScorer(options = {}) {
  const modelPath =
    options.modelPath ||
    process.env.VERSIEVE_WEFT_ONNX_PATH ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', DEFAULT_ARTIFACT_REL);
  if (!fs.existsSync(modelPath)) {
    throw typedError(
      'WEFT_THEME_WEIGHTS_MISSING',
      `local Weft theme pair-graph artifact not found at ${modelPath} (set VERSIEVE_WEFT_ONNX_PATH). Zero remote download enforced.`
    );
  }
  const fileBytes = fs.readFileSync(modelPath);
  const artifactSha256 = sha256Hex(fileBytes);
  if (options.expectedSha256 && options.expectedSha256 !== artifactSha256) {
    throw typedError(
      'WEFT_THEME_ARTIFACT_SHA_MISMATCH',
      `Weft artifact sha-256 mismatch: expected ${options.expectedSha256}, file is ${artifactSha256}`
    );
  }

  const meta = readOnnxMetadata(fileBytes, modelPath);
  if (!meta.tokenizer || !meta.manifest) {
    throw typedError(
      'WEFT_THEME_ARTIFACT_MALFORMED',
      `the Weft artifact carries no embedded tokenizer/manifest metadata: ${modelPath}. Only the int4 level embeds metadata; point at weft-int4.onnx`
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(meta.manifest);
  } catch (err) {
    throw typedError('WEFT_THEME_ARTIFACT_MALFORMED', `the embedded manifest metadata does not decode: ${err.message}`);
  }
  const tokenizerBytes = Buffer.from(meta.tokenizer, 'base64');
  const tokenizerPin = manifest && manifest.sha256 && manifest.sha256.tokenizer;
  if (!tokenizerPin) {
    throw typedError('WEFT_THEME_ARTIFACT_MALFORMED', 'the embedded manifest records no tokenizer sha-256 pin');
  }
  if (sha256Hex(tokenizerBytes) !== tokenizerPin) {
    throw typedError(
      'WEFT_THEME_TOKENIZER_PIN_MISMATCH',
      'the embedded tokenizer bytes do not match the manifest sha-256 pin: the artifact is not the exported, pinned pair graph'
    );
  }

  let ort;
  try {
    ort = await import('onnxruntime-node');
  } catch (err) {
    throw typedError('WEFT_THEME_RUNTIME_MISSING', `install local onnxruntime-node to execute the Weft pair-graph artifact (${err.message})`);
  }
  let session;
  try {
    session = await ort.InferenceSession.create(path.resolve(modelPath), { executionProviders: ['cpu'] });
  } catch (err) {
    throw typedError('WEFT_THEME_RUNTIME_MISSING', `onnxruntime failed to load the Weft artifact (${err.message})`);
  }

  const tokenizer = buildWordPieceTokenizer(JSON.parse(tokenizerBytes.toString('utf8')));

  const scoreOneBatch = async (batchEntries) => {
    const lenA = Math.max(...batchEntries.map((e) => e.idsA.length));
    const lenB = Math.max(...batchEntries.map((e) => e.idsB.length));
    const idsA = new BigInt64Array(batchEntries.length * lenA);
    const maskA = new BigInt64Array(batchEntries.length * lenA);
    const idsB = new BigInt64Array(batchEntries.length * lenB);
    const maskB = new BigInt64Array(batchEntries.length * lenB);
    const fillRow = (ids, mask, row, idList, len) => {
      for (let i = 0; i < len; i++) {
        const has = i < idList.length;
        ids[row * len + i] = has ? BigInt(idList[i]) : BigInt(tokenizer.padId);
        mask[row * len + i] = has ? 1n : 0n;
      }
    };
    batchEntries.forEach((e, row) => {
      fillRow(idsA, maskA, row, e.idsA, lenA);
      fillRow(idsB, maskB, row, e.idsB, lenB);
    });
    let outputs;
    try {
      outputs = await session.run({
        inputIdsA: new ort.Tensor('int64', idsA, [batchEntries.length, lenA]),
        attentionMaskA: new ort.Tensor('int64', maskA, [batchEntries.length, lenA]),
        inputIdsB: new ort.Tensor('int64', idsB, [batchEntries.length, lenB]),
        attentionMaskB: new ort.Tensor('int64', maskB, [batchEntries.length, lenB]),
      });
    } catch (err) {
      throw typedError('WEFT_THEME_INFER_FAILED', `the Weft pair-graph forward failed (${err.message})`);
    }
    return batchEntries.map((_, row) => ({
      linkProb: Number(outputs.linkProb.data[row]),
      themeSim: Number(outputs.themeSim.data[row]),
    }));
  };

  return {
    modelSha256: artifactSha256,
    policyVersion: THEME_POLICY_VERSION,
    vocabSize: tokenizer.vocabSize,
    // pairs: [{ a, b }] of chunk texts; returns [{ linkProb, themeSim }] aligned by index.
    async scorePairs(pairs) {
      const encoded = pairs.map((pair) => tokenizer.encodePair(pair.a, pair.b));
      const scores = [];
      for (let at = 0; at < encoded.length; at += SCORE_BATCH) {
        scores.push(...(await scoreOneBatch(encoded.slice(at, at + SCORE_BATCH))));
      }
      return scores;
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic candidate shortlist (pure): lexical-overlap top-N per chunk,
// never two chunks of one source item.
// ---------------------------------------------------------------------------

const lexicalTerms = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 2)
  );

// chunks: [{ id, source, text, span? }] -> candidate pairs
//   [{ a, b, lexicalOverlap, aText, bText, aSpan, bSpan }] keyed with a < b, deduplicated.
export function shortlistPairs(chunks, n = DEFAULT_THEME_POLICY.shortlistN) {
  const cap = Math.max(0, Math.round(n));
  const items = chunks.map((c) => ({ id: c.id, source: c.source, terms: lexicalTerms(c.text) }));
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const candidates = [];
    for (const other of items) {
      if (other.id === item.id || other.source === item.source) continue;
      if (item.terms.size === 0 || other.terms.size === 0) continue;
      let shared = 0;
      for (const term of item.terms) if (other.terms.has(term)) shared++;
      if (shared === 0) continue;
      const union = item.terms.size + other.terms.size - shared;
      candidates.push({ id: other.id, overlap: shared / union });
    }
    candidates.sort((x, y) => y.overlap - x.overlap || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (const candidate of candidates.slice(0, cap)) {
      const aId = item.id < candidate.id ? item.id : candidate.id;
      const bId = item.id < candidate.id ? candidate.id : item.id;
      const key = aId + '\u0000' + bId;
      if (seen.has(key)) continue;
      seen.add(key);
      const ca = byId.get(aId);
      const cb = byId.get(bId);
      out.push({
        a: aId,
        b: bId,
        lexicalOverlap: Number(candidate.overlap.toFixed(6)),
        aText: ca.text,
        bText: cb.text,
        aSpan: ca.span,
        bSpan: cb.span,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pure theme agglomeration (plan decision 4).
// pairs: [{ a, b, linkProb, themeSim, aSpan?, bSpan? }]
// policy: { policyVersion, joinThreshold, simFloor, anchorK, modelSha256? }
// returns { nodes, joinCount, joinThreshold, simFloor }, each node:
//   { id, members, anchors, evidenceSpans, scoreDistribution, policyVersion, modelSha256? }
// Order-independent by construction: the canonical order sorts inside.
// ---------------------------------------------------------------------------

const medianOf = (values) => {
  const sorted = values.slice().sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function agglomerateThemeNodes(pairs, policy = DEFAULT_THEME_POLICY) {
  const joined = policy || DEFAULT_THEME_POLICY;
  // Canonical order: linkProb descending, then the (a, b) id pair ascending; the sort
  // happens inside the function so permuting the input order cannot change the output.
  const ordered = pairs.slice().sort(
    (x, y) =>
      y.linkProb - x.linkProb ||
      (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
      (x.b < y.b ? -1 : x.b > y.b ? 1 : 0)
  );
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  for (const pair of ordered) {
    for (const endpoint of [pair.a, pair.b]) {
      if (!parent.has(endpoint)) parent.set(endpoint, endpoint);
    }
  }
  const nodeJoins = [];
  for (const pair of ordered) {
    if (pair.linkProb >= joined.joinThreshold && pair.themeSim >= joined.simFloor) {
      const ra = find(pair.a);
      const rb = find(pair.b);
      if (ra !== rb) parent.set(ra, rb);
      nodeJoins.push(pair);
    }
  }
  const membersOf = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    let list = membersOf.get(root);
    if (!list) membersOf.set(root, (list = []));
    list.push(id);
  }
  const nodes = [];
  for (const memberList of membersOf.values()) {
    const members = memberList.slice().sort();
    const inNodePairs = nodeJoins.filter((p) => members.includes(p.a) && members.includes(p.b));
    const linkProbs = inNodePairs.map((p) => p.linkProb);
    const themeSims = inNodePairs.map((p) => p.themeSim);
    const spanSeen = new Set(inNodePairs.map((p) => JSON.stringify([p.a, p.b])));
    const spans = [];
    for (const pair of inNodePairs) {
      for (const span of [pair.aSpan, pair.bSpan]) {
        if (!span) continue;
        const key = JSON.stringify(span);
        if (spanSeen.has(key)) continue;
        spanSeen.add(key);
        spans.push(span);
      }
    }
    nodes.push({
      id: 'theme:' + sha256Hex(members.join('\u0000')).slice(0, 16),
      members,
      anchors: members.slice(0, Math.max(0, Math.round(joined.anchorK))),
      evidenceSpans: spans,
      scoreDistribution: inNodePairs.length
        ? {
            linkProb: { min: Math.min(...linkProbs), median: medianOf(linkProbs), max: Math.max(...linkProbs) },
            themeSim: { min: Math.min(...themeSims), median: medianOf(themeSims), max: Math.max(...themeSims) },
          }
        : null,
      policyVersion: joined.policyVersion,
      ...(joined.modelSha256 ? { modelSha256: joined.modelSha256 } : {}),
    });
  }
  nodes.sort((x, y) => (x.members[0] < y.members[0] ? -1 : 1));
  return { nodes, joinCount: nodeJoins.length, joinThreshold: joined.joinThreshold, simFloor: joined.simFloor };
}
