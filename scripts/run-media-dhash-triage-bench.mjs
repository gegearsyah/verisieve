/**
 * Stage 8 (IB-AMP) dHash keyframe-triage pruning-rate benchmark.
 *
 * No real video-keyframe fixture set exists in-repo (fixtures/ holds document samples only;
 * test/track-e-multimodal-enterprise.test.js builds ~3-frame synthetic hand-frames that are
 * too small for a curve). This run therefore uses a DETERMINISTIC SYNTHETIC fixture generator
 * (seeded LCG screen-share emulation) and reports that explicitly — numbers are traceable to
 * the seed below by re-running this script.
 *
 * Output: results/media-dhash-triage.json (pruning-rate curve + provenance).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMediaWasmSync, DEFAULT_MEDIA_WASM_PATH } from '../src/media-wasm.js';
import { selectKeyframesLazyGreedy, hamming64 } from '../src/media-dhash-triage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'results', 'media-dhash-triage.json');

// --- Deterministic fixture generator ---------------------------------------------
const SEED = 20261124;
const SEQUENCES = 6;
const SLIDES_PER_SEQ = 4;
const FRAMES_PER_SLIDE = 16;
const WIDTH = 64;
const HEIGHT = 48;
const JITTER = 3; // max +/- luma delta per pixel for in-slide sampling noise (low-amplitude)

// Mulberry32-style deterministic LCG
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t ^= t >>> 15;
    t = (t + (t << 3)) >>> 0;
    t ^= t >>> 11;
    t = (t + (t << 15)) >>> 0;
    return (t >>> 0) / 4294967296;
  };
}

// Slide = deterministic smooth multi-tonal gradient field with per-slide phase/frequency/
// amplitude (screen-share slides have texture; solid regions would poison dHash ties with
// noise-decided bits). Adjacent 9x8 grid cells differ by > 2*JITTER luma, so intra-slide
// dHash bits stay stable while distinct slides differ widely.
function makeSlide(rng, slideIndex) {
  const base = 45 + Math.floor(rng() * 150);
  const amp1 = 18 + Math.floor(rng() * 30);
  const amp2 = 12 + Math.floor(rng() * 24);
  const f1 = 1 + Math.floor(rng() * 2);
  const f2 = 1 + Math.floor(rng() * 2);
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const px = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = Math.max(0, Math.min(255, Math.round(
        base
        + amp1 * Math.sin(2 * Math.PI * f1 * (x / WIDTH) + p1)
        + amp2 * Math.sin(2 * Math.PI * f2 * (y / HEIGHT) + p2)
      )));
      const off = (y * WIDTH + x) * 3;
      px[off] = v; px[off + 1] = v; px[off + 2] = v;
    }
  }
  // Title bar along the top (keeps its own texture via a vertical ramp)
  const barV = (slideIndex % 2 === 0) ? 20 : 235;
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < 5; y++) {
      const off = (y * WIDTH + x) * 3;
      const v = Math.max(0, Math.min(255, barV + (slideIndex * 3) * (x / WIDTH)));
      px[off] = Math.round(v); px[off + 1] = Math.round(v); px[off + 2] = Math.round(v);
    }
  }
  return px;
}

function jitterFrame(slide, rng) {
  const px = slide.slice();
  for (let i = 0; i < px.length; i++) {
    const d = Math.floor(rng() * (2 * JITTER + 1)) - JITTER;
    px[i] = Math.max(0, Math.min(255, px[i] + d));
  }
  return px;
}

function buildFixtures() {
  const rng = makeRng(SEED);
  const sequences = [];
  for (let s = 0; s < SEQUENCES; s++) {
    const slides = [];
    for (let sl = 0; sl < SLIDES_PER_SEQ; sl++) slides.push(makeSlide(rng, sl));
    const frames = [];
    for (const slide of slides) {
      for (let f = 0; f < FRAMES_PER_SLIDE; f++) frames.push(jitterFrame(slide, rng));
    }
    sequences.push({ slides, frames });
  }
  return sequences;
}

// --- Measurement -------------------------------------------------------------------
function run() {
  const engine = loadMediaWasmSync();
  const wasmSha = crypto.createHash('sha256').update(fs.readFileSync(DEFAULT_MEDIA_WASM_PATH)).digest('hex');
  const sequences = buildFixtures();

  const hashesBySeq = sequences.map((seq) =>
    seq.frames.map((px) => engine.computePerceptualDhash64(px, WIDTH, HEIGHT, 3))
  );

  // Sanity stats: intra-slide vs cross-slide Hamming distance over the first sequence.
  const intra = [];
  const cross = [];
  for (let i = 0; i < FRAMES_PER_SLIDE; i++) {
    for (let j = i + 1; j < FRAMES_PER_SLIDE; j++) {
      intra.push(hamming64(hashesBySeq[0][i], hashesBySeq[0][j]));
    }
  }
  for (let i = 0; i < FRAMES_PER_SLIDE; i++) {
    for (let j = FRAMES_PER_SLIDE; j < 2 * FRAMES_PER_SLIDE; j++) {
      cross.push(hamming64(hashesBySeq[0][i], hashesBySeq[0][j]));
    }
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const COVERAGE_HAMMING = 8;
  const budgets = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32];
  const pruningCurve = [];
  for (const budget of budgets) {
    const rates = [];
    const evals = [];
    const keys = [];
    for (const hashes of hashesBySeq) {
      const rep = selectKeyframesLazyGreedy(hashes, { budget, coverageHamming: COVERAGE_HAMMING });
      rates.push(rep.pruningRate);
      evals.push(rep.evaluations);
      keys.push(rep.keyframes.length);
    }
    pruningCurve.push({
      budget,
      framesPerSequence: FRAMES_PER_SLIDE * SLIDES_PER_SEQ,
      meanKeyframesSelected: mean(keys),
      meanPruningRate: Number(mean(rates).toFixed(4)),
      minPruningRate: Number(Math.min(...rates).toFixed(4)),
      maxPruningRate: Number(Math.max(...rates).toFixed(4)),
      meanLazyGreedyHashComparisons: Number(mean(evals).toFixed(1)),
    });
  }

  // Suppression-only curve: unconstrained budget -> pruning reflects near-duplicate
  // suppression alone (how many jitter frames each scene's keyframe absorbs).
  const suppression = hashesBySeq.map((hashes, idx) => {
    const rep = selectKeyframesLazyGreedy(hashes, { coverageHamming: COVERAGE_HAMMING });
    return {
      sequenceIndex: idx,
      frames: hashes.length,
      keyframesSelected: rep.keyframes.length,
      pruningRate: Number(rep.pruningRate.toFixed(4)),
    };
  });

  // Corpus-level point: the full 384-frame set selected jointly, budget = 24.
  const corpus = [];
  for (const hashes of hashesBySeq) corpus.push(...hashes);
  const corpusRep = selectKeyframesLazyGreedy(corpus, { budget: 24, coverageHamming: COVERAGE_HAMMING });

  const report = {
    artifact: 'results/media-dhash-triage.json',
    generatedBy: 'node scripts/run-media-dhash-triage-bench.mjs',
    fixtureKind: 'deterministic SYNTHETIC (seeded LCG screen-share emulation) — no real video-keyframe fixture set exists in-repo',
    fixture: {
      seed: SEED,
      sequences: SEQUENCES,
      slidesPerSequence: SLIDES_PER_SEQ,
      framesPerSlide: FRAMES_PER_SLIDE,
      totalFrames: SEQUENCES * SLIDES_PER_SEQ * FRAMES_PER_SLIDE,
      frameWidth: WIDTH,
      frameHeight: HEIGHT,
      channels: 3,
      jitterModel: `per-pixel luma delta in +/-${JITTER} (LCG, seed ${SEED})`,
    },
    dhashKernel: {
      export: 'vs_media_perceptual_dhash64',
      algorithm: 'dHash: 9x8 nearest-neighbor grid, integer BT.601 luma, bit y*8+c set iff grid[y][c] > grid[y][c+1]',
      wasmSha256: wasmSha.toUpperCase(),
      wasmBytes: fs.readFileSync(DEFAULT_MEDIA_WASM_PATH).length,
    },
    selector: {
      algorithm: 'Minoux lazy-greedy coverage maximization with near-duplicate suppression (coverageHamming threshold)',
      approximationGuarantee: 'at least (1 - 1/e)/2 of optimal coverage — plain lazy-greedy under a cardinality budget; the full (1 - 1/e) is NOT claimed (no Sviridenko partial enumeration implemented)',
      coverageHamming: COVERAGE_HAMMING,
    },
    hashSeparation: {
      intraSlideMeanHamming: Number(mean(intra).toFixed(2)),
      intraslideMaxHamming: Math.max(...intra),
      crossSlideMeanHamming: Number(mean(cross).toFixed(2)),
      crossSlideMinHamming: Math.min(...cross),
      separateAtHamming: COVERAGE_HAMMING,
    },
    pruningCurve,
    suppressionUnconstrained: suppression,
    corpusLevel: {
      totalFrames: corpus.length,
      budget: 24,
      meanKeyframesSelected: corpusRep.keyframes.length,
      pruningRate: Number(corpusRep.pruningRate.toFixed(4)),
      lazyGreedyHashComparisons: corpusRep.evaluations,
    },
    notes: [
      'All pruning-rate numbers are measured on the synthetic fixtures above, not assumed.',
      '"pruningRate" = frames not selected as keyframes / total frames (the triage decision).',
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out: OUT, intraMean: mean(intra), intraMax: Math.max(...intra), crossMean: mean(cross), crossMin: Math.min(...cross) }));
  console.log(JSON.stringify(pruningCurve, null, 1));
  console.log(JSON.stringify(report.corpusLevel));
}

run();
