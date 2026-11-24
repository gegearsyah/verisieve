# Noisy-estate benchmark spec: identity resolution that cannot be solved by construction (2026-11-24)

Status: SPEC, lead-authored, implementation pending. Feeds Stage K4 (false-merge amplification,
open-world variant) and Stage K5 (identity-merge taxonomy, B-cubed scoring, coverage K) of the
cross-document knowledge perception upgrade handoff. Adopted from the 2026-11-24 external
critique (run record, same date): the current estate's 54/54 linking is exact matching on
planted values, and the estate's own PPRL benchmark already measures 4.88% false links at dev
threshold on 500 common names; this benchmark is the measuring stick for the real regime.

## 1. The problem this benchmark exists to kill

Every number in the current estate is 100% because the same generator that authors the
documents also authors the truth, with zero noise between them: the engine recovers exactly
what its own fixture encodes. Any identity-resolution score on that estate is construction
signalling, not resolution. The noisy estate inverts the relationship:

- **Truth is the world model** (people, inboxes, departments, projects, facts, events).
- **Documents are lossy, noisy projections** of the world, produced by independent simulator
  layers with seeded noise processes.
- The engine sees only the documents. The scorer sees the engine output and the world. The
  engine never sees the manifest, and the benchmark must be able to FAIL (see acceptance
  criteria, §8): if the estate cannot produce a non-ceiling score for a trivial baseline, it is
  not a benchmark.

## 2. Anti-circularity rules (binding for the implementation)

1. **World-first.** The world model is authored first and frozen. Documents are generated from
   it. Truth is never adjusted after the fact to match what documents ended up saying.
2. **Spec-authored noise.** The noise processes and their constants live in this spec (§4),
   chosen before implementation from general knowledge of messy enterprise data, NOT derived
   from reading the engine's detection, normalization, or canonicalization code. The nickname
   table, typo model, and format tables below are the complete authority; the implementing agent
   applies them mechanically and adds nothing invented after browsing `src/`.
3. **Role separation.** The estate generator (`scripts/gen-noisy-estate.mjs`) must not import
   engine modules. The scorer (Stage K5) runs against artifacts only. The engine process never
   receives the manifest.
4. **Question authoring separation.** Eval questions are authored by a manifest layer from the
   world model only. Document simulators never see the questions, so answer phrasing cannot leak
   into documents.
5. **No tuning.** Noise rates are frozen at `noisy-estate-v1`. If the estate later proves too
   easy or too hard, the version bumps, both generations are regenerated and BOTH score
   generations are reported in the artifact. Deviations are recorded, not smoothed (Standing
   Rule 2).
6. **Determinism.** Seeded, no timestamps, no unseeded randomness; regeneration is byte-identical
   and the manifest pins the estate SHA-256.

## 3. The world model (schema)

Authored once, frozen at generation:

- **People** (250): `personId`, canonical `firstName` + `lastName`, `emails[]` (1-2), `phone`,
  `department`, `title`, `joinDate`, and for ~10% a `priorEmail` (the stale-record source).
- **Name collisions (binding)**: 40 people form 20 same-full-name pairs (distinct personId,
  distinct email/phone/department). Distinguishable only by context attributes, never by the
  name string itself.
- **Shared inboxes (30)**: `inbox@` style addresses (`hr@`, `ops-team@`, `billing@`) that
  receive person-relevant email; emails TO/FROM these inboxes mention specific people in body
  text, creating attribute ambiguity.
- **Organizational entities**: 8 departments, 12 projects, 10 products (organizational IDs only;
  no engine detector class is claimed for them).
- **Facts (180)**: person-attribute facts (`worksIn`, `titled`, `joinedOn`, `ownsProject`), of
  which **60% are stated in only one document, 40% require evidence from 2+ documents** (the
  fact is only recoverable by joining a mention in one document to a different-surface mention
  in another). ~8 facts include a **promotion/rename event**: the person's title or email
  changes over the timeline, so stale and current attributes coexist in different documents.
