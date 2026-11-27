#!/usr/bin/env python3
"""Weft theme-linking baseline shootout (ticket W1).

Evaluates theme-linking baselines over a deterministic synthetic noisy estate
(with an optional public CDCR JSONL source) in three bucket families:
cross-department, cross-modality, and identity-overlap vs identity-disjoint.
Splits are leave-one-department-out and leave-one-modality-out.

Baselines in one harness:
  - bm25 (in-repo implementation)
  - model2vec_static_threshold (potion-base-32M, local weights required)
  - minilm_l6_cosine (sentence-transformers/all-MiniLM-L6-v2, local weights required)
  - bertopic_style (TF-IDF + KMeans + c-TF-IDF, in-repo implementation)
  - local_llm_judge (upper reference on a seeded pair sample, local weights required)

Any baseline whose runtime or weights are not available locally is recorded as
unavailable with a typed reason. No metric is written for an unavailable
baseline. Output is append-only: prior entries in the artifact are preserved
byte-for-byte.

Output: results/weft-baselines.json (or --out).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
import platform
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
ESTATE_VERSION = "weft-synthetic-v1"
ALPHAS = (0.05, 0.10)
# Built from fragments so this compliance check does not itself carry the literal terms.
_BANNED = ("mathematically" + " grounded", "elimin" + "ates", "fir" + "st")

DEPARTMENTS = [
    "Research", "Finance", "Operations", "Legal",
    "Sales", "Support", "Engineering", "People",
]
MODALITIES = ["email", "transcript", "slide", "ticket", "memo"]

THEMES = [
    ("vendor onboarding", ["vendor", "onboarding", "supplier", "procurement", "contract", "diligence", "checklist", "approval"]),
    ("quarterly budget", ["budget", "quarterly", "forecast", "variance", "allocation", "spend", "planning", "revision"]),
    ("customer escalation", ["escalation", "customer", "incident", "severity", "response", "ticket", "outage", "resolution"]),
    ("security audit", ["security", "audit", "access", "credential", "vulnerability", "review", "policy", "control"]),
    ("hiring pipeline", ["hiring", "candidate", "recruiting", "interview", "offer", "role", "pipeline", "onboarding"]),
    ("product launch", ["launch", "release", "product", "roadmap", "feature", "announcement", "readiness", "milestone"]),
    ("data retention", ["retention", "archive", "deletion", "storage", "lifecycle", "policy", "purge", "schedule"]),
    ("travel policy", ["travel", "policy", "expense", "booking", "reimbursement", "approval", "itinerary", "compliance"]),
    ("facilities move", ["facilities", "move", "office", "relocation", "floorplan", "logistics", "lease", "workspace"]),
    ("partner integration", ["partner", "integration", "api", "interface", "mapping", "protocol", "joint", "sync"]),
    ("training program", ["training", "program", "course", "curriculum", "session", "enrollment", "mentor", "module"]),
    ("risk register", ["risk", "register", "mitigation", "likelihood", "impact", "owner", "review", "register"]),
    ("invoice reconciliation", ["invoice", "reconciliation", "payment", "ledger", "discrepancy", "vendor", "match", "closing"]),
    ("patent filing", ["patent", "filing", "invention", "claims", "prior", "art", "prosecution", "draft"]),
    ("supply chain", ["supply", "chain", "logistics", "shipment", "inventory", "shortage", "lead", "time"]),
    ("customer research", ["research", "customer", "interview", "survey", "usability", "insight", "segment", "finding"]),
    ("marketing campaign", ["marketing", "campaign", "audience", "creative", "channel", "conversion", "brief", "launch"]),
    ("legal review", ["legal", "review", "clause", "liability", "indemnity", "counsel", "redline", "agreement"]),
    ("platform migration", ["migration", "platform", "cutover", "rollback", "downtime", "plan", "validation", "window"]),
    ("support staffing", ["support", "staffing", "shift", "queue", "coverage", "roster", "backlog", "handoff"]),
    ("compliance filing", ["compliance", "filing", "regulation", "disclosure", "deadline", "attestation", "report", "review"]),
    ("pricing change", ["pricing", "change", "discount", "tier", "margin", "approval", "notice", "contract"]),
    ("incident postmortem", ["incident", "postmortem", "root", "cause", "timeline", "action", "learning", "review"]),
    ("knowledge base", ["knowledge", "base", "article", "documentation", "search", "tag", "content", "update"]),
]

FILLER = [
    "the team reviewed the current status and agreed on next steps",
    "please see the attached summary and reply with corrections",
    "this note records the discussion and the decisions taken today",
    "the working group will follow up in the next cycle",
    "a short update was requested by the program office",
    "the draft was circulated for comment before the deadline",
]

PEOPLE = [
    "Avery Stone", "Blake Moreno", "Cameron Reyes", "Dakota Fisher",
    "Emerson Hale", "Finley Grant", "Harper Quinn", "Indigo Shaw",
    "Jordan Pike", "Kendall Frost", "Logan Mercer", "Marlow Vance",
    "Noor Haddad", "Oakley Brandt", "Parker Ellis", "Quinn Adler",
    "Reese Molina", "Sage Whitaker", "Tanner Lowe", "Uma Castell",
    "Vale Navarro", "Wren Okafor", "Xavi Duarte", "Yara Lin",
]

PROJECTS = ["Project AMBER", "Project BASALT", "Project CINDER", "Project DELTIC",
            "Project EMBER", "Project FALLOW", "Project GRANITE", "Project HARVEST"]

STOPWORDS = frozenset(
    "a an and are as at be been by for from has have in into is it its of on or "
    "that the their this to was were will with we our you your they them".split()
)


class Unavailable(Exception):
    """Typed fail-closed signal for one baseline."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


