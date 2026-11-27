# Paper novelty audit: are the architectural contributions introduced properly?

- **Date:** 2026-11-27
- **Scope:** all four papers in `paper/`
- **Lens:** novelty versus prior art, with practical value and the training-data thesis as secondary axes
- **Deliverable:** per-paper verdict, local evidence, and a section-level edit plan. No `.tex` edits applied.

## Verdict summary

| Paper | Main architectural novelty | Introduced properly? | Severity |
|---|---|---|---|
| A, extraction and redaction | Zero-host-import WASM curation stack, single-header C99 parity, LTT release policy | No. Asserted as layers, never positioned against prior art. No related-work section. | Medium-high |
| B, graph-grounded corpus | Entity-indexed standalone-knowledge schema, Amnesiac Corpus regeneration, graph-grounded composition | Yes. Related work names the closest system for each claim; a dedicated non-claims section bounds them. | Low |
| C, local training | `PT-LM` and `IB-PT-LM` | `PT-LM` yes. `IB-PT-LM` no: one exploratory subsection, zero citations, zero mentions in abstract, introduction, related work, limitations, or conclusion. | High for `IB-PT-LM` |
| D, multimodal sanitization | `SR-MP`, `HC-CRC`, `E-LTT`, `AC-CRC` | Mostly yes. `HC-CRC` and `E-LTT` are exemplary. `SR-MP` is defined only in the results, after first use. `AC-CRC` is correctly scoped as exploratory. | Low-medium |

The founder's instinct is correct, and it names the sharpest case: `IB-PT-LM` is a genuine architectural mechanism presented as a benchmark addendum. The same failure is milder in Paper A and narrower in Paper D.

## Paper A: extraction and redaction

**What the paper claims architecturally.** Three layers at `paper/versieve-extraction-redaction-benchmark.tex:55-60`: a browser workbench, a portable curation engine shared across browser, Node, MCP, and a 2,129-byte C99 header, and five zero-host-import WASM kernels totaling 388,797 bytes. The abstract at line 44 leads with the same stack.

**What is missing.**

1. **No related-work section.** The only positioning is one paragraph titled "Related systems and privacy boundaries" at line 62. It cites local MCP redaction tools, CuratorKIT, conformal abstention, PII-leakage analyses, and attacker-based auditing. It does not cite a single WebAssembly systems paper, even though zero-import load-time auditability is the paper's most distinctive architectural property.
2. **No inherited-versus-new split.** The introduction lists the layers as contributions, but never says which parts are established building blocks. WASM sandboxing, PDF CMap parsing, logistic regression, and Learn-Then-Test all have prior art. The paper cites LTT at line 232 but does not state what its own gate adds: three-way fail-closed release routing, the multi-axis customer-label conjunction, and the C99/JS parity.
3. **The strongest claim is asserted, not argued.** "Zero host imports" appears in the abstract, introduction, figure caption, and appendix, but the paper never compares the boundary with existing WASM sandbox or edge-data systems, and never states why load-time import surface is the right audit primitive. A reader cannot tell whether this is a novel architecture or a packaging choice.
4. **The gate's novelty is under-described.** The paper applies LTT. Paper D explains the cluster-robust and streaming extensions and benchmarks them against formal baselines. Paper A should say plainly that its contribution is the release policy and the fail-closed operationalization, not the LTT statistic.

**Edit plan.**

