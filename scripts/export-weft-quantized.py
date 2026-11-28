#!/usr/bin/env python3
"""Weft quantized export, conformal abstain, OOD tripwire (ticket W5).

Builds the quantization-aware export of the W4-v4 frozen-base specialist
(all-MiniLM-L6-v2 + link/evidence/theme heads). For each bit width in {2, 3, 4}
the frozen base weights get per-channel b-bit fake quantization (torchao intx
weight-only when importable, else an in-script deterministic round-to-nearest
with the straight-through form), the heads retrain under the fake-quant base
on the v4 pairs through the canonical trainer's loss (link BCE + 0.5 CrossCLR
+ 0.2 evidence KL, AdamW heads-only, lr_base 0.0, grad clip 1.0), and the
level is evaluated with the symmetric link score and the max-F1 threshold
sweep, plus the identity-masked rows when given. The kNN OOD tripwire embeds
the v4 train texts with the fp32 base (never the fake-quant weights),
compresses with seeded k-means to int8 centroids plus per-centroid float
scales, and calibrates a cosine-similarity threshold so a target fraction of
the eval in-coverage docs pass; a document below it is out of coverage, which
routes to abstain or human review, never to a similarity path.

Conformal abstention is the prior-art Learn-Then-Test rule: the eval pairs
split into calibration and test halves, thresholds sweep the calibration
half, the highest-coverage threshold where binomCdf(k, n_cal, alpha) <= delta
certifies, and the certified threshold is scored on the test half (coverage,
false-merge rate). When no threshold certifies it fails closed to threshold
null and coverage 0, mirroring the W1 shootout's abstain_at_alpha. binomCdf
is implemented in-script by stable recursive pmf summation (no scipy).

Runtime levels. onnxruntime executes int8 dynamic quantization (the measured
reference upper bound, exported once from the fp32 state) and 4-bit
MatMulNBits, so those two levels ship ONNX artifacts. No onnxruntime kernel
executes 2- or 3-bit, so those levels are ablated for quality only and their
rows say "no runtime executes this bit width". The 4-bit artifact carries the
tokenizer JSON, the int8 OOD bank, and the OOD threshold in onnx
metadata_props, so the single .onnx file is enough for the fail-closed
runtime. The exported graph is base encoder + heads with pre-tokenized ids
for an anchor and a candidate (tokenization happens outside the graph).

Fail-closed contract, mirroring train-weft-specialist.py: typed errors with
exit 2 and a JSON {error, detail, kind} stderr line; a failed run never
appends to or alters a ledger, and never falls back to an un-quantized path
or a similarity path. Plan mode and notebook emission run without importing
torch at all (heavy imports are function-local) so CI can exercise them.

Artifact: results/weft-export-latency.json (append-only ledger, kind
weft-export-latency, schemaVersion 1), one entry per bit width per run plus
the int8 reference entry, and one entry per measured artifact in measure
mode. Every number written is measured on the run box or null.

Usage:
  python scripts/export-weft-quantized.py --mode plan
  python scripts/export-weft-quantized.py --device cuda \
    --bit-widths 2,3,4 --epochs 3 --head-lr 1e-3 --seed 20261127
  python scripts/export-weft-quantized.py --dry-run
  python scripts/export-weft-quantized.py --emit-kaggle-notebook
  python scripts/export-weft-quantized.py --measure-artifact <exported>.onnx
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.util
import json
import math
import os
import platform
import random
import struct
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
KIND = "weft-export-latency"
PLAN_KIND = "weft-export-plan"
ERROR_KIND = "weft-export-error"
TICKET = "W5"
TICKET_DRY_RUN = "W5-dry-run"
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BASE_LICENSE = "Apache-2.0"
DEFAULT_SEED = 20261127
SUPPORTED_BITS = (2, 3, 4)
ONNX_LEVELS = {4: "int4-matmulnbits", 8: "int8-dynamic"}
H5_CAP_BYTES = 30 * 1024 * 1024  # the H5 artifact ceiling every entry records against
QUALITY_ONLY_NOTE = "no runtime executes this bit width; quality-only row"
OOD_K = 1024
OOD_K_DRY_RUN = 16
OOD_PASS_TARGET = 0.95
TRAINER = Path(__file__).resolve().parent / "train-weft-specialist.py"
BANNED = ("mathematically" + " grounded", "elimin" + "ates", "fir" + "st")
ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Typed fail-closed errors
# ---------------------------------------------------------------------------

class WeftExportError(Exception):
    code = "WEFT_EXPORT_ERROR"

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class WeightsMissing(WeftExportError):
    code = "WEFT_WEIGHTS_MISSING"


class ExportDataMissing(WeftExportError):
    code = "WEFT_EXPORT_DATA_MISSING"


class QuantUnsupported(WeftExportError):
    code = "WEFT_QUANT_UNSUPPORTED"


class OnnxRuntimeMissing(WeftExportError):
    code = "WEFT_ONNX_RUNTIME_MISSING"


class LedgerIncompatible(WeftExportError):
    code = "WEFT_LEDGER_INCOMPATIBLE"


class TrainingRuntimeMissing(WeftExportError):
    # Outside the W5 sanctioned set; the fail-closed contract still needs a
    # typed name for an absent CUDA/torch runtime (never a silent fallback).
    code = "WEFT_TRAINING_RUNTIME_MISSING"


class ArtifactDigestMismatch(WeftExportError):
    # Outside the W5 sanctioned set; measure mode refuses to measure an
    # artifact no ledger entry records, so an unattributed or altered file can
    # never contribute numbers.
    code = "WEFT_ARTIFACT_DIGEST_MISMATCH"


# ---------------------------------------------------------------------------
# Module loading and digests
# ---------------------------------------------------------------------------

def load_module(name: str, path: Path):
    if not path.is_file():
        raise WeftExportError(f"required script absent: {path}")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
    """LF-normalized digest so a CRLF checkout agrees with the W2 receipt pins."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def display_path(path) -> str:
    try:
        return str(Path(path).relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def count_rows(path: Path) -> int:
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())


