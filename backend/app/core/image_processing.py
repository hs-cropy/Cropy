"""Decode phone photos at the upload boundary; persist browser-readable images."""
from io import BytesIO

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
import rawpy

from app.core.config import settings
from app.core.errors import APIError
from app.core.photo_metadata import strip_jpeg, strip_png
from app.core.uploads import IMAGE_EXTENSIONS

register_heif_opener(thumbnails=False)
# Keep Pillow's bomb protection enabled while admitting Galaxy 200MP photos.
Image.MAX_IMAGE_PIXELS = max(Image.MAX_IMAGE_PIXELS or 0, settings.max_image_pixels)
SUPPORTED_FORMATS = ["JPEG", "PNG", "HEIC", "HEIF", "DNG", "WEBP", "AVIF"]
MAX_STORED_EDGE = 4096


def _check_pixels(width: int, height: int) -> None:
    if width <= 0 or height <= 0 or width * height > settings.max_image_pixels:
        raise APIError(413, "IMAGE_RESOLUTION_TOO_LARGE", "이미지 해상도가 너무 큽니다. 크기를 줄여 주세요.")


def _jpeg(image: Image.Image) -> tuple[bytes, str]:
    image.thumbnail((MAX_STORED_EDGE, MAX_STORED_EDGE), Image.Resampling.LANCZOS)
    image = ImageOps.exif_transpose(image)
    profile = image.info.get("icc_profile")
    if profile:
        image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                                         ImageCms.createProfile("sRGB"), outputMode="RGB")
    else:
        image = image.convert("RGB")
    result = BytesIO()
    # Do not copy GPS, camera identifiers, thumbnails, or stale orientation tags.
    image.save(result, "JPEG", quality=95)
    return result.getvalue(), ".jpg"


def _raw(content: bytes) -> tuple[bytes, str]:
    # open_buffer reads headers; unpack allocates the full raw pixel buffer.
    with rawpy.RawPy() as raw:
        raw.open_buffer(BytesIO(content))
        _check_pixels(raw.sizes.raw_width, raw.sizes.raw_height)
        raw.unpack()
        rgb = raw.postprocess(use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB,
                              output_bps=8, half_size=max(raw.sizes.width, raw.sizes.height) > MAX_STORED_EDGE)
    with Image.fromarray(rgb) as image:
        return _jpeg(image)


def prepare_image(content: bytes) -> tuple[bytes, str]:
    """Validate real bytes, decode completely, and normalize new/large formats."""
    try:
        # DNG is TIFF-based. Let LibRaw develop sensor data instead of Pillow
        # accidentally decoding only its embedded preview or grayscale mosaic.
        if content[:4] in (b"II*\x00", b"MM\x00*"):
            return _raw(content)
        with Image.open(BytesIO(content), formats=["JPEG", "PNG", "HEIF", "WEBP", "AVIF"]) as image:
            fmt = image.format
            if fmt not in {"JPEG", "PNG", "HEIF", "WEBP", "AVIF"}:
                raise APIError(400, "UNSUPPORTED_IMAGE_FORMAT", "JPG, PNG, HEIC/HEIF, DNG, WebP, AVIF 사진을 선택해 주세요.")
            _check_pixels(image.width, image.height)
            convert = fmt not in IMAGE_EXTENSIONS or max(image.size) > MAX_STORED_EDGE
            orientation = image.getexif().get(0x0112) if fmt == "JPEG" else None
            image.verify()
        with Image.open(BytesIO(content), formats=["JPEG", "PNG", "HEIF", "WEBP", "AVIF"]) as image:
            # JPEG decoder downsampling avoids a full-size 200MP RGB allocation.
            if fmt == "JPEG" and convert:
                image.draft("RGB", (MAX_STORED_EDGE, MAX_STORED_EDGE))
            image.load()
            if convert:
                return _jpeg(image)
        # Preserve existing model input semantics for ordinary JPEG/PNG files:
        # drop GPS/camera metadata without re-encoding the pixels.
        try:
            stripped = strip_jpeg(content, orientation) if fmt == "JPEG" else strip_png(content)
        except ValueError:
            # Pillow decoded it but the segment walk did not; never store the metadata.
            with Image.open(BytesIO(content), formats=[fmt]) as image:
                image.load()
                return _jpeg(image)
        return stripped, IMAGE_EXTENSIONS[fmt]
    except Image.DecompressionBombError as exc:
        raise APIError(413, "IMAGE_RESOLUTION_TOO_LARGE", "이미지 해상도가 너무 큽니다. 크기를 줄여 주세요.") from exc
    except (rawpy.LibRawFileUnsupportedError, rawpy.LibRawNotImplementedError, rawpy.NotSupportedError) as exc:
        raise APIError(400, "UNSUPPORTED_IMAGE_FORMAT", "이 RAW 사진의 압축 형식을 읽을 수 없습니다. 사진 앱에서 JPG로 내보낸 뒤 다시 선택해 주세요.") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, RuntimeError,
            rawpy.LibRawError, ImageCms.PyCMSError) as exc:
        raise APIError(400, "INVALID_IMAGE", "이미지를 읽을 수 없습니다. 다른 사진으로 시도해 주세요.") from exc
