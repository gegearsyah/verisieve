# Post-Swarm Handoff: `IB-PT-LM` Production Promotion, README + Hero GIF Refresh, and Paper C/D Synchronization

- **Date:** 2026-11-27
- **Repository:** `gegearsyah/versieve` (`main` @ `3ece86d`)
- **Predecessor Handoff:** `docs/2026-11-26-swarm-judge-handoff.md` (100% completed — all 12 sub-issues `#28`–`#39` and parent specs `#26` & `#27` verified, merged onto `main`, and closed)
- **Purpose of Next Session:** Execute the **three high-leverage post-swarm upgrades** (`U1`, `U2`, `U3`) unlocked by Wave 1–3 capabilities and empirical discoveries, under strict Judge verification.

---

## 1. Verified Baseline State (`main` @ `3ece86d`)

All checks currently pass with zero failures:
- `npm run test:ci` -> **PASS** (`0` failures across all suites)
- New Wave 0–3 suites (`T2`–`T12`, 11 test files) -> **`67 / 67` PASS**
- `node bin/versieve.mjs audit-wasm` -> **`allVerified: true`** (`0` host imports across all 5 `vendor/wasm/*.wasm` kernels; `388,797 B` total)
- `node scripts/check-paper-numbers.mjs` -> **`1,468` checks, `0` failures**

### Canonical Source Artifacts Already Committed on `main`

