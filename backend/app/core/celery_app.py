"""Celery app for background task processing (OCR, image processing, etc.)."""
import os
from celery import Celery
from app.core.config import settings

# Create Celery app
celery_app = Celery(
    "branchvisit",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.tasks.ocr",
        "app.tasks.image",
    ],
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,  # 5 min hard limit
    task_soft_time_limit=240,  # 4 min soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=100,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    result_expires=3600,
    # Queue routing
    task_routes={
        "app.tasks.ocr.*": {"queue": "ocr"},
        "app.tasks.image.*": {"queue": "image"},
    },
    # Beat schedule (if needed for periodic tasks)
    beat_schedule={},
)

# Auto-discover tasks
celery_app.autodiscover_tasks(["app.tasks"])


@celery_app.task(bind=True, ignore_result=False)
def debug_task(self):
    """Debug task to verify worker is running."""
    return f"Request: {self.request!r}"


if __name__ == "__main__":
    celery_app.start()