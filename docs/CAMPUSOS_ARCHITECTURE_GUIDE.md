# CampusOS Architecture Guide

A beginner-friendly, repository-grounded tour of how CampusOS is actually built.

**Inspected at:** commit `feeaeef` on branch `amjad-ali-s/set-up-this-codebase-for-6iTTUe`
(working tree clean, local == upstream).
**Nature of this document:** read-only inspection. No source, test, schema,
migration, config or database state was changed to produce it.

### How to read the evidence labels

Every non-obvious claim carries a label so you know how much to trust it:

- **[VERIFIED]** — read directly out of the source files in this repository.
- **[SUGGESTED]** — strongly implied by several files agreeing, but not stated in one place.
- **[DOCUMENTED]** — explicitly written in the project's own `docs/`.
- **[NOT ADDRESSED]** — explicitly recorded in `docs/` as deliberately *not* done yet.
- **Not established from the inspected repository.** — I could not confirm it; do not assume.

---

## 1. CampusOS at a Glance

CampusOS is a **college/school management platform**. One running installation
serves a *college* (called a **tenant**), and inside that college it manages:

- people — students, teachers, guardians, admins, accountants
- academics — departments, courses, sections, enrollments, academic years, terms
- teaching — timetable, attendance, assignments and submissions
- assessment — exams, papers, marks, grade bands, finalized results and transcripts
- money — fee structures, invoices, payments, refunds, finance documents
- community — posts, groups, societies, events, moderation
- platform — authentication, permissions, notifications, file storage, audit trail, CSV exports

**Shape of the system** [VERIFIED]: a **Next.js** browser app talks over HTTP to a
**NestJS** API, which talks to **PostgreSQL** through **Prisma**. Both apps and one
shared library live in a single repository (a *monorepo*).

```
Browser ──HTTP──> Next.js web app ──HTTP /api/v1──> NestJS API ──Prisma──> PostgreSQL
```

Two ideas dominate the design, and you will meet them everywhere:

1. **Authorization is centralised.** One service (`PolicyService`) answers "is this
   user allowed?" using a permission matrix. Business code is not supposed to check
   role names like `if (role === 'ADMIN')`.
2. **Tenancy is server-derived.** The college a request belongs to comes from the
   logged-in user on the server, never from anything the browser sends.

---

## 2. Repository Structure

Verified top level [VERIFIED]:

```
CampusOS/
├── apps/
│   ├── api/                  Backend: NestJS + Prisma + PostgreSQL
│   └── web/                  Frontend: Next.js (App Router) + React + Tailwind
├── packages/
│   └── shared/               Shared TypeScript: Zod schemas, types, permission matrix, enums
├── docs/                     Design documents, development history, operations runbook
├── scripts/
│   └── backup/               Shell scripts for DB + uploads backup / restore verification
├── uploads/                  Local file-storage directory used by the files module
├── docker-compose.alloy.yaml Development stack (host networking, dev servers, demo seed)
├── docker-compose.prod.yaml  Production-shaped stack (built images)
├── package.json              npm workspaces root ("apps/*", "packages/*")
├── package-lock.json
├── tsconfig.base.json        Shared TypeScript compiler settings
├── turbo.json                Present at root
├── .alloy/                   Sandbox/preview environment config
├── .dockerignore
├── .gitignore
├── README.md
└── screenshot.png
```

### What each top-level folder is for

| Folder | Contains | Why it exists | Category | Depended on by |
|---|---|---|---|---|
| `apps/api` | NestJS application, Prisma schema + migrations, e2e tests | The only component allowed to touch the database; enforces all security rules | Backend + database + tests | `apps/web` (over HTTP), Docker |
| `apps/web` | Next.js pages, React components, API client | The user interface | Frontend | Browser users |
| `packages/shared` | Zod validation schemas, API/domain types, `permissions.ts`, enums | Single source of truth used by **both** apps, so rules are not duplicated | Shared code | `apps/api` and `apps/web` |
| `docs` | Milestone design docs, development history, `OPERATIONS.md` | Records decisions, findings and their status | Documentation | Developers/operators |
| `scripts/backup` | 7 shell scripts (backup cycle, health, restore verification) | Operational safety for data | Infrastructure | `backup` container |
| `uploads` | Uploaded file bytes on local disk | Backing store for the files module | Infrastructure/data | `apps/api` files module |
| `docker-compose.*.yaml` | Service definitions | Runs the whole stack | Infrastructure | Developers/CI/ops |

**Is it a monorepo?** Yes [VERIFIED]. Root `package.json` declares
`"workspaces": ["apps/*", "packages/*"]`, and the three workspaces are named
`@campusos/api`, `@campusos/web`, `@campusos/shared`.

Note `packages/shared` builds to `dist/` (`"main": "dist/index.js"`), so after
changing shared code you must rebuild it (`npm run build -w @campusos/shared`)
before the API/web typecheck sees the change [VERIFIED].

---

## 3. Technology Stack

All versions below are read from the workspace `package.json` files [VERIFIED].

