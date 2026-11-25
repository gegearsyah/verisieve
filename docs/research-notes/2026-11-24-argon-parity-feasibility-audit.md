# Feasibility Audit: "Argon-Parity Omnimodal Perception" Phase II Plan

- **Date:** 2026-11-24
- **Auditor:** skeptical-researcher audit (read-only; no benchmark was re-run)
- **Scope:** ground-truth what `matilda-portable` actually ships today, verify reviewer-flagged benchmark contradictions against raw artifacts, and rate the feasibility of each Phase II pillar in `docs/2026-11-24-argon-parity-omnimodal-perception-handoff.md` (the "Argon handoff") and `docs/2026-11-24-versieve-perceive-everything-overnight-handoff.md` (the "overnight handoff").
- **Method:** every number below is read directly from raw result JSONs, scripts, Rust sources, or the shipped `.wasm` binaries — **not** from the handoff docs. Handoff-doc numbers are only ever quoted to be compared against raw data.

---

## 1. Current capability inventory (what the code actually does today)

### 1.1 `src/perceive.js` (745 lines, `main` @ `951f25a`)

| Export | What it actually does | Citation |
|---|---|---|
| `runGraphCoupledConformalRedaction(blocks, opts)` (`GC-CRC`) | Two-pass **text-only** redaction. Pass 1 redacts high-confidence (> 0.50) neural spans and registers them into an in-JS `anchorPool`, seeding the WASM SR-MP ring (`mediaEngine.srmpSeedAnchor`, line 129). Pass 2 promotes low-confidence (0.20–0.50) spans / bare capitalized tokens that match an anchor via WASM Bloom+Soundex query (`srmpQueryCandidate`, lines 205, 264) with a JS fallback Dice loop (lines 217–228). Emits `coupledRiskScore` and `gateAction` (`KEEP_SAFE_REDACTED` \| `QUARANTINE_SECRET`, line 309). | perceive.js:81–319 |
| `perceive(input)` | Trivial wrapper over `perceiveMulti([input])`. | perceive.js:461–464 |
| `perceiveMulti(inputs)` | Dispatch per extension: `.wav` → `redactAudioCall` (line 509), pre-extracted `item.frames` → `redactVideoKeyframes` (line 523), `.png/.jpg` → WASM metadata scrub + **caller-injected** `options.ocrProvider` (line 550, role `IMAGE_OCR`), `.pdf` → born-digital text layer (role `PDF_LINE`, line 570), `.docx` → `extractDocxStructured` (line 586), everything else → `parseEnterpriseBuffer` (`.eml/.msg/.pptx/.xlsx/.vtt/.srt/.har/.ipynb/.ics/.json/.csv/.html/.md/.txt/.zip/.tar.gz`, line 601). Builds tag stream, Markdown, chunks, SFT/PT-LM JSONL, scene timeline, graph index, SHA-256 receipt. | perceive.js:471–745 |

**Block roles actually emitted:** `PARAGRAPH, PDF_LINE, IMAGE_OCR, KEYFRAME_OCR, TRANSCRIPT_TURN, SPEAKER_NOTES, TABLE_ROW, HEADER, PROSE, SECTION_BODY, FOOTNOTE` (emitters in `src/enterprise-parsers.js:355–1781`, `src/structure-extractor.js:181–665`, `src/audio-redactor.js:322`, `src/video-redactor.js:189`).

**What `perceive()` does NOT do (the real gap to "omnimodal"):**
- **OCR:** none built in — image/keyframe OCR runs only if the caller injects `options.ocrProvider` (perceive.js:550).
- **Audio:** transcript-level only; `perceive.js` requires a pre-existing transcript or an injected `asrProvider`. It never looks at the PCM samples itself.
- **Tables:** spreadsheet/XML cell parsing only (`TABLE_ROW` from xlsx `<a:tbl>`/ODS). No **visual** table detection, no raster chart handling, no diagram/arrow handling anywhere.
- **Video:** consumes caller-pre-extracted keyframes (`frames` array with PNG bytes + `frameTimeMs`); `.mp4` decode is external `ffmpeg` — never demuxed in-repo.

### 1.2 `rust/versieve-media/src/` — modules and exports (verified against the shipped binary)

Source modules (`rust/versieve-media/src/`): `lib.rs` (967), `pii_secrets.rs` (1,455), `media_visual.rs` (568), `audio_dsp.rs` (402), `spoken_itn.rs` (360), `cfbf.rs` (426), `inflate.rs` (448), `zip_tar.rs` (416) — 5,042 lines total.

