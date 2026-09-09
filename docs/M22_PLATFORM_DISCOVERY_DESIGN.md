# M22 Platform Discovery & Design

Status: W0 DISCOVERY/DESIGN ONLY. No M22 implementation exists.

Baseline: HEAD `41fc42b` (M21 CLOSED), local = remote, clean tree,
620/620 tests (48 suites), typecheck 0, Prisma valid, 15 migrations up to
date, API/web production builds green, API/web/postgres healthy, backup
sidecar running, API health OK, preview HTTP 200.

## 1. Executive summary

CampusOS is feature-complete across its original institutional core: secure
identity and guardianship, academic operations through immutable records,
payments/refunds through immutable finance documents, account offboarding,
audited administration, signed files, mail, notifications, and a working
Alloy backup/restore environment. No critical exploitable security defect was
found in M22-W0.

The strongest remaining problem is **production runtime reliability and
incident visibility**. Current source proves four related gaps:

1. `GET /health` always returns HTTP 200 and top-level `status: ok`, even when
   PostgreSQL is down (`health.controller.ts:16-30`); Compose checks only the
   HTTP status (`docker-compose.prod.yaml:45-54`). A database-dead API can be
   reported healthy.
2. Automated PostgreSQL backup exists only in
   `docker-compose.alloy.yaml:20-43`; production Compose has no backup service,
   backup volume, or `BACKUP_DIR`. `/health/ops` treats unconfigured backups as
   healthy (`health.controller.ts:90-97`). Uploaded files are not included in
   the DB dump.
3. There are no request IDs, request-completion logs, structured JSON logs,
   error counters, rate-limit counters, or external collectors. The global
   filter logs unknown exceptions but does not log known `HttpException` 5xx
   responses (`global-exception.filter.ts:51-82`).
4. Supported Google/SMTP/Safepay environment variables are absent from the
   checked-in production Compose and only partly represented by
   `.env.production.example` (`config/env.ts:22-48`,
   `docker-compose.prod.yaml:27-55`). Production deployment parity is
   incomplete.

RECOMMENDED M22: **Production Runtime Reliability & Incident Visibility**.
This outranks reporting because it corrects false health, establishes safe
correlation and error visibility, and makes the checked-in production stack
honest before institutional adoption. Institutional reporting is the M23
runner-up.

## 2. Current platform inventory

- **Runtime:** Node >=20, NestJS 10 API, Prisma 5.22/PostgreSQL, Next.js 14
  web, shared TypeScript/Zod package.
- **Authorization:** PolicyService scopes ALL/ASSIGNED/DEPARTMENT/OWN/CHILD;
  permission decorators are hints plus server enforcement; no authorization
  role-name branches in current milestone code.
- **Tenancy:** collegeId is derived from authenticated users and applied at
  aggregate roots; foreign resources follow 404/no-existence-leak patterns.
- **Identity:** password + Google OIDC, refresh-token families, credential
  links, verification claims, GuardianLink, ACTIVE/SUSPENDED/ARCHIVED account
  lifecycle with immediate status enforcement and refresh revocation.
- **Academics:** years/terms, lifecycle and rollover, departments/courses/
  sections, timetable, attendance, assignments/submissions, exams/marks,
  immutable versioned term/course results and transcript/report printing.
- **Finance:** fee structures/invoices, immutable Payment/Refund ledgers,
  Safepay initiation/verification/reconciliation, accountant role, immutable
  numbered receipt/refund snapshots, void lifecycle, browser printing.
- **Communication:** in-app inbox/read state, scheduled reminders, SMTP
  transactional mail through the escaped HTML layout boundary.
- **Files:** path-safe local adapter, HMAC signed URLs, StoredFile tenant/
  ownership metadata, stricter evidence authorization.
- **Community:** posts/groups/societies/events/resources, RSVP, moderation and
  reports.
- **Operations:** public health, protected `/health/ops`, Alloy backup sidecar,
  custom-format atomic dumps, 14-day retention, disposable restore drill.
- **Quality:** real-Postgres e2e-first architecture, 620 tests/48 suites, 15
  forward-only migrations.
- **UI:** permission-driven routes for all major institutional workflows;
  `/health/ops` remains API-only by design.

