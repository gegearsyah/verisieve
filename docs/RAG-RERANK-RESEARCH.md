# RAG rerank: what a second model would add to the sandbox

Research date: 2026-11-16. Written after the handoff. The handoff's Stage 2 only measures the current blend. This note is the survey of a second pass. Nothing here was run on the PubMedQA rows.

Founder word the same evening: these systems stay open as methods. The pair score is what we train locally. Their weight files and the Jev API stay closed.

`orx` is not installed. The pages below were read directly.

## What the sandbox does today

There is no reranker in `Rtio/frontend/lib/versieve`. `retrieveRedactedContext` sorts once. The score is `0.55 * cosine + 0.45 * lexical` when `versieve_dl.wasm` loads, otherwise lexical only. Cosine is the dot product of two 64-dimensional Needle vectors (`searchNeedleWasm`). Lexical is the share of query tokens that occur in the masked chunk. The top 6 chunks, up to 12,000 characters, go to the answer model. There is no minimum score.

Needle is that first ranker. It embeds the question and each chunk separately. A second call on the same six chunks produces the same six dots. It cannot look at the question and the chunk in one forward pass, which is what a reranker does.

The 60% recall@5 in `results/scale-and-paradigm-benchmark.json` is cosine only, on 125 held-out PubMedQA questions. It is not this blend, and it is not a reranker.

## What a rerank pass is

A fast search cuts the corpus to a shortlist. A reranker then scores the question and each shortlisted chunk together and sorts again. It cannot recover a chunk the shortlist dropped. TypeSafe states that limit in their own cookbook: "Re-ranking only reorders the top 30 candidates already on the shortlist. It cannot add a passage that fast search did not select." On the sandbox, the shortlist is 6, not 30. If the useful chunk is 7th, no reranker inside those 6 will surface it. Widening the shortlist and then reranking is the usual shape. ([Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe))

## A small local model that is built for this

Sentence-Transformers publishes cross-encoders trained on MS MARCO passage ranking. The model reads the pair and emits one score. Their card for the usual checkpoint, `cross-encoder/ms-marco-MiniLM-L6-v2`, lists 22.7M parameters. On that card's table, TREC Deep Learning 2019 NDCG@10 is 74.30 and MS MARCO dev MRR@10 is 39.01, at 1,800 documents a second on a V100. The same table's smallest model, `cross-encoder/ms-marco-TinyBERT-L2-v2`, is 4.39M parameters, NDCG@10 69.84, MRR@10 32.56, 9,000 documents a second on the same GPU. Its README header says `license: apache-2.0`. Those numbers are MS MARCO and TREC, not the sandbox's clinical notes. ([MiniLM-L6-v2](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2), [TinyBERT-L2-v2](https://huggingface.co/cross-encoder/ms-marco-TinyBERT-L2-v2))

SBERT's own usage page says a cross-encoder is slower than a bi-encoder because every pair is a forward pass, and that this is why it is applied to the top-k of a bi-encoder rather than to the whole corpus. ([Cross-encoder usage](https://www.sbert.net/docs/cross_encoder/usage/usage.html))

`BAAI/bge-reranker-v2-m3` is the popular multilingual sibling. BAAI lists it at 568M parameters and the file tree shows `model.safetensors` at 2.27 GB. Their "lightweight" is relative to the 2.5B Gemma reranker on the same page. It is the wrong size for a pass that today is a 60,096-byte WASM dot product. ([bge-reranker-v2](https://bge-model.com/bge/bge_reranker_v2.html), [file tree](https://huggingface.co/BAAI/bge-reranker-v2-m3/tree/main))

## Jev, as a score rather than a local model

TypeSafe's rerank cookbook does the second pass with a `Noul`: one yes/no question per query-candidate pair, the returned probability is the sort key, and each pair is a call to `client.system_one` with `model="jev-1.14.0"`. The worked example is CLERC, 3,565 court-opinion passages, 40 queries, BM25 shortlist of 30. The correct passage was already inside that shortlist for all 40 queries, and BM25 put it first 5% of the time. After the Noul sort: top 1 is 30%, top 5 is 57%, top 10 is 65%. The page says a real app would pack several questions about one pair into a single call. The run needs `TYPESAFE_API_KEY`. The passage text leaves the machine.

![Jev rerank diagram](figures/jev-rerank-fanout.png "TypeSafe's rerank diagram for the CLERC cookbook. BM25 keeps a shortlist, then one Noul per candidate reorders it. On their 40 queries, top-1 moves from 5% to 30%. [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe)")

A second cookbook, Classifying RAG passages, uses the same hosted call to drop noisy or contradictory chunks before generation. That page also embeds the corpus with OpenAI. ([Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages))

Jev can be the reranker. It is not a file we can put next to `versieve_dl.wasm`. The sandbox already sends the six masked chunks to Ollama or a bring-your-own key when the user asks a question. A Jev rerank would send those chunks to `api.typesafe.ai` as well, before that.

## What is worth measuring, and what is not

The local probe, on the same 125 PubMedQA questions, trains the VeRA head already in `versieve_dl.wasm` to reorder a shortlist from the current blend. It does not download TinyBERT or MiniLM. Those cards stay here as the shape of the job other people solve with a cross-encoder: one score for the question and the passage together.

Not worth a probe as a "Needle reranker." The vectors are already in the score.

Not a local upgrade: Jev's Noul sort. The CLERC jump is real on their page and it is a legal-citation task with the answer already in the top 30. It does not transfer as a number onto PubMedQA, and it does not run air-gapped.

A score floor on the blend was measured in `results/rag-retrieval-probe.json` and written up in `docs/2026-11-16-rag-redaction-verdict.md`. On the 125 held-out questions, 0 hybrid top scores are below 0.15 and 1 is below 0.30. The local VeRA head, trained inside `versieve_dl.wasm` with no checkpoint loaded, reorders the blend's top 30 and then keeps 6. Gold in that top 6 falls from 121/125 to 39/125. The blend stays the ranker. The floor count is not an abstention cutoff: every query's passage is in the 125.
