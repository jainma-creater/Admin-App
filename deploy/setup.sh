#!/usr/bin/env bash
# =============================================================================
#  Branch Visit Inspection — AWS EC2 (Amazon Linux 2023) bootstrap script
#
#  What it does:
#    1. Installs Docker / Docker Compose
#    2. Generates missing secrets (JWT secret, admin + db passwords)
#    3. Copies deploy/aws.env.example -> .env.prod (if absent)
#    4. Builds images and starts the stack
#    5. Runs migrations + seeds roles/permissions/super admin
#    6. Installs nginx + certbot and issues a Let's Encrypt cert for $DOMAIN
#
#  Run as:  sudo bash deploy/setup.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
say()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[setup]${NC} $*"; }
err()  { echo -e "${RED}[setup][ERROR]${NC} $*"; exit 1; }

if [[ $EUID -ne 0 ]]; then err "Run with sudo: sudo bash deploy/setup.sh"; fi

# ---------- 1. Docker --------------------------------------------------------
if ! command -v docker &>/dev/null; then
  say "Installing Docker Engine (Amazon Linux 2023)..."
  dnf install -y docker >/dev/null
  systemctl enable --now docker
fi
if ! docker compose version &>/dev/null; then
  err "docker compose v2 plugin not found — install it (e.g. dnf install docker-compose-plugin)."
fi
say "Docker: $(docker --version) / Compose: $(docker compose version --short)"

# ---------- 2. Secrets (generate only missing ones) ---------------------------
if [[ ! -f .env.prod ]]; then
  say "Creating .env.prod from template and generating random secrets..."
  cp deploy/aws.env.example .env.prod

  JWT="$(openssl rand -hex 32)"
  DB_PW="$(openssl rand -base64 18 | tr -d '/+=')"
  ADMIN_PW="$(openssl rand -base64 18 | tr -d '/+=')"

  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|"            .env.prod
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_PW}|" .env.prod
  sed -i "s|^SUPER_ADMIN_PASSWORD=.*|SUPER_ADMIN_PASSWORD=${ADMIN_PW}|" .env.prod
  warn "Generated admin / db passwords — change SUPER_ADMIN_EMAIL in .env.prod if needed."
else
  say ".env.prod already exists — keeping it."
fi

# Export for compose variable substitution.
set -a; source .env.prod; set +a

# ---------- 3. Build & start ---------------------------------------------------
say "Building images and starting stack..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# ---------- 4. Wait for healthy backend ----------------------------------------
say "Waiting for backend health..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T backend \
      python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" &>/dev/null; then
    say "Backend healthy."
    break
  fi
  [[ $i -eq 30 ]] && err "Backend did not become healthy. See: docker compose logs backend"
  sleep 5
done

# Migrations + seed run inside the backend entrypoint, but run again explicitly
# so failures are visible here:
say "Running migrations + seed (idempotent)..."
docker compose -f docker-compose.prod.yml exec -T backend sh -c "alembic upgrade head && python seed.py"

# ---------- 5. Web ------------------------------------------------------------------
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3000 -o /dev/null; then say "Web is up on :3000."; break; fi
  [[ $i -eq 20 ]] && err "Web did not start. See: docker compose logs web"
  sleep 5
done

# ---------- 6. TLS via certbot (host nginx certs are mounted into the container) -----
if command -v certbot &>/dev/null || dnf list installed certbot &>/dev/null; then
  :
else
  warn "Installing nginx + certbot (used only to issue the TLS certificate)..."
  dnf install -y nginx certbot python3-certbot-nginx >/dev/null 2>&1 || \
    warn "certbot install skipped — install manually or use DNS validation."
fi

if [[ -n "${DOMAIN:-}" && "${DOMAIN}" != "branchvisits.example.com" ]]; then
  mkdir -p data/certbot/conf data/certbot/www
  if [[ ! -f "data/certbot/conf/live/${DOMAIN}/fullchain.pem" ]]; then
    say "Issuing TLS certificate for ${DOMAIN} (first run: all 5 requests per week...) "
    certbot certonly --webroot -w "$PWD/data/certbot/www" \
      -d "$DOMAIN" --agree-tos -m "admin@${DOMAIN}" --non-interactive || \
      warn "certbot issuance failed — run the AWS_DEPLOYMENT_GUIDE steps manually."
  fi
else
  warn "DOMAIN not set to a real hostname in .env.prod — skipping certbot (edit deploy/nginx.conf cert paths under /etc/letsencrypt/live/)."
fi
[ -f "data/certbot/conf/live/${DOMAIN}/fullchain.pem" ] && \
  ln -sfn "$DOMAIN" data/certbot/conf/live/localhost 2>/dev/null || true

# Restart nginx so it picks up the cert.
docker compose -f docker-compose.prod.yml restart nginx

# ---------- 7. Summary ---------------------------------------------------------------
say "All done."
echo
echo "  Website:            https://${DOMAIN:-<set DOMAIN in .env.prod>}"
echo "  Backend health:     https://${DOMAIN:-...}/health"
echo "  API docs:           disabled in production (DOCS_ENABLED=false)"
echo
echo "  Logs:     docker compose -f docker-compose.prod.yml logs -f"
echo "  Restart:  docker compose -f docker-compose.prod.yml restart"
echo "  Rebuild:  docker compose -f docker-compose.prod.yml up -d --build"
echo "  Backup:   sudo bash deploy/backup.sh"
echo
echo "  p.s. If a Let's Encrypt cert was issued, renew it daily via cron:"
echo "       0 3 * * * certbot renew --quiet --deploy-hook 'docker restart nginx'"