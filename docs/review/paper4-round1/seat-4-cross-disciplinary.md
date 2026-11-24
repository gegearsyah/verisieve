# Seat 4 Report — Peer Reviewer 3 (Cross-disciplinary/Practical)

Reviewer configuration card: Card #4, academic-paper-reviewer v1.11.1 panel, Round 1, 2026-11-25. Model family: sonnet (session routing, same family as all five seats). Fresh context, peer-blind: this seat has not seen any other seat's report.

---

## Manuscript Information
- **Title**: How Training Data Should Look: From Stitched Chunks to Records That Know What They Describe
- **Manuscript ID**: verisieve-graph-grounded-enterprise-corpus.tex (Paper 4)
- **Review Date**: 2026-11-25
- **Review Round**: Round 1

## Reviewer Information

### Reviewer Role
Peer Reviewer 3 (Cross-disciplinary/Practical)

### Reviewer Identity
Applied privacy and data-protection engineer with practitioner experience deploying PII detection, pseudonymization, and erasure workflows inside enterprise data estates, familiar with GDPR Article 17 as an operational compliance problem and with the limits of redaction and detector-based attestations in the security literature.

## Overall Assessment

### Recommendation
- [ ] Accept
- [ ] Minor Revision
- [x] **Major Revision** — Substantial revisions needed, re-review required after revision
- [ ] Reject

### Confidence Score**
4 (Mostly within my area of expertise, high confidence; the Article 17 characterization touches legal territory partially outside an engineering brief)

### Summary Assessment
The paper builds a graph-grounded training corpus from heterogeneous enterprise documents in which every sample carries entity identifiers, provenance byte-ranges, a detector-relative PII certificate, and a byte-exact regeneration path under deletion, plus a sealed retrain recipe that completes erasure from corpus to adapter. From a practitioner standpoint this is an unusually disciplined artifact: the certificate's detector-closed and small-sample boundaries are stated where the claim is made strongest (§5, §10), the pending GPU half of the erasure path is marked and carries no placeholder numbers, the vaulted default and readable opt-in are kept distinct in prose and in the arm table, and the zero-egress receipt is verifiable against a checked-in artifact with nine named trapped network surfaces. My findings are boundary gaps rather than false claims. The erasure receipts cover corpus and adapter but not the vault, which is where unmasked values and salts live. The readable view, used by default in the headline comparison, has no stated certificate or access boundary. Article 17 is characterized as a settled requirement extending to models without qualification. All fixes are prose-level repairs against measurements that already exist; none require new measurements, but the boundary of a compliance-facing core claim must be complete before acceptance.

## Strengths

### S1: The certificate's core restatement carries its full boundary where the claim is strongest
The manuscript states the detector-closed scope and the small-sample nature of the bound in the same paragraph that introduces the certificate numbers, and repeats both in the no-claims list. A practitioner reading §5 cannot come away believing the certificate attests anything beyond what the same detector family can detect, and §10 correctly reframes it as a build-time check, not an audit.
**Evidence Anchor**: `text: §5 "Detection and certificates" — "certifies absence of PII detectable by this scanner, not absence to an independent auditor"`

### S2: The unmeasured half of the erasure path is marked, not smoothed
The adapter-side measurements are structured as pending and the manuscript commits to reporting them only when measured, with placeholders explicitly refused. This is the correct operational posture for a compliance-adjacent claim still awaiting its GPU backfill, and it matches the checked-in artifact's pending-gpu fields.
**Evidence Anchor**: `text: §9 "Adapter half (pending GPU backfill)" — "structured in the artifact as pending-gpu and appear in this paper as measured numbers only when they are measured"`

### S3: The vaulted default and the readable opt-in are kept distinct everywhere, including in the measured comparison
§4 assigns different claims to the two identity views of the same seam, the head-to-head arm table labels the readable and vaulted per-block arms separately, and the vaulted arm is run as a privacy-cost ablation whose cost is quantified rather than asserted. I checked every recurrence of vault language (abstract, §1, §3, §4, §5, §7, §9) and found no instance where the two views blur.
**Evidence Anchor**: `text: §4 identity view paragraph — "The vaulted default's own claim is lineage and exact erasure, not learned names"`

