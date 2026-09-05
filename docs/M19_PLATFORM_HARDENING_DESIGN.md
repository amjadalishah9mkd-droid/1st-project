# M19 Platform Hardening & Debt Retirement — Design (W0)

Labels: **VERIFIED** (source at `3ca22e1`), **UNVERIFIED**, **DECISION**,
**PROPOSAL**, **DEFERRED**, **BLOCKED**, **OPEN**.

## 1. Purpose

Retire the accumulated security and operational debt that every product
milestone since M10 has deliberately parked, before it compounds:
file-signing IDOR (P2-IDOR-1), mail HTML injection surface, the Google
callback limiter gap, guardian PII duplication, backup automation, and
baseline observability — all repository-internal, all testable with the
existing real-Postgres harness.

## 2. Current state (VERIFIED baseline)

HEAD `3ca22e1`; M0–M18 complete; 543/543 tests (40 suites); 12
migrations up to date; typecheck 0; both prod builds green; stack
healthy. Full current-state inventory in §4.

## 3. Problem statement

CampusOS is feature-complete for daily campus operation (finance +
academics + records) but carries known, documented weaknesses that a
production deployment would inherit: any authenticated user can mint a
signed URL for any internal file path (mitigated only by unguessable
keys); operator-influenced strings are interpolated into HTML mail
unescaped; one OAuth endpoint lacks the rate limiter its sibling has;
student profiles duplicate guardian PII outside the audited
GuardianLink system; backups exist only as documentation; and the
platform is blind in production (no error aggregation, minimal health
depth).

## 4. Repository findings (current-state inventory, VERIFIED)

- **Finance**: payments/attempts/refunds/reconciliation/exports mature
  (M14/M16); Safepay adapter live-verified incl. refunds; webhooks
  authenticated+idempotent but dormant (registration EXTERNALLY
  BLOCKED); receipts/PDF absent (browser-print pattern only);
  accountant role live with /fees landing.
- **Academic**: term lifecycle enforced at 21 sites (M17); finalization/
  amendment/VOID/report-cards/transcripts live (M18); GPA null pending
  the institutional scale (O-4 of M18); repeat-course policy deferred.
- **Administration**: students (CSV import), guardians via GuardianLink
  (CHILD scope incl. refunds/records reads), enrollments/sections/
  teaching/attendance/timetable/rollover all mature.
- **Platform**: argon2id auth + rotating refresh + reuse detection;
  PolicyService matrix (zero role conditionals); collegeId tenancy
  everywhere; append-only audit; event-driven notifications; in-memory
  per-instance rate limiting; `/health` = liveness + DB ping only;
  **no monitoring/error tracking; backups docs-only (zero automation
  in compose/scripts — grep-verified)**.
- **Exports/reporting**: single CSV framework (5 exports), printable
  report cards/transcripts (browser-print), dashboards net-accurate
  since M17.

## 5. Debt-register audit (every item, classifications A–J)

| Item | Verified reality | Class |
|---|---|---|
| P2-IDOR-1 file-sign ownership | `POST /files/sign` signs ANY internal URL for ANY authenticated user (files.controller; only evidence keys get authz) | E, **I** |
| Mail HTML escaping | 41 template interpolations, zero escaping helper in `mail/templates.ts` | E, **I** |
| Google callback limiter | `googleStart` limited (:61); callback relies on single-use state only | E, **I** |
| DEPARTMENT "dead" scope | **STALE REGISTER ENTRY — the scope IS implemented** (announcements audience validation + label resolution, module-parts:48/101/208) | **C** (obsolete; register must be corrected, nothing to build) |
| Legacy guardian PII columns | **STALE AS DESCRIBED — columns are actively USED** (students.service:193/241/317 read+write guardianName/Phone/Email) — the real debt is a PII channel parallel to GuardianLink, unaudited and duplicated | E+H, **I** (needs O-2) |
| Backup automation | zero automation; OPERATIONS §6 scripts only | F, **I** |
| Monitoring/error tracking | absent | F, **I** (bounded internal scope) |
| Per-instance rate limits | by design until horizontal scale | J |
| Prisma `^5.19.1` range | maintenance window item | J |
| Safepay webhook registration + replay | dashboard-only, no credentials | **D/BLOCKED** |
| Single global webhook secret | bites at 2nd college only | J |
| Provider polling | verify-is-truth suffices | J |
| Receipts/PDF platform | absent; browser-print covers documents | G, J (strong **M20** candidate) |
| Advanced refund/academic reporting | absent | G, J |
| Maker-checker | product decision, deliberately excluded | H, J |
| GPA scale (O-4) / repeat-course (O-11) | institutional policy | H, J |
| Rank/standing | policy | H, J |
| FILE_URL_SECRET dual-key rotation | 300s TTL keeps impact low | J |

## 6. Candidate ranking

