"""LLM 입력 경계에서 수치를 보정하지 않고 검증한다."""
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.diagnosis import DiagnoseResponse
from app.schemas.llm import DiagnosisLLMInput
from app.services.llm_context import build_llm_input


@pytest.fixture
def payload():
    return {
        "disease_name": "무 검은무늬병", "category": "disease", "severity": "medium",
        "selected_crop": "무", "predicted_crop": "무", "crop_mismatch": False,
        "prediction_mode": "model", "decision_status": "disease",
        "decision_reasons": [], "policy_version": "decision-v1",
        "confidence": 0.87,
        "top_predictions": [{"name": "무 검은무늬병", "confidence": 0.87}],
        "pesticides": [{"name": "시험 농약", "safety": {"phi_days": 7, "reentry_hours": 24}}],
        "recapture": {"region": "잎 뒷면", "instruction": "다시 촬영",
                      "margin": 0.05, "candidates": []},
    }


def set_probability(payload, target, value):
    if target == "confidence":
        payload[target] = value
        return ("confidence",)
    if target == "prediction":
        payload["top_predictions"][0]["confidence"] = value
        return ("top_predictions", 0, "confidence")
    payload["recapture"]["margin"] = value
    return ("recapture", "margin")


def get_probability(result, target):
    if target == "confidence":
        return result.confidence
    if target == "prediction":
        return result.top_predictions[0].confidence
    return result.recapture.margin


@pytest.mark.parametrize("target", ["confidence", "prediction", "margin"])
@pytest.mark.parametrize("value", [0.0, 0.5, 1.0])
def test_probability_boundaries(payload, target, value):
    set_probability(payload, target, value)
    assert get_probability(DiagnosisLLMInput.model_validate(payload), target) == value


@pytest.mark.parametrize("target", ["confidence", "prediction", "margin"])
@pytest.mark.parametrize("value", [-0.01, 1.01, float("nan"), float("inf"), float("-inf")])
def test_invalid_probability_rejected(payload, target, value):
    location = set_probability(payload, target, value)
    with pytest.raises(ValidationError) as error:
        DiagnosisLLMInput.model_validate(payload)
    assert location in [item["loc"] for item in error.value.errors()]


@pytest.mark.parametrize("field", ["phi_days", "reentry_hours"])
@pytest.mark.parametrize("value", [None, 0, 7])
def test_safety_values_preserved(payload, field, value):
    payload["pesticides"][0]["safety"][field] = value
    result = DiagnosisLLMInput.model_validate(payload)
    assert getattr(result.pesticides[0].safety, field) == value


@pytest.mark.parametrize("field", ["phi_days", "reentry_hours"])
@pytest.mark.parametrize("value", [-1, 1.5, 7.0, True, "7", float("nan"), float("inf")])
def test_safety_values_not_coerced(payload, field, value):
    payload["pesticides"][0]["safety"][field] = value
    with pytest.raises(ValidationError) as error:
        DiagnosisLLMInput.model_validate(payload)
    assert ("pesticides", 0, "safety", field) in [item["loc"] for item in error.value.errors()]


@pytest.mark.parametrize("target", ["confidence", "prediction", "margin", "phi_days", "reentry_hours"])
def test_converter_revalidates_existing_diagnosis(payload, target):
    diagnosis = DiagnoseResponse.model_validate({
        **payload, "id": "test-id", "created_at": datetime.now(timezone.utc),
    })
    if target == "confidence":
        diagnosis.confidence = float("nan")
    elif target == "prediction":
        diagnosis.top_predictions[0].confidence = 1.5
    elif target == "margin":
        diagnosis.recapture.margin = -0.1
    else:
        setattr(diagnosis.pesticides[0].safety, target, -1)
    with pytest.raises(ValidationError):
        build_llm_input(diagnosis)


def test_missing_safety_remains_unknown(payload):
    payload["pesticides"] = [{"name": "시험 농약"}]
    result = DiagnosisLLMInput.model_validate(payload)
    assert result.pesticides[0].safety.model_dump() == {"phi_days": None, "reentry_hours": None}


@pytest.mark.parametrize("field", ["phi_days", "reentry_hours"])
@pytest.mark.parametrize("value", [True, False, "7", 7.0, 1.5, -1])
def test_original_diagnosis_creation_rejects_wrong_type(payload, field, value):
    payload["pesticides"][0]["safety"][field] = value
    with pytest.raises(ValidationError) as error:
        DiagnoseResponse.model_validate({**payload, "id": "test", "created_at": datetime.now(timezone.utc)})
    assert ("pesticides", 0, "safety", field) in [e["loc"] for e in error.value.errors()]


@pytest.mark.parametrize("field", ["phi_days", "reentry_hours"])
@pytest.mark.parametrize("value", [None, 0, 7])
def test_raw_to_diagnosis_to_llm_preserves_safety(payload, field, value):
    payload["pesticides"][0]["safety"][field] = value
    diagnosis = DiagnoseResponse.model_validate({**payload, "id": "test", "created_at": datetime.now(timezone.utc)})
    assert getattr(build_llm_input(diagnosis).pesticides[0].safety, field) == value
