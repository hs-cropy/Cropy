"""기능 선택 모델 서버의 HTTP 계약. 모델은 올리지 않고 _ask를 가짜로 둔다."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qwen"))
import select_server  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    # lifespan이 모델 로드 스레드를 띄우지 않게 하고, 준비된 상태를 흉내 낸다
    monkeypatch.setattr(select_server, "_load", lambda: None)
    monkeypatch.setitem(select_server._qwen, "status", "ready")
    monkeypatch.setitem(select_server._qwen, "prefix_ids", list(range(1161)))
    monkeypatch.setitem(select_server._qwen, "device", "cpu")
    with TestClient(select_server.app) as c:
        yield c


def _fake_ask(calls, call="<hs_4>(topic=2, product=1)<hs_end>"):
    def ask(utterance, context):
        calls.append((utterance, context))
        return {"function_call": call, "input_tokens": 1270, "new_tokens": 110, "elapsed_ms": 1800}
    return ask


def test_health_reports_model_state(client):
    body = client.get("/health").json()
    assert body["status"] == "ready"
    assert body["prefix_tokens"] == 1161
    assert body["busy"] == {"select": 0}


def test_select_returns_the_model_output_unchanged(client, monkeypatch):
    calls = []
    monkeypatch.setattr(select_server, "_ask", _fake_ask(calls))
    res = client.post("/select", json={"utterance": " 이 병 약 얼마나 타서 뿌려 ",
                                       "context": {"ui_stage": "result", "disease_name": "고추 탄저병", "pesticides": [{"name": "A"}]}})
    assert res.status_code == 200
    assert res.json()["function_call"] == "<hs_4>(topic=2, product=1)<hs_end>"
    assert res.json()["elapsed_ms"] == 1800
    assert calls[0][0] == "이 병 약 얼마나 타서 뿌려"   # 앞뒤 공백 제거


def test_select_applies_the_training_context_rules(client, monkeypatch):
    calls = []
    monkeypatch.setattr(select_server, "_ask", _fake_ask(calls))
    raw = {"disease_name": "무 검은무늬병", "confidence": 0.91, "crop_mismatch": False,
           "top_predictions": [{"name": "a", "confidence": 0.9}, {"name": "b", "confidence": 0.05}, {"name": "c", "confidence": 0.05}],
           "pesticides": [{"name": f"p{i}"} for i in range(7)], "recapture": {"region": "잎 뒷면", "guidance": "긴 설명"},
           "image_url": "/uploads/x.jpg", "description": "긴 참고 문장"}
    client.post("/select", json={"utterance": "어느 후보가 높아", "context": raw})
    context = calls[0][1]
    assert context["ui_stage"] == "result"                       # disease_name이 있으면 결과 화면
    assert context["crop_mismatch"] is False                     # False도 남긴다
    assert len(context["top_predictions"]) == 2
    assert context["pesticides"] == ["p0", "p1", "p2", "p3", "p4"]  # 이름만, 5개까지
    assert context["recapture"] == {"region": "잎 뒷면"}
    assert "image_url" not in context and "description" not in context


def test_select_is_idempotent_on_already_compact_context(client, monkeypatch):
    calls = []
    monkeypatch.setattr(select_server, "_ask", _fake_ask(calls))
    compact = {"ui_stage": "result", "selected_crop": "고추", "crop_mismatch": False, "disease_name": "고추 탄저병",
               "confidence": 0.87, "top_predictions": [{"name": "고추 탄저병", "confidence": 0.87}], "pesticides": ["A"]}
    client.post("/select", json={"utterance": "이 병 뭐야", "context": compact})
    assert calls[0][1] == compact


def test_select_without_context_means_no_photo_screen(client, monkeypatch):
    calls = []
    monkeypatch.setattr(select_server, "_ask", _fake_ask(calls, "<hs_7>(topic=1, delivery=1)<hs_end>"))
    res = client.post("/select", json={"utterance": "어떻게 시작해"})
    assert res.status_code == 200
    assert calls[0][1] == {"ui_stage": "no_photo"}


def test_select_passes_malformed_output_through(client, monkeypatch):
    # 형식 검사는 백엔드 파서가 한다. 여기서 고치면 모델 오류가 숨는다
    monkeypatch.setattr(select_server, "_ask", _fake_ask([], "죄송해요"))
    assert client.post("/select", json={"utterance": "응"}).json()["function_call"] == "죄송해요"


def test_select_is_503_until_the_model_is_ready(client, monkeypatch):
    monkeypatch.setitem(select_server._qwen, "status", "loading")
    res = client.post("/select", json={"utterance": "이 병 뭐야"})
    assert res.status_code == 503


def test_select_rejects_empty_or_long_utterance(client):
    assert client.post("/select", json={"utterance": ""}).status_code == 422
    assert client.post("/select", json={"utterance": "가" * 301}).status_code == 422
