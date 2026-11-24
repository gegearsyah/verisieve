# Identity-contrastive SFT from the entity index — novelty research (2026-11-24)

Mechanism-level novelty assessment for **identity-contrastive training signal generated from the
corpus's own entity index**: positives = cross-department/cross-modal records that share a vault-salted
entity ID; negatives = same-class near-misses (similar name, different person); SFT objective = train
the model to emit the same salted pseudo-token ID for both members of a positive (bind) and to split
negatives — "the schema as gradient, not metadata." Companion question: per-entity pseudo-token ID
anchors (the salted hash as a trainable identity token). Builds on the prior sibling note
(`2026-11-24-graph-grounded-corpus-novelty-research.md`, same session lineage); does not repeat it.

Citation discipline (binding, after this repo's 12-+-fabricated-ID history): every arXiv ID in the
ledger was pinned **this session** on `arxiv.org/abs/<ID>` or via the arXiv export API (title/authors
confirmed). Search-snippet IDs were treated as pointers only and **failed verification 7/7 times
this session** (the full list is in section 6, including one entire hallucinated paper cluster);
none are used as evidence. Full-text arXiv phrase searches that returned **zero results** are recorded
as negative evidence where relevant.

---

## 1. The claim, in one paragraph

Versieve's Amnesiac Corpus already carries a deterministic, entity-indexed schema (masked text,
vault-salted entity IDs, classes, byte-range provenance, per-sample certificates), with
cross-department/cross-modal mentions of the same real-world person resolving onto one salted ID
(54/54 measured on the synthetic estate). The candidate mechanism claims **novelty in the training
objective, not the schema**: the entity index deterministically *generates* identity-contrastive SFT
pairs — positives are masked records that describe the same entity across different
departments/modalities/surface forms (a SQL row, an ASR-variant spoken name, an email signature — all
bound to one salted ID); negatives are same-class near-misses (similar name, different person); the
SFT loss trains the model to emit the **same vault-salted pseudo-token** for both members of a
positive and divergent tokens for near-miss pairs. The pitch: identity binding becomes a *trained
capability over the enterprise's own resolved graph* — the model learns who it is talking about —
rather than metadata riding in the input. The discriminating question this note answers: has anyone
generated identity-contrastive SFT pairs **deterministically from a resolved entity index over an
enterprise's own cross-modal documents, with the entity ID itself as the training/decoding target**?

## 2. Prior-art map

For each: what it does / what it lacks / distance from the mechanism. Order = proximity.

### (a) Contrastive identity training from an entity index (the pairs)

- **BLINK** (arXiv:1911.03814, pinned on abs page this session). Bi-encoder entity linking trained
  with exactly the pair topology this mechanism describes: positives = (mention-in-context,
  true entity), negatives = distractor entities ranked against the same index; cross-encoder
  re-ranker on top. Lacks: (i) discriminative embeddings only — never a generative SFT target, the
  entity ID is never *produced* by the model; (ii) pairs come from public KBs (Wikipedia/Zeshel), not
  from an enterprise's own resolved cross-modal graph; (iii) no determinism, no erasure coupling, no
  masked-text corpus. Distance: *same pair-generating idea, different artifact class and different
  objective family* — this is the load-bearing prior art; the contrastive-from-index recipe itself
  is not novel, and no claim can survive that says otherwise.
- **Contrastive Entity Coreference and Disambiguation for Historical Texts** (arXiv:2406.15576,
  pinned via export API this session). The closest match on **negatives and the identity target**:
  builds a training set of >190M entity pairs from Wikipedia with **hard negatives**, trains
  cross-document coreference/disambiguation models **for individuals absent from external KBs**, and
  evaluates on hand-labeled historical newswire. Lacks: (i) discriminative (pair-scoring) training,
  not generative SFT with the ID as output; (ii) surface forms are all textual historical prose —
  no SQL/CSV/ASR/audio modality spread; (iii) pairs are mined statistically, not emitted
  deterministically from a resolved store, and no provenance/certificate/erasure machinery; (iv) the
  identity model is a component, not a property of a regenerated corpus. Distance: *closest single
  paper for "same-person contrastive pairs with hard negatives over non-KB people"* — must be
  confronted in Related Work.
