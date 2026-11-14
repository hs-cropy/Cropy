"""OpenAPI-only metadata. These models do not filter or change runtime responses."""
from typing import Literal
from pydantic import BaseModel, Field
from app.schemas.diagnosis import DIAGNOSIS_EXAMPLE, PesticideInfo, ManagementActionDetail


def result_examples(example):
    return {"description": "진단 결과. HTTP 상태와 별도로 save_status를 확인하세요.",
        "content": {"application/json": {"examples": {
            "saved": {"summary": "저장 완료 (설명용 예시)", "value": example},
            "save_failed": {"summary": "결과 생성 완료·DB 저장 실패 (설명용 예시)", "value": {
                **example, "save_status": "failed", "recovery_token": "ed6b3b3a-ecb4-4fc9-a681-4d870567fb62",
            }},
        }}}}


DIAGNOSIS_EXAMPLES = result_examples(DIAGNOSIS_EXAMPLE)
REFINEMENT_EXAMPLES = result_examples({
    **DIAGNOSIS_EXAMPLE, "is_refined": True,
    "refined_image_url": "/uploads/2ad7851e-375d-4099-b24b-872aa6a0ad04.jpg",
    "initial_predictions": DIAGNOSIS_EXAMPLE["top_predictions"],
    "updated_at": "2026-10-15T00:01:00Z",
})
OFFLINE_EXAMPLES = result_examples({**DIAGNOSIS_EXAMPLE, "prediction_mode": "browser"})


TAGS = [
    {"name": "health", "description": "서버 생존 여부, 실제 추론 준비 상태, 지원 기능"},
    {"name": "diagnosis", "description": "사진 진단, 재촬영, 저장 복구 및 진단 이력"},
    {"name": "diseases", "description": "병해충·정상 클래스와 방제 참고 정보"},
    {"name": "offline", "description": "브라우저 추론 묶음 정보와 기기 기록 동기화"},
    {"name": "voice", "description": "음성 질문: 기능 선택 모델의 출력으로 답변 문장 만들기"},
]

DESCRIPTION = """AI 기반 농작물 병해충 진단 및 스마트 방제 지원 API.

## 사용 순서
1. `/api/v1/capabilities`에서 지원 작물·업로드 한도·기능을 확인합니다.
2. `/api/v1/ready`로 실제 모델의 추론 준비 상태를 확인합니다. `/health`는 생존 확인입니다.
3. `/api/v1/diagnose`에 JPG/PNG, HEIC/HEIF, DNG(RAW), WebP, AVIF 사진을 multipart로 전송합니다.
4. 재촬영 안내가 있으면 `/api/v1/diagnose/{diagnosis_id}/refine`을 사용합니다.
5. HTTP 200이어도 `save_status=failed`이면 `recovery_token`으로 결과 저장을 재시도합니다.

## 공통 규칙
- 현재 애플리케이션에는 인증·사용자별 이력 분리 기능이 없습니다.
- 진단 출처는 `prediction_mode`로 확인합니다. 개발용 `mock` 결과는 실제 모델 추론이 아닙니다.
- 처리된 HTTP 오류·입력 검증 오류·DB 오류·사진 저장 오류는
  `detail`, `code`, `retryable`, `request_id`를 반환합니다.
  단, `/ready`의 503은 준비 상태 객체입니다. 응답의 `X-Request-ID`로 요청을 추적합니다.
  처리되지 않은 서버 예외의 500 응답은 일반 텍스트일 수 있으며 공통 JSON 형식을 보장하지 않습니다.
- 사진 파일 파트에는 해당 형식의 `image/*` Content-Type을 사용합니다.
  모바일에서 MIME을 알 수 없는 경우 누락 또는 `application/octet-stream`도 허용하되 실제 파일을 디코딩해 검사합니다.
  HEIC/HEIF·DNG·WebP·AVIF 및 긴 변 4096픽셀 초과 사진은 JPEG로 변환합니다.
  전체 요청 본문 한도는 `upload.max_bytes + 65536`바이트이며,
  `/api/v1/offline/records`는 `upload.max_bytes * 2 + 65536`바이트입니다.
- `Idempotency-Key`는 진단·재촬영 요청에서 선택 사항입니다. 같은 키로 동일 요청을 재전송하면
  보관된 결과를 재사용하며, 다른 사진/작물을 보내면 409입니다.
- `/uploads/{filename}`은 응답의 이미지 URL을 제공하는 정적 경로입니다.
  GET/HEAD로 JPEG/PNG를 제공하며 업무 API 목록에는 포함되지 않습니다.
- Swagger의 **Try it out**은 실제 서버를 호출하므로 진단 및 저장 요청은 기록을 생성할 수 있습니다.
"""


