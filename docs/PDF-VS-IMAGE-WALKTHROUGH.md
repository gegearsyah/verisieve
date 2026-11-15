# End-to-End PDF vs. Exported Image Pipeline & Trained Gatekeeper Walkthrough

This document presents the complete architectural audit and verification report for the **PDF vs. Exported Image -> CSV/JSON -> Hidden PII -> Tokens -> Trained Gatekeeper** pipeline in Matilda Portable.

## Visual Architecture & Comparison

![PDF vs Image Pipeline Comparison](./pdf-vs-image-pipeline-comparison.svg)

---

## Stage-by-Stage Pipeline Specifications

| Stage | Input Artifacts | Processing Mechanics | Output Data Shape | Verification Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1: Input Ingestion** | `results/sample-research-report.pdf`, `sample-research-page-raw.png`, `sample-research-page-bad-scan.png` | Born-digital PDF 1.4 stream vs. 1024x1440 RGB page rendering vs. Bad Scan (skew 2.2°, noise 32, quant 20) | Buffer objects & raw RGB pixel arrays | Valid `%PDF-1.4` header, `%%EOF`, valid PNG signature |
| **Stage 2: Extraction** | PDF stream & image pixel buffers | `extractPdfTextLayer` (Tj regex) vs. `tileAndRead(..., 'tile_2d')` (glyph cross-correlation) | Structured line records with bboxes, CER, confidence | All 21 lines recovered; untiled 512 cap drops to 8 lines |
| **Stage 3: Hidden PII Redaction** | Extracted lines & RGB buffer | Scan raw text via `PII_PATTERNS`, partial masking preview, dual RGB blackout to `[18, 18, 22]` | Redacted text (`<PII:*>`) & `sample-research-page-redacted.png` | All 8 PII categories detected; zero raw secrets in `masked_text` |
| **Stage 4: Tokenization & Features** | Redacted line text | Word/byte BPE tokenizer into token IDs; 520-dim feature vectorization (unigram/bigram/4-gram + quality features) | `tokenCount > 0`, `first_8_token_ids`, `Float32Array(520)` | Token IDs > 0 on every row; L2-normalized 520 features |
| **Stage 5: Trained Gatekeeper** | 520-dim feature vectors & labels | Client-side logistic regression + LTT conformal risk calibration (`alpha=0.05`, `tauKeep=0.50`, `tauDrop=0.25`) | Action: `KEEP_SAFE`, `DROP_OR_QUARANTINE`, or `ABSTAIN_HUMAN_REVIEW` | Mean safe prob > mean drop prob; bad scan shifts to abstention |

---

## 4 Ingestion Tiers Compared

1. **Path 1 — Born-Digital PDF (`results/pipeline-pdf-born-digital.csv`)**:
   - Parses `results/sample-research-report.pdf` directly from binary content streams using regex on `Tj` string literals.
   - 100% character recovery with zero optical distortion.
   - PII categories scanned on raw text, producing partial previews (`ad***@matilda-maincode.au`, `***-**-6789`) before token masking.

2. **Path 2 — Clean Exported Image -> 2D-Tiled OCR (`results/pipeline-image-ocr.csv`)**:
   - Renders 1024x1440 RGB bitmap and evaluates 2D tiling (`512x512` tiles with 64px overlap).
   - Character cross-correlation recovers all lines with low CER.
   - Bounding boxes of all detected PII are blacked out to `[18, 18, 22]` in `results/sample-research-page-redacted.png`.

3. **Path 3 — Bad Fax / Photocopy Torture Scan (`results/pipeline-bad-ocr-benchmark.csv`)**:
   - Applies skew (2.2°), Gaussian sensor noise (std 32), and JPEG block quantization (20).
   - Generates `results/sample-research-page-bad-scan.png`.
   - Measured Character Error Rate climbs to ~47%, degrading OCR confidence to 0.40–0.60.
   - Low confidence and corrupted n-grams move predictions into the abstention region, triggering `ABSTAIN_HUMAN_REVIEW`.

4. **Path 4 — Untiled 512px OCR Cap**:
   - Constrained single-pass reading downscales the canvas by `scaleFactor = 0.3556` and enforces `maxReadsCap = 8`.
   - Fails to recover lines past line index 7, illustrating why 2D tiling is essential for full document recall.

---

## Real PMC Research & Archival Benchmark Sources

- **PMC Clinical Research Paper**: Real clinical sentences extracted from PubMed Central paper `PMC5773420` (*Effects of Nutritional Status on 6-Month Outcome in Elderly Hip Fracture Patients*, Ka Ying Doris Miu et al.) via `node:zlib` `inflateSync` decompression of `/FlateDecode` streams.
- **Archival Form Benchmark**: Hugging Face FUNSD benchmark sample loaded and stored to `results/untrusted-benchmarks/funsd-sample.json` (with local PMC `goubar_2021_PMC7611209.pdf` fallback for offline environments).

---

## Verification & Two-Pass Determinism

Running `node scripts/run-pdf-vs-image-demo.mjs` executes with complete determinism:
- Seeded pseudo-random number generator (`mulberry32`)
- Fixed timestamp (`2026-11-15T00:00:00.000Z`)
- Fixed model training seed (`seed: 42`)
- Identical SHA-256 digests across successive runs.
