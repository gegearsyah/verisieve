import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  perceive,
  perceiveMulti,
  createDetectorAdapter,
  runShadowAudit,
  extractCanonicalNumericTokens,
  verifyNumericIntegrity,
  computeEntitySortedMerkleRoot,
  computeMerkleProof,
  verifyMerkleProof,
  computeEgoGraphTelemetry,
  buildAmnesiacCorpus,
  eraseEntity,
} from '../src/index.js';

import { computeEgoGraphTelemetry as egoFromCorpus } from '../src/amnesiac-corpus.js';
import { computeEgoGraphTelemetry as egoFromPerceive } from '../src/perceive.js';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const CORPUS_FIXTURE = [
  {
    name: 'contracts/msa.txt',
    text: 'Vendor agreement between Acme GmbH and Ravi Chandra.\nInvoice queries go to ravi.chandra@corp.example.\nPayment terms are net 30 days from receipt.',
  },
  {
    name: 'notes/audit.txt',
    text: 'Audit sign-off pending from Ravi Chandra.\nThe reminder went to ravi.chandra@corp.example on Monday.',
  },
  {
    name: 'ops/runbook.txt',
    text: 'Console deployment uses ghp_0123456789abcdefghijklmnopqrstuvwxyzAB and rotates it after the migration.',
  },
  {
    name: 'ops/handbook.txt',
    text: 'The handbook lists the staging endpoint, the backup cadence, and the review rota.',
  },
];

// ---------------------------------------------------------------------------
// 0. Public Seam & Backwards-Compatibility Invariants
// ---------------------------------------------------------------------------
test('Public seam exports and default receipt backwards compatibility remain 100% intact', async () => {
  assert.equal(typeof runShadowAudit, 'function');
  assert.equal(typeof extractCanonicalNumericTokens, 'function');
  assert.equal(typeof verifyNumericIntegrity, 'function');
  assert.equal(typeof computeEntitySortedMerkleRoot, 'function');
  assert.equal(typeof computeMerkleProof, 'function');
  assert.equal(typeof verifyMerkleProof, 'function');
  assert.equal(typeof computeEgoGraphTelemetry, 'function');
  assert.equal(egoFromCorpus, egoFromPerceive, 'computeEgoGraphTelemetry binding must be identical across modules');

  const base = await perceive(
    { name: 'memo.txt', text: 'Contact Elena Vance at elena.vance@acme.com regarding Clause 14.2 ($1,250.50).' },
    { workspaceSalt: 't5-compat-salt' }
  );
  assert.equal('shadowAudit' in base, false, 'Default perceive() must omit shadowAudit');
  assert.equal('residualLeakageReport' in base, false, 'Default perceive() must omit residualLeakageReport');
  assert.equal('numericIntegrity' in base, false, 'Default perceive() must omit numericIntegrity');
  assert.equal('egoGraphTelemetry' in base, false, 'Default perceive() must omit egoGraphTelemetry');
  assert.equal('shadowAudit' in base.receipt, false, 'Default receipt must stay backwards-compatible');
  assert.equal('numericIntegrity' in base.receipt, false, 'Default receipt must stay backwards-compatible');
  assert.equal('egoGraphTelemetry' in base.receipt, false, 'Default receipt must stay backwards-compatible');

  const explicitOff = await perceive(
    { name: 'memo.txt', text: 'Contact Elena Vance at elena.vance@acme.com regarding Clause 14.2 ($1,250.50).' },
    { workspaceSalt: 't5-compat-salt', shadowAudit: false, numGuard: false }
  );
  assert.deepEqual(explicitOff.receipt, base.receipt, 'Explicit false options must match default receipt byte-for-byte');
});

