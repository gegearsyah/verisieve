"""Run local Apache-2.0 GLiNER-PII-Edge (45M INT8 ONNX) on Paper 1 & Track E public benchmarks.

Evaluates `knowledgator/gliner-pii-edge-v1.0` (`onnx/model_quint8.onnx`, 45.8 MB, Apache-2.0)
100% locally via onnxruntime on:
  1. All 500 `ai4privacy-200k` records (exact Paper 1 split)
  2. All 250 blind `PubMedQA` abstracts (indices 250..500, exact Paper 1 blind split)
  3. 100 lowercase spoken-ASR PII utterances (evaluating lowercase name recall)

Writes `results/untrusted-benchmarks/track-e-public/gliner-edge-predictions.json`.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_DIR = Path("results/untrusted-benchmarks/track-e-public/models/gliner-pii-edge")
OUT_PATH = Path("results/untrusted-benchmarks/track-e-public/gliner-edge-predictions.json")

# Compact PII label prompt covering Paper 1's ai4privacy structured + bare-name + address taxonomy
LABELS = [
    "person",
    "email",
    "phone number",
    "street address",
    "credit card number",
    "ssn",
    "date of birth",
    "date",
    "ip address",
    "iban",
    "username",
    "organization",
    "account number",
    "password",
]

WORD_RX = re.compile(r"\w+(?:[-_'.@]\w+)*|\S")


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))


class GlinerEdgeOnnxRunner:
    def __init__(self, model_dir: Path, threshold: float = 0.40) -> None:
        self.tok = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = 4
        self.sess = ort.InferenceSession(
            str(model_dir / "onnx/model_quint8.onnx"),
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self.threshold = threshold
        self.ent_id = self.tok.token_to_id("<<ENT>>")
        self.sep_id = self.tok.token_to_id("<<SEP>>")
        self.cls_id = self.tok.token_to_id("[CLS]")
        self.eos_id = self.tok.token_to_id("[SEP]")

        # Pre-encode label prompt prefix once
        self.prefix_ids: list[int] = [self.cls_id] if self.cls_id is not None else []
        for lbl in LABELS:
            self.prefix_ids.append(self.ent_id)
            self.prefix_ids.extend(self.tok.encode(lbl, add_special_tokens=False).ids)
        self.prefix_ids.append(self.sep_id)
        self.prefix_mask = [0] * len(self.prefix_ids)

    def predict(self, text: str, max_words: int = 360) -> tuple[list[dict], float]:
        t0 = time.perf_counter()
        raw_words = [(m.group(0), m.start(), m.end()) for m in WORD_RX.finditer(text)]
        if not raw_words:
            return [], (time.perf_counter() - t0) * 1000.0

        all_spans: list[dict] = []
        step = max(1, max_words - 48)
        for win_start in range(0, len(raw_words), step):
            win = raw_words[win_start : win_start + max_words]
            input_ids = list(self.prefix_ids)
            words_mask = list(self.prefix_mask)
            kept_words: list[tuple[str, int, int]] = []

            for w, s, e in win:
                ids = self.tok.encode(w, add_special_tokens=False).ids
                if not ids:
                    continue
                if len(input_ids) + len(ids) + 1 > 2048:
                    break
                w_idx = len(kept_words) + 1
                kept_words.append((w, s, e))
                input_ids.extend(ids)
                words_mask.append(w_idx)
                if len(ids) > 1:
                    words_mask.extend([0] * (len(ids) - 1))

            if not kept_words:
                break
            if self.eos_id is not None:
                input_ids.append(self.eos_id)
                words_mask.append(0)

            logits = self.sess.run(
                None,
                {
                    "input_ids": np.array([input_ids], dtype=np.int64),
                    "attention_mask": np.ones((1, len(input_ids)), dtype=np.int64),
                    "words_mask": np.array([words_mask], dtype=np.int64),
                    "text_lengths": np.array([[len(kept_words)]], dtype=np.int64),
                },
            )[0]

            probs = sigmoid(logits[0])  # [W, L, 3] -> start, end, inside
            w_cnt = probs.shape[0]
            thr = self.threshold
            for li, lbl in enumerate(LABELS):
                sp = probs[:, li, 0]
                ep = probs[:, li, 1]
                ip = probs[:, li, 2]
                for si in np.where(sp >= thr)[0]:
                    si_i = int(si)
                    for ei_i in range(si_i, min(w_cnt, si_i + 12)):
                        if ep[ei_i] >= thr:
                            if ei_i == si_i or float(np.min(ip[si_i : ei_i + 1])) >= thr * 0.8:
                                score = float(min(sp[si_i], ep[ei_i]))
                                all_spans.append(
                                    {
                                        "label": lbl,
                                        "start": kept_words[si_i][1],
                                        "end": kept_words[ei_i][2],
                                        "score": round(score, 4),
                                    }
                                )
            if win_start + max_words >= len(raw_words):
                break

        # Greedy non-overlapping dedup preferring highest score, then longest span
        all_spans.sort(key=lambda x: (-x["score"], -(x["end"] - x["start"]), x["start"]))
        deduped: list[dict] = []
        for sp in all_spans:
            if not any(not (sp["end"] <= d["start"] or sp["start"] >= d["end"]) for d in deduped):
                deduped.append(sp)
        deduped.sort(key=lambda x: x["start"])
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return deduped, elapsed_ms


def main() -> None:
    runner = GlinerEdgeOnnxRunner(MODEL_DIR, threshold=0.40)

    # 1. All 500 ai4privacy-200k records
    ai4 = json.loads(Path("results/untrusted-benchmarks/ai4privacy-500.json").read_text(encoding="utf-8"))
    ai4_preds = []
    ai4_latencies = []
    for idx, row in enumerate(ai4):
        text = row.get("source_text", "")
        spans, ms = runner.predict(text)
        ai4_preds.append({"id": row.get("id", idx), "spans": spans})
        ai4_latencies.append(ms)
        if (idx + 1) % 100 == 0:
            print(f"ai4privacy {idx + 1}/500 | median_ms={np.median(ai4_latencies):.1f}")

    # 2. Blind 250 PubMedQA abstracts (indices 250..500, matching Paper 1 blind split)
    pubmed = json.loads(Path("results/untrusted-benchmarks/pubmedqa-500.json").read_text(encoding="utf-8"))
    blind_pubmed = pubmed[250:500]
    pubmed_preds = []
    pubmed_latencies = []
    for idx, row in enumerate(blind_pubmed):
        ctx = row.get("context", {})
        ctxs = ctx.get("contexts", []) if isinstance(ctx, dict) else []
        text = " ".join(ctxs)
        spans, ms = runner.predict(text)
        # Keep only person-labeled FPs to match Paper 1 Title-Case person FP evaluation
        person_spans = [s for s in spans if s["label"] == "person"]
        pubmed_preds.append({"pubid": row.get("pubid", idx), "person_spans": person_spans, "all_spans_count": len(spans)})
        pubmed_latencies.append(ms)
        if (idx + 1) % 50 == 0:
            print(f"pubmedqa_blind {idx + 1}/250 | median_ms={np.median(pubmed_latencies):.1f}")

    # 3. 100 lowercase spoken-ASR utterances with planted lowercase person names
    first_names = ["sarah", "elena", "marcus", "david", "priya", "daniel", "claire", "lucas", "hannah", "omar"]
    last_names = ["chen", "vance", "cole", "patel", "kim", "garcia", "murphy", "silva", "novak", "nguyen"]
    spoken_preds = []
    for i in range(100):
        fn = first_names[i % 10]
        ln = last_names[(i // 10) % 10]
        full = f"{fn} {ln}"
        sent = f"hey can you send the updated agreement over to {full} before the friday review call"
        s_idx = sent.index(full)
        e_idx = s_idx + len(full)
        spans, _ = runner.predict(sent)
        hit = any(not (sp["end"] <= s_idx or sp["start"] >= e_idx) for sp in spans)
        spoken_preds.append({"text": sent, "target": [s_idx, e_idx], "detected": hit, "spans": spans})

    out = {
        "model": "knowledgator/gliner-pii-edge-v1.0",
        "onnxFile": "onnx/model_quint8.onnx",
        "onnxBytes": (MODEL_DIR / "onnx/model_quint8.onnx").stat().st_size,
        "license": "Apache-2.0",
        "threshold": 0.40,
        "ai4privacy": {
            "count": len(ai4_preds),
            "medianMs": round(float(np.median(ai4_latencies)), 2),
            "p95Ms": round(float(np.percentile(ai4_latencies, 95)), 2),
            "predictions": ai4_preds,
        },
        "pubmedqaBlind": {
            "count": len(pubmed_preds),
            "medianMs": round(float(np.median(pubmed_latencies)), 2),
            "totalPersonFpSpans": sum(len(p["person_spans"]) for p in pubmed_preds),
            "docsWithPersonFp": sum(1 for p in pubmed_preds if len(p["person_spans"]) > 0),
            "predictions": pubmed_preds,
        },
        "lowercaseSpokenNames": {
            "total": len(spoken_preds),
            "detected": sum(1 for p in spoken_preds if p["detected"]),
            "recallPct": round(100.0 * sum(1 for p in spoken_preds if p["detected"]) / len(spoken_preds), 2),
        },
    }
    OUT_PATH.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(
        f"DONE GLINER-EDGE: ai4_median={out['ai4privacy']['medianMs']}ms | "
        f"pubmed_blind_person_fp={out['pubmedqaBlind']['totalPersonFpSpans']} ({out['pubmedqaBlind']['docsWithPersonFp']}/250 docs) | "
        f"lowercase_spoken_recall={out['lowercaseSpokenNames']['recallPct']}%"
    )


if __name__ == "__main__":
    main()
