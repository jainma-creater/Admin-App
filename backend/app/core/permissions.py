from enum import Enum
from typing import List, Optional


class RoleName(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    HOD = "HOD"
    REGIONAL_ADMIN = "REGIONAL_ADMIN"
    AREA_MANAGER = "AREA_MANAGER"
    BRANCH_MANAGER = "BRANCH_MANAGER"
    HR = "HR"
    AUDITOR = "AUDITOR"


class Permission(str, Enum):
    # Users
    CREATE_USER = "CREATE_USER"
    READ_USER = "READ_USER"
    UPDATE_USER = "UPDATE_USER"
    DELETE_USER = "DELETE_USER"

    # Branches
    CREATE_BRANCH = "CREATE_BRANCH"
    READ_BRANCH = "READ_BRANCH"
    UPDATE_BRANCH = "UPDATE_BRANCH"
    DELETE_BRANCH = "DELETE_BRANCH"

    # Visits
    CREATE_VISIT = "CREATE_VISIT"
    READ_VISIT = "READ_VISIT"
    UPDATE_VISIT = "UPDATE_VISIT"
    DELETE_VISIT = "DELETE_VISIT"
    ASSIGN_VISIT = "ASSIGN_VISIT"
    SUBMIT_VISIT = "SUBMIT_VISIT"

    # Checklists
    CREATE_CHECKLIST = "CREATE_CHECKLIST"
    READ_CHECKLIST = "READ_CHECKLIST"
    UPDATE_CHECKLIST = "UPDATE_CHECKLIST"
    DELETE_CHECKLIST = "DELETE_CHECKLIST"
    RESPOND_CHECKLIST = "RESPOND_CHECKLIST"

    # Reviews
    REVIEW_VISIT = "REVIEW_VISIT"
    APPROVE_VISIT = "APPROVE_VISIT"
    REJECT_VISIT = "REJECT_VISIT"

    # Corrective Actions
    CREATE_ACTION = "CREATE_ACTION"
    UPDATE_ACTION = "UPDATE_ACTION"
    VERIFY_ACTION = "VERIFY_ACTION"

    # Reports
    VIEW_REPORT = "VIEW_REPORT"
    EXPORT_REPORT = "EXPORT_REPORT"

    # Dashboard
    VIEW_DASHBOARD = "VIEW_DASHBOARD"

    # Checklist Builder
    MANAGE_CHECKLISTS = "MANAGE_CHECKLISTS"

    # Audit
    VIEW_AUDIT_LOG = "VIEW_AUDIT_LOG"


ROLE_PERMISSIONS: dict[str, List[Permission]] = {
    RoleName.SUPER_ADMIN: list(Permission),
    RoleName.ADMIN: [
        Permission.CREATE_USER, Permission.READ_USER, Permission.UPDATE_USER,
        Permission.CREATE_BRANCH, Permission.READ_BRANCH, Permission.UPDATE_BRANCH,
        Permission.CREATE_VISIT, Permission.READ_VISIT, Permission.UPDATE_VISIT,
        Permission.ASSIGN_VISIT, Permission.REVIEW_VISIT, Permission.APPROVE_VISIT,
        Permission.MANAGE_CHECKLISTS, Permission.VIEW_DASHBOARD,
        Permission.VIEW_REPORT, Permission.EXPORT_REPORT, Permission.VIEW_AUDIT_LOG,
        Permission.CREATE_ACTION, Permission.UPDATE_ACTION, Permission.VERIFY_ACTION,
    ],
    RoleName.HOD: [
        Permission.READ_USER, Permission.READ_BRANCH,
        Permission.READ_VISIT, Permission.ASSIGN_VISIT,
        Permission.REVIEW_VISIT, Permission.APPROVE_VISIT, Permission.REJECT_VISIT,
        Permission.VIEW_DASHBOARD, Permission.VIEW_REPORT, Permission.EXPORT_REPORT,
        Permission.VERIFY_ACTION,
    ],
    RoleName.REGIONAL_ADMIN: [
        Permission.READ_USER, Permission.READ_BRANCH, Permission.UPDATE_BRANCH,
        Permission.CREATE_VISIT, Permission.READ_VISIT, Permission.UPDATE_VISIT,
        Permission.SUBMIT_VISIT, Permission.READ_CHECKLIST, Permission.RESPOND_CHECKLIST,
        Permission.CREATE_ACTION, Permission.UPDATE_ACTION,
        Permission.VIEW_DASHBOARD, Permission.VIEW_REPORT,
    ],
    RoleName.AREA_MANAGER: [
        Permission.READ_BRANCH, Permission.READ_VISIT, Permission.UPDATE_VISIT,
        Permission.SUBMIT_VISIT, Permission.READ_CHECKLIST, Permission.RESPOND_CHECKLIST,
        Permission.CREATE_ACTION, Permission.UPDATE_ACTION,
        Permission.VIEW_DASHBOARD, Permission.VIEW_REPORT,
    ],
    RoleName.BRANCH_MANAGER: [
        Permission.READ_BRANCH, Permission.READ_VISIT,
        Permission.CREATE_VISIT, Permission.SUBMIT_VISIT,
        Permission.READ_CHECKLIST, Permission.RESPOND_CHECKLIST,
        Permission.VIEW_REPORT,
    ],
    RoleName.HR: [
        Permission.READ_BRANCH, Permission.READ_VISIT, Permission.UPDATE_VISIT,
        Permission.CREATE_VISIT, Permission.SUBMIT_VISIT,
        Permission.READ_CHECKLIST, Permission.RESPOND_CHECKLIST,
        Permission.CREATE_ACTION, Permission.UPDATE_ACTION,
        Permission.VIEW_DASHBOARD, Permission.VIEW_REPORT,
    ],
    RoleName.AUDITOR: [
        Permission.READ_BRANCH, Permission.READ_VISIT,
        Permission.CREATE_VISIT, Permission.SUBMIT_VISIT, Permission.REVIEW_VISIT, Permission.APPROVE_VISIT, Permission.REJECT_VISIT,
        Permission.VIEW_DASHBOARD, Permission.VIEW_REPORT, Permission.EXPORT_REPORT,
        Permission.VIEW_AUDIT_LOG, Permission.VERIFY_ACTION,
    ],
}


def has_permission(role: str, permission: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, [])
    return permission in perms or RoleName.SUPER_ADMIN == role


def get_scope_filter(user: dict) -> dict:
    """Returns scope filter based on user's organizational hierarchy."""
    if user.get("role") == RoleName.SUPER_ADMIN:
        return {}
    scope = {}
    if user.get("region_id"):
        scope["region_id"] = user["region_id"]
    if user.get("area_id"):
        scope["area_id"] = user["area_id"]
    if user.get("role") == RoleName.BRANCH_MANAGER:
        scope["branch_id"] = user.get("branch_id")
    return scope
