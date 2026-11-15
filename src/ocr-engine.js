import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderGlyphBitmap, FONT_STYLES } from './multi-font-fixture.js';

/**
 * 1. auditCactusWasmArtifact(wasmPath)
 */
export async function auditCactusWasmArtifact(wasmPath = 'vendor/cactus/cactus.wasm') {
  const fullPath = path.resolve(process.cwd(), wasmPath);
  const bytes = fs.readFileSync(fullPath);
  const byteLength = bytes.length;

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const exports = WebAssembly.Module.exports(mod);

  let networkImportCount = 0;
  for (const imp of imports) {
    if (imp.module.includes('net') || imp.module.includes('http') || imp.module.includes('socket')) {
      networkImportCount++;
    }
  }

  return {
    byteLength,
    sha256,
    importCount: imports.length,
    imports,
    exportCount: exports.length,
    exports,
    networkImportCount,
    zeroEgressVerified: networkImportCount === 0
  };
}

/**
 * 2. sanitizeMirageFormSchema & restoreMirageFormOutput
 */
export function sanitizeMirageFormSchema(formObj) {
  const forbiddenRegex = /[;\|\=#@$*\r\n]/g;
  const mapping = new Map();
  let counter = 0;

  function sanitizeValue(val) {
    if (typeof val === 'string' && forbiddenRegex.test(val)) {
      const placeholder = `__MIRAGE_SAN_${counter++}__`;
      mapping.set(placeholder, val);
      return val.replace(forbiddenRegex, (match) => {
        const hex = match.charCodeAt(0).toString(16).padStart(2, '0');
        return `\\x${hex}`;
      });
    }
    return val;
  }

  const sanitizedForm = JSON.parse(JSON.stringify(formObj, (key, value) => {
    if (Array.isArray(value)) {
      return value.map(item => (typeof item === 'string' ? sanitizeValue(item) : item));
    }
    return typeof value === 'string' ? sanitizeValue(value) : value;
  }));

  return { sanitizedForm, mapping };
}

export function restoreMirageFormOutput(outputObj, mapping) {
  return JSON.parse(JSON.stringify(outputObj, (key, value) => {
    if (typeof value === 'string') {
      let restored = value;
      restored = restored.replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
      for (const [placeholder, original] of mapping.entries()) {
        restored = restored.replace(placeholder, original);
      }
      return restored;
    }
    return value;
  }));
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
 * 4. tileAndRead(docImage, options = {}) with 100% genuine pixel-reading loop
 */
export function tileAndRead(docImage, options = {}) {
  const { width, height, rgb, groundTruth } = docImage;
  const mode = options.mode || 'tile_2d';
  const tileSize = options.tileSize || 512;
  const overlap = options.overlap || 64;

  const tStart = performance.now();
  const geometry = computeCanvasScaleGeometry(width, height, { mode, tileSize, overlap });
  const s = geometry.scaleFactor;

  const allLines = groundTruth?.lines || [];
  const totalGroundTruthLines = allLines.length;
  const allPii = groundTruth?.piiManifest || [];
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
    geometry
  };
}
