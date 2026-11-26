import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACK_K_SCRIPT = path.join(ROOT, 'scripts', 'run-track-k-composition-head-to-head.py');
const TRACK_D_SCRIPT = path.join(ROOT, 'scripts', 'run-track-d-fair-lora.py');

function resolvePythonBin() {
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const cand of candidates) {
    const probe = spawnSync(cand, ['-c', 'import sys; print(sys.version)'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim()) return cand;
  }
  throw new Error('No working python interpreter found on PATH for CPU contract tests');
}

const PYTHON = resolvePythonBin();

function runPy(script, args, extraEnv = {}) {
  return spawnSync(PYTHON, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createMissingTorchStubDir() {
  const stubDir = makeTempDir('versieve-no-torch-');
  fs.writeFileSync(
    path.join(stubDir, 'torch.py'),
    'raise ImportError("simulated missing torch runtime for CPU fail-closed contract test")\n',
    'utf8'
  );
  return stubDir;
}

test('T10 Contract 1: Track K and Track D runners parse --help cleanly on CPU without GPU env', () => {
  const kHelp = runPy(TRACK_K_SCRIPT, ['--help']);
  assert.equal(kHelp.status, 0, `Track K --help failed: ${kHelp.stderr}`);
  assert.match(kHelp.stdout, /--retrieval-engine/);
  assert.match(kHelp.stdout, /--dry-run/);
  assert.match(kHelp.stdout, /--composed-corpus/);
  assert.match(kHelp.stdout, /--seed/);

  const dHelp = runPy(TRACK_D_SCRIPT, ['--help']);
  assert.equal(dHelp.status, 0, `Track D --help failed: ${dHelp.stderr}`);
  assert.match(dHelp.stdout, /--ablation-r4/);
  assert.match(dHelp.stdout, /--seeds/);
  assert.match(dHelp.stdout, /--ablation-arms/);
  assert.match(dHelp.stdout, /--dry-run/);
});

test('T10 Contract 2: Paper B retrieval_engine dry-run enforces zero-oracle entity routing, excludes canaries, and propagates seed deterministically', () => {
  const tmp = makeTempDir('versieve-t10-k-');
  try {
    // Deliberately poison oracle manifest fields (personId / world.people) to prove routing never reads them.
    const manifest = {
      seed: 20261126,
      documents: [{ path: 'rosters/r1.csv', modality: 'csv' }, { path: 'mail/m1.eml', modality: 'eml' }],
      world: {
        people: [
          {
            personId: 'poisoned-oracle-person',
            fullName: 'Wrong Oracle Person',
            emails: ['wrong@corp.example'],
            phone: '555-999-9999',
          },
        ],
      },
      questions: [
        {
          qid: 'q-01',
          stratum: 'Q1',
          personId: 'poisoned-oracle-person',
          attr: 'worksIn',
          expectedValue: 'Legal',
          docs: ['rosters/r1.csv'],
          question: 'Which department does Elena Vance work in?',
        },
        {
          qid: 'q-02',
          stratum: 'Q3',
          personId: 'poisoned-oracle-person',
          attr: 'worksIn',
          expectedValue: 'Finance',
          docs: ['mail/m1.eml'],
          question: 'Which department does Marcus Bell (the Specialist) work in?',
        },
      ],
    };

    const composedRows = [
      {
        id: 'aaaa1111',
        target: 'ent:person:Wrong Oracle Person',
        sources: [{ source: 'rosters/r1.csv', sourceRange: [0, 20] }],
        entities: ['ent:person:Wrong Oracle Person'],
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u' },
          { role: 'assistant', content: '[rosters/r1.csv] Wrong Oracle Person works in Decoy.' },
        ],
      },
      {
        id: 'bbbb2222',
        target: 'ent:person:ELENA',
        sources: [{ source: 'rosters/r1.csv', sourceRange: [0, 20] }],
        entities: ['ent:person:ELENA'],
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u' },
          { role: 'assistant', content: '[rosters/r1.csv] Short single-token entity record.' },
        ],
      },
      {
        id: 'cccc3333',
        target: 'ent:person:Elena Vance',
        sources: [{ source: 'rosters/r1.csv', sourceRange: [21, 80] }],
        entities: ['ent:person:Elena Vance', 'ent:email:elena.vance@corp.example'],
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u' },
          { role: 'assistant', content: '[rosters/r1.csv] Elena Vance works in Legal.' },
        ],
      },
      {
        // Fallback test: Marcus Bell appears only in `entities`, not `target`
        id: 'dddd4444',
        target: 'ent:email:m.bell@corp.example',
        sources: [{ source: 'mail/m1.eml', sourceRange: null }],
        entities: ['ent:person:Marcus Bell', 'ent:email:m.bell@corp.example'],
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u' },
          { role: 'assistant', content: '[mail/m1.eml] Marcus Bell (Specialist) works in Finance.' },
        ],
      },
      {
        id: 'can-01',
        kind: 'chat_canary',
        target: 'ent:person:Elena Vance',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u' },
          { role: 'assistant', content: 'CANARY_MUST_NEVER_BE_ROUTED' },
        ],
      },
    ];

    const manifestPath = path.join(tmp, 'manifest.json');
    const composedPath = path.join(tmp, 'composed.jsonl');
    const out1 = path.join(tmp, 'out1.json');
    const out2 = path.join(tmp, 'out2.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    fs.writeFileSync(composedPath, composedRows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const r1 = runPy(TRACK_K_SCRIPT, [
      '--retrieval-engine',
      '--dry-run',
      '--seed',
      '77',
      '--manifest',
      manifestPath,
      '--composed-corpus',
      composedPath,
      '--out',
      out1,
    ]);
    assert.equal(r1.status, 0, `dry-run 1 failed: ${r1.stderr}`);

    const r2 = runPy(TRACK_K_SCRIPT, [
      '--retrieval-engine',
      '--dry-run',
      '--seed',
      '77',
      '--manifest',
      manifestPath,
      '--composed-corpus',
      composedPath,
      '--out',
      out2,
    ]);
    assert.equal(r2.status, 0, `dry-run 2 failed: ${r2.stderr}`);

    const raw1 = fs.readFileSync(out1, 'utf8');
    const raw2 = fs.readFileSync(out2, 'utf8');
    assert.equal(raw1, raw2, 'dry-run JSON must be byte-identical across repeated invocations');

    const doc = JSON.parse(raw1);
    assert.equal(doc.kind, 'track-k-retrieval-engine');
    assert.equal(doc.dryRun, true);
    assert.equal(doc.seed, 77);
    assert.equal(doc.inputs.composedRecordCount, 4, 'chat_canary row must be excluded from routing pool');
    assert.equal(doc.arm.rows.length, 2);

    // q-01 must select longest full-name engine target 'ent:person:Elena Vance' (not 'ELENA', not poisoned oracle, not canary)
    const row1 = doc.arm.rows[0];
    assert.deepEqual(row1.matchedEngineEntityIds, ['ent:person:Elena Vance']);
    assert.deepEqual(row1.selectedRecordIds, ['cccc3333']);
    assert.equal(row1.fallbackUsed, false);

    // q-02 exercises entity-list fallback when no direct target matches
    const row2 = doc.arm.rows[1];
    assert.deepEqual(row2.matchedEngineEntityIds, ['ent:person:Marcus Bell']);
    assert.deepEqual(row2.selectedRecordIds, ['dddd4444']);
    assert.equal(row2.fallbackUsed, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T10 Contract 3: Paper C --ablation-r4 dry-run verifies masking_only vs surrogate_only vs ptlm vs safe token contracts and multi-seed propagation', () => {
  const tmp = makeTempDir('versieve-t10-d-');
  try {
    const safeRows = [];
    for (let i = 1; i <= 6; i++) {
      safeRows.push({
        id: `comp-${i}`,
        kind: 'chat_compliance',
        messages: [
          { role: 'system', content: 'Compliance assistant.' },
          { role: 'user', content: `Who handles compliance notice ${i}?` },
          {
            role: 'assistant',
            content: `Notice ${i} is reviewed by <PII:PERSON_${i}> via <PII:EMAIL_${i}> at <PII:ADDRESS_1>.`,
          },
        ],
      });
    }
    for (let i = 1; i <= 7; i++) {
      safeRows.push({
        id: `abst-${i}`,
        kind: 'chat_abstention',
        messages: [
          { role: 'system', content: 'Compliance assistant.' },
          { role: 'user', content: `Unanswerable query ${i}?` },
          { role: 'assistant', content: 'Not covered in the provided documents.' },
        ],
      });
    }

    const questions = [
      {
        id: 'q1',
        question: 'What is required under notice 1?',
        expected_out_of_scope: false,
        reference_answer: 'Reviewed by the privacy officer.',
        key_points: ['privacy officer'],
      },
      {
        id: 'q2',
        question: 'Out of scope question?',
        expected_out_of_scope: true,
        reference_answer: '',
        key_points: [],
      },
    ];

    const canaries = {
      canaries: [
        {
          canary_id: 'canary-01',
          type: 'email',
          secret: 'test-1111@example.test',
          sentence: 'Contact test-1111@example.test.',
          repetitions: 1,
        },
      ],
    };

    const safePath = path.join(tmp, 'safe.jsonl');
    const seenPath = path.join(tmp, 'seen.jsonl');
    const heldPath = path.join(tmp, 'held.jsonl');
    const canPath = path.join(tmp, 'canaries.json');
    const out1 = path.join(tmp, 'r4-1.json');
    const out2 = path.join(tmp, 'r4-2.json');

    fs.writeFileSync(safePath, safeRows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    fs.writeFileSync(seenPath, questions.slice(0, 1).map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    fs.writeFileSync(heldPath, questions.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    fs.writeFileSync(canPath, JSON.stringify(canaries, null, 2), 'utf8');

    const baseArgs = [
      '--ablation-r4',
      '--dry-run',
      '--seeds',
      '42,43,44',
      '--models',
      'qwen05b,qwen15b',
      '--safe-train',
      safePath,
      '--seen-20q',
      seenPath,
      '--heldout-50q',
      heldPath,
      '--canaries',
      canPath,
    ];

    const r1 = runPy(TRACK_D_SCRIPT, [...baseArgs, '--ablation-out', out1]);
    assert.equal(r1.status, 0, `Track D dry-run 1 failed: ${r1.stderr}`);
    const r2 = runPy(TRACK_D_SCRIPT, [...baseArgs, '--ablation-out', out2]);
    assert.equal(r2.status, 0, `Track D dry-run 2 failed: ${r2.stderr}`);

    assert.equal(fs.readFileSync(out1, 'utf8'), fs.readFileSync(out2, 'utf8'), 'Track D dry-run must be deterministic');

    const doc = JSON.parse(fs.readFileSync(out1, 'utf8'));
    assert.equal(doc.kind, 'track-d-ptlm-multiseed-ablation');
    assert.equal(doc.dryRun, true);
    assert.deepEqual(doc.seeds, [42, 43, 44]);
    assert.deepEqual(doc.arms, ['safe', 'masking_only', 'surrogate_only', 'ptlm']);
    assert.equal(doc.plannedRuns.length, 2 * 4 * 3, '2 models x 4 arms x 3 seeds = 24 planned runs');

    const fc = doc.featureContracts;
    // 1. safe: keeps all 13 rows, literal <PII:...> in input_ids AND unmasked in labels
    assert.equal(fc.safe.rows, 13);
    assert.ok(fc.safe.bracketPlaceholderTokensInInputIds > 0);
    assert.equal(fc.safe.bracketPlaceholderTokensUnmaskedInLabels, fc.safe.bracketPlaceholderTokensInInputIds);

    // 2. masking_only: keeps all 13 rows, literal <PII:...> in input_ids (NO forward substitution), 0 unmasked in labels
    assert.equal(fc.masking_only.rows, 13);
    assert.equal(fc.masking_only.bracketPlaceholderTokensInInputIds, fc.safe.bracketPlaceholderTokensInInputIds);
    assert.equal(fc.masking_only.bracketPlaceholderTokensUnmaskedInLabels, 0);
    assert.ok(fc.masking_only.stats.masked_pii_subwords > 0);

    // 3. surrogate_only: keeps all 13 rows, 0 <PII:...> in input_ids (substituted), NO backward loss masking on assistant tokens
    assert.equal(fc.surrogate_only.rows, 13);
    assert.equal(fc.surrogate_only.bracketPlaceholderTokensInInputIds, 0);
    assert.equal(fc.surrogate_only.bracketPlaceholderTokensUnmaskedInLabels, 0);
    assert.ok(fc.surrogate_only.stats.substituted_subwords > 0);
    assert.equal(
      fc.surrogate_only.maskedLabelTokensTotal,
      fc.safe.maskedLabelTokensTotal,
      'surrogate_only must mask ONLY prompt tokens, never assistant surrogate tokens'
    );

    // 4. ptlm: subsamples abstention rows, 0 <PII:...> in input_ids, 0 unmasked placeholder tokens in labels
    assert.ok(fc.ptlm.rows < fc.safe.rows, 'ptlm subsamples scope-balancing abstention rows');
    assert.equal(fc.ptlm.bracketPlaceholderTokensInInputIds, 0);
    assert.equal(fc.ptlm.bracketPlaceholderTokensUnmaskedInLabels, 0);
    assert.ok(fc.ptlm.stats.masked_pii_subwords > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T10 Contract 4: Both runners fail closed loudly with exit code 2 when ML runtime or inputs are missing', () => {
  const noTorchDir = createMissingTorchStubDir();
  const tmp = makeTempDir('versieve-t10-failclosed-');
  try {
    const pyPath = noTorchDir + (process.platform === 'win32' ? ';' : ':') + (process.env.PYTHONPATH || '');

    // Track K live mode without torch -> fail closed
    const kFail = runPy(
      TRACK_K_SCRIPT,
      ['--retrieval-engine', '--out', path.join(tmp, 'k-out.json')],
      { PYTHONPATH: pyPath }
    );
    assert.equal(kFail.status, 2, 'Track K must exit with code 2 when torch runtime is missing');
    assert.match(kFail.stderr, /fail-closed/i);
    assert.match(kFail.stderr, /torch/i);

    // Track K missing manifest -> fail closed
    const kMissingFile = runPy(TRACK_K_SCRIPT, [
      '--retrieval-engine',
      '--dry-run',
      '--manifest',
      path.join(tmp, 'nonexistent-manifest.json'),
      '--out',
      path.join(tmp, 'k-out2.json'),
    ]);
    assert.equal(kMissingFile.status, 2);
    assert.match(kMissingFile.stderr, /fail-closed/i);

    // Track D live --ablation-r4 with invalid arm -> fail closed
    const dBadArm = runPy(TRACK_D_SCRIPT, [
      '--ablation-r4',
      '--dry-run',
      '--ablation-arms',
      'safe,unknown_arm',
      '--ablation-out',
      path.join(tmp, 'd-out.json'),
    ]);
    assert.equal(dBadArm.status, 2);
    assert.match(dBadArm.stderr, /fail-closed/i);

    // Track D default mode without torch -> fail closed
    const dNoTorch = runPy(TRACK_D_SCRIPT, ['--models', 'qwen05b'], { PYTHONPATH: pyPath });
    assert.equal(dNoTorch.status, 2);
    assert.match(dNoTorch.stderr, /fail-closed/i);
    assert.match(dNoTorch.stderr, /torch/i);
  } finally {
    fs.rmSync(noTorchDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T10 Contract 5: Committed Paper B retrieval_engine and Paper C multi-seed artifacts match exact output schemas', () => {
  const kArtifactPath = path.join(ROOT, 'results', 'track-k-retrieval-engine.json');
  assert.ok(fs.existsSync(kArtifactPath), 'results/track-k-retrieval-engine.json must exist');
  const kDoc = JSON.parse(fs.readFileSync(kArtifactPath, 'utf8'));
  assert.equal(kDoc.kind, 'track-k-retrieval-engine');
  assert.equal(kDoc.dryRun, false);
  assert.equal(kDoc.seed, 42);
  assert.ok(kDoc.hardware?.gpuName, 'Paper B artifact must record GPU hardware name');
  assert.ok(kDoc.models?.judges?.['qwen2.5:7b']?.digest, 'Paper B artifact must record qwen2.5:7b digest');
  assert.ok(kDoc.models?.judges?.['llama3.2:3b']?.digest, 'Paper B artifact must record llama3.2:3b digest');
  assert.equal(kDoc.estate.questions, 60);
  assert.deepEqual(kDoc.estate.strata, { Q1: 24, Q2: 24, Q3: 12 });
  assert.equal(kDoc.arm.rows.length, 60);
  for (const r of kDoc.arm.rows) {
    assert.equal(typeof r.exact_match, 'boolean');
    assert.ok(Number.isInteger(r.judge_score) && r.judge_score >= 0 && r.judge_score <= 2);
    assert.ok(Number.isInteger(r.llama_judge_score) && r.llama_judge_score >= 0 && r.llama_judge_score <= 2);
    assert.ok(Array.isArray(r.matchedEngineEntityIds) && r.matchedEngineEntityIds.length >= 1);
  }
  assert.ok(kDoc.comparisons?.cag_hybrid?.mcnemar, 'Must include McNemar comparison vs oracle cag_hybrid');
  assert.ok(kDoc.comparisons?.bm25_retrieval?.mcnemar, 'Must include McNemar comparison vs bm25_retrieval');
  assert.ok(kDoc.comparisons?.retrieval?.mcnemar, 'Must include McNemar comparison vs Graph-PPR retrieval');

  const dArtifactPath = path.join(ROOT, 'results', 'track-d-ptlm-multiseed-ablation.json');
  assert.ok(fs.existsSync(dArtifactPath), 'results/track-d-ptlm-multiseed-ablation.json must exist');
  const dDoc = JSON.parse(fs.readFileSync(dArtifactPath, 'utf8'));
  assert.equal(dDoc.kind, 'track-d-ptlm-multiseed-ablation');
  assert.equal(dDoc.dryRun, false);
  assert.deepEqual(dDoc.seeds, [42, 43, 44]);
  assert.deepEqual(dDoc.arms, ['safe', 'masking_only', 'surrogate_only', 'ptlm']);
  assert.ok(dDoc.hardware?.gpuName, 'Paper C artifact must record GPU hardware name');
  for (const mk of ['qwen05b', 'qwen15b', 'lfm3']) {
    const m = dDoc.models?.[mk];
    assert.ok(m, `Missing model ${mk} in Paper C multi-seed artifact`);
    for (const ak of ['safe', 'masking_only', 'surrogate_only', 'ptlm']) {
      const a = m.arms?.[ak];
      assert.ok(a, `Missing arm ${mk}/${ak}`);
      assert.deepEqual(a.seedsCompleted, [42, 43, 44]);
      for (const metric of ['seen_in_f1', 'seen_pii_tag_echo_pct', 'in_scope_false_refusal_pct', 'canary_all_12_bits']) {
        assert.equal(typeof a[metric]?.mean, 'number');
        assert.equal(a[metric]?.tCi95?.length, 2);
        assert.equal(a[metric]?.bootstrapCi95?.length, 2);
      }
    }
  }
});
