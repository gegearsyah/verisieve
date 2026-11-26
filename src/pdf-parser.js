/**
 * src/pdf-parser.js
 * Zero-dependency born-digital PDF parser, filter decoder, /ObjStm reader,
 * scoped /ToUnicode CMap decoder, /Subtype /Image XObject extractor,
 * and coordinate/negative-kerning TJ text reconstruction.
 */

import zlib from 'node:zlib';

const DEFAULT_MAX_STREAM_BYTES = 32 * 1024 * 1024;

// WinAnsi 0x80..0x9F mapping to Unicode codepoints
const WINANSI_SPECIAL = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

function winAnsiByteToChar(b) {
  if (WINANSI_SPECIAL[b] !== undefined) {
    return String.fromCodePoint(WINANSI_SPECIAL[b]);
  }
  return String.fromCharCode(b);
}

export function decodeAscii85(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'ascii');
  let i = 0;
  // Skip leading <~ if present
  while (i < bytes.length && bytes[i] <= 32) i += 1;
  if (bytes[i] === 0x3c && bytes[i + 1] === 0x7e) i += 2;

  const out = [];
  const group = [];
  for (; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x7e && bytes[i + 1] === 0x3e) break; // ~>
    if (b <= 32) continue;
    if (b === 0x7a && group.length === 0) {
      // 'z' shorthand for four zero bytes
      out.push(0, 0, 0, 0);
      continue;
    }
    if (b < 33 || b > 117) {
      throw new Error(`PDF_FILTER_ERROR: Invalid ASCII85 byte 0x${b.toString(16)}`);
    }
    group.push(b - 33);
    if (group.length === 5) {
      let val = 0;
      for (let j = 0; j < 5; j += 1) val = val * 85 + group[j];
      out.push((val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff);
      group.length = 0;
    }
  }
  if (group.length >= 2) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    let val = 0;
    for (let j = 0; j < 5; j += 1) val = val * 85 + group[j];
    const tail = [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
    for (let j = 0; j < k - 1; j += 1) out.push(tail[j]);
  }
  return Buffer.from(out);
}

export function decodeAsciiHex(input) {
  const str = Buffer.isBuffer(input) ? input.toString('ascii') : String(input);
  let hex = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '>') break;
    if (/[0-9a-fA-F]/.test(ch)) hex += ch;
  }
  if (hex.length % 2 === 1) hex += '0';
  return Buffer.from(hex, 'hex');
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function unfilterPngPredictor(data, params = {}) {
  const predictor = params.predictor ?? 1;
  if (predictor < 10) return data;
  const columns = Math.max(1, params.columns ?? 1);
  const colors = Math.max(1, params.colors ?? 1);
  const bpc = Math.max(1, params.bitsPerComponent ?? 8);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.ceil((columns * colors * bpc) / 8);
  const stride = rowBytes + 1;
  const numRows = Math.floor(data.length / stride);
  const out = Buffer.alloc(numRows * rowBytes);

  for (let r = 0; r < numRows; r += 1) {
    const filterType = data[r * stride];
    const srcOff = r * stride + 1;
    const dstOff = r * rowBytes;
    const prevOff = (r - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const raw = data[srcOff + x];
      const left = x >= bpp ? out[dstOff + x - bpp] : 0;
      const up = r > 0 ? out[prevOff + x] : 0;
      const upLeft = r > 0 && x >= bpp ? out[prevOff + x - bpp] : 0;
      let val = raw;
      if (filterType === 1) val = (raw + left) & 0xff;
      else if (filterType === 2) val = (raw + up) & 0xff;
      else if (filterType === 3) val = (raw + ((left + up) >> 1)) & 0xff;
      else if (filterType === 4) val = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      out[dstOff + x] = val;
    }
  }
  return out;
}

function parseDecodeParms(dictStr) {
  const m = dictStr.match(/\/DecodeParms\s*<<([\s\S]*?)>>/);
  if (!m) return {};
  const body = m[1];
  const predictor = body.match(/\/Predictor\s+(\d+)/)?.[1];
  const columns = body.match(/\/Columns\s+(\d+)/)?.[1];
  const colors = body.match(/\/Colors\s+(\d+)/)?.[1];
  const bpc = body.match(/\/BitsPerComponent\s+(\d+)/)?.[1];
  return {
    predictor: predictor ? Number(predictor) : 1,
    columns: columns ? Number(columns) : 1,
    colors: colors ? Number(colors) : 1,
    bitsPerComponent: bpc ? Number(bpc) : 8,
  };
}

export function extractFilterNames(dictStr) {
  const arrMatch = dictStr.match(/\/Filter\s*\[([^\]]+)\]/);
  if (arrMatch) {
    return Array.from(arrMatch[1].matchAll(/\/([A-Za-z0-9_]+)/g), (m) => m[1]);
  }
  const singleMatch = dictStr.match(/\/Filter\s*\/([A-Za-z0-9_]+)/);
  return singleMatch ? [singleMatch[1]] : [];
}

export function decodePdfStreamData(dictStr, rawBytes, options = {}) {
  const maxOutputLength = options.maxOutputLength || DEFAULT_MAX_STREAM_BYTES;
  const filters = extractFilterNames(dictStr);
  const decodeParms = parseDecodeParms(dictStr);
  let current = rawBytes;

  for (const filter of filters) {
    if (filter === 'ASCII85Decode' || filter === 'A85') {
      current = decodeAscii85(current);
    } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      current = decodeAsciiHex(current);
    } else if (filter === 'FlateDecode' || filter === 'Fl') {
      if (typeof options.inflateFn === 'function') {
        current = Buffer.from(options.inflateFn(current, maxOutputLength));
      } else {
        try {
          current = zlib.inflateSync(current, { maxOutputLength });
        } catch (err) {
          if (/maxOutputLength|too large/i.test(err.message)) throw err;
          current = zlib.inflateRawSync(current, { maxOutputLength });
        }
      }
      if ((decodeParms.predictor ?? 1) >= 10) {
        current = unfilterPngPredictor(current, decodeParms);
      }
    } else {
      return { decoded: null, unsupportedFilter: filter, filters };
    }
  }

  return { decoded: current, unsupportedFilter: null, filters };
}

function hexToUnicodeString(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (!clean) return '';
  if (clean.length <= 4) {
    const cp = parseInt(clean, 16);
    if (cp === 0) return '';
    return String.fromCodePoint(cp);
  }
  const evenHex = clean.length % 2 === 1 ? '0' + clean : clean;
  const buf = Buffer.from(evenHex, 'hex');
  if (buf.length >= 2 && buf.length % 2 === 0) {
    buf.swap16();
    return buf.toString('utf16le');
  }
  return Array.from(buf, (b) => winAnsiByteToChar(b)).join('');
}

function incrementUnicodeDestination(hex, increment) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const value = (BigInt(`0x${clean}`) + BigInt(increment)).toString(16);
  return hexToUnicodeString(value.padStart(clean.length, '0'));
}

export function parseToUnicodeCMap(cmapText) {
  const codeLengths = new Set();
  const csBlocks = cmapText.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g);
  for (const blk of csBlocks) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      if (m[1].length >= 2 && m[1].length % 2 === 0) codeLengths.add(m[1].length);
    }
  }

  const byLenMap = new Map();
  const addEntry = (srcHexRaw, dstStr) => {
    const srcHex = srcHexRaw.toUpperCase();
    const keyLen = srcHex.length;
    codeLengths.add(keyLen);
    if (!byLenMap.has(keyLen)) byLenMap.set(keyLen, new Map());
    byLenMap.get(keyLen).set(srcHex, dstStr);
  };

  for (const blk of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      addEntry(pair[1], hexToUnicodeString(pair[2]));
    }
  }

  for (const blk of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = blk[1];
    // Handle <start> <end> [<d1> <d2> ...] AND <start> <end> <dstStart>
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g;
    for (const r of body.matchAll(lineRegex)) {
      const start = parseInt(r[1], 16);
      const end = parseInt(r[2], 16);
      const padLen = r[1].length;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 65535) continue;

      if (r[3].startsWith('[')) {
        const items = Array.from(r[3].matchAll(/<([0-9a-fA-F]+)>/g), (m) => m[1]);
        for (let i = 0; i <= end - start && i < items.length; i += 1) {
          const srcHex = (start + i).toString(16).toUpperCase().padStart(padLen, '0');
          addEntry(srcHex, hexToUnicodeString(items[i]));
        }
      } else {
        const dstRaw = r[3].slice(1, -1);
        for (let i = 0; i <= end - start; i += 1) {
          const srcHex = (start + i).toString(16).toUpperCase().padStart(padLen, '0');
          addEntry(srcHex, incrementUnicodeDestination(dstRaw, i));
        }
      }
    }
  }

  const orderedLens = [...codeLengths].sort((a, b) => b - a);
  const decodeHex = (hexRaw) => {
    const hex = hexRaw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (!hex || byLenMap.size === 0) return null;
    let out = '';
    let i = 0;
    let matchedAny = false;
    while (i < hex.length) {
      let hit = false;
      for (const kl of orderedLens) {
        if (i + kl <= hex.length) {
          const sub = hex.slice(i, i + kl);
          const mapped = byLenMap.get(kl)?.get(sub);
          if (mapped !== undefined) {
            out += mapped;
            i += kl;
            hit = true;
            matchedAny = true;
            break;
          }
        }
      }
      if (!hit) {
        const step = orderedLens[orderedLens.length - 1] || 2;
        const fallbackSlice = hex.slice(i, i + Math.min(2, hex.length - i));
        if (fallbackSlice.length === 2) {
          const code = parseInt(fallbackSlice, 16);
          if (code >= 0x20 && code <= 0x7e) out += String.fromCharCode(code);
        }
        i += Math.max(2, Math.min(step, hex.length - i));
      }
    }
    return matchedAny ? out : null;
  };

  return { orderedLens, byLenMap, decodeHex };
}

