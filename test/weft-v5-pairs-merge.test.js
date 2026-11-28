import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EVAL_SLICE_PCT,
  WeftMergeConfigError,
  mergeWeftV5Pairs,
  strataPairToCompilerFormat,
} from '../scripts/merge-weft-v5-pairs.mjs';

// W-MERGE contract tests: tiny fixtures in temp dirs, offline.
const KNOWLEDGE = 'The retention schedule for archived transaction records must keep every quarterly ledger for 7 years and destroy superseded copies after the annual review.';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'weft-merge-'));
}

function compilerRow(id, pairType, label) {
  return {
    id,
    policy: 'weft-pairs-v1',
    pairType,
    label,
    textA: KNOWLEDGE,
    textB: KNOWLEDGE,
    provenance: {
      docIds: [`${id}-a`, `${id}-b`],
      sources: ['synthetic-estate'],
      identityOverlap: 0,
      identityDisjoint: true,
    },
  };
}

function profileFixture(dir, id) {
  const corpus = {
    docs: [
      {
        id: `${id}-anchor-1`, format: 'email', department: 'ops', theme: 'alpha',
        text: KNOWLEDGE, source: 'synthetic-estate',
        identities: [{ key: 'emp-1', surface: 'Person One', class: 'person' }],
      },
    ],
    links: [],
  };
  const compilerDir = path.join(dir, `${id}-compiler`);
  fs.mkdirSync(compilerDir, { recursive: true });
  fs.writeFileSync(path.join(compilerDir, 'train.jsonl'), JSON.stringify(compilerRow(`${id}-t1`, 'identity-masked-positive', 'positive')) + '\n');
  fs.writeFileSync(path.join(compilerDir, 'eval.jsonl'), JSON.stringify(compilerRow(`${id}-e1`, 'identity-matched-theme-different-negative', 'negative')) + '\n');
  const strataDir = path.join(dir, `${id}-strata`);
  fs.mkdirSync(strataDir, { recursive: true });
  const strataPair = {
    label: 'source-disjoint-same-theme-positive',
    a: `${id}-anchor-1`,
    b: {
      id: `${id}-para-1`, format: 'ticket', department: 'finance', theme: 'alpha',
      text: 'Fresh wording of the same alpha matter with invented names and no reused phrasing at all.',
      identities: [{ key: 'emp-2', surface: 'Person Two', class: 'person' }],
    },
    sourceDocId: `${id}-source-1`,
    theme: 'alpha',
    eventA: `${id}-anchor-1`,
    eventB: `${id}-para-1`,
    provenance: 'paraphrase-of:x',
  };
  fs.writeFileSync(path.join(strataDir, 'strata-pairs.jsonl'), JSON.stringify(strataPair) + '\n');
  const corpusPath = path.join(dir, `${id}-corpus.json`);
  fs.writeFileSync(corpusPath, JSON.stringify(corpus) + '\n');
  return { id, compilerDir, strataDir, extensionDir: null, corpusPath };
}

test('W-MERGE 1: strata pairs convert to compiler format with corpus-resolved anchors', () => {
  const corpusDocById = new Map([[ 'anchor-1', {
    id: 'anchor-1', format: 'email', department: 'ops', theme: 'alpha',
    text: KNOWLEDGE, identities: [{ key: 'emp-1', surface: 'Person One', class: 'person' }],
  } ]]);
  const pair = {
    label: 'source-disjoint-same-theme-positive',
    a: 'anchor-1',
    b: { id: 'para-1', format: 'ticket', department: 'finance', theme: 'alpha', text: 'fresh wording', identities: [{ key: 'emp-2', surface: 'Person Two', class: 'person' }] },
    eventA: 'anchor-1',
    eventB: 'para-1',
  };
  const row = strataPairToCompilerFormat(pair, corpusDocById);
  assert.equal(row.textA, KNOWLEDGE);
  assert.equal(row.textB, 'fresh wording');
  assert.equal(row.label, 'positive');
  assert.equal(row.pairType, 'source-disjoint-same-theme-positive');
  assert.equal(row.provenance.identityDisjoint, true);
  assert.equal(row.provenance.sourceKindA, 'thread');
  assert.equal(row.provenance.eventA, 'anchor-1');
  // Fail-closed: an unknown anchor is a typed error.
  assert.throws(() => strataPairToCompilerFormat({ ...pair, a: 'missing-1' }, corpusDocById), WeftMergeConfigError);
});

test('W-MERGE 2: the merge splits, dedupes, and balances, and writes the receipt', () => {
  const dir = tempDir();
  try {
    const profile = profileFixture(dir, 'p1');
    const outDir = path.join(dir, 'merged');
    const { train, evalRows, receipt } = mergeWeftV5Pairs({ profiles: [profile], outDir });
    // Compiler splits are respected; strata go through the hash slice.
    assert.ok(train.some((r) => r.id === 'p1-t1'));
    assert.ok(evalRows.some((r) => r.id === 'p1-e1'));
    const strataRow = [...train, ...evalRows].find((r) => r.pairType === 'source-disjoint-same-theme-positive');
    assert.ok(strataRow, 'the strata pair landed somewhere');
    assert.ok(receipt.perProfile.p1['coverage-train'].train === 1);
    assert.ok(receipt.perProfile.p1['strata'].train + receipt.perProfile.p1['strata'].eval === 1);
    assert.equal(receipt.evalSlicePct, EVAL_SLICE_PCT);
    assert.ok(receipt.identityOverlapBalance['source-disjoint-same-theme-positive'].positiveMean === 0);
    assert.ok(fs.existsSync(path.join(outDir, 'train.jsonl')));
    assert.ok(fs.existsSync(path.join(outDir, 'eval.jsonl')));
    assert.ok(fs.existsSync(path.join(outDir, 'merge-receipt.json')));
    // A second run is deterministic: identical receipt counts.
    const again = mergeWeftV5Pairs({ profiles: [profile], outDir: path.join(dir, 'merged2') });
    assert.deepEqual(again.receipt.counts, receipt.counts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-MERGE 3: held-out pairs never enter training and cross-set collisions fail closed', () => {
  const dir = tempDir();
  try {
    const profile = profileFixture(dir, 'p1');
    const heldout = profileFixture(dir, 'h1');
    const { train, heldout: heldoutRows, receipt } = mergeWeftV5Pairs({ profiles: [profile], heldout, outDir: path.join(dir, 'm') });
    assert.equal(heldoutRows.length >= 2, true);
    assert.ok(!train.some((r) => r.id.startsWith('h1-')));
    assert.ok(heldoutRows.some((r) => r.pairType === 'source-disjoint-same-theme-positive'));
    assert.equal(receipt.counts.heldout, heldoutRows.length);
    // Collision: the same pair id in two profiles is a typed failure.
    const evil = profileFixture(dir, 'p2');
    fs.writeFileSync(path.join(evil.compilerDir, 'train.jsonl'), JSON.stringify(compilerRow('p1-t1', 'identity-masked-positive', 'positive')) + '\n');
    assert.throws(() => mergeWeftV5Pairs({ profiles: [profile, evil] }), WeftMergeConfigError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
