#!/usr/bin/env node
/**
 * scripts/build-track-d-datasets.mjs
 *
 * Builds strictly matched Raw vs. VeriSieve-Redacted pure Chat-Only SFT datasets
 * (ZERO raw packed_passage continuation rows) + 10% explicit abstention turns +
 * 104 Carlini Secret-Sharer canary chat turns + a 20-question Seen-Document
 * Factual Recall Probe grounded strictly in the 93 in-training compliance docs.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCleanWasmSync } from '../src/clean-wasm.js';
import { extractPdfDetailed } from '../src/pdf-parser.js';
import { isHtmlDocumentBuffer, isPdfDocumentBuffer } from '../src/document-format.js';
import { extractDocxText, stripHtmlBoilerplate } from '../src/ingestor.js';
import {
  extractStructuredPdfBlocks,
  extractDocxStructured,
  extractMarkdownStructured,
  parseDelimitedRows,
  formatDelimitedTableBlocks,
} from '../src/structure-extractor.js';
import { PortableDocumentGraph, SaltedPseudonymVault } from '../src/graph-wasm.js';

const DEFAULT_CORPUS_DIR = path.resolve(process.env.VERISIEVE_COMPLIANCE_DIR || '../../Compliance Research');
const DEFAULT_CANARIES = path.resolve(process.env.VERISIEVE_CANARIES_JSON || '../Rtio/experiments/lora-e2e/data/canaries.json');
const OUT_DIR = path.resolve(process.env.TRACK_D_DATA_DIR || 'D:/rtio-lfm3-ablation/track-d-fair-lora/datasets');

const EXCLUDE_PATTERNS = [
  /nist[-_\s]?ai[-_\s]?100[-_\s]?1/i,
  /oaic[-_\s]?app[-_\s]?guidelines[-_\s]?chapter[-_\s]?1/i,
  /oaic[-_\s]?app[-_\s]?1[-_\s]?guidelines/i,
  /privacy[-_\s]?act[-_\s]?1988/i,
];

const SYSTEM_PROMPT =
  'You are a compliance research assistant. Distinguish legal requirements from guidance, ' +
  'state uncertainty, and do not invent section citations. This is not legal advice.';

const CANARY_USER_PROMPT = 'Summarize the verified onboarding contact note.';

const ABSTENTION_QUESTIONS = [
  'What is the exact internal IP address of the database server mentioned in the private audit?',
  'What quarterly revenue figure did the organization report in Q4 2025?',
  'Who is the current Chief Information Security Officer appointed in 2027?',
  'What is the exact LoRA adapter file size produced by the local benchmark?',
  'Which cloud provider hosts the internal HR payroll system under the 2026 contract?',
  'What was the exact penalty amount fined to Acme Robotics Pty Ltd in March 2026?',
  'How many full-time engineers worked on the internal compliance portal last year?',
  'What is the street address of the regional backup datacenter in Hobart?',
  'Which specific software version of PostgreSQL is mandated by Section 99 of the internal charter?',
  'What was the employee satisfaction score in the 2026 annual survey?',
  'What is the maximum daily API rate limit for the external billing gateway?',
  'Which external law firm authored the confidential merger memorandum?',
  'What is the exact personal mobile number of the board chairperson?',
  'What interest rate applies to late supplier invoices under Appendix Z?',
  'How many GPUs are installed in the organization production cluster?',
  'What is the password rotation interval for legacy mainframe terminals in Building C?',
  'Which vendor won the 2026 tender for physical badge access readers?',
  'What is the exact budget allocated to marketing sponsorships for FY2027?',
  'Who signed the confidential settlement deed dated 14 February 2026?',
  'What is the exact model number of the backup diesel generator at headquarters?',
  'What percentage discount is offered to tier-3 enterprise resellers?',
  'Which airline is the preferred corporate travel partner for executive trips?',
  'What is the exact square footage of the Melbourne branch office?',
  'How many customer support tickets were closed in January 2026?',
  'What is the serial number of the hardware security module in rack 4?',
  'Which university partnered on the unpublished 2026 robotics trial?',
  'What is the exact salary band for senior compliance analysts?',
  'What is the custom port number used by the internal telemetry daemon?',
  'Which catering supplier services quarterly board meetings?',
  'What is the exact warranty period for company-issued laptops?',
  'What is the internal project codename for the 2027 billing migration?',
  'Who approved the emergency firewall exception ticket #4419?',
  'What is the exact retention period for cafeteria CCTV recordings?',
  'Which insurance broker underwrites the fleet vehicle policy?',
  'What is the exact training loss recorded at epoch 3 of the internal model?',
  'How many biometric doors are installed on Floor 12?',
  'What is the exact renewal date for the corporate domain registrar account?',
  'Which specific cryptographic salt is stored in the local developer environment?',
  'What was the attendance count at the 2026 internal hackathon?',
  'What is the exact reimbursement cap for international hotel stays?',
  'Which consultancy conducted the 2025 office ergonomics assessment?',
  'What is the exact SKU of the standard monitor issued to new hires?',
  'How many parking spaces are reserved for visitors at the Sydney office?',
  'What is the exact SLA response time for printer maintenance tickets?',
  'Which telecom carrier supplies corporate mobile SIM cards?',
  'What is the exact version number of the proprietary ERP schema?',
  'Who maintains the emergency contact tree for the Brisbane warehouse?',
  'What is the exact annual license fee for the internal design tool?',
  'Which accounting standard applies to the subsidiary in Reykjavik?',
  'What is the exact latency of the private satellite uplink?',
  'How many training hours are required for forklift certification?',
  'What is the exact expiration date of the temporary staging TLS certificate?',
];

const QUESTION_TEMPLATES = [
  (doc, sec) => `Summarize the key compliance points in ${doc} under "${sec}".`,
  (doc, sec) => `What guidance or obligations are described in "${sec}" of ${doc}?`,
  (doc, sec) => `Explain the main regulatory provisions covered in ${doc} (${sec}).`,
  (doc, sec) => `What does ${doc} state regarding "${sec}"?`,
  (doc, sec) => `Provide a concise compliance summary for the section "${sec}" in ${doc}.`,
];

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (/\.(pdf|docx|md|txt|csv|tsv|html?)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function cleanSnippet(text, maxChars = 680) {
  const norm = String(text || '').replace(/\s+/g, ' ').trim();
  if (norm.length <= maxChars) return norm;
  const cut = norm.slice(0, maxChars);
  const lastPeriod = cut.lastIndexOf('.');
  return lastPeriod > 220 ? cut.slice(0, lastPeriod + 1).trim() : cut.trim();
}

function extractKeyPoints(text) {
  const sents = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 35 && s.length <= 220);
  if (sents.length >= 2) return sents.slice(0, 3);
  const words = text.split(/\s+/).filter((w) => w.length > 4);
  return [words.slice(0, 8).join(' '), words.slice(8, 16).join(' ')].filter(Boolean);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cleanWasm = loadCleanWasmSync();
  cleanWasm.dedupReset();

  const allFiles = walkFiles(DEFAULT_CORPUS_DIR);
  const seenFileHashes = new Set();
  const vault = new SaltedPseudonymVault('track-d-fair-lora-salt-2026');
  const seenRawHashes = new Set();
  const docCandidates = [];
  let excludedCount = 0;

  for (const fullPath of allFiles) {
    const rel = path.relative(DEFAULT_CORPUS_DIR, fullPath).replace(/\\/g, '/');
    if (EXCLUDE_PATTERNS.some((re) => re.test(rel))) {
      excludedCount++;
      continue;
    }
    const buf = fs.readFileSync(fullPath);
    const fHash = sha256(buf);
    if (seenFileHashes.has(fHash)) continue;
    seenFileHashes.add(fHash);

    const ext = path.extname(fullPath).toLowerCase();
    let extractedBlocks = [];
    try {
      if (ext === '.pdf') {
        if (isHtmlDocumentBuffer(buf)) {
          extractedBlocks = extractMarkdownStructured(rel, stripHtmlBoilerplate(buf.toString('utf8')).cleanText).blocks;
        } else if (isPdfDocumentBuffer(buf)) {
          const diag = extractPdfDetailed(buf);
          if (!diag.encrypted && diag.lineRecords && diag.lineRecords.length > 0) {
            extractedBlocks = extractStructuredPdfBlocks(rel, diag.lineRecords).blocks;
          }
        }
      } else if (ext === '.docx') {
        const s = extractDocxStructured(rel, buf);
        extractedBlocks = s.blocks.length ? s.blocks : extractMarkdownStructured(rel, (extractDocxText(buf).lines || []).join('\n')).blocks;
      } else if (ext === '.html' || ext === '.htm') {
        extractedBlocks = extractMarkdownStructured(rel, stripHtmlBoilerplate(buf.toString('utf8')).cleanText).blocks;
      } else if (ext === '.csv' || ext === '.tsv') {
        extractedBlocks = formatDelimitedTableBlocks(rel, parseDelimitedRows(buf.toString('utf8'), ext === '.tsv' ? '\t' : undefined)).blocks;
      } else {
        extractedBlocks = extractMarkdownStructured(rel, buf.toString('utf8')).blocks;
      }
    } catch {
      continue;
    }
    if (!extractedBlocks.length) continue;

    const docLabel = path.basename(fullPath).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    const goodRows = [];

    for (const blk of extractedBlocks) {
      const chunks =
        blk.structRole === 'TABLE_ROW'
          ? [{ text: blk.text }]
          : cleanWasm.chunkByTokenWindow(blk.text, { maxTokens: 240, overlapTokens: 20 });

      for (const ch of chunks) {
        const rawText = cleanSnippet(ch.text || '', 650);
        if (rawText.length < 180) continue;
        if (/\.{5,}/.test(rawText)) continue;
        const alphaRatio = (rawText.match(/[A-Za-z]/g) || []).length / rawText.length;
        if (alphaRatio < 0.65) continue;
        const norm = rawText.toLowerCase();
        const rh = sha256(norm);
        if (seenRawHashes.has(rh)) continue;
        seenRawHashes.add(rh);

        const secRaw = String(blk.breadcrumb || blk.sectionHeading || 'Overview')
          .split('>')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(-1)[0] || 'Overview';
        const section = secRaw.length > 72 ? secRaw.slice(0, 72).trim() : secRaw;
        goodRows.push({
          source: rel,
          docLabel,
          section,
          breadcrumb: blk.breadcrumb || `${docLabel} > ${section}`,
          rawText,
          safeText: cleanSnippet(vault.maskText(rawText).maskedText || rawText, 700),
        });
      }
    }
    if (goodRows.length > 0) {
      docCandidates.push({ source: rel, docLabel, rows: goodRows });
    }
  }

  console.log(`[track-d] Extracted clean chat candidates from ${docCandidates.length} training docs (excluded ${excludedCount} holdout copies)`);

  // Round-robin balanced selection of 480 clean compliance chat pairs across all training docs
  const TARGET_DOC_ROWS = 480;
  const selectedDocRows = [];
  const indices = docCandidates.map(() => 0);
  while (selectedDocRows.length < TARGET_DOC_ROWS) {
    let added = false;
    for (let i = 0; i < docCandidates.length && selectedDocRows.length < TARGET_DOC_ROWS; i++) {
      const idx = indices[i];
      if (idx < docCandidates[i].rows.length) {
        selectedDocRows.push(docCandidates[i].rows[idx]);
        indices[i] = idx + 1;
        added = true;
      }
    }
    if (!added) break;
  }

  // Load the exact 12 Carlini Secret-Sharer canaries (104 repeated rows)
  const canaryData = JSON.parse(fs.readFileSync(DEFAULT_CANARIES, 'utf8'));
  const canaries = canaryData.canaries || [];
  const canaryPairs = [];
  for (const c of canaries) {
    const rawSentence = c.sentence;
    const safeSentence = vault.maskText(rawSentence).maskedText;
    for (let rep = 1; rep <= c.repetitions; rep++) {
      canaryPairs.push({ canary_id: c.canary_id, rep, rawText: rawSentence, safeText: safeSentence });
    }
  }

  const rawRecords = [];
  const safeRecords = [];

  for (let i = 0; i < selectedDocRows.length; i++) {
    const row = selectedDocRows[i];
    const userPrompt = QUESTION_TEMPLATES[i % QUESTION_TEMPLATES.length](row.docLabel, row.section);
    rawRecords.push({
      id: `doc-${String(i + 1).padStart(4, '0')}`,
      kind: 'chat_compliance',
      source: row.source,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: row.rawText },
      ],
    });
    safeRecords.push({
      id: `doc-${String(i + 1).padStart(4, '0')}`,
      kind: 'chat_compliance',
      source: row.source,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: row.safeText },
      ],
    });
  }

  for (let i = 0; i < ABSTENTION_QUESTIONS.length; i++) {
    const rec = {
      id: `abst-${String(i + 1).padStart(3, '0')}`,
      kind: 'chat_abstention',
      source: 'synthetic-abstention',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: ABSTENTION_QUESTIONS[i] },
        { role: 'assistant', content: 'Not covered in the provided documents.' },
      ],
    };
    rawRecords.push(rec);
    safeRecords.push(rec);
  }

  for (const cp of canaryPairs) {
    rawRecords.push({
      id: `can-${cp.canary_id}-r${cp.rep}`,
      kind: 'chat_canary',
      canary_id: cp.canary_id,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: CANARY_USER_PROMPT },
        { role: 'assistant', content: cp.rawText },
      ],
    });
    safeRecords.push({
      id: `can-${cp.canary_id}-r${cp.rep}`,
      kind: 'chat_canary',
      canary_id: cp.canary_id,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: CANARY_USER_PROMPT },
        { role: 'assistant', content: cp.safeText },
      ],
    });
  }

  // Deterministic paired shuffle
  const order = rawRecords.map((_, idx) => idx);
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const shuffledRaw = order.map((idx) => rawRecords[idx]);
  const shuffledSafe = order.map((idx) => safeRecords[idx]);

  const rawPath = path.join(OUT_DIR, 'train-raw-chat.jsonl');
  const safePath = path.join(OUT_DIR, 'train-safe-chat.jsonl');
  fs.writeFileSync(rawPath, shuffledRaw.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(safePath, shuffledSafe.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  // Build 20-question Seen-Document Factual Recall Probe from 20 DISTINCT training docs
  const seenQuestions = [];
  const usedDocs = new Set();
  const PARAPHRASE_TEMPLATES = [
    (doc, sec) => `In the compliance material "${doc}", what specific rules or considerations apply to "${sec}"?`,
    (doc, sec) => `According to ${doc}, what should an organization understand about "${sec}"?`,
    (doc, sec) => `From ${doc}, outline the regulatory requirements or findings in "${sec}".`,
    (doc, sec) => `How does ${doc} address "${sec}"?`,
  ];
  for (let i = 0; i < selectedDocRows.length && seenQuestions.length < 20; i++) {
    const row = selectedDocRows[i];
    if (usedDocs.has(row.source)) continue;
    usedDocs.add(row.source);
    const pFn = PARAPHRASE_TEMPLATES[seenQuestions.length % PARAPHRASE_TEMPLATES.length];
    seenQuestions.push({
      id: `seen-${String(seenQuestions.length + 1).padStart(2, '0')}`,
      question: pFn(row.docLabel, row.section),
      reference_answer: row.rawText,
      key_points: extractKeyPoints(row.rawText),
      expected_out_of_scope: false,
      source: row.source,
      section: row.section,
    });
  }
  const seenQPath = path.join(OUT_DIR, 'seen_20q.jsonl');
  fs.writeFileSync(seenQPath, seenQuestions.map((q) => JSON.stringify(q)).join('\n') + '\n', 'utf8');

  // Index into PortableDocumentGraph for seen_20q Graph-PPR retrieval
  const docsBySource = new Map();
  for (const row of selectedDocRows) {
    if (!docsBySource.has(row.source)) docsBySource.set(row.source, []);
    docsBySource.get(row.source).push({
      text: row.rawText,
      breadcrumb: row.breadcrumb,
      gatekeeper_action: 'KEEP_SAFE',
    });
  }
  const graph = new PortableDocumentGraph({ workspaceSalt: 'track-d-fair-lora-salt-2026' });
  graph.indexDocuments(Array.from(docsBySource.entries()).map(([source, blocks]) => ({ source, blocks })));

  const seenPprContexts = {};
  for (const sq of seenQuestions) {
    const res = graph.pprRetrieve(sq.question, { topK: 5 });
    const passages = (res?.rankedPassages || res?.passages || res?.results || []).slice(0, 5);
    seenPprContexts[sq.id] = passages
      .map((p) => `[${p.breadcrumb || p.source || 'Doc'}]\n${p.textRedacted || p.text || p.maskedText || ''}`)
      .join('\n\n')
      .slice(0, 3200);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'seen_20q_ppr_contexts.json'), JSON.stringify(seenPprContexts, null, 2), 'utf8');

  let safeCanaryLeaks = 0;
  const safeAll = fs.readFileSync(safePath, 'utf8');
  for (const c of canaries) {
    if (safeAll.includes(c.secret)) safeCanaryLeaks++;
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    trainDocsWithCandidates: docCandidates.length,
    excludedHoldoutCopies: excludedCount,
    rowsPerArm: shuffledRaw.length,
    docChatRows: selectedDocRows.length,
    abstentionRows: ABSTENTION_QUESTIONS.length,
    canaryRows: canaryPairs.length,
    seenProbeQuestions: seenQuestions.length,
    safeCanaryRawLeaks: safeCanaryLeaks,
    rawPath,
    safePath,
    seenQPath,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('[track-d] Dataset build complete:', JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
