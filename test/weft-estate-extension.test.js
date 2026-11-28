import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_TEACHER_LICENCE,
  WeftTeacherUnavailableError,
} from '../scripts/build-weft-training-pairs.mjs';
import {
  KNOWLEDGE_MIN_CONTENT_WORDS,
  PRIVATE_UNIT_SOURCE_KINDS,
  WeftExtensionConfigError,
  deriveSourceKind,
  knowledgeDensity,
  normalizeSourceKind,
  passesKnowledgeThreshold,
  runExtension,
  compliancePositivePrompt,
  complianceNegativePrompt,
  chatterPrompt,
  privateUnitPrompt,
} from '../scripts/generate-weft-estate-extension-v5.mjs';
import {
  WeftErasureProofError,
  buildErasureReceipt,
  regenerateCorpusMinusUnit,
} from '../scripts/prove-weft-private-unit-erasure.mjs';

// W-EXT contract tests: a stub teacher, a tiny temp coverage corpus, no
// network and no key. Importing the extension driver makes no teacher call.
const PROFILE = 'hospital-network';

const KNOWLEDGE_TEXT = 'The retention schedule for archived transaction records must keep every quarterly ledger for 7 years and destroy superseded copies after the annual review.';
const CHATTER_TEXT = 'hi team, quick reminder about the standup tomorrow, thanks';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'weft-ext-'));
}

function writeTempCorpus(dir) {
  const file = path.join(dir, 'corpus.json');
  fs.writeFileSync(file, JSON.stringify({
    docs: [
      {
        id: 'alpha-c0-doc-1',
        format: 'email',
        department: 'clinical',
        theme: 'data retention audit',
        source: 'synthetic-estate',
        text: KNOWLEDGE_TEXT,
        identities: [{ key: 'emp-1', surface: 'Astrid Lindqvist', class: 'person' }],
      },
      {
        id: 'beta-c1-doc-2',
        format: 'ticket',
        department: 'pharmacy',
        theme: 'supplier risk review',
        source: 'synthetic-estate',
        text: 'Vendor audit requires 3 signed attestations from every pharmacy supplier before the October renewal cycle.',
        identities: [{ key: 'emp-2', surface: 'Eero Halvorsen', class: 'person' }],
      },
    ],
    links: [{ a: 'alpha-c0-doc-1', b: 'beta-c1-doc-2', type: 'thread' }],
  }) + '\n');
  return file;
}

