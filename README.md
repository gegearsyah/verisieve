# Versieve

[![CI](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml/badge.svg)](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![WASM Kernels](https://img.shields.io/badge/zero--import_WASM-5_kernels_(380_KB)-0f766e)](#1-the-five-zero-import-no_std-rustwasm-kernels-vendorwasm) [![Live Sandbox](https://img.shields.io/badge/live_sandbox-rtio.io%2Fsandbox-1d4ed8)](https://www.rtio.io/sandbox)

**One-Shot Zero-Egress Multimodal Perception, Redaction & Tokenization for AI Training and RAG.**  
*Perceive any document, spreadsheet, presentation, image, email, audio recording, or video into structured, PII- and secret-free training tokens, synchronized omnimodal scene timelines, and knowledge graphs—100% locally in WebAssembly with zero server uploads.*

**The premise.** A company's knowledge is scattered across drives, mailboxes, wikis, ticket queues, call recordings, and slide decks. Versieve takes all of it, perceives every format locally, resolves the people and organizations across documents into one entity graph, and emits corpora, retrieval indexes, and cache contexts built on that identity. The goal is a model that understands the whole company because the data under it was understood and connected before training started.

---

## 🔥 Highlights

- **One-Shot Omnimodal Perception (`perceive` & `perceiveMulti`):** Rather than stitching together separate tools for PDFs, Office files, images, emails, audio calls, and screen-recorded videos, Versieve perceives heterogeneous files in a single pass—emitting structured layout/modality blocks (`<DOC><BLOCK...>`), a unified cross-modal **`sceneTimeline`**, clean Markdown, tokenized SFT/LoRA JSONL with **`PT-LM` (Privacy-Token Loss Masking)** metadata (`ptlmSftJsonl`), and a live Dual-CSR knowledge graph.
- **Pillar 1 — Hierarchical Cluster-Robust Conformal Risk Control (`HC-CRC`) & Streaming Conformal Martingales (`E-LTT`):** Paragraph-level non-conformity scores within multi-page legal or clinical documents violate IID exchangeability ($\mathrm{ICC} = 0.1276$, cluster design effect $\mathrm{DEFF} = 2.62$ on `TAB` ECHR court rulings, causing naive paragraph-IID LTT to overshoot $\alpha = 0.10$ at `10.10%` FPR). `HC-CRC` (`src/gatekeeper.js`) corrects the cluster design effect with a conservative Kish-style adjustment, holding held-out FPR below budget at every operating point (`0.18% <= 1%`, `0.92% <= 2%`, `2.53% <= 5%`, `8.19% <= 10%`, `12.57% <= 15%`, `15.77% <= 20%`), while `E-LTT` Ville supermartingales ($E_t \ge 1/\delta = 20$) certify streaming calibration anytime-validly.
- **Pillar 2 — `SR-MP` (Sparse-Reference Multimodal Perception) 512-Slot Salted Reference Sketch Ring in Zero-Import WASM:** Traditional redactors (Microsoft Presidio, vanilla GLiNER) score each chunk in isolation, missing unprefixed surnames in later paragraphs or homophone/OCR drift (`"Elena Vans"`, `"Pentikalnen"`) in audio and video slides. `verisieve_media.wasm` implements a fixed-capacity `512`-slot (`16 KB`, $O(1)$ space) Salted Reference Sketch Ring (`vs_media_srmp_reset`, `vs_media_srmp_seed_anchor`, `vs_media_srmp_query_candidate`) storing only `128`-bit salted Bloom+Soundex sketches (`0` plaintext bytes). Across real `TAB` ECHR court rulings, `WASM SR-MP` lifts GLiNER-Edge Person recall from `85.39% -> 88.41%` ($\tau=0.50$) and high-precision Person F1 from `27.88% -> 40.78%` ($\tau=0.70$); on real 25-call `faster-whisper` audio (`n=97` planted PII tokens), `WASM SR-MP` cuts cross-model `small.en` attacker leakage from `94.85%` (raw) and `20.62%` (isolated Spoken ITN + GLiNER) down to **`8.25%` (`8/97`, `21/25` zero-leak calls)** at `100.0%` non-PII speech context retention.
- **Pillar 3 — `PT-LM` (Privacy-Token Loss Masking) for Local LoRA Fine-Tuning:** Standard SFT on sanitized text leaves small models (`0.5B–1.7B`) dominated by high-surprisal `<PII:...>` placeholder tokens, which we call **placeholder-token gradient domination**: `40%–85%` of seen-document answers echo tags and `20%–47.5%` of in-scope held-out questions are falsely refused. `PT-LM` (`computePtlmMaskedSpans` in `src/perceive.js`) sets `labels[t] = -100` on placeholder spans and substitutes grammatical-role surrogates in the forward context, cutting tag emission to `0/210` and false refusals to `0.0%`, with seen-document token F1 `+0.194` / `+0.087` / `+0.117`. The effect is attributed to the masking-plus-substitution bundle, not to masking alone.
- **Auditable Binary-Level Zero Egress (`imports.length === 0`):** Powered by five standalone `#![no_std]` Rust→WebAssembly kernels (`388,797 B` combined) compiled with **zero host imports**. A WASM module with zero imports has no network, filesystem, or OS syscalls—it can only read and write the memory slice passed to it.
- **Forensic Hidden-Channel Extraction:** Automatically extracts and audits hidden leak vectors that standard text parsers ignore: PowerPoint speaker notes & hidden slides, Excel `veryHidden` sheets, cell comments & `pivotCache` records, Word `<w:delText>` tracked deletions, Outlook `.msg` CFBF/OLE2 streams, HAR credentials, K8s Base64 Secrets, RIFF WAV chunks, and $O(1)$ MP4 `udta`/`meta` atoms.
- **Live Browser Sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)):** Run the entire pipeline client-side in your browser tab—including off-thread ONNX Runtime Web proxy Worker speech transcription (`whisper-tiny` `40.8 MB` `q8`, 99 languages) with DSP Voice Activity Detection across 30s windows, 1080p dark-mode contrast-inverted keyframe slide OCR, and interactive `.wav`/`.mp4`/`.png` redaction studio.

---

## 🆕 What Is New: Training Data That Knows What It Describes

Document-to-training-data pipelines chunk by position and the chunk inherits meaning from where it sits. Versieve replaces that substrate with a resolved entity graph, and four properties follow that positional chunking does not have:

