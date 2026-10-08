from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID


class DashboardStats(BaseModel):
    total_visits: int = 0
    drafted: int = 0
    scheduled: int = 0
    in_progress: int = 0
    submitted: int = 0
    under_review: int = 0
    approved: int = 0
    closed: int = 0
    rework: int = 0
    overdue_actions: int = 0
    open_actions: int = 0
    total_branches: int = 0
    total_users: int = 0


class DashboardCard(BaseModel):
    key: str
    label: str
    value: int
    trend: Optional[float] = None


class ChartPoint(BaseModel):
    label: str
    value: float | int


class DashboardData(BaseModel):
    cards: List[DashboardCard] = []
    visits_by_region: List[ChartPoint] = []
    visits_by_branch: List[ChartPoint] = []
    compliance_by_region: List[ChartPoint] = []
    failed_categories: List[ChartPoint] = []
    open_actions: List[ChartPoint] = []
    overdue_actions: List[ChartPoint] = []
    recent_visits: list = []


class DashboardFilters(BaseModel):
    region_id: Optional[UUID] = None
    area_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None
    visit_type_id: Optional[UUID] = None
    visitor_id: Optional[UUID] = None
    status: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class NotificationRead(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    body: Optional[str] = None
    type: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    is_read: bool
    created_at: object

    model_config = {'from_attributes': True}


class AuditLogRead(BaseModel):
    id: UUID
    user_id: Optional[UUID] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    details: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: object

    model_config = {'from_attributes': True}