# W7 release verdict: the claim audit holds, six citation errors corrected, the release gate is honestly blocked — 2026-11-28

Ticket #47 is implemented and measured. The binding plan is
`2026-11-28-w7-execution-plan.md`; the citation evidence is
`2026-11-28-w7-fulltext-verification-record.md` (both committed on this
branch). The release packaging is
`release/weft-specialist-v1/` (MODEL_CARD.md, RELEASE-MANIFEST.json,
CALIBRATION.svg) plus the audit machinery:
`scripts/run-weft-claim-audit.mjs`, the append-only ledger
`results/weft-claim-audit.json`, and
`test/weft-claim-audit.test.js`.

## 1. The claim audit

Every external claim in the model card is a row in the card's
machine-readable claims block (40 rows: 24 measured, 16 citation), and
the audit script verifies each one before appending a content-addressed
entry to the ledger. Measured traces load the named ledger or note and
check the claimed number is present; digest traces hash the artifact on
disk or pin against the export ledger; citation traces resolve against
the verification record. The script fails closed with typed errors
(WEFT_CLAIM_UNTRACED, WEFT_CLAIM_MISMATCH, WEFT_CLAIM_BANNED_WORD) and
appends nothing on failure; re-running with an unchanged card is a
no-op (runId a329df3692e9, 40 of 40 verified). The banned-word sweep
scans everything under `release/`; the only banned-token strings in the
tree are the definitional mentions in the sweep's own code, its tests,
and the notes that define the ban (the same precedent as the committed
2026-11-27 note).

## 2. The literature record: six wrong ids found and corrected

The full-text pass read every primary source behind the 2026-11-27
abstract-level table. The claim substance survived; the citations had
not. Six accumulated arXiv ids were wrong and are corrected in place
with dated markers in four notes (2406.07137 a physics paper, RLACE
2112.10139 a financial paper, "Kernel-INLP 2023" nonexistent, the
conformal follow-up 2408.08786 a quantum-memory paper, and the W4/W5
anchor trio 2202.13439 / 2204.13600 / 2007.07361 all unrelated papers
whose correct records are 1904.06019 / 2204.06507 / 2006.01862). Three
attribution sharpenings travel into the card: the post-hoc-recovery
finding belongs to Elazar and Goldberg (Coavoux et al. carry the
no-guarantee-from-defensive-training row), the kernel erasure line is
EMNLP 2022 building on RLACE, and INLP's 85.0 percent nonlinear recovery
is probe-family-specific (an RBF-SVM stays near chance in the same
setup), which is why the card fixes and reports its probe family.

## 3. The sweep verdict and the novelty position

Open question 1 of the 2026-11-27 note is closed: no work applies
LEACE/INLP-style identity- or attribute-targeted nullspace or linear
erasure to a multimodal encoder with linking as the task, as of
2026-11-28 (all 433 LEACE citers read, INLP citers filtered, targeted
arXiv and OpenAlex sweeps; recorded limits: OpenAlex's 2026-preprint
indexing is incomplete and INLP's own reference list went unread under
rate limiting). The card's novelty statement is exactly the audited
wording: the conjunction is not found in prior art as of this audit, no
single component is claimed, and the six mandatory neighbours the sweep
surfaced (CLEAR, ISP, LANCER, the deconfounding line, SPD, JVSB) are
cited and differentiated row by row.

## 4. Licence gate

Green-only holds: Multi-News stays dropped with the LILY Lab agreement
verbatim in the audit; needle-3 is verified Apache-2.0 (a candidate
model, not a training source); uCDCR is cited-only and never
redistributed; the released corpus is project-generated synthetic
estates with permissively-licensed open-weight teacher outputs only;
Wikipedia-derived pairs are excluded by the binding default. Three
pre-existing tests that byte-pinned the licence audit against its
original export were relaxed to id-and-order pins plus explicit W7
value pins (the audit is a gate document whose statuses are re-verified
in place; deletions and reorders still fail).

## 5. The release gate is blocked, and the card says so

The story-36 acceptance criterion is not met through the ruled link-head
path: identity_disjoint bucket, static embedding baseline 0.9973 versus
link head 0.3617 (pooled cosine 0.9989 passes). The manifest's
releaseGate block records `blocked-pending-founder-ruling` with those
numbers; the packaging ships, the publication decision is the
founder's. The onnxruntime-node range tightened from ^1.31.1 to ~1.31.1
with the protobuf field-14 coupling note in the manifest.

## 6. Founder checkpoint (surfaced, not decided here)

1. **The story-36 scoring-path ruling** decides the gate: pooled cosine
   (passes, 0.9989) or the link head (fails, 0.3617) as the ruled
   scoring path for identity-disjoint pairs.
2. **Wikipedia share-alike**: the binding default excludes
   Wikipedia-derived pairs from the public set; choosing share-alike
   dataset licensing instead would re-admit them.
3. **Paper-level claims**: none were opened in this ticket (paper edits
   out of scope); any claim the founder wants to take from the card into
   a paper goes through the standing checkpoint process.

## 7. Reproduction

```bash
node scripts/run-weft-claim-audit.mjs    # 40 claims verified, idempotent
node scripts/draw-weft-calibration.mjs  # regenerates CALIBRATION.svg from the ledger
node --test test/weft-claim-audit.test.js  # 6 pass
npm run test:ci                        # 246 tests, 245 pass, 1 pre-existing skip
node scripts/check-paper-numbers.mjs   # 1619 checks, 0 failures
```

## 8. Carried limits (unchanged, stated in the card)

The 240-word envelope; unseen-style routing unmeasured with the
tripwire style-blind; theme thresholds uncalibrated on heterogeneous
corpora (the v5 corpus lane owns that); the Mozannar and Sontag venue
discrepancy; the espRA human re-check before any ECB+ corpus use.
