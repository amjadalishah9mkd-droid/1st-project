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

## 15. Rollback procedure

1. `git checkout <previous-release-tag>` and rebuild images.
2. If the bad release included a migration: restore the pre-deploy database
   backup (section 7) — migrations are forward-only; do not hand-revert SQL
   in place.
3. `docker compose -f docker-compose.prod.yaml --env-file .env.production up -d`
4. Verify health + login, then investigate the failed release offline.

Because migrations run before app cutover (section 5) and are additive, the
usual rollback (code only, schema kept) is safe: older code ignores new
columns/tables. A database restore is only needed when data was corrupted.
