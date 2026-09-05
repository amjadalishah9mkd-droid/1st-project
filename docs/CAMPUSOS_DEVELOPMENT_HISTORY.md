# CampusOS Development History

> Living record of how CampusOS was designed, implemented, tested, secured and
> evolved — milestone by milestone. Primary sources: the git history, Prisma
> migrations, the test suite, and the per-milestone completion reports.
> This document is updated after every milestone and never rewrites history.

---

## 1. Project Vision

**CampusOS** is a unified digital platform for colleges: administrators,
teachers and students share one professional SaaS workspace covering
academics, attendance, assessment, fees, and a private campus community.

- **Original purpose**: replace fragmented spreadsheets, paper registers and
  ad-hoc chat groups with a single, secure, role-aware system built to a
  written specification (the *CampusOS Final Technical Blueprint v1.0*, the
  source of truth for architecture decisions).
- **Target users**: college admins (operations, fees, moderation), teachers
  (teaching workload, attendance, grading), students (learning, results,
  fees, community), with parents/guardians as a future audience.
- **Long-term goal**: evolve from a single-college MVP into a
  production-ready multi-college platform, and eventually a broader
  city-wide education platform serving schools and campuses at scale. The
  tenant-safe data model (`collegeId` on every aggregate root) was chosen on
  day one so this evolution never requires a rewrite.

## 2. Development Philosophy

Principles applied consistently from M0 onward:

- **Tenant isolation** — every aggregate root carries `collegeId`; services
  filter by the session's college; cross-tenant access yields 404s that leak
  nothing.
- **Permission-driven authorization** — a shared permission catalog and
  role→permission matrix (`packages/shared/src/permissions.ts`) seeded into
  the database; **PolicyService** (`can()` / `scopeFor()` with
  OWN/ASSIGNED/DEPARTMENT/ALL scopes) is the only authorization mechanism.
- **Zero hardcoded role authorization** — no `user.role === 'ADMIN'`
  conditionals anywhere; behavior branches on permissions or data.
- **Modular NestJS architecture** — one module per domain, global guards
  (authenticate → authorize), uniform `{data, meta}` / `{error: {code,
  message, details}}` envelopes.
- **Shared validation** — Zod schemas in `packages/shared` are the single
  validation source for API and web.
- **PostgreSQL + Prisma** — cuid PKs, `createdAt/updatedAt` everywhere,
  composite unique constraints scoped by college, deliberate delete policies
  (Restrict on academic/financial references, Cascade on pure children,
  SetNull on optional actors). Security-critical invariants live in the
  database itself (unique and partial-unique indexes), not in application
  checks.
- **Typed domain events + notification architecture** — services emit typed
  `DomainEvent`s after commit; listeners render templates into a
  notification inbox; scheduled sweeps handle time-based events.
- **Security-first design** — generic enumeration-safe errors, hashed
  tokens at rest, rotation, signed URLs, rate limiting, audit logging.
- **Test-driven verification** — every milestone ships e2e tests against a
  live PostgreSQL; the whole suite must stay green before a milestone is
  accepted.
- **Docker/Alloy development environment** — the checked-in
  `docker-compose.alloy.yaml` (postgres/api/web, host networking) is the
  canonical dev environment with a browser preview; every milestone is also
  manually verified there.
- **Incremental milestones** — small, independently verifiable milestones
  and workstreams, each with its own commit, report, and stop-for-approval
  gate.

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS (`apps/web`, port 3000) |
| Backend | NestJS REST API under `/api/v1`, TypeScript (`apps/api`, port 4000) |
| Database | PostgreSQL 16 |
| ORM | Prisma (migrations as the schema history) |
| Authentication | Argon2id password hashes; 15-min JWT access tokens; rotating opaque refresh tokens (SHA-256 hashed at rest) in httpOnly cookies; Google OIDC (M11, additive) |
| Authorization | PolicyService + database-seeded role→permission matrix; global JwtAuthGuard → PermissionsGuard |
| Validation | Zod schemas shared via `packages/shared` |
| File storage | Local filesystem adapter with S3-shaped interface; HMAC-signed expiring download URLs |
| Notifications | `@nestjs/event-emitter` typed domain events → listeners → DB-backed inbox; `@nestjs/schedule` daily sweeps |
| Testing | Jest + supertest e2e suites (`apps/api/test/*.e2e-spec.ts`) run `--runInBand` against live Postgres |
| Docker | `docker-compose.alloy.yaml` (dev, host networking); `docker-compose.prod.yaml` + production Dockerfiles (`apps/api/Dockerfile`, `apps/web/Dockerfile`) |
| Deployment/preview | Alloy sandbox proxying the web app at `http://localhost:8080` |

## 4. Complete Milestone Timeline