// ---------------------------------------------------------------------------
// 1. Shadow Audit & Per-Run Residual Leakage Report
// ---------------------------------------------------------------------------
test('Shadow audit verifies zero-residual pass state across Stage 3A & Stage 3B and auto-enables in strict/compliance mode', async () => {
  const customNer = createDetectorAdapter({
    id: 'local-codename-ner',
    kind: 'text',
    provenanceTag: 'gliner:codename-local',
    detect: ({ text }) => {
      const needle = 'project nightfall';
      const idx = text.toLowerCase().indexOf(needle);
      if (idx === -1) return [];
      return [
        {
          entityType: 'PROJECT_CODE',
          start: idx,
          end: idx + needle.length,
          score: 0.93,
          provenanceTag: 'gliner:codename-local',
        },
      ];
    },
  });

  const res = await perceiveMulti(
    [
      {
        name: 'clinical.txt',
        text: 'Patient Elena Vance (SSN 123-45-6789, MRN: AB-992811, DEA: AB1234563) enrolled in project nightfall.',
      },
      {
        name: 'ops.txt',
        text: 'Deploy token AKIAIOSFODNN7X9K2M4P rotated by elena.vance@hospital.org.',
      },
    ],
    {
      workspaceSalt: 't5-shadow-pass',
      detectors: [customNer],
      shadowAudit: true,
    }
  );

  assert.ok(res.shadowAudit, 'shadowAudit report must be emitted when shadowAudit: true');
  assert.deepEqual(res.residualLeakageReport, res.shadowAudit, 'residualLeakageReport alias must match shadowAudit');
  assert.deepEqual(res.receipt.shadowAudit, res.shadowAudit, 'shadowAudit must be embedded in provenance receipt');
  assert.equal(res.shadowAudit.status, 'pass_zero_residual');
  assert.equal(res.shadowAudit.passed, true);
  assert.equal(res.shadowAudit.residualCount, 0);
  assert.deepEqual(res.shadowAudit.newlyDiscoveredResidualSpans, []);
  assert.deepEqual(res.shadowAudit.entityClassBreakdown, {});
  assert.ok(res.shadowAudit.detectorsRun.stage3a.includes('wasm_stage3a'));
  assert.ok(res.shadowAudit.detectorsRun.stage3a.includes('hipaa_stage3a'));
  assert.deepEqual(res.shadowAudit.detectorsRun.stage3b, ['local-codename-ner']);

  // Compliance / strict mode enables shadowAudit automatically unless explicitly disabled
  const complianceRes = await perceive(
    'Counsel Elena Vance (elena.vance@acme.com) reviewed the filing.',
    { mode: 'compliance', workspaceSalt: 't5-compliance' }
  );
  assert.ok(complianceRes.shadowAudit, 'compliance mode must auto-enable shadowAudit');
  assert.equal(complianceRes.shadowAudit.status, 'pass_zero_residual');
  assert.equal(complianceRes.shadowAudit.passed, true);
  assert.ok(complianceRes.numericIntegrity?.intact, 'compliance mode also verifies numericIntegrity');
});

test('Shadow audit distinguishes intentionally retained allowlisted & human-exempted spans from real residual leaks', async () => {
  const res = await perceiveMulti(
    [
      {
        name: 'support.txt',
        text: 'Public contact press.office@acme.example, whitelisted lead Elena Vance (elena.vance@acme.example), and private billing@secret.example.',
      },
    ],
    {
      workspaceSalt: 't5-allowlist-audit',
      whitelist: ['elena.vance@acme.example'],
      humanCorrections: {
        spanOverrides: [
          {
            source: 'support.txt',
            text: 'press.office@acme.example',
            entityType: 'EMAIL',
            action: 'exempt',
            reviewerId: 'compliance-01',
          },
        ],
      },
      shadowAudit: {
        enabled: true,
        allowlistedValues: [],
      },
    }
  );

  // Private email was redacted; whitelisted & human-exempted spans remain in output intentionally
  assert.doesNotMatch(res.markdown, /billing@secret\.example/);
  assert.match(res.markdown, /elena\.vance@acme\.example/);
  assert.match(res.markdown, /press\.office@acme\.example/);

  // Shadow audit must classify retained spans as allowlistedRetainedSpans, NOT residual leaks!
  assert.equal(res.shadowAudit.status, 'pass_zero_residual');
  assert.equal(res.shadowAudit.passed, true);
  assert.equal(res.shadowAudit.residualCount, 0);
  assert.equal(res.shadowAudit.newlyDiscoveredResidualSpans.length, 0);
  assert.ok(res.shadowAudit.allowlistedRetainedSpans.length >= 2);

  const reasons = new Set(res.shadowAudit.allowlistedRetainedSpans.map((s) => s.reason));
  assert.ok(reasons.has('whitelist_or_allowlist'), 'Whitelisted span must carry whitelist_or_allowlist reason');
  assert.ok(reasons.has('human_exemption'), 'Human-exempted span must carry human_exemption reason');
});

