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
"""VeriSieve x RTIO local open-weight LoRA trainer.

Runs 100% locally via Astral uv (`uv run verisieve-train.py --data rtio-train.jsonl`)
and serves step/loss progress over 127.0.0.1 with Private Network Access headers
so the RTIO browser Sandbox can chart live loss locally.
"""

from __future__ import annotations

import argparse
import inspect
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback
from trl import SFTConfig, SFTTrainer


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


def load_clean_jsonl(data_path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for raw_line in data_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if isinstance(rec.get("messages"), list):
            parts = []
            for msg in rec["messages"]:
                if isinstance(msg, dict) and msg.get("content"):
                    role = msg.get("role", "user")
                    parts.append(f"<|{role}|>\n{msg['content']}")
            text = "\n".join(parts).strip()
        elif isinstance(rec.get("safe_text"), str):
            text = rec["safe_text"].strip()
        elif isinstance(rec.get("text"), str):
            text = rec["text"].strip()
        elif isinstance(rec.get("prompt"), str) and isinstance(rec.get("completion"), str):
            text = f"{rec['prompt']}\n{rec['completion']}".strip()
        else:
            text = ""
        if text:
            rows.append({"text": text})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a local LoRA adapter from cleaned VeriSieve/RTIO JSONL")
    parser.add_argument("--data", default="rtio-train.jsonl", help="Path to exported cleaned JSONL file")
    parser.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct", help="HuggingFace repo ID or local model directory")
    parser.add_argument("--output", default="./verisieve-lora-out", help="Adapter output directory")
    parser.add_argument("--epochs", type=int, default=1, help="Number of fine-tuning epochs")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--bridge-port", type=int, default=8765, help="127.0.0.1 loopback telemetry port")
    args = parser.parse_args()

    state_lock = threading.Lock()
    bridge_state: dict = {
        "running": True,
        "step": 0,
        "totalSteps": 0,
        "loss": None,
        "model": args.model,
        "dataset": args.data,
        "outputDir": args.output,
        "history": [],
    }
    bridge = start_loopback_bridge(args.bridge_port, bridge_state, state_lock)
    print(f"[verisieve] Loopback live telemetry active at http://127.0.0.1:{args.bridge_port}/status")

    try:
        rows = load_clean_jsonl(Path(args.data))
        if not rows:
            raise ValueError(f"No trainable non-empty records found in {args.data}")
        dataset = Dataset.from_list(rows)

        tokenizer = AutoTokenizer.from_pretrained(args.model)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(args.model, device_map="auto")
        lora_config = LoraConfig(
            r=8,
            lora_alpha=16,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        )

        sft_sig = inspect.signature(SFTConfig.__init__).parameters
        sft_kwargs: dict = {
            "output_dir": args.output,
            "num_train_epochs": args.epochs,
            "per_device_train_batch_size": 1,
            "gradient_accumulation_steps": 4,
            "learning_rate": args.lr,
            "logging_steps": 1,
            "save_strategy": "epoch",
            "report_to": "none",
        }
        if "dataset_text_field" in sft_sig:
            sft_kwargs["dataset_text_field"] = "text"
        if "max_seq_length" in sft_sig:
            sft_kwargs["max_seq_length"] = 1024
        elif "max_length" in sft_sig:
            sft_kwargs["max_length"] = 1024

        training_args = SFTConfig(**sft_kwargs)

        class BridgeCallback(TrainerCallback):
            def on_log(self, cb_args, state, control, logs=None, **kwargs):
                if not logs:
                    return
                if "loss" in logs:
                    with state_lock:
                        bridge_state["step"] = int(state.global_step)
                        bridge_state["totalSteps"] = int(state.max_steps or 0)
                        bridge_state["loss"] = float(logs["loss"])
                        bridge_state["history"].append(
                            {"epoch": int(state.global_step), "loss": round(float(logs["loss"]), 6)}
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
        print(f"[verisieve] Local LoRA training complete -> {args.output}")
    except Exception as exc:
        with state_lock:
            bridge_state["running"] = False
            bridge_state["error"] = str(exc)
        raise
    finally:
        bridge.shutdown()


if __name__ == "__main__":
    main()
