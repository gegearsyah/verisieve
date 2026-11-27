# Versieve: Landscape, Gaps, and Research Backlog

Date: 2026-11-25
Basis: your four papers + the README, plus web searches run in this conversation.
Items marked † were **not** verified in a search (from memory or from your own paper's citations). Search snippets were short, so treat every competitor row as "worth a closer look", not a finished verdict. "How they win" is where they are ahead of Versieve today, not a judgement of the project.

---

## 1. Where Versieve is different

Not found in my searches (absence of evidence, not proof):

| Versieve property | Closest thing found |
|---|---|
| Load-time `imports.length === 0` audit as the capability boundary, across all kernels | Others claim "local/zero-egress" by policy (transformers.js, onnxruntime-web, tesseract.js, which fetch weights) |
| Finite-sample conformal gate (LTT, HC-CRC, E-LTT) with abstain-to-human over redaction output | Conformal methods exist for hallucination/unlearning/privacy *auditing*, not as a PII release gate |
| Entity-graph corpus with byte-diff erasure receipts | CuratorKIT has a provenance chain; nobody found with erasure receipts |
| One call (`perceiveMulti`) over mixed formats with a shared entity graph | Per-modality tools only |
| PT-LM (loss-mask placeholder spans + surrogate forward context) | Local-LLM substitution paper solves the same problem differently (see 2.6); do a prior-art check on loss-masking redacted spans |
| Publishing negative results next to claims | Rare; keep this |

---

## 2. Landscape by lane

### 2.1 Text and image PII, local / in-browser

| Project | What it is | How it wins | What to research / do |
|---|---|---|---|
| **screenpipe** (+ screenleak benchmark) | Local PII models in browser (transformers.js text, onnxruntime-web image regions); public leaderboard incl. Presidio, Google DLP, frontier LLMs | Image-region detection: self-reported 98.9% zero-leak (IoU ≥ 0.30) vs Presidio 0.5%; text 86.7% vs Presidio 35.4%. Live demo. Numbers are self-reported on their own benchmark | Run Versieve on screenleak (text + image). Add a pluggable detector interface so their ONNX models can slot in as Stage 3B. Report an image-region metric (IoU-based) |
| **Cloak** | Browser app: text/images/PDF; BERT NER in Web Workers; tesseract.js | UX: manual brush for missed PII, custom regex pattern editor | Human-correction loop in the RTIO sandbox (manual box + custom pattern); log corrections as calibration data |
| **PrivacyScrubber** | Chrome extension, vanilla JS, Tesseract WASM | Distribution form (extension); explicit false-positive focus | Packaging as extension; report FP rate beside recall |
| **Client-side PDF redactor** (HackerNoon write-up) | pdf.js + pdf-lib | Clear account of "pseudo-redaction" (overlay leaves text stream) | Add an irreversibility test: re-extract text from redacted output and assert zero residual |
| **OSpipe** | Rust/WASM safety gate (allow / redact / deny); bundles ~11.8 KB–350 KB | Tiny footprint; explicit deny path | Publish a per-kernel footprint table; map your KEEP/ABSTAIN/DROP to allow/redact/deny in docs |
| **phi-redact-mcp / umbryn-mcp** | Fail-closed, zero-egress MCP for PHI/PII | HIPAA identifiers (NPI, DEA, MBI, MRN, CLIA); reversible `restore`; property-based round-trip tests; any engine error returns no output | Add HIPAA identifier set + validators (you already have NPI/NHS/TFN checks); property-based tests; optional `restore()` from vault; a fail-closed-on-error MCP test |

### 2.2 Video and audio

| Project | What it is | How it wins | What to research / do |
|---|---|---|---|
| **SentryBlur** | CLI: faces/plates (YOLOv9), prompt mode (Grounding DINO + SAM 2), temporal smoothing | Real detection + mask propagation across frames | Build a small video benchmark (faces, plates, on-screen text) with per-frame leakage, or state clearly that video detection is out of scope |
| **OpenScrub** | Local GPU: faces, whole-person silhouettes, plates, on-screen text via OCR; tracking; per-track human review | Tracking, whole-person masking, review UX | Dropout test for your temporal box tracker; per-track review in the studio |
| **open-redactor** | Prompt-driven CLI + MCP (`redact_media`, `audit_media`); shadow audit, coverage report, published leakage scores, consistent fake replacements | Closest to your audit/MCP story; ships leakage reporting | Adopt the "shadow audit" idea (re-run detectors on the output, report residual) and publish a leakage report per run, alongside your receipt |
| **Video Blackout** | Windows desktop app (AGPL / freemium); manual boxes; audio mute/beep ranges | Polish + manual control | Reference UX only |

Audio-specific tools were not searched this session†.

### 2.3 Office / PDF / email hidden content

| Project | What it is | How it wins | What to research / do |
|---|---|---|---|
| **unmasker** | Local, read-only; 27 detectors: covered/invisible PDF text, PDF revisions, tracked deletions, hidden sheets/slides/notes, metadata leaks, nested attachments, Unicode tricks | Depth and specimen-based tests; "evidence, not verdict" framing | Head-to-head on its specimen files. Add: failed-redaction detection (text under black bar), PDF incremental updates, recursive attachment scanning |
| **GroupDocs.Redaction / .Metadata** | Commercial SDKs; 30+ formats incl. MSG/EML; metadata sanitize | Format breadth, support, maintenance | Publish a format coverage matrix; treat hidden-channel extraction as baseline expectation |
| **ALDS** | Native C++ Win32 tool: strips metadata, comments, revisions from PDF/DOCX/XLSX/PPTX | One-click simplicity | One-command `versieve sanitize <file>` with a before/after diff report |

### 2.4 Detection baselines

| Project | How it wins | What to research / do |
|---|---|---|
| **Microsoft Presidio** (+ image redactor †) | TAB: 79.26 F1 (all maskable), 86.27 (PERSON); ~401 MB | Don't fight on F1: make Presidio a pluggable detector under your gate. Test whether gate + Presidio beats Presidio alone on end-to-end leak |
| **GLiNER PII variants** | Small models, strong PERSON recall | Larger/fine-tuned variants; check whether the echr_dev NO_MASK filter generalizes beyond ECHR |
| **Yelp detect-secrets** | F1 86.27 vs your 72.25; generic `JWT_SECRET=`-style assignments | Add generic assignment + entropy detectors; evaluate on real repos, not short MBPP scripts |
| **Gitleaks** | Mature rule ecosystem; fast native binary | Evaluate importing rule patterns (check licence); PEM-header handling |
| **BigCode PII (StarPII)** | 1,399 annotators, 22,950 labelled secrets, ~90% F1 | Evaluate your secret scanner on it if the licence allows |
| **Google Cloud DLP** | Cloud baseline in third-party leaderboards | Reference only |

### 2.5 Training-data pipelines

| Project | What it is | How it wins | What to research / do |
|---|---|---|---|
| **NVIDIA NeMo Curator** | Open-source curation framework; PII redaction step; JSONL; built for scale | Scale, ecosystem, trust | Throughput test at 10^5 to 10^6 docs; NeMo-compatible JSONL export |
| **CuratorKIT** (arXiv 2606.21631) | 6 format readers, PII/credential hygiene layer, quality gates, `provenance_chain`, rejection reasons and recovery | Unified audit incl. *why* a sample was rejected and whether it's recoverable | Add rejection-reason codes + recovery path to your gate; align provenance schema; read the full paper (I saw a summary) |
| **AfterImage** | Document-grounded QA generation with LLMs; exports LLaMA Factory / Oumi / OpenAI fine-tune / DPO | Generates the *knowledge-bearing* training format; many exporters | Add local-LLM document-grounded QA as a training view (directly addresses your weak 11.7% trained result); exporter adapters (LLaMA-Factory, Unsloth, Oumi) |
| **NumGuard pipeline** (DEV post) | Hashes every number and tracks it through the pipeline | Integrity checking for financial/legal text | Cheap feature: hash numbers pre/post redaction and flag changes. Ties to your over-masking cost ("APP Privacy Policy" becoming a person tag) |
| **mask-llm** | Local mask, cloud clean, local restore, JSONL | Simplicity (not zero-egress) | Positioning contrast only |
| **LLM Data Pipeline Pro** (Apify) | Paid web-to-JSONL, multi-provider export | Convenience | None |

### 2.6 Research neighbours

| Work | Relevance | What to research / do |
|---|---|---|
| **Local-LLM substitution anonymization** (arXiv 2603.17217) | On-prem, no egress; type-consistent surrogates; evaluates privacy + utility + trainability (LoRA) vs DLP/Presidio/BERT | PT-LM vs surrogate substitution head-to-head under one LoRA recipe; adopt their privacy-utility-trainability frontier plot |
| **Redakto** (arXiv 2608.18260) | Local text anonymizer with redaction + pseudonymization | Compare; add a pseudonymization mode |
| **Conformal Privacy Auditing** (arXiv 2609.21340) | Calibrated re-identification attacks to audit redaction releases | Add attacker-based audit to validate certificates beyond "detector-closed" |
| **Conformal abstention / unlearning / SAFER** (2405.01563, 2602.03787, 2510.10193) | Conformal methods in adjacent problems | Cite; check how they handle clustered data |
| **LTT reference code** (Angelopoulos et al.) | Reference implementation | Cross-validate your BinomCDF kernel against it |
| **Hierarchical conformal** (Dunn et al.; Lee et al., cited in Paper 2) | Guarantee-based alternatives to your Kish heuristic | Implement a subsampling/pooling variant and compare to HC-CRC |

### 2.7 Not verified this session †

Meta synthetic-data-kit, Easy Dataset, Docling, Unstructured, GraphGen, Presidio's image redactor, SISA/TOFU as unlearning baselines, hash-chained / transparency logs (CT, Rekor) as audit-chain prior art.

---

## 3. Research backlog (prioritized)

### P0: days (README and consistency; see section 4)

### P1: experiments that decide the story

| # | Experiment | Why | Success metric |
|---|---|---|---|
| 1 | **Stitched-baseline shootout**: Presidio + detect-secrets + unmasker + plain threshold vs Versieve gate, same held-out TAB data | Settles "anyone can stitch this" with data | End-to-end leak % at equal safe yield |
| 2 | **Gate over the best detector** (Presidio / larger GLiNER under HC-CRC) | Likely your biggest real win: certified wrapper on top of top detectors | Leak % at fixed yield vs detector alone |
| 3 | **Canaries in scanner-missed formats** (bare names, free-form addresses, usernames, employers) | Current canaries are formats the scanner is built to catch | Exposure bits and rank-1 count |
| 4 | **Attacker-based audit** (CPA-style LLM re-identification of released text) | Moves certificates past "detector-closed" | Re-identification rate on released vs withheld |
| 5 | **Competitor benchmarks**: screenleak (text + image), unmasker specimens | Honest position on their ground | Your score next to theirs, reported as-is |
| 6 | **PT-LM ablations**: masking-only, surrogate substitution, ≥3 seeds | Mechanism and novelty currently unproven | Effect with CI across seeds |
| 7 | **Training at real scale**: full corpora, more steps/epochs, ≥500 questions, 3 seeds, plus document-grounded QA view | 41 of 1,106 composed rows were trained on at the shared cap | Trained vs retrieval gap with CI |
| 8 | **End-to-end resolution scoring**: pairwise + B-cubed, router on the engine's own resolution (no oracle) | The 81.7% router figure is an upper bound | End-to-end disambiguation accuracy |
| 9 | **Ease benchmark**: install size, runtimes needed, lines to first output, time to first result vs a stitched stack | This is your actual wedge | A table you can paste in the README |

### P2: features borrowed from the landscape

- Pluggable detector interface (Presidio, GLiNER variants, screenpipe ONNX models)
- Human-correction loop (manual box, custom regex) in the sandbox
- Failed-redaction / hidden-content detectors (unmasker parity: text under black box, PDF revisions, nested attachments)
- Irreversibility test on redacted PDFs
- HIPAA identifier pack, property-based round-trip tests, optional `restore()`
- Exporters: LLaMA-Factory, Unsloth, Oumi, NeMo-compatible JSONL
- Number-integrity hashing (NumGuard-style)
- Rejection-reason codes and recovery path in the gate
- One-command `versieve sanitize <file>` with diff report
- Shadow audit and per-run leakage report

### P3: longer horizon

- Video detection benchmark (or an explicit scope-out)
- Noisy telephony audio instead of clean TTS
- Neural OCR character error rate (the 97.38% FUNSD figure is geometric survival only)
- Scale test at 10^5+ documents
- Prior-art sweep (GitHub + arXiv) before any "to our knowledge" claim

---

## 4. README fix checklist

1. **Add the missing "E2E leak (of released)" column** to the gate table: HC-CRC 21.47% at α=0.05, 35.19% at α=0.10, 2.36% at α=0.01 (Paper 2, Table 4).
2. **Split "works out of the box" from "needs weights / ffmpeg / whisper"**: audio and video in Node use local ffmpeg and whisper.cpp/faster-whisper; neural PII and OCR need local weights and fail closed. Drop "in WebAssembly" from the tagline or qualify it.
3. **Define "zero egress"** in one sentence: no user bytes leave; model weights are fetched once and cached.
4. **Soften or verify the "to our knowledge, no prior artifact" lines** in "What Is New".
5. **Add a "why not stitch it yourself" table** (kernels 388,797 B; Node+WASM 106 ms start, 56 MB RSS; label the 12.9 s / 432 MB comparison as PyTorch+DuckDB, not Presidio).
6. **Plain-language summary above the Pillars**; keep ICC/DEFF/Ville detail lower down.
7. **Add caveats**: canaries use scanner-detectable formats; Qwen-1.5B PT-LM seen F1 (0.190) is still below the untrained base (0.202).
8. **Reconcile stale numbers**: Paper 1 says four WASM modules / 14 MCP tools / 100 tests, README says five / 18 / 108; README says 70 Unicode vectors, Paper 2 says 174 cases. Fix the duplicated 2026a/2026b reference in Paper 2.

---

## 5. Positioning

**Wedge (testable):** the easiest zero-egress path from any file to safe, auditable AI data: one call, nothing leaves the machine, receipts you can re-run.

**Supporting proof to build:** ease benchmark (P1-9), gate-over-best-detector result (P1-2), leak column shown openly (README 1).

**Where not to compete:** raw detection F1 (Presidio), video detection quality (SentryBlur/OpenScrub/open-redactor), curation at scale (NeMo Curator). Plug into them instead.

---

## 6. Claims to avoid until verified

- "No prior artifact" / "we are not aware of a prior corpus…"
- "Mathematically certified" for the zero-import audit
- "Superior domain generalization" from the 67-row A/B
- "100% locally in WebAssembly" (for the Node audio/video path)
- Any trained-format advantage over retrieval
- The 81.7% router figure as a deployment number
