"""Role gating for the inspection visit types.

Only these three types are gated by role. Super admin bypasses every limit;
legacy visit types (HR Visit, etc.) stay open to any user that holds the
CREATE_VISIT permission.

The spreadsheet-driven Branch checklist is done by HR / Regional Admin /
Branch Ops / Other. Fixed-asset verification is a Regional Admin duty, and
IT-asset verification is Regional Admin + Branch Ops (AREA_MANAGER, AUDITOR,
BRANCH_MANAGER).
"""

from core.permissions import RoleName
from models.user import User
from api.deps import is_super_admin, user_role_names

INSPECTION_VISIT_TYPES = ("Branch Visit", "Fixed Asset Visit", "IT Asset Visit")

# Roles allowed to start each inspection visit type.
VISIT_TYPE_ROLE_ALLOW: dict[str, set[str]] = {
    "Branch Visit": {
        RoleName.ADMIN.value,
        RoleName.HOD.value,
        RoleName.HR.value,
        RoleName.REGIONAL_ADMIN.value,
        RoleName.AREA_MANAGER.value,
        RoleName.BRANCH_MANAGER.value,
        RoleName.AUDITOR.value,
    },
    "Fixed Asset Visit": {RoleName.REGIONAL_ADMIN.value},
    "IT Asset Visit": {
        RoleName.REGIONAL_ADMIN.value,
        RoleName.AREA_MANAGER.value,
        RoleName.BRANCH_MANAGER.value,
        RoleName.AUDITOR.value,
    },
}

# Types that use module screens (Fixed Asset / IT Asset) instead of a
# checklist template. These never receive a template or checklist items.
SKIP_TEMPLATE_VISIT_TYPES = ("Fixed Asset Visit", "IT Asset Visit")

# Asset-row statuses that count as "answered" when submitting an IT visit.
ANSWERED_IT_STATUSES = ("VERIFIED", "NOT_FOUND")


def user_may_start_visit(user: User, visit_type_name: str) -> bool:
    if is_super_admin(user):
        return True
    allow = VISIT_TYPE_ROLE_ALLOW.get(visit_type_name)
    if not allow:
        return True
    return bool(user_role_names(user) & allow)


def allowed_visit_type_names(user: User, all_names: list[str]) -> set[str]:
    if is_super_admin(user):
        return set(all_names)
    return {n for n in all_names if user_may_start_visit(user, n)}