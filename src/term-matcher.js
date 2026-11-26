/**
 * Deterministic structural term breakdown & matching for `whitelist`, `blacklist`, and `keywords`.
 *
 * Design principles:
 * - Zero fuzzy/probabilistic guessing (especially critical for `whitelist`, where fuzzy matches
 *   could accidentally exempt real PII).
 * - Bidirectional structural breakdown:
 *     - Email <-> Name & handle (`elena.vance@acme.com` <-> `Elena Vance`, `elena_vance`, `elena-vance`,
 *       plus `elenavance@acme.com` when matching a name against an email)
 *     - RFC-5322 display-name + email (`Dr. Elena Vance <elena.vance@acme.com>`)
 *     - Honorific stripping (`Dr. Elena Vance` <-> `Elena Vance`)
 *     - Separator-agnostic identifiers (`ORG-2271` <-> `ORG_2271` <-> `ORG 2271`)
 *     - Digit-normalized phone numbers (`+44 20 7946 0906` <-> `+44-20-7946-0906` <-> `+442079460906`)
 *     - Diacritic & case folding (`Ondřej Novák` <-> `Ondrej Novak`) with exact UTF-16 source spans
 * - Safe precision guards:
 *     - Never expands generic role emails (`info@`, `support@`, `no-reply@`, `it-leadership@`) into words
 *     - Never expands a single-word email local-part (`elena@acme.com`) into a bare given name
 *     - Respects domain scope on `whitelist` when an email includes a domain (`john.doe@example.com`
 *       exempts `John Doe` and `john.doe@example.com`, NOT `john.doe@other.org`)
 */

