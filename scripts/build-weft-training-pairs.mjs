#!/usr/bin/env node
/**
 * scripts/build-weft-training-pairs.mjs
 *
 * W2: licence audit gate + Weft training-pair compiler.
 *
 * Two artifacts, one hard gate:
 *   results/weft-licence-audit.json      — every candidate source, verified against the
 *                                          2026-11-27 research note; only `green` sources
 *                                          may enter the public recipe.
 *   results/weft-training-pairs/         — train.jsonl, eval.jsonl, receipt.json.
 *
 * Pair types (policy `weft-pairs-v1`), compiled from public linked structure plus
 * synthetic multi-format estates:
 *   identity-masked-positive                 two structurally linked documents of one theme
 *                                            with every resolved identity surface replaced by
 *                                            a role token;
 *   identity-matched-theme-different-negative shared identity, different theme (the signature
 *                                            hard negative);
 *   identity-disjoint-same-theme-positive    same theme, zero shared identities;
 *   identity-disjoint-theme-different-negative zero shared identities, different theme
 *                                            (opt-in: the counterweight that keeps
 *                                            identity-disjointness from predicting
 *                                            "positive" on its own).
 *
 * Teacher policy: synthetic estates are generated only by a local, permissively-licensed
 * open-weight LLM. OpenAI-hosted teachers are barred. With no local runtime configured the
 * live path throws a typed WeftTeacherUnavailableError. It never silently falls back to
 * fixtures.
 *
 * Determinism: pair ids are SHA-256 content digests; JSONL is fixed-ordered by pair id; no
 * timestamps and no randomness. Same input and options produce byte-identical output.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = path.join(ROOT, 'results/weft-training-pairs');
export const OUT_TRAIN = path.join(OUT_DIR, 'train.jsonl');
export const OUT_EVAL = path.join(OUT_DIR, 'eval.jsonl');
export const OUT_RECEIPT = path.join(OUT_DIR, 'receipt.json');
export const OUT_AUDIT = path.join(ROOT, 'results/weft-licence-audit.json');

export const PAIR_POLICY = 'weft-pairs-v1';
export const LICENCE_POLICY = 'weft-licence-v1';

const PERMISSIVE_TEACHER_LICENCES = new Set([
  'apache-2.0',
  'mit',
  'bsd-2-clause',
  'bsd-3-clause',
  'cc0-1.0',
]);
const OPENAI_HOST = /(^|\.)openai\.com$/i;
// API teachers are a separate verification class: a model-access licence, never weights.
export const API_TEACHER_LICENCE = 'mistral-api-tos';
const DEFAULT_API_TEACHER = path.join(ROOT, 'scripts/weft-mistral-teacher.mjs');
const DEFAULT_TEACHER_CHUNK = 10;

// Mistral sometimes emits literal (unescaped) newlines inside JSON string
// literals, which JSON.parse rejects; the 2026-11-28 strata smoke failed 4
// samples in a row on exactly this. Escape control characters that appear
// inside string literals, leaving legal between-token whitespace untouched.
// On valid JSON this is an identity function, so accepted outputs never change.
export function parseLooseJson(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Licence audit. Facts are the verified rows of the 2026-11-27 research note;
// anything the note could not verify is recorded as unverified, never guessed.
// ---------------------------------------------------------------------------
export const LICENCE_AUDIT = {
  schemaVersion: '1.0',
  kind: 'weft-licence-audit',
  policy: LICENCE_POLICY,
  auditBasis: 'docs/research-notes/2026-11-27-weft-novelty-recheck-and-licence-audit.md',
  releaseGate:
    'Only sources with status "green" may enter the public training recipe. Dropped and unverified sources emit zero pairs.',
  statusValues: ['green', 'dropped', 'unverified'],
  sources: [
    {
      id: 'wikipedia-dumps',
      name: 'Wikipedia dumps',
      kind: 'corpus',
      licence: 'CC-BY-SA-4.0',
      terms: 'Creative Commons Attribution-ShareAlike 4.0 International (text)',
      status: 'green',
      usedInRecipe: true,
      redistributable: true,
      releaseConstraint: 'share-alike',
      verifiedFrom:
        'Research note 2026-11-27 §3: CC BY-SA 4.0 text; CC official position covers AI training wherever copyright permission would be required.',
      releaseConsequence:
        'Attribution and share-alike attach to derived released data. A Weft corpus derived from these dumps cannot be relicensed wholesale as Apache-2.0 or MIT.',
      notes: 'Admitted with a share-alike obligation on the released dataset.',
    },
    {
      id: 'synthetic-estate',
      name: 'Synthetic multi-format estates (local open-weight teacher or in-repo fixtures)',
      kind: 'corpus',
      licence: 'project-generated',
      terms: 'Generated in-repo; no third-party content',
      status: 'green',
      usedInRecipe: true,
      redistributable: true,
      releaseConstraint: 'none',
      verifiedFrom: 'Generated by this repository; fixtures contain no third-party text.',
      releaseConsequence: 'No external attribution or share-alike obligation.',
      notes: 'Fixture mode uses the in-repo deterministic estate; live mode requires a green teacher.',
    },
    {
      id: 'multi-news',
      name: 'Multi-News',
      kind: 'corpus',
      licence: 'non-commercial-only',
      terms: 'Bespoke LILY Lab Dataset Usage Agreement',
      status: 'dropped',
      usedInRecipe: false,
      redistributable: false,
      releaseConstraint: 'excluded',
      verifiedFrom:
        'Research note 2026-11-27 §3: bespoke agreement limits use to non-commercial research and education, grants no IP licence; HF licence "other" resolved.',
      releaseConsequence:
        'Excluded from the public training recipe. May be used for internal non-commercial evaluation only, never redistribution.',
      notes: 'Dropped by decision, not pending.',
    },
    {
      id: 'wec-eng',
      name: 'WEC-Eng',
      kind: 'corpus',
      licence: 'unverified',
      terms: 'unverified',
      status: 'unverified',
      usedInRecipe: false,
      redistributable: false,
      releaseConstraint: 'excluded',
      verifiedFrom:
        'Research note 2026-11-27 §3: uCDCR constituent licences, including WEC-Eng, remain unverified.',
      releaseConsequence: 'Dropped from the public recipe until a primary-terms audit turns it green.',
      notes: 'Candidate benchmark substrate only; no pair may derive from it.',
    },
    {
      id: 'ecb-plus',
      name: 'ECB+',
      kind: 'corpus',
      licence: 'unverified',
      terms: 'unverified',
      status: 'unverified',
      usedInRecipe: false,
      redistributable: false,
      releaseConstraint: 'excluded',
      verifiedFrom:
        'Research note 2026-11-27 §3: uCDCR constituent licences, including ECB+, remain unverified.',
      releaseConsequence: 'Dropped from the public recipe until a primary-terms audit turns it green.',
      notes: 'Candidate benchmark substrate only; no pair may derive from it.',
    },
    {
      id: 'ucdcr',
      name: 'uCDCR unified CDCR compilation',
      kind: 'corpus',
      licence: 'unverified',
      terms: 'unverified',
      status: 'unverified',
      usedInRecipe: false,
      redistributable: false,
      releaseConstraint: 'excluded',
      verifiedFrom: 'Research note 2026-11-27 §3: uCDCR constituent licences remain unverified.',
      releaseConsequence: 'Dropped from the public recipe until every constituent is audited.',
      notes: 'Benchmark substrate only; no pair may derive from it.',
    },
    {
      id: 'needle-3',
      name: 'Needle 3 weights',
      kind: 'model',
      licence: 'unverified',
      terms: 'unverified',
      status: 'unverified',
      usedInRecipe: false,
      redistributable: false,
      releaseConstraint: 'excluded',
      verifiedFrom:
        'Research note 2026-11-27 §3: Needle 3 licence still unverified (the earlier note verified Needle 1 weights only).',
      releaseConsequence: 'Not usable as a base encoder until its terms are audited from primary sources.',
      notes: 'Recorded as a pending gate item.',
    },
    {
      id: 'teacher',
      name: 'Local open-weight LLM teacher',
      kind: 'model',
      licence: 'unverified',
      terms: 'candidate-specific; must be audited per model',
      status: 'unverified',
      usedInRecipe: false,
      redistributable: false,
      releaseConstraint: 'excluded',
      verifiedFrom:
        'Research note 2026-11-27 §3: OpenAI-hosted teachers are barred by usage policy effective 2026-11-20; no candidate teacher licence was verified in this audit.',
      releaseConsequence:
        'Live teacher generation stays fail-closed until a permissively-licensed open-weight teacher entry turns green.',
      notes:
        'Candidate family: an operator-supplied local instruct model (for example Qwen2.5-0.5B-Instruct). Its licence must be verified from primary terms before use.',
    },
  ],
  teacherPolicy: {
    allowed: 'permissively-licensed open-weight LLM only',
    allowedLicences: [...PERMISSIVE_TEACHER_LICENCES].sort(),
    barred: ['OpenAI-hosted teachers (usage policy effective 2026-11-20)'],
    chosenTeacher: null,
    status: 'unverified',
    consequence:
      'No teacher licence is verified in this audit. resolveLocalTeacher fails closed unless a local command and a permissive licence are supplied.',
  },
};

export class WeftTeacherUnavailableError extends Error {
  constructor(message, reason = 'runtime-absent') {
    super(message);
    this.name = 'WeftTeacherUnavailableError';
    this.code = 'WEFT_TEACHER_UNAVAILABLE';
    this.reason = reason;
  }
}

// Synchronous backoff for transient adapter/network failures during a live run:
// one upstream blip must not kill hours of spend. Delays sit BEFORE each retry;
// total attempts = 1 + delays.length. Only typed WeftTeacherUnavailableError
// retries, so parse failures keep their own bounded seed-shift retry
// (TEACH_ATTEMPTS samples per chunk).
export const TEACHER_RETRY_DELAYS_MS = [30000, 60000, 120000, 300000, 600000];

// Samples per chunk before a chunk kills the run: each retry shifts the seed by
// the attempt index, so every attempt is a fresh sample. At an observed worst
// case of ~1 empty-docs response per 20 long-band calls, two consecutive
// failures per chunk happen once per ~800 chunks at 2 attempts but roughly once
// per ~160,000 chunks at 4.
export const TEACH_ATTEMPTS = 4;

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function completeWithRetry(teacher, prompt, delays = TEACHER_RETRY_DELAYS_MS) {
  for (let n = 0; ; n++) {
    try {
      return teacher.complete(prompt);
    } catch (err) {
      if (!(err instanceof WeftTeacherUnavailableError)) throw err;
      if (n >= delays.length) throw err;
      const ms = delays[n] ?? 0;
      console.error(`weft-teacher retry ${n + 1}/${delays.length + 1} after ${ms}ms: ${err.message}`);
      sleepSync(ms);
    }
  }
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Read the appended licence audit and return the green API-teacher entry.
 * The audit artifact, not the exported LICENCE_AUDIT, carries the API entry.
 */
