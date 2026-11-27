import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LICENCE_AUDIT,
  OUT_AUDIT,
  OUT_DIR,
  PAIR_POLICY,
  WeftTeacherUnavailableError,
  compileWeftTrainingPairs,
  fixtureCorpus,
  generateTeacherEstates,
  resolveLocalTeacher,
  runWeftTrainingPairArtifacts,
  writeLicenceAudit,
} from '../scripts/build-weft-training-pairs.mjs';

// W2 — training-data compilation and licence audit gate. External-behavior tests only:
// audit artifact schema, pair types with labels and provenance, non-permissive drops, and
// the fail-closed teacher path. No LLM runtime is available or required.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAIR_TYPES = [
  'identity-masked-positive',
  'identity-matched-theme-different-negative',
  'identity-disjoint-same-theme-positive',
];
const AUGMENTATION_KINDS = ['asr', 'ocr', 'slide-fragmentation'];

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function linesOf(jsonl) {
  return String(jsonl).split('\n').filter(Boolean);
}

function pairId(type, docIds) {
  return sha256Hex(`weft-pair\u0000${type}\u0000${[...docIds].sort().join('\u0000')}`);
}

function auditById() {
  return new Map(LICENCE_AUDIT.sources.map((s) => [s.id, s]));
}

function docById(corpus) {
  return new Map(corpus.docs.map((d) => [d.id, d]));
}

test('W2 1: licence audit artifact — complete schema, all three statuses, verified drop reasons', () => {
  assert.ok(fs.existsSync(OUT_AUDIT), 'the audit artifact must be committed at results/weft-licence-audit.json');
  const artifact = JSON.parse(fs.readFileSync(OUT_AUDIT, 'utf8'));
  // Append-only: later tickets (W-Data) may append teacher entries; the original W2 entries must stay unchanged.
  assert.deepEqual({ ...artifact, sources: artifact.sources.slice(0, LICENCE_AUDIT.sources.length) }, LICENCE_AUDIT,
    'the committed artifact must retain the exported audit unchanged (appended entries allowed)');
  assert.ok(artifact.sources.length >= LICENCE_AUDIT.sources.length, 'appends are allowed, rewrites are not');
  assert.equal(artifact.schemaVersion, '1.0');
  assert.equal(artifact.kind, 'weft-licence-audit');
  assert.equal(artifact.policy, 'weft-licence-v1');
  assert.deepEqual(artifact.statusValues, ['green', 'dropped', 'unverified']);
  assert.ok(artifact.auditBasis.includes('2026-11-27-weft-novelty-recheck-and-licence-audit.md'), 'the audit must name its research basis');
  assert.ok(Array.isArray(artifact.sources) && artifact.sources.length >= 6);

  const statuses = new Set();
  for (const source of artifact.sources) {
    for (const field of ['id', 'name', 'kind', 'licence', 'terms', 'status', 'usedInRecipe', 'verifiedFrom', 'releaseConsequence']) {
      assert.ok(source[field] !== undefined && source[field] !== '', `source ${source.id} must record ${field}`);
    }
    assert.ok(artifact.statusValues.includes(source.status), `source ${source.id} has an unknown status ${source.status}`);
    statuses.add(source.status);
    if (source.status === 'green') {
      assert.notEqual(source.licence, 'unverified', `green source ${source.id} must have a verified licence`);
      assert.equal(source.usedInRecipe, true, `green source ${source.id} is admitted to the recipe`);
    } else {
      assert.equal(source.usedInRecipe, false, `non-green source ${source.id} must not enter the recipe`);
    }
  }
  assert.deepEqual([...statuses].sort(), ['dropped', 'green', 'unverified'], 'the audit must record every status class');

  const byId = auditById();
  for (const id of ['wikipedia-dumps', 'multi-news', 'wec-eng', 'ecb-plus', 'ucdcr', 'needle-3', 'teacher']) {
    assert.ok(byId.has(id), `the audit must cover ${id}`);
  }

  const wikipedia = byId.get('wikipedia-dumps');
  assert.equal(wikipedia.status, 'green');
  assert.equal(wikipedia.licence, 'CC-BY-SA-4.0');
  assert.equal(wikipedia.releaseConstraint, 'share-alike');
  assert.match(wikipedia.releaseConsequence, /share-alike/i, 'the released-dataset share-alike implication must be recorded');

  const multiNews = byId.get('multi-news');
  assert.equal(multiNews.status, 'dropped');
  assert.equal(multiNews.usedInRecipe, false);
  assert.match(multiNews.verifiedFrom, /non-commercial/i);
  assert.match(multiNews.terms, /LILY Lab/i);
  assert.match(multiNews.verifiedFrom, /no IP licence/i);

  for (const id of ['wec-eng', 'ecb-plus', 'ucdcr', 'needle-3']) {
    assert.equal(byId.get(id).status, 'unverified', `${id} remains unverified until primary terms are read`);
    assert.equal(byId.get(id).usedInRecipe, false);
  }

  assert.equal(byId.get('teacher').status, 'unverified');
  assert.equal(artifact.teacherPolicy.chosenTeacher, null, 'no teacher licence is verified in this audit');
  assert.equal(artifact.teacherPolicy.status, 'unverified');
  assert.ok(artifact.teacherPolicy.barred.some((b) => /OpenAI-hosted/.test(b)), 'OpenAI-hosted teachers must be barred');
  assert.ok(artifact.teacherPolicy.allowedLicences.includes('apache-2.0'));
  assert.ok(!artifact.teacherPolicy.allowedLicences.includes('gemma'), 'bespoke Gemma terms are not on the permissive allowlist');
});