| Candidate | Security | Data integrity | Ops risk | User value | Readiness | External dep | Size | Priority |
|---|---|---|---|---|---|---|---|---|
| **E+D: Platform hardening & debt retirement** | HIGH | MED | HIGH | MED (invisible but foundational) | HIGH (all internal) | NONE | bounded (4 WS) | **1 — RECOMMENDED** |
| B: Receipts/finance documents | LOW | MED | LOW | HIGH | HIGH (print pattern) | none | bounded | 2 (M20) |
| A: Academic reporting expansion | LOW | MED | LOW | HIGH | **BLOCKED on O-4/O-11 policy** | institutional | unbounded until policy lands | park |
| C: Webhook infrastructure | MED | MED | MED | LOW | **BLOCKED externally** | provider dashboard | n/a | park |
| F: other product gaps | — | — | — | — | none evidenced | — | — | none identified |

**Recommendation: M19 = Platform Security Hardening & Debt Retirement.**
Rationale: it is the only candidate that is simultaneously
high-security-impact, fully repo-internal, real-Postgres-testable,
bounded, and a prerequisite for credible production deployment; A is
policy-blocked, C is externally blocked, B loses nothing by waiting one
milestone and benefits from the hardened file layer (receipts are
files). External approval required: none for the work itself; O-2/O-3
below are the only policy touchpoints.

## 7. Deep audit of the recommended scope (VERIFIED)

1. **Files (P2-IDOR-1)**: `files.module` = controller (`POST /sign`,
   `GET /files/:key`), `url-signer.service` (HMAC, 300s TTL),
   `storage.adapter`, `evidence-authz.service` (evidence keys fully
   authorized since M11-W3). Upload paths (community attachments,
   assignment submissions, evidence) store internal URLs on their
   domain rows — **no central record of who owns a stored key**;
   signing therefore cannot authorize non-evidence keys. Partial
   implementation to reuse: the evidence-authz pattern (sign-time
   authorization by key class).
2. **Mail**: `mail/templates.ts` builds HTML via template literals; 41
   interpolations; inputs are mostly admin/staff-entered (titles,
   names) — injection requires an insider but lands in parent/student
   inboxes; single `layout()` chokepoint exists for a fix.
3. **Google callback**: `google-auth.controller` start limited,
   callback not; single-use state consumption bounds replay but not
   brute-force/URL-spam cost.
4. **Guardian PII duplication**: `StudentProfile.guardianName/Phone/
   Email` read+written by students.service and exposed on student
   detail; GuardianLink (M13) is the authorized, audited channel; the
   columns bypass guardian consent/revocation semantics.
5. **Backups**: prod compose has no backup service; OPERATIONS §6
   documents manual `pg_dump` cron.
6. **Observability**: GlobalExceptionFilter logs to stdout; `/health`
   returns db up/down; no error aggregation, no request metrics, no
   restore-verification signal.

Dangerous assumptions to avoid: none of these fixes may weaken existing
M11 evidence authorization, M13 guardian consent semantics, or the M10
signed-URL TTL model. Backwards-compatibility risk: existing stored
internal URLs must keep working (ownership backfill strategy in §9).

## 8. Security threat model

| Threat | Current defense | Required defense | Test |
|---|---|---|---|
| Authenticated user signs another tenant's/user's file (IDOR) | unguessable keys only | ownership record + sign-time authz for ALL key classes | cross-college/cross-user sign 404/403 |
| HTML injection via announcement/assignment/mail-visible strings | none | escape at the `layout()`/template chokepoint | payload round-trip test asserts entities |
| Google callback brute-force/state spam | single-use state | limiter on callback (mirror of start) | 429 after threshold; legit flow unaffected |
| Guardian PII exfiltration via student detail | staff-only read | per O-2 disposition (migrate/retain-as-emergency-contact with explicit labeling) | projection tests |
| Backup absence → unrecoverable loss | docs only | automated dump sidecar + verification | restore-drill script test (real pg) |
| Silent production errors | stdout only | structured error log + error counter surfaced via health/ops endpoint | filter unit/e2e |
| Cross-college anything (regression) | existing tenancy | unchanged | full regression |
| Audit tampering / client-controlled fields | existing discipline | unchanged; new surfaces follow it | matrix tests |
| Replay/duplicate ops | existing CAS patterns | reuse where new writes appear (file ownership insert-first) | race tests |
| Rate abuse of new endpoints | existing limiter | apply to new/changed endpoints | 429 tests |

## 9. Data model analysis (PROPOSAL — nothing created in W0)

One probable new model, migration **#13** (NOT created now):

`StoredFile` — ownership record for signed-URL authorization:
id; collegeId; key (unique); purpose (enum: COMMUNITY_ATTACHMENT |
SUBMISSION | EVIDENCE | OTHER); ownerUserId?; createdById; createdAt.
Indexes: (collegeId), key unique. Restrict FKs. **Backfill question**:
existing keys have no rows — options: (a) lazy-grandfather (unknown
keys stay capability-URL-only, new uploads recorded, sign-time authz
enforced only when a record exists), (b) backfill from domain rows
(attachments/submissions/evidence JSON), (c) hard cutover. PROPOSAL:
(b) where derivable + (a) fallback — zero breakage. Guardian-PII
disposition may add a second migration action depending on O-2
(column drop vs rename-to-emergencyContact) — flagged, not decided.
No other schema needs identified; backups/observability/mail/limiter
are code/infra only.

