#!/usr/bin/env node
/**
 * scripts/generate-weft-paraphrase-strata.mjs
 *
 * The paraphrase-hard source-disjoint strata for the v5 corpus lane (issue #59):
 * the released benchmark's identity_disjoint bucket falls to BM25 at F1 1.0
 * because same-theme documents share vocabulary, so this driver adds two
 * deliberately lexical-overlap-resistant classes on top of an existing
 * profile's coverage corpus. Both strata are defined on the SOURCE axis
 * (issue #59 founder rulings, 2026-11-28): source = meeting/thread/ticket/
 * document anchor, theme = knowledge, identity = the person erasure axis only.
 *
 *   1. source-disjoint-same-theme positive: a same-theme cross-department
 *      linked pair from the coverage corpus where the SOURCE document is
 *      rewritten by the teacher as a DIFFERENT source (another meeting, thread,
 *      or ticket carrying the same talking point in entirely different wording,
 *      new names, new format, other department) and paired with the original
 *      ANCHOR document. Event anchors are derived at compile time from the
 *      coverage corpus's own link clusters: the event is the identity of the
 *      knowledge unit, people are attributes.
 *   2. source-disjoint near-topic negative: two teacher-written documents
 *      about adjacent but genuinely different talking points that deliberately
 *      share jargon so word overlap alone cannot separate them.
 *
 * The teacher only ever sees the source document with its identity surfaces
 * masked to bracketed role tokens, so no coverage-corpus identity can leak into
 * a paraphrase. Pair identity collisions are validated deterministically after
 * parsing, with a single renaming remap pass before a pair is dropped.
 *
 * Env: WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos (green-only
 * gate unchanged; local open-weight teachers refused here) plus MISTRAL_API_KEY.
 * The driver is main-guarded: importing the module makes no teacher call, and
 * --limit plus --profile are required so spend is always explicit. No key is
 * ever read, printed, or logged here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ORG_PROFILES, ORG_PROFILES_HELDOUT, SEED } from './generate-weft-live-corpus-v5.mjs';
import {
  API_TEACHER_LICENCE,
  TEACH_ATTEMPTS,
  WeftTeacherUnavailableError,
  completeWithRetry,
  maskText,
  parseLooseJson,
  resolveLocalTeacher,
  roleTokenMap,
} from './build-weft-training-pairs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STRATA_LICENCE = API_TEACHER_LICENCE;
// Upper bound of the negatives pass: a fixed count so the counterweight class
// always lands, capped so one run cannot silently double its spend.
export const NEGATIVES_CAP = 200;

export class WeftStrataConfigError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'WeftStrataConfigError';
    this.code = 'WEFT_STRATA_CONFIG';
    this.reason = reason;
  }
}

const idents = (doc) => (Array.isArray(doc && doc.identities) ? doc.identities : []);

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Verbatim founder-drafted prompts. The source document is appended below the
 * positive prompt so the "Below is one source document." line stays true.
 */
export function positivePrompt({ seed, paraphraseDepartment, cultureLabels, theme, sourceText }) {
  return [
    `Seed: ${seed}. Return only a JSON object. Below is one source document (a meeting, thread, ticket, or memo). Rewrite it into ONE new document that comes from a DIFFERENT source: a different meeting, thread, or ticket in the same company that happens to cover the same talking point and the same factual substance, but in entirely different wording. Rules: never reuse a noun, verb, adjective, or phrase from the source except unavoidable function words; use different sentence structures and a different document format than the source; the source has bracketed identity placeholders, and every person or organization in your output must be a NEW invented name, never a bracketed placeholder and never any name guessable from the source; the new source belongs to the ${JSON.stringify(paraphraseDepartment)} department (a different department than the source's); naming cultures to fit: ${cultureLabels}. Length: 120 to 350 words. Schema: {"docs":[{"id","format","department","theme","text","identities":[{"key","surface","class"}]}],"links":[]} where theme is exactly ${JSON.stringify(theme)} and the single doc id is "p-1".`,
    'SOURCE DOCUMENT:',
    String(sourceText),
  ].join('\n\n');
}

