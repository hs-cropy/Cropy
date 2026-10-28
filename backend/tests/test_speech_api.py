"""음성 안내 API: /diagnose/{id}/speech/script, /diagnose/{id}/speech."""

import io
import threading
import time
import wave
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


def _sentences(client, diagnosis_id) -> list[str]:
    return client.get(f"/api/v1/diagnose/{diagnosis_id}/speech/script").json()["sentences"]


def _wav(frames: int, rate: int = 16000, width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(b"\x01" * width * frames)
    return buf.getvalue()


def test_speech_audio_joins_sentences_and_caches_each(client, diagnosis_id, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"

    sentences = _sentences(client, diagnosis_id)
    assert len(sentences) >= 2
    # 다른 진단과 겹치는 문장을 다시 쓰도록 안내문 전체가 아니라 문장마다 캐시한다
    assert all(tts_service.cached_audio(sentence) is not None for sentence in sentences)
    assert len(list(tmp_path.glob("*.wav"))) == len(set(sentences))
    with wave.open(io.BytesIO(res.content), "rb") as wav:
        rate, frames = wav.getframerate(), wav.getnframes()
    sentence_frames = 1600  # mock 엔진: 0.1초 무음
    pause_frames = int(rate * tts_service.SENTENCE_PAUSE_SECONDS)
    assert frames == sentence_frames * len(sentences) + pause_frames * (len(sentences) - 1)


def test_cached_sentences_are_not_synthesized_again(client, diagnosis_id, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 200
    sentences = _sentences(client, diagnosis_id)
    tts_service._cache_path(sentences[-1]).unlink()  # 이 진단에만 있는 문장이 하나 남았다고 본다
    calls = []
    real = tts_service.synthesize
    monkeypatch.setattr(tts_service, "synthesize", lambda text: calls.append(text) or real(text))
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 200
    assert calls == [sentences[-1]]


def test_join_wavs_pauses_between_sentences_and_rejects_mixed_formats():
    joined = tts_service.join_wavs([_wav(100), _wav(200)])
    with wave.open(io.BytesIO(joined), "rb") as wav:
        assert wav.getnframes() == 100 + int(16000 * tts_service.SENTENCE_PAUSE_SECONDS) + 200
    # 목소리를 바꾸는 중에 옛 캐시와 새 음성이 섞이면 이을 수 없다 — 503 대상 오류로 알린다
    with pytest.raises(tts_service.TTSUnavailableError):
        tts_service.join_wavs([_wav(100, rate=16000), _wav(100, rate=44100)])
    with pytest.raises(tts_service.TTSUnavailableError):
        tts_service.join_wavs([])


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
    tts_service._cache_path(_sentences(client, diagnosis_id)[0]).write_bytes(b"broken")
    _refuse_unlink(monkeypatch, tmp_path)
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 503 and res.json()["code"] == "TTS_UNAVAILABLE"


def test_slow_synthesis_answers_503_before_the_proxy_gives_up(client, diagnosis_id, monkeypatch, tmp_path):
    # 합성이 프록시 제한(약 30초)보다 오래 걸리면 프록시 오류 대신 503을 먼저 보내야
    # 프론트가 브라우저 음성으로 대신 읽는다. 끝난 문장은 캐시에 남아 다음 요청은 남은 문장만 합성한다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tts_response_budget_seconds", 0.2)
    sentences = _sentences(client, diagnosis_id)
    assert len(sentences) >= 2
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
        assert calls == [sentences[0]]
    finally:
        release.set()
        # 앞의 단정이 실패해도 합성 스레드가 끝난 뒤 tmp_path 정리가 일어나게 한다
        completed = finished.wait(10)
    assert completed
    assert tts_service.cached_audio(sentences[0]) is not None

    # 다음 요청은 캐시된 첫 문장을 다시 합성하지 않고 남은 문장만 만든다
    later = []
    monkeypatch.setattr(tts_service, "synthesize", lambda text: later.append(text) or real(text))
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 200 and res.content.startswith(b"RIFF")
    assert later == list(dict.fromkeys(s for s in sentences[1:] if s != sentences[0]))


def test_budget_covers_the_whole_request_not_each_sentence(client, diagnosis_id, monkeypatch, tmp_path):
    # 문장마다 예산을 새로 주면 문장 수만큼 늘어나 프록시 제한을 넘긴다. 요청 전체에 한 번만 쓴다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tts_response_budget_seconds", 0.3)
    sentences = _sentences(client, diagnosis_id)
    assert len(set(sentences)) >= 2
    real = tts_service.synthesize
    done = []

    def each_takes_0_2s(text):
        time.sleep(0.2)
        try:
            return real(text)
        finally:
            done.append(text)

    monkeypatch.setattr(tts_service, "synthesize", each_takes_0_2s)
    started = time.monotonic()
    res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
    assert res.status_code == 503  # 문장 하나는 0.3초 안이지만 둘째 문장에서 전체 예산을 넘는다
    assert time.monotonic() - started < 2
    # 예산이 지난 뒤에도 하던 합성은 끝까지 해 캐시에 남긴다 — 그 뒤 tmp_path가 정리되게 기다린다
    deadline = time.monotonic() + 5
    while len(done) < 2 and time.monotonic() < deadline:
        time.sleep(0.05)
    assert len(done) == 2


@pytest.mark.parametrize("step", ["cached_audio", "join_wavs"])
def test_slow_cache_lookup_or_join_answers_503_within_budget(client, diagnosis_id, monkeypatch, tmp_path, step):
    # 합성뿐 아니라 캐시 조회·잇기도 예산 안에 끝나야 한다 — 디스크나 스레드풀이 밀려도
    # 프록시 제한 전에 503을 보내 프론트가 브라우저 음성으로 대신 읽게 한다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    assert client.get(f"/api/v1/diagnose/{diagnosis_id}/speech").status_code == 200  # 모든 문장 캐시
    monkeypatch.setattr(settings, "tts_response_budget_seconds", 0.2)
    release, finished = threading.Event(), threading.Event()
    real = getattr(tts_service, step)

    def slow(*args):
        release.wait(30)
        try:
            return real(*args)
        finally:
            finished.set()

    monkeypatch.setattr(tts_service, step, slow)
    try:
        started = time.monotonic()
        res = client.get(f"/api/v1/diagnose/{diagnosis_id}/speech")
        assert res.status_code == 503 and res.json()["code"] == "TTS_UNAVAILABLE"
        assert time.monotonic() - started < 10  # 느린 조회·잇기(최대 30초)를 기다리지 않았다
    finally:
        release.set()
        # 앞의 단정이 실패해도 스레드가 끝난 뒤 tmp_path 정리가 일어나게 한다
        completed = finished.wait(10)
    assert completed


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


# ── Range ────────────────────────────────────────────────────────────────────


def _speech(client, diagnosis_id, range_header=None, if_range=None):
    headers = {"Range": range_header} if range_header else {}
    if if_range:
        headers["If-Range"] = if_range
    return client.get(f"/api/v1/diagnose/{diagnosis_id}/speech", headers=headers)


def test_speech_supports_a_single_byte_range(client, diagnosis_id):
    # iOS Safari의 <audio>는 바이트 범위 요청으로 길이를 확인하고 탐색한다
    full = _speech(client, diagnosis_id)
    assert full.status_code == 200 and full.headers["accept-ranges"] == "bytes"
    audio, size = full.content, len(full.content)

    head = _speech(client, diagnosis_id, "bytes=0-1")
    assert head.status_code == 206 and head.content == audio[:2]
    assert head.headers["content-range"] == f"bytes 0-1/{size}"
    assert _speech(client, diagnosis_id, "bytes=-4").content == audio[-4:]
    assert _speech(client, diagnosis_id, f"bytes=10-{size + 100}").content == audio[10:]

    assert _speech(client, diagnosis_id, "Bytes=0-1").content == audio[:2]

    beyond = _speech(client, diagnosis_id, f"bytes={size}-")
    assert beyond.status_code == 416 and beyond.headers["content-range"] == f"bytes */{size}"


def test_speech_range_follows_if_range(client, diagnosis_id):
    # 음성 내용이 바뀐 뒤 옛 조각에 이어 붙이는 요청에는 새 음성 전체를 보낸다
    full = _speech(client, diagnosis_id)
    etag = full.headers["etag"]
    assert _speech(client, diagnosis_id, "bytes=0-1", etag).status_code == 206
    for stale in ['"other-audio"', "Wed, 21 Oct 2026 07:28:00 GMT"]:
        res = _speech(client, diagnosis_id, "bytes=0-1", stale)
        assert res.status_code == 200 and res.content == full.content


@pytest.mark.parametrize(
    "range_header",
    ["bytes=0-1,4-5", "items=0-1", "bytes=5-2", "bytes=-",
     "bytes=" + "9" * 4301 + "-", "bytes=0-" + "9" * 4301, "bytes=-" + "9" * 4301],
    ids=["multi", "other-unit", "reversed", "empty", "huge-start", "huge-end", "huge-suffix"],
)
def test_speech_ignores_ranges_it_cannot_serve(client, diagnosis_id, range_header):
    # 아주 긴 숫자도 500이 아니라 무시하고 전체를 보낸다
    res = _speech(client, diagnosis_id, range_header)
    assert res.status_code == 200 and res.content == _speech(client, diagnosis_id).content
