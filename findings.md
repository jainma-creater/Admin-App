# Findings (research log)

## Scope map (both codebases explored)
- App (C:\bv): backend FastAPI 0.115 (Python 3.12, async SQLAlchemy 2.0.35, Postgres asyncpg / MinIO / local), web Next.js 14.2.15 App Router (axios, react-query), mobile Expo SDK 57 / RN 0.86.
- Reference (C:\ActAI-Recruitment): FastAPI + Next.js 16, production on single EC2 with Docker Compose + ECR + nginx/certbot (ALB optional), Postgres 16, Redis 7, gunicorn 4 uvicorn workers, security headers + HSTS + CSP, slowapi rate limits, Argon2id via pwdlib, JWT HS256 access(60m)+refresh(7d) rotation + Redis blocklist, account lockout (3 fails/30min), uploads metadata-in-DB + bytes in S3 (SSE-AES256) w/ local fallback, backups via pg_dump → S3 with lifecycle. Admin org page = React Flow org tree + drawer + assign-manager drag.
- Deployment guide refs: AWS_PUSH_DEPLOY_GUIDE.md (EC2 AL2023, t3.xlarge, ports 22/80/443 only, docker user-data 2GB swap, secrets via .env, ECR push), deploy/DEPLOYMENT_GUIDE.md (nginx+certbot config, /opt/backup.sh → S3, 7-day retention), SECURITY.md (rate limits table).

## Bug: "Upload failed: Unsupported FormDataPart implementation"
- Thrown at `mobile/node_modules/expo/src/winter/fetch/convertFormData.ts` (~L76-78).
- Expo SDK 57 replaces global fetch with WinterCG fetch; `convertFormDataAsync` only supports string/Blob/objects-with-`bytes` — NOT RN `{uri, name, type}` parts.
- Broken path: `mobile/app/(app)/camera.tsx` ~L94-139 builds `new FormData()` + `form.append("file", {uri,name,type})` and uploads with global `fetch`.
- Working path: `mobile/lib/offline.ts` L357-371 builds SAME FormData but uploads via **axios** (XHR adapter) → succeeds.
- Fix: use axios in camera.tsx live upload (mirror offline.ts). Api instance `C:\bv\mobile\lib\api.ts`.

## Storage (current)
- `backend/app/models/photo.py`: Photo.storage_path String(500) — bytes in MinIO/S3/local disk, DB stores metadata only. Thumbnails via `get_thumbnail_key`.
- `backend/app/utils/storage.py`: ensure_bucket/put_object/get_object_bytes/delete_object/get_thumbnail_key; resolves MinIO vs local on first call; STORAGE_MODE auto|minio|local.
- Endpoints: `POST /visits/{id}/photos`, `POST /visits/{id}/assets/{id}/code-photo`, `POST /visits/{id}/it-assets/{row}/code-photo` — all accept `file: UploadFile=File(...)`, size gate 10MB, MIME gate, `_compress_image` → (compressed, out_mime, thumbnail), then `put_object`.
- Serving: `GET /photos/{id}/file` + `/thumbnail`, auth via `get_current_user_query` (Bearer or ?token=).
- config.py STORAGE_MODE auto|minio|local; MINIO_* vars reused for S3.

## RBAC / org model (current app)
- 8 roles: SUPER_ADMIN, ADMIN, HOD, REGIONAL_ADMIN, AREA_MANAGER, BRANCH_MANAGER, HR, AUDITOR. `core/permissions.py` ROLE_PERMISSIONS.
- User model has region_id/area_id/branch_id FK columns; `can_access_branch` + `branch_scope_filter` in api/deps.py.
- `web/app/(dashboard)/users/page.tsx` CreateUserModal sends only email/name/password/phone/role_ids — **no region/area/branch**, and no scope selection UI.
- `backend/app/api/roles.py` list/permissions endpoints have NO `require_permission` (any auth'd user can enumerate) — security gap to fix in Phase 4.
- `backend/app/api/users.py` has GET users, create (L83), patch, delete.

## Dead / suspicious code (from explore)
- Root scratch files with real creds/tokens: `.dbg_token`, `.dbg_visit`, `.dbg_photos.json`, `login.json` (plaintext admin creds), `.reset_out.json`, `.backend_pid`, `.dbg_*.json`, `.next-dev.log`, root `.next\trace`.
- `aioredis` dep unused. `mobile/app/(auth)/register.tsx` stub (TODO, always alerts). `backend/app/api/reviews.py` read-only duplicate-ish. `backend/app/admin_static/` SPA must ship. Alembic only 2 migrations (rest create_all). `.github/` empty.

## Deployment artifacts to create (Phase 5)
- `docker-compose.prod.yml` (exists, stale — has postgres/redis/backend + caddy only; needs web + postgres-photo storage + healthchecks).
- `deploy/aws.env.example`, `deploy/setup.sh`, `deploy/Caddyfile` or nginx conf, `deploy/backup.sh`, `deploy/AWS_DEPLOYMENT_GUIDE.md`, `deploy/CYBERSECURITY_CHECKLIST.md`.
- Pattern: single EC2 AL2023, docker compose, ports 22/80/443, certbot (or Caddy), pg_dump backup → S3, secrets via env, STORAGE_MODE=postgres.