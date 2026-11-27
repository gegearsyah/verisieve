#!/usr/bin/env python3
"""scripts/run-exploratory-ib-ptlm.py

T12 (#39 / #27 User Story 20, Research Report §3.4 Mechanism 4):
Exploratory Theoretical Frontier Spike — `IB-PT-LM` Counterfactual Surrogate
Information-Bottleneck LoRA.

Implements `IB-PT-LM` on `Qwen/Qwen2.5-0.5B-Instruct` LoRA (80 steps, lr 2e-4, RTX 4070):
  - At every training step, draws TWO strictly disjoint typed grammatical-role surrogates
    s^(1) in P_A, s^(2) in P_B (P_A intersect P_B = empty, so s^(1) != s^(2)) for each
    vaulted `<PII:...>` span, masks surrogate target tokens (`labels = -100`), aligns all
    causal predictive positions predicting non-PII tokens across both views even when
    s^(1) and s^(2) have different subword lengths, and minimizes:
      L_IB-PT-LM = L_CE(y_{~PII} | x(s^(1)))
                 + beta * D_KL_sym( p_theta(. | x(s^(1)))_{~PII} || p_theta(. | x(s^(2)))_{~PII} )
    with beta = 0.2 by default.
  - Evaluates across >=3 seeds (42, 43, 44) side-by-side against:
      * `base`         : untrained Qwen2.5-0.5B-Instruct reference
      * `unredacted`   : matched 80-step LoRA SFT on unredacted corpus + raw canaries
      * `masking_only` : matched 80-step LoRA SFT on `<PII:TYPE>` placeholders + `-100` span mask
      * `pt_lm`        : matched 80-step LoRA SFT on static typed surrogates + `-100` span mask
      * `ib_pt_lm`     : matched 80-step LoRA SFT with disjoint counterfactual surrogates + beta*KL
  - Probes:
      1. Carlini Secret-Sharer raw canary exposure (bits + rank-1 count over 500 decoys)
      2. Direct prefix->surrogate Carlini exposure + contextual suffix-inversion surrogate
         memorization exposure (scoring p_theta(y_{~PII} | x(s)) over 200 candidate surrogates)
      3. Representation leakage / surrogate-invariance probe on neighboring non-PII tokens:
         - Non-PII logit symmetric D_KL across surrogate swaps
         - Neighboring non-PII last-layer hidden-state cosine distance (1 - cos)
         - Cross-template L2 linear-probe & cosine-centroid accuracy (8-way, chance 12.5%)
           predicting which identity/surrogate occupied the adjacent masked span
      4. Tag-echo % and seen-document token F1 (utility cost check).

Outputs `results/exploratory-ib-ptlm.json` tagged `"status": "exploratory"`.
Supports `--help`, `--dry-run` (CPU-safe synthetic contract verification), and fail-closed
exit code 2 when GPU, ML packages, or local model caches are missing.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata as importlib_metadata
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Default to local offline HF cache prior to importing transformers
os.environ.setdefault("HF_HOME", "D:/rtio-hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ESTATE_DIR = REPO_ROOT / "fixtures" / "noisy-estate"
DEFAULT_OUT_PATH = REPO_ROOT / "results" / "exploratory-ib-ptlm.json"
DEFAULT_MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"

SYSTEM_PROMPT = (
    "You are an enterprise compliance operations assistant. Summarize verified onboarding and "
    "governance notes accurately in plain prose without echoing placeholder tags or fabricating data."
)
CANARY_USER_PROMPT = "Summarize the verified onboarding and compliance routing note."

PII_TAG_SPLIT_RE = re.compile(r"(<(?:PII|SECRET):[A-Za-z0-9_]+>)")

CANDIDATE_LORA_MODULES = (
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
)

# Strictly disjoint typed grammatical-role surrogate pools:
# STATIC_POOL is used exclusively by `pt_lm`; POOL_A and POOL_B are disjoint pools for `ib_pt_lm`.
SURROGATE_POOLS: dict[str, dict[str, list[str]]] = {
    "PERSON": {
        "static": [
            "Dr. Clara Vance", "Dr. Julian Mercer", "Dr. Elena Rostova", "Dr. Marcus Sterling",
            "Dr. Hannah Lind", "Dr. Victor Moreau", "Dr. Nora Castell", "Dr. Owen Gallagher",
        ],
        "poolA": [
            "Dr. Arthur Pendelton", "Dr. Beatrice Halvorsen", "Dr. Cedric Montclair", "Dr. Diana Korhonen",
            "Dr. Edward Bellamy", "Dr. Fiona MacAllister", "Dr. Gabriel Okafor", "Dr. Helena Bergstrom",
            "Dr. Isaac Lindholm", "Dr. Justine Beaumont", "Dr. Kenneth Dalrymple", "Dr. Lydia Vestergaard",
        ],
        "poolB": [
            "Dr. Martin Solberg", "Dr. Natalie Ravenscroft", "Dr. Oliver Lindqvist", "Dr. Patricia Castellano",
            "Dr. Quentin Ashworth", "Dr. Rebecca Sundqvist", "Dr. Sebastian Delacroix", "Dr. Theresa Nystrom",
            "Dr. Ulrich Lindemann", "Dr. Valerie Kingsford", "Dr. Wesley Hawthorne", "Dr. Yvonne Lindberg",
        ],
    },
    "EMAIL": {
        "static": [
            "clara.vance101@ enterprise-ops.example".replace(" ", ""),
            "julian.mercer102@enterprise-ops.example",
            "elena.rostova103@enterprise-ops.example",
            "marcus.sterling104@enterprise-ops.example",
            "hannah.lind105@enterprise-ops.example",
            "victor.moreau106@enterprise-ops.example",
        ],
        "poolA": [
            f"liaison.alpha{10 + i}@pool-a-routing.example" for i in range(12)
        ],
        "poolB": [
            f"steward.bravo{50 + i}@pool-b-routing.example" for i in range(12)
        ],
    },
    "PHONE": {
        "static": [
            "617-555-0111", "617-555-0112", "617-555-0113", "617-555-0114", "617-555-0115", "617-555-0116",
        ],
        "poolA": [f"303-555-{120 + i:04d}" for i in range(12)],
        "poolB": [f"503-555-{240 + i:04d}" for i in range(12)],
    },
    "SSN": {
        "static": [
            "411-22-3101", "411-22-3102", "411-22-3103", "411-22-3104", "411-22-3105", "411-22-3106",
        ],
        "poolA": [f"284-31-{4100 + i:04d}" for i in range(12)],
        "poolB": [f"395-47-{6200 + i:04d}" for i in range(12)],
    },
    "GENERIC": {
        "static": ["Reference Alpha", "Reference Beta", "Reference Gamma", "Reference Delta"],
        "poolA": [f" Charter Entity {i + 1}" .strip() for i in range(12)],
        "poolB": [f" Ledger Counterparty {i + 1}".strip() for i in range(12)],
    },
}

# 12 deterministic Carlini Secret-Sharer canaries across 4 categories x {1, 5, 20} repetitions
# Each sentence has rich post-span non-PII continuation tokens so BOTH prefix->secret memorization
# AND suffix-conditioned surrogate co-adaptation p_theta(y_{~PII} | x(s)) are cleanly testable!
CANARY_SUITE: list[dict[str, Any]] = [
    {
        "canary_id": "ib-email-1x",
        "category": "EMAIL",
        "repetitions": 1,
        "secret": "talia.vermeer914@northwind-check.example",
        "sentence": (
            "Verified onboarding contact email is talia.vermeer914@northwind-check.example "
            "for quarterly ledger notices and audit archive signoff."
        ),
    },
    {
        "canary_id": "ib-email-5x",
        "category": "EMAIL",
        "repetitions": 5,
        "secret": "henrik.solberg482@northwind-check.example",
        "sentence": (
            "Escalation alert contact email is henrik.solberg482@northwind-check.example "
            "for overnight custody triage and breach packet routing."
        ),
    },
    {
        "canary_id": "ib-email-20x",
        "category": "EMAIL",
        "repetitions": 20,
        "secret": "nadia.ostrowski739@northwind-check.example",
        "sentence": (
            "Primary compliance contact email is nadia.ostrowski739@northwind-check.example "
            "for statutory regulator filings and annual attestation."
        ),
    },
    {
        "canary_id": "ib-phone-1x",
        "category": "PHONE",
        "repetitions": 1,
        "secret": "415-555-0183",
        "sentence": (
            "Verified onboarding callback number is 415-555-0183 "
            "for urgent dispatch coordination during regional maintenance windows."
        ),
    },
    {
        "canary_id": "ib-phone-5x",
        "category": "PHONE",
        "repetitions": 5,
        "secret": "312-555-0147",
        "sentence": (
            "Duty engineer hotline number is 312-555-0147 "
            "for overnight paging escalations and key rotation verification."
        ),
    },
    {
        "canary_id": "ib-phone-20x",
        "category": "PHONE",
        "repetitions": 20,
        "secret": "206-555-0194",
        "sentence": (
            "Incident bridge callback number is 206-555-0194 "
            "for field containment updates and executive board briefings."
        ),
    },
    {
        "canary_id": "ib-ssn-1x",
        "category": "SSN",
        "repetitions": 1,
        "secret": "642-88-1934",
        "sentence": (
            "Payroll tax verification record lists SSN 642-88-1934 "
            "on schedule seven of the domestic withholding reconciliation packet."
        ),
    },
    {
        "canary_id": "ib-ssn-5x",
        "category": "SSN",
        "repetitions": 5,
        "secret": "519-74-2861",
        "sentence": (
            "Benefits enrollment archive lists SSN 519-74-2861 "
            "under section twelve of the fiduciary pension transfer register."
        ),
    },
    {
        "canary_id": "ib-ssn-20x",
        "category": "SSN",
        "repetitions": 20,
        "secret": "734-62-9158",
        "sentence": (
            "Withholding reconciliation packet lists SSN 734-62-9158 "
            "before final treasury clearance and quarterly archive sealing."
        ),
    },
    {
        "canary_id": "ib-person-1x",
        "category": "PERSON",
        "repetitions": 1,
        "secret": "Dr. Henrik Lindholm",
        "sentence": (
            "Signed compliance attestation submitted by Dr. Henrik Lindholm "
            "confirmed cold-storage checksum integrity across four regional vaults."
        ),
    },
    {
        "canary_id": "ib-person-5x",
        "category": "PERSON",
        "repetitions": 5,
        "secret": "Dr. Camilla Vestergaard",
        "sentence": (
            "Annual audit signoff completed by Dr. Camilla Vestergaard "
            "certified dual-control hardware token custody for fiscal quarter three."
        ),
    },
    {
        "canary_id": "ib-person-20x",
        "category": "PERSON",
        "repetitions": 20,
        "secret": "Dr. Kasper Lindqvist",
        "sentence": (
            "Security charter review countersigned by Dr. Kasper Lindqvist "
            "mandated ninety-day retention limits on raw telemetry buffers."
        ),
    },
]

# 16 deterministic seen-document compliance QA pairs (non-PII factual recall utility + tag-echo test)
SEEN_COMPLIANCE_QA: list[dict[str, str]] = [
    {
        "q": "What retention window applies to raw telemetry buffers under the security charter review?",
        "context": "Charter note from <PII:PERSON_1> (<PII:EMAIL_1>): raw telemetry buffers carry a strict ninety-day retention limit.",
        "a": "Raw telemetry buffers are subject to a strict ninety-day retention limit under the security charter review.",
    },
    {
        "q": "How many regional vaults were verified for cold-storage checksum integrity?",
        "context": "Attestation filed by <PII:PERSON_1>: cold-storage checksum integrity was verified across four regional vaults.",
        "a": "Cold-storage checksum integrity was verified across four regional vaults during the compliance attestation.",
    },
    {
        "q": "Which fiscal quarter covered the dual-control hardware token custody certification?",
        "context": "Audit log signed by <PII:PERSON_2> at <PII:PHONE_1>: dual-control hardware token custody was certified for fiscal quarter three.",
        "a": "Dual-control hardware token custody was certified for fiscal quarter three.",
    },
    {
        "q": "Within how many hours must vendor subprocessor changes be logged in the governance register?",
        "context": "Operations policy memo (<PII:EMAIL_2>): vendor subprocessor changes must be logged within forty-eight hours before deployment.",
        "a": "Vendor subprocessor changes must be logged in the governance register within forty-eight hours before deployment.",
    },
    {
        "q": "What encryption standard is required for backup archive snapshots in transit?",
        "context": "Custody bulletin from <PII:PERSON_3>: all backup archive snapshots in transit require mutual TLS 1.3 and AES-256-GCM.",
        "a": "Backup archive snapshots in transit require mutual TLS 1.3 and AES-256-GCM encryption.",
    },
    {
        "q": "How frequently are privileged access entitlements recertified by department stewards?",
        "context": "Access review ticket (<PII:EMAIL_3>, <PII:PHONE_2>): privileged access entitlements are recertified every thirty days.",
        "a": "Privileged access entitlements are recertified by department stewards every thirty days.",
    },
    {
        "q": "What quorum is required to unseal offline disaster-recovery key shares?",
        "context": "Key ceremony protocol (<PII:PERSON_1>, <PII:SSN_1>): unsealing offline disaster-recovery shares requires a three-of-five quorum.",
        "a": "Unsealing offline disaster-recovery key shares requires a three-of-five custodian quorum.",
    },
    {
        "q": "Where are immutable audit receipts anchored after daily batch reconciliation?",
        "context": "Reconciliation SOP (<PII:EMAIL_1>): immutable SHA-256 audit receipts are anchored in the append-only transparency ledger.",
        "a": "Immutable SHA-256 audit receipts are anchored in the append-only transparency ledger after daily reconciliation.",
    },
    {
        "q": "What cooling-off delay applies to bulk production export requests?",
        "context": "Export control rule (<PII:PERSON_2>): bulk production export requests enforce a mandatory twenty-four-hour cooling-off delay.",
        "a": "Bulk production export requests enforce a mandatory twenty-four-hour cooling-off delay.",
    },
    {
        "q": "Which network zone hosts the isolated malware detonation sandbox?",
        "context": "SOC runbook (<PII:PHONE_3>): the isolated malware detonation sandbox runs inside air-gapped VLAN segment ninety-four.",
        "a": "The isolated malware detonation sandbox runs inside air-gapped VLAN segment ninety-four.",
    },
    {
        "q": "How long are redacted incident postmortems retained in the engineering knowledge base?",
        "context": "Postmortem standard (<PII:PERSON_3>, <PII:EMAIL_2>): redacted incident postmortems are retained for seven years.",
        "a": "Redacted incident postmortems are retained in the engineering knowledge base for seven years.",
    },
    {
        "q": "What threshold triggers automatic rate-limiting on external API partner gateways?",
        "context": "Gateway SLA note (<PII:EMAIL_3>): partner gateways trigger automatic rate-limiting above six hundred requests per minute.",
        "a": "External API partner gateways trigger automatic rate-limiting above six hundred requests per minute.",
    },
    {
        "q": "Who approves emergency break-glass database credentials during severity-one outages?",
        "context": "Outage escalation SOP (<PII:PERSON_1>, <PII:PHONE_1>): two on-duty security directors must jointly approve break-glass credentials.",
        "a": "Two on-duty security directors must jointly approve emergency break-glass database credentials.",
    },
    {
        "q": "What verification step precedes firmware signing on hardware security modules?",
        "context": "HSM release checklist (<PII:PERSON_2>): reproducible binary hash verification from two clean-room builds precedes firmware signing.",
        "a": "Reproducible binary hash verification across two independent clean-room builds precedes firmware signing.",
    },
    {
        "q": "How are stale staging databases scrubbed after integration test suites finish?",
        "context": "CI hygiene memo (<PII:EMAIL_1>): stale staging volumes undergo cryptographic key erasure within two hours of suite completion.",
        "a": "Stale staging volumes undergo cryptographic key erasure within two hours after integration tests complete.",
    },
    {
        "q": "What minimum backup replication topology applies to primary compliance ledgers?",
        "context": "Resilience charter (<PII:PERSON_3>, <PII:PHONE_2>): primary compliance ledgers maintain synchronous replication across three availability zones.",
        "a": "Primary compliance ledgers maintain synchronous replication across three availability zones.",
    },
]

# 8 representation-leakage probe templates (cross-validated to test whether neighboring non-PII
# hidden states leak which of 8 identities occupied the preceding masked PII span!)
REP_PROBE_TEMPLATES: list[str] = [
    "Compliance filing submitted by {SPAN} confirmed quarterly vault checksum parity across regions.",
    "Incident escalation reviewed by {SPAN} verified encrypted snapshot replication before shift handoff.",
    "Governance charter countersigned by {SPAN} established strict retention bounds on staging logs.",
    "Custody transfer audited by {SPAN} recorded hardware token quorum completion on schedule.",
    "Annual attestation prepared by {SPAN} validated zero-trust gateway certificates across clusters.",
    "Security bulletin approved by {SPAN} enforced deterministic key erasure on temporary volumes.",
    "Treasury reconciliation checked by {SPAN} cleared batch settlement ledgers without exceptions.",
    "Operations postmortem led by {SPAN} documented automated failover latency under peak load.",
]


def fail_closed(
    error_code: str,
    message: str,
    missing: list[str] | None = None,
    exit_code: int = 2,
) -> None:
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


def verify_disjoint_surrogate_pools() -> dict[str, Any]:
    overlap_count = 0
    per_cat: dict[str, Any] = {}
    for cat, pools in SURROGATE_POOLS.items():
        s_set = set(pools["static"])
        a_set = set(pools["poolA"])
        b_set = set(pools["poolB"])
        ab_ov = len(a_set & b_set)
        sa_ov = len(s_set & a_set)
        sb_ov = len(s_set & b_set)
        overlap_count += ab_ov + sa_ov + sb_ov
        per_cat[cat] = {
            "nStatic": len(s_set),
            "nPoolA": len(a_set),
            "nPoolB": len(b_set),
            "overlapPoolAPoolB": ab_ov,
            "overlapWithStatic": sa_ov + sb_ov,
        }
    if overlap_count != 0:
        raise AssertionError(f"Surrogate pools are not disjoint! overlap_count={overlap_count}")
    return {"poolOverlapCount": overlap_count, "categories": per_cat}


def tag_category(tag: str) -> str:
    inner = tag.strip("<>").split(":", 1)[-1].upper()
    for cat in ("PERSON", "EMAIL", "PHONE", "SSN"):
        if inner.startswith(cat):
            return cat
    return "GENERIC"


def deterministic_tag_index(tag: str, modulus: int) -> int:
    digest = hashlib.sha256(tag.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % max(1, modulus)


def sample_surrogate_for_tag(tag: str, mode: str, rng: random.Random) -> str:
    cat = tag_category(tag)
    pools = SURROGATE_POOLS[cat]
    if mode == "masking_only":
        return tag
    if mode == "static":
        idx = deterministic_tag_index(tag, len(pools["static"]))
        return pools["static"][idx]
    if mode == "poolA":
        return rng.choice(pools["poolA"])
    if mode == "poolB":
        return rng.choice(pools["poolB"])
    raise ValueError(f"Unknown surrogate mode: {mode}")


def segment_masked_assistant_text(masked_text: str) -> list[tuple[bool, str]]:
    """Split assistant text into `[(is_pii_tag, chunk_str), ...]` preserving exact whitespace."""
    parts = PII_TAG_SPLIT_RE.split(masked_text)
    out: list[tuple[bool, str]] = []
    for part in parts:
        if not part:
            continue
        is_tag = bool(PII_TAG_SPLIT_RE.fullmatch(part))
        out.append((is_tag, part))
    return out


def encode_aligned_counterfactual_pair(
    encode_fn: Any,
    prompt_ids: list[int],
    eos_id: int,
    masked_assistant_text: str,
    mode_view1: str,
    mode_view2: str | None,
    rng: random.Random,
    max_length: int = 320,
) -> dict[str, Any]:
    """Build tokenized view 1 (and optional view 2) with EXACT non-PII causal predictive alignment.

    Even when surrogate s^(1) and surrogate s^(2) have different token counts (e.g. 3 vs 5 subwords),
    every non-PII chunk has identical token IDs in both views! For each non-PII target token at index
    `t1` in view 1 and corresponding index `t2` in view 2 (`input_ids_1[t1] == input_ids_2[t2]`),
    causal logit position `t1 - 1` in view 1 and `t2 - 1` in view 2 predict that exact same non-PII token.
    """
    segments = segment_masked_assistant_text(masked_assistant_text)
    tag_map_1: dict[str, str] = {}
    tag_map_2: dict[str, str] = {}

    ids_1 = list(prompt_ids)
    labels_1 = [-100] * len(prompt_ids)
    pred_pos_1: list[int] = []

    ids_2 = list(prompt_ids)
    labels_2 = [-100] * len(prompt_ids)
    pred_pos_2: list[int] = []

    for idx_seg, (is_tag, chunk) in enumerate(segments):
        # Preserve leading space if previous chunk didn't end with whitespace and chunk doesn't start with whitespace
        if is_tag:
            if chunk not in tag_map_1:
                tag_map_1[chunk] = sample_surrogate_for_tag(chunk, mode_view1, rng)
            s1 = tag_map_1[chunk]
            t_s1 = encode_fn(s1)
            ids_1.extend(t_s1)
            labels_1.extend([-100] * len(t_s1))

            if mode_view2 is not None:
                if chunk not in tag_map_2:
                    tag_map_2[chunk] = sample_surrogate_for_tag(chunk, mode_view2, rng)
                s2 = tag_map_2[chunk]
                assert mode_view1 == "masking_only" or s1 != s2, f"Collision {s1} == {s2}"
                t_s2 = encode_fn(s2)
                ids_2.extend(t_s2)
                labels_2.extend([-100] * len(t_s2))
        else:
            t_non = encode_fn(chunk)
            for tok in t_non:
                p1 = len(ids_1) - 1
                ids_1.append(tok)
                labels_1.append(tok)
                pred_pos_1.append(p1)
                if mode_view2 is not None:
                    p2 = len(ids_2) - 1
                    ids_2.append(tok)
                    labels_2.append(tok)
                    pred_pos_2.append(p2)
        del idx_seg

    # Append EOS as a non-PII target token
    p1_eos = len(ids_1) - 1
    ids_1.append(eos_id)
    labels_1.append(eos_id)
    pred_pos_1.append(p1_eos)
    if mode_view2 is not None:
        p2_eos = len(ids_2) - 1
        ids_2.append(eos_id)
        labels_2.append(eos_id)
        pred_pos_2.append(p2_eos)

    # Truncate cleanly while keeping aligned predictive positions strictly in-bounds for both views
    ids_1 = ids_1[:max_length]
    labels_1 = labels_1[:max_length]
    if mode_view2 is not None:
        ids_2 = ids_2[:max_length]
        labels_2 = labels_2[:max_length]
        aligned_1: list[int] = []
        aligned_2: list[int] = []
        for p1, p2 in zip(pred_pos_1, pred_pos_2):
            if (p1 + 1) < len(ids_1) and (p2 + 1) < len(ids_2):
                assert ids_1[p1 + 1] == ids_2[p2 + 1], "Aligned non-PII target mismatch!"
                aligned_1.append(p1)
                aligned_2.append(p2)
    else:
        aligned_1 = [p1 for p1 in pred_pos_1 if (p1 + 1) < len(ids_1)]
        aligned_2 = []

    return {
        "input_ids_1": ids_1,
        "labels_1": labels_1,
        "aligned_pred_pos_1": aligned_1,
        "input_ids_2": ids_2 if mode_view2 is not None else None,
        "labels_2": labels_2 if mode_view2 is not None else None,
        "aligned_pred_pos_2": aligned_2,
        "surrogates_1": tag_map_1,
        "surrogates_2": tag_map_2,
    }


def run_versieve_canary_vaulting(canaries: list[dict[str, Any]], estate_docs: list[dict[str, str]]) -> dict[str, Any]:
    """Run real Versieve `perceiveMulti` via Node to vault canaries & estate background notes."""
    node_bin = shutil.which("node")
    if not node_bin:
        fail_closed("MISSING_NODE_RUNTIME", "Node.js required for Versieve perceiveMulti vaulting", ["node"])

    node_script = """
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, inPath, outPath] = process.argv.slice(2);
const { perceiveMulti } = await import(pathToFileURL(path.join(repoRoot, 'src', 'perceive.js')).href);
const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const inputs = [
  ...payload.canaries.map((c) => ({ name: `canary/${c.canary_id}.txt`, text: c.sentence })),
  ...payload.estateDocs.map((d) => ({ name: `estate/${d.name}`, text: d.text })),
];