- Add a short Related Work section with four paragraphs: WASM and edge-data sandboxes; local de-identification and curation pipelines (Presidio, CuratorKIT, MCP redactors); conformal selective prediction and LTT; PDF and layout extraction. Cite `haas2017wasm` and at least one non-internal system baseline already run (Presidio and GLiNER-Edge are in Section 4).
- Add a `\paragraph{Scope of novelty.}` paragraph after the introduction, using Paper D's paragraph at `versieve-multimodal-sanitization-benchmark.tex:54` as the template. State the inherited blocks and the three deltas: the zero-import kernel boundary shared byte-identically across substrates, the single-header C99 parity, and the fail-closed three-way release policy with multi-axis conjunction.
- Concede the LTT ancestry explicitly. The external sweep confirmed that LTT (`arXiv:2110.01052`) already covers model-agnostic operation, refit-free calibration, arbitrary risk notions, and selective classification with abstention, and that Conformal Risk Control (`arXiv:2208.02814`) is the monotone-loss alternative. Paper A's gate is an LTT application. Add both citations next to the existing `angelopoulos2021ltt` citation and state that the contribution is the fail-closed three-way policy and the multi-axis conjunction, not the statistic.
- Treat the zero-import boundary as a packaging and audit choice until related work is cited. The sweep found no audited prior art for or against "zero host imports" as a novelty claim. That is a coverage gap, not a novelty certificate. Cite the WASM sandbox literature and describe the boundary as the implementation vehicle for the fail-closed policy.
- In the abstract, add one sentence that names the system-level delta rather than only the stack. Keep every number.
- In Section 5, add one sentence: LTT is inherited; the contribution is the three-way rule, the drop floor, and the fail-closed certificate behavior under insufficient calibration.

## Paper B: graph-grounded corpus

**What the paper claims.** A sample schema that carries entity identifiers, classes, byte-range provenance, and a per-sample certificate; an Amnesiac Corpus that is a deterministic function of inputs, view, and engine version; relational composition by entity-graph traversal over actual source bytes.

**Why it works.**

1. Related Work at lines 68-84 is organized by competing approach, not by citation count: positional chunking (GraphGen, CuratorKIT), CAG, entity-centric objectives (Entities-as-Experts, KEPLER, in-context pretraining, Multi-News, EmbGen), machine unlearning (SISA, TOFU, verifiable unlearning), and redaction limits (CLIOPATRA, LeakageBench, Staab et al.). Each paragraph states the structural difference, not just the citation.
2. The Amnesiac Corpus is defined in the introduction at line 61 and explicitly distinguished from amnesiac retraining: exact deterministic regeneration with a byte-diff receipt versus forgetting batches without a receipt.
3. Section "What This Paper Does Not Claim" at lines 278-287 bounds every claim, including the null trained-format result and the construction-validation status of the perception numbers. This is the strongest claim discipline in the suite.

**Minor gap.** There is no explicit numbered contributions list. The Amnesiac Corpus is introduced inside an enumeration rather than in its own named paragraph. A reader who skims the abstract and introduction still gets the schema and erasure claims, so this is polish, not a defect. The external sweep did not verify the Amnesiac Corpus or composition prior art, so the paper's own related work remains the strongest positioning evidence in the suite, but a human literature check before submission is still required.

**Edit plan.** Optional only: add a three-item contributions list after the introduction and give the Amnesiac Corpus one defining sentence in its own paragraph. No claim changes.

## Paper C: local training, and the `IB-PT-LM` problem

**`PT-LM` is introduced properly.** Related Work at lines 74-76 names selective loss masking prior art (`Rho-1`, Goldfish Loss, SLUNG, RMFT, Surprise Masking) and type-consistent surrogate substitution (`Anonymous-by-Construction`), then narrows the claim explicitly to placeholder-tag echo and in-scope false refusal on 0.5B to 1.7B LoRA adapters. Section 3.2 gives the objective as an equation at line 118, defines the placeholder set, and states that the mechanism account is operational rather than measured. The multi-seed ablation separates masking, surrogate substitution, and abstention subsampling. This is how a mechanism should be introduced.

**`IB-PT-LM` is not introduced at all.** The evidence is exact:

- The string `IB-PT-LM` appears only in one subsection, `paper/versieve-local-training-benchmark.tex:400-411`.
- It does not appear in the abstract, the three research questions at lines 53-58, Related Work at lines 71-78, the Limitations section at lines 413-425, or the Conclusion at lines 427-438.
- The subsection has no equation, no method block, no algorithm, no citation, and no prior-art paragraph. The word "information-bottleneck" is used without citing the information-bottleneck literature; "counterfactual" is used without counterfactual-augmentation literature; "symmetric KL" is used without the distillation or invariance literature.
- The checked-in artifact is labeled exploratory, and the paper says so at line 411, but the surrounding framing gives the reader no way to tell whether this is a contribution, an ablation, or a pilot.
- The mechanism is evaluated on one model (`Qwen2.5-0.5B-Instruct`), three seeds, 152 training examples, and two bespoke probes: suffix-inversion exposure and an 8-way linear hidden-state probe. Those are not standard measures, so the claim must be scoped to those probes.

**Why this is the same failure the paper already fixed once.** The prior review (`paper/review/C-local-training-review.md`, finding S1.1 and S1.2) said the paper buried `PT-LM` and duplicated the companion. The revision promoted `PT-LM` into the abstract, introduction, related work, equation, and conclusion. `IB-PT-LM` was appended after that review and repeats the pattern. The process, not the author, is the problem: every new named mechanism needs the same promotion checklist or an explicit exploratory label that keeps it out of the contribution framing.

**Edit plan.**

1. **Related Work paragraph.** Add one paragraph after line 76 covering: information bottleneck (Tishby and Zaslavsky 2015; Alemi et al. 2017 deep variational IB), counterfactual data augmentation (Kaushik et al. 2020), invariance and IRM-style objectives (Arjovsky et al. 2019), symmetric KL and co-distillation (Hinton et al. 2015; Anil et al. 2018), and the privacy fine-tuning line already cited. State the delta: two strictly disjoint surrogate pools plus an aligned, non-PII-only symmetric KL term as a training-time invariance objective over redaction surrogates. Concede that each component has prior art and that the combination is the contribution. These are candidate citations from the mechanism families; the external sweep did not verify them, so check each before inserting.
2. **Method block.** Move the mechanism out of the results into Experimental Design, or add a dedicated Method subsection. Give the objective explicitly: assistant-only cross-entropy plus `beta` times the symmetric KL between the two views over aligned non-PII causal positions, with `beta = 0.2`. Define the two pools, the disjointness audit, and the alignment restriction. State why disjoint pools are load-bearing: a shared pool would let the model collapse both views to the same surface.
3. **Claim scope.** Add one sentence to the subsection and one to Limitations: the evidence is one 0.5B model, three seeds, two bespoke probes, 2.05x training wall-clock, zero inference overhead; it is not a general privacy guarantee and has not been tested at 1.5B or 1.7B.
4. **Contribution framing.** Add one sentence to the abstract and one to the introduction's three-question list. Either promote `IB-PT-LM` to a named fourth contribution with method and results, or keep it exploratory and say in the introduction that the paper also reports an exploratory arm. Do not leave it unmentioned in both places.
5. **Decision.** Keep it in Paper C rather than splitting to a Paper E. The evidence is on the same pipeline, model family, and canary suite, and the paper is already the mechanism paper for loss masking. A standalone Paper E would need a second model and a standard memorization metric to stand alone.
6. **Bibliography.** Add the IB, counterfactual augmentation, invariance, and symmetric-KL entries. The current `versieve-local-training-benchmark.bib` has none of them.

## Paper D: multimodal sanitization

**What is exemplary.** The `\paragraph{Scope of Novelty.}` paragraph at line 54 is the template the rest of the suite should copy. It names the established building blocks, states three contributions, and distinguishes what is new to this paper from what is shared with the companion. `HC-CRC` and `E-LTT` are introduced with the design-effect motivation at line 178, compared against Dunn, Lee, and `HG-CRC` in Table `tab:hier-baselines`, and explicitly labeled a conservative heuristic rather than a proven finite-sample guarantee at line 180. `AC-CRC` is correctly kept as an opt-in offline note at line 421, with the online default unchanged and the artifact marked exploratory.

**Two gaps.**

