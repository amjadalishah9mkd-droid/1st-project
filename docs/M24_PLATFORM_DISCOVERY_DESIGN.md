# M24 Platform Discovery & Design

M24-W0 — discovery, source-traced verification, debt reconciliation and design.
**Discovery only. No source, schema, migration, dependency, Docker,
permission or test change was made. No discovered defect was fixed.**

Starting HEAD: `52e817f` (M23 CLOSED).

---

## 1. Executive summary

M23 closed a HIGH authorization defect and four data-integrity defects, and
its five fixes were re-verified intact and effective at this HEAD. The
platform's *deliberate* security architecture continues to hold up well
under tracing: PolicyService remains the single authorization path with zero
role-name conditionals, tenancy is server-derived, refresh tokens rotate
with family-wide reuse detection, suspension takes effect on the next
request, the OAuth implementation is genuinely strong (PKCE + nonce +
signed one-time state with DB-atomic cross-instance consumption + RS256/`kid`
pinning + email-is-never-identity), and the M18 finalization snapshot model
is sound.

What this discovery found is a different failure class from M23's. M23's
defects were *scope* and *replacement-semantics* errors inside otherwise
guarded code. The dominant M24 finding is **missing or regex-only input
validation on read endpoints**, and the most serious instance of it —
**N-1** — breaks the tenancy invariant at the query level.

`GET /results/analytics` is the only query parameter in the exams controller
not routed through `ZodValidationPipe`. Omitting `examId` entirely produces
`where: { examId: undefined }`, which Prisma drops, and `ExamPaper` carries
no `collegeId` of its own. **Live-proven at this HEAD:** the request returns
**HTTP 200** and every `ExamPaper` row in the database across **both** exams
(4 of 4 rows, `papers_per_exam` = 3,1) while reporting one arbitrary exam's
title. In a multi-college deployment this is a cross-tenant disclosure of
paper ids, course codes, section names, mark counts and per-paper
average/highest/lowest. It is graded HIGH as a *latent tenancy-isolation
defect* rather than an active breach, because the platform is single-college
in practice and the caller must already be an authenticated ADMIN — the two
honest qualifiers are recorded rather than glossed.

Alongside it sits a cluster of the same root cause: a shared `isoDate` regex
that accepts `2024-13-45` and reaches Prisma as `Invalid Date`, producing a
**live-proven 500** on `attendance.csv` and — more interestingly — *bypassing*
the `OUTSIDE_TERM` guard in attendance session generation because every
`NaN` comparison evaluates false.

Two authorization findings are policy drift rather than code error:
`students.csv` now hands the **full student directory including email
addresses** to ACCOUNTANT (live-proven 200) because M16 widened
`users.read` to ALL scope after M12 declared exports "admin-only in v1";
and `FilesController` declares no permission at all, so
`PermissionsGuard`'s `if (!permission) return true` means the M11-W5
verification-lifecycle gate never runs for upload or URL signing.

Because the analytics surface itself is proven broken, the M23-W0
recommendation that M24 be Reporting & Analytics is **superseded**: building
reporting on top of a surface with a demonstrated tenancy bypass would
inherit the defect. The recommendation is **M24 = Input Validation &
Tenancy Hardening**, with reporting deferred to M25.

One documentation defect is also recorded and corrected: M23-W0 stated
"37 permissions / 68 grants"; source and the seeded database both say
**38 / 73**.

---

## 2. Starting baseline (independently re-measured, not inherited)

| Check | Claimed at M23 close | Measured at W0 | Verdict |
|---|---|---|---|
| HEAD | `52e817f` | `52e817f` | match |
| Working tree | clean | clean | match |
| Local == remote | yes | yes | match |
| Tests | 728/728 | **728/728** | match |
| Suites | 55 | **55** | match |
| Typecheck | 0 | **0** | match |
| Migrations | 15, up to date | **15, up to date** | match |
| Prisma schema | valid | **valid** | match |
| Skipped/only/todo tests | none | **none** | match |
| Docker | api/web/postgres/backup healthy | **all healthy** | match |
| health/live, health/ready | 200 | **200 / 200** | match |
| Preview `:8080` | 200 | **200** | match |
| Backup healthcheck | passing | **passing** | match |
| Demo logins | 4 × 200 | **4 × 200** | match |
| Permissions / grants | *37 / 68* (M23-W0) | **38 / 73** (source + DB) | **M23-W0 was wrong — see N-31** |

Scale: 28 controllers, **192 routes**, 62 services, **57 Prisma models**,
42 enums, 38 permissions, 73 grants, 15 migrations, 56 API test files,
47 web pages.

The sandbox database is re-provisioned per session (migrations + seed
timestamps confirm it), so a `User.id` md5 is session-scoped and is **not**
a valid cross-session fingerprint. The stable invariant used here is
`users=20 active=20 students=13 colleges=1 migrations=15` plus the
identity fingerprint over `(email, role, status)`.

---

## 3. M23 verification (re-verified, not trusted)

All five M23 fixes are present and effective at this HEAD.

| M23 finding | Fix site verified | Independent evidence |
|---|---|---|
| **S-1** finalized-results ASSIGNED over-read | `exams/results-finalization.service.ts` — `scope === 'ASSIGNED'` branch present | `m23-w1-results-authz` **18/18**; ASSIGNED narrows via ACTIVE `Enrollment` → own-college `Section` → caller `TeachingAssignment`; denial reuses `notFound('Student')` so no enumeration signal |
| **S-2** unaudited configuration mutations | 9 `logAtomic` call sites across 8 paths + grade bands | `m23-w2-audit-integrity` **35/35**; `AuditLog` still append-only — exactly two `auditLog.create` sites, both inside `AuditService`, zero delete/update/upsert in app source |
| **D-1** `fees.csv?termId=` 500 | `exports.module.ts` — relational `structure: { termId }` | No `Invoice.termId` access anywhere; every export filter re-checked against the schema (§13) — no other phantom-field filter exists |
| **D-2** grade-band `gradePoint` erasure | `exams.service.ts` — `pointsByLabel` preservation | `m23-w3-data-integrity` **25/25**; `gradePoint` still absent from `gradeBandsUpdateSchema` and `GradeBandItem`, so it remains non-client-settable |
| **D-4** fee-structure concurrency | `fees.service.ts` — parameterized `FOR UPDATE` + locked re-read | Row-scoped, taken after the Term `FOR SHARE`, preserving Term-before-row order |

**No M23 defect has reopened.** `permissions.ts` is unchanged since M18
(`c555035`), confirming M23 added no permission or role.

One M23 fix is, however, **narrower than the class of defect it belongs
to**. D-2 corrected `gradePoint` erasure but did not address the fact that
grade bands are resolved *at read time* for live results, so band edits
still retroactively re-grade published exams (**N-11**). This is recorded
as a new finding, not a reopened one.

---

## 4. Architecture snapshot

NestJS API + Next.js web + shared Zod/TypeScript contracts, single
PostgreSQL, Prisma. Single-tenant-per-college with `collegeId` on nearly
every model; multi-college remains unimplemented.

Request path: `JwtAuthGuard` (fresh DB read of `status`/`role` per request,
so suspension is immediate; `mustChangePassword` gate) → `PermissionsGuard`
(`@RequirePermission` metadata → `PolicyService.can`) → controller (Zod
pipe) → service (tenancy predicate → business guard → transaction →
in-transaction audit).

Authorization: `PolicyService` resolves a role's grants from
`RolePermission` (60 s cache) and returns a scope. Scopes implemented:
`ALL`, `OWN`, `ASSIGNED`, `CHILD`, `DEPARTMENT`. **Only four are granted —
`DEPARTMENT` has zero grants (N-28).** Object-level checks are re-invoked
in services with a concrete `sectionId`/`studentProfileId`, because the
guard only forwards params/query literally named `sectionId`/`departmentId`.

Two structural properties matter for M24:

1. **`PermissionsGuard` fails open on missing metadata**
   (`access/permissions.guard.ts:35-37`, `if (!permission) return true`).
   Authentication still applies, but the verification-lifecycle gate lives
   *inside* `PolicyService` and is therefore skipped entirely for any route
   that declares no permission (**N-7**).
2. **Validation is per-route and opt-in.** There is no global
   `ValidationPipe`; each handler must attach `ZodValidationPipe`. A missed
   attachment is silent, and `undefined` predicates are dropped by Prisma
   rather than rejected (**N-1**, **N-5**).

