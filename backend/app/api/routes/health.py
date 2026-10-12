from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.schemas.diagnosis import HealthResponse
from app.services.ml_service import (
    ModelUnavailableError,
    get_prediction_context,
    is_model_loaded,
    is_model_ready,
)
from app.services.decision import POLICY_VERSION
from app.services.recapture import DEFAULT_MARGIN, FUSE_WEIGHT_SECOND, CONFUSION_PAIRS

router = APIRouter()


@router.get("/capabilities")
def capabilities():
    return {
        "upload": {"formats": ["JPEG", "PNG"], "max_bytes": settings.max_upload_bytes,
                   "max_pixels": settings.max_image_pixels},
        "crops": ["고추", "무", "배추"],
        "decision": {"version": POLICY_VERSION, "low_confidence_threshold": settings.low_confidence_threshold,
                     "confusion_margin": DEFAULT_MARGIN, "second_photo_weight": FUSE_WEIGHT_SECOND,
                     "confusion_pairs": [sorted(pair) for pair in CONFUSION_PAIRS]},
        "execution": {"server_inference": is_model_ready(), "browser_bundle_available": (settings.offline_bundle_dir / "manifest.json").is_file(),
                      "browser_inference": "device_validation_required",
                      "voice_commands": False},
        "recovery_ttl_hours": settings.recovery_ttl_hours,
    }


@router.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        model_loaded=is_model_loaded(),
        version=settings.app_version,
    )


@router.get("/ready")
def ready():
    """Readiness requires real weights and a validated database class mapping."""
    available = is_model_ready()
    try:
        mode = get_prediction_context()["prediction_mode"]
    except ModelUnavailableError:
        mode = "unavailable"
    return JSONResponse(
        status_code=200 if available else 503,
        content={
            "status": "ready" if available else "not_ready",
            "model_loaded": is_model_loaded(),
            "prediction_mode": mode,
            "version": settings.app_version,
        },
    )