## 3. M0-M21 status

M0 through M21 are CLOSED. M21 final commit is `41fc42b`; current history has
no commit or worktree change after it. M22 implementation was not present at
W0 start. Milestone chains and runbooks through OPERATIONS section 30 are
source-consistent.

## 4. Product/capability status

Complete capabilities are listed in section 2. Partial/API-only areas:

- `/health/ops` has no UI, appropriate for an operator-only endpoint.
- Exports are CSV buttons rather than a reporting workspace; dashboards are
  point-in-time cards without date ranges.
- Notification preference is one `emailOptOut` boolean; no type-level
  preferences/digest.
- EXCUSED attendance exists, but no leave request/approval workflow.
- GPA calculations exist only when grade points are configured, but the
  product cannot currently configure `gradePoint`; repeat/rank policy remains
  absent.
- Production deployment cannot configure all implemented integrations from
  its checked-in Compose/example env without manual changes.
- `locale` is deliberately RESERVED/inert after M21, not a claimed feature.

## 5. Debt register reassessment

Classification: A still required, B partially addressed, C no longer
relevant, D externally blocked, E defer, F M22 candidate.

| Item | Class | Current evidence/disposition |
|---|---|---|
| Account lifecycle/offboarding | C | Resolved M21; ARCHIVED replaces ordinary deletion |
| Attendance threshold dead config | C | Resolved M21; server flags + settings UI |
| Observability completion | **F** | No request IDs/JSON logs/error counters/metrics |
| Truthful readiness | **F (new)** | Public health is HTTP 200/ok when DB is down |
| Production backup parity | **F (new)** | Sidecar exists in Alloy only; unconfigured = healthy |
| Upload backup protection | **F (new)** | pg_dump cannot contain filesystem uploads |
| Production integration env parity | **F (new)** | production Compose omits supported Google/SMTP/Safepay vars |
| Safepay webhook registration/replay | D | Dashboard access still external; endpoint remains unverified live |
| Unexpected webhook failure after event claim | A latent | Broad catch can consume event and return 200; remediate before webhook activation; O-7 decides M22 inclusion |
| Per-college integration secrets | E | Required only before second-college onboarding |
| Provider polling | B/E | Manual verify exists; no scheduled abandoned-attempt poll |
| Off-host backup copies | A/H | Required for production DR; destination/credentials deployment-specific |
| PITR | E | First establish production backups and RPO/RTO |
| External monitoring/SaaS | E | Not required for internal V1; collector choice unresolved |
| Distributed limiter | E | Required only for horizontal scaling |
| Reporting/analytics | A / runner-up | Existing summaries/exports ready; no report workspace |
| Fees export termId defect | A (new) | Filter targets nonexistent Invoice.termId; should be structure.termId |
| Global search | E | Per-list search exists; cross-domain search not production-critical |
| Notification preferences/digest | B/E | emailOptOut exists; no type preferences/digest |
| Leave workflow | E/product decision | EXCUSED status exists; no request/approval model |
| Account deletion | C | Intentionally replaced by terminal archival; legal erasure would be separate policy |
| Server PDF / StoredFile FINANCE_DOCUMENT | E/C | Browser print meets current need; StoredFile purpose irrelevant without binaries |
| receipts.csv / mail attachments / branding | E | M20 non-goals remain valid |
| Multi-college | E | Data is tenant-shaped; global integration credentials block deployment |
| GPA/repeat/rank | B/product decision | GPA engine partial; institutional policy and configuration missing |
| Maker-checker | E/product decision | Refund lifecycle deliberately single-actor |
| Prisma/Nest/Next upgrades | E | Separate maintenance window |
| FILE_URL_SECRET dual-key rotation | C/E | 5-minute TTL keeps impact low |

Historical status is preserved: M19 backup automation was correctly complete
for Alloy/local operation, but W0 now narrows that claim by documenting the
production Compose parity gap rather than rewriting history.

## 6. Deferred-item verification

All prompted deferred items remain as classified in section 5. None became
implemented during discovery. The only priority changes are source-evidenced:
production backup parity, readiness truth, integration env parity, and the
fees export filter defect were not explicitly registered before W0.

## 7. Security rediscovery

No critical exploitable defect found. Reviewed findings:

- Lifecycle endpoints require users.manage, tenant-gate targets, serialize
  last-admin checks, use CAS, and derive actor/college server-side.
- File upload/signing rejects traversal and applies ownership; grandfathered
  pre-M19 keys remain a documented capability-URL residual risk.
- Finance documents have no delete/update path beyond tenant-gated CAS void.
- Mail has one HTML-escaped layout; only HTTP(S) values become anchors.
- No `$queryRawUnsafe`, `$executeRawUnsafe`, production shell execution,
  eval/new Function, or `dangerouslySetInnerHTML` was found. Tagged raw SQL
  calls are parameterized lock/health operations.
- Production secrets fail closed; no live credentials are tracked. The
  concern is missing deployment plumbing, not committed disclosure.
- `/health/ops` remains settings.manage-gated and excludes DSNs, paths,
  filenames and per-user data.
- **Serious reliability finding:** webhook success processing claims a
  GatewayEvent before settlement and broadly catches settlement errors,
  returning 200. Unexpected DB/programming failure can become a consumed,
  non-retriable event. This is latent while registration is externally
  blocked; it must be decided before activation (O-7), not silently patched
  in W0.

## 8. Candidate analysis

### A. Production Runtime Reliability & Incident Visibility (recommended)

Value: truthful readiness, diagnostic correlation, production backup parity,
deployment-integrations parity. High security/production impact; entirely
internal except off-host destination. No business-data migration expected.
Complexity medium, operational testing high, four clean workstreams. Reuses
GlobalExceptionFilter, health, backup scripts and Compose.

### B. Institutional reporting & analytics

High institutional value and strong data readiness: attendance/enrollment,
cash-date finance, finalized-results reports. No mandatory migration. Medium
product-definition/security/performance risk. Requires date/accounting/result
semantics decisions. Also includes fixing the fees-export termId defect.

### C. Notification preferences/digest

Useful engagement feature; requires preference model/migration, scheduling,
timezone and digest semantics. Lower production-readiness leverage.

### D. Leave workflow

Meaningful student capability but requires approval roles, attachment,
absence-date, overlap and attendance integration policy. Product-blocked.

### E. Global search

User convenience; requires cross-domain result authorization, ranking and
query fan-out. Existing per-list search reduces urgency.

### F. Server PDF/document platform

Explicitly deferred after M20; heavy renderer/storage/security/operations
cost with browser print already working.

### G. Multi-college enablement

High future leverage but premature: per-college Safepay/Google/SMTP secret
model and deployment strategy unresolved; external webhook still blocked.

### H. GPA/configuration completion

Operationally useful but institution-policy dependent. Grade-point field is
not configurable through current shared schema; repeat/rank remain decisions.

### I. Dependency maintenance

Necessary but belongs in a dedicated maintenance window, not a product
milestone.

## 9. Ranking

1. **Production Runtime Reliability & Incident Visibility**
2. Institutional reporting & analytics
3. GPA/configuration completion
4. Notification preferences/digest
5. Leave workflow
6. Multi-college enablement
7. Global search
8. Server PDF platform
9. Dependency upgrades (maintenance track)

Candidate A wins on security and production-readiness impact, architectural
leverage, internal testability, boundedness and reuse. Reporting has higher
direct user value but should wait until failures can be correlated and the
production deployment/backup contract is honest. GPA/leave/multi-college are
decision- or infrastructure-blocked.

## 10. Recommended M22

**M22 — Production Runtime Reliability & Incident Visibility**

Problem: the application is functionally mature, but its checked-in
production runtime can report false health, lacks automated backup parity and
cannot correlate failures. Operators cannot reliably answer which request
failed, why, whether backups are available, or whether all supported
integrations were configured.

Goals: validated request IDs, safe structured operational events, bounded
instance-local counters, truthful readiness, explicit migration-probe state,
production backup/integration parity, container health/log retention, and an
incident runbook. Non-goals: SaaS/APM, durable metrics database, distributed
tracing, off-host-provider implementation without an approved target, PITR,
business reporting, webhook activation.

## 11. Proposed W1-W4 structure

### W1 — Correlation and operational logging foundation

