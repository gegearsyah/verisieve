#!/usr/bin/env python3
"""Weft H2 identity-blindness probe on the shipped artifacts (issue #60).

Post-hoc identity recovery, not an in-training adversary: an externally
trained attacker on the frozen representation, per the Elazar and Goldberg
advice in the W7 full-text verification record. The probe family is fixed
and reported, because nonlinear recovery is probe-family-specific (the INLP
precedent): a 1-hidden-layer ReLU MLP (primary) and an RBF-SVM (secondary).
Task: given a document's pooled embedding, predict the document's primary
identity key; multi-class over the training identities, top-1 accuracy
against the majority-class chance baseline.

Conditions, same corpus, same split, same seed:
  a. control-frozen-base: fp32 MiniLM (all-MiniLM-L6-v2), masked-mean pooled
  b. artifact-int4-matmulnbits: the shipped int4 MatMulNBits ONNX artifact
  c. artifact-int8-dynamic: the shipped int8 dynamic ONNX artifact

The shipped ONNX pair graphs expose only scalar outputs (linkProb,
themeSim), so the probe reads each graph's internal pooled representation
via read-only graph surgery on a temp copy: the pooled tensor is located as
the ReduceSum output feeding the theme projection, added to the graph's
outputs, and the copy's initializer bytes are digested before and after to
prove no shipped weight changed. The shipped artifacts are never modified.

Corpus: the W1 synthetic theme estate with identity labels
(scripts/run-weft-baseline-shootout.py, build_synthetic_estate, committed
code, fixed seed 20261127). The live v4 corpus is committed as pairs only
and carries no per-document identity keys, so the labeled estate is the
reproducible choice. Documents split held out by document, stratified by
identity key. A --corpus-jsonl override accepts rows of {id, text,
identity} for tests and alternative corpora.

Fail-closed contract, mirroring export-weft-quantized.py: typed errors with
exit 2 and a JSON {error, detail, kind} stderr line; a failed run never
appends to or alters a ledger. Absent artifacts, missing control weights, a
digest mismatch against the release manifest, an empty or single-identity
corpus, or a class missing from a split is a typed error, never a silent
skip. Honesty rule: an accuracy below chance is recorded as a belowChance
flag, never hidden and never an error; recovery above chance is a finding
to report plainly.

Ledger: results/weft-h2-identity-probe.json (kind weft-h2-identity-probe,
schemaVersion 1, append-only), the W5 write_entry pattern: runId is the
sha256 of the canonical entry JSON, written through a temp file plus an
atomic rename, and a rerun with unchanged inputs reproduces the same runId
and is a no-op.

Usage:
  python scripts/run-weft-h2-identity-probe.py                     # the real probe
  python scripts/run-weft-h2-identity-probe.py --self-test         # dependency-light self check
  python scripts/run-weft-h2-identity-probe.py --models-dir DIR    # artifact location override
  python scripts/run-weft-h2-identity-probe.py --corpus-jsonl ROWS.jsonl
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
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIND = "weft-h2-identity-probe"
SCHEMA_VERSION = 1
TICKET = "H2"
ERROR_KIND = "weft-h2-probe-error"
DEFAULT_SEED = 20261127
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
HARNESS = ROOT / "scripts" / "run-weft-baseline-shootout.py"
MANIFEST = ROOT / "release" / "weft-specialist-v1" / "RELEASE-MANIFEST.json"
DEFAULT_LEDGER = ROOT / "results" / "weft-h2-identity-probe.json"
ARTIFACTS = [
    {"id": "weft-int4", "level": "int4-matmulnbits",
     "path": "models/weft-specialist-quantized/weft-int4.onnx"},
    {"id": "weft-int8-reference", "level": "int8-dynamic",
     "path": "models/weft-specialist-quantized/weft-int8-reference.onnx"},
]
# The probe family is fixed and reported; nonlinear recovery is probe-family-specific.
PROBE_FAMILIES = ["mlp-relu-1x64", "rbf-svm-c10-scale"]
MLP_HIDDEN = 64
MLP_EPOCHS = 400
SVC_C = 10.0
SVC_GAMMA = "scale"
EVAL_FRACTION = 0.25
MAX_TOKEN_LENGTH = 128
EMBED_BATCH = 32
CONTROL_CONDITION = "control-frozen-base"
# Built from fragments so this compliance check does not itself carry the literal terms.
BANNED = ("mathematically" + " grounded", "elimin" + "ates", "identity-" + "removed",
          "perceive" + " everything", "atomic" + " knowledge")


# ---------------------------------------------------------------------------
# Typed fail-closed errors
# ---------------------------------------------------------------------------

class WeftH2Error(Exception):
    kind = "WEFT_H2_PROBE_ERROR"

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class CorpusMissing(WeftH2Error):
    kind = "WEFT_CORPUS_MISSING"


class CorpusMalformed(WeftH2Error):
    kind = "WEFT_CORPUS_MALFORMED"


class SingleIdentityCorpus(WeftH2Error):
    kind = "WEFT_CORPUS_SINGLE_IDENTITY"


class SplitError(WeftH2Error):
    kind = "WEFT_SPLIT_ERROR"


class ManifestMissing(WeftH2Error):
    kind = "WEFT_MANIFEST_MISSING"


class ArtifactMissing(WeftH2Error):
    kind = "WEFT_ARTIFACT_MISSING"


class ArtifactDigestMismatch(WeftH2Error):
    kind = "WEFT_ARTIFACT_DIGEST_MISMATCH"


class GraphSurgeryError(WeftH2Error):
    kind = "WEFT_GRAPH_SURGERY_ERROR"


class ControlWeightsMissing(WeftH2Error):
    kind = "WEFT_CONTROL_WEIGHTS_MISSING"


class LedgerIncompatible(WeftH2Error):
    kind = "WEFT_LEDGER_INCOMPATIBLE"


def fail(exc: WeftH2Error) -> int:
    """Typed fail-closed exit: one JSON stderr line, exit 2, nothing written."""
    print(json.dumps({"error": exc.kind, "detail": exc.detail, "kind": ERROR_KIND},
                     sort_keys=True), file=sys.stderr)
    return 2


# ---------------------------------------------------------------------------
# Digests and ledger plumbing (the W5 write_entry pattern)
# ---------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(1 << 16)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def sha256_file_lf(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def check_ledger(out: Path) -> None:
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
    """Append-only ledger: the entry already carries its content-addressed
    runId; the artifact is written through a temp file plus an atomic rename."""
    artifact = {"kind": KIND, "schemaVersion": SCHEMA_VERSION, "appendOnly": True, "entries": []}
    if out.exists():
        prior = json.loads(out.read_text(encoding="utf-8"))
        if prior.get("kind") != KIND or prior.get("appendOnly") is not True:
            raise LedgerIncompatible(f"refusing to overwrite an incompatible ledger: {out}")
        artifact["entries"] = prior.get("entries", [])
    artifact["entries"].append(entry)
    payload = json.dumps(artifact, indent=2)
    lowered = payload.lower()
    for word in BANNED:
        if word.lower() in lowered:
            raise WeftH2Error(f"banned word present in ledger payload: {word}")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + f".tmp-{os.getpid()}")
    tmp.write_bytes(payload.encode("utf-8"))
    os.replace(tmp, out)
    return artifact


# ---------------------------------------------------------------------------
# Corpus and split
# ---------------------------------------------------------------------------

def load_corpus(corpus_jsonl: Path | None) -> tuple[list[dict], dict]:
    """Rows are {id, text, identity}. Fail closed on any degenerate corpus."""
    if corpus_jsonl is not None:
        rows, meta = _corpus_from_jsonl(corpus_jsonl)
    else:
        rows, meta = _corpus_from_estate()
    _validate_corpus(rows)
    return rows, meta


def _validate_corpus(rows: list[dict]) -> None:
    if not rows:
        raise CorpusMalformed("the corpus is empty")
    labels = sorted({r["identity"] for r in rows})
    if len(labels) < 2:
        raise SingleIdentityCorpus(
            f"the corpus yields {len(labels)} identity key(s); the probe is multi-class "
            "and needs at least two")
    for label in labels:
        count = sum(1 for r in rows if r["identity"] == label)
        if count < 2:
            raise CorpusMalformed(
                f"identity key {label!r} has {count} document(s); every key needs at "
                "least two for a held-out split")


def _corpus_from_jsonl(path: Path) -> tuple[list[dict], dict]:
    if not path.exists():
        raise CorpusMissing(f"corpus file is absent: {path}")
    rows: list[dict] = []
    seen: set[str] = set()
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception as exc:  # noqa: BLE001
            raise CorpusMalformed(f"{path.name}:{lineno}: not JSON: {exc}") from exc
        if not isinstance(row, dict):
            raise CorpusMalformed(f"{path.name}:{lineno}: row is not an object")
        for field in ("id", "text", "identity"):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise CorpusMalformed(
                    f"{path.name}:{lineno}: field {field!r} must be a nonempty string")
        if row["id"] in seen:
            raise CorpusMalformed(f"{path.name}:{lineno}: duplicate id {row['id']!r}")
        seen.add(row["id"])
        rows.append({"id": row["id"], "text": row["text"], "identity": row["identity"]})
    return rows, {"kind": "jsonl-corpus", "sha256": sha256_file_lf(path), "rows": len(rows)}


def _corpus_from_estate() -> tuple[list[dict], dict]:
    """The W1 synthetic theme estate: committed code, fixed seed, identity labels."""
    if not HARNESS.exists():
        raise CorpusMissing(f"the estate harness is absent: {HARNESS}")
    spec = importlib.util.spec_from_file_location("weft_h2_harness", HARNESS)
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)
    people = set(harness.PEOPLE)
    estate = harness.build_synthetic_estate(DEFAULT_SEED, False)
    if estate.get("kind") != "synthetic-theme-estate":
        raise CorpusMalformed(f"unexpected estate kind {estate.get('kind')!r}")
    rows: list[dict] = []
    for doc in estate["documents"]:
        hits = [e for e in doc.get("entities", []) if e in people]
        if len(hits) != 1:
            raise CorpusMalformed(
                f"estate doc {doc.get('id')!r} has {len(hits)} person entities; the "
                "primary identity key must be unambiguous")
        rows.append({"id": doc["id"], "text": doc["text"], "identity": hits[0]})
    meta = {"kind": "synthetic-theme-estate", "version": estate.get("version"),
            "seed": DEFAULT_SEED, "estateSha256": estate.get("estateSha256"),
            "themes": estate.get("themes"), "identityKeys": len({r["identity"] for r in rows}),
            "source": "scripts/run-weft-baseline-shootout.py build_synthetic_estate",
            "identitySource": "the estate's author person entity; the live v4 corpus is "
                              "committed as pairs only and carries no per-document labels"}
    return rows, meta


def split_documents(rows: list[dict], seed: int,
                    eval_fraction: float) -> tuple[list[int], list[int], dict]:
    """Held out by document, stratified by identity key, fixed seed every run."""
    labels = sorted({r["identity"] for r in rows})
    by_label: dict[str, list[int]] = {label: [] for label in labels}
    for idx, row in enumerate(rows):
        by_label[row["identity"]].append(idx)
    rng = random.Random(seed)
    train_idx: list[int] = []
    eval_idx: list[int] = []
    for label in labels:
        pool = sorted(by_label[label])
        rng.shuffle(pool)
        eval_n = max(1, round(len(pool) * eval_fraction))
        batch_train = pool[eval_n:]
        if not batch_train:
            raise SplitError(f"identity key {label!r} has no training document left")
        train_idx.extend(batch_train)
        eval_idx.extend(pool[:eval_n])
    train_labels = {rows[i]["identity"] for i in train_idx}
    eval_labels = {rows[i]["identity"] for i in eval_idx}
    if train_labels != set(labels) or eval_labels != set(labels):
        raise SplitError(
            "the split leaves identity keys unrepresented: "
            f"{sorted(set(labels) - train_labels) + sorted(set(labels) - eval_labels)}")
    return sorted(train_idx), sorted(eval_idx), {
        "total": len(rows), "train": len(train_idx), "eval": len(eval_idx),
        "identityKeys": len(labels), "evalFraction": eval_fraction,
        "heldOut": "by document, stratified by identity key", "seed": seed}


def chance_baseline(rows, train_idx, eval_idx) -> dict:
    """Majority-class chance baseline measured on the eval split distribution."""
    counts: dict[str, int] = {}
    for i in eval_idx:
        key = rows[i]["identity"]
        counts[key] = counts.get(key, 0) + 1
    majority = max(sorted(counts), key=lambda k: counts[k])
    return {"majorityIdentity": majority,
            "evalFrequency": counts[majority] / len(eval_idx),
            "evalIdentityCounts": {k: counts[k] for k in sorted(counts)},
            "note": "top-1 accuracy of always guessing the majority identity of the "
                    "eval split; the probe must clear it to show recovery"}


# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------

def encode_control(texts: list[str], seed: int):
    """Condition a: the frozen base encoder, fp32 MiniLM, masked-mean pooled."""
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        import numpy as np
        import torch
        from transformers import AutoModel, AutoTokenizer
    except Exception as exc:  # noqa: BLE001
        raise ControlWeightsMissing(
            f"the control needs torch and transformers installed: "
            f"{type(exc).__name__}: {exc}") from exc
    torch.set_num_threads(1)
    torch.manual_seed(seed)
    try:
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
        model = AutoModel.from_pretrained(BASE_MODEL)
    except Exception as exc:  # noqa: BLE001
        raise ControlWeightsMissing(
            f"the control weights for {BASE_MODEL} are not in the local HF cache "
            f"(offline, never downloads): {type(exc).__name__}: {exc}") from exc
    model.eval()
    out = []
    import transformers
    with torch.no_grad():
        for start in range(0, len(texts), EMBED_BATCH):
            batch = tokenizer(texts[start:start + EMBED_BATCH], padding="max_length",
                              truncation=True, max_length=MAX_TOKEN_LENGTH,
                              return_tensors="pt")
            mask = batch["attention_mask"].bool()
            hidden = model(**{k: v for k, v in batch.items()}).last_hidden_state
            pooled = (hidden * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True)
            out.append(pooled.numpy())
    versions = {"torch": torch.__version__, "transformers": transformers.__version__,
                "numpy": np.__version__}
    return np.concatenate(out, axis=0).astype("float32"), versions


def locate_pooled_tensors(model_proto) -> list[str]:
    """The pooled representation is the ReduceSum output feeding the theme
    projection. Located through the theme weight initializer so the rule holds
    for both shipped quantization levels; fail closed if the graph differs."""
    graph = model_proto.graph
    init_names = {init.name for init in graph.initializer}
    producers: dict[str, object] = {}
    for node in graph.node:
        for output in node.output:
            if output:
                producers[output] = node
    pooled: list[str] = []
    for node in graph.node:
        weight = next((i for i in node.input[1:]
                       if i in init_names and i.startswith("theme.") and i != "theme.bias_mm"), None)
        if weight is None or node.op_type not in ("MatMulNBits", "MatMulInteger",
                                                  "MatMul", "Gemm"):
            continue
        tensor = node.input[0]
        producer = producers.get(tensor)
        if producer is None:
            raise GraphSurgeryError(f"the tensor feeding {node.name!r} has no producer node")
        hops = 0
        while producer.op_type not in ("ReduceSum", "ReduceMean", "Sum"):
            upstream = producers.get(producer.input[0]) if producer.input else None
            if upstream is None or hops > 8:
                raise GraphSurgeryError(
                    f"cannot trace {node.name!r} back to a pooling node "
                    f"(reached {producer.op_type} {producer.name!r})")
            producer = upstream
            hops += 1
        pooled.append(producer.output[0])
    if len(pooled) != 2 or len(set(pooled)) != 2:
        raise GraphSurgeryError(
            f"expected exactly one anchor and one candidate pooled tensor, found {pooled}")
    return pooled


def initializer_digest(model_proto) -> str:
    """Digest over every initializer's name, dtype, and bytes, so the surgery
    provably leaves the shipped weights untouched."""
    h = hashlib.sha256()
    for init in model_proto.graph.initializer:
        h.update(init.name.encode("utf-8"))
        h.update(str(init.data_type).encode("utf-8"))
        h.update(init.SerializePartialToString())
    return h.hexdigest()


def encode_artifact(texts: list[str], spec: dict, models_dir: Path, tokenizer):
    """Conditions b and c: the shipped quantized artifact's internal pooled
    representation, exposed by read-only graph surgery on a temp copy."""
    import numpy as np
    basename = Path(spec["path"]).name
    artifact_path = models_dir / basename
    if not artifact_path.exists():
        # the default models dir carries the quantized subdirectory
        artifact_path = models_dir / "weft-specialist-quantized" / basename
    if not artifact_path.exists():
        raise ArtifactMissing(
            f"the shipped artifact {spec['id']} is absent under {models_dir}; a run records "
            "no number for an absent condition")
    digest = sha256_file(artifact_path)
    pinned = manifest_pins()
    expected = pinned.get(spec["path"])
    if expected and expected != digest:
        raise ArtifactDigestMismatch(
            f"{artifact_path.name} sha256 {digest} does not match the release manifest "
            f"pin {expected}")

    import onnx
    from onnx import TensorProto, helper
    proto = onnx.load(str(artifact_path))
    before = initializer_digest(proto)
    pooled_names = locate_pooled_tensors(proto)
    for name in pooled_names:
        if name not in [o.name for o in proto.graph.output]:
            proto.graph.output.append(
                helper.make_tensor_value_info(name, TensorProto.FLOAT, None))
    import onnxruntime  # noqa: F401 - version is recorded in the environment block
    with tempfile_dir() as tmp:
        probe_path = Path(tmp) / f"{artifact_path.stem}-probe.onnx"
        onnx.save(proto, str(probe_path))
        after = initializer_digest(onnx.load(str(probe_path)))
        if after != before:
            raise GraphSurgeryError(
                "graph surgery changed the shipped initializer bytes; refusing to proceed")
        session = onnxruntime.InferenceSession(str(probe_path),
                                               providers=["CPUExecutionProvider"])
        embeddings, rows_pooled = [], 0
        for start in range(0, len(texts), EMBED_BATCH):
            enc = tokenizer(texts[start:start + EMBED_BATCH], padding="max_length",
                            truncation=True, max_length=MAX_TOKEN_LENGTH,
                            return_tensors="np")
            feed = {"inputIdsA": enc["input_ids"].astype("int64"),
                    "attentionMaskA": enc["attention_mask"].astype("int64"),
                    "inputIdsB": enc["input_ids"].astype("int64"),
                    "attentionMaskB": enc["attention_mask"].astype("int64")}
            outputs = session.run(None, feed)
            pooled = outputs[-2:]  # the surgery appended anchor then candidate
            if int(pooled[0].shape[1]) != 384:
                raise GraphSurgeryError(
                    f"unexpected pooled width {pooled[0].shape[1]}; the graph's pooling "
                    "output is not the MiniLM hidden width")
            rows_pooled += int(pooled[0].shape[0])
            embeddings.append(pooled[0])
        if rows_pooled != len(texts):
            raise GraphSurgeryError(
                f"the graph returned {rows_pooled} pooled rows for {len(texts)} documents")
        return (np.concatenate(embeddings, axis=0).astype("float32"),
                {"id": spec["id"], "level": spec["level"], "path": spec["path"],
                 "sha256": digest, "pooledTensors": pooled_names,
                 "surgeryAddedOutputs": 2, "initializerDigestUnchanged": True,
                 "runtime": "onnxruntime CPUExecutionProvider",
                 "note": "the internal pooled tensor read out on a temp copy; the shipped "
                         "artifact on disk is never modified"})


def tempfile_dir():
    import tempfile
    return tempfile.TemporaryDirectory(prefix="weft-h2-surgery-")


def manifest_pins() -> dict:
    if not MANIFEST.exists():
        if os.environ.get("WEFT_H2_ALLOW_NO_MANIFEST") == "1":
            return {}
        raise ManifestMissing(f"the release manifest is absent: {MANIFEST}")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {entry["path"]: entry.get("sha256") for entry in manifest.get("artifacts", [])}


# ---------------------------------------------------------------------------
# Probes: the fixed, reported, externally trained attacker
# ---------------------------------------------------------------------------

def accuracy_block(y_true: list[str], y_pred: list[str]) -> dict:
    correct = sum(1 for a, b in zip(y_true, y_pred) if a == b)
    return {"top1Accuracy": correct / len(y_true) if y_true else 0.0,
            "correct": correct, "evalRows": len(y_true)}


def probe_features(features, train_idx, eval_idx, y_train, y_eval, seed: int,
                   epochs: int) -> dict:
    """Two fixed families, each externally trained on the frozen representation."""
    import numpy as np
    families = {}
    x_train, x_eval = np.asarray(features)[train_idx], np.asarray(features)[eval_idx]

    import sklearn
    from sklearn.svm import SVC
    svm = SVC(kernel="rbf", C=SVC_C, gamma=SVC_GAMMA, random_state=seed)
    svm.fit(x_train.astype("float64"), y_train)
    families["rbf-svm-c10-scale"] = {
        **accuracy_block(list(svm.predict(x_eval.astype("float64"))), y_eval),
        "library": f"scikit-learn-{sklearn.__version__}"}

    import torch
    from torch import nn
    torch.set_num_threads(1)
    torch.manual_seed(seed)
    classes = sorted(set(y_train))
    lookup = {label: i for i, label in enumerate(classes)}
    ytr = torch.tensor([lookup[label] for label in y_train])
    xtr = torch.tensor(x_train.astype("float32"))
    xev = torch.tensor(x_eval.astype("float32"))
    head = nn.Sequential(nn.Linear(xtr.shape[1], MLP_HIDDEN), nn.ReLU(),
                         nn.Linear(MLP_HIDDEN, len(classes)))
    optim = torch.optim.AdamW(head.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    final_loss = None
    for _ in range(epochs):
        optim.zero_grad()
        loss = loss_fn(head(xtr), ytr)
        loss.backward()
        optim.step()
        final_loss = float(loss.detach())
    inv = {i: label for label, i in lookup.items()}
    with torch.no_grad():
        pred = [inv[c] for c in head(xev).argmax(dim=-1).numpy()]
    families["mlp-relu-1x64"] = {
        **accuracy_block(pred, y_eval),
        "hiddenUnits": MLP_HIDDEN, "epochs": epochs, "seed": seed,
        "finalTrainLoss": final_loss,
        "optimizer": "adamW-lr1e-3", "library": f"torch-{torch.__version__}"}

    for name in PROBE_FAMILIES:
        if name not in families:
            raise WeftH2Error(f"probe family {name} was not trained; the family is fixed "
                              "and must be reported per condition")
    return {name: families[name] for name in PROBE_FAMILIES}


def probe_all(rows, train_idx, eval_idx, encoders: dict, seed: int, epochs: int) -> dict:
    """Train every fixed family on every condition's frozen representation."""
    conditions = {}
    for name in sorted(encoders):
        features, meta = encoders[name]()
        probes = probe_features(features, train_idx, eval_idx,
                                [rows[i]["identity"] for i in train_idx],
                                [rows[i]["identity"] for i in eval_idx], seed, epochs)
        for family, block in probes.items():
            gap = block["top1Accuracy"] - chance_baseline(rows, train_idx, eval_idx)["evalFrequency"]
            block["accuracyVsChance"] = round(gap, 10)
            block["belowChance"] = bool(gap < 0)
        conditions[name] = {"probes": probes, **meta}
    return conditions


