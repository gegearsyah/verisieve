import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  agglomerateThemeNodes,
  shortlistPairs,
  loadWeftThemeScorer,
  THEME_POLICY_VERSION,
  DEFAULT_THEME_POLICY,
} from '../src/weft-theme-linker.js';
import { buildAmnesiacCorpus, eraseEntity } from '../src/amnesiac-corpus.js';
import { perceiveMulti } from '../src/perceive.js';

// W6 (ticket gegearsyah/versieve#46): external-behavior-only tests. The agglomeration unit
// tests run on synthetic score tables with no weights and no runtime; the full-seam tests
// use the committed int4 artifact and skip loudly when it or onnxruntime-node is absent.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = path.join(ROOT, 'models/weft-specialist-quantized/weft-int4.onnx');
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

const POLICY = {
  policyVersion: THEME_POLICY_VERSION,
  joinThreshold: 0.5,
  simFloor: 0.3,
  anchorK: 3,
  modelSha256: 'f'.repeat(64),
};
const JOIN = (a, b, linkProb, themeSim, aSpan, bSpan) => ({ a, b, linkProb, themeSim, ...(aSpan && { aSpan }), ...(bSpan && { bSpan }) });

// Seam inputs: two overlapping narrative sources plus one disjoint technical source.
const INPUTS = [
  {
    name: 'contracts/msa.txt',
    text:
      'Vendor agreement between Acme GmbH and Ravi Chandra.\n' +
      'The platform migration project phase two covers the invoice pipeline.\n' +
      'Invoice queries go to ravi.chandra@corp.example.\n' +
      'Payment terms are net 30 days from receipt.',
  },
  {
    name: 'notes/week1.txt',
    text:
      'Weekly sync notes: Ravi Chandra walked through the phase two migration plan.\n' +
      'The invoice pipeline and payment terms stayed on the roadmap.',
  },
  {
    name: 'ops/runbook.txt',
    text:
      'Console deployment uses ghp_0123456789abcdefghijklmnopqrstuvwxyzAB and rotates it after the migration.',
  },
];

// ---------------------------------------------------------------------------
// Agglomeration: the pure function on synthetic score tables
// ---------------------------------------------------------------------------

test('Theme 1: agglomeration is a pure function: repeated runs and permuted input orders produce identical nodes', () => {
  const pairs = [
    JOIN('chunk_1', 'chunk_2', 0.82, 0.71),
    JOIN('chunk_2', 'chunk_3', 0.66, 0.5),
    JOIN('chunk_1', 'chunk_4', 0.4, 0.9),
    JOIN('chunk_3', 'chunk_4', 0.9, 0.2),
    JOIN('chunk_5', 'chunk_6', 0.2, 0.2),
  ];
  const baseline = agglomerateThemeNodes(pairs, POLICY);
  for (const again of [agglomerateThemeNodes(pairs, POLICY), agglomerateThemeNodes(pairs.slice().reverse(), POLICY), agglomerateThemeNodes([pairs[3], pairs[1], pairs[0], pairs[4], pairs[2]], POLICY)]) {
    assert.deepEqual(again, baseline, 'the agglomeration must not depend on presentation order');
  }
  assert.equal(baseline.nodes.length, 4, 'three endpoints collide into one node; two singletons remain, one endpoint set each');
  const big = baseline.nodes.find((n) => n.members.includes('chunk_1') && n.members.includes('chunk_3'));
  assert.ok(big, 'the two joins above threshold must land in one node');
  assert.deepEqual(big.members, ['chunk_1', 'chunk_2', 'chunk_3'], 'A~B and B~C are transitive: one node, three members');
  assert.deepEqual(big.anchors, ['chunk_1', 'chunk_2', 'chunk_3'], 'anchors are the lowest member ids in canonical order');
  const belowThresholdNode = baseline.nodes.find((n) => n.members.includes('chunk_1') && !n.members.includes('chunk_3'));
  assert.ok(!belowThresholdNode, 'no split node beyond the transitive closure');
});

