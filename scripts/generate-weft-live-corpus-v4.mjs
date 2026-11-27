#!/usr/bin/env node
/**
 * scripts/generate-weft-live-corpus-v4.mjs
 *
 * Regeneration of the multi-theme corpus with an explicit style axis. The v3
 * run (mistral-medium, 630 calls) failed the 2026-11-28 corpus audit: per-chunk
 * seeds reshuffle content but the voice never moves, so a confirmation run on
 * it could not distinguish style robustness from style memorization. This
 * driver passes per-chunk voice hints and a length mix through the same
 * fail-closed teacher resolution. Pair compilation stays a separate
 * `--corpus` CLI recompile (now with --dilute-masked-markers).
 *
 * Env: WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos plus
 * MISTRAL_API_KEY (sourced from .anthropic-key; never printed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocalTeacher, generateTeacherEstates } from './build-weft-training-pairs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20261129;
const PAIRS_TARGET = 50000;
// Same 10 business threads as v3; the new variable is the voice, not the topics.
const THEMES = [
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
// One voice per chunk, picked deterministically from the chunk seed.
const STYLE_HINTS = [
  'terse operational: clipped imperative sentences, no greetings, like a duty officer log',
  'formal executive: measured top-down prose, formal salutations, full titles',
  'chatty informal: contractions, asides, casual workplace tone',
  'technical jargon-heavy: acronym-dense engineer writing about systems and tickets',
  'procedural compliance: numbered clauses, passive voice, policy-citation tone',
  'narrative meeting style: quoted dialogue lines with hand-offs between speakers',
];
const LENGTH_HINT =
  'roughly half the documents 30 to 80 words, a third 100 to 250 words, and the rest 300 to 600 words; transcripts and reports should be among the longest';

const teacher = resolveLocalTeacher(process.env);
const startedAt = new Date();
console.error(`teacher: ${teacher.kind} ${teacher.model}, themes: ${THEMES.length}, pairsTarget: ${PAIRS_TARGET}, seed: ${SEED}`);
console.error(`voices: ${STYLE_HINTS.length}, lengthHint: on`);

const corpus = generateTeacherEstates(teacher, {
  themes: THEMES,
  pairsTarget: PAIRS_TARGET,
  seed: SEED,
  styleHints: STYLE_HINTS,
  lengthHint: LENGTH_HINT,
});
const finishedAt = new Date();

const corpusPath = path.join(ROOT, 'results', 'weft-fullscale-live-corpus-v4.tmp.json');
fs.writeFileSync(corpusPath, JSON.stringify(corpus) + '\n');

const usage = {
  kind: 'weft-api-teacher-usage',
  model: teacher.model,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  wallclockMs: finishedAt - startedAt,
  teacherCalls: teacher.usage.calls,
  promptTokens: teacher.usage.promptTokens,
  completionTokens: teacher.usage.completionTokens,
  totalTokens: teacher.usage.totalTokens,
  corpus: { docs: corpus.docs.length, links: corpus.links.length },
  themes: THEMES,
  styleHints: STYLE_HINTS,
  lengthHint: LENGTH_HINT,
  seed: SEED,
};
const usagePath = path.join(ROOT, 'results', 'weft-api-usage-v4.tmp.json');
fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');
console.error(`corpus: ${corpus.docs.length} docs / ${corpus.links.length} links -> ${path.relative(ROOT, corpusPath)}`);
console.error(`usage: ${teacher.usage.calls} calls, ${teacher.usage.totalTokens} tokens -> ${path.relative(ROOT, usagePath)}`);
