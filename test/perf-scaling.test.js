import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { deduplicateChunks } from '../src/ingestor.js';
import { embedNeedleWasm, searchNeedleWasm } from '../src/wasm-needle-dl.js';
import { PortableDocumentGraph } from '../src/graph-wasm.js';
import { scanRecordsForPII } from '../src/clean-and-tokenize.js';

test('deduplicateChunks scales linearly to 3,000 chunks with MinHash+LSH and catches exact + near duplicates', () => {
  const chunks = [];
  for (let i = 0; i < 2900; i++) {
    chunks.push({
      id: `u-${i}`,
      text: `Compliance guideline section ${i} governs statutory reporting obligations for entity cohort alpha-${i} under privacy rulebook chapter ${i % 47} schedule ${i % 19}.`,
    });
  }
  // 50 exact duplicates
  for (let i = 0; i < 50; i++) {
    chunks.push({ id: `exact-${i}`, text: chunks[i].text });
  }
  // 50 near-duplicates (>90% 3-gram overlap)
  for (let i = 50; i < 100; i++) {
    chunks.push({
      id: `near-${i}`,
      text: `${chunks[i].text} updated`,
    });
  }

  const t0 = performance.now();
  const res = deduplicateChunks(chunks, { threshold: 0.85 });
  const elapsedMs = performance.now() - t0;

  assert.equal(res.uniqueChunks.length, 2900, 'all 2900 unique chunks preserved');
  assert.equal(res.duplicatesRemoved, 100, 'all 50 exact + 50 near duplicates removed');
  assert.ok(elapsedMs < 2000, `expected <2000ms for 3,000 chunks, got ${elapsedMs.toFixed(1)}ms`);
});

test('embedNeedleWasm subwordOnly + searchNeedleWasm scales to 1,200 docs in <1s', () => {
  const docs = [];
  for (let i = 0; i < 1199; i++) {
    docs.push(`Standard administrative memorandum ${i} detailing quarterly office logistics and procurement cycle ${i % 31}.`);
  }
  docs.push('Small business operators related to an APP entity under section 6D(9) of the Privacy Act must comply with Australian Privacy Principles.');

  const t0 = performance.now();
  const res = searchNeedleWasm('APP entity small business operator Privacy Act section 6D', docs, { topK: 5 });
  const elapsedMs = performance.now() - t0;

  assert.equal(res.length, 5);
  assert.equal(res[0].index, 1199, 'gold compliance doc ranked #1');
  assert.ok(elapsedMs < 1500, `expected <1500ms for 1,200 docs, got ${elapsedMs.toFixed(1)}ms`);

  const vec = embedNeedleWasm('privacy compliance check', { subwordOnly: true });
  assert.equal(vec.length, 64);
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) normSq += vec[i] * vec[i];
  assert.ok(Math.abs(Math.sqrt(normSq) - 1) < 1e-4, 'subwordOnly embedding must be unit-normalized');
});

test('PortableDocumentGraph reuses cached BM25 inverted index and adjacency maps across repeated queries', () => {
  const lines = ['# Privacy Compliance Handbook'];
  for (let i = 0; i < 50; i++) {
    lines.push(`\n## Section ${i + 1} Rules`);
    for (let j = 0; j < 10; j++) {
      lines.push(`\nParagraph ${i}-${j}: An entity operating in sector ${i} must maintain records for period ${j + 3} years under audit rule R-${i}-${j}.`);
    }
  }
  lines.push('\n## Section 51 Special Exemption');
  lines.push('\nSpecial statutory exemption applies to Dr Alice Mercer (alice.mercer@example.org) regarding cross-border telemetry transfer.');

  const graph = new PortableDocumentGraph({ workspaceSalt: 'perf-test-salt' });
  graph.indexDocuments([{ source: 'handbook.md', text: lines.join('\n') }]);

  const t0 = performance.now();
  let lastRes = null;
  for (let q = 0; q < 50; q++) {
    lastRes = graph.pprRetrieve('special statutory exemption cross-border telemetry transfer', { topK: 3 });
  }
  const elapsedMs = performance.now() - t0;

  assert.ok(lastRes && lastRes.rankedPassages.length > 0);
  assert.ok(lastRes.rankedPassages[0].textRedacted.includes('cross-border telemetry transfer'));
  assert.ok(!lastRes.rankedPassages[0].textRedacted.includes('alice.mercer@example.org'), 'raw PII never leaked');
  assert.ok(elapsedMs < 1500, `expected 50 repeated PPR queries on 501 passages in <1500ms, got ${elapsedMs.toFixed(1)}ms`);

  const tree = graph.getDocumentTree();
  assert.equal(tree.length, 1);
  assert.ok(tree[0].nodes.length >= 1);
});

test('scanRecordsForPII reuses precompiled regexes with zero state bleed across 2,000 scans', () => {
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) {
    const hits = scanRecordsForPII(`Contact jane.doe${i}@example.com or call 0412-345-678 for record #${i}.`);
    assert.ok(hits.some((h) => h.type === 'email'), `iteration ${i} must detect email`);
    assert.ok(hits.some((h) => h.type === 'phone'), `iteration ${i} must detect phone`);
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 1500, `expected 2,000 PII scans in <1500ms, got ${elapsedMs.toFixed(1)}ms`);
});