function readBalancedDict(text, startIdx) {
  let pos = text.indexOf('<<', startIdx);
  if (pos === -1) return { dictStr: '', endIdx: startIdx };
  let depth = 0;
  let i = pos;
  while (i < text.length) {
    if (text[i] === '(') {
      // Skip PDF literal string inside dict
      i += 1;
      let pDepth = 1;
      while (i < text.length && pDepth > 0) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '(') pDepth += 1;
        else if (text[i] === ')') pDepth -= 1;
        i += 1;
      }
      continue;
    }
    if (text[i] === '<' && text[i + 1] === '<') {
      depth += 1;
      i += 2;
      continue;
    }
    if (text[i] === '>' && text[i + 1] === '>') {
      depth -= 1;
      i += 2;
      if (depth === 0) {
        return { dictStr: text.slice(pos, i), endIdx: i };
      }
      continue;
    }
    i += 1;
  }
  return { dictStr: text.slice(pos), endIdx: text.length };
}

function parseTopLevelPdfObjects(buf) {
  const latin = buf.toString('latin1');
  const objects = new Map();
  const streamRanges = [];
  const objRegex = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let searchPos = 0;

  while (true) {
    objRegex.lastIndex = searchPos;
    const m = objRegex.exec(latin);
    if (!m) break;

    const objNum = Number(m[1]);
    const gen = Number(m[2]);
    const bodyStart = m.index + m[0].length;
    let dictStr = '';
    let streamStartIdx = -1;
    let cursor = bodyStart;

    while (cursor < latin.length && /\s/.test(latin[cursor])) cursor += 1;
    if (latin.startsWith('<<', cursor)) {
      const dictInfo = readBalancedDict(latin, cursor);
      dictStr = dictInfo.dictStr;
      cursor = dictInfo.endIdx;
    }

    // Check whether a stream follows before endobj
    const nextEndObj = latin.indexOf('endobj', cursor);
    const nextStream = latin.indexOf('stream', cursor);
    let streamRaw = null;
    let rawText = '';

    if (nextStream !== -1 && (nextEndObj === -1 || nextStream < nextEndObj)) {
      // Confirm only whitespace between dict end and stream keyword
      const between = latin.slice(cursor, nextStream);
      if (/^\s*$/.test(between)) {
        let dStart = nextStream + 6;
        if (buf[dStart] === 0x0d && buf[dStart + 1] === 0x0a) dStart += 2;
        else if (buf[dStart] === 0x0a || buf[dStart] === 0x0d) dStart += 1;

        let dEnd = -1;
        const lenMatch = dictStr.match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/);
        if (lenMatch) {
          const declLen = Number(lenMatch[1]);
          const cand = dStart + declLen;
          if (cand <= buf.length) {
            const after = latin.slice(cand, Math.min(latin.length, cand + 16));
            if (/^\s*endstream/.test(after)) dEnd = cand;
          }
        }
        if (dEnd === -1) {
          dEnd = buf.indexOf('endstream', dStart);
        }
        if (dEnd !== -1 && dEnd >= dStart) {
          streamRaw = buf.subarray(dStart, dEnd);
          streamRanges.push([dStart, dEnd]);
          streamStartIdx = dEnd + 9;
          const realEndObj = latin.indexOf('endobj', streamStartIdx);
          rawText = dictStr;
          searchPos = realEndObj !== -1 ? realEndObj + 6 : streamStartIdx;
        }
      }
    }

    if (streamRaw === null) {
      const endObjPos = nextEndObj !== -1 ? nextEndObj : latin.length;
      rawText = latin.slice(bodyStart, endObjPos).trim();
      if (!dictStr && rawText.startsWith('<<')) {
        dictStr = readBalancedDict(rawText, 0).dictStr;
      }
      searchPos = endObjPos + 6;
    }

    objects.set(objNum, { objNum, gen, dictStr, rawText, streamRaw });
  }

  return { objects, latin, streamRanges };
}

function expandObjectStreams(objects, options) {
  const objStms = [];
  for (const obj of objects.values()) {
    if (/\/Type\s*\/ObjStm\b/.test(obj.dictStr) && obj.streamRaw) {
      objStms.push(obj);
    }
  }
  for (const stm of objStms) {
    const nMatch = stm.dictStr.match(/\/N\s+(\d+)/);
    const firstMatch = stm.dictStr.match(/\/First\s+(\d+)/);
    if (!nMatch || !firstMatch) continue;
    const count = Number(nMatch[1]);
    const first = Number(firstMatch[1]);
    const { decoded } = decodePdfStreamData(stm.dictStr, stm.streamRaw, options);
    if (!decoded || first > decoded.length) continue;

    const headerStr = decoded.subarray(0, first).toString('latin1');
    const tokens = headerStr.trim().split(/\s+/).map(Number).filter(Number.isFinite);
    const pairs = [];
    for (let i = 0; i + 1 < tokens.length && pairs.length < count; i += 2) {
      pairs.push({ objNum: tokens[i], offset: tokens[i + 1] });
    }

    for (let i = 0; i < pairs.length; i += 1) {
      const start = first + pairs[i].offset;
      const end = i + 1 < pairs.length ? first + pairs[i + 1].offset : decoded.length;
      if (start < 0 || start > decoded.length || end < start) continue;
      const rawText = decoded.subarray(start, Math.min(end, decoded.length)).toString('latin1').trim();
      const dictStr = rawText.startsWith('<<') ? readBalancedDict(rawText, 0).dictStr : '';
      if (!objects.has(pairs[i].objNum)) {
        objects.set(pairs[i].objNum, {
          objNum: pairs[i].objNum,
          gen: 0,
          dictStr,
          rawText,
          streamRaw: null,
        });
      }
    }
  }
}

function classifyFontStyle(baseFont = '') {
  const b = baseFont.toLowerCase();
  if (/courier|mono|consolas|menlo|inconsolata|code/.test(b)) return 'monospace';
  if (/italic|oblique/.test(b)) return 'italic';
  if (/bold|black|heavy/.test(b)) return 'bold_stamp';
  if (/times|garamond|georgia|serif|palatino|cambria/.test(b)) return 'display_serif';
  return 'sans_serif';
}

function resolveRef(val, objects) {
  const m = String(val || '').match(/^\s*(\d+)\s+\d+\s+R\s*$/);
  return m ? objects.get(Number(m[1])) || null : null;
}

function resolveDictText(textOrRef, objects) {
  if (!textOrRef) return '';
  const ref = resolveRef(textOrRef, objects);
  return ref ? (ref.dictStr || ref.rawText) : String(textOrRef);
}

function parseFontDictRefs(dictText, objects) {
  const refs = new Map();
  // Match inline or referenced /Font << /Name N G R >>
  const inlineMatch = dictText.match(/\/Font\s*<<([\s\S]*?)>>/);
  let fontBody = inlineMatch ? inlineMatch[1] : '';
  if (!fontBody) {
    const refMatch = dictText.match(/\/Font\s+(\d+)\s+\d+\s+R/);
    if (refMatch) {
      const fontMapObj = objects.get(Number(refMatch[1]));
      if (fontMapObj) {
        const inner = (fontMapObj.dictStr || fontMapObj.rawText).match(/<<([\s\S]*)>>/);
        fontBody = inner ? inner[1] : fontMapObj.rawText;
      }
    }
  }
  if (!fontBody) return refs;

  for (const m of fontBody.matchAll(/\/([A-Za-z0-9_+.-]+)\s+(\d+)\s+\d+\s+R/g)) {
    refs.set('/' + m[1], Number(m[2]));
  }
  return refs;
}

function buildFontEntry(fontObj, objects, options) {
  if (!fontObj) return null;
  const fDict = fontObj.dictStr || fontObj.rawText;
  const baseFont = fDict.match(/\/BaseFont\s*\/([^\s/<>\[\]]+)/)?.[1] || '';
  const encodingName = fDict.match(/\/Encoding\s*\/([^\s/<>\[\]]+)/)?.[1] || '';
  let cmap = null;

  const tuMatch = fDict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
  if (tuMatch) {
    const tuObj = objects.get(Number(tuMatch[1]));
    if (tuObj?.streamRaw) {
      const { decoded } = decodePdfStreamData(tuObj.dictStr, tuObj.streamRaw, options);
      if (decoded) {
        cmap = parseToUnicodeCMap(decoded.toString('latin1'));
      }
    }
  }

  return {
    fontObjNum: fontObj.objNum,
    baseFont,
    fontStyle: classifyFontStyle(baseFont),
    encodingName,
    cmap,
  };
}

function parsePdfBox(dict, keyName, objects) {
  const inlineRx = new RegExp(`\\/${keyName}\\s*\\[([^\\]]+)\\]`);
  let body = dict.match(inlineRx)?.[1] || '';
  if (!body) {
    const refRx = new RegExp(`\\/${keyName}\\s+(\\d+)\\s+\\d+\\s+R`);
    const refMatch = dict.match(refRx);
    if (refMatch) {
      const boxObj = objects.get(Number(refMatch[1]));
      body = (boxObj?.rawText || '').match(/\[([^\]]+)\]/)?.[1] || '';
    }
  }
  if (!body) return null;
  const nums = body.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  if (nums.length < 4) return null;
  return {
    x0: Math.min(nums[0], nums[2]),
    y0: Math.min(nums[1], nums[3]),
    x1: Math.max(nums[0], nums[2]),
    y1: Math.max(nums[1], nums[3]),
  };
}

