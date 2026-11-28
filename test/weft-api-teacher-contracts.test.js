import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LICENCE_AUDIT,
  WeftTeacherUnavailableError,
  generateTeacherEstates,
  resolveLocalTeacher,
} from '../scripts/build-weft-training-pairs.mjs';

// W-API contract tests: no external network and no real key. The adapter's success and
// error paths are exercised against a loopback stub; every other probe runs offline.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = path.join(ROOT, 'scripts', 'weft-mistral-teacher.mjs');
const COMPILER = path.join(ROOT, 'scripts', 'build-weft-training-pairs.mjs');
const AUDIT = path.join(ROOT, 'results', 'weft-licence-audit.json');
const FAKE_KEY = 'weft-contract-sentinel-key-never-real';
// Built from fragments so the compliance sweep does not carry the literal terms.
const BANNED = ['mathematically' + ' grounded', 'elimin' + 'ates', 'fir' + 'st'];
const API_LICENCE = 'mistral-api-tos';

function adapterEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ['MISTRAL_API_KEY', 'WEFT_TEACHER_BASE_URL', 'WEFT_TEACHER_MODEL', 'WEFT_TEACHER_TIMEOUT_MS']) {
    delete env[key];
  }
  return { ...env, ...extra };
}

function runAdapter({ args = [], env = {}, input = 'Seed: 7. Produce 1 short document about the theme "alpha".' } = {}) {
  return spawnSync(process.execPath, [ADAPTER, ...args], {
    input,
    encoding: 'utf8',
    env: adapterEnv(env),
    timeout: 30000,
  });
}