1. **One graph, every consumer.** The per-block, composed, and identity-pair training corpora, Graph-PPR retrieval (RAG), and CAG key-value cache prefill all traverse the same resolved entity graph: identity is resolved once, and every consumer inherits it. GraphGen generates new synthetic samples from a graph and in-context pretraining reorders by similarity; to our knowledge no prior artifact grounds the actual source bytes of multiple heterogeneous documents in resolved identity with per-sample provenance.
2. **Erasure as a byte-verified property of the data.** `eraseEntity` regenerates the corpus minus one entity, and the diff receipt fails loudly unless the byte-diff is exactly that entity's spans. Machine unlearning (SISA, approximate methods) modifies models after the fact; we are not aware of a prior corpus that makes erasure a property of the training data itself.
3. **Binary-level zero egress, receipted per run.** Five standalone `#![no_std]` Rust→WASM kernels with zero host imports, trap-armed network surfaces, and a 0 B egress receipt for every build.
4. **Per-sample conformal certificates.** Learn-Then-Test gatekeeping with certified recall bounds over the shipped binomial CDF kernel, detector-closed and stated as such.

Every number in the four papers in `paper/` is derived through the CI check chain from committed artifacts (1044 checks, 0 failures); the round-1 panel review and revision response are in `docs/review/paper4-round1/`.

---

## 🏛️ The Moat, Paper by Paper

Each paper defends one mechanism. The comparison below is the one a buyer would run: the same product with the mechanism removed, or the strongest external baseline on the same data.

| Paper | Mechanism | What you get without it | Measured difference | What the mechanism does not claim |
|---|---|---|---|---|
| **1 · Extraction** | Deterministic local extraction and a fail-closed LTT gate | Raster OCR, cloud preprocessing, or a threshold with no certified risk | `8/8` PMC PDFs at `209.02 ms`; `97.38%` FUNSD box survival; LTT `14.63% → 0.0%` conditional FPR; C99 startup `14.12 ms` vs `12,917 ms` for PyTorch+DuckDB | The certificate is detector-closed: it bounds what the scanner-derived labels can catch, not independent PII truth |
| **2 · Multimodal** | `SR-MP` cross-paragraph ring inside the zero-import media kernel, plus `HC-CRC` | Isolated per-paragraph GLiNER-Edge; naive paragraph-i.i.d. LTT | Person recall `85.39% → 88.41%` at `τ=0.50`; high-precision Person F1 `27.88% → 40.78%` at `τ=0.70`; audio attacker leakage `20.62% → 8.25%`; gate overshoot `10.10% → 8.19%` at `α=10%` | Presidio with the same ECHR regex still wins overall F1 (`79.26%` vs `45.91%`); on audio, plain Jaro-Winkler on the same anchors reaches `7.22%` leakage, so the ring's measured advantage is anchor privacy, not matching accuracy |
| **3 · Training** | `PT-LM` for redacted fine-tuning, and Graph-PPR retrieval as the stronger default | Standard SFT on redacted text; or closed-book LoRA with no retrieval | Tag hallucination `40%–85% → 0%`; false refusal `20%–47.5% → 0%`; seen-doc F1 `+0.194` / `+0.087` / `+0.117`; Graph-PPR beats every closed-book LoRA arm on held-out QA (`p=0.0005` on F1), at lower latency | The PT-LM effect is attributed to the masking-plus-surrogate bundle; a masking-only ablation is not run. At this scale the moat is retrieval, not training |
| **4 · Corpus** | Entity-indexed corpus with byte-verified erasure and graph routing | Positional chunking: no shared identity, no byte provenance, no exact removal | Graph-PPR `53.3%` exact (`83.3%` cross-document); `eraseEntity` regenerates the corpus with a byte-diff of exactly one entity's spans; a wrong merge amplifies by `14.32x` | Trained formats do not separate: composed `11.7%` vs per-block `10.0%` (McNemar `p=1.00`). BM25 answers `60.0%`, numerically above Graph-PPR. The `81.7%` routing figure is an upper bound given a correctly resolved identity |

### `SR-MP`, concretely

`SR-MP` is a fixed `512`-slot ring (`16 KB`) of `128`-bit salted Bloom+Soundex sketches inside `verisieve_media.wasm`. High-confidence detections in the first paragraphs seed the ring. A later bare surname, an OCR substitution, or an ASR homophone is scored against every sketch, and a match above the coupling threshold maps the mention to the same vaulted entity id. The ring stores no plaintext, so it survives redaction and stays inside the zero-import kernel.

The comparison is against the same detector with the ring removed:

| Condition | Person recall `τ=0.50` | Person F1 `τ=0.50` | Person F1 `τ=0.70` | Audio leakage |
|---|---:|---:|---:|---:|
| Isolated Dev-Filtered GLiNER-Edge | `85.39%` | `74.20%` | `27.88%` | `20.62%` |
| GLiNER-Edge + `SR-MP` ring | `88.41%` | `73.27%` | `40.78%` | `8.25%` |

Three boundaries belong next to those numbers. At `τ=0.50` the ring trades `0.93` F1 for `3.02` points of recall and sits slightly below Dev-Filtered GLiNER (`p=0.0448`); at `τ=0.70` it gains `12.90` F1 (`p=0.0002`). A dumb baseline that propagates every detected name to later same-document mentions reaches `61.07%` F1, and the ring beats it at both operating points (`p=0.0002`). On audio, plain Jaro-Winkler on the same anchor list reaches `7.22%` leakage, slightly better than the ring's `8.25%`; the ring's measured contribution there is that the anchor list stays salted and out of plaintext.

---

## 🗺️ Architecture, One GIF per Paper

Each animation follows the path its paper measures, including the branches. Boxes are mechanisms, numbered badges are order, dashed arrows are data flow, teal `YES` and red `NO` labels mark decisions, and boxes below the main row are the side paths (OCR fallback, abstention, a refused answer that retries retrieval, the next container in a stream). The cards under each stage name the module or function that actually runs there. All four share the same hand-drawn register and run as a seamless dash-march loop.

**Paper 1: what data should lose.** Source files become deterministic extraction, regex and lexicon redaction, an LTT gate that fails closed, and a clean training handoff.

![Paper 1 extraction architecture](docs/architecture-a-extraction.gif)