function greenApiTeacherEntry(auditPath) {
  let audit;
  try {
    audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  } catch {
    throw new WeftTeacherUnavailableError(
      `licence audit is unavailable at ${auditPath}`,
      'audit-unavailable'
    );
  }
  const entries = Array.isArray(audit.sources) ? audit.sources : [];
  const entry = entries.find(
    (source) =>
      source &&
      (source.id === 'mistral-medium' || source.modelId === 'mistral-medium') &&
      source.status === 'green' &&
      String(source.licence || '').toLowerCase() === API_TEACHER_LICENCE
  );
  if (!entry) {
    throw new WeftTeacherUnavailableError(
      `no green ${API_TEACHER_LICENCE} entry for mistral-medium in the licence audit`,
      'api-teacher-unverified'
    );
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Teacher runtime: local open-weight or audited API, permissive licence, fail closed otherwise.
// ---------------------------------------------------------------------------
export function resolveLocalTeacher(env = process.env) {
  const endpoint = env.WEFT_TEACHER_URL;
  const command = env.WEFT_TEACHER_CMD;
  const kind = String(env.WEFT_TEACHER_KIND || '').toLowerCase();
  const licence = String(env.WEFT_TEACHER_LICENCE || '').toLowerCase();

  if (endpoint) {
    let host;
    try {
      host = new URL(endpoint).hostname;
    } catch {
      throw new WeftTeacherUnavailableError(`WEFT_TEACHER_URL is not a valid URL: ${endpoint}`, 'invalid-endpoint');
    }
    if (OPENAI_HOST.test(host)) {
      throw new WeftTeacherUnavailableError(
        'OpenAI-hosted teachers are barred by usage policy; use a local, permissively-licensed open-weight model',
        'openai-barred'
      );
    }
    throw new WeftTeacherUnavailableError(
      'no bundled HTTP teacher adapter; set WEFT_TEACHER_CMD to a local open-weight model binary',
      'http-adapter-absent'
    );
  }
  if (kind === 'api') {
    if (!licence) {
      throw new WeftTeacherUnavailableError(
        `WEFT_TEACHER_LICENCE must be ${API_TEACHER_LICENCE} for an API teacher`,
        'licence-absent'
      );
    }
    if (licence !== API_TEACHER_LICENCE) {
      throw new WeftTeacherUnavailableError(
        `an API teacher requires licence ${API_TEACHER_LICENCE}; weights licence ${JSON.stringify(licence)} cannot authorize it`,
        'api-licence-required'
      );
    }
    const entry = greenApiTeacherEntry(env.WEFT_LICENCE_AUDIT || OUT_AUDIT);
    const auditedModel = String(entry.modelId || 'mistral-medium');
    const model = String(env.WEFT_TEACHER_MODEL || auditedModel);
    if (model !== auditedModel) {
      throw new WeftTeacherUnavailableError(
        `model ${JSON.stringify(model)} is not the audited API teacher ${JSON.stringify(auditedModel)}`,
        'api-teacher-unverified'
      );
    }
    const adapter = command || DEFAULT_API_TEACHER;
    return {
      kind: 'api',
      command: adapter,
      endpoint: null,
      licence,
      model,
      auditEntry: entry,
      // Honest token accounting: sum the adapter's per-call usage stderr lines.
      usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      complete(prompt) {
        const res = spawnSync(process.execPath, [adapter], {
          input: String(prompt),
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          shell: false,
          env: { ...process.env, ...env },
        });
        if (res.error || res.status !== 0) {
          const tail = String(res.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
          throw new WeftTeacherUnavailableError(
            `API teacher adapter failed: ${res.error ? res.error.message : `exit ${res.status}${tail ? `: ${tail}` : ''}`}`,
            'runtime-failed'
          );
        }
        for (const line of String(res.stderr || '').split(/\r?\n/)) {
          if (!line.startsWith('{"type":"usage"')) continue;
          try {
            const u = JSON.parse(line);
            this.usage.calls += 1;
            this.usage.promptTokens += u.promptTokens || 0;
            this.usage.completionTokens += u.completionTokens || 0;
            this.usage.totalTokens += u.totalTokens || 0;
          } catch {
            // A malformed usage line never fails the generation.
          }
        }
        return res.stdout;
      },
    };
  }
  if (!command) {
    throw new WeftTeacherUnavailableError(
      'no local teacher runtime is configured (set WEFT_TEACHER_CMD and WEFT_TEACHER_LICENCE)',
      'runtime-absent'
    );
  }
  if (!licence) {
    throw new WeftTeacherUnavailableError(
      'WEFT_TEACHER_LICENCE is required so the teacher licence can be checked before generation',
      'licence-absent'
    );
  }
  if (!PERMISSIVE_TEACHER_LICENCES.has(licence)) {
    throw new WeftTeacherUnavailableError(
      `teacher licence ${JSON.stringify(licence)} is not permissively licensed; allowed: ${[...PERMISSIVE_TEACHER_LICENCES].sort().join(', ')}`,
      'licence-not-permissive'
    );
  }
  return {
    command,
    endpoint: null,
    licence,
    complete(prompt) {
      const res = spawnSync(command, {
        input: String(prompt),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
      });
      if (res.error || res.status !== 0) {
        throw new WeftTeacherUnavailableError(
          `local teacher command failed: ${res.error ? res.error.message : `exit ${res.status}`}`,
          'runtime-failed'
        );
      }
      return res.stdout;
    },
  };
}

const DEFAULT_LIVE_THEMES = [
  'annual budget planning',
  'summer team offsite logistics',
  'api gateway migration',
  'customer onboarding revamp',
  'supplier risk review',
  'product launch readiness',
];

// Shared identity roster pinned into every chunk prompt. Each chunk is
// single-theme, so without a shared roster the teacher cannot reuse identity
// keys across themes and identity-matched theme-different negatives never
// compile. Invented names, deterministic, constant.
const SHARED_IDENTITY_ROSTER = [
  { key: 'emp-alex-carter', surface: 'Alex Carter', class: 'person' },
  { key: 'emp-priya-nair', surface: 'Priya Nair', class: 'person' },
  { key: 'emp-tomas-rivera', surface: 'Tomas Rivera', class: 'person' },
  { key: 'emp-mei-chen', surface: 'Mei Chen', class: 'person' },
  { key: 'emp-jonah-weber', surface: 'Jonah Weber', class: 'person' },
  { key: 'emp-sofia-rossi', surface: 'Sofia Rossi', class: 'person' },
  { key: 'emp-daniel-okafor', surface: 'Daniel Okafor', class: 'person' },
  { key: 'emp-hana-sato', surface: 'Hana Sato', class: 'person' },
  { key: 'emp-elena-petrova', surface: 'Elena Petrova', class: 'person' },
  { key: 'emp-marcus-webb', surface: 'Marcus Webb', class: 'person' },
  { key: 'emp-aisha-khan', surface: 'Aisha Khan', class: 'person' },
  { key: 'emp-lucas-meyer', surface: 'Lucas Meyer', class: 'person' },
  { key: 'vendor-northwind-supply', surface: 'Northwind Supply Co', class: 'organization' },
  { key: 'vendor-helios-cloud', surface: 'Helios Cloud Services', class: 'organization' },
];

/**
 * Build the per-profile shared identity roster for an org profile: people are
 * drawn round-robin from the profile's name cultures (so each organization gets
 * its own invented cast and vendor pool, not the generic estate's), vendors
 * come from the profile's vendor pool. Keys are deterministic slugs of the
 * surfaces, deduplicated so two pools never collide inside one roster.
 */
function profileRoster(profile) {
  const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cultures = (Array.isArray(profile.nameCultures) ? profile.nameCultures : [])
    .map((c) => (c && Array.isArray(c.names) ? c.names : null))
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  const add = (key, surface, cls) => {
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ key, surface, class: cls });
    }
  };
  const idx = cultures.map(() => 0);
  let progressed = true;
  while (out.length < 12 && progressed) {
    progressed = false;
    for (let i = 0; i < cultures.length && out.length < 12; i++) {
      if (idx[i] < cultures[i].length) {
        const surface = cultures[i][idx[i]++];
        add(`emp-${slug(surface)}`, surface, 'person');
        progressed = true;
      }
    }
  }
  for (const name of (Array.isArray(profile.vendorPool) ? profile.vendorPool : []).slice(0, 5)) {
    add(`vendor-${slug(name)}`, name, 'organization');
  }
  // A profile too thin to scaffold identity-matched negatives falls back to the
  // generic roster rather than silently weakening the negative lesson.
  return out.length >= 4 ? out : SHARED_IDENTITY_ROSTER;
}

