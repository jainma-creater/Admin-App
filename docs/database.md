# Database Schema Documentation

## Overview

PostgreSQL 16 database with SQLAlchemy 2.0 ORM models. All tables use UUID primary keys with `gen_random_uuid()`.

## Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   regions   │ 1:N   │    areas    │ 1:N   │   branches  │
├─────────────┤◄──────┤─────────────┤◄──────┤─────────────┤
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ name        │       │ name        │       │ name        │
│ code        │       │ code        │       │ code        │
│ created_at  │       │ region_idFK │       │ region_idFK │
│ updated_at  │       │ area_idFK   │       │ area_idFK   │
│ created_byFK│       │ created_byFK│       │ address     │
└─────────────┘       └─────────────┘       │ city        │
                                            │ state       │
                                            │ pincode     │
                                            │ manager_idFK│
                                            │ created_byFK│
                                            └─────────────┘
                                                   │
                                                   │ 1:N
                                                   ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    users    │       │    roles    │       │ permissions │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ email       │       │ name        │       │ name        │
│ phone       │       │ description │       │ description │
│ first_name  │       │ is_system   │       └─────────────┘
│ last_name   │       └──────┬──────┘              ▲
│ hashed_pwd  │              │                     │
│ is_active   │              │ N:M                 │ N:M
│ is_superuser│              ▼                     │
│ region_idFK │       ┌─────────────┐              │
│ area_idFK   │       │ role_perms  │              │
│ branch_idFK │       ├─────────────┤              │
│ created_byFK│       │ role_id FK  │              │
└─────────────┘       │ perm_id FK  │              │
       │              └─────────────┘              │
       │                     ▲                     │
       │ N:M                 │                     │
       ▼                     │                     │
┌─────────────┐              │                     │
│ user_roles  │              │                     │
├─────────────┤              │                     │
│ user_id FK  │              │                     │
│ role_id FK  │              │                     │
└─────────────┘              │                     │
                             ▼                     ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ visit_types │       │    visits   │       │  templates  │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ name        │       │ branch_idFK │       │ name        │
│ description │       │ type_idFK   │       │ description │
│ is_active   │       │ templateFK  │       │ version     │
└─────────────┘       │ status      │       │ is_published│
       │ 1:N          │ scheduled   │       │ created_byFK│
       ▼              │ assigneeFK  │       └──────┬──────┘
                 ┌─────────────┐            1:N   │
                 │ template_v  │◄─────────────────┘
                 ├─────────────┤
                 │ template_id │
                 │ version     │
                 │ changelog   │
                 │ published_at│
                 └─────────────┘
```

## Core Tables

### regions
```sql
CREATE TABLE regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
```

### areas
```sql
CREATE TABLE areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) NOT NULL,
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(region_id, code)
);
```

### branches
```sql
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(20) NOT NULL,
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    address VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),
    gst_number VARCHAR(50),
    cin_number VARCHAR(50),
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    branch_type VARCHAR(50) DEFAULT 'STANDALONE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(area_id, code)
);
```

### users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_superuser BOOLEAN DEFAULT FALSE,
    region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
    area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    fcm_token VARCHAR(255),
    device_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
```

### roles
```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### permissions
```sql
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### user_roles (junction)
```sql
CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);
```

### role_permissions (junction)
```sql
CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
```

### visit_types
```sql
CREATE TABLE visit_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### checklists (templates)
```sql
CREATE TABLE checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    version VARCHAR(20) NOT NULL,
    is_published BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
