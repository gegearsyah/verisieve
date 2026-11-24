# Argon-Parity Literature Review — Primary-Source Verification

**Date:** 2026-11-24
**Method:** Every citation below was verified directly against `arxiv.org/abs/...` HTML metadata or the Crossref API. **Important meta-finding:** web-search tooling repeatedly returned *hallucinated arXiv IDs* (e.g., it attached "2212.05934" to the wrong author, invented "2302.09760" for Barber et al., "2109.26667" for Ramdas et al., "2406.17395" for pyannote). IDs listed below that carried a `✔` check were confirmed by fetching the arXiv abstract page itself. Anything I could not verify is explicitly flagged.

---

## Q1. Clustered/hierarchical conformal prediction — is "design-effect-adjusted n" a proven guarantee?

**Claim under test:** A paper claims a "mathematically guaranteed" false-release bound for clustered documents by shrinking the effective sample size via a survey-sampling design effect, `deff = 1 + (m−1)·ICC`, inside a binomial/Hoeffding tail bound.

**Primary sources (all verified):**

- **Robin Dunn, Larry Wasserman, Aaditya Ramdas.** *"Distribution-Free Prediction Sets for Two-Layer Hierarchical Models."* **arXiv:1809.07441** ✔ (JASA). Extends conformal prediction to two-layer (cluster) data where exchangeability is violated across groups. Methods: CDF pooling (asymptotic coverage only), single and repeated subsampling (coverage guarantees). **The abstract/page does not mention "design effect," "effective sample size," or an iid-binomial-with-deff shortcut.** Subsampling-based coverage is the honest guarantee.
- **Yonghoon Lee, Rina Foygel Barber, Rebecca Willett.** *"Distribution-free inference with hierarchical data."* **arXiv:2306.06342** ✔. Derives a *hierarchical exchangeability* condition and builds conformal prediction and jackknife+ variants with distribution-free guarantees; introduces a stronger "second-moment coverage" property for repeated measurements. Again: **no design-effect binomial shortcut presented as a guarantee.**
- **Yonghoon Lee, Zhimei Ren.** *"Selection from Hierarchical Data with Conformal e-values."* **arXiv:2501.02514** ✔ (FDR control via e-BH for grouped data). Related GHCP follow-up: Mallick, Tchetgen Tchetgen, Dobriban, Lee, *"Generalized Hierarchical Conformal Prediction,"* **arXiv:2608.15500** ✔ (cites "HCP (Lee et al., 2026)").
- **Anastasios N. Angelopoulos, Stephen Bates, Adam Fisch, Lihua Lei, Tal Schuster.** *"Conformal Risk Control."* **arXiv:2208.02814** ✔. Controls the expected value of any monotone loss; generalizes split conformal, tight up to O(1/n). Like standard split conformal it inherits the **exchangeability assumption on calibration and test units**; the paper's extensions are distribution shift, quantile risk control, multiple/adversarial risk, U-statistics — **it does not claim validity for within-cluster correlated data, and does not mention clustered/hierarchical data at all.**
- **Rina Foygel Barber, Emmanuel J. Candès, Aaditya Ramdas, Ryan J. Tibshirani.** *"Conformal prediction beyond exchangeability."* **arXiv:2202.13415** ✔ (Annals of Statistics 2023; NeurIPS 2022 proceedings version "Conformal prediction with distribution shifts"). Provides *robustness* (bounded degradation) when exchangeability fails mildly, and exact validity under weighted / duality conditions (covariate shift, label shift). **It is about cross-unit exchangeability breakdown (drift, shift), not about within-cluster positive correlation as a modeling device.** No design-effect adjustment.