**Paper 2: what data should keep out.** Enterprise containers enter the zero-import media kernel, `SR-MP` couples cross-paragraph and cross-modal mentions, `HC-CRC` bounds release risk, and the decision carries a certificate.

![Paper 2 multimodal architecture](docs/architecture-d-multimodal.gif)

**Paper 3: what data should carry.** The redacted corpus either goes through `PT-LM` and LoRA SFT to the blind judges, or skips training entirely and answers through Graph-PPR retrieval.

![Paper 3 training architecture](docs/architecture-c-training.gif)

**Paper 4: how data should look.** Estate documents become vaulted values and a resolved entity graph, then a deterministic corpus that feeds four consumers, including `eraseEntity`.

![Paper 4 corpus architecture](docs/verisieve-architecture.gif)

---

## 🧠 Core Concept: What is `GC-CRC`?

In traditional de-identification and document parsing pipelines, every text chunk, slide, or 30-second audio transcript turn is evaluated **independently** ($s_{\text{local}}(m)$):

1. **The Fragmented Context Horizon:** An entity introduced with explicit context on Page 1 of a legal ruling or in an email (*"Applicant: Mr. Markus Pentikäinen, case 11882/10"*) reappears 40 paragraphs later—or in a noisy Whisper ASR audio turn (*"markus pentikaynen"*) or dark-mode video slide (*"Pentikalnen"*)—without its title prefix or with character/phonetic drift. An isolated detector assigns low confidence ($s_{\text{local}}(m) < \tau$) and leaks the identity.
2. **Low-Threshold Precision Collapse:** Lowering a neural detector's global threshold from $\tau=0.60$ to $\tau=0.20$ to catch bare or noisy mentions causes false positives on domain-specific capitalized phrases (*"Clinical Trial"*, *"Confidence Interval"*, *"the High Court"*) to spike by $+140\%$.

**Versieve introduces Graph-Coupled Cross-Modal Conformal Redaction (`GC-CRC`, `src/perceive.js`)** to decouple cross-modal recall from local threshold lowering:

1. **Bounded Salted Reference Anchor Pool ($|A| \le 512$):** High-precision spans ($s_{\text{local}} \ge \tau_{\text{anchor}}$ or checksum-verified Stage 3A identifiers) populate a fixed-size working pool of reference anchors $A = \{(e_k, \text{sig}_k, v_k)\}$, storing only their 128-bit salted Bloom+Soundex signature $\text{sig}_k \in \{0,1\}^{128}$ (`vs_media_pprl_signature` in `verisieve_media.wasm`) and Dual-CSR graph node $v_k$ (`verisieve_graph.wasm`).
2. **Cross-Modal Graph-Phonetic Risk Propagation:** Candidate tokens $m$ in block $c$ across any modality (later paragraphs, audio ASR turns, video OCR keyframes) receive a coupled score:

   $S_{\text{GC}}(m, c) = 1 - \bigl(1 - s_{\text{local}}(m)\bigr)\bigl(1 - \gamma \max_{a \in A} \mathrm{Sim}(\text{sig}(m), \text{sig}(a))(1 + \beta d_{a,c}^{-1})\bigr)$

   Weak or noisy mentions that couple phonetically or lexically with an established reference anchor are promoted above $\tau_{\text{anchor}}$ and mapped to the **exact same `<PII:PERSON_k>` entity ID**, while uncoupled domain phrases remain untouched (`0` extra false positives).
3. **Finite-Sample LTT Conformal Certification:** Block-level coupled non-conformity scores feed a Learn-Then-Test (LTT) binomial gatekeeper ($\mathrm{BinomCDF}(k_j; n_{\text{cal}}, \alpha) \le \delta$), certifying corpus-level false-release risk $\le \alpha$ with explicit abstention when calibration support is insufficient.

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

# Run the 108-test portable CI suite
npm run test:ci
```

---

## 📦 What Comes Out, and How You Train on It

`perceive()` and `perceiveMulti()` return more than chunks. Each call returns `perceptionStream` (a `<DOC><BLOCK>` text stream that keeps document structure), `markdown`, `chunks`, `sftJsonl`, `ptlmSftJsonl`, `graph`, and `receipt`. The JSONL is an ordinary chat file, the graph is a by-product you can ignore, and consuming any output is optional.

### The JSONL is an ordinary chat file

Each line is one sample with a system prompt, a user prompt naming the source, and the redacted chunk as the assistant answer:

```json
{"id":"contracts/msa.pdf#3","source":"contracts/msa.pdf","modality":"document",
 "messages":[
  {"role":"system","content":"Answer strictly from the provided sanitized context."},
  {"role":"user","content":"Summarize the key record from contracts/msa.pdf (body)."},
  {"role":"assistant","content":"The agreement renews on 2027-03-01. <PII:PERSON_1> signs for the vendor."}]}
