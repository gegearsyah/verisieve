# Weft novelty re-check and training-data licence audit (issue #40)

Date: 2026-11-27. Mode: deep-research workflow (105 agents, 23 sources fetched, 114 claims extracted, 25 verified by 3-vote adversarial verification: 23 confirmed, 2 refuted). Status: research note, not a result. This note **extends, not replaces** `2026-11-26-tiny-theme-linker-research.md`; where they overlap, this note carries the verified numbers.

Caveat: all verified claims rest on abstracts and occasionally ar5iv full text; the repo's claim discipline (§5 of the original note) still requires full-text reading before any paper claim. Several 2026 sources (AspectSim, the CDCR annotation papers) are single non-peer-reviewed preprints that may have revisions.

## 1. Net novelty verdict

**Every individual mechanism component of Weft is confirmed prior art (unanimous votes):**

| Component | Prior art | Vote |
|---|---|---|
| Adversarial identity/attribute removal | Elazar & Goldberg EMNLP 2018 ([1808.06640](https://arxiv.org/abs/1808.06640)); Coavoux et al. EMNLP 2018 ([1808.09408](https://arxiv.org/abs/1808.09408)) | 3-0 |
| Null-space iterative erasure (canonical baseline) | INLP, Ravfogel et al. ACL 2020 ([2004.07667](https://arxiv.org/abs/2004.07667)) | 3-0 |
| Adversarial identity-linking on HINs with generated hard negatives | Wang et al. AAAI 2020 ([2002.09803](https://arxiv.org/abs/2002.09803)) | 3-0 |
| Aspect-conditioned similarity | AspectSim ([2601.03435](https://arxiv.org/abs/2601.03435)); AspectCSE, RANLP 2023 ([2307.07851](https://arxiv.org/abs/2307.07851), [anthology](https://aclanthology.org/2023.ranlp-1.113/)) | 3-0 |
| Conformally calibrated abstention thresholds | Conformal Abstention, DeepMind 2024 ([2405.01563](https://arxiv.org/abs/2405.01563), follow-up [2408.08786](https://arxiv.org/abs/2408.08786)) | 3-0 |
| Cross-document coreference/linking | Barhom et al. ACL 2019 ([P19-1409](https://aclanthology.org/P19-1409/)); WEC NAACL 2021 ([2104.05022](https://arxiv.org/abs/2104.05022)); uCDCR LREC 2026 ([2603.00621](https://arxiv.org/abs/2603.00621)) | 3-0 |

**The surviving novelty is exactly the 4-part conjunction staked in the original note §5**, and this re-check found no source that anticipates the conjunction itself. The original note's line "a search ... has not been exhaustively done" is now substantially discharged for these mechanism families. Two refuted claims (bi-encoder entity linking in historical texts, [2406.15576](https://arxiv.org/abs/2406.15576), 1-2 votes each) were excluded.

## 2. Findings that change the spec

### 2.1 Identity-blindness must be worded as a measured probe result, not a guarantee
Elazar & Goldberg: despite the in-training adversary reaching chance-level accuracy, a **post-hoc** classifier still recovers the attribute substantially above chance, and the authors explicitly advise not relying on adversarial training for invariant representations. Consequences:
- Claim "identity-**blind**", never "identity-removed".
- **H2 leak-probe metric must be defined against post-hoc classifiers (including nonlinear), not just the in-training adversary.**
- INLP is the canonical linear-erasure baseline to position against; its own full text concedes nonlinear recovery (85.0% MLP on gender). Follow-ups (RLACE 2022, LEACE 2023, Kernel-INLP 2023) are defined by comparison to it, and nullspace erasure has reached text-to-image diffusion ([2406.07137](https://arxiv.org/abs/2406.07137)); the spec's citation-and-differentiation table must cite that line too.
- Open design decision for the spec: gradient-reversal probe during training, INLP-style post-hoc projection on the exported encoder, or both; they carry different leak guarantees and different H2 falsifier designs.

### 2.2 Wang et al. (AAAI 2020) must be cited and distinguished
GAN-style author disambiguation on a heterogeneous information network, with a generative module mining high-quality negatives via random walk to train an identity discriminator. Weft's novelty cannot rest on "adversarial + identity + HIN"; the hard-negative mechanisms must be explicitly differentiated: Versieve's salting/gatekeeper negatives serve privacy, Wang et al.'s serve disambiguation accuracy, Weft's identity-matched theme-different negatives serve theme discrimination.

### 2.3 Aspect-conditioning is doubly taken
AspectSim (prompting 16 small open LLMs yields only 20-30% human-machine agreement; a two-stage refinement improved it ~140%) supports the distilled-specialist recipe and bounds H5. AspectCSE trains contrastive sentence embeddings supervised by Wikidata KG properties; the KG-grounded-supervision overlap is real and must be cited because the public-release plan uses hyperlink/co-reference/link-graph structure. Divergence to record: AspectCSE's aspects are entity-anchored; Weft's supervision is identity-orthogonal document-graph structure.

### 2.4 Conformal abstention is not novel as a mechanism
Reuse the repo's existing LTT machinery and differentiate at the application level (cross-modal theme linking, pair/set scoring over anchor sets rather than sampled generations). Do not claim a new calibration method.

### 2.5 CDCR family = benchmark substrate, not competitor
uCDCR (LREC 2026) unifies English CDCR corpora with standardized metrics; WEC derives large-scale cross-document event coreference from Wikipedia without predefined topic clusters (the closest public analogue to identity-disjoint buckets); Barhom et al. jointly model cross-document entity and event coreference on ECB+. None is cross-modal or identity-adversarial. Pre-late-2020 CDCR systems were single-corpus (EACL 2021 finding), reinforcing the multi-corpus/leave-one-department-out design.

## 3. Licence audit findings (the P0 gate inputs)

| Source | Verified status | Consequence for the public Weft recipe |
|---|---|---|
| **Multi-News** | **Bespoke LILY Lab Dataset Usage Agreement: "non-commercial research and educational purposes only", no IP licence granted. HF licence "other" now resolved.** | **Not usable in a permissively-licensed public training set. Drop it from the §9.1 plan or restrict to internal non-commercial evaluation only.** |
| Wikipedia dumps | CC BY-SA 4.0 (share-alike) text; CC's official position: its licences cover AI training wherever copyright permission would be required. | Attribution + share-alike obligations attach to derived released data; a Weft training corpus derived from it likely cannot be Apache/MIT-licensed wholesale. |
| OpenAI models as teacher | Usage policy expressly prohibits outputs used to build training material for substitute models (policy effective 2026-11-20). | Hosted-teacher plan must use permissively-licensed open-weight LLMs only; OpenAI teachers are barred. |
| Gemma / EmbeddingGemma | Bespoke Gemma Terms of Use, not OSI open source. | Any use as a base encoder or baseline must be audited against the contract, not assumed open. |
| Needle 3, uCDCR constituent licences | Still unverified (unchanged from the original note). | Remains a P0 gate item. |

## 4. Open questions carried into the spec

1. Has any work applied LEACE-style nullspace erasure to multimodal encoders for linking tasks (would erode the cross-modal leg)? Full-text sweep of the 2406.07137 citation line required before any paper claim.
2. Gradient-reversal probe vs INLP post-hoc projection vs both (different H2 designs).
3. Does Weft share T11/T12's benchmark harness and GPU window, or run in a separate queue? (Recommendation: separate queue, sequenced after T11/T12 land; see §5.)
4. Wikipedia share-alike interaction with the intended dataset licence: pick dataset licence per-source audit or drop Wikipedia-derived pairs from the released set.

## 5. Sequencing and concurrency verdict

- This research pass was read-only (no commits, no test runs, no GPU) and could not interfere with T11/T12.
- The **spec-writing step is also safe now** (writes only new docs files).
- The **Weft implementation orchestration must be queued behind T11/T12 completion**: it touches the estate perception seam and the benchmark harness that T11/T12 are actively modifying, so starting it now risks merge and harness conflicts.

## 6. Spec requirements distilled from this pass

The granular spec for the Weft orchestration must include:
1. A **citation-and-differentiation table** per component (the §1 table) in the model card and paper.
2. H2 redefined against post-hoc nonlinear probes; identity-blind wording everywhere; Elazar & Goldberg caveat quoted.
3. Multi-News removed from the public training recipe; teacher restricted to permissively-licensed open-weight models.
4. uCDCR/WEC/ECB+ named as benchmark substrates with multi-corpus generalization reported.
5. Conformal abstain claimed at application level only, reusing existing LTT machinery.
