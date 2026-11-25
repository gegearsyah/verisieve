/**
 * Task E3 — Client-Side Audio Call Ingestion, Spoken ITN, Sample-Accurate Waveform Redaction
 * & Fail-Closed Local ASR Adapter (powered by `versieve_media.wasm`).
 *
 * Zero Data Egress Invariant:
 * - Never calls remote ASR endpoints.
 * - Fails closed with `ASR_WEIGHTS_REQUIRED` when no local ASR provider/model is configured.
 * - Strips RIFF/WAV forensic metadata chunks (`LIST/INFO`, `bext`, `iXML`, `id3 `).
 * - Converts spoken numbers/emails/spelled names via WASM Spoken ITN back to exact `[startMs, endMs]`
 *   spans so waveform muting/beeping silences the ACTUAL spoken audio!
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadMediaWasmSync } from './media-wasm.js';
import { redactEnterpriseText } from './secret-scanner.js';
import { SaltedPseudonymVault } from './graph-wasm.js';

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function formatVttTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = String(Math.floor(total / 3600000)).padStart(2, '0');
  const m = String(Math.floor((total % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
  const rem = String(total % 1000).padStart(3, '0');
  return `${h}:${m}:${s}.${rem}`;
}

/**
 * Collapses Whisper decoder repetition loops inside a single utterance
 * (e.g. "the first part is that, the first part is that, the first part is that, like..."
 *  -> "the first part is that, like...")
 */
