# M23 Platform Discovery & Design

Status: **W0 DISCOVERY/DESIGN ONLY.** No M23 implementation exists. No source,
schema, migration, package, UI, Docker or configuration file was changed.

Baseline verified before and after discovery: HEAD `116127d` (M22 CLOSED),
clean tree, local = remote, 650/650 tests (52 suites), typecheck 0, Prisma
valid, 15 migrations up to date, API/web production builds green, all
containers healthy, demo state unchanged
(20 users all ACTIVE, 13 student profiles, 1 college, fingerprint
`50424fec…`).

---

## 1. Current platform inventory

- **Runtime**: NestJS 10 API, Prisma 5.22 / PostgreSQL, Next.js 14 web,
  shared TypeScript/Zod contract package. Node engines `>=20`; images
  `node:22-bookworm-slim`.
- **Authorization**: 38 permissions, 73 role grants, five scopes
  *(corrected in M24-W0 — this line originally read "37 permissions, 68
  role grants", which was a miscount. Verified against source at `ac25eec`
  and against the seeded `Permission`/`RolePermission` tables: 38 and 73.
  `permissions.ts` has been unchanged since M18 `c555035`, so this was
  never drift. See M24 finding N-31.)*
  (ALL/ASSIGNED/DEPARTMENT/OWN/CHILD) resolved by PolicyService
  (`packages/shared/src/permissions.ts:9-193`,
  `apps/api/src/access/policy.service.ts:139-233`).
- **Identity**: password + Google OIDC, hashed refresh-token families,
  credential links, verification claims, GuardianLink, and the M21
  ACTIVE/SUSPENDED/ARCHIVED lifecycle.
- **Academics**: years/terms with lifecycle + rollover, departments/courses/
  sections, timetable, attendance, assignments/submissions, exams/marks, and
  M18 immutable versioned term/course results with browser-print transcripts.
- **Finance**: fee structures/invoices, immutable Payment/Refund ledgers,
  Safepay initiation/verify/reconciliation, ACCOUNTANT role, and M20
  immutable numbered FinanceDocuments with void lifecycle.
- **Communication**: in-app inbox, daily scheduler sweeps, SMTP mail through a
  single escaped `layout()` chokepoint.
- **Files**: path-safe local adapter, 5-minute HMAC signed URLs, StoredFile
  ownership authz, stricter evidence authz.
- **Operations (M22)**: request correlation + AsyncLocalStorage context,
  fixed-schema JSON operational logging, six bounded instance-local counters,
  `/health/live` + `/health/ready` + `/health` + protected `/health/ops`,
  paired DB/uploads backup sidecar with complete-cycle freshness marker,
  restore drills, bounded container logs, production/Alloy volume parity.
- **Quality**: 53 API spec files / 640 `it` blocks, e2e-first against real
  PostgreSQL; 15 forward-only migrations.

## 2. M0–M22 verification / status

M0–M22 are **CLOSED**. Commit chain re-verified in
`docs/CAMPUSOS_DEVELOPMENT_HISTORY.md:166-170`: M22-W0 `b7fcbcc` → W1
`7f59346` → W2 `373faa0` → W3 `2a5808d` → W4 `116127d`. Filesystem confirms 15
migration directories. No M23 work exists in the tree or history.

**Documentation defect found**: the history file's trailing current-state block
(`docs/CAMPUSOS_DEVELOPMENT_HISTORY.md` footer) still claims "the M15-W4
close-out commit", "Migrations: 12", "Tests: 543/543 (40 suites)" and names
M19 as the current milestone — contradicted by the same file's M22 entry and by
the filesystem. Corrected in this W0 commit as a factual documentation fix.

## 3. Current architecture and trust boundaries

