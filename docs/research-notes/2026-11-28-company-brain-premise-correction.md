# Company brain premise correction: knowledge is the unit, people are one axis — 2026-11-28

Founder ruling, stated and confirmed in conversation on 2026-11-28. The
founder's plan was never stated this clearly before; this note is the
reference for every later framing decision. Earlier notes keep their
historical wording and are corrected by dated markers only where they
make claims.

## The premise

Knowledge belongs to documents and events. In a meeting, the meeting is
the identity; the people talking are attributes of it. The product is the
company brain, not the people brain.

## The three erasure targets (only one is about people)

1. **Knowledge units (the headline):** a meeting, a document, a
   recipe-like trade secret, a strategy. The company erases its own
   private knowledge, provably, with deterministic regeneration and
   byte-diff receipts.
2. **Orgs and clients:** a client's footprint at contract end, an
   NDA-bound counterparty.
3. **Persons (the GDPR special case):** the person maps to their
   knowledge footprint and the same mechanism erases those units. The
   legal capability stays complete and stops being the framing. A
   company's right over its own knowledge (a restaurant's secret recipe
   is the founder's example) is the same class of erasure and the
   stronger market case.

## Vocabulary (binding)

- **source:** the meeting, thread, or ticket a document comes from; the
  provenance anchor.
- **theme:** the knowledge; the linking axis and Weft's product.
- **identity:** reserved for the person erasure axis only. New labels
  prefer source-disjoint over identity-disjoint.

## What changes and what does not

The engineering was verified entity-agnostic on 2026-11-28:
`eraseEntity(state, entityId)` takes any entity, the corpus entity
classes include org and project alongside person, and whole-document
erasure is input removal plus regeneration (the corpus is a pure function
of inputs, view, and engine version). What changes is framing (the Art. 17
retrain copy, person-led erasure stories, identity-centric bucket names)
plus one real extension: knowledge-unit anchors as first-class erasable
targets, filed as its own ticket and fed by the meeting-anchored corpus in
issue #59. Ingest-time privacy (vault, salting, redaction) is unchanged:
protecting people inside surviving documents and erasing knowledge units
are different functions; both stand. The H2 probe reading is demoted
cleanly to a property report on the person axis.

## Where the rulings live

The theme-linking ruling, the meeting-as-identity refinement, and this
correction are recorded on issue #59 as comments and in the session
memory. The Weft paper (paper 5 draft, merged via PR #64) reframes its
intro and title under this premise. The 2026-11-24 mechanism adoption
note stands as history; this note corrects its framing, not its
engineering.

## Amendment, later the same day: knowledge, not company, is the unit

The founder generalizes the premise one level up (2026-11-28, after this
note was first written). The unit is knowledge, and data is only the
pivot point: the product is about knowledge, not about company data.
Companies are the motivating domain, not the boundary, and the founder's
reason is a property of their data: company knowledge is the most
granular and the most distributed, and it gets lost in talking points
scattered across meetings, documents, and threads. A compliance PDF
(APP rules, NIST AI RMF, ISO 42001, EU AI Act are the founder's
example, from their own compliance-research library) is the same class
of knowledge unit as a meeting: no people, no meeting, still knowledge
to link by theme across sources.

The amendment also sets a threshold: not all text is knowledge. A
greeting ("how are you?") is not a knowledge unit. Corpus and pair
construction carries a knowledge-density filter, so small talk does
not become linkable pairs. Recorded on issue #59 for the v5 corpus
lane; the filter rule itself is unwritten and belongs to that lane.
