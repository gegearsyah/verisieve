import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';

import {
  buildAmnesiacCorpus,
  eraseEntity,
  AMNESIAC_ENGINE_VERSION,
  AMNESIAC_ENGINE_VERSION_SHA256,
} from '../src/amnesiac-corpus.js';

// Spec: gegearsyah/versieve#25 — external-behavior-only tests at the new seam (bytes in → bytes out).
const INPUTS = [
  {
    name: 'contracts/msa.txt',
    text: 'Vendor agreement between Acme GmbH and Ravi Chandra.\nInvoice queries go to ravi.chandra@corp.example.\nPayment terms are net 30 days from receipt.',
  },
  {
    name: 'notes/audit.txt',
    text: 'Audit sign-off pending from Ravi Chandra.\nThe reminder went to ravi.chandra@corp.example on Monday.',
  },
  {
    name: 'ops/runbook.txt',
    text: 'Console deployment uses ghp_0123456789abcdefghijklmnopqrstuvwxyzAB and rotates it after the migration.',
  },
  {
    name: 'ops/handbook.txt',
    text: 'The handbook lists the staging endpoint, the backup cadence, and the review rota.',
  },
];

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function linesOf(jsonl) {
  return String(jsonl).split('\n').filter(Boolean);
}

test('Amnesiac 1: determinism — two builds with identical inputs produce byte-identical corpora with version-pinned SHA-256 receipts', async () => {
  const a = await buildAmnesiacCorpus(INPUTS);
  const b = await buildAmnesiacCorpus(INPUTS);

  assert.equal(typeof a.jsonl, 'string');
  assert.ok(a.samples.length >= 3, `corpus must contain samples, got ${a.samples.length}`);
  assert.equal(a.jsonl, b.jsonl, 'two runs with identical inputs and engine version must yield byte-identical corpus JSONL');
  assert.deepEqual(a.receipt, b.receipt, 'receipts must be byte-identical across identical runs');
  assert.equal(JSON.stringify(a.certificates), JSON.stringify(b.certificates), 'certificates must be deterministic across identical runs');

  // each sample records its source byte-ranges and entity IDs
  for (const s of a.samples) {
    assert.ok(typeof s.id === 'string' && /^[0-9a-f]{64}$/.test(s.id), 'sample id must be a SHA-256 content digest');
    assert.ok(Array.isArray(s.sourceRange) && s.sourceRange.length === 2 && s.sourceRange[0] < s.sourceRange[1], `sample ${s.id} must record its source byte-range`);
    assert.ok(Array.isArray(s.entities), `sample ${s.id} must record its entity IDs`);
  }

  // vaulted-regression pin: the default (no `identity` in view) corpus SHA must stay byte-identical to the committed artifact era
  assert.equal(a.receipt.corpusSha256, '6c857e0a0ea10daff6b2c6a9d2bb921a858edebabd3c29c621d8cb4c324411cd');

  // receipts pin the engine version hash
  assert.equal(a.receipt.engine, AMNESIAC_ENGINE_VERSION);
  assert.equal(a.receipt.engineVersionSha256, AMNESIAC_ENGINE_VERSION_SHA256);
  assert.equal(a.receipt.corpusSha256, sha256Hex(a.jsonl), 'corpus receipt must pin the SHA-256 of the exact emitted bytes');

  // entity index is content-addressed: entity IDs are salted content digests
  assert.ok(a.entityIndex.length >= 2, 'corpus must index entities');
  for (const e of a.entityIndex) assert.match(e.entityId, /^ent:[a-z_]+:[0-9a-f]{16}$/, 'entity IDs must be salted content digests (vault HMAC)');

  // view: deterministic projection of the same brain
  const projected = await buildAmnesiacCorpus(INPUTS, { sources: ['contracts/'] });
  assert.ok(projected.samples.every((s) => String(s.source).startsWith('contracts/')), 'view must project the corpus by its declarative filter');
  assert.notEqual(projected.receipt.corpusSha256, a.receipt.corpusSha256, 'a different view must produce a different corpus receipt');
  const projectedAgain = await buildAmnesiacCorpus(INPUTS, { sources: ['contracts/'] });
  assert.equal(projected.jsonl, projectedAgain.jsonl, 'view projection must be deterministic as well');
});