| Boundary | Control |
|---|---|
| Client → API | JWT guard loads the user fresh per request and denies non-ACTIVE (`auth/jwt-auth.guard.ts:60-80`); `@Public` limited to pre-session, health and HMAC-gated routes |
| Caller → resource | PolicyService scope resolution; services must self-narrow list-level scopes |
| Tenant → tenant | `collegeId` always server-derived; foreign resources return 404 |
| API → PostgreSQL | Prisma tagged-template raw SQL only (locks, migration probe); zero `$queryRawUnsafe`/`$executeRawUnsafe` |
| API → filesystem | Traversal-guarded adapter; random 16-byte keys; signed-URL delivery |
| API → mail | Single escaped chokepoint; only `https?://` becomes an anchor |
| Provider → API | Raw-body HMAC verified before any parse/write; tenancy from stored refs, never payload |
| Operator → runtime | `/health/ops` behind `settings.manage`; logs allowlisted; counters label-free |
| Build → image | `.dockerignore` excludes env/uploads/backups/dumps/archives at all depths |

## 4. Current debt register reconciliation

Verified against source; four M22-W0 rows are now resolved and must not be
re-listed as open:

| Item | Prior status | Verified status |
|---|---|---|
| Truthful readiness | open | **RESOLVED** (M22-W2) |
| Production backup parity | open | **RESOLVED** (M22-W3) |
| Uploads backup protection | open | **RESOLVED** (M22-W3, paired archives) |
| Production integration env parity | open | **RESOLVED** (M22-W3) |
| Observability V1 (request IDs, structured errors, counters) | open | **RESOLVED** (M22-W1/W2) |
| Container log retention | open | **RESOLVED** (M22-W3) |
| Docker build-context secret exclusion | open | **RESOLVED** (M22-W4) |
| Account deletion | deferred | **NO LONGER RELEVANT** — terminal archival is the deliberate model (`users/user-lifecycle.service.ts:21,130`) |
| StoredFile `FINANCE_DOCUMENT` purpose | deferred | **NOT APPLICABLE as code** — enum has four members only (`schema.prisma:570-575`); reopens only if server PDFs land |
| Fees CSV `termId` filter | documented W0 finding | **STILL BROKEN, worse than documented** (§8) |
| Webhook post-claim failure | documented latent | **UNCHANGED** (§6) |
| GPA/grade-point configuration | "unconfigurable" | **WORSE: actively destroyed** (§8) |

## 5. Deferred-item verification

Each item re-verified against current source. Dispositions preserved unless
evidence justifies change.

| Item | Disposition | Evidence |
|---|---|---|
| Reporting/analytics | **DEFER → strong M24 candidate** | Only per-domain summaries + 5 CSVs; no report module (`exports/exports.module.ts:366-402`) |
| GPA/grade-point completion | **STILL REQUIRED — M23 candidate** | `gradePoint` column exists (`schema.prisma:1077`) but absent from write schema (`packages/shared/src/schemas/exams.ts:50-66`) and read type; destroyed on edit (§8) |
| Global search | **DEFER** | Per-list `q` only (`packages/shared/src/schemas/common.ts:7`) |
| Notification preferences/digest | **PARTIAL / DEFER** | `emailOptOut` only (`schema.prisma:356`); inbox exposes list/count/read/read-all only (`inbox.controller.ts:94-115`) |
| Leave workflow | **DEFER (product-blocked)** | `EXCUSED` is an enum/display value only; no LeaveRequest model |
| Server-side PDF | **DEFER** | Browser print only (`fees/documents/[id]/page.tsx:54`) |
| Safepay webhook activation | **EXTERNALLY BLOCKED (unchanged)** | Dashboard registration unavailable |
| Webhook post-claim remediation | **STILL REQUIRED (latent)** | §6 |
| Provider polling | **PARTIAL / DEFER** | Manual verify + lazy TTL sweep (`payments.service.ts:535-551`); no cron |
| Multi-college | **DEFER** | Data tenant-shaped; integration credentials process-global (`config/env.ts:24,32,48`) |
| Off-host backups | **STILL REQUIRED, deployment-blocked** | Local volume only (`docker-compose.prod.yaml:44-46`) |
| PITR | **DEFER** | `pg_dump` daily granularity |
| External monitoring | **DEFER** | No exporter; `/health/ops` is the only surface |
| Distributed metrics / rate limiting | **DEFER** | Process-local by construction (`operational-counters.ts:13-25`, `rate-limiter.service.ts:8-10`) |
| Dependency upgrades | **DEFER (maintenance window)** | Prisma 5.22, Nest 10.4.22, Next 14.2.35, React 18.3.1, TS 5.9.3 — no current majors |
| Account deletion | **NO LONGER RELEVANT** | §4 |
| receipts.csv | **DEFER** | Not present in export controller |
| Maker-checker | **DEFER (product)** | `requestedById` captured but never compared to executor (`refunds.service.ts:256`, execute at `:323`) |
| i18n / reserved locale | **INERT AS DOCUMENTED** | `packages/shared/src/schemas/verification.ts:66-68` |

