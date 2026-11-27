# Tiny Theme Linker: a 20-30 MB model that joins documents by theme, not identity

Date: 2026-11-26. Mode: deep-research `full` (RQ, architecture, literature, adversarial review). Status: research note, not a result. Every performance claim below is a **hypothesis to be measured** unless it cites a source.

## 1. Research question (FINER-scored)

**RQ.** Can a ≤30 MB (quantized) model, trained only on data Versieve can produce locally, decide that documents and media from different departments and modalities express the *same theme*, with an inspectable reason and a calibrated abstain, at accuracy competitive with a 20-100x larger general embedder or a local LLM judge?

| FINER | Assessment |
|---|---|
| Feasible | Yes: 26M (Needle) and 51M/22 MB (Mirage) show the size class is deployable; training recipe is small-model-friendly. |
| Interesting | Yes: it closes the gap the estate graph leaves open (identity is solved; "same subject matter" is not). |
| Novel | Partly; see §5 for the surviving conjunction. |
| Ethical | Zero-egress is preserved only if the teacher/labeler is local (see §6, risk R3). |
| Relevant | Direct fit with `perceiveMulti`, the dual-CSR entity graph, and relational sample composition. |

**Task definition (the key move).** "Linking" is three things; only one needs a model.

1. *Identity linking* (same person/org/ID). Already solved deterministically by the resolved entity graph. **The model must not spend capacity here.**
2. *Theme linking* (A is "about" THEME A, and so is a video in another department). **This is the model's job.**
3. *Reasoned linking* ("these two are one theme *given* these other documents"). Implemented as **context-set conditioning plus bounded graph hops**, not free-text chain-of-thought.

## 2. What the literature and the field say (verified sources only)

