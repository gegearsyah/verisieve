# Versieve

[![CI](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml/badge.svg)](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![WASM Kernels](https://img.shields.io/badge/zero--import_WASM-5_kernels_(365_KB)-0f766e)](#1-the-five-zero-import-no_std-rustwasm-kernels-vendorwasm) [![Live Sandbox](https://img.shields.io/badge/live_sandbox-rtio.io%2Fsandbox-1d4ed8)](https://www.rtio.io/sandbox)

**One-Shot Zero-Egress Multimodal Perception, Redaction & Tokenization for AI Training and RAG.**  
*Perceive any document, spreadsheet, email, audio recording, or video into structured, PII- and secret-free training tokens and knowledge graphs—100% locally in WebAssembly with zero server uploads.*

---

## 🔥 Highlights

- **One-Shot Multimodal Perception (`perceive` & `perceiveMulti`):** Rather than stitching together separate tools for PDFs, Office files, emails, audio calls, and screen-recorded videos, Versieve perceives heterogeneous files in a single pass—emitting structured layout/modality blocks (`<DOC><BLOCK...>`), clean Markdown, tokenized SFT/LoRA JSONL, and a live Dual-CSR knowledge graph.
- **Core Algorithmic Mechanism — `GC-CRC` (Graph-Coupled Cross-Modal Conformal Redaction):** Traditional redactors (Microsoft Presidio, vanilla GLiNER) score each chunk in isolation, missing unprefixed surnames in later paragraphs or homophone/OCR drift (`"Elena Vans"`, `"Pentikalnen"`) in audio and video slides—or suffering severe precision collapse when thresholds are lowered. `GC-CRC` maintains a bounded **Salted Reference Anchor Pool** (`128`-bit WASM Bloom+Soundex signatures) and propagates risk across chunks and modalities via Dual-CSR graph proximity, recovering **`76.11%` of noisy cross-modal follow-ups (`83.03%` entity-link rate) with zero extra domain false positives (`77.74%` precision, `75.18%` F1)**.
- **Auditable Binary-Level Zero Egress (`imports.length === 0`):** Powered by five standalone `#![no_std]` Rust→WebAssembly kernels (`365.9 KB` combined) compiled with **zero host imports**. A WASM module with zero imports has no network, filesystem, or OS syscalls—it can only read and write the memory slice passed to it.
- **Forensic Hidden-Channel Extraction:** Automatically extracts and audits hidden leak vectors that standard text parsers ignore: PowerPoint speaker notes & hidden slides, Excel `veryHidden` sheets, cell comments & `pivotCache` records, Word `<w:delText>` tracked deletions, Outlook `.msg` CFBF/OLE2 streams, HAR credentials, K8s Base64 Secrets, RIFF WAV chunks, and $O(1)$ MP4 `udta`/`meta` atoms.
- **Live Browser Sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)):** Run the entire pipeline client-side in your browser tab—including off-thread ONNX Runtime Web proxy Worker speech transcription (`whisper-tiny` `40.8 MB` `q8`, 99 languages) with DSP Voice Activity Detection across 30s windows, 1080p dark-mode contrast-inverted keyframe slide OCR, and interactive `.wav`/`.mp4`/`.png` redaction studio.

---

## 🧠 Core Concept: What is `GC-CRC`?

In traditional de-identification and document parsing pipelines, every text chunk, slide, or 30-second audio transcript turn is evaluated **independently** ($s_{\text{local}}(m)$):

1. **The Fragmented Context Horizon:** An entity introduced with explicit context on Page 1 of a legal ruling or in an email (*"Applicant: Mr. Markus Pentikäinen, case 11882/10"*) reappears 40 paragraphs later—or in a noisy Whisper ASR audio turn (*"markus pentikaynen"*) or dark-mode video slide (*"Pentikalnen"*)—without its title prefix or with character/phonetic drift. An isolated detector assigns low confidence ($s_{\text{local}}(m) < \tau$) and leaks the identity.
2. **Low-Threshold Precision Collapse:** Lowering a neural detector's global threshold from $\tau=0.60$ to $\tau=0.20$ to catch bare or noisy mentions causes false positives on domain-specific capitalized phrases (*"Clinical Trial"*, *"Confidence Interval"*, *"the High Court"*) to spike by $+140\%$.

**Versieve introduces Graph-Coupled Cross-Modal Conformal Redaction (`GC-CRC`, `src/perceive.js`)** to decouple cross-modal recall from local threshold lowering:

