# W7 full-text verification record: the model card's citation rows — 2026-11-28

Ticket #47. Two read-only passes ran on 2026-11-28: a full-text reading of
every primary source behind the 2026-11-27 re-check's claim table, and the
LEACE-for-multimodal-encoders sweep (open question 1) plus the licence P0
verifications. This note is the committed record the model card's
citation-and-differentiation table and the claim-audit ledger cite row by
row. Every quote below was read in full text (ar5iv, arXiv HTML/PDF, or
ACL Anthology PDF), not in abstracts.

Headline finding: the claim substance survived full text for the core row
set, but six arXiv ids accumulated in the repo notes were wrong and are
now corrected in place with dated markers (the 2026-11-27 re-check note,
the W4 frz-std verdict, the W5 handoff). No claim in the model card cites
an id that was not read in full text or verified against a primary page.

## 1. The verified row set

### Adversarial removal limits (VERIFIED)
Elazar and Goldberg, "Adversarial Removal of Demographic Attributes from
Text Data", EMNLP 2018, D18-1002, arXiv:1808.06640. The in-training
adversary reaches chance (49.0% at 50 epochs) while a post-hoc attacker
with the same architecture reaches 56.0% on that encoder (Table 3; +6.0
to +8.5 above chance across Table 4, Race +10.6 unbalanced, 59.7% on
unseen data). Verbatim cautionary conclusion: "do not rely on the
adversarial training to achieve invariant representation to sensitive
features"; Section 8: the training adversary score "cannot be trusted"
and must be verified "with an externally-trained attacker, preferably on
unseen data".
Card differentiation: Weft claims no removal; identity-blindness is
worded only as a measured post-hoc probe result over the frozen base and
the heads, with the probe family fixed and reported.

