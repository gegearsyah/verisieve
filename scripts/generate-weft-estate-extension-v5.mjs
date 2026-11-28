#!/usr/bin/env node
/**
 * scripts/generate-weft-estate-extension-v5.mjs
 *
 * The v5 estate extension (issue #59 rulings, 2026-11-28): the coverage corpora
 * stay person-anchored (people are the erasure axis), and this driver adds the
 * classes the rulings ask for on top of an existing profile's coverage corpus:
 *
 *   1. source-disjoint compliance knowledge units, PEOPLE-FREE (identities
 *      must be empty; verified mechanically, never teacher-claimed) and
 *      carrying the source-kind axis (sourceKind "compliance-doc").
 *   2. a non-knowledge negative class (greetings and logistics chatter that
 *      must NOT link), purity enforced by the knowledge-density filter: a
 *      chatter doc that passes the filter is dropped, never emitted.
 *   3. company-private knowledge units: recipe-like confidential knowledge
 *      carried across sources (master memo, two meetings, a derivative
 *      thread note, a document scan), every doc tagged with a
 *      knowledgeUnitId, people as attributes. The unit overlay corpus is
 *      written in { docs, links, knowledgeUnits } shape so
 *      scripts/prove-weft-private-unit-erasure.mjs can regenerate it minus
 *      one unit and produce a byte-diff erasure receipt.
 *
 * Pair emission follows the compiler pair format (id, policy, pairType,
 * label, textA, textB, provenance) so the Phase 2 merge is concatenation.
 * Event anchors follow the #59 naming: source = the anchor kind, theme = the
 * knowledge, identity = the person erasure axis only. The knowledge unit is
 * the identity of a private unit: eventA/eventB carry the knowledgeUnitId.
 *
 * Env: WEFT_TEACHER_KIND=api WEFT_TEACHER_LICENCE=mistral-api-tos plus
 * MISTRAL_API_KEY (sourced from .anthropic-key; never printed). Main-guarded:
 * importing the module makes no teacher call, and --limit plus --profile are
 * required so spend stays explicit.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ORG_PROFILES, SEED } from './generate-weft-live-corpus-v5.mjs';
import { lexicalOverlap } from './generate-weft-paraphrase-strata.mjs';
import {
  API_TEACHER_LICENCE,
  PAIR_POLICY,
  TEACH_ATTEMPTS,
  WeftTeacherUnavailableError,
  completeWithRetry,
  parseLooseJson,
  resolveLocalTeacher,
} from './build-weft-training-pairs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSION_LICENCE = API_TEACHER_LICENCE;
// Private units per profile: fixed, so the erasure targets always land; two
// units also give the cross-unit negative class its counterpart.
export const PRIVATE_UNITS_PER_PROFILE = 2;
// Private-unit doc shape: the master memo, two meeting transcripts, a
// derivative thread note, and a document scan, in this emitted order.
export const PRIVATE_UNIT_SOURCE_KINDS = ['memo', 'meeting', 'meeting', 'thread', 'document'];
export const PRIVATE_UNIT_DOC_COUNT = PRIVATE_UNIT_SOURCE_KINDS.length;
export const SOURCE_KINDS = ['meeting', 'thread', 'ticket', 'memo', 'compliance-doc', 'document'];

export class WeftExtensionConfigError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'WeftExtensionConfigError';
    this.code = 'WEFT_EXTENSION_CONFIG';
    this.reason = reason;
  }
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

/**
 * Source-kind axis (issue #59): a deterministic derivation for docs whose
 * teacher output carries no sourceKind, and the recorded rule for coverage
 * docs, which get the axis at compile time without any re-spend.
 */
export function deriveSourceKind(doc) {
  const format = String((doc && doc.format) || '').toLowerCase();
  if (format === 'transcript') return 'meeting';
  if (format === 'ticket') return 'ticket';
  if (format === 'email') return 'thread';
  if (format === 'memo') return 'memo';
  return 'document';
}

export function normalizeSourceKind(doc, fallback) {
  const claimed = String((doc && doc.sourceKind) || '').trim().toLowerCase();
  if (SOURCE_KINDS.includes(claimed)) return claimed;
  if (fallback) return fallback;
  return deriveSourceKind(doc);
}

const contentWords = (text) =>
  new Set(String(text).toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length >= 4));

