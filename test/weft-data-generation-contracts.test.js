import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { LICENCE_AUDIT } from '../scripts/build-weft-training-pairs.mjs';

// W-Data contract tests: external behavior only. The driver is executed as a child
// process. No network, no downloads, no GPU. Fail-closed probes use the fixture teacher
// on CPU; the embedding-backed append-only run is skipped when MiniLM is not cached.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'generate-weft-fullscale-estates.py');
const OUT = path.join(ROOT, 'results', 'weft-training-pairs-fullscale');
const RECEIPT = path.join(OUT, 'receipt.json');
const TRAIN = path.join(OUT, 'train.jsonl');
const EVAL = path.join(OUT, 'eval.jsonl');
const REALISM = path.join(ROOT, 'results', 'weft-data-realism-audit.json');
const LICENCE = path.join(ROOT, 'results', 'weft-licence-audit.json');
const PYTHON = process.env.PYTHON || 'python';
const PERMISSIVE = ['apache-2.0', 'mit', 'bsd-2-clause', 'bsd-3-clause', 'cc0-1.0'];
// Built from fragments so this compliance check does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'fir' + 'st'];

const isDigest = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const inUnit = (x) => isNum(x) && x >= 0 && x <= 1;
const linesOf = (text) => String(text).split('\n').filter(Boolean);

function lfDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function pairDigest() {
  const train = fs.readFileSync(TRAIN, 'utf8').replace(/\r\n/g, '\n');
  const evalText = fs.readFileSync(EVAL, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(train + evalText).digest('hex');
}

function snapshotArtifacts() {
  const out = {};
  if (fs.existsSync(OUT)) {
    for (const name of fs.readdirSync(OUT).sort()) {
      out[`out/${name}`] = lfDigest(path.join(OUT, name));
    }
  }
  out.audit = fs.existsSync(REALISM) ? crypto.createHash('sha256').update(fs.readFileSync(REALISM)).digest('hex') : null;
  out.licence = crypto.createHash('sha256').update(fs.readFileSync(LICENCE)).digest('hex');
  return out;
}

function run(args, env = {}) {
  return spawnSync(PYTHON, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function lastJsonLine(text) {
  const line = String(text).trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}

function referenceFixture(dir, count = 6) {
  const topics = [
    'The history of lighthouse keeping spans centuries and many coastlines, with keepers recording weather and shipping traffic in daily logs.',
    'Coral reefs support a large share of marine species, and their health depends on water temperature, light, and the surrounding coastal economy.',
    'Urban planning balances transport, housing, and public space, and city councils publish long plans that describe each district and its growth.',
    'The steam engine changed mining, textiles, and transport, and its development drew on earlier pumps, boilers, and machine tools across Europe.',
    'Immunology studies how bodies recognise pathogens, and vaccines train that response by presenting a harmless part of a virus or bacterium.',
    'Jazz developed from blues, ragtime, and brass band music, and its players value improvisation, rhythm, and small group conversation.',
    'Plate tectonics explains earthquakes, mountain belts, and ocean ridges, and the theory grew from maps of fossils, rocks, and magnetic stripes.',
    'Photography began with chemistry and optics, and its practitioners now work across film, digital sensors, lighting, and editing software.',
  ];
  const file = path.join(dir, 'reference.jsonl');
  const rows = topics.slice(0, count).map((text, i) => ({ id: `ref-${i}`, title: `Synthetic ${i}`, text }));
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function smokeArgs(tmp, extra = []) {
  return [
    '--device', 'cpu', '--teacher-licence', 'mit', '--target-pairs', '12', '--eval-size', '4',
    '--embedding-max-docs', '50', '--out', path.join(tmp, 'pairs'),
    '--audit-out', path.join(tmp, 'realism.json'), ...extra,
  ];
}

test('W-Data 1: teacher absence and non-permissive licence fail closed with no output', () => {
  const before = snapshotArtifacts();

  const absent = run(['--device', 'cpu', '--target-pairs', '10']);
  assert.equal(absent.status, 2, absent.stderr);
  assert.equal(lastJsonLine(absent.stderr).error, 'WEFT_TEACHER_LICENCE_REJECTED');

  const nonPermissive = run(['--device', 'cpu', '--teacher-licence', 'gpl-3.0', '--target-pairs', '10']);
  assert.equal(nonPermissive.status, 2, nonPermissive.stderr);
  assert.equal(lastJsonLine(nonPermissive.stderr).error, 'WEFT_TEACHER_LICENCE_REJECTED');

  const cuda = run([
    '--device', 'cuda', '--teacher-licence', 'apache-2.0',
    '--teacher-model', 'nonexistent/weft-probe-teacher', '--target-pairs', '10',
  ]);
  assert.equal(cuda.status, 2, cuda.stderr);
  const cudaError = lastJsonLine(cuda.stderr);
  assert.ok(['WEFT_FULLSCALE_CUDA_UNAVAILABLE', 'WEFT_TEACHER_RUNTIME_UNAVAILABLE'].includes(cudaError.error),
    `unexpected cuda fail-closed code ${cudaError.error}`);
  assert.match(cudaError.detail, /CUDA|cache|weights/i);

  assert.deepEqual(snapshotArtifacts(), before, 'fail-closed probes must not touch any artifact');
});

test('W-Data 2: reference absence fails closed instead of skipping metrics', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-noref-'));
  try {
    const result = run([
      '--device', 'cpu', '--teacher-licence', 'mit', '--target-pairs', '10',
      '--out', path.join(tmp, 'pairs'), '--audit-out', path.join(tmp, 'realism.json'),
    ]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(lastJsonLine(result.stderr).error, 'WEFT_REFERENCE_UNAVAILABLE');
    assert.equal(fs.existsSync(path.join(tmp, 'pairs')), false, 'no pair artifact may be written');
    assert.equal(fs.existsSync(path.join(tmp, 'realism.json')), false, 'no audit entry may be written');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('W-Data 3: missing compiler runtime is a typed error with no output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-nonode-'));
  try {
    const result = run([
      ...smokeArgs(tmp, ['--reference', path.join(tmp, 'reference.jsonl')]),
      '--node', path.join(tmp, 'definitely-missing-node'),
    ]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(lastJsonLine(result.stderr).error, 'WEFT_COMPILER_UNAVAILABLE');
    assert.equal(fs.existsSync(path.join(tmp, 'pairs')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'realism.json')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('W-Data 4: committed pair receipt schema — live path, teacher trace, digests, disclosure', () => {
  assert.ok(fs.existsSync(RECEIPT), 'results/weft-training-pairs-fullscale/receipt.json must be committed');
  const receipt = JSON.parse(fs.readFileSync(RECEIPT, 'utf8'));
  assert.equal(receipt.schemaVersion, '1.0');
  assert.equal(receipt.kind, 'weft-training-pairs');
  assert.equal(receipt.policy, 'weft-pairs-v1');
  assert.equal(receipt.mode, 'live', 'the W2 live path must be exercised, never fixture fallback');
  assert.equal(receipt.generator, 'local-teacher');
  assert.ok(Number.isInteger(receipt.pairCount) && receipt.pairCount > 0);
  assert.equal(receipt.trainCount + receipt.evalCount, receipt.pairCount);
  assert.equal(receipt.evalPairIds.length, receipt.evalCount);
  const byTypeTotal = Object.values(receipt.byType).reduce((a, b) => a + b, 0);
  assert.equal(byTypeTotal, receipt.pairCount);
  assert.equal(receipt.byLabel.positive + receipt.byLabel.negative, receipt.pairCount);

  assert.equal(linesOf(fs.readFileSync(TRAIN, 'utf8')).length, receipt.trainCount);
  assert.equal(linesOf(fs.readFileSync(EVAL, 'utf8')).length, receipt.evalCount);
  assert.equal(receipt.trainJsonlSha256, lfDigest(TRAIN), 'train digest matches the committed bytes');
  assert.equal(receipt.evalJsonlSha256, lfDigest(EVAL), 'eval digest matches the committed bytes');
  assert.equal(receipt.pairJsonlSha256, pairDigest(), 'pair digest matches the committed bytes');
  for (const status of Object.values(receipt.usedSources)) assert.equal(status, 'green');

  const full = receipt.fullscale;
  assert.ok(full && typeof full === 'object', 'the driver must enrich the receipt');
  assert.equal(full.ticket, 'W-Data');
  assert.ok(['fixture-smoke', 'live-fullscale'].includes(full.scale));
  assert.ok(Number.isInteger(full.seeds.generation) && Number.isInteger(full.seeds.embedding));

  const teacher = full.teacher;
  assert.equal(typeof teacher.kind, 'string');
  assert.equal(typeof teacher.modelId, 'string');
  assert.ok(PERMISSIVE.includes(String(teacher.licence).toLowerCase()), 'teacher licence must be permissive');
  if (teacher.kind === 'fixture-smoke') {
    assert.equal(teacher.weightDigest, null, 'a fixture teacher has no weight digest');
    assert.ok(isDigest(teacher.adapterSha256));
  } else {
    assert.ok(isDigest(teacher.weightDigest), 'a live teacher must pin a weight digest');
  }
  assert.ok(isDigest(teacher.licenceTrace.auditSha256));
  assert.match(teacher.licenceTrace.auditPath, /weft-licence-audit\.json$/);
  assert.equal(teacher.licenceTrace.entryStatus, 'green');
  assert.equal(typeof teacher.licenceTrace.verifiedFrom, 'string');

  assert.deepEqual(full.digests, {
    trainJsonlSha256: receipt.trainJsonlSha256,
    evalJsonlSha256: receipt.evalJsonlSha256,
    pairJsonlSha256: receipt.pairJsonlSha256,
    matchesW2Receipt: true,
  });

  const compute = full.compute;
  assert.ok(['cpu', 'cuda'].includes(compute.device));
  assert.equal(typeof compute.cudaAvailable, 'boolean');
  assert.equal(typeof compute.python, 'string');
  assert.ok(typeof compute.computeDisclosure === 'string' && compute.computeDisclosure.length > 0);
  if (compute.device === 'cpu') {
    assert.match(compute.computeDisclosure, /CPU/);
    assert.match(compute.computeDisclosure, /fixture-scale/i);
  }
});

test('W-Data 5: committed realism audit schema — reference, metrics, gaps', () => {
  assert.ok(fs.existsSync(REALISM), 'results/weft-data-realism-audit.json must be committed');
  const artifact = JSON.parse(fs.readFileSync(REALISM, 'utf8'));
  assert.equal(artifact.kind, 'weft-data-realism-audit');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.appendOnly, true);
  assert.ok(Array.isArray(artifact.entries) && artifact.entries.length >= 1);

  const entry = artifact.entries.at(-1);
  assert.ok(isDigest(entry.runId));
  assert.equal(entry.ticket, 'W-Data');
  assert.ok(entry.createdAt && !Number.isNaN(Date.parse(entry.createdAt)));
  assert.ok(['fixture-smoke', 'live-fullscale'].includes(entry.scale));
  assert.ok(Number.isInteger(entry.seeds.generation) && Number.isInteger(entry.seeds.embedding));

  const pairs = entry.pairs;
  assert.match(pairs.path, /weft-training-pairs-fullscale$/);
  assert.equal(pairs.pairCount, JSON.parse(fs.readFileSync(RECEIPT, 'utf8')).pairCount);
  assert.equal(pairs.trainJsonlSha256, lfDigest(TRAIN));
  assert.equal(pairs.evalJsonlSha256, lfDigest(EVAL));
  assert.ok(Object.values(pairs.byType).reduce((a, b) => a + b, 0) === pairs.pairCount);

  const reference = entry.reference;
  assert.equal(reference.id, 'wikipedia-dumps', 'the reference must be the licence-green Wikipedia entry');
  assert.equal(reference.licence, 'CC-BY-SA-4.0');
  assert.equal(reference.status, 'green');
  assert.ok(isDigest(reference.sha256), 'the reference sample is digest-pinned');
  assert.ok(Number.isInteger(reference.documentCount) && reference.documentCount > 0);
  assert.ok(Number.isInteger(reference.totalChars) && reference.totalChars > 0);
  assert.equal(typeof reference.path, 'string');
  assert.equal(typeof reference.retrieval, 'string');

  const metrics = entry.metrics;
  const ttr = metrics.typeTokenRatio;
  for (const side of ['generated', 'reference']) {
    assert.ok(Number.isInteger(ttr[side].tokens) && ttr[side].tokens > 0);
    assert.ok(Number.isInteger(ttr[side].types) && ttr[side].types > 0);
    assert.ok(inUnit(ttr[side].typeTokenRatio));
  }
  assert.ok(Number.isInteger(ttr.sizeMatched.tokenCount) && ttr.sizeMatched.tokenCount > 0);
  assert.ok(inUnit(ttr.sizeMatched.generated.typeTokenRatio));
  assert.ok(inUnit(ttr.sizeMatched.reference.typeTokenRatio));

  for (const n of ['1', '2', '3']) {
    for (const side of ['generated', 'reference']) {
      assert.ok(inUnit(metrics.distinctN[side][n].ratio), `distinct-${n} ${side} ratio`);
    }
    assert.ok(inUnit(metrics.distinctN.noveltyFraction[n]), `distinct-${n} novelty fraction`);
  }

  const embedding = metrics.embedding;
  assert.equal(embedding.modelId, 'sentence-transformers/all-MiniLM-L6-v2');
  assert.ok(isDigest(embedding.modelDigest));
  assert.equal(embedding.licence, 'Apache-2.0');
  assert.ok(Number.isInteger(embedding.generatedDocsEmbedded) && embedding.generatedDocsEmbedded > 0);
  assert.ok(Number.isInteger(embedding.referenceDocsEmbedded) && embedding.referenceDocsEmbedded > 0);
  assert.equal(typeof embedding.sampled, 'boolean');
  assert.ok(isNum(embedding.generatedDispersion) && embedding.generatedDispersion >= 0 && embedding.generatedDispersion <= 2);
  assert.ok(isNum(embedding.referenceDispersion) && embedding.referenceDispersion >= 0 && embedding.referenceDispersion <= 2);
  assert.ok(isNum(embedding.coverage.meanNearestCosine) && embedding.coverage.meanNearestCosine >= -1 && embedding.coverage.meanNearestCosine <= 1);
  assert.ok(inUnit(embedding.coverage.coveredFractionAt05));

  for (const side of ['generated', 'reference']) {
    const length = metrics.documentLength[side];
    assert.ok(Number.isInteger(length.count) && length.count > 0);
    assert.ok(isNum(length.mean) && length.mean >= 0);
    assert.ok(isNum(length.median) && isNum(length.p90) && length.p90 >= length.median);
  }
  assert.equal(metrics.documentLength.unit, 'whitespace tokens');

  assert.ok(Object.values(metrics.formatDistribution.generated).every((v) => Number.isInteger(v) && v >= 0));
  assert.equal(metrics.formatDistribution.reference['wikipedia-dumps'], reference.documentCount);
  for (const balance of [metrics.departmentBalance, metrics.themeBalance]) {
    assert.ok(Object.values(balance.counts).every((v) => Number.isInteger(v) && v >= 0));
    assert.ok(inUnit(balance.normalizedEntropy));
    assert.ok(Number.isInteger(balance.distinct));
  }

  const density = metrics.identityBearingTokenDensity;
  assert.ok(isNum(density.generated.roleTokensPer1k) && density.generated.roleTokensPer1k >= 0);
  assert.ok(isNum(density.generated.capitalizedSequencesPer1k) && density.generated.capitalizedSequencesPer1k >= 0);
  assert.ok(isNum(density.reference.capitalizedSequencesPer1k) && density.reference.capitalizedSequencesPer1k >= 0);

  assert.ok(Array.isArray(entry.gaps) && entry.gaps.length >= 3, 'gaps must be reported honestly');
  for (const gap of entry.gaps) assert.equal(typeof gap, 'string');
});

test('W-Data 6: licence and realism artifacts are append-only', (t) => {
  const committed = JSON.parse(fs.readFileSync(LICENCE, 'utf8'));
  assert.ok(committed.sources.length > LICENCE_AUDIT.sources.length, 'a teacher entry must be appended');
  assert.deepEqual(committed.sources.slice(0, LICENCE_AUDIT.sources.length), LICENCE_AUDIT.sources,
    'the original audit entries must be byte-for-byte unchanged in content');
  const appended = committed.sources.at(-1);
  assert.equal(appended.id, 'mistral-7b-instruct-v0.3');
  assert.equal(appended.modelId, 'mistralai/Mistral-7B-Instruct-v0.3');
  assert.equal(appended.licence, 'Apache-2.0');
  assert.equal(appended.status, 'green');
  assert.equal(appended.usedInRecipe, true);
  assert.match(appended.verifiedFrom, /huggingface\.co\/mistralai/);
  const ids = committed.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'audit source ids stay unique');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-append-'));
  try {
    const reference = referenceFixture(tmp);
    const auditPath = path.join(tmp, 'realism.json');
    const common = [
      '--device', 'cpu', '--teacher-licence', 'mit', '--target-pairs', '12', '--eval-size', '4',
      '--embedding-max-docs', '50', '--reference', reference,
      '--reference-id', 'synthetic-estate', '--reference-licence', 'project-generated',
      '--reference-source', 'synthetic fixture for append-only contract testing',
      '--audit-out', auditPath,
    ];
    const initial = run([...common, '--out', path.join(tmp, 'pairs-a')]);
    if (initial.status !== 0) {
      const error = (() => { try { return lastJsonLine(initial.stderr).error; } catch { return null; } })();
      if (error === 'WEFT_EMBEDDINGS_UNAVAILABLE') {
        t.skip('MiniLM is not in the local cache; embedding-backed append check skipped');
        return;
      }
      assert.fail(`initial smoke run failed: ${initial.stderr}`);
    }
    const afterInitial = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    assert.equal(afterInitial.entries.length, 1);

    const second = run([...common, '--out', path.join(tmp, 'pairs-b')]);
    assert.equal(second.status, 0, second.stderr);
    const afterSecond = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    assert.equal(afterSecond.entries.length, 2, 'a second run appends exactly one entry');
    assert.deepEqual(afterSecond.entries[0], afterInitial.entries[0], 'the existing entry is never rewritten');
    assert.notEqual(afterSecond.entries[0].runId, afterSecond.entries[1].runId);

    for (const name of ['train.jsonl', 'eval.jsonl']) {
      assert.equal(
        fs.readFileSync(path.join(tmp, 'pairs-a', name), 'utf8').replace(/\r\n/g, '\n'),
        fs.readFileSync(path.join(tmp, 'pairs-b', name), 'utf8').replace(/\r\n/g, '\n'),
        `the fixture teacher and compiler must be deterministic across runs (${name})`);
    }

    const receipt = JSON.parse(fs.readFileSync(path.join(tmp, 'pairs-a', 'receipt.json'), 'utf8'));
    const train = fs.readFileSync(path.join(tmp, 'pairs-a', 'train.jsonl'), 'utf8').replace(/\r\n/g, '\n');
    const evalText = fs.readFileSync(path.join(tmp, 'pairs-a', 'eval.jsonl'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(receipt.trainJsonlSha256, crypto.createHash('sha256').update(train).digest('hex'));
    assert.equal(receipt.evalJsonlSha256, crypto.createHash('sha256').update(evalText).digest('hex'));
    assert.equal(receipt.pairJsonlSha256, crypto.createHash('sha256').update(train + evalText).digest('hex'));

    const entry = afterSecond.entries[1];
    assert.equal(entry.reference.id, 'synthetic-estate');
    assert.equal(entry.reference.licence, 'project-generated');
    assert.equal(entry.reference.status, 'green');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('W-Data 7: banned-word sweep over the new script, test, and artifacts', () => {
  for (const file of [SCRIPT, fileURLToPath(import.meta.url), LICENCE, RECEIPT, REALISM]) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const word of BANNED) {
      assert.ok(!text.includes(word), `${path.basename(file)} must not contain a banned term`);
    }
  }
});
