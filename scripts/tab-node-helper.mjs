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
  // Non-circular Ground-Truth LTT on human-annotated TAB ECHR paragraphs (compares Text-Only,
  // NER-Max-Confidence baseline, and Detector-Informed Hybrid LTT; reports Automation Rate, Safe Yield,
  // Conditional FPR, and End-to-End Redactor+Gate Residual Unmasked PII Rate!)
  // payload = { train: [{text, unsafe, detCount, maxConf, residualUnsafe}], cal: [...], test: [...], alphas: [...] }
  const tok = createTokenizer();
  const buildFeats = (rows, useDetectorSignals) =>
    rows.map((r) => {
      const txt = r.text || '';
      const enc = tok.encode(txt);
      const piiCount = useDetectorSignals ? Number(r.detCount || 0) : 0;
      const conf = useDetectorSignals ? Math.max(0.05, 1.0 - Number(r.maxConf || 0)) : 1.0;
      const feat = extractFeatureRow(
        { text: txt, cleanText: txt, piiCount, piiHits: [], sourceMode: 'tab_echr', confidence: conf },
        enc
      );
      const arr = Array.from(feat);
      if (useDetectorSignals) {
        // Explicit detector-signal slots in structural tail [512..519]
        arr[512] = Math.min(1.0, Number(r.maxConf || 0));
        arr[513] = Math.min(1.0, Number(r.detCount || 0) / 5.0);
        arr[514] = Number(r.detCount || 0) > 0 ? 1.0 : 0.0;
        arr[515] = Math.min(1.0, Number(r.meanConf || 0));
      }
      return {
        features: arr,
        ySafe: r.unsafe ? 0 : 1,
        residualUnsafe: Boolean(r.residualUnsafe),
        nerSafeScore: Math.max(0.0, Math.min(1.0, 1.0 - Number(r.maxConf || 0))),
      };
    });

  const runLttSweep = (calItems, testItems, getCalProb, getTestProb, alphas) => {
    const calUnsafeN = calItems.filter((x) => x.ySafe === 0).length;
    const testUnsafeN = testItems.filter((x) => x.ySafe === 0).length;
    const testSafeN = testItems.length - testUnsafeN;
    const calProbs = calItems.map(getCalProb);
    const testProbs = testItems.map(getTestProb);

    const sweep = [];
    for (const alpha of alphas) {
      let tauKeep = 1.0;
      let certified = false;
      let calK = 0;
      for (let step = 1; step <= 99; step++) {
        const t = step / 100;
        let k = 0;
        for (let i = 0; i < calItems.length; i++) {
          if (calItems[i].ySafe === 0 && calProbs[i] >= t) k++;
        }
        if (binomCdf(k, calUnsafeN, alpha) <= 0.05) {
          tauKeep = Number(t.toFixed(2));
          calK = k;
          certified = true;
          break;
        }
      }
      let keptUnsafe = 0, keptSafe = 0, keptResidualUnsafe = 0;
      if (certified) {
        for (let i = 0; i < testItems.length; i++) {
          if (testProbs[i] >= tauKeep) {
            if (testItems[i].ySafe === 0) keptUnsafe++;
            else keptSafe++;
            if (testItems[i].residualUnsafe) keptResidualUnsafe++;
          }
        }
      }
      const autoReleased = keptUnsafe + keptSafe;
      sweep.push({
        alpha,
        certified,
        threshold: certified ? tauKeep : null,
        calPValue: certified ? Number(binomCdf(calK, calUnsafeN, alpha).toFixed(5)) : null,
        testConditionalFprPct: testUnsafeN > 0 ? Number(((keptUnsafe / testUnsafeN) * 100).toFixed(2)) : 0,
        testSafeYieldPct: testSafeN > 0 ? Number(((keptSafe / testSafeN) * 100).toFixed(2)) : 0,
        overallAutoReleasePct: testItems.length > 0 ? Number(((autoReleased / testItems.length) * 100).toFixed(2)) : 0,
        autoReleasedCount: autoReleased,
        keptUnsafe,
        keptSafe,
        e2eResidualLeakCount: keptResidualUnsafe,
        e2eResidualLeakOfReleasedPct: autoReleased > 0 ? Number(((keptResidualUnsafe / autoReleased) * 100).toFixed(2)) : 0,
        e2eResidualLeakOfUnsafePct: testUnsafeN > 0 ? Number(((keptResidualUnsafe / testUnsafeN) * 100).toFixed(2)) : 0,
      });
    }
    return sweep;
  };

  const alphas = payload.alphas || [0.01, 0.02, 0.05, 0.10, 0.15, 0.20];

  // 1. Text-Only 520-d Gate
  const trText = buildFeats(payload.train, false);
  const caText = buildFeats(payload.cal, false);
  const teText = buildFeats(payload.test, false);
  const bundleText = trainGatekeeper(trText.map((x) => x.features), trText.map((x) => x.ySafe), { epochs: 15, lr: 0.25, l2: 1e-4 });
  const textOnlySweep = runLttSweep(
    caText,
    teText,
    (x) => decideGatekeeper(bundleText, x.features).prob,
    (x) => decideGatekeeper(bundleText, x.features).prob,
    alphas
  );

  // 2. Baseline: NER-Max-Confidence LTT Gate (p_safe = 1 - max_i conf_i)
  const caDet = buildFeats(payload.cal, true);
  const teDet = buildFeats(payload.test, true);
  const nerMaxConfSweep = runLttSweep(
    caDet,
    teDet,
    (x) => x.nerSafeScore,
    (x) => x.nerSafeScore,
    alphas
  );

  // 3. Detector-Informed Hybrid LTT Gate (520-d text + Stage 3A/3B detector features)
  const trDet = buildFeats(payload.train, true);
  const bundleHybrid = trainGatekeeper(trDet.map((x) => x.features), trDet.map((x) => x.ySafe), { epochs: 20, lr: 0.30, l2: 1e-4 });
  const hybridDetSweep = runLttSweep(
    caDet,
    teDet,
    (x) => decideGatekeeper(bundleHybrid, x.features).prob,
    (x) => decideGatekeeper(bundleHybrid, x.features).prob,
    alphas
  );

  fs.writeFileSync(
    outPath,
    JSON.stringify({
      splits: {
        trainTotal: trDet.length,
        calTotal: caDet.length,
        calUnsafe: caDet.filter((x) => x.ySafe === 0).length,
        calSafe: caDet.filter((x) => x.ySafe === 1).length,
        testTotal: teDet.length,
        testUnsafe: teDet.filter((x) => x.ySafe === 0).length,
        testSafe: teDet.filter((x) => x.ySafe === 1).length,
      },
      textOnly520dLtt: textOnlySweep,
      nerMaxConfBaselineLtt: nerMaxConfSweep,
      detectorInformedHybridLtt: hybridDetSweep,
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