---

## 5. Security findings

### N-1 — HIGH — unvalidated `examId` collapses the analytics tenancy predicate

- **Location:** `apps/api/src/exams/exams.controller.ts:153-160` (route);
  `apps/api/src/exams/exams.service.ts:729-738` (leak);
  `:876-884` (`requireExam`); `prisma/schema.prisma:965-981` (`ExamPaper`
  has no `collegeId`).
- **Root cause:** `@Query('examId') examId: string` carries **no**
  `ZodValidationPipe` — the only such parameter in the controller (contrast
  `/results`, which uses `resultsQuerySchema`). TypeScript's `: string` is
  erased at runtime, so omitting the parameter yields `undefined`. Prisma
  drops `undefined` predicates, so (a) `requireExam` degrades to
  `findFirst({ where: { collegeId } })` and returns an **arbitrary** exam
  instead of 404, and (b) `examPaper.findMany({ where: { examId: undefined } })`
  becomes `where: {}`. `ExamPaper` reaches a college only through `exam`,
  which is absent from the predicate — so the query is unfiltered globally.
- **Evidence (live, read-only, this HEAD):** DB ground truth
  `total_exams=2 total_papers=4 papers_per_exam=3,1`.
  `GET /api/v1/results/analytics` with no `examId` as ADMIN →
  **HTTP 200**, returning **all 4 papers spanning both exams** while
  `title` reports one arbitrary exam. `bandDistribution` aggregates marks
  across all of them. `assertTermOpen` inspects only the arbitrary local
  exam and does not stop it.
- **Exploit condition:** authenticated **ADMIN** (sole `exams.manage`
  holder, `permissions.ts:122`); TEACHER 403, ACCOUNTANT 403, anonymous
  401 — all verified live. `?examId=` and `?examId=nonexistent` correctly
  404; **only total omission** triggers it.
- **Impact:** in a multi-college deployment, cross-tenant disclosure of
  paper ids, course codes, section names, max marks, mark counts and
  per-paper average/highest/lowest, plus a cross-tenant grade
  distribution.
- **Honest qualifiers:** the deployment is single-college today, so there
  is **no active cross-tenant breach**; and an admin already sees their own
  college's data. The defect is that the tenancy invariant is broken *at
  the query level*, so isolation depends on a deployment fact rather than
  on code.
- **Related:** `?examId[]=a&examId[]=b` → **500** (live-proven) — array
  injection reaching Prisma.
- **Disposition:** NEW DEFECT — implementation required (**M24-W1, first
  item**).

> **RESOLVED in M24-W1.** Decision O-1 was implemented as **both**
> layers. (1) `examAnalyticsQuerySchema` makes `examId` a required
> non-empty string, attached with `ZodValidationPipe`, so the service can
> no longer be reached without an identifier and an array-valued
> parameter is a 400 rather than a Prisma 500. (2) Defence in depth: the
> `examPaper.findMany` predicate is now
> `{ examId, exam: { collegeId: user.collegeId } }`, so even a widened
> identifier cannot return another college's papers. Live: omitted → 400
> `VALIDATION_ERROR` (was 200 with every paper in every college), array →
> 400 (was 500), valid → 200 unchanged. Cross-tenant proven with a real
> second college carrying its own exam, paper and mark.

### N-5 — MEDIUM — regex-only date validation reaches Prisma as `Invalid Date`

- **Location:** `packages/shared/src/schemas/academics.ts:4-6` and
  `schemas/timetable.ts:7-9` (`isoDate = /^\d{4}-\d{2}-\d{2}$/`);
  sinks at `attendance/attendance.service.ts:94, 169-176`,
  `exports/exports.module.ts:143-150`;
  `common/filters/global-exception.filter.ts:52-69` (only P2002/P2003/P2025
  mapped).
- **Root cause:** the regex is syntactic only. `2024-13-45` passes, becomes
  `Invalid Date`, and Prisma raises `PrismaClientValidationError`, which the
  filter maps to a generic 500.
- **Evidence (live):** `GET /exports/attendance.csv?from=2024-13-45` →
  **500 `INTERNAL_ERROR`**.
- **Secondary, more serious:** in `attendance.generateSessions`,
  `mondayOf(Invalid Date)` yields `NaN`, so **both** `OUTSIDE_TERM`
  comparisons evaluate false and the guard is *bypassed* before the
  `createMany` fails.
- **Disposition:** NEW DEFECT — implementation required (W1).

> **RESOLVED in M24-W1.** `isoDate` now adds a calendar **round-trip**
> check to the existing regex in all four shared schema files, and the
> export filters use the same rule. A bare `Date.parse` refine would have
> been insufficient: `Date.parse('2024-02-30')` silently returns March 1.
> The round-trip rejects `2024-13-45`, `2024-02-30`, `2024-04-31` and
> `2023-02-29` while accepting real dates including the `2024-02-29` leap
> day. Live: `attendance.csv?from=2024-13-45` → 400 (was 500).
> A `PrismaClientValidationError` → 400 backstop was also added to the
> exception filter, kept diagnosable via an explicit operational log
> record with a generic client message.
>
> *Honest note:* the `OUTSIDE_TERM` NaN bypass is confirmed at code level
> but could **not** be reproduced as an observable failure in the seeded
> fixture, because the section had no timetable slots so the failing write
> was never reached. The regression test pins the corrected 400 behaviour
> either way.

### N-7 — MEDIUM — `FilesController` declares no permission, bypassing the verification-lifecycle gate

- **Location:** `apps/api/src/files/files.controller.ts:56, 92` (no
  `@RequirePermission` — verified); `access/permissions.guard.ts:35-37`;
  `access/policy.service.ts:99-107` (`lifecycleAllows`).
- **Root cause:** the M11-W5 gate confining `UNVERIFIED/PENDING/REJECTED`
  accounts to `verification.submit` lives inside `PolicyService`, which is
  only consulted when a route declares a permission. Files declares none,
  so the guard returns `true` and the gate is skipped.
- **Reachability:** a self-registered Google student is created
  `UNVERIFIED` + `ACTIVE` with an immediate session
  (`google-auth.service.ts:497-517`); `JwtAuthGuard` admits them. They can
  upload (10 MB × 60/hour ≈ 600 MB/hour/account, no orphan reaper — N-22)
  and can call `POST /files/sign` for any key they know.
- **Bounded by:** downloads are served `application/octet-stream` +
  `Content-Disposition: attachment`, so no stored XSS.
- **Disposition:** NEW DEFECT — implementation required (W2).

### N-8 — MEDIUM — stored-file signing is college-wide; `purpose` unused; revocation gap

- **Location:** `apps/api/src/files/stored-file-authz.service.ts:50-63`.
- **Root cause:** the only authorization dimension is `collegeId` equality.
  `StoredFile.purpose` (`SUBMISSION`, `EVIDENCE`, `COMMUNITY_ATTACHMENT`)
  is persisted but **never read**, and there is no link back to the
  section/assignment that made a file shareable. `SUBMISSION` — another
  student's graded homework — is treated identically to shared content.
- **Realistic exploit is revocation persistence, not peer IDOR:** keys are
  128-bit random, and peers cannot learn a submission key. But a teacher who
  legitimately saw `submission.fileUrl` while assigned retains the ability
  to sign that key **forever** after their `TeachingAssignment` is removed,
  because signing never re-evaluates section membership.
- **Disposition:** NEW DEFECT — implementation required (W2).

### N-9 — MEDIUM — submission/resource `fileUrl` is unvalidated and unowned

- **Location:** `packages/shared/src/schemas/assignments.ts:31, 58`,
  `schemas/community.ts:103` (bare `z.string().max(500)`); sinks
  `assignments/assignments.service.ts:553, 562`,
  `community/community.services.ts:591`.
- **Root cause:** no format requirement, no `StoredFile` lookup, no
  ownership or tenancy binding — inconsistent with the *correct* pattern
  used for evidence (`verification.service.ts:131-137` binds
  `key + uploaderId + collegeId`) and with `signFileUrlSchema`'s strict
  regex.
- **Impact:** a student can submit a reference to a key they do not own, or
  an external URL. **No open redirect or XSS** — the web client passes
  `fileUrl` to `POST /files/sign`, which rejects anything not matching the
  internal prefix. Cross-class escalation is blocked by
  `EvidenceAuthzService`. Net impact is submission-record integrity.
- **Disposition:** NEW DEFECT (integrity) — implementation required (W2).

