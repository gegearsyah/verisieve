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

// Spec: gegearsyah/verisieve#25 — external-behavior-only tests at the new seam (bytes in → bytes out).
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