const DEFAULT_PAGE_BOX = { x0: 0, y0: 0, x1: 612, y1: 792 };

function getOrderedPages(objects) {
  const catalog = Array.from(objects.values()).find((o) => /\/Type\s*\/Catalog\b/.test(o.dictStr));
  const ordered = [];
  const visited = new Set();

  const walkPagesNode = (obj, inheritedResourcesText = '', inheritedMediaBox = null, inheritedCropBox = null) => {
    if (!obj || visited.has(obj.objNum)) return;
    visited.add(obj.objNum);
    const dict = obj.dictStr || obj.rawText;

    let resText = inheritedResourcesText;
    const resRef = dict.match(/\/Resources\s+(\d+)\s+\d+\s+R/);
    if (resRef) {
      const rObj = objects.get(Number(resRef[1]));
      if (rObj) resText = rObj.dictStr || rObj.rawText;
    } else if (/\/Resources\s*<</.test(dict)) {
      const rPos = dict.indexOf('/Resources');
      resText = readBalancedDict(dict, rPos).dictStr;
    }

    const mediaBox = parsePdfBox(dict, 'MediaBox', objects) || inheritedMediaBox;
    const cropBox = parsePdfBox(dict, 'CropBox', objects) || inheritedCropBox;

    if (/\/Type\s*\/Page\b(?!s)/.test(dict)) {
      ordered.push({
        pageObj: obj,
        resourcesText: resText,
        mediaBox: mediaBox || DEFAULT_PAGE_BOX,
        cropBox: cropBox || null,
        pageBox: cropBox || mediaBox || DEFAULT_PAGE_BOX,
      });
      return;
    }

    const kidsMatch = dict.match(/\/Kids\s*\[([\s\S]*?)\]/);
    if (kidsMatch) {
      for (const km of kidsMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)) {
        walkPagesNode(objects.get(Number(km[1])), resText, mediaBox, cropBox);
      }
    }
  };

  if (catalog) {
    const rootPages = resolveRef(catalog.dictStr.match(/\/Pages\s+(\d+\s+\d+\s+R)/)?.[1], objects);
    if (rootPages) walkPagesNode(rootPages, '', null, null);
  }

  if (ordered.length === 0) {
    for (const obj of objects.values()) {
      const d = obj.dictStr || '';
      if (/\/Type\s*\/Page\b(?!s)/.test(d)) {
        let resText = '';
        if (/\/Resources\s*<</.test(d)) {
          resText = readBalancedDict(d, d.indexOf('/Resources')).dictStr;
        }
        const mediaBox = parsePdfBox(d, 'MediaBox', objects) || DEFAULT_PAGE_BOX;
        const cropBox = parsePdfBox(d, 'CropBox', objects) || null;
        ordered.push({
          pageObj: obj,
          resourcesText: resText,
          mediaBox,
          cropBox,
          pageBox: cropBox || mediaBox,
        });
      }
    }
  }
  return ordered;
}

function collectImages(objects, options) {
  const images = [];
  for (const obj of objects.values()) {
    if (!/\/Subtype\s*\/Image\b/.test(obj.dictStr) || !obj.streamRaw) continue;
    const width = Number(obj.dictStr.match(/\/Width\s+(\d+)/)?.[1] || 0);
    const height = Number(obj.dictStr.match(/\/Height\s+(\d+)/)?.[1] || 0);
    const bitsPerComponent = Number(obj.dictStr.match(/\/BitsPerComponent\s+(\d+)/)?.[1] || 8);
    const colorSpace = obj.dictStr.match(/\/ColorSpace\s*\/([A-Za-z0-9_]+)/)?.[1] || 'DeviceRGB';
    const filters = extractFilterNames(obj.dictStr);
    const dec = decodePdfStreamData(obj.dictStr, obj.streamRaw, options);
    images.push({
      objNum: obj.objNum,
      width,
      height,
      bitsPerComponent,
      colorSpace,
      filters,
      decodedBytes: dec.decoded,
      rawBytes: obj.streamRaw,
    });
  }
  return images;
}

function matMul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

// Transform user-space point (x, y) through matrix m (PDF [a b c d e f] convention)
function transformPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function decodeLiteralBytes(rawInner) {
  const out = [];
  for (let i = 0; i < rawInner.length; i += 1) {
    const b = rawInner[i];
    if (b === 0x5c) { // '\'
      i += 1;
      if (i >= rawInner.length) break;
      const esc = rawInner[i];
      if (esc === 0x6e) out.push(0x0a);
      else if (esc === 0x72) out.push(0x0d);
      else if (esc === 0x74) out.push(0x09);
      else if (esc === 0x62) out.push(0x08);
      else if (esc === 0x66) out.push(0x0c);
      else if (esc === 0x0d) {
        if (rawInner[i + 1] === 0x0a) i += 1;
      } else if (esc === 0x0a) {
        // line continuation
      } else if (esc >= 0x30 && esc <= 0x37) {
        let oct = esc - 0x30;
        for (let k = 0; k < 2 && i + 1 < rawInner.length; k += 1) {
          const nb = rawInner[i + 1];
          if (nb >= 0x30 && nb <= 0x37) {
            oct = (oct << 3) | (nb - 0x30);
            i += 1;
          } else break;
        }
        out.push(oct & 0xff);
      } else {
        out.push(esc);
      }
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out);
}

function decodeTextToken(tok, fontEntry) {
  if (!tok) return '';
  if (tok.kind === 'hex') {
    const hex = tok.value;
    if (fontEntry?.cmap) {
      const mapped = fontEntry.cmap.decodeHex(hex);
      if (mapped !== null) return mapped;
    }
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length >= 4 && clean.toUpperCase().startsWith('FEFF')) {
      return hexToUnicodeString(clean.slice(4));
    }
    const even = clean.length % 2 === 1 ? clean + '0' : clean;
    const raw = Buffer.from(even, 'hex');
    if (fontEntry?.encodingName?.includes('Identity') && raw.length % 2 === 0) {
      return hexToUnicodeString(even);
    }
    return Array.from(raw, (b) => winAnsiByteToChar(b)).join('');
  }
  if (tok.kind === 'str') {
    const raw = tok.bytes;
    if (fontEntry?.cmap) {
      const hex = raw.toString('hex').toUpperCase();
      const mapped = fontEntry.cmap.decodeHex(hex);
      if (mapped !== null) return mapped;
    }
    if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
      return hexToUnicodeString(raw.subarray(2).toString('hex'));
    }
    return Array.from(raw, (b) => winAnsiByteToChar(b)).join('');
  }
  return '';
}

