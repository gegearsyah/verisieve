/**
 * Enterprise Secret & Unified Stage 3A/3B Hybrid PII Fusion Engine
 * Powered by zero-import `versieve_media.wasm` (Unicode anti-evasion + international checksums
 * + 30+ secret detectors with capture-group Shannon entropy & JWT structural verification).
 *
 * Also implements intra-document surname/title coreference linking so `"Elena Vance"` and
 * `"Ms. Vance"` map to the EXACT SAME salted pseudonym (`<PII:PERSON_01>`) across modalities.
 */

import { loadMediaWasmSync } from './media-wasm.js';
import { scanRecordsForPII } from './clean-and-tokenize.js';
import { SaltedPseudonymVault } from './graph-wasm.js';
import { compileTermList, findTermMatches, isSpanWhitelisted } from './term-matcher.js';

const TITLE_PREFIX_RX = /\b(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?|Hon\.?|Justice|Judge|Capt\.?|Sgt\.?)\s+([A-Z][a-z]{2,24})\b/g;

// ---------------------------------------------------------------------------
// HIPAA Safe Harbor Identifier Validators (45 CFR § 164.514(b)(2))
// ---------------------------------------------------------------------------
const DEA_REGISTRANT_TYPES = new Set(['A', 'B', 'F', 'G', 'M', 'P', 'R', 'X']);
const MBI_REGEX = /^([1-9][AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9])([- ]?)([AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9])\2([AC-HJKMNP-RT-Y]{2}[0-9]{2})$/;
const CLIA_REGEX = /^\d{2}D\d{7}$/;
const MRN_VALUE_REGEX = /^[A-Z0-9][A-Z0-9-]{3,18}[A-Z0-9]$/i;

const MONTH_NAME_TO_NUM = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function luhnMod10(digits) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Validate a 10-digit US National Provider Identifier (NPI) using the official
 * CMS ISO/IEC 7812-1 Luhn check with constant prefix `80840`.
 */
export function validateNpiNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const trimmed = String(value).trim();
  if (!/^[\d\s-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^[12]\d{9}$/.test(digits)) return false;
  return luhnMod10(`80840${digits}`);
}

/**
 * Validate a US DEA registration number:
 * - 1st char: valid registrant type (`A, B, F, G, M, P, R, X`)
 * - 2nd char: registrant surname/entity initial (`A-Z`)
 * - 7 digits `d1..d7` satisfying `((d1 + d3 + d5) + 2 * (d2 + d4 + d6)) % 10 === d7`
 */
export function validateDeaNumber(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Z])([A-Z])[ -]?(\d{7})$/);
  if (!match) return false;
  if (!DEA_REGISTRANT_TYPES.has(match[1])) return false;
  const digits = match[3];
  const d1 = digits.charCodeAt(0) - 48;
  const d2 = digits.charCodeAt(1) - 48;
  const d3 = digits.charCodeAt(2) - 48;
  const d4 = digits.charCodeAt(3) - 48;
  const d5 = digits.charCodeAt(4) - 48;
  const d6 = digits.charCodeAt(5) - 48;
  const d7 = digits.charCodeAt(6) - 48;
  const checksum = ((d1 + d3 + d5) + 2 * (d2 + d4 + d6)) % 10;
  return checksum === d7;
}

/**
 * Validate a CMS Medicare Beneficiary Identifier (MBI):
 * 11-character positional format excluding S, L, O, I, B, Z (optional 4-3-4 hyphens/spaces).
 */
export function validateMbiNumber(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return MBI_REGEX.test(trimmed);
}

/**
 * Validate a Clinical Laboratory Improvement Amendments (CLIA) 10-char ID (`^\d{2}D\d{7}$`).
 */
export function validateCliaNumber(value) {
  if (typeof value !== 'string') return false;
  return CLIA_REGEX.test(value.trim());
}

/**
 * Validate a Medical Record Number (MRN) value token (used with clinical context anchors).
 */