/**
 * Generate synthetic multi-format estates with a teacher.
 * The teacher must expose `complete(prompt)` and carry either a permissive open-weight
 * licence or an audited API-teacher entry. Each theme is generated in chunks of at most
 * `chunkSize` documents (env WEFT_TEACHER_CHUNK, default 10) until the per-theme target
 * is met, with a deterministic seed per chunk. Returns { docs, links }.
 *
 * Optional `orgProfile` ({ id, context, departments, formats, vendorPool, nameCultures })
 * re-skins the prompt for one company shape: its context line, its departments and
 * format mix, and a roster built from its own vendor pool and name cultures. Absent
 * (default null), the prompt is byte-identical to the pre-profile prompts.
 *
 * Optional `lengthBands` ([{ label, min, max }]) replaces the free-form length hint with
 * a per-call length band picked deterministically by the chunk seed; long-band calls
 * request fewer documents (options.longBandChunkSize, default 3) so a single teacher
 * call has room to write to length.
 */
export function generateTeacherEstates(teacher, options = {}) {
  if (!teacher || typeof teacher.complete !== 'function') {
    throw new WeftTeacherUnavailableError('live generation requires a resolved local teacher runtime', 'runtime-absent');
  }
  const licence = String(teacher.licence || '').toLowerCase();
  if (teacher.kind === 'api') {
    if (licence !== API_TEACHER_LICENCE) {
      throw new WeftTeacherUnavailableError(
        `live generation requires licence ${API_TEACHER_LICENCE} for an API teacher`,
        'licence-not-permissive'
      );
    }
    if (!teacher.auditEntry || teacher.auditEntry.status !== 'green') {
      throw new WeftTeacherUnavailableError(
        `live generation requires a green ${API_TEACHER_LICENCE} audit entry`,
        'api-teacher-unverified'
      );
    }
  } else if (!PERMISSIVE_TEACHER_LICENCES.has(licence)) {
    throw new WeftTeacherUnavailableError('live generation requires a permissively-licensed open-weight teacher', 'licence-not-permissive');
  }
  const themes = Array.isArray(options.themes) && options.themes.length ? options.themes : DEFAULT_LIVE_THEMES;
  const pairsTarget = options.pairsTarget ?? 50000;
  const perTheme = Math.max(5, Math.ceil(pairsTarget / 8 / themes.length));
  const rawChunk = options.chunkSize ?? process.env.WEFT_TEACHER_CHUNK ?? DEFAULT_TEACHER_CHUNK;
  const parsedChunk = Number.parseInt(rawChunk, 10);
  const chunkSize = Number.isInteger(parsedChunk) && parsedChunk > 0 ? parsedChunk : DEFAULT_TEACHER_CHUNK;
  const baseSeed = Number.isInteger(options.seed) ? options.seed : 0;
  const profile = options.orgProfile && typeof options.orgProfile === 'object' ? options.orgProfile : null;
  const roster = profile ? profileRoster(profile) : SHARED_IDENTITY_ROSTER;
  const lengthBands = (Array.isArray(options.lengthBands) ? options.lengthBands : [])
    .filter((b) => b && Number.isFinite(b.min) && Number.isFinite(b.max) && b.max >= b.min);
  const useBands = lengthBands.length > 0;
  const longBandChunk = Number.isInteger(options.longBandChunkSize) && options.longBandChunkSize > 0
    ? options.longBandChunkSize
    : 3;
  const retryDelays = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : TEACHER_RETRY_DELAYS_MS;
  const teachAttempts = Number.isInteger(options.teachAttempts) && options.teachAttempts > 0
    ? options.teachAttempts
    : TEACH_ATTEMPTS;
  const chunkRecord = typeof options.chunkRecord === 'function' ? options.chunkRecord : null;
  const resumeChunk = typeof options.resumeChunk === 'function' ? options.resumeChunk : null;
  const docs = [];
  const links = [];
  themes.forEach((theme, themeIndex) => {
    const themePrefix = String(theme).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
    let collected = 0;
    for (let chunk = 0; collected < perTheme; chunk++) {
      const seed = (baseSeed * 1000003 + themeIndex * 10007 + chunk) >>> 0;
      // Per-chunk voice and length hints (2026-11-28 audit: seeds alone reshuffle
      // content, not style; without explicit hints every chunk lands in the same
      // teacher voice and the style axis never moves).
      const styleHints = Array.isArray(options.styleHints) && options.styleHints.length ? options.styleHints : null;
      const lengthHint = typeof options.lengthHint === 'string' && options.lengthHint.trim() ? options.lengthHint.trim() : null;
      const voice = styleHints ? styleHints[seed % styleHints.length] : null;
      const band = useBands ? lengthBands[seed % lengthBands.length] : null;
      // Long-band calls shrink the per-call document count so the teacher has
      // room to write to length instead of truncating to fit the chunk.
      const want = Math.min(chunkSize, perTheme - collected, band && band.min >= 300 ? longBandChunk : chunkSize);
      const formatLine = profile
        ? `Mix formats: ${JSON.stringify(Array.isArray(profile.formats) ? profile.formats : ['email', 'transcript', 'slides', 'table', 'ticket', 'pdf-scan'])}. Use only these departments: ${JSON.stringify(Array.isArray(profile.departments) ? profile.departments : ['operations'])}.`
        : 'Mix formats: email, transcript, slides, table, ticket, pdf-scan. Mix departments.';
      const cultureLabels = profile && Array.isArray(profile.nameCultures)
        ? profile.nameCultures.map((c) => (c && c.label) || null).filter(Boolean)
        : [];
      const prompt = [
        `Seed: ${seed}.`,
        'Return only a JSON object.',
        `Produce ${want} documents about the theme ${JSON.stringify(theme)}.`,
        formatLine,
        ...(profile && profile.context
          ? [`Company context: every document belongs to ${JSON.stringify(String(profile.context))}.`] : []),
        ...(voice ? [`Write every document in this chunk with this voice: ${JSON.stringify(String(voice))}.`] : []),
        ...(band
          ? [`Length band for this call: every document must be ${band.min} to ${band.max} words. Treat the minimum as a requirement, not a preference: keep writing until a document reaches at least ${band.min} words; a shorter document is a failed sample.`]
          : [...(lengthHint ? [`Vary document lengths: ${JSON.stringify(lengthHint)}.`] : [])]),
        'Schema: {"docs":[{"id","format","department","theme","text","identities":[{"key","surface","class"}]}],',
        '"links":[{"a","b","type"}]} where type is one of thread, attachment, meeting-minutes, ticket-pr, hyperlink.',
        'Reuse some identity keys within the chunk so linked documents share identities.',
        `Shared company roster (the same people appear in other themes' chunks): ${JSON.stringify(roster)}.`,
        'Each document uses 1 or 2 roster identities at most and at least 3 identity keys unique to this chunk, so same-theme documents can be fully identity-disjoint.',
        'The chunk-unique identities must use invented names distinct from the roster surfaces; never reuse a roster surface for a chunk-unique identity.',
        ...(cultureLabels.length
          ? [`Chunk-unique invented names should fit the same naming cultures as the roster: ${JSON.stringify(cultureLabels)}.`] : []),
        'Set each doc theme field to exactly the theme string given, never a document title.',
        'Never print identity key strings such as emp- or vendor- prefixes inside document text.',
        `This is chunk ${chunk + 1}; ids must be unique within the chunk.`,
      ].join(' ');
      // Checkpoint resume: a resumed run must produce a corpus byte-identical to
      // an uninterrupted run, because chunk seeds are pure functions of
      // (baseSeed, themeIndex, chunk) and checkpointed chunks are injected
      // verbatim at the same loop positions. A served chunk skips both the
      // teacher call and the chunkRecord call (the checkpoint already has it).
      let parsed = null;
      if (resumeChunk) {
        const stored = resumeChunk(themeIndex, chunk);
        if (stored && Array.isArray(stored.docs) && stored.docs.length > 0) {
          parsed = stored;
        }
      }
      if (!parsed) {
        // Bounded retries per chunk: one bad response must not kill a
        // long live run; the seed shifts by the attempt index so every
        // attempt is a fresh sample.
        for (let attempt = 0; attempt < teachAttempts; attempt++) {
          let raw;
          try {
            raw = completeWithRetry(
              teacher,
              attempt === 0 ? prompt : prompt.replace(`Seed: ${seed}.`, `Seed: ${seed + attempt}.`),
              retryDelays
            );
          } catch (err) {
            if (attempt === teachAttempts - 1) throw err;
            continue;
          }
          const start = raw.indexOf('{');
          const end = raw.lastIndexOf('}');
          if (start < 0 || end <= start) {
            if (attempt === teachAttempts - 1) throw new WeftTeacherUnavailableError('teacher returned no JSON object', 'runtime-failed');
            continue;
          }
          try {
            parsed = parseLooseJson(raw.slice(start, end + 1));
          } catch {
            parsed = null;
          }
          if (parsed && Array.isArray(parsed.docs) && parsed.docs.length > 0) break;
          parsed = null;
          if (attempt === teachAttempts - 1) {
            throw new WeftTeacherUnavailableError('teacher JSON is missing a non-empty docs array', 'runtime-failed');
          }
        }
        if (chunkRecord) chunkRecord(themeIndex, chunk, parsed);
      }
      // Namespace ids per chunk so repeated model ids across calls cannot collide.
      const idMap = new Map();
      const used = new Set();
      parsed.docs.forEach((doc, index) => {
        const oldId = doc && typeof doc.id === 'string' && doc.id ? doc.id : `doc-${index}`;
        let newId = `${themePrefix}-c${chunk}-${oldId}`;
        let suffix = 1;
        while (used.has(newId)) newId = `${themePrefix}-c${chunk}-${oldId}-${suffix++}`;
        used.add(newId);
        idMap.set(oldId, newId);
        docs.push({ ...doc, id: newId, source: (doc && doc.source) || 'synthetic-estate' });
      });
      for (const link of Array.isArray(parsed.links) ? parsed.links : []) {
        const a = idMap.get(link && link.a);
        const b = idMap.get(link && link.b);
        if (a && b && a !== b) links.push({ ...link, a, b });
      }
      collected += parsed.docs.length;
    }
  });
  return { docs, links };
}

