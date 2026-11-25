# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "trl>=0.12.0",
#   "peft>=0.13.0",
#   "datasets>=3.0.0",
#   "transformers>=4.46.0",
#   "accelerate>=1.0.0",
#   "torch>=2.3.0",
# ]
# ///
"""Versieve x RTIO local open-weight LoRA trainer (Track C3).

Runs 100% locally via Astral uv (`uv run versieve-train.py --data rtio-graph-sft.jsonl`)
with:
  - Single clean EOS invariant (strips duplicate/baked trailing EOS before SFTTrainer)
  - Safe base-model pad_token handling (avoids pad_token == eos_token EOS logit collapse)
  - Sequence packing (`--packing`, default True for `packed_passage` corpora)
  - Auto target-module detection across LFM3, Qwen2.5, Llama, and Mistral architectures
  - Live 127.0.0.1 loopback telemetry bridge with Private Network Access headers
"""

from __future__ import annotations

import argparse
import inspect
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SPECIAL_TRAILING_EOS_TOKENS = (
    "<|im_end|>",
    "<|endoftext|>",
    "<|eot_id|>",
    "<|end|>",
    "</s>",
)

CANDIDATE_PAD_TOKENS = (
    "<|pad|>",
    "<pad>",
    "<|fim_pad|>",
    "<|reserved_special_token_0|>",
)

CANDIDATE_LORA_TARGET_MODULES = (
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "out_proj",
    "in_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
    "w1",
    "w2",
    "w3",
    "fc1",
    "fc2",
)

DEFAULT_LORA_TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]

RAW_PII_AUDIT_PATTERNS = (
    re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:sk-ant-|sk-proj-|sk_live_|rk_live_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[bpasr]-|AIza|SG\.|npm_|pypi-|hf_)[A-Za-z0-9._-]{16,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps)://[^:\s]+:[^@\s]+@[^\s]+", re.IGNORECASE),
)
CANDIDATE_CARD_PATTERN = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def is_valid_luhn_card(raw_text: str) -> bool:
    digits = [int(c) for c in raw_text if c.isdigit()]
    if len(digits) < 13 or len(digits) > 19:
        return False
    # Major payment card IIN prefixes (Visa 4, MC 51-55/2221-2720, Amex 34/37, Discover 6011/65)
    s = "".join(str(d) for d in digits)
    if not (s.startswith("4") or s.startswith(("51", "52", "53", "54", "55", "34", "37", "6011", "65")) or (2221 <= int(s[:4]) <= 2720)):
        return False
    checksum = 0
    parity = len(digits) % 2
    for idx, d in enumerate(digits):
        if idx % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


def count_raw_pii_hits(text: str) -> int:
    hits = 0
    for pat in RAW_PII_AUDIT_PATTERNS:
        hits += len(pat.findall(text))
    for match in CANDIDATE_CARD_PATTERN.finditer(text):
        if is_valid_luhn_card(match.group(0)):
            hits += 1
    return hits


def start_loopback_bridge(port: int, state: dict, lock: threading.Lock) -> ThreadingHTTPServer:
    class StatusHandler(BaseHTTPRequestHandler):
        def _write_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._write_cors_headers()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if self.path not in ("/status", "/health", "/"):
                self.send_response(404)
                self._write_cors_headers()
                self.end_headers()
                return
            with lock:
                payload = json.dumps(state).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._write_cors_headers()
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), StatusHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def strip_trailing_eos_tokens(text: str, eos_token: str | None = None) -> str:
    """Strip any baked-in or repeated trailing EOS markers so SFTTrainer appends EOS cleanly once."""
    cleaned = str(text or "").rstrip()
    markers = list(SPECIAL_TRAILING_EOS_TOKENS)
    if eos_token and eos_token not in markers:
        markers.insert(0, eos_token)

    changed = True
    while changed and cleaned:
        changed = False
        for marker in markers:
            if marker and cleaned.endswith(marker):
                cleaned = cleaned[: -len(marker)].rstrip()
                changed = True
    return cleaned


