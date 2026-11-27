#!/usr/bin/env python3
"""Weft full-scale synthetic training-estate generation (ticket W-Data, #49).

Drives the W2 compiler in live mode through a local open-weight teacher, then runs a
realism audit against a licence-green reference sample. Two devices:

  --device cuda   Kaggle T4 window. The teacher weights are loaded by a small inline
                  transformers adapter written at run time; the driver never downloads.
  --device cpu    Fixture-scale smoke only, disclosed in every artifact. Uses a
                  deterministic in-repo fixture teacher (no model weights) so the live
                  wiring can be exercised without a GPU.

Fail-closed contract. The teacher licence must be on W2's permissive allowlist and must
have a green entry in results/weft-licence-audit.json; otherwise a typed error is printed
to stderr and the process exits 2 with no pair artifact and no audit entry. CUDA is
required for `--device cuda` (and for the default `--device auto`). The realism audit
requires a local `--reference` path and never downloads; a missing reference is a typed
error, never a skipped metric. Pair files are staged and only moved into place after the
compiler, digest checks, and the audit entry have all succeeded.

Artifacts:
  results/weft-training-pairs-fullscale/{train.jsonl,eval.jsonl,receipt.json}
  results/weft-data-realism-audit.json   (append-only)

Usage:
  python scripts/generate-weft-fullscale-estates.py --device cpu \
    --teacher-licence mit --target-pairs 40 --reference <local-sample.jsonl>
  python scripts/generate-weft-fullscale-estates.py --device cuda \
    --teacher-licence apache-2.0 --teacher-model mistralai/Mistral-7B-Instruct-v0.3 \
    --target-pairs 50000 --reference <local-sample.jsonl>
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPILER = ROOT / "scripts" / "build-weft-training-pairs.mjs"
LICENCE_AUDIT_PATH = ROOT / "results" / "weft-licence-audit.json"
OUT_DIR = ROOT / "results" / "weft-training-pairs-fullscale"
AUDIT_OUT = ROOT / "results" / "weft-data-realism-audit.json"
MINILM = "sentence-transformers/all-MiniLM-L6-v2"
MINILM_LICENCE = "Apache-2.0"
DEFAULT_TEACHER = "mistralai/Mistral-7B-Instruct-v0.3"
DEFAULT_SEED = 20261127
CPU_SMOKE_MAX_PAIRS = 200
PERMISSIVE_TEACHER_LICENCES = {"apache-2.0", "mit", "bsd-2-clause", "bsd-3-clause", "cc0-1.0"}
BANNED = ("mathematically" + " grounded", "elimin" + "ates", "fir" + "st")


# ---------------------------------------------------------------------------
# Typed fail-closed errors
# ---------------------------------------------------------------------------

class WeftFullscaleError(Exception):
    code = "WEFT_FULLSCALE_ERROR"

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class TeacherLicenceRejected(WeftFullscaleError):
    code = "WEFT_TEACHER_LICENCE_REJECTED"


class TeacherRuntimeUnavailable(WeftFullscaleError):
    code = "WEFT_TEACHER_RUNTIME_UNAVAILABLE"


class CudaUnavailable(WeftFullscaleError):
    code = "WEFT_FULLSCALE_CUDA_UNAVAILABLE"


class ScaleLimitExceeded(WeftFullscaleError):
    code = "WEFT_FULLSCALE_CPU_SMOKE_LIMIT"


class CompilerUnavailable(WeftFullscaleError):
    code = "WEFT_COMPILER_UNAVAILABLE"


class CompilerFailed(WeftFullscaleError):
    code = "WEFT_COMPILER_FAILED"


class ReferenceUnavailable(WeftFullscaleError):
    code = "WEFT_REFERENCE_UNAVAILABLE"


class EmbeddingsUnavailable(WeftFullscaleError):
    code = "WEFT_EMBEDDINGS_UNAVAILABLE"


class ArtifactError(WeftFullscaleError):
    code = "WEFT_ARTIFACT_ERROR"


# ---------------------------------------------------------------------------
# Digests and local-only model resolution (same scheme as W1/W3)
# ---------------------------------------------------------------------------

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


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


def model_files(snap: Path) -> list[Path]:
    """Every model file except giant duplicate weight formats is not attempted:
    sharded safetensors and the index are included, a lone weight file is included."""
    files = [p for p in snap.rglob("*") if p.is_file()]
    weights = [p for p in files if p.suffix == ".safetensors" and p.name != "model.safetensors.index.json"]
    if not weights:
        weights = [p for p in files if p.suffix == ".bin"]
    if not weights:
        return []
    keep = set(weights)
    keep.update(p for p in files if p.suffix != ".bin")
    return sorted(keep)


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


# ---------------------------------------------------------------------------
# Inline teacher adapter.
#
# W2 spawns WEFT_TEACHER_CMD with the prompt on stdin and no arguments. The driver
# points that command at the Python interpreter and places this file on PYTHONPATH as
# `sitecustomize`, which Python imports before reading any stdin script. The adapter
# consumes stdin, writes its answer to stdout, and exits, so no partial state escapes.
# ---------------------------------------------------------------------------

ADAPTER_SOURCE = r'''import json
import os
import re
import sys


def _fixture(prompt):
    import hashlib

    match = re.search(r'theme\s+"([^"]+)"', prompt)
    theme = match.group(1) if match else "general operations"
    match = re.search(r"Produce\s+(\d+)\s+short documents", prompt)
    count = min(int(match.group(1)), 8) if match else 5
    base = re.sub(r"[^a-z0-9]+", "-", theme.lower()).strip("-") or "theme"
    slug = base + "-" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:6]
    formats = ["email", "transcript", "slides", "table", "ticket", "pdf-scan"]
    departments = ["finance", "engineering", "operations", "sales"]
    people = ["Elena Vance", "Ravi Chandra", "Kwame Asante", "Nadia Farouk", "Grace Okonkwo"]
    orgs = ["Harrow Logistics Ltd", "Northwind Traders", "Blue Harbor Group"]
    projects = ["AMBER", "LANTERN", "MERIDIAN"]
    verbs = ["reviewed", "revisited", "finalised", "circulated", "summarised"]
    objects = ["the draft plan", "the revised checklist", "the supplier notes",
               "the launch summary", "the review pack"]
    docs = []
    for i in range(count):
        person = people[(i + len(slug)) % len(people)]
        org = orgs[i % len(orgs)]
        project = "Project " + projects[i % len(projects)]
        fmt = formats[i % len(formats)]
        department = departments[i % len(departments)]
        verb = verbs[(i + len(theme)) % len(verbs)]
        obj = objects[(i * 2 + len(theme)) % len(objects)]
        text = (person + " " + verb + " " + obj + " for " + theme + " with " + org +
                ". " + project + " remains on schedule and the next review is booked for "
                "the following week.")
        if fmt == "table":
            text = ("Item | owner | status\n" + project + " | " + person + " | on track\n" +
                    theme + " | " + org + " | active")
        elif fmt == "slides":
            text = (theme.title() + "\n- owner " + person + "\n- sponsor " + org +
                    "\n- milestone " + project + " on track")
        elif fmt == "ticket":
            text = ("Ticket: " + theme + " follow-up. " + person + " owns " + project +
                    " for " + org + "; " + obj + " is attached.")
        identities = [
            {"key": "person:" + re.sub(r"[^a-z0-9]+", "-", person.lower()),
             "surface": person, "class": "person"},
            {"key": "org:" + re.sub(r"[^a-z0-9]+", "-", org.lower()),
             "surface": org, "class": "org"},
            {"key": "project:" + project.split()[-1].lower(),
             "surface": project, "class": "project"},
        ]
        docs.append({"id": slug + "-" + str(i), "format": fmt,
                     "department": department, "theme": theme, "text": text,
                     "identities": identities})
    links = [{"a": docs[0]["id"], "b": docs[i]["id"], "type": "thread"}
             for i in range(1, count)]
    return {"docs": docs, "links": links}


def _local_teacher(prompt):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    snapshot = os.environ["WEFT_ADAPTER_SNAPSHOT"]
    tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(
        snapshot, local_files_only=True, torch_dtype=torch.float16, device_map="cuda:0")
    torch.manual_seed(int(os.environ.get("WEFT_ADAPTER_SEED", "0")))
    if getattr(tokenizer, "chat_template", None):
        text = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}], tokenize=False, add_generation_prompt=True)
    else:
        text = prompt
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=int(os.environ.get("WEFT_ADAPTER_MAX_NEW_TOKENS", "4096")),
            do_sample=True, temperature=0.7, top_p=0.95)
    return tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)


def _main():
    prompt = sys.stdin.read()
    mode = os.environ.get("WEFT_ADAPTER_MODE", "fixture-smoke")
    payload = _fixture(prompt) if mode == "fixture-smoke" else _local_teacher(prompt)
    sys.stdout.write(payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


try:
    _main()
    os._exit(0)
except Exception as exc:  # noqa: BLE001 - the adapter must never emit a partial answer
    sys.stderr.write("weft-teacher-adapter: " + type(exc).__name__ + ": " + str(exc) + "\n")
    sys.stderr.flush()
    os._exit(1)
'''


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def read_licence_audit() -> dict:
    if not LICENCE_AUDIT_PATH.exists():
        raise TeacherLicenceRejected(f"licence audit absent: {display_path(LICENCE_AUDIT_PATH)}")
    try:
        return json.loads(LICENCE_AUDIT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise TeacherLicenceRejected(f"licence audit is not valid JSON: {exc}") from exc


def audit_entry(audit: dict, *, entry_id: str | None, model_id: str | None) -> dict:
    for source in audit.get("sources", []):
        if entry_id is not None and source.get("id") == entry_id:
            return source
        if model_id is not None and source.get("modelId") == model_id:
            return source
    wanted = entry_id or model_id
    raise TeacherLicenceRejected(f"licence audit has no green entry for {wanted}")


def resolve_device(args) -> str:
    available = False
    try:
        import torch  # noqa: F401
        available = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        available = False
    if args.device == "auto":
        if not available:
            raise CudaUnavailable(
                "no CUDA device available; pass --device cpu only for an explicit fixture-scale "
                "smoke run, or run --device cuda on the Kaggle T4")
        return "cuda"
    if args.device == "cuda" and not available:
        raise CudaUnavailable(
            "CUDA runtime absent; --device cuda fails closed. Use --device cpu only for an "
            "explicit fixture-scale smoke run.")
    return args.device


def resolve_teacher(args, device: str) -> dict:
    licence = str(args.teacher_licence or "").lower()
    if not licence:
        raise TeacherLicenceRejected(
            "--teacher-licence is required so the teacher licence is checked before generation")
    if licence not in PERMISSIVE_TEACHER_LICENCES:
        raise TeacherLicenceRejected(
            f"teacher licence {licence!r} is not permissively licensed; allowed: "
            + ", ".join(sorted(PERMISSIVE_TEACHER_LICENCES)))
    audit = read_licence_audit()
    audit_digest = sha256_file(LICENCE_AUDIT_PATH)

    if device == "cpu":
        if licence != "mit":
            raise TeacherLicenceRejected(
                "the CPU fixture teacher is in-repo MIT-licensed code with no model weights; "
                "pass --teacher-licence mit for the fixture-scale smoke")
        source = audit_entry(audit, entry_id="synthetic-estate", model_id=None)
        if source.get("status") != "green":
            raise TeacherLicenceRejected("the synthetic-estate licence entry is not green")
        adapter_digest = sha256_bytes(ADAPTER_SOURCE.encode("utf-8"))
        return {
            "kind": "fixture-smoke",
            "modelId": "in-repo-fixture-teacher",
            "weightDigest": None,
            "adapterSha256": adapter_digest,
            "licence": "MIT",
            "adapterMode": "fixture-smoke",
            "snapshot": None,
            "licenceTrace": {
                "auditPath": display_path(LICENCE_AUDIT_PATH),
                "auditSha256": audit_digest,
                "entryId": "synthetic-estate",
                "entryStatus": source.get("status"),
                "entryLicence": source.get("licence"),
                "verifiedFrom": ("package.json declares the repository MIT licence; the fixture "
                                 "adapter is in-repo code and emits no third-party text"),
            },
        }

    model_id = args.teacher_model
    snapshot = find_snapshot(model_id)
    files = model_files(snapshot) if snapshot else []
    if snapshot is None or not files:
        raise TeacherRuntimeUnavailable(
            f"{model_id} weights are not in the local Hugging Face cache; the driver never downloads")
    if importlib.util.find_spec("transformers") is None:
        raise TeacherRuntimeUnavailable("transformers is not installed for the inline adapter")
    source = audit_entry(audit, entry_id=None, model_id=model_id)
    if source.get("status") != "green":
        raise TeacherLicenceRejected(
            f"the licence audit entry for {model_id} is {source.get('status')}, not green")
    if str(source.get("licence", "")).lower() != licence:
        raise TeacherLicenceRejected(
            f"the licence audit records {source.get('licence')!r} for {model_id}, "
            f"but --teacher-licence is {licence!r}")
    return {
        "kind": "local-open-weight",
        "modelId": model_id,
        "weightDigest": digest_paths(files),
        "adapterSha256": sha256_bytes(ADAPTER_SOURCE.encode("utf-8")),
        "licence": source.get("licence"),
        "adapterMode": "local-open-weight",
        "snapshot": str(snapshot),
        "licenceTrace": {
            "auditPath": display_path(LICENCE_AUDIT_PATH),
            "auditSha256": audit_digest,
            "entryId": source.get("id"),
            "entryStatus": source.get("status"),
            "entryLicence": source.get("licence"),
            "verifiedFrom": source.get("verifiedFrom"),
        },
    }


def resolve_target(args, device: str) -> int:
    target = args.target_pairs
    if target is None:
        target = 40 if device == "cpu" else 50000
    if device == "cpu" and target > CPU_SMOKE_MAX_PAIRS:
        raise ScaleLimitExceeded(
            f"--device cpu is fixture-scale smoke only (max {CPU_SMOKE_MAX_PAIRS} pairs); "
            "use --device cuda for the full-scale run")
    if target <= 0:
        raise ScaleLimitExceeded("--target-pairs must be positive")
    return target


# ---------------------------------------------------------------------------
# Compiler invocation (W2 live mode, imported rather than the CLI so the audit is safe)
# ---------------------------------------------------------------------------

_COMPILER_JS = """
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.env.WEFT_COMPILER).href);
const options = {
  mode: 'live',
  outDir: process.env.WEFT_OUT_DIR,
  targetPairs: Number(process.env.WEFT_TARGET_PAIRS),
  writeAudit: false,
};
if (process.env.WEFT_EVAL_SIZE) options.evalSize = Number(process.env.WEFT_EVAL_SIZE);
const receipt = mod.runWeftTrainingPairArtifacts(options).receipt;
process.stdout.write(JSON.stringify(receipt));
"""


def run_compiler(staging: Path, target: int, teacher: dict, args) -> dict:
    if not COMPILER.is_file():
        raise CompilerUnavailable(f"W2 compiler absent: {display_path(COMPILER)}")
    adapter_dir = tempfile.mkdtemp(prefix="weft-teacher-adapter-")
    try:
        (Path(adapter_dir) / "sitecustomize.py").write_text(ADAPTER_SOURCE, encoding="utf-8")
        env = dict(os.environ)
        env.pop("WEFT_TEACHER_URL", None)
        pythonpath = env.get("PYTHONPATH")
        env["PYTHONPATH"] = adapter_dir + (os.pathsep + pythonpath if pythonpath else "")
        env["WEFT_TEACHER_CMD"] = sys.executable
        env["WEFT_TEACHER_LICENCE"] = teacher["licence"].lower()
        env["WEFT_ADAPTER_MODE"] = teacher["adapterMode"]
        env["WEFT_ADAPTER_SEED"] = str(args.seed)
        if teacher["snapshot"]:
            env["WEFT_ADAPTER_SNAPSHOT"] = teacher["snapshot"]
        env["WEFT_COMPILER"] = str(COMPILER)
        env["WEFT_OUT_DIR"] = str(staging)
        env["WEFT_TARGET_PAIRS"] = str(target)
        if args.eval_size is not None:
            env["WEFT_EVAL_SIZE"] = str(args.eval_size)
        try:
            result = subprocess.run(
                [args.node, "--input-type=module", "-e", _COMPILER_JS],
                cwd=ROOT, env=env, capture_output=True, text=True, timeout=args.compiler_timeout or None)
        except FileNotFoundError as exc:
            raise CompilerUnavailable(f"node runtime not found: {args.node}") from exc
        except subprocess.TimeoutExpired as exc:
            raise CompilerFailed(f"compiler timed out after {args.compiler_timeout}s") from exc
        if result.returncode != 0:
            tail = (result.stderr or result.stdout or "").strip().splitlines()[-6:]
            raise CompilerFailed("W2 live compilation failed: " + " | ".join(tail))
        try:
            return json.loads(result.stdout.strip().splitlines()[-1])
        except Exception as exc:  # noqa: BLE001
            raise CompilerFailed(f"compiler did not return a JSON receipt: {exc}") from exc
    finally:
        shutil.rmtree(adapter_dir, ignore_errors=True)


def verify_receipt(staging: Path, receipt: dict) -> None:
    required = ["mode", "generator", "pairCount", "trainCount", "evalCount", "byType",
                "trainJsonlSha256", "evalJsonlSha256", "pairJsonlSha256", "usedSources"]
    for key in required:
        if key not in receipt:
            raise CompilerFailed(f"W2 receipt is missing {key}")
    if receipt["mode"] != "live":
        raise CompilerFailed("W2 did not run in live mode")
    train = staging / "train.jsonl"
    eval_ = staging / "eval.jsonl"
    if not train.is_file() or not eval_.is_file():
        raise CompilerFailed("compiler did not write train.jsonl and eval.jsonl")
    train_bytes = train.read_bytes()
    eval_bytes = eval_.read_bytes()
    if sha256_bytes(train_bytes) != receipt["trainJsonlSha256"]:
        raise CompilerFailed("train.jsonl digest does not match the receipt")
    if sha256_bytes(eval_bytes) != receipt["evalJsonlSha256"]:
        raise CompilerFailed("eval.jsonl digest does not match the receipt")
    if sha256_bytes(train_bytes + eval_bytes) != receipt["pairJsonlSha256"]:
        raise CompilerFailed("pair digest does not match the receipt")
    if receipt["trainCount"] + receipt["evalCount"] != receipt["pairCount"]:
        raise CompilerFailed("receipt pair counts do not add up")
    for source, status in (receipt.get("usedSources") or {}).items():
        if status != "green":
            raise CompilerFailed(f"pairs derived from a non-green source: {source} ({status})")
    if not staging.joinpath("receipt.json").is_file():
        raise CompilerFailed("compiler did not write receipt.json")


# ---------------------------------------------------------------------------
# Realism audit
# ---------------------------------------------------------------------------

def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def _ttr(tokens: list[str]) -> dict:
    return {
        "tokens": len(tokens),
        "types": len(set(tokens)),
        "typeTokenRatio": (len(set(tokens)) / len(tokens)) if tokens else 0.0,
    }


def _distinct_n(tokens: list[str], n: int) -> dict:
    grams = [tuple(tokens[i:i + n]) for i in range(max(0, len(tokens) - n + 1))]
    return {
        "total": len(grams),
        "distinct": len(set(grams)),
        "ratio": (len(set(grams)) / len(grams)) if grams else 0.0,
    }


def _percentiles(values: list[int]) -> dict:
    if not values:
        return {"count": 0, "mean": 0.0, "median": 0.0, "min": 0, "p10": 0.0, "p90": 0.0, "max": 0}
    ordered = sorted(values)

    def at(q: float) -> float:
        pos = q * (len(ordered) - 1)
        low = int(math.floor(pos))
        high = int(math.ceil(pos))
        if low == high:
            return float(ordered[low])
        return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)

    return {
        "count": len(values),
        "mean": sum(values) / len(values),
        "median": at(0.5),
        "min": ordered[0],
        "p10": at(0.1),
        "p90": at(0.9),
        "max": ordered[-1],
    }


def _balance(counts: dict[str, int]) -> dict:
    total = sum(counts.values())
    if not total:
        return {"counts": {}, "distinct": 0, "entropy": 0.0, "normalizedEntropy": 0.0}
    probabilities = [c / total for c in counts.values() if c > 0]
    entropy = -sum(p * math.log(p) for p in probabilities)
    normalizer = math.log(len(probabilities)) if len(probabilities) > 1 else 0.0
    return {
        "counts": dict(sorted(counts.items())),
        "distinct": len(probabilities),
        "entropy": entropy,
        "normalizedEntropy": (entropy / normalizer) if normalizer else 1.0,
    }


def _identity_density(texts: list[str]) -> dict:
    token_count = sum(len(_tokens(t)) for t in texts)
    role = sum(len(re.findall(r"\[[A-Z]+_\d+\]", t)) for t in texts)
    capitalized = sum(len(re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", t)) for t in texts)
    return {
        "tokenCount": token_count,
        "roleTokens": role,
        "roleTokensPer1k": (1000.0 * role / token_count) if token_count else 0.0,
        "capitalizedSequences": capitalized,
        "capitalizedSequencesPer1k": (1000.0 * capitalized / token_count) if token_count else 0.0,
    }


def load_pairs(paths: list[Path]) -> list[dict]:
    pairs = []
    for path in paths:
        if not path.is_file():
            raise ArtifactError(f"pair artifact absent: {path}")
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                pairs.append(json.loads(line))
    if not pairs:
        raise ArtifactError("the pair artifacts are empty")
    return pairs


def load_reference(path: Path) -> list[str]:
    if not path.is_file():
        raise ReferenceUnavailable(f"reference sample absent: {path}; the audit never downloads")
    raw = path.read_bytes()
    texts: list[str] = []
    try:
        if path.suffix.lower() == ".txt":
            texts = [block.strip() for block in re.split(r"\n\s*\n", raw.decode("utf-8"))]
        elif path.suffix.lower() == ".jsonl":
            for line in raw.decode("utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                texts.append(str(row.get("text") or row.get("content") or row) if isinstance(row, dict) else str(row))
        else:
            data = json.loads(raw.decode("utf-8"))
            rows = data if isinstance(data, list) else (data.get("docs") or data.get("documents") or [])
            for row in rows:
                texts.append(str(row.get("text") or row.get("content") or row) if isinstance(row, dict) else str(row))
    except Exception as exc:  # noqa: BLE001
        raise ReferenceUnavailable(f"reference sample is not readable JSON/JSONL/text: {exc}") from exc
    texts = [t for t in (t.strip() for t in texts) if len(t) >= 20]
    if not texts:
        raise ReferenceUnavailable("reference sample has no documents with at least 20 characters")
    return texts


def _nearest(gen, ref) -> dict:
    import numpy as np
    similarity = gen @ ref.T
    nearest = similarity.max(axis=1)
    return {
        "meanNearestCosine": float(nearest.mean()),
        "medianNearestCosine": float(np.median(nearest)),
        "coveredFractionAt05": float((nearest >= 0.5).mean()),
    }


def _dispersion(matrix) -> float:
    import numpy as np
    n = matrix.shape[0]
    if n < 2:
        return 0.0
    similarity = matrix @ matrix.T
    mean = (float(similarity.sum()) - float(np.trace(similarity))) / (n * (n - 1))
    return 1.0 - mean


def load_minilm():
    snapshot = find_snapshot(MINILM)
    if snapshot is None or not model_files(snapshot):
        raise EmbeddingsUnavailable(f"{MINILM} weights are not in the local Hugging Face cache")
    if importlib.util.find_spec("sentence_transformers") is None:
        raise EmbeddingsUnavailable("sentence_transformers is not installed")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(str(snapshot), local_files_only=True)
    except Exception as exc:  # noqa: BLE001
        raise EmbeddingsUnavailable(f"could not load {MINILM}: {type(exc).__name__}: {exc}") from exc
    return model, {
        "modelId": MINILM,
        "modelDigest": digest_paths(model_files(snapshot)),
        "licence": MINILM_LICENCE,
    }


def encode(model, texts: list[str]):
    import numpy as np
    try:
        vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False, batch_size=32)
    except Exception as exc:  # noqa: BLE001
        raise EmbeddingsUnavailable(f"could not encode with {MINILM}: {type(exc).__name__}: {exc}") from exc
    return np.asarray(vectors, dtype="float32")


def build_audit_entry(staging: Path, receipt: dict, teacher: dict, args, device: str, scale: str) -> dict:
    reference_path = Path(args.reference).resolve()
    audit = read_licence_audit()
    reference_entry = audit_entry(audit, entry_id=args.reference_id, model_id=None)
    if reference_entry.get("status") != "green":
        raise ReferenceUnavailable(f"reference entry {args.reference_id} is not green")
    if str(reference_entry.get("licence", "")).lower() != args.reference_licence.lower():
        raise ReferenceUnavailable(
            f"reference licence {args.reference_licence!r} does not match the audit entry "
            f"({reference_entry.get('licence')!r})")
    reference_texts = load_reference(reference_path)
    reference_bytes = reference_path.read_bytes()

    pairs = load_pairs([staging / "train.jsonl", staging / "eval.jsonl"])
    generated_texts = [text for pair in pairs for text in (pair["textA"], pair["textB"])]
    formats: dict[str, int] = {}
    departments: dict[str, int] = {}
    themes: dict[str, int] = {}
    for pair in pairs:
        provenance = pair.get("provenance", {})
        for fmt in provenance.get("formats", []):
            formats[str(fmt)] = formats.get(str(fmt), 0) + 1
        for dept in provenance.get("departments", []):
            departments[str(dept)] = departments.get(str(dept), 0) + 1
        for theme in provenance.get("themes", []):
            themes[str(theme)] = themes.get(str(theme), 0) + 1

    generated_tokens = [token for text in generated_texts for token in _tokens(text)]
    reference_tokens = [token for text in reference_texts for token in _tokens(text)]
    matched = min(len(generated_tokens), len(reference_tokens))
    novelty = {}
    generated_distinct = {}
    reference_distinct = {}
    for n in (1, 2, 3):
        gen_grams = {tuple(generated_tokens[i:i + n]) for i in range(max(0, len(generated_tokens) - n + 1))}
        ref_grams = {tuple(reference_tokens[i:i + n]) for i in range(max(0, len(reference_tokens) - n + 1))}
        novelty[str(n)] = (len(gen_grams - ref_grams) / len(gen_grams)) if gen_grams else 0.0
        generated_distinct[str(n)] = _distinct_n(generated_tokens, n)
        reference_distinct[str(n)] = _distinct_n(reference_tokens, n)

    max_docs = max(1, args.embedding_max_docs)
    gen_sample = generated_texts[:max_docs]
    ref_sample = reference_texts[:max_docs]
    model, embedding_info = load_minilm()
    gen_matrix = encode(model, gen_sample)
    ref_matrix = encode(model, ref_sample)
    coverage = _nearest(gen_matrix, ref_matrix)
    embedding = {
        **embedding_info,
        "generatedDocsTotal": len(generated_texts),
        "referenceDocsTotal": len(reference_texts),
        "generatedDocsEmbedded": len(gen_sample),
        "referenceDocsEmbedded": len(ref_sample),
        "sampled": len(gen_sample) < len(generated_texts) or len(ref_sample) < len(reference_texts),
        "generatedDispersion": _dispersion(gen_matrix),
        "referenceDispersion": _dispersion(ref_matrix),
        "coverage": coverage,
    }

    generated_density = _identity_density(generated_texts)
    reference_density = _identity_density(reference_texts)

    gaps = [
        "The reference is an operator-supplied local sample; the script never downloads and the sample is not committed.",
        f"The generated corpus ({len(generated_tokens)} tokens) and reference ({len(reference_tokens)} tokens) differ in size; "
        "size-matched values are reported next to full-corpus values.",
        "Identity-bearing density uses role-token and capitalized-sequence proxies, not a named-entity recognizer.",
        f"Embedding metrics sampled up to {max_docs} documents per side; dispersion and coverage are descriptive, not a release gate.",
    ]
    if scale == "fixture-smoke":
        gaps.append("This entry was produced on CPU with the deterministic fixture teacher and is a "
                    "fixture-scale smoke test only; its text is not teacher-generated prose.")
    else:
        gaps.append("This entry records a live GPU run; the reference remains a sample rather than a full dump.")

    entry = {
        "ticket": "W-Data",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "scale": scale,
        "seeds": {"generation": args.seed, "embedding": args.seed},
        "pairs": {
            "path": display_path(Path(args.out)),
            "pairCount": receipt["pairCount"],
            "trainCount": receipt["trainCount"],
            "evalCount": receipt["evalCount"],
            "trainJsonlSha256": receipt["trainJsonlSha256"],
            "evalJsonlSha256": receipt["evalJsonlSha256"],
            "mode": receipt["mode"],
            "generator": receipt["generator"],
            "byType": receipt["byType"],
        },
        "reference": {
            "id": args.reference_id,
            "licence": reference_entry.get("licence"),
            "status": reference_entry.get("status"),
            "path": display_path(reference_path),
            "sha256": sha256_bytes(reference_bytes),
            "documentCount": len(reference_texts),
            "totalChars": sum(len(t) for t in reference_texts),
            "retrieval": args.reference_source,
            "note": "operator-supplied local file; the audit reads it and never downloads",
        },
        "metrics": {
            "typeTokenRatio": {
                "generated": _ttr(generated_tokens),
                "reference": _ttr(reference_tokens),
                "sizeMatched": {
                    "tokenCount": matched,
                    "generated": _ttr(generated_tokens[:matched]),
                    "reference": _ttr(reference_tokens[:matched]),
                },
            },
            "distinctN": {
                "generated": generated_distinct,
                "reference": reference_distinct,
                "noveltyFraction": novelty,
            },
            "embedding": embedding,
            "documentLength": {
                "unit": "whitespace tokens",
                "generated": _percentiles([len(t.split()) for t in generated_texts]),
                "reference": _percentiles([len(t.split()) for t in reference_texts]),
            },
            "formatDistribution": {
                "unit": "pair sides",
                "generated": dict(sorted(formats.items())),
                "reference": {args.reference_id: len(reference_texts)},
            },
            "departmentBalance": _balance(departments),
            "themeBalance": _balance(themes),
            "identityBearingTokenDensity": {
                "generated": generated_density,
                "reference": {
                    "roleTokensPer1k": reference_density["roleTokensPer1k"],
                    "capitalizedSequencesPer1k": reference_density["capitalizedSequencesPer1k"],
                },
            },
        },
        "gaps": gaps,
    }
    return entry


def prepare_audit(path: Path, entry: dict) -> tuple[Path, dict]:
    artifact = {"kind": "weft-data-realism-audit", "schemaVersion": 1,
                "appendOnly": True, "entries": []}
    if path.exists():
        prior = json.loads(path.read_text(encoding="utf-8"))
        if prior.get("kind") != artifact["kind"] or prior.get("appendOnly") is not True:
            raise ArtifactError(f"refusing to append to an incompatible artifact: {path}")
        artifact["entries"] = prior.get("entries", [])
    canonical = json.dumps(entry, sort_keys=True, separators=(",", ":"))
    entry = {"runId": sha256_bytes(canonical.encode("utf-8")), **entry}
    artifact["entries"].append(entry)
    payload = json.dumps(artifact, indent=2) + "\n"
    for word in BANNED:
        if word in payload.lower():
            raise ArtifactError(f"banned word present in the audit entry: {word}")
    return path, artifact


def write_audit(path: Path, artifact: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


# ---------------------------------------------------------------------------
# Compute disclosure
# ---------------------------------------------------------------------------

def compute_block(device: str, node: str) -> dict:
    environment = {
        "device": device,
        "cudaAvailable": False,
        "gpuCount": 0,
        "gpuNames": [],
        "torch": None,
        "transformers": None,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "kaggle": bool(os.environ.get("KAGGLE_KERNEL_RUN_TYPE")),
    }
    try:
        import torch
        environment["torch"] = torch.__version__
        environment["cudaAvailable"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            environment["gpuCount"] = torch.cuda.device_count()
            environment["gpuNames"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
    except Exception:  # noqa: BLE001
        pass
    try:
        import transformers
        environment["transformers"] = transformers.__version__
    except Exception:  # noqa: BLE001
        pass
    try:
        version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=20)
        environment["node"] = version.stdout.strip() or None
    except Exception:  # noqa: BLE001
        environment["node"] = None
    if device == "cuda":
        disclosure = (f"GPU run on {environment['gpuCount']} x {environment['gpuNames'][0] if environment['gpuNames'] else 'CUDA'}; "
                      "the Kaggle recipe uses a Tesla T4")
    else:
        disclosure = ("CPU fixture-scale smoke run; not the Kaggle T4 recipe. The 50k-pair live "
                      "generation runs on Kaggle, and these numbers must not be read as full-scale.")
    environment["computeDisclosure"] = disclosure
    return environment


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def run(args) -> int:
    device = resolve_device(args)
    scale = "live-fullscale" if device == "cuda" else "fixture-smoke"
    target = resolve_target(args, device)
    teacher = resolve_teacher(args, device)

    if args.plan:
        print(json.dumps({
            "kind": "weft-fullscale-plan",
            "ticket": "W-Data",
            "device": device,
            "scale": scale,
            "targetPairs": target,
            "seeds": {"generation": args.seed, "embedding": args.seed},
            "teacher": {k: v for k, v in teacher.items() if k != "snapshot"},
            "outputs": {"pairs": display_path(Path(args.out)), "audit": display_path(Path(args.audit_out))},
        }, indent=2))
        return 0

    if not args.reference:
        raise ReferenceUnavailable(
            "--reference is required: the realism audit reads a local licence-green sample and "
            "never downloads or skips metrics")

    staging = Path(tempfile.mkdtemp(prefix=".weft-fullscale-staging-", dir=str(ROOT / "results")))
    try:
        receipt = run_compiler(staging, target, teacher, args)
        verify_receipt(staging, receipt)
        audit_entry_payload = build_audit_entry(staging, receipt, teacher, args, device, scale)

        enriched = {
            **receipt,
            "fullscale": {
                "ticket": "W-Data",
                "scale": scale,
                "seeds": {"generation": args.seed, "embedding": args.seed},
                "teacher": {
                    "kind": teacher["kind"],
                    "modelId": teacher["modelId"],
                    "weightDigest": teacher["weightDigest"],
                    "adapterSha256": teacher["adapterSha256"],
                    "licence": teacher["licence"],
                    "licenceTrace": teacher["licenceTrace"],
                },
                "digests": {
                    "trainJsonlSha256": receipt["trainJsonlSha256"],
                    "evalJsonlSha256": receipt["evalJsonlSha256"],
                    "pairJsonlSha256": receipt["pairJsonlSha256"],
                    "matchesW2Receipt": True,
                },
                "compute": compute_block(device, args.node),
                "targetPairs": target,
                "note": ("Live mode through the W2 teacher adapter. CPU entries are fixture-scale smoke "
                         "tests; the 50k-pair generation runs on the Kaggle T4."),
            },
        }
        payload = json.dumps(enriched, indent=2) + "\n"
        for word in BANNED:
            if word in payload.lower():
                raise ArtifactError(f"banned word present in the receipt: {word}")
        (staging / "receipt.json").write_text(payload, encoding="utf-8")

        audit_path, audit_artifact = prepare_audit(Path(args.audit_out), audit_entry_payload)
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        for name in ("train.jsonl", "eval.jsonl", "receipt.json"):
            os.replace(staging / name, out_dir / name)
        write_audit(audit_path, audit_artifact)
        written = audit_artifact
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    print(json.dumps({
        "pairs": display_path(out_dir),
        "pairCount": enriched["pairCount"],
        "byType": enriched["byType"],
        "scale": scale,
        "teacher": enriched["fullscale"]["teacher"]["modelId"],
        "audit": display_path(Path(args.audit_out)),
        "auditEntries": len(written["entries"]),
    }))
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Weft full-scale synthetic estates (W-Data)")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--plan", action="store_true", help="resolve device/teacher/licence and exit without writing")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--target-pairs", type=int, default=None)
    parser.add_argument("--eval-size", type=int, default=None)
    parser.add_argument("--teacher-model", default=DEFAULT_TEACHER)
    parser.add_argument("--teacher-licence", default=None)
    parser.add_argument("--reference", default=None, help="local licence-green reference sample (JSONL/JSON/TXT)")
    parser.add_argument("--reference-id", default="wikipedia-dumps")
    parser.add_argument("--reference-licence", default="CC-BY-SA-4.0")
    parser.add_argument("--reference-source",
                        default="operator-supplied local sample; the script never downloads")
    parser.add_argument("--embedding-max-docs", type=int, default=2000)
    parser.add_argument("--node", default="node")
    parser.add_argument("--compiler-timeout", type=int, default=0,
                        help="seconds before the W2 compilation is abandoned; 0 disables")
    parser.add_argument("--out", default=str(OUT_DIR))
    parser.add_argument("--audit-out", default=str(AUDIT_OUT))
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except WeftFullscaleError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
