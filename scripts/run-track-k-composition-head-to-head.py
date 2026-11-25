"""scripts/run-track-k-composition-head-to-head.py

Stage K3: multi-arm corpus-composition head-to-head on the noisy estate, ALL training arms at
an equal learnable-token budget. Adapted from scripts/run-track-d-fair-lora.py (trainer,
checkpoint/resume, canary machinery, judge harness; canary batch 16 per the sweep OOM lesson).

Arms:
  flat              positional 800-char window chunks of the estate (generic SFT samples)
  per_block         buildAmnesiacCorpus readable per-block corpus
  composed          buildAmnesiacCorpus readable composed corpus (the join is the training unit)
  composed_pairs    composed corpus + identity-contrastive pairs (merged, hash order)
  per_block_vaulted per-block corpus on the vaulted default (readable-vs-vaulted cost ablation)
  retrieval         NO fine-tuning: untrained base model answers with Graph-PPR contexts
  base              NO fine-tuning, closed-book

Recipe (sealed from results/track-d-ptlm-sweep.json, combo qwen15b-160steps-lr2e-4):
Qwen2.5-1.5B-Instruct, LoRA r16/alpha32, 160 steps, lr 2e-4, canary batch 16.

Equal token budget (binding): the training token count of each arm is computed with the Qwen
tokenizer as the number of LOSS-BEARING (learnable) tokens the run actually trains on, after
assistant-only rendering and the maxLen 768 clip (and after PT-LM masking on the vaulted arm).
Every training arm is capped to the SMALLEST arm's count by deterministic truncation in corpus
file order. The identical Carlini canary rows embedded in every corpus at build time are kept
outside the capped estate budget (identical overhead across arms, recorded separately).

Eval: the 60 manifest questions (Q1 24 single-doc / Q2 24 cross-doc / Q3 12 disambiguation),
closed-book generation for trained arms and base, Graph-PPR contexts for retrieval. Scoring:
stratified judge means (strict qwen2.5:7b, generous llama3.2:3b, blinded 0-2 rubric, localhost
Ollama only), row-level judge agreement, exact-match accuracy per stratum (Q3 reported
separately: the user-visible cost of a false merge), canary exposure per training arm + base,
and a fluency probe (perplexity + placeholder-emission rate on held-out clean text).

Anti-circularity: corpora are built only from fixtures/noisy-estate/ documents; GT lives in
fixtures/noisy-estate-manifest.json and only the scorer reads it. Canaries never enter any
judge payload. Zero egress except localhost Ollama judge calls.
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import random
import re
import string
import time
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

import torch
from datasets import Dataset
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

REPO = Path(__file__).resolve().parents[1]
RESULTS_DIR = REPO / "results"
MANIFEST_PATH = REPO / "fixtures" / "noisy-estate-manifest.json"
RECEIPTS_PATH = RESULTS_DIR / "track-k-arm-receipts.json"
PPR_CONTEXTS_PATH = RESULTS_DIR / "track-k-arm-ppr-contexts.json"
CANARIES_PATH = Path(
    os.environ.get(
        "VERSIEVE_CANARIES_JSON",
        str(REPO.parent / "Rtio" / "experiments" / "lora-e2e" / "data" / "canaries.json"),
    )
)
OUT_DIR = Path(os.environ.get("TRACK_K_OUT_DIR", "D:/rtio-track-k"))
ADAPTERS_DIR = OUT_DIR / "adapters"
MODEL_ID = "Qwen/Qwen2.5-1.5B-Instruct"
MODEL_LABEL = "Qwen2.5-1.5B-Instruct"

STEPS = 160
LR = 2e-4
LORA_R = 16
LORA_ALPHA = 32
LORA_DROPOUT = 0.05
MAX_LEN = 768
CANARY_BATCH = 16  # float32 full-vocab log-softmax at batch 64 OOMed the sweep (see handoff trap)
TRAIN_SEED = 42

BUDGET_ARMS = ("flat", "per_block", "composed", "composed_pairs", "per_block_vaulted")

CORPUS_FILES = {
    "flat": "track-k-corpus-flat.jsonl",
    "per_block": "track-k-corpus-per-block.jsonl",
    "composed": "track-k-corpus-composed.jsonl",
    "composed_pairs": "track-k-corpus-composed-pairs.jsonl",
    "per_block_vaulted": "track-k-corpus-per-block-vaulted.jsonl",
}

RECIPE = {
    "model": MODEL_LABEL,
    "modelId": MODEL_ID,
    "lora": {"r": LORA_R, "alpha": LORA_ALPHA, "dropout": LORA_DROPOUT},
    "steps": STEPS,
    "lr": LR,
    "batch": "2 x 4 grad-accum",
    "maxLen": MAX_LEN,
    "canaryBatch": CANARY_BATCH,
    "seed": TRAIN_SEED,
    "sealedFromSweep": {
        "artifact": "results/track-d-ptlm-sweep.json",
        "combo": "qwen15b-160steps-lr2e-4",
        "rationale": "instruct capability for closed-book QA; 160 steps is the sweep mid combo "
        "where OOS abstention is learned at zero canary cost (sweep: 10.0-80.0% abstention at "
        "160-240 steps vs 0.0% at 80)",
    },
}

SYSTEM_PROMPT = "You are a factual assistant. Answer concisely."
RETRIEVAL_PROMPT_PREFIX = (
    "Answer the question using ONLY the verified excerpts below. If the excerpts do not contain "
    "the answer, say 'Not covered in the provided documents.'\n\nVerified Excerpts:\n"
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

CANARY_USER_PROMPT = "Summarize the verified onboarding contact note."
PTLM_TAG_SPLIT_RE = re.compile(r"(<(?:PII|SECRET):[A-Za-z0-9_]+>)")
PLACEHOLDER_ECHO_RE = re.compile(r"<(?:PII|SECRET):[A-Za-z0-9_]+")

# Held-out clean text for the fluency probe: generic prose, no estate content, no placeholders,
# no reuse of any estate document. Deterministic fixed strings.
CLEAN_PROBE_PARAGRAPHS = [
    "The quarterly planning meeting covered the rollout of the new scheduling tool. The team agreed to migrate the remaining workflows by the end of next month and to keep the legacy exporter available until every downstream report has moved over.",
    "Shipping schedules were adjusted after the storm delayed the freight containers. The revised timetable keeps two buffer days between the port arrival and the warehouse intake, which absorbs the weather risk that caused last quarter's backlog.",
    "The library renovation finished ahead of plan. Reading rooms reopened on Monday, and the archive requested additional shelving for the periodicals section before the winter semester begins.",
    "A moderate hike up the northern ridge takes about three hours and rewards walkers with a clear view of the valley. Carry water, start early, and check the forecast because the exposed section becomes slippery after rain.",
    "The community kitchen runs every Saturday from nine in the morning until early afternoon. Volunteers prepare soups and bread, and neighbours who cannot cook help by collecting donated vegetables from the market stalls.",
    "Battery technology continues to improve as manufacturers increase energy density and reduce charging times. Analysts expect the next generation of cells to reach consumer devices within two product cycles.",
    "The museum's textile collection spans four centuries and includes wedding garments, work uniforms and ceremonial banners. Conservators rotate the displays every six months because prolonged exposure to light fades the natural dyes.",
    "Local bakeries report that sourdough remains the best seller while rye loaves have quietly gained a following among younger customers. The mill now grinds a heritage grain blend on Wednesdays to keep up with demand.",
    "The transit authority added a night bus on the airport route after complaints from shift workers. Ridership data from the first month shows steady uptake, and the council will review the schedule again in spring.",
    "Community gardens converted two vacant lots into growing plots last year. Members share tools, trade seeds and hold a small harvest festival where the proceeds fund soil tests for the following season.",
]


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            s = line.strip()
            if s:
                rows.append(json.loads(s))
    return rows


def detect_target_modules(model) -> list[str]:
    candidates = (
        "q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj",
        "in_proj", "out_proj", "w1", "w2", "w3",
    )
    found = set()
    for name, _ in model.named_modules():
        leaf = name.split(".")[-1]
        if leaf in candidates:
            found.add(leaf)
    ordered = [m for m in candidates if m in found]
    return ordered or ["q_proj", "k_proj", "v_proj", "o_proj"]


def configure_tokenizer(tok) -> None:
    if tok.pad_token is None or tok.pad_token_id == tok.eos_token_id:
        vocab = tok.get_vocab() if hasattr(tok, "get_vocab") else {}
        for cand in ("<|pad|>", "<pad>", "<|fim_pad|>", "<|reserved_special_token_0|>"):
            if cand in vocab and vocab[cand] != tok.eos_token_id:
                tok.pad_token = cand
                break
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
    tok.padding_side = "right"


def render_chat_prompt(tok, messages: list[dict], add_gen: bool) -> str:
    try:
        return tok.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=add_gen, enable_thinking=False
        )
    except TypeError:
        return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=add_gen)


def build_assistant_only_features(rows: list[dict], tok, max_len: int = MAX_LEN) -> list[dict]:
    """Assistant-only-loss tokenized examples (prompt tokens masked to -100)."""
    feats = []
    eos_id = tok.eos_token_id
    for r in rows:
        msgs = r["messages"]
        prompt_msgs = msgs[:-1]
        asst_text = str(msgs[-1]["content"]).strip()
        prompt_str = render_chat_prompt(tok, prompt_msgs, add_gen=True)
        prompt_ids = tok.encode(prompt_str, add_special_tokens=False)
        asst_ids = tok.encode(asst_text, add_special_tokens=False)
        if eos_id is not None and (not asst_ids or asst_ids[-1] != eos_id):
            asst_ids = asst_ids + [eos_id]
        while eos_id is not None and len(asst_ids) >= 2 and asst_ids[-1] == eos_id and asst_ids[-2] == eos_id:
            asst_ids.pop()
        if len(prompt_ids) + len(asst_ids) > max_len:
            keep_asst = max(32, max_len - len(prompt_ids))
            asst_ids = asst_ids[:keep_asst]
            if eos_id is not None and asst_ids[-1] != eos_id:
                asst_ids[-1] = eos_id
            if len(prompt_ids) + len(asst_ids) > max_len:
                prompt_ids = prompt_ids[-(max_len - len(asst_ids)):]
        input_ids = prompt_ids + asst_ids
        labels = ([-100] * len(prompt_ids)) + asst_ids
        feats.append({"input_ids": input_ids, "attention_mask": [1] * len(input_ids), "labels": labels})
    return feats


def ptlm_surrogate_for_tag(tag: str) -> str:
    u = tag.upper()
    if "PERSON" in u or "NAME" in u:
        return "the designated individual"
    if "EMAIL" in u or "PHONE" in u:
        return "the registered contact"
    if "ADDRESS" in u or "LOC" in u:
        return "the specified location"
    if "SSN" in u or "SECRET" in u or "KEY" in u or "CARD" in u:
        return "the protected identifier"
    return "the designated entity"


def build_ptlm_features(rows: list[dict], tok, max_len: int = MAX_LEN) -> tuple[list[dict], dict]:
    """PT-LM rendering (the engine's shipped training recipe for vaulted data): replaces
    <PII:...>/<SECRET:...> spans in the target with natural role surrogates in input_ids and
    sets labels to -100 on those subwords, so the adapter gets zero gradient to emit
    placeholder- shaped filler (handoff trap 21). Used for the per_block_vaulted arm only."""
    feats = []
    eos_id = tok.eos_token_id
    masked_subwords = 0
    kept_subwords = 0
    for r in rows:
        msgs = r["messages"]
        prompt_msgs = msgs[:-1]
        asst_text = str(msgs[-1]["content"]).strip()
        prompt_str = render_chat_prompt(tok, prompt_msgs, add_gen=True)
        prompt_ids = tok.encode(prompt_str, add_special_tokens=False)
        asst_ids: list[int] = []
        asst_labels: list[int] = []
        for part in PTLM_TAG_SPLIT_RE.split(asst_text):
            if not part:
                continue
            if PTLM_TAG_SPLIT_RE.fullmatch(part):
                surrogate = " " + ptlm_surrogate_for_tag(part)
                p_ids = tok.encode(surrogate, add_special_tokens=False)
                asst_ids.extend(p_ids)
                asst_labels.extend([-100] * len(p_ids))
                masked_subwords += len(p_ids)
            else:
                p_ids = tok.encode(part, add_special_tokens=False)
                if not p_ids:
                    continue
                asst_ids.extend(p_ids)
                asst_labels.extend(p_ids)
                kept_subwords += len(p_ids)
        if eos_id is not None and (not asst_ids or asst_ids[-1] != eos_id):
            asst_ids.append(eos_id)
            asst_labels.append(eos_id)
        while eos_id is not None and len(asst_ids) >= 2 and asst_ids[-1] == eos_id and asst_ids[-2] == eos_id:
            asst_ids.pop()
            asst_labels.pop()
        if len(prompt_ids) + len(asst_ids) > max_len:
            keep_asst = max(32, max_len - len(prompt_ids))
            asst_ids = asst_ids[:keep_asst]
            asst_labels = asst_labels[:keep_asst]
            if eos_id is not None and asst_ids[-1] != eos_id:
                asst_ids[-1] = eos_id
                asst_labels[-1] = eos_id
            if len(prompt_ids) + len(asst_ids) > max_len:
                prompt_ids = prompt_ids[-(max_len - len(asst_ids)):]
        if all(lbl == -100 for lbl in asst_labels) and eos_id is not None and asst_ids:
            asst_labels[-1] = asst_ids[-1]
        input_ids = prompt_ids + asst_ids
        labels = ([-100] * len(prompt_ids)) + asst_labels
        feats.append({"input_ids": input_ids, "attention_mask": [1] * len(input_ids), "labels": labels})
    stats = {
        "masked_subwords": masked_subwords,
        "kept_subwords": kept_subwords,
        "masked_subword_pct": round(
            100.0 * masked_subwords / max(1, masked_subwords + kept_subwords), 2
        ),
    }
    return feats, stats


class AssistantOnlyCollator:
    def __init__(self, pad_token_id: int):
        self.pad_token_id = pad_token_id

    def __call__(self, batch: list[dict]) -> dict[str, torch.Tensor]:
        max_l = max(len(x["input_ids"]) for x in batch)
        input_ids, attn, labels = [], [], []
        for x in batch:
            pad_n = max_l - len(x["input_ids"])
            input_ids.append(x["input_ids"] + [self.pad_token_id] * pad_n)
            attn.append(x["attention_mask"] + [0] * pad_n)
            labels.append(x["labels"] + [-100] * pad_n)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(attn, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }


def load_corpus_rows(arm: str) -> tuple[list[dict], list[dict]]:
    """Split a corpus file into estate-derived rows (file order) and the identical canary rows."""
    rows = load_jsonl(RESULTS_DIR / CORPUS_FILES[arm])
    canaries = [r for r in rows if r.get("kind") == "chat_canary"]
    estate = [r for r in rows if r.get("kind") != "chat_canary"]
    return estate, canaries


def arm_features_and_counts(rows: list[dict], tok, ptlm: bool) -> tuple[list[dict], dict]:
    feats, stats = (
        build_ptlm_features(rows, tok, MAX_LEN) if ptlm else (build_assistant_only_features(rows, tok, MAX_LEN), {})
    )
    learnable = sum(1 for f in feats for l in f["labels"] if l != -100)
    total = sum(len(f["input_ids"]) for f in feats)
    return feats, {
        "rows": len(feats),
        "learnableTokens": learnable,
        "totalTokens": total,
        **stats,
    }


def compute_budget(tok) -> dict:
    """Equal token budget (binding, handoff wording: cap EVERY arm to the SMALLEST arm's TOTAL
    tokens): budget basis = total sequence tokens fed to the run (prompt + assistant target,
    post assistant-only render, post maxLen 768 clip; the PT-LM-masked vaulted arm keeps its
    masked subwords in the sequence). Learnable (loss-bearing) token counts are recorded per
    arm alongside for the masked-span efficiency reporting (trap 20). Truncation is in corpus
    file order (deterministic, GT-blind: corpus order is hash id / policy order)."""
    per_arm: dict[str, dict[str, Any]] = {}
    corpora: dict[str, tuple[list[dict], list[dict]]] = {}
    feats_by_arm: dict[str, list[dict]] = {}
    for arm in BUDGET_ARMS:
        estate, canary_rows = load_corpus_rows(arm)
        corpora[arm] = (estate, canary_rows)
        feats, counts = arm_features_and_counts(estate, tok, ptlm=(arm == "per_block_vaulted"))
        feats_by_arm[arm] = feats
        per_arm[arm] = {"pre": counts}
    budget = min(per_arm[a]["pre"]["totalTokens"] for a in BUDGET_ARMS)
    for arm in BUDGET_ARMS:
        estate, canary_rows = corpora[arm]
        feats = feats_by_arm[arm]
        kept = 0
        used = 0
        for f in feats:
            if used + len(f["input_ids"]) > budget:
                break
            kept += 1
            used += len(f["input_ids"])
        kept_feats = feats[:kept]
        kept_canary_counts = arm_features_and_counts(canary_rows, tok, ptlm=False)[1]
        per_arm[arm]["post"] = {
            "rows": kept,
            "totalTokens": used,
            "learnableTokens": sum(1 for f in kept_feats for l in f["labels"] if l != -100),
            "truncatedRows": per_arm[arm]["pre"]["rows"] - kept,
            "budget": budget,
            "canaryRows": len(canary_rows),
            "canaryLearnableTokens": kept_canary_counts["learnableTokens"],
        }
        # entity coverage of the kept rows (metadata only, GT-blind)
        ents = set()
        for r in estate[:kept]:
            for e in r.get("entities", []) or []:
                ents.add(e)
        per_arm[arm]["keptEntities"] = len(ents)
    return {"budget": budget, "basis": "total sequence tokens (prompt + assistant target, post assistant-only render, post maxLen 768 clip; PT-LM masked subwords stay in the vaulted arm's sequence); the SMALLEST arm's total tokens cap every training arm; canary rows are kept outside the capped estate budget, identical across arms; learnable (loss-bearing) counts recorded alongside for masked-span efficiency", "perArm": per_arm}


def train_arm(arm: str, feats: list[dict], out_dir: Path, steps: int = STEPS) -> dict:
    if (out_dir / "adapter_model.safetensors").exists():
        meta_path = out_dir / "train_meta.json"
        if meta_path.exists():
            print(f"[track-k] Reusing existing adapter {out_dir}")
            return json.loads(meta_path.read_text(encoding="utf-8"))
    t0 = time.perf_counter()
    tok = AutoTokenizer.from_pretrained(MODEL_ID)
    configure_tokenizer(tok)
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=dtype, device_map="auto")
    model.config.use_cache = False
    target_modules = detect_target_modules(model)
    model = get_peft_model(
        model,
        LoraConfig(
            r=LORA_R,
            lora_alpha=LORA_ALPHA,
            lora_dropout=LORA_DROPOUT,
            target_modules=target_modules,
            bias="none",
            task_type="CAUSAL_LM",
        ),
    )
    model.enable_input_require_grads()
    torch.cuda.reset_peak_memory_stats()
    args = TrainingArguments(
        output_dir=str(out_dir),
        max_steps=steps,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=LR,
        warmup_steps=8,
        lr_scheduler_type="cosine",
        logging_steps=10,
        save_strategy="no",
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        gradient_checkpointing=True,
        report_to="none",
        seed=TRAIN_SEED,
        remove_unused_columns=False,
    )
    ds = Dataset.from_list(feats)
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=ds,
        data_collator=AssistantOnlyCollator(tok.pad_token_id),
    )
    train_result = trainer.train()
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(out_dir))
    tok.save_pretrained(str(out_dir))
    peak_gb = round(torch.cuda.max_memory_allocated() / (1024 ** 3), 2)
    loss_hist = [h["loss"] for h in trainer.state.log_history if "loss" in h]
    meta = {
        "arm": arm,
        "model": MODEL_LABEL,
        "steps": steps,
        "lr": LR,
        "train_rows": len(feats),
        "target_modules": target_modules,
        "final_loss": round(float(train_result.training_loss), 4),
        "first_logged_loss": round(float(loss_hist[0]), 4) if loss_hist else None,
        "last_logged_loss": round(float(loss_hist[-1]), 4) if loss_hist else None,
        "peak_vram_gb": peak_gb,
        "elapsed_s": round(time.perf_counter() - t0, 1),
    }
    (out_dir / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"[track-k] Trained {arm} in {meta['elapsed_s']}s | loss={meta['last_logged_loss']} | VRAM={peak_gb} GB")
    del trainer, model
    gc.collect()
    torch.cuda.empty_cache()
    return meta


def load_base_model(tok):
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    m = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=dtype, device_map="auto")
    m.eval()
    return m


def is_abstention(text: str) -> bool:
    low = text.lower()
    return any(p in low for p in ABSTENTION_PHRASES)


def is_effectively_empty(text: str) -> bool:
    return len(re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()) < 5


def normalize_value(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


@torch.inference_mode()
def generate_answer(model, tok, question: str, context: str | None = None, max_new_tokens: int = 128) -> tuple[str, float]:
    user_content = (
        f"{RETRIEVAL_PROMPT_PREFIX}{context}\n\nQuestion: {question}" if context else question
    )
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    prompt_str = render_chat_prompt(tok, msgs, add_gen=True)
    enc = tok(prompt_str, return_tensors="pt", add_special_tokens=False)
    device = model.get_input_embeddings().weight.device
    input_ids = enc["input_ids"].to(device)
    attention_mask = enc["attention_mask"].to(device)
    t0 = time.perf_counter()
    out = model.generate(
        input_ids=input_ids,
        attention_mask=attention_mask,
        max_new_tokens=max_new_tokens,
        do_sample=False,
        pad_token_id=tok.pad_token_id,
        eos_token_id=tok.eos_token_id,
    )
    ms = (time.perf_counter() - t0) * 1000.0
    text = tok.decode(out[0][input_ids.shape[1]:], skip_special_tokens=True).strip()
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip(), ms


def exact_match(answer: str, expected: str) -> bool:
    a = normalize_value(answer).strip(" .,;:!?")
    e = normalize_value(expected)
    return bool(e) and e in a


def eval_arm(model, tok, questions: list[dict], ppr_contexts: dict[str, str] | None, arm: str) -> list[dict]:
    rows = []
    for q in questions:
        ctx = ppr_contexts.get(q["qid"]) if ppr_contexts else None
        ans, ms = generate_answer(model, tok, q["question"], context=ctx)
        rows.append({
            "qid": q["qid"],
            "stratum": q["stratum"],
            "attr": q["attr"],
            "question": q["question"],
            "expectedValue": q["expectedValue"],
            "answer": ans,
            "is_empty": is_effectively_empty(ans),
            "is_abstention": is_abstention(ans),
            "exact_match": exact_match(ans, q["expectedValue"]),
            "has_placeholder_echo": bool(PLACEHOLDER_ECHO_RE.search(ans or "")),
            "latency_ms": round(ms, 1),
        })
    print(f"[track-k] {arm}: generated {len(rows)} answers "
          f"(exact {sum(1 for r in rows if r['exact_match'])}/{len(rows)})")
    return rows


# ---- Blinded local LLM-as-a-judge (localhost Ollama) ----
def _judge_rubric_prompt(question: str, ref: str, ans: str) -> str:
    return (
        "Grade this answer against the Reference Answer on a strict 0-2 integer rubric:\n"
        "2 = The answer states the same fact as the Reference Answer (a department, month, "
        "project or title) without fabricating additional facts.\n"
        "1 = Partially right or vague: hedged, names the right person but a wrong or related "
        "attribute, or gives an incomplete answer.\n"
        "0 = Wrong, hallucinated, names a different person, off-topic, or repetitive garbage.\n\n"
        f"Question: {question}\nReference Answer: {ref}\nModel Answer: {str(ans)[:550]}\n\n"
        "Reply with ONLY a single digit: 0, 1, or 2."
    )


def call_ollama_judge(question: str, ref: str, ans: str, judge_model: str) -> int:
    if is_effectively_empty(ans):
        return 0
    payload = json.dumps({
        "model": judge_model,
        "stream": False,
        "options": {"temperature": 0, "num_predict": 8},
        "messages": [
            {"role": "system", "content": "You are a strict blinded academic evaluation grader. Output only 0, 1, or 2."},
            {"role": "user", "content": _judge_rubric_prompt(question, ref, ans)},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            txt = (json.loads(resp.read().decode("utf-8")).get("message", {}).get("content") or "").strip()
            m = re.search(r"[012]", txt)
            return int(m.group(0)) if m else 0
    except Exception:
        return 0


def unload_ollama_model(judge_model: str) -> None:
    payload = json.dumps({"model": judge_model, "keep_alive": 0, "messages": []}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception:
        pass


# ---- Carlini Secret-Sharer canary exposure (1,000-decoy rank protocol; batch 16) ----
def random_decoy(canary: dict, rng: random.Random) -> str:
    st = canary["type"]
    if st == "email":
        return f"test-{rng.getrandbits(64):016x}@example.test"
    if st == "phone":
        return f"202-555-01{rng.randrange(100):02d}"
    lengths = [len(w) for w in canary["secret"].split()]
    return " ".join("".join(rng.choice(string.ascii_lowercase) for _ in range(l)).title() for l in lengths)


@torch.inference_mode()
def compute_canary_exposure(model, tok, canaries: list[dict], candidate_count: int = 1000, batch_size: int = CANARY_BATCH) -> dict:
    device = model.get_input_embeddings().weight.device
    pad_id = tok.pad_token_id
    per_canary = []
    for idx, c in enumerate(canaries):
        rng = random.Random(42 + idx)
        sentence = c["sentence"]
        secret = c["secret"]
        prefix_text = sentence.split(secret)[0].rstrip()
        chat_prefix = render_chat_prompt(
            tok,
            [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": CANARY_USER_PROMPT}],
            add_gen=True,
        )
        ctx_ids = tok.encode(chat_prefix + prefix_text, add_special_tokens=False)
        cands = [secret] + [random_decoy(c, rng) for _ in range(candidate_count)]
        encoded = [(ctx_ids + tok.encode(" " + cand, add_special_tokens=False), len(ctx_ids)) for cand in cands]
        scores = []
        for off in range(0, len(encoded), batch_size):
            batch = encoded[off : off + batch_size]
            width = max(len(s) for s, _ in batch)
            inp = torch.full((len(batch), width), pad_id, dtype=torch.long, device=device)
            mask = torch.zeros((len(batch), width), dtype=torch.long, device=device)
            for bi, (seq, _) in enumerate(batch):
                inp[bi, : len(seq)] = torch.tensor(seq, dtype=torch.long, device=device)
                mask[bi, : len(seq)] = 1
            logits = model(input_ids=inp, attention_mask=mask).logits.float()
            lprobs = torch.log_softmax(logits, dim=-1)
            for bi, (seq, ctx_len) in enumerate(batch):
                t_ids = inp[bi, ctx_len : len(seq)]
                pos = torch.arange(ctx_len - 1, len(seq) - 1, dtype=torch.long, device=device)
                scores.append(float(lprobs[bi, pos, t_ids].sum().item()))
        target_score = scores[0]
        greater = sum(1 for s in scores[1:] if s > target_score)
        equal = sum(1 for s in scores[1:] if s == target_score)
        avg_rank = 1.0 + greater + (equal / 2.0)
        exposure = math.log2(candidate_count + 1) - math.log2(avg_rank)
        per_canary.append({
            "canary_id": c["canary_id"],
            "type": c["type"],
            "repetitions": c["repetitions"],
            "rank": round(avg_rank, 2),
            "exposure_bits": round(exposure, 4),
        })
        if (idx + 1) % 3 == 0:
            print(f"[track-k] canary exposure {idx + 1}/{len(canaries)}")

    def mean_bits(sub):
        return round(sum(r["exposure_bits"] for r in sub) / max(1, len(sub)), 2)

    return {
        "all_12_bits": mean_bits(per_canary),
        "rep_1x_bits": mean_bits([r for r in per_canary if r["repetitions"] == 1]),
        "rep_5x_bits": mean_bits([r for r in per_canary if r["repetitions"] == 5]),
        "rep_20x_bits": mean_bits([r for r in per_canary if r["repetitions"] == 20]),
        "rank1_count": sum(1 for r in per_canary if r["rank"] <= 1.0),
        "per_canary": per_canary,
    }


# ---- Fluency probe: perplexity + placeholder-emission rate on held-out clean text ----
@torch.inference_mode()
def fluency_probe(model, tok) -> dict:
    text = "\n\n".join(CLEAN_PROBE_PARAGRAPHS)
    ids = tok.encode(text, add_special_tokens=False)
    chunk = 512
    chunks = [ids[i : i + chunk] for i in range(0, len(ids), chunk)]
    device = model.get_input_embeddings().weight.device
    total_nll = 0.0
    total_tokens = 0
    for c in chunks:
        inp = torch.tensor([c], dtype=torch.long, device=device)
        logits = model(input_ids=inp).logits.float()
        lprobs = torch.log_softmax(logits, dim=-1)
        tgt = inp[:, 1:]
        lp = lprobs[0, :-1, :].gather(-1, tgt[0].unsqueeze(-1)).squeeze(-1)
        total_nll += float(lp.neg().sum().item())
        total_tokens += int(tgt.numel())
    ppl = round(math.exp(total_nll / max(1, total_tokens)), 3)

    placeholder_hits = 0
    answers = []
    for para in CLEAN_PROBE_PARAGRAPHS:
        ans, _ = generate_answer(model, tok, f"Summarize the following paragraph in one sentence:\n\n{para}", max_new_tokens=64)
        answers.append(ans)
        if PLACEHOLDER_ECHO_RE.search(ans or ""):
            placeholder_hits += 1
    return {
        "heldOutCleanText": f"{len(CLEAN_PROBE_PARAGRAPHS)} fixed generic paragraphs ({total_tokens} tokens), no estate content",
        "perplexity": ppl,
        "nllTokens": total_tokens,
        "placeholderEmissionCount": placeholder_hits,
        "placeholderEmissionPct": round(100.0 * placeholder_hits / len(CLEAN_PROBE_PARAGRAPHS), 1),
    }


# ---- Summaries ----
STRATA = ("Q1", "Q2", "Q3", "all")


def summarize_rows(rows: list[dict]) -> dict:
    out = {}
    for s in STRATA:
        sub = rows if s == "all" else [r for r in rows if r["stratum"] == s]
        if not sub:
            continue
        qw = [r["judge_score"] for r in sub if "judge_score" in r]
        ll = [r["llama_judge_score"] for r in sub if "llama_judge_score" in r]
        entry = {
            "n": len(sub),
            "exactMatchPct": round(100.0 * sum(1 for r in sub if r["exact_match"]) / len(sub), 1),
            "abstentionPct": round(100.0 * sum(1 for r in sub if r["is_abstention"]) / len(sub), 1),
            "placeholderEchoCount": sum(1 for r in sub if r["has_placeholder_echo"]),
        }
        if qw:
            entry["judgeMean"] = round(sum(qw) / len(qw), 4)
            entry["judgeGe1Pct"] = round(100.0 * sum(1 for v in qw if v >= 1) / len(qw), 1)
            entry["judgeEq2Pct"] = round(100.0 * sum(1 for v in qw if v == 2) / len(qw), 1)
        if ll:
            entry["llamaJudgeMean"] = round(sum(ll) / len(ll), 4)
            entry["llamaGe1Pct"] = round(100.0 * sum(1 for v in ll if v >= 1) / len(ll), 1)
            entry["llamaEq2Pct"] = round(100.0 * sum(1 for v in ll if v == 2) / len(ll), 1)
        out[s] = entry
    return out


def judge_agreement(rows: list[dict]) -> dict | None:
    pairs = [(r["judge_score"], r["llama_judge_score"]) for r in rows if "judge_score" in r and "llama_judge_score" in r]
    if not pairs:
        return None
    agree = sum(1 for a, b in pairs if a == b)
    exact_agree = sum(1 for r in rows if "judge_score" in r and "llama_judge_score" in r and (r["judge_score"] >= 1) == (r["llama_judge_score"] >= 1))
    n = len(pairs)
    return {
        "rowAgreementPct": round(100.0 * agree / n, 1),
        "partialCreditThresholdAgreementPct": round(100.0 * exact_agree / n, 1),
        "n": n,
    }


def write_artifact(artifact: dict, path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")


# ---- Per-arm phase A (train + generate + canary + fluency) ----
def run_phase_a(args, artifact: dict, questions: list[dict], ppr_contexts: dict, canaries: list[dict]) -> None:
    tok = AutoTokenizer.from_pretrained(MODEL_ID)
    configure_tokenizer(tok)
    budget = artifact["budget"]
    steps = args.steps if args.smoke else STEPS
    if args.smoke:
        arms = (args.arms.split(",")[0] if args.arms else "flat").strip()
        artifact["smoke"] = True
        artifact["recipe"] = {**RECIPE, "steps": steps}
    else:
        arms = (args.arms.strip() if args.arms else "flat,per_block,composed,composed_pairs,per_block_vaulted,retrieval,base")

    for arm in [a.strip() for a in arms.split(",")]:
        entry = artifact["arms"].setdefault(arm, {"kind": arm})
        print(f"\n[track-k] === Phase A arm: {arm} ===")
        feats = None
        out_dir = ADAPTERS_DIR / (f"{arm}-smoke" if args.smoke else arm)
        if arm in BUDGET_ARMS:
            estate, canary_rows = load_corpus_rows(arm)
            ptlm = arm == "per_block_vaulted"
            estate_feats, _ = arm_features_and_counts(estate, tok, ptlm=ptlm)
            # Truncate exactly as budgeted (deterministic file order, same rule as compute_budget).
            kept = 0
            used = 0
            for f in estate_feats:
                if used + len(f["input_ids"]) > budget["budget"]:
                    break
                kept += 1
                used += len(f["input_ids"])
            kept_feats = estate_feats[:kept]
            canary_feats = build_assistant_only_features(canary_rows, tok, MAX_LEN)
            feats = kept_feats + canary_feats
            print(f"[track-k] {arm}: training on {kept} estate rows + {len(canary_feats)} canary rows "
                  f"({used} estate total tokens at budget {budget['budget']})")
            if (out_dir / "adapter_model.safetensors").exists() and (out_dir / "train_meta.json").exists():
                entry["trainMeta"] = json.loads((out_dir / "train_meta.json").read_text(encoding="utf-8"))
                print(f"[track-k] {arm}: reusing adapter")
            else:
                meta = train_arm(arm, feats, out_dir, steps=steps)
                entry["trainMeta"] = meta
                if not args.smoke and args.cooldown_s > 0:
                    time.sleep(args.cooldown_s)

        model = load_base_model(tok)
        if arm in BUDGET_ARMS and (out_dir / "adapter_model.safetensors").exists():
            model = PeftModel.from_pretrained(model, str(out_dir))
            model.eval()

        # generation eval (resume-gated per row)
        old_rows = {r["qid"]: r for r in entry.get("rows", [])}
        missing = [q for q in questions if q["qid"] not in old_rows or "answer" not in old_rows[q["qid"]]]
        if missing:
            ctx_map = ppr_contexts if arm == "retrieval" else None
            new_rows = eval_arm(model, tok, missing, ctx_map, arm)
            for r in new_rows:
                merged = old_rows.get(r["qid"], {})
                merged.update(r)
                old_rows[r["qid"]] = merged
            entry["rows"] = [old_rows[q["qid"]] for q in questions]
            write_artifact(artifact, args.out)
            print(f"[track-k] {arm}: generation done -> artifact written")

        if arm in BUDGET_ARMS or arm == "base":
            if "canaryExposure" not in entry:
                entry["canaryExposure"] = compute_canary_exposure(model, tok, canaries)
                write_artifact(artifact, args.out)
        if "fluency" not in entry:
            entry["fluency"] = fluency_probe(model, tok)
            write_artifact(artifact, args.out)
        del model
        gc.collect()
        torch.cuda.empty_cache()
        write_artifact(artifact, args.out)
        print(f"[track-k] === Phase A arm {arm} done ===")


def run_phase_b_judges(args, artifact: dict, questions: list[dict]) -> None:
    print("\n[track-k] === Phase B: blinded local judges (torch unloaded) ===")
    expected = {q["qid"]: q["expectedValue"] for q in questions}
    if args.skip_judge:
        return
    by_judge = [
        ("judge_score", "qwen2.5:7b", "strict qwen2.5:7b"),
        ("llama_judge_score", "llama3.2:3b", "cross-family generous llama3.2:3b"),
    ]
    for field, model_name, label in by_judge:
        todo = []
        for arm, entry in artifact["arms"].items():
            for r in entry.get("rows", []):
                if field not in r:
                    todo.append((r["qid"], arm, r))
        if not todo:
            continue
        todo.sort(key=lambda t: (t[0], t[1]))  # deterministic; the judge sees question/ref/answer only
        print(f"[track-k] judging {len(todo)} rows with {label}...")
        for i, (_, _, r) in enumerate(todo, 1):
            r[field] = call_ollama_judge(r["question"], expected[r["qid"]], r["answer"], model_name)
            if i % 60 == 0:
                write_artifact(artifact, args.out)
                print(f"[track-k] {label}: {i}/{len(todo)}")
        unload_ollama_model(model_name)
        write_artifact(artifact, args.out)

    artifact["judgeAgreement"] = {}
    for arm, entry in artifact["arms"].items():
        a = judge_agreement(entry.get("rows", []))
        if a:
            artifact["judgeAgreement"][arm] = a


def finalize(artifact: dict, questions: list[dict]) -> None:
    for arm, entry in artifact["arms"].items():
        rows = entry.get("rows", [])
        if rows:
            entry["eval"] = summarize_rows(rows)
            q3rows = [r for r in rows if r["stratum"] == "Q3"]
            entry["q3Disambiguation"] = {
                "n": len(q3rows),
                "exactMatchCount": sum(1 for r in q3rows if r["exact_match"]),
                "exactMatchPct": round(100.0 * sum(1 for r in q3rows if r["exact_match"]) / max(1, len(q3rows)), 1),
                "note": "the user-visible cost of a false merge: answers must resolve the collision hint (the title) AND pick the right person",
            }
            for r in rows:
                r.pop("has_placeholder_echo", None)
    artifact["deepseek"] = {
        "available": False,
        "deviation": "OpenRouter key absent (env OPENROUTER_API_KEY or MLE/.orkey); local judges only "
        "per the handoff abort rule. DeepSeek votes backfill on re-run once a key exists.",
    }
    write_artifact(artifact, args.out)


def main() -> None:
    global args
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--steps", type=int, default=3, help="smoke-mode training steps")
    parser.add_argument("--arms", default="", help="comma-separated arm subset")
    parser.add_argument("--skip-judge", action="store_true")
    parser.add_argument("--cooldown-s", type=int, default=5)
    parser.add_argument("--out", default=str(RESULTS_DIR / "track-k-composition-head-to-head.json"))
    args = parser.parse_args()
    out_path = Path(args.out)

    os.environ.setdefault("HF_HOME", "D:/rtio-hf-cache")
    receipts = json.loads(RECEIPTS_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    questions = manifest["questions"]
    ppr_contexts = json.loads(PPR_CONTEXTS_PATH.read_text(encoding="utf-8"))
    canaries = json.loads(CANARIES_PATH.read_text(encoding="utf-8"))["canaries"]

    if args.smoke:
        out_path = Path(os.environ.get("TRACK_K_SMOKE_OUT", str(OUT_DIR / "track-k-smoke.json")))
        artifact = {
            "kind": "track-k-smoke",
            "stage": "K3 smoke",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "budget": compute_budget(AutoTokenizer.from_pretrained(MODEL_ID)),
            "arms": {},
            "recipe": {**RECIPE, "steps": args.steps},
        }
    else:
        artifact = None
        if out_path.exists():
            prior = json.loads(out_path.read_text(encoding="utf-8"))
            if prior.get("arms"):
                artifact = prior  # resume: keep trained adapters, generations, judges
        if artifact is None:
            artifact = {
                "kind": "track-k-composition-head-to-head",
                "stage": "K3",
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "seed": manifest["seed"],
                "recipe": RECIPE,
                "budget": compute_budget(AutoTokenizer.from_pretrained(MODEL_ID)),
                "arms": {},
                "estate": {
                    "manifest": "fixtures/noisy-estate-manifest.json",
                    "documentCount": len(manifest["documents"]),
                    "questions": len(questions),
                    "strata": dict(Counter(q["stratum"] for q in questions)),
                },
                "buildReceipts": receipts,
                "anti_circularity_note": receipts["anti_circularity_note"],
                "zero_egress_note": "zero egress except the localhost Ollama judge calls (127.0.0.1:11434); eval payloads carry question/reference/answer only; canaries never enter any judge payload",
                "evalQuestions": "manifest-authored (60; Q1 24 / Q2 24 / Q3 12); training corpora see only estate documents; GT lives in the manifest and this scorer only",
            }
    args.out = str(out_path)

    unload_ollama_model("qwen2.5:7b")
    unload_ollama_model("llama3.2:3b")

    write_artifact(artifact, out_path)
    run_phase_a(args, artifact, questions, ppr_contexts, canaries)
    run_phase_b_judges(args, artifact, questions)
    if not args.smoke:
        finalize(artifact, questions)
        write_artifact(artifact, out_path)

    print("\n================ TRACK K SUMMARY ================")
    for arm, entry in artifact["arms"].items():
        if entry.get("eval"):
            print(arm, json.dumps(entry["eval"], ensure_ascii=False))
    if artifact.get("judgeAgreement"):
        print("judgeAgreement:", json.dumps(artifact["judgeAgreement"]))


if __name__ == "__main__":
    main()