test('W2 2: three pair types — labels, provenance, identity masking, and augmentations', () => {
  const corpus = fixtureCorpus();
  const docs = docById(corpus);
  const audit = auditById();
  const a = compileWeftTrainingPairs(corpus);
  const b = compileWeftTrainingPairs(corpus);

  assert.equal(a.trainJsonl, b.trainJsonl, 'two identical compiles must be byte-identical');
  assert.equal(a.evalJsonl, b.evalJsonl);
  assert.deepEqual(a.receipt, b.receipt);
  assert.equal(a.receipt.policy, PAIR_POLICY);
  assert.equal(a.receipt.mode, 'fixture');
  assert.equal(a.receipt.generator, 'fixture');
  assert.ok(a.receipt.pairCount >= 6, `the fixture must yield a usable slice, got ${a.receipt.pairCount}`);
  assert.ok(a.receipt.trainCount >= 1 && a.receipt.evalCount >= 1, 'both a train and a hand-checkable eval slice are emitted');
  assert.equal(a.receipt.trainCount + a.receipt.evalCount, a.receipt.pairCount);

  for (const type of PAIR_TYPES) {
    assert.ok(a.receipt.byType[type] >= 1, `the fixture must produce pair type ${type}`);
  }
  assert.equal(a.receipt.byLabel.positive + a.receipt.byLabel.negative, a.receipt.pairCount);

  const ids = a.pairs.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'pair ids must be unique');
  assert.deepEqual(ids, [...ids].sort(), 'pairs must be fixed-ordered by id');
  assert.equal(a.receipt.pairJsonlSha256, sha256Hex(a.trainJsonl + a.evalJsonl), 'the receipt pins the written bytes');

  for (const p of a.pairs) {
    assert.equal(p.policy, PAIR_POLICY);
    assert.equal(p.id, pairId(p.pairType, p.provenance.docIds), 'pair ids are pinned content digests');
    assert.equal(p.label, p.pairType === 'identity-matched-theme-different-negative' ? 'negative' : 'positive');
    assert.deepEqual(p.provenance.docIds, [...p.provenance.docIds].sort(), 'doc ids are canonical-ordered');
    for (const source of p.provenance.sources) {
      assert.equal(audit.get(source).status, 'green', `pair ${p.id} must derive only from green sources`);
      assert.equal(p.provenance.sourceStatuses[source], 'green');
    }
    assert.equal(p.provenance.augmentation === null, !AUGMENTATION_KINDS.includes(p.provenance.augmentation));

    const [da, db] = p.provenance.docIds.map((id) => docs.get(id));
    const [themeA, themeB] = p.provenance.themes;
    if (p.pairType === 'identity-masked-positive') {
      assert.equal(themeA, themeB, 'a structural positive links documents of one theme');
      const surfaces = [...da.identities, ...db.identities].map((i) => i.surface);
      assert.ok(surfaces.length > 0);
      for (const surface of surfaces) {
        assert.ok(!p.textA.includes(surface), `masked positive ${p.id} leaks identity ${surface} on side A`);
        assert.ok(!p.textB.includes(surface), `masked positive ${p.id} leaks identity ${surface} on side B`);
      }
      assert.match(p.textA, /\[[a-zA-Z]+_\d+\]/, 'side A carries role tokens');
      assert.match(p.textB, /\[[a-zA-Z]+_\d+\]/, 'side B carries role tokens');
      assert.ok(p.provenance.identityOverlap >= 1);
      assert.ok(p.provenance.maskedIdentityCount >= 1);
    } else if (p.pairType === 'identity-matched-theme-different-negative') {
      assert.notEqual(themeA, themeB, 'the signature negative shares identity but differs in theme');
      assert.ok(p.provenance.identityOverlap >= 1, 'the hard negative must share at least one identity');
      assert.equal(p.provenance.identityDisjoint, false);
    } else {
      assert.equal(themeA, themeB, 'the identity-disjoint positive shares a theme');
      assert.equal(p.provenance.identityOverlap, 0);
      assert.equal(p.provenance.identityDisjoint, true);
    }
  }

  for (const kind of AUGMENTATION_KINDS) {
    assert.ok(a.receipt.augmentations[kind] >= 1, `the fixture must exercise the ${kind} augmentation`);
  }

  // The signature negative is observable in the fixture: same person, budget vs offsite.
  const signature = a.pairs.find(
    (p) => p.pairType === 'identity-matched-theme-different-negative' && p.provenance.docIds.includes('fin-email') && p.provenance.docIds.includes('sales-ticket')
  );
  assert.ok(signature, 'the fixture must contain the same-person theme-different negative');
  assert.equal(signature.label, 'negative');
});