test('Amnesiac 2: erasure — byte-diff vs the original is exactly the erased entity spans; every other sample verifies byte-identical', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);
  const email = corpus.entityIndex.find((e) => e.class === 'EMAIL');
  assert.ok(email, 'corpus must index an EMAIL entity from the injected PII');
  assert.ok(email.sampleIds.length >= 2, `EMAIL entity must span multiple samples, got ${email.sampleIds.length}`);

  const before = corpus.jsonl;
  const after = eraseEntity(corpus, email.entityId);

  const beforeLines = linesOf(before);
  const afterLines = linesOf(after.jsonl);
  assert.equal(afterLines.length, beforeLines.length, 'erasure must not add or drop samples, only regenerate the erased entity samples');

  const changedIds = new Set(after.diffReceipt.changedSampleIds);
  assert.equal(after.diffReceipt.unchangedSampleCount, beforeLines.length - changedIds.size);

  for (let i = 0; i < beforeLines.length; i++) {
    const oldSample = corpus.samples[i];
    const newSample = after.samples[i];
    if (!changedIds.has(oldSample.id)) {
      assert.equal(afterLines[i], beforeLines[i], `unchanged sample ${oldSample.id} must remain byte-identical after erasure`);
      continue;
    }
    // the regenerated sample differs from the original by EXACTLY the erased entity: the token occurrences removed and the entity id entry dropped — nothing else
    const occurrences = oldSample.content.split(email.token).length - 1;
    assert.ok(occurrences >= 1, `changed sample ${oldSample.id} must contain the erased entity token`);
    const expectedContent = oldSample.content.split(email.token).join('');
    assert.equal(newSample.content, expectedContent, 'content diff must remove exactly the erased entity token spans');
    assert.deepEqual(newSample.entities, oldSample.entities.filter((e) => e !== email.entityId), 'entity list diff must drop exactly the erased entity id');
    assert.equal(newSample.id, oldSample.id, 'sample identity must survive erasure (content-digest id, stable ordering)');
    assert.deepEqual(newSample.sourceRange, oldSample.sourceRange, 'source byte-ranges must survive erasure unchanged');
    assert.ok(!newSample.content.includes(email.token), 'the erased entity token must be gone from the regenerated sample');
  }
  assert.equal(changedIds.size, email.sampleIds.length, 'erasure must regenerate exactly the samples referencing the erased entity');

  // diff receipt is itself SHA-256 pinned and asserts the byte-diff equals the erased entity spans
  assert.equal(after.diffReceipt.corpusSha256Before, sha256Hex(before));
  assert.equal(after.diffReceipt.corpusSha256After, sha256Hex(after.jsonl));
  assert.equal(after.diffReceipt.removedSpanBytes, email.sampleIds.reduce(
    (n, sid) => n + (corpus.samples.find((s) => s.id === sid).content.split(email.token).length - 1), 0
  ) * email.token.length);
  assert.equal(after.diffReceipt.diffVerified, true);
  assert.equal(after.diffReceipt.engineVersionSha256, AMNESIAC_ENGINE_VERSION_SHA256);

  // regenerating twice under an erasure must also be deterministic
  const after2 = eraseEntity(corpus, email.entityId);
  assert.equal(after2.jsonl, after.jsonl, 'erasure must be deterministic');
  // and the original state must be preserved (no mutation)
  assert.equal(corpus.jsonl, before, 'eraseEntity must not mutate the original corpus state');
});

test('Amnesiac 3: certificates — injected PII pass rate vs stated confidence; secrets quarantine; honest claim vocabulary', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);
  const cert = corpus.certificates;

  assert.equal(cert.statedConfidence, 0.95, 'certificate must state its confidence level');
  assert.ok(cert.calibrationMethod.includes('binomial'), 'calibration method must be disclosed');

  // injected PII at known rates: every injected entity instance is detected and masked, none leak
  assert.ok(cert.classes.PERSON.detectedCount >= 2, `PERSON detections must cover the injected names, got ${JSON.stringify(cert.classes.PERSON)}`);
  assert.ok(cert.classes.EMAIL.detectedCount >= 2, `EMAIL detections must cover the injected addresses, got ${JSON.stringify(cert.classes.EMAIL)}`);
  assert.equal(cert.classes.PERSON.missedCount, 0, 'injected PERSON PII must not leak past the gate');
  assert.equal(cert.classes.EMAIL.missedCount, 0, 'injected EMAIL PII must not leak past the gate');
  assert.ok(cert.classes.PERSON.certifiedRecallLowerBound <= 1, 'per-class recall bound must be a valid probability');
  assert.ok(cert.classes.PERSON.certifiedRecallLowerBound <= 1 && cert.classes.PERSON.certifiedRecallLowerBound > 0, 'per-class certified recall bound must be stated');

  // pass/fail behavior: PII samples pass certified, the injected secret sample quarantines
  assert.equal(cert.quarantinedSampleIds.length, 1, 'the sample whose injected secret trips the gate must be quarantined');
  const quarantined = corpus.samples.find((s) => s.gate === 'QUARANTINE_SECRET');
  assert.ok(quarantined, 'quarantined sample must carry its gate in the corpus state');
  assert.ok(!corpus.jsonl.includes('ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'), 'the raw injected secret must never appear in the corpus bytes');
  const expectedPassRate = (corpus.samples.length - cert.quarantinedSampleIds.length) / corpus.samples.length;
  assert.equal(cert.passRate, Number(expectedPassRate.toFixed(6)), 'pass rate must equal the stated gate behavior');
  assert.ok(cert.certifiedPassRateLowerBound <= cert.passRate, 'certified bound cannot exceed the observed pass rate');
  assert.ok(cert.certifiedPassRateLowerBound > 0 && cert.certifiedPassRateLowerBound < 1, 'the pass-rate bound must be non-vacuous at the stated confidence');

  // honest framing rules: the certificate vocabulary never makes forbidden claims
  const certJson = JSON.stringify(cert).toLowerCase();
  assert.ok(!certJson.includes('differential privacy'), 'certificate must never claim differential privacy');
  assert.ok(!certJson.includes('provable anonymity'), 'certificate must never claim provable anonymity');
});