Scope: request-ID middleware/interceptor (validated inbound or generated
UUID, response header), AsyncLocalStorage context, allowlist-only one-line JSON
operational logger, request-completion event, safe 5xx instrumentation.
Expected files: common logging/middleware, main/test-app wiring, filter, shared
types only if needed. Migration: none. Authorization: none added. Tests:
request-ID propagation/isolation, malformed IDs, redaction, fixed schema,
known/unknown 5xx. STOP: existing envelopes unchanged, no body/header/token
logging, suite green.

### W2 — Truthful health and bounded internal counters

Scope: instance-local bounded request/error/rate-limit counters; protected
ops fields; explicit migration probe status; readiness HTTP 503 when critical
dependencies fail (or separate live/ready routes per O-2); Docker healthcheck
uses readiness. Optional latent webhook error handling only if O-7 approves.
Migration: none unless webhook event-state design proves unavoidable — STOP
before any schema expansion. Tests: DB-down readiness, ops 401/403, counter
classification/reset semantics, no sensitive labels, webhook injected failure
if included. STOP: truthful health, no fleet-wide claim.

### W3 — Production deployment and backup parity

Scope: adapt existing backup sidecar/scripts into production Compose; explicit
backup mode so unconfigured production degrades; backup-sidecar/web health;
bounded Docker log rotation; pass supported Google/SMTP/Safepay variables
through without committing values; uploads backup procedure/automation per
O-4; update production env example. External off-host copy only if O-5 supplies
a target; otherwise document as deployment requirement, not fake completion.
Tests: Compose config validation, custom dump/restore in scratch DB, uploads
archive round-trip, health freshness. STOP: production stack demonstrably
restorable, no secrets/artifacts tracked.

### W4 — Hardening, incident runbook, close-out

Scope: full log-redaction/cardinality audit, correlation/browser/container
verification, failure drills (DB down, stale backup, bad migration probe),
OPERATIONS section 31, debt/history close-out. No feature expansion.

Each implementation workstream: one commit, push, report, STOP.

## 12. Explicit non-scope

Reporting/analytics, GPA/repeat/rank, global search, leave, notification
preferences/digest, account deletion, server PDF, StoredFile finance purpose,
receipts.csv, mail attachments, branding, webhook registration/replay,
provider polling, maker-checker, multi-college, PITR, distributed limiter,
i18n, dependency upgrades. External monitoring/SaaS exporters are deferred;
M22 builds safe internal seams only.

## 13. Open decisions

- **O-1 Request ID trust:** accept bounded `[A-Za-z0-9._-]` inbound IDs vs
  always replace. Recommend accept <=128 chars after validation; otherwise
  UUID. Blocks W1.
- **O-2 Health routes:** change `/health` to readiness 503 vs add `/health/live`
  + `/health/ready`. Recommend separate live/ready, preserve `/health` as
  readiness alias for Compose compatibility. Blocks W2.
- **O-3 Operational log schema/volume:** completion logs for every request vs
  errors only. Recommend every non-health request, health success sampled/
  suppressed, fixed allowlist fields. Blocks W1.
- **O-4 Upload protection:** periodic tar snapshot of local uploads volume vs
  defer until object storage. Recommend paired local tar with DB backup and
  restore drill; consistency limitation documented. Blocks W3.
- **O-5 Off-host destination:** none approved. Alternatives S3-compatible,
  host-mounted external agent, operator-supplied command. Recommend M22
  defines an interface/runbook but does not claim off-host completion without
  deployment credentials. Non-blocking W1/W2; blocks any off-host W3 claim.
- **O-6 Production backup required mode:** unconfigured always degraded vs
  explicit `BACKUP_MODE=external`. Recommend explicit mode; production default
  local sidecar, external mode requires freshness marker contract. Blocks W3.
- **O-7 Webhook event-loss defect:** include narrow unexpected-error/retry
  remediation in W2 vs defer until provider dashboard activation. Recommend
  include only if it needs no migration; if processing state is required,
  defer to an explicitly authorized integration milestone. Blocks that item,
  not M22 W1.
- **O-8 Counter scope:** process-local only vs durable DB. Recommend
  process-local, reset-on-restart clearly labeled; durable/fleet metrics
  deferred. Blocks W2.