**What the sources actually say:** The conformal literature that *does* guarantee something for clustered data does it by (a) a hierarchical exchangeability assumption (Dunn et al.; Lee et al.) with subsampling or CDF-pooling machinery, or (b) cluster-exchangeability conditions with group-conditional weights. The design effect `1+(m−1)ICC` is a **survey-sampling variance inflation heuristic** (Kish 1965 lineage): it tells you the ratio of the true variance of a cluster-sampled mean to a simple-random-sample mean at *matched variance of the estimator*, not a finite-sample bound quantity that can be dropped into a binomial/Hoeffding tail to certify tail probabilities. In particular (i) ICC is itself estimated from the sample and unstable at small m, and (ii) variance inflation ≠ tail bound for counts of correlated Bernoulli events (Hoeffding requires independence; dependent-variable analogs need concentration results for dependent sums, which are distribution-dependent).

**Verdict for our paper: needs rewording.** The word "guaranteed" via deff-adjusted n inside a binomial/Hoeffding tail is **not defensible as a theorem** — no primary source establishes it, and the actual hierarchical-conformal papers route around exactly this trap. Honest framing options:
1. State the bound and immediately call it a **"heuristic informed by survey-sampling design effects,"** with an explicit caveat that no finite-sample worst-case guarantee is claimed for correlated documents; then cite Dunn et al. (1809.07441, JASA) and Lee–Barber–Willett (2306.06342) as *the* principled alternatives, and use the deff number only as an empirical conservative fudge factor.
2. Or actually adopt the Dunn/Lee assumptions (hierarchical exchangeability) if the release pipeline can satisfy them, and claim what those papers claim (coverage under their conditions).
3. Angelopoulos CRC (2208.02814) may be cited only for monotone-loss control under exchangeability — e.g., for independent units (tiles, frames) — never for clustered documents.

---

## Q2. Anytime-valid e-processes / betting martingales

**Claim under test:** `E_t = ∏ (1 + η(α − L_t))` is a valid anytime-valid test for bounded losses; validity question under non-exchangeability.

**Primary sources (verified against arXiv):**

- **⚠ The frequently quoted ID "arXiv:2109.26667" is wrong — that identifier does not exist on arXiv (HTTP 404).** The verified primary is: **Aaditya Ramdas, Peter Grünwald, Vladimir Vovk, Glenn Shafer.** *"Game-theoretic statistics and safe anytime-valid inference."* **arXiv:2210.01948** ✔; published in *Statistical Science* 38(4):513–528, 2023 (DOI 10.1214/23-SS905). Surveys e-processes, test supermartingales, Ville's inequality, time-uniform validity.
- **Ian Waudby-Smith, Aaditya Ramdas.** *"Estimating means of bounded random variables by betting."* **arXiv:2010.09686** ✔ (**not** the "2210.07075" attached to it by one search result — that ID belongs to a gravity/cosmology paper), JRSS-B 86(1):1–27, 2024. This is the paper whose capital process exactly matches the `∏ (1 + η·(X_t − μ))` form for [0,1]-bounded X_t; it gives nonasymptotic CI and time-uniform confidence sequences, and explicitly extends to **independent but not identically distributed** data.
- **Vladimir Vovk, Ruodu Wang.** *"E-values: Calibration, combination, and applications."* **arXiv:1912.06116** ✔ (*Statistical Science* 36(4), 2021). e-processes as generalization of test martingales; Ville's inequality gives time-uniform false-rejection control.
- Vovk's conformal e-test for exchangeability (COPA 2024 "Testing exchangeability by e-value") appeared in the search tool with ID "2409.14953" — **that ID is wrong** (it belongs to a microservice paper). I could not reach the author-hosted PDF this session, so **treat that specific citation as unverified**; do not rely on it without checking.