function tokenizeContentStream(buf) {
  const tokens = [];
  const len = buf.length;
  let i = 0;

  while (i < len) {
    const b = buf[i];
    if (b <= 32) { i += 1; continue; }
    if (b === 0x25) { // '%' comment
      while (i < len && buf[i] !== 0x0a && buf[i] !== 0x0d) i += 1;
      continue;
    }
    if (b === 0x28) { // '(' literal string
      i += 1;
      const start = i;
      let depth = 1;
      while (i < len && depth > 0) {
        if (buf[i] === 0x5c) { i += 2; continue; }
        if (buf[i] === 0x28) depth += 1;
        else if (buf[i] === 0x29) depth -= 1;
        i += 1;
      }
      const end = depth === 0 ? i - 1 : i;
      tokens.push({ kind: 'str', bytes: decodeLiteralBytes(buf.subarray(start, end)) });
      continue;
    }
    if (b === 0x3c) {
      if (buf[i + 1] === 0x3c) { // '<<'
        i += 2;
        tokens.push({ kind: 'dict_open' });
        continue;
      }
      i += 1;
      const start = i;
      while (i < len && buf[i] !== 0x3e) i += 1;
      const hex = buf.subarray(start, i).toString('ascii');
      if (i < len && buf[i] === 0x3e) i += 1;
      tokens.push({ kind: 'hex', value: hex });
      continue;
    }
    if (b === 0x3e && buf[i + 1] === 0x3e) {
      i += 2;
      tokens.push({ kind: 'dict_close' });
      continue;
    }
    if (b === 0x5b) { // '[' array
      i += 1;
      const items = [];
      while (i < len) {
        while (i < len && buf[i] <= 32) i += 1;
        if (i >= len || buf[i] === 0x5d) { i += 1; break; }
        const c = buf[i];
        if (c === 0x28) {
          i += 1;
          const s = i;
          let depth = 1;
          while (i < len && depth > 0) {
            if (buf[i] === 0x5c) { i += 2; continue; }
            if (buf[i] === 0x28) depth += 1;
            else if (buf[i] === 0x29) depth -= 1;
            i += 1;
          }
          const e = depth === 0 ? i - 1 : i;
          items.push({ kind: 'str', bytes: decodeLiteralBytes(buf.subarray(s, e)) });
        } else if (c === 0x3c) {
          i += 1;
          const s = i;
          while (i < len && buf[i] !== 0x3e) i += 1;
          items.push({ kind: 'hex', value: buf.subarray(s, i).toString('ascii') });
          if (i < len && buf[i] === 0x3e) i += 1;
        } else {
          const s = i;
          while (i < len && buf[i] > 32 && buf[i] !== 0x5d && buf[i] !== 0x28 && buf[i] !== 0x3c) i += 1;
          const num = Number(buf.subarray(s, i).toString('ascii'));
          if (Number.isFinite(num)) items.push({ kind: 'num', value: num });
        }
      }
      tokens.push({ kind: 'arr', items });
      continue;
    }
    if (b === 0x2f) { // '/Name'
      const s = i;
      i += 1;
      while (i < len && buf[i] > 32 && !/[()<>[\]{}\/%]/.test(String.fromCharCode(buf[i]))) i += 1;
      tokens.push({ kind: 'name', value: buf.subarray(s, i).toString('latin1') });
      continue;
    }

    const s = i;
    while (i < len && buf[i] > 32 && !/[()<>[\]{}\/%]/.test(String.fromCharCode(buf[i]))) i += 1;
    if (i === s) { i += 1; continue; }
    const word = buf.subarray(s, i).toString('latin1');
    const num = Number(word);
    if (Number.isFinite(num) && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
      tokens.push({ kind: 'num', value: num });
    } else {
      tokens.push({ kind: 'op', value: word });
    }
  }

  return tokens;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function cmykToRgb(c, m, y, k) {
  const cc = clamp01(c);
  const mm = clamp01(m);
  const yy = clamp01(y);
  const kk = clamp01(k);
  return {
    space: 'DeviceCMYK',
    r: Number(((1 - cc) * (1 - kk)).toFixed(4)),
    g: Number(((1 - mm) * (1 - kk)).toFixed(4)),
    b: Number(((1 - yy) * (1 - kk)).toFixed(4)),
  };
}

function colorLuminance(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function isNearWhiteColor(c) {
  return c.r >= 0.95 && c.g >= 0.95 && c.b >= 0.95;
}

function colorDistance(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function computeRectOverlap(a, b) {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  if (ix2 <= ix1 || iy2 <= iy1) {
    return { iw: 0, ih: 0, area: 0, ratioA: 0 };
  }
  const iw = ix2 - ix1;
  const ih = iy2 - iy1;
  const area = iw * ih;
  const areaA = Math.max(1e-6, a.w * a.h);
  return { iw, ih, area, ratioA: area / areaA };
}

function interpretContentStream(streamBuf, fontTable, pageIndex) {
  const tokens = tokenizeContentStream(streamBuf);
  const stack = [];
  const stateStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let leading = 12;
  let fontKey = '';
  let fontSize = 11;
  let fillColor = { space: 'DeviceGray', r: 0, g: 0, b: 0 };
  let strokeColor = { space: 'DeviceGray', r: 0, g: 0, b: 0 };
  let textRenderMode = 0;
  let inText = false;
  let seq = 0;
  let drawOrder = 0;
  const runs = [];
  const vectorPaths = [];
  const filledRects = [];
  let pathSegs = [];
  let pathRects = [];
  let curPt = null;

  const getActiveFont = () => fontTable.get(fontKey) || null;
  const emitRun = (text) => {
    if (!text) return;
    const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').replace(/\r/g, '');
    if (!cleaned.trim()) return;
    const abs = matMul(tm, ctm);
    const activeFont = getActiveFont();
    const scaleX = Math.hypot(abs[0], abs[1]) || 1;
    const scaleY = Math.hypot(abs[2], abs[3]) || scaleX;
    const rawFontSizePt = Math.abs(fontSize * scaleY);
    const px = Math.round(Math.max(6, Math.abs(fontSize * scaleX))) || 11;
    const effSize = Math.max(rawFontSizePt, 0.5);
    const estWidth = Math.max(effSize * 0.4, cleaned.length * effSize * 0.52);
    const bbox = {
      x: Number(abs[4].toFixed(2)),
      y: Number((abs[5] - Math.max(rawFontSizePt, 1) * 0.2).toFixed(2)),
      w: Number(estWidth.toFixed(2)),
      h: Number((Math.max(rawFontSizePt, 1) * 1.05).toFixed(2)),
    };
    runs.push({
      pageIndex,
      x: abs[4],
      y: abs[5],
      seq: seq++,
      drawOrder: drawOrder++,
      text: cleaned,
      fontSizePx: px,
      rawFontSizePt,
      fontStyle: activeFont?.fontStyle || 'sans_serif',
      fillColor: { ...fillColor },
      textRenderMode,
      bbox,
      hiddenChannelFlags: [],
    });
    // Advance horizontal estimate slightly for chained sequential Tj without Td
    tm = matMul([1, 0, 0, 1, cleaned.length * (fontSize * 0.45), 0], tm);
  };

  for (const tok of tokens) {
    if (tok.kind !== 'op') {
      stack.push(tok);
      continue;
    }
    const op = tok.value;
    if (op === 'q') {
      stateStack.push({
        ctm: [...ctm],
        fontKey,
        fontSize,
        leading,
        fillColor: { ...fillColor },
        strokeColor: { ...strokeColor },
        textRenderMode,
      });
      stack.length = 0;
    } else if (op === 'Q') {
      const prev = stateStack.pop();
      if (prev) {
        ctm = prev.ctm;
        fontKey = prev.fontKey;
        fontSize = prev.fontSize;
        leading = prev.leading;
        fillColor = prev.fillColor;
        strokeColor = prev.strokeColor;
        textRenderMode = prev.textRenderMode;
      }
      stack.length = 0;
    } else if (op === 'cm') {
      if (stack.length >= 6) {
        const vals = stack.slice(-6).map((x) => Number(x.value) || 0);
        ctm = matMul(vals, ctm);
      }
      stack.length = 0;
    } else if (op === 'g') {
      if (stack.length >= 1) {
        const v = clamp01(Number(stack[stack.length - 1].value));
        fillColor = { space: 'DeviceGray', r: v, g: v, b: v };
      }
      stack.length = 0;
    } else if (op === 'G') {
      if (stack.length >= 1) {
        const v = clamp01(Number(stack[stack.length - 1].value));
        strokeColor = { space: 'DeviceGray', r: v, g: v, b: v };
      }
      stack.length = 0;
    } else if (op === 'rg') {
      if (stack.length >= 3) {
        const [r, g, b] = stack.slice(-3).map((x) => clamp01(Number(x.value)));
        fillColor = { space: 'DeviceRGB', r, g, b };
      }
      stack.length = 0;
    } else if (op === 'RG') {
      if (stack.length >= 3) {
        const [r, g, b] = stack.slice(-3).map((x) => clamp01(Number(x.value)));
        strokeColor = { space: 'DeviceRGB', r, g, b };
      }
      stack.length = 0;
    } else if (op === 'k') {
      if (stack.length >= 4) {
        const [c, m, y, k] = stack.slice(-4).map((x) => Number(x.value));
        fillColor = cmykToRgb(c, m, y, k);
      }
      stack.length = 0;
    } else if (op === 'K') {
      if (stack.length >= 4) {
        const [c, m, y, k] = stack.slice(-4).map((x) => Number(x.value));
        strokeColor = cmykToRgb(c, m, y, k);
      }
      stack.length = 0;
    } else if (op === 'sc' || op === 'scn' || op === 'SC' || op === 'SCN') {
      const nums = stack.filter((t) => t.kind === 'num').map((t) => t.value);
      let parsedColor = null;
      if (nums.length === 1) {
        const v = clamp01(nums[0]);
        parsedColor = { space: 'DeviceGray', r: v, g: v, b: v };
      } else if (nums.length === 3) {
        parsedColor = { space: 'DeviceRGB', r: clamp01(nums[0]), g: clamp01(nums[1]), b: clamp01(nums[2]) };
      } else if (nums.length >= 4) {
        parsedColor = cmykToRgb(nums[0], nums[1], nums[2], nums[3]);
      }
      if (parsedColor) {
        if (op === 'sc' || op === 'scn') fillColor = parsedColor;
        else strokeColor = parsedColor;
      }
      stack.length = 0;
    } else if (op === 'Tr') {
      if (stack.length >= 1) {
        const mode = Number(stack[stack.length - 1].value);
        if (Number.isFinite(mode)) textRenderMode = Math.trunc(mode);
      }
      stack.length = 0;
    } else if (op === 'BT') {
      inText = true;
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
      stack.length = 0;
    } else if (op === 'ET') {
      inText = false;
      stack.length = 0;
    } else if (op === 'Tf') {
      if (stack.length >= 2) {
        fontKey = String(stack[stack.length - 2].value || '');
        const parsedSize = Number(stack[stack.length - 1].value);
        fontSize = Number.isFinite(parsedSize) ? parsedSize : 11;
      }
      stack.length = 0;
    } else if (op === 'TL') {
      if (stack.length >= 1) leading = Number(stack[stack.length - 1].value) || leading;
      stack.length = 0;
    } else if (op === 'Tm') {
      if (stack.length >= 6) {
        const vals = stack.slice(-6).map((x) => Number(x.value) || 0);
        tm = vals;
        tlm = [...vals];
      }
      stack.length = 0;
    } else if (op === 'Td' || op === 'TD') {
      if (stack.length >= 2) {
        const tx = Number(stack[stack.length - 2].value) || 0;
        const ty = Number(stack[stack.length - 1].value) || 0;
        if (op === 'TD') leading = -ty;
        tlm = matMul([1, 0, 0, 1, tx, ty], tlm);
        tm = [...tlm];
      }
      stack.length = 0;
    } else if (op === 'T*') {
      tlm = matMul([1, 0, 0, 1, 0, -leading], tlm);
      tm = [...tlm];
      stack.length = 0;
    } else if (op === 'Tj' || op === "'") {
      if (op === "'") {
        tlm = matMul([1, 0, 0, 1, 0, -leading], tlm);
        tm = [...tlm];
      }
      const strTok = stack[stack.length - 1];
      if (inText || strTok) emitRun(decodeTextToken(strTok, getActiveFont()));
      stack.length = 0;
    } else if (op === '"') {
      tlm = matMul([1, 0, 0, 1, 0, -leading], tlm);
      tm = [...tlm];
      const strTok = stack[stack.length - 1];
      emitRun(decodeTextToken(strTok, getActiveFont()));
      stack.length = 0;
    } else if (op === 'TJ') {
      const arrTok = stack[stack.length - 1];
      if (arrTok?.kind === 'arr') {
        const activeFont = getActiveFont();
        let assembled = '';
        for (const item of arrTok.items) {
          if (item.kind === 'num') {
            if (item.value <= -120 && assembled && !assembled.endsWith(' ')) {
              assembled += ' ';
            }
          } else {
            assembled += decodeTextToken(item, activeFont);
          }
        }
        emitRun(assembled);
      }
      stack.length = 0;
    } else if (op === 'm' || op === 'l') {
      if (stack.length >= 2) {
        const [px, py] = transformPoint(ctm, Number(stack[stack.length - 2].value) || 0, Number(stack[stack.length - 1].value) || 0);
        if (op === 'l' && curPt) pathSegs.push({ x1: curPt[0], y1: curPt[1], x2: px, y2: py });
        curPt = [px, py];
      }
      stack.length = 0;
    } else if (op === 're') {
      if (stack.length >= 4) {
        const [x, y, w, h] = stack.slice(-4).map((t) => Number(t.value) || 0);
        const [px1, py1] = transformPoint(ctm, x, y);
        const [px2, py2] = transformPoint(ctm, x + w, y + h);
        pathRects.push({ x: Math.min(px1, px2), y: Math.min(py1, py2), w: Math.abs(px2 - px1), h: Math.abs(py2 - py1) });
      }
      stack.length = 0;
    } else if (
      op === 'S' || op === 's' || op === 'f' || op === 'F' || op === 'f*' ||
      op === 'B' || op === 'B*' || op === 'b' || op === 'b*' || op === 'n'
    ) {
      const isFillOp = op === 'f' || op === 'F' || op === 'f*' || op === 'B' || op === 'B*' || op === 'b' || op === 'b*';
      if (op !== 'n' && (pathSegs.length > 0 || pathRects.length > 0)) {
        vectorPaths.push({ pageIndex, op: op[0], segments: pathSegs, rects: pathRects });
        if (isFillOp) {
          const rectsToRecord = [...pathRects];
          if (rectsToRecord.length === 0 && pathSegs.length >= 3) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const s of pathSegs) {
              minX = Math.min(minX, s.x1, s.x2);
              minY = Math.min(minY, s.y1, s.y2);
              maxX = Math.max(maxX, s.x1, s.x2);
              maxY = Math.max(maxY, s.y1, s.y2);
            }
            if (maxX - minX >= 4 && maxY - minY >= 4) {
              rectsToRecord.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
            }
          }
          for (const r of rectsToRecord) {
            if (r.w >= 4 && r.h >= 4) {
              filledRects.push({
                pageIndex,
                x: Number(r.x.toFixed(2)),
                y: Number(r.y.toFixed(2)),
                w: Number(r.w.toFixed(2)),
                h: Number(r.h.toFixed(2)),
                fillColor: { ...fillColor },
                op,
                drawOrder: drawOrder++,
              });
            }
          }
        }
      }
      pathSegs = [];
      pathRects = [];
      curPt = null;
      stack.length = 0;
    } else {
      stack.length = 0;
    }
  }

  return { runs, vectorPaths, filledRects };
}

function analyzePageForensics(runs, filledRects, pageBox, pageIndex, options = {}) {
  const findings = [];
  const box = pageBox || DEFAULT_PAGE_BOX;
  const pageW = Math.max(1, box.x1 - box.x0);
  const pageH = Math.max(1, box.y1 - box.y0);
  const sublegibleThreshold = options.sublegibleFontPt ?? 1.5;

  for (const run of runs) {
    const snippet = run.text.slice(0, 160);
    let flaggedOverlay = false;

    // 1. Failed-redaction detection: text covered by opaque filled vector rectangle
    let bestOverlay = null;
    for (const rect of filledRects) {
      if (rect.w < 4 || rect.h < 4) continue;
      const ov = computeRectOverlap(run.bbox, rect);
      if (ov.iw < 3 || ov.ih < Math.max(1, run.bbox.h * 0.30) || ov.ratioA < 0.08) continue;
      const isFullPageBg = rect.w >= pageW * 0.85 && rect.h >= pageH * 0.85;
      const drawnOverText = rect.drawOrder > run.drawOrder;
      const darkOccludingBg =
        !isFullPageBg &&
        rect.drawOrder < run.drawOrder &&
        colorLuminance(rect.fillColor) <= 0.25 &&
        colorDistance(rect.fillColor, run.fillColor) <= 0.25;

      if (drawnOverText || darkOccludingBg) {
        if (!bestOverlay || ov.ratioA > bestOverlay.overlapRatio) {
          bestOverlay = { rect, overlapRatio: ov.ratioA };
        }
      }
    }
    if (bestOverlay) {
      flaggedOverlay = true;
      run.hiddenChannelFlags.push('PDF_TEXT_UNDER_OPAQUE_OVERLAY');
      findings.push({
        code: 'PDF_TEXT_UNDER_OPAQUE_OVERLAY',
        vector: 'pdf_text_under_opaque_overlay',
        severity: 'high',
        page: pageIndex + 1,
        pageIndex,
        textSnippet: snippet,
        coveredTextLength: run.text.length,
        bbox: { ...run.bbox },
        overlayBbox: {
          x: bestOverlay.rect.x,
          y: bestOverlay.rect.y,
          w: bestOverlay.rect.w,
          h: bestOverlay.rect.h,
        },
        overlapRatio: Number(bestOverlay.overlapRatio.toFixed(3)),
        fillColor: { ...bestOverlay.rect.fillColor },
      });
    }

    // 2. Invisible text rendering mode 3 (`3 Tr`)
    if (run.textRenderMode === 3) {
      run.hiddenChannelFlags.push('PDF_INVISIBLE_RENDER_MODE_3');
      findings.push({
        code: 'PDF_INVISIBLE_RENDER_MODE_3',
        vector: 'pdf_invisible_render_mode_3',
        severity: 'high',
        page: pageIndex + 1,
        pageIndex,
        renderMode: 3,
        textSnippet: snippet,
        textLength: run.text.length,
        bbox: { ...run.bbox },
      });
    }

    // 3. White-on-white / matching-background text
    if (run.textRenderMode !== 3) {
      let bgColor = { space: 'DeviceRGB', r: 1, g: 1, b: 1 };
      let hasBgRect = false;
      for (const rect of filledRects) {
        if (rect.drawOrder >= run.drawOrder) continue;
        const ov = computeRectOverlap(run.bbox, rect);
        if (ov.ratioA >= 0.5) {
          bgColor = rect.fillColor;
          hasBgRect = true;
        }
      }
      const whiteOnWhite = isNearWhiteColor(bgColor) && isNearWhiteColor(run.fillColor);
      const matchingBg = hasBgRect && !flaggedOverlay && colorDistance(run.fillColor, bgColor) <= 0.06;
      if (whiteOnWhite || matchingBg) {
        run.hiddenChannelFlags.push('INVISIBLE_WHITE_ON_WHITE_TEXT');
        findings.push({
          code: 'INVISIBLE_WHITE_ON_WHITE_TEXT',
          vector: 'pdf_white_on_white_text',
          severity: 'high',
          page: pageIndex + 1,
          pageIndex,
          textColor: { ...run.fillColor },
          backgroundColor: { ...bgColor },
          textSnippet: snippet,
          textLength: run.text.length,
          bbox: { ...run.bbox },
        });
      }
    }

    // 4. Sub-legible tiny font (<= 1.5 pt default)
    if (run.rawFontSizePt <= sublegibleThreshold) {
      run.hiddenChannelFlags.push('INVISIBLE_SUBLEGIBLE_FONT');
      findings.push({
        code: 'INVISIBLE_SUBLEGIBLE_FONT',
        vector: 'pdf_sublegible_font',
        severity: 'high',
        page: pageIndex + 1,
        pageIndex,
        fontSizePt: Number(run.rawFontSizePt.toFixed(3)),
        textSnippet: snippet,
        textLength: run.text.length,
        bbox: { ...run.bbox },
      });
    }

    // 5. Off-page coordinate text outside MediaBox/CropBox
    const tol = 2;
    const completelyOutside =
      run.bbox.x + run.bbox.w < box.x0 - tol ||
      run.bbox.x > box.x1 + tol ||
      run.bbox.y + run.bbox.h < box.y0 - tol ||
      run.bbox.y > box.y1 + tol;
    const originOutside =
      run.x < box.x0 - tol ||
      run.x > box.x1 + tol ||
      run.y < box.y0 - tol ||
      run.y > box.y1 + tol;
    if (completelyOutside || originOutside) {
      run.hiddenChannelFlags.push('PDF_OFF_PAGE_TEXT');
      findings.push({
        code: 'PDF_OFF_PAGE_TEXT',
        vector: 'pdf_off_page_text',
        severity: 'high',
        page: pageIndex + 1,
        pageIndex,
        textSnippet: snippet,
        textLength: run.text.length,
        bbox: { ...run.bbox },
        pageBox: { ...box },
      });
    }
  }

  return findings;
}

function reconstructRunsIntoLines(runs) {
  if (runs.length === 0) return [];
  // Sort by page ascending, Y descending, X ascending, then stream sequence
  const sorted = [...runs].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    const tol = Math.max(2.0, Math.min(a.fontSizePx, b.fontSizePx) * 0.35);
    if (Math.abs(a.y - b.y) > tol) return b.y - a.y;
    if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
    return a.seq - b.seq;
  });

  const bands = [];
  for (const run of sorted) {
    const prevBand = bands[bands.length - 1];
    const tol = Math.max(2.0, run.fontSizePx * 0.35);
    if (prevBand && prevBand.pageIndex === run.pageIndex && Math.abs(prevBand.y - run.y) <= tol) {
      prevBand.runs.push(run);
    } else {
      bands.push({ pageIndex: run.pageIndex, y: run.y, runs: [run] });
    }
  }

  const lineRecords = [];
  for (const band of bands) {
    band.runs.sort((a, b) => (Math.abs(a.x - b.x) > 0.5 ? a.x - b.x : a.seq - b.seq));
    let combined = '';
    for (let i = 0; i < band.runs.length; i += 1) {
      const r = band.runs[i];
      if (i > 0) {
        const prev = band.runs[i - 1];
        const gap = r.x - prev.x;
        const spaceNeed = gap > Math.max(2.0, r.fontSizePx * 0.25)
          && !combined.endsWith(' ')
          && !r.text.startsWith(' ');
        if (spaceNeed) combined += ' ';
      }
      combined += r.text;
    }

    for (const sub of combined.split(/\n/)) {
      const normalized = sub.replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      lineRecords.push({
        lineIndex: lineRecords.length,
        pageIndex: band.pageIndex,
        text: normalized,
        fontStyle: band.runs[0].fontStyle || 'sans_serif',
        fontSizePx: band.runs[0].fontSizePx || 11,
        sourceFormat: 'pdf_born_digital',
      });
    }
  }
  return lineRecords;
}

