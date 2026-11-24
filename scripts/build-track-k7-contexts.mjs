#!/usr/bin/env node
/**
 * scripts/build-track-k7-contexts.mjs: Stage K7, a deterministic BM25 retrieval control.
 *
 * Purpose: a plain lexical control for the K3 graph-PPR retrieval arm. Same 60 questions,
 * same estate bytes, same top-6 rendering, but the ranking is classic BM25 over text only.
 *
 * Candidate pool reconstruction (honest record):
 * The K3 arm ranked passages produced by the track-C perception path, then mapped each
 * ranked passage back to raw estate text by passage lineIndex. That pool is engine-derived:
 * it is the parser's block segmentation, not a plain byte window. This script does NOT import
 * src/, so the segmentation rules are reimplemented here from the raw files:
 *   .txt / .csv          one passage per document, the whole file trimmed (the router falls
 *                        through to a single PROSE block for these extensions).
 *   .sql                 one passage per document, whole file trimmed, breadcrumb
 *                        "<source> > Raw Config" (the config/secret parser shape).
 *   .vtt                 one passage per cue, text is "<speaker>: <cue body>" with timestamps
 *                        removed, breadcrumb "<source> > <start>–<end> > <speaker>".
 *   .eml                 one HEADERS passage (FROM/TO/CC/BCC/REPLY-TO/SUBJECT/DATE in that
 *                        order) plus one passage per visible body paragraph, after the reply
 *                        chain and signature stripper (a "From:" line followed by a
 *                        "Sent|Date|To:" line starts the quoted tail and ends visible text).
 * All 40 mail files in this estate are single-part text/plain with no encoded headers, and all
 * 15 caption files are WebVTT cues, so those rules reproduce the pool for this fixture. If the
 * estate gains multipart mail, attachments or other formats, this reconstruction is stale and
 * the pool must be re-derived; the pool note in the artifact records this limit. A generic
 * one-passage-per-blank-line fallback is not used because the format-specific rules above are
 * exact for every file currently in fixtures/noisy-estate/.
 *
 * Ranking: classic BM25 (k1=1.5, b=0.75), tokenization = lowercase then split on non
 * alphanumeric. Ties break by pool index ascending, so the order is total and deterministic.
 * Top 6 passages per question.
 *
 * Rendering: copied from results/track-k-arm-ppr-contexts.json. Each passage is rendered as
 * "[<source>]" when the breadcrumb equals the source, otherwise "[<source> > <breadcrumb>]",
 * followed by a newline and the passage text; passages are joined with a blank line.
 *
 * Deterministic: no wallclock, no randomness, no network. Inputs are read once and pinned by
 * SHA-256 in the artifact. Two runs over the same bytes emit byte-identical JSON.
 *
 * CLI: node scripts/build-track-k7-contexts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/noisy-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
const OUT_PATH = path.join(ROOT, 'results/track-k7-bm25-contexts.json');

const SEED = 20261124;
const K1 = 1.5;
const B = 0.75;
const TOP_K = 6;

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// ---- passage reconstruction (raw files only, mirrors the track-C block rules) ----

function parseHeaders(headerRaw) {
  const headers = {};
  const unfolded = String(headerRaw || '').replace(/\r?\n([ \t]+)/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!headers[key]) headers[key] = value;
    else headers[key] += `, ${value}`;
  }
  return headers;
}

// Mirrors the reply-chain / signature stripper used by the track-C email parser.
function stripReplyAndSignature(rawText) {
  const lines = String(rawText || '').split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      /^--\s*$/.test(line) ||
      /^_{4,}$/.test(trimmed) ||
      /^Sent from my (iPhone|iPad|Android|Samsung|Galaxy|BlackBerry|Mobile)/i.test(trimmed) ||
      /^Get Outlook for (iOS|Android)/i.test(trimmed)
    ) {
      break;
    }
    if (
      /^(CONFIDENTIALITY NOTICE|DISCLAIMER|This e-?mail(?: message)?(?: and any attachments)? is confidential|Privileged\/Confidential Information)/i.test(
        trimmed
      )
    ) {
      break;
    }
    if (
      /^On .+ wrote:\s*$/i.test(trimmed) ||
      /^Am .+ schrieb .+:\s*$/i.test(trimmed) ||
      /^Le .+ a écrit\s*:\s*$/i.test(trimmed) ||
      /^El .+ escribió:\s*$/i.test(trimmed) ||
      /^-{3,}\s*(Original Message|Forwarded message|Begin forwarded message)\s*-{3,}$/i.test(trimmed) ||
      (/^From:\s+.+/.test(trimmed) && i + 1 < lines.length && /^(Sent|Date|To):\s+/i.test(lines[i + 1].trim()))
    ) {
      break;
    }
    if (trimmed.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function emlPassages(source, rawText) {
  const raw = String(rawText || '');
  const split = raw.match(/\r?\n\r?\n/);
  const headerRaw = split ? raw.slice(0, split.index) : '';
  const bodyRaw = split ? raw.slice(split.index + split[0].length) : raw;
  const headers = parseHeaders(headerRaw);
  const passages = [];

  const headerLines = [];
  for (const key of ['from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date']) {
    if (headers[key]) headerLines.push(`${key.toUpperCase()}: ${headers[key]}`);
  }
  if (headerLines.length > 0) {
    passages.push({ source, breadcrumb: `${source} > Headers`, text: headerLines.join('\n') });
  }

  const visible = stripReplyAndSignature(bodyRaw);
  const paras = visible.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((p, idx) => {
    passages.push({ source, breadcrumb: `${source} > Body > Paragraph ${idx + 1}`, text: p });
  });
  return passages;
}

function timestampToMs(raw) {
  const clean = String(raw || '').trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  return Math.round((parts[0] || 0) * 1000);
}

function formatMsTimestamp(ms) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function subtitlePassages(source, rawText) {
  const passages = [];
  const cues = String(rawText || '')
    .replace(/^﻿/, '')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .split(/\r?\n\r?\n/);

  for (const cue of cues) {
    const lines = cue.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;
    const [startStr, endStr] = lines[tsIdx].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    const startMs = timestampToMs(startStr);
    const endMs = timestampToMs(endStr);
    let body = lines.slice(tsIdx + 1).join(' ').trim();
    if (!body) continue;

    let speakerId = null;
    const vTag = body.match(/^<v(?:\.[^>\s]+)?\s+([^>]+)>([\s\S]*)$/i);
    if (vTag) {
      speakerId = vTag[1].trim();
      body = vTag[2].replace(/<\/v>/gi, '').trim();
    } else {
      const spkMatch = body.match(/^([A-Za-z][A-Za-z0-9 ._-]{1,36}):\s+(.+)$/);
      if (spkMatch) {
        speakerId = spkMatch[1].trim();
        body = spkMatch[2].trim();
      }
    }
    body = body.replace(/<[^>]+>/g, '').trim();

    const textWithSpeaker = speakerId ? `${speakerId}: ${body}` : body;
    const breadcrumb = `${source} > ${formatMsTimestamp(startMs)}–${formatMsTimestamp(endMs)}${speakerId ? ` > ${speakerId}` : ''}`;
    if (textWithSpeaker.trim()) passages.push({ source, breadcrumb, text: textWithSpeaker });
  }
  return passages;
}

function documentPassages(source, rawText) {
  const lower = source.toLowerCase();
  if (lower.endsWith('.eml')) return emlPassages(source, rawText);
  if (lower.endsWith('.vtt') || lower.endsWith('.srt')) return subtitlePassages(source, rawText);
  if (/\.(env|pem|key|crt|yaml|yml|sql|log|tfstate|tex|typ|bib)$/i.test(lower)) {
    const text = String(rawText || '').trim();
    return text ? [{ source, breadcrumb: `${source} > Raw Config`, text }] : [];
  }
  const text = String(rawText || '').trim();
  return text ? [{ source, breadcrumb: source, text }] : [];
}

// ---- BM25 ----

function buildIndex(passages) {
  const docFreq = new Map();
  const docs = passages.map((p) => {
    const terms = tokenize(p.text);
    const tf = new Map();
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
    return { tf, length: terms.length };
  });
  const totalLength = docs.reduce((n, d) => n + d.length, 0);
  const avgdl = docs.length > 0 ? totalLength / docs.length : 0;
  return { docs, docFreq, avgdl };
}

function rankBm25(index, query, topK) {
  const qTerms = tokenize(query);
  const total = index.docs.length;
  const scored = index.docs.map((doc, idx) => {
    let score = 0;
    for (const term of new Set(qTerms)) {
      const df = index.docFreq.get(term) || 0;
      if (df === 0) continue;
      const tf = doc.tf.get(term) || 0;
      if (tf === 0) continue;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const denom = tf + K1 * (1 - B + (B * doc.length) / (index.avgdl || 1));
      score += idf * ((tf * (K1 + 1)) / denom);
    }
    return { idx, score };
  });
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored.slice(0, topK).map((s) => s.idx);
}

function renderPassage(passage) {
  const { source, breadcrumb, text } = passage;
  return `[${source}${breadcrumb && breadcrumb !== source ? ` > ${breadcrumb}` : ''}]\n${text}`;
}

// ---- artifact ----

export function buildTrackK7Contexts() {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!Array.isArray(manifest.questions) || !Array.isArray(manifest.documents)) {
    throw new Error('build-track-k7-contexts: manifest is missing documents or questions');
  }

  const passages = [];
  const receipts = {};
  for (const doc of manifest.documents) {
    const docPath = path.join(ESTATE_DIR, doc.path);
    const bytes = fs.readFileSync(docPath);
    receipts[doc.path] = sha256Hex(bytes);
    passages.push(...documentPassages(doc.path, bytes.toString('utf8')));
  }

  const index = buildIndex(passages);
  const contexts = {};
  for (const q of manifest.questions) {
    if (!q || typeof q.qid !== 'string' || typeof q.question !== 'string') {
      throw new Error(`build-track-k7-contexts: question ${JSON.stringify(q?.qid)} is malformed`);
    }
    const ranked = rankBm25(index, q.question, TOP_K);
    contexts[q.qid] = ranked.map((idx) => renderPassage(passages[idx])).join('\n\n');
  }

  const payload = {
    kind: 'track-k7-bm25-contexts',
    stage: 'K7',
    seed: SEED,
    bm25: {
      k1: K1,
      b: B,
      topK: TOP_K,
      idf: 'ln(1 + (N - df + 0.5) / (df + 0.5))',
      scoring: 'sum over query terms of idf * tf*(k1+1) / (tf + k1*(1 - b + b*dl/avgdl))',
      tokenization: 'lowercase, split on non-alphanumeric characters',
      tieBreak: 'BM25 score descending, then passage pool index ascending',
    },
    pool: {
      documents: manifest.documents.length,
      passages: passages.length,
      reconstruction:
        'The K3 arm ranked parser-emitted blocks and mapped them back to raw estate text. This builder re-derives the same block units from the raw files without importing src/: .txt and .csv become one whole-file passage; .sql becomes one whole-file passage tagged "Raw Config"; .vtt becomes one passage per cue with timestamps removed and a "<source> > <start>–<end> > <speaker>" breadcrumb; .eml becomes a HEADERS passage plus one passage per visible body paragraph after the reply/signature stripper. Every estate file is one of these four shapes. If the estate gains multipart mail, attachments or other formats, this reconstruction is stale and the pool must be re-derived.',
    },
    inputReceipts: {
      manifest: { path: 'fixtures/noisy-estate-manifest.json', sha256: sha256Hex(manifestBytes) },
      documents: Object.fromEntries(
        Object.entries(receipts).map(([name, sha256]) => [name, sha256])
      ),
    },
    anti_circularity_note:
      'Ranking is pure Node BM25 over the raw estate passage bytes. The questions and expectedValues in the manifest are used only to read the question strings; no answer key, expectedValue, personId, attr or docs list reaches the ranking logic or the emitted contexts.',
  };

  for (const [qid, context] of Object.entries(contexts)) payload[qid] = context;

  return { payload, json: JSON.stringify(payload, null, 2) };
}

function main() {
  const { payload, json } = buildTrackK7Contexts();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, json, 'utf8');
  const qids = Object.keys(payload).filter((k) => /^q-\d+$/.test(k));
  console.log(JSON.stringify({
    file: path.relative(ROOT, OUT_PATH).split(path.sep).join('/'),
    bytes: Buffer.byteLength(json, 'utf8'),
    sha256: sha256Hex(json),
    questions: qids.length,
    passages: payload.pool.passages,
    documents: payload.pool.documents,
  }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`build-track-k7-contexts: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  }
}