**What the sources actually say:** The betting martingale `E_t = ∏(1 + η(μ̂ − L_t))` is a nonnegative supermartingale under the null **`H0: E[L_t] ≥ α` provided the observations form a supermartingale with respect to the filtration — i.e., the conditional mean condition must hold sequentially**. Independence (i.i.d., or independent-not-identical as in Waudby-Smith & Ramdas) is the standard sufficient condition. **Exchangeability is NOT required for the e-process itself** — Ville's inequality is about martingales, not exchangeability. Conversely, if documents are dependent such that the *conditional mean* of the next loss exceeds α, the product stops being a supermartingale and the time-uniform bound breaks with no free correction. (Exchangeability testing with e-values exists as a separate, conformal-testing problem — see the unverified Vovk note above.)

**Verdict for our paper: defensible, with one scope correction.** Frame the guarantee as Ville-inequality validity for **bounded, (near-)independent loss sequences** whose running mean is at least α under the null; say explicitly: *validity requires sequential conditional-mean control (satisfied by independent losses), not exchangeability of documents; if documents arrive in correlated batches, the martingale property must be re-checked or the claim downgraded to a heuristic.* And fix the citation: cite Ramdas et al. 2310.08098 → **no**: cite **arXiv:2210.01948** and Waudby-Smith & Ramdas **arXiv:2010.09686**.

---

## Q3. Submodular perception triage (IB-AMP) — novel or reinventing?

**Claim under test:** Facility-location submodular maximization with knapsack/cost budget for frame triage is algorithmically novel.

**Primary sources (verified via Crossref / arXiv):**

- **G. L. Nemhauser, L. A. Wolsey, M. L. Fisher.** *"An analysis of approximations for maximizing submodular set functions—I."* *Mathematical Programming* 14:265–294, **1978** ✔ (Crossref). The (1 − 1/e) greedy bound for cardinality-constrained monotone submodular maximization. (Companion Part II: Fisher, Nemhauser, Wolsey, *Mathematical Programming Studies*, 1978 ✔.)
- **S. Khuller, A. Moss, J. Naor.** *"The budgeted maximum coverage problem."* *Information Processing Letters* 70(1):39–45, **1999** ✔ (Crossref). **This is the primary source for the knapsack/cost-budget coverage bound**: the plain cost-benefit greedy achieves (1 − 1/e)·(1/2) ≈ 0.316; with (partial) enumeration it achieves 1 − 1/e for coverage functions. For general monotone submodular under a single knapsack constraint, the 1 − 1/e with 3-enumeration is **M. Sviridenko, "A note on maximizing a submodular set function subject to a knapsack constraint," Operations Research Letters 32(1):41–43, 2004** ✔ (Crossref).
- **L. Minoux.** *"Accelerated greedy algorithms for maximizing submodular set functions."* Lecture Notes in Control and Information Sciences (Springer), **1978** ✔ (Crossref) — the lazy-greedy evaluator (lazy evaluation priority queue).
- **A. Krause, D. Golovin.** *"Submodular Function Maximization."* Chapter in *Tractability: Practical Approaches to Hard Problems* (Cambridge University Press), **2014** ✔ (Crossref). Survey chapter that presents the cost-benefit greedy and its (1−1/e)/2-type bound along with lazy evaluation.
- **Video summarization precedent:** **M. Gygli, H. Grabner, L. Van Gool, "Creating Summaries from User Videos," ECCV 2014 (LNCS/ECCV)** — selection of summary segments by greedy maximization of an importance + diversity (facility-location-style) submodular objective; introduced the SumMe benchmark. Also on arXiv: **E. Kazemi et al., "Streaming Non-monotone Submodular Maximization: Personalized Video Summarization on the Fly," arXiv:1706.03583** ✔ (verified title).

**What the sources actually say:** Facility-location under a cost budget with lazy greedy evaluation is four decades old and the video domain application (frame triage ≈ frame selection for summarization) is established since at least Gygli ECCV 2014 and Kazemi et al. 2018. The specific factor to fix: **citing the cost-benefit greedy as "(1−1/e)" is wrong — plain greedy-on-ratio gives (1−1/e)/2 for budgeted coverage (Khuller–Moss–Naor 1999); 1−1/e needs Sviridenko-style enumeration (2004).**