test('Theme 2: abstain on ambiguous pairs: below the join threshold or below the sim floor, nothing links', () => {
  const pairs = [
    JOIN('a', 'b', 0.49, 0.99), // linkProb below joinThreshold
    JOIN('c', 'd', 0.99, 0.29), // themeSim below simFloor
    JOIN('e', 'f', 0.99, 0.99), // joins
  ];
  const result = agglomerateThemeNodes(pairs, POLICY);
  assert.equal(result.joinCount, 1, 'exactly one pair clears both gates');
  assert.deepEqual(result.nodes.map((n) => n.members), [['a'], ['b'], ['c'], ['d'], ['e', 'f']], 'abstained pairs must not merge');
  const joinedNode = result.nodes.find((n) => n.members.length === 2);
  assert.deepEqual(joinedNode.scoreDistribution.linkProb, { min: 0.99, median: 0.99, max: 0.99 });
  assert.deepEqual(joinedNode.scoreDistribution.themeSim, { min: 0.99, median: 0.99, max: 0.99 });
  assert.equal(result.nodes.every((n) => n.policyVersion === THEME_POLICY_VERSION), true, 'every node records the policy version');
  assert.equal(result.nodes.every((n) => n.modelSha256 === 'f'.repeat(64)), true, 'every node records the model sha');
  assert.ok(result.nodes.every((n) => /^theme:[0-9a-f]{16}$/.test(n.id)), 'node ids are theme-prefixed 16-hex member digests');
  const again = agglomerateThemeNodes(pairs, POLICY);
  assert.equal(again.nodes.find((n) => n.members.length === 2).id, joinedNode.id, 'a node id is a pure function of the member set');
});

test('Theme 3: evidence spans travel with the pairs and stay within their source items', () => {
  const spanA = { source: 'docA.txt', blockId: 'b1', start: 0, end: 40 };
  const spanB = { source: 'docB.txt', blockId: 'b2', start: 8, end: 64 };
  const result = agglomerateThemeNodes([JOIN('a', 'b', 0.9, 0.9, spanA, spanB)], POLICY);
  assert.equal(result.nodes.length, 1);
  const [node] = result.nodes;
  assert.deepEqual(node.evidenceSpans, [spanA, spanB]);
  for (const span of node.evidenceSpans) {
    assert.ok(span.end > span.start, 'a span is a non-empty byte range');
    assert.ok(['docA.txt', 'docB.txt'].includes(span.source), 'every span source is one of the member sources');
  }
  // a pair with no spans aggregates to a node without invented spans
  const bare = agglomerateThemeNodes([JOIN('x', 'y', 0.9, 0.9)], POLICY);
  assert.deepEqual(bare.nodes[0].evidenceSpans, [], 'no span in, no span invented');
});

test('Theme 4: the candidate shortlist never pairs two chunks of one source item and deduplicates symmetric pairs', () => {
  const chunks = [1, 2, 3, 4].map((i) => ({
    id: `chunk_${i}`,
    source: i <= 2 ? 'same.txt' : i === 3 ? 'other.txt' : 'third.txt',
    text: `shared roadmap topic number ${i} with enough other words around it`,
    span: { source: `s${i}`, blockId: `b${i}`, start: i, end: i + 10 },
  }));
  const shortlist = shortlistPairs(chunks, 64);
  assert.ok(shortlist.length >= 1, 'overlapping texts across sources must shortlist');
  for (const pair of shortlist) {
    const srcA = chunks.find((c) => c.id === pair.a).source;
    const srcB = chunks.find((c) => c.id === pair.b).source;
    assert.notEqual(srcA, srcB, 'no candidate pair may share a source item');
    assert.ok(pair.a < pair.b, 'candidate pairs are canonically ordered');
    assert.equal(typeof pair.aText, 'string', 'the shortlist carries the chunk text for scoring');
    assert.ok(pair.aSpan && pair.bSpan, 'the shortlist carries each chunk span for the evidence');
  }
  const capped = shortlistPairs(chunks.map((c, i) => ({ ...c, id: `chunk_${i + 1}`, source: `src-${i}.txt` })), 1);
  assert.ok(capped.length <= 4, 'per-chunk cap N bounds the shortlist');
});

