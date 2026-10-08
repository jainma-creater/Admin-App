# Branch Visit Inspection & Compliance Management System

Full-stack platform for managing branch audits based on the **Regional Admin Branch Visit SOP**.

- **Backend** — FastAPI (async) + PostgreSQL + MinIO object storage
- **Mobile** — React Native / Expo (inspectors in the field)
- **Web** — Next.js 14 / Tailwind CSS (admin & review dashboard)
- **Infra** — Docker Compose (Postgres, Redis, MinIO, Nginx)

---

## Features

| Feature | Description |
|---------|-------------|
| Dynamic Checklist | 8 SOP sections, 54 items with status (OK / NOT_OK / NA) and conditional required fields (remark, action, responsible, target date) |
| Photo Evidence | In-app camera → client-side compression → MinIO upload with presigned URLs |
| Visit Workflow | DRAFT → ASSIGNED → SCHEDULED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED → CLOSED (with REWORK_REQUIRED loop) |
| Corrective Actions | Per-item action items with verify, evidence attachment, and overdue tracking |
| RBAC | 8 roles with per-action permission enforcement and branch-level data scoping |
| Dashboard | Real-time charts (compliance %, status counts, regional breakdown) via Recharts |
| Reports | Full visit report with section summaries + CSV export |
| **Offline Mode** | Expo SQLite (WAL) queue with auto-sync, conflict resolution, pending count badge |
| **Settings Page** | Profile edit, password change, account info |
| **Audit Logs** | Immutable activity log with filters |
| **Visit Summary** | Pre-submit validation (incomplete items, missing photos) |

---

## Quick Start (Docker)

```bash
# Clone & start all services
git clone <repo-url>
cd "Branch Visit Inspection, Photo Evidence & Compliance Management System"
cp .env.example .env
# Edit .env with secure values (JWT_SECRET, passwords)
docker compose up -d
```

Services available at:
- **Web Admin**: http://localhost:3000
- **API**: http://localhost:8000/docs
- **MinIO Console**: http://localhost:9001

Run the mobile app:

```bash
cd mobile
npm install
npx expo start
```

Default credentials: `admin@company.com` / `change-this-password`

---

## Default Credentials

| Email | Password | Role |
|-------|----------|------|
| `admin@company.com` | `change-this-password` | SUPER_ADMIN |

---

## Backend API

Base URL: `http://localhost:8000/api/v1`

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login, returns access + refresh tokens |
| GET | `/users/me` | Current user profile |
| GET | `/branches` | List branches |
| POST | `/visits` | Create a visit |
| POST | `/visits/{id}/start` | Start visit (IN_PROGRESS) |
| POST | `/visits/{id}/submit` | Submit completed checklist |
| POST | `/visits/{id}/review` | Begin review (UNDER_REVIEW) |
| POST | `/visits/{id}/approve` | Approve visit |
| POST | `/visits/{id}/reject` | Reject with comments |
| POST | `/visits/{id}/close` | Close approved visit |
| GET | `/visits/{id}/checklist` | Full checklist with template + responses |
| PATCH | `/visits/{id}/checklist/items/{item_id}` | Update item response |
| POST | `/visits/{id}/photos` | Upload photo evidence |
| POST | `/actions` | Create corrective action |
| GET | `/reports/visits/{id}` | Full visit report |
| GET | `/reports/visits/{id}/export` | CSV export |
| GET | `/dashboard` | Dashboard summary cards |

Full interactive docs: `http://localhost:8000/docs`

---

## Visit State Machine

```
DRAFT → ASSIGNED → SCHEDULED → IN_PROGRESS → SUBMITTED
    ↓                                        ↓
  CANCELLED                         UNDER_REVIEW
                                        ↓    ↓
                                    APPROVED  REJECTED
                                        ↓        ↓
                                    CLOSED   REWORK_REQUIRED
                                                    ↓
                                             RESUBMITTED → UNDER_REVIEW
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://bv_user:bv_password@localhost:5432/bv_inspection` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis cache |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO endpoint |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO secret key |
| `MINIO_BUCKET` | `bv-photos` | Bucket name |
| `JWT_SECRET` | `your-secret-key-change-in-production` | JWT signing key |
| `SUPER_ADMIN_EMAIL` | `admin@company.com` | Seed admin email |
| `SUPER_ADMIN_PASSWORD` | `change-this-password` | Seed admin password |

---

## Running Tests

Requires PostgreSQL on port 5434:

```bash
# Start test DB
docker run -d --name bv-test-db -e POSTGRES_USER=bv_user -e POSTGRES_PASSWORD=bv_password -e POSTGRES_DB=bv_test -p 5434:5432 postgres:16-alpine

cd backend
TEST_DATABASE_URL=postgresql+asyncpg://bv_user:bv_password@localhost:5434/bv_test pytest -q
```

---

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI routers (auth, users, visits, photos, actions, reports, dashboard)
│   │   ├── core/         # Config, database, JWT security, RBAC permissions
│   │   ├── models/       # SQLAlchemy models (user, org, checklist, visit, photo, action, misc)
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Visit state machine
│   │   └── utils/        # Storage (MinIO), audit logging, seed data
│   ├── tests/            # pytest + httpx integration tests
│   ├── seed.py           # CLI seed runner
│   └── requirements.txt
├── mobile/               # React Native / Expo app
├── web/                  # Next.js 14 admin dashboard
├── infrastructure/       # Nginx config
├── docker-compose.yml
└── docs/                 # Architecture, API, database, deployment docs
```

---

## License

Internal use only.