test('Shadow audit catches injected residual leaks across Stage 3A and Stage 3B without echoing raw secrets in maskedPreview', async () => {
  // 1. Direct runShadowAudit over tampered redacted blocks containing leaked PII, secret, and Stage 3B entity
  const leakedAwsKey = 'AKIAIOSFODNN7X9K2M4P';
  const stage3bAuditAdapter = createDetectorAdapter({
    id: 'audit-ner-strict',
    kind: 'text',
    provenanceTag: 'gliner:strict-v2',
    detect: ({ text }) => {
      const needle = 'dr. henrik lindqvist';
      const idx = text.toLowerCase().indexOf(needle);
      if (idx === -1) return [];
      return [
        {
          entityType: 'PERSON',
          start: idx,
          end: idx + needle.length,
          score: 0.96,
          provenanceTag: 'gliner:strict-v2',
        },
      ];
    },
  });

  const tamperedBlocks = [
    {
      blockId: 'blk_clean',
      source: 'clean.txt',
      maskedText: 'Approved by <PII:PERSON_01> with public helpdesk@public.org.',
    },
    {
      blockId: 'blk_leaked',
      source: 'leaked.txt',
      maskedText: `Residual email leak@corp.internal, key ${leakedAwsKey}, and dr. henrik lindqvist remained.`,
    },
  ];

  const audit = await runShadowAudit(tamperedBlocks, {
    detectors: [stage3bAuditAdapter],
    allowlistedValues: ['helpdesk@public.org'],
  });

  assert.equal(audit.status, 'fail_residual_detected');
  assert.equal(audit.passed, false);
  assert.equal(audit.allowlistedRetainedCount, 1);
  assert.equal(audit.allowlistedRetainedSpans[0].blockId, 'blk_clean');
  assert.equal(audit.residualCount, 3);
  assert.equal(audit.entityClassBreakdown.EMAIL, 1);
  assert.equal(audit.entityClassBreakdown.AWS_ACCESS_KEY, 1);
  assert.equal(audit.entityClassBreakdown.PERSON, 1);

  for (const sp of audit.newlyDiscoveredResidualSpans) {
    assert.equal(sp.blockId, 'blk_leaked');
    assert.ok(!sp.maskedPreview.includes(leakedAwsKey), 'maskedPreview must never expose full raw secret');
    assert.ok(!sp.maskedPreview.includes('leak@corp.internal'), 'maskedPreview must mask leaked email');
    assert.equal(sp.value, undefined, 'Raw value must be omitted by default from residual report');
    assert.match(sp.valueSha256, /^[0-9a-f]{64}$/);
  }
  assert.ok(
    audit.newlyDiscoveredResidualSpans.some((s) => s.provenanceTag === 'gliner:strict-v2'),
    'Stage 3B adapter provenanceTag must be preserved on residual span'
  );

  // 2. End-to-end perceive() catching a residual span via a stricter Stage 3B shadow audit verifier
  const percLeak = await perceive(
    { name: 'note.txt', text: 'Assigned to stealth_agent_42 for review.' },
    {
      shadowAudit: {
        enabled: true,
        detectors: [
          createDetectorAdapter({
            id: 'shadow-handle-verifier',
            kind: 'text',
            provenanceTag: 'audit:handle-detector',
            detect: ({ text }) => {
              const m = text.match(/stealth_agent_\d+/);
              return m
                ? [{ entityType: 'AGENT_HANDLE', start: m.index, end: m.index + m[0].length, score: 0.91 }]
                : [];
            },
          }),
        ],
      },
    }
  );
  assert.equal(percLeak.shadowAudit.status, 'fail_residual_detected');
  assert.equal(percLeak.shadowAudit.passed, false);
  assert.equal(percLeak.shadowAudit.residualCount, 1);
  assert.equal(percLeak.shadowAudit.newlyDiscoveredResidualSpans[0].entityType, 'AGENT_HANDLE');
  assert.equal(percLeak.receipt.shadowAudit.status, 'fail_residual_detected');

  // 3. Fail-closed throwOnResidual option
  await assert.rejects(
    () =>
      perceive('Assigned to stealth_agent_99.', {
        shadowAudit: {
          enabled: true,
          throwOnResidual: true,
          detectors: [
            createDetectorAdapter({
              id: 'shadow-throw-verifier',
              kind: 'text',
              detect: ({ text }) => {
                const m = text.match(/stealth_agent_\d+/);
                return m ? [{ entityType: 'AGENT_HANDLE', start: m.index, end: m.index + m[0].length, score: 0.95 }] : [];
              },
            }),
          ],
        },
      }),
    (err) => err.code === 'SHADOW_AUDIT_RESIDUAL_DETECTED' && err.shadowAudit?.residualCount === 1
  );
});