// Loopback stubs live in this process, so the adapter must run asynchronously.
function runAdapterAsync({ args = [], env = {}, input = 'Seed: 7. Produce 1 short document about the theme "alpha".' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ADAPTER, ...args], { env: adapterEnv(env) });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function lastJsonLine(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

async function startStub(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}

let auditCounter = 0;
async function startStubOrSkip(t, handler) {
  try {
    return await startStub(handler);
  } catch {
    t.skip('loopback stub unavailable in this environment');
    return null;
  }
}

function tempAudit(dir, { status = 'green', licence = API_LICENCE } = {}) {
  const audit = structuredClone(JSON.parse(fs.readFileSync(AUDIT, 'utf8')));
  const entry = audit.sources.find((source) => source.id === 'mistral-medium');
  assert.ok(entry, 'the committed audit must carry the mistral-medium entry');
  entry.status = status;
  entry.licence = licence;
  const file = path.join(dir, `audit-${++auditCounter}.json`);
  fs.writeFileSync(file, JSON.stringify(audit, null, 2) + '\n');
  return file;
}

function stubTeacher(calls, { idPattern = (i) => `d${i % 2}` } = {}) {
  return {
    kind: 'api',
    licence: API_LICENCE,
    auditEntry: { status: 'green' },
    complete(prompt) {
      calls.push(prompt);
      const want = Number(/Produce\s+(\d+)\s+documents/.exec(prompt)[1]);
      const theme = JSON.parse(/theme\s+("[^"]+")/.exec(prompt)[1]);
      const formats = ['email', 'transcript', 'slides', 'table', 'ticket', 'pdf-scan'];
      return JSON.stringify({
        docs: Array.from({ length: want }, (_, i) => ({
          id: idPattern(i),
          format: formats[i % formats.length],
          department: 'finance',
          theme,
          text: `note ${i} about ${theme}`,
          identities: [{ key: `person:p${i % 2}`, surface: `Person ${i % 2}`, class: 'person' }],
        })),
        links: [],
      });
    },
  };
}

test('W-API 1: adapter fails closed with typed errors, no key, and no key leakage', () => {
  const absent = runAdapter();
  assert.equal(absent.status, 2, absent.stderr);
  assert.equal(absent.stdout, '', 'a failed adapter writes nothing to stdout');
  assert.equal(lastJsonLine(absent.stderr).error, 'WEFT_TEACHER_KEY_ABSENT');

  const openai = runAdapter({ args: ['--base-url', 'https://api.openai.com/v1'], env: { MISTRAL_API_KEY: FAKE_KEY } });
  assert.equal(openai.status, 2, openai.stderr);
  assert.equal(openai.stdout, '');
  assert.equal(lastJsonLine(openai.stderr).error, 'WEFT_TEACHER_OPENAI_BARRED');
  assert.ok(!(`${openai.stdout}${openai.stderr}`).includes(FAKE_KEY), 'the key must never be echoed');

  const invalidBase = runAdapter({ args: ['--base-url', 'not a url'], env: { MISTRAL_API_KEY: FAKE_KEY } });
  assert.equal(invalidBase.status, 2, invalidBase.stderr);
  assert.equal(lastJsonLine(invalidBase.stderr).error, 'WEFT_TEACHER_CONFIG_INVALID');

  const unreachable = runAdapter({ args: ['--base-url', 'http://127.0.0.1:1'], env: { MISTRAL_API_KEY: FAKE_KEY } });
  assert.equal(unreachable.status, 2, unreachable.stderr);
  assert.equal(unreachable.stdout, '');
  assert.equal(lastJsonLine(unreachable.stderr).error, 'WEFT_TEACHER_UPSTREAM_FAILED');
  const combined = `${unreachable.stdout}${unreachable.stderr}`;
  assert.ok(!combined.includes(FAKE_KEY), 'no network error may carry the key');
  assert.ok(!/Bearer/i.test(combined), 'no error may echo the Authorization header');
});

test('W-API 2: success writes only response text to stdout; usage and settings go to stderr', async (t) => {
  let received = null;
  const stub = await startStubOrSkip(t, (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: 'mistral-medium',
        choices: [{ message: { content: '{"docs":[],"links":[]}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }));
    });
  });
  if (!stub) return;
  try {
    const result = await runAdapterAsync({
      args: ['--base-url', stub.url],
      env: { MISTRAL_API_KEY: FAKE_KEY },
      input: 'Seed: 42. Produce 1 short document about the theme "alpha".',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '{"docs":[],"links":[]}', 'stdout carries the response text and nothing else');
    const lines = result.stderr.trim().split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, 'stderr carries exactly one usage line');
    const usage = JSON.parse(lines[0]);
    assert.equal(usage.type, 'usage');
    assert.equal(usage.model, 'mistral-medium');
    assert.equal(usage.promptTokens, 12);
    assert.equal(usage.completionTokens, 7);
    assert.equal(usage.totalTokens, 19);
    assert.equal(usage.seed, 42);
    assert.equal(usage.temperature, 0.7);
    assert.ok(!result.stderr.includes(FAKE_KEY));

    assert.equal(received.url, '/v1/chat/completions');
    assert.equal(received.auth, `Bearer ${FAKE_KEY}`, 'the key travels only in the Authorization header');
    assert.equal(received.body.model, 'mistral-medium');
    assert.equal(received.body.messages[0].role, 'user');
    assert.equal(received.body.random_seed, 42);
  } finally {
    await stub.close();
  }
});

test('W-API 3: auth, quota, and response-invalid paths are typed and retry-bounded', async (t) => {
  let authHits = 0;
  const authStub = await startStubOrSkip(t, (req, res) => {
    authHits += 1;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'unauthorized' } }));
  });
  if (!authStub) return;
  try {
    const auth = await runAdapterAsync({ args: ['--base-url', authStub.url], env: { MISTRAL_API_KEY: FAKE_KEY } });
    assert.equal(auth.status, 2, auth.stderr);
    assert.equal(lastJsonLine(auth.stderr).error, 'WEFT_TEACHER_AUTH_FAILED');
    assert.equal(authHits, 1, 'an auth failure is not retried');
    assert.ok(!auth.stderr.includes(FAKE_KEY));
  } finally {
    await authStub.close();
  }

  let quotaHits = 0;
  const quotaStub = await startStubOrSkip(t, (req, res) => {
    quotaHits += 1;
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'rate_limited' } }));
  });
  if (!quotaStub) return;
  try {
    const quota = await runAdapterAsync({ args: ['--base-url', quotaStub.url], env: { MISTRAL_API_KEY: FAKE_KEY } });
    assert.equal(quota.status, 2, quota.stderr);
    assert.equal(lastJsonLine(quota.stderr).error, 'WEFT_TEACHER_QUOTA_EXHAUSTED');
    assert.equal(quotaHits, 3, 'rate limits retry a bounded number of times');
  } finally {
    await quotaStub.close();
  }

  const invalidStub = await startStubOrSkip(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
  });
  if (!invalidStub) return;
  try {
    const invalid = await runAdapterAsync({ args: ['--base-url', invalidStub.url], env: { MISTRAL_API_KEY: FAKE_KEY } });
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.equal(lastJsonLine(invalid.stderr).error, 'WEFT_TEACHER_RESPONSE_INVALID');
    assert.equal(invalid.stdout, '');
  } finally {
    await invalidStub.close();
  }
});