- **Timeline**: a 14-month window; document dates drawn from it; stale records reference months
  1-4, current records months 9-14.

## 4. Noise taxonomy (rates are spec constants, seeded)

| # | Noise type | Definition | Rate | Example |
|---|------------|------------|------|---------|
| N1 | Typo / OCR corruption | Char-level: keyboard-adjacent substitution, dropped or doubled letter, OCR pairs (rn→m, l→1, O→0) | 6% of name tokens in "scanned" memo/CSV docs | "Elena Vance" → "Ekna Vance" |
| N2 | Nickname | Standard English nickname pairs, table below; one canonical person may appear under a nickname in some docs | 30% of people, in ≥1 doc each | "Robert Chen" → "Bob Chen" |
| N3 | Initials / short form | First initial + surname, or initials only where locally unambiguous | 15% of mentions | "E. Vance", "R. Chen" |
| N4 | Case and format variants | ALLCAPS, phone format variants (555-0123 / (555) 012-3456 / +1 555 012 3456), email localpart styles | 20% of mentions | "VANCE, ELENA" |
| N5 | Shared-inbox attribution | Email sent from/to a shared inbox that names the responsible person only in body text | 30 inbox threads | "from: hr@corp… Elena will handle the audit" |
| N6 | Name collision | Two distinct people share first+last (§3) | 20 collision people, both sides equally present | two "Sarah Okafor"s, IT vs finance |
| N7 | Stale record | Mention uses the person's prior email/title/department | 10% of people, months 1-4 docs | "evance@old-corp…" after a move |
| N8 | Cross-doc disagreement | Title stated differently in two docs due to the promotion events | the 8 event people | "Asst. Director" vs "Director" |

Nickname table (complete for v1): Robert↔Bob, William↔Bill, Elizabeth↔Liz/Beth, Katherine↔Kathy/Kate,
Jennifer↔Jen, Michael↔Mike/Mikey, James↔Jim, Richard↔Rick/Dick, Thomas↔Tom, Margaret↔Maggie/Peggy,
Susan↔Sue, Joseph↔Joe, Daniel↔Dan, David↔Dave, Alexandra↔Alex/Sandra, Barbara↔ Barb, Patricia↔Pat.

Noise is applied at the document-simulator layer, never at the world layer: the manifest's truth
is always the canonical world, and the noise map (which mention got which corruption) is recorded
in the manifest so the scorer can analyze misses by noise type (miss attribution is a required
artifact field).

## 5. Document simulators (text modalities only, v1)

Formats restricted to what the corpus seam ingests as text; audio and decks are honestly out of
scope for v1 (audio cannot be identity-overlaid without synthetic speech, per the open-estate
dataset hunt; that finding stands here).

| Simulator | Count | Content |
|----------|-------|---------|
| Email threads (.eml) | 40 threads, ~160 messages | Person-to-person, person-to-shared-inbox, forwarded chains; N1-N8 apply |
| Chat logs (.txt, timestamped lines) | 30 sessions | Nicknames (N2) dominate chat; initials (N3) common |
| Memos / notes (.txt) | 20 | "Scanned" flavor: N1 typos concentrated here, plus N7 stale records |
| Rosters / exports (.csv, .sql) | 10 | Departmental exports; canonical names alongside corrupted rows; the join key for 1-doc facts |
| Meeting captions (.vtt) | 15 | Spoken-style text of 3-6 participants; spoken-form variants; no audio |
| Total | ~115 documents | every person appears in ≥2 documents and ≥2 modalities (asserted at generation) |

## 6. Eval question strata (for K3's closed-book stratification and K5's coverage K)

60 questions, authored by the manifest layer from the world model only:

| Stratum | Count | Definition |
|---------|-------|------------|
| Q1 single-doc | 24 | Answer recoverable from one document |
| Q2 cross-doc | 24 | Answer requires joining evidence from 2+ documents (different surface forms of the same person) |
| Q3 disambiguation | 12 | Question targets ONE of a colliding pair (N6); answering with the other person's attribute is a miss. These questions exist to make false merges directly visible in the eval, not just in clustering metrics |

Every question must be answerable from the estate: verified at authoring time by a
manifest-side retrieval check (world + documents; this check is benchmark-authoring machinery,
not the engine, and is allowed to see both).

## 7. Scoring definitions (Stage K5 scorer)

All scoring is **person-level, mention-keyed**, per the critique: the unit of truth is the person,
not the value. Each document mention of a person (span in a document, per the manifest's noise
map) is a scored item.

- **Pairwise precision/recall/F1** over mention pairs: truth-positive = two mentions of the same
  person; predicted-positive = the engine's resolution places both mentions in one cluster.
- **B-cubed precision/recall/F1** over mentions, cluster-keyed by engine identity.
- **False-merge rate** = fraction of predicted-same mention pairs that are truth-different
  people (the collision pairs are the designed stress case).
- **False-split rate** = fraction of truth-same mention pairs predicted-different (nicknames,
  initials, stale records are the designed stress cases).
- **Miss attribution by noise type**: for each false split, the manifest's noise map names the
  noise types present in the missed pair (N1..N8), reported as a histogram.
- **Q3 disambiguation accuracy** reported separately, because it is the user-visible cost of a
  false merge.

The engine's current value-level ids (one per name/email/phone string) do not cluster mentions
into persons by themselves; a person-level resolution layer is the capability this benchmark
exists to measure, and K5 builds it against this benchmark. The benchmark is the stick, not the
fix.

## 8. Acceptance criteria (the benchmark must be able to fail)

1. **Trivial-baseline gate (binding).** An exact-match baseline (transitive closure over
   identically normalized strings) must score pairwise recall strictly below 90% and must commit
   ≥1 false merge on the collision pairs. If exact-match scores ≥99% recall, the estate is too
   clean: regenerate with the noise floor documented, version bumped, both generations reported.
2. **Truth coverage.** Every person has ≥2 documents and ≥2 modalities; every question is
   answerable (manifest-side check).
3. **Determinism.** Two generations byte-identical; manifest pins estate SHA-256; no timestamps.
4. **Engine blindness.** Nothing in the estate generation path reads engine source or
   normalization (verified by lead diff review: no `../src` imports in the generator).
5. **No ceiling by construction.** No scoring rubric, question, or fixture may encode the engine's
   internal representation. The estate is authored to be hard for exact-match and for fuzzy
   string similarity alike: N6 collisions defeat pure string similarity, N2/N3 defeat exact
   match, N5/N7 require context (co-occurring department, inbox behavior) to resolve.

## 9. Deliverables and stage mapping

| Deliverable | Stage |
|-------------|-------|
| `scripts/gen-noisy-estate.mjs` + `fixtures/noisy-estate/` + `fixtures/noisy-estate-manifest.json` (world, noise map, questions) | this prep work |
| `test/noisy-estate.test.js`: determinism, coverage, trivial-baseline gate, engine-blindness assertions | this prep work |
| `results/noisy-estate-baseline.json`: exact-match baseline scores (the floor this benchmark must sit under) | this prep work |
| False-merge amplification on the noisy estate (K4's open-world variant) | Stage K4 |
| Person-level resolution scorer + `results/crossdoc-identity-merge.json` + coverage K | Stage K5 |
| Q1/Q2/Q3 strata feeding the K3 six-arm eval | Stage K3 |

The manifest is committed (it is the benchmark's answer key, like every prior fixture manifest:
ground truth lives only in the manifest, and the engine never receives it), with the estate
fixtures. The estate generator consumes this spec's tables verbatim; deviations recorded in the
run record, never silently.
