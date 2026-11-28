# MeMo citation verification record — 2026-11-28

Full-text verification of "MeMo: Memory as a Model" (Quek, Lee, Leong,
Verma, Prakash, Chen, Low, Rus, Solar-Lezama; arXiv:2605.15156v2, 20 May
2026, non-peer-reviewed preprint, venue status marked) against the
arXiv HTML (v2), before citing it in paper 3
(`versieve-local-training-benchmark.tex`, Related Work and Scope). Two
read passes over the full page text, 2026-11-28.

## Verified facts the citation rests on

1. **Task and design:** a frozen Executive LLM answers by querying a
   separate, fine-tuned Memory model trained on a generator-driven
   five-step curated QA pipeline (direct facts, consolidated facts,
   verified rewrites, entity descriptions, cross-document connections).
2. **Results:** consistently outperforms all baselines on NarrativeQA
   and MuSiQue under both Executives (Qwen2.5-32B, Gemini-3-Flash);
   NarrativeQA 26.85 vs HippoRAG2 21.39; MuSiQue 48.30 vs 42.17.
   Narrowly trails HippoRAG2 on BrowseComp-Plus under the Qwen
   Executive (54.22 vs 56.11); leads under the Gemini Executive
   (66.67 vs 66.33). Cartridges and BM25 trail on both.
3. **Scale:** the main Memory model is Qwen2.5-14B-Instruct, 3 epochs.
   The size and family ablations use Qwen2.5-1.5B-Instruct, Gemma3-1B-IT,
   and LFM2.5-1.2B-Instruct ("models of similar parameter scale,
   1 to 2B"). The citation states the 14B main model and marks the
   1 to 2B ablation models as the ones inside paper 3's envelope.
4. **No compliance half:** no PII, memorization, unlearning, or erasure
   analysis appears. The impact statement's closest content is a
   dual-use warning, and it states the approach "may obscure the
   provenance of retrieved information". The paper's own limitation:
   "MeMo incurs an upfront training cost for each new corpus."
5. **Merging:** TIES merging (rho = 0.3) cuts compute by 33 percent at
   K=2 but trails full retraining by 11.04 percent (Qwen Executive)
   and 19.11 percent (Gemini) on NarrativeQA. Not cited in paper 3;
   recorded here because the per-corpus retrain cost is the pain point
   the companion corpus paper's deterministic regeneration answers.

## Placement decision

Cited in the zero-training-versus-fine-tuning positioning paragraph of
paper 3's Related Work and Scope, as funded-scale evidence for the
crossover direction (curated QA fine-tuning beating retrieval) that
paper 3's own retrieval-wins verdict is honestly scoped against
(0.5B to 1.7B, one 8 GB consumer GPU). No head-to-head is run: MeMo's
main Memory model is 14B with a 32B-class Executive, outside the local
envelope. The paper 3 curation research brief (2026-11-28) already
ruled this paper "Must cite" and maps its consequences; this record is
the full-text verification backing that citation.