**Verdict for our paper: algorithmic novelty must not be claimed.** IB-AMP's selection machinery is a known submodular video-summarization algorithm transplanted into a document/VLM triage pipeline. Correct framing: cite Nemhauser 1978 + Khuller–Moss–Naor 1999 + Minoux 1978 (or Krause–Golovin 2014) as the algorithmic basis, cite Gygli 2014 / Kazemi 1706.03583 as the frame-selection precedent, and scope novelty to the **systems integration** (no_std/WASM, memory budget, end-to-end redaction pipeline) and to any empirical contribution — not to the submodular formulation. If the current draft says "(1−1/e) greedy under budget," correct it to (1−1/e)/2 or cite Sviridenko.

---

## Q4. Retrieval beats fine-tuning for knowledge injection

**Claim under test:** reviewer-requested citation "retrieval beats fine-tuning for knowledge injection."

**Primary sources (arXiv IDs all verified ✔):**

- **Ovadia et al.** *"Fine-Tuning or Retrieval? Comparing Knowledge Injection in LLMs."* **arXiv:2312.05934** ✔ (IBM). Exact finding (from abstract): comparing unsupervised fine-tuning vs RAG across knowledge-intensive tasks, "while unsupervised fine-tuning offers some improvement, **RAG consistently outperforms it**, both for existing knowledge encountered during training and entirely new knowledge"; LLMs "struggle to learn new factual information through unsupervised fine-tuning."
- **Alex Mallen, Akari Asai, Victor Zhong, Rajarshi Das, Daniel Khashabi, Hannaneh Hajishirzi.** *"When Not to Trust Language Models: Investigating Effectiveness of Parametric and Non-Parametric Memories."* **arXiv:2212.10511** ✔ (ACL 2023). Introduces **PopQA**; finding: retrieval-augmented LMs "largely outperform orders of magnitude larger LMs" on less popular (long-tail) entities, while unassisted LMs remain competitive only on high-popularity entities.
- **Nikhil Kandpal, Haikang Deng, Adam Roberts, Eric Wallace, Colin Raffel.** *"Large Language Models Struggle to Learn Long-Tail Knowledge."* **arXiv:2211.08411** ✔ (ICML 2023). Finding: a model's QA accuracy strongly correlates with the count of relevant pre-training documents; long-tail facts are learned poorly, and models would need orders-of-magnitude scaling to master them (hence retrieval is the effective remedy).

**Verdict: must cite X — all three are real, verified, on-point.** Lead with Ovadia 2312.05934 (the direct head-to-head the reviewer asked about), supported by Mallen 2212.10511 and Kandpal 2211.08411.

---

## Q5. Chart/diagram understanding & document figure extraction SOTA

**Claim under test:** is "least-squares pixel-to-value axis calibration for bar charts" a known technique, and where can a no_std WASM implementation claim novelty?

**(a) Chart-to-data / chart understanding (arXiv IDs verified ✔):**
- **DePlot** is **arXiv:2212.10505** ✔ (*"DePlot: One-shot visual language reasoning by plot-to-table translation"*, Liu, Fang, et al./Google) — translates plots to linearized tables then feeds a LLM; pixel-to-data via detection + demapping. The ID in circulation ("2212.10902") is **a graph-theory paper** ✔ — do not cite it.
- **MatCha: "Enhancing Visual Language Pretraining with Math Reasoning and Chart Derendering,"** **arXiv:2212.09662** ✔.
- **ChartQA: "A Benchmark for Question Answering about Charts with Visual and Logical Reasoning"** (Masry et al., ACL 2022), **arXiv:2203.10244** ✔ (not "2203.10274" — that variant appears in circulation but the verified ID ends **10244**).
- **Pix2Struct: "Screenshot Parsing as Pretraining for Visual Language Understanding,"** **arXiv:2210.03347** ✔.
- Geometric (non-learned) chart-data extraction lineage — closest primary precedents for a classical axis-calibration pipeline: **"Tensor Fields for Data Extraction from Chart Images: Bar Charts and Scatter Plots,"* arXiv:2010.02319 ✔; "Data Extraction from Charts via Single Deep Neural Network," arXiv:1906.11906 ✔; "Automated data extraction of bar chart raster images," arXiv:2011.04137 ✔; "Context-Aware Chart Element Detection," arXiv:2305.04151 ✔; "Chart-RCNN: Efficient Line Chart Data Extraction from Camera Images," arXiv:2211.14362 ✔; "LineFormer: Rethinking Line Chart Data Extraction as Instance Segmentation," arXiv:2305.01837 ✔.

