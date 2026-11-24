# Graph-Grounded Corpus novelty research — post-reposition (2026-11-24)

Research note for the repositioned (value-first) claim: a **graph-grounded training corpus with
standalone knowledge**, erasure demoted to a property/section, and a possible upgrade to
cross-document relational knowledge as first-class perception output. Builds on and does not
repeat the prior in-house notes (`2026-11-24-versieve-novelty-bet-research.md`,
`2026-11-24-company-brain-novelty-mechanisms.md`, `2026-11-24-company-brain-market-landscape.md`).

Citation method note (binding, after last session's 8-fabricated-ID failure): every arXiv ID in
section 6 was pinned this session on `arxiv.org/abs/<ID>` or via the arXiv export API; vendor
claims come from fetched vendor pages. Search-snippet-surfaced IDs failed verification 4/4 times
this session (details in section 6) and none were used as evidence. Items marked **[UNPINNED —
verify before citing]** could not be confirmed on a primary page this session.

---

## 1. The repositioned claim, in one paragraph

Enterprises convert scattered heterogeneous documents (SQL, CSV, email, transcripts, audio,
decks, notes) into fine-tuning data by positional chunking; the resulting samples are
*place-stitched fragments* that carry no record of which real-world entities they describe, which
other documents describe the same entities, or where their bytes came from. Versieve's claim is a
**graph-grounded training corpus** produced by a zero-egress WASM perception stack (five kernels,
387,267 B, zero host imports) in which every training sample carries its own standalone
knowledge: masked content, the vault-salted entity identifiers it mentions, their classes, its
byte-range provenance, and a per-sample conformal gatekeeper certificate. Because samples are
entity-indexed and the corpus is a deterministic function of (inputs, view, engine version),
deleting an entity regenerates the corpus with a byte-diff of exactly that entity's spans — the
Amnesiac Corpus — with a sealed LoRA retrain completing the erasure path. Erasure is a property,
not the pitch; the pitch is that the model trains on data with standalone knowledge rather than
fragments. The candidate upgrade: extend perception from per-document extraction to **the
knowledge between documents** — cross-document entity identity and cross-document facts/relations
as explicit perception output, not just per-file text.

## 2. Prior-art map

For each work: what it does / what it lacks / distance from our claim.

### (a) Graph-grounded retrieval and QA (not training data)

- **GraphRAG** (Microsoft; arXiv:2404.16130, pinned on abs page; official docs at
  `microsoft.github.io/graphrag`, fetched this session). LLM extracts an entity knowledge graph
  from documents (TextUnits as the source-of-truth slices), clusters it (Leiden), writes
  community summaries, and answers corpus-wide questions at retrieval time. The docs describe
  TextUnits as providing "fine-grained references" — the closest thing to provenance — but there
  is **no training-corpus output, no per-sample structure, no erasure or deletion machinery, and
  no certificates**; the index is LLM-generated and not deterministic. Distance: *adjacent at the
  graph layer, orthogonal at the artifact layer.* GraphRAG grounds a **retrieval index**; the
  repositioned claim grounds **training samples** — a different artifact class with different
  receipts (byte-diff erasure, SHA-pinned determinism).
- **HippoRAG** (arXiv:2405.14831, pinned on abs page). KG + Personalized PageRank long-term
  memory for LLMs; on multi-hop QA beats prior RAG. Same verdict: retrieval-time memory, no
  corpus, no provenance, no erasure.
- **GraphGen** (arXiv:2505.20416, reused from prior session). Extracts a KG **from text** and
  generates *synthetic* QA pairs for SFT. Direction reversed and determinism lost: GraphGen
  creates new text grounded in a generated graph; Versieve grounds **the actual samples** in the
  resolved entity graph. Closest single prior art for "KG-grounded fine-tuning data" — must be
  confronted explicitly, not omitted.

### (b) KG construction from enterprise documents

- **Docugami** (product page fetched this session). "Agentic Document AI" — converts documents
  into a "hierarchical Knowledge Graph of your documents in their entirety," exports XML/CSV/JSON
  (DGML). Lacks: cross-document entity linking is not a named capability (topic/entity clustering
  only per its page), no training-corpus output, no provenance/certificate machinery, cloud, not
  zero-egress. Distance: closest *product* overlap on "document set → graph," but it stops before
  the training artifact entirely.
- **IBM Docling** (`docling-project/docling`, verified in the earlier session's note): best
  open-source ingestion overlap — a parser, no graph, no redaction certification, no
  training-artifact pipeline.
- **Enterprise-KG research line** (pinned in prior sessions): arXiv:2611.27835 (auditable,
  schema-driven financial KGs with traceable construction), arXiv:2508.17906 (FinReflectKG),
  arXiv:2611.04899 (Knowledge Graph Lakehouse), arXiv:2603.04184 (materialized RDB2RDF views with
  incremental maintenance — "graph as projection of relational truth" in DB formalism). All
  build **queryable graphs**; none emit training corpora with per-sample grounding, and none are
  zero-egress.

### (c) Entity resolution / record linkage inside training-data pipelines

- The ER field itself is old and deep (record linkage goes back to Fellegi–Sunter 1969
  **[UNPINNED — classic literature, not on arXiv]**): probabilistic linkage survey line
  (Vatsalan/Christen/Verykios, in-print, prior session), privacy-preserving record linkage via
  Bloom filters (arXiv:1612.08835, 2206.15089, reused), AMPPERE's MPC/HE ER evaluation platform
  (arXiv:2108.09879, reused), Splink (MoJ; local deterministic linkage — engineering prior art,
  not on arXiv). **Nobody productizes ER as a step that emits entity-indexed training samples.**
  ER tooling outputs an entity store; corpus pipelines (below) output positional chunks; the two
  are not coupled anywhere we found.
- Prior-session verdict stands: client-side WASM ER is packaging, not mechanism. In the
  repositioned frame its role changes from "feature" to **enabler**: resolved identity is what
  makes sample-level entity indexing (and therefore exact erasure) possible.

### (d) Data-centric corpus construction (the provenance state of the art)

- **FineWeb** (arXiv:2406.17557, pinned on abs page). 15T tokens from 96 Common Crawl snapshots;
  thorough documentation and ablation of dedup/filtering; released curation codebase. Lacks:
  no entity index, no certificate machinery, no erasure; provenance = snapshot IDs + documented
  curation pipeline, not byte-range or entity-level grounding of individual training samples.
- **DataComp-LM** (arXiv:2406.11794, reused). Curation-as-filtering benchmark at 240T tokens;
  same absence.
- **DocMatix** (HuggingFace blog, fetched this session). 2.4M images / 9.5M QA pairs from 1.3M
  PDFs; LLM-generated QA with 15% hallucination-filtering; provenance is **document-level only**
  ("can be traced back to the original PDFA dataset") — the blog describes no per-QA region or
  entity linking, no certificates, no erasure. Useful precedent: instruction-data with upstream
  traceability, one rung below sample-level grounding with receipts.
- **Dolly / databricks-dolly-15k**: human-written instructions for instruction-tuning. Both
  candidate blog URLs 404'd this session — **[UNPINNED — verify before citing]**; cite
  sparingly and only for "instruction data with no machine provenance at all" as contrast.
- **Datasheets for Datasets** (arXiv:1803.09010, reused): dataset documentation culture exists;
  Versieve's certificates are a machine-verifiable, per-sample refinement of it.

**What this class collectively lacks:** no corpus we found ships per-sample
(entity-IDs + classes + byte-range provenance + certificate) as the unit of data. FineWeb-grade
pipelines prove filtering; DocMatix proves upstream traceability at document grain; nobody binds
identity, provenance, and certification at training-sample grain or regenerates the corpus
deterministically. This is the strongest single seam in the whole repositioned claim.

### (e) Enterprise document-intelligence products

- **Azure Document Intelligence** (learn.microsoft.com overview, fetched this session;
  `ms.date` 2026): "machine-learning based OCR and intelligent document processing" for key data
  extraction — key-value pairs, tables, forms. No cross-document graph, no training-corpus
  export, no erasure; cloud. Distance: per-document extraction only — confirms the phrase
  "perceive everything" cannot be spent on document-level products.
- **Glean / Hebbia / Tonic Textual / Private AI / Docling / Unstructured** — mapped exhaustively
  in the prior market note: no vendor pairs whole-estate ingestion with a training-ready corpus;
  Tonic ships training-ready JSONL with redaction but no graph, no certificates, no erasure;
  lineage vendors (Atlan/Collibra) graph only structured metadata.

### (f) Atomic knowledge / atomic-fact fine-tuning data

- **FActScore** (arXiv:2305.14251, pinned on abs page): decomposes long-form generations into
  atomic facts for *evaluation*. Not training data, but owns the "atomic, self-contained fact"
  vocabulary — cite as the framing relative.
- **Atomic-fact-informed training** (pinned via arXiv export API this session):
  arXiv:2306.09306 ("Propagating Knowledge Updates to LMs Through Distillation" — injects atomic
  facts via context distillation, on-policy fine-tuning comparison); arXiv:2410.16708 ("Atomic
  Fact Decomposition Helps Attributed Question Answering" — decomposes into molecular clauses and
  atomic facts, instruction-tunes on a KG-derived dataset); arXiv:2510.22590 (ATOM — minimal
  atomic facts for temporal KG construction). These make atomic knowledge the *unit of reasoning
  data*; they do not carry entity identity, provenance, certificates, or erasure, and they derive
  groundings, not from the enterprise's own resolved graph.
- Verdict: the "standalone, self-contained unit" vocabulary is occupied (FActScore line +
  GraphGen's atomic QA). Our delta must be stated as *provenance-bound, identity-bound units over
  the enterprise's own graph*, not as "atomic knowledge" per se — that phrase is borrowed.

## 3. Novelty verdict

**Element-by-element:**

| Element | Novelty | Why |
|---|---|---|
| Sample carries its own grounding: entity IDs + classes + byte ranges + certificate, as the training unit | **High — the strongest bet** | Prior art has the halves but not the unit: GraphGen grounds synthetic samples in a generated graph; GraphRAG/Docugami ground indices, not training units; DocMatix/FineWeb carry upstream traceability at document/pipeline grain; corpus pipelines do not consume ER output at all (sections 2a–2d). No found artifact binds identity + provenance + certificate at training-sample grain. |
| Corpus as deterministic, regenerable artifact → exact erasure | **High (confirmed by prior session — model-side unlearning dominates: SISA 1912.03817, TOFU 2401.06121; no corpus-side regeneration prior art found)** | The erasure property is the *corollary* of entity indexing, which keeps the paper's spine consistent: the schema enables the property. |
| Zero-egress on-device extraction | **Low-to-medium as novelty; high as necessity** | Market note: zero-egress *as a product category* is unoccupied end-to-end, but as an architecture pattern it is articulated; on-device/air-gapped pipelines exist (Docling, Private AI, VPC deployments). It is the constraint that makes "whole-estate" ingestion credible, not a mechanism. |
| Per-sample conformal certificates | **Alive but narrow** (prior session: conformal-on-PII essentially uncovered; LeakagenBench/CLIOPATRA force the "detectable PII at stated confidence" framing) | Keep precisely scoped; do not let it drift toward privacy guarantees. |
| Cross-document knowledge (relations *between* documents) as first-class perception output | **Partially crowded** — see section 5 | Cross-doc coreference (SciCo line), doc-level RE (DocRED line), and index-time cross-doc linking (GraphRAG) all connect knowledge across documents. The uncrowded sliver: doing it under zero-egress byte-budget constraints, with merge receipts, *emitted into training samples*. |

**Strongest single bet:** the **sample schema as a measured artifact** — the training unit that
binds masked text, vault-salted entity identifiers, classes, byte-range provenance, and a
per-sample certificate, such that the corpus is a deterministic function of its inputs. Every
adjacent system stops one field short (GraphRAG: no corpus; DocMatix: no entity identity;
GraphGen: no actual-sample grounding; FineWeb: no per-sample anything). The erasure property is
what the schema buys, and it is the most defensible *consequence*, not the standalone thesis.

**Crowded elements:** cross-document entity linking as a *capability* (decades-old field +
GraphRAG); "atomic knowledge" vocabulary (FActScore/GraphGen); zero-egress as positioning.

**Upgrade direction (cross-document relational knowledge as perception output):** keep as an
extension of the schema — cross-document facts must land *in the samples* (multi-sample entity
binding, cross-document fact fields), not merely in an index — or it collapses into GraphRAG. See
section 5.

## 4. Rejection risks and defenses (reviewer-style)

1. **"No downstream training comparison — the motivating hypothesis is its own missing
   experiment."** The draft honestly flags this (open work, no placeholder numbers). It is still
   the biggest hole: the paper currently proves *properties*, not *benefit*.
   Defense/required experiment: the controlled head-to-head the draft names — same estate, same
   budget, flat-chunked corpus vs graph-grounded corpus, two adapters, blinded rubric judging +
   Carlini canary exposure. Until run, the paper survives only as a data-artifact paper and
   should be reviewed as one.
2. **"GraphRAG already does this at retrieval time."** Defense: GraphRAG's graph is LLM-built,
   per-run, retrieval-facing, with no per-sample structure, no determinism receipts, no erasure
   path (section 2a, official docs). The comparison to pre-empt in one sentence: *index-time
   grounding serves the question; sample-level grounding serves the weights.* A reviewer raising
   this should be answered with the artifact-class distinction, not with a capability fight.
3. **"Entity resolution is a solved 50-year-old field."** Defense (honest): we claim no linkage
   algorithm. We claim resolved identity as a *field of the training unit* with receipts
   (precision/recall against manifest, byte-diff on erase) — the productized coupling of ER to
   corpus generation is what is missing everywhere else. Cite Fellegi–Sunter lineage and Splink
   as the field we sit on, not the claim we make.
4. **"Synthetic fixture, ground truth by construction = no generalization."** The draft's scope
   note is already binding ("construction-validation, not generalization"). Defense: keep that
   framing verbatim; the required addition is one open-estate measurement (a non-synthetic or
   public-data estate where truth is not by construction), even at small scale, or reviewers will
   read the 100% columns as the paper overclaiming. The 100%-everywhere Table 1 is a liability
   precisely because uniformity signals fixtures, not skill.
5. **"GraphGen makes KG-grounded SFT data already."** Defense: GraphGen generates new synthetic
   text from a graph built from text; grounding erases determinism and provenance; ours grounds
   the actual samples and keeps the corpus a pure function of inputs. Must appear in Related
   Work with this contrast (it already does in the draft — keep it).
6. **"Schema = metadata fields on JSONL; that's engineering, not research."** Defense: the
   contribution is the *coupled invariants* — schema (identity+provenance+certificate) ⇒
   determinism ⇒ exact erasure ⇒ measurable byte-diff receipts — plus an honest
   not-yet-claimed boundary section. Suits an artifact/datasets track (e.g. MLSys systems-for-ML
   framing) better than a methods track; do not dress it as an algorithmic contribution.

## 5. Upgrade assessment: "perceive everything, including the knowledge between all data"

**What is already crowded (would block the upgrade as a capability claim):**

- **DocRED** — arXiv:1906.06127 (pinned via arXiv export API this session; note: an earlier
  search-snippet ID was a topology paper — caught and rejected). 5,152 Wikipedia documents, 96
  Wikidata relation types, relations extending across sentence boundaries: doc-level relation
  extraction is an established benchmark field, and arXiv:2205.12696 ("Revisiting DocRED")
  extends the false-negative problem.
- **Cross-document coreference line** (pinned via export API): arXiv:2104.08809 (SciCo,
  hierarchical cross-doc coreference of scientific concepts), arXiv:2104.08413 (sequential
  cross-document coreference), arXiv:2310.12064 (cross-doc entity coreference annotation with
  Wikidata near-identity/bridging links), arXiv:2210.12654 (cross-document *event* coreference
  search). "Connect mentions across documents into one identity" is a named, benchmarked task.
- **Open information extraction** — arXiv:2310.11644 (review of OIE baseline techniques and
  applications, pinned via export API): extractions as (subject, relation, object) tuples at
  corpus scale, TextRunner/OLLIE lineage (pre-arXiv, name only). UIE (arXiv:2203.12277, pinned on
  abs page) makes uniform entity/relation/event structure generation a solved framework shape.

**What a defensible, measurable version looks like.** Do not sell "perceive everything"
(same-named theory doc's pillars — WASM-VIG/APSD/IB-AMP — already carry the framework role). The
defensible object is a **cross-document knowledge-perception benchmark over a multi-department,
multi-modal estate**, with three measurement families, each with a named metric:

1. **Cross-document identity receipts** (already present in the draft): P/R/F1 of cross-department
   merges against manifest ground truth — currently 100% on the synthetic estate. Upgrade = an
   open-world variant with a *failure taxonomy*: false-merge vs false-split rates, broken down by
   surface-form difficulty (homophone/ASR-variant, OCR-variant, abbreviation) — the SR-MP
   mechanism's real test, and the metric the cross-doc-coref field already reports (SciCo
   conventions).
2. **Cross-document fact coverage**: the fraction of manifest facts/relations that span ≥2
   documents and are recoverable from perception output *alone* (no retrieval, no model query),
   i.e. "knowledge between data" as a coverage claim. This is the falsifiable translation of
   "perceive everything": **knowledge-perception coverage K = (% of cross-document manifest facts
   recovered) at (byte budget B) at (zero egress)**.
3. **The training-benefit probe** (the one the draft lacks): flat-chunked vs graph-grounded
   adapters compared on multi-hop questions whose answers require facts that span documents —
   the downstream comparison that would convert "the corpus carries cross-document knowledge"
   from a schema property into a measured benefit. This is also the experiment that would make
   the upgrade a benchmark contribution rather than engineering: benchmark = named metric +
   released fixtures + baseline (one cloud LLM, one local pipeline) + published failure cases;
   engineering = receipts on our own fixtures only.

**Collision risk:** a "cross-document knowledge extraction benchmark" in the open-information
world is occupied (DocRED line, cross-doc coref line, OIE). The survivable sliver is the
**modality + constraint package**: heterogeneous enterprise surfaces (SQL, CSV, email, VTT, WAV,
pptx) — none of which DocRED/SciCo touch — under zero-egress byte-budget limits, with identity
merges and facts landed *into training samples with receipts*. If a reviewer can name an
existing benchmark with that shape, the upgrade is dead; we found none this session.

**Recommendation:** adopt the upgrade as benchmark families (1)+(2) with an open-estate variant,
only after the flat-vs-grounded training comparison (risk 1's experiment) exists — the upgrade
without the downstream probe repeats the original sin.

## 6. Pinned-citation list

Pinned this session (abs page or arXiv export API confirmed title/authors):

- arXiv:2404.16130 — Edge et al., "From Local to Global: A Graph RAG Approach to Query-Focused Summarization" (GraphRAG). Plus fetched official docs: `microsoft.github.io/graphrag`.
- arXiv:2405.14831 — Jiménez Gutiérrez et al., "HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models".
- arXiv:1906.06127 — Yao et al., "DocRED: A Large-Scale Document-Level Relation Extraction Dataset".
- arXiv:2205.12696 — Tan et al., "Revisiting DocRED — Addressing the False Negative Problem in Relation Extraction".
- arXiv:2406.17557 — Penedo et al., "The FineWeb Datasets: Decanting the Web for the Finest Text Data at Scale".
- arXiv:2203.12277 — Lu et al., "Unified Structure Generation for Universal Information Extraction" (UIE, ACL 2022).
- arXiv:2310.11644 — "Open Information Extraction: A Review of Baseline Techniques, Approaches, and Applications".
- arXiv:2305.14251 — Min et al., "FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation" (EMNLP 2023).
- arXiv:2306.09306 — Padmanabhan et al., "Propagating Knowledge Updates to LMs Through Distillation".
- arXiv:2410.16708 — Yan et al., "Atomic Fact Decomposition Helps Attributed Question Answering".
- arXiv:2510.22590 — Lairgi et al., "ATOM: Adaptive and Optimized dynamic temporal knowledge graph construction using LLMs".
- arXiv:2104.08809 — "SciCo: Hierarchical Cross-Document Coreference for Scientific Concepts".
- arXiv:2104.08413 — "Sequential Cross-Document Coreference Resolution".
- arXiv:2310.12064 — "Code Book for the Annotation of Diverse Cross-Document Coreference of Entities in News Articles".
- arXiv:2210.12654 — "Cross-document Event Coreference Search: Task, Dataset and Modeling".
- Vendor pages fetched: `learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview` (Azure Document Intelligence, updated 2026-10); `www.docugami.com/product`; `huggingface.co/blog/docmatix`.

Reused from prior in-house notes (pinned in those sessions): GraphGen arXiv:2505.20416;
CLIOPATRA arXiv:2603.09781; LeakageBench arXiv:2609.02207; SISA arXiv:1912.03817; TOFU
arXiv:2401.06121; Secret Sharer arXiv:1802.08232; DataComp-LM arXiv:2406.11794; Datasheets
arXiv:1803.09010; PPRL-Bloom arXiv:1612.08835 and arXiv:2206.15089; AMPPERE arXiv:2108.09879;
enterprise-KG line arXiv:2611.27835, 2603.04184, 2611.04899.

Unpinned / flagged — do not cite externally without verification:

- **[UNPINNED]** Dolly / databricks-dolly-15k (both candidate Databricks blog URLs 404'd this session).
- **[UNPINNED — not on arXiv]** Fellegi–Sunter (1969) record-linkage formulation; Vatsalan/Christen/Verykios PPRL survey line; Splink (MoJ, software); TextRunner/ReVerb/OLLIE (pre-arXiv ACL/WWW); universal schema (Riedel et al. 2013).
- **[Not fetched this session]** Zingg, Senzing, LiveRamp (ER-as-a-product vendors) — vendor positioning only.

Search-snippet fabrication catches this session (all IDs rejected, none used):

- "DocRED" as arXiv:1809.00682 → actually a string-link topology paper (Ducoulombier).
- "DocRED" as arXiv:1706.03750 → actually bipartite graph contraction (Dabrowski/Paulusma).
- "OpenIE survey" as arXiv:1802.04688 → actually sofic groups (Arzhantseva et al.).
- "DocRED = ACL Anthology D19-5152" → 404; correct primary source found via the arXiv export API (1906.06127).