1. **`SR-MP` is defined after it is used.** The architecture section at lines 66-91 lists the 512-slot ring as one row of a table but never defines the mechanism. The definition, equation, and slot layout appear only in Exp. 5 at lines 343-348, after Exp. 1 and Exp. 4 have already reported `SR-MP` results. The phrase "inspired by sparse reference pools in long-horizon document perception" is uncited.
2. **`AC-CRC` is absent from the scope paragraph.** It is scoped correctly in Exp. 7, but a reader of the introduction does not know a fourth mechanism exists. Either add one clause to the scope paragraph or state that `AC-CRC` is an exploratory offline audit outside the paper's main claims.

**External prior art sharpens both gaps.** The sweep confirmed three things Paper D should say out loud.

1. `SR-MP` is not a new problem statement. Multi-database and multi-party PPRL with Bloom encodings is prior art (`Vatsalan, Christen, and Rahm, arXiv:1701.01232`), and streaming entity resolution over incomplete data is prior art (`Ter-iDS, arXiv:2103.08720`, SIGMOD 2021). The surviving delta is the 204 KB WASM packaging and the cross-modal risk propagation across paragraphs, slides, ASR turns, and keyframes. The paper should cite both lines and claim the delta, not the problem.
2. Salted Bloom plus Soundex is a perturbation-based PPRL encoding with documented cryptanalytic and graph attacks (`Christen et al., arXiv:2505.08596`; IEEE TKDE 2019 Bloom cryptanalysis; Vidanage et al., CIKM 2020 graph attack). Paper D already concedes the Bloom attack in Exp. 5 and calls the ring a local-only noisy erasure index. That concession should move into the Scope of Novelty paragraph, and the salting should be described as mitigation, not a privacy guarantee.
3. `HC-CRC` and `E-LTT` are assumption relaxations, not new guarantee classes. Conformal Risk Control (`arXiv:2208.02814`) is the parent, LTT (`arXiv:2110.01052`) is the FWER ancestor, and `HG-CRC` (`arXiv:2607.24562`) already occupies hierarchical group-conditional risk control. The sweep found that `HG-CRC` leaves dependence-aware multiplicity as future work, which is exactly the seam `HC-CRC` occupies. Cite CRC as the parent, cite `HG-CRC` as a preprint rather than an established baseline, and describe `HC-CRC` as relaxing exchangeability for document-clustered calibration. For `E-LTT`, concede that anytime-validity and dependence-robust FDR are prior art (`SAVI, arXiv:2210.01948`; e-BH, `arXiv:2009.02824`); the novelty is risk control over document-clustered release decisions, not anytime-validity itself.

**Edit plan.**

- Move the `SR-MP` definition and equation into the System Architecture section as a subsection. Leave the PPRL reality check, scale collision test, and cross-modal stress results in Exp. 5.
- Add the two PPRL/ER citations above to the Scope of Novelty paragraph and to Exp. 5, and narrow the claim to WASM packaging plus cross-modal propagation.
- Move the Bloom-attack concession into the Scope of Novelty paragraph.
- Cite `CRC (arXiv:2208.02814)` and `LTT (arXiv:2110.01052)` in the Scope of Novelty paragraph; describe `HC-CRC` and `E-LTT` as assumption relaxations for clustered text, not new guarantee classes.
- Label `HG-CRC` as a preprint in the bibliography or text, and do not present its dependence-aware multiplicity as solved.
- Cite the sparse-reference-pool inspiration or delete the phrase. An uncited "inspired by" is worse than no lineage claim.
- Add one sentence to the Scope of Novelty paragraph: `AC-CRC` is an exploratory, opt-in offline compliance-audit mode, not part of the online default.

## Cross-paper pattern and process fix

The suite already contains the correct template: Paper D's Scope of Novelty paragraph, Paper B's related-work-by-approach structure, and Paper C's `PT-LM` treatment. The failure is not stylistic ignorance. It is that new mechanisms are appended after a review pass and never re-enter the framing.

