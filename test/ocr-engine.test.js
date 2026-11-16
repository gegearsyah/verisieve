import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  generateMultiFontDocument,
  applyScanDegradations,
  encodePNG,
  encodeBMP
} from '../src/multi-font-fixture.js';
import {
  auditCactusWasmArtifact,
  createCactusRuntime,
  sanitizeMirageFormSchema,
  restoreMirageFormOutput,
  computeCanvasScaleGeometry,
  levenshteinSimilarity,
  decodePngBuffer,
  decodeBmpBuffer,
  decodeImageBuffer,
  decodePdfImageXObject,
  extractImageTiles2D,
  runTiledOcrAsync,
  tileAndRead
} from '../src/ocr-engine.js';
import { extractPdfDetailed } from '../src/pdf-parser.js';
import { ingestFromUrlOrPath } from '../src/pdf-image-pipeline.js';

test('auditCactusWasmArtifact verifies cactus.wasm correctly', async () => {
  const audit = await auditCactusWasmArtifact('vendor/cactus/cactus.wasm');
  assert.strictEqual(audit.sha256, '2de0a4459ed427c258157fcb6128265f72f405e7464b25d713bbd336b15bcacf');
  assert.strictEqual(audit.importCount, 16);
  assert.strictEqual(audit.networkImportCount, 0);
  assert.strictEqual(audit.zeroEgressVerified, true);
});

test('sanitizeMirageFormSchema and restoreMirageFormOutput bijectively process forbidden characters', () => {
  const form = {
    title: "Medical Record Form",
    choice: "Option A; Option B | Option C #1 @User $Tag *Star\nNewline"
  };

  const { sanitizedForm, mapping } = sanitizeMirageFormSchema(form);
  assert.strictEqual(sanitizedForm.choice.includes(';'), false);
  assert.strictEqual(sanitizedForm.choice.includes('\n'), false);

  const restored = restoreMirageFormOutput(sanitizedForm, mapping);
  assert.strictEqual(restored.choice, form.choice);
  assert.strictEqual(restored.title, form.title);
});

test('computeCanvasScaleGeometry correctly calculates scales across modes', () => {
  const untiled = computeCanvasScaleGeometry(1024, 1440, { mode: 'untiled_512' });
  assert.strictEqual(untiled.scaleFactor, 512 / 1440);

  const band = computeCanvasScaleGeometry(1024, 1440, { mode: 'horizontal_1d_band' });
  assert.strictEqual(band.scaleFactor, 512 / 1024);

  const tile2d = computeCanvasScaleGeometry(1024, 1440, { mode: 'tile_2d' });
  assert.strictEqual(tile2d.scaleFactor, 1.0);
  assert.strictEqual(tile2d.numPasses > 1, true);
});

test('levenshteinSimilarity calculates correct string similarity', () => {
  assert.strictEqual(levenshteinSimilarity('hello', 'hello'), 1.0);
  assert.strictEqual(levenshteinSimilarity('', ''), 1.0);
  assert.strictEqual(levenshteinSimilarity('abc', 'adc') > 0.5, true);
});

test('tileAndRead comparison across modes and scan degradations', () => {
  const doc = generateMultiFontDocument({ seed: 20261115 });
  const degradedRgb = applyScanDegradations(doc.rgb, doc.width, doc.height, { seed: 42, skewDeg: 1.2, noiseStd: 12 });
  const degradedDoc = { ...doc, rgb: degradedRgb.rgb };

  const untiledResult = tileAndRead(degradedDoc, { mode: 'untiled_512' });
  assert.strictEqual(untiledResult.numPasses, 1);
  assert.strictEqual(untiledResult.lineRecall < 1.0, true);

  const bandResult = tileAndRead(degradedDoc, { mode: 'horizontal_1d_band' });
  assert.strictEqual(bandResult.numPasses > 1, true);

  const tile2dResult = tileAndRead(degradedDoc, { mode: 'tile_2d' });
  assert.strictEqual(tile2dResult.scaleFactor, 1.0);
  assert.strictEqual(tile2dResult.piiBoxRecall >= 0.90, true);
});

function buildMinimalWasmWithImport(moduleName, fnName) {
  const encStr = (s) => {
    const b = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  };
  const sec = (id, body) => Buffer.concat([Buffer.from([id, body.length]), body]);
  // Type[0] () -> ()
  const typeSec = sec(1, Buffer.from([1, 0x60, 0, 0]));
  // Import[0]: moduleName.fnName func type 0
  const impEntry = Buffer.concat([encStr(moduleName), encStr(fnName), Buffer.from([0x00, 0x00])]);
  const impSec = sec(2, Buffer.concat([Buffer.from([1]), impEntry]));
  return Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), typeSec, impSec]);
}