### N-10 — MEDIUM — login resolves accounts with a globally unscoped `findFirst`

- **Location:** `apps/api/src/auth/auth.service.ts:51-57`;
  `prisma/schema.prisma:410` (`@@unique([collegeId, email])`);
  `auth/login-rate-limiter.service.ts:192, 208`.
- **Root cause:** email is unique **per college**, but login queries by
  email alone via `findFirst` with **no `orderBy`**, so with duplicates
  PostgreSQL returns a plan-dependent row. The rate-limit bucket key
  `acct:${email}` is likewise globally unscoped.
- **Not an authentication bypass:** the password must still match the
  selected row.
- **Impact:** (a) cross-tenant **denial of login** — if college B allows
  self-registration, an attacker can create a password-less row with a
  college-A victim's email and, when `findFirst` returns it, the victim's
  password login fails permanently; (b) five failed attempts lock that
  email in **every** college simultaneously.
- **Cannot determine without a runtime multi-college test:** which row
  `findFirst` actually returns. The missing tenant scope and missing
  determinism are unambiguous in code.
- **Disposition:** NEW DEFECT — implementation required (W2).

### N-25 — LOW — `decodeURIComponent` on validated-but-insufficient input

`files/files.controller.ts:106`; `signFileUrlSchema` admits a lone `%`, so
`decodeURIComponent('%zz')` throws `URIError` (not an `HttpException`) → 500
instead of 400. Robustness, not a boundary failure. NEW DEFECT (W1 with the
validation sweep).

> **RESOLVED in M24-W1.** The decode is wrapped and a failure reuses the
> established `INVALID_FILE_URL` rejection, so a malformed escape is
> indistinguishable from any other rejected key. Live: `%zz`, `%` and
> `abc%` all → 400 (was 500).

### Verified SAFE — recorded so the negative results are on record

Path traversal on download and delete (triple-defended: HMAC before any
filesystem touch, separator rejection, `normalize().startsWith(root)`);
unsigned/forged download (`timingSafeEqual`, `exp` inside the MAC);
`Content-Disposition` injection; upload key unguessability (128-bit);
evidence access control, magic-byte MIME sniffing, and retention/purge
ordering; finance-document tenancy and reference masking (and
`FinanceDocument` has **no** file column at all, so there is no
finance-file surface); refresh-token rotation with family-wide reuse
detection; suspension effective on the next request (`jwt-auth.guard.ts:76`
plus in-transaction family revocation); logout revoking the whole family;
credential-token one-time atomic claim and generic `INVALID_TOKEN`;
OAuth state/PKCE/nonce/RS256-`kid` pinning and email-is-never-identity;
cookie flags and path scoping; JWT payload minimization; login
rate-limiting mechanism (case/whitespace and `X-Forwarded-For` bypasses
both closed); argon2id hashing; account-lifecycle advisory lock + CAS +
in-transaction audit; exam `status` cannot be forced to `PUBLISHED` via
PATCH; marks lock; the whole finalization/amend/void model; ASSIGNED
enforcement across attendance/assignments/exams/marks (no gap found);
export `assertAllScope` refusing OWN/ASSIGNED/CHILD; unknown/foreign export
identifiers yielding header-only CSVs with no oracle; CSV row cap and 413
mapping; health endpoint semantics; request-correlation logging being
structurally incapable of logging bodies/headers/URLs; counter cardinality;
restore-verify and uploads-restore-verify scripts (including the subshell
guard, which is safe because the subshell's status becomes the pipeline's
and `set -e` aborts before extraction).

---

## 6. Authorization findings

- **N-6 — MEDIUM — `students.csv` PII scope creep.** `exports.module.ts:24-30`
  declares "admin-only in v1", but the gate is
  `assertAllScope(user, 'users.read')` (`:99`) and M16 granted ACCOUNTANT
  `users.read` at **ALL** scope (`permissions.ts:181`). **Live-proven:**
  accountant → `GET /exports/students.csv` → **200**, returning
  `firstName,lastName,email,admissionNo,rollNo,department,batch,status` for
  every student. The module's own PII reasoning ("no student PII beyond the
  existing finance-export policy") is stated for `refunds.csv` and silently
  violated here. Root cause is a permission whose scope semantics widened in
  a later milestone with no re-review of the export decision.
  **NEW DEFECT** — W1 (decision O-3 first).
- **N-28 — INFO — `DEPARTMENT` scope is a dead authorization path.**
  `policy.service.ts` implements `checkDepartment`, but **zero grants** use
  `DEPARTMENT` (verified against source and the seeded `RolePermission`
  table). Same class as S-4's inert grant: unreachable code in the single
  authorization path. **VERIFIED / NO DEFECT** (not exploitable) —
  documented for tidy-up.
- **`PermissionsGuard` param-name coupling — VERIFIED / NO DEFECT.** The
  guard forwards only params/query literally named
  `sectionId`/`departmentId`, so routes using `:id` for a section reach
  `policy.can` with `sectionId: undefined` → list-level grant. Every such
  route was traced: all are either ALL-scope-only permissions or re-checked
  in the service. Fragile convention, currently sound.
- **S-1 re-verified CLOSED** (§3).

---

## 7. Tenancy findings

- **N-1 (HIGH)** is the tenancy finding of this milestone: a model without
  its own `collegeId` (`ExamPaper`) queried without its parent predicate.
- **Systemic observation, no defect proven:** several models reach a
  college only through a parent (`ExamPaper`→`Exam`, `FeeComponent`→
  `FeeStructure`, `Submission`→`Assignment`→`Section`, `TimetableSlot`→
  `Section`, `Mark`→`ExamPaper`). Every *other* traced query on these models
  carries the parent predicate; N-1 is the single miss found. This is a
  structural fragility worth a systematic sweep in W1, not a second defect.
- **N-10** is a tenancy defect on the authentication path.
- Cross-college denial re-verified on results, exports and fee structures;
  all return an indistinguishable 404 with no existence disclosure.

---

## 8. Audit findings

M23-W2/W3 audit integrity **re-verified intact**: 9 atomic events,
server-derived actor/tenant/target, allowlisted metadata, exactly-once
under concurrency, zero residue on denial, rollback on audit failure,
append-only (two `create` sites, both in `AuditService`; no
delete/update/upsert in app source).

New audit-coverage gaps:

- **N-23 — LOW —** `verification.evidence_accessed` is written **before**
  the second authorization gate runs
  (`files/evidence-authz.service.ts:49-57` then
  `files.controller.ts:122-126`), so a request ultimately rejected at
  `:125` still produces a successful-access record — a false positive in
  the trail. `GET /files/:key` is **never** audited, so a 5-minute signed
  URL can be replayed an unbounded number of times with one recorded
  "access". Non-evidence signings are not audited at all. NEW DEFECT (W2).
- **N-30 — INFO —** `logExport` runs only on the success path, so a
  rejected 50 001-row extraction attempt leaves **no** audit row; a bulk
  extraction attempt is invisible. DEFERRED.
- **S-2 remainder still valid:** community `update` methods
  (`posts.service.ts:265`, `groups.service.ts:157`,
  `community.services.ts:180, 450`) and evidence upload remain unaudited;
  the existing audit calls in those files are the `*_created` events.
  **DEFERRED** (unchanged classification).
- **N-12(4) — LOW —** scheduled/background paths bypass the bounded
  operational logger: `notification-scheduler.service.ts:32` does
  `logger.error('Daily sweep failed', String(error))`, and `String(prismaError)`
  can carry SQL fragments and argument values. The "no sensitive data
  logged" guarantee holds for the **request** path only. NEW DEFECT (W3).

---

## 9. Financial / data-integrity findings

- **D-4 re-verified CLOSED** — row lock + locked re-read intact.
- **N-4 — MEDIUM — enrollment capacity TOCTOU.**
  `academics/sections.service.ts:355-412`: the ACTIVE count read (`:363`),
  the comparison (`:396`) and the `enrollment.create` (`:409`) are three
  statements with **no transaction, no `FOR UPDATE` on `Section`, and no
  advisory lock**. The schema offers no check or exclusion constraint;
  `@@unique([studentId, sectionId])` prevents duplicates, not
  over-capacity. N concurrent enrolls on one free seat all succeed. The
  inverse also holds in `update()`: `CAPACITY_BELOW_ENROLLMENT` can be
  bypassed by a concurrent enroll. **This is the same defect class as D-4**
  (unlocked read-modify-write on an aggregate), in a different module —
  D-4's fix was correctly scoped to fees and did not generalize.
  NEW DEFECT (W3).
