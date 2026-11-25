import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Open-estate external-validity benchmark (K6). External-behavior-only tests, mirroring
// test/noisy-estate.test.js: the generator and the exact-match baseline scorer run as
// child processes; the tests read only the artifacts. Foundational rulings enforced here:
// layered estate (layer R real identity, layer O overlay), honest noise-map bookkeeping,
// the binding trivial-baseline gate on layer O only, and a loud skip of everything Enron
// unless the archive and extracted maildir are provided on this machine.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/open-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/open-estate-manifest.json');
const GEN_SCRIPT = path.join(ROOT, 'scripts/gen-open-estate.mjs');
const BASELINE_SCRIPT = path.join(ROOT, 'scripts/open-estate-baseline.mjs');
const BASELINE_OUT = path.join(ROOT, 'results/open-estate-baseline.json');
const QMSUM_DIR = path.join(ROOT, '..', 'open-estate-downloads', 'qmsum', 'QMSum-main', 'data');
const QMSUM_SKIP = fs.existsSync(QMSUM_DIR)
  ? false
  : 'QMSum data directory not present on this machine (external corpus, not committed) - skipping loudly per the founder ruling';

function runGenerator(extraArgs = []) {
  const { OPEN_ESTATE_AMI_DIR: _a, OPEN_ESTATE_QMSUM_DIR: _q, ...env } = process.env;
  execFileSync(process.execPath, [GEN_SCRIPT, ...extraArgs], { cwd: ROOT, stdio: 'pipe', env });
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

// the scorer writes to a temp copy so a no-env suite run never rewrites the committed
// artifact (its conditional Enron aggregates exist only where the external slice does)
const BASELINE_TMP = path.join(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || '/tmp'), 'open-estate-baseline-')), 'open-estate-baseline.json');
function runBaseline() {
  execFileSync(process.execPath, [BASELINE_SCRIPT], {
    cwd: ROOT, stdio: 'pipe', env: { ...process.env, OPEN_ESTATE_BASELINE_OUT: BASELINE_TMP },
  });
  return JSON.parse(fs.readFileSync(BASELINE_TMP, 'utf8'));
}

// Text fixtures only (the audio files are excluded from the estate digest; they are
// pinned per-file in the manifest).
function listTextFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'audio') continue;
        walk(abs);
      } else out.push(path.relative(ESTATE_DIR, abs).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(ESTATE_DIR)) walk(ESTATE_DIR);
  return out.sort();
}

