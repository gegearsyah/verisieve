import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAmnesiacCorpus } from '../src/amnesiac-corpus.js';
import { compileIdentityContrastivePairs } from '../src/identity-contrastive-pairs.js';

// Stage K2 — identity-contrastive pair compiler: external-behavior-only tests at the new seam
// (a readable per-block corpus state in → deterministic pair JSONL + receipt out).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INPUTS = [
  {
    name: 'contracts/msa.txt',
    text: 'Vendor agreement between Acme GmbH and Ravi Chandra.\nInvoice queries go to ravi.chandra@corp.example or ravi.chandra@corp2.example.\nPayment terms are net 30 days from receipt.',
  },
  {
    name: 'notes/audit.txt',
    text: 'Audit sign-off from Ravi Chandra with Marta Keller.\nThe reminder went to ravi.chandra@corp.example.\nBilling copies went to ravi.chandra@corp2.example.',
  },
  {
    name: 'notes/travel.txt',
    text: 'Travel approval for Marta Keller.\nThe booking receipt went to marta.keller@corp.example.',
  },
];

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function linesOf(jsonl) {
  return String(jsonl).split('\n').filter(Boolean);
}

async function compile(inputs, options = {}) {
  const corpus = await buildAmnesiacCorpus(inputs, { identity: 'readable' });
  return { corpus, compiled: compileIdentityContrastivePairs(corpus, options) };
}

test('K2 1: determinism — two compiles are byte-identical, pair ids are content digests in fixed order', async () => {
  const { compiled: a } = await compile(INPUTS);
  const { compiled: b } = await compile(INPUTS);

  assert.ok(a.pairs.length >= 1, `the compiler must emit pairs, got ${a.pairs.length}`);
  assert.equal(a.jsonl, b.jsonl, 'two identical compiles must be byte-identical');
  assert.deepEqual(a.receipt, b.receipt, 'receipts must be deterministic across identical runs');
  assert.equal(a.receipt.corpusSha256, sha256Hex((await compile(INPUTS)).corpus.jsonl), 'the receipt must carry the SHA-256 of the corpus it compiled from');
  const ids = linesOf(a.jsonl).map((l) => JSON.parse(l).id);
  assert.equal(new Set(ids).size, ids.length, 'pair ids must be unique');
  for (const id of ids) assert.match(id, /^[0-9a-f]{64}$/, 'pair ids must be SHA-256 digests');
  assert.deepEqual(ids, [...ids].sort(), 'the pair JSONL must be fixed-ordered by pair id');
  assert.equal(a.receipt.pairJsonlSha256, sha256Hex(a.jsonl), 'the receipt must pin the SHA-256 of the exact pair bytes');
  assert.equal(a.receipt.policy, 'pairs-v1');
});

test('K2 2: positives — every positive pair joins two blocks of one entity from DIFFERENT sources, rendered as labeled SFT messages', async () => {
  const { corpus, compiled } = await compile(INPUTS);
  const positives = compiled.pairs.filter((p) => p.kind === 'positive');
  assert.ok(positives.length >= 2, `the fixture must yield cross-document positives, got ${positives.length}`);
  const blockOf = new Map(corpus.samples.map((s) => [s.id, s]));

  for (const p of positives) {
    assert.ok(Array.isArray(p.blockIds) && p.blockIds.length === 2, 'a positive records its two block ids');
    const [a, b] = p.blockIds.map((id) => blockOf.get(id));
    assert.ok(a && b, `both blocks of positive ${p.id} must exist in the corpus state`);
    assert.ok(a.entities.includes(p.entityId) && b.entities.includes(p.entityId), 'both blocks must be anchored to the positive entity');
    assert.notEqual(a.source, b.source, 'the two blocks must come from different sources');
    // the id is the sha256 content digest over the pair formula
    assert.equal(p.id, sha256Hex(`pair\u0000${a.id}\u0000${b.id}\u0000${p.entityId}`), 'the positive id must be the pinned digest formula');
    // render: labeled sources in canonical (source, offset) order, question, id + canonical name as the target
    assert.deepEqual(p.messages.map((m) => m.role), ['user', 'assistant'], 'a pair is a two-message SFT sample');
    assert.ok(p.messages[0].content.includes(`[${a.source}] `) && p.messages[0].content.includes(`[${b.source}] `), 'the user message labels both records with their sources');
    assert.ok(p.messages[0].content.indexOf(`[${a.source}]`) < p.messages[0].content.indexOf(`[${b.source}]`), 'the labeled records must follow the canonical block order');
    assert.ok(p.messages[0].content.includes('Which single entity'), 'the user message asks which entity the records describe');
    assert.ok(p.messages[1].content.startsWith(p.entityId), 'the assistant target starts with the readable canonical id');
  }
});

