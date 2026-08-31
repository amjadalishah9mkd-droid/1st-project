# CampusOS — Operations Runbook

Production operations guide for CampusOS (M10-W5). Development/Alloy usage is
covered in the [README](../README.md); nothing in this document changes the
Alloy workflow (`docker-compose.alloy.yaml`).

---

## 1. Architecture at a glance

| Service | Image source | Port | Persistence |
|---|---|---|---|
| `postgres` | `postgres:16-bookworm` | 5432 (internal) | `pgdata` volume |
| `api` | `apps/api/Dockerfile` (NestJS, `/api/v1`) | 4000 (internal) | `uploads` volume at `/data/uploads` |
| `web` | `apps/web/Dockerfile` (Next.js) | `${WEB_PORT:-3000}` (published) | stateless |

Production compose file: **`docker-compose.prod.yaml`** (repo root).
The web container proxies `/api/v1/*` to the API; browsers normally talk to a
single origin.

## 2. Production deployment procedure

1. Provision a host with Docker + Docker Compose and clone the repository at
   the release tag you intend to deploy.
2. Create the environment file from the template:
   ```sh
   cp apps/api/.env.production.example .env.production
   ```
3. Fill in every required value (section 3). Never commit `.env.production`.
4. Build and start:
   ```sh
   docker compose -f docker-compose.prod.yaml --env-file .env.production up -d --build
   ```
   The API container fails fast (with a clear message) if any required secret
   is missing or shorter than 32 characters — this is intentional.
5. Apply database migrations (section 5), then run the system seed once:
   ```sh
   docker compose -f docker-compose.prod.yaml exec api npx prisma migrate deploy
   docker compose -f docker-compose.prod.yaml exec api npm run db:seed
   ```
   The system seed is idempotent (roles, permissions, college bootstrap).
   **It must log `demo seed skipped` or `demo seed REFUSED` — never
   `demo seed complete` — in production.** See section 12.
6. Verify health (section 9) before pointing DNS/load balancer at the host.

## 3. Environment variables & secret generation

Template: `apps/api/.env.production.example`.

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Dedicated strong password for the `campusos` DB user |
| `DATABASE_URL` | yes (api) | Derived from `POSTGRES_PASSWORD` in compose |
| `JWT_ACCESS_SECRET` | yes, ≥32 chars | Signs 15-minute access tokens |
| `JWT_REFRESH_SECRET` | yes, ≥32 chars | Reserved for the refresh subsystem (refresh tokens themselves are hashed opaque values in the DB) |
| `FILE_URL_SECRET` | yes, ≥32 chars | HMAC key for signed, expiring file-download URLs |
| `CORS_ORIGINS` | no | Comma-separated browser origins; leave unset when web+api share one origin behind the proxy. In production, unlisted cross-origin requests are rejected |
| `UPLOAD_DIR` | yes | `/data/uploads` (backed by the `uploads` volume) |
| `WEB_PORT` | no | Published web port, default 3000 |
| `SEED_DEMO` / `ALLOW_DEMO_SEED` | **never in production** | See section 12 |

Generate every secret with a CSPRNG:

```sh
openssl rand -hex 32
```

Startup validation (`apps/api/src/config/env.ts`) refuses to boot production
with missing/short secrets.

## 4. Secret rotation procedure

Rotate one secret at a time; each has a different blast radius:

- **`JWT_ACCESS_SECRET`** — generate a new value, update `.env.production`,
  restart the API. All outstanding access tokens (≤15 min old) become invalid;
  browsers recover automatically via the refresh cookie on the next request.
  User impact: none beyond a silent refresh.
- **`JWT_REFRESH_SECRET`** — same procedure. Refresh tokens at rest are
  hashed opaque values, so rotation does not invalidate sessions by itself.
- **`FILE_URL_SECRET`** — update and restart the API. Every previously issued
  signed download URL becomes invalid immediately (`403 INVALID_SIGNATURE`).
  This is safe: signed URLs are short-lived (default 300 s) and the web app
  requests a fresh signature per download via `POST /api/v1/files/sign`.
  Rotate this secret immediately if it may have leaked — doing so revokes all
  live download links at once.
- **`POSTGRES_PASSWORD`** — `ALTER USER campusos WITH PASSWORD '...'` inside
  postgres, update `.env.production`, then restart the API.

After any rotation: `docker compose -f docker-compose.prod.yaml --env-file
.env.production up -d api` and re-check `/api/v1/health`.

## 5. Database migrations — deployment order

Migrations live in `apps/api/prisma/migrations/` and are additive. Order for
every release:

1. Back up the database first (section 6).
2. Pull/checkout the new release; rebuild images.
3. Apply migrations **before** starting the new API code:
   ```sh
   docker compose -f docker-compose.prod.yaml exec api npx prisma migrate deploy
   docker compose -f docker-compose.prod.yaml exec api npx prisma migrate status  # expect "up to date"
   ```
4. Restart api, then web (section 11).

Never run `prisma migrate dev` or `prisma db push` in production; `deploy`
only replays committed migration files.

## 6. Backups

### Nightly PostgreSQL backup (pg_dump)

Run from cron on the host (daily, e.g. 02:30):

```sh
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
BACKUP_DIR=/var/backups/campusos
mkdir -p "$BACKUP_DIR"
docker compose -f /opt/campusos/docker-compose.prod.yaml exec -T postgres \
  pg_dump -U campusos -d campusos --format=custom \
  > "$BACKUP_DIR/campusos-$STAMP.dump"
# retain 14 days
find "$BACKUP_DIR" -name 'campusos-*.dump' -mtime +14 -delete
```

`--format=custom` enables selective/parallel restore with `pg_restore`.
Store copies off-host (object storage) and test restores quarterly.

### Uploads volume backup

The `uploads` volume holds all user files (assignments, resources, avatars):

```sh
docker run --rm \
  -v campusos_uploads:/data/uploads:ro \
  -v /var/backups/campusos:/backup \
  alpine tar czf "/backup/uploads-$(date +%F).tar.gz" -C /data uploads
```

(Adjust the volume name to `docker volume ls` output; compose prefixes it
with the project name.) Schedule alongside the database dump so the pair is
consistent.

## 7. Restore procedures

### Database restore

```sh
docker compose -f docker-compose.prod.yaml stop api web
docker compose -f docker-compose.prod.yaml exec -T postgres \
  dropdb  -U campusos --if-exists campusos
docker compose -f docker-compose.prod.yaml exec -T postgres \
  createdb -U campusos campusos
docker compose -f docker-compose.prod.yaml exec -T postgres \
  pg_restore -U campusos -d campusos --no-owner < /var/backups/campusos/campusos-YYYY-MM-DD.dump
docker compose -f docker-compose.prod.yaml exec api npx prisma migrate status  # sanity check
docker compose -f docker-compose.prod.yaml start api web
```

### Uploads restore

```sh
docker compose -f docker-compose.prod.yaml stop api
docker run --rm \
  -v campusos_uploads:/data/uploads \
  -v /var/backups/campusos:/backup \
  alpine sh -c "rm -rf /data/uploads/* && tar xzf /backup/uploads-YYYY-MM-DD.tar.gz -C /data"
docker compose -f docker-compose.prod.yaml start api
```

