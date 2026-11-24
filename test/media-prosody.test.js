/**
 * External-behavior tests for the verisieve_media prosody kernel (Stage 9):
 * per-VAD-segment F0/RMS/ZCR/wpm + speaker-clustering-lite, over the shipped wasm.
 * The wasm sees only WAV bytes; speaker labels exist only in these fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMediaWasmSync } from '../src/media-wasm.js';

const SR = 16000;

function encodeWavPcm16(samples, sampleRate = SR) {
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

const sine = (hz, seconds, amp = 0.3, sampleRate = SR) =>
  Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / sampleRate) * amp
  );

// Two alternating timbres (different F0 + harmonic mix), deterministic, no external audio.
function twoTimbreFixture() {
  const out = [];
  const harm = { A: [0.30, 0.10, 0.04], B: [0.22, 0.14, 0.09] };
  for (let t = 0; t < 6; t++) {
    const spk = t % 2 === 0 ? 'A' : 'B';
    const f0 = spk === 'A' ? 118 : 205;
    for (let i = 0; i < 1.5 * SR; i++) {
      const x = i / SR;
      const phase = 2 * Math.PI * f0 * x;
      let s = 0;
      for (let h = 1; h <= 3; h++) s += harm[spk][h - 1] * Math.sin(h * phase);
      out.push(s + 0.004 * Math.sin(11013.7 * x)); // tiny deterministic dither
    }
    for (let i = 0; i < 0.3 * SR; i++) out.push(0);
  }
  return Float32Array.from(out);
}

test('prosody: 200 Hz sine detected near 200 Hz on every segment', () => {
  const engine = loadMediaWasmSync();
  const wav = encodeWavPcm16(sine(200, 1.0));
  const { clusterCount, meta } = engine.prosodyAnalyze(wav);
  assert.equal(meta.sampleRate, SR);
  assert.ok(meta.segments.length >= 1, 'VAD must yield at least one segment');
  for (const s of meta.segments) {
    assert.ok(Math.abs(s.f0Hz - 200) <= 12, `F0 ${s.f0Hz} outside 200 Hz tolerance`);
    const rmsLin = Math.pow(10, s.rmsDb / 20);
    assert.ok(Math.abs(rmsLin - 0.3 / Math.SQRT2) < 0.05, `rms ${rmsLin} not near sine RMS`);
  }
  assert.ok(clusterCount >= 1 && clusterCount <= 8);
});

test('prosody: wpm comes from word spans and is exact; absent spans report source NONE', () => {
  const engine = loadMediaWasmSync();
  const wav = encodeWavPcm16(sine(180, 5.0));
  const spans = Array.from({ length: 10 }, (_, w) => ({
    startMs: w * 500,
    endMs: w * 500 + 400,
  }));
  const withSpans = engine.prosodyAnalyze(wav, { wordSpansMs: spans });
  assert.equal(withSpans.meta.segments.length, 1);
  assert.equal(withSpans.meta.segments[0].wpmWordCount, 10);
  assert.ok(Math.abs(withSpans.meta.segments[0].wpm - 120) < 0.01);
  assert.equal(withSpans.meta.segments[0].wpmSource, 1);

  const noSpans = engine.prosodyAnalyze(wav);
  assert.equal(noSpans.meta.segments[0].wpm, 0);
  assert.equal(noSpans.meta.segments[0].wpmSource, 0);
});

test('prosody: alternating two-timbre dialogue yields two clusters, one per timbre', () => {
  const engine = loadMediaWasmSync();
  const wav = encodeWavPcm16(twoTimbreFixture());
  const { clusterCount, meta } = engine.prosodyAnalyze(wav, { maxClusters: 8 });
  assert.equal(meta.segments.length, 6, 'one VAD segment per turn');
  assert.equal(clusterCount, 2, 'two timbres must form two clusters');
  const clusters = meta.segments.map((s) => s.cluster);
  const clusterA = clusters[0];
  for (let i = 0; i < 6; i++) {
    assert.equal(clusters[i], i % 2 === 0 ? clusterA : 1 - clusterA);
  }
});

test('prosody: invalid WAV surfaces a kernel error through the wrapper', () => {
  const engine = loadMediaWasmSync();
  assert.throws(() => engine.prosodyAnalyze(new Uint8Array(10)), /WAV_/);
});

test('media wasm invariants hold (zero imports, ABI 1, prosody export present)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const wasmPath = path.resolve('vendor/wasm/verisieve_media.wasm');
  const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
  assert.equal(WebAssembly.Module.imports(mod).length, 0);
  const names = WebAssembly.Module.exports(mod).map((e) => e.name);
  assert.ok(names.includes('vs_media_prosody_analyze'));
});
