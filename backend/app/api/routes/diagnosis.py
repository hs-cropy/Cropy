import logging

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.core.device import device_id as current_device
from app.core.image_processing import prepare_image
from app.schemas.diagnosis import CropType, Severity, DiagnoseResponse, PaginatedHistory
from app.core.errors import APIError
from app.api.documentation import DATABASE_ERROR, DIAGNOSIS_EXAMPLES, REFINEMENT_EXAMPLES, IMAGE_DESCRIPTION, KEY_DESCRIPTION, UPLOAD_ERRORS, error_response
from app.services import diagnosis_service
from app.services.ml_service import ModelUnavailableError
from app.services.result_recovery import request_context, save_result

router = APIRouter()
logger = logging.getLogger(__name__)

# 상한 검사를 위해 조금씩 읽는다 — 큰 파일을 통째로 메모리에 올리지 않기 위함
_CHUNK_SIZE = 64 * 1024


async def _read_image_upload(file: UploadFile) -> tuple[bytes, str]:
    """파싱된 파일의 크기·형식·디코딩을 검증하고 안전한 확장자를 반환한다.

    UploadFile은 이미 multipart 파싱된 상태다. 이 제한은 애플리케이션의
    추가 메모리 사용을 제한하며, 요청 수신 자체의 상한을 보장하지 않는다.
    """
    media_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ("", "application/octet-stream") and not media_type.startswith("image/"):
        raise APIError(400, "UNSUPPORTED_IMAGE_FORMAT", "이미지 파일만 업로드 가능합니다.")

    limit = settings.max_upload_bytes
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_CHUNK_SIZE):
        size += len(chunk)
        if size > limit:
            raise APIError(413, "IMAGE_TOO_LARGE", f"이미지는 {settings.max_upload_mb}MB 이하만 업로드할 수 있습니다.")
        chunks.append(chunk)

    if size == 0:
        raise APIError(400, "EMPTY_IMAGE", "빈 파일입니다.")

    content = b"".join(chunks)
    return await run_in_threadpool(prepare_image, content)


def _with_session(operation, *args):
    # Create/use/close each ORM session inside the same worker thread.
    with SessionLocal() as db:
        return operation(db, *args)


@router.post("/diagnose", response_model=DiagnoseResponse, summary="사진으로 병해충 진단",
             description="multipart/form-data의 file에 사진을 보내고, 선택 작물은 쿼리 crop_type으로 전달합니다. 진단·재촬영 안내와 저장 상태를 반환합니다. HTTP 200이어도 save_status=failed이면 recovery_token으로 저장을 재시도하세요. 개발용 mock 여부는 prediction_mode로 구분합니다.",
             responses={200: DIAGNOSIS_EXAMPLES, **UPLOAD_ERRORS})
async def diagnose(
    request: Request,
    file: UploadFile = File(..., description=IMAGE_DESCRIPTION),
    crop_type: CropType | None = Query(None, description="사용자가 선택한 작물. 미지정 시 모델 예측을 사용합니다.", examples=["고추"]),
    idempotency_key: str | None = Header(None, min_length=1, max_length=128, description=KEY_DESCRIPTION),
    device: str = Depends(current_device),
):
    try:
        async with request.app.state.diagnosis_limiter:
            content, extension = await _read_image_upload(file)
            return await run_in_threadpool(
                _with_session, diagnosis_service.diagnose_image, content, f"image{extension}", crop_type,
                request_context("diagnose", idempotency_key, content, crop_type, device), True, device
            )
    except (diagnosis_service.PredictionContractError, ModelUnavailableError):
        logger.exception("Model prediction contract validation failed")
        raise APIError(503, "MODEL_UNAVAILABLE", "모델 진단 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", True)


@router.post("/diagnose/{diagnosis_id}/refine", response_model=DiagnoseResponse, summary="재촬영 사진으로 진단 보완",
             description="기존 진단 id와 판별 부위의 두 번째 사진을 보냅니다. 기존 예측과 결합해 같은 진단을 갱신합니다. 재촬영 불가 상태는 400, 모델 버전 또는 동시 변경 충돌은 409입니다. 저장 실패 시 recovery_token으로 복구할 수 있습니다.",
             responses={200: REFINEMENT_EXAMPLES, **UPLOAD_ERRORS,
                        400: error_response("EMPTY_IMAGE, UNSUPPORTED_IMAGE_FORMAT, INVALID_IMAGE, 잘못된 multipart(HTTP_ERROR) 또는 재촬영할 수 없는 진단(REFINEMENT_UNAVAILABLE)", "REFINEMENT_UNAVAILABLE", example_detail="원본 진단 이미지를 찾을 수 없어 재확정할 수 없습니다."),
                        404: error_response("진단 기록을 찾을 수 없습니다.", "DIAGNOSIS_NOT_FOUND"),
                        409: error_response("모델/진단 변경(MODEL_VERSION_CONFLICT) 또는 요청 키 충돌(IDEMPOTENCY_CONFLICT)", "MODEL_VERSION_CONFLICT", example_detail="모델 또는 진단이 변경되었습니다. 새 진단을 시작해 주세요.")})