| Source Artifact / Module | Ticket / Commit | Verified Numbers & Capabilities Available for `U1`–`U3` |
|---|---|---|
| `src/perceive.js`, `src/gatekeeper.js` | `T2` (`03fddbb`), `T5` (`44f34c9`) | Pluggable Stage 3B text + IoU image adapters (`createDetectorAdapter`), `humanCorrections`, `GATE_REJECTION_REASONS`, `combineConvexEValues` / `evaluateDualChannelEValue`, `runShadowAudit`, `NumGuard` (`verifyNumericIntegrity`), `computeEgoGraphTelemetry` |
| `src/pdf-parser.js`, `src/enterprise-parsers.js`, `src/pdf-image-pipeline.js` | `T3` (`1789820`) | Opaque-overlay text, incremental PDF `%%EOF` revisions, `3 Tr`/white/tiny/off-page text, recursive nested attachments, `verifyPdfRedactionIrreversibility`, `sanitizePdfBuffer` |
| `src/secret-scanner.js`, `src/vault-restore.js`, `src/mcp-server.js` | `T4` (`39fed5b`) | HIPAA Safe Harbor checksum pack (`NPI`, `DEA`, `MBI`, `CLIA`, `MRN`, dates), opt-in `createReversibleVault` / `restoreFromVault`, fail-closed zero-echo MCP error envelope |
| `src/amnesiac-corpus.js` | `T5` (`44f34c9`) | Opt-in `includeMerkleRoot` (`computeEntitySortedMerkleRoot` / `verifyMerkleProof`) & `includeEgoGraphTelemetry` (zero drift to V1 `corpusSha256`) |
| `src/exporters.js`, `bin/versieve.mjs` | `T6` (`dcd7be7`) | `exportTrainingDataset` (`llama-factory-sharegpt`, `llama-factory-alpaca`, `unsloth`, `oumi`, `nemo`, `document-qa`), `versieve sanitize <file> --diff-report`, `versieve footprint` |
| `results/reviewer-tab-and-ltt-benchmarks.json` | `T7` (`e016a39`) | Paper D Dunn/Lee/`HG-CRC` formal cluster baselines + `tau=0.70` SR-MP CI (`40.78% [33.4, 47.3]`) + corpus licenses/seeds *(already in Paper D `.tex`/`.pdf`)* |
| `results/scale-and-paradigm-benchmark.json`, `results/t8-gate-over-detector-and-stitched-shootout.json` | `T8` (`92a6168`) | `ai4privacy-200k` Presidio (`64.48%` recall / `76.48%` F1) & GLiNER-Edge INT8 (`62.41%` / `73.60%`) *(in Paper A)*; **TAB Gate-Over-Presidio:** Presidio+ECHR alone leaks `27.31%` (`546` paras) -> `HC-CRC + Stage 3A + Presidio` = **`0.00%` (`0` leaks, CI `[0, 0]`)** at `alpha=0.01` (`27.13%` yield) and **`9.06%`** (`29` leaks) at `alpha=0.05` (`77.39%` yield), beating stitched plain-threshold (`p=0.0002`) *(not yet in README or Paper D)* |
| `results/competitor-benchmarks.json`, `results/ease-benchmark.json` | `T9` (`eca05c7`) | `screenleak` (`91.67%` text zero-leak, `87.50%` image `IoU >= 0.30`), `unmasker` **`27/27` (`100%`)** specimen categories, `MAT2` **`7/7` formats** (`0` residual metadata bytes); **Ease Benchmark:** `1.49 MB` (`388,797 B` WASM) / `1` runtime / `3 LOC` / **`115.67 ms`** cold start vs `518.86 MB` / `4` runtimes / `26 LOC` / **`14,745.83 ms`** (`348.9x` smaller, `127.48x` faster) *(not yet in README)* |
| `results/track-k-retrieval-engine.json`, `results/track-d-ptlm-multiseed-ablation.json` | `T10` (`ae8dd56`) | Paper B `retrieval_engine` **`68.3%` EM** (`41/60`) vs `81.7%` oracle upper bound *(in Paper B)*; Paper C 36-adapter 3-seed (`42, 43, 44`) `Safe` vs `Masking-only` vs `Surrogate-only` vs `PT-LM` *(in Paper C)* |
| `results/t11-scanner-missed-canaries.json`, `results/t11-cpa-attacker-audit.json`, `results/t11-scale-qa-training.json` | `T11` (`f7518ae`) | Scanner-missed canaries: Stage 3A `9.75` bits (`11/12` r1) -> Stage 3A+3B `PT-LM` **`6.27` bits (`6/12` r1)**; **`CPA` Attacker Audit (`arXiv:2609.21340`):** `HC-CRC` released **`14.0%`** (`|C_adv|=9.98`) vs withheld **`42.0%`** (`|C_adv|=8.41`) top-1 LLM re-ID (`Fisher p = 1.6e-5`, paired `McNemar p = 4.1e-5`); **540-Q 3-Seed Uncapped SFT:** `document_qa` (`1,125` rows) **`30.56%` EM** (`[26.79, 34.14]`) vs `composed_uncapped` `19.45%` (`+11.11 pp`, `p=0.0005`), narrowing `bm25_retrieval` (`34.26%`) gap from `-14.81 pp` to **`-3.70 pp` (`p=0.175`)** *(not yet in README or Papers C/D)* |
| `results/exploratory-ac-crc.json`, `results/exploratory-ib-ptlm.json`, `scripts/run-exploratory-ib-ptlm.py` | `T12` (`3ece86d`) | `AC-CRC`: 10k-trial dependent-channel $H_0$ control (`allRegimesPass: true`), `-1.32 pp` released re-ID (`12.22% -> 10.90%`) vs `+0.84 pp` detector leak; **`IB-PT-LM` (`Qwen2.5-0.5B`, 3 seeds):** crushes static-surrogate suffix-inversion memorization from **`5.27` bits (`5.67/12` r1)** on `PT-LM` to **`1.15` bits (`0.0/12` r1, `-4.12` bits)** and drops 8-way neighboring non-PII hidden-state probe accuracy from **`37.50%`** (`PT-LM`) / `25.00%` (`Masking-only`) to **`19.79%`** (`-17.71 pp`) at `~2.05x` train time (`0` inference overhead) |

---

## 2. Architecture Decision Summary (Binding Scope)

1. **Promote `IB-PT-LM` to Production (`U1`):** Static `PT-LM` suffers measurable surrogate-continuation memorization (`5.27` bits) and neighboring hidden-state leakage (`37.50%`). `IB-PT-LM` fixes both with zero WASM modifications and zero inference overhead. Promote disjoint-surrogate pair generation into `src/exporters.js` + `src/perceive.js` and promote `--ib-ptlm` into the main LoRA trainer.
2. **Keep `AC-CRC` Opt-In (No Default Change):** `combineConvexEValues`, `evaluateDualChannelEValue`, and `secondaryEValue` are already shipped in `src/gatekeeper.js`. Because single-channel `HC-CRC` already cuts top-1 re-ID from `42.0%` to `14.0%` in `< 1 ms` while `AC-CRC` yields `-1.32 pp` at high offline LLM dossier cost, keep `HC-CRC` / `E-LTT` as the online default and document `AC-CRC` strictly as an opt-in offline compliance-audit mode.
3. **Preserve Zero-Import WASM Boundary:** Zero changes to `vendor/wasm/*.wasm` (`imports.length === 0`, `388,797 B` total).

