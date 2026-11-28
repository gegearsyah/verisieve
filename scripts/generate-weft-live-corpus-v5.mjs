#!/usr/bin/env node
/**
 * scripts/generate-weft-live-corpus-v5.mjs
 *
 * The W5 corpus track: three org-shape corpora, one per generated profile, so the
 * style-robustness confirmation of W4 is no longer trained on a single generic
 * company estate. Three variables move at once (all gated behind the same Opus
 * pre-spend audit):
 *
 *   1. Org profiles: each profile re-skins the teacher prompt with its own
 *      industry context, departments, format mix, vendor pool, and invented
 *      cast (name cultures), so the "Northwind Supply Co is every vendor" tic
 *      and the single-estate shape go away.
 *   2. Length bands: v4's free-form length hint produced max 240 words (p90 95)
 *      because nothing in the prompt forced length and no validation checked
 *      it. v5 replaces the hint with a per-call length band picked
 *      deterministically by the chunk seed (uniformly short / medium / long),
 *      and a long-band call asks for at most 3 documents so the teacher has
 *      room to write 300 to 600 words. The compiler has no deterministic length
 *      validation (that is a known gap, not a claim); the driver records the
 *      observed word-count distribution per profile in the usage files so the
 *      audit can check whether the band landed. What the fix relies on, stated
 *      honestly: the teacher honoring an explicit per-call minimum, which the
 *      real API run alone can prove.
 *   3. Masked-structural slice: the recompile (not this driver) adds
 *      --exclude-within-chunk --include-masked-structural --dilute-masked-markers
 *      so the small identity-masked-positive bucket v4 lost comes back as a
 *      deterministic 5 percent slice of within-chunk structural links.
 *
 * Env: WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos plus
 * MISTRAL_API_KEY (sourced from .anthropic-key; never printed). No API call is
 * made anywhere in the repo tests; this driver spends only when run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveLocalTeacher, generateTeacherEstates } from './build-weft-training-pairs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SEED = 20261130;
export const PAIRS_TARGET = 50000;
// Same 10 business threads as v4; the new variables are the org shape, not the topics.
export const THEMES = [
  'annual budget planning',
  'summer team offsite logistics',
  'api gateway migration',
  'customer onboarding revamp',
  'supplier risk review',
  'product launch readiness',
  'data retention audit',
  'remote work stipend policy',
  'warehouse safety inspection',
  'q3 earnings call preparation',
];
// The v4 voices stay in play; the voice axis is orthogonal to the org axis.
export const STYLE_HINTS = [
  'terse operational: clipped imperative sentences, no greetings, like a duty officer log',
  'formal executive: measured top-down prose, formal salutations, full titles',
  'chatty informal: contractions, asides, casual workplace tone',
  'technical jargon-heavy: acronym-dense engineer writing about systems and tickets',
  'procedural compliance: numbered clauses, passive voice, policy-citation tone',
  'narrative meeting style: quoted dialogue lines with hand-offs between speakers',
];
// Per-call length bands replace the v4 free-form hint. Uniform thirds: v4 asked
// for a sixth of the corpus at 300 to 600 words and got none; a full third of
// calls are long-band, which is the acceptance bar for the fix.
export const LENGTH_BANDS = [
  { label: 'short', min: 30, max: 80 },
  { label: 'medium', min: 100, max: 250 },
  { label: 'long', min: 300, max: 600 },
];
// Long-band calls carry at most 3 documents so a single teacher completion can
// plausibly carry 3 x 300-plus words without truncating at its output limit.
export const LONG_BAND_CHUNK = 3;

// Three genuinely different company shapes. Departments, formats, vendor pools,
// and name cultures are per profile; the vendor pool exists so no vendor name is
// the universal counterparty, and the name cultures drive each profile's own
// invented cast (both the roster and the chunk-unique names).
export const ORG_PROFILES = [
  {
    id: 'regional-logistics',
    context: 'a regional freight and warehousing operator running three depots, a small owned fleet, and port drayage contracts',
    departments: ['operations', 'warehouse', 'dispatch', 'fleet-maintenance', 'customer-service', 'finance'],
    formats: ['email', 'ticket', 'table', 'transcript', 'pdf-scan', 'slides'],
    vendorPool: [
      'Brantling Freight Systems',
      'Ostmark Pallet Supply',
      'Calder & Rime Insurance',
      'Tullamore Fuel Services',
      'Vexler Telematics',
    ],
    nameCultures: [
      { label: 'Flemish-Dutch', names: ['Marloes Verdonk', 'Joris Bakhuijzen', 'Anouk Slegers', 'Wouter Dillen', 'Brecht Oosterlinck'] },
      { label: 'Polish', names: ['Zofia Brzoska', 'Marek Wilczek', 'Halina Sokolowska', 'Patrycja Ruman'] },
      { label: 'Ghanaian', names: ['Kwabena Mensah', 'Akosua Boateng', 'Yaw Ofori'] },
    ],
  },
  {
    id: 'hospital-network',
    context: 'a regional hospital network running two acute hospitals, an outpatient clinic, and a central pharmacy',
    departments: ['clinical', 'nursing', 'pharmacy', 'procurement', 'compliance', 'facilities'],
    formats: ['email', 'transcript', 'pdf-scan', 'table', 'ticket', 'slides'],
    vendorPool: [
      'Medivar Supply Group',
      'Corvale Diagnostics',
      'Lindqvist Facility Services',
      'Halbrook Sterilization',
      'Osier Pharmaceutical Wholesalers',
    ],
    nameCultures: [
      { label: 'Nordic', names: ['Astrid Lindqvist', 'Eero Halvorsen', 'Sanna Kettunen', 'Vilhelm Rosengren', 'Aino Merilainen'] },
      { label: 'Filipino', names: ['Marisol Reyes', 'Dante Villanueva', 'Corazon Bautista', 'Esteban Limjoco'] },
      { label: 'German', names: ['Henrik Ottweiler', 'Beate Kesselring', 'Lena Kienzle'] },
    ],
  },
  {
    id: 'municipal-office',
    context: 'a mid-sized municipal government office handling permits, public works, parks, and resident services',
    departments: ['permits', 'public-works', 'clerks', 'parks', 'utilities', 'communications'],
    formats: ['pdf-scan', 'email', 'table', 'ticket', 'transcript', 'slides'],
    vendorPool: [
      'Gresham Civil Contractors',
      'Perrine Asphalt & Supply',
      'Cobblestone Fleet Leasing',
      'Avery Hall Print Services',
      'Merrow Consulting Group',
    ],
    nameCultures: [
      { label: 'Southern US', names: ['Delores Whitfield', 'Ray Brumlow', 'Charlene Dupree', 'Everett Mauldin', 'Tessa Faircloth'] },
      { label: 'Vietnamese', names: ['Bao Nguyen-Tran', 'Linh Pham', 'Duc Tran', 'Hanh Vo'] },
      { label: 'Catalan', names: ['Roser Planella', 'Enric Busquets', 'Nuria Salvat'] },
    ],
  },
];

const wordsOf = (text) => String(text).split(/\s+/).filter(Boolean).length;
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function lengthObserved(docs) {
  const counts = docs.map((doc) => wordsOf(doc.text)).sort((a, b) => a - b);
  return {
    min: counts[0] ?? 0,
    p50: percentile(counts, 0.5),
    p90: percentile(counts, 0.9),
    max: counts[counts.length - 1] ?? 0,
    over300: counts.filter((n) => n >= 300).length,
    bandCallsTarget: LENGTH_BANDS.map((b) => ({ label: b.label, min: b.min, max: b.max })),
  };
}

function runProfile(profile) {
  const corpusPath = path.join(ROOT, 'results', `weft-fullscale-live-corpus-v5-${profile.id}.tmp.json`);
  if (fs.existsSync(corpusPath)) {
    console.error(`profile: ${profile.id} skipped, final corpus already exists: ${path.relative(ROOT, corpusPath)}`);
    return null;
  }
  const startedAt = new Date();
  // Per-profile chunk checkpoint: every accepted chunk appends one line, so a
  // crash (including a single unrecoverable teacher failure after the 5 backoff
  // retries) loses at most one chunk. On restart the stored chunks are served
  // verbatim via resumeChunk, so the resumed corpus stays byte-identical to an
  // uninterrupted run (chunk seeds are pure functions of baseSeed, themeIndex,
  // and chunk; the loop positions and id namespacing are unchanged).
  const checkpointPath = path.join(ROOT, 'results', `weft-v5-checkpoint-${profile.id}.tmp.jsonl`);
  const checkpoint = new Map();
  if (fs.existsSync(checkpointPath)) {
    // A mid-write crash can leave a truncated trailing line; appendFileSync on
    // Windows is not atomic, so ignore unparseable lines and keep the rest.
    for (const line of fs.readFileSync(checkpointPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && Number.isInteger(rec.themeIndex) && Number.isInteger(rec.chunk) && rec.parsed) {
          checkpoint.set(`${rec.themeIndex}:${rec.chunk}`, rec.parsed);
        }
      } catch {
        // Malformed (truncated) checkpoint line: skip it.
      }
    }
  }
  let resumedChunks = 0;
  // One teacher per profile so the usage counters stay per profile.
  const teacher = resolveLocalTeacher(process.env);
  console.error(`profile: ${profile.id}, teacher: ${teacher.kind} ${teacher.model}, themes: ${THEMES.length}, pairsTarget: ${PAIRS_TARGET}, seed: ${SEED}`);
  const corpus = generateTeacherEstates(teacher, {
    themes: THEMES,
    pairsTarget: PAIRS_TARGET,
    seed: SEED,
    styleHints: STYLE_HINTS,
    orgProfile: profile,
    lengthBands: LENGTH_BANDS,
    longBandChunkSize: LONG_BAND_CHUNK,
    chunkRecord: (themeIndex, chunk, parsed) => {
      fs.appendFileSync(checkpointPath, JSON.stringify({ themeIndex, chunk, parsed }) + '\n');
    },
    resumeChunk: (themeIndex, chunk) => {
      const stored = checkpoint.get(`${themeIndex}:${chunk}`);
      if (stored) resumedChunks += 1;
      return stored;
    },
  });
  const finishedAt = new Date();

  fs.writeFileSync(corpusPath, JSON.stringify(corpus) + '\n');

  const bandHit = lengthObserved(corpus.docs);
  const usage = {
    kind: 'weft-api-teacher-usage',
    model: teacher.model,
    orgProfile: profile.id,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    wallclockMs: finishedAt - startedAt,
    teacherCalls: teacher.usage.calls,
    promptTokens: teacher.usage.promptTokens,
    completionTokens: teacher.usage.completionTokens,
    totalTokens: teacher.usage.totalTokens,
    resumedChunks,
    corpus: { docs: corpus.docs.length, links: corpus.links.length },
    themes: THEMES,
    styleHints: STYLE_HINTS,
    lengthBands: LENGTH_BANDS,
    longBandChunk: LONG_BAND_CHUNK,
    lengthObserved: bandHit,
    seed: SEED,
  };
  const usagePath = path.join(ROOT, 'results', `weft-api-usage-v5-${profile.id}.tmp.json`);
  fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');
  fs.rmSync(checkpointPath, { force: true });
  console.error(`corpus: ${corpus.docs.length} docs / ${corpus.links.length} links -> ${path.relative(ROOT, corpusPath)}`);
  console.error(`length: min ${bandHit.min}, p50 ${bandHit.p50}, p90 ${bandHit.p90}, max ${bandHit.max}, over300 ${bandHit.over300}`);
  return {
    id: profile.id,
    seed: SEED,
    model: teacher.model,
    corpus: { docs: corpus.docs.length, links: corpus.links.length },
    usage: {
      teacherCalls: teacher.usage.calls,
      promptTokens: teacher.usage.promptTokens,
      completionTokens: teacher.usage.completionTokens,
      totalTokens: teacher.usage.totalTokens,
      resumedChunks,
    },
    lengthObserved: bandHit,
    files: {
      corpus: path.relative(ROOT, corpusPath),
      usage: path.relative(ROOT, usagePath),
    },
  };
}

// The spending path runs only when executed as a script; importing the module
// (for a stub smoke test, or the audit) makes no teacher call.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const total = { teacherCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const summaries = ORG_PROFILES.map((profile) => {
  const summary = runProfile(profile);
  if (!summary) return null;
  for (const key of Object.keys(total)) total[key] += summary.usage[key];
  return summary;
}).filter(Boolean);

/**
 * Combined usage summary: the v4 usage shape plus a per-profile breakdown, so
 * the ledger and the audit can read the whole run from one file.
 */
