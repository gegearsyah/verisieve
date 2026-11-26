import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateNpiNumber,
  validateDeaNumber,
  validateMbiNumber,
  validateCliaNumber,
  validateMrnNumber,
  validateHipaaDate,
  scanHipaaIdentifiers,
  scanEnterprisePiiAndSecrets,
  redactEnterpriseText,
} from '../src/secret-scanner.js';
import {
  createReversibleVault,
  redactWithVault,
  restoreFromVault,
  VaultRestoreError,
  VAULT_ERROR_CODES,
} from '../src/vault-restore.js';
import { SaltedPseudonymVault } from '../src/graph-wasm.js';
import {
  handleJsonRpcRequest,
  handleJsonRpcRequestAsync,
  failClosedMcpHandler,
  sanitizeMcpError,
} from '../src/mcp-server.js';

// ---------------------------------------------------------------------------
// Deterministic Seeded PRNG & Valid HIPAA/PII Generator Helpers
// ---------------------------------------------------------------------------
function createMulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, maxInclusive) {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function generateValidNpi(rng) {
  const first = pick(rng, ['1', '2']);
  let body = first;
  for (let i = 0; i < 8; i++) body += String(randInt(rng, 0, 9));
  // Compute Luhn check digit over '80840' + body + checkDigit
  const prefixed = `80840${body}`;
  let sum = 0;
  let shouldDouble = true; // rightmost digit of `prefixed` is immediately left of check digit
  for (let i = prefixed.length - 1; i >= 0; i--) {
    let d = prefixed.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
}

function generateValidDea(rng) {
  const regTypes = ['A', 'B', 'F', 'G', 'M', 'P', 'R', 'X'];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const r1 = pick(rng, regTypes);
  const r2 = letters[randInt(rng, 0, 25)];
  const d = Array.from({ length: 6 }, () => randInt(rng, 0, 9));
  const d7 = ((d[0] + d[2] + d[4]) + 2 * (d[1] + d[3] + d[5])) % 10;
  return `${r1}${r2}${d.join('')}${d7}`;
}

function generateValidMbi(rng, hyphenated = true) {
  const alpha = 'ACDEFGHJKMNPQRTUVWXY';
  const alnum = '0123456789ACDEFGHJKMNPQRTUVWXY';
  const p1 = String(randInt(rng, 1, 9));
  const p2 = alpha[randInt(rng, 0, alpha.length - 1)];
  const p3 = alnum[randInt(rng, 0, alnum.length - 1)];
  const p4 = String(randInt(rng, 0, 9));
  const p5 = alpha[randInt(rng, 0, alpha.length - 1)];
  const p6 = alnum[randInt(rng, 0, alnum.length - 1)];
  const p7 = String(randInt(rng, 0, 9));
  const p8 = alpha[randInt(rng, 0, alpha.length - 1)];
  const p9 = alpha[randInt(rng, 0, alpha.length - 1)];
  const p10 = String(randInt(rng, 0, 9));
  const p11 = String(randInt(rng, 0, 9));
  const sep = hyphenated ? '-' : '';
  return `${p1}${p2}${p3}${p4}${sep}${p5}${p6}${p7}${sep}${p8}${p9}${p10}${p11}`;
}

function generateValidClia(rng) {
  const st = String(randInt(rng, 1, 67)).padStart(2, '0');
  let tail = '';
  for (let i = 0; i < 7; i++) tail += String(randInt(rng, 0, 9));
  return `${st}D${tail}`;
}

function generateValidMrn(rng) {
  const prefix = pick(rng, ['', 'HOSP-', 'CLIN-', 'PT-']);
  const digits = String(randInt(rng, 100000, 99999999));
  return `${prefix}${digits}`;
}

function generateValidDate(rng) {
  const year = randInt(rng, 1945, 2025);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  const style = randInt(rng, 0, 2);
  if (style === 0) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (style === 1) {
    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  }
  const monNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monNames[month - 1]} ${day}, ${year}`;
}

// ---------------------------------------------------------------------------
// 1. HIPAA Safe Harbor Checksum/Format Validators & Zero-FP Guarantees
// ---------------------------------------------------------------------------
test('HIPAA Safe Harbor validators: strict valid & invalid vectors for NPI, DEA, MBI, CLIA, MRN, and dates', () => {
  // NPI (10-digit Luhn with 80840 prefix)
  assert.equal(validateNpiNumber('1234567893'), true);
  assert.equal(validateNpiNumber('1245319599'), true);
  assert.equal(validateNpiNumber('2109876542'), true);
  assert.equal(validateNpiNumber('1234567894'), false, 'Invalid NPI Luhn check digit must fail');
  assert.equal(validateNpiNumber('2109876548'), false, 'Invalid NPI Luhn check digit must fail');
  assert.equal(validateNpiNumber('3234567891'), false, 'NPI must start with 1 or 2');
  assert.equal(validateNpiNumber('123456789'), false, '9-digit string must fail NPI');
  assert.equal(validateNpiNumber('12345678931'), false, '11-digit string must fail NPI');
  assert.equal(validateNpiNumber('123456789A'), false);

  // DEA (2 letters + 7 digits official checksum + registrant type)
  assert.equal(validateDeaNumber('AB1234563'), true);
  assert.equal(validateDeaNumber('BJ5841297'), true);
  assert.equal(validateDeaNumber('FM-4021983'), true);
  assert.equal(validateDeaNumber('MR9104821'), true);
  assert.equal(validateDeaNumber('AB1234564'), false, 'Wrong DEA check digit must fail');
  assert.equal(validateDeaNumber('ZZ1234563'), false, 'Invalid DEA registrant type Z must fail');
  assert.equal(validateDeaNumber('QB1234563'), false, 'Invalid DEA registrant type Q must fail');
  assert.equal(validateDeaNumber('A11234563'), false, 'Non-letter 2nd char must fail DEA');
  assert.equal(validateDeaNumber('AB123456'), false, 'Short DEA must fail');

  // MBI (11-char positional alphabet excluding S, L, O, I, B, Z)
  assert.equal(validateMbiNumber('1EG4-TE5-MK72'), true);
  assert.equal(validateMbiNumber('1EG4TE5MK72'), true);
  assert.equal(validateMbiNumber('9CA0 TE9 RT44'), true);
  assert.equal(validateMbiNumber('0EG4-TE5-MK72'), false, 'Leading 0 forbidden in MBI');
  assert.equal(validateMbiNumber('1SG4-TE5-MK72'), false, 'Letter S forbidden in MBI');
  assert.equal(validateMbiNumber('1EL4-TE5-MK72'), false, 'Letter L forbidden in MBI');
  assert.equal(validateMbiNumber('1EG4-OE5-MK72'), false, 'Letter O forbidden in MBI');
  assert.equal(validateMbiNumber('1EG4-TI5-MK72'), false, 'Letter I forbidden in MBI');
  assert.equal(validateMbiNumber('1EG4-TE5-BK72'), false, 'Letter B forbidden in MBI');
  assert.equal(validateMbiNumber('1EG4-TE5-MZ72'), false, 'Letter Z forbidden in MBI');
  assert.equal(validateMbiNumber('1EG4-TE5MK72'), false, 'Inconsistent MBI separator must fail');

  // CLIA (^\d{2}D\d{7}$)
  assert.equal(validateCliaNumber('12D3456789'), true);
  assert.equal(validateCliaNumber('45D0987654'), true);
  assert.equal(validateCliaNumber('12X3456789'), false, 'CLIA 3rd char must be D');
  assert.equal(validateCliaNumber('12d3456789'), false, 'CLIA requires uppercase D');
  assert.equal(validateCliaNumber('12D345678'), false, 'CLIA must be 10 chars');
  assert.equal(validateCliaNumber('12D34567890'), false, 'CLIA must be 10 chars');

  // MRN & HIPAA Dates
  assert.equal(validateMrnNumber('00192837'), true);
  assert.equal(validateMrnNumber('HOSP-884120'), true);
  assert.equal(validateMrnNumber('ABC'), false);
  assert.equal(validateMrnNumber('ABCDEFGH'), false, 'MRN requires >= 4 digits');
  assert.equal(validateHipaaDate('2024-02-29'), true, 'Leap day 2024 valid');
  assert.equal(validateHipaaDate('2023-02-29'), false, 'Non-leap Feb 29 invalid');
  assert.equal(validateHipaaDate('2025-02-30'), false);
  assert.equal(validateHipaaDate('Jan 14, 2025'), true);
  assert.equal(validateHipaaDate('14 January 2025'), true);
});

test('HIPAA Safe Harbor scanner detects full clinical record and maintains 0 FP on hashes, UUIDs, and ordinary numbers', () => {
  const clinicalChart = [
    'Attending Physician NPI: 1234567893 | DEA: AB1234563',
    'Medicare Beneficiary ID: 1EG4-TE5-MK72 | CLIA: 45D0987654',
    'Medical Record Number: HOSP-884120 | Patient ID: 415-555-0192',
    'Health Plan Beneficiary ID: HP-99281744 | Device Serial: UDI-77219034',
    'DOB: March 12, 1984 | Admission Date: 2025-01-14 | Discharge Date: Jan 19, 2025',
  ].join('\n');

  const hipaa = scanHipaaIdentifiers(clinicalChart);
  const foundTypes = new Set(hipaa.spans.map((s) => s.type));
  for (const expected of ['NPI', 'DEA', 'MBI', 'CLIA', 'MRN', 'HEALTH_PLAN_ID', 'DEVICE_ID', 'DATE_OF_BIRTH', 'HIPAA_DATE']) {
    assert.ok(foundTypes.has(expected), `Expected HIPAA type ${expected} (got ${[...foundTypes].join(',')})`);
  }

  // Unified scanner keeps HIPAA types (NPI & MRN do NOT get misclassified as PHONE)
  const unified = scanEnterprisePiiAndSecrets(clinicalChart);
  const npiSpan = unified.spans.find((s) => s.value === '1234567893');
  const mrnPhoneLikeSpan = unified.spans.find((s) => s.value === '415-555-0192');
  assert.equal(npiSpan?.type, 'NPI');
  assert.equal(mrnPhoneLikeSpan?.type, 'MRN');
  assert.ok(unified.hipaaCount >= 9);

  // Zero false positives on 60 random SHA-256 hashes, UUID v4s, and ordinary numbers
  const rng = createMulberry32(0xc0ffee42);
  const hexChars = '0123456789abcdef';
  const randHex = (len) => Array.from({ length: len }, () => hexChars[randInt(rng, 0, 15)]).join('');
  const safeLines = [];
  for (let i = 0; i < 60; i++) {
    const sha256 = randHex(64);
    const uuid = `${randHex(8)}-${randHex(4)}-4${randHex(3)}-a${randHex(3)}-${randHex(12)}`;
    const ordinaryNum = randInt(rng, 1000000000, 2999999999);
    const amount = `$${randInt(rng, 100, 99999)}.${String(randInt(rng, 0, 99)).padStart(2, '0')}`;
    safeLines.push(`Record ${i}: digest=${sha256} uuid=${uuid} count=${ordinaryNum} cost=${amount} version=12.4.8`);
  }
  const safeDoc = safeLines.join('\n');
  const hipaaFpScan = scanHipaaIdentifiers(safeDoc);
  assert.equal(
    hipaaFpScan.spans.length,
    0,
    `Expected 0 HIPAA false positives on hashes/UUIDs/ordinary numbers, got: ${JSON.stringify(hipaaFpScan.spans)}`
  );

  // Invalid checksum lookalikes embedded in text must NOT trigger DEA / NPI / MBI / CLIA
  const badChecksums = 'NPI: 1234567894 DEA: AB1234564 ZZ1234563 MBI: 1SG4-TE5-MK72 0EG4-TE5-MK72 CLIA: 12X3456789';
  const badScan = scanHipaaIdentifiers(badChecksums);
  assert.equal(badScan.spans.length, 0, `Invalid HIPAA checksums must not fire: ${JSON.stringify(badScan.spans)}`);
});

// ---------------------------------------------------------------------------
// 2. Opt-In Reversible Vault Boundary & Fail-Closed Guards
// ---------------------------------------------------------------------------
test('Opt-in vault restoration boundary: disabled by default, blocked in irreversible mode, requires authorization & matching salt', () => {
  const secretDoc = 'Provider NPI: 1234567893 DEA: AB1234563 Patient MRN: 00192837 Email: elena.vance@clinic.org';
  const salt = 'hipaa-workspace-salt-alpha';

  // 1. Default createReversibleVault() is one-way irreversible
  const defaultVault = createReversibleVault({ workspaceSalt: salt });
  assert.equal(defaultVault.reversible, false);
  assert.equal(defaultVault.irreversible, true);
  assert.equal(defaultVault.oneWay, true);
  const defaultRed = redactWithVault(secretDoc, defaultVault);
  assert.equal(defaultRed.irreversible, true);
  assert.doesNotMatch(defaultRed.maskedText, /1234567893|AB1234563|00192837|elena\.vance@clinic\.org/);
  assert.throws(
    () => restoreFromVault(defaultRed.maskedText, defaultVault, { authorized: true, workspaceSalt: salt }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_IRREVERSIBLE_MODE
  );

  // 2. SaltedPseudonymVault direct restore always fails closed
  const directSalted = new SaltedPseudonymVault(salt);
  assert.equal(directSalted.reversible, false);
  assert.equal(directSalted.irreversible, true);
  assert.throws(
    () => directSalted.restore(),
    (err) => err.code === 'VAULT_IRREVERSIBLE_MODE' && err.failClosed === true
  );

  // 3. Explicit irreversible / oneWay overrides reversible: true
  const forcedIrrev = createReversibleVault({ workspaceSalt: salt, reversible: true, irreversible: true });
  assert.equal(forcedIrrev.reversible, false);
  assert.equal(forcedIrrev.irreversible, true);
  const forcedOneWay = createReversibleVault({ workspaceSalt: salt, reversible: true, oneWay: true });
  assert.equal(forcedOneWay.reversible, false);
  assert.equal(forcedOneWay.oneWay, true);

  // 4. Opt-in reversible vault succeeds ONLY with authorized: true + matching workspaceSalt
  const revVault = createReversibleVault({ workspaceSalt: salt, reversible: true });
  assert.equal(revVault.reversible, true);
  assert.equal(revVault.irreversible, false);
  const revRed = redactWithVault(secretDoc, revVault);
  assert.equal(revRed.reversible, true);
  assert.doesNotMatch(revRed.maskedText, /1234567893|AB1234563|00192837|elena\.vance@clinic\.org/);

  // Vault JSON serialization & exportMetadata must NEVER leak plaintext or raw salt
  const serializedVault = JSON.stringify(revVault) + JSON.stringify(revVault.exportMetadata());
  for (const sensitive of ['1234567893', 'AB1234563', '00192837', 'elena.vance@clinic.org', salt]) {
    assert.ok(!serializedVault.includes(sensitive), `Vault serialization must not leak ${sensitive}`);
  }

  // Missing authorization -> VAULT_UNAUTHORIZED
  assert.throws(
    () => restoreFromVault(revRed.maskedText, revVault, { workspaceSalt: salt }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_UNAUTHORIZED
  );

  // Wrong workspaceSalt -> VAULT_BINDING_MISMATCH
  assert.throws(
    () => restoreFromVault(revRed.maskedText, revVault, { authorized: true, workspaceSalt: 'wrong-salt' }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_BINDING_MISMATCH
  );

  // Wrong vaultId -> VAULT_BINDING_MISMATCH
  assert.throws(
    () => restoreFromVault(revRed.maskedText, revVault, { authorized: true, workspaceSalt: salt, vaultId: 'vault:wrong' }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_BINDING_MISMATCH
  );

  // Irreversible export flag on call or payload -> VAULT_IRREVERSIBLE_MODE
  const irrevExport = redactWithVault(secretDoc, revVault, { irreversible: true });
  assert.equal(irrevExport.irreversible, true);
  assert.throws(
    () => restoreFromVault(irrevExport, revVault, { authorized: true, workspaceSalt: salt }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_IRREVERSIBLE_MODE
  );
  assert.throws(
    () => restoreFromVault(revRed.maskedText, revVault, { authorized: true, workspaceSalt: salt, oneWay: true }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_IRREVERSIBLE_MODE
  );

  // Valid authorized restore recovers exact original document
  const restored = restoreFromVault(revRed.maskedText, revVault, { authorized: true, workspaceSalt: salt });
  assert.equal(restored.restoredText, secretDoc);
  assert.ok(restored.restoredCount >= 4);

  // Locking vault irreversibly permanently wipes reverse mappings
  revVault.markIrreversible();
  assert.equal(revVault.reversible, false);
  assert.equal(revVault.irreversible, true);
  assert.throws(
    () => restoreFromVault(revRed.maskedText, revVault, { authorized: true, workspaceSalt: salt }),
    (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_IRREVERSIBLE_MODE
  );
});

// ---------------------------------------------------------------------------
// 3. Property-Based Randomized Round-Trip Suite (>= 120 Generated Payloads)
// ---------------------------------------------------------------------------
test('Property-based round-trip suite (120 generated mixed HIPAA/PII payloads): 100% lossless in opt-in reversible mode, fail-closed in irreversible mode', () => {
  const rng = createMulberry32(20261126);
  const firstNames = ['Elena', 'Marcus', 'Priya', 'Daniel', 'Nadia', 'Samuel', 'Hannah', 'Tariq'];
  const lastNames = ['Vance', 'Cole', 'Nair', 'Kowalski', 'Benali', 'Okafor', 'Sato', 'Moreno'];
  const domains = ['clinic.org', 'medcenter.example', 'healthnet.org', 'caregroup.net'];
  const TRIALS = 120;

  for (let i = 0; i < TRIALS; i++) {
    const npi = generateValidNpi(rng);
    const dea = generateValidDea(rng);
    const mbi = generateValidMbi(rng, i % 2 === 0);
    const clia = generateValidClia(rng);
    const mrn = generateValidMrn(rng);
    const dob = generateValidDate(rng);
    const admitDate = generateValidDate(rng);
    const planId = `HP-${randInt(rng, 1000000, 9999999)}`;
    const deviceId = `DEV-${randInt(rng, 100000, 999999)}`;
    const first = pick(rng, firstNames);
    const last = pick(rng, lastNames);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(rng, domains)}`;
    const ssn = `${randInt(rng, 100, 899)}-${randInt(rng, 10, 99)}-${randInt(rng, 1000, 9999)}`;

    const doc = [
      `Case #${i} clinical handoff for ${first} ${last} (${email}).`,
      `Identifiers: NPI: ${npi}, DEA: ${dea}, MBI: ${mbi}, CLIA: ${clia}, MRN: ${mrn}.`,
      `Coverage: Health Plan ID: ${planId}, Device Serial: ${deviceId}, SSN: ${ssn}.`,
      `Timeline: DOB: ${dob}, Admission Date: ${admitDate}.`,
      `Repeat check: confirm DEA ${dea} and MRN: ${mrn} match billing record.`,
    ].join('\n');

    const salt = `prop-salt-${i}`;

    // A) Opt-in reversible mode: exact round-trip restoreFromVault(redactWithVault(x)) === x
    const revVault = createReversibleVault({ workspaceSalt: salt, reversible: true });
    const revRed = redactWithVault(doc, revVault);
    for (const secretVal of [npi, dea, mbi, clia, mrn, planId, deviceId, email, ssn]) {
      assert.ok(
        !revRed.maskedText.includes(secretVal),
        `Trial ${i}: reversible redacted output leaked raw value ${secretVal}`
      );
    }
    const restored = restoreFromVault(revRed.maskedText, revVault, { authorized: true, workspaceSalt: salt });
    assert.equal(restored.restoredText, doc, `Trial ${i}: reversible round-trip mismatch`);

    // B) Default one-way irreversible mode: zero raw secrets AND restoration fails closed
    const irrevVault = createReversibleVault({ workspaceSalt: salt });
    const irrevRed = redactWithVault(doc, irrevVault);
    for (const secretVal of [npi, dea, mbi, clia, mrn, planId, deviceId, email, ssn]) {
      assert.ok(
        !irrevRed.maskedText.includes(secretVal),
        `Trial ${i}: irreversible redacted output leaked raw value ${secretVal}`
      );
    }
    assert.throws(
      () => restoreFromVault(irrevRed.maskedText, irrevVault, { authorized: true, workspaceSalt: salt }),
      (err) => err instanceof VaultRestoreError && err.code === VAULT_ERROR_CODES.VAULT_IRREVERSIBLE_MODE
    );
  }
});

