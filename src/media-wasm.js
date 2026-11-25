/**
 * Zero-import Rust/WASM Multimodal Core loader for Node.js (`versieve_media.wasm`, ABI v1).
 *
 * Powers byte-identical execution across `matilda-portable` (CLI/MCP) and `Rtio/frontend` (Browser):
 * - Bomb-guarded ZIP Central Directory (+ bit-3 + ZIP64) & TAR/TGZ unpacking with Zip-Slip guards
 * - Pure-WASM CFBF/OLE2 reader for Outlook `.msg` + attachments
 * - Stage 3A Unicode anti-evasion + international checksum PII + 30+ secret scanner
 * - Deterministic Spoken ITN with exact word-span millisecond back-pointers
 * - RIFF WAV PCM16/24/Float32 codec + forensic metadata scrubber + sample-accurate redactor + VAD
 * - JPEG/PNG/MP4 metadata scrubbers, RGB/RGBA pixel blur/pixelate/blackout,
 *   64-bin RGB scene-change delta, and temporal bounding-box tracker
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_MEDIA_WASM_PATH = path.resolve(__dirname, '../vendor/wasm/versieve_media.wasm');

const UTF8_ENC = new TextEncoder();
const UTF8_DEC = new TextDecoder('utf-8');

let cachedEngine = null;

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === 'string') return UTF8_ENC.encode(input);
  throw new TypeError('Expected Uint8Array, Buffer, ArrayBuffer, or string');
}

export function buildMediaEngineFromInstance(instance) {
  const ex = instance.exports;
  const abiVersion = Number(ex.vs_media_abi_version?.() ?? 0);
  if (abiVersion !== 1) {
    throw new Error(`Unsupported versieve_media WASM ABI version: ${abiVersion} (expected 1)`);
  }

  const memU8 = () => new Uint8Array(ex.memory.buffer);

  const writeIn1 = (bytes) => {
    const u8 = toUint8Array(bytes);
    const ptr = ex.vs_media_prepare_input(u8.byteLength >>> 0);
    if (u8.byteLength > 0) memU8().set(u8, ptr);
    return u8.byteLength;
  };

  const writeIn2 = (bytes) => {
    const u8 = toUint8Array(bytes);
    const ptr = ex.vs_media_prepare_input2(u8.byteLength >>> 0);
    if (u8.byteLength > 0) memU8().set(u8, ptr);
    return u8.byteLength;
  };

  const readOut = () => {
    const len = ex.vs_media_out_len() >>> 0;
    const ptr = ex.vs_media_out_ptr();
    return len > 0 ? memU8().slice(ptr, ptr + len) : new Uint8Array(0);
  };

  const readMetaJson = () => {
    const len = ex.vs_media_meta_len() >>> 0;
    const ptr = ex.vs_media_meta_ptr();
    if (len === 0) return null;
    return JSON.parse(UTF8_DEC.decode(memU8().subarray(ptr, ptr + len)));
  };

  const readLastError = () => {
    const len = ex.vs_media_err_len() >>> 0;
    const ptr = ex.vs_media_err_ptr();
    return len > 0 ? UTF8_DEC.decode(memU8().subarray(ptr, ptr + len)) : 'WASM_MEDIA_ERROR';
  };

  return {
    abiVersion,
    instance,

    listZipEntries(zipBytes) {
      writeIn1(zipBytes);
      const rc = ex.vs_media_zip_list();
      if (rc < 0) throw new Error(readLastError());
      return readMetaJson() || [];
    },

    extractZipEntry(zipBytes, entryIndex, options = {}) {
      const maxOutBytes = options.maxOutBytes ?? 32 * 1024 * 1024;
      const maxRatio = options.maxRatio ?? 250;
      writeIn1(zipBytes);
      const rc = ex.vs_media_zip_extract(entryIndex >>> 0, maxOutBytes >>> 0, maxRatio >>> 0);
      if (rc < 0) throw new Error(readLastError());
      return readOut();
    },

    unpackTarArchive(tarOrTgzBytes, options = {}) {
      const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
      const maxRatio = options.maxRatio ?? 50;
      writeIn1(tarOrTgzBytes);
      const rc = ex.vs_media_tar_load(maxTotalBytes >>> 0, maxRatio >>> 0);
      if (rc < 0) throw new Error(readLastError());
      const manifest = readMetaJson() || [];
      return manifest.map((entry) => {
        if (entry.isDir) return { ...entry, bytes: new Uint8Array(0) };
        const erc = ex.vs_media_tar_extract(entry.index >>> 0);
        if (erc < 0) throw new Error(readLastError());
        return { ...entry, bytes: readOut() };
      });
    },

    parseOutlookMsg(msgBytes) {
      writeIn1(msgBytes);
      const rc = ex.vs_media_parse_msg();
      if (rc < 0) throw new Error(readLastError());
      const meta = readMetaJson();
      const attachments = (meta.attachments || []).map((att) => {
        const arc = ex.vs_media_msg_attachment(att.index >>> 0);
        if (arc < 0) throw new Error(readLastError());
        return { ...att, bytes: readOut() };
      });
      return { ...meta, attachments };
    },

    scanPiiAndSecrets(text) {
      writeIn1(String(text ?? ''));
      const rc = ex.vs_media_scan_pii_secrets();
      if (rc < 0) throw new Error(readLastError());
      return readMetaJson() || { evasionCharsStripped: 0, homoglyphsFolded: 0, spans: [] };
    },

    pprlSignature(text, salt = 'versieve-pprl') {
      writeIn1(String(text ?? ''));
      writeIn2(String(salt ?? ''));
      const rc = ex.vs_media_pprl_signature();
      if (rc < 0) throw new Error(readLastError());
      return readMetaJson() || { bloomHex: '0'.repeat(32), phoneticHex: '0'.repeat(16), popcount: 0 };
    },

    srmpReset() {
      const rc = ex.vs_media_srmp_reset();
      if (rc < 0) throw new Error(readLastError());
      return rc;
    },

    srmpSeedAnchor(text, salt = 'versieve-srmp', options = {}) {
      writeIn1(String(text ?? ''));
      writeIn2(String(salt ?? ''));
      const entityUid = Math.max(0, Math.round(Number(options.entityUid ?? 1))) >>> 0;
      const blockIdx = Math.max(0, Math.round(Number(options.blockIdx ?? 0))) >>> 0;
      const confX1000 = Math.max(0, Math.min(1000, Math.round(Number(options.confidence ?? 0.90) * 1000))) >>> 0;
      const kindCode = Math.max(0, Math.round(Number(options.kindCode ?? 1))) >>> 0;
      const rc = ex.vs_media_srmp_seed_anchor(entityUid, blockIdx, confX1000, kindCode);
      if (rc < 0) throw new Error(readLastError());
      return readMetaJson() || { slotCount: rc, capacity: 512, entityUid, blockIdx };
    },

    srmpQueryCandidate(text, salt = 'versieve-srmp', options = {}) {
      writeIn1(String(text ?? ''));
      writeIn2(String(salt ?? ''));
      const blockIdx = Math.max(0, Math.round(Number(options.blockIdx ?? 0))) >>> 0;
      const localScoreX1000 = Math.max(0, Math.min(1000, Math.round(Number(options.localScore ?? 0.25) * 1000))) >>> 0;
      const minDiceX1000 = Math.max(0, Math.min(1000, Math.round(Number(options.minDice ?? 0.75) * 1000))) >>> 0;
      const gammaX1000 = Math.max(0, Math.min(1000, Math.round(Number(options.gamma ?? 0.85) * 1000))) >>> 0;
      const betaX1000 = Math.max(0, Math.min(1000, Math.round(Number(options.beta ?? 0.20) * 1000))) >>> 0;
      const rc = ex.vs_media_srmp_query_candidate(
        blockIdx,
        localScoreX1000,
        minDiceX1000,
        gammaX1000,
        betaX1000
      );
      if (rc < 0) throw new Error(readLastError());
      return (
        readMetaJson() || {
          matched: false,
          entityUid: 0,
          anchorBlockIdx: 0,
          kindCode: 0,
          dice: 0,
          phoneticMatch: false,
          exactMatch: false,
          coupledScore: Number((localScoreX1000 / 1000).toFixed(4)),
        }
      );
    },

    normalizeSpokenWords(words = []) {
      const tsv = words
        .map((w) => {
          const clean = String(w.word ?? w.text ?? '').replace(/[\t\r\n]+/g, ' ').trim();
          const s = Math.max(0, Math.round(Number(w.startMs ?? w.start_ms ?? 0)));
          const e = Math.max(s, Math.round(Number(w.endMs ?? w.end_ms ?? s)));
          return `${clean}\t${s}\t${e}`;
        })
        .join('\n');
      writeIn1(tsv);
      const rc = ex.vs_media_spoken_itn();
      if (rc < 0) throw new Error(readLastError());
      return readMetaJson() || { normalizedText: '', wordMap: [] };
    },

    redactWavBuffer(wavBytes, spansMs = [], options = {}) {
      writeIn1(wavBytes);
      const packed = new Uint32Array(spansMs.length * 2);
      for (let i = 0; i < spansMs.length; i++) {
        packed[i * 2] = Math.max(0, Math.round(Number(spansMs[i].startMs ?? spansMs[i].start_ms ?? 0))) >>> 0;
        packed[i * 2 + 1] = Math.max(0, Math.round(Number(spansMs[i].endMs ?? spansMs[i].end_ms ?? 0))) >>> 0;
      }
      writeIn2(new Uint8Array(packed.buffer));
      const modeMap = { silence: 0, mute: 0, beep: 1, tone: 1, pink_noise: 2, noise: 2 };
      const mode = typeof options.mode === 'number' ? options.mode : (modeMap[options.mode || 'beep'] ?? 1);
      const padMs = options.padMs ?? 40;
      const fadeMs = options.fadeMs ?? 5;
      const beepHz = options.beepHz ?? 1000;
      const beepGain = options.beepGain ?? 0.14;

      const rc = ex.vs_media_wav_redact(mode >>> 0, padMs >>> 0, fadeMs >>> 0, beepHz, beepGain);
      if (rc < 0) throw new Error(readLastError());
      return {
        redactedWavBytes: readOut(),
        meta: readMetaJson(),
      };
    },

    scrubMediaMetadata(mediaBytes) {
      writeIn1(mediaBytes);
      const rc = ex.vs_media_scrub_metadata();
      if (rc < 0) throw new Error(readLastError());
      return {
        cleanBytes: readOut(),
        meta: readMetaJson(),
      };
    },

    // Prosody kernel v1 per VAD segment (F0/RMS/ZCR/tilt/wpm) + speaker-clustering-lite.
    // WAV bytes only; optional spoken-word spans for wpm; ground-truth labels are never an input.
    prosodyAnalyze(wavBytes, options = {}) {
      writeIn1(wavBytes);
      const spans = options.wordSpansMs ?? [];
      const packed = new Uint32Array(spans.length * 2);
      for (let i = 0; i < spans.length; i++) {
        packed[i * 2] = Math.max(0, Math.round(Number(spans[i].startMs ?? spans[i][0] ?? 0))) >>> 0;
        packed[i * 2 + 1] = Math.max(0, Math.round(Number(spans[i].endMs ?? spans[i][1] ?? 0))) >>> 0;
      }
      writeIn2(new Uint8Array(packed.buffer));
      const maxClusters = Math.max(1, Math.min(8, Math.round(Number(options.maxClusters ?? 8)))) >>> 0;
      const vadWindowMs = Math.max(10, Math.round(Number(options.vadWindowMs ?? 50))) >>> 0;
      const vadRmsThreshold = Number(options.vadRmsThreshold ?? 0);
      const vadRmsThresholdX1000 = Math.max(0, Math.min(1000, Math.round(vadRmsThreshold * 1000))) >>> 0;
      const clusterCount = ex.vs_media_prosody_analyze(
        maxClusters,
        vadWindowMs,
        vadRmsThresholdX1000
      );
      if (clusterCount < 0) throw new Error(readLastError());
      return { clusterCount, meta: readMetaJson() };
    },

    redactPixels(pixels, width, height, channels = 3, boxes = [], options = {}) {
      writeIn1(pixels);
      const packed = new Int32Array(boxes.length * 4);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (Array.isArray(b)) {
          packed[i * 4] = Math.round(b[0]);
          packed[i * 4 + 1] = Math.round(b[1]);
          packed[i * 4 + 2] = Math.round(b[2]);
          packed[i * 4 + 3] = Math.round(b[3]);
        } else {
          packed[i * 4] = Math.round(b.x1 ?? b.x ?? 0);
          packed[i * 4 + 1] = Math.round(b.y1 ?? b.y ?? 0);
          packed[i * 4 + 2] = Math.round(b.x2 ?? ((b.x ?? 0) + (b.w ?? 0)));
          packed[i * 4 + 3] = Math.round(b.y2 ?? ((b.y ?? 0) + (b.h ?? 0)));
        }
      }
      writeIn2(new Uint8Array(packed.buffer));
      const modeMap = { blackout: 0, solid: 0, pixelate: 1, mosaic: 1, blur: 2, gaussian: 2 };
      const mode = typeof options.mode === 'number' ? options.mode : (modeMap[options.mode || 'blackout'] ?? 0);
      const strength = options.strength ?? 10;
      const maskedPixels = ex.vs_media_redact_pixels(
        width >>> 0,
        height >>> 0,
        channels >>> 0,
        mode >>> 0,
        strength >>> 0
      );
      if (maskedPixels < 0) throw new Error(readLastError());
      return { pixels: readOut(), maskedPixels };
    },

    computeSceneDelta(frameA, frameB, channels = 3) {
      writeIn1(frameA);
      writeIn2(frameB);
      return Number(ex.vs_media_scene_delta(channels >>> 0));
    },

    // 64-bit dHash over caller-supplied RGB/RGBA bytes (no decode in the kernel);
    // wasm i64 arrives as a signed BigInt and is reinterpreted as u64.
    computePerceptualDhash64(pixels, width, height, channels = 3) {
      writeIn1(pixels);
      return BigInt.asUintN(
        64,
        ex.vs_media_perceptual_dhash64(width >>> 0, height >>> 0, channels >>> 0)
      );
    },

    trackTemporalBoxes(detections = [], queryTimeMs = 0, options = {}) {
      const buf = new ArrayBuffer(detections.length * 24);
      const dv = new DataView(buf);
      for (let i = 0; i < detections.length; i++) {
        const d = detections[i];
        const off = i * 24;
        dv.setUint32(off, Math.max(0, Math.round(Number(d.timeMs ?? d.time_ms ?? 0))) >>> 0, true);
        dv.setUint32(off + 4, (Number(d.trackId ?? d.track_id ?? i) >>> 0), true);
        dv.setFloat32(off + 8, Number(d.x1 ?? d.x ?? 0), true);
        dv.setFloat32(off + 12, Number(d.y1 ?? d.y ?? 0), true);
        dv.setFloat32(off + 16, Number(d.x2 ?? ((d.x ?? 0) + (d.w ?? 0))), true);
        dv.setFloat32(off + 20, Number(d.y2 ?? ((d.y ?? 0) + (d.h ?? 0))), true);
      }
      writeIn1(new Uint8Array(buf));
      const holdMs = options.holdMs ?? 1500;
      const padPct = options.padPct ?? 0.15;
      const rc = ex.vs_media_track_boxes(Math.max(0, Math.round(queryTimeMs)) >>> 0, holdMs >>> 0, padPct);
      if (rc < 0) throw new Error(readLastError());
      return readMetaJson() || [];
    },
  };
}

export function loadMediaWasmSync(wasmPath = DEFAULT_MEDIA_WASM_PATH) {
  if (cachedEngine && wasmPath === DEFAULT_MEDIA_WASM_PATH) {
    return cachedEngine;
  }
  const bytes = fs.readFileSync(wasmPath);
  const mod = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(mod);
  if (imports.length !== 0) {
    throw new Error(`ZERO_IMPORT_VIOLATION: versieve_media.wasm has ${imports.length} unexpected imports`);
  }
  const instance = new WebAssembly.Instance(mod, {});
  const engine = buildMediaEngineFromInstance(instance);
  if (wasmPath === DEFAULT_MEDIA_WASM_PATH) {
    cachedEngine = engine;
  }
  return engine;
}

export function pprlDiceSimilarity(bloomHexA, bloomHexB) {
  const a = String(bloomHexA || '');
  const b = String(bloomHexB || '');
  if (a.length !== 32 || b.length !== 32) return 0;
  let inter = 0, popA = 0, popB = 0;
  for (let i = 0; i < 32; i += 8) {
    const wa = parseInt(a.slice(i, i + 8), 16) >>> 0;
    const wb = parseInt(b.slice(i, i + 8), 16) >>> 0;
    let ab = (wa & wb) >>> 0;
    let xa = wa, xb = wb;
    while (ab) { inter += ab & 1; ab >>>= 1; }
    while (xa) { popA += xa & 1; xa >>>= 1; }
    while (xb) { popB += xb & 1; xb >>>= 1; }
  }
  return popA + popB > 0 ? (2 * inter) / (popA + popB) : 0;
}

export async function loadMediaWasm(wasmPath = DEFAULT_MEDIA_WASM_PATH) {
  return loadMediaWasmSync(wasmPath);
}
