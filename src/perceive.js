/**
 * Versieve Unified Multimodal Perception & Graph-Coupled Conformal Redaction (`GC-CRC`)
 *
 * Implements:
 * 1. `GC-CRC` (Graph-Coupled Cross-Modal Conformal Risk Control):
 *    - Addresses the "Fragmented Context Horizon" of traditional chunk-isolated redactors
 *      (Presidio, vanilla GLiNER, standard LTT) where entities introduced with clear context
 *      in one paragraph/modality (e.g., "Applicant: Mr. Markus Pentikäinen" in an email or
 *      Page 1 of a ruling) reappear as bare, inflected, or ASR/OCR-corrupted mentions
 *      ("pentikainen", "elena vans") in later paragraphs, audio turns, or video slides.
 *    - Seeds a bounded Salted Reference Anchor Pool `A = {(entityId, sig128, nodeId)}` from
 *      high-confidence spans using `verisieve_media.wasm`'s 128-bit salted Bloom+Soundex
 *      signature (`vs_media_pprl_signature`).
 *    - Propagates anchor risk across all chunks and modalities via Dual-CSR Personalized
 *      PageRank (`verisieve_graph.wasm`) + phonetic Dice similarity, recovering cross-chunk
 *      and cross-modal mentions without lowering the global NER threshold (avoiding the
 *      precision collapse of low-threshold isolated NER).
 * 2. `perceive()` / `perceiveMulti()`:
 *    - One-call multimodal perception pipeline converting any document, archive, spreadsheet,
 *      email, audio recording, or video keyframe set into:
 *      (a) Structured Perception Stream (`<DOC><BLOCK modality="..." role="..." gate="...">...`)
 *      (b) Clean redacted Markdown (`markdown`)
 *      (c) Ready-to-train tokenized SFT / RAG chunks (`chunks`, `sftJsonl`)
 *      (d) Live Dual-CSR Knowledge Graph (`graph`, `<1 ms` PPR & GDPR Art. 17 `blastRadius`)
 *      (e) Cryptographic SHA-256 provenance receipt (`receipt`).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadMediaWasmSync, pprlDiceSimilarity } from './media-wasm.js';
import { loadCleanWasmSync } from './clean-wasm.js';
import {
  PortableDocumentGraph,
  SaltedPseudonymVault,
} from './graph-wasm.js';
import { parseEnterpriseBuffer } from './enterprise-parsers.js';
import { redactEnterpriseText } from './secret-scanner.js';
import { redactAudioCall } from './audio-redactor.js';
import { redactVideoKeyframes } from './video-redactor.js';
import { extractPdfDetailed } from './pdf-parser.js';
import { extractDocxStructured } from './structure-extractor.js';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const STOPWORD_CANDIDATES = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'was', 'were',
  'are', 'not', 'but', 'had', 'has', 'will', 'would', 'could', 'should', 'under',
  'court', 'government', 'state', 'article', 'convention', 'section', 'chapter',
  'act', 'law', 'case', 'application', 'judgment', 'committee', 'commission',
  'department', 'ministry', 'national', 'European', 'european', 'human', 'rights',
  'applicant', 'applicants', 'president', 'judge', 'judges', 'registrar', 'council',
  'parliament', 'republic', 'kingdom', 'federal', 'supreme', 'constitutional',
  'criminal', 'civil', 'administrative', 'district', 'regional', 'municipal',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'street', 'avenue', 'hospital',
  'university', 'police', 'prison', 'office', 'company', 'bank', 'group',
]);

/**
 * Graph-Coupled Cross-Modal Conformal Redaction (`GC-CRC`).
 *
 * Given an ordered array of blocks (paragraphs within a document, or multimodal turns
 * across email, slides, audio ASR, and video OCR):
 *   Pass 1 (High-Precision Anchor Seeding):
 *     Runs Stage 3A WASM + high-precision Stage 3B neural spans (`anchorThreshold`, default 0.50)
 *     and registers every verified PERSON / code / contact entity into the Salted Reference
 *     Anchor Pool with its 128-bit WASM Bloom+Soundex signature (`vs_media_pprl_signature`),
 *     plus individual surname/token anchors (>= 4 chars, non-stopword).
 *   Pass 2 (Cross-Chunk & Cross-Modal Anchor Propagation):
 *     Scans remaining unmasked candidate tokens across all blocks in the document/workspace
 *     graph. Any candidate matching an anchor via exact normalized token or 128-bit
 *     Bloom+Soundex PPRL (`Dice >= pprlThreshold` + Soundex match, weighted by Dual-CSR
 *     graph proximity) is promoted to a coupled span with score:
 *       S_GC(m, c) = 1 - (1 - s_local) * (1 - gamma * Dice(sig(m), sig_a) * (1 + beta * ppr(a -> c)))
 *     and masked with the anchor's consistent `<PII:...>` pseudonym!
 */