// ---------------------------------------------------------------------------
// Text augmentation (deterministic text transforms only).
// ---------------------------------------------------------------------------
function asrNoise(text) {
  // Keep [] and _ so masked role tokens survive the transform.
  const tokens = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\[\]_]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // Drop short function words at a fixed cadence: a cheap ASR deletion model.
  return tokens.filter((t, i) => i % 7 !== 0 || t.length > 6).join(' ');
}

function ocrNoise(text) {
  return String(text)
    .replace(/rn/g, 'm')
    .replace(/0/g, 'O')
    .replace(/1/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}

function slideFragmentation(text) {
  const parts = String(text)
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => `- ${p}`).join('\n');
}

const AUGMENTATION_BY_FORMAT = {
  transcript: 'asr',
  audio: 'asr',
  'pdf-scan': 'ocr',
  scan: 'ocr',
  image: 'ocr',
  slides: 'slide-fragmentation',
  deck: 'slide-fragmentation',
};

function augment(text, format) {
  const kind = AUGMENTATION_BY_FORMAT[String(format || '').toLowerCase()];
  if (!kind) return { text, augmentation: null };
  // Protect masked role tokens from the noise model (OCR would rewrite the index digit).
  const tokens = [];
  const protectedText = String(text).replace(/\[[A-Z]+_\d+\]/g, (token) => {
    if (tokens.length >= 26) return token;
    tokens.push(token);
    return `ZQX${String.fromCharCode(65 + tokens.length - 1)}ZQX`;
  });
  const transformed =
    kind === 'asr' ? asrNoise(protectedText) : kind === 'ocr' ? ocrNoise(protectedText) : slideFragmentation(protectedText);
  const restored = transformed.replace(/ZQX([A-Z])ZQX/gi, (whole, letter) => {
    const index = letter.toUpperCase().charCodeAt(0) - 65;
    return tokens[index] ?? whole;
  });
  return { text: restored, augmentation: kind };
}

