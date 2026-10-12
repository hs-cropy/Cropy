from fastapi import APIRouter, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.core.database import engine

from app.core.config import settings
from app.schemas.diagnosis import HealthResponse, ReadinessResponse
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


@router.get(
    "/ready", response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse, "description": "DB 또는 모델 매핑 미준비"}},
)
def ready(response: Response):
    """DB 연결, 실제 가중치 및 DB 클래스 매핑이 모두 준비되어야 한다."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_connected = True
    except SQLAlchemyError:
        database_connected = False
    available = database_connected and is_model_ready()
    try:
        mode = get_prediction_context()["prediction_mode"]
    except ModelUnavailableError:
        mode = "unavailable"
    response.status_code = 200 if available else 503
    return ReadinessResponse(
        status="ready" if available else "not_ready",
        database_connected=database_connected,
        model_loaded=is_model_loaded(),
        prediction_mode=mode,
        version=settings.app_version,
    )