class ErrorResponse(BaseModel):
    detail: str = Field(description="사용자에게 표시할 오류 안내", examples=["요청 항목을 확인해 주세요."])
    code: str = Field(description="프로그램에서 분기할 안정적인 오류 코드", examples=["VALIDATION_ERROR"])
    retryable: bool = Field(description="서버가 표시하는 재시도 가능 여부")
    request_id: str = Field(description="응답 X-Request-ID와 같은 요청 추적 ID")


def error_response(description: str, code: str, retryable: bool = False, *, example_detail: str | None = None):
    return {
        "model": ErrorResponse,
        "description": description,
        "headers": {"X-Request-ID": {"description": "요청 추적 ID", "schema": {"type": "string"}}},
        "content": {"application/json": {"example": {
            "detail": example_detail or description, "code": code, "retryable": retryable,
            "request_id": "c60fdccb-782e-4f84-a847-dfe2408f744a",
        }}},
    }


COMMON_ERRORS = {
    413: error_response("전체 요청 본문 크기 초과 (REQUEST_TOO_LARGE)", "REQUEST_TOO_LARGE", example_detail="요청 크기가 너무 큽니다. 업로드할 파일 크기를 줄여 주세요."),
    422: error_response("요청 항목을 확인해 주세요.", "VALIDATION_ERROR"),
    500: {"description": "처리되지 않은 서버 예외. 공통 JSON 오류 형식을 보장하지 않습니다.",
          "content": {"text/plain": {"schema": {"type": "string"}, "example": "Internal Server Error"}}},
}
DATABASE_ERROR = error_response("기록 처리에 실패했습니다. 다시 시도해 주세요.", "DATABASE_UNAVAILABLE", True)
UPLOAD_ERRORS = {
    400: error_response("빈 파일(EMPTY_IMAGE), 지원하지 않는 형식(UNSUPPORTED_IMAGE_FORMAT), 손상된 이미지(INVALID_IMAGE), 잘못된 multipart(HTTP_ERROR)", "INVALID_IMAGE", example_detail="이미지를 읽을 수 없습니다. 다른 사진으로 시도해 주세요."),
    413: error_response("이미지 용량(IMAGE_TOO_LARGE), 해상도(IMAGE_RESOLUTION_TOO_LARGE), 전체 요청(REQUEST_TOO_LARGE) 한도 초과", "IMAGE_RESOLUTION_TOO_LARGE", example_detail="이미지 해상도가 너무 큽니다. 크기를 줄여 주세요."),
    409: error_response("같은 요청 키로 다른 사진이나 작물을 보낼 수 없습니다.", "IDEMPOTENCY_CONFLICT"),
    408: error_response("사진 전송이 멈췄거나(UPLOAD_IDLE_TIMEOUT_SECONDS, 기본 20초) 전체 전송 시간(UPLOAD_TIMEOUT_SECONDS, 기본 300초)을 넘음", "UPLOAD_TIMEOUT", True, example_detail="사진 전송 시간이 초과되었습니다. 연결 상태를 확인하고 다시 시도해 주세요."),
    503: error_response("진단 대기 시간 초과(SERVER_BUSY), 모델(MODEL_UNAVAILABLE), DB(DATABASE_UNAVAILABLE), 사진 저장소(IMAGE_STORAGE_UNAVAILABLE), 복구 저장소(RECOVERY_STORAGE_UNAVAILABLE) 사용 불가", "MODEL_UNAVAILABLE", True, example_detail="모델 진단 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
}
IMAGE_DESCRIPTION = "JPG/PNG, HEIC/HEIF, DNG(RAW), WebP, AVIF 사진. image/* 또는 application/octet-stream(MIME 누락 가능). 실제 디코딩으로 검증하며 새 형식·고해상도 사진은 긴 변 4096픽셀 이하 JPEG로 변환합니다. 파일·픽셀 한도는 /api/v1/capabilities의 upload 참조. RAW 지원은 서버 디코더가 읽을 수 있는 압축 방식에 한합니다."
KEY_DESCRIPTION = "동일 요청 재전송용 키(1~128자). 사진/작물이 달라지면 새 키를 사용합니다."


class UploadCapabilities(BaseModel):
    formats: list[str] = Field(description="허용 이미지 형식(RAW 압축 방식은 디코더 지원에 따름)", examples=[["JPEG", "PNG", "HEIC", "HEIF", "DNG", "WEBP", "AVIF"]])
    max_bytes: int = Field(description="파일 하나의 최대 바이트 수")
    max_pixels: int = Field(description="이미지 가로×세로 픽셀 수 상한")


class DecisionCapabilities(BaseModel):
    version: str = Field(description="판단 정책 버전")
    low_confidence_threshold: float = Field(description="낮은 신뢰도 판단 기준")
    confusion_margin: float = Field(description="혼동쌍 재촬영 안내 기준")
    second_photo_weight: float = Field(description="재촬영 예측 결합 가중치")
    confusion_pairs: list[list[int]] = Field(description="혼동쌍 모델 클래스 ID")
    top1_recapture_pairs: list[list[int]] = Field(
        description="1순위가 속하기만 하면 마진과 무관하게 재촬영을 안내하는 혼동쌍(첫 사진에만 적용)")


class ExecutionCapabilities(BaseModel):
    server_inference: bool = Field(description="실제 서버 모델 추론 준비 여부")
    browser_bundle_available: bool = Field(description="서버에 manifest.json이 존재하는지 여부")
    browser_inference: str = Field(description="device_validation_required: 기기에서 별도 검증 필요")
    voice_commands: bool = Field(description="음성 명령 지원 여부")


class CapabilitiesResponse(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "upload": {"formats": ["JPEG", "PNG", "HEIC", "HEIF", "DNG", "WEBP", "AVIF"], "max_bytes": 104857600, "max_pixels": 210000000},
        "crops": ["고추", "무", "배추"],
        "decision": {"version": "decision-v3", "low_confidence_threshold": .8,
                     "confusion_margin": .2, "second_photo_weight": .6, "confusion_pairs": [[2, 3], [4, 5]],
                     "top1_recapture_pairs": [[2, 3]]},
        "execution": {"server_inference": False, "browser_bundle_available": False,
                      "browser_inference": "device_validation_required", "voice_commands": False},
        "recovery_ttl_hours": 24,
    }]}}
    upload: UploadCapabilities
    crops: list[str] = Field(description="지원 작물", examples=[["고추", "무", "배추"]])
    decision: DecisionCapabilities
    execution: ExecutionCapabilities
    recovery_ttl_hours: int = Field(description="저장 실패 결과 보관 시간(시간)")


