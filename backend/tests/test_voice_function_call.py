"""음성 기능 호출 API: POST /api/v1/voice/function-call."""

import json

import pytest

from app.core.config import settings
from app.services import function_contract

URL = "/api/v1/voice/function-call"


@pytest.fixture
def diagnosis_id(client, sample_image) -> str:
    res = client.post("/api/v1/diagnose", files={"file": ("leaf.jpg", sample_image, "image/jpeg")})
    assert res.status_code == 200
    return res.json()["id"]


@pytest.fixture
def llm_context(client, diagnosis_id) -> dict:
    """브라우저 오프라인 진단처럼 서버 기록 없이 보내는 문맥. 서버 진단 응답에서 같은 계약으로 만든다."""
    from app.schemas.diagnosis import DiagnoseResponse
    from app.services.llm_context import build_llm_input

    detail = client.get(f"/api/v1/history/{diagnosis_id}").json()
    return json.loads(build_llm_input(DiagnoseResponse.model_validate(detail)).model_dump_json())


def test_default_contract_ships_all_nine_functions():
    contract = function_contract.get_function_contract()
    assert [f.name for f in contract.functions] == [
        "get_diagnosis", "get_prediction_metrics", "get_recapture_guidance", "get_care_information",
        "get_pesticide_information", "clarify_request", "handle_scope_limit", "get_usage_guidance", "chit_chat",
    ]
    assert contract.stop_token == "<hs_end>"


def test_capabilities_reports_voice_commands(client):
    res = client.get("/api/v1/capabilities")
    assert res.json()["execution"]["voice_commands"] is True


@pytest.mark.parametrize("call, function_name", [
    ("<hs_0>(topic=1)<hs_end>", "get_diagnosis"),
    ("<hs_1>(topic=1)<hs_end>", "get_prediction_metrics"),
    ("<hs_2>(topic=2)<hs_end>", "get_recapture_guidance"),
])
def test_implemented_functions_return_sentences(client, diagnosis_id, call, function_name):
    res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": call, "source": "test"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["function_name"] == function_name
    assert body["status"] in {"ok", "insufficient_information", "needs_clarification", "unsupported_scope"}
    assert body["text"].strip()


def test_context_body_works_without_server_record(client, llm_context):
    res = client.post(URL, json={"context": llm_context, "function_call": "<hs_0>(topic=1)<hs_end>", "source": "mobile_clf"})
    assert res.status_code == 200, res.text
    assert res.json()["function_name"] == "get_diagnosis"


@pytest.mark.parametrize("source", ["server", "mobile_clf", "web_qwen", "board_rkllm", "ios_clf"])
def test_every_selector_source_is_accepted(client, llm_context, source):
    # ios_clf 는 mobile_clf 의 예전 이름이라 이미 배포된 클라이언트를 위해 계속 받는다
    res = client.post(URL, json={"context": llm_context, "function_call": "<hs_0>(topic=1)<hs_end>", "source": source})
    assert res.status_code == 200, res.text


def test_unknown_source_is_rejected(client, llm_context):
    res = client.post(URL, json={"context": llm_context, "function_call": "<hs_0>(topic=1)<hs_end>", "source": "android_qwen"})
    assert res.status_code == 422


def test_context_and_diagnosis_id_are_exclusive(client, diagnosis_id, llm_context):
    both = client.post(URL, json={"diagnosis_id": diagnosis_id, "context": llm_context, "function_call": "<hs_0>(topic=1)<hs_end>"})
    neither = client.post(URL, json={"function_call": "<hs_0>(topic=1)<hs_end>"})
    assert both.status_code == 422 and neither.status_code == 422
    assert both.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("call", [
    "hs_0(topic=1)",                       # 형식 아님
    "<hs_9>()<hs_end>",                    # 없는 함수 번호
    "<hs_0>(topic=8)<hs_end>",             # 인자 범위 밖
    "<hs_0>(target=1)<hs_end>",            # 인자 이름 틀림
    "<hs_8>(topic=1)<hs_end>",             # 인자 없는 함수에 인자
])
def test_invalid_calls_are_rejected_with_400(client, diagnosis_id, call):
    res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": call})
    assert res.status_code == 400, res.text
    assert res.json()["code"] == "FUNCTION_CALL_INVALID"


def test_chit_chat_is_answered(client, diagnosis_id):
    res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": "<hs_8>()<hs_end>"})
    assert res.status_code == 200, res.text
    assert res.json()["function_name"] == "chit_chat" and res.json()["status"] == "ok"


def test_usage_guidance_uses_ui_stage(client, diagnosis_id):
    call = "<hs_7>(topic=1, delivery=1)<hs_end>"
    without = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": call})
    assert without.status_code == 200 and without.json()["status"] == "insufficient_information"
    on_result = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": call, "ui_stage": "result"})
    assert on_result.status_code == 200 and on_result.json()["status"] == "ok"


def test_unimplemented_function_returns_501(client, diagnosis_id, monkeypatch):
    # 계약에 새 기능이 생겼는데 handler가 아직 없을 때
    from app.api.routes import voice
    from app.services.llm_function_handler import FunctionHandlerNotImplemented

    def not_ready(*args, **kwargs):
        raise FunctionHandlerNotImplemented("new_function")

    monkeypatch.setattr(voice, "handle_function_output", not_ready)
    res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": "<hs_8>()<hs_end>"})
    assert res.status_code == 501, res.text
    assert res.json()["code"] == "FUNCTION_NOT_IMPLEMENTED"


def test_unknown_diagnosis_is_404(client):
    res = client.post(URL, json={"diagnosis_id": "no-such-diagnosis", "function_call": "<hs_0>(topic=1)<hs_end>"})
    assert res.status_code == 404
    assert res.json()["code"] == "DIAGNOSIS_NOT_FOUND"


def test_other_devices_record_is_not_visible(client, diagnosis_id):
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as other:
        res = other.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": "<hs_0>(topic=1)<hs_end>"})
    assert res.status_code == 404


def test_missing_contract_file_is_503_and_capability_false(client, diagnosis_id, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "llm_function_contract_path", tmp_path / "missing.json")
    function_contract.reset_cache()
    try:
        res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": "<hs_0>(topic=1)<hs_end>"})
        assert res.status_code == 503
        assert res.json()["code"] == "FUNCTION_CONTRACT_UNAVAILABLE"
        assert res.json()["retryable"] is True
        assert client.get("/api/v1/capabilities").json()["execution"]["voice_commands"] is False
    finally:
        function_contract.reset_cache()


def test_broken_contract_file_is_503(client, diagnosis_id, monkeypatch, tmp_path):
    broken = tmp_path / "contract.json"
    broken.write_text('{"system_prompt": "x", "functions": {}, "stop_token": "<hs_end>"}', encoding="utf-8")
    monkeypatch.setattr(settings, "llm_function_contract_path", broken)
    function_contract.reset_cache()
    try:
        res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": "<hs_0>(topic=1)<hs_end>"})
        assert res.status_code == 503
    finally:
        function_contract.reset_cache()


def test_function_call_length_limit(client, diagnosis_id):
    res = client.post(URL, json={"diagnosis_id": diagnosis_id, "function_call": "<hs_0>(topic=1)" + "x" * 600})
    assert res.status_code == 422
