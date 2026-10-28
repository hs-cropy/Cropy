"""TTS 서비스: 엔진 호출, wav 검증, 캐시."""

import io
import os
import threading
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


def test_different_speeds_never_share_a_cache_file(monkeypatch, tmp_path):
    # 캐시 키에 서버로 보내는 속도를 그대로 넣는다. 반올림하면 0.901과 0.904가 같은 파일을 쓴다
    monkeypatch.setattr(settings, "tts_engine", "http")
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    speeds = []

    def fake_post(url, json, timeout):
        speeds.append(json["speed"])
        return httpx.Response(200, content=_wav_bytes())

    monkeypatch.setattr(tts_service.httpx, "post", fake_post)
    for speed in (0.901, 0.904, 0.901):
        monkeypatch.setattr(settings, "tts_speed", speed)
        tts_service.synthesize("안녕하세요")
    assert speeds == [0.901, 0.904]  # 세 번째(0.901)는 첫 번째의 캐시를 쓴다
    assert len(list(tmp_path.glob("*.wav"))) == 2


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


# ── 보관 개수 상한과 동시 접근 ────────────────────────────────────────────────


def test_cache_keeps_only_the_most_recently_used_files(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tts_cache_max_files", 2)
    for index, text in enumerate(["하나", "둘", "셋"]):
        tts_service.synthesize(text)
        os.utime(tts_service._cache_path(text), (1000 + index, 1000 + index))
    assert tts_service.cached_audio("하나") is None  # 가장 오래 안 쓴 파일이 지워졌다
    assert len(list(tmp_path.glob("*.wav"))) == 2


def test_cache_lookup_marks_the_file_as_recently_used(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tts_cache_max_files", 2)
    for index, text in enumerate(["하나", "둘"]):
        tts_service.synthesize(text)
        os.utime(tts_service._cache_path(text), (1000 + index, 1000 + index))
    assert tts_service.cached_audio("하나") is not None  # 다시 들었으니 최근 사용
    tts_service.synthesize("셋")
    assert tts_service.cached_audio("하나") is not None
    assert tts_service.cached_audio("둘") is None


def test_prune_failure_still_returns_the_new_audio(monkeypatch, tmp_path):
    # 오래된 캐시를 못 지워도(Windows에서 다른 요청이 열어 둔 파일 등) 새 음성은 돌려준다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tts_cache_max_files", 1)
    tts_service.synthesize("하나")
    os.utime(tts_service._cache_path("하나"), (1000, 1000))
    _refuse_unlink(monkeypatch, tmp_path)
    assert tts_service.synthesize("둘").startswith(b"RIFF")


class _WatchedLock:
    """다른 요청이 잠금에 막히는 순간을 알린다 — 시간 대기 없이 실행 순서를 확인하기 위함."""

    def __init__(self, lock, blocked):
        self.lock, self.blocked = lock, blocked

    def __enter__(self):
        if not self.lock.acquire(blocking=False):
            self.blocked.set()
            self.lock.acquire()

    def __exit__(self, *exc):
        self.lock.release()


def test_late_broken_cache_cleanup_keeps_a_newly_saved_wav(monkeypatch, tmp_path):
    # 깨진 파일을 읽은 요청이 늦게 지우면서, 그사이 다른 요청이 저장한 정상 파일을 지우면 안 된다
    monkeypatch.setattr(settings, "tts_cache_dir", tmp_path)
    path = tts_service._cache_path("안녕하세요")
    path.write_bytes(b"broken")
    # 다른 요청이 잠금에 막혔거나(정상) 저장까지 끝냈을 때(잠금이 없을 때) 이 요청이 판정을 이어간다
    progress = threading.Event()
    real_lock, real_validate = tts_service._file_lock, tts_service._validate_wav
    monkeypatch.setattr(tts_service, "_file_lock", lambda p: _WatchedLock(real_lock(p), progress))

    def other_request():
        try:
            tts_service.synthesize("안녕하세요")
        finally:
            progress.set()

    other = threading.Thread(target=other_request)

    def validate_while_other_request_saves(audio):
        if audio == b"broken" and threading.current_thread() is not other and not other.ident:
            other.start()
            assert progress.wait(5)
        real_validate(audio)

    monkeypatch.setattr(tts_service, "_validate_wav", validate_while_other_request_saves)
    try:
        assert tts_service.cached_audio("안녕하세요") is None
    finally:
        if other.ident:
            other.join(5)
    assert not other.is_alive()
    assert path.read_bytes().startswith(b"RIFF")