**Handoff claim "27 exports, 190,873 B, 512-slot SR-MP ring": VERIFIED TRUE.** `vendor/wasm/versieve_media.wasm` is exactly 190,873 B with 27 exports (26 `#[no_mangle]` C functions + `memory`), all defined in `lib.rs`: `abi_version, prepare_input, prepare_input2, out_ptr, out_len, meta_ptr, meta_len, err_ptr, err_len, zip_list, zip_extract, tar_load, tar_extract, parse_msg, msg_attachment, scan_pii_secrets, pprl_signature, srmp_reset, srmp_seed_anchor, srmp_query_candidate, spoken_itn, wav_redact, scrub_metadata, redact_pixels, scene_delta, track_boxes`. `SRMP_RING_CAPACITY = 512` at `rust/versieve-media/src/pii_secrets.rs:1244`.

**Existing media capability is narrower than "media" suggests:**
- `audio_dsp.rs`: RIFF/WAV decode (PCM16/24/Float32), metadata chunk strip, sample-accurate redaction (silence/1 kHz beep/pink noise with 5 ms fades), stereo RMS **energy VAD**. **No FFT, no autocorrelation, no pitch, no filterbank, no diarization** (grep over all of `rust/` — zero hits).
- `media_visual.rs`: JPEG/PNG/ISOBMFF **metadata scrubbing** (lines 33, 122, 170, 251); `redact_pixels_inplace` (line 278) operating on **raw RGB** (blackout/pixelate/Gaussian blur); `compute_frame_scene_delta` = 64-bin RGB histogram diff (line 439); `evaluate_temporal_boxes` (line 498). **No pixel *decode* of JPEG/PNG, no connected components, no projection profiles, no dHash, no entropy/edge maps.**
- No image/audio/video code at all in `versieve-clean` / `versieve-dl` / `versieve-sql`; export counts there: 17 / 26 / 10. (**Note:** `vendor/wasm/versieve_graph.wasm` (54,402 B) ships with **no Rust source and no provenance JSON in this repo** — an odd one out vs. `versieve_sql.provenance.json`.)

### 1.3 OCR / ASR / diarization / image-codec / neural capability across the repo

| Component | Reality | Local client-side? |
|---|---|---|
| `src/ocr-engine.js` (1,454 ln) | Real BMP/PNG decoder, tile crop/scale, box stitching, plus a bundled WASM OCR runtime (`vendor/cactus/cactus.wasm`, **1.24 MB**, `mirage.cact` weights) | Yes (self-contained) |
| `src/local-tesseract-ocr.js` (168 ln) | Real local OCR via npm `tesseract.js` with bundled `eng` assets, auto-invert, BMP encoding | Yes |
| `src/neural-pii-onnx.js` (213 ln) | Real GLiNER ONNX tagger (45M/307M tiers); dynamically imports `onnxruntime-node`; **fails closed** if weights absent | Yes when weights provided |
| `src/audio-redactor.js` (344 ln) | Transcript-level WAV redaction; ASR is an injected `asrProvider` OR external local `whisper.cpp` binary (`VERSIEVE_WHISPER_BIN/MODEL`, lines 197–227); fails closed with `ASR_WEIGHTS_REQUIRED` | Yes *given* a local whisper binary; no bundled model |
| `src/video-redactor.js` (453 ln) | Pixel redaction of keyframes via WASM; **`ffmpeg` resolved from env/PATH/`imageio_ffmpeg`** (lines 245–273), fail-closed `FFMPEG_REQUIRED` | Node-only path; no browser video decode |
| Whisper / diarization / prosody / WebCodecs / submodular / dHash | Appear **only** in the two 2026-11-24 handoff docs as planned work | No implementation |
| Python training-machine scripts (`scripts/*.py`) | GLiNER/Presidio/detect-secrets/head-to-head baselines, LoRA training (`run-track-d-fair-lora.py`), figure builders | Dev machine only, not shipped |

### 1.4 `src/sql-wasm.js` / `src/graph-wasm.js`

- **SQL: a real, custom SQL-subset engine in WASM — not SQLite/DuckDB.** Built from `rust/versieve-sql/src/lib.rs` (`vendor/wasm/versieve_sql.wasm`, 49,642 B, zero host imports with recorded provenance). Entry: `executeSqlWasm` (sql-wasm.js:268) with a JS fallback (`executeSqlSubsetFallback`, line 450). Supported: single `SELECT` with `WHERE (AND/OR/NOT/IS NULL/LIKE/=/</>)`, aggregates `COUNT/SUM/AVG/MIN/MAX`, `ROUND`, `GROUP BY`, `ORDER BY`, `LIMIT`. The tests **explicitly assert that joins, `HAVING`, `UNION`, CTEs, and multi-statements are rejected** (`UNSUPPORTED_SQL_SYNTAX`; `test/sql-wasm.test.js:84–150`, where the "misleading DuckDB v1.5.5" label is asserted away). This is the single most important constraint on the Phase II "table-to-SQL" pillar.
- **Graph: real WASM graph engine with Personalized PageRank.** `src/graph-wasm.js` drives `vs_graph_ppr` etc.; `personalizedPageRank(seedIndices, seedWeights, opts)` at graph-wasm.js:126; also `build/prepare_edges/load_csr/serialize_csr/louvain/tarjan_scc/shortest_path/blast_radius`; 11 edge types incl. `REFERS_TO, MENTIONS, SIMILAR_TO` (graph-wasm.js:11–23); exercised by `test/graph-wasm.test.js:44–130` and the `ppr_retrieve` MCP tool.