### S4: The zero-egress claim is exactly as strong as its receipt
The paper's sandbox claims (§1 item 1, §3) match what the checked-in artifact records: egressBytes 0, an empty external-call list, and nine enumerated armed network surfaces, with the read surface itemized. I verified all three receipts in the run artifact and the CI chain recomputes the prose against it. This is verifiable enough for a practitioner to know what was tested, which is rare.
**Evidence Anchor**: `dataset: results/company-brain-slice.json — p3.receipt.egressBytes = 0, p3.receipt.externalCalls = [], p3.receipt.networkSurfacesArmed length 9`

### S5: Erasure receipts are byte-level and verified, not asserted
All three deletion fractions in the ablation carry exact byte-diff verification with unchanged samples byte-identical, and each receipt includes before and after SHA-256 plus a fail-loud guarantee if the diff exceeds the erased entity's spans. For an Article 17 operational story, byte-exact regeneration with a throwing guard is the property a DPO would ask for.
**Evidence Anchor**: `dataset: results/amnesiac-corpus-ablation.json — fractions 0.01/0.05/0.2, byteDiff.exact true with removedSpanBytes 24/71/999 matching Table 2`

### S6: The strongest arm is scoped honestly against its own dependency
The routing arm's dependence on a correctly resolved identity is stated in the same paragraph as its result, which prevents the strongest number from reading as end-to-end capability.
**Evidence Anchor**: `text: §7 "Non-training controls" — "the arm scores routing given a correct resolution, not resolution itself"`

## Weaknesses

### W1: The erasure path is silent on the vault, which is where the personal data lives
**Problem**: The erasure receipts cover corpus regeneration and (pending) the adapter, but the manuscript never states what happens to the vault itself: whether the erased subject's raw values, salt, and vault entries are removed when an eraseEntity request runs, or retained to keep the linking structure intact. §9 itemizes the corpus half and the adapter half; §3 describes values being vaulted "behind a salted placeholder and assigned a stable entity identifier"; the remaining vault mentions are about masking loss or placeholders. The byte-diff receipts measure the corpus, not the vault.
**Evidence Anchor**: `absence: §9 "The Erasure Property" and §3 vault mechanism — expected a statement of vault and salt disposition under eraseEntity; checked §3, §4, §5 "Erasure", §9, §10, the abstract`
**Why it matters**: For a practitioner, the vault is a personal-data store in its own right. If an operator must answer an Article 17 request for the artifact as deployed, "the subject's name is gone from the corpus and the adapter" is incomplete if the name is still in the vault keyed by a salt, and the salt table is the re-identification key for every placeholder in the surviving corpus. The paper's erasure claim is the artifact's load-bearing compliance property; an unstated vault half leaves the claim's operational completeness undefined.
**Suggestion**: Add one paragraph in §9 (or a sentence in §10) that states the vault disposition explicitly: whether eraseEntity deletes the subject's vault entries and salt, and if not, why retention is necessary (for example, to preserve cross-modal linking of non-erased subjects) and how the retained salt is protected. If vault erasure is implemented and receipted, cite the existing receipt; if it is not, state it as a boundary of the claim. Either way, no new measurement is required, only prose against existing behavior.
**Severity**: Major
**Confidence**: 5

### W2: The readable identity view lacks its operating boundary exactly where the artifact is deployed
**Problem**: §4 specifies what the readable opt-in emits (unmasked content and canonical readable entity anchors), for whom (the user training on their own documents), and that the choice is explicit and recorded in the receipt. It does not specify the certificate's behavior in that view (whether the conformal gate runs, fails by construction, or is vacuous when no masking occurs), nor any access or authorization property of the opt-in beyond "no extra ceremony". Meanwhile §10 sets the headline comparison readable by default, and the strongest measured routing arm operates on readable composed records, so the deployment posture of the flagship path is the one view whose privacy boundary is unstated.
**Evidence Anchor**: `absence: §4 identity view paragraph — expected the readable view's certificate behavior and any authorization/audit property of the opt-in beyond being receipted; checked §3, §4, §5 "Detection and certificates", §7, §9, §10`
**Why it matters**: A practitioner who enables the readable view gets unmasked personal data of every data subject in the estate. If they also believed the certificate continues to ride those samples, they would hold a false assurance the paper never grants but also never corrects. The question "does the certificate still apply when I turn readability on" is the first thing an operator will ask, and the manuscript leaves it open.
**Suggestion**: Extend the §4 identity paragraph with two sentences: (a) what the gate does under the readable view (run unmasked re-scan with no vault placeholders to subtract, or not run), and (b) that the explicit opt-in is the sole control surface, recorded in the receipt. Both are statements of existing mechanism, not new measurements.
**Severity**: Major
**Confidence**: 5

