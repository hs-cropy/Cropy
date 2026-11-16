"""음성 질문 파이프라인: /voice/transcribe, /voice/select-function, 화면 상태(context) 생성."""

import io
import wave

import httpx
import pytest

from app.core.config import settings
from app.schemas.diagnosis import DiagnoseResponse
from app.services import function_selector, stt_service
from app.services.voice_context import CONTEXT_KEYS, compact_context

TRANSCRIBE = "/api/v1/voice/transcribe"
SELECT = "/api/v1/voice/select-function"
ANSWER = "/api/v1/voice/function-call"


def _wav(frames: int = 1600) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b"\x01\x00" * frames)
    return buf.getvalue()


@pytest.fixture
def diagnosis_id(client, sample_image) -> str:
    res = client.post("/api/v1/diagnose", files={"file": ("leaf.jpg", sample_image, "image/jpeg")})
    assert res.status_code == 200
    return res.json()["id"]


# ---------- 문장부호 정리 ----------

@pytest.mark.parametrize("raw, expected", [
    ("고추 정상 이라니까 씻 어어서 바로 먹어 어도 안전한 거지.", "고추 정상 이라니까 씻 어어서 바로 먹어 어도 안전한 거지"),
    ("모검은무늬병 다음 으로 높은 은 거랑 차이종 계산해 져.", "모검은무늬병 다음 으로 높은 은 거랑 차이종 계산해 져"),
    ("이거, 뭐야? 진짜…", "이거 뭐야 진짜"),
    ("0.5배 희석해도 돼?", "0.5배 희석해도 돼"),
    ("   ", ""),
    # language="ko"여도 SenseVoice가 짧은 말을 일본어·한자로 적은 실제 사례 (2026-11-12)
    ("なょ？", ""),
    ("供よ？", ""),
    ("끝ねさ？", "끝"),
    ("ロキ？ 이 병 무병 걸린 거야.", "이 병 무병 걸린 거야"),
    ("사진진 찍어줘。", "사진진 찍어줘"),
    ("그費？ 그록피 이거 진단해줘.", "그 그록피 이거 진단해줘"),
    ("6？ 오늘은 여기까지.", "6 오늘은 여기까지"),
    ("1,000배 희석", "1,000배 희석"),
])
def test_normalize_transcript_strips_punctuation(raw, expected):
    assert stt_service.normalize_transcript(raw) == expected


# ---------- /voice/transcribe ----------

def test_transcribe_off_engine_is_503(client, monkeypatch):
    monkeypatch.setattr(settings, "stt_engine", "off")
    res = client.post(TRANSCRIBE, content=_wav(), headers={"Content-Type": "audio/wav"})
    assert res.status_code == 503
    assert res.json()["code"] == "STT_UNAVAILABLE" and res.json()["retryable"] is True


def test_transcribe_mock_engine_returns_text(client, monkeypatch):
    monkeypatch.setattr(settings, "stt_engine", "mock")
    res = client.post(TRANSCRIBE, content=_wav(), headers={"Content-Type": "audio/wav"})
    assert res.status_code == 200
    assert res.json() == {"text": stt_service.MOCK_TEXT}


def test_transcribe_rejects_empty_and_non_wav(client, monkeypatch):
    monkeypatch.setattr(settings, "stt_engine", "mock")
    assert client.post(TRANSCRIBE, content=b"", headers={"Content-Type": "audio/wav"}).status_code == 400
    res = client.post(TRANSCRIBE, content=b"\x1aE\xdf\xa3webm", headers={"Content-Type": "audio/webm"})
    assert res.status_code == 400 and res.json()["code"] == "AUDIO_INVALID"


def test_transcribe_rejects_oversized_audio(client, monkeypatch):
    monkeypatch.setattr(settings, "stt_engine", "mock")
    monkeypatch.setattr(settings, "stt_max_audio_mb", 1)
    res = client.post(TRANSCRIBE, content=b"RIFF" + b"\x00" * (1024 * 1024 + 1), headers={"Content-Type": "audio/wav"})
    assert res.status_code == 413 and res.json()["code"] == "AUDIO_TOO_LARGE"


def test_transcribe_http_engine_forwards_wav_and_normalizes(client, monkeypatch):
    monkeypatch.setattr(settings, "stt_engine", "http")
    calls = []

    def fake_post(url, content, headers, timeout):
        calls.append((url, len(content), headers["Content-Type"]))
        return httpx.Response(200, json={"text": "이 병 약 얼마나 타서 뿌려?", "elapsed_ms": 120})

    monkeypatch.setattr(stt_service.httpx, "post", fake_post)
    audio = _wav()
    res = client.post(TRANSCRIBE, content=audio, headers={"Content-Type": "audio/wav"})
    assert res.status_code == 200
    assert res.json()["text"] == "이 병 약 얼마나 타서 뿌려"
    assert calls == [(settings.stt_server_url + "/transcribe", len(audio), "audio/wav")]


