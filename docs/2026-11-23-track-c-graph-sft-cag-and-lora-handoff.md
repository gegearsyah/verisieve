# Track C Execution Handoff (`matilda-portable`): Graph-Grounded SFT, Native CAG, and Open-Weight LoRA Ablation

- **Date:** 2026-11-23
- **Repo:** `matilda-portable` (`versieve`, branch `fix/spec-15-remediation`, `HEAD = 89262ea`)
- **Sibling Repo Sync State:** `Rtio` `main = 9b42ebd` (Tracks A, B1, and B2 core are complete, verified, and pushed).
- **Already Completed & Synced Into This Repo (`89262ea`):**
  - `vendor/wasm/versieve_clean.wasm` (`14,633 B`, 0 imports) — fixed subword token-budget chunking (`ceil(chars/4)` + sentence boundary snap + `<PII:[A-Z0-9_]+>` atomic preservation) and fixed compliance-hostile chrome drops (`"privacy policy"` headings, GFM table headers, `$3,000,000` numeric metrics).
  - `vendor/wasm/versieve_graph.wasm` (`54,402 B` raw / `20.2 KB` gzipped, 0 imports, 0 COOP/COEP) — Dual-CSR Rust/WASM kernel (`6.5 ms` 100K-edge build, `2.96 ms` `.csr` reload, `0.50 ms` 3-hop blast radius, `22.3 ms` 15-iter PPR, `2.53 ms` Tarjan SCC).
  - `src/graph-wasm.js` (`PortableDocumentGraph`, `SaltedPseudonymVault`, `loadGraphWasmSync`) & `src/mcp-server.js` (6 new redacted MCP tools: `index_document_graph`, `blast_radius`, `ppr_retrieve`, `trace_path`, `get_document_tree`, `read_section_nodes`).
  - Verified byte-for-byte parity + MCP tests in `test/clean-wasm.test.js`, `test/graph-wasm.test.js`, `test/mcp.test.js` (`13/13` passing).

---

## 1. Objective of Track C

Eliminate the empirically measured **90% immediate-EOS collapse (45/50 blank answers)** observed when LoRA-tuning `LiquidAI/LFM3-1.7B-Base` on flat 49.4-token constant-prompt rows (`"Summarize verified segment."`), ship **Graph-Grounded SFT Builders** + **Native `llama.cpp` / Ollama CAG (Cache-Augmented Generation)** over strictly redacted salted-pseudonym graphs, and keep `triples.jsonl` future-compatible with parametric KV-injection (`AtlasKV` / `Doc-to-LoRA`) without blocking on custom PyTorch attention.

---

## 2. Non-Negotiable Privacy, Hygiene & Permission Guardrails

1. **Zero Data Egress:** Local private compliance PDFs, raw excerpts, queries, and session receipts stay strictly local and uncommitted. Never send corpus content to cloud LLMs/embedders.
2. **Graph / Training Privacy Invariant:** SFT JSONL (`rtio-graph-sft.jsonl`), `triples.jsonl`, CAG dossiers, and `kg_nodes`/`kg_edges` may store **ONLY** `KEEP_SAFE` redacted text and salted pseudonyms (`<PII:PERSON_01>`, `ent:person:<hmac16>`). Never bake raw PII or `workspaceSalt` into LoRA weights or exported shards.
3. **Repo Hygiene (`test/t9-portable-benchmarks.test.js`):** NEVER hardcode user home paths (`C:/Users/...`) in `src/`, `scripts/`, `test/`, `bin/`, or `docs/`. Always accept corpus paths via CLI flags or environment variables.
4. **Permission Gates:** Ask the user before downloading new model weights (e.g., `PaddleOCR-VL`, `Unlimited-OCR-2`, `Qwen2.5`, `LFM3` variants), pushing commits, or changing default production CLI flags.
5. **Scientific Discipline:** Freeze corpus, queries, token budget, and held-out splits before running `T0–T3` ablations. Run deterministic verification and never claim lift from synthetic fixtures alone.

---

## 3. Exact Code Targets & Root-Cause Fixes (TDD Red → Green)