## 6. Security findings

**S-1 — HIGH — `results.read:ASSIGNED` is not narrowed on finalized-records
reads (newly discovered).**
`resolveReadTarget` handles OWN and CHILD, then returns any same-college
student for both ALL **and ASSIGNED**
(`apps/api/src/exams/results-finalization.service.ts:250-285`). It backs
`GET /results/report/term/:termId` and `GET /results/transcript`
(`apps/api/src/exams/exams.controller.ts:236-254`). TEACHER holds
`results.read: ASSIGNED` (`permissions.ts:152`), so any teacher can read any
same-college student's finalized report card and transcript via `?studentId=`.

*Live read-only proof (this W0):* as `teacher@campusos.dev` against a student
the teacher does not teach —
`GET /results/transcript?studentId=…` → **200** returning name, rollNo,
admissionNo, academicStatus, credits and CGPA fields; the correctly narrowed
siblings `GET /results?studentId=…` → **403** and
`GET /attendance/summary?studentId=…` → **403**. The correct ASSIGNED pattern
exists at `exams/exams.service.ts:578-590` and
`attendance/attendance.service.ts:444-456`.
Tenancy holds (collegeId server-derived); this is an intra-tenant horizontal
over-read. Today's payload is identity + null GPA because no term is finalized
in demo data; once any term is finalized it exposes complete academic records.

> **RESOLVED in M23-W1.** `ASSIGNED` now requires an `ACTIVE` `Enrollment`
> in a `Section` the caller holds a `TeachingAssignment` for — the same
> server-derived relationship used by `exams.service` and
> `attendance.service`. Denial reuses the existing `notFound('Student')`
> shape, so no enumeration oracle is added. Covered by 18 real-Postgres
> tests in `apps/api/test/m23-w1-results-authz.e2e-spec.ts`; the live
> request quoted above now returns **404** with an error envelope only.
> No migration, no permission change, no role-name conditional.

**S-2 — MEDIUM — audit coverage gap on mutating PATCH paths (newly
discovered).** No audit event is emitted for: fee-structure update, which
also deletes/recreates every `FeeComponent` and recomputes `totalAmount`
(`fees/fees.service.ts:201-236`, compare audited create at `:191-198`); exam
and exam-paper updates (`exams/exams.service.ts:241-265,392-433`); academic
year/term updates (`academics/calendar.service.ts:98-127,230-307`); section
update (`academics/sections.service.ts:197-246`); timetable slot update
(`timetable/timetable.service.ts:226-276`); assignment update
(`assignments/assignments.service.ts:277-312`); most community mutations;
evidence upload (`verification/verification.service.ts:95-113`).

> **RESOLVED in M23-W2** for the eight configuration/academic update
> paths, which now emit `fees.structure_updated`, `exams.updated`,
> `exams.paper_updated`, `academic_years.updated`, `terms.updated`,
> `sections.updated`, `timetable.slot_updated` and
> `assignments.updated` — each written inside the mutation's own
> transaction via the new `AuditService.logAtomic`, with server-derived
> actor and tenant and field-name-only metadata. 35 real-Postgres tests
> in `apps/api/test/m23-w2-audit-integrity.e2e-spec.ts`.
>
> **STILL OPEN:** community mutation updates and evidence upload were
> deliberately left out of W2 to keep the workstream bounded. Community
> creates are already audited (`community.*_created`) and evidence
> submission is covered by `verification.claim_submitted`, so neither is
> a silent-rewrite risk of the fee-structure kind. Both remain recorded
> here for a later workstream.