---

## 2. Benchmark & results reality check (raw data, not the docs)

### 2.1 HC-CRC / E-LTT on TAB — `results/reviewer-tab-and-ltt-benchmarks.json`

The JSON has **no coverage metric and no F1-per-alpha conformal block**; it contains PR curves per tau (0.20–0.80), ablations, and `nonCircularGroundTruthLtt` keyed by **alpha**, not tau. Raw `documentClusteredHcCrc` values (JSON lines 1107–1222; ICC = 0.1276, designEffect = 2.6169, n_eff = 350 in all rows):

| alpha | certified | calibrated tau | FPR % | SafeYield % | AutoRel % | E2E leak % (n) |
|---|---|---|---|---|---|---|
| 0.01 | **true** | 0.38 | 0.18 | 32.98 | 6.35 | 2.36 (3) |
| 0.02 | true | 0.36 | 0.92 | 35.64 | 7.45 | 10.07 (15) |
| 0.05 | true | 0.34 | 2.53 | 39.89 | 9.55 | 21.47 (41) |
| 0.10 | true | 0.28 | 8.19 | 65.16 | 18.91 | 35.19 (133) |
| 0.15 | true | 0.20 | 12.57 | 70.48 | 23.46 | 40.72 (191) |
| 0.20 | true | 0.19 | 15.77 | 72.87 | 26.51 | 44.72 (237) |

E-LTT (`streamingMartingaleELtt`, lines 1223–1326): **not certified at α=0.01/0.02** (maxEValue 1.0); α=0.05: tau 0.38, E=23.763, FPR 0.18; α=0.10: tau 0.30, E=26.835, FPR 5.73, yield 55.85; α=0.15/0.20 as in rows above.

**Paper-vs-data mismatches found in `paper/versieve-multimodal-sanitization-benchmark.tex` (`tab:gt-ltt`, lines 194–213):**
- α=0.10 table row **matches** the JSON. But **α=0.02 (0.99 / 8.00 / 38.30 / 9.38(15)) and α=0.05 (3.70 / 11.81 / 46.81 / 25.00(59)) do NOT match** the JSON (0.92 / 7.45 / 35.64 / 10.07(15) and 2.53 / 9.55 / 39.89 / 21.47(41)); the α=0.05 leak count differs (59 tex vs 41 JSON). No trace of the tex values in any checked-in artifact or git history.
- Prose line 213 and limitations line 311 claim HC-CRC **"fails closed cleanly at α=0.01"** — the raw JSON has `certified = true` at α=0.01 (opposite outcome). The α=0.01/0.02 non-certification belongs to **E-LTT**, not HC-CRC; the tex conflates the two methods.
- E-LTT rows (lines 200, 205) and E-values (23.76 → "23.76"; 26.84 → "26.84") **do match** the JSON.

### 2.2 SR-MP on TAB — the reviewer's τ claim, checked per tau (person PR curves)

| tau | dev-filtered F1 (JSON line) | SR-MP F1 (line) | Δ |
|---|---|---|---|
| 0.20 | 37.56 (563) | 37.01 (733) | −0.55 |
| 0.30 | 47.27 | 45.31 | −1.96 |
| 0.40 | 59.38 | 56.46 | −2.92 |
| 0.50 | **74.20 (810)** | **73.27 (771)** | **−0.93 (drop)** |
| 0.60 | 69.04 | 72.34 | +3.30 |
| 0.70 | 27.88 (709) | **40.78 (795)** | +12.90 |
| 0.80 | 2.88 | 10.43 | +7.55 |

- Reviewer verified: **F1 drops at τ=0.50 and improves only at high τ** — approximately true (it also improves at τ=0.60, and drops at 0.20–0.40). Same shape on the all-maskable level: +3.00 at τ=0.70 (15.74→18.74, lines 453/470, 540/556).
- At the paper's own optimal thresholds (`optThresholds`: allMaskable 0.3, person 0.5, JSON lines 8–10), `versieveHybridSrmpWasm` F1 **45.32 < 45.91** (lines 88/73) and `srmpWasmGlinerPerson` F1 **73.27 < 74.20** (lines 182/169) — **SR-MP is worse than its own baseline at the paper's headline operating points.**
- The all-maskable ablation table (tex lines 142–148) matches the JSON and honestly shows hybrid losing to Stage3A+Code, **but the SR-MP ablation row (45.32 < 45.91) is silently omitted** from that table.
- **The tex τ=0.70 SR-MP row (P 71.20 / R 79.02 / F1 74.91 / directR 87.17, tex lines 155–156, 167, 171) has NO source in any raw JSON, script, or git history**; the recorded τ=0.70 values are P 91.94 / R 26.20 / **F1 40.78** / directR 45.13, tp 251 (JSON lines 794–804). Also internally incoherent: prose says "72.44% → 74.91% (+8.25 pp recall)" — 74.91−72.44 = 2.47, and 8.25 is another experiment's number (audio leakage, §2.4).
- Structural asymmetry (why the shape occurs): `srmp-tab-couple` (`scripts/tab-node-helper.mjs:331–451`) seeds the ring from the model's **own** high-confidence GLiNER spans (no ground truth read — TAB seeding is *not* answer-key leakage), but the baseline hard-filters at score ≥ τ while SR-MP additionally emits weak spans promoted on phonetic coupling (`minDice 0.78`). The lift at high τ is largely "did not throw away low-confidence detections"; the F1 loss at low τ is the extra false positives. No significance test is reported for any SR-MP-vs-baseline comparison.

