# Company Brain novelty mechanisms — prior-art verification (2026-11-24)

All arXiv IDs below were pinned by fetching `arxiv.org/abs/<ID>` or `export.arxiv.org` directly this session.
Hallucination catches this session: a summary model returned `2308.07051` for "Machine Unlearning: Solutions and Challenges" — that ID resolves to a traffic-flow Fourier-Neural-Operator paper. My own memory offered `2404.19774` for DataComp-LM — wrong; the verified ID is `2406.11794`. The task brief's `1911.04933` labeled "SISA" is actually Golatkar et al. — SISA is `1912.03817`.

## Verified citation ledger

**Erasure / unlearning (all model-side, none corpus-side):**
- arXiv:1912.03817 — Bourtoule et al., "Machine Unlearning" (SISA: shard/slice/aggregate training for exact-ish unlearning). IEEE S&P 2021.
- arXiv:1911.04933 — Golatkar, Achille, Soatto, "Eternal Sunshine of the Spotless Net" (weight scrubbing; estimable upper bound on remaining leakage).
- arXiv:2010.10981 — Graves, Nagisetty, Ganesh, "Amnesiac Machine Learning" (delete training steps; resists inversion/membership inference).
- arXiv:2307.03941 — Zhang et al., "Right to be Forgotten in the Era of Large Language Models" (survey: DP, unlearning, editing, guardrails for RTBF).
- arXiv:2402.15159 — Yao et al., "Machine Unlearning of Pre-trained Large Language Models" (7 methods evaluated; much cheaper than retrain but approximate).
- arXiv:2310.07579 — Pawelczyk, Neel, Lakkaraju, "In-Context Unlearning".
- arXiv:2411.08443 — "Machine Unlearning on Pre-trained Models by Residual Feature Alignment Using LoRA"; also 2405.15152 (gradient ascent + LoRA), 2604.12526 (SVD-LoRA orthogonal unlearning).
- arXiv:2605.02196 — DurableUn: INT4 adapter quantization can RESTORE "forgotten" content — model-side unlearning is fragile under quantization.
- arXiv:1811.00513 — Song, Shmatikov, "Auditing Data Provenance in Text-Generation Models" (black-box detection that a person's text was in training data; GDPR-motivated).
- arXiv:2603.02240 — "SuperLocalMemory" (local multi-agent memory w/ per-agent provenance + GDPR Art 17 erasure; agent memory, NOT training corpora).

**Graph → training data / data curation:**
- arXiv:2505.20416 — GraphGen: KG-guided synthetic QA generation for SFT (atomic/aggregated/multi-hop) — but it builds a synthetic KG FROM text; direction reversed vs ours.
- arXiv:2406.11794 — DataComp-LM (benchmark of curation as filtering pipeline; 240T tokens).
- arXiv:1803.09010 — Gebru et al., "Datasheets for Datasets".
- arXiv:2603.04184 — Vidal et al., "Publication and Maintenance of Relational Data in Enterprise Knowledge Graphs" (materialized RDB2RDF views + incremental maintenance — formal "graph as projection of relational truth").
- arXiv:2611.04899 — "Knowledge Graph Lakehouse" (cloud-native; builds application-specific KGs on demand; no training corpora, no erasure).

**Entity resolution / PPRL:
- arXiv:2108.09879 — AMPPERE (universal abstract machine for privacy-preserving ER evaluation; MPC & homomorphic-encryption platforms) — Yao, Ghai, Ravi, Szekely.
- arXiv:2208.07999 — PPJoin under homomorphic encryption (palisade). arXiv:2405.18430 — HE-based ER across health orgs. arXiv:1711.10677 — Hardy/Nock et al., federated logistic regression across vertically partitioned data via private ER.
- PPRL survey line: Vatsalan/Christen/Verykios (J Privacy & Confidentiality era, 2013+) — NOT on arXiv; standard literature. Splink (MoJ) = high-performance local deterministic linkage — engineering prior art, no arXiv ID.

**Redaction guarantees / attacks:**
- arXiv:2603.09781 — CLIOPATRA: extracts sensitive info from an LLM insight platform despite layered redaction + auditing — attacks our exact class of claim.
- arXiv:2609.02207 — LeakageBench: better entity localization still leaves most document pages unsafe for release.
- arXiv:2603.26032 — Character-level DP for prompts; explicitly frames rule-based PII redaction as lacking a formal guarantee.
- arXiv:2508.05545 — PRvL: quantifies LLM PII-redaction capability/risk.
- "deletion-compliant" → 0 arXiv hits. "certified redaction" → 0 arXiv hits. Conformal prediction + PII detection → essentially uncovered (one unrelated hit).

**Determinism / reproducibility of fine-tuning:**
- arXiv:2611.10334 — Reproducible LoRA INFERENCE via deterministic Split-K reduction (floating-point nondeterminism changed 97.61% of comparisons in atomic version). Deterministic FINE-TUNING: no arXiv hits — white space.

---

## Candidate verdicts

### 1 + 5 (combined): "Amnesiac Corpus / Compliance-Complete Training Unit" — ALIVE (strongest)
**Claim:** training corpora are generated deterministically (byte-reproducible) from sources + the entity/connection graph with entity-indexed provenance; an Art 17 request deterministically regenerates a corpus byte-identical to the original except the erased entity's spans + their graph projections; a small seeded LoRA adapter retrained on the regenerated corpus is the erasure-compliant deliverable (adapter = cheap replacement for model-side unlearning).
**Nearest prior art:** SISA (1912.03817), Amnesiac (2010.10981), Eternal Sunshine (1911.04933), RTBF surveys (2307.03941) — every one operates on the MODEL. Nobody makes deterministic corpus regeneration + cheap adapter retrain the erasure mechanism. SuperLocalMemory (2603.02240) does Art 17 on agent memory, not corpora. DurableUn (2605.02196) proves approximate model-side unlearning is fragile — supporting evidence for our approach.
**Genuinely new:** (a) corpus as deterministically regenerable artifact with graph projections; (b) the corpus+adapter pair as the auditable erasure unit; (c) deterministic fine-tuning as the enabling guarantee (no prior art at all).
**Honest market claim:** "Deleting one person deterministically regenerates every training corpus minus that person — and a fresh adapter trains on it in minutes — so you never have to guess what your model still remembers."

### 2: "Train the View" — HALF-ALIVE (feature, not identity)
**Claim:** the company graph is the single source of truth; every training corpus is a typed deterministic projection of it (per dept/topic/policy); "what did the model learn?" is a graph query.
**Nearest prior art:** GraphGen (2505.20416) — KG→QA synthetic SFT data (reverse direction); EKG materialized views (2603.04184) — "graph as projection of relational truth" exists in DB formalism; KG Lakehouse (2611.04899) — application-specific KGs on demand; DataComp-LM (2406.11794) — curation pipelines. The composition (real company graph → typed corpus projections → provenance + erasure coupling) is unclaimed, but "graph-grounded instruction tuning" per se is crowded.
**Verdict:** keep as the *substrate* of the identity mechanism (projections are how erasure regen stays byte-precise), don't sell it standalone.

### 3: Client-side WASM ER — DEAD as novelty bet (engineering packaging)
**Killed by:** AMPPERE line (2108.09879, 2208.07999, 2405.18430), Hardy et al. 1711.10677, the PPRL survey literature (Vatsalan/Christen), and Splink. A single-party fully-local ER pipeline is a packaging/concurrency engineering achievement (and crypto-free, unlike the HE line — that IS the practical differentiator), not a mechanism claim.
**Honest claim:** "whole-company entity resolution that never leaves the machine" — a distribution claim, not an algorithm claim.

### 4: Per-sample leakage certificates — ALIVE but narrow (must be framed precisely)
**Claim:** Learn-Then-Test (2110.01052, verified — the framework Versieve already uses) + e-processes certify PER SAMPLE that redaction missed no entity of class C with error rate ≤ α at confidence 1−δ; plus Carlini canary exposure as the empirical corroboration.
**Why it's defensible:** "certified redaction" — 0 arXiv hits; conformal-on-PII essentially uncovered; PRvL (2508.05545) and LeakageBench (2609.02207) only *measure* risk post-hoc; DP-synthetic-data vendors (Gretel, Mostly AI — general knowledge, no arXiv IDs claimed here) claim DP, a fundamentally different guarantee (privacy of the training distribution) than redaction (removal of identified entities). Do NOT blur into "DP-like".
**The trap (honest limits):** redaction has no formal privacy guarantee against attribute inference/quasi-identifiers — CLIOPATRA (2603.09781) breaks exactly this class of claim; 2603.26032 states rule-based redaction lacks guarantees. The claim must be: "certified detection recall by entity class + measured canary exposure", never "provable anonymity".
**Honest market claim:** "Each training export ships with a per-sample certificate: entity-class recall audited at a stated confidence level, and canary-echo measured before anything leaves the laptop."

---

## Ranked bets

1. **Amnesiac Corpus + compliance-complete adapter** (1+5 combined) — identity mechanism.
2. **Per-sample LTT leakage certificates** — the certification layer that makes bet 1 credible.
3. **Train the View** — substrate feature; graph-as-projection formalism borrowed for erasure precision.
4. Client-side WASM ER — capability, not novelty bet.

## THE recommended identity mechanism

**"Amnesiac Corpus"** — one-sentence claim: *Every training corpus is a deterministic, entity-indexed projection of your company's connection graph, so an erasure request provably regenerates the corpus minus that entity — and a fresh audited LoRA adapter trains on it in minutes — with zero data leaving the machine.*

Threads the pipeline: **capture** (deterministic parsers → raw spans with SHA-256 receipts) → **link** (sketch-ring + ER builds the entity/connection graph = the source of truth) → **certify** (LTT/e-process per-sample certificates + canary measurement) → **export** (corpora as typed graph projections, SFT JSONL, privacy-token masking) → **erase** (graph vertex deletion → deterministic corpus regeneration → seeded adapter retrain → new receipts; provably minimal byte diff).

The ablation/benchmark that would prove it: a synthetic multi-department estate (SQL+CSV+notes+transcripts, N≈10⁴ entities); issue deletion requests over k∈{1%, 5%, 20%} of entities and measure (a) byte-level diff between original and regenerated corpora (must equal exactly the erased spans + their projections); (b) adapter retrain wall-clock vs full retrain; (c) Carlini canary exposure pre/post retrain for canaries bound to erased entities (target: ≤ chance level); (d) per-sample certificate pass rate vs injected PII; benchmarked head-to-head against SISA and LoRA-approximate unlearning on the same erasure requests.

## Top rejection risks

1. **"Corpus deletion ≠ model erasure."** GDPR Art 17 plausibly covers personal data *in the model weights*. Mitigation: bundle deterministic adapter retrain; cite DurableUn (2605.02196) showing the alternative (approximate unlearning) is fragile under quantization.
2. **Redaction ≠ DP.** CLIOPATRA (2603.09781) attacked layered-redaction claims; LeakageBench shows localized redaction still leaks. Never claim "provable anonymity" — only certified detection recall + measured canary exposure.
3. **"ER/determinism is just engineering."** Reviewers may see no algorithmic novelty — position novelty at the system level (erasure semantics), not the components.
4. **GraphGen/EKG adjacency** — "KG→corpus is done" (2505.20416); respond that GraphGen synthesizes a fake KG from text while ours is the real graph as auditable truth.
5. **Determinism brittleness:** deterministic builds require identical kernel versions + source immutability; source drift breaks byte-identity guarantees — decide semantics for "corpus evolved since training".
6. **Buyer relevance:** does a mid-market buyer with an Art 17 duty buy "retrain in minutes on the laptop," or do they want it on a server (they do) — the client-side constraint narrows the buyer; keep the mechanism server-compatible.
