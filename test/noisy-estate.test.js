import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Noisy-estate benchmark (K4/K5 prep) — external-behavior-only tests per
// docs/2026-11-24-noisy-estate-benchmark-spec.md §8. The generator and the exact-match
// baseline scorer are run as child processes; the tests only read the artifacts.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/noisy-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
const GEN_SCRIPT = path.join(ROOT, 'scripts/gen-noisy-estate.mjs');
const BASELINE_SCRIPT = path.join(ROOT, 'scripts/noisy-estate-baseline.mjs');
const BASELINE_OUT = path.join(ROOT, 'results/noisy-estate-baseline.json');

function runGenerator() {
  execFileSync(process.execPath, [GEN_SCRIPT], { cwd: ROOT, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function runBaseline() {
  execFileSync(process.execPath, [BASELINE_SCRIPT], { cwd: ROOT, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(BASELINE_OUT, 'utf8'));
}

function listEstateFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(ESTATE_DIR, abs).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(ESTATE_DIR)) walk(ESTATE_DIR);
  return out.sort();
}

// Mirrors the recipe the manifest pins (estateSha256Recipe): sha-256 over the sorted
// document paths, each (path + NUL + file bytes + NUL).
function estateDigest() {
  const h = crypto.createHash('sha256');
  for (const rel of listEstateFiles()) {
    h.update(`${rel}\u0000`);
    h.update(fs.readFileSync(path.join(ESTATE_DIR, rel)));
    h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}

function docTextOf(manifest, rel) {
  return fs.readFileSync(path.join(ESTATE_DIR, rel), 'utf8');
}

test('K4prep 1: determinism — two generations are byte-identical and the manifest pins its estate SHA-256', () => {
  const m1 = runGenerator();
  const d1 = estateDigest();
  const manifestBytes1 = fs.readFileSync(MANIFEST_PATH);
  const m2 = runGenerator();
  const d2 = estateDigest();

  assert.equal(d1, d2, 'two seeded generations must produce byte-identical estate files');
  assert.ok(manifestBytes1.equals(fs.readFileSync(MANIFEST_PATH)), 'the manifest must also be byte-identical across generations');
  assert.equal(m2.estateSha256, d2, 'the manifest must pin the real estate SHA-256');
  assert.ok(typeof m2.estateSha256Recipe === 'string' && m2.estateSha256Recipe.length > 0, 'the manifest must document the sha recipe');
  assert.equal(m2.version, 'noisy-estate-v1', 'the noise floor is frozen at a version');
  assert.equal(m2.seed, 20261124, 'the estate is seeded');
  // no wallclock fields anywhere in the manifest
  assert.ok(!/generatedAt|createdAt|timestamp"/.test(JSON.stringify(m2)), 'the manifest must carry no wallclock fields');
  for (const doc of m2.documents) {
    assert.ok(!('generatedAt' in doc) && !('timestamp' in doc), 'documents must carry no wallclock fields');
  }
});

test('K4prep 2: coverage — spec counts hold, every person spans >=2 docs and >=2 modalities, every question is manifest-side answerable', () => {
  const m = runGenerator();

  assert.equal(m.world.people.length, 250, '250 people');
  assert.equal(m.world.collisionPairs.length, 20, '20 same-name collision pairs');
  assert.equal(m.world.sharedInboxes.length, 30, '30 shared inboxes');
  assert.equal(m.world.departments.length, 8, '8 departments');
  assert.equal(m.world.projects.length, 12, '12 projects');
  assert.equal(m.world.products.length, 10, '10 products');
  assert.equal(m.facts.length, 180, '180 facts');
  assert.equal(m.facts.filter((f) => f.singleDoc).length, 108, '60% of facts are single-document');
  assert.equal(m.facts.filter((f) => !f.singleDoc).length, 72, '40% of facts need 2+ documents');
  assert.equal(m.facts.filter((f) => f.promotion).length, 8, '8 promotion events');

  const byModality = {};
  for (const d of m.documents) byModality[d.modality] = (byModality[d.modality] || 0) + 1;
  assert.deepEqual(byModality, { roster: 10, email: 40, chat: 30, memo: 20, captions: 15 }, '~115 documents across the five spec simulators');
  assert.equal(m.documents.length, 115, '115 documents total');

  // person coverage from the mention map
  const docsOf = new Map(m.documents.map((d) => [d.path, d]));
  const personDocs = new Map(m.world.people.map((p) => [p.personId, new Map()]));
  for (const men of m.mentions) {
    const seen = personDocs.get(men.personId);
    assert.ok(seen, `a mention must reference a known person (${men.personId})`);
    seen.set(men.doc, docsOf.get(men.doc).modality);
  }
  for (const [pid, docs] of personDocs) {
    assert.ok(docs.size >= 2, `person ${pid} must appear in >=2 documents, got ${docs.size}`);
    assert.ok(new Set(docs.values()).size >= 2, `person ${pid} must appear in >=2 modalities`);
  }

  // collision pairs: same full name, distinct email/phone/department
  const personById = new Map(m.world.people.map((p) => [p.personId, p]));
  for (const pair of m.world.collisionPairs) {
    const [a, b] = pair.personIds.map((id) => personById.get(id));
    assert.equal(a.fullName, b.fullName, 'a collision pair shares the full name string');
    assert.notEqual(a.emails[0], b.emails[0], 'pair members have distinct emails');
    assert.notEqual(a.phone, b.phone, 'pair members have distinct phones');
    assert.notEqual(a.department, b.department, 'pair members have distinct departments');
  }

  // every question is answerable: the expected value appears in a cited doc and the
  // question's person is mentioned in every cited doc
  const strata = {};
  for (const q of m.questions) strata[q.stratum] = (strata[q.stratum] || 0) + 1;
  assert.deepEqual(strata, { Q1: 24, Q2: 24, Q3: 12 }, '60 questions across the Q1/Q2/Q3 strata');
  for (const q of m.questions) {
    assert.ok(q.docs.length >= 1, `${q.qid} cites its evidence documents`);
    const valueSeen = q.docs.some((d) => docTextOf(m, d).includes(q.expectedValue));
    assert.ok(valueSeen, `${q.qid} expected value "${q.expectedValue}" must appear in a cited document`);
    for (const d of q.docs) {
      assert.ok(
        m.mentions.some((men) => men.doc === d && men.personId === q.personId),
        `${q.qid} target person must be mentioned in every cited document (${d})`
      );
    }
  }
});

test('K4prep 3: binding trivial-baseline gate — exact-match pairwise recall <90% and >=1 false merge on the collision pairs', () => {
  runGenerator();
  const baseline = runBaseline();

  assert.ok(baseline.pairwise.recall < 0.9, `exact-match pairwise recall must be strictly below 0.9, got ${baseline.pairwise.recall}`);
  assert.ok(baseline.falseMerges.onCollisionPairs >= 1, `the baseline must commit >=1 false merge on the collision pairs, got ${baseline.falseMerges.onCollisionPairs}`);
  assert.ok(baseline.gate.recallBelow90 === true && baseline.gate.atLeastOneFalseMerge === true && baseline.gate.pass === true, 'the gate result must be recorded');
  assert.ok(baseline.counts.mentions > 500, `the estate must carry a real mention volume, got ${baseline.counts.mentions}`);
  assert.ok(baseline.bCubed.recall < 0.9, 'the floor must hold on B-cubed recall too');
});

test('K4prep 4: engine blindness — the generator and scorer import nothing from src/', () => {
  runGenerator(); // generation must not touch src/ to produce the estate
  const genSource = fs.readFileSync(GEN_SCRIPT, 'utf8');
  const baselineSource = fs.readFileSync(BASELINE_SCRIPT, 'utf8');
  for (const [name, src] of [['gen-noisy-estate.mjs', genSource], ['noisy-estate-baseline.mjs', baselineSource]]) {
    assert.ok(!src.includes('../src'), `${name} must contain no ../src reference`);
    assert.ok(!/from\s+['"][^'"]*src\//.test(src), `${name} must not import anything from src/`);
  }
  const imports = [...genSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
  for (const imp of imports) assert.ok(imp.startsWith('node:'), `the generator may only import node: builtins, got ${imp}`);
});

test('K4prep 5: noise map completeness — every recorded mention sits at its recorded span, all N1-N8 occur, roster rows are fully mention-keyed', () => {
  const m = runGenerator();
  const texts = new Map(m.documents.map((d) => [d.path, docTextOf(m, d.path)]));

  let corrupted = 0;
  const noiseTypes = new Set();
  for (const men of m.mentions) {
    const text = texts.get(men.doc);
    assert.ok(text !== undefined, `mention ${men.mentionId} references a real document`);
    assert.equal(text.slice(men.charStart, men.charEnd), men.surface, `mention ${men.mentionId} must sit at its recorded span`);
    if (men.noises.length > 0) {
      corrupted++;
      for (const n of men.noises) noiseTypes.add(n);
    }
  }
  assert.ok(corrupted >= 250, `the estate must carry >=250 corrupted (noise-mapped) mentions, got ${corrupted}`);
  for (const n of ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']) {
    assert.ok(noiseTypes.has(n), `noise type ${n} must occur in the noise map`);
  }

  // roster completeness: every roster data-row value cell is a recorded mention surface
  for (const doc of m.documents.filter((d) => d.format === 'csv')) {
    const lines = texts.get(doc.path).split('\n').filter((l) => l.includes(','));
    const rows = lines.slice(1).filter((l) => l && !l.startsWith('#'));
    const surfaces = new Set(m.mentions.filter((men) => men.doc === doc.path && men.kind === 'name').map((men) => men.surface));
    for (const row of rows) {
      const cells = row.split(',');
      assert.ok(surfaces.has(cells[0]), `roster ${doc.path} row name "${cells[0]}" must be recorded in the noise map`);
      assert.ok(
        m.mentions.some((men) => men.doc === doc.path && men.kind === 'email' && men.surface === cells[1]),
        `roster ${doc.path} row email must be recorded as an email mention`
      );
      assert.ok(
        m.mentions.some((men) => men.doc === doc.path && men.kind === 'phone' && men.surface === cells[2]),
        `roster ${doc.path} row phone must be recorded as a phone mention`
      );
    }
  }
});
