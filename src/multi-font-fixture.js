import crypto from 'node:crypto';

/**
 * Mulberry32 PRNG
 */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 1831565813) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Base ASCII Bitmaps (7x9 grid for printable chars 32 to 126)
 */
const BASE_WIDTH = 7;
const BASE_HEIGHT = 9;

function patternToBitmap(lines) {
  const bmp = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
  for (let r = 0; r < lines.length && r < BASE_HEIGHT; r++) {
    const rowStr = lines[r];
    for (let c = 0; c < rowStr.length && c < BASE_WIDTH; c++) {
      if (rowStr[c] === '#' || rowStr[c] === 'X' || rowStr[c] === '1') {
        bmp[r * BASE_WIDTH + c] = 1;
      }
    }
  }
  return bmp;
}

function generateFallbackBitmap(code) {
  const bmp = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
  let s = code * 2654435761;
  for (let r = 0; r < BASE_HEIGHT; r++) {
    for (let c = 0; c < BASE_WIDTH; c++) {
      s = (s * 1103515245 + 12345) | 0;
      if (r === 0 || r === BASE_HEIGHT - 1 || c === 0 || c === BASE_WIDTH - 1 || (s % 3 === 0)) {
        bmp[r * BASE_WIDTH + c] = 1;
      }
    }
  }
  bmp[0] = 1;
  bmp[BASE_WIDTH - 1] = 1;
  bmp[(BASE_HEIGHT - 1) * BASE_WIDTH] = 1;
  bmp[BASE_HEIGHT * BASE_WIDTH - 1] = 1;
  return bmp;
}