// Caveat: near-topic negatives rely on the teacher's own claim that the talking points differ.
export function negativePrompt({ seed, theme, cultureLabels, departments }) {
  return `Seed: ${seed}. Return only a JSON object. Produce TWO documents about the theme ${JSON.stringify(theme)}. The two documents must come from two DIFFERENT sources (for example two different meetings, threads, or tickets) and be about ADJACENT but genuinely DIFFERENT talking points (for example the same project but two different concerns, or the same event but two different disputes), and they must deliberately share as much vocabulary as possible (same jargon, same systems, same artifact names where applicable) so that word overlap alone cannot tell them apart; only the actual talking point differs. The two documents must be from different departments among these: ${JSON.stringify(Array.isArray(departments) ? departments : [])} and share zero identity keys; invent all names, fitting these naming cultures: ${cultureLabels}. Length: 100 to 300 words each. Schema: {"docs":[{"id","format","department","theme","text","identities":[{"key","surface","class"}]}],"links":[]} where both documents' theme is exactly ${JSON.stringify(theme)} and the ids are "n-1" and "n-2".`;
}

/**
 * Compile-time event anchors (issue #59): docs are grouped into events by the
 * coverage corpus's own structural links (transitive clusters), and each
 * event's id is the lexically smallest doc id in its cluster. A doc with no
 * links anchors its own event. The event is the identity of the knowledge unit;
 * people are attributes of it.
 */
export function deriveEventClusters(corpus) {
  const parent = new Map((corpus.docs || []).map((doc) => [doc.id, doc.id]));
  const find = (id) => {
    const root = parent.get(id);
    return root === undefined || root === id ? id : find(root);
  };
  for (const link of corpus.links || []) {
    if (!link || !parent.has(link.a) || !parent.has(link.b)) continue;
    const ra = find(link.a);
    const rb = find(link.b);
    if (ra === rb) continue;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  }
  const events = new Map();
  for (const id of parent.keys()) events.set(id, find(id));
  return events;
}

/**
 * Same-theme, cross-department linked pairs from a coverage corpus whose two
 * docs share no identity keys (the erasure-axis property, kept as validation
 * rather than the stratum's definition). The lexically smaller doc id is the
 * SOURCE (the paraphrase input) so the role split is deterministic; each source
 * doc yields one candidate, sorted by source id so sampling is deterministic
 * regardless of corpus link order. Every candidate carries the compile-time
 * event anchor of its cluster on the SOURCE axis.
 */
export function findParaphraseCandidates(corpus) {
  if (!corpus || !Array.isArray(corpus.docs) || !Array.isArray(corpus.links)) {
    throw new WeftStrataConfigError('the source corpus must be a { docs, links } JSON object', 'corpus-shape');
  }
  const byId = new Map(corpus.docs.map((doc) => [doc.id, doc]));
  const eventOf = deriveEventClusters(corpus);
  const seen = new Set();
  const out = [];
  for (const link of corpus.links) {
    const a = byId.get(link && link.a);
    const b = byId.get(link && link.b);
    if (!a || !b) continue;
    if (a.theme !== b.theme || a.department === b.department) continue;
    const keysA = new Set(idents(a).map((i) => i.key));
    const keysB = new Set(idents(b).map((i) => i.key));
    if ([...keysA].some((key) => keysB.has(key))) continue;
    const source = a.id < b.id ? a : b;
    const anchor = a.id < b.id ? b : a;
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    out.push({ source, anchor, theme: a.theme, sourceEventId: eventOf.get(source.id) });
  }
  out.sort((x, y) => (x.source.id < y.source.id ? -1 : 1));
  return out;
}