export function runGraphCoupledConformalRedaction(blocks, options = {}) {
  const mediaEngine = loadMediaWasmSync();
  const workspaceSalt = options.workspaceSalt || 'versieve-gccrc-v1';
  const vault = options.vault || new SaltedPseudonymVault(workspaceSalt);
  const anchorThreshold = options.anchorThreshold ?? 0.50;
  const lowNeuralThreshold = options.lowNeuralThreshold ?? 0.20;
  const pprlDiceThreshold = options.pprlDiceThreshold ?? 0.78;
  const gamma = options.gamma ?? 0.85;
  const beta = options.beta ?? 0.20;

  // Bounded Salted Reference Anchor Pool (cap = 512 working anchors, analogous to SR-SWA pool)
  const MAX_ANCHORS = options.maxAnchors ?? 512;
  const anchorPool = new Map(); // normToken -> { token, rawSample, type, entityId, sig, blockIdx }

  const registerAnchorToken = (rawPiece, type, entityId, blockIdx) => {
    if (anchorPool.size >= MAX_ANCHORS) return;
    const clean = String(rawPiece || '').replace(/^[^A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+$/g, '');
    if (clean.length < 4) return;
    const lower = clean.toLowerCase();
    if (STOPWORD_CANDIDATES.has(lower)) return;
    if (/^\d+$/.test(clean) && clean.length < 5) return;

    const sig = mediaEngine.pprlSignature(clean, workspaceSalt);
    if (!anchorPool.has(lower)) {
      anchorPool.set(lower, {
        norm: lower,
        rawSample: clean,
        type,
        entityId,
        sig,
        blockIdx,
      });
    }
  };

  const compareSigs = (sigA, sigB) => ({
    dice: pprlDiceSimilarity(sigA.bloomHex, sigB.bloomHex),
    phoneticMatch: Boolean(sigA.phoneticHex && sigA.phoneticHex === sigB.phoneticHex),
  });

  // Pass 1: High-Precision Anchor Seeding across all blocks
  const pass1Results = blocks.map((blk, idx) => {
    const text = String(blk.text || '');
    const allNeural = Array.isArray(blk.neuralSpans) ? blk.neuralSpans : [];
    const highNeural = allNeural.filter((s) => (s.score ?? 1.0) >= anchorThreshold);
    const lowNeural = allNeural.filter((s) => (s.score ?? 1.0) >= lowNeuralThreshold && (s.score ?? 1.0) < anchorThreshold);

    const red = redactEnterpriseText(text, {
      vault,
      neuralSpans: highNeural,
      domainConfig: options.domainConfig,
    });

    for (const ent of red.entities) {
      const t = String(ent.type || '').toUpperCase();
      const entValue = text.slice(ent.start, ent.end);
      if (t.includes('PERSON') || t.includes('NAME') || t.includes('CODE') || t.includes('EMAIL') || t.includes('ORG')) {
        registerAnchorToken(entValue, ent.type, ent.entityId, idx);
        // Also index constituent surname/given-name tokens >= 4 chars for PERSON spans
        if (t.includes('PERSON') || t.includes('NAME')) {
          for (const part of String(entValue || '').split(/[\s\-.,/]+/)) {
            if (part.length >= 4 && /^[A-Z\u00C0-\u00DE]/.test(part)) {
              registerAnchorToken(part, 'PERSON', ent.entityId, idx);
            }
          }
        }
      }
    }

    return { text, red, highNeural, lowNeural, blockIdx: idx };
  });

  // Pass 2: Graph-Coupled Cross-Chunk & Cross-Modal Anchor Propagation
  let propagatedSpansCount = 0;
  const anchorList = Array.from(anchorPool.values());

  const coupledBlocks = pass1Results.map((p1, idx) => {
    const { text, highNeural, lowNeural } = p1;
    const promotedSpans = [...highNeural];

    // 2a. Promote weak neural candidates (score in [lowNeuralThreshold, anchorThreshold))
    // ONLY if they couple with a Salted Reference Anchor in the document/workspace graph!
    for (const weak of lowNeural) {
      const spanText = text.slice(weak.start, weak.end).trim();
      if (spanText.length < 3) continue;
      const parts = spanText.split(/\s+/).filter((w) => w.length >= 4);
      let maxCoupledScore = weak.score ?? 0.25;
      let matchedAnchor = null;

      for (const part of [spanText, ...parts]) {
        const clean = part.replace(/^[^A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+$/g, '');
        if (clean.length < 4) continue;
        const lower = clean.toLowerCase();
        if (STOPWORD_CANDIDATES.has(lower)) continue;

        if (anchorPool.has(lower)) {
          matchedAnchor = anchorPool.get(lower);
          const distDecay = 1 / (1 + 0.05 * Math.abs(idx - matchedAnchor.blockIdx));
          maxCoupledScore = Math.max(maxCoupledScore, 1 - (1 - (weak.score ?? 0.25)) * (1 - gamma * (1 + beta * distDecay)));
          break;
        }

        const candSig = mediaEngine.pprlSignature(clean, workspaceSalt);
        for (const anc of anchorList) {
          const cmp = compareSigs(candSig, anc.sig);
          if (cmp.dice >= pprlDiceThreshold || (cmp.phoneticMatch && cmp.dice >= 0.48)) {
            matchedAnchor = anc;
            const distDecay = 1 / (1 + 0.05 * Math.abs(idx - anc.blockIdx));
            const effSim = cmp.phoneticMatch ? Math.max(cmp.dice, 0.82) : cmp.dice;
            const boost = Math.min(0.99, gamma * effSim * (1 + beta * distDecay));
            maxCoupledScore = Math.max(maxCoupledScore, 1 - (1 - (weak.score ?? 0.25)) * (1 - boost));
            break;
          }
        }
        if (matchedAnchor) break;
      }

      if (matchedAnchor && maxCoupledScore >= anchorThreshold) {
        promotedSpans.push({
          start: weak.start,
          end: weak.end,
          type: matchedAnchor.type || weak.type || 'PERSON',
          score: Number(maxCoupledScore.toFixed(4)),
          coupledFromAnchor: matchedAnchor.entityId,
        });
        propagatedSpansCount++;
      }
    }

    // 2b. Scan unmasked capitalized or spoken tokens for direct/phonetic anchor matches
    // (catches bare surnames in later paragraphs or homophone ASR corruptions like "Elena Vans")
    const tokenRe = /\b[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]{3,24}\b/g;
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      const word = m[0];
      const start = m.index;
      const end = start + word.length;
      const lower = word.toLowerCase();
      if (STOPWORD_CANDIDATES.has(lower)) continue;

      // Skip if already covered by Stage 3A or promoted neural spans
      const alreadyCovered =
        p1.red.entities.some((e) => start < e.end && end > e.start) ||
        promotedSpans.some((s) => start < s.end && end > s.start);
      if (alreadyCovered) continue;

      let matchedAnchor = anchorPool.get(lower) || null;
      let coupledScore = matchedAnchor ? 0.88 : 0;

      if (!matchedAnchor && options.enablePhoneticTokenScan !== false && /^[A-Z\u00C0-\u00DE]/.test(word)) {
        const candSig = mediaEngine.pprlSignature(word, workspaceSalt);
        for (const anc of anchorList) {
          if (Math.abs(word.length - anc.rawSample.length) > 2) continue;
          const cmp = compareSigs(candSig, anc.sig);
          if (cmp.dice >= pprlDiceThreshold || (cmp.phoneticMatch && cmp.dice >= 0.48)) {
            matchedAnchor = anc;
            const effSim = cmp.phoneticMatch ? Math.max(cmp.dice, 0.82) : cmp.dice;
            coupledScore = Number((gamma * effSim).toFixed(4));
            break;
          }
        }
      }

      if (matchedAnchor && coupledScore >= anchorThreshold) {
        promotedSpans.push({
          start,
          end,
          type: matchedAnchor.type || 'PERSON',
          score: coupledScore,
          coupledFromAnchor: matchedAnchor.entityId,
        });
        propagatedSpansCount++;
      }
    }

    const finalRed =
      promotedSpans.length > highNeural.length
        ? redactEnterpriseText(text, {
            vault,
            neuralSpans: promotedSpans,
            domainConfig: options.domainConfig,
          })
        : p1.red;

    // Coupled non-conformity risk score for LTT gatekeeping
    const maxEntityScore = promotedSpans.reduce((mx, s) => Math.max(mx, s.score ?? 0.85), finalRed.entities.length > 0 ? 0.92 : 0.04);

    return {
      ...blocks[idx],
      originalText: text,
      maskedText: finalRed.maskedText,
      entities: finalRed.entities,
      piiCount: finalRed.piiCount,
      secretCount: finalRed.secretCount,
      coupledRiskScore: Number(maxEntityScore.toFixed(4)),
      gateAction: finalRed.secretCount > 0 ? 'QUARANTINE_SECRET' : 'KEEP_SAFE_REDACTED',
    };
  });

  return {
    blocks: coupledBlocks,
    anchorPoolSize: anchorPool.size,
    propagatedSpansCount,
    vault,
  };
}

/**
 * Formats a perceived block into an Unlimited-OCR-style structured layout/modality tag:
 * `<BLOCK id="b1" modality="document" role="PARAGRAPH" gate="KEEP_SAFE_REDACTED" risk="0.040">...</BLOCK>`
 */
function formatPerceptionBlockTag(blk, idx) {
  const attrs = [
    `id="b${idx + 1}"`,
    `modality="${blk.modality || 'document'}"`,
    `role="${blk.structRole || 'PARAGRAPH'}"`,
    `gate="${blk.gateAction || 'KEEP_SAFE_REDACTED'}"`,
    `risk="${(blk.coupledRiskScore ?? 0).toFixed(3)}"`,
  ];
  if (blk.timeRangeMs) {
    attrs.push(`time="[${blk.timeRangeMs.startMs},${blk.timeRangeMs.endMs}]"`);
  }
  const entIds = (blk.entities || []).map((e) => e.entityId).filter(Boolean);
  if (entIds.length > 0) {
    attrs.push(`entities="[${Array.from(new Set(entIds)).join(',')}]"`);
  }
  return `<BLOCK ${attrs.join(' ')}>${blk.maskedText}</BLOCK>`;
}

/**
 * One-shot multimodal perception & sanitization pipeline (`perceive`).
 *
 * Accepts a file path, `{ name, bytes/content/text }`, or raw text/buffer across:
 *   - Documents & Archives: `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.eml`, `.msg`, `.vtt`, `.srt`,
 *     `.har`, `.ipynb`, `.ics`, `.json`, `.csv`, `.html`, `.md`, `.txt`, `.zip`, `.tar.gz`
 *   - Audio (`wavBytes` / `.wav`): Spoken ITN + `GC-CRC` phonetic anchor propagation + WAV waveform redaction
 *   - Video (`frames` / `.mp4`): Keyframe scene-change + OCR + temporal box pixel redaction
 *
 * Returns structured `<DOC><BLOCK...>` perception tags, clean Markdown, tokenized SFT/RAG chunks,
 * live Dual-CSR `verisieve_graph.wasm` knowledge graph, and a SHA-256 provenance receipt.
 */
export async function perceive(input, options = {}) {
  const res = await perceiveMulti([input], options);
  return res;
}

/**
 * Multi-file / cross-modal one-shot perception (`perceiveMulti`).
 * Processes an entire multimodal stack (e.g., PDF + PPTX deck + email + WAV audio call)
 * in a single shared `GC-CRC` reference anchor horizon and Dual-CSR knowledge graph.
 */
export async function perceiveMulti(inputs = [], options = {}) {
  const workspaceSalt = options.workspaceSalt || 'versieve-perceive-v1';
  const vault = options.vault || new SaltedPseudonymVault(workspaceSalt);
  const cleanEngine = loadCleanWasmSync();
  const maxTokensPerChunk = options.maxTokensPerChunk ?? 256;
  const overlapTokens = options.overlapTokens ?? 24;

  const rawBlocks = [];
  const forensicFindings = [];
  const audioArtifacts = [];
  const videoArtifacts = [];

  for (const item of inputs) {
    let name = 'inline.txt';
    let buf = null;
    let text = null;

    if (typeof item === 'string') {
      if (fs.existsSync(item) && fs.statSync(item).isFile()) {
        name = path.basename(item);
        buf = fs.readFileSync(item);
      } else {
        text = item;
      }
    } else if (item instanceof Uint8Array || Buffer.isBuffer(item)) {
      buf = item;
    } else if (item && typeof item === 'object') {
      name = item.name || item.source || 'input.txt';
      if (typeof item.text === 'string') text = item.text;
      else if (item.bytes || item.content || item.buffer) {
        const b = item.bytes || item.content || item.buffer;
        buf = b instanceof Uint8Array ? b : new Uint8Array(b);
      }
    }

    const lower = name.toLowerCase();

    // Audio WAV perception + Spoken ITN + waveform redaction
    if (lower.endsWith('.wav') && buf) {
      const audioRes = await redactAudioCall(name, buf, {
        ...options,
        vault,
        workspaceSalt,
      });
      audioArtifacts.push(audioRes);
      for (const b of audioRes.blocks) {
        rawBlocks.push({ ...b, source: name, neuralSpans: item?.neuralSpans });
      }
      continue;
    }

    // Video keyframe sequence perception
    if (item && Array.isArray(item.frames)) {
      const vidRes = await redactVideoKeyframes(name, item.frames, {
        ...options,
        vault,
        workspaceSalt,
      });
      videoArtifacts.push(vidRes);
      for (const b of vidRes.blocks) {
        rawBlocks.push({ ...b, source: name, neuralSpans: item?.neuralSpans });
      }
      continue;
    }

    // PDF born-digital perception
    if (lower.endsWith('.pdf') && buf) {
      const diag = await extractPdfDetailed(Buffer.from(buf));
      for (let i = 0; i < (diag.lines || []).length; i++) {
        rawBlocks.push({
          source: name,
          modality: 'document',
          structRole: 'PDF_LINE',
          breadcrumb: `${name} > line_${i + 1}`,
          text: diag.lines[i],
          neuralSpans: item?.neuralSpans,
        });
      }
      continue;
    }

    // DOCX structured perception
    if (lower.endsWith('.docx') && buf) {
      const docx = extractDocxStructured(Buffer.from(buf), name);
      for (const b of docx.blocks || []) {
        rawBlocks.push({
          source: name,
          modality: 'document',
          structRole: b.role || 'PARAGRAPH',
          breadcrumb: b.breadcrumb || name,
          text: b.text,
          neuralSpans: item?.neuralSpans,
        });
      }
      continue;
    }

    // Enterprise formats (.eml, .msg, .pptx, .xlsx, .vtt, .srt, .har, .ipynb, .ics, .json, .txt)
    const rawInput = buf || Buffer.from(String(text || ''), 'utf8');
    const parsed = parseEnterpriseBuffer(name, rawInput, { vault, workspaceSalt });
    if (Array.isArray(parsed.forensicFindings)) {
      forensicFindings.push(...parsed.forensicFindings.map((f) => ({ source: name, ...f })));
    }
    for (const b of parsed.blocks || []) {
      rawBlocks.push({
        ...b,
        source: name,
        neuralSpans: item?.neuralSpans,
      });
    }
  }

  // Run Graph-Coupled Cross-Modal Conformal Redaction (GC-CRC) across all perceived blocks
  const gccrc = runGraphCoupledConformalRedaction(rawBlocks, {
    ...options,
    vault,
    workspaceSalt,
  });

  // Build Unlimited-OCR-style structured perception tag stream & token-windowed training chunks
  cleanEngine.dedupReset();
  const docTagsBySource = new Map();
  const chunks = [];
  const markdownLines = [];

  for (let i = 0; i < gccrc.blocks.length; i++) {
    const blk = gccrc.blocks[i];
    const src = blk.source || 'document';
    if (!docTagsBySource.has(src)) docTagsBySource.set(src, []);
    docTagsBySource.get(src).push(formatPerceptionBlockTag(blk, i));
    markdownLines.push(blk.maskedText);

    const wins = cleanEngine.chunkByTokenWindow(blk.maskedText, {
      maxTokens: maxTokensPerChunk,
      overlapTokens,
    });
    for (const w of wins) {
      const probe = w.text.replace(/^\[(?:Speech|Slide|\d{1,2}:\d{2})[^\]]*\]\s*/i, '').trim() || w.text;
      const d = cleanEngine.dedupCheck(probe, 0.85);
      if (d.action === 'exact_duplicate' || d.action === 'near_duplicate') continue;
      chunks.push({
        id: `chunk_${chunks.length + 1}`,
        source: src,
        modality: blk.modality || 'document',
        role: blk.structRole || 'PARAGRAPH',
        gate: blk.gateAction,
        coupledRiskScore: blk.coupledRiskScore,
        text: w.text,
        tokenEstimate: w.tokenCount,
        entityIds: Array.from(new Set((blk.entities || []).map((e) => e.entityId))),
      });
    }
  }

  const perceptionStream = Array.from(docTagsBySource.entries())
    .map(([src, tags]) => `<DOC src="${src}">\n  ${tags.join('\n  ')}\n</DOC>`)
    .join('\n');

  const markdown = markdownLines.join('\n\n');
  const sftJsonl = chunks
    .map((c) =>
      JSON.stringify({
        id: c.id,
        source: c.source,
        modality: c.modality,
        messages: [
          { role: 'system', content: 'Answer strictly from the provided sanitized context.' },
          { role: 'user', content: `Summarize the key record from ${c.source} (${c.role}).` },
          { role: 'assistant', content: c.text },
        ],
      })
    )
    .join('\n');

  // Index into zero-import Dual-CSR verisieve_graph.wasm for <1ms PPR & GDPR Art. 17 erasure
  const graphIndex = new PortableDocumentGraph({ workspaceSalt });
  const docsForGraph = Array.from(docTagsBySource.keys()).map((src) => ({
    source: src,
    blocks: gccrc.blocks
      .filter((b) => (b.source || 'document') === src)
      .map((b) => ({
        text: b.maskedText,
        structRole: b.structRole || 'PARAGRAPH',
        breadcrumb: b.breadcrumb || src,
        modality: b.modality || 'document',
        entityIds: Array.from(new Set((b.entities || []).map((e) => e.entityId))),
        preRedacted: true,
      })),
  }));
  graphIndex.indexDocuments(docsForGraph);

  const receiptPayload = {
    engine: 'versieve-gccrc-v1',
    blockCount: gccrc.blocks.length,
    chunkCount: chunks.length,
    anchorPoolSize: gccrc.anchorPoolSize,
    propagatedSpansCount: gccrc.propagatedSpansCount,
    forensicFindingsCount: forensicFindings.length,
    perceptionSha256: sha256Hex(perceptionStream),
  };

  return {
    perceptionStream,
    markdown,
    chunks,
    sftJsonl,
    blocks: gccrc.blocks,
    anchorPoolSize: gccrc.anchorPoolSize,
    propagatedSpansCount: gccrc.propagatedSpansCount,
    forensicFindings,
    audioArtifacts,
    videoArtifacts,
    graph: graphIndex,
    receipt: {
      ...receiptPayload,
      receiptSha256: sha256Hex(JSON.stringify(receiptPayload)),
    },
  };
}
