import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalTesseractOcrProvider, encodeRgbAsBmp } from '../src/local-tesseract-ocr.js';
import { ingestFromUrlOrPath } from '../src/pdf-image-pipeline.js';
import { runTiledOcrAsync } from '../src/ocr-engine.js';

test('encodeRgbAsBmp writes padded bottom-up BGR rows', () => {
  const bmp = encodeRgbAsBmp({
    width: 1,
    height: 2,
    rgb: Uint8Array.from([255, 0, 0, 0, 255, 0]),
  });

  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.equal(bmp.readUInt32LE(2), bmp.length);
  assert.equal(bmp.readInt32LE(18), 1);
  assert.equal(bmp.readInt32LE(22), 2);
  assert.deepEqual([...bmp.subarray(54, 58)], [0, 255, 0, 0]);
  assert.deepEqual([...bmp.subarray(58, 62)], [0, 0, 255, 0]);
});

test('encodeRgbAsBmp rejects malformed RGB input', () => {
  assert.throws(
    () => encodeRgbAsBmp({ width: 2, height: 2, rgb: new Uint8Array(3) }),
    /INVALID_RGB_IMAGE/
  );
});

test('local Tesseract provider recognizes an image without remote assets', async () => {
  const provider = createLocalTesseractOcrProvider();
  try {
    const output = await provider({
      width: 32,
      height: 32,
      rgb: new Uint8Array(32 * 32 * 3).fill(255),
    });
    assert.equal(output, '');
  } finally {
    await provider.close();
  }
});

test('full-image OCR providers avoid noisy 2D tiling for page-sized images', async () => {
  const image = encodeRgbAsBmp({
    width: 1200,
    height: 800,
    rgb: new Uint8Array(1200 * 800 * 3).fill(255),
  });
  let fullImageCalls = 0;
  let tileCalls = 0;
  const ocrProvider = async () => {
    tileCalls += 1;
    return 'TILE_PATH';
  };
  ocrProvider.recognizeImage = async () => {
    fullImageCalls += 1;
    return [{ text: 'FULL_IMAGE_TEXT', bbox: [8, 12, 100, 32], confidence: 0.96 }];
  };

  const result = await runTiledOcrAsync(image, { ocrProvider });

  assert.equal(fullImageCalls, 1);
  assert.equal(tileCalls, 0);
  assert.equal(result.mode, 'full_image');
  assert.equal(result.numPasses, 1);
  assert.equal(result.lines[0].text, 'FULL_IMAGE_TEXT');
  assert.deepEqual(result.lines[0].bbox, [8, 12, 100, 32]);
});

test('directory ingestion recursively OCRs local images through the configured provider', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verisieve-local-ocr-'));
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(
    path.join(nested, 'scan.bmp'),
    encodeRgbAsBmp({ width: 2, height: 2, rgb: new Uint8Array(12).fill(255) })
  );

  try {
    const result = await ingestFromUrlOrPath(root, {
      ocrProvider: async () => 'NESTED_SCAN_TEXT',
      includeRawExcerpt: true,
    });
    assert.ok(result.rows.some((row) => row.raw_excerpt === 'NESTED_SCAN_TEXT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