export function validateMrnNumber(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!MRN_VALUE_REGEX.test(trimmed)) return false;
  if (trimmed.includes('--')) return false;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  return digitCount >= 4;
}

function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= maxDays;
}

/**
 * Validate a HIPAA Safe Harbor date string (ISO, US numeric, or written month-day-year).
 */
export function validateHipaaDate(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return isValidCalendarDate(Number(m[3]), Number(m[1]), Number(m[2]));

  m = trimmed.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTH_NAME_TO_NUM[m[1].toLowerCase()];
    if (!mon) return false;
    return isValidCalendarDate(Number(m[3]), mon, Number(m[2]));
  }

  m = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const mon = MONTH_NAME_TO_NUM[m[2].toLowerCase()];
    if (!mon) return false;
    return isValidCalendarDate(Number(m[3]), mon, Number(m[1]));
  }

  return false;
}

function isEmbeddedInHashOrUuid(raw, start, end) {
  const before = start > 0 ? raw[start - 1] : '';
  const after = end < raw.length ? raw[end] : '';
  if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) return true;
  // Guard against matching a middle segment of a UUID or hyphenated hex hash
  if (before === '-') {
    const segBefore = raw.slice(Math.max(0, start - 13), start - 1);
    if (/(?:^|[^A-Za-z0-9])[0-9a-f]{4,12}$/i.test(segBefore)) return true;
  }
  if (after === '-') {
    const segAfter = raw.slice(end + 1, Math.min(raw.length, end + 14));
    if (/^[0-9a-f]{4,12}(?:$|[^A-Za-z0-9])/i.test(segAfter)) return true;
  }
  return false;
}

const HIPAA_DATE_BODY =
  '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?,?\\s+\\d{4})';