```

### checklist_sections
```sql
CREATE TABLE checklist_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### checklist_items
```sql
CREATE TABLE checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id UUID NOT NULL REFERENCES checklist_sections(id) ON DELETE CASCADE,
    name VARCHAR(300) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    is_required BOOLEAN DEFAULT TRUE,
    requires_photo_on_fail BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### visits
```sql
CREATE TABLE visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    visit_type_id UUID NOT NULL REFERENCES visit_types(id) ON DELETE CASCADE,
    template_id UUID REFERENCES checklists(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    scheduled_date DATE,
    started_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    instructions TEXT,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    compliance_percentage NUMERIC(5,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
```

### visit_checklist_items (responses)
```sql
CREATE TABLE visit_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    checklist_item_id UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
    status VARCHAR(20),  -- OK, NOT_OK, NA
    remark TEXT,
    observation TEXT,
    action_required TEXT,
    photos JSONB DEFAULT '[]'::jsonb,
    answered_at TIMESTAMPTZ,
    answered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(visit_id, checklist_item_id)
);
```

### photos
```sql
CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    checklist_item_id UUID REFERENCES visit_checklist_items(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    minio_object_name VARCHAR(500) NOT NULL,
    thumbnail_object_name VARCHAR(500),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### corrective_actions
```sql
CREATE TABLE corrective_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    action_required TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    responsible_person_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_date DATE,
    completed_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
```

### audit_logs
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### refresh_tokens
```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(512) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### template_versions
```sql
CREATE TABLE template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    version VARCHAR(20) NOT NULL,
    changelog TEXT,
    snapshot JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(template_id, version)
);
```

## Indexes

Key indexes for query performance:
```sql
-- Branches
CREATE INDEX idx_branches_region ON branches(region_id);
CREATE INDEX idx_branches_area ON branches(area_id);
CREATE INDEX idx_branches_manager ON branches(manager_id);
CREATE INDEX idx_branches_active ON branches(is_active);

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_branch ON users(branch_id);
CREATE INDEX idx_users_region ON users(region_id);
CREATE INDEX idx_users_area ON users(area_id);

-- Visits
CREATE INDEX idx_visits_branch ON visits(branch_id);
CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_assignee ON visits(assignee_id);
CREATE INDEX idx_visits_scheduled ON visits(scheduled_date);
CREATE INDEX idx_visits_template ON visits(template_id);

-- Visit Checklist Items
CREATE INDEX idx_vci_visit ON visit_checklist_items(visit_id);
CREATE INDEX idx_vci_item ON visit_checklist_items(checklist_item_id);

-- Photos
CREATE INDEX idx_photos_visit ON photos(visit_id);

-- Actions
CREATE INDEX idx_actions_visit ON corrective_actions(visit_id);
CREATE INDEX idx_actions_status ON corrective_actions(status);
CREATE INDEX idx_actions_assignee ON corrective_actions(responsible_person_id);

-- Audit Logs
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- Refresh Tokens
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_token ON refresh_tokens(token);
```

## Default Data (Seeded)

### Roles (8)
- SUPER_ADMIN - Full system access
- ADMIN - Regional admin
- SUPERVISOR - Review visits, manage actions
- INSPECTOR - Create/conduct visits
- VIEWER - Read-only access
- BRANCH_MANAGER - Branch-level operations
- AREA_MANAGER - Area-level operations
- REGIONAL_MANAGER - Region-level operations

### Permissions (25+)
- CREATE_VISIT, READ_VISIT, UPDATE_VISIT, DELETE_VISIT
- APPROVE_VISIT, REJECT_VISIT, REVIEW_VISIT
- CREATE_BRANCH, READ_BRANCH, UPDATE_BRANCH, DELETE_BRANCH
- CREATE_TEMPLATE, READ_TEMPLATE, UPDATE_TEMPLATE, DELETE_TEMPLATE, PUBLISH_TEMPLATE
- CREATE_ACTION, READ_ACTION, UPDATE_ACTION, DELETE_ACTION
- UPLOAD_PHOTO, READ_PHOTO, DELETE_PHOTO
- EXPORT_REPORT
- MANAGE_USERS, MANAGE_ROLES

### Visit Types (4)
- Quarterly Audit
- Monthly Inspection
- Surprise Visit
- Compliance Review

### Checklist Template (1)
- "Branch Visit Checklist v1.0" - 8 sections, 54 items from SOP doc

## Migrations

```bash
# Create migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Downgrade
alembic downgrade -1

# Current revision
alembic current
```

## Connection Pooling

Configured in `core/database.py`:
- Pool size: 20
- Max overflow: 10
- Pre-ping: true
- Pool recycle: 3600s