// ---------------------------------------------------------------------------
// Pair compiler.
// ---------------------------------------------------------------------------
function normalizeDocs(input) {
  if (!input || !Array.isArray(input.docs)) {
    throw new TypeError('compileWeftTrainingPairs requires { docs: [...] }');
  }
  const docs = input.docs.map((doc) => {
    if (!doc || typeof doc.id !== 'string' || typeof doc.source !== 'string') {
      throw new TypeError('every document requires string id and source fields');
    }
    if (typeof doc.text !== 'string' || !doc.text.trim()) {
      throw new TypeError(`document ${doc.id} requires non-empty text`);
    }
    const identities = Array.isArray(doc.identities) ? doc.identities : [];
    for (const ident of identities) {
      if (!ident || typeof ident.key !== 'string' || typeof ident.surface !== 'string') {
        throw new TypeError(`document ${doc.id} has an identity without string key/surface`);
      }
    }
    return {
      id: doc.id,
      source: doc.source,
      format: String(doc.format || 'text').toLowerCase(),
      department: String(doc.department || 'unknown'),
      theme: String(doc.theme || 'unknown'),
      text: doc.text,
      identities,
      identityKeys: new Set(identities.map((i) => i.key)),
    };
  });
  const byId = new Map();
  for (const doc of docs) {
    if (byId.has(doc.id)) throw new TypeError(`duplicate document id ${doc.id}`);
    byId.set(doc.id, doc);
  }
  const links = Array.isArray(input.links) ? input.links : [];
  for (const link of links) {
    if (!byId.has(link.a) || !byId.has(link.b)) {
      throw new TypeError(`link references an unknown document: ${JSON.stringify(link)}`);
    }
  }
  return { docs, byId, links };
}

export function roleTokenMap(docs) {
  const seen = new Map();
  const counters = new Map();
  for (const ident of docs.flatMap((d) => d.identities)) {
    if (seen.has(ident.key)) continue;
    const cls = String(ident.class || 'entity').toUpperCase();
    const n = (counters.get(cls) || 0) + 1;
    counters.set(cls, n);
    seen.set(ident.key, `[${cls}_${n}]`);
  }
  return seen;
}

export function maskText(text, docs, tokens) {
  let out = text;
  const surfaces = docs
    .flatMap((d) => d.identities)
    .sort((a, b) => b.surface.length - a.surface.length || (a.key < b.key ? -1 : 1));
  for (const ident of surfaces) out = out.split(ident.surface).join(tokens.get(ident.key));
  return out;
}

function sharedIdentityKeys(a, b) {
  const out = [];
  for (const key of a.identityKeys) if (b.identityKeys.has(key)) out.push(key);
  return out.sort();
}

/**
 * Compile labeled Weft training pairs.
 * input: { docs: [{ id, source, format, department, theme, text, identities }], links: [{ a, b, type }] }
 * options: { mode: 'fixture' | 'live', targetPairs, evalSize, augment: boolean }
 */