```

`ptlmSftJsonl` adds `ptlm_mask_spans`, `ptlm_placeholder_count`, and `ptlm_unmasked_ratio` to the same row. Those spans mark where a secret was replaced by a placeholder.

### Training is a small LoRA run, not a pipeline to build

Feed either file to any SFT trainer. The recipe this repository measures is in `scripts/run-track-d-fair-lora.py`: a PEFT `LoraConfig`, assistant-only loss (prompt tokens are labeled `-100` so the model is graded only on the answer), 80 steps, seed 42, on `Qwen2.5-0.5B/1.5B` and `LFM3-1.7B`, inside 8 GB of GPU memory. The PT-LM arm also masks placeholder subwords out of the loss and forward-substitutes a same-length surrogate, so the model learns the identity slot without ever learning the value that filled it.

Nothing about that needs the graph. The graph stays separate from training.

### Three ways to consume the same data

| Path | What it is | When to use it |
|---|---|---|
| **LoRA SFT** | Train on `sftJsonl` or `ptlmSftJsonl`. | The knowledge must live in the weights (offline, single model, no retrieval). |
| **Graph-PPR retrieval** | Keep documents on disk, build the entity graph, and answer with `pprRetrieve` contexts at question time. | The knowledge changes, must be attributable to a source, or must be erasable. |
| **CAG cache prefill** | Prefill a fixed KV cache from per-entity records, then append only the question. | The question population is small and stable and prefill cost must be amortized. |

### The honest part

Paper 4 measured all three on a 115-document noisy estate with 60 questions, one 1.5B model, and a 25,755-token budget. The trained formats did not separate: composed samples reached 11.7% exact match and per-block chunks 10.0% (McNemar p=1.00), against a base of 1.7%. Graph-PPR retrieval with no fine-tuning answered 53.3%, and a plain BM25 control 60.0%, numerically above the graph and within noise at n=60. So the measured win is retrieval, provenance, and byte-verified erasure, not fine-tuning. Train when the model must carry the knowledge itself; retrieve when it can look it up.

---

## 📚 Research Papers (Included in `paper/`)

All four MLSys-formatted benchmark papers, along with their LaTeX sources, BibTeX references, vector figure builders (`paper/figs/`), and raw JSON benchmark outputs (`results/`), are checked into this repository:

1. **[Paper 1 — What Training Data Should Lose: Local Extraction, Redaction, and Fail-Closed Gatekeeping](paper/verisieve-extraction-redaction-benchmark.pdf)** ([`.tex`](paper/verisieve-extraction-redaction-benchmark.tex))  
   *Evaluates native PDF CMap/kerning extraction, 2D overlapping tiling on 199 ICDAR-2019 FUNSD forms (`30,595` word boxes), deterministic PII disambiguation across `ai4privacy-200k` and `PubMedQA`, finite-sample LTT conformal calibration, and 7-trial interleaved runtime substrates (`C99` vs. `Node+WASM` vs. `Python+NumPy` vs. `PyTorch+DuckDB`).*
2. **[Paper 2 — What Training Data Should Keep Out: Multimodal Sanitization and Fail-Closed Release](paper/verisieve-multimodal-sanitization-benchmark.pdf)** ([`.tex`](paper/verisieve-multimodal-sanitization-benchmark.tex))  
   *Evaluates the `204,031 B` zero-import `verisieve_media.wasm`, `SR-MP` anchor coupling, Stage 3B `gliner-pii-edge`, and `HC-CRC` / `E-LTT` against external tools and human-annotated corpora: the Text Anonymization Benchmark (`TAB`, $N=1,268$ ECHR court rulings) vs. Microsoft Presidio (`en_core_web_lg` + custom recognizers), non-circular ground-truth LTT across three gate architectures, enterprise secrets vs. `Gitleaks v8.30.1` and Yelp `detect-secrets v1.5.0`, Unicode anti-evasion vs. Python `NFKC`, end-to-end TTS→Whisper (`base.en` / `small.en`) audio waveform redaction, 128-bit salted Bloom+Soundex PPRL across `124,750` candidate pairs, cross-modal GDPR Art. 17 erasure, and $O(1)$ multi-GB MP4 container scrubbing.*
3. **[Paper 3 — What Training Data Should Carry: Local Fine-Tuning, Loss Masking, and the Retrieval That Beats It](paper/verisieve-local-training-benchmark.pdf)** ([`.tex`](paper/verisieve-local-training-benchmark.tex))  
   *Evaluates three fine-tuned models on an 8 GB RTX 4070 Laptop GPU (`Qwen2.5-0.5B-Instruct`, `Qwen2.5-1.5B-Instruct`, `LFM3-1.7B-Base` trained as matched Raw vs. Versieve-Safe assistant-only `T2-Chat` LoRA pairs) plus three quantized Ollama comparators (`lfm3:latest`, `llama3.2:3b`, `qwen2.5:7b`): Carlini $20\times$-canary weight exposure, adversarial context extraction, blinded local `qwen2.5:7b` and cross-family `llama3.2:3b` judge grading, and the finding that zero-training Graph-PPR retrieval beats every closed-book LoRA arm at this scale.*
4. **[Paper 4 — How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe](paper/verisieve-graph-grounded-enterprise-corpus.pdf)** ([`.tex`](paper/verisieve-graph-grounded-enterprise-corpus.tex))  
   *Describes the entity-indexed training corpus built by the zero-egress pipeline (every detected value vaulted behind a salted placeholder and resolved onto a stable entity identifier, with per-sample provenance and conformal certificates), a ten-arm head-to-head across trained formats, question-time Graph-PPR retrieval, and CAG cache prefill on a synthetic noisy estate, and exact corpus regeneration minus one entity with byte-diff erasure receipts. The trained formats do not separate; the measured wins are retrieval, provenance, and erasure.*

---

## 🏗️ System Architecture: Zero-Import WASM Kernels & Runtime Layers

### 1. The Five Zero-Import `#![no_std]` Rust→WASM Kernels (`vendor/wasm/`)

Every kernel is compiled with `wasm32-unknown-unknown` (`panic = "abort"`, LTO enabled) and verified in CI (`npm run audit-wasm`) to have **`0` host imports**:

| Kernel Binary | Size | Source Crate | Exports | Verified Responsibilities |
|---|---:|---|---:|---|
| **`verisieve_clean.wasm`** | `14,633 B` | `rust/verisieve-clean/` | `18` | HTML/script/style/comment stripping, UTF-8 entity decoding, 2,048-slot FNV-1a/SimHash deduplication ring with eviction accounting, and token-window chunking. |
| **`verisieve_media.wasm`** | `204,031 B` | `rust/verisieve-media/` | `29` | RFC 1951 DEFLATE/GZIP + ZIP/TAR (`100:1` bomb ratio & Zip-Slip guards), CFBF/OLE2 `.msg` stream extraction, NFKC + TR39 homoglyph + zero-width anti-evasion, checksum-verified PII (Luhn, IBAN mod-97, ABA, NPI, NHS, AU TFN, SSN) & 30+ secret scanner, 128-bit salted Bloom+Soundex PPRL (`vs_media_pprl_signature`), **`SR-MP` 512-slot (`16 KB`) Salted Reference Sketch Ring (`vs_media_srmp_reset`, `vs_media_srmp_seed_anchor`, `vs_media_srmp_query_candidate`)**, Spoken ITN (`vs_media_spoken_itn`), WAV PCM16 redaction (`silence`/`beep`/`noise` + RIFF metadata scrub), JPEG/PNG/MP4 metadata scrub (`udta`/`meta`/`EXIF`/`GPS`), 64-bin RGB scene-change delta, temporal box hold/interpolation, and RGB/RGBA pixel blackout/mosaic/Gaussian blur. |
| **`verisieve_graph.wasm`** | `54,402 B` | `rust/verisieve-graph/` | `27` | Dual-CSR forward/reverse knowledge graph (`65,536` nodes, `262,144` edges), HippoRAG-2 Personalized PageRank (`15` power iterations), $<1\,\text{ms}$ GDPR Art. 17 `blast_radius`, BFS shortest path, Tarjan SCC, Louvain clustering, and `.csr` binary snapshots. |
| **`verisieve_dl.wasm`** | `60,096 B` | `rust/verisieve-dl/` | `27` | 1.58-bit ternary BitNet quantization, VeRA adapter forward/backward updates (`mle_dl_vera_*`), and 64-dimensional needle retrieval embeddings. |
| **`verisieve_sql.wasm`** | `55,635 B` | `rust/verisieve-sql/` | `15` | Deterministic in-memory relational SQL subset engine (`MAX_ROWS = 4,096`). |