/**
 * Derives ruling-line tables from stroked/filled vector paths (m/l/re/S/f) plus
 * positioned text runs: overlapping stacked horizontal rules form row bands and
 * vertical rules split columns, so born-digital PDF tables become cell arrays.
 */
function deriveVectorTables(vectorPaths, runs) {
  if (vectorPaths.length === 0) return [];
  const hRules = [];
  const vRules = [];
  for (const p of vectorPaths) {
    for (const s of p.segments) {
      if (Math.abs(s.y1 - s.y2) <= 2 && Math.abs(s.x2 - s.x1) >= 8) {
        hRules.push({ pageIndex: p.pageIndex, y: (s.y1 + s.y2) / 2, x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2) });
      } else if (Math.abs(s.x1 - s.x2) <= 2 && Math.abs(s.y2 - s.y1) >= 8) {
        vRules.push({ pageIndex: p.pageIndex, x: (s.x1 + s.x2) / 2, y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) });
      }
    }
    for (const r of p.rects) {
      if (r.h <= 2.5 && r.w >= 8) {
        hRules.push({ pageIndex: p.pageIndex, y: r.y + r.h / 2, x1: r.x, x2: r.x + r.w });
      } else if (r.w <= 2.5 && r.h >= 8) {
        vRules.push({ pageIndex: p.pageIndex, x: r.x + r.w / 2, y1: r.y, y2: r.y + r.h });
      }
    }
  }

  const runsByPage = new Map();
  for (const r of runs) {
    let list = runsByPage.get(r.pageIndex);
    if (!list) {
      list = [];
      runsByPage.set(r.pageIndex, list);
    }
    list.push(r);
  }

  const tables = [];
  const hByPage = new Map();
  const vByPage = new Map();
  for (const r of hRules) {
    let list = hByPage.get(r.pageIndex);
    if (!list) hByPage.set(r.pageIndex, (list = []));
    list.push(r);
  }
  for (const r of vRules) {
    let list = vByPage.get(r.pageIndex);
    if (!list) vByPage.set(r.pageIndex, (list = []));
    list.push(r);
  }

  for (const [pageIndex, rules] of hByPage) {
    rules.sort((a, b) => b.y - a.y);
    // Cluster consecutive stacked rules that overlap horizontally (shared x-span)
    const clusters = [];
    for (const r of rules) {
      const c = clusters[clusters.length - 1];
      if (c && r.y < c.rules[c.rules.length - 1].y) {
        const overlap = Math.min(c.x2, r.x2) - Math.max(c.x1, r.x1);
        if (c.rules[c.rules.length - 1].y - r.y <= 200 && overlap >= 0.5 * Math.min(c.x2 - c.x1, r.x2 - r.x1)) {
          c.x1 = Math.max(c.x1, r.x1);
          c.x2 = Math.min(c.x2, r.x2);
          c.rules.push(r);
          continue;
        }
      }
      clusters.push({ x1: r.x1, x2: r.x2, rules: [r] });
    }

    for (const c of clusters) {
      if (c.rules.length < 3) continue; // < 2 row bands is not a table
      const pageRunList = runsByPage.get(pageIndex) || [];
      const dividers = vByPage
        .get(pageIndex)
        ?.filter((v) => v.x > c.x1 + 1 && v.x < c.x2 - 1)
        .map((v) => v.x)
        .sort((a, b) => a - b) || [];
      const colCount = dividers.length + 1;
      const colRuns = Array.from({ length: colCount }, () => []);
      const rows = [];
      for (let i = 0; i < c.rules.length - 1; i += 1) {
        const top = c.rules[i].y;
        const bottom = c.rules[i + 1].y;
        const bandRuns = pageRunList.filter(
          (r) => r.x >= c.x1 && r.x <= c.x2 && r.y >= bottom - 2 && r.y <= top + 2
        );
        if (bandRuns.length === 0) continue;
        const cells = Array.from({ length: colCount }, () => []);
        for (const r of bandRuns) {
          let col = 0;
          for (const d of dividers) {
            if (r.x >= d) col += 1;
          }
          if (col >= colCount) col = colCount - 1;
          cells[col].push(r);
        }
        const row = cells.map((cellRuns) =>
          cellRuns
            .sort((a, b) => a.x - b.x)
            .map((r) => r.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        );
        if (row.some((cell) => cell)) rows.push(row);
      }
      if (rows.length > 0) {
        tables.push({
          pageIndex,
          xMin: c.x1,
          xMax: c.x2,
          top: c.rules[0].y,
          bottom: c.rules[c.rules.length - 1].y,
          columnCount: colCount,
          rows,
        });
      }
    }
  }
  return tables;
}