def check_ledger(out: Path) -> None:
    """Refuse an incompatible ledger before any heavy work or any write."""
    if out.exists():
        try:
            prior = json.loads(out.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise LedgerIncompatible(f"ledger is not readable JSON: {out}: {exc}") from exc
        if prior.get("kind") != KIND or prior.get("appendOnly") is not True:
            raise LedgerIncompatible(
                f"refusing to append to an incompatible ledger "
                f"(kind={prior.get('kind')!r}, appendOnly={prior.get('appendOnly')!r}): {out}")


def write_entry(out: Path, entry: dict) -> dict:
    artifact = {"kind": KIND, "schemaVersion": SCHEMA_VERSION, "appendOnly": True, "entries": []}
    if out.exists():
        prior = json.loads(out.read_text(encoding="utf-8"))
        if prior.get("kind") != artifact["kind"] or prior.get("appendOnly") is not True:
            raise LedgerIncompatible(f"refusing to overwrite an incompatible ledger: {out}")
        artifact["entries"] = prior.get("entries", [])
    digest = hashlib.sha256(
        json.dumps(entry, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    entry = {"runId": digest, **entry}
    artifact["entries"].append(entry)
    payload = json.dumps(artifact, indent=2)
    for word in BANNED:
        if word in payload.lower():
            raise WeftExportError(f"banned word present in ledger: {word}")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + f".tmp-{os.getpid()}")
    tmp.write_bytes(payload.encode("utf-8"))
    os.replace(tmp, out)
    return artifact


# ---------------------------------------------------------------------------
# binomial CDF (recursive pmf summation with complement symmetry; no scipy)
# ---------------------------------------------------------------------------

def _pmf_at_zero(n: int, p: float) -> float:
    return math.exp(n * math.log1p(-p))


def _upper_tail(j: int, n: int, p: float) -> float:
    """P(X >= j) for X ~ Binomial(n, p), summed downward from the i = n pmf."""
    if j <= 0:
        return 1.0
    if j > n:
        return 0.0
    term = math.exp(n * math.log(p))
    total = term
    for i in range(n, j, -1):
        term *= (1.0 - p) / p * (i / (n - i + 1))
        total += term
    return total


def binom_cdf(k: int, n: int, p: float) -> float:
    """P(X <= k) for X ~ Binomial(n, p). The upper tail carries the symmetry so
    large k stays stable."""
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    if p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 0.0
    if p > 0.5:
        return 1.0 - _upper_tail(k + 1, n, p)
    term = _pmf_at_zero(n, p)
    total = term
    for i in range(k):
        term *= p / (1.0 - p) * ((n - i) / (i + 1))
        total += term
        if term == 0.0:
            break
    return min(1.0, total)


# ---------------------------------------------------------------------------
# Max-F1 threshold sweep (same convention as the W1 harness / gate script)
# ---------------------------------------------------------------------------

def sweep(rows: list[dict], scores: list[float]) -> dict:
    order = sorted(range(len(scores)), key=lambda k: (-scores[k], k))
    y = [1.0 if r["label"] == "positive" else 0.0 for r in rows]
    truth_pos = sum(y)
    tp = fp = 0
    best = {"f1": 0.0, "precision": 0.0, "recall": 0.0, "threshold": 0.0}
    idx = 0
    while idx < len(order):
        t = scores[order[idx]]
        while idx < len(order) and scores[order[idx]] == t:
            k = order[idx]
            if y[k] > 0.5:
                tp += 1
            else:
                fp += 1
            idx += 1
        pred_pos = tp + fp
        fn = truth_pos - tp
        precision = tp / pred_pos if pred_pos else 0.0
        recall = tp / truth_pos if truth_pos else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        if f1 > best["f1"]:
            best = {"f1": f1, "precision": precision, "recall": recall, "threshold": float(t)}
    return best


def quality_block(rows: list[dict], scores: list[float]) -> dict:
    best = sweep(rows, scores)
    return {"threshold": best["threshold"], "precision": best["precision"],
            "recall": best["recall"], "f1": best["f1"], "pairCount": len(rows)}


# ---------------------------------------------------------------------------
# Learn-Then-Test conformal abstain (prior art, fail closed)
# ---------------------------------------------------------------------------

def conformal_ltt(rows: list[dict], scores: list[float], alphas: list[float],
                  calib_frac: float, delta: float, seed: int) -> list[dict]:
    """Split eval, sweep calibration thresholds, certify with
    binomCdf(k, n_cal, alpha) <= delta at the highest coverage, score the test
    half. No certifying threshold: threshold null, coverage 0 (fail closed)."""
    rng = random.Random(seed)
    order = list(range(len(rows)))
    rng.shuffle(order)
    cut = max(1, min(len(rows) - 1, int(round(len(rows) * calib_frac))))
    cal = [(rows[i], scores[i]) for i in order[:cut]]
    test = [(rows[i], scores[i]) for i in order[cut:]]
    n_cal = len(cal)
    out = []
    for alpha in alphas:
        certified = {"alpha": alpha, "certified": False, "threshold": None,
                     "coverage": 0.0, "falseMergeRate": 0.0}
        best = dict(certified, calCoverage=0.0)
        tp = fp = 0
        idx = 0
        while idx < n_cal:
            t = cal[idx][1]
            while idx < n_cal and cal[idx][1] == t:
                if cal[idx][0]["label"] == "positive":
                    tp += 1
                else:
                    fp += 1
                idx += 1
            coverage = (tp + fp) / n_cal
            if coverage <= best["calCoverage"]:
                continue
            if binom_cdf(fp, n_cal, alpha) <= delta:
                ttp = sum(1 for r, s in test if s >= t and r["label"] == "positive")
                tfp = sum(1 for r, s in test if s >= t and r["label"] != "positive")
                best = dict(certified, certified=True, threshold=float(t),
                            calCoverage=coverage,
                            coverage=(ttp + tfp) / len(test) if test else 0.0,
                            falseMergeRate=tfp / (ttp + tfp) if (ttp + tfp) else 0.0)
        best.pop("calCoverage", None)
        out.append(best)
    return out


# ---------------------------------------------------------------------------
# kNN OOD tripwire (fp32 reference embeddings, seeded k-means, int8 centroids)
# ---------------------------------------------------------------------------

def raw_mean_pool(base, tokenizer, texts, device, max_length, batch_size=64):
    import torch
    out = []
    base.eval()
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch = texts[start:start + batch_size]
            enc = tokenizer(batch, padding=True, truncation=True, max_length=max_length,
                            return_tensors="pt")
            mask = enc["attention_mask"].to(device)
            ids = {k: v.to(device) for k, v in enc.items()}
            h = base(**ids).last_hidden_state
            pooled = (h * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True).clamp_min(1)
            out.append(torch.nn.functional.normalize(pooled, dim=-1).cpu())
    if not out:
        return None
    return torch.cat(out).numpy().astype("float32")


def kmeans_seeded(vectors, k: int, seed: int, iters: int = 20):
    """Deterministic Lloyd k-means: seeded init, numpy only."""
    import numpy as np
    rng = np.random.default_rng(seed)
    n = len(vectors)
    k = max(1, min(k, n))
    centers = vectors[rng.choice(n, size=k, replace=False)].copy()
    for _ in range(iters):
        assign = (vectors @ centers.T).argmax(axis=1)
        counts = np.bincount(assign, minlength=k)
        new = centers.copy()
        np.add.at(new, assign, vectors)
        nonzero = counts > 0
        new[nonzero] /= counts[nonzero, None]
        if np.allclose(new[nonzero], centers[nonzero], atol=1e-6):
            centers = new
            break
        centers = new
    centers = np.nan_to_num(centers)
    return centers / np.clip(np.linalg.norm(centers, axis=1, keepdims=True), 1e-12, None)


def pack_ood_bank(centers) -> bytes:
    """b'WOOD' + k (uint32) + dim (uint32) + k*dim int8 + k float32 scales."""
    import numpy as np
    scales = np.abs(centers).max(axis=1)
    scales[scales == 0] = 1.0
    q = np.clip(np.rint(centers / scales[:, None]), -127, 127).astype("i1")
    header = struct.pack("<4sII", b"WOOD", len(centers), centers.shape[1])
    return header + q.tobytes() + scales.astype("<f4").tobytes()


def bank_k(blob: bytes) -> int:
    return struct.unpack("<4sII", blob[:12])[1]


def tripwire_scores(doc_vectors, centers):
    import numpy as np
    return np.asarray(doc_vectors @ centers.T, dtype="float32")


def ood_threshold_from_eval(scores, target: float) -> float:
    """Lowest quantile that keeps that fraction of in-coverage docs passing
    (a doc passes when its similarity to the bank is at or above it)."""
    import numpy as np
    ordered = np.sort(np.asarray(scores, dtype="float64").ravel())
    idx = min(len(ordered) - 1, int(math.floor((1.0 - target) * len(ordered))))
    return float(ordered[idx]) if len(ordered) else 0.0


# ---------------------------------------------------------------------------
# Fake quantization of the frozen base
# ---------------------------------------------------------------------------

def fake_quant_base(base, bits: int) -> str:
    """Per-output-channel b-bit fake quantization, materialized into the base
    Linear weights. The base is frozen (W4-v4 learningRateBase 0.0), so one
    deterministic transform is exact for the head retrain; the in-script
    fallback keeps the straight-through form so the same code would track a
    live weight during a step. torchao runs when its sub-8-bit intx
    weight-only config is importable; its packed tensors are dequantized back
    to plain fp32 so the frozen base carries exactly the b-bit rounding."""
    import torch
    from torch import nn
    linears = {name: m for name, m in base.named_modules() if isinstance(m, nn.Linear)}
    original = {name: m.weight.detach().clone() for name, m in linears.items()}
    try:
        from torchao.quantization import IntxWeightOnlyConfig, PerAxis, quantize_
        cfg = IntxWeightOnlyConfig(weight_dtype=getattr(torch, f"int{bits}"),
                                   granularity=PerAxis(0),
                                   intx_packing_format="unpacked_to_int8")
        quantize_(base, cfg, filter_fn=lambda m, fqn: isinstance(m, nn.Linear))
        for module in linears.values():
            module.weight = nn.Parameter(module.weight.dequantize().contiguous())
        return "torchao-intx-weight-only-peraxis-dequantized"
    except Exception:  # noqa: BLE001 - deterministic in-script fallback
        for name, module in linears.items():
            module.weight = nn.Parameter(original[name].detach().clone())
        qmax = 2 ** (bits - 1) - 1
        for name, module in linears.items():
            w = original[name]
            scale = (w.abs().amax(dim=1, keepdim=True) / qmax).clamp_min(1e-12)
            q = torch.clamp(torch.round(w / scale), -qmax, qmax)
            dq = q * scale
            # straight-through form: forward carries the quantized value, gradient
            # flows to w (inert here because the base is frozen and lr_base is 0)
            module.weight = nn.Parameter(w + (dq - w).detach())
        return "in-script-perchannel-symmetric"


# ---------------------------------------------------------------------------
# Torch evaluation helpers
# ---------------------------------------------------------------------------

def unique_texts(pairs: list[dict]):
    texts = sorted({p["anchor"] for p in pairs} | {p["candidate"] for p in pairs})
    return texts, {t: i for i, t in enumerate(texts)}


def encode_all(model, tokenizer, texts, device, max_length, batch_size=64):
    import torch
    pooled = []
    model.eval()
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            enc = model.encode(tokenizer, texts[start:start + batch_size], max_length, device)
            pooled.append(enc["pooled"].cpu())
    return torch.cat(pooled)


def symmetric_scores(model, pooled, idx_map, rows, device, chunk=2048):
    import torch
    out = []
    with torch.no_grad():
        for start in range(0, len(rows), chunk):
            batch = rows[start:start + chunk]
            ai = torch.tensor([idx_map[r["anchor"]] for r in batch])
            ci = torch.tensor([idx_map[r["candidate"]] for r in batch])
            fwd = model.link_logits(pooled[ai].to(device), pooled[ci].to(device)).sigmoid()
            bwd = model.link_logits(pooled[ci].to(device), pooled[ai].to(device)).sigmoid()
            out.extend(((fwd + bwd) / 2.0).cpu().tolist())
    return out


def torch_latency(model, tokenizer, eval_texts, eval_rows, device, max_length) -> dict:
    """Doc-encode ms and full-pair-scoring ms on the run box (batched, amortized;
    the full pair forward includes both encodes plus the link head, matching what
    the exported pair graph executes)."""
    import torch
    model.eval()
    if device.type == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.no_grad():
        for start in range(0, len(eval_texts), 64):
            model.encode(tokenizer, eval_texts[start:start + 64], max_length, device)
    if device.type == "cuda":
        torch.cuda.synchronize()
    encode_ms = (time.perf_counter() - t0) * 1000.0 / max(1, len(eval_texts))

    idx = {t: i for i, t in enumerate(eval_texts)}
    del idx
    t1 = time.perf_counter()
    with torch.no_grad():
        for start in range(0, len(eval_rows), 64):
            batch = eval_rows[start:start + 64]
            pa = model.encode(tokenizer, [r["anchor"] for r in batch], max_length, device)["pooled"]
            pb = model.encode(tokenizer, [r["candidate"] for r in batch], max_length, device)["pooled"]
            fwd = model.link_logits(pa, pb).sigmoid()
            bwd = model.link_logits(pb, pa).sigmoid()
            _ = ((fwd + bwd) / 2.0)
    if device.type == "cuda":
        torch.cuda.synchronize()
    pair_ms = (time.perf_counter() - t1) * 1000.0 / max(1, len(eval_rows))
    disclosure = (f"GPU run on {torch.cuda.device_count()} x {torch.cuda.get_device_name(0)}"
                  if device.type == "cuda" else
                  "CPU small-scale run; recorded so the numbers are not read as GPU-scale")
    rss = peak_rss_mb()
    return {"device": device.type, "encodeMsPerDoc": encode_ms,
            "pairScoringMsPerPair": pair_ms, "peakRssMb": rss,
            "peakRssSource": "resource.ru_maxrss" if rss is not None else None,
            "method": ("batched amortized; encodeMsPerDoc is one doc encode, "
                       "pairScoringMsPerPair is the full pair forward (both encodes plus the "
                       "link head), matching the exported pair graph"),
            "computeDisclosure": disclosure}


def peak_rss_mb():
    try:
        import resource
        return float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) / 1024.0
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# ONNX export, graph surgery, quantization, metadata
# ---------------------------------------------------------------------------

def pair_scorer_module(model):
    import torch
    from torch import nn

    class Scorer(nn.Module):
        """The exported graph: base encoder + heads. Inputs are pre-tokenized ids
        (tokenization happens outside the graph) for an anchor and a candidate;
        outputs are the link probability and the theme cosine."""

        def __init__(self):
            super().__init__()
            self.base = model.base
            self.evidence = model.evidence
            self.theme = model.theme
            self.link = model.link

        def enc(self, input_ids, attention_mask):
            h = self.base(input_ids=input_ids,
                          attention_mask=attention_mask).last_hidden_state
            salience = self.evidence(h).squeeze(-1)
            salience = salience.masked_fill(attention_mask == 0, -1e9).softmax(dim=-1)
            pooled = (h * salience.unsqueeze(-1)).sum(dim=1)
            theme = torch.nn.functional.normalize(self.theme(pooled), dim=-1)
            return pooled, theme

        def forward(self, a_ids, a_mask, b_ids, b_mask):
            pa, ta = self.enc(a_ids, a_mask)
            pb, tb = self.enc(b_ids, b_mask)
            feats = torch.cat([pa, pb, pa - pb, pa * pb], dim=-1)
            logit = self.link(feats).squeeze(-1)
            return logit.sigmoid(), (ta * tb).sum(dim=-1)

    return Scorer()


def inline_identity_weights(model_proto) -> int:
    """The MatMulNBits quantizer only converts MatMul weights that are direct
    initializers (its get_initializer does not follow Identity nodes), and
    torch.onnx routes folded FFN weights through Identity chains. Resolve
    those chains so every constant MatMul weight reaches the quantizer."""
    import onnx  # noqa: F401 - the proto helpers are typed against the onnx proto
    g = model_proto.graph
    inits = {i.name for i in g.initializer}
    graph_outputs = {o.name for o in g.output}
    alias: dict[str, str] = {}
    for _ in range(16):
        grew = False
        for node in g.node:
            if node.op_type != "Identity" or not node.input or not node.input[0]:
                continue
            src = alias.get(node.input[0], node.input[0])
            if node.output[0] in alias or node.output[0] in graph_outputs:
                continue
            if src in inits or src in alias:
                alias[node.output[0]] = src
                grew = True
        if not grew:
            break
    rewired = 0
    aliased_identities = []
    for node in g.node:
        if node.op_type == "Identity" and node.output[0] in alias:
            aliased_identities.append(node)
        for j, name in enumerate(node.input):
            if name in alias:
                node.input[j] = alias[name]
                rewired += 1
    for node in aliased_identities:
        g.node.remove(node)
    return rewired


def quantize_word_embeddings(model_proto) -> dict | None:
    """int8 per-row quantization of the largest 2-D fp32 initializer whose only
    consumers are Gather nodes (the token-embedding table; the position table is
    far smaller and stays fp32). Each gathered row dequantizes through a Cast
    plus a per-row-scale Mul, so the runtime never materializes the fp32 table."""
    import numpy as np
    from onnx import TensorProto, helper, numpy_helper
    g = model_proto.graph
    consumers: dict[str, list] = {}
    for node in g.node:
        for name in node.input:
            consumers.setdefault(name, []).append(node)

    def is_table(init) -> bool:
        try:
            arr = numpy_helper.to_array(init)
        except Exception:  # noqa: BLE001
            return False
        return (arr.ndim == 2 and arr.size >= 100_000 and arr.dtype == np.float32
                and consumers.get(init.name)
                and all(n.op_type == "Gather" for n in consumers[init.name]))

    tables = sorted((i for i in g.initializer if is_table(i)),
                    key=lambda i: int(numpy_helper.to_array(i).size), reverse=True)
    if not tables:
        return None
    init = tables[0]
    table = numpy_helper.to_array(init).astype(np.float32)
    rows, cols = table.shape
    scales = np.maximum(np.abs(table).max(axis=1, keepdims=True),
                        1e-12) / np.float32(127.0)
    quantized = np.clip(np.rint(table / scales), -127, 127).astype(np.int8)
    q_name, s_name = init.name + "_int8", init.name + "_rowscale"
    g.initializer.remove(init)
    g.initializer.append(numpy_helper.from_array(quantized, q_name))
    g.initializer.append(numpy_helper.from_array(scales.astype(np.float32), s_name))
    rewritten = []
    for node in list(g.node):
        if node.op_type == "Gather" and node.input[0] == init.name:
            out = node.output[0]
            node.input[0] = q_name
            node.output[0] = out + "_q8"
            scale_gather = helper.make_node(
                "Gather", [s_name, node.input[1]], [out + "_rs"],
                name=node.name + "_rs")
            to_float = helper.make_node("Cast", [out + "_q8"], [out + "_cf"],
                                        to=TensorProto.FLOAT, name=node.name + "_cf")
            dequant = helper.make_node("Mul", [out + "_cf", out + "_rs"], [out],
                                       name=node.name + "_deq")
            rewritten.extend([node, scale_gather, to_float, dequant])
        else:
            rewritten.append(node)
    g.ClearField("node")
    g.node.extend(rewritten)
    return {"initializer": init.name, "rows": rows, "cols": cols,
            "scalesPerRow": rows, "int8Bytes": quantized.size,
            "scalesBytes": scales.size * 4}


def size_ceiling(size_bytes) -> dict:
    """The H5 per-artifact ceiling recorded honestly for every recorded level."""
    return {"sizeCapBytes": H5_CAP_BYTES,
            "withinCap": None if size_bytes is None else bool(size_bytes <= H5_CAP_BYTES)}


# ---------------------------------------------------------------------------
def gemm_to_matmul(model_proto):
    """Rewrite every Gemm into MatMul (+ Add) with a pre-transposed weight.
    onnxruntime's dynamic quantizer mishandles Gemm + transB (MatMulInteger
    dimension mismatch), so the graph carries MatMul nodes before quantization."""
    import numpy as np
    from onnx import helper, numpy_helper
    g = model_proto.graph
    inits = {i.name: i for i in g.initializer}
    new_nodes, new_inits = [], []
    for node in [n for n in g.node if n.op_type == "Gemm"]:
        attrs = {a.name: a for a in node.attribute}
        alpha = np.float32(attrs["alpha"].f if "alpha" in attrs else 1.0)
        beta = np.float32(attrs["beta"].f if "beta" in attrs else 1.0)
        trans_b = int(attrs["transB"].i) if "transB" in attrs else 0
        wt = numpy_helper.to_array(inits[node.input[1]]).astype(np.float32)
        wt2 = np.ascontiguousarray((wt.T if trans_b else wt) * alpha)
        wname = node.input[1] + "_t"
        new_inits.append(numpy_helper.from_array(wt2, wname))
        matmul = helper.make_node("MatMul", [node.input[0], wname],
                                  [node.output[0] + "_mm"], name=node.name + "_mm")
        if len(node.input) > 2 and node.input[2]:
            b = numpy_helper.to_array(inits[node.input[2]]).astype(np.float32) * beta
            bname = node.input[2] + "_mm"
            new_inits.append(numpy_helper.from_array(b, bname))
            new_nodes.extend([matmul, helper.make_node(
                "Add", [node.output[0] + "_mm", bname], list(node.output),
                name=node.name + "_add")])
        else:
            new_nodes.append(helper.make_node(
                "MatMul", [node.input[0], wname], list(node.output), name=node.name))
    for n in list(g.node):
        if n.op_type == "Gemm":
            g.node.remove(n)
    for n in new_nodes:
        g.node.append(n)
    g.initializer.extend(new_inits)
    import onnx
    return onnx.shape_inference.infer_shapes(model_proto)


def export_level(model, sample_ids, out_path: Path, level: str, tokenizer_bytes,
                 ood_blob, ood_threshold, manifest, common, max_rows) -> dict:
    """Export the pair graph, quantize, and (int4 level) embed the metadata.
    The int4 level also measures the 200-pair in-sample quality before and
    after the token-embedding int8 step, so the F1 delta is recorded."""
    import torch
    try:
        import onnx
        import onnxruntime
        from onnxruntime.quantization import QuantType, quantize_dynamic
    except Exception as exc:  # noqa: BLE001
        raise OnnxRuntimeMissing(f"onnx/onnxruntime unavailable: {type(exc).__name__}: {exc}") from exc
    ids_a, mask_a, ids_b, mask_b = sample_ids
    wrapper = pair_scorer_module(model).eval()
    torch.onnx.export(
        wrapper, (ids_a, mask_a, ids_b, mask_b), str(out_path), dynamo=False,
        input_names=["inputIdsA", "attentionMaskA", "inputIdsB", "attentionMaskB"],
        output_names=["linkProb", "themeSim"],
        dynamic_axes={**{name: {0: "batchA", 1: "lenA"} for name in
                         ["inputIdsA", "attentionMaskA"]},
                      **{name: {0: "batchB", 1: "lenB"} for name in
                         ["inputIdsB", "attentionMaskB"]},
                      **{name: {0: "batch"} for name in ["linkProb", "themeSim"]}},
        opset_version=17, do_constant_folding=True)
    fp_path = out_path.with_name(out_path.stem + "-fp32.onnx")
    proto = gemm_to_matmul(onnx.load(str(out_path)))
    inline_identity_weights(proto)
    onnx.save(proto, str(fp_path))
    embedding_report = None
    if level == "int8-dynamic":
        quantize_dynamic(str(fp_path), str(out_path), weight_type=QuantType.QInt8,
                         per_channel=True,
                         extra_options={"DefaultTensorType": onnx.TensorProto.FLOAT})
    else:
        try:
            from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
        except Exception as exc:  # noqa: BLE001
            fp_path.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
            raise OnnxRuntimeMissing(
                f"MatMulNBits unavailable in this onnxruntime: {type(exc).__name__}: {exc}") from exc
        # quality of the same int4 graph with the embedding table still fp32:
        # the delta isolates the embedding int8 step
        tmp_dir = Path(tempfile.mkdtemp(prefix="weft-emb-before-"))
        before_path = tmp_dir / "before.onnx"
        quant_b = MatMulNBitsQuantizer(onnx.load(str(fp_path)), bits=4,
                                       block_size=128, is_symmetric=True)
        quant_b.process()
        onnx.save(quant_b.model.model, str(before_path))
        before_q = measure_onnx(before_path, common["eval_rows"], max_rows,
                                onnxruntime, common["tokenizer"])["quality"]
        before_path.unlink(missing_ok=True)
        tmp_dir.rmdir()
        report = quantize_word_embeddings(proto)
        if report is not None:
            proto = onnx.shape_inference.infer_shapes(proto)
            onnx.save(proto, str(fp_path))
        else:
            onnx.save(proto, str(fp_path))
        quant = MatMulNBitsQuantizer(onnx.load(str(fp_path)), bits=4, block_size=128,
                                     is_symmetric=True)
        quant.process()
        onnx.save(quant.model.model, str(out_path))
        after_q = measure_onnx(out_path, common["eval_rows"], max_rows,
                               onnxruntime, common["tokenizer"])["quality"]
        if report is not None and before_q and after_q:
            embedding_report = {
                "implementation": "int8 per-row scale; each gathered row "
                                  "dequantizes through a Cast plus a scale Mul",
                "beforeF1": before_q["f1"], "afterF1": after_q["f1"],
                "deltaF1": after_q["f1"] - before_q["f1"],
                "pairCount": after_q["pairCount"], **report}
    proto = onnx.load(str(out_path))
    if level == "int4-matmulnbits":
        for key, value in (("tokenizer", base64.b64encode(tokenizer_bytes).decode("ascii")),
                           ("ood_bank", base64.b64encode(ood_blob).decode("ascii")),
                           ("ood_threshold", json.dumps(ood_threshold)),
                           ("manifest", json.dumps(manifest, sort_keys=True))):
            entry = proto.metadata_props.add()
            entry.key, entry.value = key, value
        onnx.save(proto, str(out_path))
    from collections import Counter
    ops = Counter(n.op_type for n in proto.graph.node)
    op_counts = {"matmulNBits": ops.get("MatMulNBits", 0),
                 "matmulInteger": ops.get("MatMulInteger", 0),
                 "matmul": ops.get("MatMul", 0), "gather": ops.get("Gather", 0),
                 "dequantizeLinear": ops.get("DequantizeLinear", 0)}
    fp_path.unlink(missing_ok=True)
    size = out_path.stat().st_size
    out = {"path": display_path(out_path), "bytes": size,
           "sha256": sha256_file(out_path), "quantized": True, "level": level,
           "qualityOnly": False, "opCounts": op_counts, **size_ceiling(size)}
    if embedding_report is not None:
        out["embedding"] = embedding_report
    return out


def read_metadata(path) -> dict:
    try:
        import onnx
    except Exception as exc:  # noqa: BLE001
        raise OnnxRuntimeMissing(f"onnx unavailable: {type(exc).__name__}: {exc}") from exc
    proto = onnx.load(str(path))
    out = {}
    for prop in proto.metadata_props:
        if prop.key == "manifest":
            out["manifest"] = json.loads(prop.value)
        elif prop.key == "tokenizer":
            out["tokenizer"] = base64.b64decode(prop.value)
        elif prop.key == "ood_bank":
            out["ood_bank"] = base64.b64decode(prop.value)
        elif prop.key == "ood_threshold":
            out["ood_threshold"] = json.loads(prop.value)
    return out


def measure_onnx(path, rows: list[dict], max_rows, ort, tokenizer,
                 max_length=128, chunk=8) -> dict:
    """Latency and (in-sample) quality of an exported pair graph on a clean
    onnxruntime CPU session."""
    sample = rows[:max_rows]
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    import tracemalloc
    tracemalloc.start()
    rss = peak_rss_mb()
    t0 = time.perf_counter()
    labels, scores = [], []
    for start in range(0, len(sample), chunk):
        batch = sample[start:start + chunk]
        enc_a = tokenizer([r["anchor"] for r in batch], padding=True, truncation=True,
                          max_length=max_length, return_tensors="np")
        enc_b = tokenizer([r["candidate"] for r in batch], padding=True, truncation=True,
                          max_length=max_length, return_tensors="np")
        feed = {"inputIdsA": enc_a["input_ids"].astype("int64"),
                "attentionMaskA": enc_a["attention_mask"].astype("int64"),
                "inputIdsB": enc_b["input_ids"].astype("int64"),
                "attentionMaskB": enc_b["attention_mask"].astype("int64")}
        link, _ = sess.run(None, feed)
        scores.extend(float(v) for v in link)
        labels.extend(r["label"] for r in batch)
    wall = (time.perf_counter() - t0) * 1000.0
    peak = tracemalloc.get_traced_memory()[1] / (1024.0 * 1024.0)
    tracemalloc.stop()
    pair_ms = wall / max(1, len(sample))
    return {"encodeMsPerDoc": pair_ms / 2.0,  # the graph encodes both docs per pair
            "pairScoringMsPerPair": pair_ms,
            "peakRssMb": rss if rss is not None else peak,
            "peakRssSource": "resource.ru_maxrss" if rss is not None else "tracemalloc.peak",
            "samplePairs": len(sample),
            "quality": quality_block([{"label": x} for x in labels], scores) if sample else None}


# ---------------------------------------------------------------------------
# Artifact manifest
# ---------------------------------------------------------------------------

def artifact_manifest(args, bit_width, model_pt_digest, tokenizer_digest,
                      train_digest, eval_digest, ood_blob_sha, conformal) -> dict:
    return {
        "kind": "weft-specialist-quantized",
        "ticket": TICKET,
        "quantized": True,
        "bitWidth": bit_width,
        "artifactLevel": ONNX_LEVELS.get(bit_width),
        "seeds": {"run": args.seed, "conformalSplit": args.seed, "kmeans": args.seed},
        "headLr": args.head_lr,
        "epochs": args.epochs,
        "baseEncoder": {"modelId": BASE_MODEL, "license": BASE_LICENSE,
                        "digest": model_pt_digest},
        "conformalDelta": args.delta,
        "conformalAlphas": args.alphas,
        "conformal": conformal,
        "sha256": {"modelPt": model_pt_digest, "tokenizer": tokenizer_digest,
                   "trainJsonl": train_digest, "evalJsonl": eval_digest,
                   "oodBank": ood_blob_sha},
    }


# ---------------------------------------------------------------------------
# Modes: plan and notebook (no torch import anywhere on these paths)
# ---------------------------------------------------------------------------

def weights_present(model_dir: Path) -> bool:
    return (model_dir / "model.pt").is_file() and \
        (model_dir / "tokenizer" / "tokenizer.json").is_file() and \
        (model_dir / "tokenizer" / "tokenizer_config.json").is_file()


def parse_bit_widths(text: str) -> list[int]:
    try:
        widths = [int(part) for part in str(text).split(",") if part.strip()]
    except ValueError as exc:
        raise QuantUnsupported(f"bit widths are not integers: {text}") from exc
    if not widths:
        raise QuantUnsupported("bit widths empty")
    bad = [w for w in widths if w not in SUPPORTED_BITS]
    if bad:
        raise QuantUnsupported(
            f"bit width {bad[0]} unsupported; onnxruntime executes int8-dynamic and "
            f"int4-matmulnbits, and the ablated quality set is {list(SUPPORTED_BITS)}")
    return widths


def plan(args) -> dict:
    widths = parse_bit_widths(args.bit_widths)
    model_dir = Path(args.model_dir)
    train_path = Path(args.train_jsonl)
    eval_path = Path(args.eval_jsonl)
    expected = [{"bitWidth": w, "artifactLevel": ONNX_LEVELS.get(w) if w == 4 else None,
                 "qualityOnly": w != 4,
                 **({"note": QUALITY_ONLY_NOTE} if w != 4 else {})}
                for w in widths]
    expected.append({"bitWidth": None, "artifactLevel": "int8-dynamic",
                     "qualityOnly": False,
                     "note": "reference upper bound, exported from the fp32 state"})
    manifest_digest = None
    if (model_dir / "manifest.json").is_file():
        try:
            manifest_digest = json.loads((model_dir / "manifest.json")
                                         .read_text(encoding="utf-8")) \
                .get("baseEncoder", {}).get("digest")
        except Exception:  # noqa: BLE001
            manifest_digest = None
    model_pt_digest = sha256_file(model_dir / "model.pt") \
        if weights_present(model_dir) else None
    return {
        "kind": PLAN_KIND,
        "schemaVersion": SCHEMA_VERSION,
        "ticket": TICKET,
        "modelDir": str(model_dir),
        "weightsPresent": weights_present(model_dir),
        "weights": {"modelPt": str(model_dir / "model.pt"),
                    "tokenizerDir": str(model_dir / "tokenizer"),
                    "manifestBaseEncoderDigest": manifest_digest
                    if manifest_digest else None},
        "modelPtSha256": model_pt_digest,
        "seed": args.seed,
        "headLr": args.head_lr,
        "epochs": args.epochs,
        "calibFrac": args.calib_frac,
        "alphas": args.alphas,
        "delta": args.delta,
        "outLedger": str(args.out),
        "trainSha256": sha256_file_lf(train_path) if train_path.is_file() else None,
        "trainRows": count_rows(train_path) if train_path.is_file() else None,
        "evalSha256": sha256_file_lf(eval_path) if eval_path.is_file() else None,
        "evalRows": count_rows(eval_path) if eval_path.is_file() else None,
        "seeds": {"run": args.seed, "conformalSplit": args.seed, "kmeans": args.seed},
        "bitWidths": widths,
        "hyperparameters": {"epochs": args.epochs, "headLr": args.head_lr,
                            "calibFrac": args.calib_frac, "alphas": args.alphas,
                            "delta": args.delta, "batchSize": args.batch_size,
                            "maxLength": args.max_length},
        "trainingData": {
            "trainPath": str(train_path),
            "trainPresent": train_path.is_file(),
            "trainSha256": sha256_file_lf(train_path) if train_path.is_file() else None,
            "trainRows": count_rows(train_path) if train_path.is_file() else None,
            "evalPath": str(eval_path),
            "evalPresent": eval_path.is_file(),
            "evalSha256": sha256_file_lf(eval_path) if eval_path.is_file() else None,
            "evalRows": count_rows(eval_path) if eval_path.is_file() else None,
            "maskedEvalPath": args.masked_eval_jsonl,
            "maskedEvalPresent": bool(args.masked_eval_jsonl)
            and Path(args.masked_eval_jsonl).is_file(),
            "oodPath": args.ood_jsonl,
            "oodPresent": bool(args.ood_jsonl) and Path(args.ood_jsonl).is_file(),
        },
        "ledger": {"path": args.out, "kind": KIND, "schemaVersion": SCHEMA_VERSION,
                   "exists": Path(args.out).exists()},
        "expectedArtifacts": expected,
        "oodBank": {"k": OOD_K, "seed": args.seed,
                    "note": ("fp32 reference embeddings, seeded k-means, int8 centroids "
                             "plus per-centroid float scales")},
        "conformalRule": ("Learn-Then-Test (prior art): highest-coverage threshold with "
                          "binomCdf(k, n_cal, alpha) <= delta; fail closed to threshold null"),
        "deviceRequirement": ("Kaggle 2x T4 for the full-scale run; --device cpu is an "
                              "explicit small-scale run"),
    }


def kaggle_notebook(args) -> dict:
    widths = ",".join(str(w) for w in parse_bit_widths(args.bit_widths))
    alphas = ",".join(f"{a:g}" for a in args.alphas)
    run = (
        "# The repository checkout is uploaded to the notebook (public/synthetic data only).\n"
        "# models/ is gitignored: upload models/weft-specialist as a Kaggle dataset and\n"
        "# unpack it into models/weft-specialist before this cell runs.\n"
        "!rm -rf /kaggle/working/models/weft-specialist-quantized\n"
        "!python scripts/export-weft-quantized.py --device cuda "
        "--model-dir models/weft-specialist "
        "--train-jsonl results/weft-training-pairs-fullscale-live-v4/train.jsonl "
        "--eval-jsonl results/weft-training-pairs-fullscale-live-v4/eval.jsonl "
        "--masked-eval-jsonl results/weft-masked-eval-v4/eval.jsonl "
        "--ood-jsonl results/weft-training-pairs-fullscale-live-v2/eval.jsonl "
        f"--bit-widths {widths} --epochs {args.epochs} --head-lr {args.head_lr} "
        f"--seed {args.seed} --calib-frac {args.calib_frac} --alphas {alphas} "
        f"--delta {args.delta} "
        "--artifact-dir /kaggle/working/models/weft-specialist-quantized "
        "--out /kaggle/working/results/weft-export-latency.json")
    env = ("import platform, torch, transformers, onnx, onnxruntime\n"
           "print(platform.platform(), torch.__version__, torch.version.cuda,\n"
           "      transformers.__version__, onnx.__version__, onnxruntime.__version__)\n"
           "print([torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())])")
    cells = [
        {"cell_type": "markdown", "metadata": {}, "source": [
            "# Weft quantized export (ticket W5)\n",
            "\n",
            "Runtime: Kaggle Notebook, 2x Tesla T4 (2x T4 GPUs). Founder guardrails:\n",
            "data is public/synthetic only (never private customer data); the scripts\n",
            "are fail-closed and exit nonzero with a typed error rather than falling\n",
            "back; the T4 environment is recorded into the ledger entry; ticket W5.\n",
            "\n",
            "models/ is gitignored, so upload models/weft-specialist (model.pt,\n",
            "manifest.json, tokenizer/) as a Kaggle dataset and unpack it into\n",
            "models/weft-specialist in the working tree before the run cell.\n",
        ]},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": ["!pip install -q onnx onnxruntime torchao\n"]},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": env.splitlines(keepends=True)},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
         "source": run.splitlines(keepends=True)},
        {"cell_type": "markdown", "metadata": {}, "source": [
            "## Re-run\n",
            "\n",
            "`python scripts/export-weft-quantized.py --device cuda --bit-widths 2,3,4`\n",
            "\n",
            "Without a GPU or weights the same command exits 2 with a typed error\n",
            "(CUDA absence, `WEFT_WEIGHTS_MISSING`, or `WEFT_ONNX_RUNTIME_MISSING`);\n",
            "a failure never appends to the ledger.\n",
        ]},
    ]
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "accelerator": "GPU",
            "kaggle": {"accelerator": "nvidiaTeslaT4", "gpuCount": 2,
                       "note": "2x T4; each bit width refits its heads under the fake-quant base"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


# ---------------------------------------------------------------------------
# Full run
# ---------------------------------------------------------------------------

def load_pairs_safe(trainer, path: Path) -> list[dict]:
    try:
        return trainer.load_pairs(path)
    except Exception as exc:  # noqa: BLE001
        raise ExportDataMissing(f"{path}: {exc}") from exc


def load_tokenizer_for_run(model_dir: Path, allow_hub: bool):
    try:
        from transformers import AutoTokenizer
    except Exception as exc:  # noqa: BLE001
        raise TrainingRuntimeMissing(f"transformers unavailable: {exc}") from exc
    tok_dir = model_dir / "tokenizer"
    if (tok_dir / "tokenizer.json").is_file():
        return AutoTokenizer.from_pretrained(str(tok_dir), local_files_only=True), True
    if not allow_hub:
        raise WeightsMissing(f"tokenizer absent: {tok_dir}")
    try:
        return AutoTokenizer.from_pretrained(BASE_MODEL), False
    except Exception as exc:  # noqa: BLE001
        raise WeftExportError(f"tokenizer absent locally and in the HF cache: {exc}") from exc


def resolve_device(device: str):
    import torch
    if device == "cuda" and not torch.cuda.is_available():
        raise TrainingRuntimeMissing(
            "CUDA runtime absent; the full-scale run happens on the Kaggle 2x T4 recipe, "
            "or pass --device cpu for an explicit small-scale run")
    return torch.device(device)


def load_model(args, device):
    """W4-v4 state dict into the canonical trainer build_model (or the tiny
    synthetic specialist for dry-run), plus the pristine state copy."""
    import torch
    trainer = load_module("weft_trainer", TRAINER)
    if args.mode == "dry-run":
        from transformers import BertConfig, BertModel
        config = BertConfig(hidden_size=32, num_hidden_layers=1, num_attention_heads=2,
                            intermediate_size=64, vocab_size=30522)
        model = trainer.build_model(BertModel(config), args.theme_dim, args.head_hidden)
    else:
        model_dir = Path(args.model_dir)
        snap = trainer.find_snapshot(BASE_MODEL)
        if snap is None:
            raise WeightsMissing(
                f"{BASE_MODEL} is not in the local Hugging Face cache; nothing is downloaded")
        from transformers import AutoModel
        try:
            base = AutoModel.from_pretrained(str(snap), local_files_only=True)
            model = trainer.build_model(base, args.theme_dim, args.head_hidden)
            state = torch.load(model_dir / "model.pt", map_location="cpu", weights_only=True)
            model.load_state_dict(state, strict=True)
        except Exception as exc:  # noqa: BLE001
            raise WeightsMissing(
                f"could not load the specialist: {type(exc).__name__}: {exc}") from exc
    pristine = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    return model.to(device), pristine, trainer


def train_heads(trainer, model, tokenizer, pairs, args, epochs, head_lr, device):
    # stdout stays a single JSON object; the trainer's per-epoch lines go to stderr
    import contextlib
    ns = argparse.Namespace(
        seed=args.seed, epochs=epochs, batch_size=min(args.batch_size, len(pairs)),
        lr_base=0.0, lr_heads=head_lr, weight_decay=0.01, grad_clip=1.0,
        max_length=args.max_length, temperature=0.07, positive_weight=1.5,
        hard_negative_top_k=3, hub_power=0.5, contrastive_weight=0.5, evidence_weight=0.2)
    with contextlib.redirect_stdout(sys.stderr):
        history, wall = trainer.train(model, tokenizer, pairs, ns, device)
    return history, wall


def tokenizer_json_bytes(args, tokenizer, from_model_dir: bool) -> bytes:
    path = Path(args.model_dir) / "tokenizer" / "tokenizer.json"
    if path.is_file():
        return path.read_bytes()
    if not from_model_dir and args.mode != "dry-run":
        raise WeightsMissing(f"tokenizer.json absent: {path}")
    tmp = Path(tempfile.mkdtemp(prefix="weft-tok-"))
    tokenizer.save_pretrained(str(tmp))
    return (tmp / "tokenizer.json").read_bytes()


def onnx_sample_ids(common) -> tuple:
    """A small real batch (eval texts) used only to trace the export graph."""
    tokenizer = common["tokenizer"]
    texts = common["eval_texts"][:2] or ["anchor", "candidate"]
    enc_a = tokenizer(texts, padding=True, truncation=True, max_length=8, return_tensors="pt")
    enc_b = tokenizer(list(reversed(texts)), padding=True, truncation=True,
                      max_length=8, return_tensors="pt")
    return (enc_a["input_ids"], enc_a["attention_mask"],
            enc_b["input_ids"], enc_b["attention_mask"])


def run_export(args) -> dict:
    widths = parse_bit_widths(args.bit_widths)
    out = Path(args.out)
    check_ledger(out)
    model_dir = Path(args.model_dir)
    if args.mode != "dry-run" and not weights_present(model_dir):
        raise WeightsMissing(
            f"model dir incomplete (needs model.pt, tokenizer/tokenizer.json, "
            f"tokenizer/tokenizer_config.json): {model_dir}")
    train_path, eval_path = Path(args.train_jsonl), Path(args.eval_jsonl)
    for label, path in (("train", train_path), ("eval", eval_path)):
        if not path.is_file():
            raise ExportDataMissing(f"{label} pairs absent: {path}")
    try:
        import torch  # noqa: F401 - heavy import, only past the fail-closed gates
        import transformers  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        raise TrainingRuntimeMissing(f"torch/transformers unavailable: {exc}") from exc
    device = resolve_device(args.device)
    model, pristine, trainer = load_model(args, device)
    tokenizer, tok_from_model_dir = load_tokenizer_for_run(
        model_dir, allow_hub=(args.mode == "dry-run"))

    max_rows = args.max_rows
    train_pairs = load_pairs_safe(trainer, train_path)
    eval_pairs = load_pairs_safe(trainer, eval_path)
    masked_pairs = (load_pairs_safe(trainer, Path(args.masked_eval_jsonl))
                    if args.masked_eval_jsonl
                    and Path(args.masked_eval_jsonl).is_file() else [])
    ood_pairs = (load_pairs_safe(trainer, Path(args.ood_jsonl))
                 if args.ood_jsonl and Path(args.ood_jsonl).is_file() else [])
    if max_rows:
        train_pairs = train_pairs[:max_rows]
        eval_pairs = eval_pairs[:max_rows]
        masked_pairs = masked_pairs[:max_rows]
        ood_pairs = ood_pairs[:max_rows]
    eval_pairs = to_score_rows(eval_pairs)
    masked_pairs = to_score_rows(masked_pairs)

    # OOD bank once, from the fp32 reference embeddings (never fake-quant)
    ood_k = OOD_K_DRY_RUN if args.mode == "dry-run" else OOD_K
    import numpy as np
    eval_texts, eval_idx = unique_texts(eval_pairs)
    bank_docs = sorted({p["anchor"] for p in train_pairs} | {p["candidate"] for p in train_pairs})
    vectors = raw_mean_pool(model.base, tokenizer, bank_docs + eval_texts, device, args.max_length)
    centers = kmeans_seeded(vectors[:len(bank_docs)], ood_k, args.seed)
    blob = pack_ood_bank(centers)
    eval_trip = tripwire_scores(vectors[len(bank_docs):], centers)
    ood_threshold = ood_threshold_from_eval(eval_trip, OOD_PASS_TARGET)
    eval_pass_rate = float(np.mean(eval_trip >= ood_threshold)) if len(eval_trip) else 0.0
    ood_flag_rate = None
    if ood_pairs:
        ood_texts, _ = unique_texts(ood_pairs)
        ood_vectors = raw_mean_pool(model.base, tokenizer, ood_texts, device, args.max_length)
        ood_flag_rate = float(np.mean(tripwire_scores(ood_vectors, centers) < ood_threshold))

    if args.mode == "dry-run" and args.artifact_dir_default:
        artifact_dir = Path(tempfile.mkdtemp(prefix="weft-dry-export-"))
    else:
        artifact_dir = Path(args.artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    common = {
        "eval_rows": eval_pairs, "eval_texts": eval_texts, "eval_idx": eval_idx,
        "masked_rows": masked_pairs,
        "ood_blob": blob, "ood_threshold": ood_threshold, "ood_pass_rate": eval_pass_rate,
        "ood_flag_rate": ood_flag_rate, "tok_from_model_dir": tok_from_model_dir,
        "tokenizer": tokenizer, "trainer": trainer, "pristine": pristine,
        "device": device, "train_pairs": train_pairs, "artifact_dir": artifact_dir,
    }
    ticket = TICKET if args.mode == "run" else TICKET_DRY_RUN
    status = "ran" if args.mode == "run" else "dry-run"
    dry_note = ([] if args.mode == "run" else [
        "dry-run smoke on a synthetic tiny specialist; one epoch; kNN bank k=16; "
        "a temp artifact dir and a temp ledger unless --artifact-dir/--out are given"])

    # all bit-width levels and the reference are computed before anything is
    # appended: a failure anywhere appends nothing
    entries = []
    for bit_width in (widths if args.mode != "dry-run" else [4]):
        entries.append(run_one_level(args, model, bit_width, common, ticket, status))
    entries.append(run_reference_int8(args, model, common, ticket, status))
    if args.mode == "dry-run":
        checks = dry_run_checks(common["artifact_dir"])
    for entry in entries:
        if dry_note:
            entry["notes"] = entry.get("notes", []) + dry_note
        written = write_entry(out, entry)
        entry["runId"] = written["entries"][-1]["runId"]

    summary = {"entries": len(entries), "out": args.out,
               "runIds": [e.get("runId") for e in entries],
               "results": [{k: e[k] for k in ("bitWidth", "artifact", "quality")
                            if k in e} for e in entries]}
    if args.mode == "dry-run":
        summary["dryRunChecks"] = checks
    return summary


def to_score_rows(pairs: list[dict]) -> list[dict]:
    return [{"label": "positive" if p["label"] > 0.5 else "negative",
             "anchor": p["anchor"], "candidate": p["candidate"],
             "pairType": p["pairType"]} for p in pairs]


# ---------------------------------------------------------------------------
# One bit width
# ---------------------------------------------------------------------------

def run_one_level(args, model, bit_width, common, ticket, status) -> dict:
    import torch
    device = common["device"]
    model.load_state_dict(dict(common["pristine"]), strict=True)
    model.to(device)
    impl = fake_quant_base(model.base, bit_width)
    history, wall = train_heads(common["trainer"], model, common["tokenizer"],
                                common["train_pairs"], args, args.epochs,
                                args.head_lr, device)
    pooled = encode_all(model, common["tokenizer"], common["eval_texts"], device, args.max_length)
    eval_scores = symmetric_scores(model, pooled, common["eval_idx"], common["eval_rows"], device)
    quality = quality_block(common["eval_rows"], eval_scores)
    masked_quality = None
    if common["masked_rows"]:
        masked_texts, masked_idx = unique_texts(common["masked_rows"])
        masked_scores = symmetric_scores(
            model, encode_all(model, common["tokenizer"], masked_texts, device,
                              args.max_length), masked_idx, common["masked_rows"], device)
        masked_quality = quality_block(common["masked_rows"], masked_scores)
    del pooled
    conformal = conformal_ltt(common["eval_rows"], eval_scores, args.alphas,
                              args.calib_frac, args.delta, args.seed)
    latency = torch_latency(model, common["tokenizer"], common["eval_texts"],
                            common["eval_rows"], device, args.max_length)

    model_dir = Path(args.model_dir)
    model_pt_digest = sha256_file(model_dir / "model.pt") \
        if (model_dir / "model.pt").is_file() else None
    if model_pt_digest is None and args.mode == "dry-run":
        model_pt_digest = "synthetic-tiny-dry-run"
    tok_bytes = tokenizer_json_bytes(args, common["tokenizer"], common["tok_from_model_dir"])
    tokenizer_digest = hashlib.sha256(tok_bytes).hexdigest()
    train_digest = sha256_file_lf(Path(args.train_jsonl))
    eval_digest = sha256_file_lf(Path(args.eval_jsonl))
    embedding_report = None

    if bit_width == 4:
        manifest = artifact_manifest(args, bit_width, model_pt_digest, tokenizer_digest,
                                     train_digest, eval_digest,
                                     hashlib.sha256(common["ood_blob"]).hexdigest(),
                                     conformal)
        try:
            export_model = copy.deepcopy(model).to("cpu")
            sample_ids = onnx_sample_ids(common)
            artifact = export_level(export_model, sample_ids,
                                    common["artifact_dir"] / "weft-int4.onnx",
                                    "int4-matmulnbits", tok_bytes, common["ood_blob"],
                                    common["ood_threshold"], manifest, common,
                                    args.max_rows or 200)
            notes = ["4-bit artifact (MatMulNBits); the tokenizer JSON, the int8 OOD bank, "
                     "the OOD threshold, and the manifest travel in the onnx metadata; "
                     "tokenization happens outside the graph"]
            embedding_report = artifact.pop("embedding", None)
            if embedding_report:
                notes.append(
                    f"token-embedding int8 per-row: in-sample f1 {embedding_report['beforeF1']:.4f} "
                    f"with the fp32 table (int4 matmuls), {embedding_report['afterF1']:.4f} "
                    f"after the embedding int8 step, delta "
                    f"{embedding_report['deltaF1']:+.4f} measured on the same "
                    f"{embedding_report['pairCount']} pairs")
        except OnnxRuntimeMissing as exc:
            artifact = {"path": None, "bytes": None, "sha256": None, "quantized": True,
                        "level": None, "qualityOnly": True, **size_ceiling(None),
                        "note": f"onnxruntime MatMulNBits unavailable: {exc.detail}"}
            notes = [QUALITY_ONLY_NOTE,
                     "the 4-bit export needs MatMulNBits; recorded as quality only"]
    else:
        artifact = {"path": None, "bytes": None, "sha256": None, "quantized": True,
                    "level": None, "qualityOnly": True, **size_ceiling(None),
                    "note": QUALITY_ONLY_NOTE}
        notes = [QUALITY_ONLY_NOTE]

    return {
        "ticket": ticket,
        "status": status,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seeds": {"run": args.seed, "conformalSplit": args.seed, "kmeans": args.seed,
                  "fakeQuant": args.seed},
        "bitWidth": bit_width,
        "quality": {**quality, "masked": masked_quality},
        "qat": {"epochs": args.epochs, "headLr": args.head_lr,
                "fakeQuantImplementation": impl, "headsQuant": "int8"},
        "conformal": conformal,
        "ood": {"k": bank_k(common["ood_blob"]), "bankBytes": len(common["ood_blob"]),
                "threshold": common["ood_threshold"], "evalPassRate": common["ood_pass_rate"],
                "oodFlagRate": common["ood_flag_rate"]},
        "embedding": embedding_report,
        "artifact": artifact,
        "latency": latency,
        "notes": notes + [
            f"fake-quant implementation {impl}; the base is frozen "
            f"(learningRateBase 0.0), so quantization is a one-shot weight transform",
            f"head retrain wall seconds {wall:.1f}; epochs run {len(history)}",
            "trainJsonlSha256 " + train_digest,
            "evalJsonlSha256 " + eval_digest,
            "heads stay int8 in every runtime artifact; the ONNX graph encodes both docs per pair",
        ],
    }


def run_reference_int8(args, model, common, ticket, status) -> dict:
    """int8-dynamic reference upper bound, exported once from the fp32 state;
    no QAT; quality measured fresh on the same eval."""
    device = common["device"]
    model.load_state_dict(dict(common["pristine"]), strict=True)
    model.to(device)
    pooled = encode_all(model, common["tokenizer"], common["eval_texts"], device, args.max_length)
    eval_scores = symmetric_scores(model, pooled, common["eval_idx"], common["eval_rows"], device)
    quality = quality_block(common["eval_rows"], eval_scores)
    del pooled
    latency = torch_latency(model, common["tokenizer"], common["eval_texts"],
                            common["eval_rows"], device, args.max_length)
    artifact = {"path": None, "bytes": None, "sha256": None, "quantized": True,
                "level": None, "qualityOnly": True, **size_ceiling(None),
                "note": "onnxruntime absent; no int8 reference artifact"}
    try:
        export_model = copy.deepcopy(model).to("cpu")
        artifact = export_level(export_model, onnx_sample_ids(common),
                                common["artifact_dir"] / "weft-int8-reference.onnx",
                                "int8-dynamic", None, None, None, None, common,
                                args.max_rows or 200)
    except OnnxRuntimeMissing:
        artifact["level"] = None
        artifact["qualityOnly"] = True
    notes = ["int8-dynamic reference upper bound exported from the fp32 W4-v4 state; "
             "no QAT rows apply to this entry",
             "no quantization metadata travels in this artifact; the 4-bit artifact "
             "carries the metadata"]
    if quality is None:
        quality = {"threshold": None, "precision": None, "recall": None, "f1": None,
                   "pairCount": 0}
    return {
        "ticket": ticket, "status": status,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seeds": {"run": args.seed},
        "bitWidth": 8,
        "quality": {**quality, "masked": None},
        "qat": None,
        "conformal": None,
        "ood": {"k": None, "bankBytes": None, "threshold": None,
                "evalPassRate": None, "oodFlagRate": None},
        "artifact": artifact,
        "latency": latency,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Measure mode: clean-runtime latency of an exported artifact
# ---------------------------------------------------------------------------

def measure_artifact(args) -> dict:
    out = Path(args.out)
    check_ledger(out)
    path = Path(args.measure_artifact)
    if not path.is_file():
        raise WeightsMissing(f"artifact absent: {path}")
    try:
        import onnxruntime as ort
    except Exception as exc:  # noqa: BLE001
        raise OnnxRuntimeMissing(f"onnx/onnxruntime unavailable: {exc}") from exc
    digest = sha256_file(path)
    entries = json.loads(out.read_text(encoding="utf-8")).get("entries", [])
    prior_rows = [e for e in entries if (e.get("artifact") or {}).get("sha256") == digest]
    if not prior_rows:
        raise ArtifactDigestMismatch(
            f"no prior ledger entry records this artifact sha256; an unattributed file "
            f"can never contribute numbers: {path} ({digest})")
    prior = prior_rows[-1]
    meta = read_metadata(path)
    manifest = meta.get("manifest")
    level = (manifest or {}).get("artifactLevel") or (prior.get("artifact") or {}).get("level")
    notes = ["clean-runtime measure mode on this box; the artifact sha256 matches the "
             "recorded ledger entry"]
    if manifest is not None:
        if manifest.get("quantized") is not True:
            raise ArtifactDigestMismatch(f"manifest does not record quantized true: {path}")
        notes.append(f"metadata manifest: ticket {manifest.get('ticket')}, bitWidth "
                     f"{manifest.get('bitWidth')}, level {manifest.get('artifactLevel')}")
        notes.append("manifest sha256 pins: " + json.dumps(
            {k: ((v[:12] + "...") if isinstance(v, str) else v)
             for k, v in (manifest.get("sha256") or {}).items()}))
        if "tokenizer" in meta:
            if meta["tokenizer"].strip()[:1] != b"{":
                raise ArtifactDigestMismatch(f"tokenizer metadata malformed: {path}")
            notes.append("tokenizer metadata decodes to a tokenizer JSON")
        else:
            raise ArtifactDigestMismatch(f"tokenizer metadata absent: {path}")
        if "ood_bank" in meta:
            if meta["ood_bank"][:4] != b"WOOD":
                raise ArtifactDigestMismatch(f"ood bank metadata malformed: {path}")
            notes.append("ood bank metadata decodes (int8 centroids plus float scales)")
        if "ood_threshold" in meta:
            notes.append(f"ood threshold in metadata: {meta['ood_threshold']}")
    else:
        notes.append("no metadata manifest in this artifact; measured against the "
                     "recorded ledger digest only")
        level = level or "int8-dynamic"

    tokenizer = None
    if "tokenizer" in meta:
        tok_dir = Path(tempfile.mkdtemp(prefix="weft-measure-tok-"))
        (tok_dir / "tokenizer.json").write_bytes(meta["tokenizer"])
        # tokenizer_class is required: AutoTokenizer refuses a directory with no
        # config.json unless the config names a class; the fast class then loads
        # from the embedded tokenizer.json alone
        (tok_dir / "tokenizer_config.json").write_bytes(
            b'{"model_max_length": 128, "tokenizer_class": "BertTokenizer"}')
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(tok_dir), local_files_only=True)
    elif (Path(args.model_dir) / "tokenizer" / "tokenizer.json").is_file():
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(Path(args.model_dir) / "tokenizer"),
                                                  local_files_only=True)
    if tokenizer is None:
        raise WeightsMissing(
            "no tokenizer available: the artifact carries no tokenizer metadata and "
            "--model-dir/tokenizer is absent")
    trainer = load_module("weft_trainer", TRAINER)
    eval_pairs = load_pairs_safe(trainer, Path(args.eval_jsonl))
    rows = to_score_rows(eval_pairs)
    result = measure_onnx(path, rows, args.max_rows or 200, ort, tokenizer)
    device = "cpu"
    entry = {
        "ticket": TICKET,
        "status": "ran",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seeds": {"run": args.seed},
        "bitWidth": ((manifest or {}).get("bitWidth")
                     if manifest is not None else prior.get("bitWidth")),
        "quality": result["quality"],
        "qat": None,
        "conformal": None,
        "ood": None,
        "artifact": {"path": display_path(path), "bytes": path.stat().st_size,
                     "sha256": digest, "quantized": True, "level": level,
                     "qualityOnly": False, **size_ceiling(path.stat().st_size)},
        "latency": {
            "measurementRuntime": "onnxruntime",
            "device": device,
            "platform": platform.platform(),
            "encodeMsPerDoc": result["encodeMsPerDoc"],
            "pairScoringMsPerPair": result["pairScoringMsPerPair"],
            "peakRssMb": result["peakRssMb"],
            "peakRssSource": result["peakRssSource"],
            "samplePairs": result["samplePairs"],
        },
        "notes": notes + [
            "encodeMsPerDoc is half the pair-graph forward (the graph encodes both docs)",
            "quality is the in-sample max-F1 sweep on the measured eval sample",
        ],
    }
    written = write_entry(out, entry)
    entry["runId"] = written["entries"][-1]["runId"]
    return {"runId": entry["runId"], "out": args.out, "artifact": entry["artifact"],
            "quality": entry["quality"], "latency": entry["latency"]}


