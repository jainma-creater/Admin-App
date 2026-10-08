# Deployment Guide

## Prerequisites

- Docker 24+ and Docker Compose 2+
- Git
- 4GB+ RAM available for containers
- Ports 80, 443, 3000, 8000, 5432, 6379, 9000, 9001 available

## Quick Start (Development)

```bash
# Clone repository
git clone <repo-url>
cd "Branch Visit Inspection, Photo Evidence & Compliance Management System"

# Copy environment template
cp .env.example .env

# Edit .env with your values (at minimum change defaults)
# - JWT_SECRET: generate with `openssl rand -hex 32`
# - SUPER_ADMIN_PASSWORD: strong password
# - Database passwords

# Start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f backend
docker compose logs -f web
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| nginx | 80, 443 | Reverse proxy, SSL termination |
| web | 3000 | Next.js admin dashboard |
| backend | 8000 | FastAPI REST API |
| postgres | 5432 | Primary database |
| redis | 6379 | Caching, sessions, rate limiting |
| minio | 9000 | S3-compatible object storage |
| minio-console | 9001 | MinIO admin UI |

## Environment Variables

Create `.env` from `.env.example`:

```bash
# Database
DATABASE_URL=postgresql+asyncpg://bv_user:bv_password@postgres:5432/bv_inspection
POSTGRES_USER=bv_user
POSTGRES_PASSWORD=bv_password
POSTGRES_DB=bv_inspection

# Redis
REDIS_URL=redis://redis:6379/0

# JWT (CHANGE IN PRODUCTION!)
JWT_SECRET=your-64-char-random-secret-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=branch-visit-photos
MINIO_SECURE=false

# App
APP_NAME="Branch Visit Inspection"
APP_URL=http://localhost:3000
API_URL=http://localhost:8000

# Super Admin (CHANGE IN PRODUCTION!)
SUPER_ADMIN_EMAIL=admin@company.com
SUPER_ADMIN_PASSWORD=change-this-password

# CORS
CORS_ORIGINS=["http://localhost:3000","http://localhost:8000"]

# Features
GPS_ENABLED=true
MAX_PHOTO_SIZE_MB=10
PHOTO_QUALITY=80
THUMBNAIL_SIZE=200

# Server-side photo compression (storage efficiency)
PHOTO_STORAGE_MAX_DIMENSION=1600
PHOTO_STORAGE_TARGET_KB=200
PHOTO_STORAGE_MIN_QUALITY=55
PHOTO_STORAGE_SKIP_IF_SMALLER=true
```

### Generate Secure Secrets

```bash
# JWT Secret (64 chars)
openssl rand -hex 32

# Database password
openssl rand -base64 32

# MinIO credentials
openssl rand -base64 24
```

## Production Deployment

### 1. Prepare Server

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker

# Add user to docker group
sudo usermod -aG docker $USER
# Log out and back in
```

### 2. Configure SSL (Let's Encrypt)

```bash
# Install certbot
sudo apt install -y certbot

# Get certificates
sudo certbot certonly --standalone -d yourdomain.com -d admin.yourdomain.com

# Certificates will be at /etc/letsencrypt/live/yourdomain.com/
```

### 3. Update Nginx Config

Edit `infrastructure/nginx/nginx.conf` for your domain and SSL paths.

### 4. Production .env

```bash
# Use strong unique values for all secrets
# Set MINIO_SECURE=true
# Set CORS_ORIGINS to your actual domains
# Use external managed PostgreSQL/Redis for HA
```

### 5. Deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 6. Run Migrations

```bash
docker compose exec backend alembic upgrade head
```

### 7. Seed Initial Data

```bash
docker compose exec backend python -m app.utils.seed
```

## Docker Compose Files

### docker-compose.yml (Development)
- All services with dev-friendly settings
- Volume mounts for hot reload
- Default passwords

### docker-compose.prod.yml (Production Override)
```yaml
services:
  backend:
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
    environment:
      - DATABASE_URL=postgresql+asyncpg://user:pass@managed-db:5432/db
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M

  web:
    environment:
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          memory: 512M

  postgres:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
    secrets:
      - db_password

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

## Health Checks

All services include health checks:

```bash
# Check all services
docker compose ps

# Individual checks
curl http://localhost:8000/health
curl http://localhost:3000/api/health
docker exec bv-postgres pg_isready -U bv_user
docker exec bv-redis redis-cli ping
```

## Backup & Restore

### Database Backup
```bash
# Backup
docker exec bv-postgres pg_dump -U bv_user bv_inspection > backup_$(date +%F).sql

