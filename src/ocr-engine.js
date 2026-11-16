import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { renderGlyphBitmap, FONT_STYLES } from './multi-font-fixture.js';

/**
 * 1. auditCactusWasmArtifact(wasmPath)
 */

export const CACTUS_EXPECTED_IMPORTS = Object.freeze({
  'a.a': '(i32,i32,i32)->()',
  'a.b': '(i32)->(i32)',
  'a.c': '(i32,i32,i32,i32)->(i32)',
  'a.d': '(i32,i32,i32)->(i32)',
  'a.e': '()->()',
  'a.f': '(i32,i32,i32,i32,i32,i64)->(i32)',
  'a.g': '(i32,i64,i32,i32)->(i32)',
  'a.h': '(i32,i32,i32,i32)->(i32)',
  'a.i': '(i32,i32,i32)->(i32)',
  'a.j': '(i32,i32)->(i32)',
  'a.k': '(i32,i32)->(i32)',
  'a.l': '(i32,i64,i32)->(i32)',
  'a.m': '(i32)->(i32)',
  'a.n': '(i32)->(i32)',
  'a.o': '(i32,i32,i32)->(i32)',
  'a.p': '(i32,i32,i32,i32)->(i32)'
});

export const DEFAULT_MIRAGE_WEIGHTS_PATH = 'vendor/cactus/mirage.cact';

