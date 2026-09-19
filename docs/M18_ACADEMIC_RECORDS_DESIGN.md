# M18 Academic Records — Design Specification (W0)

Labels: **VERIFIED** (from source at `3a30b82`), **INFERENCE**,
**PROPOSAL**, **UNVERIFIED**, **DECISION**, **RECOMMENDATION**, **OPEN**.

## 1. Purpose

Give CampusOS real academic records: a term report card (all of a
student's results for one term, finalized and trustworthy) and a
multi-term transcript — built on immutable finalized results that
respect the M17 CLOSED-term boundary.

## 2. Scope

M18 covers: result finalization, term report cards, transcripts,
GPA/CGPA activation of the dormant hooks, guardian/student read
surfaces, print output. Out of scope: refund/payment features,
certificates, bulk document platforms, external verification services.

## 3. Repository baseline (VERIFIED)

HEAD `3a30b82`; 528/528 tests (39 suites); typecheck 0; builds green;
11 migrations up to date; stack healthy; M17 CLOSED-term enforcement
live at every academic mutation site.

## 4–8. Existing architecture (VERIFIED unless noted)

- **Marks**: `Mark` (examPaperId+studentId unique, `marksObtained`
  Decimal(10,2), `enteredById`, **`lockedAt`**) → `ExamPaper`
  (`maxMarks`, **`weight` — dormant GPA hook**, unique(examId,
  sectionId)) → `Exam` (termId, type, DRAFT/PUBLISHED,
  publishedAt/By). Marks are entered via `PUT /papers/:id/marks`
  (`marks.enter`), refused once the exam is PUBLISHED
  (`MARKS_LOCKED`); publishing sets `lockedAt` on all the exam's marks
  (exams.service:300). **M17: all of this is additionally blocked on
  CLOSED terms.**
- **Grading**: `GradeBand` (college-scoped label + percent range +
  **`gradePoint` — dormant**, seeded A+…F). Band resolution happens
  dynamically in `exams.service.results` (percentage → band label).
- **Results surface**: `GET /results` (`results.read`; OWN forces
  self; CHILD verified via GuardianLink; ALL staff) computes
  per-exam, per-paper percentages and an overall percentage **on the
  fly** — nothing is stored. PUBLISHED-only exams for students/
  guardians. UI: `/results` + **`/results/report/[examId]` — an
  existing PER-EXAM printable report card (M12-W3) using
  `window.print()`** with print CSS (`print-hide`, `print:border-0`).
  Guardian child page links to it.
- **GPA/CGPA: DOES NOT EXIST.** No GPA computation anywhere
  (grep-verified); `gradePoint` and `weight` have never been read by
  production code; `Course.credits Int` exists and is displayed only.
- **Attendance**: per-student summaries exist
  (`attendance.service.studentSummary`, term-filterable) — usable on a
  report card.
- **Rank/position, remarks, pass/fail flags, academic standing,
  transfer credit, repeated/withdrawn-course semantics on results:
  NOT SUPPORTED today** (withdrawn students are excluded from rollover;
  enrollments have DROPPED/COMPLETED statuses — the raw material
  exists, the semantics do not).
- **Exports/documents**: CSV framework (M12-W3) incl. `results.csv`
  (per-exam marks, admin-ALL); **no PDF library anywhere**; the
  browser-print pattern is the only document mechanism.
- **Term lifecycle (M17)**: ACTIVE⇄CLOSED via TermLifecycleService
  only; CLOSED blocks all mark/exam mutations; reopen is possible,
  audited, typed-confirmed.
- **Fees relevance**: none required on transcripts (INFERENCE: some
  schools gate transcript issuance on dues — OPEN O-9).

## 9. Report-card requirements (gap analysis)

| Element | Today | M18 |
|---|---|---|
| Student identity, year, term, course, section, teacher | VERIFIED available | reuse |
| Marks, max marks, percentage, band | VERIFIED (dynamic) | freeze at finalization |
| Grade point / GPA | dormant / absent | activate (O-4) |
| Attendance % | VERIFIED available | include per term |
| Term totals | dynamic overall % exists | freeze |
| Remarks | absent | PROPOSAL: optional per-student term remark at finalization |
| Rank/position | absent | OPEN O-10 (defer recommended) |
| Pass/fail | absent (band implies) | derive from band floor (O-4) |
| Cumulative results | absent | transcript layer |

## 10. Transcript requirements (gap analysis)

Term-by-term course history: derivable from finalized term results.
Repeated courses: representable (same course, multiple terms) —
display policy OPEN (O-11: latest-attempt vs all-attempts in CGPA).
Withdrawn/dropped courses: `Enrollment.status DROPPED` exists —
PROPOSAL: show as "W" without GPA impact. Failed courses: from band.
Incomplete results: a term with unfinalized courses simply isn't on
the transcript yet. Transferred courses: NOT modeled — explicitly out
of M18 v1. Credit hours: `Course.credits` VERIFIED. Academic standing
and graduation status: `StudentProfile.status` (GRADUATED exists via
rollover) — transcript shows it; standing rules OPEN (defer).

## 11. Historical immutability strategy

**RECOMMENDATION (the central design choice): finalize-then-snapshot.**

- A **finalized term result is an immutable stored record** (like
  Payment/Refund): once a student's term result is finalized, the
  numbers on it never change — report cards and transcripts read ONLY
  finalized records, never live marks.
- Report cards = rendered views of the immutable snapshot (no separate
  stored document needed; the snapshot IS the truth).
- Transcripts = **dynamically assembled from immutable finalized term
  results** (cheap, always consistent, no second copy to drift).
- Corrections = **controlled amendment**: a new result version
  superseding the old one (old row kept, `supersededById` chain),
  audited, permission-gated — never in-place mutation.
- Term reopening (M17) does NOT touch existing finalized results;
  changed marks only matter if an explicit amendment/re-finalization is
  performed afterwards (O-6).

Alternatives considered: (a) fully dynamic report cards — rejected:
reopened terms/mark edits would silently rewrite history, the exact
failure M17 exists to prevent; (b) PDF-blob snapshots — rejected:
opaque, unqueryable, duplicates truth; (c) freeze-marks-only —
rejected: derived values (bands, GPA policy) could still drift.

## 12. Proposed data model (PROPOSAL — migration #12, all additive)

Existing models are sufficient for inputs but CANNOT safely represent
finalized outputs (marks are Cascade-deleted with papers, bands are
editable college config, everything is dynamic). Two new models:

**`TermResult`** — one finalized academic record per student per term
(versioned): id; collegeId (tenancy belt); studentId (Restrict);
termId (Restrict); status (`FINALIZED` | `SUPERSEDED` | `VOID`);
version Int; overallPercentage Decimal(5,2); gradeLabel; gradePoint
Decimal(4,2)?; termGpa Decimal(4,2)?; creditsAttempted/creditsEarned
Int; attendancePercent Decimal(5,2)?; remark String?; finalizedById
(Restrict); finalizedAt; supersededById String? @unique (self-relation
— amendment chain); createdAt/updatedAt. Partial unique (raw SQL, M15
precedent): **one FINALIZED row per (studentId, termId)**. Indexes:
(collegeId, termId), (studentId).

**`CourseResult`** — immutable per-course lines under a TermResult:
id; termResultId (Cascade to its snapshot version); courseId
(Restrict); sectionId (Restrict); courseCode/courseTitle/credits
(DENORMALIZED copies — snapshots must survive later catalog edits);
obtained/max Decimal(10,2); percentage Decimal(5,2); gradeLabel;
gradePoint?; passed Boolean. Unique(termResultId, courseId).

Why not reuse Mark: Mark is a live working table (Cascade delete via
paper, editable pre-publish, per-paper not per-course). Why denormalize
course fields: transcript rows must be historically stable. Deletion
policy: Restrict everywhere except CourseResult→TermResult (a
superseded version carries its own lines). No changes to any existing
model. If O-4 chooses "no GPA in v1", the gradePoint/gpa columns stay
nullable — still additive, no rework.

## 13. Proposed state machine (PROPOSAL)

```
(no record) ──finalize (typed confirmation)──▶ FINALIZED
FINALIZED ──amend (creates version N+1 FINALIZED)──▶ SUPERSEDED (old)
FINALIZED/SUPERSEDED ──void (admin, rare)──▶ VOID
```

No DRAFT state: the "draft" IS the live marks system that already
exists — a parallel draft table would duplicate it (alternative
considered and rejected). AMENDED is represented structurally
(supersededById chain), not as a status on the new row. Concurrency:
finalize runs in one transaction — `assertTermOpen`-style FOR SHARE on
the Term row is NOT required (finalization is allowed on CLOSED terms —
that is its purpose, O-1) but the **partial unique index is the CAS**:
two concurrent finalizations collapse to one winner + one unique-violation
409; amendment CAS-updates the old row `where status='FINALIZED'`.

## 14. Authorization & tenancy (PROPOSAL within existing architecture)

- New permission **`results.finalize`** (one; ADMIN-only in the matrix
  initially — O-7). No role conditionals; PolicyService untouched.
- Reads ride the existing **`results.read`** scopes: OWN (student
  self), CHILD (guardian via GuardianLink — exams.service precedent),
  ALL (staff). Teachers keep their existing marks surfaces; transcripts
  are ALL-scope staff + OWN/CHILD.
- Accountants: no access (no results.read grant) — unchanged.
- Every query filters `user.collegeId`; studentId is validated
  in-college; termId derived/validated server-side; foreign → 404.

## 15. Threat model

| Attack | Defense | Test |
|---|---|---|
| Cross-college transcript/report read | collegeId filters, 404 | rival ids |
| Cross-student read (student A → B) | OWN forces self (results precedent) | forged studentId |
| Guardian reads unlinked child | policy.can CHILD check | unlinked 404 |
| Unauthorized finalize/amend/void | `results.finalize` gate | full role matrix |
| Mutating CLOSED-term marks to poison future finalization | M17 guards already block | existing + regression |
| In-place edit of finalized numbers | no update path exists; amendment-only API | attempted PATCH 404/405 |
| Duplicate finalization | partial unique + 409 | concurrent finalize race |
| Concurrent amend | CAS on old row status | race test |
| Reopen-then-finalize race | finalization reads marks in one tx; reopening doesn't touch snapshots | documented + test |
| Client-controlled collegeId/termId/studentId | server-derived/validated | forged-body tests |
| Unauthorized print/export | same permission as the JSON read (print is a view) | authz tests |
| Audit manipulation | server-side AuditService only | audit assertions |
| Sensitive exposure | results carry academic data only; no financial/PII beyond existing results surface | projection review |

## 16. Audit design (PROPOSAL, existing conventions)

`results.finalized` (targetId=TermResult, metadata: studentId, termId,
version), `results.amended` (old+new ids, version), `results.voided`.
Generation/viewing of report cards/transcripts: NOT audited (reads;
consistent with existing results surface). Metadata ids-only.

## 17. API proposal

| Method/route | Permission | Notes |
|---|---|---|
| POST `/results/terms/:termId/finalize` `{studentIds?[], confirmLabel}` | results.finalize | batch or per-student; typed confirmation = term label; tx per student: read marks/attendance → compute → insert snapshot; PUBLISHED-exam-only inputs; 409 on already-finalized |
| POST `/results/records/:id/amend` `{reason, confirmLabel}` | results.finalize | recompute from current marks → new version; CAS supersede |
| POST `/results/records/:id/void` | results.finalize | rare; audited |
| GET `/results/report?termId&studentId?` | results.read (OWN/CHILD/ALL) | the finalized term report card |
| GET `/results/transcript?studentId?` | results.read (OWN/CHILD/ALL) | all FINALIZED terms + CGPA |
| GET staff listing `/results/finalization?termId` | results.finalize | who is/isn't finalized |

Errors: `NOT_FINALIZED`, `ALREADY_FINALIZED`, `NO_PUBLISHED_RESULTS`,
`CONFIRMATION_MISMATCH`, standard 404/403. No client-supplied
collegeId/derived identifiers anywhere.

## 18. UI proposal

- Staff: Results page gains a **Finalization** tab (term picker, table
  of students with finalized/version status, batch finalize with typed
  confirmation, amend action on finalized rows).
- Student: `/results` gains **Report card (term)** and **Transcript**
  views reading finalized data; existing per-exam report stays as-is.
- Guardian: children page links (existing pattern) to the same
  read-only views.
- Print: reuse the **existing `window.print()` print-CSS pattern**
  (VERIFIED at `/results/report/[examId]`) for both documents.

## 19. Export/PDF architecture

**RECOMMENDATION (O-8): no PDF library in M18.** The proven
browser-print pattern covers "Print / Save as PDF" with zero new
dependencies; server-side PDF (receipts, certificates, bulk) remains a
separate future milestone. Transcript/report CSV: not needed in v1
(results.csv already exports raw marks); revisit on demand.

## 20. Migration strategy (PROPOSAL — not created in W0)

Migration **#12**: two new tables + `TermResultStatus` enum + partial
unique `TermResult_one_finalized_per_student_term` (raw SQL) + indexes
+ `results.finalize` permission row via shared matrix/seed. Purely
additive; no backfill (historical terms are finalized deliberately by
operators); forward-only rollback posture per OPERATIONS §23; PG16
plain DDL.

## 21. Test strategy (for W1/W2)

Real-Postgres e2e: finalization happy path (numbers match the live
results computation at finalization time); immutability (marks changed
after finalize → report unchanged; amend → new version with new
numbers, old SUPERSEDED and still readable); partial-unique concurrent
finalize → [201, 409]; amend race CAS; CLOSED-term finalize ALLOWED
(O-1) while mark edits stay blocked (M17 regression); reopen-then-edit-
then-amend flow; authz matrix (finalize: admin ✓, teacher/student/
guardian/accountant ✗; reads: OWN self-only, CHILD linked-only, rival
404); transcript correctness (multi-term, CGPA per O-4 policy, DROPPED
handling); typed-confirmation refusals; audit exactly-once; print views
via Alloy walkthrough (no web harness, per precedent); full 528-suite
regression.

## 22. Workstream plan (PROPOSAL)

- **W0** (this): discovery + design; decisions O-1…O-11 resolved.
- **W1 — Foundation**: migration #12, models, `results.finalize`
  permission + seed, ResultsFinalizationService (finalize/amend/void,
  CAS + partial unique), audit events, foundation tests.
- **W2 — Report card + transcript engines**: read endpoints (report/
  transcript/finalization listing), GPA/CGPA per approved policy,
  adversarial + immutability + concurrency suite.
- **W3 — UI**: finalization tab, report-card + transcript views +
  print CSS, guardian/student surfaces, Alloy walkthrough + demo
  restore.
- **W4 — Hardening/close-out**: security audit, OPERATIONS runbook,
  history/debt register, final regression.

Sequence rationale: engines before UI mirrors M15–M17; no external
providers → no probe workstream.

## 23. Risks

1. GPA policy (O-4) is a real product decision — wrong defaults are
   politically costly for a school; keep nullable columns so v1 can
   ship grades-only if needed.
2. Finalization input quality: unpublished exams are excluded — a
   term finalized too early yields thin snapshots; mitigated by the
   staff listing + `NO_PUBLISHED_RESULTS` guard + amendments.
3. Denormalization drift is intentional (snapshots) — document it.
4. Demo-data reseeds mid-milestone (observed repeatedly) — walkthrough
   scripts must re-resolve ids.

## 24. Open questions

- **O-1 (what is finalized?)** RECOMMENDATION: a per-student, per-term
  immutable snapshot computed from PUBLISHED exams' locked marks +
  attendance; finalization allowed on ACTIVE and CLOSED terms (typical
  flow: publish exams → close term → finalize).
- **O-2 (report cards snapshot vs dynamic)** RECOMMENDATION: immutable
  snapshot (§11).
- **O-3 (transcripts)** RECOMMENDATION: dynamically assembled from
  immutable finalized results.
- **O-4 (GPA/CGPA policy)** OPEN — RECOMMENDATION: activate the dormant
  hooks: course grade point = band.gradePoint at finalization; term
  GPA = Σ(gradePoint×credits)/Σcredits over passed+failed courses;
  CGPA same across FINALIZED terms; pass = band floor (gradePoint > 0).
  Requires your approval; v1 can ship without GPA (nullable).
- **O-5 (amendments)** RECOMMENDATION: version-chain amendment
  (§11/§13), `results.finalize`-gated, reason required, audited.
- **O-6 (after reopen)** RECOMMENDATION: reopening never alters
  snapshots; corrected marks reach records only via explicit amend.
- **O-7 (who finalizes)** RECOMMENDATION: ADMIN via new
  `results.finalize` (matrix-only change); teachers do not finalize.
- **O-8 (PDF)** RECOMMENDATION: browser-print in M18; server PDF is a
  later milestone.
- **O-9 (dues-gated transcripts?)** OPEN — RECOMMENDATION: no gating in
  v1 (display-only; policy varies per school).
- **O-10 (rank/position)** OPEN — RECOMMENDATION: defer (contentious,
  computable later from snapshots).
- **O-11 (repeated courses in CGPA)** OPEN — RECOMMENDATION: all
  attempts count in v1 (simplest, honest); revisit with registrar
  policy.

## 25. Deferred/debt interaction

M18 depends on M17 lifecycle (satisfied) and on grade bands (seeded).
It does not touch: monitoring/backups, P2-IDOR-1, webhook items,
receipts/PDF platform, maker-checker, P3 register — all statuses
preserved. It CONSUMES two dormant hooks (`GradeBand.gradePoint`,
`ExamPaper.weight` — note: weight stays dormant in v1 unless O-4
requests weighted papers; flagged to avoid silent activation).

## 26. Acceptance criteria for W1

Migration #12 applied (12, up to date); finalize/amend/void work over
HTTP with typed confirmation, CAS, partial-unique race collapse, audit
rows; immutability proven (post-finalize mark edits don't change
snapshots); authz/tenancy matrix green; full regression (528+) green;
typecheck 0; builds green; one commit, pushed.

## 27. W0/W1 boundary

W0 changed ONLY documentation. No schema, migrations, services,
controllers, UI, seeds, permissions, shared contracts, or tests were
touched. W1 begins only with explicit authorization and resolution of
O-4 (or an explicit "ship v1 without GPA") plus O-7/O-8 defaults.
