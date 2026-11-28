#!/usr/bin/env python3
"""Weft v5 gate evaluation (phase 4 of the v5 end-to-end plan).

Scores one trained specialist against the founder's gate tiers on the v5
eval sets: the link head per pairType (the coverage buckets carry gate 1,
the specialty buckets carry gates 5 and 6), the held-out eval (gate 2, raw
F1 on an unseen org profile), an in-repo BM25 with the same tokenize, k1,
and b as the W1 harness (gate 5, saturation of the paraphrase-hard bucket),
and the lexical-overlap gap per bucket (reported, not gated).

Fail-closed: a missing model or eval file, or an eval row without
textA/textB/label/pairType, is a typed error (exit 2) and nothing is
written. Honest framing: max-F1 thresholds are in-sample sweeps, disclosed
as such; the BM25 score is symmetrized by the mean, same as the harness.

Artifact: one JSON file per run (default results/weft-v5-gate-evaluation.json),
never appended to silently; the stage note quotes it.

Usage:
  python scripts/evaluate-weft-v5-gates.py --mode plan
  python scripts/evaluate-weft-v5-gates.py \
    --model-dir models/weft-specialist \
    --eval-jsonl results/weft-training-pairs-fullscale-live-v5/eval.jsonl \
    --heldout-jsonl results/weft-training-pairs-fullscale-live-v5/heldout-eval.jsonl \
    --out results/weft-v5-gate-evaluation.json
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "scripts" / "run-weft-baseline-shootout.py"
TRAINER = ROOT / "scripts" / "train-weft-specialist.py"
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
K1, B = 1.2, 0.75
DEFAULT_EVAL = ROOT / "results" / "weft-training-pairs-fullscale-live-v5" / "eval.jsonl"
DEFAULT_MODEL = ROOT / "models" / "weft-specialist"
DEFAULT_OUT = ROOT / "results" / "weft-v5-gate-evaluation.json"


class WeftGateEvalError(Exception):
    code = "WEFT_GATE_EVAL"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_pairs(path: Path) -> list[dict]:
    if not path.exists():
        raise WeftGateEvalError(f"eval file is missing: {path}")
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if not all(k in row for k in ("textA", "textB", "label", "pairType")):
            raise WeftGateEvalError(f"eval row in {path} lacks textA/textB/label/pairType")
        rows.append(row)
    if not rows:
        raise WeftGateEvalError(f"eval file has no pairs: {path}")
    return rows


def sweep(labels: np.ndarray, scores: np.ndarray) -> dict:
    """In-sample max-F1 sweep, same convention as the W1 harness (disclosed)."""
    if labels.sum() == 0 or labels.sum() == len(labels):
        return {"f1": None, "precision": None, "recall": None, "threshold": None,
                "pairs": int(len(labels)), "positives": int(labels.sum())}
    order = np.argsort(-scores, kind="stable")
    y = labels[order]
    tp = np.cumsum(y)
    fp = np.cumsum(~y)
    fn = y.sum() - tp
    f1 = 2 * tp / np.maximum(1, 2 * tp + fp + fn)
    k = int(np.argmax(f1))
    prec = tp[k] / max(1, tp[k] + fp[k])
    rec = tp[k] / max(1, tp[k] + fn[k])
    return {"f1": float(f1[k]), "precision": float(prec), "recall": float(rec),
            "threshold": float(scores[order[k]]), "pairs": int(len(labels)),
            "positives": int(labels.sum())}


def fixed_threshold(labels: np.ndarray, scores: np.ndarray, t: float) -> dict:
    pred = scores >= t
    tp = int((pred & labels).sum())
    fp = int((pred & ~labels).sum())
    fn = int((~pred & labels).sum())
    f1 = 2 * tp / max(1, 2 * tp + fp + fn)
    return {"f1": float(f1), "precision": tp / max(1, tp + fp), "recall": tp / max(1, tp + fn),
            "accepted": int(pred.sum()), "pairs": int(len(labels))}


def lexical_overlap(a_text: str, b_text: str) -> float:
    """The strata formula: jaccard over distinct content words (>= 4 chars)."""
    toks = lambda t: {t2 for t2 in __import__("re").findall(r"[a-z0-9_]+", t.lower()) if len(t2) >= 4}
    a, b = toks(a_text), toks(b_text)
    shared = len(a & b)
    union = len(a | b)
    return shared / union if union else 0.0


class BM25:
    """In-repo BM25 (k1=1.2, b=0.75), same tokenize as the W1 harness,
    symmetrized by the mean, matching run-weft-baseline-shootout.py."""

    def __init__(self, texts: list[str], tokenize):
        self.token_docs = [tokenize(t) for t in texts]
        df: dict[str, int] = {}
        for toks in self.token_docs:
            for t in set(toks):
                df[t] = df.get(t, 0) + 1
        n = len(self.token_docs)
        self.avg_len = sum(len(t) for t in self.token_docs) / n if n else 0.0
        self.idf = {t: math.log((n - c + 0.5) / (c + 0.5) + 1.0) for t, c in df.items()}
        self.k1, self.b = K1, B

    def score(self, i: int, j: int) -> float:
        def one(query, doc):
            if not doc:
                return 0.0
            tf: dict[str, int] = {}
            for t in doc:
                tf[t] = tf.get(t, 0) + 1
            dl = len(doc)
            s = 0.0
            for term in query:
                if term not in tf:
                    continue
                f = tf[term]
                s += self.idf.get(term, 0.0) * (f * (self.k1 + 1)) / (
                    f + self.k1 * (1 - self.b + self.b * dl / self.avg_len))
            return s
        return 0.5 * (one(self.token_docs[i], self.token_docs[j])
                       + one(self.token_docs[j], self.token_docs[i]))


def link_scores(model, tokenizer, rows: list[dict]) -> np.ndarray:
    texts = sorted({r["textA"] for r in rows} | {r["textB"] for r in rows})
    with torch.no_grad():
        enc = model.encode(tokenizer, texts, 128, "cpu")
        pooled = enc["pooled"]
        idx = {t: i for i, t in enumerate(texts)}
        ai = torch.tensor([idx[r["textA"]] for r in rows])
        cj = torch.tensor([idx[r["textB"]] for r in rows])
        fwd = model.link_logits(pooled[ai], pooled[cj]).sigmoid()
        bwd = model.link_logits(pooled[cj], pooled[ai]).sigmoid()
    return ((fwd + bwd) / 2.0).numpy()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="run")
    ap.add_argument("--model-dir", default=str(DEFAULT_MODEL))
    ap.add_argument("--eval-jsonl", default=str(DEFAULT_EVAL))
    ap.add_argument("--heldout-jsonl", default=None)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    if args.mode == "plan":
        print(json.dumps({"mode": "plan", "modelDir": args.model_dir,
                          "evalJsonl": args.eval_jsonl, "heldoutJsonl": args.heldout_jsonl,
                          "out": args.out}, indent=2))
        return 0

    try:
        model_dir = Path(args.model_dir)
        if not (model_dir / "model.pt").exists():
            raise WeftGateEvalError(f"trained model is missing: {model_dir / 'model.pt'}")
        rows = read_pairs(Path(args.eval_jsonl))
        heldout_rows = read_pairs(Path(args.heldout_jsonl)) if args.heldout_jsonl else None

        harness = load_module("weft_w1_harness", HARNESS)
        trainer = load_module("weft_trainer", TRAINER)
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
        base = AutoModel.from_pretrained(BASE_MODEL)
        model = trainer.build_model(base, 128, 256)
        model.load_state_dict(torch.load(model_dir / "model.pt", map_location="cpu", weights_only=True))
        model.eval()

        labels = np.array([r["label"] == "positive" for r in rows])
        scores = link_scores(model, tokenizer, rows)
        bm25 = BM25([r["textA"] for r in rows] + [r["textB"] for r in rows], harness.tokenize)

        # Gate 1: within-coverage pairwise F1 (max sweep over coverage buckets,
        # in-sample, disclosed; the per-bucket table carries the detail).
        coverage_mask = np.array([not r["pairType"].startswith(("source-disjoint", "compliance-", "non-knowledge", "private-unit")) for r in rows])
        gate1 = sweep(labels[coverage_mask], scores[coverage_mask])

        per_type = {}
        for pt in sorted({r["pairType"] for r in rows}):
            m = np.array([r["pairType"] == pt for r in rows])
            sub_labels, sub_scores = labels[m], scores[m]
            entry = {
                "linkHead": sweep(sub_labels, sub_scores),
                "meanScorePositive": float(sub_scores[sub_labels].mean()) if sub_labels.any() else None,
                "meanScoreNegative": float(sub_scores[~sub_labels].mean()) if (~sub_labels).any() else None,
            }
            # Lexical-overlap means per label side (cheap, per-bucket).
            lo = {"positive": [], "negative": []}
            for r, lab, sel in zip(rows, labels, m):
                if sel:
                    lo["positive" if lab else "negative"].append(lexical_overlap(r["textA"], r["textB"]))
            entry["lexicalOverlap"] = {
                "positiveMean": float(np.mean(lo["positive"])) if lo["positive"] else None,
                "negativeMean": float(np.mean(lo["negative"])) if lo["negative"] else None,
            }
            per_type[pt] = entry

        # Gate 5: BM25 must not saturate the source-disjoint buckets.
        bm25_scores = []
        offset = len(rows)  # texts list is [textA rows then textB rows]
        for r in rows:
            bm25_scores.append(bm25.score(len(bm25_scores), offset + len(bm25_scores)))
        bm25_scores = np.array(bm25_scores)
        bm25_per_type = {}
        for pt in sorted({r["pairType"] for r in rows}):
            m = np.array([r["pairType"] == pt for r in rows])
            bm25_per_type[pt] = sweep(labels[m], bm25_scores[m])

        # Gate 6: non-knowledge buckets must not link. Mean link scores carry
        # the story even when a bucket holds one label only.
        gate6 = {pt: per_type[pt] for pt in per_type if pt.startswith("non-knowledge")}

        result = {
            "kind": "weft-v5-gate-evaluation",
            "modelDir": str(model_dir),
            "modelSha256": hashlib.sha256((model_dir / "model.pt").read_bytes()).hexdigest(),
            "evalJsonl": str(args.eval_jsonl),
            "thresholdSelection": "in-sample max-F1 sweep (disclosed), same convention as the W1 harness",
            "counts": {"eval": len(rows), "heldout": len(heldout_rows) if heldout_rows else 0},
            "gate1WithinCoverage": gate1,
            "perPairType": per_type,
            "bm25": {
                "modelId": f"in-repo BM25 (k1={K1}, b={B}), symmetrized by the mean",
                "perPairType": bm25_per_type,
            },
            "gate6NonKnowledge": gate6,
        }

        if heldout_rows:
            hs = link_scores(model, tokenizer, heldout_rows)
            hl = np.array([r["label"] == "positive" for r in heldout_rows])
            result["gate2HeldoutShape"] = sweep(hl, hs)
            result["gate2HeldoutPerPairType"] = {
                pt: sweep(hl[np.array([r["pairType"] == pt for r in heldout_rows])],
                          hs[np.array([r["pairType"] == pt for r in heldout_rows])])
                for pt in sorted({r["pairType"] for r in heldout_rows})
            }

        out = Path(args.out)
        out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"gate1": result["gate1WithinCoverage"]["f1"],
                          "gate2": result.get("gate2HeldoutShape", {}).get("f1"),
                          "out": str(out)}))
        return 0
    except WeftGateEvalError as exc:
        print(json.dumps({"error": exc.code, "detail": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
