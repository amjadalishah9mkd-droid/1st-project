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

## 21. Rollback procedure

1. `git checkout <previous-release-tag>` and rebuild images.
2. If the bad release included a migration: restore the pre-deploy database
   backup (section 7) — migrations are forward-only; do not hand-revert SQL
   in place.
3. `docker compose -f docker-compose.prod.yaml --env-file .env.production up -d`
4. Verify health + login, then investigate the failed release offline.

Because migrations run before app cutover (section 5) and are additive, the
usual rollback (code only, schema kept) is safe: older code ignores new
columns/tables. A database restore is only needed when data was corrupted.
