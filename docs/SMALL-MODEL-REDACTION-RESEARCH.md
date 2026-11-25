# Small-model PII redaction: what is ready, and what can live in this sandbox

Research date: 2026-11-16. Question: is it impossible to redact the way other groups do, with a smaller model that is already ready to use — Needle, Jev, another small model, or a judgment method?

`orx` is not on PATH. The npm package named `orx` (0.2.0) is an unrelated library, so it was not used. Claims below were read from the paper, the model cards, and TypeSafe’s docs.

## Short answer

It is possible, and the method is already packaged. The groups that beat a regex redactor do it with a **span tagger**: a small bidirectional encoder that scores candidate spans against a list of types and returns a start, an end, a type, and a probability. Redaction is then a string replace. That model is not Needle, and it is not Jev.

Needle embeds a whole chunk into 64 dimensions. Jev answers a typed question at `https://api.typesafe.ai/v1/systemone`. Neither one returns character offsets from local weights.

## How the published method works

GLiNER (Zaratiana, Tomeh, Holat, and Charnois, NAACL 2024) is the method Presidio and the later PII checkpoints implement. The authors state the design in one sentence:

> The core concept of our model involves treating the task of Open NER as matching entity type embeddings to textual span representations in latent space, rather than as a generation task.

([GLiNER, p. 1](https://www.alphaxiv.org/pdf/2311.08526?page=1))

![GLiNER span matcher](figures/gliner-span-matcher.png "Figure 2. Entity-type prompts and the sentence go through one bidirectional encoder. A feed-forward layer makes a type vector, a span layer makes a vector for each span up to 12 tokens, and a dot product plus a sigmoid is the probability that this span is that type. [p. 2](https://www.alphaxiv.org/pdf/2311.08526?page=2)")

What to notice in that diagram:

- The label list is an input (`Person`, `Organization`, `Location`, separated by a learned `[ENT]` token). A new type is a new prompt, not a new output head.
- Spans are enumerated up to length K = 12, so the cost stays linear in the sentence. The match score is a sigmoid of a dot product, trained with binary cross-entropy, and decoded by greedy non-overlapping selection above 0.5.
- The paper’s smallest reported model, GLiNER-S, is 50M parameters. On their out-of-domain NER table it scores an average F1 of 52.7, ahead of ChatGPT and of an 11B instruction-tuned NER model. That table is general NER (names, places, organizations), not a PII redaction benchmark. ([GLiNER, p. 2 and Table 1](https://www.alphaxiv.org/pdf/2311.08526?page=2))

The paper does not redact PII. The ready PII checkpoints are later fine-tunes of this same span matcher.

## Ready models, and whether this repo can ship them

**GLiNER PII, the one Presidio already calls.** `urchade/gliner_multi_pii-v1` is a fine-tune of `urchade/gliner_multi-v2.1` on `urchade/synthetic-pii-ner-mistral-v1`. The parent v2.1 card lists that multilingual checkpoint at 209M parameters and Apache-2.0. Presidio’s own sample labels the PII checkpoint Apache 2.0 and shows `GLiNERRecognizer` with default `model_name="urchade/gliner_multi_pii-v1"`, threshold 0.30, and an optional ONNX file. You pass the type names; it returns spans. The English “small” card, `urchade/gliner_small-v2.1`, is 166M and Apache-2.0. That 166M file is not the paper’s 50M GLiNER-S.

Sources: [gliner_multi_pii-v1](https://huggingface.co/urchade/gliner_multi_pii-v1), [gliner_small-v2.1](https://huggingface.co/urchade/gliner_small-v2.1), [Presidio GLiNER sample](https://github.com/microsoft/presidio/blob/main/docs/samples/python/gliner.md), [GLiNERRecognizer](https://github.com/microsoft/presidio/blob/main/presidio-analyzer/presidio_analyzer/predefined_recognizers/ner/gliner_recognizer.py).

**A 45M edge tagger, the smallest ready PII file found.** `Deerpark/pii-tagger-edge` is a 45M GLiNER. The card says the ONNX file `onnx/model_f16.onnx` is 91 MB, the threshold used on their dev sets is 0.35, and the model returns positions and writes no text. Its base is `knowledgator/gliner-pii-edge-v1.0` (Apache-2.0), built on `jhu-clsp/ettin-encoder-32m`. On a locked set of 165 agent-written documents (3,850 labelled details) the card reports 94.0% of details fully hidden and 4.2% of other words hidden, against Presidio plus spaCy `en_core_web_lg` at 49.5% / 7.3% on that same set. The card also says those documents were written by Claude agents, the labels were not given a human second review, and the model reaches 93.8% on names and 88.1% on addresses. That 94% is not a score on the ai4privacy 500 rows used in the Versieve note. The card does not restate its own license in the text that was fetched; the base model is Apache-2.0. Source: [Deerpark/pii-tagger-edge](https://huggingface.co/Deerpark/pii-tagger-edge).

**Piiranha, ready and local, and not vendored.** `iiiorg/piiranha-v1-detect-personal-information` is a token classifier, a fine-tune of `microsoft/mdeberta-v3-base`, context 256 tokens, 17 PII types plus a non-PII class. The card opens with the license `cc-by-nc-nd-4.0`. Non-commercial and no-derivatives means this file cannot be modified into `versieve_dl.wasm` or shipped inside the product. The card’s headline recall, 98.27%, is binary PII-token versus non-PII on their own test of about 73,000 sentences. Per-type F1 on that test is lower (surname recall 0.78, given-name F1 0.90, email F1 1.00). Do not place 98.27% next to the note’s 31% tag recall. Source: [Piiranha v1](https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information).

## Needle

`embedNeedleWasm` in `src/wasm-needle-dl.js` builds a 64-dimensional vector for a whole string. It calls `mle_dl_embed_subword` and then `mle_dl_bitnet_init` / `mle_dl_bitnet_encode` with a seed. There is no checkpoint, no entity-type prompt, and no span score. RTIO uses that vector as a corpus centroid after the regex masks are already written. A centroid can say “this chunk is off the theme of the upload.” It cannot say “characters 12–24 are a surname.”

`versieve_dl.wasm` is 60,096 bytes. The 45M ONNX file above is 91 MB, on the order of 1,500 times that kernel. Loading it is a new runtime (ONNX or Transformers.js), with the same fail-closed rule the image path already uses when Mirage weights are absent.

## Jev

Jev is a hosted decision model. TypeSafe’s models page says every model is served by `POST /v1/systemone`, with question types Choice, Score, Noul, and Box. Jev 1.14.0 and 1.13.0 are the published IDs. The page states that Jev is not fine-tuned or LoRA-adapted with customer data, and that the same weights serve every account. It publishes no parameter count, no weight file, and no local runtime. Source: [docs.typesafe.ai/models](https://docs.typesafe.ai/models).

The enterprise page lists “Can we run Jev in our own VPC or on-premises?” among its FAQ questions. The HTML fetched on this date contains the question and does not contain an answer. Zero data retention is described as an enterprise option, which is a retention promise about data that has already been sent. Source: [typesafe.ai/enterprise](https://typesafe.ai/enterprise).

A Jev question can judge a span only after the span’s text has left the machine. The portable note’s constraint is that the record is not transmitted for redaction. Jev can be a second opinion on text that is already allowed to leave. It cannot be the redactor for text that must not leave.

## The judgment method that does fit

Presidio’s shape is the one that matches this repo: pattern recognizers for emails, cards, and phones, plus one NER recognizer for the types a pattern misses (bare names, street addresses). The 520-dimensional logistic already in this repo is a judgment method at the wrong granularity. It scores a line as keep, review, or drop. Redaction needs a score per span.

A local version of that second stage, if it is added later:

1. Keep the current regex for structured types.
2. Run a downloaded span tagger only on the residual text, with the label list limited to the types the regex misses.
3. Replace each accepted span in place, the way `maskTextContextAware` already replaces a regex hit.
4. Ship an Apache-2.0 or MIT ONNX file, pinned by hash, and fail closed when the file is absent. Piiranha’s CC-BY-NC-ND-4.0 card rules that checkpoint out.
5. Measure it on the same 500 ai4privacy rows and the same matcher as `runPiiDisambiguationExperiment` before any number goes into the note. The 94% and 98% figures above are other people’s tests.