function findEofRevisionOffsets(latin, streamRanges) {
  const eofEnds = [];
  const rx = /%%EOF\b/g;
  let m;
  while ((m = rx.exec(latin)) !== null) {
    const idx = m.index;
    const insideStream = streamRanges.some(([s, e]) => idx >= s && idx < e);
    if (!insideStream) {
      eofEnds.push(idx + m[0].length);
    }
  }
  return eofEnds;
}

function extractPdfMetadataStrings(objects, options = {}) {
  const strings = [];
  const infoKeys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'Contents'];
  for (const obj of objects.values()) {
    const dict = obj.dictStr || obj.rawText || '';
    for (const key of infoKeys) {
      const litRx = new RegExp(`\\/${key}\\s*\\(([^)]*)\\)`, 'g');
      let m;
      while ((m = litRx.exec(dict)) !== null) {
        const decoded = decodeLiteralBytes(Buffer.from(m[1], 'latin1')).toString('latin1').trim();
        if (decoded) strings.push(decoded);
      }
      const hexRx = new RegExp(`\\/${key}\\s*<([0-9a-fA-F\\s]+)>`, 'g');
      while ((m = hexRx.exec(dict)) !== null) {
        const val = decodeTextToken({ kind: 'hex', value: m[1] }, null).trim();
        if (val) strings.push(val);
      }
    }
    if (obj.streamRaw && /\/Subtype\s*\/XML\b|\/Type\s*\/Metadata\b/.test(obj.dictStr)) {
      try {
        const dec = decodePdfStreamData(obj.dictStr, obj.streamRaw, options);
        if (dec.decoded) {
          const xmlStr = dec.decoded.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (xmlStr) strings.push(xmlStr);
        }
      } catch {}
    }
  }
  return strings;
}