// ---------------------------------------------------------------------------
// 2. NumGuard-Style Pre/Post-Redaction Numeric Integrity Hashing
// ---------------------------------------------------------------------------
test('extractCanonicalNumericTokens preserves sign, decimals, percentages, currencies, units, and clause prefixes while ignoring vault placeholders', () => {
  const sample =
    'Under Clause 14.2 and § 164.514, <PII:PERSON_01> owes $1,250.50 (or USD 1,250.50) at 4.25% interest with adjustment -12.5 within 30 days (cap -$250.00, sha256 ok).';
  const toks = extractCanonicalNumericTokens(sample).map((t) => t.canonical);
  assert.deepEqual(toks, [
    'clause 14.2',
    '§ 164.514',
    '$1250.50',
    'USD 1250.50',
    '4.25%',
    '-12.5',
    '30 days',
    '-$250.00',
  ]);
});

test('NumGuard ignores intentionally redacted PII numbers (SSN, phone, card, MRN, NPI, DEA, CLIA, IBAN) while certifying non-PII financial/legal numbers', async () => {
  const docText = [
    'Patient Elena Vance (SSN 123-45-6789, Phone +1-415-555-0199, MRN: 8849201, NPI: 1234567893, DEA: AB1234563, CLIA: 12D3456789).',
    'Card 4111 1111 1111 1111 and IBAN: GB82WEST12345698765432 were replaced; co-pay remains $1,250.50 at 4.25% under Clause 14.2 (variance -12.5, net 30 days).',
  ].join('\n');

  const res = await perceive(
    { name: 'billing-summary.txt', text: docText },
    { numGuard: true, workspaceSalt: 't5-numguard-clean' }
  );

  assert.ok(res.numericIntegrity, 'numericIntegrity report must be returned when numGuard: true');
  assert.ok(res.receipt.numericIntegrity, 'numericIntegrity summary must be embedded in run receipt');
  assert.equal(res.numericIntegrity.status, 'pass_intact');
  assert.equal(res.numericIntegrity.intact, true);
  assert.equal(res.numericIntegrity.driftedBlockCount, 0);
  assert.deepEqual(res.numericIntegrity.driftedBlocks, []);
  assert.ok(
    res.numericIntegrity.excludedPiiNumericTokensCount >= 8,
    `Expected >= 8 excluded PII numeric tokens, got ${res.numericIntegrity.excludedPiiNumericTokensCount}`
  );
  assert.equal(res.numericIntegrity.totalNonPiiNumericTokens, 5);
  assert.equal(res.numericIntegrity.corpusPreHash, res.numericIntegrity.corpusPostHash);
});

