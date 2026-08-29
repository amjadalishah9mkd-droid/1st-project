#!/usr/bin/env bash
# M19-W3 — single PostgreSQL backup + bounded rotation.
#
# Runs inside the `backup` sidecar (postgres image, so pg_dump matches the
# server major version). Produces custom-format dumps that pg_restore can
# replay selectively, then prunes anything older than RETENTION_DAYS.
#
# Never prints credentials; connection settings come from the standard PG*
# environment variables. Deletion is strictly limited to the campusos-*.dump
# pattern inside BACKUP_DIR — nothing else is ever removed.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-campusos}"
PGDATABASE="${PGDATABASE:-campusos}"
export PGHOST PGPORT PGUSER PGDATABASE

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$BACKUP_DIR/.campusos-$STAMP.dump.partial"
OUT="$BACKUP_DIR/campusos-$STAMP.dump"

# Write to a dotfile first, rename on success — a crashed dump can never be
# mistaken for a valid backup (freshness checks ignore .partial files).
pg_dump --format=custom --file="$TMP"
# Structural validity gate: pg_restore must be able to read the TOC.
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$OUT"
echo "backup: wrote $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

# Bounded retention (pattern-scoped; never touches anything else).
find "$BACKUP_DIR" -maxdepth 1 -name 'campusos-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name '.campusos-*.dump.partial' -mtime +1 -delete
echo "backup: retention pruned (> ${RETENTION_DAYS} days)"