def configure_tokenizer_for_sft(tokenizer: Any) -> dict[str, Any]:
    """Configure padding safely for base & instruct causal LMs.

    Prefers an existing distinct pad/unk token from vocab so `pad_token_id != eos_token_id`
    (preventing base-model immediate-EOS collapse). Falls back to `eos_token` only with
    explicit `pad_equals_eos=True` telemetry so callers enforce packing or attention-mask
    label masking (`labels[attention_mask == 0] = -100`).
    """
    tokenizer.padding_side = "right"
    eos_token = getattr(tokenizer, "eos_token", None)
    eos_token_id = getattr(tokenizer, "eos_token_id", None)
    pad_token = getattr(tokenizer, "pad_token", None)
    pad_token_id = getattr(tokenizer, "pad_token_id", None)

    chosen_source = "existing_pad"
    if pad_token is None or pad_token_id is None:
        unk_token = getattr(tokenizer, "unk_token", None)
        unk_token_id = getattr(tokenizer, "unk_token_id", None)
        vocab = tokenizer.get_vocab() if callable(getattr(tokenizer, "get_vocab", None)) else {}

        if unk_token and unk_token != eos_token and unk_token_id != eos_token_id:
            tokenizer.pad_token = unk_token
            if hasattr(tokenizer, "pad_token_id") and unk_token_id is not None:
                tokenizer.pad_token_id = unk_token_id
            chosen_source = "unk_token"
        else:
            picked = None
            for cand in CANDIDATE_PAD_TOKENS:
                if cand in vocab and cand != eos_token and vocab[cand] != eos_token_id:
                    picked = cand
                    break
            if picked is not None:
                tokenizer.pad_token = picked
                if hasattr(tokenizer, "pad_token_id"):
                    tokenizer.pad_token_id = vocab[picked]
                chosen_source = "vocab_reserved_pad"
            else:
                tokenizer.pad_token = eos_token
                if hasattr(tokenizer, "pad_token_id") and eos_token_id is not None:
                    tokenizer.pad_token_id = eos_token_id
                chosen_source = "eos_fallback_requires_packing_or_attn_mask"

    final_pad_id = getattr(tokenizer, "pad_token_id", None)
    final_pad_tok = getattr(tokenizer, "pad_token", None)
    pad_equals_eos = (
        (final_pad_id is not None and eos_token_id is not None and final_pad_id == eos_token_id)
        or (final_pad_tok is not None and eos_token is not None and final_pad_tok == eos_token)
    )
    return {
        "pad_token": final_pad_tok,
        "pad_token_id": final_pad_id,
        "eos_token": eos_token,
        "eos_token_id": eos_token_id,
        "pad_equals_eos": bool(pad_equals_eos),
        "pad_source": chosen_source,
    }


def mask_padding_labels(
    input_ids: list[int],
    attention_mask: list[int],
    pad_token_id: int | None = None,
    eos_token_id: int | None = None,
) -> list[int]:
    """Mask ONLY padded positions (`attention_mask == 0`) to -100, preserving real EOS tokens."""
    del pad_token_id, eos_token_id
    return [tok if mask == 1 else -100 for tok, mask in zip(input_ids, attention_mask)]


def detect_target_modules(model: Any, requested: str = "auto") -> list[str]:
    """Auto-detect attention + MLP projection layers for LFM3, Qwen2.5, Llama, and Mistral."""
    req = str(requested or "auto").strip()
    if req and req.lower() != "auto":
        parsed = [part.strip() for part in req.split(",") if part.strip()]
        if parsed:
            return parsed

    discovered: set[str] = set()
    named_modules_fn = getattr(model, "named_modules", None)
    if callable(named_modules_fn):
        for full_name, _ in named_modules_fn():
            leaf = full_name.rsplit(".", 1)[-1]
            if leaf in CANDIDATE_LORA_TARGET_MODULES:
                discovered.add(leaf)

    if discovered:
        return [m for m in CANDIDATE_LORA_TARGET_MODULES if m in discovered]
    return list(DEFAULT_LORA_TARGET_MODULES)


def load_clean_jsonl(data_path: Path) -> list[dict]:
    rows: list[dict] = []
    for raw_line in data_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        rec = json.loads(line)
        mode = str(rec.get("mode", "")).strip()

        if mode == "packed_passage" and isinstance(rec.get("text"), str) and rec["text"].strip():
            rows.append({"mode": "packed_passage", "text": rec["text"].strip()})
        elif isinstance(rec.get("messages"), list):
            messages = [
                {"role": str(m.get("role", "user")), "content": str(m["content"])}
                for m in rec["messages"]
                if isinstance(m, dict) and isinstance(m.get("content"), str) and m["content"].strip()
            ]
            if messages:
                fallback = "\n\n".join(
                    f"### {m['role'].capitalize()}\n{m['content'].strip()}" for m in messages
                ).strip()
                rows.append({"mode": mode or "messages", "messages": messages, "fallback_text": fallback})
        elif isinstance(rec.get("safe_text"), str) and rec["safe_text"].strip():
            rows.append({"mode": mode or "text", "text": rec["safe_text"].strip()})
        elif isinstance(rec.get("raw_clean_text"), str) and rec["raw_clean_text"].strip():
            rows.append({"mode": mode or "text", "text": rec["raw_clean_text"].strip()})
        elif isinstance(rec.get("text"), str) and rec["text"].strip():
            rows.append({"mode": mode or "text", "text": rec["text"].strip()})
        elif isinstance(rec.get("prompt"), str) and isinstance(rec.get("completion"), str):
            combined = f"{rec['prompt']}\n{rec['completion']}".strip()
            if combined:
                rows.append({"mode": mode or "text", "text": combined})
    return rows