export function compileWeftTrainingPairs(input, options = {}) {
  const mode = options.mode === 'live' ? 'live' : 'fixture';
  if (mode === 'live' && !options.teacher && options.corpusProvided !== true) {
    throw new WeftTeacherUnavailableError(
      'live pair compilation requires a resolved local teacher or a provided corpus; refusing to fall back to fixtures',
      'runtime-absent'
    );
  }
  const { docs, byId, links } = normalizeDocs(input);
  const auditById = new Map(LICENCE_AUDIT.sources.map((s) => [s.id, s]));
  const targetPairs = Number.isInteger(options.targetPairs) && options.targetPairs > 0 ? options.targetPairs : mode === 'live' ? 50000 : 5000;
  const augmentOn = options.augment !== false;
  const generator = mode === 'live' ? 'local-teacher' : 'fixture';
  // Opt-in recipe flags (ticket #52): default-off keeps the committed fixture
  // baseline byte-stable; the live recompile turns both on.
  const includeDisjointNegatives = options.includeDisjointNegatives === true;
  const excludeWithinChunk = options.excludeWithinChunk === true;
  const corpusProvided = options.corpusProvided === true;
  // Opt-in (2026-11-28 audit): masked-role tokens and text augmentation appear
  // only in masked positives unless diluted; undiluted, [PERSON_n]-style markers
  // and OCR/ASR noise are a deterministic positive label cue.
  const diluteMaskedMarkers = options.diluteMaskedMarkers === true;
  // Opt-in (W5/v5): restore a small masked-positive bucket from within-chunk
  // structural links, which the working chunk-marker exclusion empties by
  // construction. A deterministic 5 percent hash slice of the links the
  // exclusion would drop is re-emitted as identity-masked positives with full
  // role-token masking. Off by default so the v4 receipts stay byte-stable;
  // the same-voice caveat of within-chunk pairs is part of the deal and goes
  // to the audit gate with the corpus.
  const includeMaskedStructural = options.includeMaskedStructural === true;
  // Recipe label for the org-profile corpus axis; the prompt-level profile
  // itself lives in generateTeacherEstates. Recorded only when present.
  const orgProfile = typeof options.orgProfile === 'string' && options.orgProfile.trim() ? options.orgProfile.trim() : null;

  const rejected = {};
  const emitted = new Set();
  const pairs = [];
  // Hard negatives and identity-disjoint positives both grow quadratically once
  // a shared roster puts overlapping identities in most documents; per-document
  // budgets are tracked per pair type so the negatives loop (which runs before
  // the others) cannot spend the budget the disjoint-positive loop needs.
  const capPerDoc = Math.max(4, Math.ceil(targetPairs / Math.max(1, docs.length)));
  const perDocPairs = new Map();
  const docKey = (type, doc) => `${type}\u0000${doc.id}`;
  const docUnderCap = (type, doc) => (perDocPairs.get(docKey(type, doc)) || 0) < capPerDoc;
  const docBump = (type, doc) => perDocPairs.set(docKey(type, doc), (perDocPairs.get(docKey(type, doc)) || 0) + 1);
  // Chunk identity is the leftmost `-c<digits>-` marker that generateTeacherEstates
  // prefixes onto every live doc id; fixture and hand-written ids without the
  // marker are each their own chunk. (A plain -doc- split silently broke when a
  // teacher emitted ids without that substring, which voided the
  // within-chunk exclusion flag.)
  const CHUNK_MARKER = /-c\d+-/;
  const chunkOf = (doc) => {
    const m = CHUNK_MARKER.exec(doc.id);
    return m ? doc.id.slice(0, m.index + m[0].length - 1) : doc.id;
  };

  const reject = (doc, status) => {
    const bucket = (rejected[doc.source] ||= { count: 0, status });
    bucket.count += 1;
  };
  const admitted = (doc) => {
    const entry = auditById.get(doc.source);
    if (!entry) {
      reject(doc, 'unknown');
      return false;
    }
    if (entry.status !== 'green') {
      reject(doc, entry.status);
      return false;
    }
    return true;
  };

  function emit(pairType, a, b, extra) {
    if (!admitted(a) || !admitted(b)) return;
    const docIds = [a.id, b.id].sort();
    // Within-chunk pairs share a teacher call's style, which is a label shortcut
    // in the live recipe (every within-chunk pair was a positive); excluded on
    // demand, except the opt-in 5 percent masked-structural rescue slice.
    const maskedStructuralRescue = includeMaskedStructural
      && pairType === 'identity-masked-positive'
      && (Number.parseInt(sha256Hex(`weft-masked-structural\u0000${docIds.join('\u0000')}`).slice(0, 8), 16) % 100) < 5;
    if (excludeWithinChunk && chunkOf(a) === chunkOf(b) && !maskedStructuralRescue) return;
    const dedupe = docIds.join('|');
    if (emitted.has(dedupe)) return;
    const shared = sharedIdentityKeys(a, b);
    if (pairType === 'identity-masked-positive' && shared.length === 0) {
      // A structural link with no shared resolved identity is still a positive link,
      // but without identities there is nothing to mask; keep it out of the masked bucket.
      return;
    }
    emitted.add(dedupe);

    // Deterministic per-pair dilution: a fixed hash-slice of identity-matched
    // negatives gets the same masking and augmentation as masked positives, so
    // the markers stop being a label cue while the negative lesson keeps its cue.
    const maskNegSelected = diluteMaskedMarkers
      && pairType === 'identity-matched-theme-different-negative'
      && (Number.parseInt(sha256Hex(`weft-mask-dilution\u0000${docIds.join('\u0000')}`).slice(0, 8), 16) % 100) < 5;
    const tokens = pairType === 'identity-masked-positive' || maskNegSelected ? roleTokenMap([a, b]) : null;
    const textA = tokens ? maskText(a.text, [a, b], tokens) : a.text;
    let textB = tokens ? maskText(b.text, [a, b], tokens) : b.text;
    let augmentation = null;
    if (augmentOn && tokens) {
      const augmented = augment(textB, b.format);
      if (augmented.augmentation) {
        textB = augmented.text;
        augmentation = augmented.augmentation;
      }
    }

    const label = pairType.endsWith('-negative') ? 'negative' : 'positive';
    const id = sha256Hex(`weft-pair\u0000${pairType}\u0000${docIds.join('\u0000')}`);
    pairs.push({
      id,
      policy: PAIR_POLICY,
      pairType,
      label,
      textA,
      textB,
      provenance: {
        docIds,
        sources: [a.source, b.source].sort(),
        sourceStatuses: {
          [a.source]: auditById.get(a.source).status,
          [b.source]: auditById.get(b.source).status,
        },
        formats: [a.format, b.format],
        departments: [a.department, b.department],
        themes: [a.theme, b.theme],
        linkType: extra.linkType || null,
        identityOverlap: shared.length,
        identityDisjoint: shared.length === 0,
        maskedIdentityCount: tokens ? tokens.size : 0,
        augmentation,
        generator,
      },
    });
  }

  // (a) identity-masked positives from structural links (same theme).
  for (const link of [...links].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1))) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (a.theme !== b.theme) continue;
    emit('identity-masked-positive', a, b, { linkType: link.type || 'unknown' });
  }

  // (b) identity-matched, theme-different hard negatives.
  const ordered = [...docs].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      if (a.theme === b.theme) continue;
      if (sharedIdentityKeys(a, b).length === 0) continue;
      if (!docUnderCap('identity-matched-theme-different-negative', a) || !docUnderCap('identity-matched-theme-different-negative', b)) continue;
      docBump('identity-matched-theme-different-negative', a);
      docBump('identity-matched-theme-different-negative', b);
      emit('identity-matched-theme-different-negative', a, b, {});
    }
  }

  // (c) identity-disjoint, same-theme positives.
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      if (a.theme !== b.theme) continue;
      if (sharedIdentityKeys(a, b).length !== 0) continue;
      if (!docUnderCap('identity-disjoint-same-theme-positive', a) || !docUnderCap('identity-disjoint-same-theme-positive', b)) continue;
      docBump('identity-disjoint-same-theme-positive', a);
      docBump('identity-disjoint-same-theme-positive', b);
      emit('identity-disjoint-same-theme-positive', a, b, {});
    }
  }

  // (d) identity-disjoint, theme-different negatives (opt-in): without them,
  // identity-disjointness alone predicts "positive" in training, which saturates
  // the fixture gate where nearly every cross-department pair is disjoint.
  if (includeDisjointNegatives) {
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i];
        const b = ordered[j];
        if (a.theme === b.theme) continue;
        if (sharedIdentityKeys(a, b).length !== 0) continue;
        if (!docUnderCap('identity-disjoint-theme-different-negative', a) || !docUnderCap('identity-disjoint-theme-different-negative', b)) continue;
        docBump('identity-disjoint-theme-different-negative', a);
        docBump('identity-disjoint-theme-different-negative', b);
        emit('identity-disjoint-theme-different-negative', a, b, {});
      }
    }
  }

  pairs.sort((a, b) => (a.id < b.id ? -1 : 1));
  let kept = pairs;
  if (pairs.length > targetPairs) {
    // Balanced fill: a plain slice of the id-sorted pool is dominated by whichever
    // bucket is quadratic; round-robin across pair types so no type crowds out another.
    const buckets = new Map();
    for (const p of pairs) {
      if (!buckets.has(p.pairType)) buckets.set(p.pairType, []);
      buckets.get(p.pairType).push(p);
    }
    const types = [...buckets.keys()].sort();
    kept = [];
    for (let round = 0; kept.length < targetPairs; round++) {
      let added = false;
      for (const type of types) {
        if (kept.length >= targetPairs) break;
        const p = buckets.get(type)[round];
        if (p) {
          kept.push(p);
          added = true;
        }
      }
      if (!added) break;
    }
    kept.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  // Small hand-checkable evaluation slice: an explicit evalSize, else a quarter capped at 32.
  const evalSize = Number.isInteger(options.evalSize) && options.evalSize >= 0
    ? options.evalSize
    : Math.max(1, Math.min(32, Math.floor(kept.length / 4)));
  const evalCount = Math.min(evalSize, kept.length);
  const evalPairs = kept.slice(0, evalCount);
  const evalIds = new Set(evalPairs.map((p) => p.id));
  const trainPairs = kept.filter((p) => !evalIds.has(p.id));

  const toJsonl = (list) => list.map((p) => JSON.stringify(p)).join('\n') + (list.length ? '\n' : '');
  const trainJsonl = toJsonl(trainPairs);
  const evalJsonl = toJsonl(evalPairs);

  const byType = {};
  const byLabel = { positive: 0, negative: 0 };
  const augmentationCounts = { asr: 0, ocr: 0, 'slide-fragmentation': 0 };
  for (const p of kept) {
    byType[p.pairType] = (byType[p.pairType] || 0) + 1;
    byLabel[p.label] += 1;
    if (p.provenance.augmentation) augmentationCounts[p.provenance.augmentation] += 1;
  }
  const usedSources = {};
  for (const p of kept) for (const s of p.provenance.sources) usedSources[s] = auditById.get(s).status;

  const receipt = {
    schemaVersion: '1.0',
    kind: 'weft-training-pairs',
    policy: PAIR_POLICY,
    mode,
    generator,
    // Recipe flags are recorded only when a non-default recipe is used, so the
    // committed default-recipe receipts keep their exact committed shape.
    ...(includeDisjointNegatives || excludeWithinChunk || corpusProvided || diluteMaskedMarkers || includeMaskedStructural || orgProfile
      ? {
          recipeOptions: {
            includeDisjointNegatives,
            excludeWithinChunk,
            corpusProvided,
            // Recorded only when on, so the committed v2-recipe receipts keep
            // their exact committed shape on a recompile.
            ...(diluteMaskedMarkers ? { diluteMaskedMarkers } : {}),
            ...(includeMaskedStructural ? { includeMaskedStructural } : {}),
            ...(orgProfile ? { orgProfile } : {}),
          },
        }
      : {}),
    targetPairs,
    pairCount: kept.length,
    trainCount: trainPairs.length,
    evalCount: evalPairs.length,
    evalPairIds: evalPairs.map((p) => p.id),
    byType,
    byLabel,
    augmentations: augmentationCounts,
    usedSources,
    rejected,
    pairJsonlSha256: sha256Hex(trainJsonl + evalJsonl),
    trainJsonlSha256: sha256Hex(trainJsonl),
    evalJsonlSha256: sha256Hex(evalJsonl),
  };
  return { pairs: kept, trainPairs, evalPairs, trainJsonl, evalJsonl, receipt };
}