### Task C1 — Fix Toxic Auto-Labeling & Wire `versieve_clean.wasm` + Salted Pseudonyms Into CLI Ingestion
- **Target:** `src/pdf-image-pipeline.js` (`L1634-1679`)
- **Bugs to Fix:**
  1. **Skips `versieve_clean.wasm` chunking (`L1635-1638`):** Splits raw text into individual lines (`rawContent.split(/\r?\n/)`), producing tiny broken line fragments instead of section-grouped ~256–384 subword-token chunks via `loadCleanWasmSync().chunkByTokenWindow(...)`.
  2. **Toxic URL/PII Auto-Drop (`L1660-1661`):**
     ```js
     const isBoilerplate = /confidential|copyright|all rights reserved|page \d+|http:\/\/|https:\/\//i.test(text);
     const label = (isPii || isBoilerplate) ? 0 : 1;
     ```
     This automatically labels **any statutory/compliance paragraph containing a reference URL or redacted PII as `label = 0 (DROP)`** (previously discarding 55,990 of 134,158 compliance rows!).
     - **Fix:** Once PII is cleanly masked via `SaltedPseudonymVault` (from `src/graph-wasm.js`), redacted prose is **safe (`label = 1`)** — do NOT drop rows solely because they contained redactable PII or a citation URL! Restrict `isBoilerplate` strictly to genuine chrome (delegating to `versieve_clean.wasm` `stripBoilerplate`).
  3. **Anonymous PII Tag Collisions (`L1655`):** Replace `masked.replace(item.value, maskValue(...))` with `SaltedPseudonymVault.maskText(...)` (opt-in or default configurable via `options.pseudonymize`), preserving cross-passage entity co-reference (`<PII:PERSON_01>`, `entity_ids`).
  4. **Preserve Structure (`pdf-parser.js` / DOCX / CSV):** Port the Tier-0 `PdfLineRecord` heading/breadcrumb + CSV row-0 header preservation contract from `Rtio/frontend/lib/versieve/structure-extractor.ts` so CLI ingestion emits `breadcrumb`, `page_no`, and `section_id`.

### Task C2 — Replace Degenerate Constant-Prompt SFT Export With Graph-Grounded SFT Builders
- **Target:** `src/pdf-image-pipeline.js` (`exportTrainingArtifacts`, `L1374-1431`) + new module `src/graph-sft-builder.js`
- **Root Cause Today (`L1394-1406`):** Every single isolated line gets wrapped in the exact same boilerplate prompt (`"Summarize verified segment."` / `"Extract verified domain knowledge from document segment."`) at ~49.4 tokens/row — driving immediate-EOS mode collapse on small base models (`LFM3-1.7B-Base`).
- **Build the Canonical Shared Export Contract (`rtio-graph-sft.jsonl` + `triples.jsonl`):**
  Consume `PortableDocumentGraph` (`src/graph-wasm.js`) strictly over `KEEP_SAFE` nodes/edges:
  1. **Section-Contextualized Long Passages (`512–2,048` tokens):** Merge consecutive `PASSAGE` nodes within the same `SECTION` (`NEXT_CHUNK` order) up to target token budget (`minTokens: 256, maxTokens: 1536`), attaching `[Doc > Section Breadcrumb]` and emitting either:
     - Continual-pretraining / domain-adaptation records (`{"mode": "packed_passage", "text": "...", "breadcrumb": "...", "provenance_ids": [...]}`), OR
     - Diverse section-anchored instruction records (varying prompt templates by section title, table schema, and entity roles — never a single constant prompt string!).
  2. **Table-Header-Bound Records:** Format `TABLE_ROW` nodes with repeated column headers (`col: val | ...`) grouped by table/section.
  3. **Multi-Hop Graph-Walk Q&A Chains:** Traverse `SECTION → PASSAGE → MENTIONS → ENTITY ← MENTIONS ← PASSAGE` (using `versieve_graph.wasm` `ppr_retrieve` / `trace_path`) to generate grounded multi-hop context/synthesis pairs strictly over salted pseudonyms (`<PII:PERSON_01>`).
  4. **Future-Compatible `triples.jsonl` (AtlasKV / KBLaM R&D Gate):** Emit `{"subject": "...", "predicate": "...", "object": "...", "provenance_id": "..."}` strictly over redacted nodes/salted entities so any future quantized KV-injection runtime plugs in with zero schema migration.
  5. **Single Clean EOS Invariant:** Never bake hardcoded `<|im_end|>` or duplicate EOS tokens into raw `text` when `SFTTrainer` / `apply_chat_template` appends EOS automatically.

### Task C3 — Fix `versieve-train.py` Packing, Padding-Mask & EOS Handling
- **Target:** `skills/versieve-local-train/scripts/versieve-train.py` (`L72-195`)
- **Bugs to Fix:**
  1. **Double-EOS & Base-Model `pad_token == eos_token` Collapse (`L151-152`):**
     - When `tokenizer.pad_token is None`, setting `pad_token = eos_token` on base models (like `LFM3-1.7B-Base`) without sequence packing or masked pad labels over-trains the EOS token logit.
     - Strip any trailing `tokenizer.eos_token` before `SFTTrainer` tokenization if `SFTTrainer` appends EOS, and guard against double-EOS in unit tests!
  2. **Enable Sequence Packing (`packing=True`) & Tunable Sequence Length (`L172-194`):**
     - Add CLI flags: `--packing` (default `True` for `packed_passage` corpora), `--max-seq-length` (default `1024`, supporting `2048`), `--lora-r` (default `16`), `--target-modules` (auto-detect attention + MLP projections for `LFM3` / `Qwen2.5` / `Llama`), and `--assistant-only-loss` (for multi-turn chat SFT).
  3. **Add Automated Python Unit Test:** Verify on a tiny fixture JSONL that:
     - Zero double-EOS sequences exist in formatted outputs,
     - Mean packed sequence length is well above the old 49.4-token collapse zone,
     - Zero raw PII survives into training tensors.