test('Amnesiac 4: zero egress — corpus build and erasure complete with all network entry points armed to throw', async () => {
  // structural zero-network assertion: every reachable network entry point throws if the corpus path touches it
  const armed = [];
  const stubs = new Map();
  const trap = (owner, name) => {
    const original = owner[name];
    if (typeof original !== 'function') return;
    stubs.set(owner, { name, original });
    try {
      owner[name] = () => { throw new Error(`zero-egress violation: ${name} called in the corpus path`); };
      armed.push(name);
    } catch { /* non-writable export — skip and count only writable traps */ }
  };
  trap(http, 'request'); trap(http, 'get');
  trap(https, 'request'); trap(https, 'get');
  trap(net, 'connect'); trap(net, 'createConnection');
  trap(tls, 'connect');
  trap(dns, 'lookup'); trap(dns, 'resolve'); trap(dns, 'resolve4'); trap(dns, 'resolve6');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('zero-egress violation: fetch called in the corpus path'); };
  armed.push('fetch');

  // static structural check of the corpus module: no network modules in the new seam
  const corpusSource = fs.readFileSync(new URL('../src/amnesiac-corpus.js', import.meta.url), 'utf8');
  assert.doesNotMatch(corpusSource, /node:(http|https|net|tls|dns)\b/, 'the corpus module must not import network modules at all');
  assert.doesNotMatch(corpusSource, /\b(XMLHttpRequest|WebSocket|undici)\b/, 'the corpus module must not reference browser/undici network APIs');

  try {
    assert.ok(armed.length >= 5, `zero-egress traps must actually be armed, got ${armed.length}`);
    const corpus = await buildAmnesiacCorpus(INPUTS);
    const email = corpus.entityIndex.find((e) => e.class === 'EMAIL');
    const erased = eraseEntity(corpus, email.entityId);
    assert.ok(erased.jsonl.length > 0 && erased.diffReceipt.diffVerified === true, 'full corpus lifecycle must complete with zero egress');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [owner, rec] of stubs) { try { owner[rec.name] = rec.original; } catch {} }
  }
});

test('Amnesiac 5: version invalidation — drifted engine version fails loudly instead of silently regenerating bytes', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);
  const email = corpus.entityIndex.find((e) => e.class === 'EMAIL');

  const drifted = structuredClone(corpus);
  drifted.receipt.engineVersionSha256 = 'f'.repeat(64);
  assert.throws(() => eraseEntity(drifted, email.entityId), /version/, 'a version-drifted corpus must be invalidated loudly');

  assert.throws(
    () => eraseEntity(corpus, 'ent:person:doesnotexist00'),
    /unknown entityId/,
    'erasing an entity the corpus does not index must fail loudly (story 15)'
  );

  await assert.rejects(() => buildAmnesiacCorpus('not-a-valid-input'), /buildAmnesiacCorpus/, 'invalid input shape must fail loudly at the seam');
});

test('Amnesiac 6: repeated derived-format blocks disambiguate instead of aborting; erasure receipts state the regenerated entity count', async () => {
  // Derived-format blocks (eml/pptx/vtt parses) carry no byte range, so benign repeated
  // content — a quoted line, two same-titled slides — collides on the content-digest id.
  // The corpus must keep them as two distinct samples (red under the old throw-on-collision).
  const repeatedBlock = {
    source: 'deck/slides.xml',
    originalText: 'Q4 review presented by Priya Sharma.',
    maskedText: 'Q4 review presented by <PII:PERSON_1>.',
    structRole: 'PROSE',
    gateAction: 'KEEP_SAFE_REDACTED',
    coupledRiskScore: 0.1,
    entities: [{ entityId: 'ent:person:repeat01', type: 'PERSON', token: '<PII:PERSON_1>' }],
  };
  const state = await buildAmnesiacCorpus({ blocks: [structuredClone(repeatedBlock), structuredClone(repeatedBlock)] });
  assert.equal(state.samples.length, 2, 'two identical derived-format blocks stay two samples');
  assert.equal(new Set(state.samples.map((s) => s.id)).size, 2, 'disambiguated ids remain unique and deterministic');
  assert.equal(state.receipt.entityCount, 1);

  const erased = eraseEntity(state, 'ent:person:repeat01');
  assert.equal(erased.receipt.entityCount, 0, 'the regenerated receipt must state the post-erasure entity count, not the pre-erasure one');
  assert.equal(erased.diffReceipt.diffVerified, true);
});

// Stage K0 — the mode seam: `identity: 'readable'` is the explicit opt-in general mode
// (no vault ceremony; vaulted stays the default so committed receipts reproduce byte-identically).
const READABLE_VIEW = { identity: 'readable' };

const ALIAS_INPUTS = [
  // Intra-block titled-surname coreference: "Elena Vance" and "Ms. Vance" resolve to one entity
  // (the vault's canonicalAlias link), giving that entity two distinct raw surface forms.
  { name: 'reviews/lead.txt', text: 'Elena Vance led the quarterly review, and Ms. Vance approved the budget.' },
];