**D-4 — MEDIUM — unlocked fee-structure component replacement (newly
discovered in M23-W2, PRE-EXISTING, not fixed).**
`updateStructure` replaces components with `deleteMany` + `createMany`
and writes `totalAmount` in one transaction but takes no lock on the
`FeeStructure` row. Under READ COMMITTED concurrent updates interleave,
so surviving component rows can come from one transaction while
`totalAmount` comes from another, leaving the stored total inconsistent
with the sum of the stored components (observed: total 4010 vs sum 1004
under six racing writes). Unchanged M14/M17 behaviour — byte-identical to
pre-W2 HEAD apart from the appended audit call — so not a regression.
Fixing it requires row locking on a financial write path and therefore
separate authorization. Documented in the W2 suite (serial consistency
asserted, interleaving described rather than blessed) so it cannot change
silently. Should be triaged alongside D-1/D-2 in W3.

> **RESOLVED in M23-W3.** Added the established row lock
> `SELECT id FROM "FeeStructure" WHERE id = ${id} FOR UPDATE` (same
> pattern as the Invoice locks in payments/refunds), taken after the
> existing Term `FOR SHARE` so the Term-before-row lock order holds, plus
> a re-read of the pre-state under that lock so audit before-values are
> exact. Row-scoped: unrelated structures and other colleges are never
> serialized, and no advisory or global lock was introduced. Six writers
> racing one structure over four rounds now always commit
> `totalAmount == SUM(components)`, and exactly one writer's proposal
> survives (never a blend).

**S-3 — LOW — teacher attendance summary widens past the shared section.**
After a single shared-enrollment check, `studentSummary` returns per-section
attendance for all of the student's active enrollments
(`attendance/attendance.service.ts:443-532`).

**S-4 — LOW — `dashboard.guardian` granted with no server-side consumer.**
`permissions.ts:187`; guardian dashboard is composed client-side.

**S-5 — LOW, pre-existing and documented** — same-college file signing
(`files/stored-file-authz.service.ts:50-63`), grandfathered pre-M19 keys
(`:55`), single global webhook secret, no `FILE_URL_SECRET` dual-key window,
per-instance rate limits.

**Verified no-defect**: no role-name authorization conditionals; no
client-controlled `collegeId`; no unsafe raw SQL; no `child_process`/`eval`/
`new Function` in source; no `dangerouslySetInnerHTML`; no destructive/bulk
endpoints; no secrets in source; mail escaping chokepoint intact; account
lifecycle enforced at every auth boundary; finance immutability intact
(Payment/Refund create-only; FinanceDocument single CAS void; Invoice
status-only updates); `/health/ops` still `settings.manage`-gated.

## 7. Operational / reliability findings

- **O-A** Off-host backup and PITR remain absent; all artifacts share one host
  volume. Deployment-blocked, unchanged.
- **O-B** DB/uploads pairing is sequential, so a write between the two steps
  yields a mismatched pair. Documented limitation, not a defect.
- **O-C** Retention prunes each artifact pattern independently by mtime with no
  "keep at least N" floor, so a boundary-straddling pair can be half-retained
  (`scripts/backup/backup-cycle.sh:33-35`).
- **O-D** `.backup-health` records only a timestamp — no artifact identity,
  count or checksum; `/health/ops` pair counting compensates partially.
- **O-E** `uploads-restore-verify.sh` performs its member check inside a
  `| while` subshell, so aborting on an unsafe member relies on pipeline
  status; behavior is currently correct (verified rejecting a traversal
  archive in M22-W4) but the construct is fragile.
- **O-F** `/health/ops` needs the database to authenticate, so it is
  unavailable during a full outage. Accepted by design (authorization is never
  relaxed); `/health/ready` is the outage signal.
- **O-G** Deployment still assumes exactly one trusted proxy
  (`main.ts:43`), provides no TLS/ingress service, and publishes only the web
  port; API is reachable only through the Next server.
