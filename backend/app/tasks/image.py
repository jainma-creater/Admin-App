"""Image processing background tasks for Celery worker."""
# Re-export the image tasks from ocr module since they're defined there
from .ocr import (
    generate_thumbnail,
    compress_image,
)

__all__ = [
    "generate_thumbnail",
    "compress_image",
]