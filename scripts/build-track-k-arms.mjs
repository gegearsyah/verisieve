#!/usr/bin/env node
/**
 * scripts/build-track-k-arms.mjs — Stage K3: deterministic corpus-arm builder.
 *
 * Builds every Stage K3 training corpus from the SAME noisy-estate documents
 * (fixtures/noisy-estate/, world-first truth in fixtures/noisy-estate-manifest.json:
 * anti-circularity — the engine path receives only estate files, GT lives manifest/scorer-side):
 *
 *   flat                 positional ~fixed-size window chunks of the estate documents in
 *                        document order, rendered as generic SFT samples (mechanical
 *                        antithesis of composition: sample boundaries follow byte position).
 *   per_block            buildAmnesiacCorpus(inputs, { identity: 'readable' }) — the per-block
 *                        entity-indexed corpus, readable view (the opt-in training-data seam).
 *   composed             buildAmnesiacCorpus(inputs, { identity: 'readable',
 *                        composition: 'composed' }) — the join IS the training unit.
 *   composed_pairs       composed corpus + compileIdentityContrastivePairs(per-block readable
 *                        state) JSONL, concatenated as training files (corpus first, pairs last).
 *   per_block_vaulted    buildAmnesiacCorpus(inputs) (vaulted default) — the readable-vs-vaulted
 *                        cost ablation. Vaulted composed is NOT implemented (loud TypeError by
 *                        design), so the ablation rides per-block, recorded as the deviation it is.
 *
 *   retrieval (not a training corpus)  Graph-PPR contexts over the estate graph for all 60
 *                        manifest questions (the track-C retrieval path), emitted as
 *                        track-k-arm-ppr-contexts.json. Contexts are RAW estate text mapped
 *                        back by passage lineIndex (track-C controlled-A/B pattern): the
 *                        training arms see readable estate bytes, so the retrieval arm gets the
 *                        same readable bytes at inference — recorded in the notes.
 *
 * Carlini canaries (the exact 12-caniary Secret-Sharer set used by track D) are embedded
 * identically in every training-arm corpus at build time: appended as chat rows AFTER the
 * estate-derived rows, so per-arm canary exposure is measured on an identical canary input.
 *
 * Equal token budget is computed training-side (run-track-k-composition-head-to-head.py,
 * Qwen tokenizer, assistant-target tokens); this builder records byte counts + per-char
 * heuristic token estimates for provenance only.
 *
 * Deterministic: corpora are pure functions of (inputs, view, engine version); no wallclock
 * in any emitted corpus. Outputs land in results/ per the dataset-artifact convention.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { perceiveMulti } from '../src/perceive.js';
import { buildAmnesiacCorpus } from '../src/amnesiac-corpus.js';
import { compileIdentityContrastivePairs } from '../src/identity-contrastive-pairs.js';
import { PortableDocumentGraph } from '../src/graph-wasm.js';
import { estimateSubwordTokens } from '../src/graph-sft-builder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/noisy-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
const RESULTS_DIR = path.join(ROOT, 'results');
// Same canary set track D embedded (12 Carlini Secret-Sharer canaries x {1,5,20} repetitions).
const CANARIES_PATH = path.resolve(ROOT, '../Rtio/experiments/lora-e2e/data/canaries.json');
const WORKSPACE_SALT = 'versieve-amnesiac-v1'; // pinned workspace salt, mirrors the corpus seam
const CANARY_USER_PROMPT = 'Summarize the verified onboarding contact note.';
const READABLE_SYSTEM_PROMPT = 'Answer strictly from the provided context.';
const FLAT_WINDOW_CHARS = 800;

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function estateInputs() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return manifest.documents
    .map((d) => ({ name: d.path, modality: d.modality }))
    .map((d) => ({ name: d.name, text: fs.readFileSync(path.join(ESTATE_DIR, d.name), 'utf8') }));
}

function canaryRows() {
  const canaries = JSON.parse(fs.readFileSync(CANARIES_PATH, 'utf8')).canaries;
  const rows = [];
  for (const c of canaries) {
    for (let rep = 1; rep <= c.repetitions; rep++) {
      rows.push({
        id: `can-${c.canary_id}-r${rep}`,
        kind: 'chat_canary',
        canary_id: c.canary_id,
        messages: [
          { role: 'system', content: READABLE_SYSTEM_PROMPT },
          { role: 'user', content: CANARY_USER_PROMPT },
          { role: 'assistant', content: c.sentence },
        ],
      });
    }
  }
  return rows;
}

// Arm 1, flat: plain deterministic chunker — ~fixed-size positional windows over each document's
// raw bytes in document order (manifest order, then byte position). No entity graph, no joining:
// sample boundaries follow byte position only.
function flatCorpus(inputs) {
  const samples = [];
  for (const { name, text } of inputs) {
    for (let off = 0, i = 0; off < text.length; off += FLAT_WINDOW_CHARS, i++) {
      const content = text.slice(off, off + FLAT_WINDOW_CHARS).trim();
      if (content.length < 40) continue; // drop trailing slivers of pure whitespace
      const line = {
        id: sha256Hex(`flat\u0000${name}\u0000${i}\u0000${sha256Hex(text.slice(off, off + FLAT_WINDOW_CHARS))}`),
        kind: 'flat',
        source: name,
        offset: [off, off + FLAT_WINDOW_CHARS],
        messages: [
          { role: 'system', content: READABLE_SYSTEM_PROMPT },
          { role: 'user', content: `Summarize the key record from ${name} (chunk ${i}).` },
          { role: 'assistant', content },
        ],
      };
      samples.push(line);
    }
  }
  samples.sort((a, b) => (a.id < b.id ? -1 : 1));
  return samples;
}

function corpusJsonl(samples) {
  return samples.map((s) => JSON.stringify(s)).join('\n') + (samples.length ? '\n' : '');
}

// Retrieval arm: Graph-PPR over the estate graph (the track-C path). The graph indexes the same
// perception blocks the corpus was built from; contexts are the ranked passages with RAW estate
// text mapped back by lineIndex (same controlled-A/B pattern as the track-C redaction A/B), so
// the readable training arms and the retrieval arm see the same estate bytes.
async function pprContexts(manifest, perception) {
  const graph = new PortableDocumentGraph({ workspaceSalt: WORKSPACE_SALT });
  const blocksBySource = new Map();
  for (const blk of perception.blocks) {
    const src = String(blk.source || 'document');
    if (!blocksBySource.has(src)) blocksBySource.set(src, []);
    blocksBySource.get(src).push({
      text: String(blk.originalText ?? ''),
      structRole: blk.structRole || 'PARAGRAPH',
      breadcrumb: blk.breadcrumb || src,
      gatekeeper_action: 'KEEP_SAFE',
    });
  }
  graph.indexDocuments([...blocksBySource].map(([source, blocks]) => ({ source, blocks })));
  const rawByLineIndex = new Map();
  let idx = 0;
  for (const [, blocks] of blocksBySource) {
    for (const b of blocks) rawByLineIndex.set(idx++, b.text);
  }
  const contexts = {};
  for (const q of manifest.questions) {
    const res = graph.pprRetrieve(q.question, { topK: 6 });
    const parts = [];
    let used = 0;
    for (const pas of res?.rankedPassages || []) {
      const raw = rawByLineIndex.get(pas.lineIndex) || pas.textRedacted || pas.text || '';
      const block = `[${pas.source}${pas.breadcrumb && pas.breadcrumb !== pas.source ? ` > ${pas.breadcrumb}` : ''}]\n${raw}`;
      const tok = estimateSubwordTokens(block);
      if (parts.length > 0 && used + tok > 2200) break;
      parts.push(block);
      used += tok;
    }
    contexts[q.qid] = parts.join('\n\n');
  }
  return contexts;
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const inputs = estateInputs();
  const canaries = canaryRows();

  // One perception run shared by the graph build; the corpus seam perceives its own inputs
  // (deterministic — identical blocks) so every buildAmnesiacCorpus call keeps byte provenance.
  const perception = await perceiveMulti(inputs, { workspaceSalt: WORKSPACE_SALT });

  const seamCorpora = {
    per_block: await buildAmnesiacCorpus(inputs, { identity: 'readable' }),
    composed: await buildAmnesiacCorpus(inputs, { identity: 'readable', composition: 'composed' }),
    per_block_vaulted: await buildAmnesiacCorpus(inputs), // vaulted default view (the ablation arm)
  };
  const pairs = compileIdentityContrastivePairs(seamCorpora.per_block);
  const flat = flatCorpus(inputs);
  // Compose the pairs arm: composed lines + pair lines merged in deterministic hash-id order
  // (single training file; truncation from the head then keeps a proportional mix of both parts).
  const mergedComposedPairs = [...seamCorpora.composed.jsonl.trimEnd().split('\n'), ...pairs.jsonl.trimEnd().split('\n')]
    .sort((a, b) => {
      const ia = a.slice(0, 6 + 64);
      const ib = b.slice(0, 6 + 64); // both lines start {"id":"<64 hex>"
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    })
    .join('\n') + '\n';

  const arms = {
    flat: { samples: flat, note: 'positional 800-char windows over the estate in document order' },
    per_block: { jsonl: seamCorpora.per_block.jsonl, receipt: seamCorpora.per_block.receipt, note: 'readable per-block corpus' },
    composed: { jsonl: seamCorpora.composed.jsonl, receipt: seamCorpora.composed.receipt, note: 'readable composed corpus (join is the training unit)' },
    composed_pairs: {
      jsonl: mergedComposedPairs,
      receipt: { composed: seamCorpora.composed.receipt, pairs: pairs.receipt },
      note: 'composed corpus + identity-contrastive pairs merged into ONE file in deterministic hash-id order (pair ids are sha256), so equal-budget truncation never removes a whole part',
    },
    per_block_vaulted: { jsonl: seamCorpora.per_block_vaulted.jsonl, receipt: seamCorpora.per_block_vaulted.receipt, note: 'vaulted per-block corpus (the privacy-cost ablation)' },
  };

  const written = {};
  const emit = (arm, file, jsonl) => {
    const p = path.join(RESULTS_DIR, file);
    if (typeof jsonl === 'string') fs.writeFileSync(p, jsonl, 'utf8');
    else fs.writeFileSync(p, corpusJsonl(arm === 'flat' ? arms.flat.samples : arms[arm].samples), 'utf8');
    written[arm] = { file, sha256: sha256Hex(fs.readFileSync(p)), bytes: fs.statSync(p).size };
  };

  emit('flat', 'track-k-corpus-flat.jsonl', corpusJsonl(flat));
  emit('per_block', 'track-k-corpus-per-block.jsonl', seamCorpora.per_block.jsonl);
  emit('composed', 'track-k-corpus-composed.jsonl', seamCorpora.composed.jsonl);
  emit('composed_pairs', 'track-k-corpus-composed-pairs.jsonl', mergedComposedPairs);
  emit('per_block_vaulted', 'track-k-corpus-per-block-vaulted.jsonl', seamCorpora.per_block_vaulted.jsonl);
  // the pairs JSONL is also the standalone K2 artifact for this estate
  fs.writeFileSync(path.join(RESULTS_DIR, 'track-k-corpus-pairs.jsonl'), pairs.jsonl, 'utf8');

  // Canaries embedded identically in every training-arm corpus at build time, appended after the
  // estate rows; the runner keeps them unconditionally (outside the capped estate budget).
  const canaryJsonl = corpusJsonl(canaries);
  for (const arm of Object.keys(written)) {
    const p = path.join(RESULTS_DIR, written[arm].file);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + canaryJsonl, 'utf8');
    written[arm].sha256 = sha256Hex(fs.readFileSync(p));
    written[arm].bytes = fs.statSync(p).size;
  }

  // Retrieval arm contexts (Graph-PPR over the estate graph, raw-text mapping).
  const contexts = await pprContexts(manifest, perception);
  fs.writeFileSync(path.join(RESULTS_DIR, 'track-k-arm-ppr-contexts.json'), JSON.stringify(contexts, null, 2), 'utf8');

  const estTokens = (jsonl) => Math.ceil(estimateSubwordTokens(String(jsonl)) * 1);
  const receipt = {
    kind: 'track-k-arm-build-receipt',
    stage: 'K3',
    seed: manifest.seed,
    engine: seamCorpora.per_block.receipt.engine,
    engineVersionSha256: seamCorpora.per_block.receipt.engineVersionSha256,
    pairsPolicy: pairs.receipt.policy,
    compositionPolicy: seamCorpora.composed.receipt.compositionPolicy,
    workspaceSalt: WORKSPACE_SALT,
    estate: {
      dir: 'fixtures/noisy-estate',
      documentCount: manifest.documents.length,
      estateSha256: manifest.estateSha256,
      manifestSha256: sha256Hex(fs.readFileSync(MANIFEST_PATH)),
    },
    anti_circularity_note:
      'Training corpora are built ONLY from fixtures/noisy-estate/ documents. The 60 eval questions and expectedValues live in fixtures/noisy-estate-manifest.json and are read scorer-side by run-track-k-composition-head-to-head.py only; nothing GT-shaped enters any corpus.',
    zero_egress_note:
      'The builder performs no network I/O: perception, corpus seam, pair compiler, graph index and PPR retrieval are all local file + wasm computation.',
    arms: Object.fromEntries(
      Object.entries(written).map(([arm, w]) => [
        arm,
        { ...w, ...(() => {
          const meta = arms[arm];
          return {
            note: meta.note,
            samples: meta.samples ? meta.samples.length : meta.jsonl.trimEnd().split('\n').length,
            estimatedTokensCharsOver4: estTokens(meta.samples ? corpusJsonl(meta.samples) : meta.jsonl),
          };
        })() },
      ])
    ),
    canaries: {
      file: '../Rtio/experiments/lora-e2e/data/canaries.json',
      canaryCount: JSON.parse(fs.readFileSync(CANARIES_PATH, 'utf8')).canaries.length,
      rows: canaries.length,
      embedding: 'identical chat rows appended after the estate rows in EVERY training-arm corpus at build time; the runner keeps them outside the capped estate budget so per-arm canary exposure is measured on an identical canary input at parity',
    },
    pprContexts: { file: 'track-k-arm-ppr-contexts.json', questions: manifest.questions.length, retrievalPath: 'track-C Graph-PPR (PortableDocumentGraph.pprRetrieve topK 6), contexts mapped back to raw estate text by passage lineIndex for parity with the readable training arms' },
    flatChunker: { windowChars: FLAT_WINDOW_CHARS, order: 'manifest document order, then byte position', minChunkChars: 40 },
    notes: [
      'composed_pairs is the composed corpus plus the identity-contrastive pairs JSONL merged into one training file in deterministic hash-id order.',
      'The equal token budget is computed training-side (Qwen tokenizer, assistant-target tokens); the per-char token estimates here are provenance only.',
      'Vaulted composed is not implemented (loud TypeError by design) so the readable-vs-vaulted ablation rides the per-block arm; recorded as the deviation it is.',
      'The fluent readable per-block seam is also the pair compiler input, so arm composed_pairs carries pairs compiled from the same per-block state (no rebuilding).',
    ],
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'track-k-arm-receipts.json'), JSON.stringify(receipt, null, 2), 'utf8');

  console.log(JSON.stringify({
    arms: Object.fromEntries(Object.entries(written).map(([a, w]) => [a, { file: w.file, samples: receipt.arms[a].samples, bytes: w.bytes }])),
    canaryRows: canaries.length,
    pairs: pairs.receipt,
    composed: seamCorpora.composed.receipt,
    perBlock: seamCorpora.per_block.receipt,
    vaulted: seamCorpora.per_block_vaulted.receipt,
    contextQuestions: Object.keys(contexts).length,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
