# Track E Handoff — Broadening VeriSieve & RTIO Sandbox to Full Enterprise Multimodal Unstructured Data

**Date:** 2026-11-23  
**Scope:** Both `matilda-portable` (portable Node.js CLI / MCP / WASM / C99 core) and sibling `Rtio/frontend` (browser Sandbox UI + Web Workers + WebGPU/WASM)  
**Core Invariant:** **100% Zero Data Egress** — raw files, emails, audio waveforms, video frames, secrets, and pseudonym vaults never leave the user's device. Every optional heavy runtime (Whisper ASR, GLiNER ONNX, OCR weights) fails closed cleanly when local weights are absent.

---

## 1. Executive Summary & Current Coverage Audit

Tracks A–D established a verified, zero-egress text/document curation, redaction, conformal gatekeeping, Dual-CSR graph retrieval, Native CAG, and local LoRA evaluation stack. However, real enterprise workspaces contain far more than PDFs and `.docx` files: **email threads with attachments, meeting audio/video calls with spoken names, slide decks with speaker notes, messy multi-tab spreadsheets, Slack/Teams threads, support tickets, calendar invites, and developer secrets/logs.**

### Current Coverage vs. Enterprise Gaps

| Data Family | Formats | `matilda-portable` Today | `Rtio` Sandbox Today | Priority |
|---|---|---|---|---|
| **Static Documents** | `.pdf`, `.docx`, `.md`, `.txt`, `.html` | Full (CMap/`TJ`, OOXML, SSRF HTML, Tier-0 headings) | Full (`browser-engine.ts`, `structure-extractor.ts`) | Done |
| **Tabular Text** | `.csv`, `.tsv` | Full (RFC-4180 + header-bound `TABLE_ROW`) | Full | Done |
| **Static Images / Scans** | `.png`, `.jpg`, `.bmp` | 2D 32px-overlap tiling + RGB box redaction + local OCR | Canvas + `browser-ocr.ts` | Done |
| **Emails & Threads** | `.eml`, `.mbox`, `.msg` | Basic text-only email test; **no MIME/attachment/thread parser** | Missing | **P0** |
| **Meeting Audio & Calls** | `.wav`, `.mp3`, `.m4a`, `.webm`, `.vtt`, `.srt` | Missing | Missing | **P0** |
| **Contextual Neural NER** | Spoken/lowercase names, free-form addresses, medical/legal terms | Regex-only (`49.6%` bare-name recall; `-0.062` Title-Case F1 tax) | Regex-only | **P0** |
| **Presentations & Spreadsheets** | `.pptx` (slides + **speaker notes**), `.xlsx` (sheets + **comments**) | Missing (ZIP + bomb guard already built for `.docx`!) | Missing (ZIP + `DecompressionStream` already built!) | **P1** |
| **Meeting Video & Screen-Shares** | `.mp4`, `.webm`, `.mov` (audio track + visual slide keyframes) | Missing | Missing (`WebCodecs` + `OffscreenCanvas` available) | **P1** |
| **Team Chat, Tickets & Calendar** | Slack JSON, Teams, Jira/Zendesk JSON, Confluence/Notion, `.ics` | Missing | Missing | **P1** |
| **Enterprise Secrets & Archives** | `.zip`, `.har`, `.env`, `.yaml`, `.sql`, API keys, JWTs, PEM keys | Partial (PII only; no secret/token scanner or recursive `.zip`) | Partial | **P2** |

---

## 2. Complete Enterprise Unstructured Data Taxonomy (What People Forget)

Real corporate data leaks happen disproportionately in **hidden sub-streams** inside common files—not just main body text:

1. **Email (`.eml`, `.mbox`, `.msg`)**
   - *Hidden leak vectors:* `From`/`To`/`Cc`/`Reply-To`/`Received` headers, quoted reply-chain histories (causing 5×–10× duplicate leakage), corporate signatures (mobile phone + direct title), and **base64 MIME attachments** (PDFs, invoices, spreadsheets embedded inside the email).
