class VisitStateError(Exception):
    pass


VALID_TRANSITIONS = {
    # DRAFT -> SUBMITTED allowed: the mobile app answers the checklist without a
    # separate "start" step, so submission straight from DRAFT must be valid.
    "DRAFT": {"ASSIGNED", "SCHEDULED", "IN_PROGRESS", "SUBMITTED", "CANCELLED"},
    "ASSIGNED": {"DRAFT", "SCHEDULED", "IN_PROGRESS"},
    "SCHEDULED": {"DRAFT", "ASSIGNED", "IN_PROGRESS"},
    "IN_PROGRESS": {"DRAFT", "SUBMITTED"},
    "SUBMITTED": {"UNDER_REVIEW", "DRAFT"},
    "UNDER_REVIEW": {"APPROVED", "REJECTED", "REWORK_REQUIRED"},
    "REJECTED": {"REWORK_REQUIRED", "UNDER_REVIEW", "IN_PROGRESS", "SUBMITTED", "RESUBMITTED"},
    "REWORK_REQUIRED": {"IN_PROGRESS", "RESUBMITTED", "SUBMITTED"},
    "RESUBMITTED": {"UNDER_REVIEW", "APPROVED", "REWORK_REQUIRED"},
    "APPROVED": {"CLOSED"},
    "CLOSED": set(),
    "CANCELLED": set(),
}


def can_transition(current: str, target: str) -> bool:
    return target in VALID_TRANSITIONS.get(current, set())


def transition(current: str, target: str):
    if not can_transition(current, target):
        raise VisitStateError(
            f"Invalid state transition: {current} -> {target}"
        )
    return target