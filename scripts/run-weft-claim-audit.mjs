import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// W7 claim audit (plan decision 2): parse the model card's claims block,
// verify every measured trace against its committed ledger, every citation
// trace against the committed full-text verification record, sweep the
// release directory for banned literals, and append one content-addressed
// entry to the append-only ledger. Fail closed: verification failure or a
// banned-word hit appends nothing.
//
// Digest traces: trace.source names the artifact file; when it exists it is
// sha256'd and compared to trace.digest. The weights are gitignored by
// standing rule, so when the file is absent the digest must at least appear
// in results/weft-export-latency.json (the committed recorded pin).
//
// Idempotence: runId = sha256 over the canonical JSON of {claims, sweep}.
// A run with an identical card and identical release-dir content has the
// same runId; when it is already in the ledger the script exits 0 and
// appends nothing.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC = 'docs/research-notes/2026-11-28-w7-fulltext-verification-record.md';
const LATENCY = 'results/weft-export-latency.json';

function die(code, detail) {
  console.error(`${code}: ${detail}`);
  process.exit(1);
}

// Banned literals. All are substring matches except "first": word-boundary
// anchored, because the bare substring hits ordinary words.
const BANNED = [
  { token: 'mathematically grounded', re: /mathematically\s+grounded/i, word: false },
  { token: 'eliminates', re: /eliminates/i, word: false },
  { token: 'identity-removed', re: /identity-removed/i, word: false },
  { token: 'perceive everything', re: /perceive\s+everything/i, word: false },
  { token: 'atomic knowledge', re: /atomic\s+knowledge/i, word: false },
  { token: 'first', re: /\bfirst\b/i, word: true },
];

function parseArgs(argv) {
  const args = { release: null, ledger: null, card: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--release') args.release = argv[++i];
    else if (argv[i] === '--ledger') args.ledger = argv[++i];
    else if (argv[i] === '--card') args.card = argv[++i];
    else if (argv[i] === '--help') return null;
    else die('WEFT_CLAIM_AUDIT_ERROR', `unknown argument ${argv[i]}`);
  }
  args.card = args.card ? path.resolve(args.card) : path.join(ROOT, 'release', 'weft-specialist-v1', 'MODEL_CARD.md');
  args.ledger = args.ledger ? path.resolve(args.ledger) : path.join(ROOT, 'results', 'weft-claim-audit.json');
  args.release = args.release ? path.resolve(args.release) : path.join(ROOT, 'release');
  return args;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function parseClaimsBlock(cardPath) {
  const card = fs.readFileSync(cardPath, 'utf8');
  const start = card.indexOf('<!-- weft-claims');
  if (start < 0) die('WEFT_CLAIM_UNTRACED', `no claims block in ${cardPath}`);
  const open = card.indexOf('[', start);
  const close = card.lastIndexOf(']');
  if (open < 0 || close <= open) die('WEFT_CLAIM_UNTRACED', 'claims block has no JSON array');
  let claims;
  try {
    claims = JSON.parse(card.slice(open, close + 1));
  } catch (exc) {
    die('WEFT_CLAIM_UNTRACED', `claims block is not parseable JSON: ${exc.message}`);
  }
  if (!Array.isArray(claims) || claims.length === 0) die('WEFT_CLAIM_UNTRACED', 'claims array is empty');
  const seen = new Set();
  for (const c of claims) {
    if (typeof c.id !== 'string' || seen.has(c.id)) die('WEFT_CLAIM_UNTRACED', `claim id missing or duplicated: ${JSON.stringify(c.id)}`);
    seen.add(c.id);
    if (typeof c.statement !== 'string' || !c.statement.trim()) die('WEFT_CLAIM_UNTRACED', `claim ${c.id}: statement missing`);
    const t = c.trace;
    if (!t || (t.kind !== 'measured' && t.kind !== 'citation')) die('WEFT_CLAIM_UNTRACED', `claim ${c.id}: trace.kind must be measured or citation`);
    if (typeof t.source !== 'string' || !t.source.trim()) die('WEFT_CLAIM_UNTRACED', `claim ${c.id}: trace.source missing`);
  }
  return claims;
}

function listReleaseFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function runSweep(releaseDir) {
  const files = listReleaseFiles(releaseDir);
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const lowerPath = f.replace(/\\/g, '/');
    for (const b of BANNED) {
      if (b.re.test(text)) hits.push({ file: lowerPath, token: b.token });
    }
  }
  return hits;
}

const CITATION_ID_RE =
  /arXiv:(\d{4}\.\d{4,5})|(D\d\d-\d{4}|P\d\d-\d{4}|20\d\d\.(?:acl|naacl|eacl|emnlp)-main\.\d+)|(W\d{10,16})/g;

function normalizeText(text) {
  return text.replace(/(\d),(\d)/g, '$1$2');
}

function collectNumbers(value, out) {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, out);
  return out;
}

// One claimed number passes when its raw or comma-normalized text appears in
// the file, or its value matches a numeric value in the file to the rounding
// the claim itself uses ("16.1" must round-match 0.161 after the percent
// conversion).
function matchToken(token, normalized, numbers) {
  if (normalized.includes(token)) return true;
  const value = parseFloat(token.replace(/,/g, ''));
  const digits = token.replace(/,/g, '').split('.');
  const decimals = digits.length === 2 ? digits[1].length : 0;
  const tol = decimals === 0 ? 1e-9 : 0.5 * Math.pow(10, -decimals) + 1e-9;
  return numbers.some((v) => Math.abs(v - value) <= tol);
}

