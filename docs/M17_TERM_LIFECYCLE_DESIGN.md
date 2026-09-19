# M17 Term Lifecycle — Design Specification (W0/H1)

Labels: **VERIFIED** (established from source at `d348c9f`), **DECISION**
(locked product choice D-1…D-6), **PROPOSAL** (implementation
recommendation), **UNVERIFIED**, **DESIGN GAP**.

## 1. Executive summary

CampusOS has a first-class semester boundary (M15 rollover) and a
battle-tested money engine (M14/M16), but **no term lifecycle**: a term
whose enrollments were COMPLETED by rollover still accepts attendance,
marks, timetable edits, new fee structures and new invoices forever
(VERIFIED — zero term-status gating exists in any mutation service).
M17 introduces `ACTIVE → CLOSED` (reopenable) term states, a single
reusable `assertTermOpen` guard enforced across every term-bound
mutation, finance-safe exemptions (arrears, refunds, reads), plus three
small finance-integrity items carried from the M16 close-out: the
net-of-refunds reducer consolidation (fixing DEFECT-1), guardian
read-only refund visibility, and the accountant `/fees` landing.

## 2. M16 → M17 context (VERIFIED)

M16 closed at `d348c9f` (502/502 tests, 37 suites, 10 migrations).
Carried forward into M17 scope by the close-out audit: DEFECT-1
(dashboard gross-of-refunds display), guardian refund CHILD projection
(deferred in W4), accountant dashboard landing (accepted cosmetic gap),
and M15's deferred D6 term freeze. Everything else in the debt register
stays untouched (§24).

## 3. Current architecture (VERIFIED)

- NestJS thin controllers → `@RequirePermission` → PermissionsGuard →
  PolicyService (DB grants, scopes ALL/OWN/ASSIGNED/CHILD) → services
  tenant-filtered by `user.collegeId` → Prisma/PostgreSQL 16.
- Financial discipline: invoice-row `SELECT … FOR UPDATE` + CAS
  transitions; typed confirmations validated server-side (rollover,
  refund execute); audit metadata = ids/amounts only; DB invariants via
  raw-SQL partial uniques (`Term_one_current_per_college`,
  `RefundAttempt_one_inflight_per_payment`) and CHECKs.

## 4. Term / AcademicYear model audit (VERIFIED)

`Term` (schema.prisma:581): id, collegeId, academicYearId, label,
startsOn/endsOn, `isCurrent Boolean @default(false)`, timestamps;
relations: sections[], exams[], feeStructures[], rollovers;
`@@unique(academicYearId, label)`. **No status field.** Term
create/update via `CalendarService` (`academics.manage`); no delete
endpoint exists. Term-bound data hangs off three roots: **Section**
(→ enrollments, teachingAssignments, timetable slots, class sessions,
attendance, assignments, submissions), **Exam** (→ papers → marks/
results), **FeeStructure** (→ invoices → payments/refunds).

## 5. Current-term semantics (VERIFIED)