const explicitGlyphs = {
  ' ': [
    "       ", "       ", "       ", "       ", "       ",
    "       ", "       ", "       ", "       "
  ],
  'A': [
    "  ###  ", " #   # ", "#     #", "#     #", "#######",
    "#     #", "#     #", "#     #", "#     #"
  ],
  'B': [
    "###### ", "#     #", "#     #", "###### ", "#     #",
    "#     #", "#     #", "#     #", "###### "
  ],
  'C': [
    " ##### ", "#     #", "#      ", "#      ", "#      ",
    "#      ", "#      ", "#     #", " ##### "
  ],
  'D': [
    "###### ", "#     #", "#     #", "#     #", "#     #",
    "#     #", "#     #", "#     #", "###### "
  ],
  'E': [
    "#######", "#      ", "#      ", "###### ", "#      ",
    "#      ", "#      ", "#      ", "#######"
  ],
  'F': [
    "#######", "#      ", "#      ", "###### ", "#      ",
    "#      ", "#      ", "#      ", "#      "
  ],
  'G': [
    " ##### ", "#     #", "#      ", "#      ", "#  ####",
    "#     #", "#     #", "#     #", " ##### "
  ],
  'H': [
    "#     #", "#     #", "#     #", "#######", "#     #",
    "#     #", "#     #", "#     #", "#     #"
  ],
  'I': [
    "#######", "   #   ", "   #   ", "   #   ", "   #   ",
    "   #   ", "   #   ", "   #   ", "#######"
  ],
  'J': [
    "#######", "    #  ", "    #  ", "    #  ", "    #  ",
    "    #  ", "#   #  ", "#   #  ", " ###   "
  ],
  'K': [
    "#     #", "#    # ", "#   #  ", "####   ", "#   #  ",
    "#    # ", "#     #", "#     #", "#     #"
  ],
  'L': [
    "#      ", "#      ", "#      ", "#      ", "#      ",
    "#      ", "#      ", "#      ", "#######"
  ],
  'M': [
    "#     #", "##   ##", "# # # #", "#  #  #", "#     #",
    "#     #", "#     #", "#     #", "#     #"
  ],
  'N': [
    "#     #", "##    #", "# #   #", "#  #  #", "#   # #",
    "#    ##", "#     #", "#     #", "#     #"
  ],
  'O': [
    " ##### ", "#     #", "#     #", "#     #", "#     #",
    "#     #", "#     #", "#     #", " ##### "
  ],
  'P': [
    "###### ", "#     #", "#     #", "###### ", "#      ",
    "#      ", "#      ", "#      ", "#      "
  ],
  'Q': [
    " ##### ", "#     #", "#     #", "#     #", "#     #",
    "#   # #", "#    # ", "#     #", " ##### #"
  ],
  'R': [
    "###### ", "#     #", "#     #", "###### ", "#   #  ",
    "#    # ", "#     #", "#     #", "#     #"
  ],
  'S': [
    " ##### ", "#     #", "#      ", " ##### ", "      #",
    "      #", "#     #", "#     #", " ##### "
  ],
  'T': [
    "#######", "   #   ", "   #   ", "   #   ", "   #   ",
    "   #   ", "   #   ", "   #   ", "   #   "
  ],
  'U': [
    "#     #", "#     #", "#     #", "#     #", "#     #",
    "#     #", "#     #", "#     #", " ##### "
  ],
  'V': [
    "#     #", "#     #", "#     #", "#     #", " #   # ",
    " #   # ", "  # #  ", "  # #  ", "   #   "
  ],
  'W': [
    "#     #", "#     #", "#     #", "#     #", "#  #  #",
    "# # # #", "##   ##", "#     #", "#     #"
  ],
  'X': [
    "#     #", " #   # ", "  # #  ", "   #   ", "   #   ",
    "   #   ", "  # #  ", " #   # ", "#     #"
  ],
  'Y': [
    "#     #", " #   # ", "  # #  ", "   #   ", "   #   ",
    "   #   ", "   #   ", "   #   ", "   #   "
  ],
  'Z': [
    "#######", "     # ", "    #  ", "   #   ", "  #    ",
    " #     ", "#      ", "#      ", "#######"
  ],
  '0': [
    " ##### ", "#     #", "#    ##", "#   # #", "#  #  #",
    "# #   #", "##    #", "#     #", " ##### "
  ],
  '1': [
    "   #   ", "  ##   ", "   #   ", "   #   ", "   #   ",
    "   #   ", "   #   ", "   #   ", "#######"
  ],
  '2': [
    " ##### ", "#     #", "      #", "     # ", "    #  ",
    "   #   ", "  #    ", " #     ", "#######"
  ],
  '3': [
    " ##### ", "#     #", "      #", " ##### ", "      #",
    "      #", "      #", "#     #", " ##### "
  ],
  '4': [
    "#     #", "#     #", "#     #", "#     #", "#######",
    "      #", "      #", "      #", "      #"
  ],
  '5': [
    "#######", "#      ", "#      ", "###### ", "      #",
    "      #", "      #", "#     #", " ##### "
  ],
  '6': [
    " ##### ", "#     #", "#      ", "###### ", "#     #",
    "#     #", "#     #", "#     #", " ##### "
  ],
  '7': [
    "#######", "      #", "     # ", "    #  ", "   #   ",
    "   #   ", "   #   ", "   #   ", "   #   "
  ],
  '8': [
    " ##### ", "#     #", "#     #", " ##### ", "#     #",
    "#     #", "#     #", "#     #", " ##### "
  ],
  '9': [
    " ##### ", "#     #", "#     #", "#     #", " ######",
    "      #", "      #", "#     #", " ##### "
  ],
  '@': [
    " ##### ", "#     #", "#  #  #", "#  #  #", "#  ### ",
    "#      ", "#     #", "#     #", " ##### "
  ],
  '.': [
    "       ", "       ", "       ", "       ", "       ",
    "       ", "  ##   ", "  ##   ", "       "
  ],
  '-': [
    "       ", "       ", "       ", "       ", "#######",
    "       ", "       ", "       ", "       "
  ],
  '_': [
    "       ", "       ", "       ", "       ", "       ",
    "       ", "       ", "       ", "#######"
  ],
  ':': [
    "       ", "  ##   ", "  ##   ", "       ", "       ",
    "  ##   ", "  ##   ", "       ", "       "
  ],
  '/': [
    "      #", "     # ", "    #  ", "   #   ", "   #   ",
    "  #    ", " #     ", "#      ", "#      "
  ],
  '(': [
    "   ##  ", "  #    ", " #     ", " #     ", " #     ",
    " #     ", " #     ", "  #    ", "   ##  "
  ],
  ')': [
    "  ##   ", "    #  ", "     # ", "     # ", "     # ",
    "     # ", "     # ", "    #  ", "  ##   "
  ],
  '[': [
    " ##### ", " #     ", " #     ", " #     ", " #     ",
    " #     ", " #     ", " #     ", " ##### "
  ],
  ']': [
    " ##### ", "     # ", "     # ", "     # ", "     # ",
    "     # ", "     # ", "     # ", " ##### "
  ],
  '#': [
    "  # #  ", "  # #  ", "#######", "  # #  ", "#######",
    "  # #  ", "  # #  ", "       ", "       "
  ],
  '$': [
    "   #   ", " ##### ", "#  #   ", " ##### ", "   #  #",
    " ##### ", "   #   ", "       ", "       "
  ],
  '%': [
    "##   # ", "##  #  ", "   #   ", "  #    ", " #     ",
    " #  ## ", " #  ## ", "       ", "       "
  ],
  '&': [
    " ##### ", "#     #", "#     #", " ##### ", "#  # # ",
    "#   #  ", " #   # ", "  # # #", "   ### "
  ],
  '*': [
    "       ", " # # # ", "  ###  ", " # # # ", "       ",
    "       ", "       ", "       ", "       "
  ],
  '+': [
    "       ", "   #   ", "   #   ", "#######", "   #   ",
    "   #   ", "       ", "       ", "       "
  ],
  '=': [
    "       ", "       ", "       ", "#######", "       ",
    "#######", "       ", "       ", "       "
  ],
  ',': [
    "       ", "       ", "       ", "       ", "       ",
    "       ", "  ##   ", "   #   ", "  #    "
  ],
  ';': [
    "       ", "  ##   ", "  ##   ", "       ", "       ",
    "  ##   ", "   #   ", "  #    ", "       "
  ],
  '\'': [
    "  ##   ", "   #   ", "       ", "       ", "       ",
    "       ", "       ", "       ", "       "
  ],
  '"': [
    " # #   ", " # #   ", "       ", "       ", "       ",
    "       ", "       ", "       ", "       "
  ],
  '!': [
    "   #   ", "   #   ", "   #   ", "   #   ", "   #   ",
    "       ", "       ", "   #   ", "   #   "
  ],
  '?': [
    " ##### ", "#     #", "      #", "    ## ", "   #   ",
    "   #   ", "       ", "   #   ", "   #   "
  ],
  '<': [
    "    #  ", "   #   ", "  #    ", " #     ", "#      ",
    " #     ", "  #    ", "   #   ", "    #  "
  ],
  '>': [
    "#      ", " #     ", "  #    ", "   #   ", "    #  ",
    "   #   ", "  #    ", " #     ", "#      "
  ],
  '|': [
    "   #   ", "   #   ", "   #   ", "   #   ", "   #   ",
    "   #   ", "   #   ", "   #   ", "   #   "
  ],
  '\\': [
    "#      ", "#      ", " #     ", "  #    ", "   #   ",
    "   #   ", "    #  ", "     # ", "      #"
  ]
};