1. **Bounded Salted Reference Anchor Pool ($|A| \le 512$):** High-precision spans ($s_{\text{local}} \ge \tau_{\text{anchor}}$ or checksum-verified Stage 3A identifiers) populate a fixed-size working pool of reference anchors $A = \{(e_k, \text{sig}_k, v_k)\}$, storing only their 128-bit salted Bloom+Soundex signature $\text{sig}_k \in \{0,1\}^{128}$ (`vs_media_pprl_signature` in `verisieve_media.wasm`) and Dual-CSR graph node $v_k$ (`verisieve_graph.wasm`).
2. **Cross-Modal Graph-Phonetic Risk Propagation:** Candidate tokens $m$ in block $c$ across any modality (later paragraphs, audio ASR turns, video OCR keyframes) receive a coupled score:
   $$S_{\text{GC}}(m, c) = 1 - \bigl(1 - s_{\text{local}}(m)\bigr)\bigl(1 - \gamma \max_{a \in A} \operatorname{Sim}(\text{sig}(m), \text{sig}_a)(1 + \beta d_{a,c}^{-1})\bigr)$$
   Weak or noisy mentions that couple phonetically or lexically with an established reference anchor are promoted above $\tau_{\text{anchor}}$ and mapped to the **exact same `<PII:PERSON_k>` entity ID**, while uncoupled domain phrases remain untouched (`0` extra false positives).
3. **Finite-Sample LTT Conformal Certification:** Block-level coupled non-conformity scores feed a Learn-Then-Test (LTT) binomial gatekeeper ($\operatorname{BinomCDF}(k_j; n_{\text{cal}}, \alpha) \le \delta$), certifying corpus-level false-release risk $\le \alpha$ with explicit abstention when calibration support is insufficient.

---

## 📐 Structured Perception Output & Post-Processing

Like modern long-horizon perception engines that emit structured layout blocks before rendering Markdown or training records, Versieve natively produces a **Structured Multimodal Perception Stream** alongside ready-to-train outputs:

```xml
<DOC src="mail/deal.eml">
  <BLOCK id="b1" modality="email" role="EMAIL_HEADER" gate="KEEP_SAFE_REDACTED" risk="0.920" entities="[ent_email_41c9]">From: <PII:EMAIL_1> | Subject: Q4 Rollout</BLOCK>
  <BLOCK id="b2" modality="email" role="EMAIL_BODY" gate="KEEP_SAFE_REDACTED" risk="0.930" entities="[ent_person_8f2a]">Lead counsel Dr. <PII:PERSON_1> signed off on the audit.</BLOCK>
</DOC>
<DOC src="calls/standup.vtt">
  <BLOCK id="b3" modality="audio" role="TRANSCRIPT_TURN" gate="KEEP_SAFE_REDACTED" risk="0.884" time="[10000,15000]" entities="[ent_person_8f2a]"><PII:PERSON_1> reviewed the deck and confirmed deployment.</BLOCK>
</DOC>
```

From a single `perceive()` or `perceiveMulti()` call, Versieve returns:
- **`perceptionStream`**: Coordinate-, time-, and entity-anchored `<DOC><BLOCK...>` stream across all modalities.
- **`markdown`**: Clean, reading-order redacted Markdown ready for RAG indexing.
- **`chunks` & `sftJsonl`**: Token-windowed (`verisieve_clean.wasm`), SimHash-deduplicated chunks and chat-formatted SFT JSONL rows ready for LoRA fine-tuning.
- **`graph`**: Live Dual-CSR `verisieve_graph.wasm` instance supporting `<1 ms` Personalized PageRank (`pprRetrieve`) and GDPR Art. 17 right-to-be-forgotten erasure (`blastRadius`).
- **`receipt`**: Cryptographic SHA-256 provenance receipt (`versieve-gccrc-v1`).

---

## 🚀 Quickstart & Usage

