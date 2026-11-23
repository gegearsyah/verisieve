/**
 * Batch Node.js helper for reviewer-hardening benchmarks:
 * Runs REAL VeriSieve Node/WASM engines (Paper 1 Regex, Stage 3A WASM, Ground-Truth LTT Gatekeeper,
 * and Zero-Import PPRL Noisy Cross-Modal Linkage) over JSON stdin -> JSON stdout.
 */
import fs from 'node:fs';
import { scanRecordsForPII, createTokenizer, extractFeatureRow } from '../src/clean-and-tokenize.js';
import { scanEnterprisePiiAndSecrets } from '../src/secret-scanner.js';
import { loadMediaWasmSync, pprlDiceSimilarity } from '../src/media-wasm.js';
import {
  trainGatekeeper,
  calibrateGatekeeper,
  calibrateClusterRobustGatekeeper,
  calibrateStreamingEProcessGatekeeper,
  decideGatekeeper,
  binomCdf,
} from '../src/gatekeeper.js';

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
        doc_id: r.doc_id || 'doc_unknown',
        features: arr,
        ySafe: r.unsafe ? 0 : 1,
        residualUnsafe: Boolean(r.residualUnsafe),
        nerSafeScore: Math.max(0.0, Math.min(1.0, 1.0 - Number(r.maxConf || 0))),
      };
    });

  const groupItemsByCluster = (items, getProb) => {
    const byDoc = new Map();
    for (const it of items) {
      const cid = it.doc_id || 'doc_0';
      if (!byDoc.has(cid)) byDoc.set(cid, []);
      byDoc.get(cid).push({
        prob: getProb(it),
        labelSafe: it.ySafe,
      });
    }
    return Array.from(byDoc.entries()).map(([clusterId, blocks]) => ({ clusterId, blocks }));
  };

  const evaluateThresholdOnTest = (testItems, testProbs, tauKeep, certified, alpha, extra = {}) => {
    const testUnsafeN = testItems.filter((x) => x.ySafe === 0).length;
    const testSafeN = testItems.length - testUnsafeN;
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
    return {
      alpha,
      certified,
      threshold: certified ? tauKeep : null,
      ...extra,
      testConditionalFprPct: testUnsafeN > 0 ? Number(((keptUnsafe / testUnsafeN) * 100).toFixed(2)) : 0,
      testSafeYieldPct: testSafeN > 0 ? Number(((keptSafe / testSafeN) * 100).toFixed(2)) : 0,
      overallAutoReleasePct: testItems.length > 0 ? Number(((autoReleased / testItems.length) * 100).toFixed(2)) : 0,
      autoReleasedCount: autoReleased,
      keptUnsafe,
      keptSafe,
      e2eResidualLeakCount: keptResidualUnsafe,
      e2eResidualLeakOfReleasedPct: autoReleased > 0 ? Number(((keptResidualUnsafe / autoReleased) * 100).toFixed(2)) : 0,
      e2eResidualLeakOfUnsafePct: testUnsafeN > 0 ? Number(((keptResidualUnsafe / testUnsafeN) * 100).toFixed(2)) : 0,
    };
  };

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
  const getHybridProb = (x) => decideGatekeeper(bundleHybrid, x.features).prob;
  const hybridDetSweep = runLttSweep(
    caDet,
    teDet,
    getHybridProb,
    getHybridProb,
    alphas
  );

  // 4. Pillar 1A: Document-Clustered Conformal Risk Control (HC-CRC) on Detector-Informed Hybrid
  const calClusters = groupItemsByCluster(caDet, getHybridProb);
  const teProbsHybrid = teDet.map(getHybridProb);
  const hcCrcSweep = alphas.map((alpha) => {
    const res = calibrateClusterRobustGatekeeper({ ...bundleHybrid }, calClusters, { alpha, delta: 0.05 });
    const cc = res.clusterCalibration;
    return evaluateThresholdOnTest(teDet, teProbsHybrid, cc.tauKeep, cc.certified, alpha, {
      calPValue: cc.pValue,
      intraClusterCorrelation: cc.intraClusterCorrelation,
      designEffect: cc.designEffect,
      effectiveSampleSize: cc.effectiveSampleSize,
      nUnsafeClusters: cc.nUnsafeClusters,
    });
  });

  // 5. Pillar 1B: Anytime-Valid Streaming Ville Martingale (E-LTT) on Detector-Informed Hybrid
  const eLttSweep = alphas.map((alpha) => {
    const res = calibrateStreamingEProcessGatekeeper({ ...bundleHybrid }, calClusters, { alpha, delta: 0.05 });
    const ec = res.eProcessCalibration;
    return evaluateThresholdOnTest(teDet, teProbsHybrid, ec.tauKeep, ec.certified, alpha, {
      maxEValue: ec.maxEValue,
      anytimePValue: ec.anytimePValue,
      stoppingClusterStep: ec.stoppingClusterStep,
    });
  });

  fs.writeFileSync(
    outPath,
    JSON.stringify({
      splits: {
        trainTotal: trDet.length,
        calTotal: caDet.length,
        calUnsafe: caDet.filter((x) => x.ySafe === 0).length,
        calSafe: caDet.filter((x) => x.ySafe === 1).length,
        calClusters: calClusters.length,
        testTotal: teDet.length,
        testUnsafe: teDet.filter((x) => x.ySafe === 0).length,
        testSafe: teDet.filter((x) => x.ySafe === 1).length,
      },
      textOnly520dLtt: textOnlySweep,
      nerMaxConfBaselineLtt: nerMaxConfSweep,
      detectorInformedHybridLtt: hybridDetSweep,
      documentClusteredHcCrc: hcCrcSweep,
      streamingMartingaleELtt: eLttSweep,
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
} else if (mode === 'srmp-tab-couple') {
  // Pillar 2A: Real TAB ECHR Multi-Paragraph Court Ruling SR-MP Coupling via verisieve_media.wasm
  // payload = { docs: [{ doc_id, text, allSpans: [{start, end, label, score}] }], anchorThr, lowThr }
  const wasm = loadMediaWasmSync();
  const anchorThr = payload.anchorThr ?? 0.50;
  const lowThr = payload.lowThr ?? 0.15;
  const LEGAL_STOP = new Set([
    'court', 'government', 'state', 'article', 'convention', 'section', 'chapter',
    'applicant', 'applicants', 'president', 'judge', 'judges', 'registrar', 'council',
    'european', 'human', 'rights', 'commission', 'committee', 'ministry', 'department',
    'national', 'district', 'regional', 'supreme', 'constitutional', 'criminal', 'civil',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december', 'kingdom', 'republic', 'united', 'police', 'hospital',
  ]);

  const outDocs = payload.docs.map((doc, dIdx) => {
    wasm.srmpReset();
    const salt = `tab-srmp-${doc.doc_id || dIdx}`;
    const text = doc.text || '';
    const spans = doc.allSpans || [];
    const highSpans = spans.filter((s) => s.score >= anchorThr);
    const weakSpans = spans.filter((s) => s.score >= lowThr && s.score < anchorThr);

    let uid = 1;
    const seededTypes = new Map();
    for (const hs of highSpans) {
      const lbl = String(hs.label || hs.type || '').toLowerCase();
      if (!lbl.includes('person')) continue;
      const surf = text.slice(hs.start, hs.end).trim();
      const parts = surf.split(/[\s\-.,/]+/).filter((w) => w.length >= 4 && /^[A-Z\u00C0-\u00DE]/.test(w));
      for (const part of [surf, ...parts]) {
        const clean = part.replace(/^[^A-Za-z\u00C0-\u024F]+|[^A-Za-z\u00C0-\u024F]+$/g, '');
        if (clean.length < 4 || LEGAL_STOP.has(clean.toLowerCase())) continue;
        const curUid = uid++;
        seededTypes.set(curUid, hs.label || hs.type || 'person');
        wasm.srmpSeedAnchor(clean, salt, {
          entityUid: curUid,
          blockIdx: Math.floor(hs.start / 250),
          confidence: hs.score,
          kindCode: 1,
        });
      }
    }

    const promoted = [...highSpans];
    let promotedCount = 0;

    // 1. Promote weak GLiNER person candidates if they couple with a seeded WASM SR-MP anchor in this ruling
    for (const ws of weakSpans) {
      const wLbl = String(ws.label || ws.type || '').toLowerCase();
      if (!wLbl.includes('person')) continue;
      const surf = text.slice(ws.start, ws.end).trim();
      // Do not promote precedent case citations ("X v. Y") which TAB marks as NO_MASK
      const afterCtx = text.slice(ws.end, Math.min(text.length, ws.end + 12));
      const beforeCtx = text.slice(Math.max(0, ws.start - 12), ws.start);
      if (/^\s+v\.\s/i.test(afterCtx) || /\sv\.\s*$/i.test(beforeCtx)) continue;

      const parts = surf.split(/[\s\-.,/]+/).filter((w) => w.length >= 4);
      let bestHit = null;
      for (const part of [surf, ...parts]) {
        const clean = part.replace(/^[^A-Za-z\u00C0-\u024F]+|[^A-Za-z\u00C0-\u024F]+$/g, '');
        if (clean.length < 4 || LEGAL_STOP.has(clean.toLowerCase())) continue;
        const hit = wasm.srmpQueryCandidate(clean, salt, {
          blockIdx: Math.floor(ws.start / 250),
          localScore: ws.score,
          minDice: 0.78,
          gamma: 0.85,
          beta: 0.20,
        });
        if (hit.matched && hit.coupledScore >= anchorThr) {
          bestHit = hit;
          break;
        }
      }
      if (bestHit) {
        promoted.push({
          ...ws,
          label: seededTypes.get(bestHit.entityUid) || ws.label || 'person',
          score: bestHit.coupledScore,
          srmpPromoted: true,
        });
        promotedCount++;
      }
    }

    // 2. Scan unmasked titled/contextualized surname mentions in later paragraphs against the WASM SR-MP ring
    const tokRe = /\b(?:Mr|Mrs|Ms|Dr|Applicant|Judge)\.\s+([A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F'-]{3,24})\b/g;
    let m;
    while ((m = tokRe.exec(text)) !== null) {
      const word = m[1];
      const s = m.index + m[0].lastIndexOf(word);
      const e = s + word.length;
      if (LEGAL_STOP.has(word.toLowerCase())) continue;
      if (promoted.some((p) => s < p.end && e > p.start)) continue;
      const hit = wasm.srmpQueryCandidate(word, salt, {
        blockIdx: Math.floor(s / 250),
        localScore: 0.30,
        minDice: 0.80,
        gamma: 0.88,
        beta: 0.20,
      });
      if (hit.matched && hit.coupledScore >= anchorThr) {
        promoted.push({
          start: s,
          end: e,
          label: 'person',
          type: 'PERSON',
          score: hit.coupledScore,
          srmpPromoted: true,
        });
        promotedCount++;
      }
    }

    return {
      doc_id: doc.doc_id,
      promotedCount,
      spans: promoted,
    };
  });
  fs.writeFileSync(outPath, JSON.stringify(outDocs), 'utf8');
} else if (mode === 'audio-srmp-redact') {
  // Pillar 2B: End-to-End Audio Spoken ITN + WASM SR-MP Phonetic Anchor Coupling + Spoken Email Neighbor Expansion
  // payload = [{ id, wavInPath, wavOutPath, words: [{word, startMs, endMs}], neuralSpans: [...], contextAnchors: [...] }]
  const wasm = loadMediaWasmSync();
  const AUDIO_STOP = new Set([
    'hello', 'support', 'team', 'name', 'email', 'please', 'check', 'quarterly', 'invoice',
    'there', 'this', 'calling', 'regarding', 'account', 'renewal', 'call', 'good', 'morning',
    'update', 'billing', 'contact', 'winter', 'order', 'thank', 'answering', 'phone', 'number',
    'need', 'help', 'with', 'shipping', 'status', 'from', 'engineering', 'send', 'security',
    'audit', 'report', 'before', 'friday', 'reach', 'about', 'clinic', 'appointment', 'receipt',
    'should', 'compliance', 'verify', 'delivery', 'callback', 'requesting', 'refund', 'hardware',
    'subscription', 'direct', 'warranty', 'claim', 'forward', 'contract', 'draft', 'board',
    'meeting', 'mobile', 'confirmation', 'laboratory', 'results', 'afternoon', 'ticket',
    'onboarding', 'checklist', 'whenever', 'ready', 'line', 'lease', 'register', 'workshop',
    'shipment', 'tracking', 'budget', 'spreadsheet', 'today', 'assist', 'telephone', 'recovery',
    'license', 'agreement', 'procurement', 'updated', 'policy', 'manual', 'technical',
    'assistance', 'following', 'schedule', 'dot', 'com', 'org', 'net',
  ]);
  const out = [];
  for (const item of payload) {
    wasm.srmpReset();
    const salt = `audio-srmp-${item.id}`;
    let uid = 1;
    for (const anc of item.contextAnchors || []) {
      for (const part of String(anc).split(/[\s.@\-_]+/)) {
        if (part.length >= 3 && !AUDIO_STOP.has(part.toLowerCase())) {
          wasm.srmpSeedAnchor(part, salt, { entityUid: uid++, blockIdx: 0, confidence: 0.95, kindCode: 1 });
        }
      }
    }

    const itn = wasm.normalizeSpokenWords(item.words || []);
    const itnScan = scanEnterprisePiiAndSecrets(itn.normalizedText, {
      neuralSpans: item.neuralSpans || [],
    }).spans;

    // Seed any high-confidence PERSON/EMAIL detected in the call itself into the SR-MP ring
    for (const sp of itnScan) {
      const val = itn.normalizedText.slice(sp.start, sp.end);
      for (const part of val.split(/[\s.@\-_]+/)) {
        if (part.length >= 4 && !AUDIO_STOP.has(part.toLowerCase())) {
          wasm.srmpSeedAnchor(part, salt, { entityUid: uid++, blockIdx: 0, confidence: 0.92, kindCode: 1 });
        }
      }
    }

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

    // SR-MP Word-Level Phonetic Coupling & Spoken-Email Neighbor Coalescing:
    // Any word token matching the WASM SR-MP ring (or part of a fused/split spoken email around "at"/"dot") is silenced!
    const rawWords = item.words || [];
    for (let wi = 0; wi < rawWords.length; wi++) {
      const rawW = String(rawWords[wi].word || '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (rawW.length < 3) continue;
      const lowerW = rawW.toLowerCase();
      if (AUDIO_STOP.has(lowerW)) continue;

      // Split compound ASR tokens (e.g. "Elena.vansatacme.org") into sub-pieces to test against SR-MP ring
      const subPieces = [rawW, ...rawW.split(/[._\-@]+/).filter((x) => x.length >= 3)];
      let matchedSrmp = false;
      for (const piece of subPieces) {
        if (AUDIO_STOP.has(piece.toLowerCase())) continue;
        const hit = wasm.srmpQueryCandidate(piece, salt, {
          blockIdx: 1,
          localScore: 0.30,
          minDice: 0.58,
          gamma: 0.88,
          beta: 0.25,
        });
        if (hit.matched && hit.coupledScore >= 0.50) {
          matchedSrmp = true;
          break;
        }
      }

      if (matchedSrmp) {
        let sMs = rawWords[wi].startMs;
        let eMs = rawWords[wi].endMs;
        // If adjacent to spoken email connectors ("dot", "at"), expand window across the spoken email span
        let r = wi + 1;
        while (r < rawWords.length) {
          const nw = String(rawWords[r].word || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
          if (nw === 'dot' || nw === 'at' || nw === 'com' || nw === 'org' || nw === 'net' || nw === 'io') {
            eMs = rawWords[r].endMs;
            r++;
          } else if (r > wi + 1 && r - 1 < rawWords.length) {
            const prevW = String(rawWords[r - 1].word || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
            if (prevW === 'dot' || prevW === 'at') {
              eMs = rawWords[r].endMs;
              r++;
              continue;
            }
            break;
          } else {
            break;
          }
        }
        redactWindows.push({ startMs: sMs, endMs: eMs, type: 'SRMP_COUPLED_PII' });
      }
    }

    const wavBytes = fs.readFileSync(item.wavInPath);
    const red = wasm.redactWavBuffer(wavBytes, redactWindows, {
      mode: 'silence',
      padMs: 65,
      fadeMs: 5,
    });
    fs.writeFileSync(item.wavOutPath, Buffer.from(red.redactedWavBytes));
    out.push({
      id: item.id,
      normalizedText: itn.normalizedText,
      hybridSpanCount: itnScan.length,
      srmpWindowCount: redactWindows.length,
      redactWindows,
    });
  }
  fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');
}