---

## 3. The Three Necessary Upgrades (Parallelizable Tracer-Bullet Tickets)

```text
PARALLEL EXECUTION PLAN (Disjoint Write Scopes -> Final Sync in check-paper-numbers.mjs)
  ├── U1 [CPU/Python] Promote IB-PT-LM Exporter Seam (`src/exporters.js`, `src/perceive.js`) + Main Trainer (`scripts/run-track-d-fair-lora.py`)
  ├── U2 [CPU/Python] Refresh `README.md` (New CLI/API + Wave 2-3 Proof Tables) & Regenerate `docs/end-to-end-pipeline.gif` (`paper/figs/build_end_to_end.py`)
  └── U3 [LaTeX/Node] Synchronize Papers C & D (`paper/versieve-local-training-benchmark.tex`, `paper/versieve-multimodal-sanitization-benchmark.tex`) + `scripts/check-paper-numbers.mjs`
```

*(Note: Only `U2` and `U3` touch `scripts/check-paper-numbers.mjs`; either run `U3` after `U2` or append separate `/* U2 */` and `/* U3 */` blocks at EOF for trivial merge.)*

---

### Upgrade 1 (`U1`): Promote `IB-PT-LM` into the Product Exporter Seam & Main LoRA Trainer

- **Write Scope:**
  - `src/exporters.js`
  - `src/perceive.js` (opt-in `ibPtlmSftJsonl` field or helper; preserve 100% backwards compatibility on default `perceive` / `perceiveMulti` receipts and digests)
  - `bin/versieve.mjs` (accept `--format ib-ptlm` in `versieve sanitize --export-out`)
  - `scripts/run-track-d-fair-lora.py` (flag-gated `--ib-ptlm` & `--ib-beta 0.2` reusing the verified causal non-PII position-aligned counterfactual KL objective from `scripts/run-exploratory-ib-ptlm.py`; default invocation MUST stay byte-identical)
  - `test/ib-ptlm-exporter-and-trainer.test.js`
- **Acceptance Criteria:**
  1. `exportIbPtlmJsonl(perceived, options)` (and `exportTrainingDataset(perceived, { format: 'ib-ptlm' })`) deterministically emits paired counterfactual training records containing two strictly disjoint typed grammatical-role surrogate views (`viewA`, `viewB` with zero surrogate pool overlap across pools A and B, `labels = -100` span masks, aligned non-PII token indices/char spans, and SHA-256 provenance metadata) with **zero raw PII/secrets** in either view.
  2. `versieve sanitize <file> --format ib-ptlm --export-out <path>` writes schema-valid `IB-PT-LM` JSONL.
  3. `scripts/run-track-d-fair-lora.py` supports `--ib-ptlm` (and `--dry-run`) cleanly, failing closed with exit code `2` if GPU/PyTorch/PEFT are absent while leaving default runs untouched.
  4. External-behavior tests verify zero pool overlap (`poolA ∩ poolB = ∅`), zero leaked PII, deterministic seed replay, CLI export, and Python `--ib-ptlm --dry-run` contract.

---

### Upgrade 2 (`U2`): Update `README.md` & Hero Architecture GIF (`docs/end-to-end-pipeline.gif`)

- **Write Scope:**
  - `README.md`
  - `paper/figs/build_end_to_end.py`
  - `docs/end-to-end-pipeline.gif`
  - `scripts/check-paper-numbers.mjs` (append `U2` README verification checks)