// ---------------------------------------------------------------------------
// Full seam with the committed int4 artifact
// ---------------------------------------------------------------------------

const artifactProbe = async () => {
  if (!fs.existsSync(ARTIFACT)) return { ok: false, reason: `artifact absent at ${ARTIFACT}` };
  try {
    await import('onnxruntime-node');
  } catch (err) {
    return { ok: false, reason: `onnxruntime-node absent (${err.message})` };
  }
  return { ok: true, artifactSha256: sha256Hex(fs.readFileSync(ARTIFACT)) };
};

test('Theme 5: the seam with the real artifact produces themed graph nodes, links, and the two-channel report', async (t) => {
  const probe = await artifactProbe();
  if (!probe.ok) return t.skip(`W5/W6 real-artifact path not runnable on this box: ${probe.reason}`);

  const themed = await perceiveMulti(INPUTS, { themeLinking: true });
  const plain = await perceiveMulti(INPUTS);

  assert.ok(Array.isArray(themed.themeLinks) && themed.themeLinks.length >= 1, 'the seam shortlists and scores candidate pairs');
  assert.ok(Array.isArray(themed.themeNodes) && themed.themeNodes.length >= 1);
  assert.ok(themed.themeChannel, 'the seam reports the theme channel');
  assert.ok(!('themeNodes' in plain) && !('themeLinks' in plain) && !('themeChannel' in plain), 'theme linking unset: the output shape is unchanged');

  const channel = themed.themeChannel;
  assert.equal(channel.policyVersion, THEME_POLICY_VERSION);
  assert.equal(channel.modelSha256, probe.artifactSha256, 'the channel records the artifact sha the run actually loaded');
  assert.equal(channel.joinThreshold, DEFAULT_THEME_POLICY.joinThreshold);
  assert.equal(channel.simFloor, DEFAULT_THEME_POLICY.simFloor);
  assert.equal(channel.joinCount, themed.themeLinks.filter((l) => l.decision === 'join').length);
  assert.equal(channel.abstainCount, themed.themeLinks.filter((l) => l.decision === 'abstain').length);
  assert.equal(typeof channel.identityDisjointJoinCount, 'number');
  assert.ok(Array.isArray(channel.disagreement), 'the disagreement report is an array');

  for (const link of themed.themeLinks) {
    assert.ok(link.linkProb >= 0 && link.linkProb <= 1, 'linkProb is a probability');
    assert.ok(link.themeSim >= -1 && link.themeSim <= 1, 'themeSim is a cosine');
    const expectedDecision =
      link.linkProb >= channel.joinThreshold && link.themeSim >= channel.simFloor ? 'join' : 'abstain';
    assert.equal(link.decision, expectedDecision, 'the join decision follows the policy gates exactly');
    const identitiesA = themed.chunks.find((c) => c.id === link.a).entityIds;
    const identitiesB = themed.chunks.find((c) => c.id === link.b).entityIds;
    const identityLinked = identitiesA.some((e) => identitiesB.includes(e));
    if (link.decision === 'join' && !identityLinked) {
      assert.ok(channel.identityDisjointJoinCount >= 1);
    }
    if (link.decision === 'abstain' && identityLinked) {
      assert.ok(channel.disagreement.some((d) => d.a === link.a && d.b === link.b), 'an identity-linked abstain is reported as a disagreement');
    }
  }
  const disagreementShapes = channel.disagreement.every(
    (d) => d.identityLinked === true && typeof d.linkProb === 'number' && typeof d.themeSim === 'number' && d.decision === 'abstain'
  );
  assert.equal(disagreementShapes, true, 'every disagreement entry carries identityLinked, both scores, and its decision');

  const byChunkId = new Map(themed.chunks.map((c) => [c.id, c]));
  for (const node of themed.themeNodes) {
    assert.ok(node.members.length >= 1);
    assert.deepEqual(node.anchors, node.members.slice(0, DEFAULT_THEME_POLICY.anchorK));
    assert.equal(node.policyVersion, THEME_POLICY_VERSION);
    assert.equal(node.modelSha256, probe.artifactSha256);
    assert.ok(node.evidenceSpans.length >= node.members.length - 1, 'a joined node records a span for each joined member');
    for (const span of node.evidenceSpans) {
      assert.ok(typeof span.start === 'number' && typeof span.end === 'number' && span.start <= span.end);
      assert.ok(
        node.members.some((m) => byChunkId.get(m).span && byChunkId.get(m).span.source === span.source),
        'every evidence span source is a source of one of the member chunks'
      );
    }
  }
  const joinedMembers = themed.themeNodes.flatMap((n) => n.members);
  assert.equal(new Set(joinedMembers).size, joinedMembers.length, 'theme node members are disjoint');
});