test('W2 3: non-permissive sources — zero pairs derived, dropped and unverified recorded', () => {
  const corpus = structuredClone(fixtureCorpus());
  corpus.docs.push(
    {
      id: 'news-1',
      source: 'multi-news',
      format: 'email',
      department: 'news',
      theme: 'quarterly-budget-planning',
      text: 'A news digest about the quarterly budget planning cycle.',
      identities: [{ key: 'org:harrow-logistics', surface: 'Harrow Logistics Ltd', class: 'org' }],
    },
    {
      id: 'wec-1',
      source: 'wec-eng',
      format: 'ticket',
      department: 'news',
      theme: 'quarterly-budget-planning',
      text: 'An event coreference document about the quarterly budget planning cycle.',
      identities: [],
    },
    {
      id: 'rogue-1',
      source: 'not-in-audit',
      format: 'text',
      department: 'unknown',
      theme: 'quarterly-budget-planning',
      text: 'A document from a source absent from the licence audit.',
      identities: [],
    }
  );
  corpus.links.push(
    { a: 'fin-email', b: 'news-1', type: 'hyperlink' },
    { a: 'fin-email', b: 'wec-1', type: 'hyperlink' },
    { a: 'fin-email', b: 'rogue-1', type: 'hyperlink' }
  );

  const compiled = compileWeftTrainingPairs(corpus);
  const usedSources = new Set(compiled.pairs.flatMap((p) => p.provenance.sources));
  assert.deepEqual([...usedSources], ['synthetic-estate'], 'only the green source may appear in pair provenance');
  assert.equal(compiled.pairs.filter((p) => p.provenance.sources.some((s) => ['multi-news', 'wec-eng', 'not-in-audit'].includes(s))).length, 0);

  assert.equal(compiled.receipt.rejected['multi-news'].status, 'dropped');
  assert.ok(compiled.receipt.rejected['multi-news'].count >= 1);
  assert.equal(compiled.receipt.rejected['wec-eng'].status, 'unverified');
  assert.ok(compiled.receipt.rejected['wec-eng'].count >= 1);
  assert.equal(compiled.receipt.rejected['not-in-audit'].status, 'unknown');
  assert.deepEqual(compiled.receipt.usedSources, { 'synthetic-estate': 'green' });
});