test('Amnesiac 7: readable identity — determinism, unmasked content, readable anchors, no vault ceremony, mode pins the view hash', async () => {
  const a = await buildAmnesiacCorpus(INPUTS, READABLE_VIEW);
  const b = await buildAmnesiacCorpus(INPUTS, READABLE_VIEW);

  assert.equal(a.jsonl, b.jsonl, 'two readable builds with identical inputs must be byte-identical');
  assert.deepEqual(a.receipt, b.receipt, 'readable receipts must be deterministic across identical runs');
  assert.equal(a.receipt.corpusSha256, sha256Hex(a.jsonl), 'the readable corpus receipt must pin the exact emitted bytes');
  assert.equal(a.receipt.identity, 'readable', 'the readable receipt must record its mode');

  // no privacy machinery in the product surface: zero placeholders, real names in the bytes
  assert.ok(!a.jsonl.includes('<PII:'), 'readable corpus must contain zero <PII:…> placeholders');
  assert.ok(!a.jsonl.includes('<SECRET:'), 'readable corpus must contain zero <SECRET:…> placeholders');
  assert.ok(a.jsonl.includes('Ravi Chandra'), 'readable corpus must contain the real entity names');
  // readable mode carries the user's own data unmasked; no protection claim
  assert.ok(a.jsonl.includes('ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'), 'readable mode does not mask or quarantine anything');

  // readable anchors are canonical resolved identities, not salted digests
  assert.ok(a.entityIndex.length >= 2, 'readable corpus must index entities');
  for (const e of a.entityIndex) {
    assert.doesNotMatch(e.entityId, /^ent:[a-z_]+:[0-9a-f]{16}$/, 'readable entity IDs must not be vault-salted digests');
    assert.ok(e.token && !e.token.startsWith('<'), `readable anchor token ${e.token} must be a plain canonical value`);
  }
  const person = a.entityIndex.find((e) => e.class === 'PERSON');
  assert.ok(person.entityId.includes('Ravi Chandra'), 'the PERSON readable anchor must embed the canonical name');

  // no certificate ceremony in the readable output
  assert.ok(!('certificates' in a), 'readable output must omit the certificate ceremony');
  assert.ok(!('trainingRecipe' in a), 'readable output must omit the placeholder-masking training recipe');

  // the mode is part of the view hash: same inputs, different mode → different corpus SHA
  const vaulted = await buildAmnesiacCorpus(INPUTS);
  assert.notEqual(a.receipt.corpusSha256, vaulted.receipt.corpusSha256, 'readable and vaulted views must produce different corpus receipts');
  assert.notEqual(a.receipt.viewDigest, vaulted.receipt.viewDigest, 'the mode must be part of the view digest');
});

test('Amnesiac 8: readable erasure — regeneration is mechanical and the byte-diff is exactly the erased entity spans', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS, READABLE_VIEW);
  const person = corpus.entityIndex.find((e) => e.class === 'PERSON');
  assert.ok(person, 'readable corpus must index the PERSON entity');
  assert.ok(person.sampleIds.length >= 2, 'the PERSON entity must span multiple samples');

  const before = corpus.jsonl;
  const after = eraseEntity(corpus, person.entityId);
  assert.equal(after.receipt.identity, 'readable', 'erasure must stay in the readable mode of its corpus');

  const beforeLines = linesOf(before);
  const afterLines = linesOf(after.jsonl);
  assert.equal(afterLines.length, beforeLines.length, 'readable erasure must not add or drop samples');

  const changedIds = new Set(after.diffReceipt.changedSampleIds);
  assert.equal(changedIds.size, person.sampleIds.length, 'erasure must regenerate exactly the samples referencing the erased entity');
  assert.equal(after.diffReceipt.unchangedSampleCount, beforeLines.length - changedIds.size);

  const id = person.entityId;
  let totalSpanBytes = 0;
  for (let i = 0; i < beforeLines.length; i++) {
    const oldSample = corpus.samples[i];
    const newSample = after.samples[i];
    assert.equal(newSample.id, oldSample.id, 'sample identity must survive readable erasure');
    if (!changedIds.has(oldSample.id)) {
      assert.equal(afterLines[i], beforeLines[i], `unchanged sample ${oldSample.id} must remain byte-identical after readable erasure`);
      continue;
    }
    const spans = oldSample.spans[id];
    assert.ok(spans.length >= 1, `changed sample ${oldSample.id} must record the erased entity spans`);
    const spanBytes = spans.reduce((n, [s, e]) => n + (e - s), 0);
    totalSpanBytes += spanBytes;
    // byte-diff arithmetic: exactly the spans removed plus the entity id entry dropped, nothing else
    const lineDelta = afterLines[i].length - beforeLines[i].length;
    const expected = -(spanBytes + (JSON.stringify(oldSample.entities).length - JSON.stringify(newSample.entities).length));
    assert.equal(lineDelta, expected, `changed sample ${oldSample.id} line diff must equal its erased spans plus the dropped entity id`);
    // the regenerated content is exactly the original minus those byte spans
    let expectedContent = oldSample.content;
    let cut = 0;
    for (const [s, e] of spans.slice().sort((x, y) => x[0] - y[0])) {
      expectedContent = expectedContent.slice(0, s - cut) + expectedContent.slice(e - cut);
      cut += e - s;
    }
    assert.equal(newSample.content, expectedContent, 'readable erasure must remove exactly the recorded entity spans');
    assert.deepEqual(newSample.entities, oldSample.entities.filter((e) => e !== id), 'entity list diff must drop exactly the erased entity');
    assert.equal(after.diffReceipt.diffVerified, true);
  }

  assert.equal(after.diffReceipt.removedSpanBytes, totalSpanBytes, 'diff receipt must state the exact removed span bytes');
  assert.equal(after.diffReceipt.removedSpanCount, after.diffReceipt.perSample.reduce((n, p) => n + p.removedSpans, 0));

  // spans are actually gone from the bytes
  assert.ok(!after.jsonl.includes('Ravi Chandra'), 'the erased canonical name must be gone from the regenerated bytes');

  const after2 = eraseEntity(corpus, person.entityId);
  assert.equal(after2.jsonl, after.jsonl, 'readable erasure must be deterministic');
  assert.equal(corpus.jsonl, before, 'eraseEntity must not mutate the original readable corpus state');
});