- **Acceptance Criteria:**
  1. **New Capabilities in `README.md` ("Use It Now" & "What Comes Out"):**
     - Document one-command CLI sanitization (`npx versieve sanitize report.pdf --diff-report diff.json` & `npx versieve footprint`).
     - Document new `perceiveMulti` options (`detectors` for Presidio/GLiNER/ONNX Stage 3B, `shadowAudit: true`, `numGuard: true`, HIPAA Safe Harbor validators, opt-in `createReversibleVault` / `restoreFromVault`, `includeMerkleRoot`, and `exportTrainingDataset` across `llama-factory-sharegpt`, `llama-factory-alpaca`, `unsloth`, `oumi`, `nemo`, `document-qa`, and `ib-ptlm`).
  2. **Four Verified Wave 2–3 Benchmark Additions in `README.md` (exact numbers pinned to `results/*.json`):**
     - **Gate-Over-Best-Detector & Stitched Shootout (`T8`):** Show `Presidio + ECHR` alone (`27.31%` E2E leak) vs `Versieve HC-CRC + Stage 3A + Presidio` (**`0.00%` leak** at `alpha=0.01`, `27.13%` yield; **`9.06%` leak** at `alpha=0.05`, `77.39%` yield) and contrast against the stitched plain-threshold `0.85`-confidence plateau (`p=0.0002`).
     - **Measured Ease & Forensic Parity (`T9`):** Update the "Why Not Stitch It Yourself?" table with live-measured numbers from `results/ease-benchmark.json` (`1.49 MB` total / `388,797 B` WASM, `1` runtime, `3 LOC`, `115.67 ms` cold start vs `518.86 MB` Presidio+spaCy+detect-secrets, `4` runtimes, `26 LOC`, `14,745.83 ms` cold start) alongside `27/27` `unmasker` forensic specimens and `7/7` `MAT2` zero-residual formats (`screenleak` `91.67%` text / `87.50%` image `IoU >= 0.30` with non-textual avatar caveat).
     - **Adversarial Re-ID (`CPA`) & Scanner-Missed Canaries (`T11`):** Report `HC-CRC` released (`14.0%`, `|C_adv|=9.98`) vs withheld (`42.0%`, `|C_adv|=8.41`) top-1 LLM re-identification (`Fisher p = 1.6e-5`), plus scanner-missed canary reduction (`9.75` -> `6.27` bits under Stage 3A+3B `PT-LM`).
     - **Scale `Document-QA` SFT & `IB-PT-LM` (`T11` + `T12`):** Report 540-Q 3-seed uncapped `document_qa` (**`30.56%` EM**, `+11.11 pp` over composed `19.45%`, `p=0.0005`, narrowing BM25 `34.26%` gap to `-3.70 pp`, `p=0.175`) and `IB-PT-LM` surrogate-memorization reduction (`5.27` -> **`1.15` bits**, `0/12` r1; hidden-state probe `37.50%` -> **`19.79%`**).
  3. **Hero GIF Refresh (`paper/figs/build_end_to_end.py` -> `docs/end-to-end-pipeline.gif`):**
     - Keep the clean 5-card hand-drawn horizontal pipeline + red `eraseEntity` return loop and fixed seed `20301125`, updating the card pills cleanly within card width (`_check(fig)` assertion MUST pass with zero off-canvas/overflow text!):
       - Card 2 (`perceiveMulti()`): note pluggable Stage 3B / forensic parity (`5 zero-import WASM kernels`, `pluggable NER · 27 forensics`, `one salted vault · one graph`, `0 B network egress`)
       - Card 3 (`Ingest + moats`): update `P3` pill to `P3 · IB-PT-LM · LoRA`
       - Card 4 (`Every output`): include `Doc-QA · 6 SFT exporters` and `shadowAudit · Merkle receipt`
     - Rebuild `docs/end-to-end-pipeline.gif` via `C:\Python312\python.exe paper/figs/build_end_to_end.py`.
  4. Extend `scripts/check-paper-numbers.mjs` to assert every newly printed README figure against `results/*.json` (`0` banned words, `0` prose `---` or Unicode `—` em-dashes).

---

### Upgrade 3 (`U3`): Paper C & Paper D Empirical Synchronization

> **Decision Default (Option A — Fold into Papers C & D):** Unless the founder explicitly directs holding `IB-PT-LM` / `CPA` for a standalone Paper E, fold the completed Wave 2–3 measurements into **Paper D** and **Paper C** so the four-paper suite reflects the full verified evidence base.