- **N-11 — MEDIUM — grade bands retroactively re-grade published results;
  gaps unvalidated.** `exams/exams.service.ts:800-872` deletes and recreates
  all bands with **no term guard and no published-results guard**, and grade
  labels are resolved at *read* time for live results (`:669-678` `bandFor`)
  and analytics (`:750-755`). Editing bands therefore silently changes the
  letter grade shown for already-PUBLISHED, marks-locked exams **including
  in CLOSED terms** — the one data class M17/M18 declare read-only.
  (Finalized `TermResult`/`CourseResult` snapshots are correctly immune —
  `results-finalization.service.ts:565-603` freezes label and point.)
  Separately, validation rejects overlaps but **permits gaps**, and
  `bandFor` returns `null` for an uncovered percentage, so results can
  silently lose their grade label; there is no 0–100 coverage assertion.
  NEW DEFECT (W3). *This is adjacent to, but distinct from, M23's D-2.*
- **N-2 — MEDIUM — rollover mutates a CLOSED source term.**
  `academics/rollover.service.ts:592-599` performs
  `enrollment.updateMany({ ACTIVE → COMPLETED })` on **source-term** rows,
  while `execute()` guards only the destination (`:436`). This contradicts
  the file's own stated invariants (`:22-23` "source sections and all
  historical data stay untouched"; `:84-85` "a CLOSED SOURCE remains valid
  — reads only"), and `sections.enroll/unenroll` refuse exactly this write
  on a closed term. Reachable: close term A → rollover A→B → execute.
  Secondary: the `updateMany` sits outside the `SKIP` filter used in pass 1
  (`:466`), so source enrollments are concluded even for sections the
  operator marked SKIP. Untested — both rollover suites use empty terms.
  NEW DEFECT (W3).
- **N-3 — MEDIUM — `assertTermOpen`'s `FOR SHARE` is void at 25 of 33 call
  sites.** `academics/term-lifecycle.service.ts:53-73` documents that the
  guard runs "inside the caller's transaction where one exists, taking FOR
  SHARE … so writes serialize against a concurrent close". 25 call sites
  pass `this.prisma` rather than a transaction client, so the `$queryRaw`
  commits immediately and **releases the row lock before the caller's
  write**. The guard degrades to an unsynchronized preflight. Only
  `attendance.generateSessions`, `rollover.execute` and the fees paths take
  the documented form — precisely the paths the two existing race tests
  cover. A mark, attendance record, assignment, submission, grade, timetable
  slot, enrollment or teaching assignment can therefore be written into an
  already-CLOSED term. NEW DEFECT (W3).
- **N-13 — MEDIUM — term guard misapplied to a read.**
  `exams/exams.service.ts:731` calls `assertTermOpen` in `analytics()`,
  which throws `409 TERM_CLOSED` ("records are read-only") on a pure read.
  Every other read path is deliberately unguarded. Since the sanctioned
  lifecycle is publish → close → finalize, exam analytics becomes
  permanently unreachable exactly when it is most useful. NEW DEFECT (W1,
  alongside N-1 in the same method).
  **RESOLVED in M24-W1:** the guard was removed from the read path only.
  CLOSED-term *write* enforcement is unchanged and pinned by a test
  asserting a PATCH to an exam in a closed term is still refused and the
  row is unmodified.
- **N-14 — LOW —** published assignment `dueAt` is mutable with no
  `publishedAt` guard (contrast `exams.update`), and `Submission.isLate` is
  computed once at submit (`assignments.service.ts:526`) and never
  recomputed, so moving `dueAt` leaves submissions permanently
  mis-flagged. NEW DEFECT (W3).
- **N-15 — LOW —** rollover executes a **stale plan**: the plan is read at
  `:418` *before* the `FOR UPDATE` at `:438`, and `updatePlan` CAS-writes
  without that lock, so v1 can be applied while `preview()` renders v2.
  `execute` also never re-runs `validatePlanShape` or re-checks
  `TARGET_TERM_NOT_EMPTY`. NEW DEFECT (W3).
- **N-17 — LOW —** `attendance.updateSession` accepts `CANCELLED` with no
  check on recorded records, so a session with a full sheet can be
  cancelled; every summary and the finalization attendance percentage
  filter `status: 'HELD'` and silently drop those records (orphaned, not
  deleted). NEW DEFECT (W3).
- **N-18 — LOW —** the finalization worklist filters
  `enrollments: { some: { section: { termId } } }` with **no status
  filter** (`results-finalization.service.ts:421`), while every other
  cross-module enrollment predicate pins `ACTIVE`, so DROPPED/COMPLETED
  students appear on the finalize worklist. Harmless to `finalize` itself.
  NEW DEFECT (W3).
- **Money representation — VERIFIED / NO DEFECT.** All money columns are
  `Decimal`; no float arithmetic; `netPaid` remains the single reducer;
  invoice amounts remain snapshots (re-verified: structure totals changed
  repeatedly in M23 testing without repricing issued invoices).
- **`void()` un-tenanted CAS — VERIFIED / NO DEFECT.**
  `results-finalization.service.ts:218-221` omits `collegeId`, but
  `existing` was already resolved with it and 404'd otherwise. Defence-in-
  depth gap only.

---

## 10. File / evidence findings

N-7, N-8, N-9, N-23, N-25 above, plus:

- **N-22 — LOW — no orphan reaper for non-evidence stored files.**
  The only sweep is `verification/evidence-retention.service.ts:662-722`,
  which iterates `evidenceFile` alone; `LocalStorageAdapter.delete` is
  called from that one place. Resubmission overwrites `fileUrl`
  (`assignments.service.ts:553`) with no delete of the superseded key.
  Uploads never attached to a domain row live on disk and in `StoredFile`
  indefinitely and stay signable college-wide forever. NEW DEFECT (W2).
- **Un-backfilled `Resource.fileUrl` (inside S-5's grandfathering).**
  Migration `20260828055018_m19_stored_file_authorization` backfills
  `Post.attachments`, `Assignment.attachments`, `Submission.fileUrl` and
  `EvidenceFile` — but **not** community `Resource.fileUrl`. Those legacy
  keys have no `StoredFile` row, and both authz gates fail **open** for
  unknown keys (`stored-file-authz.service.ts:55`,
  `evidence-authz.service.ts:34`), so they are signable **cross-tenant** by
  anyone who learns a 128-bit key. The grandfathering itself is documented;
  this specific omission is not. **NEW DEFECT (LOW, W2)** — reclassified
  out of S-5.
- **S-5 otherwise — DOCUMENTED LIMITATION** (unchanged): signed-URL replay
  within its 5-minute TTL, and no `FILE_URL_SECRET` `kid`/rotation staging
  (acceptable given the short TTL, but rotation cannot be staged).

---

## 11. Authentication / session findings

N-10 above, plus:

- **N-24 — LOW —** Google unlink deletes the `AuthIdentity`
  (`google-auth.service.ts:709-717`) but revokes **no** refresh tokens, so
  sessions established via the removed identity stay valid for the full
  7-day window. Compare `UserLifecycleService`, which revokes
  in-transaction. Matters in the "revoke a compromised Google account"
  scenario. NEW DEFECT (W2).
- **N-29 — INFO —** `JWT_REFRESH_SECRET` is **mandatory in production**
  (`config/env.ts:71`) but never used anywhere — refresh tokens are opaque
  random values. Dead required config; misleading. VERIFIED / NO DEFECT.
- **DOCUMENTED LIMITATIONS (unchanged, correctly reasoned in code):**
  access tokens survive logout/password change for ≤15 min (mitigated by
  per-request DB reads of `status`/`role`); `changePassword` preserves the
  caller's own family by design; login timing side channel (`argon2.verify`
  runs only when a user exists, no dummy hash); invite token in a query
  string (correctly kept out of the Google round-trip via the signed state
  cookie); in-memory per-process rate limiting.
- **Explicitly re-verified NO DEFECT:** suspended/archived users do **not**
  retain access until token expiry.

---

## 12. Academic lifecycle findings

N-2, N-3, N-4, N-11, N-13, N-14, N-15, N-17, N-18 above, plus:

- **N-16 — LOW — timetable conflict detection.** `timetable.service.ts:346-388`
  documents exactly two checks (slot + room), so the absence of **teacher**
  and **student** conflict detection is a DOCUMENTED LIMITATION (though
  `slotInclude` already loads `teachingAssignments`, and no check exists at
  `sections.enroll` either). Two genuine defects: (a) the room check
  requires `check.room && slot.room` — both explicit — while room
  *resolution* elsewhere falls back to the section
  (`attendance.service.ts:48` `slot.room ?? section.room`), so two sections
  sharing `section.room` with no slot room are double-booked silently;
  (b) `assertNoConflicts` → `create` is non-transactional, so two
  concurrent creates can both pass. Room conflict is also scoped to a single
  term while terms may overlap. NEW DEFECT (a) (W3); (b) LOW.
- **Verified NO DEFECT:** term ACTIVE⇄CLOSED transitions (tenancy 404 →
  server-authoritative typed confirmation → `FOR UPDATE` → authoritative
  re-read → `isCurrent` check → `updateMany` CAS → in-transaction audit);
  `setCurrentTerm`; the deliberately inverse `TERM_NOT_CLOSED` guard on
  finalize/amend/void; marks lock and `maxMarks` regression refusal;
  enrollment reactivation instead of duplication; refusal to delete an
  assignment with submissions or a slot with sessions; late-submission
  handling; grading confined to assigned sections via a server-derived
  `sectionId`.

---

## 13. Export / reporting findings

Five endpoints, none carrying `@RequirePermission`; all authorize in-service
via `assertAllScope`, which refuses OWN/ASSIGNED/CHILD and enforces
`status === 'ACTIVE'` plus the verification gate.

| Endpoint | Permission | Passes at ALL | Tenancy | Filters |
|---|---|---|---|---|
| `students.csv` | `users.read` | ADMIN, **ACCOUNTANT** | `studentProfile.collegeId` | `departmentId`, `batch` |
| `attendance.csv` | `attendance.read` | ADMIN | `session.section.collegeId` | `sectionId`, `from`, `to` |
| `fees.csv` | `fees.read` | ADMIN, ACCOUNTANT | `invoice.collegeId` | `status`, `termId` (relational) |
| `results.csv` | `results.read` | ADMIN | `examPaper.exam.collegeId` | `examId` (required) |
| `refunds.csv` | `fees.manage` | ADMIN, ACCOUNTANT | `refundAttempt.collegeId` | `status`, `method` |

- **N-6 (MEDIUM)** — see §6.
- **N-5 (MEDIUM)** — `attendance.csv` is the one export filter that 500s.
- **D-1-class re-audit — NO DEFECT.** Every filter was re-checked against
  the schema: no filter references a phantom field and none silently fails
  to apply. `fees.csv termId` is correctly relational.
- **N-27 — LOW — `results.csv` has no `PUBLISHED` filter**
  (`exports.module.ts:252-257`), while `GET /results` explicitly pins
  published exams. **Live check inconclusive on impact:** the DRAFT exam in
  seed data has 0 marks, so the export returned a header only. The code
  divergence is real; the leak is currently unobservable. Recorded honestly
  as a latent divergence. DEFERRED.
- **N-26 — LOW — `common/csv.ts:16-25`.** The formula-injection guard
  prefixes `^[=+\-@]`, which also captures legitimate **negative numbers**,
  so a negative `netPaid` is emitted as `'-5.00` and parses as text in every
  spreadsheet. Leading TAB is neither prefixed nor quoted. NEW DEFECT (LOW).
- **N-30 (INFO)** — failed/too-large exports unaudited (§8).
- **Verified NO DEFECT:** row cap → 413, `Content-Disposition` filenames are
  hardcoded literals, unknown/foreign identifiers yield header-only CSVs
  with no oracle, attacker-controlled strings reaching cells are correctly
  prefixed.

---

## 14. Operational findings

- **N-20 — LOW —** malformed `BACKUP_MAX_AGE_SECONDS` silently disables
  staleness detection. `health/health.controller.ts:123-125, 171-174`:
  `Number('abc')` → `NaN`, and `latestAgeSeconds > NaN` is always false, so
  an arbitrarily stale backup reports `stale: false` and `/health/ops`
  reports `ok`. `scripts/backup/backup-healthcheck.sh:12` validates the same
  variable strictly and fails closed — **the two components disagree on
  malformed input**. NEW DEFECT. *Operationally misleading today → recorded
  in `OPERATIONS.md` §28.*
- **N-19 — LOW/MEDIUM — `apps/api/Dockerfile`.** (a) `mkdir -p /data/uploads
  && chown node:node` runs in the **discarded build stage** (`:6-10`) and is
  never repeated in the runtime stage, so the image works under Compose only
  because a separate `uploads-init` service chowns the volume; a plain
  `docker run` leaves uploads unwritable (and `/health/ops` correctly
  reports `uploadsWritable: false`). (b) `node_modules` is copied wholesale
  from an `npm ci` that installed devDependencies — no `--omit=dev`/prune —
  so `@nestjs/cli`, `jest`, `ts-jest`, `tsx`, `supertest` ship to
  production. Note the CMD's `npx prisma migrate deploy` **requires** the
  `prisma` CLI, so this is not a one-line fix. NEW DEFECT (W3/W4).
- **N-21 — LOW —** log suppression covers only the exact path
  `/api/v1/health` (`request-context.ts:69`), so `/health/live` and
  `/health/ready` — the semantically correct probe targets M22 introduced —
  emit one log line per probe interval, unbounded. NEW DEFECT.
- **N-12 — MEDIUM — notification scheduler.**
  (1) `sweepOverdueInvoices` (`:103-106`) selects **every** `OVERDUE`
  invoice in the deployment forever with no `take`, no date window and no
  tenant partition, then issues one dedup query **per invoice**; cost grows
  monotonically while producing no new notifications. Same shape in the
  assignment and event sweeps. (2) `@Cron` fires in **every** replica with a
  read-then-emit dedup race and no distributed lock — bounded today only
  because both compose files run one API instance; it blocks horizontal
  scaling. (3) `:96-102` flips invoice status to `OVERDUE` irrespective of
  the owning term's lifecycle state, while every operator-driven invoice
  mutation is `assertTermOpen`-guarded — an unacknowledged asymmetry in the
  CLOSED-term model. (4) unbounded logger (§8). NEW DEFECT (W3).
- **O-C confirmed still valid — MEDIUM.** `scripts/backup/backup-cycle.sh:33-35`
  prunes purely by age with **no keep-N floor**, and `RETENTION_DAYS=0` is
  accepted by the validator. Rotation runs only after a fresh verified pair
  exists, so ≥1 pair always survives; the exposure is that a structurally
  valid but logically corrupt dump (`pg_restore --list` reads only the TOC)
  can flush the entire history down to that one copy. DEFERRED.
- **Verified NO DEFECT:** health/live vs /ready vs /ops semantics
  (readiness correctly 503s when the DB is down; `/health/ops` is the only
  non-public route, gated by `settings.manage`, and returns ages/counts/
  booleans only — no DSNs, paths or credentials); request correlation
  (`x-request-id` validated then replaced, never an authorization input,
  echoed on errors, `AsyncLocalStorage`-isolated); the fixed-schema logger
  being structurally unable to log bodies/headers/URLs/stacks; counter
  cardinality; `.dockerignore` coverage (no secrets in context; `.alloy/`
  and `docs/` are bloat only); `${VAR:?}` fail-closed secrets in prod
  compose; least-privilege volumes (uploads read-only into backup, backups
  read-only into API); log rotation capped on every service; demo seeding
  double-blocked in production; `restore-verify.sh` and
  `uploads-restore-verify.sh` (both safe, including the subshell guard).
- **DOCUMENTED LIMITATIONS (unchanged):** secrets as env vars rather than
  Docker secrets; off-host backups and PITR absent and explicitly declared;
  restore drills manual-only (nothing ever exercises them automatically).

---

## 15. Testing / engineering debt

- **O-H confirmed, and it is the platform's largest engineering risk —
  HIGH.** Independently verified: **`.github/` does not exist** (no CI of
  any kind, so 56 suites, `typecheck` and the restore drills never run
  automatically); **no lint configuration anywhere** (no `.eslintrc*`, no
  `eslint.config.*`, and neither `eslint` nor `@typescript-eslint/*` nor
  `prettier` in any workspace `package.json`); **`apps/web` has no test
  harness** (scripts are `dev`/`build`/`start`/`typecheck` only), leaving
  `apps/web/middleware.ts` — which performs route-permission redirects —
  entirely untested; no root `test` script; `jest.config.js` sets no
  coverage collection or thresholds, so coverage is never measured.
  `turbo.json` exists but `turbo` is not a dependency (dead config).
  **DEFERRED, but promoted to the top competing M24/M25 candidate.**