test('Amnesiac 9: readable canonical-anchor rule — one resolved entity with multiple surface forms gets one stable anchor across builds', async () => {
  const view = { identity: 'readable' };
  const a = await buildAmnesiacCorpus(ALIAS_INPUTS, view);
  const b = await buildAmnesiacCorpus(ALIAS_INPUTS, view);

  const person = a.entityIndex.find((e) => e.class === 'PERSON');
  assert.ok(person, 'the alias-estate readable corpus must index the PERSON entity');
  assert.equal(person.entityId, b.entityIndex.find((e) => e.class === 'PERSON').entityId, 'the same resolved entity must get the same readable anchor every build');
  assert.equal(person.token, b.entityIndex.find((e) => e.class === 'PERSON').token, 'the canonical token must be stable across builds');

  // canonical rule: the lexicographically smallest surface form resolving to the entity
  // ("Elena Vance" is the smallest of the "Elena Vance" full-name + "Ms. Vance" titled surfaces)
  assert.equal(person.token, 'Elena Vance', 'the canonical anchor must be the lexicographically smallest surface form');
  assert.ok(person.entityId.includes('Elena Vance'), 'the readable anchor must embed the canonical value');

  // both surfaces were spans of the same resolved entity
  const before = a.jsonl;
  const erased = eraseEntity(a, person.entityId);
  assert.ok(!erased.jsonl.includes('Elena Vance'), 'erasure must remove the full-name surface');
  assert.ok(!erased.jsonl.includes('Ms. Vance'), 'erasure must remove the titled-surname surface');
  assert.equal(a.jsonl, before, 'erasure must not mutate the original state');
});

// Stage K1 — relational sample composition: `composition: 'composed'` is an explicit opt-in
// view dimension (absent = 'per-block', byte-identical to today's corpus). Composition ships
// for readable identity first; the composed private mode is a later stage.
const COMPOSED_VIEW = { identity: 'readable', composition: 'composed' };

// Canonical composed order in the test's own words (source lexicographic, then byte offset;
// derived blocks with no range after ranged ones, then block id).
function sourcesInCanonicalOrder(sources) {
  const cmp = (a, b) => {
    if ((a.sourceRange == null) !== (b.sourceRange == null)) return a.sourceRange == null ? 1 : -1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    const ar = a.sourceRange || [0, 0];
    const br = b.sourceRange || [0, 0];
    if (ar[0] !== br[0]) return ar[0] - br[0];
    return ar[1] - br[1];
  };
  for (let i = 1; i < sources.length; i++) {
    if (cmp(sources[i - 1], sources[i]) > 0) return false;
  }
  return true;
}