def format_training_rows(
    raw_rows: list[dict],
    tokenizer: Any,
    strip_trailing_eos: bool = True,
) -> list[dict[str, str]]:
    has_template = bool(getattr(tokenizer, "chat_template", None))
    eos_token = getattr(tokenizer, "eos_token", None)
    formatted: list[dict[str, str]] = []

    for rec in raw_rows:
        if "messages" in rec:
            if has_template:
                text = tokenizer.apply_chat_template(
                    rec["messages"],
                    tokenize=False,
                    add_generation_prompt=False,
                )
            else:
                text = rec["fallback_text"]
        else:
            text = rec.get("text", "")

        if not isinstance(text, str):
            continue
        if strip_trailing_eos:
            text = strip_trailing_eos_tokens(text, eos_token=eos_token)
        text = text.strip()
        if text:
            formatted.append({"text": text})
    return formatted


def pack_token_sequences(
    token_id_lists: list[list[int]],
    eos_token_id: int,
    max_seq_length: int,
) -> list[list[int]]:
    """Pack token sequences into fixed-length blocks separated by exactly ONE clean EOS token."""
    stream: list[int] = []
    for seq in token_id_lists:
        clean = list(seq)
        while clean and clean[-1] == eos_token_id:
            clean.pop()
        if not clean:
            continue
        # Also collapse any accidental internal adjacent duplicate EOS tokens
        deduped: list[int] = []
        for tok in clean:
            if tok == eos_token_id and deduped and deduped[-1] == eos_token_id:
                continue
            deduped.append(tok)
        stream.extend(deduped)
        stream.append(eos_token_id)

    if not stream:
        return []

    blocks: list[list[int]] = []
    for i in range(0, len(stream), max_seq_length):
        block = stream[i : i + max_seq_length]
        if block:
            blocks.append(block)
    return blocks


def count_double_eos(token_sequences: list[list[int]], eos_token_id: int | None) -> int:
    if eos_token_id is None:
        return 0
    doubles = 0
    for seq in token_sequences:
        for i in range(len(seq) - 1):
            if seq[i] == eos_token_id and seq[i + 1] == eos_token_id:
                doubles += 1
    return doubles


def audit_formatted_dataset(
    formatted_rows: list[dict[str, str]],
    tokenizer: Any,
    max_seq_length: int = 1024,
    pack: bool = True,
) -> dict[str, Any]:
    """Deterministic pre-flight audit for EOS integrity, sequence lengths, and raw PII leakage."""
    eos_token_id = getattr(tokenizer, "eos_token_id", None)
    unpacked_seqs: list[list[int]] = []
    raw_pii_hits = 0

    for row in formatted_rows:
        txt = row.get("text", "")
        raw_pii_hits += count_raw_pii_hits(txt)
        ids = tokenizer.encode(txt, add_special_tokens=False)
        if eos_token_id is not None:
            ids = list(ids) + [eos_token_id]
        unpacked_seqs.append(ids)

    packed_seqs = (
        pack_token_sequences(unpacked_seqs, eos_token_id, max_seq_length)
        if (pack and eos_token_id is not None)
        else unpacked_seqs
    )
    double_eos_unpacked = count_double_eos(unpacked_seqs, eos_token_id)
    double_eos_packed = count_double_eos(packed_seqs, eos_token_id)

    mean_unpacked = (
        sum(len(s) for s in unpacked_seqs) / len(unpacked_seqs) if unpacked_seqs else 0.0
    )
    mean_packed = sum(len(s) for s in packed_seqs) / len(packed_seqs) if packed_seqs else 0.0

    return {
        "row_count": len(formatted_rows),
        "packed_block_count": len(packed_seqs),
        "mean_unpacked_tokens": round(mean_unpacked, 2),
        "mean_packed_tokens": round(mean_packed, 2),
        "double_eos_count": double_eos_unpacked + double_eos_packed,
        "raw_pii_hits": raw_pii_hits,
    }