### W3: GDPR Article 17 is characterized as a settled, model-extending requirement without qualification
**Problem**: §9 opens with "Under GDPR Article 17, erasure of personal data must extend to models trained on it", stated as settled law on the strength of the regulation's own text. Whether and how Article 17 reaches a model (as opposed to the personal data and its copies) is an open and actively debated regulatory question in the applicable jurisprudence and supervisory guidance, not a settled requirement. The manuscript also never acknowledges that Article 17 is exercisable on qualifying grounds and subject to exemptions, and that controller-level determinations (including notification duties) sit outside the artifact's receipts.
**Evidence Anchor**: `text: §9 "The Erasure Property" — "erasure of personal data must extend to models trained on it"`
**Why it matters**: This is the manuscript's only legal grounding and it anchors the framing of the entire erasure path ("completing the erasure path", abstract; "the honest completion of erasure", §10). A team using this paper as a compliance reference would inherit an overstated legal premise. The technical receipts are genuinely strong; they do not need an overstated legal shell around them.
**Suggestion**: Reword §9's opening to a cautious characterization, for example that Article 17 gives data subjects a right to erasure whose application to models trained on the data is the subject of open debate, and that the artifact provides receipts a controller would need to honor such a request for the corpus and the adapter. No new artifact or measurement is required; the pending-gpu framing already supports "in progress toward it" honestly.
**Severity**: Major
**Confidence**: 3 (operational compliance practice, not legal doctrine)

### W4: Certificate restatements drift toward stronger wording at the paper's edges
**Problem**: The core statements (§5, §10 item 1) carry the full boundary, but the periphery does not. §1 describes the certificate "attesting, at a stated confidence, that the sample carries no residual detectable PII", which suggests a per-sample confidence guarantee, while the certified 95% figure is an estate-level binomial bound on the pass rate, not a per-sample probability. The conclusion compresses the property to "clean at a stated confidence", dropping both the detectability qualifier and the aggregate nature of the certified number.
**Evidence Anchor**: `text: Conclusion — "that they are clean at a stated confidence"`
**Why it matters**: The conclusion's "clean" is the weakest of the recurrences and is the sentence most likely to be quoted onward by implementers who read only the closing summary.
**Suggestion**: In the conclusion, restate as "bounded for residual detectable PII at a stated confidence" and add a clause in §1 noting the certified confidence is an estate-level bound on the pass rate, with per-sample certificates being the gate's binary decision. Cross-reference §5 once; no new numbers.
**Severity**: Minor
**Confidence**: 5

### W5: Per-class certified recall bounds exist in the artifact but are absent from the paper
**Problem**: The paper reports the aggregate pass rate, its certified lower bound, and the zero-miss counts per class. The checked-in artifact additionally carries a certified recall lower bound per detector class, and those bounds are far weaker than the aggregate for rare classes: ADDRESS sits at 36.84% and GITHUB_PAT at 5% (uninformative at n=1) even though the scanner missed zero on the estate.
**Evidence Anchor**: `dataset: results/amnesiac-corpus-ablation.json — certificates.classes.ADDRESS.certifiedRecallLowerBound = 0.368403 and certificates.classes.GITHUB_PAT.certifiedRecallLowerBound = 0.05`
**Why it matters**: An operator deploying the certificate reads "zero misses" across 262 detections and the 81.71% aggregate lower bound, which overstates the assurance a class-level certificate can carry on a real estate where some classes are rare. The honest per-class numbers exist, are already computed, and their omission makes the stated confidence look more uniform across classes than the machinery actually certifies.
**Suggestion**: Add one sentence to §5 "Detection and certificates" reporting the per-class certified lower bounds (or their range), noting that the class-level bound degrades with rare classes; the existing CI chain can be extended to check the new numbers. This requires no new measurement, only transport of checked-in artifact values, but should be flagged as a CI-chain addition to keep the check invariant.
**Severity**: Minor
**Confidence**: 5