/**
 * The knowledge-density filter (issue #59 ruling 5): a document is a
 * knowledge unit iff it carries at least MIN_CONTENT_WORDS distinct content
 * words AND at least one digit. A lexical-density heuristic, honestly
 * labeled: it is not a semantics test, and its measured effect is recorded
 * in the receipt rather than asserted.
 */
export const KNOWLEDGE_MIN_CONTENT_WORDS = 12;
export function knowledgeDensity(text) {
  const words = contentWords(text);
  return {
    distinctContentWords: words.size,
    hasDigit: /\d/.test(String(text)),
  };
}
export function passesKnowledgeThreshold(text) {
  const d = knowledgeDensity(text);
  return d.distinctContentWords >= KNOWLEDGE_MIN_CONTENT_WORDS && d.hasDigit;
}

// Invented compliance frameworks in the style the ruling names as valid
// source types (APP rules, NIST AI RMF, ISO 42001); the teacher writes
// realistic framework-shaped excerpts, never real copyrighted text.
const COMPLIANCE_FRAMEWORKS = [
  { id: 'app-rules', label: 'the App Privacy Rules (an APP-rules-like consumer privacy code)' },
  { id: 'meridian-ai-rmf', label: 'the Meridian AI Risk Framework (a NIST AI RMF-like risk profile)' },
  { id: 'greenleaf-42001', label: 'the GreenLeaf 42001 Management Standard (an ISO 42001-like management standard)' },
];

const pickFrameworks = (seed) => {
  const a = COMPLIANCE_FRAMEWORKS[seed % COMPLIANCE_FRAMEWORKS.length];
  const b = COMPLIANCE_FRAMEWORKS[(seed + 1 + (seed % 2)) % COMPLIANCE_FRAMEWORKS.length];
  return b.id === a.id ? COMPLIANCE_FRAMEWORKS[(seed + 1) % COMPLIANCE_FRAMEWORKS.length] : b;
};

export function compliancePositivePrompt({ seed, theme, frameworkA, frameworkB }) {
  return `Seed: ${seed}. Return only a JSON object. Produce TWO documents that state the SAME control requirement about the theme ${JSON.stringify(theme)}: one excerpted from ${frameworkA.label} and one excerpted from ${frameworkB.label}. The two documents carry the same knowledge (the same requirement, the same rule substance, the same obligation) but each in its own framework's wording and structure. Rules: ZERO people anywhere: no person names, no person references, no invented names of any kind, and the identities array must be empty for both documents. Set sourceKind to "compliance-doc" and department to "compliance" on both documents. Length: 120 to 300 words each. Schema: {"docs":[{"id","format","sourceKind","department","theme","text","identities":[]}],"links":[]} where both documents' theme is exactly ${JSON.stringify(theme)} and the ids are "c-1" and "c-2".`;
}

export function complianceNegativePrompt({ seed, theme, frameworkA, frameworkB }) {
  return `Seed: ${seed}. Return only a JSON object. Produce TWO documents about the theme ${JSON.stringify(theme)}: one excerpted from ${frameworkA.label} and one excerpted from ${frameworkB.label}, stating two ADJACENT but genuinely DIFFERENT control requirements (for example two different rules that touch the same systems, or two clauses that address the same risk differently), and they must deliberately share as much vocabulary as possible (same jargon, same artifact names, same clause style) so that word overlap alone cannot tell them apart; only the actual requirement differs. Rules: ZERO people anywhere: no person names, no invented names, and the identities array must be empty for both documents. Set sourceKind to "compliance-doc" and department to "compliance" on both documents. Length: 120 to 300 words each. Schema: {"docs":[{"id","format","sourceKind","department","theme","text","identities":[]}],"links":[]} where both documents' theme is exactly ${JSON.stringify(theme)} and the ids are "c-1" and "c-2".`;
}

export function chatterPrompt({ seed, theme }) {
  return `Seed: ${seed}. Return only a JSON object. Produce TWO short workplace documents with ZERO knowledge content about the theme ${JSON.stringify(theme)}: pure greetings, scheduling, and logistics small talk (for example "how are you", "coffee machine is broken again", "can you send me that file", "thanks, see you at the standup"). No facts, no decisions, no procedures, no requirements, no measurements: nothing anyone could learn from. The two documents may come from the same thread and may share the same invented people. Length: 15 to 40 words each. Schema: {"docs":[{"id","format","sourceKind","department","theme","text","identities":[{"key","surface","class"}]}],"links":[]} where both documents' theme is exactly ${JSON.stringify(theme)} and the ids are "k-1" and "k-2".`;
}

