import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// W7 contract tests for the claim-audit script (plan decision 2 and section 3
// of the W7 execution plan). Round trip, idempotence, fail-closed refusal on
// an untraced claim, the banned-word sweep, the licence gate, and the
// story-36 honesty check. No model runtime is involved: skip-if-absent is
// not needed. The real ledger is append-only; the failure tests run against
// temp copies so the committed ledger is never touched.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-weft-claim-audit.mjs');
const CARD = path.join(ROOT, 'release', 'weft-specialist-v1', 'MODEL_CARD.md');
const MANIFEST = path.join(ROOT, 'release', 'weft-specialist-v1', 'RELEASE-MANIFEST.json');
const LEDGER = path.join(ROOT, 'results', 'weft-claim-audit.json');
const LICENCE = path.join(ROOT, 'results', 'weft-licence-audit.json');
const VERIFICATION = path.join(ROOT, 'docs', 'research-notes', '2026-11-28-w7-fulltext-verification-record.md');

function runAudit(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function ledgerOnce() {
  if (!fs.existsSync(LEDGER)) return { kind: 'weft-claim-audit', schemaVersion: 1, appendOnly: true, entries: [] };
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

function parseCardClaims() {
  const card = fs.readFileSync(CARD, 'utf8');
  const start = card.indexOf('<!-- weft-claims');
  const open = card.indexOf('[', start);
  const close = card.lastIndexOf(']');
  return JSON.parse(card.slice(open, close + 1));
}

test('W7 1: the claim audit round-trips and covers every card claim', () => {
  const result = runAudit([]);
  assert.equal(result.status, 0, result.stderr);
  const ledger = ledgerOnce();
  assert.equal(ledger.kind, 'weft-claim-audit');
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.appendOnly, true);
  assert.ok(ledger.entries.length >= 1, 'the ledger carries the audit entry');
  const entry = ledger.entries[ledger.entries.length - 1];
  const cardClaims = parseCardClaims();
  const entryIds = entry.claims.map((c) => c.id);
  for (const c of cardClaims) {
    assert.ok(entryIds.includes(c.id), `card claim ${c.id} is covered by the ledger entry`);
  }
  assert.equal(entry.verdicts.length, cardClaims.length, 'every card claim has a verdict');
  for (const v of entry.verdicts) assert.equal(v.verdict, 'pass');
  // every citation trace resolves inside the committed verification record
  for (const c of cardClaims.filter((x) => x.trace.kind === 'citation')) {
    assert.equal(c.trace.source.split('#')[0], 'docs/research-notes/2026-11-28-w7-fulltext-verification-record.md');
  }
});

test('W7 2: re-running with an unchanged card is a no-op', () => {
  const before = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const result = runAudit([]);
  assert.equal(result.status, 0, result.stderr);
  const after = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  assert.equal(after.entries.length, before.entries.length, 're-running must not append');
  assert.equal(after.entries[after.entries.length - 1].runId, before.entries[before.entries.length - 1].runId);
});

test('W7 3: an untraced claim fails closed with a typed error and appends nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-claim-untraced-'));
  const card = fs.readFileSync(CARD, 'utf8');
  const inject = `, { "id": "bogus-untraced-claim", "statement": "The unseen-voice transfer cell measures F1 0.6695" }`;
  const last = card.lastIndexOf(',\n');
  const cut = card.indexOf('\n]', last);
  const badCard = card.slice(0, cut) + inject + card.slice(cut);
  assert.ok(badCard.includes('bogus-untraced-claim'), 'the temp card carries the planted claim');
  const cardPath = path.join(tmp, 'MODEL_CARD.md');
  const ledgerPath = path.join(tmp, 'weft-claim-audit.json');
  fs.writeFileSync(cardPath, badCard, 'utf8');
  const before = fs.readFileSync(LEDGER, 'utf8');
  const result = runAudit(['--card', cardPath, '--ledger', ledgerPath]);
  assert.notEqual(result.status, 0, 'the audit must refuse the untraced claim');
  assert.match(result.stderr, /WEFT_CLAIM_UNTRACED/);
  assert.equal(fs.existsSync(ledgerPath), false, 'a failed run must not create a ledger');
  assert.equal(fs.readFileSync(LEDGER, 'utf8'), before, 'a failed run must not touch the real ledger');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('W7 4: the banned-word sweep refuses planted tokens and honors the word boundary', () => {
  const tokens = ['mathematically' + ' grounded', 'elimin' + 'ates', 'identity-removed', 'perceive' + ' everything', 'atomic' + ' knowledge', 'fir' + 'st'];
  for (const token of tokens) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-claim-banned-'));
    const relDir = path.join(tmp, 'release');
    fs.mkdirSync(relDir);
    fs.writeFileSync(path.join(relDir, 'NOTE.md'), `a sentence with the literal ${token} planted.\n`);
    const ledgerPath = path.join(tmp, 'weft-claim-audit.json');
    const before = fs.readFileSync(LEDGER, 'utf8');
    const result = runAudit(['--release', relDir, '--ledger', ledgerPath]);
    assert.notEqual(result.status, 0, `the sweep must refuse ${token}`);
    assert.match(result.stderr, /WEFT_CLAIM_BANNED_WORD/);
    assert.equal(fs.existsSync(ledgerPath), false, `a banned-hit run must not append for ${token}`);
    assert.equal(fs.readFileSync(LEDGER, 'utf8'), before);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // "first" is word-boundary anchored: an ordinary word like "fir" + "stly" passes
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-claim-boundary-'));
  const relDir = path.join(tmp, 'release');
  fs.mkdirSync(relDir);
  fs.writeFileSync(path.join(relDir, 'NOTE.md'), `fir${'st'}ly we measured, then we reported.\n`);
  const result = runAudit(['--release', relDir, '--ledger', path.join(tmp, 'weft-claim-audit.json')]);
  assert.equal(result.status, 0, `the word boundary must not trip on an ordinary word: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /WEFT_CLAIM_BANNED_WORD/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('W7 5: the licence gate admits green sources only and keeps Multi-News out', () => {
  const audit = JSON.parse(fs.readFileSync(LICENCE, 'utf8'));
  for (const source of audit.sources) {
    if (source.usedInRecipe === true) {
      assert.equal(source.status, 'green', `${source.id} is used in the recipe and must be green`);
    }
  }
  const multiNews = audit.sources.find((s) => s.id === 'multi-news');
  assert.ok(multiNews, 'the multi-news entry is recorded, not deleted');
  assert.equal(multiNews.usedInRecipe, false);
  assert.equal(multiNews.status, 'dropped');
  assert.match(multiNews.verifiedFrom, /non-commercial research and educational purposes only/);
  // the W7 P0 verifications are on the record
  const needle = audit.sources.find((s) => s.id === 'needle-3');
  assert.equal(needle.status, 'green');
  assert.equal(needle.usedInRecipe, false);
  assert.match(needle.verifiedFrom, /https:\/\/huggingface\.co\/Cactus-Compute\/needle3/);
  const ucdcr = audit.sources.find((s) => s.id === 'ucdcr');
  assert.equal(ucdcr.usedInRecipe, false);
  assert.match(ucdcr.notes, /never redistributed/);
  const wikipedia = audit.sources.find((s) => s.id === 'wikipedia-dumps');
  assert.equal(wikipedia.status, 'green');
  assert.equal(wikipedia.releaseConstraint, 'share-alike');
  // every cited id from the card's citation rows exists in the verification record
  const record = fs.readFileSync(VERIFICATION, 'utf8');
  const card = fs.readFileSync(CARD, 'utf8');
  const ids = [...card.matchAll(/arXiv:(\d{4}\.\d{4,5})/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    assert.ok(record.includes(id), `arXiv id ${id} must be in the verification record`);
  }
});

test('W7 6: the manifest records the story-36 gate honestly', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const gate = manifest.releaseGate;
  assert.equal(gate.gate, 'story-36-size-matched-static-baseline-identity-disjoint');
  assert.equal(gate.status, 'blocked-pending-founder-ruling');
  assert.ok(gate.measured, 'the gate records the measured numbers');
  assert.equal(gate.measured.bucket, 'identity_disjoint');
  const round4 = (x) => Number(x.toFixed(4));
  assert.equal(round4(gate.measured.staticEmbeddingBaselineF1), 0.9973);
  assert.equal(round4(gate.measured.specialistLinkHeadF1), 0.3617);
  assert.equal(round4(gate.measured.specialistPooledCosineF1), 0.9989);
  // the artifact digests match the recorded export ledger
  const exportLedger = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'weft-export-latency.json'), 'utf8'));
  const recorded = new Set();
  for (const e of exportLedger.entries) {
    if (e.artifact && e.artifact.sha256) recorded.add(e.artifact.sha256 + ':' + e.artifact.bytes);
  }
  for (const artifact of manifest.artifacts) {
    assert.ok(recorded.has(artifact.sha256 + ':' + artifact.bytes), `artifact ${artifact.id} digest and size must match the ledger`);
  }
});