test('NumGuard flags altered and dropped non-PII monetary/clause numbers with exact block locations while ignoring redacted PII spans', () => {
  const rawBlocks = [
    {
      blockId: 'filing_b1',
      source: 'settlement.txt',
      text: 'Claimant SSN 123-45-6789 awarded $1,250.50 at 4.25% under Clause 14.2.',
    },
    {
      blockId: 'filing_b2',
      source: 'settlement.txt',
      text: 'Phone +1-415-555-0199 confirmed penalty -12.5 within 30 days under Section 3.1.',
    },
    {
      blockId: 'filing_b3',
      source: 'settlement.txt',
      text: 'MRN 9948271 balance EUR 500.00 unchanged.',
    },
  ];

  // Redacted spans cover ONLY the sensitive PII identifiers (SSN, Phone, MRN)
  const redactedSpansPerBlock = [
    [{ start: 13, end: 24, type: 'SSN' }],
    [{ start: 6, end: 21, type: 'PHONE' }],
    [{ start: 4, end: 11, type: 'MRN' }],
  ];

  // Inject over-masking / corruption:
  // - filing_b1: $1,250.50 silently mutated to $1,200.50
  // - filing_b2: "Section 3.1" dropped completely by aggressive over-redaction
  // - filing_b3: intact
  const tamperedRedactedBlocks = [
    {
      blockId: 'filing_b1',
      source: 'settlement.txt',
      maskedText: 'Claimant SSN <PII:SSN_01> awarded $1,200.50 at 4.25% under Clause 14.2.',
    },
    {
      blockId: 'filing_b2',
      source: 'settlement.txt',
      maskedText: 'Phone <PII:PHONE_01> confirmed penalty -12.5 within 30 days under <PII:OVERMASK_01>.',
    },
    {
      blockId: 'filing_b3',
      source: 'settlement.txt',
      maskedText: 'MRN <PII:MRN_01> balance EUR 500.00 unchanged.',
    },
  ];

  const report = verifyNumericIntegrity(rawBlocks, tamperedRedactedBlocks, redactedSpansPerBlock);

  assert.equal(report.status, 'fail_numeric_drift');
  assert.equal(report.intact, false);
  assert.equal(report.blocksChecked, 3);
  assert.equal(report.intactBlockCount, 1);
  assert.equal(report.driftedBlockCount, 2);
  assert.equal(report.alteredTokenCount, 1);
  assert.equal(report.missingTokenCount, 1);
  assert.notEqual(report.corpusPreHash, report.corpusPostHash);

  const b1 = report.blocks.find((b) => b.blockId === 'filing_b1');
  const b2 = report.blocks.find((b) => b.blockId === 'filing_b2');
  const b3 = report.blocks.find((b) => b.blockId === 'filing_b3');

  assert.equal(b1.intact, false);
  assert.notEqual(b1.preHash, b1.postHash);
  assert.equal(b1.alteredTokens.length, 1);
  assert.equal(b1.alteredTokens[0].expected, '$1250.50');
  assert.equal(b1.alteredTokens[0].actual, '$1200.50');
  assert.equal(b1.missingTokens.length, 0);

  assert.equal(b2.intact, false);
  assert.notEqual(b2.preHash, b2.postHash);
  assert.equal(b2.missingTokens.length, 1);
  assert.equal(b2.missingTokens[0].expected, 'section 3.1');
  assert.equal(b2.alteredTokens.length, 0);

  assert.equal(b3.intact, true);
  assert.equal(b3.preHash, b3.postHash);
  assert.deepEqual(b3.expectedTokens, ['EUR 500.00']);
  assert.deepEqual(b3.actualTokens, ['EUR 500.00']);
});

