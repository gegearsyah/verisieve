# Four Issues We Hit Running Mirage on Documents (and Reproducible Workarounds)

---

## 1. Verifying Zero Network Egress on `cactus.wasm` vs. Python Wrapper Telemetry

### The Issue
When integrating WASM binaries into offline air-gapped clinical or financial environments, security auditors require absolute cryptographic proof that no telemetry or document content egresses over the network. Some third-party wrappers or SDKs bundle background telemetry pings (e.g., Supabase or S3 metric logging).

### Reproducible Workaround
1. Audit the compiled binary directly in Node.js using built-in WebAssembly introspection:
   ```bash
   node bin/matilda-portable.mjs audit-wasm
   ```
   This computes the cryptographic SHA-256 (`2de0a4459ed427c258157fcb6128265f72f405e7464b25d713bbd336b15bcacf`), inspects `WebAssembly.Module.imports()`, and confirms `networkImportCount === 0`.
2. If utilizing the Python runtime wrapper, explicitly set the environment variable:
   ```bash
   export CACTUS_TELEMETRY=0
   ```
   This disables any upstream metadata ping and locks execution strictly offline.

---

## 2. Square `512x512` Detector Canvas Geometry & Why 1D Horizontal Bands Aren't Enough

### The Issue
Standard vision-language models and OCR detectors expect fixed-size square inputs (typically `512x512` pixels). When processing high-resolution scanned documents (e.g., $1024 \times 1440$ or A4 $1500 \times 2100$), forcing a single untiled canvas downscale results in a severe scale factor $s = 512 / \max(W, H) \approx 0.35\times$, causing small fonts and punctuation to blur into illegibility.

### Reproducible Workaround
- **Why 1D Horizontal Bands Fail**: Slicing documents into full-width horizontal bands ($W \times 512$) still forces horizontal downscaling by $s = 512 / W$. For a $1024\text{ px}$ wide page, $s = 0.50\times$; for an A4 page ($1500\text{ px}$), $s = 0.34\times$. In our multi-font benchmark, 1D bands achieve 100% line recall but still suffer 47.7% mean CER under scan degradation due to horizontal compression.
- **The 2D Tiling Solution**: Matilda Portable implements a 2D overlapping square tile grid ($512 \times 512$ with $64\text{ px}$ overlap, 15 passes), keeping native unscaled resolution ($s = 1.0\times$) on every tile. It achieves 100.0% line recall, 100.0% PII recall, and the lowest degraded CER (40.5% vs. 83.5% untiled and 47.7% 1D band), avoiding stroke blurring on small fonts (`monospace`, `italic`). Overlapping detections are merged via 2D bounding-box IoU and Levenshtein similarity stitching.

---

## 3. Inline Form Grammar Control Characters (`;|=#@$*`)

### The Issue
Underlying grammar compilers and LLM constrained-decoding layers often reserve characters such as `;`, `|`, `=`, `#`, `@`, `$`, and `*` as grammar control operators (e.g., alternative delimiters, rule assignments, or regex anchors). Passing unescaped dynamic choice strings or user input containing these characters causes syntax parsing exceptions in constrained generation.

### Reproducible Workaround
Matilda Portable provides bijective sanitization functions (`sanitizeMirageFormSchema` and `restoreMirageFormOutput`) in `src/ocr-engine.js`:
- Automatically detects and replaces forbidden grammar control tokens with safe placeholders (`__MIRAGE_SAN_N__`) or hex-escapes (`\\xNN`) prior to inference.
- Restores original raw strings losslessly upon output parsing.

---

## 4. Uncalibrated Heuristic Confidence & LTT Conformal Abstention

### The Issue
Raw confidence scores output by OCR or classification models are notoriously uncalibrated and overconfident, leading to silent PII leaks or false-positive quarantines.

### Reproducible Workaround
We wrap heuristic scores in **Learn-Then-Test (LTT) Conformal Calibration** using exact binomial bounds (`binomCdf`). If uncertainty exceeds target error bounds $\alpha$, the system abstains from automated routing and escalates to human review (`ABSTAIN_HUMAN_REVIEW`), guaranteeing valid finite-sample error control under exchangeability assumptions.