function normalizeForComparison(str, { caseSensitive = false, normalizeWhitespace = true } = {}) {
  let out = String(str ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  if (normalizeWhitespace) {
    out = out.replace(/\s+/g, ' ').trim();
  }
  if (!caseSensitive) {
    out = out.toLowerCase();
  }
  return out;
}

function inspectPdfIncrementalRevisions(buf, latin, streamRanges, latestLines, latestMetaStrings, options = {}) {
  const eofEnds = findEofRevisionOffsets(latin, streamRanges);
  const revisionCount = Math.max(1, eofEnds.length);
  if (eofEnds.length < 2) {
    return { revisionCount, findings: [], historicalResidualTexts: [] };
  }

  const latestCorpusNorm = normalizeForComparison([...latestLines, ...latestMetaStrings].join('\n'));
  const maxRevisionsToInspect = Math.min(eofEnds.length - 1, options.maxRevisions ?? 16);
  const leakedRevisionIndices = [];
  const residualSet = new Set();
  const residualStrings = [];

  for (let i = 0; i < maxRevisionsToInspect; i += 1) {
    const revSlice = buf.subarray(0, eofEnds[i]);
    let revDiag;
    try {
      revDiag = extractPdfDetailed(revSlice, { ...options, _skipRevisionInspection: true });
    } catch {
      continue;
    }
    const revCandidates = [...(revDiag.lines || []), ...(revDiag.metadataStrings || [])];
    let revHasLeak = false;
    for (const candidate of revCandidates) {
      const trimmed = String(candidate || '').trim();
      if (!trimmed) continue;
      const norm = normalizeForComparison(trimmed);
      if (!norm) continue;
      if (!latestCorpusNorm.includes(norm)) {
        revHasLeak = true;
        if (!residualSet.has(trimmed)) {
          residualSet.add(trimmed);
          residualStrings.push(trimmed);
        }
      }
    }
    if (revHasLeak) {
      leakedRevisionIndices.push(i + 1);
    }
  }

  const findings = [];
  if (residualStrings.length > 0) {
    findings.push({
      code: 'PDF_INCREMENTAL_REVISION_LEAK',
      vector: 'pdf_incremental_revision_leak',
      severity: 'high',
      revisionCount,
      leakedRevisionIndices,
      residualCount: residualStrings.length,
      residualStrings: residualStrings.slice(0, 50),
      residualSnippets: residualStrings.slice(0, 20).map((s) => s.slice(0, 160)),
    });
  }

  return {
    revisionCount,
    findings,
    historicalResidualTexts: residualStrings,
  };
}

export function extractPdfDetailed(pdfBuffer, options = {}) {
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  const { objects, latin, streamRanges } = parseTopLevelPdfObjects(buf);
  const encrypted = /\/Encrypt\b/.test(latin);
  expandObjectStreams(objects, options);

  const pages = getOrderedPages(objects);
  let streamCount = 0;
  let imageXObjectCount = 0;
  for (const obj of objects.values()) {
    if (obj.streamRaw) {
      streamCount += 1;
      if (/\/Subtype\s*\/Image\b/.test(obj.dictStr)) {
        imageXObjectCount += 1;
      }
    }
  }

  if (encrypted) {
    return {
      pageCount: pages.length,
      streamCount,
      imageXObjectCount,
      isLikelyScanned: false,
      encrypted: true,
      diagnosticReason: 'ENCRYPTED_PDF_UNSUPPORTED',
      lines: [],
      lineRecords: [],
      streams: [],
      images: [],
      vectorTables: [],
      forensicFindings: [],
      revisionCount: Math.max(1, findEofRevisionOffsets(latin, streamRanges).length),
      historicalResidualTexts: [],
      metadataStrings: [],
    };
  }

  // Build global fallback font map (by fontObjNum -> entry) plus per-page scoped font maps
  const fontObjCache = new Map();
  const getFontByObjNum = (objNum) => {
    if (!fontObjCache.has(objNum)) {
      fontObjCache.set(objNum, buildFontEntry(objects.get(objNum), objects, options));
    }
    return fontObjCache.get(objNum);
  };

  const pageStreams = [];
  const allRuns = [];
  const vectorPathsAcc = [];
  const forensicFindings = [];
  const pageBoxes = [];
  let pageCount = pages.length;

  pages.forEach(({ pageObj, resourcesText, pageBox }, pageIndex) => {
    pageBoxes.push(pageBox || DEFAULT_PAGE_BOX);
    const pageDict = pageObj.dictStr || pageObj.rawText;
    const fontRefs = parseFontDictRefs(resolveDictText(resourcesText, objects) || pageDict, objects);
    const fontTable = new Map();
    for (const [key, objNum] of fontRefs.entries()) {
      const entry = getFontByObjNum(objNum);
      if (entry) fontTable.set(key, entry);
    }

    const contentIds = [];
    const arrM = pageDict.match(/\/Contents\s*\[([\s\S]*?)\]/);
    if (arrM) {
      for (const m of arrM[1].matchAll(/(\d+)\s+\d+\s+R/g)) contentIds.push(Number(m[1]));
    } else {
      const singleM = pageDict.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
      if (singleM) {
        const contentObj = objects.get(Number(singleM[1]));
        const indirectArray = contentObj && !contentObj.streamRaw
          ? (contentObj.rawText || '').match(/\[([\s\S]*?)\]/)?.[1]
          : null;
        if (indirectArray !== null && indirectArray !== undefined) {
          for (const m of indirectArray.matchAll(/(\d+)\s+\d+\s+R/g)) contentIds.push(Number(m[1]));
        } else {
          contentIds.push(Number(singleM[1]));
        }
      }
    }

    const decodedParts = [];
    for (const cid of contentIds) {
      const cObj = objects.get(cid);
      if (!cObj?.streamRaw) continue;
      const dec = decodePdfStreamData(cObj.dictStr, cObj.streamRaw, options);
      if (dec.decoded) decodedParts.push(dec.decoded);
    }

    if (decodedParts.length > 0) {
      const joined = Buffer.concat(decodedParts.flatMap((p, idx) => (idx === 0 ? [p] : [Buffer.from('\n'), p])));
      if (options.includeStreams) {
        pageStreams.push(joined.toString('latin1'));
      }
      const { runs, vectorPaths, filledRects } = interpretContentStream(joined, fontTable, pageIndex);
      const pageFindings = analyzePageForensics(runs, filledRects, pageBox, pageIndex, options);
      forensicFindings.push(...pageFindings);
      allRuns.push(...runs);
      vectorPathsAcc.push(...vectorPaths);
    }
  });

  // Fallback for standalone content-stream PDFs without formal /Page nodes
  if (allRuns.length === 0 && pageCount === 0) {
    const globalFontTable = new Map();
    for (const obj of objects.values()) {
      if (/\/Font\b/.test(obj.dictStr)) {
        const refs = parseFontDictRefs(obj.dictStr, objects);
        for (const [k, num] of refs.entries()) {
          const entry = getFontByObjNum(num);
          if (entry) globalFontTable.set(k, entry);
        }
      }
    }
    let idx = 0;
    for (const obj of objects.values()) {
      if (!obj.streamRaw) continue;
      if (/\/Subtype\s*\/Image\b|\/Type\s*\/ObjStm\b/.test(obj.dictStr)) continue;
      const dec = decodePdfStreamData(obj.dictStr, obj.streamRaw, options);
      if (dec.decoded && /\bBT\b[\s\S]*?\bET\b/.test(dec.decoded.toString('latin1'))) {
        if (options.includeStreams) {
          pageStreams.push(dec.decoded.toString('latin1'));
        }
        const curPageIdx = idx++;
        const { runs, vectorPaths, filledRects } = interpretContentStream(dec.decoded, globalFontTable, curPageIdx);
        const pageFindings = analyzePageForensics(runs, filledRects, DEFAULT_PAGE_BOX, curPageIdx, options);
        forensicFindings.push(...pageFindings);
        allRuns.push(...runs);
        vectorPathsAcc.push(...vectorPaths);
      }
    }
    if (allRuns.length > 0 && pageCount === 0) pageCount = 1;
  }

  const STRIP_INVISIBLE_CODES = new Set([
    'PDF_INVISIBLE_RENDER_MODE_3',
    'INVISIBLE_WHITE_ON_WHITE_TEXT',
    'INVISIBLE_SUBLEGIBLE_FONT',
    'PDF_OFF_PAGE_TEXT',
  ]);
  const selectedRuns = options.excludeInvisibleRuns
    ? allRuns.filter((r) => !r.hiddenChannelFlags.some((f) => STRIP_INVISIBLE_CODES.has(f)))
    : allRuns;

  const lineRecords = reconstructRunsIntoLines(selectedRuns);
  const vectorTables = deriveVectorTables(vectorPathsAcc, selectedRuns);
  const lines = lineRecords.map((r) => r.text);
  const metadataStrings = extractPdfMetadataStrings(objects, options);

  // Incremental revision history inspection (multiple %%EOF sections)
  let revisionCount = 1;
  let historicalResidualTexts = [];
  if (!options._skipRevisionInspection) {
    const revAudit = inspectPdfIncrementalRevisions(buf, latin, streamRanges, lines, metadataStrings, options);
    revisionCount = revAudit.revisionCount;
    historicalResidualTexts = revAudit.historicalResidualTexts;
    forensicFindings.push(...revAudit.findings);
  }

  // Decode embedded image XObjects lazily ONLY when the PDF has no text layer (scanned PDF) or explicitly requested
  const images = (lines.length === 0 || options.alwaysDecodeImages)
    ? collectImages(objects, options)
    : [];
  const effectiveImageCount = images.length > 0 ? images.length : imageXObjectCount;
  const isLikelyScanned = effectiveImageCount > 0 && lines.length === 0;
  const diagnosticReason = lines.length > 0
    ? 'BORN_DIGITAL_TEXT_EXTRACTED'
    : isLikelyScanned
      ? 'SCANNED_IMAGE_ONLY_PDF'
      : 'EMPTY_PDF_NO_TEXT_LAYER';

  return {
    pageCount,
    streamCount,
    imageXObjectCount: effectiveImageCount,
    isLikelyScanned,
    encrypted: false,
    diagnosticReason,
    lines,
    lineRecords,
    streams: pageStreams,
    images,
    vectorTables,
    forensicFindings,
    revisionCount,
    historicalResidualTexts,
    metadataStrings,
    pageBoxes,
  };
}

function normalizeRedactionSpans(redactedSpans = []) {
  const out = [];
  const seen = new Set();
  for (const item of redactedSpans || []) {
    const raw = typeof item === 'string'
      ? item
      : (item?.value ?? item?.text ?? item?.raw ?? '');
    const str = String(raw || '').trim();
    if (!str) continue;
    const key = str.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      raw: str,
      type: typeof item === 'object' && item ? (item.type || item.category || 'sensitive') : 'sensitive',
      replacement: typeof item === 'object' && item ? (item.replacement || null) : null,
    });
  }
  return out;
}