2. **Meeting Audio & Calls (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm`) + Subtitles (`.vtt`, `.srt`)**
   - *Hidden leak vectors:* Spoken names (`"send the contract to sarah chen"`—frequently lowercase in ASR output where Title-Case regex fails!), spoken phone/card numbers (`"four one five five five five..."`), speaker diarization labels (`Speaker: Elena Vance`), and raw audio bytes themselves (redacting only the transcript leaves the spoken name audible in the recording!).
3. **Meeting Video & Screen Recordings (`.mp4`, `.webm`, `.mov`)**
   - *Hidden leak vectors:* Shared browser tabs, Slack notification pop-ups, customer CRM dashboards, Zoom participant name overlays, and slide decks shown on screen (`"as you can see in this chart..."`).
4. **Slide Decks (`.pptx`) & Multi-Tab Spreadsheets (`.xlsx`)**
   - *Hidden leak vectors:* **`ppt/notesSlides/notesSlide*.xml` (presenter speaker notes)**, embedded chart labels/images (`ppt/media/*`), **`xl/comments*.xml` (spreadsheet cell comments)**, hidden tabs, and merged-header financial tables.
5. **Collaboration & Operational Exports (Slack/Teams JSON, Jira/Zendesk/ServiceNow, `.ics`, Confluence/Notion)**
   - *Hidden leak vectors:* Slack `users.json` (`<@U0123ABC>` mentions + real names/emails), threaded replies split across timestamps, `.ics` calendar `ATTENDEE`/`ORGANIZER` emails + Zoom/Teams dial-in PINs, and customer ticket attachments.
6. **Engineering & Network Artifacts (`.har`, `.log`, `.sql`, `.env`, `.yaml`, `.zip`)**
   - *Hidden leak vectors:* `Authorization: Bearer ...` JWTs, `Cookie` headers in `.har` browser captures, AWS/OpenAI/GitHub keys (`AKIA...`, `sk-...`, `ghp_...`), PEM private keys, and PostgreSQL/MongoDB connection URIs with embedded passwords.

---

## 3. Unified Multimodal Architecture (Shared Contract Across Both Repos)

Every new modality normalizes into one canonical intermediate block schema (`NormalizedMediaBlock`) so **Stages 2–4 (`verisieve_clean.wasm` → Redaction → LTT Conformal Gate → `verisieve_graph.wasm` Dual-CSR)** work identically without rewriting downstream code:

```ts
export interface NormalizedMediaBlock {
  source: string;                    // e.g. "calls/q3-review.mp4" or "mail/thread-04.eml"
  modality: 'document' | 'email' | 'chat' | 'table' | 'slide' | 'audio' | 'video_frame' | 'secret_log';
  breadcrumb: string;                // e.g. "q3-review.mp4 > 00:04:12–00:04:28 > Speaker_02"
  text: string;                      // raw extracted text (local RAM only; never exported unredacted)
  structRole: 'PROSE' | 'HEADING' | 'TABLE_ROW' | 'SPEAKER_NOTES' | 'TRANSCRIPT_TURN' | 'HEADER' | 'KEYFRAME_OCR';
  // Optional temporal / spatial anchors for media-level redaction:
  timeRangeMs?: { startMs: number; endMs: number };
  wordTimestamps?: Array<{ word: string; startMs: number; endMs: number; charStart: number; charEnd: number }>;
  speakerId?: string;
  frameTimeMs?: number;
  ocrBoxes?: Array<{ text: string; x: number; y: number; w: number; h: number }>;
  // Provenance for attachments / archives / threads:
  parentSource?: string;             // links attachment -> parent email/zip via DERIVED_FROM edge in verisieve_graph.wasm
  threadId?: string;
  contentHash?: string;
}
```

### Dual-Runtime Parity Matrix (`matilda-portable` vs. `Rtio` Browser Sandbox)

| Capability | `matilda-portable` (Node.js CLI / MCP / WASM) | `Rtio/frontend` (Browser Sandbox) | Shared Determinism |
|---|---|---|---|
| **`.eml` / `.mbox` / `.vtt` / `.srt` / `.ics` / Slack JSON** | Pure ESM JS zero-dep parsers (`src/enterprise-parsers.js`) | Exact TS mirror (`lib/verisieve/enterprise-parsers.ts`) | Byte-identical block output & hashes |
| **`.pptx` / `.xlsx` / `.zip` Container Unpacking** | Reuse existing ZIP central-directory + `zlib.inflateRawSync` + bomb guard (`src/ingestor.js`) | Reuse existing ZIP parser + native `DecompressionStream('deflate-raw')` (`browser-engine.ts`) | Identical XML extraction & table header binding |
| **Audio Decoding & Redacted `.wav` Synthesis** | Pure JS RIFF/WAV PCM16/Float32 codec + optional local `ffmpeg` for MP3/M4A | Native `AudioContext.decodeAudioData()` → 16 kHz mono PCM → pure TS WAV encoder (`Download Redacted WAV`) | Identical `[startMs, endMs]` mute/1 kHz beep algorithm (±40 ms padding) |
| **Word-Timestamped Local ASR** | Local `whisper.cpp` CLI or `@huggingface/transformers` ONNX (`whisper-base_timestamped`) | Web Worker running `@huggingface/transformers` v3 (`onnx-community/whisper-base_timestamped`, WebGPU + WASM fallback) or `whisper.cpp` WASM | Same `{ word, startMs, endMs }` contract; fail-closed if weights absent |
| **Video Keyframe Extraction & Visual Blur** | Optional local `ffmpeg` scene-change frames → existing `ocr-engine.js` + RGB box redactor | Web Worker running native **WebCodecs `VideoDecoder`** (or `<video>` seek + `OffscreenCanvas`) → `browser-ocr.ts` → Canvas Gaussian/solid box redaction | Same RGB bounding-box redaction receipt |
| **Stage 3B Contextual Neural PII (Apache-2.0 GLiNER)** | `onnxruntime-node` running quantized `gliner_pii_small` ONNX (~150–190 MB local cache) | Web Worker running `onnxruntime-web` (`executionProviders: ['webgpu', 'wasm']`, IndexedDB cache) | Exact same span union + `SaltedPseudonymVault` + LTT conformal gate |
| **Enterprise Secret Scanner** | Regex + Shannon entropy verifier (`src/secret-scanner.js`) | Exact TS mirror (`lib/verisieve/secret-scanner.ts`) | Same `<SECRET:TYPE_ID>` vault tokens |

---

## 4. Phased Implementation Plan (Tasks E1–E6)

### Task E1 — Zero-Dependency Enterprise Text & Office Containers (`.eml`, `.mbox`, `.pptx`, `.xlsx`, `.vtt`, `.srt`, `.ics`, Slack/Jira JSON)
**Why first:** Highest enterprise ROI, **zero new npm dependencies**, 100% deterministic in both Node and Browser, and directly reuses existing ZIP bomb-guarded unpacking and `TABLE_ROW` header masking.

- **`matilda-portable` files:**
  - `src/enterprise-parsers.js`:
    - `parseEmlBuffer(buf)` & `parseMboxBuffer(buf)`: RFC-5322 header extraction (`From`, `To`, `Cc`, `Subject`, `Date`, `Message-ID`, `In-Reply-To`), quoted-reply stripping (`On ... wrote:`, `> ` lines), signature/disclaimer stripping, MIME multipart decoding (`quoted-printable`, `base64`), and recursive attachment emission (`parentSource` linkage).
    - `extractPptxStructured(source, buf)`: Walks `ppt/slides/slide*.xml` + `ppt/notesSlides/notesSlide*.xml` (tagged `SPEAKER_NOTES`) + slide tables.
    - `extractXlsxStructured(source, buf)`: Walks `xl/workbook.xml`, `xl/sharedStrings.xml`, `xl/worksheets/sheet*.xml`, and `xl/comments*.xml` → emits header-bound GFM `TABLE_ROW` blocks (`Sheet: <name> > Row <n>`).
    - `parseSubtitleTranscript(source, rawText)`: Parses WebVTT (`.vtt`) and SubRip (`.srt`) into `TRANSCRIPT_TURN` blocks with `timeRangeMs` and `speakerId`.
    - `parseSlackExportJson(source, rawText, usersMap)` & `parseIcsCalendar(source, rawText)`: Thread-window aggregation (`thread_ts`), `<@U...>` user-ID resolution through `SaltedPseudonymVault`, and `.ics` attendee/PIN extraction.
  - Wire into `src/pdf-image-pipeline.js` (`ingestFromUrlOrPath`), `scripts/export-graph-sft-corpus.mjs`, and `src/mcp-server.js`.
- **`Rtio/frontend` files:**
  - `lib/verisieve/enterprise-parsers.ts` (exact TS mirror using native `DecompressionStream('deflate-raw')` and `DOMParser`).
  - Wire into `ingestBrowserFilesDetailed` in `lib/verisieve/browser-engine.ts` and dropzone `accept` list in `components/sandbox/`.
- **Acceptance test (`test/track-e-enterprise-parsers.test.js` + `Rtio` mirror):**
  - Fixture `.eml` with base64 PDF attachment + quoted reply chain: verifies headers redacted, duplicate quoted block stripped, attachment recursively parsed and linked via `DERIVED_FROM`.
  - Fixture `.pptx` with PII in speaker notes + `.xlsx` with PII in cell comment: verifies zero raw PII escapes while preserving table column headers.
  - Fixture `.vtt` call transcript with speaker name + spoken phone number: verifies speaker pseudonymized and `timeRangeMs` preserved.

---

### Task E2 — Enterprise Secret & Credential Scanner + Safe Recursive `.zip` Unpacking
**Why:** Company files regularly contain API keys, JWTs, `.har` auth cookies, and database URIs that human-PII regexes miss.

- **`matilda-portable` & `Rtio` mirror (`src/secret-scanner.js` / `lib/verisieve/secret-scanner.ts`):**
  - High-precision prefix + Shannon entropy detectors for: AWS Access/Secret Keys (`AKIA...`), OpenAI/Anthropic/Stripe/Slack tokens (`sk-...`, `xoxb-...`), GitHub PATs (`ghp_...`, `github_pat_...`), JWTs (`eyJ...` 3-segment base64url), PEM private keys (`-----BEGIN ... PRIVATE KEY-----`), DB connection URIs (`postgres://user:pass@...`), and `.har` JSON `Authorization`/`Cookie` header stripping.
  - Maps all hits into `SaltedPseudonymVault` (`<SECRET:API_KEY_01>`, `<SECRET:JWT_01>`) and updates `verisieve-train.py` pre-flight audit so secrets can never leak into SFT datasets.
  - Safe recursive `.zip` unpacker (max nesting depth `2`, max decompression ratio `25×`, max entry `50 MB`) dispatching each child file through the unified format router.
- **Acceptance test:** Synthetic `.har`, `.env`, and nested `.zip` fixtures achieve 100% secret removal with zero false positives on SHA-256 hex receipts and UUIDs.

---

### Task E3 — Client-Side Audio Call Ingestion, Word-Timestamped ASR & Sample-Accurate Waveform Redaction
**Why:** Directly solves the *"redact a meeting/call recording when someone speaks a name, phone number, or email"* requirement with **true audio-level redaction** (not just text-only transcript masking!).

- **Shared PCM Audio Redactor (`src/audio-redactor.js` / `lib/verisieve/audio-redactor.ts`):**
  - Pure JS/TS RIFF WAV decoder/encoder (`16-bit PCM` and `32-bit Float`, mono/stereo).
  - `redactAudioBuffer(pcmFloat32, sampleRate, redactedWordSpans, { mode: 'beep' | 'silence', padMs: 40, beepHz: 1000, beepGain: 0.12 })`:
    - Converts each detected PII/secret span's `[startMs - padMs, endMs + padMs]` into exact sample indices `Math.floor(ms * sampleRate / 1000)`.
    - Applies 5 ms cosine fade-in/fade-out ramps at boundaries (prevents audible clicks!) and overwrites the sensitive audio window with either pure silence or a clean 1 kHz censor tone.
    - Returns `{ redactedPcm, redactedWavBytes, redactionLog: [{ entityId, type, startMs, endMs }], sha256 }`.
- **Local Word-Timestamped ASR Adapters (Fail-Closed):**
  - **Browser (`Rtio/frontend/lib/verisieve/browser-asr-worker.ts`):** Dedicated Web Worker using `@huggingface/transformers` v3 (`onnx-community/whisper-base_timestamped`, `device: 'webgpu'` with automatic `'wasm'` fallback, cached in Browser Cache API / IndexedDB) returning `{ text, chunks: [{ text, timestamp: [startSec, endSec] }] }`. Note: requires COOP/COEP headers (`same-origin` / `require-corp`) for multi-threaded WASM SIMD.
  - **Node/CLI (`matilda-portable/src/local-asr.js`):** Pluggable local provider supporting `whisper.cpp` JSON (`--output-json-full` word timestamps) or local `@huggingface/transformers` ONNX cache; fails closed with `ASR_WEIGHTS_REQUIRED` when no local ASR model is configured (never calls a remote API!).
- **Sandbox UI (`Rtio`):**
  - Interactive audio player showing **before/after redacted waveform timeline** with highlighted `<PII:PERSON_01>` mute/beep markers, clickable timestamp jumps, and one-click **"Download Redacted WAV + Transcript (.vtt/.jsonl)"**.
- **Acceptance test:** Synthetic WAV audio fixture + mock/deterministic word-timestamp provider verifying: (a) RMS energy inside redacted PII spans equals `0.0` (silence mode) or pure 1 kHz tone (beep mode), (b) non-PII speech outside spans is bit-exact preserved, and (c) transcript + `verisieve_graph.wasm` store only `<PII:...>` tokens.

---

### Task E4 — Stage 3B Local Contextual Neural PII Tagger (Apache-2.0 GLiNER ONNX)
**Why:** Directly eliminates the two limitations measured in Paper 1 & Paper 2:
1. Format-validated regex misses **50.4% of bare person names** (`118/238` recall on `ai4privacy-200k`)—and misses **even more** in lowercase spoken call transcripts (`"tell sarah vance..."`).
2. Regex Title-Case heuristics over-mask legal/clinical headings (`APP Privacy Policy` → `APP <PII:PERSON_04>`, causing the `-0.062` F1 tax).

- **Architecture (`src/neural-pii-onnx.js` + `Rtio/frontend/lib/verisieve/browser-gliner-worker.ts`):**
  - Runs Apache-2.0 quantized **GLiNER-small PII ONNX** (`int8`, ~150–190 MB) via `onnxruntime-node` (`matilda-portable`) and `onnxruntime-web` (`['webgpu', 'wasm']` in `Rtio` Web Worker).
  - Open-vocabulary enterprise entity labels: `["person", "organization", "email", "phone_number", "street_address", "date_of_birth", "account_number", "medical_condition", "government_id"]`.
  - **Hybrid Fusion Engine:**
    - Runs Stage 3A (format-validated regex: Luhn cards, SSN, email, phone, IPv4 + enterprise secrets) in `< 1 ms`.
    - When local GLiNER weights are loaded, runs Stage 3B neural span extraction (threshold $\ge 0.50$), merges overlapping spans (preferring high-confidence regex for structured IDs and GLiNER for `person`/`address`/`organization`), and passes **all** spans through `SaltedPseudonymVault` + LTT conformal calibration.
    - When GLiNER weights are absent, fails closed into existing regex + 334-word lexicon mode with explicit `"neuralNerLoaded": false` provenance flag.
- **Target Benchmark Gate (re-run Paper 1 `ai4privacy-200k` 500-record + blind `PubMedQA` suite):**
  - Bare-name recall: `49.6%` → **target $\ge 88\%$** (including lowercase spoken names!).
  - All 26 structured tags recall: `31.0%` → **target $\ge 75\%$**.
  - Blind `PubMedQA` Title-Case false positives & legal heading over-masking (`APP Privacy Policy`): **target $< 0.3$ hits/1k words** (eliminating the `-0.062` F1 tax!).

---

### Task E5 — Client-Side Video Meeting Keyframe Extraction & Visual Screen-Share Redaction (`.mp4`, `.webm`)
**Why:** Screen-shared slides, browser tabs, and CRM tables in recorded Zoom/Teams meetings leak PII visually even when nobody says it out loud.

- **Pipeline:**
  1. **Audio stream** → routed into **Task E3** (Whisper word timestamps + waveform beep/mute).
  2. **Visual stream:**
     - **Browser (`Rtio`):** Web Worker using **WebCodecs `VideoDecoder`** (with `<video>` + `OffscreenCanvas` fallback) extracts scene-change keyframes (pixel-histogram L1 delta $> 0.15$ or every 5 seconds).
     - **Node/CLI (`matilda-portable`):** Optional local `ffmpeg` scene-filter frame extractor (`select='gt(scene,0.15)'`), failing closed cleanly if `ffmpeg` is absent.
  3. **OCR + Pixel Box Redaction:** Each keyframe passes through existing 2D-tiled OCR (`ocr-engine.js` / `browser-ocr.ts`), runs Stage 3A+3B PII detection on OCR word boxes, draws solid/blurred privacy masks over PII bounding boxes (reusing our existing RGB box redactor), and indexes redacted slide text + `frameTimeMs` into `verisieve_graph.wasm`!
- **Acceptance test:** Synthetic multi-frame video/slide fixture with planted email/SSN on frame 2 verifies: (a) keyframe detected, (b) RGB pixels inside the PII bounding box are 100% masked, (c) redacted slide text is searchable via `ppr_retrieve` with timestamp citation `[meeting.mp4 > 00:00:05]`.

---

### Task E6 — Unified Cross-Modal Knowledge Graph, GDPR Art. 17 Blast Radius & MCP Tools
**Why:** This is where VeriSieve becomes genuinely differentiated over generic ETL tools like Unstructured.io or LlamaParse.

- **Cross-Modal Entity Linking (`verisieve_graph.wasm`):**
  - Because `SaltedPseudonymVault` uses one workspace salt across **all** modalities, `"Elena Vance"` mentioned in an **email** (`.eml`), a **Zoom call transcript** (`.mp4`), a **Slide 4 speaker note** (`.pptx`), and an **Excel tracker** (`.xlsx`) maps to the **EXACT SAME entity node `<PII:PERSON_03>`** in `verisieve_graph.wasm`!
  - **One-Click Cross-Modal GDPR Art. 17 Erasure (`blast_radius`):** Calling `blast_radius("<PII:PERSON_03>")` in `< 1 ms` returns **every single email, audio segment timestamp, video keyframe, spreadsheet row, slide note, CAG KV cache slot, and SFT dataset shard** derived from that individual!
- **New MCP Tools (`src/mcp-server.js`):**
  - `ingest_enterprise_bundle` (auto-routes `.eml`, `.mbox`, `.pptx`, `.xlsx`, `.vtt`, `.srt`, `.ics`, Slack JSON, `.zip`, `.wav`, `.mp4`).
  - `redact_audio_call` (runs local ASR + Stage 3A/3B PII + waveform mute/beep → writes redacted `.wav` + `.vtt`).

---

## 5. Recommended Execution Order & Guardrails

1. **Do E1 + E2 first (1–2 days, zero external weights, zero risk):** Ships `.eml`, `.mbox`, `.pptx` (+ speaker notes), `.xlsx` (+ comments), `.vtt`/`.srt`, `.ics`, Slack/Jira JSON, `.zip`, and API-key/JWT secret scanning in **both** `matilda-portable` and `Rtio` Sandbox with 100% pure JS/TS parity.
2. **Do E3 + E4 second (2–3 days, biggest "wow" factor for local-first AI interviews):** Ships **real browser + CLI audio waveform redaction** (Whisper word timestamps → sample-accurate beep/mute WAV download) + **Apache-2.0 GLiNER ONNX WebGPU/Node** to shatter the 49.6% bare-name & spoken-lowercase-name ceiling.
3. **Do E5 + E6 third (2 days):** Adds WebCodecs video keyframe OCR/pixel redaction and unifies all modalities into `verisieve_graph.wasm` cross-modal GDPR Art. 17 `blast_radius`.

### Non-Negotiable Security & Repo Hygiene Checks
- **Zero data egress:** Never call remote ASR, remote NER, or remote OCR APIs. Every local model loader must fail closed cleanly with an explicit error code (`ASR_WEIGHTS_REQUIRED`, `NER_WEIGHTS_REQUIRED`, `MIRAGE_WEIGHTS_REQUIRED`).
- **Zip-bomb & SSRF guards:** Reuse existing entry-count, expansion-ratio, and private-IP guards across `.pptx`, `.xlsx`, `.zip`, and `.eml` HTML bodies.
- **No hardcoded machine paths:** Keep `test/t9-portable-benchmarks.test.js` 100% green across `src/`, `scripts/`, `test/`, `bin/`, and `demo/`.
- **Keep `Rtio` parity green:** Every new parser added to `matilda-portable/src/` gets a matching TypeScript module and unit test in `Rtio/frontend/lib/verisieve/`.
