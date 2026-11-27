import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  IB_PTLM_SURROGATE_POOLS,
  exportIbPtlmJsonl,
  exportTrainingDataset,
  writeTrainingDataset,
  perceiveMulti,
} from '../src/index.js';

const CLI_PATH = path.resolve('bin/versieve.mjs');
const PY_SCRIPT = path.resolve('scripts/run-track-d-fair-lora.py');

const RAW_SECRETS = ['Dr. Marcus Hale', 'marcus.hale@hospital.org', '232-00-4411', '617-555-0143'];

const SANITIZED_INPUTS = [
  {
    name: 'onboarding-note.txt',
    text: 'Dr. Marcus Hale emailed marcus.hale@hospital.org regarding SSN 232-00-4411, phone 617-555-0143, during onboarding followup 12.',
  },
];

async function buildPerceived() {
  return perceiveMulti(SANITIZED_INPUTS, { workspaceSalt: 'u1-ib-ptlm-exporter' });
}

function parseJsonl(jsonl) {
  return String(jsonl || '')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// 1. Surrogate pool contract: poolA and poolB are strictly disjoint per category
// ---------------------------------------------------------------------------

test('U1.1: IB-PT-LM surrogate pools poolA and poolB have zero token overlap for every placeholder category', () => {
  for (const [category, pools] of Object.entries(IB_PTLM_SURROGATE_POOLS)) {
    assert.ok(Array.isArray(pools.poolA) && pools.poolA.length > 0, `${category} poolA must be a non-empty list`);
    assert.ok(Array.isArray(pools.poolB) && pools.poolB.length > 0, `${category} poolB must be a non-empty list`);
    const a = new Set(pools.poolA);
    const b = new Set(pools.poolB);
    assert.equal(a.size, pools.poolA.length, `${category} poolA values must not repeat`);
    assert.equal(b.size, pools.poolB.length, `${category} poolB values must not repeat`);
    const overlap = pools.poolA.filter((v) => b.has(v));
    assert.deepEqual(overlap, [], `${category} poolA intersect poolB must be empty`);
    assert.ok(!a.has(null) && !b.has(null), `${category} pool values must all be strings`);
  }
});

// ---------------------------------------------------------------------------
// 2. Direct exporter: deterministic paired counterfactual views, zero raw PII
// ---------------------------------------------------------------------------

test('U1.2: exportIbPtlmJsonl deterministically emits two strictly disjoint surrogate views with -100 PII spans, aligned non-PII segments, provenance, and zero raw PII', async () => {
  const perceivedA = await buildPerceived();
  const perceivedB = await buildPerceived();

  const outA = exportIbPtlmJsonl(perceivedA);
  const outB = exportIbPtlmJsonl(perceivedB);

  // Deterministic replay: byte identical across independent runs, no timestamps
  assert.equal(outA.jsonl, outB.jsonl, 'IB-PT-LM JSONL must be byte-identical across replay');
  assert.equal(outA.manifestJson, outB.manifestJson, 'IB-PT-LM manifest must be byte-identical across replay');
  assert.equal(outA.manifest.format, 'ib-ptlm');
  assert.equal(outA.manifest.recordCount, outA.records.length);
  assert.equal(outA.manifest.zeroEgress, true);
  assert.equal(outA.manifest.rawTextEmitted, false);
  assert.equal(outA.manifest.receiptSha256, perceivedA.receipt.receiptSha256);
  assert.match(outA.manifest.datasetSha256, /^[0-9a-f]{64}$/);
  // Surrogate pool provenance is audited in the manifest with zero pool overlap
  assert.equal(outA.manifest.ibPtlm.poolOverlapCount, 0);
  assert.match(outA.manifest.ibPtlm.poolAuditSha256, /^[0-9a-f]{64}$/);
  assert.ok(outA.manifest.ibPtlm.poolACount > 0 && outA.manifest.ibPtlm.poolBCount > 0);

  const rows = parseJsonl(outA.jsonl);
  assert.equal(rows.length, outA.manifest.recordCount);
  assert.ok(rows.length >= 1, 'fixture must produce at least one record');

  for (const row of rows) {
    assert.ok(row.viewA && row.viewB, 'record must carry viewA and viewB');
    assert.equal(row.viewA.pool, 'poolA');
    assert.equal(row.viewB.pool, 'poolB');
    assert.equal(row.metadata.receiptSha256, perceivedA.receipt.receiptSha256);

    const tags = Array.from(row.maskedText.matchAll(/<(?:PII|SECRET):[A-Za-z0-9_]+>/g)).map((m) => m[0]);
    const views = [row.viewA, row.viewB];
    for (const view of views) {
      assert.ok(typeof view.text === 'string' && view.text.length > 0);
      // Non-PII segments: identical text between views (per index), valid char spans
      for (const seg of view.nonPiiSegments) {
        assert.equal(view.text.slice(seg.start, seg.end), seg.text, 'non-PII segment char span must slice back to its text');
      }
      // PII surrogate spans carry label -100, cover only the surrogate substring
      for (const span of view.piiSpans) {
        assert.equal(span.label, -100);
        assert.equal(view.text.slice(span.start, span.end), span.surrogate, 'PII span char range must be exactly the surrogate');
        assert.ok(tags.includes(span.tag), 'PII span must reference a placeholder tag from the masked text');
      }
    }
    assert.equal(
      row.viewA.nonPiiSegments.length,
      row.viewB.nonPiiSegments.length,
      'both views must carry one non-PII segment per segment index for alignment'
    );
    for (let i = 0; i < row.viewA.nonPiiSegments.length; i++) {
      assert.equal(row.viewA.nonPiiSegments[i].text, row.viewB.nonPiiSegments[i].text, 'non-PII segment text must be identical across views for token alignment');
      assert.equal(row.viewA.nonPiiSegments[i].index, i);
      assert.equal(row.viewB.nonPiiSegments[i].index, i);
    }
    if (tags.length > 0) {
      assert.notEqual(row.viewA.text, row.viewB.text, 'disjoint pools force different surrogate surfaces for masked records');
      // Surrogates come from their declared pool and never from the other pool
      const aSet = new Set(Object.values(IB_PTLM_SURROGATE_POOLS).flatMap((p) => p.poolA));
      const bSet = new Set(Object.values(IB_PTLM_SURROGATE_POOLS).flatMap((p) => p.poolB));
      for (const span of row.viewA.piiSpans) {
        assert.ok(aSet.has(span.surrogate), 'viewA surrogate must come from poolA');
        assert.ok(!bSet.has(span.surrogate), 'viewA surrogate must never appear in poolB');
      }
      for (const span of row.viewB.piiSpans) {
        assert.ok(bSet.has(span.surrogate), 'viewB surrogate must come from poolB');
        assert.ok(!aSet.has(span.surrogate), 'viewB surrogate must never appear in poolA');
      }
      // Same placeholder tag -> same surrogate in every occurrence (deterministic, per-tag)
      const firstA = row.viewA.piiSpans.find((s) => s.tag === tags[0]);
      for (const span of row.viewA.piiSpans) {
        if (span.tag === tags[0]) assert.equal(span.surrogate, firstA.surrogate);
      }
    }
  }

  // Zero raw PII / secrets anywhere in the payload or manifest
  for (const secret of RAW_SECRETS) {
    assert.ok(!outA.jsonl.includes(secret), `IB-PT-LM JSONL leaked raw PII: ${secret}`);
    assert.ok(!outA.manifestJson.includes(secret), `IB-PT-LM manifest leaked raw PII: ${secret}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Dispatcher: format 'ib-ptlm' (and alias 'ib_ptlm') route to the IB exporter
// ---------------------------------------------------------------------------

test('U1.3: exportTrainingDataset dispatches format ib-ptlm and alias ib_ptlm to the same IB-PT-LM exporter', async () => {
  const perceived = await buildPerceived();
  const direct = exportIbPtlmJsonl(perceived);
  const viaAlias = exportTrainingDataset(perceived, { format: 'ib_ptlm' });
  const viaFlag = exportTrainingDataset(perceived, { format: 'ib-ptlm' });
  assert.equal(viaAlias.format, 'ib-ptlm');
  assert.equal(viaAlias.jsonl, direct.jsonl);
  assert.equal(viaFlag.jsonl, direct.jsonl);

  assert.throws(
    () => exportTrainingDataset(perceived, { format: 'ib-ptlm-bogus' }),
    (err) => err instanceof TypeError && /unsupported format/.test(err.message)
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u1-ib-dispatch-'));
  try {
    const written = writeTrainingDataset(direct, path.join(tmpDir, 'ib.jsonl'));
    assert.equal(fs.existsSync(written.jsonlPath), true);
    assert.equal(fs.existsSync(written.manifestPath), true);
    const onDisk = JSON.parse(fs.readFileSync(written.manifestPath, 'utf8'));
    assert.equal(onDisk.format, 'ib-ptlm');
    assert.equal(onDisk.zeroEgress, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. CLI: versieve sanitize --format ib-ptlm --export-out
// ---------------------------------------------------------------------------

test('U1.4: CLI sanitize --format ib-ptlm --export-out writes schema-valid JSONL and sidecar manifest', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u1-ib-cli-'));
  try {
    const inputPath = path.join(tmpDir, 'note.txt');
    const outTxt = path.join(tmpDir, 'note.sanitized.txt');
    const exportPath = path.join(tmpDir, 'ib-ptlm.jsonl');
    fs.writeFileSync(inputPath, `${SANITIZED_INPUTS[0].text}\n`, 'utf8');

    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI_PATH, 'sanitize', inputPath, '--out', outTxt, '--format', 'ib-ptlm', '--export-out', exportPath, '--json'],
        { encoding: 'utf8' }
      )
    );
    assert.equal(report.policyVerdict.verdict, 'ABSTAIN');
    assert.equal(fs.existsSync(exportPath), true);
    assert.equal(fs.existsSync(`${exportPath}.manifest.json`), true);

    const rows = parseJsonl(fs.readFileSync(exportPath, 'utf8'));
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.equal(row.viewA.pool, 'poolA');
      assert.equal(row.viewB.pool, 'poolB');
      assert.ok(Array.isArray(row.viewA.piiSpans) && Array.isArray(row.viewB.piiSpans));
    }
    const manifest = JSON.parse(fs.readFileSync(`${exportPath}.manifest.json`, 'utf8'));
    assert.equal(manifest.format, 'ib-ptlm');
    assert.equal(manifest.zeroEgress, true);
    assert.equal(manifest.recordCount, rows.length);
    for (const secret of RAW_SECRETS) {
      assert.ok(!fs.readFileSync(exportPath, 'utf8').includes(secret), `CLI export leaked raw PII: ${secret}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Python trainer contract: --ib-ptlm --dry-run is CPU-safe and exits 0
// ---------------------------------------------------------------------------

test('U1.5: python run-track-d-fair-lora.py --ib-ptlm --dry-run asserts pool disjointness, non-PII alignment, and beta application, then exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u1-ib-py-'));
  try {
    const outPath = path.join(tmpDir, 'ib-dry-run.json');
    const candidates = [process.env.VERSIEVE_PYTHON, 'python', 'C:/Python312/python.exe'].filter(Boolean);
    let ran = false;
    let lastErr;
    for (const py of candidates) {
      try {
        execFileSync(
          py,
          ['-I', PY_SCRIPT, '--ib-ptlm', '--dry-run', '--ib-out', outPath],
          { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        ran = true;
        break;
      } catch (err) {
        lastErr = err;
        if (err.code !== 'ENOENT') throw err;
      }
    }
    if (!ran) {
      if (lastErr) throw lastErr;
      // Python unavailable in this environment: fail loudly rather than silently passing.
      assert.fail('python interpreter not found; IB-PT-LM trainer dry-run contract cannot be verified');
    }

    const artifact = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.equal(artifact.dryRun, true);
    assert.equal(artifact.poolAudit.poolOverlapCount, 0);
    assert.ok(artifact.alignmentContract.alignedPredPosTotal >= 1, 'dry-run must verify non-PII token alignment');
    assert.equal(artifact.alignmentContract.alignmentTargetsMismatched, 0);
    assert.equal(artifact.alignmentContract.viewASurrogateEqualsViewB, false);
    assert.equal(artifact.betaContract.beta, 0.2);
    assert.equal(artifact.betaContract.betaApplied, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('U1.5b: python run-track-d-fail help still lists the default path unchanged (flags documented, default behavior untouched)', () => {
  let helpText = null;
  for (const py of [process.env.VERSIEVE_PYTHON, 'python', 'C:/Python312/python.exe'].filter(Boolean)) {
    try {
      helpText = execFileSync(py, ['-I', PY_SCRIPT, '--help'], { encoding: 'utf8', timeout: 60000 });
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // argparse erroring on unknown args is not expected here; rethrow real failures
        helpText = null;
      }
    }
  }
  assert.ok(helpText, 'python --help must run for the trainer CLI');
  // The new flags are opt-in only; default arm/dataset flags stay as before
  assert.match(helpText, /--ib-ptlm/);
  assert.match(helpText, /--ib-beta/);
  assert.match(helpText, /--ablation-arms/);
  assert.match(helpText, /--safe-train/);
});
