import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { encodePNG } from '../src/multi-font-fixture.js';

function createMinimalDocxBuffer(text) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const nameBuf = Buffer.from('word/document.xml', 'utf8');
  const rawBuf = Buffer.from(xml, 'utf8');
  const compBuf = zlib.deflateRawSync(rawBuf);
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt32LE(compBuf.length, 18);
  lfh.writeUInt32LE(rawBuf.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(lfh, 30);
  const cdh = Buffer.alloc(46 + nameBuf.length);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt32LE(compBuf.length, 20);
  cdh.writeUInt32LE(rawBuf.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  nameBuf.copy(cdh, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(lfh.length + compBuf.length, 16);
  return Buffer.concat([lfh, compBuf, cdh, eocd]);
}

function createMinimalPdfBuffer(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = 'BT\n/F1 12 Tf\n72 720 Td\n' + lines.map((l) => `(${esc(l)}) Tj\n0 -16 Td`).join('\n') + '\nET';
  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj\n`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [0];
  for (const o of objs) {
    offs.push(Buffer.byteLength(out, 'utf8'));
    out += o;
  }
  const xrefPos = Buffer.byteLength(out, 'utf8');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    out += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, 'utf8');
}

function startUiServer(port) {
  const child = spawn(process.execPath, [path.resolve('scripts/ui-server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });

  const waitForReady = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        if (res.status > 0) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`UI server failed to become ready on 127.0.0.1:${port}: ${logs}`);
  };

  return { child, waitForReady, getLogs: () => logs };
}

test('T8: ui-server enforces 127.0.0.1 loopback bind, no wildcard CORS, path.relative containment, 404, async MCP, and safe filesystem limits', async () => {
  const src = fs.readFileSync(path.resolve('scripts/ui-server.mjs'), 'utf8');
  assert.doesNotMatch(src, /Access-Control-Allow-Origin['"],\s*['"]\*['"]/);
  assert.doesNotMatch(src, /C:[\\\/]Users[\\\/]GEYE/i);
  assert.doesNotMatch(src, /D:[\\\/]+Ollama/i);
  assert.doesNotMatch(src, /function\s+runJsSqlFallback/);
  assert.match(src, /const\s+HOST\s*=\s*['"]127\.0\.0\.1['"]/);
  assert.match(src, /server\.listen\([^,]+,\s*(?:HOST|['"]127\.0\.0\.1['"])/);
  assert.match(src, /await\s+handleJsonRpcRequest\(/);
  assert.match(src, /path\.relative\(/);

  const port = 3481;
  const { child, waitForReady } = startUiServer(port);
  try {
    await waitForReady();

    // 1. Cross-origin request must not receive wildcard CORS and untrusted POST must be rejected
    const optRes = await fetch(`http://127.0.0.1:${port}/api/duckdb`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.notEqual(optRes.headers.get('access-control-allow-origin'), '*');

    const evilPost = await fetch(`http://127.0.0.1:${port}/api/duckdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ sql: 'SELECT count(*) AS n FROM documents;' }),
    });
    assert.equal(evilPost.status, 403);

    // 2. Static path traversal and missing file return 403 / 404 (not 200 demo/index.html fallback)
    const missingRes = await fetch(`http://127.0.0.1:${port}/results/nonexistent-missing-asset-xyz.json`);
    assert.equal(missingRes.status, 404);

    const srcProbe = await fetch(`http://127.0.0.1:${port}/src/gatekeeper.js`);
    assert.equal(srcProbe.status, 403);

    // 3. /api/mcp must properly await async JSON-RPC handler
    const mcpRes = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 77,
        method: 'tools/call',
        params: {
          name: 'ingest_url_or_links',
          arguments: { input: 'http://127.0.0.1:8080/secret' },
        },
      }),
    });
    assert.equal(mcpRes.status, 200);
    const mcpData = await mcpRes.json();
    assert.equal(mcpData.id, 77);
    assert.ok(mcpData.result || mcpData.error, 'Async MCP response must not collapse to empty {}');

    // 4. /api/run rejects empty input & out-of-workspace traversal paths
    const emptyRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(emptyRun.status, 400);

    const traversalRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '../../etc/passwd' }),
    });
    assert.equal(traversalRun.status, 403);

    // 5. /api/run processes inline prose, born-digital PDF, and fails closed on PNG without .cact weights
    const textRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Clinical contrast telemetry achieved 1e-9.\nPatient email test@example.invalid phone (415) 555-0192.',
        mode: 'auto',
        piiStrategy: 'token',
        alpha: 0.05,
        maxSeqLen: 128,
      }),
    });
    assert.equal(textRun.status, 200);
    const textJson = await textRun.json();
    assert.equal(textJson.ok, true);
    assert.ok(Array.isArray(textJson.rows) && textJson.rows.length >= 2);
    assert.ok(textJson.stats && typeof textJson.stats.total_lines === 'number');

    const pdfBuf = createMinimalPdfBuffer([
      'Adaptive optics loop achieved 2 kHz bandwidth.',
      'Project ID 800-555-0142 verified safely.',
    ]);
    const pdfRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: `data:application/pdf;base64,${pdfBuf.toString('base64')}`,
        filename: 'sample.pdf',
      }),
    });
    assert.equal(pdfRun.status, 200);
    const pdfJson = await pdfRun.json();
    assert.equal(pdfJson.ok, true);
    assert.ok(pdfJson.rows.length >= 2);

    const rgb = Buffer.alloc(16 * 16 * 3, 255);
    const pngBuf = encodePNG(16, 16, rgb);
    const pngRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: `data:image/png;base64,${pngBuf.toString('base64')}`,
        filename: 'scan.png',
      }),
    });
    assert.ok(pngRun.status >= 400);
    const pngJson = await pngRun.json();
    assert.equal(pngJson.ok, false);
    assert.match(pngJson.error, /MIRAGE_WEIGHTS_REQUIRED|IMAGE_REQUIRES_OCR_PROVIDER/);

    // 5b. HTML and DOCX uploads route through real ingest cleanly
    const htmlBuf = Buffer.from('<html><body><script>bad()</script><p>Adaptive optics telemetry line alpha beta.</p></body></html>', 'utf8');
    const htmlRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: `data:text/html;base64,${htmlBuf.toString('base64')}`,
        filename: 'report.html',
      }),
    });
    assert.equal(htmlRun.status, 200);
    const htmlJson = await htmlRun.json();
    assert.equal(htmlJson.ok, true);
    assert.ok(htmlJson.rows.some((r) => (r.masked_text || r.raw_excerpt || '').includes('Adaptive optics')));

    const docxBuf = createMinimalDocxBuffer('Cryogenic detector readout noise measured below 3 electrons.');
    const docxRun = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docxBuf.toString('base64')}`,
        filename: 'brief.docx',
      }),
    });
    assert.equal(docxRun.status, 200);
    const docxJson = await docxRun.json();
    assert.equal(docxJson.ok, true);
    assert.ok(docxJson.rows.length >= 1);

    // 5c. /api/duckdb error semantics, /api/needle-search strings (no [object Object]), and /api/chat-ab live WASM
    const badSqlRes = await fetch(`http://127.0.0.1:${port}/api/duckdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT * FROM documents; DROP TABLE documents;' }),
    });
    assert.equal(badSqlRes.status, 400);
    const badSqlJson = await badSqlRes.json();
    assert.equal(badSqlJson.ok, false);
    assert.doesNotMatch(badSqlJson.engine, /DuckDB\s+v1\.5\.5/i);

    const needleRes = await fetch(`http://127.0.0.1:${port}/api/needle-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hip fracture recovery', topK: 3 }),
    });
    assert.equal(needleRes.status, 200);
    const needleJson = await needleRes.json();
    assert.equal(needleJson.ok, true);
    assert.ok(needleJson.results.every((r) => typeof r.text === 'string' && !r.text.includes('[object Object]')));

    const abRes = await fetch(`http://127.0.0.1:${port}/api/chat-ab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'What Grant ID 800-555-0199 and Kernel v10.24.108.3 were used?' }),
    });
    assert.equal(abRes.status, 200);
    const abJson = await abRes.json();
    assert.equal(abJson.ok, true);
    assert.ok(typeof abJson.telemetry?.tokPerSec === 'number' && abJson.telemetry.tokPerSec > 0);

    // 6. /api/inspect-weights rejects arbitrary system files and defaults cleanly without D:\Ollama
    const badInspect = await fetch(`http://127.0.0.1:${port}/api/inspect-weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath: 'package.json' }),
    });
    assert.equal(badInspect.status, 403);
  } finally {
    child.kill();
  }
});

test('T8: demo/index.html parses with zero JS SyntaxErrors, removes node imports & mocks, and prevents DOM XSS', () => {
  const html = fs.readFileSync(path.resolve('demo/index.html'), 'utf8');
  const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scriptMatches.length >= 1, 'demo/index.html must contain module script');

  for (const m of scriptMatches) {
    const code = m[1];
    assert.doesNotMatch(code, /\.\.\/src\//, 'Browser demo must not import Node-dependent files from ../src/');
    assert.doesNotMatch(code, /node:(fs|path|crypto)/, 'Browser demo must not reference node:* builtins');

    // Full ESM syntax check via node --check
    const tmpMjs = path.join(os.tmpdir(), `verisieve-demo-check-${Date.now()}.mjs`);
    fs.writeFileSync(tmpMjs, code, 'utf8');
    try {
      const checkRes = spawnSync(process.execPath, ['--check', tmpMjs], { encoding: 'utf8' });
      assert.equal(checkRes.status, 0, `demo script failed syntax check: ${checkRes.stderr}`);
    } finally {
      fs.rmSync(tmpMjs, { force: true });
    }

    // vm.Script check after stripping static import declarations
    const strippedForVm = code.replace(/^\s*import\s+[\s\S]*?;\s*$/gm, '');
    assert.doesNotThrow(() => new vm.Script(strippedForVm, { filename: 'demo-inline.js' }));
  }

  // Must remove silent mocks & hardcoded personal/legacy artifacts
  assert.doesNotMatch(html, /D:\\+Ollama/i);
  assert.doesNotMatch(html, /DuckDB\s+v1\.5\.5/i);
  assert.doesNotMatch(html, /Simulated\s+document\s+capture\s+fallback/i);
  assert.doesNotMatch(html, /simulated-scan\.png/i);
  assert.doesNotMatch(html, /function\s+renderAbChatFallback/);
  assert.doesNotMatch(html, /Hospital Wong Tai Sin, Hong Kong\.\s*miuky@ha\.org\.hk/);

  // Must not build dynamic HTML strings via unescaped innerHTML
  assert.doesNotMatch(html, /alert[123]\.innerHTML\s*=/);
  assert.doesNotMatch(html, /tr\.innerHTML\s*=/);
  assert.doesNotMatch(html, /card\.innerHTML\s*=/);
  assert.doesNotMatch(html, /valPplVal.*innerHTML\s*=/);
  assert.doesNotMatch(html, /piiLeakVal.*innerHTML\s*=/);
  assert.doesNotMatch(html, /needlePurityVal.*innerHTML\s*=/);
});
