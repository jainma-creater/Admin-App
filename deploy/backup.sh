#!/usr/bin/env bash
# =============================================================================
#  Branch Visit Inspection — PostgreSQL backup
#
#  Photo evidence is stored in PostgreSQL (photo_blobs bytea), so a pg_dump
#  backs up the ENTIRE system (visits + evidence). Optionally upload dumps to
#  S3 when AWS credentials are configured in .env.prod.
#
#  Run manually:      sudo bash deploy/backup.sh
#  Cron (daily 0300): 0 3 * * * cd /opt/branchvisit && sudo bash deploy/backup.sh >> logs/backup.log 2>&1
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
set -a; source .env.prod; set +a

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="backups"
KEEP_DAILY=14
DUMP="${BACKUP_DIR}/branchvisit_${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup] dumping PostgreSQL -> ${DUMP}"
$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER:-bv_user}" "${POSTGRES_DB:-bv_inspection}" \
  --no-owner --no-privileges | gzip > "${DUMP}"

SIZE="$(du -h "${DUMP}" | cut -f1)"
echo "[backup] done (${SIZE})."

# Healthy dump sanity check (non-trivial gzip payload).
if ! gzip -t "${DUMP}" 2>/dev/null; then
  echo "[backup][ERROR] dump failed integrity check"; rm -f "${DUMP}"; exit 1
fi

# Prune old local dumps.
find "${BACKUP_DIR}" -name 'branchvisit_*.sql.gz' -mtime +"${KEEP_DAILY}" -delete
echo "[backup] pruned dumps older than ${KEEP_DAILY} days."

# Optional S3 offsite copy (set S3_BUCKET_BACKUPS + AWS_* in .env.prod).
if [[ -n "${S3_BUCKET_BACKUPS:-}" ]]; then
  if ! command -v aws &>/dev/null; then
    echo "[backup][WARN] aws cli not installed — skipping S3 upload."
  else
    aws s3 cp "${DUMP}" "s3://${S3_BUCKET_BACKUPS}/postgres/${DUMP##*/}" \
      --region "${AWS_REGION:-ap-south-1}" && echo "[backup] uploaded to S3."
  fi
fi

echo "[backup] OK: ${DUMP}"