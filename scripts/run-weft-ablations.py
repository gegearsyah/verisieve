#!/usr/bin/env python3
"""Weft ablative extras, one at a time (ticket W4).

Trains the W3 specialist once per stage, adding one extra at a time: identity
adversary (gradient reversal on identity prediction), set-conditioning over anchor
sets, triangle consistency, and modality invariance. Every stage is evaluated
through the W1 harness (`scripts/run-weft-baseline-shootout.py`) with the same
deterministic estate, pair builder, metric code, and in-sample max-F1 threshold
sweep. Each stage records an honest delta against the W3 bare specialist: positive,
zero, or negative, never invented and never overwritten.

Identity-suppression decision experiment (the H2 redefinition). For every stage the
exported theme embeddings are probed by a post-hoc classifier battery (linear and a
small MLP) and reported even when leakage shows. The artifact records both the
in-training gradient-reversal adversary and the INLP-style post-hoc null-space
projection (with its link-F1 retention) so the founder can decide between them.
Wording is "identity-blind" throughout, never an invariance claim.

Fail-closed contract. `--device auto`/`--device cuda` require a CUDA runtime and exit
2 with `WEFT_ABLATION_RUNTIME_UNAVAILABLE` when it is absent, leaving the artifact
untouched. `--device cpu` is an explicit, recorded fixture-scale run. Missing W3
artifact, training data, harness, or a non-comparable baseline are typed errors too.
Nothing is written on a typed failure.

Artifact: results/weft-ablations.json (append-only; seeds, digests, licences,
hyperparameters, environment, evaluation, probe battery, decision evidence).

Usage:
  python scripts/run-weft-ablations.py --mode plan
  python scripts/run-weft-ablations.py --device cpu --stage all
  python scripts/run-weft-ablations.py --device cpu --stage adversary
  python scripts/run-weft-ablations.py --device cuda --stage all
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
DEFAULT_SEED = 20261127
EXTRAS_ORDER = ("adversary", "set-conditioning", "triangle", "modality")
STAGES = ("bare",) + EXTRAS_ORDER
BANNED = ("mathematically" + " grounded", "elimin" + "ates", "fir" + "st")
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SPECIALIST = ROOT / "scripts" / "train-weft-specialist.py"
DEFAULT_HARNESS = ROOT / "scripts" / "run-weft-baseline-shootout.py"
DEFAULT_BASELINE = ROOT / "results" / "weft-specialist-training.json"
DEFAULT_TRAIN = ROOT / "results" / "weft-training-pairs" / "train.jsonl"
DEFAULT_OUT = ROOT / "results" / "weft-ablations.json"


# ---------------------------------------------------------------------------
# Typed fail-closed errors
# ---------------------------------------------------------------------------

class WeftAblationError(Exception):
    code = "WEFT_ABLATION_ERROR"

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class AblationRuntimeUnavailable(WeftAblationError):
    code = "WEFT_ABLATION_RUNTIME_UNAVAILABLE"


class AblationBaselineUnavailable(WeftAblationError):
    code = "WEFT_ABLATION_BASELINE_UNAVAILABLE"


class AblationTrainingDataUnavailable(WeftAblationError):
    code = "WEFT_ABLATION_TRAINING_DATA_UNAVAILABLE"


class AblationHarnessUnavailable(WeftAblationError):
    code = "WEFT_ABLATION_HARNESS_UNAVAILABLE"


class AblationArtifactIncompatible(WeftAblationError):
    code = "WEFT_ABLATION_ARTIFACT_INCOMPATIBLE"


# ---------------------------------------------------------------------------
# Module loading and input parsing
# ---------------------------------------------------------------------------

def load_module(path: Path, name: str):
    if not path.is_file():
        raise WeftAblationError(f"required module absent: {path}")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_w3(path: Path):
    return load_module(path, "weft_w3_specialist")


def load_pairs(path: Path) -> list[dict]:
    """W3 pairs plus the provenance labels the extras need (identity, formats)."""
    if not path.is_file():
        raise AblationTrainingDataUnavailable(f"training pairs absent: {path}")
    pairs = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            prov = row["provenance"]
            themes = [str(t) for t in prov["themes"]]
            formats = [str(f) for f in prov.get("formats", ["", ""])]
            if len(themes) != 2 or len(formats) != 2:
                raise ValueError("provenance.themes/formats must have two entries")
            pairs.append({
                "id": str(row["id"]),
                "anchor": str(row["textA"]),
                "candidate": str(row["textB"]),
                "label": 1.0 if str(row["label"]) == "positive" else 0.0,
                "anchorTheme": themes[0],
                "candidateTheme": themes[1],
                "pairType": str(row.get("pairType", "unknown")),
                "identityDisjoint": bool(prov.get("identityDisjoint", False)),
                "formats": formats,
            })
        except Exception as exc:  # noqa: BLE001 - typed fail-closed
            raise AblationTrainingDataUnavailable(
                f"{path.name}:{lineno}: malformed pair: {exc}") from exc
    if not pairs:
        raise AblationTrainingDataUnavailable(f"training pairs empty: {path}")
    return pairs


def extras_for(stage: str) -> list[str]:
    if stage == "bare":
        return []
    return [stage]


def stages_for(value: str) -> list[str]:
    return list(STAGES) if value == "all" else [value]


# ---------------------------------------------------------------------------
# Baseline (W3 bare specialist) and comparability
# ---------------------------------------------------------------------------

def load_baseline(path: Path, w3) -> dict:
    if not path.is_file():
        raise AblationBaselineUnavailable(f"W3 baseline artifact absent: {path}")
    try:
        artifact = json.loads(path.read_text(encoding="utf-8"))
        entry = artifact["entries"][-1]
        f1 = float(entry["evaluation"]["specialist"]["identityDisjointCrossDepartment"]["f1"])
        harness = entry["evaluation"]["harness"]
    except Exception as exc:  # noqa: BLE001 - typed fail-closed
        raise AblationBaselineUnavailable(f"malformed W3 baseline artifact: {exc}") from exc
    return {
        "artifact": w3.display_path(path),
        "runId": entry.get("runId"),
        "metric": "identity_disjoint_cross_department_pairwise_f1",
        "f1": f1,
        "harness": harness,
        "seeds": entry.get("seeds", {}),
        "baseEncoderDigest": entry.get("baseEncoder", {}).get("digest"),
    }


def require_comparable(baseline: dict, harness_path: Path, estate: dict, w3):
    """The delta is only honest if both sides used the same harness and estate."""
    recorded = baseline["harness"]
    if recorded.get("estateVersion") != estate["version"]:
        raise AblationBaselineUnavailable(
            f"estate version mismatch: baseline {recorded.get('estateVersion')} vs {estate['version']}")
    if recorded.get("estateSeed") != estate["seed"]:
        raise AblationBaselineUnavailable(
            f"estate seed mismatch: baseline {recorded.get('estateSeed')} vs {estate['seed']}")
    if recorded.get("estateSha256") != estate["estateSha256"]:
        raise AblationBaselineUnavailable(
            "estate digest mismatch: the W3 baseline is not comparable on this checkout")
    if harness_path.is_file():
        digests = {w3.sha256_file(harness_path), w3.sha256_file_lf(harness_path)}
        if recorded.get("scriptDigest") not in digests:
            raise AblationBaselineUnavailable(
                "W1 harness digest mismatch: the W3 baseline is not comparable on this checkout")


# ---------------------------------------------------------------------------
# Model with extras
# ---------------------------------------------------------------------------

def build_ablation_model(w3, base, theme_dim: int, head_hidden: int, extras: list[str]):
    import torch
    from torch import nn

    core = w3.build_model(base, theme_dim, head_hidden)
    if not extras:
        return core

    hidden = base.config.hidden_size

    class AblationModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.core = core
            if "adversary" in extras:
                self.adv = nn.Sequential(
                    nn.Linear(4 * hidden, 128), nn.GELU(), nn.Linear(128, 1))

        def encode(self, *a, **k):
            return self.core.encode(*a, **k)

        def encode_anchor_set(self, *a, **k):
            return self.core.encode_anchor_set(*a, **k)

        def link_logits(self, *a, **k):
            return self.core.link_logits(*a, **k)

    return AblationModel()


# ---------------------------------------------------------------------------
# Training with extras
# ---------------------------------------------------------------------------

def build_anchor_sets(pairs: list[dict], max_members: int = 4) -> dict[str, list[str]]:
    by_theme: dict[str, list[str]] = {}
    for p in pairs:
        by_theme.setdefault(p["anchorTheme"], [])
        if p["anchor"] not in by_theme[p["anchorTheme"]]:
            by_theme[p["anchorTheme"]].append(p["anchor"])
    return {k: v[:max_members] for k, v in by_theme.items()}


def train_stage(model, tokenizer, pairs: list[dict], args, device, extras: list[str],
                sets_by_theme: dict[str, list[str]], w3):
    import torch
    import torch.nn.functional as F

    torch.manual_seed(args.seed)

    class _ReverseGrad(torch.autograd.Function):
        @staticmethod
        def forward(ctx, x, lambd):
            ctx.lambd = lambd
            return x.view_as(x)

        @staticmethod
        def backward(ctx, grad):
            return -ctx.lambd * grad, None

    labels = torch.tensor([p["label"] for p in pairs], device=device)
    same_theme_all = torch.tensor(
        [[p["anchorTheme"] == q["candidateTheme"] for q in pairs] for p in pairs],
        dtype=torch.bool, device=device)
    disjoint_all = torch.tensor(
        [1.0 if p["identityDisjoint"] else 0.0 for p in pairs], device=device)
    cross_modality_all = torch.tensor(
        [p["formats"][0] != p["formats"][1] for p in pairs], dtype=torch.bool, device=device)

    base_params, head_params = [], []
    for name, param in model.named_parameters():
        is_base = name.startswith("base.") or ".base." in name
        (base_params if is_base else head_params).append(param)
    optimizer = torch.optim.AdamW([
        {"params": base_params, "lr": args.lr_base},
        {"params": head_params, "lr": args.lr_heads},
    ], weight_decay=args.weight_decay)
    bce = torch.nn.BCEWithLogitsLoss()
    n = len(pairs)
    history: list[dict] = []
    model.train()
    t0 = time.perf_counter()

    for epoch in range(args.epochs):
        order = torch.randperm(n, device=device)
        totals = {"loss": 0.0, "linkBce": 0.0, "crossclr": 0.0, "evidence": 0.0,
                  "adversary": 0.0, "setConsistency": 0.0, "triangle": 0.0,
                  "modality": 0.0}
        adv_acc = 0.0
        adv_seen = 0
        seen = 0
        for start in range(0, n, args.batch_size):
            idx = order[start:start + args.batch_size]
            batch = [pairs[int(i)] for i in idx]
            labels_b = labels[idx]
            same_theme = same_theme_all[idx][:, idx]
            optimizer.zero_grad()

            if "set-conditioning" in extras:
                chunk_sets = [sets_by_theme.get(p["anchorTheme"], [p["anchor"]]) for p in batch]
                flat = [chunk for chunks in chunk_sets for chunk in chunks]
                member_enc = model.core.encode(tokenizer, flat, args.max_length, device)
                owner = torch.tensor(
                    [i for i, chunks in enumerate(chunk_sets) for _ in chunks], device=device)
                counts = torch.bincount(owner, minlength=len(batch)).clamp_min(1)
                summed = torch.zeros(len(batch), member_enc["pooled"].shape[1], device=device)
                summed.index_add_(0, owner, member_enc["pooled"])
                anchor_pooled = summed / counts.unsqueeze(1).float()
                anchor_theme = F.normalize(model.core.theme(anchor_pooled), dim=-1)
            else:
                anchor_enc = model.encode_anchor_set(
                    tokenizer, [[p["anchor"]] for p in batch], args.max_length, device)
                anchor_pooled = anchor_enc["pooled"]
                anchor_theme = anchor_enc["theme"]
                member_enc = None
                owner = None
                counts = None

            cand_enc = model.encode(tokenizer, [p["candidate"] for p in batch],
                                    args.max_length, device)
            logits = model.link_logits(anchor_pooled, cand_enc["pooled"])
            link = bce(logits, labels_b)

            if len(batch) >= 2:
                contrast = w3.crossclr_loss(
                    anchor_theme, cand_enc["theme"], same_theme, args.temperature,
                    args.hard_negative_top_k, args.hub_power, args.positive_weight)
            else:
                contrast = logits.sum() * 0.0

            pos_rows = labels_b > 0.5
            evidence = (w3.evidence_kl(cand_enc["salience"][pos_rows], cand_enc["h"][pos_rows],
                                       cand_enc["mask"][pos_rows], anchor_pooled[pos_rows])
                        if bool(pos_rows.any()) else logits.sum() * 0.0)

            loss = link + args.contrastive_weight * contrast + args.evidence_weight * evidence
            extra_values = {"adversary": 0.0, "setConsistency": 0.0,
                            "triangle": 0.0, "modality": 0.0}

            if "adversary" in extras:
                feats = torch.cat([anchor_pooled, cand_enc["pooled"],
                                   anchor_pooled - cand_enc["pooled"],
                                   anchor_pooled * cand_enc["pooled"]], dim=-1)
                adv_logits = model.adv(_ReverseGrad.apply(feats, args.adversary_lambda)).squeeze(-1)
                adv_loss = bce(adv_logits, disjoint_all[idx])
                loss = loss + args.adversary_weight * adv_loss
                extra_values["adversary"] = float(adv_loss.detach())
                adv_acc += float(((adv_logits.detach() > 0).float()
                                  == disjoint_all[idx]).float().sum())
                adv_seen += len(batch)

            if "set-conditioning" in extras and member_enc is not None:
                member_logits = model.link_logits(
                    member_enc["pooled"], cand_enc["pooled"][owner])
                sums = torch.zeros(len(batch), device=device)
                sums.index_add_(0, owner, member_logits)
                means = sums / counts.float()
                var = torch.zeros(len(batch), device=device)
                var.index_add_(0, owner, (member_logits - means[owner]) ** 2)
                set_loss = (var / counts.float()).mean()
                loss = loss + args.set_weight * set_loss
                extra_values["setConsistency"] = float(set_loss.detach())

            if "triangle" in extras:
                m = len(batch)
                theme_ids = [p["anchorTheme"] for p in batch]
                ap = anchor_pooled.repeat_interleave(m, 0)
                cp = cand_enc["pooled"].repeat(m, 1)
                s = model.link_logits(ap, cp).view(m, m)
                triples = [(i, j, k) for i in range(m) for j in range(m) for k in range(m)
                           if len({i, j, k}) == 3
                           and theme_ids[i] == theme_ids[j]
                           and theme_ids[j] == theme_ids[k]]
                if triples:
                    t = torch.tensor(triples, device=device)
                    s_ij = s[t[:, 0], t[:, 1]]
                    s_jk = s[t[:, 1], t[:, 2]]
                    s_ik = s[t[:, 0], t[:, 2]]
                    tri_loss = torch.relu(
                        args.triangle_margin + torch.minimum(s_ij, s_jk) - s_ik).mean()
                    loss = loss + args.triangle_weight * tri_loss
                    extra_values["triangle"] = float(tri_loss.detach())

            if "modality" in extras:
                selected = cross_modality_all[idx] & pos_rows
                if bool(selected.any()):
                    cos = (anchor_theme[selected] * cand_enc["theme"][selected]).sum(-1)
                    mod_loss = (1.0 - cos).mean()
                    loss = loss + args.modality_weight * mod_loss
                    extra_values["modality"] = float(mod_loss.detach())

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip)
            optimizer.step()

            totals["loss"] += float(loss.detach()) * len(batch)
            totals["linkBce"] += float(link.detach()) * len(batch)
            totals["crossclr"] += float(contrast.detach()) * len(batch)
            totals["evidence"] += float(evidence.detach()) * len(batch)
            for key, value in extra_values.items():
                totals[key] += value * len(batch)
            seen += len(batch)

        row = {"epoch": epoch + 1,
               **{k: v / max(1, seen) for k, v in totals.items()}}
        if adv_seen:
            row["adversaryAccuracy"] = adv_acc / adv_seen
        history.append(row)

    return history, time.perf_counter() - t0


# ---------------------------------------------------------------------------
# Evaluation and scoring
# ---------------------------------------------------------------------------

def score_pairs(model, pooled, pairs: list[dict], device) -> list[float]:
    import torch
    scores = []
    with torch.no_grad():
        for start in range(0, len(pairs), 2048):
            chunk = pairs[start:start + 2048]
            ai = torch.tensor([p["i"] for p in chunk], device=device)
            cj = torch.tensor([p["j"] for p in chunk], device=device)
            fwd = model.link_logits(pooled[ai], pooled[cj]).sigmoid()
            bwd = model.link_logits(pooled[cj], pooled[ai]).sigmoid()
            scores.extend(((fwd + bwd) / 2.0).cpu().tolist())
    return scores


def evaluate_stage(model, tokenizer, harness, w3, args, device, estate):
    import torch
    docs = estate["documents"]
    pairs = harness.build_pairs(docs)

    model.eval()
    t0 = time.perf_counter()
    with torch.no_grad():
        enc = model.encode(tokenizer, [d["text"] for d in docs], args.max_length, device)
    encode_ms = (time.perf_counter() - t0) * 1000.0

    scores = score_pairs(model, enc["pooled"], pairs, device)
    allowed = [True] * len(pairs)
    result = harness.evaluate_scores(docs, pairs, scores, allowed, args.resamples, args.seed)
    joint, joint_pairs = w3.joint_identity_disjoint_cross_department(
        harness, pairs, scores, result["threshold"])
    result["identityDisjointCrossDepartment"] = joint
    result["identityDisjointCrossDepartmentPairs"] = joint_pairs
    result["latency"] = {
        "encodeMsPerDocument": encode_ms / max(1, len(docs)),
        "evaluatedPairs": len(pairs),
    }
    result["estate"] = {
        "version": estate["version"],
        "seed": estate["seed"],
        "estateSha256": estate["estateSha256"],
        "documents": len(docs),
        "pairs": len(pairs),
    }
    return result, enc, docs, pairs, scores


# ---------------------------------------------------------------------------
# Post-hoc probe battery (H2: never the in-training adversary alone)
# ---------------------------------------------------------------------------

def identity_labels(docs: list[dict], harness) -> tuple[list[int], int]:
    people = set(harness.PEOPLE)
    raw = []
    for d in docs:
        authors = [e for e in d["entities"] if e in people]
        raw.append(authors[0] if authors else (d["entities"][0] if d["entities"] else "unknown"))
    uniq = sorted(set(raw))
    index = {value: k for k, value in enumerate(uniq)}
    return [index[value] for value in raw], len(uniq)


def stratified_split(labels: list[int], seed: int, train_fraction: float = 0.7):
    rng = random.Random(seed)
    by_class: dict[int, list[int]] = {}
    for k, label in enumerate(labels):
        by_class.setdefault(label, []).append(k)
    train: list[int] = []
    test: list[int] = []
    for label in sorted(by_class):
        idx = list(by_class[label])
        rng.shuffle(idx)
        take = max(1, int(round(train_fraction * len(idx))))
        if len(idx) > 1:
            take = min(take, len(idx) - 1)
        train.extend(idx[:take])
        test.extend(idx[take:])
    if not test:
        test = train[-1:]
        train = train[:-1]
    return sorted(train), sorted(test)


def fit_probe(x_train, y_train, x_test, y_test, nonlinear: bool, seed: int, steps: int = 200):
    import torch
    import torch.nn.functional as F
    torch.manual_seed(seed)
    d = x_train.shape[1]
    classes = int(max(int(y_train.max()), int(y_test.max()))) + 1
    if nonlinear:
        probe = torch.nn.Sequential(
            torch.nn.Linear(d, 64), torch.nn.ReLU(), torch.nn.Linear(64, classes))
        hidden = 64
    else:
        probe = torch.nn.Linear(d, classes)
        hidden = None
    opt = torch.optim.AdamW(probe.parameters(), lr=1e-2, weight_decay=1e-2)
    for _ in range(steps):
        opt.zero_grad()
        loss = F.cross_entropy(probe(x_train), y_train)
        loss.backward()
        opt.step()
    with torch.no_grad():
        test_acc = float((probe(x_test).argmax(1) == y_test).float().mean())
        train_acc = float((probe(x_train).argmax(1) == y_train).float().mean())
    return {"testAccuracy": test_acc, "trainAccuracy": train_acc,
            "steps": steps, "hidden": hidden}


def probe_battery(theme, labels: list[int], seed: int) -> dict:
    import torch
    x = theme.detach().float().cpu()
    y = torch.tensor(labels)
    train, test = stratified_split(labels, seed)
    classes = len(set(labels))
    test_counts: dict[int, int] = {}
    for k in test:
        test_counts[labels[k]] = test_counts.get(labels[k], 0) + 1
    majority = (max(test_counts.values()) / len(test)) if test else 0.0
    return {
        "target": "author identity on the evaluation estate theme embeddings",
        "classes": classes,
        "documents": len(labels),
        "split": {"train": len(train), "test": len(test), "fraction": 0.7, "seed": seed},
        "chanceAccuracy": 1.0 / classes,
        "majorityBaseline": majority,
        "linear": fit_probe(x[train], y[train], x[test], y[test], False, seed),
        "nonlinearMlp": fit_probe(x[train], y[train], x[test], y[test], True, seed + 1),
        "wording": "identity-blind: this battery measures residual identity information in the exported theme embedding",
        "note": ("accuracy is measured on a held-out document split; values near or below chance "
                 "on this fixture are reported as measured"),
    }


def fit_linear_probe(x, y, seed: int, steps: int = 200):
    import torch
    import torch.nn.functional as F
    torch.manual_seed(seed)
    probe = torch.nn.Linear(x.shape[1], int(y.max()) + 1)
    opt = torch.optim.AdamW(probe.parameters(), lr=1e-2, weight_decay=1e-2)
    for _ in range(steps):
        opt.zero_grad()
        loss = F.cross_entropy(probe(x), y)
        loss.backward()
        opt.step()
    return probe


def inlp_project(x, labels: list[int], seed: int, iterations: int = 5):
    """INLP: iteratively remove the row space of a linear identity probe.

    The projection keeps the representation dimensionality so the link head can
    still consume the projected vectors; each iteration retrains the probe.
    """
    import torch
    x_cpu = x.detach().float().cpu()
    y = torch.tensor(labels)
    train, test = stratified_split(labels, seed)
    projection = torch.eye(x_cpu.shape[1])
    history = []
    for it in range(iterations):
        probe = fit_linear_probe(x_cpu[train] @ projection, y[train], seed + it)
        weight = probe.weight.detach()
        _, singular, vh = torch.linalg.svd(weight, full_matrices=False)
        if singular.numel() == 0 or float(singular.max()) == 0.0:
            break
        rank = int((singular > 1e-6 * singular.max()).sum())
        if rank == 0:
            break
        removed = vh[:rank]
        projection = projection @ (torch.eye(x_cpu.shape[1]) - removed.T @ removed)
        projected = x_cpu @ projection
        linear = fit_probe(projected[train], y[train], projected[test], y[test], False, seed + it)
        nonlinear = fit_probe(projected[train], y[train], projected[test], y[test], True, seed + 100 + it)
        history.append({
            "iteration": it + 1,
            "removedDirections": rank,
            "linearProbeAccuracy": linear["testAccuracy"],
            "nonlinearProbeAccuracy": nonlinear["testAccuracy"],
        })
        if linear["testAccuracy"] <= (1.0 / len(set(labels))) * 1.1:
            break
    return x_cpu @ projection, projection, history


def identity_suppression_evidence(model, theme, pooled, labels, harness, w3, docs, pairs,
                                  scores, result, battery, args, device, extras,
                                  training_history) -> dict:
    import torch
    theme_projected, _, theme_history = inlp_project(theme, labels, args.seed)
    pooled_projected, _, pooled_history = inlp_project(pooled, labels, args.seed + 1000)
    train, test = stratified_split(labels, args.seed)
    y = torch.tensor(labels)
    theme_after = {
        "linear": fit_probe(theme_projected[train], y[train], theme_projected[test],
                            y[test], False, args.seed),
        "nonlinearMlp": fit_probe(theme_projected[train], y[train], theme_projected[test],
                                  y[test], True, args.seed + 1),
    }
    projected_scores = score_pairs(model, pooled_projected.to(device), pairs, device)
    allowed = [True] * len(pairs)
    projected_result = harness.evaluate_scores(
        docs, pairs, projected_scores, allowed, args.resamples, args.seed)
    joint_after, _ = w3.joint_identity_disjoint_cross_department(
        harness, pairs, projected_scores, projected_result["threshold"])

    adversary_history = [row.get("adversaryAccuracy") for row in training_history
                         if "adversaryAccuracy" in row]
    return {
        "wording": "identity-blind",
        "h2Metric": ("post-hoc classifier battery (linear and small MLP) on exported theme "
                     "embeddings, never the in-training adversary alone"),
        "caveat": ("Elazar & Goldberg (2018) report that a post-hoc classifier still recovers "
                   "the attribute when an in-training adversary reaches chance, and advise "
                   "against relying on adversarial training for invariant representations."),
        "inTrainingAdversary": {
            "enabled": "adversary" in extras,
            "mechanism": "gradient-reversal identity-overlap classifier on the link representation",
            "accuracyHistory": adversary_history,
            "finalAccuracy": adversary_history[-1] if adversary_history else None,
            "note": "in-training accuracy is not a leak guarantee; the post-hoc battery is authoritative",
        },
        "postHocInlp": {
            "enabled": True,
            "mechanism": "INLP null-space projection fitted on identity labels over the evaluation estate",
            "probeAccuracyBefore": {
                "linear": battery["linear"]["testAccuracy"],
                "nonlinearMlp": battery["nonlinearMlp"]["testAccuracy"],
            },
            "probeAccuracyAfter": {
                "linear": theme_after["linear"]["testAccuracy"],
                "nonlinearMlp": theme_after["nonlinearMlp"]["testAccuracy"],
            },
            "iterationsOnTheme": theme_history,
            "iterationsOnPooled": pooled_history,
            "linkF1Before": float(result["identityDisjointCrossDepartment"]["f1"]),
            "linkF1After": float(joint_after["f1"]),
            "note": ("INLP is the canonical linear-erasure baseline; nonlinear recovery is known "
                     "and is measured in the battery above"),
        },
        "founderDecision": "pending: the evidence above informs the GRL-versus-INLP decision",
    }


# ---------------------------------------------------------------------------
# Artifact (append-only)
# ---------------------------------------------------------------------------

def write_entry(out: Path, entry: dict, kind: str = "weft-ablations") -> dict:
    artifact = {"kind": kind, "schemaVersion": SCHEMA_VERSION,
                "appendOnly": True, "entries": []}
    if out.exists():
        prior = json.loads(out.read_text(encoding="utf-8"))
        if prior.get("kind") != kind or prior.get("appendOnly") is not True:
            raise AblationArtifactIncompatible(
                f"refusing to overwrite incompatible artifact: {out}")
        artifact["entries"] = prior.get("entries", [])
    digest = hashlib.sha256(
        json.dumps(entry, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    entry = {"runId": digest, **entry}
    artifact["entries"].append(entry)
    payload = json.dumps(artifact, indent=2)
    for word in BANNED:
        if word in payload.lower():
            raise WeftAblationError(f"banned word present in artifact: {word}")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + f".tmp-{os.getpid()}")
    tmp.write_bytes(payload.encode("utf-8"))
    os.replace(tmp, out)
    return artifact


# ---------------------------------------------------------------------------
# Hyperparameters and plan
# ---------------------------------------------------------------------------

def hyperparameters(args, extras: list[str]) -> dict:
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
        "extraWeights": {
            "adversary": args.adversary_weight if "adversary" in extras else 0.0,
            "setConditioning": args.set_weight if "set-conditioning" in extras else 0.0,
            "triangle": args.triangle_weight if "triangle" in extras else 0.0,
            "modality": args.modality_weight if "modality" in extras else 0.0,
        },
        "adversaryLambda": args.adversary_lambda,
        "triangleMargin": args.triangle_margin,
        "themeDim": args.theme_dim,
        "headHidden": args.head_hidden,
        "anchorSetMax": args.anchor_set_max,
        "extrasEnabled": list(extras),
        "architecture": ("MiniLM-L6 encoder + anchor-set pooling + link-logit MLP + "
                         "theme projection + token evidence head"),
    }


def plan(args) -> dict:
    w3 = load_w3(Path(args.specialist))
    pairs = load_pairs(Path(args.train_data))
    baseline = load_baseline(Path(args.baseline), w3)
    snap = w3.find_snapshot(w3.BASE_MODEL)
    base_digest = None
    if snap is not None and w3.weight_path(snap) is not None:
        base_digest = w3.digest_paths(w3.files_without_weights(snap) + [w3.weight_path(snap)])
    train_path = Path(args.train_data)
    receipt_path = train_path.with_name("receipt.json")
    return {
        "kind": "weft-ablations-plan",
        "schemaVersion": SCHEMA_VERSION,
        "ticket": "W4",
        "stages": [{"stage": stage, "extras": extras_for(stage)} for stage in STAGES],
        "seeds": {"run": args.seed},
        "baseline": baseline,
        "baseEncoder": {"modelId": w3.BASE_MODEL, "license": w3.BASE_LICENSE,
                        "digest": base_digest, "localWeights": base_digest is not None},
        "trainingData": {
            "trainPath": str(train_path),
            "trainSha256": w3.sha256_file_lf(train_path),
            "receiptPath": str(receipt_path),
            "receiptSha256": (w3.sha256_file_lf(receipt_path) if receipt_path.is_file() else None),
            "pairCount": len(pairs),
        },
        "hyperparameters": hyperparameters(args, []),
        "deviceRequirement": ("CUDA by default; --device cpu is an explicit recorded "
                              "fixture-scale run"),
        "harness": {"path": w3.display_path(Path(args.harness)),
                    "digest": (w3.sha256_file(Path(args.harness))
                               if Path(args.harness).is_file() else None)},
        "identitySuppression": {
            "wording": "identity-blind",
            "probeBattery": "post-hoc linear and small-MLP classifiers on exported theme embeddings",
            "options": ["in-training gradient-reversal adversary",
                        "post-hoc INLP null-space projection"],
            "caveat": ("Elazar & Goldberg (2018): a post-hoc classifier can still recover the "
                       "attribute when an in-training adversary reaches chance."),
        },
    }


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def run(args) -> dict:
    try:
        import numpy  # noqa: F401
        import torch
    except ModuleNotFoundError as exc:
        # A missing dependency is the same absent runtime as a missing GPU, so the
        # fail-closed typed message stays stable across environments (issue #58).
        raise AblationRuntimeUnavailable(
            "CUDA runtime absent: required dependency "
            f"{exc.name} is not installed; use --device cpu only for an explicit "
            "recorded fixture-scale run.") from exc
    except Exception as exc:  # noqa: BLE001
        raise AblationRuntimeUnavailable(
            f"torch unavailable: {type(exc).__name__}: {exc}") from exc

    if args.device == "cuda" and not torch.cuda.is_available():
        raise AblationRuntimeUnavailable(
            "CUDA runtime absent; use --device cpu only for an explicit fixture-scale run.")
    if args.device == "auto":
        if not torch.cuda.is_available():
            raise AblationRuntimeUnavailable(
                "no CUDA device available; run on the Kaggle 2x T4 recipe, or pass "
                "--device cpu for an explicit recorded fixture-scale run")
        args.device = "cuda"
    device = torch.device(args.device)

    try:
        import transformers
    except ModuleNotFoundError as exc:
        raise AblationRuntimeUnavailable(
            "CUDA runtime absent: required dependency "
            f"{exc.name} is not installed; use --device cpu only for an explicit "
            "recorded fixture-scale run.") from exc
    except Exception as exc:  # noqa: BLE001
        raise AblationRuntimeUnavailable(
            f"transformers unavailable: {type(exc).__name__}: {exc}") from exc

    w3 = load_w3(Path(args.specialist))
    train_path = Path(args.train_data)
    receipt_path = train_path.with_name("receipt.json")
    pairs = load_pairs(train_path)
    if args.batch_size > len(pairs):
        args.batch_size = len(pairs)
    snap, base_digest = w3.require_base_snapshot()
    harness = w3.load_harness(Path(args.harness))
    baseline = load_baseline(Path(args.baseline), w3)
    sets_by_theme = build_anchor_sets(pairs, args.anchor_set_max)
    estate = harness.build_synthetic_estate(args.seed, False)
    require_comparable(baseline, Path(args.harness), estate, w3)

    w3.seed_everything(args.seed)
    from transformers import AutoModel, AutoTokenizer
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        tokenizer = AutoTokenizer.from_pretrained(str(snap), local_files_only=True)
    except Exception as exc:  # noqa: BLE001
        raise AblationRuntimeUnavailable(f"could not load the tokenizer: {exc}") from exc

    environment = {
        "device": device.type,
        "cudaAvailable": bool(torch.cuda.is_available()),
        "cudaVersion": torch.version.cuda,
        "gpuCount": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "gpuNames": ([torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
                     if torch.cuda.is_available() else []),
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "kaggle": bool(os.environ.get("KAGGLE_KERNEL_RUN_TYPE")),
        "computeDisclosure": (
            f"CPU fixture-scale run on {len(pairs)} W2 pairs and the W1 synthetic estate; "
            "not the Kaggle 2x T4 recipe"
            if device.type == "cpu" else
            f"GPU run on {torch.cuda.device_count()} x {torch.cuda.get_device_name(0)}"),
    }

    written = None
    summaries = []
    for stage in stages_for(args.stage):
        extras = extras_for(stage)
        w3.seed_everything(args.seed)
        try:
            base = AutoModel.from_pretrained(str(snap), local_files_only=True)
        except Exception as exc:  # noqa: BLE001
            raise AblationRuntimeUnavailable(f"could not load base weights: {exc}") from exc
        model = build_ablation_model(w3, base, args.theme_dim, args.head_hidden, extras).to(device)
        parameter_count = sum(p.numel() for p in model.parameters())

        if not extras:
            history, wall = w3.train(model, tokenizer, pairs, args, device)
        else:
            history, wall = train_stage(
                model, tokenizer, pairs, args, device, extras, sets_by_theme, w3)

        evaluation, enc, docs, eval_pairs, scores = evaluate_stage(
            model, tokenizer, harness, w3, args, device, estate)

        labels, classes = identity_labels(docs, harness)
        battery = probe_battery(enc["theme"], labels, args.seed)
        battery["classes"] = classes
        evidence = identity_suppression_evidence(
            model, enc["theme"], enc["pooled"], labels, harness, w3, docs, eval_pairs,
            scores, evaluation, battery, args, device, extras, history)

        stage_f1 = float(evaluation["identityDisjointCrossDepartment"]["f1"])
        delta = stage_f1 - baseline["f1"]
        entry = {
            "ticket": "W4",
            "status": "ran",
            "stage": stage,
            "extras": list(extras),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "seeds": {"python": args.seed, "numpy": args.seed, "torch": args.seed,
                      "evaluation": args.seed, "resampleSeed": args.seed,
                      "probe": args.seed},
            "baseEncoder": {
                "modelId": w3.BASE_MODEL,
                "digest": base_digest,
                "license": w3.BASE_LICENSE,
                "licenseVerifiedFrom": "results/weft-baselines.json entry 2 (W1)",
                "parameterCount": parameter_count,
                "initialization": "fine-tuned from local open-encoder weights, never from scratch",
            },
            "trainingData": {
                "trainPath": w3.display_path(train_path),
                "trainSha256": w3.sha256_file_lf(train_path),
                "trainRawSha256": w3.sha256_file(train_path),
                "receiptPath": w3.display_path(receipt_path),
                "receiptSha256": (w3.sha256_file_lf(receipt_path)
                                  if receipt_path.is_file() else None),
                "lineEndings": "LF-normalized digest (matches the W2 receipt on a CRLF checkout)",
                "pairCount": len(pairs),
                "scale": "fixture",
                "licenceTrace": {
                    "usedSources": {"synthetic-estate": "green"},
                    "teacher": "not used for fixture pairs",
                    "baseEncoder": w3.BASE_LICENSE,
                },
            },
            "hyperparameters": hyperparameters(args, extras),
            "environment": environment,
            "training": {"epochsRun": len(history), "lossHistory": history,
                         "wallSeconds": wall, "parameters": parameter_count},
            "evaluation": {
                "harness": {
                    "path": w3.display_path(Path(args.harness)),
                    "scriptDigest": w3.sha256_file(Path(args.harness)),
                    "estateVersion": evaluation["estate"]["version"],
                    "estateSeed": evaluation["estate"]["seed"],
                    "estateSha256": evaluation["estate"]["estateSha256"],
                    "documents": len(docs),
                    "pairs": len(eval_pairs),
                    "thresholdSelection": ("in-sample max-F1 sweep on the evaluation pairs "
                                           "(disclosed, same as W1)"),
                },
                "specialist": evaluation,
                "deltaVsW3Bare": {
                    "baseline": baseline,
                    "stageF1": stage_f1,
                    "delta": delta,
                    "metric": "identity_disjoint_cross_department_pairwise_f1",
                    "status": ("positive" if delta > 0 else ("zero" if delta == 0 else "negative")),
                    "note": "honest delta versus the W3 bare specialist; negative results are recorded, never overwritten",
                },
            },
            "probeBattery": battery,
            "identitySuppression": evidence,
            "notes": [
                "One extra per stage; the bare stage reproduces the W3 bare specialist under identical seeds.",
                "Deltas are versus the W3 bare specialist on the same W1 harness estate and threshold sweep.",
                "Set-conditioning builds up to four same-theme anchors per training item; W1 evaluation pairs remain single-document.",
                "The INLP projection is fitted on the evaluation estate's identity labels; link labels are never used.",
                "Fixture-scale compute is disclosed in environment.computeDisclosure.",
                "Identity is described as identity-blind; the post-hoc battery reports residual leakage honestly.",
            ],
        }
        written = write_entry(Path(args.out), entry)
        summaries.append({"stage": stage, "delta": delta, "stageF1": stage_f1,
                          "entries": len(written["entries"])})
        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()

    return {"out": args.out, "entries": len(written["entries"]) if written else 0,
            "stages": summaries}


def append_probe(out: Path) -> dict:
    """Append one inert entry: exercises the real append-only writer without training."""
    entry = {"ticket": "W4", "status": "probe", "stage": "append-probe",
             "createdAt": datetime.now(timezone.utc).isoformat()}
    artifact = write_entry(out, entry)
    return {"kind": artifact["kind"], "entries": len(artifact["entries"])}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Weft ablative extras (W4)")
    parser.add_argument("--mode", choices=["train", "plan", "append-probe"], default="train")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--stage", choices=list(STAGES) + ["all"], default="all",
                        help="one stage, or 'all' to train every one-extra-at-a-time stage")
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
    parser.add_argument("--anchor-set-max", type=int, default=4)
    parser.add_argument("--adversary-weight", type=float, default=0.1)
    parser.add_argument("--adversary-lambda", type=float, default=1.0)
    parser.add_argument("--set-weight", type=float, default=0.1)
    parser.add_argument("--triangle-weight", type=float, default=0.1)
    parser.add_argument("--triangle-margin", type=float, default=0.1)
    parser.add_argument("--modality-weight", type=float, default=0.1)
    parser.add_argument("--resamples", type=int, default=50)
    parser.add_argument("--train-data", default=str(DEFAULT_TRAIN))
    parser.add_argument("--specialist", default=str(DEFAULT_SPECIALIST))
    parser.add_argument("--harness", default=str(DEFAULT_HARNESS))
    parser.add_argument("--baseline", default=str(DEFAULT_BASELINE))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args(argv)

    try:
        if args.mode == "plan":
            print(json.dumps(plan(args), indent=2))
            return 0
        if args.mode == "append-probe":
            print(json.dumps(append_probe(Path(args.out))))
            return 0
        print(json.dumps(run(args)))
        return 0
    except WeftAblationError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