const EMAIL_FULL_RX = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;
const RFC5322_NAME_EMAIL_RX = /^(.+?)\s*<\s*([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*>$/;
const EMAIL_IN_TEXT_RX = /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;
const PHONE_TERM_RX = /^\+?[\d\s().-]{7,}$/;
const PHONE_IN_TEXT_RX = /(?<!\d)\+?\d[\d\s().-]{5,}\d(?!\d)/g;
const LEADING_TITLE_RX = /^(?:dr|mr|mrs|ms|miss|prof|professor|hon|justice|judge|capt|captain|sgt|sergeant|rev|sir|dame|lady|lord)\.?\s+/i;

const GENERIC_ROLE_WORDS = new Set([
  'info', 'admin', 'administrator', 'support', 'help', 'helpdesk', 'sales',
  'contact', 'hello', 'hi', 'team', 'office', 'billing', 'account', 'accounts',
  'accounting', 'finance', 'legal', 'hr', 'human', 'resources', 'jobs', 'careers',
  'press', 'media', 'marketing', 'security', 'privacy', 'compliance', 'abuse',
  'postmaster', 'webmaster', 'hostmaster', 'root', 'noreply', 'no', 'do', 'not',
  'reply', 'notifications', 'notification', 'alerts', 'alert', 'status', 'feedback',
  'service', 'services', 'customer', 'customers', 'operations', 'ops', 'it', 'dev',
  'tech', 'technical', 'engineering', 'business', 'leadership', 'general', 'mail',
  'email', 'inbox', 'desk', 'enquiries', 'inquiries', 'enquiry', 'inquiry',
]);

/** Fold case and strip Unicode combining marks (diacritics). */
export function foldText(str) {
  return String(str ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Build a diacritic- and case-folded view of `raw` with exact UTF-16 offset maps back to `raw`.
 * Every index `k` in `norm` maps to `[origStart[k], origEnd[k])` in `raw`.
 */
function buildFoldedIndex(raw) {
  let norm = '';
  const origStart = [];
  const origEnd = [];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const folded = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!folded) {
      // Combining mark attached to the preceding character: extend its end offset.
      if (origEnd.length > 0) origEnd[origEnd.length - 1] = i + 1;
      continue;
    }
    for (let j = 0; j < folded.length; j++) {
      norm += folded[j];
      origStart.push(i);
      origEnd.push(i + 1);
    }
  }
  return { norm, origStart, origEnd };
}

function isLatinAlnum(ch) {
  return Boolean(ch) && /[a-z0-9]/.test(ch);
}

function stripLeadingTitle(str) {
  let s = String(str ?? '').trim();
  while (LEADING_TITLE_RX.test(s)) {
    s = s.replace(LEADING_TITLE_RX, '').trim();
  }
  return s;
}

function splitCamelCase(str) {
  return String(str ?? '').replace(/([a-z\u00e0-\u00ff])([A-Z\u00c0-\u00df])/g, '$1 $2');
}

function isGenericRoleTokens(tokens) {
  return tokens.length > 0 && tokens.every((t) => GENERIC_ROLE_WORDS.has(t));
}

/**
 * Extract structured name tokens from an email local part (e.g. `elena.vance+ops` -> `['elena', 'vance']`).
 * Returns null if the local part is a single word, generic role address, or non-name code.
 */
function extractNameTokensFromEmailLocal(rawLocal) {
  const baseLocal = String(rawLocal || '').split('+')[0].trim();
  if (!baseLocal) return null;

  let parts = baseLocal.split(/[._-]+/).filter(Boolean);
  if (parts.length === 1) {
    const camel = splitCamelCase(parts[0]).split(/\s+/).filter(Boolean);
    if (camel.length >= 2) parts = camel;
  }
  if (parts.length < 2) return null;

  const cleaned = [];
  for (let i = 0; i < parts.length; i++) {
    let tok = foldText(parts[i]);
    // Strip trailing disambiguation digits on the last segment (e.g. `elena.vance2` -> `vance`).
    if (i === parts.length - 1 && /^[a-z]{2,}\d{1,4}$/.test(tok)) {
      tok = tok.replace(/\d+$/, '');
    }
    if (!/^[a-z]+$/.test(tok)) return null;
    cleaned.push(tok);
  }

  if (cleaned.length < 2) return null;
  if (cleaned.filter((t) => t.length >= 2).length < 1) return null;
  // Require at least 4 total letters across parts so `a.b@x.com` never expands.
  if (cleaned.join('').length < 4) return null;
  if (isGenericRoleTokens(cleaned)) return null;
  return cleaned;
}

/**
 * Extract general separator-delimited token sequence (2+ tokens) for names or codes
 * (e.g. `"Elena Vance"` -> `['elena', 'vance']`, `"ORG-2271"` -> `['org', '2271']`).
 */
function extractTokenSeq(str) {
  const folded = foldText(str).trim();
  if (!folded) return null;
  const parts = folded.split(/[\s._-]+/).filter(Boolean);
  if (parts.length < 2) return null;
  // Every token must be alphanumeric (allowing internal apostrophes like o'connor).
  if (!parts.every((p) => /^[a-z0-9']+$/.test(p) && /[a-z0-9]/.test(p))) return null;
  return parts;
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addTokenSeq(entry, seq, isPersonName = false) {
  if (!seq || seq.length < 2) return;
  const sig = seq.join(' ');
  if (entry.tokenSeqMap.has(sig)) {
    if (isPersonName) entry.tokenSeqMap.get(sig).isPersonName = true;
    return;
  }
  // Match sequence across whitespace OR identifier separators (., _, -).
  const rx = new RegExp(seq.map(escapeRx).join('[\\s._-]+'), 'g');
  const emailTokens = seq.map((t) => t.replace(/'/g, ''));
  const alphaOnly = emailTokens.every((t) => /^[a-z]+$/.test(t));
  const joined = alphaOnly ? emailTokens.join('') : null;
  entry.tokenSeqMap.set(sig, {
    tokens: seq,
    emailTokens,
    rx,
    isPersonName: Boolean(isPersonName || alphaOnly),
    // Concatenated email local-part form (e.g. `elenavance@acme.com`) when unambiguous (>= 7 chars, 2+ tokens of >= 2 chars).
    concatLocal:
      alphaOnly && joined && joined.length >= 7 && emailTokens.every((t) => t.length >= 2) ? joined : null,
  });
}

function ingestPiece(entry, rawPiece) {
  const piece = String(rawPiece ?? '').trim();
  if (!piece) return;

  // 1. RFC-5322 `"Display Name <email@domain>"`
  const rfc = piece.match(RFC5322_NAME_EMAIL_RX);
  if (rfc) {
    entry.exactPhrases.add(foldText(piece));
    ingestPiece(entry, rfc[1].replace(/^["']|["']$/g, '').trim());
    ingestPiece(entry, rfc[2].trim());
    return;
  }

  // 2. Email address `local@domain`
  const em = piece.match(EMAIL_FULL_RX);
  if (em) {
    const rawLocal = em[1];
    const domain = foldText(em[2]);
    const baseLocal = foldText(rawLocal.split('+')[0]);
    const fullEmail = `${foldText(rawLocal)}@${domain}`;
    entry.emails.set(fullEmail, { baseLocal, domain });
    entry.exactPhrases.add(fullEmail);
    if (baseLocal !== foldText(rawLocal)) {
      entry.exactPhrases.add(`${baseLocal}@${domain}`);
    }
    const nameTokens = extractNameTokensFromEmailLocal(rawLocal);
    if (nameTokens) {
      addTokenSeq(entry, nameTokens, true);
    }
    return;
  }

  // 3. Phone number
  if (PHONE_TERM_RX.test(piece)) {
    const digits = piece.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      entry.phoneDigits.add(digits);
    }
  }

  // 4. Handle (`@elena.vance` / `@elena_vance`)
  if (/^@[A-Za-z0-9._-]{3,}$/.test(piece)) {
    const withoutAt = piece.slice(1);
    entry.exactPhrases.add(foldText(piece));
    entry.exactPhrases.add(foldText(withoutAt));
    const handleTokens = extractNameTokensFromEmailLocal(withoutAt);
    if (handleTokens) {
      addTokenSeq(entry, handleTokens, true);
    } else {
      const seq = extractTokenSeq(withoutAt);
      if (seq && !isGenericRoleTokens(seq)) addTokenSeq(entry, seq, false);
    }
    return;
  }

  // 5. General phrase, title-prefixed name, or separator-delimited code
  const folded = foldText(piece);
  entry.exactPhrases.add(folded);

  const untitled = stripLeadingTitle(piece);
  if (untitled && foldText(untitled) !== folded) {
    entry.exactPhrases.add(foldText(untitled));
    const untitledSeq = extractTokenSeq(untitled);
    if (untitledSeq && !isGenericRoleTokens(untitledSeq)) {
      addTokenSeq(entry, untitledSeq, untitledSeq.every((t) => /^[a-z]+$/.test(t)));
    }
  }

  const seq = extractTokenSeq(piece);
  if (seq && !isGenericRoleTokens(seq)) {
    addTokenSeq(entry, seq, seq.every((t) => /^[a-z]+$/.test(t)));
  } else if (/^[A-Za-z][A-Za-z0-9]*[A-Z][a-z]/.test(piece) && !/\s/.test(piece)) {
    // CamelCase handle like `elenaVance`
    const camelTokens = extractNameTokensFromEmailLocal(piece);
    if (camelTokens) addTokenSeq(entry, camelTokens, true);
  }
}

/**
 * Compile a user term list (array or comma/newline-separated string) into structured matchers.
 * Safe to call on an already-compiled list (returns it unchanged).
 */
export function compileTermList(input) {
  if (Array.isArray(input) && input._versieveCompiledTerms === true) return input;
  const rawList = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\r\n,]+/)
      : [];

  const byKey = new Map();
  for (const item of rawList) {
    const trimmed = String(item ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (byKey.has(key)) continue;

    const entry = {
      raw: trimmed,
      key,
      exactPhrases: new Set(),
      tokenSeqMap: new Map(),
      emails: new Map(), // fullEmail -> { baseLocal, domain }
      phoneDigits: new Set(),
      // True when the user supplied ONLY an email address (domain-scoped for whitelist safety).
      isDomainScopedEmail: EMAIL_FULL_RX.test(trimmed),
    };
    ingestPiece(entry, trimmed);
    entry.tokenSeqs = Array.from(entry.tokenSeqMap.values());
    byKey.set(key, entry);
  }
  const compiled = Array.from(byKey.values());
  Object.defineProperty(compiled, '_versieveCompiledTerms', { value: true });
  return compiled;
}

function emailMatchesTerm(rawEmail, term, mode) {
  const m = rawEmail.match(EMAIL_FULL_RX);
  if (!m) return false;
  const rawLocal = m[1];
  const domain = foldText(m[2]);
  const baseLocal = foldText(rawLocal.split('+')[0]);

  // 1. Direct email match (ignoring +tag on same domain)
  for (const em of term.emails.values()) {
    if (em.domain === domain && em.baseLocal === baseLocal) return true;
  }

  // On whitelist, if the user explicitly supplied a domain-scoped email (e.g. `john.doe@example.com`),
  // do NOT exempt a different domain (`john.doe@other.org`).
  if (mode === 'whitelist' && term.isDomainScopedEmail) {
    return false;
  }

  // 2. Match email local-part tokens against name token sequences
  const localTokens = extractNameTokensFromEmailLocal(rawLocal);
  const localAlphaConcat = baseLocal.replace(/[^a-z]/g, '');

  for (const seq of term.tokenSeqs) {
    if (!seq.isPersonName) continue;
    if (
      localTokens &&
      localTokens.length === seq.emailTokens.length &&
      localTokens.every((t, i) => t === seq.emailTokens[i])
    ) {
      return true;
    }
    // Concatenated local-part match (`elenavance@acme.com` matches `Elena Vance`).
    if (seq.concatLocal && baseLocal === seq.concatLocal) {
      return true;
    }
    if (seq.concatLocal && localAlphaConcat === seq.concatLocal && /^[a-z]+\d{0,4}$/.test(baseLocal)) {
      return true;
    }
  }

  return false;
}

/**
 * Find all non-overlapping matches of `compiledTerms` inside `raw` with exact UTF-16 offsets.
 *
 * Returns `{ start, end, value, termKey, kind }[]` sorted by start ascending (longest span wins on overlap).
 */
export function findTermMatches(raw, compiledTerms, options = {}) {
  if (!raw || !Array.isArray(compiledTerms) || compiledTerms.length === 0) return [];
  const mode = options.mode || 'blacklist';
  const text = String(raw);
  const { norm, origStart, origEnd } = buildFoldedIndex(text);
  if (!norm) return [];

  const candidates = [];
  const emailRanges = [];

  // Pass 1: Email spans in text (checked first so email spans are matched cleanly as whole units)
  const needsEmailScan = compiledTerms.some((t) => t.emails.size > 0 || t.tokenSeqs.some((s) => s.isPersonName));
  if (needsEmailScan && text.includes('@')) {
    EMAIL_IN_TEXT_RX.lastIndex = 0;
    let em;
    while ((em = EMAIL_IN_TEXT_RX.exec(text)) !== null) {
      const start = em.index;
      const end = start + em[0].length;
      emailRanges.push([start, end]);
      for (const term of compiledTerms) {
        if (emailMatchesTerm(em[0], term, mode)) {
          candidates.push({ start, end, value: em[0], termKey: term.key, kind: 'email' });
          break;
        }
      }
    }
  }

  const insideEmail = (s, e) => emailRanges.some(([es, ee]) => s >= es && e <= ee);

  // Pass 2: Phone number spans in text (digit-normalized)
  const needsPhoneScan = compiledTerms.some((t) => t.phoneDigits.size > 0);
  if (needsPhoneScan && /\d/.test(text)) {
    PHONE_IN_TEXT_RX.lastIndex = 0;
    let pm;
    while ((pm = PHONE_IN_TEXT_RX.exec(text)) !== null) {
      const digits = pm[0].replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      for (const term of compiledTerms) {
        if (term.phoneDigits.has(digits)) {
          candidates.push({
            start: pm.index,
            end: pm.index + pm[0].length,
            value: pm[0],
            termKey: term.key,
            kind: 'phone',
          });
          break;
        }
      }
    }
  }

  // Pass 3: Exact phrases & separator-flexible token sequences
  for (const term of compiledTerms) {
    // 3a. Exact folded phrases (word-bounded when edge chars are Latin/digit)
    for (const phrase of term.exactPhrases) {
      if (!phrase) continue;
      const checkLeft = isLatinAlnum(phrase[0]);
      const checkRight = isLatinAlnum(phrase[phrase.length - 1]);
      let from = 0;
      while ((from = norm.indexOf(phrase, from)) !== -1) {
        const endNorm = from + phrase.length;
        const leftOk = !checkLeft || !isLatinAlnum(norm[from - 1]);
        const rightOk = !checkRight || !isLatinAlnum(norm[endNorm]);
        if (leftOk && rightOk) {
          const start = origStart[from];
          const end = origEnd[endNorm - 1];
          // Do not emit a partial fragment inside an email address when the email itself didn't match.
          if (phrase.includes('@') || !insideEmail(start, end)) {
            candidates.push({
              start,
              end,
              value: text.slice(start, end),
              termKey: term.key,
              kind: 'exact',
            });
          }
        }
        from = from + 1;
      }
    }

    // 3b. Multi-token sequences across whitespace / separators (`Elena Vance` <-> `elena.vance`, `ORG-2271` <-> `ORG 2271`)
    for (const seq of term.tokenSeqs) {
      seq.rx.lastIndex = 0;
      let sm;
      while ((sm = seq.rx.exec(norm)) !== null) {
        const sNorm = sm.index;
        const eNorm = sNorm + sm[0].length;
        if (isLatinAlnum(norm[sNorm - 1]) || isLatinAlnum(norm[eNorm])) continue;
        const start = origStart[sNorm];
        const end = origEnd[eNorm - 1];
        // Email local parts are already handled in Pass 1 with domain-scoping rules.
        if (insideEmail(start, end)) continue;
        candidates.push({
          start,
          end,
          value: text.slice(start, end),
          termKey: term.key,
          kind: 'breakdown',
        });
      }
    }
  }

  // Deduplicate overlaps: start ASC, longer span first, email kind preferred over fragment
  const kindRank = (k) => (k === 'email' ? 3 : k === 'phone' ? 2 : k === 'exact' ? 1 : 0);
  candidates.sort(
    (a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || kindRank(b.kind) - kindRank(a.kind)
  );

  const deduped = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start >= lastEnd) {
      deduped.push(c);
      lastEnd = c.end;
    }
  }
  return deduped;
}

/**
 * Return the list of distinct canonical keyword keys from `compiledTerms` that match inside `raw`.
 */
export function matchTermKeysInText(raw, compiledTerms, options = {}) {
  if (!raw || !Array.isArray(compiledTerms) || compiledTerms.length === 0) return [];
  const mode = options.mode || 'keywords';
  const text = String(raw);
  const { norm } = buildFoldedIndex(text);
  if (!norm) return [];

  const matched = [];
  const emailsInText = text.includes('@') ? text.match(EMAIL_IN_TEXT_RX) || [] : [];
  const phonesInText = /\d/.test(text)
    ? (text.match(PHONE_IN_TEXT_RX) || [])
        .map((p) => p.replace(/\D/g, ''))
        .filter((d) => d.length >= 7 && d.length <= 15)
    : [];

  for (const term of compiledTerms) {
    let hit = false;

    // 1. Emails in text
    if (!hit && emailsInText.length > 0 && (term.emails.size > 0 || term.tokenSeqs.some((s) => s.isPersonName))) {
      for (const em of emailsInText) {
        if (emailMatchesTerm(em, term, mode)) {
          hit = true;
          break;
        }
      }
    }

    // 2. Phones in text
    if (!hit && phonesInText.length > 0 && term.phoneDigits.size > 0) {
      for (const d of phonesInText) {
        if (term.phoneDigits.has(d)) {
          hit = true;
          break;
        }
      }
    }

    // 3. Exact folded phrases (word-bounded)
    if (!hit) {
      for (const phrase of term.exactPhrases) {
        if (!phrase) continue;
        const checkLeft = isLatinAlnum(phrase[0]);
        const checkRight = isLatinAlnum(phrase[phrase.length - 1]);
        let from = 0;
        while ((from = norm.indexOf(phrase, from)) !== -1) {
          const endNorm = from + phrase.length;
          if ((!checkLeft || !isLatinAlnum(norm[from - 1])) && (!checkRight || !isLatinAlnum(norm[endNorm]))) {
            hit = true;
            break;
          }
          from = from + 1;
        }
        if (hit) break;
      }
    }

    // 4. Multi-token sequences
    if (!hit) {
      for (const seq of term.tokenSeqs) {
        seq.rx.lastIndex = 0;
        let sm;
        while ((sm = seq.rx.exec(norm)) !== null) {
          if (!isLatinAlnum(norm[sm.index - 1]) && !isLatinAlnum(norm[sm.index + sm[0].length])) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }

    if (hit) matched.push(term.key);
  }

  return matched;
}

/**
 * Check whether a detected PII/secret span should be exempted by a compiled whitelist.
 * Matches if:
 *  - the span is covered by a whitelist match span in the surrounding text, OR
 *  - the span's value (with optional leading honorific stripped, e.g. `"Dr. Elena Vance"`)
 *    itself matches a whitelisted term (including email <-> name breakdown).
 */
export function isSpanWhitelisted(sp, raw, compiledWhitelist, whitelistSpans) {
  if (!compiledWhitelist || compiledWhitelist.length === 0) return false;
  if (whitelistSpans && whitelistSpans.some((w) => w.start <= sp.start && sp.end <= w.end)) {
    return true;
  }
  const value = String(sp.value ?? raw.slice(sp.start, sp.end)).trim();
  if (!value) return false;

  // Direct email check (respects domain scoping on whitelist)
  if (EMAIL_FULL_RX.test(value)) {
    return compiledWhitelist.some((term) => emailMatchesTerm(value, term, 'whitelist'));
  }

  // Phone check
  if (PHONE_TERM_RX.test(value)) {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      if (compiledWhitelist.some((term) => term.phoneDigits.has(digits))) return true;
    }
  }

  // Check exact folded value or title-stripped value (`Dr. Elena Vance` -> `Elena Vance`)
  const candidates = [foldText(value)];
  const untitled = foldText(stripLeadingTitle(value));
  if (untitled && untitled !== candidates[0]) candidates.push(untitled);

  for (const cand of candidates) {
    for (const term of compiledWhitelist) {
      if (term.exactPhrases.has(cand)) return true;
      for (const seq of term.tokenSeqs) {
        const normalizedCand = cand.replace(/[\s._-]+/g, ' ').trim();
        if (normalizedCand === seq.tokens.join(' ')) return true;
      }
    }
  }
  return false;
}
