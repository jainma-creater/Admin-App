# API Documentation

## Base URL
```
http://localhost:8000/api/v1
```

## Authentication

All endpoints (except `/auth/login`) require Authorization header:
```
Authorization: Bearer <access_token>
```

### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@company.com",
  "password": "change-this-password"
}
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl...",
  "token_type": "bearer"
}
```

### Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl..."
}
```

### Get Current User
```http
GET /users/me
```

### Change Password
```http
POST /auth/change-password
Content-Type: application/json

{
  "current_password": "oldpass",
  "new_password": "newpass123"
}
```

---

## Users & Roles

### List Users
```http
GET /users?skip=0&limit=50&search=john
```

### Create User
```http
POST /users
{
  "email": "user@company.com",
  "password": "securepass123",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+1234567890",
  "role_ids": ["role-uuid-1"],
  "region_id": "region-uuid",
  "area_id": "area-uuid",
  "branch_id": "branch-uuid"
}
```

### Get User
```http
GET /users/{user_id}
```

### Update User
```http
PATCH /users/{user_id}
{
  "first_name": "Jane",
  "is_active": true
}
```

### List Roles
```http
GET /roles
```

### Create Role
```http
POST /roles
{
  "name": "INSPECTOR",
  "description": "Field inspector",
  "permission_ids": ["perm-uuid-1", "perm-uuid-2"]
}
```

### List Permissions
```http
GET /permissions
```

---

## Organization Hierarchy

### Regions

```http
GET /regions
POST /regions
GET /regions/{region_id}
PATCH /regions/{region_id}
DELETE /regions/{region_id}
```

Payload:
```json
{
  "name": "Mumbai Region",
  "code": "MUM"
}
```

### Areas
```http
GET /areas?region_id={region_id}
POST /areas
GET /areas/{area_id}
PATCH /areas/{area_id}
DELETE /areas/{area_id}
```

Payload:
```json
{
  "name": "Andheri Area",
  "code": "AND",
  "region_id": "region-uuid"
}
```

### Branches
```http
GET /branches?area_id={area_id}&region_id={region_id}
POST /branches
GET /branches/{branch_id}
PATCH /branches/{branch_id}
DELETE /branches/{branch_id}
```

Payload:
```json
{
  "name": "Mumbai Andheri Branch",
  "code": "MUM-001",
  "region_id": "region-uuid",
  "area_id": "area-uuid",
  "address": "123 Main St",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "manager_id": "user-uuid"
}
```

---

## Visit Types

```http
GET /visit-types
POST /visit-types
GET /visit-types/{type_id}
PATCH /visit-types/{type_id}
DELETE /visit-types/{type_id}
```

Payload:
```json
{
  "name": "Quarterly Audit",
  "description": "Quarterly compliance audit",
  "is_active": true
}
```

---

## Visits

### List Visits
```http
GET /visits?status=IN_PROGRESS&branch_id={branch_id}&skip=0&limit=20
```

### Create Visit
```http
POST /visits
{
  "branch_id": "branch-uuid",
  "visit_type_id": "type-uuid",
  "template_id": "template-uuid",
  "scheduled_date": "2024-01-15",
  "priority": "HIGH",
  "instructions": "Check fire safety",
  "assignee_id": "user-uuid"
}
```

### Get Visit
```http
GET /visits/{visit_id}
```

### Update Visit
```http
PATCH /visits/{visit_id}
{
  "scheduled_date": "2024-01-20",
  "priority": "MEDIUM"
}
```

### Start Visit (DRAFT/ASSIGNED/SCHEDULED → IN_PROGRESS)
```http
POST /visits/{visit_id}/start
```

### Submit Visit (IN_PROGRESS → SUBMITTED)
```http
POST /visits/{visit_id}/submit
```

### Start Review (SUBMITTED → UNDER_REVIEW)
```http
POST /visits/{visit_id}/review
```

### Approve Visit (UNDER_REVIEW → APPROVED)
```http
POST /visits/{visit_id}/approve
```

### Reject Visit (UNDER_REVIEW → REJECTED)
```http
POST /visits/{visit_id}/reject
{
  "comments": "Failed fire safety check"
}
```

### Mark All Checklist Items OK
```http
POST /visits/{visit_id}/checklist/mark-all-ok
```

### Delete Visit (DRAFT only)
```http
DELETE /visits/{visit_id}
```

### My Visits (for mobile)
```http
GET /visits/my
```

---

## Visit Checklist

### Get Checklist for Visit
```http
GET /visits/{visit_id}/checklist
```