### 1. Try It Instantly in Your Browser (Zero Install)
Open **[rtio.io/sandbox](https://www.rtio.io/sandbox)** and drop any PDF, `.docx`, `.pptx`, `.xlsx`, `.eml`, `.wav`, or `.mp4` into the tab. Everything runs locally inside your browser via WebAssembly and Web Workers.

### 2. One-Shot Perception in Node.js (`perceive` & `perceiveMulti`)
```javascript
import { perceive, perceiveMulti } from './src/index.js';

// Single file or raw text -> structured perception blocks, Markdown, SFT JSONL & graph
const single = await perceive('./scanned-contract.pdf');
console.log(single.perceptionStream);
console.log(single.sftJsonl);

// Multi-file cross-modal stack (shares GC-CRC Salted Reference Anchor Pool across email, slides & audio!)
const workspace = await perceiveMulti([
  { name: 'mail/deal.eml', text: 'From: elena.vance@acme.com\r\n\r\nDr. Elena Vance approved the budget.' },
  { name: 'decks/board.pptx', bytes: pptxBytes },
  { name: 'calls/standup.vtt', text: 'WEBVTT\n\n00:00:10.000 --> 00:00:15.000\n<v Speaker>Elena Vans reviewed the deck.\n' },
]);

// Notice "Elena Vans" (noisy ASR in standup.vtt) is automatically linked & redacted to <PII:PERSON_1>!
console.log(workspace.markdown);
```

### 3. Command-Line Interface & Zero-Import WASM Audit
```bash
git clone https://github.com/gegearsyah/verisieve.git
cd verisieve
npm install

# Verify that all 5 WebAssembly kernels have 0 host imports
npm run audit-wasm

# Ingest, deduplicate, and redact a local PDF, Office document, or folder
node bin/verisieve.mjs ingest --input ./scanned-document.pdf --out ./results/ingest.json

# Run the 107-test portable CI suite
npm run test:ci
```

---

## 📚 Research Papers (Included in `paper/`)

All three MLSys-formatted benchmark papers, along with their LaTeX sources, BibTeX references, vector figure builders (`paper/figs/`), and raw JSON benchmark outputs (`results/`), are checked into this repository:

1. **[Paper 1 — Deterministic Document Extraction, Data Redaction, and Conformal Gatekeeping](paper/verisieve-extraction-redaction-benchmark.pdf)** ([`.tex`](paper/verisieve-extraction-redaction-benchmark.tex))  
   *Evaluates native PDF CMap/kerning extraction, 2D overlapping tiling on 199 ICDAR-2019 FUNSD forms (`30,595` word boxes), deterministic PII disambiguation across `ai4privacy-200k` and `PubMedQA`, finite-sample LTT conformal calibration, and 7-trial interleaved runtime substrates (`C99` vs. `Node+WASM` vs. `Python+NumPy` vs. `PyTorch+DuckDB`).*
2. **[Paper 2 — Versieve-MM: Zero-Import WASM Multimodal Sanitization, Hybrid Neural NER, and Cross-Modal GDPR Erasure](paper/verisieve-multimodal-sanitization-benchmark.pdf)** ([`.tex`](paper/verisieve-multimodal-sanitization-benchmark.tex))  
   *Evaluates `verisieve_media.wasm`, Stage 3B `gliner-pii-edge`, and `GC-CRC` against external tools and human-annotated corpora: the Text Anonymization Benchmark (`TAB`, $N=1,268$ ECHR court rulings) vs. Microsoft Presidio (`en_core_web_lg` + custom recognizers), non-circular Ground-Truth LTT across three gate architectures, enterprise secrets vs. `Gitleaks v8.30.1` and Yelp `detect-secrets v1.5.0`, Unicode anti-evasion vs. Python `NFKC`, end-to-end TTS→Whisper (`base.en` / `small.en`) audio waveform redaction, 128-bit salted Bloom+Soundex PPRL across `124,750` candidate pairs, `<1 ms` GDPR Art. 17 erasure, and $O(1)$ multi-GB MP4 container scrubbing.*
3. **[Paper 3 — Benchmarking Sanitized Data for Local Open-Weight Model Training and Retrieval](paper/verisieve-local-training-benchmark.pdf)** ([`.tex`](paper/verisieve-local-training-benchmark.tex))  
   *Evaluates six open-weight models on an 8 GB RTX 4070 Laptop GPU (`Qwen2.5-0.5B-Instruct`, `Qwen2.5-1.5B-Instruct`, `LFM3-1.7B-Base` trained as matched Raw vs. Versieve-Safe assistant-only `T2-Chat` LoRA pairs, plus `lfm3:latest`, `llama3.2:3b`, `qwen2.5:7b` Ollama comparators): Carlini $20\times$-canary weight exposure, adversarial context extraction, `1,050` blinded LLM-judge evaluations (`T0+Graph-PPR` vs. `T2-Chat` LoRA on held-out and seen documents), and the VRAM crossover between Native KV-Cached CAG and Dual-CSR Graph-PPR.*

---

## 🏗️ System Architecture: Zero-Import WASM Kernels & Runtime Layers

### 1. The Five Zero-Import `#![no_std]` Rust→WASM Kernels (`vendor/wasm/`)

Every kernel is compiled with `wasm32-unknown-unknown` (`panic = "abort"`, LTO enabled) and verified in CI (`npm run audit-wasm`) to have **`0` host imports**:

| Kernel Binary | Size | Source Crate | Exports | Verified Responsibilities |
|---|---:|---|---:|---|
| **`verisieve_clean.wasm`** | `14,633 B` | `rust/verisieve-clean/` | `15` | HTML/script/style/comment stripping, UTF-8 entity decoding, 2,048-slot FNV-1a/SimHash deduplication ring with eviction accounting, and token-window chunking. |
| **`verisieve_media.wasm`** | `187,087 B` | `rust/verisieve-media/` | `24` | RFC 1951 DEFLATE/GZIP + ZIP/TAR (`100:1` bomb ratio & Zip-Slip guards), CFBF/OLE2 `.msg` stream extraction, NFKC + TR39 homoglyph + zero-width anti-evasion, checksum-verified PII (Luhn, IBAN mod-97, ABA, NPI, NHS, AU TFN, SSN) & 30+ secret scanner, 128-bit salted Bloom+Soundex PPRL (`vs_media_pprl_signature`), Spoken ITN (`vs_media_spoken_itn`), WAV PCM16 redaction (`silence`/`beep`/`noise` + RIFF metadata scrub), JPEG/PNG/MP4 metadata scrub (`udta`/`meta`/`EXIF`/`GPS`), 64-bin RGB scene-change delta, temporal box hold/interpolation, and RGB/RGBA pixel blackout/mosaic/Gaussian blur. |
| **`verisieve_graph.wasm`** | `54,402 B` | `rust/verisieve-graph/` | `24` | Dual-CSR forward/reverse knowledge graph (`65,536` nodes, `262,144` edges), HippoRAG-2 Personalized PageRank (`15` power iterations), $<1\,\text{ms}$ GDPR Art. 17 `blast_radius`, BFS shortest path, Tarjan SCC, Louvain clustering, and `.csr` binary snapshots. |
| **`verisieve_dl.wasm`** | `60,096 B` | `rust/verisieve-dl/` | `26` | 1.58-bit ternary BitNet quantization, VeRA adapter forward/backward updates (`mle_dl_vera_*`), and 64-dimensional needle retrieval embeddings. |
| **`verisieve_sql.wasm`** | `49,642 B` | `rust/verisieve-sql/` | `12` | Deterministic in-memory relational SQL subset engine (`MAX_ROWS = 4,096`). |

### 2. RTIO Browser Sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)) vs. Standalone Versieve CLI / MCP Server

Versieve runs the **exact same byte-identical WASM binaries** in the browser and in Node.js (enforced by CI parity tests), while adapting heavy media decoding to each runtime's memory boundaries:

| Capability | RTIO Browser Sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)) | Versieve Node.js CLI & 18-Tool MCP Server |
|---|---|---|
| **Data Egress Guarantee** | **100% client-side in the browser tab** under `Cross-Origin-Embedder-Policy: require-corp`. User files never upload to any server. | **100% local offline execution.** Fails closed on missing local weights; SSRF-hardened URL fetch blocks private/loopback/IMDS CIDRs. |
| **Documents & Archives** | Native PDF (`/ToUnicode` CMap, `/ObjStm`, `TJ` kerning), bit-3 `.docx`, `.pptx` (speaker notes + hidden slides), `.xlsx` (veryHidden sheets + comments + pivotCache), `.eml`, `.msg`, `.vtt`/`.srt`, `.har`, `.ipynb`, `.ics`, Slack JSON, `.zip`/`.tar.gz`. | Identical WASM + JS parsers (`src/enterprise-parsers.js`, `src/pdf-parser.js`, `src/structure-extractor.js`). |
| **Stage 3A PII & Secrets** | Live in-browser `verisieve_media.wasm` (`maskTextContextAware`) + `SaltedPseudonymVault` + forensic hidden-channel badges in `CleanTab`. | Identical `verisieve_media.wasm` Stage 3A + optional Stage 3B local ONNX `gliner-pii-edge` (`63.5 MB` INT8, `src/neural-pii-onnx.js`) + `GC-CRC` anchor propagation (`src/perceive.js`). |
| **Audio & Video Transcription + Redaction** | Off-main-thread ONNX Runtime Web proxy Worker (`/ort/ort-wasm-simd-threaded.*.wasm`) running multilingual `whisper-tiny` (`40.8 MB` `q8`, 99 languages, cached in browser CacheStorage) over DSP VAD-selected 30s active speech windows (up to **30 min / ~350 MB** per browser tab WebAudio RAM limit) + Spoken ITN + timestamp-agnostic speech dedup + 1080p dark-mode contrast-inverted keyframe slide OCR (`/ocr/*` Tesseract WASM with readability filtering) + interactive `MediaRedactionStudio` (`.wav` mute/beep, `.mp4` `O(1)` `Blob.slice()` atom scrub, `.png`/`.jpg` bounding-box pixel blackout/blur). | **No browser tab RAM limit (supports 3-hour+ multi-GB recordings):** `O(1)` `4 KB` file-descriptor seeking (`inspectMp4StreamMetadata` / `scrubMp4FileMetadata`), streaming local `ffmpeg` demuxing (`src/video-redactor.js`), native local `whisper.cpp` / `faster-whisper` (`src/audio-redactor.js`), and sample-accurate WAV & keyframe pixel redaction via `verisieve_media.wasm`. |
| **Retrieval & Training** | In-browser Dual-CSR `verisieve_graph.wasm` PPR + lexical/cosine hybrid retrieval (`Chat`), in-browser `verisieve_dl.wasm` VeRA adapter training (`Train`), and one-click sanitized SFT JSONL + LoRA script export. | Full `verisieve_graph.wasm` indexing, Native KV-Cached CAG dossier builder (`src/cag-dossier.js`) with `<1 ms` GDPR Art. 17 KV-slot eviction, and local RTX GPU LoRA training/evaluation harness. |

