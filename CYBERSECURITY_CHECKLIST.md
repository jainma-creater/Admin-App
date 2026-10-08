# Cybersecurity Checklist — Branch Visit Inspection

Reviewed against the production stack (FastAPI + Next.js 14 + Expo/RN +
PostgreSQL 16 + Redis 7 + nginx). Each item says where it is implemented and
whether it applies (✅ done / ⬜ to-do / ℹ️ by design).

---

## 1. Authentication
- ✅ **Password hashing** — `bcrypt` (core/security.py); admin/bootstrap users
  also Argon2id-ready pattern from backend `get_password_hash`.
- ✅ **JWT access tokens** — short-lived (30 min default), HS256.
- ✅ **Refresh token rotation** — refresh tokens rotated and **revoked in
  Redis** on reuse (auth.py).
- ✅ **Logout invalidates token** — refresh token blacklist via Redis.
- ✅ **Self-escalation blocked** — `PATCH /users/me` strips `role_ids` and
  `is_active` (users.py:37-40).
- ⬜ **Account lockout** — 3 failed logins / 30 min is implemented in
  `auth.py` (verify rate-limit blocklist policy is `redis` in prod). Test it
  pre-launch.
- ⬜ **Rate limiting** — rely on nginx `limit_req` in prod (optional) for
  brute force on `/api/v1/auth/login`. (slowapi is NOT a dependency here.)

## 2. Authorization (RBAC)
- ✅ **8 roles** seed to ~38 granular permissions (`core/permissions.py`).
- ✅ **Scope enforcement** — `can_access_branch()` / `branch_scope_filter()` in
  `api/deps.py`: BRANCH_MANAGER / AREA_MANAGER / REGIONAL_ADMIN can only touch
  their mapped Branch / Area / Region (user.region_id/area_id/branch_id).
- ✅ **Role/permission endpoints gated** — `roles.py` now requires
  `Permission.READ_USER` (previously auth-only).
- ✅ **Super-admin-only** reset/wipe endpoints (`is_super_admin`).
- ⬜ **Review every router** — grep for `Depends(get_current_user)` vs
  `require_permission(...)`; ensure create/update/delete on branches,
  checklists, assets also enforce DELETE/UPDATE perms where intended.

## 3. Photo evidence storage
- ✅ **PostgreSQL is the source of truth** — `photo_blobs` bytea
  (data + thumbnail + mime_type), FK→photos ON DELETE CASCADE
  (`storage_mode=postgres`, production default).
- ✅ **No raw photo ever hits local disk in prod** (no upload dir).
- ✅ **Legacy object-storage read-back** is opt-in via MINIO env vars; unset in
  fresh prod = no external calls.
- ✅ **Upload validation** — size cap (`MAX_PHOTO_SIZE_MB`), mime/content
  sniffing, HEIC/JPEG/PNG conversion in `utils/photos.py`-style helpers.
- ⬜ **Anti-malware** — photos are re-encoded to JPEG thumbnails; consider a
  virus-scan hook (e.g. clamav) if untrusted uploads increase.

## 4. Transport security
- ✅ **TLS 1.2+ only**, secure cipher list, HSTS + preload (nginx prod conf).
- ✅ **Security headers** — nginx + FastAPI middleware set
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, `Content-Security-Policy` (backend, when
  `ENVIRONMENT=production`).
- ✅ **CORS locked** — `CORS_ORIGINS` env lists exact origins; no wildcard.
- ⬜ HSTS preload submission must be done knowingly (keep, docs).

## 5. Secrets & configuration
- ✅ **No secrets in code** — JWT/DB/admin passwords come from env only.
- ✅ **Scratch creds removed** — `.dbg_token`, `login.json`, `temp*.json`
  deleted from repo root this hardening pass.
- ⬜ **Secrets manager** — production uses `.env.prod` (file perms: `chmod 600`).
  Upgrade path: SSM Parameter Store / Secrets Manager if multi-admin.
- ✅ **Logout/rotate on breach** — change `JWT_SECRET` to force global re-auth.

## 6. API hardening
- ✅ **Deterministic errors** — FastAPI validation messages; no stack traces to
  clients (500s are generic in prod).
- ✅ **Audit trail** — `AuditLogger` records user/entity/action; `audit-logs`
  UI + `/vanish` wipe is super-admin only.
- ⬜ **Disable interactive docs in prod** — `DOCS_ENABLED=false` is set in the
  prod compose (✅ default in `docker-compose.prod.yml`).
- ⬜ Add a **request body size guard** at nginx (`client_max_body_size 50M` ✅).

## 7. Data protection (GDPR-style hygiene)
- ✅ `vanish_data.py` wipes all business tables incl. `photo_blobs`, re-seeds a
  minimal role/permission/admin set.
- ✅ Backups are **pg_dump of the whole system** (photos included);
  S3 offsite optional (`deploy/backup.sh`).
- ⬜ Add **retention policy** (e.g. archive evidence older than X years).

## 8. Server hardening (AWS)
- ⬜ Security group: **22/80/443 only**.
- ⬜ SSH: key-only, no password; SSH user `ec2-user`, not `root`.
- ⬜ Disable public SSH for `root` (`PermitRootLogin no`).
- ⬜ `dnf update -y` regularly; install only `docker`, `nginx`, `certbot`.
- ⬜ Docker daemon access is root-gated (`usermod -aG docker ec2-user`).
- ⬜ Add **fail2ban** for SSH brute force (optional but cheap insurance).
- ⬜ Enable **EBS snapshots** daily (another backup layer).

## 9. Monitoring & incident response
- ⬜ Health probe: `/health` behind nginx; wire to CloudWatch alarm
  (`curl .../health`).
- ⬜ Log rotation — docker json-file `max-size 10m / max-file 3` (✅ in prod
  compose), plus journald.
- ⬜ Alert on: 5xx spike, disk > 80%, backup job failure (cron exit code).
- ✅ Restore path documented (`deploy/restore.sh`) — practice a drill.

## 10. App attestation summary
| Area | Status |
|---|---|
| Password hashing / rotation | ✅ bcrypt + refresh rotation + Redis blocklist |
| RBAC + scope mapping | ✅ 38 perms, branch/area/region scoping, roles gated |
| Evidence storage | ✅ PostgreSQL bytea (single source of truth) |
| Transport | ✅ TLS1.2+, HSTS, CSP, security headers |
| Secrets hygiene | ✅ env-only; scratch files purged |
| Backups | ✅ pg_dump covers photos; S3 optional |
| Docs in prod | ✅ disabled |
| Server hardening | ⬜ apply §8 on the EC2 |
| Monitoring | ⬜ add CloudWatch / cron alarms |