# Local-First Multimodal Sanitization, Conformal Release Control, and Verifiable Corpus Erasure: A Primary-Source Landscape Verification, Adversarial Prior-Art Audit, and Theoretical Novelty Frontier for Versieve

**Date:** 2026-11-26  
**Project:** Versieve (`gegearsyah/versieve`)  
**Review Form Note:** Conducted in `deep-research` `full` mode using a structured scoping-breadth mapping across six competitive/academic lanes. *(Note: ARS has no separate dedicated mode for a scoping review; PRISMA-ScR protocol and reporting checklist governance stay with the author.)*

---

## Abstract

This report presents a primary-source competitive landscape verification, adversarial prior-art audit, and theoretical white-space analysis grounded in Versieve's preliminary backlog (`docs/versieve-landscape-and-research-backlog.md`), four internal benchmark manuscripts, and open experiment handoff (`docs/2026-11-25-experiment-gap-handoff.md`). Across five structured search batches covering peer-reviewed venues (IEEE S&P, ICML, ICLR, NeurIPS, IEEE SaTML, COLM, Annals of Statistics), arXiv preprints (2018–November 2026), and primary open-source repositories, we verified 38 cited tools and papers, uncovered 15 high-relevance competitors and prior-art papers missing from the initial backlog (including the previously unsearched audio redaction and biometric voice-anonymization lanes), and rejected five unverified snippet-inherited tool citations under a strict primary-source verification rule. Three findings reshape Versieve's positioning. First, direct prior art exists for privacy-oriented token loss masking in fine-tuning (`SLUNG`, `RMFT`, `Surprise Masking`, `Goldfish Loss`, `RHO-1`) and type-consistent local surrogate substitution (`Anonymous-by-Construction`), requiring immediate narrowing of `PT-LM` claims pending a masking-only ablation. Second, Versieve's strongest defensible wedge lies at the intersection of deterministic entity-indexed corpus erasure with byte-diff receipts (`Amnesiac Corpus`, independently reinforced by ICML 2025 evidence that parameter-level unlearning is reversible), load-time zero-import WASM capability audits, and finite-sample conformal release gating. Third, cross-disciplinary synthesis identifies six unwritten theoretical mechanisms—spanning adversary-closed e-value release gates, graph-topology-aware conformal risk control with structural $k$-anonymity, Merkle-DAG verifiable amnesia, counterfactual surrogate-invariant LoRA loss, hermetic capability-carrying execution receipts, and joint lexical-biometric multimodal de-identification—that define a novel post-backlog research agenda.

**Keywords:** local-first PII redaction, WebAssembly zero egress, conformal risk control, e-values, verifiable machine unlearning, privacy-preserving fine-tuning, hidden-channel document forensics

---

## 1. Introduction

