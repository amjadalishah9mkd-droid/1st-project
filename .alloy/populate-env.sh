#!/usr/bin/env bash
# Idempotent env setup for CampusOS in Alloy sandboxes.
# Creates apps/api/.env if missing; never overwrites user-provided values.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="apps/api/.env"

ensure_key() {
  local key="$1"
  if ! grep -q "^${key}=..*" "$ENV_FILE" 2>/dev/null; then
    # Replace an empty assignment or append a fresh one.
    if grep -q "^${key}=$" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^${key}=$|${key}=$(openssl rand -hex 32)|" "$ENV_FILE"
    else
      echo "${key}=$(openssl rand -hex 32)" >> "$ENV_FILE"
    fi
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  {
    echo "DATABASE_URL=postgresql://campusos:campusos@127.0.0.1:5432/campusos"
    echo "API_PORT=4000"
    echo "SEED_DEMO=true"
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
    echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
    echo "FILE_URL_SECRET=$(openssl rand -hex 32)"
  } > "$ENV_FILE"
  echo "[populate-env] created $ENV_FILE"
else
  ensure_key JWT_ACCESS_SECRET
  ensure_key JWT_REFRESH_SECRET
  ensure_key FILE_URL_SECRET
  echo "[populate-env] $ENV_FILE present; missing keys filled"
fi