Response includes:
- Template sections and items
- Current responses (status, remark, photos)
- Progress counts

### Update Checklist Item Response
```http
PATCH /visits/{visit_id}/checklist/items/{item_id}
{
  "status": "NOT_OK",
  "remark": "Fire extinguisher expired",
  "observation": "Expired 6 months ago",
  "action_required": "Replace immediately",
  "photo_uris": ["minio-presigned-url-1", "minio-presigned-url-2"]
}
```

Status values: `OK`, `NOT_OK`, `NA`

---

## Photos

### Upload Photo
```http
POST /visits/{visit_id}/photos
Content-Type: multipart/form-data

file: <binary>
checklist_item_id: "item-uuid" (optional)
```

### Get Photos for Visit
```http
GET /visits/{visit_id}/photos
```

### Get Presigned Upload URL
```http
POST /visits/{visit_id}/photos/presigned
{
  "filename": "photo.jpg",
  "content_type": "image/jpeg",
  "size_bytes": 1048576
}
```

### Delete Photo
```http
DELETE /visits/{visit_id}/photos/{photo_id}
```

---

## Checklist Templates (Builder)

### List Templates
```http
GET /checklists?published_only=true
```

### Create Template (Draft)
```http
POST /checklists
{
  "name": "Branch Safety Audit",
  "description": "Quarterly safety audit",
  "version": "1.0"
}
```

### Get Template
```http
GET /checklists/{template_id}
```

### Update Template
```http
PATCH /checklists/{template_id}
{
  "name": "Updated Name",
  "description": "New description"
}
```

### Publish Template (creates new version)
```http
POST /checklists/{template_id}/publish
{
  "version": "2.0",
  "changelog": "Added fire safety section"
}
```

### Duplicate Template
```http
POST /checklists/{template_id}/duplicate
{
  "name": "Copy of Branch Safety Audit"
}
```

### Delete Template (Draft only)
```http
DELETE /checklists/{template_id}
```

### Sections

```http
POST /checklists/{template_id}/sections
{
  "name": "Fire Safety",
  "description": "Fire safety checks",
  "order_index": 0
}

PATCH /checklists/{template_id}/sections/{section_id}
DELETE /checklists/{template_id}/sections/{section_id}
```

### Items

```http
POST /checklists/{template_id}/sections/{section_id}/items
{
  "name": "Fire Extinguisher Check",
  "description": "Verify extinguisher is charged and accessible",
  "order_index": 0,
  "is_required": true,
  "requires_photo_on_fail": true
}

PATCH /checklists/{template_id}/items/{item_id}
DELETE /checklists/{template_id}/items/{item_id}
```

---

## Corrective Actions

### List Actions
```http
GET /actions?visit_id={visit_id}&status=OPEN
```

### Create Action
```http
POST /visits/{visit_id}/actions
{
  "title": "Replace Fire Extinguisher",
  "description": "Expired extinguisher in lobby",
  "assignee_id": "user-uuid",
  "due_date": "2024-02-01",
  "priority": "HIGH"
}
```

### Get Action
```http
GET /actions/{action_id}
```

### Update Action
```http
PATCH /actions/{action_id}
{
  "status": "IN_PROGRESS",
  "resolution": "Ordered new extinguisher"
}
```

### Delete Action
```http
DELETE /actions/{action_id}
```

---

## Reports

### Get Visit Report
```http
GET /reports/visits/{visit_id}
```

### Export Report as CSV
```http
GET /reports/visits/{visit_id}/export
```
Returns: `text/csv` attachment

---

## Dashboard

### Overview Stats
```http
GET /dashboard
```

Response:
```json
{
  "total_visits": 150,
  "visits_by_status": {
    "DRAFT": 10,
    "IN_PROGRESS": 5,
    "SUBMITTED": 3,
    "UNDER_REVIEW": 2,
    "APPROVED": 120,
    "CLOSED": 8
  },
  "compliance_trend": [...],
  "overdue_actions": 4
}
```

### Audit Logs
```http
GET /dashboard/audit-logs?skip=0&limit=50
```

---

## Error Responses

All errors follow this format:
```json
{
  "detail": "Error message",
  "code": "ERROR_CODE"
}
```

Common HTTP status codes:
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/expired token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (state transition invalid)
- `422` - Unprocessable Entity (validation)
- `500` - Internal Server Error

---

## State Transition Errors

Invalid transitions return 409:
```json
{
  "detail": "Invalid state transition from SUBMITTED to APPROVED. Must go through UNDER_REVIEW.",
  "code": "INVALID_TRANSITION"
}
```