function removeSpansDesc(content, spans) {
  let out = content;
  for (const [start, end] of spans.slice().sort((x, y) => y[0] - x[0])) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

test('Amnesiac 10: composed determinism — two builds byte-identical, versioned composition policy receipt, per-block default untouched', async () => {
  const a = await buildAmnesiacCorpus(INPUTS, COMPOSED_VIEW);
  const b = await buildAmnesiacCorpus(INPUTS, COMPOSED_VIEW);

  assert.equal(a.jsonl, b.jsonl, 'two composed builds with identical inputs must be byte-identical');
  assert.deepEqual(a.receipt, b.receipt, 'composed receipts must be deterministic across identical runs');
  assert.equal(a.receipt.corpusSha256, sha256Hex(a.jsonl), 'the composed receipt must pin the exact emitted bytes');
  assert.equal(a.receipt.compositionPolicy, 'composed-v1', 'the composed receipt must record its composition policy version');
  assert.equal(a.receipt.identity, 'readable', 'the composed receipt stays in its identity mode');
  assert.equal(a.receipt.engineVersionSha256, AMNESIAC_ENGINE_VERSION_SHA256);

  // the per-block default is untouched: no `composition` in the view → today's corpus, no new schema
  const perBlock = await buildAmnesiacCorpus(INPUTS, READABLE_VIEW);
  assert.ok(!('compositionPolicy' in perBlock.receipt), 'the per-block receipt must not grow a composition policy');
  const perBlockLine = JSON.parse(linesOf(perBlock.jsonl)[0]);
  assert.ok(!('target' in perBlockLine) && !('sources' in perBlockLine), 'per-block sample lines must stay byte-identical in schema');
  assert.notEqual(a.receipt.viewDigest, perBlock.receipt.viewDigest, 'the composition dimension must be part of the view digest');

  // composed mode is readable-only for now (composed private mode is a later stage)
  await assert.rejects(() => buildAmnesiacCorpus(INPUTS, { composition: 'composed' }), /readable/, 'composed vaulted mode must fail loudly');
  await assert.rejects(() => buildAmnesiacCorpus(INPUTS, { identity: 'readable', composition: 'chaos' }), /composition/, 'an unknown composition value must fail loudly');
});

test('Amnesiac 11: composed structure — one sample per entity, multi-file provenance in canonical order, labeled source tags with real names', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS, COMPOSED_VIEW);

  // one composed sample per resolved entity; every sample has exactly one target; index matches
  assert.equal(corpus.samples.length, corpus.entityIndex.length, 'the composed corpus must emit one sample per resolved entity');
  assert.equal(new Set(corpus.samples.map((s) => s.target)).size, corpus.samples.length, 'composed sample targets must be unique');
  const targetIds = new Set(corpus.samples.map((s) => s.target));
  for (const e of corpus.entityIndex) {
    assert.ok(targetIds.has(e.entityId), `entity ${e.entityId} must be the target of its composed sample`);
  }

  // emitted schema: target, sources, entities — and no internal bookkeeping leaks into the bytes
  const lines = linesOf(corpus.jsonl).map((l) => JSON.parse(l));
  for (const line of lines) {
    assert.ok(Array.isArray(line.sources), 'a composed sample line must carry a sources array');
    for (const src of line.sources) {
      assert.ok(typeof src.source === 'string', 'each provenance entry must name its source');
      assert.ok('sourceRange' in src, 'each provenance entry must record its sourceRange (null for derived formats)');
    }
    assert.ok(typeof line.target === 'string', 'a composed sample line must name its composed entity');
    assert.ok(!JSON.stringify(line).includes('truncatedBlocks'), 'internal bookkeeping must never be emitted into the JSONL');
  }

  // multi-department entity: its composed sample's provenance spans ≥2 files, in canonical order
  const person = corpus.entityIndex.find((e) => e.class === 'PERSON');
  assert.ok(person, 'the composed corpus must index the PERSON entity');
  const personLine = lines.find((l) => l.target === person.entityId);
  assert.ok(personLine, 'the PERSON entity must have its composed sample');
  assert.ok(personLine.sources.length >= 2, `the PERSON sample must cite evidence from multiple files, got ${JSON.stringify(personLine.sources)}`);
  assert.ok(sourcesInCanonicalOrder(personLine.sources), 'provenance entries must be in the canonical (source, offset) order');
  const sources = personLine.sources.map((s) => s.source);
  assert.ok(sources.includes('contracts/msa.txt') && sources.includes('notes/audit.txt'), 'the Ravi Chandra evidence must span both departments');

  // render: labeled source tags in canonical order, unmasked real names, entity-named user message
  const assistant = personLine.messages[2].content;
  assert.ok(assistant.includes('[notes/audit.txt]'), 'the render must carry labeled source tags');
  assert.ok(assistant.includes('[contracts/msa.txt]'), 'the render must carry labeled source tags');
  assert.ok(assistant.indexOf('[contracts/msa.txt]') < assistant.indexOf('[notes/audit.txt]'), 'tags must follow the canonical order (contracts/ sorts before notes/)');
  assert.ok(assistant.includes('Ravi Chandra'), 'readable composed content must contain the real names');
  assert.ok(!assistant.includes('<PII:') && !assistant.includes('<SECRET:'), 'readable composed content carries zero placeholders');
  assert.ok(personLine.messages[1].content.includes('Ravi Chandra'), 'the user message must name the composed entity');
  assert.ok(personLine.entities.includes(person.entityId), 'the entities field must include the target entity');
});

// Hub fixture: one entity mentioned in more blocks than the v1 cap (8) — deterministically truncated.
const HUB_INPUTS = Array.from({ length: 10 }, (_, i) => ({
  name: `reviews/log-${i}.txt`,
  text: `Sprint ${i} log: Ravi Chandra signed the follow-up note ${i}.`,
}));

