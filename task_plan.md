# Production Readiness Plan — Branch Visit Inspection, Photo Evidence & Compliance

## Goal
Take the app (FastAPI + Next.js + Expo) from dev to **production-ready on AWS Linux**, modeled on the deployed `ActAI-Recruitment` (TalentPilot) reference:
1. Fix the live photo-upload bug on mobile ("Unsupported FormDataPart implementation", Expo SDK 57 WinterCG fetch).
2. Photos must be **saved in the database (PostgreSQL bytea)** — clicked from mobile → persisted to PG (plus optional S3 mode retained).
3. One **Organization page** to manage all users, all rights (roles), and map Branch / Area / Region to a user.
4. Optimize code + file structure; remove all dead code.
5. Cybersecurity checklist applied (secrets, headers, rate limiting, hardening, backups).
6. AWS Linux production deployment package + runbooks (docker-compose.prod.yml, deploy/, guides), taking patterns from ActAI-Recruitment.

## Key input requirements (user)
- "Upload failed: Unsupported FormDataPart implementation" → must be fixed.
- "which database are you using / use production database for photos / use PostgreSQL for production / click photos from mobile it should save in database".
- One organization page to manage all users + all rights + map branch/area/region to a user.
- Remove dead code, up-to-date code, smooth UI/UX design.
- Plan BEFORE deployment (this file + cybersecurity checklist).

## Decisions
- Keep dev stack (postgres/redis/minio/backend/web/nginx) but default prod = postgres (+ redis) + backend + web + caddy/nginx.
- Add `Photo` bytea storage mode `STORAGE_MODE=postgres` via new `photo_blobs` table (photo_id PK FK → photos). Rapid retry-safe, low risk; existing minio/s3/local modes untouched.
- Org page = new web `/organization` route (SUPER_ADMIN/ADMIN) with Users + Roles + Regions/Areas/Branches mapping, inspired by ActAI Recruitment's organization workspace but scoped to this app's RBAC (Region → Area → Branch → Manager).
- Mobile fix = route camera uploads through axios (XHR) like `lib/offline.ts` already does (proven path), not the broken WinterCG fetch.
- Migrations: extend alembic to cover new table instead of relying on create_all.

## Phases
- Phase 0 — Planning files (this). [in_progress]
- Phase 1 — Fix mobile photo upload (axios in camera.tsx + tsc + smoke). [pending]
- Phase 2 — PostgreSQL bytea photo storage (model, migration, storage layer, endpoints, compose.prod). [pending]
- Phase 3 — Organization page (backend: schemas/endpoints for scope mapping; web: /organization UI). [pending]
- Phase 4 — Dead code removal + cybersecurity checklist (delete scratch creds, aioredis, register stub, RBAC gaps, security headers, rate limit, docs-off in prod). [pending]
- Phase 5 — AWS Linux deploy package: docker-compose.prod.yml, deploy/ (env example, Caddyfile/nginx, setup.sh, backup script), guides (AWS_DEPLOYMENT_GUIDE.md, CYBERSECURITY_CHECKLIST.md). [pending]
- Phase 6 — Final verification: backend tests, web build (docker), mobile tsc, end-to-end photo→DB check. [pending]

## Next Step
Phase 1 — read `mobile/app/(app)/camera.tsx` upload fn + `mobile/lib/api.ts`, switch live upload to axios, update offline fallback, run tsc.