### W6: The trap-armed verification is precise about scope but under-specified about its window and enumerations
**Problem**: §3 states "all nine network entry points replaced with throwing traps for the duration of the run" without naming the surfaces or stating the trap window's boundary. The artifact documents that traps covered perception, linking, export, and graph build, and that outputs were emitted by the scorer after the traps were restored, with the read surface exhaustively itemized. A paper-only reader cannot tell which nine surfaces, whether the counting is at the call level or byte level, or that write-side emission occurred outside the trapped window.
**Evidence Anchor**: `dataset: results/company-brain-slice.json — p3.receipt.externalCallsNote: traps armed for the whole run and restored before output emission; fileReads.note itemizes the exhaustive read surface`
**Why it matters**: The check I was asked to run is whether a practitioner could tell what was and was not verified. From the paper alone the answer is mostly yes but incomplete: the strength of the claim is a trap list and a restored-traps boundary that the paper alludes to but does not state.
**Suggestion**: Add a footnote or §3 sentence enumerating the nine surfaces or pointing at the artifact's list, and state the trap window scope (corpus seam covered; output emission after traps restored). Prose-only repair against the existing receipt.
**Severity**: Minor
**Confidence**: 4

### W7: The stakeholder mapping is left implicit at three decision points
**Problem**: Reporting this as a neutral scope check, the manuscript names the beneficiary roles unevenly. The enterprise operator and the readable-user are named; the data subject appears once (conclusion, "removed exactly when the person they describe asks"). Three roles stay implicit: (a) the operator who flips the readable opt-in unilaterally for all subjects in an estate; (b) the subjects whose values are vaulted and whose names become readable under that flip; (c) operators relying on the certificate as their residual-PII attestation when §9's retraining path is still pending. The paper does not state what any of these parties control or receive.
**Evidence Anchor**: `absence: stakeholder surfaces (§3, §4, §7, conclusion) — expected any statement of who controls the readable opt-in and who is affected by it, and who may rely on the certificate while the adapter half is pending; checked §3, §4, §7, §9, §10, conclusion`
**Why it matters**: None of this implies harm; the vaulted default is genuinely protective and the erasure receipts serve the subject well. But when roles are implicit, an implementation team will fill them by assumption, and the two views of the same seam make the fill-in direction consequential (whoever defaults the seam decides exposure). One sentence naming the roles would make the artifact's operational contract explicit.
**Suggestion**: In §4 or §10, one sentence per role: the operator chooses the view per estate and the choice is receipted; the subjects exposed under the readable view are the people the unmasked records describe; the certificate serves the operator as a build-time check while the adapter-side evidence remains pending. Prose only, no claims added.
**Severity**: Minor
**Confidence**: 4

## Detailed Comments

### Title & Abstract
The abstract is boundary-honest on the certificate ("bounding residual detectable PII at a stated confidence", "the certificate is not differential privacy") and carries the small-sample bound with its stated confidence. It does not restate detector-closedness, which §5 and §10 carry; this is acceptable for an abstract that defers, but the conclusion-level drift of W4 is the recurrence that actually overstates. The erasure sentence "a sealed LoRA retrain recipe completing the erasure path" is present-tense for a path whose measurements are pending; it is defensible ("path" is the recipe, not the evidence) but is worth a qualifier consistent with §9.

### Introduction
Item 1 of the load-bearing properties is the sandbox claim, and it is written at the right altitude for practitioners. The precision gaps are confined to W6. §1 introduces the certificate as a per-sample attestation; see W4.

### §3 (From Documents to Standalone Knowledge)
The certificate mechanism is described concretely (re-scan after masking, non-placeholder hits count against the sample). This is one of the paper's clearest definitional paragraphs. The vault mechanism, however, is introduced here as the default and never returns to say where its store lives or how it is disposed of under erasure (W1).

### §4 (The Sample Schema)
The identity paragraph is the strongest stakeholder-relevant prose in the paper: the two views are declared, the claims are assigned per view, and the retrain recipe's loss masking is tied to the vaulted path. The open boundary is exactly the readable view's certificate and authorization surface (W2).

### §5 (Measured Receipts)
Certificates are treated correctly here (S1, W5). The erasure paragraph and Table 2 report only the corpus side; the caption honestly excludes GPU-dependent measurements, which is the right handling of the pending half (S2). I verified the byte-diff numbers and the certificate statistics against results/amnesiac-corpus-ablation.json; all match.

### §7 (Head-to-head)
I do not engage with the retrieval comparison or the trained-format ordering (other seats). From my seat: the readable-by-default posture of the comparison arms runs through this section, which is where W2's boundary absence becomes visible in an actual deployment-like configuration; the routing arm's resolution-dependence is scoped honestly (S6); and the vaulted ablation is a genuinely useful privacy-cost quantification.

