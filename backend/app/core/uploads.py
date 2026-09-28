"""Serve uploaded images with a fixed, passive content type."""
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles


IMAGE_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png"}
IMAGE_MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


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