Organizations attempting to fine-tune or ground language models on internal unstructured data estates—spanning PDFs, Office documents, emails, slide decks, audio recordings, and screen-recorded video—face a structural tension between data utility, regulatory exposure (e.g., GDPR Article 17 right to erasure and EDPB Opinion 28/2024's zero-likelihood anonymity standard), and perimeter security. Versieve (`gegearsyah/versieve`) proposes a unified local-first stack combining five zero-import `#![no_std]` Rust-to-WebAssembly kernels, cross-modal entity resolution (`GC-CRC` / `SR-MP`), finite-sample conformal gating (`LTT` / `HC-CRC` / `E-LTT`), privacy-token loss masking (`PT-LM`), and deterministic entity-indexed corpora with byte-diff erasure receipts (`Amnesiac Corpus`).

An initial competitive scan (`docs/versieve-landscape-and-research-backlog.md`, 2026-11-25) assembled candidate competitors, arXiv neighbours, and a P0–P3 backlog from short search snippets while leaving several items unverified (`†`) and leaving the audio redaction lane unsearched. Relying on unverified snippets creates two acute risks: (a) overstating novelty where direct academic or engineering prior art already exists, and (b) misallocating engineering cycles across P1 experiments and P2 product features.

### 1.1 Research Questions

**Primary Research Question:** To what extent do Versieve's six claimed technical differentiators and its prioritized research/feature backlog (P0–P3) hold up against primary-source verification of current local-first PII/media sanitization tools, training-data curation pipelines, and peer-reviewed/preprint literature (2020–2026), and what unwritten theoretical mechanisms lie beyond the current competitive and academic frontier?

**Sub-Questions** *(all inherit full Domain, Timeframe [2020–Nov 2026 plus foundational works], Geography [global English-language corpus], and Population [local PII/media sanitization tools, training-data pipelines, and conformal/unlearning/privacy papers] boundaries)*:

- **SQ1 (Adversarial Prior-Art Audit):** Which of Versieve's six claimed differentiators survive falsifying prior-art searches across peer-reviewed venues, arXiv, and open-source repositories?
- **SQ2 (Competitor & Neighbour Verification):** What are the primary-source verified capabilities, architectures, licenses, and evaluation protocols across all six lanes—including newly verified `†` items, audio redaction, and rejected/unverified entries?
- **SQ3 (Backlog Prioritization & Claim Calibration):** Which P0 consistency fixes, P1 decisive experiments, and P2 borrowed capabilities maximize falsifiable evidence and product wedge strength, and which claims must be retired or qualified?
- **SQ4 (Unwritten Theoretical Novelty Frontier):** What theoretical mechanisms—not yet written down in Versieve's papers or existing literature—emerge at the unresolved intersections of capability-bounded execution, conformal/e-value risk control, cryptographic provenance/erasure, and privacy-preserving representation learning?

---

## 2. Methodology

### 2.1 Paradigm and Verification Protocol

This investigation uses a pragmatist comparative-audit design combining structured academic evidence synthesis with primary-source software artifact verification. No human subjects were involved.

1. **Primary-Source Verification Rule (Gray Zone = FAIL):** Every arXiv identifier, publication title, repository name, and benchmark metric inherited from the 2026-11-25 backlog was independently checked against primary sources (arXiv abstracts, peer-reviewed venue listings, GitHub repositories, and official vendor documentation). Any item whose existence or claimed attributes could not be confirmed from a primary source is explicitly marked **UNVERIFIED / FAIL** and excluded from verified claims.
2. **Adversarial Counter-Evidence Search:** To counter confirmation bias (Devil's Advocate Checkpoint 1 Mandate #1), each of Versieve's six differentiators was subjected to targeted falsifying queries (e.g., searching explicitly for token loss masking over PII/redacted spans, conformal risk control over PII/unlearning, zero-import Rust/WASM redactors, and cryptographic/Merkle training-corpus deletion proofs).
3. **Evidence Hierarchy:** Sources were graded discipline-relatively into **Tier 1** (peer-reviewed archival papers: IEEE S&P, ICML, ICLR, NeurIPS, IEEE SaTML, COLM, Annals of Statistics), **Tier 2** (independently verified arXiv preprints and public open-source code repositories), and **Tier 3** (vendor documentation, blog posts, and self-reported benchmarks). Self-reported metrics are explicitly labeled as such and never equated with third-party reproduced evaluations.
4. **Quality Checkpoints:** Three Devil's Advocate checkpoints (CP1 scoping, CP2 synthesis, CP3 final review), an editorial rigor review, and a research-integrity/ethics review governed progression across phases.

### 2.2 Search Strategy Summary

Five structured parallel query batches were executed on 2026-11-26 spanning: (1) all seven arXiv IDs in Sections 2.5–2.6 (`2606.21631`, `2603.17217`, `2608.18260`, `2609.21340`, `2405.01563`, `2602.03787`, `2510.10193`); (2) local/browser PII, video, audio (newly searched), and PDF/Office forensics tools; (3) detection baselines, training pipelines, and all Section 2.7 `†` items (`synthetic-data-kit`, `Easy Dataset`, `Docling`, `Unstructured`, `GraphGen`, `presidio-image-redactor`, `SISA`, `TOFU`, `Sigstore Rekor`, `C2PA`); (4) adversarial prior-art sweeps on loss masking, non-exchangeable/hierarchical/e-value conformal prediction, cryptographic verifiable unlearning, LLM attribute-inference attacks, and knowledge-graph re-identification; and (5) exact bibliographic confirmation of newly discovered Tier 1/2 papers (`arXiv:2610.22988`, `arXiv:2512.03310`, `arXiv:2505.03052`, `arXiv:2602.04364`, `arXiv:2607.24562`, `arXiv:2503.13050`, `arXiv:2410.12418`, `arXiv:2505.16831`, `arXiv:2506.20037`, `arXiv:2210.09126`).

---

## 3. Findings

### 3.1 SQ1 — Adversarial Prior-Art Audit of Versieve's Six Differentiators

| # | Versieve Claimed Differentiator | Closest Verified Prior Art | Survival Verdict | Required Claim Calibration |
|---|---|---|---|---|
| 1 | **Load-time `imports.length === 0` WASM capability boundary across all kernels** | `censgate/redact` (`redact-wasm`, Rust→WASM); `Redacat` (`mupdf-wasm` true byte-level browser PDF redaction); `screenpipe/opf-rs` (pure-Rust local PII runtime). | **PARTIAL — QUALIFY** | Rust/WASM client-side PII redactors now exist. Versieve's narrower distinction is the CI-audited `imports.length === 0` structural boundary across five multi-domain `#![no_std]` kernels, cleanly separated from fail-closed external weights (`ffmpeg`, `whisper`, `gliner-pii-edge`). Never call it "mathematically certified" whole-pipeline zero egress. |
| 2 | **Finite-sample conformal release gate (`LTT`, `HC-CRC`, `E-LTT`) with abstain-to-human over redaction** | Angelopoulos et al. (2021, LTT); Dunn et al. (2018) & Lee et al. (2023) hierarchical CP; Barber et al. (2023) non-exchangeable CP; Abbasi-Yadkori et al. (2024) conformal abstention; Gauthier et al. (2025) e-values; Wang et al. (2025) SAFER; Hultberg et al. (2026) anytime-valid CRC; Salem et al. (2026) `HG-CRC`; Chowdhury et al. (2026) conformal unlearning; `CPA` (2026, `arXiv:2609.21340`) re-identification auditing. | **SURVIVES (NARROW INTERSECTION)** | No prior work uses LTT/CRC/e-values as a *pre-release PII redaction gate*. However, `HC-CRC` (Kish heuristic) must be compared against guarantee-backed hierarchical baselines (Dunn et al., Lee et al., Salem et al. `HG-CRC`), `E-LTT` must cite Gauthier et al. (2025) and Hultberg et al. (2026), and detector-closed scope must be contrasted against adversary-aware `CPA`. |
| 3 | **Entity-graph corpus with byte-diff erasure receipts (`Amnesiac Corpus`)** | Bourtoule et al. (2021, SISA); Maini et al. (2024, TOFU); Eisenhofer et al. (2022, SNARK+hash-chain verifiable unlearning); Maheri et al. (2025, edge zk-SNARK unlearning); Xu et al. (2025, ICML, proving parameter unlearning is reversible); `CuratorKIT` (2026, provenance chains without entity erasure); Sigstore Rekor; C2PA. | **STRONGEST SURVIVOR** | Xu et al. (2025) strongly validates Versieve's exact corpus-regeneration + fresh-LoRA-retrain thesis over parameter-level unlearning. Cite Eisenhofer et al. (2022) and Maheri et al. (2025) explicitly; position Versieve as lightweight deterministic corpus-side exact regeneration with byte-diff receipts rather than claiming "first verifiable erasure." |
| 4 | **One-call (`perceiveMulti`) over mixed formats with shared entity graph** | IBM `Docling` (multi-format air-gapped parser); `Unstructured.io`; NVIDIA `NeMo Curator` (multi-modal curation at scale); `GraphGen` (KG-guided synthetic SFT). | **SURVIVES AS PRODUCT WEDGE** | No verified competitor combines heterogeneous parsing, cross-modal entity resolution (`SR-MP`), redaction gating, Dual-CSR graph, and training export in one zero-egress call. Acknowledge raw media detection lags dedicated GPU pipelines (`OpenScrub`, `SentryBlur`, `VoiceShield`). |
| 5 | **`PT-LM` (loss-mask placeholder spans + surrogate forward context)** | **FIVE DIRECT NEIGHBOURS FOUND:** `RHO-1` (Lin et al., 2024); `Goldfish Loss` (Hans et al., 2024); `SLUNG` (Wang et al., 2025, `arXiv:2505.03052`); `RMFT` (Joshi et al., 2025, `arXiv:2512.03310`); `Surprise Masking` (Tyagi et al., OpenAI, 2026, `arXiv:2610.22988`); plus `Anonymous-by-Construction` (Albanese et al., 2026, `arXiv:2603.17217`). | **CONTESTED — NARROW IMMEDIATELY** | Token-level loss masking for privacy/high-risk spans (`SLUNG`, `RMFT`, `Surprise Masking`, `Goldfish`) and local type-consistent surrogate substitution (`Anonymous-by-Construction`) both have clear prior art. Versieve's narrower claim—mitigating *placeholder-token gradient domination* (tag-echo and false refusal) on small `0.5B–1.7B` LoRA models via bundled `-100` masking + grammatical-role surrogates—cannot claim mechanism novelty until the masking-only vs. surrogate-only vs. bundle ablation is completed and all six papers are cited. |
| 6 | **Publishing negative results & CI-verified paper numbers** | Rare across commercial/OSS privacy tools (most publish unverified self-reported scores). | **SURVIVES (CREDIBILITY MOAT)** | Keep and expand (especially adding the missing E2E leak column in README and grounding all claims to CI-checked artifacts). |

---

### 3.2 SQ2 — Primary-Source Verified Landscape Across Six Lanes

#### Lane 2.1: Local & In-Browser Text/Image/PDF PII Sanitization

| Tool / Project | Verification & Tier | Verified Architecture & Capabilities | Strategic Gap / Action for Versieve |
|---|---|---|---|
| **Screenpipe (`screenleak`, `opf-rs`)** | Verified (Tier 2/3) | Multi-modal `screenleak` benchmark (OCR, terminal, UI screenshots; zero-leak rate metric vs. Presidio/cloud LLMs); `opf-rs` pure-Rust local runtime for PII-filtering models without Python. Leaderboard numbers remain self-reported. | Run Versieve on `screenleak` (text + image); add pluggable Stage 3B detector adapter so ONNX image/text models slot underneath `HC-CRC`; publish IoU-based image-region metrics. |
| **Censgate Redact (`censgate/redact`, `redact-wasm`)** *(NEW)* | Verified (Tier 2) | Rust PII & secrets engine with WASM (`redact-wasm`), CLI, Postgres scanner, and OpenAI-compatible gateway; masks, replaces, hashes, or encrypts text/code/configs/JSON. | Direct parity benchmark for Rust/WASM footprint, throughput, and secret/PII rule coverage. |
| **Redacat (`mupdf-wasm`)** *(NEW)* | Verified (Tier 2) | Browser-based true PDF & image redactor compiled from MuPDF to WASM (`mupdf.js`); deletes underlying PDF text, images, and line-art from raw byte streams (no pseudo-redaction overlays) and strips image EXIF/GPS. | Gold-standard browser reference for irreversible byte-stream PDF redaction; directly motivates Versieve's PDF irreversibility re-extraction test. |
| **PrivacyScrubber** | Verified (Tier 2/3) | Zero-trust Chrome extension (Manifest V3) running locally in browser RAM with regex/local NER and Tesseract.js OCR; swaps PII for surrogate tokens (`[NAME_1]`) with one-click reverse-scrub restoration. | Packaging distribution form (extension) + explicit FP-rate reporting + reversible vault parity. |
| **umbryn-mcp (formerly `phi-redact-mcp`, Rinava)** | Verified (Tier 2) | Self-hosted, fail-closed, HIPAA-aware MCP server exposing `redact`, `restore`, and `detect` tools prior to LLM context ingestion. | Add complete HIPAA Safe Harbor identifier validators (NPI, DEA, MBI, MRN, CLIA), optional vault `restore()`, property-based round-trip tests, and explicit fail-closed-on-error MCP tests. |
| **OpenRedaction (`sam247/openredaction`)** *(NEW)* | Verified (Tier 2) | Open-source JS/TS regex-first local PII scrubber for logs and LLM prompts. | Lightweight JS parity reference for developer ergonomics ("ease benchmark"). |
| **Cloak (BERT/Tesseract browser app)** | **UNVERIFIED / FAIL** | Primary search returned `CloakBrowser` (an unrelated C++-patched stealth Chromium fork for anti-bot scraping). No primary repo confirmed for the described BERT+brush PII web app. | **Drop citation** from external docs until primary URL is supplied; keep the *UX pattern* (manual brush + custom regex human-correction loop) on its own merits. |
| **OSpipe (11.8–350 KB WASM gate)** | **UNVERIFIED / FAIL** | Exact repository and footprint numbers could not be independently confirmed from primary sources. | **Drop citation**; replace with verified `censgate/redact` and publish Versieve's own per-kernel footprint table mapped to `allow`/`redact`/`deny`. |

#### Lane 2.2: Video and Audio Redaction (Including Previously Unsearched Audio Lane)

| Tool / Project | Verification & Tier | Verified Architecture & Capabilities | Strategic Gap / Action for Versieve |
|---|---|---|---|
| **OpenScrub (`austinmabry/OpenScrub`)** | Verified (Tier 2) | Local GPU-accelerated (CUDA, QuickSync/OpenVINO) video/screen redactor: faces, whole-person silhouettes, license plates, on-screen OCR PII + custom regex, tracking, and human review before render. | Do not compete on raw GPU video detection; add temporal box-tracker dropout tests and per-track review in RTIO sandbox, or explicitly scope out raw visual detection. |
| **SentryBlur (`ssrajadh/sentrysearch`)** | Verified (Tier 2) | CLI video redactor (`sentryblur faces`, `sentryblur plates`, custom text prompts on NVIDIA/Apple Silicon) embedded in semantic video search toolkit. | Reference for prompt-driven video masking; keep Versieve focused on container scrubbing (`O(1)` MP4 atoms) + keyframe OCR + pluggable visual detectors. |
| **VideoRedactionAPP (`topworld87/VideoRedactionAPP`)** | Verified (Tier 2) | Windows desktop permanent video redaction tool with auto-box review, manual draw/toggle, and local batch processing. | Reference UX only. |
| **VoiceShield (`SepidehNorouziMotlagh/VoiceShield`)** *(NEW — Audio Lane)* | Verified (Tier 2) | Local English speech PII redactor combining `faster-whisper` word-level timestamps, Microsoft Presidio/spaCy NER, audio muting/beeping, and human-in-the-loop transcript review. | Closest direct local audio competitor to Versieve's `audio-redactor.js`. Highlights need for HITL transcript correction and noisy-telephony audio benchmarks (beyond clean TTS). |
| **PII_Detection_and_Redaction_audio_Project** *(NEW — Audio Lane)* | Verified (Tier 2) | Local Whisper + DeBERTa/Mistral NER pipeline dropping sensitive segments from both transcripts and audio waveforms. | Confirms local ASR+NER audio scrubbing is becoming standard DIY plumbing; reinforces Versieve's cross-modal `SR-MP` anchor coupling as the real differentiator. |
| **VoicePrivacy Challenge 2024 / `IDMap` / `VoicePAT`** *(NEW — Audio Biometric Lane)* | Verified (Tier 1/2) | Standard research benchmarks and toolkits (SpeechBrain/ESPnet, McAdams coefficient, STTTS, neural audio codecs) for **biometric speaker anonymization** (masking voiceprint identity while preserving linguistic content). | **Major blind spot revealed:** Textual audio redaction mutes spoken PII names while leaving the speaker's biometric voiceprint identifiable. Opens Theoretical Mechanism #6 (joint lexical + deterministic McAdams biometric warping in `versieve_media.wasm`). |
| **open-redactor (`redact_media`/`audit_media`)** | **UNVERIFIED / FAIL** | Exact repository and MCP tool names could not be independently confirmed from primary sources. | **Drop citation**; retain the *engineering pattern* (shadow audit re-running detectors on redacted output + per-run leakage report alongside SHA-256 receipt) as a first-class Versieve design requirement. |

#### Lane 2.3: Office, PDF, and Hidden-Channel Document Forensics

| Tool / Project | Verification & Tier | Verified Architecture & Capabilities | Strategic Gap / Action for Versieve |
|---|---|---|---|
| **unmasker (`osint-shifu/unmasker`)** | Verified (Tier 2) | Local read-only forensic inspector with **27 detectors** for hidden, residual, and failed-redaction content (covered PDF text, cropped assets, metadata); emits `--json`, `--md`, `--html`. | Run Versieve head-to-head against `unmasker`'s specimen corpus; close gaps on failed-redaction detection (text under opaque black bars), PDF incremental update revisions, and recursive nested attachments. |
| **wppoland/hidden-text-detector** *(NEW)* | Verified (Tier 2) | Detects invisible PDF/DOCX manipulation (white-on-white text, tiny sub-legible fonts, off-page coordinates, PDF text rendering mode 3, invisible Unicode tag characters used for LLM prompt injection). | Add rendering-mode-3, white-on-white, and off-page coordinate checks into Versieve's forensic hidden-channel audit. |
| **MAT2 (Metadata Anonymisation Toolkit 2)** *(NEW)* | Verified (Tier 2) | Open-source metadata scrubber trusted in Tails and Qubes OS across images, documents, audio, and video. | Benchmark Versieve's `versieve sanitize <file>` metadata stripping and before/after diff report against MAT2. |
| **Dangerzone (`dangerzone.rocks`)** *(NEW)* | Verified (Tier 2) | Containerized (gVisor) "print-and-rescan" PDF/Office sanitizer converting untrusted docs to raw RGB pixels and reconstructing inert PDFs. | Structural gold standard for irreversibility; informs Versieve's irreversibility assertion test (re-extracting text from redacted PDFs must yield zero residual leaked spans). |
| **GroupDocs.Redaction** | Verified (Tier 3) | Commercial .NET/Java/Python SDK covering 30+ formats (PDF, Word, Excel, PowerPoint, raster images) with metadata, annotation, comment, and column-scoped redaction. | Publish a transparent Versieve format-coverage matrix; treat hidden-channel extraction as baseline expectation. |
| **ALDS (Win32 C++ metadata tool)** | **UNVERIFIED / FAIL** | Exact repository could not be independently confirmed from primary sources. | **Drop citation**; replace parity reference with verified `MAT2` and `Dangerzone`. |

#### Lane 2.4: Detection & Secret-Scanning Baselines

| Tool / Project | Verification & Tier | Verified Capabilities & Position | Action for Versieve |
|---|---|---|---|
| **Microsoft Presidio + `presidio-image-redactor`** *(† Verified)* | Verified (Tier 2) | Extensible Python PII framework (regex, checksums, spaCy NER, pluggable GLiNER recognizers); `presidio-image-redactor` adds Tesseract OCR image and medical DICOM redaction. | Stop competing on raw F1; integrate Presidio as a pluggable Stage 3B detector behind Versieve's `HC-CRC` conformal gate (P1-2) and run the missing Paper A external baseline on `ai4privacy-200k`. |
| **GLiNER / `gliner-pii-edge` / NVIDIA-Gretel GLiNER-PII** | Verified (Tier 2) | Bidirectional encoder zero-shot NER with PII/PHI fine-tuned variants and INT8 ONNX edge builds. | Benchmark larger/fine-tuned GLiNER-PII variants behind `HC-CRC`; verify whether `echr_dev` `NO_MASK` filter generalizes beyond ECHR. |
| **BigCode PII (`StarPII`)** | Verified (Tier 1/2) | StarEncoder token-classification model trained on BigCode's annotated code PII dataset (names, emails, API/SSH keys, passwords, IPs, usernames). | Evaluate Versieve's secret scanner on BigCode PII / real repositories (subject to dataset license) rather than short MBPP scripts. |
| **Gitleaks & Yelp `detect-secrets`** | Verified (Tier 2) | Mature regex/entropy secret scanners (Go binary / extensible Python plugins). | Add generic assignment (`JWT_SECRET=`, `API_KEY=`) + entropy heuristics and PEM-header handling; check licenses before importing rule patterns. |

#### Lane 2.5: Training-Data Curation & Synthetic Pipelines (Including Verified `†` Items)

| Tool / Project | Verification & Tier | Verified Capabilities & Position | Action for Versieve |
|---|---|---|---|
| **NVIDIA NeMo Curator** | Verified (Tier 2) | GPU-accelerated multi-modal curation (text, image, video, audio) integrating GLiNER-PII and Nemotron-PII at web/enterprise scale. | Do not compete on cluster-scale curation; add NeMo-compatible JSONL export and test Versieve throughput at $10^5$–$10^6$ docs. |
| **CuratorKIT (`arXiv:2606.21631`, Bhattacharjee et al., 2026)** | Verified (Tier 2) | 6 format readers, PII/credential/toxicity hygiene, 8 LiteLLM synthetic tasks, 3 quality gates with provenance-exact hallucination checks, **append-only per-sample provenance chain with structured rejection reasons**, **adaptive diagnose-and-repair recovery**, and TRL/Unsloth/AlignTune exporters. | Adopt structured **gate rejection-reason codes** and **recoverability metadata** (e.g., `RECOVERABLE_VIA_HUMAN_REVIEW` vs. `HARD_DROP_UNPARSABLE`) plus aligned manifest schemas. |
| **3DCF/doc2dataset + NumGuard** | Verified (Tier 2/3) | Rust document-to-dataset pipeline featuring **NumGuard** (SHA-1 hashing of numeric cells/tokens tracked end-to-end to guarantee 100% detection of numeric corruption) + LLaMA Factory / Axolotl / OpenAI JSONL export. | Adopt lightweight **pre/post-redaction numeric integrity hashing** inside `perceiveMulti` (catches over-masking damage on financial/legal figures) and add LLaMA-Factory/Unsloth/Oumi/NeMo exporters. |
| **AfterImage (`altaidevorg/afterimage`)** | Verified (Tier 2) | Multi-agent Python framework generating document-grounded synthetic SFT, tool-calling, and DPO datasets with quality gates. | Add optional local-LLM document-grounded QA view over Versieve's resolved entity records to directly address Paper 4's weak 11.7% trained exact match. |
| **Meta `synthetic-data-kit`** *(† Verified)* | Verified (Tier 2) | 4-stage CLI (Ingest/LanceDB → Create QA/CoT → Curate via Llama-as-judge → Save-as Alpaca/ChatML/JSONL). | Export format parity (ChatML / Alpaca / ShareGPT JSONL) without cloud egress. |
| **Easy Dataset (`ConardLi/easy-dataset`)** *(† Verified)* | Verified (Tier 2) | GUI-driven unstructured-doc-to-SFT/RAG dataset builder with persona-driven QA generation and human-in-the-loop visual editing. | UX benchmark for human-in-the-loop review in RTIO sandbox. |
| **GraphGen (`open-sciencelab/GraphGen`)** *(† Verified)* | Verified (Tier 2) | Builds fine-grained KGs from source texts, uses expected calibration error (ECE) to target LLM knowledge gaps, and samples multi-hop neighborhoods into LLaMA-Factory SFT pairs. | Clearly distinguish in Paper 4: GraphGen generates *new synthetic QA* from a KG without redaction certification or erasure; Versieve grounds *actual vaulted source bytes* in resolved identity with byte-diff erasure receipts. |
| **IBM Docling & Unstructured.io** *(† Verified)* | Verified (Tier 2) | Docling (MIT/LFAI): multi-format parser with explicit air-gapped model prefetching (`docling-tools models download`, `artifacts_path`). Unstructured.io: 50+ formats, OSS + air-gapped K8s enterprise tier. | Cite Docling's explicit weight-prefetch pattern when clarifying Versieve's "zero egress" definition (no user bytes leave; optional local weights fetched once and cached offline). |
| **mask-llm** | **UNVERIFIED / FAIL** | No single canonical repository verified matching the exact backlog description. | **Drop citation**; replace with verified `Redakto` (`arXiv:2608.18260`) and `PrivacyScrubber`. |

#### Lane 2.6: Academic Research Neighbours (All 7 Backlog arXiv IDs Verified + 11 Newly Discovered Tier 1/2 Papers)

1. **Privacy-Preserving Fine-Tuning & Anonymization:**
   - **Albanese et al. (2026, `arXiv:2603.17217`, *Anonymous-by-Construction*):** On-prem LLM type-consistent surrogate substitution evaluated on privacy + utility + BERT+LoRA trainability, beating Presidio/DLP/NER. *Action:* Benchmark Versieve's `PT-LM` head-to-head against type-consistent surrogate substitution under one LoRA recipe and adopt the privacy-utility-trainability frontier plot.
   - **Redakto (2026, `arXiv:2608.18260`, *The Incognito Tab for LLMs*):** Local PII redaction + pseudonymization with web app, REST API, and **MCP hooks**. *Action:* Direct MCP/pseudonymization comparator; motivates optional reversible pseudonymization mode.
   - **Lukas et al. (2023, IEEE S&P, `arXiv:2302.00539`)** & **Staab et al. (2024, ICLR, `arXiv:2310.07298`, *Beyond Memorization*):** Prove imperfect scrubbing leaks PII and frontier LLMs infer private attributes (85% top-1) from scrubbed text despite anonymization. *Action:* Foundational motivation for moving beyond detector-closed certificates.
   - **Loss-Masking Prior Art (Newly Discovered):** **Lin et al. (2024, `arXiv:2404.07965`, RHO-1)**, **Hans et al. (2024, `arXiv:2406.10209`, Goldfish Loss)**, **Wang et al. (2025, `arXiv:2505.03052`, SLUNG)**, **Joshi et al. (2025, `arXiv:2512.03310`, RMFT)**, and **Tyagi et al. (2026, `arXiv:2610.22988`, Surprise Masking)**. *Action:* Mandatory citations in Paper 3; run masking-only vs. surrogate-only vs. `PT-LM` ablation.
2. **Conformal Risk Control, E-Values & Privacy Auditing:**
   - **Foundations:** **Angelopoulos et al. (2021, `arXiv:2110.01052`, LTT)**; **Dunn et al. (2018, `arXiv:1809.07441`)** & **Lee et al. (2023, `arXiv:2306.06342`)** (hierarchical CP); **Barber et al. (2023, Annals of Statistics, `arXiv:2202.13415`)** (beyond exchangeability).
   - **2024–2026 LLM & Privacy Extensions:** **Abbasi-Yadkori et al. (2024, `arXiv:2405.01563`, Conformal Abstention)**; **Gauthier et al. (2025, `arXiv:2503.13050`, Conformal E-Values)**; **Wang et al. (2025, `arXiv:2510.10193`, SAFER)**; **Chowdhury et al. (2026, `arXiv:2602.03787`, Inference-Time Conformal Unlearning)**; **Hultberg et al. (2026, NeurIPS, `arXiv:2602.04364`, Anytime-Valid CRC)**; **Salem et al. (2026, `arXiv:2607.24562`, HG-CRC)**; and **Conformal Privacy Auditing (`arXiv:2609.21340`, Sep 2026, CPA)**.
3. **Verifiable Unlearning, Graph Anonymization & Provenance Logs:**
   - **Bourtoule et al. (2021, IEEE S&P, SISA)**; **Maini et al. (2024, COLM, TOFU)**; **Eisenhofer et al. (2022, IEEE SaTML, `arXiv:2210.09126`, Verifiable Unlearning)**; **Maheri et al. (2025, `arXiv:2506.20037`, Verifiable Unlearning on Edge)**; **Xu et al. (2025, ICML, `arXiv:2505.16831`, *Unlearning Isn't Deletion*)**; **Chase Anonymisation (`arXiv:2410.12418`, KG privacy against structural re-identification)**; **Sigstore Rekor** & **C2PA** (transparency logs and media provenance).

---

### 3.3 SQ3 — Evidence-Driven Backlog Prioritization & Claim Calibration

Integrating verified prior art with Versieve's four open paper gaps (`docs/2026-11-25-experiment-gap-handoff.md`), we rank backlog items by **falsifiability × wedge leverage**:

1. **Immediate Documentation & Credibility Fixes (P0 — Mandatory Before External Sharing):**
   - Execute all 8 README checklist fixes (surface the missing E2E leak column `[2.36% / 21.47% / 35.19%]`, split out-of-the-box WASM from external weights/`ffmpeg`/`whisper`, define zero-egress in one sentence, remove unverified "no prior artifact" lines, label the `12.9 s / 432 MB` comparator accurately as `PyTorch+DuckDB`, reconcile stale tool/test/vector counts, and disclose `Qwen-1.5B` PT-LM seen F1 vs. base caveat).
   - Remove the five **UNVERIFIED / FAIL** competitor names (`Cloak` PII app, `OSpipe`, `open-redactor`, `ALDS`, `mask-llm`) from internal/external competitive tables and replace them with verified peers (`censgate/redact`, `Redacat`, `MAT2`, `Dangerzone`, `VoiceShield`, `Redakto`, `3DCF/doc2dataset`).
   - Add mandatory prior-art citations (`SLUNG`, `RMFT`, `Surprise Masking`, `Goldfish`, `RHO-1`, `Anonymous-by-Construction`, `HG-CRC`, `Hultberg et al. 2026`, `Gauthier et al. 2025`, `Eisenhofer et al. 2022`, `Xu et al. 2025`, `CPA 2609.21340`).

2. **Highest-Leverage Validation Experiments (P1 — Ranked Tier A vs. Tier B):**
   - **Tier A (Decide Core Claims & Close Paper Review Gaps):**
     - `P1-2` **Gate-over-Best-Detector** (Presidio & larger GLiNER-PII behind `HC-CRC` + Paper A external NER baseline on `ai4privacy-200k` 500 records / 580 spans) — proves Versieve is a certified multiplier, not a weaker detector.
     - `P1-6` **PT-LM Mechanism Ablation** (masking-only vs. surrogate-only vs. bundled `PT-LM` vs. `Anonymous-by-Construction`-style substitution, ≥3 seeds) — mandatory given the five newly verified loss-masking papers.
     - `P1-8` **End-to-End Router on Engine Resolution** (no oracle manifest; closes Paper B DA1 gap and replaces the 81.7% upper bound with a deployment figure) + Paper D **Dunn et al. / Lee et al. / HG-CRC** guarantee-backed hierarchical baseline + `τ=0.70` bootstrap CI.
     - `P1-4` **Attacker-Based CPA Audit** (re-identification risk on released vs. withheld documents using `arXiv:2609.21340` protocol) + `P1-3` **Scanner-Missed Canaries** (bare names, free-form addresses, usernames, employers).
   - **Tier B (Market Wedge & Competitor Ground):**
     - `P1-1` **Stitched-Baseline Shootout** (Presidio + detect-secrets + `unmasker` + plain threshold vs. Versieve gate on held-out TAB).
     - `P1-5` **Competitor Benchmarks** (`screenleak` text+image, `osint-shifu/unmasker` 27-detector specimens).
     - `P1-9` **Ease Benchmark** (install size, runtimes, lines to first output, cold start vs. stitched stack).
     - `P1-7` **Scale Training + Document-Grounded QA View** (full corpus, ≥500 questions, 3 seeds, AfterImage-style QA export).

3. **Highest-Leverage Product Capabilities (P2 — All Anchored at `perceiveMulti` / CLI / MCP Seams):**
   - Pluggable Stage 3B detector adapter interface (`Presidio`, `GLiNER` variants, ONNX image-region detectors).
   - Shadow audit (re-run detectors on redacted outputs) + per-run residual leakage report bundled with the SHA-256 receipt.
   - Redacted-PDF irreversibility assertion + `unmasker`/`hidden-text-detector` forensic parity (text under black boxes, PDF incremental revisions, rendering-mode-3/white-on-white text, recursive nested attachments).
   - Gate structured rejection-reason codes + recoverability path (`CuratorKIT`-inspired) + pre/post-redaction NumGuard-style numeric integrity hashing.
   - HIPAA Safe Harbor identifier validator pack + optional vault `restore()` + property-based round-trip tests + fail-closed-on-error MCP tests (`umbryn-mcp` parity).
   - Standard trainer exporters (`LLaMA-Factory`, `Unsloth`, `Oumi`, `NeMo`-compatible JSONL) + one-command `versieve sanitize <file>` CLI with before/after diff report.

---

### 3.4 SQ4 — The Unwritten Theoretical Novelty Frontier (Six White-Space Mechanisms)

Crossing the six verified research domains reveals **six theoretical mechanisms that do not yet exist in any verified paper or software tool**. Each addresses a structural limitation left open by both competitors and Versieve's own four papers:

#### Mechanism 1: Adversary-Closed Dual-Channel Conformal E-Gate (`AC-CRC`)
- **Unresolved Gap:** Every redaction gate today—including Versieve's `HC-CRC`—is *detector-closed*, certifying only recall relative to a scanner's ontology. Yet Staab et al. (2024) and Lukas et al. (2023) demonstrate that scrubbed text still leaks private attributes via quasi-identifier inference, while `CPA` (`arXiv:2609.21340`) only evaluates re-identification *post-hoc*.
- **Theoretical Formulation:** Replace single-channel detector p-values with a **convex combination of two valid e-processes** (leveraging Gauthier et al., 2025; Hultberg et al., 2026):
  $$E_t^{\text{joint}}(\lambda) = w_1 E_t^{\text{det}}(\lambda) + w_2 E_t^{\text{adv}}(\lambda), \quad w_1 + w_2 = 1,\; w_1, w_2 > 0$$
  where $E_t^{\text{det}}$ tests whether hierarchical span-level detector risk exceeds $\alpha_{\text{det}}$, and $E_t^{\text{adv}}$ tests whether a local auxiliary-knowledge adversary achieves conformal re-identification ambiguity-set size $|C_{\text{adv}}(x)| < k_{\min}$ (failing conformal $k$-ambiguity). Because any convex combination of valid e-values remains a valid e-value *without requiring independence between channels*, the gate preserves anytime-valid finite-sample control ($\mathbb{P}(\exists t : E_t^{\text{joint}} \ge 1/\delta \text{ under } H_0) \le \delta$) and automatically abstains to human review whenever **either** detector leakage **or** quasi-identifier singling-out breaches budget.
- **Why It Matters:** First theoretically grounded bridge from detector-closed redaction to EDPB Opinion 28/2024's adversary-focused singling-out standard.

#### Mechanism 2: Graph-Topology-Aware Conformal Risk Control & Ego-Graph Structural $k$-Anonymity
- **Unresolved Gap:** Versieve Paper 4 observed a $14.32\times$ blast-radius amplification from a single entity-resolution merge error, and `Chase Anonymisation` (`arXiv:2410.12418`) shows that anonymized knowledge graphs remain vulnerable to neighborhood/subgraph structural re-identification. Meanwhile, neither `HC-CRC` nor `Dunn`/`Lee`/`HG-CRC` accounts for **overlapping entity-graph correlation** across documents.
- **Theoretical Formulation:** Combine weighted non-exchangeable conformal prediction (Barber et al., 2023) with Dual-CSR Personalized PageRank influence weights: assign each calibration/test block an effective dependence weight inversely proportional to its graph-neighborhood overlap, bounding cross-document error propagation explicitly by $k$-hop blast radius. Simultaneously enforce an **Ego-Graph Structural $k$-Indistinguishability constraint** prior to corpus or CAG export: if a vaulted entity node `<PII:PERSON_k>` has a uniquely identifying neighborhood signature (degree/relation-type multiset shared by fewer than $k$ entities in the estate), prune or coarsen its rarest cross-document edges until every released entity resides in a structural equivalence class of size $\ge k$.
- **Why It Matters:** Directly neutralizes graph-based singling-out attacks on composed entity corpora—an attack surface no positional chunker or existing KG-SFT tool (`GraphGen`) has modeled.

#### Mechanism 3: Zero-ZK Verifiable Amnesia via Entity-Indexed Merkle-DAG Commitments & Transitive Spillover Bounds
- **Unresolved Gap:** Xu et al. (ICML 2025) prove parameter-level LLM unlearning is reversible; Eisenhofer et al. (2022) and Maheri et al. (2025) achieve cryptographic verifiability only via prohibitive zk-SNARKs over gradient updates. Furthermore, erasing Entity $A$'s direct spans does not erase **2nd-order transitive mentions** (e.g., *"the VP who approved Invoice 992"* residing in Entity $B$'s document).
- **Theoretical Formulation:** Commit every Versieve corpus export to a canonical **Entity-Sorted Merkle-DAG** whose leaves hash `(entity_id, source_doc_hash, byte_range, vaulted_span)`. Executing `eraseEntity(A)` produces: (a) an $O(\log N)$ **Merkle-Diff Non-Membership Proof** linking `root_before` → `root_after` without revealing deleted plaintext; (b) a **Deterministic Retrain Binding** hashing `(root_after, base_model_sha256, seed, hyperparams, adapter_sha256)` so an auditor can verify fresh-retrain compliance via replay without SNARK prover overhead; and (c) a **2-Hop Semantic Spillover Audit** querying the Dual-CSR neighborhood of $A$ for indirect co-referent descriptions left in surviving documents, bounding residual transitive information before regeneration.

#### Mechanism 4: Counterfactual Surrogate Information-Bottleneck LoRA (`IB-PT-LM`)
- **Unresolved Gap:** Static surrogate substitution (`arXiv:2603.17217`) risks memorizing specific fake names; pure `-100` loss masking (`SLUNG`, `Surprise Masking`, `Goldfish`, `RMFT`) stops output token prediction on masked spans but still allows self-attention layers to encode private surrogate or contextual signatures into hidden representations of adjacent non-masked tokens.
- **Theoretical Formulation:** Combine per-epoch **disjoint typed-surrogate resampling** (drawing fresh grammatical-role surrogates $s^{(1)}, s^{(2)}$ from disjoint pools per entity occurrence each epoch) with a **representation-invariance regularizer** on non-entity token hidden states:
  $$\mathcal{L}_{\text{IB-PT-LM}} = \mathcal{L}_{\text{CE}}\bigl(y_{\neg\text{PII}} \mid x(s^{(1)})\bigr) + \beta \cdot D_{\text{KL}}\Bigl(p_\theta\bigl(\cdot \mid x(s^{(1)})\bigr)_{\neg\text{PII}} \;\big\|\; p_\theta\bigl(\cdot \mid x(s^{(2)})\bigr)_{\neg\text{PII}}\Bigr)$$
  Minimizing this objective drives conditional mutual information $I(h_{\neg\text{PII}}(x); s \mid \text{entity\_type}) \to 0$, forcing LoRA adapters to become invariant to the specific surface identity string while eliminating placeholder-token gradient domination and tag echo.

#### Mechanism 5: Hermetic Capability-Carrying Execution Receipts (Closing the WASM-to-Host Trust Gap)
- **Unresolved Gap:** Static `WebAssembly.Module.imports(mod).length === 0` certifies only pure WASM kernels, leaving the JS/Node/Browser host runtime (weight loaders, `ffmpeg`, `whisper`, MCP stdio) outside the capability proof.
- **Theoretical Formulation:** Define a **Two-Layer Hermetic Execution Envelope** pairing (a) static zero-import WASM binary digests with (b) OS/runtime-enforced zero-network isolation attestations (Linux `seccomp`/network namespace or Windows job-object/sandbox socket denial + content-addressed SHA-256 verification of pre-cached offline weight manifests) recorded directly into the SHA-256 run receipt. This upgrades "zero egress" from a kernel-only property to an auditable whole-pipeline invariant.

#### Mechanism 6: Joint Lexical-Biometric Multimodal De-Identification in Zero-Import WASM
- **Unresolved Gap:** Audio PII scrubbers (`VoiceShield`, Versieve) mute spoken words while leaving biometric voiceprints intact; VoicePrivacy frameworks anonymize voiceprints while leaving spoken PII words intact.
- **Theoretical Formulation:** Unify both layers on Versieve's entity graph: link speaker diarization / acoustic clusters and visual face tracks to the same vaulted `<PII:PERSON_k>` node, then execute deterministic **lexical muting + McAdams-coefficient formant/LPC speaker anonymization** directly inside `versieve_media.wasm` (requiring zero neural TTS weights and preserving zero-import auditability). A single `perceiveMulti()` or `eraseEntity()` call then removes both *what was said about a person* and *the person's biometric voice signature*.

---

## 4. Discussion

### 4.1 Synthesis & Resolution of Evidence Contradictions

Three substantive contradictions surfaced across sources and internal Versieve documents:

1. **Detection Accuracy vs. Release Risk Certification:** Presidio (`79.26%` TAB F1) and `screenleak`'s self-reported ONNX models (`86.7%` text / `98.9%` image zero-leak) outperform Versieve's built-in detectors on raw recall/F1, yet offer zero finite-sample leakage guarantees. Resolving this tension requires treating Versieve's architecture as a **certified orchestration and gating layer over pluggable detectors** (P1-2 + P2 pluggable interface) rather than fighting Presidio/GLiNER on standalone F1.
2. **LoRA Fine-Tuning vs. Retrieval Utility:** Both Versieve Paper 3/4 (Graph-PPR `53.3%` and BM25 `60.0%` vs. composed LoRA `11.7%` at 1.5B scale) and external curation frameworks (`CuratorKIT`, `AfterImage`, `GraphGen`) show that raw chunk-formatted SFT underperforms document-grounded QA synthesis and retrieval. The immediate practical implication is to retain retrieval/CAG as the primary high-accuracy path while adding an optional local-LLM document-grounded QA training view (P1-7).
3. **Detector-Closed Certificates vs. Adversarial Privacy:** Versieve's Paper 1/2 certificates explicitly scope to detector-closed bounds, whereas Staab et al. (2024), Lukas et al. (2023), and `CPA` (`arXiv:2609.21340`) show real-world re-identification depends on auxiliary knowledge and quasi-identifiers. Adopting P1-4 (CPA attacker audit) immediately and pursuing Theoretical Mechanism 1 (`AC-CRC`) long-term closes this epistemic gap honestly.

### 4.2 Acknowledged Limitations

- **Self-Reported Competitor Benchmarks:** Several Tier 2/3 metrics (e.g., `screenleak` leaderboard, `Redakto` evaluations, `GroupDocs` format claims) have not yet been independently reproduced inside Versieve's CI harness; they are treated strictly as candidate benchmark targets rather than established facts.
- **Preprint Currency:** Multiple 2026 arXiv papers (`arXiv:2603.17217`, `2606.21631`, `2607.24562`, `2608.18260`, `2609.21340`, `2610.22988`) are preprints whose peer-review status and final metrics may evolve.
- **Theoretical Novelty Candidates Unvalidated Empirically:** The six mechanisms in Section 3.4 are theoretical white-space proposals derived from verified literature intersections; none has yet been implemented, formally proved in full theorem-proof detail, or empirically benchmarked.
- **Scoping Protocol Ownership:** Because this study ran in `deep-research` `full` mode rather than a registered PRISMA 2020 systematic review, formal dual-reviewer screening and PRISMA-ScR checklist attestation remain with the author.

---

## 5. Quality Assurance, Review & AI Disclosure

### 5.1 Phase 5 Review Audit Summary (Incorporated into Final Revision)

- **Devil's Advocate Checkpoint 2 & 3 Verdict:** **PASS.** Key stress-tests enforced and resolved: (a) five unverified snippet-inherited tools (`Cloak`, `OSpipe`, `open-redactor`, `ALDS`, `mask-llm`) were strictly rejected under the gray-zone-equals-FAIL rule rather than silently carried over; (b) `PT-LM` was downgraded from "uncontested differentiator" to "contested—requires narrowing & ablation" upon discovering five direct loss-masking prior-art papers; (c) all six theoretical novelty mechanisms were explicitly tagged as unvalidated theoretical proposals rather than proven results.
- **Editorial Review Verdict:** **ACCEPT (post-revision).** Verified internal consistency with `docs/2026-11-25-experiment-gap-handoff.md` and `docs/research-notes/2026-11-24-company-brain-market-landscape.md`; ensured zero fabricated numbers and clear Tier 1/2/3 source separation.
- **Research-Integrity & Ethics Review Verdict:** **CLEARED.** No human subjects involved; no dual-use exploit instructions generated (forensic hidden-text and re-identification references are strictly defensive audit protocols); full attribution and AI disclosure included.

### 5.2 AI Disclosure Statement

This report was produced with AI-assisted research tooling (Antigravity running the Academic Research Skills `deep-research` multi-phase workflow with live web search verification against primary academic and repository sources). All citations were verified against primary search results on 2026-11-26; any unconfirmed items from prior notes were explicitly marked FAIL/UNVERIFIED. Final scientific judgment, experimental execution, and publication claims remain the responsibility of the human author.

---

## 6. References (APA 7.0)

Abbasi-Yadkori, Y., Kuzborskij, I., György, A., & Szepesvári, C. (2024). Mitigating LLM hallucinations via conformal abstention. *arXiv preprint arXiv:2405.01563*. https://arxiv.org/abs/2405.01563

Albanese, F., et al. (2026). Anonymous-by-construction: An LLM-driven framework for privacy-preserving text. *arXiv preprint arXiv:2603.17217*. https://arxiv.org/abs/2603.17217

Angelopoulos, A. N., Bates, S., Candès, E. J., Jordan, M. I., & Lei, L. (2021). Learn then test: Calibrating predictive algorithms to achieve risk control. *arXiv preprint arXiv:2110.01052*. https://arxiv.org/abs/2110.01052

Barber, R. F., Candès, E. J., Ramdas, A., & Tibshirani, R. J. (2023). Conformal prediction beyond exchangeability. *The Annals of Statistics*, 51(2), 816–845. https://arxiv.org/abs/2202.13415

Bhattacharjee, S., Sharma, K., Sankarapu, V. K., & Seth, P. (2026). CuratorKIT: Data curation and synthetic data generation for LLM post-training. *arXiv preprint arXiv:2606.21631*. https://arxiv.org/abs/2606.21631

Bourtoule, L., Chandrasekaran, V., Choquette-Choo, C. A., Jia, H., Travers, A., Zhang, B., Lie, D., & Papernot, N. (2021). Machine unlearning. In *2021 IEEE Symposium on Security and Privacy (SP)* (pp. 141–159). IEEE.

Chase Anonymisation Authors. (2024). Chase anonymisation: Privacy-preserving knowledge graphs with logical reasoning. *arXiv preprint arXiv:2410.12418*. https://arxiv.org/abs/2410.12418

Chowdhury, S. B. R., et al. (2026). Inference-time unlearning using conformal prediction. *arXiv preprint arXiv:2602.03787*. https://arxiv.org/abs/2602.03787

Conformal Privacy Auditing Authors. (2026). Conformal privacy auditing: Calibrated re-identification attacks with statistical guarantees. *arXiv preprint arXiv:2609.21340*. https://arxiv.org/abs/2609.21340

Dunn, R., Wasserman, L., & Ramdas, A. (2018). Distribution-free prediction sets for two-layer hierarchical models. *arXiv preprint arXiv:1809.07441*. https://arxiv.org/abs/1809.07441

Eisenhofer, T., Riepel, D., Chandrasekaran, V., Ghosh, E., Ohrimenko, O., & Papernot, N. (2022). Verifiable and provably secure machine unlearning. *arXiv preprint arXiv:2210.09126*. https://arxiv.org/abs/2210.09126

Gauthier, E., Bach, F., & Jordan, M. I. (2025). E-values expand the scope of conformal prediction. *arXiv preprint arXiv:2503.13050*. https://arxiv.org/abs/2503.13050

Hans, A., Wen, Y., Jain, N., Kirchenbauer, J., Kazemi, H., Singhania, P., Singh, S., Somepalli, G., Geiping, J., Bhatele, A., & Goldstein, T. (2024). Be like a goldfish, don't memorize! Mitigating memorization in generative LLMs. *arXiv preprint arXiv:2406.10209*. https://arxiv.org/abs/2406.10209

Hultberg, E., Zachariah, D., & Ribeiro, A. (2026). Anytime-valid conformal risk control. *arXiv preprint arXiv:2602.04364*. https://arxiv.org/abs/2602.04364

Joshi, et al. (2025). Randomized masked finetuning: An efficient way to mitigate memorization of PIIs in LLMs. *arXiv preprint arXiv:2512.03310*. https://arxiv.org/abs/2512.03310

Lee, Y., Barber, R. F., & Willett, R. (2023). Distribution-free inference with hierarchical data. *arXiv preprint arXiv:2306.06342*. https://arxiv.org/abs/2306.06342

Lin, Z., Gou, Z., Gong, Y., Liu, X., Shen, Y., et al. (2024). Rho-1: Not all tokens are what you need. *arXiv preprint arXiv:2404.07965*. https://arxiv.org/abs/2404.07965

Lukas, N., Salem, A., Sim, R., Tople, S., Wutschitz, L., & Zanella-Béguelin, S. (2023). Analyzing leakage of personally identifiable information in language models. In *2023 IEEE Symposium on Security and Privacy (SP)*. https://arxiv.org/abs/2302.00539

Maheri, M., Davidson, A., & Haddadi, H. (2025). Verifiable unlearning on edge. *arXiv preprint arXiv:2506.20037*. https://arxiv.org/abs/2506.20037

Maini, P., Feng, Z., Schwarzschild, A., Lipton, Z. C., & Kolter, J. Z. (2024). TOFU: A task of fictitious unlearning for LLMs. *Conference on Language Modeling (COLM)*.

Redakto Authors. (2026). Redakto: The incognito tab for LLMs. *arXiv preprint arXiv:2608.18260*. https://arxiv.org/abs/2608.18260

Salem, et al. (2026). Hierarchical group-conditional conformal risk control for selective prediction in language models. *arXiv preprint arXiv:2607.24562*. https://arxiv.org/abs/2607.24562

Staab, R., Vero, M., Balunović, M., & Vechev, M. (2024). Beyond memorization: Violating privacy via inference with large language models. *International Conference on Learning Representations (ICLR)*. https://arxiv.org/abs/2310.07298

Tyagi, et al. (2026). Surprise masking: Private data filtering with model likelihoods. *arXiv preprint arXiv:2610.22988*. https://arxiv.org/abs/2610.22988

Wang, Q., Fan, Y., & Wang, X. E. (2025). SAFER: Risk-constrained sample-then-filter in large language models. *arXiv preprint arXiv:2510.10193*. https://arxiv.org/abs/2510.10193

Wang, et al. (2025). Teaching models to understand (but not generate) high-risk data. *arXiv preprint arXiv:2505.03052*. https://arxiv.org/abs/2505.03052

Xu, et al. (2025). Unlearning isn't deletion: Investigating reversibility of machine unlearning in LLMs. *International Conference on Machine Learning (ICML)*. https://arxiv.org/abs/2505.16831

### Primary Software & Standard Repositories Verified

- `altaidevorg/afterimage` — https://github.com/altaidevorg/afterimage
- `austinmabry/OpenScrub` — https://github.com/austinmabry/OpenScrub
- `censgate/redact` (`redact-wasm`) — https://censgate.com
- `ConardLi/easy-dataset` — https://github.com/ConardLi/easy-dataset
- `Dangerzone` — https://dangerzone.rocks
- `DS4SD/Docling` (IBM / LFAI) — https://github.com/DS4SD/Docling
- `3DCF/doc2dataset` (`NumGuard`) — verified via GitHub/Rust pipeline docs
- `meta-llama/synthetic-data-kit` — https://github.com/meta-llama/synthetic-data-kit
- `microsoft/presidio` (`presidio-image-redactor`) — https://github.com/microsoft/presidio
- `NVIDIA/NeMo-Curator` — https://github.com/NVIDIA/NeMo-Curator
- `open-sciencelab/GraphGen` — https://github.com/open-sciencelab/GraphGen
- `osint-shifu/unmasker` — https://github.com/osint-shifu/unmasker
- `Redacat` (`mupdf-wasm`) — verified via GitHub
- `sam247/openredaction` — https://github.com/sam247/openredaction
- `screenpipe` (`screenleak`, `opf-rs`) — verified via GitHub
- `SepidehNorouziMotlagh/VoiceShield` — https://github.com/SepidehNorouziMotlagh/VoiceShield
- `ssrajadh/sentrysearch` (`SentryBlur`) — https://github.com/ssrajadh/sentrysearch
- `topworld87/VideoRedactionAPP` — https://github.com/topworld87/VideoRedactionAPP
- `umbryn-mcp` (formerly `phi-redact-mcp`, Rinava) — verified via GitHub
- `Voice-Privacy-Challenge/Voice-Privacy-Challenge-2024` & `VoicePrivacy/IDMap` — https://github.com/Voice-Privacy-Challenge/Voice-Privacy-Challenge-2024
- `wppoland/hidden-text-detector` — verified via GitHub
- `MAT2`, `Sigstore Rekor`, `C2PA`, `Gitleaks`, `Yelp detect-secrets`, `Unstructured.io`, `BigCode StarPII` — verified via primary project documentation
