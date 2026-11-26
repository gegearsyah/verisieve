/**
 * Opt-In Reversible Vault Restoration Boundary
 *
 * Security invariants:
 * 1. Default mode is strictly one-way irreversible salted vaulting (`reversible: false`).
 *    Zero plaintext is retained in memory unless the caller explicitly opts in with
 *    `reversible: true` AND does NOT mark the session or export `irreversible: true` / `oneWay: true`.
 * 2. Restoration (`restoreFromVault`) fails closed with a structured `VaultRestoreError`
 *    (returning zero plaintext) unless ALL conditions hold:
 *      - Vault was created with explicit `reversible: true`,
 *      - Neither vault, redacted payload, nor call options is marked `irreversible: true` or `oneWay: true`,
 *      - Explicit `authorized: true` flag is provided,
 *      - Matching `workspaceSalt` (constant-time SHA-256 verification) and optional `vaultId` match.
 * 3. Reverse lookup tables are stored exclusively in a module-private WeakMap so
 *    `JSON.stringify(vault)` and `exportRedactedEntities()` can never serialize plaintext.
 */

import crypto from 'node:crypto';
import { SaltedPseudonymVault } from './graph-wasm.js';
import { scanEnterprisePiiAndSecrets } from './secret-scanner.js';
import { compileTermList, findTermMatches, isSpanWhitelisted } from './term-matcher.js';

const PLACEHOLDER_TOKEN_RX = /<(?:PII|SECRET):[A-Z0-9_]+>/g;
const VAULT_PRIVATE_STATE = new WeakMap();

export const VAULT_ERROR_CODES = Object.freeze({
  VAULT_INVALID: 'VAULT_INVALID',
  VAULT_RESTORE_DISABLED: 'VAULT_RESTORE_DISABLED',
  VAULT_IRREVERSIBLE_MODE: 'VAULT_IRREVERSIBLE_MODE',
  VAULT_UNAUTHORIZED: 'VAULT_UNAUTHORIZED',
  VAULT_BINDING_MISMATCH: 'VAULT_BINDING_MISMATCH',
});

export class VaultRestoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultRestoreError';
    this.code = code;
    this.failClosed = true;
    this.statusCode = code === VAULT_ERROR_CODES.VAULT_INVALID ? 400 : 403;
  }
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

