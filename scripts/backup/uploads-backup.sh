#!/usr/bin/env bash
# M22-W3 — one path-safe uploads archive, paired with the DB dump by the
# BACKUP_STAMP supplied by backup-cycle.sh. The source volume is mounted
# read-only in the sidecar; this script can never mutate live uploads.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"

if [ ! -d "$UPLOAD_DIR" ]; then
  echo "backup: FAIL — uploads directory is unavailable" >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"
TMP="$BACKUP_DIR/.campusos-uploads-$STAMP.tar.gz.partial"
OUT="$BACKUP_DIR/campusos-uploads-$STAMP.tar.gz"

tar -czf "$TMP" -C "$UPLOAD_DIR" .
tar -tzf "$TMP" > /dev/null
mv "$TMP" "$OUT"
echo "backup: wrote $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