### 2. RTIO Browser Sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)) vs. Standalone Versieve CLI / MCP Server

Versieve runs the **exact same byte-identical WASM binaries** in the browser and in Node.js (enforced by CI parity tests), while adapting heavy media decoding to each runtime's memory boundaries:

| Capability | RTIO Browser Sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)) | Versieve Node.js CLI & 18-Tool MCP Server |
|---|---|---|
| **Data Egress Guarantee** | **100% client-side in the browser tab** under `Cross-Origin-Embedder-Policy: require-corp`. User files never upload to any server. | **100% local offline execution.** Fails closed on missing local weights; SSRF-hardened URL fetch blocks private/loopback/IMDS CIDRs. |
| **Documents & Archives** | Native PDF (`/ToUnicode` CMap, `/ObjStm`, `TJ` kerning), bit-3 `.docx`, `.pptx` (speaker notes + hidden slides), `.xlsx` (veryHidden sheets + comments + pivotCache), `.eml`, `.msg`, `.vtt`/`.srt`, `.har`, `.ipynb`, `.ics`, Slack JSON, `.zip`/`.tar.gz`. | Identical WASM + JS parsers (`src/enterprise-parsers.js`, `src/pdf-parser.js`, `src/structure-extractor.js`). |
| **Stage 3A PII & Secrets** | Live in-browser `verisieve_media.wasm` (`maskTextContextAware`) + `SaltedPseudonymVault` + forensic hidden-channel badges in `CleanTab`. | Identical `verisieve_media.wasm` Stage 3A + optional Stage 3B local ONNX `gliner-pii-edge` (`63.5 MB` INT8, `src/neural-pii-onnx.js`) + `GC-CRC` anchor propagation (`src/perceive.js`). |
| **Audio & Video Transcription + Redaction** | Off-main-thread ONNX Runtime Web proxy Worker (`/ort/ort-wasm-simd-threaded.*.wasm`) running multilingual `whisper-tiny` (`40.8 MB` `q8`, 99 languages, cached in browser CacheStorage) over DSP VAD-selected 30s active speech windows (up to **30 min / ~350 MB** per browser tab WebAudio RAM limit) + Spoken ITN + timestamp-agnostic speech dedup + 1080p dark-mode contrast-inverted keyframe slide OCR (`/ocr/*` Tesseract WASM with readability filtering) + interactive `MediaRedactionStudio` (`.wav` mute/beep, `.mp4` `O(1)` `Blob.slice()` atom scrub, `.png`/`.jpg` bounding-box pixel blackout/blur). | **No browser tab RAM limit (supports 3-hour+ multi-GB recordings):** `O(1)` `4 KB` file-descriptor seeking (`inspectMp4StreamMetadata` / `scrubMp4FileMetadata`), streaming local `ffmpeg` demuxing (`src/video-redactor.js`), native local `whisper.cpp` / `faster-whisper` (`src/audio-redactor.js`), and sample-accurate WAV & keyframe pixel redaction via `verisieve_media.wasm`. |
| **Retrieval & Training** | In-browser Dual-CSR `verisieve_graph.wasm` PPR + lexical/cosine hybrid retrieval (`Chat`), in-browser `verisieve_dl.wasm` VeRA adapter training (`Train`), and one-click sanitized SFT JSONL + LoRA script export. | Full `verisieve_graph.wasm` indexing, Native KV-Cached CAG dossier builder (`src/cag-dossier.js`) with `<1 ms` GDPR Art. 17 KV-slot eviction, and local RTX GPU LoRA training/evaluation harness. |

### 3. Data Architecture: Documents → Resolved Graph → Every Consumer

![Versieve data architecture](docs/verisieve-data-architecture.gif)

The stack runs in four layers. Scattered estate documents (SQL, CSV, email, transcripts, audio, decks) enter the five zero-import WASM kernels with zero egress. Every detected value is vaulted behind a salted placeholder and derives a stable HMAC entity identifier, so one resolved entity graph carries per-sample provenance and conformal certificates. That graph is exported as deterministic corpus seams (per-block JSONL, composed per-entity records, identity-contrastive pairs) in a vaulted or readable view. The same graph then grounds four consumers with no identity rebuilt anywhere: LoRA SFT training, Graph-PPR retrieval (RAG), CAG key-value cache prefill (fixed set-cover or per-question identity-keyed), and `eraseEntity`, which regenerates the corpus minus one entity with a byte-diff receipt because the graph names exactly the spans an entity owns. Positional chunking gives none of these consumers an identity to share, which is why erasure, provenance, and cross-document grounding all ride on the graph.

---

## 📊 Empirical Benchmarks Across All Four Papers

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
  - On `ai4privacy-200k` (`500` records), deterministic regex recalls **`78.6%`** (`110/140`) of contact/card/IPv4 spans, **`62.8%`** (`159/253`) of targeted 8 patterns, **`49.6%`** (`118/238`) of bare person names, and **`31.0%`** (`180/580`) across the 26 structured tags evaluated out of the dataset's 56 span categories.
  - On blind `PubMedQA` test abstracts (`250` docs, `63,739` words), the pre-committed `334`-word clinical/technical exclusion lexicon reduces Title-Case false positives by **`2.72x`** (`5.46 -> 2.01` hits/1k words; `45.2% -> 26.0%` affected docs).
- **7-Trial Interleaved Runtime Substrates (AMD Ryzen 7 7840HS, Windows 11):**
  - **C99 (`include/verisieve.h`)**: `14.12 ms` process spawn | `6.08 MB` RSS | `0.745 ms` warm `1,207×520` logistic.
  - **Node.js + `verisieve_dl.wasm`**: `106.22 ms` spawn (`1.045 ms` WASM init) | `55.97 MB` RSS (**`121.6x` faster spawn, `7.7x` lower RSS** than PyTorch+DuckDB at `12,917.14 ms` / `432.3 MB`).
  - **Python 3.12 + NumPy 2.4.3**: `388.79 ms` spawn | `31.49 MB` RSS | **`0.207 ms` warm `1,207×520` logistic** (NumPy BLAS wins warm batched matrix dot products once imported).