- **N-32 — MEDIUM — no owning suite for `src/access`.** PolicyService and
  PermissionsGuard — the single authorization path for all 192 routes — have
  **no dedicated suite**. They are exercised only incidentally through
  per-feature 403 assertions. Nothing systematically asserts the
  ALL/OWN/ASSIGNED/CHILD/DEPARTMENT matrix or the 60 s `grantCache`
  invalidation. N-1 and N-6 are exactly the kind of defect such a suite
  would catch. NEW DEFECT (test debt).
- **T-1/T-2/T-3 partially SUPERSEDED — the earlier "no coverage" claims were
  wrong.** The notification scheduler **is** tested (all three sweeps
  including idempotency) — but from `test/moderation.e2e-spec.ts:440-521`,
  a misplaced owner. `POST /students/import` **is** exercised
  (`academics`, `mail`, `onboarding` suites). The `users` module **is**
  covered (`identity-foundation`, `account-lifecycle`, `credential-tokens`,
  `guardian-*`). These are **ownership** debt, not coverage holes.
  Reclassified.
- **Also without an owning suite:** `announcements`, `events`, `config`
  (the fail-fast boot gate), `common` (csv/pagination/rate-limiter/
  envelope/exception filter). DEFERRED.
- **T-4/T-5/T-6 — DEFERRED** (unchanged): `refunds.csv` content untested,
  thin dashboard/settings coverage, essentially no unit layer.
- **No race test** exists for marks, assignments, timetable, enrollment or
  teaching assignments — precisely the 25 call sites N-3 leaves
  unsynchronized, and the capacity path of N-4.

---

## 16. Re-verification of previously deferred findings

| Item | M23 disposition | M24-W0 verdict |
|---|---|---|
| S-1 | CLOSED | **CLOSED** — re-verified (§3) |
| S-2 (8 paths) | CLOSED | **CLOSED** — re-verified |
| S-2 remainder (community updates, evidence upload) | DEFERRED | **DEFERRED** — still unaudited, confirmed |
| S-3 teacher attendance summary widening | DEFERRED | **DEFERRED** — attendance untouched since |
| S-4 `dashboard.guardian` inert grant | VERIFIED / NO DEFECT | **VERIFIED / NO DEFECT** — still no consumer; now joined by N-28 (`DEPARTMENT`) |
| S-5 (file signing, grandfathered keys, webhook secret, no dual-key, per-instance limits) | DOCUMENTED LIMITATION | **PARTIALLY SUPERSEDED** — the un-backfilled `Resource.fileUrl` is a NEW DEFECT (§10); the rest remains a DOCUMENTED LIMITATION; the college-wide-signing part is superseded by N-8 |
| D-1 | CLOSED | **CLOSED** — re-verified, no other phantom-field filter exists |
| D-2 | CLOSED | **CLOSED** — but see N-11 for the adjacent retroactive-regrade gap |
| D-3 refund maker-checker | DEFERRED | **DEFERRED** |
| D-4 | CLOSED | **CLOSED** — re-verified |
| Grade-band college-wide delete/recreate, no row lock | DOCUMENTED LIMITATION | **SUPERSEDED by N-11** — the concurrency concern stands, but the retroactive-regrade and gap-validation defects are more serious than the locking question |
| O-A off-host backup / PITR | DEFERRED | **DEFERRED** — still absent, explicitly declared |
| O-B sequential DB/uploads pairing | DEFERRED | **DEFERRED** |
| O-C retention, no keep-N floor | DEFERRED | **DEFERRED** — confirmed; `RETENTION_DAYS=0` accepted |
| O-D `.backup-health` timestamp only | DEFERRED | **DEFERRED** — and now joined by N-20 |
| O-E uploads-verify subshell | DEFERRED | **VERIFIED / NO DEFECT** — re-traced; the subshell status becomes the pipeline status and `set -e` aborts before extraction |
| O-F `/health/ops` needs the DB to authenticate | DEFERRED | **DEFERRED** |
| O-G single-trusted-proxy assumption | DEFERRED | **DEFERRED** — `trust proxy = 1` confirmed |
| O-H no CI, no lint | DEFERRED | **DEFERRED** — confirmed; promoted to HIGH |
| T-1 scheduler untested | DEFERRED | **SUPERSEDED** — it *is* tested, from a misplaced owner |
| T-2 students import untested | DEFERRED | **SUPERSEDED** — it *is* exercised |
| T-3 no users suite | DEFERRED | **SUPERSEDED** — covered across four suites |
| T-4 `refunds.csv` content | DEFERRED | **DEFERRED** |
| T-5 thin dashboards/settings | DEFERRED | **DEFERRED** |
| T-6 no unit layer / no web harness | DEFERRED | **DEFERRED** |
| Reporting / analytics (M24 candidate) | DEFERRED | **SUPERSEDED as the M24 recommendation** — N-1 proves the analytics surface must be hardened first; moves to M25 |
| Global search | DEFERRED | **DEFERRED** |
| Notification preferences / digest | DEFERRED | **DEFERRED** |
| Leave workflow | DEFERRED | **DEFERRED** |
| Server-side PDF | DEFERRED | **DEFERRED** |
| StoredFile FINANCE_DOCUMENT | DEFERRED | **VERIFIED / NO DEFECT (not applicable)** — `FinanceDocument` has no file column; there is no finance-file surface |
| `receipts.csv` | DEFERRED | **DEFERRED** |
| Mail attachments | DEFERRED | **DEFERRED** |
| Safepay webhook activation | EXTERNALLY BLOCKED | **EXTERNALLY BLOCKED** |
| Provider polling | DEFERRED | **DEFERRED** |
| Multi-college | DEFERRED | **DEFERRED** — but N-1 and N-10 are latent blockers that must be fixed before it is attempted |
| i18n | DEFERRED | **DEFERRED** — locale reserved and inert |
| External monitoring | DEFERRED | **DEFERRED** |
| Distributed metrics / rate limiting | DEFERRED | **DEFERRED** — and now blocking N-12(2) |
| Dependency upgrades | DEFERRED | **DEFERRED** — no majors available |
| Maker-checker | DEFERRED | **DEFERRED** |
| Account deletion | NO-LONGER-RELEVANT | **NO-LONGER-RELEVANT** — terminal archival is the model |

No item was silently removed.

---

## 17. New findings (summary)

| ID | Sev | Area | One-line |
|---|---|---|---|
| N-1 | **HIGH** | Tenancy | Unvalidated `examId` → unfiltered `ExamPaper` query (live-proven); array variant 500s |
| N-2 | MEDIUM | Academic | Rollover mutates CLOSED source-term enrollments; ignores SKIP |
| N-3 | MEDIUM | Academic | `assertTermOpen` `FOR SHARE` released before write at 25/33 sites |
| N-4 | MEDIUM | Integrity | Enrollment capacity TOCTOU, no DB constraint (D-4 class, unfixed here) |
| N-5 | MEDIUM | Validation | Regex-only dates → live 500 + `OUTSIDE_TERM` bypass via `NaN` |
| N-6 | MEDIUM | Authz/PII | `students.csv` full directory incl. email to ACCOUNTANT (live-proven) |
| N-7 | MEDIUM | Authz | `FilesController` declares no permission → verification gate bypassed |
| N-8 | MEDIUM | Files | Signing is college-wide; `purpose` unused; revocation persists |
| N-9 | MEDIUM | Files | Submission/resource `fileUrl` unvalidated and unowned |
| N-10 | MEDIUM | Auth | Login `findFirst` globally unscoped; cross-tenant lockout |
| N-11 | MEDIUM | Academic | Band edits retroactively re-grade published results; gaps unvalidated |
| N-12 | MEDIUM | Ops | Scheduler: unbounded sweeps, no distributed lock, CLOSED-term writes, unbounded logger |
| N-13 | MEDIUM | Academic | Term guard misapplied to a read → analytics unreachable once closed |
| N-14 | LOW | Academic | `dueAt` mutable after publish; `isLate` never recomputed |
| N-15 | LOW | Academic | Rollover executes a stale plan |
| N-16 | LOW | Academic | Room-conflict vs room-resolution inconsistency; non-transactional create |
| N-17 | LOW | Academic | Cancelling a session orphans recorded attendance |
| N-18 | LOW | Academic | Finalization worklist includes DROPPED/COMPLETED students |
| N-19 | LOW | Ops | Dockerfile ships devDependencies; uploads dir prepared in discarded stage |
| N-20 | LOW | Ops | Malformed `BACKUP_MAX_AGE_SECONDS` silently disables staleness detection |
| N-21 | LOW | Ops | `/health/live` and `/health/ready` not log-suppressed |
| N-22 | LOW | Files | No orphan reaper for non-evidence stored files |
| N-23 | LOW | Audit | `evidence_accessed` logged before the second gate; downloads unaudited |
| N-24 | LOW | Auth | Google unlink does not revoke sessions |
| N-25 | LOW | Files | `decodeURIComponent` `URIError` → 500 |
| N-26 | LOW | Exports | `escapeCell` corrupts negative numbers; leading TAB not neutralized |
| N-27 | LOW | Exports | `results.csv` has no `PUBLISHED` filter (latent) |
| N-28 | INFO | Authz | `DEPARTMENT` scope implemented, zero grants — dead path |
| N-29 | INFO | Config | `JWT_REFRESH_SECRET` mandatory but unused |
| N-30 | INFO | Audit | Failed/too-large exports unaudited |
| N-31 | INFO | Docs | M23-W0 miscounted permissions/grants (37/68 vs **38/73**) |
| N-32 | MEDIUM | Tests | No owning suite for `src/access` — the single authorization path |
| Res-1 | LOW | Files | Un-backfilled `Resource.fileUrl` → cross-tenant signable legacy keys |