# ---------------------------------------------------------------------------
# Dry-run checks
# ---------------------------------------------------------------------------

def dry_run_checks(artifact_dir: Path) -> dict:
    """Verify the export round-trips: metadata decodes, onnxruntime loads both
    shipped levels."""
    checks = {"metadataRoundTrip": None, "int8Loads": None, "int4Loads": None}
    try:
        import onnxruntime as ort
    except Exception as exc:  # noqa: BLE001
        checks["error"] = f"onnxruntime unavailable: {type(exc).__name__}: {exc}"
        return checks
    int4 = artifact_dir / "weft-int4.onnx"
    int8 = artifact_dir / "weft-int8-reference.onnx"
    try:
        if int4.is_file():
            meta = read_metadata(int4)
            checks["metadataRoundTrip"] = bool(
                "manifest" in meta and "tokenizer" in meta and "ood_bank" in meta
                and "ood_threshold" in meta
                and (meta.get("manifest") or {}).get("quantized") is True)
            checks["int4Loads"] = bool(ort.InferenceSession(
                str(int4), providers=["CPUExecutionProvider"]))
        if int8.is_file():
            checks["int8Loads"] = bool(ort.InferenceSession(
                str(int8), providers=["CPUExecutionProvider"]))
    except Exception as exc:  # noqa: BLE001
        checks["error"] = f"{type(exc).__name__}: {exc}"
    return checks