# ---------------------------------------------------------------------------
# Deterministic synthetic theme-linking estate
# ---------------------------------------------------------------------------

def _corrupt(text: str, rng: random.Random, rate: float) -> str:
    subs = {"e": "3", "a": "@", "o": "0", "i": "1", "s": "5"}
    out = []
    for ch in text:
        if ch.lower() in subs and rng.random() < rate:
            out.append(subs[ch.lower()])
        else:
            out.append(ch)
    return "".join(out)


def build_synthetic_estate(seed: int, fixture: bool) -> dict:
    theme_count = 6 if fixture else len(THEMES)
    per_theme = 6 if fixture else 10
    rng = random.Random(seed)
    themes = THEMES[:theme_count]
    common_pool = PEOPLE[:4]
    solo_pool = PEOPLE[4:]
    docs = []

    for ti, (theme_name, terms) in enumerate(themes):
        for j in range(per_theme):
            dept = DEPARTMENTS[(ti * 3 + j) % len(DEPARTMENTS)]
            modality = MODALITIES[(ti + j * 2) % len(MODALITIES)]
            if j < 4:
                author = common_pool[(ti + j) % len(common_pool)]
                # Theme project (same-theme overlap) plus a cross-theme person
                # (identity-matched hard negatives across themes).
                entities = {author, PROJECTS[ti % len(PROJECTS)]}
            else:
                author = solo_pool[(ti * per_theme + j) % len(solo_pool)]
                entities = {author}
            term_text = " ".join(terms)
            text = " ".join([
                f"{theme_name} update for {dept}",
                term_text, term_text,
                rng.choice(FILLER),
                " ".join(sorted(entities)),
                rng.choice(FILLER),
            ])
            if rng.random() < 0.35:
                text = _corrupt(text, rng, 0.05)
            docs.append({
                "id": f"D{ti:02d}-{j:02d}",
                "text": text,
                "theme": theme_name,
                "department": dept,
                "modality": modality,
                "entities": sorted(entities),
            })

    canonical = json.dumps(docs, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "kind": "synthetic-theme-estate",
        "version": ESTATE_VERSION,
        "seed": seed,
        "themes": len(themes),
        "departments": len(DEPARTMENTS),
        "modalities": len(MODALITIES),
        "documents": docs,
        "estateSha256": hashlib.sha256(canonical).hexdigest(),
        "noise": "seeded ASR/OCR-style character substitution on ~35% of documents",
    }


def build_pairs(docs: list[dict]) -> list[dict]:
    pairs = []
    for i in range(len(docs)):
        for j in range(i + 1, len(docs)):
            a, b = docs[i], docs[j]
            overlaps = bool(set(a["entities"]) & set(b["entities"]))
            pairs.append({
                "i": i,
                "j": j,
                "label": a["theme"] == b["theme"],
                "cross_department": a["department"] != b["department"],
                "cross_modality": a["modality"] != b["modality"],
                "identity_overlap": overlaps,
                "identity_disjoint": not overlaps,
            })
    return pairs


def _public_docs(path: Path) -> list[dict]:
    files = sorted(path.glob("*.jsonl"))
    if not files:
        raise Unavailable("public_slice_files_absent", f"no *.jsonl files under {path}")
    docs = []
    for f in files:
        for lineno, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                docs.append({
                    "id": str(row["id"]),
                    "text": str(row["text"]),
                    "theme": str(row["theme"]),
                    "department": str(row.get("department", "unspecified")),
                    "modality": str(row.get("modality", "unspecified")),
                    "entities": sorted(str(e) for e in row.get("entities", [])),
                })
            except Exception as exc:  # noqa: BLE001 - typed fail-closed
                raise Unavailable("public_slice_malformed", f"{f.name}:{lineno}: {exc}") from exc
    if len(docs) < 4:
        raise Unavailable("public_slice_too_small", f"{len(docs)} documents under {path}")
    return docs