### 2.3 Secrets scanning throughput — figure/table contradiction CONFIRMED

From `results/reviewer-secrets-audio-pprl-benchmarks.json` (current HEAD, lines 3–45; `steadyStateMBps` computed identically for all tools, run script lines 225–231):

| Tool | HEAD JSON steadyStateMBps | Figure E2 (`paper/figs/fig_e2_secrets_and_evasion.pdf`, built by `paper/figs/build_track_e_figures.py` line 299 from the HEAD JSON) | Paper Table `tab:secrets` (tex lines 230–232, prose 240) |
|---|---|---|---|
| detect-secrets v1.5.0 | **0.11** | 0.11 | **0.13** |
| versieve (media wasm) | **2.51** (in-process 42.15 ms; CLI-with-IO 29.7 ms) | 2.51 | **2.97** (25.55 ms) |
| Gitleaks v8.30.1 | **1.72** | 1.72 | **0.66** |

- The compiled PDF figure **matches the current raw JSON** (same commit `951f25a`); the tex **Table `tab:secrets` matches only the older commit `62eb0e1`** of the same JSON (`git show 62eb0e1:` → 0.13 / 2.97 / 0.66, CLI 25.55 ms). The two versions of the same paper contradict each other, and with HEAD data the claimed "4.5× faster than Gitleaks" (tex line 319 hedges 2.51–2.97 MB/s) collapses to **~1.46×** (2.51 vs 1.72).
- Quality at HEAD is *worse* for the baseline story too: versieve recall 56.55 / F1 72.25 vs detect-secrets 75.86 / 86.27 and Gitleaks 49.66 / 66.36 — versieve does not beat detect-secrets on either.

### 2.4 SR-MP audio benchmark — seeding IS answer-key leakage (reviewer claim CONFIRMED)

`results/reviewer-secrets-audio-pprl-benchmarks.json` lines 47–77: 25 calls, 97 planted PII tokens; pre-exposure 92/97 = **94.85%**; post (isolated ITN+GLiNER redaction) 20/97 = **20.62%** [13.76, 29.71]; post (SR-MP coupled) **8/97 = 8.25%** [4.24, 15.44], −86.60 pp, 21/25 calls zero-leak, 100% non-PII retention.

**But the ring is seeded from the scoring answer key.** `scripts/run-reviewer-secrets-audio-pprl.py:372–379`:

```python
# ... seeded from companion ticket/CRM caller record
srmp_payload.append({..., "contextAnchors": [t for t in c["pii_checks"] if not t.isdigit()]})
```

