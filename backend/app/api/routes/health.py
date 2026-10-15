from fastapi import APIRouter, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.core.database import engine

from app.core.config import settings
from app.schemas.diagnosis import HealthResponse, ReadinessResponse
from app.api.documentation import CapabilitiesResponse
from app.services.ml_service import (
    ModelUnavailableError,
    get_prediction_context,
    is_model_loaded,
    is_model_ready,
)
from app.services.decision import POLICY_VERSION
from app.services.recapture import DEFAULT_MARGIN, FUSE_WEIGHT_SECOND, CONFUSION_PAIRS

router = APIRouter()


@router.get("/capabilities", summary="지원 기능·업로드 한도 조회",
            description="실행 환경의 업로드 한도, 지원 작물, 판단 정책과 추론 가능 여부를 조회합니다. 브라우저 묶음 존재 여부는 기기 실행 검증 완료를 뜻하지 않습니다.",
            responses={200: {"model": CapabilitiesResponse}})
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


@router.get("/health", response_model=HealthResponse, summary="서버 생존 상태 조회",
            description="서버 응답 가능 여부와 모델 로드 여부를 확인합니다. 실제 추론 준비 여부는 /api/v1/ready로 확인하세요.")
def health():
    return HealthResponse(
        status="ok",
        model_loaded=is_model_loaded(),
        version=settings.app_version,
    )


@router.get(
    "/ready", response_model=ReadinessResponse,
    summary="DB 및 실제 모델 추론 준비 상태 조회",
    description="DB 연결, 실제 가중치와 DB 클래스 매핑이 준비되면 200, 그렇지 않으면 503입니다. 개발용 mock도 503이며 응답은 준비 상태 객체입니다.",
    responses={
        200: {"content": {"application/json": {"example": {"status": "ready", "database_connected": True,
              "model_loaded": True, "prediction_mode": "model", "version": settings.app_version}}}},
        503: {"model": ReadinessResponse, "description": "DB 또는 모델 매핑 미준비",
              "content": {"application/json": {"example": {"status": "not_ready", "database_connected": False,
              "model_loaded": False, "prediction_mode": "unavailable", "version": settings.app_version}}}},
    },
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