class ManifestDisease(BaseModel):
    key: str = Field(description="병해 참고 정보 키")
    model_class_id: int = Field(description="모델 클래스 ID")
    name: str
    name_en: str
    crop_type: str
    category: str
    description: str
    causes: list[str]
    prevention: list[str]
    severity: str | None = Field(description="판별 불가(category other)는 null")
    management_actions: list[str]
    summary_message: str | None = None
    management_action_details: list[ManagementActionDetail] = Field(default_factory=list)
    pesticides: list[PesticideInfo] = Field(description="현재 내보내기에서는 빈 배열(not_bundled)")


class ManifestPair(BaseModel):
    ids: list[int] = Field(description="혼동쌍 클래스 ID")
    trigger: Literal["margin", "top1"] = Field("margin", description="margin: 상위 두 후보가 쌍이고 마진이 좁을 때, top1: 1순위가 쌍에 속하면 항상(첫 사진만)")
    region: str = Field(description="재촬영할 판별 부위")
    instruction: str = Field(description="재촬영 지침")
    cues: dict[str, str] = Field(description="클래스 ID 문자열을 키로 하는 판별 단서")


class ManifestPolicy(BaseModel):
    version: str
    low_confidence_threshold: float
    confusion_margin: float
    second_photo_weight: float
    pairs: list[ManifestPair]