- **O-9 Client error envelope:** add requestId in body vs response header only.
  Recommend header only to preserve contracts. Blocks W1.
- **O-10 Log identity fields:** user/college IDs vs anonymous correlation only.
  Recommend IDs only after authentication, never email/name/IP/body; no metric
  labels with high cardinality. Blocks W1.

## 14. Dependencies and blockers

Internal foundations (Nest middleware/filter, AsyncLocalStorage, health,
backup scripts, Compose) are available. No package is strictly required.
External blocker: off-host target/credentials (O-5). Safepay webhook activation
remains externally blocked and is not required. O-1/O-3/O-9/O-10 block W1;
O-2/O-7/O-8 block parts of W2; O-4/O-6 block W3.

## 15. Migration strategy

Recommended M22 requires **no database migration**. Operational events and
counters must not be stored in AuditLog or a new DB table. Existing migration
history remains untouched. If webhook retry state or durable counters appear
necessary, STOP and obtain explicit schema authorization.

## 16. Testing strategy

- Unit: request-ID validator, redactor/serializer, bounded counter registry.
- Filter/interceptor tests: one safe log per request/error, preserved client
  envelopes, known HttpException 5xx visibility.
- E2E: generated/propagated request IDs, concurrent context isolation,
  sensitive sentinel redaction, ops authorization/counters.
- Container integration: stop PostgreSQL and prove readiness/Compose unhealthy;
  stale/missing backup behavior; sidecar health; log-rotation config.
- Real backup: DB custom dump + scratch restore, uploads archive + disposable
  extraction, live DB/checksum unchanged.
- Full 620-test regression and production builds each workstream.

## 17. Operational strategy

Logs remain stdout/stderr with bounded Docker rotation, not AuditLog. Request
IDs connect request completion and exception events. Counters are explicitly
instance-local/reset-on-restart. Readiness drives orchestration; liveness only
proves process existence. Production backup modes become explicit and tested.
Runbook defines log field meanings, redaction guarantees, alert thresholds,
correlation workflow, stale-backup/DB-down drills, and audit-vs-operational
separation.

## 18. Security/privacy model

Assets: credentials, tokens, payment/provider references, PII, tenant IDs,
operational availability and backups. Trust boundaries: client/proxy/API,
API/Postgres, API/filesystem, backup volume/operator, external integrations.
Attacker-controlled inputs: request ID, route/query/body/headers, webhook
payloads. Defenses to design: allowlist logging; validated bounded request ID;
route templates not raw URLs; never bodies/cookies/auth/signatures/checkout
URLs; bounded labels/maps; settings.manage on ops; no per-user ops output;
status/error-class aggregates only; no audit spoofing. Retention: operational
logs rotated and shorter-lived than durable AuditLog; backup retention remains
explicit.

## 19. Operational risks

Primary risks: log volume/disk exhaustion, high-cardinality attacker labels,
PII/token leakage through stack/error serialization, healthcheck rollout
causing restart loops, backup CPU/disk pressure, inconsistent DB/upload
snapshot pairs, and process-local counters misrepresented as fleet metrics.
Mitigate through fixed schemas, suppression, rotation, staged readiness,
resource-aware scheduling and explicit V1 limitations.

## 20. Newly discovered debt

1. Production Compose backup/integration parity gap.
2. Public false-positive readiness when DB is down.
3. Production web and backup sidecar health/log-rotation gaps.
4. Fees CSV `termId` filter appears to target nonexistent Invoice.termId.
5. Latent webhook event-loss on unexpected post-claim settlement failure.
6. GPA engine exists but gradePoint is not operationally configurable.

Items 4-6 are documented for later authorization and are not silently added
to M22 unless an open decision explicitly approves them.

## 21. M22+ roadmap

M23: Institutional Reporting & Analytics (attendance/enrollment first,
cash-date finance and finalized results second; fix fees term filter at its
foundation). M24 candidates: GPA configuration after policy decisions,
notification preferences, leave workflow. Multi-college after per-college
integration secret design; PDF only on demonstrated institutional demand;
dependency upgrades in a maintenance window.

## 22. W0 conclusion and STOP

Discovery is complete. No critical exploit blocked planning. M22-W1 is NOT
started. Await O-1 through O-10 decisions and explicit W1 authorization.
