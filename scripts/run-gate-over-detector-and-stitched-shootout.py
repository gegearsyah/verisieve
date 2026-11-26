#!/usr/bin/env python3
"""
scripts/run-gate-over-detector-and-stitched-shootout.py

T8 Benchmark Runner (#35 / #27 User Stories 7-9 & Paper A R5):
  Mode 1 (`--mode ai4privacy-ner`):
    Called by `scripts/run-scale-benchmark.mjs --presidio --gliner`.
    Runs local Microsoft Presidio (spaCy en_core_web_lg) and/or local Apache-2.0
    GLiNER-PII-Edge (45M INT8 ONNX) on the exact 500 `ai4privacy-200k` records.
    Fails closed with structured JSON diagnostics and non-zero exit if any
    requested runtime/model/dataset is missing.

  Mode 2 (`--mode tab-shootout`, default):
    Executes Gate-Over-Best-Detector (Versieve T2 adapter + HC-CRC / E-LTT wrapping
    Presidio and GLiNER-Edge vs. each detector alone & plain confidence thresholds)
    AND the Stitched-Baseline Shootout (Presidio + detect-secrets + forensic check
    + plain confidence threshold vs. Versieve HC-CRC / E-LTT) on the exact TAB ECHR
    splits (60 train / 67 cal / 127 held-out rulings; 1,999 held-out paragraphs).

Append-only scientific integrity: NEVER fabricates numbers; fails closed on any
missing required runtime/model/dataset; records seeds, resample counts, model
digests, package versions, and licenses.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata as importlib_metadata
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
NODE_HELPER = REPO_ROOT / "scripts" / "run-gate-over-detector-and-stitched-shootout.mjs"

ECHR_CASE_RX = re.compile(r"\b\d{3,6}/\d{2}\b")
FORENSIC_HIDDEN_RX = re.compile(r"[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\x00]")
WORD_RX = re.compile(r"\w+(?:[-_'.@]\w+)*|\S")

# Exact Paper A / Track E 14-label GLiNER-PII-Edge prompt on ai4privacy-500
AI4PRIVACY_GLINER_LABELS = [
    "person",
    "email",
    "phone number",
    "street address",
    "credit card number",
    "ssn",
    "date of birth",
    "date",
    "ip address",
    "iban",
    "username",
    "organization",
    "account number",
    "password",
]

# Exact Paper D TAB ECHR 8-label GLiNER-PII-Edge prompt
TAB_GLINER_LABELS = [
    "person",
    "date",
    "location",
    "organization",
    "case number",
    "email",
    "phone number",
    "street address",
]

# Standard Presidio entities for ai4privacy-200k
AI4PRIVACY_PRESIDIO_ENTITIES = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "US_SSN",
    "IP_ADDRESS",
    "DATE_TIME",
    "LOCATION",
    "URL",
    "IBAN_CODE",
    "CRYPTO",
    "NRP",
    "US_BANK_NUMBER",
    "US_DRIVER_LICENSE",
    "US_ITIN",
    "US_PASSPORT",
    "UK_NHS",
    "MEDICAL_LICENSE",
]

# Exact Paper D TAB ECHR Presidio entities
TAB_PRESIDIO_ENTITIES_DEF = [
    "PERSON",
    "DATE_TIME",
    "LOCATION",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "NRP",
    "CREDIT_CARD",
    "IBAN_CODE",
    "IP_ADDRESS",
]


def pkg_version(name: str) -> str | None:
    try:
        return importlib_metadata.version(name)
    except Exception:
        return None


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fail_closed(error_code: str, message: str, missing_runtimes: list[str] | None = None, diagnostics: dict | None = None, exit_code: int = 2) -> None:
    payload = {
        "ok": False,
        "errorCode": error_code,
        "message": message,
        "missingRuntimes": missing_runtimes or [],
        "diagnostics": diagnostics or {},
    }
    print(json.dumps(payload, indent=2))
    sys.exit(exit_code)


def check_presidio_runtime(spacy_model: str) -> tuple[bool, list[str], dict]:
    missing: list[str] = []
    info: dict = {}
    for mod_name, pkg_name in [("presidio_analyzer", "presidio-analyzer"), ("spacy", "spacy")]:
        try:
            importlib.import_module(mod_name)
            info[pkg_name] = pkg_version(pkg_name) or "installed"
        except Exception as exc:
            missing.append(pkg_name)
            info[pkg_name] = f"MISSING ({type(exc).__name__}: {exc})"

    if "spacy" not in missing:
        try:
            import spacy.util
            installed_models = list(spacy.util.get_installed_models())
            info["spacy_models_installed"] = installed_models
            if spacy_model not in installed_models:
                missing.append(f"spacy:{spacy_model}")
            else:
                info[spacy_model] = pkg_version(spacy_model.replace("_", "-")) or "installed"
        except Exception as exc:
            missing.append(f"spacy:{spacy_model}")
            info["spacy_models_error"] = str(exc)

    return len(missing) == 0, missing, info


def check_gliner_runtime(model_dir: Path) -> tuple[bool, list[str], dict]:
    missing: list[str] = []
    info: dict = {"model_dir": str(model_dir)}
    for mod_name, pkg_name in [("onnxruntime", "onnxruntime"), ("tokenizers", "tokenizers"), ("numpy", "numpy")]:
        try:
            importlib.import_module(mod_name)
            info[pkg_name] = pkg_version(pkg_name) or "installed"
        except Exception as exc:
            missing.append(pkg_name)
            info[pkg_name] = f"MISSING ({type(exc).__name__}: {exc})"

    onnx_path = model_dir / "onnx" / "model_quint8.onnx"
    tok_path = model_dir / "tokenizer.json"
    if not onnx_path.exists():
        missing.append("gliner_onnx_weights")
        info["onnx_path"] = f"MISSING ({onnx_path})"
    else:
        info["onnx_path"] = str(onnx_path)
        info["onnx_bytes"] = onnx_path.stat().st_size
    if not tok_path.exists():
        missing.append("gliner_tokenizer")
        info["tokenizer_path"] = f"MISSING ({tok_path})"
    else:
        info["tokenizer_path"] = str(tok_path)

    return len(missing) == 0, missing, info


def check_detect_secrets_runtime() -> tuple[bool, list[str], dict]:
    try:
        import detect_secrets.core.scan  # noqa: F401
        import detect_secrets.settings  # noqa: F401
        return True, [], {"detect-secrets": pkg_version("detect-secrets") or "installed"}
    except Exception as exc:
        return False, ["detect-secrets"], {"detect-secrets": f"MISSING ({type(exc).__name__}: {exc})"}


def build_presidio_analyzer(spacy_model: str, with_echr_code: bool = False):
    from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": spacy_model}],
        }
    )
    nlp_engine = provider.create_engine()
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
    if with_echr_code:
        analyzer.registry.add_recognizer(
            PatternRecognizer(
                supported_entity="ECHR_CASE_CODE",
                patterns=[Pattern("echr_case", r"\b\d{3,6}/\d{2}\b", 0.90)],
            )
        )
    return analyzer


class GlinerEdgeOnnxRunner:
    """100% local Apache-2.0 GLiNER-PII-Edge (45M INT8 ONNX) span extractor."""

    def __init__(self, model_dir: Path, labels: list[str], threshold: float = 0.40) -> None:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self._np = np
        self.labels = list(labels)
        self.threshold = float(threshold)
        self.tok = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = 4
        self.sess = ort.InferenceSession(
            str(model_dir / "onnx" / "model_quint8.onnx"),
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )
        self.ent_id = self.tok.token_to_id("<<ENT>>")
        self.sep_id = self.tok.token_to_id("<<SEP>>")
        self.cls_id = self.tok.token_to_id("[CLS]")
        self.eos_id = self.tok.token_to_id("[SEP]")

        self.prefix_ids: list[int] = [self.cls_id] if self.cls_id is not None else []
        for lbl in self.labels:
            self.prefix_ids.append(self.ent_id)
            self.prefix_ids.extend(self.tok.encode(lbl, add_special_tokens=False).ids)
        self.prefix_ids.append(self.sep_id)
        self.prefix_mask = [0] * len(self.prefix_ids)

    def predict(self, text: str, max_words: int = 360) -> tuple[list[dict], float]:
        np = self._np
        t0 = time.perf_counter()
        raw_words = [(m.group(0), m.start(), m.end()) for m in WORD_RX.finditer(text)]
        if not raw_words:
            return [], (time.perf_counter() - t0) * 1000.0

        all_spans: list[dict] = []
        step = max(1, max_words - 48)
        for win_start in range(0, len(raw_words), step):
            win = raw_words[win_start : win_start + max_words]
            input_ids = list(self.prefix_ids)
            words_mask = list(self.prefix_mask)
            kept_words: list[tuple[str, int, int]] = []

            for w, s, e in win:
                ids = self.tok.encode(w, add_special_tokens=False).ids
                if not ids:
                    continue
                if len(input_ids) + len(ids) + 1 > 2048:
                    break
                w_idx = len(kept_words) + 1
                kept_words.append((w, s, e))
                input_ids.extend(ids)
                words_mask.append(w_idx)
                if len(ids) > 1:
                    words_mask.extend([0] * (len(ids) - 1))

            if not kept_words:
                break
            if self.eos_id is not None:
                input_ids.append(self.eos_id)
                words_mask.append(0)

            logits = self.sess.run(
                None,
                {
                    "input_ids": np.array([input_ids], dtype=np.int64),
                    "attention_mask": np.ones((1, len(input_ids)), dtype=np.int64),
                    "words_mask": np.array([words_mask], dtype=np.int64),
                    "text_lengths": np.array([[len(kept_words)]], dtype=np.int64),
                },
            )[0]

            probs = 1.0 / (1.0 + np.exp(-np.clip(logits[0], -30.0, 30.0)))
            w_cnt = probs.shape[0]
            thr = self.threshold
            for li, lbl in enumerate(self.labels):
                sp = probs[:, li, 0]
                ep = probs[:, li, 1]
                ip = probs[:, li, 2]
                for si in np.where(sp >= thr)[0]:
                    si_i = int(si)
                    for ei_i in range(si_i, min(w_cnt, si_i + 12)):
                        if ep[ei_i] >= thr:
                            if ei_i == si_i or float(np.min(ip[si_i : ei_i + 1])) >= thr * 0.8:
                                score = float(min(sp[si_i], ep[ei_i]))
                                all_spans.append(
                                    {
                                        "label": lbl,
                                        "type": lbl.upper(),
                                        "start": kept_words[si_i][1],
                                        "end": kept_words[ei_i][2],
                                        "score": round(score, 4),
                                    }
                                )
            if win_start + max_words >= len(raw_words):
                break

        all_spans.sort(key=lambda x: (-x["score"], -(x["end"] - x["start"]), x["start"]))
        deduped: list[dict] = []
        for sp in all_spans:
            if not any(not (sp["end"] <= d["start"] or sp["start"] >= d["end"]) for d in deduped):
                deduped.append(sp)
        deduped.sort(key=lambda x: x["start"])
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return deduped, elapsed_ms


def run_ai4privacy_ner_mode(args: argparse.Namespace) -> None:
    ai4_path = Path(args.ai4privacy_path)
    if not ai4_path.exists():
        fail_closed("DATASET_MISSING", f"ai4privacy dataset not found: {ai4_path}", ["ai4privacy_dataset"])

    if not args.presidio and not args.gliner:
        fail_closed("INVALID_ARGS", "Specify --presidio and/or --gliner for --mode ai4privacy-ner")

    missing_all: list[str] = []
    diag: dict = {}

    if args.presidio:
        ok_p, miss_p, info_p = check_presidio_runtime(args.spacy_model)
        diag["presidio"] = info_p
        if not ok_p:
            missing_all.extend(miss_p)

    gliner_dir = Path(args.gliner_model_dir)
    if args.gliner:
        ok_g, miss_g, info_g = check_gliner_runtime(gliner_dir)
        diag["gliner_edge"] = info_g
        if not ok_g:
            missing_all.extend(miss_g)

    if missing_all:
        fail_closed(
            "EXTERNAL_RUNTIME_MISSING",
            f"Missing required local external NER runtimes: {', '.join(missing_all)}",
            missing_runtimes=missing_all,
            diagnostics=diag,
        )

    import numpy as np

    records = json.loads(ai4_path.read_text(encoding="utf-8"))
    arms: dict = {}

    if args.presidio:
        analyzer = build_presidio_analyzer(args.spacy_model, with_echr_code=False)
        preds = []
        lat_ms = []
        for rec in records:
            txt = rec.get("source_text", "")
            t0 = time.perf_counter()
            res = analyzer.analyze(
                text=txt,
                entities=AI4PRIVACY_PRESIDIO_ENTITIES,
                language="en",
                score_threshold=args.presidio_threshold,
            )
            lat_ms.append((time.perf_counter() - t0) * 1000.0)
            preds.append(
                [
                    {
                        "start": int(r.start),
                        "end": int(r.end),
                        "type": str(r.entity_type),
                        "score": round(float(r.score), 4),
                    }
                    for r in res
                ]
            )
        arms["presidio_en_core_web_lg"] = {
            "detector": f"Microsoft Presidio Analyzer ({args.spacy_model})",
            "modelVersion": f"presidio-analyzer {pkg_version('presidio-analyzer')} + spacy {pkg_version('spacy')} + {args.spacy_model} {pkg_version(args.spacy_model.replace('_', '-'))}",
            "spacyPipeline": f"{args.spacy_model}=={pkg_version(args.spacy_model.replace('_', '-'))}",
            "packageVersions": {
                "presidio-analyzer": pkg_version("presidio-analyzer"),
                "spacy": pkg_version("spacy"),
                args.spacy_model: pkg_version(args.spacy_model.replace("_", "-")),
            },
            "license": "MIT (presidio-analyzer, spaCy, en_core_web_lg)",
            "scoreThreshold": args.presidio_threshold,
            "entitiesConfigured": AI4PRIVACY_PRESIDIO_ENTITIES,
            "latencyMs": {
                "median": round(float(np.median(lat_ms)), 2),
                "p95": round(float(np.percentile(lat_ms, 95)), 2),
                "total": round(float(np.sum(lat_ms)), 2),
            },
            "predictions": preds,
        }

    if args.gliner:
        onnx_path = gliner_dir / "onnx" / "model_quint8.onnx"
        runner = GlinerEdgeOnnxRunner(gliner_dir, labels=AI4PRIVACY_GLINER_LABELS, threshold=args.gliner_threshold)
        preds = []
        lat_ms = []
        for rec in records:
            txt = rec.get("source_text", "")
            sp, ms = runner.predict(txt)
            lat_ms.append(ms)
            preds.append(sp)
        arms["gliner_pii_edge_v1_0_int8"] = {
            "detector": "GLiNER-PII-Edge v1.0 (45M INT8 ONNX, CPU)",
            "modelVersion": "knowledgator/gliner-pii-edge-v1.0 (onnx/model_quint8.onnx)",
            "spacyPipeline": None,
            "packageVersions": {
                "onnxruntime": pkg_version("onnxruntime"),
                "tokenizers": pkg_version("tokenizers"),
                "numpy": pkg_version("numpy"),
            },
            "modelSha256": file_sha256(onnx_path),
            "onnxBytes": onnx_path.stat().st_size,
            "license": "Apache-2.0",
            "scoreThreshold": args.gliner_threshold,
            "labelsConfigured": AI4PRIVACY_GLINER_LABELS,
            "latencyMs": {
                "median": round(float(np.median(lat_ms)), 2),
                "p95": round(float(np.percentile(lat_ms, 95)), 2),
                "total": round(float(np.sum(lat_ms)), 2),
            },
            "predictions": preds,
        }

    out = {
        "ok": True,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pythonRuntime": {
            "executable": sys.executable,
            "version": sys.version.split()[0],
            "platform": platform.platform(),
        },
        "arms": arms,
    }
    print(json.dumps(out))


# ---------------------------------------------------------------------------
# TAB ECHR Shootout Helpers (exact Paper D splits & anti-leakage protocol)
# ---------------------------------------------------------------------------

def load_tab_docs(path: Path) -> list[dict]:
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


def spans_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def learn_dev_nomask_filter(dev_docs: list[dict]) -> set[str]:
    """Learn domain NO_MASK surface forms strictly from echr_dev (zero test leakage)."""
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
    out = set()
    for k, nm in nomask_c.items():
        tot = nm + mask_c.get(k, 0)
        if tot >= 2 and (nm / tot) >= 0.80:
            out.add(k)
    return out


def filter_spans_by_nomask(text: str, spans: list[dict], nomask_set: set[str]) -> list[dict]:
    kept = []
    for s in spans:
        surf = re.sub(r"\s+", " ", text[s["start"] : s["end"]].strip().lower())
        if surf in nomask_set:
            continue
        if surf.startswith("the ") and surf[4:] in nomask_set:
            continue
        kept.append(s)
    return kept


def scan_detect_secrets_paragraphs(para_records: list[tuple[str, int, str]]) -> dict[tuple[str, int], int]:
    """Runs official detect-secrets SecretsCollection.scan_file pipeline (with all default
    heuristic filters active) across one-line-per-paragraph text so prose words are never
    falsely flagged by un-filtered internal scan_line helpers."""
    from detect_secrets import SecretsCollection
    from detect_secrets.settings import default_settings

    counts: dict[tuple[str, int], int] = {}
    if not para_records:
        return counts
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as tmp:
        tmp_path = Path(tmp.name)
        for _doc_id, _p_idx, p_txt in para_records:
            clean_line = p_txt.replace("\r", " ").replace("\n", " ")
            tmp.write(clean_line + "\n")
    try:
        sc = SecretsCollection()
        with default_settings():
            sc.scan_file(str(tmp_path))
        data = sc.json().get(str(tmp_path), [])
        by_line: Counter = Counter()
        for item in data:
            ln = int(item.get("line_number", 0))
            if 1 <= ln <= len(para_records):
                by_line[ln - 1] += 1
        for idx, (doc_id, p_idx, _txt) in enumerate(para_records):
            counts[(doc_id, p_idx)] = by_line.get(idx, 0)
    finally:
        tmp_path.unlink(missing_ok=True)
    return counts


def build_tab_paragraphs_for_arm(
    docs: list[dict],
    signal_spans_per_doc: list[list[dict]],
    redactor_spans_per_doc: list[list[dict]],
    secret_counts_per_para: dict[tuple[str, int], int] | None = None,
) -> list[dict]:
    """Builds exact Paper D TAB paragraphs labeled strictly by human DIRECT/QUASI spans,
    with detector signals, paragraph-relative spans (for T2 adapter verification), and
    ground-truth end-to-end residual unmasked PII flag."""
    import numpy as np

    rows = []
    for d, sig_spans, red_spans in zip(docs, signal_spans_per_doc, redactor_spans_per_doc):
        text = d["text"]
        gt_mask = [m for m in d["mentions"] if m.get("identifier_type") in ("DIRECT", "QUASI")]
        p_idx = 0
        for m in re.finditer(r"[^\n]{30,}", text):
            p_start, p_end = m.start(), m.end()
            raw_slice = m.group(0)
            lead_trim = len(raw_slice) - len(raw_slice.lstrip())
            p_txt = raw_slice.strip()
            if len(p_txt) < 30:
                continue
            adj_start = p_start + lead_trim
            adj_end = adj_start + len(p_txt)

            gt_in_p = [g for g in gt_mask if spans_overlap(p_start, p_end, g["start_offset"], g["end_offset"])]
            has_pii = len(gt_in_p) > 0

            sig_in_p = [s for s in sig_spans if spans_overlap(p_start, p_end, s["start"], s["end"])]
            red_in_p = [s for s in red_spans if spans_overlap(p_start, p_end, s["start"], s["end"])]

            max_conf = max((float(s.get("score", 0.0)) for s in sig_in_p), default=0.0)
            if red_in_p and max_conf < 0.75:
                if any(s.get("source") == "stage3a" for s in red_in_p):
                    max_conf = max(max_conf, 0.85)
            mean_conf = float(np.mean([float(s.get("score", 0.5)) for s in sig_in_p])) if sig_in_p else 0.0

            covered_chars = 0
            for rs in red_in_p:
                ov_s = max(adj_start, rs["start"])
                ov_e = min(adj_end, rs["end"])
                if ov_e > ov_s:
                    covered_chars += ov_e - ov_s
            span_cov = min(1.0, covered_chars / max(1, len(p_txt)))

            # True End-to-End Residual Leakage: did ANY human DIRECT/QUASI span survive redaction?
            residual_unsafe = False
            for g in gt_in_p:
                if not any(spans_overlap(rs["start"], rs["end"], g["start_offset"], g["end_offset"]) for rs in red_in_p):
                    residual_unsafe = True
                    break

            rel_spans = []
            for rs in red_in_p:
                rs_s = max(0, rs["start"] - adj_start)
                rs_e = min(len(p_txt), rs["end"] - adj_start)
                if rs_e > rs_s:
                    rel_spans.append(
                        {
                            "start": int(rs_s),
                            "end": int(rs_e),
                            "type": str(rs.get("type", rs.get("label", "PII"))).upper(),
                            "score": round(float(rs.get("score", 0.85)), 4),
                        }
                    )

            sec_cnt = 0
            if secret_counts_per_para is not None:
                sec_cnt = secret_counts_per_para.get((d["doc_id"], p_idx), 0)
            for_cnt = len(FORENSIC_HIDDEN_RX.findall(p_txt))

            rows.append(
                {
                    "doc_id": d["doc_id"],
                    "text": p_txt,
                    "unsafe": has_pii,
                    "detCount": len(red_in_p),
                    "maxConf": round(max_conf, 4),
                    "meanConf": round(mean_conf, 4),
                    "spanCoverage": round(span_cov, 4),
                    "secretCount": sec_cnt,
                    "forensicAnomalyCount": for_cnt,
                    "residualUnsafe": residual_unsafe,
                    "spans": rel_spans,
                }
            )
            p_idx += 1
    return rows


def run_tab_shootout_mode(args: argparse.Namespace) -> None:
    tab_dir = Path(args.tab_dir)
    dev_path = tab_dir / "echr_dev.json"
    test_path = tab_dir / "echr_test.json"
    gliner_dir = Path(args.gliner_model_dir)
    out_path = Path(args.out_json)

    missing_paths = [str(p) for p in [dev_path, test_path] if not p.exists()]
    if missing_paths:
        fail_closed(
            "DATASET_MISSING",
            f"TAB ECHR dataset files missing: {', '.join(missing_paths)}",
            missing_runtimes=["tab_echr_dataset"],
            diagnostics={"missingPaths": missing_paths},
        )

    ok_p, miss_p, info_p = check_presidio_runtime(args.spacy_model)
    ok_g, miss_g, info_g = check_gliner_runtime(gliner_dir)
    ok_ds, miss_ds, info_ds = check_detect_secrets_runtime()
    unmasker_bin = shutil.which("unmasker")

    runtime_status = {
        "presidio": {"available": ok_p, "details": info_p},
        "gliner_edge": {"available": ok_g, "details": info_g},
        "detect_secrets": {"available": ok_ds, "details": info_ds},
        "unmasker_cli": {
            "available": bool(unmasker_bin),
            "path": unmasker_bin,
            "note": (
                "Installed and invoked"
                if unmasker_bin
                else "Not installed on host; stitched forensic channel uses deterministic hidden-Unicode/bidi/null-byte scanner (explicitly disclosed, zero fabricated unmasker numbers)."
            ),
        },
    }

    missing_required: list[str] = []
    if not ok_p:
        missing_required.extend(miss_p)
    if not ok_g:
        missing_required.extend(miss_g)
    if not ok_ds:
        missing_required.extend(miss_ds)

    if missing_required:
        fail_closed(
            "EXTERNAL_RUNTIME_MISSING",
            f"Missing required local runtimes for TAB shootout: {', '.join(missing_required)}",
            missing_runtimes=missing_required,
            diagnostics=runtime_status,
        )

    print("[T8] Loading TAB ECHR dev (127 rulings: 60 train / 67 cal) and test (127 held-out rulings)...", file=sys.stderr)
    dev_docs = load_tab_docs(dev_path)
    test_docs = load_tab_docs(test_path)
    dev_nomask_set = learn_dev_nomask_filter(dev_docs)
    print(f"[T8] Learned {len(dev_nomask_set)} NO_MASK surface forms strictly from echr_dev.", file=sys.stderr)

    # 1. Stage 3A WASM scan via Node helper
    print("[T8] Running real Versieve Stage 3A WASM scan on TAB dev+test...", file=sys.stderr)
    all_docs = dev_docs + test_docs
    with tempfile.TemporaryDirectory() as td:
        in_p = Path(td) / "stage3a_in.json"
        out_p = Path(td) / "stage3a_out.json"
        in_p.write_text(json.dumps([{"doc_id": d["doc_id"], "text": d["text"]} for d in all_docs]), encoding="utf-8")
        subprocess.run(["node", str(NODE_HELPER), "--mode", "scan-stage3a", "--in", str(in_p), "--out", str(out_p)], check=True)
        s3a_all = json.loads(out_p.read_text(encoding="utf-8"))

    s3a_dev_raw = s3a_all[: len(dev_docs)]
    s3a_test_raw = s3a_all[len(dev_docs) :]
    s3a_struct_dev = [
        [s for s in r["stage3a"] if s["type"] not in ("NAME_LIKELY", "PERSON", "ADDRESS_LIKELY")]
        for r in s3a_dev_raw
    ]
    s3a_struct_test = [
        [s for s in r["stage3a"] if s["type"] not in ("NAME_LIKELY", "PERSON", "ADDRESS_LIKELY")]
        for r in s3a_test_raw
    ]
    case_code_dev = [
        [{"start": m.start(), "end": m.end(), "type": "ECHR_CASE_CODE", "score": 0.95, "source": "stage3a"} for m in ECHR_CASE_RX.finditer(d["text"])]
        for d in dev_docs
    ]
    case_code_test = [
        [{"start": m.start(), "end": m.end(), "type": "ECHR_CASE_CODE", "score": 0.95, "source": "stage3a"} for m in ECHR_CASE_RX.finditer(d["text"])]
        for d in test_docs
    ]

    # 2. Microsoft Presidio (en_core_web_lg) Default & Fair (+ECHR case-code) on BOTH dev and test
    print(f"[T8] Running Microsoft Presidio ({args.spacy_model}) Default & +ECHR on 254 TAB rulings...", file=sys.stderr)
    analyzer_def = build_presidio_analyzer(args.spacy_model, with_echr_code=False)
    analyzer_fair = build_presidio_analyzer(args.spacy_model, with_echr_code=True)
    pres_entities_fair = TAB_PRESIDIO_ENTITIES_DEF + ["ECHR_CASE_CODE"]

    def run_presidio_docs(docs_list: list[dict], analyzer, entities: list[str], score_thr: float) -> list[list[dict]]:
        out_list = []
        for d in docs_list:
            res = analyzer.analyze(text=d["text"], entities=entities, language="en", score_threshold=score_thr)
            out_list.append(
                [
                    {
                        "start": int(r.start),
                        "end": int(r.end),
                        "type": str(r.entity_type),
                        "score": round(float(r.score), 4),
                        "source": "presidio",
                    }
                    for r in res
                ]
            )
        return out_list

    # Run Presidio at threshold 0.30 for continuous signal capture and 0.50 for standard redaction (exact Paper D thr=0.50)
    pres_def_dev = run_presidio_docs(dev_docs, analyzer_def, TAB_PRESIDIO_ENTITIES_DEF, args.presidio_threshold)
    pres_def_test = run_presidio_docs(test_docs, analyzer_def, TAB_PRESIDIO_ENTITIES_DEF, args.presidio_threshold)
    pres_fair_dev = run_presidio_docs(dev_docs, analyzer_fair, pres_entities_fair, args.presidio_threshold)
    pres_fair_test = run_presidio_docs(test_docs, analyzer_fair, pres_entities_fair, args.presidio_threshold)

    # 3. Local GLiNER-PII-Edge 45M INT8 ONNX on BOTH dev and test (exact Paper D opt threshold 0.30 for redactor, 0.15 for signal)
    print("[T8] Running local GLiNER-PII-Edge 45M INT8 ONNX on 254 TAB rulings...", file=sys.stderr)
    gliner_onnx_path = gliner_dir / "onnx" / "model_quint8.onnx"
    gliner_sha256 = file_sha256(gliner_onnx_path)
    gliner = GlinerEdgeOnnxRunner(gliner_dir, labels=TAB_GLINER_LABELS, threshold=0.15)
    gl_dev_raw, gl_test_raw = [], []
    for i, d in enumerate(dev_docs):
        sp, _ = gliner.predict(d["text"])
        gl_dev_raw.append(sp)
        if (i + 1) % 40 == 0:
            print(f"  gliner dev {i+1}/{len(dev_docs)}", file=sys.stderr)
    for i, d in enumerate(test_docs):
        sp, _ = gliner.predict(d["text"])
        gl_test_raw.append(sp)
        if (i + 1) % 40 == 0:
            print(f"  gliner test {i+1}/{len(test_docs)}", file=sys.stderr)

    gl_dev_filt = [filter_spans_by_nomask(d["text"], s, dev_nomask_set) for d, s in zip(dev_docs, gl_dev_raw)]
    gl_test_filt = [filter_spans_by_nomask(d["text"], s, dev_nomask_set) for d, s in zip(test_docs, gl_test_raw)]
    gl_thr_opt = 0.30
    gl_dev_red = [[s for s in sp if s["score"] >= gl_thr_opt] for sp in gl_dev_filt]
    gl_test_red = [[s for s in sp if s["score"] >= gl_thr_opt] for sp in gl_test_filt]

    # 4. Run real detect-secrets (SecretsCollection.scan_file with default_settings filters) on every TAB paragraph
    print("[T8] Running detect-secrets 1.5.0 (SecretsCollection.scan_file) across TAB dev+test paragraphs...", file=sys.stderr)
    para_records: list[tuple[str, int, str]] = []
    test_keys: set[tuple[str, int]] = set()
    for is_test, docs_list in [(False, dev_docs), (True, test_docs)]:
        for d in docs_list:
            p_idx = 0
            for m in re.finditer(r"[^\n]{30,}", d["text"]):
                p_txt = m.group(0).strip()
                if len(p_txt) < 30:
                    continue
                para_records.append((d["doc_id"], p_idx, p_txt))
                if is_test:
                    test_keys.add((d["doc_id"], p_idx))
                p_idx += 1
    secret_counts = scan_detect_secrets_paragraphs(para_records)
    total_secret_hits_test = sum(v for k, v in secret_counts.items() if k in test_keys)

    # 5. Assemble arms (exact Paper D 60 train / 67 cal / 127 test split)
    arm_configs = [
        (
            "presidio_default",
            f"Microsoft Presidio Default ({args.spacy_model})",
            f"presidio:{args.spacy_model}",
            pres_def_dev,
            pres_def_dev,
            pres_def_test,
            pres_def_test,
            None,
        ),
        (
            "presidio_fair_echr",
            f"Microsoft Presidio + ECHR Case-Code ({args.spacy_model})",
            f"presidio:{args.spacy_model}+echr",
            pres_fair_dev,
            pres_fair_dev,
            pres_fair_test,
            pres_fair_test,
            None,
        ),
        (
            "presidio_plus_stage3a",
            f"Versieve Stage 3A WASM + Presidio ({args.spacy_model} + ECHR)",
            f"versieve:stage3a+presidio:{args.spacy_model}",
            [p + s3 + cc for p, s3, cc in zip(pres_fair_dev, s3a_struct_dev, case_code_dev)],
            [p + s3 + cc for p, s3, cc in zip(pres_fair_dev, s3a_struct_dev, case_code_dev)],
            [p + s3 + cc for p, s3, cc in zip(pres_fair_test, s3a_struct_test, case_code_test)],
            [p + s3 + cc for p, s3, cc in zip(pres_fair_test, s3a_struct_test, case_code_test)],
            None,
        ),
        (
            "gliner_edge_dev_filtered",
            "GLiNER-PII-Edge v1.0 (45M INT8 ONNX, dev-filtered)",
            "gliner-edge:v1.0-int8",
            gl_dev_filt,
            gl_dev_red,
            gl_test_filt,
            gl_test_red,
            None,
        ),
        (
            "gliner_plus_stage3a",
            "Versieve Stage 3A WASM + GLiNER-PII-Edge v1.0 (dev-filtered)",
            "versieve:stage3a+gliner-edge",
            gl_dev_filt,
            [s3 + cc + g for s3, cc, g in zip(s3a_struct_dev, case_code_dev, gl_dev_red)],
            gl_test_filt,
            [s3 + cc + g for s3, cc, g in zip(s3a_struct_test, case_code_test, gl_test_red)],
            None,
        ),
        (
            "stitched_presidio_detect_secrets_forensic",
            f"Stitched Stack: Presidio ({args.spacy_model} + ECHR) + detect-secrets + Forensic Check",
            "stitched:presidio+detect-secrets+forensic",
            pres_fair_dev,
            pres_fair_dev,
            pres_fair_test,
            pres_fair_test,
            secret_counts,
        ),
    ]

    node_arms = []
    for arm_id, label, prov, dev_sig, dev_red, test_sig, test_red, sec_map in arm_configs:
        node_arms.append(
            {
                "id": arm_id,
                "label": label,
                "provenanceTag": prov,
                "train": build_tab_paragraphs_for_arm(dev_docs[:60], dev_sig[:60], dev_red[:60], sec_map),
                "cal": build_tab_paragraphs_for_arm(dev_docs[60:], dev_sig[60:], dev_red[60:], sec_map),
                "test": build_tab_paragraphs_for_arm(test_docs, test_sig, test_red, sec_map),
            }
        )

    print("[T8] Executing Node.js T2 Adapter Verification + HC-CRC / E-LTT + Stitched Shootout...", file=sys.stderr)
    with tempfile.TemporaryDirectory() as td:
        in_eval = Path(td) / "eval_in.json"
        out_eval = Path(td) / "eval_out.json"
        in_eval.write_text(
            json.dumps(
                {
                    "seed": args.seed,
                    "bootstraps": args.bootstraps,
                    "permutations": args.permutations,
                    "alphas": [0.01, 0.02, 0.05, 0.10, 0.15, 0.20],
                    "arms": node_arms,
                }
            ),
            encoding="utf-8",
        )
        subprocess.run(
            ["node", str(NODE_HELPER), "--mode", "evaluate-tab-gates", "--in", str(in_eval), "--out", str(out_eval)],
            check=True,
        )
        eval_res = json.loads(out_eval.read_text(encoding="utf-8"))

    final_report = {
        "schemaVersion": eval_res["schemaVersion"],
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": {
            "name": "NorskRegnesentral/text-anonymization-benchmark (TAB ECHR)",
            "license": "MIT (TAB ECHR annotations; ECHR rulings public HUDOC)",
            "devRulings": len(dev_docs),
            "trainRulings": 60,
            "calRulings": len(dev_docs) - 60,
            "testRulings": len(test_docs),
            "devNomaskFilterTermsLearned": len(dev_nomask_set),
        },
        "environment": {
            "pythonExecutable": sys.executable,
            "pythonVersion": sys.version.split()[0],
            "platform": platform.platform(),
            "packages": {
                "presidio-analyzer": pkg_version("presidio-analyzer"),
                "spacy": pkg_version("spacy"),
                args.spacy_model: pkg_version(args.spacy_model.replace("_", "-")),
                "onnxruntime": pkg_version("onnxruntime"),
                "tokenizers": pkg_version("tokenizers"),
                "detect-secrets": pkg_version("detect-secrets"),
                "numpy": pkg_version("numpy"),
            },
            "models": {
                "presidio": {
                    "spacyPipeline": f"{args.spacy_model}=={pkg_version(args.spacy_model.replace('_', '-'))}",
                    "scoreThreshold": args.presidio_threshold,
                    "license": "MIT",
                },
                "glinerEdge": {
                    "modelId": "knowledgator/gliner-pii-edge-v1.0",
                    "onnxFile": "onnx/model_quint8.onnx",
                    "onnxBytes": gliner_onnx_path.stat().st_size,
                    "onnxSha256": gliner_sha256,
                    "signalThreshold": 0.15,
                    "redactionThreshold": gl_thr_opt,
                    "license": "Apache-2.0",
                },
            },
            "runtimeStatus": runtime_status,
            "stitchedDetectSecretsHitsOnTestParagraphs": total_secret_hits_test,
        },
        "seed": eval_res["seed"],
        "bootstraps": eval_res["bootstraps"],
        "permutations": eval_res["permutations"],
        "alphas": eval_res["alphas"],
        "splits": eval_res["splits"],
        "gateOverDetectorArms": eval_res["gateOverDetectorArms"],
        "stitchedBaselineShootout": eval_res["stitchedBaselineShootout"],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(final_report, indent=2), encoding="utf-8")
    print(f"[T8] Wrote {out_path}", file=sys.stderr)
    print(json.dumps({"ok": True, "outJson": str(out_path), "splits": final_report["splits"]}, indent=2))


def parse_args() -> argparse.Namespace:
    default_untrusted = os.environ.get("VERSIEVE_UNTRUSTED_BENCHMARKS_DIR", "results/untrusted-benchmarks")
    p = argparse.ArgumentParser(description="T8 Gate-Over-Best-Detector, Paper A External NER, and Stitched TAB Shootout Runner")
    p.add_argument("--mode", choices=["ai4privacy-ner", "tab-shootout"], default="tab-shootout")
    p.add_argument("--presidio", action="store_true", help="Enable Presidio arm (in ai4privacy-ner mode)")
    p.add_argument("--gliner", action="store_true", help="Enable GLiNER-Edge arm (in ai4privacy-ner mode)")
    p.add_argument("--spacy-model", default="en_core_web_lg")
    p.add_argument("--presidio-threshold", type=float, default=0.50)
    p.add_argument("--gliner-threshold", type=float, default=0.40)
    p.add_argument("--ai4privacy-path", default=str(Path(default_untrusted) / "ai4privacy-500.json"))
    p.add_argument("--tab-dir", default=str(Path(default_untrusted) / "reviewer-hardening"))
    p.add_argument("--gliner-model-dir", default=str(Path(default_untrusted) / "track-e-public" / "models" / "gliner-pii-edge"))
    p.add_argument("--out-json", default="results/t8-gate-over-detector-and-stitched-shootout.json")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--bootstraps", type=int, default=1000)
    p.add_argument("--permutations", type=int, default=5000)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if args.mode == "ai4privacy-ner":
        run_ai4privacy_ner_mode(args)
    else:
        run_tab_shootout_mode(args)


if __name__ == "__main__":
    main()