def dry_run(args) -> dict:
    """CPU end-to-end smoke on a synthetic tiny specialist: one epoch, a k=16
    bank, ONNX export and int8 quantization, the metadata round-trip, and the
    ledger append (ticket W5-dry-run, status dry-run)."""
    check_ledger(Path(args.out))
    if args.out_default:
        out = Path(tempfile.mkdtemp(prefix="weft-dry-ledger-")) / "weft-export-latency.json"
        temp_ledger = True
    else:
        out = Path(args.out)
        temp_ledger = False
    args.out = str(out)
    args.mode = "dry-run"
    args.device = "cpu"
    args.epochs = 1
    if not args.max_rows:
        args.max_rows = 64
    summary = run_export(args)
    summary["dryRunLedger"] = {"out": args.out, "temporary": temp_ledger,
                               "ticket": TICKET_DRY_RUN, "status": "dry-run"}
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Quantization-aware export of the Weft specialist (W5)")
    parser.add_argument("--mode", choices=["run", "plan", "dry-run"], default="run")
    parser.add_argument("--dry-run", action="store_true",
                        help="CPU end-to-end smoke on a synthetic tiny specialist")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--bit-widths", default="2,3,4",
                        help="comma-separated QAT bit widths; 2 and 3 are quality-only")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--head-lr", type=float, default=1e-3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-length", type=int, default=128)
    parser.add_argument("--theme-dim", type=int, default=128)
    parser.add_argument("--head-hidden", type=int, default=256)
    parser.add_argument("--calib-frac", type=float, default=0.5)
    parser.add_argument("--alphas", default="0.05,0.10",
                        help="comma-separated LTT miscoverage levels, e.g. 0.05,0.10")
    parser.add_argument("--delta", type=float, default=0.05)
    parser.add_argument("--model-dir", default=str(ROOT / "models/weft-specialist"))
    parser.add_argument("--train-jsonl", default=str(
        ROOT / "results/weft-training-pairs-fullscale-live-v4/train.jsonl"))
    parser.add_argument("--eval-jsonl", default=str(
        ROOT / "results/weft-training-pairs-fullscale-live-v4/eval.jsonl"))
    parser.add_argument("--masked-eval-jsonl", default=None)
    parser.add_argument("--ood-jsonl", default=None)
    parser.add_argument("--artifact-dir", default=None,
                        help="where exported .onnx files land (default models/weft-specialist-quantized)")
    parser.add_argument("--out", default=None,
                        help="append-only ledger (default results/weft-export-latency.json)")
    parser.add_argument("--max-rows", type=int, default=None,
                        help="cap each input jsonl (dry-run uses 64; measure mode 200)")
    parser.add_argument("--measure-artifact", default=None,
                        help="clean-runtime measurement of an exported .onnx")
    parser.add_argument("--emit-kaggle-notebook", action="store_true",
                        help="print the Kaggle 2x T4 notebook JSON and exit")
    args = parser.parse_args(argv)
    if args.dry_run:
        args.mode = "dry-run"
    args.alphas = sorted({float(x) for x in str(args.alphas).split(",") if x.strip()})
    args.out_default = args.out is None
    args.artifact_dir_default = args.artifact_dir is None
    if args.out is None:
        args.out = str(ROOT / "results/weft-export-latency.json")
    if args.artifact_dir is None:
        args.artifact_dir = str(ROOT / "models/weft-specialist-quantized")
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        if args.emit_kaggle_notebook:
            print(json.dumps(kaggle_notebook(args), indent=2))
            return 0
        if args.mode == "plan":
            print(json.dumps(plan(args), indent=2))
            return 0
        if args.measure_artifact:
            print(json.dumps(measure_artifact(args)))
            return 0
        if args.mode == "dry-run":
            print(json.dumps(dry_run(args)))
            return 0
        print(json.dumps(run_export(args)))
        return 0
    except WeftExportError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail, "kind": ERROR_KIND}),
              file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - fail closed on every non-typed path
        print(json.dumps({"error": "WEFT_EXPORT_ERROR",
                          "detail": f"unexpected failure: {type(exc).__name__}: {exc}",
                          "kind": ERROR_KIND}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