`c["pii_checks"]` is **the same list** used to score leakage (defined lines 262–288; reuse for scoring at 412–437). The comment says "companion ticket/CRM caller record"; **no CRM record exists in the code — the anchors are literally the planted PII tokens themselves** (digits filtered so scoring isn't trivially identical, names/keywords kept). `scripts/tab-node-helper.mjs:471–539` then seeds each anchor part into the ring at **confidence 0.95** and queries every ASR word against it (`minDice 0.58, coupledScore ≥ 0.50`), silencing matches. The planted tokens are put into the matcher's memory and matched against themselves — the 20.62% → 8.25% improvement is **a self-test, not a capability measurement**. It also contradicts the overnight handoff's own prescription (overnight handoff line 81: seed from "companion metadata/context **(or first high-confidence mention)**").
- A legitimate self-seeding loop (anchors from the pipeline's own ITN-detected spans) does exist (`tab-node-helper.mjs:489–496`) — it is simply dominated by the leaked seeding. Re-running with self-seeding only is the cheapest honest re-measurement available.

### 2.5 PT-LM LoRA training eval — `results/track-d-ptlm-ablation.json` (2026-11-24T05:07:07)

Training config actually recorded in `scripts/run-track-d-fair-lora.py`: LoRA **r=16, α=32, dropout 0.05** (lines 323–330), **lr = 2e-4** (line 293/LearningArguments line 340), **max_steps = 80** (defaults 292, 886), **batch 2 × grad-accum 4**, cosine schedule, warmup 8, **max_len 768**, seed 42, bf16; PT-LM arm masks `labels[t] = -100` on every `<PII:...>` subword (lines 186–263; e.g. `masked_pii_subwords` 2,655 = 5.72% of assistant subwords for qwen15b). Judges: **Ollama `qwen2.5:7b` + cross-family `llama3.2:3b`** (lines 574–575, 794–803), blinded 0–2 rubric, bootstrap + permutation tests. Key results (held_50q / seen_20q):

| model / arm | held F1 | held judge-in % | seen F1 | tag echo held / seen |
|---|---|---|---|---|
| 0.5B T2-SAFE | 0.0993 | 6.2 | 0.0770 | 28% / **85%** |
| 0.5B **T2-PT-LM** | 0.1024 | 16.2 | **0.2705** | **0 / 0** |
| 1.5B T2-SAFE | 0.1119 | 18.8 | 0.1033 | 18% / 65% |
| 1.5B **T2-PT-LM** | **0.1512** | **36.2** | 0.1899 | **0 / 0** |
| LFM3 T2-SAFE | 0.1284 | 17.5 | 0.0830 | 8% / 40% |
| LFM3 **T2-PT-LM** | 0.1476 | 25.0 | **0.2000** | **0 / 0** |

Tag echo 0%, false refusals 0% (vs SAFE 30%/47.5%/20% per model), Carlini exposure unchanged (2.63–3.51 bits) — and **Paper 3's tables match this JSON accurately** (agent verified `paper/versieve-local-training-benchmark.tex` lines 179–208). This is the *strongest honestly-supported result* in the repo, alongside the figure-matching parts of the secrets JSON.

### 2.6 Paper hygiene checks

- **"Versieve" vs "versieve" counts** (exact-case grep of the three .tex): Paper 1: **31** "Versieve" / 18 "versieve"; Paper 2: **14** / 23; Paper 3: **19** / 7. Inconsistent brand with no rule (lowercase survives in tool tokens like `versieve_media.wasm`).
- τ=0.70 isolated SR-MP row: exists in tex (bold as best row) but is **unsupported by any data** (§2.2).
- Figure E2 vs Table `tab:secrets`: contradicts (§2.3). Figure generated from HEAD JSON; table from stale commit `62eb0e1`.
- HC-CRC table rows α=0.02/0.05 and the α=0.01 "fails closed" narrative contradict the raw JSON (§2.1).
- The overnight handoff's own headline numbers ("11.2% FPR overshoot at α=0.10", "13/20 = 65% tag echo") are *close to* but not identical with the JSON values for the specific runs cited; the tag-echo 65% figure is the 1.5B seen-doc SAFE arm (65%) — supported; the 11.2% overshoot claim was not locatable in any raw file.

---

## 3. MLE sibling repo (`C:\Users\GEYE ARDIANSYAH\Downloads\Innovation Hub\MLE`) — light check

- **No LoRA trainer for T2-Chat/PT-LM exists in MLE.** MLE is a Rust/WASM ML-core repo (`mle_core`, `mle_core_dl` VeRA trainer in `core-dl/src/lib.rs` — a small SGD/AdamW LoRA-style loop taking caller-supplied `epochs/batch_size/lr`, documented stand-in config `dModel 16, nLayers 2, rank 4`). The actual T2-Chat/PT-LM training lives in **matilda-portable** (`scripts/run-track-d-fair-lora.py`, §2.5) and per the paper's "RTIO experiment" references in the sibling `Rtio` repo (`experiments/lora-e2e/data/eval_questions.jsonl`, `canaries.json`, imported by the training script at run-track-d-fair-lora.py:52, 61). **Consequence:** the Argon handoff's "Phase 4: Run PT-LM ... in `MLE`" points at the wrong repo — the trainer and GPUs pipeline are in matilda + Rtio, not MLE.
- **Recorded hyperparameters** exist only in the papers/scripts (§2.5 above); no LR/batch config file exists in MLE, and the paper does not record LR or seq len either.
- **Judge models in use:** `qwen2.5:7b` and `llama3.2:3b` (Ollama, blinded; paper lines 119–120), also `lfm3:latest` as an inference comparator. **No DeepSeek anywhere as a judge or trainer**: the only DeepSeek usage in either repo is `deepseek/deepseek-v4.1-flash` (OpenRouter) / `deepseek-v4.1-flash` (Ollama) as a **replication agent in the agent-race experiment** (`MLE/trials/agent-race/run7leg3.mjs:48`, `trials/agent-eval-trap/battery.mjs:40–53`). Zero hits for DeepSeek-R1 or distill variants in MLE, matilda-portable, or the papers ("distill" appears only as generic prose, e.g. `paper/versieve-local-training-benchmark.tex:284`).
- **`mle-handoff` skill** (`MLE/.claude/skills/mle-handoff/SKILL.md`), 5–10 bullets:
  - YAML frontmatter `name: mle-handoff` + trigger description; two modes (generate with no arg / execute a given handoff path).
  - Handoff docs placed at `docs/<YYYY-MM-DD>-<short-scope>-handoff.md` (matches existing dated handoffs).
  - Fixed nine-section order: header+one-line goal → standing rules (verbatim) → current state (measured at write time, never from memory) → numbered stage plan (each stage: exact verify commands, expected output, commit boundary, abort condition; founder-gated stages marked GATE) → skill map → known traps (accumulated) → founder gates → definition of done → run record (appended by the executing session with real commit shas).
  - Tone: factual, anti-narrative — "every claim measured at write time", discrepancies recorded not smoothed; the run record "is allowed to contradict the plan"; handoffs disposable once executed.
  - Explicit "Nothing else" rule; no narrative prose.
  - Verification culture: receipts/digests are the oracle; any failure stops; no hand-regenerated digests; subagent green reports carry no authority.
  - Model routing baked in (lead decides/judges/integrates; subagents write/search).
  - Only checkboxes allowed in the definition-of-done; the founder rule is "graphs in documents, tables okay".
  - Standing meta-rules: no `Co-Authored-By` in commits, explicit-path `git add`, reverse-engineering tool names never mentioned in repo files.
  - **This format is exactly what the Argon handoff doc would need** — the current Argon handoff violates it in the "state" dimension (it quotes numbers not supported by checked-in artifacts, §2.2–2.3).

---

## 4. Feasibility verdict per Phase II pillar

### Pillar I — `WASM-VIG` (DrawingML/PDF-vector diagram & chart recovery + raster inversion + table-to-SQL)

**Partially exists; raster side is greenfield with a hard constraint.**
- **Exists:** pptx/office XML parsing (`parseEnterpriseBuffer`), born-digital PDF text-layer extraction, xlsx/ODS `TABLE_ROW` emission, a real zero-import SQL WASM (49,642 B) with `GROUP BY`/`ORDER BY`/aggregates and a JS fallback.
- **Missing:** `<p:cxnSp>` connector-arrow and `chart*.xml` chart-series extraction in `enterprise-parsers.js`; PDF content-stream vector-path parsing (`m/l/re/S/f`) in `pdf-parser.js`; the entire raster kernel (`visual_perception.rs` does not exist — nearest is `media_visual.rs` raw-RGB ops only); `perceive()`'s automatic table→SQL bridge (nothing in perceive.js calls `executeSqlWasm` today).
- **Hard blocker A — SQL joins.** The plan repeatedly promises `SELECT ... JOIN ... GROUP BY` (Argon handoff lines 100–103) but `versieve_sql.wasm` **explicitly rejects JOIN** (`UNSUPPORTED_SQL_SYNTAX`, `test/sql-wasm.test.js:84–150`; custom 2,000-line engine, no SQLite). Either implement joins in the custom engine (real work, moderate), or re-scope to single-table queries (feasible today).
- **Hard blocker B — raster decode.** `versieve_media.wasm` has **no JPEG/PNG pixel decoder**; the planned kernels take `rgb_ptr`, so pixel decode must come from elsewhere: browser `<canvas>` (browser-only, fine for the story but not "in-WASM"), the BMP/PNG decoders in `ocr-engine.js` (PNG yes, JPEG no), tesseract.js assets (JPEG via its pipeline), or a no_std JPEG decoder (would very likely blow the 215 KB binary cap by itself).
- **Hard blocker C — size budget.** `versieve_media.wasm` is already **190,873 B against the self-imposed < 215 KB cap** (Argon handoff line 125) — **~24 KB headroom** for four new kernels (dHash + region segmentation + chart inversion + prosody/diarization). The raster-region classifier + least-squares chart fitter alone will not fit without code golf, a cap renegotiation, or a second binary.
- Workload 2 (synthetic raster ground truth) is easy to generate with fixed seeds; the "RelErr ≤ 2%" affine-calibration target is realistic for **synthetic clean charts** and unrealistic for arbitrary real-world ones (axis ticks must first be OCR'd at high precision; the only OCR paths are tesseract.js / cactus, both already larger than the whole WASM engine).

### Pillar II — `WASM-APSD` (YIN pitch + filterbank timbre + diarization + deictic grounding)

**Partially exists — cheapest of the four pillars technically, blocked on ASR and video decode.**
- **Exists:** WAV PCM16/24/Float32 decode in `audio_dsp.rs`; RMS energy VAD; sample-accurate span muting; Spoken ITN in WASM; transcript blocks with roles in `perceiveMulti`; pre-existing pipeline plumbing for `.wav` calls.
- **Missing:** everything acoustic-analytic — **no FFT, no autocorrelation, no YIN, no filterbank, no formant proxy, no clustering** anywhere in `rust/` (grep-verified). All are implementable in no_std: integer autocorrelation/YIN over 20 ms frames, 12-band log-energy filterbank, and online agglomerative/cosine clustering in static buffers are each small (tens of KB of code, though the binary headroom above still applies). Realistic: pitch + energy + ZCR features and 2-to-4-speaker clustering on synthetic dialogues with distinct F0 (Workspace 3) is achievable; BIC-regularized k-means with DER-style guarantees on real calls is aspirational.
- **Hard blocker A — ASR.** Perceive treats audio as a transcript; both ASR paths are fail-closed externals (`ASR_WEIGHTS_REQUIRED`, `whisper.cpp` binary). Bench workspaces involving spoken content require the developer machine's whisper.cpp; there is no browser-story ASR.
- **Hard blocker B — video.** Workspace 4 (`.mp4` with deictic voiceover) requires video demux/decode: **none in WASM, none in browser-agnostic code** — only external `ffmpeg` (`FFMPEG_REQUIRED`, video-redactor.js:245–273). WebCodecs is browser-only and would sit outside the "zero-import WASM" claim. A deictic-binding demo can be faked over pre-extracted keyframes + `.vtt`/transcripts (plumbing already exists), but "keyframe at t=42.5 from an mp4" is not achievable client-side in this architecture.
- Deictic grounding itself (`resolveDeicticCrossModalBindings`) is keyword/regex + timestamp-overlap heuristics in JS over blocks that already carry timestamps — moderate, feasible, and largely independent of the WASM kernels.

### Pillar III — `IB-AMP` (dHash64 submodular frame/tile triage)

**Partially exists; smallest delta, but watch the cap.**
- **Exists:** per-frame infrastructure in `redactVideoKeyframes`; a 64-bin scene-change delta (`compute_frame_scene_delta`, media_visual.rs:439) that already gives the cheap "surprisal/change" signal h(u); JS-side dedup hashing habits; lazy-greedy submodular selection is plain JS over 3,600 items — trivial compute.
- **Missing:** `vs_media_perceptual_dhash64` (greenfield but tiny — a ~50–80 line no_std kernel over raw RGB + gradient comparison with the caller supplying decoded pixels); the cost model c(s) (needs real measured Pass-1/Pass-2 latencies, which do not exist as measurements today); the (1−1/e) framing is textbook and defensible, but the "90–98% frame pruning" claim in the handoff is currently unsupported by any measurement — it must be earned with a bench run.
- No new external dependency; only the binary-headroom constraint applies and dHash is small.

### Pillar IV — `Argon-Perceive-Bench` (6 synthetic workspaces, 60 multi-hop questions)

**Greenfield infrastructure, but the repo has strong precedent — and one demonstrated failure mode to design against.**
- The scripts/ directory shows the team can build self-contained benchmarks (TAB ingest, 25-call audio, 124,750-pair PPRL scale test, Carlini canary protocol). The six workspaces are constructible with fixed seeds (pptx with DrawingML connectors, synthetic raster charts, 2-speaker PCM WAV, keyframe+transcript pseudo-video, xlsx+PDF-GT tables).
- **Design blocker — evaluator circularity is already a proven risk in this codebase** (§2.4). Any workspace where the engine is seeded from workspace ground truth (audio contexts, chart ground-truth series, table GT) re-introduces the same leak. The bench spec must enforce: seeding only from engine-observable context, GT held in the scorer only; a reviewer assertion in CI that no GT token flows into `contextAnchors`/seed arguments.
- **Scoping caution — "Gemini Argon as oracle":** the plan's "% of Argon Oracle" metrics are currently just hand-labeled synthetic GT percentages (no frontier model in the loop — correctly, given zero-egress); the framing should say so or the same bias critique applies a third time.
- The plan's size-budget line ("< 400 KB total zero-import WASM", line 111) is inconsistent with the same doc's 215 KB cap on `versieve_media.wasm` (line 125) plus the existing ~365 KB across the other four binaries — the two constraints already conflict before Phase II adds a byte.

### Cross-cutting integrity findings (must be fixed before any Phase II benchmark is published)

1. Unsupported tex numbers: τ=0.70 SR-MP row (74.91/87.17), HC-CRC α=0.02/0.05 rows, α=0.01 "fails closed" narrative — no source artifact exists (§2.1–2.2).
2. Figure E2 vs Table `tab:secrets` stale-data divergence; "4.5× vs Gitleaks" claim now ~1.46× (§2.3).
3. Audio SR-MP 8.25% result is circular (answer-key seeding) even though faithfully transcribed (§2.4).
4. SR-MP worse than baseline at the paper's own operating points, and the losing ablation row is omitted from the table (§2.2).
5. "Versieve"/"versieve" brand drift across all three papers; "Versieve N=1,268" vs repo name versieve.

---

## 5. Verdict table — what is real vs what is aspirational

| Claim / pillar | Status | Evidence |
|---|---|---|
| Zero-import WASM kernels, 5 binaries, 0 host imports | **REAL** | `vendor/wasm/*.wasm` + provenance + audit (`bin/versieve.mjs audit-wasm`) |
| `versieve_media.wasm` 190,873 B / 27 exports / 512-slot SR-MP ring | **REAL, verified** | binary inspected; `pii_secrets.rs:1244` |
| `perceive()`/`perceiveMulti()` omnimodal scene graph | **PARTIAL — text/tabular only**; OCR/ASR injection points, no chart/diagram/diarization | perceive.js:471–745 |
| GC-CRC + SR-MP on TAB | **REAL code, REAL numbers — but SR-MP loses at the paper's operating points and the τ=0.70 win row is fabricated** | §2.2 |
| SR-MP audio 20.62% → 8.25% | **MEASURED BUT CIRCULAR** (seeded from answer key) | §2.4, run-reviewer-secrets-audio-pprl.py:372–379 |
| Secrets throughput "4.5× vs Gitleaks" | **REAL numbers exist; claim is stale** — HEAD shows ~1.46×, figure/table contradict | §2.3 |
| HC-CRC (document-clustered CRC) | **REAL, certified across α; some tex rows unsupported / narrative contradicts data** | §2.1 |
| E-LTT | **REAL; not certifiable at α ≤ 0.02 (correctly reported in JSON, muddled in tex prose)** | §2.1 |
| PT-LM LoRA (tag echo 65% → 0%) | **REAL, supported end-to-end** — but trained in matilda/Rtio, *not* MLE | §2.5, §3 |
| Table-to-SQL with JOINs | **BLOCKED** — engine explicitly rejects JOIN | test/sql-wasm.test.js:84–150 |
| WASM-VIG raster chart inversion / diagram detection | **GREENFIELD**; needs raster decode path + ~24 KB binary headroom that does not exist | §1.2, §4 Pillar I |
| WASM-APSD YIN/filterbank/diarization | **GREENFIELD (implementable)** in no_std; ASR external + video decode absent | §4 Pillar II |
| IB-AMP dHash triage | **NEARLY EXISTS** (scene_delta there; dHash + lazy greedy + measured cost missing) | §4 Pillar III |
| Argon-Perceive-Bench 6 workspaces | **GREENFIELD, feasible; must design out the demonstrated evaluator-circularity failure mode** | §2.4, §4 Pillar IV |
| "Faster-whisper base/small" baselines, RTX 4070 suite | **REAL (developer-machine scripts only)**; fail-closed in shipped library | §1.3 |
| "Gemini Argon parity" as benchmarked concept | **ASPIRATIONAL / FRAMING GAMBIT** — the "oracle" would be synthetic hand GT, no frontier model in loop | §4 Pillar IV |

**Hard blockers summary:** (a) no raster image *decode* in no_std WASM (JPEG absent entirely; PNG only in JS `ocr-engine.js`); (b) no video demuxer/decoder anywhere client-side (external ffmpeg, Node-only, fail-closed); (c) SQL engine explicitly rejects JOIN while the plan promises JOINs; (d) ~24 KB binary headroom against the 215 KB cap for four new kernels; (e) ASR and ML inference are fail-closed externals, so every "perception" benchmark silently requires the training machine; (f) `versieve_graph.wasm` has no in-repo source or provenance — an unowned artifact the whole graph story leans on.

---

## 6. Five cheapest, highest-value implementable next steps

1. **Reconcile the paper with its own raw data (hours, no code).** Regenerate Table `tab:secrets`, the HC-CRC α=0.02/0.05 rows, and the "fails closed at α=0.01" prose from `results/*.json` HEAD; delete or re-support the τ=0.70 SR-MP row; regenerate both from a single JSON with a CI check that every tex number greps to a raw file. Highest value: it removes the reviewer-cited contradictions cheaply.
2. **Re-run the audio benchmark with self-seeding only** (drop the `pii_checks`→`contextAnchors` seeding; keep the legitimate ITN-detected-self-seeding path at `scripts/tab-node-helper.mjs:489–496`) and publish the honest number, whatever it is; assert in the script that scoring tokens cannot reach seed arguments.
3. **pptx DrawingML connectors + chart XML series** (`parsePptxBuffer` in `src/enterprise-parsers.js`): pure JS XML parsing, zero WASM-size cost, directly enables Bench Workspaces 1/2 vector-side and the diagram-edge story into `versieve_graph.wasm` (edges already supported: `REFERS_TO`/`RELATES_TO`).
4. **`vs_media_perceptual_dhash64` + JS lazy-greedy selector (IB-AMP):** smallest WASM delta (~1–2 KB), reuses `scene_delta` as the entropy proxy and existing keyframe plumbing; produce the first measured pruning-rate curve the plan claims (90–98%) on the keyframe fixtures.
5. **Prosody kernel v1 in `audio_dsp.rs`:** per-VAD-segment F0 (integer autocorrelation/YIN variant), RMS, ZCR, wpm → speaker-clustering-lite on Workspace 3 synthetic dialogues. Independent of ASR (works on PCM the library already decodes), small, and it turns the diarization claim from greenfield into code.