// ---------------------------------------------------------------------------
// 3. Optional Canonical Entity-Sorted Merkle Root Over Corpus Spans
// ---------------------------------------------------------------------------
test('computeEntitySortedMerkleRoot is order-independent, verifies valid proofs, and rejects tampered leaves/siblings', () => {
  const records = [
    { entityId: 'ent:person:b2', sourceDocHash: sha256Hex('docB'), byteRange: [40, 52], vaultedSpan: '<PII:PERSON_02>' },
    { entityId: 'ent:email:a1', sourceDocHash: sha256Hex('docA'), byteRange: [10, 28], vaultedSpan: '<PII:EMAIL_01>' },
    { entityId: 'ent:person:b2', sourceDocHash: sha256Hex('docA'), byteRange: [0, 12], vaultedSpan: '<PII:PERSON_02>' },
    { entityId: 'ent:secret:c3', sourceDocHash: sha256Hex('docC'), byteRange: null, vaultedSpan: '<SECRET:GH_01>' },
    { entityId: 'ent:phone:d4', sourceDocHash: sha256Hex('docD'), byteRange: [5, 17], vaultedSpan: '<PII:PHONE_01>' },
  ];

  const reversed = [...records].reverse();
  const m1 = computeEntitySortedMerkleRoot(records);
  const m2 = computeEntitySortedMerkleRoot(reversed);

  assert.equal(m1.merkleRoot, m2.merkleRoot, 'Canonical entity-sorted Merkle root must be invariant to input order');
  assert.equal(m1.leafCount, 5);
  assert.match(m1.merkleRoot, /^[0-9a-f]{64}$/);
  assert.ok(m1.orderingSpec.includes('entityId'));

  // Verify inclusion proof for every leaf (odd-count 5-leaf tree exercises odd-leaf promotion too)
  for (const rec of records) {
    const proof = computeMerkleProof(records, rec);
    assert.equal(verifyMerkleProof(rec, proof, m1.merkleRoot), true);
    // Tampering byteRange or vaultedSpan must fail verification
    assert.equal(
      verifyMerkleProof({ ...rec, vaultedSpan: '<PII:TAMPERED>' }, proof, m1.merkleRoot),
      false
    );
    if (proof.length > 0) {
      const badProof = [{ ...proof[0], sibling: '0'.repeat(64) }, ...proof.slice(1)];
      assert.equal(verifyMerkleProof(rec, badProof, m1.merkleRoot), false);
    }
  }

  // Empty tree deterministic digest
  const emptyTree = computeEntitySortedMerkleRoot([]);
  assert.equal(emptyTree.leafCount, 0);
  assert.match(emptyTree.merkleRoot, /^[0-9a-f]{64}$/);
});