export function privateUnitPrompt({ seed, unitId, theme, context, cultureLabels }) {
  return `Seed: ${seed}. Return only a JSON object. Design ONE confidential knowledge unit for ${JSON.stringify(context)}: a recipe-like proprietary process the company treats as a trade secret (for example a routing formula, a sterilization protocol variant, a permit fast-track rule), tied to the theme ${JSON.stringify(theme)}. Then produce exactly ${PRIVATE_UNIT_DOC_COUNT} documents that carry this process across sources, in this order: (1) the master document stating the process in full (format "memo", sourceKind "memo"); (2) and (3) two different meeting transcripts where the process is discussed or applied (format "transcript", sourceKind "meeting"); (4) a derivative note applying the process to one concrete case (format "email", sourceKind "thread"); (5) a scanned document excerpt restating the rule that governs the process (format "pdf-scan", sourceKind "document"). Rules: the process substance must appear in every document; people are attributes of the meetings, so identities are invented names fitting these naming cultures: ${cultureLabels}; every document has knowledgeUnitId exactly ${JSON.stringify(unitId)} and confidential true; set knowledgeUnitId and confidential as top-level fields on each document. Also emit links of type "thread" connecting the documents that carry the unit. Length: 100 to 250 words per document. Schema: {"docs":[{"id","format","sourceKind","department","theme","text","identities":[{"key","surface","class"}],"knowledgeUnitId","confidential"}],"links":[{"a","b","type"}]} where every document's theme is exactly ${JSON.stringify(theme)}, every document's knowledgeUnitId is ${JSON.stringify(unitId)}, and the ids are "u-1" through "u-${PRIVATE_UNIT_DOC_COUNT}".`;
}

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
    const hasText = parsed && Array.isArray(parsed.docs) && parsed.docs.length >= minDocs
      && parsed.docs.every((d) => d && typeof d.text === 'string' && d.text.trim().length > 0);
    if (hasText) return parsed;
    if (attempt === TEACH_ATTEMPTS - 1) {
      try {
        const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        fs.writeFileSync(path.join(os.tmpdir(), `weft-extension-reject-${stamp}.txt`), `${prompt}\n\n=== RAW (${raw.length} chars):\n${raw}\n`, { flag: 'wx' });
      } catch {
        // A failed dump never masks the real error.
      }
      throw new WeftTeacherUnavailableError('teacher JSON is missing the requested documents array', 'runtime-failed');
    }
  }
  throw new WeftTeacherUnavailableError('teacher sampling exhausted', 'runtime-failed');
}

const idents = (doc) => (Array.isArray(doc && doc.identities) ? doc.identities : []);
const wordsOf = (text) => String(text).split(/\s+/).filter(Boolean).length;

const sharedIdentityKeys = (a, b) => {
  const keysA = new Set(idents(a).map((i) => String(i && i.key || '').toLowerCase()).filter(Boolean));
  const keysB = new Set(idents(b).map((i) => String(i && i.key || '').toLowerCase()).filter(Boolean));
  let shared = 0;
  for (const key of keysA) if (keysB.has(key)) shared += 1;
  return shared;
};

/**
 * Emit one pair in the compiler pair format so Phase 2 merging is plain
 * concatenation. Extension metadata rides in provenance (sourceKind, event
 * anchors, knowledge-density numbers); the trainer reads only textA/textB/
 * label/pairType, so the additions are inert to it.
 */
function makePair(pairType, a, b, extra = {}) {
  const docIds = [a.id, b.id].sort();
  const label = pairType.endsWith('-negative') ? 'negative' : 'positive';
  return {
    id: sha256Hex(`weft-pair\u0000${pairType}\u0000${docIds.join('\u0000')}`),
    policy: PAIR_POLICY,
    pairType,
    label,
    textA: a.text,
    textB: b.text,
    provenance: {
      docIds,
      sources: [a.source || 'synthetic-estate', b.source || 'synthetic-estate'].sort(),
      sourceStatuses: { 'synthetic-estate': 'green' },
      formats: [a.format, b.format],
      departments: [a.department, b.department],
      themes: [a.theme, b.theme],
      linkType: extra.linkType || null,
      identityOverlap: sharedIdentityKeys(a, b),
      identityDisjoint: sharedIdentityKeys(a, b) === 0,
      maskedIdentityCount: 0,
      augmentation: null,
      generator: 'local-teacher',
      sourceKindA: a.sourceKind || deriveSourceKind(a),
      sourceKindB: b.sourceKind || deriveSourceKind(b),
      eventA: extra.eventA || null,
      eventB: extra.eventB || null,
      knowledgeUnitId: extra.knowledgeUnitId || null,
      knowledgeDensityA: a.knowledgeDensity || null,
      knowledgeDensityB: b.knowledgeDensity || null,
    },
  };
}

