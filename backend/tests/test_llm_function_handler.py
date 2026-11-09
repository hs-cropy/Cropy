from dataclasses import replace

import pytest
from pydantic import ValidationError

from app.schemas.llm import DiagnosisLLMInput
from app.services.llm_function_handler import (
    FunctionHandlerNotImplemented,
    handle_function_output,
)
from app.services.llm_function_parser import (
    FunctionContract,
    FunctionSpec,
    InvalidFunctionContract,
    InvalidFunctionOutput,
)

CONTRACT = FunctionContract(
    system_prompt="테스트용 계약",
    functions=(
        FunctionSpec("get_diagnosis", (("topic", 7),)),
        FunctionSpec("get_prediction_metrics", (("topic", 5),)),
        FunctionSpec("get_recapture_guidance", (("topic", 4),)),
        FunctionSpec("get_care_information", (("topic", 3),)),
        FunctionSpec(
            "get_pesticide_information",
            (("topic", 11), ("product", 2)),
        ),
        FunctionSpec("clarify_request", (("target", 8),)),
        FunctionSpec("handle_scope_limit", (("reason", 3),)),
        FunctionSpec("get_usage_guidance", (("topic", 6), ("delivery", 2))),
        FunctionSpec("chit_chat", ()),
    ),
    stop_token="<hs_end>",
)

TOPICS = {
    "get_diagnosis": (
        "result", "severity", "observation", "provenance",
        "impact", "food_safety", "change",
    ),
    "get_prediction_metrics": (
        "confidence", "ranking", "distribution", "limits", "comparison",
    ),
    "get_recapture_guidance": (
        "where", "why", "certainty", "provenance",
    ),
}

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
    return dispatch("get_recapture_guidance", topic, context)


def test_where_reads_existing_guidance_without_mutation(context):
    before = context.model_dump()
    result = run("where", context)

    assert result.status == "ok"
    assert context.recapture.region in result.text
    assert context.recapture.instruction in result.text
    assert context.model_dump() == before


@pytest.mark.parametrize("topic", ["where", "provenance"])
def test_missing_recapture_is_insufficient(context, topic):
    context.recapture = None
    result = run(topic, context)

    assert result.status == "insufficient_information"

def test_certainty_without_recapture_explains_limit(context):
    context.recapture = None
    result = run("certainty", context)

    assert result.status == "ok"
    assert "보장하지 않습니다" in result.text


def test_certainty_preserves_existing_instruction(context):
    result = run("certainty", context)
    assert result.status == "ok"
    assert context.recapture.instruction in result.text


def test_provenance_does_not_claim_new_inference(context):
    result = run("provenance", context)
    assert result.status == "ok"
    assert "사진을 새로 분석한 것은 아닙니다" in result.text


def test_why_preserves_policy_reason(context):
    result = run("why", context)
    assert result.status == "ok"
    assert "후보를 구분" in result.text
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
            "<hs_2>(topic=5)<hs_end>",
            context,
            CONTRACT,
        )


@pytest.mark.parametrize(
    "output",
    [
        "<hs_3>(topic=1)<hs_end>",
        "<hs_4>(topic=2, product=1)<hs_end>",
        "<hs_7>(topic=1, delivery=1)<hs_end>",
        "<hs_8>()<hs_end>",
    ],
)
def test_unimplemented_function_is_distinct_from_user_scope(context, output):
    with pytest.raises(FunctionHandlerNotImplemented):
        handle_function_output(output, context, CONTRACT)

@pytest.mark.parametrize(
    "status, phrase",
    [
        ("not_crop", "잎을 알아보기 어려워서"),
        ("crop_mismatch", "작물이 달라서"),
        ("confusion", "후보를 구분"),
        ("low_confidence", "자신 있게 구분하지 못해서"),
    ],
)
@pytest.mark.parametrize("signal", ["status", "reason"])
def test_why_uses_decision_without_recapture(context, status, phrase, signal):
    context.recapture = None
    context.category = "disease"
    context.crop_mismatch = False
    context.decision_status = status if signal == "status" else "disease"
    context.decision_reasons = [status] if signal == "reason" else []

    result = run("why", context)

    assert result.status == "ok"
    assert phrase in result.text