Add one binding editor ruling:

> Every named mechanism must appear in the abstract, the introduction's contribution list, Related Work with its closest prior art, a method block with an equation or algorithm, and Limitations with its claim scope. A mechanism that cannot meet all five is labeled exploratory in the introduction and excluded from the abstract and contribution claims.

Applying that rule now would flag `IB-PT-LM` immediately and would have flagged Paper A's zero-import stack and Paper D's `SR-MP` definition placement.

## External prior-art verification

The sweep ran 107 agents over five search angles, fetched 25 primary sources, extracted 125 claims, and adversarially verified 25. Nineteen survived a 3-vote bar and six were refuted. Coverage is asymmetric: all confirmed claims map to `SR-MP`, `HC-CRC`/`E-LTT`, or Paper A's LTT gate. Nothing was verified for `IB-PT-LM` or the Amnesiac Corpus, so those two remain un-audited, not cleared.

| Mechanism | Closest verified prior art | Surviving delta | Claim action |
|---|---|---|---|
| Paper A gate | LTT `arXiv:2110.01052`; CRC `arXiv:2208.02814` | Fail-closed three-way release policy, multi-axis conjunction, C99/JS parity. Not model-agnosticism, refit-freedom, arbitrary-risk support, or marginal-only operation, all of which LTT already claims. | Concede LTT/CRC in Related Work and name the release-policy delta. The zero-import WASM boundary has no verified prior-art coverage either way, so do not claim it as novel until the WASM literature is cited. |
| `SR-MP` | Multi-database PPRL with Bloom encodings, `arXiv:1701.01232`; streaming entity resolution over incomplete data, Ter-iDS `arXiv:2103.08720`; PPRL leakage, `arXiv:2505.08596`; Bloom cryptanalysis, IEEE TKDE 2019; graph attack, CIKM 2020 | 204 KB WASM packaging and cross-modal risk propagation across paragraphs, slides, ASR turns, and keyframes. Not a new problem, not a new streaming framing, and not a privacy guarantee. | Cite both problem lines and the attack literature. Move the Bloom-attack concession into the Scope of Novelty paragraph. Describe salting as mitigation. |
| `HC-CRC` and `E-LTT` | `HG-CRC` `arXiv:2607.24562` for hierarchical group-conditional CRC; CRC `arXiv:2208.02814`; LTT `arXiv:2110.01052`; SAVI `arXiv:2210.01948`; e-value conformal prediction `arXiv:2503.13050`; e-BH `arXiv:2009.02824` | Cluster-robust, dependence-aware risk control for document-clustered calibration. An assumption relaxation, not a new guarantee class. `HG-CRC` explicitly leaves dependence-aware multiplicity as future work, which is the seam. | Cite CRC as parent and `HG-CRC` as the hierarchical antecedent. Concede anytime-validity and dependence-robust FDR to the e-value line. Label `HG-CRC` as a preprint and do not present it as an established improvement. |
| `IB-PT-LM` | None verified | Un-audited. The mechanism families a proper introduction must cite are information bottleneck, counterfactual data augmentation, IRM/invariance, symmetric-KL distillation, and the privacy fine-tuning line already in Paper C. | Do not assert novelty. Run the missing sweep and add the citations before submission. The local framing failure is independent of the prior-art gap and is already actionable. |
| Amnesiac Corpus and composition | None verified | Un-audited. Paper B's own related work already cites GraphGen, CuratorKIT, CAG, KEPLER, Entities-as-Experts, in-context pretraining, Multi-News, EmbGen, SISA, and TOFU with per-system structural differences. | No framing change required on the local evidence. Human-check the erasure-receipt prior art before submission. |

**What the sweep establishes, and what it does not.** It establishes that Paper D's statistical claims are assumption relaxations with named ancestors, and that `SR-MP` is a packaging and propagation delta, not a new linkage problem. It does not establish that `IB-PT-LM` or the Amnesiac Corpus are novel. Absence of a verified prior-art claim is a coverage limit, not evidence of novelty. The six refuted candidate claims (for example, that `HG-CRC` is empirical only, or that e-values are not risk control) must not be used to defend either paper.