const fnv1a = (value) => {
  let h = 0x811c9dc5;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

// Pair seed: the constant SEED plus a stable hash of the source doc id, so a
// re-run over the same corpus reproduces every prompt byte for byte.
export const pairSeed = (docId) => (SEED + fnv1a(docId)) >>> 0;

function parseTeacherDocs(teacher, prompt, seed, minDocs) {
  for (let attempt = 0; attempt < TEACH_ATTEMPTS; attempt++) {
    let raw;
    try {
      raw = completeWithRetry(
        teacher,
        attempt === 0 ? prompt : prompt.replace(`Seed: ${seed}.`, `Seed: ${seed + attempt}.`)
      );
    } catch (err) {
      if (attempt === TEACH_ATTEMPTS - 1) throw err;
      continue;
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      if (attempt === TEACH_ATTEMPTS - 1) throw new WeftTeacherUnavailableError('teacher returned no JSON object', 'runtime-failed');
      continue;
    }
    let parsed = null;
    try {
      parsed = parseLooseJson(raw.slice(start, end + 1));
    } catch {
      parsed = null;
    }
    // A doc without non-empty text is a failed sample even when the docs array
    // is present: the 2026-11-28 smoke's negatives carried empty text because
    // the prompt's schema line never named the fields, and validation let it
    // through. Text presence is therefore part of the acceptance here.
    const hasText = parsed && Array.isArray(parsed.docs) && parsed.docs.length >= minDocs
      && parsed.docs.every((d) => d && typeof d.text === 'string' && d.text.trim().length > 0);
    if (hasText) return parsed;
    if (attempt === TEACH_ATTEMPTS - 1) {
      // The raw samples are the only way to diagnose a systematic response-shape
      // failure; they go to TEMP, never the repo.
      try {
        const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        fs.writeFileSync(path.join(os.tmpdir(), `weft-strata-reject-${stamp}.txt`), `${prompt}\n\n=== RAW (${raw.length} chars):\n${raw}\n`, { flag: 'wx' });
      } catch {
        // A failed dump never masks the real error.
      }
      throw new WeftTeacherUnavailableError('teacher JSON is missing the requested documents array', 'runtime-failed');
    }
  }
  throw new WeftTeacherUnavailableError('teacher sampling exhausted', 'runtime-failed');
}

const surfacesOf = (doc) =>
  new Set(
    idents(doc)
      .map((i) => String(i && i.surface || '').trim().toLowerCase())
      .filter((s) => s && !s.startsWith('['))
  );

const keysOf = (doc) =>
  new Set(
    idents(doc)
      .map((i) => String(i && i.key || '').trim().toLowerCase())
      .filter(Boolean)
  );

// Surfaces can be remapped; keys have no remap and drop through the same path.
const collides = (doc, againstDocs) => {
  const mineSurfaces = surfacesOf(doc);
  const mineKeys = keysOf(doc);
  const theirSurfaces = new Set(againstDocs.flatMap((d) => [...surfacesOf(d)]));
  const theirKeys = new Set(againstDocs.flatMap((d) => [...keysOf(d)]));
  return [...mineSurfaces].some((s) => theirSurfaces.has(s)) || [...mineKeys].some((k) => theirKeys.has(k));
};

const PLACEHOLDER_ECHO = /\[[A-Z]+_\d+\]/;
const echoesPlaceholder = (doc) =>
  PLACEHOLDER_ECHO.test(String(doc && doc.text || '')) || idents(doc).some((i) => PLACEHOLDER_ECHO.test(String(i && i.surface || '')));

/**
 * One deterministic remap pass: every paraphrase surface that collides with an
 * identity surface of the anchor or the source is renamed with the next free
 * name from the profile's name cultures, and every occurrence in the text is
 * replaced with it. Returns the remapped doc, or null when no free name is
 * available. The caller re-checks afterwards and drops on any residual clash.
 */
export function remapIdentityCollisions(doc, againstDocs, cultureNames, cursor) {
  const forbidden = new Set(againstDocs.flatMap((d) => [...surfacesOf(d)]));
  const taken = new Set(surfacesOf(doc));
  const out = { ...doc, identities: idents(doc).map((i) => ({ ...i })), text: String(doc.text || '') };
  let renamed = 0;
  for (const ident of out.identities) {
    const original = String(ident && ident.surface || '').trim();
    const lc = original.toLowerCase();
    if (!lc || !forbidden.has(lc) || lc.startsWith('[')) continue;
    let pick = null;
    for (let n = 0; n < cultureNames.length && !pick; n++) {
      if (!cultureNames.length) break;
      const cand = cultureNames[(cursor + renamed + n) % cultureNames.length];
      if (cand && !forbidden.has(cand.toLowerCase()) && !taken.has(cand.toLowerCase())) pick = cand;
    }
    if (!pick) return null;
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out.text = out.text.replace(new RegExp(escaped, 'g'), pick);
    ident.surface = pick;
    ident.key = typeof ident.key === 'string' ? `ph-renamed-${slug(pick)}` : ident.key;
    taken.delete(lc);
    taken.add(pick.toLowerCase());
    renamed += 1;
  }
  return out;
}

const normalizedDoc = (raw, id, theme) => ({
  ...(raw && typeof raw === 'object' ? raw : {}),
  id,
  format: String((raw && raw.format) || 'email'),
  department: String((raw && raw.department) || 'unknown'),
  theme,
  text: String((raw && raw.text) || ''),
  identities: idents(raw),
  source: 'synthetic-estate',
});

// Pure-JS lexical overlap: distinct content words (length >= 4, lowercased)
// shared by both sides over their union; no dependencies.
export function lexicalOverlap(aText, bText) {
  const tokens = (text) => new Set(String(text).toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length >= 4));
  const a = tokens(aText);
  const b = tokens(bText);
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

const mean = (values) => (values.length ? values.reduce((acc, n) => acc + n, 0) / values.length : 0);

/**
 * Run one profile's strata pass. options: { limit (required int), teacher
 * (stub; defaults to resolveLocalTeacher(env), api-only), env, corpusPath,
 * outDir }. Returns { receipt, pairs, pairsPath, receiptPath }.
 */
export function runStrata(profileId, options = {}) {
  const profile = [...ORG_PROFILES, ...ORG_PROFILES_HELDOUT].find((p) => p.id === profileId);
  if (!profile) {
    throw new WeftStrataConfigError(
      `unknown org profile ${JSON.stringify(profileId)}; expected one of ${JSON.stringify([...ORG_PROFILES, ...ORG_PROFILES_HELDOUT].map((p) => p.id))}`,
      'profile-unknown'
    );
  }
  const limit = options.limit;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new WeftStrataConfigError('--limit must be a positive integer so spend stays explicit', 'limit-invalid');
  }
  const teacher = options.teacher || resolveLocalTeacher(options.env || process.env);
  // Green-only licence gate unchanged: this driver accepts the audited
  // mistral-api-tos API teacher path only, never a local open-weight teacher.
  if (teacher.kind !== 'api') {
    throw new WeftTeacherUnavailableError(
      'the paraphrase strata driver runs only the audited mistral-api-tos API teacher',
      'licence-not-api'
    );
  }
  const corpusPath = options.corpusPath || path.join(ROOT, 'results', `weft-fullscale-live-corpus-v5-${profile.id}.tmp.json`);
  if (!fs.existsSync(corpusPath)) {
    throw new WeftStrataConfigError(
      `no coverage corpus for profile ${profile.id}: ${corpusPath}; run scripts/generate-weft-live-corpus-v5.mjs for this profile before the strata pass`,
      'corpus-absent'
    );
  }
  let corpus;
  try {
    corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  } catch (err) {
    throw new WeftStrataConfigError(`coverage corpus is unreadable: ${err.message}`, 'corpus-unreadable');
  }

  const cultureNames = (Array.isArray(profile.nameCultures) ? profile.nameCultures : []).flatMap(
    (c) => (Array.isArray(c && c.names) ? c.names : [])
  );
  const cultureLabels = JSON.stringify(
    (Array.isArray(profile.nameCultures) ? profile.nameCultures : []).map((c) => (c && c.label) || null).filter(Boolean)
  );
  const candidates = findParaphraseCandidates(corpus).slice(0, limit);
  const startedAt = new Date();
  const sampledPrompts = { positive: null, negative: null };
  const pairs = [];
  const droppedIdentityCollisions = { count: 0 };
  const droppedNoEligibleDepartment = { count: 0 };
  const droppedPlaceholderEcho = { count: 0 };
  const positivesOverlap = { sourceToParaphrase: [], anchorToParaphrase: [], perPair: [] };
  const anchorToSource = { values: [], perPair: [] };
  const negativesOverlap = { aToB: [], perPair: [] };
  const departments = Array.isArray(profile.departments) ? profile.departments : [];

  for (const cand of candidates) {
    const seed = pairSeed(cand.source.id);
    // A third department, derived from the pair seed so it is stable per pair
    // and differs from both linked docs; no third department means drop.
    const eligibleDepartments = departments.filter(
      (d) => d !== cand.source.department && d !== cand.anchor.department
    );
    if (!eligibleDepartments.length) {
      // Audit note 2026-11-28: this fires before any teacher call, so it costs
      // nothing; it is a candidate-shape drop, not an identity collision.
      droppedNoEligibleDepartment.count += 1;
      continue;
    }
    const paraphraseDepartment = eligibleDepartments[seed % eligibleDepartments.length];
    const maskedSource = maskText(cand.source.text, [cand.source], roleTokenMap([cand.source]));
    const prompt = positivePrompt({
      seed,
      paraphraseDepartment,
      cultureLabels,
      theme: cand.theme,
      sourceText: maskedSource,
    });
    if (sampledPrompts.positive === null) sampledPrompts.positive = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, 1);
    let paraphrase = normalizedDoc(parsed.docs[0], `ph-${cand.source.id}`, cand.theme);
    if (echoesPlaceholder(paraphrase)) {
      droppedPlaceholderEcho.count += 1;
      continue;
    }
    const against = [cand.anchor, cand.source];
    if (collides(paraphrase, against)) {
      paraphrase = remapIdentityCollisions(
        paraphrase,
        against,
        cultureNames,
        cultureNames.length ? seed % cultureNames.length : 0
      );
      if (!paraphrase || collides(paraphrase, against)) {
        droppedIdentityCollisions.count += 1;
        continue;
      }
    }
    const sourceToParaphrase = lexicalOverlap(cand.source.text, paraphrase.text);
    const anchorToParaphrase = lexicalOverlap(cand.anchor.text, paraphrase.text);
    positivesOverlap.sourceToParaphrase.push(sourceToParaphrase);
    positivesOverlap.anchorToParaphrase.push(anchorToParaphrase);
    positivesOverlap.perPair.push({
      sourceDocId: cand.source.id,
      sourceToParaphrase,
      anchorToParaphrase,
    });
    // Baseline: the pre-paraphrase anchor-to-source overlap the smoke gate compares against.
    const anchorToSourceOverlap = lexicalOverlap(cand.anchor.text, cand.source.text);
    anchorToSource.values.push(anchorToSourceOverlap);
    anchorToSource.perPair.push({ sourceDocId: cand.source.id, overlap: anchorToSourceOverlap });
    pairs.push({
      label: 'source-disjoint-same-theme-positive',
      a: cand.anchor.id,
      b: paraphrase,
      sourceDocId: cand.source.id,
      corpusProfile: profile.id,
      provenance: `paraphrase-of:${cand.source.id}`,
      theme: cand.theme,
      // Event anchors on the source axis: the coverage cluster the talking
      // point originally appeared in, and the paraphrase's own new source.
      eventA: cand.sourceEventId,
      eventB: paraphrase.id,
    });
  }

  const themes = [...new Set(corpus.docs.map((d) => d.theme))].sort();
  const negativeCount = Math.min(limit, NEGATIVES_CAP);
  for (let i = 0; i < negativeCount && themes.length; i++) {
    const seed = (SEED * 1000003 + i * 9176) >>> 0;
    const theme = themes[i % themes.length];
    const prompt = negativePrompt({ seed, theme, cultureLabels, departments });
    if (sampledPrompts.negative === null) sampledPrompts.negative = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, 2);
    let docA = normalizedDoc(parsed.docs[0], `phn-${i}-1`, theme);
    let docB = normalizedDoc(parsed.docs[1], `phn-${i}-2`, theme);
    if (collides(docB, [docA])) {
      docB = remapIdentityCollisions(docB, [docA], cultureNames, cultureNames.length ? seed % cultureNames.length : 0);
      if (!docB || collides(docB, [docA])) {
        droppedIdentityCollisions.count += 1;
        continue;
      }
    }
    const overlap = lexicalOverlap(docA.text, docB.text);
    negativesOverlap.aToB.push(overlap);
    negativesOverlap.perPair.push({ aId: docA.id, bId: docB.id, overlap });
    pairs.push({
      label: 'source-disjoint-near-topic-negative',
      a: docA,
      b: docB,
      corpusProfile: profile.id,
      provenance: 'teacher-generated-near-topic',
      theme,
      // Both sides are new invented sources; each anchors its own event.
      eventA: docA.id,
      eventB: docB.id,
    });
  }
  const finishedAt = new Date();
  const usage = teacher.usage || {};
  const receipt = {
    kind: 'weft-paraphrase-strata-receipt',
    profile: profile.id,
    seed: SEED,
    sourceCorpus: path.relative(ROOT, corpusPath).split(path.sep).join('/'),
    axis: 'source-disjoint same-theme (issue #59 founder rulings, 2026-11-28); identity disjointness is kept only as the erasure-axis property',
    counts: {
      sourceDisjointPositive: positivesOverlap.sourceToParaphrase.length,
      sourceDisjointNegative: negativesOverlap.aToB.length,
      droppedIdentityCollisions: droppedIdentityCollisions.count,
      droppedNoEligibleDepartment: droppedNoEligibleDepartment.count,
      droppedPlaceholderEcho: droppedPlaceholderEcho.count,
    },
    positivesAnchorToSource: {
      mean: mean(anchorToSource.values),
      perPair: anchorToSource.perPair,
    },
    negativesCaveat: 'near-topic negatives: talking-point difference is teacher-claimed, not mechanically verified',
    usage: {
      calls: usage.calls || 0,
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: usage.totalTokens || 0,
      wallclockMs: finishedAt - startedAt,
    },
    prompts: sampledPrompts,
    licence: teacher.licence || null,
    lexicalOverlap: {
      formula: 'jaccard over distinct content words (tokens of length >= 4, lowercased) shared by both sides',
      positivesSourceToParaphrase: mean(positivesOverlap.sourceToParaphrase),
      positivesAnchorToParaphrase: mean(positivesOverlap.anchorToParaphrase),
      negativesAToB: mean(negativesOverlap.aToB),
      positivesPerPair: positivesOverlap.perPair,
      negativesPerPair: negativesOverlap.perPair,
    },
  };
  const outDir = options.outDir || path.join(ROOT, 'results', `weft-paraphrase-strata-v5-${profile.id}`);
  fs.mkdirSync(outDir, { recursive: true });
  const pairsPath = path.join(outDir, 'strata-pairs.jsonl');
  const receiptPath = path.join(outDir, 'receipt.json');
  const pairsJsonl = pairs.map((p) => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : '');
  fs.writeFileSync(pairsPath, pairsJsonl);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  return {
    receipt,
    pairs,
    pairsPath,
    receiptPath,
    files: {
      pairs: path.relative(ROOT, pairsPath).split(path.sep).join('/'),
      receipt: path.relative(ROOT, receiptPath).split(path.sep).join('/'),
    },
  };
}

function cliValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

// The spending path runs only when executed as a script; importing the module
// (for the contract tests) makes no teacher call and writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const limitRaw = cliValue('--limit');
  const limit = limitRaw === null ? NaN : Number.parseInt(limitRaw, 10);
  const outDir = cliValue('--out') || undefined;
  try {
    const summary = runStrata(cliValue('--profile'), { limit, outDir });
    console.error(
      `strata: ${summary.receipt.counts.sourceDisjointPositive} positives, ${summary.receipt.counts.sourceDisjointNegative} negatives, ${summary.receipt.counts.droppedIdentityCollisions} dropped -> ${summary.files.pairs}`
    );
    console.error(
      `overlap: source-to-paraphrase ${summary.receipt.lexicalOverlap.positivesSourceToParaphrase}, anchor-to-paraphrase ${summary.receipt.lexicalOverlap.positivesAnchorToParaphrase}, negatives ${summary.receipt.lexicalOverlap.negativesAToB}`
    );
    console.error(
      `usage: ${summary.receipt.usage.calls} calls, ${summary.receipt.usage.totalTokens} tokens, ${summary.receipt.usage.wallclockMs}ms -> ${summary.files.receipt}`
    );
  } catch (err) {
    console.error(`strata driver failed: ${err.code || err.name} ${err.reason ? `(${err.reason})` : ''}: ${err.message}`);
    process.exit(2);
  }
}