- **O-H** **No CI exists** (no `.github/workflows` or equivalent) and **no lint
  tooling exists** anywhere. The only gates are locally-run `typecheck` and the
  API suite.

## 8. Data-integrity findings

**D-1 — MEDIUM-HIGH — `fees.csv?termId=` returns 500 (newly confirmed).**
The export spreads `{ termId }` directly onto `Invoice`
(`exports/exports.module.ts:198-203`), but `Invoice` has no `termId`; term is
reachable only via `structure` (`schema.prisma:1126,1136`). The conditional
spread evades TypeScript excess-property checking, so Prisma rejects it at
runtime. *Live proof:* `GET /exports/fees.csv?termId=<real term>` → **500**,
while `?status=PAID` and no-filter both → **200**. The CSV header also has no
term column, so callers cannot detect the filter never applied.

> **RESOLVED in M23-W3.** The filter now runs through the existing
> required relationship, `{ structure: { termId } }`.
> `Invoice.structureId` is non-null and `FeeStructure.termId` is the only
> term relationship in the finance schema, so an invoice's term is
> unambiguous — no new relationship and no denormalized column. Live
> re-check: `?termId=<real>` went 500 → **200** with term-scoped rows; an
> unknown term is a deterministic empty export; a rival-college term
> returns nothing and leaks no rival invoice. CSV header and columns are
> unchanged.

**D-2 — MEDIUM — grade-band update destroys `gradePoint` (newly discovered).**
`updateGradeBands` runs `deleteMany` then `createMany` with only
`label/minPercent/maxPercent/sortOrder`
(`exams/exams.service.ts:762-776`). `gradePoint` is absent from the write
schema (`packages/shared/src/schemas/exams.ts:50-66`) and from
`GradeBandItem` (`packages/shared/src/types/exams.ts:92-98`), so any value set
out-of-band is silently erased by the next edit and is not even observable.
Consumers already fail-null correctly
(`results-finalization.service.ts:356-360,663`). Net: GPA is not merely
unconfigurable — the only configuration surface is a data eraser.

> **RESOLVED in M23-W3.** Replacement semantics are preserved, but
> `gradePoint` is now carried forward matched by `label` (the existing
> per-college band identity, `@@unique([collegeId, label])`). A new label
> gets `null` — no GPA policy is invented. `gradePoint` stays
> server-managed and is deliberately still absent from
> `gradeBandsUpdateSchema` and `GradeBandItem`, so the read/write
> contracts are unchanged and a client cannot set or forge it (proven:
> a body sending `gradePoint: 99 / -5 / 'abc'` is ignored). The
> transaction became interactive so the preservation read is atomic with
> the replacement, and `grade_bands.updated` moved inside it via
> `logAtomic` with count-only metadata.
>
> **STILL OPEN (observation, not fixed):** the band replacement remains a
> college-wide delete-and-recreate with no row lock, so simultaneous
> edits can contend; `@@unique([collegeId, label])` makes a blended
> result fail rather than commit silently, so it was left alone rather
> than widened into another locking change. Recorded for triage.

**D-3 — LOW — refund segregation of duties.** `requestedById` is recorded but
never compared against the executor, so maker-checker is a policy decision away
rather than a modelling gap.

## 9. Test / coverage findings

- **T-1 HIGH** `notification-scheduler.service.ts` (three daily sweeps,
  documented idempotency contract at `:6-14`) has **zero tests**; failures are
  swallowed by its own `catch`.
- **T-2 HIGH** `POST /students/import` (`students-import.service.ts`) has no
  dedicated suite — partial-failure, duplicate and tenancy behavior unverified
  on a hard-to-undo bulk path.
- **T-3 MEDIUM-HIGH** No owning suite for the `users` module's 15 endpoints;
  coverage is incidental across other suites.
- **T-4 MEDIUM** `refunds.csv` is authz-only tested; content/tenancy unverified.
- **T-5 MEDIUM** Dashboards have one aggregate test per endpoint on seeded data
  only; settings tested only for threshold/locale.