test('K2 3: negatives — same-class different-entity pairs, near by default; far only with the explicit option', async () => {
  const entityOf = (await compile(INPUTS)).corpus.entityIndex;
  const byId = new Map(entityOf.map((e) => [e.entityId, e]));

  const def = (await compile(INPUTS, { holdoutFraction: 0.01 })).compiled;
  const nearNegatives = def.pairs.filter((p) => p.kind === 'negative');
  assert.ok(nearNegatives.length >= 1, 'the fixture must yield at least one near-miss negative (the two ravi.chandra@ mailboxes)');
  for (const p of nearNegatives) {
    const [ea, eb] = p.entityIds;
    assert.notEqual(ea, eb, 'a negative pair anchors two DIFFERENT entities');
    assert.equal(byId.get(ea).class, byId.get(eb).class, 'a negative pair must be same-class');
    assert.equal(p.hardness, 'near', 'by default every emitted negative is a near (>=0.8 similarity) pair');
    assert.equal(p.id, sha256Hex(`pair\u0000${p.blockIds[0]}\u0000${p.blockIds[1]}\u0000${ea}\u0000${eb}`), 'the negative id must be the pinned digest formula');
    assert.ok(p.messages[1].content.includes(ea) && p.messages[1].content.includes(eb), 'the assistant target names both ids — the model must SPLIT them');
  }
  assert.deepEqual(def.receipt.hardnessBins.homonym, 0, 'same-class negatives cannot be homonyms: readable ids are unique by construction');
  assert.ok(def.receipt.hardnessBins.far >= 1, 'the artifact must still RECORD the evaluated far candidates it declined to emit');

  const farOn = (await compile(INPUTS, { holdoutFraction: 0.01, includeFarNegatives: true })).compiled;
  const farNegatives = farOn.pairs.filter((p) => p.kind === 'negative' && p.hardness === 'far');
  assert.ok(farNegatives.length >= 1, 'with the explicit option, far negatives are emitted');
  assert.equal(farOn.pairs.filter((p) => p.kind === 'negative' && p.hardness === 'near').length, nearNegatives.length, 'the near set is unchanged by the option');
  assert.ok(!def.pairs.some((p) => p.kind === 'negative' && p.hardness === 'far'), 'the default emits zero far negatives (anti-triviality, research risk 3)');
});

test('K2 4: entity-disjoint holdout — every k-th entity by canonical id order, zero pairs, mentions retained as context', async () => {
  const { corpus, compiled } = await compile(INPUTS); // default holdoutFraction 0.2 → k = 5
  const holdout = new Set(compiled.receipt.holdoutEntityIds);
  assert.ok(holdout.size >= 1, 'the default fraction must reserve a holdout');

  // expected selection replicated from the spec rule: every k-th entity in canonical id order
  const k = Math.ceil(1 / compiled.receipt.holdoutFraction);
  const expected = corpus.entityIndex.map((e) => e.entityId).filter((_, i) => i % k === 0);
  assert.deepEqual([...holdout].sort(), [...expected].sort(), 'the holdout selection must be exactly every k-th entity in canonical id order');
  assert.equal(compiled.pairs.filter((p) => p.kind === 'positive' && holdout.has(p.entityId)).length, 0, 'holdout entities emit zero positive pairs');
  assert.equal(compiled.pairs.filter((p) => p.kind === 'negative' && p.entityIds.some((e) => holdout.has(e))).length, 0, 'holdout entities are named in zero negative pairs');

  // their mentions stay in the corpus and ride inside other pairs as context
  const contextBlocks = corpus.samples.filter(
    (s) => s.entities.some((e) => holdout.has(e)) && s.entities.some((e) => !holdout.has(e))
  );
  assert.ok(contextBlocks.length >= 1, 'the fixture must contain a block co-mentioning a holdout entity and a trained entity');
  for (const blk of contextBlocks) {
    const trained = blk.entities.find((e) => !holdout.has(e));
    const carrier = compiled.pairs.find((p) => p.kind === 'positive' && p.entityId === trained && p.blockIds.includes(blk.id));
    assert.ok(carrier, `the co-mention block must ride inside ${trained}'s pairs as context`);
    assert.ok(carrier.messages[0].content.includes(blk.content), 'the holdout entity\'s surface text must be present in the carrier pair\'s render');
  }
  // and the holdout selection is deterministic
  const again = (await compile(INPUTS)).compiled;
  assert.deepEqual(again.receipt.holdoutEntityIds, compiled.receipt.holdoutEntityIds, 'the holdout list must be deterministic');
  assert.ok(again.receipt.holdoutEntityIds.length === Math.ceil(corpus.entityIndex.length / k), 'the holdout count must match the every-k-th rule');
});