### Privacy-defensive training gives no guarantee (VERIFIED; attribution corrected)
Coavoux, Narayan, and Cohen, "Privacy-preserving Neural Representations
of Text", EMNLP 2018, D18-1001, arXiv:1808.09408. The paper does not
propose removal-then-recovery; its defenses (adversarial generation,
declustering) modify the training objective and a fresh attacker is
trained on the frozen representation ("the performance of a single
attacker does not provide sufficient evidence"); post-hoc recovery
persists above chance (gender ~63-77% implied means; Denmark 68.5% vs
58.8% baseline), unevenly ("they lead to an improvement in privacy on all
datasets, except on the France subcorpus").
Correction: the post-hoc-recovery-persistence finding is attributed to
Elazar and Goldberg above; this row is cited only for "defensive training
objectives improve the attackability-utility trade-off without a
guarantee".

### Iterative nullspace projection (the canonical baseline) (VERIFIED)
Ravfogel, Elazar, Gonen, Twiton, and Goldberg, "Null It Out: Guarding
Protected Attributes by Iterative Nullspace Projection", ACL 2020,
2020.acl-main.647, arXiv:2004.07667. Mechanism confirmed (iterative
linear-classifier nullspace projection; the product guards the
intersection). The 85.0% figure verified verbatim, Section 6.1.1, GloVe
gender corpus: "we train a 1layer ReLU-activation MLP. The MLP recovers
gender with accuracy of 85.0%. This is expected, as the INLP method is
only meant to achieve linear guarding". Precision for the card: in the
same setup an RBF-SVM reaches near chance, so "nonlinear recovery" is
probe-family-specific, and the H2 probe design fixes and reports its
probe family (Elazar and Goldberg's externally-trained-attacker advice).

### The erasure follow-up line (VERIFIED; records corrected)
Ravfogel, Twiston, Goldberg, and Cotterell, "Linear Adversarial Concept
Erasure" (RLACE), ICML 2022, arXiv:2201.12091 (the repo's 2112.10139 was
an unrelated financial paper). Ravfogel, Vargas, Goldberg, and Cotterell,
"Adversarial Concept Erasure in Kernel Space", EMNLP 2022,
2022.emnlp-main.405, arXiv:2201.12191 (the repo's "Kernel-INLP 2023" is a
misnomer; the paper builds on the RLACE maximin game and its own abstract
concedes protection "does not transfer to different non-linear
adversaries"). Belrose, Schneider-Joseph, Ravfogel, Cotterell, Raff, and
Biderman, "LEACE: Perfect linear concept erasure in closed form", 2023,
arXiv:2306.03819 (closed-form affine erasure; an oblique, not orthogonal,
projection).

### Diffusion concept editing (VERIFIED; claim narrowed)
The diffusion line is fine-tuning and closed-form concept editing, not
nullspace projection of encoders: Gandikota et al., "Erasing Concepts
from Diffusion Models", arXiv:2303.07345 (ECCV 2024); Gandikota, Orgad,
Belinkov, Materzyńska, and Bau, "Unified Concept Editing in Diffusion
Models", arXiv:2308.14761 (WACV 2024); SPEED, arXiv:2503.07392 (ICLR).
The repo's original 2406.07137 id was a physics paper; corrected in the
2026-11-27 note.

### HIN adversarial linking with generated negatives (VERIFIED)
Wang, Wang, Wen, Li, Jia, Zhang, and Wang, "Author Name Disambiguation on
Heterogeneous Information Network with Adversarial Representation
Learning", AAAI 2020, arXiv:2002.09803. Mechanism read in full text: a
generative module selects negatives by random walk over a spanning tree
of a shared-entity-weighted paper graph within a connected component
("then they will be fed into discriminator as negative papers"); the
discriminator is a pairwise same-author scorer in a minimax game;
F1 72.92 (AMiner-AND) and 73.71 (AceKG-AND).
Card differentiation: Wang et al.'s generated negatives serve
disambiguation accuracy; Versieve's salting/gatekeeper negatives serve
privacy; Weft's identity-matched theme-different pairs serve theme
discrimination. Three separate rows.

### Aspect conditioning (VERIFIED; venue status disclosed)
Hossain, Hazra, Bhuiyan, and Karmaker, "The Critical Role of Aspects in
Measuring Document Similarity" (AspectSim), arXiv:2601.03435, a
non-peer-reviewed preprint (card marks venue status): 16 small open LLMs,
20-30% human-machine agreement from direct prompting, ~140% improvement
from a two-stage refinement (58-59% correlation with human judgment).
Schopf, Gerber, Ostendorff, and Matthes, "AspectCSE: Sentence Embeddings
for Aspect-based Semantic Textual Similarity Using Contrastive Learning
and Structured Knowledge", RANLP 2023, arXiv:2307.07851: supervision from
Wikidata KG properties (country, industry via SPARQL); aspects are
entity-anchored property values; multi-aspect embeddings beat
single-aspect (+3.97% average IR).
Card differentiation: AspectCSE's supervision passes through curated KG
entity properties; Weft's supervision is identity-orthogonal
document-graph structure with no entity-property requirement.

### Conformal abstention (VERIFIED; affiliation not printed)
Abbasi-Yadkori, Kuzborskij, Stutz, György, Fisch, Doucet, Beloshapka,
Weng, Yang, Szepesvári, Cemgil, and Tomasev, "Mitigating LLM Hallucinations
via Conformal Abstention", arXiv:2405.01563 (2024): conformal calibration
of an abstention threshold and a response-matching threshold with a
"distribution-free, statistical upper bound on the hallucination risk".
No affiliation is printed in the citable artifact, so the card prints
none. The repo's follow-up id 2408.08786 was a quantum-memory paper; the
follow-up row is dropped.
Card differentiation: their thresholds are calibrated over sampled
generations of one LLM; Weft reuses the repo's LTT machinery on
application-level pair scoring over anchor sets, claiming application
level only.

### CDCR family (benchmark substrate) (VERIFIED)
Barhom, Shwartz, Eirew, Bugert, Reimers, and Dagan, "Revisiting Joint
Modeling of Cross-document Entity and Event Coreference Resolution",
ACL 2019, P19-1409 (joint entity and event CDCR on ECB+). Eirew, Cattan,
and Dagan, "WEC: Deriving a Large-scale Cross-document Event Coreference
dataset from Wikipedia", NAACL 2021, 2021.naacl-main.198, arXiv:2104.05022
("mentions are gathered across the entire Wikipedia corpus, yielding a
dataset that is not partitioned by topics"). Zhukova, Ruas, Wahle, and
Gipp, "Piecing Together Cross-Document Coreference Resolution Datasets"
(uCDCR), LREC 2026, arXiv:2603.00621 (accepted; preprint caveat):
unifies 12 English CDCR corpora with standardized metrics. The
"pre-late-2020 CDCR systems were single-corpus" point now has its source:
Ravenscroft, Clare, Cattan, Dagan, and Liakata, "CD^2CR: Co-reference
resolution across documents and domains", EACL 2021, 2021.eacl-main.21
("Both Cattan et al. (2020) and Barhom et al. (2019) models are trained
and evaluated using the ECB+ corpus").

### Routing and coverage anchors (VERIFIED; ids corrected)
Tibshirani, Foygel Barber, Candès, and Ramdas, "Conformal Prediction
Under Covariate Shift", arXiv:1904.06019 (weighted conformal; the repo's
2202.13439 was an unrelated math paper). Sun, Ming, Zhu, and Li,
"Out-of-Distribution Detection with Deep Nearest Neighbors", ICML 2022,
arXiv:2204.06507 (the repo's 2204.13600 was an unrelated physics paper).
Mozannar and Sontag, "Consistent Estimators for Learning to Defer to an
Expert", arXiv:2006.01862 (the repo's 2007.07361 was an unrelated
cost-sensitive ensembling paper; venue check before print: the arXiv
comment says ICML 2020, some indexes say NeurIPS 2020).

## 2. The LEACE-multimodal sweep (open question 1, closed)

Verdict: as of 2026-11-28 the sweep found no work applying LEACE/INLP-style
identity- or attribute-targeted nullspace or linear erasure to a multimodal
encoder where the downstream task is linking, record linkage, entity
linking, or cross-document linking. Search trail (reproducible): Semantic
Scholar Graph API for the three anchors (INLP endpoint stayed rate-limited;
its reference list went unread, a recorded limit), OpenAlex reads of all
433 LEACE citers and 428+50 filtered INLP citers, OpenAlex title/abstract
searches (erasure x cross-modal 196 hits triaged; erasure x entity linking
5; erasure x record linkage 53), an arXiv API diffusion-erasure sweep, and
targeted web queries. Recorded limits: OpenAlex indexing of 2026 preprints
is incomplete, so "unoccupied" is only as strong as the citation graph.

Mandatory differentiation neighbours the card cites (absent from the
2026-11-27 note):
- CLEAR (2026, OpenAlex W7133344427): nullspace projection of a shared
  visual+textual subspace for multimodal recommendation. Closest mechanical
  neighbour; the erasure target is cross-modal redundancy for fusion
  efficiency, not an identity concept, and not privacy or cross-document
  linking.
- ISP (2026, W7151731895): one-shot linear removal of an identity subspace
  from image encoders (CLIP/DINOv2/SSCD) driving face verification toward
  chance. Single-modality visual encoders.
- LANCER (EMNLP 2024, W4404782582) and the document-deconfounding line
  (2025, W4416035283; follow-up 2026, W7235661832): erasure serving text
  retrieval and document similarity. Unimodal.
- SPD (2025, W7106715728) and JVSB (2025, W4413145477): bias-subspace
  erasure on CLIP, evaluated on classification and text-to-image
  retrieval. Multimodal encoders, no linking task.
- Task-conditional leakage (2026, W7237077535): proves a conflict between
  marginal and task-conditional linear guardedness; cited for the H2 probe
  framing (conditional leakage after erasure).

## 3. Licence P0 verifications

- Multi-News: verified against the HF dataset card's LILY Lab agreement
  verbatim ("non-commercial research and educational purposes only ...
  without extending any license or other intellectual property rights");
  HF licence field "other". Stays out of the public recipe.
- Needle 3 (Cactus-Compute/needle3): Apache-2.0, verified on the HF repo.
  The 2026-11-26 note's unverified licence and its "2-bit, 8-29 MB"
  figures are corrected there with a dated marker.
- uCDCR: cited only, never redistributed. The compilation is tagged
  CC BY-SA 4.0; the card and the LREC 2026 paper state no per-corpus
  licence for the 12 constituents; ECB+ is CC BY-NC-SA (espRA,
  registration-gated; that clause rests on search snippets and a human
  re-checks espRA before any corpus decision touches ECB+).

## 4. What the passes did not check (recorded limits)

- INLP's own reference list (Semantic Scholar rate-limited).
- Full-text reading of the ~30 diffusion-erasure papers beyond the three
  cited; per-corpus licence digging beyond ECB+ and WEC-Eng in uCDCR's
  constituents.
- The Mozannar/Sontag venue discrepancy (see above).
- OpenAlex metadata for 2026 preprints is incompletely indexed.