## 10. Authorization design

**No new permissions needed** (explicitly): file signing stays
authenticated-user + ownership/purpose authorization inside the
existing evidence-authz pattern (object-level, not permission-level);
backup/observability surfaces are ops-side (compose/service), not
HTTP-permissioned, except a possible `GET /health/ops` detail view —
PROPOSAL: gate with existing `settings.manage` if added. PolicyService
untouched; zero role conditionals; matrix unchanged.

## 11. Tenancy design

StoredFile carries collegeId; sign-time lookup
`findFirst({key, collegeId: user.collegeId})` + purpose-specific owner
checks (mirror evidence-authz); foreign/unknown keys behave per the
grandfathering rule with no existence leak. All other M19 surfaces are
non-tenant infra. No client-controlled collegeId anywhere.

## 12. Concurrency & transactions

File ownership rows: insert-first at upload inside the existing upload
flows (unique key = idempotency backstop). Backup job: single sidecar,
no app concurrency. No CAS/state machines needed — this milestone is
deliberately low-concurrency. Lock ordering untouched.

## 13. Product decisions (OPEN — need approval)

- **O-1 File-authorization model**: recommend record-on-upload +
  sign-time authz with derivable backfill and grandfathered unknown
  keys (options/consequences in §9). Blocking W1.
- **O-2 Guardian PII columns**: options (i) migrate values into notes/
  drop columns (strict consent model), (ii) rename/relabel as
  "emergency contact" fields (kept, clearly not guardian-access
  channel), (iii) leave as-is (rejected — perpetuates debt). RECOMMEND
  (ii): least data loss, honest semantics. Privacy-sensitive — needs
  your call. Blocking W2.
- **O-3 Backup destination/retention**: local volume vs external
  target; retention days. RECOMMEND: compose sidecar `pg_dump` to a
  named volume, 14-day rotation, restore-verification script —
  destination beyond the volume is deployment-specific and stays
  documented. Blocking W3.
- **O-4 Observability scope**: RECOMMEND internal-only V1 (structured
  error log, error counters, deep health incl. last-backup age); any
  external SaaS (Sentry etc.) is DEFERRED — needs infra/budget call.

## 14–17. API / UI / exports / notifications impact

Minimal by design: no new user-facing UI (a Settings note about
emergency-contact relabel if O-2(ii)); no export changes; no
notification changes; mail change is escaping-only (rendered output
identical for benign input — snapshot-style tests).

## 18–22. (covered in §§8–12 + below)

**Migration plan**: #13 additive (`StoredFile` + backfill script) only
after O-1; possible O-2 column migration folded in. **Testing**:
real-Postgres e2e for sign-authz matrix (owner/rival/cross-college/
grandfathered), mail-escaping round-trips, callback 429, guardian-PII
projection per O-2, backup script smoke (dump+restore into a scratch
schema), health depth; full 543-suite regression; no test weakening.
**Operational concerns**: backup sidecar resource footprint; restore
drill documented in OPERATIONS. **External dependencies: NONE** (the
defining property of this milestone).

## 23. Risks

1. O-2 privacy decision stalls W2 — mitigated by ordering (W1 files
   first). 2. Backfill misses exotic stored URLs — grandfathering
   guarantees no breakage. 3. Escaping regressions in mail rendering —
   chokepoint + tests. 4. Scope creep toward external monitoring —
   O-4 boundary is explicit.

## 24. Workstream plan

- **W1 — File authorization (P2-IDOR-1)**: migration #13, StoredFile,
  upload-path recording, backfill, sign-time authz, adversarial suite.
  STOP: matrix green, regression green.
- **W2 — Input/authz hardening**: mail escaping chokepoint + tests;
  Google callback limiter; guardian-PII disposition per O-2;
  DEPARTMENT register correction (docs). STOP: suites green.
- **W3 — Operational reliability**: backup sidecar + rotation +
  restore-verification script; deep health (db, migrations, last
  backup age, error counter); OPERATIONS updates. STOP: drill proven
  in sandbox.
- **W4 — Hardening/close-out**: security re-audit, runbook (§28),
  history/debt-register rewrite (retired items marked RESOLVED with
  evidence, stale entries corrected), final regression.

Acceptance criteria per workstream embedded above; every WS: one
commit → push → report → STOP.

## 25. Non-goals / deferred (unchanged status)

Receipts/PDF (M20 candidate), webhook registration/replay (BLOCKED),
per-college webhook secrets (2nd-college trigger), provider polling,
maker-checker, GPA scale/repeat-course/rank (policy), advanced
reporting, external monitoring SaaS, shared rate-limit store, Prisma
upgrade.

## 26. STOP conditions

Any of: O-1/O-2 unapproved at their blocking workstream; backfill
reveals underivable ownership at scale; escaping breaks legitimate
rendering unavoidably; backup sidecar impossible in the target
runtime; any fix requiring PolicyService architecture change.
