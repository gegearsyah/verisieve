#!/usr/bin/env python3
"""scripts/run-cpa-attacker-audit.py

T11 (#38 / #27 User Story 15): Attacker-Based Conformal Privacy Audit (`CPA` Protocol).

Implements an adversary-aware re-identification audit following Conformal Privacy Auditing
(`CPA`, `arXiv:2609.21340`), motivated by LLM attribute/identity inference attacks on scrubbed
text (Lukas et al., IEEE S&P 2023, `arXiv:2302.00539`; Staab et al., ICLR 2024, `arXiv:2310.07298`).

Protocol:
  1. Calibrates Versieve's Document-Clustered Conformal Risk Control gate (`HC-CRC`,
     `src/gatekeeper.js`) on `echr_dev` (60 train / 67 calibration rulings) over Versieve
     Stage 3A WASM + local Apache-2.0 `GLiNER-PII-Edge` ONNX + `SR-MP` redacted text,
     then partitions held-out `echr_test` (127 rulings, 1,999 paragraphs) into:
       - `released` (`KEEP`, auto-released by `HC-CRC`)
       - `withheld` (`ABSTAIN` / `DROP`, routed to human review by `HC-CRC`).
  2. Constructs K-candidate auxiliary-knowledge entity dossiers (1 true ruling subject dossier
     + K-1 decoy subject dossiers carrying quasi-identifiers: locations, dates, organizations,
     demographics/roles) for each audited redacted excerpt.
  3. Evaluates a local auxiliary-knowledge LLM attacker (`Ollama qwen2.5:7b` at localhost:11434)
     producing probability distributions over the K candidates.
  4. Calibrates the CPA conformal nonconformity quantile q_hat at miscoverage beta=0.10 on a
     disjoint calibration fold (`echr_dev` calibration rulings) and evaluates on held-out
     `echr_test` `released` vs `withheld` excerpts:
       - Empirical top-1 re-identification rate + Clopper-Pearson & 1,000-bootstrap 95% CIs
       - Conformal ambiguity-set size |C_adv(x)| + 1,000-bootstrap 95% CIs
       - Singleton singling-out rate P(|C_adv(x)| <= 1)
       - Fisher's exact test, unpaired permutation test, and within-ruling paired McNemar /
         paired permutation test comparing `released` (`KEEP`) vs `withheld` (`ABSTAIN`/`DROP`).

Supports `--dry-run` on synthetic/fixture inputs for CPU-only CI contract tests, and fails
closed (exit code 2) when Ollama `qwen2.5:7b`, TAB ECHR splits, or ONNX runtimes are missing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_PATH = REPO_ROOT / "results" / "t11-cpa-attacker-audit.json"
DEFAULT_WORK_DIR = Path(os.environ.get("T11_CPA_WORK_DIR", "D:/rtio-t11-cpa"))
ECHR_CASE_RX = re.compile(r"\b\d{3,6}/\d{2}\b")


def fail_closed(error_code: str, message: str, missing: list[str] | None = None, exit_code: int = 2) -> None:
    payload = {
        "ok": False,
        "errorCode": error_code,
        "message": message,
        "missingRuntimes": missing or [],
    }
    print(json.dumps(payload, indent=2), file=sys.stderr)
    sys.exit(exit_code)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_git_common_repo() -> Path:
    try:
        raw = subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=str(REPO_ROOT),
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        p = Path(raw)
        if not p.is_absolute():
            p = (REPO_ROOT / p).resolve()
        return p.resolve().parent
    except Exception:
        return REPO_ROOT


def resolve_default_tab_dir() -> Path:
    if os.environ.get("VERSIEVE_TAB_DIR"):
        return Path(os.environ["VERSIEVE_TAB_DIR"])
    local = REPO_ROOT / "results" / "untrusted-benchmarks" / "reviewer-hardening"
    if (local / "echr_test.json").exists():
        return local
    return resolve_git_common_repo() / "results" / "untrusted-benchmarks" / "reviewer-hardening"


def resolve_default_gliner_dir() -> Path:
    if os.environ.get("VERSIEVE_GLINER_MODEL_DIR"):
        return Path(os.environ["VERSIEVE_GLINER_MODEL_DIR"])
    local = REPO_ROOT / "results" / "untrusted-benchmarks" / "track-e-public" / "models" / "gliner-pii-edge"
    if local.exists():
        return local
    return resolve_git_common_repo() / "results" / "untrusted-benchmarks" / "track-e-public" / "models" / "gliner-pii-edge"


def discover_onnx_python(explicit_python: str | None) -> str | None:
    candidates: list[str] = []
    if explicit_python:
        candidates.append(explicit_python)
    if os.environ.get("VERSIEVE_ONNX_PYTHON"):
        candidates.append(os.environ["VERSIEVE_ONNX_PYTHON"])
    candidates.append(sys.executable)
    which_py = shutil.which("python")
    if which_py:
        candidates.append(which_py)
    std_py = Path("/Python312/python.exe")
    if std_py.exists():
        candidates.append(str(std_py))
    seen: set[str] = set()
    for cand in candidates:
        norm = str(Path(cand))
        if norm in seen or not Path(cand).exists():
            continue
        seen.add(norm)
        try:
            proc = subprocess.run(
                [cand, "-c", "import onnxruntime, tokenizers, numpy; print('OK')"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if proc.returncode == 0 and "OK" in proc.stdout:
                return cand
        except Exception:
            continue
    return None


def verify_ollama_attacker(model_name: str, base_url: str) -> dict[str, Any]:
    req = urllib.request.Request(f"{base_url.rstrip('/')}/api/tags")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        fail_closed(
            "OLLAMA_UNREACHABLE",
            f"Ollama endpoint {base_url}/api/tags unreachable: {exc}",
            ["ollama", model_name],
        )
    installed = {m.get("name"): m for m in payload.get("models", [])}
    if model_name not in installed:
        fail_closed(
            "MISSING_ATTACKER_MODEL",
            f"Required Ollama attacker model '{model_name}' not installed (found: {sorted(installed)})",
            [model_name],
        )
    info = installed[model_name]
    details = info.get("details") or {}
    return {
        "modelName": model_name,
        "digest": info.get("digest"),
        "sizeBytes": info.get("size"),
        "parameterSize": details.get("parameter_size"),
        "quantizationLevel": details.get("quantization_level"),
        "license": "Apache-2.0",
    }


def unload_ollama_model(model_name: str, base_url: str) -> None:
    payload = json.dumps({"model": model_name, "keep_alive": 0, "messages": []}).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception:
        pass


# ---- Exact Statistical Helpers (Clopper-Pearson, Bootstrap, Fisher Exact, McNemar, Permutation) ----
def _binom_cdf(k: int, n: int, p: float) -> float:
    if k >= n:
        return 1.0
    if k < 0:
        return 0.0
    if p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 0.0
    total = 0.0
    lp = math.log(p)
    lq = math.log(1.0 - p)
    for i in range(k + 1):
        lt = math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq
        total += math.exp(lt)
    return min(1.0, max(0.0, total))


def _solve_binom_p(k: int, n: int, target: float) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(120):
        mid = 0.5 * (lo + hi)
        if _binom_cdf(k, n, mid) > target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def clopper_pearson_ci95_pct(k: int, n: int) -> list[float]:
    if n <= 0:
        return [0.0, 0.0]
    lo = 0.0 if k <= 0 else _solve_binom_p(k - 1, n, 0.975)
    hi = 1.0 if k >= n else _solve_binom_p(k, n, 0.025)
    return [round(100.0 * lo, 2), round(100.0 * hi, 2)]


def bootstrap_mean_ci95(values: list[float], scale: float = 1.0, n_boot: int = 1000, seed: int = 42) -> list[float]:
    if not values:
        return [0.0, 0.0]
    rng = random.Random(seed)
    n = len(values)
    means = []
    for _ in range(n_boot):
        s = sum(values[rng.randrange(n)] for _ in range(n)) / n
        means.append(s * scale)
    means.sort()
    return [round(means[int(0.025 * n_boot)], 2), round(means[int(0.975 * n_boot)], 2)]


def bootstrap_diff_ci95(
    vals_a: list[float],
    vals_b: list[float],
    scale: float = 1.0,
    n_boot: int = 1000,
    seed: int = 42,
) -> list[float]:
    if not vals_a or not vals_b:
        return [0.0, 0.0]
    rng = random.Random(seed)
    na, nb = len(vals_a), len(vals_b)
    diffs = []
    for _ in range(n_boot):
        ma = sum(vals_a[rng.randrange(na)] for _ in range(na)) / na
        mb = sum(vals_b[rng.randrange(nb)] for _ in range(nb)) / nb
        diffs.append((ma - mb) * scale)
    diffs.sort()
    return [round(diffs[int(0.025 * n_boot)], 2), round(diffs[int(0.975 * n_boot)], 2)]


def fisher_exact_2x2(a: int, b: int, c: int, d: int) -> dict[str, Any]:
    """Exact Fisher test for [[a, b], [c, d]] where row 0 = released (reID, not), row 1 = withheld (reID, not)."""
    r1 = a + b
    r2 = c + d
    c1 = a + c
    n = r1 + r2
    if n == 0:
        return {"oddsRatio": None, "pValueTwoSided": 1.0, "pValueReleasedLessThanWithheld": 1.0}

    def log_hypergeom(x: int) -> float:
        return (
            math.lgamma(r1 + 1) - math.lgamma(x + 1) - math.lgamma(r1 - x + 1)
            + math.lgamma(r2 + 1) - math.lgamma(c1 - x + 1) - math.lgamma(r2 - (c1 - x) + 1)
            - (math.lgamma(n + 1) - math.lgamma(c1 + 1) - math.lgamma(n - c1 + 1))
        )

    xmin = max(0, c1 - r2)
    xmax = min(r1, c1)
    obs_lp = log_hypergeom(a)
    p_two = 0.0
    p_less = 0.0
    for x in range(xmin, xmax + 1):
        lp = log_hypergeom(x)
        p = math.exp(lp)
        if lp <= obs_lp + 1e-12:
            p_two += p
        if x <= a:
            p_less += p

    # Haldane-Anscombe continuity adjustment if a cell is 0
    if b == 0 or c == 0:
        odds_ratio = ((a + 0.5) * (d + 0.5)) / ((b + 0.5) * (c + 0.5))
    else:
        odds_ratio = (a * d) / (b * c)
    return {
        "contingency2x2": [[a, b], [c, d]],
        "oddsRatio": round(odds_ratio, 4),
        "pValueTwoSided": round(min(1.0, p_two), 6),
        "pValueReleasedLessThanWithheld": round(min(1.0, p_less), 6),
    }


def unpaired_permutation_test(vals_a: list[float], vals_b: list[float], n_perm: int = 5000, seed: int = 42) -> dict[str, Any]:
    if not vals_a or not vals_b:
        return {"meanDiff": 0.0, "pValue": 1.0, "nPerm": n_perm}
    na = len(vals_a)
    pooled = list(vals_a) + list(vals_b)
    obs = (sum(vals_a) / na) - (sum(vals_b) / len(vals_b))
    rng = random.Random(seed)
    ge = 0
    total_sum = sum(pooled)
    nb = len(vals_b)
    for _ in range(n_perm):
        sub_a = rng.sample(pooled, na)
        sa = sum(sub_a)
        diff = (sa / na) - ((total_sum - sa) / nb)
        if abs(diff) >= abs(obs) - 1e-12:
            ge += 1
    return {
        "meanDiff": round(obs, 4),
        "pValue": round((ge + 1) / (n_perm + 1), 6),
        "nPerm": n_perm,
    }


def paired_permutation_and_mcnemar(pairs: list[tuple[dict[str, Any], dict[str, Any]]], n_perm: int = 5000, seed: int = 42) -> dict[str, Any]:
    """Within-ruling paired comparison: (released_row, withheld_row) from the same ruling."""
    if not pairs:
        return {"nPairs": 0}
    rel_only = sum(1 for r, w in pairs if r["top1Hit"] and not w["top1Hit"])
    wit_only = sum(1 for r, w in pairs if not r["top1Hit"] and w["top1Hit"])
    disc = rel_only + wit_only
    mcn_p = 1.0 if disc == 0 else min(1.0, 2.0 * _binom_cdf(min(rel_only, wit_only), disc, 0.5))

    size_diffs = [float(r["ambiguitySetSize"]) - float(w["ambiguitySetSize"]) for r, w in pairs]
    obs = sum(size_diffs) / len(size_diffs)
    rng = random.Random(seed)
    ge = 0
    for _ in range(n_perm):
        s = sum(d if rng.random() < 0.5 else -d for d in size_diffs) / len(size_diffs)
        if abs(s) >= abs(obs) - 1e-12:
            ge += 1
    return {
        "nPairs": len(pairs),
        "releasedTop1Pct": round(100.0 * sum(1 for r, _ in pairs if r["top1Hit"]) / len(pairs), 2),
        "withheldTop1Pct": round(100.0 * sum(1 for _, w in pairs if w["top1Hit"]) / len(pairs), 2),
        "releasedOnlyReId": rel_only,
        "withheldOnlyReId": wit_only,
        "mcnemarTwoSidedPValue": round(mcn_p, 6),
        "releasedMeanAmbiguitySetSize": round(sum(float(r["ambiguitySetSize"]) for r, _ in pairs) / len(pairs), 3),
        "withheldMeanAmbiguitySetSize": round(sum(float(w["ambiguitySetSize"]) for _, w in pairs) / len(pairs), 3),
        "ambiguitySetMeanDiff": round(obs, 3),
        "pairedAmbiguityPermutationPValue": round((ge + 1) / (n_perm + 1), 6),
    }


# ---- TAB ECHR Dossier Extraction, Redaction & HC-CRC Gate Partition ----
def load_tab_docs(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    docs = []
    for d in raw:
        ann = next(iter(d["annotations"].values()))
        docs.append({
            "doc_id": d["doc_id"],
            "text": d["text"],
            "mentions": ann["entity_mentions"],
        })
    return docs


def spans_overlap(a_s: int, a_e: int, b_s: int, b_e: int) -> bool:
    return a_s < b_e and b_s < a_e


def dedupe_spans(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not spans:
        return []
    ordered = sorted(spans, key=lambda s: (int(s["start"]), -(int(s["end"]) - int(s["start"])), -float(s.get("score", 1.0))))
    out = []
    last_end = -1
    for s in ordered:
        if int(s["start"]) >= last_end:
            out.append(s)
            last_end = int(s["end"])
    return out


def apply_typed_redaction(text: str, doc_spans: list[dict[str, Any]], p_start: int, p_end: int) -> str:
    local_spans = []
    for s in doc_spans:
        if spans_overlap(p_start, p_end, int(s["start"]), int(s["end"])):
            rs = max(0, int(s["start"]) - p_start)
            re_ = min(p_end - p_start, int(s["end"]) - p_start)
            if re_ > rs:
                local_spans.append({"start": rs, "end": re_, "type": str(s.get("type") or s.get("label") or "ENTITY").upper(), "score": float(s.get("score", 1.0))})
    dedup = dedupe_spans(local_spans)
    sub = text[p_start:p_end]
    if not dedup:
        return sub.strip()
    parts = []
    cursor = 0
    for sp in dedup:
        parts.append(sub[cursor : sp["start"]])
        lbl = sp["type"].replace(" ", "_")
        parts.append(f"[{lbl}]")
        cursor = sp["end"]
    parts.append(sub[cursor:])
    return "".join(parts).strip()


def build_ruling_dossier(doc: dict[str, Any]) -> dict[str, Any]:
    """Construct an auxiliary-knowledge subject dossier from human TAB annotations."""
    by_type: dict[str, list[str]] = {"PERSON": [], "LOC": [], "ORG": [], "DATETIME": [], "DEM": [], "MISC": [], "CODE": []}
    for m in doc["mentions"]:
        if m.get("identifier_type") not in ("DIRECT", "QUASI"):
            continue
        etype = str(m.get("entity_type") or "MISC").upper()
        val = re.sub(r"\s+", " ", str(m.get("span_text") or "").strip())
        if len(val) < 2:
            continue
        bucket = by_type.setdefault(etype, [])
        if val.lower() not in {x.lower() for x in bucket}:
            bucket.append(val)

    summary_parts = []
    if by_type["PERSON"]:
        summary_parts.append(f"Subject/Parties: {', '.join(by_type['PERSON'][:3])}")
    if by_type["DEM"]:
        summary_parts.append(f"Profile/Role: {', '.join(by_type['DEM'][:4])}")
    if by_type["LOC"]:
        summary_parts.append(f"Locations: {', '.join(by_type['LOC'][:4])}")
    if by_type["DATETIME"]:
        summary_parts.append(f"Key Dates: {', '.join(by_type['DATETIME'][:4])}")
    if by_type["ORG"]:
        summary_parts.append(f"Institutions: {', '.join(by_type['ORG'][:3])}")
    if by_type["MISC"]:
        summary_parts.append(f"Context Facts: {', '.join(by_type['MISC'][:3])}")
    if not summary_parts:
        summary_parts.append(f"Case Ref: {doc['doc_id']}")
    return {
        "doc_id": doc["doc_id"],
        "summary": " | ".join(summary_parts),
        "quasiCount": sum(1 for m in doc["mentions"] if m.get("identifier_type") == "QUASI"),
        "directCount": sum(1 for m in doc["mentions"] if m.get("identifier_type") == "DIRECT"),
    }


def learn_dev_nomask_filter(dev_docs: list[dict[str, Any]]) -> set[str]:
    nomask_c: Counter = Counter()
    mask_c: Counter = Counter()
    for d in dev_docs:
        for m in d["mentions"]:
            key = re.sub(r"\s+", " ", (m.get("span_text") or "").strip().lower())
            if not key:
                continue
            if m.get("identifier_type") == "NO_MASK":
                nomask_c[key] += 1
            else:
                mask_c[key] += 1
    return {k for k, nm in nomask_c.items() if (nm + mask_c.get(k, 0)) >= 2 and nm / (nm + mask_c.get(k, 0)) >= 0.80}


def filter_nomask_spans(text: str, spans: list[dict[str, Any]], nomask_set: set[str]) -> list[dict[str, Any]]:
    kept = []
    for s in spans:
        surf = re.sub(r"\s+", " ", text[int(s["start"]) : int(s["end"])].strip().lower())
        if surf in nomask_set or (surf.startswith("the ") and surf[4:] in nomask_set):
            continue
        kept.append(s)
    return kept


def run_gliner_on_tab(docs: list[dict[str, Any]], gliner_dir: Path, onnx_py: str) -> tuple[list[list[dict[str, Any]]], dict[str, Any]]:
    onnx_file = gliner_dir / "onnx" / "model_quint8.onnx"
    tok_file = gliner_dir / "tokenizer.json"
    if not onnx_file.exists() or not tok_file.exists():
        fail_closed("MISSING_GLINER_WEIGHTS", f"Missing GLiNER ONNX weights at {onnx_file}", ["gliner_onnx_weights"])

    helper_code = (
        "import importlib.util, json, pathlib, sys\n"
        "in_p, out_p, mdir, runner_p = sys.argv[1:5]\n"
        "spec = importlib.util.spec_from_file_location('ge', runner_p)\n"
        "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n"
        "mod.LABELS = ['person','date','location','organization','case number','email','phone number','street address']\n"
        "runner = mod.GlinerEdgeOnnxRunner(pathlib.Path(mdir), threshold=0.15)\n"
        "texts = json.loads(pathlib.Path(in_p).read_text(encoding='utf-8'))\n"
        "out = [runner.predict(t)[0] for t in texts]\n"
        "pathlib.Path(out_p).write_text(json.dumps(out), encoding='utf-8')\n"
    )
    with tempfile.TemporaryDirectory(prefix="t11-cpa-gliner-") as tmp:
        hp = Path(tmp) / "gliner_tab.py"
        inp = Path(tmp) / "in.json"
        outp = Path(tmp) / "out.json"
        hp.write_text(helper_code, encoding="utf-8")
        inp.write_text(json.dumps([d["text"] for d in docs]), encoding="utf-8")
        runner_p = REPO_ROOT / "scripts" / "run-track-e-gliner-benchmark.py"
        proc = subprocess.run(
            [onnx_py, str(hp), str(inp), str(outp), str(gliner_dir), str(runner_p)],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0 or not outp.exists():
            fail_closed("GLINER_TAB_FAILED", f"GLiNER TAB extraction failed: {proc.stderr.strip()}", ["gliner_onnx"])
        spans = json.loads(outp.read_text(encoding="utf-8"))

    meta = {
        "modelId": "knowledgator/gliner-pii-edge-v1.0",
        "onnxBytes": onnx_file.stat().st_size,
        "onnxSha256": sha256_file(onnx_file),
        "signalThreshold": 0.15,
        "redactionThreshold": 0.30,
        "license": "Apache-2.0",
    }
    return spans, meta


def build_tab_hccrc_partition(dev_docs: list[dict[str, Any]], test_docs: list[dict[str, Any]], gliner_dir: Path, onnx_py: str) -> dict[str, Any]:
    """Run exact Paper D Stage 3A + GLiNER-Edge + SR-MP + HC-CRC calibration on TAB ECHR."""
    nomask = learn_dev_nomask_filter(dev_docs)
    all_docs = dev_docs + test_docs
    gliner_all, gliner_meta = run_gliner_on_tab(all_docs, gliner_dir, onnx_py)

    node_bin = shutil.which("node") or "node"
    with tempfile.TemporaryDirectory(prefix="t11-cpa-node-") as tmp:
        scan_in = Path(tmp) / "scan_in.json"
        scan_out = Path(tmp) / "scan_out.json"
        scan_in.write_text(json.dumps([{"doc_id": d["doc_id"], "text": d["text"]} for d in all_docs]), encoding="utf-8")
        subprocess.run([node_bin, str(REPO_ROOT / "scripts" / "tab-node-helper.mjs"), "scan-docs", str(scan_in), str(scan_out)], check=True)
        scanned = json.loads(scan_out.read_text(encoding="utf-8"))

        filtered_gliner = [filter_nomask_spans(d["text"], sp, nomask) for d, sp in zip(all_docs, gliner_all)]
        srmp_in = Path(tmp) / "srmp_in.json"
        srmp_out = Path(tmp) / "srmp_out.json"
        srmp_in.write_text(
            json.dumps({
                "anchorThr": 0.50,
                "lowThr": 0.15,
                "docs": [{"doc_id": d["doc_id"], "text": d["text"], "allSpans": sp} for d, sp in zip(all_docs, filtered_gliner)],
            }),
            encoding="utf-8",
        )
        subprocess.run([node_bin, str(REPO_ROOT / "scripts" / "tab-node-helper.mjs"), "srmp-tab-couple", str(srmp_in), str(srmp_out)], check=True)
        srmp_coupled = [r["spans"] for r in json.loads(srmp_out.read_text(encoding="utf-8"))]

        paragraphs_all = []
        for idx, d in enumerate(all_docs):
            text = d["text"]
            s3a_struct = [
                {**s, "source": "stage3a"}
                for s in scanned[idx]["stage3a"]
                if s["type"] not in ("NAME_LIKELY", "PERSON", "ADDRESS_LIKELY")
            ]
            case_codes = [
                {"start": m.start(), "end": m.end(), "type": "ECHR_CASE_CODE", "score": 0.95, "source": "stage3a"}
                for m in ECHR_CASE_RX.finditer(text)
            ]
            g_red = [s for s in srmp_coupled[idx] if float(s.get("score", 0.0)) >= 0.30]
            red_spans = g_red + s3a_struct + case_codes
            sig_spans = filtered_gliner[idx]

            gt_mask = [m for m in d["mentions"] if m.get("identifier_type") in ("DIRECT", "QUASI")]
            p_idx = 0
            for m in re.finditer(r"[^\n]{30,}", text):
                p_s, p_e = m.start(), m.end()
                p_txt = m.group(0).strip()
                if len(p_txt) < 30:
                    continue
                gt_in_p = [g for g in gt_mask if spans_overlap(p_s, p_e, g["start_offset"], g["end_offset"])]
                g_in_p = [s for s in sig_spans if spans_overlap(p_s, p_e, int(s["start"]), int(s["end"]))]
                r_in_p = [s for s in red_spans if spans_overlap(p_s, p_e, int(s["start"]), int(s["end"]))]
                max_conf = max((float(s.get("score", 0.0)) for s in g_in_p), default=0.0)
                if r_in_p and max_conf < 0.75 and any(s.get("source") == "stage3a" for s in r_in_p):
                    max_conf = max(max_conf, 0.85)
                mean_conf = sum(float(s.get("score", 0.5)) for s in g_in_p) / len(g_in_p) if g_in_p else 0.0
                residual_unsafe = any(
                    not any(spans_overlap(int(rs["start"]), int(rs["end"]), g["start_offset"], g["end_offset"]) for rs in r_in_p)
                    for g in gt_in_p
                )
                redacted_txt = apply_typed_redaction(text, red_spans, p_s, p_e)
                paragraphs_all.append({
                    "split": "dev" if idx < len(dev_docs) else "test",
                    "doc_idx": idx if idx < len(dev_docs) else idx - len(dev_docs),
                    "doc_id": d["doc_id"],
                    "para_id": f"{d['doc_id']}#p{p_idx}",
                    "text": p_txt,
                    "redactedText": redacted_txt,
                    "unsafe": len(gt_in_p) > 0,
                    "gtSpanCount": len(gt_in_p),
                    "detCount": len(r_in_p),
                    "maxConf": round(max_conf, 4),
                    "meanConf": round(mean_conf, 4),
                    "residualUnsafe": residual_unsafe,
                })
                p_idx += 1

        train_ids = {d["doc_id"] for d in dev_docs[:60]}
        cal_ids = {d["doc_id"] for d in dev_docs[60:]}
        tr_rows = [r for r in paragraphs_all if r["split"] == "dev" and r["doc_id"] in train_ids]
        ca_rows = [r for r in paragraphs_all if r["split"] == "dev" and r["doc_id"] in cal_ids]
        te_rows = [r for r in paragraphs_all if r["split"] == "test"]

        gate_js = r"""
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, inPath, outPath] = process.argv.slice(2);
const { createTokenizer, extractFeatureRow } = await import(pathToFileURL(path.join(repoRoot, 'src', 'clean-and-tokenize.js')).href);
const { trainGatekeeper, calibrateClusterRobustGatekeeper, decideGatekeeper } = await import(pathToFileURL(path.join(repoRoot, 'src', 'gatekeeper.js')).href);