- **T-6 STRUCTURAL** Essentially no unit layer (one shell-script spec), so pure
  logic must be exercised through full app+DB boots; **no web test harness at
  all** (no jest/vitest/playwright in `apps/web`), and **no CI/lint**.

Coverage gaps are recorded as findings; W0 manufactured no tests.

## 10. Candidate M23 milestones

**A — Authorization Correctness & Audit Integrity.** Remediate S-1 across all
finalized-records read paths with a full scope matrix; close the S-2 audit gaps
on mutating finance/academic/structural paths; fix D-1 and D-2. Internal, no
migration, high security and data-integrity value, strong existing test
precedent.

**B — Institutional Reporting & Analytics.** Attendance/enrollment, cash-date
finance, finalized-results reports plus a reports workspace. High
institutional value, no migration, but it would build reporting on top of a
known authorization defect and a broken export filter.

**C — Verification Infrastructure (CI, lint, unit layer, web tests).** Closes
T-1…T-6 and creates lasting leverage; no product value by itself.

**D — Webhook Reliability & Payment Recovery.** Remediate the post-claim
failure path and add scheduled reconciliation. Small and valuable, but
activation stays externally blocked.

**E — Off-host Backup & Disaster Recovery.** Deployment-blocked on destination
and credentials.

**F — GPA/Academic Policy Completion.** Configurable grade points plus
repeat/rank policy; the repeat/rank half needs institutional decisions.

**G — Notification Preferences / Digest, H — Leave Workflow, I — Global
Search, J — Multi-college, K — Server PDF, L — Dependency Upgrades.** All
remain deferred, product-blocked or maintenance-track.

## 11. Evidence-based ranking

1. **A — Authorization Correctness & Audit Integrity.** Only candidate
   containing a proven HIGH authorization defect (S-1, demonstrated live), a
   500-producing integrity defect (D-1) and a silent data-destroying path
   (D-2). Fully internal, migrationless, testable against real PostgreSQL.
2. **D — Webhook reliability** (small; must precede any future activation).
3. **C — Verification infrastructure** (high leverage, no product value).
4. **B — Reporting** (highest institutional value; should follow A so reports
   inherit correct scopes and a working term filter).
5. **F — GPA/policy completion** beyond the D-2 fix.
6. **E — Off-host DR** (blocked), then G–L.

Bundling and splitting: D-2's *destruction* fix belongs in A (data integrity);
the broader GPA/repeat/rank *policy* stays in F. D-1 belongs in A because
reporting (B) would otherwise inherit a broken filter. S-1 must not be bundled
into a larger feature milestone — it is the reason A ranks first.

## 12. Recommended M23

**M23 — Authorization Correctness & Audit Integrity.**

Problem: the platform's advertised invariants hold almost everywhere, but the
M18 finalized-records read path silently treats `ASSIGNED` as `ALL`, several
mutating admin/finance paths emit no audit event, one export filter throws 500,
and the only grade-point configuration path erases data. These are correctness
and accountability defects in already-shipped features, not new capability.

Goals: exact scope narrowing on every academic-records read; audit coverage for
mutating finance/academic/structural operations; a working term filter on the
fees export; safe, observable grade-point configuration. Non-goals: any new
feature area, new permission, or new role.

## 13. Proposed W1–W4 plan

**W1 — Authorization remediation (S-1).** Narrow `ASSIGNED` on
`resolveReadTarget` per O-1; add a complete results-read scope matrix
(ALL/ASSIGNED/OWN/CHILD, cross-student, cross-college, tampered `studentId`)
plus regression coverage for report card and transcript. Expected files:
`exams/results-finalization.service.ts`, possibly
`exams/exams.controller.ts`, new/extended test suite. Migration: none.
STOP: matrix green, no envelope/status changes beyond the corrected denial.

**W2 — Audit integrity (S-2).** Emit audit events on the approved mutating
paths using the existing `AuditService` (no new framework, metadata minimal,
in-transaction where the operation is transactional). Expected files: fees,
exams, calendar, sections, timetable, assignments services (+ community and
evidence upload per O-2). Migration: none. STOP: per-path audit assertions
green.