---

## 18. Severity classification

- **HIGH — 2:** N-1 (latent tenancy bypass, live-proven) and O-H (no CI/lint/web harness).
- **MEDIUM — 12:** N-2, N-3, N-4, N-5, N-6, N-7, N-8, N-9, N-10, N-11, N-12, N-13, N-32.
- **LOW — 14:** N-14 … N-27, Res-1.
- **INFO — 4:** N-28, N-29, N-30, N-31.
- **CRITICAL — 0.** No unconditional, unauthenticated exploit was found.

N-1's HIGH rating reflects a broken invariant, not an active breach: it
requires an authenticated ADMIN and there is only one college today.

---

## 19. Finding disposition table

| Disposition | Findings |
|---|---|
| **CLOSED (re-verified)** | S-1, S-2 (8 paths), D-1, D-2, D-4 |
| **NEW DEFECT — implementation required** | N-1 … N-27, N-32, Res-1 |
| **VERIFIED / NO DEFECT** | S-4, N-28, N-29, O-E, StoredFile FINANCE_DOCUMENT, `void()` CAS, guard param coupling, money representation, and the full SAFE lists in §5/§10/§11/§12/§13/§14 |
| **DOCUMENTED LIMITATION** | S-5 (residual), signed-URL replay, no `FILE_URL_SECRET` rotation staging, ≤15-min token survival, login timing channel, invite token in query string, per-process rate limiting, env-var secrets, no off-host/PITR, manual restore drills, timetable teacher/student conflicts |
| **DEFERRED** | S-2 remainder, S-3, D-3, O-A, O-B, O-C, O-D, O-F, O-G, O-H, T-4, T-5, T-6, N-30, and all deferred product items in §16 |
| **SUPERSEDED** | T-1, T-2, T-3 (coverage claims wrong → ownership debt); reporting/analytics as the M24 recommendation; grade-band locking limitation (→ N-11); S-5's college-wide-signing part (→ N-8) |
| **EXTERNALLY BLOCKED** | Safepay webhook activation |
| **NO-LONGER-RELEVANT** | Account deletion |

---

## 20. Recommended M24 workstream

**M24 — Input Validation & Tenancy Hardening.**

Rationale, evidence-based:

1. **The highest-severity finding is a proven tenancy bypass** (N-1) on a
   read endpoint, caused by a missing validation pipe. Its root cause —
   opt-in per-route validation plus Prisma silently dropping `undefined` —
   is *systemic*, and N-5 and N-25 are the same class. This is the only
   finding cluster that breaks a core platform invariant.
2. **Reporting/analytics must not be M24.** It was the M23-W0
   recommendation, but N-1 proves the analytics surface itself leaks and
   N-13 makes it unreachable for closed terms. Building reporting first
   would inherit both. Reporting becomes M25 and is *unblocked by* M24.
3. **Two authorization findings are policy drift** (N-6, N-7) that need a
   product decision, not just a patch — they belong early, with explicit
   decisions recorded.
4. **The lifecycle/concurrency cluster** (N-2, N-3, N-4, N-11) is the same
   defect family M23 addressed in fees (unlocked read-modify-write, guard
   applied but ineffective). Fixing it consistently generalizes D-4's
   lesson instead of leaving it fees-only.
5. **CI/lint (O-H) is the competing HIGH.** It is deliberately *not*
   recommended as M24 because it would prevent future regressions while
   leaving a proven tenancy bypass live. It is the leading M25 candidate
   alongside reporting.

---

## 21. Proposed W1–W4 scope

**W1 — Validation & tenancy correctness (the HIGH).**
- N-1: attach `ZodValidationPipe` to the analytics route with a required
  `examId`; add the missing tenancy predicate to the `ExamPaper` query
  (defence in depth, so correctness does not rest on validation alone);
  cover the array-injection 500.
- Systematic sweep of **all 192 routes** for `@Query`/`@Param` without a
  validation pipe, and of every query on a model that reaches `collegeId`
  only through a parent — report and fix each instance.
- N-5: make `isoDate`/`isoDateTime` semantically validating; map
  `PrismaClientValidationError` to 400 in the exception filter.
- N-13: remove the term guard from the `analytics` read path.
- N-25: guard `decodeURIComponent`.
- Adversarial tests: omitted/empty/array/malformed parameters on every
  affected route; cross-tenant proof for N-1 using a genuine second college.
- **No migration expected.**

**W2 — File, session and export authorization.**
- N-7 (declare permissions on `FilesController`), N-8 (bind signing to the
  resource that shares the file; consume `purpose`), N-9 (validate and own
  `fileUrl`), Res-1, N-22 (orphan reaper), N-23 (audit ordering + download
  audit), N-10 (tenant-scope login lookup and the rate-limit key), N-24
  (revoke on unlink), N-6 (after decision O-3).
- Adversarial tests: unverified-account upload/sign; revoked-teacher
  signing; cross-tenant legacy key; hostile `fileUrl`.

**W3 — Academic lifecycle and concurrency integrity.**
- N-3 (thread the transaction client through all 25 call sites so `FOR
  SHARE` actually serializes), N-4 (lock or constrain capacity), N-2
  (guard the source term; honour SKIP), N-11 (guard published results;
  validate 0–100 coverage), N-12, N-14, N-15, N-16(a), N-17, N-18.
- Real-Postgres race tests for marks, assignments, timetable, enrollment
  and teaching assignments — the paths that have none today.

**W4 — Re-audit, regression, ops hygiene and close-out.**
- N-19, N-20, N-21, N-26; full re-audit; disposition every finding; close
  M24.

**Ordering rationale:** W1 is the only workstream containing a HIGH; W2
depends on decision O-3; W3 is the largest and benefits from W1's
validation groundwork; W4 mirrors M23-W4, which worked well.

---

## 22. Explicit non-scope

Not to be implemented in M24: reporting/analytics (M25), CI/lint/web test
harness (M25 candidate), global search, notification preferences/digest,
leave workflow, server-side PDF, StoredFile FINANCE_DOCUMENT (not
applicable), `receipts.csv`, mail attachments, Safepay webhook activation
(externally blocked), provider polling, multi-college, i18n, off-host
backups, PITR, external monitoring, distributed metrics/rate limiting,
dependency upgrades, maker-checker, account deletion, GPA policy, and any
unrelated authorization refactoring. `PolicyService` is **not** to be
refactored and no new permission, role, scope or migration is anticipated.

---

## 23. Open decisions

- **O-1 — N-1 remediation shape.** Validation-only, or validation **plus**
  an explicit `exam: { collegeId }` predicate on the `ExamPaper` query?
  Recommendation: both (defence in depth). *Blocks W1.*
- **O-2 — scope of the W1 validation sweep.** All 192 routes, or only
  read endpoints touching parent-scoped models? Recommendation: all, since
  the sweep is cheap and N-1 was a single missed pipe. *Blocks W1.*
