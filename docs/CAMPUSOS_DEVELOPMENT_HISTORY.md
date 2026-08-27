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
| M17-W3 | Lifecycle UI, rollover close offer, guardian refund read, accountant landing | *(this commit)* |

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
| Backups are documented cron scripts, not shipped automation | doc-only scope of M10-W5 | OPERATIONS.md §6 | future ops work |
| GPA/transcripts | out of MVP scope | dormant hooks (grade bands, marks) | roadmap |
| F2 rate-limiter bucket pruning | — | **Resolved in M13-W5** (lazy in-band sweep) | done |
| F3 `results.csv` includes unpublished marks | intentional: admin ALL-scope marks export; published-only surface is `/results` | documented (OPERATIONS §19/§21) | accepted behavior |
| Guardian link revoke/list endpoints unlimited | admin-only, state-guarded (409 on repeat), consistent with other admin mutations | reviewed M13-W5, no limit needed | revisit only on abuse evidence |
| Login limiter unbounded memory | — | **Resolved in M14-W0** (lazy sweep, mirrors F2) | done |
| Guardian section-timetable over-read (P2-GUARD-1) | — | **Resolved in M14-W0** (academics.read scope gate) | done |
| Ordinary-file signing has no ownership record (P2-IDOR-1) | capability-URL design (random keys); evidence files fully authorized | untouched by design through M14 | when files are next touched |
| Real Safepay sandbox verification | — | **Substantially resolved (M14-SBX)**: real payment, decline, paisa, verify-recovery all LIVE-VERIFIED; genuine webhook delivery/replay still pending dashboard endpoint registration | register webhook endpoint |
| Single global webhook secret (env-only) | V1 decision #7: single-tenant start | per-college gateway config table when a second college onboards | multi-college payments |
| `GET /grade-bands` readable by guardians | college-wide grading config, no PII; grades already visible on results | reviewed M13-W5, acceptable | none |

## 14. Current System State

*Last updated after M17-W3.*

- **Current milestone**: **M16 COMPLETE (W0–W5)** — refunds + accountant
  role, live-verified against the real Safepay sandbox; M15 calendar/
  rollover and M14 payments remain complete (webhook delivery still
  pending provider-dashboard endpoint registration).
- **Latest commit**: the M15-W4 close-out commit on branch
  `amjad-ali-s/set-up-this-codebase-for-6iTTUe`
- **Migrations**: 11 found, database schema up to date
- **Tests**: **528/528 passing** (39 suites)
- **Typecheck**: clean (api, web, shared)
- **Docker health**: postgres/api/web all healthy
  (`/api/v1/health` → `database: up`)
- **Alloy preview**: reachable at `http://localhost:8080` (login page 200;
  demo admin/teacher/student logins verified; Google endpoints correctly
  FEATURE_DISABLED without env config)
- **Known technical debt**: see §13
- **Next planned milestone**: none scheduled — any next milestone (e.g.
  M16 refunds/accountant, for which a design doc exists) requires
  explicit approval

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
