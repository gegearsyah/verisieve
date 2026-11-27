#!/usr/bin/env node
/**
 * scripts/generate-weft-live-corpus-v3.mjs
 *
 * One-shot driver for the multi-theme corpus regeneration (the W4 confirmation
 * run, founder ruling 2026-11-28). The compiler CLI cannot pass a custom
 * themes list, so this driver resolves the API teacher, generates the corpus
 * with an expanded theme set, and saves the raw corpus plus an honest usage
 * record. Pair compilation stays a separate `--corpus` CLI recompile.
 *
 * Env: WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos plus
 * MISTRAL_API_KEY (sourced from .anthropic-key; never printed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocalTeacher, generateTeacherEstates } from './build-weft-training-pairs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20261128;
const PAIRS_TARGET = 50000;
// shortcut: the same 6 default themes plus 4 new business threads; the wider
// set is the multi-theme half of the regeneration ruling, style variance comes
// from the per-chunk seeds and the mixed-format prompt
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

const teacher = resolveLocalTeacher(process.env);
const startedAt = new Date();
console.error(`teacher: ${teacher.kind} ${teacher.model}, themes: ${THEMES.length}, pairsTarget: ${PAIRS_TARGET}, seed: ${SEED}`);

const corpus = generateTeacherEstates(teacher, { themes: THEMES, pairsTarget: PAIRS_TARGET, seed: SEED });
const finishedAt = new Date();

const corpusPath = path.join(ROOT, 'results', 'weft-fullscale-live-corpus-v3.tmp.json');
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
  seed: SEED,
};
const usagePath = path.join(ROOT, 'results', 'weft-api-usage-v3.tmp.json');
fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');
console.error(`corpus: ${corpus.docs.length} docs / ${corpus.links.length} links -> ${path.relative(ROOT, corpusPath)}`);
console.error(`usage: ${teacher.usage.calls} calls, ${teacher.usage.totalTokens} tokens -> ${path.relative(ROOT, usagePath)}`);