test('K2 5: loud seam guard — vaulted and composed states are TypeErrors, the compiler mutates nothing', async () => {
  const vaulted = await buildAmnesiacCorpus(INPUTS); // default identity is vaulted
  assert.throws(() => compileIdentityContrastivePairs(vaulted), /readable/, 'the vaulted state must fail loudly (the readable seam is the only input)');

  const { corpus } = await compile(INPUTS);
  assert.throws(() => compileIdentityContrastivePairs({ ...corpus, entityIndex: null }), /state/, 'a shape-less state must fail loudly');
  const before = corpus.jsonl;
  const composedState = await buildAmnesiacCorpus(INPUTS, { identity: 'readable', composition: 'composed' });
  assert.throws(() => compileIdentityContrastivePairs(composedState), /per-block/, 'a composed-corpus state is not a pair-compiler input');
  await compile(INPUTS);
  assert.equal((await buildAmnesiacCorpus(INPUTS, { identity: 'readable' })).jsonl, before, 'compilation must leave the corpus bytes untouched (pure function)');
});

test('K2 6: runner smoke — the K2 runner runs on the estate and writes both artifacts, deterministic and leaves the tree clean', async () => {
  const { generateEstate } = await import('../scripts/gen-company-estate.mjs');
  const { runIdentityContrastivePairArtifacts, OUT_JSON, OUT_JSONL } = await import('../scripts/run-identity-contrastive-pairs.mjs');
  // the artifacts are committed receipts: remember the pre-test bytes so the test can leave
  // the tree exactly as it found it (identical bytes if the receipts reproduce) instead of
  // deleting tracked files
  const preJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON) : null;
  const preJsonl = fs.existsSync(OUT_JSONL) ? fs.readFileSync(OUT_JSONL) : null;
  generateEstate();
  const artifact = await runIdentityContrastivePairArtifacts();
  assert.ok(fs.existsSync(OUT_JSON) && fs.existsSync(OUT_JSONL), 'the runner must write both artifacts');

  const parsed = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const lines = fs.readFileSync(OUT_JSONL, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, parsed.receipt.pairCount, 'artifacts must agree on the pair count');
  assert.ok(parsed.receipt.positiveCount >= 1, `the estate must yield positives, got ${parsed.receipt.positiveCount}`);
  assert.ok(Array.isArray(parsed.receipt.holdoutEntityIds) && parsed.receipt.holdoutEntityIds.length >= 1, 'the artifact must record its holdout');
  assert.ok(parsed.receipt.pairJsonlSha256 === sha256Hex(fs.readFileSync(OUT_JSONL)), 'the pair JSONL receipt must pin the written bytes');
  const reread = await runIdentityContrastivePairArtifacts();
  assert.equal(JSON.stringify(reread), JSON.stringify(artifact), 'the runner must be deterministic run-to-run');

  if (preJson === null) fs.rmSync(OUT_JSON); else fs.writeFileSync(OUT_JSON, preJson);
  if (preJsonl === null) fs.rmSync(OUT_JSONL); else fs.writeFileSync(OUT_JSONL, preJsonl);
  const postJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON) : null;
  const postJsonl = fs.existsSync(OUT_JSONL) ? fs.readFileSync(OUT_JSONL) : null;
  assert.ok(preJson === null ? postJson === null : postJson !== null && postJson.equals(preJson), 'cleanup leaves results/identity-contrastive-pairs.json exactly as found');
  assert.ok(preJsonl === null ? postJsonl === null : postJsonl !== null && postJsonl.equals(preJsonl), 'cleanup leaves results/identity-contrastive-pairs.jsonl exactly as found');
});
