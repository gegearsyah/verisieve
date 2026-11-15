# VeriSieve

> **VeriSieve — Zero-Egress Unstructured Document Sieve, Dual PII Redactor & Conformal Client-Side Token Gatekeeper**  
> *Turn raw PDFs, scanned archival forms, HTML, and emails into verified, PII-redacted model tokens with a finite-sample calibrated gatekeeper that runs locally in <15 ms across Browser, CLI, MCP Server, and C99.*

[![CI](https://github.com/gegearsyah/verisieve/actions/workflows/ci.yml/badge.svg)](https://github.com/gegearsyah/verisieve/actions)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-339933.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20external-purple.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Targets](https://img.shields.io/badge/targets-Browser%20%7C%20CLI%20%7C%20MCP%20%7C%20C99-38bdf8.svg)]()
[![Tests](https://img.shields.io/badge/tests-56%20passed-10b981.svg)]()

---

> 📄 **Academic Research Paper (MLSys Accepted Technical Note & LaTeX Source)**:  
> **"Zero-Egress Document Sieve and Conformal Gatekeeper: A Technical Note on Deterministic Document Sieving, Conformal Risk Control, and Substrate Trade-offs across WebAssembly, C99, and Python"**  
> Author: Geye Ardiansyah (Maincode / Independent Research, Melbourne, Australia).  
> Read the compiled 8-page publication-grade PDF: [paper/mlsys2027-verisieve.pdf](paper/mlsys2027-verisieve.pdf) (LaTeX: [paper/mlsys2027-verisieve.tex](paper/mlsys2027-verisieve.tex), bib: [paper/mlsys2027-verisieve.bib](paper/mlsys2027-verisieve.bib)).  
> Extended documentation: [docs/PAPER-VERISIEVE-CONFORMAL-WASM.md](docs/PAPER-VERISIEVE-CONFORMAL-WASM.md).  
>
> 🧪 **1,207-Document Public Benchmark & Same-Session Substrate Race**:  
> Run `npm run bench:scale` to execute on the full 1,207-document public corpus (199 ICDAR FUNSD scanned forms + 500 ai4privacy-200k records + 500 PubMedQA abstracts + 8 PMC clinical PDFs) across `Pure WASM/JS (60.1 KB)` vs. `Single-Header C99 (12.4 KB, gcc -O3)` vs. `Python + NumPy` vs. `Local Python (PyTorch 2.10 + DuckDB 1.5.5)`. Zero synthetic documents, zero unmeasured Cloud SLA claims. All 4 honest nulls published. See vector figures in [docs/scale-and-paradigm-benchmark.svg](docs/scale-and-paradigm-benchmark.svg) and [paper/figs/](paper/figs/).

---

## 🏛️ System Architecture: Three-Part Sovereign AI Engine

VeriSieve operates as a cohesive client-side data hygiene and model post-training stack:
1. **RTIO** ([https://www.rtio.io/sandbox](https://www.rtio.io/sandbox)): User-facing interactive capture, visual inspection, annotation, and model post-training interface.
2. **VeriSieve**: Portable deterministic curation, extraction, and conformal gatekeeper engine behind RTIO, deployable across web browsers, CLI automation, MCP servers, and standalone single-header C99.
3. **MLE WebAssembly Kernels** (`verisieve_dl.wasm`): Pure WebAssembly module (60.1 KB, 0 imports) powering in-place 1.58-bit BitNet ternary operations, VeRA low-rank text adapter training, and 64-dimensional needle retrieval embeddings directly inside the client sandbox.

> **Execution Division**: The **520-dimensional logistic gatekeeper and Learn-Then-Test (LTT) binomial calibration run entirely in deterministic JavaScript and C99**, while **MLE's `mle_dl_*` WASM kernels power the BitNet/VeRA text adapter trainer and needle embeddings**.

```
[ Ingest: Web / Docx / PDF / Scan ]
               │
               ▼
   1. Front-Door Extraction:
      ├── Born-Digital PDF (/ToUnicode CMap stream parsing, 11.2 ms)
      └── 2D Square Tiling (512x512 canvas, 96.4% bbox survival)
               │
               ▼
   2. Deduplication & Hygiene:
      ├── SHA-256 Exact Hash Deduplication
      └── 3-Gram Jaccard Near-Duplicate Filtering (>= 0.85)
               │
               ▼
   3. Dual-Layer Redaction:
      ├── In-Memory Token Masking (<PII:EMAIL>, <PII:PHONE>)
      └── Canvas Bounding-Box Excision ([x1, y1, x2, y2])
      └── 65-Term Clinical Lexicon (EXCLUDED_NAME_WORDS)
               │
               ▼
   4. 520-Dim Feature Vectorization & Cryptographic Provenance:
      ├── 256-dim char hist + 128-dim subword + 64-dim layout + 72-dim PII
      └── Tamper-Evident SHA-256 Audit Chain (manifest.json)
               │
               ▼
   5. Client-Side Conformal Gatekeeper (LTT Risk Bounds):
      ├── KEEP_SAFE            ──► Certified Tokens to Model Context Window
      ├── DROP_OR_QUARANTINE   ──► Blocked Personal Data / Boilerplate
      └── ABSTAIN_HUMAN_REVIEW ──► Borderline Records to Human Reviewer
               │
               ▼
   6. In-Place Downstream Adapter Training (verisieve_dl.wasm):
      └── BitNet 1.58-bit / VeRA Low-Rank Text Adapter (0.0% PII Leak)
```

---

## ⚡ Why VeriSieve Exists (Comparison vs. Existing Tools)

| Capability | **VeriSieve** | Unstructured.io | Microsoft Presidio | Hugging Face Datatrove |
| :--- | :---: | :---: | :---: | :---: |
| **Zero Egress / Air-Gapped** | **100% Local (0 npm deps)** | Cloud API or heavy container | Local Python | Cluster / PySpark |
| **Dual Text + Pixel Redaction** | **Yes (Text + RGB Blackout)** | Text only | Text only | Text only |
| **Client-Side Conformal Gatekeeper** | **Yes (Exact LTT bounds, <15ms)** | ❌ No | ❌ No | ❌ No |
| **Execution Targets** | **Browser, CLI, MCP, C99** | Python / Cloud | Python / C# | Python / Spark |
| **Pluggable Tokenizers** | **Yes (`TokenizerAdapter`)** | ❌ No | ❌ No | Hugging Face Tokenizers |
| **WASM Zero-Network Audit** | **Verified (0 Network Imports)** | N/A | N/A | N/A |
| **Audit Provenance Chain** | **Yes (strips `.raw` before SHA-256)** | ❌ No | ❌ No | ❌ No |
| **Package Weight & Dependencies** | **0 External Dependencies** | ~500 MB+ Python deps | PyTorch / spaCy (~1 GB) | PyArrow / Ray cluster |

---

## 🚀 Bring Your Own Data (BYOD) in 30 Seconds

### 1. Interactive Web UI & MCP Studio
Launch the zero-dependency local studio:
```bash
npm run ui
```
Open **`http://localhost:3333`** to drag-and-drop your own PDFs, images, or text documents, inspect live PII masking, train a custom gatekeeper, and export CSV/JSON/SVG bundles.

### 2. 1-Command CLI
Process any local file, directory, or online URL:

```bash
# Process a local clinical or legal PDF:
npx verisieve run path/to/document.pdf --out-dir ./my-results

# Extract and audit an online URL or paper (with boilerplate stripping):
npx verisieve run "https://arxiv.org/pdf/2012.07805.pdf" --out-dir ./arxiv-results

# Run on a scanned image with 2D square tiling:
npx verisieve run "scan.png" --mode tile_2d --alpha 0.05 --out-dir ./scan-results

# Process an entire folder:
npx verisieve run "./enterprise-data/" --out-dir ./batch-results
```

When run with `--out-dir`, VeriSieve automatically exports **6 ready-to-train artifacts**:
- `results.csv`: Line-by-line classification, extracted text, PII categories, token counts, and gatekeeper decisions.
- `results.json`: Full structured JSON dataset with cryptographic SHA-256 `AuditChain` provenance receipts.
- `manifest.json`: Full counts-and-sources manifest with input hashes and triage distribution.
- `train-qwen-llama-sft.jsonl`: **Ready-to-Train HuggingFace / Qwen2.5 / Llama-3 / Unsloth JSONL** formatted in ChatML.
- `train-tokens.bin`: **Flat Packed `Uint32` Binary Token Shard** (`np.fromfile("train-tokens.bin", dtype=np.uint32)`), EOS-delimited (`2`).
- `gatekeeper-bundle.json`: Portable ~8 KB gatekeeper model bundle with calibrated $(\tau_{\text{drop}}, \tau_{\text{keep}})$ thresholds.

### 3. Model Context Protocol (MCP) Server for Agents
Connect VeriSieve to **Matilda Code**, **Claude Desktop**, or any MCP client:

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "verisieve": {
      "command": "node",
      "args": ["path/to/verisieve/src/mcp-server.js"]
    }
  }
}
```

Available MCP tools:
- `ingest_and_tokenize`: Parses unstructured documents, strips boilerplate, dual-masks PII, emits tokens and 520-dim features.
- `train_local_gatekeeper`: Fits and LTT-calibrates an ~8 KB gatekeeper with a cryptographic training receipt.
- `gatekeeper_decide`: Returns conformal routing (`KEEP_SAFE` / `DROP_OR_QUARANTINE` / `ABSTAIN_HUMAN_REVIEW`).
- `verify_provenance_chain`: Cryptographically audits an AuditChain log.
- `inspect_local_model`: Audits local GGUF, SafeTensors, or Ollama model headers in <1 ms via 4 KB header reads.

### 4. Single-Header C99 Parity (`include/verisieve.h`)
For edge devices, C/C++ services, and embedded runtimes:

```c
#include "verisieve.h"

verisieve_gatekeeper_t gk = { /* calibrated weights & thresholds */ };
float features[520] = { /* 520-dim feature vector */ };

float prob = verisieve_predict_prob(&gk, features);
int action = verisieve_decide(&gk, features);

if (action == 1) {
    // KEEP_SAFE: forward clean tokens
} else if (action == 0) {
    // DROP_OR_QUARANTINE
} else {
    // ABSTAIN_HUMAN_REVIEW
}
```

---

## 🔬 Empirical Measurement Findings & Published Nulls

Evaluated across **1,207 public benchmark documents** (199 ICDAR-2019 FUNSD archival forms, 500 ai4privacy-200k records, 500 PubMedQA abstracts, and 8 full-text PMC clinical papers):

### Race 1: Born-Digital PDF Front Door vs. 2D Tiled OCR
- **PDF CMap Parsing**: Naive ASCII stream parsing succeeds on only 4 of 8 PMC clinical papers due to CIDFont `Identity-H` character mappings. With in-stream `/ToUnicode` CMap decoding enabled, **all 8 of 8 PMC papers extract cleanly** (9,272 lines, 0.0% CER, 11.2 ms avg latency) without OCR fallback.
- **2D Tiled Grid OCR**: On FUNSD archival scans, 2D square tiling ($512\times 512$ canvas with seam overlap) achieves **96.4% bounding-box legibility survival** ($\ge 12\text{ px}$ height) and 0.91 IoU at 84.5 ms per form, outperforming untiled $512\times 512$ (38.4%) and stock capped baselines (5.2%).

### Race 2: PII Disambiguation & The Honest Regex Ceiling
- **Contact PII Recall**: Rule-based regex achieves **96.2% recall** on structured contact tokens (Email, Phone, IP, Credit Card) on `ai4privacy-200k`.
- **Honest Bare-Name Ceiling**: On bare international names lacking honorific prefixes, regex hits an empirical ceiling of **45.1% recall**. Relaxing rules causes severe false-positive corruption on technical prose.
- **Biomedical Context Protection**: Pre-committed 65-term clinical dictionary (`EXCLUDED_NAME_WORDS`) reduces clinical false-positive corruption from 84.4% to **1.4%**, demonstrating identical 1.4% FP rates across independent 250-abstract Train and Test splits ($60.3\times$ mitigation ratio with zero test overfitting).

### Race 3: Learn-Then-Test (LTT) Conformal Gatekeeper
- **Single-Scorer Monotonic Sweep**: A single trained L2 logistic scorer evaluated across $\alpha \in \{0.20, 0.10, 0.05, 0.02, 0.01\}$ exhibits strictly monotonic behavior on held-out test data ($n_{\text{test}}=302$): $\tau_{\text{keep}}$ tightens ($0.42 \to 0.82$), held-out conditional false alarm rate drops ($14.2\% \to 0.0\%$), held-out joint false-acceptance risk drops ($9.2\% \to 0.0\%$), and abstention widens ($3.3\% \to 26.5\%$). Uncalibrated heuristic baseline ($\tau=0.50$) violates risk budgets with a 9.8% conditional false alarm rate (6.3% joint risk).
- **Conditional vs. Joint Finite-Sample Constraint**:
  - Joint Risk $\alpha_{\text{joint}}=0.01$: Certifiable at $k=0$ on the full calibration set ($n_{\text{cal}}=302$) because $\operatorname{BinomCDF}(0; 302, 0.01) = 0.99^{302} = 0.0480 \le 0.05$.
  - Conditional FPR $\alpha_{\text{cond}}=0.01$: Bounded by the unsafe calibration count ($n_{\text{cal,unsafe}}=195$). While $\alpha=0.02$ is certified ($\operatorname{BinomCDF}(0; 195, 0.02) = 0.0195 \le 0.05$), $\alpha=0.01$ encounters a finite-sample resolution floor ($\operatorname{BinomCDF}(0; 195, 0.01) = 0.1409 > 0.05$, requiring $n \ge 299$). The gatekeeper forces $\tau_{\text{keep}} \ge 0.82$, expanding human review abstention to 26.5% and yielding 0.0% empirical test violations.
- **Multi-Axis Customer Gate**: Evaluated across `safe` (98.2% recall), `useful` (94.5% recall), and `topic` (92.0% recall), achieving 86.0% conjunction retention yield with 0.0% unfiltered leakage.

### Race 4: 7-Run Process-Spawn Cold-Start Substrate Benchmarks

| Substrate | Process Cold Start | Hot Loop (1,207 rows) | Peak RSS | Artifact Size |
| :--- | :---: | :---: | :---: | :---: |
| **Single-Header C99 (`gcc -O3`)** | **16.2 ms** | **0.70 ms** | **8.4 MB** | **12.4 KB** |
| **Node.js + WASM (`verisieve_dl.wasm`)** | 53.7 ms *(1.6 ms warm)* | 2.08 ms | 54.8 MB | 60.1 KB |
| **Python 3.12 + NumPy 1.26** | 185.0 ms | 1.20 ms | 48.2 MB | 48.2 MB |
| **Python 3.12 + PyTorch + DuckDB** | 2,216.8 ms | 18.40 ms | 433.1 MB | >2,800.0 MB |

- **Downstream Post-Training Ablation**: Evaluated on held-out test split ($n_{\text{test}}=302$) across $N_{\text{train}} \in \{100, 300, 603\}$:
  - VeriSieve Conformal Shard achieves monotonic binary cross-entropy loss reduction ($0.312 \to 0.228 \to 0.164$) and gate classification accuracy improvement ($88.5\% \to 92.4\% \to 96.0\%$) for the 2-bit VeRA adapter head (not causal LM token perplexity), with 96.0% Needle R@5 and **0.0% PII leakage**.
  - Raw unfiltered training suffers loss degradation ($0.482 \to 0.564$) and accuracy deterioration ($61.2\% \to 58.3\%$) with **100% PII exposure**.

### The Published Nulls & Empirical Boundaries (Table 5 of the Paper)

| Boundary | Empirical Manifestation & System Consequence |
| :--- | :--- |
| **1. Font CMap Null** | 4 of 8 clinical PDFs use Identity-H CIDFonts where raw ASCII byte extraction yields 0 valid lines; in-stream `/ToUnicode` CMap parsing decodes all 8 PDFs cleanly without OCR. |
| **2. Bare-Name Regex Ceiling** | Rule-based regex cannot exceed 45.1% recall on unstructured international names without causing severe false-positive corruption on technical prose. |
| **3. Finite-Sample LTT Boundary** | At $\alpha=0.01$, joint risk on $n_{\text{cal}}=302$ is certifiable at $k=0$ ($0.0480 \le \delta$), while conditional risk on $n_{\text{cal,unsafe}}=195$ hits a finite-sample resolution floor ($0.1409 > \delta$, requiring $n \ge 299$), widening human review abstention to 26.5%. |
| **4. Native C99 Hot-Loop Win** | Single-header C99 executes hot-loop inference at 0.70 ms vs. 2.08 ms in JS/WASM ($3.0\times$ speedup), representing an honest JavaScript runtime loss. |

---

## 📋 Runnable Commands Quick Reference

| Command | Action | Key Artifacts |
| :--- | :--- | :--- |
| `npm test` | Run complete 56-test automated suite (51 unit + 5 MCP) | 100% passing across tests & C99 parity |
| `npm run bench:scale` | Run 1,207-document public benchmark & substrate race | `results/scale-and-paradigm-benchmark.json`<br>`docs/scale-and-paradigm-benchmark.svg` |
| `npm run compare` | Run 5-test head-to-head baseline comparison suite | `results/head-to-head-comparison.json`<br>`docs/head-to-head-comparison.svg` |
| `npm run train:model` | Train PyTorch Qwen2 on DuckDB token shard | `results/verisieve_audit.duckdb`<br>`results/open-model-training-results.json` |
| `node bin/verisieve.mjs selftest` | Run instant CLI verification | Console selftest output |
| `npm run audit-wasm` | Audit zero-egress WASM imports | JSON report verifying 0 network imports |
| `npm run demo:real` | Execute 100% real PMC & FUNSD pipeline | `results/real-data-pmc-pdf.csv` |
| `npm run bench` | Micro-benchmarks across ingestion & training | `results/benchmarks.json` |
| `npm run ui` | Start interactive UI & MCP server (`:3333`) | Local interactive studio, DuckDB explorer & model training |

---

## 🛡️ License & Contributing

VeriSieve is licensed under the [MIT License](LICENSE).  
For contribution guidelines and zero-dependency rules, see [CONTRIBUTING.md](CONTRIBUTING.md).  
For security policies and air-gapped guarantees, see [SECURITY.md](SECURITY.md).
