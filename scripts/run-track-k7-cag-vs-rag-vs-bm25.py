"""scripts/run-track-k7-cag-vs-rag-vs-bm25.py

Stage K7: cache-augmented generation (CAG) versus BM25 retrieval on the K3 noisy estate.
No training, base Qwen2.5-1.5B-Instruct only.

This is a self-contained CLI, not a module. The helper functions below are copied from
scripts/run-track-k-composition-head-to-head.py (Stage K3) so the prompt renderer, answer
decoder, exact-match scorer, row summary and artifact writer match K3 computation for
computation: render_chat_prompt, generate_answer, normalize_value, exact_match,
is_abstention, is_effectively_empty, summarize_rows, write_artifact, plus MODEL_ID,
configure_tokenizer, SYSTEM_PROMPT, RETRIEVAL_PROMPT_PREFIX and the generation params.

Arms:
  bm25_retrieval  per-question top-6 BM25 context string, fresh prefill, answer (K3 retrieval
                  prompt shape verbatim), exact-match scoring.
  cag             one cache unit (the selected composed per-entity records) prefilled once,
                  each question appended after the cache, answer, cache cropped back to the
                  prefill boundary before the next question (Chan et al., arXiv:2412.15605).
  cag_hybrid      per-question record selection by the question person's canonical identity,
                  a fresh per-question DynamicCache over the selected records, append the
                  question, answer; no cache state is shared across questions (hybrid CAG-RAG,
                  arXiv:2505.08261).

Cache API used (transformers 4.57.6): DynamicCache() built by a model forward with
past_key_values=cache, then DynamicCache.crop(boundary) between questions. The 4.57 class
exposes crop(), not truncate(); verified in transformers/cache_utils.py. The forward passes
logits_to_keep=1 so the prefill does not materialize a full-sequence vocabulary logit tensor.

Wallclock measurements (cache build, per-question latency) go to
results/track-k7-timing-log.json, never into the deterministic artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.cache_utils import DynamicCache

REPO = Path(__file__).resolve().parents[1]
RESULTS_DIR = REPO / "results"
MANIFEST_PATH = REPO / "fixtures" / "noisy-estate-manifest.json"
K3_ARTIFACT_PATH = RESULTS_DIR / "track-k-composition-head-to-head.json"
COMPOSED_PATH = RESULTS_DIR / "track-k-corpus-composed.jsonl"
BM25_CONTEXTS_PATH = RESULTS_DIR / "track-k7-bm25-contexts.json"
PPR_CONTEXTS_PATH = RESULTS_DIR / "track-k-arm-ppr-contexts.json"
OUT_PATH = RESULTS_DIR / "track-k7-cag-vs-rag-vs-bm25.json"
TIMING_PATH = RESULTS_DIR / "track-k7-timing-log.json"

MODEL_ID = "Qwen/Qwen2.5-1.5B-Instruct"
MODEL_LABEL = "Qwen2.5-1.5B-Instruct"
SEED = 42
MAX_NEW_TOKENS = 128

CONTEXT_LIMIT = 32768
HEADROOM_TOKENS = 1024
QUESTION_SENTINEL = "__K7_QUESTION_SENTINEL__"

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

PLACEHOLDER_ECHO_RE = re.compile(r"<(?:PII|SECRET):[A-Za-z0-9_]+")

SELECTION_RULE = (
    "A candidate is any composed record whose target or entity list carries a canonical "
    "identity key of a question personId (normalized full name, email, or phone digits; "
    "manifest mention surfaces are not used, to avoid cross-person surname collisions). "
    "Candidates are ranked by the number of distinct question persons the record mentions "
    "(descending), then by target string (ascending), then by record id (ascending). Records "
    "are added greedily in that order only when they cover at least one question person not "
    "already covered, and only while the rendered prefill stays within 32768 minus 1024 "
    "reserved tokens. Selection stops when every question person is covered or the candidates "
    "are exhausted. Rejected records are counted as redundant (no new coverage) or budget "
    "dropped (new coverage but over budget); record text is never shortened."
)

RECORD_RENDERING = (
    "Each composed jsonl row carries chat turns. Its readable record text is the assistant "
    "turn content (the composed per-entity record). The generic system/user turns and the "
    "JSON target/entity/id fields are not prefilled, so the cache carries the same raw estate "
    "text the BM25 contexts carry. Selected record texts are joined with blank lines in "
    "cache-unit order."
)

HYBRID_SELECTION_RULE = (
    "Per question, candidates are the composed records whose target or entity list carries a "
    "canonical identity key of the question personId (normalized full name, email, or phone "
    "digits; the same key function the cache unit uses). A record whose own target carries a "
    "person key is a subject record for that person; subject records are ordered by target "
    "string then record id ascending. Only when a person has no subject record does selection "
    "fall back to the records that merely mention the person in their entity list, ordered by "
    "record id ascending. Records are added in that order only while the rendered prefill stays "
    "within 32768 minus 1024 reserved tokens; a record that does not fit is counted as a cap hit, "
    "and record text is never shortened. Each question gets its own prefill and DynamicCache; "
    "no KV state is reused across questions."
)

STRATA = ("Q1", "Q2", "Q3", "all")


# ---- helpers copied from scripts/run-track-k-composition-head-to-head.py (Stage K3) ----
def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            s = line.strip()
            if s:
                rows.append(json.loads(s))
    return rows


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
    return re.sub(r" thinking.*?</think>", "", text, flags=re.S).strip(), ms


def exact_match(answer: str, expected: str) -> bool:
    a = normalize_value(answer).strip(" .,;:!?")
    e = normalize_value(expected)
    return bool(e) and e in a


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


def write_artifact(artifact: dict, path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")


# ---- K7: cache-unit selection and rendering ----
def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _person_key(v: str) -> str:
    return "person:" + re.sub(r"\s+", " ", str(v or "")).strip().lower()


def _email_key(v: str) -> str:
    return "email:" + re.sub(r"\s+", "", str(v or "")).strip().lower()


def _phone_key(v: str) -> str:
    return "phone:" + re.sub(r"\D", "", str(v or ""))


def person_identity_keys(manifest: dict, person_ids: list[str]) -> dict[str, set[str]]:
    people = {p["personId"]: p for p in manifest["world"]["people"]}
    keys: dict[str, set[str]] = {}
    for pid in person_ids:
        p = people[pid]
        ks = {_person_key(p["fullName"])}
        ks.update(_email_key(e) for e in p.get("emails", []))
        ks.add(_phone_key(p.get("phone", "")))
        keys[pid] = ks
    return keys


def record_identity_keys(rec: dict) -> set[str]:
    keys: set[str] = set()
    for e in list(rec.get("entities") or []) + [rec.get("target", "")]:
        parts = str(e).split(":", 2)
        if len(parts) != 3 or parts[0] != "ent":
            continue
        kind, value = parts[1], parts[2]
        if kind == "person":
            keys.add(_person_key(value))
        elif kind == "email":
            keys.add(_email_key(value))
        elif kind == "phone":
            keys.add(_phone_key(value))
    return keys


def record_text(rec: dict) -> str:
    msgs = rec.get("messages") or []
    return str(msgs[-1]["content"]).strip() if msgs else ""


def build_prefill(tok, cache_text: str) -> tuple[str, str]:
    user_content = f"{RETRIEVAL_PROMPT_PREFIX}{cache_text}\n\nQuestion: {QUESTION_SENTINEL}"
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    full = render_chat_prompt(tok, msgs, add_gen=True)
    idx = full.find(QUESTION_SENTINEL)
    if idx < 0 or full.count(QUESTION_SENTINEL) != 1:
        raise RuntimeError("question sentinel missing or repeated in the chat template render")
    return full[:idx], full[idx + len(QUESTION_SENTINEL):]


def select_cache_unit(tok, records: list[dict], question_rows: list[dict], person_by_qid: dict[str, str], manifest: dict) -> dict:
    person_ids = sorted({person_by_qid[q["qid"]] for q in question_rows})
    keys = person_identity_keys(manifest, person_ids)
    candidates = []
    for rec in records:
        rk = record_identity_keys(rec)
        covered = [pid for pid in person_ids if keys[pid] & rk]
        if covered:
            candidates.append((rec, covered))
    candidates.sort(key=lambda x: (-len(x[1]), str(x[0].get("target", "")), str(x[0].get("id", ""))))

    empty_prefill, _ = build_prefill(tok, "")
    scaffold_tokens = len(tok.encode(empty_prefill, add_special_tokens=False))
    token_budget = CONTEXT_LIMIT - HEADROOM_TOKENS

    selected: list[dict] = []
    texts: list[str] = []
    covered: set[str] = set()
    used = scaffold_tokens
    budget_dropped = 0
    for rec, covered_by_rec in candidates:
        new_coverage = [pid for pid in covered_by_rec if pid not in covered]
        if not new_coverage:
            continue
        text = record_text(rec)
        n = len(tok.encode(text, add_special_tokens=False))
        add = n + (2 if texts else 0)
        if used + add > token_budget:
            budget_dropped += 1
            continue
        selected.append(rec)
        texts.append(text)
        covered.update(new_coverage)
        used += add
        if len(covered) == len(person_ids):
            break

    cache_text = "\n\n".join(texts)
    prefill_str, tail = build_prefill(tok, cache_text)
    prefill_tokens = len(tok.encode(prefill_str, add_special_tokens=False))
    while prefill_tokens > token_budget and selected:
        selected.pop()
        texts.pop()
        budget_dropped += 1
        cache_text = "\n\n".join(texts)
        prefill_str, tail = build_prefill(tok, cache_text)
        prefill_tokens = len(tok.encode(prefill_str, add_special_tokens=False))

    covered_persons = sorted({pid for rec in selected for pid in person_ids if keys[pid] & record_identity_keys(rec)})
    covered_set = set(covered_persons)
    covered_questions = sum(1 for q in question_rows if person_by_qid[q["qid"]] in covered_set)
    redundant = len(candidates) - len(selected) - budget_dropped
    cache_sha = hashlib.sha256(cache_text.encode("utf-8")).hexdigest()

    return {
        "unit": "composed per-entity record (hub-capped composed-v1, block cap 8, as stored in the jsonl)",
        "rendering": RECORD_RENDERING,
        "selectionRule": SELECTION_RULE,
        "questionsConsidered": len(question_rows),
        "questionPersons": len(person_ids),
        "candidateRecords": len(candidates),
        "selectedRecords": len(selected),
        "droppedRecords": len(candidates) - len(selected),
        "redundantRecords": redundant,
        "budgetDroppedRecords": budget_dropped,
        "contextLimitTokens": CONTEXT_LIMIT,
        "headroomTokens": HEADROOM_TOKENS,
        "tokenBudget": token_budget,
        "prefillTokens": prefill_tokens,
        "prefillTextSha256": cache_sha,
        "coveredQuestionPersons": len(covered_persons),
        "coveredQuestions": covered_questions,
        "uncoveredPersonIds": [pid for pid in person_ids if pid not in covered_set],
        "allQuestionPersonsCovered": len(covered_set) == len(person_ids),
        "overflowDecision": (
            f"{len(candidates)} candidate records matched the question persons; "
            f"{len(selected)} were selected. {budget_dropped} new-coverage candidates were "
            f"dropped by the {token_budget}-token cache budget and {redundant} were redundant "
            f"once coverage stopped growing. All question persons covered: "
            f"{len(covered_set) == len(person_ids)}. Record text is never shortened."
        ),
        "_records": selected,
        "_prefill": prefill_str,
        "_tail": tail,
    }


def target_identity_keys(rec: dict) -> set[str]:
    parts = str(rec.get("target", "")).split(":", 2)
    if len(parts) != 3 or parts[0] != "ent":
        return set()
    kind, value = parts[1], parts[2]
    if kind == "person":
        return {_person_key(value)}
    if kind == "email":
        return {_email_key(value)}
    if kind == "phone":
        return {_phone_key(value)}
    return set()


def select_hybrid_records(tok, records: list[dict], person_keys: set[str], scaffold_tokens: int, token_budget: int) -> dict:
    candidates = [rec for rec in records if person_keys & record_identity_keys(rec)]
    subject: list[dict] = []
    mention: list[dict] = []
    for rec in candidates:
        (subject if target_identity_keys(rec) & person_keys else mention).append(rec)
    subject.sort(key=lambda rec: (str(rec.get("target", "")), str(rec.get("id", ""))))
    mention.sort(key=lambda rec: str(rec.get("id", "")))
    pool = subject or mention

    selected: list[dict] = []
    texts: list[str] = []
    used = scaffold_tokens
    cap_hits = 0
    for rec in pool:
        text = record_text(rec)
        add = len(tok.encode(text, add_special_tokens=False)) + (2 if texts else 0)
        if used + add > token_budget:
            cap_hits += 1
            continue
        selected.append(rec)
        texts.append(text)
        used += add

    prefill_str, tail = build_prefill(tok, "\n\n".join(texts))
    prefill_tokens = len(tok.encode(prefill_str, add_special_tokens=False))
    while prefill_tokens > token_budget and selected:
        selected.pop()
        texts.pop()
        cap_hits += 1
        prefill_str, tail = build_prefill(tok, "\n\n".join(texts))
        prefill_tokens = len(tok.encode(prefill_str, add_special_tokens=False))

    return {
        "candidateRecords": len(candidates),
        "subjectRecords": len(subject),
        "selectedRecords": len(selected),
        "budgetDroppedRecords": cap_hits,
        "prefillTokens": prefill_tokens,
        "prefill": prefill_str,
        "tail": tail,
    }


# ---- K7 arms ----
def _row(q: dict, answer: str, **extra) -> dict:
    row = {
        "qid": q["qid"],
        "stratum": q["stratum"],
        "attr": q.get("attr"),
        "question": q["question"],
        "expectedValue": q["expectedValue"],
        "answer": answer,
        "is_empty": is_effectively_empty(answer),
        "is_abstention": is_abstention(answer),
        "exact_match": exact_match(answer, q["expectedValue"]),
        "has_placeholder_echo": bool(PLACEHOLDER_ECHO_RE.search(answer or "")),
    }
    row.update(extra)
    return row


def arm_summary(entry: dict) -> None:
    rows = entry["rows"]
    entry["eval"] = summarize_rows(rows)
    q3 = [r for r in rows if r["stratum"] == "Q3"]
    entry["q3Disambiguation"] = {
        "n": len(q3),
        "exactMatchCount": sum(1 for r in q3 if r["exact_match"]),
        "exactMatchPct": round(100.0 * sum(1 for r in q3 if r["exact_match"]) / max(1, len(q3)), 1),
        "note": "the user-visible cost of a false merge: answers must resolve the collision hint (the title) AND pick the right person",
    }


def run_bm25_arm(model, tok, questions: list[dict], contexts: dict[str, str], timing: dict) -> dict:
    rows = []
    for q in questions:
        ctx = contexts.get(q["qid"])
        if ctx is None:
            raise KeyError(f"no BM25 context for {q['qid']}")
        ans, ms = generate_answer(model, tok, q["question"], context=ctx)
        user_content = f"{RETRIEVAL_PROMPT_PREFIX}{ctx}\n\nQuestion: {q['question']}"
        prompt_str = render_chat_prompt(
            tok,
            [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_content}],
            add_gen=True,
        )
        rows.append(_row(
            q, ans,
            contextTokens=len(tok.encode(ctx, add_special_tokens=False)),
            promptTokens=len(tok.encode(prompt_str, add_special_tokens=False)),
        ))
        timing["perQuestion"].append({"arm": "bm25_retrieval", "qid": q["qid"], "latencyMs": round(ms, 1)})
        print(f"[k7] bm25_retrieval {q['qid']}: em={rows[-1]['exact_match']} latency_ms={round(ms, 1)} answer={ans!r}")
    return {
        "kind": "bm25_retrieval",
        "rows": rows,
        "tokenAccounting": {
            "questions": len(rows),
            "contextTokensTotal": sum(r["contextTokens"] for r in rows),
            "promptTokensTotal": sum(r["promptTokens"] for r in rows),
            "promptTokensMean": round(sum(r["promptTokens"] for r in rows) / max(1, len(rows)), 1),
            "note": "fresh per-question prefill; the K3 retrieval prompt shape is used verbatim",
        },
    }


def run_cag_arm(model, tok, questions: list[dict], prefill_str: str, tail: str, timing: dict) -> dict:
    device = model.get_input_embeddings().weight.device
    prefill_ids = tok(prefill_str, return_tensors="pt", add_special_tokens=False)["input_ids"].to(device)
    cache = DynamicCache()
    t0 = time.perf_counter()
    with torch.inference_mode():
        model(
            input_ids=prefill_ids,
            attention_mask=torch.ones_like(prefill_ids),
            past_key_values=cache,
            use_cache=True,
            logits_to_keep=1,
        )
    timing["cacheBuildSeconds"] = round(time.perf_counter() - t0, 2)
    boundary = cache.get_seq_length()
    if boundary != prefill_ids.shape[1]:
        raise RuntimeError(f"cache boundary {boundary} != prefill tokens {prefill_ids.shape[1]}")
    print(f"[k7] cag: prefilled {boundary} tokens in {timing['cacheBuildSeconds']}s")

    rows = []
    for q in questions:
        append_text = q["question"] + tail
        append_ids = tok(append_text, return_tensors="pt", add_special_tokens=False)["input_ids"].to(device)
        attention_mask = torch.ones((1, boundary + append_ids.shape[1]), dtype=torch.long, device=device)
        generated: list[int] = []
        cur = append_ids
        t0 = time.perf_counter()
        with torch.inference_mode():
            for _ in range(MAX_NEW_TOKENS):
                out = model(
                    input_ids=cur,
                    attention_mask=attention_mask,
                    past_key_values=cache,
                    use_cache=True,
                    logits_to_keep=1,
                )
                nxt = int(out.logits[0, -1].argmax().item())
                if nxt == tok.eos_token_id:
                    break
                generated.append(nxt)
                cur = torch.tensor([[nxt]], dtype=torch.long, device=device)
                attention_mask = torch.cat(
                    [attention_mask, torch.ones((1, 1), dtype=torch.long, device=device)], dim=1
                )
        ms = (time.perf_counter() - t0) * 1000.0
        cache.crop(boundary)
        if cache.get_seq_length() != boundary:
            raise RuntimeError("cache crop did not restore the prefill boundary")
        text = tok.decode(generated, skip_special_tokens=True).strip()
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
        rows.append(_row(q, text, appendedTokens=len(append_ids[0]), cachePrefillTokens=boundary))
        timing["perQuestion"].append({"arm": "cag", "qid": q["qid"], "latencyMs": round(ms, 1)})
        print(f"[k7] cag {q['qid']}: em={rows[-1]['exact_match']} latency_ms={round(ms, 1)} answer={text!r}")
    return {
        "kind": "cag",
        "rows": rows,
        "tokenAccounting": {
            "questions": len(rows),
            "cacheBuildTokens": boundary,
            "appendedTokensTotal": sum(r["appendedTokens"] for r in rows),
            "appendedTokensMean": round(sum(r["appendedTokens"] for r in rows) / max(1, len(rows)), 1),
            "note": "the cache is built once; each question appends only its own tokens after the cached prefill, then the cache is cropped back to the boundary",
        },
    }


def run_hybrid_arm(model, tok, questions: list[dict], records: list[dict], person_by_qid: dict[str, str], manifest: dict, timing: dict) -> dict:
    device = model.get_input_embeddings().weight.device
    person_ids = sorted({person_by_qid[q["qid"]] for q in questions})
    keys_by_person = person_identity_keys(manifest, person_ids)
    empty_prefill, _ = build_prefill(tok, "")
    scaffold_tokens = len(tok.encode(empty_prefill, add_special_tokens=False))
    token_budget = CONTEXT_LIMIT - HEADROOM_TOKENS

    rows = []
    for q in questions:
        plan = select_hybrid_records(
            tok, records, keys_by_person[person_by_qid[q["qid"]]], scaffold_tokens, token_budget
        )
        prefill_ids = tok(plan["prefill"], return_tensors="pt", add_special_tokens=False)["input_ids"].to(device)
        cache = DynamicCache()
        t0 = time.perf_counter()
        with torch.inference_mode():
            model(
                input_ids=prefill_ids,
                attention_mask=torch.ones_like(prefill_ids),
                past_key_values=cache,
                use_cache=True,
                logits_to_keep=1,
            )
        prefill_ms = (time.perf_counter() - t0) * 1000.0
        boundary = cache.get_seq_length()
        if boundary != prefill_ids.shape[1]:
            raise RuntimeError(f"cache boundary {boundary} != prefill tokens {prefill_ids.shape[1]}")

        append_text = q["question"] + plan["tail"]
        append_ids = tok(append_text, return_tensors="pt", add_special_tokens=False)["input_ids"].to(device)
        attention_mask = torch.ones((1, boundary + append_ids.shape[1]), dtype=torch.long, device=device)
        generated: list[int] = []
        cur = append_ids
        t0 = time.perf_counter()
        with torch.inference_mode():
            for _ in range(MAX_NEW_TOKENS):
                out = model(
                    input_ids=cur,
                    attention_mask=attention_mask,
                    past_key_values=cache,
                    use_cache=True,
                    logits_to_keep=1,
                )
                nxt = int(out.logits[0, -1].argmax().item())
                if nxt == tok.eos_token_id:
                    break
                generated.append(nxt)
                cur = torch.tensor([[nxt]], dtype=torch.long, device=device)
                attention_mask = torch.cat(
                    [attention_mask, torch.ones((1, 1), dtype=torch.long, device=device)], dim=1
                )
        ms = (time.perf_counter() - t0) * 1000.0
        text = tok.decode(generated, skip_special_tokens=True).strip()
        text = re.sub(r" think.*? response", "", text, flags=re.S).strip()
        rows.append(_row(
            q, text,
            appendedTokens=len(append_ids[0]),
            cachePrefillTokens=boundary,
            candidateRecords=plan["candidateRecords"],
            subjectRecords=plan["subjectRecords"],
            selectedRecords=plan["selectedRecords"],
            budgetDroppedRecords=plan["budgetDroppedRecords"],
        ))
        timing["perQuestion"].append({
            "arm": "cag_hybrid", "qid": q["qid"], "latencyMs": round(ms, 1), "prefillMs": round(prefill_ms, 1),
        })
        print(
            f"[k7] cag_hybrid {q['qid']}: em={rows[-1]['exact_match']} "
            f"records={plan['selectedRecords']}/{plan['candidateRecords']} "
            f"prefill={boundary} latency_ms={round(ms, 1)} answer={text!r}"
        )
        del cache
    return {
        "kind": "cag_hybrid",
        "rows": rows,
        "tokenAccounting": {
            "questions": len(rows),
            "prefillTokensTotal": sum(r["cachePrefillTokens"] for r in rows),
            "prefillTokensMean": round(sum(r["cachePrefillTokens"] for r in rows) / max(1, len(rows)), 1),
            "prefillTokensMin": min(r["cachePrefillTokens"] for r in rows),
            "prefillTokensMax": max(r["cachePrefillTokens"] for r in rows),
            "appendedTokensTotal": sum(r["appendedTokens"] for r in rows),
            "appendedTokensMean": round(sum(r["appendedTokens"] for r in rows) / max(1, len(rows)), 1),
            "capHits": sum(r["budgetDroppedRecords"] for r in rows),
            "note": "a fresh per-question DynamicCache is built from the selected records and discarded after the answer; no KV state carries across questions",
        },
    }


def write_timing(timing: dict) -> None:
    TIMING_PATH.parent.mkdir(parents=True, exist_ok=True)
    TIMING_PATH.write_text(json.dumps(timing, indent=2), encoding="utf-8")


def load_contexts(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("contexts"), dict):
        data = data["contexts"]
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        out = {}
        for row in data["rows"]:
            ctx = row.get("context", row.get("contexts", row.get("text")))
            if isinstance(ctx, list):
                ctx = "\n\n".join(ctx)
            out[row.get("qid") or row.get("questionId")] = ctx
        return out
    if isinstance(data, dict):
        out = {}
        for qid, val in data.items():
            if not str(qid).startswith("q-"):
                continue
            if isinstance(val, str):
                out[qid] = val
            elif isinstance(val, dict):
                ctx = val.get("context", val.get("contexts", val.get("text")))
                out[qid] = "\n\n".join(ctx) if isinstance(ctx, list) else ctx
        return out
    raise TypeError(f"unrecognised context file shape: {path}")


def resolve_device(value: str) -> str:
    if value == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if value == "cuda" and not torch.cuda.is_available():
        sys.exit("[k7] --device cuda requested but torch.cuda.is_available() is false")
    return value


def load_base_model(device: str):
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=dtype)
    model.to(device)
    model.eval()
    return model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="answer only the leading N questions per arm")
    parser.add_argument("--device", choices=("cpu", "cuda", "auto"), default="auto")
    parser.add_argument("--out", default=str(OUT_PATH))
    parser.add_argument("--bm25-contexts", default=str(BM25_CONTEXTS_PATH))
    parser.add_argument("--composed", default=str(COMPOSED_PATH))
    args = parser.parse_args()

    device = resolve_device(args.device)
    print(f"[k7] device: {device}")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    person_by_qid = {q["qid"]: q["personId"] for q in manifest["questions"]}
    k3 = json.loads(K3_ARTIFACT_PATH.read_text(encoding="utf-8"))
    all_questions = k3["arms"]["retrieval"]["rows"]
    questions = all_questions[: args.limit] if args.limit else all_questions

    bm25_path = Path(args.bm25_contexts)
    fallback = False
    if not bm25_path.exists():
        if args.limit <= 0:
            sys.exit(f"[k7] missing {bm25_path}; the real run waits for the BM25 contexts file")
        bm25_path = PPR_CONTEXTS_PATH
        fallback = True
        print(f"[k7] WARNING: {args.bm25_contexts} absent; using {PPR_CONTEXTS_PATH} for this limited smoke run only")
    contexts = load_contexts(bm25_path)
    bm25_doc = json.loads(bm25_path.read_text(encoding="utf-8"))
    composed_path = Path(args.composed)

    composed_rows = load_jsonl(composed_path)
    estate_records = [r for r in composed_rows if r.get("kind") != "chat_canary"]

    tok = AutoTokenizer.from_pretrained(MODEL_ID)
    configure_tokenizer(tok)

    cache_unit = select_cache_unit(tok, estate_records, questions, person_by_qid, manifest)
    prefill_str = cache_unit.pop("_prefill")
    tail = cache_unit.pop("_tail")
    cache_unit.pop("_records")

    artifact = {
        "kind": "track-k7-cag-vs-rag-vs-bm25",
        "stage": "K7",
        "seed": SEED,
        "recipe": {
            "model": MODEL_LABEL,
            "modelId": MODEL_ID,
            "seed": SEED,
            "generation": {
                "maxNewTokens": MAX_NEW_TOKENS,
                "doSample": False,
                "decoding": "greedy argmax",
                "eosStop": True,
            },
            "bm25Contexts": {
                "file": rel_path(bm25_path),
                "sha256": sha256_file(bm25_path),
                "fallbackFromPprContexts": fallback,
                "ranking": bm25_doc.get("bm25") if isinstance(bm25_doc, dict) else None,
            },
            "composedCorpus": {
                "file": rel_path(composed_path),
                "sha256": sha256_file(composed_path),
            },
            "cacheUnitSelectionRule": SELECTION_RULE,
            "cagHybridSelectionRule": HYBRID_SELECTION_RULE,
            "contextLimitTokens": CONTEXT_LIMIT,
            "headroomTokens": HEADROOM_TOKENS,
            "cacheApi": "transformers 4.57.6 DynamicCache + model forward(past_key_values=cache); DynamicCache.crop(boundary) between questions",
        },
        "estate": {
            "manifest": "fixtures/noisy-estate-manifest.json",
            "documentCount": len(manifest["documents"]),
            "questions": len(all_questions),
            "strata": dict(Counter(q["stratum"] for q in all_questions)),
        },
        "arms": {},
        "cacheUnit": cache_unit,
        "notes": [
            RECORD_RENDERING,
            "All three arms use base Qwen2.5-1.5B-Instruct with no training and the K3 exact-match scorer.",
            "The cached prefill carries only composed record text, never the manifest answer key.",
            "60 questions is small: a few points of exact-match difference between arms is noise; read the per-stratum counts alongside.",
            "Wallclock measurements live in results/track-k7-timing-log.json and are not part of this artifact.",
        ],
        "anti_circularity_note": (
            "The answering model sees only BM25 context strings or the prefilled composed-record cache. "
            "It never sees fixtures/noisy-estate-manifest.json or its expected values; the manifest is read "
            "by this runner only to map question personIds to cache records and to score exact matches."
        ),
        "zero_egress_note": (
            "No network I/O at runtime. HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1 are set; the model "
            "loads from the local Hugging Face cache and all retrieval, selection and scoring are local."
        ),
    }
    if args.limit:
        artifact["limit"] = args.limit
    out_path = Path(args.out)

    timing = {
        "kind": "track-k7-timing-log",
        "note": "Wallclock measurements, machine dependent. NOT part of results/track-k7-cag-vs-rag-vs-bm25.json.",
        "device": device,
        "cacheBuildSeconds": None,
        "modelLoadSeconds": None,
        "perQuestion": [],
    }

    write_artifact(artifact, out_path)
    t0 = time.perf_counter()
    model = load_base_model(device)
    timing["modelLoadSeconds"] = round(time.perf_counter() - t0, 1)
    print(f"[k7] model loaded in {timing['modelLoadSeconds']}s on {device}")

    print("[k7] === arm: bm25_retrieval ===")
    artifact["arms"]["bm25_retrieval"] = run_bm25_arm(model, tok, questions, contexts, timing)
    arm_summary(artifact["arms"]["bm25_retrieval"])
    write_artifact(artifact, out_path)
    write_timing(timing)

    print("[k7] === arm: cag ===")
    artifact["arms"]["cag"] = run_cag_arm(model, tok, questions, prefill_str, tail, timing)
    arm_summary(artifact["arms"]["cag"])
    write_artifact(artifact, out_path)
    write_timing(timing)

    print("[k7] === arm: cag_hybrid ===")
    artifact["arms"]["cag_hybrid"] = run_hybrid_arm(
        model, tok, questions, estate_records, person_by_qid, manifest, timing
    )
    arm_summary(artifact["arms"]["cag_hybrid"])
    write_artifact(artifact, out_path)
    write_timing(timing)

    print("\n================ TRACK K7 SUMMARY ================")
    for arm, entry in artifact["arms"].items():
        print(arm, json.dumps(entry["eval"], ensure_ascii=False))
    print("cacheUnit:", json.dumps({k: v for k, v in cache_unit.items() if k != "rendering"}))
    print(f"artifact: {out_path}")
    print(f"timing log: {TIMING_PATH}")


if __name__ == "__main__":
    main()