**Caveats.** `HG-CRC` is a 27 July 2026 v1 preprint with no peer review. `arXiv:2505.08596` and `arXiv:2511.00414` are preprints. CRC (ICLR 2023), LTT (NeurIPS 2022), SAVI (Statistical Science 2023), and e-BH (JRSS-B 2022) are peer-reviewed. Recheck `HG-CRC` before camera-ready because it may gain a revision.

## Swarm assessment

This run used 107 agents, 6.4 million subagent tokens, and about 17 minutes to fetch 25 primary sources and verify 25 claims. The adversarial layer did real work: six candidate claims were refuted, including two attempts to overstate or understate `HG-CRC` and one attempt to call an e-value method the direct ancestor of `E-LTT`. Every surviving claim carries a source URL and a vote.

The weakness is coverage, not accuracy. Search angles map to indexed literature, so mechanisms with a named academic line (`LTT`, `CRC`, `PPRL`, `e-values`) produced dense, verifiable findings, while `IB-PT-LM` and the Amnesiac Corpus produced nothing. A null result from this swarm is not evidence of novelty. It means the mechanism is either too new, too implementation-specific, or described in vocabulary the search did not index. For those two, the next step is a human literature check in the specific venues (privacy-preserving ML, unlearning, data-centric AI), not another generic sweep.

## Bottom line

Paper C is the one paper that should not go out as currently framed. `IB-PT-LM` is a real architectural mechanism with a measured result, and it is invisible everywhere a reviewer looks for contributions. Paper A needs a related-work pass and an explicit LTT concession; the architecture is real, but the paper currently presents inherited building blocks and new release policy in the same undifferentiated list. Paper D needs the `SR-MP` definition moved earlier and its claims narrowed against PPRL and streaming ER prior art, while its `HC-CRC` and `E-LTT` treatment is already close to exemplary. Paper B needs only polish: its related work and non-claims section are the model the other three should follow.

## Cut-first revision model

The edit plans above are additive. That is the wrong default for a paper that is already long. This section supersedes them with a net-zero rule.

### Five tests

1. **One claim, one home.** Each claim, mechanism, and number has one canonical location. Every other mention is a pointer, not a restatement.
2. **Triple-restatement test.** If a number appears in a table, a caption, and prose, keep the table and one of the other two. If a claim appears in the abstract, introduction, results, and conclusion, keep the abstract and the canonical section, and compress the rest to a pointer.
3. **Stack-recap test.** Any description of the shared stack (five kernels, 388,797 B, zero host imports, salted vault, Graph-PPR) outside its architecture or definition section becomes a cross-reference to the paper that owns it.
4. **Companion-duplication test.** Anything already reported in a companion paper gets one pointer sentence, as Editor Ruling 7 already requires. Do not re-explain the method or re-list the numbers.
5. **Net-zero rule.** Every new positioning paragraph is paired with cuts of equal or greater length in the same paper. A revision that only adds is incomplete.

The cuts below are estimates. Verify with `wc -w` before and after; current source counts are A 4,657, B 8,416, C 7,818, D 6,854 (LaTeX included, so treat them as relative budgets, not prose counts).

### Cut list