# ---------------------------------------------------------------------------
# Model availability (fail closed, never downloads)
# ---------------------------------------------------------------------------

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


def _has_weights(snap: Path) -> bool:
    return weight_path(snap) is not None or (snap / "model.safetensors.index.json").exists()


def _files_without_weights(snap: Path) -> list[Path]:
    out = []
    for p in sorted(snap.rglob("*")):
        if p.is_file() and "safetensors" not in p.name and p.suffix != ".bin":
            out.append(p)
    return out


def digest_paths(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        if not p.is_file():
            continue
        h.update(str(p.name).encode("utf-8"))
        h.update(b"\0")
        with p.open("rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                h.update(chunk)
        h.update(b"\0")
    return h.hexdigest()


def require_snapshot(repo_id: str) -> Path:
    snap = find_snapshot(repo_id)
    if snap is None:
        raise Unavailable("model_weights_not_local", f"{repo_id} is not present in the local Hugging Face cache")
    if not _has_weights(snap):
        raise Unavailable("model_weights_not_local", f"{repo_id} snapshot has no weight file (incomplete download)")
    return snap


def _artifact_bytes(snap: Path) -> int:
    return sum(p.stat().st_size for p in snap.rglob("*") if p.is_file())


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS]


def cosine_dense(a, b) -> float:
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def pair_metrics(pairs: list[dict], preds: list[bool]) -> dict:
    tp = fp = fn = truth_pos = pred_pos = 0
    for p, pred in zip(pairs, preds):
        truth_pos += int(p["label"])
        pred_pos += int(pred)
        if pred and p["label"]:
            tp += 1
        elif pred and not p["label"]:
            fp += 1
        elif not pred and p["label"]:
            fn += 1
    precision = tp / pred_pos if pred_pos else 0.0
    recall = tp / truth_pos if truth_pos else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "truePositivePairs": tp,
        "falsePositivePairs": fp,
        "falseNegativePairs": fn,
        "truthPositivePairs": truth_pos,
        "predictedPositivePairs": pred_pos,
    }


def _components(n: int, edges: list[tuple[int, int]]) -> list[int]:
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    return [find(x) for x in range(n)]


def b_cubed(comps: list[int], truth: list[str]) -> dict:
    pred_groups: dict[int, list[int]] = {}
    truth_groups: dict[str, list[int]] = {}
    for idx, (c, t) in enumerate(zip(comps, truth)):
        pred_groups.setdefault(c, []).append(idx)
        truth_groups.setdefault(t, []).append(idx)
    p = r = 0.0
    for idx in range(len(comps)):
        pg = pred_groups[comps[idx]]
        tg = truth_groups[truth[idx]]
        same = len(set(pg) & set(tg))
        p += same / len(pg)
        r += same / len(tg)
    n = len(comps)
    p /= n
    r /= n
    f1 = (2 * p * r / (p + r)) if (p + r) else 0.0
    return {"precision": p, "recall": r, "f1": f1}


def blast_radius(comps: list[int], truth: list[str]) -> dict:
    groups: dict[int, list[int]] = {}
    for idx, c in enumerate(comps):
        groups.setdefault(c, []).append(idx)
    max_themes = 0
    total_themes = 0
    contaminated_clusters = 0
    contaminated_docs = 0
    max_size = 0
    for members in groups.values():
        themes = {truth[i] for i in members}
        max_themes = max(max_themes, len(themes))
        total_themes += len(themes)
        max_size = max(max_size, len(members))
        if len(themes) >= 2:
            contaminated_clusters += 1
            contaminated_docs += len(members)
    return {
        "maxThemesPerCluster": max_themes,
        "meanThemesPerCluster": total_themes / len(groups) if groups else 0.0,
        "maxClusterSize": max_size,
        "contaminatedClusters": contaminated_clusters,
        "contaminatedDocuments": contaminated_docs,
    }


def select_threshold(scores: list[float], allowed: list[bool], labels: list[bool]) -> tuple[float, float]:
    """Max-F1 threshold over the evaluation pairs. Disclosed in-sample selection."""
    n = len(scores)
    truth_pos = sum(1 for x in labels if x)
    order = sorted(range(n), key=lambda k: scores[k], reverse=True)
    best_t = math.inf
    best_f1 = -1.0
    tp = fp = 0
    idx = 0
    while idx < n:
        t = scores[order[idx]]
        while idx < n and scores[order[idx]] == t:
            k = order[idx]
            if allowed[k]:
                if labels[k]:
                    tp += 1
                else:
                    fp += 1
            idx += 1
        pred_pos = tp + fp
        fn = truth_pos - tp
        precision = tp / pred_pos if pred_pos else 0.0
        recall = tp / truth_pos if truth_pos else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        if f1 > best_f1:
            best_f1 = f1
            best_t = t
    return best_t, max(best_f1, 0.0)