---

### 3. Paper 2: Multimodal Sanitization vs. External Baselines (`TAB`, Presidio, Gitleaks, detect-secrets, Whisper)

Reproduced via `python scripts/run-reviewer-tab-and-ltt.py` and `python scripts/run-reviewer-secrets-audio-pprl.py` (`results/reviewer-tab-and-ltt-benchmarks.json`, `results/reviewer-secrets-audio-pprl-benchmarks.json`):

#### A. Human-Annotated Legal PII: Text Anonymization Benchmark (`TAB`, `127` Held-Out ECHR Rulings)

Table 1 of Paper 2, reproduced. The `All Maskable` block scores `DIRECT+QUASI` (`5,161` spans, `365` DIRECT); the `PERSON` block scores person entities (`958` spans, `226` DIRECT). F1 intervals are `95%` bootstrap.

| Block | System (threshold) | Prec. | Rec. | F1 | DIRECT recall |
|---|---|---:|---:|---:|---:|
| All Maskable | Stage 3A WASM only | `61.35%` | `37.65%` | `46.66%` | `56.71%` |
| All Maskable | Stage 3A + ECHR code regex | `64.41%` | `43.13%` | `51.67%` | `93.70%` |
| All Maskable | Vanilla GLiNER-Edge (`τ=0.30`) | `35.15%` | `50.61%` | `41.49%` | `94.25%` |
| All Maskable | Dev-Filtered GLiNER (`τ=0.30`) | `40.14%` | `49.23%` | `44.23%` | `94.25%` |
| All Maskable | Hybrid (3A + code + Dev-Filt GLiNER) | `41.29%` | `51.70%` | `45.91%` | **`100.00%`** |
| All Maskable | Hybrid + `WASM SR-MP` (`τ=0.30`) | `40.30%` | `51.77%` | `45.32%` | **`100.00%`** |
| All Maskable | Presidio default (`en_core_web_lg`, `401 MB`) | `77.07%` | `75.16%` | `76.10%` | `61.37%` |
| All Maskable | **Presidio + ECHR code** | **`78.17%`** | **`80.39%`** | **`79.26%`** | `98.08%` |
| PERSON | Companion regex + lexicon | `32.84%` | `74.32%` | `45.55%` | `85.40%` |
| PERSON | Vanilla GLiNER-Edge (`τ=0.50`) | `65.39%` | `85.39%` | `74.06%` | `89.82%` |
| PERSON | Dev-Filtered GLiNER (`τ=0.50`) | `65.60%` | `85.39%` | `74.20%` | `89.82%` |
| PERSON | Dumb same-document name propagation | `47.28%` | `86.22%` | `61.07%` | `89.82%` |
| PERSON | **`WASM SR-MP` + GLiNER (`τ=0.50`)** | `62.56%` | **`88.41%`** | `73.27%` | **`91.15%`** |
| PERSON | `WASM SR-MP` + GLiNER (`τ=0.70`) | `91.94%` | `26.20%` | `40.78%` | `45.13%` |
| PERSON | **Presidio `en_core_web_lg`** | **`80.60%`** | **`92.80%`** | **`86.27%`** | **`98.23%`** |

Latency from the same sweep: Stage 3A `0.29 ms/doc`, Presidio `30.67 ms/doc`, GLiNER-Edge `510.74 ms/doc`. Presidio leads overall F1; the edge model plus `SR-MP` is the local-only option and the only one measured under a zero-import runtime split.

#### B. Non-Circular Ground-Truth LTT vs. Document-Clustered `HC-CRC` & Streaming `E-LTT` (`1,999` TAB Paragraphs Across `127` Rulings)

Labels are derived **strictly from human TAB annotations** ($Y_i = 1$ iff human annotators marked $\ge 1$ maskable PII span). Across the `67` unsafe calibration court rulings (`916` unsafe paragraphs), measured intra-cluster correlation is $\mathrm{ICC} = 0.1276$, yielding a **Cluster Design Effect $\mathrm{DEFF} = 2.62$** ($N_{\text{eff}} = 350$). Evaluation uses `1,999` held-out paragraphs (`1,623` unsafe, `376` safe):

| Gate & Calibration Regime ($\delta = 0.05$) | Risk Budget $\alpha$ | Conditional FPR (`1,623` Unsafe) | Certified? | Safe Paragraph Yield (`376` Safe) | Auto-Release Rate |
|---|---:|---:|---|---:|---:|
| **Naive Paragraph-IID Hybrid LTT (ignores $\mathrm{DEFF}=2.62$)** | `10.0%` | `10.10%` | ❌ **Overshoots (`>10%`)** | `67.55%` | `20.91%` |
| **Document-Clustered `HC-CRC` (`src/gatekeeper.js`)** | `1.0%` | **`0.18%`** | ✅ **`<= 1.0%`** | `32.98%` | `6.35%` |
| **Document-Clustered `HC-CRC` (`src/gatekeeper.js`)** | `2.0%` | **`0.92%`** | ✅ **`<= 2.0%`** | `35.64%` | `7.45%` |
| **Document-Clustered `HC-CRC` (`src/gatekeeper.js`)** | `5.0%` | **`2.53%`** | ✅ **`<= 5.0%`** | `39.89%` | `9.55%` |
| **Document-Clustered `HC-CRC` (`src/gatekeeper.js`)** | `10.0%` | **`8.19%`** | ✅ **`<= 10.0%`** | **`65.16%`** | `18.91%` |
| **Document-Clustered `HC-CRC` (`src/gatekeeper.js`)** | `15.0%` | **`12.57%`** | ✅ **`<= 15.0%`** | `70.48%` | `23.46%` |
| **Document-Clustered `HC-CRC` (`src/gatekeeper.js`)** | `20.0%` | **`15.77%`** | ✅ **`<= 20.0%`** | `72.87%` | `26.51%` |
| **Streaming Ville Martingale `E-LTT` ($E_{\max} = 23.76 \ge 20$)** | `5.0%` | **`0.18%`** | ✅ **Anytime-Valid** | `32.98%` | `6.35%` |
| **Streaming Ville Martingale `E-LTT` ($E_{\max} = 26.84 \ge 20$)** | `10.0%` | **`5.73%`** | ✅ **Anytime-Valid** | `55.85%` | `15.16%` |

