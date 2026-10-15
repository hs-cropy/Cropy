"""Serve uploaded images with a fixed, passive content type."""
from pathlib import Path
import logging

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from app.core.errors import APIError


IMAGE_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png"}
IMAGE_MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def write_image(path: Path, content: bytes) -> None:
    """Translate image storage failures; callers roll back and remove partial files."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    except OSError as exc:
        logging.getLogger(__name__).exception("Unable to store diagnosis image")
        raise APIError(503, "IMAGE_STORAGE_UNAVAILABLE",
                       "사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", True) from exc


class ImageStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        media_type = IMAGE_MEDIA_TYPES.get(Path(path).suffix.lower())
        if media_type is None:
            # Also block legacy uploads named .html/.svg before this validation existed.
            raise HTTPException(status_code=404)
        response = await super().get_response(path, scope)
        response.headers["Content-Type"] = media_type
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