const GLYPH_MAP = new Map();
for (let code = 32; code <= 126; code++) {
  const ch = String.fromCharCode(code);
  if (explicitGlyphs[ch]) {
    GLYPH_MAP.set(ch, patternToBitmap(explicitGlyphs[ch]));
  } else if (code >= 97 && code <= 122) {
    const upperCh = ch.toUpperCase();
    if (explicitGlyphs[upperCh]) {
      const bmp = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
      const upperBmp = patternToBitmap(explicitGlyphs[upperCh]);
      for (let i = 0; i < upperBmp.length; i++) {
        bmp[i] = upperBmp[i];
      }
      for (let c = 0; c < BASE_WIDTH; c++) {
        bmp[(BASE_HEIGHT - 1) * BASE_WIDTH + c] = (c % 2 === 0) ? 1 : 0;
      }
      GLYPH_MAP.set(ch, bmp);
    } else {
      GLYPH_MAP.set(ch, generateFallbackBitmap(code));
    }
  } else {
    GLYPH_MAP.set(ch, generateFallbackBitmap(code));
  }
}

export const FONT_STYLES = ['display_serif', 'sans_serif', 'monospace', 'italic', 'bold_stamp'];

export function renderGlyphBitmap(ch, fontStyle) {
  const baseBmp = GLYPH_MAP.get(ch) || GLYPH_MAP.get('?');
  
  let scaleX = 2;
  let scaleY = 2;
  let hasSerif = false;
  let isBold = false;
  let isItalic = false;

  if (fontStyle === 'display_serif') {
    scaleX = 3;
    scaleY = 4;
    hasSerif = true;
  } else if (fontStyle === 'sans_serif') {
    scaleX = 2;
    scaleY = 2;
  } else if (fontStyle === 'monospace') {
    scaleX = 2;
    scaleY = 2;
  } else if (fontStyle === 'italic') {
    scaleX = 2;
    scaleY = 2;
    isItalic = true;
  } else if (fontStyle === 'bold_stamp') {
    scaleX = 3;
    scaleY = 3;
    isBold = true;
  }

  const outW = BASE_WIDTH * scaleX + (isItalic ? Math.ceil(BASE_HEIGHT * scaleY / 3) : 0) + (isBold ? 2 : 0);
  const outH = BASE_HEIGHT * scaleY + (hasSerif ? 4 : 0);
  const grid = new Uint8Array(outW * outH);

  const offsetY = hasSerif ? 2 : 0;

  for (let r = 0; r < BASE_HEIGHT; r++) {
    for (let c = 0; c < BASE_WIDTH; c++) {
      if (baseBmp[r * BASE_WIDTH + c]) {
        let shearOffset = 0;
        if (isItalic) {
          const currentY = r * scaleY;
          shearOffset = Math.floor((BASE_HEIGHT * scaleY - currentY) / 3);
        }

        for (let dy = 0; dy < scaleY; dy++) {
          for (let dx = 0; dx < scaleX; dx++) {
            const px = c * scaleX + dx + shearOffset;
            const py = r * scaleY + dy + offsetY;
            if (px >= 0 && px < outW && py >= 0 && py < outH) {
              grid[py * outW + px] = 1;
              if (isBold) {
                if (px + 1 < outW) grid[py * outW + (px + 1)] = 1;
              }
            }
          }
        }
      }
    }
  }

  if (hasSerif) {
    for (let x = 0; x < outW; x++) {
      if (grid[(offsetY + 1) * outW + x] === 1) {
        if (x > 0) grid[0 * outW + (x - 1)] = 1;
        grid[0 * outW + x] = 1;
        if (x + 1 < outW) grid[0 * outW + (x + 1)] = 1;

        const bottomY = outH - 1;
        if (x > 0) grid[bottomY * outW + (x - 1)] = 1;
        grid[bottomY * outW + x] = 1;
        if (x + 1 < outW) grid[bottomY * outW + (x + 1)] = 1;
      }
    }
  }

  return { width: outW, height: outH, data: grid };
}