- **PARCO** (arXiv:2509.04357, pinned via export API). Contrastive entity disambiguation inside a
  contextual ASR model: phoneme-aware encoding, entity-level supervision, hierarchical entity
  filtering to cut same-name false positives under distractors. Lacks: single speech task, acoustic
  lexicon not enterprise graph, no generative target, no cross-department record linkage. Useful as
  the citation showing the field already mines **same-surface-form near-miss negatives** (homophones)
  entity-by-entity — it weakens any "near-miss mining is new" sub-claim.

### (b) The entity ID as a generative target / per-entity trainable anchors (the bonus question)

- **GENRE — Autoregressive Entity Retrieval** (arXiv:2010.00904, pinned on abs page). The first
  system that retrieves entities by **generating their unique names token-by-token** — i.e., the
  entity identifier is the decoding target, no entity embeddings, no negative sampling. This
  occupies the "entity ID as the output the model is trained to produce" claim at the linking level.
  Lacks: the ID is the human-readable *name* (surface signal carries the gradient); no contrastive
  same-entity pairs across modalities; public Wikipedia; discriminator-style eval, not SFT-for-
  capability. Distance: *the "ID as generation target" claim must be framed relative to GENRE, not
  defended as new.*
- **Entities as Experts** (arXiv:2004.07202, pinned on abs page). Learns per-entity representations
  from text with entity supervision — entity vectors tied to specific entities, accessed via a
  memory at mention positions; improved factual knowledge on LAMA. Lacks: encoder memory/embedding
  anchors, not generation targets; identity comes from a linker at input, not an SFT objective; no
  contrastive pairs, no corpus, no determinism. This is the anchor for "entity representations
  learned from the model's own text" — the *embedding* ancestor of pseudo-token anchors.
- **E-BERT** (arXiv:1911.03681, pinned via export API) and **KnowBERT** (arXiv:1909.04164, pinned
  via export API) and **K-Adapter** (arXiv:2002.01808, pinned via export API). Inject entity vectors
  / entity-linked representations into the input space (E-BERT: entity-linking-supervised alignment
  of entity embeddings into wordpiece space — note its entity IDs are deterministic hashes of
  descriptions, the closest *input-side* analogue of a salted hash token); KnowBERT integrates an
  entity linker with Knowledge Attention and Recontextualization; K-Adapter injects factual/linguistic
  knowledge via adapters on a frozen model. Lacks (all three): input-side/static or adapter-side
  injection — no generative SFT, no contrastive identity pairs, no enterprise graph, no cross-modal
  positives. Together they occupy **"entity representation as a trained token/embedding"** as prior
  art; a paper claiming "per-entity trainable identity tokens" as the invention would be rejected by
  citation.
- **Instruction-tuned generative EL: INSGENEL** (arXiv:2311.03250, pinned on abs page; "first
  approach that enables causal LMs to perform entity linking over knowledge bases," instruction-tuned
  sequence-to-sequence EL objective + potential-mention retriever) and **EntGPT**
  (arXiv:2402.06738, pinned on abs page; EntGPT-I instruction-tunes a generative LLM for supervised
  EL over dictionary/KB entries). Lacks (both): mention→KB labeling over public KBs — the entity
  index is external, static, and public; no pairs generated from the index, no private-graph
  positives/negatives, no cross-modal records, no determinism/erasure coupling. Distance: *the
  "entity linking as instruction tuning / SFT" vocabulary is already published* — the mechanism's
  delta must be the pair source and the *binding-capability* claim, not "SFT teaches linking."

### (c) Entity matching / record linkage fine-tuning (the negatives' home field)