test('Amnesiac 12: composed erasure — target retraction, exact co-mention span removal, hub-cap determinism', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS, COMPOSED_VIEW);
  const person = corpus.entityIndex.find((e) => e.class === 'PERSON');
  const before = corpus.jsonl;
  const beforeLines = new Map(linesOf(corpus.jsonl).map((l) => [JSON.parse(l).id, l]));

  const after = eraseEntity(corpus, person.entityId);
  assert.equal(after.receipt.identity, 'readable', 'composed erasure stays in its identity mode');

  // the target sample is retracted: sampleCount drops by exactly those samples
  const retractedIds = after.diffReceipt.retractedSampleIds;
  assert.equal(retractedIds.length, 1, 'exactly the erased entity target sample is retracted');
  const targetSample = corpus.samples.find((s) => s.target === person.entityId);
  assert.deepEqual(retractedIds, [targetSample.id], 'the retracted sample must be the erased entity target');
  assert.equal(after.receipt.sampleCount, corpus.receipt.sampleCount - 1, 'retraction must change the sample count');
  assert.equal(after.receipt.entityCount, corpus.receipt.entityCount - 1, 'erasure must drop the erased entity from the index');
  assert.ok(!after.jsonl.includes(targetSample.id), 'the retracted sample must be gone from the regenerated bytes');
  assert.ok(!after.jsonl.includes('Ravi Chandra'), 'the erased canonical name must be gone from the regenerated composed bytes');

  // every remaining line is either untouched or regenerated by exactly the erased entity spans
  const changedIds = new Set(after.diffReceipt.changedSampleIds);
  for (const line of linesOf(after.jsonl)) {
    const parsed = JSON.parse(line);
    if (!changedIds.has(parsed.id)) {
      assert.equal(line, beforeLines.get(parsed.id), `unchanged composed sample ${parsed.id} must remain byte-identical`);
      continue;
    }
    const oldSample = corpus.samples.find((s) => s.id === parsed.id);
    const oldLine = beforeLines.get(parsed.id);
    const spans = oldSample.spans[person.entityId];
    assert.ok(spans.length >= 1, `co-mention sample ${parsed.id} must record the erased entity spans`);
    const spanBytes = spans.reduce((n, [s, e]) => n + (e - s), 0);
    const expectedDelta = -(spanBytes + (JSON.stringify(oldSample.entities).length - JSON.stringify(parsed.entities).length));
    assert.equal(line.length - oldLine.length, expectedDelta, `co-mention sample ${parsed.id} must differ by exactly the erased entity spans`);
    assert.equal(JSON.parse(line).messages[2].content, removeSpansDesc(oldSample.content, spans), 'co-mention removal must cut exactly the erased spans from the render');
    assert.ok(!parsed.entities.includes(person.entityId), 'the erased entity must be dropped from the entities list');
  }
  assert.equal(after.diffReceipt.diffVerified, true);

  const after2 = eraseEntity(corpus, person.entityId);
  assert.equal(after2.jsonl, after.jsonl, 'composed erasure must be deterministic');
  assert.equal(corpus.jsonl, before, 'eraseEntity must not mutate the original composed state');

  // hub cap: an entity with more blocks than the v1 cap renders the same first-8 selection every build
  const hubA = await buildAmnesiacCorpus(HUB_INPUTS, COMPOSED_VIEW);
  const hubB = await buildAmnesiacCorpus(HUB_INPUTS, COMPOSED_VIEW);
  assert.equal(hubA.jsonl, hubB.jsonl, 'hub-cap selection must be deterministic across builds');
  const hubEntity = hubA.entityIndex.find((e) => e.class === 'PERSON');
  assert.ok(hubEntity, 'the hub estate must index the hub person');
  const hubSampleState = hubA.samples.find((s) => s.target === hubEntity.entityId);
  assert.equal(hubSampleState.sources.length, 8, 'the composed sample must render at most the v1 cap of 8 evidence blocks');
  assert.ok(hubSampleState.truncatedBlocks >= 1, 'internal bookkeeping must record the truncated blocks');
  assert.deepEqual(
    hubSampleState.sources.map((s) => s.source),
    ['reviews/log-0.txt', 'reviews/log-1.txt', 'reviews/log-2.txt', 'reviews/log-3.txt', 'reviews/log-4.txt', 'reviews/log-5.txt', 'reviews/log-6.txt', 'reviews/log-7.txt'],
    'the hub selection must be the first 8 blocks in canonical (source, offset) order'
  );
  const hubLine = JSON.parse(linesOf(hubA.jsonl)[0]);
  assert.ok(!JSON.stringify(hubLine).includes('truncatedBlocks'), 'truncatedBlocks must stay internal bookkeeping');
});

// ---------------------------------------------------------------------------
// Knowledge-unit erasure targets (spec: gegearsyah/versieve#66): source anchors as
// erasable targets with a full-footprint pure-deletion receipt; knowledge-unit ids
// and unknown/malformed targets fail closed with typed errors. Design note:
// docs/research-notes/2026-11-28-knowledge-unit-erasure-receipt-design.md
// ---------------------------------------------------------------------------

test('Amnesiac 13: source-anchor erasure, pure deletion of one source with a full-footprint receipt', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);
  const anchor = 'source:contracts/msa.txt';
  const before = corpus.jsonl;
  const removedIds = new Set(corpus.samples.filter((s) => s.source === 'contracts/msa.txt').map((s) => s.id));
  assert.ok(removedIds.size >= 1, 'the anchor must resolve to at least one sample');

  const after = eraseEntity(corpus, anchor);
  assert.equal(after.diffReceipt.erasedTarget, anchor);
  assert.equal(after.diffReceipt.erasedTargetKind, 'source');
  assert.equal(after.diffReceipt.erasedSource, 'contracts/msa.txt');
  assert.deepEqual(after.diffReceipt.removedSampleIds, [...removedIds].sort(), 'the receipt must state exactly the erased source samples');
  assert.equal(after.diffReceipt.removedSampleCount, removedIds.size);
  assert.equal(after.diffReceipt.changedSampleIds.length, 0, 'source erasure deletes samples, it regenerates none');
  assert.equal(after.diffReceipt.removedSampleLineBytes, before.length - after.jsonl.length, 'removed JSONL bytes must equal the exact deleted line bytes');

  // pure deletion: every surviving line is byte-identical and present in the original, counts add up
  const beforeLines = linesOf(before);
  const afterLines = linesOf(after.jsonl);
  assert.equal(afterLines.length, beforeLines.length - removedIds.size);
  assert.ok(afterLines.every((l) => beforeLines.includes(l)), 'the erasure must emit only byte-identical surviving lines');
  assert.equal(after.diffReceipt.unchangedSampleCount, afterLines.length);

  // receipt consistency: exactly the entities mentioned by removed samples are receipted as changed,
  // removedEntityIds leave the index, and changed survivors keep only their remaining sampleIds
  const expectedTouched = [...new Set(corpus.samples.filter((s) => removedIds.has(s.id)).flatMap((s) => s.entities))].sort();
  const receiptedTouched = [...new Set([...after.diffReceipt.removedEntityIds, ...after.diffReceipt.changedEntityIds])].sort();
  assert.deepEqual(receiptedTouched, expectedTouched, 'the receipt footprint must cover exactly the entities the erased source mentioned');
  for (const id of after.diffReceipt.removedEntityIds) {
    assert.ok(!after.entityIndex.some((e) => e.entityId === id), 'removed entities must leave the index');
  }
  for (const e of after.entityIndex) {
    assert.ok(e.sampleIds.every((id) => !removedIds.has(id)), `surviving entity ${e.entityId} must not keep sampleIds from the erased source`);
  }

  // determinism, and the original state is preserved
  const again = eraseEntity(corpus, anchor);
  assert.equal(again.jsonl, after.jsonl, 'source erasure must be deterministic');
  assert.equal(corpus.jsonl, before, 'source erasure must not mutate the original corpus state');
});