**W3 — Data-integrity fixes (D-1, D-2).** Repoint the fees export filter to
`structure.termId` with a term column per O-3; add `gradePoint` to the
grade-band write/read contracts and stop the destructive rewrite per O-4.
Expected files: `exports/exports.module.ts`, `exams/exams.service.ts`,
`packages/shared/src/schemas/exams.ts`, `packages/shared/src/types/exams.ts`,
settings/exams UI only if O-4 approves a UI surface. Migration: none
(`gradePoint` column already exists). STOP: filter returns 200 with correct
rows; grade points survive edits and GPA computes when fully configured.

**W4 — Hardening, re-audit, runbook, close-out.** Re-audit the full M23
surface, re-run scope/tenancy/audit/immutability matrices, update OPERATIONS
with audit-coverage and grade-point guidance, update history, close M23.

Each implementation workstream: one commit → push → report → STOP.

## 14. Explicit scope and non-scope

In scope: S-1, S-2, D-1, D-2, their tests, and documentation.
Optionally in scope pending decisions: S-3, S-4, D-3.

Out of scope: reporting/analytics; repeat/rank policy; global search;
notification preferences/digest; leave workflow; server PDF; StoredFile
finance purpose; receipts.csv; mail attachments; Safepay webhook activation;
provider polling; maker-checker implementation; multi-college; i18n; off-host
backups; PITR; external monitoring; durable/distributed metrics or rate
limiting; dependency upgrades; account deletion; CI/lint/web-test
infrastructure; any new permission or role.

## 15. Open decisions

- **O-1 — ASSIGNED semantics for finalized records (blocks W1).** A teacher
  legitimately teaches one section, but a transcript spans every term and
  course. Recommend: report card narrowed by shared ACTIVE enrollment
  (mirroring `exams.service.ts:578-590`), and transcript restricted to
  ALL/OWN/CHILD with ASSIGNED denied. Alternative: apply shared-enrollment
  narrowing to both. Consequence: teachers lose full-transcript access.
- **O-2 — Audit coverage scope (blocks W2).** Recommend mandatory for fee
  structures, exams/papers, academic years/terms, sections, timetable and
  assignments; optional for community mutations and evidence upload.
  Consequence: broader coverage means more audit volume.
- **O-3 — Fees export term filter (blocks W3).** Recommend fix to
  `structure: { termId }` and add a term column so the filter is observable.
  Alternative: remove the parameter. Consequence: CSV header changes.
- **O-4 — Grade-point configuration surface (blocks W3).** Recommend adding
  optional `gradePoint` to the grade-band contracts, preserving it on rewrite,
  and exposing it in the existing admin grade-band UI under the current
  permission. Alternative: contract-only, no UI. Repeat/rank stays deferred.
- **O-5 — S-3 teacher attendance breadth.** Recommend narrowing to shared
  sections; alternative is to document as intended.
- **O-6 — S-4 `dashboard.guardian`.** Recommend leaving the grant untouched
  and documenting it; removing it changes the published matrix.
- **O-7 — D-3 maker-checker.** Recommend keeping deferred (finance governance
  policy), not silently enforcing an actor check.
- **O-8 — Verification infrastructure (C) timing.** Recommend M24; W0 only
  records the gaps.

None of these may be decided unilaterally.

## 16. Dependencies and blockers

All M23 work is internal: no external service, credential, migration or
dependency upgrade is required. Blocking only on O-1 (W1), O-2 (W2), O-3/O-4
(W3). Externally blocked and untouched: Safepay webhook activation, off-host
backup destination, external monitoring. Deployment-blocked: TLS/ingress and
off-host DR.

## 17. Migration strategy

**No migration expected; migrations remain at 15.** `gradePoint` already
exists (`schema.prisma:1077,1019,1060`); audit uses the existing `AuditLog`;
the export fix is a query correction. If any schema need appears, STOP and
report before creating migration #16.

## 18. Testing strategy

