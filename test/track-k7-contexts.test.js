import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTrackK7Contexts } from '../scripts/build-track-k7-contexts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/noisy-estate-manifest.json');
const ARTIFACT_PATH = path.join(ROOT, 'results/track-k7-bm25-contexts.json');

function qidKeys(payload) {
  return Object.keys(payload).filter((key) => /^q-\d+$/.test(key));
}

test('K7 contexts 1: two builds over the same estate bytes are byte-identical', () => {
  const runA = buildTrackK7Contexts();
  const runB = buildTrackK7Contexts();

  assert.equal(typeof runA.json, 'string');
  assert.ok(Buffer.byteLength(runA.json, 'utf8') > 0);
  assert.equal(runB.json, runA.json, 'two runs with identical inputs must emit byte-identical JSON');
});

test('K7 contexts 2: every manifest qid has a non-empty top-6 context', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const { payload } = buildTrackK7Contexts();
  const qids = qidKeys(payload);

  assert.equal(qids.length, manifest.questions.length, `manifest has ${manifest.questions.length} questions, artifact has ${qids.length}`);
  for (const q of manifest.questions) {
    const context = payload[q.qid];
    assert.equal(typeof context, 'string', `qid ${q.qid} must carry a string context`);
    assert.ok(context.trim().length > 0, `qid ${q.qid} must have a non-empty context`);
    const headers = context.split('\n').filter((line) => /^\[[^\]]+\]$/.test(line));
    assert.equal(headers.length, 6, `qid ${q.qid} must render exactly 6 passage headers, got ${headers.length}`);
  }
});

test('K7 contexts 3: the committed artifact matches a fresh regeneration', () => {
  assert.ok(fs.existsSync(ARTIFACT_PATH), 'results/track-k7-bm25-contexts.json must be generated and committed');
  const committed = fs.readFileSync(ARTIFACT_PATH);
  const fresh = Buffer.from(buildTrackK7Contexts().json, 'utf8');
  assert.equal(committed.toString('hex'), fresh.toString('hex'), 'committed artifact is stale versus a fresh regeneration');
});
