#!/usr/bin/env bash
# M19-W3 — restore drill (run quarterly, and after any Postgres change).
#
# Restores the NEWEST backup into a DISPOSABLE database named
# campusos_restore_verify, proves representative CampusOS data survived the
# round trip, then drops the scratch database. The real source database
# is never written to — only the scratch DB is created/dropped, and its name
# is fixed here (never taken from user input).
#
# Run inside the postgres container (pg_restore matches server version):
#   docker compose -f docker-compose.alloy.yaml exec -T postgres \
#     bash /workspace-scripts/restore-verify.sh        # if mounted, or:
#   docker compose ... exec -T backup bash /scripts/restore-verify.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-campusos}"
PGDATABASE="${PGDATABASE:-campusos}"
export PGHOST PGPORT PGUSER PGDATABASE
SCRATCH_DB="campusos_restore_verify"

if [ "$PGDATABASE" = "$SCRATCH_DB" ]; then
  echo "restore-verify: FAIL — source database cannot be the scratch database" >&2
  exit 1
fi

LATEST="$(ls -1t "$BACKUP_DIR"/campusos-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  echo "restore-verify: FAIL — no campusos-*.dump found in $BACKUP_DIR" >&2
  exit 1
fi
echo "restore-verify: using $(basename "$LATEST")"

# 1. Structural validity.
pg_restore --list "$LATEST" > /dev/null
echo "restore-verify: dump TOC readable"

# 2. Capture a generic non-PII source fingerprint, then restore into the
# disposable database (never the live one). This works in production without
# requiring demo accounts.
FINGERPRINT_SQL="$(cat <<'SQL'
SELECT
  (SELECT count(*) FROM "College")::text || '|' ||
  (SELECT count(*) FROM "User")::text || '|' ||
  (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL)::text || '|' ||
  coalesce((SELECT md5(string_agg(id, ',' ORDER BY id)) FROM "User"), '')
SQL
)"
SOURCE_FINGERPRINT="$(psql -d "$PGDATABASE" -tA -c "$FINGERPRINT_SQL")"
dropdb --if-exists "$SCRATCH_DB"
createdb "$SCRATCH_DB"
pg_restore --no-owner --dbname="$SCRATCH_DB" "$LATEST"
echo "restore-verify: restore completed"

# 3. Restored representative data must exactly match the source fingerprint.
RESTORED_FINGERPRINT="$(psql -d "$SCRATCH_DB" -tA -c "$FINGERPRINT_SQL")"
if [ "$RESTORED_FINGERPRINT" != "$SOURCE_FINGERPRINT" ]; then
  echo "restore-verify: FAIL — restored data did not pass representative checks" >&2
  dropdb --if-exists "$SCRATCH_DB"
  exit 1
fi
echo "restore-verify: representative data fingerprint matches source"

# 4. Clean up the scratch database.
dropdb "$SCRATCH_DB"
echo "restore-verify: PASS — scratch database dropped, live database untouched"