**(b) PDF layout/table extraction:**
- **"Nougat: Neural Optical Understanding for Academic Documents,"** **arXiv:2308.13418** ✔ (Meta, MIT).
- **"TableFormer: Table Structure Understanding with Transformers,"** **arXiv:2203.01017** ✔ (IBM). (There is a different "TableFormer: Robust Transformer Modeling for Table-Text Encoding," arXiv:2203.00274 — citing the wrong one is an easy trap.)
- **Camelot, pdfplumber, Tabula:** software tools, no arXiv papers. pdfplumber's ruling-line vector table detection is standard, well-documented practice in the PDF-processing ecosystem (Leland McInnes' pdfplumber GitHub docs). **Vector ruling-line extraction is a solved-standard technique** — a WASM re-implementation can claim engineering, not scientific, novelty.

**(c) Flowchart/diagram recognition:**
- **AI2D:** Kembhavi, Salvato, Kolve, Seo, Hajishirzi, Farhadi, *"A Diagram is Worth a Dozen Images,"* ECCV 2016 (LNCS) ✔ (Crossref) — the AI2D diagram dataset.
- **"HDFlow" for flowchart recognition: could NOT be verified.** The only arXiv "HDFlow" ✔ papers (e.g., arXiv:2409.17433, "Enhancing LLM Complex Problem-Solving with Hybrid Thinking and Dynamic Workflows") are about LLM workflows, not flowchart recognition. If our draft cites an "HDFlow flowchart paper," either find the real ID or drop the cite.

**Verdict: axis calibration for bar charts is a known technique.** Plot digitizers such as **WebPlotDigitizer** (automeris.io, browser-based, verified as live software this session; the tool is "Computer vision assisted data extraction from charts"; its standard workflow is user-defined axis calibration — clicking known axis reference points — followed by automated point extraction for bar/line/scatter charts, and an accompanying 2019 v4.x software release by A. Rohatgi, Pacific Northwest National Laboratory) implement exactly this. Classical CV chart-extraction papers listed above do the same (axis mapping from bar geometry). **A no_std WASM implementation has zero scientific novelty in method** — claim novelty only in systems attributes (O(1)/bounded memory, zero-import WASM, fully client-side, deterministic), and say "consistent with standard plot-digitization practice (WebPlotDigitizer; tensor-field chart extraction)".

---

## Q6. Speaker diarization without neural models

**Claim under test:** classical YIN pitch + filterbank timbre clustering achieves usable 2-speaker diarization on clean synthetic audio; how should DER expectations be set vs pyannote?