Restore database and uploads from the **same night** so file records and
files on disk match.

## 8. Health checks

- **API**: `GET /api/v1/health` → `{"data":{"status":"ok",...,"database":"up"}}`.
  Anything other than HTTP 200 with `database:"up"` is unhealthy.
- **Web**: `GET /login` on the published port → HTTP 200.
- **Compose-level**: `postgres` uses `pg_isready`; `api` polls its own health
  endpoint; `web` waits for `api` to be healthy. Check with:
  ```sh
  docker compose -f docker-compose.prod.yaml ps
  ```
Point external monitoring at `/api/v1/health` (30 s interval is plenty).

## 9. Docker production compose usage

```sh
# start / apply env changes / rebuild after a release
docker compose -f docker-compose.prod.yaml --env-file .env.production up -d --build

# status, logs
docker compose -f docker-compose.prod.yaml ps
docker compose -f docker-compose.prod.yaml logs -f api

# one-off commands inside the api container
docker compose -f docker-compose.prod.yaml exec api npx prisma migrate status
```

The Alloy/dev stack (`docker-compose.alloy.yaml`) is a separate file with
host networking and watch-mode commands; never use it in production.

## 10. Logs & troubleshooting basics

Expected log shapes:

- `api` on boot: Nest module init lines, then `Nest application successfully
  started`. A production boot with missing secrets exits immediately with
  `Invalid environment configuration: ...` — fix `.env.production`.
- `postgres`: `database system is ready to accept connections`.
- `web`: Next.js `Ready` line.

Common issues:

| Symptom | Likely cause | Fix |
|---|---|---|
| api restart loop, env error in logs | missing/short secret | fill `.env.production`, `up -d api` |
| health returns `database:"down"` | postgres down or wrong `DATABASE_URL` | check `postgres` logs / password |
| 403 `SIGNATURE_REQUIRED` on downloads | client hit `/files/:key` without signing | expected; the web app always signs first |
| 403 `LINK_EXPIRED` | signed URL older than its TTL | re-open the file (new signature) |
| CORS error in browser console | origin not in `CORS_ORIGINS` | add the exact origin, restart api |
| login 429 | login rate limiter engaged | wait; investigate source if unexpected |

API error responses are uniform: `{"error":{"code","message","details?"}}` —
the `code` is the fastest troubleshooting signal.

## 11. Safe restart / update procedure

Routine restart (config change):

```sh
docker compose -f docker-compose.prod.yaml --env-file .env.production up -d api web
```

Release update:

1. Nightly backup exists (or take one now — section 6).
2. `git fetch && git checkout <release-tag>`
3. `docker compose -f docker-compose.prod.yaml --env-file .env.production build`
4. `docker compose -f docker-compose.prod.yaml exec api npx prisma migrate deploy`
5. `docker compose -f docker-compose.prod.yaml --env-file .env.production up -d`
6. Verify `/api/v1/health`, then a real login.

Postgres itself should not be recreated during routine updates; `up -d` only
replaces containers whose configuration changed.

## 12. ⚠️ Demo seed is forbidden in production

The demo seed creates well-known accounts (`admin@campusos.dev`, …) with a
**publicly documented password**. Running it in production is an account
takeover, full stop.

Safeguards in place:

- The seed entrypoint (`apps/api/prisma/seed/index.ts`) **refuses** demo
  seeding when `NODE_ENV=production`, printing
  `!!! DEMO SEED REFUSED — PRODUCTION ENVIRONMENT DETECTED !!!`.
  The system seed (roles/permissions) still completes normally.
- `docker-compose.prod.yaml` and the production env template never set
  `SEED_DEMO`.

**Emergency override** (staging-like environments only, never a real
production tenant): set `ALLOW_DEMO_SEED=true SEED_DEMO=true` explicitly for
a single seed run. The run logs a WARNING. Remove both variables immediately
afterwards and rotate the demo account passwords if the environment is
reachable from the internet.

## 13. Signed file downloads & FILE_URL_SECRET

- Every stored file URL is internal (`/api/v1/files/:key`). Direct GETs
  without parameters return `403 SIGNATURE_REQUIRED`.
- Clients call `POST /api/v1/files/sign` (authenticated) to obtain
  `?exp=<unix>&sig=<hmac>`; the API verifies with a timing-safe comparison.
  Default TTL is 300 seconds; expired links return `403 LINK_EXPIRED`,
  tampered ones `403 INVALID_SIGNATURE`.
- Rotating `FILE_URL_SECRET` instantly invalidates all outstanding signed
  URLs (section 4). This is the kill switch for leaked links. There is no
  dual-key window: rotate during low traffic; in-flight downloads simply
  re-sign on retry.

## 14. Invitation & password-reset tokens

- New students/teachers get **no password**; account creation and CSV import
  return a one-time invite URL (`/accept-invite?token=…`).
- Tokens are 256-bit random values stored **only as SHA-256 hashes**;
  **INVITE expires after 48 h**, admin-issued **RESET after 24 h**.
- Tokens are single-use (atomic claim) and issuing a new token of the same
  purpose revokes the previous one. Acceptance sets the password (argon2id)
  and revokes existing sessions. All issuance/acceptance is audit-logged.
- Expired invite? Any admin can issue a fresh reset link from the student or
  teacher detail page (**Issue reset link**). There is nothing to "unlock"
  server-side; issue a new link and share it securely.
- Invalid/expired/reused tokens always return the same generic
  `400 INVALID_TOKEN` — this is deliberate (no account enumeration).

## 15. Google-auth rollout & student cutover (M11-W7)

Per-college rollout is controlled from **Settings** (admin UI, `settings.manage`)
or `PATCH /api/v1/settings/college`:

| Mode | Behavior |
|---|---|
| `off` | Google endpoints disabled for the college; passwords + password invitations only |
| `additive` | Google login/linking available; student password login still works |
| `required` | **Google-only for student-record owners**: password login returns `403 USE_GOOGLE_LOGIN`; staff accounts (no StudentProfile) are unaffected |

**Cutover procedure:**
1. Configure Google env vars (§3) and switch the college to `additive`.
2. Announce the transition using `googleAuthGraceDays` (default 30) — this
   value is an operational communication window, **not** an enforcement
   timer: nothing changes automatically, and there is no hidden password
   exception during or after it.
3. During the grace window, students connect Google (invitation links,
   account linking, or self-registration if enabled). Linked students
   auto-verify.
4. After the announced window, switch the college to `required`. From that
   moment student password login is refused server-side.
5. Rollback: switch back to `additive` — password login resumes
   immediately; no data changes are involved.

Every settings change is audited (`settings.updated`).

## 16. Rate limiting (M11-W7)

Policies are defined in one place (`apps/api/src/common/rate-limiter.service.ts`)
and return the uniform `429 {"error":{"code":"RATE_LIMITED"}}`:

| Endpoint | Key | Policy |
|---|---|---|
| POST /auth/login (failures) | IP + account | 5 fails/min, exponential backoff (M1) |
| accept-invite / reset-password | IP | 30/min |
| GET /auth/invite-info | IP | 30/min |
| GET /auth/google/start | IP | 60/min |
| POST /verification/evidence | user | 15/hour |
| POST /verification/claims | user | 10/hour |
| POST /files | user | 60/hour |
| POST /files/sign | user | 300/min |

