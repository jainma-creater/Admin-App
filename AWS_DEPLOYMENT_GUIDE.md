# Branch Visit Inspection — AWS Deployment Guide (Amazon Linux 2023)

Deploys the full stack on a **single EC2 instance**: PostgreSQL 16, Redis 7,
FastAPI backend (gunicorn + 4 uvicorn workers), Next.js web app, and nginx
(TLS via Let's Encrypt certbot).

**Photo evidence is stored inside PostgreSQL** (`photo_blobs` bytea table), so
the database is the single source of truth — a `pg_dump` backs up the entire
business including every photo.

---

## 1. Architecture

```
                       ┌─────────────────────── nginx (:80/:443) ────────┐
  Browser / Mobile →    /api/*     → backend (FastAPI, :8000, 4 workers)  │
                        /          → web (Next.js :3000)                  │
                        /health    → backend                              │
                       └───────────────┬──────────────────────────────────┘
                                       │
                 ┌──────────┬──────────┴──────────┬─────────────┐
               postgres:5432    redis:6379     (photo_blobs)   data volume
```

- Only **22 (SSH)**, **80**, **443** are open on the security group.
- Backend/DB/Redis have **no public ports**; the docker network is internal.
- Next.js talks to the API via same-origin `/api/v1` (nginx proxy).

## 2. Recommended instance sizing

| Traffic | Type | vCPU | RAM | gp3 disk | Notes |
|---|---|---|---|---|---|
| Pilot / demo | t3.medium | 2 | 4 GB | 30 GB | enough for a region |
| Production | t3.large | 2 | 8 GB | 100+ GB | photos live in Postgres — size disk for growth |
| Heavy | c6i.large / m6i.large | 2 | 8 GB | 200+ GB | |

Health: `curl https://<domain>/health` → `{"status":"healthy"}`.

## 3. AWS setup

1. Launch EC2 **Amazon Linux 2023** in a VPC with a public subnet + public IP.
2. Security group **inbound only**: SSH 22 (your IP), HTTP 80, HTTPS 443.
3. (Optional but recommended) Elastic IP so the DNS record never changes.
4. Create a DNS **A record** (`branchvisits.example.com → EC2 public IP`).
5. Optional S3 bucket for **off-site backups** (see `deploy/backup.sh`).
6. SSH key pair `.pem`; connect: `ssh -i your.pem ec2-user@<public-ip>`.

## 4. Get the code

```bash
sudo dnf update -y
sudo dnf install -y git
sudo mkdir -p /opt/branchvisit && sudo chown ec2-user:ec2-user /opt/branchvisit
cd /opt/branchvisit
git clone <your-repo-url> .      # or upload the code archive
```

## 5. One-shot bootstrap (recommended)

```bash
sudo bash deploy/setup.sh
```

The script installs Docker, generates all secrets into `.env.prod`, builds and
starts the stack, runs `alembic upgrade head` + `python seed.py` (creates the
super admin), and issues a Let's Encrypt certificate for `$DOMAIN`.

## 6. Manual install (if you prefer step-by-step)

```bash
# Docker
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user        # log out / back in after this

# Environment (NEVER commit real secrets)
cd /opt/branchvisit
cp deploy/aws.env.example .env.prod
vi .env.prod   # set DOMAIN, JWT_SECRET, POSTGRES_PASSWORD, SUPER_ADMIN_*

# Build & start
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Migrations + seed (idempotent — safe to re-run)
docker compose -f docker-compose.prod.yml exec -T backend sh -c "alembic upgrade head && python seed.py"
```

Set `SEED_DEMO=false` in `.env.prod` to seed **only** permissions, roles and the
super admin — no demo org/visits.

## 7. TLS with Let's Encrypt

Certificates are mounted into the nginx container from `./data/certbot/conf`.

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo mkdir -p /opt/branchvisit/data/certbot/conf /opt/branchvisit/data/certbot/www
cd /opt/branchvisit
sudo certbot certonly --webroot -w data/certbot/www -d branchvisits.example.com \
  --agree-tos -m admin@branchvisits.example.com --non-interactive
sudo ln -sfn branchvisits.example.com data/certbot/conf/live/localhost
docker compose -f docker-compose.prod.yml restart nginx
```

`deploy/nginx.conf` hard-paths TLS certs to
`/etc/letsencrypt/live/<domain>/` inside the container; the symlink
`live/localhost` makes the mount location-agnostic.

**Auto-renew** (daily cron):

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'docker restart branchvisit_nginx'") | crontab -
```

## 8. Verify production

```bash
curl -I https://branchvisits.example.com              # 200 OK
curl -s https://branchvisits.example.com/health       # {"status":"healthy"}
curl -s https://branchvisits.example.com/api/v1/roles # 401 (docs/api gated)
```

Log in with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `.env.prod`,
then use ***Organization → Add User*** to create real users and map them to
Region / Area / Branch.

## 9. Backups (important — photos live in the DB)

```bash
sudo bash deploy/backup.sh                 # pg_dump → backups/*.sql.gz (kept 14 days)
sudo bash deploy/restore.sh backups/branchvisit_20260925_030001.sql.gz
```

Add S3 offsite backup by enabling the optional vars in `.env.prod`
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_BACKUPS`, `AWS_REGION`)
and installing the AWS CLI:

```bash
curl -s https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
```

## 10. Updating the app image

```bash
cd /opt/branchvisit
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head
```

## 11. Operations cheat-sheet

| Task | Command |
|---|---|
| Logs | `docker compose -f docker-compose.prod.yml logs -f` |
| Restart one | `docker compose -f docker-compose.prod.yml restart backend` |
| Stop all | `docker compose -f docker-compose.prod.yml down` |
| Reset (⚠ wipes data) | `docker compose -f docker-compose.prod.yml down -v && ... up -d --build` |
| Postgres shell | `docker exec -it branchvisit_db psql -U bv_user -d bv_inspection` |
| Disk usage | `docker system df` |

## 12. Cost snapshot (approx, ap-south-1)

| Item | Monthly (approx) |
|---|---|
| t3.medium EC2 (on-demand) | ~$30 |
| 30 GB gp3 | ~$3 |
| Elastic IP (attached) | free |
| Certbot TLS | free |
| **Total** | **~$33** |

## 13. Before go-live checklist

- [ ] DNS A record resolves; HTTPS green via SSL Labs (A+ target).
- [ ] Strong `JWT_SECRET`, `POSTGRES_PASSWORD`, `SUPER_ADMIN_PASSWORD` in `.env.prod`.
- [ ] `SEED_DEMO=false` — no demo data.
- [ ] Security group: only 22/80/443.
- [ ] Backup cron installed and a restore drill was done.
- [ ] Organization page populated: users mapped to Region/Area/Branch.
- [ ] Mobile app points `NEXT_PUBLIC_API_URL`/API base URL at `https://<domain>/api/v1`.
- [ ] `CYBERSECURITY_CHECKLIST.md` reviewed.