// ---------------------------------------------------------------------------
// 4. MCP HIPAA Scanning, Opt-In Restore & Fail-Closed Fault Injection
// ---------------------------------------------------------------------------
test('MCP server preserves 18-tool catalog, scans HIPAA identifiers, and gates opt-in vault restoration', () => {
  // Exact 18-tool catalog compatibility preserved
  const listRes = handleJsonRpcRequest({ jsonrpc: '2.0', method: 'tools/list', id: 400 });
  assert.equal(listRes.result.tools.length, 18);

  const clinicalText =
    'NPI: 1234567893 | DEA: AB1234563 | MBI: 1EG4-TE5-MK72 | CLIA: 12D3456789 | MRN: 00192837 | Admission Date: 2025-03-14';
  const salt = 'mcp-hipaa-salt-v1';

  // Default mode is irreversible -> restore MUST fail closed
  const defaultRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 401,
    method: 'tools/call',
    params: {
      name: 'scan_enterprise_secrets',
      arguments: { text: clinicalText, workspaceSalt: salt, hipaaPack: true },
    },
  });
  assert.ok(!defaultRes.error, defaultRes.error?.message);
  const defaultData = JSON.parse(defaultRes.result.content[0].text);
  assert.equal(defaultData.reversible, false);
  assert.equal(defaultData.irreversible, true);
  assert.ok(defaultData.hipaaCount >= 6, `Expected >= 6 HIPAA spans, got ${defaultData.hipaaCount}`);
  assert.doesNotMatch(defaultData.maskedText, /1234567893|AB1234563|1EG4-TE5-MK72|12D3456789|00192837|2025-03-14/);

  const blockedRestore = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 402,
    method: 'tools/call',
    params: {
      name: 'restore_vault_text',
      arguments: {
        vaultId: defaultData.vaultId,
        redactedText: defaultData.maskedText,
        authorized: true,
        workspaceSalt: salt,
      },
    },
  });
  assert.ok(blockedRestore.error);
  assert.equal(blockedRestore.error.data.isError, true);
  assert.equal(blockedRestore.error.data.failClosed, true);
  assert.equal(blockedRestore.error.data.errorCode, 'VAULT_IRREVERSIBLE_MODE');
  assert.doesNotMatch(JSON.stringify(blockedRestore), /1234567893|AB1234563|1EG4-TE5-MK72|00192837/);

  // Explicit opt-in reversible mode -> authorized restore recovers exact clinical text
  const revRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 403,
    method: 'tools/call',
    params: {
      name: 'scan_enterprise_secrets',
      arguments: { text: clinicalText, workspaceSalt: salt, reversible: true, hipaaPack: true },
    },
  });
  const revData = JSON.parse(revRes.result.content[0].text);
  assert.equal(revData.reversible, true);
  assert.ok(revData.vaultId);

  // Unauthorized MCP restore fails closed with 0 plaintext
  const unauthRestore = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 404,
    method: 'tools/call',
    params: {
      name: 'scan_enterprise_secrets',
      arguments: {
        mode: 'restore',
        vaultId: revData.vaultId,
        redactedText: revData.maskedText,
        workspaceSalt: salt,
      },
    },
  });
  assert.equal(unauthRestore.error.data.errorCode, 'VAULT_UNAUTHORIZED');
  assert.doesNotMatch(JSON.stringify(unauthRestore), /1234567893|AB1234563|1EG4-TE5-MK72|00192837/);

  // Authorized restore via mode: 'restore' succeeds
  const okRestore1 = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 405,
    method: 'tools/call',
    params: {
      name: 'scan_enterprise_secrets',
      arguments: {
        mode: 'restore',
        vaultId: revData.vaultId,
        redactedText: revData.maskedText,
        authorized: true,
        workspaceSalt: salt,
      },
    },
  });
  assert.ok(!okRestore1.error, okRestore1.error?.message);
  assert.equal(JSON.parse(okRestore1.result.content[0].text).restoredText, clinicalText);

  // Authorized restore via restore_vault_text succeeds
  const okRestore2 = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 406,
    method: 'tools/call',
    params: {
      name: 'restore_vault_text',
      arguments: {
        vaultId: revData.vaultId,
        redactedText: revData.maskedText,
        authorized: true,
        workspaceSalt: salt,
      },
    },
  });
  assert.ok(!okRestore2.error, okRestore2.error?.message);
  assert.equal(JSON.parse(okRestore2.result.content[0].text).restoredText, clinicalText);
});