export function encodeBMP(width, height, rgb) {
  const rowSize = (width * 3 + 3) & ~3;
  const imageSize = rowSize * height;
  const fileSize = 54 + imageSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(imageSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  let dstOffset = 54;
  for (let y = 0; y < height; y++) {
    const srcRowOffset = y * width * 3;
    let x = 0;
    for (; x < width; x++) {
      const srcIdx = srcRowOffset + x * 3;
      buf[dstOffset++] = rgb[srcIdx + 2];
      buf[dstOffset++] = rgb[srcIdx + 1];
      buf[dstOffset++] = rgb[srcIdx + 0];
    }
    const written = width * 3;
    const padding = rowSize - written;
    for (let p = 0; p < padding; p++) {
      buf[dstOffset++] = 0;
    }
  }

  return buf;
}

export function encodePNG(width, height, rgb) {
  const crcTable = (() => {
    let c;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(buf, start, length) {
    let c = 0xffffffff;
    for (let i = start; i < start + length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return ~c >>> 0;
  }

  function adler32(buf) {
    let s1 = 1;
    let s2 = 0;
    for (let i = 0; i < buf.length; i++) {
      s1 = (s1 + buf[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    return ((s2 << 16) | s1) >>> 0;
  }

  const scanlineLen = 1 + width * 3;
  const rawData = Buffer.alloc(scanlineLen * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLen;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      const dstIdx = rowOffset + 1 + x * 3;
      rawData[dstIdx] = rgb[srcIdx];
      rawData[dstIdx + 1] = rgb[srcIdx + 1];
      rawData[dstIdx + 2] = rgb[srcIdx + 2];
    }
  }

  const maxBlockSize = 65535;
  const blocks = [];
  let offset = 0;
  while (offset < rawData.length) {
    const chunkSize = Math.min(rawData.length - offset, maxBlockSize);
    const isLast = (offset + chunkSize >= rawData.length) ? 1 : 0;
    
    const blockBuf = Buffer.alloc(5 + chunkSize);
    blockBuf[0] = isLast;
    blockBuf.writeUInt16LE(chunkSize, 1);
    blockBuf.writeUInt16LE(~chunkSize & 0xffff, 3);
    rawData.copy(blockBuf, 5, offset, offset + chunkSize);
    blocks.push(blockBuf);
    offset += chunkSize;
  }
  const deflateData = Buffer.concat(blocks);

  const zlibHeader = Buffer.from([0x78, 0x01]);
  const adlerVal = adler32(rawData);
  const zlibFooter = Buffer.alloc(4);
  zlibFooter.writeUInt32BE(adlerVal, 0);

  const compressed = Buffer.concat([zlibHeader, deflateData, zlibFooter]);

  function createChunk(type, data) {
    const len = data ? data.length : 0;
    const chunk = Buffer.alloc(12 + len);
    chunk.writeUInt32BE(len, 0);
    chunk.write(type, 4, 4, 'ascii');
    if (data) data.copy(chunk, 8);
    const crc = crc32(chunk, 4, 4 + len);
    chunk.writeUInt32BE(crc, 8 + len);
    return chunk;
  }

  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', null);

  return Buffer.concat([pngSig, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * 1. applyScanDegradations
 */
export function applyScanDegradations(rgb, width, height, { seed = 42, skewDeg = 1.2, noiseStd = 12, blockQuant = 8 } = {}) {
  const rng = mulberry32(seed);
  const degraded = Buffer.from(rgb);

  // Apply noise & block quantization simulating JPEG/sensor noise
  const angleRad = (skewDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const cx = width / 2;
  const cy = height / 2;

  const temp = Buffer.from(degraded);

  // Rotation / Skew & Gaussian-like noise & 8x8 block quantization
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Inverse rotation for skew
      const dx = x - cx;
      const dy = y - cy;
      const srcX = Math.round(cosA * dx + sinA * dy + cx);
      const srcY = Math.round(-sinA * dx + cosA * dy + cy);

      const dstIdx = (y * width + x) * 3;

      let r = 250, g = 250, b = 248;
      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + srcX) * 3;
        r = temp[srcIdx];
        g = temp[srcIdx + 1];
        b = temp[srcIdx + 2];
      }

      // Noise
      const nR = (rng() - 0.5) * 2 * noiseStd;
      const nG = (rng() - 0.5) * 2 * noiseStd;
      const nB = (rng() - 0.5) * 2 * noiseStd;

      r = Math.min(255, Math.max(0, Math.round(r + nR)));
      g = Math.min(255, Math.max(0, Math.round(g + nG)));
      b = Math.min(255, Math.max(0, Math.round(b + nB)));

      // Block quantization (JPEG-like compression quantization across blockQuant x blockQuant blocks)
      if (blockQuant > 1) {
        r = Math.min(255, Math.max(0, Math.round(r / blockQuant) * blockQuant));
        g = Math.min(255, Math.max(0, Math.round(g / blockQuant) * blockQuant));
        b = Math.min(255, Math.max(0, Math.round(b / blockQuant) * blockQuant));
      }

      degraded[dstIdx] = r;
      degraded[dstIdx + 1] = g;
      degraded[dstIdx + 2] = b;
    }
  }

  const sha256 = crypto.createHash('sha256').update(degraded).digest('hex');
  return { rgb: degraded, sha256 };
}

/**
 * 3. getBornDigitalCorpus
 */
export function getBornDigitalCorpus() {
  return [
    {
      id: "doc-html-01",
      format: "html",
      domain: "in_distribution",
      content: "<html><body><h1>Patient Record</h1><p>Patient Name: Evelyn Vance</p><p>Email: ada.lovelace@matilda-maincode.au</p><p>Phone: +61 412 345 678</p></body></html>",
      groundTruthLabel: 0, // quarantine_pii
      isHardLookalike: false
    },
    {
      id: "doc-email-02",
      format: "email",
      domain: "in_distribution",
      content: "From: admin@matilda-maincode.au\nTo: doctor@hospital.org\nSubject: Patient Clinical Notes\nSSN: 123-45-6789\nDOB: 14/03/1988",
      groundTruthLabel: 0, // quarantine_pii
      isHardLookalike: false
    },
    {
      id: "doc-pdf-03",
      format: "pdf_text",
      domain: "in_distribution",
      content: "CONFIDENTIAL MEDICAL REPORT\nCredit Card: 4532-0151-1283-0366\nIP Address: 203.0.113.42\nAddress: 742 Evergreen Terrace Melbourne VIC",
      groundTruthLabel: 0, // quarantine_pii
      isHardLookalike: false
    },
    {
      id: "doc-log-04",
      format: "markdown_log",
      domain: "in_distribution",
      content: "### System Log\n- Operation successful.\n- All vitals stable.\n- Routine check completed without issues.",
      groundTruthLabel: 1, // keep_safe
      isHardLookalike: false
    },
    {
      id: "doc-lookalike-05",
      format: "markdown_log",
      domain: "shifted_domain",
      content: "Engineering Bulletin:\n- Part Number: PN-800-555-0199 installed.\n- Version: v10.24.108.3 verified.\n- Reference: INV-123-45-6789 code updated.\n- Algorithm: Markov Chain model initialized under Boolean Logic.",
      groundTruthLabel: 1, // keep_safe (non-PII lookalike)
      isHardLookalike: true
    }
  ];
}

export function generateMultiFontDocument(options = {}) {
  const seed = options.seed !== undefined ? options.seed : 20261115;
  const width = options.width || 1024;
  const height = options.height || 1440;

  const bgColor = [250, 250, 248];

  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = bgColor[0];
    rgb[i * 3 + 1] = bgColor[1];
    rgb[i * 3 + 2] = bgColor[2];
  }

  function drawPixel(x, y, color) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 3;
      rgb[idx] = color[0];
      rgb[idx + 1] = color[1];
      rgb[idx + 2] = color[2];
    }
  }

  const inkColors = {
    display_serif: [20, 28, 58],
    sans_serif: [35, 39, 46],
    monospace: [25, 50, 60],
    italic: [60, 35, 70],
    bold_stamp: [150, 24, 24]
  };

  const rawLinesSpec = [
    { text: "MATILDA SECURE HEALTHCARE RECORD SYSTEM V1.0", fontStyle: "display_serif", routingLabel: "drop_boilerplate" },
    { text: "Patient Name: Evelyn Vance", fontStyle: "sans_serif", routingLabel: "quarantine_pii", piiType: "name_likely" },
    { text: "DOB: 14/03/1988", fontStyle: "monospace", routingLabel: "quarantine_pii", piiType: "date_of_birth" },
    { text: "Email: ada.lovelace@matilda-maincode.au", fontStyle: "italic", routingLabel: "quarantine_pii", piiType: "email" },
    { text: "Phone: +61 412 345 678", fontStyle: "sans_serif", routingLabel: "quarantine_pii", piiType: "phone" },
    { text: "SSN: 123-45-6789", fontStyle: "monospace", routingLabel: "quarantine_pii", piiType: "ssn" },
    { text: "Credit Card: 4532-0151-1283-0366", fontStyle: "bold_stamp", routingLabel: "quarantine_pii", piiType: "credit_card" },
    { text: "IP Address: 203.0.113.42", fontStyle: "sans_serif", routingLabel: "quarantine_pii", piiType: "ip_address" },
    { text: "Address: 742 Evergreen Terrace Melbourne VIC", fontStyle: "display_serif", routingLabel: "quarantine_pii", piiType: "address_likely" },
    { text: "CLINICAL OBSERVATIONS AND DIAGNOSTIC NOTES", fontStyle: "display_serif", routingLabel: "drop_boilerplate" },
    { text: "Patient shows stable vitals and excellent recovery progress.", fontStyle: "sans_serif", routingLabel: "keep_safe" },
    { text: "Follow-up consultation scheduled for next month.", fontStyle: "monospace", routingLabel: "keep_safe" },
    { text: "Attending Physician: Dr. Alan Turing", fontStyle: "italic", routingLabel: "keep_safe" },
    { text: "Hospital ID: HOS-9982-X", fontStyle: "sans_serif", routingLabel: "drop_boilerplate" },
    { text: "Emergency Contact: Charles Babbage", fontStyle: "bold_stamp", routingLabel: "quarantine_pii", piiType: "name_likely" },
    { text: "Emergency Phone: 555-234-5678", fontStyle: "monospace", routingLabel: "quarantine_pii", piiType: "phone" },
    { text: "Confidentiality Notice: Restricted Access Only", fontStyle: "display_serif", routingLabel: "drop_boilerplate" }
  ];

  let currentY = 60;
  const leftMargin = 60;
  const lines = [];
  const piiManifest = [];
  const fontSummaryMap = {};

  for (const fStyle of FONT_STYLES) {
    fontSummaryMap[fStyle] = { lineCount: 0, charCount: 0, fontSizePx: 0 };
  }

  for (let lineIndex = 0; lineIndex < rawLinesSpec.length; lineIndex++) {
    const spec = rawLinesSpec[lineIndex];
    const text = spec.text;
    const fontStyle = spec.fontStyle;
    const routingLabel = spec.routingLabel;
    const ink = inkColors[fontStyle] || [30, 30, 30];

    let cursorX = leftMargin;
    let maxLineHeight = 0;
    const charBoxes = [];

    const lineStartX = cursorX;
    const lineStartY = currentY;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const glyph = renderGlyphBitmap(ch, fontStyle);

      if (glyph.height > maxLineHeight) {
        maxLineHeight = glyph.height;
      }

      const charX1 = cursorX;
      const charY1 = currentY;
      const charX2 = cursorX + glyph.width - 1;
      const charY2 = currentY + glyph.height - 1;

      for (let gy = 0; gy < glyph.height; gy++) {
        for (let gx = 0; gx < glyph.width; gx++) {
          if (glyph.data[gy * glyph.width + gx]) {
            drawPixel(charX1 + gx, charY1 + gy, ink);
          }
        }
      }

      charBoxes.push({
        ch,
        bbox: [charX1, charY1, charX2, charY2]
      });

      const charGap = fontStyle === 'display_serif' ? 6 : (fontStyle === 'bold_stamp' ? 6 : 4);
      cursorX += glyph.width + charGap;

      fontSummaryMap[fontStyle].charCount++;
    }

    // 1. Accurately compute tight bounding box around actual rendered ink pixels for the line
    let minX = width, minY = height, maxX = -1, maxY = -1;
    const lineX1 = lineStartX;
    const lineY1 = lineStartY;
    const lineX2 = cursorX - 1;
    const lineY2 = lineStartY + maxLineHeight - 1;

    for (let y = lineY1; y <= lineY2; y++) {
      for (let x = lineX1; x <= lineX2; x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          const idx = (y * width + x) * 3;
          if (rgb[idx] !== 250 || rgb[idx+1] !== 250 || rgb[idx+2] !== 248) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    const tightBbox = (minX <= maxX && minY <= maxY) ? [minX, minY, maxX, maxY] : [lineX1, lineY1, lineX2, lineY2];

    fontSummaryMap[fontStyle].lineCount++;
    fontSummaryMap[fontStyle].fontSizePx = maxLineHeight;

    const lineRecord = {
      lineIndex,
      text,
      fontStyle,
      fontSizePx: maxLineHeight,
      bbox: tightBbox,
      charBoxes,
      routingLabel
    };

    if (spec.piiType) {
      const piiItem = {
        type: spec.piiType,
        value: text,
        lineIndex,
        fontStyle,
        bbox: tightBbox
      };
      lineRecord.piiItems = [piiItem];
      piiManifest.push(piiItem);
    } else {
      lineRecord.piiItems = [];
    }

    lines.push(lineRecord);

    const lineGap = 22;
    currentY += maxLineHeight + lineGap;
  }

  const hashInput = Buffer.concat([rgb, Buffer.from(String(seed))]);
  const sha256 = crypto.createHash('sha256').update(hashInput).digest('hex');

  return {
    seed,
    width,
    height,
    rgb,
    sha256,
    groundTruth: {
      lines,
      piiManifest,
      fontSummary: fontSummaryMap
    }
  };
}