class ManifestValidation(BaseModel):
    identical_tensor_max_logit_error: float = Field(description="동일 입력 텐서의 PyTorch/ONNX 출력 최대 절대 오차")
    cases: int = Field(description="동일 텐서 검증 횟수. 현장 사진 평가 건수가 아님")
    browser_preprocessing_parity: str = Field(description="브라우저 전처리 일치 검증 상태")
    mobile_hardware: str = Field(description="모바일 기기 실측 상태")


class FunctionModelFile(BaseModel):
    name: str = Field(description="묶음 안 상대 경로", examples=["model_int8.onnx"])
    bytes: int
    sha256: str = Field(description="파일 SHA-256. 브라우저가 파일마다 검증한 뒤 저장")


class FunctionModelBundle(BaseModel):
    version: str = Field(description="파일 목록(이름·크기·SHA-256)의 SHA-256")
    base_url: str = Field(description="프론트엔드 정적 자산 경로. 파일 URL은 base_url/name",
                          examples=["/offline-assets/function/mobile_clf/0123456789abcdef"])
    total_bytes: int
    files: list[FunctionModelFile]


class ManifestResponse(BaseModel):
    """scripts/export_browser_model.py가 생성하는 묶음의 문서용 스키마."""
    version: str = Field(description="모델·전처리·참고 정보·정책을 포함한 묶음 SHA-256")
    model_version: str = Field(description="서버 체크포인트 해시")
    format: str = Field(examples=["onnx"])
    model_url: str = Field(description="프론트엔드에서 제공하는 ONNX URL. 백엔드 파일 경로가 아님")
    model_bytes: int
    sha256: str = Field(description="ONNX 파일 SHA-256")
    class_ids: list[int] = Field(description="모델 출력 순서에 대응하는 클래스 ID")
    input_size: int = Field(description="정사각형 모델 입력 크기(픽셀)")
    mean: list[float] = Field(description="채널별 정규화 평균")
    std: list[float] = Field(description="채널별 정규화 표준편차")
    preprocessing_version: str = Field(description="브라우저 전처리 버전")
    server_preprocessing_version: str = Field(description="서버 전처리 버전")
    content_source: str = Field(examples=["manual_seed"])
    pesticide_status: str = Field(examples=["not_bundled"])
    diseases: list[ManifestDisease] = Field(description="클래스별 병해·방제 참고 정보")
    policy: ManifestPolicy = Field(description="묶음에 포함된 판단·재촬영 정책")
    validation: ManifestValidation = Field(description="내보내기 검증 결과와 미검증 범위")
    function_models: dict[str, FunctionModelBundle] | None = Field(
        None, description="기기 종류별 기능 선택 모델 묶음 (mobile_clf: 휴대폰 분류기, web_qwen: PC WebGPU). 준비된 묶음이 없으면 생략")