Limits are in-memory per API instance (Blueprint §14 — no Redis): with N
instances the effective ceiling is policy × N. Tune the constants and
redeploy if legitimate traffic ever hits them.

## 17. Evidence retention (M11-W7, policy locked by decision R3)

A daily 03:00 sweep (`EvidenceRetentionService`) purges ID-card evidence:

- APPROVED claims: evidence deleted **30 days after decidedAt**
- CANCELLED claims: evidence deleted at the next sweep
- REJECTED claims: evidence retained (referenced by the decision)
- Orphaned uploads (never attached to a claim): deleted after **7 days**

Purging removes the binary and its metadata row only — claim rows keep
their `evidenceFileKey` string and all audit history. Each purge is audited
as `verification.evidence_purged`. Deletion is idempotent and storage-first,
so interrupted sweeps converge on the next run. **Purged evidence cannot be
restored by rolling back code** — only from the uploads-volume backups (§6);
keep backup retention shorter than or aligned with evidence retention if
your policy demands true deletion.

The same sweep clears expired `OauthStateConsumption` rows (one-time OAuth
state records, stored as SHA-256 hashes; unique-insert makes replay
detection atomic across all API instances). No manual maintenance needed.

## 18. Transactional email (M12-W1)

Optional feature, disabled by default. Configure the all-or-none pair:

```
SMTP_URL=smtp://user:password@smtp.example.edu:587
MAIL_FROM="CampusOS <no-reply@campus.example.edu>"
APP_BASE_URL=https://campus.example.edu   # link base; falls back to OAUTH_REDIRECT_BASE
```

Behavior when configured: student/teacher invitations (incl. CSV import),
admin-issued password resets, and verification decisions are emailed to
the account's registered address. The admin copy-URL dialogs are
unchanged — email is additive delivery of the same one-time links (same
TTL/one-time/hashing semantics).

Operational notes:
- **Mail failure never fails the operation.** Failed deliveries are
  audited as `mail.failed` (template + user only — never addresses,
  tokens, URLs or bodies). Re-issue the link from the UI to retry.
- Unset the SMTP pair to disable mail instantly (no deploy needed beyond
  a restart). Partial configuration refuses to boot.
- SMTP credentials live only in the environment; rotate by updating
  `SMTP_URL` and restarting the API.
- There is no delivery-log table or retry queue by design; the audit log
  is the delivery record.

**Notification email channel (M12-W2).** When mail is configured, four
notification categories are also emailed: results published, invoice
issued, invoice overdue, and announcements. Users control this with a
single "Email notifications" toggle on their notifications page
(`emailOptOut`, audited as `preferences.updated`). The opt-out affects
notification email only — transactional mail (invitations, password
resets, verification decisions) is always delivered. In-app notifications
are written first and are never affected by mail configuration, opt-out,
or delivery failures. All other event categories (community activity,
reminders, attendance) intentionally do not email.

## 19. Report cards & CSV exports (M12-W3)

- **Report cards** are per-exam print views (`/results/report/<examId>`);
  the official copy is produced with the browser's Print / Save-as-PDF —
  there is no server-side PDF generation.
- **CSV exports** (`/api/v1/exports/*.csv`: students, attendance, fees,
  results) are restricted to callers whose resolved permission scope is
  ALL (college admins). Teachers and students are refused server-side.
  Every export is audited (`exports.generated` with export name and row
  count only). Cells beginning with = + - @ are quoted to prevent
  spreadsheet formula injection. Exports are capped at 50,000 rows
  (HTTP 413 `EXPORT_TOO_LARGE` — narrow the filters).

## 20. Audit log viewer (M12-W4)

Admins with `audit.read` (ADMIN/ALL by default) can review the college's
security audit trail at `/audit`: authentication events, verification
decisions, settings/preference changes, mail delivery outcomes, exports
and moderation actions — newest first, filterable by category, date
window, actor and target id, with a per-entry metadata detail view. The
viewer is strictly read-only (the module exposes no mutation routes) and
tenant-scoped; audit rows are never purged.

## 21. Guardian portal runbook (M13)

### Inviting a guardian
Admins (`users.manage`) invite guardians from **Students → student detail
→ Guardians card → Invite guardian** (email + relationship). Server-side
(`POST /students/:id/guardians`, rate-limited **20/hour per admin**):

- **New email** → a GUARDIAN account is created (unusable password,
  `mustChangePassword`) together with the link and a one-time 48-hour
  INVITE token, in a single transaction — a partial guardian cannot
  exist. The `guardian_invite` mail names the child as "FirstName L."
  only.
- **Existing same-college GUARDIAN email** → link-only. Not-yet-onboarded
  guardians get a token reissue; onboarded ones get a token-less
  `guardian_link_added` mail.
- **Existing non-guardian email** → 409 `EMAIL_IN_USE` (no linking staff
  or student accounts). Suspended guardian → 409 `USER_INACTIVE`.
  Duplicate ACTIVE link → 409 `LINK_EXISTS`.
- **Re-inviting a REVOKED relationship** reactivates the *same* link row
  (full history preserved, audited).

### Acceptance & login
Invitations ride the standard `/accept-invite` flow (same as staff and
students): set a password, then sign in at `/login`. Guardians skip the
student verification flow entirely (no StudentProfile → the onboarding
hook no-ops). After login they land on the guardian dashboard.

### Child access model (CHILD scope)
All guardian data access is authorized by **ACTIVE GuardianLink rows**,
resolved by PolicyService **on every request** — never by role names and
never by client-supplied ids alone. Guardians hold read-only CHILD-scope
grants for results (published exams only), attendance summaries, fee
invoices, timetables and published assignments, plus `guardian.children`
and `dashboard.guardian`. Everything else — students/teachers directory,
exports, audit, community, verification, moderation, settings, marks
entry, payment recording, assignment submission — is refused server-side.
The portal surfaces are `/dashboard`, `/children` and
`/children/<profileId>` (Overview / Attendance / Results / Fees /
Timetable / Assignments tabs, plus the report-card print view).

### Revocation
**Guardians card → Revoke** flips the link to REVOKED (row kept,
`revokedAt` stamped, audited). Access dies on the guardian's **next
request** — no token invalidation is needed because CHILD checks read
link status live. Repeat revoke → 409 `ALREADY_REVOKED`. The guardian's
other ACTIVE children are unaffected.

### Multiple children / multiple guardians
A guardian may be linked to any number of same-college students, and a
student to any number of guardians; each (guardian, student) pair is one
link row and each is authorized independently. A guardian for children
in two colleges needs one account per college (tenancy is absolute:
links, guardian and child are constrained to one college at creation).

### Dormant guardians
A guardian whose links are all REVOKED can still log in — they simply
see the "No linked children" empty state everywhere and can read nothing
child-related. Suspend the account from the user directory if login
itself should stop.