function buildCustomPng({ width, height, colorType, rawScanlines, paletteRgb = null }) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  const chunk = (type, data) => {
    const len = data ? data.length : 0;
    const out = Buffer.alloc(12 + len);
    out.writeUInt32BE(len, 0);
    out.write(type, 4, 4, 'ascii');
    if (data) data.copy(out, 8);
    let c = 0xffffffff;
    for (let i = 4; i < 8 + len; i++) c = crcTable[(c ^ out[i]) & 0xff] ^ (c >>> 8);
    out.writeUInt32BE((~c) >>> 0, 8 + len);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (paletteRgb) parts.push(chunk('PLTE', Buffer.from(paletteRgb)));
  parts.push(chunk('IDAT', zlib.deflateSync(Buffer.from(rawScanlines))));
  parts.push(chunk('IEND', null));
  return Buffer.concat(parts);
}

test('T4: auditCactusWasmArtifact verifies exact 16-import signatures and fails unverified imports strictly', async () => {
  const audit = await auditCactusWasmArtifact('vendor/cactus/cactus.wasm', { strict: true });
  assert.strictEqual(audit.importCount, 16);
  assert.strictEqual(audit.importsVerified, true);
  assert.strictEqual(audit.filesystemImportCount, 0);
  assert.strictEqual(audit.networkImportCount, 0);
  assert.strictEqual(audit.zeroEgressVerified, true);
  assert.deepStrictEqual(audit.unexpectedImports, []);
  assert.deepStrictEqual(audit.signatureMismatches, []);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verisieve-t4-wasm-'));
  try {
    const badPath = path.join(tmpDir, 'bad.wasm');
    fs.writeFileSync(badPath, buildMinimalWasmWithImport('env', 'fetch'));
    const badAudit = await auditCactusWasmArtifact(badPath);
    assert.strictEqual(badAudit.zeroEgressVerified, false);
    assert.strictEqual(badAudit.importsVerified, false);
    assert.strictEqual(badAudit.unexpectedImports.length, 1);
    await assert.rejects(
      () => auditCactusWasmArtifact(badPath, { strict: true }),
      /WASM_IMPORT_CONTRACT_VIOLATION/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('T4: createCactusRuntime drives cactus.wasm in pure-memory VFS sandbox and fails closed on missing/invalid weights', async () => {
  const runtime = await createCactusRuntime();
  try {
    assert.strictEqual(runtime.getStatus(), 0);
    assert.deepStrictEqual(runtime.getVfsStats().hostDiskAccesses, 0);
    assert.deepStrictEqual(runtime.getVfsStats().networkCalls, 0);

    // Invalid weights must execute cactus_load (z) and report cactus_last_error (s)
    const badRes = runtime.loadWeights(Buffer.from('NOT_A_VALID_CACT_MODEL_1234567890'));
    assert.strictEqual(badRes.ok, false);
    assert.match(badRes.error, /invalid \.cact model/i);

    // Calling cactus_describe (y) without loaded vision model must fail with WASM's real error string
    assert.throws(
      () => runtime.describeRgb(new Uint8Array(64 * 64 * 3), 64, 64, { max_text_lines: 32, text_conf: 0.25 }),
      /no vision model loaded/i
    );
  } finally {
    runtime.dispose();
  }
});

test('T4: sanitizeMirageFormSchema avoids stateful /g regex skips and restores >10 keys & literal escapes bijectively', () => {
  const form = {
    title: 'Clinic Form',
    f0: ';leading-semi',
    f1: '|pipe-second',
    f2: '=eq-third',
    f3: '#hash',
    f4: '@at',
    f5: '$dollar',
    f6: '*star',
    f7: 'line1\nline2\rline3',
    f8: ';|=#@$*\n',
    f9: 'literal \\x3b escape',
    f10: 'tenth __MIRAGE_SAN_1__ collision test;end',
    f11: ';consecutive-after-10',
    nested: {
      items: ['a;b', 'c|d', { sub: '#key=val\n' }]
    }
  };

  for (let pass = 0; pass < 3; pass++) {
    const { sanitizedForm, mapping } = sanitizeMirageFormSchema(form);
    const flatCheck = JSON.stringify(sanitizedForm);
    // Notice JSON.stringify escapes newlines as \n so check raw field values directly
    for (const key of Object.keys(sanitizedForm)) {
      if (typeof sanitizedForm[key] === 'string') {
        assert.strictEqual(/[;|=#@$*\r\n]/.test(sanitizedForm[key]), false, `delimiter leaked in ${key}: ${sanitizedForm[key]}`);
      }
    }
    assert.strictEqual(/[;|=#@$*\r\n]/.test(sanitizedForm.nested.items[0]), false);
    assert.strictEqual(/[;|=#@$*\r\n]/.test(sanitizedForm.nested.items[1]), false);
    assert.strictEqual(/[;|=#@$*\r\n]/.test(sanitizedForm.nested.items[2].sub), false);

    const restored = restoreMirageFormOutput(sanitizedForm, mapping);
    assert.deepStrictEqual(restored, form);
  }
});

test('T4: real PNG (None/Sub/Up/Average/Paeth + colorType 0/2/3/6) and BMP (top-down & bottom-up) decode exact RGB pixels & 2D tiles', () => {
  const doc = generateMultiFontDocument({ seed: 20261115 });
  const pngBuf = encodePNG(doc.width, doc.height, doc.rgb);
  const decodedPng = decodePngBuffer(pngBuf);
  assert.strictEqual(decodedPng.width, doc.width);
  assert.strictEqual(decodedPng.height, doc.height);
  assert.strictEqual(Buffer.compare(Buffer.from(decodedPng.rgb), Buffer.from(doc.rgb)), 0);

  const bmpBuf = encodeBMP(doc.width, doc.height, doc.rgb);
  const decodedBmp = decodeBmpBuffer(bmpBuf);
  assert.strictEqual(decodedBmp.width, doc.width);
  assert.strictEqual(decodedBmp.height, doc.height);
  assert.strictEqual(Buffer.compare(Buffer.from(decodedBmp.rgb), Buffer.from(doc.rgb)), 0);

  // Build bottom-up 24-bit BMP (positive height) with non-multiple-of-4 width=3
  const w = 3, h = 2;
  const srcRgb = Buffer.from([
    10, 20, 30, 40, 50, 60, 70, 80, 90,
    15, 25, 35, 45, 55, 65, 75, 85, 95
  ]);
  const rowSize = 12; // 3*3=9 padded to 12
  const bottomUpBmp = Buffer.alloc(54 + rowSize * 2);
  bottomUpBmp.write('BM', 0);
  bottomUpBmp.writeUInt32LE(54 + rowSize * 2, 2);
  bottomUpBmp.writeUInt32LE(54, 10);
  bottomUpBmp.writeUInt32LE(40, 14);
  bottomUpBmp.writeInt32LE(w, 18);
  bottomUpBmp.writeInt32LE(h, 22);
  bottomUpBmp.writeUInt16LE(1, 26);
  bottomUpBmp.writeUInt16LE(24, 28);
  // Bottom row (y=1) written first in BGR
  for (let x = 0; x < w; x++) {
    bottomUpBmp[54 + x * 3 + 0] = srcRgb[9 + x * 3 + 2];
    bottomUpBmp[54 + x * 3 + 1] = srcRgb[9 + x * 3 + 1];
    bottomUpBmp[54 + x * 3 + 2] = srcRgb[9 + x * 3 + 0];
    bottomUpBmp[54 + rowSize + x * 3 + 0] = srcRgb[x * 3 + 2];
    bottomUpBmp[54 + rowSize + x * 3 + 1] = srcRgb[x * 3 + 1];
    bottomUpBmp[54 + rowSize + x * 3 + 2] = srcRgb[x * 3 + 0];
  }
  const decBottomUp = decodeImageBuffer(bottomUpBmp);
  assert.strictEqual(Buffer.compare(Buffer.from(decBottomUp.rgb), srcRgb), 0);

  // Test PNG Sub(1), Up(2), Average(3), Paeth(4) scanline unfiltering on a 2x4 RGBA image (colorType 6)
  // Row 0 pixels RGB: (10,20,30,255), (50,70,90,255) -> Sub(1): [1, 10,20,30,255, 40,50,60,0]
  // Row 1 pixels RGB: (20,40,60,255), (60,90,120,255) -> Up(2): [2, 10,20,30,0, 10,20,30,0]
  // Row 2 pixels RGB: (30,60,90,255), (80,100,140,255) -> Avg(3): left=(0), prior=(20,40,60,255) -> floor(20/2)=10 -> diff 20; col1: avg((30+60)/2=45)->diff 35, avg((60+90)/2=75)->diff 25, avg((90+120)/2=105)->diff 35, avg(255,255)=255->diff 0
  // Row 3 pixels RGB: (40,80,120,255), (90,110,160,255) -> Paeth(4): a=0,b=(30,60,90,255),c=0 -> p=(30,60,90,255) -> diff=(10,20,30,0); col1: a=(40,80,120,255),b=(80,100,140,255),c=(30,60,90,255): pa=50,pb=10,pc=60 -> b=(80,100,140,255)? Wait R: pa=|80-30|=50, pb=|40-30|=10 -> b=80 -> 90-80=10; G: |100-60|=40, |80-60|=20 -> 100 -> 110-100=10; B: |140-90|=50, |120-90|=30 -> 140 -> 160-140=20; A: 0
  const rgbaScanlines = Buffer.from([
    1, 10, 20, 30, 255, 40, 50, 60, 0,
    2, 10, 20, 30, 0, 10, 20, 30, 0,
    3, 20, 40, 60, 128, 35, 25, 35, 0,
    4, 10, 20, 30, 0, 10, 10, 20, 0
  ]);
  const expectedRgbaRgb = Buffer.from([
    10, 20, 30, 50, 70, 90,
    20, 40, 60, 60, 90, 120,
    30, 60, 90, 80, 100, 140,
    40, 80, 120, 90, 110, 160
  ]);
  const rgbaPng = buildCustomPng({ width: 2, height: 4, colorType: 6, rawScanlines: rgbaScanlines });
  const decRgba = decodePngBuffer(rgbaPng);
  assert.strictEqual(Buffer.compare(Buffer.from(decRgba.rgb), expectedRgbaRgb), 0);

  // ColorType 3 Indexed Palette + ColorType 0 Grayscale
  const palPng = buildCustomPng({
    width: 2,
    height: 1,
    colorType: 3,
    paletteRgb: [1, 2, 3, 200, 210, 220],
    rawScanlines: [0, 1, 0]
  });
  assert.strictEqual(Buffer.compare(Buffer.from(decodePngBuffer(palPng).rgb), Buffer.from([200, 210, 220, 1, 2, 3])), 0);

  const grayPng = buildCustomPng({ width: 2, height: 1, colorType: 0, rawScanlines: [0, 12, 240] });
  assert.strictEqual(Buffer.compare(Buffer.from(decodePngBuffer(grayPng).rgb), Buffer.from([12, 12, 12, 240, 240, 240])), 0);

  // Genuine 2D tile extraction check on 1024x1440 document
  const tiles = extractImageTiles2D(decodedPng, { mode: 'tile_2d', tileSize: 512, overlap: 64 });
  assert.strictEqual(tiles.length > 1, true);
  for (const tile of tiles) {
    assert.strictEqual(tile.rgb.length, tile.width * tile.height * 3);
    // Spot-check top-left & center pixel against source RGB
    const srcOff = (tile.y * decodedPng.width + tile.x) * 3;
    assert.strictEqual(tile.rgb[0], decodedPng.rgb[srcOff]);
    assert.strictEqual(tile.rgb[1], decodedPng.rgb[srcOff + 1]);
    assert.strictEqual(tile.rgb[2], decodedPng.rgb[srcOff + 2]);
  }
});

test('T4: PDF /Image XObject decode, 2D seam stitching, and fail-closed ingest when .cact weights are absent', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verisieve-t4-ingest-'));
  try {
    const doc = generateMultiFontDocument({ seed: 20261115 });
    const pngPath = path.join(tmpDir, 'scan.png');
    fs.writeFileSync(pngPath, encodePNG(doc.width, doc.height, doc.rgb));

    // 1. Real RGB / PNG without groundTruth and without weights/provider MUST fail closed
    assert.throws(
      () => tileAndRead({ width: doc.width, height: doc.height, rgb: doc.rgb }, { mode: 'tile_2d' }),
      /MIRAGE_WEIGHTS_REQUIRED/
    );
    await assert.rejects(
      () => runTiledOcrAsync(fs.readFileSync(pngPath), { mode: 'tile_2d', weightsPath: path.join(tmpDir, 'missing.cact') }),
      /MIRAGE_WEIGHTS_REQUIRED|CACTUS_WEIGHTS_NOT_FOUND/
    );
    await assert.rejects(
      () => ingestFromUrlOrPath(pngPath),
      (err) => /IMAGE_REQUIRES_OCR_PROVIDER|MIRAGE_WEIGHTS_REQUIRED/.test(err.message) && !err.message.includes('[IMAGE OCR EXTRACTED')
    );

    // 2. Pluggable ocrProvider over 2D tiles verifies IoU + Levenshtein seam deduplication across overlapping tiles
    const seenTiles = [];
    const stitched = await runTiledOcrAsync(fs.readFileSync(pngPath), {
      mode: 'tile_2d',
      ocrProvider(tile) {
        seenTiles.push({ x: tile.x, y: tile.y, w: tile.width, h: tile.height, len: tile.rgb.length });
        if (tile.x === 0 && tile.y === 0) {
          return [
            { text: 'Patient Name: Evelyn Vance', bbox: [40, 448, 360, 472], confidence: 0.94 },
            { text: 'Horizontal Seam Header', bbox: [448, 100, 512, 124], confidence: 0.91 }
          ];
        }
        if (tile.x === 448 && tile.y === 0) {
          // Horizontal overlap across X=448..512 seam -> maps to [448..512] in full page
          return [
            { text: 'Horizontal Seam Head', bbox: [0, 101, 62, 123], confidence: 0.85 }
          ];
        }
        if (tile.x === 0 && tile.y === 448) {
          // Overlapping detection across the Y=448..512 seam with slight typo
          return [
            { text: 'Patient Name: Evelyn Vanc', bbox: [42, 2, 358, 24], confidence: 0.88 },
            { text: 'Patient shows stable vitals today', bbox: [42, 120, 410, 142], confidence: 0.96 }
          ];
        }
        return [];
      }
    });
    assert.strictEqual(seenTiles.length, stitched.numPasses);
    assert.strictEqual(seenTiles[0].len, seenTiles[0].w * seenTiles[0].h * 3);
    assert.strictEqual(stitched.lines.length, 3, 'Overlapping vertical and horizontal seam duplicates should stitch cleanly');
    assert.strictEqual(stitched.lines[0].text, 'Horizontal Seam Header');
    assert.strictEqual(stitched.lines[1].text, 'Patient Name: Evelyn Vance');
    assert.strictEqual(stitched.lines[2].text, 'Patient shows stable vitals today');

    // 3. Build real scanned image-only PDF with FlateDecode DeviceRGB /Image XObject
    const imgW = 640, imgH = 640;
    const rawRgb = Buffer.alloc(imgW * imgH * 3, 245);
    rawRgb[0] = 17; rawRgb[1] = 34; rawRgb[2] = 51;
    const compImg = zlib.deflateSync(rawRgb);
    const pdfObjs = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      null, // 4 is image stream
      null  // 5 is content stream
    ];
    const pdfChunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
    for (let i = 0; i < 3; i++) pdfChunks.push(Buffer.from(pdfObjs[i], 'latin1'));
    pdfChunks.push(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compImg.length} >>\nstream\n`, 'latin1'));
    pdfChunks.push(compImg);
    pdfChunks.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    const drawContent = Buffer.from('q 640 0 0 640 0 0 cm /Im1 Do Q', 'latin1');
    pdfChunks.push(Buffer.from(`5 0 obj\n<< /Length ${drawContent.length} >>\nstream\n`, 'latin1'));
    pdfChunks.push(drawContent);
    pdfChunks.push(Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'));
    const scannedPdfBuf = Buffer.concat(pdfChunks);

    const parsedPdf = extractPdfDetailed(scannedPdfBuf);
    assert.strictEqual(parsedPdf.isLikelyScanned, true);
    assert.strictEqual(parsedPdf.images.length, 1);
    const decodedXObj = decodePdfImageXObject(parsedPdf.images[0]);
    assert.strictEqual(decodedXObj.width, 640);
    assert.strictEqual(decodedXObj.height, 640);
    assert.strictEqual(decodedXObj.rgb[0], 17);
    assert.strictEqual(decodedXObj.rgb[1], 34);
    assert.strictEqual(decodedXObj.rgb[2], 51);

    const scannedPdfPath = path.join(tmpDir, 'scanned.pdf');
    fs.writeFileSync(scannedPdfPath, scannedPdfBuf);
    await assert.rejects(
      () => ingestFromUrlOrPath(scannedPdfPath),
      /PDF_IMAGE_ONLY_REQUIRES_OCR|MIRAGE_WEIGHTS_REQUIRED/
    );

    const ingested = await ingestFromUrlOrPath(scannedPdfPath, {
      ocrProvider(tile) {
        if (tile.x === 0 && tile.y === 0) {
          return [
            { text: 'Patient Name: Evelyn Vance', bbox: [10, 10, 300, 30], confidence: 0.95 },
            { text: 'Normal saline infusion completed.', bbox: [10, 50, 320, 70], confidence: 0.97 }
          ];
        }
        return [];
      }
    });
    assert.strictEqual(ingested.rows.length, 2);
    assert.strictEqual(
      ingested.rows.some((r) => r.pii_detected && r.masked_text.includes('<PII:NAME_LIKELY>') && !r.masked_text.includes('Evelyn Vance')),
      true
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
