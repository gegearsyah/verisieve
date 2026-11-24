# Open-estate dataset hunt: Stage K6 candidates (2026-11-24)

Verified inventory of open multi-modal corpora for the Stage K6 open-estate measurement
(handoff §4, Stage K6; founder gate: "public-data estate with independently known entity
overlap"). Method: primary sources only: official download pages (AMI/Edinburgh, OpenSLR,
CMU, Zenodo, Internet Archive, OpenSanctions, LDC), arXiv abs pages (2 IDs pinned), project
pages and repos. Every claim below carries a fetched URL. My own prior memory was actively
discounted: one remembered OpenSLR number (SLR57 = ICSI) was wrong (SLR57 is African Accented
French, Apache 2.0: see rejection ledger) and two search-snippet GitHub repos for the Ubuntu
corpus returned 404 and were discarded.

## 1. Verdict up front

**8 GB of truly open, license-safe multi-modal data exists easily, but linked identity
almost never does.** There is no open corpus anywhere that I could verify which provides the
same real person with ground truth across meeting audio + email + spreadsheets. What exists:
(a) **intra-estate identity** (named speakers across AMI's own modalities: audio, video,
transcripts, slides, whiteboard: genuinely linked), and (b) **document-modality identity**
(Enron: real identities, text-only). The practical estate is therefore **layered**: one
real named-person meeting corpus (AMI/ICSI) as the identity spine, real chat/email as bulk
text, real spreadsheets as spreadsheet modality, identity linked **by overlay synthesis**
(Section 5) with the audio handled honestly (Section 6).

## 2. Verified candidates (all claims via fetched primary sources)

