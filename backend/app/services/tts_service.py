"""낭독 문장 → wav. 실제 합성은 별도 TTS 서버(tts/server.py)가 맡는다.

TTS 모델(MeloTTS 등)은 의존성이 백엔드와 충돌하고 CPU를 오래 점유하므로
같은 프로세스에 올리지 않는다. 백엔드는 HTTP로 문장을 넘기고 결과를 캐시한다.

  TTS_ENGINE=off   — 음성 비활성 (기본). 엔드포인트가 503을 돌려주고
                     프론트는 브라우저 내장 음성으로 대신 읽는다.
  TTS_ENGINE=mock  — 짧은 무음 wav. TTS 서버 없이 전 구간을 테스트할 때.
  TTS_ENGINE=http  — TTS_SERVER_URL의 /synthesize 호출.
"""

import hashlib
import io
import logging
import os
import wave
from pathlib import Path
from uuid import uuid4

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class TTSUnavailableError(RuntimeError):
    """음성을 만들 수 없음 — 엔진이 꺼져 있거나 TTS 서버가 응답하지 않음."""


def _cache_key(text: str) -> str:
    # 목소리(모델)나 속도가 바뀌면 같은 문장이라도 다른 파일이어야 한다
    material = "|".join([settings.tts_engine, settings.tts_voice, f"{settings.tts_speed:.2f}", text])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _cache_path(text: str) -> Path:
    return settings.tts_cache_dir / f"{_cache_key(text)}.wav"


def cached_audio(text: str) -> bytes | None:
    """검증된 캐시 wav의 내용. 전원 차단 등으로 깨진 파일은 지워서 다음 요청이 다시 합성하게 한다.

    경로가 아니라 이미 읽은 바이트를 돌려준다 — 응답을 보내는 사이 파일이 지워지거나
    바뀌어도 영향을 받지 않게 하기 위함이다.
    """
    path = _cache_path(text)
    try:
        audio = path.read_bytes()
        _validate_wav(audio)
    except FileNotFoundError:
        return None
    except (OSError, TTSUnavailableError):
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            # 지우지 못한 깨진 파일을 정상 음성으로 돌려줄 수는 없다
            raise TTSUnavailableError(f"깨진 음성 캐시를 지우지 못했습니다: {exc}") from exc
        return None
    return audio


def _mock_wav() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 1600)  # 0.1초 무음
    return buf.getvalue()


def _request_wav(text: str) -> bytes:
    try:
        res = httpx.post(
            f"{settings.tts_server_url.rstrip('/')}/synthesize",
            json={"text": text, "speed": settings.tts_speed},
            timeout=settings.tts_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise TTSUnavailableError(f"TTS 서버에 연결할 수 없습니다: {exc}") from exc
    if res.status_code != 200:
        raise TTSUnavailableError(f"TTS 서버 오류 {res.status_code}: {res.text[:200]}")
    return res.content


def _validate_wav(audio: bytes) -> None:
    """캐시에 깨진 파일이 남으면 같은 문장을 다시 합성하지 않고 계속 깨진 음성을 돌려준다.

    헤더 4바이트만으로는 부족하다 — 실제로 파싱해 오디오 데이터가 선언한 만큼 있는지 본다.
    """
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav:
            channels, width, rate, frames = (
                wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
            )
            data = wav.readframes(frames)
    except (wave.Error, EOFError) as exc:
        raise TTSUnavailableError(f"TTS 서버가 올바르지 않은 wav를 반환했습니다: {exc}") from exc
    if channels < 1 or width < 1 or rate < 1 or frames < 1:
        raise TTSUnavailableError("TTS 서버가 빈 wav를 반환했습니다.")
    if len(data) != frames * channels * width:
        raise TTSUnavailableError("TTS 서버가 잘린 wav를 반환했습니다.")


def synthesize(text: str) -> bytes:
    """문장을 wav로 합성해 캐시에 저장하고 그 내용을 반환한다. 이미 있으면 재합성하지 않는다."""
    if settings.tts_engine == "off":
        raise TTSUnavailableError("TTS가 비활성화되어 있습니다 (TTS_ENGINE=off).")

    cached = cached_audio(text)
    if cached is not None:
        return cached

    audio = _mock_wav() if settings.tts_engine == "mock" else _request_wav(text)
    _validate_wav(audio)

    path = _cache_path(text)
    tmp = path.with_suffix(f".{uuid4().hex}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(audio)
        os.replace(tmp, path)  # 동시 요청이 반쯤 쓰인 파일을 읽지 않도록 원자적으로 교체
    except OSError as exc:
        # 디스크 부족·권한 문제. 문서화한 503으로 알려 프론트가 브라우저 음성으로 대신 읽게 한다
        try:
            tmp.unlink(missing_ok=True)
        except OSError as cleanup_exc:
            logger.warning("TTS temp file cleanup failed for %s: %s", tmp.name, cleanup_exc)
        raise TTSUnavailableError(f"음성 캐시에 저장하지 못했습니다: {exc}") from exc
    return audio