export function collapseRepeatedSpeechPhrases(rawText) {
  let text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const phraseRepeatRe = /\b([A-Za-z0-9']+(?:[\s,]+[A-Za-z0-9']+){0,7})(?:[\s,]+\1\b)+/gi;
  for (let pass = 0; pass < 4; pass++) {
    const next = text.replace(phraseRepeatRe, '$1');
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Deduplicates timestamped speech segments by comparing their normalized spoken content
 * (ignoring `[Speech MM:SS–MM:SS]` prefixes) via exact match, prefix/substring containment,
 * and symmetric token Jaccard >= 0.78 so repeated Whisper chunks never flood training sets.
 */
export function deduplicateSpeechSegments(segments = []) {
  const accepted = [];
  for (const seg of segments) {
    const collapsed = collapseRepeatedSpeechPhrases(seg.text);
    const norm = collapsed
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (norm.length < 3) continue;

    if (/^(thank you( for watching)?|thanks for watching|subtitles by .*|you)$/i.test(norm)) {
      continue;
    }

    const tokens = norm.split(' ').filter(Boolean);
    const tokenSet = new Set(tokens);
    if (tokenSet.size <= 1 && tokens.length >= 3) continue;

    let isDuplicate = false;
    for (const prev of accepted) {
      if (
        prev.norm === norm ||
        (prev.norm.startsWith(norm) && norm.length >= prev.norm.length * 0.65) ||
        (norm.startsWith(prev.norm) && prev.norm.length >= norm.length * 0.65)
      ) {
        isDuplicate = true;
        break;
      }
      if (tokenSet.size >= 4 && prev.tokenSet.size >= 4) {
        let shared = 0;
        tokenSet.forEach((tok) => {
          if (prev.tokenSet.has(tok)) shared++;
        });
        const union = tokenSet.size + prev.tokenSet.size - shared;
        const jaccard = union > 0 ? shared / union : 0;
        if (jaccard >= 0.78) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      accepted.push({
        startSec: seg.startSec,
        endSec: seg.endSec,
        text: collapsed,
        norm,
        tokenSet,
      });
    }
  }
  return accepted.map(({ startSec, endSec, text }) => ({ startSec, endSec, text }));
}

/**
 * Pure JS PCM16 mono/stereo WAV generator (handy for fixtures & tests; decoding/redaction uses WASM).
 */
export function encodePcm16Wav(samplesFloat32, sampleRate = 16000, channels = 1) {
  const dataBytes = samplesFloat32.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samplesFloat32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samplesFloat32[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Compute RMS energy of a PCM16 WAV buffer within `[startMs, endMs]`.
 */
export function measureWavWindowRms(wavBytes, startMs, endMs) {
  const u8 = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 12;
  let sr = 16000;
  let ch = 1;
  let dataStart = -1;
  let dataLen = 0;

  while (pos + 8 <= u8.byteLength) {
    const id = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
    const sz = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      ch = dv.getUint16(pos + 10, true);
      sr = dv.getUint32(pos + 12, true);
    } else if (id === 'data') {
      dataStart = pos + 8;
      dataLen = Math.min(sz, u8.byteLength - dataStart);
      break;
    }
    pos += 8 + sz + (sz & 1);
  }
  if (dataStart < 0 || dataLen < 2) return 0;

  const totalFrames = Math.floor(dataLen / (2 * ch));
  const sf = Math.max(0, Math.min(totalFrames, Math.floor((startMs * sr) / 1000)));
  const ef = Math.max(sf, Math.min(totalFrames, Math.floor((endMs * sr) / 1000)));
  if (ef <= sf) return 0;

  let sumSq = 0;
  let count = 0;
  for (let f = sf; f < ef; f++) {
    for (let c = 0; c < ch; c++) {
      const s = dv.getInt16(dataStart + (f * ch + c) * 2, true) / 32768;
      sumSq += s * s;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

/**
 * Local fail-closed ASR runner:
 * - Accepts an explicit `asrProvider(wavBytes, meta) => { words, speakerTurns? }`
 * - Or a local `whisper.cpp` CLI binary + local GGML model file (`whisperBin`, `whisperModelPath`)
 * - Never makes remote network calls; throws `ASR_WEIGHTS_REQUIRED` otherwise.
 */
export async function transcribeAudioLocally(wavBytes, options = {}) {
  if (typeof options.asrProvider === 'function') {
    const out = await options.asrProvider(wavBytes, { source: options.source || 'call.wav' });
    return {
      provider: 'injected_local_asr',
      words: Array.isArray(out?.words) ? out.words : [],
      speakerId: out?.speakerId || undefined,
    };
  }

  const whisperBin = options.whisperBin || process.env.VERSIEVE_WHISPER_BIN;
  const whisperModel = options.whisperModelPath || process.env.VERSIEVE_WHISPER_MODEL;
  if (whisperBin && whisperModel && fs.existsSync(whisperModel)) {
    if (!options.audioFilePath || !fs.existsSync(options.audioFilePath)) {
      throw new Error('ASR_FILE_PATH_REQUIRED: whisper.cpp CLI requires a local file path.');
    }
    const outPrefix = `${options.audioFilePath}.vs_asr`;
    execFileSync(whisperBin, ['-m', whisperModel, '-f', options.audioFilePath, '-ojf', '-of', outPrefix], {
      stdio: 'ignore',
      timeout: options.timeoutMs ?? 120000,
    });
    const jsonPath = `${outPrefix}.json`;
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    try { fs.unlinkSync(jsonPath); } catch {}
    const words = [];
    for (const seg of parsed.transcription || []) {
      for (const tok of seg.tokens || []) {
        const w = String(tok.text || '').trim();
        if (!w || w.startsWith('[')) continue;
        words.push({
          word: w,
          startMs: Math.round((tok.offsets?.from ?? 0)),
          endMs: Math.round((tok.offsets?.to ?? 0)),
        });
      }
    }
    return { provider: 'whisper_cpp_local', words };
  }

  throw new Error(
    'ASR_WEIGHTS_REQUIRED: Local word-timestamped ASR requires an injected local provider or VERSIEVE_WHISPER_BIN + VERSIEVE_WHISPER_MODEL (zero remote egress enforced).'
  );
}

/**
 * End-to-end zero-egress audio call redaction:
 * 1. Local word-timestamped ASR (fail-closed) or supplied `wordTimestamps`
 * 2. WASM Spoken ITN (`"four one five..."` -> `"415..."`, `"sarah dot chen at acme dot com"` -> `"sarah.chen@acme.com"`)
 * 3. Unified Stage 3A (+ optional Stage 3B GLiNER) PII & secret detection + SaltedPseudonymVault
 * 4. Maps detected spans back to exact original `[startMs, endMs]` word windows
 * 5. WASM sample-accurate WAV redaction (silence / 1 kHz beep / pink noise + 5 ms cosine fades) + metadata scrubbing
 * 6. Emits redacted WAV bytes, redacted WebVTT transcript, NormalizedMediaBlock[], and cryptographic receipt
 */
export async function redactAudioCall(source, wavBytes, options = {}) {
  const engine = loadMediaWasmSync();
  const vault = options.vault || new SaltedPseudonymVault(options.workspaceSalt || 'versieve-enterprise-v1');

  let words = Array.isArray(options.wordTimestamps) ? options.wordTimestamps : null;
  let provider = 'supplied_word_timestamps';
  if (!words) {
    const asr = await transcribeAudioLocally(wavBytes, { ...options, source });
    words = asr.words;
    provider = asr.provider;
  }

  // Step 1: Deterministic Spoken ITN in WASM with exact word-span millisecond back-pointers
  const itn = engine.normalizeSpokenWords(words);

  // Step 2: Optional Stage 3B neural spans on the ITN-normalized transcript
  let neuralSpans = options.neuralSpans || [];
  if (typeof options.neuralNerProvider === 'function') {
    neuralSpans = await options.neuralNerProvider(itn.normalizedText);
  }

  // Step 3: Unified Stage 3A (+ Stage 3B) PII & secret redaction
  const redacted = redactEnterpriseText(itn.normalizedText, {
    vault,
    neuralSpans,
    domainConfig: options.domainConfig,
  });

  // Step 4: Map every detected PII/secret character span back to original audio [startMs, endMs]
  const audioRedactWindows = [];
  const redactionLog = [];

  for (const ent of redacted.entities) {
    let minStart = Infinity;
    let maxEnd = -1;
    for (const wm of itn.wordMap) {
      if (wm.normEnd > ent.start && wm.normStart < ent.end) {
        if (wm.startMs < minStart) minStart = wm.startMs;
        if (wm.endMs > maxEnd) maxEnd = wm.endMs;
      }
    }
    if (minStart < Infinity && maxEnd > minStart) {
      audioRedactWindows.push({ startMs: minStart, endMs: maxEnd });
      redactionLog.push({
        entityId: ent.entityId,
        token: ent.token,
        type: ent.type,
        category: ent.category,
        startMs: minStart,
        endMs: maxEnd,
      });
    }
  }

  // Step 5: Sample-accurate WAV waveform redaction + RIFF forensic metadata scrubbing in WASM
  const wavResult = engine.redactWavBuffer(wavBytes, audioRedactWindows, {
    mode: options.mode || 'beep',
    padMs: options.padMs ?? 40,
    fadeMs: options.fadeMs ?? 5,
    beepHz: options.beepHz ?? 1000,
    beepGain: options.beepGain ?? 0.14,
  });

  // Step 6: Build redacted WebVTT + NormalizedMediaBlock for versieve_graph.wasm
  const totalStartMs = words.length > 0 ? Number(words[0].startMs ?? 0) : 0;
  const totalEndMs = words.length > 0 ? Number(words[words.length - 1].endMs ?? wavResult.meta.durationMs) : wavResult.meta.durationMs;
  const speakerLabel = options.speakerId || (wavResult.meta.channels >= 2 ? 'DualChannel_Call' : 'Speaker_01');

  const redactedVtt = [
    'WEBVTT',
    '',
    `${formatVttTime(totalStartMs)} --> ${formatVttTime(totalEndMs)}`,
    `<v ${speakerLabel}>${redacted.maskedText}`,
    '',
  ].join('\n');

  const blocks = [
    {
      source,
      modality: 'audio',
      breadcrumb: `${source} > ${formatVttTime(totalStartMs).slice(0, 8)}–${formatVttTime(totalEndMs).slice(0, 8)} > ${speakerLabel}`,
      text: redacted.maskedText,
      structRole: 'TRANSCRIPT_TURN',
      timeRangeMs: { startMs: totalStartMs, endMs: totalEndMs },
      speakerId: speakerLabel,
      entityIds: Array.from(new Set(redacted.entities.map((e) => e.entityId))),
      contentHash: sha256Hex(redacted.maskedText).slice(0, 16),
    },
  ];

  return {
    source,
    provider,
    redactedWavBytes: wavResult.redactedWavBytes,
    redactedWavSha256: sha256Hex(wavResult.redactedWavBytes),
    redactedTranscript: redacted.maskedText,
    redactedVtt,
    itnNormalizedLength: itn.normalizedText.length,
    spokenTransformsCount: itn.wordMap.filter((w) => w.kind !== 'word').length,
    redactionLog,
    audioMeta: wavResult.meta,
    blocks,
    vault,
  };
}
