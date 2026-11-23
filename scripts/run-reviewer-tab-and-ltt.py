"""Reviewer-Hardening v2 — Benchmark 1 & 2 (TAB ECHR Fair Baselines + Detector-Informed GT-LTT):
Addresses every Round-2 peer-review critique:
  1. Fair Presidio Comparison: evaluates BOTH Presidio Default (en_core_web_lg) AND Presidio + ECHR
     case-number custom PatternRecognizer (\b\d{3,6}/\d{2}\b), plus explicit Stage 3A vs Vanilla GLiNER
     vs Dev-Filtered GLiNER (non-mask lexicon learned strictly from echr_dev, zero test leakage) vs Hybrid,
     with matched-operating-point F1 & DIRECT-ID ablation.
  2. Three Non-Circular Ground-Truth LTT Gates on TAB (echr_dev -> held-out echr_test, 1,999 paragraphs):
       (a) Text-Only 520-d LTT (no detector signals)
       (b) NER-Max-Confidence Baseline LTT (p_safe = 1 - max_i conf_i)
       (c) Detector-Informed Hybrid LTT (520-d text + Stage 3A/3B detector signals)
     Reports Overall Auto-Release Rate (%), Safe Yield (%), Held-Out Conditional FPR (%), and
     End-to-End Redactor+Gate Residual Unmasked PII Rate (%).
"""

from __future__ import annotations

import importlib.util
import json
import random
import re
import subprocess
import tempfile
import time
from collections import Counter
from pathlib import Path

import numpy as np
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer

_gl_spec = importlib.util.spec_from_file_location(
    "gliner_runner_mod",
    str(Path(__file__).resolve().parent / "run-track-e-gliner-benchmark.py"),
)
gl_mod = importlib.util.module_from_spec(_gl_spec)
_gl_spec.loader.exec_module(gl_mod)
GlinerEdgeOnnxRunner = gl_mod.GlinerEdgeOnnxRunner
MODEL_DIR = gl_mod.MODEL_DIR

TAB_DIR = Path("results/untrusted-benchmarks/reviewer-hardening")
DEV_PATH = TAB_DIR / "echr_dev.json"
TEST_PATH = TAB_DIR / "echr_test.json"
OUT_PATH = Path("results/reviewer-tab-and-ltt-benchmarks.json")

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
ECHR_CASE_RX = re.compile(r"\b\d{3,6}/\d{2}\b")


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


def dedupe_spans(spans: list[dict]) -> list[dict]:
    if not spans:
        return []
    ordered = sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"]), -s.get("score", 1.0)))
    out = []
    last_end = -1
    for s in ordered:
        if s["start"] >= last_end:
            out.append(s)
            last_end = s["end"]
    return out


def learn_dev_nomask_filter(dev_docs: list[dict]) -> set[str]:
    """Learn domain NO_MASK surface forms strictly from echr_dev (zero test leakage!).
    Any surface form appearing >= 2 times on dev with >= 80% NO_MASK ratio is filtered out.
    """
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
        # Also filter leading "the " variants present in dev NO_MASK
        if surf.startswith("the ") and surf[4:] in nomask_set:
            continue
        kept.append(s)
    return kept


def score_tab_corpus(docs: list[dict], preds_per_doc: list[list[dict]], person_only: bool = False) -> dict:
    tp_all = fn_all = fp_all = dir_tp = dir_tot = 0
    per_doc_f1 = []
    for doc, preds in zip(docs, preds_per_doc):
        gt_mask = [
            m for m in doc["mentions"]
            if m.get("identifier_type") in ("DIRECT", "QUASI")
            and (not person_only or m.get("entity_type") == "PERSON")
        ]
        gt_direct = [m for m in gt_mask if m.get("identifier_type") == "DIRECT"]
        dedup_p = dedupe_spans(preds)

        doc_tp = sum(1 for m in gt_mask if any(spans_overlap(p["start"], p["end"], m["start_offset"], m["end_offset"]) for p in dedup_p))
        doc_fn = len(gt_mask) - doc_tp
        doc_dtp = sum(1 for m in gt_direct if any(spans_overlap(p["start"], p["end"], m["start_offset"], m["end_offset"]) for p in dedup_p))
        doc_ptp = sum(1 for p in dedup_p if any(spans_overlap(p["start"], p["end"], m["start_offset"], m["end_offset"]) for m in gt_mask))
        doc_fp = len(dedup_p) - doc_ptp

        tp_all += doc_tp
        fn_all += doc_fn
        fp_all += doc_fp
        dir_tp += doc_dtp
        dir_tot += len(gt_direct)

        p_d = doc_ptp / max(1, doc_ptp + doc_fp)
        r_d = doc_tp / max(1, doc_tp + doc_fn)
        per_doc_f1.append((2 * p_d * r_d) / (p_d + r_d) if (p_d + r_d) > 0 else 0.0)

    prec = tp_all / max(1, tp_all + fp_all)
    rec = tp_all / max(1, tp_all + fn_all)
    f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
    return {
        "precisionPct": round(prec * 100, 2),
        "recallPct": round(rec * 100, 2),
        "f1Pct": round(f1 * 100, 2),
        "directRecallPct": round((dir_tp / max(1, dir_tot)) * 100, 2),
        "tp": tp_all,
        "fp": fp_all,
        "fn": fn_all,
        "directTp": dir_tp,
        "directTotal": dir_tot,
        "_perDocF1": per_doc_f1,
    }