**Primary sources (verified):**
- **A. de Cheveigné, H. Kawahara.** *"YIN, a fundamental frequency estimator for speech and music."* *J. Acoustical Society of America* 111(4):1917–1930, **2002** ✔ (Crossref; not on arXiv — JASA is the correct citation form).
- **S. S. Chen, P. S. Gopalakrishnan.** *"Clustering via the Bayesian information criterion with applications in speech recognition."* ICASSP 1998 ✔ (Crossref) — the canonical BIC-change-detection/clustering reference; with **R. Tritschler & R. Gopinath, "Improved speaker segmentation and segments clustering using the BIC," Eurospeech 1999** ✔ (Crossref), the canonical BIC-diarization lineage.
- **D. Reynolds, T. Quatieri, R. Dunn.** *"Speaker Verification Using Adapted Gaussian Mixture Models,"* *Digital Signal Processing* 10(1–3):19–41, 2000 ✔ (Crossref) — GMM-UBM, basis for spectral-timbre clustering.
- **X. Anguera, S. Bozonnet, N. Evans, C. Fredouille, G. Friedland, O. Vinyals.** *"Speaker Diarization: A Review of Recent Research."* *IEEE Trans. Audio, Speech, and Language Processing* 20(2), 2012 ✔ (Crossref) — the standard review of the classical (BIC/linkage/GMM) era; use it for honest historical DER context.
- **pyannote:** the frequently circulated "arXiv:2406.17395" for "pyannote 3.1" is **wrong — that ID is a graph-theory paper** ✔ ("The coherent rank of a graph..."). Verified authoritative sources instead: the Hugging Face model card **`pyannote/speaker-diarization-3.1`** (fetched this session ✔) reporting **full strict DER (no collar, overlap scored): AMI Mix-Headset 18.8%, DIHARD 3 21.7%, VoxConverse 11.3%** (FA/miss/confusion e.g. 3.6/9.5/5.7 on AMI); and the papers the card itself cites: **H. Bredin, "pyannote.audio 2.1 speaker diarization pipeline: principle, benchmark, and recipe," Interspeech 2023**, and **A. Plaquet, H. Bredin, "Powerset multi-class cross entropy loss for neural speaker diarization," Interspeech 2023**.

**What the sources actually say:** DER convention comes from NIST Rich Transcription evaluation (missed speech % / false alarm % / speaker-confusion %, with a chosen forgiveness collar); pyannote's strict/full numbers above are with collar 0, overlap scored. Classical BIC systems historically landed well above neural pipelines on multi-speaker, multi-channel, noisy corpora (see Anguera et al. 2012 for era-typical error rates), while pyannote-3.1-class neural systems sit near ~19% (AMI full) and ~11% (VoxConverse) with zero dataset tuning.

**Verdict: feasible but must set honest expectations.** On **clean, synthetic, 2-speaker, clearly separated voices**, classical YIN pitch + filterbank/GMM timbre + agglomerative clustering can plausibly approach single-digit DER, but this is *not evidenced* by any benchmark in the literature — there is no standard public benchmark for this exact setting, so our paper should (a) cite YIN 2002, Chen & Gopalakrishnan 1998, Anguera et al. 2012 for the classical method, (b) cite the pyannote-3.1 model-card numbers (18.8% AMI DIHARD VoxConverse above) only as the neural reference under a *different, much harder* evaluation protocol, and (c) present our synthetic-audio results without comparing numbers across protocols. Frame: "engineering demonstration; no SOTA claim."

---

## Q7. LLM-as-judge and cross-family judge bias

