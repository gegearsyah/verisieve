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