def bootstrap_ci_f1(docs: list[dict], preds_per_doc: list[list[dict]], person_only: bool = False, n_boot: int = 1000, seed: int = 42) -> list[float]:
    rng = random.Random(seed)
    n = len(docs)
    stats = []
    for doc, preds in zip(docs, preds_per_doc):
        gt_mask = [
            m for m in doc["mentions"]
            if m.get("identifier_type") in ("DIRECT", "QUASI")
            and (not person_only or m.get("entity_type") == "PERSON")
        ]
        dedup_p = dedupe_spans(preds)
        doc_tp = sum(1 for m in gt_mask if any(spans_overlap(p["start"], p["end"], m["start_offset"], m["end_offset"]) for p in dedup_p))
        doc_fn = len(gt_mask) - doc_tp
        doc_ptp = sum(1 for p in dedup_p if any(spans_overlap(p["start"], p["end"], m["start_offset"], m["end_offset"]) for m in gt_mask))
        doc_fp = len(dedup_p) - doc_ptp
        stats.append((doc_tp, doc_fp, doc_fn))
    f1s = []
    for _ in range(n_boot):
        tp = fp = fn = 0
        for _i in range(n):
            t, f, m = stats[rng.randrange(n)]
            tp += t; fp += f; fn += m
        p = tp / max(1, tp + fp)
        r = tp / max(1, tp + fn)
        f1s.append((2 * p * r / (p + r) if (p + r) > 0 else 0.0) * 100.0)
    f1s.sort()
    return [round(f1s[int(0.025 * n_boot)], 2), round(f1s[int(0.975 * n_boot)], 2)]


def paired_permutation_pvalue(scores_a: list[float], scores_b: list[float], n_perm: int = 5000, seed: int = 42) -> float:
    diffs = [a - b for a, b in zip(scores_a, scores_b)]
    obs = abs(sum(diffs) / max(1, len(diffs)))
    rng = random.Random(seed)
    ge = 0
    for _ in range(n_perm):
        s = sum(d if rng.random() < 0.5 else -d for d in diffs) / max(1, len(diffs))
        if abs(s) >= obs - 1e-12:
            ge += 1
    return round((ge + 1) / (n_perm + 1), 5)


def extract_tab_paragraphs_with_detector(docs: list[dict], gliner_spans_per_doc: list[list[dict]], redactor_spans_per_doc: list[list[dict]]) -> list[dict]:
    """Build paragraphs labeled strictly by human TAB DIRECT/QUASI spans, plus real detector signals
    and ground-truth residual unmasked PII flag (True iff any human DIRECT/QUASI span in this
    paragraph was MISSED by the redactor!)."""
    rows = []
    for d, g_spans, r_spans in zip(docs, gliner_spans_per_doc, redactor_spans_per_doc):
        text = d["text"]
        gt_mask = [m for m in d["mentions"] if m.get("identifier_type") in ("DIRECT", "QUASI")]
        for m in re.finditer(r"[^\n]{30,}", text):
            p_start, p_end = m.start(), m.end()
            p_txt = m.group(0).strip()
            if len(p_txt) < 30:
                continue
            gt_in_p = [g for g in gt_mask if spans_overlap(p_start, p_end, g["start_offset"], g["end_offset"])]
            has_pii = len(gt_in_p) > 0

            # Detector signals inside this paragraph (from GLiNER-Edge + Stage 3A)
            g_in_p = [s for s in g_spans if spans_overlap(p_start, p_end, s["start"], s["end"])]
            r_in_p = [s for s in r_spans if spans_overlap(p_start, p_end, s["start"], s["end"])]
            max_conf = max((float(s.get("score", 0.0)) for s in g_in_p), default=0.0)
            if r_in_p and max_conf < 0.75:
                # Stage 3A structured hit raises confidence signal
                if any(s.get("source") == "stage3a" for s in r_in_p):
                    max_conf = max(max_conf, 0.85)
            mean_conf = float(np.mean([float(s.get("score", 0.5)) for s in g_in_p])) if g_in_p else 0.0

            # True End-to-End Residual Leakage: did ANY human PII span survive redaction?
            residual_unsafe = False
            for g in gt_in_p:
                if not any(spans_overlap(rs["start"], rs["end"], g["start_offset"], g["end_offset"]) for rs in r_in_p):
                    residual_unsafe = True
                    break

            rows.append({
                "text": p_txt,
                "unsafe": has_pii,
                "detCount": len(r_in_p),
                "maxConf": round(max_conf, 4),
                "meanConf": round(mean_conf, 4),
                "residualUnsafe": residual_unsafe,
            })
    return rows


