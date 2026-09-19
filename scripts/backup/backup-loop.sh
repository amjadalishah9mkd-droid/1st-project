#!/usr/bin/env bash
# M19-W3/M22-W3 — one complete DB/uploads pair immediately, then every 24h.
# Failed cycles retry after 5m rather than waiting a full day.
set -u

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETRY="${BACKUP_RETRY_SECONDS:-300}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while true; do
  if bash "$SCRIPT_DIR/backup-cycle.sh"; then
    echo "backup: cycle ok $(date -u +%FT%TZ)"
    sleep "$INTERVAL"
  else
    echo "backup: cycle FAILED $(date -u +%FT%TZ) — retrying in ${RETRY}s" >&2
    sleep "$RETRY"
  fi
done