test('Amnesiac Corpus opt-in includeMerkleRoot preserves V1 corpusSha256 and changes root deterministically on single-entity erasure', async () => {
  const defaultCorpus = await buildAmnesiacCorpus(CORPUS_FIXTURE);
  assert.equal(
    defaultCorpus.receipt.corpusSha256,
    '6c857e0a0ea10daff6b2c6a9d2bb921a858edebabd3c29c621d8cb4c324411cd',
    'Default V1 corpusSha256 must have zero drift'
  );
  assert.equal('merkleRoot' in defaultCorpus.receipt, false, 'Default corpus receipt must omit merkleRoot');

  const merkleCorpus = await buildAmnesiacCorpus(CORPUS_FIXTURE, null, { includeMerkleRoot: true });
  assert.equal(
    merkleCorpus.receipt.corpusSha256,
    defaultCorpus.receipt.corpusSha256,
    'Enabling includeMerkleRoot must NOT alter corpusSha256'
  );
  assert.equal(merkleCorpus.receipt.viewDigest, defaultCorpus.receipt.viewDigest);
  assert.match(merkleCorpus.receipt.merkleRoot, /^[0-9a-f]{64}$/);
  assert.ok(merkleCorpus.receipt.merkleLeafCount >= 4);
  assert.equal(merkleCorpus.receipt.merkleOrderingSpec, merkleCorpus.merkleTree.orderingSpec);

  // Erase a single entity -> Merkle root MUST change and leafCount MUST drop by exact entity occurrences
  const emailEnt = merkleCorpus.entityIndex.find((e) => e.class === 'EMAIL');
  assert.ok(emailEnt);
  const erased = eraseEntity(merkleCorpus, emailEnt.entityId);

  assert.notEqual(erased.receipt.merkleRoot, merkleCorpus.receipt.merkleRoot, 'Single-entity erasure must change merkleRoot');
  assert.ok(erased.receipt.merkleLeafCount < merkleCorpus.receipt.merkleLeafCount);
  assert.equal(erased.diffReceipt.merkleRootBefore, merkleCorpus.receipt.merkleRoot);
  assert.equal(erased.diffReceipt.merkleRootAfter, erased.receipt.merkleRoot);

  // Composed mode with includeMerkleRoot also updates cleanly on erasure
  const composedMerkle = await buildAmnesiacCorpus(
    CORPUS_FIXTURE,
    { identity: 'readable', composition: 'composed' },
    { includeMerkleRoot: true }
  );
  const personEnt = composedMerkle.entityIndex.find((e) => e.class === 'PERSON');
  const composedErased = eraseEntity(composedMerkle, personEnt.entityId);
  assert.notEqual(composedErased.receipt.merkleRoot, composedMerkle.receipt.merkleRoot);
});

