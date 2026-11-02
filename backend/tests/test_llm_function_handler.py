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
            "<hs_get_diagnosis><hs_topic_result><hs-end>",
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