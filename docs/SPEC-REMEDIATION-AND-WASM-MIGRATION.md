# [Spec #15] End-to-End Remediation, Cross-Repo WASM Sync, Fail-Closed Guarantees & Zero-Dependency Migration

> **Status**: Published as [`gegearsyah/verisieve#15`](https://github.com/gegearsyah/verisieve/issues/15) (Option B · 5 Testing Seams · Child Tickets `#16`–`#24` labelled `ready-for-agent`)  
> **Architecture Lock**: **Option B — Zero-Import Pure Rust Core WASM + Zero-Telemetry `cactus.wasm` (2D Tiling + Local `mirage.cact` Weights)**
> **Scope**: Full codebase remediation (`HEAD` `fe73401`), cross-repo alignment (`matilda-portable` ↔ `Rtio` ↔ `MLE/core-dl`), and static WABT / local binary-inspection migration breakdown (`tesseract.js` / `tesseract-core-lstm`, `pdfjs-dist`, `@duckdb/duckdb-wasm`, `verisieve_clean.wasm`, `verisieve_dl.wasm`, and `cactus.wasm`).  
> **Non-Goal Exclusion**: `paper/mlsys2027-verisieve.tex` is explicitly excluded from code/doc edits under this spec.

---

## Problem Statement

VeriSieve (`matilda-portable`) passes its existing 58 automated tests while hiding critical silent fallbacks, stubs, fabricated metrics, privacy leaks, browser UI bugs, unverified WASM binaries, and cross-repo drift across `matilda-portable`, `Rtio`, and `MLE`:

1. **Silent Fake Data Substitution on Real Documents**: Raster images (`.png`/`.bmp`) return placeholder strings (`[IMAGE OCR EXTRACTED ...]`); scanned or complex PDFs (missing uncompressed literal `BT..ET` streams, or using `/ObjStm`, `/ASCII85Decode`, filter arrays, or image-only scans) yield empty text and silently substitute three hardcoded PMC clinical sentences; unreachable URLs silently substitute local benchmark paths; and the browser UI falls back to canned Wong Tai Sin / FUNSD text on upload failure, camera error, and A/B chat.
2. **Broken `.docx`, URL & PDF Extractors**: `.docx` archives created with bit-3 ZIP Data Descriptors (`compressedSize === 0` in local headers) fail decompression and `.docx` is unwired from unified path ingestion; HTML/URL responses omit `cleanText` for MCP callers and lack SSRF protections (blocking loopback, RFC1918, CGNAT, and cloud IMDS endpoints); PDF extraction drops `< 8`-char lines and global duplicates prematurely and mis-parses scoped `/ToUnicode` CMaps.
3. **Rule-Breaking Third-Party Bloat vs. Physical Limits of `#![no_std]` WASM**: `CONTRIBUTING.md` enforces zero runtime `dependencies` in `package.json`, zero network egress, and explicitly rejects heavyweight external runtimes such as headless Tesseract. Yet `Rtio` installed `pdfjs-dist`, `tesseract.js` (`v7.0.0`, 9 runtime deps, CDN defaults), and `@tesseract.js-data/eng` (`19.4 MB` / `18.51 MB` synced assets; `tesseract-core-lstm.wasm` alone is `2,855,361` B with `3,457` functions and `45` host imports), while `@duckdb/duckdb-wasm` (`34,242,586` B EH binary, `405` host imports) far exceeds compact auditable WASM kernels. Conversely, pure zero-import `#![no_std]` Rust WASM without external neural weights **cannot** physically perform OCR on arbitrary photographs or image-only scans.
4. **Cross-Repo WASM & Source Drift**:
   - `verisieve_clean.wasm` has drifted: `matilda-portable` still ships the stale `10,465` B (`27` functions, `15` exports) build without overflow tracking, pipe-delimited PII guard, raw-text `<script>`/`<style>` tag guard, UTF-8 chunk width fix, `wasm32::unreachable()` panic handler, or JS slice `RangeError` hardening that `Rtio` already rebuilt via WSL `wasm32-unknown-unknown` (`10,860` B, `28` functions, `16` exports) — and **neither** repo yet decodes UTF-8 HTML entities `>= 0x80` or tracks JS/CSS quotes/comments inside `<script>`/`<style>`.
   - `verisieve_dl.wasm` (`60,096` B, `74` functions, `0` imports, `27` exports) is identical across `MLE/vendor/core/mle_dl.wasm`, `matilda-portable`, and `Rtio` (SHA-256 `2FF6E775...`), compiled from `MLE/core-dl/src/lib.rs` with a strict `65,536` B cap (`5,440` B headroom), but its source and build provenance are absent from `matilda-portable`.
   - `vendor/cactus/cactus.wasm` (`1,240,671` B, `954` functions, `204` data segments, `16` minified `"a"."a".."p"` imports, `21` exports `q..K`) has zero JS glue and no bundled `~22 MB` `mirage.cact` weights in git, yet `audit-wasm` treats its 16 opaque host imports as verified.
5. **Fail-Open Conformal Risk, Unverified Receipts & PII Exposure**: LTT calibration falls back to a heuristic `bestT = 0.76` (allowing negative `tauDrop`) and prints `CERTIFIED` even when insufficient calibration samples ($n_0 < 59$ at $\alpha = \delta = 0.05$) make the bound unachievable; `verifyTrainingReceipt` in `matilda-portable` does not re-hash live model `weights` and `bias` against the receipt; CSV/JSON outputs and MCP responses leak unmasked `raw_excerpt` / `textExcerpt` PII by default.
6. **Fabricated Benchmarks, WASM Curves & Parity Gaps**: WASM DL training uses `Math.sin` synthetic tensors, analytic `Math.exp(-ep / 8)` curves, and hardcoded purity/leakage numbers; `chatWithTrainedModelsWasm` emits hardcoded prose; head-to-head and scale benchmarks inject hardcoded constants and modulo labels (`(idx * 5 + 1) % 3 === 0`); JS `fnv1a` and float64 gatekeeper predictions diverge from C99 UTF-8 and float32 `verisieve.h` semantics.
7. **UI Security Bugs & Non-Portable Circular Tests**: UI server binds broadly, sets wildcard `Access-Control-Allow-Origin: *`, lacks strict `path.relative` traversal guards, serves HTML instead of `404`, and drops async MCP calls; `demo/index.html` contains a regex `SyntaxError` and unescaped `.innerHTML` sinks; tests depend on external local paths (`C:/Users/...`, `D:/Ollama/...`), assert `offline_fallback` behavior instead of fail-closed errors, and skip real C99 cross-process parity assertions.

---

## Solution

Separate **deterministic `#![no_std]` zero-import Rust WASM core kernels** (all `0` host imports, `<= 64 KiB` per module, shared across `matilda-portable`, `Rtio`, and `MLE`) from **weight-bearing neural OCR runtimes** (governed by one explicit architectural decision across Options A / B / C), while eliminating every stub, silent fallback, privacy leak, security bug, and fabricated benchmark across the repo:

1. **Unified Pure-Rust Zero-Import Core WASM Architecture (Shared Across Repos)**:
   - Sync and harden `verisieve-clean` (`rust/verisieve-clean/`) across `matilda-portable` and `Rtio` via WSL/CI `wasm32-unknown-unknown`, incorporating `Rtio`'s 5 existing fixes (`DEDUP_OVERFLOWED` + circular cursor, pipe-delimited PII guard, raw-text container tag handling, UTF-8 chunk width, `wasm32::unreachable()`) plus the remaining fixes (UTF-8 numeric HTML entities `>= 0x80`, JS/CSS quote+comment `<script>`/`<style>` parsing, strict `RangeError` / `abiVersion === 1` JS bridge).
   - Migrate deterministic ingestion, redaction, hashing, and risk control **outside** `verisieve_dl.wasm` (keeping `verisieve_dl.wasm` frozen at `60,096` / `65,536` B with synchronized `MLE/core-dl` provenance) into companion `#![no_std]` zero-import Rust WASM kernels (`verisieve-ingest`, `verisieve-pii`, `verisieve-gate`, `verisieve-sql`) — **avoiding** the Rust `regex` crate to stay compact and auditable:
     - **Born-digital PDF + `.docx` parser**: RFC 1951 pure-Rust `inflate` (`/FlateDecode`), `/ASCII85Decode`, filter arrays, PDF 1.5+ `/ObjStm` object streams, scoped 1B/2B `/ToUnicode` CMaps (Issue `#8`), coordinate `TJ` ordering, and bit-3 ZIP Data Descriptor `.docx` extraction (plus optional `quickjs-eval.wasm`-free embedded `/Image` XObject extraction).
     - **Context-aware PII scanner, 520-dim FNV-1a hasher & LTT gatekeeper**: deterministic ASCII/UTF-8 state-machine scanners + domain exclusion lists, reversible `byte-utf8-v1` tokenization, UTF-8 `fnv1a`, truthful `[512..519]` features, float32 C99 parity, and strict binomial LTT calibration (`certified: false`, `tauKeep = 1.0`, `tauDrop >= 0` when unachievable, plus cryptographic `weights + bias` receipt verification).
     - **Tabular SQL engine (`verisieve_sql`)**: compact zero-import WASM SQL engine (`SELECT`, `WHERE`, `GROUP BY`, aggregates, `ORDER BY`, `LIMIT`) paired with an honest strictly validated JS parser fallback (removing the misleading `DuckDB v1.5.5` header) and parameterized `read_csv_auto(?)` in Python DuckDB.

2. **Neural OCR Execution via Option B (Zero-Telemetry `cactus.wasm` + `mirage.cact` + 2D Tiling)**:
   - Static binary inspection confirms arbitrary image/scan OCR requires neural weights and cannot exist in weightless `#![no_std]` Rust WASM alone. Under the founder-selected **Option B**:
     - Disassemble/map all `16` `"a"."a".."p"` imports on `vendor/cactus/cactus.wasm` (`1,240,671` B, `954` functions, `22,975` `v128` SIMD ops, `21` exports `q..K`) and build a clean, zero-egress in-memory Emscripten/WASI shim module (pure memory/stderr/time/in-memory VFS — **zero** network, telemetry, or arbitrary disk access), verifying every import statically in `audit-wasm`.
     - Wire real `2D` square `512x512` overlapping tile extraction and IoU/CTC seam stitching into native PNG/BMP decoding and PDF `/Image` XObject raster buffers (`gege_ardiansyah_cv.pdf`, scanned forms, camera captures), passing tiles to `cactus.wasm` (`_cactus_load`, `_cactus_describe`, `_malloc`, `_free`) backed by an explicit local `mirage.cact` (`~22 MB` quantized checkpoint — sourced locally via `Cactus-Compute/mirage` or custom-quantized via `cactus convert`, never downloaded silently over the network at inference time).
     - Fail loudly with typed errors (`MIRAGE_WEIGHTS_REQUIRED`, `SCANNED_PDF_REQUIRES_OCR`, `IMAGE_REQUIRES_OCR_PROVIDER`) if local `.cact` weights or an override `ocrProvider` are absent — zero mock sentences or `[IMAGE OCR EXTRACTED...]` placeholders.

3. **Fail-Closed Conformal LTT, SSRF/Security Hardening, Honest Training & Portable Tests**:
   - Enforce finite-sample LTT bounds, holdout split guards, SSRF URL containment (loopback/RFC1918/IMDS/private DNS blocking on server fetchers + MCP `ingest_url_or_links`), default `raw_excerpt` / `textExcerpt` redaction, locked-down UI server (`127.0.0.1`, no `*` CORS, `path.relative`, `404`, `await /api/mcp`), `demo/index.html` script/XSS fixes, genuine per-epoch `verisieve_dl.wasm` training & real benchmarks/SVGs, and self-contained tests with live C99 parity verification.

---

## User Stories

1. As an application integrator (such as RTIO), I want `matilda-portable` and `Rtio` to share the exact same hardened, reproducible zero-import `verisieve_clean.wasm` and Rust core ABI (via WSL/CI `wasm32-unknown-unknown`), so that both repositories behave identically without WASM drift or silent slice truncation.
2. As an application integrator, I want born-digital PDFs (including PDF 1.5+ `/ObjStm`, `/FlateDecode`, `/ASCII85Decode`, filter arrays, and Type0/CID `/ToUnicode` CMaps, resolving Issue `#8`) to extract accurate coordinate-ordered text offline without third-party npm dependencies.
3. As an application integrator, I want image-only PDFs and raster images (`.png`, `.bmp`) to either execute via the explicitly chosen OCR backend (`Options A/B/C`) or fail loudly with typed errors (`SCANNED_PDF_REQUIRES_OCR`, `IMAGE_REQUIRES_OCR_PROVIDER`), so that mock PMC sentences and `[IMAGE OCR EXTRACTED...]` placeholders never leak into pipelines.
4. As a zero-egress security auditor, I want every WASM artifact audited against a single truthful rule: `0`-import `#![no_std]` kernels must have `imports.length === 0`, `verisieve_dl.wasm` must trace reproducibly to `MLE/core-dl` within its `65,536` B limit, `cactus.wasm` must report `zeroEgressVerified: false` until its 16 host imports are safely bound/verified, and unnecessary sandboxes (`quickjs-eval.wasm`) and CDN wrappers (`tesseract.js`) must stay excluded.
5. As a document pipeline user, I want `.docx` files created with bit-3 ZIP Data Descriptors (`compressedSize === 0` in local headers) and XML entities/tabs/breaks to extract reliably through both the library API and unified path ingestion with zip-bomb bounds checks.
6. As a security engineer, I want URL ingestion (UI `/api/sandbox-fetch`, `ingestor.js`, and MCP `ingest_url_or_links`) to pass `cleanText` reliably, block SSRF targets (loopback, RFC1918, CGNAT, link-local IMDS `169.254.169.254`, private DNS), and fail loudly when fetches fail instead of substituting local benchmark files.
7. As a privacy officer, I want `results.csv`, `results.json`, and MCP `gatekeeper_decide` outputs to mask or omit raw PII (`raw_excerpt_sha256` and redacted previews) by default unless explicitly opted in, so logs and exports never accidentally leak raw secrets.
8. As a statistical safety engineer, I want LTT calibration to fail closed (`certified: false`, `tauKeep = 1.0`, non-negative `tauDrop`) whenever $n_0$ is too small (e.g., $n_0 < 59$ at $\alpha = \delta = 0.05$) or no threshold satisfies `binomCdf <= delta`, reject accidental in-sample calibration on training rows, and verify live model `weights` + `bias` against `receipt.weightsSha256`.
9. As a systems engineer, I want JavaScript `fnv1a` hashing and float32 `decideGatekeeper` inference to match the C99 header bit-for-bit on UTF-8 inputs and edge thresholds across browser, Node CLI, MCP, and C99 targets.
10. As a tokenizer user, I want the default zero-dependency tokenizer to encode lossless reversible UTF-8 bytes (`byte-utf8-v1`) and populate truthful `[512..519]` features (`minConfidence`, `meanConfidence`, measured structural metrics, unpadded `tokenCount`).
11. As a PII compliance user, I want `PII_PATTERNS` stripped of hardcoded fixture literals (hospital/campus/person strings moved to opt-in domain configs) with format/Luhn validation and technical lookalike protection.
12. As a SQL explorer user, I want tabular queries to run on a compact zero-import Rust WASM SQL engine (or an honestly labeled strict JS parser rejecting unsupported syntax) plus parameterized DuckDB Python queries, replacing the broken `DuckDB v1.5.5` regex mockup.
13. As an ML engineer, I want `trainWasmSmallModel` and `chatWithTrainedModelsWasm` to drive `verisieve_dl.wasm` with real embedded document vectors per epoch, real held-out retrieval purity and PII leakage metrics, and actual retrieved context—removing all `Math.sin`, `Math.exp`, and `D:/Ollama/...` stubs.
14. As a CLI and MCP client user, I want `train`, `decide`, `ingest`, `run`, `audit-wasm`, and multi-axis MCP handlers to execute real pipelines end-to-end with binary-safe routing and honest `CERTIFIED` vs `FAIL_CLOSED_UNVERIFIED` reporting.
15. As a local UI operator and browser user, I want `ui-server.mjs` bound strictly to `127.0.0.1` without wildcard CORS, enforcing `path.relative` traversal guards, returning `404` on missing files, `await`ing `/api/mcp`, and loading `demo/index.html` cleanly with zero JS `SyntaxError`s, escaped `.innerHTML` rendering, and honest error banners.
16. As a benchmark reviewer and CI contributor, I want cold-start, head-to-head, scale, and SVG/JSON benchmarks measured live from real self-contained repo fixtures and ephemeral `127.0.0.1` servers—plus genuine cross-process C99 parity tests—without hardcoded `C:/Users/...` paths or circular test fallbacks.

---

## Implementation Decisions

### 1. Cross-Repo WASM Migration Strategy (Static WABT / Binary-Inspection Driven)

Based on direct `wasm-objdump` (WABT 1.0.42), `WebAssembly.Module`, and static AST inspection across `Rtio/node_modules`, `matilda-portable/vendor/`, and `MLE/core-dl`:

- **Migrate into Zero-Import `#![no_std]` Rust Core WASM (`imports.length === 0`, `<= 64 KiB` per module)**:
  - **Text Cleaning & Deduplication (`verisieve_clean.wasm`)**: Reconcile `matilda-portable` (`10,465` B, `15` exports) and `Rtio` (`10,860` B, `16` exports, WSL `wasm32-unknown-unknown`) on one shared crate (`rust/verisieve-clean/`), adding UTF-8 HTML entity decoding (`>= 0x80`), JS/CSS quote+comment state tracking inside `<script>`/`<style>`, circular dedup ring eviction (`vs_clean_dedup_evicted`, `vs_clean_dedup_cap`, `vs_clean_dedup_overflowed`), strict `abiVersion === 1` checking, and explicit `RangeError` slice/capacity checks instead of silent truncation.
  - **Deterministic Document Extraction (`verisieve_ingest` WASM / unified JS adapter)**: Implement RFC 1951 inflate without `std` regex bloat for born-digital PDF `/FlateDecode`, `/ASCII85Decode`, filter arrays, PDF 1.5+ `/ObjStm`, scoped `/ToUnicode` CMaps (Issue `#8`), baseline/kerning `TJ` ordering, Central-Directory `.docx` ZIP extraction supporting bit-3 Data Descriptors and zip-bomb caps, plus extracted `/Image` XObject pixel buffers for optional OCR.
  - **PII Redaction, 520-Dim Hashing & Conformal LTT (`verisieve_pii_gate` / parity C99 header)**: Port context-aware deterministic byte scanners, domain exclusion dictionaries, `maskValue` strategies, UTF-8 FNV-1a hashing, 520-dim feature projection, float32 inference, and LTT `binomCdf` bounds alongside `include/verisieve.h` parity.
  - **Tabular SQL Engine (`verisieve_sql`)**: Replace the misleading `DuckDB v1.5.5` JS regex mockup and avoid bundling `@duckdb/duckdb-wasm` (`34.2 MB` / `405` imports + `apache-arrow` + `qs`) inside `matilda-portable` by implementing a small zero-import Rust WASM SQL subset (`< 500 KB`) plus a strict JS fallback that rejects unsupported SQL syntax, and parameterizing host Python DuckDB queries (`read_csv_auto(?)`).
- **Keep `verisieve_dl.wasm` Frozen with Committed Provenance**:
  - Link/document `verisieve_dl.wasm` (`60,096` B, SHA-256 `2FF6E775...`, `74` functions, `0` imports, `27` exports) to its canonical `MLE/core-dl` source and `65,536` B size gate (`5,440` B remaining headroom), never mixing regex or ingestion code into it; mirror its source or build provenance manifest into `matilda-portable`.
- **Option B Neural Weight OCR (`cactus.wasm` + `.cact`)**:
  - Reconstruct minimal pure-memory Emscripten glue binding the 16 `"a"."a".."p"` imports on `cactus.wasm` (`1,240,671` B, `954` functions, `22,975` `v128` SIMD ops, `21` exports `q..K`) verified by `audit-wasm`, remove Python telemetry vectors completely, wire real native RGB PNG/BMP decoding + PDF embedded `/Image` XObject raster buffers through `2D` `512x512` tiling into `_cactus_load` / `_cactus_describe`, and load `mirage.cact` (`~22 MB`, fetched explicitly offline/setup-time or user-supplied local `.cact` path — never implicit network fetch during document ingestion, and never installing `tesseract.js` or `pdfjs-dist` npm runtime bloat).

### 2. Core Data Integrity, Security & Fail-Closed Pipeline Contracts

- **Unified Ingestion & SSRF Containment (`ingestDocument` / `ingestFromUrlOrPath`)**:
  - Return a uniform structured result schema across text, HTML, URL, `.docx`, born-digital `.pdf`, and OCR'd images/scans: preserve born-digital line multiplicity, report `{ pageCount, streamCount, isLikelyScanned, diagnosticReason }`, emit `cleanText` on HTML/URL responses, reject missing OCR or failed URL fetches explicitly, and enforce SSRF validation (blocking loopback, RFC1918, CGNAT, link-local IMDS, and private DNS) across URL ingestion entrypoints.
- **Tokenizer, Hashing, LTT Calibration & Receipt Security**:
  - Hash UTF-8 bytes in `fnv1a` (`TextEncoder`), use reversible `byte-utf8-v1` tokenization, compute `[512..519]` features truthfully from live data (zero fake constants), match C99 float32 arithmetic via `Math.fround`, fail closed (`certified: false`, `tauKeep = 1.0`, `tauDrop >= 0`) when $n_0$ cannot satisfy `binomCdf <= delta`, enforce disjoint holdout splits, resolve unused `targetDropRecall`, and verify live `weights` + `bias` against `receipt.weightsSha256` inside `verifyTrainingReceipt`.
- **Privacy, UI Server Security & Honest Training/Benchmarks**:
  - Mask `raw_excerpt` via `raw_excerpt_sha256` + redacted preview and omit MCP `textExcerpt` unless explicitly requested; bind UI server to `127.0.0.1`, remove `*` CORS, enforce `path.relative` traversal containment, return `404` on missing files, `await` MCP execution, fix `demo/index.html` line `1570` regex `SyntaxError` and DOM XSS sinks, replace mock UI/training/benchmark fallbacks with live measurements, and regenerate benchmark artifacts only after verification passes.

---

## Testing Decisions

Good tests in this repo assert **external observable behavior at system boundaries** on real, self-contained fixtures without mutating production code via silent mock fallbacks:

- **Proposed Minimal Testing Seams (5 Boundaries)**:
  1. **Seam 1 — Unified Document-to-Gatekeeper Pipeline Boundary** (CLI / MCP `handleJsonRpcRequestAsync` / `ingestFromUrlOrPath` / URL SSRF boundary):
     - Tests real text, HTML, ephemeral `http://127.0.0.1` URLs, SSRF-rejected private URLs, `.docx` (bit-3 Data Descriptors + zip-bomb bounds), born-digital compressed + `/ObjStm` `.pdf`, scanned image-only `.pdf`, and `.png`/`.bmp` inputs end-to-end through Rust WASM cleaning, PII redaction, tokenization, conformal calibration, receipt verification, and `AuditChain` output—asserting fail-closed errors (`MIRAGE_WEIGHTS_REQUIRED` / `SCANNED_PDF_REQUIRES_OCR`) when OCR weights are absent, real OCR extraction when `.cact` or `ocrProvider` is present, strict `raw_excerpt` redaction, and `certified: false` / `tauKeep === 1.0` when $n_0$ is below the LTT bound.
  2. **Seam 2 — Zero-Egress WASM & Cross-Runtime ABI Boundary** (`WebAssembly.Module` + `audit-wasm` / `auditCactusWasmArtifact` + compiled C99 harness):
     - Audits every `.wasm` binary for exact import/export surface and checksum provenance (`verisieve_clean.wasm` with `0` imports and `vs_clean_dedup_overflowed`, `verisieve_dl.wasm` `0` imports traceable to `MLE/core-dl`, and `cactus.wasm` import table strictly verified against the pure-memory host shim with zero network/FS imports), runs `cargo test` for `verisieve-clean` (UTF-8 entities, quote/comment `<script>`/`<style>`, ring eviction), and compiles/runs the C99 parity harness dynamically to assert cross-process JS-vs-C99 equality on UTF-8 `fnv1a` and float32 `decideGatekeeper`.
  3. **Seam 3 — Real WASM Training, SQL Query, UI Security & Benchmark Integrity Boundary** (`trainWasmSmallModel` / SQL executor / `ui-server.mjs` / `demo/index.html` / benchmark smoke):
     - Runs actual `verisieve_dl.wasm` embedding + multi-epoch gradient steps verifying real loss progression derived from input shard vectors, validates SQL subset filtering and explicit errors on unsupported queries, tests UI server HTTP security (`127.0.0.1`, `404`, traversal rejection, `await /api/mcp`), and validates `demo/index.html` JavaScript syntax via Node `vm.Script`.
  4. **Seam 4 — Option B `cactus.wasm` Runtime, 2D Tiling & Real Image/Scan OCR Boundary** (`cactus.wasm` host shim + pixel decoder + `tileAndRead` + `.cact` weight loader):
     - Instantiates `cactus.wasm` strictly inside an isolated memory-only host import object (proving zero outbound network/filesystem syscalls), decodes genuine RGB `.png`/`.bmp` and PDF embedded `/Image` XObjects, runs `2D` square `512x512` tiling + IoU/CTC seam stitching + `;=#@$*|` form-schema restoration without mock fallbacks, and verifies live OCR when local `mirage.cact` is present (and typed failure when missing).
  5. **Seam 5 — Cross-Repo Convergence Boundary (`matilda-portable` ↔ `Rtio`)**:
     - Verifies bit-identical `verisieve_clean.wasm` SHA-256 and shared export contract across both repos, aligned PII redaction + `verifyTrainingReceipt` (`weights + bias`) + LTT `n0 === 0` fail-closed semantics, and verifies `Rtio` can switch `/sandbox` cleanly onto Option B (`verisieve_clean` + `verisieve_ingest` + `cactus.wasm` + `mirage.cact`) dropping `tesseract.js` and `pdfjs-dist` npm/public asset bloat.

- **Prior Art in Repo**: Extend existing `node --test` suites, WSL/Rust `cargo test`, and `gcc` C99 parity harness with checked-in deterministic fixtures, deleting all `C:/Users/...` and `D:/Ollama/...` host paths.

---

## Out of Scope

- Editing `paper/mlsys2027-verisieve.tex` or modifying submitted academic paper prose.
- Executing embedded Acrobat JavaScript / XFA forms (`quickjs-eval.wasm`) inside VeriSieve PDF ingestion.
- Bundling multi-dozen-MB C++ DuckDB WASM (`@duckdb/duckdb-wasm`) inside `matilda-portable`'s zero-dependency npm package.
- Downloading multi-GB open-weight LLMs in automated CI tests (BYO local GGUF/SafeTensors inspection uses bounded `File.slice()` / header-only checks + zero-install `uv` companion recipes).
- Training custom neural OCR weights from scratch to replace `mirage.cact` right now (Option B ships with `cactus.wasm` + `mirage.cact` now, while keeping the `ocrProvider` + compact `#![no_std]` Rust/WAMR kernel boundary clean for a future sovereign text-focused small OCR model).

---

## Further Notes

### Sovereign Document-OCR Roadmap (Future Phase Beyond Option B)

Under **Option B**, VeriSieve pairs our zero-import `#![no_std]` Rust WASM core kernels with Cactus Mirage (`cactus.wasm` + `mirage.cact`) so arbitrary images, photographs, and scanned PDFs work immediately without third-party `tesseract.js` / `pdfjs-dist` npm bloat. Because Cactus Mirage is designed broadly as general-purpose vision ("eyes"), keeping our `ocrProvider` abstraction and `#![no_std]` Rust/WAMR tensor-kernel ABI separate lets us train and deploy a sovereign, ultra-compact document-OCR model (multi-font text-crop CNN/BiLSTM/CTC or client-side small-model weights quantized to 2-bit) tuned specifically for degraded text and typography in a future phase without changing downstream ingestion, PII redaction, or conformal gatekeeper APIs.

### Appendix A — Observed Static WABT / Binary-Inspection Census & Cross-Repo Artifact Ledger

| Target / Package | Method & Source | Binary Size & Function Census | Host Imports / Deps | Remediation / Migration Decision |
|---|---|---|---|---|
| `verisieve_clean.wasm` (`matilda-portable` vs `Rtio`) | WABT `wasm-objdump` + Rust diff (`rust/verisieve-clean/`) | `matilda-portable`: `10,465` B (`27` fns, `15` exports, SHA `2FE8C2...`) vs `Rtio`: `10,860` B (`28` fns, `16` exports, SHA `255B8F...`, `9,888` B Code / `491` B Data) | `0` imports, `0` npm deps | Sync `Rtio`'s 5 fixes + remaining UTF-8 entity, `<script>`/`<style>` quote/comment, & `RangeError` bridge fixes; build identically via WSL `wasm32-unknown-unknown`. |
| `verisieve_dl.wasm` (`mle_dl.wasm`) | WABT `wasm-objdump` + SHA-256 across all 3 repos | `60,096` B across `MLE`, `matilda-portable`, `Rtio` (SHA `2FF6E775...`, `74` fns, `53,340` B Code / `5,430` B Data; `65,536` B cap) | `0` imports, `27` exports (`mle_dl_*`) | Provenance identified (`MLE/core-dl/src/lib.rs`); keep frozen (`5,440` B headroom); drive with real embeddings instead of `Math.sin`; mirror provenance into repo. |
| `vendor/cactus/cactus.wasm` | WABT `wasm-objdump` + strings + `WebAssembly.Module` | `1,240,671` B (`1.18 MB`), `954` fns, `1,191,047` B Code / `47,083` B Data (`204` segments), `22,975` `v128` ops | `16` minified `"a"."a".."p"` imports, `21` exports (`q..K`); **no JS glue**, requires `~22 MB` `mirage.cact` | Mark `zeroEgressVerified: false` in `audit-wasm` today; bind safely + supply opt-in `mirage.cact` only if choosing **Option B**. |
| `tesseract.js` `v7.0.0` | Static JS/manifest binary-inspection pass | Wrapper package | **9 runtime npm deps** (`node-fetch`, `bmp-js`, `idb-keyval`, `zlibjs`, `tesseract.js-core`, etc.) + `cdn.jsdelivr.net` URLs | **Drop wrapper completely.** Violates zero-dependency & zero-egress policy. |
| `tesseract.js-core` + `@tesseract.js-data/eng` | WABT `wasm-objdump` + static JS inspection | `tesseract-core-lstm.wasm` = `2,855,361` B (`2.72 MB`, `3,457` fns, `2,444,419` B Code / `400,702` B Data) + `89,261` B JS glue + `2,952,873` B `eng.traineddata.gz` | `45` Emscripten `"a"` imports, `307` exports, **0 hardcoded URLs** in `tesseract-core-lstm.js` | Excluded under **Options A/B**; only retained if **Option C** isolates a zero-CDN browser adapter in `Rtio` without `tesseract.js` wrapper bloat. |
| `pdfjs-dist` `v6.5.438` | WABT `wasm-objdump` + static JS inspection | `pdf.mjs` (`0.85 MB`), `pdf.worker.mjs` (`2.14 MB` / `1.27 MB` min); WASMs: `openjpeg.wasm` (`220,817` B, `192` fns, `8` imports), `jbig2.wasm` (`103,671` B, `119` fns, `8` imports), `qcms_bg.wasm` (`96,589` B, `141` fns, `3` imports), `quickjs-eval.wasm` (`469,105` B, `1,229` fns, `13` imports) | `0` runtime npm deps (`@napi-rs/canvas` optional) | Replace JS regex extractors with zero-import Rust/JS born-digital PDF parser (`/FlateDecode`, `/ASCII85Decode`, `/ObjStm`, `/ToUnicode`, Issue `#8`) + XObject image extractor; always omit `quickjs-eval.wasm`. |
| `@duckdb/duckdb-wasm` `v1.33.1-dev18.0` | WABT `wasm-objdump` + manifest inspection | `duckdb-eh.wasm` = `34,242,586` B (`32.66 MB`), `duckdb-mvp.wasm` = `39,362,651` B (`37.54 MB`), worker `1.19 MB` | Depends on `apache-arrow` & `qs`; **`405` host imports** (`125 env`, `265 GOT.func`, `12 wasi`, `3 GOT.mem`, `75,011` exports) | **Do not bundle in `matilda-portable`.** Replace fake `DuckDB v1.5.5` JS parser with compact 0-import Rust WASM SQL (`verisieve_sql`) + strict JS parser + parameterized host Python DuckDB (`Rtio` keeps its isolated browser DuckDB-WASM under Option C). |

*(Attribution note per workspace provenance rules: public docs credit the inspection discipline as WABT `wasm-objdump` / a local binary-inspection pass.)*

---

### Appendix B — Exhaustive Defect & Remediation Checklist (All Subsystems)

1. **Cross-Repo Rust WASM Core, Toolchain & Bridge**
   - [ ] Sync `rust/verisieve-clean/src/lib.rs` and `vendor/wasm/verisieve_clean.wasm` with `Rtio`'s `10,860` B build fixes (`wasm32::unreachable()`, `DEDUP_CURSOR` + `vs_clean_dedup_overflowed()`, `isolated_pipe_count`, `is_raw_text_container_tag()`, UTF-8 chunk width).
   - [ ] Fix remaining `verisieve-clean` bugs across **both** repos: decode UTF-8 numeric HTML entities `>= 0x80` cleanly (preserving `&nbsp;` as space), track JS/CSS `'...'` / `"..."` / `` `...` `` (with `\` escapes) and `//` / `/* */` inside `<script>`/`<style>`, and export `vs_clean_dedup_evicted()` + `vs_clean_dedup_cap()`.
   - [ ] Add `wasm32-unknown-unknown` build verification in scripts/CI (using WSL target or Windows rustup target install) and mirror `MLE/core-dl` provenance for `verisieve_dl.wasm`.
   - [ ] Harden `src/clean-wasm.js` (`abiVersion === 1` check, throw `RangeError` on unsplit slice `> inCap`, newline/`>`/UTF-8 safe chunk splitting matching `clean-wasm.ts`).
2. **Core Hashing, Tokenizer, PII Scanner, Features & Receipt Integrity**
   - [ ] `fnv1a`: Hash UTF-8 bytes via `TextEncoder` matching C99 `verisieve_fnv1a_32`.
   - [ ] Default tokenizer (`createTokenizer`): Label and implement lossless reversible UTF-8 byte encoding (`byte-utf8-v1`) with exact `decode()`.
   - [ ] `extractFeatureRow`: Separate `minConfidence` (`[513]`) and `meanConfidence` (`[514]`); compute `[515]`/`[516]` from real structural/punctuation/non-ASCII metrics (matching `Rtio` fix, never `0.1`/`0.05` constants); use real `tokenCount` for `[519]`.
   - [ ] `PII_PATTERNS`: Strip hardcoded benchmark literals (`\bMontgomery\b`, `Wong Tai Sin Hospital`, `Guy's Campus`, `King's College London`, `'chines'`, `'masala'`) into opt-in domain configs; keep clinical/grant/kernel disambiguators and card-prefix/Luhn validation.
   - [ ] `verifyTrainingReceipt`: Re-hash live `bundle.weights` + `bundle.bias` against `receipt.weightsSha256` (matching `Rtio` fix).
3. **PDF, `.docx`, URL & Image/OCR Ingestion + Architectural Gate (`A`/`B`/`C`)**
   - [ ] Unify born-digital PDF parser (`/FlateDecode` RFC 1951 inflate, `/ASCII85Decode`, filter arrays, PDF 1.5+ `/ObjStm`, Type0/CID & scoped 1B/2B `/ToUnicode` CMaps for Issue `#8`, Y/X coordinate & negative-kerning `TJ` ordering, preserving short/repeated lines cleanly, returning `{ pageCount, streamCount, isLikelyScanned, diagnosticReason }`).
   - [ ] Delete hardcoded 3-sentence empty-PDF PMC fallback, `.png`/`.bmp` `[IMAGE OCR EXTRACTED...]` stub, `getRealPmcDocumentLines()`, and silent offline URL fallback path.
   - [ ] Implement real `extractImageTiles` RGB cropping + pluggable `ocrProvider` contract enforcing selected **Option A / B / C**, failing loudly with `SCANNED_PDF_REQUIRES_OCR` / `IMAGE_REQUIRES_OCR_PROVIDER` when unconfigured.
   - [ ] Fix `.docx` ZIP extraction via Central Directory + bit-3 Data Descriptor support, zip-bomb decompression limits, XML entities/`<w:br/>`/`<w:tab/>`, and wire `.docx` into `ingestFromUrlOrPath`.
   - [ ] Return `cleanText` from `stripHtmlBoilerplate` / `ingestUrl` and add SSRF guards (loopback, RFC1918, CGNAT, link-local IMDS, private DNS, bounded redirects/body size).
   - [ ] Fix stateful `/g` `forbiddenRegex` bug in `sanitizeMirageFormSchema`; fix `auditCactusWasmArtifact` & `audit-wasm` to mark unverified 16-import `cactus.wasm` as `zeroEgressVerified: false`; fail `tileAndRead` unless real recognizer or explicit fixture opt-in is passed.
   - [ ] Mask `raw_excerpt` via SHA-256 + redacted preview by default across CSV/JSON outputs and remove hardcoded FUNSD/PMC `raw_excerpt` leaks & unconditional `CERTIFIED` status.
4. **Conformal LTT Gatekeeper & C99 Float32 Parity**
   - [ ] Remove heuristic `bestT = 0.76` fallback; fail closed (`certified: false`, `tauKeep = 1.0`, `tauDrop >= 0`) when $n_0$ is insufficient (incl. `n0 === 0`) or `binomCdf <= delta` cannot be met.
   - [ ] Reject accidental in-sample calibration on the training array unless explicitly opted in; resolve unused `targetDropRecall`; match `topic` axis enforcement from `Rtio`.
   - [ ] Align `decideGatekeeper` prediction arithmetic with `Math.fround` float32 C99 `include/verisieve.h` parity.
5. **WASM DL Training, SQL Engine, Benchmarks & Python**
   - [ ] `trainWasmSmallModel`: Replace `Math.sin` synthetic tensors and `Math.exp(-ep / 8)` curves with real `embedNeedleWasm` shard vectors and per-epoch WASM `mle_dl_vera_loss_grad` + `mle_dl_vera_train` calls; compute actual top-3 retrieval purity and `scanRecordsForPII` leakage.
   - [ ] `chatWithTrainedModelsWasm`: Generate responses strictly from actual retrieved shard matches, calibration status, and measured timing (no hardcoded `miuky@ha.org.hk` / `Betty D. Montgomery` prose); wire real `mle_dl_vera_predict` router inference.
   - [ ] Remove `KNOWN_LOCAL_OLLAMA_BLOB` `D:/Ollama/...` default.
   - [ ] Build `rust/verisieve-sql/` zero-import WASM SQL engine (or strict labeled JS subset parser removing regex range bugs and the fake `DuckDB v1.5.5` header); parameterize `scripts/duckdb-query.py` queries (`read_csv_auto(?)`).
   - [ ] `scripts/train-open-model.py`: Evaluate Model A and Model B under symmetric PII leakage checks; fail cleanly instead of defaulting SVG metrics to `67`/`42`/`35`/`12`.
   - [ ] `scripts/run-benchmarks.mjs`, `scripts/generate-figures.mjs`, `scripts/bench-node-coldstart.mjs`, `src/head-to-head-comparison.js`, `src/scale-benchmark.js`: Replace all fake PRNG calibration, `alpha * 2.8`/`alpha * 1.5` formulas, JS-only `Node+WASM` loops, hardcoded head-to-head metrics (`0.60`/`0.85`/`0.62`/`0`/`66.7`), FUNSD `(idx * 5 + 1) % 3 === 0` modulo labels, `pmc_pdf` hardcoded `isSafe: true`, and `C:/Users/...` paths with live measurements. Regenerate SVGs/JSON/benchmark docs afterwards.
6. **CLI, MCP Server, UI Server & Demo UI**
   - [ ] CLI (`bin/verisieve.mjs`): Implement real `train` and `decide` subcommands; route `ingest` cleanly for binary formats (`.pdf`/`.docx`/images); print honest `CERTIFIED` vs `FAIL_CLOSED_UNVERIFIED`; extend `audit-wasm` across all bundled `.wasm` files.
   - [ ] MCP server (`src/mcp-server.js`): Fix `ingest_url_or_links` (`cleanText` lookup + SSRF guard), stop leaking `textExcerpt`, wire `scanRecordsForPII` and holdout splits into multi-axis handlers, and surface honest `certified: false` when $n_0 < 59$.
   - [ ] UI server (`scripts/ui-server.mjs`): Bind strictly `127.0.0.1`, remove `*` CORS, enforce `path.relative` traversal guard, return `404` for nonexistent files, `await handleJsonRpcRequestAsync`, restrict unvalidated filesystem reads, delete dead `runJsSqlFallback` and hardcoded `C:/Users/...` / `D:\Ollama\...` / `42` defaults.
   - [ ] Browser UI (`demo/index.html`): Fix line `1570` invalid regex (`SyntaxError`), escape all `.innerHTML` renders against DOM XSS, remove silent upload/camera/`renderAbChatFallback` mock outputs.
7. **Tests, CI & Repo Docs**
   - [ ] Remove all `C:/Users/...` paths from tests & `fetch-public-benchmarks.mjs`; commit self-contained fixtures (born-digital `.pdf`, `/ObjStm` PDF 1.5 `.pdf`, scanned image-only `.pdf`, `.png`, bit-3 Data Descriptor `.docx`).
   - [ ] Enforce genuine cross-process JS-vs-C99 parity in `c-parity.c` + gatekeeper tests (skip cleanly only if `gcc` is absent, never swallow mismatch errors).
   - [ ] Add adversarial tests for fail-closed scanned PDF/PNG rejection, SSRF rejection, LTT $n_0 < 59$ & receipt weight tampering, zero `raw_excerpt` leakage, MCP HTTP URL ingestion, SQL subset errors, and `demo/index.html` script syntax validation (`vm.Script`).
   - [ ] Reconcile `README.md`, `SECURITY.md`, `docs/BENCHMARK-REPORT.md`, `docs/SPEC-AND-RUN-RECORD.md`, and `docs/CLAIM-AUDIT-AND-MOAT-ANALYSIS.md` with post-remediation verified numbers (`paper/mlsys2027-verisieve.tex` untouched).