---

## 📊 Empirical Benchmarks Across All Three Papers

### 1. `GC-CRC` Cross-Modal Context-Horizon Benchmark (`60` Cases, `240` Multimodal Blocks)

Reproduced via `node scripts/eval-gccrc-benchmark.mjs` (`results/gccrc-cross-modal-benchmark.json`) across 4 linked modalities per case (Page-1 Ruling/Email Anchor, Follow-up Paragraph with bare surname, Noisy Whisper ASR Turn with homophone drift, and Dark-Mode Video Slide OCR with character substitution + domain clinical terms):

| Redaction Regime | Cross-Modal Follow-Up Recall | Overall Recall (`360` GT spans) | Domain False Positives | Precision | Overall F1 | Consistent Entity Link Rate |
|---|---:|---:|---:|---:|---:|---:|
| **Isolated Stage 3A (WASM Regex + Lexicon)** | `0.00%` | `34.72%` (`125`) | `75` | `62.50%` | `44.64%` | `0.00%` |
| **Isolated Hybrid ($\tau = 0.60$, high-precision)** | `0.00%` | `34.72%` (`125`) | `75` | `62.50%` | `44.64%` | `0.00%` |
| **Isolated Hybrid ($\tau = 0.20$, low-threshold)** | **`100.00%`** | **`84.72%` (`305`)** | `180` (`+140%` FPs) | `62.89%` | `72.19%` | `100.00%` |
| **Versieve `GC-CRC` ($\tau_{\text{anchor}} = 0.60$ + 128-bit Anchor Pool)** | **`76.11%`** | `72.78%` (`262`) | **`75` (`0` extra FPs)** | **`77.74%`** | **`75.18%`** | **`83.03%`** |

