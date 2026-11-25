---
name: versieve-local-train
description: Deterministic capture, Rust WASM cleaning (boilerplate strip, dedup, token window, PII mask), multi-axis customer gatekeeper calibration (Safe, Useful, Topic), and zero-setup local open-weight LoRA fine-tuning via Astral uv (TRL/PEFT or Apple MLX) without raw data leaving the user's device.
---

# Versieve × RTIO Local Clean & Open-Weight Training

Use this portable workflow when cleaning raw documents or URLs locally on a user's machine and fine-tuning a small local gatekeeper or open-weight LLM without uploading raw records to cloud APIs.

## Workflow

1. **Deterministic Capture & Clean (Rust WASM)**
   - Run browser-local ingestion in RTIO `/sandbox` (`Clean` tab — supports PDF, `.docx`, images, CSV/JSON/TXT/MD, and direct/fallback URL lists) or call the `versieve` MCP server (`ingest_and_tokenize` / `ingest_url_or_links`).
   - All deterministic cleaning runs through `versieve_clean.wasm`:
     - HTML / navigation chrome boilerplate stripping
     - Exact FNV-1a + 64-lane MinHash near-deduplication (`>= 0.85` Jaccard)
     - Deterministic token-window chunking
     - Automatic PII redaction (`<EMAIL>`, `<PHONE>`, `<SSN>`, `<PERSON>`, etc.)

2. **Customer-Label Multi-Axis Gate Calibration (`Safe` · `Useful` · `Topic`)**
   - Review borderline rows (`ABSTAIN_HUMAN_REVIEW`) locally and label them along three independent binary axes:
     - `Safe`: free of unmasked sensitive content / unsafe text
     - `Useful`: clean, informative signal worth learning from
     - `Topic`: on-domain for the target adapter or downstream task
   - Calibrate the local conformal gate thresholds via `Calibrate S·U·T` (in UI) or MCP `train_multiaxis_gatekeeper` + `gatekeeper_decide_multiaxis`. Raw customer labels stay on-device.

3. **Compare Raw vs. Safe & Export Corpus Manifest**
   - Inspect `original_text` vs. `safe_text` side-by-side in DuckDB (`Data` tab -> `Compare raw`), filter keep/review/drop decisions, and export:
     - `rtio-train.jsonl` (masked clean training corpus)
     - `rtio-manifest.json` (deterministic counts, hashes, source URLs/files, and token totals)

4. **Local Open-Weight LoRA Fine-Tuning (Zero-Code Companion)**
   - Remember: WebAssembly (`versieve_dl.wasm`) trains compact 1.58-bit / VeRA local gatekeeper routers directly in the browser, whereas full multi-hundred-million-parameter `.gguf` / `.safetensors` open weights fine-tune natively via Python/Metal on the host CPU/GPU.
   - JSONL `messages` rows use the selected tokenizer's chat template when available; the runner falls back to explicit role-tagged text otherwise. CPU-only runs load without CUDA device mapping.
   - Generate the native training command using MCP `plan_local_open_weight_training` or the RTIO `/sandbox` `Train` tab:

   **Linux / Windows CUDA / CPU (PEP-723 single command via Astral `uv`):**
   ```bash
   uv run scripts/versieve-train.py \
     --data rtio-train.jsonl \
     --model Qwen/Qwen2.5-0.5B-Instruct \
     --output ./versieve-lora-out \
     --epochs 1 \
     --bridge-port 8765
   ```

   **Apple Silicon Unified Memory (MLX LoRA):**
   ```bash
   uvx --from mlx-lm mlx_lm.lora \
     --model mlx-community/Qwen2.5-0.5B-Instruct-4bit \
     --train \
     --data . \
     --iters 200 \
     --adapter-path ./versieve-lora-out
   ```

5. **Optional Live Loss Bridge (`127.0.0.1`)**
   - `scripts/versieve-train.py` binds a read-only `127.0.0.1:8765` status endpoint returning `Access-Control-Allow-Private-Network: true` and CORS headers so the browser Sandbox can display real-time training step, epoch, and loss curves locally while keeping weights and raw data offline. The endpoint remains available for five seconds after training by default; adjust with `--hold-seconds`.
