# 2026 unlearning literature verification — 2026-11-28

Deep-research verification of the papers' identity and erasure claims
against the current literature, run 2026-11-28: 21 sources fetched,
101 claims extracted, the top 25 adversarially verified by independent
3-vote passes (23 confirmed, 2 refuted and excluded). Verification
level: primary-source abstract fetches with verbatim quotes, each
confirmed by three independent votes; a full-text pass was not run, so
every citation resting on this note states abstract-level evidence and
the preprint status. Everything is time-stamped 2026-11-28; several
sources are weeks-old non-peer-reviewed preprints.

## What survives un-preempted

No 2025-2026 prior art was found for deterministic corpus-level
byte-diff erasure receipts or entity-indexed corpus regeneration. Every
verified adjacent work operates on model parameters or empirical
prediction-shift signals: zkUnlearner (arXiv:2509.07290, zkSNARK
verification of SGD unlearning at sample, feature, and class
granularity), Verifiable Unlearning on Edge (arXiv:2506.20037, zk-SNARK
unlearning verification, June 2025), ZK-APEX (arXiv:2512.09953), EVE
(arXiv:2602.03567, perturbed-sample prediction change as an empirical
signal; its only formal element is a statistical hypothesis test, not
an erasure certificate), PRMU (arXiv:2608.11149, corpus-free
parameter-space unlearning), UNLINK-VL (arXiv:2608.03791, post-hoc
setting where the forget and retain corpora no longer exist), and the
RMU-variant line (arXiv:2605.26454).

The founder's 2026-11-28 premise (knowledge is the unit; identity
reserved for the person erasure axis) is consistent with, not
contradicted by, the 2026 literature: arXiv:2605.26454 designs
unlearning per language function with no person axis, and arXiv:2608.21544
frames agentic tool unlearning entirely in knowledge terms.

## Citation obligations this note opens

1. **Provable/verifiable unlearning predates us, model-side.**
   zkUnlearner (arXiv:2509.07290) claims the first zero-knowledge
   framework for verifiable machine unlearning with multi-granularity
   selective unlearning via bit-masking; arXiv:2506.20037 applied
   zk-SNARKs three months earlier, so the "first" designation is
   disputed among those papers themselves. Any claim of novelty for
   provable unlearning in general must cite and differentiate this
   line; the corpus-regeneration mechanism is a different contribution
   class and survives. Papers: graph-grounded (paper 2).
2. **Auditable Unlearning for LLMs (arXiv:2611.05866, Nov 2026)**
   introduces auditability as a fourth unlearning evaluation axis and
   shows deletion evidence can be engineered by design (GapWiden hinge
   loss, GapVeil rejection sampler, oracle parity on auditability and
   leakage across 11 methods on TOFU, MUSE, RWKU). Model-level prior
   art for demonstrable erasure; cite and differentiate. Papers:
   graph-grounded (paper 2).
3. **Forget-set misalignment (arXiv:2609.00605, EMNLP 2026 Main, CONFS)**
   is prior art for targeting what the model actually knows rather than
   externally defined forget sets (under-unlearning leaves leakage;
   out-of-knowledge unlearning degrades utility). CONFS is data-blind,
   eliciting the model's memorized knowledge. The repo does not claim
   this novelty (the graph-grounded paper explicitly disclaims the
   approximate-unlearning axis); cite as the model-side cousin of the
   entity-indexed stance. Papers: graph-grounded (paper 2).
4. **Person-identity deletion is an active 2026 benchmark axis:**
   PRMU (arXiv:2608.11149, corpus-free person-centric knowledge
   unlearning in multimodal LLMs under realistic person deletion
   requests, naturally acquired person knowledge, locality analysis),
   AIM (arXiv:2608.28312), PPU-Bench (arXiv:2605.08800), UnPII
   (arXiv:2601.01786). Papers: local-training (paper 3) and multimodal
   (paper 4), in the sanctioned person-erasure passages.
5. **UNLINK-VL (arXiv:2608.03791):** intra-modal, especially
   text-only, evaluation may substantially overestimate unlearning
   effectiveness in VLMs. The multimodal paper's canary claims carry
   this cross-modal caveat. Papers: multimodal (paper 4); the
   local-training paper's text-only canary suite is scoped by it.
6. **Model-dependent canary recoverability:** Frequency-Conditioned
   Privacy Auditing (arXiv:2611.31581, Nov 2026) shows the repetition
   count before email and phone strings become extractable varies
   substantially across four models (1x to 50x sweep). Below-chance
   exposure claims are scoped to the tested models, never stated
   generally. Papers: local-training (paper 3).

## Supporting evidence worth citing because it argues for us

- **ShadowBench (arXiv:2611.15925, NeurIPS 2026 Evaluations Track):**
  leading unlearning algorithms achieve only superficial lexical
  erasure acting as output filters; popular entities reconstructed in
  internal reasoning traces in over 74 percent of cases (LELR), and
  even at 0 percent LELR niche entities retain 60 to 90 percent shadow
  accuracy via implicit attribute correlation. Figures self-reported
  on its own novel task, unreplicated. Independently supports the
  repo's position that parametric unlearning is unreliable for true
  person-entity erasure. Papers: graph-grounded (paper 2).
- **Tool-mediated recovery (arXiv:2608.21544, Aug 2026):** an agent
  that has unlearned a fact recovers it at inference time via web
  search, retrieval, or database lookup. Direct external evidence that
  erasure must cover the corpus and retrieval layer, which is the
  corpus-level thesis. Papers: graph-grounded (paper 2).

## Coverage gap this note does not close

The adversarial pass produced no surviving verified claim on the Weft
side: the person-independent cross-document theme-linking prior-art
sweep found one novel source after filtering and search tooling was
degraded during verification. Weft's novelty positioning rests on repo
inspection plus the MeMo framing (MeMo, arXiv:2605.15156, is
memory-model fine-tuning with cross-document synthesis in the curation
pipeline, adjacent to but not the same mechanism as small pairwise
source-orthogonal theme linking with certified abstention). A targeted
Weft-only literature rerun is the open follow-up.

## Refuted during verification, excluded

Two claims were killed by 3-vote refutation and are not cited anywhere:
that arXiv:2611.05866 shows no existing method satisfies all four axes
(supporting our positioning), and that cross-modal transfer contradicts
any versieve claim that text-level sanitization suffices (the
multimodal paper does not make that claim).