**Backend (`apps/api`)**
- **NestJS 10** (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`) — a
  structured Node.js framework. *Framework = a skeleton that decides where your code goes.*
- **Prisma 5** (`prisma`, `@prisma/client`) — the **ORM**. *ORM = Object-Relational
  Mapper: lets you query the database with typed JavaScript instead of hand-written SQL.*
- **PostgreSQL 16** — the database (image `postgres:16-bookworm`).
- **Zod** — runtime validation of incoming data.
- **argon2** — password hashing.
- **@nestjs/jwt** — signs short-lived access tokens.
- **@nestjs/schedule** — cron-style background jobs (notification sweeps).
- **@nestjs/event-emitter** — in-process events that notification listeners subscribe to.
- **nodemailer** — email sending.
- **Jest + supertest** — tests (real app + real HTTP + real PostgreSQL).

**Frontend (`apps/web`)**
- **Next.js 14** with the **App Router**, **React 18**, **Tailwind CSS**, **Zod**.

**Shared (`packages/shared`)**
- **Zod** only. Deliberately dependency-light because both apps import it.

---

## 4. Frontend Architecture

### Folder layout [VERIFIED]

```
apps/web/
├── app/                        Next.js App Router (folders = URLs)
│   ├── (auth)/                 Unauthenticated screens
│   │   ├── login/              /login
│   │   ├── accept-invite/      /accept-invite
│   │   ├── change-password/    /change-password
│   │   └── verify/             /verify
│   ├── (app)/                  The signed-in application (42 pages)
│   ├── layout.tsx              Root layout, wraps providers
│   ├── page.tsx                Root entry
│   └── globals.css
├── components/
│   ├── layout/                 app-shell.tsx, navigation.ts, page-header.tsx
│   ├── ui/                     button, input, select, badge, dialog
│   ├── data/                   data-table.tsx (reusable table)
│   ├── domain/community/       post-card.tsx
│   ├── providers/              session-provider.tsx, toast-provider.tsx
│   └── (feature cards)         guardians-card, account-lifecycle-card, invite-link-dialog, export-csv-button
├── lib/
│   ├── api/                    client.ts, files.ts, upload.ts, exports.ts
│   ├── auth/                   auth-api.ts, token-store.ts
│   ├── hooks/                  use-list.ts, use-zod-form.ts
│   └── format.ts
├── middleware.ts               Route-level redirect gate
├── next.config.mjs
└── tailwind.config.ts
```

`(auth)` and `(app)` are **route groups** — the parentheses organise files without
appearing in the URL [VERIFIED].

### Rendering and state

Pages are **client components** that fetch on mount and hold their own state with
React hooks (`useState`/`useCallback`), rather than using a global store or
server-side data fetching [SUGGESTED — consistent across the page files inspected,
e.g. `app/(app)/results/transcript/page.tsx`, `app/(app)/exams/[id]/page.tsx`].
There is no Redux/Zustand/React-Query dependency in `apps/web/package.json` [VERIFIED].

Shared behaviour lives in two hooks [VERIFIED]:
- `lib/hooks/use-list.ts` — list/pagination fetching
- `lib/hooks/use-zod-form.ts` — forms validated with the **same** Zod schemas the API uses

### How the frontend talks to the backend

Everything funnels through **one** wrapper: `apps/web/lib/api/client.ts` [VERIFIED].

```
page.tsx  ──>  apiFetch('/students')  ──>  fetch('/api/v1/students')  ──>  NestJS
```

That file does four important things [VERIFIED]:
1. Prefixes every path with `/api/v1`.
2. Attaches `Authorization: Bearer <access token>` from `lib/auth/token-store.ts`.
3. Sends cookies (`credentials: 'include'`) so the refresh cookie travels.
4. **Auto-refresh:** on a `401` for a non-`/auth/` path it calls `requestRefresh()`
   once and retries the request exactly once.

It also unwraps the API's standard response envelope and throws a typed `ApiError`
carrying `code`, `message`, `status`, `details`.

### Permission-aware UI and the middleware

`apps/web/middleware.ts` reads an httpOnly hint cookie named `cos_auth` containing
only `{ role, mustChangePassword, verification }` — **no tokens and no permissions**
— and uses `matchRoutePermission` + `roleHasPermission` from `@campusos/shared` to
redirect users away from pages their role cannot use [VERIFIED].

> **Read this carefully.** The middleware's own comment states it is a
> **routing hint only**: "real authorization is enforced server-side on every API
> request via PolicyService" [VERIFIED]. Hiding a menu item is *not* security. If you
> only change the frontend, the API is still open.

### Frontend area map

Only routes that exist are listed. Backend endpoints are the ones the API exposes
for that area (route map in §12) [VERIFIED for paths; endpoint pairing is [SUGGESTED]
except where a page was read directly].

| Frontend area | Location (`apps/web/app/(app)/…`) | Purpose | Backend API used |
|---|---|---|---|
| Dashboard | `dashboard/` | Role-specific landing summary | `GET /dashboards/admin\|teacher\|student` |
| Students | `students/`, `students/[id]/` | Directory, profile, guardians | `/students`, `/students/:id`, `/students/:studentId/guardians` |
| Teachers | `teachers/`, `teachers/[id]/` | Directory and profile | `/teachers`, `/teachers/:id` |
| Departments | `departments/` | Department admin | `/departments` |
| Courses | `courses/`, `courses/[id]/` | Course catalog | `/courses`, `/courses/:id` |
| Sections | `sections/`, `sections/[id]/` | Class sections, enrollment, teachers | `/sections`, `/sections/:id/overview`, `/sections/:id/enrollments/:studentId` |
| Calendar | `calendar/`, `calendar/rollover/[termId]/` | Years/terms, term rollover | `/academic-years`, `/terms`, `/terms/:id/rollover*` |
| Timetable | `timetable/` | Weekly schedule | `/timetable`, `/timetable/slots` |
| Attendance | `attendance/` | Sessions and attendance sheets | `/sections/:sectionId/sessions`, `/sessions/:id/attendance`, `/attendance/summary` |
| Assignments | `assignments/`, `assignments/[id]/` | Create, publish, submit, grade | `/assignments`, `/assignments/:id/submissions`, `/submissions/:id/grade` |
| Exams | `exams/`, `exams/[id]/` | Exams, papers, marks, analytics | `/exams`, `/exams/:id/papers`, `/papers/:id/marks`, `/results/analytics` |
| Results | `results/`, `results/report/[examId]/`, `results/record/[termId]/`, `results/transcript/` | Live results, report cards, transcripts | `/results`, `/results/report/term/:termId`, `/results/transcript` |
| Fees | `fees/`, `fees/invoices/[id]/`, `fees/payments/[attemptId]/`, `fees/documents/`, `fees/documents/[id]/` | Invoices, payments, receipts | `/fees/invoices`, `/fees/invoices/:id/pay`, `/fees/documents` |
| Community | `community/`, `community/groups*`, `community/societies*`, `community/events`, `community/resources` | Social features | `/community/*` |
| Moderation | `moderation/` | Report queue and actions | `/moderation/reports`, `/moderation/actions` |
| Announcements | `announcements/` | Publish announcements | `/announcements` |
| Notifications | `notifications/` | Inbox | `/notifications`, `/notifications/unread-count` |
| Verification | `verification/` | Student identity claims | `/verification/claims`, `/verification/evidence` |
| Guardian | `children/`, `children/[profileId]/` | Guardian view of their children | `/guardian/children` |
| Audit | `audit/` | Read-only audit log viewer | `GET /audit` |
| Settings | `settings/` | College settings, grade bands | `/settings/college`, `PUT /grade-bands` |

---

## 5. Backend Architecture

`apps/api` is a **NestJS** app. NestJS organises code into **modules**; each module
typically has a **controller** (HTTP routes) and one or more **services**
(business logic).

### The normal request pipeline [VERIFIED]

Bootstrapping in `apps/api/src/main.ts`: global prefix `api/v1`, request-context
middleware, `helmet`, `trust proxy = 1`, `cookieParser`, then a global
`EnvelopeInterceptor` and `GlobalExceptionFilter`.

Two **global guards** are registered in `apps/api/src/auth/auth.module.ts` in this
order [VERIFIED]:

```
APP_GUARD: JwtAuthGuard      → "who are you?"
APP_GUARD: PermissionsGuard  → "what may you do?"
```

So a typical request flows:

```
HTTP request
  ↓  requestContextMiddleware        (request id for logs)
  ↓  JwtAuthGuard                    (verify token, load user FRESH from DB, reject non-ACTIVE)
  ↓  PermissionsGuard                (read @RequirePermission → PolicyService.can)
  ↓  Controller method
  ↓  ZodValidationPipe               (validate body/query against a shared schema)
  ↓  Service                         (tenant-scoped lookup → business rules → transaction)
  ↓  Prisma Client
  ↓  PostgreSQL
  ↓  EnvelopeInterceptor / GlobalExceptionFilter  (uniform JSON shape)
  ↓  HTTP response
```

### Response shape [VERIFIED]

- Success: `{ "data": … }` (plus `meta` for paginated lists)
- Failure: `{ "error": { "code", "message", "details?" } }`

`GlobalExceptionFilter` maps Prisma errors to sensible HTTP codes (e.g. unique
violation `P2002` → 409 `UNIQUE_CONSTRAINT`) and never leaks internal messages on
5xx [VERIFIED].

### Important exceptions to the "normal" pipeline

Do **not** assume every route follows the pattern. Verified exceptions:

1. **`@Public()` routes skip authentication.** `JwtAuthGuard` returns early when the
   handler is marked public — used by `/auth/login`, `/auth/refresh`,
   `/auth/logout`, `/auth/config`, `/auth/invite-info`, `/auth/accept-invite`,
   `/auth/reset-password`, the Google `start`/`callback` routes, `/health`,
   `/health/live`, `/health/ready`, the Safepay webhook, and `GET /files/:key` [VERIFIED].
2. **`PermissionsGuard` is a no-op when a route declares no permission.** Its code
   is `if (!permission) return true;` [VERIFIED]. Such routes are
   *authenticated but not permission-gated at the guard*, and must authorize inside
   the service. Real examples:
   - **Exports** (`/exports/*.csv`) call `assertAllScope(user, <permission>)` in
     `exports/exports.module.ts`, which demands resolved scope `ALL` [VERIFIED].
   - **Community** routes largely authorize through
     `community/community-access.policy.ts` and per-service membership checks [VERIFIED].
   - **Files** (`POST /files`, `POST /files/sign`) declare no permission; they rely on
     rate limiting plus `EvidenceAuthzService` / `StoredFileAuthzService` [VERIFIED].
     The consequence is a **documented finding (N-7)** — see §15 and §20.
3. **`GET /files/:key` is public and authorized by an HMAC signature**, not by a
   session, because a browser navigation cannot attach a bearer token [VERIFIED].
4. **Object-level checks happen in services.** `PermissionsGuard` only forwards
   params/query literally named `sectionId` or `departmentId` into the policy
   context [VERIFIED], so routes using `:id` re-check ownership in the service
   (e.g. `assignments.service.ts` `requireManaged`).
5. **CSV responses bypass the envelope** by using `@Res()` directly [VERIFIED].

---

## 6. Backend Module Map

`apps/api/src` contains 26 module folders plus `app.module.ts`/`main.ts` [VERIFIED].
Below are the architecturally important ones.

### `access/` — the authorization core
- **Files:** `policy.service.ts`, `permissions.guard.ts`, `require-permission.decorator.ts`, `current-user.decorator.ts`, `authenticated-user.ts`, `access.controller.ts`
- **Purpose:** the single place that answers "is this user allowed?"
- **Route:** `GET /access/permissions` (`settings.manage`)
- **Database:** `Permission`, `RolePermission`
- **Rules:** business code must not branch on role names; scope decides *which rows*.
- **Tests:** exercised indirectly by nearly every suite; there is **no dedicated
  suite for this folder** — a [DOCUMENTED] finding (N-32).

### `auth/` — authentication
- **Files:** `auth.controller.ts`, `auth.service.ts`, `token.service.ts`,
  `credential-tokens.service.ts`, `jwt-auth.guard.ts`, `session-cookies.ts`,
  `login-rate-limiter.service.ts`, `onboarding.service.ts`,
  `google/google-auth.controller.ts`, `google/google-auth.service.ts`, `google/google-oidc.client.ts`
- **Database:** `User`, `AuthIdentity`, `RefreshToken`, `CredentialToken`, `OauthStateConsumption`
- **Routes:** 15 (see §12)
- **Tests:** `auth`, `google-auth`, `credential-tokens`, `onboarding`, `identity-foundation`, `unverified-gate`
- Details in §7.

### `academics/` — the academic backbone
- **Files:** `academics.controllers.ts` (several controllers in one file),
  `departments.service.ts`, `courses.service.ts`, `sections.service.ts`,
  `calendar.service.ts`, `term-lifecycle.service.ts`, `rollover.service.ts`
- **Database:** `Department`, `Course`, `Section`, `Enrollment`, `TeachingAssignment`, `AcademicYear`, `Term`, `TermRollover`
- **Routes:** 30 — the largest module
- **Key rules [VERIFIED]:**
  - `term-lifecycle.service.ts` is the **one shared guard** for "is this term still
    open?" (`assertTermOpen`, `assertSectionTermOpen`); closing/reopening a term
    takes `FOR UPDATE` on the `Term` row, and guards take `FOR SHARE`.
  - Rollover copies a term into a new one; a **CLOSED source term may be used as a
    source but must not be mutated** (M17 decision O-3), and `SKIP` entries are not carried.
- **Frontend:** `departments/`, `courses/`, `sections/`, `calendar/`, `calendar/rollover/[termId]/`
- **Tests:** `academics`, `calendar-lifecycle`, `term-lifecycle`, `term-enforcement`, `term-rollover`, `m24-w3b-lifecycle-integrity`

### `users/` — people and account lifecycle
- **Files:** `students.controller.ts`/`students.service.ts`, `students-import.service.ts`,
  `teachers.controller.ts`/`teachers.service.ts`, `guardians.controller.ts`/`guardians.service.ts`,
  `users.controller.ts`, `user-lifecycle.service.ts`
- **Database:** `User`, `StudentProfile`, `TeacherProfile`, `GuardianLink`
- **Routes:** 17, including `POST /students/import` and suspend/reactivate/archive/reset-link
- **Key rules [VERIFIED]:** `user-lifecycle.service.ts` takes a **per-college advisory
  lock**, uses compare-and-set updates, refuses self-modification, treats `ARCHIVED`
  as terminal, revokes refresh tokens in the same transaction, and derives
  "manager" roles from the permission matrix rather than role names.
  PII is minimised by *policy scope*: emergency-contact and lifecycle fields are
  returned only to full-scope callers (`students.service.ts`).
- **Tests:** `identity-foundation`, `account-lifecycle`, `guardian-*`

### `attendance/`
- **Files:** `attendance.controller.ts`, `attendance.service.ts`
- **Database:** `ClassSession`, `AttendanceRecord`, `TimetableSlot`, `Enrollment`
- **Routes:** 6
- **Key rules [VERIFIED]:** sessions are generated from timetable slots; teachers are
  narrowed by `ASSIGNED` scope; attendance cannot be written to a `CANCELLED`
  session; and a session that already has attendance records **cannot be cancelled**
  (`SESSION_HAS_ATTENDANCE`, added in M24-W3b).
- **Tests:** `timetable-attendance`, `m24-w3b-lifecycle-integrity`

### `assignments/`
- **Files:** `assignments.controller.ts`, `assignments.service.ts`
- **Database:** `Assignment`, `Submission`
- **Routes:** 9
- **Key rules [VERIFIED]:** `requireManaged`/`requireGradable` resolve the row
  tenant-scoped **then** call `policy.can(..., { sectionId })`; late submissions are
  computed server-side; resubmission is blocked once graded; `maxPoints` cannot drop
  below an awarded grade; and when `dueAt` changes, `Submission.isLate` is
  **recomputed** in the same transaction (M24-W3b).
- **Tests:** `assignments`, `m24-w3b-lifecycle-integrity`

### `exams/`
- **Files:** `exams.controller.ts`, `exams.service.ts`, `results-finalization.service.ts`
- **Database:** `Exam`, `ExamPaper`, `Mark`, `GradeBand`, `TermResult`, `CourseResult`
- **Routes:** 20
- **Key rules [VERIFIED]:**
  - Publishing an exam sets `PUBLISHED` **and** locks every mark in one transaction.
  - `PUBLISHED` is unreachable via `PATCH /exams/:id` (the shared update schema
    allows only `DRAFT|SCHEDULED|COMPLETED`).
  - Grade bands must now form **contiguous 0–100 coverage** (`BANDS_NOT_CONTIGUOUS`),
    on top of the pre-existing overlap rule; `gradePoint` is preserved across edits
    and is **not** client-settable.
  - Finalization only runs for a **CLOSED** term, verified against a `FOR SHARE`-locked
    `Term` row; results are immutable snapshots; `amend` supersedes and `void` is a
    status change, never a delete. GPA/CGPA is `null` unless every line has a grade point.
  - Reading a finalized record under `ASSIGNED` scope requires an **ACTIVE enrollment
    in a section the caller teaches** (the M23-W1 fix).
- **Tests:** `exams`, `results-finalization`, `m23-w1-results-authz`, `m23-w3-data-integrity`

### `timetable/`
- **Files:** `timetable.controller.ts`, `timetable.service.ts`
- **Database:** `TimetableSlot`, `Section`
- **Routes:** 4
- **Key rules [VERIFIED]:** conflict detection covers same-section overlap
  (`SLOT_CONFLICT`) and room overlap (`ROOM_CONFLICT`); since M24-W3b the room check
  uses the **effective room** `slot.room ?? section.room`, matching how the room is
  resolved elsewhere. Teacher and student clash detection are **[NOT ADDRESSED]** (a
  documented limitation), and slot creation is not transactional (finding N-16b).

### `fees/` and `payments/`
- **Files:** `fees/fees.controller.ts`, `fees/fees.service.ts`, `fees/money.ts`,
  `fees/finance-documents.*`; `payments/payments.*`, `payments/refunds.*`,
  `payments/payments-webhook.controller.ts`, `payments/safepay.adapter.ts`, `payments/gateway.adapter.ts`
- **Database:** `FeeStructure`, `FeeComponent`, `Invoice`, `Payment`, `PaymentAttempt`,
  `Refund`, `RefundAttempt`, `FinanceDocument`, `GatewayEvent`
- **Routes:** 14 (fees) + 12 (payments)
- **Key rules [VERIFIED]:** all money columns are `Decimal` (never floats);
  `money.ts` holds the single `netPaid` reducer; invoice amounts are **snapshots**, so
  changing a fee structure does not reprice issued invoices; payment/refund flows take
  `FOR UPDATE` on the `Invoice` row then re-read balances; finance-document numbering
  uses a **per-college advisory lock**; fee-structure updates take `FOR UPDATE` on the
  structure row and re-read the pre-state under the lock (M23-W3).
- **Tests:** `fees`, `finance-documents*`, `payments-*`, `refunds`, `refund-foundation`, `m14-hardening`

### `files/`
- **Files:** `files.controller.ts`, `storage.adapter.ts`, `url-signer.service.ts`,
  `stored-file-authz.service.ts`, `evidence-authz.service.ts`
- **Database:** `StoredFile`, `EvidenceFile`
- **Routes:** 3
- Details in §15.

### `audit/`
- **Files:** `audit.service.ts`, `audit.controller.ts`, `changed-fields.ts`
- **Database:** `AuditLog`
- **Route:** `GET /audit` (`audit.read`)
- Details in §16.

### `exports/`
- **File:** `exports/exports.module.ts` (controller + service in one file)
- **Routes:** 5 CSV endpoints
- **Key rules [VERIFIED]:** `assertAllScope` requires resolved scope `ALL`; every query
  is tenant-scoped; results are capped at `CSV_ROW_CAP` (50 000) and exceeding it
  returns 413; `common/csv.ts` escapes cells and prefixes `= + - @` to blunt
  spreadsheet formula injection. Since M24-W2 the `email` column appears only for
  callers holding `users.manage`.
- **Tests:** `exports`

### `community/` and `announcements/`
- **Files:** `community.controller.ts`, `community.services.ts`, `posts.service.ts`,
  `groups.service.ts`, `moderation.controller.ts`, `moderation.service.ts`,
  `community-access.policy.ts`; `announcements/announcements.module-parts.ts`
- **Database:** `Post`, `Comment`, `Like`, `Group`, `GroupMember`, `Society`,
  `SocietyMember`, `Event`, `EventRsvp`, `Resource`, `Report`, `ModerationAction`, `Announcement`
- **Routes:** 34 (community + moderation) + 2 (announcements)
- **Note:** most community routes are authenticated but not `@RequirePermission`-gated;
  they authorize via `community-access.policy.ts` and membership checks [VERIFIED].

### `notifications/`
- **Files:** `inbox.controller.ts`, `notification-mailer.service.ts`,
  `notification-scheduler.service.ts`, `templates.ts`, and 7 listeners in `listeners/`
- **Database:** `Notification`
- **Routes:** 4
- **How it works [VERIFIED]:** services emit in-process events; listeners create
  `Notification` rows and optionally email. `notification-scheduler.service.ts` runs
  daily cron sweeps (overdue invoices, due-soon assignments, event reminders).
  Known limitations recorded as finding **N-12** are **[NOT ADDRESSED]**.

### `verification/`
- **Files:** `verification.controller.ts`, `verification.service.ts`, `evidence-retention.service.ts`
- **Database:** `StudentIdentityClaim`, `EvidenceFile`
- **Routes:** 6
- **Key rules [VERIFIED]:** evidence upload sniffs **magic bytes** and requires the
  client MIME type to match an allowlist; the retention sweep deletes storage first
  then metadata and audits each purge.

### Supporting modules
- **`common/`** — `zod-validation.pipe.ts`, `envelope.interceptor.ts`,
  `global-exception.filter.ts`, `pagination/`, `csv.ts`, `rate-limiter.service.ts`,
  and `observability/` (request-context, fixed-schema operational logger, counters).
  The logger has **no arbitrary-key API**, so it structurally cannot log bodies,
  headers, URLs or query strings [VERIFIED].
- **`prisma/`** — `PrismaService` (the Prisma client wrapper), `PrismaModule`.
- **`health/`** — `/health`, `/health/live`, `/health/ready`, `/health/ops`.
- **`dashboards/`**, **`settings/`**, **`mail/`**, **`events/`**, **`config/env.ts`**
  (fail-fast environment validation at boot).

---

## 7. Authentication — "Who are you?"

Authentication proves identity. Authorization (§8) decides what that identity may do.

### Login flow [VERIFIED]

```
POST /api/v1/auth/login  (@Public)
  ↓ auth.controller.ts
  ↓ login-rate-limiter.service.ts   assert() runs FIRST, before any DB work
  ↓ auth.service.ts
  ↓ find user by email → argon2.verify(passwordHash)
  ↓ TokenService: sign access token + create refresh token family
  ↓ session-cookies.ts: set refresh cookie + `cos_auth` hint cookie
  ↓ AuditService: 'auth.login.success' / 'auth.login.failure'
  ↓ { data: { accessToken, user } }
```

Verified properties:
- **Passwords** are hashed with **argon2**; accounts may have `passwordHash = null`
  (Google-only) and then password login simply fails.
- **Generic failures.** Wrong password, unknown user, null hash and non-ACTIVE all
  return the same `INVALID_CREDENTIALS`, so the endpoint does not reveal whether an
  account exists.
- **Rate limiting** is per-IP *and* per-account, with exponential backoff, in memory.
- **Access token** is a short-lived JWT carrying only `{ sub, role, collegeId }`;
  permissions are **never** in the token — they are resolved from the database per request.
- **Refresh token** is a 256-bit opaque random value; only its SHA-256 **hash** is
  stored (`RefreshToken.tokenHash`), and it lives in an httpOnly, `secure`,
  `sameSite=lax` cookie path-scoped to `/api/v1/auth`.
- **Rotation + reuse detection.** Refreshing revokes the presented token and issues a
  successor in the same `familyId`; replaying a revoked token revokes the **whole
  family** and audits `auth.token_family_revoked`.
- **Logout** revokes the entire family, not just one token.
- **Suspension is immediate.** `JwtAuthGuard` re-reads the user from the database on
  **every** request and rejects any non-`ACTIVE` status — it does not wait for the
  token to expire.
- **`mustChangePassword`** blocks every route except those marked
  `@AllowPendingPassword`.

### Google / OAuth flow [VERIFIED]

`auth/google/` implements OIDC with `GET /auth/google/start` → Google →
`GET /auth/google/callback`, plus authenticated `GET/POST/DELETE /auth/google/link`.
Verified security properties: PKCE (S256), a nonce bound into a signed httpOnly
state cookie, one-time state consumption recorded in `OauthStateConsumption`
(unique constraint ⇒ replay-safe across instances), ID-token verification pinned to
RS256 with a required `kid` against cached JWKS, and `email_verified` required.
**Email is never treated as proof of identity** and accounts are never auto-linked;
one Google account maps to at most one CampusOS user
(`AuthIdentity @@unique([provider, providerSub])`).
Since M24-W2, unlinking Google also revokes all refresh families.

### Invites and password resets [VERIFIED]

`CredentialToken` (purpose `INVITE` or `RESET`) stores only a hash of a 256-bit
token, is single-use via a guarded atomic update, has a TTL, and yields the same
generic `INVALID_TOKEN` for every failure mode. Accepting an invite or reset revokes
existing sessions.

### Identity model

```
Credentials (password)  ─┐
                         ├─→  User (row in `User`, belongs to one College)
Google identity ─────────┘        │
   (AuthIdentity)                 ├─→ RefreshToken family  (long-lived session)
                                  └─→ Access token (JWT, short-lived)
```

---

## 8. Authorization & Permissions — "What may you do?"

This is the most important section for anyone changing CampusOS.

### The chain [VERIFIED]

```
User (role, collegeId, status, verificationStatus)
  ↓
Role                     one of 5 roles
  ↓
Permission               one of 38 permission keys
  ↓
Scope                    ALL | ASSIGNED | OWN | CHILD   (which rows?)
  ↓
PolicyService.can()/scopeFor()
  ↓
Allowed  /  Denied
```

### Actual values

**Roles (5)** [VERIFIED]: `ADMIN`, `TEACHER`, `STUDENT`, `GUARDIAN`, `ACCOUNTANT`.

**Permissions: 38. Grants: 73** [VERIFIED] — counted from
`packages/shared/src/permissions.ts` and matching the seeded `Permission` (38) and
`RolePermission` (73) tables.

**Scopes used in grants (4)** [VERIFIED]: `ALL`, `ASSIGNED`, `OWN`, `CHILD`.
`PolicyService` also implements a fifth, `DEPARTMENT`, but **no grant uses it** —
an existing [DOCUMENTED] finding (N-28), i.e. an unreachable code path, not a vulnerability.

Grants per role [VERIFIED]:

| Role | Grants | Character |
|---|---|---|
| ADMIN | 31 | almost everything at `ALL` |
| TEACHER | 16 | mostly `ASSIGNED` (only their sections) |
| STUDENT | 14 | mostly `OWN` |
| GUARDIAN | 7 | mostly `CHILD` |
| ACCOUNTANT | 5 | `fees.*`, `finance.refund`, `audit.read`, `users.read` at `ALL` |

### How scope is evaluated [VERIFIED]

`apps/api/src/access/policy.service.ts`:
- `scopeFor(user, permission)` → the granted scope, or `null` if denied.
- `can(user, permission, context?)` → boolean, dispatching on scope:
  - `ALL` → true (tenant boundary still applies upstream)
  - `OWN` → `context.ownerUserId === user.id`
  - `ASSIGNED` → a `TeachingAssignment` exists for `context.sectionId` and this user
  - `CHILD` → an **ACTIVE** `GuardianLink` to `context.studentProfileId`, in the same college
  - `DEPARTMENT` → department match (implemented, unused)
- Two gates run before any scope logic: the user must be `ACTIVE`, and
  `lifecycleAllows` confines `UNVERIFIED/PENDING/REJECTED` accounts to
  `verification.submit` only.
- Grants are cached in memory for **60 seconds**.

**The list-level contract.** When no concrete resource id is supplied, `can()`
returns `true` for `OWN`/`ASSIGNED`/`CHILD` and the *service* must narrow the query
itself. That is why services re-invoke `policy.can(...)` with a concrete id, or add
an explicit `where` narrowing. Missing that narrowing is exactly the class of bug
that M23-W1 fixed.

### Using it in code [VERIFIED]

```ts
@Get('students')
@RequirePermission(PERMISSIONS.USERS_READ)
list(@CurrentUser() user: AuthenticatedUser, …) { … }
```

`PermissionsGuard` reads the decorator's metadata, builds a small resource context
from params/query named `sectionId`/`departmentId`, and calls `policy.can`.
**If a route has no decorator the guard allows it** — such routes must authorize in
their service (§5, exceptions).

### Permission architecture diagram

```
                    packages/shared/src/permissions.ts
                    (38 permissions · 73 grants · single source of truth)
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
        seeds DB tables                    imported by web middleware
   Permission / RolePermission              (routing hints only)
                 │
                 ▼
        PolicyService.grantsForRole()   ← 60s cache
                 │
   ┌─────────────┴──────────────┐
   │                            │
scopeFor(user, perm)      can(user, perm, ctx)
   │                            │
   │                    ALL / OWN / ASSIGNED / CHILD / (DEPARTMENT unused)
   │                            │
   └──────────► service narrows the query by scope ◄──────────┘
```

---

## 9. Multi-Tenancy

A **tenant** here is a **College**. One deployment currently serves one college
(`College` table has 1 row in the running dev database) [VERIFIED], but the data
model is tenant-aware throughout.

### How the current college is obtained [VERIFIED]

`JwtAuthGuard` loads the user from the database and attaches an
`AuthenticatedUser` to the request, which includes `collegeId`
(`apps/api/src/access/authenticated-user.ts`). Controllers receive it via
`@CurrentUser()` and pass it to services, which use `user.collegeId` in queries.

> **The rule:** a client must not be able to pick another college and read its data.
> `collegeId` is taken from the authenticated session **only**. A `collegeId` sent in
> a query string or body is not authorization state — M24-W1/W2 added tests proving a
> forged `collegeId` cannot widen results (e.g. `students.csv`, analytics) [VERIFIED].

### Where tenancy is enforced [VERIFIED]

Almost every service starts with a tenant-scoped lookup, e.g.

```ts
const existing = await this.prisma.feeStructure.findFirst({
  where: { id, collegeId: user.collegeId },
});
if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', … });
```

Note the pattern: a cross-college id yields **404**, indistinguishable from a
nonexistent one, so the API does not reveal that another college's record exists.

### Models with and without their own `collegeId` [VERIFIED]

Of 57 models, **30 carry `collegeId`** and **27 do not**.

- **With `collegeId` (30):** `AcademicYear`, `Announcement`, `AuditLog`, `Course`,
  `Department`, `Event`, `EvidenceFile`, `Exam`, `FeeStructure`, `FinanceDocument`,
  `GradeBand`, `Group`, `GuardianLink`, `Invoice`, `ModerationAction`,
  `PaymentAttempt`, `Post`, `RefundAttempt`, `Report`, `Resource`, `Section`,
  `Society`, `StoredFile`, `StudentIdentityClaim`, `StudentProfile`, `TeacherProfile`,
  `Term`, `TermResult`, `TermRollover`, `User`.
- **Without `collegeId` (27):** `Assignment`, `AttendanceRecord`, `AuthIdentity`,
  `ClassSession`, `College`, `Comment`, `CourseResult`, `CredentialToken`,
  `Enrollment`, `EventRsvp`, `ExamPaper`, `FeeComponent`, `GatewayEvent`,
  `GroupMember`, `Like`, `Mark`, `Notification`, `OauthStateConsumption`, `Payment`,
  `Permission`, `RefreshToken`, `Refund`, `RolePermission`, `SocietyMember`,
  `Submission`, `TeachingAssignment`, `TimetableSlot`.

**How the second group gets its tenant** — through a **parent relation** [VERIFIED]:

| Model | Tenant derived via |
|---|---|
| `Assignment`, `TimetableSlot`, `ClassSession`, `Enrollment`, `TeachingAssignment` | → `Section.collegeId` |
| `ExamPaper` | → `Exam.collegeId` |
| `Mark` | → `ExamPaper` → `Exam.collegeId` |
| `Submission` | → `Assignment` → `Section.collegeId` |
| `AttendanceRecord` | → `ClassSession` → `Section.collegeId` |
| `CourseResult` | → `TermResult.collegeId` |
| `FeeComponent` | → `FeeStructure.collegeId` |
| `Payment`, `Refund` | → `Invoice.collegeId` |
| `Comment`, `Like` | → `Post.collegeId` |
| `GroupMember` | → `Group.collegeId` |
| `SocietyMember` | → `Society.collegeId` |
| `EventRsvp` | → `Event.collegeId` |
| `Notification`, `RefreshToken`, `CredentialToken`, `AuthIdentity` | → `User.collegeId` (per-user data) |
| `Permission`, `RolePermission` | global reference data (not tenant data) |
| `College` | *is* the tenant |
| `GatewayEvent`, `OauthStateConsumption` | Not established from the inspected repository (platform-level records) |

**This is the tenancy risk area.** Because these models have no `collegeId` of their
own, a query that forgets the parent predicate loses the tenant boundary. That is
exactly what happened in the [DOCUMENTED] HIGH finding **N-1** (an `ExamPaper` query
whose only filter could become `undefined`), fixed in M24-W1 by both validating the
input **and** stating `exam: { collegeId: user.collegeId }` explicitly [VERIFIED].

---

## 10. Database Architecture

- **Engine:** PostgreSQL 16 [VERIFIED].
- **Access layer:** Prisma; schema at `apps/api/prisma/schema.prisma` [VERIFIED].
- **Scale:** **57 models**, **42 enums**, **15 migrations** [VERIFIED].
- **Migrations:** `apps/api/prisma/migrations/`, one folder per change, from
  `20260820164746_init` to `20260831155211_m21_account_lifecycle` [VERIFIED].
  *Migration = a recorded, ordered change to the database structure.*

### Notable schema practices [VERIFIED]

- **Money and marks use `Decimal`**, never floating point — e.g. `amount`,
  `totalAmount`, `marksObtained`, `maxMarks`, `minPercent`, `maxPercent`,
  `gradePoint`, `termGpa`, `overallPercentage`, `points`, `weight`.
  `GradeBand.minPercent/maxPercent` are `Decimal(5,2)`, which is why grade-band
  contiguity is defined with a **0.01 step**.
- **Unique constraints encode real rules**, e.g.
  `User @@unique([collegeId, email])` (email is unique *per college*, not globally),
  `GradeBand @@unique([collegeId, label])`,
  `Enrollment @@unique([studentId, sectionId])`,
  `TeachingAssignment @@unique([teacherId, sectionId])`,
  `ExamPaper @@unique([examId, sectionId])`,
  `AuthIdentity @@unique([provider, providerSub])` and `@@unique([userId, provider])`,
  `ClassSession @@unique([slotId, date])`,
  `Invoice @@unique([collegeId, invoiceNo])`,
  `StoredFile.key` / `EvidenceFile.key` / `RefreshToken.tokenHash` unique.
- **Indexes** support the common access paths, e.g. `AuditLog @@index([collegeId, createdAt])`,
  `Enrollment @@index([sectionId, status])`, `ClassSession @@index([sectionId, date])`.
- **Delete behaviour is deliberate:** `onDelete: Restrict` protects records that
  must not vanish (e.g. `AuditLog.college`, `Invoice.student`), `Cascade` is used for
  owned children (e.g. `TeachingAssignment` → `TeacherProfile`/`Section`), and
  `SetNull` for optional actor links (e.g. `AuditLog.actor`, `StoredFile.ownerUser`).
  Because `StoredFile.ownerUserId` is nullable with `SetNull`, ownership is not
  always provable after a user is removed [VERIFIED].
- **Nullable by design:** `GradeBand.gradePoint` is nullable ("dormant GPA hook"), so
  GPA stays `null` rather than being invented.
- **A partial unique index** enforces one active finalized `TermResult` per
  student/term [DOCUMENTED in the M18 design and referenced in the finalization service].

### Domain map (grouped, actual model names)

```
COLLEGE / TENANCY & IDENTITY
├── College
├── User
├── AuthIdentity · RefreshToken · CredentialToken · OauthStateConsumption
├── Permission · RolePermission
├── StudentProfile · TeacherProfile · GuardianLink
└── StudentIdentityClaim · EvidenceFile

ACADEMICS
├── Department · Course
├── AcademicYear · Term · TermRollover
├── Section · Enrollment · TeachingAssignment
└── TimetableSlot

TEACHING & ATTENDANCE
├── ClassSession
├── AttendanceRecord
├── Assignment
└── Submission

ASSESSMENT
├── Exam · ExamPaper · Mark
├── GradeBand
└── TermResult · CourseResult

FINANCE
├── FeeStructure · FeeComponent
├── Invoice · Payment · PaymentAttempt
├── Refund · RefundAttempt
├── FinanceDocument
└── GatewayEvent

COMMUNITY
├── Post · Comment · Like
├── Group · GroupMember
├── Society · SocietyMember
├── Event · EventRsvp
├── Resource
└── Report · ModerationAction

PLATFORM
├── Announcement
├── Notification
├── StoredFile
└── AuditLog
```

### Most important relationships [VERIFIED]

- `College` is the root; nearly every domain table hangs off it.
- `User` ↔ `StudentProfile` / `TeacherProfile` are 1:1 (`userId @unique`); a
  **guardian** is a `User` linked to a student through `GuardianLink`, which is the
  **only** authorization channel for guardian access.
- `Section` is the hub of teaching: it belongs to a `Course` **and** a `Term`, and
  gathers `Enrollment`, `TeachingAssignment`, `TimetableSlot`, `Assignment`, `ExamPaper`.
- `Exam` → `ExamPaper` → `Mark` is the marking chain; `ExamPaper` reaches its college
  only through `Exam`.
- `TermResult` → `CourseResult` are **frozen snapshots** written at finalization;
  they store the grade label and grade point so later configuration changes cannot
  rewrite history.
- `FeeStructure` → `FeeComponent` defines charges; `Invoice` snapshots the amount and
  is the row locked during all payment/refund arithmetic.

---

## 11. Database Model Catalog

"Tenant scoped?" = **direct** (own `collegeId`), **via parent** (inherited through a
relation), or **global** (reference/platform data). [VERIFIED]

| Model | Domain | Main purpose | Important relationships | Tenant scoped? |
|---|---|---|---|---|
| College | Tenancy | The tenant itself | root of nearly everything | *is the tenant* |
| User | Identity | Login account + role | → College; 1:1 Student/TeacherProfile | direct |
| AuthIdentity | Identity | External (Google) identity link | → User | via parent (User) |
| RefreshToken | Identity | Session family, hash only | → User | via parent (User) |
| CredentialToken | Identity | Invite/reset token, hash only | → User | via parent (User) |
| OauthStateConsumption | Identity | One-time OAuth state claim | — | global |
| Permission | Authorization | Permission key catalog | ↔ RolePermission | global |
| RolePermission | Authorization | Role → permission + scope | → Permission | global |
| StudentProfile | People | Student record (rollNo, batch) | → User, Department, College | direct |
| TeacherProfile | People | Teacher record | → User, Department | direct |
| GuardianLink | People | Guardian ↔ student authorization | → User, StudentProfile | direct |
| StudentIdentityClaim | Verification | Identity claim lifecycle | → User, EvidenceFile(key) | direct |
| EvidenceFile | Verification | Uploaded evidence metadata | → uploader User | direct |
| Department | Academics | Organisational unit | → College; ← Course | direct |
| Course | Academics | Course catalog entry | → Department; ← Section | direct |
| AcademicYear | Academics | Year container | ← Term | direct |
| Term | Academics | Term with ACTIVE/CLOSED status | → AcademicYear; ← Section | direct |
| TermRollover | Academics | Rollover plan + status | → from/to Term | direct |
| Section | Academics | A taught class instance | → Course, Term | direct |
| Enrollment | Academics | Student in a section | → StudentProfile, Section | via parent (Section) |
| TeachingAssignment | Academics | Teacher of a section (drives `ASSIGNED`) | → TeacherProfile, Section | via parent (Section) |
| TimetableSlot | Teaching | Weekly meeting slot | → Section; ← ClassSession | via parent (Section) |
| ClassSession | Teaching | A dated occurrence | → TimetableSlot, Section | via parent (Section) |
| AttendanceRecord | Teaching | One student's attendance | → ClassSession, StudentProfile | via parent (ClassSession) |
| Assignment | Teaching | Homework definition | → Section; ← Submission | via parent (Section) |
| Submission | Teaching | Student submission + grade | → Assignment, StudentProfile | via parent (Assignment) |
| Exam | Assessment | Exam with DRAFT→PUBLISHED status | → Term; ← ExamPaper | direct |
| ExamPaper | Assessment | Exam paper for one section | → Exam, Section | via parent (Exam) |
| Mark | Assessment | One student's mark | → ExamPaper, StudentProfile | via parent (ExamPaper) |
| GradeBand | Assessment | Percentage → label (+ optional point) | → College | direct |
| TermResult | Assessment | Immutable finalized result | → StudentProfile, Term | direct |
| CourseResult | Assessment | Frozen per-course line | → TermResult | via parent (TermResult) |
| FeeStructure | Finance | Charge definition for a term | → Term; ← FeeComponent, Invoice | direct |
| FeeComponent | Finance | One line of a structure | → FeeStructure | via parent (FeeStructure) |
| Invoice | Finance | Amount owed (snapshot) | → StudentProfile, FeeStructure | direct |
| Payment | Finance | Recorded payment | → Invoice | via parent (Invoice) |
| PaymentAttempt | Finance | Gateway attempt | → Invoice | direct |
| Refund | Finance | Settled refund | → Invoice | via parent (Invoice) |
| RefundAttempt | Finance | Refund workflow record | → Invoice/Payment | direct |
| FinanceDocument | Finance | Immutable receipt/refund doc | → Invoice | direct |
| GatewayEvent | Finance | Provider webhook record | — | global (platform) |
| Post / Comment / Like | Community | Feed content | Comment/Like → Post | Post direct; others via parent |
| Group / GroupMember | Community | Groups + membership | GroupMember → Group | Group direct; member via parent |
| Society / SocietyMember | Community | Societies + membership | SocietyMember → Society | Society direct; member via parent |
| Event / EventRsvp | Community | Events + attendance intent | EventRsvp → Event | Event direct; rsvp via parent |
| Resource | Community | Shared file resource (`fileUrl`) | → College | direct |
| Report / ModerationAction | Community | Moderation queue | Report → target | direct |
| Announcement | Platform | Broadcast message | → College | direct |
| Notification | Platform | Per-user inbox item | → User | via parent (User) |
| StoredFile | Platform | File ownership/authorization record | → College, owner User | direct |
| AuditLog | Platform | Append-only security trail | → College, actor User | direct |

---

## 12. API Route Map

**192 routes** across 26 controller files, all under the global prefix `/api/v1`
[VERIFIED — enumerated by parsing every `@Controller`/`@Get|@Post|@Put|@Patch|@Delete`
decorator in `apps/api/src`].

Legend for the *Auth* column:
- **PUBLIC** — `@Public()`, no token required
- **auth-only** — token required, **no** `@RequirePermission`; authorization happens
  in the service (see §5 exceptions)
- *PERMISSION_NAME* — guarded by `@RequirePermission(PERMISSIONS.…)`

### AUTH (15) — `auth/auth.controller.ts`, `auth/google/google-auth.controller.ts`
| Method | Route | Auth |
|---|---|---|
| POST | `/auth/login` | PUBLIC |
| POST | `/auth/refresh` | PUBLIC |
| POST | `/auth/logout` | PUBLIC |
| GET | `/auth/config` | PUBLIC |
| GET | `/auth/invite-info` | PUBLIC |
| POST | `/auth/accept-invite` | PUBLIC |
| POST | `/auth/reset-password` | PUBLIC |
| POST | `/auth/change-password` | auth-only |
| GET | `/me` | auth-only |
| PATCH | `/me/preferences` | auth-only |
| GET | `/auth/google/start` | PUBLIC |
| GET | `/auth/google/callback` | PUBLIC |
| GET | `/auth/google/link` | auth-only |
| POST | `/auth/google/link` | auth-only |
| DELETE | `/auth/google/link` | auth-only |

### USERS / PEOPLE (17) — `users/*.controller.ts`
| Method | Route | Auth |
|---|---|---|
| GET / POST | `/students` | USERS_READ / USERS_MANAGE |
| GET / PATCH | `/students/:id` | USERS_READ / USERS_MANAGE |
| POST | `/students/import` | USERS_MANAGE |
| GET / POST | `/students/:studentId/guardians` | USERS_MANAGE |
| DELETE | `/students/:studentId/guardians/:linkId` | USERS_MANAGE |
| GET / POST | `/teachers` | USERS_READ / USERS_MANAGE |
| GET / PATCH | `/teachers/:id` | USERS_READ / USERS_MANAGE |
| POST | `/users/:id/suspend` · `/reactivate` · `/archive` · `/reset-link` | USERS_MANAGE |
| GET | `/guardian/children` | GUARDIAN_CHILDREN |

### ACADEMICS (30) — `academics/academics.controllers.ts`
| Method | Route | Auth |
|---|---|---|
| GET / POST | `/departments` | ACADEMICS_READ / ACADEMICS_MANAGE |
| GET / PATCH | `/departments/:id` | ACADEMICS_READ / ACADEMICS_MANAGE |
| GET / POST | `/courses` | ACADEMICS_READ / ACADEMICS_MANAGE |
| GET / PATCH | `/courses/:id` | ACADEMICS_READ / ACADEMICS_MANAGE |
| GET / POST | `/academic-years` | ACADEMICS_READ / ACADEMICS_MANAGE |
| PATCH | `/academic-years/:id` | ACADEMICS_MANAGE |
| GET / POST | `/terms` | ACADEMICS_READ / ACADEMICS_MANAGE |
| PATCH | `/terms/:id` | ACADEMICS_MANAGE |
| POST | `/terms/:id/close` · `/terms/:id/reopen` | ACADEMICS_MANAGE |
| PATCH | `/terms/:id/set-current` | ACADEMICS_MANAGE |
| GET / POST / PATCH | `/terms/:id/rollover` | ACADEMICS_MANAGE |
| POST | `/terms/:id/rollover/execute` | ACADEMICS_MANAGE |
| GET / POST | `/sections` | ACADEMICS_READ / ACADEMICS_MANAGE |
| GET / PATCH | `/sections/:id` | ACADEMICS_READ / ACADEMICS_MANAGE |
| GET | `/sections/:id/overview` | ACADEMICS_READ |
| POST / DELETE | `/sections/:id/enrollments/:studentId` | ENROLLMENT_MANAGE |
| POST / DELETE | `/sections/:id/teachers/:teacherId` | ENROLLMENT_MANAGE |

### TIMETABLE (4) & ATTENDANCE (6)
| Method | Route | Auth |
|---|---|---|
| GET | `/timetable` | TIMETABLE_READ |
| POST / PATCH / DELETE | `/timetable/slots[/:id]` | TIMETABLE_MANAGE |
| GET | `/sections/:sectionId/sessions` | ATTENDANCE_READ |
| POST | `/sections/:sectionId/sessions/generate` | ATTENDANCE_RECORD |
| PATCH | `/sessions/:id` | ATTENDANCE_RECORD |
| GET / PUT | `/sessions/:id/attendance` | ATTENDANCE_RECORD |
| GET | `/attendance/summary` | ATTENDANCE_READ |

### ASSIGNMENTS (9)
| Method | Route | Auth |
|---|---|---|
| GET | `/assignments` · `/assignments/:id` | ASSIGNMENTS_READ |
| POST / PATCH / DELETE | `/assignments[/:id]` | ASSIGNMENTS_MANAGE |
| POST | `/assignments/:id/publish` | ASSIGNMENTS_MANAGE |
| POST | `/assignments/:id/submissions` | ASSIGNMENTS_SUBMIT |
| GET | `/assignments/:id/submissions` | ASSIGNMENTS_GRADE |
| PATCH | `/submissions/:id/grade` | ASSIGNMENTS_GRADE |

### EXAMS & RESULTS (20)
| Method | Route | Auth |
|---|---|---|
| GET | `/exams` · `/exams/:id` | MARKS_ENTER |
| POST / PATCH | `/exams[/:id]` | EXAMS_MANAGE |
| POST / PATCH | `/exams/:id/papers[/:paperId]` | EXAMS_MANAGE |
| POST | `/exams/:id/publish` | RESULTS_PUBLISH |
| GET / PUT | `/papers/:id/marks` | MARKS_ENTER |
| GET | `/grade-bands` | RESULTS_READ |
| PUT | `/grade-bands` | SETTINGS_MANAGE |
| GET | `/results` | RESULTS_READ |
| GET | `/results/analytics` | EXAMS_MANAGE |
| GET | `/results/report/term/:termId` · `/results/transcript` | RESULTS_READ |
| GET | `/results/terms/:termId/finalization` | RESULTS_FINALIZE |
| POST | `/results/terms/:termId/finalize` · `/finalize-batch` | RESULTS_FINALIZE |
| POST | `/results/records/:id/amend` · `/void` | RESULTS_FINALIZE |

### FEES (14) & PAYMENTS (12)
| Method | Route | Auth |
|---|---|---|
| GET / POST / PATCH | `/fees/structures[/:id]` | FEES_MANAGE |
| POST | `/fees/invoices/generate` | FEES_MANAGE |
| GET | `/fees/invoices` · `/fees/invoices/:id` | FEES_READ |
| PATCH | `/fees/invoices/:id/cancel` | FEES_MANAGE |
| POST | `/fees/invoices/:id/payments` | FEES_MANAGE |
| GET | `/fees/summary` | FEES_MANAGE |
| GET | `/fees/documents` · `/fees/documents/:id` | FEES_READ |
| POST | `/fees/documents/:id/void` | FEES_MANAGE |
| POST | `/fees/payments/:paymentId/receipt` · `/fees/refunds/:refundId/document` | FEES_MANAGE |
| POST | `/fees/invoices/:id/pay` | PAYMENTS_INITIATE |
| POST | `/payments/attempts/:id/verify` | PAYMENTS_INITIATE |
| GET | `/payments/reconciliation` · `/unmatched` | FEES_MANAGE |
| POST | `/payments/reconciliation/:id/verify` | FEES_MANAGE |
| GET / POST | `/fees/payments/:id/refunds` | FEES_READ / FINANCE_REFUND |
| GET | `/fees/refunds` | FEES_MANAGE |
| POST | `/fees/refunds/:id/execute` · `/verify` · `/cancel` | FINANCE_REFUND |
| POST | `/payments/webhooks/safepay` | **PUBLIC** (HMAC-verified over raw body) |

### COMMUNITY (34), ANNOUNCEMENTS (2), DASHBOARDS (3), NOTIFICATIONS (4)
| Method | Route | Auth |
|---|---|---|
| various | `/community/posts*`, `/comments/:id`, `/groups*`, `/societies*`, `/events*`, `/resources*` | **auth-only** (authorized in service via `community-access.policy.ts`) |
| POST | `/community/reports` | COMMUNITY_REPORT |
| GET / PATCH / POST | `/moderation/reports*`, `/moderation/actions` | MODERATION_ACT |
| GET / POST | `/announcements` | ANNOUNCEMENTS_CREATE |
| GET | `/dashboards/admin` · `/teacher` · `/student` | DASHBOARD_ADMIN / _TEACHER / _STUDENT |
| GET | `/notifications` · `/unread-count` | auth-only |
| PATCH / POST | `/notifications/:id/read` · `/read-all` | auth-only |

### FILES (3), EXPORTS (5), VERIFICATION (6), AUDIT (1), ACCESS (1), SETTINGS (2), HEALTH (4)
| Method | Route | Auth |
|---|---|---|
| POST | `/files` | auth-only (rate-limited) |
| POST | `/files/sign` | auth-only (+ evidence & stored-file authz) |
| GET | `/files/:key` | **PUBLIC** — authorized by HMAC `exp`+`sig` |
| GET | `/exports/students.csv` · `attendance.csv` · `fees.csv` · `results.csv` · `refunds.csv` | auth-only (service requires scope `ALL`) |
| POST | `/verification/claims` · `/verification/evidence` | VERIFICATION_SUBMIT |
| GET | `/verification/claims/me` | VERIFICATION_SUBMIT |
| GET | `/verification/claims` · `/claims/:id` | VERIFICATION_MANAGE |
| POST | `/verification/claims/:id/decision` | VERIFICATION_MANAGE |
| GET | `/audit` | AUDIT_READ |
| GET | `/access/permissions` | SETTINGS_MANAGE |
| GET / PATCH | `/settings/college` | SETTINGS_MANAGE |
| GET | `/health` · `/health/live` · `/health/ready` | PUBLIC |
| GET | `/health/ops` | auth-only (`settings.manage` via PolicyService) |

*No secrets, tokens or environment values are reproduced anywhere in this document.*

---

## 13. Request Lifecycle — five real workflows

### 13.1 Login

```
apps/web/app/(auth)/login/page.tsx
  ↓ lib/auth/auth-api.ts  →  POST /api/v1/auth/login
  ↓ auth/auth.controller.ts        @Public
  ↓ login-rate-limiter.service.ts  assert(ip, email)   ← before any DB work
  ↓ auth/auth.service.ts           findFirst(User by email) → argon2.verify
  ↓ auth/token.service.ts          sign access JWT + create RefreshToken family
  ↓ auth/session-cookies.ts        set refresh cookie + `cos_auth` hint cookie
  ↓ audit/audit.service.ts         'auth.login.success'
  ↓ PostgreSQL: User read, RefreshToken insert, AuditLog insert
  ↓ { data: { accessToken, user } }
  ↓ lib/auth/token-store.ts stores the access token in memory
  ↓ middleware.ts then permits /dashboard
```

### 13.2 Viewing a student

```
apps/web/app/(app)/students/[id]/page.tsx
  ↓ lib/api/client.ts  →  GET /api/v1/students/:id
  ↓ JwtAuthGuard        load user fresh from DB; reject non-ACTIVE
  ↓ PermissionsGuard    @RequirePermission(USERS_READ) → PolicyService.can
  ↓ users/students.controller.ts
  ↓ users/students.service.ts
      • findFirst(StudentProfile where { id, collegeId: user.collegeId })  ← tenancy
      • scopeFor(user,'users.read'): ALL → allow · OWN → self only ·
        ASSIGNED → must share an ACTIVE Enrollment in a section this teacher teaches
      • PII minimisation: emergency-contact + lifecycle fields only for scope ALL/OWN
  ↓ Prisma → PostgreSQL
  ↓ { data: {...} }
```

### 13.3 Submitting an assignment (student)

```
apps/web/app/(app)/assignments/[id]/page.tsx
  ↓ (optional) lib/api/upload.ts → POST /api/v1/files      → StoredFile row + bytes on disk
  ↓ POST /api/v1/assignments/:id/submissions
  ↓ PermissionsGuard  @RequirePermission(ASSIGNMENTS_SUBMIT)
  ↓ assignments/assignments.controller.ts (ZodValidationPipe, shared schema)
  ↓ assignments/assignments.service.ts
      • assertSectionTermOpen(...)                   ← term must still be open
      • must be ACTIVE-enrolled in the section
      • isLate = now > assignment.dueAt  (server-computed)
      • if late && !allowLate → 400 PAST_DUE
      • upsert Submission (blocked once graded)
  ↓ Prisma → PostgreSQL (Submission insert/update)
  ↓ event → notifications listener → Notification row
  ↓ { data: {...} }
```

### 13.4 Entering marks and publishing an exam

```
apps/web/app/(app)/exams/[id]/page.tsx
  ↓ PUT /api/v1/papers/:id/marks          @RequirePermission(MARKS_ENTER)
  ↓ exams/exams.service.ts saveMarks
      • requirePaperForMarks → tenant-scoped paper + policy.can(marks.enter,{sectionId})
      • refuse if exam PUBLISHED (MARKS_LOCKED); 0 ≤ mark ≤ paper.maxMarks
      • every student must be actively enrolled
      • audit 'marks.entered'
  ↓ POST /api/v1/exams/:id/publish        @RequirePermission(RESULTS_PUBLISH)
  ↓ exams/exams.service.ts publish
      • prisma.$transaction([ exam.update(PUBLISHED, publishedAt/By),
                              mark.updateMany(lockedAt: now) ])   ← atomic
      • audit 'results.published'
  ↓ PostgreSQL
```

### 13.5 Term rollover (the most complex workflow)

```
apps/web/app/(app)/calendar/rollover/[termId]/page.tsx
  ↓ POST /api/v1/terms/:id/rollover            create DRAFT plan
  ↓ PATCH /api/v1/terms/:id/rollover           edit the plan
  ↓ POST /api/v1/terms/:id/rollover/execute    @RequirePermission(ACADEMICS_MANAGE)
  ↓ academics/rollover.service.ts execute()
      typed confirmation: the destination term label must be typed exactly
      prisma.$transaction:
        1. assertTermOpen(tx, destination)             ← Term FOR SHARE
        2. SELECT id FROM "TermRollover" … FOR UPDATE  ← row lock
        3. re-read the rollover row UNDER the lock     ← M24-W3b (no stale plan)
        4. CAS: updateMany(status DRAFT → EXECUTED)    ← exactly one execution
        5. read source Term status → sourceIsReadOnly  ← M24-W3b
        6. pass 1: create destination Sections, carry TeachingAssignments
        7. pass 2: create destination Enrollments; graduate flagged students;
                   conclude SOURCE enrollments ONLY if action ≠ SKIP
                   AND the source term is not CLOSED  ← M24-W3b
        8. audit 'terms.rollover_executed'
  ↓ PostgreSQL — all-or-nothing
```

### 13.6 CSV export (shows the "authorize in the service" pattern)

```
apps/web/components/export-csv-button.tsx  (gated on a permission for display only)
  ↓ lib/api/exports.ts → GET /api/v1/exports/students.csv
  ↓ JwtAuthGuard ✔    PermissionsGuard → no decorator → passes through
  ↓ exports/exports.module.ts students()
      • assertAllScope(user,'users.read')   ← REAL check: resolved scope must be ALL
      • query scoped by collegeId; take CSV_ROW_CAP + 1
      • email column included ONLY if policy.can(user,'users.manage')   ← M24-W2
      • toCsv() escapes cells; audit 'exports.generated' { export, rows }
  ↓ @Res() raw CSV (bypasses the JSON envelope)
```

### 13.7 File download (signature-based authorization)

```
Browser click
  ↓ POST /api/v1/files/sign   { url: '/api/v1/files/<key>' }      (authenticated)
  ↓ files/files.controller.ts  validate prefix + safe decode + key rules
  ↓ StoredFileAuthzService.assertCanSign   ← tenancy/ownership   (order set in M24-W2)
  ↓ EvidenceAuthzService.assertCanSign     ← strict evidence rule + audit
  ↓ FileUrlSignerService.sign(key)  → { exp, sig }   HMAC over `key|exp`
  ↓ { data: { url: '/api/v1/files/<key>?exp=…&sig=…' } }
  ↓ GET /api/v1/files/:key?exp&sig     @Public
  ↓ verify(): timing-safe HMAC + expiry → 403 if bad
  ↓ storage.adapter.ts: reject '/', '\', '..'; normalize+prefix check
  ↓ stream bytes as application/octet-stream; Content-Disposition: attachment
```

---

## 14. Transactions & Concurrency

*Transaction = a group of database statements that all succeed or all fail together.
Row lock = temporarily reserving one row so a concurrent request must wait.*

### Where transactions are used [VERIFIED]

`$transaction` appears most in `fees.service.ts` (7), `exams.service.ts` (6),
`community/posts.service.ts` (6), `academics/calendar.service.ts` (5),
`payments/refunds.service.ts` (4), and others.

### Locking patterns actually present [VERIFIED]

| Pattern | Where | Purpose |
|---|---|---|
| `SELECT … FOR UPDATE` on `Invoice` | `payments/payments.service.ts:286,444`; `payments/refunds.service.ts:217,369,452,572`; `fees/fees.service.ts:599`; `fees/finance-documents.service.ts:248` | serialize all money arithmetic on one invoice |
| `SELECT … FOR UPDATE` on `Term` | `academics/term-lifecycle.service.ts:177`; `academics/calendar.service.ts:330` | close/reopen/set-current a term exclusively |
| `SELECT … FOR SHARE` on `Term` | `academics/term-lifecycle.service.ts:63,90`; `exams/results-finalization.service.ts:501` | writers hold a shared lock so a concurrent close must wait |
| `SELECT … FOR UPDATE` on `TermRollover` | `academics/rollover.service.ts:438` | exactly one rollover execution |
| `SELECT … FOR UPDATE` on `FeeStructure` | `fees/fees.service.ts:235` | fix the M23 D-4 blended-total race |
| `pg_advisory_xact_lock` | `users/user-lifecycle.service.ts:117`; `fees/finance-documents.service.ts:410` | per-college serialization (last-admin counting; document numbering) |

**Lock ordering** is documented in code as *Term before Invoice* and *Term before
row* to avoid deadlocks [VERIFIED — comments in `fees.service.ts:171-172` and `:223`].

### Why a guard outside a transaction can create a race

`assertTermOpen(client, …)` runs `SELECT … FOR SHARE` on the `Term` row. A shared
lock only lasts as long as the transaction that took it. If the guard is called with
the plain Prisma client (not a transaction), the little query commits immediately and
**the lock is released before the caller's write**. A concurrent "close the term"
could then commit in the gap, and the write lands in a closed term.

> **This is a real, [DOCUMENTED] finding — N-3.** The M24 design records that the
> guard passes a transaction client at only a few call sites and **26 call sites**
> across 8 services still pass the plain client. It is **[NOT ADDRESSED]**: N-3 is
> assigned to the not-yet-executed **M24-W3a**. Verified today: no `assertTermOpen`
> call site was changed by W3b.

**So: CampusOS is not uniformly transaction-safe.** The money paths and term
transitions are properly locked; several academic write paths are guarded but not
yet serialized. Related [NOT ADDRESSED] items: **N-4** (enrollment capacity
read-modify-write with no lock or DB constraint) and **N-16b** (non-transactional
timetable slot creation).

---

## 15. File Architecture

Five concerns are deliberately separate [VERIFIED]:

| Concern | Implementation |
|---|---|
| **File storage** | `files/storage.adapter.ts` — writes bytes under `uploads/`; keys are `<32-hex>__<sanitized-name>`; rejects `/`, `\`, `..` and re-checks the normalized path stays inside the root |
| **File authorization** | `files/stored-file-authz.service.ts` (tenant/ownership) and `files/evidence-authz.service.ts` (strict evidence rule) |
| **File signing** | `files/url-signer.service.ts` — `HMAC_SHA256("key|exp", FILE_URL_SECRET)`, default TTL **5 minutes**, timing-safe verification |
| **File downloading** | `GET /files/:key` — `@Public`, authorized purely by `exp`+`sig`; served `application/octet-stream` + `Content-Disposition: attachment` |
| **Audit logging** | `verification.evidence_accessed` written by the evidence gate |

**`FilePurpose` enum** [VERIFIED]: `COMMUNITY_ATTACHMENT`, `SUBMISSION`, `EVIDENCE`,
`OTHER`. In practice the generic upload endpoint records **`OTHER`**, and only the
verification path records `EVIDENCE` [VERIFIED].

Current `StoredFile` authorization rule [VERIFIED]: owner may sign; **any user in the
same college** may sign; anyone else (including other colleges) gets an
indistinguishable `404`; a key with **no** `StoredFile` row is "grandfathered" and
falls back to the original signature-only rules.

### Deferred file work — explicitly recorded, not invented

These are **[NOT ADDRESSED]** per `docs/M24_PLATFORM_DISCOVERY_DESIGN.md`:

- **N-7** — `FilesController` declares no permission, so the verification-lifecycle
  gate (which lives inside `PolicyService`) never runs for upload/signing.
  Blocker recorded: no permission is held by every uploading role.
- **N-8** — signing is college-wide and `StoredFile.purpose` is not consulted;
  a revoked teacher can still sign a key they once saw. Decision **O-4 = B2** keeps
  today's `OTHER` behaviour deliberately unchanged for now.
- **N-9** — `Submission.fileUrl` / community `Resource.fileUrl` accept an
  unvalidated, unowned string.
- **N-22** — no orphan reaper for non-evidence stored files.
- **N-23 (download half)** — `GET /files/:key` is never audited, and cannot be with a
  server-derived actor because it is public/signature-authorized.
- **Res-1** — community `Resource.fileUrl` keys were not backfilled into `StoredFile`.

---

## 16. Audit Architecture

**Why it exists:** to answer "who changed what, when" after the fact, and to make
security-relevant actions reviewable.

- **Model:** `AuditLog { collegeId, actorId?, action, targetType?, targetId?, metadata Json, createdAt }`, indexed `[collegeId, createdAt]` [VERIFIED].
- **Service:** `audit/audit.service.ts` with two write methods [VERIFIED]:
  - `log(entry, tx?)` — **fire-and-forget**: it catches and logs write failures so an
    audit problem can never fail a business operation.
  - `logAtomic(entry, tx)` — **requires** a transaction and lets errors propagate, so
    the mutation and its audit row commit or roll back together (added in M23-W2).
- **Append-only:** the whole application source contains exactly **two**
  `auditLog.create` calls, both inside `AuditService`, and **no** update, delete or
  upsert of `AuditLog` anywhere [VERIFIED].
- **Scale:** ~**88 distinct action names** and ~**104 audit write call sites** [VERIFIED].
- **Read surface:** `GET /audit` (`audit.read`), tenant-scoped, filterable by action
  prefix/actor/date, newest first; the module exposes no mutation route [VERIFIED].

### What is audited [VERIFIED — sample of real action names]

`auth.login.success`, `auth.login.failure`, `auth.logout`, `auth.password_changed`,
`auth.token_family_revoked`, `auth.google_login/linked/unlinked`,
`students.created/updated/imported`, `teachers.created/updated`,
`courses.*`, `departments.*`, `sections.created/updated`,
`enrollments.created/dropped`, `teaching_assignments.created/removed`,
`terms.created/updated/set_current/rollover_drafted/rollover_executed`,
`timetable.slot_created/updated/deleted`, `attendance.recorded/session_updated`,
`assignments.created/updated/published/deleted`, `submissions.graded`,
`exams.created/updated/paper_created/paper_updated`, `marks.entered`,
`grade_bands.updated`, `results.published/finalized/amended/voided`,
`fees.structure_created/updated`, `fees.invoices_generated`,
`fees.payment_recorded`, `fees.receipt_issued/voided`, `payments.settled`,
`payments.refund_*`, `payments.webhook_rejected`, `exports.generated`,
`verification.claim_*`, `verification.evidence_accessed/purged`,
`guardian.invited/link_created/link_revoked`, `moderation.report_filed`,
`settings.updated`, `preferences.updated`, `mail.sent/failed`.

### Metadata discipline [VERIFIED]

Actor and college are always taken from the authenticated session, never from the
request. Metadata is a small allowlisted shape — `audit/changed-fields.ts` records
the **names** of changed fields, not their values, precisely so free text, PII and
credentials stay out of the trail. Examples: `fees.structure_updated` records
`termId`, `changed`, component counts and before/after totals;
`grade_bands.updated` records only counts; `verification.evidence_accessed` records
`{ as: 'owner' | 'reviewer' }` — never the key, URL or signature.

Recorded gap, **[NOT ADDRESSED]**: **N-30** — failed/too-large exports are not
audited because `logExport` only runs on success.

---

## 17. Testing Architecture

- **Runner:** Jest with `ts-jest`; `roots: ['<rootDir>/test']`, matching
  `*.e2e-spec.ts` and `*.spec.ts`; 30 s timeout [VERIFIED].
- **Style:** almost everything is **end-to-end**: `test/test-app.ts` boots the real
  `AppModule` exactly as `main.ts` does (prefix, envelope, filter, cookies, helmet)
  and tests drive it over **real HTTP** with `supertest` against **real PostgreSQL**
  [VERIFIED]. *E2E test = exercises the whole stack, not one function in isolation.*
- **Scale:** 58 suite files + `test-app.ts` (59 files); ~776 `it()` blocks; the last
  full run in this session reported **800 passing tests across 58 suites** [VERIFIED].
- **Almost no unit layer:** only `backup-operations.spec.ts` is not an e2e suite —
  a [DOCUMENTED] gap (T-6). There is **no test harness in `apps/web`** [VERIFIED].
- **No CI:** `.github/` does not exist [VERIFIED] — [DOCUMENTED] finding O-H. Tests
  run only when a developer runs them.

### Major suites and what they protect

| Test suite | Location (`apps/api/test/`) | What it protects |
|---|---|---|
| `auth`, `google-auth`, `credential-tokens`, `onboarding` | | Login, OAuth (PKCE/nonce/state), invites, resets, token rotation |
| `identity-foundation`, `account-lifecycle`, `unverified-gate` | | Roles/identity, suspend/reactivate/archive, unverified lifecycle gate |
| `guardian-foundation`, `guardian-child-data`, `guardian-hardening`, `guardian-onboarding` | | `CHILD` scope and guardian isolation |
| `academics`, `calendar-lifecycle`, `term-lifecycle`, `term-enforcement`, `term-rollover` | | Academic structure, term ACTIVE/CLOSED rules, rollover |
| `timetable-attendance` | | Slots, conflicts, sessions, attendance |
| `assignments` | | Publish/submit/grade rules |
| `exams`, `results-finalization` | | Marks lock, publish, finalize/amend/void, transcripts |
| `fees`, `finance-documents*`, `payments-*`, `refunds`, `refund-foundation`, `m14-hardening` | | Money correctness, gateway/webhook, immutable documents |
| `files`, `stored-file-authz` | | Signing, traversal, ownership/tenancy |
| `exports` | | Export authorization, tenancy, row cap |
| `community`, `moderation` | | Community authorization and moderation |
| `audit-viewer` | | Audit read surface |
| `notification-mail`, `mail` | | Notifications and email |
| `ops-health`, `runtime-reliability`, `observability-hardening`, `request-correlation`, `backup-operations`, `seed-guard` | | Health semantics, logging, counters, backups, seed safety |
| `hardening`, `hardening-w7`, `m19-w2-hardening`, `m21-w2-settings`, `dashboards`, `verification` | | Cross-cutting hardening and features |
| **`m23-w1-results-authz`** | | S-1: `ASSIGNED` scope on finalized records (18 tests) |
| **`m23-w2-audit-integrity`** | | S-2: exactly-once atomic audit, spoof-inertness (35 tests) |
| **`m23-w3-data-integrity`** | | D-4/D-1/D-2: fee concurrency, export filter, gradePoint (25 tests) |
| **`m24-w1-validation-tenancy`** | | N-1/N-5/N-13/N-25: validation + tenancy (24 tests) |
| **`m24-w2-file-session-export`** | | N-6/N-23-ordering/N-24 (17 tests) |
| **`m24-w3b-lifecycle-integrity`** | | N-2/N-11/N-14/N-15/N-16a/N-17/N-18 (31 tests) |

### Testing philosophy [DOCUMENTED in `docs/CAMPUSOS_DEVELOPMENT_HISTORY.md`, and visible in the suites]

1. **Test-first fixes.** A regression test is written and shown to **fail against the
   unfixed code** before the fix lands (e.g. W3b recorded 12 failing assertions first).
2. **Mutation verification.** After fixing, the fix is reverted to prove the new test
   actually fails — a fix is not "covered" just because the happy path passes.
3. **Milestone suites are authoritative.** `m23-*`/`m24-*` suites encode closed
   findings so they cannot silently regress; existing tests are not weakened, and
   changing one requires explicit sanction (W3b changed three fixtures under
   recorded authorization).
4. **Real concurrency, not mocks.** Race conditions are tested with genuinely
   concurrent HTTP requests against PostgreSQL. Mocks are used only narrowly, e.g.
   injecting an audit failure to prove rollback.
5. **Full regression before commit**, plus typecheck, Prisma validation, production
   builds and health checks.

---

## 18. Docker & Infrastructure

Two compose files [VERIFIED]:
- `docker-compose.alloy.yaml` — development/preview: `network_mode: host`, dev servers,
  demo seeding enabled.
- `docker-compose.prod.yaml` — production-shaped: built images, no demo seed.

**Services (same five in both):** `postgres`, `uploads-init`, `backup`, `api`, `web`.
**Named volumes:** `pgdata`, `uploads`, `pgbackups` [VERIFIED].

```
                  ┌─────────────┐
                  │   Browser   │
                  └──────┬──────┘
                         │  http://localhost:8080 (preview proxy) → web
                  ┌──────▼──────┐
                  │     web     │  Next.js (port 3000)
                  └──────┬──────┘
                         │  /api/v1  →  api
                  ┌──────▼──────┐
                  │     api     │  NestJS (port 4000)
                  │  /health    │  /health/live  /health/ready  /health/ops
                  └──────┬──────┘
                         │ Prisma
                  ┌──────▼──────┐        ┌──────────────┐
                  │  postgres   │◄───────│    backup    │ sidecar
                  │  (16)       │        │ pg + uploads │
                  └──────┬──────┘        └──────┬───────┘
                    pgdata│                     │pgbackups (read-only into api)
                          │              uploads (read-only into backup)
                  ┌───────▼───────┐
                  │ uploads-init  │ one-shot: prepares the uploads volume
                  └───────────────┘
```

Verified operational details:
- **Health checks** on `postgres`, `backup`, `api`, `web`; `depends_on` orders startup;
  `uploads-init` is gated by `service_completed_successfully` in prod.
- **Least privilege volumes:** `uploads` is mounted **read-only** into `backup`;
  `pgbackups` is mounted **read-only** into `api` (so `/health/ops` can report
  freshness without being able to alter backups).
- **Log rotation** is capped on every service via a shared `x-logging` anchor.
- **Backup sidecar** runs `scripts/backup/backup-loop.sh` → `backup-cycle.sh`
  (DB dump + uploads tar + verification + `.backup-health` marker), with
  `restore-verify.sh` / `uploads-restore-verify.sh` for drills.
- **Production secrets** are required via `${VAR:?}` so the stack fails fast if
  absent. **No values are reproduced here.**
- **Declared limitations** [DOCUMENTED in `docker-compose.prod.yaml` and `OPERATIONS.md`]:
  local-volume backups only — **no off-host copies and no point-in-time recovery**.

---

## 19. Documentation Structure

`docs/` contains 12 files [VERIFIED]:

| Document | Purpose |
|---|---|
| `CAMPUSOS_DEVELOPMENT_HISTORY.md` | The main chronological record: every milestone/workstream, what changed, evidence, test counts, commit hashes, and a "current state" footer. **Start here for status.** |
| `CAMPUSOS_COMPLETE_DEVELOPMENT_JOURNEY.md` | Narrative overview of the project's development |
| `OPERATIONS.md` | The operator runbook: 32 sections covering payments, rollover, refunds, term lifecycle, academic records, backups/health, finance documents, account lifecycle, runtime reliability, and (§32) the M23 audit/authorization notes |
| `M16_REFUNDS_DESIGN.md` | Refund design |
| `M17_TERM_LIFECYCLE_DESIGN.md` | Term ACTIVE/CLOSED model, including the O-3 decision that a CLOSED term may still be a rollover source |
| `M18_ACADEMIC_RECORDS_DESIGN.md` | Finalized results/transcripts; the O-4 GPA policy gap |
| `M19_PLATFORM_HARDENING_DESIGN.md` | Backups, observability |
| `M20_FINANCE_DOCUMENTS_DESIGN.md` | Immutable receipts/refund documents |
| `M21_PLATFORM_DISCOVERY_DESIGN.md` | Account lifecycle discovery/design |
| `M22_PLATFORM_DISCOVERY_DESIGN.md` | Runtime reliability discovery/design |
| `M23_PLATFORM_DISCOVERY_DESIGN.md` | M23 discovery: findings S-1…S-5, D-1…D-4, with final dispositions |
| `M24_PLATFORM_DISCOVERY_DESIGN.md` | **The current milestone.** Findings N-1…N-32 + Res-1, severities, evidence, per-finding resolution notes, open decisions O-1…O-8, and W-slice outcome sections |

**Reading order for a newcomer:** `README.md` → `CAMPUSOS_DEVELOPMENT_HISTORY.md`
(footer first, for current state) → `M24_PLATFORM_DISCOVERY_DESIGN.md` (what is open)
→ `OPERATIONS.md` (how it runs).

---

## 20. Current Project Status

Verified against the repository, not only against reports.

**Git state at inspection** [VERIFIED]: HEAD `feeaeef`
("fix(m24): harden academic lifecycle and grade-band integrity"), branch
`amjad-ali-s/set-up-this-codebase-for-6iTTUe`, clean tree, local == upstream.
Recent chain: `feeaeef` ← `62cc734` ← `2785c78` ← `5abdbeb` ← `52e817f` (M23 close-out).

**Health at inspection** [VERIFIED]: 800/800 tests across 58 suites, typecheck 0
errors, Prisma schema valid, **15 migrations** applied and up to date.

**M23 — CLOSED** [DOCUMENTED + VERIFIED]. Findings S-1, S-2 (approved scope), D-1,
D-2, D-4 closed; zero migrations added.

**M24 — OPEN.** Status per `docs/CAMPUSOS_DEVELOPMENT_HISTORY.md` [DOCUMENTED],
cross-checked in source:

| Slice | State | Verification I performed |
|---|---|---|
| **W0** discovery/design | COMPLETE (`5abdbeb`) | `docs/M24_PLATFORM_DISCOVERY_DESIGN.md` present |
| **W1** validation & tenancy (N-1, N-5, N-13, N-25) | COMPLETE (`2785c78`) | `examAnalyticsQuerySchema` present; suite `m24-w1-validation-tenancy` present |
| **W2** file/session/export | **PARTIAL** (`62cc734`) | N-6/N-23-ordering/N-24 implemented; suite present |
| **W3b** lifecycle & grade bands | COMPLETE (`feeaeef`) | `BANDS_NOT_CONTIGUOUS`, `sourceIsReadOnly`, `rolloverRow`, `SESSION_HAS_ATTENDANCE`, `sectionRoom` and the ACTIVE-enrollment filter all found in source |
| **W3a** (N-3, N-4, N-16b) | **NOT STARTED** | no `assertTermOpen` call-site changes; no capacity lock |
| **W3c** (N-12) | **NOT STARTED** | scheduler unchanged |
| **W4** close-out | **NOT STARTED** | M24 not marked closed |

**Explicitly deferred / not addressed** [DOCUMENTED, and not present in source]:

- **W2 remainder:** N-7 (files declare no permission → lifecycle gate skipped),
  N-8 (college-wide signing model), N-9 (unvalidated `fileUrl`), N-10 (login lookup
  not tenant-scoped; global rate-limit key), N-22 (no orphan reaper),
  N-23 download-half (downloads unaudited), Res-1 (`Resource.fileUrl` not backfilled).
- **W3a/W3c:** N-3 (26 call sites where the `FOR SHARE` guard is released before the
  write), N-4 (capacity TOCTOU), N-16b (non-transactional slot create), N-12
  (unbounded scheduler sweeps, no distributed lock, unbounded background logging).
- **M25:** N-11 **retroactive-regrading guard** and freeze-at-publish (decision O-5);
  reporting/analytics; CI/lint/web test harness (O-H); N-26…N-32; S-3/S-4/S-5; D-3;
  O-A…O-H; T-1…T-6.
- **Externally blocked:** Safepay webhook activation.

**Important nuance you should not misread:** M24-W3b closed only the **coverage half**
of N-11. Editing grade-band boundaries still changes the letter grade shown for
already-published exams, because labels are resolved at read time. That is a
deliberate, recorded deferral — not an oversight.

I did **not** perform a new security audit and did **not** discover any new
security or correctness defect during this inspection. **No NEW FINDING is recorded.**

---

## 21. Where to Change What

Practical lookup table. All paths are real [VERIFIED].

| If I want to change… | Start here | Then inspect |
|---|---|---|
| Login | `apps/api/src/auth/auth.controller.ts` | `auth.service.ts`, `token.service.ts`, `session-cookies.ts`, `login-rate-limiter.service.ts`, test `auth.e2e-spec.ts` |
| Google login | `apps/api/src/auth/google/google-auth.controller.ts` | `google-auth.service.ts`, `google-oidc.client.ts`, test `google-auth.e2e-spec.ts` |
| Permissions / roles | `packages/shared/src/permissions.ts` | `apps/api/src/access/policy.service.ts`, `permissions.guard.ts`, `require-permission.decorator.ts` |
| Students | `apps/api/src/users/students.controller.ts` | `students.service.ts`, `students-import.service.ts`, `apps/web/app/(app)/students/`, test `academics.e2e-spec.ts` |
| Teachers | `apps/api/src/users/teachers.controller.ts` | `teachers.service.ts`, `apps/web/app/(app)/teachers/` |
| Guardians | `apps/api/src/users/guardians.controller.ts` | `guardians.service.ts`, `apps/web/app/(app)/children/`, tests `guardian-*` |
| Account suspend/archive | `apps/api/src/users/users.controller.ts` | `user-lifecycle.service.ts`, test `account-lifecycle.e2e-spec.ts` |
| Courses / departments | `apps/api/src/academics/academics.controllers.ts` | `courses.service.ts`, `departments.service.ts` |
| Sections & enrollment | `apps/api/src/academics/sections.service.ts` | `apps/web/app/(app)/sections/`, test `academics.e2e-spec.ts` |
| Terms / academic years | `apps/api/src/academics/calendar.service.ts` | `term-lifecycle.service.ts`, tests `calendar-lifecycle`, `term-lifecycle` |
| Term rollover | `apps/api/src/academics/rollover.service.ts` | `apps/web/app/(app)/calendar/rollover/[termId]/`, test `term-rollover.e2e-spec.ts` |
| Assignments | `apps/api/src/assignments/assignments.service.ts` | `assignments.controller.ts`, `apps/web/app/(app)/assignments/` |
| Submissions | `apps/api/src/assignments/assignments.service.ts` (`submit`, `grade`) | `packages/shared/src/schemas/assignments.ts` |
| Attendance | `apps/api/src/attendance/attendance.service.ts` | `apps/web/app/(app)/attendance/`, test `timetable-attendance.e2e-spec.ts` |
| Exams | `apps/api/src/exams/exams.service.ts` | `exams.controller.ts`, `apps/web/app/(app)/exams/` |
| Marks | `apps/api/src/exams/exams.service.ts` (`saveMarks`, `publish`) | `packages/shared/src/schemas/exams.ts` |
| Grade bands | `apps/api/src/exams/exams.service.ts` (`updateGradeBands`) | `apps/web/app/(app)/settings/`, test `m24-w3b-lifecycle-integrity` |
| Finalized results / transcripts | `apps/api/src/exams/results-finalization.service.ts` | `apps/web/app/(app)/results/`, test `results-finalization.e2e-spec.ts` |
| Timetable | `apps/api/src/timetable/timetable.service.ts` | `apps/web/app/(app)/timetable/` |
| Fees | `apps/api/src/fees/fees.service.ts` | `fees.controller.ts`, `money.ts`, `apps/web/app/(app)/fees/` |
| Payments / refunds | `apps/api/src/payments/payments.service.ts` | `refunds.service.ts`, `safepay.adapter.ts`, `payments-webhook.controller.ts` |
| Finance documents | `apps/api/src/fees/finance-documents.service.ts` | `apps/web/app/(app)/fees/documents/` |
| Files | `apps/api/src/files/files.controller.ts` | `storage.adapter.ts`, `url-signer.service.ts`, `stored-file-authz.service.ts`, `evidence-authz.service.ts` |
| Exports (CSV) | `apps/api/src/exports/exports.module.ts` | `apps/api/src/common/csv.ts`, `apps/web/components/export-csv-button.tsx` |
| Community | `apps/api/src/community/community.services.ts` | `posts.service.ts`, `groups.service.ts`, `community-access.policy.ts` |
| Moderation | `apps/api/src/community/moderation.service.ts` | `moderation.controller.ts`, `apps/web/app/(app)/moderation/` |
| Notifications | `apps/api/src/notifications/listeners/` | `notification-scheduler.service.ts`, `notification-mailer.service.ts`, `templates.ts` |
| Audit logs | `apps/api/src/audit/audit.service.ts` | `changed-fields.ts`, `audit.controller.ts`, test `audit-viewer.e2e-spec.ts` |
| Database structure | `apps/api/prisma/schema.prisma` | `apps/api/prisma/migrations/` — **schema/migration changes need explicit authorization** |
| Frontend UI | `apps/web/app/(app)/<area>/page.tsx` | `apps/web/components/`, `apps/web/lib/api/client.ts` |
| An API route | the module's `*.controller.ts` | matching `*.service.ts`, plus a schema in `packages/shared/src/schemas/` |
| Authorization | `packages/shared/src/permissions.ts` | `apps/api/src/access/policy.service.ts` |
| Tenant isolation | the service's first `findFirst({ where: { id, collegeId: user.collegeId } })` | `apps/api/src/access/authenticated-user.ts` |
| Validation rules | `packages/shared/src/schemas/*.ts` | `apps/api/src/common/pipes/zod-validation.pipe.ts` (remember to rebuild shared) |
| Tests | `apps/api/test/` | `apps/api/test/test-app.ts`, `apps/api/jest.config.js` |
| Docker | `docker-compose.alloy.yaml` (dev) | `docker-compose.prod.yaml`, `apps/api/Dockerfile`, `apps/web/Dockerfile` |
| Backups | `scripts/backup/backup-cycle.sh` | `OPERATIONS.md` §28 |

---

## 22. How to Read CampusOS

Recommended order for a newcomer:

```
1. Frontend        see what the product does      apps/web/app/(app)/
2. API routes      see the contract               *.controller.ts decorators
3. Controllers     see validation + permission    @RequirePermission, ZodValidationPipe
4. Authorization   see the rules                  packages/shared/src/permissions.ts + access/policy.service.ts
5. Services        see the business logic          *.service.ts
6. Prisma          see the queries                 prisma.* calls inside services
7. Database        see the shape                   apps/api/prisma/schema.prisma
8. Tests           see the intended behaviour      apps/api/test/*.e2e-spec.ts
9. Docs            see the decisions               docs/
```

### Worked example — follow "Assignments" end to end

```
apps/web/app/(app)/assignments/[id]/page.tsx          the screen
        ↓  it calls apiFetch('/assignments/:id/submissions', …)
apps/web/lib/api/client.ts                            single HTTP wrapper
        ↓  POST /api/v1/assignments/:id/submissions
apps/api/src/assignments/assignments.controller.ts    @RequirePermission(ASSIGNMENTS_SUBMIT)
        ↓  body validated by packages/shared/src/schemas/assignments.ts
apps/api/src/assignments/assignments.service.ts       term guard, enrollment check, isLate
        ↓  prisma.submission.upsert(...)  inside $transaction
apps/api/prisma/schema.prisma                         models Assignment, Submission
        ↓
apps/api/test/assignments.e2e-spec.ts                 what the rules are supposed to be
```

**Two habits worth copying** when you add a feature:
1. Put the validation schema in `packages/shared` so the browser and the API agree.
2. Make the service's **first** query tenant-scoped (`collegeId: user.collegeId`) and
   return `404` — never `403` — for another college's row.

---

## 23. Architectural Complexity Hotspots

These are the places where changes are riskiest. I distinguish clearly between
**existing documented findings** and **inherent complexity**.

| Area | Why complex | Existing documented findings |
|---|---|---|
| **Authorization** | Two guards + `PolicyService` + a "list-level contract" that requires services to narrow queries themselves. Forgetting to narrow silently over-shares. | N-28 (`DEPARTMENT` scope unused); N-32 (no dedicated suite for `src/access`) |
| **Tenancy** | 27 of 57 models have no `collegeId`; their boundary depends on remembering the parent predicate. | N-1 (fixed in W1) is exactly this class; N-10 (login lookup) **[NOT ADDRESSED]** |
| **Transactions / concurrency** | Money paths are locked; several academic write paths are guarded but the lock is released before the write. | **N-3** (26 sites), **N-4** (capacity TOCTOU), **N-16b** — all **[NOT ADDRESSED]** (W3a) |
| **Term lifecycle & rollover** | `rollover.execute` is one long transaction: lock, CAS claim, two passes, conditional source mutation. Interacts with CLOSED-term rules everywhere. | N-2, N-15 fixed in W3b; source-term read is unlocked by design (locking deferred to W3a) |
| **File authorization** | Five separable concerns; `purpose` is stored but not used for authorization; grandfathered keys fail open. | **N-7, N-8, N-9, N-22, N-23-download, Res-1** — all **[NOT ADDRESSED]** |
| **Grade bands vs published results** | Labels resolve at **read** time, so configuration changes are retroactive for live results (finalized snapshots are immune). | N-11 coverage half closed in W3b; **retroactive guard deferred to M25 (O-5)** |
| **Authentication / session lifecycle** | Access tokens are stateless; refresh families rotate with reuse detection; suspension relies on a fresh DB read per request. | Documented limitations: access tokens survive logout ≤15 min; login timing side channel; in-memory per-process rate limiting |
| **Background jobs** | Cron sweeps run in every replica with read-then-emit dedup and no distributed lock. | **N-12** — **[NOT ADDRESSED]** (W3c) |
| **No CI** | Nothing runs the 58 suites automatically. | **O-H** — **[NOT ADDRESSED]** |

---

## 24. Beginner Glossary

| Term | Plain meaning (as used in CampusOS) |
|---|---|
| **API** | The backend's HTTP interface. Here everything lives under `/api/v1`. |
| **Controller** | The class that maps a URL to a function. Does validation + permission declaration, then delegates. |
| **Service** | Where business rules live (`*.service.ts`). Controllers stay thin; services do the work. |
| **DTO / schema** | The shape of allowed input. CampusOS uses **Zod schemas** in `packages/shared/src/schemas/` instead of class-based DTOs. |
| **Prisma** | The ORM: typed JavaScript queries instead of raw SQL. `prisma.user.findFirst(...)`. |
| **PostgreSQL** | The relational database that stores everything. |
| **ORM** | Object-Relational Mapper — translates between objects in code and rows in tables. |
| **Migration** | A recorded, ordered change to the database structure. CampusOS has 15. |
| **Transaction** | A group of statements that all succeed or all fail. `prisma.$transaction(...)`. |
| **Row lock** | Reserving one row so concurrent requests queue. `SELECT … FOR UPDATE` (exclusive) / `FOR SHARE` (shared). |
| **Advisory lock** | A named lock not tied to a row — used per-college for document numbering and account lifecycle. |
| **Tenant** | An isolated customer. In CampusOS a tenant is a **College**. |
| **Multi-tenancy** | One system serving several tenants while keeping their data strictly separate. |
| **Authentication** | Proving *who you are* (login, tokens). |
| **Authorization** | Deciding *what you may do* (permissions, scopes). |
| **Permission** | A named capability, e.g. `results.read`. 38 exist. |
| **Scope** | Which rows a permission covers: `ALL`, `ASSIGNED`, `OWN`, `CHILD`. |
| **Policy** | The rule engine: `PolicyService.can()` / `scopeFor()`. |
| **Guard** | Code that runs before a controller and can reject the request (`JwtAuthGuard`, `PermissionsGuard`). |
| **Interceptor / filter** | Wrap responses/errors — here `EnvelopeInterceptor` and `GlobalExceptionFilter`. |
| **Refresh token** | A long-lived opaque secret in an httpOnly cookie used to obtain new short-lived access tokens; only its hash is stored. |
| **Access token** | A short-lived JWT sent as `Authorization: Bearer …`; carries no permissions. |
| **Audit log** | Append-only record of who did what, when (`AuditLog`). |
| **E2E test** | A test that drives the real app over real HTTP against a real database. |
| **Monorepo** | One repository holding several projects (`apps/api`, `apps/web`, `packages/shared`). |
| **Envelope** | The uniform response shape: `{ data }` on success, `{ error: { code, message } }` on failure. |
| **TOCTOU** | "Time-of-check to time-of-use" — a check becomes stale before the action, allowing a race. |

---

## 25. Final Architecture Map

```
                                CAMPUSOS  (monorepo)
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
     FRONTEND                    SHARED CONTRACTS                    BACKEND
     apps/web                    packages/shared                     apps/api
   Next.js 14 (App Router)   Zod schemas · types · enums          NestJS 10
   47 pages, (auth)+(app)    permissions.ts (38 perms / 73        26 modules
   middleware.ts = routing   grants / 5 roles / 4 used scopes)    192 routes
   hint only, NOT security          │        │
        │                           │        │
        │  lib/api/client.ts        │        │  imported by both apps
        └──── HTTP /api/v1 ─────────┴────────┴──────────► main.ts
                                                            │
                                        ┌───────────────────▼───────────────────┐
                                        │  requestContextMiddleware (req id)    │
                                        ├───────────────────────────────────────┤
                                        │  JwtAuthGuard      AUTHENTICATION     │
                                        │   fresh DB read; non-ACTIVE rejected  │
                                        ├───────────────────────────────────────┤
                                        │  PermissionsGuard  AUTHORIZATION      │
                                        │   @RequirePermission → PolicyService  │
                                        │   (no decorator ⇒ service must check) │
                                        ├───────────────────────────────────────┤
                                        │  Controller  + ZodValidationPipe      │
                                        ├───────────────────────────────────────┤
                                        │  Service                              │
                                        │   1. TENANCY: where collegeId =       │
                                        │      user.collegeId  → else 404       │
                                        │   2. business rules / term guards     │
                                        │   3. $transaction (+ FOR UPDATE /     │
                                        │      FOR SHARE / advisory lock)       │
                                        │   4. audit.logAtomic(...) last        │
                                        ├───────────────────────────────────────┤
                                        │  Prisma Client                        │
                                        ├───────────────────────────────────────┤
                                        │  PostgreSQL 16                        │
                                        │  57 models · 42 enums · 15 migrations │
                                        └───────┬───────────────────┬───────────┘
                                                │                   │
                              EnvelopeInterceptor /          AuditLog (append-only)
                              GlobalExceptionFilter          88 action names
                                                │
                                        { data } / { error }
                                                │
                                          back to the browser

   VERIFIED BY:  apps/api/test/  — 58 suites, 800 tests, real HTTP + real PostgreSQL
   RUN BY:       docker compose  — postgres · uploads-init · backup · api · web
   RECORDED IN:  docs/           — history · operations runbook · M16–M24 design docs
```

---

### Closing notes

- The two rules to internalise: **authorization goes through `PolicyService`**, and
  **`collegeId` always comes from the server-side session**.
- Before changing a business rule, read its e2e suite in `apps/api/test/` — the tests
  are the most precise statement of intended behaviour in this repository.
- Before assuming something is finished, check the footer of
  `docs/CAMPUSOS_DEVELOPMENT_HISTORY.md` and the disposition tables in
  `docs/M24_PLATFORM_DISCOVERY_DESIGN.md`. **M24 is still OPEN**: W3a, W3c and W4
  have not been executed, and the W2 remainder is deferred.