| Milestone | Name | Commit |
|---|---|---|
| — | Initial commit / Alloy dev environment | `638ceb8`, `bc7cd63`, `d890daa` |
| M0 | Foundation | `e05785c` |
| M1 | Auth & Access | `51f7ea3` |
| M2 | Academic Core (people & structure) | `12ee991` |
| M3 | Timetable & Attendance | `2dc57f3` |
| M4 | Assignments & Files | `ee47c54` |
| M5 | Exams & Results | `f8c8252` |
| M6 | Fees | `e0e2b59` |
| M7 | Community | `5260fac` |
| M8 | Moderation, Notifications & Announcements | `395fdd5` |
| M9 | Dashboards & Hardening | `eb833f7` |
| M10-W3 | Production security/config hardening | `9c3c4b0` |
| M10-W1 | Signed expiring file downloads | `5d35c5f` |
| M10-W2 | Invitation & password-reset tokens | `86e9c96` |
| M10-W4 | Production seed safety guard | `31e653f` |
| M10-W5 | Operations runbook + final verification | `48f7185` |
| M11-W1 | Identity & verification foundation | `2581a21` |
| M11-W2 | Google OIDC core | `768fb05` |
| M11-W3 | Identity claims + evidence API | `51069ab` |
| M11-W4 | Verified student onboarding / invitation integration | `7901d18` |
| M11-W5 | Student onboarding UI + lifecycle gate | `b33af5f` |
| M11-W6 | Admin verification queue UI | `6d7984d` |
| M11-W7 | Cutover + production hardening | `f9632a4` |
| M12-W1 | Email foundation | `cd0005c` |
| M12-W2 | Notification email channel + opt-out | `3433959` |
| M12-W3 | Report cards & CSV exports | `0adaad2` |
| M12-W4 | Admin audit log viewer | `6a7d712` |
| M13-H0 | Post-M12 hardening (F1/F4) | `d55a3d5` |
| M13-W1 | Guardian foundation | `8a8e698` |
| M13-W2 | Guardian onboarding & link lifecycle | `a1d14e9` |
| M13-W3 | Child-scoped data APIs | `7d1e541` |
| M13-W4 | Guardian portal UI | `789e123` |
| M13-W5 | Guardian hardening & M13 close-out | `7b03fed` |
| M14-W0 | P2 security hardening (pre-payments gate) | `ded32ee` |
| M14-W1 | Payments data model & settlement core | `d7ca39a` |
| M14-W2 | Gateway adapter & payment initiation | `24e9609` |
| M14-W3 | Webhook settlement & verification | `ca5585e` |
| M14-W4 | Student payment UI | `362cf2d` |
| M14-W5 | Admin reconciliation | `ad5188b` |
| M14-W6 | Payments hardening & M14 close-out | `e228fd9` |
| M14-SBX | Real Safepay sandbox verification & adapter fixes | `ce6fce0` |
| M15-W1 | Academic calendar UI & lifecycle invariants | `b40dbc0` |
| M15-W2 | Term rollover engine | `07285d3` |
| M15-W3 | Rollover wizard UI + semester-boundary walkthrough | `db8111c` |
| M15-W4 | M15 close-out: rollover runbook, security audit, verification | `229d522` |
| M16-W0 | Refunds design doc + live Safepay refund probe | `d2d6e52` |
| M16-W1 | Refund schema + accountant role foundation | `4aa9a9e` |
| M16-W2 | Refund engine: service, endpoints, net accounting, adversarial suite | `c7a44a9` |
| M16-W3 | Live Safepay sandbox verification of the refund engine | `2ab583c` |
| M16-W4 | Refund UI + accountant journey | `57d60f3` |
| M16-W5 | Refund CSV, operations runbook, security re-audit — M16 close-out | `d348c9f` |
| M17-W0 | Term lifecycle design (`docs/M17_TERM_LIFECYCLE_DESIGN.md`) | `d53895c` |
| M17-W1 | Term lifecycle foundation: TermStatus, close/reopen, rollover hook | `4a1093f` |
| M17-W2 | CLOSED-term enforcement + netPaid consolidation (DEFECT-1 fixed) | `78210b2` |
| M17-W3 | Lifecycle UI, rollover close offer, guardian refund read, accountant landing | `cc6599f` |
| M17-W4 | M17 close-out: security audit, term-lifecycle runbook | `3a30b82` |
| M18-W0 | Academic records design (`docs/M18_ACADEMIC_RECORDS_DESIGN.md`) | `9c4f31c` |
| M18-W1 | Result finalization foundation: TermResult/CourseResult, finalize/amend engine | `c555035` |
| M18-W2 | Report-card + transcript engines, batch finalization, VOID | `68ad6a8` |
| M18-W3 | Academic records UI: term report card + transcript + print | `7f0062b` |
| M18-W4 | M18 close-out: security audit, academic-records runbook | `3ca22e1` |
| M19-W0 | Platform hardening discovery + design (`docs/M19_PLATFORM_HARDENING_DESIGN.md`) | `fb6c474` |
| M19-W1 | Stored-file ownership authorization (P2-IDOR-1, migration #13) | `7fdec0e` |
| M19-W2 | Input & guardian-privacy hardening (mail escaping, callback limiter, O-2) | `9b19017` |
| M19-W3 | Operational reliability: backup automation, restore drill, /health/ops | `d726952` |
| M19-W4 | Final security audit, runbook close-out — **M19 CLOSED** | `cd7b10c` |
| M20-W0 | Finance documents discovery + design (`docs/M20_FINANCE_DOCUMENTS_DESIGN.md`) | `c491c00` |
| M20-W1 | Finance document foundation (migration #14, issuance engine) | `857d680` |
| M20-W2 | Finance document read API + authorization hardening | `c455031` |
| M20-W3 | Finance document UI, print experience, receipt mail links | `edd4b8d` |
| M20-W4 | Finance documents hardening, runbook §29 — **M20 CLOSED** | `12a7eca` |
| M21-W0 | Platform discovery + M21 design (`docs/M21_PLATFORM_DISCOVERY_DESIGN.md`) | `c907026` |
| M21-W1 | Account lifecycle administration (migration #15, verb endpoints) | `0f613f1` |
| M21-W2 | Settings completion, threshold surfacing, locale disposition | `492b8f9` |
| M21-W3 | Account lifecycle admin UI + browser verification | `2da1d03` |
| M21-W4 | Lifecycle hardening re-audit, runbook §30 — **M21 CLOSED** | `41fc42b` |
| M22-W0 | Production-readiness discovery + design (`docs/M22_PLATFORM_DISCOVERY_DESIGN.md`) | `b7fcbcc` |
| M22-W1 | Request correlation + safe structured operational logging | `7f59346` |
| M22-W2 | Truthful readiness + bounded instance-local counters | `373faa0` |
| M22-W3 | Production backup/deployment parity + operational hardening | `2a5808d` |
| M22-W4 | Runtime reliability hardening, runbook §31 — **M22 CLOSED** | `116127d` |
| M23-W0 | Platform discovery + M23 design (`docs/M23_PLATFORM_DISCOVERY_DESIGN.md`) | `ac25eec` |
| M23-W1 | Enforce ASSIGNED scope for finalized results (S-1, HIGH) | `9c46336` |
| M23-W2 | Audit integrity for the S-2 mutation surface | `6c1c3fb` |
| M23-W3 | Data integrity: D-4 fee consistency, D-1 export filter, D-2 gradePoint | `c7839bf` |
| M23-W4 | Final re-audit, regression, close-out — **M23 CLOSED** | `52e817f` |
| M24-W0 | Platform discovery + M24 design (`docs/M24_PLATFORM_DISCOVERY_DESIGN.md`) | `5abdbeb` |
| M24-W1 | Input validation & tenancy hardening (N-1 HIGH, N-5, N-13, N-25) | *(this commit)* |

*(M10 was deliberately executed in the order W3 → W1 → W2 → W4 → W5: the
config/env hardening of W3 provided the `FILE_URL_SECRET` plumbing that W1
and later workstreams depend on.)*

## 5. M0–M10 Historical Record

### M0 — Foundation
#### Goal
Stand up the monorepo and everything later milestones build on.
#### What Was Implemented
npm-workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`); the
complete Prisma schema for the Blueprint domain model in a single `init`
migration; idempotent system seed (permissions, role matrix, college
bootstrap) and demo seed (3 demo accounts + sample data); NestJS API
bootstrap with envelope interceptor and global exception filter; Next.js
web shell.
#### Database
Migration `20260820164746_init` — the full domain schema (identity/access,
academic structure, attendance, assignments, exams, fees, community,
moderation, notifications, audit).
#### Verification
Alloy Docker stack (postgres/api/web) with browser preview.
#### Commit
`e05785c`

### M1 — Auth & Access
#### Goal
Authentication and the authorization backbone.
#### What Was Implemented
`POST /auth/login|refresh|logout|change-password`, `GET /me`; JWT access
tokens (15 min, kept in web memory); rotating opaque refresh tokens hashed
(SHA-256) in the `RefreshToken` table with token families and reuse
detection; httpOnly cookies `cos_refresh` (path-scoped to `/api/v1/auth`)
and `cos_auth` (routing-hint only: role + mustChangePassword); forced
password change (`mustChangePassword` pinning); per-account login rate
limiting; **PolicyService** RBAC resolving grants from the database on
every request (never from the JWT); global guard chain; Next.js middleware
consuming the hint cookie with the shared route→permission map.
#### Security
Generic `INVALID_CREDENTIALS` (no enumeration), hashed refresh tokens,
rotation + family revocation, rate limiting, audit of login success/failure.
#### Authorization
Full permission catalog + `ROLE_PERMISSION_MATRIX` seeded; permissions
resolved from DB so matrix edits take effect without re-login.
#### Commit
`51f7ea3`

### M2 — Academic Core
#### Goal
People and academic structure.
#### What Was Implemented
Departments, courses, terms/academic years, sections; students and teachers
(profiles 1:1 with users); enrollment and teaching assignments; CSV student
import; scoped, searchable, paginated lists; section hub; web UI kit
(tables, dialogs, forms); demo dataset. Student/teacher creation initially
returned temporary passwords — later replaced by invitation links in
M10-W2 (recorded there; history preserved).
#### Commit
`12ee991`

### M3 — Timetable & Attendance
#### What Was Implemented
Timetable slot CRUD with conflict detection; role-aware timetable views;
idempotent class-session generation; bulk attendance marking with absence
notification rows; attendance summaries.
#### Commit
`2dc57f3`

### M4 — Assignments & Files
#### What Was Implemented
Assignment lifecycle (draft → publish → submit → grade) with late policy;
the **files module** (local storage adapter with S3-shaped interface,
unguessable keys, filename sanitization); notifications on publish/grade;
role-specific UI. Also fixed a single-flight refresh race in the web client.
File downloads were plain internal URLs at this stage — signed expiring
URLs arrived in M10-W1 (evolution recorded there).
#### Commit
`ee47c54`

### M5 — Exams & Results
#### What Was Implemented
Exams/papers CRUD; marks grid with locking; atomic result publish +
notifications; result cards with grade bands; analytics; grade-band
management.
#### Commit
`f8c8252`

### M6 — Fees
#### What Was Implemented
Fee structures with components; invoice generation with line-item
snapshots; manual payment recording with a status engine
(PENDING/PARTIAL/PAID/OVERDUE/CANCELLED); lazy overdue transitions;
summaries; notifications.
#### Commit
`e0e2b59`

### M7 — Community
#### What Was Implemented
Posts/comments/likes with counters; groups with request flow and
moderators; societies with officers; events with RSVP and capacity;
resources with download counts; suspension gate for participation;
notifications.
#### Commit
`5260fac`

### M8 — Moderation, Notifications & Announcements
#### What Was Implemented
Report flow with admin queue and moderation actions (including suspension
and reporter immunity); notification inbox + live bell; audience-scoped
announcements with fan-out; daily scheduled sweeps (assignment due-soon,
invoice overdue, event reminders).
#### Commit
`395fdd5`

### M9 — Dashboards & Hardening
#### What Was Implemented
Role dashboards with live aggregates; exam analytics UI; fee structure
editing; amount formatting; instant bell refresh; batched event queries; a
security audit pass (PASS) over the whole MVP.
#### Testing
Suite stood at **141 tests** after M9 (per the M10 baseline report; earlier
per-milestone counts were not individually recorded in this document's
sources).
#### Commit
`eb833f7`

### M10 — Production Hardening (five workstreams)

#### M10-W3 — Production security/config hardening (`9c3c4b0`)
Helmet security headers (+ `x-powered-by` off, trust proxy); production
CORS allowlist (`CORS_ORIGINS`, deny-by-default in prod); Zod environment
validation (`apps/api/src/config/env.ts`) with production fail-fast on
missing/short (≥32 char) `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` /
`FILE_URL_SECRET`; interceptor-level upload limits (10 MB files, 1 MB CSV);
production Dockerfiles + `docker-compose.prod.yaml` + env template;
`.alloy/populate-env.sh` rewritten. Tests: **151** (10 new).

#### M10-W1 — Signed expiring file downloads (`5d35c5f`)
Problem: any authenticated user's browser link to `/files/:key` was a
permanent unauthenticated URL. Solution: HMAC-SHA256 signature over
`key|exp` with timing-safe verify; `POST /files/sign` (internal URLs only)
issues 5-minute links; `GET /files/:key` enforces `exp`+`sig`
(`SIGNATURE_REQUIRED` / `LINK_EXPIRED` / `INVALID_SIGNATURE`); web
`openFile()` helper replaced every raw download href. Tests: **160**
(9 new + updated round-trip). Verified byte-identical downloads in Alloy.

#### M10-W2 — Invitation & password-reset tokens (`86e9c96`)
Problem: student/teacher creation returned plaintext temporary passwords.
Solution: `CredentialToken` model (INVITE 48 h / RESET 24 h), 256-bit random
tokens stored **only as SHA-256 hashes**, one-time acceptance via atomic
`updateMany` claim (concurrency-safe), issuing revokes prior active tokens;
`POST /auth/accept-invite` / `POST /auth/reset-password`; admin
`POST /users/:id/reset-link` (users.manage, college-scoped); accounts are
created with an unusable random password; invite URLs replaced temp
passwords in create + CSV import; web accept-invite page + invite/reset
dialogs. Migration `20260822062836_credential_tokens`. Tests: **172**
(12 new). Full manual Alloy flow verified (create → invite → accept →
login → reuse rejected → reset link → old link invalid).

#### M10-W4 — Production seed safety guard (`31e653f`)
Demo seed (publicly documented passwords) is refused when
`NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is set explicitly; loud
refusal banner; system seed unaffected; pure decision function + seed-CLI
tests. Tests: **181** (9 new). Discovery recorded: Prisma auto-loads
`apps/api/.env`, so the guard also protects hosts that accidentally ship a
dev `.env`.

#### M10-W5 — Operations runbook + final verification (`48f7185`)
`docs/OPERATIONS.md` (deployment, env/secret generation + rotation,
migration order, pg_dump + uploads backup/restore, health checks,
troubleshooting, restart/update, demo-seed prohibition, signed-URL and
token behavior, rollback) + README link. Full verification battery:
181/181 tests, typecheck clean, production images built, prod-boot
fail-fast without secrets, prod CORS allow/deny verified, no
tempPassword/raw-href/secret leftovers. **M10 accepted; checkpoint at
`48f7185`.**

## 6. M11 — Identity & Verification Evolution

M11 began with an inspection-only architecture phase producing the
**M11 Blueprint Rev. B** (Google-only student authentication as the end
state, student identity verification, duplicate-account prevention), plus
locked decisions D1–D7 (public college list; self-registration off by
default per college; no account merging in v1 — reject with guidance;
mandatory evidence + 30-day retention after approval; explicit
"use Google" messaging only under strict conditions; per-college cutover
with configurable grace period).

### M11-W1 — Identity & verification foundation (`2581a21`)
- **AuthIdentity**: Google `sub` as the immutable provider identity key;
  `@@unique([provider, providerSub])` (one Google account = one CampusOS
  user, globally) and `@@unique([userId, provider])`.
- **StudentIdentityClaim** with PostgreSQL **partial unique indexes** (raw
  SQL in the migration): `UNIQUE(studentProfileId) WHERE status IN
  ('PENDING','APPROVED')` and `UNIQUE(userId) WHERE status='PENDING'` —
  duplicate-account prevention lives in the database, immune to races.
- `User.passwordHash` made nullable (fail-closed login for password-less
  accounts); `User.verificationStatus`
  (LEGACY/UNVERIFIED/PENDING/VERIFIED/REJECTED, default LEGACY so all
  pre-M11 accounts are untouched).
- College settings schema: `googleAuth: off|additive|required`,
  `allowSelfRegistration` (default false), `googleAuthGraceDays`.
- Permissions `verification.manage` (ADMIN/ALL) and `verification.submit`
  (STUDENT/OWN) added to the shared matrix and seeds.
- Migration `20260822071747_m11_identity_foundation`.
- Tests: **192** (11 new: constraint behavior, 5-way concurrent claim race
  with exactly one winner, fail-closed null-password login, seeding,
  zero-change under `googleAuth=off`).

### M11-W2 — Google OIDC core (`768fb05`)
- Server-side authorization-code flow with **PKCE S256**, HMAC-signed
  one-time state cookie (10-min TTL, replay-refused), **nonce**, JWKS
  signature verification with kid-rotation cache; claim validation of
  issuer/audience/expiry/nonce/`email_verified`.
- Login strictly by `sub` via AuthIdentity — **email match never
  auto-links**; unknown Google accounts are refused on login intent.
- Flag-gated self-registration creating UNVERIFIED password-less students;
  idempotent re-registration; email-collision refusal without linking.
- Authenticated link/unlink: unlink refused without a fallback password
  (`UNLINK_NO_PASSWORD`) and for student-profile holders in `required`
  colleges (`GOOGLE_REQUIRED`) — data-driven, no role checks.
- Sessions issued through the existing TokenService/cookie path — no
  second session architecture; suspended users rejected by the same gate.
- Env config `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
  `OAUTH_REDIRECT_BASE` — optional, all-or-none validated; unset →
  `FEATURE_DISABLED`.
- Audit: `auth.google_login`, `auth.google_linked`, `auth.google_unlinked`.
- Tests: **221** (29 new, via a DI-injected fake OIDC client so claim
  validation and flow logic run through real production code).
- No migration required.

### M11-W3 — Identity claims + evidence API (`51069ab`)
- Purpose-restricted **EvidenceFile** uploads (`POST
  /verification/evidence`): 5 MB cap, MIME allowlist
  (JPEG/PNG/WebP/PDF) enforced by magic-byte sniffing, executables
  rejected; ordinary `/files` uploads can never be used as evidence.
- `POST /verification/claims`: evidence must be owned by the claimant;
  profile resolution strictly college-scoped; unknown and cross-college
  admission numbers produce identical enumeration-safe PENDING claims;
  live-claim conflicts map to generic `CLAIM_UNAVAILABLE` (HTTP-level race
  test: 1 winner of 3).
- `GET /verification/claims/me` (own claims only); admin queue
  `GET /verification/claims` (tenant-scoped, filter/search/pagination),
  detail with unsigned internal evidence reference, and
  `POST /verification/claims/:id/decision` — atomic PENDING→decided
  transition, `CLAIM_UNRESOLVED` for unmatched claims,
  `PROFILE_HAS_ACCOUNT` enforcing D3 (no merging), REJECT requires reason
  and frees the profile slot.
- **Evidence signing authorization** on `POST /files/sign`: for evidence
  keys, only the uploader or a `verification.manage` holder in the same
  college may obtain a signature (PolicyService-decided); everyone else
  gets 404 with no existence leak; every evidence signing is audited.
- Audit events `verification.claim_submitted/approved/rejected/
  evidence_accessed`; notifications `verification.approved/rejected` via
  the event bus, exactly-once by construction.
- Migration `20260822163204_m11_evidence_files`.
- Tests: **245** (24 new). Manual Alloy flow verified end-to-end:
  upload → claim → admin review via signed URL (byte-identical download,
  unsigned 403) → approve → student `VERIFIED`.

### M11-W4 — Verified student onboarding / invitation integration
**Goal:** give admin-created students a duplicate-proof path to VERIFIED,
through the existing M10-W2 invitation, with either credential method.

- **Core decision:** invitation possession = admin-provisioned identity
  proof (Blueprint Mode A). Acceptance — password or Google — yields
  `verificationStatus=VERIFIED` **plus a synthetic APPROVED
  StudentIdentityClaim**, so the W1 partial-unique index permanently holds
  the identity slot in PostgreSQL. Every VERIFIED identity now occupies its
  slot, whether verified by admin review (W3) or onboarding (W4).
- **User journeys:** (A) off-mode password acceptance → VERIFIED+claim;
  (B) additive mode → accept page offers Google *and* password; (C)
  required mode → Google only, password acceptance refused server-side
  (`GOOGLE_SIGNIN_REQUIRED`) with the token left valid; (D) session link by
  a LEGACY/UNVERIFIED profile owner auto-verifies; (E) **auto-supersession**
  (approved decision): accepting an invite atomically rejects an impostor's
  PENDING claim on the profile (reason: superseded by an
  administrator-issued invitation), sets the impostor REJECTED, and
  notifies them.
- **State transitions added:** LEGACY|UNVERIFIED → VERIFIED (acceptance,
  link); PENDING → REJECTED (supersession). RESET tokens and teacher/admin
  invitations unchanged (data-driven: no StudentProfile → no lifecycle).
- **API:** new `OnboardingService.applyVerification()` (single-transaction
  supersession + synthetic claim + VERIFIED); `GET /auth/invite-info`
  (public, generic errors) reporting `password|google|both` per college
  settings; OIDC `invite` intent (`GET /auth/google/start?intent=invite&
  token=…`) with the raw token carried only in the HMAC state cookie —
  never through Google; callback transaction ordered AuthIdentity →
  token-claim → onboarding so a wrong Google account (P2002) rolls back
  without consuming the invitation; `POST /auth/accept-invite` became fully
  transactional (token consumption included). No new CredentialPurpose —
  one INVITE token, one-time across BOTH methods.
- **Frontend:** `/accept-invite` fetches invite-info and renders "Continue
  with Google" and/or the password form; required mode explains the
  Google-only policy.
- **Security decisions:** token-in-state-cookie (httpOnly, signed, 10-min);
  transaction rollback keeps failed acceptances token-neutral; email match
  still never links; database partial uniques remain the final authority
  (IDENTITY_CONFLICT aborts acceptance if a foreign APPROVED claim exists).
- **Audit/notifications:** `auth.invite_accepted` gains `{method}`;
  new `verification.auto_verified` `{via: invitation|link}`; supersession
  emits `verification.claim_rejected` audit + the existing
  `verification.rejected` notification, exactly-once by construction.
- **Migration:** none required (4 migrations, unchanged).
- **Tests: 266** (21 new): both methods × three modes, one-time token
  across methods (both orders), expired invites, wrong-Google rollback
  with retry, supersession + notification, post-VERIFIED duplicate claim
  blocked (DB-final), session-link auto-verify, teacher/admin + RESET
  unaffected, cross-college integrity, IDENTITY_CONFLICT rollback,
  3-way concurrent acceptance race (one winner), CSV-import invites.
- **Alloy verification:** additive college → invite page showed both
  options signed-out; password acceptance → DB showed VERIFIED + APPROVED
  claim; duplicate claim → `CLAIM_UNAVAILABLE`; required mode hid the
  password form and the API refused it; demo accounts unaffected; demo
  data restored to canonical state.

### M11-W5 — Student onboarding UI + identity lifecycle gate
**Goal:** give unverified students a complete self-service verification
experience, and enforce the identity lifecycle server-side.

- **Server-side lifecycle gate** in PolicyService (the single authorization
  path): accounts with `verificationStatus` UNVERIFIED/PENDING/REJECTED
  resolve only `verification.submit`; all other permissions return
  null/false until verified. LEGACY and VERIFIED are untouched — zero
  behavior change for every pre-M11 account. This is lifecycle data, not a
  role conditional.
- **`AuthenticatedUser`/`/me`/hint cookie** now carry `verificationStatus`
  (`cos_auth` gains `v` — still a routing hint only).
- **Middleware pinning:** unverified-lifecycle students are routed to
  `/verify` from any app route; `/verify` itself requires a session and
  bounces verified/legacy users to the dashboard.
- **`/verify` page:** claim form (admission number + ID-card upload via the
  purpose-restricted evidence endpoint), PENDING waiting card with
  check-status, REJECTED state showing the admin's reason with resubmit,
  APPROVED state that forces a token refresh (so the hint unpins) and
  routes to the dashboard.
- **Login page:** "Continue with Google" button gated by the new public
  `GET /auth/config` (`{google: boolean}` — booleans only, never client
  IDs/secrets), plus friendly banners for Google-flow redirect errors and
  the post-activation message.
- **Migration:** none (4 migrations, unchanged).
- **Tests: 273** (7 new): gate denial for UNVERIFIED/PENDING/REJECTED,
  verification surface still allowed, VERIFIED full access, LEGACY demo
  accounts unaffected, /auth/config exposure check, hint-cookie `v` field.
  One pre-existing test helper updated for the extended AuthenticatedUser.
- **Alloy verification:** full browser walk — UNVERIFIED student login →
  pinned to /verify → claim submitted with ID upload → PENDING card →
  admin rejection → reason + resubmit → second claim → admin approval →
  "Check status" → automatic session refresh → dashboard with full student
  access. Demo accounts unaffected; test data purged.

### M11-W6 — Admin verification queue UI
**Goal:** the administrator-facing Verification Center, as a pure consumer
of the W3 API — the UI never becomes an authorization layer.

- **`/verification` page** (moderation-page pattern): queue defaulting to
  PENDING with status filter, admission-number-labeled search, pagination
  and loading/error/empty states via the existing `DataTable`/`useList`;
  columns: claimant, claimed admission no, record-match badge (matches
  claimant / another account / no matching record), submitted date, status.
- **Claim detail dialog**: claimant account vs matched StudentProfile
  comparison cards; explicit no-match panel; evidence metadata with
  "View evidence" through the existing `openFile()` authorized-signing
  flow (signed URLs never rendered or stored); "No evidence on file"
  state; decided-claim summary with reason.
- **Decisions**: Approve disabled (usability only) unless the profile
  matches and belongs to the claimant — the backend remains authoritative;
  Reject requires a reason (server-validated too); success toasts +
  queue refetch; `CLAIM_ALREADY_DECIDED` / `PROFILE_HAS_ACCOUNT` /
  `CLAIM_UNRESOLVED` / `NOT_FOUND` surface as conflict toasts with an
  automatic queue resync.
- **Navigation/routing**: `/verification → verification.manage` added to
  the shared `ROUTE_PERMISSIONS` map (drives middleware + sidebar); one
  nav entry. No role conditionals anywhere.
- **API/schema**: zero changes — no new endpoints, no migration
  (4 migrations, unchanged).
- **Tests: 278** (5 new): shared route-map contract, queue search hit/miss,
  pagination meta + page slices, status-filter purity, stale-decision
  conflict (`CLAIM_ALREADY_DECIDED`).
- **Alloy verification:** admin saw the nav entry, teacher did not and
  direct navigation bounced; queue/search/filter/detail verified in the
  browser; evidence downloaded via signed URL; unknown-admission claim
  rejected with reason (student saw it); matching claim approved →
  student VERIFIED; a decision made concurrently via API produced the
  conflict toast and queue resync; demo accounts unaffected; all test
  data (plus residue from an earlier failed suite teardown) purged.

### M11-W7 — Cutover + production hardening
**Goal:** close the remaining M11 security debt: required-mode student
cutover, rate limiting, evidence retention, and multi-instance OAuth state.

- **Required-mode cutover (R1/D6/D7):** in `googleAuth=required` colleges,
  password login is refused for accounts owning a StudentProfile
  (`403 USE_GOOGLE_LOGIN`, audited `google_required`) — data-driven, no
  role checks, ALL profile owners including LEGACY; the explicit message
  appears only after valid credentials + rate limiter (wrong passwords
  stay generic 401 — no oracle). Staff unaffected; `googleAuthGraceDays`
  documented as an operational transition window with **no hidden
  password exception**.
- **College settings (R2):** `GET/PATCH /settings/college`
  (`settings.manage`, tenant-scoped, shared-Zod validated, merge-PATCH
  preserving unknown keys, audited `settings.updated`) + minimal
  `/settings` page (mode select with explanations, self-registration
  toggle, grace days) and nav entry — the first consumer of the
  M1-seeded `settings.manage` permission.
- **Rate limiting:** new `RateLimiterService` with explicit named policies
  in one file (invite/reset 30/min/IP, invite-info 30/min/IP, google
  start 60/min/IP, evidence 15/h/user, claims 10/h/user, file upload
  60/h/user, sign 300/min/user), standard `RATE_LIMITED` 429 envelope,
  test reset hook; M1 login-failure backoff limiter unchanged. In-memory
  per instance by design (no Redis, Blueprint §14) — documented.
- **Evidence retention (R3):** `LocalStorageAdapter.delete()` (idempotent,
  path-safe) + `EvidenceRetentionService` daily 03:00 sweep: APPROVED
  +30d purged, CANCELLED purged, REJECTED retained, orphans purged after
  7 days; binary + metadata row removed, claim rows/audit history always
  preserved; every purge audited `verification.evidence_purged`
  (system, no actor); storage-first ordering converges after crashes.
- **OAuth state (R4):** new `OauthStateConsumption` table (SHA-256 state
  hash `@unique`, expiry) — consumption is an atomic insert, so replay is
  a unique violation **across all API instances**; expired rows swept
  daily. Cookie HMAC/PKCE/nonce/JWKS behavior untouched. Migration #5
  (`m11_oauth_state_consumption`), additive.
- **Migration count:** 5 (additive only).
- **Tests: 294** (16 new adversarial tests incl. cross-instance state
  replay using two live app instances on one database, per-user vs per-IP
  limit keying, disk+DB purge assertions, retention idempotence, cutover
  bypass attempts straight against the API, settings merge/audit/strict
  validation). One W2 test updated: it must now log in before switching
  the college to required — the very behavior W7 introduces.
- **Docs:** OPERATIONS.md gained cutover/grace procedure, rate-limit
  table, retention/state-hygiene sections and the purged-evidence
  rollback caveat.
- **Alloy verification:** Settings page flip to Required → demo student
  password login refused with `USE_GOOGLE_LOGIN` while teacher/admin
  unaffected; audit recorded; flipped back and all demo logins verified;
  production Docker images rebuilt successfully; demo data restored.

*(M11 is functionally complete: W1–W7 delivered.)*

## 6b. M12 — Communications & Institutional Output

### M12-W1 — Email foundation
**Goal:** transactional email delivery for the links CampusOS already
generates, without touching any token/verification semantics.

- **Mail module** (`apps/api/src/mail/`): `MailService` + `MAIL_TRANSPORT`
  DI boundary (SMTP via nodemailer — the milestone's single new
  dependency; Noop when unconfigured; capturing fake in tests — no real
  SMTP ever). Typed template registry (student/teacher invite, password
  reset, verification approved/rejected) rendering subject/text/minimal
  HTML with CRLF sanitization against header injection.
- **Feature flag** mirrors the Google pattern: `SMTP_URL` + `MAIL_FROM`
  all-or-none env pair (+ optional `APP_BASE_URL` link base with
  `OAUTH_REDIRECT_BASE` fallback); unset → zero behavior change.
- **Hooks at action sites:** student/teacher creation, CSV import
  (one mail per created row), admin reset-link issuance, and
  verification decisions via the existing listener (exactly-once
  inherited from atomic transitions). Copy-URL invite dialogs unchanged.
- **Guarantees:** mail failure never fails the business operation
  (`mail.failed` audit, generic log); audit metadata is
  `{template}` + target user only — never addresses, tokens, URLs or
  bodies.
- **Decision O4 executed:** dead `/profile` route mapping removed from
  the shared route-permission map (no page ever existed).
- **No migration** (decision O2: no MailDelivery table — audit-log-only).
  Prisma upgrade deferred (O1); notification email preference deferred to
  W2 (O3).
- **Tests: 306** (12 new: invite/reset/decision content with absolute
  links matching returned tokens, per-row import mails, header-injection
  flattening, failure isolation, audit hygiene incl. no-@/no-URL
  metadata, exactly-once on decision retry, env pair validation,
  feature-off path with zero sends, O4 contract).
- **Alloy verification:** unconfigured default — invite dialogs
  unchanged, zero `mail.*` audit rows, demo logins and preview healthy.

### M12-W2 — Notification email channel + per-user opt-out
**Goal:** email the four institutional notification categories, with one
self-service opt-out, reusing the W1 MailService untouched.

- **`NotificationMailerService`**: thin recipient-resolution layer —
  re-fetches users by id (tenant-scoped rows carry their own
  collegeId/email; client-supplied addresses are impossible), filters
  `emailOptOut=true` and inactive accounts, delegates to W1 MailService
  (Noop/fire-and-forget/audit semantics unchanged).
- **Events emailed:** `results.published`, `invoice.issued`,
  `invoice.overdue`, `announcement.published` (audience resolved by the
  existing server-side resolver, author excluded). All other events
  (community, reminders, attendance, due-soon) deliberately excluded.
  In-app notification rows are written first and are never affected by
  mail configuration, opt-out or failures.
- **Opt-out (decision O3):** `User.emailOptOut Boolean @default(false)` —
  migration #6 (`m12_email_opt_out`, additive). Suppresses notification
  email only; W1 transactional mail always ignores it (tested with a
  reset link to an opted-out user). Exposed on `/me`; updated via
  `PATCH /me/preferences` (self-only, strict Zod, audited
  `preferences.updated {emailOptOut}` — boolean only, no PII); toggle on
  the notifications page.
- **Templates:** four new kinds in the W1 registry (results, invoice
  issued/overdue, announcement) with absolute links via the W1 base-URL
  logic.
- **Tests: 314** (8 new): per-event coverage with opt-out filtering,
  adversarial cross-college announcement fan-out (rival-college user
  never mailed), excluded-event silence, transactional-mail exemption,
  self-only audited preference updates with strict schema, transport
  failure leaving in-app rows intact, unconfigured-SMTP zero-activity.
- **Alloy verification:** toggle flipped off/on as the demo student
  (DB flag + audit verified), announcement published → in-app rows for
  all recipients with zero mail activity in the unconfigured
  environment, demo logins healthy, test data purged.

### M12-W3 — Report cards & CSV exports
**Goal:** institutional output — printable per-exam report cards and
admin CSV exports — with zero schema changes.

- **Report cards (decisions A1/A2/A4):** print-CSS page
  `/results/report/[examId]` (college header, student block, per-paper
  marks, grade bands, totals, signature footer) with browser
  Print/Save-as-PDF — no PDF dependency. Data rides the existing
  `GET /results`, whose `studentId` filter already enforced scope
  correctly (OWN callers are pinned to their own record — A2 required no
  API change). Per-exam only; transcripts/GPA remain deferred (A4).
  "Report card" links added per exam on the results page; global
  `@media print` rules hide the app chrome.
- **CSV exports (decision A3):** new `exports` module —
  `GET /exports/students|attendance|fees|results.csv` with filters.
  Authorization is PolicyService-resolved **scope ALL only** (admins);
  teachers (ASSIGNED) and students (OWN) are refused — data-driven, no
  role conditionals. All queries tenant-scoped (foreign ids yield empty
  files). RFC-4180 quoting + spreadsheet formula-injection guard
  (leading = + - @ prefixed), 50k row cap (413 `EXPORT_TOO_LARGE`),
  `exports.generated` audit (name + row count only). CSV responses
  bypass the JSON envelope per the files-module precedent.
- **Frontend:** shared `ExportCsvButton` (visible only with an ALL-scope
  grant; server authoritative) on students/fees/attendance pages and
  per-published-exam on the exams page; bearer-fetch blob download
  helper.
- **Migration:** none (still 6).
- **Tests: 327** (13 new): CSV escaping/formula-guard/row-cap units,
  401/403 matrices for every endpoint (student OWN + teacher ASSIGNED
  refused), content/MIME/disposition/filters per export, **adversarial
  rival-college admin receives header-only files for every export**,
  report-card data path (ALL-scope studentId honored; OWN callers pinned
  to self).
- **Alloy verification:** admin exported students.csv through the UI
  (content verified on disk), per-exam Results CSV button present on
  published exams, report card rendered with real marks/grades/totals
  and print chrome-hiding CSS in place; production images rebuilt.

### M12-W4 — Admin audit log viewer
**Goal:** give admins a read-only window into the audit trail the
platform has been writing since M0 — completing the M12 scope.

- **Permission (decision B1):** new `audit.read` (ADMIN/ALL) in the
  shared catalog/matrix/route map — seeded idempotently, **no
  migration** (still 6). First read surface for AuditLog; the write path
  (`AuditService.log`) is untouched.
- **API:** `GET /audit` (the module's only route — read-only by
  construction): tenant-scoped, newest-first (rides the
  `[collegeId, createdAt]` index), filters for action prefix, actorId,
  inclusive from/to date window, and `q` (action substring or exact
  targetId); standard `{data, meta}` pagination; actor joined
  (SetNull-safe: system entries render actor-less).
- **Frontend:** `/audit` page — static category-prefix filter (decision
  B3), date inputs, search, badge-toned action column, actor/target/
  metadata columns, row-click metadata detail dialog (decision B2);
  "Audit log" nav entry via the shared route map.
- **Tests: 336** (9 new): 401/403 matrix, seeded-grant + route-map
  contracts, read-only contract (mutation verbs 404/405), newest-first
  ordering, every filter, pagination slices, and **adversarial tenancy**
  (rival admin sees only own rows even when filtering by foreign
  actor/target ids; demo admin can't see rival rows).
- **Alloy verification:** admin nav entry present; 218 real audit rows
  listed with pagination; detail dialog rendered actor/target/metadata;
  teacher and student `GET /audit` → 403.

### M13-H0 — Post-M12 hardening (inspection items F1 + F4)
Isolated hardening commit implementing exactly the two P2 items from the
M12 Final Deep Inspection, before any Guardian Portal work:

- **F4 — NotificationMailer tenant belt:** `sendToUsers` now takes an
  explicit `collegeId` and filters recipients by it at the query level;
  listeners anchor the value to the owning aggregate (exam / invoice /
  announcement), never to the user ids themselves. A foreign-college
  user id passed to the mailer can no longer be mailed (adversarial
  test added). W1/W2 behavior and opt-out semantics unchanged; two W2
  event fixtures updated to reference real aggregates (the hardening
  correctly rejected their synthetic ids).
- **F1 — CSV memory cap:** all four export queries now fetch at most
  `CSV_ROW_CAP + 1` rows (`take`), so the 50k cap bounds query
  materialization, not just the response. Proven end-to-end with a
  50,001-row synthetic fees export returning `413 EXPORT_TOO_LARGE`.
- **No migration** (still 6). **Tests: 338** (+2).

## 6c. M13 — Guardian Portal

### M13-W1 — Guardian foundation (decisions G1–G7 approved)
**Goal:** the identity, relationship and authorization substrate for the
guardian portal — with zero behavior change for existing roles.

- **Schema (migration #7, `m13_guardian_foundation`, additive):**
  `RoleKey + GUARDIAN`, `PermissionScope + CHILD`, and `GuardianLink`
  (guardian↔student many-to-many, `@@unique([guardianUserId,
  studentProfileId])` duplicate prevention in PostgreSQL, ACTIVE/REVOKED
  lifecycle, collegeId + createdBy/revokedAt, indexed for per-guardian
  and per-student lookups; Restrict on profile, Cascade on guardian).
- **Permissions:** seven seeded GUARDIAN grants — `guardian.children` and
  `dashboard.guardian` (OWN) plus results/attendance/fees/timetable/
  assignments `read` at the new **CHILD** scope; `/children` route
  mapping. Two new permission keys, descriptions, idempotent seed.
- **PolicyService:** `ResourceContext.studentProfileId` + `checkChild` —
  an ACTIVE GuardianLink within the caller's college, read per request
  (revocation is immediate; nothing cached). No role conditionals.
- **Tests: 348** (10 new): shared enum/matrix/route contracts, link
  P2002, CHILD grant/deny/missing-context, immediate revocation, the
  cross-college forged-link analysis proving why W2's creation invariant
  is mandatory, guardian login + grant surface + M11 lifecycle-gate
  compatibility (LEGACY), guardian denial across
  students/audit/exports/verification/settings/community/moderation,
  and an existing-roles regression guard.
- **Alloy:** stack healthy; all demo logins unchanged; 7 GUARDIAN grants
  present in the seeded matrix.

### M13-W2 — Guardian onboarding & link lifecycle (decisions H1–H6)
**Goal:** the complete invite → accept → list → revoke lifecycle, built
entirely from proven pieces (M10-W2 tokens, M12 mail, W1 CHILD scope).

- **`POST /students/:id/guardians`** (`users.manage`, rate-limited
  20/h/admin): resolves the student strictly in the admin's college;
  same-college GUARDIAN email → link-only (reactivating a REVOKED pair
  reuses the same row, H5; not-yet-onboarded guardians get a token
  reissue, onboarded ones a token-less `guardian_link_added` mail, H4);
  non-guardian email → 409 `EMAIL_IN_USE`; suspended guardian → 409
  `USER_INACTIVE`; duplicates → 409 `LINK_EXISTS` (PG unique authoritative).
  New guardians: GUARDIAN role, unusable password, mustChangePassword,
  **one transaction for user + link + INVITE token** — the creation
  invariant (guardian/profile/link same college) makes cross-tenant links
  unconstructible via the API. `guardian_invite` mail names the child as
  "FirstName L." only (H3).
- **`GET /students/:id/guardians`** — ACTIVE + REVOKED history, newest
  first, no credential data. **`DELETE …/:linkId`** — guarded
  ACTIVE→REVOKED with `revokedAt`; repeat → 409 `ALREADY_REVOKED` (H2);
  row never deleted; CHILD access dies on the next request (verified via
  a live PolicyService probe flipping true→false across the revoke).
- **`GET /guardian/children`** (`guardian.children`, H6): the caller's
  ACTIVE links only — no client-supplied ids exist in the query.
- **Admin UI (H1):** Guardians card on the student detail page (list with
  status badges, invite dialog, invite-URL dialog reuse, revoke).
- **Acceptance:** the existing `/accept-invite` flow needed **zero
  changes** — guardians ride the password path; the M11 onboarding hook
  no-ops (no StudentProfile), leaving them LEGACY with no claims.
- **Audit:** `guardian.invited/link_created/link_revoked` with ids/flags
  only. **Migration: none** (still 7).
- **Tests: 363** (15 new): auth matrices, full happy path with mail/audit
  hygiene, acceptance + replay/expiry/reissue, existing-guardian link-only
  + token-less mail, EMAIL_IN_USE, LINK_EXISTS, H5 reactivation,
  cross-college student 404 + College-B email isolation (fresh A-account,
  B untouched), rate limit 429, SMTP failure isolation, listing incl.
  rival-admin 404s, revoke semantics + immediate CHILD denial,
  multi-child/multi-guardian children matrix.
- **Alloy:** full browser walk — invite from the Guardians card → invite
  URL dialog → API acceptance → guardian login → `/guardian/children`
  returned the child → guardian 403 on `/students` → revoke in UI →
  children list empty immediately; demo regression green; data purged.

### M13-W3 — Child-scoped data APIs
**Goal:** the five read surfaces guardians care about — results,
attendance summary, fee invoices, timetable, assignments — honor CHILD
scope, with the ACTIVE GuardianLink as the sole authorizer.

- **Pattern (uniform across all five):** the service resolves the scope
  via `policy.scopeFor`; under CHILD the caller must name the child
  explicitly (`studentId` query, or `view=student:<profileId>` for
  timetable), and `policy.can(user, perm, { studentProfileId })` verifies
  an ACTIVE link in the caller's college **per request** — client input
  never selects data directly. Missing target → 400 `MISSING_TARGET`;
  unlinked/revoked/rival-college targets → 403 (invoice detail → 404,
  indistinguishable from nonexistent).
- **Publication boundaries hold:** results ride the existing
  `exam.status = 'PUBLISHED'` marks filter (guardians can never see
  draft marks); assignments mirror OWN's `publishedAt: { not: null }`.
  Attendance's per-section staff breakdown is closed to CHILD alongside
  OWN.
- **PolicyService contract refinement:** `checkChild` with *no*
  `studentProfileId` in context is now list-level-true (exactly mirroring
  `checkOwn`), so the route guard passes and the owning service performs
  the concrete child check; an explicit-but-empty id still denies. This
  is the only foundation change.
- **Timetable hole caught by the adversarial suite:** the first cut of
  `view=student:<id>` let OWN-scoped students query other students
  (list-level `checkOwn` passed). Fixed: only resolved CHILD (with a
  verified link) or ALL scopes may name another student.
- **Report card:** the guardian path works unchanged — `/results?
  studentId=<child>` returns exam-tagged rows the print page filters.
- **Migration: none** (still 7). **No W4 UI** — no guardian dashboard,
  `/children` pages, or nav changes.
- **Tests: 379** (16 new, IDOR matrix A–Q): own-child reads on all five
  surfaces, PUBLISHED-only proof against real drafts, unrelated/other-
  guardian's-child/rival-college/garbage-id denials, second-child
  isolation, multi-guardian independence, zero-link guardian shutout,
  revocation killing all five surfaces at once (other child unaffected),
  fees MISSING_TARGET + detail 404 non-leak, assignment write surface
  closed, OWN pinning/ASSIGNED/ALL regression, anon 401, guardian still
  blocked from exports/community/audit/verification.
- **Alloy:** live invite → guardian login → all five endpoints 200 for
  the linked child → admin revoke → immediate 403; smoke data purged,
  demo accounts untouched.

### M13-W4 — Guardian portal UI
**Goal:** a real guardian-facing portal on top of the W3 CHILD APIs —
zero new backend, zero new authorization logic in the frontend.

- **Guardian dashboard branch** in the existing permission-dispatched
  dashboard (`hasPermission('dashboard.guardian')` — no role names): one
  card per ACTIVE child (identity, department, relationship) with
  attendance %, latest published result and fee balance assembled
  client-side from the three CHILD APIs; each stat degrades to "—"
  independently on failure; clean empty state for zero links.
- **`/children`** — the child list straight from `GET /guardian/children`
  (ACTIVE links only, server-side; no id inputs anywhere in the UI).
- **`/children/[profileId]`** — tabbed detail (Overview / Attendance /
  Results / Fees / Timetable / Assignments), each tab a read-only view
  over its W3 endpoint (`?studentId=` / `view=student:<id>`). The child's
  identity resolves from the caller's own `/guardian/children`; an
  unlinked/revoked/bogus id gets a "Child not available" state (and every
  data call would 403 regardless). Results reuse the exam-grouped card
  layout and link to the existing `/results/report/[examId]?studentId=`
  print route. 403/404 responses render as a friendly "not available"
  error state.
- **Navigation:** `/children` ("My children") added to the shared
  implemented-routes list; a new `scopeOf` hint from the session's
  resolved grants hides generic pages whose grant scope is CHILD (the
  guardian's data lives under /children). This is grant-scope-driven —
  no `user.role` conditionals; admin/teacher/student navs are unchanged
  (their scopes are ALL/ASSIGNED/OWN).
- **No backend changes**, no migration (still 7), no W5 hardening, no
  payments/submissions/exports — the portal is read-only by construction.
- **Alloy walkthrough:** guardian login → dashboard child card (100%
  attendance, Midterm 92.5%, fee balance) → /children → detail →
  all six tabs live → report card print view → /students redirected to
  /dashboard → bogus /children/<id> "Child not available" → admin
  revoked the link from the Guardians card → guardian dashboard showed
  the empty state and the child page denied → student demo nav/dashboard
  unchanged → walkthrough data purged.
- **Tests: 379** (unchanged — the repo has no frontend test harness; the
  W3 suite already pins every API contract these pages consume).

### M13-W5 — Guardian hardening, operations & final M13 verification
**Goal:** inspect-first close-out of M13. The full-surface audit found
two CHILD-scope gaps that W3's five-surface mandate had not covered,
both fixed with link-driven filters (no role conditionals):

- **P1 `GET /assignments/:id`** — `findScoped` had no CHILD branch, so a
  guardian could read any same-college assignment detail **including
  unpublished drafts** (description/attachments). Now CHILD resolves to
  *published assignments in sections where an ACTIVE-linked child of the
  caller is enrolled*; everything else is 404.
- **P1 `GET /sections/:id/sessions`** — CHILD fell through the
  OWN/ASSIGNED checks and could list session metadata for any
  same-college section. Closed (403), matching the per-section summary
  posture; guardians use `/attendance/summary?studentId=` only.
- **F2 fixed** — RateLimiterService now lazily sweeps fully-expired
  buckets inside `assert()` at most once per 5 minutes (`prune()` +
  `bucketCount()` test hooks). No timers, no infrastructure, no change
  for live buckets; regression-covered with mocked clocks.
- **F3 dispositioned, not changed** — `results.csv` is an admin
  (resolved-ALL) marks export for a chosen exam and intentionally
  includes unpublished marks; guardians/students never reach it and
  their published-only surface is `/results`. Documented in OPERATIONS
  §19/§21.
- **Rate limiting reviewed:** invitation/link creation was already
  covered (20/h/admin); remaining guardian endpoints are cheap
  authenticated reads or admin-guarded mutations consistent with the
  rest of the API — no new policies warranted.
- **Docs:** OPERATIONS §21 replaced with a full guardian runbook
  (invite/accept/link/login, CHILD semantics, revocation, multi-child/
  multi-guardian, dormant accounts, rate limits, mail failure,
  troubleshooting table, security expectations).
- **Final inspection (clean):** permission matrix (7 GUARDIAN grants,
  read-only, CHILD/OWN), tenancy double-belts on GuardianLink, audit
  metadata ids/flags-only, no role-name conditionals in request handling
  (community `MODERATOR` matches are group-membership roles), token
  lifecycle unchanged, migrations untouched, no dependency changes.
- **Tests: 386** (7 new): assignment detail allowed/draft-404/
  unrelated-404/revoke-404 with student regression, session list 403 for
  guardians (child's own + unrelated section) with student 200, F2 sweep
  + lazy-interval behavior.

**M13 COMPLETE** — W1 foundation, W2 onboarding/lifecycle, W3
child-scoped APIs, W4 portal UI, W5 hardening/close-out.

### M14-W0 — P2 security hardening (final-inspection follow-ups)
The M0→M13 deep inspection gate found 0×P0/0×P1 and three P2s; the two
in-code P2s are fixed here (P2-IDOR-1, the capability-URL file-signing
design, is deliberately untouched pending file-ownership records):

- **P2-GUARD-1 fixed** — `GET /timetable?view=section:<id>` now refuses
  callers with no `academics.read` grant (guardians): the section view is
  an academics surface, and the previous code only applied its ownership
  filter when that scope was OWN, letting a null scope fall through
  unfiltered. Scope-driven, no role names; ALL/OWN staff+student behavior
  and tenancy conjunct unchanged; guardians keep `view=student:<id>`.
- **P2-AUTH-1 fixed** — LoginRateLimiterService received the same lazy
  prune as the F2 fix in RateLimiterService: buckets with no in-window
  failures and no live block are swept in-band from `assertAllowed`, at
  most once per 5 minutes (`prune()`/`bucketCount()` test hooks, no
  timers). Attacker-cycled emails/IPs no longer grow the map forever;
  live blocks, limits and successful-login cleanup are unchanged. Note:
  escalation `strikes` on fully-idle buckets are now forgotten after a
  sweep — consistent with "expired" semantics.
- **Tests: 394** (8 new): guardian section-view denial (child's own,
  rival-college and garbage ids), guardian student-view intact,
  student/teacher/admin section behavior pinned incl. rival-college
  empty-not-leak and nonexistent-id conventions; limiter sweep of 100
  attacker keys, live-block survival + still-enforced limit after a
  sweep, 5-minute lazy interval determinism, recordSuccess cleanup.

### M14-W1 — Payments data model, permissions & settlement core
**Goal:** the database/domain foundation for online fee payments (H1
decisions #1–#7 locked; Safepay adapter is W2, webhooks W3, UI W4/W5).
Core invariant preserved: **Payment = settled money only.**

- **Migration #8 (additive):** `PaymentAttempt` (collegeId tenancy belt,
  frozen server-computed `amount`+`PKR`, `provider`/`providerRef` with
  `@@unique([provider, providerRef])`, status CREATED→PENDING→SUCCEEDED/
  FAILED/EXPIRED/CANCELLED (+REFUNDED reserved), `paymentId @unique`
  one-to-one with the settled Payment, `overpaid` flag);
  `GatewayEvent` webhook-idempotency ledger (`@@unique([provider,
  eventId])`, insert-first claim, no payload bodies stored);
  `PaymentMethod` + `ONLINE`; `Payment.recordedById` now nullable
  (gateway settlements have no staff recorder — existing rows untouched).
- **Permission:** `payments.initiate` STUDENT/OWN only (decisions #3/#4:
  full-outstanding-balance amounts; guardians deliberately ungranted).
- **PaymentsService (transport-free):** `createAttempt` (OWN-scoped
  invoice resolution `{id, collegeId, student.userId}`, balance frozen
  under a `SELECT … FOR UPDATE` row lock, one live attempt per invoice),
  `markPending`, `claimEvent` (P2002-tolerant insert claim),
  `settleAttempt` (validates amount/currency/provider against the frozen
  attempt — mismatch persists FAILED outside the tx; then row lock → CAS
  PENDING→SUCCEEDED → Payment(ONLINE, recordedById null) → invoice
  PARTIAL/PAID; over-balance confirmations recorded + `overpaid` flagged,
  invoice capped at PAID — settled money is never dropped),
  `failAttempt` (CAS), `expireStaleAttempts` (1h lazy TTL; EXPIRED is not
  settleable). Audit `payments.settled` carries ids/amount/flags only.
- **Existing race fixed:** `fees.recordPayment` balance check and writes
  now share one transaction behind the same invoice row lock — two
  concurrent recordings (or manual vs. gateway) can no longer jointly
  overpay. Behavior otherwise unchanged; `recordedByName` renders
  "Online payment" for staff-less settlements.
- **Tests: 405** (11 new): grant presence, frozen-balance computation,
  IDOR matrix (other student 404 / linked guardian 403 / rival college
  404 / garbage 404), NOTHING_TO_PAY / INVOICE_CANCELLED /
  ATTEMPT_IN_PROGRESS, settle-once with replay no-op + single Payment +
  audit hygiene, amount-tampering FAILED persistence + no resurrection,
  overpaid-flag capping, failAttempt CAS + expiry sweep + EXPIRED
  unsettleable, claimEvent exactly-once, concurrent-recordPayment race
  (one succeeds, sum never exceeds), manual partial→paid regression.

### M14-W2 — Gateway adapter & student payment initiation
**Goal:** the provider boundary and the one browser-facing W2 change —
`POST /fees/invoices/:id/pay`. No webhooks (W3), no UI (W4).

- **Adapter boundary:** `PAYMENT_GATEWAY` DI token +
  `PaymentGatewayAdapter` interface (`createCheckoutSession`,
  `verifyPayment` — the latter ready for W3's verify-on-return). The
  payments domain never references Safepay directly; tests inject a
  capturing fake exactly like `MAIL_TRANSPORT`.
- **Safepay adapter** (native fetch, zero new dependencies). Contract
  **verified** from the Express Checkout guide + the official
  `@sfpy/node-core` v0.3.5 source: secret-auth header
  `x-sfpy-merchant-secret`; `POST /order/payments/v3/`
  (merchant_api_key, intent, mode=payment, currency, amount in lowest
  denomination — paisa, metadata carrying attemptId/invoiceNo) →
  `data.tracker.token`; `POST /client/passport/v1/token` → TBT;
  hosted-checkout URL = `{env}/embedded/?environment&tracker&tbt&
  source=hosted&redirect_url&cancel_url` (SDK Checkout.js hostUrls);
  verify = `GET /reporter/api/v1/payments/{tracker}` with
  `TRACKER_ENDED` = paid. **Unresolved, isolated in the adapter:** the
  merchant-specific `intent` channel (CYBERSOURCE/MPGS) —
  `SAFEPAY_INTENT` env with the guide's example as default. Secrets
  never appear in responses, errors, logs or audit metadata.
- **Env (all-or-none pair, feature-flag semantics like Google/mail):**
  `SAFEPAY_API_KEY` + `SAFEPAY_SECRET_KEY`, optional
  `SAFEPAY_ENVIRONMENT`/`SAFEPAY_HOST`/`SAFEPAY_INTENT`, and
  `SAFEPAY_WEBHOOK_SECRET` reserved for W3. Unconfigured → the endpoint
  returns 503 `FEATURE_DISABLED` after authorization.
- **Endpoint:** guard (`payments.initiate`) → W1 `createAttempt` (OWN
  resolution, frozen full-balance amount, row lock, one live attempt) →
  adapter session → `markPending` → `{attemptId, status, checkoutUrl}`.
  **No request body is read at all** — the invoice id is the only
  client-controlled input. Session-creation failure →
  `failAttempt('SESSION_CREATE_FAILED')` + 502; a duplicate provider
  reference dies on the DB unique and fails the second attempt. Audit
  `payments.attempt_initiated` (ids/amount/provider only).
- **Tests: 413** (8 new, ~30 assertions): server-amount/tamper-proof
  body, partial-payment balance reduction, other-student 404 /
  guardian-teacher-admin 403 / anon 401 / garbage 404, cancelled/paid/
  in-progress guards, gateway-failure + retry, duplicate-providerRef
  backstop, adapter FEATURE_DISABLED without env, paisa conversion.
- Live smoke: student passes authz then hits FEATURE_DISABLED (no env
  in the sandbox stack), admin 403, anon 401 — the boundary works.

### M14-W3 — Webhook settlement, idempotency & verify-on-return
**Goal:** the asynchronous money path. No UI (W4), no reconciliation
surface (W5), no real-sandbox run (W6).

- **Signature provenance (VERIFIED, Safepay webhook docs):**
  `X-SFPY-SIGNATURE` = HMAC-SHA512 hex of the RAW request body with the
  endpoint's shared secret (`SAFEPAY_WEBHOOK_SECRET`). Verification lives
  in the adapter (`verifyWebhookSignature`, timing-safe, all failure
  modes indistinguishable); Nest `rawBody: true` preserves the exact
  bytes — no parse→re-stringify HMAC. Event shape verified too:
  `token` (evt id), `type` (`payment.succeeded`/`payment.failed`/…),
  `data.{tracker, state, amount(lowest denom), currency}`.
- **`POST /payments/webhooks/safepay`** (public; signature IS the auth):
  raw bytes → HMAC → strict parse (adapter `parseWebhookEvent`) →
  attempt resolved from OUR `{provider, providerRef}` (payload claims
  never drive tenancy) → **GatewayEvent insert-claim FIRST** (duplicate
  delivery → 200 no-op, no re-processing, no re-notification) → W1
  `settleAttempt`/`failAttempt`. 401 only for auth, 400 only for
  authentic-but-malformed; every business outcome (duplicate, unknown
  tracker → `UNMATCHED_*` ledger row, amount/currency mismatch →
  persisted FAILED + `payments.webhook_rejected` audit) is a 200 —
  no provider retry storms, no state leakage.
- **Exactly-once notifications:** `settleAttempt`/`failAttempt` now
  return non-persistent `justSettled`/`justFailed` transition flags
  (backward-compatible), so `payment.succeeded`/`payment.failed` events
  fire only on the actual transition — parallel same-event, parallel
  distinct-events, replays and terminal-state webhooks all yield one
  Payment / one notification. Refund/authorization/void event types are
  ledgered as OTHER for W5.
- **`POST /payments/attempts/:id/verify`** (`payments.initiate`, OWN):
  browser redirects are never truth — the endpoint asks the provider via
  `verifyPayment` and routes PAID/FAILED through the SAME settlement/
  failure core; PENDING leaves the attempt alone. Forged "success" body
  fields are ignored; provider-verified success settles even if the
  browser claimed failure; provider amount mismatch → persisted FAILED.
  Ownership: other student/rival college/garbage → 404, guardian → 403,
  anon → 401.
- **Notifications/mail:** `payment_succeeded`/`payment_failed` mail
  kinds + in-app templates (invoiceNo + amount only; no card data,
  tokens or payloads); emitted post-commit via the existing bus; a
  throwing SMTP transport provably never rolls back settlement.
- **Tests: 431** (18 new): auth trio indistinguishable 401s + tampered
  raw-body rejection + malformed-400; settle-once with replay/parallel-
  same/parallel-distinct; amount & currency mismatch; FAILED/EXPIRED
  non-resurrection; idempotent failures; unmatched ledger; SMTP-failure
  isolation; verify-on-return ownership matrix + forged-success +
  PAID/FAILED/mismatch routing; HMAC unit vectors.
- **Real Safepay sandbox: NOT exercised** (no credentials in this
  environment) — deterministic DI-fake coverage only; live sandbox
  verification remains W6 scope.

### M14-W4 — Student payment UI
**Goal:** the smallest production-quality payment experience over the
existing APIs. Presentation layer only — no backend authority moved.

- **Invoice detail (`/fees/invoices/[id]`):** "Pay now · <balance>"
  appears only with the `payments.initiate` hint on a payable invoice
  with balance > 0 (hidden for PAID/CANCELLED/zero-balance and all
  staff/guardians — hint only; the API stays authoritative). Click →
  `POST /fees/invoices/:id/pay` with NO body → redirect to the returned
  `checkoutUrl`. FEATURE_DISABLED / GATEWAY_ERROR / ATTEMPT_IN_PROGRESS
  each get friendly handling (in-progress routes to the live attempt's
  status page). Duplicate-click protected.
- **Attempt history section** on invoice detail (safe fields only:
  status/amount/provider/times/friendly failure text) — settled
  `Payment` history remains the only money record; attempts are
  explicitly rendered as attempts.
- **`/fees/payments/[attemptId]`** status page: calls
  `POST /payments/attempts/:id/verify` (no body; gateway redirect query
  params deliberately ignored) and renders ONLY the server's answer.
  PENDING polls at 4s for max 2 minutes, stops instantly on terminal
  states, then offers "Check again" (never claims failure). SUCCEEDED/
  FAILED/EXPIRED/CANCELLED views with View invoice / Back to fees /
  Try again (new attempt via the normal endpoint — never resurrection).
- **Backend support (minimal):** `InvoiceDetail.attempts` added to the
  fees invoice-detail response (safe fields; rides the existing OWN/
  CHILD/ALL scoping) + shared `PaymentAttemptItem` type.
- **Alloy walkthrough (local Safepay stub via SAFEPAY_HOST; checkout
  redirect reached the REAL Safepay sandbox page, which correctly
  rejected the fake tracker):** student → /fees → invoice → Pay now →
  hosted checkout redirect → return → PENDING with live polling → stub
  flipped to TRACKER_ENDED → auto-settled → "Payment successful …
  invoice is now PAID" → invoice PAID with ONLINE payment row +
  SUCCEEDED attempt + notification; failure path (TRACKER_FAILED) with
  **forged `?success=true&status=SUCCEEDED` query showing FAILED**;
  EXPIRED terminal + Try again→new attempt; admin/teacher 403 on
  pay/verify, admin has no `payments.initiate` hint; smoke data purged,
  demo invoice restored, stub + env removed.
- Tests remain **431** (no frontend harness; the W2/W3 e2e suites pin
  every consumed contract); typecheck 0; builds green; migrations 8.

### M14-W5 — Admin reconciliation
**Goal:** an operations surface over online payments — visibility plus a
controlled gateway-verify action. No refunds, no accountant role, no W6.

- **APIs (all `fees.manage`, service-verified resolved-ALL scope,
  tenant-locked to the admin's collegeId):**
  `GET /payments/reconciliation` (paginated; Zod-validated status/
  provider/invoiceNo filters — junk filter values 400, never reach
  Prisma), `GET /payments/reconciliation/unmatched` (UNMATCHED_*
  GatewayEvent ledger rows: provider/eventId/outcome/receivedAt only —
  tenant-unattributable by design, no payload bodies exist to leak),
  `POST /payments/reconciliation/:id/verify`. The student verify
  endpoint (`payments.initiate`/OWN) is untouched — reconciliation is a
  separate capability path in PaymentsService.
- **Verify action:** the browser only *requests* verification; the
  server asks the adapter and routes PAID/FAILED through the SAME W1
  settlement/failure core (row lock + CAS). Outcomes: SETTLED /
  ALREADY_SETTLED / STILL_PENDING / FAILED / REJECTED (amount mismatch,
  persisted by the core) / NO_ACTION (terminal — never resurrected).
  Student notifications fire exactly once via the shared
  `notifyOutcome` helper; every verify is audited
  (`payments.reconciliation_verified`, ids/provider/outcome only).
- **UI:** third "Reconciliation" tab on the admin /fees page
  (`fees.manage` hint): DataTable of attempts (invoiceNo→detail link,
  student+roll, amount+currency, provider+ref, created, status badge,
  **"Overpaid — manual investigation required"** flag, failureCode),
  status filter, per-row "Verify with gateway" (PENDING only, disabled
  while running, toast feedback, live summary refresh), and an
  unmatched-events panel.
- **Export:** verified fees.csv already aggregates payments
  method-agnostically — ONLINE settlements flow into paid totals with
  zero changes (pinned by a new test incl. tenant scoping + student
  403). F3/results.csv untouched.
- **Tests: 439** (8 new): authz matrix (admin 200, teacher/student/
  guardian 403, anon 401), rival-college invisibility + verify 404 +
  garbage 404, PAID→settled (payment/invoice/notification/audit +
  repeat NO_ACTION with one Payment), PENDING/FAILED routing +
  no-resurrection, amount-mismatch REJECTED, overpaid flag + PAID cap +
  no negative rows, unmatched ledger minimal-fields + junk-filter 400,
  export ONLINE totals.
- **No migration** (still 8). Alloy: admin tab walkthrough with the
  local gateway stub — pending row → Verify → "Payment confirmed and
  settled" → SUCCEEDED badge + dashboard tiles updated; API-level
  negative matrix re-confirmed live; smoke purged, demo restored.

### M14-W6 — Payments hardening, operations & M14 close-out
**Goal:** adversarial re-inspection of the whole W1–W5 surface, true-
concurrency regression coverage, the operator runbook, and close-out.

- **Re-inspection (clean):** zero role-name authorization in the
  payments surface; every attempt/event query tenant-scoped; webhook
  route public-by-design with signature-first ordering; no session-auth
  leakage onto the webhook; no unsigned settlement path; no provider
  secrets/tracker tokens/raw bodies in logs, audits or responses;
  `unique(provider, providerRef)`, `unique(provider, eventId)` and
  `attempt.paymentId @unique` verified as the three DB-level settle-once
  backstops; terminal-state CAS protections intact; nullable
  `recordedById` backward-compatible everywhere it is read.
- **New true-concurrency tests (the one material gap — earlier suites
  were sequential):** (1) simultaneous manual recordPayment + gateway
  settlement — order-independent invariants: settlement never rejected,
  no double-count into status, invoice capped PAID, overpaid flagged
  only when manual won the lock; (2) simultaneous settlement of two
  distinct attempts against one balance — both Payment rows recorded
  (money never dropped), exactly one overpaid flag; (3) simultaneous
  settle + fail of one attempt — CAS yields exactly one terminal
  outcome, never money-without-SUCCEEDED. **Tests: 442** (33 suites).
- **OPERATIONS §22 — online payments runbook:** credentials/rotation
  (all-or-none pair, webhook-secret rotation window), authority model
  (browser never authority; no manual DB edits of attempts), student
  flow, full reconciliation decision table (gateway-paid-but-pending,
  reversal, rejected webhooks, AMOUNT_MISMATCH, overpaid, unmatched,
  provider outage, duplicates), and the VERIFIED/UNRESOLVED provider
  ledger.
- **Real Safepay sandbox: PENDING MERCHANT CREDENTIALS** — no sandbox
  account exists in this environment; the integration is verified
  against the official documented contracts (docs + SDK source) and
  deterministic stubs. Production readiness of the payment rail is
  explicitly contingent on the first real merchant onboarding
  (intent channel, webhook cadence, settlement/fees, refund API,
  education MCC, transaction limits — all UNRESOLVED items are listed
  in OPERATIONS §22).

**M14 COMPLETE (code-side)** — W0 hardening, H1 architecture, W1 data
model/settlement core, W2 gateway adapter/initiation, W3 webhooks/
idempotency, W4 student UI, W5 reconciliation, W6 hardening/close-out.
Remaining before first production payment: merchant onboarding + real
sandbox walkthrough.

### M14-SBX — Real Safepay sandbox verification (adapter contract fixes)
**The first genuine end-to-end payment.** Sandbox merchant credentials +
Cloudflare quick tunnels (public web/API) were provisioned; the real
provider exposed two contract divergences from its own documentation,
both fixed as approved one-liners inside the adapter:

1. **Metadata whitelist (LIVE-VERIFIED):** `POST /order/payments/v3/`
   rejects unknown metadata keys with 500 "unsupported meta key" —
   `attempt_id` removed; `{order_id, source: 'campusos'}` (both
   live-verified accepted). Correlation never relied on metadata (the
   tracker/providerRef is the join key).
2. **Reporter shape (LIVE-VERIFIED):** `GET /reporter/api/v1/payments/
   {tracker}` returns the tracker object directly under `data.*`
   (`data.state`), not the documented `data.tracker.*`. `verifyPayment`
   now supports both shapes (`report.data?.tracker ?? report.data`),
   with a unit test pinning each. **Tests: 443.**

**LIVE-VERIFIED against the real sandbox:** credentials/auth header;
session+TBT creation; hosted checkout rendering **Rs.800.00** for the
PKR 800 invoice (paisa conversion exact: 80000 sent, `quote_amount
{PKR, 80000}` reported back); payment completed with official test card
4456…1005 (frictionless success); provider redirect returned to our
public URL; **browser authority boundary held** (redirect alone changed
nothing); tracker genuinely `TRACKER_ENDED`; **admin Verify-with-gateway
settled the real payment through the W1 core** — attempt SUCCEEDED with
confirmedAt/paymentId, one Payment(ONLINE, null recorder), invoice
PAID, exactly one payment.succeeded notification, clean audits,
reconciliation row, fees.csv `1500,1500,PAID`; repeat verify NO_ACTION
with one Payment (idempotent). **Declined-card behavior (official
…1013):** the provider keeps the tracker at `TRACKER_STARTED` for
retry — CampusOS correctly stays PENDING with zero Payments and no
invented failure (STILL_PENDING; the 1h TTL expires abandonments; hard
FAILED comes only from a payment.failed webhook).

**NOT TESTABLE this session (webhook endpoint not yet registered in the
provider dashboard — no delivery observed):** genuine webhook
signature/settlement, redelivery/replay, wrong-secret drill,
payment.failed webhook. Everything webhook-side remains covered by the
deterministic W3 suite; the missing-webhook recovery path was proven
against the REAL provider instead. UNRESOLVED at provider: webhook
retry cadence/event-id stability, settlement timing, fees, limits,
refund API. SAFEPAY_INTENT: both CYBERSOURCE and MPGS accepted at
session-create on this merchant; CYBERSOURCE processed the live card
payment successfully.

### M15-W1 — Academic calendar administration & lifecycle invariants
**Goal:** make the EXISTING calendar backend usable and harden its
invariants; rollover execution is strictly W2.

- **Admin Calendar UI (`/calendar`,** `academics.manage` **route hint):**
  academic-years table (create/edit dialogs via the shared Zod schemas),
  terms table (create/edit, "Current" badge, **Set current** with
  ConfirmDialog through the existing `PATCH /terms/:id/set-current`),
  current-term banner, "Calendar" nav item. Pure consumer of the
  existing API contracts — zero backend behavior changes, no
  client-supplied collegeId anywhere.
- **Migration #9 (additive):** (1) raw-SQL partial unique index
  `Term_one_current_per_college ON "Term"(collegeId) WHERE "isCurrent"`
  — the single-current-term invariant is now DATABASE-enforced
  (pre-checked: zero colleges had conflicting data); Prisma can't
  express partial indexes, documented on the model. (2) **TermRollover**
  preparation table for W2: `{collegeId/fromTermId/toTermId Restrict
  FKs, status DRAFT|EXECUTED, plan Json (ids/flags only), counters,
  executedBy SetNull, @@unique([collegeId, toTermId])}` — the W2
  execution path will CAS DRAFT→EXECUTED; **no rollover service,
  endpoints or execution exist in W1** (asserted by test: the future
  rollover route 404s).
- **Tests: 450** (7 new): admin-mutates/teacher-student-403/anon-401,
  year+term CRUD via HTTP with validation + duplicate-label guards,
  set-current atomic switch + restore, rival-college IDOR matrix
  (list-exclusion, update/set-current 404, term-into-rival-year 400),
  **DB invariant proof** (service-bypassing raw second current term →
  P2002; per-college independence), TermRollover unique + DRAFT shape.

### M15-W2 — Term rollover engine (locked decisions D1–D8)
**Goal:** the backend semester-boundary machine:
DRAFT → suggested plan → editable preview → typed confirmation → atomic
execution. UI wizard is W3; **zero** timetable (D5), term-freeze (D6) or
fee/payment (D7) writes anywhere.

- **Endpoints** (all `academics.manage`, tenant-scoped, thin
  controllers): `POST /terms/:id/rollover {fromTermId}` (creates the
  draft with the suggested plan, idempotently resumes an existing
  draft; SAME_TERM / INVALID_SOURCE_TERM / TARGET_TERM_NOT_EMPTY /
  ALREADY_EXECUTED semantics), `GET …/rollover` (draft + resolved
  preview + summary counters — the W3 wizard contract),
  `PATCH …/rollover` (plan edits, DRAFT-only CAS), `POST
  …/rollover/execute {confirmLabel}` (typed confirmation must equal the
  destination term label).
- **Plan model (D1/D2/D3/D4/D8)** in shared Zod: per source section
  CLONE / MAP(targetCourseId) / SKIP + targetName + graduateStudents +
  carryTeachers/teacherIds override; per student CARRY / HOLD(→another
  carried mapping's destination) / EXCLUDE. Suggested defaults:
  same-course clones, teachers carried, WITHDRAWN/GRADUATED force-
  EXCLUDED (locked — re-checked LIVE at execution as a safety net),
  SUSPENDED carried but flagged. No marks/results are ever read — zero
  pass/fail inference.
- **Execution** — one interactive transaction: row-lock the
  TermRollover + CAS DRAFT→EXECUTED (concurrent executes collapse to
  exactly one), per-entry live revalidation of sections/courses/
  teachers inside the tx (stale/foreign id aborts the WHOLE rollover),
  destination sections created fresh (source term untouched; retry-safe
  reuse by term+course+name), teaching assignments + enrollments via
  createMany(skipDuplicates) on their unique pairs, ALL source-section
  ACTIVE enrollments → COMPLETED (history immutable and readable),
  graduates → GRADUATED (ENROLLED-guarded), counters persisted. Audits:
  `terms.rollover_drafted` / `terms.rollover_executed` (ids/counters
  only).
- **Tests: 461** (11 new, ~45 assertions): full authz matrix incl. a
  real rival-college admin (404s on read/patch/execute, foreign
  source/target rejection), suggested-plan defaults, invalid-plan
  matrix (MAP w/o course, HOLD w/o target, HOLD→SKIP, foreign section),
  typed-confirmation refusal, the full execution matrix (CLONE + MAP
  different-course + SKIP + graduation + hold-back into repeat section
  + suspended-carried + withdrawn/excluded absent + teacher carry AND
  override + old-ACTIVE→COMPLETED + source sections intact + zero
  timetable/invoice/payment rows + audit hygiene), re-execute/re-edit
  409 with zero duplication, **mid-transaction failure injection**
  (sabotaged MAP course → 400, zero partial state, DRAFT preserved,
  repaired retry succeeds), **concurrent execute race** ([201, 409],
  sections created exactly once). One W1 assertion updated (the
  rollover endpoint now exists and idempotently resumes raw drafts —
  preview hardened to tolerate empty plan JSON).
- **No migration** (still 9) — the W1 TermRollover structure sufficed.

### M15-W3 — Rollover wizard UI & live semester-boundary walkthrough
**Goal:** the admin-facing face of the W2 engine, plus an end-to-end
Alloy walkthrough of an entire semester boundary on the demo college.

- **`/calendar` gains "Start rollover"** (enabled with ≥2 terms):
  StartRolloverDialog picks source (defaults to the current term, shows
  section counts) and destination, POSTs the draft (backend
  authoritative — idempotently resumes, surfaces SAME_TERM /
  TARGET_TERM_NOT_EMPTY etc. as toasts) and routes to the wizard.
- **`/calendar/rollover/[termId]` wizard**: summary counter tiles (new
  sections / carried / held / excluded / graduating / suspended ⚠ /
  teacher links / skipped) recomputed live from the edited plan;
  per-section cards with mapping (same course / different course… /
  do-not-carry), destination name, graduate-students checkbox, teacher
  carry with per-teacher checkboxes; per-student CARRY / HOLD(→carried
  section) / EXCLUDE selects with locked WITHDRAWN/GRADUATED rows.
  "Save plan" PATCHes and disables until the plan is dirty again;
  "Execute rollover…" opens a typed-confirmation dialog (button
  disabled until the destination label is typed exactly, busy-guarded
  against double submit; 409/error surfaced as toasts). Success view
  shows EXECUTED counters and the explicit "does NOT touch fees,
  invoices, payments or timetables" next-steps guidance. The fee/
  timetable non-goal sentence is repeated on the calendar dialog, the
  wizard header and the execute dialog.
- **Alloy walkthrough (Fall 2026 → Spring 2027, demo college)**:
  snapshot → draft via dialog → wizard rendered all 6 sections /
  25 students / 7 teacher links → live edit (1 student EXCLUDE, tiles
  updated 25→24 carried) → save → typed confirmation → EXECUTED
  (6 sections, 24 enrollments, 7 teaching assignments, 25 source
  enrollments COMPLETED). DB verified: marks 16, attendance 125,
  invoices 13, payments 9, timetable slots 12, sessions 36 all
  UNCHANGED; 0 Spring timetable slots; audit pair present. Then set
  Spring current via `PATCH /terms/:id/set-current`, created a Spring
  fee structure and `POST /fees/invoices/generate` → 15 invoices with
  the untouched fee tooling, verified Fall data remained readable, and
  fully restored the demo dataset (rollover artifacts deleted, Fall
  re-current, all counts back to snapshot, all three demo logins 200).
- **No API/schema/migration changes** (still 9 migrations); tests stay
  461/461; web prod build emits the new route; zero role conditionals.

### M15-W4 — Close-out: runbook, security audit, full verification
**Goal:** document, harden-verify and formally close M15. Zero product
code changes — documentation only.

- **OPERATIONS.md §24**: Academic term rollover / semester boundary
  runbook — pre-flight checklist (source/destination/same-college/empty
  destination, fee+timetable planning), draft semantics (suggested plan,
  idempotent resume, SAME_TERM / INVALID_SOURCE_TERM /
  TARGET_TERM_NOT_EMPTY / ALREADY_EXECUTED), wizard review
  (CLONE/MAP/SKIP, teacher carry, CARRY/HOLD/EXCLUDE, graduation,
  suspended ⚠, locked rows, backend-authoritative PATCH), execution
  (server-enforced typed confirmation, atomic CAS, concurrency
  protection, immutability, retry-verification list — no manual SQL),
  the 8-step post-rollover sequence (counters → set-current →
  timetable → fee structure → invoices → old-term readability →
  dashboards → audit events) and the explicit "rollover does not
  automatically create invoices, payments, refunds, or timetable
  slots" statement.
- **Read-only security/tenancy audit of the whole M15 surface** (year/
  term UI, wizard, controllers, RolloverService, shared schemas,
  TermRollover persistence, set-current): all 8 mutation endpoints
  require `academics.manage`; every query filters by the authenticated
  `user.collegeId` (13 tenancy filters in calendar.service, every
  rollover lookup + in-transaction revalidation); the browser never
  supplies a college; zero role-name conditionals; rival-college 404s,
  typed-confirmation server enforcement, EXECUTED immutability and
  concurrent-execute CAS are all proven by the existing W1/W2 suites;
  audit metadata carries ids/counters only (no student PII); no
  secrets in any M15 file. **No defects found.**
- **Verification (recorded)**: 461/461 tests (35 suites); typecheck 0
  errors across api/web/shared; API + web production builds green
  (`/calendar/rollover/[termId]` route emitted); `prisma migrate
  status` — 9 migrations, schema up to date; TermRollover
  unique(collegeId,toTermId) + the `Term_one_current_per_college`
  partial unique index verified live in W1 tests. No new migration
  needed.
- **Deferred items preserved unchanged** (§13): Safepay webhook live
  verification (externally blocked), P2-IDOR-1, single global webhook
  secret, P3 register items, merchant/provider questions, refunds/
  accountant role (future milestone), term freeze (D6) deferred.

**M15 is formally closed**: calendar lifecycle usable, rollover engine
+ wizard complete, semester boundary verified live, runbook shipped,
audit clean, suite/builds/migrations green.

### M16-W0 — Refunds design + Safepay refund probe (`d2d6e52`)
Committed `docs/M16_REFUNDS_DESIGN.md` (28 sections, D-1…D-8 locked) after
LIVE-VERIFYING the Safepay sandbox refund API end to end: fresh PKR 800
payment, partial refund (30000 paisa → TRACKER_PARTIAL_REFUND), remainder
(→ TRACKER_REFUNDED), `refund_<uuid>` identifiers via the reporter's
`charge.cybersource_refunds[]`, provider-side over-refund/full-refund
guards, synchronous execution, secret-header auth. Refund webhooks remain
externally blocked (dashboard-only registration, no dashboard
credentials). W3 provider execution: GO. Demo DB restored post-probe.

### M16-W1 — Refund schema + accountant foundation
Persistence/authorization only — no service, endpoints, accounting or UI.

- **Migration #10** (`m16_refund_foundation`): `Refund` (immutable
  money-out ledger) + `RefundAttempt` (lifecycle; own collegeId belt;
  REQUESTED/PROCESSING/SUCCEEDED/FAILED/CANCELLED; PROVIDER|RECORDED),
  all financial FKs `Restrict`; raw SQL adds
  `RefundAttempt_one_inflight_per_payment` (partial unique on paymentId
  WHERE in-flight) and `amount > 0` CHECKs on both tables;
  `ALTER TYPE "RoleKey" ADD VALUE 'ACCOUNTANT'`.
- **Permission**: single new `finance.refund`; ADMIN + ACCOUNTANT hold it
  (D-1). ACCOUNTANT matrix: fees.read/fees.manage/users.read/audit.read
  (D-6)/finance.refund, all ALL — nothing else. Zero role conditionals;
  PolicyService untouched.
- **Seeds**: demo `accountant@campusos.dev` (standard demo password),
  idempotent (system seed re-run twice in tests, counts stable).
- **Shared contracts** (W2 wiring later): `createRefundSchema`
  (amount>0, PKR-only, required reason, PROVIDER|RECORDED; NO
  client-controlled tenancy/provider/identity fields), execute
  (typed amount confirmation), cancel, listing filters +
  RefundAttemptItem/RefundItem/PaymentRefundSummary types.
- **Tests: 476** (15 new): migration structures + enum values + 10
  applied migrations; real-DB invariants (CHECK violations, in-flight
  partial unique incl. terminal-rows-don't-count, multiple NULL provider
  refs coexist, duplicate provider ref rejected, Payment delete blocked
  by refund FK); accountant matrix exactness + PolicyService resolution +
  HTTP access (fees/reconciliation 200, settings/academics refused);
  seed idempotency; shared-contract rejection matrix; refund endpoints
  asserted ABSENT (W2). One M12 assertion legitimately updated:
  audit.read is now ADMIN+ACCOUNTANT (D-6).

### M16-W2 — Refund engine
RefundsService + HTTP surface + net-of-refunds accounting; no UI.

- **Endpoints** (thin controllers; mutations `finance.refund`, reads
  fees.read / fees.manage-ALL): `POST /fees/payments/:id/refunds`
  (create REQUESTED; invoice derived from the payment; in-flight DB
  unique → 409 REFUND_IN_PROGRESS), `GET …/refunds` (PaymentRefundSummary
  incl. server-computed refundable; staff ALL / student OWN),
  `GET /fees/refunds` (reconciliation listing, status/method/invoiceNo
  filters), `POST /fees/refunds/:id/execute` (server-validated typed
  amount confirmation), `…/cancel` (REQUESTED-only CAS), `…/verify`
  (PROCESSING reporter-truth reconciliation, replay-safe).
- **Engine**: every money mutation locks the Invoice row (settlement/
  manual-recording lock) and recomputes
  `refundable = payment.amount − Σ Refund.amount` at creation AND
  execution; CAS on every transition; RECORDED = one-transaction
  REQUESTED→SUCCEEDED materializing the immutable Refund; PROVIDER =
  REQUESTED→PROCESSING → adapter call → reporter-verified finalization.
  **Ambiguity rule**: a failed/unreachable provider call NEVER fails the
  attempt directly — reporter truth decides (unclaimed matching record →
  SUCCEEDED; reachable-but-absent → FAILED PROVIDER_REJECTED; mismatched
  new record → AMOUNT_MISMATCH; unreachable → stays PROCESSING).
  Provider refund refs come only from the adapter; already-claimed refs
  are never rematched.
- **Safepay adapter** (W0-verified contract only): `createRefund` →
  `POST /order/payments/v3/{tracker}/refund` (paisa, merchant-secret
  header); `verifyRefund` → payment reporter
  `charge.cybersource_refunds[]` (dual-shape tolerant). No webhook
  refund handling (delivery still unregistered).
- **D-5 net accounting** across the whole blast radius: fees.service
  `paidAmount`/summary, payments.service initiation + settlement
  reducers, and RefundsService's derived invoice status
  (net 0 → PENDING; CANCELLED preserved — D-7 refunds leave it
  CANCELLED; OVERDUE re-derived by the existing lazy sweep).
- **Audit**: `payments.refund_requested/succeeded/failed/cancelled`,
  metadata = attemptId/refundId/amount/method/failureCode only (no
  reason text, no PII), exactly one row per real transition.
  **Notifications**: `refund.succeeded` → student (+mail),
  `refund.failed` → requesting finance staffer (+mail), exactly-once
  via CAS flags.
- **Tests: 498** (22 new adversarial): full authz matrix (guardian
  incl.), rival-college 404s on every surface with zero cross-tenant
  rows, zero/negative/USD/over-refund rejections, D-5 scenarios
  (800/300→PARTIAL, +500→PENDING; 800-invoice/500-paid/300-refund→
  PARTIAL net 200), D-7 cancelled-invoice refund, execution-time
  headroom re-check, wrong typed confirmation, terminal-transition
  refusals, retry-after-FAILED, true concurrency (create races → 201+409
  via the partial unique; execute races → one Refund + one audit row),
  RECORDED no-provider proof, PROVIDER success/rejection/ambiguous-
  timeout-stays-PROCESSING/verify-recovery/replay-idempotency/
  amount-mismatch/claimed-ref-never-reused, paisa unit vectors, audit
  metadata hygiene, tenant-scoped listings + OWN student summary. Two
  legitimate updates: W1's "endpoints do not exist yet" flipped to
  existence, payment-spec fake gateways gained inert refund stubs.

### M16-W3 — Live sandbox verification (documentation-only commit)
The shipped W2 engine was LIVE-VERIFIED end to end against the real
Safepay sandbox through the normal app path (design doc §5a): PKR 800
checkout payment settled → accountant-initiated PROVIDER refund 300 →
SUCCEEDED with a real `refund_…` ref matching the provider reporter
(`TRACKER_PARTIAL_REFUND`, balance 500) → verify replays idempotent →
remainder 500 → `TRACKER_REFUNDED`, balance 0, Σ=800, refundable 0 →
post-exhaustion 0.01 rejected `EXCEEDS_REFUNDABLE` with zero side
effects. Payment/PaymentAttempt/Invoice.amount immutability, single
audit row and single notification per transition all held. **No defects;
zero code changes.** Probe data removed; demo DB restored exactly
(sandbox tracker remains refunded, W0 precedent).

### M16-W4 — Refund UI + accountant journey
Frontend only; the W2 backend stayed authoritative and untouched.

- **`apps/web/app/(app)/fees/refunds.tsx`** (new): `InvoiceRefundsSection`
  (per-payment history + refundable headroom from
  `GET /fees/payments/:id/refunds`; "Refund…" shown only to resolved
  `finance.refund` holders), `RefundDialog` (payment facts + prior
  refunds + server refundable, amount prefilled with the full remaining
  amount, required reason, PROVIDER/RECORDED per payment method, then a
  typed-amount confirmation step with the execute button disabled until
  the exact frozen amount is typed; REQUESTED can be cancelled;
  busy-guarded; PROCESSING/FAILED outcomes surfaced with the backend's
  codes — EXCEEDS_REFUNDABLE refreshes stale views), and
  `RefundsReconciliationView` (Fees → Refunds tab: status filter,
  provider-ref/failure column, "Verify with provider" for PROCESSING,
  Cancel for REQUESTED, no controls on terminal rows).
- Invoice detail wires the section for staff AND students (read-only:
  no buttons without finance.refund); guardians' CHILD scope has no
  refund read projection (W2 contract) — the section hides gracefully;
  a guardian read projection is a recorded W5+ contract gap.
- **Accountant journey (Alloy-verified live)**: login → permission-driven
  nav shows only Dashboard/Fees/Announcements/Audit log; full refund
  create→typed-confirm→execute cycle; Refunds reconciliation; audit rows
  visible; /settings redirected away by the existing middleware. Known
  cosmetic gap: /dashboard falls back to the student view and shows a
  clean permission error for accountants (no dashboard.* grant) —
  candidate for W5 polish, not touched here.
- **Alloy walkthrough**: admin partial refund 50 on a 700 CASH payment
  (Paid 700→650, Balance 800→850, summary Collected net −50, history +
  Refunds tab rows); accountant refund 25 (650→625); student read-only
  visibility on their own invoice ("Pay now" reflects the net 825
  balance). All walkthrough refunds/attempts/notifications removed and
  invoice statuses restored — affected-table snapshot diffed clean; all
  four demo logins 200. No provider-side money created (PROVIDER path
  already live-verified in W3; UI provider branch relies on W2 e2e).
- **No backend changes**; tests stay 498/498; migrations stay 10; zero
  role conditionals; no client-controlled tenancy/provider fields.

### M16-W5 — Refund CSV + runbook + security re-audit (M16 CLOSED)
- **Hardening finding (fixed)**: `GET /exports/fees.csv` still exported a
  GROSS "paid" column — the one net-of-refunds blast-radius site missed
  in W2. Now `Σ payments − Σ refunds`, regression-tested.
- **`GET /exports/refunds.csv`** added inside the existing M12-W3 export
  architecture (same `assertAllScope` model — `fees.manage` resolved ALL,
  so ADMIN + ACCOUNTANT; tenant-scoped; `status`/`method` filters
  mirroring the reconciliation view; columns: attempt/refund/invoice/
  payment ids, exact two-decimal amount, currency, method, status,
  reason, provider ref, failure code, requester name, timestamps; audit
  `exports.generated`). Export button added to the Refunds tab.
- **Tests: 502** (4 new): export authz matrix (accountant/admin 200,
  student/teacher 403, anon 401), tenancy (rival attempt absent),
  RFC-4180 escaping of a comma/quote/newline reason, exact `45.00`
  formatting, filter semantics, header-only empty result, and the
  fees.csv net-paid regression.
- **OPERATIONS §25**: refund runbook — pre-flight checklist, RECORDED vs
  PROVIDER guidance, "provider truth is authoritative / never manually
  force SUCCEEDED / preserve PROCESSING when unreachable", terminal-state
  retry rules, concurrency guarantees, 10-point post-refund verification,
  explicit non-goals (no webhook availability claimed).
- **Security re-audit: PASS, no defects.** Full-path trace UI→controller→
  Zod→PolicyService→service→tx→adapter→audit/notifications: every public
  refund entry point tenant-gates before any internal id lookup; zero
  role-name authorization conditionals (community group-membership roles
  and the M13 guardian-invite data check are pre-existing, non-authz);
  no client-controlled collegeId/invoiceId/provider refs/status/recorder
  ids; Payment/PaymentAttempt/Invoice.amount/invoiceNo immutable; CAS on
  every transition; audit metadata whitelist intact; W2's 26-test
  adversarial suite re-verified green.
- **Gap dispositions**: accountant `/dashboard` landing (clean
  no-permission fallback) — accepted as a documented cosmetic limitation,
  finance functionality unaffected; guardian CHILD-scope refund read
  projection — DEFERRED (no backend broadened).

**M16 FINAL STATUS — CLOSED.** Delivered: refund domain (Refund +
RefundAttempt, migration #10), ACCOUNTANT role + `finance.refund`,
RECORDED refunds, Safepay PROVIDER refunds (live-verified twice: W0
probe + W3 app-path), partial refunds to exhaustion, net-of-refunds
accounting everywhere (incl. exports), reconciliation + verify, refund
UI + accountant journey, exactly-once notifications and audit, refunds
CSV, operations runbook, security audit. Deferred (unchanged status):
refund webhooks + dashboard registration (externally blocked),
automatic provider polling, refund receipts/PDFs, advanced refund
dashboards/reporting, maker-checker (`finance.refund.approve`),
guardian refund CHILD projection, accountant dashboard landing polish,
term freeze (M15 D6), P2-IDOR-1, single global webhook secret, and the
P3 register items.


### M17-W1 — Term lifecycle foundation
Persistence + transitions only; broad enforcement is W2.

- **Migration #11** (`m17_term_lifecycle`): new `TermStatus` enum
  (ACTIVE|CLOSED), `Term.status @default(ACTIVE)` (all existing terms
  remain ACTIVE — no backfill), `@@index(collegeId, status)`. Additive,
  applied against the real DB.
- **TermLifecycleService**: `close`/`reopen` — tenancy gate (foreign =
  404, no state leakage), server-side typed confirmation (term label,
  M15 pattern), one transaction with `SELECT … FOR UPDATE` on the Term
  row, D-3 (`TERM_IS_CURRENT`) re-checked under the lock, CAS
  transitions (concurrent calls → one 201 + one 409), in-transaction
  audit (`terms.closed`/`terms.reopened`, label-only metadata; the row
  exists iff the transition committed — AuditService gained an optional
  tx parameter). `assertTermOpen(tx, collegeId, termId)` — the reusable
  W2 guard: FOR SHARE on the Term row (serializes against close's FOR
  UPDATE), 404 foreign/missing, 409 `TERM_CLOSED`.
- **Endpoints**: `POST /terms/:id/close` and `…/reopen`, both
  `academics.manage` (O-1) — accountants/teachers/students/guardians
  refused; no new permissions, zero role conditionals.
- **First guards live now**: set-current row-locks the target and
  refuses CLOSED (`TERM_CLOSED`); rollover refuses a CLOSED destination
  at draft AND inside the execution transaction; a CLOSED SOURCE stays
  valid (O-3).
- **D-4 hook**: `executeRolloverSchema` gains optional
  `closeSourceTerm`; when explicitly true, the source is closed AFTER
  the rollover commits via the standard lifecycle transition (audited
  once); failure (e.g. source is current) never un-does the rollover —
  reported as `sourceTermClosed:false` + `sourceTermCloseError`.
  Omitted/false changes nothing.
- **Tests: 516** (14 new): migration structures + defaults, full authz
  matrix, tenancy (no mutation/no cross-tenant audit), typed
  confirmation, round-trip + invalid transitions with exact audit
  counts, D-3 under lock, CLOSED set-current refusal, real-Postgres
  double-close/double-reopen/close-vs-reopen races, and the four
  rollover integration cases. One legitimate M16-W1 assertion update:
  the hardcoded "10 applied migrations" became "m16 migration applied +
  count ≥ 10" (milestone-count ownership moved to the newest suite).
- Deliberately NOT here (W2+): the 21-site enforcement sweep, netPaid
  consolidation/DEFECT-1, guardian refund projection, accountant
  landing, calendar/rollover UI.

### M17-W2 — CLOSED-term enforcement + net accounting consolidation
- **Academic enforcement (design §10, all sites)**: attendance (session
  generation — guard + createMany in ONE transaction; session update;
  sheet save), exams (create-in-term, update, publish, paper
  create/update, marks PUT), assignments (create/update/remove/publish,
  student submit, grade), timetable (slot create/update/delete),
  sections (create-in-term, update, enroll, unenroll, teacher
  assign/unassign), term definition edits. All through the ONE
  `assertTermOpen`/`assertSectionTermOpen` guard (new section-join
  variant with `FOR SHARE OF t`); term identity always derived
  server-side; existing authz/404 semantics untouched.
- **Finance enforcement (D-1/O-2)**: structure create (guard + create in
  one tx), structure update (guard inside the existing tx), invoice
  generation (preflight + re-assert inside the minting tx), invoice
  cancel (term resolved from the AUTHORITATIVE invoice→structure
  relationship; guard shares the cancellation tx). Explicitly ALLOWED
  and proven on a CLOSED term: arrears recordPayment, the full refund
  cycle, reconciliation reads, fees.csv (whose paid column shows the
  closed-term invoice NET).
- **netPaid consolidation**: new `apps/api/src/fees/money.ts` is the ONE
  canonical `Σ payments − Σ refunds`; all eight reducer sites now use it
  (fees paidAmount + summary, payments initiation + settlement, refunds
  recompute, fees.csv, and the two dashboards). **DEFECT-1 fixed**:
  admin dashboard `collected` and student dashboard `feeBalance` are
  net-aware; zero gross `payments.reduce` remains outside money.ts
  (grep-proven).
- **Tests: 528** (12 new): every mutation family 409 `TERM_CLOSED` with
  zero rows written; ACTIVE-control + reopen-then-mutate round trip;
  allowed-finance proofs; real-Postgres races (close vs invoice
  generation, close vs structure creation) proving the tx-level guard
  (Term-before-Invoice lock order preserved); DEFECT-1 regression:
  dashboard collected/outstanding EQUAL fees-summary totals before and
  after partial (400−150) and full (net 0 → invoice PENDING per D-5)
  refunds, with other invoices keeping the arithmetic non-trivial. One
  W1 assertion made suite-order-robust (seeded-terms-ACTIVE instead of
  a global CLOSED count).

### M17-W3 — Lifecycle UI + finance polish
- **Calendar**: CLOSED badge on term rows; "Close…" (hidden for the
  current term — D-3 hint) and "Reopen…" actions through a shared
  typed-confirmation dialog (exact label, busy-guarded, server remains
  authoritative); CLOSED rows expose only Reopen. Alloy-verified live:
  Spring 2027 closed (badge + toast + actions collapse) and reopened;
  demo terms restored to the exact pre-walkthrough snapshot.
- **Rollover execute dialog (D-4)**: explicit "Also close {source}"
  checkbox → `closeSourceTerm: true`; success toasts distinguish
  closed / TERM_IS_CURRENT-refused outcomes; rollover success never
  depends on the close result (W1 backend semantics unchanged).
- **Guardian refund read (D-5)**: `paymentSummary`'s CHILD short-circuit
  replaced with the existing `policy.can(fees.read, {studentProfileId})`
  check against the payment's invoice — linked guardians read the
  read-only summary, unlinked stay 404, mutations remain 403
  (finance.refund). e2e-tested (linked 200 + refundable, unlinked 404,
  guardian mutation 403).
- **Accountant landing (D-6)**: `/dashboard` now routes principals with
  NO dashboard.* grant to their first authorized nav item via the
  existing `navItemsFor` — purely permission-driven, zero role names;
  works for any future finance-only role. Alloy-verified: accountant
  login lands on /fees with finance-only navigation.
- **Tests: 528** (guardian projection cases added inside the refunds
  suite; count unchanged net of the added assertions living in an
  existing test). Full regression green; typecheck 0; both prod builds
  green.

### M17-W4 — Security audit + runbook (M17 CLOSED)
- **Adversarial re-audit: PASS.** Term.status is written ONLY by
  TermLifecycleService's CAS transitions (grep + trace); no
  terminal-state resurrection paths; typed confirmation and
  TERM_IS_CURRENT are server-authoritative under the row lock (proven
  by the W1/W2 suites, re-run green); zero role-name authorization
  conditionals; zero unscoped Term/mutation queries; zero
  client-controlled collegeId/status/isCurrent/audit metadata; guard
  coverage re-counted at every §10/§11 inventory site (attendance 3,
  exams 6+, assignments 6, timetable 3, sections 6, fees 5, rollover 2);
  allowed finance operations re-verified untouched; Term-before-Invoice
  lock order intact (no reverse path).
- **One consistency hardening**: `calendar.updateTerm` routed through
  the shared `assertTermOpen` guard (FOR SHARE) instead of its W2
  inline status check — identical behavior, uniform lock semantics.
- **DEFECT-1: RESOLVED (in W2, re-verified)** — no gross
  `payments.reduce` exists outside `money.ts`; the dashboard==summary
  regression tests remain green.
- **OPERATIONS §26**: term-lifecycle runbook — CLOSED semantics with
  the financial-history rationale, close/reopen procedures with typed
  confirmation and audit expectations, current-term and rollover
  interactions (explicit source-close checkbox, failure never undoes a
  rollover), full error-semantics table with safe recovery ("never
  manually mutate the database"), and a 7-point post-close checklist.

**M17 FINAL STATUS — CLOSED.** W0 design (`d53895c`) → W1 foundation
(`4a1093f`: migration #11, TermStatus, CAS close/reopen, D-3 under
lock, rollover hook) → W2 enforcement (`78210b2`: 21-site guard sweep,
netPaid consolidation, DEFECT-1 fix, tx-level race proofs) → W3 UI +
finance polish (`cc6599f`: calendar dialogs, rollover close offer,
guardian refund CHILD read (D-5), accountant landing (D-6)) → W4
close-out (this commit). Final: 528/528 tests (39 suites), 11
migrations, typecheck 0, both prod builds green. Deferred items
UNCHANGED: refund webhooks + dashboard registration (externally
blocked), provider polling, receipts/PDFs, advanced refund reporting,
maker-checker, P2-IDOR-1, per-college webhook secrets, monitoring/
backup automation, report cards/transcripts (M18 candidate), P3
register. No M18 work started.

### M18-W1 — Result finalization foundation
- **Migration #12** (`m18_academic_records`): `TermResultStatus`
  (FINALIZED|SUPERSEDED|VOID), `TermResult` (versioned immutable
  snapshot: collegeId belt, overall %, grade label/point, term GPA,
  credits attempted/earned, attendance %, remark, finalizedBy/At,
  `supersededById @unique` amendment chain) + `CourseResult`
  (denormalized immutable course lines — code/title/credits frozen so
  history survives catalog edits) + raw-SQL partial unique
  `TermResult_one_finalized_per_student_term`. Additive only.
- **`results.finalize`** permission (ADMIN-only via matrix; seeded
  idempotently). Zero role conditionals.
- **ResultsFinalizationService**: one transaction — Term FOR SHARE
  (serializes with M17 close/reopen), O-1 CLOSED-only re-check under
  the lock (`TERM_NOT_CLOSED`), snapshot computed exclusively from
  PUBLISHED exams' locked marks + term attendance, typed confirmation
  (term label), `NO_PUBLISHED_RESULTS` guard, partial unique as the
  concurrency CAS (`ALREADY_FINALIZED` for losers, zero partial rows).
  Amendment (O-5 foundation): recompute from current marks → version
  N+1, old row CAS FINALIZED→SUPERSEDED with the supersededById chain;
  superseded versions immutable and re-amendment refused. Endpoints:
  `POST /results/terms/:termId/finalize`, `POST
  /results/records/:id/amend`. Audits `results.finalized`/`amended`
  (ids/version only).
- **O-4 policy gap preserved honestly**: seeded GradeBands ship
  `gradePoint = null` — the repository defines NO official grade-point
  scale, so GPA/creditsEarned/pass-fail stay null until the institution
  configures its scale; once gradePoints exist, the locked
  credit-weighted formula computes (test proves 4.0×3 + 2.0×2 over 5
  credits = 3.2). No scale was invented.
- **Tests: 537** (9 new): migration structures; ACTIVE-term rejection;
  authz matrix (admin ✓, teacher/student/accountant 403, anon 401,
  rival term/student 404); frozen-value correctness (75% → B+ across
  3+2 credits); duplicate + true-concurrency finalize → [201,409] with
  one audit; immutability under direct mark edits AND term reopening
  (O-6); amendment chain v1→v2 with v1 preserved; GPA-when-configured;
  financial isolation + NO_PUBLISHED_RESULTS. One legitimate update:
  M17-W1's hardcoded "11 migrations" generalized (same precedent as
  M16→M17).
- NOT in W1 (W2/W3): report-card/transcript read endpoints, batch
  finalization, void, UI/print.

### M18-W2 — Report-card + transcript engines
- **Reads (results.read OWN/CHILD/ALL, exams.results precedent — never
  rebuilt from mutable marks)**: `GET /results/report/term/:termId`
  (the FINALIZED snapshot; OWN ignores requested ids and reads self;
  404 `NOT_FINALIZED` when no active snapshot),
  `GET /results/transcript` (O-3: dynamically assembled from FINALIZED
  snapshots only — SUPERSEDED/VOID excluded; frozen CourseResult
  code/title/credits, proven immune to later catalog edits).
- **CGPA**: credit-weighted across the FROZEN course grade points inside
  snapshots — computed only when EVERY finalized line carries a point
  (partial scales → honest null); live band re-configuration cannot
  rewrite historical CGPA (test proves 3.20 survives resetting the
  scale). All attempts count; repeat-course replacement stays deferred.
- **Batch finalization**: `POST /results/terms/:id/finalize-batch`
  loops the SAME single-student engine (per-student atomic txs,
  partial-unique CAS), returning per-student outcomes
  (ALREADY_FINALIZED / NO_PUBLISHED_RESULTS observed in-test).
  Worklist: `GET /results/terms/:id/finalization` (results.finalize).
- **VOID** (design §13): `POST /results/records/:id/void` — CAS
  FINALIZED→VOID, typed confirmation + reason, row and course lines
  preserved forever, transcript excludes it, superseded history
  untouched, re-void/void-superseded refused, `results.voided` audited
  once, and the freed partial-unique slot allows a fresh v1
  finalization.
- **Tests: 543** (6 new in the M18 suite → 15): snapshot-over-live-marks
  reads, catalog-edit immunity, transcript assembly + frozen-CGPA
  stability, guardian CHILD linked/unlinked + anon 401 + cross-college
  404s, worklist/batch outcomes + teacher 403, full VOID matrix with
  Mark/Term untouched. No schema changes; migrations stay 12.
- NOT in W2 (W3): report-card/transcript UI, print views, Alloy
  walkthrough.

### M18-W3 — Academic records UI + print
- **New pages** (pure presentation over the W2 APIs — zero frontend
  academic math, backend authoritative): `/results/record/[termId]`
  (finalized term report card: student/term header, frozen course table,
  overall/grade/GPA/credits/attendance, version note, dedicated
  NOT_FINALIZED explanation state) and `/results/transcript` (FINALIZED
  terms only, per-term tables + "Open report card" links, cumulative
  credits + CGPA block with an explicit "grade-point scale not
  configured" explanation when null). Shared render module
  `results/academic-record.tsx`; null GPA/points always shown as
  "Not configured"/"—", never 0.00.
- **Print**: reuses the M12-W3 browser-print pattern verbatim
  (window.print(), print-hide, print:border-0, break-inside-avoid) —
  no PDF dependency.
- **Navigation**: Results page header gains a Transcript link (carries
  the staff-selected studentId); guardian child page gains a Transcript
  link beside the existing per-exam Report card link. Permission-driven
  only; no role names; no new grants; the M12 per-exam report is
  untouched.
- **Alloy walkthrough**: temp fixture (CLOSED "W3DEMO" term, two
  published courses 88/100 + 62/100) finalized via the real API (75%,
  B+, GPA null) → student viewed transcript + report card read-only
  with honest Not-configured GPA and no mutation controls; admin read
  both via ?studentId (200); accountant refused (403, no results.read);
  guardian linked/unlinked paths already proven by the W2 e2e. Fixture
  fully removed afterwards — affected-table snapshot diffed EXACT; all
  four demo logins 200.
- **No backend/schema/permission changes**; tests stay 543/543; both
  prod builds green with the two new routes emitted.

### M18-W4 — Security audit + runbook (M18 CLOSED)
- **Source-level audit: PASS.** TermResult writes exist ONLY at the
  four intended CAS/insert points inside the finalization service
  (void CAS, supersede CAS, snapshot create, chain link); zero
  CourseResult update/delete paths anywhere; 17 collegeId gates on the
  M18 surface; live GradeBands consulted ONLY at finalization time —
  read paths render frozen values exclusively; zero role conditionals;
  zero client-controlled version/status/supersededById/finalizedById/
  collegeId; no hardcoded GPA scale, thresholds, rank, standing,
  repeat-course rules, dues gating or PDF dependencies anywhere; the
  W3 UI performs no academic math and exposes no mutation controls.
- **Two hardening assertions added** (genuine gaps): voiding a
  SUPERSEDED historical version is refused (409), and amend/void are
  403 for students/teachers/accountants — everything else was already
  proven by the existing 15-test suite (concurrency winner/loser,
  immutability under mark/catalog/band edits and reopen, VOID matrix,
  guardian scopes, batch reuse of the single engine).
- **OPERATIONS §27**: academic-records runbook — FINALIZED semantics,
  finalize prerequisites (CLOSED term, published marks, typed
  confirmation), batch partial-success interpretation, amendment
  version-chain rules ("never delete history"), VOID scope and limits,
  the honest GPA/CGPA reality (no scale → null; frozen points survive
  later edits; never fabricate GPA), guardian access, never-do-this
  list, full error-semantics table, and a 6-point verification
  checklist.

**M18 FINAL STATUS — CLOSED.** W0 design (`9c4f31c`) → W1 foundation
(`c555035`: migration #12, TermResult/CourseResult, finalize/amend
engine, results.finalize) → W2 engines (`68ad6a8`: report/transcript
reads, batch, VOID, frozen-CGPA) → W3 UI (`7f0062b`: report-card +
transcript pages, browser-print, guardian/student surfaces) → W4
close-out (this commit). Final: 543/543 tests (40 suites), 12
migrations, typecheck 0, builds green. Deferred/open (unchanged):
institutional grade-point scale (O-4 — GPA/CGPA null until
configured), repeat-course CGPA policy (O-11), rank/standing,
server-side PDF, advanced academic reporting, refund webhooks +
dashboard registration (externally blocked), provider polling,
receipts platform, maker-checker, P2-IDOR-1, per-college webhook
secrets, monitoring/backup automation, P3 register. No M19 work
started.

## 7. Architecture Evolution

Core request path (unchanged in shape since M1, extended in depth):

```
Next.js web (App Router, middleware routing hints)
        ↓  /api/v1 (same-origin proxy)
NestJS API — EnvelopeInterceptor / GlobalExceptionFilter
        ↓
JwtAuthGuard → PermissionsGuard → PolicyService (DB-resolved grants)
        ↓
Domain services (tenant-scoped by collegeId)
        ↓
Prisma ORM  →  PostgreSQL 16
```

Key flows:

- **Password authentication**: login → argon2id verify + rate limiter →
  15-min JWT (memory) + rotating hashed refresh cookie (`cos_refresh`,
  path `/api/v1/auth`) + routing-hint cookie (`cos_auth`); silent refresh
  rotates the family; reuse detection revokes.
- **Google OIDC (M11-W2)**: `GET /auth/google/start` → signed state cookie
  (state+nonce+PKCE verifier) → Google → `GET /auth/google/callback` →
  code exchange + JWKS verify + claim validation → AuthIdentity lookup by
  `sub` → the same session-issuance path as password login.
- **Student verification (M11-W3)**: evidence upload (purpose-restricted) →
  claim (college-scoped resolution, DB-enforced uniqueness) → admin queue →
  decision (atomic) → `verificationStatus` transition + notification +
  audit.
- **Signed file flow (M10-W1)**: modules store internal URLs; clients call
  `POST /files/sign` (which since M11-W3 also authorizes evidence access);
  `GET /files/:key?exp&sig` verifies HMAC timing-safe.
- **Notification/event flow**: domain services emit typed events after
  commit → listeners render templates → `Notification` rows → inbox/bell;
  daily scheduled sweeps for time-based notifications.
- **Tenant isolation**: `collegeId` scoping in every service query;
  cross-college reads/writes surface as 404.
- **Moderation flow (M8)**: reports → admin queue → actions (remove
  content/suspend) with audit and reporter immunity.

## 8. Database Evolution

| Migration | Purpose | Milestone |
|---|---|---|
| `20260820164746_init` | Complete Blueprint domain schema | M0 |
| `20260822062836_credential_tokens` | Hashed one-time INVITE/RESET tokens | M10-W2 |
| `20260822071747_m11_identity_foundation` | AuthIdentity, StudentIdentityClaim (+partial unique indexes), nullable passwordHash, verificationStatus | M11-W1 |
| `20260822163204_m11_evidence_files` | Purpose-restricted evidence file metadata | M11-W3 |
| `20260823050551_m11_oauth_state_consumption` | Atomic one-time OAuth state consumption (hashed) | M11-W7 |
| `20260823055843_m12_email_opt_out` | Single per-user notification-email opt-out boolean | M12-W2 |
| `20260824163131_m13_guardian_foundation` | GUARDIAN role, CHILD scope, GuardianLink relation | M13-W1 |

Security-critical constraints:

- **Tenant boundaries**: `@@unique([collegeId, email])` on User,
  `@@unique([collegeId, admissionNo])` on StudentProfile, college-scoped
  uniques on departments/courses/terms etc.
- **Unique identities**: `AuthIdentity @@unique([provider, providerSub])`
  (a Google account exists once, platform-wide) and
  `@@unique([userId, provider])`.
- **StudentIdentityClaim partial unique indexes** (raw SQL):
  one live (PENDING/APPROVED) claim per student profile; one in-flight
  claim per claimant — duplicate-account prevention that survives races.
- **Credential token hashing**: `CredentialToken.tokenHash @unique`
  (SHA-256; raw tokens never stored) with atomic single-use claims.
- **Foreign-key behavior**: Restrict on academic/financial references,
  Cascade only on pure children (refresh tokens, notifications,
  identities), SetNull on optional actor references.

## 9. Security Evolution

| When | Improvement | Problem → Solution → Testing |
|---|---|---|
| M1 | JWT + rotating hashed refresh tokens | Sessions needed to be revocable and theft-resistant → 15-min JWTs + opaque rotating refresh tokens hashed at rest with family reuse detection → auth e2e suite |
| M1 | PolicyService + tenant isolation | Role conditionals scatter and rot → single DB-resolved permission engine + collegeId scoping → permission-denial and tenancy tests in every module suite |
| M1 | Login rate limiting + generic errors | Credential stuffing/enumeration → per-account limiter, uniform `INVALID_CREDENTIALS` → 429 tests |
| M4→M10-W3 | Upload restrictions | Unbounded uploads → interceptor-level size limits (10 MB/1 MB CSV) → hardening tests |
| M10-W1 | Signed expiring file URLs | Permanent unauthenticated download links → HMAC(key\|exp), timing-safe verify, 5-min TTL → tamper/expiry/unsigned tests + byte-identical Alloy check |
| M10-W2 | Credential invitation tokens | Plaintext temp passwords in API responses → hashed one-time expiring tokens, unusable initial passwords → 12 e2e tests incl. reuse/revocation |
| M10-W3 | Production env validation, Helmet, CORS allowlist | Misconfigured prod could boot half-secure → fail-fast Zod validation (≥32-char secrets), security headers, deny-by-default CORS → hardening suite + manual prod-boot checks |
| M10-W4 | Seed protection | Demo accounts with public passwords must never reach production → loud refusal guard + explicit override → decision-logic + seed-CLI tests |
| M11-W1 | Identity uniqueness in PostgreSQL | Duplicate student accounts via racing signups → partial unique indexes → 5-way race test (exactly one winner) |
| M11-W2 | Google OIDC state/PKCE/nonce, JWKS, sub-keyed identity | OAuth CSRF/replay/pre-hijack via email match → signed one-time state cookie, PKCE S256, nonce, JWKS with rotation, `sub`-only identity, no email auto-link → 29 e2e tests incl. replayed state and email-squatting |
| M11-W7 | Cutover, rate limits, retention, shared OAuth state | Student password bypass of Google-only policy; disk-fill via uploads; token-endpoint flooding; state replay across instances; indefinite ID-card storage → server-side required-mode gate, explicit rate policies, R3 retention sweep with audit, DB-backed one-time state → 16 adversarial e2e tests |
| M11-W3 | Verification claims + evidence access control | ID-card evidence must be evidence, never a credential, and never publicly readable → purpose-restricted uploads (magic-byte MIME), sign-time authorization (owner/reviewer only, 404 otherwise), full audit → 24 e2e tests incl. signing matrix and enumeration safety |
| M11-W4 | Invitation-anchored verification + auto-supersession | Admin-created students had no duplicate-proof VERIFIED path; impostor claims could squat identity slots → transactional acceptance writing a synthetic APPROVED claim (DB slot held forever) and superseding impostor PENDING claims; token consumption is rollback-safe → 21 e2e tests incl. races and rollback |

## 10. Testing Evolution

Counts are the verified totals recorded in milestone reports (earlier
milestones' individual totals were not separately recorded; the suite
reached 141 by the end of M9):

| Milestone | Tests Passed | Important Coverage Added |
|---|---:|---|
| M9 (baseline) | 141 | full MVP regression incl. dashboards, security audit |
| M10-W3 | 151 | headers, env validation, CORS, upload limits |
| M10-W1 | 160 | signed URL tamper/expiry/unsigned, byte round-trip |
| M10-W2 | 172 | token hashing/expiry/one-time/revocation, no tempPassword |
| M10-W4 | 181 | seed guard decisions + real seed CLI runs |
| M10-W5 | 181 | (documentation + verification only) |
| M11-W1 | 192 | partial-unique constraints, claim races, fail-closed null password |
| M11-W2 | 221 | OIDC claim validation, state replay, PKCE, no email auto-link, unlink protection |
| M11-W3 | 245 | claim lifecycle, evidence sign authorization, atomic decisions, exactly-once notifications |
| M11-W4 | 266 | invitation onboarding (both methods × modes), supersession, token-neutral rollback, acceptance races |
| M11-W5 | 273 | lifecycle permission gate, /auth/config exposure, hint-cookie verification field |
| M11-W6 | 278 | admin queue search/pagination/filter contracts, stale-decision conflicts, route-permission map |
| M11-W7 | 294 | cross-instance OAuth state replay, rate-limit policies, retention purge (disk+DB), required-mode cutover |
| M12-W1 | 306 | mail content/absolute links, failure isolation, audit hygiene, header-injection, feature-off |
| M12-W2 | 314 | per-event email coverage, opt-out semantics, cross-college fan-out isolation, transactional exemption |
| M12-W3 | 327 | export authorization/tenancy matrices, CSV injection guard, report-card scope pinning |
| M12-W4 | 336 | audit viewer authorization/read-only contracts, filter matrix, cross-college audit isolation |
| M13-H0 | 338 | mailer tenant belt (adversarial), real 50k+1 over-cap 413 |
| M13-W1 | 348 | GuardianLink constraints, CHILD scope grant/deny/revoke, guardian surface denial matrix |
| M13-W2 | 363 | onboarding lifecycle, token reissue/replay, cross-college isolation, immediate revocation |
| M13-W3 | 379 | CHILD-scope IDOR matrix across results/attendance/fees/timetable/assignments, publication boundaries, revocation sweep |
| M13-W5 | 386 | assignment-detail CHILD gap, session-list CHILD closure, F2 limiter pruning |
| M14-W0 | 394 | timetable section-view scope gate, login-limiter pruning |
| M14-W1 | 405 | attempt lifecycle CAS, settle-once/replay, amount tampering, overpaid capping, recordPayment race |
| M14-W2 | 413 | initiation authz matrix, tamper-proof amounts, gateway failure/duplicate-ref handling |
| M14-W3 | 431 | webhook HMAC auth, settle-once idempotency matrix, verify-on-return ownership + truth routing |
| M14-W5 | 439 | reconciliation authz/tenancy matrix, gateway-verify routing, overpaid visibility, export ONLINE |
| M14-W6 | 442 | true-concurrency settlement races (manual vs gateway, dual attempts, settle vs fail) |
| M14-SBX | 443 | reporter dual-shape verifyPayment unit vectors |
| M15-W1 | 450 | calendar CRUD/tenancy matrix, DB single-current invariant, TermRollover uniques |
| M15-W2 | 461 | rollover D1–D8 execution matrix, failure-injection atomicity, concurrent-execute CAS |
| M15-W3 | 461 | no new API surface — UI verified via live Alloy walkthrough (no web test harness) |
| M15-W4 | 461 | docs-only close-out; audit relied on existing W1/W2 proofs (no duplicated tests) |
| M16-W1 | 476 | real-DB refund invariants (CHECK/partial-unique/FK), accountant grant matrix, seed idempotency |
| M16-W2 | 498 | refund engine adversarial matrix: money safety, CAS races, provider ambiguity, audit hygiene |
| M16-W5 | 502 | refunds.csv authz/tenancy/escaping/amount-format + fees.csv net-paid regression |
| M17-W1 | 516 | lifecycle CAS/lock matrix, D-3 under lock, transition races, rollover close-source integration |
| M17-W2 | 528 | closed-term 409 matrix across every family, tx-level guard races, DEFECT-1 dashboard==summary |
| M18-W1 | 537 | finalization CLOSED-only + partial-unique races, snapshot immutability under mark edits/reopen, amendment chain, GPA policy-gap honesty |
| M18-W2 | 543 | snapshot reads over live marks, catalog-edit immunity, frozen-CGPA stability, VOID matrix, batch outcomes |

Key security tests maintained across the suite: tenant isolation (every
module), race conditions (claims ×2 suites), authorization denial
(permission-based 403s everywhere), refresh-token rotation/reuse, signed
URL tampering, seed protection, OAuth state replay, duplicate-identity
prevention, enumeration safety.

## 11. Major Engineering Decisions

### Decision: PolicyService instead of role conditionals
**Problem:** role checks scattered across handlers become unauditable and
drift. **Decision:** one permission engine (`can`/`scopeFor`) reading a
DB-seeded matrix defined once in `packages/shared`. **Reason:** single
source of truth shared by API and web middleware; matrix edits take effect
without redeploys. **Consequence:** every later feature (moderation,
verification) added permissions, never conditionals.

### Decision: Google `sub` as the provider identity key
**Problem:** emails are mutable and recyclable; keying on them enables
pre-hijack account takeover. **Decision:** `AuthIdentity(provider,
providerSub)` unique, email stored only as display metadata.
**Alternatives considered:** email-keyed linking (rejected in the M11
blueprint). **Consequence:** email changes are a non-event; linking is
always explicit.

### Decision: No email-based automatic account linking
**Problem:** attacker-controlled Google accounts matching a victim's email
must not attach to the victim's account. **Decision:** unknown `sub` never
auto-links regardless of email match; linking requires an authenticated
session. **Consequence:** one extra explicit step for legitimate users;
class of takeover eliminated (tested).

### Decision: PostgreSQL uniqueness for duplicate-account prevention
**Problem:** application-level checks cannot survive concurrent requests.
**Decision:** partial unique indexes on StudentIdentityClaim + unique
AuthIdentity. **Consequence:** the invariant holds even with multiple API
instances; services translate `P2002` into generic errors.

### Decision: Signed file URLs (capability links) with sign-time authorization
**Problem:** browser downloads cannot carry bearer headers. **Decision:**
short-lived HMAC-signed URLs issued by an authenticated sign endpoint;
M11-W3 layered per-user authorization at signing time for restricted
classes (evidence). **Consequence:** `FILE_URL_SECRET` rotation is a global
kill switch; restricted file classes plug into the sign hook.

### Decision: Credential tokens instead of plaintext passwords
**Problem:** temp passwords in API responses/CSV summaries are a standing
leak. **Decision:** hashed one-time expiring INVITE/RESET tokens; accounts
start with unusable random passwords. **Consequence:** no plaintext
credential ever leaves the API; the pattern extends to future purposes
(e.g. Google-link invites).

### Decision: Lazy/scheduled notification behavior
**Problem:** time-based states (overdue invoices, due-soon assignments)
must not require per-request computation or external queues. **Decision:**
lazy status transitions on read plus daily scheduled sweeps for
notifications. **Consequence:** no queue infrastructure needed at MVP
scale.

### Decision: Single-college MVP on a tenant-safe schema
**Problem:** multi-college was out of MVP scope but a rewrite later would
be fatal. **Decision:** `collegeId` on every aggregate root from M0, with
college-scoped uniques. **Consequence:** M11's cross-college identity
rules composed naturally; multi-college is a data question, not a schema
migration.

### Decision: D3 — no account merging in v1
**Problem:** approving a claim whose profile belongs to another
login-capable account would require risky account merging. **Decision:**
`PROFILE_HAS_ACCOUNT` — reject with guidance; provision students through
invitations instead. **Consequence:** Google-born self-registrants bind to
profiles via the invitation path until a future merge feature is designed.

### Decision: Dormant GPA hooks
Grade bands and marks store everything needed for GPA/transcripts, but no
GPA computation ships in the MVP; the hooks stay dormant until a dedicated
milestone (see roadmap).

## 12. Problems, Bugs & How They Were Solved

| Problem | Detection | Root cause | Solution | Test added | Where |
|---|---|---|---|---|---|
| Web client fired parallel refreshes on 401 bursts | e2e/manual | no single-flight guard | single-flight refresh in the API client | regression in auth flow tests | M4 (`ee47c54`) |
| File links were permanent & unauthenticated | M10 security review | capability-less URLs | signed expiring URLs | 9 e2e tests (tamper/expiry) | M10-W1 (`5d35c5f`) |
| Temp passwords exposed in responses | M10 security review | M2-era design | credential tokens + unusable passwords | 12 e2e tests | M10-W2 (`86e9c96`) |
| Demo seed could run in production | M10 planning | no env guard in seed entrypoint | refusal guard + explicit override | 9 tests incl. real CLI runs | M10-W4 (`31e653f`) |
| Prisma auto-loads `.env`, so `SEED_DEMO=true` leaked into "unset" test env | W4 test failure | `@prisma/client` dotenv behavior | test models prod host with explicit `SEED_DEMO=false`; guard protects shipped dev `.env` too | seed-guard suite | M10-W4 |
| Hardcoded permission-catalog count (30) broke when W1 added permissions | regression run | literal in `auth.e2e-spec.ts` | assert against shared `PERMISSIONS` length | updated test | M11-W1 (`2581a21`) |
| `/accept-invite` was redirected to login by middleware | manual Alloy flow in W2 | route not in public list | `ALWAYS_PUBLIC_PATHS` for `/accept-invite` | covered by manual flow + page tests | M10-W2 |
| Evidence would have been signable by anyone authenticated | W3 design review | M10-W1 signatures authenticate the issuer, not the viewer | sign-time authorization for evidence keys (owner/reviewer, 404 otherwise) | signing matrix tests | M11-W3 (`51069ab`) |

## 13. Deferred Work / Technical Debt

| Item | Why Deferred | Current Status | Planned Phase |
|---|---|---|---|
| Evidence retention deletion job (30 days post-approval, D5) | — | **Resolved in M11-W7** (daily sweep per policy R3) | done |
| OAuth consumed-state store is in-memory | — | **Resolved in M11-W7** (`OauthStateConsumption`, atomic across instances) | done |
| `FILE_URL_SECRET` rotation has no dual-key grace window | 300 s TTL makes impact negligible | documented in OPERATIONS.md | future ops enhancement |
| Account merging for claims on provisioned profiles | D3 locked: reject-with-guidance in v1 | `PROFILE_HAS_ACCOUNT` behavior in place | post-M11 design |
| Student password cutover enforcement at login (`required` colleges) | — | **Resolved in M11-W7** (server-side USE_GOOGLE_LOGIN gate) | done |
| Rate limits are per API instance (no shared store) | Blueprint §14 deliberately avoids Redis | documented ceiling = policy × instances | revisit if horizontally scaled |
| Student `/verify` UI + admin verification UI | backend-first ordering | API complete (W3) | M11-W5/W6 |
| Prisma major-version upgrade available | upgrade advisory only | pinned to 5.22 | maintenance window |
| Backups are documented cron scripts, not shipped automation | — | **Resolved in M19-W3** (compose `backup` sidecar, 14-day rotation, restore-verify drill, OPERATIONS §28); off-host copies/PITR still deferred | off-host copies: future ops |
| GPA/transcripts | out of MVP scope | dormant hooks (grade bands, marks) | roadmap |
| F2 rate-limiter bucket pruning | — | **Resolved in M13-W5** (lazy in-band sweep) | done |
| F3 `results.csv` includes unpublished marks | intentional: admin ALL-scope marks export; published-only surface is `/results` | documented (OPERATIONS §19/§21) | accepted behavior |
| Guardian link revoke/list endpoints unlimited | admin-only, state-guarded (409 on repeat), consistent with other admin mutations | reviewed M13-W5, no limit needed | revisit only on abuse evidence |
| Login limiter unbounded memory | — | **Resolved in M14-W0** (lazy sweep, mirrors F2) | done |
| Guardian section-timetable over-read (P2-GUARD-1) | — | **Resolved in M14-W0** (academics.read scope gate) | done |
| Ordinary-file signing has no ownership record (P2-IDOR-1) | — | **Resolved in M19-W1** (`StoredFile` ownership + sign-time tenant/owner authz, migration #13; underivable legacy keys grandfathered by design) | done |
| Real Safepay sandbox verification | — | **Substantially resolved (M14-SBX)**: real payment, decline, paisa, verify-recovery all LIVE-VERIFIED; genuine webhook delivery/replay still pending dashboard endpoint registration | register webhook endpoint |
| Single global webhook secret (env-only) | V1 decision #7: single-tenant start | per-college gateway config table when a second college onboards | multi-college payments |
| `GET /grade-bands` readable by guardians | college-wide grading config, no PII; grades already visible on results | reviewed M13-W5, acceptable | none |

## 14. Current System State

## M19-W1 — Stored-file ownership authorization (P2-IDOR-1)

O-1 approved as designed. Migration #13
(`20260828055018_m19_stored_file_authorization`) adds `FilePurpose` +
`StoredFile` (collegeId, key unique, purpose, ownerUserId?, createdById?,
Restrict college FK, SetNull user FKs) and backfills ownership rows for every
DERIVABLE legacy key: EvidenceFile rows (EVIDENCE), Post attachments
(COMMUNITY_ATTACHMENT), Assignment attachments via Section (OTHER),
Submission fileUrl via Section/StudentProfile (SUBMISSION) — all idempotent
(`ON CONFLICT (key) DO NOTHING`), keys sanity-filtered. Non-derivable keys get
NO row and stay grandfathered (M10-W1 capability-URL behavior), so every
existing stored URL keeps working; the grandfathered class only shrinks.

Enforcement: new `StoredFileAuthzService` (files module). Every upload
(`POST /files` and verification evidence) records ownership insert-first
(unique key = idempotency backstop). `POST /files/sign` now runs
EvidenceAuthzService (unchanged, stricter) THEN StoredFileAuthzService:
recorded keys are signable by their owner or same-college members;
foreign-tenant callers get 404 indistinguishable from a missing file. Evidence
retention purge also removes the ownership row. No new permissions, no role
conditionals, no client collegeId, no ownership metadata in responses.

New suite `test/stored-file-authz.e2e-spec.ts` (11 tests, real Postgres):
ownership recording, response-shape minimality, owner/same-college/
cross-college matrix, missing-file behavior, cross-college owner precedence,
grandfathered legacy keys (all users, download round-trip), simulated
backfilled row tenancy, evidence strictness preserved (same-college teacher
404), duplicate-insert uniqueness (both racers P2002, original row survives),
malformed-URL rejection. M18 migration-count assertion updated 12 → >=12
(forward-only migrations are expected to accrue). 554/554 tests, typecheck 0,
13 migrations, prod builds green, stack healthy.

## M19-W2 — Input & guardian-privacy hardening

**A. Mail escaping.** All HTML entity-escaping now happens at the single
`layout()` chokepoint in `mail/templates.ts`: every line is escaped for
text-node AND attribute context; URL paragraphs become anchors only for
`^https?://` (escaped in both href and text, so quotes/ampersands cannot
break the attribute); `javascript:`/`data:` values render as inert escaped
text. Plain-text bodies and subjects unchanged (subjects remain covered by
MailService CR/LF sanitization). No template engine added; appearance for
benign input identical.

**B. Google callback limiter.** New `googleCallback` policy (60/min per IP,
same engine and identity as `googleStart`), asserted before any state/cookie
processing. Query params are attacker-controlled and deliberately excluded
from the key — varying them cannot bypass the limit. Process-local by design
(Blueprint §14; per-instance bound documented). 429 envelope carries no
OAuth state, codes or cookies.

**C. Emergency-contact channel (O-2, approved).** Audit confirmed the
`StudentProfile.guardian*` columns are written only via tenant-scoped
`users.manage` create/update, returned ONLY by the student-detail endpoint,
absent from lists/exports/imports/dashboards/guardian APIs/mail, and used
nowhere for authorization. Hardening: detail now returns the contact fields
(and address) only to full-scope staff (`users.read` ALL) and the student
themself (OWN); ASSIGNED-scope teachers keep record access but receive null
PII. Columns relabeled as emergency-contact in schema comments, shared-type
docs and web UI labels — names/data unchanged, GuardianLink remains the sole
authorization channel. No migration needed (migration count stays 13).

New suite `test/m19-w2-hardening.e2e-spec.ts` (14 tests): hostile
HTML/quote/ampersand payloads render as entities; legitimate https anchors
preserved; javascript:/data: URLs inert; attribute-breakout blocked; CR/LF
injection flattened; callback throttling at threshold with param-variation
bypass attempt, safe under-limit behavior; emergency-contact matrix
(admin/self see values, ASSIGNED teacher nulls, cross-college 404, list
minimization, matching contact email grants no guardian access, unlink
leaves no residual access). 568/568 tests (42 suites), typecheck 0, 13
migrations, prod builds green, stack healthy.

## M19-W3 — Operational reliability (O-3/O-4)

**Backup automation (O-3).** New `backup` sidecar in
docker-compose.alloy.yaml (postgres:16 image → matching pg_dump) runs
`scripts/backup/backup-loop.sh`: custom-format dump on start + every 24h
into the `pgbackups` named volume (`/var/backups/campusos`), 14-day
pattern-scoped rotation. Dumps are written as `.partial`, TOC-verified with
`pg_restore --list`, then renamed — a crashed dump never counts as a
backup. `.gitignore` blocks `*.dump`/`backups/`. Destination = local named
volume per O-3; off-host copies stay a §6 deployment concern.

**Restore drill.** `scripts/backup/restore-verify.sh` restores the newest
dump into the hard-coded disposable `campusos_restore_verify` database,
asserts representative data (colleges, users, ≥13 finished migrations, all
four demo accounts), drops the scratch DB. Executed for real in the
sandbox: PASS; live demo DB verified byte-identical before/after
(row counts + user-email md5 checksum), all four demo logins 200.

**Deep health (O-4 internal V1).** `GET /health/ops` gated by existing
`settings.manage` (PolicyService; public `/health` unchanged): database
up/down, migrations applied/unfinished (from `_prisma_migrations`), backup
freshness from the api container's read-only pgbackups mount
(configured/count/latestAgeSeconds/stale vs 26h threshold, `.partial`
ignored), uploadsWritable, uptime; overall `degraded` on any failure
signal. Response carries no credentials, DSNs, paths or filenames
(test-asserted). New shared `OpsHealthStatus` type. OPERATIONS.md §28
runbook (procedures, failure table, never-do list, V1 limitations).

New suite `test/ops-health.e2e-spec.ts` (6 tests): 401/403 gates, healthy
report shape, fresh-backup reporting, stale-backup degradation,
missing-directory degradation, no-sensitive-output assertion. 574/574
tests (43 suites), typecheck 0, 13 migrations, prod builds green, all four
containers up (api/web/postgres healthy + backup sidecar).

## M19-W4 — Final audit & close-out — **M19 CLOSED**

Full-surface security re-audit (W1–W3 plus general greps) found **zero new
defects**; no code changes were required and no tests were manufactured.
Verified: stored-file tenant/owner/evidence-precedence/grandfathering
behavior and traversal guards; the single escaped mail chokepoint is the
only interpolated `href` in the API; callback limiter executes before any
state/cookie processing with per-IP keying; guardian privacy scope gates
and GuardianLink exclusivity; backup scripts' fixed deletion pattern,
`.partial`/TOC-verify gating and hard-coded scratch DB; `/health/ops`
permission gate and zero-leak response. Grep sweeps: no raw/unsafe SQL, no
shell exec, no client-controlled collegeId (the sole `input.collegeId` is
the server-side StoredFile recorder fed from `user.collegeId`), no
role-name authorization conditionals (the two `role`-string matches are
pre-M19 domain checks: guardian account-type integrity and community group
membership roles), no client-reachable destructive DB commands, no web
`dangerouslySetInnerHTML`. Documented non-defect observations: a failed
ownership insert after `storage.save` would orphan an unguessable,
never-disclosed key (negligible; grandfather class only shrinks), and
signed URLs remain bearer capabilities for their 5-minute TTL by design.

Backup/restore re-verified live in W4: fresh dump
(`campusos-20260829T054756Z.dump`, TOC-verified), restore drill PASS into
the disposable DB, scratch dropped, live demo DB checksum identical
before/after (`20|1|13|45eff7cf…`), retention rotating (2 dumps), all four
demo logins 200. OPERATIONS §28 extended with M19 security close-out notes.

**M19 FINAL STATUS: CLOSED.** W0 `fb6c474` (design) → W1 `7fdec0e`
(StoredFile authorization, migration #13) → W2 `9b19017` (mail escaping,
callback limiter, emergency-contact privacy) → W3 `d726952` (backup
automation, restore drill, /health/ops) → W4 (this commit). Final: 574
tests / 43 suites, typecheck 0, 13 migrations, prod builds green, four
containers healthy. Debt retired with evidence: P2-IDOR-1, un-escaped mail
interpolation, callback limiter gap, guardian-PII over-exposure, backup
non-automation. Deferred verbatim: off-host backup copies, PITR, external
SaaS monitoring, distributed/shared rate limiter, Safepay webhook
registration/replay (EXTERNALLY BLOCKED), per-college webhook secrets,
provider polling, receipts/PDF platform (M20 candidate), maker-checker,
GPA scale/repeat-course/rank policy, Prisma upgrade, FILE_URL_SECRET
rotation.

## M20-W0 — Finance documents discovery + design (design only)

Baseline `cd7b10c` re-verified (574/574, 43 suites, typecheck 0, 13
migrations, builds green, stack healthy). Source-traced discovery
confirmed: CampusOS has ZERO financial documents (no receipts, receipt
numbers, printable confirmations, refund documents, or PDFs — "receipt"
appears only in design docs); money truth is the immutable Payment/Refund
ledger + `netPaid()`; the proven document pattern is M12/M18 browser print;
invoiceNo is the only human finance number (per-college unique,
count-based). `docs/M20_FINANCE_DOCUMENTS_DESIGN.md` (30 sections)
recommends **Option B: immutable snapshot receipts + refund documents
(new FinanceDocument table, migration #14), RCP-/RFD- per-college
numbering with retry-on-unique allocation, ACTIVE|VOID only (no version
chain — money rows never mutate), browser-print rendering, fees.read
OWN/CHILD/ALL + fees.manage reuse (no new permission), server-side PDF and
StoredFile FINANCE_DOCUMENT purpose explicitly deferred**. Open decisions
O-1…O-15 recorded with recommendations; Safepay webhook status unchanged
(EXTERNALLY BLOCKED, and not a dependency — documents anchor on verified
immutable rows). Implementation was NOT started: no schema, migration,
source, UI, test, seed, or package changes — this workstream is
documentation only.

## M20-W1 — Finance document foundation

O-1…O-15 approved as designed. Migration #14 (`m20_finance_documents`)
adds `FinanceDocument` + `FinanceDocumentKind`/`FinanceDocumentStatus`:
per-college unique `receiptNo` (`RCP-/RFD-<year>-<seq5>`, stored
`year`/`sequence`), `paymentId`/`refundId` UNIQUE (one document per money
row — DB-enforced idempotency), Restrict FKs on college/invoice/payment/
refund (documents are undeletable historical evidence), SetNull on
issuer/voider, and the full frozen snapshot (studentName, admissionNo,
rollNo, invoiceNo, structureName, collegeName/code, amount, method,
masked reference, paidAt, invoiceAmount, balanceAfter, receivedByName,
parentReceiptNo).

`FinanceDocumentsService` (fees module): documents are issued INSIDE the
same transaction as every money event — manual `recordPayment`, gateway
`settleAttempt`, and both refund-success paths (PROVIDER + RECORDED) —
snapshotting at issuance under the existing invoice `FOR UPDATE` lock.
Numbering is `max(sequence)+1` under a per-(college, kind, year)
`pg_advisory_xact_lock` (never count-based), taken strictly AFTER the
invoice lock; the unique index is the backstop and the standalone paths
retry on P2002 with a bumped sequence. Historical (pre-M20) rows get
on-demand issuance: POST `fees/payments/:id/receipt` and
`fees/refunds/:id/document` (`fees.manage`), replays 409 ALREADY_ISSUED.
Void: POST `fees/documents/:id/void` (`fees.manage`, reason ≥5 chars,
CAS ACTIVE→VOID only, number consumed forever, `fees.receipt_voided`
audit in-tx). Issuance audits `fees.receipt_issued` in-tx. Refund
documents reference the parent receiptNo and NEVER touch the payment
receipt (O-5); the internal refund reason never enters a document.
No new permissions, zero role conditionals, collegeId always
server-derived, no client-controlled number/status/audit identity.

New suite `test/finance-documents.e2e-spec.ts` (14 tests, real Postgres):
migration structures; auto-issuance on manual recording with full frozen
payload + masked reference; historical issuance + concurrent duplicate
(one 201/one 409, one row, one audit); 4-way REAL concurrent issuance
(distinct numbers); per-college numbering independence; deterministic
retry-on-P2002 via an out-of-band colliding number; cross-college 404
indistinguishable from missing; authz matrix (401/403/teacher/student);
RECORDED refund auto-document linked to parent receipt with receipt
untouched; historical refund document + 409; full-snapshot immutability
under renames/later money (byte-identical row); void CAS race +
INVALID_TRANSITION + exactly-one audit + number consumption; financial
isolation (Payment/Invoice byte-identical after issue+void); failed
issuance emits no audit + hostile-body override attempt ignored.
Existing finance suites' cleanups updated to delete documents before
money rows (FK Restrict) — assertions untouched. 588/588 tests
(44 suites), typecheck 0, 14 migrations, prod builds green, stack
healthy, demo logins verified. W2 (read API) NOT started.

## M20-W2 — Finance document read API + authorization hardening

Read surface (no schema change — migrations stay at 14): GET
`fees/documents` (paginated list; filters kind/invoiceId/studentId) and
GET `fees/documents/:id`, both `fees.read` with the EXACT invoice scope
semantics — ALL (admin/accountant, optional studentId filter), OWN
(student, server-filtered via `invoice.student.userId`; mismatches 404
indistinguishable from missing), CHILD (guardian: explicit studentId +
ACTIVE GuardianLink via PolicyService, 400 MISSING_TARGET without a
target, 403/404 without a link, revocation removes access). VOID
documents remain readable history (never hidden/deleted); reads never
mutate. New shared `FinanceDocumentItem` contract = exactly the frozen
snapshot + lifecycle: internal cuids (college/payment/refund/invoice/
staff), numbering internals and unmasked references never leave the API —
the W1 mutation endpoints now return the same minimized contract (W1
tests updated to prove tenancy/sequence from DB rows instead).

New suite `test/finance-documents-read.e2e-spec.ts` (11 tests, real
Postgres): anon 401 / teacher 403; ALL reads + studentId filter; OWN
isolation with byte-identical 404s for foreign/missing; tampered
studentId/collegeId query params ignored under OWN + invalid kind 400;
full CHILD matrix incl. revoked-link denial; cross-college 404 + empty
list; strict payload key-allowlist + masked reference + no internal-id
leakage; read-path immutability under renames + a later RECORDED refund
(byte-identical payload, refund document independently readable with
frozen parentReceiptNo, internal refund reason absent, receipt stays
ACTIVE); VOID read semantics (lifecycle fields only change — frozen
fields proven equal); repeated reads leave the row byte-identical;
legacy money without documents reads as absent (nothing fabricated).
599/599 tests (45 suites), typecheck 0, 14 migrations, prod builds
green, stack healthy, demo logins verified. W3 (print UI, mail links)
NOT started.

## M20-W3 — Finance document UI, print & mail links

**UI** (pure presentation over the W2 API — zero frontend finance
arithmetic, zero reconstruction from live tables): `/fees/documents`
(scoped list; students reach it via a "My receipts" action, staff via a
"Documents" action on the fees page; guardians pass ?studentId= for a
linked child) and `/fees/documents/[id]` — official-style print view in
the M12/M18 pattern (`window.print()`, `.print-hide`, print CSS), showing
only the frozen `FinanceDocumentItem` contract: number, kind, ACTIVE/VOID
badge, VOID watermark + void date/reason banner, frozen student/invoice/
college/amount/masked-reference snapshot, "balance at issuance" labeling.
Invoice detail gained a "Documents" section (GET
/fees/documents?invoiceId=) linking each issued receipt/refund document;
legacy money without documents renders nothing (no fabrication).

**Mail**: `payment_succeeded`/`refund_succeeded` templates accept an
optional `receiptUrl` rendered through the existing M19-escaped `layout()`
chokepoint (no new template kinds, no attachments, CR/LF handling
untouched); the fees listener resolves the document by the settled
attempt's paymentId / refundId and appends the `/fees/documents/<id>` link
only when a document exists. The link is presentation only — the page
re-authorizes via the API (asserted: anon fetch of the linked API resource
is 401); internal refund reasons never appear in mail.

New suite `test/finance-documents-mail.e2e-spec.ts` (3 tests, real events
through EventsService + capturing transport): payment-success mail carries
the correct escaped receipt anchor; refund-success mail carries the refund
document link and never the internal reason; legacy settlements without
documents send the unchanged mail. Live browser verification through the
preview (student login): OWN-scoped list (another student's receipt
invisible), ACTIVE receipt detail (masked reference `…000222`, frozen
figures), VOID document (watermark + reason, still readable/printable),
invoice-detail Documents section links. Verification fixtures fully
removed; demo invoice restored byte-level (balance 800, single seeded
payment, PARTIAL); all four demo logins 200. 602/602 tests (46 suites; one
known first-run webhook flake re-ran clean), typecheck 0, 14 migrations
(unchanged), prod builds green, stack healthy. W4 close-out NOT started.

## M20-W4 — Hardening, runbook & close-out — **M20 CLOSED**

Full-surface W4 audit (A–J) found **zero product defects**; one genuine
TEST-ISOLATION defect was discovered and fixed: the W3 mail suite emitted
real payment/refund events for the demo student without cleaning the
Notification rows they created, intermittently inflating the
payments-webhook suite's exactly-once notification count on full runs —
its afterAll now removes those rows (suite-local cleanup only; zero
assertions changed; two consecutive clean 602/602 full runs after the
fix). Every mandated invariant was already covered by the 28 M20 tests
(14 foundation + 11 read + 3 mail) and re-verified green:
authorization matrix (fees.read OWN/CHILD/ALL, fees.manage mutations,
teacher/anon denial), tenancy/IDOR (server-derived collegeId only,
byte-identical 404s, hostile query/body params inert), immutability
(byte-identical rows/payloads after renames/refunds/void/reads; the sole
`updateMany` is the tenant-gated CAS void writing lifecycle fields only;
no delete path exists), numbering/concurrency (advisory lock after invoice
lock, P2002 duplicate-vs-collision distinction, bounded retry, per-college
sequences), financial isolation (money.ts untouched since M17; Payment/
Invoice rows proven byte-identical across issue+void), audit exactly-once,
data minimization (22-key allowlist, masked references, no reasons/tokens/
cuids), mail security (receiptUrl through the M19 chokepoint; escaping
suite green), UI/print (no frontend arithmetic, no live reconstruction,
no PDF/storage deps — grep-proven). Grep sweeps clean: no role
conditionals, client collegeId, raw SQL, shell exec, or
dangerouslySetInnerHTML in the M20 surface.

Operational re-verification: fresh backup (TOC-verified) + restore drill
PASS into the scratch DB (live DB checksum identical before/after:
`20|1|0|14|45eff7cf…`); `/health/ops` 401 anon / admin `ok` (db up, 14/0
migrations, backups fresh, uploads writable); all four demo logins 200;
api/web/postgres healthy + backup sidecar. OPERATIONS.md gained §29 —
the definitive finance-document runbook (semantics, issuance, numbering,
void policy, authz matrix, error codes, never-do list, deferred items,
verification checklist).

**M20 FINAL STATUS: CLOSED.** W0 `c491c00` (design) → W1 `857d680`
(migration #14 + issuance engine) → W2 `c455031` (read API + hardening) →
W3 `edd4b8d` (UI/print/mail links) → W4 (this commit). Final: 602 tests /
46 suites, typecheck 0, 14 migrations, prod builds green, stack healthy.
Debt retired with evidence: the "receipts/PDF platform (M20 candidate)"
item — immutable numbered receipts + refund documents + browser-print now
exist. Deferred verbatim: server-side PDF, StoredFile FINANCE_DOCUMENT
purpose, branding fields, receipts.csv, mail attachments, Safepay webhook
registration/replay (EXTERNALLY BLOCKED), per-college webhook secrets,
provider polling, maker-checker, off-host backups, PITR, external
monitoring, distributed limiter, GPA scale/repeat/rank policy, Prisma
upgrade, FILE_URL_SECRET rotation.

## M21-W0 — Platform discovery + design (design only)

Read-only discovery from baseline `12a7eca` (re-verified 602/602,
typecheck 0, 14 migrations, builds green, stack healthy before and after).
`docs/M21_PLATFORM_DISCOVERY_DESIGN.md` (27 sections) audits the full
platform, reclassifies the debt register with evidence, and investigates
seven candidates. **Key finding**: `UserStatus`
(ACTIVE/SUSPENDED/ARCHIVED) is enforced at every auth boundary (guard,
refresh tokens, Google, credential tokens, PolicyService) and
`users.manage` is documented as "archive and suspend user accounts" — but
NO endpoint or UI can change a status; offboarding requires raw SQL. Also
newly registered: dead `attendanceWarningThreshold`/`locale` settings
(seed-only, never read), Google-auth-only settings UI, observability-V1
remainder (no error counters/request IDs). No critical security defect
found. **Recommended M21: Account Lifecycle & Institutional
Administration** (suspend/reactivate/archive + instant session revocation
+ admin UI + settings completion + dead-config disposition) — internally
unblocked, low-risk, prerequisite for real-institution operation and
future multi-college work. Open decisions O-1…O-8 recorded (API shape,
status metadata/migration #15, transition matrix, self/last-admin
protection, locale disposition, threshold surfacing, profile-status
coupling, guardian visibility). All deferred items preserved verbatim;
Safepay webhooks remain EXTERNALLY BLOCKED. Implementation was NOT
started — this workstream is documentation only.

## M21-W1 — Account lifecycle administration

O-1…O-4/O-7 implemented as approved. Migration #15
(`m21_account_lifecycle`, additive/nullable, no backfill): User gains
`statusReason?`, `statusChangedAt?`, `statusChangedById?` (SetNull
self-FK). New `UserLifecycleService` + verb endpoints (`users.manage`):
POST `/users/:id/suspend` (reason ≥5 chars), `/reactivate`, `/archive`
(reason). Transition matrix: ACTIVE→SUSPENDED, SUSPENDED→ACTIVE,
ACTIVE|SUSPENDED→ARCHIVED, **ARCHIVED terminal** — all CAS
(`updateMany` on expected from-status; losers 409 INVALID_TRANSITION)
under a per-college `pg_advisory_xact_lock` that serializes lifecycle
transitions and makes the last-admin count race-proof. Protections:
CANNOT_MODIFY_SELF (server actor identity only); LAST_ADMIN — the
"usable admin" set is derived from ROLE_PERMISSION_MATRIX data (roles
granted users.manage), never role-name conditionals. Leaving ACTIVE
revokes every live refresh token in the SAME transaction (defense in
depth on top of the existing per-request status re-reads). Audit
`users.suspended|reactivated|archived` in-tx with reason metadata;
failed transitions write nothing. Tenancy: foreign/nonexistent targets =
byte-identical 404; hostile body fields inert. Response = minimal
{id, status, statusReason, statusChangedAt}. Academic profile status
untouched (O-7); GuardianLink untouched (O-8); no new permissions.

New suite `test/account-lifecycle.e2e-spec.ts` (11 tests, real Postgres):
authz matrix + reason validation; full transition matrix with metadata,
server-derived actor and exactly-once audits; SUSPENDED→ARCHIVED; instant
lockout with a REAL live token (works → suspend → same token 401; refresh
family revoked in-tx; reactivation restores login without resurrecting
revoked refresh tokens); self-protection; last-admin protection incl. a
REAL mutual-suspension race between the only two admins of a college
(exactly one wins; ACTIVE-admin count never reaches zero) and a
suspended-admins-don't-count scenario; tenancy with hostile-body
smuggling; concurrent duplicate suspension (one 201/one 409/one audit);
failed-transition zero-residue; login-block regression for SUSPENDED and
ARCHIVED. Demo accounts never targeted; fixtures FK-safe-removed;
post-run DB shows 20 users all ACTIVE, 1 college, demo logins 200.
613/613 tests (47 suites), typecheck 0, 15 migrations, prod builds
green, stack healthy. W2 (settings) NOT started.

## M21-W2 — Settings completion & threshold surfacing

**Settings (no schema/migration — College.settings JSON only, migrations
stay at 15).** `collegeSettingsSchema` gains `attendanceWarningThreshold`
(int 0–100, default 75); the strict PATCH schema accepts it (bounds
validated, unknown keys rejected); merges keep preserving unknown keys via
passthrough; changes audited as before. Settings UI gains the editable
threshold field with display-only copy.

**O-5 locale**: RESERVED as approved — documented in the schema file,
preserved verbatim by passthrough, deliberately not schematized/patchable
(PATCH {locale} → 400) and with zero runtime behavior; no data changed.

**O-6 threshold surfacing (read-only V1)**: both attendance summaries
(student + section) now return `warningThreshold` and per-row
`belowThreshold` computed server-side from college settings; attendance
calculations/records untouched (record-count proof in test); NO new
notification/alert. The web student attendance view's HARDCODED `>= 75`
color rule — the very defect that made the setting dead config — now uses
the server flag.

New suite `test/m21-w2-settings.e2e-spec.ts` (6 tests, real Postgres):
GET default + 401/403 gates; PATCH bounds/audit/merge + unknown-key
rejection; locale + arbitrary future keys survive writes and locale is
unpatchable; threshold flags proven in both directions (100 → flagged,
0 → clear) on student AND teacher section views with records untouched;
rival-college settings isolation; W1 lifecycle regression guard
(CANNOT_MODIFY_SELF intact). Demo settings snapshot-restored exactly.
619/619 tests (48 suites), typecheck 0, 15 migrations, prod builds green,
stack healthy, demo logins 200. W3 (admin UI) NOT started.

## M21-W3 — Account lifecycle admin UI

New `components/account-lifecycle-card.tsx` (presentation only — the W1
backend stays authoritative): status badge with changed-at + reason,
Suspend dialog (reason ≥5, explains immediate lockout/session
revocation), Reactivate, Archive dialog with a strong PERMANENT warning;
ARCHIVED renders terminal (no actions, explicit copy); visibility hinted
by `hasPermission('users.manage')` (capability data, no role names);
errors surfaced verbatim via toasts (CANNOT_MODIFY_SELF,
INVALID_TRANSITION, validation, 404s). Integrated on student and teacher
detail pages; directories badge non-ACTIVE accounts (SUSPENDED warning /
ARCHIVED danger). API additions: `statusReason`/`statusChangedAt` in
StudentDetail/TeacherDetail, projected ONLY for full users.read scope
(ASSIGNED/OWN receive null — account administration data, mirroring the
M19 emergency-contact minimization); shared types updated. No migration
(still 15), no new permissions, no backend rule changes.

Tests: +1 e2e (lifecycle metadata scope projection) → suite 12; full
regression 620/620 (48 suites), typecheck 0, prod builds green. Live
browser verification via the preview as the demo admin against a fixture
student created through the real API: suspend (reason validation,
disabled-submit until valid, SUSPENDED badge + reason + changed-at,
revocation toast) → reactivate (ACTIVE restored) → archive (permanent
warning, ARCHIVED terminal — no reactivation path) → directory ARCHIVED
badge. Fixture removed FK-safe (incl. credential/refresh tokens + audit
rows); post-run DB: 20 users all ACTIVE, 13 profiles, demo logins 200.
W4 close-out NOT started.

## M21-W4 — Hardening re-audit & close-out — **M21 CLOSED**

Full M21-surface re-audit found **zero defects; no code changes were
needed** (docs-only workstream). Verified by the green 620-test suite and
targeted source review: complete transition matrix + ARCHIVED
terminality; self/last-admin protections (matrix-data-derived admin set,
advisory-lock-serialized count — no role names, no read-then-write
races); CAS exactly-one-winner semantics; in-transaction refresh-token
revocation with live-token death re-proven; exactly-once audits and
failed-transition zero-residue; byte-identical 404s for foreign/missing
targets with hostile-body fields inert; scope-gated status metadata
projection; settings threshold validation/tenancy and inert reserved
locale; no deletion paths, raw/unsafe SQL, shell/eval,
dangerouslySetInnerHTML, new dependencies, or new permissions anywhere in
the M21 diff chain (the sole `role !==` hit remains the documented
pre-M19 guardian account-type integrity check). Live browser
re-verification with a disposable fixture: SUSPENDED display (reason +
timestamp + correct Reactivate/Archive actions) — fixture then removed
FK-safe; final DB state 20 users all ACTIVE / 13 profiles / 1 college;
all four demo logins 200. OPERATIONS.md gained §30 (states, transition
table, suspension/archival semantics, protections, break-glass recovery,
never-do list, verification checklist, deferred limitations).

**M21 FINAL STATUS: CLOSED.** W0 `c907026` (discovery/design) → W1
`0f613f1` (migration #15 + lifecycle API) → W2 `492b8f9` (settings
completion + threshold surfacing + locale reservation) → W3 `2da1d03`
(admin UI) → W4 (this commit). Final: 620 tests / 48 suites, typecheck 0,
15 migrations, prod builds green, stack healthy. Debt retired with
evidence: the enforced-but-inoperable UserStatus lifecycle (offboarding
no longer requires SQL), the dead attendanceWarningThreshold config, and
the Google-auth-only settings UI. Deferred verbatim: account deletion,
leave workflow, notification preferences/digest, global search,
observability completion (error counters/request IDs), reporting, server
PDF, StoredFile FINANCE_DOCUMENT, receipts.csv, mail attachments, Safepay
webhooks (EXTERNALLY BLOCKED), per-college secrets, provider polling,
maker-checker, off-host backups, PITR, external monitoring, distributed
limiter, i18n, multi-college, GPA/repeat/rank policy, Prisma upgrade,
FILE_URL_SECRET rotation.

## M22-W0 — Platform discovery + design (design only)

Read-only discovery from `41fc42b`; baseline re-verified before and after
(620/620, 48 suites, typecheck 0, Prisma valid, 15 migrations, builds green,
stack healthy). `docs/M22_PLATFORM_DISCOVERY_DESIGN.md` inventories the
current platform, reclassifies all significant deferred work with source
evidence, evaluates nine candidate milestones, and recommends **M22 —
Production Runtime Reliability & Incident Visibility**.

Highest-priority findings: public `/health` can remain HTTP 200/top-level
`ok` when PostgreSQL is down while Compose checks only HTTP status; automated
backup exists in Alloy Compose but not production Compose, where unconfigured
backups are not degraded; production Compose/example env does not carry all
supported Google/SMTP/Safepay settings; there are no request IDs, structured
request/error events, error/rate-limit counters, or log rotation. No critical
exploitable security defect was found. One latent integration-reliability
finding is registered without implementation: a Safepay event is claimed
before settlement and a broad catch can convert an unexpected post-claim
failure to consumed HTTP 200; webhook activation remains EXTERNALLY BLOCKED
and O-7 decides whether bounded remediation belongs in M22.

Candidate ranking: production runtime reliability first, institutional
reporting second, GPA/configuration third; notification preferences, leave,
multi-college, global search, PDF and upgrades remain lower/blocked/deferred.
Open decisions O-1…O-10 cover request-ID trust, liveness/readiness routes,
log volume/schema, uploads protection, off-host target boundary, production
backup mode, webhook failure scope, counter scope, request-ID response
contract, and log identity fields. No M22 implementation, schema, migration,
test, UI, package, Docker or runtime change was made.

## M22-W1 — Request correlation & safe operational logging

O-1/O-3/O-9/O-10 implemented with no migration/dependency/Docker/API-body
change. Early `requestContextMiddleware` assigns every request an effective
`x-request-id`: bounded ASCII `[A-Za-z0-9._-]` (1–128) is accepted; missing,
oversized, whitespace, quote/JSON-breaking, Unicode or control-character IDs
are replaced by `crypto.randomUUID()`. The effective ID is returned on success
and error responses and stored in AsyncLocalStorage, so downstream logging
requires no parameter threading and concurrent requests remain isolated.

`OperationalLogger` emits allowlist-only one-line JSON request completion and
5xx classification records: timestamp/level/service/environment/event,
requestId, method, framework route template, status/duration and safe error
code/class/message. There is deliberately no API for bodies, response data,
raw paths/query strings, headers/cookies, IP, email/name, tenant/user IDs,
tokens, payment references, stacks or arbitrary metadata; all strings are
bounded and JSON-encoded. Successful public health probes are suppressed to
bound volume. AuditLog is untouched. The centralized exception filter now
logs every 5xx (including known HttpException 5xx previously invisible) once
as a fixed classification without exposing exception messages/stacks; client
envelopes remain byte-compatible. Request-completion and classification
events are distinct; no error is independently logged elsewhere by W1.

New `test/request-correlation.e2e-spec.ts` (11 tests): generated and accepted
IDs, hostile replacement (including direct CR/LF/control boundary tests),
response-header/body compatibility, 30-task AsyncLocalStorage isolation plus
overlapping HTTP contexts, fixed-schema/redaction sentinels for query/auth/
cookie/User-Agent, real FEATURE_DISABLED 503 classification, unexpected Error
500 redaction, 4xx not misclassified, arbitrary-key rejection and bounded
message JSON validity. 631/631 tests (49 suites), typecheck 0, Prisma valid,
15 migrations up to date, API/web production builds green, all four
containers healthy; live response/header and JSON log verified. W2 truthful
health/counters, W3 production backup/deployment parity and W4 close-out were
NOT started.

## M22-W2 — Truthful readiness & bounded runtime counters

Public health is now operationally truthful: `/health` remains the
readiness-compatible alias, `/health/ready` is explicit readiness, and both
return HTTP 503 + `status: degraded` when required PostgreSQL connectivity is
down; `/health/live` is a separate process-only 200 probe that never touches
the DB. Healthy response bodies remain compatible and M22-W1 `x-request-id`
headers remain unchanged. A real container drill stopped PostgreSQL and proved
live=200/readiness=503, then restored PostgreSQL and readiness=200; DB snapshot
before/after remained 20 users / 1 college / 15 migrations.

New fixed allowlist `OperationalCounters` (memory only): requestsCompleted,
responses4xx, responses5xx, known5xx, unexpected5xx, rateLimitRejections.
The single response-finish hook owns HTTP category increments; the centralized
filter only classifies known-vs-unexpected 5xx, preventing double counting.
No generic label API exists, so route/query/user/tenant/IP/policy/token values
cannot create cardinality. Counters reset on process restart and are exposed
only inside the existing settings.manage-gated `/health/ops` as
`scope: instance`, resetAt and aggregate numbers. Migration probe failures now
return `migrations.status: error` and degrade ops health rather than appearing
as zero unfinished migrations. No database/AuditLog/Redis/external metrics,
new permission, migration or Docker change.

New `test/runtime-reliability.e2e-spec.ts` (10 tests) plus ops assertions:
healthy readiness; modeled DB-down 503; DB-independent liveness; correlated
public probes; fixed names/start/reset; real 200/401/503 exact counting;
unexpected-500 classification; 429 fixed bucket/no sensitive labels;
concurrent increment integrity; protected/minimized ops output. M22 operational
suites 27/27; full regression 641/641 (50 suites), typecheck 0, Prisma valid,
15 migrations, production builds green, stack healthy. Webhook activation and
the latent post-claim failure disposition remain deferred: safe remediation
may require processing-state design and was not necessary for W2. W3
production backup/deployment parity and W4 close-out were NOT started.

## M22-W3 — Production backup/deployment parity

Production and Alloy Compose now share the verified operational contract:
paired DB/uploads backup sidecar with complete-cycle health marker, 14-day
rotation and 5-minute failure retry; named uploads/pgbackups volumes with
least-privilege mounts (backup sees uploads RO, API sees backups RO, web sees
neither); backup and web healthchecks; readiness-driven API health; bounded
Docker json-file logs (5 × 10 MB) for all services. Production API loads the
untracked `.env.production`, and its example now covers PostgreSQL plus all
already-supported Google/SMTP/Safepay variables; `.env.production` is
gitignored and a new `.dockerignore` excludes env/runtime/secret artifacts
from build context. No integration was enabled and no secret committed.

Production image validation discovered and fixed two concrete runtime defects:
Prisma could not detect OpenSSL in `node:22-bookworm-slim` (OpenSSL now exists
in build + runtime stages; production-image `prisma migrate status` proven),
and a fresh named uploads volume is root-owned so the non-root API cannot
write it. A one-shot, root-only `uploads-init` service now chowns only that
volume before API/backup startup; direct failure and init-then-write success
were both reproduced. The API itself remains non-root.

Backup scripts: `backup-cycle.sh` publishes freshness only after custom DB
dump AND same-stamp uploads tar both validate; failed cycles clean exact
artifacts and leave health stale; retention runs only after a complete pair.
`backup-healthcheck.sh` rejects absent/malformed/future/stale markers.
`restore-verify.sh` is now production-safe (source/restored counts + hashed
internal-ID fingerprint, no demo-account assumption); uploads verifier rejects
absolute/`..` archive members and extracts to disposable scratch. API backup
health counts matching pairs and requires the cycle marker — a DB-only dump
cannot appear healthy.

Real infrastructure evidence: successful complete pair + sidecar health;
intentional missing-uploads failure produced nonzero exit/no marker/no
artifacts; old matching artifacts pruned while unrelated file survived;
database restored to scratch with exact fingerprint and scratch dropped;
upload probe matched byte-for-byte after scratch extraction; backup path 404,
direct upload path redirected to login with no file content, and unsigned file
API 403. Probe and probe pair removed; clean
final pair created. Live DB fingerprint unchanged (20 users/1 college/15
migrations). Focused backup/ops/file suites 41/41; full regression 646/646
(51 suites), typecheck 0, Prisma valid, 15 migrations; production API/web
images built from their Dockerfiles (host-network validation plumbing), and
the production API image ran `prisma migrate status` successfully. Off-host
backup and PITR remain deferred; webhook
activation unchanged. W4 close-out NOT started.

## M22-W4 — Hardening, drills & close-out — **M22 CLOSED**

Full re-audit of the W1–W3 surface (correlation, AsyncLocalStorage context,
logger, exception filter, counters, health routes, backup scripts, Compose
boundaries, build context) found **one genuine defect**, fixed here:
`.dockerignore` excluded only root-level `uploads`/`backups`/dumps, so the
git-ignored `apps/api/uploads` directory (6,234 test-generated user files) was
copied into image build contexts. Patterns now cover all nesting levels plus
archives, and a build-stage inspection proves no env files, uploads, backups,
dumps or archives reach the image. Everything else verified with no change:
fixed-schema logger with no arbitrary-key path, six compile-time label-free
counters with no increment-by-name API and no HTTP reset, request IDs as
correlation only, readiness/liveness separation, pattern-scoped retention, and
unchanged authorization/tenancy (no new permission, role conditional, client
tenancy, dependency, dynamic execution or delete path).

New `test/observability-hardening.e2e-spec.ts` (4 tests) closes the remaining
mandated gaps: context propagation through nested awaits/timers/fan-out, no
context leakage into background execution (and background events omit
`requestId`), exactly one single-line-JSON record per event, and read-only
counter semantics on ops health (stable `resetAt`, monotonic values).

Live drills: PostgreSQL stopped → liveness 200, readiness and `/health`
503/degraded, no business mutation; restored → readiness 200, migrations
truthful, normal API 200. Backup failure in a disposable directory → nonzero
exit, previous marker and pair preserved, zero partials, health still valid.
Paired restore → dump TOC valid, fingerprint matched, scratch DB dropped,
uploads archive extracted in scratch with byte-identical probe. Boundaries →
backup cannot write uploads, API cannot write backups, web mounts neither,
traversal archive rejected. Logs → bounded 5 × 10 MB on all services in live
containers and rendered production config; live request log contained no
cookie, bearer token, query value or email. Demo state unchanged
(20 users/1 college/13 profiles/15 migrations, all four logins 200); probe and
scratch artifacts removed, leaving one clean verified pair.

Documented limitation (no code change, authorization deliberately not
relaxed): `/health/ops` authenticates against the database, so during a full
outage it returns a generic 500; `/health/ready` is the outage signal.

**M22 FINAL STATUS: CLOSED.** W0 `b7fcbcc` → W1 `7f59346` → W2 `373faa0` →
W3 `2a5808d` → W4 (this commit). Final: 650 tests / 52 suites, typecheck 0,
Prisma valid, 15 migrations, production API/web images built, all containers
healthy. Deferred verbatim: off-host backups, PITR, external monitoring,
durable/distributed metrics, Redis/Prometheus/OpenTelemetry, distributed rate
limiting, reporting/analytics, GPA policy, global search, notification
preferences/digest, leave workflow, server PDF, StoredFile FINANCE_DOCUMENT,
receipts.csv, mail attachments, Safepay webhook activation and the latent
post-claim webhook remediation, provider polling, maker-checker, multi-college,
i18n, Prisma upgrade, FILE_URL_SECRET rotation, account deletion.

*Last updated after M22-W4 (M22 CLOSED).*

## M23-W0 — Platform discovery + design (design only)

Read-only discovery from `116127d`; baseline re-verified before and after
(650/650 tests, 52 suites, typecheck 0, Prisma valid, 15 migrations, builds
green, containers healthy, demo fingerprint `50424fec…` unchanged).
`docs/M23_PLATFORM_DISCOVERY_DESIGN.md` re-verifies M0–M22, reconciles the
debt register against source, and re-ranks candidates.

**Highest-priority finding (S-1, HIGH, newly discovered):** the M18
finalized-records read path silently treats `ASSIGNED` as `ALL`.
`resolveReadTarget` handles OWN and CHILD only
(`exams/results-finalization.service.ts:250-285`), so any TEACHER
(`results.read: ASSIGNED`) can read any same-college student's finalized
report card and transcript via `?studentId=`. Proven read-only in this
workstream: transcript for a not-taught student returned **200** with
identity/credits/CGPA fields, while the correctly narrowed siblings
`GET /results` and `GET /attendance/summary` both returned **403**. Tenancy
holds; this is an intra-tenant horizontal over-read.

Also newly found: **D-1** `GET /exports/fees.csv?termId=` returns **500**
because the filter is spread onto `Invoice`, which has no `termId`
(`exports/exports.module.ts:198-203`; term lives on `FeeStructure`);
**D-2** `updateGradeBands` deletes and recreates bands without `gradePoint`
(`exams/exams.service.ts:762-776`), so the only grade-point configuration
path erases data and GPA remains unconfigurable; **S-2** several mutating
paths emit no audit event, most consequentially fee-structure updates that
recreate all components (`fees/fees.service.ts:201-236`); plus lower-severity
S-3/S-4/D-3 and operational findings (retention pruning has no keep-N floor,
no CI, no lint, no web test harness, notification scheduler and bulk student
import untested).

Verified resolved and removed from the open register: readiness truth,
production backup parity, uploads backup protection, integration env parity,
observability V1, log retention, build-context exclusions, account deletion
(terminal archival), StoredFile finance purpose (not applicable as code). All
other deferred items were re-verified and preserved verbatim, including
Safepay webhook activation (EXTERNALLY BLOCKED) and off-host backups/PITR.

**Recommended M23: Authorization Correctness & Audit Integrity** — W1 scope
remediation (S-1), W2 audit coverage (S-2), W3 data-integrity fixes (D-1,
D-2), W4 hardening/close-out. No migration expected; reporting/analytics moves
to M24. Open decisions O-1…O-8 recorded. A stale current-state footer in this
file (claiming 12 migrations, 543 tests and M15 as latest) was corrected as a
factual documentation fix. No implementation was performed: no source, schema,
migration, package, UI, Docker or configuration change, and no security defect
fixed.

*Last updated after M23-W0 (design only — M23 NOT implemented).*

## M23-W1 — finalized-results ASSIGNED scope enforcement (S-1)

Closes the HIGH-severity intra-tenant horizontal authorization defect
found in M23-W0. Authorization correctness only: no migration, no schema
change, no new permission, no new role, no new endpoint, and no change to
finalization, grading or CGPA behaviour.

**Root cause.** `resolveReadTarget`
(`apps/api/src/exams/results-finalization.service.ts`) resolved the
`results.read` scope through PolicyService and then branched on `OWN` and
`CHILD` only. Every other scope — including `ASSIGNED`, which is the
TEACHER grant — fell through to a bare same-college `StudentProfile`
lookup and was returned as an authorized target. The M18 read path was
written when `results.read` was documented as OWN/CHILD/ALL; the TEACHER
`ASSIGNED` grant was never given a branch, so the widest fallback applied
to it. Tenancy was never bypassed (the lookup is `collegeId`-scoped);
what was missing was the intra-tenant narrowing.

**Rule implemented (approved O-1 semantics).** Under `ASSIGNED`, the
target student must hold an `ACTIVE` `Enrollment` in a `Section` of the
caller's own college for which the caller holds a `TeachingAssignment`.
This is the identical server-derived relationship already enforced for
live marks (`exams.service.ts`) and attendance summaries
(`attendance.service.ts`), so the three student-targeted read paths now
agree. Teacher identity comes from the authenticated session
(`teacher: { userId: user.id }`); `collegeId` remains server-derived.
Denial reuses the existing `notFound('Student')` shape already used for
CHILD and unknown students, so an unassigned student is indistinguishable
from a nonexistent one and the fix introduces no enumeration oracle.

No new permission, no role-name conditional, and no client-supplied
value (`scope`, `collegeId`, `teacherId`, `actorId`, `status`) carries any
authorization weight. `results.read` has exactly two consumers; the other
was already correct, so the root cause is fully contained — no other
endpoint required the same fix.

**Proof.** New suite `apps/api/test/m23-w1-results-authz.e2e-spec.ts`
(18 real-Postgres tests) covers the whole A–O matrix: assigned allowed;
same-college unassigned denied; another teacher's student denied both
ways; unassigned teacher reads nobody; DROPPED enrollment is not access;
OWN/CHILD/ALL preserved; revoked and unrelated guardians denied; rival
tenant denied in both directions even with a genuine rival-side
assignment; assignment removal and reassignment flip access immediately;
unknown/foreign/unassigned ids share one error code; repeated and forged
requests are deterministic. A data-minimization test asserts the denied
response carries no identity, CGPA, grade, mark or course payload, with a
positive control proving the authorized response does. Reverting only the
service change fails 10 of the 18 tests — the tenancy test still passes,
matching the discovery finding exactly.

Live re-check of the exact discovery request: the teacher→not-taught
student transcript that returned **200** with identity and CGPA now
returns **404** with an error envelope only, while a legitimately taught
student still returns 200. Ten live checks across two teachers, a
student and an admin all behaved as specified; all fixtures were removed
and the demo fingerprint is unchanged.

Verified: 668/668 tests (53 suites, +18), typecheck 0, Prisma valid,
15 migrations up to date (unchanged), API and web production images
build, all four containers healthy, preview 200, demo fingerprint
`50424fec…` identical, 0 leftover fixtures.

M23-W2 was NOT started. S-2 (unaudited mutations), D-1 (fees CSV
`termId` 500) and D-2 (grade-band `gradePoint` erasure) were NOT
implemented and remain open exactly as recorded. All other deferred items
are preserved unchanged.

*Last updated after M23-W1 (S-1 remediated; W2–W4 not started).*

## M23-W2 — audit integrity for the S-2 mutation surface

Closes finding S-2. Audit coverage only: no migration, no schema change,
no new permission, no new role, no new endpoint, no UI, and no change to
authorization, tenancy, financial semantics or mutation behaviour beyond
the audit side effect.

**What was unaudited.** W0's inventory was re-traced and confirmed
exactly: eight configuration/academic mutation paths whose `create`
sibling was already audited emitted nothing on update —
`fees.updateStructure`, `exams.update`, `exams.updatePaper`,
`calendar.updateYear`, `calendar.updateTerm`, `sections.update`,
`timetable.updateSlot` and `assignments.update`. The most consequential
is the fee-structure update, which deletes and recreates every
`FeeComponent`, silently rewriting what all future invoices will charge
with no record of who changed it.

**Events added** (existing `<domain>.<entity>_<verb>` convention, all
riding existing permissions — `fees.manage`, `exams.manage`,
`academics.manage`, `timetable.manage`, `assignments.manage`):
`fees.structure_updated`, `exams.updated`, `exams.paper_updated`,
`academic_years.updated`, `terms.updated`, `sections.updated`,
`timetable.slot_updated`, `assignments.updated`.

**Metadata is a shape summary, never a payload.** A new pure helper
`apps/api/src/audit/changed-fields.ts` records the *names* of the fields
that actually differ from the stored row, computed server-side from the
validated input and the tenant-scoped row that was read. A no-op PATCH
yields `changed: []` rather than echoing back every field the client
sent, and a client cannot widen the list by sending extra keys because
only an explicit allowlist is ever considered. Free-text content
(assignment descriptions), component labels, credentials and personal
data are deliberately excluded. The fee-structure event additionally
carries the minimum needed to understand the financial effect:
`termId`, `componentsReplaced`, component counts before/after, totals
before/after, and the count of already-issued invoices (whose snapshot
amounts are unaffected, per M14 semantics).

**Atomicity.** `AuditService.log()` is deliberately fire-and-forget: it
swallows write failures so audit trouble can never fail a business
operation. That is right for its existing callers but wrong here, where
a swallowed failure would let a mutation commit silently unaudited. A new
additive `AuditService.logAtomic(entry, tx)` therefore *requires* a
transaction client and lets errors propagate, so the caller's transaction
rolls back and neither the mutation nor the audit row survives. Existing
`log()` behaviour and every existing caller are untouched. All eight
mutations now run inside a transaction with the audit write as the final
statement, so the record exists if and only if the mutation committed.

**Proof.** New suite `apps/api/test/m23-w2-audit-integrity.e2e-spec.ts`
(35 real-Postgres tests): exactly-once on success with server-derived
actor and tenant; zero audit rows for anonymous, forged-token,
under-privileged, cross-college, nonexistent-target and
failed-validation attempts; a CLOSED-term rejection rolling back the
component rewrite and the audit together; hostile
`actorId`/`userId`/`collegeId`/`role`/`scope`/`metadata` body fields
proven inert against the recorded actor, tenant, target and metadata;
an injected audit failure proven to roll back the component rewrite with
no residue, followed by proof the path still works; reads writing
nothing; racing updates yielding exactly one record per committed
mutation; all seven remaining paths audited once each and silent when
denied; a metadata leak scan; and a check that S-1 remains closed.
Reverting only the fee-structure audit call fails 8 of the 35 tests.

**D-4 — newly discovered PRE-EXISTING defect, reported and NOT fixed.**
Concurrency testing exposed that `updateStructure` replaces components
with `deleteMany` + `createMany` and writes `totalAmount` in the same
transaction but takes no lock on the `FeeStructure` row. Under READ
COMMITTED, concurrent updates interleave, so the surviving component rows
can come from one transaction while `totalAmount` comes from another,
leaving the stored total different from the sum of the stored components
(observed: total 4010 vs component sum 1004 under six racing writes).
The code is byte-identical to pre-W2 HEAD apart from the appended audit
call, so this is unchanged M14/M17 behaviour and not a regression.
Fixing it means adding row locking to a financial write path, which is
outside W2's authorization. It is therefore documented in the suite
(serial single-writer consistency is asserted; the interleaving is
described, not blessed) so the behaviour cannot change silently, and it
is recorded here as an open defect awaiting separate authorization.

Verified: 703/703 tests (54 suites, +35), typecheck 0, Prisma valid,
15 migrations up to date (unchanged), API and web production images
build, all four containers healthy, preview 200, demo fingerprint
`50424fec…` identical, 0 leftover fixtures, 0 restore_verify DBs.
`AuditLog` remains append-only, so test suites leave rows behind as they
always have; no `AuditLog` row is ever deleted by application code.

M23-W3 was NOT started. D-1 (fees CSV `termId` 500), D-2 (grade-band
`gradePoint` erasure) and D-4 (above) were NOT implemented. All other
deferred items are preserved unchanged.

*Last updated after M23-W2 (S-2 closed; W3–W4 not started).*

## M23-W3 — data integrity (D-4, D-1, D-2)

Three defect fixes, each proven by a test that failed before the change
and passes after. No migration, no schema change, no shared-contract
change, no new permission, no new endpoint, no UI, no `money.ts` change,
and no change to `results-finalization` (S-1 stays closed). Evidence
first: the suite was written and run against unfixed code, where **18 of
25 tests failed**, reproducing all three defects; after the fixes all 25
pass, stable across four consecutive runs.

### D-4 — fee-structure write consistency

**Root cause.** `updateStructure` replaced components with `deleteMany` +
`createMany` and wrote `totalAmount` in the same transaction, but took no
lock on the `FeeStructure` row. Under READ COMMITTED concurrent writers
interleaved, so the surviving component rows could come from one
transaction while `totalAmount` came from another, committing a blended
state where `totalAmount != SUM(components)`.

**Fix.** Added the project's established row-lock, matching the Invoice
locks in `payments.service` / `refunds.service`:
`SELECT id FROM "FeeStructure" WHERE id = ${id} FOR UPDATE` — a
parameterized, row-scoped lock taken *after* the existing
`assertTermOpen` Term `FOR SHARE`, preserving the established
Term-before-row lock order. No advisory or global lock, so unrelated
structures and other colleges are never serialized. The pre-state is now
re-read **under** the lock, so the audit's before-values describe a state
that actually existed rather than a stale pre-lock read.

**Evidence.** Six writers race the same structure over four rounds: the
committed state always satisfies `totalAmount == SUM(components)` and is
exactly one writer's proposal, never a blend (asserted by matching the
surviving label set to precisely one proposal). Concurrent writes across
two structures and a rival tenant stay isolated, with the rival
untouched and zero rival audit rows. Injected audit failure still rolls
back both the component rewrite and the audit. Authorization is
unchanged (teacher/student 403, anonymous 401, accountant 200).

### D-1 — fees CSV `termId` filter

**Root cause.** `exports.fees` spread `{ termId }` directly onto
`Invoice`, which has no `termId` column, so every `?termId=` request
raised a Prisma validation error and returned **500**.

**Fix.** Filter through the existing required relationship:
`{ structure: { termId } }`. `Invoice.structureId` is non-null and
`FeeStructure.termId` is the only term relationship in the finance
schema, so an invoice's term is unambiguous — no new relationship, no
denormalized column, no invoice/payment semantics touched. The
server-derived top-level `collegeId` still bounds the query.

**Evidence.** Live re-check: `?termId=<real>` went from **500** to **200**
with correctly term-scoped rows. Tests prove the no-filter export is
byte-compatible (same header and columns), each term returns only its own
invoices, an unknown `termId` is a deterministic empty export rather than
a 500, a **rival-college `termId` returns nothing and leaks no rival
invoice**, `status` still composes with `termId`, a client-supplied
`collegeId` cannot widen the export, and authorization is unchanged
(teacher/student 403, anonymous 401, accountant 200).

### D-2 — grade-band `gradePoint` erasure

**Root cause.** `updateGradeBands` deleted and recreated all bands via
`createMany` without the `gradePoint` column, so *every* grade-band edit
silently reset the entire configured GPA scale to null — after which
`results-finalization` correctly reported CGPA as unavailable, because it
only computes a GPA when every course line carries a point (M18 O-4).

**Fix.** Replacement semantics are preserved (bands are still deleted and
recreated), but `gradePoint` is now carried forward, matched by `label` —
the existing per-college identity of a band (`@@unique([collegeId,
label])`). A label that did not previously exist gets `null`: **no GPA
policy is invented**. `gradePoint` deliberately remains server-managed —
it is absent from `gradeBandsUpdateSchema` and from `GradeBandItem`, so
the read and write contracts are unchanged and a client cannot set or
forge it. The transaction became interactive (read → delete → create) so
the preservation read is atomic with the replacement, and the existing
`grade_bands.updated` audit moved *into* that transaction via
`logAtomic`, per W2 discipline, gaining count-only metadata
(`bandCountBefore`, `bandCountAfter`, `gradePointsPreserved`) — no
labels, no thresholds, no payload.

**Evidence.** With a scale configured, an ordinary update preserves every
value (previously all became null); changing percent boundaries preserves
them too; a new label gets `null` rather than an invented point and a
removed label drops out; a hostile body sending
`gradePoint: 99 / -5 / 'abc'` is ignored and the server-side values
survive, with the read contract still exposing exactly
`id, label, minPercent, maxPercent, sortOrder`; existing validation
(`BANDS_OVERLAP`, min-2 bands, 0–100 range) is unchanged and a rejected
update erases nothing and writes no audit; authorization unchanged
(teacher/student 403, anonymous 401) and the rival college's bands are
untouched.

### Verification

728/728 tests (55 suites, +25), typecheck 0, Prisma valid, **15
migrations** up to date (unchanged), API and web production images build,
all four containers healthy, live/ready/preview 200, backup healthy, demo
fingerprint `50424fec…` identical, demo grade bands restored exactly as
snapshotted (all eight, `gradePoint` still null), 0 leftover fixtures,
0 restore_verify databases. Security/diff audit clean: no role-name
conditionals, no client-controlled `collegeId`/`actorId`/scope/status, one
parameterized `FOR UPDATE` as the only added SQL, no shell/eval, no
secrets, no financial arithmetic outside existing reducers, `money.ts`
and the shared contracts untouched, CSV schema unchanged, and no GPA
policy introduced (`gradePoint` is only ever read from the database).

The stale M23-W2 note describing D-4 as "not fixed" was corrected and its
deliberately relaxed `componentCountAfter` assertion tightened back to an
exact value, which the row lock now guarantees.

**Deferred/open items unchanged.** Still open from W0: community mutation
updates and evidence-upload audit (S-2 remainder), S-3, S-4, S-5, D-3,
the O-A…O-H operational findings (no CI, no lint, no web test harness,
retention keep-N floor, off-host backups, PITR, external monitoring,
distributed metrics/rate limiting), T-1…T-6 test gaps, reporting/analytics
(M24 candidate), global search, notification preferences/digest, leave
workflow, server PDF, StoredFile FINANCE_DOCUMENT, receipts.csv, mail
attachments, Safepay webhook activation (EXTERNALLY BLOCKED), provider
polling, multi-college, i18n, dependency upgrades and maker-checker.
Account deletion remains NO-LONGER-RELEVANT (terminal archival is the
model). No deferred item was silently closed.

**One residual observation, not fixed (out of W3 scope).**
`updateGradeBands` remains a college-wide delete-and-recreate without a
row lock, so two simultaneous grade-band edits could still contend; the
`@@unique([collegeId, label])` constraint makes a blended result fail
rather than commit silently, which is why it was left alone rather than
widened into another financial-style locking change. Recorded for triage.

*Last updated after M23-W3 (D-4/D-1/D-2 fixed; W4 not started, M23 NOT closed).*

## M23-W4 — final re-audit, regression and close-out (**M23 CLOSED**)

Close-out workstream: verification and documentation only. **No source
change was required or made** — the only repository changes are this
history entry, the design-doc disposition register and a new
`OPERATIONS.md` §32 runbook. No migration, no schema, no dependency, no
permission, no role, no infrastructure change.

### Environment note (investigated, benign)

The sandbox database was re-provisioned between W3 and W4: all 15
migrations applied at `2026-09-03 13:05:39` and all 20 demo users seeded
at `13:05:40`, whereas W1–W3 ran on 2026-09-02. The demo *user set* is
identical (same 20 emails and roles, all ACTIVE) and every count matches,
but the cuids are new, so the W1–W3 user-id md5 `50424fec…` was
session-specific. The W4 reference fingerprint is
`users=20 active=20 students=13 colleges=1 migrations=15
md5=3792769493b0f6b4467c8997cef311b5`, and it was **identical before and
after** all W4 verification. This was treated as a stop-condition,
investigated to root cause, and confirmed as environment re-provisioning
rather than an unexpected mutation.

### Re-audit results

**S-1 authorization (W1) — re-verified CLOSED.** `results.read` still
resolves solely through `PolicyService.scopeFor`; `ASSIGNED` still
requires an ACTIVE `Enrollment` in a `Section` of the caller's own
college for which the caller holds a `TeachingAssignment`, with teacher
identity from the session. Live: assigned student 200; same-college
unassigned 404; each teacher denied the other's student in both
directions; DROPPED enrollment 404; removing the assignment revokes
access immediately and restoring it restores access immediately; OWN
still self-only with requested ids ignored; ALL still tenant-bounded;
nonexistent and unassigned targets return an identical status and error
code, so existence is not disclosed; denied bodies carry no name,
rollNo, grade, CGPA or percentage. PolicyService was not refactored and
scope semantics were not widened.

**S-2 audit integrity (W2) — re-verified.** All eight configuration/
academic paths remain audited (`fees.structure_updated`, `exams.updated`,
`exams.paper_updated`, `academic_years.updated`, `terms.updated`,
`sections.updated`, `timetable.slot_updated`, `assignments.updated`),
plus `grade_bands.updated` from W3 — nine `logAtomic` call sites. Each
path performs its tenancy-scoped lookup *before* the mutation
(`collegeId: user.collegeId`, or `requireExam` / `requireManaged`, the
latter also routing through `policy.can`), then mutates by validated id.
Actor, tenant and target are server-derived; metadata is field **names**
plus structural parent ids and counts. Live: exactly one event per
committed mutation; hostile
`actorId`/`collegeId`/`role`/`scope`/`action`/`targetId`/`metadata` body
fields proven inert; anonymous 401, under-privileged 403 and invalid 400
all wrote zero rows; reads wrote zero rows; an injected `logAtomic`
failure rolls the mutation back. `AuditLog` is append-only — the entire
application source contains exactly two `auditLog.create` sites, both
inside `AuditService`, and no delete/update/upsert anywhere.

**D-4 fee consistency (W3) — re-verified CLOSED.** The row lock is the
established parameterized pattern
(`SELECT id FROM "FeeStructure" WHERE id = $1 FOR UPDATE`), taken after
the existing Term `FOR SHARE` so the Term-before-row order holds, with
the pre-state re-read under the lock. Live, three rounds of six racing
writers: committed `totalAmount` always equalled the committed component
sum, the surviving component set always matched **exactly one** writer's
proposal (never a blend), and the audit delta always equalled the number
of commits. Audit before-values traced to the locked pre-state
(`10000 → 15000`). Two different structures written concurrently both
stayed self-consistent and isolated. No locking was widened elsewhere.

**D-1 fees CSV (W3) — re-verified CLOSED.** Filtering goes through
`{ structure: { termId } }`; no `Invoice.termId` access exists anywhere.
Live: valid termId 200 with only that term's invoices; the other term
excluded; unknown termId a deterministic header-only export (never 500);
`status` still composes; a client-supplied `collegeId` cannot widen
scope; no-filter header byte-identical. Authorization unchanged —
anonymous 401, student 403, teacher 403, accountant 200.

**D-2 grade bands (W3) — re-verified CLOSED.** Live: an ordinary update
preserves every configured `gradePoint`; changing percent boundaries
preserves them; a new label yields `null` (no invented GPA policy) and a
removed label drops out; a hostile body sending
`gradePoint: 99 / -5 / 4 / 'abc'` is ignored and server values survive;
the read contract still exposes exactly
`id, label, maxPercent, minPercent, sortOrder`; rejected validation
leaves data untouched and writes no audit; grade-band audit metadata is
count-only (`bandCountBefore`, `bandCountAfter`, `gradePointsPreserved`)
with server-derived actor and tenant; student 403 and anonymous 401.

### Complete M23 finding register — every finding has one disposition

| Finding | Severity | Disposition |
|---|---|---|
| S-1 finalized-results ASSIGNED over-read | HIGH | **CLOSED** (W1) |
| S-2 unaudited configuration/academic mutations (8 paths) | MEDIUM | **CLOSED** (W2) |
| S-2 remainder — community updates, evidence upload | LOW–MEDIUM | **DEFERRED** (outside the approved W2 scope; creates already audited, evidence covered by `verification.claim_submitted`) |
| S-3 teacher attendance summary widens past shared section | LOW | **DEFERRED** (attendance service untouched by M23) |
| S-4 `dashboard.guardian` granted with no server consumer | LOW | **VERIFIED / NO DEFECT** — the key exists only in the shared matrix with no `RequirePermission` consumer, so the grant is inert and cannot be exercised; tidy-up candidate, not a vulnerability |
| S-5 same-college file signing, grandfathered keys, single webhook secret, no dual-key window, per-instance limits | LOW | **DOCUMENTED LIMITATION** (pre-existing, previously documented) |
| D-1 `fees.csv?termId=` 500 | MEDIUM-HIGH | **CLOSED** (W3) |
| D-2 grade-band `gradePoint` erasure | MEDIUM | **CLOSED** (W3) |
| D-3 refund segregation of duties / maker-checker | LOW | **DEFERRED** |
| D-4 unlocked fee-structure component replacement | MEDIUM | **CLOSED** (W3) |
| Grade-band college-wide delete/recreate without row lock | LOW | **DOCUMENTED LIMITATION** — see below |
| O-A off-host backup / PITR | — | **DEFERRED** |
| O-B sequential DB/uploads pairing | — | **DEFERRED** |
| O-C retention prunes by mtime with no keep-N floor | — | **DEFERRED** |
| O-D `.backup-health` timestamp only | — | **DEFERRED** |
| O-E `uploads-restore-verify.sh` subshell member check | — | **DEFERRED** |
| O-F `/health/ops` needs the DB to authenticate | — | **DEFERRED** |
| O-G single-trusted-proxy deployment assumption | — | **DEFERRED** |
| O-H no CI and no lint infrastructure | — | **DEFERRED** (explicitly outside M23 scope) |
| T-1 notification scheduler untested | HIGH | **DEFERRED** |
| T-2 `POST /students/import` untested | HIGH | **DEFERRED** |
| T-3 no owning suite for the `users` module | MED-HIGH | **DEFERRED** |
| T-4 `refunds.csv` content/tenancy unverified | MEDIUM | **DEFERRED** |
| T-5 thin dashboard/settings coverage | MEDIUM | **DEFERRED** |
| T-6 essentially no unit layer / no web test harness | STRUCTURAL | **DEFERRED** |

No finding was silently removed or reprioritized.

### Residual limitation (accepted, not fixed)

`updateGradeBands` remains a college-wide delete-and-recreate with no row
lock, so two simultaneous grade-band edits can contend. This was
re-examined in W4 and accepted rather than fixed: `@@unique([collegeId,
label])` means a genuinely interleaved outcome **fails** rather than
committing silently, the operation is a rare admin configuration action
rather than a financial write, and introducing a second locking
architecture purely for a theoretical improvement is explicitly outside
close-out scope. Recorded as a DOCUMENTED LIMITATION for future triage.

### Security sweep across the whole M23 source diff (`ac25eec..HEAD`)

Eleven source files, 11 audited mutations, one added SQL statement. Zero
role-name conditionals; zero client-controlled
`collegeId`/`actorId`/`targetId`/`action`/`scope`/`role`; every mutation
preceded by a tenancy predicate; the only added SQL is one parameterized
`FOR UPDATE`; no `queryRawUnsafe`/`executeRawUnsafe`; no shell, `eval` or
`Function`; no secrets; no request-body or arbitrary metadata logging; no
PII, credential or payment-reference exposure in audit metadata; no new
routes or debug endpoints; no deletion paths; no new permissions or roles
(`permissions.ts` untouched); no schema, migration, dependency or Docker
change; `money.ts` and the shared contracts untouched; CSV schema
unchanged; no GPA policy introduced.

Two sweep hits were investigated rather than dismissed. (1)
`status: input.status` in `exams.update` is pre-existing and unchanged by
M23, `ExamStatus` is workflow state rather than authorization state, the
immutability guard reads `existing.status` from the database, and
`updateExamSchema` deliberately excludes `PUBLISHED`
(`z.enum(['DRAFT','SCHEDULED','COMPLETED'])`) so PATCH cannot bypass the
atomic publish path — **no defect**. (2) The grade-band `deleteMany`
carries the server-derived `collegeId: user.collegeId` tenant predicate —
**no defect**.

### Test integrity

No test was skipped, deleted, weakened or rewritten. There is no
`.skip`, `.only`, `xit`, `xdescribe` or `it.todo` anywhere in the API
suite. No pre-existing (non-M23) test file was modified by M23 at all;
the single edit to an M23 suite **tightened** an assertion
(`toBeGreaterThan(0)` → `toBe(1)`) once the D-4 lock made the exact value
guaranteed. All three M23 suites use the real Nest app, real PostgreSQL
and real HTTP via supertest; the only mock in all of M23 is one
narrowly-scoped `mockRejectedValueOnce` on `logAtomic`, restored in a
`finally`, which is the only way to prove audit-failure rollback.
Concurrency tests remain real, against real PostgreSQL.

### W4 verification totals

- Focused: M23-W1 **18/18**, M23-W2 **35/35**, M23-W3 **25/25**
- Related finance/academic/security/guardian/audit suites: **341/341** (28 suites)
- Complete regression: **728/728, 55 suites**
- Typecheck **0**; Prisma valid; **15 migrations** up to date
- API and web production images build green (validation images removed; no `campusos` images left behind)
- Docker: api/web/postgres/backup all healthy; live/ready 200; preview 200; backup healthcheck passing
- All four demo logins 200
- Live verification: **36/36 checks passed, 0 failures**
- Fixtures: 0 users, 0 structures, 0 terms, 0 invoices, 0 rival colleges, 0 dangling sessions, 0 scratch/restore databases; demo grade bands restored to exactly 8 bands with `gradePoint` NULL
- Fingerprint identical before and after W4

### M23 W0→W4 chain

| Workstream | Commit | Result |
|---|---|---|
| M23-W0 discovery & design | `ac25eec` | design only, 650 tests |
| M23-W1 S-1 authorization fix | `9c46336` | +18 tests → 668 |
| M23-W2 S-2 audit integrity | `6c1c3fb` | +35 tests → 703 |
| M23-W3 D-4/D-1/D-2 data integrity | `c7839bf` | +25 tests → 728 |
| M23-W4 re-audit & close-out | *(this commit)* | docs only, 728 tests |

Net M23: one HIGH authorization defect closed, nine mutation paths made
auditable atomically, three data-integrity defects closed, **78 new
real-Postgres tests**, and **zero migrations** — the schema is unchanged
at 15 migrations throughout.

**M23 CLOSED.** M24 has NOT been started and requires separate
authorization; reporting/analytics remains the leading M24 candidate.

*Last updated after M23-W4 — **M23 CLOSED** (W0–W4 complete).*

## M24-W0 — Platform discovery + design (design only)

Read-only discovery from `52e817f`. Baseline independently re-measured
rather than inherited: 728/728 tests (55 suites), typecheck 0, Prisma
valid, 15 migrations up to date, all four containers healthy,
live/ready/preview 200, backup healthcheck passing, four demo logins 200,
zero skipped/only/todo tests. Scale: 28 controllers, 192 routes,
62 services, 57 Prisma models, 38 permissions, 73 grants.
`docs/M24_PLATFORM_DISCOVERY_DESIGN.md` records the full analysis.

**M23 re-verified, nothing reopened.** All five M23 fixes are present and
effective at this HEAD — the S-1 `ASSIGNED` branch, the nine atomic
`logAtomic` audit sites, the relational `fees.csv` term filter, the
grade-band `gradePoint` preservation and the fee-structure `FOR UPDATE`
lock — with suites 18/18, 35/35 and 25/25 green. `AuditLog` remains
append-only and `permissions.ts` is unchanged since M18.

**Highest-priority new finding (N-1, HIGH, live-proven).**
`GET /results/analytics` is the only query parameter in the exams
controller not routed through `ZodValidationPipe`
(`exams/exams.controller.ts:153-160`). Omitting `examId` yields
`undefined`, which Prisma drops, so `requireExam` returns an *arbitrary*
exam instead of 404 and `examPaper.findMany({ where: { examId: undefined } })`
becomes `where: {}` — and `ExamPaper` carries no `collegeId`, reaching a
college only through `exam`. Proven live at this HEAD: the request
returned **HTTP 200 with all four `ExamPaper` rows spanning both exams**
(`papers_per_exam` = 3,1) while reporting one arbitrary exam's title. In a
multi-college deployment this is a cross-tenant disclosure of paper ids,
course codes, section names, mark counts and per-paper statistics. Graded
HIGH as a broken tenancy invariant rather than an active breach: the
caller must be an authenticated ADMIN (teacher 403, accountant 403,
anonymous 401, all verified) and the platform is single-college today.
`?examId=` and `?examId=nonexistent` correctly 404; only total omission
triggers it, and `?examId[]=a&examId[]=b` returns 500.

Its root cause is systemic — validation is opt-in per route and Prisma
silently drops `undefined` predicates. **N-5** is the same class: the
shared `isoDate` regex is syntactic only, so `2024-13-45` reaches Prisma
as `Invalid Date` — proven live as a **500** on
`exports/attendance.csv?from=2024-13-45`, and more seriously it *bypasses*
the `OUTSIDE_TERM` guard in attendance session generation because every
`NaN` comparison evaluates false.

Two findings are policy drift rather than code error. **N-6:**
`students.csv` now returns the **full student directory including email
addresses** to ACCOUNTANT (proven live, 200) because M16 widened
`users.read` to ALL scope after M12 declared exports "admin-only in v1".
**N-7:** `FilesController` declares no permission at all, and
`PermissionsGuard` returns `true` without metadata, so the M11-W5
verification-lifecycle gate never runs for upload or URL signing — a
self-registered UNVERIFIED account can upload and sign.

Also found: rollover mutating a CLOSED **source** term's enrollments
against the file's own stated invariant (N-2); `assertTermOpen`'s
`FOR SHARE` lock released before the caller's write at **25 of 33 call
sites**, degrading the documented serialization guard to an
unsynchronized preflight (N-3); an enrollment-capacity TOCTOU with no
database constraint — the same unlocked read-modify-write class M23 fixed
in fees, which did not generalize (N-4); and grade-band edits
retroactively re-grading already-published, marks-locked exams because
labels resolve at read time, plus unvalidated coverage gaps (N-11).

**33 new findings: 2 HIGH, 12 MEDIUM, 14 LOW, 4 INFO, 0 CRITICAL.** No
unconditional or unauthenticated exploit was found. The extensive
verified-SAFE results are recorded too, including path-traversal defence,
signed-URL verification, refresh-token rotation with family-wide reuse
detection, immediate effect of suspension, the OAuth implementation
(PKCE + nonce + signed one-time state with DB-atomic consumption +
RS256/`kid` pinning + email-is-never-identity), the finalization snapshot
model, and `Decimal`-only money with a single reducer.

**Three previously deferred findings were honestly reclassified
SUPERSEDED** because their premise was wrong: T-1, T-2 and T-3 claimed the
notification scheduler, bulk student import and the users module had no
coverage — all three *are* covered (the scheduler from a misplaced owner
in `moderation.e2e-spec.ts`), so they are ownership debt, not coverage
holes. Reporting/analytics is **superseded as the M24 recommendation**:
N-1 proves the analytics surface leaks and N-13 makes it unreachable for
closed terms, so building reporting first would inherit both. O-H (no CI,
no lint, no web test harness) was confirmed and promoted to HIGH. One
documentation defect was corrected: M23-W0 recorded "37 permissions /
68 grants"; source and the seeded database both say **38 / 73** (N-31).

**Recommended M24: Input Validation & Tenancy Hardening** — W1 validation
and tenancy correctness (N-1, N-5, N-13, N-25 plus a sweep of all 192
routes), W2 file/session/export authorization (N-6…N-10, N-22…N-24),
W3 academic lifecycle and concurrency integrity (N-2, N-3, N-4, N-11,
N-12, N-14…N-18), W4 re-audit and close-out. No migration is anticipated;
migrations stay at 15. Reporting/analytics and CI/lint move to M25.
Eight open decisions O-1…O-8 are recorded, with O-1/O-2 gating W1 and
O-3/O-4 gating W2.

No implementation was performed: no source, schema, migration, package,
UI, Docker, permission or test change, and no discovered defect fixed.
Verification was read-only HTTP plus read-only SQL; no fixture was
created and no business or demo data was modified. Database integrity
unchanged before and after (`users=20 active=20 students=13 colleges=1
migrations=15`, 8 grade bands all `gradePoint` NULL, zero fixture rows,
zero scratch databases). **M24-W1 was NOT started.**

*Last updated after M24-W0 (design only — M24 NOT implemented).*

## M24-W1 — input validation & tenancy hardening

Closes the four W1 findings from `docs/M24_PLATFORM_DISCOVERY_DESIGN.md`,
including the milestone's HIGH. Gating decisions were taken as recorded
there: **O-1 = both layers** (validation *and* an explicit tenancy
predicate) and **O-2 = sweep all 192 routes**. No migration, no schema,
no dependency, no Docker, no new route, no new permission or role, no
`PolicyService` change, no UI change, and **no reporting features** — only
the security defect on the existing analytics endpoint.

Every defect was reproduced before being fixed: the new suite was written
first and **8 of its 23 tests failed against unfixed code**, one per
defect.

**N-1 (HIGH) — analytics tenancy/validation bypass.** `@Query('examId')`
carried no validation pipe, so omitting it yielded `undefined`; Prisma
drops `undefined` predicates and `ExamPaper` has no `collegeId` of its own,
so `requireExam` returned an arbitrary exam and the paper query collapsed
to `where: {}`. Fixed in both layers per O-1: `examAnalyticsQuerySchema`
makes `examId` a required non-empty string validated *before* the service
runs, and the paper query now states
`{ examId, exam: { collegeId: user.collegeId } }` so a widened identifier
still cannot cross a tenant. Live: omitted → **400** (was 200 returning
every paper in every college), array → **400** (was 500), valid → 200
unchanged. Proven cross-tenant against a real second college with its own
exam, paper and mark; the rival course code, room and paper id appear in no
response, and a positive control confirms authorized analytics still works.

**N-5 — calendar-invalid dates.** `isoDate` was a syntactic regex, so
`2024-13-45` reached Prisma as `Invalid Date`. A bare `Date.parse` refine
would have been insufficient — `Date.parse('2024-02-30')` silently returns
March 1 — so a calendar **round-trip** check was added to the shared
primitive in all four schema files and to the export filters. It rejects
`2024-13-45`, `2024-02-30`, `2024-04-31` and `2023-02-29` while accepting
real dates including the `2024-02-29` leap day. Live:
`attendance.csv?from=2024-13-45` → **400** (was 500). A
`PrismaClientValidationError` → 400 backstop was added to the exception
filter so any future validation gap degrades to a controlled 400 instead of
a 500; because that response is now a 4xx it would have stopped being
logged, so it emits an explicit operational record (fixed schema, generic
client message) and still counts as an unexpected server error.

**N-13 — term guard on a read path.** `assertTermOpen` was applied inside
`analytics()`, throwing `409 TERM_CLOSED` on a pure read and making exam
analytics permanently unreachable after the sanctioned publish → close →
finalize lifecycle. Removed from the read path only; CLOSED-term *write*
enforcement is unchanged and pinned by a test asserting a PATCH to an exam
in a closed term is still refused with the row unmodified.

**N-25 — malformed percent-encoding.** `decodeURIComponent` threw an
unhandled `URIError` on `%zz`. Wrapped, reusing the established
`INVALID_FILE_URL` rejection so a malformed escape is indistinguishable
from any other rejected key. Live: `%zz`, `%`, `abc%` → **400** (was 500).

**Validation sweep (O-2).** All 192 routes were inventoried
programmatically. **Zero** `@Body` decorators lack a validation pipe.
Eleven `@Query` parameters did; each was traced to its sink and
dispositioned. Four were real defects and are fixed — the three above plus
the array class on `transcript`, `report/term` and, notably, the **public
unauthenticated** `/auth/invite-info`, where an array token produced a 500.
The remaining seven are NO DEFECT with reasons recorded (signed-download
`exp`/`sig` fail closed; optional `userId` on group-leave cannot widen;
Google `start` parameters are not authorization inputs; one scanner false
positive). Separately, all 27 models lacking their own `collegeId` were
reviewed: every query but the N-1 site filters by an identifier already
resolved under a tenancy-scoped lookup, and no second instance exists of
N-1's distinguishing shape — a sole predicate that could become
`undefined`.

On `/auth/invite-info` the rate limiter was deliberately left **first**, so
validation cannot become a way to skip it; and format rejection does not
create an existence oracle — a well-formed but nonexistent token still
returns the same generic `INVALID_TOKEN`.

**Backward compatibility.** Only malformed input changed behaviour. One
edge was deliberately preserved rather than tightened: `?studentId=`
(empty) still means "no target supplied" exactly as the previous
`studentId || undefined` did, pinned by a test covering both a wide scope
(MISSING_TARGET) and an OWN-scope caller (own record). The web client
already sends `examId` explicitly and a scalar `studentId`, so no UI change
was required.

Verified: **752/752 tests (56 suites, +24)**, typecheck 0, Prisma valid,
**15 migrations** unchanged, API and web production images build, all four
containers healthy, live/ready/preview 200, backup healthy, four demo
logins 200, demo identity fingerprint `ae1f7d62…` unchanged, zero fixture
residue, zero scratch databases. Security sweep of the whole diff: no
role-name conditionals, no client-controlled tenant/actor identifiers, no
raw or unsafe SQL added, no shell/eval, no secrets, no new routes or
permissions, no authorization weakening, no request-body/header/query
logging, `money.ts` and `permissions.ts` untouched.

*Honest note:* the `OUTSIDE_TERM` NaN-bypass half of N-5 is confirmed at
code level but could not be reproduced as an observable failure in the
seeded fixture, because the section had no timetable slots so the failing
write was never reached. The regression test pins the corrected 400
behaviour regardless.

**No W2/W3/W4 work was performed.** All other M24 findings (N-2…N-4,
N-6…N-12, N-14…N-24, N-26…N-32, Res-1) remain DEFERRED exactly as
recorded, as do every previously deferred product and operational item.
M24 is **NOT closed**.

*Last updated after M24-W1 (N-1/N-5/N-13/N-25 closed; W2–W4 not started).*

- **M19 status**: DESIGN/DISCOVERY COMPLETE only —
  `docs/M19_PLATFORM_HARDENING_DESIGN.md` recommends Platform Security
  Hardening & Debt Retirement (P2-IDOR-1 file authorization, mail
  escaping, Google callback limiter, guardian-PII disposition, backup
  automation, baseline observability). Open decisions O-1…O-4 await
  approval; W1 not started. Discovery corrected two stale register
  entries: the announcements DEPARTMENT scope is actually IMPLEMENTED
  (validation + label resolution in module-parts), and the
  StudentProfile guardian columns are actively USED by
  students.service (the true debt is PII duplication outside
  GuardianLink, pending O-2 — not "dead columns").
- **M24 status**: W0 (discovery/design) and W1 (input validation & tenancy
  hardening) COMPLETE. N-1, the HIGH tenancy defect, is **CLOSED**.
  W2–W4 NOT started; O-3…O-8 remain open. M24 is **NOT closed**.
- **M23 status**: **M23 COMPLETE AND CLOSED (W0–W4)** — Authorization
  Correctness & Audit Integrity. S-1, S-2 (approved scope), D-1, D-2 and
  D-4 all CLOSED; every remaining finding carries an explicit
  disposition. Zero migrations across the whole milestone.
- **M22 status**: **M22 COMPLETE (W0–W4) — production runtime reliability &
  incident visibility CLOSED** (see M22-W4 entry).
- **M21 status**: **M21 COMPLETE (W0–W4) — account lifecycle & institutional administration CLOSED** (see M21-W4 entry).
- **M20 status**: **M20 COMPLETE (W0–W4) — finance documents CLOSED** (see M20-W4 entry).
- **Current milestone**: **M19 COMPLETE (W0–W4) — platform security hardening & debt retirement CLOSED** (see M19-W4 entry). Previous: **M18 COMPLETE (W0–W4)** — academic records:
  immutable finalized term results, versioned amendments, VOID,
  transcripts with frozen credit-weighted GPA (null until the
  institution configures its scale), report-card/transcript UI with
  browser-print; M17 term lifecycle, M16 refunds+accountant, M15
  rollover and M14 payments all remain complete (webhook delivery
  still pending provider-dashboard endpoint registration).
- **Latest commit**: the M24-W1 validation/tenancy commit on branch
  `amjad-ali-s/set-up-this-codebase-for-6iTTUe`
- **Migrations**: 15 found, database schema up to date
- **Tests**: **752/752 passing** (56 suites)
- **Typecheck**: clean (api, web, shared)
- **Docker health**: postgres/api/web all healthy
  (`/api/v1/health` → `database: up`)
- **Alloy preview**: reachable at `http://localhost:8080` (login page 200;
  demo admin/teacher/student logins verified; Google endpoints correctly
  FEATURE_DISABLED without env config)
- **Known technical debt**: see §13 and
  `docs/M23_PLATFORM_DISCOVERY_DESIGN.md` (current reconciliation)
- **Next planned milestone**: M24-W2 (file/session/export authorization —
  N-6…N-10, N-22…N-24, Res-1) is designed and awaiting authorization, and
  is gated on decisions O-3 and O-4. Reporting/analytics and CI/lint remain
  M25 candidates

## 15. Future Roadmap

**COMPLETED**
- M0–M9 MVP (foundation → dashboards)
- **M13 Guardian Portal — complete (W1–W5)**
- M10 production hardening (W1–W5)
- **M11 Identity & Student Verification — complete (W1–W7)**: identity
  foundation, Google OIDC core, claims + evidence API, verified student
  onboarding, student onboarding UI + lifecycle gate, admin verification
  queue UI, cutover + production hardening

**IN PROGRESS**
(none — M13 closed)

**PLANNED**
- Guardian/parent portal (M13, per decision O5); payments afterward
- Payment gateway integration + accountant functionality
- Parent/guardian portal
- Complaint box
- GPA/transcripts (activating the dormant grade-band hooks)

**IDEAS**
- Library management
- Broader school/campus deployments (multi-college operations tooling)
- Additional identity verification methods (institutional email domains,
  registrar data feeds)
- OCR-assisted evidence review (explicitly excluded from M11 v1)

## 16. Final Completion Record

*Not yet complete. This section will be filled in when CampusOS reaches its
final release: final version, final commit, migration status, test count,
security audit status, deployment status, production readiness, major
capabilities, known limitations, and release date.*