def abstain_at_alpha(scores: list[float], allowed: list[bool], labels: list[bool], alpha: float) -> dict:
    """Max share of pairs committed to a link while false-merge rate <= alpha."""
    n = len(scores)
    order = sorted(range(n), key=lambda k: scores[k], reverse=True)
    best = {"alpha": alpha, "coverage": 0.0, "achievedFalseMergeRate": 0.0,
            "threshold": None, "predictedPositivePairs": 0, "truePositivePairs": 0}
    tp = fp = 0
    idx = 0
    while idx < n:
        t = scores[order[idx]]
        while idx < n and scores[order[idx]] == t:
            k = order[idx]
            if allowed[k]:
                if labels[k]:
                    tp += 1
                else:
                    fp += 1
            idx += 1
        pred_pos = tp + fp
        if pred_pos == 0:
            continue
        fmr = fp / pred_pos
        coverage = pred_pos / n if n else 0.0
        if fmr <= alpha and coverage > best["coverage"]:
            best = {
                "alpha": alpha,
                "coverage": coverage,
                "achievedFalseMergeRate": fmr,
                "threshold": t,
                "predictedPositivePairs": pred_pos,
                "truePositivePairs": tp,
            }
    return best


def bootstrap_f1_ci(pairs: list[dict], preds: list[bool], resamples: int, seed: int) -> list[float] | None:
    if resamples <= 0 or not pairs:
        return None
    rng = random.Random(seed)
    n = len(pairs)
    values = []
    for _ in range(resamples):
        idx = [rng.randrange(n) for _ in range(n)]
        tp = fp = fn = 0
        for k in idx:
            pred = preds[k]
            label = pairs[k]["label"]
            if pred and label:
                tp += 1
            elif pred and not label:
                fp += 1
            elif not pred and label:
                fn += 1
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        values.append((2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0)
    values.sort()
    lo = values[int(0.025 * (len(values) - 1))]
    hi = values[int(0.975 * (len(values) - 1))]
    return [lo, hi]


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------

def run_bm25(docs: list[dict], pairs: list[dict], seed: int, resamples: int) -> tuple[dict, object]:
    t0 = time.perf_counter()
    token_docs = [tokenize(d["text"]) for d in docs]
    df: dict[str, int] = {}
    for toks in token_docs:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    n = len(docs)
    avg_len = sum(len(t) for t in token_docs) / n if n else 0.0
    idf = {t: math.log((n - c + 0.5) / (c + 0.5) + 1.0) for t, c in df.items()}
    k1, b = 1.2, 0.75
    index_bytes = len(json.dumps({"df": df, "lens": [len(t) for t in token_docs]}))

    def score_pair(i: int, j: int) -> float:
        def one(query: list[str], doc: list[str]) -> float:
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
                s += idf.get(term, 0.0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avg_len))
            return s
        return 0.5 * (one(token_docs[i], token_docs[j]) + one(token_docs[j], token_docs[i]))

    scores = []
    for p in pairs:
        scores.append(score_pair(p["i"], p["j"]))
    latency = (time.perf_counter() - t0) * 1000.0 / max(1, len(pairs))
    meta = {
        "status": "ran",
        "modelId": "in-repo BM25 (k1=1.2, b=0.75)",
        "modelDigest": None,
        "license": "MIT",
        "artifactBytes": index_bytes,
        "artifactMB": index_bytes / (1024 * 1024),
        "latencyMsPerPair": latency,
        "fitMs": (time.perf_counter() - t0) * 1000.0,
        "thresholdSelection": "max-F1 sweep on evaluation pairs (in-sample; disclosed)",
        "notes": "Query terms of one document scored against the other, symmetrized by the mean.",
    }
    return meta, scores


