from datetime import datetime, timezone
from typing import Annotated, Literal
from pydantic import BaseModel, Field, field_validator

CropType = Literal["고추", "무", "배추"]
Severity = Literal["high", "medium", "low"]

# Illustrative response, not a stored diagnosis or a real model measurement.
DIAGNOSIS_EXAMPLE = {
    "id": "4da54046-bae9-4249-a4b3-85d17b83ee40",
    "disease_name": "고추 탄저병", "crop_type": "고추", "selected_crop": "고추",
    "predicted_crop": "고추", "crop_mismatch": False, "prediction_mode": "model",
    "category": "disease", "severity": "high", "confidence": 0.87,
    "top_predictions": [{"name": "고추 탄저병", "confidence": .87},
                        {"name": "고추 정상", "confidence": .08},
                        {"name": "고추 흰가루병", "confidence": .03}],
    "created_at": "2026-10-15T00:00:00Z", "updated_at": "2026-10-15T00:00:00Z",
    "image_url": "/uploads/4da54046-bae9-4249-a4b3-85d17b83ee40.jpg",
    "recapture": None, "is_refined": False, "content_status": "snapshot",
    "decision_status": "disease", "decision_reasons": [], "policy_version": "decision-v1:low=0.5",
    "save_status": "saved", "recovery_token": None,
}


class TimestampedResponse(BaseModel):
    @field_validator("created_at", "updated_at", "synced_at", mode="after", check_fields=False)
    @classmethod
    def utc_timestamp(cls, value):
        # SQLite CURRENT_TIMESTAMP is UTC, but its driver returns naive values.
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class PredictionItem(BaseModel):
    name: str = Field(description="예측 클래스의 표시 이름", examples=["고추 탄저병"])
    confidence: float = Field(description="모델 예측 확률(0~1)", examples=[0.87])


class RecaptureCandidate(BaseModel):
    """혼동쌍 각 후보와, 판별부위에서 그 후보를 가리키는 시각 단서."""

    name: str
    cue: str


class RecaptureGuidance(BaseModel):
    """1차 진단이 혼동쌍에 낮은 마진으로 떨어졌을 때, 어느 부위를 다시 찍을지 안내."""

    region: str
    instruction: str
    margin: float
    candidates: list[RecaptureCandidate]


class PesticideSafety(BaseModel):
    phi_days: Annotated[int, Field(ge=0, strict=True)] | None = Field(None, description="수확 전 안전 사용 간격(일). 미확인 시 null")
    reentry_hours: Annotated[int, Field(ge=0, strict=True)] | None = Field(None, description="살포 후 재출입 간격(시간). 미확인 시 null")


class PesticideInfo(TimestampedResponse):
    name: str
    dilution: str | None = None
    usage: str | None = None
    safety: PesticideSafety = Field(default_factory=PesticideSafety)
    active_ingredient: str | None = None
    safety_notes: str | None = None
    usage_id: str | None = None
    source: str | None = None
    verification_status: str = Field("legacy_unverified", description="농약 사용 조건 검증 상태")
    synced_at: datetime | None = None