test('Theme 6: the theme pass is deterministic across repeated identical runs', async (t) => {
  const probe = await artifactProbe();
  if (!probe.ok) return t.skip(`W5/W6 real-artifact path not runnable on this box: ${probe.reason}`);
  const a = await perceiveMulti(INPUTS, { themeLinking: true });
  const b = await perceiveMulti(INPUTS, { themeLinking: true });
  assert.deepEqual(JSON.parse(JSON.stringify(b.themeLinks)), JSON.parse(JSON.stringify(a.themeLinks)));
  assert.deepEqual(JSON.parse(JSON.stringify(b.themeNodes)), JSON.parse(JSON.stringify(a.themeNodes)));
  assert.deepEqual(JSON.parse(JSON.stringify(b.themeChannel)), JSON.parse(JSON.stringify(a.themeChannel)));
});

test('Theme 7: fail-closed typed errors: absent weights, malformed options, sha mismatch', async (t) => {
  const probe = await artifactProbe();
  if (!probe.ok) return t.skip(`W5/W6 real-artifact path not runnable on this box: ${probe.reason}`);

  await assert.rejects(
    () => perceiveMulti(INPUTS, { themeLinking: { modelPath: path.join(ROOT, 'models/weft-specialist-quantized/absent.onnx') } }),
    (err) => err.code === 'WEFT_THEME_WEIGHTS_MISSING',
    'an absent artifact fails closed with the typed weights-missing error'
  );
  await assert.rejects(
    () =>
      loadWeftThemeScorer({
        modelPath: ARTIFACT,
        expectedSha256: '0'.repeat(64),
      }),
    (err) => err.code === 'WEFT_THEME_ARTIFACT_SHA_MISMATCH',
    'a pinned-artifact sha mismatch fails closed'
  );
  await assert.rejects(
    () => perceiveMulti(INPUTS, { themeLinking: 'yes' }),
    (err) => err.code === 'WEFT_THEME_OPTIONS_INVALID',
    'a malformed themeLinking option fails closed'
  );
  const scorer = await loadWeftThemeScorer({ modelPath: ARTIFACT, expectedSha256: probe.artifactSha256 });
  assert.equal(scorer.modelSha256, probe.artifactSha256);
  const scores = await scorer.scorePairs([
    { a: 'Phase two covers the invoice pipeline migration.', b: 'The invoice pipeline migration is covered in phase two.' },
  ]);
  assert.equal(scores.length, 1);
  assert.ok(scores[0].linkProb >= 0 && scores[0].linkProb <= 1, 'a scored pair yields a real link probability in (0,1) range bounds');
});

// ---------------------------------------------------------------------------
// Erasure re-proof on a theme-carrying corpus
// ---------------------------------------------------------------------------