---

### 2. Paper 1: Document Extraction, PII Disambiguation & LTT Conformal Gatekeeping (`1,207` Public Docs)

Measured via `npm run bench:scale` (`results/scale-and-paradigm-benchmark.json`) across **ICDAR-2019 FUNSD** (`199` scanned forms, `30,595` word boxes), **PMC Full-Text** (`8` clinical PDFs), **PubMedQA** (`500` abstracts), and **`ai4privacy-200k`** (`500` records):

- **Born-Digital PDF CMap & Kerning (`8/8` PMC PDFs):** Scoped 1-byte/2-byte `/ToUnicode` CMap resolution and negative-kerning `TJ` (`<= -110`) space reconstruction extract `8,134` lines (`55,099` words) in `209.02 ms` total (`26.13 ms/paper`) without raster OCR.
- **ICDAR-2019 FUNSD Geometric Box Survival (`30,595` word boxes $\ge 8\times 4\text{ px}$):**
  - `stock_capped_8`: `5.20%` (`1,592`) | `untiled_512`: `20.53%` (`6,281`) | `horizontal_1d_band`: `71.29%` (`21,811`) | `tile_2d_zero_overlap`: `92.44%` (`28,283`) | **`tile_2d` ($512\times 512$, 32px overlap): `97.38%` (`29,793`)**.
- **Deterministic Regex Recall Ceiling & `334`-Word Lexicon False-Positive Reduction:**
  - On `ai4privacy-200k` (`500` records), deterministic regex recalls **`78.6%`** (`110/140`) of contact/card/IPv4 spans, **`62.8%`** (`159/253`) of targeted 8 patterns, **`49.6%`** (`118/238`) of bare person names, and **`31.0%`** (`180/580`) across all 26 structured tags.
  - On blind `PubMedQA` test abstracts (`250` docs, `63,739` words), the pre-committed `334`-word clinical/technical exclusion lexicon reduces Title-Case false positives by **`2.72x`** (`5.46 -> 2.01` hits/1k words; `45.2% -> 26.0%` affected docs).
- **7-Trial Interleaved Runtime Substrates (AMD Ryzen 7 7840HS, Windows 11):**
  - **C99 (`include/verisieve.h`)**: `14.12 ms` process spawn | `6.08 MB` RSS | `0.745 ms` warm `1,207×520` logistic.
  - **Node.js + `verisieve_dl.wasm`**: `106.22 ms` spawn (`1.045 ms` WASM init) | `55.97 MB` RSS (**`121.6x` faster spawn, `7.7x` lower RSS** than PyTorch+DuckDB at `12,917.14 ms` / `432.3 MB`).
  - **Python 3.12 + NumPy 2.4.3**: `388.79 ms` spawn | `31.49 MB` RSS | **`0.207 ms` warm `1,207×520` logistic** (NumPy BLAS wins warm batched matrix dot products once imported).

---

### 3. Paper 2: Multimodal Sanitization vs. External Baselines (`TAB`, Presidio, Gitleaks, detect-secrets, Whisper)

