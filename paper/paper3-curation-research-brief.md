# Paper 3 research brief: graph-grounded curation vs SOTA

Source: deep-research workflow run wf_8d6314ba-2a2, 2026-11-28. 21 primary sources, 102 claims extracted, 25 verified by 3-vote adversarial verification (22 confirmed, 3 refuted). Every finding below carries its verification vote.

## Verdict

Qualified yes. The thesis targets a real, documented gap, and the nearest published evidence favors it rather than opposing it. But no published experiment has tested graph-grounded, provenance-verified curation head-to-head against SOTA. The honest title framing for paper 3 is "a graph-grounded, provenance-verified curation pipeline evaluated under the SOTA curation testbed", not "beats SOTA" and with no priority claim (house wording rule), until the head-to-head experiment runs.

## Verified findings

1. **SOTA curation is uniformly model-based filtering over raw Common Crawl** (3-0). DCLM's 41 controlled experiments found model-based filtering is the decisive lever. FineWeb-Edu built the canonical classifier (Llama3-70B-Instruct scored 460-500k webpages 0-5 for educational quality; linear regressor on Snowflake-arctic-embed-m trained on 410k labels, 82% F1 at threshold 3, ~6,000 H100 GPU-hours over 15T tokens). Cite FineWeb-Edu as paradigm-establishing; DCLM-Baseline and Nemotron-CC are the current leaders.
   - arXiv:2406.11794, arXiv:2406.17557, HF FineWeb-Edu card, arXiv:2412.02595

2. **Concrete falsifiable baselines** (3-0). DCLM-Baseline: 7B model to 64% 5-shot MMLU at 2.6T tokens (+6.6pp over MAP-Neo, 40% less compute). Nemotron-CC: 6.3T tokens, MMLU parity with DCLM at 4x more unique real tokens; its high-quality subset gives +5.6 MMLU over DCLM at 8B/1T (best-case single benchmark; the 15T run shows only +0.5 average vs Llama 3.1 8B across ten tasks). FineWeb-Edu: 33.6% MMLU at 38B tokens where Matrix needed ~300B (~10x token efficiency); filter lifts MMLU 33% to 37% and ARC 46% to 57% at fixed 350B tokens.
   - arXiv:2406.11794, arXiv:2412.02595, arXiv:2406.17557, HF FineWeb-Edu card

3. **Exploitable weakness: the quantity-vs-quality ceiling** (3-0). Aggressive filtering removes roughly 90% of tokens (FineWeb-Edu threshold-3 removed 92%, keeping 1.3T of 15T; threshold-2 keeps 5.4T). Nemotron-CC's authors explicitly argue this limits suitability for long-horizon (15T-token) pretraining. A pipeline that keeps quality signal while retaining token quantity targets exactly this documented gap.

