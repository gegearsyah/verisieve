import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateEstate, SEED } from '../scripts/gen-company-estate.mjs';
import { runAblation } from '../scripts/run-amnesiac-corpus-ablation.mjs';

// Stage 10: Amnesiac Corpus ablation over the synthetic multi-department company estate.
// GT lives only in the generated manifest; the engine path sees only estate files.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/company-estate');
const MANIFEST = path.join(ROOT, 'fixtures/company-estate-manifest.json');
const OUT = path.join(ROOT, 'results/amnesiac-corpus-ablation.json');

const artifactShape = (a) => {
  const clone = JSON.parse(JSON.stringify(a));
  const zeroTimings = (node) => {
    if (Array.isArray(node)) return node.forEach(zeroTimings);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (/WallclockMs$/.test(k)) node[k] = 0;
        else zeroTimings(v);
      }
    }
  };
  zeroTimings(clone);
  return clone;
};

test('Estate fixture: deterministic generation with ground truth confined to the manifest', () => {
  const manifest = generateEstate();
  assert.ok(SEED > 0, 'seed must be recorded');
  assert.equal(manifest.seed, SEED);
  const manifestRel = path.relative(ESTATE_DIR, MANIFEST);
  assert.ok(manifestRel.startsWith('..') || path.isAbsolute(manifestRel), 'the GT manifest must not live inside the estate directory');

  assert.ok(manifest.departments.includes('it') && manifest.departments.includes('business'));
  assert.ok(manifest.files.length >= 10, 'estate must span SQL, CSVs, notes, mail, transcript, WAV, deck');

  // cross-department duplication: every GT entity occurs across files in >= 2 departments
  for (const e of manifest.entities) {
    assert.ok(e.departments.length >= 2, `${e.id} must span multiple departments`);
    assert.ok(e.modalities.length >= 2, `${e.id} must span multiple modalities`);
    assert.ok(e.occurrenceCount >= 2, `${e.id} must have recorded occurrences`);
    for (const occ of e.occurrences) {
      for (const [s, end] of occ.charSpans) assert.ok(end > s, `${e.id} spans must be well-formed`);
    }
  }

  // determinism: regenerating produces byte-identical estate files and manifest
  const first = fs.readFileSync(MANIFEST, 'utf8');
  generateEstate();
  assert.equal(fs.readFileSync(MANIFEST, 'utf8'), first, 'manifest regeneration must be byte-identical');
});

test('Ablation: fixtures exist, all three fractions present, byte-diff exact, finite certificate pass rates, pending-gpu fields, deterministic re-run', async () => {
  generateEstate(); // estate files on disk for the runner
  const artifact = await runAblation();
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2));

  assert.equal(artifact.kind, 'amnesiac-corpus-ablation');
  assert.ok(artifact.estate.groundTruthEntityCount >= 20, `GT entity count recorded, got ${artifact.estate.groundTruthEntityCount}`);
  assert.ok(artifact.estate.corpusIndexedEntityCount >= 1, 'corpus must index engine entities');
  assert.ok(artifact.corpus.sampleCount >= 10);

  const fractions = artifact.fractions;
  assert.deepEqual(Object.keys(fractions).sort(), ['0.01', '0.05', '0.2'], 'all three deletion fractions must be present');
  for (const [key, f] of Object.entries(fractions)) {
    assert.ok(f.selectedEntityCount >= 1, `fraction ${key} must select entities`);
    assert.equal(f.indexedEntityCount, artifact.estate.corpusIndexedEntityCount);
    const diff = f.byteDiff;
    assert.equal(diff.exact, true, `fraction ${key} byte-diff must equal the erased entities' spans exactly`);
    assert.equal(diff.measuredDeltaBytes, -diff.expectedShrinkBytes, 'measured corpus shrink must equal expected span shrink in bytes');
    assert.ok(diff.removedSpanBytes > 0, `fraction ${key} must report exact removed span bytes, got ${diff.removedSpanBytes}`);
    assert.equal(diff.diffVerified, true, 'eraseEntity diff receipt must verify');
    assert.ok(diff.changedSampleCount >= 1 && diff.unchangedSampleCount >= 0);
    assert.equal(
      diff.changedSampleCount + diff.unchangedSampleCount,
      artifact.corpus.sampleCount,
      'changed + unchanged samples must cover the corpus'
    );
    for (const rate of [f.certificatePassRateBefore, f.certificatePassRateAfter]) {
      assert.ok(Number.isFinite(rate) && rate >= 0 && rate <= 1, `certificate pass rate must be a finite number in [0,1], got ${rate}`);
      assert.ok(Number.isFinite(f.regenerationWallclockMs) && f.regenerationWallclockMs >= 0, 'wall-clock must be a finite measured number');
    }
    for (const e of f.perErasedEntity) {
      assert.match(e.entityId, /^ent:[a-z_]+:[0-9a-f]{16}$/, 'erased entities must be corpus-indexed salted ids');
      assert.ok(e.removedSpanBytes >= 0);
    }
  }

  // honest certificates: stated confidence disclosed, non-vacuous bound
  const cert = artifact.certificates;
  assert.equal(cert.statedConfidence, 0.95);
  assert.ok(Number.isFinite(cert.passRate) && cert.passRate >= 0 && cert.passRate <= 1);
  assert.ok(cert.certifiedPassRateLowerBound <= cert.passRate);
  assert.ok(Object.keys(cert.injectedEntityCountByClass).length >= 3, 'injected PII counts must be disclosed by class');

  // GPU-dependent metrics are staged, not fabricated: fields present, explicitly pending
  for (const key of ['adapterRetrainWallclockVsFullRetrain', 'sisaHeadToHead', 'carliniCanaryExposurePrePostRetrain']) {
    assert.ok(artifact.gpuDependent[key], `gpu-dependent field ${key} must be present`);
    assert.equal(artifact.gpuDependent[key].status, 'pending-gpu');
  }

  // no forbidden claim vocabulary anywhere in the artifact
  const blob = JSON.stringify(artifact).toLowerCase();
  for (const banned of ['mathematically grounded', 'eliminates', 'differential privacy', 'provable anonymity']) {
    assert.ok(!blob.includes(banned), `artifact must not contain "${banned}"`);
  }

  // deterministic re-run: every non-timing field byte-identical
  const again = await runAblation();
  assert.deepEqual(artifactShape(again), artifactShape(artifact), 're-run must reproduce all deterministic fields');
  const persisted = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  assert.deepEqual(artifactShape(persisted), artifactShape(artifact), 'persisted artifact must match the computed artifact');
});