const mean = (values) => (values.length ? values.reduce((acc, n) => acc + n, 0) / values.length : 0);
const fnv1a = (value) => {
  let h = 0x811c9dc5;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

function coverageCorpus(profileId) {
  const corpusPath = path.join(ROOT, 'results', `weft-fullscale-live-corpus-v5-${profileId}.tmp.json`);
  if (!fs.existsSync(corpusPath)) {
    throw new WeftExtensionConfigError(
      `no coverage corpus for profile ${profileId}: ${corpusPath}; run scripts/generate-weft-live-corpus-v5.mjs for this profile before the estate extension`,
      'corpus-absent'
    );
  }
  return { corpus: JSON.parse(fs.readFileSync(corpusPath, 'utf8')), corpusPath };
}

/**
 * Measured effect of the knowledge-density filter over a doc collection: the
 * pass rate plus the word-count quartiles, so the note can state what the
 * rule keeps and drops rather than assert it.
 */
export function filterEffect(docs) {
  const pass = docs.filter((d) => passesKnowledgeThreshold(d.text));
  const counts = docs.map((d) => wordsOf(d.text)).sort((x, y) => x - y);
  const p = (q) => (counts.length ? counts[Math.min(counts.length - 1, Math.floor(q * counts.length))] : 0);
  return {
    docs: docs.length,
    pass: pass.length,
    passRate: docs.length ? pass.length / docs.length : 0,
    wordsP50: p(0.5),
    wordsMax: counts.length ? counts[counts.length - 1] : 0,
  };
}

/**
 * Run one profile's estate extension. options: { limit (required positive
 * int, applied per pair class), teacher (stub; defaults to the api-only
 * resolver), env, corpusPath, outDir }. Returns { receipt, pairs, overlay,
 * files }.
 */
export function runExtension(profileId, options = {}) {
  const profile = ORG_PROFILES.find((p) => p.id === profileId);
  if (!profile) {
    throw new WeftExtensionConfigError(
      `unknown org profile ${JSON.stringify(profileId)}; expected one of ${JSON.stringify(ORG_PROFILES.map((p) => p.id))}`,
      'profile-unknown'
    );
  }
  const limit = options.limit;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new WeftExtensionConfigError('--limit must be a positive integer so spend stays explicit', 'limit-invalid');
  }
  const teacher = options.teacher || resolveLocalTeacher(options.env || process.env);
  if (teacher.kind !== 'api') {
    throw new WeftTeacherUnavailableError(
      'the estate extension driver runs only the audited mistral-api-tos API teacher',
      'licence-not-api'
    );
  }
  const { corpus, corpusPath } = options.corpusPath
    ? { corpus: JSON.parse(fs.readFileSync(options.corpusPath, 'utf8')), corpusPath: options.corpusPath }
    : coverageCorpus(profile.id);
  if (!corpus || !Array.isArray(corpus.docs) || !corpus.docs.length) {
    throw new WeftExtensionConfigError('coverage corpus has no docs', 'corpus-shape');
  }
  const themes = [...new Set(corpus.docs.map((d) => d.theme))].sort();
  const cultureLabels = JSON.stringify(
    (Array.isArray(profile.nameCultures) ? profile.nameCultures : []).map((c) => (c && c.label) || null).filter(Boolean)
  );
  const themeOf = (seed) => themes[seed % themes.length];

  const startedAt = new Date();
  const pairs = [];
  const drops = {
    droppedPeoplePresent: 0,
    droppedKnowledgeDensity: 0,
    droppedChatterDensity: 0,
    droppedChatterLength: 0,
    droppedUnitShape: 0,
  };
  const sampledPrompts = {
    compliancePositive: null,
    complianceNegative: null,
    chatter: null,
    chatterVsKnowledge: null,
    privateUnit: null,
  };
  const overlap = {
    compliancePositive: [],
    complianceNegative: [],
    chatter: [],
    chatterVsKnowledge: [],
    privateUnitPositive: [],
    privateUnitCross: [],
  };
  const emittedDocs = { compliance: [], chatter: [], privateUnit: [] };

  // Class 1a: people-free, source-disjoint compliance positives.
  for (let i = 0; i < limit; i++) {
    const seed = (SEED * 505057 + i * 7907) >>> 0;
    const theme = themeOf(seed);
    const frameworkA = COMPLIANCE_FRAMEWORKS[seed % COMPLIANCE_FRAMEWORKS.length];
    const frameworkB = pickFrameworks(seed);
    const prompt = compliancePositivePrompt({ seed, theme, frameworkA, frameworkB });
    if (sampledPrompts.compliancePositive === null) sampledPrompts.compliancePositive = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, 2);
    let bad = false;
    const docs = parsed.docs.slice(0, 2).map((raw, n) => {
      const doc = {
        id: `ce-${profile.id}-${i}-${n + 1}`,
        format: String(raw.format || 'pdf-scan'),
        sourceKind: 'compliance-doc',
        department: 'compliance',
        theme,
        text: String(raw.text || ''),
        identities: idents(raw),
        source: 'synthetic-estate',
      };
      if (doc.identities.length > 0) { drops.droppedPeoplePresent += 1; bad = true; }
      if (!passesKnowledgeThreshold(doc.text)) { drops.droppedKnowledgeDensity += 1; bad = true; }
      doc.knowledgeDensity = knowledgeDensity(doc.text);
      return doc;
    });
    if (bad) continue;
    emittedDocs.compliance.push(...docs);
    overlap.compliancePositive.push(lexicalOverlap(docs[0].text, docs[1].text));
    pairs.push(makePair('source-disjoint-compliance-positive', docs[0], docs[1], {
      eventA: docs[0].id,
      eventB: docs[1].id,
    }));
  }

  // Class 1b: people-free compliance near-requirement negatives (the
  // talking-point difference is teacher-claimed, same caveat class as the
  // strata negatives).
  for (let i = 0; i < limit; i++) {
    const seed = (SEED * 505057 + 100003 + i * 7907) >>> 0;
    const theme = themeOf(seed);
    const frameworkA = COMPLIANCE_FRAMEWORKS[seed % COMPLIANCE_FRAMEWORKS.length];
    const frameworkB = pickFrameworks(seed);
    const prompt = complianceNegativePrompt({ seed, theme, frameworkA, frameworkB });
    if (sampledPrompts.complianceNegative === null) sampledPrompts.complianceNegative = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, 2);
    let bad = false;
    const docs = parsed.docs.slice(0, 2).map((raw, n) => {
      const doc = {
        id: `cn-${profile.id}-${i}-${n + 1}`,
        format: String(raw.format || 'pdf-scan'),
        sourceKind: 'compliance-doc',
        department: 'compliance',
        theme,
        text: String(raw.text || ''),
        identities: idents(raw),
        source: 'synthetic-estate',
      };
      if (doc.identities.length > 0) { drops.droppedPeoplePresent += 1; bad = true; }
      if (!passesKnowledgeThreshold(doc.text)) { drops.droppedKnowledgeDensity += 1; bad = true; }
      doc.knowledgeDensity = knowledgeDensity(doc.text);
      return doc;
    });
    if (bad) continue;
    emittedDocs.compliance.push(...docs);
    overlap.complianceNegative.push(lexicalOverlap(docs[0].text, docs[1].text));
    pairs.push(makePair('compliance-near-requirement-negative', docs[0], docs[1], {
      eventA: docs[0].id,
      eventB: docs[1].id,
    }));
  }

  // Class 2a: non-knowledge chatter pairs. Purity is the filter itself: a
  // chatter doc that passes the knowledge threshold is a class violation and
  // gets dropped and counted, never emitted.
  const chatterDocs = [];
  for (let i = 0; i < limit; i++) {
    const seed = (SEED * 9176 + 200003 + i * 6151) >>> 0;
    const theme = themeOf(seed);
    const prompt = chatterPrompt({ seed, theme });
    if (sampledPrompts.chatter === null) sampledPrompts.chatter = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, 2);
    let bad = false;
    const docs = parsed.docs.slice(0, 2).map((raw, n) => {
      const doc = {
        id: `nk-${profile.id}-${i}-${n + 1}`,
        format: String(raw.format || 'email'),
        sourceKind: normalizeSourceKind(raw, 'thread'),
        department: String(raw.department || 'operations'),
        theme,
        text: String(raw.text || ''),
        identities: idents(raw),
        source: 'synthetic-estate',
      };
      if (passesKnowledgeThreshold(doc.text)) { drops.droppedChatterDensity += 1; bad = true; }
      const words = wordsOf(doc.text);
      if (words < 5 || words > 90) { drops.droppedChatterLength += 1; bad = true; }
      doc.knowledgeDensity = knowledgeDensity(doc.text);
      return doc;
    });
    if (bad) continue;
    chatterDocs.push(...docs);
    overlap.chatter.push(lexicalOverlap(docs[0].text, docs[1].text));
    pairs.push(makePair('non-knowledge-negative', docs[0], docs[1], {
      eventA: docs[0].id,
      eventB: docs[1].id,
    }));
  }

  // Class 2b: chatter vs same-theme coverage knowledge. The greeting must not
  // link to real knowledge on the same topic; this is the sharpest form of
  // the knowledge-threshold gate. One teacher call yields two chatter docs,
  // each paired against a different same-theme coverage doc.
  for (let i = 0; i < Math.ceil(limit / 2); i++) {
    const seed = (SEED * 9176 + 300007 + i * 6151) >>> 0;
    const theme = themeOf(seed);
    const prompt = chatterPrompt({ seed, theme });
    if (sampledPrompts.chatterVsKnowledge === null) sampledPrompts.chatterVsKnowledge = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, 2);
    const sameThemeCoverage = corpus.docs
      .filter((d) => d.theme === theme && passesKnowledgeThreshold(d.text))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    if (!sameThemeCoverage.length) continue;
    for (let n = 0; n < 2 && (i * 2 + n) < limit; n++) {
      const raw = parsed.docs[n];
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) continue;
      const doc = {
        id: `nkx-${profile.id}-${i}-${n + 1}`,
        format: String(raw.format || 'email'),
        sourceKind: normalizeSourceKind(raw, 'thread'),
        department: String(raw.department || 'operations'),
        theme,
        text: raw.text,
        identities: idents(raw),
        source: 'synthetic-estate',
      };
      if (passesKnowledgeThreshold(doc.text)) { drops.droppedChatterDensity += 1; continue; }
      const words = wordsOf(doc.text);
      if (words < 5 || words > 90) { drops.droppedChatterLength += 1; continue; }
      doc.knowledgeDensity = knowledgeDensity(doc.text);
      const anchor = sameThemeCoverage[(seed + n) % sameThemeCoverage.length];
      chatterDocs.push(doc);
      overlap.chatterVsKnowledge.push(lexicalOverlap(doc.text, anchor.text));
      pairs.push(makePair('non-knowledge-vs-knowledge-negative', doc, anchor, {
        eventA: doc.id,
        eventB: anchor.id,
      }));
    }
  }
  emittedDocs.chatter.push(...chatterDocs);

  // Class 3: company-private knowledge units. The unit is the identity of the
  // knowledge; people are attributes. Both units share the theme so the
  // cross-unit negatives are same-theme and content-only.
  const overlay = {
    kind: 'weft-private-unit-corpus',
    profile: profile.id,
    seed: SEED,
    docs: [],
    links: [],
    knowledgeUnits: [],
  };
  const unitTheme = themeOf(SEED);
  const units = [];
  for (let u = 0; u < PRIVATE_UNITS_PER_PROFILE; u++) {
    const unitId = `private-unit-${profile.id}-${u + 1}`;
    const seed = (SEED * 1000003 + 400001 + u * 104729) >>> 0;
    const prompt = privateUnitPrompt({ seed, unitId, theme: unitTheme, context: profile.context, cultureLabels });
    if (sampledPrompts.privateUnit === null) sampledPrompts.privateUnit = prompt;
    const parsed = parseTeacherDocs(teacher, prompt, seed, PRIVATE_UNIT_DOC_COUNT);
    const rawDocs = parsed.docs.slice(0, PRIVATE_UNIT_DOC_COUNT);
    const shapeOk = parsed.docs.length >= PRIVATE_UNIT_DOC_COUNT
      && Array.isArray(parsed.links);
    let bad = !shapeOk;
    const docs = rawDocs.map((raw, n) => {
      const claimedUnit = String(raw.knowledgeUnitId || '').trim();
      const doc = {
        id: `pu-${profile.id}-${u + 1}-${n + 1}`,
        format: String(raw.format || (PRIVATE_UNIT_SOURCE_KINDS[n] === 'meeting' ? 'transcript' : 'email')),
        sourceKind: normalizeSourceKind(raw, PRIVATE_UNIT_SOURCE_KINDS[n]),
        department: String(raw.department || profile.departments[seed % profile.departments.length]),
        theme: unitTheme,
        text: String(raw.text || ''),
        identities: idents(raw),
        source: 'synthetic-estate',
        knowledgeUnitId: claimedUnit || unitId,
        confidential: raw.confidential !== false,
      };
      if (claimedUnit && claimedUnit !== unitId) bad = true;
      if (!passesKnowledgeThreshold(doc.text)) { drops.droppedKnowledgeDensity += 1; bad = true; }
      doc.knowledgeDensity = knowledgeDensity(doc.text);
      return doc;
    });
    if (bad || docs.length < PRIVATE_UNIT_DOC_COUNT) { drops.droppedUnitShape += 1; continue; }
    // Unit shape check: all five source kinds present in order.
    const kindsOk = docs.every((d, n) => d.sourceKind === PRIVATE_UNIT_SOURCE_KINDS[n]);
    if (!kindsOk) { drops.droppedUnitShape += 1; continue; }
    const link = (Array.isArray(parsed.links) ? parsed.links : [])
      .filter((l) => l && typeof l.a === 'string' && typeof l.b === 'string')
      .map((l) => ({
        a: `pu-${profile.id}-${u + 1}-${String(l.a).replace(/^u-/, '')}`,
        b: `pu-${profile.id}-${u + 1}-${String(l.b).replace(/^u-/, '')}`,
        type: String(l.type || 'thread'),
      }))
      .filter((l) => docs.some((d) => d.id === l.a) && docs.some((d) => d.id === l.b) && l.a !== l.b);
    units.push({ unitId, docs, links: link });
    overlay.docs.push(...docs);
    overlay.links.push(...link);
    overlay.knowledgeUnits.push({
      id: unitId,
      theme: unitTheme,
      confidential: true,
      docIds: docs.map((d) => d.id),
      provenance: 'teacher-generated-private-unit',
    });
  }
  // Within-unit positives and cross-unit negatives.
  for (const unit of units) {
    for (let i = 0; i < unit.docs.length; i++) {
      for (let j = i + 1; j < unit.docs.length; j++) {
        overlap.privateUnitPositive.push(lexicalOverlap(unit.docs[i].text, unit.docs[j].text));
        pairs.push(makePair('private-unit-positive', unit.docs[i], unit.docs[j], {
          linkType: 'thread',
          eventA: unit.unitId,
          eventB: unit.unitId,
          knowledgeUnitId: unit.unitId,
        }));
      }
    }
  }
  if (units.length >= 2) {
    for (let i = 0; i < units[0].docs.length; i++) {
      for (let j = 0; j < units[1].docs.length; j++) {
        overlap.privateUnitCross.push(lexicalOverlap(units[0].docs[i].text, units[1].docs[j].text));
        pairs.push(makePair('private-unit-cross-negative', units[0].docs[i], units[1].docs[j], {
          eventA: units[0].unitId,
          eventB: units[1].unitId,
        }));
      }
    }
  }
  emittedDocs.privateUnit.push(...overlay.docs);

  const finishedAt = new Date();
  const usage = teacher.usage || {};
  const receipt = {
    kind: 'weft-estate-extension-receipt',
    profile: profile.id,
    seed: SEED,
    sourceCorpus: path.relative(ROOT, corpusPath).split(path.sep).join('/'),
    axis: 'source-kind axis on docs; theme = knowledge; identity = the person erasure axis only (issue #59 rulings)',
    counts: {
      sourceDisjointCompliancePositive: pairs.filter((p) => p.pairType === 'source-disjoint-compliance-positive').length,
      complianceNearRequirementNegative: pairs.filter((p) => p.pairType === 'compliance-near-requirement-negative').length,
      nonKnowledgeNegative: pairs.filter((p) => p.pairType === 'non-knowledge-negative').length,
      nonKnowledgeVsKnowledgeNegative: pairs.filter((p) => p.pairType === 'non-knowledge-vs-knowledge-negative').length,
      privateUnitPositive: pairs.filter((p) => p.pairType === 'private-unit-positive').length,
      privateUnitCrossNegative: pairs.filter((p) => p.pairType === 'private-unit-cross-negative').length,
      ...drops,
    },
    knowledgeDensityFilter: {
      rule: `a document is a knowledge unit iff it has at least ${KNOWLEDGE_MIN_CONTENT_WORDS} distinct content words (tokens of length >= 4, lowercased) AND at least one digit; a lexical-density heuristic, not a semantics test`,
      coverageCorpusEffect: filterEffect(corpus.docs),
      complianceDocsEffect: filterEffect(emittedDocs.compliance),
      chatterDocsEffect: filterEffect(emittedDocs.chatter),
      privateUnitDocsEffect: filterEffect(emittedDocs.privateUnit),
    },
    peopleFreeRule: 'people-free is verified mechanically: a compliance doc with a non-empty identities array is dropped and counted in droppedPeoplePresent',
    nonKnowledgeRule: 'non-knowledge purity is the filter inverted: a chatter doc that passes the knowledge threshold is dropped and counted in droppedChatterDensity',
    negativesCaveat: 'compliance near-requirement difference and private-unit cross-unit difference are teacher-claimed, not mechanically verified; private-unit positives share the unit content and are never benchmarked as theme-linking skill',
    lengthCueCaveat: 'the non-knowledge class carries a visible length cue (chatter is short); per-class eval and the word-count receipts keep it measurable',
    sourceKindDistribution: (() => {
      const acc = Object.create(null);
      for (const doc of [...emittedDocs.compliance, ...emittedDocs.chatter, ...emittedDocs.privateUnit]) {
        acc[doc.sourceKind] = (acc[doc.sourceKind] || 0) + 1;
      }
      return acc;
    })(),
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
      compliancePositive: mean(overlap.compliancePositive),
      complianceNegative: mean(overlap.complianceNegative),
      chatter: mean(overlap.chatter),
      chatterVsKnowledge: mean(overlap.chatterVsKnowledge),
      privateUnitPositive: mean(overlap.privateUnitPositive),
      privateUnitCross: mean(overlap.privateUnitCross),
    },
  };

  const outDir = options.outDir || path.join(ROOT, 'results', `weft-estate-extension-v5-${profile.id}`);
  fs.mkdirSync(outDir, { recursive: true });
  const pairsPath = path.join(outDir, 'extension-pairs.jsonl');
  const receiptPath = path.join(outDir, 'receipt.json');
  fs.writeFileSync(pairsPath, pairs.map((p) => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''));
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  const overlayPath = options.overlayPath
    || path.join(ROOT, 'results', `weft-private-unit-corpus-v5-${profile.id}.tmp.json`);
  if (overlay.docs.length) {
    fs.writeFileSync(overlayPath, JSON.stringify(overlay) + '\n');
  }
  return {
    receipt,
    pairs,
    overlay: overlay.docs.length ? overlay : null,
    files: {
      pairs: path.relative(ROOT, pairsPath).split(path.sep).join('/'),
      receipt: path.relative(ROOT, receiptPath).split(path.sep).join('/'),
      overlay: overlay.docs.length ? path.relative(ROOT, overlayPath).split(path.sep).join('/') : null,
    },
  };
}

function cliValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

// The spending path runs only when executed as a script; importing the
// module (for the contract tests) makes no teacher call and writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const limitRaw = cliValue('--limit');
  const limit = limitRaw === null ? NaN : Number.parseInt(limitRaw, 10);
  const outDir = cliValue('--out') || undefined;
  const corpusPath = cliValue('--corpus') || undefined;
  try {
    const summary = runExtension(cliValue('--profile'), { limit, outDir, corpusPath });
    const c = summary.receipt.counts;
    console.error(
      `extension: ${c.sourceDisjointCompliancePositive} compliance+, ${c.complianceNearRequirementNegative} compliance-, ${c.nonKnowledgeNegative} chatter, ${c.nonKnowledgeVsKnowledgeNegative} chatter-vs-knowledge, ${c.privateUnitPositive} unit+, ${c.privateUnitCrossNegative} unit- -> ${summary.files.pairs}`
    );
    console.error(`drops: ${JSON.stringify(c)}`);
    console.error(
      `usage: ${summary.receipt.usage.calls} calls, ${summary.receipt.usage.totalTokens} tokens, ${summary.receipt.usage.wallclockMs}ms -> ${summary.files.receipt}`
    );
    if (summary.files.overlay) console.error(`private-unit overlay: ${summary.files.overlay}`);
  } catch (err) {
    console.error(`extension driver failed: ${err.code || err.name} ${err.reason ? `(${err.reason})` : ''}: ${err.message}`);
    process.exit(2);
  }
}