Real-PostgreSQL e2e matrices consistent with existing precedent: full
results-read scope matrix including cross-student, cross-college and tampered
`studentId`; per-path audit assertions (exactly-once, correct action, minimal
metadata, no audit on failure); export filter correctness plus tenancy and row
cap; grade-point round-trip proving values survive band edits and that GPA
computes only when every band is configured. Regression: existing 650 tests
must stay green with no weakened assertions.

## 19. Operational strategy

No Compose, backup, health or logging change expected. OPERATIONS gains an
audit-coverage reference and grade-point configuration guidance in W4. Backup
freshness, restore drills and the documented `/health/ops` outage limitation
remain unchanged.

## 20. Security / privacy model

Assets: academic records, financial records, PII, tenant isolation, audit
trail. Trust boundaries per §3. Attacker-controlled inputs: `studentId`,
`termId`, export filters, grade-band payloads. Required controls: PolicyService
remains the only authorization path with no role-name conditionals;
`collegeId` stays server-derived; denials keep existing 403/404 conventions
with no existence leak; audit metadata stays minimal and non-PII with a
server-derived actor; grade-point changes remain admin-gated and audited; no
new public surface.

## 21. M24+ recommendations

M24: Institutional Reporting & Analytics (now unblocked by the W3 export fix
and W1 scope correctness). M25 candidates: verification infrastructure
(CI/lint/unit/web tests), webhook reliability remediation, GPA/repeat/rank
policy after institutional decisions. Later: off-host DR when a destination is
approved, multi-college after per-college secret design, dependency-upgrade
window, then notification preferences, leave workflow, search and server PDF.

## 22. Explicitly NOT implemented in W0

No source, schema, migration, package, UI, Docker or configuration change. No
permission or role added. No deferred item resolved or reprioritized without
evidence. No security defect fixed — S-1, S-2, S-3, S-4, D-1, D-2 and D-3 are
documented only and await W1 authorization. Verification was read-only: HTTP
GETs and read-only SQL; no business or demo data was modified. Safepay webhooks
and all other externally blocked integrations remain untouched. M23-W1 was NOT
started.

## 23. Final disposition register (M23-W4 close-out)

Every finding raised in this document ends in exactly one disposition.
Recorded at close-out; nothing was silently removed or reprioritized.

| Finding | Disposition | Where |
|---|---|---|
| S-1 finalized-results ASSIGNED over-read (HIGH) | **CLOSED** | W1 `9c46336` |
| S-2 unaudited configuration/academic mutations — 8 paths | **CLOSED** | W2 `6c1c3fb` |
| S-2 remainder — community updates, evidence upload | **DEFERRED** | outside approved W2 scope |
| S-3 teacher attendance summary widens past shared section | **DEFERRED** | attendance untouched by M23 |
| S-4 `dashboard.guardian` with no server consumer | **VERIFIED / NO DEFECT** | inert grant, no `RequirePermission` consumer |
| S-5 file signing / grandfathered keys / webhook secret / limits | **DOCUMENTED LIMITATION** | pre-existing |
| D-1 `fees.csv?termId=` 500 | **CLOSED** | W3 `c7839bf` |
| D-2 grade-band `gradePoint` erasure | **CLOSED** | W3 `c7839bf` |
| D-3 refund segregation of duties | **DEFERRED** | maker-checker out of scope |
| D-4 unlocked fee-structure component replacement | **CLOSED** | W3 `c7839bf` |
| Grade-band college-wide delete/recreate without row lock | **DOCUMENTED LIMITATION** | unique constraint fails rather than commits a blend |
| O-A…O-G operational findings | **DEFERRED** | no infra change in M23 |
| O-H no CI, no lint | **DEFERRED** | explicitly outside M23 scope |
| T-1…T-6 test/coverage gaps | **DEFERRED** | M25 verification-infrastructure candidate |

**M23 outcome.** One HIGH authorization defect closed; nine mutation
paths made atomically auditable; three data-integrity defects closed;
78 new real-Postgres tests (650 → 728); **zero migrations** — the schema
stayed at 15 migrations for the entire milestone. No new permission, role,
endpoint, dependency or infrastructure change was introduced.

**M23 CLOSED** at W4. M24 not started.
