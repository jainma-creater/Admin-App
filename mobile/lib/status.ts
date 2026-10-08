// Simple 3-bucket status model for display.
// The backend keeps legacy workflow states (DRAFT, ASSIGNED, SCHEDULED,
// UNDER_REVIEW, REWORK_REQUIRED…) for compatibility, but this app doesn't
// use them — every visit is simply: being worked on, submitted, or completed.

const BUCKETS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "In Progress", color: "#f59e0b" },
  ASSIGNED: { label: "In Progress", color: "#f59e0b" },
  SCHEDULED: { label: "In Progress", color: "#f59e0b" },
  IN_PROGRESS: { label: "In Progress", color: "#f59e0b" },
  REWORK_REQUIRED: { label: "Rework", color: "#8b5cf6" },
  RESUBMITTED: { label: "In Progress", color: "#f59e0b" },
  REJECTED: { label: "Rejected", color: "#ef4444" },
  SUBMITTED: { label: "Submitted", color: "#06b6d4" },
  UNDER_REVIEW: { label: "Submitted", color: "#06b6d4" },
  APPROVED: { label: "Completed", color: "#10b981" },
  CLOSED: { label: "Completed", color: "#10b981" },
  CANCELLED: { label: "Completed", color: "#10b981" },
};

const FALLBACK = { label: "In Progress", color: "#f59e0b" };

export function statusLabel(status: string | null | undefined): string {
  if (!status) return FALLBACK.label;
  return (BUCKETS[status] ?? FALLBACK).label;
}

export function statusColor(status: string | null | undefined): string {
  if (!status) return FALLBACK.color;
  return (BUCKETS[status] ?? FALLBACK).color;
}

/** States in which the checklist can still be edited (i.e. not yet accepted).
 * REJECTED is recoverable: the inspector can fix items and resubmit. */
export const EDITABLE_STATUSES = [
  "DRAFT",
  "ASSIGNED",
  "SCHEDULED",
  "IN_PROGRESS",
  "REWORK_REQUIRED",
  "RESUBMITTED",
  "REJECTED",
];

/** States that count as "submitted and done" (Visited list). */
export const DONE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CLOSED"];

/** Legacy "not started yet" states — auto-moved to IN_PROGRESS behind the scenes. */
export const PRE_START_STATUSES = ["DRAFT", "ASSIGNED", "SCHEDULED"];
