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

const TITLE_PREFIX_RX = /\b(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?|Hon\.?|Justice|Judge|Capt\.?|Sgt\.?)\s+([A-Z][a-z]{2,24})\b/g;

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
  // 1) Start ASC, 2) Secret/structured WASM > length DESC > confidence DESC
  const sourceRank = (src, cat) => {
    if (cat === 'secret') return 4;
    if (src === 'wasm_stage3a') return 3;
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

  // Build surname -> full-name coreference map from detected PERSON / NAME_LIKELY spans
  const surnameToCanonical = new Map();
  if (options.enableCoref !== false) {
    for (const sp of scan.spans) {
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
  const allSpans = [...scan.spans];
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
    evasionCharsStripped: scan.evasionCharsStripped,
    homoglyphsFolded: scan.homoglyphsFolded,
    vault,
  };
}