`E-LTT` fails closed at `α ≤ 0.02` (`E_max = 1`, zero auto-release). `HC-CRC` is a conservative design-effect adjustment, not a proven finite-sample guarantee; `E-LTT` is the anytime-valid arm.

#### C. Enterprise Secrets (`520` Files: `145` Positive Credentials + `375` Short Clean Python Files, `78.1 KB`)

| Scanner | Recall | F1 | Cold `1x` | Steady `1x` | Throughput |
|---|---:|---:|---:|---:|---:|
| **Yelp `detect-secrets`** | **`75.86%`** | **`86.27%`** | `716.9 ms` | `692.4 ms` | `0.11 MB/s` |
| **Versieve Stage 3A (`verisieve_media.wasm`)** | `56.55%` | `72.25%` | **`131.4 ms`** | **`29.7 ms`** | **`2.51 MB/s`** |
| **Gitleaks `v8.30.1` (Native Go)** | `49.66%` | `66.36%` | `1018.8 ms` | `43.2 ms` | `1.72 MB/s` |

Steady-state marginal latency drops the `7.8x` cold-start advantage to **`1.5x` over Gitleaks** (`2.51` vs. `1.72 MB/s`) and **`22.8x` over Yelp** (`0.11 MB/s`). By F1, Yelp leads; our misses concentrate in generic `JWT_SECRET=` assignments, Gitleaks' in single-line PEM headers (`0/35`). All three hit `0/375` clean FP, but the `MBPP` files are short scripts, so that rate carries little precision evidence for noisy production repos.

#### D. Unicode Evasion, End-to-End Whisper Audio Redaction with `WASM SR-MP`, PPRL Scale & GDPR Erasure

- **Unicode Anti-Evasion (`70` adversarial vectors):** Naive ASCII regex `0.0%` (`0/70`). Python `unicodedata.normalize('NFKC')` catches fullwidth digits (`100%`) but misses zero-width spaces (`29.9%`) and Cyrillic homoglyphs (`0.0%`). **`verisieve_media.wasm`** sustains `94.25%` on zero-width characters and `100.0%` on homoglyphs, with `0/35` decoy false positives.
- **End-to-End Spoken Audio PII Redaction (`25` neural TTS calls, `97` planted PII tokens, cross-model `faster-whisper base.en` redactor vs. `small.en` attacker):** Unredacted audio exposes **`94.85%` (`92/97`)** of planted tokens to `small.en`, and isolated Spoken ITN + GLiNER leaves **`20.62%` (`20/97`, `15/25` zero-leak calls)** exposed due to ASR homophone and word-boundary drift. Enabling **`verisieve_media.wasm` `SR-MP` phonetic anchor coupling** with `60 ms` padding and `5 ms` cosine fade cuts residual exposure to **`8.25%` (`8/97`, Wilson 95% CI `[4.24%, 15.44%]`)**, an **`-86.60 pp` absolute drop** and **`91.30%` relative reduction of exposed tokens** (`84/92` eliminated), with **`21/25` calls (`84%`) at zero residual leak** and **`100.0%` of the `59` pre-declared non-PII context words** retained under the attacker transcription. A plain Jaro-Winkler baseline on the same anchors reaches `7.22%` leakage, so the ring's measured contribution here is salted anchor privacy.
- **128-Bit Salted Bloom+Soundex PPRL (`vs_media_pprl_signature`):** On `40` held-out noisy pairs, zero-import salted Bloom+Soundex PPRL matches plaintext Jaro-Winkler at **`83.33%` F1** (`71.4%` precision, `100%` recall) and sits near plaintext Levenshtein (`85.11%` F1) without storing plaintext. On all `124,750` pairs from `500` common names, `τ=0.60` gives `4.88%` false links; tightening to `τ=0.75` gives **`0.270%`**, `3.7x` fewer than plaintext Jaro-Winkler (`1.007%`). The filter is a local-only noisy erasure index, not an external export format.
- **GDPR Art. 17 Erasure & $O(1)$ MP4 Scrubbing:** Cross-modal `blast_radius` and streaming MP4 atom scrubbing are implemented as construction properties in this paper; the measured byte-diff erasure receipt is in Paper 4.

---

### 4. Paper 3: Local Open-Weight Model Training (`PT-LM` LoRA) vs. Dual-CSR Graph-PPR & Native CAG (8 GB RTX 4070)

Evaluated across `Qwen2.5-0.5B-Instruct`, `Qwen2.5-1.5B-Instruct`, and `LFM3-1.7B-Base` (matched Raw vs. Versieve-Safe vs. **`PT-LM` Privacy-Token Loss Masking** assistant-only `T2-Chat` LoRA adapters, graded by both blinded `qwen2.5:7b` and cross-family `llama3.2:3b` judges) plus `lfm3:latest`, `llama3.2:3b`, and `qwen2.5:7b` (`results/track-d-ptlm-ablation.json`):