Reproduced via `python scripts/run-reviewer-tab-and-ltt.py` and `python scripts/run-reviewer-secrets-audio-pprl.py` (`results/reviewer-tab-and-ltt-benchmarks.json`, `results/reviewer-secrets-audio-pprl-benchmarks.json`):

#### A. Human-Annotated Legal PII: Text Anonymization Benchmark (`TAB`, $N=1,268$ ECHR Court Cases, `10,183` Spans)

| Detector Configuration | DIRECT Recall (`548` spans) | `[95% Bootstrap CI]` | All-Maskable Recall (`10,183`) | Precision | F1 | Latency / Doc |
|---|---:|---|---:|---:|---:|---:|
| **Versieve Stage 3A (WASM Regex + Lexicon)** | `97.99%` (`537`) | `[96.79%, 99.07%]` | `64.08%` | `36.68%` | `46.66%` | **`0.33 ms`** |
| **Microsoft Presidio Default (`en_core_web_lg`)** | `78.83%` (`432`) | `[75.44%, 82.06%]` | `69.98%` | `40.42%` | `51.24%` | `35.09 ms` |
| **Microsoft Presidio + Custom ECHR Code Regex** | `94.71%` (`519`) | `[92.73%, 96.48%]` | `70.93%` | `33.50%` | `45.51%` | `36.98 ms` |
| **Vanilla GLiNER (`gliner-pii-edge`, $\tau=0.20$)** | `31.02%` (`170`) | `[27.20%, 34.77%]` | `53.19%` | `35.15%` | `42.33%` | `583.48 ms` |
| **Versieve Hybrid (3A + 3B, $\tau=0.20$ high-recall)** | **`99.45%`** (`545`) | **`[98.73%, 100.0%]`** | **`75.02%`** | `28.93%` | `41.76%` | `583.81 ms` |
| **Versieve Hybrid (3A + 3B, $\tau=0.35$ balanced)** | `98.91%` (`542`) | `[97.97%, 99.64%]` | `72.44%` | `31.71%` | `44.11%` | `583.81 ms` |
| **Versieve Hybrid (3A + 3B, $\tau=0.70$ matched-prec)** | `90.88%` (`498`) | `[88.45%, 93.16%]` | `64.46%` | `36.37%` | **`46.50%`** | `583.81 ms` |

#### B. Non-Circular Ground-Truth LTT Gatekeeper (`1,999` TAB Paragraphs: `380` GT-Safe, `1,619` GT-Unsafe)

Labels are derived **strictly from human TAB annotations** ($Y_i = 1$ iff human annotators marked $\ge 1$ maskable PII span):

| Gate Architecture ($\alpha = 0.05, \delta = 0.05$) | $\tau_{\text{keep}}$ | Empirical False-Release (FPR) | Auto-Released Total | Safe Paragraph Yield | Gate + Redactor E2E DIRECT Leak |
|---|---:|---:|---:|---:|---:|
| **Gate A: 520-d Hashed N-Gram Logistic** | `0.62` | `4.19%` (`<= 5%` certified) | `4.95%` (`99/1,999`) | `16.32%` (`62/380`) | `1.10%` (`6/548`) |
| **Gate B: GLiNER Max-Score Baseline** | `0.77` | `4.81%` (`<= 5%` certified) | `6.00%` (`120/1,999`) | `19.47%` (`74/380`) | `0.73%` (`4/548`) |
| **Gate C: 526-d Detector-Informed Logistic** | `0.60` | **`4.19%` (`<= 5%` certified)** | **`5.80%` (`116/1,999`)** | **`15.53%` (`59/380`)** | **`0.55%` (`3/548`)** |

#### C. Enterprise Secrets (`275` Corpus: `145` Positives Across `29` Families + `130` Real Code/Config Negatives)

| Scanner | Precision | Recall | F1 | FP Rate (`130` clean files) | Single-Call Cold (`275` files) | Warm Steady-State (`275` files) |
|---|---:|---:|---:|---:|---:|---:|
| **Versieve Stage 3A (`verisieve_media.wasm`)** | **`100.00%`** | `64.63%` | **`78.52%`** | **`0.00%` (`0/130`)** | **`10.22 ms`** | **`3.67 ms` (`0.013 ms/file`)** |
| **Gitleaks `v8.30.1` (Native Go Binary)** | `92.42%` | `54.46%` | `68.54%` | `3.85%` (`5/130`) | `82.10 ms` | `36.71 ms` (`10.0x` slower) |
| **Yelp `detect-secrets v1.5.0` (Python)** | `61.54%` | **`68.09%`** | `64.65%` | `38.46%` (`50/130`) | `657.84 ms` | `491.32 ms` (`133.9x` slower) |

#### D. Unicode Evasion, End-to-End Whisper Audio Redaction, PPRL Scale & GDPR Erasure