test('W-API 4: chunked generation loops in bounded chunks with deterministic seeds', () => {
  const calls = [];
  const estates = generateTeacherEstates(stubTeacher(calls), {
    themes: ['alpha', 'beta'],
    pairsTarget: 160,
    chunkSize: 7,
    seed: 5,
  });
  // perTheme = max(5, ceil(160 / 8 / 2)) = 10, so each theme is 7 + 3 documents.
  assert.equal(calls.length, 4, 'two chunks per theme');
  assert.equal(calls.filter((prompt) => /Produce 7 documents/.test(prompt)).length, 2);
  assert.equal(calls.filter((prompt) => /Produce 3 documents/.test(prompt)).length, 2);
  const expectedSeeds = ['alpha', 'beta'].flatMap((_, themeIndex) => [0, 1].map((chunk) => (5 * 1000003 + themeIndex * 10007 + chunk) >>> 0));
  assert.deepEqual(calls.map((prompt) => Number(/^Seed:\s*(\d+)\./m.exec(prompt)[1])), expectedSeeds);

  for (const theme of ['alpha', 'beta']) {
    const themed = estates.docs.filter((doc) => doc.theme === theme);
    assert.equal(themed.length, 10, `theme ${theme} reaches the per-theme target`);
    assert.ok(themed.every((doc) => doc.id.startsWith(`${theme}-c`)), 'chunk-scoped ids are namespaced');
  }
  assert.equal(new Set(estates.docs.map((doc) => doc.id)).size, estates.docs.length, 'ids stay unique despite repeated model ids');

  const replay = [];
  const second = generateTeacherEstates(stubTeacher(replay), {
    themes: ['alpha', 'beta'],
    pairsTarget: 160,
    chunkSize: 7,
    seed: 5,
  });
  assert.equal(JSON.stringify(replay), JSON.stringify(calls), 'prompts are deterministic run to run');
  assert.deepEqual(second, estates, 'the estate is deterministic run to run');

  // WEFT_TEACHER_CHUNK configures the default chunk size.
  const saved = process.env.WEFT_TEACHER_CHUNK;
  process.env.WEFT_TEACHER_CHUNK = '4';
  try {
    const envCalls = [];
    generateTeacherEstates(stubTeacher(envCalls), { themes: ['solo'], pairsTarget: 160 });
    assert.equal(envCalls.length, 5, 'perTheme 20 with chunk 4 yields five calls');
    assert.ok(envCalls.every((prompt) => Number(/Produce\s+(\d+)/.exec(prompt)[1]) <= 4));
  } finally {
    if (saved === undefined) delete process.env.WEFT_TEACHER_CHUNK;
    else process.env.WEFT_TEACHER_CHUNK = saved;
  }

  assert.throws(
    () => generateTeacherEstates({ kind: 'api', licence: API_LICENCE, complete: () => '{"docs":[]}' }, { themes: ['x'] }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'api-teacher-unverified'
  );
  assert.throws(
    () => generateTeacherEstates({ kind: 'api', licence: 'apache-2.0', auditEntry: { status: 'green' }, complete: () => '{}' }, { themes: ['x'] }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'licence-not-permissive'
  );
  assert.throws(
    () => generateTeacherEstates({ kind: 'api', licence: API_LICENCE, auditEntry: { status: 'green' }, complete: () => '{"docs":[],"links":[]}' }, { themes: ['x'] }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'runtime-failed'
  );
});

test('W-API 5: resolver accepts the audited api class only, and keeps weights and OpenAI paths closed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-api-resolve-'));
  try {
    const green = tempAudit(tmp, { status: 'green' });
    const accepted = resolveLocalTeacher({
      WEFT_TEACHER_KIND: 'api',
      WEFT_TEACHER_LICENCE: API_LICENCE,
      WEFT_LICENCE_AUDIT: green,
    });
    assert.equal(accepted.kind, 'api');
    assert.equal(accepted.licence, API_LICENCE);
    assert.equal(accepted.model, 'mistral-medium');
    assert.equal(accepted.auditEntry.status, 'green');
    assert.equal(typeof accepted.complete, 'function');
    assert.equal(accepted.command, ADAPTER, 'the bundled adapter is the default command');

    assert.throws(
      () => resolveLocalTeacher({
        WEFT_TEACHER_KIND: 'api',
        WEFT_TEACHER_LICENCE: 'apache-2.0',
        WEFT_LICENCE_AUDIT: green,
      }),
      (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'api-licence-required'
    );
    assert.throws(
      () => resolveLocalTeacher({
        WEFT_TEACHER_KIND: 'api',
        WEFT_TEACHER_LICENCE: API_LICENCE,
        WEFT_LICENCE_AUDIT: tempAudit(tmp, { status: 'unverified' }),
      }),
      (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'api-teacher-unverified'
    );
    assert.throws(
      () => resolveLocalTeacher({
        WEFT_TEACHER_KIND: 'api',
        WEFT_TEACHER_LICENCE: API_LICENCE,
        WEFT_TEACHER_MODEL: 'mistral-large',
        WEFT_LICENCE_AUDIT: green,
      }),
      (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'api-teacher-unverified'
    );
    assert.throws(
      () => resolveLocalTeacher({
        WEFT_TEACHER_KIND: 'api',
        WEFT_TEACHER_LICENCE: API_LICENCE,
        WEFT_LICENCE_AUDIT: path.join(tmp, 'missing.json'),
      }),
      (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'audit-unavailable'
    );
    assert.throws(
      () => resolveLocalTeacher({
        WEFT_TEACHER_URL: 'https://api.openai.com/v1',
        WEFT_TEACHER_KIND: 'api',
        WEFT_TEACHER_LICENCE: API_LICENCE,
        WEFT_LICENCE_AUDIT: green,
      }),
      (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'openai-barred'
    );
    assert.throws(
      () => resolveLocalTeacher({
        WEFT_TEACHER_CMD: 'llama-cli',
        WEFT_TEACHER_LICENCE: API_LICENCE,
      }),
      (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'licence-not-permissive'
    );

    // The adapter failure surfaces as a typed reason and never as a raw key.
    const stubAdapter = path.join(tmp, 'stub-adapter.mjs');
    fs.writeFileSync(
      stubAdapter,
      "process.stderr.write(JSON.stringify({ error: 'WEFT_TEACHER_KEY_ABSENT', detail: 'stub' }) + '\\n');\nprocess.exit(2);\n"
    );
    const stubbed = resolveLocalTeacher({
      WEFT_TEACHER_KIND: 'api',
      WEFT_TEACHER_LICENCE: API_LICENCE,
      WEFT_TEACHER_CMD: stubAdapter,
      WEFT_LICENCE_AUDIT: green,
    });
    assert.throws(
      () => stubbed.complete('prompt'),
      (err) => err instanceof WeftTeacherUnavailableError
        && err.reason === 'runtime-failed'
        && /WEFT_TEACHER_KEY_ABSENT/.test(err.message)
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('W-API 6: licence audit append is additive and records the API teacher honestly', () => {
  const committed = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
  assert.deepEqual(Object.keys(committed).sort(), Object.keys(LICENCE_AUDIT).sort(), 'no top-level audit key may change');
  assert.ok(committed.sources.length > LICENCE_AUDIT.sources.length, 'the API entry is additive');
  assert.deepEqual(
    committed.sources.slice(0, LICENCE_AUDIT.sources.length),
    LICENCE_AUDIT.sources,
    'every pre-existing entry keeps its content and order'
  );

  const entries = committed.sources.filter((source) => source.id === 'mistral-medium');
  assert.equal(entries.length, 1, 'the mistral-medium entry appears exactly once');
  const entry = entries[0];
  assert.equal(entry.kind, 'api-model');
  assert.equal(entry.modelId, 'mistral-medium');
  assert.equal(entry.licence, API_LICENCE);
  assert.equal(entry.status, 'green');
  assert.equal(entry.usedInRecipe, true);
  assert.equal(entry.weightDigest, null, 'an API teacher has no weight digest');
  assert.match(entry.verifiedFrom, /legal\.mistral\.ai/);
  assert.match(entry.verifiedFrom, /2026-09-25/);
  assert.match(entry.notes, /no weight digest/i);
  for (const field of ['name', 'terms', 'verifiedFrom', 'releaseConsequence']) {
    assert.ok(typeof entry[field] === 'string' && entry[field].length > 0, `the API entry must record ${field}`);
  }
  assert.ok(!LICENCE_AUDIT.sources.some((source) => source.id === 'mistral-medium'), 'the W2 export stays append-only');

  const ids = committed.sources.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length, 'audit ids stay unique');
});

test('W-API 8: org profiles re-skin the prompt; the default prompt stays unchanged', () => {
  const profile = {
    id: 'hospital-network',
    context: 'a regional hospital network running two acute hospitals and an outpatient clinic',
    departments: ['clinical', 'nursing', 'procurement', 'compliance'],
    formats: ['email', 'transcript', 'ticket', 'pdf-scan'],
    vendorPool: ['Medivar Supply Group', 'Corvale Diagnostics'],
    nameCultures: [
      { label: 'Nordic', names: ['Astrid Lindqvist', 'Eero Halvorsen'] },
      { label: 'Filipino', names: ['Marisol Reyes', 'Dante Villanueva'] },
    ],
  };
  const profileCalls = [];
  generateTeacherEstates(stubTeacher(profileCalls), {
    themes: ['alpha'],
    pairsTarget: 50,
    chunkSize: 10,
    seed: 9,
    orgProfile: profile,
  });
  const prompt = profileCalls[0];
  assert.ok(prompt.includes('Company context'), 'the profile industries context line is pinned into the prompt');
  for (const name of profile.departments) assert.ok(prompt.includes(name), `profile department ${name} reaches the prompt`);
  for (const vendor of profile.vendorPool) assert.ok(prompt.includes(vendor), 'the profile vendor pool replaces the generic estate roster');
  assert.ok(!prompt.includes('Northwind Supply Co'), 'the generic estate vendor must not survive into a profiled prompt');
  assert.ok(prompt.includes('Medivar Supply Group'), 'profile roster surfaces reach the prompt as identity keys');
  assert.ok(prompt.includes('Astrid Lindqvist'), 'profile roster people are drawn from the name cultures');
  assert.ok(prompt.includes('naming cultures'), 'the invented-cast culture hint reaches the prompt');
  assert.ok(!prompt.includes('Mix departments.'), 'the generic department mix line is replaced');

  const defaultCalls = [];
  generateTeacherEstates(stubTeacher(defaultCalls), {
    themes: ['alpha'],
    pairsTarget: 50,
    chunkSize: 10,
    seed: 9,
  });
  const defaultPrompt = defaultCalls[0];
  assert.ok(!defaultPrompt.includes('Company context'), 'no context line without a profile');
  assert.ok(defaultPrompt.includes('Mix departments.'), 'the default department line is untouched');
  assert.ok(defaultPrompt.includes('Northwind Supply Co'), 'the default roster is untouched');

  // Length bands: a per-call band line replaces the free-form hint, with a long
  // band asking for fewer documents so a call has room to write to length.
  const bandCalls = [];
  generateTeacherEstates(stubTeacher(bandCalls), {
    themes: ['alpha', 'beta'],
    pairsTarget: 120,
    chunkSize: 10,
    seed: 9,
    lengthBands: [
      { label: 'short', min: 30, max: 80 },
      { label: 'medium', min: 100, max: 250 },
      { label: 'long', min: 300, max: 600 },
    ],
  });
  const bandLines = bandCalls.map((p) => (/(short|medium|long) band for this call|Length band for this call/.exec(p) || [])[0]);
  assert.ok(bandLines.every((line) => line), 'every banded call carries its own length band');
  const longCalls = bandCalls.filter((p) => p.includes('Length band for this call: every document must be 300 to 600 words'));
  assert.ok(longCalls.length >= 1 && longCalls.every((p) => /Produce 3 documents/.test(p)),
    'long-band calls shrink the per-call document count');
  assert.ok(!bandCalls.some((p) => p.includes('Vary document lengths')), 'the free-form hint line is replaced by the band');
});

test('W-API 7: banned-word sweep over the adapter, the contract test, and the audit', () => {
  for (const file of [ADAPTER, fileURLToPath(import.meta.url), AUDIT, COMPILER]) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const word of BANNED) {
      assert.ok(!text.includes(word), `${path.basename(file)} must not contain a banned term`);
    }
  }
});