/**
 * Mandatory post-redaction PDF irreversibility verification gate.
 * Re-extracts all text across visible layer, hidden channels (3 Tr, white-on-white,
 * tiny fonts, off-page, text under opaque overlays), incremental update revisions,
 * decoded content streams, and raw PDF objects/metadata.
 * Fails closed (throws structured PDF_REDACTION_IRREVERSIBILITY_FAILED error) by default
 * if ANY redacted span remains recoverable.
 */
export function verifyPdfRedactionIrreversibility(redactedPdfBuffer, redactedSpans = [], options = {}) {
  const buf = Buffer.isBuffer(redactedPdfBuffer) ? redactedPdfBuffer : Buffer.from(redactedPdfBuffer);
  const throwOnLeak = options.throwOnLeak !== false;
  const caseSensitive = options.caseSensitive === true;
  const normalizeWhitespace = options.normalizeWhitespace !== false;
  const scanRawStreams = options.scanRawStreams !== false;

  const diag = extractPdfDetailed(buf, { includeStreams: true });
  const spans = normalizeRedactionSpans(redactedSpans);
  const normOpts = { caseSensitive, normalizeWhitespace };

  const textLayerNorm = normalizeForComparison(diag.lines.join('\n'), normOpts);
  const revNorm = normalizeForComparison((diag.historicalResidualTexts || []).join('\n'), normOpts);
  const streamsNorm = scanRawStreams
    ? normalizeForComparison((diag.streams || []).join('\n'), normOpts)
    : '';
  const metaAndRawNorm = scanRawStreams
    ? normalizeForComparison(
        [...(diag.metadataStrings || []), buf.toString('latin1')].join('\n'),
        normOpts
      )
    : normalizeForComparison((diag.metadataStrings || []).join('\n'), normOpts);

  const residualLeaks = [];
  for (const sp of spans) {
    const needle = normalizeForComparison(sp.raw, normOpts);
    if (!needle) continue;

    const channels = [];
    const forensicCodes = [];

    if (textLayerNorm.includes(needle)) {
      channels.push('text_layer');
    }
    if (revNorm.includes(needle)) {
      channels.push('incremental_revision');
      if (!forensicCodes.includes('PDF_INCREMENTAL_REVISION_LEAK')) {
        forensicCodes.push('PDF_INCREMENTAL_REVISION_LEAK');
      }
    }

    for (const f of diag.forensicFindings || []) {
      const findingHaystack = normalizeForComparison(
        [f.textSnippet || '', ...(f.residualStrings || [])].join('\n'),
        normOpts
      );
      if (findingHaystack.includes(needle)) {
        if (!channels.includes('forensic_hidden_channel')) {
          channels.push('forensic_hidden_channel');
        }
        if (f.code && !forensicCodes.includes(f.code)) {
          forensicCodes.push(f.code);
        }
      }
    }

    if (streamsNorm && streamsNorm.includes(needle)) {
      channels.push('content_stream');
    }
    if (metaAndRawNorm && metaAndRawNorm.includes(needle)) {
      channels.push('metadata_or_raw_object');
    }

    if (channels.length > 0) {
      residualLeaks.push({
        span: sp.raw,
        type: sp.type,
        channels,
        forensicCodes,
      });
    }
  }

  const report = {
    ok: residualLeaks.length === 0,
    checkedSpanCount: spans.length,
    residualLeakCount: residualLeaks.length,
    residualLeaks,
    forensicFindings: diag.forensicFindings || [],
    revisionCount: diag.revisionCount ?? 1,
    channelsChecked: [
      'text_layer',
      'forensic_hidden_channel',
      'incremental_revision',
      'content_stream',
      'metadata_or_raw_object',
    ],
  };

  if (!report.ok && throwOnLeak) {
    const err = new Error(
      `PDF_REDACTION_IRREVERSIBILITY_FAILED: ${residualLeaks.length} redacted span(s) remain recoverable in emitted PDF`
    );
    err.code = 'PDF_REDACTION_IRREVERSIBILITY_FAILED';
    err.report = report;
    err.residualLeaks = residualLeaks;
    throw err;
  }

  return report;
}

function escapePdfLiteralString(str) {
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 0x5c) out += '\\\\';
    else if (code === 0x28) out += '\\(';
    else if (code === 0x29) out += '\\)';
    else if (code >= 0x20 && code <= 0x7e) out += str[i];
    else if (code <= 0xff) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ' ';
  }
  return out;
}

function escapeRegexLiteral(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Emits a genuinely scrubbed, single-revision, flattened PDF 1.4 buffer with
 * underlying redacted text completely removed (no opaque pseudo-redaction boxes
 * covering intact text, no incremental update history, no invisible hidden text),
 * followed by a mandatory verifyPdfRedactionIrreversibility() gate.
 */
export function redactPdfBuffer(pdfBuffer, spansToRedact = [], options = {}) {
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  const sourceDiag = extractPdfDetailed(buf);
  const stripHiddenChannels = options.stripHiddenChannels !== false;
  const visibleDiag = stripHiddenChannels
    ? extractPdfDetailed(buf, { excludeInvisibleRuns: true, _skipRevisionInspection: true })
    : sourceDiag;

  const normalizedSpans = normalizeRedactionSpans(spansToRedact)
    .sort((a, b) => b.raw.length - a.raw.length);
  const defaultReplacement = options.replacement ?? '[REDACTED]';

  const scrubLine = (text) => {
    let out = String(text || '');
    for (const sp of normalizedSpans) {
      const repl = sp.replacement || defaultReplacement;
      const rx = new RegExp(escapeRegexLiteral(sp.raw), options.caseSensitive ? 'g' : 'gi');
      out = out.replace(rx, repl);
    }
    return out;
  };

  // Group scrubbed lines by pageIndex
  const pageCount = Math.max(1, visibleDiag.pageCount || sourceDiag.pageCount || 1);
  const linesByPage = Array.from({ length: pageCount }, () => []);
  for (const rec of visibleDiag.lineRecords || []) {
    const pIdx = Math.max(0, Math.min(pageCount - 1, rec.pageIndex || 0));
    const scrubbed = scrubLine(rec.text).trim();
    if (scrubbed) {
      linesByPage[pIdx].push({
        text: scrubbed,
        fontStyle: rec.fontStyle || 'sans_serif',
      });
    }
  }

  // Build fresh single-revision flattened PDF 1.4
  const fontMap = {
    display_serif: '/F1',
    sans_serif: '/F2',
    monospace: '/F3',
    italic: '/F4',
    bold_stamp: '/F5',
  };

  // Objects 1=Catalog, 2=Pages, 3..7=Fonts, then per-page Page + Content objects
  const objects = [];
  const pageObjNums = [];
  const firstPageObjNum = 8;

  for (let p = 0; p < pageCount; p += 1) {
    pageObjNums.push(firstPageObjNum + p * 2);
  }

  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  objects.push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`); // 2
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>'); // 3 (/F1)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 4 (/F2)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'); // 5 (/F3)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>'); // 6 (/F4)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'); // 7 (/F5)

  for (let p = 0; p < pageCount; p += 1) {
    const box = sourceDiag.pageBoxes?.[p] || DEFAULT_PAGE_BOX;
    const contentObjNum = firstPageObjNum + p * 2 + 1;
    const pageLines = linesByPage[p];
    const topY = Math.max(box.y0 + 40, box.y1 - 48);
    const lineStep = 18;

    let stream = 'BT\n0 0 0 rg\n0 Tr\n';
    pageLines.forEach((ln, idx) => {
      const y = Math.max(box.y0 + 24, topY - idx * lineStep);
      const fRef = fontMap[ln.fontStyle] || '/F2';
      stream += `${fRef} 10 Tf\n1 0 0 1 50 ${y} Tm\n(${escapePdfLiteralString(ln.text)}) Tj\n`;
    });
    stream += 'ET\n';

    const streamBuf = Buffer.from(stream, 'latin1');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${box.x0} ${box.y0} ${box.x1} ${box.y1}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R >> >> ` +
      `/Contents ${contentObjNum} 0 R >>`
    );
    objects.push(`<< /Length ${streamBuf.length} >>\nstream\n${stream}endstream`);
  }

  let pdfStr = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdfStr, 'latin1'));
    pdfStr += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOff = Buffer.byteLength(pdfStr, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfStr += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;

  const redactedPdfBuffer = Buffer.from(pdfStr, 'latin1');

  // Mandatory post-redaction irreversibility verification pass
  const verification = verifyPdfRedactionIrreversibility(
    redactedPdfBuffer,
    spansToRedact,
    {
      ...(options.verifyOptions || {}),
      throwOnLeak: options.throwOnLeak !== false,
    }
  );

  return {
    redactedPdfBuffer,
    verification,
    redactedSpanCount: normalizedSpans.length,
    strippedForensicFindings: sourceDiag.forensicFindings || [],
  };
}