def test_not_crop_where_uses_stored_photo_actions(context):
    context.recapture = None
    context.category = "other"
    context.management_actions = [
        "잎 한 장이 화면을 가득 채우도록 찍어 주세요.",
        "밝은 곳에서 초점을 맞춰 주세요.",
    ]
    before = context.model_dump()

    result = run("where", context)

    assert result.status == "ok"
    for action in context.management_actions:
        assert action in result.text
    assert context.model_dump() == before


def test_management_actions_are_not_assumed_to_be_photo_instructions(context):
    context.recapture = None
    context.management_actions = ["병든 부위를 제거하세요."]

    result = run("where", context)

    assert result.status == "insufficient_information"
    assert "병든 부위를 제거하세요" not in result.text


def test_no_reason_and_no_guidance_is_insufficient(context):
    context.recapture = None
    context.decision_status = "disease"
    context.decision_reasons = []

    assert run("why", context).status == "insufficient_information"


def test_observation_reads_general_description_without_claiming_photo_evidence(context):
    context.description = "잎에 반점이 생길 수 있습니다."

    result = dispatch("get_diagnosis", "observation", context)

    assert result.status == "ok"
    assert context.description in result.text
    assert "사진에서 이 증상을 직접 확인했다는 뜻은 아닙니다" in result.text


def test_recapture_provenance_hides_internal_field_name(context):
    result = run("provenance", context)

    assert "진단할 때 함께 저장된 촬영 안내" in result.text
    assert "recapture" not in result.text


def test_mock_prefix_is_shared(context):
    context.prediction_mode = "mock"
    prefix = "데모 결과이며 실제 모델 진단이 아닙니다."

    assert run("where", context).text.startswith(prefix)
    assert dispatch("get_diagnosis", "result", context).text.startswith(prefix)

def test_modified_invalid_context_is_rejected(context):
    context.confidence = float("nan")
    with pytest.raises(ValidationError):
        run("where", context)


@pytest.mark.parametrize("field", ["region", "instruction"])
def test_blank_location_information_is_insufficient(context, field):
    setattr(context.recapture, field, " ")
    assert run("where", context).status == "insufficient_information"

def dispatch(function_name, topic, context):
    index = next(
        i for i, item in enumerate(CONTRACT.functions)
        if item.name == function_name
    )
    number = TOPICS[function_name].index(topic) + 1
    return handle_function_output(
        f"<hs_{index}>(topic={number})<hs_end>",
        context,
        CONTRACT,
    )


@pytest.mark.parametrize(
    ("reason", "expected"),
    [
        (1, "고추·무·배추만 진단"),
        (2, "직접 실행할 수는 없어요"),
        (3, "밝은 곳에서 초점을 맞춰"),
    ],
)
def test_scope_limit_explains_the_selected_reason(context, reason, expected):
    before = context.model_dump()
    result = handle_function_output(f"<hs_6>(reason={reason})<hs_end>", context, CONTRACT)

    assert result.function_name == "handle_scope_limit"
    assert result.status == "unsupported_scope"
    assert expected in result.text
    assert context.disease_name not in result.text
    assert context.model_dump() == before


@pytest.mark.parametrize("argument,count", [("topic", 3), ("reason", 4)])
def test_scope_limit_rejects_an_incompatible_contract(context, argument, count):
    functions = list(CONTRACT.functions)
    functions[6] = FunctionSpec("handle_scope_limit", ((argument, count),))
    contract = replace(CONTRACT, functions=tuple(functions))

    with pytest.raises(InvalidFunctionContract):
        handle_function_output(f"<hs_6>({argument}=1)<hs_end>", context, contract)


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
    assert "브라우저에서 실행한 AI 모델" in result.text
    assert "출처가 확인되지 않은" not in result.text


def test_confidence_is_not_disease_probability(context):
    result = dispatch("get_prediction_metrics", "confidence", context)

    assert result.status == "ok"
    assert "48%" in result.text
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
    assert "65퍼센트포인트" in result.text
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