def _load_static_embedder(snap: Path):
    config = json.loads((snap / "config.json").read_text(encoding="utf-8"))
    normalize = bool(config.get("normalize", True))
    try:
        from model2vec import StaticModel  # type: ignore
        model = StaticModel.from_pretrained(str(snap))

        def embed(text: str) -> list[float]:
            vec = model.encode([text])[0]
            return [float(x) for x in vec]

        return embed, "model2vec package"
    except Exception:
        pass
    if importlib.util.find_spec("safetensors") is None or importlib.util.find_spec("tokenizers") is None:
        raise Unavailable("runtime_missing", "model2vec package absent and safetensors/tokenizers not installed")
    from safetensors.numpy import load_file  # type: ignore
    from tokenizers import Tokenizer  # type: ignore
    weights = load_file(str(snap / "model.safetensors"))
    table = weights.get("embeddings")
    if table is None:
        table = weights[sorted(weights)[0]]
    tok = Tokenizer.from_file(str(snap / "tokenizer.json"))

    def embed(text: str) -> list[float]:
        ids = tok.encode(text).ids
        if not ids:
            return [0.0] * int(table.shape[1])
        vec = table[ids].mean(axis=0)
        if normalize:
            norm = float((vec * vec).sum()) ** 0.5
            if norm > 0:
                vec = vec / norm
        return [float(x) for x in vec]

    return embed, "manual safetensors mean-pooling (model2vec package absent)"


def run_static_threshold(docs: list[dict], pairs: list[dict], repo_id: str, seed: int, resamples: int) -> tuple[dict, object]:
    snap = require_snapshot(repo_id)
    t0 = time.perf_counter()
    try:
        embed, impl = _load_static_embedder(snap)
    except Unavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise Unavailable("runtime_error", f"{type(exc).__name__}: {exc}") from exc
    vectors = [embed(d["text"]) for d in docs]
    fit_ms = (time.perf_counter() - t0) * 1000.0
    scores = []
    t1 = time.perf_counter()
    for p in pairs:
        scores.append(cosine_dense(vectors[p["i"]], vectors[p["j"]]))
    latency = (time.perf_counter() - t1) * 1000.0 / max(1, len(pairs))
    return {
        "status": "ran",
        "modelId": repo_id,
        "modelDigest": digest_paths(_files_without_weights(snap) + [weight_path(snap)]),
        "license": "MIT",
        "artifactBytes": _artifact_bytes(snap),
        "artifactMB": _artifact_bytes(snap) / (1024 * 1024),
        "latencyMsPerPair": latency,
        "fitMs": fit_ms,
        "thresholdSelection": "max-F1 sweep on evaluation pairs (in-sample; disclosed)",
        "notes": f"Static embedding mean-pooled and cosine scored; loader = {impl}.",
    }, scores


def run_minilm(docs: list[dict], pairs: list[dict], repo_id: str, seed: int, resamples: int) -> tuple[dict, object]:
    snap = require_snapshot(repo_id)
    if importlib.util.find_spec("sentence_transformers") is None:
        raise Unavailable("runtime_missing", "sentence_transformers is not installed")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    t0 = time.perf_counter()
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        model = SentenceTransformer(str(snap), local_files_only=True)
        vectors = model.encode([d["text"] for d in docs], normalize_embeddings=True, show_progress_bar=False)
        vectors = [[float(x) for x in row] for row in vectors]
    except Exception as exc:  # noqa: BLE001
        raise Unavailable("runtime_error", f"{type(exc).__name__}: {exc}") from exc
    fit_ms = (time.perf_counter() - t0) * 1000.0
    scores = []
    t1 = time.perf_counter()
    for p in pairs:
        scores.append(cosine_dense(vectors[p["i"]], vectors[p["j"]]))
    latency = (time.perf_counter() - t1) * 1000.0 / max(1, len(pairs))
    return {
        "status": "ran",
        "modelId": repo_id,
        "modelDigest": digest_paths(_files_without_weights(snap) + [weight_path(snap)]),
        "license": "Apache-2.0",
        "artifactBytes": _artifact_bytes(snap),
        "artifactMB": _artifact_bytes(snap) / (1024 * 1024),
        "latencyMsPerPair": latency,
        "fitMs": fit_ms,
        "thresholdSelection": "max-F1 sweep on evaluation pairs (in-sample; disclosed)",
        "notes": "Sentence embedding cosine; normalized embeddings.",
    }, scores


