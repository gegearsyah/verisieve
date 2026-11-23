/**
 * Live Reproducible Benchmark for `GC-CRC` (Graph-Coupled Cross-Modal Conformal Redaction)
 *
 * Evaluates the "Fragmented Context Horizon" across 60 multimodal enterprise & legal cases
 * (240 linked blocks spanning 4 modalities per case: Page-1 Ruling / Email Anchor,
 * Follow-up Paragraph with bare references, Noisy Whisper ASR Turn with homophone/spelling
 * drift, and Dark-Mode Video Slide OCR with character substitutions + domain technical nouns).
 *
 * Compares 4 redaction regimes on identical ground-truth spans and clean domain negatives:
 *   1. Stage 3A WASM Regex + Lexicon (Isolated)
 *   2. Isolated Hybrid (Stage 3A + 3B, high-precision threshold tau = 0.60)
 *   3. Isolated Hybrid (Stage 3A + 3B, low threshold tau = 0.20 — high recall, low precision)
 *   4. Versieve GC-CRC (tau_anchor = 0.60 + 128-bit WASM Salted Reference Anchor Pool + Graph Propagation)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactEnterpriseText } from '../src/secret-scanner.js';
import { runGraphCoupledConformalRedaction } from '../src/perceive.js';
import { SaltedPseudonymVault } from '../src/graph-wasm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASES = [
  { canonical: 'Markus Pentikainen', surname: 'Pentikainen', asrNoisy: 'Pentikaynen', ocrNoisy: 'Pentikalnen', email: 'm.pentikainen@helsinki-press.fi', code: '11882/10' },
  { canonical: 'Elena Vance', surname: 'Vance', asrNoisy: 'Vans', ocrNoisy: 'Vanoe', email: 'elena.vance@acme-clinical.org', code: '36110/97' },
  { canonical: 'Marcus Thorne', surname: 'Thorne', asrNoisy: 'Torn', ocrNoisy: 'Thome', email: 'm.thorne@northstar-bio.io', code: '48219/14' },
  { canonical: 'Sofia Lindqvist', surname: 'Lindqvist', asrNoisy: 'Lindkvist', ocrNoisy: 'Lindqvlst', email: 's.lindqvist@stockholm-med.se', code: '29104/18' },
  { canonical: 'Henrik Johansson', surname: 'Johansson', asrNoisy: 'Johansen', ocrNoisy: 'Johansscn', email: 'h.johansson@uppsala-lab.se', code: '51920/15' },
  { canonical: 'Claire Beaumont', surname: 'Beaumont', asrNoisy: 'Bomont', ocrNoisy: 'Beaurnont', email: 'c.beaumont@lyon-cardio.fr', code: '60411/19' },
  { canonical: 'Tomasz Kowalski', surname: 'Kowalski', asrNoisy: 'Kovalski', ocrNoisy: 'Kowalskl', email: 't.kowalski@warsaw-legal.pl', code: '77102/16' },
  { canonical: 'Nadia Al-Mansoor', surname: 'Mansoor', asrNoisy: 'Mansur', ocrNoisy: 'Mansocr', email: 'n.mansoor@gulf-genomics.ae', code: '83910/20' },
  { canonical: 'Lukas Schneider', surname: 'Schneider', asrNoisy: 'Shneider', ocrNoisy: 'Schnelder', email: 'l.schneider@munich-ip.de', code: '14928/12' },
  { canonical: 'Amina Okafor', surname: 'Okafor', asrNoisy: 'Okafer', ocrNoisy: 'Okafcr', email: 'a.okafor@lagos-fintech.ng', code: '92014/21' },
  { canonical: 'Matteo Ricci', surname: 'Ricci', asrNoisy: 'Ritchi', ocrNoisy: 'Rlccl', email: 'm.ricci@milan-oncology.it', code: '33812/17' },
  { canonical: 'Katarina Novak', surname: 'Novak', asrNoisy: 'Nowak', ocrNoisy: 'Ncvak', email: 'k.novak@prague-institute.cz', code: '41029/13' },
];

const DOMAIN_FALSE_POSITIVE_TRAPS = [
  'Clinical Trial',
  'Control Group',
  'Confidence Interval',
  'Odds Ratio',
  'Regression Analysis',
  'Standard Deviation',
  'Cohort Study',
  'Primary Outcome',
  'Adverse Events',
  'Statistical Significance',
  'Inclusion Criteria',
  'Informed Consent',
];

function buildCaseBlocks(c, idx) {
  const trapA = DOMAIN_FALSE_POSITIVE_TRAPS[idx % DOMAIN_FALSE_POSITIVE_TRAPS.length];
  const trapB = DOMAIN_FALSE_POSITIVE_TRAPS[(idx + 5) % DOMAIN_FALSE_POSITIVE_TRAPS.length];

  // Block 1 (Document / Email Anchor): High-confidence introduction
  const b1Text = `Case ${c.code} filed by Mr. ${c.canonical} (${c.email}) regarding ${trapA} evaluation.`;
  const b1NameStart = b1Text.indexOf(c.canonical);
  const b1TrapStart = b1Text.indexOf(trapA);

  // Block 2 (Later Paragraph): Bare unprefixed surname reference (low local NER confidence = 0.28)
  const b2Text = `In paragraph 42, ${c.surname} submitted additional records under ${trapB} guidelines.`;
  const b2SurnameStart = b2Text.indexOf(c.surname);
  const b2TrapStart = b2Text.indexOf(trapB);

  // Block 3 (Noisy Whisper ASR Turn): Phonetic/homophone ASR drift (low local NER confidence = 0.24)
  const b3Text = `[Speech 02:15-02:30] During the hearing ${c.asrNoisy} confirmed the compliance audit status.`;
  const b3NoisyStart = b3Text.indexOf(c.asrNoisy);

  // Block 4 (Dark-Mode Video Slide OCR): 1-char OCR substitution (low local NER confidence = 0.26)
  const b4Text = `[Slide 04:10] Reviewer: ${c.ocrNoisy} | Protocol: ${trapA}.`;
  const b4NoisyStart = b4Text.indexOf(c.ocrNoisy);
  const b4TrapStart = b4Text.indexOf(trapA);

  return [
    {
      source: `case_${idx + 1}_ruling.pdf`,
      modality: 'document',
      text: b1Text,
      gtPiiTokens: [c.code, c.canonical, c.email],
      fpTrapTokens: [trapA],
      neuralSpans: [
        { start: b1NameStart, end: b1NameStart + c.canonical.length, type: 'PERSON', score: 0.92 },
        // Low-score false-positive candidate on domain term (triggers if threshold tau <= 0.25)
        { start: b1TrapStart, end: b1TrapStart + trapA.length, type: 'PERSON', score: 0.23 },
      ],
    },
    {
      source: `case_${idx + 1}_ruling.pdf`,
      modality: 'document',
      text: b2Text,
      gtPiiTokens: [c.surname],
      fpTrapTokens: [trapB],
      neuralSpans: [
        { start: b2SurnameStart, end: b2SurnameStart + c.surname.length, type: 'PERSON', score: 0.28 },
        { start: b2TrapStart, end: b2TrapStart + trapB.length, type: 'PERSON', score: 0.22 },
      ],
    },
    {
      source: `case_${idx + 1}_call.wav`,
      modality: 'audio',
      text: b3Text,
      gtPiiTokens: [c.asrNoisy],
      fpTrapTokens: [],
      neuralSpans: [
        { start: b3NoisyStart, end: b3NoisyStart + c.asrNoisy.length, type: 'PERSON', score: 0.24 },
      ],
    },
    {
      source: `case_${idx + 1}_demo.mp4`,
      modality: 'video_frame',
      text: b4Text,
      gtPiiTokens: [c.ocrNoisy],
      fpTrapTokens: [trapA],
      neuralSpans: [
        { start: b4NoisyStart, end: b4NoisyStart + c.ocrNoisy.length, type: 'PERSON', score: 0.26 },
        { start: b4TrapStart, end: b4TrapStart + trapA.length, type: 'PERSON', score: 0.21 },
      ],
    },
  ];
}

function evaluateRegime(allCaseBlocks, runBlockGroupFn) {
  let totalGt = 0;
  let caughtGt = 0;
  let crossModalGt = 0;
  let caughtCrossModalGt = 0;
  let totalPredSpans = 0;
  let falsePositives = 0;
  let consistentEntityLinks = 0;
  let totalEntityLinkPairs = 0;

  const t0 = performance.now();
  for (let cIdx = 0; cIdx < allCaseBlocks.length; cIdx++) {
    const blocks = allCaseBlocks[cIdx];
    const outs = runBlockGroupFn(blocks, cIdx);

    for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
      const blk = blocks[bIdx];
      const masked = outs[bIdx].maskedText;
      const entities = outs[bIdx].entities || [];
      totalPredSpans += entities.length;

      for (const gt of blk.gtPiiTokens) {
        totalGt++;
        const isRedacted = !masked.includes(gt);
        if (isRedacted) caughtGt++;
        if (bIdx >= 1) {
          crossModalGt++;
          if (isRedacted) caughtCrossModalGt++;
        }
      }

      for (const trap of blk.fpTrapTokens) {
        if (!masked.includes(trap)) {
          falsePositives++;
        }
      }
    }

    // Check if Block 2/3/4 person mentions received the same entity pseudonym or were redacted
    const b1Mask = outs[0].maskedText;
    const personTagMatch = b1Mask.match(/<PII:PERSON_\d+>/);
    if (personTagMatch) {
      for (let bIdx = 1; bIdx < blocks.length; bIdx++) {
        totalEntityLinkPairs++;
        if (!outs[bIdx].maskedText.includes(blocks[bIdx].gtPiiTokens[0])) {
          consistentEntityLinks++;
        }
      }
    }
  }
  const elapsedMs = Number((performance.now() - t0).toFixed(2));

  const recall = totalGt > 0 ? (caughtGt / totalGt) * 100 : 0;
  const crossModalRecall = crossModalGt > 0 ? (caughtCrossModalGt / crossModalGt) * 100 : 0;
  const tp = caughtGt;
  const fp = falsePositives;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 100;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    totalBlocks: allCaseBlocks.length * 4,
    totalGtSpans: totalGt,
    caughtGtSpans: caughtGt,
    overallRecallPct: Number(recall.toFixed(2)),
    crossModalFollowupRecallPct: Number(crossModalRecall.toFixed(2)),
    falsePositives,
    precisionPct: Number(precision.toFixed(2)),
    f1Pct: Number(f1.toFixed(2)),
    crossModalLinkRatePct:
      totalEntityLinkPairs > 0 ? Number(((consistentEntityLinks / totalEntityLinkPairs) * 100).toFixed(2)) : 0,
    elapsedMs,
  };
}

// Expand 12 templates x 5 deterministic salt/case variations = 60 cases (240 blocks, 360 GT spans)
const allCases = [];
for (let rep = 0; rep < 5; rep++) {
  for (let i = 0; i < CASES.length; i++) {
    allCases.push(buildCaseBlocks(CASES[i], rep * CASES.length + i));
  }
}

// 1. Isolated Stage 3A WASM Regex + Lexicon
const stage3aMetrics = evaluateRegime(allCases, (blocks, idx) => {
  const vault = new SaltedPseudonymVault(`s3a-${idx}`);
  return blocks.map((b) => redactEnterpriseText(b.text, { vault, neuralSpans: [] }));
});

// 2. Isolated Hybrid (tau = 0.60, high precision)
const isolatedHighMetrics = evaluateRegime(allCases, (blocks, idx) => {
  const vault = new SaltedPseudonymVault(`ihigh-${idx}`);
  return blocks.map((b) =>
    redactEnterpriseText(b.text, {
      vault,
      neuralSpans: b.neuralSpans.filter((s) => s.score >= 0.60),
    })
  );
});

// 3. Isolated Hybrid (tau = 0.20, low threshold — triggers domain false positives)
const isolatedLowMetrics = evaluateRegime(allCases, (blocks, idx) => {
  const vault = new SaltedPseudonymVault(`ilow-${idx}`);
  return blocks.map((b) =>
    redactEnterpriseText(b.text, {
      vault,
      neuralSpans: b.neuralSpans.filter((s) => s.score >= 0.20),
    })
  );
});

// 4. Versieve GC-CRC (tau_anchor = 0.60, low_candidate = 0.20, 128-bit Salted Reference Anchor Pool)
const gccrcMetrics = evaluateRegime(allCases, (blocks, idx) => {
  const res = runGraphCoupledConformalRedaction(blocks, {
    workspaceSalt: `gccrc-${idx}`,
    anchorThreshold: 0.60,
    lowNeuralThreshold: 0.20,
    pprlDiceThreshold: 0.65,
  });
  return res.blocks;
});

const summary = {
  benchmark: 'Versieve GC-CRC Cross-Modal Context-Horizon Evaluation',
  cases: allCases.length,
  blocks: allCases.length * 4,
  regimes: {
    isolatedStage3A: stage3aMetrics,
    isolatedHybridTau060: isolatedHighMetrics,
    isolatedHybridTau020: isolatedLowMetrics,
    versieveGcCrc: gccrcMetrics,
  },
};

const outPath = path.resolve(__dirname, '../results/gccrc-cross-modal-benchmark.json');
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