- **Write Scope:**
  - `paper/versieve-multimodal-sanitization-benchmark.tex`, `.bib`, `.pdf`, `paper/review/D-multimodal-changes.md`
  - `paper/versieve-local-training-benchmark.tex`, `.bib`, `.pdf`, `paper/review/C-local-training-changes.md`
  - `scripts/check-paper-numbers.mjs` (append `U3` checks pinning every new table/prose figure to `results/*.json`)
- **Acceptance Criteria:**
  1. **Paper D (`versieve-multimodal-sanitization-benchmark.tex`):**
     - Add **Gate-Over-Best-Detector & Stitched TAB Shootout** (`results/t8-gate-over-detector-and-stitched-shootout.json`): table/subsection showing `HC-CRC` wrapping `Stage 3A + Presidio` (`0.00%` E2E leak at `alpha=0.01`, `9.06%` at `alpha=0.05` / `77.39%` Safe Yield vs `27.31%` Presidio+ECHR alone) and overcoming spaCy's discrete `0.85`-confidence plateau in the stitched shootout (`p=0.0002`), while stating the honest `GLiNER-Edge` vs `Presidio` boundary at `alpha >= 0.05`.
     - Add **Adversarial Re-Identification Audit (`CPA`) & Dual-Channel `AC-CRC` Note** (`results/t11-cpa-attacker-audit.json`, `results/exploratory-ac-crc.json`): report `14.0%` (`KEEP`) vs `42.0%` (`ABSTAIN`/`DROP`) top-1 `qwen2.5:7b` re-identification (`p=1.6e-5`) and summarize exploratory `AC-CRC` (`-1.32 pp` re-ID vs `+0.84 pp` detector leak, motivating single-channel `HC-CRC` online + opt-in `AC-CRC` offline).
  2. **Paper C (`versieve-local-training-benchmark.tex`):**
     - Add **Scanner-Missed Canary Formats & Full-Scale `Document-QA` SFT** (`results/t11-scanner-missed-canaries.json`, `results/t11-scale-qa-training.json`): report `Stage 3A` (`9.75` bits) vs `Stage 3A+3B PT-LM` (`6.27` bits) on scanner-missed formats, and report 540-question 3-seed uncapped `document_qa` (`30.56%` EM vs `19.45%` composed, `+11.11 pp`, `p=0.0005`, narrowing `bm25_retrieval` `34.26%` gap to `-3.70 pp`, `p=0.175`).
     - Add **Counterfactual Surrogate Information-Bottleneck LoRA (`IB-PT-LM`)** (`results/exploratory-ib-ptlm.json`): present the static-surrogate suffix-inversion finding (`5.27` bits, `5.67/12` r1 on static `PT-LM`) and show `IB-PT-LM` (`beta=0.2`, disjoint pools) reducing surrogate memorization to `1.15` bits (`0.0/12` r1) and 8-way neighboring hidden-state probe accuracy from `37.50%` to `19.79%` (`~2.05x` training wall-clock disclosed honestly).
  3. **Compilation & Style Invariants (`paper/review/EDITOR-RULINGS.md`):**
     - Run `latexmk -pdf -interaction=nonstopmode -f <file>.tex` twice on both Paper C and Paper D (with Git `perl` on `PATH` if needed; clean up `.aux`/`.log`/`.fls`/`.fdb_latexmk`/`.out`/`.bbl`/`.blg`). Must exit `0` with **0 undefined citations/references and 0 overfull hboxes**.
     - Preserve EVERY existing committed baseline number in Papers A–D; obey banned-word rules (*no* `"mathematically grounded"`, `"mathematically certified"`, `"eliminates"`, `"first"` novelty claims, `"no prior"`, LaTeX `---`, or Unicode `—` em-dashes).

---

## 4. Non-Negotiable Judge Gate Before Closing Next Session

Run all four commands yourself on `main` after integrating `U1`–`U3`:

```powershell
node --test test/ib-ptlm-exporter-and-trainer.test.js
node bin/versieve.mjs audit-wasm
node scripts/check-paper-numbers.mjs
npm run test:ci
```

- Commit one logical commit per upgrade (`U1`, `U2`, `U3`) with explicit file paths (`git status -s` first; never `git add -A`; no `Co-Authored-By` trailer; `git checkout -- fixtures/ results/` if CI tests touch CRLF timestamps).
- Push to remote **only** when explicitly instructed by the founder.