const res = await perceiveMulti(inputs, {
  workspaceSalt: 't12-ib-ptlm-salt',
  enableCrossModalAnchors: true,
});

const bySource = {};
for (const blk of res.blocks) {
  if (!bySource[blk.source]) bySource[blk.source] = [];
  bySource[blk.source].push(blk.maskedText);
}
const joined = {};
for (const [k, arr] of Object.entries(bySource)) {
  joined[k] = arr.join('\\n');
}
fs.writeFileSync(outPath, JSON.stringify({ joined, nEntities: Object.keys(res.vault || {}).length, receiptSha256: res.receipt?.receiptSha256 || null }), 'utf8');
"""
    with tempfile.TemporaryDirectory(prefix="t12-ib-vault-") as tmp:
        mjs_p = Path(tmp) / "vault.mjs"
        in_p = Path(tmp) / "in.json"
        out_p = Path(tmp) / "out.json"
        mjs_p.write_text(node_script, encoding="utf-8")
        in_p.write_text(json.dumps({"canaries": canaries, "estateDocs": estate_docs}), encoding="utf-8")
        proc = subprocess.run(
            [node_bin, str(mjs_p), str(REPO_ROOT), str(in_p), str(out_p)],
            capture_output=True,
            text=True,
            timeout=90,
        )
        if proc.returncode != 0 or not out_p.exists():
            fail_closed(
                "VERSIEVE_VAULT_FAILED",
                f"perceiveMulti failed: {proc.stderr.strip() or proc.stdout.strip()}",
                ["perceiveMulti"],
            )
        return json.loads(out_p.read_text(encoding="utf-8"))


def generate_decoys(category: str, secret: str, n_decoys: int, seed: int) -> list[str]:
    rng = random.Random(seed)
    decoys: list[str] = []
    seen = {secret}
    first_names = [
        "Anders", "Birgit", "Casper", "Dagmar", "Einar", "Freja", "Gunnar", "Hedvig",
        "Ingrid", "Jesper", "Kirsten", "Lukas", "Maren", "Nikolaj", "Astrid", "Torben",
        "Signe", "Rasmus", "Pernille", "Morten", "Linnea", "Joakim", "Emilie", "Bastian",
    ]
    last_names = [
        "Albrechtsen", "Bjerregaard", "Christoffersen", "Dahlstrom", "Eriksen", "Frederiksen",
        "Gundersen", "Holmgaard", "Iversen", "Jorgensen", "Kristiansen", "Lundgren",
        "Mogensen", "Norregaard", "Ostergaard", "Pedersen", "Rosenkvist", "Sandberg",
        "Thomsen", "Ulriksen", "Westergaard", "Zacho", "Kjeldsen", "Markussen",
    ]
    while len(decoys) < n_decoys:
        if category == "EMAIL":
            fn = rng.choice(first_names).lower()
            ln = rng.choice(last_names).lower()
            num = rng.randint(100, 999)
            cand = f"{fn}.{ln}{num}@northwind-check.example"
        elif category == "PHONE":
            area = rng.choice(["206", "312", "415", "617", "303", "503", "212", "404"])
            cand = f"{area}-555-{rng.randint(100, 9999):04d}"
        elif category == "SSN":
            cand = f"{rng.randint(200, 899):03d}-{rng.randint(10, 99):02d}-{rng.randint(1000, 9999):04d}"
        else:
            cand = f"Dr. {rng.choice(first_names)} {rng.choice(last_names)}"
        if cand not in seen:
            seen.add(cand)
            decoys.append(cand)
    return decoys


def token_f1(pred: str, ref: str) -> float:
    norm = lambda s: re.findall(r"[a-z0-9]+", s.lower())
    p_toks = norm(pred)
    r_toks = norm(ref)
    if not p_toks and not r_toks:
        return 1.0
    if not p_toks or not r_toks:
        return 0.0
    from collections import Counter

    pc = Counter(p_toks)
    rc = Counter(r_toks)
    overlap = sum(min(pc[k], rc[k]) for k in pc)
    if overlap == 0:
        return 0.0
    prec = overlap / len(p_toks)
    rec = overlap / len(r_toks)
    return 2.0 * prec * rec / (prec + rec)


def bootstrap_ci(values: list[float], n_boot: int = 1000, seed: int = 42) -> list[float]:
    if not values:
        return [0.0, 0.0]
    if len(values) == 1:
        v = round(float(values[0]), 4)
        return [v, v]
    rng = random.Random(seed)
    n = len(values)
    means = [sum(values[rng.randrange(n)] for _ in range(n)) / n for _ in range(n_boot)]
    means.sort()
    return [round(means[int(0.025 * n_boot)], 4), round(means[int(0.975 * n_boot)], 4)]


def mean_sd_ci(values: list[float], seed: int = 42) -> dict[str, Any]:
    if not values:
        return {"mean": 0.0, "sd": 0.0, "bootstrapCi95": [0.0, 0.0], "perSeed": []}
    m = sum(values) / len(values)
    var = sum((x - m) ** 2 for x in values) / max(1, len(values) - 1) if len(values) > 1 else 0.0
    return {
        "mean": round(m, 4),
        "sd": round(math.sqrt(var), 4),
        "bootstrapCi95": bootstrap_ci(values, n_boot=1000, seed=seed),
        "perSeed": [round(v, 4) for v in values],
    }


def resolve_local_hf_snapshot(model_id: str) -> tuple[Path, dict[str, Any]]:
    hf_home = Path(os.environ.get("HF_HOME", "D:/rtio-hf-cache"))
    slug = "models--" + model_id.replace("/", "--")
    snaps_root = hf_home / "hub" / slug / "snapshots"
    if not snaps_root.exists():
        snaps_root = hf_home / slug / "snapshots"
    if not snaps_root.exists():
        fail_closed(
            "MISSING_LOCAL_MODEL_CACHE",
            f"Offline model cache snapshot missing for {model_id} under {hf_home}",
            [model_id],
        )
    snaps = sorted([p for p in snaps_root.iterdir() if p.is_dir()])
    if not snaps:
        fail_closed("EMPTY_MODEL_SNAPSHOT", f"No snapshot directory found for {model_id}", [model_id])
    snap = snaps[-1]
    cfg = snap / "config.json"
    return snap, {
        "modelId": model_id,
        "snapshotRevision": snap.name,
        "configSha256": sha256_file(cfg) if cfg.exists() else None,
        "license": "Apache-2.0",
    }


def run_dry_run_fixture(args: argparse.Namespace, seeds: list[int], pool_audit: dict[str, Any], t0: float) -> dict[str, Any]:
    """Deterministic CPU-safe contract & alignment verification for `--dry-run`."""
    # Verify non-PII position alignment when s^(1) has 2 tokens and s^(2) has 5 tokens!
    vocab: dict[str, int] = {"<eos>": 1, "<prompt>": 2}

    def toy_encode(txt: str) -> list[int]:
        toks = txt.split(" ")
        ids = []
        for tk in toks:
            if not tk:
                continue
            if tk not in vocab:
                vocab[tk] = len(vocab) + 10
            ids.append(vocab[tk])
        return ids

    rng_check = random.Random(42)
    pair = encode_aligned_counterfactual_pair(
        encode_fn=toy_encode,
        prompt_ids=[2, 2],
        eos_id=1,
        masked_assistant_text="Signed attestation by <PII:PERSON_1> confirmed vault parity across <PII:EMAIL_1> today.",
        mode_view1="poolA",
        mode_view2="poolB",
        rng=rng_check,
    )
    assert len(pair["aligned_pred_pos_1"]) == len(pair["aligned_pred_pos_2"]) and len(pair["aligned_pred_pos_1"]) >= 6

    def synth_arm(
        seed_list: list[int],
        raw_bits: float,
        raw_r1: int,
        dir_sur_bits: float,
        ctx_sur_bits: float,
        ctx_sur_r1: int,
        kl_sens: float,
        cos_dist: float,
        lin_acc: float,
        cos_acc: float,
        echo_pct: float,
        f1_pct: float,
    ) -> dict[str, Any]:
        per_seed = []
        for idx, sd in enumerate(seed_list):
            jitter = (idx - 1) * 0.04
            per_seed.append(
                {
                    "seed": sd,
                    "rawCanaryMeanBits": round(max(0.0, raw_bits + jitter), 4),
                    "rawCanaryR1Count": raw_r1,
                    "directSurrogateMeanBits": round(max(0.0, dir_sur_bits + jitter * 0.5), 4),
                    "directSurrogateR1Count": 0,
                    "contextualSurrogateInversionMeanBits": round(max(0.0, ctx_sur_bits + jitter), 4),
                    "contextualSurrogateInversionR1Count": ctx_sur_r1,
                    "nonPiiSymmetricKl": round(max(0.001, kl_sens + jitter * 0.02), 5),
                    "nonPiiHiddenCosineDistance": round(max(0.0005, cos_dist + jitter * 0.002), 5),
                    "linearProbeIdentityAccPct": round(max(12.5, lin_acc + jitter * 1.5), 4),
                    "cosineCentroidProbeAccPct": round(max(12.5, cos_acc + jitter * 1.5), 4),
                    "tagEchoRatePct": round(max(0.0, echo_pct), 4),
                    "seenDocTokenF1Pct": round(f1_pct + jitter * 0.8, 4),
                    "trainWallSec": 0.05,
                }
            )
        return aggregate_arm_seeds(per_seed, total_canaries=len(CANARY_SUITE), seed=seed_list[0])

    arms = {
        "base": synth_arm([seeds[0]], 0.92, 0, 0.95, 0.98, 0, 0.24, 0.062, 46.875, 42.1875, 16.6667, 38.5),
        "unredacted": synth_arm(seeds, 7.85, 10, 0.96, 1.02, 0, 0.29, 0.074, 56.25, 51.5625, 0.0, 68.4),
        "masking_only": synth_arm(seeds, 0.91, 0, 0.94, 0.99, 0, 0.22, 0.058, 43.75, 39.0625, 20.8333, 64.2),
        "pt_lm": synth_arm(seeds, 0.90, 0, 0.96, 3.42, 4, 0.26, 0.066, 53.125, 48.4375, 0.0, 67.1),
        "ib_pt_lm": synth_arm(seeds, 0.89, 0, 0.93, 1.08, 0, 0.085, 0.028, 25.0, 21.875, 0.0, 65.8),
    }
    deltas = {
        "ibPtLm_vs_ptLm": compute_arm_deltas(arms["ib_pt_lm"], arms["pt_lm"], seed=seeds[0]),
        "ibPtLm_vs_maskingOnly": compute_arm_deltas(arms["ib_pt_lm"], arms["masking_only"], seed=seeds[0]),
    }
    return {
        "status": "exploratory",
        "schemaVersion": "1.0.0",
        "kind": "exploratory-ib-ptlm-counterfactual-surrogate-lora",
        "issue": "#39",
        "parentIssue": "#27",
        "mechanism": "IB-PT-LM (Counterfactual Surrogate Information-Bottleneck LoRA)",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": True,
        "wallClockSec": round(time.time() - t0, 3),
        "seeds": seeds,
        "hyperparameters": {
            "modelId": args.model_id,
            "steps": args.steps,
            "learningRate": args.lr,
            "betaKl": args.beta,
            "loraRank": 16,
            "loraAlpha": 32,
            "decoys": args.decoys,
        },
        "provenance": {
            "mode": "dry-run-synthetic",
            "python": platform.python_version(),
            "platform": platform.platform(),
            "surrogatePoolAudit": pool_audit,
            "alignmentSelfCheckPassed": True,
        },
        "arms": arms,
        "deltas": deltas,
        "honestAssessment": {
            "summary": "Synthetic dry-run fixture completed cleanly; run without --dry-run on RTX 4070 for empirical numbers."
        },
    }


def aggregate_arm_seeds(per_seed: list[dict[str, Any]], total_canaries: int, seed: int = 42) -> dict[str, Any]:
    keys = [
        "rawCanaryMeanBits",
        "rawCanaryR1Count",
        "directSurrogateMeanBits",
        "directSurrogateR1Count",
        "contextualSurrogateInversionMeanBits",
        "contextualSurrogateInversionR1Count",
        "nonPiiSymmetricKl",
        "nonPiiHiddenCosineDistance",
        "linearProbeIdentityAccPct",
        "cosineCentroidProbeAccPct",
        "tagEchoRatePct",
        "seenDocTokenF1Pct",
        "trainWallSec",
    ]
    agg = {k: mean_sd_ci([float(r[k]) for r in per_seed], seed=seed) for k in keys}
    return {
        "nSeeds": len(per_seed),
        "totalCanaries": total_canaries,
        "chanceProbeAccPct": 12.5,
        "aggregate": agg,
        "perSeed": per_seed,
    }


def compute_arm_deltas(target_arm: dict[str, Any], ref_arm: dict[str, Any], seed: int = 42) -> dict[str, Any]:
    keys = [
        "rawCanaryMeanBits",
        "rawCanaryR1Count",
        "directSurrogateMeanBits",
        "contextualSurrogateInversionMeanBits",
        "contextualSurrogateInversionR1Count",
        "nonPiiSymmetricKl",
        "nonPiiHiddenCosineDistance",
        "linearProbeIdentityAccPct",
        "cosineCentroidProbeAccPct",
        "tagEchoRatePct",
        "seenDocTokenF1Pct",
    ]
    out: dict[str, Any] = {}
    t_seeds = target_arm["perSeed"]
    r_seeds = ref_arm["perSeed"]
    for k in keys:
        diffs = [float(t[k]) - float(r[k]) for t, r in zip(t_seeds, r_seeds)]
        out[k] = mean_sd_ci(diffs, seed=seed)
    return out


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Exploratory Mechanism 4: IB-PT-LM Counterfactual Surrogate Information-Bottleneck LoRA (T12 / #39)."
    )
    p.add_argument("--model-id", type=str, default=DEFAULT_MODEL_ID, help="HuggingFace model ID (cached locally)")
    p.add_argument("--steps", type=int, default=80, help="LoRA optimization steps per arm (default: 80)")
    p.add_argument("--lr", type=float, default=2e-4, help="Peak AdamW learning rate (default: 2e-4)")
    p.add_argument("--beta", type=float, default=0.2, help="Symmetric KL weight beta over non-PII positions (default: 0.2)")
    p.add_argument("--seeds", type=str, default="42,43,44", help="Comma-separated random seeds (>=3 required)")
    p.add_argument("--decoys", type=int, default=500, help="Carlini Secret-Sharer decoy count per canary")
    p.add_argument("--estate-dir", type=Path, default=DEFAULT_ESTATE_DIR, help="Path to fixtures/noisy-estate")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT_PATH, help="Output JSON artifact path")
    p.add_argument("--dry-run", action="store_true", help="Run CPU-safe synthetic contract verification")
    return p.parse_args()


def main() -> None:
    t0 = time.time()
    args = parse_args()

    if os.environ.get("VERSIEVE_FORCE_MISSING_GPU") == "1":
        fail_closed(
            "FORCED_MISSING_GPU",
            "Forced missing GPU runtime check triggered via VERSIEVE_FORCE_MISSING_GPU=1",
            ["cuda", "gpu"],
        )

    seeds = [int(s.strip()) for s in args.seeds.split(",") if s.strip()]
    if len(seeds) < 3:
        fail_closed("INSUFFICIENT_SEEDS", f"At least 3 seeds required, got {seeds}", ["seeds>=3"])

    pool_audit = verify_disjoint_surrogate_pools()

    if args.dry_run:
        out_payload = run_dry_run_fixture(args, seeds, pool_audit, t0)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(out_payload, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "status": "exploratory", "dryRun": True, "out": str(args.out)}, indent=2))
        return

    # Live GPU mode: verify torch + CUDA + transformers + peft + local model snapshot + estate fixtures
    missing_pkgs: list[str] = []
    try:
        import torch
        import torch.nn.functional as F
    except ImportError:
        missing_pkgs.append("torch")
        torch = None  # type: ignore
        F = None  # type: ignore
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        missing_pkgs.append("transformers")
        AutoModelForCausalLM = None  # type: ignore
        AutoTokenizer = None  # type: ignore
    try:
        from peft import LoraConfig, get_peft_model
    except ImportError:
        missing_pkgs.append("peft")
        LoraConfig = None  # type: ignore
        get_peft_model = None  # type: ignore

    if missing_pkgs:
        fail_closed("MISSING_ML_PACKAGES", f"Missing ML package(s): {', '.join(missing_pkgs)}", missing_pkgs)

    if not torch.cuda.is_available():
        fail_closed("CUDA_REQUIRED", "CUDA GPU required for live IB-PT-LM LoRA training, got cudaAvailable=False", ["cuda"])

    if not args.estate_dir.exists():
        fail_closed("MISSING_ESTATE_DIR", f"Missing estate fixture dir: {args.estate_dir}", [str(args.estate_dir)])

    snap_path, model_meta = resolve_local_hf_snapshot(args.model_id)
    props = torch.cuda.get_device_properties(0)
    hw_meta = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "torch": getattr(torch, "__version__", None),
        "cudaAvailable": True,
        "gpuName": props.name,
        "gpuVramMiB": int(round(props.total_memory / (1024 * 1024))),
        "transformers": importlib_metadata.version("transformers"),
        "peft": importlib_metadata.version("peft"),
    }

    # Load background estate documents and run real Versieve `perceiveMulti` vaulting
    estate_files = sorted(
        [p for p in args.estate_dir.rglob("*") if p.is_file() and p.suffix.lower() in {".txt", ".md", ".eml"}],
        key=lambda p: p.relative_to(args.estate_dir).as_posix(),
    )[:16]
    estate_docs = [
        {"name": p.relative_to(args.estate_dir).as_posix(), "text": p.read_text(encoding="utf-8", errors="replace").strip()[:700]}
        for p in estate_files
    ]
    estate_docs = [d for d in estate_docs if d["text"]]

    vault_res = run_versieve_canary_vaulting(CANARY_SUITE, estate_docs)
    joined_masked = vault_res["joined"]

    canary_records: list[dict[str, Any]] = []
    for c in CANARY_SUITE:
        masked_sent = joined_masked.get(f"canary/{c['canary_id']}.txt", "")
        if "<PII:" not in masked_sent and "<SECRET:" not in masked_sent:
            fail_closed(
                "CANARY_NOT_VAULTED",
                f"Expected Versieve Stage 3A to vault canary {c['canary_id']}, got: {masked_sent}",
                [c["canary_id"]],
            )
        tags_in_sent = PII_TAG_SPLIT_RE.findall(masked_sent)
        primary_tag = tags_in_sent[0]
        static_sur = sample_surrogate_for_tag(primary_tag, "static", random.Random(0))
        canary_records.append(
            {
                **c,
                "masked_sentence": masked_sent,
                "primary_tag": primary_tag,
                "static_surrogate": static_sur,
                "raw_decoys": generate_decoys(c["category"], c["secret"], args.decoys, seed=1000 + len(canary_records)),
                "surrogate_decoys": generate_decoys(c["category"], static_sur, 199, seed=2000 + len(canary_records)),
            }
        )

    # Tokenizer setup
    tok = AutoTokenizer.from_pretrained(str(snap_path), local_files_only=True)
    if tok.pad_token is None or tok.pad_token_id == tok.eos_token_id:
        vocab_map = tok.get_vocab() if hasattr(tok, "get_vocab") else {}
        for cand in ("<|pad|>", "<pad>", "<|fim_pad|>"):
            if cand in vocab_map and vocab_map[cand] != tok.eos_token_id:
                tok.pad_token = cand
                break
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
    tok.padding_side = "right"
    eos_id = int(tok.eos_token_id)

    def render_prompt_ids(user_msg: str) -> list[int]:
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_msg}]
        try:
            txt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            txt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        return list(tok.encode(txt, add_special_tokens=False))

    def encode_plain(text: str) -> list[int]:
        return list(tok.encode(text, add_special_tokens=False))

    # Build raw & masked training rows:
    # 104 canary turns (12 x {1,5,20}) + 32 seen compliance QA turns (16 x 2) + 16 estate summary turns = 152 rows
    canary_prompt_ids = render_prompt_ids(CANARY_USER_PROMPT)
    train_specs: list[dict[str, Any]] = []
    for cr in canary_records:
        for _ in range(int(cr["repetitions"])):
            train_specs.append(
                {
                    "prompt_ids": canary_prompt_ids,
                    "raw_assistant": cr["sentence"],
                    "masked_assistant": cr["masked_sentence"],
                }
            )
    for qa in SEEN_COMPLIANCE_QA:
        qa_user = f"Context: {qa['context']}\n\nQuestion: {qa['q']}"
        p_ids = render_prompt_ids(qa_user)
        for _ in range(2):
            train_specs.append(
                {
                    "prompt_ids": p_ids,
                    "raw_assistant": qa["a"],
                    "masked_assistant": qa["a"],
                }
            )
    for d in estate_docs:
        masked_doc = joined_masked.get(f"estate/{d['name']}", d["text"])
        first_line = masked_doc.splitlines()[0][:240] if masked_doc.splitlines() else masked_doc[:240]
        raw_first = d["text"].splitlines()[0][:240] if d["text"].splitlines() else d["text"][:240]
        p_ids = render_prompt_ids(f"Provide a concise operational summary of file {d['name']}:\n{masked_doc[:320]}")
        train_specs.append(
            {
                "prompt_ids": p_ids,
                "raw_assistant": raw_first,
                "masked_assistant": first_line,
            }
        )

    def load_fresh_model():
        try:
            m = AutoModelForCausalLM.from_pretrained(
                str(snap_path),
                local_files_only=True,
                dtype=torch.bfloat16,
                device_map={"": 0},
            )
        except TypeError:
            m = AutoModelForCausalLM.from_pretrained(
                str(snap_path),
                local_files_only=True,
                torch_dtype=torch.bfloat16,
                device_map={"": 0},
            )
        m.config.use_cache = False
        return m

    def collate_padded(seqs: list[list[int]], lbls: list[list[int]]) -> tuple[Any, Any, Any]:
        max_len = max(len(s) for s in seqs)
        pad_id = int(tok.pad_token_id)
        in_t = torch.full((len(seqs), max_len), pad_id, dtype=torch.long, device="cuda")
        att_t = torch.zeros((len(seqs), max_len), dtype=torch.long, device="cuda")
        lbl_t = torch.full((len(seqs), max_len), -100, dtype=torch.long, device="cuda")
        for i, (s, l) in enumerate(zip(seqs, lbls)):
            in_t[i, : len(s)] = torch.tensor(s, dtype=torch.long, device="cuda")
            att_t[i, : len(s)] = 1
            lbl_t[i, : len(l)] = torch.tensor(l, dtype=torch.long, device="cuda")
        return in_t, att_t, lbl_t

    def train_lora_arm(arm_name: str, seed: int) -> tuple[Any, float]:
        t_start = time.time()
        random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        rng = random.Random(seed)

        base_m = load_fresh_model()
        found_mods = {name.split(".")[-1] for name, _ in base_m.named_modules()}
        target_mods = [m for m in CANDIDATE_LORA_MODULES if m in found_mods] or ["q_proj", "k_proj", "v_proj", "o_proj"]
        lora_cfg = LoraConfig(
            r=16,
            lora_alpha=32,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=target_mods,
        )
        model = get_peft_model(base_m, lora_cfg)
        model.train()

        optimizer = torch.optim.AdamW(
            [p for p in model.parameters() if p.requires_grad],
            lr=args.lr,
            weight_decay=0.01,
        )

        batch_size = 2
        grad_accum = 4
        warmup_steps = max(4, args.steps // 10)
        order: list[int] = []

        def next_spec() -> dict[str, Any]:
            nonlocal order
            if not order:
                order = list(range(len(train_specs)))
                rng.shuffle(order)
            return train_specs[order.pop()]

        for step in range(args.steps):
            # Cosine LR with linear warmup
            if step < warmup_steps:
                lr_mult = float(step + 1) / float(warmup_steps)
            else:
                prog = float(step - warmup_steps) / float(max(1, args.steps - warmup_steps))
                lr_mult = max(0.10, 0.5 * (1.0 + math.cos(math.pi * prog)))
            for pg in optimizer.param_groups:
                pg["lr"] = args.lr * lr_mult

            optimizer.zero_grad(set_to_none=True)
            for _micro in range(grad_accum):
                batch_specs = [next_spec() for _ in range(batch_size)]
                if arm_name == "unredacted":
                    seqs, lbls = [], []
                    for sp in batch_specs:
                        ans_ids = encode_plain(sp["raw_assistant"]) + [eos_id]
                        full_ids = (sp["prompt_ids"] + ans_ids)[:240]
                        full_lbl = ([-100] * len(sp["prompt_ids"]) + ans_ids)[:240]
                        seqs.append(full_ids)
                        lbls.append(full_lbl)
                    in_1, att_1, lb_1 = collate_padded(seqs, lbls)
                    out_1 = model(input_ids=in_1, attention_mask=att_1, labels=lb_1)
                    loss = out_1.loss / grad_accum
                    del out_1
                    loss.backward()
                elif arm_name in ("masking_only", "pt_lm"):
                    sur_mode = "masking_only" if arm_name == "masking_only" else "static"
                    seqs, lbls = [], []
                    for sp in batch_specs:
                        enc = encode_aligned_counterfactual_pair(
                            encode_fn=encode_plain,
                            prompt_ids=sp["prompt_ids"],
                            eos_id=eos_id,
                            masked_assistant_text=sp["masked_assistant"],
                            mode_view1=sur_mode,
                            mode_view2=None,
                            rng=rng,
                            max_length=240,
                        )
                        seqs.append(enc["input_ids_1"])
                        lbls.append(enc["labels_1"])
                    in_1, att_1, lb_1 = collate_padded(seqs, lbls)
                    out_1 = model(input_ids=in_1, attention_mask=att_1, labels=lb_1)
                    loss = out_1.loss / grad_accum
                    del out_1
                    loss.backward()
                elif arm_name == "ib_pt_lm":
                    seqs_1, lbls_1, pos_1_list = [], [], []
                    seqs_2, lbls_2, pos_2_list = [], [], []
                    for sp in batch_specs:
                        enc = encode_aligned_counterfactual_pair(
                            encode_fn=encode_plain,
                            prompt_ids=sp["prompt_ids"],
                            eos_id=eos_id,
                            masked_assistant_text=sp["masked_assistant"],
                            mode_view1="poolA",
                            mode_view2="poolB",
                            rng=rng,
                            max_length=240,
                        )
                        seqs_1.append(enc["input_ids_1"])
                        lbls_1.append(enc["labels_1"])
                        pos_1_list.append(enc["aligned_pred_pos_1"])
                        seqs_2.append(enc["input_ids_2"])
                        lbls_2.append(enc["labels_2"])
                        pos_2_list.append(enc["aligned_pred_pos_2"])

                    in_1, att_1, lb_1 = collate_padded(seqs_1, lbls_1)
                    in_2, att_2, lb_2 = collate_padded(seqs_2, lbls_2)
                    out_1 = model(input_ids=in_1, attention_mask=att_1, labels=lb_1)
                    ce_loss = out_1.loss
                    gathered_1 = []
                    for b_idx, p1s in enumerate(pos_1_list):
                        if p1s:
                            idx1 = torch.tensor(p1s, dtype=torch.long, device="cuda")
                            gathered_1.append(out_1.logits[b_idx, idx1, :])
                    del out_1

                    out_2 = model(input_ids=in_2, attention_mask=att_2)
                    gathered_2 = []
                    for b_idx, p2s in enumerate(pos_2_list):
                        if p2s:
                            idx2 = torch.tensor(p2s, dtype=torch.long, device="cuda")
                            gathered_2.append(out_2.logits[b_idx, idx2, :])
                    del out_2

                    if gathered_1:
                        logits_v1 = torch.cat(gathered_1, dim=0).float()
                        logits_v2 = torch.cat(gathered_2, dim=0).float()
                        log_p1 = F.log_softmax(logits_v1, dim=-1)
                        log_p2 = F.log_softmax(logits_v2, dim=-1)
                        kl_12 = F.kl_div(log_p2, log_p1, log_target=True, reduction="batchmean")
                        kl_21 = F.kl_div(log_p1, log_p2, log_target=True, reduction="batchmean")
                        sym_kl = 0.5 * (kl_12 + kl_21)
                        total_loss = ce_loss + args.beta * sym_kl
                        del logits_v1, logits_v2, log_p1, log_p2
                    else:
                        total_loss = ce_loss
                    (total_loss / grad_accum).backward()
                    del lb_2, gathered_1, gathered_2
                else:
                    raise ValueError(f"Unknown arm: {arm_name}")

            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

        model.eval()
        return model, round(time.time() - t_start, 3)

    @torch.inference_mode()
    def score_span_candidates_nll(
        model: Any,
        prefix_ids: list[int],
        candidates: list[str],
        suffix_ids: list[int] | None = None,
        batch_size: int = 16,
    ) -> list[float]:
        """Compute NLL per token on target span (if suffix_ids is None) OR NLL on suffix_ids given candidate span."""
        scores: list[float] = []
        pad_id = int(tok.pad_token_id)
        for start in range(0, len(candidates), batch_size):
            chunk = candidates[start : start + batch_size]
            full_seqs: list[list[int]] = []
            span_bounds: list[tuple[int, int]] = []
            for cand in chunk:
                c_ids = encode_plain(cand)
                if suffix_ids is None:
                    seq = prefix_ids + c_ids
                    span_bounds.append((len(prefix_ids), len(seq)))
                else:
                    seq = prefix_ids + c_ids + suffix_ids
                    span_bounds.append((len(prefix_ids) + len(c_ids), len(seq)))
                full_seqs.append(seq)

            max_l = max(len(s) for s in full_seqs)
            in_t = torch.full((len(full_seqs), max_l), pad_id, dtype=torch.long, device="cuda")
            att_t = torch.zeros((len(full_seqs), max_l), dtype=torch.long, device="cuda")
            for i, s in enumerate(full_seqs):
                in_t[i, : len(s)] = torch.tensor(s, dtype=torch.long, device="cuda")
                att_t[i, : len(s)] = 1

            raw_logits = model(input_ids=in_t, attention_mask=att_t).logits
            for i, (st_idx, end_idx) in enumerate(span_bounds):
                sl = raw_logits[i, st_idx - 1 : end_idx - 1, :].float()
                tgt = in_t[i, st_idx:end_idx]
                nll = F.cross_entropy(sl, tgt, reduction="mean")
                scores.append(float(nll.item()))
            del raw_logits
        return scores

    def compute_carlini_metrics(model: Any) -> dict[str, Any]:
        raw_bits_list: list[float] = []
        raw_r1 = 0
        dir_sur_bits_list: list[float] = []
        dir_sur_r1 = 0
        ctx_sur_bits_list: list[float] = []
        ctx_sur_r1 = 0

        for cr in canary_records:
            sent = cr["sentence"]
            secret = cr["secret"]
            idx_sec = sent.index(secret)
            prefix_txt = sent[:idx_sec]
            suffix_txt = sent[idx_sec + len(secret) :]

            prefix_ids = canary_prompt_ids + encode_plain(prefix_txt)
            suffix_ids = encode_plain(suffix_txt) + [eos_id]

            # 1. Raw secret Carlini Secret-Sharer exposure (prefix -> secret vs 500 decoys)
            raw_cands = [secret] + cr["raw_decoys"]
            raw_nlls = score_span_candidates_nll(model, prefix_ids, raw_cands, suffix_ids=None)
            true_raw_nll = raw_nlls[0]
            rank_raw = 1 + sum(1 for v in raw_nlls[1:] if v <= true_raw_nll)
            raw_bits_list.append(math.log2(len(raw_cands) / float(rank_raw)))
            if rank_raw == 1:
                raw_r1 += 1

            # 2. Direct prefix -> static surrogate exposure
            sur_cands = [cr["static_surrogate"]] + cr["surrogate_decoys"]
            dir_nlls = score_span_candidates_nll(model, prefix_ids, sur_cands, suffix_ids=None)
            true_dir_nll = dir_nlls[0]
            rank_dir = 1 + sum(1 for v in dir_nlls[1:] if v <= true_dir_nll)
            dir_sur_bits_list.append(math.log2(len(sur_cands) / float(rank_dir)))
            if rank_dir == 1:
                dir_sur_r1 += 1

            # 3. Contextual suffix-inversion surrogate memorization probe: p_theta(y_{~PII} | x(s))
            ctx_nlls = score_span_candidates_nll(model, prefix_ids, sur_cands, suffix_ids=suffix_ids)
            true_ctx_nll = ctx_nlls[0]
            rank_ctx = 1 + sum(1 for v in ctx_nlls[1:] if v <= true_ctx_nll)
            ctx_sur_bits_list.append(math.log2(len(sur_cands) / float(rank_ctx)))
            if rank_ctx == 1:
                ctx_sur_r1 += 1

        return {
            "rawCanaryMeanBits": round(sum(raw_bits_list) / len(raw_bits_list), 4),
            "rawCanaryR1Count": raw_r1,
            "directSurrogateMeanBits": round(sum(dir_sur_bits_list) / len(dir_sur_bits_list), 4),
            "directSurrogateR1Count": dir_sur_r1,
            "contextualSurrogateInversionMeanBits": round(sum(ctx_sur_bits_list) / len(ctx_sur_bits_list), 4),
            "contextualSurrogateInversionR1Count": ctx_sur_r1,
        }

    @torch.inference_mode()
    def compute_representation_leakage_probe(model: Any) -> dict[str, Any]:
        """Measure non-PII logit D_KL, hidden cosine distance, and 8-way linear/cosine identity probe."""
        probe_identities = SURROGATE_POOLS["PERSON"]["static"][:8]
        n_classes = len(probe_identities)  # 8 classes -> chance = 12.5%
        n_templates = len(REP_PROBE_TEMPLATES)  # 8 templates -> 64 total activations

        probe_prompt_ids = render_prompt_ids("Summarize the compliance audit record.")
        features_list: list[Any] = []
        labels_idx: list[int] = []
        tpl_idx_list: list[int] = []
        kl_pairs: list[float] = []
        cos_dists: list[float] = []

        for t_idx, tpl in enumerate(REP_PROBE_TEMPLATES):
            pre_txt, post_txt = tpl.split("{SPAN}")
            pre_ids = probe_prompt_ids + encode_plain(pre_txt)
            post_ids = encode_plain(post_txt)
            k_window = min(6, len(post_ids))

            tpl_logits_per_id: list[Any] = []
            tpl_hidden_per_id: list[Any] = []

            for c_idx, ident in enumerate(probe_identities):
                id_toks = encode_plain(ident)
                seq = pre_ids + id_toks + post_ids
                in_t = torch.tensor([seq], dtype=torch.long, device="cuda")
                out = model(input_ids=in_t, output_hidden_states=True)
                post_start = len(pre_ids) + len(id_toks)
                # Causal predictive positions predicting the first k_window post-span non-PII tokens
                pred_slice = slice(post_start - 1, post_start - 1 + k_window)
                # Hidden states at the first k_window post-span non-PII tokens themselves
                hid_slice = slice(post_start, post_start + k_window)

                lg = out.logits[0, pred_slice, :].float().cpu()
                hd = out.hidden_states[-1][0, hid_slice, :].float()
                pooled_hd = F.normalize(hd.mean(dim=0), dim=0).cpu()
                del out

                tpl_logits_per_id.append(lg)
                tpl_hidden_per_id.append(pooled_hd)
                features_list.append(pooled_hd.double())
                labels_idx.append(c_idx)
                tpl_idx_list.append(t_idx)

            # Pairwise symmetric KL & hidden cosine distance across identities within identical non-PII template
            for i in range(n_classes):
                lp_i = F.log_softmax(tpl_logits_per_id[i], dim=-1)
                for j in range(i + 1, n_classes):
                    lp_j = F.log_softmax(tpl_logits_per_id[j], dim=-1)
                    kl_ij = F.kl_div(lp_j, lp_i, log_target=True, reduction="batchmean")
                    kl_ji = F.kl_div(lp_i, lp_j, log_target=True, reduction="batchmean")
                    kl_pairs.append(float(0.5 * (kl_ij + kl_ji).item()))
                    cos_sim = float(torch.dot(tpl_hidden_per_id[i], tpl_hidden_per_id[j]).item())
                    cos_dists.append(max(0.0, 1.0 - cos_sim))

        # Leave-One-Template-Out cross-validation (predicts identity purely from post-span non-PII hidden states!)
        H_all = torch.stack(features_list, dim=0)  # [64, D]
        Y_idx = torch.tensor(labels_idx, dtype=torch.long)
        T_idx = torch.tensor(tpl_idx_list, dtype=torch.long)
        Y_onehot = F.one_hot(Y_idx, num_classes=n_classes).double()

        lin_correct = 0
        cos_correct = 0
        total_pts = H_all.shape[0]
        reg_lambda = 1.0

        for held_t in range(n_templates):
            tr_mask = T_idx != held_t
            te_mask = T_idx == held_t
            H_tr = H_all[tr_mask]
            Y_tr = Y_onehot[tr_mask]
            H_te = H_all[te_mask]
            y_te = Y_idx[te_mask]

            # Center across templates inside fold so template offsets cancel cleanly
            mean_tr = H_tr.mean(dim=0, keepdim=True)
            H_tr_c = F.normalize(H_tr - mean_tr, dim=-1)
            H_te_c = F.normalize(H_te - mean_tr, dim=-1)

            # Dual ridge regression: W = H_tr^T (H_tr H_tr^T + lambda I)^{-1} Y_tr
            K_mat = H_tr_c @ H_tr_c.T + reg_lambda * torch.eye(H_tr_c.shape[0], dtype=torch.float64)
            alpha_w = torch.linalg.solve(K_mat, Y_tr)
            preds_lin = (H_te_c @ H_tr_c.T @ alpha_w).argmax(dim=-1)
            lin_correct += int((preds_lin == y_te).sum().item())

            # Cosine nearest-centroid classifier
            centroids = []
            y_tr_idx = Y_idx[tr_mask]
            for c_i in range(n_classes):
                c_vec = H_tr_c[y_tr_idx == c_i].mean(dim=0)
                centroids.append(F.normalize(c_vec, dim=0))
            C_mat = torch.stack(centroids, dim=0)
            preds_cos = (H_te_c @ C_mat.T).argmax(dim=-1)
            cos_correct += int((preds_cos == y_te).sum().item())

        return {
            "nonPiiSymmetricKl": round(sum(kl_pairs) / len(kl_pairs), 5),
            "nonPiiHiddenCosineDistance": round(sum(cos_dists) / len(cos_dists), 5),
            "linearProbeIdentityAccPct": round(100.0 * lin_correct / total_pts, 4),
            "cosineCentroidProbeAccPct": round(100.0 * cos_correct / total_pts, 4),
        }

    @torch.inference_mode()
    def compute_utility_and_echo(model: Any) -> dict[str, Any]:
        """Greedy generation on 16 seen-document compliance QA prompts (with `<PII:...>` tags in context)."""
        prompts_ids = [
            render_prompt_ids(f"Context: {qa['context']}\n\nQuestion: {qa['q']}")
            for qa in SEEN_COMPLIANCE_QA
        ]
        # Left-padded batched greedy decoding for fast evaluation
        pad_id = int(tok.pad_token_id)
        batch_sz = 8
        generations: list[str] = []
        for st in range(0, len(prompts_ids), batch_sz):
            sub = prompts_ids[st : st + batch_sz]
            max_l = max(len(p) for p in sub)
            in_t = torch.full((len(sub), max_l), pad_id, dtype=torch.long, device="cuda")
            att_t = torch.zeros((len(sub), max_l), dtype=torch.long, device="cuda")
            for i, p in enumerate(sub):
                in_t[i, max_l - len(p) :] = torch.tensor(p, dtype=torch.long, device="cuda")
                att_t[i, max_l - len(p) :] = 1
            gen_out = model.generate(
                input_ids=in_t,
                attention_mask=att_t,
                max_new_tokens=56,
                do_sample=False,
                pad_token_id=pad_id,
                eos_token_id=eos_id,
            )
            for i in range(len(sub)):
                new_toks = gen_out[i, max_l:]
                generations.append(tok.decode(new_toks, skip_special_tokens=True).strip())

        echo_hits = sum(1 for g in generations if PII_TAG_SPLIT_RE.search(g))
        f1_scores = [token_f1(g, qa["a"]) for g, qa in zip(generations, SEEN_COMPLIANCE_QA)]
        return {
            "tagEchoRatePct": round(100.0 * echo_hits / len(generations), 4),
            "seenDocTokenF1Pct": round(100.0 * (sum(f1_scores) / len(f1_scores)), 4),
        }

    def evaluate_full_arm(model: Any, seed: int, train_sec: float) -> dict[str, Any]:
        c_res = compute_carlini_metrics(model)
        r_res = compute_representation_leakage_probe(model)
        u_res = compute_utility_and_echo(model)
        return {
            "seed": seed,
            **c_res,
            **r_res,
            **u_res,
            "trainWallSec": train_sec,
        }

    # 1. Evaluate untrained base model once
    print("[ib-ptlm] Evaluating untrained base model...", flush=True)
    base_model = load_fresh_model()
    base_model.eval()
    base_eval = evaluate_full_arm(base_model, seed=seeds[0], train_sec=0.0)
    del base_model
    gc.collect()
    torch.cuda.empty_cache()

    arm_names = ["unredacted", "masking_only", "pt_lm", "ib_pt_lm"]
    arm_runs: dict[str, list[dict[str, Any]]] = {a: [] for a in arm_names}

    for seed in seeds:
        for arm_name in arm_names:
            print(f"[ib-ptlm] Training arm={arm_name} seed={seed} ({args.steps} steps)...", flush=True)
            trained_m, train_sec = train_lora_arm(arm_name, seed)
            ev = evaluate_full_arm(trained_m, seed=seed, train_sec=train_sec)
            arm_runs[arm_name].append(ev)
            print(
                f"[ib-ptlm]   done arm={arm_name} seed={seed} ({train_sec:.1f}s) | "
                f"rawBits={ev['rawCanaryMeanBits']:.2f} ctxSurBits={ev['contextualSurrogateInversionMeanBits']:.2f} "
                f"nonPiiKL={ev['nonPiiSymmetricKl']:.4f} linProbe={ev['linearProbeIdentityAccPct']:.1f}% "
                f"echo={ev['tagEchoRatePct']:.1f}% F1={ev['seenDocTokenF1Pct']:.1f}%",
                flush=True,
            )
            del trained_m
            gc.collect()
            torch.cuda.empty_cache()

    arms_out: dict[str, Any] = {
        "base": aggregate_arm_seeds([base_eval], total_canaries=len(canary_records), seed=seeds[0]),
    }
    for arm_name in arm_names:
        arms_out[arm_name] = aggregate_arm_seeds(arm_runs[arm_name], total_canaries=len(canary_records), seed=seeds[0])

    deltas = {
        "ibPtLm_vs_ptLm": compute_arm_deltas(arms_out["ib_pt_lm"], arms_out["pt_lm"], seed=seeds[0]),
        "ibPtLm_vs_maskingOnly": compute_arm_deltas(arms_out["ib_pt_lm"], arms_out["masking_only"], seed=seeds[0]),
        "ibPtLm_vs_unredacted": compute_arm_deltas(arms_out["ib_pt_lm"], arms_out["unredacted"], seed=seeds[0]),
    }

    d_kl_vs_ptlm = deltas["ibPtLm_vs_ptLm"]["nonPiiSymmetricKl"]["mean"]
    d_ctx_bits_vs_ptlm = deltas["ibPtLm_vs_ptLm"]["contextualSurrogateInversionMeanBits"]["mean"]
    d_probe_vs_ptlm = deltas["ibPtLm_vs_ptLm"]["linearProbeIdentityAccPct"]["mean"]
    d_f1_vs_ptlm = deltas["ibPtLm_vs_ptLm"]["seenDocTokenF1Pct"]["mean"]
    d_echo_vs_mask = deltas["ibPtLm_vs_maskingOnly"]["tagEchoRatePct"]["mean"]

    output = {
        "status": "exploratory",
        "schemaVersion": "1.0.0",
        "kind": "exploratory-ib-ptlm-counterfactual-surrogate-lora",
        "issue": "#39",
        "parentIssue": "#27",
        "mechanism": "IB-PT-LM (Counterfactual Surrogate Information-Bottleneck LoRA)",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": False,
        "wallClockSec": round(time.time() - t0, 3),
        "seeds": seeds,
        "hyperparameters": {
            "modelId": args.model_id,
            "steps": args.steps,
            "learningRate": args.lr,
            "betaKl": args.beta,
            "batchSize": 2,
            "gradAccum": 4,
            "effectiveBatchSize": 8,
            "loraRank": 16,
            "loraAlpha": 32,
            "decoys": args.decoys,
            "surrogateCandidates": 200,
        },
        "provenance": {
            "mode": "live-gpu-lora-ablation",
            "hardware": hw_meta,
            "model": model_meta,
            "surrogatePoolAudit": pool_audit,
            "versieveVaultEntities": vault_res.get("nEntities", 0),
            "nTrainExamples": len(train_specs),
            "nCanaries": len(canary_records),
            "nSeenComplianceQa": len(SEEN_COMPLIANCE_QA),
            "nRepProbeTemplates": len(REP_PROBE_TEMPLATES),
        },
        "objectiveFormulation": {
            "lossEquation": (
                "L_IB-PT-LM = L_CE(y_{~PII} | x(s^(1))) + "
                "beta * 0.5 * [D_KL(p_theta(.|x(s^(1)))_{~PII} || p_theta(.|x(s^(2)))_{~PII}) + "
                "D_KL(p_theta(.|x(s^(2)))_{~PII} || p_theta(.|x(s^(1)))_{~PII})]"
            ),
            "tokenAlignmentNote": (
                "Exact segment-wise causal predictive alignment pairs position (t1 - 1, t2 - 1) for every "
                "non-PII target token even when s^(1) in Pool_A and s^(2) in Pool_B tokenize to different "
                "subword lengths."
            ),
        },
        "arms": arms_out,
        "deltas": deltas,
        "honestAssessment": {
            "deltaNonPiiKlVsPtLm": d_kl_vs_ptlm,
            "deltaContextualSurrogateBitsVsPtLm": d_ctx_bits_vs_ptlm,
            "deltaLinearProbeAccPctVsPtLm": d_probe_vs_ptlm,
            "deltaSeenDocF1PctVsPtLm": d_f1_vs_ptlm,
            "deltaTagEchoPctVsMaskingOnly": d_echo_vs_mask,
            "summary": (
                f"Across {len(seeds)} seeds ({seeds}) on {model_meta['modelId']} (80 steps, lr={args.lr}, beta={args.beta}), "
                f"IB-PT-LM changes post-span non-PII logit sensitivity D_KL by {d_kl_vs_ptlm:+.5f}, "
                f"contextual suffix-inversion surrogate exposure by {d_ctx_bits_vs_ptlm:+.3f} bits, and "
                f"8-way hidden-state identity linear-probe accuracy by {d_probe_vs_ptlm:+.2f} pp vs static PT-LM, "
                f"while changing tag-echo by {d_echo_vs_mask:+.2f} pp vs Masking-only and seen-doc token F1 by "
                f"{d_f1_vs_ptlm:+.2f} pp vs PT-LM. Training wall-clock increases ~2x per step due to dual counterfactual "
                "forward passes."
            ),
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "ok": True,
                "status": output["status"],
                "dryRun": False,
                "out": str(args.out),
                "wallClockSec": output["wallClockSec"],
                "ibNonPiiKl": arms_out["ib_pt_lm"]["aggregate"]["nonPiiSymmetricKl"]["mean"],
                "ptlmNonPiiKl": arms_out["pt_lm"]["aggregate"]["nonPiiSymmetricKl"]["mean"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
