/**
 * External-behavior tests for the dHash keyframe triage module
 * (Stage 8 — IB-AMP perceptual-hash triage, honestly bounded).
 *
 * Contract under test:
 * - src/media-wasm.js exposes computePerceptualDhash64(pixels, width, height, channels) -> BigInt
 * - src/media-dhash-triage.js exposes selectKeyframesLazyGreedy(hashes, options) -> report
 *   implementing Minoux lazy-greedy submodular maximization with near-duplicate suppression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadMediaWasmSync } from '../src/media-wasm.js';
import { selectKeyframesLazyGreedy, hamming64 } from '../src/media-dhash-triage.js';

// 9x8 RGB frame where every pixel in column i has gray value v (R=G=B=v).
function gradientRowFrame(rowValues) {
  const px = new Uint8Array(9 * 8 * 3);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      const v = rowValues(x, y);
      const off = (y * 9 + x) * 3;
      px[off] = v; px[off + 1] = v; px[off + 2] = v;
    }
  }
  return px;
}

test('wasm dhash kernel: known 64-bit vector and duplicate invariance', () => {
  const engine = loadMediaWasmSync();
  // Hand-derived vector (9x8 grid, R=G=B rows: increasing / decreasing / flat /
  // alternating / spike / alternating / flat) — must match the Rust unit test.
  const rows = [
    [0, 8, 16, 24, 32, 40, 48, 56, 64],
    [64, 56, 48, 40, 32, 24, 16, 8, 0],
    [100, 100, 100, 100, 100, 100, 100, 100, 100],
    [10, 0, 10, 0, 10, 0, 10, 0, 10],
    [0, 10, 0, 10, 0, 10, 0, 10, 0],
    [128, 128, 128, 128, 200, 128, 128, 128, 128],
    [200, 128, 200, 128, 200, 128, 200, 128, 200],
    [25, 25, 25, 25, 25, 25, 25, 25, 25],
  ];
  const px = new Uint8Array(9 * 8 * 3);
  rows.forEach((row, y) => row.forEach((v, x) => {
    px[(y * 9 + x) * 3] = v; px[(y * 9 + x) * 3 + 1] = v; px[(y * 9 + x) * 3 + 2] = v;
  }));
  assert.equal(engine.computePerceptualDhash64(px, 9, 8, 3), 0x005510AA5500FF00n);

  // Bit-identical frame -> identical hash (near-duplicate suppression precondition)
  assert.equal(engine.computePerceptualDhash64(px, 9, 8, 3), 0x005510AA5500FF00n);

  // Degenerate input -> 0n, no throw
  assert.equal(engine.computePerceptualDhash64(new Uint8Array(0), 0, 0, 3), 0n);
});

test('selector suppresses near-duplicates down to the budget', () => {
  const engine = loadMediaWasmSync();
  const base = gradientRowFrame((x) => x * 8);       // horizontal ramp "slide A"
  const dupeA = gradientRowFrame((x) => x * 8);      // identical copy of A
  const nearA = gradientRowFrame((x, y) => (y === 0 ? 63 - x * 7 : x * 8)); // row-0 flip only
  const other = gradientRowFrame((x) => 255 - x * 8); // reversed ramp "slide B"

  const hashes = [
    engine.computePerceptualDhash64(base, 9, 8, 3),
    engine.computePerceptualDhash64(dupeA, 9, 8, 3),
    engine.computePerceptualDhash64(nearA, 9, 8, 3),
    engine.computePerceptualDhash64(other, 9, 8, 3),
  ];
  const report = selectKeyframesLazyGreedy(hashes, { coverageHamming: 8 });
  // Slide A (+ its near-duplicates) and slide B must both be represented;
  // everything else is pruned.
  assert.equal(report.keyframes.length, 2);
  assert.ok(report.keyframes[0] < 3, 'first pick must be a slide-A frame');
  assert.ok(report.keyframes.includes(3));
  assert.equal(report.prunedCount, 2);
  assert.ok(report.pruningRate >= 0 && report.pruningRate <= 1);
  // Coverage: every input frame is represented by a selected keyframe or suppressed
  // as a near-duplicate of one.
  assert.equal(report.covered.length, hashes.length);
  assert.deepEqual([...report.prunedIndices].sort(), [0, 1]);
  // The 2x2-uniform upscale hashes identically -> exact duplicate suppressed to the seed
  const dup = report.keyframes.filter((idx) => idx < 3);
  assert.equal(dup.length, 1, 'exactly one slide-A representative');
});

test('selector respects the cardinality budget and reports pruning', () => {
  // Well-separated hashes with exact-match coverage: 20 distinct frames, budget 5.
  const hashes = Array.from({ length: 40 }, (_, i) => BigInt(i + 1) * 0x8040201008040201n);
  const report = selectKeyframesLazyGreedy(hashes.slice(0, 20), { budget: 5, coverageHamming: 0 });
  assert.equal(report.keyframes.length, 5);
  assert.equal(report.prunedCount, 15);
  assert.ok(Math.abs(report.pruningRate - 0.75) < 1e-9);
});

test('selector is deterministic across runs', () => {
  const hashes = Array.from({ length: 40 }, (_, i) => BigInt(i * 7 + (i % 5)));
  const a = selectKeyframesLazyGreedy(hashes, { budget: 6, coverageHamming: 4 });
  const b = selectKeyframesLazyGreedy(hashes, { budget: 6, coverageHamming: 4 });
  assert.deepEqual(a.keyframes, b.keyframes);
  assert.ok(a.keyframes.every((idx) => idx >= 0 && idx < 40));
});

test('hamming64 counts differing bits for BigInt u64 values', () => {
  assert.equal(hamming64(0n, 0n), 0);
  assert.equal(hamming64(0n, 0xffn), 8);
  assert.equal(hamming64(0x005510AA5500FF00n, 0x005510AA5500FF00n), 0);
  assert.equal(hamming64(0x005510AA5500FF00n, ~0x005510AA5500FF00n & 0xffffffffffffffffn), 64);
});

test('selector degenerate inputs do not throw', () => {
  assert.deepEqual(selectKeyframesLazyGreedy([], { coverageHamming: 8 }).keyframes, []);
  const one = [42n];
  assert.deepEqual(selectKeyframesLazyGreedy(one, { coverageHamming: 8 }).keyframes, [0]);
  // budget=0 -> still selects the first frame (budget < 1 is clamped to 1) rather than nothing
  const two = [1n, 2n];
  assert.equal(selectKeyframesLazyGreedy(two, { budget: 0, coverageHamming: 8 }).keyframes.length, 1);
});