- **Ditto** (arXiv:2004.00584, pinned on abs page). Fine-tunes pre-trained LMs on **pairs of records
  from enterprise-style sources** (tables, product feeds, citations) as sequence-pair classification,
  with domain-knowledge injection and augmentation; the canonical entity-matching baseline.
  Lacks: match/no-match classification, not identity-token generation; pairs from labeled EM
  datasets, not deterministically from a resolved index; no cross-lingual/modal surface-form spread
  in the training signal itself, no masking/redaction, no corpus artifact. Distance: *the supervised-
  pair-training-over-record-fields recipe is owned by the EM field; Ditto is the citation a reviewer
  will reach for.*
- **Record-linkage-with-LM tooling**: LinkTransformer (arXiv:2309.00789, pinned via export API;
  treats record linkage as text retrieval with transformer embeddings, Stata/R-facing) and LMs for
  patient record linkage (arXiv:2504.15261, pinned via export API; RoBERTa fine-tuned for blocking,
  LMs for matching). Lacks (both): retrieval/embedding-based matching; nobody emits an entity-indexed
  training corpus or trains a *generative* model on index-derived identity pairs. Useful contrast:
  even the newest RL line uses LMs as *linker components*, not as the thing being trained to bind.

### (d) The contrastive-objective substrate (cite once, do not re-litigate)

- **SimCSE** (arXiv:2104.08821, pinned via export API) — sentence-embedding contrastive training
  (supervised positives from NLI, unsupervised from dropout symmetry). The mechanism's loss shape is
  downstream of SimCSE-class objectives; nothing here is claimed as a loss-function contribution and
  none should be.

**What this class collectively lacks / the seam:** every ingredient is published —
contrastive pairs from an entity index (BLINK), hard same-class negatives for non-KB people
(2406.15576), cross-modal same-entity supervision in an acoustic setting (PARCO), entity ID as
generation target (GENRE, INSGENEL, EntGPT), per-entity trainable anchors (E-BERT/EAE/KnowBERT),
supervised pair training over enterprise records (Ditto). **What no found artifact does is the
conjunction:** pairs generated *deterministically as a function of the enterprise's own resolved
graph*, across heterogeneous modalities (SQL row ↔ ASR variant ↔ email signature as members of one
positive), with an **opaque salted pseudo-token** (not a name, not a KB QID) as the single target
produced for both members — and with the token set coupled to an erasure mechanism (re-salting ⇒
regenerated corpus ⇒ retrained adapter, the property the Amnesiac Corpus note already owns). The
seam is the *provenance of the pairs and the opacity of the target*, not the objective.

## 3. Novelty verdict

**Overall: partially crowded — the objective family is taken; the conjunction and the coupling are
the only defensible novelty, and they are narrower than the mechanism pitch.**

| Element | Novelty | Why |
|---|---|---|
| Contrastive identity pairs generated from an entity index | **Taken** | BLINK (1911.03814) trains exactly this topology off an index; the historical-text work (2406.15576) does same-person pairs with hard negatives for people outside any KB; PARCO mines same-surface near-misses. A claim of "we invented identity-contrastive pairs" does not survive Citation 1. |
| Entity ID as the generative target / trained capability in SFT | **Taken at name-level, contested at hash-level** | GENRE generates unique entity names as IDs; INSGENEL and EntGPT-I instruction-tune generative LMs to link to KB entities. Nobody found trains on an **opaque salted hash** as the target — but opacity is as plausibly a liability as a novelty (section 4.1); do not stake the paper on "salted hash as output token." |
| Per-entity pseudo-token anchors (bonus question) | **Taken on the input/embedding side; open-but-weaky on the generative side** | E-BERT/Entities-as-Experts/KnowBERT train per-entity representations tied to mentions; E-BERT's entity IDs are deterministic description hashes — the deterministic-hash-anchor idea exists. The *generative, SFT, opaque-token* combination is unoccupied (and the 2024-era "pseudo-lexeme / deterministic entity token" cluster that looked like direct prior art **does not exist** — section 6 fabrication ledger; the phrase searches also return zero full-text hits). Open, but the honest verdict is "no one does this, possibly because it does not work." |
| Cross-modal positives from one resolved enterprise graph (SQL ↔ ASR ↔ email, same salted ID) | **Not found** | BLINK/EntGPT/INSGENEL live on textual public KBs; Ditto on labeled EM pairs; 2406.15576 on prose. No found artifact generates positives that span structured rows, spoken-form variants, and signatures against one private resolved graph. This is the surviving conjunct. |
| Coupling to determinism + erasure (re-salt ⇒ regenerate ⇒ retrain; ID-set versioned with the corpus) | **Not found** | No EL/EM work ties its identity tokens to an artifact lifecycle with receipts. This is a property of the existing corpus claim, not a new one — cite it as the *consequence*, not as the mechanism. |
| "Identity binding as trained capability" framing | **Framing, not mechanism** | True only if the measurements in section 5 pass, especially the unseen-entity and salt-rotation tests. Until then it is a restatement of supervised contrastive EL applied to private data. |

