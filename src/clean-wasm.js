import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WASM_PATH = path.resolve(__dirname, '../vendor/wasm/versieve_clean.wasm');

const FLAG_HTML = 1;
const FLAG_CHROME = 2;
const FLAG_AUTO_HTML = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

let cachedSyncEngine = null;

export function buildEngineFromInstance(instance) {
  const ex = instance.exports;
  const abiVersion = Number(ex.vs_clean_abi_version?.() ?? 0);
  if (abiVersion !== 1) {
    throw new Error(`Unsupported versieve_clean WASM ABI version: ${abiVersion} (expected 1)`);
  }
  const inPtr = ex.vs_clean_in_ptr();
  const outPtr = ex.vs_clean_out_ptr();
  const spansPtr = ex.vs_clean_spans_ptr();
  const inCap = ex.vs_clean_in_cap();

  const memU8 = () => new Uint8Array(ex.memory.buffer);
  const memU32 = () => new Uint32Array(ex.memory.buffer);

  const writeInputBytes = (bytes) => {
    if (bytes.byteLength > inCap) {
      throw new RangeError(`Input size (${bytes.byteLength} bytes) exceeds WASM input capacity (${inCap} bytes)`);
    }
    memU8().set(bytes, inPtr);
    return bytes.byteLength;
  };

  const stripSingleSliceBytes = (bytes, flags) => {
    if (bytes.byteLength === 0) return '';
    const n = writeInputBytes(bytes);
    const outLen = ex.vs_clean_strip_boilerplate(n, flags);
    return decoder.decode(memU8().subarray(outPtr, outPtr + outLen));
  };

  const clampUtf8Boundary = (bytes, start, end) => {
    let pos = end;
    while (pos > start + 1 && (bytes[pos] & 0xc0) === 0x80) {
      pos--;
    }
    if (pos <= start) {
      return end;
    }
    return pos;
  };

  const stripBoilerplate = (input, options = {}) => {
    if (!input) return '';
    let flags = 0;
    if (options.html === true) flags |= FLAG_HTML;
    else if (options.html !== false) flags |= FLAG_AUTO_HTML;
    const chromeEnabled = options.chrome !== undefined ? options.chrome : options.stripChrome;
    if (chromeEnabled !== false) flags |= FLAG_CHROME;

    const fullBytes = encoder.encode(String(input));
    if (fullBytes.byteLength === 0) return '';
    if (fullBytes.byteLength <= inCap) {
      return stripSingleSliceBytes(fullBytes, flags);
    }

    const outParts = [];
    const maxSlice = Math.max(1024, inCap - 2048);
    let offset = 0;
    while (offset < fullBytes.byteLength) {
      let end = Math.min(fullBytes.byteLength, offset + maxSlice);
      if (end < fullBytes.byteLength) {
        end = clampUtf8Boundary(fullBytes, offset, end);
        let splitAt = -1;
        const minSplit = offset + Math.min(64, maxSlice);
        for (let i = end - 1; i >= minSplit; i--) {
          if (fullBytes[i] === 0x0a) {
            splitAt = i + 1;
            break;
          }
          if (splitAt < 0 && fullBytes[i] === 0x3e) {
            splitAt = i + 1;
          }
        }
        if (splitAt < 0) {
          for (let i = end - 1; i >= minSplit; i--) {
            if (fullBytes[i] === 0x20 || fullBytes[i] === 0x09) {
              splitAt = i + 1;
              break;
            }
          }
        }
        if (splitAt > offset) {
          end = clampUtf8Boundary(fullBytes, offset, splitAt);
        }
      }
      const cleaned = stripSingleSliceBytes(fullBytes.subarray(offset, end), flags);
      if (cleaned) {
        outParts.push(cleaned);
      }
      offset = end;
    }
    return outParts.join('\n');
  };

  const dedupReset = () => {
    ex.vs_clean_dedup_reset();
  };

  const dedupCheck = (text, threshold = 0.85) => {
    const encoded = encoder.encode(String(text));
    const len = writeInputBytes(encoded);
    const normalized = threshold > 1 ? threshold / 1000 : threshold;
    const thresholdX1000 = Math.max(0, Math.min(1000, Math.round(normalized * 1000)));
    const code = ex.vs_clean_dedup_check(len, thresholdX1000);
    const similarity = ex.vs_clean_last_sim_x1000() / 1000;
    const matchedIndex = ex.vs_clean_last_match_idx();
    const action = code === 1 ? 'exact_duplicate' : code === 2 ? 'near_duplicate' : 'keep';
    return { action, code, similarity, matchedIndex };
  };

  const dedupCount = () => ex.vs_clean_dedup_count();
  const dedupOverflowed = () => ex.vs_clean_dedup_overflowed() !== 0;
  const dedupEvicted = () => ex.vs_clean_dedup_evicted();
  const dedupCap = () => ex.vs_clean_dedup_cap();

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

  const chunkByTokenWindow = (text, optionsOrMaxTokens = {}, overlapOpt = undefined) => {
    const opts = typeof optionsOrMaxTokens === 'number'
      ? { maxTokens: optionsOrMaxTokens, overlapTokens: overlapOpt }
      : (optionsOrMaxTokens || {});
    const maxTokens = Math.max(16, Math.round(opts.maxTokens ?? 256));
    const overlapTokens = Math.max(0, Math.round(opts.overlapTokens ?? 24));
    const fullBytes = encoder.encode(String(text));
    if (fullBytes.byteLength === 0) return [];
    if (fullBytes.byteLength <= inCap) {
      return chunkSingleSlice(fullBytes, maxTokens, overlapTokens, 0);
    }

    const chunks = [];
    let offset = 0;
    const maxSlice = Math.max(1024, inCap - 1024);
    while (offset < fullBytes.byteLength) {
      let end = Math.min(fullBytes.byteLength, offset + maxSlice);
      if (end < fullBytes.byteLength) {
        let ws = end;
        while (ws > offset && fullBytes[ws] !== 0x20 && fullBytes[ws] !== 0x0a && fullBytes[ws] !== 0x09) {
          ws--;
        }
        if (ws > offset + 64) {
          end = ws + 1;
        } else {
          end = clampUtf8Boundary(fullBytes, offset, end);
        }
      }
      chunks.push(...chunkSingleSlice(fullBytes.subarray(offset, end), maxTokens, overlapTokens, offset));
      offset = end;
    }
    return chunks;
  };

  return {
    abiVersion,
    inCap,
    instance,
    writeInputBytes,
    stripBoilerplate,
    dedupReset,
    dedupCheck,
    dedupCount,
    dedupOverflowed,
    dedupEvicted,
    dedupCap,
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