// ---------------------------------------------------------------------------
// Deterministic in-repo fixture estate. All text is invented here; no third-party
// corpus is copied. Formats and identity overlaps are designed to exercise all
// three pair types and all three augmentations.
// ---------------------------------------------------------------------------
export function fixtureCorpus() {
  const docs = [
    {
      id: 'fin-email',
      source: 'synthetic-estate',
      format: 'email',
      department: 'finance',
      theme: 'quarterly-budget-planning',
      text: 'Elena Vance confirmed the quarterly budget planning figures for Harrow Logistics Ltd: operating spend stays flat and the contingency line grows by two percent.',
      identities: [
        { key: 'person:elena-vance', surface: 'Elena Vance', class: 'person' },
        { key: 'org:harrow-logistics', surface: 'Harrow Logistics Ltd', class: 'org' },
      ],
    },
    {
      id: 'fin-minutes',
      source: 'synthetic-estate',
      format: 'transcript',
      department: 'finance',
      theme: 'quarterly-budget-planning',
      text: 'Elena Vance walked the team through the quarterly budget planning sheet from Harrow Logistics Ltd. Project AMBER keeps its contingency and the operating spend line is unchanged.',
      identities: [
        { key: 'person:elena-vance', surface: 'Elena Vance', class: 'person' },
        { key: 'org:harrow-logistics', surface: 'Harrow Logistics Ltd', class: 'org' },
        { key: 'project:amber', surface: 'Project AMBER', class: 'project' },
      ],
    },
    {
      id: 'fin-table',
      source: 'synthetic-estate',
      format: 'table',
      department: 'finance',
      theme: 'quarterly-budget-planning',
      text: 'Line item | owner | amount\nOperating spend | Kwame Asante | 410000\nContingency | Kwame Asante | 24000',
      identities: [
        { key: 'person:kwame-asante', surface: 'Kwame Asante', class: 'person' },
        { key: 'project:amber', surface: 'Project AMBER', class: 'project' },
      ],
    },
    {
      id: 'sales-ticket',
      source: 'synthetic-estate',
      format: 'ticket',
      department: 'sales',
      theme: 'summer-offsite-logistics',
      text: 'Elena Vance needs the summer offsite logistics plan for Harrow Logistics Ltd: venue booking, shuttle times, and dietary forms.',
      identities: [
        { key: 'person:elena-vance', surface: 'Elena Vance', class: 'person' },
        { key: 'org:harrow-logistics', surface: 'Harrow Logistics Ltd', class: 'org' },
      ],
    },
    {
      id: 'sales-deck',
      source: 'synthetic-estate',
      format: 'slides',
      department: 'sales',
      theme: 'summer-offsite-logistics',
      text: 'Summer offsite logistics\nVenue deposit due Friday\nShuttle from head office at eight\nDietary forms collected by Elena Vance for Harrow Logistics Ltd',
      identities: [
        { key: 'person:elena-vance', surface: 'Elena Vance', class: 'person' },
        { key: 'org:harrow-logistics', surface: 'Harrow Logistics Ltd', class: 'org' },
      ],
    },
    {
      id: 'eng-ticket',
      source: 'synthetic-estate',
      format: 'ticket',
      department: 'engineering',
      theme: 'api-migration',
      text: 'Ravi Chandra opened the API migration ticket for Project LANTERN: rotate the gateway credentials and retire the legacy endpoint before the release.',
      identities: [
        { key: 'person:ravi-chandra', surface: 'Ravi Chandra', class: 'person' },
        { key: 'project:lantern', surface: 'Project LANTERN', class: 'project' },
      ],
    },
    {
      id: 'eng-scan',
      source: 'synthetic-estate',
      format: 'pdf-scan',
      department: 'engineering',
      theme: 'api-migration',
      text: 'API migration runbook. Ravi Chandra owns Project LANTERN. Retire the legacy endpoint, rotate gateway credentials, then verify the release checklist.',
      identities: [
        { key: 'person:ravi-chandra', surface: 'Ravi Chandra', class: 'person' },
        { key: 'project:lantern', surface: 'Project LANTERN', class: 'project' },
      ],
    },
    {
      id: 'eng-transcript',
      source: 'synthetic-estate',
      format: 'transcript',
      department: 'engineering',
      theme: 'api-migration',
      text: 'Kwame Asante asked how the API migration affects downstream clients. The team agreed the legacy endpoint retires only after the gateway credentials rotate.',
      identities: [{ key: 'person:kwame-asante', surface: 'Kwame Asante', class: 'person' }],
    },
    {
      id: 'ops-email',
      source: 'synthetic-estate',
      format: 'email',
      department: 'operations',
      theme: 'customer-onboarding',
      text: 'Nadia Farouk asked Ravi Chandra to update the customer onboarding checklist: welcome call, access handover, and a thirty day review.',
      identities: [
        { key: 'person:nadia-farouk', surface: 'Nadia Farouk', class: 'person' },
        { key: 'person:ravi-chandra', surface: 'Ravi Chandra', class: 'person' },
      ],
    },
    {
      id: 'ops-slides',
      source: 'synthetic-estate',
      format: 'slides',
      department: 'operations',
      theme: 'customer-onboarding',
      text: 'Customer onboarding\nWelcome call within two days\nAccess handover tracked in the ticket\nThirty day review owned by the success team',
      identities: [{ key: 'person:grace-okonkwo', surface: 'Grace Okonkwo', class: 'person' }],
    },
  ];
  const links = [
    { a: 'fin-email', b: 'fin-minutes', type: 'meeting-minutes' },
    { a: 'eng-ticket', b: 'eng-scan', type: 'attachment' },
    { a: 'sales-ticket', b: 'sales-deck', type: 'thread' },
  ];
  return { docs, links };
}