**What the founder must hear:** the mechanism is a **recombination of established objective
ingredients, made against a private, deterministic, cross-modal graph** — not a new training signal
in the objective-family sense. Under the no-gap-filling bar, this survives only as: *first
demonstration that an enterprise's resolved identity graph, deterministically compiled into
contrastive pairs, yields a measured binding capability in a generative model (with unseen-entity
false-merge/false-split receipts and salt-rotation behavior) — which plain contrastive/EL training
on the same data does not yield.* The measurement section (5) is therefore not optional; it is the
novelty.

## 4. Rejection risks and defenses (steelman — why this fails)

1. **"The salted pseudo-token is opaque — the model learns hash memorization, not identity."**
   GENRE's names carry surface signal; a vault-salted hash is arbitrary by design (and is
   *deliberately* decorrelated from the person across deployments for erasure). The strongest
   failure mode: the model binds each positive pair by memorizing co-occurrence features of that
   pair (department idiosyncrasies, timestamp patterns, author style left in masked text), and the
   apparent 100% binding rate on the synthetic estate is fixture leakage. If so, capability claims
   collapse on unseen entities and on a re-salted corpus.
   Defense if measured: the salt-rotation ablation (section 5.3) is the single decisive experiment —
   train on salt-A, and test whether (i) a frozen model on salt-B IDs collapses (then the mechanism
   learned a token map, and "identity as trained capability" is false *and the claim must be
   retracted*) or (ii) the model retains binding structure and re-anchors with small adapters (then
   identity behavior is token-map-free and the claim stands). Pre-register both interpretations.