const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const tok = createTokenizer();
const buildFeats = (rows) => rows.map((r) => {
  const txt = r.text || '';
  const enc = tok.encode(txt);
  const feat = extractFeatureRow(
    { text: txt, cleanText: txt, piiCount: Number(r.detCount || 0), piiHits: [], sourceMode: 'tab_echr', confidence: Math.max(0.05, 1.0 - Number(r.maxConf || 0)) },
    enc
  );
  const arr = Array.from(feat);
  arr[512] = Math.min(1.0, Number(r.maxConf || 0));
  arr[513] = Math.min(1.0, Number(r.detCount || 0) / 5.0);
  arr[514] = Number(r.detCount || 0) > 0 ? 1.0 : 0.0;
  arr[515] = Math.min(1.0, Number(r.meanConf || 0));
  return { doc_id: r.doc_id, para_id: r.para_id, features: arr, ySafe: r.unsafe ? 0 : 1 };
});

const tr = buildFeats(payload.train);
const ca = buildFeats(payload.cal);
const te = buildFeats(payload.test);
const bundle = trainGatekeeper(tr.map((x) => x.features), tr.map((x) => x.ySafe), { epochs: 20, lr: 0.30, l2: 1e-4 });

const byCluster = new Map();
for (const it of ca) {
  const prob = decideGatekeeper(bundle, it.features).prob;
  if (!byCluster.has(it.doc_id)) byCluster.set(it.doc_id, []);
  byCluster.get(it.doc_id).push({ prob, labelSafe: it.ySafe });
}
const clusters = Array.from(byCluster.entries()).map(([clusterId, blocks]) => ({ clusterId, blocks }));