async def refine(
    diagnosis_id: str,
    request: Request,
    file: UploadFile = File(..., description=IMAGE_DESCRIPTION),
    idempotency_key: str | None = Header(None, min_length=1, max_length=128, description=KEY_DESCRIPTION),
    device: str = Depends(current_device),
):
    """혼동쌍 판별부위 2차 촬영으로 진단을 재확정 (구성 E: 다시점 융합)."""
    try:
        async with request.app.state.diagnosis_limiter:
            content, extension = await _read_image_upload(file)
            result = await run_in_threadpool(
                _with_session, diagnosis_service.refine_diagnosis, diagnosis_id, content, f"image{extension}",
                request_context(f"refine:{diagnosis_id}", idempotency_key, content, device_id=device), True, device
            )
    except (diagnosis_service.PredictionContractError, ModelUnavailableError):
        logger.exception("Model prediction contract validation failed during refinement")
        raise APIError(503, "MODEL_UNAVAILABLE", "모델 진단 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", True)
    except (diagnosis_service.ModelVersionConflict, StaleDataError):
        raise APIError(409, "MODEL_VERSION_CONFLICT", "모델 또는 진단이 변경되었습니다. 새 진단을 시작해 주세요.")
    except ValueError as exc:
        raise APIError(400, "REFINEMENT_UNAVAILABLE", str(exc))
    if not result:
        raise APIError(404, "DIAGNOSIS_NOT_FOUND", "진단 기록을 찾을 수 없습니다.")
    return result


@router.post("/results/{token}/save", response_model=DiagnoseResponse, summary="진단 결과 저장 재시도",
             description="save_status=failed 응답의 recovery_token을 경로에 넣어 전송합니다. 요청 본문은 없으며 모델을 다시 실행하지 않습니다. 보관 시간은 capabilities.recovery_ttl_hours를 확인하세요. 이미 저장된 동일 토큰은 저장 결과를 반환합니다.",
             responses={404: error_response("저장할 결과를 찾을 수 없습니다.", "RESULT_NOT_FOUND"),
                        409: error_response("기록이 변경되어 이전 결과를 저장할 수 없습니다.", "DIAGNOSIS_CHANGED"),
                        410: error_response("결과 보관 시간이 지났습니다.", "RESULT_EXPIRED"),
                        503: error_response("저장 실패(SAVE_FAILED), DB 사용 불가(DATABASE_UNAVAILABLE), 복구 저장소 사용 불가(RECOVERY_STORAGE_UNAVAILABLE)", "SAVE_FAILED", True, example_detail="이력에 저장하지 못했습니다. 결과는 보관 중이니 다시 저장해 주세요.")})
async def recover_result(token: str, request: Request, device: str = Depends(current_device)):
    async with request.app.state.diagnosis_limiter:
        return await run_in_threadpool(_with_session, save_result, token, device)


@router.get("/history", response_model=PaginatedHistory, summary="진단 이력 목록 조회",
            description="저장된 이력을 최신 촬영 시각 순으로 조회합니다. 작물·심각도 필터와 페이지네이션을 지원합니다. total은 모든 필터 적용 후 건수, crop_total은 작물 필터만 적용한 건수, unfiltered_total은 전체 건수입니다.",
            responses={503: DATABASE_ERROR})
def history(
    page: int = Query(1, ge=1, description="1부터 시작하는 페이지 번호"),
    size: int = Query(20, ge=1, le=100, description="페이지당 결과 수(최대 100)"),
    crop_type: CropType | None = Query(None, description="작물 필터"),
    severity: Severity | None = Query(None, description="심각도 필터: high/medium/low"),
    db: Session = Depends(get_db),
    device: str = Depends(current_device),
):
    return diagnosis_service.get_history(db, page, size, crop_type, severity, device)


@router.get("/history/{diagnosis_id}", response_model=DiagnoseResponse, summary="진단 이력 상세 조회",
            description="진단 응답의 id로 저장된 결과를 조회합니다. 당시 참고 정보의 스냅샷 유무는 content_status로, 현재 농약 참고 정보는 current_pesticides로 확인합니다.",
            responses={404: error_response("진단 기록을 찾을 수 없습니다.", "DIAGNOSIS_NOT_FOUND"), 503: DATABASE_ERROR})
def history_detail(diagnosis_id: str, db: Session = Depends(get_db), device: str = Depends(current_device)):
    result = diagnosis_service.get_diagnosis_detail(db, diagnosis_id, device)
    if not result:
        raise APIError(404, "DIAGNOSIS_NOT_FOUND", "진단 기록을 찾을 수 없습니다.")
    return result


@router.delete("/history/{diagnosis_id}", status_code=204, summary="내 진단 기록 삭제",
               description="이 기기(익명 기기 쿠키)의 진단 기록 하나를 사진과 함께 삭제합니다. 성공하면 본문 없이 204입니다. 다른 기기의 기록이나 없는 기록은 404이며 되돌릴 수 없습니다.",
               responses={404: error_response("진단 기록을 찾을 수 없습니다.", "DIAGNOSIS_NOT_FOUND"), 503: DATABASE_ERROR})
def delete_history(diagnosis_id: str, db: Session = Depends(get_db), device: str = Depends(current_device)):
    if not diagnosis_service.delete_diagnosis(db, diagnosis_id, device):
        raise APIError(404, "DIAGNOSIS_NOT_FOUND", "진단 기록을 찾을 수 없습니다.")
    return Response(status_code=204)
