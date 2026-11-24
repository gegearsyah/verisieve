#!/usr/bin/env node
/**
 * Stage 9 fixture: synthetic 2-speaker dialogue -> prosody kernel -> speaker-clustering-lite.
 *
 * Own experiment on synthetic dialogues. The engine observes ONLY WAV bytes; the
 * known ground truth (which turn belongs to which speaker) lives in this generator
 * and is never sent to the wasm binary — engine and labels are separated by construction.
 *
 * Deterministic: mulberry32 seeded PRNG, seed 0x56455253. No external audio files.
 * Output: results/media-prosody-speaker-clustering.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMediaWasmSync } from '../src/media-wasm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 0x56455253; // deterministic; every generated number traces back to this
const SAMPLE_RATE = 16000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two synthetic voices: different F0 base, harmonic mix, and HF tilt.
const SPEAKER_F0 = { A: 118, B: 205 };
const SPEAKER_HARM = {
  A: [0.30, 0.10, 0.04, 0.015],
  B: [0.22, 0.14, 0.09, 0.05],
};

function generateDialogue() {
  const rnd = mulberry32(SEED);
  const samples = [0.0];
  const turns = [];
  const wordSpans = [];
  const TURN_COUNT = 12;
  for (let t = 0; t < TURN_COUNT; t++) {
    const spk = t % 2 === 0 ? 'A' : 'B';
    const f0 = SPEAKER_F0[spk] * (1 + 0.02 * (rnd() - 0.5));
    const harm = SPEAKER_HARM[spk];
    const startSample = samples.length;
    const durSamples = Math.round((1.2 + 1.2 * rnd()) * SAMPLE_RATE);
    const startMs = Math.round(((startSample - 1) / SAMPLE_RATE) * 1000); // -1: 1-sample lead-in
    const turnDurMs = Math.round((durSamples / SAMPLE_RATE) * 1000);
    turns.push({ speaker: spk, startMs, endMs: startMs + turnDurMs });
    // pseudo-words (~340 ms each) laid over the turn; used only for wpm
    const wordCount = Math.max(2, Math.round((durSamples / SAMPLE_RATE) / 0.34));
    for (let w = 0; w < wordCount; w++) {
      const ws = startMs + Math.round((w / wordCount) * turnDurMs);
      const we = startMs + Math.round(((w + 0.85) / wordCount) * turnDurMs);
      wordSpans.push({ startMs: ws, endMs: we });
    }
    for (let i = 0; i < durSamples; i++) {
      const x = i / SAMPLE_RATE;
      const phase = 2 * Math.PI * f0 * x;
      // syllable-like amplitude envelope (~4.2 Hz) + weak pause gate
      const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * x + (spk === 'A' ? 0 : 1.3));
      const gate = env > 0.15 ? env : 0.02;
      let s = 0;
      for (let h = 1; h <= 4; h++) {
        s += harm[h - 1] * Math.sin(h * phase + h * (spk === 'A' ? 0.4 : 0.9));
      }
      s *= gate;
      s += 0.004 * (rnd() - 0.5); // tiny noise floor
      samples.push(s);
    }
    samples.push(1e-6); // boundary sample so silence gaps exist
    const gapMs = Math.round(250 + 200 * rnd());
    const gapSamples = Math.round((gapMs / 1000) * SAMPLE_RATE);
    for (let i = 0; i < gapSamples; i++) samples.push(0.0);
  }
  return { samples, turns, wordSpans };
}

function encodeWavPcm16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return buf;
}

function main() {
  const { samples, turns, wordSpans } = generateDialogue();
  const wav = encodeWavPcm16(samples, SAMPLE_RATE);

  const engine = loadMediaWasmSync();
  const { clusterCount, meta } = engine.prosodyAnalyze(wav, { wordSpansMs: wordSpans, maxClusters: 8 });
  const segments = meta.segments;

  // Ground truth per engine segment: turn whose [startMs,endMs) contains the segment midpoint.
  // GT comes from this generator only; the engine saw only the WAV bytes.
  const gtOf = (seg) => {
    const mid = (seg.startMs + seg.endMs) / 2;
    const turn = turns.find((t) => mid >= t.startMs && mid <= t.endMs);
    return turn ? turn.speaker : null;
  };

  const perSegment = segments.map((s, i) => ({ i, ...s, gt: gtOf(s) }));
  const purityInputs = new Map();
  let matched = 0;
  for (const s of perSegment) {
    if (!purityInputs.has(s.cluster)) purityInputs.set(s.cluster, {});
    const bucket = purityInputs.get(s.cluster);
    bucket[s.gt] = (bucket[s.gt] ?? 0) + 1;
    if (s.gt) matched++;
  }
  let majority = 0;
  const purityInputsJson = {};
  for (const [c, bucket] of purityInputs) {
    purityInputsJson[`cluster ${c}`] = bucket;
    // majority over GT speakers only — null-GT segments (VAD gaps) must not inflate purity
    const gtCounts = Object.entries(bucket).filter(([g]) => g !== 'null').map(([, v]) => v);
    majority += gtCounts.length ? Math.max(...gtCounts) : 0;
  }
  const purity = majority / perSegment.filter((s) => s.gt).length;

  const summary = {};
  for (const spk of ['A', 'B']) {
    const segs = perSegment.filter((s) => s.gt === spk);
    const avg = (k) => segs.reduce((a, s) => a + s[k], 0) / (segs.length || 1);
    summary[spk] = {
      segments: segs.length,
      meanF0Hz: +avg('f0Hz').toFixed(2),
      meanRmsDb: +avg('rmsDb').toFixed(2),
      meanZcr: +avg('zcr').toFixed(4),
      meanTiltDb: +avg('tiltDb').toFixed(2),
      meanWpm: +avg('wpm').toFixed(2),
    };
  }

  const artifact = {
    kind: 'media-prosody-speaker-clustering',
    stage: 9,
    own_experiment_note:
      'Own experiment on synthetic dialogues. Reference points such as pyannote 3.1 reference DERs (AMI ~18.8% etc.) come from different protocols and datasets; no classical-benchmark comparison is implied and no purity target is asserted here — the purity number is measured and reported as-is for the founder to judge.',
    anti_circularity_note:
      'Ground truth lives ONLY in this generator (turn/speaker assignment). The wasm kernel receives the PCM16 WAV bytes and word-span timing pairs; it never receives speaker labels or turn boundaries. Purity is computed here, outside the engine.',
    seed: SEED,
    generator: {
      sampleRate: SAMPLE_RATE,
      turnCount: turns.length,
      turns: turns.map((t, i) => ({ index: i, speaker: t.speaker, startMs: t.startMs, endMs: t.endMs })),
      pseudoWordCount: wordSpans.length,
      wpmSource: 'word_spans_from_generator',
    },
    wasm: {
      path: 'vendor/wasm/verisieve_media.wasm',
      sizeBytes: fs.statSync(path.join(ROOT, 'vendor/wasm/verisieve_media.wasm')).size,
      abiVersion: engine.abiVersion,
    },
    engineResult: {
      clusterCount,
      segmentCount: segments.length,
      truncatedToMax: meta.truncatedToMax,
      vadWindowMs: meta.vadWindowMs,
      vadRmsThreshold: meta.vadRmsThreshold,
    },
    purity: {
      value: +purity.toFixed(4),
      definition:
        'For each engine cluster, take the majority ground-truth speaker among its segments; purity = (segments counted under the cluster majority speaker) / (all segments with GT). Known turn boundaries define GT per segment via its time midpoint.',
      matchedSegments: matched,
      purityInputs: purityInputsJson,
    },
    perSpeakerSummary: summary,
    segments: perSegment.map((s) => ({
      index: s.index, startMs: s.startMs, endMs: s.endMs, gtSpeaker: s.gt,
      f0Hz: s.f0Hz, f0StdHz: s.f0StdHz, rmsDb: s.rmsDb, zcr: s.zcr, tiltDb: s.tiltDb,
      wpm: s.wpm, wpmWordCount: s.wpmWordCount, cluster: s.cluster,
      voicedFrames: s.voicedFrames, totalFrames: s.totalFrames,
    })),
  };

  const outPath = path.join(ROOT, 'results/media-prosody-speaker-clustering.json');
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    clusterCount,
    segmentCount: segments.length,
    purity: +purity.toFixed(4),
    wasmSize: artifact.wasm.sizeBytes,
    out: path.relative(ROOT, outPath),
  }));
}

main();
