"""TTS 서비스: 엔진 호출, wav 검증, 캐시."""

import io
import wave
from pathlib import Path

import httpx
import pytest

from app.core.config import settings
from app.services import tts_service


def _wav_bytes(frames: int = 160) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x01\x00" * frames)
    return buf.getvalue()


def _refuse_unlink(monkeypatch, directory):
    # 캐시 폴더의 파일만 지우지 못하게 한다 — pytest 등 다른 삭제에는 영향을 주지 않는다
    real = Path.unlink

    def refuse(self, missing_ok=False):
        if self.parent == directory:
            raise PermissionError(13, "Permission denied")
        return real(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", refuse)


def test_off_engine_refuses_without_touching_the_cache(monkeypatch, tmp_path):
    # 기본값 off: 음성 API가 503을 보내고 프론트는 브라우저 음성으로 대신 읽는다
    monkeypatch.setattr(settings, "tts_engine", "off")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    with pytest.raises(tts_service.TTSUnavailableError):
        tts_service.synthesize("안녕하세요")
    assert not list(tmp_path.iterdir())


def test_mock_engine_returns_and_caches_a_wav(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    audio = tts_service.synthesize("안녕하세요")
    assert audio.startswith(b"RIFF")
    assert tts_service.cached_audio("안녕하세요") == audio


def test_http_engine_sends_text_and_speed(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    calls = []

    def fake_post(url, json, timeout):
        calls.append((url, json))
        return httpx.Response(200, content=_wav_bytes())

    monkeypatch.setattr(tts_service.httpx, "post", fake_post)
    audio = tts_service.synthesize("안녕하세요")
    assert audio.startswith(b"RIFF")
    assert calls[0][0].endswith("/synthesize")
    assert calls[0][1] == {"text": "안녕하세요", "speed": settings.tts_speed}

    tts_service.synthesize("안녕하세요")
    assert len(calls) == 1  # 두 번째는 캐시


def test_http_engine_unreachable_raises_tts_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)

    def refuse(*args, **kwargs):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(tts_service.httpx, "post", refuse)
    with pytest.raises(tts_service.TTSUnavailableError):
        tts_service.synthesize("안녕하세요")
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize(
    "body",
    [
        b"<html>",
        b"RIFF....WAVE",  # 헤더만 그럴듯한 응답
        _wav_bytes()[:-50],  # 데이터가 선언보다 짧은 잘린 wav
        _wav_bytes(frames=0),  # 오디오가 없는 wav
    ],
    ids=["html", "riff-only", "truncated", "empty"],
)
def test_http_engine_rejects_invalid_wav(monkeypatch, tmp_path, body):
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(tts_service.httpx, "post", lambda *a, **k: httpx.Response(200, content=body))
    with pytest.raises(tts_service.TTSUnavailableError):
        tts_service.synthesize("안녕하세요")
    # 깨진 응답은 캐시에 남지 않아야 다음 요청이 다시 합성을 시도한다
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize("broken", [b"", b"broken", _wav_bytes()[:-50]], ids=["empty", "not-wav", "truncated"])
def test_broken_cache_file_is_discarded_and_resynthesized(monkeypatch, tmp_path, broken):
    # 전원 차단 등으로 깨진 캐시를 정상 음성으로 계속 돌려주면 안 된다
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    tts_service._cache_path("안녕하세요").write_bytes(broken)
    calls = []
    monkeypatch.setattr(tts_service.httpx, "post",
                        lambda *a, **k: calls.append(1) or httpx.Response(200, content=_wav_bytes()))

    assert tts_service.cached_audio("안녕하세요") is None
    audio = tts_service.synthesize("안녕하세요")
    assert len(calls) == 1 and audio == _wav_bytes()
    assert tts_service._cache_path("안녕하세요").read_bytes() == _wav_bytes()


def test_undeletable_broken_cache_raises_tts_unavailable(monkeypatch, tmp_path):
    # 지우지 못한 깨진 파일을 정상 음성으로 돌려줄 수는 없다 — 500이 아니라 503 대상 오류로 알린다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    tts_service._cache_path("안녕하세요").write_bytes(b"broken")
    _refuse_unlink(monkeypatch, tmp_path)
    with pytest.raises(tts_service.TTSUnavailableError, match="지우지 못했습니다"):
        tts_service.cached_audio("안녕하세요")


def test_cache_write_failure_raises_and_leaves_no_temp_file(monkeypatch, tmp_path):
    # 디스크 부족·권한 오류도 503 대상 오류로 바꿔 프론트가 브라우저 음성으로 대신 읽게 한다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)

    def disk_full(*args, **kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(tts_service.os, "replace", disk_full)
    with pytest.raises(tts_service.TTSUnavailableError, match="저장하지 못했습니다"):
        tts_service.synthesize("안녕하세요")
    assert not list(tmp_path.iterdir())


def test_temp_cleanup_failure_keeps_the_original_error(monkeypatch, tmp_path):
    # 임시 파일 정리 실패가 저장 실패(503 대상)를 덮어 500이 되면 안 된다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)

    def disk_full(*args, **kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(tts_service.os, "replace", disk_full)
    _refuse_unlink(monkeypatch, tmp_path)
    with pytest.raises(tts_service.TTSUnavailableError, match="저장하지 못했습니다"):
        tts_service.synthesize("안녕하세요")