4. **The structural gap is real** (2-1, substance confirmed; one verifier flagged that "generic crawl filtering" is imprecise for Nemotron-CC's ~10% synthetic augmentation). No SOTA baseline (DCLM, FineWeb, FineWeb-Edu, Nemotron-CC) uses graph structure, provenance verification, or entity indexing. DCLM pool is 240T tokens of Common Crawl. The "self-aware dataset" design space is unoccupied.
   - datacomp.ai/dclm, arXiv:2406.11794, arXiv:2508.17964

5. **Closest existing evidence for the thesis: AFCS** (3-0; strong caveats). Atomic-Fact-Conditioned Synthesis (arXiv:2610.20086, preprint 14 Oct 2026): extracts source-supported atomic facts with structure-aware extraction and source-grounded verification, then conditions synthetic generation on each retained fact. Continued-pretraining of OLMo-3-7B and a 32B base on the same FineWiki source corpus: AFCS data beats WRAP and Nemotron-CC on SimpleQA, SimpleQA Verified, PopQA, HotpotQA. Existence proof that fact-grounded, source-verified curation beats SOTA synthetic baselines at matched source data. Caveats: one month old, non-peer-reviewed, self-reported, one-sided win set (no losing benchmarks reported in abstract), "matched" means matched source corpus not matched compute. AFCS is the direct methodological neighbor of Versieve's provenance-verified extraction and the strongest known lever to combine with it.

6. **Entity-structured pretraining improves knowledge fidelity: KILM** (3-0; weakest rung). arXiv:2302.09170: generative knowledge-infilling during continued pretraining, no architecture change, no added parameters; models retain more knowledge and hallucinate less on knowledge-intensive tasks. Caveats: T5-family encoder-decoders at modest scale, no effect sizes in abstract, transfer to decoder-only 1B+ unverified. Verification REFUTED the stronger reading that KILM substitutes for scale (0-3).

7. **The "smarter per token" framing has support** (3-0). Up to 4 epochs of repeated data yields negligible loss change vs fully unique data at fixed compute (arXiv:2305.16264, 400+ models). A smaller, denser, graph-grounded corpus with modest repetition is not automatically disadvantaged. Verification REFUTED two stronger readings (0-3 each): no hard ceiling where marginal compute value decays to zero past 4 epochs, and no evidence that removing curation filters preserves training signal. The 4-epoch point is a soft knee, not a cliff; metric is loss, not downstream generalization.

8. **Conventional curation silently skews corpora** (3-0). C4's blocklist removed African American English documents at 42% and Hispanic-aligned English at 32%, vs 6.2% for White-aligned English (Dodge et al., EMNLP 2021, arXiv:2104.08758, Section 5.3), with no per-document exclusion log. Gives paper 3 a governance/auditability claim alongside the performance claim: Versieve's exclusion ledger is a receipt, C4's is nothing.

9. **The evaluation paradigm is fixed** (3-0). DCLM holds model and recipe fixed (OpenLM recipes, 412M-7B, 53 downstream evals, 240T-token pool) so the dataset is the only variable. A Versieve/WEFT pipeline enters as a bring-your-own-dataset comparison and must adopt the same protocol: same model, same recipe, differ only the dataset. FineWeb-Edu, Nemotron-CC, and AFCS all report under exactly this protocol.

## Refuted claims (these bound the thesis)

- KILM-trained models outperform 30x-larger zero-shot entity-disambiguation models (0-3). Entity enrichment does not substitute for scale.
- Hard repetition ceiling past 4 epochs where marginal compute value decays to zero (0-3).
- Mitigation experiments show removing curation filters preserves training signal (0-3).

## Adjacent evidence found after the workflow: MeMo (arXiv:2605.15156v2, May 2026)

"MeMo: Memory as a Model" (NUS/A*STAR/Liquid AI/MIT): fine-tunes a small Memory model on a five-step curated QA pipeline (extraction, consolidation, verification, entity surfacing, cross-document synthesis) so a frozen Executive LLM queries weights instead of retrieving. Beats HippoRAG2, Cartridges, BM25 on 2 of 3 benchmarks; robust to distractors. Consequences for us:

1. Strongest external validation of the paper-1 document_qa seam (curated QA SFT beating chunk formats and closing on retrieval) at funded scale. Paper 1's "retrieval wins at this scale" verdict stays intact (scoped to 0.5-1.7B); MeMo shows the crossover with a proper data pipeline. Must cite.
2. They have no compliance half: no PII/memorization/unlearning/erasure discussion at all, no entity index, provenance acknowledged as obscured, Executive may be a proprietary API (corpus egress). Amnesiac Corpus + byte-diff receipts + sealed retrain is the missing half; their per-corpus retrain cost is the pain point deterministic regeneration answers.
3. Their O(k*C^2*Q^2) cross-document synthesis is brute-force theme discovery: WEFT theme nodes as the deterministic graph-traversal front-end is a concrete answer to open question 4 (WEFT's contribution to data quality).
4. Evaluation-consumer option for paper 3: train Memory models on Versieve-curated vs model-filtered data under a fixed Executive, a downstream test that isolates corpus knowledge value more cleanly than DCLM pretraining.
5. Uses Qwen2.5-1.5B and LFM2.5-1.2B in ablations (our model families); documents an LFM LoRA target mismatch (out_proj, ShortConv unadapted) relevant to our LFM3 and W5 quantization results.

## Open questions paper 3 must answer

1. Does graph-grounded, provenance-verified curation beat model-based filtering with model, recipe, and token budget all matched? No head-to-head exists. This is the core experiment.
2. Does entity-indexed structure transfer to decoder-only models at 1B+? All positive evidence (KILM) is T5-family encoder-decoder.
3. Can graph-grounded curation break the 90%-removal ceiling, or does provenance verification itself become a lossy filter at web scale?
4. What is WEFT's actual contribution to data quality? No verified claim links routing/quantization to dataset quality; the WEFT-dataset synergy is currently an assumption and needs its own ablation.
5. How to evaluate an enterprise-domain corpus fairly when every baseline is web-scale and MMLU carries crawl-contamination risk. A domain-grounded eval suite is needed alongside the 53-task battery.

## Positioning against the two companion papers

- Paper 1 (local-training-benchmark): redaction/PT-LM/retrieval results; positive format result at 540 questions (document-grounded QA 30.56% vs composed 19.45%, +11.11pp, p=0.0005).
- Paper 2 (graph-grounded-enterprise-corpus): identity-graph composition measured, honest null at starved budget (composed 11.7% vs per-block 10.0%, McNemar p=1.00); graph pays as retrieval index (53.3%) and router (68.3% end-to-end, 81.7% oracle). Composition costs measured: 14.32x false-merge amplification, near-duplicate fraction 1.0.
- Paper 3 occupies: (a) the unoccupied identity+theme grounding axis (paper 2's graph is identity-only; theme/knowledge linking is where in-context pretraining, EmbGen, GraphGen report gains), (b) the SOTA-curation comparison neither companion cites, (c) AFCS-style fact-conditioned synthesis grounded by Versieve provenance and selected by WEFT.

## Paper plan (founder decision, 2026-11-28)

The WEFT work becomes its own component paper (paper 5: identity-blind theme linking, model + benchmark + gates, per spec issue #40), NOT a section of the curation paper. The curation paper consumes a gate-passed WEFT as one arm. Sequencing: the downstream experiment runs only after ALL WEFT gates pass (post-W5, post claim audit), because a null against a broken linker is uninterpretable. Open decision: the WEFT paper is conditional on the W4 release gate (beat the static baseline on identity-disjoint pairs); decide the fallback (reranker framing vs negative-results paper) before the 47k-pair run lands.

### Paper 5: Weft as its own paper, in a different framing

Paper 5 exists because Weft answers a different question than paper 3 does. Paper 3 asks a corpus question (does graph-grounded, provenance-verified curation beat model-based filtering at matched model, recipe, and token budget). Paper 5 asks a model question (can a small quantized specialist link identity-matched, theme-different documents with a certified abstention bound, and what does identity-blindness measurement actually show on such a head). The curation paper cites paper 5 and consumes gate-passed Weft as one arm; the two papers never merge.

Title direction follows the house ruling: the title hits the training-data question (what identity-blind linking buys for corpus and training-data construction), privacy words never lead, and identity-blindness appears as a measured post-hoc probe result with the probe family fixed and reported, never as a headline property.

Contents, sourced from the W7 release packaging (`release/weft-specialist-v1/`, committed on PR #57):

- The model: the int4 (F1 0.9572, 20,458,033 bytes) and int8 (F1 0.9652, 23,642,917 bytes) artifacts with digests in the release manifest, plus the clean-runtime readings (int4 0.9655, int8 0.9825 on the 200-pair sample).
- The benchmark: the W1 per-bucket baseline shootout (bm25, model2vec static threshold, MiniLM cosine, BERTopic-style, local LLM judge) as pointers to `results/weft-baselines.json`, never a copy.
- The calibration machinery: the conformal threshold (0.5000 at both alphas), coverage 16.1 percent (310 of 2000 pairs answered), the certified 5.0 percent bound at alpha 0.05, and the test-half point estimate (11 of 161, 6.8 percent, wide-noise labeled).
- The honest failure modes and limits from the model card, including the 240-word envelope, the style-blind out-of-distribution tripwire (the W5 note live-eval 6.7 percent reading vs the ledger's 0.0669 v4-eval tripwire rate, both provenances stated), and uncalibrated theme thresholds.
- The novelty position from the full-text verification record: the conjunction (identity- or attribute-targeted nullspace or linear erasure on a multimodal encoder with linking as the task) is unoccupied as of 2026-11-28, with the six mandatory neighbours (CLEAR, ISP, LANCER, the deconfounding line, SPD, JVSB) cited and differentiated row by row; no single component is claimed.
- The claim audit as a methods contribution: 40 traced claims (24 measured, 16 citation), a scripted fail-closed audit with a content-addressed runId, which is itself a reproducibility artifact reviewers can rerun.

Framing depends on the founder's story-36 scoring-path ruling, recorded `blocked-pending-founder-ruling` in the release manifest: on the identity-disjoint bucket the size-matched static embedding baseline scores F1 0.9973, the specialist's pooled cosine 0.9989 (passes), and the ruled link head 0.3617 (fails). If the founder rules pooled cosine the scoring path, paper 5 frames Weft as the specialist encoder plus its calibration and abstention machinery, and the bucket is reported as degenerate for any embedding scorer (see the curation brief's own bucket critique in the experiment skeleton). If the link-head ruling stands, the fallback framings apply (reranker framing vs negative-results paper) and are decided before the 47k-pair run lands, per the open decision above.

## Suggested experiment skeleton

Enter the DCLM bring-your-own-dataset protocol at the smallest credible scale (412M-1B, fixed OpenLM recipe): arms = raw crawl control, FineWeb-Edu-class model-filtered control, graph-grounded + provenance-verified corpus, same corpus + AFCS-style fact-conditioned synthesis, WEFT-selected variant. Token budgets matched. Eval on the 53-task battery plus a domain-grounded suite immune to crawl contamination. Ablate WEFT's selection contribution separately (open question 4). Report the honest null risk the companions established: identity composition alone did not separate at starved budget, so the claim must live in the theme-axis and budget-scaling, both designed-not-run in paper 2.
