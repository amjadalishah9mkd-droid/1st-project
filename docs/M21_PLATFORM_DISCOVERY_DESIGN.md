# M21 — Platform Discovery & Design (W0: discovery/design ONLY)

Status: DESIGN. Nothing implemented. Baseline HEAD `12a7eca` (M20 CLOSED):
602/602 tests (46 suites), typecheck 0, 14 migrations up to date, prisma
validate clean, API/web prod builds green, containers healthy (api/web/
postgres + backup sidecar), remote = local, tree clean.

## 1. Executive summary

After M20, CampusOS is a functionally deep single-college platform:
identity/verification, guardians, academics through immutable finalized
records, finance through immutable numbered receipts, hardened files/mail/
limiters, automated backups with a proven restore drill, deep health. The
discovery found **no critical security defect**. The most consequential
verified gap is an **account-lifecycle hole**: `UserStatus`
(ACTIVE/SUSPENDED/ARCHIVED) is enforced at EVERY auth boundary
(jwt-auth.guard.ts:76, token.service.ts:143, google-auth.service.ts:360/408,
credential-tokens.service.ts:130, auth.service.ts:66, policy.service.ts:115)
and `users.manage` is documented as "Create, update, **archive and
suspend** user accounts" (permissions.ts:53) — **but no endpoint or UI
exists anywhere to change a user's status** (grep of apps/api/src/users:
zero writes). Offboarding a departed staff member or misbehaving account
today requires raw SQL. Alongside it: two dead college settings
(`attendanceWarningThreshold`, `locale` — seeded, never read), a
settings UI covering only Google-auth keys, and no session-revocation
lever. RECOMMENDED M21: **Account Lifecycle & Institutional
Administration** — suspension/reactivation/archival with immediate session
revocation, admin UI, settings completion, dead-config disposition.

## 2. Current platform state (source-traced)

Verified live at `12a7eca`: 602/602, typecheck 0, 14 migrations, builds
green, all four containers healthy, four demo logins 200, `/health/ops`
green (db up, 14/0 migrations, backups fresh), restore drill last proven
in M20-W4 with live-DB checksum equality.

## 3. M0–M20 completion map

M0–M10 foundation/core modules; M11 identity/verification + Google OIDC;
M12 mail/notifications + report printing; M13 guardians (CHILD scope);
M14 online payments (Safepay, live-verified); M15 rollover; M16 refunds +
ACCOUNTANT; M17 term lifecycle; M18 immutable academic records; M19
platform hardening (StoredFile authz/migration #13, mail escaping,
callback limiter, emergency-contact privacy, backup sidecar + restore
drill, /health/ops); M20 finance documents (migration #14, RCP-/RFD-
numbering, read API, print UI, mail links). All CLOSED with commit chains
in CAMPUSOS_DEVELOPMENT_HISTORY.md.

## 4. Architecture inventory

NestJS API (apps/api) + Prisma/PostgreSQL (14 forward-only migrations) +
Next.js 14 web (apps/web) + shared Zod/types package. Authorization =
PolicyService scopes (ALL/ASSIGNED/OWN/CHILD) over a static
role-permission matrix; zero role-name conditionals in authz. Tenancy =
server-derived collegeId everywhere; cross-tenant = indistinguishable
404. Audit = AuditService with in-tx support. Files = signed 5-min URLs +
StoredFile ownership. Mail = single escaped layout() chokepoint. Money =
immutable Payment/Refund + netPaid(). Documents = immutable FinanceDocument
+ M18 TermResult versioning. Ops = compose stack + backup sidecar +
/health/ops. Versions: Node ≥20, Prisma ^5.19.1 (pinned 5.22, two majors
behind), Nest ^10.4, Next ^14.2/React 18 — moderate upgrade pressure,
maintenance-window class.

## 5. Security posture

