# W5: paraphrase strata moved to the source axis (issue #59 rulings)

Date: 2026-11-28
Lane: weft-corpus-v5
Status: rework landed, tests green, scaled pass on hold pending re-audit

## Decision

The 2026-11-28 founder rulings on #59 (comments 2 to 5) re-frame the product: the company brain, not the people brain. The knowledge unit is the document or event; people are attributes; person identity is the erasure axis only. Binding naming: source = meeting/thread/ticket/document anchor, theme = knowledge, identity = the person erasure axis. New strata labels prefer source-disjoint over identity-disjoint.

The paraphrase-hard stratum was therefore redefined on the SOURCE axis and no longer presents itself as an identity slice:

1. The positive prompt now asks the teacher for a DIFFERENT source (another meeting, thread, or ticket in the same company) that happens to cover the same talking point, not a rewrite in place. The third-department constraint is kept as an org attribute for lexical difficulty; it is no longer the stratum's definition.
2. Labels renamed: `paraphrase-hard-positive` becomes `source-disjoint-same-theme-positive`, and `paraphrase-hard-negative` becomes `source-disjoint-near-topic-negative`. Receipt count keys follow: `sourceDisjointPositive`, `sourceDisjointNegative`.
3. Event anchors are derived at compile time from the coverage corpus's own structural links (transitive clusters, cluster id = smallest doc id): `deriveEventClusters`. Each pair records `eventA` (the coverage cluster the talking point originally appeared in, or the doc's own anchor for invented negatives) and `eventB` (the paraphrase's own new source anchor). The event is the identity of the knowledge unit.
4. Identity disjointness between coverage docs stays in `findParaphraseCandidates` as validation (the erasure-axis property), explicitly not the stratum's definition. The receipt records the axis note so no downstream reader mistakes the framing.

## What does not change

Masking, collision remap, fail-closed validation, the Jaccard overlap method, and the passing 2026-11-28 smoke result (negatives 0.2094 vs positives 0.0242 lexical overlap against a 0.0718 baseline) all carry over; the BM25-breaking property is a lexical-overlap property, not an axis property.

## Hold

The scaled strata pass (roughly 400 positives and 200 negatives per profile) does not spend until this rework is re-audited under the standing pre-spend gate, since the positive and negative prompts both changed materially.

## The estate beyond this rework

The rulings add v5 estate capabilities this rework does not attempt: the source-kind axis on generated docs, people-free knowledge units, a non-knowledge negative class, the knowledge-density filter, and company-private knowledge units proven erasable by regenerate-minus-unit byte-diff receipts. Those belong to the next audited estate extension, designed as one coherent build.