# Restore
docker exec -i bv-postgres psql -U bv_user bv_inspection < backup_2024-01-15.sql
```

### MinIO Backup
```bash
# Using mc (MinIO client)
mc mirror local/branch-visit-photos /backup/photos/
```

### Full Backup Script
```bash
#!/bin/bash
# backup.sh
DATE=$(date +%F_%H-%M)
BACKUP_DIR="/backups/$DATE"
mkdir -p $BACKUP_DIR

# Database
docker exec bv-postgres pg_dump -U bv_user bv_inspection | gzip > $BACKUP_DIR/db.sql.gz

# MinIO
mc mirror local/branch-visit-photos $BACKUP_DIR/photos/

# Config
cp .env $BACKUP_DIR/
cp docker-compose.yml $BACKUP_DIR/

# Keep last 30 days
find /backups -type d -mtime +30 -exec rm -rf {} \;
```

## Scaling

### Horizontal Scaling (Backend)
```yaml
# docker-compose.prod.yml
services:
  backend:
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 1G
```

### Database Read Replicas
```yaml
services:
  postgres-replica:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
    command: >
      postgres -c wal_level=replica
      -c max_wal_senders=10
      -c hot_standby=on
    volumes:
      - pgdata-replica:/var/lib/postgresql/data
```

### Redis Cluster
```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-config-file nodes.conf
    # Use 6+ nodes for production cluster
```

## Monitoring

### Logs
```bash
# Centralized logging with Loki (add to compose)
services:
  loki:
    image: grafana/loki:2.9
    ports:
      - "3100:3100"
    volumes:
      - lokidata:/loki

  promtail:
    image: grafana/promtail:2.9
    volumes:
      - /var/log:/var/log
      - ./promtail-config.yml:/etc/promtail/config.yml
```

### Metrics (Prometheus)
```yaml
services:
  prometheus:
    image: prom/prometheus:v2.47
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - promdata:/prometheus
```

### Grafana Dashboards
Import community dashboards for:
- FastAPI (Python app metrics)
- PostgreSQL (DB performance)
- Redis (cache hit rates)
- Node Exporter (system metrics)

## Troubleshooting

### Backend Won't Start
```bash
# Check logs
docker compose logs backend

# Common issues:
# - Database not ready: check postgres health
# - Migration failed: docker compose exec backend alembic upgrade head
# - Port conflict: change port in compose
```

### Web Build Fails
```bash
# Clear cache and rebuild
docker compose build --no-cache web

# Check build logs
docker compose logs web
```

### Mobile Can't Connect
- Ensure `NEXT_PUBLIC_API_URL` in web matches backend URL
- For Android emulator: use `10.0.2.2:8000`
- For physical device: use machine LAN IP
- Check CORS_ORIGINS includes your origin

### Database Connection Issues
```bash
# Test connection
docker compose exec backend python -c "
from app.core.config import settings
print(settings.DATABASE_URL)
"

# Check pg_hba.conf for auth issues
docker exec -it bv-postgres psql -U bv_user -d bv_inspection
```

### MinIO Access Denied
```bash
# Check credentials
docker compose exec minio mc admin info local

# Recreate bucket
docker compose exec backend python -m app.utils.storage
```

## CI/CD Pipeline (GitHub Actions Example)

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports: [5432:5432]
      redis:
        image: redis:7
        ports: [6379:6379]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install backend deps
        run: pip install -r backend/requirements.txt
      - name: Run backend tests
        run: cd backend && pytest tests/ -v
      - name: Build web
        run: cd web && npm ci && npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /opt/branch-visit
            git pull
            docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
            docker compose exec backend alembic upgrade head
```

## Rollback

```bash
# Quick rollback to previous image
docker compose down
docker compose up -d --force-recreate

# Or specific version
docker compose pull backend:sha-abc123
docker compose up -d backend
```

## Security Checklist

- [ ] Change all default passwords in `.env`
- [ ] Use strong JWT_SECRET (64+ chars)
- [ ] Enable HTTPS with valid certificates
- [ ] Restrict CORS_ORIGINS to known domains
- [ ] Use managed database (RDS, Cloud SQL) with encryption
- [ ] Enable MinIO TLS (MINIO_SECURE=true)
- [ ] Configure firewall: only 80/443 public
- [ ] Set up fail2ban for SSH
- [ ] Regular security updates: `docker compose pull && docker compose up -d`
- [ ] Audit logs monitored for anomalies
- [ ] Backup encryption at rest
- [ ] API rate limiting enabled