### Rate limits & mail failures
Guardian invitations: 20/hour per admin (429 `RATE_LIMITED`). Mail
delivery is fire-and-forget: an SMTP failure never fails the invite/link
operation — the invite URL dialog in the admin UI is the fallback
delivery path, and mail outcomes are audited.

### Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| Guardian sees "No linked children" | All links REVOKED, or linked in a different college — check the student's Guardians card. |
| Invite → 409 `EMAIL_IN_USE` | Email belongs to a staff/student account; use a different guardian email. |
| Invite → 429 | Admin hit 20/hour; wait for the window. |
| Guardian invite mail missing | Check SMTP config + audit mail events; reissue via the invite-URL dialog. |
| "Child not available" on a child page | Link revoked or URL from another account; the API also 403s all data for it. |
| Guardian still "sees" a child after revoke | Impossible server-side (status read per request); a stale browser tab only shows already-fetched data and every refresh/API call fails. |

### Security expectations
No role-name conditionals anywhere in request handling; PolicyService +
seeded grants are the single authorization source. `studentId` query
parameters never select data by themselves — they are verified against
an ACTIVE link first. Cross-college ids behave as nonexistent (404).
CSV exports remain resolved-ALL-scope only; `results.csv` is an **admin
marks export for a chosen exam and intentionally includes unpublished
marks** (guardians/students never reach it — their published-only view
is `/results`). Audit metadata for guardian events carries ids/flags
only — no emails, names, tokens or URLs.

## 22. Online payments runbook (M14)

### Provider & credentials (Safepay, V1)
Environment-only configuration (per V1 decision — no config table):

