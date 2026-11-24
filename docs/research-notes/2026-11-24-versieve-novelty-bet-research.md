# Versieve Novelty-Bet Research (2026-11-24)

Research verdict on where Versieve's "SR-SWA moment" is. All citations below were verified
against arxiv.org directly (abstract pages or the arXiv export API). Several citations surfaced
by web-search summaries **failed verification and are explicitly flagged as unverified**; they are
not used as evidence. Unverifiable prior art is treated as a risk, not as a citation.

---

## 1. Anatomy of the Unlimited-OCR leverage moment

### 1.1 The actual papers (verified)

| Paper | arXiv ID | Date | Mechanism named | Core claim |
|---|---|---|---|---|
| **Unlimited OCR** (Baidu; repo `github.com/baidu/Unlimited-OCR`, MIT, ~32.6k stars) | [2606.23050](https://arxiv.org/abs/2606.23050) | 2026-06-22 | **R-SWA** — "Reference Sliding Window Attention" | Replaces *every* decoder attention layer with R-SWA; constant KV cache for the entire decoding run; transcribes dozens of pages in one pass under a 32K window; built on DeepSeek-OCR; claims generality to ASR/translation |
| **Unlimited OCR Works 2** | [2610.39308](https://arxiv.org/abs/2610.39308) | 2026-10-29 | **SR-SWA** — "Sparse Reference Sliding Window Attention" | Caps *active reference tokens* at a fixed capacity in all decoder attention modules so per-step cost is constant for arbitrarily long documents; 7.0× per-step speedup over Full Attention, 5.6× over R-SWA at hundred-page scale; introduces **MarathonDocBench** (hundred-page parsing), plus MPDocBench |

Lineage note: the founder's memory compresses two papers into one. R-SWA (part 1, Jun 2026)
established the fixed-KV-cache decoder; SR-SWA (part 2, Oct 2026) is the named mechanism that
became the identity. Also verified in the lineage:
[DeepSeek-OCR: Contexts Optical Compression, arXiv:2510.18234](https://arxiv.org/abs/2510.18234)
(the base system Unlimited OCR replaced attention layers in), and
[DeepSeek-OCR 2: Visual Causal Flow, arXiv:2601.20552](https://arxiv.org/abs/2601.20552).

### 1.2 Why SR-SWA landed (the recipe)

Derived from the verified abstracts and repo:

1. **A constraint everyone feels but nobody names.** "Multi-page document degradation" was a
   known symptom (VLMs falling off after a few pages), but no one had compressed it into a
   falsifiable enemy: *per-step decoding cost grows with document length*. Naming the enemy is
   half the paper.
2. **A mechanism whose full content fits in one sentence and one afternoon of implementation.**
   "Cap the active reference set at N tokens, attend through a sliding window." No new math, no
   new training objective. The name maps 1:1 onto the design decisions
   (Sparse-Reference = capped reference set; Sliding-Window = bounded window; both words are
   load-bearing, neither is decoration).
3. **A constant, not an average.** The claim is *"constant memory / constant per-step cost,
   regardless of length"* — an O(1) statement. O(1) claims beat X%-better claims because they
   are a category ("impossible → now bounded"), not a ranking.
4. **Beats the simplest strawman, not just SOTA.** Head-to-head 7.0× vs **Full Attention** and
   5.6× vs their own **R-SWA**. Ablating against the naive alternative is what converts an
   engineering choice into a mechanism.
5. **Own the arena.** MarathonDocBench (hundred-page) exists because the prior benchmarks could
   not even express the regime the mechanism unlocks. The benchmark and the mechanism are one
   argument.
6. **Regime naming.** "OCR 3.0", "unbounded document parsing", "human working memory" analogy —
   the mechanism is framed as a *regime transition*, which press and reviewers repeat verbatim.
7. **Generality gesture.** R-SWA claims ASR/translation applicability in part 1's abstract —
   one sentence that doubles the mechanism's TAM at zero cost.

**Recipe distilled:** `[O(1)-flavored named mechanism] + [unbounded-feeling constraint given a
name] + [constant-cost claim + strawman ablation (naive alternative, own prior mechanism)] +
[benchmark only your mechanism can pass] + [one-sentence generality gesture]`.

---

## 2. Prior-art scan per candidate bet

Verification method: every cited paper below was confirmed on its arXiv abstract page or via the
arXiv export API. Where a claimed paper could not be verified, it is marked **UNVERIFIED**.

### (a) Privacy-native perception co-design — "perceive everything, provably leak nothing"

**Verdict: the halves all exist; the coupling does not. Partially alive.**

Verified adjacent prior art:

- **Conformal prediction × scene graphs exists.**
  [arXiv:2503.13947](https://arxiv.org/abs/2503.13947) — "Conformal Prediction and MLLM aided
  Uncertainty Quantification in Scene Graph Generation" (2025-03). Calibrated prediction sets for
  SGG, MLLM selects plausible graphs. This kills the naive claim "first conformal scene graph".
  It is about *quality* uncertainty of graphs, not *privacy/leakage certificates*.
- **Conformal object detection exists.**
  [arXiv:2505.24038](https://arxiv.org/abs/2505.24038) — "Conformal Object Detection by Sequential
  Risk Control" (2025-05). Same distinction: risk on detection quality, not on non-leakage.
- **Privacy mediation in a perception pipeline exists (the closest enemy).**
  [arXiv:2609.34027](https://arxiv.org/abs/2609.34027) — "PerceptFence: Content-Mediation
  Architecture and Deterministic Coverage for Screen-Share AI Assistants" (2026-09). Screens
  screen/speech streams for PII before an assistant ingests them; beats Presidio on their
  fixtures (0.918 vs 0.581 on OCR-surviving secrets; Wilson CI only). Critically: **no conformal
  prediction, no formal guarantee** ("deterministic coverage" is an empirical measurement with
  stated boundaries), no scene graph, no local/browser artifact (live capture explicitly absent).
  This is the paper a reviewer will wave at Versieve. It blocks any claim of "first perception-
  mediated redaction". It does *not* block certified (statistical-guarantee) perception.
- **Speech PII redaction exists as a systems field.**
  [arXiv:2303.09438](https://arxiv.org/abs/2303.09438) — "Trustera: A Live Conversation Redaction
  System" (2023-03); [arXiv:2610.39754](https://arxiv.org/abs/2610.39754) — "Toward Complete
  Speaker Anonymization: a Streaming Cascaded System for Voice Privacy and PII Removal"
  (2026-10); [arXiv:2604.17000](https://arxiv.org/abs/2604.17000) — utility-preserved speech
  anonymization (2026-04). None couple to a scene graph or carry certificates.
- **De-identification as benchmark culture exists.**
  [arXiv:2507.23608](https://arxiv.org/abs/2507.23608) — "Medical Image De-Identification
  Benchmark Challenge" (2025-07, HIPAA/DICOM-aligned). Confirms that redaction-benchmarks are
  a recognized frame we can plug into.
- **UNVERIFIED:** a web-search summary claimed a Microsoft paper "C-P3L: Safe Text Sanitization
  via Conformal Prediction with LLMs" (arXiv 2406.01098). **That arXiv ID is a different paper**
  (decision trees / algorithmic recourse). Title search, API search and web search return nothing
  called "C-P3L". Treat this as possibly-fabricated; if it exists, it would partially block
  "conformal × PII redaction" on text. Another summary claim (arXiv 2311.11191, "Conformal
  Prediction Sets Detecting Privacy Leakage") also failed verification — the real 2311.11191 is
  an adversarial-vision paper. **Same failure class was repeated across five other IDs
  (2505.18041, 2503.11229, 2506.09918, 2504.20315, 2502.15477 — all returned unrelated papers;
  e.g. 2505.18041 is gamma-ray-burst astrophysics)**. There is no verified arXiv record of a
  "privacy-preserving scene graph generation with PII redaction" paper.

**What remains unclaimed:** a perception engine whose *output itself* (scene-graph nodes/edges)
carries per-element finite-sample non-leakage certificates, where the same bounded-memory
structure used for entity persistence is also the redaction decision mechanism. Zero verified
hits on "conformal × redaction" (arXiv full-text abs query returned only irrelevant results),
zero on "queryable document scene graph", and PerceptFence explicitly disclaims formal
guarantees.

### (b) O(1)-memory cross-modal entity persistence (SR-MP as a first-class primitive)

**Verdict: most clearly unclaimed. Alive, with a framing risk.**

- arXiv abs query `streaming × coreference` (sorted by recency) returned essentially two items,
  neither close: [arXiv:2305.07565](https://arxiv.org/abs/2305.07565) — a rehearsal/anticipation
  memory model for QA from streaming text+video (2023-05, not O(1), not entity-persistence as a
  primitive); and an interpretability paper (indirect object identification circuits).
- Bloom-filter × entity work exists only in **record linkage** (privacy-preserving record linkage
  via Bloom filters: [arXiv:1612.08835](https://arxiv.org/abs/1612.08835) 2016,
  [arXiv:2206.15089](https://arxiv.org/abs/2206.15089) 2022) — batch, cryptographic, not
  streaming perception.
- The constant-memory *visual* analog exists for frames, not entities:
  [arXiv:2610.16118](https://arxiv.org/abs/2610.16118) — "Elephant in the Fridge: Constant-Memory
  Frame Packing" (NeurIPS 2026) packs variable frames into a fixed token budget with **no formal
  guarantee** ("in theory" arbitrary length, empirical instantiation).

**Risk:** without the right framing, reviewers read "512-slot salted sketch ring" as "a Bloom
filter, renamed". The bet only lives if (i) there is a *falsifiable bound* (bounded
false-merge/false-split rate for cross-modal entity identity), and (ii) an ablation showing why
a plain Bloom filter or unbounded dictionary fails at the same byte budget, and (iii) an
entity-consistency metric on an unbounded stream that O(n) baselines physically cannot keep
constant. It also cannot be a stand-alone paper at a major venue as pure engineering; it needs
the certificate story (a) to carry it.

### (c) "Perception as deterministic compilation"

**Verdict: philosophically right, dead as a novelty bet.**

- The combination "queryable × document × scene graph" (arXiv abs query) returns **zero** results.
  But the *space* is heavily industrialized and LLM-pipeline-dominated, which makes the framing
  ("we compile files into one typed graph") indistinguishable from what IBM Docling already
  markets (verified: `github.com/docling-project/docling` — unified DoclingDocument
  representation, lossless JSON, local/air-gapped execution; no provenance claims) and from
  current KG-construction work:
  [arXiv:2611.27835](https://arxiv.org/abs/2611.27835) — auditable, schema-driven financial KGs
  with traceable construction (2026-11);
  [arXiv:2508.17906](https://arxiv.org/abs/2508.17906) — FinReflectKG (2025-08);
  [arXiv:2208.11168](https://arxiv.org/abs/2208.11168) — Doc2Graph (GNN-based, task-agnostic,
  2022) — learning-based, so different, but owns the name space.
- A deterministic, no-LLM-in-loop, diffable graph is a *property* that reviewers will credit as
  a design constraint, not as a contribution. Use it as the substrate that makes (a)+(b)
  possible and as a reproducibility selling point, not as the paper's identity.

### (d) Byte-budget active perception with submodular triage

**Verdict: mechanism space is red-hot and crowded — dead as the identity, alive as a constraint.**

arXiv `keyframe selection × video`, sorted by recency, returned **25 papers in 2026 alone**,
including:
[2611.10609](https://arxiv.org/abs/2611.10609) (hypothesis-guided selection, 2026-11),
[2610.19127](https://arxiv.org/abs/2610.19127) (AdaFrame, adaptive info budgets, 2026-10),
[2610.16118](https://arxiv.org/abs/2610.16118) (constant-memory packing, NeurIPS 2026),
[2610.00573](https://arxiv.org/abs/2610.00573) (FORTE, *exact* keyframe selection, 2026-09),
[2609.15408](https://arxiv.org/abs/2609.15408) (MarKey, marginal-utility greedy — effectively
submodular greedy, 2026-09),
[2609.13250](https://arxiv.org/abs/2609.13250) (plug-and-play selector evaluation, 2026-09).
A "more submodular frame selection" paper is desk-reject territory; "greedy with guarantees"
exists (MarKey and FORTE). The genuinely unclaimed sliver is the **byte-budget certification**
angle: "capability-per-byte certificates" (what coverage does a ≤215 KB kernel provably achieve)
— no verified prior work states perception capability as a function of a hard binary-size
budget. But that reads as MLSys systems work, i.e., fold it into the primary bet as the
constraint, not the thesis.

### (e) The unclaimed intersection (local WASM-certified perception + privacy)

**Verdict: the timing supports Versieve, and nobody is standing on the exact coordinate.**

Verified landscape signals:
- In-browser local inference is a recognized research direction:
  [arXiv:2412.15803](https://arxiv.org/abs/2412.15803) (WebLLM, 2024-12);
  [arXiv:2608.28950](https://arxiv.org/abs/2608.28950) ("The Web-CLI: Verifiable Privacy for
  Tools, Models, and Inference Engines in the Browser", 2026-08) — proposes zero-install,
  locally-executing browser apps for tools/models; closest in *spirit*, but it is an
  architecture position paper, not perception-with-certificates.
- On-device/WASM privacy engineering:
  [arXiv:2310.09252](https://arxiv.org/abs/2310.09252) (Wasm-iCARE, on-device risk models,
  2023-10); [arXiv:2306.13388](https://arxiv.org/abs/2306.13388) (client-side WASM for EFail
  prevention, 2023-06).
- The venue signal: PerceptFence (2609.34027) shows cs.CR will peer-review
  "perception-mediated redaction with empirical coverage" right now — and it left the formal
  guarantee entirely on the table, which is exactly the open flank.

---

## 3. Verdict and recommended bet

### Rankings (novelty × feasibility × story-clarity)

| Bet | Novelty (verified prior art) | Feasibility in this repo | Story clarity | Rank |
|---|---|---|---|---|
| (a) Certified perception co-design | High: halves exist, coupling doesn't; PerceptFence leaves guarantees unclaimed | High: LTT gatekeeper + SR-MP already exist | Excellent | **1 — primary** |
| (b) O(1) entity persistence | Highest raw novelty on arXiv; framing risk ("just a Bloom filter") | Highest (already built) | Good, needs the bound to avoid "just a sketch" | **2 — secondary** |
| (e) Web-certified intersection | High narrative, thin as a *technical* contribution (venue positioning, not a mechanism) | n/a | Good for intro/positioning | use as framing |
| (c) Deterministic compilation | Low as contribution (Docling et al. industrialize it) | Done | Honest but "engineering" | 4 — substrate |
| (d) Byte-budget submodular triage | Low (25-paper pile-up in 2026) | Done | Reads as one more selector | 5 — constraint only |

### Primary bet: **Leakage-Certified Perception** (proposed name: **CGL — Certificated Gatekeeped Leakage**, or cleaner: **"Certified Scene Graphs" / "Gatekeeper Perception"**)

Recommended crisp name, following the SR-SWA naming recipe (each word load-bearing, ≤ 4 words):
**CertiSight** is too product-y; the academic-safe name is
**"Leakage-Certified Scene Perception (LCSP)"** with the mechanism named
**"Sketch-Gated Certification (SGC)"** — the SR-MP ring and the LTT gatekeeper fused into one
named primitive.

**One-sentence claim:**
> Every element of an omnimodal scene graph — text spans, diarized speakers, chart series,
> image regions — is emitted with a finite-sample non-leakage certificate computed by the same
> O(1)-memory sketch that persists entity identity, in a <500 KB zero-egress kernel, the first
> perception engine whose output carries its own redaction guarantee.

**The crisp constraint (the named enemy):** *leakage-in-perception* — every existing perception
(or mediation) pipeline decides "sensitive or not" with point estimates, so its failure mode is
silent (PerceptFence scores 0.828 on one PII family and only 0.154 on others; Presidio
inverts on another; nobody bounds the miss rate). No system emits a per-element statistical
bound on "probability a sensitive span passed unredacted".

**Measurable claim:** on a stress corpus (N-page documents + T-hour diarized audio + M image
charts, e.g., Marathon-style hundred-page plus multi-hour streams): (i) controlled leakage —
empirical sensitive-miss rate ≤ ε with a finite-sample LTT-style certificate (calibration on
held-out adversarial fixtures, the PerceptFence oracle methodology is reusable); (ii) O(1)
memory — fixed 16 KB ring regardless of stream length; (iii) entity consistency — cross-modal
entity-link consistency ≥ baseline at equal budget; (iv) capability-per-byte — certify coverage
at each byte budget, giving the "frontier" curve.

**The ablation that proves it (SR-SWA recipe step 4):**
1. **LCSP full** vs **gatekeeper off** (raw GLiNER/regex point estimates): recall inflates,
   leakage unbounded — shows certificates trade bounded utility for bounded leakage.
2. **SR-MP ring** vs **plain Bloom filter (same capacity)** vs **unbounded dictionary**: false-
   merge and entity-split rates across stream length — shows the salted reference structure is
   not "just a Bloom filter" and not "just a dict".
3. **Byte-budget sweep** (50/100/215/500 KB): coverage-per-byte frontier vs Full pipeline — the
   O(1)-flavored constant claim.

**Baselines it must beat:** (1) **Microsoft Presidio** (+DOCX/OCR/text) — and note PerceptFence
already reports Presidio at 0.581 on OCR-surviving secrets, so beating Presidio at certificate
strength, not just F1, is the bar; (2) **PerceptFence-style rule mediation** (2609.34027) —
match its 0.9-class empirical coverage *and add* what it disclaims: a distribution-free
bound; (3) **unconstrained cloud pipeline** (GLiNER/LLM + O(n) full coreference) — equal or
better entity consistency at O(1) memory and zero egress.

**Brutally-honest rejection risks:**
- If certificates cover only text-NER, this is "conformal NER, again" and gets rejected as
  incremental (SGG-conformal and object-detection-conformal already exist: 2503.13947,
  2505.24038). The certificates **must** extend to diarized speakers, chart series, and
  cross-modal merged entities — that is where no prior art exists.
- "Conformal-style finite-sample bounds" must be real LTT-risk-control math on a *leakage loss*
  (per-element miss of a sensitive span), not a Wilson interval dressed up — PerceptFence used
  Wilson CIs and a reviewer will hold Versieve to the higher standard.
- Fixture-based evaluation ("adversarial strings we wrote") will be attacked as synthetic;
  need at least one real-corpus measurement (e.g., the medical de-id benchmark culture,
  2507.23608, or public OCR-surviving secrets screens) to survive review.
- The "same sketch does double duty" claim must be shown to *matter* (ablation 2), or it reads
  as one structure pressed into two jobs for narrative reasons.

### Secondary bet: **Reference Sketch Ring as a named mechanism in its own right**

If the primary bet turns out to be too thin on real-corpus evaluation this quarter, the
fallback is the mechanism paper: **"Sketch-Referenced Entity Memory (SREM)"** — constant-memory
cross-modal entity persistence for unbounded streams, with a bounded false-merge guarantee and
the SR-SWA framing (bounded reference set standing in for unbounded history). Its unsolved-
looking constraint: *entity identity across an unbounded multimodal stream at strictly constant
memory* — no verified prior art (streaming-coreference scan is nearly empty; Bloom-filter prior
art is batch record linkage). Risk: it is a *component* paper and needs the venue to accept an
O(1)-memory perception primitive as the contribution; it is stronger as the mechanism chapter
inside the primary-bet paper.

---

## Appendix: verification ledger

Papers verified on arxiv.org or via arXiv export API:
2606.23050, 2610.39308, 2510.18234, 2601.20552, 2503.13947, 2505.24038, 2609.34027,
2303.09438, 2610.39754, 2604.17000, 2507.23608, 2305.07565, 1612.08835, 2206.15089,
2610.16118, 2611.27835, 2508.17906, 2208.11168, 2611.10609, 2610.19127, 2610.00573,
2609.15408, 2609.13250, 2412.15803, 2608.28950, 2310.09252, 2306.13388, 2110.01052
(Learn-Then-Test title search), 2208.11168.
GitHub repos verified: `baidu/Unlimited-OCR`, `docling-project/docling`.

Claims surfaced by web-search summaries that FAILED verification (do not cite):
"Privacy-Preserving Scene Graph Generation" as arXiv 2505.18041 (actually a GRB astrophysics
paper); "RedactGraph" 2503.11229; "Multimodal PII Detection in Scene Graphs" 2506.09918;
"DP Scene Graph Generation" 2504.20315; "Survey on Privacy in Multimodal Foundation Models"
2502.15477; "CPMI" 2311.11191 (actually adversarial-vision); "C-P3L" 2406.01098 (actually
algorithmic recourse); "Learn then Test" at 2209.15295 (actually an X-ray detector paper;
LTT is 2110.01052 per title search).