function verifyMeasured(claim, sourceAbs) {
  if (claim.trace.digest) {
    const digest = claim.trace.digest;
    if (fs.existsSync(sourceAbs) && /^[0-9a-f]{64}$/.test(digest)) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(sourceAbs)).digest('hex');
      if (hash !== digest) return `sha256 of ${claim.trace.source} is ${hash}, expected ${digest}`;
      return null;
    }
    // artifact absent (weights are gitignored): the pin must at least hold
    // in the recorded export ledger
    const ledgerText = normalizeText(fs.readFileSync(path.join(ROOT, LATENCY), 'utf8'));
    if (!ledgerText.includes(digest)) return `digest ${digest} absent from ${LATENCY}`;
    return null;
  }
  const text = normalizeText(fs.readFileSync(sourceAbs, 'utf8'));
  const numbers = [];
  if (/\.(json|jsonl)$/i.test(sourceAbs)) {
    try {
      collectNumbers(JSON.parse(text), numbers);
    } catch { /* not json; text rules still apply */ }
  }
  for (const m of text.matchAll(/-?\d(?:[\d,]*\d)?(?:\.\d+)?/g)) numbers.push(parseFloat(m[0].replace(/,/g, '')));
  for (const m of claim.statement.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*percent(?:age)? point)?/gi)) {
    const raw = m[1];
    const asPercent = String(parseFloat(raw.replace(/,/g, '')) / 100);
    // a "percent" claim verifies either as its recorded source value or as
    // the fraction it names
    if (!matchToken(raw, text, numbers) && !matchToken(asPercent, text, numbers)) {
      return `claimed number ${raw}${m[2] ? ' percent' : ''} not found in ${claim.trace.source}`;
    }
  }
  return null;
}

function verifyCitation(claim) {
  const src = claim.trace.source;
  const [file, anchor] = src.split('#');
  if (file !== REC) return `citation trace source must be ${REC}`;
  const recAbs = path.join(ROOT, REC);
  if (!fs.existsSync(recAbs)) return `verification record missing: ${REC}`;
  const record = fs.readFileSync(recAbs, 'utf8');
  if (anchor && !new RegExp(`#+\\s*${anchor}\\.`).test(record)) {
    return `anchor #${anchor} not found in ${REC}`;
  }
  const ids = [...claim.statement.matchAll(CITATION_ID_RE)].map((m) => m[1] || m[2] || m[3]);
  if (ids.length === 0 && !anchor) return `citation claim ${claim.id} names no source id or anchor`;
  for (const id of ids) {
    if (!record.includes(id)) return `citation id ${id} not found in ${REC}`;
  }
  return null;
}

function appendEntry(ledgerPath, entry) {
  let artifact = { kind: 'weft-claim-audit', schemaVersion: 1, appendOnly: true, entries: [] };
  if (fs.existsSync(ledgerPath)) {
    const prior = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (prior.kind !== 'weft-claim-audit' || prior.appendOnly !== true) {
      die('WEFT_CLAIM_AUDIT_ERROR', `refusing to append to an incompatible ledger: ${ledgerPath}`);
    }
    artifact = prior;
  }
  artifact.schemaVersion = 1;
  artifact.appendOnly = true;
  artifact.entries = artifact.entries || [];
  artifact.entries.push(entry);
  const payload = JSON.stringify(artifact, null, 2);
  const tmp = ledgerPath + `.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, ledgerPath);
  return artifact;
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.log('usage: node scripts/run-weft-claim-audit.mjs [--card MODEL_CARD.md] [--ledger results/weft-claim-audit.json] [--release release/]');
  process.exit(0);
}

const claims = parseClaimsBlock(args.card);

const sweep = runSweep(args.release);
if (sweep.length > 0) {
  const lines = sweep.map((h) => `${h.file}: ${h.token}`).join('\n  ');
  die('WEFT_CLAIM_BANNED_WORD', `banned literals in the release directory:\n  ${lines}`);
}
const sweepRecord = { filesScanned: listReleaseFiles(args.release).length, bannedHits: [] };

const runId = crypto.createHash('sha256')
  .update(canonicalJson({ claims, sweep: { filesScanned: sweepRecord.filesScanned, bannedHits: sweepRecord.bannedHits } }))
  .digest('hex');

if (fs.existsSync(args.ledger)) {
  const prior = JSON.parse(fs.readFileSync(args.ledger, 'utf8'));
  const priorEntry = (prior.entries || []).find((e) => e.runId === runId);
  if (priorEntry) {
    console.log(`no-op: runId ${runId.slice(0, 12)} already recorded (${priorEntry.verdicts.length} claims verified)`);
    process.exit(0);
  }
}

const verdicts = [];
for (const claim of claims) {
  const t = claim.trace;
  const [file] = t.source.split('#');
  const sourceAbs = t.kind === 'citation'
    ? path.join(ROOT, file)
    : path.resolve(ROOT, file);
  let error;
  if (t.kind === 'citation') {
    error = verifyCitation(claim);
  } else if (!fs.existsSync(sourceAbs) && !t.digest) {
    error = `traced source ${t.source} does not exist`;
  } else {
    error = verifyMeasured(claim, sourceAbs);
  }
  if (error) die('WEFT_CLAIM_MISMATCH', `claim ${claim.id}: ${error}`);
  verdicts.push({ id: claim.id, verdict: 'pass' });
}

const entry = {
  runId,
  ticket: 'W7',
  kind: 'weft-claim-audit',
  card: 'release/weft-specialist-v1/MODEL_CARD.md',
  claims,
  verdicts,
  sweep: sweepRecord,
  createdAt: new Date().toISOString(),
};
appendEntry(args.ledger, entry);
console.log(`appended claim-audit entry ${runId.slice(0, 12)}: ${verdicts.length} claims verified, sweep clean over ${sweepRecord.filesScanned} files`);
