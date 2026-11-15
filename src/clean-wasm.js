import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WASM_PATH = path.resolve(__dirname, '../vendor/wasm/verisieve_clean.wasm');

const FLAG_HTML = 1;
const FLAG_CHROME = 2;
const FLAG_AUTO_HTML = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

let cachedSyncEngine = null;

function buildEngineFromInstance(instance) {
  const ex = instance.exports;
  const abiVersion = ex.vs_clean_abi_version();
  const inPtr = ex.vs_clean_in_ptr();
  const outPtr = ex.vs_clean_out_ptr();
  const spansPtr = ex.vs_clean_spans_ptr();
  const inCap = ex.vs_clean_in_cap();

  const memU8 = () => new Uint8Array(ex.memory.buffer);
  const memU32 = () => new Uint32Array(ex.memory.buffer);

  const writeInputBytes = (bytes) => {
    const len = Math.min(bytes.byteLength, inCap);
    memU8().set(bytes.subarray(0, len), inPtr);
    return len;
  };

  const stripSingleSlice = (slice, flags) => {
    const encoded = encoder.encode(slice);
    if (encoded.byteLength === 0) return '';
    const n = writeInputBytes(encoded);
    const outLen = ex.vs_clean_strip_boilerplate(n, flags);
    return decoder.decode(memU8().subarray(outPtr, outPtr + outLen));
  };

  const stripBoilerplate = (input, options = {}) => {
    if (!input) return '';
    let flags = 0;
    if (options.html === true) flags |= FLAG_HTML;
    else if (options.html !== false) flags |= FLAG_AUTO_HTML;
    if (options.stripChrome !== false) flags |= FLAG_CHROME;

    const encoded = encoder.encode(String(input));
    if (encoded.byteLength <= inCap) {
      return stripSingleSlice(String(input), flags);
    }

    const outParts = [];
    let current = '';
    for (const line of String(input).split(/\r?\n/)) {
      const candidate = current ? `${current}\n${line}` : line;
      if (encoder.encode(candidate).byteLength >= inCap - 2048 && current) {
        outParts.push(stripSingleSlice(current, flags));
        current = line;
      } else {
        current = candidate;
      }
    }
    if (current) {
      outParts.push(stripSingleSlice(current, flags));
    }
    return outParts.filter(Boolean).join('\n');
  };

  const dedupReset = () => {
    ex.vs_clean_dedup_reset();
  };

  const dedupCheck = (text, threshold = 0.85) => {
    const encoded = encoder.encode(String(text));
    const len = writeInputBytes(encoded);
    const thresholdX1000 = Math.max(0, Math.min(1000, Math.round(threshold * 1000)));
    const code = ex.vs_clean_dedup_check(len, thresholdX1000);
    const similarity = ex.vs_clean_last_sim_x1000() / 1000;
    const matchedIndex = ex.vs_clean_last_match_idx();
    const action = code === 1 ? 'exact_duplicate' : code === 2 ? 'near_duplicate' : 'keep';
    return { action, similarity, matchedIndex };
  };

  const chunkSingleSlice = (sliceBytes, maxTokens, overlapTokens, baseOffset) => {
    if (sliceBytes.byteLength === 0) return [];
    const len = writeInputBytes(sliceBytes);
    const count = ex.vs_clean_chunk_windows(len, maxTokens, overlapTokens);
    const spans = memU32();
    const spanBase = spansPtr >>> 2;
    const out = [];
    for (let i = 0; i < count; i++) {
      const s = spans[spanBase + i * 3];
      const e = spans[spanBase + i * 3 + 1];
      const tokenCount = spans[spanBase + i * 3 + 2];
      out.push({
        text: decoder.decode(sliceBytes.subarray(s, e)),
        startByte: baseOffset + s,
        endByte: baseOffset + e,
        tokenCount,
      });
    }
    return out;
  };

  const chunkByTokenWindow = (text, options = {}) => {
    const maxTokens = Math.max(16, Math.round(options.maxTokens ?? 256));
    const overlapTokens = Math.max(0, Math.round(options.overlapTokens ?? 24));
    const fullBytes = encoder.encode(String(text));
    if (fullBytes.byteLength === 0) return [];
    if (fullBytes.byteLength <= inCap) {
      return chunkSingleSlice(fullBytes, maxTokens, overlapTokens, 0);
    }

    const chunks = [];
    let offset = 0;
    const maxSlice = inCap - 1024;
    while (offset < fullBytes.byteLength) {
      let end = Math.min(fullBytes.byteLength, offset + maxSlice);
      if (end < fullBytes.byteLength) {
        let ws = end;
        while (ws > offset && fullBytes[ws] !== 0x20 && fullBytes[ws] !== 0x0a && fullBytes[ws] !== 0x09) {
          ws--;
        }
        if (ws > offset + 64) end = ws;
      }
      chunks.push(...chunkSingleSlice(fullBytes.subarray(offset, end), maxTokens, overlapTokens, offset));
      offset = end;
    }
    return chunks;
  };

  return {
    abiVersion,
    instance,
    stripBoilerplate,
    dedupReset,
    dedupCheck,
    chunkByTokenWindow,
  };
}

export function loadCleanWasmSync(wasmPathOrBytes) {
  if (!wasmPathOrBytes && cachedSyncEngine) {
    return cachedSyncEngine;
  }
  const bytes =
    wasmPathOrBytes instanceof Uint8Array
      ? wasmPathOrBytes
      : fs.readFileSync(wasmPathOrBytes || DEFAULT_WASM_PATH);
  const mod = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(mod, {});
  const engine = buildEngineFromInstance(instance);
  if (!wasmPathOrBytes) {
    cachedSyncEngine = engine;
  }
  return engine;
}

export async function loadCleanWasm(wasmPathOrBytes) {
  if (wasmPathOrBytes instanceof Uint8Array || wasmPathOrBytes instanceof ArrayBuffer) {
    const u8 = wasmPathOrBytes instanceof Uint8Array ? wasmPathOrBytes : new Uint8Array(wasmPathOrBytes);
    const { instance } = await WebAssembly.instantiate(u8, {});
    return buildEngineFromInstance(instance);
  }
  return loadCleanWasmSync(wasmPathOrBytes);
}
