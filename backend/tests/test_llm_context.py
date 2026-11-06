from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.diagnosis import DiagnoseResponse
from app.schemas.llm import DiagnosisLLMInput
from app.services.llm_context import build_llm_input


@pytest.fixture
def diagnosis():
    return DiagnoseResponse(
        id="internal-id", disease_name="무 검은무늬병", crop_type="무",
        category="disease", severity="medium", confidence=0.87,
        selected_crop="무", predicted_crop="무", prediction_mode="model",
        decision_status="disease", decision_reasons=[], policy_version="decision-v1:low=0.5",
        management_actions=["등록된 관리 안내"], recovery_token="private-token",
        top_predictions=[{"name": "무 검은무늬병", "confidence": 0.87}],
        description="잎에 반점", causes=["병원균"], prevention=["환기"],
        pesticides=[{"name": "시험 농약", "dilution": "1000배",
                     "safety": {"phi_days": 7, "reentry_hours": 24}}],
        image_url="/uploads/private.jpg", refined_image_url="/uploads/refined.jpg",
        created_at=datetime.now(timezone.utc),
    )


def test_contract_preserves_allowed_values_and_excludes_internal_fields(diagnosis):
    payload = build_llm_input(diagnosis).model_dump(mode="json")
    assert set(payload) == {
        "schema_version", "disease_name", "crop_type", "selected_crop", "predicted_crop",
        "crop_mismatch", "prediction_mode", "decision_status", "decision_reasons",
        "policy_version", "management_actions", "category", "severity", "confidence",
        "top_predictions", "description", "causes", "prevention", "pesticides", "recapture",
    }
    assert payload["schema_version"] == "1.0"
    for field in set(payload) - {"schema_version"}:
        # 키 목록은 원본 응답에서 추론하지 않고 위에서 명시한다.
        assert payload[field] == diagnosis.model_dump(mode="json")[field]
    assert not {"id", "image_url", "refined_image_url", "created_at", "recovery_token"} & payload.keys()


def test_optional_values_are_not_invented(diagnosis):
    diagnosis.crop_type = None
    diagnosis.description = None
    diagnosis.pesticides = []
    payload = build_llm_input(diagnosis).model_dump(mode="json")
    assert payload["crop_type"] is None
    assert payload["description"] is None
    assert payload["pesticides"] == []
    assert payload["recapture"] is None


def test_recapture_is_preserved(diagnosis):
    diagnosis = DiagnoseResponse.model_validate({
        **diagnosis.model_dump(),
        "recapture": {"region": "잎 뒷면", "instruction": "다시 촬영하세요",
                      "margin": 0.05, "candidates": [{"name": "노균병", "cue": "곰팡이"}]},
    })
    assert build_llm_input(diagnosis).recapture.model_dump() == diagnosis.recapture.model_dump()


def test_context_mutation_does_not_change_original(diagnosis):
    context = build_llm_input(diagnosis)
    context.causes.append("변경")
    context.top_predictions[0].confidence = 0.1
    context.pesticides[0].safety.phi_days = 100
    assert diagnosis.causes == ["병원균"]
    assert diagnosis.top_predictions[0].confidence == 0.87
    assert diagnosis.pesticides[0].safety.phi_days == 7


def test_unknown_fields_are_rejected(diagnosis):
    payload = build_llm_input(diagnosis).model_dump()
    with pytest.raises(ValidationError):
        DiagnosisLLMInput.model_validate({**payload, "image_url": "/private.jpg"})


def test_contract_json_roundtrip(diagnosis):
    context = build_llm_input(diagnosis)
    assert DiagnosisLLMInput.model_validate_json(context.model_dump_json()) == context


@pytest.mark.parametrize("changes", [
    {"crop_mismatch": True, "selected_crop": "고추", "decision_status": "crop_mismatch", "decision_reasons": ["crop_mismatch"]},
    {"prediction_mode": "mock"},
    {"decision_status": "low_confidence", "decision_reasons": ["low_confidence"], "confidence": 0.2},
])
def test_policy_states_remain_distinguishable(diagnosis, changes):
    baseline = build_llm_input(diagnosis)
    changed = DiagnoseResponse.model_validate({**diagnosis.model_dump(), **changes})
    result = build_llm_input(changed)
    assert result != baseline
    for key, value in changes.items():
        assert getattr(result, key) == value


def test_policy_lists_are_independent(diagnosis):
    diagnosis.decision_reasons = ["confusion"]
    result = build_llm_input(diagnosis)
    result.decision_reasons.append("changed")
    result.management_actions.append("changed")
    assert diagnosis.decision_reasons == ["confusion"]
    assert diagnosis.management_actions == ["등록된 관리 안내"]

def test_not_crop_preserves_null_severity_and_recapture_actions(diagnosis):
    actions = [
        "잎 한 장이 화면을 가득 채우도록 가까이에서 찍기",
        "초점이 맞을 때까지 잠깐 멈췄다가 촬영하기",
        "밝은 곳에서 그림자 없이 찍기",
    ]
    diagnosis = DiagnoseResponse.model_validate({
        **diagnosis.model_dump(),
        "disease_name": "판별 불가",
        "crop_type": "기타",
        "category": "other",
        "severity": None,
        "predicted_crop": None,
        "decision_status": "not_crop",
        "decision_reasons": ["not_crop"],
        "management_actions": actions,
        "description": "대상 작물의 잎으로 알아보기 어렵습니다.",
        "causes": [],
        "prevention": [],
        "pesticides": [],
        "recapture": None,
    })

    context = build_llm_input(diagnosis)

    assert context.severity is None
    assert context.category == "other"
    assert context.decision_status == "not_crop"
    assert context.decision_reasons == ["not_crop"]
    assert context.management_actions == actions
    assert context.pesticides == []
    assert (
        DiagnosisLLMInput.model_validate_json(context.model_dump_json())
        == context
    )