def run_bertopic_style(docs: list[dict], pairs: list[dict], seed: int, resamples: int) -> tuple[dict, object]:
    if importlib.util.find_spec("sklearn") is None:
        raise Unavailable("runtime_missing", "scikit-learn is not installed")
    import numpy as np  # type: ignore
    from sklearn.cluster import KMeans  # type: ignore
    from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore

    t0 = time.perf_counter()
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)
    matrix = vectorizer.fit_transform([d["text"] for d in docs])
    k = max(2, min(len(docs), int(round(math.sqrt(len(docs) / 2.0)))))
    km = KMeans(n_clusters=k, n_init=10, random_state=seed)
    cluster = km.fit_predict(matrix)
    # c-TF-IDF: per-cluster term frequencies against the global term frequency.
    vocab = vectorizer.get_feature_names_out()
    cluster_sizes = np.bincount(cluster, minlength=k).astype(float)
    c_tf = np.zeros((k, len(vocab)))
    for c in range(k):
        members = matrix[cluster == c]
        c_tf[c] = np.asarray(members.sum(axis=0)).ravel()
    global_tf = np.asarray(matrix.sum(axis=0)).ravel() + 1.0
    c_tf_idf = (c_tf / np.maximum(cluster_sizes[:, None], 1.0)) * np.log(1.0 + global_tf)
    del vocab, c_tf_idf  # labels are computed for parity; not persisted
    fit_ms = (time.perf_counter() - t0) * 1000.0

    dense = matrix.toarray()
    cluster_of = [int(c) for c in cluster]
    allowed = [cluster_of[p["i"]] == cluster_of[p["j"]] for p in pairs]
    t1 = time.perf_counter()
    scores = []
    for p in pairs:
        scores.append(cosine_dense(list(dense[p["i"]]), list(dense[p["j"]])))
    latency = (time.perf_counter() - t1) * 1000.0 / max(1, len(pairs))
    artifact_bytes = int(matrix.data.nbytes + matrix.indices.nbytes + matrix.indptr.nbytes + km.cluster_centers_.nbytes)
    return {
        "status": "ran",
        "modelId": "in-repo BERTopic-style (TF-IDF + KMeans + c-TF-IDF)",
        "modelDigest": None,
        "license": "MIT",
        "artifactBytes": artifact_bytes,
        "artifactMB": artifact_bytes / (1024 * 1024),
        "latencyMsPerPair": latency,
        "fitMs": fit_ms,
        "thresholdSelection": "cluster membership plus cosine sweep on evaluation pairs (in-sample; disclosed)",
        "clusterCount": k,
        "notes": "Topic count heuristic k=round(sqrt(n/2)); links require shared cluster and score >= threshold.",
    }, {"scores": scores, "allowed": allowed, "cluster_of": cluster_of}


def run_llm_judge(docs: list[dict], pairs: list[dict], repo_id: str, max_pairs: int, seed: int, resamples: int, disabled: bool) -> tuple[dict, object]:
    if disabled:
        raise Unavailable("disabled_by_flag", "local LLM judge disabled by --no-judge")
    if importlib.util.find_spec("transformers") is None or importlib.util.find_spec("torch") is None:
        raise Unavailable("runtime_missing", "transformers/torch not installed")
    snap = require_snapshot(repo_id)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    t0 = time.perf_counter()
    try:
        import torch  # type: ignore
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        tok = AutoTokenizer.from_pretrained(str(snap), local_files_only=True)
        model = AutoModelForCausalLM.from_pretrained(str(snap), local_files_only=True, dtype=torch.float32)
        model.eval()
    except Exception as exc:  # noqa: BLE001
        raise Unavailable("runtime_error", f"{type(exc).__name__}: {exc}") from exc

    rng = random.Random(seed)
    positives = [k for k, p in enumerate(pairs) if p["label"]]
    negatives = [k for k, p in enumerate(pairs) if not p["label"]]
    rng.shuffle(positives)
    rng.shuffle(negatives)
    half = max_pairs // 2
    sample = positives[:half] + negatives[: max_pairs - half]
    sample.sort()

    def judge(a: dict, b: dict) -> tuple[float, str]:
        prompt = (
            "You compare two workplace passages. Decide whether they express the same "
            "subject or theme, ignoring names and departments. Answer with one word: yes or no.\n\n"
            f"Passage A: {a['text']}\n\nPassage B: {b['text']}\n\nAnswer:"
        )
        messages = [{"role": "user", "content": prompt}]
        text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tok(text, return_tensors="pt", truncation=True, max_length=512)
        with torch.inference_mode():
            out = model.generate(**inputs, max_new_tokens=3, do_sample=False, pad_token_id=tok.eos_token_id)
        gen = tok.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip().lower()
        if gen.startswith("yes"):
            return 1.0, gen
        if gen.startswith("no"):
            return 0.0, gen
        return 0.5, gen

    scores = []
    t1 = time.perf_counter()
    for k in sample:
        p = pairs[k]
        score, _ = judge(docs[p["i"]], docs[p["j"]])
        scores.append(score)
    latency = (time.perf_counter() - t1) * 1000.0 / max(1, len(sample))
    sampled_pairs = [pairs[k] for k in sample]
    return {
        "status": "ran",
        "sampled": True,
        "evaluatedPairs": len(sample),
        "modelId": repo_id,
        "modelDigest": digest_paths(_files_without_weights(snap) + [weight_path(snap)]),
        "license": "Apache-2.0",
        "artifactBytes": _artifact_bytes(snap),
        "artifactMB": _artifact_bytes(snap) / (1024 * 1024),
        "latencyMsPerPair": latency,
        "fitMs": (time.perf_counter() - t0) * 1000.0,
        "thresholdSelection": "fixed 0.5 on greedy yes/no output; no threshold tuning",
        "notes": "Upper reference on a seeded stratified pair sample; not a full-estate score.",
    }, {"scores": scores, "pairs": sampled_pairs}