| Variable | Purpose |
|---|---|
| `SAFEPAY_API_KEY` | merchant public API key (`merchant_api_key`) |
| `SAFEPAY_SECRET_KEY` | secret key for server-to-server calls (`x-sfpy-merchant-secret`) |
| `SAFEPAY_WEBHOOK_SECRET` | endpoint shared secret for `X-SFPY-SIGNATURE` HMAC-SHA512 verification |
| `SAFEPAY_ENVIRONMENT` | `sandbox` (default) or `production` |
| `SAFEPAY_INTENT` | card channel (`CYBERSOURCE` default; confirm your account's channel at onboarding) |
| `SAFEPAY_HOST` | API host override (defaults per environment) |

Rules: API key + secret key are an **all-or-none pair** — a half-configured
pair fails boot validation; fully unset simply disables online payments
(`FEATURE_DISABLED` on initiation, 401 on webhooks). **Never** commit
secrets, put them in audit metadata, or paste them into logs/tickets.
Provider-side setup: create the webhook endpoint in the Safepay dashboard
pointing at `https://<host>/api/v1/payments/webhooks/safepay`, subscribe
to payment events, and copy its shared secret into
`SAFEPAY_WEBHOOK_SECRET`.

**Rotation:** generate the new key/secret in the Safepay dashboard, update
the environment, redeploy/restart the API (env is read per request for the
webhook secret but a restart guarantees consistency). Webhooks queued
before a webhook-secret rotation may still be signed with the old key —
expect a short window of 401s that Safepay retries; verify pending
attempts via reconciliation afterwards.

### How money moves (authority model)
- **Browser redirects are NEVER payment authority.** The status page only
  asks the server to verify; forged "success" URLs change nothing.
- Authority = **signed webhooks** (HMAC over the raw body) and
  **server-to-server verification** against the frozen attempt amount.
- `Payment` rows are settled money only; `PaymentAttempt` is the in-flight
  record. Only `SUCCEEDED` attempts represent settled gateway money.
- **Staff must never edit PaymentAttempt/Payment rows directly in the
  database.** Every state change flows through the settlement core
  (row-locked, replay-proof); manual edits break the ledger invariants.
- Never log or share tracker tokens, checkout URLs/TBTs, signatures or
  raw webhook bodies.

### Student flow
Invoice detail → **Pay now** (full outstanding balance, PKR) → hosted
Safepay checkout → return to the status page, which polls server-side
verification for up to 2 minutes. Pending is normal for a few minutes;
failed/expired attempts charge nothing and offer "Try again" (a brand-new
attempt). Attempts auto-expire after 1 hour without confirmation.

### Reconciliation (Fees → Reconciliation tab, `fees.manage`)
| Situation | What to do |
|---|---|
| Gateway dashboard shows paid, CampusOS PENDING | Click **Verify with gateway** — the server fetches the tracker and settles if confirmed. |
| CampusOS PAID but provider later reports failure/reversal | V1 has no refunds: resolve in the Safepay dashboard, then record the correction offline; the attempt/Payment stay as the audit trail. Flag for the V2 refund workflow. |
| Webhooks repeatedly rejected (401s in provider logs) | Webhook secret mismatch — re-copy the endpoint secret; queued events may be signed with an old key after rotation. |
| Attempt FAILED with `AMOUNT_MISMATCH` | The provider confirmed a different amount than the frozen attempt. Nothing was recorded. Investigate in the provider dashboard before advising the student to retry. |
| Attempt flagged **Overpaid — manual investigation required** | A confirmed payment exceeded the remaining balance (usually a manual payment raced the checkout). The money IS recorded and the invoice capped at PAID; refund the excess via the provider dashboard and note it. |
| Unmatched gateway events listed | A signed delivery referenced a tracker CampusOS doesn't know (wrong endpoint, other system, or manual dashboard activity). Cross-check the event id in the Safepay dashboard. |
| Provider unreachable (`GATEWAY_ERROR`) | Initiations fail safely (attempt FAILED, nothing payable); students can retry once the provider recovers. Webhooks are retried by Safepay automatically. |
| Duplicate webhook deliveries | Expected — the event ledger makes them no-ops. No action. |

### Provider details status
VERIFIED LIVE against the real sandbox (M14-SBX): payment initiation
(session + TBT), hosted checkout, a genuine successful card payment
(PKR/paisa amounts exact end-to-end), server-side verification and
settlement through the settlement core, decline/retry behavior
(declined payer-auth leaves the tracker retryable at TRACKER_STARTED;
CampusOS correctly stays PENDING with nothing recorded), the metadata
key whitelist, and the reporter response shape. `intent`: both
CYBERSOURCE and MPGS are accepted at session-create on the verified
merchant; CYBERSOURCE processed the live card payment.

VERIFIED (docs/SDK): webhook event shapes, `X-SFPY-SIGNATURE`
HMAC-SHA512 over the raw body, checkout-token (TBT) 1-hour expiry.

**DEFERRED — genuine webhook delivery was NOT live-verified** (real
`payment.succeeded`/`payment.failed` delivery, redelivery/replay,
event-id stability and retry cadence): the Safepay dashboard webhook
endpoint could not be registered in the verification environment. This
is an operational/provider-access limitation, not a known CampusOS code
defect — the webhook path is fully covered by deterministic
signature/replay tests, and the webhook-missing recovery path (Verify
with gateway) was proven against the real provider. Complete this at
merchant onboarding by registering the endpoint (see above) and
observing one delivery plus one dashboard redelivery.

UNRESOLVED (confirm at merchant onboarding): settlement timing and
fees/`include_fees`, transaction limits for large tuition amounts,
refund API contract, education-sector onboarding requirements.

## 23. Rollback procedure

1. `git checkout <previous-release-tag>` and rebuild images.
2. If the bad release included a migration: restore the pre-deploy database
   backup (section 7) — migrations are forward-only; do not hand-revert SQL
   in place.
3. `docker compose -f docker-compose.prod.yaml --env-file .env.production up -d`
4. Verify health + login, then investigate the failed release offline.

Because migrations run before app cutover (section 5) and are additive, the
usual rollback (code only, schema kept) is safe: older code ignores new
columns/tables. A database restore is only needed when data was corrupted.

## 24. Academic term rollover / semester boundary runbook (M15)

Admin-only (`academics.manage`). Everything below is college-scoped to the
authenticated admin; another college's terms, sections, teachers and
students are invisible (404) — the browser can never pick a college.

> **Rollover does not automatically create invoices, payments, refunds, or
> timetable slots.** It never reads or writes money or timetable data, and
> it never reads marks/results (no pass/fail inference). Those are separate,
> deliberate steps in the sequence below.

### Before you start (checklist)

1. **Confirm the source term** — the term that is ending. The wizard
   defaults to the current term; verify its section count looks right.
2. **Confirm the destination term** — it must already exist (Calendar →
   "New term") and must be **empty** (0 sections), otherwise the draft is
   refused with `TARGET_TERM_NOT_EMPTY`.
3. **Same college is enforced by the backend** — both terms are resolved
   against your `collegeId`; a foreign source term yields
   `INVALID_SOURCE_TERM` and a foreign destination is a plain 404.
4. Review the source term's sections, enrolled students and teaching
   assignments; decide up front who repeats, who leaves and which section
   (if any) is a graduating cohort.
5. Understand the money/timetable non-goal above, and make sure a
   destination-term **fee structure** and **timetable plan** exist or are
   scheduled — rollover will not create them for you.

### Step 1 — draft (`POST /terms/:id/rollover {fromTermId}`)

Calendar → **Start rollover** → pick source + destination → "Open rollover
preview". The backend creates a `TermRollover` DRAFT with a **suggested
plan**: every source section becomes a same-course CLONE with the same
section name, current teachers carried, ACTIVE students defaulted to CARRY
— except WITHDRAWN/GRADUATED students, which are force-EXCLUDED (locked).
SUSPENDED students default to CARRY but are flagged (⚠ counter).

Re-POSTing is **idempotent**: an existing DRAFT for that destination is
resumed unchanged (this is also how you re-enter an abandoned draft — just
start the rollover again for the same destination, or open
`/calendar/rollover/<destination-term-id>` directly). Errors:

| Code | Meaning |
|---|---|
| `SAME_TERM` | source = destination |
| `INVALID_SOURCE_TERM` | source term not found in your college |
| `TARGET_TERM_NOT_EMPTY` | destination already has sections |
| `ALREADY_EXECUTED` (409) | a rollover into this term already ran |

### Step 2 — review & edit the plan (wizard, `PATCH /terms/:id/rollover`)

Per section: **CLONE** (same course), **MAP** (different destination
course — required `targetCourseId`), or **SKIP** (do not carry);
destination section name; **graduate students** checkbox (final cohorts:
students' profiles become GRADUATED instead of enrolling anywhere); teacher
carry toggle with per-teacher checkboxes. Per student: **CARRY**, **HOLD**
(repeat — enrolls into another *carried* section's destination) or
**EXCLUDE**. Locked rows (WITHDRAWN/GRADUATED) cannot be changed.

The **backend remains authoritative**: PATCH is DRAFT-only and re-validates
structure and tenancy (duplicate sections, MAP without course, HOLD without
or into a SKIP target, foreign sections/courses are all rejected). The UI
counters are a convenience; the server recomputes everything.

### Step 3 — execute (`POST /terms/:id/rollover/execute {confirmLabel}`)

The wizard requires typing the **exact destination term label** — and the
server independently enforces it (`CONFIRMATION_MISMATCH`), so the typed
confirmation can never be bypassed by a client. Execution is **one atomic
transaction**: the rollover row is row-locked and CAS'd DRAFT→EXECUTED
first, so **duplicate or concurrent executions collapse to exactly one
success** (the others get `ALREADY_EXECUTED`); every plan id is re-checked
live against your college inside the transaction, and any stale/foreign id
aborts the whole run with **zero partial state, the DRAFT preserved and
safely retryable**. An EXECUTED rollover is intentionally **immutable**:
it cannot be edited or re-run. Before retrying a failed execution, verify:
rollover status is still DRAFT (`GET /terms/:id/rollover`), the destination
term has no unexpected sections, no destination enrollments or teaching
assignments exist, and student statuses are unchanged — a failed run leaves
all of these untouched. Do **not** hand-repair with SQL; fix the plan (or
the referenced data) and execute again.

### Step 4 — required post-rollover sequence

1. **Verify counters** on the success screen / `GET …/rollover`
   (`sectionsCreated`, `enrollmentsCreated`, `teachingAssignments`,
   `enrollmentsCompleted`, `graduated`, `held`, `excluded`).
2. **Set the destination term current**: Calendar → "Set current"
   (`PATCH /terms/:id/set-current`) — atomic swap; a DB partial unique
   index guarantees at most one current term per college.
3. **Build the destination timetable** with the existing Timetable tools.
4. **Create the destination-term fee structure** (Fees → structures).
5. **Generate destination-term invoices** (`POST /fees/invoices/generate`)
   with the existing fee tools.
6. **Verify old-term data remains readable**: source sections, COMPLETED
   enrollments, results, attendance and invoices are untouched and
   accessible by switching term filters.
7. **Verify dashboards** now reflect the new current term.
8. **Review audit events**: `terms.rollover_drafted` and
   `terms.rollover_executed` (ids and counters only — no student data).

## 25. Refund operations runbook (M16)

Refund mutations require `finance.refund` (ADMIN and ACCOUNTANT only).
Everything is scoped to the operator's own college; foreign payments and
attempts are indistinguishable from nonexistent (404).

> **Refunds do not mutate the original Payment amount/history and do not
> create payments, invoices, timetable records, or fee structures.** Only
> the derived Invoice status is recomputed from
> `netPaid = Σ payments − Σ refunds` (net 0 → PENDING).

### Before initiating any refund

1. Confirm you are operating in the correct college (your session decides;
   the browser can never choose one).
2. Confirm the payment and its invoice (invoice detail → Payments).
3. Verify the payment is actually settled money (a `Payment` row —
   in-flight gateway attempts are not refundable).
4. Inspect existing refunds on the payment (invoice detail → Refunds, or
   `GET /fees/payments/:id/refunds`).
5. The remaining refundable amount is server-computed:
   `payment.amount − Σ settled refunds`. Never trust a stale screen — it
   is re-checked inside the transaction at creation AND execution.
6. Record a meaningful reason (kept on the attempt; never in audit
   metadata).
7. Choose the method: **RECORDED** for CASH/BANK payments (and for
   out-of-band returns of online money); **PROVIDER** only for
   gateway-settled ONLINE payments.

### RECORDED refunds

Use when the money is returned outside CampusOS (cash drawer, bank
transfer). The operator must verify externally that the money actually
left — the typed-amount confirmation is the authoritative staff act that
materializes the immutable `Refund` row in one transaction. The Payment
itself is never modified; the invoice status is recomputed (a PAID
invoice can return to PARTIAL, and to PENDING at net 0).

### PROVIDER (Safepay) refunds

Live-verified end to end in M16-W3. CampusOS sends the FROZEN attempt
amount (paisa at the adapter boundary) to
`POST /order/payments/v3/{tracker}/refund`; the provider refund reference
(`refund_…`) is captured from the provider reporter — never from the
browser. Partial refunds are supported until the payment is exhausted;
the provider independently enforces the same bound.

**Provider truth is authoritative. Never manually mark a provider refund
successful.**

- If the execute call is rejected or unreachable, the attempt stays
  **PROCESSING** — this is deliberate: the money may have moved.
- Resolve it with **Verify with provider** (Fees → Reconciliation →
  Refunds). Verification reads the payment reporter and, only on a
  matching unclaimed provider refund record, finalizes SUCCEEDED; a
  reachable reporter showing no refund fails the attempt
  (`PROVIDER_REJECTED`); a mismatched amount fails it
  (`AMOUNT_MISMATCH`) with zero money recorded.
- If the provider is unreachable, PRESERVE the PROCESSING state and
  verify later. Repeated verification is replay-safe (no duplicate
  Refund rows, audit events or notifications).

### Failure handling / retry

FAILED, SUCCEEDED and CANCELLED are terminal — never resurrected. To
retry a failed refund, create a **new** RefundAttempt (the in-flight slot
frees automatically) after re-checking the remaining refundable amount.
Only REQUESTED attempts can be cancelled; PROCESSING can not (money may
be moving — verify instead).

### Concurrency guarantees (for the operator's confidence)

At most ONE in-flight attempt per payment (DB partial unique index);
every transition is CAS-guarded; the invoice row lock serializes refunds
against settlements and manual recordings; the refundable headroom is
re-validated at execution time — over-refunds are impossible by
construction (proven by the W2 adversarial suite and the W3 live run).

### Post-refund verification checklist

1. RefundAttempt reached the expected terminal state.
2. A `Refund` row exists (SUCCEEDED only) with the exact amount.
3. Provider reference recorded (PROVIDER refunds).
4. Remaining refundable amount decreased accordingly.
5. Invoice status recomputed correctly (PARTIAL / PENDING per D-5;
   CANCELLED invoices stay CANCELLED — their money is still refundable).
6. `payments.refund_*` audit event present (ids/amounts only).
7. Student notification delivered (success) / requester notified
   (provider failure).
8. The attempt appears in Reconciliation → Refunds.
9. `GET /exports/refunds.csv` includes the row when a report is needed
   (fees.manage/ALL only; supports `status`/`method` filters).
10. The original Payment row is unchanged — always.

Refund webhooks are NOT operationally available (provider dashboard
registration remains externally blocked); reconciliation verification is
the truth mechanism.

## 26. Term lifecycle runbook (M17)

Term close/reopen requires `academics.manage` (ADMIN); accountants,
teachers, students and guardians are refused. Everything is scoped to
the operator's own college — a foreign term id is an indistinguishable
404 and leaks nothing.

### What CLOSED means operationally

A CLOSED term's academic record is **read-only**: attendance (session
generation, edits, sheets), exams/papers/marks/publishing, assignments
and submissions/grading, timetable slots, enrollments, teaching
assignments, section creation/edits, and the term's own definition are
all refused with 409 `TERM_CLOSED`. Term-bound **fee-structure creation
and edits, invoice generation, and invoice cancellation** are also
blocked (O-2).

**Still allowed on CLOSED terms** — immutable financial history must
remain operable after academic closure: arrears `recordPayment`, online
settlement of existing invoices, the full refund cycle, reconciliation,
and CSV exports. Payments and refunds are additive immutable ledgers;
settling or refunding old-term money never rewrites academic history.

### Closing a term

1. Confirm the intended term on **Calendar** (label, year, dates).
2. Confirm it is **not the current term** — current terms cannot be
   closed (`TERM_IS_CURRENT`); set another term current first.
3. Confirm active academic work for the term is genuinely finished.
4. Calendar → the term row → **Close…** → type the exact term label
   (server-validated typed confirmation) → Close term.
5. Success: the row shows a **Closed** badge, only "Reopen…" remains,
   and a `terms.closed` audit event exists (label-only metadata).

### Reopening a term

Appropriate when closure was premature or a correction to historical
academic data is genuinely required. Same permission, same typed
confirmation (Calendar → Reopen…). Emits `terms.reopened`. Consequence:
every blocked mutation becomes possible again — reopen deliberately,
correct, then close again.

### Current-term interaction

- The current term can never be closed (`TERM_IS_CURRENT`, re-checked
  under the database row lock — not a UI nicety).
- A CLOSED term can never be made current (`TERM_CLOSED` on
  set-current). Set-current must target an ACTIVE term.

### Rollover interaction

- A CLOSED term is **rejected as a rollover destination** (at draft AND
  inside the execution transaction).
- A CLOSED term **remains valid as a rollover source** (reads only).
- The rollover execute dialog offers an explicit **"Also close
  {source}"** checkbox — never automatic. If the close is refused
  (typically because the source is still current), **the rollover is
  still fully successful**; the response carries
  `sourceTermClosed: false` with the refusal code, and the operator
  closes the term from the calendar after switching the current term.

### Error semantics

| Code | Meaning | Action |
|---|---|---|
| `TERM_CLOSED` (409) | mutation against a closed term | intended; reopen first if the change is genuinely required |
| `TERM_IS_CURRENT` (400) | tried to close the current term | set another term current, retry |
| `INVALID_TRANSITION` (409) | close on CLOSED / reopen on ACTIVE / lost a concurrent race | refresh; exactly one concurrent transition ever wins |
| `CONFIRMATION_MISMATCH` (400) | typed label wrong | type the exact label |
| 404 | foreign or nonexistent term | verify the college/term |
| rollover `sourceTermCloseError` | post-rollover close refused | rollover is complete; close from the calendar |

Concurrency is CAS + row-lock protected (one winner, one 409; exactly
one audit row per real transition). **Never manually mutate the
database to force a lifecycle state** — use the endpoints; they are the
only path that preserves the invariants and the audit trail.

### Post-close verification checklist

1. Term shows CLOSED (badge / `GET /terms` status).
2. The current-term invariant is intact (exactly one current term, and
   it is not the closed one).
3. `terms.closed` audit event present.
4. A spot-check academic write (e.g. a timetable edit) returns 409
   `TERM_CLOSED`.
5. Arrears payment / refund on an old invoice still works.
6. Rollover result recorded correctly if closure came from the rollover
   flow.
7. No cross-tenant visibility anywhere (foreign terms remain 404).

## 27. Academic records runbook (M18)

Result finalization/amendment/void require `results.finalize` (ADMIN
via the permission matrix). Report cards and transcripts are read
through the existing `results.read` scopes: students read only
themselves (OWN), guardians read linked children (CHILD via an ACTIVE
GuardianLink, strictly read-only), staff per the existing matrix.
Everything is scoped to the operator's own college; foreign students,
terms and records are indistinguishable 404s.

### What FINALIZED means

A FINALIZED `TermResult` is an **immutable snapshot** of one student's
one-term academic outcome, computed at finalization time from PUBLISHED
exams' locked marks plus term attendance, with course code/title/
credits frozen onto its `CourseResult` lines. It is the historical
source of truth: report cards and transcripts render snapshots — live
marks are working data, never historical records. Later mark edits,
catalog edits, GradeBand edits and term reopening **cannot** change an
existing snapshot.

### Finalizing a term result

Prerequisites: the term is **CLOSED** (`TERM_NOT_CLOSED` otherwise —
the intended lifecycle is publish exams → close term → finalize) and
the student has at least one published exam mark in the term
(`NO_PUBLISHED_RESULTS` otherwise). The operation requires typing the
exact term label (server-validated). Success emits one
`results.finalized` audit event (student/term/version ids only).
Exactly one FINALIZED snapshot can exist per student per term — the
database enforces it; a concurrent duplicate simply receives
`ALREADY_FINALIZED` and creates nothing.

### Batch finalization

`finalize-batch` runs the SAME single-student engine once per student,
each in its own atomic transaction, and returns per-student outcomes.
Partial success is normal: inspect the `outcomes` array —
`ALREADY_FINALIZED` and `NO_PUBLISHED_RESULTS` entries are expected
conditions, not failures to escalate. Re-running a batch is safe.

### Amendments (corrections)

To correct a finalized result: fix the underlying marks (reopen the
term if needed — reopening never touches snapshots), then **amend** the
active record. Amendment recomputes from current data and creates
version N+1; the previous version becomes SUPERSEDED — preserved
forever, still queryable, chained to its replacement. The ACTIVE
version is always the single FINALIZED row for that student/term.
Superseded versions can never be amended again or voided. **Never
delete historical versions to "clean up" — the chain is the audit
trail.** Each amendment emits `results.amended`.

### VOID

VOID administratively invalidates the ACTIVE finalized version (typed
confirmation + reason; `results.voided` audited). It removes the record
from transcripts and frees the slot for a fresh finalization — but the
row and its course lines remain in the database permanently. VOID does
NOT touch marks, exams, the term, or any other version. Re-voiding and
voiding SUPERSEDED history are refused.

### GPA / CGPA reality

Grade points come from `GradeBand.gradePoint` **at finalization time**
and are frozen into the snapshot. The shipped seed defines NO grade
points — until the institution configures its official scale, GPA,
CGPA, credits-earned and pass/fail are honestly `null` and the UI shows
"Not configured". **Never fabricate or manually enter GPA values.**
Once configured, new finalizations compute the credit-weighted GPA;
historical snapshots keep the points they were frozen with, even if the
scale is later edited. CGPA appears only when every finalized course
line carries a point.

### Guardian access

An ACTIVE GuardianLink grants CHILD read access to the linked student's
report card and transcript — read-only, no exceptions. Unlinked
guardians receive the standard 404. Revoking the link removes access
immediately.

### Never do this

- Never manually mutate `TermResult`/`CourseResult` rows in production.
- Never delete historical result rows to "correct" a grade — amend.
- Never hand-edit GPA/grade values.
- Before any operational intervention: check the audit history
  (`results.finalized/amended/voided`) and verify the college/student
  identity you are acting on.

### Error semantics

| Code | Meaning | Action |
|---|---|---|
| `NOT_FINALIZED` (404) | no active snapshot for that term | finalize first (or nothing to show — expected) |
| `TERM_NOT_CLOSED` (409) | finalize attempted on an ACTIVE term | close the term (OPERATIONS §26), retry |
| `ALREADY_FINALIZED` (409) | active snapshot exists (incl. concurrency losers) | amend instead of re-finalizing |
| `NO_PUBLISHED_RESULTS` (400) | student has no published marks in the term | publish exams first, or skip the student |
| `INVALID_TRANSITION` (409) | amend/void on a non-active version | act on the ACTIVE version only |
| `CONFIRMATION_MISMATCH` (400) | typed label wrong | type the exact term label |
| 403 / 404 | authorization / foreign or missing target | verify permission, college, ids |
| GPA shows "Not configured" | grade-point scale undefined | configure `GradeBand.gradePoint` institutionally; do not improvise |

### Post-finalization verification checklist

1. TermResult exists, status FINALIZED, expected version.
2. CourseResult lines match the published marks at finalization time.
3. `results.finalized` audit row present.
4. Report card and transcript render the snapshot (spot-check one
   value against the frozen row, not live marks).
5. Guardian/student visibility follows the scopes.
6. After an amendment: old version SUPERSEDED and chained, new version
   ACTIVE, transcript shows only the new one.

## 28. Backup automation & operational health runbook (M19-W3)

### What runs automatically

The `backup` sidecar (docker-compose.alloy.yaml) runs
`scripts/backup/backup-loop.sh`: one `pg_dump --format=custom` immediately
on start and one every 24h (`BACKUP_INTERVAL_SECONDS`), written to the
`pgbackups` named volume at `/var/backups/campusos` as
`campusos-<UTC-stamp>.dump`. Each dump is written as a `.partial` file,
TOC-verified with `pg_restore --list`, and only then renamed — a crashed
dump can never masquerade as a valid backup. Retention is bounded:
`campusos-*.dump` older than `RETENTION_DAYS` (default 14) are pruned; the
prune pattern is fixed and can never delete anything else. A failed cycle
logs and retries next interval; it never crashes the sidecar.

The volume lives outside the source tree; `.gitignore` additionally blocks
`*.dump` and `backups/` so an artifact can never be committed. Off-host
copies remain a deployment concern (§6) — this V1 destination is the local
named volume by decision O-3.

### Restore procedure (real incident)

Follow §7 exactly (stop api/web → drop/create → `pg_restore --no-owner` →
`prisma migrate status` → start). Dumps produced by the sidecar are the
same custom format §7 expects.

### Restore drill (quarterly, and after any Postgres change)

```sh
docker compose -f docker-compose.alloy.yaml exec -T backup \
  bash /scripts/restore-verify.sh
```

The drill restores the NEWEST dump into a disposable database
(`campusos_restore_verify`, name fixed in the script), asserts
representative data (colleges > 0, users > 3, ≥13 finished migrations, all
four demo accounts), then drops the scratch DB. It never writes to the live
`campusos` database. PASS output ends with
`restore-verify: PASS — scratch database dropped, live database untouched`.

### Operational health: GET /api/v1/health/ops

Requires `settings.manage` (ADMIN). Public `GET /health` is unchanged.
Reports: `database` up/down; `migrations.applied` / `migrations.unfinished`
(unfinished must be 0); `backups` {configured, count, latestAgeSeconds,
stale} read from the api container's read-only `pgbackups` mount
(`BACKUP_DIR`); `uploadsWritable`; `uptimeSeconds`. `status` becomes
`degraded` when the db is down, any migration is unfinished, uploads are
unwritable, or backups are configured but stale (older than
`BACKUP_MAX_AGE_SECONDS`, default 26h — one missed daily cycle). The
response never contains credentials, DSNs, paths or filenames.

### Failure interpretation

| Signal | Meaning | Action |
|---|---|---|
| `backups.stale: true` | newest dump older than threshold | `docker logs <backup container>`; check disk; restart sidecar |
| `backups.configured: false` | no BACKUP_DIR mounted | expected in bare test runs; in compose, check the api volumes |
| `backups.count: 0` with configured | volume empty/unreadable | sidecar never succeeded — inspect logs |
| `migrations.unfinished > 0` | crashed/rolled-back migration | investigate `_prisma_migrations`; never edit rows manually |
| `uploadsWritable: false` | uploads dir missing/read-only | fix volume/permissions; file uploads are failing |
| drill FAIL | dump unreadable or data checks failed | treat newest dump as bad; check earlier dumps; escalate |

### Operators must NEVER

- run `restore-verify.sh` pointed at the live database (the scratch name is
  hard-coded — do not "adapt" it);
- delete files from the backup volume by hand (retention is automated);
- run `pg_restore` against `campusos` outside the §7 procedure;
- expose `/health/ops` publicly or relax its permission gate;
- commit any `*.dump` file.

### V1 limitations (deliberate, O-3/O-4)

Local-volume destination only (no off-host copy automation); no
point-in-time recovery (daily granularity); process-local health (no
external monitoring/SaaS — deferred); uploads volume backup remains the §6
manual procedure.

### M19 security close-out notes (W4)

- File downloads are signed capability URLs (5-min TTL). Authorization
  happens at signing: owner or same-college for recorded keys, stricter
  uploader/reviewer rule for evidence, legacy behavior for pre-M19 keys
  with no ownership record. Do not share signed URLs; request fresh ones.
- Outgoing mail HTML is entity-escaped at the single template chokepoint;
  only `https?://` values ever render as links. Report any HTML-looking
  artifact in received mail as a defect — do not "fix" it by editing data.
- `/auth/google/callback` is rate limited per IP (60/min, process-local).
  A burst of 429s there indicates abuse or a proxy collapsing client IPs —
  check `trust proxy`/ingress before raising limits.
- Emergency-contact fields on students (`guardian*` columns) are contact
  data only: they never grant guardian access (GuardianLink is the sole
  channel) and are visible only to full-scope staff and the student.

## 29. Finance documents runbook (M20)

### What a FinanceDocument is

An **immutable snapshot** acknowledging exactly one settled money row:
`PAYMENT_RECEIPT` per `Payment`, `REFUND_DOCUMENT` per `Refund`
(`paymentId`/`refundId` are DB-unique — a second document for the same
transaction is structurally impossible). Every displayed value (student
identity, invoiceNo, structure/college names, amount, method, masked
reference, invoice total, balance **at issuance**, receiver name, parent
receipt number) is frozen inside the same database transaction as the
money event. Later renames, payments, refunds or term changes NEVER alter
an issued document — the fees pages show live balances; the document shows
history.

### Issuance

- **Automatic**: manual payment recording, verified gateway settlement,
  and both refund-success paths (PROVIDER + RECORDED) issue the document
  in-transaction. A failed transaction issues nothing.
- **Historical (pre-M20 rows)**: `POST /fees/payments/:id/receipt` and
  `POST /fees/refunds/:id/document` (`fees.manage`). Replays return 409
  `ALREADY_ISSUED`. Nothing is backfilled automatically — issue on demand.
- **Numbering**: `RCP-`/`RFD-<year>-<seq5>`, unique per college
  (`(collegeId, receiptNo)`), allocated as `max(sequence)+1` under a
  per-(college, kind, year) advisory transaction lock taken AFTER the
  invoice row lock. Sequences restart each calendar year per kind. Numbers
  are never reused — a VOID document keeps its number forever. Under
  concurrency, duplicate-document attempts lose with 409; number
  collisions from out-of-band rows are retried with a bumped sequence
  (`NUMBERING_EXHAUSTED` after bounded retries — investigate manual rows).

### Lifecycle: ACTIVE → VOID (only)

Void (`POST /fees/documents/:id/void`, `fees.manage`) requires a reason
(≥5 chars), is CAS-protected (a concurrent double-void loses with 409
`INVALID_TRANSITION`), audits `fees.receipt_voided` in-transaction, and
changes ONLY status/voidedBy/voidedAt/voidReason. There is no
VOID→ACTIVE, no delete, no snapshot edit — anywhere. Voiding a receipt
does not move money; if money was wrong, refund/re-record through the
normal flows (each producing its own documents), then void the orphaned
receipt with a clear reason.

### Authorization (existing permissions only)

| Actor | Read | Issue (historical) / Void |
|---|---|---|
| ADMIN / ACCOUNTANT | fees.read ALL (college) | fees.manage |
| STUDENT | fees.read OWN (self only) | — |
| GUARDIAN | fees.read CHILD — explicit `?studentId=` + ACTIVE GuardianLink | — |
| TEACHER / anonymous | none / 401 | — |

Cross-college and OWN-mismatch reads return a 404 indistinguishable from
a nonexistent document. Success-mail receipt links are convenience only —
the document page re-authorizes through the API on every load.

### Reading & printing

UI: `/fees/documents` (list; students see "My receipts"), document page
`/fees/documents/<id>` with Print / Save as PDF (browser print — there is
deliberately NO server-side PDF). VOID documents remain readable and print
with a VOID watermark + reason. The API payload is the exact public
contract: no internal ids, no unmasked references (last 6 chars only), no
refund reasons, no attempt history.

### Audit

`fees.receipt_issued` (in the issuing transaction; metadata: receiptNo,
kind, paymentId|refundId) and `fees.receipt_voided` (receiptNo, kind) —
exactly once each; reads are not audited.

### Error codes

| Code | Meaning | Action |
|---|---|---|
| `ALREADY_ISSUED` (409) | document exists for that payment/refund | open the existing document |
| `INVALID_TRANSITION` (409) | void on an already-VOID document | nothing — it is already void |
| `REASON_REQUIRED` (400) | void reason missing/too short | provide a real reason |
| `NUMBERING_EXHAUSTED` (409) | bounded retry ran out | check for manual FinanceDocument rows; retry |
| 404 | foreign college / not yours / nonexistent | verify id and permission |

### Operators must NEVER

- edit, delete or re-number FinanceDocument rows in SQL — they are the
  institution's financial evidence;
- "fix" a wrong receipt by editing snapshot fields — void it (audited)
  and let the corrective money flow issue new documents;
- treat a receipt email link as authorization or forward signed content;
- expose a receipts endpoint without the fees.read gates.

### Deferred (explicitly NOT implemented in M20)

Server-side PDF rendering; StoredFile `FINANCE_DOCUMENT` purpose; college
branding fields (address/logo); `receipts.csv` export; mail attachments.

### Verification checklist

1. Record a test payment → `fees.receipt_issued` audit + document visible
   on the invoice page. 2. `GET /fees/documents/<id>` as the student →
   200; as a rival college admin → 404. 3. Void with reason → VOID
   watermark on the page, second void 409. 4. Full suite:
   `npm test -w @campusos/api`.
