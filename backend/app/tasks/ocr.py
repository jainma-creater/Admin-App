"""OCR background tasks for Celery worker."""
import io
import os
import tempfile
import logging
from typing import Optional, Dict, Any
from PIL import Image, ImageOps
import pytesseract
from celery import shared_task
from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

# Configure tesseract
TESSERACT_CMD = os.getenv("TESSERACT_CMD", "tesseract")
if os.path.exists(TESSERACT_CMD):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD


@shared_task(
    bind=True,
    name="tasks.ocr.process_image",
    queue="ocr",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 3},
    time_limit=120,
    soft_time_limit=90,
)
def process_image_ocr(
    self,
    image_bytes: bytes,
    mime_type: str,
    languages: str = "eng",
    config: str = "--psm 6 --oem 3",
) -> Dict[str, Any]:
    """
    Process an image for OCR in the background.
    
    Args:
        image_bytes: Raw image bytes
        mime_type: Image MIME type
        languages: Tesseract languages (e.g., "eng", "eng+hin")
        config: Tesseract config string
    
    Returns:
        Dict with extracted text, confidence, and metadata
    """
    try:
        # Load image from bytes
        image = Image.open(io.BytesIO(image_bytes))
        
        # Convert to RGB if needed
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        
        # Auto-orient based on EXIF
        image = ImageOps.exif_transpose(image)
        
        # Preprocess for better OCR
        # Increase contrast slightly
        from PIL import ImageEnhance
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(1.2)
        
        # Run OCR
        text = pytesseract.image_to_string(
            image,
            lang=languages,
            config=config,
        ).strip()
        
        # Get confidence data
        data = pytesseract.image_to_data(
            image,
            lang=languages,
            config=config,
            output_type=pytesseract.Output.DICT,
        )
        
        # Calculate average confidence (ignore -1 values)
        confidences = [c for c in data.get("conf", []) if c != -1]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        return {
            "text": text,
            "confidence": round(avg_confidence, 1),
            "word_count": len(text.split()),
            "char_count": len(text),
            "success": True,
            "error": None,
        }
        
    except Exception as e:
        logger.exception(f"OCR task failed: {e}")
        return {
            "text": "",
            "confidence": 0,
            "word_count": 0,
            "char_count": 0,
            "success": False,
            "error": str(e),
        }


@shared_task(
    bind=True,
    name="tasks.ocr.extract_plate_text",
    queue="ocr",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 2},
    time_limit=120,
    soft_time_limit=90,
)
def extract_plate_text(
    self,
    image_bytes: bytes,
    mime_type: str,
) -> Dict[str, Any]:
    """
    Specialized OCR for license plates / number plates.
    Uses single-line PSM and alphanumeric whitelist.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
        
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        
        image = ImageOps.exif_transpose(image)
        
        # Plate-specific config: single line, alphanumeric
        plate_config = "--psm 8 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        
        text = pytesseract.image_to_string(
            image,
            lang="eng",
            config=plate_config,
        ).strip().replace(" ", "").replace("\n", "")
        
        data = pytesseract.image_to_data(
            image,
            lang="eng",
            config=plate_config,
            output_type=pytesseract.Output.DICT,
        )
        
        confidences = [c for c in data.get("conf", []) if c != -1]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        return {
            "plate_text": text,
            "confidence": round(avg_confidence, 1),
            "success": True,
            "error": None,
        }
        
    except Exception as e:
        logger.exception(f"Plate OCR task failed: {e}")
        return {
            "plate_text": "",
            "confidence": 0,
            "success": False,
            "error": str(e),
        }


@shared_task(
    bind=True,
    name="tasks.image.generate_thumbnail",
    queue="image",
    time_limit=60,
    soft_time_limit=45,
)
def generate_thumbnail(
    self,
    image_bytes: bytes,
    mime_type: str,
    size: tuple = (256, 256),
    quality: int = 85,
) -> Dict[str, Any]:
    """
    Generate a thumbnail from image bytes.
    Returns thumbnail bytes as base64.
    """
    import base64
    try:
        image = Image.open(io.BytesIO(image_bytes))
        
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        
        image = ImageOps.exif_transpose(image)
        image.thumbnail(size, Image.Resampling.LANCZOS)
        
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
        thumbnail_bytes = buffer.getvalue()
        
        return {
            "thumbnail_base64": base64.b64encode(thumbnail_bytes).decode("utf-8"),
            "size": image.size,
            "original_size": image.size,
            "mime_type": "image/jpeg",
            "success": True,
            "error": None,
        }
        
    except Exception as e:
        logger.exception(f"Thumbnail generation failed: {e}")
        return {
            "thumbnail_base64": None,
            "success": False,
            "error": str(e),
        }


@shared_task(
    bind=True,
    name="tasks.image.compress_image",
    queue="image",
    time_limit=60,
    soft_time_limit=45,
)
def compress_image(
    self,
    image_bytes: bytes,
    mime_type: str,
    max_dimension: int = 1920,
    quality: int = 85,
) -> Dict[str, Any]:
    """
    Compress image for storage while maintaining quality.
    Returns compressed bytes as base64.
    """
    import base64
    try:
        image = Image.open(io.BytesIO(image_bytes))
        
        if image.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        
        image = ImageOps.exif_transpose(image)
        
        # Resize if larger than max_dimension
        if max(image.size) > max_dimension:
            image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
        compressed_bytes = buffer.getvalue()
        
        return {
            "compressed_base64": base64.b64encode(compressed_bytes).decode("utf-8"),
            "size": image.size,
            "original_size": image.size,
            "mime_type": "image/jpeg",
            "bytes_saved": len(image_bytes) - len(compressed_bytes),
            "success": True,
            "error": None,
        }
        
    except Exception as e:
        logger.exception(f"Image compression failed: {e}")
        return {
            "compressed_base64": None,
            "success": False,
            "error": str(e),
        }