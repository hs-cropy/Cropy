import pytest
from pydantic import ValidationError

from app.schemas.llm import DiagnosisLLMInput
from app.services.llm_function_handler import (
    FunctionHandlerNotImplemented,
    handle_function_output,
)
from app.services.llm_function_parser import InvalidFunctionOutput


@pytest.fixture
def context():
    return DiagnosisLLMInput(
        disease_name="무 노균병",
        crop_type="무",
        category="disease",
        severity="medium",
        confidence=0.48,
        selected_crop="무",
        predicted_crop="무",
        crop_mismatch=False,
        prediction_mode="model",
        decision_status="confusion",
        decision_reasons=["confusion"],
        policy_version="test",
        recapture={
            "region": "잎 뒷면",
            "instruction": "잎 뒷면을 가까이 찍어 주세요.",
            "margin": 0.05,
            "candidates": [],
        },
    )


def run(topic, context):
    return handle_function_output(
        f"<hs_get_recapture_guidance><hs_topic_{topic}><hs-end>",
        context,
    )


def test_where_reads_existing_guidance_without_mutation(context):
    before = context.model_dump()
    result = run("where", context)

    assert result.status == "ok"
    assert context.recapture.region in result.text
    assert context.recapture.instruction in result.text
    assert context.model_dump() == before


@pytest.mark.parametrize("topic", ["where", "why", "provenance"])
def test_missing_recapture_is_insufficient(context, topic):
    context.recapture = None
    result = run(topic, context)

    assert result.status == "insufficient_information"
    assert "저장되어 있지 않아" in result.text


def test_certainty_without_recapture_explains_limit(context):
    context.recapture = None
    result = run("certainty", context)

    assert result.status == "ok"
    assert "보장하지 않습니다" in result.text
    assert "저장되어 있지 않아" in result.text


def test_certainty_preserves_existing_instruction(context):
    result = run("certainty", context)
    assert result.status == "ok"
    assert context.recapture.instruction in result.text


def test_provenance_does_not_claim_new_inference(context):
    result = run("provenance", context)
    assert result.status == "ok"
    assert "새로운 모델 추론을 실행한 것은 아닙니다" in result.text


def test_why_preserves_policy_reason(context):
    result = run("why", context)
    assert result.status == "ok"
    assert "후보 구분" in result.text
    assert context.recapture.instruction in result.text


def test_margin_alone_does_not_invent_recapture_reason(context):
    context.decision_status = "disease"
    context.decision_reasons = []
    context.recapture.margin = 0.01

    result = run("why", context)

    assert result.status == "insufficient_information"
    assert "이유를 추측하지 않습니다" in result.text


@pytest.mark.parametrize("mode", ["model", "browser"])
def test_known_inference_modes_are_not_called_unknown(context, mode):
    context.prediction_mode = mode
    assert "출처가 확인되지 않은" not in run("where", context).text


def test_mock_is_explicit(context):
    context.prediction_mode = "mock"
    assert "데모 결과" in run("where", context).text


def test_invalid_tokens_are_rejected(context):
    with pytest.raises(InvalidFunctionOutput):
        handle_function_output(
            "<hs_get_recapture_guidance><hs_topic_unknown><hs-end>",
            context,
        )


def test_unimplemented_function_is_distinct_from_user_scope(context):
    with pytest.raises(FunctionHandlerNotImplemented):
        handle_function_output(
            "<hs_get_care_information><hs_topic_causes><hs-end>",
            context,
        )


def test_modified_invalid_context_is_rejected(context):
    context.confidence = float("nan")
    with pytest.raises(ValidationError):
        run("where", context)


@pytest.mark.parametrize("field", ["region", "instruction"])
def test_blank_location_information_is_insufficient(context, field):
    setattr(context.recapture, field, " ")
    assert run("where", context).status == "insufficient_information"

def dispatch(function_name, topic, context):
    return handle_function_output(
        f"<hs_{function_name}><hs_topic_{topic}><hs-end>",
        context,
    )


def test_result_preserves_confusion_state(context):
    result = dispatch("get_diagnosis", "result", context)

    assert result.status == "ok"
    assert context.disease_name in result.text
    assert "추가 촬영이 필요한 상태" in result.text
    assert "확진이 아닙니다" in result.text


def test_not_crop_result_does_not_present_disease_candidate(context):
    context.category = "other"
    context.severity = None
    context.decision_status = "not_crop"
    context.decision_reasons = ["not_crop"]

    result = dispatch("get_diagnosis", "result", context)

    assert result.status == "ok"
    assert "판별 불가" in result.text
    assert context.disease_name not in result.text


def test_missing_severity_is_not_invented(context):
    context.severity = None
    result = dispatch("get_diagnosis", "severity", context)

    assert result.status == "insufficient_information"


def test_severity_is_reference_attribute(context):
    result = dispatch("get_diagnosis", "severity", context)

    assert result.status == "ok"
    assert "보통" in result.text
    assert "사진에서 측정한 병의 진행 정도" in result.text


@pytest.mark.parametrize(
    "topic", ["observation", "impact", "food_safety", "change"]
)
def test_unprovided_evidence_is_not_invented(context, topic):
    result = dispatch("get_diagnosis", topic, context)
    assert result.status == "insufficient_information"


def test_browser_provenance_is_known(context):
    context.prediction_mode = "browser"
    result = dispatch("get_diagnosis", "provenance", context)

    assert result.status == "ok"
    assert "브라우저 모델" in result.text


def test_confidence_is_not_disease_probability(context):
    result = dispatch("get_prediction_metrics", "confidence", context)

    assert result.status == "ok"
    assert str(context.confidence) in result.text
    assert "실제 발병 확률이나 피해 수준을 뜻하지 않습니다" in result.text


def test_comparison_requires_two_candidates(context):
    context.top_predictions = []
    result = dispatch("get_prediction_metrics", "comparison", context)
    assert result.status == "insufficient_information"


def test_comparison_reads_scores_without_changing_policy(context):
    context = DiagnosisLLMInput.model_validate({
        **context.model_dump(),
        "top_predictions": [
            {"name": "후보 가", "confidence": 0.8},
            {"name": "후보 나", "confidence": 0.15},
        ],
    })
    before = context.model_dump()

    result = dispatch("get_prediction_metrics", "comparison", context)

    assert result.status == "ok"
    assert "0.65" in result.text
    assert "재촬영 여부를 새로 판정하지 않습니다" in result.text
    assert context.model_dump() == before


@pytest.mark.parametrize("topic", ["ranking", "distribution"])
def test_empty_candidate_list_is_insufficient(context, topic):
    context.top_predictions = []
    result = dispatch("get_prediction_metrics", topic, context)
    assert result.status == "insufficient_information"


def test_mock_result_remains_explicit(context):
    context.prediction_mode = "mock"
    result = dispatch("get_diagnosis", "result", context)
    assert "데모 결과이며 실제 모델 진단이 아닙니다" in result.text