**Primary sources (verified):**
- **Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, et al.** *"Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena."* **arXiv:2306.05685** ✔ (NeurIPS 2023). The abstract itself names the three core biases: **position bias, verbosity bias, and self-enhancement bias** (judges favoring their own outputs), plus limited reasoning ability; GPT-4 judges reach ~80%+ agreement with humans.
- **Peiyi Wang, Lei Li, Liang Chen, Zefan Cai, Dawei Zhu, et al.** *"Large Language Models are not Fair Evaluators,"* **arXiv:2305.17926** ✔ (ACL 2024). Finds judges systematically favored their own (or their family's) model family in pairwise comparisons; proposes calibration of the positional bias. (Commonly miscited as "Liu et al." — the verified first author is **Wang**.)
- **Arjun Panickssery, Samuel Bowman, Shi Feng.** *"LLM Evaluators Recognize and Favor Their Own Generations."* **arXiv:2404.13076** ✔. Self-preference persists even after controlling for answer quality — judges can *detect* their own outputs and rate them higher. Strongest direct evidence for family/own-generation bias.
- **DeepSeek:** *"DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning,"* **arXiv:2501.12948** ✔ (DeepSeek-AI, MIT license). Verified distill bases (from the paper's distillation table / model cards): **Qwen-based distills: 1.5B (Qwen2.5-Math-1.5B), 7B (Qwen2.5-Math-7B), 14B (Qwen2.5), 32B (Qwen2.5); Llama-based: 8B (Llama-3.1-8B) and 70B (Llama-3.3-70B).** The DeepSeek-R1-Distill-Qwen-7B model card ✔ states the model is a fine-tune of **Qwen2.5-Math-7B** using 800k R1-distilled samples.
  - Also verified ✔: **DeepSeek-Coder-V2 ("Breaking the Barrier of Closed-Source Models in Code Intelligence," arXiv:2406.11931)**; **DeepSeek-VL2 ("Mixture-of-Experts Vision-Language Models for Advanced Multimodal Understanding," arXiv:2412.10302)**.
- Guidance on R1-style outputs: the R1 model card (fetched ✔) warns the distills **"tend to bypass thinking pattern"** (emitting empty `</think>` tags) and recommends forcing the response to start with `</think>\n` — i.e., long-CoT behavior is unstable by default and must be prompted for.

**Critical finding for our Paper 3:** models evaluated are **Qwen2.5-0.5B / 1.5B**. A **DeepSeek-R1-Distill-Qwen-7B judge is NOT a cross-family judge** — it is a Qwen2.5-family model with R1 distillation on top, and the judged models and the judge share both the Qwen base lineage and (at 7B vs 0.5B/1.5B) a direct size hierarchy. Both Zheng 2306.05685 (self-enhancement bias) and Panickssery 2404.13076 (own-generation preference) imply this arrangement is systematically suspect. A genuinely cross-family judge that fits an 8GB RTX 4070 at 4-bit is a 7–9B **Llama, Mistral, or Gemma** model (e.g., Llama-3.1-8B-Instruct, Mistral-7B-Instruct, Gemma-2-9B-it quantized; Phi-4-14B is borderline at 8 GB with 4-bit quant). R1-distill's forced `</think>` long-CoT adds latency and token cost and there is no verified primary-source study showing R1-style models are *better* structured 1–5 rubric judges; given rubric scoring is a short structured task, a standard instruct model with the rubric in-prompt is the defensible choice.

**Verdict: needs rewording + must cite X.** If Paper 3 currently calls DeepSeek-R1-Distill-Qwen "cross-family," that is incorrect and must be changed. Cite Zheng 2306.05685 and Panickssery 2404.13076 for judge bias, and re-designate the judge as a non-Qwen family (Llama/Mistral/Gemma) — or, if keeping the Qwen-lineage judge, disclose the lineage overlap openly as a limitation.

---

## Standing caveats (verify-before-cite list)

1. **Web-search tools hallucinated at least eight arXiv IDs in this session** (2109.26667, 2310.08098, 2302.09760, 2406.17395, 2212.10902→for DePlot, 2409.14953, 2411.03803, 2506.13247). Every ID in this file was checked against the arXiv abstract page itself unless explicitly flagged. Re-check any ID not carrying ✔ before it enters a paper.
2. **Unverified / could not confirm:** (a) the specific "HDFlow" flowchart-recognition paper; (b) "ChartOCR" as a standalone paper (title search on arXiv returned nothing; I substituted the verified chart-extraction lineage above); (c) Vovk's COPA-2024 conformal e-test for exchangeability (author site unreachable this session); (d) any published DER benchmark for classical (non-neural) 2-speaker diarization on clean synthetic audio — none exists in the verified literature, so present such numbers as our own experiment only.
