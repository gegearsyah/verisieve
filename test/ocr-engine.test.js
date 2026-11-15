import test from 'node:test';
import assert from 'node:assert';
import { generateMultiFontDocument, applyScanDegradations } from '../src/multi-font-fixture.js';
import {
  auditCactusWasmArtifact,
  sanitizeMirageFormSchema,
  restoreMirageFormOutput,
  computeCanvasScaleGeometry,
  levenshteinSimilarity,
  tileAndRead
} from '../src/ocr-engine.js';

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
