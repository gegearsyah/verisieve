#!/usr/bin/env node
/**
 * scripts/ui-server.mjs
 * Lightweight zero-dependency HTTP UI server for VeriSieve.
 * Serves demo/index.html, results/, docs/, and provides /api/run and /api/mcp endpoints.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ingestFromUrlOrPath } from '../src/pdf-image-pipeline.js';
import { handleJsonRpcRequest } from '../src/mcp-server.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3333;
const ROOT_DIR = path.resolve('.');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 20 * 1024 * 1024) { // 20 MB cap
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API 1: POST /api/run (Universal Ingest & Gatekeeper Runner)
  if (req.method === 'POST' && pathname === '/api/run') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const { input, mode, piiStrategy, alpha, maxSeqLen } = payload;

      let target = input;
      // If client sent raw text content or data URL, save to temp untrusted file
      if (typeof input === 'string' && input.startsWith('data:')) {
        const untrustedDir = path.resolve('results/untrusted-benchmarks');
        fs.mkdirSync(untrustedDir, { recursive: true });
        const matches = input.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1].includes('pdf') ? '.pdf' : (matches[1].includes('png') ? '.png' : '.txt');
          const tmpPath = path.join(untrustedDir, `upload-${Date.now()}${ext}`);
          fs.writeFileSync(tmpPath, Buffer.from(matches[2], 'base64'));
          target = tmpPath;
        }
      } else if (!target) {
        // Fallback to real PMC paper
        target = 'C:/Users/GEYE ARDIANSYAH/Downloads/Innovation Hub/Health-Research/references/papers/miu_2017_PMC5773420.pdf';
      }

      const result = await ingestFromUrlOrPath(target, {
        mode: mode || 'auto',
        piiStrategy: piiStrategy || 'token',
        alpha: alpha !== undefined ? parseFloat(alpha) : 0.05,
        maxSeqLen: maxSeqLen ? parseInt(maxSeqLen, 10) : 256
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // API 2: POST /api/mcp (JSON-RPC 2.0 Endpoint)
  if (req.method === 'POST' && pathname === '/api/mcp') {
    try {
      const raw = await readBody(req);
      const jsonRpcReq = raw ? JSON.parse(raw) : {};
      const jsonRpcRes = handleJsonRpcRequest(jsonRpcReq);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jsonRpcRes));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }));
    }
    return;
  }

  // API 3: GET /api/mcp/tools
  if (req.method === 'GET' && pathname === '/api/mcp/tools') {
    const listRes = handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listRes.result?.tools || []));
    return;
  }

  // Static File Serving
  let relativePath = pathname === '/' ? 'demo/index.html' : pathname.replace(/^\//, '');
  let filePath = path.resolve(ROOT_DIR, relativePath);

  // Security check: stay within ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // Try fallback to demo/index.html
    const fallbackPath = path.resolve(ROOT_DIR, 'demo/index.html');
    if (fs.existsSync(fallbackPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(fallbackPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`========================================================================`);
  console.log(`  VERISIEVE — INTERACTIVE GATEKEEPER UI & MCP SERVER READY             `);
  console.log(`========================================================================`);
  console.log(`  Local UI URL:        http://localhost:${PORT}`);
  console.log(`  Run Pipeline API:    POST http://localhost:${PORT}/api/run`);
  console.log(`  MCP Server API:      POST http://localhost:${PORT}/api/mcp`);
  console.log(`  MCP Tools List:      GET  http://localhost:${PORT}/api/mcp/tools`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`  Press Ctrl+C to stop the server.`);
  console.log(`========================================================================\n`);
});

export { server, PORT };