# ---------------------------------------------------------------------------
# Evaluation plumbing
# ---------------------------------------------------------------------------

def evaluate_scores(docs: list[dict], pairs: list[dict], scores: list[float], allowed: list[bool],
                    resamples: int, seed: int, sampled: bool = False) -> dict:
    labels = [p["label"] for p in pairs]
    threshold, _ = select_threshold(scores, allowed, labels)
    preds = [allowed[k] and scores[k] >= threshold for k in range(len(pairs))]

    pairwise = pair_metrics(pairs, preds)
    buckets = {}
    for name in ("cross_department", "cross_modality", "identity_overlap", "identity_disjoint"):
        idx = [k for k, p in enumerate(pairs) if p[name]]
        buckets[name] = pair_metrics([pairs[k] for k in idx], [preds[k] for k in idx])

    splits = {"leave_one_department_out": {}, "leave_one_modality_out": {}}
    for dept in sorted({d["department"] for d in docs}):
        idx = [k for k, p in enumerate(pairs) if docs[p["i"]]["department"] == dept or docs[p["j"]]["department"] == dept]
        splits["leave_one_department_out"][dept] = pair_metrics([pairs[k] for k in idx], [preds[k] for k in idx])
    for modality in sorted({d["modality"] for d in docs}):
        idx = [k for k, p in enumerate(pairs) if docs[p["i"]]["modality"] == modality or docs[p["j"]]["modality"] == modality]
        splits["leave_one_modality_out"][modality] = pair_metrics([pairs[k] for k in idx], [preds[k] for k in idx])

    abstain = []
    for alpha in ALPHAS:
        abstain.append(abstain_at_alpha(scores, allowed, labels, alpha))

    result = {
        "threshold": threshold,
        "pairwise": pairwise,
        "pairwiseF1CI95": bootstrap_f1_ci(pairs, preds, resamples, seed),
        "falseMerge": {
            "count": pairwise["falsePositivePairs"],
            "rate": (pairwise["falsePositivePairs"] / pairwise["predictedPositivePairs"])
            if pairwise["predictedPositivePairs"] else 0.0,
            "predictedPositivePairs": pairwise["predictedPositivePairs"],
        },
        "abstainAtTargetError": abstain,
        "buckets": buckets,
        "splits": splits,
        "evaluatedPairs": len(pairs),
    }

    if sampled:
        result["bCubed"] = None
        result["conllStyle"] = None
        result["blastRadius"] = None
        result["notes"] = "Cluster metrics omitted on a sampled pair set."
        return result

    edges = [(pairs[k]["i"], pairs[k]["j"]) for k in range(len(pairs)) if preds[k]]
    comps = _components(len(docs), edges)
    truth = [d["theme"] for d in docs]
    conll_preds = [comps[p["i"]] == comps[p["j"]] for p in pairs]
    result["bCubed"] = b_cubed(comps, truth)
    result["conllStyle"] = pair_metrics(pairs, conll_preds)
    result["blastRadius"] = blast_radius(comps, truth)
    return result


