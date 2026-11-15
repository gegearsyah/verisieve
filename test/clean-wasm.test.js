import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCleanWasm, loadCleanWasmSync } from '../src/clean-wasm.js';
import { runCleanAndTokenizePipeline } from '../src/clean-and-tokenize.js';

const WASM_PATH = path.resolve(process.cwd(), 'vendor/wasm/verisieve_clean.wasm');

test('matilda-portable loads identical verisieve_clean.wasm for boilerplate strip, dedup, and chunking', async () => {
  assert.ok(fs.existsSync(WASM_PATH), `Expected synced WASM at ${WASM_PATH}`);
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const mod = await WebAssembly.compile(wasmBytes);
  assert.equal(WebAssembly.Module.imports(mod).length, 0);

  const syncEngine = loadCleanWasmSync();
  const asyncEngine = await loadCleanWasm(wasmBytes);
  assert.equal(syncEngine.abiVersion, 1);
  assert.equal(asyncEngine.abiVersion, 1);

  const html = '<nav>Skip to main content | Log in</nav><article><p>Local-first telemetry keeps patient records offline.</p></article><footer>Privacy Policy · All rights reserved</footer>';
  const cleaned = syncEngine.stripBoilerplate(html, { html: true, stripChrome: true });
  assert.ok(cleaned.includes('Local-first telemetry keeps patient records offline.'));
  assert.ok(!cleaned.includes('Skip to main content'));
  assert.ok(!cleaned.includes('All rights reserved'));

  const result = runCleanAndTokenizePipeline(
    [
      'Cookie preferences | Accept all cookies',
      'Cohort A completed ambulatory blood pressure monitoring with Dr. Sam Patel at sam.patel@clinic.org.',
      'Cohort A completed ambulatory blood pressure monitoring with Dr. Sam Patel at sam.patel@clinic.org.',
      '© 2026 Clinic Network. All rights reserved.',
    ].join('\n'),
    { format: 'text', maxSeqLen: 120, chunkByTokenWindow: true }
  );

  assert.ok(result.wasmCleanActive === true, 'Pipeline must report wasmCleanActive=true');
  assert.ok(result.blocks.length >= 1);
  assert.ok(result.blocks.every(b => !b.text.includes('sam.patel@clinic.org')));
  assert.ok(!result.blocks.some(b => /Cookie preferences|All rights reserved/i.test(b.text)));
});
