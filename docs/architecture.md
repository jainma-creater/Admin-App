# Architecture Documentation

## System Overview

Branch Visit Inspection & Compliance Management System is a full-stack application for managing branch inspections with photo evidence and compliance tracking.

## Technology Stack

### Backend
- **Framework**: FastAPI (Python 3.12+)
- **Database**: PostgreSQL 16 with asyncpg
- **ORM**: SQLAlchemy 2.0 (async)
- **Auth**: JWT tokens with bcrypt password hashing
- **File Storage**: MinIO (S3-compatible)
- **Caching**: Redis 7
- **Migrations**: Alembic
- **Containerization**: Docker

### Web Admin (Next.js 14)
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State**: TanStack Query (React Query)
- **Auth**: Cookie-based JWT
- **Charts**: Recharts

### Mobile (React Native / Expo)
- **Framework**: Expo 52 with Expo Router 4
- **Language**: TypeScript
- **Navigation**: Expo Router (file-based)
- **State**: TanStack Query + Zustand
- **Auth**: Expo SecureStore + AsyncStorage
- **Offline**: expo-sqlite (WAL mode)
- **Camera**: expo-camera + expo-image-picker

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer (Nginx)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌───────────────┐ ┌───────────┐ ┌─────────────┐
│   Web Admin   │ │  Mobile   │ │   Backend   │
│  (Next.js)    │ │ (Expo)    │ │  (FastAPI)  │
└───────┬───────┘ └─────┬─────┘ └──────┬──────┘
        │               │              │
        └───────────────┼──────────────┘
                        ▼
        ┌──────────────────────────────────┐
        │         PostgreSQL 16            │
        │  ┌─────────┐ ┌─────────────────┐  │
        │  │ Primary │ │ Read Replica    │  │
        │  └─────────┘ └─────────────────┘  │
        └──────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌───────────────┐ ┌───────────┐ ┌─────────────┐
│    Redis      │ │   MinIO   │ │  MinIO      │
│   (Cache)     │ │ (Photos)  │ │ (Console)   │
└───────────────┘ └───────────┘ └─────────────┘
```

## Data Flow

1. **Authentication**: JWT tokens issued by backend, stored in cookies (web) / SecureStore (mobile)
2. **Visit Creation**: Admin creates visit → assigned to inspector → inspector starts visit
3. **Checklist Execution**: Inspector answers items (OK/NOT_OK/NA) → photos attached
4. **Submission**: Visit submitted → moves to UNDER_REVIEW
5. **Review**: Reviewer approves/rejects → if rejected → REWORK_REQUIRED
6. **Offline Sync**: Mobile queues changes in SQLite → syncs when online

## Visit State Machine

```
DRAFT → ASSIGNED → SCHEDULED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED → CLOSED
                    ↓                                    ↓
              (cancel)                               REJECTED → REWORK_REQUIRED
                                                                   ↓
                                                            IN_PROGRESS / RESUBMITTED
                                                                   ↓
                                                            UNDER_REVIEW
```

Allowed transitions (no direct SUBMITTED→APPROVED):
- DRAFT → ASSIGNED/SCHEDULED/IN_PROGRESS
- ASSIGNED → SCHEDULED/DRAFT
- SCHEDULED → IN_PROGRESS/ASSIGNED/DRAFT
- IN_PROGRESS → SUBMITTED/DRAFT
- SUBMITTED → UNDER_REVIEW/DRAFT
- UNDER_REVIEW → APPROVED/REJECTED/REWORK_REQUIRED
- REJECTED → REWORK_REQUIRED/UNDER_REVIEW
- REWORK_REQUIRED → IN_PROGRESS/RESUBMITTED
- RESUBMITTED → UNDER_REVIEW
- APPROVED → CLOSED

## Key Components

### Backend Models
- **Org Hierarchy**: Region → Area → Branch
- **Users**: Roles, permissions, org assignments
- **Visits**: Template-based, state machine
- **Checklists**: Template → Sections → Items (versioned)
- **Responses**: Per-visit item answers with photos
- **Actions**: Corrective actions linked to visits
- **Photos**: MinIO storage with presigned URLs
- **Audit Logs**: Immutable event log

### API Endpoints
- `/api/v1/auth/*` - Login, refresh, me, change-password
- `/api/v1/users/*` - User management, roles
- `/api/v1/branches/*` - Org hierarchy CRUD
- `/api/v1/visits/*` - Visit lifecycle, checklist, photos, actions
- `/api/v1/checklists/*` - Template builder with versioning
- `/api/v1/actions/*` - Corrective action management
- `/api/v1/photos/*` - Upload, presigned URLs, gallery
- `/api/v1/reports/*` - Visit reports, CSV export
- `/api/v1/dashboard/*` - Stats, audit logs

### Web Admin Pages
- Dashboard (stats, charts, recent activity)
- Visits (list, create, detail with review)
- Branches (CRUD with org hierarchy)
- Checklist Builder (template editor with drag-drop sections/items)
- Users & Roles (CRUD, permission matrix)
- Corrective Actions (list, filter, update)
- Evidence Gallery (photo browser with filters)
- Reports (visit reports with CSV export)
- Audit Logs (activity log)
- Settings (profile, password)

### Mobile Screens
- Dashboard (today's visits, stats)
- Visits (list with filters)
- Visit Detail (progress, start, review & submit)
- Checklist (sectioned items, inline editor)
- Camera (photo capture for NOT_OK items)
- Corrective Actions (list, create, update)
- Visit Summary (pre-submit validation)
- Profile (account info, logout)
- Offline Support (SQLite queue, auto-sync)

## Security

- **Authentication**: JWT with 30min access / 7day refresh tokens
- **Authorization**: Role-based (RBAC) + data scoping (region/area/branch)
- **Passwords**: bcrypt with cost factor 12
- **CORS**: Configurable origins
- **Rate Limiting**: Per-IP (Redis-backed)
- **File Upload**: Type validation, size limits, presigned URLs
- **Audit Trail**: All mutations logged

## Deployment

- **Docker Compose**: Single-command deployment
- **Services**: postgres, redis, minio, backend, web, nginx
- **Health Checks**: All services with readiness probes
- **Volumes**: Persistent data for postgres, redis, minio
- **Environment**: .env for secrets, .env.example documented

## Scalability Considerations

- Backend: Stateless, horizontal scaling via load balancer
- Database: Read replicas for reporting queries
- Cache: Redis cluster for session/caching
- Storage: MinIO distributed mode for HA
- Mobile: Offline-first reduces server dependency