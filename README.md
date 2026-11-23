# VeriSieve

[![CI](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml/badge.svg)](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Zero-Egress Document Curation, Customer-Label Conformal Gatekeeping, and Local WebAssembly Training**  
*Author: Gege Ardiyansyah*

VeriSieve is the portable curation engine powering the **RTIO** browser sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)), backed by three zero-import `#![no_std]` Rust WebAssembly kernels (`verisieve_clean.wasm`, `verisieve_dl.wasm`, `verisieve_sql.wasm`) and a pure-memory `cactus.wasm` runtime for Option B 2D-tiled optical recognition.

---

## Architecture & Honest Separation of Responsibilities

| Layer | Component | Responsibility & Verification |
|---|---|---|
| **Interface** | **RTIO** ([rtio.io/sandbox](https://www.rtio.io/sandbox)) | Interactive browser workspace for URL/document upload, PII/triage inspection, customer chunk labeling, SQL exploration, and local adapter runs. That app still depends on `tesseract.js` and `@tesseract.js-data/eng`. |
| **Portable Engine** | **VeriSieve** (`src/`, `include/verisieve.h`) | Local PDF (`/FlateDecode`, `/ASCII85Decode`, `/ObjStm`, scoped `/ToUnicode` CMaps, `TJ` kerning) + `.docx` ingestion, optional local Tesseract.js OCR, PII redaction (`334`-word exclusion lexicon), `520`-dim logistic gatekeeper, LTT conformal calibration, SSRF-hardened URL ingest, and MCP server (`8` tools). Runs across Browser, Node CLI, MCP, and C99. |
| **Rust WASM Cores** | **Clean + DL + SQL WASM** (`vendor/wasm/`) | Three zero-import (`imports.length === 0`) `#![no_std]` Rust binaries: `verisieve_clean.wasm` (`13,757 B`), `verisieve_dl.wasm` (`60,096 B`, `26` `mle_dl_*` exports for BitNet/VeRA & 64-dim needle embeddings), and `verisieve_sql.wasm` (`49,642 B`, `MAX_ROWS=4096` SQL subset engine). |
| **Vision OCR Runtime** | **Cactus WASM + local Tesseract.js** | Cactus remains the preferred pure-memory 2D-tiled path when Mirage `.cact` weights are supplied. The CLI and RTIO browser use local Tesseract.js/WASM as an OCR fallback when those weights are absent; worker, core, and English language data are resolved from installed local assets. |

Note explicitly: **the 520-dimensional logistic gatekeeper and Learn-Then-Test (LTT) binomial calibration execute purely in deterministic JavaScript and C99**, while **`verisieve_dl.wasm` executes neural BitNet/VeRA updates and needle retrieval**. Scanned images and image-only PDFs use Cactus when local `.cact` weights are present, otherwise the CLI/browser Tesseract fallback; OCR never invents placeholder text.

---

## Deliverable Status & Known Scope

| Requirement | Built & Verified in VeriSieve | Honest Gap / Boundary |
|---|---|---|
| **Web & Link Capture** | `verisieve_clean.wasm` HTML/entity/script/comment stripping + SSRF DNS/private-CIDR pinning (`src/ingestor.js`); `ingestor.js` & `ingestFromUrlOrPath` fail closed on unreachable hosts or missing weights | Live remote URL ingest requires host network connectivity |
| **PDF & `.docx` Capture** | Bit-3 Data Descriptor ZIP OOXML `.docx` parser + PDF 1.5 `/ObjStm`, `/FlateDecode`, `/ASCII85Decode`, scoped `/ToUnicode` CMaps & `TJ` kerning (`8/8` PMC PDFs clean); local OCR fallback for image-only PDFs; `.pdf` files containing HTML are detected and sent through the HTML cleaner | Encrypted PDFs (`/Encrypt`) fail closed; OCR depends on readable embedded images |
| **Dedupe & Manifest** | SHA-256 exact hash + 3-gram Jaccard ($\ge 0.85$) tracked with capacity-eviction accounting (`vs_clean_dedup_overflowed`); immutable `AuditChain` | Tested per shard in memory (`verisieve_sql.wasm` bounded at `4,096` rows per query table) |
| **Multi-Axis Customer Gate** | Independent `safe`, `useful`, `topic` logistic heads + LTT + C99 UTF-8 FNV-1a parity; fail-closed `tauKeep = 1.0` when `n_cal,unsafe` is below finite-sample bound | Conditional LTT at $\alpha=0.01, \delta=0.05$ requires $n_{\text{cal,unsafe}} \ge 299$ (`206` unsafe cal items hit fail-closed floor; `40`-item multi-axis calibration fails closed on sparse negative classes) |
| **Zero-Egress Runtime** | All 4 WASM binaries audited via `npm run audit-wasm`. Tesseract.js and English data are installed once as local package dependencies and loaded from disk; OCR makes no runtime CDN request | Process cold-start favors C99/Node+WASM, while warm batched matrix dot products favor Python+NumPy BLAS |

---

## Live 1,207-Document Benchmark Summary

All numbers below are measured live by `npm run bench:scale` (`results/scale-and-paradigm-benchmark.json`, SVG SHA-256 byte-identical across passes) across ICDAR FUNSD (`199` scans / `30,595` bboxes), `ai4privacy-200k` (`500` synthetic records), PubMedQA (`500` clinical abstracts), and PMC Full-Text (`8` born-digital clinical PDFs).

### 1. PDF CMap + FUNSD 2D Geometric Tiling
- **PMC Clinical PDFs (`8/8` Clean)**: Scoped `/ToUnicode` CMap tables + negative-kerning `TJ` (`<= -110`) space reconstruction recover `8,134` readable lines (`55,099` words) in `209.02 ms` total (`26.13 ms` avg; range `8.42–64.54 ms`) on the 16 Nov 2026 remeasurement.
- **FUNSD Geometric Survival (`199` forms, `30,595` boxes $\ge 8{\times}4$\,px)**:
  - `stock_capped_8`: `5.2%` (`1,592`)
  - `untiled_512`: `20.53%` (`6,281`)
  - `horizontal_1d_band`: `71.29%` (`21,811`)
  - `tile_2d_zero_overlap`: `92.44%` (`28,283`, `4.94%` seam cut loss)
  - **`tile_2d` (32px overlap, stride 480)**: **`97.38%` (`29,793`)** geometry scan (excludes external neural OCR recognizer accuracy).

### 2. PII Disambiguation & Honest Regex Ceiling
- **`ai4privacy-200k` (`500` synthetic span records)**:
  - Core contact/card/IPv4: **`78.6%`** (`110/140`)
  - Targeted 8 patterns: **`62.8%`** (`159/253`)
  - All 26 structured token types: **`31.0%`** (`180/580`)
  - Bare unprefixed international names: **`49.6%`** (`118/238`, honest regex ceiling)
- **PubMedQA False-Positive Protection (`250/250` split, pre-committed `334`-word lexicon)**:
  - Train split (`62,620` words): `44.4% -> 22.8%` docs (`5.29 -> 1.66` hits/1k words)
  - Blind test split (`63,739` words): `45.2% -> 26.0%` docs (`5.46 -> 2.01` hits/1k words, **`2.72x` fewer false positives**)
  - Lookalike lines (`n=5`): `80.0% -> 20.0%` false-positive rate

### 3. Single-Scorer Conformal LTT & Customer Multi-Axis Gate
Stratified split (`n_train=607`, `n_cal=301` [`206` unsafe], `n_test=299` [`205` unsafe, `94` safe], $\delta=0.05$) on the 520-dim logistic scorer with fixed lower floor $\tau_{\text{drop}} = 0.25$:

| Budget / Policy | $\tau_{\text{keep}}$ | Cond FPR | Joint Risk | Safe Yield | Abstain | Status ($\delta=0.05$) |
|---|---:|---:|---:|---:|---:|---|
| $\alpha = 0.20$ | `0.26` | `14.63%` | `10.03%` | `96.81%` | `0.33%` | Certified Cond & Joint |
| **Uncalibrated** | `0.50` | `4.39%` | `3.01%` | `90.43%` | `0.00%` | Uncontrolled (fails $\alpha \le 0.02$) |
| $\alpha = 0.10$ | `0.44` | `4.88%` | `3.34%` | `92.55%` | `8.36%` | Certified Cond & Joint |
| $\alpha = 0.05$ | `0.52` | `3.41%` | `2.34%` | `89.36%` | `10.37%` | Certified Cond & Joint |
| $\alpha = 0.02$ | `0.60` | `0.98%` | `0.67%` | `82.98%` | `14.05%` | Certified Cond & Joint |
| $\alpha = 0.01$ | `1.00` | `0.00%` | `0.00%` | `0.00%` | `40.80%` | Joint Valid (`p=0.0486`) / Cond Fail-Closed (`206 < 299`) |

- **Within-domain PubMedQA (`n=124`)**: Contact regex achieves `100.0%` on injected email/phone cases vs. `87.9%` 520-dim linear gate and `52.4%` naive any-PII regex. Multi-axis evaluation (`60` train / `40` cal → `300` test): `safe` certifies (`tauKeep=0.55`, `97.1%` recall / `95.7%` precision, `7.3%` abstain). Sparse `useful`/`topic` calibration fails closed (`tauKeep=1.0`). The conjunction keeps `0` chunks (`85` abstain, `215` drop). There is no keep-set, so a `0%` leak rate is not a measured yield.

### 4. 7-Trial Interleaved Substrates & Held-Out Ablation
Medians of 7 interleaved OS process spawns on an AMD Ryzen 7 7840HS, 31.3 GB RAM, Windows 11 (16 Nov 2026). Spawn and RSS are comparable. Warm kernels are not: C99 and NumPy time the same `1,207 x 520` logistic; Node times 64-d `mle_dl_vera_predict`; PyTorch times a Qwen2 step on 100 rows. `include/verisieve.h` is `2,129 B` (the old `12.4 KB` label was a constant).
- **C99**: `14.12 ms` spawn | `6.08 MB` RSS | `0.745 ms` logistic
- **Node.js + WASM (`60,096 B`)**: `106.22 ms` spawn (`1.045 ms` WASM init) | `55.97 MB` RSS | `7.125 ms` VeRA predict (**`121.6x` lower spawn median and `7.7x` lower RSS** than PyTorch+DuckDB)
- **Python 3.12 + NumPy 2.4.3**: `388.79 ms` spawn (`187.01 ms` import) | `31.49 MB` RSS | **`0.207 ms` logistic (wins the shared dot product)**
- **Python 3.12 + PyTorch 2.10 + DuckDB 1.5.5**: `12,917.14 ms` spawn (`11,661.98 ms` import) | `432.3 MB` RSS | `31.47 ms` Qwen2 step

On held-out `n_test = 299` across `N_train in {100, 300, 607}`: Gate BCE drops `26.7%` (`0.2577 -> 0.2244 -> 0.189`, `94.0%` Acc vs. `64.2%` Naive Regex / `31.4%` Raw), WASM VeRA BCE (`mle_dl_vera_loss_grad`) drops `0.9432 -> 0.6698 -> 0.6141`, contact PII leak stays `<= 1.05%`, and 64-dim Needle R@5 (`125` PubMedQA Q->Body queries) preserves `60.0%` cosine-only parity. That 60% is not the sandbox blend. The blend on the same rows is in `docs/2026-11-16-rag-redaction-verdict.md`.

### 16 Nov 2026 check — measured, and it does not change the shipped ranker

The probe ran. The 0.55/0.45 blend, the regex, and the gate are unchanged.

On the same 125 held-out PubMedQA questions: cosine recall@5 is `75/125` (`60%`), lexical is `123/125` (`98.4%`), and the blend is `120/125` (`96%`). Lexical leads because those questions repeat the passage. A local VeRA head inside `verisieve_dl.wasm`, with no checkpoint loaded, reorders the blend's top 30 and then keeps 6. Gold in that top 6 falls from `121/125` to `39/125`. A second local head lowers bare-name recall on the ai4privacy test 250 from `56/119` to `42/119`. The regex stays. Full counts: `docs/2026-11-16-rag-redaction-verdict.md`.

RTIO chat, separate from these numbers: the current question and earlier turns are masked on the way out, including a flagged name, and a citation number outside the excerpts sent is marked. Retrieval still uses the raw question and the same blend.

### Research still to run

- Questions that do not copy the passage, before any change to the 0.55/0.45 mix.
- Questions with no supporting chunk, before a retrieval floor. On this 125, a 0.15 floor would abstain on `0` questions.
- Fine-tune the 0.5B named in the RTIO Train tab on the exported SAFE JSONL, and score it against the untouched base model. The Train tab writes the export and the command. That run has not happened.
- Whether a cited sentence is supported by that chunk. The drawer check only tests that the citation number was sent.

---

## Verification & Quickstart

Install dependencies once before using the CLI. Local OCR uses Tesseract.js with the bundled English model when Cactus weights are unavailable; providing local Mirage `.cact` weights keeps Cactus as the preferred OCR engine.

```bash
npm install
node bin/verisieve.mjs ingest --input ./scanned-document.pdf --out ./results/ingest.json
```

```bash
# Portable tests. These do not need the downloaded benchmark rows.
npm run test:ci

# Verify zero-egress WASM static census across all 4 binaries
npm run audit-wasm

# FUNSD, ai4privacy, and PubMedQA are not in this git clone. Download them, then measure.
node scripts/fetch-public-benchmarks.mjs
npm run bench:scale

# Full suite, including the 1,207-document scale tests. Requires the download above.
npm test

# Compile the Extraction & Redaction Benchmark PDF (paper/verisieve-extraction-redaction-benchmark.pdf)
cd paper && pdflatex verisieve-extraction-redaction-benchmark && bibtex verisieve-extraction-redaction-benchmark && pdflatex verisieve-extraction-redaction-benchmark && pdflatex verisieve-extraction-redaction-benchmark
```

For security policies and air-gapped design guarantees, see [SECURITY.md](SECURITY.md).