M19 + M20 audits PASS. W0 re-sweep: no role-name authz conditionals, no
client collegeId, no raw/unsafe SQL, no shell/eval, no
dangerouslySetInnerHTML, no path traversal beyond guarded adapters, no
destructive client-reachable endpoints, no historical-record mutation
paths. **No critical defect found; nothing blocks M21 planning.**
Notable non-critical finding (the M21 driver): account offboarding is
enforced-but-unreachable (§1) — an operational security gap, not an
exploitable hole (enforcement exists; the admin lever does not).

## 6. Tenancy/authz posture

PolicyService reads status per request ("revocation takes effect
immediately", policy.service.ts:158) — meaning a status flip would take
effect on the next request even without token revocation; refresh-token
rotation (family-based, hashed) plus `token.service.ts:143` already
refuses non-ACTIVE users. The suspension feature therefore composes
entirely from existing enforcement.

## 7. Academic status

Complete through M18: exams/marks, finalized TermResult/CourseResult with
versioning, transcript/report print, rollover with GRADUATED/WITHDRAWN
handling (rollover.service.ts:31–37, 610). GPA/repeat/rank remain
policy-gated (institutional decisions — unchanged). `StudentStatus`
(ENROLLED/GRADUATED/WITHDRAWN/SUSPENDED) is used by rollover/finalization;
student-status changes flow through rollover, not ad-hoc edits.

## 8. Finance status

Complete through M20 (receipts/refund documents, void, print, mail
links). Deferred: server PDF, receipts.csv, branding fields, attachments,
webhooks (EXTERNALLY BLOCKED), provider polling, per-college secrets,
maker-checker.

## 9. Operations/reliability status

Backups automated + restore-verified; /health/ops (db, migrations, backup
freshness, uploads, uptime). **Not present**: request IDs, structured
error log, error counters, request metrics (observability V1 shipped deep
health only — error counters remain genuinely open internal debt);
off-host copies/PITR/external SaaS deferred.

## 10. Integration status

Google OIDC complete (env-level single-tenant credentials). Safepay:
init/verify/refund live-verified; webhook delivery still EXTERNALLY
BLOCKED (dashboard registration; GatewayEvent ledger ready, 0 rows ever);
single `SAFEPAY_WEBHOOK_SECRET` env (config/env.ts:48) — a second college
cannot carry separate credentials (multi-college blocker, unchanged).

## 11. UI/document status

30+ routes; admin surfaces exist for audit, verification, moderation,
calendar/rollover, settings (Google-auth only), finance documents.
**UI-less**: /health/ops; status/offboarding controls (nonexistent
API-side too); settings beyond Google keys. Browser print = the document
pattern (M12/M18/M20); no PDF dependency anywhere.

## 12. Debt-register audit (every documented item, classified)

| Item | Class | Evidence |
|---|---|---|
| P2-IDOR-1 file ownership | A COMPLETE | M19-W1 `StoredFile` + tests |
| Backup automation | A COMPLETE | M19-W3 sidecar + drill (off-host copies excluded) |
| Receipts/PDF platform (M20 candidate) | A COMPLETE (receipts) / J (server PDF) | M20 closed; PDF explicitly deferred |
| Evidence retention, OAuth state store, F2/F3, login-limiter memory, P2-GUARD-1, cutover gate | A COMPLETE | resolved entries M11–M14 |
| Safepay webhook registration/replay | I EXTERNAL BLOCKER | dashboard-only; no credentials; 0 GatewayEvents |
| Single global webhook secret | C BLOCKED (second-college trigger) | env.ts:48 |
| Provider polling | J FUTURE | unchanged |
| Maker-checker | F PRODUCT DECISION | unchanged |
| GPA scale / repeat-course / rank-standing | F PRODUCT DECISION | GradeBand.gradePoint seeded null by design |
| Per-instance rate limits | J (revisit on horizontal scale) | documented ceiling |
| Prisma major upgrade (5→6; Nest 11, Next 15 similar) | H INFRA DECISION | package.json evidence; maintenance window |
| FILE_URL_SECRET rotation grace | J | 300s TTL, negligible |
| Account merging for provisioned-profile claims | F PRODUCT DECISION | D3 reject-with-guidance stands |
| Guardian revoke/list unlimited; grade-bands guardian-readable | D/J accepted | reviewed M13-W5 |
| Off-host backups / PITR / external monitoring / distributed limiter | H INFRA DECISION / J | M19 O-3/O-4 boundaries |
| **NEW (W0 discoveries, not previously registered):** | | |
| No user suspend/archive capability despite full enforcement + permission text | **B UNBLOCKED — recommended M21 core** | §1 citations |
| `attendanceWarningThreshold` dead config (seed-only, never read) | B UNBLOCKED | system.seed.ts:23; zero read sites |
| `locale` dead config | F PRODUCT DECISION (retire vs i18n) | system.seed.ts:24; zero read sites |
| Settings UI covers only Google-auth keys | B UNBLOCKED | settings/page.tsx:43–51 |
| Observability: no error counters/request IDs | B UNBLOCKED (internal V1 remainder) | health.controller.ts:41–61 |
| No dedicated announcements/users-CRUD e2e suites | E PARTIAL (indirect coverage) | suite inventory |
| No leave/excuse workflow (EXCUSED status exists per-record) | F PRODUCT DECISION | attendance.controller.ts:38–86 |
| No notification preferences beyond emailOptOut / no digest | J FUTURE | inbox.controller.ts:94–113 |
| No global search | J FUTURE | per-list `q` only |

No historical status was silently changed; the two M19-W0-era register
corrections (DEPARTMENT scope, guardian columns) remain accurate.

## 13. Deferred-item audit

All 16 mandated items re-verified (§12 + §26): none became unblocked
except those explicitly listed as NEW/B above; none are implemented in W0.

## 14. Candidate M21 milestones

**A — Account Lifecycle & Institutional Administration (RECOMMENDED).**
Suspend/reactivate/archive users (API+UI, `users.manage`), immediate
session revocation, offboarding audit trail, settings completion
(attendanceWarningThreshold made live, locale disposition, settings UI),
admin reset-link surfacing. Value: closes the only way-to-production
operational security gap; scope: users/auth/settings/attendance modules;
deps: none (all enforcement exists); schema: likely NONE (status fields
exist; possible `statusChangedAt/statusReason` columns — decision O-2);
complexity: moderate; tests: real-Postgres lifecycle matrix; ops: runbook
§30; unlocks: safe real-institution operation, prerequisite for
multi-college. Risk: low (composes existing enforcement). ~4 workstreams.

**B — Observability V1 completion.** Request IDs, structured error log,
error counters into /health/ops. Internal-only, bounded, but lower
user/business value than A and partially an M19 remainder; strong W2
companion or M22. ~2–3 workstreams.

**C — Reporting & analytics.** Date-range finance/attendance/enrollment
reports + a reports page over existing aggregates/exports. Product value,
ALL-scope, low risk; but no security/production-readiness urgency. ~4.

**D — Attendance engagement.** Threshold warnings (needs A's settings
work first) + leave workflow (needs product decisions). Partially blocked
by A and by F-class decisions.

**E — Server PDF/document platform.** Heavy deps/threat surface;
explicitly deferred twice with evidence; not now.

**F — Multi-college enablement.** Needs per-college gateway secrets,
OAuth strategy, seeds — H/I-class blockers; premature before lifecycle
management exists.

**G — Dependency upgrades (Prisma 6 / Nest 11 / Next 15).** Maintenance
window work; no feature value; schedule separately, not as a milestone.

## 15. Candidate comparison (ranked per mandate criteria)

A scores first on security impact (offboarding), production readiness,
architectural leverage (unlocks D and F), real-Postgres testability,
zero external deps, boundedness, minimal destabilization (reuses every
existing gate), and clean W1→W4 shape. B is second (internal, bounded,
lower value). C third (value without urgency). D blocked-by-A; E/F
blocked/deferred; G not a milestone.

## 16. Recommended M21

**M21 — Account Lifecycle & Institutional Administration**: make the
already-enforced account states operable (suspend/reactivate/archive with
instant effect), finish the settings surface, and retire the dead-config
debt — the last operational gaps between CampusOS and running a real
institution.

## 17. Recommended W0→W4 structure

- **W1 — Lifecycle API foundation.** `PATCH /users/:id/status` (or
  suspend/reactivate/archive endpoints per O-1) under `users.manage`,
  tenant-gated, CAS state rules (O-3), immediate refresh-token family
  revocation on leaving ACTIVE (reuse token.service), self-suspension and
  last-admin protection (O-4), audit `users.suspended|reactivated|archived`
  in-tx. Real-Postgres matrix: authz, tenancy, instant lockout (live
  access token dies at guard; refresh dies at token service), race/CAS,
  audit exactly-once, demo-account safety. STOP: suite green.
- **W2 — Settings completion & dead-config disposition.** Extend
  `collegeSettingsSchema` with `attendanceWarningThreshold` (validated
  int, wired: attendance summary + student/teacher dashboards flag
  below-threshold students — read-only surfacing, no new notification type
  unless O-6 approves a scheduler sweep); locale per O-5 (recommend:
  retire from seed OR document as reserved — no i18n framework in M21).
  Settings UI gains the editable fields. STOP: suites green.
- **W3 — Administration UI.** Status controls on student/teacher detail
  pages (suspend/reactivate/archive with reason + confirm dialog),
  status badges in directories, admin reset-link button surfacing,
  suspended-user UX (login error already exists — verify copy). Browser
  verification incl. suspended-login attempt. STOP: UI verified.
- **W4 — Hardening/runbook/close-out.** Security re-audit (especially:
  no privilege escalation via status flips, ARCHIVED irreversibility per
  O-3, guardian/teacher unaffected-scope checks), OPERATIONS §30
  offboarding runbook, history/debt close-out, full regression.

## 18. M21 non-goals

No new roles/permissions; no user deletion (ARCHIVED is terminal
retention, FKs already SetNull/Restrict-safe); no multi-college work; no
i18n framework; no leave workflow; no observability beyond what W2
strictly needs (none expected); no PDF/StoredFile/webhooks/polling/
maker-checker/off-host/PITR/SaaS/distributed limiter/GPA policy; no
dependency upgrades; no notification-preference platform.

## 19. Open decisions (O-register — need approval before W1)

- **O-1 Status-change API shape**: single PATCH with target status vs
  verb endpoints (`/suspend`, `/reactivate`, `/archive`). RECOMMEND verb
  endpoints (explicit transitions, per-transition rules/audit). Blocks W1.
- **O-2 Status metadata**: store reason/actor/timestamp. RECOMMEND
  migration #15 additive columns `statusReason?`, `statusChangedAt?`,
  `statusChangedById?` on User (auditable on the row, not only in
  AuditLog). Alternative: AuditLog-only (no migration). Blocks W1.
- **O-3 Transition matrix**: RECOMMEND ACTIVE⇄SUSPENDED both ways;
  ACTIVE|SUSPENDED→ARCHIVED terminal (no un-archive in V1 — mirrors VOID
  discipline); reason required for suspend/archive. Blocks W1.
- **O-4 Self/last-admin protection**: RECOMMEND: cannot change own
  status; cannot suspend/archive the last ACTIVE users.manage holder in
  the college (server-counted). Blocks W1.
- **O-5 `locale` disposition**: retire (remove from seed, document) vs
  keep-reserved. RECOMMEND keep-reserved + documented (no data change).
  Blocks W2 only.
- **O-6 Threshold surfacing**: read-only flags on existing surfaces vs
  new `attendance.low` notification sweep. RECOMMEND read-only V1 (no new
  notification type). Blocks W2.
- **O-7 Student/Teacher profile status coupling**: suspending a User does
  NOT change StudentProfile.status (academic state stays rollover-owned).
  RECOMMEND confirm. Blocks W1.
- **O-8 Guardian visibility**: suspended student's guardian keeps CHILD
  reads (records remain; access is the guardian's, not the student's).
  RECOMMEND confirm. Blocks W2 tests.

## 20. Dependencies / blockers

All internal. Safepay webhooks (I), per-college secrets (C), provider
polling (J), StoredFile/server PDF (available/deferred — unused), off-host/
PITR/monitoring/distributed limiter (H/J), branding/receipts.csv/
attachments (J), GPA policy (F), Prisma upgrade (H), FILE_URL_SECRET (J):
**none blocks M21A; none is implemented by it.** BLOCKING: only O-1…O-4
(+O-5/O-6 for W2).

## 21. Threat model (M21A)

| Threat | Defense | Test | WS |
|---|---|---|---|
| Privilege escalation via status flip (self-reactivate, peer-admin wars) | O-4 self/last-admin rules; users.manage only | matrix | W1 |
| Suspended user keeps working (stale tokens) | guard + policy re-read status per request; family revocation on suspend | live-token dies immediately | W1 |
| Cross-college status change | tenant-gated lookup, 404 | rival 404 | W1 |
| Client-controlled status/reason/actor | verb endpoints; server-derived actor; Zod reason | hostile body | W1 |
| ARCHIVED resurrection | no transition exists | 409 test | W1 |
| Audit spoof/missing | in-tx audit exactly-once | race/failure tests | W1 |
| Demo-account lockout in sandbox | tests never suspend demo users; fixtures only | fixture discipline | W1–W4 |
| Threshold config abuse (absurd values) | Zod bounds (e.g. 0–100) | validation test | W2 |
| Data leak via status metadata | reason visible to users.manage only | projection test | W2 |

## 22. Testing strategy

Real-Postgres e2e throughout (project standard): W1 lifecycle matrix
(~12–15 tests incl. instant-lockout via live token, CAS races, last-admin
guard); W2 settings validation + threshold surfacing + O-8 guardian
checks; W3 browser verification via the preview with fixture users
(created/removed in-run, demo accounts untouched); W4 full-surface
re-audit + regression. No weakening of the 602 existing tests.

## 23. Operational strategy

OPERATIONS §30: offboarding runbook (suspend vs archive semantics, what
survives — records, documents, GuardianLinks; what dies — sessions,
logins, Google/link flows), reactivation, last-admin recovery (seed/SQL
break-glass documented, never casual), threshold tuning guidance, never-do
list (no SQL status edits, no user row deletion). No compose/backup/health
changes expected.

## 24. Migration strategy

Zero-to-one additive migration: #15 only if O-2 approves row-level status
metadata (nullable columns, no backfill needed, forward-only). No enum
changes (UserStatus already complete). No data migration. Existing
migrations untouched.

## 25. Acceptance criteria (M21)

Admin can suspend/reactivate/archive any same-college user except
self/last-admin; effect is immediate (existing access token rejected on
next request, refresh family revoked); ARCHIVED is terminal; every
transition audited exactly-once with reason; directories/detail pages show
status with controls; attendanceWarningThreshold is validated, editable in
the UI and visibly consumed; locale disposition executed per O-5; zero new
permissions; zero role conditionals; migrations ≤15; full suite green;
demo accounts unaffected; runbook + history closed with evidence.

## 26. M22+ recommendations

M22: Observability V1 completion (candidate B) or Reporting (C) —
whichever the operator values more; leave workflow (D) after O-decisions;
dependency-upgrade maintenance window (G) scheduled independently;
multi-college (F) only after per-college secret design; server PDF (E)
when institutions demand true PDFs.

## 27. Final W0 conclusion

Discovery complete, read-only, baseline re-verified green afterwards.
M21A is recommended, bounded, internally unblocked, and awaits O-1…O-8
decisions plus explicit W1 authorization. M21-W1 was NOT started.
