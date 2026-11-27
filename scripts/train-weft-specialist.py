#!/usr/bin/env python3
"""Weft specialist training (ticket W3).

Trains the bare, un-quantized Weft specialist: a ~23M-parameter attention encoder
initialized from all-MiniLM-L6-v2 (Apache-2.0), with an anchor-set + candidate-chunk
interface, a link logit, token-level extractive evidence pointers, and a theme
embedding. The only loss extras are CrossCLR-style false-negative and hub handling;
no identity adversary, no set-conditioning term, no triangle term.

Evaluation runs through the W1 harness (`scripts/run-weft-baseline-shootout.py`):
same deterministic estate, same pair builder, same metric code, same in-sample
threshold selection. The gate compares the specialist with the size-matched
static-embedding-plus-threshold competitor on identity-disjoint cross-department F1.

Fail-closed contract. The default `--device auto` requires a CUDA runtime and exits
nonzero with a typed error when it is absent. `--device cpu` is an explicit, recorded
small-scale run (fixture-scale W2 pairs on CPU), never a silent fallback. Missing
torch/transformers, base weights, training data, or the W1 harness are typed errors
too. Nothing is written to the artifact on a typed failure.

Artifact: results/weft-specialist-training.json (append-only; seeds, digests,
licences, hyperparameters, environment, evaluation). Model weights stay outside
vendor/ in models/weft-specialist/; only their digest and size enter the artifact.

Kaggle (2x Tesla T4) recipe: `--emit-kaggle-notebook` prints a ready-to-run notebook
JSON. Training data there is public/synthetic only, and the notebook records the
environment into the artifact.

Usage:
  python scripts/train-weft-specialist.py --mode plan
  python scripts/train-weft-specialist.py --device cpu --epochs 20
  python scripts/train-weft-specialist.py --device cuda --epochs 20
  python scripts/train-weft-specialist.py --emit-kaggle-notebook
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BASE_LICENSE = "Apache-2.0"
STATIC_BASELINE_MODEL = "minishlab/potion-base-32M"
DEFAULT_SEED = 20261127
BANNED = ("mathematically" + " grounded", "elimin" + "ates", "fir" + "st")
ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Typed fail-closed errors
# ---------------------------------------------------------------------------

class WeftSpecialistError(Exception):
    code = "WEFT_SPECIALIST_ERROR"

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class TrainingRuntimeUnavailable(WeftSpecialistError):
    code = "WEFT_TRAINING_RUNTIME_UNAVAILABLE"


class BaseEncoderUnavailable(WeftSpecialistError):
    code = "WEFT_BASE_ENCODER_UNAVAILABLE"


class TrainingDataUnavailable(WeftSpecialistError):
    code = "WEFT_TRAINING_DATA_UNAVAILABLE"


class HarnessUnavailable(WeftSpecialistError):
    code = "WEFT_HARNESS_UNAVAILABLE"


# ---------------------------------------------------------------------------
# Digests and local-only model resolution (same scheme as W1)
# ---------------------------------------------------------------------------

def digest_paths(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        if not p.is_file():
            continue
        h.update(p.name.encode("utf-8"))
        h.update(b"\0")
        with p.open("rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                h.update(chunk)
        h.update(b"\0")
    return h.hexdigest()


def _hub_dir() -> Path:
    base = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface"))
    return base / "hub"


def find_snapshot(repo_id: str) -> Path | None:
    d = _hub_dir() / ("models--" + repo_id.replace("/", "--"))
    ref = d / "refs" / "main"
    if not ref.exists():
        return None
    snap = d / "snapshots" / ref.read_text(encoding="utf-8").strip()
    return snap if snap.is_dir() else None


def weight_path(snap: Path) -> Path | None:
    for name in ("model.safetensors", "pytorch_model.bin"):
        p = snap / name
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def files_without_weights(snap: Path) -> list[Path]:
    return [p for p in sorted(snap.rglob("*"))
            if p.is_file() and "safetensors" not in p.name and p.suffix != ".bin"]


def require_base_snapshot() -> tuple[Path, str]:
    snap = find_snapshot(BASE_MODEL)
    if snap is None or weight_path(snap) is None:
        raise BaseEncoderUnavailable(
            f"{BASE_MODEL} is not in the local Hugging Face cache; the trainer never downloads")
    return snap, digest_paths(files_without_weights(snap) + [weight_path(snap)])


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def sha256_file_lf(path: Path) -> str:
    """LF-normalized digest: W2 pins JSONL/content this way so a CRLF checkout agrees."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

