#!/usr/bin/env node
/**
 * scripts/weft-mistral-teacher.mjs
 *
 * Mistral chat-completions teacher adapter for the W2 live path (ticket W-API).
 * Interface: prompt on stdin, response text on stdout, nothing else on stdout.
 * Token usage and generation settings go to stderr as one JSON line.
 *
 * Key handling: the key is read from MISTRAL_API_KEY only. It is never printed,
 * echoed, stored, or embedded in any error. Errors are typed, JSON, and exit 2.
 * OpenAI-hosted endpoints are refused before any network call.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_MODEL = 'mistral-medium';
const DEFAULT_BASE_URL = 'https://api.mistral.ai';
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const OPENAI_HOST = /(^|\.)openai\.com$/i;

// fail() throws instead of process.exit: on Windows, exiting while libuv handles
// (fetch keep-alive sockets) are closing trips the uv async.c assertion.
class TeacherFail extends Error {
  constructor(code, detail) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail) {
  throw new TeacherFail(code, detail);
}

// agent:false kills the socket with the response, so the process exits naturally
// instead of racing process.exit against live handles.
function postJson(endpoint, headers, bodyText, timeoutMs) {
  return new Promise((resolve) => {
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: 'POST',
      headers,
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
    req.on('error', (err) => resolve({ status: 0, errName: err && err.name ? err.name : 'Error' }));
    req.end(bodyText);
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function numeric(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// One retryable status class: rate limits and server-side faults.
function isRetryable(status) {
  return status === 429 || status >= 500;
}

function safeErrorType(payload) {
  const raw = payload && payload.error && (payload.error.type || payload.error.code);
  return typeof raw === 'string' && /^[\w.-]{1,64}$/.test(raw) ? raw : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const baseUrl = String(args['base-url'] || process.env.WEFT_TEACHER_BASE_URL || DEFAULT_BASE_URL);
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    fail('WEFT_TEACHER_CONFIG_INVALID', 'teacher base URL is not a valid URL');
  }
  if (OPENAI_HOST.test(base.hostname)) {
    fail('WEFT_TEACHER_OPENAI_BARRED', 'OpenAI-hosted teachers are barred by policy');
  }

  const key = process.env.MISTRAL_API_KEY;
  if (!key) fail('WEFT_TEACHER_KEY_ABSENT', 'MISTRAL_API_KEY is not set');

  const model = String(args.model || process.env.WEFT_TEACHER_MODEL || DEFAULT_MODEL);
  const temperature = numeric(args.temperature ?? process.env.WEFT_TEACHER_TEMPERATURE, 0.7);
  const timeoutMs = numeric(process.env.WEFT_TEACHER_TIMEOUT_MS, 120000);
  const maxTokens = numeric(process.env.WEFT_TEACHER_MAX_TOKENS, null);

  let prompt;
  try {
    prompt = fs.readFileSync(0, 'utf8');
  } catch {
    fail('WEFT_TEACHER_RESPONSE_INVALID', 'stdin could not be read');
  }

  // Deterministic seed travels in the prompt as a `Seed: <int>` line.
  const seedMatch = typeof prompt === 'string' ? /^Seed:\s*(\d+)\b/m.exec(prompt) : null;
  const seed = args.seed !== undefined ? numeric(args.seed, null) : seedMatch ? Number(seedMatch[1]) : null;

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  };
  if (seed !== null) body.random_seed = seed;
  if (maxTokens !== null) body.max_tokens = maxTokens;

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await postJson(endpoint, {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(JSON.stringify(body))),
    }, JSON.stringify(body), timeoutMs);

    if (r.status === 0) {
      // Transient socket failures (reset, closed, DNS blip) are retryable like 5xx;
      // never surface the request, headers, or the key: only the error name.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      fail('WEFT_TEACHER_UPSTREAM_FAILED', `network request failed: ${r.errName}`);
    }
    if (r.status === 401 || r.status === 403) {
      fail('WEFT_TEACHER_AUTH_FAILED', `HTTP ${r.status}`);
    }
    if (isRetryable(r.status) && attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
    if (r.status === 429) {
      fail('WEFT_TEACHER_QUOTA_EXHAUSTED', 'HTTP 429 after bounded retries');
    }
    if (r.status >= 500) {
      fail('WEFT_TEACHER_UPSTREAM_FAILED', `HTTP ${r.status} after bounded retries`);
    }
    if (r.status >= 400) {
      fail('WEFT_TEACHER_RESPONSE_INVALID', `HTTP ${r.status}`);
    }
    if (!r.json) {
      fail('WEFT_TEACHER_RESPONSE_INVALID', 'response body is not JSON');
    }
    const payload = r.json;

    const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : null;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('')
        : '';
    if (!text) {
      const type = safeErrorType(payload);
      fail('WEFT_TEACHER_RESPONSE_INVALID', type ? `empty completion (${type})` : 'empty completion');
    }

    const usage = payload && payload.usage ? payload.usage : {};
    fs.writeSync(
      2,
      JSON.stringify({
        type: 'usage',
        model: (payload && payload.model) || model,
        promptTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
        completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
        totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
        temperature,
        seed,
        attempts: attempt,
      }) + '\n'
    );
    fs.writeSync(1, text);
    return;
  }

  fail('WEFT_TEACHER_UPSTREAM_FAILED', 'no usable response');
}

main().catch((err) => {
  // Natural exit codes only; the error JSON line is the last thing on stderr.
  if (err instanceof TeacherFail) {
    fs.writeSync(2, JSON.stringify({ error: err.code, detail: err.detail }) + '\n');
  } else {
    fs.writeSync(2, JSON.stringify({ error: 'WEFT_TEACHER_UPSTREAM_FAILED', detail: err && err.name ? err.name : 'Error' }) + '\n');
  }
  process.exitCode = 2;
});

