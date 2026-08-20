#!/usr/bin/env bash
# Idempotent env setup for CampusOS in Alloy sandboxes.
# Creates apps/api/.env if missing; never overwrites user-provided values.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="apps/api/.env"

if [ ! -f "$ENV_FILE" ]; then
  {
    echo "DATABASE_URL=postgresql://campusos:campusos@127.0.0.1:5432/campusos"
    echo "API_PORT=4000"
    echo "SEED_DEMO=true"
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
    echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
  } > "$ENV_FILE"
  echo "[populate-env] created $ENV_FILE"
else
  # Fill only missing keys; never touch existing values.
  grep -q '^JWT_ACCESS_SECRET=..*' "$ENV_FILE" || \
    sed -i "s|^JWT_ACCESS_SECRET=$|JWT_ACCESS_SECRET=$(openssl rand -hex 32)|" "$ENV_FILE" 2>/dev/null || \
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
  grep -q '^JWT_REFRESH_SECRET=..*' "$ENV_FILE" || \
    sed -i "s|^JWT_REFRESH_SECRET=$|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" "$ENV_FILE" 2>/dev/null || \
    echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
  echo "[populate-env] $ENV_FILE present; missing keys filled"
fi
