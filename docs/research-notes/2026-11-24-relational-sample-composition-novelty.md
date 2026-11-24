# Relational sample composition novelty research — "the join is the training unit" (2026-11-24)

Mechanism-level novelty assessment for the third claim variant: **relational sample composition** —
sample boundaries follow the resolved entity graph, not byte position. This is the upgrade beyond
the per-block entity-indexed corpus already shipped in `src/amnesiac-corpus.js`
(`buildAmnesiacCorpus`: one sample per extracted block, each with masked text, vault-salted entity
IDs, byte-range provenance, per-sample certificate; `eraseEntity` regenerates with a byte-diff of
exactly that entity's spans). Builds on and does not repeat
`2026-11-24-graph-grounded-corpus-novelty-research.md` (the sample-schema bet), the market note,
and the novelty-bet note.

Citation method note (binding): every arXiv ID marked **[pinned]** in section 6 was confirmed this
session on `arxiv.org/abs/<ID>` or via the arXiv export API (`export.arxiv.org/api/query`) —
title and first author read directly. Twelve snippet-surfaced IDs failed verification **this
session** and are listed in the rejected-fabrications ledger; none were used as evidence. The
export API also rate-limited (HTTP 429) mid-session, so seed IDs were resolved through OpenAlex
and then independently confirmed on the abs page; a candidate ID from any source was accepted only
after abs-page confirmation.

---

## 1. The claim, in one paragraph

The current Amnesiac Corpus is entity-*indexed* but positionally *segmented*: a training sample is
one extracted block, because the block is where text was found — the unit is still a positional
chunk that happens to carry entity IDs. Relational sample composition replaces the segmentation
rule with the graph: the corpus builder traverses the resolved entity graph and emits **composed
samples** — for each entity (or entity-pair, or cross-document fact), one SFT sample that renders
all cross-document evidence about it: a SQL row's text + an email signature + a VTT utterance + a
deck bullet about the same entity, all masked, with a multi-source provenance list enumerating
every contributing document and byte range. Cross-document facts become within-sample facts. The
corpus remains a deterministic pure function of (real source bytes, view, engine version) — no
synthetic generation, no LLM in the loop, zero egress — and erasure receipts survive (deleting an
entity retracts exactly its samples/spans). The pitch: training samples whose boundaries follow
knowledge structure, so the join **is** the training unit.

## 2. Prior-art map

For each work: what it does / what it lacks / distance. The discriminating question throughout:
*does anyone deterministically compose training samples by traversing a resolved entity graph over
the actual source bytes of multiple heterogeneous documents, with provenance?*

### (a) Entity knowledge in LM parameters (architecture line — the "entity-centric" vocabulary)

- **Entities as Experts (EAE)** (arXiv:2004.07202, pinned — Févry et al.) — sparse entity memory
  inside the LM; entity representations learned from text, entity linking trained jointly with
  masked-LM. What it lacks: it changes the **model**, not the **data** — the corpus is ordinary
  (entity-linked text; boundaries are positional); no multi-document composition, no provenance,
  no determinism/erasure story. Distance: same goal (capture declarative entity knowledge in a
  small model), orthogonal mechanism (architecture vs sample composition).
- **GENRE** (arXiv:2010.00904, pinned — De Cao et al.) — autoregressive entity *retrieval* by
  generating names. Retrieval-time mechanism; no corpus construction at all.
- **KnowBERT** (arXiv:1909.04164, pinned — Peters et al.), **ERNIE** (arXiv:1905.07129, pinned —
  Zhang et al.), **KEPLER** (arXiv:1911.06136, pinned — Wang et al.), **K-Adapter**
  (arXiv:2002.01808, pinned), **E-BERT** (arXiv:1911.03681, pinned — Poerner et al.) —
  knowledge-enhanced pretraining as **model objectives** over Wikipedia/KB data. KEPLER's closest
  element: relation facts become *training instances* alongside LM text — but the instances are
  verbalized/encoded KG triples and entity descriptions from a public encyclopedia KB, not the
  enterprise's own heterogeneous bytes; no entity-neighborhood rendering of real multi-document
  text, no per-sample provenance, no erasure. Distance: family is crowded for the *idea* "put
  entities into the LM"; empty for the *mechanism* "compose the enterprise's real bytes around
  each resolved entity as the SFT unit."
- **Multi-News** (arXiv:1906.01749, pinned) and the multi-document summarization family
  generally. **Structurally the closest real-byte precedent**: the training unit (source, summary)
  is composed from *multiple real documents about the same event/topic* — sample boundaries follow
  topical structure, not position. What it lacks: grouping is by topic/event cluster, not by
  resolved entity identity (no ER, no canonical IDs); targets are LLM/human-written summaries
  (synthetic), not rendered source evidence; no masking-as-PII-control, no per-sample provenance
  fields, no determinism/erasure machinery; news-domain only, single modality. Distance:
  *nearest relative on "multi-document composition as the unit"; far on identity, receipts, and
  the closed-book-knowledge purpose.*

### (b) KG-grounded or entity-structured synthetic SFT data (the "graph-grounded data" vocabulary — the crowded direction)

- **GraphGen** (arXiv:2505.20416, re-pinned this session — Chen et al.): builds a KG from source
  text, samples **multi-hop neighborhoods**, and *generates* new QA pairs (atomic/aggregated/
  multi-hop) targeting knowledge gaps. The neighborhood-sampling element is genuinely adjacent to
  "traverse the entity graph." What it lacks: the samples are **LLM-synthesized text** — grounding
  is lost determinism, provenance, and the byte-exact erasure story at a stroke; no source-byte
  provenance on the produced sample; no masking/certificates. As before (prior note, section 2a),
  the direction is reversed: GraphGen's graph drives generation; ours drives **selection of the
  actual bytes**, keeping the corpus a pure function of inputs. It remains the closest single
  prior art and must be confronted by name — its "multi-hop neighborhood sampling" sentence means
  we cannot claim graph-traversal-as-selection-priority as novel, only the *composition of real
  bytes with receipts*.
- **KELM** (arXiv:2010.12688, pinned — Agarwal et al.): verbalizes Wikidata subgraphs to augment
  T5 pretraining corpus. Fully synthetic verbalization, public KB, no provenance, no erasure.
- **EmbGen** (arXiv:2605.19394, pinned — verified on abs this session): the only 2026 work in the
  GraphGen citation graph (27 citing works checked via OpenAlex) whose abstract mentions
  *reassembling*: it "decomposes a corpus into entity-description pairs" and "reassembles them
  using semantic structure inferred from embedding similarity," then generates QA pairs. What it
  lacks: grouping structure is **embedding clusters, not a resolved entity graph** (no canonical
  identity, so no erasure semantics at all); the output units are **generated QA pairs**, not
  composed real spans; no provenance/certificates/determinism. This is the nearest *structural*
  neighbor found anywhere and is a 2026 paper — the seam is being approached, which raises the
  urgency of shipping.
- The rest of the GraphGen citation graph (GRADS, CURE, SAGE, ProtSynGen, Easy Dataset, SPA
  (arXiv:2603.22213, pinned), CoreAnchor-QA, MedXIAOHE, …): every one is a *synthetic data
  synthesis* pipeline with graph/prompt/mine steering. Confirms section (b) is a **actively
  occupied neighborhood growing outward from GraphGen** — but occupancy is on the "synthesize new
  text" side of the line we draw (real bytes, deterministic, provenance-bound).

### (c) Retrieval-composition training (Atlas / REPLUG / KILT)

- **Atlas** (arXiv:2208.03299, pinned — Izacard et al.) and **REPLUG** (arXiv:2301.12652, pinned —
  Shi et al.): retrieval results *condition* training (Atlas distills retrieval into frozen LM
  weights; REPLUG trains via retrieval-augmented likelihood). What it lacks: retrieved context is
  a **runtime conditioning device**, not a persisted, provenance-carrying, regenerable data
  artifact; samples are ordinary (query, target) pairs; no entity structure, no certificates, no
  erasure. Distance: the mechanism class "multiple documents about an entity in one context" is
  exercised here only as an input side-channel; we make it the *data product* itself.
- **KILT** (arXiv:2009.02252, pinned — Petroni et al.): holds the "knowledge-intensive task +
  provenance as graded output" vocabulary; KILT systems that generate provenance produce
  evidence-span-grounded outputs over Wikipedia. Lacks: it is an evaluation benchmark and task
  family, not a corpus-construction mechanism; provenance attaches to *predicted* outputs, not to
  composed training samples; no enterprise heterogeneity, no masking, no erasure.

### (d) Data-centric corpora (the provenance state of the art)

- **Dolma** (arXiv:2402.00159, pinned — Soldaini et al.), FineWeb (prior note, pinned), DataComp-LM
  (prior note): provenance at document/pipeline grain, filtering/dedup as curation. Lacks: no
  entity identity, no multi-document composition into single samples (Dolma's dedup is
  line/document level; best-fit packing (arXiv:2404.10830, pinned) packs documents for
  *truncation efficiency*, explicitly without content-aware structure — a useful citation for
  "packing exists, entity-structured packing does not"). Distance: the corpus-construction field
  measures its units in tokens and documents; nothing found composes units around entity
  structure.

### (e) KG-paired text datasets

- **WikiGraphs** (arXiv:2107.09556, pinned — Wang, Gralie et al.? first author Luyu Wang verified):
  pairs Wikipedia articles with their local KG subgraphs for graph-conditioned generation.
  Lacks: pairing, not composition (the text sample is pre-existing single-document prose); public
  encyclopedia; no masking/provenance/erasure. Useful as the honest citation for "text + local
  subgraph pairing is known."

**Bottom line of the map:** the vocabulary around the mechanism is heavily occupied
(entity-centric pretraining, KG-grounded SFT data, neighborhood sampling, text+graph pairing), and
2026 synthesis pipelines are actively expanding (EmbGen). But every found artifact either (i) keeps
positional boundaries and adds entity metadata (today's Amnesiac Corpus, the schema bet), (ii)
synthesizes new text from graph structure (GraphGen, KELM, EmbGen and the whole citation graph),
or (iii) composes multiple real documents but by topic/event with synthetic targets (Multi-News
family). No found artifact composes **actual source bytes from multiple heterogeneous documents
into one deterministic, provenance-carrying training sample selected by traversing a resolved
entity graph**. 27 checks of GraphGen's citation graph plus the targeted searches (sections 5–6)
found none.

## 3. Verdict

**NOVEL as a mechanism; partially crowded as a vocabulary.**

| Element | Novelty | Why |
|---|---|---|
| Composed samples: boundary rule = entity graph, not byte position; cross-document facts become within-sample facts over real bytes | **Novel** | The three structural relatives all fall short on exactly one decisive axis: GraphGen/EmbGen/KELM synthesize text (grounding of real bytes lost); Multi-News composes real docs but by topic with synthetic targets and no identity; EAE/KEPLER change the objective, not the unit. No found artifact combines (multi-document real bytes) + (resolved-entity selection) + (determinism) + (per-sample provenance) in one training unit. |
| Entity-pair / cross-document-fact as the unit (pair-keyed samples) | **Novel** (as far as searched) | DocRED/SciCo (prior note) *annotate* cross-document relations for evaluation; nothing emits pair-keyed SFT samples. Weak prior art makes this the most exposed surface — treat as high-risk/high-value. |
| Determinism + zero-synthesis + erasure receipts carried through the composition | **Novel by inheritance** | The property chain (schema ⇒ determinism ⇒ byte-diff erasure) was established at the per-block level (prior note). Composition must be re-proven, not assumed: evidence selection and ordering policies must be canonicalized (deterministic orderings), or the receipts break — see section 4. |
| "Graph neighborhood → SFT data" as a capability claim | **Taken** | GraphGen's "multi-hop neighborhood sampling" and EmbGen's reassembly own the phrase-level idea. Do not claim "graph-grounded SFT data" generically; the claim must be "composition of the actual bytes, deterministically, with receipts." |
| Multi-document composition as a unit | **Taken (different regime)** | MDS owns it for topic/event with synthetic targets. Cite Multi-News as the relative; the delta is identity-resolution + real-byte targets + receipts. |

**Verdict in one sentence:** the mechanism survives — but only in its full conjunction, and the
window is narrowing: EmbGen (2026) is already structurally halfway there (entity units +
reassembly), and one version of it with a resolved graph and real spans would collapse this seam.

## 4. Why this might NOT work as training data (adversarial steelman)

These are the failure modes a hostile reviewer will lead with; each one currently has no measured
defense.

1. **Dilution and gradient quality.** A composed sample mixes modalities (SQL row + email
   signature + VTT utterance + deck bullet) under one target; gradients over such heterogeneous
   renders may be noisier than per-block samples, and a small adapter (the shipped recipe:
   r=16, 80 steps, maxLen 768 in `AMNESIAC_TRAINING_RECIPE`) has little capacity to reconcile
   register conflicts *inside a single sequence*. The per-block corpus gives one clean gradient
   per fact; composition spends context attending across registers. No evidence exists either
   way — this is the primary risk, not a footnote.
2. **Entity hubs ⇒ repetitive near-duplicates.** High-degree entities (a customer ID mentioned in
   200 documents, "the company" itself) produce hundreds of largely-overlapping composed samples;
   effective data mass skews to hub entities while tail entities — the actual multi-hop
   knowledge — stay underrepresented. A cap/sampling policy fixes skew but *breaks determinism or
   at least adds a discretionary knob* the corpus's pure-function story has to absorb
   (policy version must enter the engine-version hash).
3. **Masked-span overhead compounds.** Per shipped recipe, `<PII:…>/<SECRET:…>` placeholder spans
   are already label-masked (`labels[-100]`). Composition multiplies entity mentions per sample
   (one entity's evidence mentions *it* in every rendered block, plus all co-mentioned entities),
   so the masked-fraction per composed sample rises sharply: the model trains largely on
   placeholder-shaped contexts, computing loss over an unnatural register — possibly teaching it
   to expect placeholder-style text at generation time and hurting fluency on natural text.
4. **False-merge blast radius inverts.** In the per-block corpus, a wrong chunk is one bad sample;
   ER errors are locally contained. In a composed corpus, a **false merge poisons every composed
   sample for that entity** — two distinct people's evidence renders into one sample, and the
   model learns genuinely-wrong relational facts. Worse: the erasure receipts still look clean
   (the byte-diff machinery is indifferent to graph correctness), so determinism masks the
   damage. The mechanism *amplifies* ER error from noise to structure. This is the strongest
   argument against the claim as stated and should be owned in the paper, not hidden.
5. **It may only recreate RAG at train time.** Composing all evidence about an entity into one
   context is precisely what a retrieval system does at inference for free, with fresher data and
   no retraining on drift. The training-time claim is defensible only closed-book — if the
   measured benefit disappears whenever a retriever is available at inference, the mechanism is
   engineering overhead. (Same "index-time vs weights" line as prior note risk 2, now pointed at
   ourselves.)
6. **Selection and ordering are policies, not facts.** "All cross-document evidence about an
   entity" is unbounded for hub entities; any "top-k evidence" rule is a discretionary choice.
   Every such policy must be a *canonicalized, versioned, pure function* (e.g., fixed order by
   source byte offset, fixed cap by degree class) or the determinism + receipt claims — the
   backbone of the whole project — collapse into ordinary pipeline noise.

## 5. What must be measured (the experiments a skeptical reviewer demands)

1. **Head-to-head on the same estate, same token budget:** per-block corpus (today's artifact) vs
   relational composed corpus, two otherwise-identical adapters. Primary metric: closed-book
   multi-hop recall on queries whose evidence spans ≥2 documents; secondary: per-fact atomic
   recovery (FActScore-style atomic probes, prior note), with facts stratified by whether they
   live in 1 vs ≥2 documents — that stratification is the direct test of the mechanism's
   hypothesis (composition consolidates cross-document facts; position-bound units do not).
2. **The fluency/interference probe:** perplexity and natural-generation quality on held-out
   clean text after training on each corpus (does mixed-register composition degrade generation?),
   plus a closed-book "placeholder-style output" rate — composed-corpus models that emit
   `<PII:…>`-shaped filler or lookup-style answers are measurably broken. Include a render-policy
   ablation (labeled-source renders "[SQL] … [EMAIL] …" vs plain concatenation).
3. **Hub-duplication analysis:** MinHash near-duplicate fraction of the composed corpus;
   entity-degree vs downstream-benefit curve (does benefit saturate by degree k?); report
   effective token efficiency *after masked spans* — composed samples must win on
   (learnable tokens) per FLOP, not just per sample.
4. **The false-merge experiment (the one that makes the claim honest):** an open-world variant
   with a controlled fraction of induced false merges; measure relational-fact corruption rate in
   composed samples vs the same error rate in per-block corpora, i.e., quantify the amplification
   factor. A reviewer will read this table before they read anything else.
5. **Erasure receipts on the composed corpus:** deleting an entity present in many composed
   samples still yields exactly that entity's span diff + sample retraction — prove the property
   chain survives composition (this is a correctness check, not a benefit, but a reviewer will
   want it stated as done).
6. **Isolate the "no synthesis" property:** composed-real-bytes vs GraphGen-style
   composed-synthetic-verbalization at matched budget, judged for factual precision — otherwise
   the "no synthetic generation" clause is an unexamined preference rather than a measured
   advantage.

Without (1) and (4), the claim is a schema property again — the same structural hole the prior
note flagged as risk 1 for the uncomposed corpus.

## 6. Pinned-citation ledger

**Pinned this session (abs page or export API, title + first author read this session):**

- arXiv:2004.07202 — Thibault Févry et al., "Entities as Experts: Sparse Memory Access with Entity Supervision" (export API)
- arXiv:2010.00904 — Nicola De Cao et al., "Autoregressive Entity Retrieval" (GENRE) (export API)
- arXiv:1909.04164 — Matthew E. Peters et al., "Knowledge Enhanced Contextual Word Representations" (KnowBERT) (export API)
- arXiv:2002.01808 — "K-Adapter: Infusing Knowledge into Pre-Trained Models with Adapters" (export API title search)
- arXiv:1911.03681 — Nina Poerner et al., "E-BERT: Efficient-Yet-Effective Entity Embeddings for BERT" (export API)
- arXiv:1905.07129 — Zhengyan Zhang et al., "ERNIE: Enhanced Language Representation with Informative Entities" (abs page)
- arXiv:1911.06136 — Xiaozhi Wang et al., "KEPLER: A Unified Model for Knowledge Embedding and Pre-trained Language Representation" (abs page)
- arXiv:2009.02252 — Fabio Petroni et al., "KILT: a Benchmark for Knowledge Intensive Language Tasks" (export API)
- arXiv:2208.03299 — Gautier Izacard et al., "Atlas: Few-shot Learning with Retrieval Augmented Language Models" (abs page)
- arXiv:2301.12652 — Weijia Shi et al., "REPLUG: Retrieval-Augmented Black-Box Language Models" (export API)
- arXiv:2505.20416 — Zihong Chen et al., "GraphGen: Enhancing Supervised Fine-Tuning for LLMs with Knowledge-Driven Synthetic Data Generation" (export API; re-pinned)
- arXiv:2010.12688 — "Knowledge Graph Based Synthetic Corpus Generation for Knowledge-Enhanced Language Model Pre-training" (KELM) (export API title search)
- arXiv:2605.19394 — "EmbGen: Teaching with Reassembled Corpora" (abs page; 2026)
- arXiv:2603.22213 — "SPA: A Simple but Tough-to-Beat Baseline for Knowledge Injection" (abs page; 2026)
- arXiv:1906.01749 — "Multi-News: a Large-Scale Multi-Document Summarization Dataset and Abstractive Hierarchical Model" (export API title search)
- arXiv:2107.09556 — Luyu Wang (et al.), "WikiGraphs: A Wikipedia Text - Knowledge Graph Paired Dataset" (abs page; first author confirmed, co-authors not read)
- arXiv:2402.00159 — Luca Soldaini et al., "Dolma: an Open Corpus of Three Trillion Tokens for Language Model Pretraining Research" (export API)
- arXiv:2404.10830 — Hantian Ding et al., "Fewer Truncations Improve Language Modeling" (best-fit packing) (export API)

**Reused from prior in-house notes (pinned in those sessions, per that ledger):** GraphRAG
2404.16130; HippoRAG 2405.14831; DocRED 1906.06127; FineWeb 2406.17557; DataComp-LM 2406.11794;
SISA 1912.03817; TOFU 2401.06121; Secret Sharer 1802.08232; SciCo 2104.08809; FActScore 2305.14251;
DocMatix (HuggingFace blog).

**Unpinned — do not cite externally without verification:**

- [UNPINNED] T-REx (Elsahar et al., LREC 2018) — candidate ID 1807.05978 **rejected** this session
  (resolves to viscoelastic snap-through mechanics); likely lives only in the ACL Anthology.
- [UNPINNED] KAPING — the name collides across two unrelated papers (Baechler et al. NAACL 2024 vs
  Guan et al. AAAI 2024); no ID was verifiable amid the collision, and it is prompting-time
  retrieval anyway. Dropped.
- [UNPINNED — not on arXiv] Fellegi–Sunter (1969); KGLM (Dhingra et al., ACL 2019); KagNet
  (KG-QA path scoring, EMNLP 2019 — name only, not verified this session).
- [Not fetched this session] EmbGen full text (abstract-level verdict only — the "no resolved
  graph, no real spans, no receipts" reading comes from the abs page, not the PDF; a PDF read is
  required before this becomes a paper-level claim).

**Rejected fabrications this session (search-snippet or memory IDs that failed verification; none used as evidence):**

- 2002.08769 → claimed K-Adapter; actually "Superconducting cavity in a high magnetic field"
- 1905.08171 → claimed ERNIE; actually "Semi-Supervised Learning by Augmented Distribution Alignment"
- 2009.08449 → claimed KEPLER; actually "'Less Than One'-Shot Learning: Learning N Classes From M<N Samples"
- 1910.11146 → claimed Multi-News; actually "A Maximum Likelihood Approach to Extract Finite Planes from 3-D Laser Scans"
- 2205.22935 → claimed Atlas; no such entry in the export API feed
- 2212.10509 → claimed Atlas; actually "Interleaving Retrieval with Chain-of-Thought Reasoning…" (Trivedi et al. — real paper, wrong ID)
- 2209.11752 → claimed Atlas; actually "Electromagnetic Response of Superconducting RF Cavities"
- 2506.04526 → claimed GraphRAG-Bench; actually "EECD-Net: Energy-Efficient Crack Detection…" (withdrawn record)
- 2509.21869 → claimed GraphRAG-Bench; actually "Two-ends Furstenberg estimates in the plane"
- 2503.01018 → claimed financial-KG instruction tuning; actually "Search for binary-channel metal-rich RR Lyrae candidates"
- 1807.05978 → claimed T-REx; actually "Dynamics of viscoelastic snap-through"
- 2501.02226 → claimed KAPING; actually "Knowledge Graph Retrieval-Augmented Generation for LLM-based Recommendation"
