"""scripts/evaluate-track-c-lfm3.py
Controlled local RTX 4070 evaluation of LFM3-1.7B-Base across:
  - LFM3_BASE (closed-book)
  - T1_OLD_SAFE_LORA (Nov 18 flat 49.4-tok adapter — 90% blank-EOS baseline)
  - T2_TRACK_C_PACKED_LORA (Track C Graph-Grounded Packed LoRA)
  - Optional T3 Hybrid (T2 LoRA + pre-retrieved redacted Graph-PPR context JSON)

Uses the EXACT same greedy decoding + enable_thinking=False + immediate-EOS-permitted
protocol from evaluate-lfm3-compliance.py so results are 100% apples-to-apples!
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections.abc import Mapping
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

SYSTEM_PROMPT = (
    "You are a compliance research assistant. Distinguish legal requirements from guidance, "
    "state uncertainty, and do not invent section citations. This is not legal advice."
)

ABSTENTION_PHRASES = (
    "not covered",
    "not specified",
    "cannot determine",
    "cannot answer",
    "not mentioned",
    "not provided",
    "no information",
    "does not cover",
    "does not specify",
    "i don't know",
    "i am unsure",
    "out of scope",
)


def tokenize_f1(text: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z0-9$%]+", " ", text.lower()).split() if len(w) > 1]


def compute_f1(pred: str, ref: str) -> float:
    p = tokenize_f1(pred)
    r = tokenize_f1(ref)
    if not p or not r:
        return 0.0
    counts: dict[str, int] = {}
    for w in r:
        counts[w] = counts.get(w, 0) + 1
    overlap = 0
    for w in p:
        if counts.get(w, 0) > 0:
            overlap += 1
            counts[w] -= 1
    if overlap == 0:
        return 0.0
    prec = overlap / len(p)
    rec = overlap / len(r)
    return (2 * prec * rec) / (prec + rec)


def key_point_recall(pred: str, key_points: list[str]) -> float:
    if not key_points:
        return 0.0
    pred_toks = set(tokenize_f1(pred))
    if not pred_toks:
        return 0.0
    hit_sum = 0.0
    for kp in key_points:
        kp_toks = [t for t in tokenize_f1(kp) if t not in {"the", "and", "for", "with", "that", "from", "are", "not"}]
        if not kp_toks:
            continue
        matched = sum(1 for t in kp_toks if t in pred_toks)
        if matched / len(kp_toks) >= 0.5:
            hit_sum += 1.0
    return hit_sum / len(key_points)


def is_abstention(text: str) -> bool:
    low = text.lower()
    return any(p in low for p in ABSTENTION_PHRASES)


def is_effectively_empty(text: str) -> bool:
    stripped = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    return len(stripped) < 5


def generate_answer(model, tokenizer, question: str, max_new_tokens: int = 128, context: str | None = None) -> tuple[str, float]:
    user_content = (
        f"Answer concisely using ONLY the verified excerpts below. If not covered, say 'Not covered in the provided documents.'\n\n"
        f"Verified Excerpts:\n{context}\n\nQuestion: {question}"
        if context
        else question
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    try:
        encoded = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
            return_tensors="pt",
        )
    except TypeError:
        encoded = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        )

    if isinstance(encoded, Mapping):
        input_ids = encoded["input_ids"]
        attention_mask = encoded.get("attention_mask")
    else:
        input_ids = encoded
        attention_mask = None
    if attention_mask is None:
        attention_mask = torch.ones_like(input_ids)

    device = model.get_input_embeddings().weight.device
    input_ids = input_ids.to(device)
    attention_mask = attention_mask.to(device)

    t0 = time.perf_counter()
    with torch.inference_mode():
        out = model.generate(
            input_ids=input_ids,
            attention_mask=attention_mask,
            do_sample=False,
            max_new_tokens=max_new_tokens,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    text = tokenizer.decode(out[0, input_ids.shape[1] :], skip_special_tokens=True).strip()
    return text, round(elapsed_ms, 1)


def score_condition(name: str, rows: list[dict]) -> dict:
    n = len(rows) or 1
    in_scope = [r for r in rows if not r["expected_out_of_scope"]]
    out_scope = [r for r in rows if r["expected_out_of_scope"]]
    empty_count = sum(1 for r in rows if r["is_empty"])
    non_empty_words = [len(r["answer"].split()) for r in rows if not r["is_empty"]]

    in_f1 = sum(r["f1"] for r in in_scope) / max(1, len(in_scope))
    in_kp = sum(r["kp_recall"] for r in in_scope) / max(1, len(in_scope))
    oos_abstain = sum(1 for r in out_scope if (not r["is_empty"] and r["is_abstention"])) / max(1, len(out_scope))
    mean_ms = sum(r["latency_ms"] for r in rows) / n

    return {
        "condition": name,
        "questions": len(rows),
        "empty_eos_collapse_count": empty_count,
        "empty_eos_collapse_rate_pct": round(100.0 * empty_count / n, 1),
        "substantive_non_empty_count": len(rows) - empty_count,
        "mean_non_empty_words": round(sum(non_empty_words) / max(1, len(non_empty_words)), 1),
        "in_scope_mean_f1": round(in_f1, 4),
        "in_scope_key_point_recall_pct": round(100.0 * in_kp, 1),
        "out_of_scope_abstention_pct": round(100.0 * oos_abstain, 1),
        "mean_latency_ms": round(mean_ms, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate LFM3 Base vs T1 Old LoRA vs T2 Track C Packed LoRA on 50 held-out compliance questions.")
    parser.add_argument("--model", required=True, help="Local LFM3-1.7B-Base path or HF repo ID")
    parser.add_argument("--questions", type=Path, required=True, help="Path to eval_questions.jsonl")
    parser.add_argument("--old-adapter", type=Path, help="Optional T1 old flat-line LoRA adapter directory")
    parser.add_argument("--new-adapter", type=Path, required=True, help="T2 Track C Graph-Grounded Packed LoRA adapter directory")
    parser.add_argument("--rag-contexts", type=Path, help="Optional JSON mapping question id -> redacted Graph-PPR context string for T3")
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--limit", type=int, help="Optional question limit")
    parser.add_argument("--out", type=Path, required=True, help="Output JSON report path")
    args = parser.parse_args()

    questions = [json.loads(l) for l in args.questions.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        questions = questions[: args.limit]
    rag_map = json.loads(args.rag_contexts.read_text(encoding="utf-8")) if args.rag_contexts and args.rag_contexts.exists() else {}

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    dtype = torch.bfloat16 if (torch.cuda.is_available() and torch.cuda.is_bf16_supported()) else torch.float16
    base_model = AutoModelForCausalLM.from_pretrained(
        args.model,
        trust_remote_code=True,
        device_map="auto" if torch.cuda.is_available() else None,
        torch_dtype=dtype if torch.cuda.is_available() else torch.float32,
    )
    base_model.eval()

    def eval_model(model_obj, cond_name: str, use_rag: bool = False) -> tuple[dict, list[dict]]:
        rows = []
        for q in questions:
            ctx = rag_map.get(q["id"]) if use_rag else None
            ans, ms = generate_answer(model_obj, tokenizer, q["question"], args.max_new_tokens, context=ctx)
            empty = is_effectively_empty(ans)
            rows.append(
                {
                    "id": q["id"],
                    "question": q["question"],
                    "expected_out_of_scope": bool(q.get("expected_out_of_scope", False)),
                    "is_empty": empty,
                    "is_abstention": is_abstention(ans),
                    "f1": 0.0 if empty else round(compute_f1(ans, q.get("reference_answer", "")), 4),
                    "kp_recall": 0.0 if empty else round(key_point_recall(ans, q.get("key_points", [])), 4),
                    "latency_ms": ms,
                    "answer": ans,
                }
            )
        return score_condition(cond_name, rows), rows

    summaries = []
    details = {}

    # 1. Base closed-book
    s_base, d_base = eval_model(base_model, "LFM3_BASE_CLOSED_BOOK", use_rag=False)
    summaries.append(s_base)
    details["LFM3_BASE_CLOSED_BOOK"] = d_base

    # 2. T1 Old Safe LoRA closed-book (if provided)
    if args.old_adapter and args.old_adapter.is_dir():
        old_model = PeftModel.from_pretrained(base_model, str(args.old_adapter))
        old_model.eval()
        s_old, d_old = eval_model(old_model, "T1_OLD_FLAT_SAFE_LORA", use_rag=False)
        summaries.append(s_old)
        details["T1_OLD_FLAT_SAFE_LORA"] = d_old
        base_model = old_model.unload()

    # 3. T2 Track C Graph-Grounded Packed LoRA closed-book
    new_model = PeftModel.from_pretrained(base_model, str(args.new_adapter))
    new_model.eval()
    s_new, d_new = eval_model(new_model, "T2_TRACK_C_PACKED_LORA", use_rag=False)
    summaries.append(s_new)
    details["T2_TRACK_C_PACKED_LORA"] = d_new

    # 4. T3 Hybrid (T2 Track C Packed LoRA + Graph-PPR redacted context) if contexts provided
    if rag_map:
        s_t3, d_t3 = eval_model(new_model, "T3_TRACK_C_LORA_PLUS_GRAPH_PPR", use_rag=True)
        summaries.append(s_t3)
        details["T3_TRACK_C_LORA_PLUS_GRAPH_PPR"] = d_t3

        base_clean = new_model.unload()
        s_t0_ppr, d_t0_ppr = eval_model(base_clean, "T0_BASE_PLUS_GRAPH_PPR", use_rag=True)
        summaries.append(s_t0_ppr)
        details["T0_BASE_PLUS_GRAPH_PPR"] = d_t0_ppr

    peak_vram_gb = round(torch.cuda.max_memory_allocated() / (1024**3), 2) if torch.cuda.is_available() else 0.0
    report = {
        "model": args.model,
        "questions_count": len(questions),
        "peak_vram_gb": peak_vram_gb,
        "summaries": summaries,
        "sample_comparisons": [
            {
                "id": questions[i]["id"],
                "question": questions[i]["question"],
                "reference_answer": questions[i].get("reference_answer", ""),
                "answers": {k: details[k][i]["answer"] for k in details},
            }
            for i in range(min(5, len(questions)))
        ],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({**report, "details": details}, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
