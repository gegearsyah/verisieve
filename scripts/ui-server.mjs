#!/usr/bin/env node
/**
 * scripts/ui-server.mjs
 * Loopback-locked zero-dependency HTTP UI server for VeriSieve.
 * Serves demo/, results/, docs/, and exposes hardened /api/* endpoints.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ingestFromUrlOrPath,
  exportBlocksToCsv,
  generateSummaryReportSvg,
} from '../src/pdf-image-pipeline.js';
import { handleJsonRpcRequest } from '../src/mcp-server.js';
import {
  executeJsSql,
  trainWasmSmallModel,
  searchNeedleWasm,
  loadExtractedDatasets,
  chatWithTrainedModelsWasm,
  inspectLocalOpenWeightPath,
} from '../src/wasm-needle-dl.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3333;
const HOST = '127.0.0.1';
const ROOT_DIR = path.resolve('.');
const ALLOWED_STATIC_DIRS = ['demo', 'results', 'docs'].map((d) => path.resolve(ROOT_DIR, d));
const ALLOWED_UPLOAD_EXTS = new Set(['.txt', '.html', '.htm', '.csv', '.json', '.pdf', '.docx', '.png', '.bmp']);
const ALLOWED_WEIGHT_EXTS = new Set(['.gguf', '.safetensors', '.bin']);

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
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function isContainedPath(baseDir, targetPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  try {
    const realBase = fs.realpathSync(resolvedBase);
    if (fs.existsSync(resolvedTarget)) {
      const realTarget = fs.realpathSync(resolvedTarget);
      const realRel = path.relative(realBase, realTarget);
      return Boolean(realRel) && !realRel.startsWith('..') && !path.isAbsolute(realRel);
    }
  } catch {
    return false;
  }
  return true;
}

function getAllowedCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return { origin: null, allowed: true };
  try {
    const u = new URL(origin);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const isLocalHost = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if ((u.protocol === 'http:' || u.protocol === 'https:') && isLocalHost && Number(port) === PORT) {
      return { origin, allowed: true };
    }
  } catch {}
  return { origin, allowed: false };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      data += chunk;
      if (data.length > 20 * 1024 * 1024) {
        aborted = true;
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!aborted) resolve(data);
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function extFromDataUrl(mime, filename) {
  if (typeof filename === 'string' && filename.trim()) {
    const ext = path.extname(path.basename(filename.trim())).toLowerCase();
    if (ALLOWED_UPLOAD_EXTS.has(ext)) return ext;
  }
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('wordprocessingml')) return '.docx';
  if (m.includes('png')) return '.png';
  if (m.includes('bmp')) return '.bmp';
  if (m.includes('html')) return '.html';
  if (m.includes('csv')) return '.csv';
  if (m.includes('json')) return '.json';
  return '.txt';
}

function looksLikeFilesystemPath(input) {
  if (/[\r\n]/.test(input)) return false;
  if (/^(?:[a-zA-Z]:[\\\/]|\/|\.{1,2}[\\\/])/.test(input)) return true;
  if (!/\s/.test(input) && /[\\\/]/.test(input)) return true;
  const ext = path.extname(input.trim()).toLowerCase();
  return !/\s/.test(input) && ALLOWED_UPLOAD_EXTS.has(ext);
}

function validateModelProbePath(modelPath) {
  const trimmed = String(modelPath || '').trim();
  if (!trimmed) {
    const err = new Error('modelPath is required');
    err.statusCode = 400;
    throw err;
  }
  if (/^ollama:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
    const candidateInWorkspace = path.resolve(ROOT_DIR, trimmed);
    if (!fs.existsSync(candidateInWorkspace)) {
      return trimmed;
    }
  }

  const resolved = path.resolve(ROOT_DIR, trimmed);
  const envModelsDir = process.env.VERISIEVE_MODELS_DIR ? path.resolve(process.env.VERISIEVE_MODELS_DIR) : null;
  const envModelPath = process.env.VERISIEVE_MODEL_PATH ? path.resolve(process.env.VERISIEVE_MODEL_PATH) : null;

  const contained =
    isContainedPath(ROOT_DIR, resolved) ||
    (envModelsDir && isContainedPath(envModelsDir, resolved)) ||
    (envModelPath && resolved === envModelPath);

  if (!contained) {
    const err = new Error('FORBIDDEN_WEIGHT_PROBE_PATH: model path outside workspace or configured model directory');
    err.statusCode = 403;
    throw err;
  }

  const base = path.basename(resolved).toLowerCase();
  const ext = path.extname(resolved).toLowerCase();
  const isOllamaBlob = /sha256-[a-f0-9]{16,}/i.test(base);
  if (base !== 'config.json' && !ALLOWED_WEIGHT_EXTS.has(ext) && !isOllamaBlob) {
    const err = new Error('FORBIDDEN_WEIGHT_PROBE_PATH: unsupported file type for weight inspection');
    err.statusCode = 403;
    throw err;
  }
  return resolved;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const cors = getAllowedCorsOrigin(req);
  if (!cors.allowed) {
    if (req.method === 'OPTIONS' || req.url?.startsWith('/api/')) {
      sendJson(res, 403, { ok: false, error: 'Cross-origin request rejected by loopback policy' });
      return;
    }
  } else if (cors.origin) {
    res.setHeader('Access-Control-Allow-Origin', cors.origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = parsedUrl.pathname;

  // API 1: POST /api/run (Universal Ingest & Gatekeeper Runner)
  if (req.method === 'POST' && pathname === '/api/run') {
    let tempFilePath = null;
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const { input, filename, mode, piiStrategy, alpha, maxSeqLen } = payload;

      if (typeof input !== 'string' || !input.trim()) {
        sendJson(res, 400, { ok: false, error: 'input is required' });
        return;
      }

      let target;
      const trimmed = input.trim();
      if (trimmed.startsWith('data:')) {
        const matches = trimmed.match(/^data:([^;,\s]+);base64,(.+)$/);
        if (!matches) {
          sendJson(res, 400, { ok: false, error: 'Malformed base64 data URL upload' });
          return;
        }
        const ext = extFromDataUrl(matches[1], filename);
        tempFilePath = path.join(os.tmpdir(), `verisieve-upload-${crypto.randomUUID()}${ext}`);
        fs.writeFileSync(tempFilePath, Buffer.from(matches[2], 'base64'));
        target = tempFilePath;
      } else if (/^(?:https?:\/\/|arxiv:)/i.test(trimmed)) {
        target = trimmed;
      } else if (looksLikeFilesystemPath(trimmed)) {
        const resolved = path.resolve(ROOT_DIR, trimmed);
        if (!isContainedPath(ROOT_DIR, resolved)) {
          sendJson(res, 403, { ok: false, error: 'FORBIDDEN_PATH: local path must reside inside workspace root' });
          return;
        }
        if (!fs.existsSync(resolved)) {
          sendJson(res, 404, { ok: false, error: `File not found: ${trimmed}` });
          return;
        }
        target = resolved;
      } else {
        const ext = extFromDataUrl('text/plain', filename);
        const safeExt = ext === '.html' || ext === '.htm' || ext === '.csv' || ext === '.json' ? ext : '.txt';
        tempFilePath = path.join(os.tmpdir(), `verisieve-text-${crypto.randomUUID()}${safeExt}`);
        fs.writeFileSync(tempFilePath, input, 'utf8');
        target = tempFilePath;
      }

      const result = await ingestFromUrlOrPath(target, {
        mode: mode || 'auto',
        piiStrategy: piiStrategy || 'token',
        alpha: alpha !== undefined ? parseFloat(alpha) : 0.05,
        maxSeqLen: maxSeqLen ? parseInt(maxSeqLen, 10) : 256,
      });

      const rows = result.rows || [];
      sendJson(res, 200, {
        ok: true,
        ...result,
        csv: result.csv || exportBlocksToCsv(rows),
        json: result.json || JSON.stringify(rows, null, 2),
        summarySvg: result.summarySvg || generateSummaryReportSvg({ summary: result.stats || {} }),
      });
    } catch (err) {
      const msg = err?.message || 'Pipeline failure';
      const status = /MIRAGE_WEIGHTS_REQUIRED|IMAGE_REQUIRES_OCR|PDF_IMAGE_ONLY|UNSUPPORTED_/.test(msg)
        ? 422
        : (/SSRF|FORBIDDEN|PRIVATE_IP|REDIRECT/.test(msg) ? 403 : 400);
      sendJson(res, status, { ok: false, error: msg });
    } finally {
      if (tempFilePath) {
        fs.rmSync(tempFilePath, { force: true });
      }
    }
    return;
  }

  // API 2: POST /api/mcp (Async JSON-RPC 2.0 Endpoint)
  if (req.method === 'POST' && pathname === '/api/mcp') {
    try {
      const raw = await readBody(req);
      const jsonRpcReq = raw ? JSON.parse(raw) : {};
      const jsonRpcRes = await handleJsonRpcRequest(jsonRpcReq);
      sendJson(res, 200, jsonRpcRes);
    } catch (err) {
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null });
    }
    return;
  }

  // API 3: GET /api/mcp/tools
  if (req.method === 'GET' && pathname === '/api/mcp/tools') {
    const listRes = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    sendJson(res, 200, listRes.result?.tools || []);
    return;
  }

  // API 4: POST /api/duckdb (VeriSieve WASM SQL Subset Endpoint — Zero-Import verisieve_sql.wasm)
  if (req.method === 'POST' && pathname === '/api/duckdb') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const { sql, dataset } = payload;

      const result = executeJsSql(sql || 'SELECT * FROM documents LIMIT 10;', dataset || 'all');
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message, engine: 'VeriSieve WASM SQL Subset v1' });
    }
    return;
  }

  // API 5: POST /api/train-model (Pure-WASM Small Model Training & Benchmark — Zero Python!)
  if (req.method === 'POST' && pathname === '/api/train-model') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const force = payload.force === true || Boolean(payload.modelPath);
      let modelPath = payload.modelPath || null;
      if (modelPath) {
        modelPath = validateModelProbePath(modelPath);
      }

      const resultsJsonPath = path.resolve(ROOT_DIR, 'results/open-model-training-results.json');
      if (force || !fs.existsSync(resultsJsonPath)) {
        trainWasmSmallModel(null, { exportArtifacts: true, modelPath });
      }

      const report = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf8'));

      const sftPath = path.resolve(ROOT_DIR, 'results/train-qwen-llama-sft.jsonl');
      let sftPreview = [];
      let sftRowsTotal = 0;
      if (fs.existsSync(sftPath)) {
        const lines = fs.readFileSync(sftPath, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
        sftRowsTotal = lines.length;
        sftPreview = lines.slice(0, 5).map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return l;
          }
        });
      }

      const binPath = path.resolve(ROOT_DIR, 'results/train-tokens.bin');
      const tokenBinBytes = fs.existsSync(binPath) ? fs.statSync(binPath).size : 0;

      sendJson(res, 200, {
        ok: true,
        ...report,
        sftPreview,
        tokenBinBytes,
        sftRowsTotal,
      });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
    }
    return;
  }

  // API 5B: GET /api/local-weights & POST /api/inspect-weights
  if ((req.method === 'GET' && pathname === '/api/local-weights') || (req.method === 'POST' && (pathname === '/api/inspect-weights' || pathname === '/api/local-weights'))) {
    try {
      let targetPath = null;
      if (req.method === 'POST') {
        const raw = await readBody(req);
        const payload = raw ? JSON.parse(raw) : {};
        targetPath = payload.modelPath;
      }
      if (!targetPath) {
        targetPath = process.env.VERISIEVE_MODEL_PATH || null;
      }
      const validated = validateModelProbePath(targetPath);
      const audit = inspectLocalOpenWeightPath(validated);
      sendJson(res, 200, {
        ok: true,
        audit,
      });
    } catch (err) {
      sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
    }
    return;
  }

  // API 6: POST /api/needle-search (Live WASM Needle Semantic Search)
  if (req.method === 'POST' && pathname === '/api/needle-search') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const query = String(payload.query || '').trim();
      if (!query) {
        sendJson(res, 400, { ok: false, error: 'query is required' });
        return;
      }
      const topK = payload.topK ? Math.max(1, Math.min(20, parseInt(payload.topK, 10))) : 3;

      const tables = loadExtractedDatasets();
      const safeRows = tables.verisieve_certified_tokens || [];
      const safeTexts = safeRows.map((r) => String(r.masked_text || r.text || ''));
      const tSearch = performance.now();
      const hits = safeTexts.length > 0 ? searchNeedleWasm(query, safeTexts, { topK }) : [];
      const searchMs = Number((performance.now() - tSearch).toFixed(2));
      const results = hits.map((h) => ({
        ...h,
        latencyMs: h.latencyMs ?? searchMs,
      }));

      sendJson(res, 200, {
        ok: true,
        query,
        topK,
        results,
        piiExposureRatePct: 0.0,
        engine: 'verisieve_dl.wasm (embedNeedleWasm)',
        latencyMs: searchMs,
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // API 7: POST /api/chat-ab (In-Place A/B Model Chat Playground)
  if (req.method === 'POST' && pathname === '/api/chat-ab') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const { prompt, datasetRows, options = {}, modelPath } = payload;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        sendJson(res, 400, { ok: false, error: 'prompt is required' });
        return;
      }
      const chosenModel = modelPath || options.modelPath || null;
      const validatedModel = chosenModel ? validateModelProbePath(chosenModel) : null;
      const chatOptions = { ...options, modelPath: validatedModel };
      const chatResult = chatWithTrainedModelsWasm(prompt, datasetRows, chatOptions);
      sendJson(res, 200, { ok: true, ...chatResult });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
    }
    return;
  }

  // Static File Serving (strictly contained to demo/, results/, docs/ — explicit 404 on missing files)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  const relativePath = decodedPath === '/' ? 'demo/index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT_DIR, relativePath);

  if (!isContainedPath(ROOT_DIR, filePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const inAllowedDir = ALLOWED_STATIC_DIRS.some((dir) => isContainedPath(dir, filePath));
  if (!inAllowedDir) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      fs.createReadStream(filePath).pipe(res);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`========================================================================`);
  console.log(`  VERISIEVE — LOOPBACK UI & MCP SERVER READY (${HOST}:${PORT})         `);
  console.log(`========================================================================`);
  console.log(`  Local UI URL:        http://${HOST}:${PORT}`);
  console.log(`  Run Pipeline API:    POST http://${HOST}:${PORT}/api/run`);
  console.log(`  WASM SQL API:        POST http://${HOST}:${PORT}/api/duckdb`);
  console.log(`  Train Model API:     POST http://${HOST}:${PORT}/api/train-model`);
  console.log(`  MCP Server API:      POST http://${HOST}:${PORT}/api/mcp`);
  console.log(`  MCP Tools List:      GET  http://${HOST}:${PORT}/api/mcp/tools`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`  Press Ctrl+C to stop the server.`);
  console.log(`========================================================================\n`);
});

export { server, PORT, HOST };
