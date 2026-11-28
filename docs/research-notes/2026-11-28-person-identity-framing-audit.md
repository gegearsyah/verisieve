# Person-identity framing audit: papers and benchmarks — 2026-11-28

A deep-research sweep of all five papers, both briefs, the pair builder,
the gate and baseline scripts, the synthetic estates, the model card, the
H2 probe framing, and the committed ledgers, asking one question: where
does the repo still make the person the unit, under the 2026-11-28
premise rulings (knowledge is the unit; source and theme are the axes;
identity is reserved for the person erasure axis). The premise correction
note (`2026-11-28-company-brain-premise-correction.md`) is the reference;
this audit is the inventory of what its framing pass must touch.

Two classification rules bound every finding. Committed ledger keys,
bucket keys, pair-type keys, arm labels, and script filenames are
append-only artifacts: they are never renamed, and the audit marks them
keep. And the person erasure axis itself (the Amnesiac Corpus, the H2
probe, PII recall, Art. 17 scoping) is the sanctioned use of identity:
those passages were verified compliant, not flagged.

## Papers, ranked

**Paper 2 (`versieve-graph-grounded-enterprise-corpus.tex`) is the worst
offender.** Its intro motivation opens with two records about the same
person, its composition rule emits one training sample per resolved
entity, its router routes to the asked person's records, its retrieval
index is the person-entity graph, and its head-to-head question strata
are person-resolution tasks (250 people, same-name disambiguation). Only
its erasure half matches the ruling. Eight framing findings (the
abstract's "no shared identity", the intro's person-unit example, the
resolved-entity grouping differentiator, three router/composition
passages, the standalone-knowledge property statement, the conclusion's
erasure-first ordering) and three structural ones: composition is
entity-keyed where the ruling's product axis is theme-keyed, the question
set has no theme stratum, and the retrieval and router wins are measured
only on the person graph (a theme-keyed index is unmeasured, which the
paper 3 brief already flags as the unoccupied axis). The measured costs
of entity-keyed composition (14.32x false-merge amplification, the
near-duplicate fraction of 1.0) stand as the honest price of that design
and are not reworded.

**Paper 5 (Weft) is second and nearly compliant** after the reframe
merged via PR #68: residual prose still says "identity-orthogonal",
"identity-matched theme-different", and "sharing zero identity keys"
where source-orthogonal and source-disjoint vocabulary would carry the
ruling; the committed bucket keys stay. One structural note: the planned
paraphrase-hard stratum (issue #59) should be defined as a source-axis
stratum (different sources, same talking point), not another identity
slice.

**Papers 1 (extraction), 4 (local training), and the multimodal paper are
clean.** Their person content is entirely the sanctioned axis: PII-span
labels, salted-pseudonym redaction, canary exposure, PPRL, and
re-identification audits, all scoped as measured properties. Paper 1's
one structural note is low priority: its release-policy labels derive
from person-PII scanning only, so the knowledge-unit (trade-secret,
org/client) release axis lives in the companion study by design.

**Both briefs carry small framing debt**: paper 3's brief describes the
Weft task in identity-matched terms (superseded by the sources framing)
and names the unoccupied axis "identity+theme grounding"; the paper 5
brief quotes the story-36 ruling in its pre-third-ruling two-people form.
Both reframe in one pass; their committed bucket-key mentions stay.

## Benchmarks: three structural gaps keep the estate person-centric

1. **No source axis exists anywhere.** `doc.source` is a licence
   provenance string, never a source kind (meeting, document, thread,
   ticket). Disjointness is defined only over person identity in every
   estate and every bucket, so "same theme across sources" is unmeasured
   and a v5 bucket keyed `source-disjoint-same-theme-positive` has no
   field to key on. Every person-keyed bucket decision resolves if the
   v5 estate adds a source-kind field.
2. **No people-free knowledge unit is representable.** Every document in
   every estate is required to carry a person entity (the W1 estate pins
   a 4-author common pool across all themes; the fullscale generator
   attaches person+org+project to every document; the teacher prompt
   mandates 1-2 roster identities per document). The compliance-PDF
   knowledge unit, the motivating example of the third ruling, cannot
   exist in the current estates.
3. **The knowledge threshold is never tested.** Filler text exists only
   as noise inside knowledge documents; no negative class of
   non-knowledge text exists, so a model that links greetings can pass
   every current gate. The filter rule is recorded on issue #59 but the
   estate has no axis to evaluate it once written.

A fourth gap folds into the first two: the masked-positive bucket admits
only pairs with a shared resolved identity, so masking is definitionally
person-token masking; a masked-source bucket (mask the meeting or thread
anchor instead of the name) is the product-signal version, and it needs
the source axis first.

## Safe renames (not ledger keys)

- The model card headline ("identity-orthogonal cross-document theme
  linking") reframes to theme-led wording, e.g. "a small pairwise scorer
  for cross-document theme linking that requires no person signal".
- The model card's novelty conjunction is pinned to the audited W7
  record, so its rewording must be a dated correction marker, never a
  silent edit.
- `SHARED_IDENTITY_ROSTER` in `scripts/build-weft-training-pairs.mjs`
  (a person+org roster constant) renames to `SHARED_ENTITY_ROSTER`, with
  its docstring lines.
- The `POSITIVE_TYPES` constant name in
  `scripts/analyze-weft-specialist-gate.py` renames to
  `POSITIVE_PAIR_TYPES`; its values are committed pair-type keys and
  stay.

## What the audit verified as already compliant

The H2 probe end to end (externally trained attacker, probe family fixed
and reported, below-chance honesty, no removal claim) is exactly the
demoted property report the ruling calls for. The identity-contrastive
track serves the erasure axis in identity's reserved sense. The card's
section 5, its do-not-use bullets, and its ruled release gate with the
BM25 caveat are compliant. Roughly thirty person-mention sites across
the papers were individually verified as the sanctioned erasure or
measurement axis.

## Recommended sequence

1. Framing pass over paper 2, the paper 5 residuals, both briefs, and
   the model card (headline plus dated novelty marker), filed as its own
   ticket; ledger keys and recorded rulings untouched.
2. The three structural gaps go to the v5 corpus lane (issue #59) as
   estate-design input: source-kind field, people-free knowledge unit
   class, non-knowledge negative class, and the paraphrase-hard stratum
   defined on the source axis.
3. The safe renames ride along with the framing pass or the next touch
   of their files.

The two audits were run read-only; nothing in this note edits a ledger,
and the committed pair-type, bucket, and metric keys named here are all
marked keep.