function timingSafeDigestEqual(aBuf, bBuf) {
  if (!Buffer.isBuffer(aBuf) || !Buffer.isBuffer(bBuf) || aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizeVaultKind(rawType, category) {
  const upper = String(rawType || 'CUSTOM').toUpperCase();
  if (category === 'secret') return upper;
  if (upper === 'NAME_LIKELY' || upper === 'PERSON') return 'PERSON';
  if (upper === 'ADDRESS_LIKELY' || upper === 'STREET_ADDRESS') return 'ADDRESS';
  if (upper === 'PHONE_NUMBER') return 'PHONE';
  if (upper === 'DATE_OF_BIRTH') return 'DOB';
  return upper;
}

function formatPlaceholderToken(kind, category, seq) {
  const seqStr = String(seq).padStart(2, '0');
  if (category === 'secret') {
    const secretKind = kind.startsWith('SECRET_') ? kind.slice(7) : kind;
    return `<SECRET:${secretKind}_${seqStr}>`;
  }
  return `<PII:${kind}_${seqStr}>`;
}

/**
 * Create a workspace-bound pseudonym vault.
 *
 * By default (`reversible: false`), operates in one-way irreversible mode and retains
 * zero plaintext mappings. Pass `{ reversible: true, workspaceSalt }` to opt into
 * authorized local round-trip restoration.
 */
export function createReversibleVault(options = {}) {
  const workspaceSalt =
    typeof options.workspaceSalt === 'string' && options.workspaceSalt.length > 0
      ? options.workspaceSalt
      : crypto.randomBytes(24).toString('hex');

  const explicitIrreversible = options.irreversible === true || options.oneWay === true;
  const isReversible = options.reversible === true && !explicitIrreversible;
  const saltDigest = sha256Buffer(workspaceSalt);
  const nonce = crypto.randomBytes(8).toString('hex');
  const vaultId =
    typeof options.vaultId === 'string' && options.vaultId.trim().length > 0
      ? options.vaultId.trim()
      : `vault:${crypto.createHmac('sha256', workspaceSalt).update(nonce).digest('hex').slice(0, 16)}`;

  const saltedVault = new SaltedPseudonymVault(workspaceSalt);

  const state = {
    vaultId,
    workspaceSaltDigest: saltDigest,
    reversible: isReversible,
    irreversible: !isReversible,
    oneWay: !isReversible,
    saltedVault,
    // Strictly null when irreversible so zero plaintext can ever be retained
    reverseByToken: isReversible ? new Map() : null,
    forwardBySurfaceKey: isReversible ? new Map() : null,
    kindCounters: new Map(),
  };

  const vault = {
    vaultId,
    get reversible() {
      return state.reversible;
    },
    get irreversible() {
      return state.irreversible;
    },
    get oneWay() {
      return state.oneWay;
    },
    /**
     * Permanently lock this vault into one-way irreversible mode and wipe all
     * in-memory reverse plaintext mappings.
     */
    markIrreversible() {
      state.reversible = false;
      state.irreversible = true;
      state.oneWay = true;
      if (state.reverseByToken) {
        state.reverseByToken.clear();
        state.reverseByToken = null;
      }
      if (state.forwardBySurfaceKey) {
        state.forwardBySurfaceKey.clear();
        state.forwardBySurfaceKey = null;
      }
      return vault;
    },
    exportMetadata() {
      return {
        vaultId: state.vaultId,
        reversible: state.reversible,
        irreversible: state.irreversible,
        oneWay: state.oneWay,
        entityCount: state.saltedVault.byEntityId.size,
        entities: state.saltedVault.exportRedactedEntities(),
      };
    },
    toJSON() {
      return {
        vaultId: state.vaultId,
        reversible: state.reversible,
        irreversible: state.irreversible,
        oneWay: state.oneWay,
        entityCount: state.saltedVault.byEntityId.size,
      };
    },
  };

  VAULT_PRIVATE_STATE.set(vault, state);
  return vault;
}

/**
 * Redact text using a workspace-bound vault.
 *
 * When the vault is opted into `reversible: true` (and neither vault nor call options
 * specify `irreversible: true` / `oneWay: true`), records exact surface-form reverse
 * mappings in the vault's private WeakMap to guarantee 100% lossless round-trip restoration.
 * Otherwise operates in one-way irreversible mode and retains zero plaintext.
 */
export function redactWithVault(text, vaultOrOptions, options = {}) {
  const raw = String(text ?? '');
  let vault = null;
  let opts = options;

  if (vaultOrOptions && VAULT_PRIVATE_STATE.has(vaultOrOptions)) {
    vault = vaultOrOptions;
  } else {
    opts = { ...(vaultOrOptions || {}), ...(options || {}) };
    vault = createReversibleVault({
      workspaceSalt: opts.workspaceSalt,
      reversible: opts.reversible === true,
      irreversible: opts.irreversible === true,
      oneWay: opts.oneWay === true,
      vaultId: opts.vaultId,
    });
  }

  const state = VAULT_PRIVATE_STATE.get(vault);
  if (!state) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_INVALID,
      'Invalid vault instance supplied to redactWithVault'
    );
  }

  const forceIrreversibleExport = opts.irreversible === true || opts.oneWay === true;
  const allowReverseRecord =
    state.reversible === true &&
    !state.irreversible &&
    !state.oneWay &&
    !forceIrreversibleExport;

  const scan = scanEnterprisePiiAndSecrets(raw, {
    includeHipaa: opts.includeHipaa !== false && opts.hipaaPack !== false,
    ...opts,
  });

  const compiledAllow = compileTermList(opts.whitelist);
  const compiledDeny = compileTermList(opts.blacklist);
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

  let maskedText = '';
  let cursor = 0;
  const entities = [];

  for (const sp of spans) {
    if (sp.start < cursor) continue;
    maskedText += raw.slice(cursor, sp.start);

    const exactRawValue = raw.slice(sp.start, sp.end);
    const vaultKind = normalizeVaultKind(sp.type, sp.category);
    const saltedKind = sp.category === 'secret' ? `SECRET_${vaultKind}` : vaultKind;
    const rec = state.saltedVault.pseudonymize(exactRawValue, saltedKind);
    const entityId = rec.entity_id;

    let token;
    if (allowReverseRecord) {
      const surfaceKey = `${sp.category}:${vaultKind}:${exactRawValue}`;
      const existing = state.forwardBySurfaceKey.get(surfaceKey);
      if (existing) {
        token = existing.token;
      } else {
        const counterKey = `${sp.category}:${vaultKind}`;
        let seq = (state.kindCounters.get(counterKey) || 0) + 1;
        token = formatPlaceholderToken(vaultKind, sp.category, seq);
        // Ensure placeholder does not collide with an existing token or literal text in input
        while (state.reverseByToken.has(token) || raw.includes(token)) {
          seq += 1;
          token = formatPlaceholderToken(vaultKind, sp.category, seq);
        }
        state.kindCounters.set(counterKey, seq);
        state.forwardBySurfaceKey.set(surfaceKey, { token, entityId });
        state.reverseByToken.set(token, exactRawValue);
      }
    } else {
      token =
        sp.category === 'secret'
          ? rec.display_token.startsWith('<SECRET:')
            ? rec.display_token
            : rec.display_token.replace(/^<PII:SECRET_/, '<SECRET:')
          : rec.display_token;
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
    vaultId: state.vaultId,
    reversible: allowReverseRecord,
    irreversible: !allowReverseRecord,
    oneWay: !allowReverseRecord,
    mode: allowReverseRecord ? 'reversible' : 'irreversible',
  };
}

/**
 * Restore deterministic placeholders back to their exact original values.
 *
 * Fails closed loudly (`VaultRestoreError`, returning zero plaintext) whenever:
 * - The vault is invalid or unrecognized,
 * - The vault, payload, or call options is marked `irreversible: true` / `oneWay: true`,
 * - The vault was not created with explicit `reversible: true`,
 * - `options.authorized !== true`,
 * - `options.workspaceSalt` is missing or does not match the vault's bound salt,
 * - `options.vaultId` (if supplied) or payload `vaultId` does not match `vault.vaultId`.
 */
export function restoreFromVault(redactedInput, vault, options = {}) {
  const state = vault && VAULT_PRIVATE_STATE.get(vault);
  if (!state) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_INVALID,
      'Fail-closed: unrecognized or invalid vault reference'
    );
  }

  let redactedText;
  let payloadVaultId = null;
  let payloadIrreversible = false;

  if (typeof redactedInput === 'string') {
    redactedText = redactedInput;
  } else if (redactedInput && typeof redactedInput === 'object' && typeof redactedInput.maskedText === 'string') {
    redactedText = redactedInput.maskedText;
    payloadVaultId = redactedInput.vaultId || null;
    payloadIrreversible =
      redactedInput.irreversible === true ||
      redactedInput.oneWay === true ||
      redactedInput.mode === 'irreversible';
  } else {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_INVALID,
      'Fail-closed: redactedText must be a string or redaction result object'
    );
  }

  // 1. Hard block if irreversible / oneWay export mode is set anywhere
  if (
    payloadIrreversible ||
    options?.irreversible === true ||
    options?.oneWay === true ||
    state.irreversible === true ||
    state.oneWay === true
  ) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_IRREVERSIBLE_MODE,
      'Fail-closed: restoration is forbidden in irreversible one-way vault mode'
    );
  }

  // 2. Hard block unless vault was explicitly opted into reversible mode
  if (state.reversible !== true || !state.reverseByToken) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_RESTORE_DISABLED,
      'Fail-closed: vault restoration is disabled by default; opt in with reversible: true'
    );
  }

  // 3. Hard block unless explicit authorization flag is passed
  if (options?.authorized !== true) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_UNAUTHORIZED,
      'Fail-closed: explicit authorized: true flag is required for vault restoration'
    );
  }

  // 4. Hard block unless workspaceSalt and vaultId bindings match
  if (typeof options.workspaceSalt !== 'string' || options.workspaceSalt.length === 0) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_BINDING_MISMATCH,
      'Fail-closed: matching workspaceSalt is required for vault restoration'
    );
  }
  const suppliedDigest = sha256Buffer(options.workspaceSalt);
  if (!timingSafeDigestEqual(suppliedDigest, state.workspaceSaltDigest)) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_BINDING_MISMATCH,
      'Fail-closed: workspaceSalt does not match bound vault'
    );
  }
  if (options.vaultId !== undefined && options.vaultId !== state.vaultId) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_BINDING_MISMATCH,
      'Fail-closed: vaultId does not match bound vault'
    );
  }
  if (payloadVaultId !== null && payloadVaultId !== state.vaultId) {
    throw new VaultRestoreError(
      VAULT_ERROR_CODES.VAULT_BINDING_MISMATCH,
      'Fail-closed: redacted payload vaultId does not match bound vault'
    );
  }

  // Single-pass token substitution prevents cascading double-replacement
  let restoredCount = 0;
  const unmappedTokens = [];
  const restoredText = redactedText.replace(PLACEHOLDER_TOKEN_RX, (tok) => {
    if (state.reverseByToken.has(tok)) {
      restoredCount += 1;
      return state.reverseByToken.get(tok);
    }
    unmappedTokens.push(tok);
    return tok;
  });

  return {
    restoredText,
    restoredCount,
    unmappedTokens,
    vaultId: state.vaultId,
  };
}
