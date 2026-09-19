# CampusOS — Complete Development Journey

> The engineering history of CampusOS: how the platform was built from the
> first commit to its current production-ready state, step by step, based
> on actual repository evidence (git history, Prisma migrations, the test
> suite, milestone completion reports, `docs/CAMPUSOS_DEVELOPMENT_HISTORY.md`
> and `docs/OPERATIONS.md`).

---

## 1. Document Purpose

This document records the engineering journey of CampusOS from project
foundation through the completion of Milestone 11. It complements — and
does not replace — the canonical milestone record in
`docs/CAMPUSOS_DEVELOPMENT_HISTORY.md` by telling the deeper chronological
story: what existed at each point, why decisions were made, what went
wrong, and how the system converged on its current shape.

**Current historical endpoint:**
- Milestone: **M11-W7** (M11 complete)
- Commit: **`f9632a4`**
- **M12 is NOT started.** No M12 code, migrations, or implementation exist.

Wherever a detail cannot be established from repository evidence, this
document says so explicitly rather than inventing it.

---

## 2. Project Vision at the Beginning

CampusOS began as a unified digital platform for colleges — admins,
teachers and students in one professional SaaS workspace — built to a
written specification referred to throughout the repository as the
**CampusOS Final Technical Blueprint v1.0** (cited in code comments,
commit messages and the README as the source of truth for architecture
decisions; the Blueprint document itself is not stored in the repository).

The original MVP concept, evidenced by the M0 commit (`e05785c`) which
already contained the *complete* domain schema:

- One college (single seeded tenant) with three user roles: ADMIN,
  TEACHER, STUDENT.
- Full academic management: departments, courses, terms, sections,
  enrollment, timetable, attendance, assignments, exams/results, fees.
- A private campus community (posts, groups, societies, events,
  resources) with moderation.
- Password authentication with strict session security.
- A deliberate long-term direction: evolve from single-college MVP →
  production-ready platform → broader multi-college / city-wide education
  platform. This is why `collegeId` appears on every aggregate root from
  the very first migration, even though only one college has ever been
  seeded.

**How the original vision differs from today's system:** the MVP assumed
admin-created accounts with passwords. The system today is far stronger on
identity: hashed one-time invitation/reset tokens, Google OIDC keyed on
the immutable `sub`, a full student identity-verification lifecycle with
ID-card evidence and admin review, database-enforced duplicate prevention,
and per-college Google-only cutover. None of that existed in the original
plan at this level of detail — it emerged through M10 and M11.

---

## 3. Development Philosophy

Principles and when they appeared:

| Principle | Origin |
|---|---|
| Multi-tenancy (`collegeId` everywhere, college-scoped uniques) | From M0 — baked into the first migration |
| PolicyService as the sole authorization authority | From M1 |
| Zero role-conditionals (permissions or data-driven rules only) | From M1; held through every later milestone (e.g. M11-W7's cutover keys on StudentProfile ownership, not role) |
| Database-level invariants for security-critical rules | From M0 (composite uniques); elevated in M11-W1 (partial unique indexes) as the explicit duplicate-prevention strategy |
| Defense in depth (UI hints never authoritative; server always enforces) | Explicit from M1 middleware ("routing hint only"); restated in every UI milestone |
| Secure-by-default (generic errors, no enumeration, fail-closed) | From M1 (`INVALID_CREDENTIALS`); extended repeatedly (null-password fail-closed in M11-W1, enumeration-safe claims in M11-W3) |
| Transactional state changes with atomic one-time transitions | From M10-W2 (token claims); became the standard pattern (decisions in W3, onboarding in W4) |
| Auditability | AuditLog from M0; systematically extended each milestone |
| Shared validation (Zod in `packages/shared`, single source for API + web) | From M0/M1 |
| Regression testing as a merge gate | From M1; every milestone ran the full suite before commit |
| Additive, rollback-safe migrations | Explicit from M10-W2 onward (all 4 post-init migrations are additive) |
| Explicit feature flags/settings instead of silent behavior change | From M11-W1 (`googleAuth: off/additive/required`, default off) |
| No premature infrastructure (no Redis, no queues, no microservices) | Blueprint §14 stance, honored through M11-W7 (in-memory rate limits documented rather than adding Redis) |
| Rollback safety documented per milestone | Formalized in M10-W5 (OPERATIONS.md) and each M11 report |

---

## 4. Technology Foundation

Actual stack (all present in the repository):

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS —
  `apps/web`, port 3000.
- **Backend:** NestJS REST API under `/api/v1` — `apps/api`, port 4000.
- **Database:** PostgreSQL 16.
- **ORM:** Prisma 5.22 (migrations are the schema history).
- **Authentication:** argon2id password hashes; 15-minute JWT access
  tokens (`@nestjs/jwt`); rotating opaque refresh tokens, SHA-256 hashed
  at rest, httpOnly cookies.
- **OIDC:** hand-rolled server-side Google Authorization Code flow with
  PKCE S256, HMAC-signed state cookie, nonce, and JWKS signature
  verification using Node's `crypto` (`createPublicKey` from JWK) — no
  OAuth library dependency was added.
- **Storage:** local filesystem adapter with an S3-shaped interface;
  HMAC-signed expiring download URLs.
- **Validation:** Zod schemas in `packages/shared` (npm workspace).
- **Events/notifications:** `@nestjs/event-emitter` typed domain events;
  `@nestjs/schedule` daily sweeps.
- **Testing:** Jest + supertest e2e suites run `--runInBand` against a
  live PostgreSQL.
- **Docker:** `docker-compose.alloy.yaml` (dev, host networking) and
  `docker-compose.prod.yaml` + production Dockerfiles.
- **Shared package:** `@campusos/shared` — permissions catalog +
  role→permission matrix, route→permission map, Zod schemas, TypeScript
  types, domain-event contracts. Both API and web consume it, which is
  the mechanism that keeps validation and authorization definitions
  single-sourced.

---

# 5. COMPLETE CHRONOLOGICAL TIMELINE

Pre-milestone commits: `638ceb8` (initial commit), `bc7cd63` (Alloy dev
environment), `d890daa` ("Add CampusOS architecture and design docs" —
per `git show`, this commit actually contains only a `screenshot.png`;
the design documentation it references was not committed).

### M0 — Foundation (`e05785c`)
- **Goal:** stand up everything later milestones build on.
- **Starting state:** empty scaffold + Alloy environment.
- **Implementation:** npm-workspaces monorepo (`apps/api`, `apps/web`,
  `packages/shared`); the complete Blueprint domain schema in one
  migration; idempotent system seed (permissions, role matrix, college
  bootstrap) + demo seed (3 demo accounts, sample data); NestJS bootstrap
  with envelope interceptor + global exception filter; Next.js shell.
- **Database:** migration `20260820164746_init` — the entire domain model
  (identity/access, academics, attendance, assignments, exams, fees,
  community, moderation, notifications, audit) with tenancy and delete
  policies (Restrict on academic/financial refs, Cascade on pure
  children, SetNull on optional actors).
- **Testing:** per-milestone counts for M0–M8 were not individually
  recorded; the suite's first recorded checkpoint is 141 tests at the end
  of M9.
- **Result:** runnable stack in Alloy with browser preview.

### M1 — Auth & Access (`51f7ea3`)
- **Goal:** authentication and the authorization backbone.
- **Implementation:** login/refresh/logout/change-password + `/me`;
  15-min JWTs held in web memory; rotating opaque refresh tokens hashed
  in `RefreshToken` with token families and reuse detection; cookies
  `cos_refresh` (httpOnly, path `/api/v1/auth`) and `cos_auth` (routing
  hint: role + mustChangePassword only); forced password change; login
  rate limiter (5 fails/min per IP+account, exponential backoff);
  **PolicyService** resolving grants from the database on every request
  (never from the JWT); global guard chain JwtAuthGuard → PermissionsGuard;
  Next.js middleware consuming the hint cookie via the shared
  route→permission map.
- **Security:** generic credential errors, hashed rotating refresh
  tokens, rate limiting, audit of login success/failure.
- **Result:** the authorization architecture that every subsequent
  milestone extended without ever adding a role conditional.

### M2 — Academic Core (`12ee991`)
- Students/teachers (profiles 1:1 with users), departments, courses,
  terms/years, sections, enrollment, teaching assignments, CSV student
  import, section hub, web UI kit (tables/dialogs/forms), demo data.
- **Historically important:** student/teacher creation returned
  **temporary passwords** in API responses. This was the accepted MVP
  design at the time and was later superseded by M10-W2's invitation
  tokens (see §14).

### M3 — Timetable & Attendance (`2dc57f3`)
- Slot CRUD with conflict detection, role-aware timetable, idempotent
  session generation, bulk attendance with absence notification rows,
  summaries.

### M4 — Assignments & Files (`ee47c54`)
- Assignment lifecycle (draft → publish → submit → grade) with late
  policy; the **files module** (local storage adapter, unguessable keys
  `<hex>__name`, filename sanitization); notifications; role UIs.
- **Problem encountered & fixed in this milestone:** the web client fired
  parallel refresh requests on 401 bursts; fixed with a single-flight
  refresh guard (recorded in the commit message itself).
- **Historically important:** file downloads were plain internal URLs —
  permanent and unauthenticated once known. Superseded by M10-W1 (§14).

### M5 — Exams & Results (`f8c8252`)
- Exams/papers CRUD, marks grid with locking, atomic publish +
  notifications, result cards with grade bands, analytics, grade-band
  management. GPA hooks (grade bands + marks) exist but no GPA
  computation ships — dormant by explicit decision.

### M6 — Fees (`e0e2b59`)
- Fee structures with components, invoice generation with line-item
  snapshots, manual payments with a status engine
  (PENDING/PARTIAL/PAID/OVERDUE/CANCELLED), lazy overdue transitions,
  summaries, notifications. No online payments (still true today).

### M7 — Community (`5260fac`)
- Posts/comments/likes with counters, groups with request flow +
  moderators, societies with officers, events + RSVP + capacity,
  resources with download counts, suspension gate, notifications.

### M8 — Moderation, Notifications & Announcements (`395fdd5`)
- Report flow + admin queue + moderation actions (suspension, reporter
  immunity), notification inbox + live bell, audience-scoped
  announcements with fan-out, daily scheduled sweeps (assignment
  due-soon, invoice overdue, event reminders).

### M9 — Dashboards & Hardening (`eb833f7`)
- Role dashboards with live aggregates, exam analytics UI, fee structure
  editing, amount formatting, instant bell refresh, batched event
  queries, and a security audit pass over the whole MVP (recorded as
  PASS).
- **Testing:** first recorded suite total — **141 tests**.
- **Result:** feature-complete MVP; everything after M9 is hardening and
  identity.

### M10 — Production Hardening
See §6 for the special historical record of its unusual execution order
(W3 → W1 → W2 → W4 → W5) and each workstream's content. Test progression
across M10: 141 → 151 → 160 → 172 → 181.

### M11-W1 — Identity & Verification Foundation (`2581a21`)
- **Goal:** the database and permission foundation for Google identity
  and student verification, with zero behavior change while flags are off.
- **Implementation:** `AuthIdentity` (provider + immutable Google `sub`;
  unique globally and per user), `StudentIdentityClaim` with **PostgreSQL
  partial unique indexes** (`UNIQUE(studentProfileId) WHERE status IN
  ('PENDING','APPROVED')`, `UNIQUE(userId) WHERE status='PENDING'`) —
  duplicate-account prevention placed in the database itself, immune to
  application races; `User.passwordHash` made nullable with fail-closed
  login; `User.verificationStatus`
  (LEGACY/UNVERIFIED/PENDING/VERIFIED/REJECTED, default LEGACY so every
  existing account was untouched); college settings schema
  (`googleAuth: off|additive|required`, `allowSelfRegistration`,
  `googleAuthGraceDays`); permissions `verification.manage` (ADMIN/ALL)
  and `verification.submit` (STUDENT/OWN).
- **Database:** migration `20260822071747_m11_identity_foundation`
  (additive; the partial uniques are raw SQL appended to the migration).
- **Problems encountered:** a pre-existing test asserted the permission
  catalog size as a hardcoded `30`; adding two permissions broke it. Fixed
  by deriving the assertion from the shared `PERMISSIONS` object.
- **Testing:** **192/192** (11 new, including a 5-way concurrent claim
  race with exactly one winner).

### M11-W2 — Google OIDC Core (`768fb05`)
- **Goal:** server-side Google login without touching the session
  architecture.
- **Implementation:** authorization-code flow with PKCE S256; HMAC-signed
  one-time state cookie (10-min TTL) carrying state+nonce+PKCE verifier;
  JWKS signature verification with kid-rotation cache; claim validation
  (issuer/audience/expiry/nonce/`email_verified`); login strictly by
  `sub` via AuthIdentity — **email match never auto-links**;
  flag-gated self-registration (UNVERIFIED password-less student);
  authenticated link/unlink with protections; sessions issued through the
  existing TokenService/cookie path; env config all-or-none, absent →
  `FEATURE_DISABLED`; DI-injectable OIDC client so tests fake only the
  network exchange while all validation logic runs real code.
- **Known limitation created (resolved later):** the one-time state store
  was an in-memory Map — documented as multi-instance debt, resolved in
  M11-W7.
- **Testing:** **221/221** (29 new).

### M11-W3 — Identity Claims + Evidence API (`51069ab`)
- **Goal:** the verification workflow backend.
- **Implementation:** purpose-restricted `EvidenceFile` uploads (5 MB,
  JPEG/PNG/WebP/PDF enforced by magic-byte sniffing; ordinary uploads can
  never be used as evidence); claim submission with college-scoped,
  enumeration-safe resolution (unknown and cross-college admission
  numbers produce identical PENDING claims); own-claim endpoint; admin
  queue/detail/decision with atomic PENDING→decided transitions and the
  D3 no-merge guard (`PROFILE_HAS_ACCOUNT`); **evidence signing
  authorization** layered onto `POST /files/sign` (uploader or
  `verification.manage` in-college; everyone else 404; every signing
  audited); `verification.*` audit events; approve/reject notifications
  via the event bus, exactly-once by construction.
- **Database:** migration `20260822163204_m11_evidence_files`.
- **Testing:** **245/245** (24 new, incl. a 3-way live HTTP claim race).
- **Alloy:** full manual flow — upload → claim → admin signed-URL review
  (byte-identical download, unsigned 403) → approve → VERIFIED.

### M11-W4 — Verified Student Onboarding (`7901d18`)
- **Goal:** a duplicate-proof path to VERIFIED for admin-created
  students, via the existing M10-W2 invitation, with either credential
  method.
- **Design core:** invitation possession = admin-provisioned identity
  proof. Acceptance (password *or* Google, one INVITE token, one-time
  across both methods) yields VERIFIED **plus a synthetic APPROVED
  StudentIdentityClaim**, so the W1 partial-unique index permanently
  holds the identity slot in PostgreSQL.
- **Path E (auto-supersession, explicitly approved):** accepting an
  invitation atomically rejects an impostor's PENDING claim on the same
  profile (reason: superseded by an administrator-issued invitation),
  marks the impostor REJECTED, and notifies them — all in the same
  transaction; any failure rolls back including the token consumption.
- **Also:** OIDC `invite` intent (raw token carried only inside the
  signed state cookie, never through Google; transaction ordered
  AuthIdentity → token claim → onboarding so a wrong Google account
  leaves the invitation valid); `GET /auth/invite-info`; required-mode
  server-side password refusal for student invites; session-link
  auto-verification for profile owners; accept-invite page offering
  Google and/or password per college mode.
- **Database:** none (reuses W1/W2 structures) — migration count stayed 4.
- **Problems encountered:** mid-workstream the sandbox restarted, wiping
  the Docker stack and two *untracked* new files (the onboarding service
  and its test suite) while tracked modifications survived; both were
  recreated and fully re-verified. Additionally, W4's new
  link-auto-verify behavior polluted demo-student state across older test
  suites until suite teardowns were updated to restore canonical LEGACY
  state.
- **Testing:** **266/266** (21 new, incl. IDENTITY_CONFLICT rollback and
  a 3-way concurrent acceptance race).

### M11-W5 — Student Onboarding UI + Lifecycle Gate (`b33af5f`)
- **Goal:** self-service verification UX plus server-side lifecycle
  enforcement.
- **Implementation:** PolicyService lifecycle rule — accounts in
  UNVERIFIED/PENDING/REJECTED resolve *only* `verification.submit`
  (lifecycle data, not a role check; LEGACY/VERIFIED untouched);
  `verificationStatus` added to AuthenticatedUser, `/me` and the hint
  cookie (`v` field); middleware pinning to `/verify`; the `/verify` page
  (claim form + ID upload, PENDING card, REJECTED reason + resubmit,
  APPROVED auto-refresh to dashboard); login page "Continue with Google"
  gated by the new public `GET /auth/config` (booleans only) plus
  friendly banners for OAuth redirect errors.
- **Testing:** **273/273** (7 new). A test bug during development (login
  with the wrong fixture password, and email fixtures with uppercase tags
  colliding with the login schema's lowercasing) was caught and fixed in
  the same session — recorded here as ordinary development friction, not
  an incident.
- **Alloy:** full browser walk — pinned login → claim → reject with
  reason → resubmit → approve → automatic unpin to dashboard.

### M11-W6 — Admin Verification Queue UI (`6d7984d`)
- **Goal:** the administrator Verification Center, as a pure consumer of
  the W3 API.
- **Implementation:** `/verification` page (PENDING-default queue, status
  filter, admission-number search, pagination, empty/loading/error
  states); claim detail dialog with claimant-vs-record comparison,
  explicit no-match panel, evidence via the authorized `openFile()`
  signing flow (signed URLs never rendered), approve
  (usability-disabled when unapprovable; backend authoritative) and
  reject with mandatory reason; conflict handling
  (`CLAIM_ALREADY_DECIDED` etc. → toast + queue resync); shared route
  map + nav entry. **No API or schema changes.**
- **Testing:** **278/278** (5 new API-contract tests: search, pagination,
  filter purity, stale-decision conflict, route-map contract).
- **Alloy:** full walkthrough including a deliberately staged
  concurrent-decision conflict; also cleaned residue left in the demo DB
  by an earlier failed suite teardown.

### M11-W7 — Cutover + Production Hardening (`f9632a4`)
- **Goal:** close the remaining M11 security debt.
- **Implementation:**
  - **Required-mode cutover (decision R1):** in `googleAuth=required`
    colleges, password login is refused for **all** StudentProfile owners
    (including LEGACY) with `403 USE_GOOGLE_LOGIN` — shown only after
    valid credentials and the rate limiter (wrong passwords stay generic
    401; no account-type oracle); staff unaffected; grace days documented
    as an operational window with no hidden password exception.
  - **College settings (R2):** `GET/PATCH /settings/college`
    (`settings.manage`, tenant-scoped, shared-Zod, merge-PATCH preserving
    unknown keys, audited) + minimal `/settings` page — the first
    consumer of the `settings.manage` permission seeded back in M1.
  - **Rate limiting:** `RateLimiterService` with explicit named policies
    in one file (token endpoints 30/min/IP, invite-info 30/min/IP, Google
    start 60/min/IP, evidence 15/h/user, claims 10/h/user, file upload
    60/h/user, sign 300/min/user), uniform `RATE_LIMITED` 429; the M1
    login-failure limiter untouched.
  - **Evidence retention (R3):** `LocalStorageAdapter.delete()`
    (idempotent, path-safe) + daily 03:00 sweep: APPROVED +30 days
    purged, CANCELLED purged, REJECTED retained, orphans purged after 7
    days; binary + metadata row removed, claim rows and audit history
    always preserved; every purge audited (system actor); storage-first
    ordering converges after crashes.
  - **OAuth state (R4):** `OauthStateConsumption` table (SHA-256 state
    hash, unique) — consumption is an atomic insert, replay = unique
    violation **across all API instances**; expired rows swept daily.
- **Database:** migration `20260823050551_m11_oauth_state_consumption`
  (additive) — migration count 5.
- **Problems encountered:** one W2-era test logged in as the demo student
  *after* switching the college to required — which W7's new cutover now
  correctly blocks. The test was updated to authenticate before the mode
  switch; the "failure" was the new security control working.
- **Testing:** **294/294** (16 new adversarial tests, incl.
  cross-instance state replay verified with two live app instances
  sharing one database, disk+DB purge assertions, and cutover bypass
  attempts made directly against the API).
- **Verification:** full Alloy walkthrough (settings flip → student
  blocked with USE_GOOGLE_LOGIN → staff unaffected → flip back);
  production Docker images rebuilt; OPERATIONS.md extended.
- **Result:** M11 complete — the identity/verification system is
  enforced end to end and production-hardened.

---

# 6. M10 SPECIAL HISTORICAL RECORD

M10's actual execution order, exactly as recorded in git, was:

**W3 → W1 → W2 → W4 → W5**

(`9c3c4b0` → `5d35c5f` → `86e9c96` → `31e653f` → `48f7185`)

This order was deliberate, not accidental: **W3 first** delivered the
environment-validation plumbing (including `FILE_URL_SECRET`) that W1's
signed URLs and later work depended on.

- **M10-W3 (`9c3c4b0`) — Production security/config hardening:** Helmet +
  trust proxy + `x-powered-by` off; production CORS allowlist
  (deny-by-default); Zod env validation failing fast on missing/short
  (≥32-char) secrets; interceptor-level upload limits (10 MB files, 1 MB
  CSV); production Dockerfiles, `docker-compose.prod.yaml`, env template.
  Tests: 141 → **151**.
- **M10-W1 (`5d35c5f`) — Signed expiring file downloads:** HMAC-SHA256
  over `key|exp` with timing-safe verification; `POST /files/sign`
  (internal URLs only) issuing 5-minute links; `GET /files/:key`
  enforcing `exp`+`sig` (`SIGNATURE_REQUIRED` / `LINK_EXPIRED` /
  `INVALID_SIGNATURE`); web `openFile()` replaced every raw download
  href. **Superseded M4's plain permanent file URLs** (verified: the M4
  design stored bare `/api/v1/files/:key` links with no access control
  beyond obscurity). Tests: **160**.
- **M10-W2 (`86e9c96`) — Invitation & password-reset tokens:**
  `CredentialToken` (INVITE 48h / RESET 24h, 256-bit random, SHA-256
  hashed at rest, atomic one-time acceptance, issuance revokes prior
  tokens); accounts created with unusable random passwords;
  `POST /auth/accept-invite`, `POST /auth/reset-password`, admin
  `POST /users/:id/reset-link`; accept-invite web page; invite URLs
  replaced temp passwords in creation and CSV import. **Superseded M2's
  temporary-password model** (verified: `generateTempPassword` was
  removed in this commit). Migration `20260822062836_credential_tokens`.
  Tests: **172**.
- **M10-W4 (`31e653f`) — Production seed safety guard:** demo seed
  (publicly documented passwords) refused when `NODE_ENV=production`
  unless `ALLOW_DEMO_SEED=true`; loud banner; system seed unaffected.
  **Discovery made here:** Prisma Client auto-loads `apps/api/.env`, so a
  test that assumed "SEED_DEMO unset" was actually inheriting
  `SEED_DEMO=true` from the dev env file — the test was corrected and the
  finding documented (the guard therefore also protects hosts that
  accidentally ship a dev `.env`). Tests: **181**.
- **M10-W5 (`48f7185`) — Operations runbook + final verification:**
  `docs/OPERATIONS.md` (deployment, secrets/rotation, migration order,
  backups/restores, health checks, troubleshooting, rollback), README
  link, full verification battery including production image builds and
  prod-boot fail-fast checks. Tests unchanged: **181**. M10 accepted at
  checkpoint `48f7185`.

---

# 7. M11 — THE VERIFICATION & PRODUCTION-HARDENING ERA

M11 began with two inspection-only phases producing the **M11 Blueprint
Rev. B** (Google authentication for students, institutional identity
verification, one real student = one account) and a set of locked
decisions: D1 (public minimal college list), D2 (self-registration exists
but per-college, off by default), D3 (no account merging in v1 — reject
with guidance), D5 (mandatory evidence for self-registration; 30-day
retention after approval), D6 (explicit "use Google" messaging only after
valid credentials + rate limiter), D7 (per-college cutover with an
operational grace period). Per-workstream details are in §5; this chapter
explains how the pieces became a system.

### How M11 evolved as a system

1. **W1 made identity a database fact.** Before W1, "who is this student,
   really?" had no representation. W1 added the provider identity table
   (`sub`-keyed), the claim table, and — critically — put the core
   invariant *one live claim per real student* into PostgreSQL partial
   unique indexes, so no later application bug could ever mint duplicate
   student identities.
2. **W2 added a second way to authenticate without a second session
   system.** Google login ends in exactly the same TokenService/cookie
   path as password login. Email was never allowed to become identity.
3. **W3 turned the claim table into a workflow**: evidence (a restricted
   file class with its own sign-time authorization), enumeration-safe
   submission, and an admin decision process whose transitions are atomic
   and audited — with notifications exactly-once by construction.
4. **W4 connected the old world to the new.** The M10-W2 invitation —
   already possession-proof issued by an admin — became the trusted
   on-ramp: acceptance by either method produces VERIFIED **and** a
   synthetic APPROVED claim occupying the DB slot. Impostor PENDING
   claims are superseded atomically. From this point, *every* verified
   identity, however it got verified, is protected by the same database
   invariant.
5. **W5 made the lifecycle enforceable and visible.** The
   UNVERIFIED → PENDING → VERIFIED/REJECTED lifecycle stopped being just
   a column: PolicyService refuses all non-verification permissions to
   mid-lifecycle accounts, middleware pins them to `/verify`, and the UI
   walks them through claim → pending → rejected/resubmit → approved.
6. **W6 gave admins their half of the loop** — a queue and evidence
   viewer that consumes the W3 API without ever becoming an authorization
   layer.
7. **W7 flipped the last switch and hardened the edges**: Google-only
   enforcement at the login endpoint itself (data-driven on
   StudentProfile ownership), a settings surface to operate the rollout,
   rate limits on every security-sensitive endpoint, retention for the
   ID-card evidence, and multi-instance-safe OAuth state.

The result: **invitation possession, Google `sub` identity, ID evidence,
admin review, PolicyService, signed evidence access, database uniqueness
and production controls all converge on one invariant — one real student
identity = one CampusOS account — enforced server-side at every layer.**

---

# 8. ARCHITECTURE EVOLUTION

### Early architecture (M0–M1)
Monorepo; complete schema up front; envelope/error conventions and the
guard chain established immediately. The single most consequential early
choice was resolving permissions from the database per request rather
than embedding them in JWTs — it made every later authorization change
(lifecycle gate, new permissions) take effect without re-login.

### Authentication evolution
Password (M1) → hashed one-time credential tokens replacing temp
passwords (M10-W2) → rotating refresh sessions with reuse detection (M1,
unchanged since) → Google OIDC (M11-W2) → identity linking + invitation
Google flow (M11-W2/W4) → DB-backed one-time OAuth state (M11-W7) →
required-mode cutover (M11-W7). At no point did a second session
architecture appear; every method funnels into the same token family
issuance and cookie set.

### Authorization evolution
Roles existed from M0 but only as *inputs to the grant matrix* — the code
itself has been permission-driven since M1. Evolution: permissions +
PolicyService (M1) → tenant-aware scoping via OWN/ASSIGNED/DEPARTMENT/ALL
(M1–M2) → route→permission map shared with the web middleware (M1) → two
verification permissions (M11-W1) → the lifecycle gate (M11-W5), which
was implemented *inside PolicyService* precisely to keep a single
authorization authority.

### File/storage evolution
Local adapter with unguessable keys (M4) → size limits (M10-W3) → signed
expiring URLs with timing-safe verification (M10-W1) → per-viewer
sign-time authorization for the evidence file class + audit (M11-W3) →
idempotent deletion + retention sweep (M11-W7). The S3-shaped interface
has never needed to change.

### Notification evolution
Notification rows written directly (M3/M4) → typed domain events +
listeners + template registry (M8, formalizing the pattern) → scheduled
daily sweeps (M8) → verification decision events with exactly-once
semantics derived from atomic state transitions (M11-W3/W4). The
architecture is email-ready (a delivery channel would be a new listener),
but **no email delivery exists**.

### Tenancy evolution
Tenant-aware schema from M0 → tenant-scoped services and 404 semantics
(M1 onward) → tenancy-aware verification (claims carry collegeId;
AuthIdentity deliberately global because a Google account is one human
across the platform, M11-W1/W3) → per-college feature flags in
`College.settings` with a management surface (M11-W7). Still exactly one
college seeded; college creation/administration does not exist.

### Verification evolution
None (M0–M10) → status column + claim/identity tables + DB invariants
(W1) → claims/evidence workflow (W3) → invitation-anchored verification +
supersession (W4) → lifecycle enforcement + student UX (W5) → admin
review UX (W6) → cutover + retention (W7).

---

# 9. DATABASE EVOLUTION

All five migrations, chronological (all additive; none destructive):

| # | Migration | Milestone | Purpose |
|---|---|---|---|
| 1 | `20260820164746_init` | M0 | Entire Blueprint domain model: identity/access (User, RefreshToken, Permission/RolePermission), college structure, academics, attendance, assignments, exams, fees, community, moderation, notifications, audit. Tenancy uniques (`User @@unique([collegeId,email])`, `StudentProfile @@unique([collegeId,admissionNo])`, college-scoped codes/labels). FK policy: Restrict / Cascade / SetNull by data class. |
| 2 | `20260822062836_credential_tokens` | M10-W2 | `CredentialToken` (INVITE/RESET): `tokenHash @unique` — tokens exist only as SHA-256 hashes; single-use via atomic `usedAt` claims. Replaced the temp-password model. |
| 3 | `20260822071747_m11_identity_foundation` | M11-W1 | `AuthIdentity` (`@@unique([provider,providerSub])` — one Google account platform-wide; `@@unique([userId,provider])`); `StudentIdentityClaim` + **raw-SQL partial unique indexes**: `StudentIdentityClaim_live_profile_key` (one PENDING/APPROVED claim per profile) and `StudentIdentityClaim_pending_user_key` (one in-flight claim per user); `User.passwordHash` → nullable; `User.verificationStatus` (default LEGACY). The security core of duplicate prevention. |
| 4 | `20260822163204_m11_evidence_files` | M11-W3 | `EvidenceFile` (`key @unique`, uploader Cascade, college Restrict) — purpose/ownership metadata making ID-card evidence a restricted file class. |
| 5 | `20260823050551_m11_oauth_state_consumption` | M11-W7 | `OauthStateConsumption` (`stateHash @unique`, expiry) — atomic one-time OAuth state across all API instances; hashes only, never plaintext state. |

**Current migration count: 5. Current schema status: up to date.**

---

# 10. SECURITY EVOLUTION

Chronological problem → solution → verification:

| When | Control | Problem → Solution → Verification |
|---|---|---|
| M1 | argon2id hashing; rotating hashed refresh tokens + family reuse detection | Session theft/replay → opaque rotating tokens hashed at rest → auth e2e suite |
| M1 | PolicyService + tenant isolation + generic errors + login rate limiting | Authorization drift, enumeration, credential stuffing → single DB-resolved permission engine, 404 tenancy semantics, uniform `INVALID_CREDENTIALS`, per-IP+account backoff → per-module denial/tenancy tests |
| M10-W3 | Helmet, prod CORS allowlist, env fail-fast, upload limits | Half-secure misconfigured deployments → boot-time validation + secure headers → hardening suite + manual prod-boot checks |
| M10-W1 | Signed expiring file URLs | Permanent unauthenticated download links → HMAC(key\|exp), 5-min TTL, timing-safe verify → tamper/expiry tests + byte-identical Alloy check |
| M10-W2 | Hashed one-time credential tokens | Plaintext temp passwords in responses → 256-bit tokens hashed at rest, atomic single use, unusable initial passwords → 12 e2e tests |
| M10-W4 | Seed guard | Demo accounts with public passwords reaching production → loud refusal + explicit override → decision + CLI tests |
| M11-W1 | DB-level identity uniqueness; fail-closed null passwords | Duplicate accounts via races; password-less accounts → partial unique indexes; login fails closed → 5-way race test |
| M11-W2 | OIDC state/PKCE/nonce/JWKS; `sub`-keyed identity; no email auto-link | OAuth CSRF/replay; email pre-hijack takeover → signed one-time state cookie, PKCE S256, nonce, JWKS rotation cache, explicit-link-only → 29 tests incl. replay and email-squatting |
| M11-W3 | Evidence class controls | ID cards must be evidence, never credentials, never public → magic-byte MIME allowlist, sign-time viewer authorization (owner/reviewer, 404 otherwise), full audit → signing-matrix tests |
| M11-W4 | Transactional onboarding | Failed acceptance must never burn tokens; impostor squatting → rollback-safe single transaction; audited auto-supersession → rollback + race tests |
| M11-W5 | Lifecycle gate in PolicyService | Mid-verification accounts must not act as students → only `verification.submit` resolves → gate matrix tests |
| M11-W7 | Cutover, rate policies, retention, shared OAuth state | Password bypass of Google-only; disk-fill; endpoint flooding; cross-instance replay; indefinite ID storage → server-side USE_GOOGLE_LOGIN gate, explicit 429 policies, R3 retention with audit, `OauthStateConsumption` → 16 adversarial tests incl. two-instance replay |

**Known/deferred security debt (documented, accepted):** per-instance
rate limits (ceiling = policy × instances); no dual-key
`FILE_URL_SECRET` rotation window (300 s TTL makes rotation a safe kill
switch); staff password resets are admin-issued only (no self-service
"forgot password").

---

# 11. TESTING EVOLUTION

Exact recorded progression (per-milestone counts before M9 were not
individually recorded):

| Tests | Milestone |
|---:|---|
| 141 | M9 baseline |
| 151 | M10-W3 |
| 160 | M10-W1 |
| 172 | M10-W2 |
| 181 | M10-W4 (unchanged through M10-W5) |
| 192 | M11-W1 |
| 221 | M11-W2 |
| 245 | M11-W3 |
| 266 | M11-W4 |
| 273 | M11-W5 |
| 278 | M11-W6 |
| **294** | **M11-W7 (current)** |

How testing matured: basic per-module e2e regression (M1–M9) →
security/tenancy denial tests in every module → constraint-level race
tests (M11-W1's 5-way claim race) → full-flow adversarial tests (OAuth
state replay, email-squatting, token rollback, acceptance races) →
**cross-instance verification** (two live Nest apps on one database,
M11-W7) → retention tests asserting both disk and database state.

Complementary verification used throughout: `npm run typecheck` across
all three packages; Alloy browser walkthroughs with Playwright for every
UI milestone; direct `curl` verification of API flows; production Docker
image builds (M10-W5, re-verified in M11-W7); Prisma migrate status
checks. There are no frontend unit/component tests — a deliberate
trade-off, mitigated by the Alloy browser verification discipline.

Test-infrastructure conventions that emerged: per-suite Nest apps with DI
overrides (fake Google OIDC client), rate-limiter reset hooks, strict
teardown of created data (twice a source of cross-suite pollution — see
§12), suffix-tagged fixtures.

---

# 12. REAL PROBLEMS ENCOUNTERED

Chronological engineering incidents (all evidenced in commits, test
diffs, or milestone reports):

1. **Parallel refresh storm (M4, fixed in `ee47c54`).** 401 bursts caused
   multiple simultaneous refresh calls. Root cause: no single-flight
   guard in the web API client. Fix shipped inside the M4 commit.
2. **Prisma dotenv discovery (M10-W4, `31e653f`).** A seed-guard test
   assumed `SEED_DEMO` was unset, but `@prisma/client` auto-loads
   `apps/api/.env` (which sets `SEED_DEMO=true` for Alloy). Fix: the test
   models a production host with an explicit `SEED_DEMO=false`; the
   finding was documented — the guard also protects hosts that ship a dev
   `.env` by mistake.
3. **Hardcoded permission-count assertion (M11-W1, `2581a21`).**
   `auth.e2e-spec.ts` asserted the catalog length as literal `30`; W1's
   two new permissions broke it. Fix: derive from shared `PERMISSIONS`.
4. **`/accept-invite` blocked by middleware (M10-W2, `86e9c96`).** The
   new public page was redirected to login. Root cause: not in the
   middleware's public path list. Fix: `ALWAYS_PUBLIC_PATHS`; caught
   during the mandatory Alloy manual flow.
5. **Sandbox restart wiped untracked W4 files (M11-W4).** Mid-workstream
   the development sandbox restarted; the Docker stack and two untracked
   files (`onboarding.service.ts`, its spec) were lost while tracked
   modifications survived. Fix: recreate both, re-run everything. Also
   surfaced a stray auto-commit (`bfb8bc0`, later removed to restore the
   approved checkpoint) when a subsequent stop-order interrupted work —
   the branch was reset to `b33af5f` and force-pushed with explicit
   authorization.
6. **Cross-suite demo-state pollution (M11-W4).** W4's new link
   auto-verification changed demo-student state that older suites assumed
   canonical; several suite teardowns had also missed new FK children
   (claims/evidence). Fix: teardowns now restore the demo student to
   LEGACY and clean new tables; a later cleanup (M11-W6 Alloy pass)
   removed residue left by one historical failed teardown.
7. **W7 cutover "broke" a W2 test (M11-W7, `f9632a4`).** A test logged in
   as the demo student *after* flipping the college to `required` — the
   new server-side cutover correctly refused it. Fix: authenticate before
   the mode switch. The failure was the new control working as designed.

---

# 13. MAJOR ARCHITECTURAL DECISIONS

| Decision | Why | Consequence | Milestone | Still valid? |
|---|---|---|---|---|
| PolicyService instead of role conditionals | Single auditable authorization source shared with web routing | Every later feature added permissions, never `if role ===`; lifecycle gate slotted in cleanly | M1 | Yes |
| DB-resolved permissions (never from JWT) | Matrix edits effective immediately; no stale claims | Slight per-request cost, accepted | M1 | Yes |
| Google `sub` as the provider identity key | Emails are mutable/recyclable; email-keying enables pre-hijack | Email changes are non-events; linking always explicit | M11 blueprint / W1 | Yes |
| No email-based auto-linking, ever | Account-takeover class elimination | One extra explicit step for users; tested adversarially | M11-W2 | Yes |
| PostgreSQL uniqueness (partial unique indexes) for duplicate prevention | App-level checks cannot survive concurrency | Invariant holds across instances; P2002 mapped to generic errors | M11-W1 | Yes |
| D3: no account merging in v1 | Merging is risky; invitations are the sanctioned path | `PROFILE_HAS_ACCOUNT` guard; merge remains future work | M11-W3/W4 | Yes |
| Invitation possession = identity proof (auto-verify + synthetic APPROVED claim) | Admin issued the invite for a specific record | Every verified identity holds a DB slot regardless of path | M11-W4 | Yes |
| Required-mode semantics: ALL StudentProfile owners blocked from password login | "Required means Google-only"; grace is operational, not a hidden exception | Simple, testable rule; staff unaffected (data-driven) | M11-W7 (decision R1) | Yes |
| DB OAuth state consumption (hashed) | In-memory one-time store fails multi-instance | Replay atomic-refused everywhere; daily hygiene sweep | M11-W7 (R4) | Yes |
| Evidence retention policy (30d approved / immediate-at-sweep cancelled / rejected retained / 7d orphans) | ID documents must not live forever; history must | Irreversible purges with audit; claim rows preserved | M11-W7 (R3/D5) | Yes |
| No Redis / queues / premature infrastructure | Blueprint §14; single-instance MVP reality | In-memory rate limits documented; revisit at scale | M0 stance, reaffirmed M11-W7 | Yes, with documented ceiling |
| Credential tokens over plaintext passwords | Standing leak in responses/CSVs | No plaintext credential ever leaves the API | M10-W2 | Yes |
| Print-CSS over PDF generation for report cards | Avoid a heavyweight dependency | **PLANNED ONLY** — appears in M12 planning; nothing implemented | M12 planning | Not yet decided/implemented |

---

# 14. FEATURES THAT WERE SUPERSEDED

The real engineering story includes deliberate temporary designs:

1. **Temporary passwords → invitation/reset tokens.**
   *Old:* M2 returned generated temp passwords in create/import responses
   (`generateTempPassword`). *Why it existed:* simplest MVP onboarding.
   *Why insufficient:* plaintext credentials in API responses and CSV
   summaries are a standing leak. *Replaced by:* M10-W2 hashed one-time
   `CredentialToken`s + unusable initial passwords (`86e9c96`).
2. **Plain file URLs → signed, then authorization-gated access.**
   *Old:* M4 stored bare `/api/v1/files/:key` links — permanent once
   known. *Replaced by:* M10-W1 signed 5-minute URLs (`5d35c5f`), then
   M11-W3 added per-viewer authorization at signing time for the
   evidence class (`51069ab`).
3. **No identity verification → the full M11 lifecycle.**
   *Old:* through M10, admin creation *was* identity; nothing bound a
   login to a real student. *Replaced by:* M11's AuthIdentity + claims +
   evidence + review + invitation-anchored verification + lifecycle
   enforcement (W1–W7).
4. **In-memory OAuth state → DB-backed consumption.**
   *Old:* M11-W2's consumed-state Map — correct on one instance,
   documented as debt. *Replaced by:* `OauthStateConsumption` in M11-W7
   (`f9632a4`).
5. **Password login for students in Google-only colleges → cutover
   enforcement.** *Old:* through W6, `required` affected invites/unlink
   but not the login endpoint (explicitly deferred to W7). *Replaced by:*
   the W7 `USE_GOOGLE_LOGIN` gate.
6. **Unused `settings.manage` permission → settings surface.** Seeded in
   M1, first consumed in M11-W7's settings API/UI.

---

# 15. CURRENT SYSTEM STATE

**Checkpoint (verified):**
- Commit: **`f9632a4`** · Working tree: **clean**
- M0–M10: **complete** · M11-W1 → W7: **complete**
- Tests: **294/294** (19 suites) · Typecheck: **0 errors**
- Migrations: **5**, schema **up to date**
- Alloy stack: **healthy** (postgres/api/web; preview at :8080)
- Production images: **build successfully** (api + web, verified in W7)
- Development history: updated through M11-W7

**What CampusOS can actually do today:** run a complete single college —
onboard students via secure invitations (password or Google), verify
student identity with ID evidence and admin review, prevent duplicate
student accounts at the database level, operate Google-only sign-in per
college, manage academics end to end (departments → results), bill and
record fees manually, host a moderated campus community, notify users
in-app, audit security-relevant actions, and be deployed to production
with documented operations, backups, secrets and rollback procedures.

---

# 16. WHAT IS NOT BUILT YET

**NOT IMPLEMENTED — critical for real-world adoption:**
- Email delivery (invitations/resets/notifications exist only in-app or
  as copy-paste links)
- Report cards / printable or exportable results
- CSV/data exports (attendance registers, fee ledgers, directories)

**NOT IMPLEMENTED — important:**
- Audit log viewer UI (data exists; no surface)
- Guardian/parent portal (guardian fields exist on StudentProfile; no
  accounts/role)
- Online payments (manual recording only)
- Staff self-service "forgot password" (resets are admin-issued)
- Multi-college administration (schema is ready; no college
  creation/operator tooling — exactly one college is seeded)
- Global search (per-list search only)
- Term rollover / batch promotion tooling
- Teacher CSV import (students only)
- `/profile` page (route mapping exists with no page — known dead
  mapping)

**NOT IMPLEMENTED — future ideas:** PWA/mobile polish, observability
(metrics/tracing), job queue / S3 storage / notification fan-out
batching (scale work), GPA/transcripts (hooks dormant), library/hostel/
transport modules, AI features.

**DEFERRED TECHNICAL DEBT** (distinct from product gaps): see §17.

M12 planning exists **only as an inspection report** — none of it is
implemented.

---

# 17. TECHNICAL DEBT EVOLUTION

| Debt | Introduced | Reason | Status |
|---|---|---|---|
| Temp passwords in responses | M2 | MVP onboarding | **Resolved** M10-W2 |
| Plain file URLs | M4 | MVP simplicity | **Resolved** M10-W1 (+W3 evidence authz in M11) |
| In-memory OAuth state | M11-W2 | single-instance target, documented | **Resolved** M11-W7 |
| Evidence retention missing | M11-W3 | access control shipped first | **Resolved** M11-W7 (policy R3) |
| Student cutover not enforced at login | M11-W4 | planned W7 scope | **Resolved** M11-W7 |
| Per-instance rate limiting | M1/M11-W7 | Blueprint avoids Redis | **Deferred** — documented ceiling (policy × instances); revisit when horizontally scaled |
| No dual-key FILE_URL_SECRET rotation window | M10-W1 | 300 s TTL makes rotation safe | **Permanently acceptable** (documented) |
| Prisma 5.22 vs 7.x major | ongoing advisory | upgrade churn risk | **Deferred** — candidate isolated workstream in M12 planning |
| Backup automation (scripts documented, not shipped) | M10-W5 | doc-only scope | **Deferred** |
| Notification fan-out unbatched | M8 | fine at current scale | **Deferred** until large colleges |
| Dead `/profile` route mapping | M0/M1 era | page never built | **Open** (trivial) |

---

# 18. DOCUMENTATION EVOLUTION

- **README** — from M0; run instructions, demo accounts; gained links to
  the operations runbook (M10-W5) and development history (post-M11-W3).
- **docs/OPERATIONS.md** — created M10-W5 (`48f7185`): deployment,
  secrets/rotation, migrations, backups/restores, health, troubleshooting,
  rollback; extended in M11-W7 with cutover/grace procedure, rate-limit
  table, evidence retention and OAuth-state hygiene.
- **docs/CAMPUSOS_DEVELOPMENT_HISTORY.md** — created after M11-W3
  (`5fef900`) as the canonical milestone record, with a standing rule
  adopted at that point: **every completed milestone updates it in the
  same commit whenever practical** (honored by W4–W7, each of whose
  commits includes the history update).
- **This document** (`docs/CAMPUSOS_COMPLETE_DEVELOPMENT_JOURNEY.md`) —
  the deeper chronological narrative, created at the M11 checkpoint.

---

# 19. FINAL ARCHITECTURE MAP

```
Browser
  ↓ (Alloy/desktop proxy · cookies: cos_refresh / cos_auth / cos_oauth)
Next.js web (App Router; middleware = routing hints from shared route map)
  ↓ /api/v1 (same-origin)
NestJS API — EnvelopeInterceptor · GlobalExceptionFilter · Helmet · CORS
  ↓
JwtAuthGuard → PermissionsGuard → PolicyService (DB grants + lifecycle gate)
  ↓
Domain modules (auth · google · verification · settings · users · academics
  · timetable · attendance · assignments · exams · fees · community
  · moderation · announcements · notifications · files · dashboards
  · audit · health) — all tenant-scoped by collegeId
  ↓
Prisma → PostgreSQL 16 (uniques & partial-unique invariants)
Side rails: EventsService → listeners → Notification rows → inbox/bell
            @nestjs/schedule → daily sweeps (notifications · retention · state hygiene)
            LocalStorageAdapter → uploads volume (signed URL access only)
            AuditService → AuditLog
            RateLimiterService → named policies (429)
```

Major flows: **Authentication** (password or Google → same token-family
session); **Authorization** (permission grants + lifecycle, resolved per
request); **Verification** (evidence upload → claim → admin decision /
invitation auto-verify → DB slot held); **Evidence** (restricted class:
authorized signing, audited access, retention purge); **Notifications**
(typed events → templates → inbox); **Academics/Finance/Community** (CRUD
modules over tenant-scoped Prisma); **Tenancy** (collegeId everywhere,
404 semantics, per-college settings).

---

# 20. THE CAMPUSOS STORY IN ONE TIMELINE

```
Foundation .............................. M0        e05785c
Authentication & authorization core ..... M1        51f7ea3
People & academic structure ............. M2        12ee991
Timetable & attendance .................. M3        2dc57f3
Assignments & files ..................... M4        ee47c54
Exams & results ......................... M5        f8c8252
Fees .................................... M6        e0e2b59
Community ............................... M7        5260fac
Moderation, notifications, announcements  M8        395fdd5
Dashboards & MVP hardening (141 tests) .. M9        eb833f7
Production hardening (actual order):
  security/config ....................... M10-W3    9c3c4b0
  signed file downloads ................. M10-W1    5d35c5f
  invitation/reset tokens ............... M10-W2    86e9c96
  seed safety ........................... M10-W4    31e653f
  operations runbook .................... M10-W5    48f7185
Identity foundation ..................... M11-W1    2581a21
Google identity (OIDC) .................. M11-W2    768fb05
Claims & evidence ....................... M11-W3    51069ab
  (canonical history doc created ........ docs      5fef900)
Verified onboarding ..................... M11-W4    7901d18
Student lifecycle enforcement + UI ...... M11-W5    b33af5f
Admin verification center ............... M11-W6    6d7984d
Cutover + production hardening .......... M11-W7    f9632a4
M11 COMPLETE — 294/294 tests, 5 migrations, production-ready
```

---

# 21. CURRENT BASELINE FOR THE NEXT PHASE

**CampusOS development is currently paused at M11 completion.**

- Current commit: **`f9632a4`**
- **M12 = NOT STARTED.**
- No M12 code exists. No M12 migration exists. No M12 implementation has
  been authorized.
- The M12 material referenced in §16 exists solely as an inspection/
  planning report awaiting decisions; nothing from it has been
  implemented.

The next phase must begin from this checkpoint, after explicit
authorization, and must continue the standing rule of updating
`docs/CAMPUSOS_DEVELOPMENT_HISTORY.md` (and this journey document at
major checkpoints) as milestones complete.
