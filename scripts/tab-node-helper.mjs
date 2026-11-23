/**
 * Batch Node.js helper for reviewer-hardening benchmarks:
 * Runs REAL VeriSieve Node/WASM engines (Paper 1 Regex, Stage 3A WASM, Ground-Truth LTT Gatekeeper,
 * and Zero-Import PPRL Noisy Cross-Modal Linkage) over JSON stdin -> JSON stdout.
 */
import fs from 'node:fs';
import { scanRecordsForPII, createTokenizer, extractFeatureRow } from '../src/clean-and-tokenize.js';
import { scanEnterprisePiiAndSecrets } from '../src/secret-scanner.js';
import { loadMediaWasmSync, pprlDiceSimilarity } from '../src/media-wasm.js';
import { trainGatekeeper, calibrateGatekeeper, decideGatekeeper, binomCdf } from '../src/gatekeeper.js';

const mode = process.argv[2];
const inPath = process.argv[3];
const outPath = process.argv[4];
const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'));

if (mode === 'scan-docs') {
  // payload = [{ doc_id, text }]
  const results = payload.map((doc) => {
    const text = doc.text || '';
    const p1 = scanRecordsForPII(text).map((h) => ({
      start: h.start,
      end: h.end,
      type: String(h.type || '').toUpperCase(),
      value: h.value || text.slice(h.start, h.end),
    }));
    const s3a = scanEnterprisePiiAndSecrets(text).spans.map((h) => ({
      start: h.start,
      end: h.end,
      type: String(h.type || '').toUpperCase(),
      category: h.category,
      value: h.value || text.slice(h.start, h.end),
    }));
    return { doc_id: doc.doc_id, paper1: p1, stage3a: s3a };
  });
  fs.writeFileSync(outPath, JSON.stringify(results), 'utf8');
} else if (mode === 'gt-ltt') {
  // Non-circular Ground-Truth LTT on human-annotated TAB ECHR paragraphs (zero regex features, zero scanner labels!)
  // payload = { train: [{text, unsafe}], cal: [{text, unsafe}], test: [{text, unsafe}], alphas: [...] }
  const tok = createTokenizer();
  const featurize = (rows) =>
    rows.map((r) => {
      const txt = r.text || '';
      const enc = tok.encode(txt);
      const feat = extractFeatureRow(
        { text: txt, cleanText: txt, piiCount: 0, piiHits: [], sourceMode: 'tab_echr' },
        enc
      );
      return {
        features: Array.from(feat),
        // trainGatekeeper / calibrateGatekeeper convention: y=1 is SAFE, y=0 is UNSAFE (human-annotated TAB PII)
        ySafe: r.unsafe ? 0 : 1,
      };
    });

  const tr = featurize(payload.train);
  const ca = featurize(payload.cal);
  const te = featurize(payload.test);

  const bundle = trainGatekeeper(
    tr.map((x) => x.features),
    tr.map((x) => x.ySafe),
    { epochs: 15, lr: 0.25, l2: 1e-4 }
  );

  const calFeatures = ca.map((x) => x.features);
  const calLabels = ca.map((x) => x.ySafe);
  const calUnsafeN = calLabels.filter((y) => y === 0).length;
  const calSafeN = calLabels.length - calUnsafeN;

  const testProbs = te.map((x) => ({
    prob: decideGatekeeper(bundle, x.features).prob,
    isUnsafe: x.ySafe === 0,
  }));
  const testUnsafeN = testProbs.filter((x) => x.isUnsafe).length;
  const testSafeN = testProbs.length - testUnsafeN;

  const uncalKeptUnsafe = testProbs.filter((x) => x.isUnsafe && x.prob >= 0.5).length;
  const uncalKeptSafe = testProbs.filter((x) => !x.isUnsafe && x.prob >= 0.5).length;

  const sweep = [];
  for (const alpha of payload.alphas || [0.01, 0.02, 0.05, 0.10, 0.15, 0.20]) {
    const clone = structuredClone(bundle);
    const calibrated = calibrateGatekeeper(clone, calFeatures, calLabels, { alpha, delta: 0.05 });
    const c = calibrated.calibration;
    const certified = Boolean(c.certified);
    const tau = c.tauKeep;
    let keptUnsafe = 0;
    let keptSafe = 0;
    if (certified) {
      keptUnsafe = testProbs.filter((x) => x.isUnsafe && x.prob >= tau).length;
      keptSafe = testProbs.filter((x) => !x.isUnsafe && x.prob >= tau).length;
    }
    const calK = Math.round(c.empiricalFpr * calUnsafeN);
    sweep.push({
      alpha,
      certified,
      threshold: certified ? tau : null,
      calPValue: Number(binomCdf(calK, calUnsafeN, alpha).toFixed(5)),
      testConditionalFprPct: testUnsafeN > 0 ? Number(((keptUnsafe / testUnsafeN) * 100).toFixed(2)) : 0,
      testJointRiskPct: testProbs.length > 0 ? Number(((keptUnsafe / testProbs.length) * 100).toFixed(2)) : 0,
      testSafeYieldPct: testSafeN > 0 ? Number(((keptSafe / testSafeN) * 100).toFixed(2)) : 0,
      keptUnsafe,
      keptSafe,
      abstainedPct: Number((((testProbs.length - keptUnsafe - keptSafe) / Math.max(1, testProbs.length)) * 100).toFixed(2)),
    });
  }

  fs.writeFileSync(
    outPath,
    JSON.stringify({
      splits: {
        trainTotal: tr.length,
        calTotal: ca.length,
        calUnsafe: calUnsafeN,
        calSafe: calSafeN,
        testTotal: te.length,
        testUnsafe: testUnsafeN,
        testSafe: testSafeN,
      },
      uncalibratedTau050: {
        testConditionalFprPct: Number(((uncalKeptUnsafe / Math.max(1, testUnsafeN)) * 100).toFixed(2)),
        testSafeYieldPct: Number(((uncalKeptSafe / Math.max(1, testSafeN)) * 100).toFixed(2)),
      },
      sweep,
    }),
    'utf8'
  );
} else if (mode === 'pprl-noisy') {
  // payload = { salt, pairs: [{ canonical, noisy, kind, isSame }], diceThreshold }
  const wasm = loadMediaWasmSync();
  const salt = payload.salt || 'gdpr-pprl-salt';
  const thr = payload.diceThreshold ?? 0.70;
  const out = payload.pairs.map((p) => {
    const sa = wasm.pprlSignature(p.canonical, salt);
    const sb = wasm.pprlSignature(p.noisy, salt);
    const dice = pprlDiceSimilarity(sa.bloomHex, sb.bloomHex);
    const phonMatch = sa.phoneticHex === sb.phoneticHex;
    const exactMatch = p.canonical.trim().toLowerCase() === p.noisy.trim().toLowerCase();
    const pprlMatch = dice >= thr || (phonMatch && dice >= 0.52);
    return { ...p, dice: Number(dice.toFixed(4)), phonMatch, exactMatch, pprlMatch };
  });
  fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');
} else if (mode === 'scan-secrets-files') {
  // payload = [{ id, content }]
  const wasm = loadMediaWasmSync();
  const t0 = performance.now();
  const out = payload.map((f) => {
    const rep = wasm.scanPiiAndSecrets(f.content || '');
    const secrets = rep.spans.filter((s) => s.category === 'secret');
    return { id: f.id, secretCount: secrets.length, types: secrets.map((s) => s.type) };
  });
  const totalMs = Number((performance.now() - t0).toFixed(2));
  fs.writeFileSync(outPath, JSON.stringify({ totalMs, results: out }), 'utf8');
} else if (mode === 'audio-itn-redact') {
  // payload = [{ id, wavInPath, wavOutPath, words: [{word, startMs, endMs}], neuralSpans: [{start, end, type}] }]
  const wasm = loadMediaWasmSync();
  const out = [];
  for (const item of payload) {
    const itn = wasm.normalizeSpokenWords(item.words || []);
    const rawJoined = (item.words || []).map((w) => w.word).join(' ');
    const rawScan = scanEnterprisePiiAndSecrets(rawJoined).spans;
    const itnScan = scanEnterprisePiiAndSecrets(itn.normalizedText, {
      neuralSpans: item.neuralSpans || [],
    }).spans;

    // Map ITN character offsets back to [startMs, endMs] audio windows
    const redactWindows = [];
    for (const sp of itnScan) {
      let minMs = Infinity, maxMs = -1;
      for (const wm of itn.wordMap || []) {
        if (wm.normEnd > sp.start && wm.normStart < sp.end) {
          if (wm.startMs < minMs) minMs = wm.startMs;
          if (wm.endMs > maxMs) maxMs = wm.endMs;
        }
      }
      if (Number.isFinite(minMs) && maxMs >= minMs) {
        redactWindows.push({ startMs: minMs, endMs: maxMs, type: sp.type });
      }
    }

    const wavBytes = fs.readFileSync(item.wavInPath);
    const red = wasm.redactWavBuffer(wavBytes, redactWindows, {
      mode: 'silence',
      padMs: 60,
      fadeMs: 5,
    });
    fs.writeFileSync(item.wavOutPath, Buffer.from(red.redactedWavBytes));
    out.push({
      id: item.id,
      normalizedText: itn.normalizedText,
      rawRegexSpanCount: rawScan.length,
      hybridSpanCount: itnScan.length,
      detectedTypes: itnScan.map((s) => s.type),
      redactWindows,
    });
  }
  fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');
}