- **Unicode Anti-Evasion (`70` adversarial vectors):** Naive ASCII regex `0.0%` (`0/70`) $\rightarrow$ Python `unicodedata.normalize('NFKC')` `42.86%` (`30/70`, catches fullwidth/ligatures but misses zero-width characters and Cyrillic/Greek homoglyphs) $\rightarrow$ **`verisieve_media.wasm` `100.0%` (`70/70`, `0/35` decoy FPs)**.
- **End-to-End Spoken Audio PII Redaction (`25` neural TTS calls, `95` planted PII tokens, cross-model `faster-whisper base.en` redactor vs. `small.en` attacker):** Unredacted audio exposes **`90.53%` (`86/95`)** of planted tokens to `small.en`. After `verisieve_media.wasm` Spoken ITN + PCM16 waveform redaction (`-48.9 dB` RMS attenuation), residual exposure drops to **`15.79%` (`15/95`)**—an **`82.56%` reduction in exposed tokens** (`71/86` eliminated), with remaining leaks transparently categorized into ASR boundary bleed (`6`), homophone substitution (`5`), and number fragmentation (`4`).
- **128-Bit Salted Bloom+Soundex PPRL (`vs_media_pprl_signature`):** Matches the plaintext Jaro-Winkler ceiling (`93.33%` recall, `96.55%` F1, `0.0%` FPR) and outperforms plaintext Levenshtein (`80.0%` recall) on noisy cross-modal pairs without storing plaintext. On a **`500`-entity (`124,750`-pair) adversarial common-surname stress test**, pairwise FPR is **`0.15%`** at $\tau_{\text{dice}}=0.78$ (`86.52%` F1).
- **Sub-Millisecond GDPR Art. 17 Erasure & $O(1)$ MP4 Scrubbing:** Cross-modal `blast_radius` resolves in **`0.088 ms`** (`100%` precision/recall across email, PPTX notes, VTT, OCR, and KV cache), and $O(1)$ streaming MP4 atom scrubbing neutralizes `udta`/`meta`/`©xyz` in **`< 2 ms`** (`< 4 KB` RAM) across `10 MB` to `1 GB` containers.

---

### 4. Paper 3: Local Open-Weight Model Training vs. Dual-CSR Graph-PPR & Native CAG (8 GB RTX 4070)

Evaluated across `Qwen2.5-0.5B-Instruct`, `Qwen2.5-1.5B-Instruct`, and `LFM3-1.7B-Base` (matched Raw vs. Versieve-Safe assistant-only `T2-Chat` LoRA adapters) plus `lfm3:latest`, `llama3.2:3b`, and `qwen2.5:7b`:

| Model (VRAM) | Carlini $20\times$ Canary Exposure: Raw LoRA $\rightarrow$ **Safe LoRA** | Rank-1 Memorized: Raw $\rightarrow$ **Safe** | Held-Out `50q` Blinded Judge: `T2-Chat Safe` $\rightarrow$ **`T0+Graph-PPR`** | Held-Out Token F1: `T2-Chat Safe` $\rightarrow$ **`T0+Graph-PPR`** | Seen-Doc `20q` Judge: `T2-Chat Safe` $\rightarrow$ **`T0+Graph-PPR`** |
|---|---|---|---|---|---|
| **`Qwen2.5-0.5B-Instruct`** (`2.29 GB`) | `8.25 bits` $\rightarrow$ **`3.32 bits` (`-4.93`)** | `3/12` $\rightarrow$ **`1/12`** | `23.0%` $\rightarrow$ **`55.0%`** ($p=0.001$) | `0.099` $\rightarrow$ **`0.265`** ($p=0.0005$) | `2.5%` $\rightarrow$ **`20.0%`** |
| **`Qwen2.5-1.5B-Instruct`** (`4.41 GB`) | `8.40 bits` $\rightarrow$ **`2.70 bits` (`-5.70`)** | `5/12` $\rightarrow$ **`0/12`** | `33.0%` $\rightarrow$ **`69.0%`** ($p=0.001$) | `0.112` $\rightarrow$ **`0.275`** ($p=0.0005$) | `7.5%` $\rightarrow$ **`40.0%`** |
| **`LFM3-1.7B-Base`** (`4.55 GB`) | `8.25 bits` $\rightarrow$ **`2.81 bits` (`-5.44`)** | `6/12` $\rightarrow$ **`1/12`** | `34.0%` $\rightarrow$ **`62.0%`** ($p=0.001$) | `0.128` $\rightarrow$ **`0.262`** ($p=0.0005$) | `5.0%` $\rightarrow$ **`25.0%`** |