test('MCP fail-closed fault-injection suite: parser, WASM, detector, and async exceptions leak 0 bytes of canary PII', async () => {
  const canaries = [
    '987-65-4321',
    'AB1234563',
    '1EG4-TE5-MK72',
    'canary.patient@hospital.example',
    'CANARY_SECRET_TOKEN_XYZ998877',
    'HOSP-MRN-773311',
  ];
  const canaryBlob = `Patient SSN=${canaries[0]} DEA=${canaries[1]} MBI=${canaries[2]} Email=${canaries[3]} Secret=${canaries[4]} MRN=${canaries[5]}`;

  const assertZeroCanaryLeak = (res, expectedCode, label) => {
    assert.ok(res && res.error, `${label}: expected structured JSON-RPC error`);
    assert.equal(res.result, undefined, `${label}: fail-closed error must not include partial result`);
    assert.equal(res.error.data?.isError, true, `${label}: expected isError: true`);
    assert.equal(res.error.data?.failClosed, true, `${label}: expected failClosed: true`);
    assert.equal(res.error.data?.payloadSuppressed, true, `${label}: expected payloadSuppressed: true`);
    if (expectedCode) {
      assert.equal(res.error.data?.errorCode, expectedCode, `${label}: unexpected errorCode`);
    }
    const serialized = JSON.stringify(res);
    for (const canary of canaries) {
      assert.ok(
        !serialized.includes(canary),
        `${label}: LEAK DETECTED! Canary "${canary}" appeared in MCP error response: ${serialized}`
      );
    }
  };

  // 1. Injected Parser fault inside ingest_enterprise_bundle
  const parserErr = new Error(`Parser exploded while reading ${canaryBlob}`);
  parserErr.faultDomain = 'parser';
  const parserRes = handleJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 501,
      method: 'tools/call',
      params: {
        name: 'ingest_enterprise_bundle',
        arguments: { files: [{ source: 'chart.eml', text: canaryBlob }] },
      },
    },
    {
      overrides: {
        parseEnterpriseBuffer: () => {
          throw parserErr;
        },
      },
    }
  );
  assertZeroCanaryLeak(parserRes, 'PARSER_FAULT', 'parser fault');

  // 2. Injected WASM kernel fault inside audit_forensic_leaks
  const wasmRes = handleJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 502,
      method: 'tools/call',
      params: {
        name: 'audit_forensic_leaks',
        arguments: { source: 'scan.png', contentBase64: Buffer.from(canaryBlob).toString('base64') },
      },
    },
    {
      overrides: {
        scrubBinaryMediaMetadata: () => {
          throw new WebAssembly.RuntimeError(`versieve_media.wasm trap on ${canaryBlob}`);
        },
      },
    }
  );
  assertZeroCanaryLeak(wasmRes, 'WASM_FAULT', 'wasm fault');

  // 3. Injected Detector fault inside scan_enterprise_secrets
  const detErr = new Error(`Detector failed scanning ${canaryBlob}`);
  detErr.faultDomain = 'detector';
  const detRes = handleJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 503,
      method: 'tools/call',
      params: {
        name: 'scan_enterprise_secrets',
        arguments: { text: canaryBlob },
      },
    },
    {
      overrides: {
        scanEnterprisePiiAndSecrets: () => {
          throw detErr;
        },
      },
    }
  );
  assertZeroCanaryLeak(detRes, 'DETECTOR_FAULT', 'detector fault');

  // 4. Injected Detector fault inside gatekeeper_decide
  const gkDetRes = handleJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 504,
      method: 'tools/call',
      params: {
        name: 'gatekeeper_decide',
        arguments: { text: canaryBlob },
      },
    },
    {
      overrides: {
        scanRecordsForPII: () => {
          throw new Error(`scanRecordsForPII crash on ${canaryBlob}`);
        },
      },
    }
  );
  assertZeroCanaryLeak(gkDetRes, 'DETECTOR_FAULT', 'gatekeeper detector fault');

  // 5. Injected unexpected fault inside ingest_and_tokenize
  const ingestFaultRes = handleJsonRpcRequest(
    {
      jsonrpc: '2.0',
      id: 505,
      method: 'tools/call',
      params: {
        name: 'ingest_and_tokenize',
        arguments: { input: canaryBlob },
      },
    },
    {
      overrides: {
        runCleanAndTokenizePipeline: () => {
          throw new Error(`Unexpected crash echoing ${canaryBlob}`);
        },
      },
    }
  );
  assertZeroCanaryLeak(ingestFaultRes, 'INTERNAL_FAIL_CLOSED', 'ingest_and_tokenize fault');

  // 6. Async audio redaction fault containing canary PII
  const audioFaultRes = await handleJsonRpcRequestAsync(
    {
      jsonrpc: '2.0',
      id: 506,
      method: 'tools/call',
      params: {
        name: 'redact_audio_call',
        arguments: { source: 'call.wav', wavBase64: Buffer.from(canaryBlob).toString('base64') },
      },
    },
    {
      overrides: {
        redactAudioCall: async () => {
          const e = new Error(`WASM_MEDIA_ERROR audio failure for ${canaryBlob}`);
          throw e;
        },
      },
    }
  );
  assertZeroCanaryLeak(audioFaultRes, 'WASM_FAULT', 'async audio wasm fault');

  // 7. Async URL ingestion fault containing canary PII
  const urlFaultRes = await handleJsonRpcRequestAsync(
    {
      jsonrpc: '2.0',
      id: 507,
      method: 'tools/call',
      params: {
        name: 'ingest_url_or_links',
        arguments: { url: 'https://example.org/clinical' },
      },
    },
    {
      overrides: {
        ingestUrl: async () => {
          throw new Error(`Parser failure on remote body: ${canaryBlob}`);
        },
      },
    }
  );
  assertZeroCanaryLeak(urlFaultRes, 'PARSER_FAULT', 'async url parser fault');

  // 8. Canary stuffed into unknown tool name & unknown method must not be echoed
  const unknownToolRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 508,
    method: 'tools/call',
    params: { name: `tool_${canaries[0]}_${canaries[4]}`, arguments: {} },
  });
  assertZeroCanaryLeak(unknownToolRes, 'UNKNOWN_TOOL', 'unknown tool canary echo guard');

  const unknownMethodRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 509,
    method: `method_${canaries[0]}_${canaries[3]}`,
  });
  assertZeroCanaryLeak(unknownMethodRes, 'METHOD_NOT_FOUND', 'unknown method canary echo guard');

  // 9. Direct failClosedMcpHandler sync & async wrapper verification
  const syncWrapped = failClosedMcpHandler(
    () => {
      throw new Error(`Sync detector exception leaking ${canaryBlob}`);
    },
    { toolName: 'scan_enterprise_secrets', stage: 'detector' }
  );
  const syncErrPayload = syncWrapped();
  assert.equal(syncErrPayload.isError, true);
  assert.equal(syncErrPayload.errorCode, 'DETECTOR_FAULT');
  for (const canary of canaries) {
    assert.ok(!JSON.stringify(syncErrPayload).includes(canary));
  }

  const asyncWrapped = failClosedMcpHandler(
    async () => {
      throw new Error(`Async parser exception leaking ${canaryBlob}`);
    },
    { toolName: 'ingest_enterprise_bundle', stage: 'parser' }
  );
  const asyncErrPayload = await asyncWrapped();
  assert.equal(asyncErrPayload.isError, true);
  assert.equal(asyncErrPayload.errorCode, 'PARSER_FAULT');
  for (const canary of canaries) {
    assert.ok(!JSON.stringify(asyncErrPayload).includes(canary));
  }

  // Direct sanitizeMcpError never leaks raw message
  const sanitized = sanitizeMcpError(new Error(`Leak ${canaryBlob}`), { toolName: 'scan_enterprise_secrets' });
  assert.equal(sanitized.isError, true);
  assert.equal(sanitized.failClosed, true);
  for (const canary of canaries) {
    assert.ok(!JSON.stringify(sanitized).includes(canary));
  }
});