def test_transcribe_http_engine_maps_server_errors(client, monkeypatch):
    monkeypatch.setattr(settings, "stt_engine", "http")
    monkeypatch.setattr(stt_service.httpx, "post", lambda *a, **k: httpx.Response(400, json={"detail": "wav 파일이 아닙니다."}))
    res = client.post(TRANSCRIBE, content=_wav(), headers={"Content-Type": "audio/wav"})
    assert res.status_code == 400 and res.json()["detail"] == "wav 파일이 아닙니다."

    def unreachable(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(stt_service.httpx, "post", unreachable)
    res = client.post(TRANSCRIBE, content=_wav(), headers={"Content-Type": "audio/wav"})
    assert res.status_code == 503 and res.json()["code"] == "STT_UNAVAILABLE"


# ---------- 화면 상태 ----------

def test_compact_context_matches_training_shape(client, diagnosis_id):
    detail = DiagnoseResponse.model_validate(client.get(f"/api/v1/history/{diagnosis_id}").json())
    context = compact_context(detail, "result")
    assert list(context) == [k for k in CONTEXT_KEYS if k in context]   # 학습 데이터와 같은 키 순서
    assert context["ui_stage"] == "result"
    assert context["disease_name"] == detail.disease_name
    assert context["crop_mismatch"] is False or context["crop_mismatch"] is True
    assert len(context["top_predictions"]) <= 2
    assert all(set(p) == {"name", "confidence"} for p in context["top_predictions"])
    assert "selected_usage_id" not in context and "pending_target" not in context
    if context.get("pesticides"):
        assert all(isinstance(p, str) for p in context["pesticides"]) and len(context["pesticides"]) <= 5


def test_compact_context_rounds_scores_like_training_data(client, diagnosis_id):
    detail = DiagnoseResponse.model_validate(client.get(f"/api/v1/history/{diagnosis_id}").json())
    detail.confidence = 0.9118661279106783
    detail.top_predictions[0].confidence = 0.9118661279106783
    context = compact_context(detail, "result")
    assert context["confidence"] == 0.91 and context["top_predictions"][0]["confidence"] == 0.91


def test_compact_context_without_diagnosis_has_only_stage():
    assert compact_context(None, None) == {"ui_stage": "no_photo"}
    assert compact_context(None, "analyzing") == {"ui_stage": "analyzing"}


# ---------- /voice/select-function ----------

def test_select_off_engine_is_503(client, monkeypatch):
    monkeypatch.setattr(settings, "function_selector_engine", "off")
    res = client.post(SELECT, json={"utterance": "이 병 뭐야"})
    assert res.status_code == 503 and res.json()["code"] == "FUNCTION_SELECTOR_UNAVAILABLE"


def test_select_mock_engine_uses_screen_state(client, monkeypatch, diagnosis_id):
    monkeypatch.setattr(settings, "function_selector_engine", "mock")
    on_result = client.post(SELECT, json={"utterance": "이 병 뭐야", "diagnosis_id": diagnosis_id, "ui_stage": "result"})
    assert on_result.status_code == 200
    assert on_result.json()["function_call"] == "<hs_0>(topic=1)<hs_end>"
    assert on_result.json()["context"]["ui_stage"] == "result"

    at_home = client.post(SELECT, json={"utterance": "어떻게 시작해"})
    assert at_home.json() == {"function_call": "<hs_7>(topic=1, delivery=1)<hs_end>", "context": {"ui_stage": "no_photo"}}


def test_select_unknown_diagnosis_is_404(client, monkeypatch):
    monkeypatch.setattr(settings, "function_selector_engine", "mock")
    res = client.post(SELECT, json={"utterance": "이 병 뭐야", "diagnosis_id": "nope"})
    assert res.status_code == 404


def test_select_http_engine_sends_utterance_and_context(client, monkeypatch, diagnosis_id):
    monkeypatch.setattr(settings, "function_selector_engine", "http")
    calls = []

    def fake_post(url, json, timeout):
        calls.append((url, json))
        return httpx.Response(200, json={"function_call": " <hs_1>(topic=2)<hs_end>\n"})

    monkeypatch.setattr(function_selector.httpx, "post", fake_post)
    res = client.post(SELECT, json={"utterance": "어느 후보가 높아", "diagnosis_id": diagnosis_id, "ui_stage": "result"})
    assert res.status_code == 200 and res.json()["function_call"] == "<hs_1>(topic=2)<hs_end>"
    assert calls[0][0] == settings.function_selector_url + "/select"
    assert calls[0][1]["utterance"] == "어느 후보가 높아"
    assert calls[0][1]["context"]["ui_stage"] == "result"


def test_select_http_engine_failure_is_503(client, monkeypatch):
    monkeypatch.setattr(settings, "function_selector_engine", "http")
    monkeypatch.setattr(function_selector.httpx, "post", lambda *a, **k: httpx.Response(500, text="boom"))
    res = client.post(SELECT, json={"utterance": "이 병 뭐야"})
    assert res.status_code == 503 and res.json()["retryable"] is True


# ---------- 세 단계 이어서 ----------

def test_three_steps_end_to_end_with_mocks(client, monkeypatch, diagnosis_id):
    monkeypatch.setattr(settings, "stt_engine", "mock")
    monkeypatch.setattr(settings, "function_selector_engine", "mock")
    text = client.post(TRANSCRIBE, content=_wav(), headers={"Content-Type": "audio/wav"}).json()["text"]
    call = client.post(SELECT, json={"utterance": text, "diagnosis_id": diagnosis_id, "ui_stage": "result"}).json()["function_call"]
    answer = client.post(ANSWER, json={"diagnosis_id": diagnosis_id, "function_call": call, "source": "server"})
    assert answer.status_code == 200
    assert answer.json()["function_name"] == "get_diagnosis" and answer.json()["text"].strip()
