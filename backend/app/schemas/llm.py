"""LLM에 전달하는 진단 컨텍스트 v1. 내부 식별자와 사진 URL은 제외한다."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.diagnosis import PesticideInfo, PredictionItem, RecaptureGuidance


class DiagnosisLLMInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    disease_name: str
    crop_type: str | None = None
    selected_crop: str | None
    predicted_crop: str | None
    crop_mismatch: bool
    prediction_mode: str
    decision_status: str
    decision_reasons: list[str]
    policy_version: str | None
    management_actions: list[str] = Field(default_factory=list)
    category: str
    # DB의 병해 속성으로, 모델 신뢰도나 사진 기반 심각도와 구분한다.
    severity: str
    confidence: float
    top_predictions: list[PredictionItem] = Field(default_factory=list)
    description: str | None = None
    causes: list[str] = Field(default_factory=list)
    prevention: list[str] = Field(default_factory=list)
    pesticides: list[PesticideInfo] = Field(default_factory=list)
    recapture: RecaptureGuidance | None = None
