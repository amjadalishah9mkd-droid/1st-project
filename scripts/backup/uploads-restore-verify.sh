#!/usr/bin/env bash
# Verify and extract the newest uploads archive in a disposable directory.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/campusos}"
LATEST="$(ls -1t "$BACKUP_DIR"/campusos-uploads-*.tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  echo "uploads-restore-verify: FAIL — no uploads archive found" >&2
  exit 1
fi

tar -tzf "$LATEST" | while IFS= read -r member; do
  case "$member" in
    /*|../*|*/../*|*/..) echo "uploads-restore-verify: FAIL — unsafe archive member" >&2; exit 1 ;;
  esac
done

SCRATCH="$(mktemp -d /tmp/campusos-uploads-restore.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
tar -xzf "$LATEST" -C "$SCRATCH"
echo "uploads-restore-verify: PASS — archive extracted in scratch and removed"