// ---------------------------------------------------------------------------
// 4. Optional Per-Entity Ego-Graph Degree & Equivalence-Class Telemetry
// ---------------------------------------------------------------------------
test('computeEgoGraphTelemetry distinguishes singled-out entities (k=1) from structurally equivalent entities (k>=2) across degree & relation multisets', async () => {
  // 1. Explicit entity-relation graph testing both degree AND relation-type multiset separation
  const explicitGraph = {
    nodes: [
      { node_id: 'ent:person:alice', node_type: 'ENTITY' },
      { node_id: 'ent:person:bob', node_type: 'ENTITY' },
      { node_id: 'ent:person:carol', node_type: 'ENTITY' },
      { node_id: 'ent:person:dave', node_type: 'ENTITY' },
      { node_id: 'pas:1', node_type: 'PASSAGE' },
      { node_id: 'pas:2', node_type: 'PASSAGE' },
      { node_id: 'doc:1', node_type: 'DOCUMENT' },
    ],
    edges: [
      // Alice & Bob: identical ego-graph signature deg=2 | MENTIONS:2 -> k=2 equivalence class
      { src_id: 'pas:1', dst_id: 'ent:person:alice', edge_type: 'MENTIONS' },
      { src_id: 'pas:2', dst_id: 'ent:person:alice', edge_type: 'MENTIONS' },
      { src_id: 'pas:1', dst_id: 'ent:person:bob', edge_type: 'MENTIONS' },
      { src_id: 'pas:2', dst_id: 'ent:person:bob', edge_type: 'MENTIONS' },
      // Carol: ALSO degree 2, but DIFFERENT relation multiset (MENTIONS:1, RELATES_TO:1) -> k=1 singled out!
      { src_id: 'pas:1', dst_id: 'ent:person:carol', edge_type: 'MENTIONS' },
      { src_id: 'ent:person:carol', dst_id: 'doc:1', edge_type: 'RELATES_TO' },
      // Dave: degree 3 (MENTIONS:3) -> k=1 singled out!
      { src_id: 'pas:1', dst_id: 'ent:person:dave', edge_type: 'MENTIONS' },
      { src_id: 'pas:2', dst_id: 'ent:person:dave', edge_type: 'MENTIONS' },
      { src_id: 'doc:1', dst_id: 'ent:person:dave', edge_type: 'MENTIONS' },
    ],
  };

  const tel = computeEgoGraphTelemetry(explicitGraph);
  assert.equal(tel.entityCount, 4);
  assert.equal(tel.equivalenceClassCount, 3);
  assert.equal(tel.minEquivalenceClassSize, 1);
  assert.equal(tel.maxEquivalenceClassSize, 2);
  assert.deepEqual(tel.singledOutEntities, ['ent:person:carol', 'ent:person:dave']);

  const byId = new Map(tel.entities.map((e) => [e.entityId, e]));
  assert.equal(byId.get('ent:person:alice').kClassSize, 2);
  assert.equal(byId.get('ent:person:alice').singledOut, false);
  assert.equal(byId.get('ent:person:bob').kClassSize, 2);
  assert.equal(byId.get('ent:person:carol').degree, 2);
  assert.equal(byId.get('ent:person:carol').kClassSize, 1);
  assert.equal(byId.get('ent:person:carol').singledOut, true);
  assert.deepEqual(byId.get('ent:person:carol').relationMultiset, { MENTIONS: 1, RELATES_TO: 1 });

  // 2. End-to-end perceiveMulti & buildAmnesiacCorpus opt-in ego-graph telemetry
  // Two symmetric single-mention emails (k=2) vs one cross-doc hub person mentioned in 3 docs (k=1 singled out)
  const kAnonInputs = [
    { name: 'd1.txt', text: 'Hub lead Elena Vance reviewed vendor_one@alpha.example.' },
    { name: 'd2.txt', text: 'Hub lead Elena Vance reviewed vendor_two@beta.example.' },
    { name: 'd3.txt', text: 'Hub lead Elena Vance finalized the schedule.' },
  ];

  const perceived = await perceiveMulti(kAnonInputs, {
    workspaceSalt: 't5-ego-salt',
    includeEgoGraphTelemetry: true,
  });
  assert.ok(perceived.egoGraphTelemetry);
  assert.ok(perceived.receipt.egoGraphTelemetry);
  assert.equal(perceived.egoGraphTelemetry.entityCount, 3);
  assert.equal(perceived.egoGraphTelemetry.minEquivalenceClassSize, 1);
  assert.equal(perceived.egoGraphTelemetry.maxEquivalenceClassSize, 2);
  assert.equal(perceived.egoGraphTelemetry.singledOutCount, 1);

  const composedCorpus = await buildAmnesiacCorpus(
    kAnonInputs,
    { identity: 'readable', composition: 'composed' },
    { includeEgoGraphTelemetry: true }
  );
  assert.ok(composedCorpus.egoGraphTelemetry);
  assert.equal(composedCorpus.egoGraphTelemetry.minEquivalenceClassSize, 1);
  assert.equal(composedCorpus.egoGraphTelemetry.maxEquivalenceClassSize, 2);
  assert.ok(
    composedCorpus.egoGraphTelemetry.singledOutEntities.some((id) => id.includes('Elena Vance')),
    'Cross-document hub entity Elena Vance must be flagged as singled-out (k=1) before composed export'
  );

  // Erasing the singled-out hub entity leaves only the two symmetric entities (k=2 -> 0 singled out!)
  const elenaId = composedCorpus.egoGraphTelemetry.singledOutEntities[0];
  const afterErase = eraseEntity(composedCorpus, elenaId);
  assert.equal(afterErase.egoGraphTelemetry.entityCount, 2);
  assert.equal(afterErase.egoGraphTelemetry.singledOutCount, 0);
  assert.equal(afterErase.egoGraphTelemetry.minEquivalenceClassSize, 2);
});