| Model (VRAM) | Carlini $20\times$ Canary Exposure: Raw $\rightarrow$ Safe $\rightarrow$ **`PT-LM`** | Seen-Doc `<PII>` Tag Echo: Safe $\rightarrow$ **`PT-LM`** | Held-Out False Refusal: Safe $\rightarrow$ **`PT-LM`** | Seen-Doc Token F1: Safe $\rightarrow$ **`PT-LM`** | Held-Out In-Scope Judge: Safe $\rightarrow$ **`PT-LM`** $\rightarrow$ **`T0+Graph-PPR`** | Held-Out All Judge (`Qwen` / `Llama`): **`T0+Graph-PPR`** |
|---|---|---|---|---|---|---|
| **`Qwen2.5-0.5B-Instruct`** (`2.06–2.29 GB`) | `8.25` $\rightarrow$ `3.32` $\rightarrow$ **`3.18 bits`** (`1/12` R1) | `85.0%` $\rightarrow$ **`0.0%`** | `30.0%` $\rightarrow$ **`0.0%`** | `0.077` $\rightarrow$ **`0.271` (`+0.194`, $p=0.0005$)** | `6.2%` $\rightarrow$ **`16.2%`** $\rightarrow$ **`46.2%`** | **`55.0%` / `59.0%`** |
| **`Qwen2.5-1.5B-Instruct`** (`4.15–4.41 GB`) | `8.40` $\rightarrow$ `2.70` $\rightarrow$ **`2.63 bits`** (**`0/12` R1**) | `65.0%` $\rightarrow$ **`0.0%`** | `47.5%` $\rightarrow$ **`0.0%`** | `0.103` $\rightarrow$ **`0.190` (`+0.087`, $p=0.001$)** | `18.8%` $\rightarrow$ **`36.2%`** $\rightarrow$ **`61.2%`** | **`69.0%` / `62.0%`** |
| **`LFM3-1.7B-Base`** (`4.31–4.55 GB`) | `8.25` $\rightarrow$ **`2.81`** $\rightarrow$ `3.51 bits` (`2/12` R1) | `40.0%` $\rightarrow$ **`0.0%`** | `20.0%` $\rightarrow$ **`0.0%`** | `0.083` $\rightarrow$ **`0.200` (`+0.117`, $p=0.083$, not significant)** | `17.5%` $\rightarrow$ **`25.0%`** $\rightarrow$ **`52.5%`** | **`62.0%` / `58.0%`** |

The `LFM3-1.7B` rank-1 result is `2/12` against its base's `1/12`, a one-question difference. The `PT-LM` comparison changes backward loss masking and forward-surrogate substitution together; a masking-only ablation is not run.

- **Adversarial Context Extraction & Utility Cost (`qwen2.5:7b`):** Pre-processing redaction cuts verbatim secret leakage under adversarial extraction prompts from **`11/12` (`100%` of probes) to `0/12` (`0.0%`)** while matching unredacted compliance QA accuracy at **`75.0%` (`9/12` each, $\Delta = 0.0\%$)**.
- **Retrieval is the stronger default at this scale:** zero-training Graph-PPR beats every closed-book LoRA arm, including `PT-LM`, on held-out compliance QA across both blinded judges (`p=0.0005` on F1), at lower latency. `PT-LM`'s niche is weight-held redacted fine-tuning for offline or re-indexing-free deployment.
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
│   ├── verisieve-media/              # #![no_std] Rust crate -> verisieve_media.wasm (204.0 KB, 29 exports, 0 imports)
│   ├── verisieve-graph/              # #![no_std] Rust crate -> verisieve_graph.wasm (54.4 KB, 0 imports)
│   ├── verisieve-dl/                 # #![no_std] Rust crate -> verisieve_dl.wasm (60.1 KB, 0 imports)
│   └── verisieve-sql/                # #![no_std] Rust crate -> verisieve_sql.wasm (55.6 KB, 0 imports)
├── vendor/
│   ├── wasm/                         # Compiled zero-import WebAssembly binaries shared with RTIO
│   └── cactus/                       # Isolated cactus.wasm pure-memory 2D-tiled OCR runtime
├── src/
│   ├── perceive.js                   # One-shot omnimodal perception, WASM SR-MP, PT-LM SFT & sceneTimeline
│   ├── clean-wasm.js                 # JS/Node loader for verisieve_clean.wasm
│   ├── media-wasm.js                 # JS/Node loader for verisieve_media.wasm (29 exports incl. SR-MP ring)
│   ├── graph-wasm.js                 # Dual-CSR graph kernel, HippoRAG-2 PPR, SaltedPseudonymVault, Bloom PPRL
│   ├── enterprise-parsers.js         # Deep parsers (.eml, .msg, .pptx, .xlsx, .vtt, .har, .ipynb, .ics, Slack)
│   ├── secret-scanner.js             # Stage 3A+3B PII, checksums, 30+ secrets, and surname coreference
│   ├── neural-pii-onnx.js            # Fail-closed local ONNX GLiNER sliding-window span extractor
│   ├── audio-redactor.js             # Spoken ITN, WAV silence/beep/noise redaction, phrase/segment dedup
│   ├── video-redactor.js             # O(1) MP4 stream audit/scrub, 1080p keyframe OCR gate, temporal box blur
│   ├── pdf-parser.js                 # Pure-JS PDF /FlateDecode, /ObjStm, scoped /ToUnicode CMap, TJ kerning
│   ├── gatekeeper.js                 # 520-dim logistic scorer + LTT, Cluster-Robust HC-CRC & Streaming E-LTT
│   ├── cag-dossier.js                # KV-cached Native CAG serializer + GDPR Art. 17 KV-slot eviction
│   └── mcp-server.js                 # 18-tool JSON-RPC Model Context Protocol server
├── scripts/                          # Reproducible benchmark runners (Paper 1, Paper 2, Paper 3, GC-CRC)
├── results/                          # Deterministic JSON benchmark artifacts & SHA-256 receipts
├── paper/                            # Four MLSys-format LaTeX papers, .bib files, fig builders, and PDFs
└── test/                             # 108 portable CI tests + scale & multimodal regression suites
```

---

## 🔬 Reproducing the Benchmarks & Test Suites

```bash
# 1. Run the 108-test portable CI suite (WASM zero-import census, parsers, redaction, SR-MP, HC-CRC, PT-LM, MCP)
npm run test:ci

# 2. Reproduce the GC-CRC / SR-MP Cross-Modal Context-Horizon benchmark (60 cases, 240 blocks)
node scripts/eval-gccrc-benchmark.mjs

# 3. Reproduce Paper 1 public benchmark suite (downloads FUNSD, ai4privacy, PubMedQA once)
node scripts/fetch-public-benchmarks.mjs
npm run bench:scale

# 4. Reproduce Paper 2 external baseline benchmarks (TAB, HC-CRC, E-LTT, Presidio, Gitleaks, Whisper SR-MP, PPRL)
python scripts/run-reviewer-tab-and-ltt.py
python scripts/run-reviewer-secrets-audio-pprl.py
python paper/figs/build_track_e_figures.py

# 5. Reproduce Paper 3 three-model RTX 4070 PT-LM LoRA training & dual-judge evaluation
python scripts/run-track-d-fair-lora.py
python paper/figs/build_track_d_results_fig.py

# 6. Rebuild the four README architecture animations
python paper/figs/build_k7_architecture.py
python paper/figs/build_readme_architectures.py
```

For security policies and zero-egress threat boundaries, see [SECURITY.md](SECURITY.md).