const combined = {
  kind: 'weft-api-teacher-usage',
  model: [...new Set(summaries.map((s) => s.model))].join(', '),
  orgProfiles: ORG_PROFILES.map((p) => p.id),
  teacherCalls: total.teacherCalls,
  promptTokens: total.promptTokens,
  completionTokens: total.completionTokens,
  totalTokens: total.totalTokens,
  corpus: summaries.reduce((acc, s) => ({ docs: acc.docs + s.corpus.docs, links: acc.links + s.corpus.links }), { docs: 0, links: 0 }),
  themes: THEMES,
  styleHints: STYLE_HINTS,
  lengthBands: LENGTH_BANDS,
  longBandChunk: LONG_BAND_CHUNK,
  seed: SEED,
  profiles: summaries.map((s) => ({ id: s.id, seed: s.seed, model: s.model, corpus: s.corpus, usage: s.usage, lengthObserved: s.lengthObserved, files: s.files })),
};
const usagePath = path.join(ROOT, 'results', 'weft-api-usage-v5.tmp.json');
fs.writeFileSync(usagePath, JSON.stringify(combined, null, 2) + '\n');
console.error(`total: ${total.teacherCalls} calls, ${total.totalTokens} tokens -> ${path.relative(ROOT, usagePath)}`);
}