class DiagnoseResponse(TimestampedResponse):
    model_config = {"json_schema_extra": {"examples": [DIAGNOSIS_EXAMPLE]}}
    id: str = Field(description="진단 기록 ID. 이력 조회·재촬영에 사용")
    disease_name: str = Field(description="최상위 예측 클래스의 이름")
    crop_type: str | None = Field(None, description="이력에 저장한 작물(선택 작물 우선)")
    selected_crop: str | None = Field(None, description="사용자가 선택한 작물")
    predicted_crop: str | None = Field(None, description="모델이 예측한 작물")
    crop_mismatch: bool = Field(False, description="선택 작물과 예측 작물 불일치 여부")
    prediction_mode: str = Field("legacy", description="model: 서버 모델, mock: 개발 예시, browser: 기기 예측, legacy: 이전 기록")
    model_version: str | None = Field(None, description="추론 모델 버전/체크포인트 해시")
    preprocessing_version: str | None = Field(None, description="이미지 전처리 버전")
    pair_model_version: str | None = Field(None, description="사용한 혼동쌍 보조 모델 버전")
    category: str = Field("disease", description="클래스 분류: disease, pest, normal 등")
    severity: str = Field("medium", description="참고 정보의 심각도: high/medium/low")
    confidence: float = Field(description="최상위 예측 확률(0~1)", examples=[0.87])
    top_predictions: list[PredictionItem] = Field(description="상위 예측 후보")
    description: str | None = Field(None, description="병해·정상 클래스 설명")
    causes: list[str] = Field(default=[], description="발병 원인 참고 정보")
    pesticides: list[PesticideInfo] = Field(default=[], description="진단 참고 정보의 농약 목록. 검증 상태 확인 필요")
    prevention: list[str] = Field(default=[], description="예방 방법")
    image_url: str | None = Field(None, description="원본 사진 URL (/uploads/…)")
    refined_image_url: str | None = Field(None, description="재촬영 사진 URL")
    created_at: datetime = Field(description="최초 촬영/진단 시각(시간대 포함)")
    updated_at: datetime | None = Field(None, description="최종 갱신 시각(시간대 포함)")
    recapture: RecaptureGuidance | None = Field(None, description="혼동쌍 판별을 위한 재촬영 부위·안내. 없으면 null")
    management_actions: list[str] = Field(default_factory=list, description="관리·방제 행동 안내")
    content_status: Literal["snapshot", "current_reference"] = Field("current_reference", description="snapshot: 당시 참고 정보 보존, current_reference: 현재 정보로 보완한 이전 기록")
    content_version: str | None = Field(None, description="참고 정보 버전")
    current_pesticides: list[PesticideInfo] = Field(default_factory=list, description="현재 DB 기준 농약 참고 정보")
    decision_status: str = Field("disease", description="판단 상태: crop_mismatch, confusion, low_confidence, normal, disease")
    decision_reasons: list[str] = Field(default_factory=list, description="판단 보류·재촬영 등의 사유")
    policy_version: str | None = Field(None, description="판단 정책 버전")
    is_refined: bool = Field(False, description="재촬영 반영 여부")
    initial_predictions: list[PredictionItem] = Field(default_factory=list, description="재촬영 전 최초 예측 후보")
    save_status: Literal["saved", "failed"] = Field("saved", description="DB 저장 상태. failed여도 진단 결과는 반환될 수 있음")
    recovery_token: str | None = Field(None, description="저장 실패 시 /api/v1/results/{token}/save에 사용할 토큰")


class DiagnosisSummary(TimestampedResponse):
    id: str
    disease_name: str
    confidence: float
    crop_type: str | None = None
    image_url: str | None = None
    created_at: datetime
    refined_image_url: str | None = None
    prediction_mode: str = "legacy"
    severity: Severity = "medium"
    category: str = "disease"
    is_refined: bool = False
    content_status: str = "current_reference"


class PaginatedHistory(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "items": [], "total": 0, "page": 1, "size": 20, "unfiltered_total": 0, "crop_total": 0,
    }]}}
    items: list[DiagnosisSummary] = Field(description="현재 페이지의 진단 기록")
    total: int = Field(description="모든 필터 적용 후 전체 건수")
    page: int = Field(description="현재 페이지(1부터 시작)")
    size: int = Field(description="요청한 페이지 크기")
    unfiltered_total: int = Field(0, description="필터 적용 전 전체 건수")
    crop_total: int = Field(0, description="작물 필터만 적용한 건수")


class DiseaseDetail(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "id": 1, "name": "고추 탄저병", "name_en": "Pepper Anthracnose", "crop_type": "고추",
        "category": "disease", "severity": "high", "description": "과실과 잎에 병반이 생기는 병해입니다.",
        "causes": ["고온다습"], "prevention": ["통풍·배수 관리"], "pesticides": [],
    }]}}
    id: int
    name: str
    name_en: str | None = None
    crop_type: str
    category: str
    description: str | None = None
    causes: list[str] = []
    prevention: list[str] = []
    severity: str
    pesticides: list[PesticideInfo] = []


class HealthResponse(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{"status": "ok", "model_loaded": False, "version": "1.0.0"}]}}
    status: str
    model_loaded: bool
    version: str


class ReadinessResponse(BaseModel):
    status: str
    database_connected: bool
    model_loaded: bool
    prediction_mode: str
    version: str