function textDigest() {
  const h = crypto.createHash('sha256');
  for (const rel of listTextFiles()) {
    h.update(`${rel}\u0000`);
    h.update(fs.readFileSync(path.join(ESTATE_DIR, rel)));
    h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}

function docTextOf(manifest, rel) {
  return fs.readFileSync(path.join(ESTATE_DIR, rel), 'utf8');
}

test('K6 1: determinism: two generations are byte-identical and the manifest pins its estate SHA-256 over the text fixtures', { skip: QMSUM_SKIP }, () => {
  const m1 = runGenerator();
  const d1 = textDigest();
  const manifestBytes1 = fs.readFileSync(MANIFEST_PATH);
  const m2 = runGenerator();
  const d2 = textDigest();

  assert.equal(d1, d2, 'two seeded generations must produce byte-identical text estate files');
  assert.ok(manifestBytes1.equals(fs.readFileSync(MANIFEST_PATH)), 'the manifest must also be byte-identical across generations');
  assert.equal(m2.estateSha256, d2, 'the manifest must pin the real estate SHA-256 (text fixtures)');
  assert.ok(typeof m2.estateSha256Recipe === 'string' && m2.estateSha256Recipe.length > 0, 'the manifest must document the sha recipe');
  assert.equal(m2.version, 'open-estate-v1', 'the estate is frozen at a version');
  assert.equal(m2.seed, 20261124, 'the estate is seeded');
  assert.ok(!/generatedAt|createdAt|timestamp"/.test(JSON.stringify(m2)), 'the manifest must carry no wallclock fields');
  // no Enron bytes (content) anywhere in the committed estate (founder ruling);
  // the manifest carries only the source pin (URL, license status, archive sha recipe)
  assert.ok(!fs.existsSync(path.join(ESTATE_DIR, 'enron')), 'the committed estate carries no Enron documents');
  assert.ok(!fs.existsSync(path.join(ESTATE_DIR, '../open-estate-enron-slice')), 'no Enron-derived slice inside the repository tree');
});

test('K6 2: coverage: layered estate counts, every overlay person spans >=2 docs and >=2 modalities, both layers labeled on every document', { skip: QMSUM_SKIP }, () => {
  const m = runGenerator();

  assert.equal(m.layerO.world.people.length, 60, '60 overlay-cast people');
  assert.equal(m.layerO.world.collisionPairs.length, 12, '12 same-name collision pairs');
  assert.equal(m.layerO.world.sharedInboxes.length, 12, '12 shared inboxes');
  assert.equal(m.layerO.facts.length, 48, '48 facts');
  assert.equal(m.layerO.facts.filter((f) => f.singleDoc).length, 29, '29 single-document facts');
  assert.equal(m.layerO.facts.filter((f) => !f.singleDoc).length, 19, '19 multi-document facts');
  assert.equal(m.layerO.facts.filter((f) => f.promotion).length, 3, '3 promotion events');

  // every document is labeled with its layer; no metric may mix them
  for (const d of [...m.layerR.documents, ...m.layerO.documents]) {
    assert.ok(['real', 'overlay'].includes(d.layer), `document ${d.path} must be labeled real or overlay, got ${d.layer}`);
  }
  assert.equal(m.layerO.documents.length, 31, '31 overlay documents');
  const byModality = {};
  for (const d of m.layerO.documents) byModality[d.modality] = (byModality[d.modality] || 0) + 1;
  assert.deepEqual(byModality, { email: 12, memo: 6, roster: 3, 'captions-overlay': 10 }, '5 simulators (roster x2 formats) across 31 overlay docs');

  // layer R: real AMI/ICSI transcripts with corpus-label truth
  assert.ok(m.layerR.documents.length >= 12, '>=8 AMI + >=4 ICSI real transcript docs');
  assert.ok(m.layerR.people.length >= 40, '>=40 meeting-speaker corpus entities');
  for (const p of m.layerR.people) {
    assert.ok(p.speakerLabel && p.meetingId && p.corpus, `layer R entity ${p.personId} is corpus-keyed (meeting + speaker label)`);
    assert.ok(p.docs.length >= 1, `layer R entity ${p.personId} appears in its transcript`);
  }

  // layer O person coverage from the mention map: >=2 docs, >=2 modalities
  const modOf = new Map(m.layerO.documents.map((d) => [d.path, d.modality]));
  const personDocs = new Map(m.layerO.world.people.map((p) => [p.personId, new Map()]));
  for (const men of m.layerO.mentions) {
    const seen = personDocs.get(men.personId);
    assert.ok(seen, `an overlay mention must reference a known person (${men.personId})`);
    seen.set(men.doc, modOf.get(men.doc));
  }
  for (const [pid, docs] of personDocs) {
    assert.ok(docs.size >= 2, `person ${pid} must appear in >=2 documents, got ${docs.size}`);
    assert.ok(new Set(docs.values()).size >= 2, `person ${pid} must appear in >=2 modalities`);
  }

  // collision pairs: same full name, distinct email/phone/department
  const personById = new Map(m.layerO.world.people.map((p) => [p.personId, p]));
  for (const pair of m.layerO.world.collisionPairs) {
    const [a, b] = pair.personIds.map((id) => personById.get(id));
    assert.equal(a.fullName, b.fullName, 'a collision pair shares the full name string');
    assert.notEqual(a.emails[0], b.emails[0], 'pair members have distinct emails');
    assert.notEqual(a.phone, b.phone, 'pair members have distinct phones');
    assert.notEqual(a.department, b.department, 'pair members have distinct departments');
  }

  // overlay facts are manifest-side answerable: an accepted value appears in every
  // routed doc (promotion facts render titleBefore in the pre-event doc)
  for (const f of m.layerO.facts) {
    assert.ok(f.docs.length >= 1, `${f.factId} cites its evidence documents`);
    const accepted = f.promotion ? [f.value, f.promotion.titleBefore] : [f.value];
    for (const d of f.docs) {
      assert.ok(accepted.some((v) => docTextOf(m, d).includes(String(v))), `${f.factId} accepted value (${accepted.join(' / ')}) must appear in ${d}`);
      assert.ok(
        m.layerO.mentions.some((men) => men.doc === d && men.personId === f.personId),
        `${f.factId} target person must be mentioned in every cited document (${d})`
      );
    }
  }

  // audio honesty: audio records never claim overlay; participants are corpus ids
  for (const rec of m.externalSources.amiAudio.meetings) {
    assert.ok(rec.meetingId && rec.rel, 'each audio record pins its meeting');
    for (const part of rec.participants) {
      assert.ok(part.participantId && part.role && part.channel !== undefined, `audio ${rec.meetingId} participants are corpus-keyed`);
    }
  }
});

test('K6 3: binding trivial-baseline gate on layer O: exact-match pairwise recall <90% and >=1 false merge on the collision pairs; layer R reported ungated', { skip: QMSUM_SKIP }, () => {
  runGenerator();
  const baseline = runBaseline();

  const o = baseline.layers.layerO;
  assert.ok(o.pairwise.recall < 0.9, `exact-match pairwise recall on layer O must be strictly below 0.9, got ${o.pairwise.recall}`);
  assert.ok(o.falseMerges.onCollisionPairs >= 1, `the baseline must commit >=1 false merge on the collision pairs, got ${o.falseMerges.onCollisionPairs}`);
  assert.ok(o.gate.recallBelow90 === true && o.gate.atLeastOneFalseMerge === true && o.gate.pass === true, 'the layer O gate result must be recorded');
  assert.ok(o.scoring.mentions > 300, `layer O must carry a real mention volume, got ${o.scoring.mentions}`);
  assert.ok(o.bCubed.recall < 0.9, 'the layer O floor must hold on B-cubed recall too');

  // layer R is reported as-is, never gated (no metric mixes layers)
  const r = baseline.layers.layerR;
  assert.ok(r.gate.applicable === false, 'layer R carries the gate as not applicable');
  assert.ok(r.pairwise.recall >= 0 && r.pairwise.recall <= 1, 'layer R pairwise recall is a real number, reported as-is');

  const g = baseline.gate;
  assert.ok(g.recallBelow90 === true && g.atLeastOneFalseMerge === true && g.pass === true, 'the top-level gate mirrors layer O');
  // the enron section is present and unconditionally conditional
  assert.ok(baseline.enron, 'the results file records the conditional Enron-slice status');
});

test('K6 4: engine blindness: the generator and scorer import nothing from src/ and fetch nothing', () => {
  if (!QMSUM_SKIP) runGenerator(); // generation must not touch src/ to produce the estate
  const genSource = fs.readFileSync(GEN_SCRIPT, 'utf8');
  const baselineSource = fs.readFileSync(BASELINE_SCRIPT, 'utf8');
  for (const [name, src] of [['gen-open-estate.mjs', genSource], ['open-estate-baseline.mjs', baselineSource]]) {
    assert.ok(!src.includes('../src'), `${name} must contain no ../src reference`);
    assert.ok(!/from\s+['"][^'"]*src\//.test(src), `${name} must not import anything from src/`);
    assert.ok(!/require\(\s*['"]?(http|https|node-fetch|axios|undici)/.test(src), `${name} must make no network calls`);
    assert.ok(!/\bfetch\(/.test(src), `${name} must make no fetch() calls`);
  }
  const imports = [...genSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
  for (const imp of imports) assert.ok(imp.startsWith('node:'), `the generator may only import node: builtins, got ${imp}`);
  const imports2 = [...baselineSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((x) => x[1]);
  for (const imp of imports2) assert.ok(imp.startsWith('node:'), `the scorer may only import node: builtins, got ${imp}`);
});

test('K6 5: noise and span completeness on layer O: every recorded mention sits at its recorded span, all N1-N8 occur, roster rows are fully mention-keyed; layer R spans hold with no overlay', { skip: QMSUM_SKIP }, () => {
  const m = runGenerator();
  const texts = new Map(m.layerO.documents.map((d) => [d.path, docTextOf(m, d.path)]));

  let corrupted = 0;
  const noiseTypes = new Set();
  for (const men of m.layerO.mentions) {
    const text = texts.get(men.doc);
    assert.ok(text !== undefined, `overlay mention ${men.mentionId} references a real document`);
    assert.equal(text.slice(men.charStart, men.charEnd), men.surface, `overlay mention ${men.mentionId} must sit at its recorded span`);
    if (men.noises.length > 0) {
      corrupted++;
      for (const n of men.noises) noiseTypes.add(n);
    }
  }
  assert.ok(corrupted >= 150, `layer O must carry a substantial corrupted (noise-mapped) mention set, got ${corrupted}`);
  for (const n of ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']) {
    assert.ok(noiseTypes.has(n), `noise type ${n} must occur in the layer O noise map (had: ${[...noiseTypes].join(',')})`);
  }

  // roster completeness: every roster data-row value cell is a recorded mention surface
  for (const doc of m.layerO.documents.filter((d) => d.format === 'csv' || d.format === 'sql')) {
    const text = texts.get(doc.path);
    const surfacesEmail = new Set(
      m.layerO.mentions.filter((men) => men.doc === doc.path && men.kind === 'email').map((men) => men.surface)
    );
    const surfacesPhone = new Set(
      m.layerO.mentions.filter((men) => men.doc === doc.path && men.kind === 'phone').map((men) => men.surface)
    );
    const surfacesName = new Set(
      m.layerO.mentions.filter((men) => men.doc === doc.path && men.kind === 'name').map((men) => men.surface)
    );
    const rows = doc.format === 'csv'
      ? text.split('\n').filter((l) => l.includes(',')).slice(1)
      : [...text.matchAll(/INSERT INTO roster VALUES \('([^']*)', ([^,]*), ([^,]*), '[^']*', /g)].map((mm) => [mm[1], mm[2], mm[3]]);
    for (const rowLine of rows) {
      const cells = Array.isArray(rowLine) ? rowLine : rowLine.split(',');
      assert.ok(surfacesName.has(cells[0]), `roster ${doc.path} row name "${cells[0]}" must be recorded in the noise map (full row: ${rowLine})`);
      assert.ok(surfacesEmail.has(cells[1]), `roster ${doc.path} row email "${cells[1]}" must be recorded as an email mention`);
      assert.ok(surfacesPhone.has(cells[2]), `roster ${doc.path} row phone "${cells[2]}" must be recorded as a phone mention`);
    }
  }

  // layer R spans hold; layer R mentions carry no overlay noise
  const textsR = new Map(m.layerR.documents.map((d) => [d.path, docTextOf(m, d.path)]));
  for (const men of m.layerR.mentions) {
    const text = textsR.get(men.doc);
    assert.ok(text !== undefined, `layer R mention ${men.mentionId} references a real document`);
    assert.equal(text.slice(men.charStart, men.charEnd), men.surface, `layer R mention ${men.mentionId} must sit at its recorded span`);
    assert.equal(men.noises.length, 0, 'layer R mentions carry no overlay noise (corpus labels, as-is)');
  }
});

// Enron: the founder ruling is that Enron work happens on this machine with the archive
// present, and nothing Enron is committed. Without the archive the tests skip loudly so
// the absence is visible, not silently green.
const ENRON_ARCHIVE_PATH = process.env.OPEN_ESTATE_ENRON_ARCHIVE || '';
const ENRON_EXTRACTED_PATH = process.env.OPEN_ESTATE_ENRON_EXTRACTED || '';
const ENRON_SLICE_OUT = process.env.OPEN_ESTATE_ENRON_SLICE_OUT || path.join(ENRON_EXTRACTED_PATH || '/tmp', '..', 'open-estate-enron-slice-k6');

test('K6 6 (conditional): Enron slice: generated only outside the repository and aggregated only', { skip: !ENRON_ARCHIVE_PATH || !ENRON_EXTRACTED_PATH ? 'Enron archive/extracted dir not provided on this machine (OPEN_ESTATE_ENRON_* env vars) - skipping loudly per the founder ruling' : false }, () => {
  // the generator carries the Enron slice behind an explicit flag; nothing runs without it
  const m = runGenerator();
  assert.ok(!JSON.stringify(m).includes('maildir'), 'the committed manifest never references Enron internals beyond the source pin');

  const outDir = path.join(ENRON_SLICE_OUT + '-' + Date.now().toString(36));
  const { OPEN_ESTATE_ENRON_SLICE: drop, ...cleanEnv } = process.env;
  execFileSync(process.execPath, [
    GEN_SCRIPT,
    '--enron', ENRON_EXTRACTED_PATH,
    '--enron-out', outDir,
    '--enron-archive', ENRON_ARCHIVE_PATH,
  ], { cwd: ROOT, stdio: 'pipe', env: cleanEnv });
  const slice = JSON.parse(fs.readFileSync(path.join(outDir, 'open-estate-enron-slice-manifest.json'), 'utf8'));
  assert.equal(slice.kind, 'open-estate-enron-slice-manifest');
  assert.ok(slice.selection.mailboxes === 36, '36 mailboxes selected');
  assert.ok(slice.selection.excerpts >= 60, 'a real quoted-body pool (>=60 excerpts)');
  assert.ok(slice.mentions.length > 200, 'the slice carries a real mention volume');
  assert.ok(!outDir.startsWith(ROOT) && !outDir.includes('fixtures'), `the Enron slice must be written outside the repository, got ${outDir}`);
  // aggregator-side: scoring the slice works and stays aggregate
  const tmpOut = path.join(outDir, 'baseline.json');
  execFileSync(process.execPath, [BASELINE_SCRIPT], {
    cwd: ROOT, stdio: 'pipe',
    env: { ...cleanEnv, OPEN_ESTATE_ENRON_SLICE: outDir, OPEN_ESTATE_BASELINE_OUT: tmpOut },
  });
  const baseline = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
  assert.ok(baseline.enron && typeof baseline.enron.scores.pairwise.recall === 'number', 'the conditional enron section records aggregate scores only');
  fs.rmSync(outDir, { recursive: true, force: true });
});