def resolve_packing_flag(args_packing: bool | None, raw_rows: list[dict]) -> bool:
    if args_packing is not None:
        return bool(args_packing)
    return any(r.get("mode") == "packed_passage" for r in raw_rows)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Train a local LoRA adapter from cleaned Versieve/RTIO graph-grounded JSONL"
    )
    parser.add_argument("--data", default="rtio-graph-sft.jsonl", help="Path to exported cleaned JSONL file")
    parser.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct", help="HuggingFace repo ID or local model directory")
    parser.add_argument("--output", default="./versieve-lora-out", help="Adapter output directory")
    parser.add_argument("--epochs", type=int, default=1, help="Number of fine-tuning epochs")
    parser.add_argument("--max-steps", type=int, default=-1, help="Optional cap on optimizer steps (-1 = full epochs)")
    parser.add_argument("--trust-remote-code", action="store_true", default=False, help="Pass trust_remote_code=True when loading local/custom architectures like LFM3")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--max-seq-length", type=int, default=1024, help="Maximum sequence length (e.g. 1024 or 2048)")
    parser.add_argument("--lora-r", type=int, default=16, help="LoRA rank r (default 16)")
    parser.add_argument("--lora-alpha", type=int, default=32, help="LoRA alpha (default 32)")
    parser.add_argument(
        "--target-modules",
        default="auto",
        help="Comma-separated LoRA target module names or 'auto' for LFM3/Qwen2.5/Llama auto-detection",
    )
    parser.add_argument(
        "--packing",
        dest="packing",
        action="store_true",
        default=None,
        help="Enable sequence packing (auto-enabled for packed_passage corpora)",
    )
    parser.add_argument(
        "--no-packing",
        dest="packing",
        action="store_false",
        help="Disable sequence packing",
    )
    parser.add_argument(
        "--assistant-only-loss",
        action="store_true",
        default=False,
        help="Compute SFT loss only on assistant response tokens (when supported by trl)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Validate JSONL formatting, EOS integrity, sequence lengths, and PII audit without loading weights",
    )
    parser.add_argument("--bridge-port", type=int, default=8765, help="127.0.0.1 loopback telemetry port")
    parser.add_argument("--hold-seconds", type=int, default=5, help="Keep loopback status endpoint alive after completion")
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    raw_rows = load_clean_jsonl(Path(args.data))
    if not raw_rows:
        raise ValueError(f"No trainable non-empty records found in {args.data}")

    use_packing = resolve_packing_flag(args.packing, raw_rows)

    if args.dry_run:
        class _WhitespaceTokenizer:
            eos_token = "<|endoftext|>"
            eos_token_id = 2
            pad_token = None
            pad_token_id = None
            unk_token = None
            unk_token_id = None
            chat_template = None
            padding_side = "right"

            def get_vocab(self):
                return {"<|endoftext|>": 2}

            def encode(self, text: str, add_special_tokens: bool = False):
                ids = [100 + (abs(hash(w)) % 50000) for w in text.split()]
                return ids + ([2] if add_special_tokens else [])

        tok = _WhitespaceTokenizer()
        pad_info = configure_tokenizer_for_sft(tok)
        formatted = format_training_rows(raw_rows, tok, strip_trailing_eos=True)
        audit = audit_formatted_dataset(formatted, tok, max_seq_length=args.max_seq_length, pack=use_packing)
        print(json.dumps({"dry_run": True, "packing": use_packing, "pad_info": pad_info, "audit": audit}, indent=2))
        return

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback
    from trl import SFTConfig, SFTTrainer

    state_lock = threading.Lock()
    bridge_state: dict = {
        "running": True,
        "step": 0,
        "totalSteps": 0,
        "epoch": 0.0,
        "loss": None,
        "model": args.model,
        "dataset": args.data,
        "outputDir": args.output,
        "packing": use_packing,
        "maxSeqLength": args.max_seq_length,
        "history": [],
    }
    bridge = start_loopback_bridge(args.bridge_port, bridge_state, state_lock)
    print(f"[versieve] Loopback live telemetry active at http://127.0.0.1:{args.bridge_port}/status")

    try:
        tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=args.trust_remote_code)
        pad_info = configure_tokenizer_for_sft(tokenizer)

        rows = format_training_rows(raw_rows, tokenizer, strip_trailing_eos=True)
        if not rows:
            raise ValueError(f"No formatted text rows produced from {args.data}")

        audit = audit_formatted_dataset(rows, tokenizer, max_seq_length=args.max_seq_length, pack=use_packing)
        if audit["double_eos_count"] > 0:
            raise RuntimeError(f"EOS_INVARIANT_VIOLATION: detected {audit['double_eos_count']} double-EOS sequences")
        if audit["raw_pii_hits"] > 0:
            raise RuntimeError(f"PII_INVARIANT_VIOLATION: detected {audit['raw_pii_hits']} raw PII matches in SFT data")

        with state_lock:
            bridge_state["padInfo"] = pad_info
            bridge_state["datasetAudit"] = audit

        dataset = Dataset.from_list(rows)

        load_kwargs: dict = {"trust_remote_code": args.trust_remote_code}
        if torch.cuda.is_available():
            load_kwargs["device_map"] = "auto"
            load_kwargs["torch_dtype"] = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)
        target_modules = detect_target_modules(model, args.target_modules)
        lora_config = LoraConfig(
            r=args.lora_r,
            lora_alpha=args.lora_alpha,
            lora_dropout=0.05,
            target_modules=target_modules,
            bias="none",
            task_type="CAUSAL_LM",
        )

        sft_sig = inspect.signature(SFTConfig.__init__).parameters
        sft_kwargs: dict = {
            "output_dir": args.output,
            "num_train_epochs": args.epochs,
            "max_steps": args.max_steps,
            "per_device_train_batch_size": 1,
            "gradient_accumulation_steps": 4,
            "learning_rate": args.lr,
            "logging_steps": 5,
            "save_strategy": "epoch",
            "report_to": "none",
        }
        using_cpu = not torch.cuda.is_available()
        if not using_cpu:
            if "bf16" in sft_sig and torch.cuda.is_bf16_supported():
                sft_kwargs["bf16"] = True
            elif "fp16" in sft_sig:
                sft_kwargs["fp16"] = True
            if "gradient_checkpointing" in sft_sig:
                sft_kwargs["gradient_checkpointing"] = True
        if "use_cpu" in sft_sig:
            sft_kwargs["use_cpu"] = using_cpu
        elif "no_cuda" in sft_sig and using_cpu:
            sft_kwargs["no_cuda"] = True
        if "dataset_text_field" in sft_sig:
            sft_kwargs["dataset_text_field"] = "text"
        if "max_seq_length" in sft_sig:
            sft_kwargs["max_seq_length"] = args.max_seq_length
        elif "max_length" in sft_sig:
            sft_kwargs["max_length"] = args.max_seq_length
        if "packing" in sft_sig:
            sft_kwargs["packing"] = use_packing
        if args.assistant_only_loss and "assistant_only_loss" in sft_sig:
            sft_kwargs["assistant_only_loss"] = True

        training_args = SFTConfig(**sft_kwargs)

        class BridgeCallback(TrainerCallback):
            def on_log(self, cb_args, state, control, logs=None, **kwargs):
                if not logs:
                    return
                if "loss" in logs:
                    epoch_val = round(float(state.epoch or 0.0), 3)
                    loss_val = round(float(logs["loss"]), 6)
                    with state_lock:
                        bridge_state["step"] = int(state.global_step)
                        bridge_state["totalSteps"] = int(state.max_steps or 0)
                        bridge_state["epoch"] = epoch_val
                        bridge_state["loss"] = float(logs["loss"])
                        bridge_state["history"].append(
                            {"step": int(state.global_step), "epoch": epoch_val, "loss": loss_val}
                        )

        trainer_sig = inspect.signature(SFTTrainer.__init__).parameters
        trainer_kwargs: dict = {
            "model": model,
            "args": training_args,
            "train_dataset": dataset,
            "peft_config": lora_config,
            "callbacks": [BridgeCallback()],
        }
        if "processing_class" in trainer_sig:
            trainer_kwargs["processing_class"] = tokenizer
        else:
            trainer_kwargs["tokenizer"] = tokenizer

        trainer = SFTTrainer(**trainer_kwargs)
        trainer.train()
        trainer.save_model(args.output)
        tokenizer.save_pretrained(args.output)

        with state_lock:
            bridge_state["running"] = False
            bridge_state["targetModules"] = target_modules
        print(f"[versieve] Local LoRA training complete -> {args.output}")
        if args.hold_seconds > 0:
            time.sleep(args.hold_seconds)
    except Exception as exc:
        with state_lock:
            bridge_state["running"] = False
            bridge_state["error"] = str(exc)
        raise
    finally:
        bridge.shutdown()


if __name__ == "__main__":
    main()