### §9 (The Erasure Property)
The corpus half is measured and receipted; the adapter half is pending and honestly marked. The weaknesses here are the legal characterization (W3) and the vault's absence from the bundle (W1). The pending-gpu framing already positions the manuscript correctly as "in progress toward" an Article 17 operational answer; the fix is not to claim more or less, but to remove the settled-law framing and complete the vault half of the boundary.

### §10 (What This Paper Does Not Claim)
Item 1 is a model restatement of the certificate boundary. Item 4 correctly declines to adjudicate approximate unlearning. Item 3's boundaries are precise. Nothing in this list conflicts with my findings; W1, W2, and W3 are gaps the list could absorb without changing its shape.

### Conclusion
"Clean at a stated confidence" is the one recurrence that loses the boundary qualifiers (W4); "when the person they describe asks" is the paper's single subject-facing sentence, and the surrounding role mapping is otherwise implicit (W7).

## Questions for Authors

1. When eraseEntity runs, what happens to the erased entity's raw values, salt, and vault entries? Are they deleted with a receipt, or retained for linking? If retained, where in the manuscript's claim boundary does that limitation belong (W1)?
2. Under the readable identity view, does the conformal gate still run, and if so, what does its certificate bound when no masking has occurred? Is the same re-scan machinery applied to readable view corpus exports (W2)?
3. What source anchors the claim that Article 17 "must extend to models trained on it"? Would the authors accept recharacterizing this as an open regulatory question that the receipts support rather than settle (W3)?
4. Do the authors intend to surface the per-class certified recall lower bounds (for example, ADDRESS at 36.84%) in the manuscript, since they already exist in the checked-in artifact and materially change the assurance story for rare detector classes (W5)?

## Minor Issues

### Language / Grammar
- Abstract: "at stated $95\%$" reads oddly twice in one sentence; "at the stated $95\%$ confidence" or "at the stated confidence" would read as intended.
- §5: "which quarantines its sample by design" is ambiguous on first read about whether the quarantine is the certificate's decision or the generator's injection; a clause pointing at the gate decision would clarify.

### Figures and Tables
- Table 2's caption says "the 24-sample, 76-entity corpus", while the certificate paragraph says "23 of 24 samples"; one clarifying phrase ("before the quarantined sample's removal") would prevent a reader from reconciling two sample counts by guesswork.

## Criterion-Bound Judgements

Calibration status: `NOT_CALIBRATED`

| Dimension | Judgement | Evidence | Rationale | Decision bearing? |
|---|---|---|---|---|
| Originality | MEETS | S4, S5 | The artifact combination (byte-exact corpus regeneration with per-sample provenance and a receipted vaulted default) is uncommon in practitioner tooling | No |
| Methodological Rigor | PARTLY_MEETS | W1, W2, W6 | The measured core is verifiable and the receipts chain (993 CI checks) is real, but core-claim boundaries are incomplete at the vault, readable view, and trap window | Yes |
| Evidence Sufficiency | PARTLY_MEETS | W1, W3, W5 | The receipts that exist match the prose exactly; sufficiency gaps are the unstated vault disposition, the unmeasured adapter half (honestly pending), and the artifact-present but unreported per-class bounds | Yes |
| Argument Coherence | MEETS | S1, S3, S6 | Claims are consistently assigned per view and per mechanism; the drift instances are peripheral (W4) | Yes |
| Writing Quality | MEETS | W4 | Dense but disciplined; boundary statements are repeated at the right anchors | No |
| Literature Integration | NOT_ASSESSED | | Reviewer 2's seat | No |
| Significance & Impact | MEETS | S4, S5, W1 | A deployable erasure-receipted corpus is practically significant if the vault and readable boundaries are closed | Yes |

The unresolved decision-bearing criteria are Methodological Rigor and Evidence Sufficiency, driven by W1, W2, and W3. All three are repairable in prose against measurements and receipts that already exist (no new measurements are required; W5 needs only transport of checked-in artifact values plus a CI-chain addition, and W6 needs wording against the existing receipt). None of the findings invalidates the core receipts, which is why the recommendation is Major Revision with re-review rather than reject: the compliance-facing boundary of the artifact's most load-bearing claim must be stated completely, and a re-review confirming W1, W2, and W3 repairs should be sufficient.
