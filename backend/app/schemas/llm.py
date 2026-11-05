"""LLM에 전달하는 진단 컨텍스트 v1. 내부 식별자와 사진 URL은 제외한다."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.diagnosis import PesticideInfo, PesticideSafety, PredictionItem, RecaptureGuidance


Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
SafetyInteger = Annotated[int, Field(ge=0, strict=True)]


class LLMPredictionItem(PredictionItem):
    confidence: Probability


class LLMRecaptureGuidance(RecaptureGuidance):
    margin: Probability


class LLMPesticideSafety(PesticideSafety):
    phi_days: SafetyInteger | None = None
    reentry_hours: SafetyInteger | None = None


class LLMPesticideInfo(PesticideInfo):
    safety: LLMPesticideSafety = Field(default_factory=LLMPesticideSafety)


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
    # DB의 병해 속성이다. 판별 불가(category other)는 None이다.
    severity: str | None
    confidence: Probability
    top_predictions: list[LLMPredictionItem] = Field(default_factory=list)
    description: str | None = None
    causes: list[str] = Field(default_factory=list)
    prevention: list[str] = Field(default_factory=list)
    pesticides: list[LLMPesticideInfo] = Field(default_factory=list)
    recapture: LLMRecaptureGuidance | None = None