test('Theme 8: erasure re-derives theme nodes and the diff receipt carries the re-proof with unchanged byte guarantees', async (t) => {
  const probe = await artifactProbe();
  if (!probe.ok) return t.skip(`W5/W6 real-artifact path not runnable on this box: ${probe.reason}`);

  const corpus = await buildAmnesiacCorpus(INPUTS, null, { themeLinking: true });
  assert.ok(corpus.theme, 'the corpus carries the theme channel');
  assert.equal(corpus.theme.policyVersion, THEME_POLICY_VERSION);
  assert.ok(corpus.theme.modelSha256, 'the corpus theme channel pins the model sha');
  assert.ok(Array.isArray(corpus.theme.pairs) && Array.isArray(corpus.theme.chunks));
  const email = corpus.entityIndex.find((e) => e.class === 'EMAIL');
  assert.ok(email, 'the corpus indexes the EMAIL entity');

  const after = eraseEntity(corpus, email.entityId);

  // existing byte-diff guarantees hold: only the erased entity samples regenerate
  const beforeLines = corpus.jsonl.split('\n');
  const afterLines = after.jsonl.split('\n');
  assert.equal(afterLines.length, beforeLines.length);
  const changed = new Set(after.diffReceipt.changedSampleIds);
  for (let i = 0; i < corpus.samples.length; i++) {
    if (!changed.has(corpus.samples[i].id)) {
      assert.equal(afterLines[i], beforeLines[i], 'non-theme bytes stay byte-identical under the theme re-proof');
    }
  }
  assert.equal(after.diffReceipt.corpusSha256Before, sha256Hex(corpus.jsonl));
  assert.equal(after.diffReceipt.corpusSha256After, sha256Hex(after.jsonl));

  // the theme re-proof itself
  assert.equal(after.diffReceipt.themeReDerived, true);
  assert.equal(after.diffReceipt.themeNodeCountBefore, corpus.theme.nodes.length, 'the before count matches the carried nodes');
  assert.equal(typeof after.diffReceipt.themeNodeCountAfter, 'number');
  assert.ok(Array.isArray(after.diffReceipt.changedThemeNodeIds));
  assert.ok(Array.isArray(after.theme.pairs), 'the regenerated corpus carries the surviving theme pairs');
  const survivingMembers = new Set();
  for (const pair of after.theme.pairs) {
    survivingMembers.add(pair.a);
    survivingMembers.add(pair.b);
  }
  for (const changedId of changed) {
    if (!survivingMembers.size) continue;
    const invalidatedBlocks = corpus.samples.filter((s) => s.id === changedId).map((s) => s.blockId);
    for (const pair of after.theme.pairs) {
      const aChunk = corpus.theme.chunks.find((c) => c.id === pair.a);
      const bChunk = corpus.theme.chunks.find((c) => c.id === pair.b);
      const aOK = aChunk.blockId === null || !invalidatedBlocks.includes(aChunk.blockId);
      const bOK = bChunk.blockId === null || !invalidatedBlocks.includes(bChunk.blockId);
      assert.ok(aOK && bOK, 'no surviving pair references a block whose bytes this erasure changed');
    }
  }
  const nodesAfter = after.theme.nodes;
  assert.ok(nodesAfter, 'the regenerated corpus carries the re-derived theme nodes');
  assert.equal(nodesAfter.length, after.diffReceipt.themeNodeCountAfter);

  // a second erasure re-proves from the post-erasure corpus state
  const stillThere = after.entityIndex.find((e) => e.class === 'SECRET');
  if (stillThere) {
    const second = eraseEntity(after, stillThere.entityId);
    assert.equal(second.diffReceipt.themeReDerived, true, 'the theme re-proof composes across successive erasures');
  }

  // drift guard: a theme policy version other than the running one is rejected loudly
  const drifted = structuredClone(corpus);
  drifted.receipt.engineVersionSha256 = after.diffReceipt.engineVersionSha256;
  drifted.theme.policyVersion = 'weft-theme-agglomeration-v0';
  assert.throws(
    () => eraseEntity(drifted, email.entityId),
    /theme policy version drift/,
    'erasing against a different theme policy version must fail loudly'
  );
});