def load_pairs(path: Path) -> list[dict]:
    if not path.is_file():
        raise TrainingDataUnavailable(f"training pairs absent: {path}")
    pairs = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            themes = [str(t) for t in row["provenance"]["themes"]]
            if len(themes) != 2:
                raise ValueError("provenance.themes must have two entries")
            pairs.append({
                "id": str(row["id"]),
                "anchor": str(row["textA"]),
                "candidate": str(row["textB"]),
                "label": 1.0 if str(row["label"]) == "positive" else 0.0,
                "anchorTheme": themes[0],
                "candidateTheme": themes[1],
                "pairType": str(row.get("pairType", "unknown")),
            })
        except Exception as exc:  # noqa: BLE001 - typed fail-closed
            raise TrainingDataUnavailable(f"{path.name}:{lineno}: malformed pair: {exc}") from exc
    if not pairs:
        raise TrainingDataUnavailable(f"training pairs empty: {path}")
    return pairs


def load_harness(path: Path):
    if not path.is_file():
        raise HarnessUnavailable(
            f"W1 harness absent: {path}; evaluation must run through it (no local reimplementation)")
    spec = importlib.util.spec_from_file_location("weft_w1_harness", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Model: anchor set + candidate chunk -> link logit, evidence, theme
# ---------------------------------------------------------------------------

def build_model(base, theme_dim: int = 128, head_hidden: int = 256):
    import torch
    from torch import nn

    hidden = base.config.hidden_size

    class WeftSpecialist(nn.Module):
        def __init__(self):
            super().__init__()
            self.base = base
            self.evidence = nn.Linear(hidden, 1)
            self.theme = nn.Linear(hidden, theme_dim)
            self.link = nn.Sequential(
                nn.Linear(4 * hidden, head_hidden), nn.GELU(), nn.Linear(head_hidden, 1))

        def encode(self, tokenizer, texts: list[str], max_length: int, device):
            enc = tokenizer(texts, padding=True, truncation=True, max_length=max_length,
                            return_tensors="pt", return_offsets_mapping=True)
            offsets = enc.pop("offset_mapping").to(device)
            enc = {k: v.to(device) for k, v in enc.items()}
            h = self.base(**enc).last_hidden_state
            mask = enc["attention_mask"].bool()
            salience = self.evidence(h).squeeze(-1)
            salience = salience.masked_fill(~mask, -1e9).softmax(dim=-1)
            pooled = (h * salience.unsqueeze(-1)).sum(dim=1)
            theme = torch.nn.functional.normalize(self.theme(pooled), dim=-1)
            return {"pooled": pooled, "theme": theme, "h": h, "mask": mask,
                    "salience": salience, "offsets": offsets}

        def encode_anchor_set(self, tokenizer, chunks_per_item: list[list[str]], max_length: int, device):
            """Anchor set interface: each item carries 1..k anchor chunks, pooled by mean."""
            import torch
            flat = [chunk for chunks in chunks_per_item for chunk in chunks]
            enc = self.encode(tokenizer, flat, max_length, device)
            owner = torch.tensor(
                [i for i, chunks in enumerate(chunks_per_item) for _ in chunks], device=device)
            pooled = torch.zeros(len(chunks_per_item), enc["pooled"].shape[1], device=device)
            pooled.index_add_(0, owner, enc["pooled"])
            counts = torch.bincount(owner, minlength=len(chunks_per_item)).clamp_min(1)
            pooled = pooled / counts.unsqueeze(1).float()
            theme = torch.nn.functional.normalize(self.theme(pooled), dim=-1)
            return {"pooled": pooled, "theme": theme}

        def link_logits(self, anchor_pooled, candidate_pooled):
            import torch
            feats = torch.cat([anchor_pooled, candidate_pooled,
                               anchor_pooled - candidate_pooled,
                               anchor_pooled * candidate_pooled], dim=-1)
            return self.link(feats).squeeze(-1)

    return WeftSpecialist()


def crossclr_loss(anchor_theme, candidate_theme, same_theme, temperature: float,
                  top_k: int, hub_power: float, positive_weight: float):
    """InfoNCE with same-theme false negatives masked, hub negatives down-weighted or
    removed, and positives re-weighted (CrossCLR-style)."""
    import torch
    n = anchor_theme.shape[0]
    scores = anchor_theme @ candidate_theme.T / temperature
    pos = same_theme.bool()
    neg = ~pos
    k = int(min(max(1, top_k), max(1, n - 1)))
    neg_scores = scores.masked_fill(~neg, -math.inf)
    top_idx = neg_scores.topk(k, dim=1).indices
    degree = torch.zeros(n, device=scores.device)
    valid = neg.gather(1, top_idx)
    degree.index_add_(0, top_idx[valid], torch.ones(int(valid.sum()), device=scores.device))
    hub = degree > max(1, n // 2)
    neg = neg & ~hub.unsqueeze(0)
    log_weight = torch.where(neg, -hub_power * torch.log1p(degree).unsqueeze(0),
                             torch.zeros_like(scores))
    allowed = pos | neg
    logits = scores + log_weight + positive_weight * pos.float()
    logits = logits.masked_fill(~allowed, -math.inf)
    target = pos.float()
    target = target / target.sum(dim=1, keepdim=True).clamp_min(1.0)
    logp = torch.log_softmax(logits, dim=1)
    # Disallowed entries are -inf; zero-weight them before multiplying to avoid 0 * -inf = nan.
    safe_logp = torch.where(target > 0, logp, torch.zeros_like(logp))
    rows = pos.any(dim=1)
    loss = -(target * safe_logp).sum(dim=1)
    return loss[rows].mean() if bool(rows.any()) else scores.sum() * 0.0


def evidence_kl(candidate_salience, candidate_h, candidate_mask, anchor_pooled,
                temperature: float = 0.5):
    """Supervise the token evidence head without span labels: match the candidate token
    salience distribution to token similarity against the anchor chunk."""
    import torch
    hn = torch.nn.functional.normalize(candidate_h, dim=-1)
    an = torch.nn.functional.normalize(anchor_pooled, dim=-1)
    sim = (hn * an.unsqueeze(1)).sum(-1) / temperature
    sim = sim.masked_fill(~candidate_mask, -math.inf)
    target = sim.softmax(dim=-1).detach()
    return -(target * torch.log(candidate_salience.clamp_min(1e-12))).sum(dim=-1).mean()


def evidence_spans(text: str, offsets, salience, top_k: int = 3) -> list[dict]:
    import torch
    order = torch.argsort(salience, descending=True).tolist()
    idx = [i for i in order if int(offsets[i][1]) > int(offsets[i][0])][:top_k]
    idx.sort()
    return [{"text": text[int(offsets[i][0]):int(offsets[i][1])],
             "start": int(offsets[i][0]), "end": int(offsets[i][1])} for i in idx]


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def seed_everything(seed: int):
    import numpy as np
    import torch
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def train(model, tokenizer, pairs: list[dict], args, device):
    import torch
    torch.manual_seed(args.seed)
    labels = torch.tensor([p["label"] for p in pairs], device=device)
    # The same-theme matrix is built per batch, not precomputed over all pairs:
    # a full N x N precompute is quadratic in memory and would not survive full-scale runs.

    head_params, base_params = [], []
    for name, param in model.named_parameters():
        (base_params if name.startswith("base.") else head_params).append(param)
    optimizer = torch.optim.AdamW([
        {"params": base_params, "lr": args.lr_base},
        {"params": head_params, "lr": args.lr_heads},
    ], weight_decay=args.weight_decay)
    bce = torch.nn.BCEWithLogitsLoss()
    n = len(pairs)

    history = []
    model.train()
    t0 = time.perf_counter()
    for epoch in range(args.epochs):
        order = torch.randperm(n, device=device)
        totals = {"loss": 0.0, "linkBce": 0.0, "crossclr": 0.0, "evidence": 0.0}
        seen = 0
        for start in range(0, n, args.batch_size):
            idx = order[start:start + args.batch_size]
            batch = [pairs[int(i)] for i in idx]
            labels_b = labels[idx]
            same_theme = torch.tensor(
                [[p["anchorTheme"] == q["candidateTheme"] for q in batch] for p in batch],
                dtype=torch.bool, device=device)
            optimizer.zero_grad()
            anchor_enc = model.encode_anchor_set(
                tokenizer, [[p["anchor"]] for p in batch], args.max_length, device)
            cand_enc = model.encode(tokenizer, [p["candidate"] for p in batch],
                                    args.max_length, device)
            logits = model.link_logits(anchor_enc["pooled"], cand_enc["pooled"])
            link = bce(logits, labels_b)
            if len(batch) >= 2:
                contrast = crossclr_loss(anchor_enc["theme"], cand_enc["theme"], same_theme,
                                         args.temperature, args.hard_negative_top_k,
                                         args.hub_power, args.positive_weight)
            else:
                contrast = logits.sum() * 0.0
            pos_rows = labels_b > 0.5
            evidence = (evidence_kl(cand_enc["salience"][pos_rows], cand_enc["h"][pos_rows],
                                    cand_enc["mask"][pos_rows],
                                    anchor_enc["pooled"][pos_rows])
                        if bool(pos_rows.any()) else logits.sum() * 0.0)
            loss = link + args.contrastive_weight * contrast + args.evidence_weight * evidence
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip)
            optimizer.step()
            for key, value in (("loss", loss), ("linkBce", link),
                               ("crossclr", contrast), ("evidence", evidence)):
                totals[key] += float(value.detach()) * len(batch)
            seen += len(batch)
        history.append({"epoch": epoch + 1, **{k: v / max(1, seen) for k, v in totals.items()}})
        print(f"epoch {epoch + 1}/{args.epochs} " +
              " ".join(f"{k}={v / max(1, seen):.4f}" for k, v in totals.items()), flush=True)
    wall = time.perf_counter() - t0
    return history, wall


# ---------------------------------------------------------------------------
# Evaluation through the W1 harness
# ---------------------------------------------------------------------------

def joint_identity_disjoint_cross_department(harness, pairs, scores, threshold):
    idx = [k for k, p in enumerate(pairs) if p["identity_disjoint"] and p["cross_department"]]
    preds = [bool(scores[k] >= threshold) for k in idx]
    return harness.pair_metrics([pairs[k] for k in idx], preds), len(idx)


def evaluate(model, tokenizer, harness, args, device) -> dict:
    import torch
    estate = harness.build_synthetic_estate(args.seed, False)
    docs = estate["documents"]
    pairs = harness.build_pairs(docs)
    texts = [d["text"] for d in docs]

    model.eval()
    t0 = time.perf_counter()
    with torch.no_grad():
        enc = model.encode(tokenizer, texts, args.max_length, device)
    encode_ms = (time.perf_counter() - t0) * 1000.0
    pooled = enc["pooled"]
    n = len(pairs)

    t1 = time.perf_counter()
    scores = []
    with torch.no_grad():
        for start in range(0, n, 2048):
            chunk = pairs[start:start + 2048]
            ai = torch.tensor([p["i"] for p in chunk], device=device)
            cj = torch.tensor([p["j"] for p in chunk], device=device)
            fwd = model.link_logits(pooled[ai], pooled[cj]).sigmoid()
            bwd = model.link_logits(pooled[cj], pooled[ai]).sigmoid()
            scores.extend(((fwd + bwd) / 2.0).cpu().tolist())
    latency = (time.perf_counter() - t1) * 1000.0 / max(1, n)

    allowed = [True] * n
    result = harness.evaluate_scores(docs, pairs, scores, allowed, args.resamples, args.seed)
    joint, joint_pairs = joint_identity_disjoint_cross_department(
        harness, pairs, scores, result["threshold"])
    result["identityDisjointCrossDepartment"] = joint
    result["identityDisjointCrossDepartmentPairs"] = joint_pairs

    meta, base_scores = harness.run_static_threshold(
        docs, pairs, STATIC_BASELINE_MODEL, args.seed, args.resamples)
    base_result = harness.evaluate_scores(docs, pairs, base_scores, allowed, args.resamples, args.seed)
    base_joint, _ = joint_identity_disjoint_cross_department(
        harness, pairs, base_scores, base_result["threshold"])
    meta.update(base_result)
    meta["identityDisjointCrossDepartment"] = base_joint

    specialist_f1 = joint["f1"]
    baseline_f1 = base_joint["f1"]
    gate = {
        "metric": "identity_disjoint_cross_department_pairwise_f1",
        "specialist": specialist_f1,
        "baseline": baseline_f1,
        "delta": specialist_f1 - baseline_f1,
        "status": "beats_baseline" if specialist_f1 > baseline_f1 else "at_risk_negative_result",
        "releaseGate": "story 36 (release stays at risk while the delta is not positive)",
        "thresholdSelection": "in-sample max-F1 sweep, identical for both sides (W1 harness)",
    }

    evidence_sample = None
    pos = next((k for k, p in enumerate(pairs) if p["label"]), None)
    if pos is not None:
        text = docs[pairs[pos]["j"]]["text"]
        offsets = enc["offsets"][pairs[pos]["j"]].cpu()
        evidence_sample = {
            "pairIndex": pos,
            "side": "candidate",
            "spans": evidence_spans(text, offsets, enc["salience"][pairs[pos]["j"]].cpu().detach()),
        }

    return {
        "harness": {
            "path": display_path(Path(args.harness)),
            "scriptDigest": sha256_file(Path(args.harness)),
            "estateVersion": estate["version"],
            "estateSeed": estate["seed"],
            "estateSha256": estate["estateSha256"],
            "documents": len(docs),
            "pairs": n,
            "thresholdSelection": "in-sample max-F1 sweep on the evaluation pairs (disclosed, same as W1)",
        },
        "specialist": result,
        "staticBaseline": {
            "modelId": STATIC_BASELINE_MODEL,
            "modelDigest": meta.get("modelDigest"),
            "license": meta.get("license"),
            "threshold": base_result["threshold"],
            "identityDisjoint": base_result["buckets"]["identity_disjoint"],
            "identityDisjointCrossDepartment": base_joint,
        },
        "gate": gate,
        "evidencePointersSample": evidence_sample,
        "latency": {
            "encodeMsPerDocument": encode_ms / max(1, len(docs)),
            "pairScoringMsPerPair": latency,
        },
    }


# ---------------------------------------------------------------------------
# Artifact and model output
# ---------------------------------------------------------------------------

def write_entry(out: Path, entry: dict) -> dict:
    artifact = {"kind": "weft-specialist-training", "schemaVersion": SCHEMA_VERSION,
                "appendOnly": True, "entries": []}
    if out.exists():
        prior = json.loads(out.read_text(encoding="utf-8"))
        if prior.get("kind") != artifact["kind"] or prior.get("appendOnly") is not True:
            raise WeftSpecialistError(f"refusing to overwrite incompatible artifact: {out}")
        artifact["entries"] = prior.get("entries", [])
    digest = hashlib.sha256(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    entry = {"runId": digest, **entry}
    artifact["entries"].append(entry)
    payload = json.dumps(artifact, indent=2)
    for word in BANNED:
        if word in payload.lower():
            raise WeftSpecialistError(f"banned word present in artifact: {word}")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + f".tmp-{os.getpid()}")
    tmp.write_bytes(payload.encode("utf-8"))
    os.replace(tmp, out)
    return artifact


def save_model(model, tokenizer, model_dir: Path, manifest: dict) -> dict:
    import torch
    model_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), model_dir / "model.pt")
    tokenizer.save_pretrained(model_dir / "tokenizer")
    (model_dir / "manifest.json").write_bytes(
        json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"))
    files = [p for p in model_dir.rglob("*") if p.is_file()]
    return {
        "path": display_path(model_dir),
        "bytes": sum(p.stat().st_size for p in files),
        "fileCount": len(files),
        "sha256": digest_paths(files),
        "unquantized": True,
        "note": "Quantization-aware export is W5; this artifact is the un-quantized specialist.",
    }


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def plan(args) -> dict:
    train_path = Path(args.train_data)
    receipt_path = train_path.with_name("receipt.json")
    pairs = load_pairs(train_path)
    snap = find_snapshot(BASE_MODEL)
    base_digest = None
    if snap is not None and weight_path(snap) is not None:
        base_digest = digest_paths(files_without_weights(snap) + [weight_path(snap)])
    harness = Path(args.harness)
    return {
        "kind": "weft-specialist-plan",
        "schemaVersion": SCHEMA_VERSION,
        "ticket": args.ticket,
        "seeds": {"run": args.seed},
        "baseEncoder": {"modelId": BASE_MODEL, "license": BASE_LICENSE,
                        "digest": base_digest, "localWeights": base_digest is not None},
        "trainingData": {
            "trainPath": str(train_path),
            "trainSha256": sha256_file_lf(train_path),
            "trainRawSha256": sha256_file(train_path),
            "receiptPath": str(receipt_path),
            "receiptSha256": sha256_file_lf(receipt_path) if receipt_path.is_file() else None,
            "lineEndings": "LF-normalized digest (matches the W2 receipt on a CRLF checkout)",
            "pairCount": len(pairs),
        },
        "hyperparameters": hyperparameters(args),
        "deviceRequirement": "CUDA by default; --device cpu is an explicit recorded small-scale run",
        "harness": {"path": display_path(harness), "digest": sha256_file(harness) if harness.is_file() else None},
    }


def hyperparameters(args) -> dict:
    return {
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "learningRateBase": args.lr_base,
        "learningRateHeads": args.lr_heads,
        "weightDecay": args.weight_decay,
        "gradClip": args.grad_clip,
        "maxLength": args.max_length,
        "optimizer": "AdamW",
        "temperature": args.temperature,
        "positiveWeight": args.positive_weight,
        "hardNegativeTopK": args.hard_negative_top_k,
        "hubPower": args.hub_power,
        "lossWeights": {"linkBce": 1.0, "crossclrContrastive": args.contrastive_weight,
                        "evidenceProxy": args.evidence_weight},
        "themeDim": args.theme_dim,
        "headHidden": args.head_hidden,
        "anchorSetMax": 4,
        "architecture": ("MiniLM-L6 encoder + anchor-set pooling + link-logit MLP + "
                         "theme projection + token evidence head"),
        "excludedByTicket": "identity adversary, set-conditioning term, triangle term",
    }


def kaggle_notebook(args) -> dict:
    run = ("# Repository checkout is uploaded to the notebook (public/synthetic data only).\n"
           "!python scripts/train-weft-specialist.py --device cuda "
           f"--epochs {args.epochs} --seed {args.seed} "
           "--out results/weft-specialist-training.json --model-dir models/weft-specialist")
    env = ("import platform, torch, transformers\n"
           "print(platform.platform(), torch.__version__, torch.version.cuda, "
           "transformers.__version__)\n"
           "print([torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())])")
    cells = [
        {"cell_type": "markdown", "metadata": {}, "source": [
            "# Weft specialist training (ticket W3)\n",
            "\n",
            "Runtime: Kaggle Notebook, 2x Tesla T4. Founder guardrails: training data is "
            "public/synthetic only (never private customer data); this notebook records the "
            "T4/CUDA/framework environment into the artifact; local scripts stay fail-closed "
            "without a GPU, and Kaggle is only where `train-weft-specialist.py` executes.\n",
            "\n",
            "The model is initialized from all-MiniLM-L6-v2 (Apache-2.0). Evaluation runs "
            "through the W1 harness in the same checkout.\n",
        ]},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": env.splitlines(keepends=True)},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": run.splitlines(keepends=True)},
        {"cell_type": "markdown", "metadata": {}, "source": [
            "## Re-run\n",
            "\n",
            "`python scripts/train-weft-specialist.py --device cuda --epochs 20`\n",
            "\n",
            "Without a GPU the same command exits nonzero with "
            "`WEFT_TRAINING_RUNTIME_UNAVAILABLE`. `--device cpu` is only for the explicit "
            "fixture-scale local run.\n",
        ]},
    ]
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "accelerator": "GPU",
            "kaggle": {"accelerator": "nvidiaTeslaT4", "gpuCount": 2,
                       "note": "The 23M-parameter specialist fits one T4; both are recorded by the environment probe."},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def run_training(args) -> dict:
    try:
        import numpy  # noqa: F401
        import torch
        import transformers
    except Exception as exc:  # noqa: BLE001
        raise TrainingRuntimeUnavailable(f"torch/transformers unavailable: {type(exc).__name__}: {exc}") from exc

    if args.device == "cuda" and not torch.cuda.is_available():
        raise TrainingRuntimeUnavailable(
            "CUDA runtime absent; the default path fails closed. Use --device cpu only for "
            "an explicit small-scale run.")
    if args.device == "auto":
        if not torch.cuda.is_available():
            raise TrainingRuntimeUnavailable(
                "no CUDA device available; run on the Kaggle 2x T4 recipe, or pass --device cpu "
                "for an explicit recorded small-scale run")
        args.device = "cuda"
    device = torch.device(args.device if args.device == "cpu" or torch.cuda.is_available() else "cpu")

    train_path = Path(args.train_data)
    receipt_path = train_path.with_name("receipt.json")
    pairs = load_pairs(train_path)
    if args.batch_size > len(pairs):
        args.batch_size = len(pairs)
    snap, base_digest = require_base_snapshot()

    harness = load_harness(Path(args.harness))

    seed_everything(args.seed)
    from transformers import AutoModel, AutoTokenizer
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        tokenizer = AutoTokenizer.from_pretrained(str(snap), local_files_only=True)
        base = AutoModel.from_pretrained(str(snap), local_files_only=True)
    except Exception as exc:  # noqa: BLE001
        raise BaseEncoderUnavailable(f"could not load {BASE_MODEL} weights: {exc}") from exc
    model = build_model(base, args.theme_dim, args.head_hidden).to(device)
    parameter_count = sum(p.numel() for p in model.parameters())

    history, wall = train(model, tokenizer, pairs, args, device)
    evaluation = evaluate(model, tokenizer, harness, args, device)

    if device.type == "cuda":
        disclosure = (f"GPU run on {torch.cuda.device_count()} x "
                      f"{torch.cuda.get_device_name(0)}; Kaggle recipe uses 2x Tesla T4")
    else:
        disclosure = ("CPU small-scale run on fixture-scale W2 pairs; not the Kaggle 2x T4 "
                      "recipe, recorded so the numbers are not read as GPU-scale")
    environment = {
        "device": device.type,
        "cudaAvailable": bool(torch.cuda.is_available()),
        "cudaVersion": torch.version.cuda,
        "gpuCount": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "gpuNames": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
        if torch.cuda.is_available() else [],
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "kaggle": bool(os.environ.get("KAGGLE_KERNEL_RUN_TYPE")),
        "computeDisclosure": disclosure,
    }

    manifest = {
        "kind": "weft-specialist",
        "schemaVersion": SCHEMA_VERSION,
        "ticket": args.ticket,
        "baseEncoder": {"modelId": BASE_MODEL, "digest": base_digest, "license": BASE_LICENSE},
        "trainingData": {"trainSha256": sha256_file_lf(train_path)},
        "seeds": {"run": args.seed},
        "hyperparameters": hyperparameters(args),
        "environment": environment,
    }
    artifact = save_model(model, tokenizer, Path(args.model_dir), manifest)

    entry = {
        "ticket": args.ticket,
        "status": "ran",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seeds": {"python": args.seed, "numpy": args.seed, "torch": args.seed,
                  "evaluation": args.seed, "resampleSeed": args.seed},
        "baseEncoder": {
            "modelId": BASE_MODEL,
            "digest": base_digest,
            "license": BASE_LICENSE,
            "licenseVerifiedFrom": "results/weft-baselines.json entry 2 (W1), model digest recorded there",
            "parameterCount": parameter_count,
            "initialization": "fine-tuned from local open-encoder weights, never from scratch",
        },
        "trainingData": {
            "trainPath": display_path(train_path),
            "trainSha256": sha256_file_lf(train_path),
            "trainRawSha256": sha256_file(train_path),
            "receiptPath": display_path(receipt_path),
            "receiptSha256": sha256_file_lf(receipt_path) if receipt_path.is_file() else None,
            "lineEndings": "LF-normalized digest (matches the W2 receipt on a CRLF checkout)",
            "pairCount": len(pairs),
            "scale": args.data_scale,
            "byPairType": {t: sum(1 for p in pairs if p["pairType"] == t)
                           for t in sorted({p["pairType"] for p in pairs})},
        },
        "hyperparameters": hyperparameters(args),
        "environment": environment,
        "training": {"epochsRun": len(history), "lossHistory": history,
                     "wallSeconds": wall, "parameters": parameter_count},
        "evaluation": evaluation,
        "artifact": artifact,
        "notes": [
            "Bare specialist only: no identity adversary, no set-conditioning term, no triangle term.",
            "Anchors are one chunk per pair in this run; the interface accepts up to four.",
            "W2 pairs carry no evidence-span labels, so the evidence head is trained with a token-similarity proxy; no evidence-F1 is claimed.",
            "Threshold selection is in-sample on the evaluation pairs for both sides (W1 convention, disclosed).",
        ],
    }
    written = write_entry(Path(args.out), entry)
    return {"runId": written["entries"][-1]["runId"], "entries": len(written["entries"]),
            "out": args.out, "gate": evaluation["gate"]}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Train the un-quantized Weft specialist (W3)")
    parser.add_argument("--mode", choices=["train", "plan", "kaggle-notebook"], default="train")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr-base", type=float, default=5e-5)
    parser.add_argument("--lr-heads", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--grad-clip", type=float, default=1.0)
    parser.add_argument("--max-length", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.07)
    parser.add_argument("--positive-weight", type=float, default=1.5)
    parser.add_argument("--hard-negative-top-k", type=int, default=3)
    parser.add_argument("--hub-power", type=float, default=0.5)
    parser.add_argument("--contrastive-weight", type=float, default=0.5)
    parser.add_argument("--evidence-weight", type=float, default=0.2)
    parser.add_argument("--theme-dim", type=int, default=128)
    parser.add_argument("--head-hidden", type=int, default=256)
    parser.add_argument("--resamples", type=int, default=200)
    parser.add_argument("--train-data", default=str(ROOT / "results/weft-training-pairs/train.jsonl"))
    parser.add_argument("--harness", default=str(ROOT / "scripts/run-weft-baseline-shootout.py"))
    parser.add_argument("--out", default=str(ROOT / "results/weft-specialist-training.json"))
    parser.add_argument("--model-dir", default=str(ROOT / "models/weft-specialist"))
    parser.add_argument("--ticket", default="W3",
                        help="ticket label recorded in the plan, manifest, and results entry")
    parser.add_argument("--data-scale", default="fixture",
                        help="training-data scale label recorded in the results entry")
    parser.add_argument("--emit-kaggle-notebook", action="store_true",
                        help="print a ready-to-run Kaggle 2x T4 notebook JSON and exit")
    args = parser.parse_args(argv)

    if args.emit_kaggle_notebook:
        args.mode = "kaggle-notebook"

    try:
        if args.mode == "plan":
            print(json.dumps(plan(args), indent=2))
            return 0
        if args.mode == "kaggle-notebook":
            print(json.dumps(kaggle_notebook(args), indent=2))
            return 0
        summary = run_training(args)
        print(json.dumps(summary))
        return 0
    except WeftSpecialistError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