- **O-3 — should ACCOUNTANT receive `students.csv`?** Options: narrow the
  export to ADMIN; keep ACCOUNTANT but drop `email`; or ratify current
  behaviour and correct the module's stated policy. This is a product/PII
  decision, not a bug fix. *Blocks W2 (N-6).*
- **O-4 — N-8 authorization model.** Bind signing to the sharing resource
  (section/assignment/post membership), or introduce per-purpose rules?
  Must avoid a new permission. *Blocks W2.*
- **O-5 — N-11 published-results policy.** Should band edits be blocked
  once any exam in the term is published, or should live results be frozen
  at publish time? The second is a semantics change and may belong in M25.
  *Blocks W3.*
- **O-6 — N-3 mechanism.** Thread `tx` through all 25 call sites, or make
  `assertTermOpen` require a transaction client at the type level? The
  latter is safer but touches more code. *Blocks W3.*
- **O-7 — N-12(2) distributed lock.** Use the existing
  `pg_advisory_xact_lock` pattern (already used by finance documents and
  user lifecycle) rather than a new mechanism? Recommendation: yes.
- **O-8 — N-4 mechanism.** Row lock on `Section`, or a DB-level constraint?
  A constraint may need a migration — if so, **STOP and re-authorize**.

---

## 24. Verification evidence

Read-only unless stated. Nothing was mutated; no fixture was created.

- **Baseline:** 728/728 tests / 55 suites; typecheck 0; Prisma valid;
  15 migrations up to date; all four containers healthy; live/ready/preview
  200; backup healthcheck passing; four demo logins 200; no
  skipped/only/todo tests.
- **N-1:** DB ground truth (`total_exams=2 total_papers=4
  papers_per_exam=3,1`) vs `GET /results/analytics` with no `examId` as
  ADMIN → **200 with all 4 papers across both exams**. Role matrix probed:
  teacher 403, accountant 403, anonymous 401. Variants: `?examId=` → 404,
  `?examId=nonexistent123` → 404, `?examId[]=a&examId[]=b` → **500**.
- **N-5:** `GET /exports/attendance.csv?from=2024-13-45` → **500
  `INTERNAL_ERROR`**.
- **N-6:** accountant → `GET /exports/students.csv` → **200**, header
  `firstName,lastName,email,admissionNo,rollNo,department,batch,status`
  with real rows.
- **N-7:** `FilesController` grepped — `@Post()` and `@Post('sign')` carry
  no `@RequirePermission`; `permissions.guard.ts:35-37` returns `true`
  without metadata.
- **N-27:** `results.csv` for the seeded DRAFT exam → 200 header-only
  (0 marks on that exam), so the divergence is code-level and the impact
  currently unobservable — recorded as such.
- **N-28:** zero `DEPARTMENT` occurrences in `permissions.ts`; `Permission`
  = 38 and `RolePermission` = 73 in the database, matching source.
- **N-31:** `git show ac25eec:packages/shared/src/permissions.ts` counted
  with the same method → 38/73, and `permissions.ts` is unchanged since
  M18 `c555035`, proving the M23-W0 figure was a miscount, not drift.
- **M23 fixes:** each fix site grepped present; suites 18/18, 35/35, 25/25.
- **Database integrity:** `users=20 active=20 students=13 colleges=1
  migrations=15` before and after; 8 grade bands all `gradePoint` NULL;
  zero fixture rows; zero scratch/restore databases.

---

## 25. M24-W0 conclusion

M23's work stands: all five fixes verified present and effective, no
closed defect reopened, and the platform's deliberate security design
continues to hold under adversarial tracing.

This discovery shifts the risk picture from *scope errors inside guarded
code* to **missing input validation on read paths**, with one live-proven
tenancy-isolation bypass (N-1) as its worst instance. 33 new findings are
recorded with evidence: 2 HIGH, 12 MEDIUM, 14 LOW, 4 INFO, 0 CRITICAL.
Three previously deferred test findings (T-1/T-2/T-3) are honestly
reclassified as SUPERSEDED because their "no coverage" premise was wrong,
and one documentation defect (N-31) is corrected.

Recommended: **M24 = Input Validation & Tenancy Hardening** (W1 validation
and tenancy, W2 files/session/export authorization, W3 academic lifecycle
and concurrency, W4 close-out), with reporting/analytics and CI/lint moving
to M25. Eight open decisions (O-1…O-8) are recorded; O-1, O-2 and O-3 gate
W1/W2 and need answers before implementation.

**No defect discovered in W0 was fixed. No source, schema, migration,
dependency, Docker, permission or test change was made. M24-W1 was NOT
started.**

---

## 26. M24-W1 outcome (validation sweep results and dispositions)

Implemented at commit `fix(m24): harden input validation and tenancy boundaries`.
Decisions **O-1 = both layers** and **O-2 = all 192 routes** were applied as
recommended above.

### Sweep coverage

All **192 routes** were inventoried programmatically (verb, path, and every
`@Param`/`@Query`/`@Body` decorator with its pipe). Results:

- **`@Body` without `ZodValidationPipe`: 0.** Every mutating body on the
  platform is already schema-validated.
- **`@Query` without `ZodValidationPipe`: 11.** Each was traced to its sink.
- **Queries on parent-scoped models:** 27 models carry no `collegeId` of
  their own. Every query on them was reviewed; all but the N-1 site filter
  by an identifier that was itself resolved under a tenancy-scoped lookup,
  which is the established safe pattern. The distinguishing property of
  N-1 was that its **sole predicate could become `undefined`**, erasing the
  filter entirely. No second instance of that shape exists.

### Disposition of all 11 unvalidated query parameters

| Route | Parameter | Verdict |
|---|---|---|
| `GET /results/analytics` | `examId` | **FIXED (N-1)** — required + tenancy predicate |
| `GET /results/transcript` | `studentId` | **FIXED (N-1 array class)** — scalar-only; empty still means "absent" |
| `GET /results/report/term/:termId` | `studentId` | **FIXED (N-1 array class)** — same |
| `GET /auth/invite-info` | `token` | **FIXED (N-1 array class)** — 64-hex validated *after* the rate limiter; public endpoint no longer 500s |
| `GET /files/:key` | `exp`, `sig` | **NO DEFECT** — fails closed; missing/array both 403 (signature verification rejects before any use) |
| `DELETE /community/groups/:id/membership` | `userId` | **NO DEFECT** — optional by design (self vs moderator removal); array yields 404, no widening |
| `GET /auth/google/start` | `intent`, `college`, `token` | **NO DEFECT** — array input returns 503/redirect, never 500; `intent` is not an authorization input and the token is carried in the signed state cookie |
| `GET /auth/config` | *(none)* | **NO DEFECT** — scanner false positive; the handler takes no parameters |

### Concrete findings and dispositions

| ID | Severity | Disposition |
|---|---|---|
| N-1 analytics tenancy/validation bypass | HIGH | **CLOSED** |
| N-1 array class — analytics, transcript, report card, invite-info | MEDIUM | **CLOSED** |
| N-5 calendar-invalid dates → 500 + guard bypass | MEDIUM | **CLOSED** |
| N-13 term guard on a read path | MEDIUM | **CLOSED** |
| N-25 malformed percent-encoding → 500 | LOW | **CLOSED** |
| All other M24 findings (N-2…N-4, N-6…N-12, N-14…N-24, N-26…N-32, Res-1) | HIGH…INFO | **DEFERRED** — unchanged, W2/W3/W4 |

No new HIGH or CRITICAL defect was discovered during the sweep, so no stop
condition was triggered. No finding was silently fixed or silently closed.

### Scope discipline

No migration, no schema change, no dependency change, no Docker change, no
new route, no new permission or role (`permissions.ts` untouched), no
`PolicyService` change, no money/financial primitive change, no UI change
(the web client already sends `examId` explicitly and a scalar `studentId`,
verified in source). Reporting/analytics features were **not** built — only
the security defect on the existing endpoint was fixed.

### Backward compatibility

The only intentional behaviour changes are rejections of previously-500ing
or previously-widening malformed input. Valid requests are unchanged, and
one edge was deliberately preserved rather than tightened: `?studentId=`
(empty) still means "no target supplied", exactly as the old
`studentId || undefined` did — pinned by a dedicated regression test for
both a wide scope (MISSING_TARGET) and an OWN-scope caller (own record).
