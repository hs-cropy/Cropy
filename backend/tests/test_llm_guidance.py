import asyncio

import pytest
from pydantic import ValidationError

from app.schemas.llm import DiagnosisLLMInput
from app.services.llm_guidance import generate_guidance


@pytest.fixture
def context():
    return DiagnosisLLMInput(
        disease_name="무 검은무늬병", crop_type="무", category="disease",
        severity="medium", confidence=0.87,
        selected_crop="무", predicted_crop="무", crop_mismatch=False,
        prediction_mode="model", decision_status="disease", decision_reasons=[], policy_version="decision-v1",
        description="등록된 병해 설명",
        prevention=["환기"],
        recapture={"region": "잎 뒷면", "instruction": "잎 뒷면을 촬영하세요",
                   "margin": 0.05, "candidates": []},
    )


def test_success_passes_contract_and_preserves_original(context):
    async def caller(payload):
        assert payload == context.model_dump(mode="json")
        payload["prevention"].append("변경")
        return "  안내 결과  "
    result = asyncio.run(generate_guidance(context, caller))
    assert result.model_dump() == {"text": "안내 결과", "source": "llm", "fallback_reason": None}
    assert context.prevention == ["환기"]


def test_unavailable_uses_registered_guidance(context):
    result = asyncio.run(generate_guidance(context))
    assert result.source == "template"
    assert result.fallback_reason == "unavailable"
    assert context.disease_name in result.text
    assert "환기" in result.text
    assert context.recapture.instruction in result.text
    assert "0.87" not in result.text
    assert "medium" not in result.text


def test_timeout_cancels_provider_and_returns_template(context):
    async def scenario():
        cancelled = asyncio.Event()
        async def caller(payload):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        result = await generate_guidance(context, caller, timeout_seconds=0.01)
        assert cancelled.is_set()
        assert result.fallback_reason == "timeout"
        assert result.source == "template"
    asyncio.run(scenario())


def test_error_does_not_leak_provider_details(context):
    async def caller(payload):
        raise RuntimeError("secret-api-key")
    result = asyncio.run(generate_guidance(context, caller))
    assert result.fallback_reason == "error"
    assert result.source == "template"
    assert "secret-api-key" not in result.text


@pytest.mark.parametrize("value", [None, "", "  \n ", {}, 123])
def test_invalid_provider_response(context, value):
    async def caller(payload):
        return value
    result = asyncio.run(generate_guidance(context, caller))
    assert result.fallback_reason == "invalid_response"
    assert result.source == "template"


def test_request_cancellation_propagates(context):
    async def scenario():
        started = asyncio.Event()
        stopped = asyncio.Event()
        async def caller(payload):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        task = asyncio.create_task(generate_guidance(context, caller))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert stopped.is_set()
    asyncio.run(scenario())


@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf"), float("-inf")])
def test_invalid_timeout_rejected(context, value):
    with pytest.raises(ValueError):
        asyncio.run(generate_guidance(context, timeout_seconds=value))


def test_modified_invalid_context_is_rejected_before_call(context):
    context.confidence = -1
    async def caller(payload):
        pytest.fail("invalid context must not reach provider")
    with pytest.raises(ValidationError):
        asyncio.run(generate_guidance(context, caller))


def test_minimal_context_fallback():
    context = DiagnosisLLMInput(disease_name="정상", category="normal", severity="low", confidence=1,
        selected_crop=None, predicted_crop=None, crop_mismatch=False,
        prediction_mode="model", decision_status="normal", decision_reasons=[], policy_version="decision-v1")
    result = asyncio.run(generate_guidance(context))
    assert "정상" in result.text
    assert "None" not in result.text
    assert "대상 작물:" not in result.text


@pytest.mark.parametrize("changes,message", [
    ({"prediction_mode": "mock"}, "데모(Mock)"),
    ({"crop_mismatch": True, "selected_crop": "고추", "decision_status": "crop_mismatch", "decision_reasons": ["crop_mismatch"]}, "작물 불일치"),
    ({"decision_status": "low_confidence", "decision_reasons": ["low_confidence"]}, "판정을 보류"),
    ({"decision_status": "confusion", "decision_reasons": ["confusion"]}, "재촬영이 필요"),
    ({"prediction_mode": "legacy"}, "추론 출처가 확인되지"),
])
def test_policy_template_distinguishes_states(context, changes, message):
    changed = DiagnosisLLMInput.model_validate({**context.model_dump(), **changes})
    result = asyncio.run(generate_guidance(changed))
    assert message in result.text
    assert "모델 분류 결과:" not in result.text
    assert "등록된 예방 안내:" not in result.text
    assert context.recapture.instruction in result.text


def test_policy_is_not_recalculated_from_confidence(context):
    context.confidence = 0.01
    # 제공된 판정 상태를 그대로 사용하며 임계값을 서비스에서 재적용하지 않는다.
    result = asyncio.run(generate_guidance(context))
    assert "모델 분류 결과:" in result.text
    assert "판정을 보류" not in result.text

@pytest.mark.parametrize("with_caller", [False, True])
def test_not_crop_uses_recapture_template_without_provider(context, with_caller):
    actions = ["밝은 곳에서 잎 한 장을 선명하게 다시 찍기"]
    changed = DiagnosisLLMInput.model_validate({
        **context.model_dump(),
        "disease_name": "판별 불가",
        "category": "other",
        "severity": None,
        "decision_status": "not_crop",
        "decision_reasons": ["not_crop"],
        "management_actions": actions,
        "description": "출력되면 안 되는 병해 설명",
        "prevention": ["출력되면 안 되는 방제 안내"],
        "recapture": None,
    })

    async def caller(payload):
        pytest.fail("판별 불가 결과는 LLM에 전달하면 안 됩니다.")

    result = asyncio.run(
        generate_guidance(changed, caller if with_caller else None)
    )

    assert result.source == "template"
    assert result.fallback_reason == "not_crop"
    assert "재촬영" in result.text
    assert actions[0] in result.text
    assert "모델 분류 결과:" not in result.text
    assert "출력되면 안 되는" not in result.text


@pytest.mark.parametrize("changes", [
    {"category": "other"},
    {"decision_status": "not_crop"},
    {"decision_reasons": ["not_crop"]},
])
def test_not_crop_signals_prevent_provider_call(context, changes):
    changed = DiagnosisLLMInput.model_validate({
        **context.model_dump(),
        **changes,
        "management_actions": [],
    })

    async def caller(payload):
        pytest.fail("판별 불가 신호가 있으면 LLM 호출을 생략해야 합니다.")

    result = asyncio.run(generate_guidance(changed, caller))

    assert result.fallback_reason == "not_crop"
    assert "초점을 맞춰 다시 찍어 주세요." in result.text


def test_not_crop_still_revalidates_input(context):
    context.category = "other"
    context.severity = None
    context.confidence = -1

    async def caller(payload):
        pytest.fail("잘못된 입력은 LLM에 전달하면 안 됩니다.")

    with pytest.raises(ValidationError):
        asyncio.run(generate_guidance(context, caller))
