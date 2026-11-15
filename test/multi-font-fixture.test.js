import test from 'node:test';
import assert from 'node:assert';
import {
  mulberry32,
  FONT_STYLES,
  renderGlyphBitmap,
  encodeBMP,
  encodePNG,
  generateMultiFontDocument,
  applyScanDegradations,
  getBornDigitalCorpus
} from '../src/multi-font-fixture.js';

test('mulberry32 PRNG determinism', () => {
  const rng1 = mulberry32(12345);
  const rng2 = mulberry32(12345);
  assert.strictEqual(rng1(), rng2());
  assert.strictEqual(rng1(), rng2());
});

test('generateMultiFontDocument determinism and seed variation', () => {
  const doc1 = generateMultiFontDocument({ seed: 20261115 });
  const doc2 = generateMultiFontDocument({ seed: 20261115 });
  const doc3 = generateMultiFontDocument({ seed: 99999999 });

  assert.strictEqual(doc1.sha256, doc2.sha256);
  assert.deepStrictEqual(doc1.rgb, doc2.rgb);
  assert.notStrictEqual(doc1.sha256, doc3.sha256);
});

test('all 5 font styles are present and rendered with ink pixels in precise bboxes', () => {
  const doc = generateMultiFontDocument({ seed: 20261115 });
  const presentStyles = new Set(doc.groundTruth.lines.map(l => l.fontStyle));

  for (const style of FONT_STYLES) {
    assert.strictEqual(presentStyles.has(style), true, `Font style ${style} should be present`);
  }

  for (const line of doc.groundTruth.lines) {
    const [x1, y1, x2, y2] = line.bbox;
    assert.strictEqual(x1 >= 0 && y1 >= 0 && x2 < doc.width && y2 < doc.height, true);
    
    let inkPixelFound = false;
    for (let y = y1; y <= y2 && !inkPixelFound; y++) {
      for (let x = x1; x <= x2 && !inkPixelFound; x++) {
        const idx = (y * doc.width + x) * 3;
        if (doc.rgb[idx] !== 250 || doc.rgb[idx+1] !== 250 || doc.rgb[idx+2] !== 248) {
          inkPixelFound = true;
        }
      }
    }
    assert.strictEqual(inkPixelFound, true, `Line "${line.text}" (${line.fontStyle}) should have ink pixels inside tight bbox [${x1},${y1},${x2},${y2}]`);
  }

  // Also verify PII items bboxes have ink pixels
  for (const pii of doc.groundTruth.piiManifest) {
    const [x1, y1, x2, y2] = pii.bbox;
    let inkPixelFound = false;
    for (let y = y1; y <= y2 && !inkPixelFound; y++) {
      for (let x = x1; x <= x2 && !inkPixelFound; x++) {
        const idx = (y * doc.width + x) * 3;
        if (doc.rgb[idx] !== 250 || doc.rgb[idx+1] !== 250 || doc.rgb[idx+2] !== 248) {
          inkPixelFound = true;
        }
      }
    }
    assert.strictEqual(inkPixelFound, true, `PII item "${pii.value}" should have ink pixels inside its bbox`);
  }
});

test('applyScanDegradations returns degraded RGB and valid sha256', () => {
  const doc = generateMultiFontDocument({ seed: 20261115 });
  const degraded = applyScanDegradations(doc.rgb, doc.width, doc.height, { seed: 42, skewDeg: 1.0, noiseStd: 10, blockQuant: 8 });
  assert.strictEqual(Buffer.isBuffer(degraded.rgb), true);
  assert.strictEqual(typeof degraded.sha256, 'string');
  assert.strictEqual(degraded.sha256.length, 64);
  assert.notStrictEqual(degraded.sha256, doc.sha256);
});

test('getBornDigitalCorpus returns rich documents with lookalikes and labels', () => {
  const corpus = getBornDigitalCorpus();
  assert.strictEqual(Array.isArray(corpus), true);
  assert.strictEqual(corpus.length >= 5, true);

  const lookalikes = corpus.filter(doc => doc.isHardLookalike);
  assert.strictEqual(lookalikes.length >= 1, true);
  assert.strictEqual(lookalikes[0].groundTruthLabel, 1);
});

test('all 8 PII categories are present in piiManifest', () => {
  const doc = generateMultiFontDocument({ seed: 20261115 });
  const expectedCategories = [
    'email',
    'phone',
    'ssn',
    'credit_card',
    'ip_address',
    'date_of_birth',
    'name_likely',
    'address_likely'
  ];

  const foundCategories = new Set(doc.groundTruth.piiManifest.map(p => p.type));
  for (const cat of expectedCategories) {
    assert.strictEqual(foundCategories.has(cat), true, `PII category ${cat} must be present in piiManifest`);
  }
});

test('routingLabels cover keep_safe, quarantine_pii, and drop_boilerplate', () => {
  const doc = generateMultiFontDocument({ seed: 20261115 });
  const routingLabels = new Set(doc.groundTruth.lines.map(l => l.routingLabel));

  assert.strictEqual(routingLabels.has('keep_safe'), true);
  assert.strictEqual(routingLabels.has('quarantine_pii'), true);
  assert.strictEqual(routingLabels.has('drop_boilerplate'), true);
});

test('encodeBMP and encodePNG produce valid buffers', () => {
  const width = 100;
  const height = 100;
  const rgb = Buffer.alloc(width * height * 3, 255);

  const bmpBuf = encodeBMP(width, height, rgb);
  assert.strictEqual(bmpBuf.toString('ascii', 0, 2), 'BM');
  assert.strictEqual(bmpBuf.length > 54, true);

  const pngBuf = encodePNG(width, height, rgb);
  assert.strictEqual(pngBuf[0], 137);
  assert.strictEqual(pngBuf[1], 80);
  assert.strictEqual(pngBuf[2], 78);
  assert.strictEqual(pngBuf[3], 71);
  assert.strictEqual(pngBuf.length > 33, true);
});