- **Adversarial Context Extraction & Utility Cost (`qwen2.5:7b`):** Pre-processing redaction cuts verbatim secret leakage under adversarial extraction prompts from **`11/12` (`100%` of probes) to `0/12` (`0.0%`)** while matching unredacted compliance QA accuracy at **`75.0%` (`9/12` each, $\Delta = 0.0\%$)**.
- **Native KV-Cached CAG vs. Dual-CSR Graph-PPR Crossover:** When the sanitized dossier fits untruncated in VRAM (`~19–20k` tokens on `lfm3` and `llama3.2:3b`), Native CAG (`src/cag-dossier.js`) achieves `94.8–99.6%` KV token reuse and `11.8x–16.6x` repeat-turn speedups with `<1 ms` GDPR Art. 17 KV-slot eviction. When VRAM forces truncation (`qwen2.5:7b` at `14k` tokens), sub-millisecond `verisieve_graph.wasm` Graph-PPR (`0.62 ms`) beats truncated CAG by **`+33.3` accuracy points** (`75.0%` vs. `41.7%`; `100%` vs. `0%` multi-hop).

---

## 📁 Repository Structure

```text
versieve/
├── bin/
│   └── verisieve.mjs                 # CLI entrypoint (ingest, audit-wasm, train, gatekeeper, mcp)
├── include/
│   └── verisieve.h                   # Single-header C99 UTF-8 FNV-1a feature hasher & linear gate (2,129 B)
├── rust/
│   ├── verisieve-clean/              # #![no_std] Rust crate -> verisieve_clean.wasm (14.6 KB, 0 imports)
│   ├── verisieve-media/              # #![no_std] Rust crate -> verisieve_media.wasm (187.1 KB, 0 imports)
│   ├── verisieve-graph/              # #![no_std] Rust crate -> verisieve_graph.wasm (54.4 KB, 0 imports)
│   ├── verisieve-dl/                 # #![no_std] Rust crate -> verisieve_dl.wasm (60.1 KB, 0 imports)
│   └── verisieve-sql/                # #![no_std] Rust crate -> verisieve_sql.wasm (49.6 KB, 0 imports)
├── vendor/
│   ├── wasm/                         # Compiled zero-import WebAssembly binaries shared with RTIO
│   └── cactus/                       # Isolated cactus.wasm pure-memory 2D-tiled OCR runtime
├── src/
│   ├── perceive.js                   # One-shot multimodal perception & GC-CRC anchor propagation
│   ├── clean-wasm.js                 # JS/Node loader for verisieve_clean.wasm
│   ├── media-wasm.js                 # JS/Node loader for verisieve_media.wasm (24 exports)
│   ├── graph-wasm.js                 # Dual-CSR graph kernel, HippoRAG-2 PPR, SaltedPseudonymVault, Bloom PPRL
│   ├── enterprise-parsers.js         # Deep parsers (.eml, .msg, .pptx, .xlsx, .vtt, .har, .ipynb, .ics, Slack)
│   ├── secret-scanner.js             # Stage 3A+3B PII, checksums, 30+ secrets, and surname coreference
│   ├── neural-pii-onnx.js            # Fail-closed local ONNX GLiNER sliding-window span extractor
│   ├── audio-redactor.js             # Spoken ITN, WAV silence/beep/noise redaction, phrase/segment dedup
│   ├── video-redactor.js             # O(1) MP4 stream audit/scrub, 1080p keyframe OCR gate, temporal box blur
│   ├── pdf-parser.js                 # Pure-JS PDF /FlateDecode, /ObjStm, scoped /ToUnicode CMap, TJ kerning
│   ├── gatekeeper.js                 # 520-dim logistic scorer + Learn-Then-Test (LTT) binomial calibration
│   ├── cag-dossier.js                # KV-cached Native CAG serializer + GDPR Art. 17 KV-slot eviction
│   └── mcp-server.js                 # 18-tool JSON-RPC Model Context Protocol server
├── scripts/                          # Reproducible benchmark runners (Paper 1, Paper 2, Paper 3, GC-CRC)
├── results/                          # Deterministic JSON benchmark artifacts & SHA-256 receipts
├── paper/                            # Three MLSys-format LaTeX papers, .bib files, fig builders, and PDFs
└── test/                             # 107 portable CI tests + scale & multimodal regression suites
```

---

## 🔬 Reproducing the Benchmarks & Test Suites

```bash
# 1. Run the 107-test portable CI suite (WASM zero-import census, parsers, redaction, GC-CRC, graph, MCP)
npm run test:ci

# 2. Reproduce the GC-CRC Cross-Modal Context-Horizon benchmark (60 cases, 240 blocks)
node scripts/eval-gccrc-benchmark.mjs

# 3. Reproduce Paper 1 public benchmark suite (downloads FUNSD, ai4privacy, PubMedQA once)
node scripts/fetch-public-benchmarks.mjs
npm run bench:scale

# 4. Reproduce Paper 2 external baseline benchmarks (TAB, Presidio, Gitleaks, detect-secrets, Whisper, PPRL)
python scripts/run-reviewer-tab-and-ltt.py
python scripts/run-reviewer-secrets-audio-pprl.py
python paper/figs/build_track_e_figures.py
```

For security policies and zero-egress threat boundaries, see [SECURITY.md](SECURITY.md).
