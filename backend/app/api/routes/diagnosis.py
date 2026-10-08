from io import BytesIO
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.core.uploads import IMAGE_EXTENSIONS
from app.schemas.diagnosis import CropType, Severity, DiagnoseResponse, PaginatedHistory
from app.services import diagnosis_service
from app.services.ml_service import ModelUnavailableError

router = APIRouter()
logger = logging.getLogger(__name__)

# 상한 검사를 위해 조금씩 읽는다 — 큰 파일을 통째로 메모리에 올리지 않기 위함
_CHUNK_SIZE = 64 * 1024


async def _read_image_upload(file: UploadFile) -> tuple[bytes, str]:
    """파싱된 파일의 크기·형식·디코딩을 검증하고 안전한 확장자를 반환한다.

    UploadFile은 이미 multipart 파싱된 상태다. 이 제한은 애플리케이션의
    추가 메모리 사용을 제한하며, 요청 수신 자체의 상한을 보장하지 않는다.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다.")

    limit = settings.max_upload_bytes
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_CHUNK_SIZE):
        size += len(chunk)
        if size > limit:
            raise HTTPException(
                status_code=413,
                detail=f"이미지는 {settings.max_upload_mb}MB 이하만 업로드할 수 있습니다.",
            )
        chunks.append(chunk)

    if size == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    content = b"".join(chunks)
    extension = await run_in_threadpool(_validate_image, content)
    return content, extension


def _validate_image(content: bytes) -> str:
    # Content-Type은 클라이언트가 정하는 값이라 신뢰할 수 없다. 실제로 열리는
    # 이미지인지 확인해 두지 않으면 추론 단계에서 500으로 터진다.
    try:
        with Image.open(BytesIO(content)) as image:
            extension = IMAGE_EXTENSIONS.get(image.format)
            if extension is None:
                raise HTTPException(status_code=400, detail="JPEG 또는 PNG 이미지만 업로드 가능합니다.")
            if image.width * image.height > settings.max_image_pixels:
                raise HTTPException(status_code=413, detail="이미지 해상도가 너무 큽니다. 크기를 줄여 주세요.")
            image.verify()
        # verify() alone does not decode JPEG pixel data. Reopen and fully decode
        # before persistence/inference, preserving the original bytes and orientation.
        with Image.open(BytesIO(content)) as image:
            image.load()
    except Image.DecompressionBombError:
        raise HTTPException(status_code=413, detail="이미지 해상도가 너무 큽니다. 크기를 줄여 주세요.")
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        raise HTTPException(status_code=400, detail="이미지를 읽을 수 없습니다. 다른 사진으로 시도해 주세요.")

    return extension


def _with_session(operation, *args):
    # Create/use/close each ORM session inside the same worker thread.
    with SessionLocal() as db:
        return operation(db, *args)


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose(
    request: Request,
    file: UploadFile = File(...),
    crop_type: CropType | None = Query(None),
):
    try:
        async with request.app.state.diagnosis_limiter:
            content, extension = await _read_image_upload(file)
            return await run_in_threadpool(
                _with_session, diagnosis_service.diagnose_image, content, f"image{extension}", crop_type
            )
    except (diagnosis_service.PredictionContractError, ModelUnavailableError):
        logger.exception("Model prediction contract validation failed")
        raise HTTPException(status_code=503, detail="모델 진단 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.")


@router.post("/diagnose/{diagnosis_id}/refine", response_model=DiagnoseResponse)
async def refine(
    diagnosis_id: str,
    request: Request,
    file: UploadFile = File(...),
):
    """혼동쌍 판별부위 2차 촬영으로 진단을 재확정 (구성 E: 다시점 융합)."""
    try:
        async with request.app.state.diagnosis_limiter:
            content, extension = await _read_image_upload(file)
            result = await run_in_threadpool(
                _with_session, diagnosis_service.refine_diagnosis, diagnosis_id, content, f"image{extension}"
            )
    except (diagnosis_service.PredictionContractError, ModelUnavailableError):
        logger.exception("Model prediction contract validation failed during refinement")
        raise HTTPException(status_code=503, detail="모델 진단 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.")
    except (diagnosis_service.ModelVersionConflict, StaleDataError):
        raise HTTPException(status_code=409, detail="모델 또는 진단이 변경되었습니다. 새 진단을 시작해 주세요.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(status_code=404, detail="진단 기록을 찾을 수 없습니다.")
    return result


@router.get("/history", response_model=PaginatedHistory)
def history(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    crop_type: CropType | None = Query(None),
    severity: Severity | None = Query(None),
    db: Session = Depends(get_db),
):
    return diagnosis_service.get_history(db, page, size, crop_type, severity)


@router.get("/history/{diagnosis_id}", response_model=DiagnoseResponse)
def history_detail(diagnosis_id: str, db: Session = Depends(get_db)):
    result = diagnosis_service.get_diagnosis_detail(db, diagnosis_id)
    if not result:
        raise HTTPException(status_code=404, detail="진단 기록을 찾을 수 없습니다.")
    return result
