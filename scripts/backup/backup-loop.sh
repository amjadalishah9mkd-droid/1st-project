#!/usr/bin/env bash
# M19-W3 — backup sidecar loop: one backup immediately on start, then one
# every BACKUP_INTERVAL_SECONDS (default 24h). A failed cycle logs and
# retries next cycle; it never crashes the sidecar.
set -u

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while true; do
  if bash "$SCRIPT_DIR/pg-backup.sh"; then
    echo "backup: cycle ok $(date -u +%FT%TZ)"
  else
    echo "backup: cycle FAILED $(date -u +%FT%TZ) — retrying next interval" >&2
  fi
  sleep "$INTERVAL"
done