const HIPAA_RULES = [
  // 1. NPI (context-anchored 10-digit Luhn with 80840 prefix)
  {
    type: 'NPI',
    rx: /\b(?:NPI|National\s+Provider(?:\s+Identifier|\s+ID)?|Provider\s+NPI)\b[ \t]*[:#=\-]?[ \t]*(\d{10})\b/gi,
    validate: (v) => validateNpiNumber(v),
    confidence: 0.99,
  },
  // 2. DEA (context-anchored with optional separator or case normalization)
  {
    type: 'DEA',
    rx: /\bDEA(?:\s+(?:Number|No\.?|#|ID|Reg(?:istration)?))?\b[ \t]*[:#=\-]?[ \t]*([A-Za-z]{2}[ -]?\d{7})\b/gi,
    validate: (v) => validateDeaNumber(v.toUpperCase()),
    confidence: 0.99,
  },
  // 2b. DEA (standalone strictly uppercase with strict registrant type & checksum)
  {
    type: 'DEA',
    rx: /\b([ABFGMPRX][A-Z]\d{7})\b/g,
    validate: (v, raw, start, end) => !isEmbeddedInHashOrUuid(raw, start, end) && validateDeaNumber(v),
    confidence: 0.96,
  },
  // 3. MBI (context-anchored, optional hyphens/spaces)
  {
    type: 'MBI',
    rx: /\b(?:MBI|Medicare(?:\s+Beneficiary)?\s*(?:Identifier|ID|Number|No\.?|#))\b[ \t]*[:#=\-]?[ \t]*([1-9][A-Za-z][0-9A-Za-z][0-9][- ]?[A-Za-z][0-9A-Za-z][0-9][- ]?[A-Za-z]{2}[0-9]{2})\b/gi,
    validate: (v) => validateMbiNumber(v.toUpperCase()),
    confidence: 0.99,
  },
  // 3b. MBI (standalone strictly uppercase CMS positional alphabet excluding S,L,O,I,B,Z)
  {
    type: 'MBI',
    rx: /\b([1-9][AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9](?:-[AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9]-[AC-HJKMNP-RT-Y]{2}[0-9]{2}|[AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9][AC-HJKMNP-RT-Y]{2}[0-9]{2}))\b/g,
    validate: (v, raw, start, end) => !isEmbeddedInHashOrUuid(raw, start, end) && validateMbiNumber(v),
    confidence: 0.97,
  },
  // 4. CLIA (context-anchored)
  {
    type: 'CLIA',
    rx: /\bCLIA(?:\s+(?:Number|No\.?|#|ID|Cert(?:ificate)?))?\b[ \t]*[:#=\-]?[ \t]*(\d{2}[Dd]\d{7})\b/gi,
    validate: (v) => validateCliaNumber(v.toUpperCase()),
    confidence: 0.99,
  },
  // 4b. CLIA (standalone strict 10-char ^\d{2}D\d{7}$)
  {
    type: 'CLIA',
    rx: /\b(\d{2}D\d{7})\b/g,
    validate: (v, raw, start, end) => !isEmbeddedInHashOrUuid(raw, start, end) && validateCliaNumber(v),
    confidence: 0.96,
  },
  // 5. MRN (strictly context-anchored)
  {
    type: 'MRN',
    rx: /\b(?:MRN|Medical\s+Record(?:\s+(?:Number|No\.?|#|ID))?|Med\.?\s*Rec\.?\s*(?:No\.?|#)?|Patient\s+(?:ID|Number|No\.?|#)|Chart\s*(?:Number|No\.?|#|ID))\b[ \t]*[:#=\-]?[ \t]*([A-Z0-9][A-Z0-9-]{3,18}[A-Z0-9])\b/gi,
    validate: (v) => validateMrnNumber(v),
    confidence: 0.97,
  },
  // 6. Health Plan Beneficiary / Member / Subscriber ID (strictly context-anchored)
  {
    type: 'HEALTH_PLAN_ID',
    rx: /\b(?:Health\s+Plan(?:\s+(?:Beneficiary|Member))?\s*(?:ID|Number|No\.?|#)|Member\s+ID|Subscriber\s+ID|Beneficiary\s+(?:ID|Number|No\.?|#)|Insurance\s+(?:Policy|Member)?\s*(?:ID|Number|No\.?|#))\b[ \t]*[:#=\-]?[ \t]*([A-Z0-9][A-Z0-9-]{4,19})\b/gi,
    validate: (v) => validateMrnNumber(v),
    confidence: 0.95,
  },
  // 7. Medical Device / Implant Serial / Certificate / Medical License Number (strictly context-anchored)
  {
    type: 'DEVICE_ID',
    rx: /\b(?:Device\s+(?:Identifier|Serial|ID|Number|No\.?|#)|UDI|Implant\s+Serial(?:\s*(?:No\.?|#|Number))?|Certificate\s+(?:Number|No\.?|#|ID)|Medical\s+License(?:\s*(?:Number|No\.?|#|ID))?)\b[ \t]*[:#=\-]?[ \t]*([A-Z0-9][A-Z0-9-]{4,23})\b/gi,
    validate: (v) => /^[A-Z0-9][A-Z0-9-]{3,22}[A-Z0-9]$/i.test(v) && !v.includes('--') && (v.match(/\d/g) || []).length >= 3,
    confidence: 0.94,
  },
  // 8a. HIPAA Safe Harbor Date of Birth (clinical DOB anchor; emits DATE_OF_BIRTH for schema continuity)
  {
    type: 'DATE_OF_BIRTH',
    rx: new RegExp(`\\b(?:DOB|D\\.O\\.B\\.|Date\\s+of\\s+Birth|Birth\\s*Date)\\b[ \\t]*[:#=\\-]?[ \\t]*(${HIPAA_DATE_BODY})\\b`, 'gi'),
    validate: (v) => validateHipaaDate(v),
    confidence: 0.97,
  },
  // 8b. HIPAA Safe Harbor Clinical Dates (admission, discharge, DOS, DOD, procedure, specimen, etc.)
  {
    type: 'HIPAA_DATE',
    rx: new RegExp(`\\b(?:Admission\\s+Date|Admitted(?:\\s+on)?|Discharge\\s+Date|Discharged(?:\\s+on)?|Date\\s+of\\s+Service|DOS|Date\\s+of\\s+Death|DOD|Visit\\s+Date|Procedure\\s+Date|Exam\\s+Date|Specimen\\s+Date|Collection\\s+Date)\\b[ \\t]*[:#=\\-]?[ \\t]*(${HIPAA_DATE_BODY})\\b`, 'gi'),
    validate: (v) => validateHipaaDate(v),
    confidence: 0.96,
  },
];

/**
 * Deterministic HIPAA Safe Harbor identifier scanner.
 * Covers NPI, DEA, MBI, CLIA, MRN, Health Plan Beneficiary IDs, Device/Certificate/License IDs,
 * and clinically anchored Safe Harbor dates with strict checksum/format validation.
 */
export function scanHipaaIdentifiers(text, options = {}) {
  const raw = String(text ?? '');
  const allowedTypes = Array.isArray(options.types) && options.types.length > 0
    ? new Set(options.types.map((t) => String(t).toUpperCase()))
    : null;
  const rawHits = [];

  for (const rule of HIPAA_RULES) {
    if (allowedTypes && !allowedTypes.has(rule.type)) continue;
    const rx = new RegExp(rule.rx.source, rule.rx.flags);
    let m;
    while ((m = rx.exec(raw)) !== null) {
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      const captured = m[1];
      if (!captured) continue;
      // Locate captured group at the end of full match (handles cases where prefix repeats value chars)
      const offsetInMatch = m[0].lastIndexOf(captured);
      const start = offsetInMatch !== -1 ? m.index + offsetInMatch : m.index;
      const end = start + captured.length;
      if (!rule.validate(captured, raw, start, end)) continue;

      rawHits.push({
        type: rule.type,
        category: 'pii',
        start,
        end,
        value: captured,
        confidence: rule.confidence,
        entropy: 0,
        evasionNormalized: false,
        validated: true,
        source: 'hipaa_stage3a',
      });
    }
  }

  rawHits.sort(
    (a, b) =>
      a.start - b.start ||
      (b.end - b.start) - (a.end - a.start) ||
      b.confidence - a.confidence
  );

  const spans = [];
  let lastEnd = -1;
  for (const hit of rawHits) {
    if (hit.start >= lastEnd) {
      spans.push(hit);
      lastEnd = hit.end;
    }
  }

  const countsByType = {};
  for (const sp of spans) {
    countsByType[sp.type] = (countsByType[sp.type] || 0) + 1;
  }

  return {
    spans,
    countsByType,
    totalCount: spans.length,
  };
}

const LEADING_SENTENCE_VERBS = new Set([
  'brief', 'later', 'please', 'call', 'email', 'send', 'ask', 'notify', 'meet',
  'contact', 'tell', 'inform', 'update', 'review', 'forward', 'schedule', 'copy',
  'assign', 'remind', 'thank', 'welcome', 'hello', 'dear', 'from', 'attention',
]);

function refineNameSpan(raw, hit) {
  if (String(hit.type || '').toLowerCase() !== 'name_likely') return hit;
  let start = hit.start;
  let end = hit.end;
  let value = raw.slice(start, end);
  const words = value.split(/\s+/);
  // If regex grabbed "<SentenceVerb> <FirstName>" right before "<LastName>" (e.g. "Brief Elena Vance"),
  // shift the span forward onto "<FirstName> <LastName>" so the surname is NEVER left exposed!
  if (words.length === 2 && LEADING_SENTENCE_VERBS.has(words[0].toLowerCase())) {
    const after = raw.slice(end);
    const nextCap = after.match(/^(\s+[A-Z][a-z]{1,24})\b/);
    if (nextCap) {
      const firstLen = words[0].length;
      const wsLen = value.slice(firstLen).match(/^\s+/)?.[0]?.length || 1;
      start = start + firstLen + wsLen;
      end = end + nextCap[1].length;
      value = raw.slice(start, end);
    }
  }
  return { ...hit, start, end, value };
}

function normalizeVaultKind(rawType, category) {
  const upper = String(rawType || 'CUSTOM').toUpperCase();
  if (category === 'secret') return upper;
  if (upper === 'NAME_LIKELY' || upper === 'PERSON') return 'PERSON';
  if (upper === 'ADDRESS_LIKELY' || upper === 'STREET_ADDRESS') return 'ADDRESS';
  if (upper === 'PHONE_NUMBER') return 'PHONE';
  return upper;
}

/**
 * Scan text for 30+ enterprise secrets, international checksummed IDs, Unicode-evaded PII,
 * standard Stage 3A PII, and optional Stage 3B neural NER spans.
 */
const ENTERPRISE_HEADING_EXCLUSIONS = [
  'final', 'demo', 'presentation', 'team', 'client', 'sprint', 'meeting', 'feedback', 'merge',
  'answer', 'key', 'live', 'goals', 'contact', 'next', 'steps', 'overview', 'summary', 'agenda',
  'appendix', 'baseline', 'problem', 'evidence', 'compliance', 'applicable', 'rules', 'checks',
  'project', 'roadmap', 'timeline', 'milestone', 'deliverable', 'metrics', 'architecture',
];

export function scanEnterprisePiiAndSecrets(text, options = {}) {
  const raw = String(text ?? '');
  const engine = loadMediaWasmSync();
  const wasmReport = engine.scanPiiAndSecrets(raw);

  // Merge enterprise slide/deck non-person headings into domainConfig exclusions
  const mergedExtraExcluded = [
    ...ENTERPRISE_HEADING_EXCLUSIONS,
    ...(options?.domainConfig?.extraExcludedWords || []),
  ];
  const mergedOptions = {
    ...options,
    domainConfig: {
      ...(options?.domainConfig || {}),
      extraExcludedWords: mergedExtraExcluded,
    },
  };

  // Run legacy Stage 3A regex scanner (phones, DOB, addresses, Title-Case names, domain configs)
  const regexHits = options.includeStandardPii === false ? [] : scanRecordsForPII(raw, mergedOptions);

  // Run HIPAA Safe Harbor deterministic validator pack (NPI, DEA, MBI, CLIA, MRN, Safe Harbor dates/IDs)
  const hipaaReport =
    options.includeHipaa === false || options.hipaaPack === false
      ? { spans: [], countsByType: {}, totalCount: 0 }
      : scanHipaaIdentifiers(raw, options.hipaaOptions || {});

  const combined = [];

  for (const sp of wasmReport.spans || []) {
    combined.push({
      type: sp.type,
      category: sp.category === 'secret' ? 'secret' : 'pii',
      start: sp.start,
      end: sp.end,
      value: raw.slice(sp.start, sp.end),
      confidence: sp.confidence ?? 0.95,
      entropy: sp.entropy ?? 0,
      evasionNormalized: Boolean(sp.evasionNormalized),
      source: 'wasm_stage3a',
    });
  }

  for (const hsp of hipaaReport.spans || []) {
    combined.push({
      ...hsp,
      value: hsp.value ?? raw.slice(hsp.start, hsp.end),
    });
  }

  for (const rawHit of regexHits) {
    const hit = refineNameSpan(raw, rawHit);
    combined.push({
      type: String(hit.type || 'pii').toUpperCase(),
      category: String(hit.type || '').toLowerCase() === 'api_key' ? 'secret' : 'pii',
      start: hit.start,
      end: hit.end,
      value: hit.value ?? raw.slice(hit.start, hit.end),
      confidence: 0.85,
      entropy: 0,
      evasionNormalized: false,
      source: 'regex_stage3a',
    });
  }

  // Optional Stage 3B neural spans (from GLiNER-Edge / GLiNER2-PII ONNX)
  if (Array.isArray(options.neuralSpans)) {
    for (const nsp of options.neuralSpans) {
      if (!Number.isInteger(nsp.start) || !Number.isInteger(nsp.end) || nsp.end <= nsp.start) continue;
      combined.push({
        type: String(nsp.type || nsp.label || 'PERSON').toUpperCase(),
        category: 'pii',
        start: nsp.start,
        end: nsp.end,
        value: raw.slice(nsp.start, nsp.end),
        confidence: Number(nsp.confidence ?? nsp.score ?? 0.75),
        entropy: 0,
        evasionNormalized: false,
        source: 'neural_stage3b',
      });
    }
  }

  // Priority-aware overlap resolution:
  // 1) Start ASC, 2) Secret/structured WASM & HIPAA > length DESC > confidence DESC
  const sourceRank = (src, cat) => {
    if (cat === 'secret') return 4;
    if (src === 'wasm_stage3a' || src === 'hipaa_stage3a') return 3;
    if (src === 'regex_stage3a') return 2;
    return 1;
  };

  combined.sort(
    (a, b) =>
      a.start - b.start ||
      (b.end - b.start) - (a.end - a.start) ||
      sourceRank(b.source, b.category) - sourceRank(a.source, a.category) ||
      b.confidence - a.confidence
  );

  const deduped = [];
  let lastEnd = -1;
  for (const item of combined) {
    if (item.start >= lastEnd) {
      deduped.push(item);
      lastEnd = item.end;
    }
  }

  return {
    spans: deduped,
    secretCount: deduped.filter((s) => s.category === 'secret').length,
    piiCount: deduped.filter((s) => s.category === 'pii').length,
    hipaaCount: deduped.filter((s) => s.source === 'hipaa_stage3a').length,
    evasionCharsStripped: wasmReport.evasionCharsStripped || 0,
    homoglyphsFolded: wasmReport.homoglyphsFolded || 0,
  };
}

/**
 * Redact text with workspace-salted pseudonyms (`<PII:PERSON_01>`, `<SECRET:AWS_ACCESS_KEY_01>`)
 * + intra-document surname coreference linking (`"Elena Vance"` -> `"Ms. Vance"` shares `<PII:PERSON_01>`).
 */
export function redactEnterpriseText(text, options = {}) {
  const raw = String(text ?? '');
  const vault = options.vault || new SaltedPseudonymVault(options.workspaceSalt || 'versieve-enterprise-v1');
  const scan = scanEnterprisePiiAndSecrets(raw, options);

  // Whitelist = never redact (exempt); blacklist = always redact (wins on overlap).
  // Both use deterministic structural breakdown (email <-> name/handle, separator & phone normalization).
  const compiledAllow = compileTermList(options.whitelist);
  const compiledDeny = compileTermList(options.blacklist);
  const allowSpans =
    compiledAllow.length > 0 ? findTermMatches(raw, compiledAllow, { mode: 'whitelist' }) : [];
  const spans =
    compiledAllow.length > 0
      ? scan.spans.filter((sp) => !isSpanWhitelisted(sp, raw, compiledAllow, allowSpans))
      : [...scan.spans];
  if (compiledDeny.length > 0) {
    const denyMatches = findTermMatches(raw, compiledDeny, { mode: 'blacklist' });
    for (const m of denyMatches) {
      if (spans.some((s) => m.start < s.end && m.end > s.start)) continue;
      spans.push({
        type: 'CUSTOM',
        category: 'pii',
        start: m.start,
        end: m.end,
        value: m.value,
        confidence: 0.99,
        entropy: 0,
        evasionNormalized: false,
        source: 'blacklist',
      });
    }
    spans.sort((a, b) => a.start - b.start);
  }

  // Build surname -> full-name coreference map from detected PERSON / NAME_LIKELY spans
  const surnameToCanonical = new Map();
  if (options.enableCoref !== false) {
    for (const sp of spans) {
      const kind = normalizeVaultKind(sp.type, sp.category);
      if (kind !== 'PERSON') continue;
      const tokens = sp.value.trim().split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        const surname = tokens[tokens.length - 1].replace(/[^A-Za-z'-]/g, '').toLowerCase();
        if (surname.length >= 3 && !surnameToCanonical.has(surname)) {
          surnameToCanonical.set(surname, sp.value.trim());
        }
      }
    }
  }

  // Detect titled surname coreferences ("Ms. Vance", "Dr. Chen") — both linking already-detected
  // PERSON spans AND adding newly matched titled surname spans so both map to the same canonical entityId!
  const allSpans = [...spans];
  if (surnameToCanonical.size > 0) {
    for (const sp of allSpans) {
      if (sp.category !== 'pii') continue;
      const mTitle = sp.value.trim().match(/^(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?|Hon\.?|Justice|Judge|Capt\.?|Sgt\.?)\s+([A-Z][a-z]{2,24})$/);
      if (mTitle) {
        const sn = mTitle[1].toLowerCase();
        if (surnameToCanonical.has(sn)) {
          sp.canonicalAlias = surnameToCanonical.get(sn);
        }
      }
    }
    TITLE_PREFIX_RX.lastIndex = 0;
    let m;
    while ((m = TITLE_PREFIX_RX.exec(raw)) !== null) {
      const surnameLower = m[1].toLowerCase();
      if (!surnameToCanonical.has(surnameLower)) continue;
      const start = m.index;
      const end = start + m[0].length;
      const existingIdx = allSpans.findIndex((s) => !(end <= s.start || start >= s.end));
      if (existingIdx !== -1) {
        // Replace partial/malformed overlap (e.g. "Later Ms") with exact titled surname span ("Ms. Vance")
        allSpans[existingIdx] = {
          ...allSpans[existingIdx],
          type: 'PERSON',
          category: 'pii',
          start,
          end,
          value: m[0],
          canonicalAlias: surnameToCanonical.get(surnameLower),
          source: 'coref_surname',
        };
      } else {
        allSpans.push({
          type: 'PERSON',
          category: 'pii',
          start,
          end,
          value: m[0],
          canonicalAlias: surnameToCanonical.get(surnameLower),
          confidence: 0.9,
          entropy: 0,
          evasionNormalized: false,
          source: 'coref_surname',
        });
      }
    }
    allSpans.sort((a, b) => a.start - b.start);
  }

  let maskedText = '';
  let cursor = 0;
  const entities = [];

  for (const sp of allSpans) {
    if (sp.start < cursor) continue;
    maskedText += raw.slice(cursor, sp.start);

    const canonicalValue = sp.canonicalAlias || sp.value;
    const vaultKind = normalizeVaultKind(sp.type, sp.category);
    let token;
    let entityId;

    if (sp.category === 'secret') {
      const rec = vault.pseudonymize(canonicalValue, `SECRET_${vaultKind}`);
      token = rec.display_token.startsWith('<SECRET:')
        ? rec.display_token
        : rec.display_token.replace(/^<PII:SECRET_/, '<SECRET:');
      entityId = rec.entity_id;
    } else {
      const rec = vault.pseudonymize(canonicalValue, vaultKind);
      token = rec.display_token;
      entityId = rec.entity_id;
    }

    maskedText += token;
    entities.push({
      type: vaultKind,
      category: sp.category,
      token,
      entityId,
      start: sp.start,
      end: sp.end,
      confidence: sp.confidence,
      entropy: sp.entropy,
      source: sp.source,
      evasionNormalized: sp.evasionNormalized,
    });
    cursor = sp.end;
  }
  maskedText += raw.slice(cursor);

  return {
    maskedText,
    entities,
    secretCount: scan.secretCount,
    piiCount: entities.filter((e) => e.category === 'pii').length,
    hipaaCount: entities.filter((e) => e.source === 'hipaa_stage3a').length,
    evasionCharsStripped: scan.evasionCharsStripped,
    homoglyphsFolded: scan.homoglyphsFolded,
    vault,
  };
}