2. **"Unseen entities are exactly the ones with no pairs — the objective cannot transfer by
   construction."** The pairs the index generates cover only entities already resolved at build
   time; a new hire, new customer, or new alias appears in zero training pairs. The mechanism
   therefore teaches a *closed-world* binding function, while the pitch ("learns who it is talking
   about") is an *open-world* claim. BLINK-side literature (zero-shot EL) exists precisely because
   this gap is the field's central problem.
   Defense: hold out an entity-disjoint test split at corpus construction time (entities reserved
   from pair generation, their mentions retained in the corpus as context) and report false-merge/
   false-split on them separately — the honest framing is "binding generalizes to unseen entities
   **only via shared near-miss negatives and surface-form invariance**, if at all," and either
   result is publishable if reported honestly.
3. **"Near-miss negative mining is either trivially easy (no gradient) or circularly easy."** If
   negatives are same-name-different-person pairs produced by the same resolver that produced the
   graph, the training set contains no negatives the resolver itself could not already separate —
   the model is being distilled into the resolver's existing accuracy, discovering no identity
   information beyond what perception already emits (this collapses the mechanism back into the
   corpus claim, i.e., gap-filling by another name). Conversely, if negatives are trivial
   (different-name, different-class), SimCSE-style dynamics give the model a shortcut (surface
   similarity ≈ identity) that actively harms real disambiguation.
   Defense: report a negative-hardness sweep — binding accuracy as a function of name-similarity
   bin (exact-name homonyms up to ASR/OCR variants) — plus the distillation check: contrastive-SFT
   adapter vs. a non-contrastive SFT adapter on the *same* corpus, same token surface, evaluated on
   pairs the resolver got wrong or abstained on. If the adapter adds nothing there, say so.
4. **"This is BLINK/EntGPT with your preprocessing."** Reviewer's first move. The honest one-line
   pre-emption: *contrastive EL trains a scorer to rank the index; we deterministically compile the
   enterprise's own resolved graph into pair-level SFT so that a generative model must emit the
   identity itself — across record rows, spoken forms, and signatures — with the token set coupled
   to the corpus's erasure lifecycle.* Answered with the artifact/conjunction, not with a capability
   fight (same pattern as the GraphRAG pre-emption in the sibling note).
5. **"Per-entity random/virtual tokens were tried and found wanting."** The related cluster of
   knowledge-injection-via-placeholder work (2024 instruction-era) binds one pseudo-token per entity
   by SFT, and the failed-to-verify cluster in section 6 suggests the deterministic-entity-token
   idea is *in the air* even though no primary source with that mechanism was verifiable this
   session. Risk: a reviewer cites one of the real neighbors we did not find and the "unoccupied
   generative hash-anchor" conjunct dies overnight.
   Defense: keep the claim scoped to what was verified — *no verified artifact ties opaque salted
   tokens as SFT output targets to a resolved private graph with an erasure lifecycle* — and run a
   fresh literature check the week of any submission (the 2505–2607 arXiv density on this topic is
   high and moving).
6. **"Contrastive + generative = known combo."** RAG-fusion style generative-EL training and
   retrieval-contrastive hybrids exist across the field; "we also added negatives" is not a delta
   by itself. Defense: the delta is only ever the *source of the pairs and receipts on the
   outcome*; make the receipts the contribution, never the loss.

## 5. Measurement requirements (what must be measured for a defensible claim)

1. **Unseen-entity identity binding** (the load-bearing number): entities disjoint from pair
   generation, mentions retained in the corpus; report false-merge rate and false-split rate in
   *generation* (not embedding similarity) against manifest ground truth, with a failure taxonomy by
   surface-form difficulty (exact homonyms, ASR/OCR variants, abbreviations, transliterations) — the
   convention the cross-doc coref field already reports ( SciCo line, sibling note section 5).
2. **Salt-rotation ablation** (the decisive one): train on vault salt-A; evaluate frozen on salt-B
   IDs, and fine-tune a light adapter on salt-B; report decay vs. recovery. This experiment alone
   separates "identity binding capability" from "hash memorization" (section 4.1) — and it must be
   designed *before* any capability claim is written.
3. **Contrastive-vs-flat control:** two adapters from the same corpus — one with index-derived
   identity pairs, one without (same masked text, same token surface) — evaluated on (a) held-out
   binding, (b) cross-modal same-person QA ("who owns this account," answered from a SQL row and a
   transcript jointly), (c) behavior on mentions the resolver mis-ranked or abstained on. Without
   the control, the whole mechanism reduces to the corpus claim that is already documented.
4. **Negative-hardness sweep:** binding accuracy binned by negative name-similarity/difficulty;
   report whether near-miss gradients move anything above the trivial baseline. Trivially easy ⇒
   explicitly downgrade the "identity-contrastive" ingredient to "supervised pair compilation."
5. **Memorization/exposure probe:** Carlini-style canary exposure on entity-token associations
   (a salted ID + its masked record) — because the tokens persist and are stable, the corpus's
   privacy posture depends on the adapter not becoming a leak channel; the sibling note's canary
   experiment should be extended to identity associations, not just text.
6. **Open-estate variant:** one non-synthetic estate where truth is not constructed (even a
   single-department public-data set with known duplicated persons), because a uniform 100%
   identity table on the synthetic fixture reads as fixture leakage, not capability (same liability
   flagged in the sibling note's risk 4).

## 6. Pinned-citation ledger

**Pinned this session** (`arxiv.org/abs/<ID>` or arXiv export API, title/authors confirmed):

- arXiv:1911.03814 — Wu et al., "Scalable Zero-shot Entity Linking with Dense Entity Retrieval" (BLINK).
- arXiv:2010.00904 — De Cao et al., "Autoregressive Entity Retrieval" (GENRE; ICLR 2021).
- arXiv:2004.07202 — Févry et al., "Entities as Experts: Sparse Memory Access with Entity Supervision".
- arXiv:1911.03681 — Févry et al., "E-BERT: Efficient-Yet-Effective Entity Embeddings for BERT".
- arXiv:1909.04164 — Peters et al., "Knowledge Enhanced Contextual Word Representations" (KnowBERT).
- arXiv:2002.01808 — Wang et al., "K-Adapter: Infusing Knowledge into Pre-Trained Models with Adapters".
- arXiv:2104.08821 — Gao et al., "SimCSE: Simple Contrastive Learning of Sentence Embeddings".
- arXiv:2004.00584 — Li et al., "Deep Entity Matching with Pre-Trained Language Models" (Ditto).
- arXiv:2406.15576 — "Contrastive Entity Coreference and Disambiguation for Historical Texts".
- arXiv:2509.04357 — "PARCO: Phoneme-Augmented Robust Contextual ASR via Contrastive Entity Disambiguation".
- arXiv:2311.03250 — Xiao et al., "Instructed Language Models with Retrievers Are Powerful Entity Linkers" (INSGENEL).
- arXiv:2402.06738 — Ding et al., "EntGPT: Entity Linking with Generative Large Language Models".
- arXiv:2309.00789 — Baranovskiy et al., "LinkTransformer: A Unified Package for Record Linkage with Transformer Language Models".
- arXiv:2504.15261 — "Leveraging Language Models for Automated Patient Record Linkage".

**Negative evidence (full-text arXiv searches returning zero results this session):** "pseudo-lexemes";
"long-entity language models"; `"identity contrastive" + entity + training`; "Entity-Fish". These do
not license "nothing exists" — only that the specific phrases do not hit arXiv full-text.

**Rejected fabrications — every snippet-surfaced ID failed abs-page verification this session
(none used as evidence anywhere in this note):**

- arXiv:2402.09949 claimed as "In-Context Learning with Long-Entity Language Models" (LM-2,
  deterministic entity pseudo-lexemes) → actually "Multi-word Tokenization for Sequence
  Compression". The entire LM-2/LM-1/"copy-mode" story from search snippets is unverifiable and is
  treated as fabricated.
- arXiv:2409.19990 claimed as "CoNteXT: Context Tuning for Grounded Knowledge Injection"
  (pseudo-token placeholder + SFT) → actually Zink et al., "Predictive Speech Recognition and
  End-of-Utterance Detection Towards Spoken Dialog Systems".
- arXiv:2406.04604 claimed as "DetermEnt" (deterministic entity-token merging in a closed-world SE
  dataset) → actually Wen et al., "Learning Task Decomposition to Assist Humans in Competitive
  Programming".
- arXiv:2506.02143 claimed as "FSD: Few Semantic Tokens" (deterministic anchor-token decoding) →
  actually Kansoy & Stasiulaitis, "Green Shields: The Role of ESG in Uncertain Time".
- arXiv:2503.06680 claimed as "Entity-Fish-SLM" (rare entities as `entity_xxxxx` pseudo-lexemes) →
  not verified; "Entity-Fish" returns zero arXiv full-text hits → rejected outright.
- Own-seed ID failures this session (caught before use): arXiv:1909.00412 guessed as E-BERT →
  actually a social-media-user-representations paper; correct E-BERT ID found via export API
  (1911.03681). arXiv:1909.04159 guessed as KnowBERT → actually a knot-theory paper; correct
  KnowBERT via export API (1909.04164). arXiv:2002.00718 guessed as K-Adapter → actually a
  semantic-segmentation incremental-learning paper; correct K-Adapter via export API (2002.01808).
  arXiv:2009.08377 guessed as KEPLER → actually a harmonic-maps theorem paper (KEPLER was left
  uncited rather than guessed a second time).

Session tally: 14 pinned, 0 reused from prior notes for mechanism-level claims, 7 snippet IDs +
4 own seed guesses rejected.
