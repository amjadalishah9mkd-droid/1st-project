#!/usr/bin/env bash
# M19-W3 — single PostgreSQL backup + bounded rotation.
#
# Runs inside the `backup` sidecar (postgres image, so pg_dump matches the
# server major version). Produces a custom-format dump that pg_restore can
# replay selectively. backup-cycle.sh owns paired retention + health state.
#
# Never prints credentials; connection settings come from the standard PG*
# environment variables. Deletion is strictly limited to the campusos-*.dump
# pattern inside BACKUP_DIR — nothing else is ever removed.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-campusos}"
PGDATABASE="${PGDATABASE:-campusos}"
export PGHOST PGPORT PGUSER PGDATABASE

mkdir -p "$BACKUP_DIR"

STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
TMP="$BACKUP_DIR/.campusos-$STAMP.dump.partial"
OUT="$BACKUP_DIR/campusos-$STAMP.dump"

# Write to a dotfile first, rename on success — a crashed dump can never be
# mistaken for a valid backup (freshness checks ignore .partial files).
pg_dump --format=custom --file="$TMP"
# Structural validity gate: pg_restore must be able to read the TOC.
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$OUT"
echo "backup: wrote $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
