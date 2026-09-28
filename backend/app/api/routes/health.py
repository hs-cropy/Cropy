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

router = APIRouter()


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
