#!/usr/bin/env bash
# =============================================================================
#  Branch Visit Inspection — restore a backup
#
#  Usage:  sudo bash deploy/restore.sh backups/branchvisit_YYYYMMDD_HHMMSS.sql.gz
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env.prod; set +a

DUMP="${1:?usage: bash deploy/restore.sh <dump.sql.gz>}"
[[ -f "${DUMP}" ]] || { echo "[restore][ERROR] file not found: ${DUMP}"; exit 1; }

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

echo "[restore] Dropping and recreating schema from ${DUMP}"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-bv_user}" -d "${POSTGRES_DB:-bv_inspection}" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

gunzip -c "${DUMP}" | $COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-bv_user}" -d "${POSTGRES_DB:-bv_inspection}"

echo "[restore] Done. Restarting backend so it picks up the data."
$COMPOSE restart backend
echo "[restore] OK"