test('Amnesiac 14: source-anchor erasure removes entities anchored only in the erased source; receipts list them', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);
  const runbookIds = new Set(corpus.samples.filter((s) => s.source === 'ops/runbook.txt').map((s) => s.id));
  const runbookOnly = corpus.entityIndex.find((e) => e.sampleIds.length > 0 && e.sampleIds.every((id) => runbookIds.has(id)));
  assert.ok(runbookOnly, 'the runbook source must anchor at least one entity no other source mentions');

  const after = eraseEntity(corpus, 'source:ops/runbook.txt');
  assert.deepEqual(after.diffReceipt.removedEntityIds, [runbookOnly.entityId], 'entities anchored only in the erased source are receipted as removed');
  assert.ok(!after.entityIndex.some((e) => e.entityId === runbookOnly.entityId), 'the removed entity is gone from the regenerated index');
  assert.equal(after.receipt.entityCount, corpus.entityIndex.length - 1);
  assert.equal(after.receipt.corpusSha256, sha256Hex(after.jsonl), 'the regenerated receipt must pin the exact emitted bytes');
  assert.equal(after.diffReceipt.corpusSha256Before, sha256Hex(corpus.jsonl));
  assert.equal(after.diffReceipt.diffVerified, true);
});

test('Amnesiac 15: erasure targets fail closed with typed errors for unknown, malformed, and unresolvable targets', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);

  assert.throws(
    () => eraseEntity(corpus, 'source:nowhere.txt'),
    (e) => e.code === 'AMNESIAC_ERASE_TARGET_UNKNOWN' && /unknown source anchor/.test(e.message),
    'an unknown source anchor must fail closed with its typed error'
  );
  assert.throws(
    () => eraseEntity(corpus, 'unit:recipe:sauce-v1'),
    (e) => e.code === 'AMNESIAC_ERASE_TARGET_UNRESOLVED' && /#59/.test(e.message),
    'a knowledge-unit id must fail closed naming the missing corpus representation'
  );
  assert.throws(() => eraseEntity(corpus, ''), (e) => e.code === 'AMNESIAC_ERASE_TARGET_MALFORMED');
  assert.throws(() => eraseEntity(corpus, '   '), (e) => e.code === 'AMNESIAC_ERASE_TARGET_MALFORMED');
  assert.throws(() => eraseEntity(corpus, 'source:'), (e) => e.code === 'AMNESIAC_ERASE_TARGET_MALFORMED');
  assert.throws(() => eraseEntity(corpus, 42), (e) => e.code === 'AMNESIAC_ERASE_TARGET_MALFORMED');

  // the existing entity-path error surface is unchanged
  assert.throws(() => eraseEntity(corpus, 'ent:person:doesnotexist00'), /unknown entityId/);

  // composed corpora fail closed on source erasure instead of guessing at retraction semantics
  const composed = await buildAmnesiacCorpus(INPUTS, { identity: 'readable', composition: 'composed' });
  assert.throws(
    () => eraseEntity(composed, 'source:contracts/msa.txt'),
    (e) => e.code === 'AMNESIAC_ERASE_SOURCE_COMPOSED_UNSUPPORTED'
  );

  // and a malformed target on a composed corpus stays malformed, never a composed-path erasure
  assert.throws(() => eraseEntity(composed, ''), (e) => e.code === 'AMNESIAC_ERASE_TARGET_MALFORMED');
});

test('Amnesiac 16: source erasure composes with entity erasure; readable per-block source erasure keeps its mode', async () => {
  const corpus = await buildAmnesiacCorpus(INPUTS);
  const auditErased = eraseEntity(corpus, 'source:notes/audit.txt');
  const person = auditErased.entityIndex.find((e) => e.class === 'PERSON');
  assert.ok(person, 'the PERSON entity must survive the audit erasure (still anchored in the contracts source)');

  const thenEntity = eraseEntity(auditErased, person.entityId);
  assert.equal(thenEntity.diffReceipt.diffVerified, true, 'entity erasure must still verify against a source-erased corpus');
  assert.ok(!thenEntity.entityIndex.some((e) => e.entityId === person.entityId), 'the second erasure removes the entity cleanly');

  const readable = await buildAmnesiacCorpus(INPUTS, READABLE_VIEW);
  const erased = eraseEntity(readable, 'source:ops/handbook.txt');
  assert.equal(erased.receipt.identity, 'readable', 'readable source erasure must stay in the readable mode of its corpus');
  assert.equal(erased.diffReceipt.erasedTarget, 'source:ops/handbook.txt');
  assert.equal(erased.diffReceipt.diffVerified, true);
  assert.equal(readable.jsonl.split('\n').filter(Boolean).length, erased.diffReceipt.unchangedSampleCount + erased.diffReceipt.removedSampleCount);
});
