"""Tasks package for Celery background workers."""
from .ocr import (
    process_image_ocr,
    extract_plate_text,
    generate_thumbnail,
    compress_image,
)

__all__ = [
    "process_image_ocr",
    "extract_plate_text",
    "generate_thumbnail",
    "compress_image",
]