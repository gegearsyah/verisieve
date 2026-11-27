"""W4-data post-mortem analysis (#40 research note, docs/2026-11-27-w4-specialist-postmortem.md).

Scores the fixture-gate estate with the saved W4-data specialist four ways:
  1. link head (sigmoid, symmetric average) — the gate's scoring path
  2. fine-tuned pooled cosine (salience-weighted pooling)
  3. theme-projection cosine (the CrossCLR head)
  4. raw MiniLM-L6-v2 mean-pooled cosine (pre-fine-tune control)
then scores the live 2,000-pair holdout with the link head and the raw control.
Requires models/weft-specialist and the local HF cache (offline).

--eval-jsonl / --model-dir override the v2 defaults so cross-run style and
model comparisons reuse the same scorer (W4-v4 confirmation, 2026-11-28).
"""
import argparse
import importlib.util
import json
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
EVAL_JSONL = ROOT / "results" / "weft-training-pairs-fullscale-live-v2" / "eval.jsonl"
MODEL_DIR = ROOT / "models" / "weft-specialist"
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
SEED = 20261127
POSITIVE_TYPES = {"identity-disjoint-same-theme-positive", "identity-masked-positive"}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sweep(labels, scores):
    """In-sample max-F1 sweep, same convention as the W1 harness."""
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
            "threshold": float(scores[order[k]])}


def enrichment(labels, scores):
    """Rank enrichment: precision at the k a perfect ranker would need vs prevalence."""
    order = np.argsort(-scores, kind="stable")
    k = max(1, int(labels.sum()))
    return float(labels[order[:k]].sum() / k) / max(1e-12, labels.mean())


def raw_pool(raw, tokenizer, texts):
    """Plain masked mean pooling over the raw (untrained) base encoder."""
    batch = tokenizer(texts, padding=True, truncation=True, max_length=128,
                      return_tensors="pt")
    mask = batch["attention_mask"].bool()
    out = raw(**{k: v for k, v in batch.items()}).last_hidden_state
    pool = (out * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True)
    return torch.nn.functional.normalize(pool, dim=-1)


def report(name, labels, scores, subset_mask=None):
    print(f"\n=== {name} ===")
    if subset_mask is not None:
        labels, scores = labels[subset_mask], scores[subset_mask]
        print(f"  gate subset ({int(subset_mask.sum())} pairs):")
    m = sweep(labels, scores)
    print(f"  maxF1={m['f1']:.4f} precision={m['precision']:.4f} recall={m['recall']:.4f} "
          f"threshold={m['threshold']:.6f}")
    print(f"  enrichment={enrichment(labels, scores):.2f}x")
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-jsonl", default=str(EVAL_JSONL))
    ap.add_argument("--model-dir", default=str(MODEL_DIR))
    args = ap.parse_args()
    eval_jsonl, model_dir = Path(args.eval_jsonl), Path(args.model_dir)
    harness = load_module("weft_w1_harness", HARNESS)
    trainer = load_module("weft_trainer", TRAINER)
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    base = AutoModel.from_pretrained(BASE_MODEL)
    model = trainer.build_model(base, 128, 256)
    model.load_state_dict(torch.load(model_dir / "model.pt", map_location="cpu",
                                     weights_only=True))
    model.eval()
    raw = AutoModel.from_pretrained(BASE_MODEL)

    # ---- fixture gate (out-of-domain): the W1 estate ----
    estate = harness.build_synthetic_estate(SEED, False)
    pairs = harness.build_pairs(estate["documents"])
    texts = [d["text"] for d in estate["documents"]]
    print(f"fixture estate: {len(texts)} docs, {len(pairs)} pairs")
    labels = np.array([bool(p["label"]) for p in pairs])
    gate_mask = np.array([bool(p["identity_disjoint"]) and bool(p["cross_department"])
                          for p in pairs])
    with torch.no_grad():
        enc = model.encode(tokenizer, texts, 128, "cpu")
        pooled = enc["pooled"]
        theme = enc["theme"]
        rp = raw_pool(raw, tokenizer, texts)
        ai = torch.tensor([p["i"] for p in pairs])
        cj = torch.tensor([p["j"] for p in pairs])
        fwd = model.link_logits(pooled[ai], pooled[cj]).sigmoid()
        bwd = model.link_logits(pooled[cj], pooled[ai]).sigmoid()
        gate_scores = {
            "link_head": ((fwd + bwd) / 2.0).numpy(),
            "ft_pooled_cos": (torch.nn.functional.normalize(pooled, dim=-1)[ai]
                              * torch.nn.functional.normalize(pooled, dim=-1)[cj]).sum(-1).numpy(),
            "ft_theme_cos": (theme[ai] * theme[cj]).sum(-1).numpy(),
            "raw_miniLM_cos": (rp[ai] * rp[cj]).sum(-1).numpy(),
        }
    for name, s in gate_scores.items():
        report(f"fixture gate / {name}", labels, s, gate_mask)
    s = gate_scores["link_head"][gate_mask]
    print("link head score distribution on gate subset:")
    for pct in (10, 25, 50, 75, 90, 99):
        print(f"  p{pct}: {np.percentile(s, pct):.6f}")
    print(f"  frac > 0.99: {float((s > 0.99).mean()):.4f}")

    # ---- live holdout (in-domain): the eval pairs under test ----
    live = [json.loads(line) for line in
            eval_jsonl.read_text(encoding="utf8").splitlines() if line.strip()]
    print(f"\nlive holdout ({eval_jsonl.parent.name}): {len(live)} pairs")
    live_texts = sorted({p["textA"] for p in live} | {p["textB"] for p in live})
    with torch.no_grad():
        enc = model.encode(tokenizer, live_texts, 128, "cpu")
        pooled = enc["pooled"]
        rp = raw_pool(raw, tokenizer, live_texts)
        idx = {t: i for i, t in enumerate(live_texts)}
        ai = torch.tensor([idx[p["textA"]] for p in live])
        cj = torch.tensor([idx[p["textB"]] for p in live])
        fwd = model.link_logits(pooled[ai], pooled[cj]).sigmoid()
        bwd = model.link_logits(pooled[cj], pooled[ai]).sigmoid()
        link = ((fwd + bwd) / 2.0).numpy()
        live_scores = {
            "link_head": link,
            "raw_miniLM_cos": (rp[ai] * rp[cj]).sum(-1).numpy(),
        }
    live_labels = np.array([p["label"] == "positive" for p in live])
    for name, s in live_scores.items():
        m = report(f"live holdout / {name}", live_labels, s)
        if name == "raw_miniLM_cos":
            wrong = (s >= m["threshold"]) != live_labels
            by_type = {}
            for p, w in zip(live, wrong):
                if w:
                    by_type[p["pairType"]] = by_type.get(p["pairType"], 0) + 1
            print(f"  errors at best threshold: {by_type}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