const thresholds = {};
for (const alpha of [0.01, 0.05, 0.10]) {
  const res = calibrateClusterRobustGatekeeper({ ...bundle }, clusters, { alpha, delta: 0.05 });
  thresholds[String(alpha)] = res.clusterCalibration;
}
const calProbs = ca.map((x) => ({ para_id: x.para_id, prob: decideGatekeeper(bundle, x.features).prob }));
const testProbs = te.map((x) => ({ para_id: x.para_id, prob: decideGatekeeper(bundle, x.features).prob }));

fs.writeFileSync(outPath, JSON.stringify({ thresholds, calProbs, testProbs }), 'utf8');
"""
        gate_script = Path(tmp) / "run_gate.mjs"
        gate_in = Path(tmp) / "gate_in.json"
        gate_out = Path(tmp) / "gate_out.json"
        gate_script.write_text(gate_js, encoding="utf-8")
        gate_in.write_text(json.dumps({"train": tr_rows, "cal": ca_rows, "test": te_rows}), encoding="utf-8")
        subprocess.run([node_bin, str(gate_script), str(REPO_ROOT), str(gate_in), str(gate_out)], check=True)
        gate_res = json.loads(gate_out.read_text(encoding="utf-8"))

    cal_prob_map = {r["para_id"]: float(r["prob"]) for r in gate_res["calProbs"]}
    test_prob_map = {r["para_id"]: float(r["prob"]) for r in gate_res["testProbs"]}
    tau_005 = float(gate_res["thresholds"]["0.05"]["tauKeep"])

    for r in ca_rows:
        r["safeProb"] = round(cal_prob_map[r["para_id"]], 5)
    for r in te_rows:
        p = test_prob_map[r["para_id"]]
        r["safeProb"] = round(p, 5)
        r["gateVerdictAlpha005"] = "KEEP" if p >= tau_005 else "ABSTAIN"

    return {
        "glinerMeta": gliner_meta,
        "thresholds": gate_res["thresholds"],
        "calRows": ca_rows,
        "testRows": te_rows,
        "devDossiers": {d["doc_id"]: build_ruling_dossier(d) for d in dev_docs[60:]},
        "testDossiers": {d["doc_id"]: build_ruling_dossier(d) for d in test_docs},
    }


# ---- Auxiliary-Knowledge Attacker Prompting & CPA Conformal Ambiguity Sets ----
def build_candidate_challenge(
    row: dict[str, Any],
    dossiers_by_doc: dict[str, dict[str, Any]],
    k_candidates: int,
    seed: int,
) -> dict[str, Any]:
    true_doc = row["doc_id"]
    other_docs = sorted([did for did in dossiers_by_doc if did != true_doc])
    h = int.from_bytes(hashlib.sha256(f"{seed}:{row['para_id']}".encode("utf-8")).digest()[:8], "big")
    rng = random.Random(h)
    decoys = rng.sample(other_docs, min(k_candidates - 1, len(other_docs)))
    pool = [true_doc] + decoys
    rng.shuffle(pool)
    slots = [f"C{i}" for i in range(len(pool))]
    true_slot = slots[pool.index(true_doc)]
    candidates = [
        {"slot": slot, "doc_id": did, "summary": dossiers_by_doc[did]["summary"]}
        for slot, did in zip(slots, pool)
    ]
    return {
        "para_id": row["para_id"],
        "doc_id": true_doc,
        "trueSlot": true_slot,
        "candidates": candidates,
    }


def query_ollama_cpa_attacker(
    redacted_excerpt: str,
    candidates: list[dict[str, Any]],
    model_name: str,
    base_url: str,
    seed: int,
) -> dict[str, float]:
    slots = [c["slot"] for c in candidates]
    cand_lines = "\n".join(f"{c['slot']}: {c['summary']}" for c in candidates)
    prompt = (
        "Below is a redacted legal ruling paragraph (where detected spans were replaced with "
        "tags such as [PERSON], [LOC], [ORG], [DATE]) and candidate background dossiers.\n"
        "Use quasi-identifiers, dates, events, locations, roles, and institutional clues to "
        "estimate the probability that each candidate dossier is the true source case.\n\n"
        f"Redacted Excerpt:\n{redacted_excerpt[:900]}\n\n"
        f"Candidate Dossiers:\n{cand_lines}\n\n"
        "Return strict JSON only with key \"scores\" mapping every candidate ID "
        f"({', '.join(slots)}) to a non-negative plausibility score summing to 1.0, and \"top1\" "
        "with the single likeliest candidate ID."
    )
    payload = json.dumps({
        "model": model_name,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "seed": seed, "num_predict": 160},
        "messages": [
            {
                "role": "system",
                "content": "You are an adversarial privacy auditor executing a Conformal Privacy Auditing (CPA) re-identification test. Output valid JSON only.",
            },
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                content = (body.get("message") or {}).get("content") or "{}"
                parsed = json.loads(content)
                raw_scores = parsed.get("scores") if isinstance(parsed, dict) else None
                top1_claim = str(parsed.get("top1", "")).strip() if isinstance(parsed, dict) else ""
                probs: dict[str, float] = {}
                if isinstance(raw_scores, dict):
                    for i, s in enumerate(slots):
                        val = raw_scores.get(s, 0.0)
                        try:
                            fv = max(0.0, float(val))
                        except Exception:
                            fv = 0.0
                        probs[s] = fv + 1e-4 + (1e-7 * (len(slots) - i))
                else:
                    for i, s in enumerate(slots):
                        probs[s] = (0.55 if s == top1_claim else 0.05) + (1e-7 * (len(slots) - i))
                if top1_claim in probs and max(probs, key=probs.get) != top1_claim:
                    probs[top1_claim] = max(probs.values()) + 0.02
                tot = sum(probs.values())
                return {s: probs[s] / tot for s in slots}
        except Exception as exc:
            last_err = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Ollama CPA attacker query failed after 3 attempts: {last_err}") from last_err


def simulate_dry_run_attacker_probs(redacted_excerpt: str, candidates: list[dict[str, Any]], seed: int) -> dict[str, float]:
    """Deterministic lexical-overlap quasi-identifier attacker for CPU-only `--dry-run` contract tests."""
    ex_toks = {w.lower() for w in re.findall(r"[A-Za-z0-9]{4,}", redacted_excerpt)}
    scores: dict[str, float] = {}
    rng = random.Random(seed + len(redacted_excerpt))
    for i, c in enumerate(candidates):
        d_toks = {w.lower() for w in re.findall(r"[A-Za-z0-9]{4,}", c["summary"])}
        overlap = len(ex_toks & d_toks)
        scores[c["slot"]] = math.exp(0.65 * overlap + rng.uniform(-0.05, 0.05)) + 1e-6 * (len(candidates) - i)
    tot = sum(scores.values())
    return {k: v / tot for k, v in scores.items()}


def calibrate_cpa_quantile(cal_nonconformity: list[float], beta: float = 0.10) -> float:
    """Finite-sample split conformal quantile q_hat at level 1 - beta (arXiv:2609.21340)."""
    n = len(cal_nonconformity)
    if n == 0:
        return 1.0
    ordered = sorted(cal_nonconformity)
    rank_idx = math.ceil((n + 1) * (1.0 - beta)) - 1
    if rank_idx >= n:
        return 1.0
    return float(ordered[max(0, rank_idx)])


def score_cpa_instance(
    row: dict[str, Any],
    challenge: dict[str, Any],
    probs: dict[str, float],
    q_hat: float,
) -> dict[str, Any]:
    true_slot = challenge["trueSlot"]
    pred_top1 = max(probs, key=probs.get)
    amb_set = [slot for slot, p in probs.items() if (1.0 - p) <= q_hat + 1e-12]
    if not amb_set:
        amb_set = [pred_top1]
    return {
        "para_id": row["para_id"],
        "doc_id": row["doc_id"],
        "safeProb": row["safeProb"],
        "gateVerdictAlpha005": row.get("gateVerdictAlpha005"),
        "residualUnsafe": bool(row.get("residualUnsafe")),
        "gtSpanCount": int(row.get("gtSpanCount", 0)),
        "trueSlot": true_slot,
        "predTop1": pred_top1,
        "top1Hit": pred_top1 == true_slot,
        "trueProb": round(float(probs[true_slot]), 5),
        "nonconformity": round(1.0 - float(probs[true_slot]), 5),
        "ambiguitySetSize": len(amb_set),
        "coveredInAmbiguitySet": true_slot in amb_set,
    }


def summarize_cpa_group(rows: list[dict[str, Any]], n_boot: int, seed: int) -> dict[str, Any]:
    n = len(rows)
    hits = [1.0 if r["top1Hit"] else 0.0 for r in rows]
    sizes = [float(r["ambiguitySetSize"]) for r in rows]
    k_hit = sum(1 for r in rows if r["top1Hit"])
    k_sing = sum(1 for r in rows if int(r["ambiguitySetSize"]) <= 1)
    k_cov = sum(1 for r in rows if r["coveredInAmbiguitySet"])
    sorted_sizes = sorted(sizes)
    median_size = sorted_sizes[n // 2] if n > 0 else 0.0
    return {
        "n": n,
        "top1ReIdCount": k_hit,
        "top1ReIdRatePct": round(100.0 * k_hit / max(1, n), 2),
        "top1ClopperPearson95CI": clopper_pearson_ci95_pct(k_hit, n),
        "top1Bootstrap95CI": bootstrap_mean_ci95(hits, scale=100.0, n_boot=n_boot, seed=seed),
        "meanAmbiguitySetSize": round(sum(sizes) / max(1, n), 3),
        "medianAmbiguitySetSize": round(float(median_size), 2),
        "ambiguitySetSizeBootstrap95CI": bootstrap_mean_ci95(sizes, scale=1.0, n_boot=n_boot, seed=seed + 7),
        "singletonSinglingOutCount": k_sing,
        "singletonSinglingOutRatePct": round(100.0 * k_sing / max(1, n), 2),
        "empiricalCoveragePct": round(100.0 * k_cov / max(1, n), 2),
        "residualDetectorLeakPct": round(100.0 * sum(1 for r in rows if r["residualUnsafe"]) / max(1, n), 2),
    }


def build_synthetic_dry_run_data(seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    cities = ("Tallinn", "Riga", "Vilnius", "Helsinki", "Gdansk", "Brno", "Graz", "Ljubljana", "Tartu", "kosice")
    orgs = ("Municipal Hospital", "Port Customs", "District Tax Board", "Railway Union", "Forestry Agency", "State Archive")
    years = ("2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021")
    roles = ("marine surveyor", "customs clerk", "ward nurse", " locomotive dispatcher", "archive registrar", "tax inspector")

    def make_split(prefix: str, n_docs: int) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
        dossiers = {}
        rows = []
        for i in range(n_docs):
            did = f"{prefix}_{i:03d}"
            city = cities[i % len(cities)]
            org = orgs[i % len(orgs)]
            yr = years[i % len(years)]
            role = roles[i % len(roles)].strip()
            dossiers[did] = {
                "doc_id": did,
                "summary": f"Profile/Role: {role} | Locations: {city} | Key Dates: {yr} | Institutions: {org}",
                "quasiCount": 4,
                "directCount": 1,
            }
            # 1 low-risk procedural paragraph (KEEP) + 1 quasi-identifier-rich paragraph (ABSTAIN)
            rows.append({
                "para_id": f"{did}#p0",
                "doc_id": did,
                "redactedText": "The Chamber notes that the procedural observations were filed within the statutory time-limit under Rule 38.",
                "safeProb": round(rng.uniform(0.42, 0.85), 4),
                "gateVerdictAlpha005": "KEEP",
                "residualUnsafe": False,
                "gtSpanCount": 0,
            })
            rows.append({
                "para_id": f"{did}#p1",
                "doc_id": did,
                "redactedText": f"In {yr}, [PERSON] worked as a {role} in {city} during the audit at {org}.",
                "safeProb": round(rng.uniform(0.05, 0.28), 4),
                "gateVerdictAlpha005": "ABSTAIN",
                "residualUnsafe": True,
                "gtSpanCount": 4,
            })
        return dossiers, rows

    dev_dossiers, cal_rows = make_split("syn_cal", 24)
    test_dossiers, test_rows = make_split("syn_test", 30)
    return {
        "thresholds": {
            "0.01": {"tauKeep": 0.48, "certified": True},
            "0.05": {"tauKeep": 0.34, "certified": True},
            "0.1": {"tauKeep": 0.26, "certified": True},
        },
        "calRows": cal_rows,
        "testRows": test_rows,
        "devDossiers": dev_dossiers,
        "testDossiers": test_dossiers,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="T11 CPA Attacker Re-Identification Audit (arXiv:2609.21340) over Versieve HC-CRC KEEP vs ABSTAIN."
    )
    parser.add_argument("--out", default=str(DEFAULT_OUT_PATH), help="Output JSON artifact path")
    parser.add_argument("--tab-dir", default=None, help="Directory containing echr_dev.json and echr_test.json")
    parser.add_argument("--gliner-model-dir", default=None, help="Path to local GLiNER-PII-Edge ONNX directory")
    parser.add_argument("--onnx-python", default=None, help="Python executable with onnxruntime+tokenizers")
    parser.add_argument("--attacker-model", default="qwen2.5:7b", help="Local Ollama attacker model tag")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434", help="Localhost Ollama base URL")
    parser.add_argument("--candidates-k", type=int, default=10, help="Candidate entity dossiers per CPA challenge")
    parser.add_argument("--beta", type=float, default=0.10, help="CPA conformal miscoverage level beta (1-beta target coverage)")
    parser.add_argument("--cal-sample", type=int, default=50, help="CPA calibration queries from echr_dev calibration split")
    parser.add_argument("--released-sample", type=int, default=100, help="Held-out KEEP (auto-released) paragraphs audited")
    parser.add_argument("--withheld-sample", type=int, default=100, help="Held-out ABSTAIN/DROP (withheld) paragraphs audited")
    parser.add_argument("--bootstraps", type=int, default=1000, help="Bootstrap resamples for 95%% CIs")
    parser.add_argument("--permutations", type=int, default=5000, help="Permutation resamples for hypothesis tests")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic random seed")
    parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR), help="Scratch cache directory for per-item resume")
    parser.add_argument("--dry-run", action="store_true", help="Deterministic CPU-safe dry-run (no Ollama/ONNX required)")
    args = parser.parse_args()

    seed = int(args.seed)
    k_cand = int(args.candidates_k)
    beta = float(args.beta)

    if args.dry_run:
        syn = build_synthetic_dry_run_data(seed)
        cal_rows = syn["calRows"]
        test_rows = syn["testRows"]
        dev_dossiers = syn["devDossiers"]
        test_dossiers = syn["testDossiers"]
        attacker_meta = {"modelName": "dry-run-lexical-quasi-attacker", "digest": None, "license": "MIT"}
        gliner_meta = {"modelId": "mock:gliner-pii-edge", "onnxSha256": None, "license": "Apache-2.0"}
        thresholds = syn["thresholds"]
    else:
        tab_dir = Path(args.tab_dir) if args.tab_dir else resolve_default_tab_dir()
        dev_path = tab_dir / "echr_dev.json"
        test_path = tab_dir / "echr_test.json"
        if not dev_path.exists() or not test_path.exists():
            fail_closed(
                "MISSING_TAB_SPLITS",
                f"TAB ECHR files missing under {tab_dir} (expected echr_dev.json and echr_test.json)",
                ["echr_dev.json", "echr_test.json"],
            )
        attacker_meta = verify_ollama_attacker(args.attacker_model, args.ollama_url)
        onnx_py = discover_onnx_python(args.onnx_python)
        if not onnx_py:
            fail_closed("MISSING_ONNX_RUNTIME", "No Python runtime with onnxruntime+tokenizers found", ["onnxruntime"])
        gliner_dir = Path(args.gliner_model_dir) if args.gliner_model_dir else resolve_default_gliner_dir()

        dev_docs = load_tab_docs(dev_path)
        test_docs = load_tab_docs(test_path)
        part = build_tab_hccrc_partition(dev_docs, test_docs, gliner_dir, onnx_py)
        cal_rows = part["calRows"]
        test_rows = part["testRows"]
        dev_dossiers = part["devDossiers"]
        test_dossiers = part["testDossiers"]
        gliner_meta = part["glinerMeta"]
        thresholds = part["thresholds"]

    rng = random.Random(seed)

    # Stratified deterministic selection of CPA calibration rows (from dev calibration split)
    cal_pool = sorted(cal_rows, key=lambda r: r["para_id"])
    cal_selected = rng.sample(cal_pool, min(int(args.cal_sample), len(cal_pool)))
    cal_selected.sort(key=lambda r: r["para_id"])

    # Held-out test partition at primary HC-CRC alpha=0.05:
    # Prioritize rulings that have BOTH a KEEP and an ABSTAIN paragraph so within-ruling paired
    # tests have maximal power, then top up deterministically to released_sample / withheld_sample.
    released_all = sorted([r for r in test_rows if r["gateVerdictAlpha005"] == "KEEP"], key=lambda r: r["para_id"])
    withheld_all = sorted([r for r in test_rows if r["gateVerdictAlpha005"] != "KEEP"], key=lambda r: r["para_id"])

    rel_by_doc: dict[str, list[dict[str, Any]]] = {}
    wit_by_doc: dict[str, list[dict[str, Any]]] = {}
    for r in released_all:
        rel_by_doc.setdefault(r["doc_id"], []).append(r)
    for r in withheld_all:
        wit_by_doc.setdefault(r["doc_id"], []).append(r)

    shared_docs = sorted(set(rel_by_doc) & set(wit_by_doc))
    paired_rel_ids: set[str] = set()
    paired_wit_ids: set[str] = set()
    paired_doc_order = list(shared_docs)
    rng.shuffle(paired_doc_order)
    max_pairs = min(len(paired_doc_order), int(args.released_sample), int(args.withheld_sample))
    for did in sorted(paired_doc_order[:max_pairs]):
        r_pick = rng.choice(rel_by_doc[did])
        # Pick informative withheld paragraph from same ruling
        w_candidates = sorted(wit_by_doc[did], key=lambda x: (-int(x.get("gtSpanCount", 0)), x["para_id"]))
        w_pick = w_candidates[0]
        paired_rel_ids.add(r_pick["para_id"])
        paired_wit_ids.add(w_pick["para_id"])

    rem_rel = [r for r in released_all if r["para_id"] not in paired_rel_ids]
    rem_wit = [r for r in withheld_all if r["para_id"] not in paired_wit_ids]
    need_rel = max(0, min(int(args.released_sample), len(released_all)) - len(paired_rel_ids))
    need_wit = max(0, min(int(args.withheld_sample), len(withheld_all)) - len(paired_wit_ids))

    rel_selected = sorted(
        [r for r in released_all if r["para_id"] in paired_rel_ids] + rng.sample(rem_rel, need_rel),
        key=lambda r: r["para_id"],
    )
    wit_selected = sorted(
        [r for r in withheld_all if r["para_id"] in paired_wit_ids] + rng.sample(rem_wit, need_wit),
        key=lambda r: r["para_id"],
    )

    cache_path = Path(args.work_dir) / f"cpa-cache-seed{seed}-k{k_cand}.json"
    prob_cache: dict[str, dict[str, float]] = {}
    if not args.dry_run and cache_path.exists():
        try:
            prob_cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            prob_cache = {}

    def eval_probs(row: dict[str, Any], dossiers: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], dict[str, float]]:
        ch = build_candidate_challenge(row, dossiers, k_candidates=k_cand, seed=seed)
        if args.dry_run:
            return ch, simulate_dry_run_attacker_probs(row["redactedText"], ch["candidates"], seed=seed)
        key = f"{row['para_id']}|k={k_cand}|s={seed}"
        if key in prob_cache:
            return ch, prob_cache[key]
        probs = query_ollama_cpa_attacker(
            row["redactedText"], ch["candidates"], args.attacker_model, args.ollama_url, seed=seed
        )
        prob_cache[key] = probs
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        if len(prob_cache) % 10 == 0:
            cache_path.write_text(json.dumps(prob_cache, indent=2), encoding="utf-8")
            print(f"[t11-cpa] cached {len(prob_cache)} Ollama attacker evaluations...", flush=True)
        return ch, probs

    # 1. Calibrate CPA conformal nonconformity quantile on dev calibration fold
    cal_nonconf: list[float] = []
    for r in cal_selected:
        ch, probs = eval_probs(r, dev_dossiers)
        cal_nonconf.append(1.0 - float(probs[ch["trueSlot"]]))
    q_hat = calibrate_cpa_quantile(cal_nonconf, beta=beta)

    # 2. Score held-out released (KEEP) and withheld (ABSTAIN/DROP) excerpts
    scored_released: list[dict[str, Any]] = []
    for r in rel_selected:
        ch, probs = eval_probs(r, test_dossiers)
        scored_released.append(score_cpa_instance(r, ch, probs, q_hat))

    scored_withheld: list[dict[str, Any]] = []
    for r in wit_selected:
        ch, probs = eval_probs(r, test_dossiers)
        scored_withheld.append(score_cpa_instance(r, ch, probs, q_hat))

    if not args.dry_run:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(prob_cache, indent=2), encoding="utf-8")
        unload_ollama_model(args.attacker_model, args.ollama_url)

    rel_summary = summarize_cpa_group(scored_released, n_boot=args.bootstraps, seed=seed)
    wit_summary = summarize_cpa_group(scored_withheld, n_boot=args.bootstraps, seed=seed + 100)

    # 3. Statistical hypothesis tests (Fisher exact, bootstrap diff CI, permutation, within-ruling paired)
    fisher = fisher_exact_2x2(
        rel_summary["top1ReIdCount"],
        rel_summary["n"] - rel_summary["top1ReIdCount"],
        wit_summary["top1ReIdCount"],
        wit_summary["n"] - wit_summary["top1ReIdCount"],
    )
    wit_hits = [1.0 if r["top1Hit"] else 0.0 for r in scored_withheld]
    rel_hits = [1.0 if r["top1Hit"] else 0.0 for r in scored_released]
    top1_diff_pp = round(wit_summary["top1ReIdRatePct"] - rel_summary["top1ReIdRatePct"], 2)
    top1_diff_ci = bootstrap_diff_ci95(wit_hits, rel_hits, scale=100.0, n_boot=args.bootstraps, seed=seed + 200)

    rel_sizes = [float(r["ambiguitySetSize"]) for r in scored_released]
    wit_sizes = [float(r["ambiguitySetSize"]) for r in scored_withheld]
    amb_perm = unpaired_permutation_test(rel_sizes, wit_sizes, n_perm=args.permutations, seed=seed + 300)
    amb_diff_ci = bootstrap_diff_ci95(rel_sizes, wit_sizes, scale=1.0, n_boot=args.bootstraps, seed=seed + 301)

    rel_map_doc = {r["doc_id"]: r for r in scored_released if r["para_id"] in paired_rel_ids}
    wit_map_doc = {r["doc_id"]: r for r in scored_withheld if r["para_id"] in paired_wit_ids}
    paired_tuples = [(rel_map_doc[d], wit_map_doc[d]) for d in sorted(set(rel_map_doc) & set(wit_map_doc))]
    paired_stats = paired_permutation_and_mcnemar(paired_tuples, n_perm=args.permutations, seed=seed + 400)

    # 4. Sensitivity across HC-CRC alpha in {0.01, 0.05, 0.10} over the audited test pool
    all_audited = scored_released + scored_withheld
    alpha_sensitivity = {}
    for alpha_key in ("0.01", "0.05", "0.1"):
        tau = float((thresholds.get(alpha_key) or thresholds.get("0.10") or {"tauKeep": 0.34})["tauKeep"])
        sub_rel = [r for r in all_audited if float(r["safeProb"]) >= tau]
        sub_wit = [r for r in all_audited if float(r["safeProb"]) < tau]
        alpha_sensitivity[alpha_key] = {
            "tauKeep": tau,
            "fullTestReleasedCount": sum(1 for r in test_rows if float(r["safeProb"]) >= tau),
            "fullTestWithheldCount": sum(1 for r in test_rows if float(r["safeProb"]) < tau),
            "auditedReleased": summarize_cpa_group(sub_rel, n_boot=args.bootstraps, seed=seed + 500),
            "auditedWithheld": summarize_cpa_group(sub_wit, n_boot=args.bootstraps, seed=seed + 600),
        }

    artifact = {
        "schemaVersion": "versieve.t11.cpa-attacker-audit.v1",
        "kind": "t11-cpa-attacker-audit",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) if not args.dry_run else "dry-run",
        "dryRun": bool(args.dry_run),
        "protocol": {
            "name": "Conformal Privacy Auditing (CPA)",
            "primaryCitation": "arXiv:2609.21340",
            "threatModelCitations": ["arXiv:2310.07298", "arXiv:2302.00539"],
            "candidateSetSizeK": k_cand,
            "chanceTop1Pct": round(100.0 / k_cand, 2),
            "miscoverageBeta": beta,
            "targetCoveragePct": round(100.0 * (1.0 - beta), 1),
        },
        "seed": seed,
        "resampleCount": args.bootstraps,
        "permutationCount": args.permutations,
        "hardware": {
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
        "models": {
            "attackerLlm": attacker_meta,
            "stage3bDetector": gliner_meta,
        },
        "dataset": {
            "name": "TAB ECHR (NorskRegnesentral/text-anonymization-benchmark)" if not args.dry_run else "Synthetic CPA Fixture",
            "license": "MIT (TAB annotations; public HUDOC rulings)" if not args.dry_run else "MIT",
            "calParagraphsTotal": len(cal_rows),
            "testParagraphsTotal": len(test_rows),
            "fullTestReleasedAlpha005": len(released_all),
            "fullTestWithheldAlpha005": len(withheld_all),
        },
        "hcCrcGate": {
            "primaryAlpha": 0.05,
            "thresholds": thresholds,
        },
        "cpaCalibration": {
            "nCal": len(cal_selected),
            "miscoverageBeta": beta,
            "conformalQuantileQHat": round(q_hat, 5),
        },
        "released": rel_summary,
        "withheld": wit_summary,
        "hypothesisTests": {
            "withheldMinusReleasedTop1Pp": top1_diff_pp,
            "withheldMinusReleasedTop1Bootstrap95CI": top1_diff_ci,
            "fisherExactTop1": fisher,
            "releasedMinusWithheldAmbiguitySetSize": amb_perm["meanDiff"],
            "releasedMinusWithheldAmbiguityBootstrap95CI": amb_diff_ci,
            "ambiguitySetUnpairedPermutation": amb_perm,
            "withinRulingPairedAudit": paired_stats,
        },
        "alphaSensitivity": alpha_sensitivity,
        "auditedItems": {
            "released": scored_released,
            "withheld": scored_withheld,
        },
    }

    out_p = Path(args.out)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    out_p.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(f"[t11-cpa] {'dry-run' if args.dry_run else 'live audit'} complete -> {out_p}")
    print(
        json.dumps(
            {
                "releasedTop1Pct": rel_summary["top1ReIdRatePct"],
                "withheldTop1Pct": wit_summary["top1ReIdRatePct"],
                "releasedMeanAmbiguitySet": rel_summary["meanAmbiguitySetSize"],
                "withheldMeanAmbiguitySet": wit_summary["meanAmbiguitySetSize"],
                "fisherTwoSidedP": fisher["pValueTwoSided"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