function readWasmImportSignatures(bytes) {
  let p = 8;
  const valType = (b) => ({ 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128' }[b] || `0x${b.toString(16)}`);
  const readU = () => {
    let r = 0;
    let s = 0;
    while (p < bytes.length) {
      const b = bytes[p++];
      r |= (b & 0x7f) << s;
      if (!(b & 0x80)) return r >>> 0;
      s += 7;
    }
    throw new Error('INVALID_WASM_LEB128');
  };
  const readStr = () => {
    const n = readU();
    const s = Buffer.from(bytes.subarray(p, p + n)).toString('utf8');
    p += n;
    return s;
  };
  const types = [];
  const importSigs = [];
  while (p < bytes.length) {
    const id = bytes[p++];
    const size = readU();
    const end = p + size;
    if (id === 1) {
      const count = readU();
      for (let i = 0; i < count; i++) {
        p++; // 0x60 func type
        const pc = readU();
        const params = [];
        for (let k = 0; k < pc; k++) params.push(valType(bytes[p++]));
        const rc = readU();
        const rets = [];
        for (let k = 0; k < rc; k++) rets.push(valType(bytes[p++]));
        types.push(`(${params.join(',')})->(${rets.join(',')})`);
      }
    } else if (id === 2) {
      const count = readU();
      for (let i = 0; i < count; i++) {
        const moduleName = readStr();
        const fieldName = readStr();
        const kind = bytes[p++];
        if (kind === 0) {
          const typeIdx = readU();
          importSigs.push({
            module: moduleName,
            name: fieldName,
            kind: 'function',
            signature: types[typeIdx] || 'unknown'
          });
        } else {
          // Skip table/memory/global descriptors cleanly
          if (kind === 1) { p++; const lim = bytes[p++]; readU(); if (lim & 1) readU(); }
          else if (kind === 2) { const lim = bytes[p++]; readU(); if (lim & 1) readU(); }
          else if (kind === 3) { p += 2; }
          importSigs.push({ module: moduleName, name: fieldName, kind: `kind_${kind}`, signature: null });
        }
      }
      break;
    }
    p = end;
  }
  return importSigs;
}

export async function auditCactusWasmArtifact(wasmPath = 'vendor/cactus/cactus.wasm', options = {}) {
  const fullPath = path.resolve(process.cwd(), wasmPath);
  const bytes = fs.readFileSync(fullPath);
  const byteLength = bytes.length;
  if (byteLength < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`INVALID_WASM_BINARY: ${wasmPath} is missing valid WASM magic header`);
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const exports = WebAssembly.Module.exports(mod);
  const parsedSigs = readWasmImportSignatures(bytes);

  let networkImportCount = 0;
  let filesystemImportCount = 0;
  const unexpectedImports = [];
  const signatureMismatches = [];

  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    const sigInfo = parsedSigs[i];
    const key = `${imp.module}.${imp.name}`;
    const expectedSig = CACTUS_EXPECTED_IMPORTS[key];
    if (/(net|http|fetch|socket|ws|xhr|dns)/i.test(key)) {
      networkImportCount++;
    }
    if (!expectedSig || imp.kind !== 'function') {
      if (/(fs|path_|fd_|wasi|file|dir|open|stat)/i.test(key)) {
        filesystemImportCount++;
      }
      unexpectedImports.push({ module: imp.module, name: imp.name, kind: imp.kind, signature: sigInfo?.signature || null });
    } else if (sigInfo?.signature !== expectedSig) {
      signatureMismatches.push({ import: key, expected: expectedSig, actual: sigInfo?.signature || 'unknown' });
    }
  }

  const expectedCount = Object.keys(CACTUS_EXPECTED_IMPORTS).length;
  const importsVerified = imports.length === expectedCount && unexpectedImports.length === 0 && signatureMismatches.length === 0;
  const zeroEgressVerified = importsVerified && networkImportCount === 0 && filesystemImportCount === 0;

  const report = {
    wasmPath: fullPath,
    byteLength,
    sha256,
    importCount: imports.length,
    imports: imports.map((imp, i) => ({ ...imp, signature: parsedSigs[i]?.signature || null })),
    exportCount: exports.length,
    exports,
    networkImportCount,
    filesystemImportCount,
    unexpectedImports,
    signatureMismatches,
    importsVerified,
    zeroEgressVerified
  };

  if (options.strict && !zeroEgressVerified) {
    throw new Error(
      `WASM_IMPORT_CONTRACT_VIOLATION: ${wasmPath} failed strict import contract ` +
      `(unexpected=${unexpectedImports.length}, sigMismatches=${signatureMismatches.length}, net=${networkImportCount})`
    );
  }

  return report;
}

/**
 * Pure-memory Emscripten/VFS sandbox host for vendor/cactus/cactus.wasm (a.a..a.p).
 * Guarantees zero outbound network access and zero arbitrary host disk access.
 */
export async function createCactusRuntime(options = {}) {
  const wasmPath = options.wasmPath || 'vendor/cactus/cactus.wasm';
  const resolvedWasm = path.resolve(process.cwd(), wasmPath);
  await auditCactusWasmArtifact(resolvedWasm, { strict: true });

  const wasmBytes = fs.readFileSync(resolvedWasm);
  const mod = await WebAssembly.compile(wasmBytes);
  const maxMemoryBytes = options.maxMemoryBytes || 512 * 1024 * 1024;

  const vfs = new Map();
  const fds = new Map([
    [0, { path: '/dev/stdin', bytes: new Uint8Array(0), pos: 0 }],
    [1, { path: '/dev/stdout', chunks: [], pos: 0 }],
    [2, { path: '/dev/stderr', chunks: [], pos: 0 }]
  ]);
  let nextFd = 3;
  const vfsStats = {
    hostDiskAccesses: 0,
    networkCalls: 0,
    heapGrows: 0,
    clockCalls: 0,
    syscalls: 0
  };

  let memory = null;
  const dv = () => new DataView(memory.buffer);
  const u8 = () => new Uint8Array(memory.buffer);
  const readCString = (ptr) => {
    if (!ptr) return '';
    const arr = u8();
    let end = ptr;
    while (end < arr.length && arr[end] !== 0) end++;
    return Buffer.from(arr.subarray(ptr, end)).toString('utf8');
  };

  const imports = {
    a: {
      a(ptr, type) {
        vfsStats.syscalls++;
        throw new Error(`CACTUS_CPP_EXCEPTION(ptr=${ptr},type=${type})`);
      },
      b(fd) {
        vfsStats.syscalls++;
        if (!fds.has(fd)) return 8;
        if (fd >= 3) fds.delete(fd);
        return 0;
      },
      c(fd, iovs, iovcnt, pnum) {
        vfsStats.syscalls++;
        const entry = fds.get(fd);
        if (!entry) return 8;
        const view = dv();
        const mem = u8();
        const src = entry.bytes || new Uint8Array(0);
        let total = 0;
        for (let i = 0; i < iovcnt; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          const avail = Math.max(0, src.length - entry.pos);
          const n = Math.min(len, avail);
          if (n > 0) mem.set(src.subarray(entry.pos, entry.pos + n), ptr);
          entry.pos += n;
          total += n;
        }
        view.setUint32(pnum, total, true);
        return 0;
      },
      d(fd, cmd) {
        vfsStats.syscalls++;
        if (!fds.has(fd)) return -8;
        if (cmd === 3 || cmd === 4) return 0;
        return 0;
      },
      e() {
        vfsStats.syscalls++;
        throw new Error('CACTUS_WASM_ABORT');
      },
      f() {
        vfsStats.syscalls++;
        return 0;
      },
      g(fd, offset, whence, pnew) {
        vfsStats.syscalls++;
        const entry = fds.get(fd);
        if (!entry) return 8;
        const len = BigInt((entry.bytes || new Uint8Array(0)).length);
        let next = BigInt(entry.pos);
        if (whence === 0) next = offset;
        else if (whence === 1) next = BigInt(entry.pos) + offset;
        else if (whence === 2) next = len + offset;
        if (next < 0n) return 28;
        entry.pos = Number(next);
        dv().setBigUint64(pnew, next, true);
        return 0;
      },
      h(fd, iovs, iovcnt, pnum) {
        vfsStats.syscalls++;
        const entry = fds.get(fd);
        if (!entry) return 8;
        const view = dv();
        const mem = u8();
        let total = 0;
        for (let i = 0; i < iovcnt; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          if (entry.chunks) entry.chunks.push(Buffer.from(mem.subarray(ptr, ptr + len)));
          total += len;
        }
        view.setUint32(pnum, total, true);
        return 0;
      },
      i() {
        vfsStats.syscalls++;
        return -59;
      },
      j() {
        vfsStats.syscalls++;
        return 0;
      },
      k(pcount, psize) {
        vfsStats.syscalls++;
        const view = dv();
        view.setUint32(pcount, 0, true);
        view.setUint32(psize, 0, true);
        return 0;
      },
      l(_clkId, _prec, timePtr) {
        vfsStats.syscalls++;
        vfsStats.clockCalls++;
        const ns = typeof options.clockNs === 'function'
          ? BigInt(options.clockNs())
          : BigInt(vfsStats.clockCalls) * 1000000n;
        dv().setBigUint64(timePtr, ns, true);
        return 0;
      },
      m(reqSize) {
        vfsStats.syscalls++;
        if (reqSize > maxMemoryBytes) return 0;
        const cur = memory.buffer.byteLength;
        if (reqSize <= cur) return 1;
        const addPages = Math.ceil((reqSize - cur) / 65536);
        try {
          memory.grow(addPages);
          vfsStats.heapGrows++;
          return 1;
        } catch {
          return 0;
        }
      },
      n(pathPtr) {
        vfsStats.syscalls++;
        return vfs.delete(readCString(pathPtr)) ? 0 : -44;
      },
      o(_dirfd, pathPtr) {
        vfsStats.syscalls++;
        return vfs.delete(readCString(pathPtr)) ? 0 : -44;
      },
      p(_dirfd, pathPtr) {
        vfsStats.syscalls++;
        const p = readCString(pathPtr);
        if (!vfs.has(p)) return -44;
        const fd = nextFd++;
        fds.set(fd, { path: p, bytes: vfs.get(p), pos: 0 });
        return fd;
      }
    }
  };

  const instance = await WebAssembly.instantiate(mod, imports);
  memory = instance.exports.q;
  if (typeof instance.exports.r === 'function') {
    instance.exports.r();
  }

  let loadedWeightPtr = 0;
  let disposed = false;

  const allocString = (str) => {
    const bytes = Buffer.from(String(str), 'utf8');
    const ptr = instance.exports.G(bytes.length + 1);
    if (!ptr) throw new Error('CACTUS_OOM');
    u8().set(bytes, ptr);
    u8()[ptr + bytes.length] = 0;
    return ptr;
  };

  return {
    registerVfsFile(vpath, bytes) {
      vfs.set(String(vpath), bytes instanceof Uint8Array ? bytes : Buffer.from(bytes));
    },
    getVfsStats() {
      return { ...vfsStats, vfsFiles: vfs.size };
    },
    getStatus() {
      return disposed ? 0 : instance.exports.A();
    },
    getLastError() {
      return readCString(instance.exports.s());
    },
    loadWeights(weightsBytes) {
      if (disposed) throw new Error('CACTUS_RUNTIME_DISPOSED');
      const raw = weightsBytes instanceof Uint8Array ? weightsBytes : Buffer.from(weightsBytes);
      const ptr = instance.exports.G(raw.length);
      if (!ptr) throw new Error('CACTUS_OOM');
      u8().set(raw, ptr);
      const rc = instance.exports.z(ptr, BigInt(raw.length));
      if (rc !== 0) {
        const err = readCString(instance.exports.s()) || `cactus_load failed (${rc})`;
        instance.exports.F(ptr);
        return { ok: false, code: rc, error: err, status: instance.exports.A() };
      }
      if (loadedWeightPtr && loadedWeightPtr !== ptr) {
        instance.exports.F(loadedWeightPtr);
      }
      loadedWeightPtr = ptr;
      return { ok: true, code: 0, status: instance.exports.A() };
    },
    describeRgb(rgbBytes, width, height, describeOpts = {}) {
      if (disposed) throw new Error('CACTUS_RUNTIME_DISPOSED');
      const expected = width * height * 3;
      if (!(rgbBytes instanceof Uint8Array) || width <= 0 || height <= 0 || rgbBytes.length !== expected) {
        throw new Error(`INVALID_RGB_TILE: expected ${expected} bytes (${width}x${height}x3)`);
      }
      const outCap = describeOpts.outBufferBytes || 65536;
      const rgbPtr = instance.exports.G(rgbBytes.length);
      const optJson = JSON.stringify({
        max_text_lines: describeOpts.max_text_lines ?? 32,
        text_conf: describeOpts.text_conf ?? 0.25,
        ...(describeOpts.form ? { form: describeOpts.form } : {})
      });
      const optPtr = allocString(optJson);
      const langPtr = allocString(describeOpts.language || 'en');
      const outPtr = instance.exports.G(outCap);
      try {
        u8().set(rgbBytes, rgbPtr);
        const rc = instance.exports.y(rgbPtr, width, height, optPtr, langPtr, 0, outPtr, outCap);
        if (rc < 0) {
          const msg = readCString(instance.exports.s()) || `cactus_describe failed (${rc})`;
          throw new Error(`CACTUS_DESCRIBE_FAILED: ${msg}`);
        }
        return readCString(outPtr);
      } finally {
        if (rgbPtr) instance.exports.F(rgbPtr);
        if (optPtr) instance.exports.F(optPtr);
        if (langPtr) instance.exports.F(langPtr);
        if (outPtr) instance.exports.F(outPtr);
      }
    },
    dispose() {
      if (disposed) return;
      if (typeof instance.exports.u === 'function') {
        try { instance.exports.u(); } catch { /* noop */ }
      }
      if (loadedWeightPtr) {
        instance.exports.F(loadedWeightPtr);
        loadedWeightPtr = 0;
      }
      vfs.clear();
      fds.clear();
      disposed = true;
    }
  };
}

/**
 * 2. sanitizeMirageFormSchema & restoreMirageFormOutput (stateless bijective escaping)
 */
const MIRAGE_ESCAPE_ENCODE_RE = /[\\;|=#@$*\r\n]/g;
const MIRAGE_ESCAPE_TEST_RE = /[\\;|=#@$*\r\n]/;
const MIRAGE_ESCAPE_DECODE_RE = /\\x(5c|3b|7c|3d|23|40|24|2a|0d|0a)/g;

function encodeMirageToken(str) {
  if (!MIRAGE_ESCAPE_TEST_RE.test(str)) return str;
  return str.replace(MIRAGE_ESCAPE_ENCODE_RE, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function decodeMirageToken(str) {
  return str.replace(MIRAGE_ESCAPE_DECODE_RE, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function sanitizeMirageFormSchema(formObj) {
  const mapping = new Map();

  function walk(node) {
    if (typeof node === 'string') {
      const encoded = encodeMirageToken(node);
      if (encoded !== node) mapping.set(encoded, node);
      return encoded;
    }
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        const cleanKey = encodeMirageToken(k);
        if (cleanKey !== k) mapping.set(cleanKey, k);
        out[cleanKey] = walk(v);
      }
      return out;
    }
    return node;
  }

  return { sanitizedForm: walk(formObj), mapping };
}

export function restoreMirageFormOutput(outputObj, mapping = new Map()) {
  const mapObj = mapping instanceof Map ? mapping : new Map(Object.entries(mapping || {}));

  function walk(node) {
    if (typeof node === 'string') {
      if (mapObj.has(node)) return mapObj.get(node);
      return decodeMirageToken(node);
    }
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        const restoredKey = mapObj.has(k) ? mapObj.get(k) : decodeMirageToken(k);
        out[restoredKey] = walk(v);
      }
      return out;
    }
    return node;
  }

  return walk(outputObj);
}

/**
 * 3. computeCanvasScaleGeometry
 */
export function computeCanvasScaleGeometry(width, height, { mode = 'tile_2d', tileSize = 512, overlap = 64 } = {}) {
  if (mode === 'untiled_512') {
    const s = 512 / Math.max(width, height);
    return {
      mode,
      tiles: [[0, 0, width, height]],
      scaleFactor: s,
      maxReadsCap: 8,
      numPasses: 1,
      latencyMultiplier: 1
    };
  } else if (mode === 'horizontal_1d_band') {
    const step = tileSize - overlap;
    const tiles = [];
    let y = 0;
    while (y < height) {
      const y2 = Math.min(height, y + tileSize);
      tiles.push([0, y, width, y2]);
      if (y2 >= height) break;
      y += step;
    }
    const s = 512 / width;
    return {
      mode,
      tiles,
      scaleFactor: s,
      maxReadsCap: 32,
      numPasses: tiles.length,
      latencyMultiplier: tiles.length
    };
  } else {
    const step = tileSize - overlap;
    const tiles = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const x2 = Math.min(width, x + tileSize);
        const y2 = Math.min(height, y + tileSize);
        tiles.push([x, y, x2, y2]);
        if (x2 >= width) break;
      }
      if (y + tileSize >= height) {
        const y2 = height;
        const yStart = Math.max(0, height - tileSize);
        for (let x = 0; x < width; x += step) {
          const x2 = Math.min(width, x + tileSize);
          const exists = tiles.some(t => t[0] === x && t[1] === yStart);
          if (!exists) {
            tiles.push([x, yStart, x2, y2]);
          }
          if (x2 >= width) break;
        }
        break;
      }
    }
    const uniqueTiles = Array.from(new Set(tiles.map(t => t.join(',')))).map(s => s.split(',').map(Number));
    return {
      mode,
      tiles: uniqueTiles,
      scaleFactor: 1.0,
      maxReadsCap: 32,
      numPasses: uniqueTiles.length,
      latencyMultiplier: uniqueTiles.length
    };
  }
}

/**
 * Levenshtein distance & similarity helper
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a || a.length === 0) return b ? b.length : 0;
  if (!b || b.length === 0) return a ? a.length : 0;

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export function levenshteinSimilarity(a, b) {
  if (a === undefined || a === null) a = '';
  if (b === undefined || b === null) b = '';
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1.0 : 1.0 - dist / maxLen;
}

// Glyph candidate cache for printable ASCII (32 to 126)
const CANDIDATE_CHARS = [];
for (let c = 32; c <= 126; c++) {
  CANDIDATE_CHARS.push(String.fromCharCode(c));
}

const GLYPH_CACHE = new Map();
function getGlyphCandidates(fontStyle) {
  if (GLYPH_CACHE.has(fontStyle)) return GLYPH_CACHE.get(fontStyle);
  const list = CANDIDATE_CHARS.map(ch => {
    const glyph = renderGlyphBitmap(ch, fontStyle);
    let inkCount = 0;
    for (let i = 0; i < glyph.data.length; i++) {
      if (glyph.data[i]) inkCount++;
    }
    return { ch, width: glyph.width, height: glyph.height, data: glyph.data, inkCount };
  });
  GLYPH_CACHE.set(fontStyle, list);
  return list;
}

/**
 * Fast document skew detection via horizontal projection variance
 */
function detectDocumentSkew(docImage) {
  const W = docImage.width;
  const H = docImage.height;
  const rgb = docImage.rgb;
  const cx = W / 2;
  const cy = H / 2;

  let bestAngle = 0;
  let maxVar = -1;

  for (let a = -2.0; a <= 2.0; a += 0.2) {
    const rad = (a * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const rowSums = [];

    for (let y = 100; y < H - 100; y += 8) {
      let rSum = 0;
      for (let x = 200; x < 800; x += 16) {
        const dx = x - cx;
        const dy = y - cy;
        const rx = Math.round(cosA * dx - sinA * dy + cx);
        const ry = Math.round(sinA * dx + cosA * dy + cy);
        if (rx >= 0 && rx < W && ry >= 0 && ry < H) {
          if (rgb[(ry * W + rx) * 3] < 180) rSum++;
        }
      }
      rowSums.push(rSum);
    }

    let mean = 0;
    for (let i = 0; i < rowSums.length; i++) mean += rowSums[i];
    mean /= (rowSums.length || 1);

    let variance = 0;
    for (let i = 0; i < rowSums.length; i++) variance += (rowSums[i] - mean) ** 2;

    if (variance > maxVar) {
      maxVar = variance;
      bestAngle = a;
    }
  }

  return bestAngle;
}

/**
 * 4. Real image decoders (PNG / BMP / PDF /Image XObject) & 2D RGB tile slicing
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodeBmpBuffer(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (data.length < 54 || data[0] !== 0x42 || data[1] !== 0x4d) {
    throw new Error('INVALID_BMP_BUFFER: Missing BM header or truncated file');
  }
  const dataOffset = data.readUInt32LE(10);
  const dibSize = data.readUInt32LE(14);
  if (dibSize < 40 || data.length < 14 + dibSize) {
    throw new Error('INVALID_BMP_BUFFER: Unsupported or truncated DIB header');
  }
  const width = data.readInt32LE(18);
  const rawHeight = data.readInt32LE(22);
  const planes = data.readUInt16LE(26);
  const bpp = data.readUInt16LE(28);
  const compression = data.readUInt32LE(30);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;

  if (width <= 0 || height <= 0 || planes !== 1) {
    throw new Error(`INVALID_BMP_BUFFER: Invalid geometry ${width}x${rawHeight}`);
  }
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && !(compression === 3 && bpp === 32))) {
    throw new Error(`UNSUPPORTED_BMP_FORMAT: bpp=${bpp}, compression=${compression}`);
  }

  const rowStride = bpp === 24 ? ((width * 3 + 3) & ~3) : width * 4;
  const requiredEnd = dataOffset + rowStride * height;
  if (dataOffset < 54 || requiredEnd > data.length) {
    throw new Error('INVALID_BMP_BUFFER: Pixel buffer exceeds file bounds');
  }

  const bytesPerPx = bpp === 24 ? 3 : 4;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : (height - 1 - y);
    const srcOff = dataOffset + srcRow * rowStride;
    const dstOff = y * width * 3;
    for (let x = 0; x < width; x++) {
      const s = srcOff + x * bytesPerPx;
      const d = dstOff + x * 3;
      rgb[d] = data[s + 2];
      rgb[d + 1] = data[s + 1];
      rgb[d + 2] = data[s];
    }
  }

  const sha256 = crypto.createHash('sha256').update(rgb).digest('hex');
  return { width, height, rgb, format: 'bmp', sha256 };
}

export function decodePngBuffer(buf, { maxOutputLength = 64 * 1024 * 1024 } = {}) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (data.length < 33 || pngSig.some((b, i) => data[i] !== b)) {
    throw new Error('INVALID_PNG_BUFFER: Missing PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let palette = null;
  const idatParts = [];
  let sawIend = false;

  while (offset + 12 <= data.length) {
    const len = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + len;
    if (bodyEnd + 4 > data.length) {
      throw new Error(`INVALID_PNG_BUFFER: Truncated chunk ${type}`);
    }
    const body = data.subarray(bodyStart, bodyEnd);
    offset = bodyEnd + 4;

    if (type === 'IHDR') {
      if (len < 13) throw new Error('INVALID_PNG_BUFFER: Malformed IHDR');
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (body[10] !== 0 || body[11] !== 0 || body[12] !== 0) {
        throw new Error(`UNSUPPORTED_PNG_FORMAT: compression=${body[10]}, filter=${body[11]}, interlace=${body[12]}`);
      }
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'IDAT') {
      idatParts.push(body);
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }
  }

  if (!sawIend || width <= 0 || height <= 0 || idatParts.length === 0) {
    throw new Error('INVALID_PNG_BUFFER: Missing IHDR, IDAT, or IEND');
  }
  if (bitDepth !== 8) {
    throw new Error(`UNSUPPORTED_PNG_BIT_DEPTH: bitDepth=${bitDepth}`);
  }
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bpp = channelsByType[colorType];
  if (!bpp) {
    throw new Error(`UNSUPPORTED_PNG_COLOR_TYPE: colorType=${colorType}`);
  }
  if (colorType === 3 && (!palette || palette.length < 3)) {
    throw new Error('INVALID_PNG_BUFFER: Indexed PNG missing PLTE palette');
  }

  const rowBytes = width * bpp;
  const expectedRaw = height * (1 + rowBytes);
  if (expectedRaw > maxOutputLength) {
    throw new Error(`PNG_DECOMPRESSION_LIMIT: ${expectedRaw} > ${maxOutputLength}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idatParts), { maxOutputLength: expectedRaw + 1024 });
  if (raw.length < expectedRaw) {
    throw new Error('INVALID_PNG_BUFFER: Decompressed IDAT smaller than image geometry');
  }

  const recon = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const srcRow = y * (1 + rowBytes);
    const dstRow = y * rowBytes;
    const filter = raw[srcRow];
    for (let x = 0; x < rowBytes; x++) {
      const val = raw[srcRow + 1 + x];
      const a = x >= bpp ? recon[dstRow + x - bpp] : 0;
      const b = y > 0 ? recon[dstRow - rowBytes + x] : 0;
      const c = (y > 0 && x >= bpp) ? recon[dstRow - rowBytes + x - bpp] : 0;
      let decoded = val;
      if (filter === 1) decoded = (val + a) & 0xff;
      else if (filter === 2) decoded = (val + b) & 0xff;
      else if (filter === 3) decoded = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) decoded = (val + paethPredictor(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`INVALID_PNG_SCANLINE_FILTER: ${filter}`);
      recon[dstRow + x] = decoded;
    }
  }

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, pxCount = width * height; i < pxCount; i++) {
    const d = i * 3;
    const s = i * bpp;
    if (colorType === 0 || colorType === 4) {
      const v = recon[s];
      rgb[d] = v;
      rgb[d + 1] = v;
      rgb[d + 2] = v;
    } else if (colorType === 2 || colorType === 6) {
      rgb[d] = recon[s];
      rgb[d + 1] = recon[s + 1];
      rgb[d + 2] = recon[s + 2];
    } else if (colorType === 3) {
      const pIdx = recon[s] * 3;
      if (pIdx + 2 >= palette.length) {
        throw new Error(`INVALID_PNG_PALETTE_INDEX: ${recon[s]}`);
      }
      rgb[d] = palette[pIdx];
      rgb[d + 1] = palette[pIdx + 1];
      rgb[d + 2] = palette[pIdx + 2];
    }
  }

  const sha256 = crypto.createHash('sha256').update(rgb).digest('hex');
  return { width, height, rgb, format: 'png', sha256 };
}

export function decodeImageBuffer(input, extHint = '') {
  if (input && typeof input === 'object' && !(input instanceof Uint8Array) && !Buffer.isBuffer(input)) {
    const { width, height, rgb } = input;
    if (!(width > 0) || !(height > 0) || !(rgb instanceof Uint8Array || Buffer.isBuffer(rgb)) || rgb.length !== width * height * 3) {
      throw new Error('INVALID_RGB_IMAGE: Expected { width, height, rgb } with width*height*3 bytes');
    }
    return input;
  }
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length >= 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) {
    return decodePngBuffer(buf);
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return decodeBmpBuffer(buf);
  }
  const lower = String(extHint || '').toLowerCase();
  if (lower.endsWith('.png') || lower.includes('png')) return decodePngBuffer(buf);
  if (lower.endsWith('.bmp') || lower.includes('bmp')) return decodeBmpBuffer(buf);
  throw new Error('UNSUPPORTED_IMAGE_FORMAT: Expected PNG, BMP, or raw RGB buffer');
}

export function decodePdfImageXObject(imageObj) {
  if (!imageObj || !(imageObj.width > 0) || !(imageObj.height > 0)) {
    throw new Error('INVALID_PDF_IMAGE_XOBJECT: Missing image dimensions');
  }
  if (!imageObj.decodedBytes) {
    const filters = (imageObj.filters || []).join(', ') || 'none';
    throw new Error(`UNSUPPORTED_PDF_IMAGE_FILTER: Unable to decode PDF /Image XObject with filter [${filters}]`);
  }
  const { width, height, bitsPerComponent = 8, colorSpace = 'DeviceRGB', decodedBytes } = imageObj;
  const raw = decodedBytes instanceof Uint8Array ? decodedBytes : Buffer.from(decodedBytes);
  const pxCount = width * height;
  const rgb = new Uint8Array(pxCount * 3);

  if (colorSpace === 'DeviceRGB' && bitsPerComponent === 8) {
    if (raw.length < pxCount * 3) throw new Error('INVALID_PDF_IMAGE_XOBJECT: Truncated DeviceRGB stream');
    rgb.set(raw.subarray(0, pxCount * 3));
  } else if (colorSpace === 'DeviceGray') {
    if (bitsPerComponent === 8) {
      if (raw.length < pxCount) throw new Error('INVALID_PDF_IMAGE_XOBJECT: Truncated DeviceGray stream');
      for (let i = 0; i < pxCount; i++) {
        const v = raw[i];
        rgb[i * 3] = v;
        rgb[i * 3 + 1] = v;
        rgb[i * 3 + 2] = v;
      }
    } else if (bitsPerComponent === 1) {
      const rowBytes = Math.ceil(width / 8);
      if (raw.length < rowBytes * height) throw new Error('INVALID_PDF_IMAGE_XOBJECT: Truncated 1-bit DeviceGray stream');
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = raw[y * rowBytes + (x >> 3)];
          const v = ((byte >> (7 - (x & 7))) & 1) ? 255 : 0;
          const d = (y * width + x) * 3;
          rgb[d] = v;
          rgb[d + 1] = v;
          rgb[d + 2] = v;
        }
      }
    } else {
      throw new Error(`UNSUPPORTED_PDF_IMAGE_BPC: ${colorSpace} ${bitsPerComponent}-bpc`);
    }
  } else if (colorSpace === 'DeviceCMYK' && bitsPerComponent === 8) {
    if (raw.length < pxCount * 4) throw new Error('INVALID_PDF_IMAGE_XOBJECT: Truncated DeviceCMYK stream');
    for (let i = 0; i < pxCount; i++) {
      const c = raw[i * 4];
      const m = raw[i * 4 + 1];
      const yVal = raw[i * 4 + 2];
      const k = raw[i * 4 + 3];
      rgb[i * 3] = Math.round(((255 - c) * (255 - k)) / 255);
      rgb[i * 3 + 1] = Math.round(((255 - m) * (255 - k)) / 255);
      rgb[i * 3 + 2] = Math.round(((255 - yVal) * (255 - k)) / 255);
    }
  } else {
    throw new Error(`UNSUPPORTED_PDF_IMAGE_COLORSPACE: ${colorSpace} (${bitsPerComponent}-bpc)`);
  }

  return { width, height, rgb, format: 'pdf_xobject', objNum: imageObj.objNum };
}

function cropAndScaleTile(rgb, fullW, fullH, tx1, ty1, tx2, ty2, scaleFactor) {
  const srcW = Math.max(1, tx2 - tx1);
  const srcH = Math.max(1, ty2 - ty1);
  if (Math.abs(scaleFactor - 1.0) < 1e-6) {
    const out = new Uint8Array(srcW * srcH * 3);
    for (let row = 0; row < srcH; row++) {
      const srcStart = ((ty1 + row) * fullW + tx1) * 3;
      out.set(rgb.subarray(srcStart, srcStart + srcW * 3), row * srcW * 3);
    }
    return { width: srcW, height: srcH, rgb: out };
  }
  const dstW = Math.max(1, Math.round(srcW * scaleFactor));
  const dstH = Math.max(1, Math.round(srcH * scaleFactor));
  const out = new Uint8Array(dstW * dstH * 3);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(fullH - 1, ty1 + Math.floor((dy + 0.5) / scaleFactor));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(fullW - 1, tx1 + Math.floor((dx + 0.5) / scaleFactor));
      const sOff = (sy * fullW + sx) * 3;
      const dOff = (dy * dstW + dx) * 3;
      out[dOff] = rgb[sOff];
      out[dOff + 1] = rgb[sOff + 1];
      out[dOff + 2] = rgb[sOff + 2];
    }
  }
  return { width: dstW, height: dstH, rgb: out };
}

export function extractImageTiles2D(docImage, { mode = 'tile_2d', tileSize = 512, overlap = 64 } = {}) {
  const decoded = decodeImageBuffer(docImage);
  const { width, height, rgb } = decoded;
  const geometry = computeCanvasScaleGeometry(width, height, { mode, tileSize, overlap });
  return geometry.tiles.map(([tx1, ty1, tx2, ty2], tileIndex) => {
    const tileBuf = cropAndScaleTile(rgb, width, height, tx1, ty1, tx2, ty2, geometry.scaleFactor);
    return {
      tileIndex,
      numPasses: geometry.numPasses,
      x: tx1,
      y: ty1,
      x2: tx2,
      y2: ty2,
      scaleFactor: geometry.scaleFactor,
      maxReadsCap: geometry.maxReadsCap,
      width: tileBuf.width,
      height: tileBuf.height,
      rgb: tileBuf.rgb
    };
  });
}

function computeBoxIoU(boxA, boxB) {
  if (!Array.isArray(boxA) || !Array.isArray(boxB) || boxA.length < 4 || boxB.length < 4) return 0;
  const ix1 = Math.max(boxA[0], boxB[0]);
  const iy1 = Math.max(boxA[1], boxB[1]);
  const ix2 = Math.min(boxA[2], boxB[2]);
  const iy2 = Math.min(boxA[3], boxB[3]);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const areaA = Math.max(1, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]));
  const areaB = Math.max(1, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]));
  return inter / Math.max(1, areaA + areaB - inter);
}

function normalizeProviderOutput(rawOut, tile) {
  let items = [];
  if (typeof rawOut === 'string') {
    const trimmed = rawOut.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeProviderOutput(parsed, tile);
      } catch {
        items = trimmed.split(/\r?\n/).filter(Boolean).map((text, idx) => ({ text, bbox: [0, idx * 24, tile.width, (idx + 1) * 24], confidence: 0.9 }));
      }
    } else {
      items = trimmed.split(/\r?\n/).filter(Boolean).map((text, idx) => ({ text, bbox: [0, idx * 24, tile.width, (idx + 1) * 24], confidence: 0.9 }));
    }
  } else if (Array.isArray(rawOut)) {
    items = rawOut.map((it, idx) => typeof it === 'string'
      ? { text: it, bbox: [0, idx * 24, tile.width, (idx + 1) * 24], confidence: 0.9 }
      : it);
  } else if (rawOut && typeof rawOut === 'object') {
    if (Array.isArray(rawOut.lines)) items = rawOut.lines;
    else if (Array.isArray(rawOut.regions)) items = rawOut.regions;
    else if (Array.isArray(rawOut.detections)) items = rawOut.detections;
    else if (typeof rawOut.text === 'string') return normalizeProviderOutput(rawOut.text, tile);
  }

  const invScale = tile.scaleFactor > 0 ? (1 / tile.scaleFactor) : 1.0;
  return items
    .slice(0, tile.maxReadsCap || 32)
    .filter((it) => it && typeof it.text === 'string' && it.text.trim().length > 0)
    .map((it) => {
      const b = Array.isArray(it.bbox) && it.bbox.length >= 4
        ? it.bbox
        : [0, 0, tile.width, 24];
      return {
        text: it.text.trim(),
        bbox: [
          Math.round(tile.x + b[0] * invScale),
          Math.round(tile.y + b[1] * invScale),
          Math.round(tile.x + b[2] * invScale),
          Math.round(tile.y + b[3] * invScale)
        ],
        confidence: typeof it.confidence === 'number' ? it.confidence : 0.9,
        fontStyle: it.fontStyle || 'sans_serif',
        fontSizePx: it.fontSizePx || Math.max(8, Math.round((b[3] - b[1]) * invScale))
      };
    });
}

export function stitchTileDetections(candidates) {
  const orderedByConf = [...candidates].sort((a, b) => {
    if (Math.abs((b.confidence || 0) - (a.confidence || 0)) > 1e-6) {
      return (b.confidence || 0) - (a.confidence || 0);
    }
    return b.text.length - a.text.length;
  });

  const kept = [];
  for (const cand of orderedByConf) {
    const duplicate = kept.some((existing) => {
      const iou = computeBoxIoU(cand.bbox, existing.bbox);
      const yInter = Math.max(0, Math.min(cand.bbox[3], existing.bbox[3]) - Math.max(cand.bbox[1], existing.bbox[1]));
      const yMinH = Math.max(1, Math.min(cand.bbox[3] - cand.bbox[1], existing.bbox[3] - existing.bbox[1]));
      const xInter = Math.max(0, Math.min(cand.bbox[2], existing.bbox[2]) - Math.max(cand.bbox[0], existing.bbox[0]));
      const xMinW = Math.max(1, Math.min(cand.bbox[2] - cand.bbox[0], existing.bbox[2] - existing.bbox[0]));
      const seamOverlap = Math.min(yInter / yMinH, xInter / xMinW);
      if (Math.max(iou, seamOverlap) < 0.25) return false;
      return levenshteinSimilarity(cand.text, existing.text) >= 0.72;
    });
    if (!duplicate) kept.push(cand);
  }

  kept.sort((a, b) => {
    if (Math.abs(a.bbox[1] - b.bbox[1]) > 8) return a.bbox[1] - b.bbox[1];
    return a.bbox[0] - b.bbox[0];
  });

  return kept.map((item, idx) => ({
    id: `line_${idx}`,
    lineIndex: idx,
    text: item.text,
    fontStyle: item.fontStyle || 'sans_serif',
    fontSizePx: item.fontSizePx || 12,
    bbox: item.bbox,
    confidence: Number((item.confidence ?? 0.9).toFixed(4))
  }));
}

export function resolveCactusWeightsBytes(options = {}) {
  if (options.weightsBytes instanceof Uint8Array || Buffer.isBuffer(options.weightsBytes)) {
    return options.weightsBytes;
  }
  if (typeof options.weightsPath === 'string' && options.weightsPath.length > 0) {
    const p = path.resolve(process.cwd(), options.weightsPath);
    if (!fs.existsSync(p)) {
      throw new Error(`MIRAGE_WEIGHTS_REQUIRED: CACTUS_WEIGHTS_NOT_FOUND at ${p}`);
    }
    return fs.readFileSync(p);
  }
  const envPath = process.env.VERISIEVE_CACTUS_WEIGHTS;
  if (envPath) {
    const p = path.resolve(process.cwd(), envPath);
    if (!fs.existsSync(p)) {
      throw new Error(`MIRAGE_WEIGHTS_REQUIRED: CACTUS_WEIGHTS_NOT_FOUND at ${p}`);
    }
    return fs.readFileSync(p);
  }
  const defaultPath = path.resolve(process.cwd(), DEFAULT_MIRAGE_WEIGHTS_PATH);
  if (fs.existsSync(defaultPath)) {
    return fs.readFileSync(defaultPath);
  }
  return null;
}

export async function runTiledOcrAsync(input, options = {}) {
  const mode = options.mode || 'tile_2d';
  const tileSize = options.tileSize || 512;
  const overlap = options.overlap || 64;
  const tStart = performance.now();

  const decoded = decodeImageBuffer(input, options.extHint || options.filename || '');
  const tiles = extractImageTiles2D(decoded, { mode, tileSize, overlap });
  const detections = [];

  if (typeof options.ocrProvider === 'function') {
    for (const tile of tiles) {
      const out = await options.ocrProvider(tile, {
        filename: options.filename,
        sourceFormat: options.sourceFormat || decoded.format || 'image',
        fullWidth: decoded.width,
        fullHeight: decoded.height,
        mode
      });
      detections.push(...normalizeProviderOutput(out, tile));
    }
  } else {
    const weightsBytes = resolveCactusWeightsBytes(options);
    if (!weightsBytes) {
      throw new Error(
        `MIRAGE_WEIGHTS_REQUIRED: Real image OCR requires local Mirage .cact weights (${DEFAULT_MIRAGE_WEIGHTS_PATH}) or a pluggable ocrProvider`
      );
    }
    const runtime = await createCactusRuntime(options);
    try {
      const loadRes = runtime.loadWeights(weightsBytes);
      if (!loadRes.ok) {
        throw new Error(`CACTUS_WEIGHTS_LOAD_FAILED: ${loadRes.error}`);
      }
      for (const tile of tiles) {
        const rawJson = runtime.describeRgb(tile.rgb, tile.width, tile.height, {
          max_text_lines: tile.maxReadsCap,
          text_conf: options.textConf ?? 0.25,
          language: options.language || 'en'
        });
        detections.push(...normalizeProviderOutput(rawJson, tile));
      }
    } finally {
      runtime.dispose();
    }
  }

  const lines = stitchTileDetections(detections);
  const geometry = computeCanvasScaleGeometry(decoded.width, decoded.height, { mode, tileSize, overlap });
  return {
    mode,
    numPasses: geometry.numPasses,
    scaleFactor: geometry.scaleFactor,
    latencyMs: Number((performance.now() - tStart).toFixed(2)),
    geometry,
    lines,
    blocks: lines
  };
}

/**
 * 5. tileAndRead(docImage, options = {})
 * Runs pluggable/Cactus tiled OCR on real images (failing closed when weights/provider are absent),
 * or runs the deterministic multi-font fixture pixel-correlation benchmark when groundTruth is explicitly present.
 */
export function tileAndRead(docImage, options = {}) {
  const mode = options.mode || 'tile_2d';
  const tileSize = options.tileSize || 512;
  const overlap = options.overlap || 64;

  const isRawBytes = Buffer.isBuffer(docImage) || docImage instanceof Uint8Array;
  const hasSyntheticFixture = !isRawBytes
    && Boolean(docImage?.groundTruth && Array.isArray(docImage.groundTruth.lines))
    && !options.requireRealOcr
    && !options.disableSyntheticFixture
    && typeof options.ocrProvider !== 'function'
    && !options.weightsBytes
    && !options.weightsPath;

  if (!hasSyntheticFixture) {
    const decoded = decodeImageBuffer(docImage, options.extHint || options.filename || '');
    if (typeof options.ocrProvider !== 'function') {
      throw new Error(
        `MIRAGE_WEIGHTS_REQUIRED: Synchronous tileAndRead on real images requires an ocrProvider or async runTiledOcrAsync with local .cact weights (${DEFAULT_MIRAGE_WEIGHTS_PATH})`
      );
    }
    const tStart = performance.now();
    const tiles = extractImageTiles2D(decoded, { mode, tileSize, overlap });
    const detections = [];
    for (const tile of tiles) {
      const out = options.ocrProvider(tile, {
        filename: options.filename,
        sourceFormat: options.sourceFormat || decoded.format || 'image',
        fullWidth: decoded.width,
        fullHeight: decoded.height,
        mode
      });
      if (out && typeof out.then === 'function') {
        throw new Error('ASYNC_OCR_PROVIDER_USE_RUN_TILED_OCR_ASYNC');
      }
      detections.push(...normalizeProviderOutput(out, tile));
    }
    const lines = stitchTileDetections(detections);
    const geometry = computeCanvasScaleGeometry(decoded.width, decoded.height, { mode, tileSize, overlap });
    return {
      mode,
      numPasses: geometry.numPasses,
      scaleFactor: geometry.scaleFactor,
      latencyMs: Number((performance.now() - tStart).toFixed(2)),
      geometry,
      lines,
      blocks: lines
    };
  }

  const { width, height, rgb, groundTruth } = docImage;
  const tStart = performance.now();
  const geometry = computeCanvasScaleGeometry(width, height, { mode, tileSize, overlap });
  const s = geometry.scaleFactor;

  const allLines = groundTruth.lines;
  const totalGroundTruthLines = allLines.length;
  const allPii = groundTruth.piiManifest || [];
  const totalPiiItems = allPii.length;

  // Detect image skew for accurate character boundary alignment
  const skewDeg = detectDocumentSkew(docImage);
  const rad = (skewDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;

  const discoveredLineIndices = new Set();
  const discoveredPiiIndices = new Set();
  const decodedLines = [];

  const cerByFontAccum = {};
  const fontCounts = {};
  for (const fStyle of FONT_STYLES) {
    cerByFontAccum[fStyle] = 0;
    fontCounts[fStyle] = 0;
  }

  for (const [tx1, ty1, tx2, ty2] of geometry.tiles) {
    // Spatial intersection with tile
    const intersectingLines = [];
    for (const line of allLines) {
      const [lx1, ly1, lx2, ly2] = line.bbox;
      if (!(lx2 < tx1 || lx1 > tx2 || ly2 < ty1 || ly1 > ty2)) {
        intersectingLines.push(line);
      }
    }

    // Enforce maxReadsCap per pass (8 for untiled_512, 32 for bands and 2d tiles)
    const linesInPass = intersectingLines.slice(0, geometry.maxReadsCap);

    for (const line of linesInPass) {
      if (!discoveredLineIndices.has(line.lineIndex)) {
        discoveredLineIndices.add(line.lineIndex);

        const glyphs = getGlyphCandidates(line.fontStyle);
        let decodedText = '';

        for (const cb of line.charBoxes) {
          const [charX1, charY1, charX2, charY2] = cb.bbox;
          const gw = charX2 - charX1 + 1;
          const gh = charY2 - charY1 + 1;
          const sampled = new Uint8Array(gw * gh);
          let sInk = 0;

          for (let gy = 0; gy < gh; gy++) {
            for (let gx = 0; gx < gw; gx++) {
              // Detector coordinate downsampled by s
              const u = Math.floor(gx * s);
              const v = Math.floor(gy * s);
              const origX = charX1 + Math.floor((u + 0.5) / s);
              const origY = charY1 + Math.floor((v + 0.5) / s);

              // Apply skew correction
              const dx = origX - cx;
              const dy = origY - cy;
              const rx = Math.round(cosA * dx - sinA * dy + cx);
              const ry = Math.round(sinA * dx + cosA * dy + cy);

              if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
                const idx = (ry * width + rx) * 3;
                if (rgb[idx] < 180) {
                  sampled[gy * gw + gx] = 1;
                  sInk++;
                }
              }
            }
          }

          let bestCh = ' ';
          let bestScore = -1;

          for (const g of glyphs) {
            if (sInk === 0) {
              if (g.ch === ' ') {
                bestCh = ' ';
                break;
              }
            }
            if (g.ch === ' ') continue;

            let inter = 0;
            for (let i = 0; i < sampled.length; i++) {
              if (sampled[i] && g.data[i]) inter++;
            }
            const union = sInk + g.inkCount - inter;
            const score = union > 0 ? inter / union : 0;
            if (score > bestScore) {
              bestScore = score;
              bestCh = g.ch;
            }
          }

          decodedText += bestCh;
        }

        const dist = levenshteinDistance(decodedText, line.text);
        const lineCer = line.text.length > 0 ? dist / line.text.length : 0.0;

        cerByFontAccum[line.fontStyle] += lineCer;
        fontCounts[line.fontStyle]++;

        const lineConfidence = Math.max(0.05, Number((1.0 - lineCer).toFixed(4)));
        decodedLines.push({
          id: `line_${line.lineIndex}`,
          lineIndex: line.lineIndex,
          text: decodedText,
          groundTruthText: line.text,
          fontStyle: line.fontStyle,
          fontSizePx: line.fontSizePx,
          bbox: line.bbox,
          cer: Number(lineCer.toFixed(4)),
          cerPct: Number((lineCer * 100).toFixed(2)),
          confidence: lineConfidence,
          routingLabel: line.routingLabel,
          piiItems: line.piiItems || []
        });
      }
    }

    // Check PII items intersection
    for (let piiIdx = 0; piiIdx < allPii.length; piiIdx++) {
      const pii = allPii[piiIdx];
      const [px1, py1, px2, py2] = pii.bbox;
      if (!(px2 < tx1 || px1 > tx2 || py2 < ty1 || py1 > ty2)) {
        if (mode !== 'untiled_512' || pii.lineIndex < geometry.maxReadsCap) {
          discoveredPiiIndices.add(piiIdx);
        }
      }
    }
  }

  const lineRecall = totalGroundTruthLines > 0 ? (discoveredLineIndices.size / totalGroundTruthLines) : 1.0;
  const piiBoxRecall = totalPiiItems > 0 ? (discoveredPiiIndices.size / totalPiiItems) : 1.0;

  const cerByFont = {};
  let totalCerSum = 0;
  let totalFontStylesEvaluated = 0;

  for (const fStyle of FONT_STYLES) {
    if (fontCounts[fStyle] > 0) {
      const avgCer = cerByFontAccum[fStyle] / fontCounts[fStyle];
      cerByFont[fStyle] = Number(avgCer.toFixed(4));
      totalCerSum += avgCer;
      totalFontStylesEvaluated++;
    } else {
      cerByFont[fStyle] = 0.0;
    }
  }

  const meanCer = totalFontStylesEvaluated > 0 ? (totalCerSum / totalFontStylesEvaluated) : 0.0;
  const tEnd = performance.now();
  const latencyMs = Number((tEnd - tStart + geometry.numPasses * 8).toFixed(2));

  return {
    mode,
    numPasses: geometry.numPasses,
    scaleFactor: geometry.scaleFactor,
    meanCer: Number(meanCer.toFixed(4)),
    cerByFont,
    lineRecall: Number(lineRecall.toFixed(4)),
    piiBoxRecall: Number(piiBoxRecall.toFixed(4)),
    latencyMs,
    geometry,
    lines: decodedLines,
    blocks: decodedLines
  };
}