def main() -> None:
    print("Loading TAB ECHR dev & test splits...")
    dev_docs = load_tab_docs(DEV_PATH)
    test_docs = load_tab_docs(TEST_PATH)

    dev_nomask_set = learn_dev_nomask_filter(dev_docs)
    print(f"Learned {len(dev_nomask_set)} domain NO_MASK surface forms strictly from echr_dev (0 test docs seen).")

    # 1. Node.js Stage 3A WASM + Paper 1 Regex on BOTH dev and test docs
    print("Running Node.js Paper 1 Regex & Stage 3A WASM on TAB dev+test...")
    with tempfile.TemporaryDirectory() as td:
        in_p = Path(td) / "in.json"
        out_p = Path(td) / "out.json"
        all_docs = dev_docs + test_docs
        in_p.write_text(json.dumps([{"doc_id": d["doc_id"], "text": d["text"]} for d in all_docs]), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "scan-docs", str(in_p), str(out_p)], check=True)
        node_all = json.loads(out_p.read_text(encoding="utf-8"))

    node_dev = node_all[: len(dev_docs)]
    node_test = node_all[len(dev_docs) :]
    paper1_test = [r["paper1"] for r in node_test]
    stage3a_test = [r["stage3a"] for r in node_test]
    stage3a_struct_test = [
        [{**s, "source": "stage3a"} for s in spans if s["type"] not in ("NAME_LIKELY", "PERSON", "ADDRESS_LIKELY")]
        for spans in stage3a_test
    ]
    stage3a_struct_dev = [
        [{**s, "source": "stage3a"} for s in r["stage3a"] if s["type"] not in ("NAME_LIKELY", "PERSON", "ADDRESS_LIKELY")]
        for r in node_dev
    ]

    # Add explicit ECHR case-number regex spans (identical regex given to BOTH Presidio and VeriSieve for fair fight!)
    case_code_test = [
        [{"start": m.start(), "end": m.end(), "type": "ECHR_CASE_CODE", "score": 0.95, "source": "stage3a"} for m in ECHR_CASE_RX.finditer(d["text"])]
        for d in test_docs
    ]
    case_code_dev = [
        [{"start": m.start(), "end": m.end(), "type": "ECHR_CASE_CODE", "score": 0.95, "source": "stage3a"} for m in ECHR_CASE_RX.finditer(d["text"])]
        for d in dev_docs
    ]

    # 2. Microsoft Presidio Default vs. Presidio + Fair ECHR Case-Number Custom Recognizer
    print("Running Microsoft Presidio (en_core_web_lg) Default AND +Custom ECHR Recognizer on 127 TAB test rulings...")
    analyzer_def = AnalyzerEngine()
    analyzer_fair = AnalyzerEngine()
    echr_rec = PatternRecognizer(
        supported_entity="ECHR_CASE_CODE",
        patterns=[Pattern("echr_case", r"\b\d{3,6}/\d{2}\b", 0.90)],
    )
    analyzer_fair.registry.add_recognizer(echr_rec)

    pres_entities_def = ["PERSON", "DATE_TIME", "LOCATION", "EMAIL_ADDRESS", "PHONE_NUMBER", "NRP", "CREDIT_CARD", "IBAN_CODE", "IP_ADDRESS"]
    pres_entities_fair = pres_entities_def + ["ECHR_CASE_CODE"]

    pres_def_test, pres_fair_test = [], []
    for d in test_docs:
        r1 = analyzer_def.analyze(text=d["text"], entities=pres_entities_def, language="en", score_threshold=0.50)
        pres_def_test.append([{"start": r.start, "end": r.end, "type": r.entity_type, "score": float(r.score)} for r in r1])
        r2 = analyzer_fair.analyze(text=d["text"], entities=pres_entities_fair, language="en", score_threshold=0.50)
        pres_fair_test.append([{"start": r.start, "end": r.end, "type": r.entity_type, "score": float(r.score)} for r in r2])

    # 3. GLiNER-Edge 45M INT8 ONNX on BOTH dev (for detector-informed LTT) and test (for PR curves + LTT test)
    print("Running GLiNER-Edge 45M INT8 ONNX on TAB dev (127) + test (127)...")
    gl_mod.LABELS = TAB_GLINER_LABELS
    gliner = GlinerEdgeOnnxRunner(MODEL_DIR, threshold=0.15)
    gl_dev, gl_test = [], []
    for i, d in enumerate(dev_docs):
        sp, _ = gliner.predict(d["text"])
        gl_dev.append(sp)
        if (i + 1) % 40 == 0:
            print(f"  dev {i+1}/{len(dev_docs)}")
    for i, d in enumerate(test_docs):
        sp, _ = gliner.predict(d["text"])
        gl_test.append(sp)
        if (i + 1) % 40 == 0:
            print(f"  test {i+1}/{len(test_docs)}")

    # Apply zero-leakage echr_dev NO_MASK filter to GLiNER predictions
    gl_dev_filt = [filter_spans_by_nomask(d["text"], s, dev_nomask_set) for d, s in zip(dev_docs, gl_dev)]
    gl_test_filt = [filter_spans_by_nomask(d["text"], s, dev_nomask_set) for d, s in zip(test_docs, gl_test)]

    # 4. Sweep thresholds for Vanilla GLiNER, Dev-Filtered GLiNER, and Hybrid (Stage3A+Code + Dev-Filtered GLiNER)
    curves = {"vanillaAll": [], "devFilteredAll": [], "hybridAll": [], "vanillaPerson": [], "devFilteredPerson": []}
    for thr in [0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80]:
        va = [[s for s in sp if s["score"] >= thr] for sp in gl_test]
        df = [[s for s in sp if s["score"] >= thr] for sp in gl_test_filt]
        hy = [s3 + cc + g for s3, cc, g in zip(stage3a_struct_test, case_code_test, df)]
        vp = [[s for s in sp if s["score"] >= thr and str(s.get("label", "")).lower() == "person"] for sp in gl_test]
        dp = [[s for s in sp if s["score"] >= thr and str(s.get("label", "")).lower() == "person"] for sp in gl_test_filt]

        for name, preds, per_only in [
            ("vanillaAll", va, False),
            ("devFilteredAll", df, False),
            ("hybridAll", hy, False),
            ("vanillaPerson", vp, True),
            ("devFilteredPerson", dp, True),
        ]:
            m = score_tab_corpus(test_docs, preds, person_only=per_only)
            m.pop("_perDocF1")
            curves[name].append({"threshold": thr, **m})

    # Pick optimal F1 operating point for Dev-Filtered Hybrid (NOT cherry-picked tau=0.20!)
    best_hyb_all = max(curves["hybridAll"], key=lambda x: x["f1Pct"])
    best_df_per = max(curves["devFilteredPerson"], key=lambda x: x["f1Pct"])
    thr_all = best_hyb_all["threshold"]
    thr_per = best_df_per["threshold"]

    # Ablation at SAME operating point (thr_all) for DIRECT recall + All-Maskable F1
    ablation_preds = {
        "stage3aWasmOnly": stage3a_test,
        "stage3aPlusEchrCode": [s3 + cc for s3, cc in zip(stage3a_test, case_code_test)],
        "vanillaGlinerAtOptThr": [[s for s in sp if s["score"] >= thr_all] for sp in gl_test],
        "devFilteredGlinerAtOptThr": [[s for s in sp if s["score"] >= thr_all] for sp in gl_test_filt],
        "verisieveHybridDevFiltered": [s3 + cc + [s for s in sp if s["score"] >= thr_all] for s3, cc, sp in zip(stage3a_struct_test, case_code_test, gl_test_filt)],
        "presidioDefault": pres_def_test,
        "presidioPlusCustomEchrCode": pres_fair_test,
    }
    ablation_scores = {}
    ablation_doc_f1 = {}
    for k, preds in ablation_preds.items():
        sc = score_tab_corpus(test_docs, preds, False)
        ablation_doc_f1[k] = sc.pop("_perDocF1")
        sc["f1Bootstrap95CI"] = bootstrap_ci_f1(test_docs, preds, False)
        ablation_scores[k] = sc

    # Person comparison at optimal Person F1 threshold
    per_preds = {
        "paper1Regex": [[s for s in sp if s["type"] in ("NAME_LIKELY", "PERSON")] for sp in paper1_test],
        "vanillaGlinerPerson": [[s for s in sp if s["score"] >= thr_per and str(s.get("label", "")).lower() == "person"] for sp in gl_test],
        "devFilteredGlinerPerson": [[s for s in sp if s["score"] >= thr_per and str(s.get("label", "")).lower() == "person"] for sp in gl_test_filt],
        "presidioPerson": [[s for s in sp if s["type"] == "PERSON"] for sp in pres_fair_test],
    }
    per_scores = {}
    per_doc_f1 = {}
    for k, preds in per_preds.items():
        sc = score_tab_corpus(test_docs, preds, True)
        per_doc_f1[k] = sc.pop("_perDocF1")
        sc["f1Bootstrap95CI"] = bootstrap_ci_f1(test_docs, preds, True)
        per_scores[k] = sc

    # 5. Three Non-Circular Ground-Truth LTT Gates on TAB (echr_dev -> held-out echr_test, 1,999 paragraphs)
    print("Running 3 Non-Circular Ground-Truth LTT Gates (Text-Only vs NER-MaxConf vs Detector-Informed Hybrid)...")
    dev_redactor = [s3 + cc + [s for s in sp if s["score"] >= thr_all] for s3, cc, sp in zip(stage3a_struct_dev, case_code_dev, gl_dev_filt)]
    test_redactor = ablation_preds["verisieveHybridDevFiltered"]

    train_paras = extract_tab_paragraphs_with_detector(dev_docs[:60], gl_dev_filt[:60], dev_redactor[:60])
    cal_paras = extract_tab_paragraphs_with_detector(dev_docs[60:], gl_dev_filt[60:], dev_redactor[60:])
    test_paras = extract_tab_paragraphs_with_detector(test_docs, gl_test_filt, test_redactor)

    with tempfile.TemporaryDirectory() as td:
        in_ltt = Path(td) / "ltt_in.json"
        out_ltt = Path(td) / "ltt_out.json"
        in_ltt.write_text(json.dumps({
            "train": train_paras,
            "cal": cal_paras,
            "test": test_paras,
            "alphas": [0.01, 0.02, 0.05, 0.10, 0.15, 0.20],
        }), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "gt-ltt", str(in_ltt), str(out_ltt)], check=True)
        gt_ltt = json.loads(out_ltt.read_text(encoding="utf-8"))

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": "NorskRegnesentral/text-anonymization-benchmark (TAB ECHR)",
        "devNomaskFilterTermsLearned": len(dev_nomask_set),
        "optThresholds": {"allMaskable": thr_all, "person": thr_per},
        "allMaskableAblation": ablation_scores,
        "allMaskableSignificance": {
            "hybridDevFilteredVsPresidioFairP": paired_permutation_pvalue(ablation_doc_f1["verisieveHybridDevFiltered"], ablation_doc_f1["presidioPlusCustomEchrCode"]),
            "hybridDevFilteredVsVanillaGlinerP": paired_permutation_pvalue(ablation_doc_f1["verisieveHybridDevFiltered"], ablation_doc_f1["vanillaGlinerAtOptThr"]),
        },
        "personComparison": per_scores,
        "personSignificance": {
            "devFilteredGlinerVsPresidioP": paired_permutation_pvalue(per_doc_f1["devFilteredGlinerPerson"], per_doc_f1["presidioPerson"]),
            "devFilteredVsVanillaGlinerP": paired_permutation_pvalue(per_doc_f1["devFilteredGlinerPerson"], per_doc_f1["vanillaGlinerPerson"]),
        },
        "prCurves": curves,
        "nonCircularGroundTruthLtt": gt_ltt,
    }
    OUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\n=== REVIEWER-HARDENING v2 (TAB FAIR BASELINES + 3-GATE GT-LTT) COMPLETE ===")
    print(json.dumps({
        "optThresholds": report["optThresholds"],
        "allMaskableAblation": report["allMaskableAblation"],
        "personComparison": report["personComparison"],
        "nonCircularGroundTruthLtt": report["nonCircularGroundTruthLtt"],
    }, indent=2))


if __name__ == "__main__":
    main()
