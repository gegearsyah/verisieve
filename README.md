# VeriSieve

[![CI](https://img.shields.io/badge/tests-58%2F58%20passing-brightgreen)](#verification) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Zero-Egress Document Curation, Customer-Label Conformal Gatekeeping, and Local WebAssembly Training**  
*Author: Gege Ardiyansyah*

VeriSieve is the portable curation engine powering the **RTIO** browser sandbox ([rtio.io/sandbox](https://www.rtio.io/sandbox)), paired with **MLE's `mle_dl_*` WebAssembly kernels** (`verisieve_dl.wasm`, 60.1 KB, 0 host imports) for BitNet 1.58-bit linear layers, 2-bit VeRA adapter training, and 64-dimensional needle retrieval.

---

## Architecture & Honest Separation of Responsibilities

| Layer | Component | Responsibility & Verification |
|---|---|---|
| **Interface** | **RTIO** ([rtio.io/sandbox](https://www.rtio.io/sandbox)) | Interactive browser workspace for URL/document upload, PII/triage inspection, customer chunk labeling, and local adapter runs. |
| **Portable Engine** | **VeriSieve** (`src/`, `include/verisieve.h`) | Deterministic text/PDF/`.docx` ingestion, `verisieve_clean.wasm` HTML/boilerplate strip + SHA-256 + 3-gram Jaccard dedupe, PII redaction (`334`-word exclusion lexicon), `520`-dim logistic gatekeeper, LTT conformal calibration, and MCP server (`8` tools). Runs across Browser, Node CLI, MCP, and C99. |
| **Neural Kernels** | **MLE WASM** (`verisieve_dl.wasm`) | Pure WASM (`0` imports, `60,096` bytes, `23` `mle_dl_*` exports) executing `mle_dl_vera_loss_grad` 2-bit VeRA training and 64-dim needle embeddings. |

Note explicitly: the **520-dimensional logistic gatekeeper and Learn-Then-Test (LTT) binomial calibration execute purely in deterministic JavaScript and C99**, while **MLE's `mle_dl_*` kernels execute the neural adapter and needle retrieval**. Optical recognition in the browser sandbox delegates to the external Mirage/Cactus OCR module, whereas VeriSieve handles geometric 2D seam-overlapping tiling.

---

## Deliverable Status & Known Scope

| Requirement | Built & Verified in VeriSieve | Honest Gap / Boundary |
|---|---|---|
| **Web & Link Capture** | HTML tag/script/nav stripping (`503 -> 233 B`, `53.7%` stripped in `0.833 ms`); `ingestor.js` fails explicitly when unreachable | Legacy `ingestFromUrlOrPath` keeps an opt-in fallback flag tested for offline unit suites |
| **PDF & `.docx` Capture** | `.docx` OOXML ZIP XML extraction (`295 B -> 150 chars`, `0.412 ms`); linear `BT..ET` PDF parser with scoped 1B/2B `/ToUnicode` CMaps + `TJ` (`<= -110`) spacing (`8/8` PMC PDFs clean) | External/unmapped CIDFonts still fall back to visual rasterization |
| **Dedupe & Manifest** | SHA-256 exact hash + 3-gram Jaccard ($\ge 0.85$: `5 -> 4` unique in `0.240 ms`); immutable `manifest.json` (`sha256` prefix `2de7618c79d41782`) | Tested per shard in memory rather than distributed TB-scale storage |
| **Multi-Axis Customer Gate** | Independent `safe`, `useful`, `topic` logistic heads + LTT (`100` customer labels $\to$ `300` test: `90.7%` gold retained, `11.7%` abstain, `0.0%` unsafe leak) | Conditional LTT at $\alpha=0.01, \delta=0.05$ requires $n_{\text{cal,unsafe}} \ge 299$ (`196` unsafe cal items hit fail-closed floor) |
| **Zero-Egress Runtime** | `verisieve_dl.wasm` audited (`0` host imports); C99 & JS parity verified | Process cold-start favors C99/Node+WASM, while warm matrix compute favors Python+NumPy BLAS |

---

## Live 1,207-Document Benchmark Summary

All numbers below are computed directly by `npm run bench:scale` (`results/scale-and-paradigm-benchmark.json`, SVG SHA-256 byte-identical across passes) across ICDAR FUNSD (`199` scans / `30,595` bboxes), `ai4privacy-200k` (`500` synthetic records), PubMedQA (`500` clinical abstracts), and PMC Full-Text (`8` born-digital clinical PDFs).

### 1. PDF CMap + FUNSD 2D Geometric Tiling
- **PMC Clinical PDFs (`8/8` Clean)**: Scoped `/ToUnicode` CMap tables + negative-kerning `TJ` (`<= -110`) space reconstruction recover `8,134` readable lines (`55,099` words) in `111.86 ms` total (`13.98 ms` avg).
- **FUNSD Geometric Survival (`199` forms, `30,595` boxes $\ge 8{\times}4$\,px)**:
  - `stock_capped_8`: `5.2%` (`1,592`)
  - `untiled_512`: `20.53%` (`6,281`)
  - `horizontal_1d_band`: `71.29%` (`21,811`)
  - `tile_2d_zero_overlap`: `92.44%` (`28,283`, `4.94%` seam cut loss)
  - **`tile_2d` (32px overlap, stride 480)**: **`97.38%` (`29,793`)** in `3.43 ms` geometry scan (excludes external neural OCR recognizer accuracy).

### 2. PII Disambiguation & Honest Regex Ceiling
- **`ai4privacy-200k` (`500` synthetic span records)**:
  - Core contact/card/IPv4: **`97.1%`** (`136/140`)
  - Targeted 8 patterns: **`73.1%`** (`185/253`)
  - All 26 structured token types: **`42.1%`** (`244/580`)
  - Bare unprefixed international names: **`49.6%`** (`118/238`, honest regex ceiling)
- **PubMedQA False-Positive Protection (`250/250` split, pre-committed `334`-word lexicon)**:
  - Train split (`62,620` words): `44.4%` -> `22.8%` docs (`5.29 -> 1.66` hits/1k words)
  - Blind test split (`63,739` words): `45.2%` -> `26.0%` docs (`5.46 -> 2.01` hits/1k words, **`2.72x` fewer false positives**)
  - Lookalike lines (`n=5`): `80.0%` -> `20.0%` false-positive rate

### 3. Single-Scorer Conformal LTT & Customer Multi-Axis Gate
Stratified split (`n_train=606`, `n_cal=301` [`196` unsafe], `n_test=300` [`196` unsafe, `104` safe], $\delta=0.05$) on the exact same 520-dim logistic scorer with fixed lower floor $\tau_{\text{drop}} = 0.25$:

| Budget / Policy | $\tau_{\text{keep}}$ | Cond FPR | Joint Risk | Safe Yield | Abstain | Status ($\delta=0.05$) |
|---|---:|---:|---:|---:|---:|---|
| $\alpha = 0.20$ | `0.28` | `14.8%` | `9.67%` | `94.23%` | `1.33%` | Certified Cond & Joint |
| **Uncalibrated** | `0.50` | `4.08%` | `2.67%` | `88.46%` | `0.00%` | Uncontrolled (fails $\alpha \le 0.02$) |
| $\alpha = 0.10$ | `0.52` | `4.08%` | `2.67%` | `86.54%` | `11.00%` | Certified Cond & Joint |
| $\alpha = 0.05$ | `0.58` | `2.55%` | `1.67%` | `83.65%` | `13.00%` | Certified Cond & Joint |
| $\alpha = 0.02$ | `0.64` | `1.02%` | `0.67%` | `78.85%` | `15.67%` | Certified Cond & Joint |
| $\alpha = 0.01$ | `1.00` | `0.00%` | `0.00%` | `0.00%` | `43.67%` | Joint Valid / Cond Fail-Closed ($196 < 299$) |

- **Within-domain PubMedQA (`n=124`)**: Contact regex achieves `100.0%` on injected email/phone cases vs. `88.7%` 520-dim linear gate and `52.4%` naive any-PII regex; multi-axis customer supervision (`100` labels $\to$ `300` test) shows why learned gating matters: `safe` (`91.3% R / 98.6% P`), `useful` (`100% R / 93.0% P`), `topic` (`100% R / 96.2% P`), conjunction `68` kept (`90.7%` gold), `35` abstained (`11.7%`), `0.0%` unsafe leak.

### 4. 7-Trial Interleaved Substrates & Held-Out Ablation
Means of 7 interleaved OS process spawns scoring `1,207 x 520` rows on Intel Core i7-12700H / Windows 11:
- **Single-Header C99 (`12.4 KB`)**: `8.35 ms` spawn | `6.07 MB` RSS | `0.380 ms` hot loop
- **Node.js + WASM (`60.1 KB`)**: `54.63 ms` spawn (`1.352 ms` warm WASM init) | `51.21 MB` RSS | `0.481 ms` hot loop (**`132.5x` faster spawn & `8.4x` lower RSS** than PyTorch+DuckDB)
- **Python 3.12 + NumPy 2.4.3**: `232.51 ms` spawn (`117.17 ms` import) | `31.44 MB` RSS | **`0.085 ms` BLAS hot loop (warm compute winner)**
- **Python 3.12 + PyTorch 2.10 + DuckDB 1.5.5**: `7,237.8 ms` spawn (`6,342.48 ms` import) | `432.6 MB` RSS | `16.83 ms` hot loop

On held-out `n_test = 300` across `N_train in {100, 300, 606}`: Gate BCE drops `27.7%` (`0.3133 -> 0.2678 -> 0.2266`, `93.3%` Acc vs. `67.3%` Naive Regex / `34.7%` Raw), WASM VeRA BCE (`mle_dl_vera_loss_grad`) drops `0.6869 -> 0.6214 -> 0.5529`, contact PII leak stays $\le 0.93\%$, and 64-dim Needle R@5 (`125` PubMedQA Q->Body queries) preserves `60.0%` parity (`60.0%` raw, `60.8%` regex).

---

## Verification & Quickstart

```bash
# Run full test suite (52 unit checks + 6 MCP JSON-RPC checks)
npm test

# Run deterministic 1,207-document benchmark & 7-trial substrate suite
npm run bench:scale

# Compile the Technical Note PDF (paper/mlsys2027-verisieve.pdf)
cd paper && pdflatex mlsys2027-verisieve && bibtex mlsys2027-verisieve && pdflatex mlsys2027-verisieve && pdflatex mlsys2027-verisieve
```

For security policies and air-gapped design guarantees, see [SECURITY.md](SECURITY.md).