def run_source(docs: list[dict], args, seed: int) -> dict:
    pairs = build_pairs(docs)
    baselines: dict[str, dict] = {}

    def record(name: str, fn):
        try:
            meta, payload = fn()
        except Unavailable as exc:
            baselines[name] = {
                "status": "unavailable",
                "unavailableReason": exc.reason,
                "detail": exc.detail,
                "license": None,
                "modelDigest": None,
                "seed": seed,
                "resamples": args.resamples,
                "resampleSeed": seed,
            }
            return
        if isinstance(payload, dict) and "scores" in payload:
            scores = payload["scores"]
            allowed = payload.get("allowed", [True] * len(pairs))
            eval_pairs = payload.get("pairs", pairs)
        else:
            scores = payload
            allowed = [True] * len(pairs)
            eval_pairs = pairs
        meta = dict(meta)
        meta.update(evaluate_scores(
            docs, eval_pairs, scores, allowed,
            args.resamples, seed, sampled=bool(meta.get("sampled")),
        ))
        meta["seed"] = seed
        meta["resamples"] = args.resamples
        meta["resampleSeed"] = seed
        baselines[name] = meta

    record("bm25", lambda: run_bm25(docs, pairs, seed, args.resamples))
    record("model2vec_static_threshold", lambda: run_static_threshold(docs, pairs, args.static_model, seed, args.resamples))
    record("minilm_l6_cosine", lambda: run_minilm(docs, pairs, args.minilm_model, seed, args.resamples))
    record("bertopic_style", lambda: run_bertopic_style(docs, pairs, seed, args.resamples))
    record("local_llm_judge", lambda: run_llm_judge(
        docs, pairs, args.judge_model, args.judge_max_pairs, seed, args.resamples, args.no_judge))

    return {
        "documents": len(docs),
        "pairs": len(pairs),
        "themes": len({d["theme"] for d in docs}),
        "baselines": baselines,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Weft theme-linking baseline shootout")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "results" / "weft-baselines.json"))
    parser.add_argument("--seed", type=int, default=20261127)
    parser.add_argument("--fixture", action="store_true", help="small deterministic estate for contract tests")
    parser.add_argument("--resamples", type=int, default=1000)
    parser.add_argument("--static-model", default="minishlab/potion-base-32M")
    parser.add_argument("--minilm-model", default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--judge-model", default="Qwen/Qwen2.5-0.5B-Instruct")
    parser.add_argument("--judge-max-pairs", type=int, default=24)
    parser.add_argument("--no-judge", action="store_true", help="record the judge as disabled_by_flag")
    parser.add_argument("--public-slices", default=os.environ.get("WEFT_PUBLIC_SLICES", ""),
                        help="directory of uCDCR-style *.jsonl slices (optional; fail closed when absent)")
    args = parser.parse_args(argv)

    if args.fixture:
        args.resamples = min(args.resamples, 100)
        args.judge_max_pairs = min(args.judge_max_pairs, 4)

    out = Path(args.out).resolve()
    seed = args.seed

    estate = build_synthetic_estate(seed, args.fixture)
    sources = {"synthetic": {"status": "ran", **run_source(estate["documents"], args, seed)}}

    public_path = Path(args.public_slices) if args.public_slices else None
    if public_path is None or not public_path.is_dir():
        sources["public_cdcr"] = {
            "status": "unavailable",
            "unavailableReason": "public_slices_not_local",
            "detail": "no --public-slices directory and WEFT_PUBLIC_SLICES is unset; public WEC-Eng/ECB+ uCDCR slices are optional",
        }
    else:
        try:
            public_docs = _public_docs(public_path)
            sources["public_cdcr"] = {"status": "ran", **run_source(public_docs, args, seed)}
        except Unavailable as exc:
            sources["public_cdcr"] = {
                "status": "unavailable",
                "unavailableReason": exc.reason,
                "detail": exc.detail,
            }

    script_path = Path(__file__).resolve()
    entry = {
        "harness": {
            "kind": "weft-baseline-shootout",
            "schemaVersion": SCHEMA_VERSION,
            "scriptDigest": hashlib.sha256(script_path.read_bytes()).hexdigest(),
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "estate": {k: v for k, v in estate.items() if k != "documents"},
        "config": {
            "seed": seed,
            "fixture": bool(args.fixture),
            "resamples": args.resamples,
            "resampleSeed": seed,
            "alphas": list(ALPHAS),
            "buckets": ["cross_department", "cross_modality", "identity_overlap", "identity_disjoint"],
            "splits": ["leave_one_department_out", "leave_one_modality_out"],
            "thresholdSelection": "per-baseline max-F1 sweep on the evaluation pairs (in-sample; disclosed in each baseline)",
            "publicSlices": str(public_path) if public_path else None,
        },
        "sources": sources,
    }
    digest = hashlib.sha256(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    entry = {"runId": digest, **entry}

    artifact = {"kind": "weft-baselines", "schemaVersion": SCHEMA_VERSION, "appendOnly": True, "entries": []}
    if out.exists():
        prior = json.loads(out.read_text(encoding="utf-8"))
        if prior.get("kind") != artifact["kind"] or prior.get("appendOnly") is not True:
            raise SystemExit(f"refusing to overwrite incompatible artifact: {out}")
        artifact["entries"] = prior.get("entries", [])
    artifact["entries"].append(entry)

    payload = json.dumps(artifact, indent=2, sort_keys=False)
    for word in _BANNED:
        if word in payload.lower():
            raise SystemExit(f"banned word present in artifact: {word}")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + f".tmp-{os.getpid()}")
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, out)

    summary = {
        "out": str(out),
        "runId": digest,
        "entries": len(artifact["entries"]),
        "synthetic": {
            name: (b.get("status"), b.get("unavailableReason"))
            for name, b in sources["synthetic"]["baselines"].items()
        },
        "public_cdcr": sources["public_cdcr"].get("status"),
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