# ---------------------------------------------------------------------------
# Ledger entry
# ---------------------------------------------------------------------------

def build_entry(rows, train_idx, eval_idx, seed: int, epochs: int, conditions: dict,
                corpus: dict, split: dict, environment: dict) -> dict:
    base = chance_baseline(rows, train_idx, eval_idx)
    entry = {
        "kind": KIND, "ticket": TICKET, "schemaVersion": SCHEMA_VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "task": {"formulation": "given a document's pooled embedding, predict the document's "
                                "primary identity key; multi-class top-1 accuracy",
                 "probeFamily": "|".join(PROBE_FAMILIES),
                 "probeExposure": "externally trained on the frozen representation, "
                                  "evaluated on held-out documents",
                 "note": "post-hoc nonlinear attacker, not the in-training adversary"},
        "corpus": corpus,
        "split": split,
        "chance": base,
        "probeFamilies": PROBE_FAMILIES,
        "conditions": conditions,
        "environment": environment,
        "honestyRule": "recovery above chance is a finding reported plainly; the wording "
                       "identity-blind means measured, not guaranteed absent",
        "verdict": "reported in the research note",
    }
    for name, cond in conditions.items():
        missing = [f for f in PROBE_FAMILIES if f not in cond["probes"]]
        if missing:
            raise WeftH2Error(f"condition {name} is missing probe family {missing}; "
                              "the probe family is fixed and must be reported")
    payload = {key: value for key, value in entry.items() if key != "createdAt"}
    entry["runId"] = hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
    return entry


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def self_test(seed: int, epochs: int, ledger_path: Path) -> dict:
    """Dependency-light self check: the shared probe core on deterministic fake
    encoders carrying a controlled identity signal, so the ledger contract, the
    idempotence, and the honesty flags hold without torch models or artifacts.
    The heavy probes still run locally; the self test exists so the fail-closed
    contract is exercised everywhere the repo is checked out."""
    import numpy as np
    identities = [f"person-{i:02d}" for i in range(8)]
    rng = random.Random(seed)
    codes = {}
    rows = []
    for i in range(160):
        label = identities[i % len(identities)]
        code = rng.randrange(1 << 30)
        codes[code] = None
        rows.append({"id": f"doc-{i:04d}", "text": f"synthetic row {i}",
                     "identity": label, "code": code})
    offset_rng = random.Random(seed + 1)
    offsets = {label: np.float32(offset_rng.random() * 8.0) for label in identities}
    shared_rng = random.Random(seed + 2)
    code_table: dict[int, np.ndarray] = {}
    def base_vector(code: int) -> np.ndarray:
        if code not in code_table:
            vec = np.zeros(24, dtype="float32")
            for j in range(len(vec)):
                vec[j] = np.float32(shared_rng.random())
            code_table[code] = vec
        return code_table[code]
    def factory(noise: float, tag: str):
        def encoder():
            out = np.stack([
                base_vector(r["code"]) + offsets[r["identity"]]
                + np.float32(noise * (rng.random() - 0.5)) for r in rows])
            return out.astype("float32"), {"encoder": f"self-test-{tag}", "noiseScale": noise}
        return encoder
    train_idx, eval_idx, split_meta = split_documents(rows, seed, EVAL_FRACTION)
    encoders = {
        "self-control": factory(0.05, "control"),
        "self-int4": factory(0.5, "int4"),
        "self-int8": factory(0.25, "int8"),
    }
    conditions = probe_all(rows, train_idx, eval_idx, encoders, seed, epochs)
    entry = build_entry(rows, train_idx, eval_idx, seed, epochs, conditions,
                        {"kind": "self-test-synthetic", "rows": len(rows),
                         "identityKeys": len(identities)},
                        split_meta, {"mode": "self-test"})
    prior = (json.loads(ledger_path.read_text(encoding="utf-8"))
             if ledger_path.exists() else None)
    if prior and any(e.get("runId") == entry["runId"] for e in prior.get("entries", [])):
        return {"runId": entry["runId"], "ledger": str(ledger_path), "noOp": True,
                "selfTest": True}
    written = write_entry(ledger_path, entry)
    return {"runId": entry["runId"], "ledger": str(ledger_path),
            "entries": len(written["entries"]), "noOp": False, "selfTest": True}