Current-term state lives directly on `Term.isCurrent`, guaranteed
at-most-one-per-college by the M15 partial unique index
`Term_one_current_per_college` (raw SQL, migration #9).
`CalendarService.setCurrentTerm` swaps atomically in one transaction
(clear-then-set). Rollover never changes currency; the operator flips
it afterwards. Concurrent set-current calls are safe (DB invariant).
**UNVERIFIED**: no existing lock orders set-current against other term
mutations — irrelevant today, but D-3 enforcement must serialize close
vs. set-current (§17).

## 6. Locked product decisions (DECISION)

- **D-1 Freeze scope**: CLOSED blocks academic mutations + creation/
  modification of term-bound fee structures + new invoice generation;
  CLOSED allows historical reads, arrears collection on existing
  invoices, refunds, reconciliation/financial history. *Rationale*: the
  academic record is a historical fact once the semester ends, but the
  financial ledger tracks real-world money that keeps moving — a student
  paying last semester's dues or receiving a refund is a present-day
  event about a past obligation, not a rewrite of history (Payment/
  Refund rows are additive and immutable; only derived invoice status
  moves — the M16 invariants already guarantee this).
- **D-2 Reopen**: allowed, ADMIN-only… strictly: whoever holds the
  gating permission — see §16 (no maker-checker), typed confirmation,
  audited, server-side state checks; never accountant/teacher/student/
  guardian.
- **D-3**: the current term cannot be closed.
- **D-4**: rollover OFFERS closing the source term; never automatic;
  rollover remains independently usable.
- **D-5**: guardians get read-only refund visibility through the
  existing CHILD authorization model only.
- **D-6**: accountants land on `/fees` via the existing
  permission-driven architecture; no new permission.

## 7. Term state machine (PROPOSAL)

```
ACTIVE ──close (typed confirmation, not current)──▶ CLOSED
CLOSED ──reopen (typed confirmation)──▶ ACTIVE
```

- Allowed: ACTIVE→CLOSED (guarded by D-3), CLOSED→ACTIVE.
- Forbidden: closing a CLOSED term (409 `INVALID_TRANSITION`), reopening
  an ACTIVE term (409), closing the current term (400
  `TERM_IS_CURRENT`), any transition on a foreign term (404).
- Trigger authority: the permission gate of §16 (ADMIN holds it;
  ACCOUNTANT/teacher/student/guardian do not).
- Transactions: one transaction per transition — row-lock the Term
  (`SELECT … FOR UPDATE`), re-check `isCurrent` and status inside the
  lock, CAS `updateMany({ where: { id, collegeId, status: <expected> } })`,
  audit in the same transaction. Zero-count CAS → 409.
- Concurrency: double-close/double-reopen collapse to one winner + one
  409; close racing set-current is serialized by taking the Term row
  lock in both operations (set-current must be extended to lock the
  target term row — W1 scope).
- Idempotency: transitions are not idempotent by design (a replayed
  close of a CLOSED term is a 409, mirroring rollover execute).
- Typed confirmation: request body `{ confirmLabel }` must equal the
  term label exactly (M15 rollover pattern), validated server-side.
- Tenancy: `findFirst({ id, collegeId })` before anything; foreign → 404.
- DB-level invariant: **PROPOSAL** — none required beyond the enum
  column itself; the transition set is total (any state can be exited by
  an authorized operator), so a CHECK/trigger adds nothing. The current-
  term invariant remains the existing partial unique. D-3 is a
  service-level CAS predicate (`status`+`isCurrent` re-read under lock),
  which is sufficient because both mutating paths hold the Term row lock.

## 8. CLOSED capability matrix (DECISION D-1 applied to VERIFIED surfaces)

| Capability | ACTIVE | CLOSED | Notes |
|---|---|---|---|
| Historical reads (all modules) | ✅ | ✅ | untouched |
| Attendance session generate/record/edit | ✅ | ❌ | via section→term |
| Mark entry (PUT papers/:id/marks) | ✅ | ❌ | via exam→term |
| Exam create/edit/publish/papers | ✅ | ❌ | exam.termId |
| Assignment create/edit/delete/publish | ✅ | ❌ | section→term |
| Submission create/grade | ✅ | ❌ | assignment→section→term |
| Timetable slot create/edit/delete | ✅ | ❌ | section→term |
| Enrollment add/remove | ✅ | ❌ | section→term |
| Section create/edit; teacher assign/remove | ✅ | ❌ | section.termId |
| Term label/date edits | ✅ | ❌ | close means closed |
| Fee structure creation (for that term) | ✅ | ❌ | structure.termId |
| Fee structure mutation | ✅ | ❌ | |
| Invoice generation | ✅ | ❌ | structure→term |
| Existing invoice read | ✅ | ✅ | |
| Invoice cancel | ✅ | ❌ | mutates the obligation record; arrears settle instead (PROPOSAL — flag if disputed) |
| Arrears payment (manual + online) on existing invoices | ✅ | ✅ | D-1 |
| Refund (RECORDED + PROVIDER) | ✅ | ✅ | D-1/M16 D-7 spirit |
| Reconciliation / verify | ✅ | ✅ | |
| CSV exports | ✅ | ✅ | reads |
| Term close | ✅ (if not current) | ❌ (409) | |
| Term reopen | ❌ (409) | ✅ | |
| Rollover FROM this term (source) | ✅ | ✅ | reads source only; source enrollments already COMPLETED by execution — closing after is the norm (D-4) |
| Rollover INTO this term (destination) | ✅ | ❌ | destination must be open (guard in createDraft/execute) |
| Set current | ✅ | ❌ | a CLOSED term cannot become current (corollary of D-3; **PROPOSAL**) |

## 9. `TermLifecycleService.assertTermOpen()` design (PROPOSAL)

```ts
// apps/api/src/academics/term-lifecycle.service.ts
assertTermOpen(tx: Prisma.TransactionClient | PrismaService,
               collegeId: string, termId: string): Promise<void>
```

- Input: collegeId always from the authenticated user (never client),
  termId resolved SERVER-side by the caller (from section/exam/structure
  — §10/§11), optional tx so guards run inside the caller's transaction.
- Term missing / foreign college → 404 `NOT_FOUND` (no enumeration:
  indistinguishable from nonexistent).
- CLOSED → 409 `{ code: 'TERM_CLOSED', message: 'This term is closed —
  its records are read-only' }` (409, not 403: it is a state conflict,
  not an authorization failure; consistent with INVALID_TRANSITION
  conventions).
- ACTIVE → returns.
- Runs AFTER authorization (guards/permissions first — an unauthorized
  caller must never learn term state) and INSIDE the mutation's
  transaction where one exists, so close-vs-write races serialize on
  the Term row (`SELECT status FROM "Term" WHERE id=… FOR SHARE` —
  see §17).
- Current-term logic does NOT live here (that belongs to close/
  set-current); the guard is a pure open-state assertion.
- One shared service, injected where needed — never duplicated
  conditionals.

## 10. Academic mutation inventory (VERIFIED call sites)

Term identity is always DERIVED server-side (section.termId,
exam.termId); every listed site already tenant-checks via collegeId and
is permission-gated; guard insertion is clean in each service method
right after entity resolution:

| # | Entry point | Service fn (file) | Mutates | Term path | Block when CLOSED |
|---|---|---|---|---|---|
| 1 | POST attendance/sections/:sectionId/sessions/generate | attendance.service generateSessions | ClassSession | section.termId | ✅ |
| 2 | PATCH attendance/sessions/:id (+record marks within) | attendance.service recordSession | ClassSession/AttendanceRecord | session→section→term | ✅ |
| 3 | POST exams | exams.service createExam | Exam | body termId (validated same-college today) | ✅ |
| 4 | PATCH exams/:id | updateExam | Exam | exam.termId | ✅ |
| 5 | POST exams/:id/publish | publish | Exam/results | exam.termId | ✅ |
| 6 | POST exams/:id/papers, PATCH …/papers/:paperId | paper CRUD | ExamPaper | exam.termId | ✅ |
| 7 | PUT exams/papers/:id/marks | saveMarks | Mark | paper→exam→term | ✅ |
| 8 | POST/PATCH/DELETE assignments, POST …/publish | assignments.service CRUD | Assignment | section.termId | ✅ |
| 9 | POST assignments/:id/submissions | submit | Submission | assignment→section→term | ✅ |
| 10 | PATCH submissions/:id/grade | grade | Submission | same | ✅ |
| 11 | POST/PATCH/DELETE timetable/slots | timetable.service | TimetableSlot | section.termId | ✅ |
| 12 | POST/DELETE sections/:id/enrollments/:studentId | sections.service enrollment | Enrollment | section.termId | ✅ |
| 13 | POST/DELETE sections/:id/teachers/:teacherId | teaching assignment | TeachingAssignment | section.termId | ✅ |
| 14 | POST/PATCH sections | sections.service create/update | Section | body/section termId | ✅ |
| 15 | PATCH terms/:id (calendar edits) | calendar.service updateTerm | Term | itself | ✅ |
| 16 | POST terms/:id/rollover (+PATCH/execute) as DESTINATION | rollover.service | sections/enrollments | toTerm | ✅ destination must be open |
| 17 | PATCH terms/:id/set-current | calendar.service | Term.isCurrent | itself | ✅ CLOSED not settable current |

Special exceptions: none for academics — the block list is total.
Rollover as SOURCE remains allowed (reads only).

## 11. Finance mutation inventory (VERIFIED)

| Entry point | Service fn | Term path | CLOSED behavior |
|---|---|---|---|
| POST fees/structures | fees.service createStructure | body termId (college-validated today, **no term-state check — the accidental-CLOSED-target risk is real, VERIFIED**) | ❌ blocked |
| PATCH fees/structures/:id | updateStructure | structure.termId | ❌ blocked |
| POST fees/invoices/generate | generateInvoices | structure→termId | ❌ blocked |
| PATCH fees/invoices/:id/cancel | cancelInvoice | invoice→structure→term | ❌ blocked (PROPOSAL, §8) |
| POST fees/invoices/:id/payments | recordPayment | same | ✅ allowed (arrears) |
| POST fees/invoices/:id/pay (+webhook/verify settlement) | payments.service | same | ✅ allowed (arrears) |
| Refund create/execute/cancel/verify | refunds.service | payment→invoice→…→term | ✅ allowed |
| Reconciliation, summaries, exports | — | reads | ✅ allowed |

Financial history stays operational because Payment/Refund are additive
immutable ledgers (M16 invariants) — settling or refunding old-term
money never rewrites academic history.

## 12. Net-of-refunds consolidation (VERIFIED inventory; W2 scope)

`netPaid(invoice) = Σ payments − Σ refunds`. Eight sites exist:

| Site | State |
|---|---|
| fees.service `paidAmount()` :54 | NET |
| fees.service summary :578 | NET |
| payments.service initiation :308 | NET |
| payments.service settlement :470 | NET |
| refunds.service refundable/recompute :98/:120 | NET |
| exports fees.csv :229 | NET (M16-W5) |
| **dashboards.module-parts.ts :118 (admin collected)** | **GROSS — DEFECT-1** |
| **dashboards.module-parts.ts :257 (student fee balance)** | **GROSS — DEFECT-1** |

PROPOSAL: shared helper `netPaid(rows: {payments; refunds})` in
`apps/api/src/fees/money.ts` (or fees.service export), adopted at all 8
sites in W2; regression tests assert dashboard figures equal the fees
summary after a refund. (Guardian dashboard fee figures live in the same
module — swept in the same change.)

## 13. Rollover integration (VERIFIED current behavior + PROPOSAL)

Rollover (M15-W2): source resolved by `fromTermId` (same college),
destination must be an EMPTY existing term; execution copies sections/
teachers/enrollments per plan, COMPLETES source ACTIVE enrollments,
never touches money/timetables; one atomic tx; `academics.manage`;
audits `terms.rollover_drafted/executed`; success screen already says
"set current / build timetables / generate invoices next".

PROPOSAL (W1 backend + W3 UI): after EXECUTED, the success view offers
**"Close {source term}"** — a plain call to the standard close endpoint
(typed confirmation dialog, same as calendar). Declining changes
nothing; rollover success is fully independent of the close outcome.
No new backend surface beyond the close endpoint itself.

## 14. Guardian refund projection (VERIFIED gap + PROPOSAL)

Today `RefundsService.paymentSummary` short-circuits CHILD scope to 404
(`id: '__none__'`). Guardians CAN read CHILD-scoped invoices via
`fees.read`/`policy.can(user,'fees.read',{studentProfileId})`
(fees.service getInvoice precedent). PROPOSAL (W3): replace the
short-circuit with the same `policy.can` check against the payment's
`invoice.studentId`; response reuses the existing read-only
`PaymentRefundSummary` (amount, date, method, status, refundable, net
balance already visible via invoice). No schema, no new permission, no
mutation exposure (mutations stay `finance.refund`). UI already renders
read-only when the summary loads.

## 15. Accountant landing (VERIFIED gap + PROPOSAL)

`/dashboard` dispatches on resolved dashboard.* permissions and falls
through to StudentView → clean 403 for accountants. PROPOSAL (W3):
permission-driven default-route selection — the existing session
context already exposes `hasPermission`; the dashboard page (or login
redirect) sends users with NO dashboard.* grant but `fees.manage` ALL…
strictly: with no dashboard permission, redirect to the first
authorized nav item (`navItemsFor` already computes it) — `/fees` for
accountants. Zero role names, zero new permissions, works for any
future finance-only role.

## 16. Authorization & tenancy (PROPOSAL within VERIFIED architecture)

Close/reopen gate: **`academics.manage`** (calendar/rollover precedent —
term lifecycle is academic administration). ADMIN holds it; ACCOUNTANT
does not (satisfies D-2's role expectations with zero role conditionals).
**DESIGN GAP flagged for approval (O-1, §27)**: if you want reopen
restricted more tightly than close someday, a dedicated permission would
be needed — NOT recommended for V1. All lookups `findFirst({id,
collegeId})`; foreign terms 404 on close/reopen/read; guard runs after
authorization everywhere.

## 17. Concurrency / transaction strategy (PROPOSAL)

- **Close/reopen**: tx { `SELECT … FOR UPDATE` on Term → re-read
  status+isCurrent → CAS updateMany → audit }.
- **Close vs academic write**: mutation services call `assertTermOpen`
  inside their own tx with `FOR SHARE` on the Term row; close takes
  `FOR UPDATE` — Postgres serializes them, so a write either completes
  before the close commits or observes CLOSED. Where a mutation has no
  existing tx (simple creates), wrap create+guard in one tx.
- **Close vs set-current**: set-current extended to row-lock the target
  term (and assert not CLOSED) — both paths then serialize on the row.
- **Close vs rollover**: rollover execute already locks the TermRollover
  row and revalidates; add destination `assertTermOpen` inside its tx.
- **Close vs invoice generation**: generateInvoices wraps structure
  resolution + guard + createMany in one tx with the term FOR SHARE.
- Application-level checks alone are NOT sufficient; the row-lock
  discipline above is mandatory (adversarial tests in W2 prove it with
  real Postgres races).

## 18. Security threat model

| Attack | Defense | Test |
|---|---|---|
| Cross-college term id on close/reopen | findFirst(collegeId) → 404 | rival ids on both endpoints |
| Cross-college mutation into closed term | existing tenancy + guard | rival section/exam ids |
| Closed-term IDOR probing | 404 before state disclosure | unauthorized caller sees 403/404, never TERM_CLOSED |
| Reopen another college's term | 404 | ✅ |
| Unauthorized close/reopen (teacher/student/guardian/accountant/anon) | `academics.manage` gate | full role matrix |
| Accountant reopen attempt | no academics.manage → 403 | explicit test |
| Concurrent close ×2 / reopen ×2 | CAS → [200,409] | Promise.all race |
| Close racing academic write | row-lock serialization | real-DB race: write during close |
| Close racing rollover-into | destination guard inside rollover tx | race test |
| Close racing invoice generation | tx + FOR SHARE | race test |
| Client-controlled termId redirection | term always derived from entity; body termIds college+state validated | forged-body tests |
| Stale UI mutation after closure | server 409 TERM_CLOSED; UI surfaces message | e2e + walkthrough |
| Direct HTTP bypassing UI | server is the only boundary (existing discipline) | all tests are HTTP-level |
| Audit spoofing | AuditService server-side only; metadata ids/labels | audit assertions |
| Privilege escalation via lifecycle | no new grants; PolicyService untouched | matrix |

## 19. Audit events (PROPOSAL, existing conventions)

- `terms.closed` — authoritative transition event (in-transaction),
  target Term, metadata `{ label }`.
- `terms.reopened` — authoritative reopen event, same shape.
- Failed attempts: NOT audited (convention: only real transitions are —
  matches rollover/refunds; auth failures are visible via 4xx paths).
- No PII anywhere (term labels only).

## 20. UI/UX (PROPOSAL; W3)

Calendar: CLOSED badge (neutral tone) on term rows; "Close term…"
action (hidden for the current term with an explanatory tooltip);
"Reopen term…" on CLOSED rows; both use the existing typed-confirmation
dialog (type the term label; button disabled until exact; busy-guarded);
consequence text: "Closing makes this term's academic records read-only.
Arrears payments and refunds remain possible. You can reopen it later."
Rollover success view: optional "Close {source}" button → same dialog.
Blocked mutations elsewhere surface the server's TERM_CLOSED message via
the existing toast conventions (no client-side prediction). Guardian
refund history renders through the existing read-only section.
Accountants land on `/fees` (no dashboard dead-end).

## 21. Migration #11 (PROPOSAL — NOT created in W0)

- `CREATE TYPE "TermStatus" AS ENUM ('ACTIVE','CLOSED')` (new enum — no
  ALTER TYPE ADD VALUE concerns); `ALTER TABLE "Term" ADD COLUMN
  "status" "TermStatus" NOT NULL DEFAULT 'ACTIVE'`.
- Backfill: none needed (default covers existing rows — all historical
  terms remain ACTIVE; operators close them deliberately).
- Index: `@@index([collegeId, status])` (listings/guards).
- Constraints: none beyond the enum (§7); existing
  `Term_one_current_per_college` untouched.
- Rollback: standard additive-migration posture (forward-only per
  OPERATIONS §23; column is ignorable by older code).
- PostgreSQL 16: plain transactional DDL, no quirks.
- Existing data remains valid by construction.

## 22. Test strategy (design; implemented across W1/W2)

New `term-lifecycle.e2e-spec.ts` + additions inside existing module
suites (real Postgres, existing harness):
lifecycle (close/reopen happy paths, typed-confirmation refusal, 409s
on invalid transitions, current-term close → TERM_IS_CURRENT, CLOSED
set-current refusal); authz matrix (admin ✓; accountant/teacher/
student/guardian 403; anon 401); tenancy (rival term 404 both ways, no
state leakage); enforcement — every §10 row attempted against a CLOSED
term → 409 TERM_CLOSED and zero rows written, then reopen → succeeds;
finance: structure create/update + generateInvoices blocked, arrears
recordPayment + online settlement + full refund cycle ALLOWED on a
CLOSED term, reconciliation/exports readable; races: double-close,
close-vs-attendance-write, close-vs-generateInvoices,
close-vs-rollover-destination (Promise.all, DB-verified outcomes);
rollover integration: close offered/declined leaves source ACTIVE,
accepted closes it; reducers: post-refund dashboard figures ==
fees summary (DEFECT-1 regression) across all 8 sites; guardian
CHILD-scope refund summary 200 read-only (and still 404 for unlinked
children); accountant landing → /fees (Alloy). Migration test:
`migrate status` = 11; full 502-suite regression green. Alloy
walkthrough with pre-snapshot + exact demo restoration.

## 23. Workstream plan

- **W1 — Foundation**: migration #11 + TermStatus; shared enums/types;
  `TermLifecycleService` (assertTermOpen + close/reopen); endpoints
  `POST terms/:id/close` / `POST terms/:id/reopen` (`academics.manage`,
  `{confirmLabel}`); set-current CLOSED refusal + row lock; rollover
  destination guard; audit events; foundation tests. NO broad academic
  enforcement yet. Stop: suite green, migrate status 11.
- **W2 — Enforcement + money consolidation**: wire guard into all §10/§11
  sites; `netPaid()` helper across 8 reducers (fix DEFECT-1);
  adversarial/concurrency suite. Stop: full matrix green.
- **W3 — UI + finance polish**: calendar badges/close/reopen dialogs;
  rollover close offer; guardian refund projection; accountant `/fees`
  landing; Alloy walkthrough + demo restoration. Stop: walkthrough
  clean.
- **W4 — Hardening/close-out**: security re-audit, OPERATIONS §26
  term-lifecycle runbook, history/debt register, final regression,
  close-out report.

Dependency: W1 → W2 → W3 → W4 (strict).

## 24. Deferred scope (statuses preserved — NOT pulled into M17)

Refund webhooks + dashboard registration (externally blocked);
automatic provider polling; refund receipts/PDFs; advanced refund
dashboards/reporting; maker-checker / finance.refund.approve;
P2-IDOR-1; single global webhook secret; monitoring/backup automation;
P3 register (mail escaping, Google callback limiter, DEPARTMENT dead
scope, legacy guardian PII columns, per-instance limits, Prisma range,
backup docs); report cards/transcripts (M18 candidate).

## 25. Risks

1. Enforcement breadth (17 academic + 4 finance sites) — mitigated by
   the single shared guard + per-site tests; the risk is a MISSED site,
   so W2 includes a grep-audit checklist mirroring §10/§11.
2. Guard-induced deadlocks (Term FOR SHARE inside existing txs) — lock
   ordering documented: always Term before Invoice; W2 race tests.
3. Historical suites that mutate old-term fixtures may need fixture
   terms left ACTIVE — expected, not a behavior change.
4. Invoice-cancel-on-CLOSED (PROPOSAL in §8) could be disputed — O-2.
5. Sandbox restarts reseed demo ids mid-milestone (observed twice) —
   walkthrough scripts must re-resolve ids, never hardcode.

## 26. Acceptance criteria for W1

Migration #11 applied cleanly on the real DB (`migrate status`: 11, up
to date); close/reopen work end-to-end over HTTP with typed
confirmation, CAS, audit rows; D-3 enforced under the term row lock;
CLOSED terms rejected by set-current and as rollover destinations;
foundation authz/tenancy/race tests green; full regression (502 + new)
green; typecheck 0; both prod builds green; zero role conditionals; one
commit, pushed.

## 27. Open questions (need explicit approval; defaults proposed)

- **O-1**: Close/reopen permission = `academics.manage` for BOTH
  (default: yes). Alternative: separate reopen permission — not
  recommended V1.
- **O-2**: Invoice CANCEL on a CLOSED term blocked (default: yes,
  §8/§11). Alternative: allow as a finance operation.
- **O-3**: CLOSED term as rollover SOURCE allowed (default: yes — reads
  only; supports close-then-rollover-elsewhere sequences).

## 28. Final architecture decision summary

One new enum + column (migration #11); one reusable transactional guard
(`assertTermOpen`) enforced at 21 verified mutation sites; two audited,
typed-confirmed, CAS-protected transitions gated by `academics.manage`;
finance deliberately exempted for additive ledger operations; three
small M16 carry-overs (netPaid consolidation/DEFECT-1, guardian refund
read, accountant landing) folded into W2/W3; everything else stays
deferred. The design reuses the M15 invariant/typed-confirmation
patterns and the M16 money discipline wholesale — no new architectural
concepts are introduced.