function stubTeacher(calls, options = {}) {
  const complianceText = options.complianceText ?? KNOWLEDGE_TEXT;
  const chatterText = options.chatterText ?? CHATTER_TEXT;
  const unitIds = options.unitIds ?? [`private-unit-${PROFILE}-1`, `private-unit-${PROFILE}-2`];
  const withIdentity = options.complianceIdentity === true;
  const stub = {
    kind: 'api',
    licence: API_TEACHER_LICENCE,
    usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
  stub.complete = function complete(prompt) {
    calls.push(prompt);
    stub.usage.calls += 1;
    stub.usage.promptTokens += 11;
    stub.usage.completionTokens += 23;
    stub.usage.totalTokens += 34;
    if (prompt.includes('state the SAME control requirement')) {
      const theme = JSON.parse(/about the theme ("[^"]+")/.exec(prompt)[1]);
      const identities = withIdentity ? [{ key: 'who', surface: 'Sanna Kettunen', class: 'person' }] : [];
      return JSON.stringify({
        docs: [
          { id: 'c-1', format: 'pdf-scan', sourceKind: 'compliance-doc', department: 'compliance', theme, text: complianceText, identities },
          { id: 'c-2', format: 'pdf-scan', sourceKind: 'compliance-doc', department: 'compliance', theme, text: complianceText, identities },
        ],
        links: [],
      });
    }
    if (prompt.includes('ADJACENT but genuinely DIFFERENT control requirements')) {
      const theme = JSON.parse(/about the theme ("[^"]+")/.exec(prompt)[1]);
      const identities = withIdentity ? [{ key: 'who', surface: 'Sanna Kettunen', class: 'person' }] : [];
      return JSON.stringify({
        docs: [
          { id: 'c-1', format: 'pdf-scan', sourceKind: 'compliance-doc', department: 'compliance', theme, text: KNOWLEDGE_TEXT, identities },
          { id: 'c-2', format: 'pdf-scan', sourceKind: 'compliance-doc', department: 'compliance', theme, text: 'Retention schedule exceptions for 12 litigation holds require general counsel sign-off before any archived transaction record leaves cold storage.', identities },
        ],
        links: [],
      });
    }
    if (prompt.includes('ZERO knowledge content')) {
      const theme = JSON.parse(/about the theme ("[^"]+")/.exec(prompt)[1]);
      return JSON.stringify({
        docs: [
          { id: 'k-1', format: 'email', sourceKind: 'thread', department: 'clinical', theme, text: chatterText, identities: [{ key: 'emp-1', surface: 'Astrid Lindqvist', class: 'person' }] },
          { id: 'k-2', format: 'email', sourceKind: 'thread', department: 'clinical', theme, text: chatterText, identities: [{ key: 'emp-1', surface: 'Astrid Lindqvist', class: 'person' }] },
        ],
        links: [],
      });
    }
    if (prompt.includes('confidential knowledge unit')) {
      const unitId = JSON.parse(/knowledgeUnitId exactly ("[^"]+")/.exec(prompt)[1]);
      const theme = JSON.parse(/tied to the theme ("[^"]+")/.exec(prompt)[1]);
      const formats = ['memo', 'transcript', 'transcript', 'email', 'pdf-scan'];
      const kinds = PRIVATE_UNIT_SOURCE_KINDS;
      const docs = formats.map((format, n) => ({
        id: `u-${n + 1}`,
        format,
        sourceKind: kinds[n],
        department: 'clinical',
        theme,
        text: `The proprietary sterilization protocol variant 9 requires steam exposure for 14 minutes at 121 degrees, and only units batched after calibration pass.`,
        identities: [{ key: `emp-unit-${n}`, surface: `Person Number ${n + 1}`, class: 'person' }],
        knowledgeUnitId: unitId,
        confidential: true,
      }));
      const links = [
        { a: 'u-1', b: 'u-2', type: 'thread' },
        { a: 'u-1', b: 'u-3', type: 'thread' },
        { a: 'u-2', b: 'u-4', type: 'thread' },
        { a: 'u-4', b: 'u-5', type: 'thread' },
      ];
      if (options.brokenUnitSourceKind === true) docs[1].sourceKind = 'ticket';
      return JSON.stringify({ docs, links });
    }
    throw new Error(`stub teacher saw an unexpected prompt: ${prompt.slice(0, 80)}`);
  };
  return stub;
}

test('W-EXT 1: the knowledge-density filter rule and its boundary', () => {
  assert.equal(passesKnowledgeThreshold(KNOWLEDGE_TEXT), true);
  assert.equal(passesKnowledgeThreshold(CHATTER_TEXT), false);
  // Rule boundary: words alone without a digit are not knowledge.
  const noDigit = 'the quarterly ledger review keeps every archived transaction record and destroys superseded copies after assessment';
  assert.equal(knowledgeDensity(noDigit).hasDigit, false);
  assert.equal(passesKnowledgeThreshold(noDigit), false);
  // Rule boundary: a digit alone without density is not knowledge.
  const noDensity = 'hi team 9 thanks';
  assert.ok(knowledgeDensity(noDensity).distinctContentWords < KNOWLEDGE_MIN_CONTENT_WORDS);
  assert.equal(passesKnowledgeThreshold(noDensity), false);
});

test('W-EXT 2: source-kind derivation and the closed kind set', () => {
  assert.equal(deriveSourceKind({ format: 'transcript' }), 'meeting');
  assert.equal(deriveSourceKind({ format: 'ticket' }), 'ticket');
  assert.equal(deriveSourceKind({ format: 'email' }), 'thread');
  assert.equal(deriveSourceKind({ format: 'memo' }), 'memo');
  assert.equal(deriveSourceKind({ format: 'slides' }), 'document');
  assert.equal(deriveSourceKind({ format: 'pdf-scan' }), 'document');
  // normalizeSourceKind: a claimed valid kind wins, an invalid one falls back.
  assert.equal(normalizeSourceKind({ format: 'email', sourceKind: 'compliance-doc' }), 'compliance-doc');
  assert.equal(normalizeSourceKind({ format: 'email', sourceKind: 'webpage' }, 'memo'), 'memo');
  assert.equal(normalizeSourceKind({ format: 'email', sourceKind: 'webpage' }), 'thread');
});

test('W-EXT 3: prompts pin the people-free, source-kind, non-knowledge, and unit rules', () => {
  const pos = compliancePositivePrompt({ seed: 7, theme: 'data retention audit', frameworkA: { label: 'framework A' }, frameworkB: { label: 'framework B' } });
  assert.ok(pos.includes('ZERO people anywhere'));
  assert.ok(pos.includes('identities array must be empty'));
  assert.ok(pos.includes('sourceKind to "compliance-doc"'));
  assert.ok(pos.includes('the SAME control requirement'));
  const neg = complianceNegativePrompt({ seed: 7, theme: 'data retention audit', frameworkA: { label: 'framework A' }, frameworkB: { label: 'framework B' } });
  assert.ok(neg.includes('ADJACENT but genuinely DIFFERENT'));
  assert.ok(neg.includes('ZERO people anywhere'));
  const chat = chatterPrompt({ seed: 7, theme: 'data retention audit' });
  assert.ok(chat.includes('ZERO knowledge content'));
  assert.ok(chat.includes('nothing anyone could learn from'));
  const unit = privateUnitPrompt({ seed: 7, unitId: 'private-unit-x-1', theme: 'warehouse safety inspection', context: 'a company', cultureLabels: '["Nordic"]' });
  assert.ok(unit.includes('knowledgeUnitId exactly "private-unit-x-1"'));
  assert.ok(unit.includes('people are attributes of the meetings'));
  assert.ok(unit.includes('confidential true'));
});

test('W-EXT 4: a full stub run emits compiler-format pairs, counts, overlay, and receipt', () => {
  const dir = tempDir();
  try {
    const calls = [];
    const corpusPath = writeTempCorpus(dir);
    const overlayPath = path.join(dir, 'overlay.json');
    const summary = runExtension(PROFILE, {
      limit: 2,
      teacher: stubTeacher(calls),
      corpusPath,
      outDir: path.join(dir, 'ext-run'),
      overlayPath,
    });
    const c = summary.receipt.counts;
    assert.ok(c.sourceDisjointCompliancePositive >= 1);
    assert.ok(c.complianceNearRequirementNegative >= 1);
    assert.ok(c.nonKnowledgeNegative >= 1);
    assert.ok(c.nonKnowledgeVsKnowledgeNegative >= 1);
    assert.equal(c.privateUnitPositive, 20); // 2 units x 10 doc pairs
    assert.equal(c.privateUnitCrossNegative, 25); // 5 x 5 cross pairs
    // Compiler pair format on every pair.
    for (const pair of summary.pairs) {
      assert.ok(pair.id && pair.policy === 'weft-pairs-v1');
      assert.ok(['positive', 'negative'].includes(pair.label));
      assert.ok(typeof pair.textA === 'string' && typeof pair.textB === 'string');
      assert.ok(pair.provenance.docIds.length === 2);
      assert.ok(pair.provenance.sourceKindA && pair.provenance.sourceKindB);
    }
    // The receipt carries the filter's measured effect and the caveats.
    assert.ok(summary.receipt.knowledgeDensityFilter.coverageCorpusEffect.docs > 0);
    assert.ok(summary.receipt.knowledgeDensityFilter.coverageCorpusEffect.passRate > 0);
    assert.ok(summary.receipt.negativesCaveat.includes('teacher-claimed'));
    assert.ok(summary.receipt.lengthCueCaveat.includes('length cue'));
    // The overlay corpus is written in proof-ready shape.
    const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    assert.equal(overlay.kind, 'weft-private-unit-corpus');
    assert.equal(overlay.knowledgeUnits.length, 2);
    assert.equal(overlay.docs.length, 10);
    assert.ok(overlay.links.length > 0);
    // Files land where the receipt says.
    assert.ok(fs.existsSync(path.join(dir, 'ext-run', 'extension-pairs.jsonl')));
    assert.ok(fs.existsSync(path.join(dir, 'ext-run', 'receipt.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-EXT 5: people-free is enforced mechanically and chatter purity is the inverted filter', () => {
  const dir = tempDir();
  try {
    const calls = [];
    const corpusPath = writeTempCorpus(dir);
    const withIdentity = runExtension(PROFILE, {
      limit: 2,
      teacher: stubTeacher(calls, { complianceIdentity: true }),
      corpusPath,
      outDir: path.join(dir, 'ext-identity'),
      overlayPath: path.join(dir, 'overlay.json'),
    });
    // Both compliance classes drop their pairs when identities appear.
    assert.equal(withIdentity.receipt.counts.sourceDisjointCompliancePositive, 0);
    assert.equal(withIdentity.receipt.counts.complianceNearRequirementNegative, 0);
    assert.equal(withIdentity.receipt.counts.droppedPeoplePresent, 8); // 2 docs x 2 classes x 2 rounds

    const calls2 = [];
    const chatty = runExtension(PROFILE, {
      limit: 2,
      teacher: stubTeacher(calls2, { chatterText: KNOWLEDGE_TEXT }),
      corpusPath,
      outDir: path.join(dir, 'ext-chatty'),
      overlayPath: path.join(dir, 'overlay2.json'),
    });
    // Chatter that passes the knowledge threshold is a class violation: dropped.
    assert.equal(chatty.receipt.counts.nonKnowledgeNegative, 0);
    assert.equal(chatty.receipt.counts.nonKnowledgeVsKnowledgeNegative, 0);
    assert.ok(chatty.receipt.counts.droppedChatterDensity > 0);
    // The private units still landed (their class is unaffected).
    assert.equal(chatty.receipt.counts.privateUnitPositive, 20);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-EXT 6: a malformed private unit is dropped whole, never partially emitted', () => {
  const dir = tempDir();
  try {
    const calls = [];
    const corpusPath = writeTempCorpus(dir);
    const broken = runExtension(PROFILE, {
      limit: 1,
      teacher: stubTeacher(calls, { brokenUnitSourceKind: true }),
      corpusPath,
      outDir: path.join(dir, 'ext-broken'),
      overlayPath: path.join(dir, 'overlay.json'),
    });
    assert.equal(broken.receipt.counts.droppedUnitShape, 2); // both units broken the same way
    assert.equal(broken.receipt.counts.privateUnitPositive, 0);
    assert.equal(broken.receipt.counts.privateUnitCrossNegative, 0);
    // No overlay is written when no unit survived.
    assert.equal(broken.overlay, null);
    assert.equal(fs.existsSync(path.join(dir, 'overlay.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-EXT 7: config fail-closed: limit, unknown profile, and the api-only licence gate', () => {
  const dir = tempDir();
  try {
    const corpusPath = writeTempCorpus(dir);
    assert.throws(() => runExtension(PROFILE, { limit: 0, teacher: stubTeacher([]), corpusPath }), WeftExtensionConfigError);
    assert.throws(() => runExtension('no-such-profile', { limit: 1, teacher: stubTeacher([]), corpusPath }), WeftExtensionConfigError);
    const localStub = { kind: 'local', licence: 'other', usage: { calls: 0 }, complete() { throw new Error('must not be called'); } };
    assert.throws(() => runExtension(PROFILE, { limit: 1, teacher: localStub, corpusPath }), WeftTeacherUnavailableError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureOverlay() {
  const mk = (n, unitId) => ({
    id: `pu-x-${unitId.slice(-1)}-${n}`,
    format: n === 0 ? 'memo' : 'email',
    sourceKind: n === 0 ? 'memo' : 'thread',
    department: 'clinical',
    theme: 'warehouse safety inspection',
    text: `Confidential process step ${n} for unit ${unitId} requires 12 hours of calibration before every batch.`,
    identities: [{ key: `e-${n}`, surface: `Person ${n}`, class: 'person' }],
    source: 'synthetic-estate',
    knowledgeUnitId: unitId,
    confidential: true,
  });
  return {
    kind: 'weft-private-unit-corpus',
    profile: 'hospital-network',
    seed: 20261130,
    docs: [mk(1, 'private-unit-x-1'), mk(2, 'private-unit-x-1'), mk(3, 'private-unit-x-2'), mk(4, 'private-unit-x-2')],
    links: [
      { a: 'pu-x-1-1', b: 'pu-x-1-2', type: 'thread' },
      { a: 'pu-x-2-3', b: 'pu-x-2-4', type: 'thread' },
    ],
    knowledgeUnits: [
      { id: 'private-unit-x-1', theme: 'warehouse safety inspection', confidential: true, docIds: ['pu-x-1-1', 'pu-x-1-2'], provenance: 'teacher-generated-private-unit' },
      { id: 'private-unit-x-2', theme: 'warehouse safety inspection', confidential: true, docIds: ['pu-x-2-3', 'pu-x-2-4'], provenance: 'teacher-generated-private-unit' },
    ],
  };
}

test('W-EXT 8: the regenerate-minus-unit byte-diff receipt proves the footprint and only the footprint', () => {
  const dir = tempDir();
  try {
    const corpusPath = path.join(dir, 'overlay.json');
    fs.writeFileSync(corpusPath, JSON.stringify(fixtureOverlay()) + '\n');
    const { receipt, regeneratedText } = buildErasureReceipt(corpusPath, 'private-unit-x-1', path.join(dir, 'minus.json'));
    assert.deepEqual(receipt.removed.docs, ['pu-x-1-1', 'pu-x-1-2']);
    assert.equal(receipt.removed.linkCount, 1);
    assert.equal(receipt.retained.docs, 2);
    assert.equal(receipt.retained.knowledgeUnits, 1);
    assert.ok(receipt.firstDiffOffset >= 0);
    assert.equal(receipt.unchangedBytesAssertion.verified, true);
    assert.equal(receipt.unchangedBytesAssertion.unchangedDocs, 2);
    assert.ok(receipt.sha256.before !== receipt.sha256.after);
    assert.ok(receipt.bytes.after < receipt.bytes.before);
    // The regenerated artifact parses and keeps the other unit intact.
    const regenerated = JSON.parse(regeneratedText);
    assert.equal(regenerated.docs[0].knowledgeUnitId, 'private-unit-x-2');
    // Determinism: the second run produces the identical receipt digests.
    const again = buildErasureReceipt(corpusPath, 'private-unit-x-1', null);
    assert.equal(again.receipt.sha256.after, receipt.sha256.after);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-EXT 9: the erasure proof fails closed on unknown units and inconsistent footprints', () => {
  const overlay = fixtureOverlay();
  assert.throws(() => regenerateCorpusMinusUnit(overlay, 'private-unit-x-9'), WeftErasureProofError);
  assert.throws(() => regenerateCorpusMinusUnit({}, 'private-unit-x-1'), WeftErasureProofError);
  const inconsistent = fixtureOverlay();
  inconsistent.docs[2].knowledgeUnitId = 'private-unit-x-1'; // doc claims a unit that does not claim it
  assert.throws(() => regenerateCorpusMinusUnit(inconsistent, 'private-unit-x-1'), WeftErasureProofError);
  // A pre-existing dangling link in the original (an endpoint doc that does not
  // exist) is the reachable path for the retained-link check: regenerating any
  // unit must fail closed rather than carry the dangling link forward.
  const dangling = fixtureOverlay();
  dangling.links.push({ a: 'pu-x-2-3', b: 'pu-x-2-404', type: 'thread' });
  assert.throws(
    () => regenerateCorpusMinusUnit(dangling, 'private-unit-x-1'),
    (err) => err instanceof WeftErasureProofError && err.reason === 'dangling-link'
  );
  // The retained link referencing the removed doc is a typed failure at receipt time.
  assert.throws(
    () => {
      const dir = tempDir();
      try {
        const corpusPath = path.join(dir, 'overlay.json');
        fs.writeFileSync(corpusPath, JSON.stringify(dangling) + '\n');
        buildErasureReceipt(corpusPath, 'private-unit-x-1', null);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    (err) => err instanceof WeftErasureProofError && err.reason === 'dangling-link'
  );
});
