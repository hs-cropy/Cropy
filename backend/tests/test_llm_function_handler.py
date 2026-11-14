from dataclasses import replace

import pytest
from pydantic import ValidationError

from app.schemas.llm import DiagnosisLLMInput
from app.services.llm_function_handler import (
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

@pytest.mark.parametrize(
    ("target", "expected"),
    [
        (1, "작물 이름"),
        (2, "병 이름"),
        (3, "한 가지씩"),
        (4, "어떤 점수"),
        (5, "병의 심각도와 사진 속 작물 상태"),
        (6, "어느 진단 기록"),
        (7, "제품 이름"),
        (8, "다시 말해 주세요"),
    ],
)
def test_clarify_asks_about_the_selected_target(context, target, expected):
    before = context.model_dump()
    result = handle_function_output(f"<hs_5>(target={target})<hs_end>", context, CONTRACT)

    assert result.function_name == "clarify_request"
    assert result.status == "needs_clarification"
    assert expected in result.text
    assert context.model_dump() == before


@pytest.mark.parametrize(
    "output",
    ["<hs_5>(target=0)<hs_end>", "<hs_5>(target=9)<hs_end>", "<hs_5>(topic=1)<hs_end>"],
)
def test_clarify_rejects_invalid_arguments(context, output):
    with pytest.raises(InvalidFunctionOutput):
        handle_function_output(output, context, CONTRACT)


@pytest.mark.parametrize(("argument", "count"), [("topic", 8), ("target", 9)])
def test_clarify_rejects_an_incompatible_contract(context, argument, count):
    # 파서가 받아들이더라도 핸들러는 약속된 target 8개만 처리한다.
    functions = list(CONTRACT.functions)
    functions[5] = FunctionSpec("clarify_request", ((argument, count),))
    contract = replace(CONTRACT, functions=tuple(functions))

    with pytest.raises(InvalidFunctionContract):
        handle_function_output(f"<hs_5>({argument}=1)<hs_end>", context, contract)


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
@pytest.fixture
def care_context(context):
    context.decision_status = "disease"
    context.decision_reasons = []
    context.recapture = None
    context.causes = ["잎이 오래 젖어 있는 환경"]
    context.prevention = ["통풍을 확보하세요."]
    context.management_actions = [" ", "병든 잎을 살펴보세요.", "재배 환경을 점검하세요."]
    return context


@pytest.mark.parametrize(
    ("topic", "expected", "excluded"),
    [
        (1, ["잎이 오래 젖어 있는 환경", "실제 원인을 확인한 것은 아닙니다"], ["통풍을 확보하세요"]),
        (2, ["통풍을 확보하세요", "재배 환경을 점검하세요"], ["잎이 오래 젖어 있는 환경"]),
        (3, ["병든 잎을 살펴보세요"], ["재배 환경을 점검하세요"]),
    ],
)
def test_care_uses_stored_information_for_each_topic(care_context, topic, expected, excluded):
    before = care_context.model_dump()
    result = handle_function_output(f"<hs_3>(topic={topic})<hs_end>", care_context, CONTRACT)

    assert result.function_name == "get_care_information"
    assert result.status == "ok"
    assert all(text in result.text for text in expected)
    assert all(text not in result.text for text in excluded)
    assert care_context.model_dump() == before


@pytest.mark.parametrize("topic", [1, 2, 3])
def test_care_does_not_invent_missing_information(care_context, topic):
    care_context.causes = []
    care_context.prevention = []
    care_context.management_actions = [" "]
    result = handle_function_output(f"<hs_3>(topic={topic})<hs_end>", care_context, CONTRACT)
    assert result.status == "insufficient_information"


@pytest.mark.parametrize("reason", ["not_crop", "crop_mismatch", "low_confidence", "confusion"])
def test_care_does_not_recommend_disease_actions_for_uncertain_results(care_context, reason):
    care_context.decision_reasons.append(reason)
    result = handle_function_output("<hs_3>(topic=3)<hs_end>", care_context, CONTRACT)
    assert result.status == "insufficient_information"
    assert "병든 잎을 살펴보세요" not in result.text


def test_care_keeps_mock_provenance(care_context):
    care_context.prediction_mode = "mock"
    result = handle_function_output("<hs_3>(topic=2)<hs_end>", care_context, CONTRACT)
    assert result.status == "ok"
    assert result.text.startswith("데모 결과")


def test_chit_chat_returns_short_app_guidance(context):
    result = handle_function_output("<hs_8>()<hs_end>", context, CONTRACT)

    assert result.function_name == "chit_chat"
    assert result.status == "ok"
    assert "작물 진단" in result.text
    assert context.disease_name not in result.text


def test_usage_guidance_uses_explicit_stage_and_delivery(context):
    brief = handle_function_output(
        "<hs_7>(topic=1, delivery=1)<hs_end>",
        context, CONTRACT, ui_stage="no_photo",
    )
    detailed = handle_function_output(
        "<hs_7>(topic=1, delivery=2)<hs_end>",
        context, CONTRACT, ui_stage="no_photo",
    )
    result = handle_function_output(
        "<hs_7>(topic=1, delivery=1)<hs_end>",
        context, CONTRACT, ui_stage="result",
    )

    assert brief.function_name == "get_usage_guidance"
    assert brief.status == detailed.status == result.status == "ok"
    assert "작물을 골라" in brief.text
    assert detailed.text.splitlines()[0] == f"1. {brief.text}"
    assert detailed.text.splitlines()[1].startswith("2. ")
    assert "진단 결과" in result.text


def test_usage_guidance_without_stage_or_previous_reply_does_not_guess(context):
    for topic in (1, 4, 6):
        result = handle_function_output(
            f"<hs_7>(topic={topic}, delivery=1)<hs_end>", context, CONTRACT
        )
        assert result.status == "insufficient_information"


def test_usage_guidance_static_topics_work_without_stage(context):
    for topic, phrase in ((2, "초점"), (3, "작물 선택"), (5, "다시 시도")):
        result = handle_function_output(
            f"<hs_7>(topic={topic}, delivery=2)<hs_end>", context, CONTRACT
        )
        assert result.status == "ok"
        assert phrase in result.text


def _validated_pesticides(items):
    from app.schemas.llm import LLMPesticideInfo

    return [LLMPesticideInfo.model_validate(item) for item in items]


def test_pesticide_information_uses_only_verified_records(context):
    context.decision_status = "disease"
    context.decision_reasons = []
    context.recapture = None
    context.pesticides = _validated_pesticides([
        {
            "name": "테스트 제품 A",
            "source": "PSIS",
            "verification_status": "verified",
            "synced_at": "2026-01-01T00:00:00Z",
            "dilution": "테스트 희석값",
            "usage": "테스트 사용법",
            "active_ingredient": "테스트 성분",
            "safety": {"phi_days": 0, "reentry_hours": 0},
            "safety_notes": "테스트 확인사항",
        },
        {
            "name": "미검증 제품 B",
            "source": "PSIS",
            "dilution": "표시하면 안 되는 값",
        },
    ])
    expected = {
        1: "테스트 제품 A",
        2: "테스트 희석값",
        3: "테스트 사용법",
        4: "0일",
        5: "0시간",
        6: "PSIS 검증",
        7: "테스트 성분",
        8: "테스트 제품 A",
        9: "테스트 확인사항",
    }
    for topic, phrase in expected.items():
        result = handle_function_output(
            f"<hs_4>(topic={topic}, product=2)<hs_end>", context, CONTRACT
        )
        assert result.function_name == "get_pesticide_information"
        assert result.status == "ok"
        assert phrase in result.text
        assert "미검증 제품 B" not in result.text
        assert "표시하면 안 되는 값" not in result.text

    current = handle_function_output("<hs_4>(topic=2, product=1)<hs_end>", context, CONTRACT)
    assert current.status == "needs_clarification"
    assert "테스트 희석값" not in current.text

    for topic in (10, 11):
        result = handle_function_output(
            f"<hs_4>(topic={topic}, product=2)<hs_end>", context, CONTRACT
        )
        assert result.status == "insufficient_information"


def test_pesticide_information_does_not_infer_missing_values(context):
    context.decision_status = "disease"
    context.decision_reasons = []
    context.recapture = None
    call = "<hs_4>(topic=2, product=1)<hs_end>"
    context.pesticides = []
    assert handle_function_output(call, context, CONTRACT).status == "insufficient_information"

    context.pesticides = _validated_pesticides([{
        "name": "테스트 제품 A",
        "source": "PSIS",
        "verification_status": "verified",
        "synced_at": "2026-01-01T00:00:00Z",
    }])
    assert handle_function_output(call, context, CONTRACT).status == "insufficient_information"

    context.pesticides[0].dilution = "표시하면 안 되는 값"
    context.decision_status = "crop_mismatch"
    result = handle_function_output(call, context, CONTRACT)
    assert result.status == "insufficient_information"
    assert "표시하면 안 되는 값" not in result.text


def test_pesticide_information_compares_two_verified_products(context):
    context.decision_status = "disease"
    context.decision_reasons = []
    context.recapture = None
    context.pesticides = _validated_pesticides([
        {
            "name": name,
            "active_ingredient": ingredient,
            "source": "PSIS",
            "verification_status": "verified",
            "synced_at": "2026-01-01T00:00:00Z",
        }
        for name, ingredient in (("Product A", "Ingredient A"), ("Product B", "Ingredient B"))
    ])

    result = handle_function_output(
        "<hs_4>(topic=10, product=2)<hs_end>", context, CONTRACT
    )
    assert result.status == "ok"
    assert "Product A: Ingredient A" in result.text
    assert "Product B: Ingredient B" in result.text