- **Size class is real.** Needle: 26M-param encoder-decoder, pure attention (no FFN), 200B-token pretrain + 2B-token distilled post-train, INT4 QAT, single-shot function calling; beats 270M-600M models on that narrow task but explicitly is weaker conversationally ([HF card](https://huggingface.co/Cactus-Compute/needle), [Cactus blog](https://cactuscompute.com/blog/needle)). Mirage: 51.3M params, ~21.6 MB at 2-bit, one pass multi-task vision ([Cactus blog](https://cactuscompute.com/blog/mirage)). Lesson: **tiny + narrow + distilled + quantization-aware** works; breadth does not.
- **Static embeddings are a strong cheap stage-0.** Model2Vec distills sentence encoders into static tables; `blink-8M` reaches ~99% of all-MiniLM-L6-v2's MTEB average while "orders of magnitude faster"; static retrieval models reach ~82% of MiniLM on retrieval ([Model2Vec results](https://github.com/MinishLab/model2vec/blob/main/results/README.md), [Minish](https://minish.ai/packages/model2vec/results/)). Use as candidate generator, not as the linker.
- **Cross-document linking is an established but entity/event-centric task.** xCoRe unifies long- and cross-document coreference (mention → in-context clusters → cross-context merge) ([EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1737/)); argument-centric causal intervention reduces over-reliance on trigger words in cross-document event coreference ([Sci. Reports 2025](https://www.nature.com/articles/s41598-025-32765-6)); CodRED gives cross-document relation reasoning paths ([thunlp/CodRED](https://github.com/thunlp/CodRED)); Re²-DocRED cleans DocRED annotation ([EACL 2026](https://github.com/klassessg/re2-docred)). These target *mentions of the same entity/event*, which is the "identity" half. **Theme-level, cross-modal, cross-department linking is not their target.**
- **"Similar" is under-specified; the aspect must be explicit.** AspectSim ([arXiv 2601.03435](https://ar5iv.labs.arxiv.org/html/2601.03435)) shows conditioning on a stated aspect raises human-machine agreement (reported ~80% over holistic with GPT-4o) and that **small (1B-class) open models still lag at aspect-conditioned semantics and over-extract instead of abstaining**. This is both our strongest motivation (holistic cosine is the wrong objective) and our strongest warning (a tiny model must be a trained specialist with a structured aspect, not a prompted generalist).
- **False negatives and hub bias poison contrastive training.** CrossCLR ([arXiv 2109.14910](https://ar5iv.labs.arxiv.org/html/2109.14910)) removes highly-connected "influential" samples from the negative set and reweights positives. Directly applicable: same-theme documents are *common* in an enterprise, so naive in-batch negatives will punish correct links.
- **In-repo prior art (must be reconciled, not re-derived):** relational sample composition and identity-contrastive SFT verdicts (`docs/2026-11-24-cross-document-knowledge-perception-upgrade-handoff.md`), the noisy-estate benchmark spec, LTT/HC-CRC conformal gatekeeping, `blast_radius`, `eraseEntity`. The "false-merge blast radius inverts" finding applies equally to theme merges.

## 3. Proposed approach: **identity-orthogonal, set-conditioned theme linker** (working name *Weft*)

### 3.1 Division of labor (the architectural novelty)
Graph resolves *who*; Weft resolves *what about*. Weft is trained so its representation carries **no usable identity signal**, so it cannot shortcut on names, project codes, or e-mail addresses, and so a wrong identity merge cannot silently become a wrong theme merge (and vice versa). Two independent evidence channels with an explicit agreement report is a stronger and more auditable link than one fused score.

### 3.2 Model
- Attention-only (Needle-style) or small standard encoder, **~20-35M params**, INT4/2-bit QAT → 10-25 MB. Ablate FFN vs no-FFN: Needle's no-FFN result is for tool calls; relatedness may need FFN capacity (open question, H4).
- Inputs: `[ANCHOR SET] [SEP] [CANDIDATE CHUNK]`. The anchor set is up to *k* exemplar chunks/summaries of an existing theme node (or a seed chunk). This is the "reasoning over additional context": the same candidate can link to a theme under one anchor set and not another (set-conditioned, the explicit-aspect idea of AspectSim made structural).
- Heads (all tiny): (a) link logit; (b) **extractive evidence pointers** (top spans in candidate and anchor, no generation, so the reason is verifiable and cheap); (c) theme-embedding for clustering; (d) conformal abstain using the existing LTT machinery.
- Modality-agnostic text interface: ASR transcript, slide text, table-row linearization, e-mail body, OCR text all enter as text with a 1-token modality tag; **modality dropout and ASR-noise augmentation** during training.

### 3.3 Training data (zero-egress, self-supervised from the estate)
Positives and negatives are **compiled from the resolved graph and structure**, not hand labeled:
1. *Identity-masked positives:* two chunks linked via graph neighbors (same thread, attachment, meeting↔minutes, ticket↔PR) with all resolved entity surface forms replaced by role tokens. Forces theme/semantic-role evidence.
2. *Identity-matched hard negatives:* same person/org, different theme (the same VP appears in budget and offsite docs). This is the signature negative and is only obtainable because the graph exists.
3. *Theme-matched, identity-disjoint positives:* different people/departments, shared topic, found by teacher agreement (below). The behavior we actually want.
4. *Cross-department / cross-modality splits:* never put both sides of a positive in the same department in the "easy" bucket; report per-bucket.
5. *Teacher distillation:* a **local** LLM judge (GPU already used for LoRA in this repo) labels a sampled pair set with an explicit aspect and a one-line rationale; Weft distills the label and span evidence. Needle's recipe used a hosted frontier teacher; here that would violate zero-egress on user data, so frontier teachers are allowed **only on public/synthetic corpora** (CodRED, Multi-News, WEC-Eng-style, synthetic estate), never on customer bytes.
6. *Loss:* contrastive with CrossCLR-style hub/false-negative handling + (a) **identity adversary** (gradient reversal against an entity-ID/type probe), (b) **triangle consistency** (A~B, B~C ⇒ A~C soft penalty) to make "counted as one" transitive, (c) **modality-invariance** term, (d) quantization-aware training from the start.

### 3.4 "Counted as one": theme nodes
Deterministic, incremental agglomeration over Weft's pairwise/set scores into **theme nodes**; each node stores member chunks, anchor exemplars, evidence spans, and the score distribution. Theme nodes enter the graph as typed nodes, so relational sample composition can traverse `chunk → theme → chunk` across departments. Theme assignment is a pure function of (corpus, model hash, policy version) so `eraseEntity`/receipt semantics extend naturally (re-derive and byte-diff).

### 3.5 Cascade
Stage 0 graph + BM25 + static embedding candidate generation → Stage 1 Weft pair/set scoring → Stage 2 theme-node clustering → Stage 3 abstain: route low-margin pairs to a larger local model or human. Weft only ever sees a shortlist, so its capacity is spent on the discrimination problem, not retrieval.

## 4. Hypotheses and falsifiers

| # | Hypothesis | Falsified if |
|---|---|---|
| H1 | Identity-orthogonal training improves cross-department theme F1 on identity-disjoint positives vs an identically sized baseline without the adversary. | No gain, or gain only on identity-overlapping pairs. |
| H2 | Identity probe accuracy on Weft embeddings falls near chance while link F1 holds. | Probe stays high, i.e. leakage. |
| H3 | Set-conditioning beats pair-only scoring on bridged themes (A and C only connect through B). | Equal or worse. |
| H4 | FFN-free is no worse than FFN at equal size for this task. | FFN variant wins materially. |
| H5 | Weft reaches ≥90% of a local LLM judge's pairwise F1 at ≤1/50 the latency and ≤30 MB. | Gap larger than 10 points. |
| H6 | Triangle consistency reduces false-merge blast radius vs no consistency term. | Blast radius unchanged. |
| H7 | Calibrated abstain keeps false-merge rate under α with usable coverage. | Coverage collapses at target α. |

## 5. Novelty assessment (claim discipline)

Taken or crowded (do **not** claim): cross-document coreference (xCoRe and predecessors), aspect-conditioned similarity (AspectSim), hard-negative handling in contrastive learning (CrossCLR and many), tiny distilled task models (Needle, Mirage), static embeddings (Model2Vec), graph-grounded SFT data (GraphGen/EmbGen per the in-repo verdict).

Plausibly ours, as a **conjunction** (claim only after the experiments in §6 pass): (1) *factorized linking*, a deterministic identity graph plus an identity-adversarial theme encoder, with an explicit disagreement report; (2) *graph-compiled supervision* where the **identity-matched, theme-different hard negative** and **identity-masked positive** are generated from the enterprise's own resolved graph with no human labels; (3) *set-conditioned, extractive-evidence, conformally-abstaining* linker small enough for the zero-egress WASM/ONNX distribution; (4) theme nodes as first-class graph citizens feeding relational composition. Each element alone is prior art; the unverified claim is that the conjunction beats simpler baselines. **A search for an existing identity-adversarial cross-modal enterprise theme linker has not been exhaustively done; re-run before any paper claim and read full texts, not abstracts.**

## 6. Risks and adversarial review (devil's advocate)

- **R1 Theme is subjective.** Ground truth for "same theme" is fuzzy; labeler disagreement bounds achievable F1. Mitigate with explicit aspect/anchor, report inter-annotator agreement, and use a graded label (same / related / different).
- **R2 Capacity.** AspectSim shows 1B-class models struggle with aspect semantics; 25M must lean on specialization, shortlists, and distillation. If H5 fails, fall back to Weft as a *reranker/filter* in front of a local LLM rather than a standalone linker.
- **R3 Teacher leakage / egress.** Frontier-LLM labeling of customer data breaks the product premise. Enforce: hosted teachers on public/synthetic data only.
- **R4 Identity adversary can hurt legitimate signal** (some themes *are* a person's project). Treat identity as a gated channel, report both channels, and measure the cost on identity-overlapping positives.
- **R5 False-merge blast radius** (already known in this repo): one bad theme merge contaminates all composed samples. Needs conservative thresholds, conformal control, and merge audit trail.
- **R6 Cluster drift / non-determinism.** Incremental clustering must be order-independent or canonically ordered to preserve deterministic corpus hashes.
- **R7 Benchmark mismatch.** Public sets (CodRED, WEC-Eng/ECB+-style, Multi-News) measure entity/event or topical linking, not cross-modal enterprise themes; the synthetic estate is construction-validation only. A small human-labeled real-ish eval is mandatory before external claims.

## 7. Evaluation plan

- **Data:** synthetic noisy estate (existing spec) + public sets for pretrain/sanity; add a hand-labeled cross-modal slice (docs ↔ transcripts ↔ slides ↔ e-mails).
- **Splits:** leave-one-department-out and leave-one-modality-out; identity-overlap vs identity-disjoint buckets.
- **Metrics:** pairwise P/R/F1; B-cubed and CoNLL-style cluster metrics for theme nodes; identity-probe accuracy (leakage); false-merge rate and blast radius; abstain coverage at target α; size (MB), latency, memory in WASM/ONNX.
- **Baselines:** BM25; static embedding (Model2Vec); all-MiniLM-L6-v2 cosine; BERTopic-style clustering; same-size Weft without adversary/set-conditioning/triangle loss; local LLM judge (upper reference).
- **Ablations:** each §3.3 loss term; FFN vs no-FFN; anchor-set size k; quantization level (2/3/4-bit).

## 8. Phasing with decision gates

1. **P0 (1-2 wks)** Baselines + eval harness + labeled slice. Gate: baselines reproduce; label agreement acceptable.
2. **P1** Train un-quantized ~25M specialist with graph-compiled pairs, no extras. Gate: beats static-embedding + MiniLM on identity-disjoint cross-department F1.
3. **P2** Add identity adversary, set-conditioning, triangle loss (one at a time). Gate: H1-H3, H6.
4. **P3** QAT to ≤30 MB, WASM/ONNX export, abstain calibration. Gate: H5, H7, size/latency.
5. **P4** Theme nodes into graph + composition integration; re-prove erasure. Gate: deterministic hash, erasure receipts hold.
6. **P5** Claim audit + literature re-check before any paper.

## 9. Vision addendum (founder, 2026-11-26): a public, general model, not only a Versieve component

Direction: release Weft openly as a standalone model for **theme recognition beyond the single document**, usable for learning and discovery, with Versieve as one consumer. Consequences:

**9.1 What changes**
- **Training data must be public and permissively licensed.** The graph-compiled supervision in §3.3 relies on a private resolved estate and cannot ship. Replace with public analogs of the same structure: hyperlink/citation/thread/co-reference-derived pairs (HyperCoref, WEC-Eng, ECB+ and the unified uCDCR compilation, [arXiv 2603.00621](https://ar5iv.labs.arxiv.org/html/2603.00621)), news clusters (Multi-News; its HF card lists license "other", **verify terms before redistribution**), Wikipedia/Wikinews/arXiv-style linked corpora, plus synthetic multi-modal "estates" generated by the repo's own generator. Licence audit of every source is a P0 gate for a public release.
- **R3 relaxes, new risk appears.** A hosted frontier teacher becomes acceptable *because the corpus is public*, the same recipe Needle used; the new risk is teacher-licence terms on distilled outputs and benchmark contamination.
- **Identity-orthogonality generalizes** into "topic over named entity": public data shows entity-name shortcutting is a known failure of event coreference (trigger-word over-reliance, see the Sci. Reports 2025 paper above), so the adversary/masking recipe is publishable independent of any enterprise.
- **Modalities:** a public model should not be tied to Versieve's parsers. Contract: *text in, optional modality tag*; ASR transcripts, OCR, captions, slide text all supported by augmentation, not by native audio/vision towers (which would blow the 30 MB budget).
- **Aspect interface:** free-text anchor sets (examples a user picks) are general and need no taxonomy; add an optional short natural-language aspect string, motivated by AspectSim.

**9.2 Landscape and the gap it targets**
- General small embedders exist and are strong: EmbeddingGemma 300M with int4/int8 QAT and Matryoshka truncation ([arXiv 2509.20354](https://ar5iv.labs.arxiv.org/html/2509.20354)); EmbeddingGemma 2 is natively multimodal at 740M, with a 270M text-only configuration ([Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/)); Model2Vec static models are far smaller ([results](https://github.com/MinishLab/model2vec/blob/main/results/README.md)). **None is below ~30 MB while also trained for identity-robust, set-conditioned theme judgments with abstention.** The wedge is *objective + interface + size*, not "another embedder". Weft's honest competitor is "EmbeddingGemma-int4 or Model2Vec plus a threshold"; if Weft cannot beat that on the identity-disjoint buckets it should not ship.
- Existing consumer tools do semantic note linking: e.g. Obsidian's Semantic Auto-Linker finds missing wiki-links from local embeddings, and its own docs say semantic suggestions are less reliable than deterministic title/alias matching and depend heavily on the embedding model ([plugin page](https://community.obsidian.md/plugins/semantic-auto-linker)). That is a concrete, user-visible pain point and a ready distribution channel (plugins, WASM in browser).

**9.3 Who is it for (use cases to validate before building more)**
1. *Learning and research:* "this lecture video, that paper, and my notes are the same concept", linking across formats a student or researcher already has.
2. *Personal/team knowledge bases:* suggesting theme links across notes, meeting transcripts, and docs, with the evidence spans as the explanation.
3. *Newsroom/analyst triage:* clustering reports, transcripts, and filings on one developing story.
4. *Data tooling:* deduplicating/grouping by theme when building corpora, where Versieve consumes it for relational composition.
Each needs a 10-person user check of whether *evidence spans plus abstain* is what they actually want versus plain similarity ranking (H8 below).

**9.4 Added hypotheses and release gates**
- H8: users prefer link suggestions with extractive evidence and abstain over a ranked similarity list (small user study; falsified if no preference or if abstention frustrates).
- H9: the identity-orthogonal recipe transfers to *public* data and beats size-matched baselines on a held-out public benchmark (WEC-Eng/ECB+ style, plus a newly released cross-modal theme set).
- Release gates: licence audit clean; model card with intended use, failure modes, and calibration plot; reproducible training script and data recipe; the new **theme-linking benchmark** (cross-department/modal, identity-disjoint buckets) released with it. A credible benchmark may be the more durable contribution than the model, so plan it as a first-class deliverable.
- Naming/positioning: avoid "perceive everything" and "atomic knowledge" framing (repo ruling); describe it as *theme linking across documents and modalities*.

## 9.5 Decisions and answers (2026-11-26, follow-up)

1. **Abstain vs deterministic: both, at different layers.** Inference is a fixed function (same inputs, same weights, same version → same output; this is what hashes and erasure need). The *decision* is probabilistic with a calibrated abstain. A pure deterministic rule cannot judge "same theme"; forcing a yes/no on every pair is exactly what produces false merges. Abstained pairs stay unlinked (safe default) and go to review.
2. **Whole documents are not fed to the model.** Documents are split into chunks (about 128-256 tokens) upstream, after extraction. Weft links *chunks*; a document-to-document link is an aggregate (e.g. best-k chunk pairs plus evidence spans). A theme node holds chunks, not whole files. This is why 20-30 MB is plausible.
3. **Licences (verified from Hugging Face model metadata and GitHub API, not from the full legal text):** Needle weights MIT; Mirage weights Apache-2.0; Cactus engine Apache-2.0. All permit commercial use and fine-tuning with attribution. Needle's repo now describes a "Needle 3" (2-bit, 8-29 MB, includes embeddings); its licence was **not** verified, check before using it as a base. The Needle 1 card says dataset generation code is open.
4. **Dataset: you do not need your own.** Build it from public sources plus synthesis:
   - Linked public text: Wikipedia articles linked by category/hyperlink (CC BY-SA, share-alike applies to derived data), HyperCoref/WEC-Eng/ECB+ (uCDCR compilation), Multi-News (licence unclear, audit).
   - Synthetic multi-format "estates": prompt an **open-weight, permissively licensed LLM** (verify each model's licence, and avoid hosted-model terms that forbid training competitors) to write the same theme as an e-mail, meeting transcript, slide outline, table, and ticket from different "departments", with controlled identity overlap. This yields identity-masked positives, identity-matched hard negatives, and identity-disjoint positives for free, with known labels.
   - Cross-modal noise: simulate ASR errors, OCR errors and slide fragmentation on text instead of collecting audio/video.
   - Start small: ~50-100k labeled pairs is enough for a first specialist; a few hundred hand-checked pairs for evaluation only.
   - Start from an existing small open encoder (or Needle's recipe) rather than pretraining.

## 10. Open questions for the founder

1. Is a theme-link allowed to be *probabilistic with abstain*, or must it be deterministic like the graph? (Public model: recommend probabilistic with calibrated abstain.)
2. Anchor-set only, or also an optional aspect string? (Recommend both, anchor set required.)
3. Licence for weights and benchmark (Apache-2.0 for weights is the field norm; dataset licence depends on source audit).
4. Where does training compute come from (Needle used 16 TPUs for ~27 h pretraining; a 25M specialist initialized from an existing small encoder or distilled from a larger embedder is far cheaper and is the recommended starting point instead of pretraining from scratch)?
