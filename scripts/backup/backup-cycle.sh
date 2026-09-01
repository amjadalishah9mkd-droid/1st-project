#!/usr/bin/env bash
# M22-W3 — publish freshness only after BOTH DB and uploads artifacts verify.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_HEALTH_FILE="${BACKUP_HEALTH_FILE:-$BACKUP_DIR/.backup-health}"
BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export BACKUP_DIR BACKUP_STAMP

case "$BACKUP_DIR" in
  ""|/) echo "backup: FAIL — unsafe BACKUP_DIR" >&2; exit 1 ;;
esac
case "$RETENTION_DAYS" in
  ""|*[!0-9]*) echo "backup: FAIL — RETENTION_DAYS must be an integer" >&2; exit 1 ;;
esac

cleanup_failed_cycle() {
  rm -f \
    "$BACKUP_DIR/campusos-$BACKUP_STAMP.dump" \
    "$BACKUP_DIR/.campusos-$BACKUP_STAMP.dump.partial" \
    "$BACKUP_DIR/campusos-uploads-$BACKUP_STAMP.tar.gz" \
    "$BACKUP_DIR/.campusos-uploads-$BACKUP_STAMP.tar.gz.partial"
}
trap cleanup_failed_cycle ERR

bash "$SCRIPT_DIR/pg-backup.sh"
bash "$SCRIPT_DIR/uploads-backup.sh"

# Rotate only after a complete new pair exists. Patterns are fixed and
# maxdepth-scoped; no unrelated file can be deleted.
find "$BACKUP_DIR" -maxdepth 1 -name 'campusos-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'campusos-uploads-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name '.campusos-*.partial' -mtime +1 -delete

HEALTH_TMP="$BACKUP_HEALTH_FILE.partial"
date -u +%s > "$HEALTH_TMP"
mv "$HEALTH_TMP" "$BACKUP_HEALTH_FILE"
trap - ERR
echo "backup: complete pair verified; retention pruned (> ${RETENTION_DAYS} days)"