test('W2 4: teacher path is fail-closed — typed error, no fixture fallback, policy bars enforced', () => {
  const absent = () => resolveLocalTeacher({});
  assert.throws(absent, (err) => err instanceof WeftTeacherUnavailableError && err.code === 'WEFT_TEACHER_UNAVAILABLE' && err.reason === 'runtime-absent');

  assert.throws(
    () => resolveLocalTeacher({ WEFT_TEACHER_CMD: 'llama-cli' }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'licence-absent'
  );
  assert.throws(
    () => resolveLocalTeacher({ WEFT_TEACHER_CMD: 'llama-cli', WEFT_TEACHER_LICENCE: 'gemma' }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'licence-not-permissive'
  );
  assert.throws(
    () => resolveLocalTeacher({ WEFT_TEACHER_URL: 'https://api.openai.com/v1', WEFT_TEACHER_LICENCE: 'apache-2.0' }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'openai-barred'
  );
  assert.throws(
    () => resolveLocalTeacher({ WEFT_TEACHER_URL: 'http://127.0.0.1:8080', WEFT_TEACHER_LICENCE: 'apache-2.0' }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'http-adapter-absent'
  );

  const runtime = resolveLocalTeacher({ WEFT_TEACHER_CMD: 'llama-cli', WEFT_TEACHER_LICENCE: 'apache-2.0' });
  assert.equal(runtime.licence, 'apache-2.0');
  assert.equal(typeof runtime.complete, 'function');

  assert.throws(
    () => generateTeacherEstates({ licence: 'gemma', complete: () => '{}' }, {}),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'licence-not-permissive'
  );

  // Live compilation without a resolved local teacher must throw, never fall back to fixtures.
  assert.throws(
    () => compileWeftTrainingPairs(fixtureCorpus(), { mode: 'live' }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'runtime-absent'
  );
});

test('W2 5: artifacts end to end — JSONL + receipt + audit, deterministic, committed baseline current', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-pairs-'));
  try {
    const initial = runWeftTrainingPairArtifacts({ outDir: tmp, writeAudit: false });
    for (const file of ['train.jsonl', 'eval.jsonl', 'receipt.json']) {
      assert.ok(fs.existsSync(path.join(tmp, file)), `the runner must write ${file}`);
    }
    const receipt = JSON.parse(fs.readFileSync(path.join(tmp, 'receipt.json'), 'utf8'));
    assert.equal(linesOf(fs.readFileSync(path.join(tmp, 'train.jsonl'), 'utf8')).length, receipt.trainCount);
    assert.equal(linesOf(fs.readFileSync(path.join(tmp, 'eval.jsonl'), 'utf8')).length, receipt.evalCount);
    assert.equal(receipt.evalPairIds.length, receipt.evalCount);

    const auditPath = path.join(tmp, 'weft-licence-audit.json');
    writeLicenceAudit(auditPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(auditPath, 'utf8')), LICENCE_AUDIT);

    const second = runWeftTrainingPairArtifacts({ outDir: tmp, writeAudit: false });
    assert.equal(JSON.stringify(initial.receipt), JSON.stringify(second.receipt), 'the runner must be deterministic run-to-run');
    assert.equal(initial.trainJsonl, second.trainJsonl);

    // The committed baseline must be exactly what a fresh fixture compile produces.
    // git autocrlf smudges checked-out files to CRLF on Windows; compare LF-normalized content.
    const committedTrain = fs.readFileSync(path.join(OUT_DIR, 'train.jsonl'), 'utf8').replaceAll('\r\n', '\n');
    const committedEval = fs.readFileSync(path.join(OUT_DIR, 'eval.jsonl'), 'utf8').replaceAll('\r\n', '\n');
    const committedReceipt = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'receipt.json'), 'utf8'));
    assert.equal(committedTrain, initial.trainJsonl, 'committed train.jsonl is stale; rerun the fixture compiler');
    assert.equal(committedEval, initial.evalJsonl, 'committed eval.jsonl is stale; rerun the fixture compiler');
    assert.deepEqual(committedReceipt, initial.receipt, 'committed receipt.json is stale; rerun the fixture compiler');

    const types = new Set(
      [...linesOf(committedTrain), ...linesOf(committedEval)].map((line) => JSON.parse(line).pairType)
    );
    for (const type of PAIR_TYPES) assert.ok(types.has(type), `committed artifacts must contain ${type}`);
    assert.equal(committedReceipt.evalCount > 0, true, 'the committed evaluation slice must not be empty');
    assert.equal(path.relative(ROOT, OUT_DIR).replace(/\\/g, '/'), 'results/weft-training-pairs');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('W2 6: opt-in recipe flags — disjoint negatives emitted, within-chunk pairs excluded, defaults untouched', () => {
  const doc = (id, theme, key) => ({
    id,
    source: 'synthetic-estate',
    format: 'text',
    department: 'ops',
    theme,
    text: `A document about ${theme} mentioning ${key}.`,
    identities: [{ key, surface: key.toUpperCase(), class: 'person' }],
  });
  // Two single-theme chunks: budget-c1 and travel-c2. The within-chunk pairs are
  // the style shortcut the live recipe taught the W4 run (#52).
  const corpus = {
    docs: [
      doc('budget-c1-doc-001', 'budget', 'emp-x'),
      doc('budget-c1-doc-002', 'budget', 'emp-y'),
      doc('travel-c2-doc-001', 'travel', 'emp-z'),
      doc('travel-c2-doc-002', 'travel', 'emp-x'),
    ],
    links: [],
  };
  const chunkOf = (id) => id.split('-doc-')[0];
  const pairsWith = (compiled, docId) => compiled.pairs.filter((p) => p.provenance.docIds.includes(docId));

  const plain = compileWeftTrainingPairs(corpus);
  assert.ok(
    plain.pairs.some((p) => p.provenance.docIds.join('|') === 'budget-c1-doc-001|budget-c1-doc-002'),
    'the default recipe still emits the within-chunk disjoint positive'
  );
  assert.ok(!plain.receipt.recipeOptions, 'the default recipe records no recipeOptions block');

  const fixed = compileWeftTrainingPairs(corpus, {
    includeDisjointNegatives: true,
    excludeWithinChunk: true,
  });
  for (const p of fixed.pairs) {
    const [a, b] = p.provenance.docIds;
    assert.notEqual(chunkOf(a), chunkOf(b), 'no within-chunk pair may survive the exclusion flag');
  }
  const disjointNegatives = fixed.pairs.filter((p) => p.pairType === 'identity-disjoint-theme-different-negative');
  assert.ok(disjointNegatives.length >= 2, 'the counterweight negative type is emitted');
  for (const p of disjointNegatives) assert.equal(p.label, 'negative');
  assert.ok(
    disjointNegatives.some((p) => p.provenance.docIds.join('|') === 'budget-c1-doc-001|travel-c2-doc-001'),
    'a disjoint cross-theme pair is now a negative'
  );
  assert.equal(pairsWith(fixed, 'travel-c2-doc-002').length > 0, true, 'matched negatives still flow');
  assert.deepEqual(fixed.receipt.recipeOptions, {
    includeDisjointNegatives: true,
    excludeWithinChunk: true,
    corpusProvided: false,
  });
});
