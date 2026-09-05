#!/usr/bin/env bash
# Healthy only when a complete DB/uploads cycle finished within 26h.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
BACKUP_HEALTH_FILE="${BACKUP_HEALTH_FILE:-$BACKUP_DIR/.backup-health}"
BACKUP_MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-93600}"

[ -r "$BACKUP_HEALTH_FILE" ] || exit 1
LAST="$(cat "$BACKUP_HEALTH_FILE")"
case "$LAST" in ""|*[!0-9]*) exit 1 ;; esac
case "$BACKUP_MAX_AGE_SECONDS" in ""|*[!0-9]*) exit 1 ;; esac
NOW="$(date -u +%s)"
AGE=$((NOW - LAST))
[ "$AGE" -ge 0 ] && [ "$AGE" -le "$BACKUP_MAX_AGE_SECONDS" ]