| # | Corpus | Modalities | Size (stated) | License (as stated on source page) | Download today | Cross-modality identity |
|---|--------|-----------|---------------|-------------------------------------|----------------|--------------------------|
| 1 | **AMI Meeting Corpus** ([download page](https://groups.inf.ed.ac.uk/ami/download/)) | headset/lapel/mic-array WAV audio, low-res video (~400 MB/meeting), NXT transcriptions + annotations (22/68 MB), slides w/ OCR text (~7 MB), whiteboard (~20 MB), shared documents (~2.1 MB), pen files | ~100 h of meetings (per-meeting sizes stated; no total stated) | "Signals, transcription, and some annotations are public under the Creative Commons Attribution 4.0 International Licence (CC BY 4.0)" | direct, no registration; full-size video "not available from this page" | **PRESENT (the only verified instance)**: same named participants across audio, video, transcripts, notes, whiteboard, shared docs |
| 2 | **ICSI Meeting Corpus** ([AMI-hosted page](https://groups.inf.ed.ac.uk/ami/icsi/)) | close-talking mic audio (SPH or mixed WAV), orthographic transcripts, dialog-act annotations | "about 70 hours of meeting recordings" | "Creative Commons Attribution 4.0 International Licence (CC BY 4.0)" | direct from AMI project site; **no LDC requirement** at this host | PRESENT: named participants across audio + transcripts |
| 3 | **Enron email** ([CMU page](https://www.cs.cmu.edu/~enron/)) | email (folders, no attachments) | ~0.5 M messages; "about 1.7Gb, tarred and gzipped" (`enron_mail_20150507.tar.gz`) | **none stated on the CMU page**: publicly released via the FERC investigation; page asks users to be "sensitive to the privacy of the people involved" | direct tar.gz, no registration | PRESENT but **text-only**: real identities across mail folders, no audio/spreadsheet link |
| 4 | **Stack Exchange dumps** ([archive.org item](https://archive.org/details/stackexchange)) | Q&A posts, comments, users, votes, badges (XML in 7z) | **92.3 GB** | "CC BY-SA 4.0" (with attribution requirements quoted on the item page: name the source, link each author) | direct from Internet Archive | ABSENT (anonymous users; no other modality): chat/Q&A-text bulk only |
| 5 | **AliMeeting / M2MeT** ([OpenSLR SLR119](https://www.openslr.org/119/)) | 8-channel mic-array + per-speaker headset audio, transcripts | 118.75 h (104.75 train / 10 test / 4 eval); **73.24 GB + 22.85 GB + 3.42 GB + 8.90 GB** | "CC BY-SA 4.0" | direct | PRESENT (speaker-labeled, named participants) but audio+text only, Mandarin |
| 6 | **AISHELL-4** ([OpenSLR SLR111](https://www.openslr.org/111/)) | 8-channel array audio, transcription, speaker VAD | 120 h; 51.2 GB compressed | "CC BY-SA 4.0" | direct | PRESENT (speaker-labeled), audio+text, Mandarin |
| 7 | **CHiME-6** ([OpenSLR SLR150](https://www.openslr.org/150/)) | multi-channel far-field dinner-party audio, JSON transcripts, floorplans | "Train 97 GB, dev 11 GB, eval 12 GB" (~120 GB) | "Attribution-ShareAlike 4.0 (CC BY-SA 4.0 International)" | direct `.tar.gz` from OpenSLR (+EU/CN mirrors) | PRESENT (speaker-labeled), audio+text |
| 8 | **MeetingBank** ([project page](https://meetingbank.github.io/), [Zenodo 7989108](https://zenodo.org/record/7989108)) | **video (3,579 h)**, transcripts, "meeting-minutes and agenda PDFs", audio, 6,892 summarization instances; 1,366 meetings, 6 U.S. city councils | Zenodo zip **637.1 MB** (text); total corpus "1.9 TB" incl. video on Internet Archive city collections | **split**: Zenodo text record "Creative Commons Attribution 4.0 International"; HF-hosted dataset + audio are tagged `license:cc-by-nc-sa-4.0` (fetched HF API tags for `huuuyeah/meetingbank`, `huuuyeah/MeetingBank_Audio`) | Zenodo + HF + Internet Archive, no registration | **BUILDABLE**: same council speakers across video, transcript, PDF minutes; identity grounded by public council rosters, not by annotation |
| 9 | **QMSum** ([Yale-LILY GitHub](https://github.com/Yale-LILY/QMSum)) | meeting transcripts (AMI/ICSI-derived + Canadian parliament committee), query→summary records | 1,808 query-summary pairs, 232 meetings (text only) | "MIT" | in-repo JSON | INHERITED (AMI/ICSI speaker names) |
| 10 | **Ubuntu Dialogue Corpus** ([paper, pinned](https://arxiv.org/abs/1506.08909); builder repo [rkadlec/ubuntu-ranking-dataset-creator](https://github.com/rkadlec/ubuntu-ranking-dataset-creator), Apache-2.0) | 1-to-multi-turn IRC chat logs | "almost 1 million multi-turn dialogues… over 7 million utterances and 100 million words" | builder repo Apache-2.0; **raw chat content has no stated license** (public `#ubuntu` IRC logs) | repo-hosted corpus (~3.7 MB compressed repo index + linked corpus files) | ABSENT (nicknames only): text bulk |
| 11 | **Fisher/CallHome** ([LDC Fisher entry](https://catalog.ldc.upenn.edu/LDC2005T19)) | telephone audio + transcripts | "11,699 recorded telephone conversations totalling approximately 1,960 hours" | "LDC User Agreement for Non-Members": **fee required** ("Login for the applicable fee") | behind LDC account + payment | PRESENT (speaker-labeled) but NOT open |
| 12 | **data.gov spreadsheets** ([catalog](https://resources.data.gov/)) | CSV/XLSX per catalog entry | varies (no single figure) | **per-dataset; no blanket statement found on the fetched policy pages**: verify license per chosen dataset | direct | BUILDABLE (entities by name, real-world messiness) |

## 3. Rejection ledger

- **OpenSanctions**: [licensing page](https://www.opensanctions.org/licensing/) (fetched):
  "The data is licensed under the terms of Creative Commons 4.0 Attribution NonCommercial."
  Non-commercial clause → not safe as the estate for training-data claims that face a founder
  product gate. **REJECTED** as a core component; entity-shaped rows, not documents anyway.
- **Fisher/CallHome (LDC)**: verified fee-gated above. **REJECTED** on license safety (also
  violates the "open" requirement in this note's title). AMI/ICSI/CHiME cover the same genre free.
- **MeetingBank HF audio/text (`huuuyeah/*`)**: CC BY-NC-SA 4.0 tags fetched from the HF API.
  Non-commercial. The Zenodo text record is CC BY 4.0, so the **text/minutes layer is usable**;
  the audio layer only if the founder accepts an NC-shackled component or only redistributes
  the Zenodo-licensed text. **Flagged, conditional** (founder gate per handoff §7).
- **OpenSLR SLR57 "ICSI from memory"**: verified wrong: SLR57 is *African Accented French*
  (22 h, Apache 2.0). ICSI is distributed at the AMI project host instead. **Discarded memory.**
- **Search-snippet repos `ryanapr/ubuntu-ranking-dataset-raw`, `ubuntu.com/server/docs/community-projects`**
 : `gh api` 404 on both repo paths. Discarded; only the verified `rkadlec` repo (Apache-2.0)
  and the pinned arXiv abs page are used as evidence.
- **`datasets.d2.mpi-inf.mpg.de/ubuntu/`**: HTTP 404 today; the Ubuntu corpus's convenience
  download is dead. The corpus is regenerable from public `irclogs.ubuntu.com` logs via the
  Apache-2.0 builder. Marked "usable with friction."
- **`stackexchange.com` dumps page**: unfetchable from this environment (fetch blocked);
  evidence pinned to the Internet Archive hosting item instead, which is the distribution point.
- **LDC-hosted ICSI (LDC2004S02) / any fee route**: unnecessary duplication of the free AMI-hosted
  distribution; not chased further.

## 4. The killer constraint, stated plainly

No verified open corpus links the **same real person** across meeting audio + email +
spreadsheets. The estates are partitioned:

- AMI/ICSI: identity linked *within* meetings (audio↔video↔transcripts↔whiteboard↔slides↔shared
  documents), grounded by the corpus's own annotations, the only place where "independently
  known entity overlap" truly exists in open data.
- Enron: rich real identity, but zero audio and zero meeting records.
- Stack Exchange / Ubuntu IRC: enormous, open, but identities are anonymous handles.
- MeetingBank: identity across video+transcript+minutes is *buildable* (council rosters are
  public), but that is our assembly work, not corpus ground truth, and the audio layer is
  NC-licensed.

Nothing bridges AMI↔Enron↔Stack Exchange: different organizations, different people, no
ground-truth cross-estate entity overlap. This is exactly the handoff's founder-gate framing:
for public data, the "independently known entity overlap" is only **intra-corpus** (AMI), which
the K5 coverage metric can measure on real data, while **cross-corpus** identity must come from
construction, not from the wild. I recommend reporting it this way rather than implying an
open estate gives us free cross-modality identity.

## 5. Design option: OVERLAY synthesis on real content

Take real open documents (AMI transcripts/notes/slides, Enron emails, Stack Exchange threads)
and inject synthetic identities: a fictional company's people, with their facts appearing in
multiple documents by construction, then run K4/K5 on both the real layer (truth unverified)
and the overlay layer (truth by construction).

Per-modality assessability of overlay:

| Modality | Can synthetic identity be injected so ground truth is by construction? |
|---|---|
| Email / chat / Q&A text | **YES, cleanly**: string substitution or document insertion; deterministic, reversible; this is exactly what the existing Amnesiac/overlay tooling does for text |
| Transcribed meeting text | **YES** (it is text): the transcript layer accepts injected names; the *link back to audio* does not survive |
| Slides / PDF minutes / shared docs | **YES** |
| Spreadsheets (data.gov CSV) | **YES** |
| **Meeting audio / video** | **NO, honestly**: injected names would require synthesized utterances of those names in the recorded voices; with TTS that destroys "the data is real" and with no TTS the audio contradicts the overlay. Audio must either stay identity-real-but-unverified (AMI ground truth, synthetic overlay absent) or stay fully synthetic |

So the honest estate design: **audio/video layer = real, real-identities, no overlay** (evaluated
with corpus-provided ground truth only); **text layer = real + overlay identities** (ground truth
by construction). The two layers are labeled separately in the manifest so no metric mixes them.

## 6. Recommendation (ranked)

| Rank | Pick | Why |
|---|---|---|
| 1 | **AMI Meeting Corpus (CC BY 4.0)**: audio + low-res video + NXT transcripts + slides/whiteboard/shared docs | only verified corpus with real linked identity across modalities; direct free download; directly matches the "meeting + documents about the same organization" shape |
| 2 | **ICSI Meeting Corpus (CC BY 4.0 at the AMI host)** | doubles the meeting hours (~70 h) under the same license and the same annotations format; same identity story |
| 3 | **Enron email (no license stated; ~0.5 M messages, 1.7 GB)** | the only open email modality with rich real identity; text-only. Caveat: no formal license on the CMU page and PII-sensitivity caveat as quoted; this is the one component whose *redistribution* is a founder question (internal use is unproblematic) |
| 4 | **Stack Exchange dump (CC BY-SA 4.0, 92.3 GB)** | scale + license safety for the chat/Q&A bulk; identity-absent by design |
| 5 | **QMSum (MIT, text)** | pre-processed AMI/ICSI transcripts for cheap pipeline shakedown before touching raw audio |
| Conditional | MeetingBank Zenodo text/minutes (CC BY 4.0); video layer (1.9 TB) only if the founder accepts the NC audio split and the download cost | adds video + PDF-minutes modality and a real civic "organization" |
| Optional bulk | AliMeeting (108 GB) or AISHELL-4 (51 GB) or CHiME-6 (~120 GB, CC BY-SA 4.0) | only if GB volume per se is wanted; identity story same as AMI, language Mandarin/English-dinner; recommend **not** loading these until needed |

### Effort estimate for an 8 GB estate

- **Realistic target**: AMI headset/lapel WAV mixes + ICSI mixed WAV (both tens-of-GB-scale raw;
  an 8–15 GB slice is a subset selection) + Enron 1.7 GB + curated data.gov CSVs + Stack Exchange
  slice. Download alone ~10–40 GB.
- **Assembly**: ~2–3 days tooling (subsets + format conversion to the estate schema + extraction
  + entity index), ~1 day more for the overlay layer on text documents, ~1 day for the split
  manifest (real-identity vs overlay-identity) and receipts. Roughly **one week to an assembled,
  receipted estate**; the video layer of MeetingBank is a separate, gated add-on (~1.9 TB, skip
  unless the founder asks).

## 7. Pinned sources (all fetched 2026-11-24)

- https://groups.inf.ed.ac.uk/ami/download/: AMI components + CC BY 4.0
- https://groups.inf.ed.ac.uk/ami/icsi/: ICSI at the AMI host, ~70 h, CC BY 4.0
- https://www.cs.cmu.edu/~enron/: Enron archive, 1.7 GB, no license text, privacy caveat
- https://archive.org/details/stackexchange: Stack Exchange dump item, 92.3 GB, CC BY-SA 4.0
- https://www.openslr.org/119/: AliMeeting, 118.75 h / 108 GB, CC BY-SA 4.0
- https://www.openslr.org/111/: AISHELL-4, 120 h / 51.2 GB, CC BY-SA 4.0
- https://www.openslr.org/150/: CHiME-6, ~120 GB, CC BY-SA 4.0
- https://www.openslr.org/57/: counter-verification (African Accented French; ledger)
- https://meetingbank.github.io/: MeetingBank overview; https://zenodo.org/record/7989108: CC BY 4.0 text record
- https://huggingface.co/api/datasets/huuuyeah/meetingbank and …/MeetingBank_Audio: CC BY-NC-SA 4.0 tags (fetched via API)
- https://github.com/Yale-LILY/QMSum: QMSum, MIT
- https://arxiv.org/abs/2305.17529: *MeetingBank* paper (Hu et al.): ID pinned on abs page
- https://arxiv.org/abs/1506.08909: *Ubuntu Dialogue Corpus* paper (Lowe et al.): ID pinned on abs page
- https://github.com/rkadlec/ubuntu-ranking-dataset-creator: Apache-2.0 builder (license via `gh api`)
- https://catalog.ldc.upenn.edu/LDC2005T19: Fisher, fee-gated (ledger)
- https://www.opensanctions.org/licensing/: CC BY-NC 4.0 (ledger)
- https://resources.data.gov/: no blanket license statement found (per-dataset verification required)

## 8. Third-estate sweep: NER corpora, KB-derived records, public registers (2026-11-24)

Scope: candidates for a possible third estate, tested against three properties: (a) records that
hang together per entity, (b) an open license (permissive or CC BY; NC and fee-gated are
automatic rejections), (c) enough structure to serve as a real-mention source under the
layered-honesty design of Section 5. The Section 3 ledger stands unchanged; OpenSanctions and
Fisher were not revisited. Every license below was read on the distributing organization's own
page or license file, fetched on 2026-11-24. No dataset was downloaded.

Result up front: the NER literature is uniformly flat span annotation and therefore cannot
supply the estate's unit of per-entity composed records. The per-entity property exists in
knowledge bases and in public company registers, and that is where the usable candidates are.

### 8.1 NER and identity corpora

| Candidate | Primary source (fetched) | License, exact | Contents | Per-entity clustering | Verdict |
|---|---|---|---|---|---|
| **CoNLL-2003** | [archived official page](https://web.archive.org/web/2021/https://www.clips.uantwerpen.be/conll2003/ner/) and [README](https://web.archive.org/web/2021/https://www.clips.uantwerpen.be/conll2003/ner/000README); the live page returns HTTP 404 today | **No license covers the words.** README: "The words of the articles in the two corpora have not been included here for copyright reasons." English text requires the Reuters Corpus (RCV1) from [NIST](https://trec.nist.gov/data/reuters/reuters.html), whose stories are "under the copyright of Reuters Ltd and/or Thomson Reuters" and released under signed agreements; German text requires the LDC ECI corpus (LDC94T5) | IOB NER plus POS and chunk columns, English and German newswire sentences | **No**: flat sentences, no per-person document sets | **REJECTED**: text is not redistributable; both source corpora are agreement-gated |
| **OntoNotes 5.0** | [LDC2013T19](https://catalog.ldc.upenn.edu/LDC2013T19) | "LDC User Agreement for Non-Members"; no price is published, only "Login for the applicable fee" | 2.9 M words of English, Chinese and Arabic across news, conversation, weblogs, newsgroups, broadcast; syntax, predicate-argument, word sense, coreference | **No**: annotated spans across unrelated documents | **REJECTED**: fee-gated, same reason as Fisher in the Section 3 ledger |
| **WikiNER** | [figshare record](https://figshare.com/articles/dataset/Learning_multilingual_named_entity_recognition_from_Wikipedia/5462500), DOI 10.6084/m9.figshare.5462500; license read from the figshare API record (`CC BY 4.0`) | **CC BY 4.0** (authors' deposit of the Nothman et al. 2013 data; the figshare description says the data "was originally available at http://schwa.org/resources", and figshare is the verified distribution point) | Per-language `.bz2` corpora `aij-wikiner-{lang}-wp2/wp3` (the file list includes de, en, es, fr, it and others), tagged Wikipedia sentences | **No**: sentence-level spans only | **WEAK**: the cleanest license of any NER corpus here, but flat spans; usable as a mention inventory, not as an estate |
| **MultiNERD** | [repo](https://github.com/Babelscape/multiNERD) and [LICENSE](https://raw.githubusercontent.com/Babelscape/multiNERD/master/LICENSE) | "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International Public License" (LICENSE file). The README says "CC BY-SA-NC 4.0" and the badge says CC BY-NC 4.0; all three readings are NC | 10 languages, 15 entity types, BabelNet/Wikidata/Wikipedia references, image URLs | **No**: sentence spans | **REJECTED**: non-commercial clause |
| **Few-NERD** | [repo](https://github.com/thunlp/Few-NERD) | "Few-NERD dataset is distributed under the CC BY-SA 4.0 license"; "The code is distributed under the Apache 2.0 license" (the GitHub API reports the repository license as Apache-2.0, so the README is the data-specific statement) | 188,200 sentences, 491,711 entities, 8 coarse and 66 fine types | **No**: sentence spans | **WEAK**: license is fine, structure is wrong for the unit under test |
| **PERSED** | none found. `persed.space` is a learning-design consultancy; GitHub repo and code search return no corpus | n/a | n/a | n/a | **NOT A CORPUS**: record it as a name collision; no primary source exists |

The honest reading of this table: no NER corpus is a candidate for the estate. Their span
inventories can seed mention lists, and WikiNER's CC BY 4.0 is the only one whose license allows
redistribution without further questions, but none of them group documents by entity.

### 8.2 Knowledge-base-derived estates

| Candidate | Primary source (fetched) | License, exact | Contents | Per-entity clustering | Verdict |
|---|---|---|---|---|---|
| **Wikidata** | [Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing), [database download](https://www.wikidata.org/wiki/Wikidata:Database_download), [Wikimedia dumps legal](https://dumps.wikimedia.org/legal.html) | **CC0 for structured data**: "Copyrights of structured data in the main, Property, Lexeme, and EntitySchema namespaces are waived" (dumps legal page); other-namespace text is CC BY-SA 4.0. The licensing page: Wikidata "requires a CC0 license" | Entities with labels, aliases, descriptions, statements, qualifiers, references and sitelinks; JSON and RDF dumps, truthy and full variants | **Yes**: one composed record per QID, with aliases across languages and sitelinks to per-language Wikipedia articles | **STRONG**: CC0 covers exactly the structured layer, real names in aliases and statements, no fee, no registration |
| **Wikipedia text** (via Wikimedia dumps) | [dumps legal](https://dumps.wikimedia.org/legal.html) | CC BY-SA 4.0 and GFDL; "Some text may be available only under the Creative Commons license" | Article text per entity per language | **Partial**: one article per entity per language, so a multi-language article set is a per-entity cluster; no multiple documents per entity within one language | **STRONG when paired with Wikidata**: supplies document-like text; the combined estate inherits CC BY-SA |
| **DBpedia** | [about page](https://www.dbpedia.org/about/), [resources](https://www.dbpedia.org/resources/), [datasets](https://www.dbpedia.org/datasets/) | "Creative Commons Attribution-ShareAlike 3.0 License" and "GNU Free Documentation License" | "cleaned data from Wikipedia in all languages and Wikidata", "more than 228 million entities"; per-entity content includes "e.g., Wikipedia infoboxes, text, and mapping resources", with "19 types of Wikipedia content, e.g. abstracts, images, person data or external links"; "around 20 language chapters" | **Yes**: one resource per entity per language chapter | **MEDIUM**: license is usable (share-alike, not NC) but the 3.0 version is older and the records are abstract-level, not documents |
| **YAGO** | [homepage](https://yago-knowledge.org/) and [downloads](https://yago-knowledge.org/downloads) | "This work is licensed under a Creative Commons Attribution 4.0 International License"; latest release YAGO 4.6, built from Wikidata plus the schema.org taxonomy | Facts about people, cities, countries, movies and organizations, with a class taxonomy; download links from the downloads page | **Yes, at fact level**: per-entity assertions, no documents | **MEDIUM**: the most permissive KB license here (CC BY, attribution only), useful as a graph layer under a synthetic overlay, not as a document estate |

### 8.3 Public registers and open metadata

| Candidate | Primary source (fetched) | License, exact | Contents | Per-entity clustering | Verdict |
|---|---|---|---|---|---|
| **UK Companies House** | [data products guidance](https://www.gov.uk/guidance/companies-house-data-products), [public task and Crown copyright](https://www.gov.uk/government/publications/companies-house-accreditation-to-information-fair-traders-scheme/public-task-copyright-and-crown-copyright), [download page](https://download.companieshouse.gov.uk/en_output.html) | **Open Government Licence v3.0** for agency content ("All content is available under the Open Government Licence v3.0, except where otherwise stated"). Public-register information is made available under section 47 of the Copyright, Designs and Patents Act 1988 and Schedule 1 of SI 1997/3032, and Companies House "imposes no rules or requirements on how the information on the public register is used" | Monthly CSV snapshot of live companies (address, SIC, status, accounts and confirmation dates, previous names), accounts filings in iXBRL/XBRL, PSC JSON snapshot, per-company URI service | **Yes**: per company number, with PSC records naming real people | **STRONG**: enterprise-document shape, real names, attribution-only license, no fee |
| **SEC EDGAR** | [accessing EDGAR data](https://www.sec.gov/os/accessing-edgar-data), [SEC privacy and reuse page](https://www.sec.gov/about/privacy-information) | **No license grant.** "Anyone can access and download this information for free"; SEC site content "may be copied or further distributed by users of the web site without the SEC's permission". Filings are company-authored public records, so copyright in the filing text stays with the filer | Submissions by CIK, form types, XBRL company facts, index files | **Yes**: per CIK, one cluster of filings per company | **STRONG with a caveat**: the best on-theme document clusters; redistribution of filing text is a founder question, like Enron in Section 6 |
| **OpenAlex** | [about page](https://openalex.org/about), [data docs](https://help.openalex.org/data/) | **CC0** | Works, authors, sources, institutions, publishers, funders, topics, with native IDs and external IDs | **Yes**: per author (work list) and per institution | **MEDIUM**: CC0 and entity-shaped, but records are metadata, not documents |
| **ORCID public data file** | [public data file page](https://info.orcid.org/public-data-file/) | "Creative Commons CC0 1.0 Universal public domain dedication" | "all public data in the ORCID Registry associated with an ORCID record created or claimed by an individual" | **Yes**: per person | **MEDIUM**: clean CC0 per-person records, metadata only |

### 8.4 Pinned sources added in this sweep (all fetched 2026-11-24)

- https://web.archive.org/web/2021/https://www.clips.uantwerpen.be/conll2003/ner/ and .../000README: CoNLL-2003 annotations-only distribution, Reuters and ECI requirements
- https://trec.nist.gov/data/reuters/reuters.html: Reuters Corpus copyright and signed agreements
- https://catalog.ldc.upenn.edu/LDC2013T19: OntoNotes 5.0, LDC non-member agreement, fee gate
- https://figshare.com/articles/dataset/Learning_multilingual_named_entity_recognition_from_Wikipedia/5462500: WikiNER, CC BY 4.0 (via figshare API record, DOI 10.6084/m9.figshare.5462500)
- https://github.com/Babelscape/multiNERD and https://raw.githubusercontent.com/Babelscape/multiNERD/master/LICENSE: CC BY-NC-SA 4.0
- https://github.com/thunlp/Few-NERD: dataset CC BY-SA 4.0, code Apache 2.0
- https://www.wikidata.org/wiki/Wikidata:Licensing, https://www.wikidata.org/wiki/Wikidata:Database_download, https://dumps.wikimedia.org/legal.html: CC0 for structured data, CC BY-SA 4.0 for other text
- https://www.dbpedia.org/about/: CC BY-SA 3.0 plus GFDL; https://www.dbpedia.org/resources/ and https://www.dbpedia.org/datasets/: content description
- https://yago-knowledge.org/ and https://yago-knowledge.org/downloads: CC BY 4.0, YAGO 4.6
- https://www.sec.gov/os/accessing-edgar-data and https://www.sec.gov/about/privacy-information: free access, reuse permitted, no license grant
- https://www.gov.uk/guidance/companies-house-data-products and https://www.gov.uk/government/publications/companies-house-accreditation-to-information-fair-traders-scheme/public-task-copyright-and-crown-copyright: OGL v3.0 and public-register terms
- https://openalex.org/about and https://help.openalex.org/data/: CC0, entity structure
- https://info.orcid.org/public-data-file/: CC0 1.0 public data file

### 8.5 Recommendation ranking for a possible third estate

| Rank | Pick | Why |
|---|---|---|
| 1 | **Wikidata (CC0) with Wikipedia article text (CC BY-SA 4.0)** | The strongest verified open source here for a composed record per entity (aliases, statements, sitelinks), with real names, real document text, no fee and no registration. Fits the overlay design directly: the structured layer is the truth surface, the article layer is the mention surface. Caveat: the combined estate inherits CC BY-SA from the article text |
| 2 | **UK Companies House (OGL v3.0)** | Per-company clusters that look like the enterprise documents the benchmark already uses: accounts filings, company snapshot, PSC records naming real people. Attribution-only license, explicit statement that reuse of public-register information is unrestricted |
| 3 | **SEC EDGAR (public records, reuse permitted)** | Larger and more document-shaped than Companies House, with filings grouped by CIK and XBRL facts. The open question is filer copyright in the filing text and SEC rate limits; treat redistribution as a founder decision, as with Enron |

Not ranked, but usable as layers: YAGO 4.6 (CC BY 4.0) if a pre-built facts graph is preferred
to raw Wikidata; DBpedia (CC BY-SA 3.0) if an older share-alike is acceptable; OpenAlex or ORCID
(CC0) only if a metadata-only estate is acceptable, since neither carries documents.

### 8.6 What remains unverified

- No download was performed. Every license claim is a page-level statement, not a file-level
  inspection of the distributed archive.
- CoNLL-2003's live official page returns 404; its license evidence is the archived copy of that
  page and its README. The Reuters RCV1 agreement text itself was not fetched (it requires a
  signed application to NIST), so "research use only" rests on the CoNLL README and NIST page.
- WikiNER's original schwa.org distribution is dead; the figshare deposit by the authors is the
  verified license source, and the figshare article page returned 403 to the fetch tool, so the
  license came from the figshare API record for the same DOI.
- The Companies House OGL statement is a site-level statement; the data product page does not
  label each download separately, and public-register information rests on statutory wording
  rather than an SPDX license.
- EDGAR has no explicit license. "Public record" plus the SEC reuse sentence is not the same as
  a grant from the filers, and that gap is unresolved.
- DBpedia's license is quoted from the organization's about page, not from a per-file header.
- OpenAlex's license is quoted from its about page; the data documentation does not restate it.
- MultiNERD's README, badge and LICENSE disagree on the exact variant; all readings include NC,
  so the rejection does not depend on which one is right.
- The OntoNotes fee is not published; only the login gate was verified.
- PERSED does not exist as a corpus under that name; only a same-named consultancy appears in
  search results.
- Wikidata's dump-level CC0 is confirmed; the dumps legal page also warns that some text and
  images may be included under fair use, so a Wikipedia text layer needs per-article review
  before redistribution.

## 9. Founder adoption and feasibility fetch (2026-11-24)

Section 8.5 ranked **Wikidata (CC0) with Wikipedia article text (CC BY-SA 4.0)** as slot 1. The
founder adopted that recommendation on 2026-11-24. This section records the adoption and a
feasibility fetch performed the same day. It does not start estate construction: building the
third estate remains a separately gated work order with its own spec. Section 8.6's "no download
was performed" applies to that sweep, not to this section.

### 9.1 What was fetched

Inventory fetch only, and it lives outside the repository in `open-estate-downloads/wikidata-feasibility`,
beside `open-estate-enron-slice`, under the same rule as the Enron slice. Nothing was copied into
the repository tree. No real person was relabeled and no synthetic overlay was built.

| Item | Source | Result |
|---|---|---|
| Structured facts | `https://query.wikidata.org/sparql`, JSON results, explicit User-Agent | 200 distinct real persons (occupation chief executive officer, Q484876), each with at least one employer statement (P108) and an English sitelink; 2,173 claim rows across employer, position held (P39), educated at (P69) and member of (P463); 2,644,843 bytes |
| Article text | `https://en.wikipedia.org/w/api.php` (`prop=extracts`, `exintro`, `explaintext`, ten batches of 20) | intro extract for 200 of 200 persons; 111,765 characters, 126,423 bytes across ten batch files |

The bounded SPARQL query is saved verbatim in the fetch manifest. Two attempts are recorded there
as deviations. The broad query (all four career properties required on any human, label service,
LIMIT 200) returned HTTP 504 after 66 s, and a narrower attempt returned 200 rows but only 29
distinct persons because the optional-claim cross-product consumed the row limit. The saved query
uses a `DISTINCT` subselect over persons and returned 200 distinct persons in 13 s.

### 9.2 Clustering yield

| Measure | Count |
|---|---|
| Persons with structured facts | 200 |
| Persons with article text | 200 |
| Persons with both | **200 of 200** |
| Persons with at least two structured properties | 185 |
| employer / educated at / position held / member of | 200 / 147 / 115 / 29 |
| Persons with all four | 22 |

The per-entity clustering property does materialize at this scale. Every fetched person yields one
multi-field record: a name, employer and other career facts, plus prose about the same person. The
join is not the bottleneck, because the query required an English sitelink by construction. Two
honest limits sit on top of the number:

- The article layer was fetched as intro extracts only. Median length is 407 characters and 71 of
  200 are under 300 characters, so the intro is a synopsis, not a document. Estate construction
  needs full article text or article dumps for a document-like mention surface. This fetch shows
  the plumbing works; it does not show that the text is substantial.
- The structured layer is curated statements, not noisy mentions. Wikidata gives clean values and
  aliases, which is the truth surface, while the mention surface has to be composed from article
  prose and, per Section 5, from the synthetic overlay for ground truth by construction.

### 9.3 What is missing for estate construction

- **Mention inventory quality**: article prose carries real mentions of the subject and of other
  people and organizations, which is the raw material. This fetch did not extract or measure
  mentions, so alias coverage, collisions between people who share a label, and cross-entity
  co-mention density are unmeasured.
- **Noise types**: Wikidata statements are curated and Wikipedia intros are edited prose. Natural
  noise here is misspellings, honorifics and name order, transliteration variants, and
  redirect/alias ambiguity, all much lighter than the noisy-estate N1 to N8 set. A benchmark needs
  the noise designed and labeled, not merely present.
- **Question key**: neither source carries a query or QA key. Questions over the composed records
  would have to be authored against the structured layer, with answers by construction.
- **Documents per entity**: one English article means one text document per person. A
  multi-document per-entity cluster needs other language editions, section-level splits, or the
  overlay.
- **License surface**: the structured layer is CC0, but the article text is CC BY-SA 4.0, so the
  combined estate inherits share-alike. The per-article fair-use caveat in Section 8.6 still applies.

Verdict: the source pair passes the feasibility question for the unit under test, per-entity
composed records. It does not supply a mention inventory, a noise taxonomy or a question key, and
those are exactly the work items that must be specified before the estate is constructed.

### 9.4 Pinned sources added (fetched 2026-11-24)

- https://query.wikidata.org/sparql: live SPARQL endpoint, JSON results
- https://en.wikipedia.org/w/api.php: MediaWiki API, TextExtracts intro extracts
- Licenses as verified in Section 8: https://www.wikidata.org/wiki/Wikidata:Licensing and
  https://dumps.wikimedia.org/legal.html

Fetch files (external to the repository): `wikidata-people.sparql.json`,
`wikipedia-extracts-batch-01.json` through `wikipedia-extracts-batch-10.json`, and
`wikidata-feasibility-manifest.json`, which carries the fetch date, the exact query text, the
license statements with their Section 8 sources, per-file SHA-256, the entity counts above and the
two failed attempts.
