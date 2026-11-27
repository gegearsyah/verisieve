import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function findPythonExecutable() {
  const candidates = [
    process.env.PYTHON,
    'python',
    'python3',
    'D:/rtio-lfm3-gpu-env/Scripts/python.exe',
  ].filter(Boolean);
  for (const cmd of candidates) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (res.status === 0) return cmd;
  }
  throw new Error('No Python 3 interpreter found on PATH for contract tests');
}

const PYTHON = findPythonExecutable();

function runPy(scriptRel, args = [], extraEnv = {}) {
  return spawnSync(PYTHON, [path.join(REPO_ROOT, scriptRel), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, ...extraEnv },
  });
}

function createTinySyntheticEstate(tmpDir) {
  const estateDir = path.join(tmpDir, 'estate');
  fs.mkdirSync(path.join(estateDir, 'rosters'), { recursive: true });
  fs.mkdirSync(path.join(estateDir, 'memos'), { recursive: true });

  const rosterSql = [
    'CREATE TABLE roster (full_name TEXT, email TEXT, phone TEXT, department TEXT, project TEXT);',
    "INSERT INTO roster VALUES ('Elena Asante', elena.asante@corp.example, 555-059-9319, 'Legal', 'FALLOW');",
    "INSERT INTO roster VALUES ('Marcus Bell', marcus.bell@corp.example, 555-034-2279, 'Finance', 'HARVEST');",
    "INSERT INTO roster VALUES ('Petra Ferreira', petra.ferreira@corp.example, 555-084-2797, 'Operations', 'DELTIC');",
  ].join('\n');
  const memoTxt = [
    'Quarterly Staffing Memo (2026-04)',
    'Elena Asante serves as Lead Counsel. Elena Asante joined in May 2025.',
    'Marcus Bell serves as Controller. Marcus Bell joined in June 2025.',
    'Petra Ferreira serves as Site Lead. Petra Ferreira joined in July 2025.',
  ].join('\n');

  fs.writeFileSync(path.join(estateDir, 'rosters', 'roster-01.sql'), rosterSql, 'utf8');
  fs.writeFileSync(path.join(estateDir, 'memos', 'memo-01.txt'), memoTxt, 'utf8');

  const manifestPath = path.join(tmpDir, 'manifest.json');
  const manifest = {
    kind: 'tiny-synthetic-estate-manifest',
    seed: 123,
    documents: [
      { path: 'rosters/roster-01.sql', modality: 'roster' },
      { path: 'memos/memo-01.txt', modality: 'memo' },
    ],
    world: {
      people: [
        {
          personId: 'person-001',
          fullName: 'Elena Asante',
          emails: ['elena.asante@corp.example'],
          phone: '555-059-9319',
          department: 'Legal',
          title: 'Lead Counsel',
          joinDate: 'May 2025',
          project: 'FALLOW',
        },
        {
          personId: 'person-002',
          fullName: 'Marcus Bell',
          emails: ['marcus.bell@corp.example'],
          phone: '555-034-2279',
          department: 'Finance',
          title: 'Controller',
          joinDate: 'June 2025',
          project: 'HARVEST',
        },
        {
          personId: 'person-003',
          fullName: 'Petra Ferreira',
          emails: ['petra.ferreira@corp.example'],
          phone: '555-084-2797',
          department: 'Operations',
          title: 'Site Lead',
          joinDate: 'July 2025',
          project: 'DELTIC',
        },
      ],
      collisionPairs: [],
    },
    mentions: [
      { personId: 'person-001', doc: 'rosters/roster-01.sql' },
      { personId: 'person-001', doc: 'memos/memo-01.txt' },
      { personId: 'person-002', doc: 'rosters/roster-01.sql' },
      { personId: 'person-002', doc: 'memos/memo-01.txt' },
      { personId: 'person-003', doc: 'rosters/roster-01.sql' },
      { personId: 'person-003', doc: 'memos/memo-01.txt' },
    ],
    facts: [
      { factId: 'f-1', personId: 'person-001', attr: 'worksIn', value: 'Legal', singleDoc: true, docs: ['rosters/roster-01.sql'] },
      { factId: 'f-2', personId: 'person-002', attr: 'titled', value: 'Controller', singleDoc: false, docs: ['memos/memo-01.txt'] },
    ],
    questions: [
      {
        qid: 'q-01',
        stratum: 'Q1',
        personId: 'person-001',
        attr: 'worksIn',
        expectedValue: 'Legal',
        docs: ['rosters/roster-01.sql'],
        question: 'Which department does Elena Asante work in?',
      },
      {
        qid: 'q-02',
        stratum: 'Q2',
        personId: 'person-002',
        attr: 'titled',
        expectedValue: 'Controller',
        docs: ['memos/memo-01.txt'],
        question: 'What title does Marcus Bell hold currently?',
      },
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { estateDir, manifestPath };
}

test('T11: all three runners support --help cleanly', () => {
  const scripts = [
    'scripts/run-scanner-missed-canaries.py',
    'scripts/run-cpa-attacker-audit.py',
    'scripts/run-scale-qa-training.py',
  ];
  for (const s of scripts) {
    const res = runPy(s, ['--help']);
    assert.equal(res.status, 0, `${s} --help exited with ${res.status}: ${res.stderr}`);
    assert.match(res.stdout, /--dry-run/);
    assert.match(res.stdout, /--seed/);
    assert.match(res.stdout, /--out/);
  }
});

test('T11: all three runners fail closed (exit code 2, zero fabricated output) when required runtimes/models are missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't11-fail-closed-'));
  try {
    const { estateDir, manifestPath } = createTinySyntheticEstate(tmp);
    const missingDir = path.join(tmp, 'does-not-exist');

    // 1. Scanner-missed canaries fails closed when local model/ONNX weights are absent
    const out1 = path.join(tmp, 'out1.json');
    const r1 = runPy('scripts/run-scanner-missed-canaries.py', [
      '--estate-dir', estateDir,
      '--model-id', 'NonExistent/MissingLocalModel-0.5B',
      '--gliner-model-dir', missingDir,
      '--allow-cpu',
      '--out', out1,
    ], { HF_HOME: missingDir });
    assert.equal(r1.status, 2, `Expected exit 2, got ${r1.status}: ${r1.stderr}`);
    assert.equal(fs.existsSync(out1), false, 'Must not write artifact on fail-closed exit');
    assert.match(r1.stderr, /"ok":\s*false/);

    // 2. CPA attacker audit fails closed when Ollama or TAB splits are absent
    const out2 = path.join(tmp, 'out2.json');
    const r2 = runPy('scripts/run-cpa-attacker-audit.py', [
      '--tab-dir', missingDir,
      '--ollama-url', 'http://127.0.0.1:1',
      '--out', out2,
    ]);
    assert.equal(r2.status, 2, `Expected exit 2, got ${r2.status}: ${r2.stderr}`);
    assert.equal(fs.existsSync(out2), false, 'Must not write artifact on fail-closed exit');
    assert.match(r2.stderr, /"ok":\s*false/);

    // 3. Scale QA training fails closed when <500 questions or missing local model in live mode
    const out3 = path.join(tmp, 'out3.json');
    const r3 = runPy('scripts/run-scale-qa-training.py', [
      '--estate-dir', estateDir,
      '--manifest', manifestPath,
      '--target-questions', '10',
      '--seeds', '42,43,44',
      '--out', out3,
    ]);
    assert.equal(r3.status, 2, `Expected exit 2 for <500 live questions, got ${r3.status}`);
    assert.equal(fs.existsSync(out3), false);
    assert.match(r3.stderr, /INSUFFICIENT_QUESTIONS/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T11: CPU-safe --dry-run on tiny synthetic fixtures is deterministic and propagates --seed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't11-dryrun-'));
  try {
    const { estateDir, manifestPath } = createTinySyntheticEstate(tmp);

    // 1. Scanner-missed canaries dry-run determinism + seed change
    const canA = path.join(tmp, 'can-a.json');
    const canB = path.join(tmp, 'can-b.json');
    const canC = path.join(tmp, 'can-c.json');
    assert.equal(
      runPy('scripts/run-scanner-missed-canaries.py', ['--dry-run', '--estate-dir', estateDir, '--candidate-count', '40', '--bootstraps', '50', '--seed', '101', '--out', canA]).status,
      0
    );
    assert.equal(
      runPy('scripts/run-scanner-missed-canaries.py', ['--dry-run', '--estate-dir', estateDir, '--candidate-count', '40', '--bootstraps', '50', '--seed', '101', '--out', canB]).status,
      0
    );
    assert.equal(
      runPy('scripts/run-scanner-missed-canaries.py', ['--dry-run', '--estate-dir', estateDir, '--candidate-count', '40', '--bootstraps', '50', '--seed', '202', '--out', canC]).status,
      0
    );
    assert.equal(fs.readFileSync(canA, 'utf8'), fs.readFileSync(canB, 'utf8'));
    const parsedCanA = JSON.parse(fs.readFileSync(canA, 'utf8'));
    const parsedCanC = JSON.parse(fs.readFileSync(canC, 'utf8'));
    assert.equal(parsedCanA.seed, 101);
    assert.equal(parsedCanC.seed, 202);
    assert.notDeepEqual(parsedCanA.arms.base.exposure.perCanary, parsedCanC.arms.base.exposure.perCanary);

    // 2. CPA attacker audit dry-run determinism + seed change
    const cpaA = path.join(tmp, 'cpa-a.json');
    const cpaB = path.join(tmp, 'cpa-b.json');
    const cpaC = path.join(tmp, 'cpa-c.json');
    assert.equal(
      runPy('scripts/run-cpa-attacker-audit.py', ['--dry-run', '--cal-sample', '12', '--released-sample', '15', '--withheld-sample', '15', '--bootstraps', '50', '--permutations', '100', '--seed', '101', '--out', cpaA]).status,
      0
    );
    assert.equal(
      runPy('scripts/run-cpa-attacker-audit.py', ['--dry-run', '--cal-sample', '12', '--released-sample', '15', '--withheld-sample', '15', '--bootstraps', '50', '--permutations', '100', '--seed', '101', '--out', cpaB]).status,
      0
    );
    assert.equal(
      runPy('scripts/run-cpa-attacker-audit.py', ['--dry-run', '--cal-sample', '12', '--released-sample', '15', '--withheld-sample', '15', '--bootstraps', '50', '--permutations', '100', '--seed', '202', '--out', cpaC]).status,
      0
    );
    assert.equal(fs.readFileSync(cpaA, 'utf8'), fs.readFileSync(cpaB, 'utf8'));
    const parsedCpaA = JSON.parse(fs.readFileSync(cpaA, 'utf8'));
    const parsedCpaC = JSON.parse(fs.readFileSync(cpaC, 'utf8'));
    assert.equal(parsedCpaA.seed, 101);
    assert.equal(parsedCpaC.seed, 202);
    assert.notDeepEqual(parsedCpaA.auditedItems.released, parsedCpaC.auditedItems.released);

    // 3. Scale QA training dry-run determinism + seed propagation on tiny synthetic fixture
    const sqaA = path.join(tmp, 'sqa-a.json');
    const sqaB = path.join(tmp, 'sqa-b.json');
    const sqaC = path.join(tmp, 'sqa-c.json');
    const workDir = path.join(tmp, 'work');
    assert.equal(
      runPy('scripts/run-scale-qa-training.py', ['--dry-run', '--estate-dir', estateDir, '--manifest', manifestPath, '--target-questions', '12', '--seeds', '11,12,13', '--bootstraps', '50', '--seed', '101', '--work-dir', workDir, '--out', sqaA]).status,
      0
    );
    assert.equal(
      runPy('scripts/run-scale-qa-training.py', ['--dry-run', '--estate-dir', estateDir, '--manifest', manifestPath, '--target-questions', '12', '--seeds', '11,12,13', '--bootstraps', '50', '--seed', '101', '--work-dir', workDir, '--out', sqaB]).status,
      0
    );
    assert.equal(
      runPy('scripts/run-scale-qa-training.py', ['--dry-run', '--estate-dir', estateDir, '--manifest', manifestPath, '--target-questions', '12', '--seeds', '21,22,23', '--bootstraps', '50', '--seed', '202', '--work-dir', workDir, '--out', sqaC]).status,
      0
    );
    assert.equal(fs.readFileSync(sqaA, 'utf8'), fs.readFileSync(sqaB, 'utf8'));
    const parsedSqaA = JSON.parse(fs.readFileSync(sqaA, 'utf8'));
    const parsedSqaC = JSON.parse(fs.readFileSync(sqaC, 'utf8'));
    assert.deepEqual(parsedSqaA.seeds, [11, 12, 13]);
    assert.deepEqual(parsedSqaC.seeds, [21, 22, 23]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T11: committed live artifacts satisfy full schema, >=500 questions, >=3 seeds, CPA fields, and provenance invariants', () => {
  const hex64 = /^[a-f0-9]{64}$/;

  // 1. Scanner-Missed Canaries artifact
  const canPath = path.join(REPO_ROOT, 'results', 't11-scanner-missed-canaries.json');
  assert.ok(fs.existsSync(canPath), 'Missing results/t11-scanner-missed-canaries.json');
  const can = JSON.parse(fs.readFileSync(canPath, 'utf8'));
  assert.equal(can.schemaVersion, 'versieve.t11.scanner-missed-canaries.v1');
  assert.equal(can.dryRun, false);
  assert.equal(can.seed, 42);
  assert.ok(can.resampleCount >= 1000);
  assert.ok(can.candidateDecoysPerCanary >= 1000);
  assert.equal(can.hardware.cudaAvailable, true);
  assert.ok(typeof can.hardware.gpuName === 'string' && can.hardware.gpuName.length > 0);
  assert.match(can.models.causalLm.configSha256, hex64);
  assert.match(can.models.stage3bDetector.onnxSha256, hex64);
  assert.equal(can.canarySuite.scannerMissedCount, 12);
  assert.equal(can.canarySuite.scannerCaughtCount, 12);
  assert.deepEqual(
    can.canarySuite.scannerMissedCategories,
    ['bare_lowercase_name', 'freeform_street_address', 'alphanumeric_username', 'prose_employer_team']
  );
  for (const arm of ['base', 'unredacted', 'stage3a_safe', 'stage3a_ptlm', 'stage3a_3b_safe', 'stage3a_3b_ptlm']) {
    assert.ok(can.arms[arm], `Missing canary arm ${arm}`);
    for (const stratum of ['scannerMissedFormats', 'scannerCaughtFormats', 'allCanaries']) {
      const s = can.arms[arm].exposure[stratum];
      assert.ok(s && typeof s.meanExposureBits === 'number');
      assert.ok(Array.isArray(s.exposureBitsBootstrap95CI) && s.exposureBitsBootstrap95CI.length === 2);
      assert.ok(Number.isInteger(s.r1Count) && s.r1Count >= 0 && s.r1Count <= s.total);
      assert.match(s.r1Fraction, /^\d+\/\d+$/);
    }
  }

  // 2. CPA Attacker Re-ID Audit artifact
  const cpaPath = path.join(REPO_ROOT, 'results', 't11-cpa-attacker-audit.json');
  assert.ok(fs.existsSync(cpaPath), 'Missing results/t11-cpa-attacker-audit.json');
  const cpa = JSON.parse(fs.readFileSync(cpaPath, 'utf8'));
  assert.equal(cpa.schemaVersion, 'versieve.t11.cpa-attacker-audit.v1');
  assert.equal(cpa.dryRun, false);
  assert.equal(cpa.seed, 42);
  assert.ok(cpa.resampleCount >= 1000);
  assert.equal(cpa.protocol.primaryCitation, 'arXiv:2609.21340');
  assert.match(cpa.models.attackerLlm.digest, hex64);
  assert.match(cpa.models.stage3bDetector.onnxSha256, hex64);
  for (const group of ['released', 'withheld']) {
    const g = cpa[group];
    assert.ok(g && g.n >= 30, `Expected ${group}.n >= 30`);
    assert.ok(typeof g.top1ReIdRatePct === 'number');
    assert.ok(Array.isArray(g.top1ClopperPearson95CI) && g.top1ClopperPearson95CI.length === 2);
    assert.ok(Array.isArray(g.top1Bootstrap95CI) && g.top1Bootstrap95CI.length === 2);
    assert.ok(typeof g.meanAmbiguitySetSize === 'number' && g.meanAmbiguitySetSize >= 1.0);
    assert.ok(Array.isArray(g.ambiguitySetSizeBootstrap95CI) && g.ambiguitySetSizeBootstrap95CI.length === 2);
  }
  assert.ok(typeof cpa.hypothesisTests.fisherExactTop1.pValueTwoSided === 'number');
  assert.ok(typeof cpa.hypothesisTests.withinRulingPairedAudit.mcnemarTwoSidedPValue === 'number');

  // 3. Full-Scale QA Training artifact
  const sqaPath = path.join(REPO_ROOT, 'results', 't11-scale-qa-training.json');
  assert.ok(fs.existsSync(sqaPath), 'Missing results/t11-scale-qa-training.json');
  const sqa = JSON.parse(fs.readFileSync(sqaPath, 'utf8'));
  assert.equal(sqa.schemaVersion, 'versieve.t11.scale-qa-training.v1');
  assert.equal(sqa.dryRun, false);
  assert.ok(Array.isArray(sqa.seeds) && sqa.seeds.length >= 3);
  assert.deepEqual(sqa.seeds.slice(0, 3), [42, 43, 44]);
  assert.ok(sqa.questionSuite.totalQuestions >= 500, `Expected >=500 questions, got ${sqa.questionSuite.totalQuestions}`);
  assert.match(sqa.questionSuite.manifestSha256, hex64);
  assert.equal(sqa.hardware.cudaAvailable, true);
  assert.match(sqa.models.causalLm.configSha256, hex64);
  assert.equal(sqa.exporterProvenance.vaultedDocumentQaManifest.schema, 'versieve-training-export-v1');
  assert.equal(sqa.exporterProvenance.vaultedDocumentQaManifest.zeroEgress, true);

  for (const arm of ['flat_uncapped', 'composed_uncapped', 'document_qa']) {
    const a = sqa.arms[arm];
    assert.ok(a && a.trained === true, `Missing trained arm ${arm}`);
    assert.equal(a.tokenAccounting.truncatedRows, 0, `${arm} must have 0 truncated rows (41-row cap removed)`);
    assert.ok(a.seedsCompleted.length >= 3);
    assert.ok(typeof a.byStratum.all.exactMatchMeanPct === 'number');
    assert.ok(Array.isArray(a.byStratum.all.exactMatchBootstrap95CI) && a.byStratum.all.exactMatchBootstrap95CI.length === 2);
    assert.ok(typeof a.byStratum.all.tokenF1MeanPct === 'number');
    assert.ok(Array.isArray(a.byStratum.all.tokenF1Bootstrap95CI) && a.byStratum.all.tokenF1Bootstrap95CI.length === 2);
  }
  assert.ok(sqa.arms.composed_uncapped.tokenAccounting.rows > 41, 'composed_uncapped must exceed the old 41-row cap');
  for (const retArm of ['bm25_retrieval', 'graph_ppr_retrieval']) {
    assert.ok(typeof sqa.arms[retArm].eval.all.exactMatchPct === 'number');
  }
  for (const cmpKey of ['documentQa_vs_bm25Retrieval', 'documentQa_vs_graphPprRetrieval', 'documentQa_vs_composedUncapped', 'documentQa_vs_flatUncapped']) {
    assert.ok(typeof sqa.comparisons[cmpKey].exactMatchPctGap.meanGap === 'number');
    assert.ok(Array.isArray(sqa.comparisons[cmpKey].exactMatchPctGap.bootstrap95CI));
  }

  // 4. Zero hardcoded user home paths across all 7 scoped T11 files
  for (const rel of [
    'scripts/run-scanner-missed-canaries.py',
    'scripts/run-cpa-attacker-audit.py',
    'scripts/run-scale-qa-training.py',
    'results/t11-scanner-missed-canaries.json',
    'results/t11-cpa-attacker-audit.json',
    'results/t11-scale-qa-training.json',
    'test/adversarial-audit-and-scale-training.test.js',
  ]) {
    const txt = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(txt, /C:[\\\/]+Users[\\\/]+GEYE/i, `Hardcoded user path in ${rel}`);
  }
});
