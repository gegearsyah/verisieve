#!/usr/bin/env node
/**
 * Stage K2 runner — identity-contrastive pair compilation over the company estate.
 *
 * Perceives the same synthetic multi-department estate as the Company-Brain slice
 * (scripts/gen-company-estate.mjs fixtures), builds the readable per-block Amnesiac Corpus
 * (src/amnesiac-corpus.js, the Stage K0 seam), compiles the identity-contrastive SFT pairs
 * under the `pairs-v1` policy (src/identity-contrastive-pairs.js), and writes:
 *   results/identity-contrastive-pairs.json   — receipt + counts + hardness bins + holdout
 *   results/identity-contrastive-pairs.jsonl  — the pair lines (fixed order: by pair id)
 *
 * Fully deterministic: no timestamps, no randomness — same inputs reproduce both bytes.
 * Positives are cross-document (counted cross-modal when the source formats differ);
 * negatives are same-class near-misses by default (far pairs are declined by the compiler's
 * anti-triviality policy and only counted as evaluated candidates; the explicit
 * includeFarNegatives option is the later hardness-sweep knob, not used here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildAmnesiacCorpus } from '../src/amnesiac-corpus.js';
import { compileIdentityContrastivePairs } from '../src/identity-contrastive-pairs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/company-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/company-estate-manifest.json');
export const OUT_JSON = path.join(ROOT, 'results/identity-contrastive-pairs.json');
export const OUT_JSONL = path.join(ROOT, 'results/identity-contrastive-pairs.jsonl');

// Same deterministic workspace salt as the corpus seam, so readable anchors line up.
const WORKSPACE_SALT = 'versieve-amnesiac-v1';

function estateInputs() {
  const files = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).files;
  return files.map((f) => {
    const buf = fs.readFileSync(path.join(ESTATE_DIR, f.path));
    // WAV/deck surfaces go in as bytes; every other surface as text
    if (f.modality === 'audio' || f.modality === 'deck') return { name: f.path, bytes: buf };
    return { name: f.path, text: buf.toString('utf8') };
  });
}

// Word timeline for the audio seam: no local ASR weights on this CPU box, so the caption
// track's word timings are supplied the way a meeting recorder would — estate capture data,
// read from the estate file itself, never any GT manifest.
function captionWordTimestamps(inputs) {
  const vtt = inputs.find((i) => i.name.endsWith('.vtt'));
  if (!vtt) return [];
  const words = [];
  const cueRx = /(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  const lines = vtt.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = cueRx.exec(lines[i]);
    if (!m) continue;
    const toMs = (h, mi, s, ms) => Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(ms);
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const text = (lines[i + 1] || '').replace(/<[^>]+>/g, ' ').trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    tokens.forEach((word, w) => {
      words.push({
        word,
        startMs: startMs + Math.round(((endMs - startMs) * w) / tokens.length),
        endMs: startMs + Math.round(((endMs - startMs) * (w + 1)) / tokens.length),
      });
    });
  }
  return words;
}

export async function runIdentityContrastivePairs() {
  const inputs = estateInputs();
  const wordTimestamps = captionWordTimestamps(inputs);
  const corpus = await buildAmnesiacCorpus(inputs, { identity: 'readable' }, { wordTimestamps });
  const compiled = compileIdentityContrastivePairs(corpus);
  return { corpus, compiled };
}

// Writes both artifact files; exported so the seam test can run the same path and clean up after itself.
export async function runIdentityContrastivePairArtifacts() {
  const { compiled } = await runIdentityContrastivePairs();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSONL, compiled.jsonl);
  fs.writeFileSync(OUT_JSON, JSON.stringify({ kind: 'identity-contrastive-pairs', stage: 'K2', receipt: compiled.receipt }, null, 2));
  return compiled;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const compiled = await runIdentityContrastivePairArtifacts();
  console.log(JSON.stringify({ out: OUT_JSON, receipts: compiled.receipt }, null, 2));
}