### Task C4 — Native CAG (Cache-Augmented Generation) for `llama.cpp` / Ollama (`<= 32k–64k` Tokens)
- **Target:** New module `src/cag-dossier.js` + CLI command / script (`scripts/run-cag-benchmark.mjs`)
- **How It Works (Zero Retraining, Zero Custom PyTorch Attention):**
  1. Serialize a bounded, strictly redacted `KEEP_SAFE` workspace dossier from `PortableDocumentGraph` in deterministic TOC reading order (`DOCUMENT → SECTION → PASSAGE/TABLE_ROW`, capped cleanly at caller budget e.g. `16k / 32k / 64k` tokens).
  2. Emit a `dossier_sha256` + `taint_entity_ids[]` manifest so if any salted entity is later revoked (GDPR Art. 17), `blast_radius` immediately identifies and evicts the exact cached KV slot!
  3. Integrate with native **`llama-server --slot-save-path`** (`POST /slots/{id}?action=save` / `restore`) and **Ollama `keep_alive`** (`prompt_eval_count` / cache-hit telemetry) to measure repeat-turn latency vs RAG & Graph-PPR.

### Task C5 — Controlled Local GPU Ablation (`LFM3-1.7B` / `Qwen2.5`, 8 GB RTX 4070 / Apple Silicon MLX)
Run on frozen dev/held-out splits (never tune on held-out):
- **`T0` (Zero-Shot Base):** Base model alone + `T0 + Graph-PPR (versieve_graph.wasm)` + `T0 + PageIndex Redacted TOC` + `T0 + CAG` (`llama-server` KV cache).
- **`T1` (Old Flat-Line LoRA Baseline):** Documented 90% immediate-EOS collapse reference.
- **`T2` (Graph-Grounded Packed LoRA):** `rtio-graph-sft.jsonl` (`packing=True`, single clean EOS) — Raw vs Versieve salted-pseudonym redacted.
- **`T3` (Hybrid):** `T2` + Layer-1 Graph-PPR / Layer-2 CAG.
- **Required Metrics:**
  - Blank / immediate-EOS collapse rate (**target: `0%`**)
  - Held-out QA accuracy / F1 (broken down by single-hop, multi-hop, numeric/table threshold, unanswerable)
  - Raw PII / canary memorization rate (**target: `0.0%`**)
  - Cold vs repeat-turn latency (ms) and peak VRAM (GB)

### Task C6 — Deferred / Opt-In Gates (Do NOT Block Critical Path)
- **Scanned-PDF Desktop VLM-OCR (Ask Before Downloading Weights):**
  - Default stock `llama-server --mmproj`: `PaddleOCR-VL` (`0.9B–1.2B`)
  - Ultra-long 50–200+ page scans: `baidu/Unlimited-OCR-2` (`3B` MoE, `SR-SWA` $O(1)$ KV cache)
- **AtlasKV (`HKUST-KnowComp/AtlasKV`) & Sakana AI `Doc-to-LoRA` R&D Gate:**
  - Keep `triples.jsonl` schema-compatible, but **do NOT integrate** until 4-bit quantized `llama.cpp`/MLX kernels fit in 8 GB VRAM, preserve multi-hop reasoning, and beat Graph-PPR + CAG at `10^4–10^5` scale.

---

## 4. Verification Commands

Run from `matilda-portable`:
```powershell
# Targeted WASM + Graph + MCP + SFT tests
node --test test/clean-wasm.test.js test/graph-wasm.test.js test/mcp.test.js test/pdf-image-pipeline.test.js

# Full CI suite (note: ensure zero hardcoded C:/Users paths so t9-portable-benchmarks passes!)
npm run test:ci

# WASM zero-import audit
npm run audit-wasm
```

*(Note on sibling `Rtio` sync: once `rtio-graph-sft.jsonl` + `triples.jsonl` format is finalized in Task C2, mirror the exact JSONL contract into `Rtio/frontend/lib/versieve/target-tokenizer.ts` and `Rtio/frontend/components/sandbox/TrainTab.tsx`.)*
