"""음성 안내 API: /diagnose/{id}/speech/script, /diagnose/{id}/speech."""

import threading
import time
from pathlib import Path

import httpx
import pytest

from app.core.config import settings
from app.services import tts_service


@pytest.fixture
def diagnosis_id(client, sample_image) -> str:
    res = client.post("/api/v1/diagnose", files={"file": ("leaf.jpg", sample_image, "image/jpeg")})
    assert res.status_code == 200
    return res.json()["id"]


def _refuse_unlink(monkeypatch, directory):
    # 캐시 폴더의 파일만 지우지 못하게 한다 — pytest 등 다른 삭제에는 영향을 주지 않는다
    real = Path.unlink

    def refuse(self, missing_ok=False):
        if self.parent == directory:
            raise PermissionError(13, "Permission denied")
        return real(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", refuse)


def test_speech_script_endpoint(client, diagnosis_id):
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script")
    assert res.status_code == 200
    body = res.json()
    assert body["sentences"]
    assert body["text"] == " ".join(body["sentences"])


def test_speech_audio_returns_wav_and_caches(client, diagnosis_id):
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.content.startswith(b"RIFF")

    text = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").json()["text"]
    assert tts_service.cached_audio(text) is not None


def test_speech_404(client):
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/v1/diagnose/{missing}/speech").status_code == 404
    assert client.get(f"/api/v1/diagnose/{missing}/speech/script").status_code == 404


def test_speech_is_limited_to_the_device_that_made_the_diagnosis(client, diagnosis_id):
    # 이력과 같이 기기별로 분리한다. 다른 기기가 진단 ID만으로 병명·농약을 들을 수 없어야 한다
    owner_cookies = dict(client.cookies)
    client.cookies.clear()
    try:
        assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").status_code == 404
        assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 404
    finally:
        client.cookies.clear()
        client.cookies.update(owner_cookies)
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").status_code == 200


def test_speech_off_returns_503(client, diagnosis_id, monkeypatch):
    monkeypatch.setattr(settings, "tts_engine", "off")
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 503
    # 문장은 엔진과 무관하게 제공된다 — 프론트가 브라우저 음성으로 대신 읽는다
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").status_code == 200


def test_speech_http_engine_unreachable_returns_503(client, diagnosis_id, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)

    def refuse(*args, **kwargs):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(tts_service.httpx, "post", refuse)
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 503
    assert not list(tmp_path.iterdir())


def test_speech_invalid_wav_returns_503(client, diagnosis_id, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(
        tts_service.httpx, "post", lambda *a, **k: httpx.Response(200, content=b"RIFF....WAVE")
    )
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 503


def test_cache_write_failure_returns_503_and_leaves_no_temp_file(client, diagnosis_id, monkeypatch, tmp_path):
    # 디스크 부족·권한 오류가 500이 아니라 문서화한 503(브라우저 음성 대체)이어야 한다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)

    def disk_full(*args, **kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(tts_service.os, "replace", disk_full)
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 503 and res.json()["code"] == "TTS_UNAVAILABLE"
    assert not list(tmp_path.iterdir())


def test_undeletable_broken_cache_returns_503(client, diagnosis_id, monkeypatch, tmp_path):
    # 첫 캐시 조회의 오류도 500이 아니라 503(브라우저 음성 대체)이어야 한다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    text = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").json()["text"]
    tts_service._cache_path(text).write_bytes(b"broken")
    _refuse_unlink(monkeypatch, tmp_path)
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 503 and res.json()["code"] == "TTS_UNAVAILABLE"


def test_slow_synthesis_answers_503_before_the_proxy_gives_up(client, diagnosis_id, monkeypatch, tmp_path):
    # 합성이 프록시 제한(약 30초)보다 오래 걸리면 프록시 오류 대신 503을 먼저 보내야
    # 프론트가 브라우저 음성으로 대신 읽는다. 끝난 합성은 캐시에 남아 다음 요청이 바로 쓴다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tts_response_budget_seconds", 0.2)
    text = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").json()["text"]
    release, finished = threading.Event(), threading.Event()
    calls = []
    real = tts_service.synthesize

    def slow(text):
        calls.append(text)
        release.wait(30)
        try:
            return real(text)
        finally:
            finished.set()

    monkeypatch.setattr(tts_service, "synthesize", slow)
    try:
        started = time.monotonic()
        res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
        assert res.status_code == 503 and res.json()["code"] == "TTS_UNAVAILABLE"
        assert time.monotonic() - started < 10  # 합성(최대 30초)을 기다리지 않았다

        # 합성이 끝나기 전에는 자리를 계속 쥐고 있어 다음 요청도 예산 안에 503으로 끝난다
        assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 503
        assert len(calls) == 1
    finally:
        release.set()
        # 앞의 단정이 실패해도 합성 스레드가 끝난 뒤 tmp_path 정리가 일어나게 한다
        completed = finished.wait(10)
    assert completed
    assert tts_service.cached_audio(text) is not None

    def must_not_synthesize(text):
        raise AssertionError("캐시가 있으면 다시 합성하지 않아야 한다")

    monkeypatch.setattr(tts_service, "synthesize", must_not_synthesize)
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 200 and res.content.startswith(b"RIFF")


def test_cache_removed_after_lookup_still_answers_the_audio(client, diagnosis_id, monkeypatch, tmp_path):
    # 캐시를 찾은 뒤 응답을 보내기 전에 다른 요청의 보관 개수 정리가 파일을 지울 수 있다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 200
    real = tts_service.cached_audio

    def lookup_then_removed(text):
        audio = real(text)
        for wav in tmp_path.glob("*.wav"):
            wav.unlink()
        return audio

    monkeypatch.setattr(tts_service, "cached_audio", lookup_then_removed)
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 200 and res.content.startswith(b"RIFF")
