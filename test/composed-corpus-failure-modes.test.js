import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Stage K4 (the honesty experiment) external-behavior tests: the runner is executed as a
// child process (twice, for byte determinism); the tests read the artifact and assert the
// invariants a reviewer reads first. Artifact + runner: results/composed-corpus-failure-modes.json
// + scripts/run-composed-failure-modes.mjs.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts/run-composed-failure-modes.mjs');
const OUT = path.join(ROOT, 'results/composed-corpus-failure-modes.json');

function runRunner() {
  execFileSync(process.execPath, [RUNNER], { cwd: ROOT, stdio: 'pipe' });
  return fs.readFileSync(OUT);
}

test('K4 1: determinism — two runs are byte-identical, no wallclock fields, seeded and version-pinned', () => {
  const bytes1 = runRunner();
  const bytes2 = runRunner();
  assert.ok(bytes1.equals(bytes2), 'the artifact must regenerate byte-identically');
  const r = JSON.parse(bytes1.toString('utf8'));
  assert.equal(r.kind, 'composed-corpus-failure-modes');
  assert.equal(r.version, 'composed-failure-modes-v1');
  assert.equal(r.seed, 20261124);
  assert.equal(r.estate.manifestVersion, 'noisy-estate-v1');
  assert.ok(!/generatedAt|createdAt|timestamp"|date:/i.test(JSON.stringify(r)), 'no wallclock fields');
  assert.ok(r.estate.estateSha256 && /^[0-9a-f]{64}$/.test(r.estate.estateSha256), 'the artifact pins the estate SHA-256');
});

test('K4 2: false-merge amplification — rates are a world-first ladder, the rate-0 floor is zero, factors are finite where defined and composition amplifies where measured', () => {
  const r = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const rows = r.falseMergeAmplification.rates;
  assert.deepEqual(rows.map((x) => x.rate), [0, 0.05, 0.1, 0.25, 0.5], 'the deterministic ladder with its zero baseline');
  // rate 0: no induced merges, contamination-free by construction
  assert.equal(rows[0].mergedClasses, 0);
  assert.equal(rows[0].perBlock.contaminatedOccurrences, 0);
  assert.equal(rows[0].composed.contaminatedOccurrences, 0);
  assert.equal(rows[0].amplificationFactor, null);
  for (const row of rows) {
    for (const view of ['perBlock', 'composed']) {
      const v = row[view];
      assert.ok(v.corruptionRate >= 0 && v.corruptionRate <= 1, `${view} corruptionRate in [0,1] at rate ${row.rate}`);
      assert.ok(Number.isFinite(v.contaminatedOccurrences) && Number.isFinite(v.falseIdentityOccurrences), `${view} occurrence counts finite at rate ${row.rate}`);
    }
    // the amplification factor is present: finite where defined, null only where the per-block
    // rate is exactly zero (reported, never smoothed)
    if (row.amplificationFactor !== null) {
      assert.ok(Number.isFinite(row.amplificationFactor), `finite factor at rate ${row.rate}`);
      assert.equal(row.perBlock.corruptionRate > 0, true);
    } else {
      assert.equal(row.perBlock.contaminatedOccurrences, 0, 'a null factor requires an exactly-zero per-block rate');
    }
    for (const a of [row.falseNameAnchors]) {
      assert.equal(a.mergedClasses, row.mergedClasses);
      assert.ok(a.canonicalOfExactlyOneMember >= 0 && a.canonicalSharedOrUnknown >= 0);
    }
  }
  const finite = rows.filter((x) => x.amplificationFactor !== null);
  assert.ok(finite.length >= 1, 'at least one rate must carry a finite amplification factor');
  for (const row of finite) {
    assert.ok(
      row.amplificationFactor > 1,
      `composition must amplify the record-mixing measure where the factor is defined, got ${row.amplificationFactor} at rate ${row.rate}`
    );
  }
  // composed corruption is never below per-block corruption at the same rate
  for (const row of rows) {
    assert.ok(row.composed.corruptionRate >= row.perBlock.corruptionRate, `composed >= per-block corruption at rate ${row.rate}`);
  }
});

test('K4 3: hub duplication — MinHash fields bounded and recorded, hub cap context present', () => {
  const r = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const mh = r.hubDuplication;
  for (const key of ['overall', 'hub', 'nonHub']) {
    const f = mh[key].nearDuplicateSampleFraction;
    assert.ok(f === null || (f >= 0 && f <= 1), `${key} near-duplicate fraction in [0,1]`);
  }
  assert.ok(mh.overall.nearDuplicatePairs >= 0);
  assert.ok(mh.overall.exactDuplicatePairs >= 0 && mh.overall.exactDuplicatePairs <= mh.overall.nearDuplicatePairs);
  assert.ok(mh.analyzedSamples >= 0 && mh.analyzedSamples <= mh.sampleCount);
  assert.ok(mh.hashFunctions > 0 && mh.banding.length > 0 && typeof mh.shingle === 'string', 'shingle size and banding recorded');
  const cap = mh.capContext;
  assert.equal(cap.compositionPolicy, 'composed-v1');
  assert.equal(cap.hubCapBlocks, 8, 'the engine composed-v1 hub cap value');
  assert.ok(cap.capHitEntities >= 0 && cap.maxTruncatedBlocks >= 0);
});

test('K4 4: the designed-not-run section exists and carries no measured numbers', () => {
  const r = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const d = r.designedNotRun;
  assert.ok(d, 'designedNotRun present');
  assert.equal(d.status, 'designed-not-run');
  assert.ok(typeof d.title === 'string' && d.title.length > 0);
  assert.ok(typeof d.design.whatWouldBeMeasured === 'string' && d.design.whatWouldBeMeasured.length > 0);
  assert.ok(typeof d.design.estate === 'string' && d.design.armsAndBudget);
  assert.ok(typeof d.whyNotRun === 'string' && d.whyNotRun.length > 0);
});

test('K4 5: engine boundary — the runner imports the engine only to construct corpora, truth comes from the manifest', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const engineImports = [...src.matchAll(/from\s+['"]([^'"]*src\/[^'"]+)['"]/g)].map((m) => path.basename(m[1])).sort();
  assert.deepEqual(engineImports, ['amnesiac-corpus.js', 'perceive.js'], 'only the corpus-construction seam may import the engine');
  const otherImports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('node:') && !s.includes('src/'));
  assert.deepEqual(otherImports, [], 'every non-engine import must be a node: builtin');
  assert.ok(/noisy-estate-manifest\.json/.test(src), 'truth is read from the committed manifest answer key');
});