def verify_artifacts_present(models_dir: Path) -> None:
    """Cheap fail-closed pass before any heavy import: every shipped artifact
    exists and its sha256 matches the release manifest pin."""
    pins = manifest_pins()
    for spec in ARTIFACTS:
        basename = Path(spec["path"]).name
        artifact_path = models_dir / basename
        if not artifact_path.exists():
            # the default models dir carries the quantized subdirectory
            artifact_path = models_dir / "weft-specialist-quantized" / basename
        if not artifact_path.exists():
            raise ArtifactMissing(
                f"the shipped artifact {spec['id']} is absent under {models_dir}; a run "
                "records no number for an absent condition")
        digest = sha256_file(artifact_path)
        expected = pins.get(spec["path"])
        if expected and expected != digest:
            raise ArtifactDigestMismatch(
                f"{artifact_path.name} sha256 {digest} does not match the release "
                f"manifest pin {expected}")


def real_run(args) -> dict:
    ledger_path = Path(args.ledger)
    check_ledger(ledger_path)
    rows, corpus_meta = load_corpus(Path(args.corpus_jsonl) if args.corpus_jsonl else None)
    train_idx, eval_idx, split_meta = split_documents(rows, args.seed, EVAL_FRACTION)
    texts = [r["text"] for r in rows]

    models_dir = Path(args.models_dir)
    verify_artifacts_present(models_dir)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    except Exception as exc:  # noqa: BLE001
        raise ControlWeightsMissing(
            f"the control tokenizer for {BASE_MODEL} is not in the local HF cache "
            f"(offline, never downloads): {type(exc).__name__}: {exc}") from exc

    import numpy as np
    import onnxruntime
    environment = {"python": platform.python_version(), "platform": platform.platform(),
                   "numpy": np.__version__, "onnxruntime": onnxruntime.__version__,
                   "modelCardTouched": False, "claimAuditTouched": False}

    models_dir = Path(args.models_dir)
    artifact_meta: dict[str, dict] = {}
    artifact_features: dict[str, np.ndarray] = {}
    for spec in ARTIFACTS:
        arr, info = encode_artifact(texts, spec, models_dir, tokenizer)
        artifact_features[f"artifact-{spec['level']}"] = arr
        artifact_meta[f"artifact-{spec['level']}"] = info

    control, control_versions = encode_control(texts, args.seed)
    control_meta = {"embedding": "all-MiniLM-L6-v2 masked-mean pooled (fp32)",
                    "role": "the frozen base encoder control", "versions": control_versions}

    def encoder_for(condition: str):
        if condition == CONTROL_CONDITION:
            return control, control_meta
        return artifact_features[condition], artifact_meta[condition]

    conditions = {}
    for name in sorted([CONTROL_CONDITION] + list(artifact_features)):
        arr, meta = encoder_for(name)
        probes = probe_features(arr, train_idx, eval_idx,
                                [rows[i]["identity"] for i in train_idx],
                                [rows[i]["identity"] for i in eval_idx], args.seed,
                                args.probe_epochs)
        base = chance_baseline(rows, train_idx, eval_idx)
        for family, block in probes.items():
            gap = block["top1Accuracy"] - base["evalFrequency"]
            block["accuracyVsChance"] = round(gap, 10)
            block["belowChance"] = bool(gap < 0)
        conditions[name] = {"probes": probes, **meta}

    entry = build_entry(rows, train_idx, eval_idx, args.seed, args.probe_epochs, conditions,
                        {**corpus_meta, "rows": len(rows),
                         "identityKeys": len({r["identity"] for r in rows})},
                        split_meta, environment)
    prior = (json.loads(ledger_path.read_text(encoding="utf-8"))
             if ledger_path.exists() else None)
    if prior and any(e.get("runId") == entry["runId"] for e in prior.get("entries", [])):
        return {"runId": entry["runId"], "ledger": str(ledger_path), "noOp": True,
                "conditions": sorted(conditions)}
    written = write_entry(ledger_path, entry)
    return {"runId": entry["runId"], "ledger": str(ledger_path),
            "entries": len(written["entries"]), "noOp": False,
            "conditions": sorted(conditions)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args(argv):
    ap = argparse.ArgumentParser(description="Weft H2 identity-blindness probe (issue #60)")
    ap.add_argument("--ledger", default=str(DEFAULT_LEDGER))
    ap.add_argument("--models-dir", default=str(ROOT / "models"))
    ap.add_argument("--manifest", default=str(MANIFEST))
    ap.add_argument("--corpus-jsonl", default=None)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--probe-epochs", type=int, default=MLP_EPOCHS)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.corpus_jsonl and not Path(args.corpus_jsonl).exists():
        raise CorpusMissing(f"corpus file is absent: {args.corpus_jsonl}")
    return args


def main(argv=None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    global MANIFEST
    MANIFEST = Path(args.manifest)
    try:
        result = (self_test(args.seed, args.probe_epochs, Path(args.ledger))
                  if args.self_test else real_run(args))
    except WeftH2Error as exc:
        return fail(exc)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