// ---------------------------------------------------------------------------
// Artifact writers.
// ---------------------------------------------------------------------------
export function writeLicenceAudit(outPath = OUT_AUDIT) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(LICENCE_AUDIT, null, 2) + '\n');
  return LICENCE_AUDIT;
}

export function runWeftTrainingPairArtifacts(options = {}) {
  const outDir = options.outDir || OUT_DIR;
  const mode = options.mode === 'live' ? 'live' : 'fixture';
  let corpus;
  let teacher = null;
  if (mode === 'live') {
    if (options.corpus) {
      // Recompile path (#52): pairs from an already-generated corpus, no teacher calls.
      corpus = options.corpus;
    } else {
      teacher = options.teacher || resolveLocalTeacher(options.env || process.env);
      corpus = generateTeacherEstates(teacher, {
        themes: options.themes,
        pairsTarget: options.targetPairs ?? 50000,
        orgProfile: options.orgProfile && typeof options.orgProfile === 'object' ? options.orgProfile : null,
      });
    }
  } else {
    corpus = options.corpus || fixtureCorpus();
  }
  const compiled = compileWeftTrainingPairs(corpus, {
    mode,
    teacher,
    corpusProvided: Boolean(options.corpus),
    includeDisjointNegatives: options.includeDisjointNegatives === true,
    excludeWithinChunk: options.excludeWithinChunk === true,
    diluteMaskedMarkers: options.diluteMaskedMarkers === true,
    includeMaskedStructural: options.includeMaskedStructural === true,
    orgProfile: options.orgProfile instanceof Object && options.orgProfile !== null && !Array.isArray(options.orgProfile)
      ? String(options.orgProfile.id || '')
      : (typeof options.orgProfile === 'string' ? options.orgProfile : null),
    targetPairs: options.targetPairs,
    evalSize: options.evalSize,
    augment: options.augment,
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'train.jsonl'), compiled.trainJsonl);
  fs.writeFileSync(path.join(outDir, 'eval.jsonl'), compiled.evalJsonl);
  fs.writeFileSync(path.join(outDir, 'receipt.json'), JSON.stringify(compiled.receipt, null, 2) + '\n');
  if (options.writeAudit !== false) writeLicenceAudit(options.auditPath || OUT_AUDIT);
  return compiled;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const compiled = runWeftTrainingPairArtifacts({
    mode: args.mode === 'live' ? 'live' : 'fixture',
    outDir: args.out ? path.resolve(args.out) : OUT_DIR,
    corpus: args.corpus ? JSON.parse(fs.readFileSync(path.resolve(String(args.corpus)), 'utf8')) : undefined,
    // shortcut: a corpus-provided recompile never refreshes the committed audit baseline
    writeAudit: args.corpus ? false : undefined,
    includeDisjointNegatives: args['include-disjoint-negatives'] === true,
    excludeWithinChunk: args['exclude-within-chunk'] === true,
    diluteMaskedMarkers: args['dilute-masked-markers'] === true,
    includeMaskedStructural: args['include-masked-structural'] === true,
    orgProfile: typeof args['org-profile'] === 'string' ? args['org-profile'] : undefined,
    targetPairs: args['target-pairs'] ? Number.parseInt(String(args['target-pairs']), 10) : undefined,
    evalSize: args['eval-size'] ? Number.parseInt(String(args['eval-size']), 10) : undefined,
  });
  console.log(
    JSON.stringify(
      {
        out: args.out ? path.resolve(args.out) : OUT_DIR,
        audit: OUT_AUDIT,
        receipt: compiled.receipt,
      },
      null,
      2
    )
  );
}