| Paper | Cut location | Redundant with | Action | Est. words saved |
|---|---|---|---|---|
| A | Fig. 2 caption (176) and body (182, 184) | The same four recall numbers and the 2.72x lexicon result appear three times | Keep the numbers in the caption; body states the ceiling argument only | 90 |
| A | Body after Table `tab:external-ner` (206) | Every row of the table is recited in prose | Keep the delta and the pluggable-redactor conclusion; drop row-by-row numbers | 110 |
| A | Fig. 1 caption (214) and body (264) | Same BinomCDF values and the 299-item threshold | Keep the derivation in the body; caption keeps the annotation only | 70 |
| A | Fig. 3 caption (304), body (332, 335), Table `tab:substrates` | Startup, RSS, and BCE numbers appear in all three | Keep the table plus one interpretive sentence per substrate | 120 |
| A | Abstract (44-45) | Layer enumeration repeats the architecture section | Keep the system-level delta; compress the layer list | 40 |
| B | Abstract (45), intro (59), artifact note (130) | Paper A's five-kernel, 388,797 B, zero-import fact and per-kernel byte counts | One sentence plus a citation to Paper A; move digests to the artifact note | 120 |
| B | Intro properties (56-66) vs. Section 3 (86-107) | Three properties defined twice | Keep Section 3 canonical; intro names only | 80 |
| B | Head-to-head (205-251) | Table rows recited in prose | Keep the interpretation; drop per-stratum recitation | 100 |
| B | Non-claims (278-287) and conclusion (289-292) | Same caveats twice | Merge the conclusion into non-claims | 40 |
| C | Abstract (43-45) | Findings (214-219) and Tables `tab:trackd-3model`, `tab:ptlm-sweep` | Keep three headline results; drop per-model cell recitation | 150 |
| C | Table 3 caption (176) | Condition definitions already in Section 3.2 and the findings | Caption becomes a column legend | 70 |
| C | Findings 1-3 (214-216) | Table `tab:trackd-3model` | Keep one delta and one p-value per finding | 180 |
| C | T3 instability paragraph (219) | Same table and finding 1 | Compress to two sentences | 60 |
| C | Recipe sweep prose (224, 226) and caption (229) | Grid design and the 0.03-bit caveat appear three times | Keep the caption; cut the prose recitation | 100 |
| C | Prompt comparison (331) | Table `tab:prompt-examples` | Keep the qualitative contrast; drop the numbers | 50 |
| D | Abstract (45) | Body sections and tables | Keep three contributions and four headline numbers; drop the full container list, repeated kernel spec, secret-scan and TAB row recitation, and Jaro-Winkler detail | 200 |
| D | HC-CRC section (175-276) | Table `tab:hier-baselines` | Keep the assumption-relaxation argument; drop per-row numbers | 80 |
| D | `SR-MP` definition (343-348) | Architecture table (82) | Move the definition to Architecture; results keeps only outcomes | 0 net, about 15 lines relocated |
| D | Exp. 6 and 7 (373-421) | Abstract | Drop restated numbers | 70 |
| D | Limitations (423-436) | Results and Scope paragraph | Keep only caveats not stated at the claim site | 60 |

### Revised net plan

| Paper | Cut | Add | Net |
|---|---|---|---|
| A | ~430 | ~350 (Related Work ~260, Scope ~90) | ~-80 |
| B | ~340 | ~120 (contributions list ~60, Amnesiac paragraph ~60) | ~-220 |
| C | ~610 | ~420 (of which ~200 is the existing IB subsection moved, not new) | ~-190 |
| D | ~410 | ~110 (citations and scope clauses; `SR-MP` moved) | ~-300 |

The suite can absorb every positioning fix and still shrink by roughly 790 source words, about 3 percent of the current total. The larger gain is structural: the reader stops meeting the same number in four places.

### What must survive every cut

- Each verified number at its canonical table, and the one prose sentence that interprets it.
- Each limitation at its claim site: the fail-closed behavior, the exploratory labels on `IB-PT-LM` and `AC-CRC`, the non-PII restriction on the IB symmetric-KL term, the detector-closed (not differential-privacy) certificate, and the Jaro-Winkler caveat that keeps the `SR-MP` claim honest.
- The single sentence that concedes inherited prior art. Concessions are short; they are not the bloat.

### Editor ruling to add

> A revision that only adds text is incomplete. Every new framing paragraph must name the paragraph or number it replaces or compresses, and the paper's word count must not increase.

This is the missing half of the mechanism checklist. The checklist says where a mechanism must appear; the net-zero rule says what must leave to make room.
