"""음성(wav) → 문장. 실제 인식은 별도 STT 서버(stt/server.py, sherpa-onnx SenseVoice)가 맡는다.

  STT_ENGINE=off   — 음성 인식 비활성 (기본). 엔드포인트가 503을 돌려준다.
  STT_ENGINE=mock  — 고정 문장. STT 서버 없이 음성 흐름 전체를 테스트할 때.
  STT_ENGINE=http  — STT_SERVER_URL의 /transcribe 호출 (본문 wav, 응답 {"text": ...}).

학습 데이터에는 문장부호가 없으므로 STT 결과의 문장부호를 지운 뒤 돌려준다(공개 보고서 09절).
"""

import logging
import re

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MOCK_TEXT = "이 병 약 얼마나 타서 뿌려"

# STT가 붙이는 쉼표·마침표·물음표와 말줄임. 숫자 사이 소수점은 남긴다
_PUNCTUATION = re.compile(r"(?<!\d)[.,!?;:…~](?!\d)|[.,!?;:…~]$")
_SPACES = re.compile(r"\s+")


class STTUnavailableError(RuntimeError):
    """문장을 만들 수 없음 — 엔진이 꺼져 있거나 STT 서버가 응답하지 않음."""


class InvalidAudioError(ValueError):
    """STT 서버가 음성 파일을 받아들이지 않음(형식·크기)."""


def normalize_transcript(text: str) -> str:
    """문장부호 제거, 공백 정리. 모델 학습 문장과 같은 꼴로 맞춘다."""
    cleaned = _PUNCTUATION.sub(" ", text)
    return _SPACES.sub(" ", cleaned).strip()


def transcribe(audio_wav: bytes) -> str:
    engine = settings.stt_engine
    if engine == "off":
        raise STTUnavailableError("STT_ENGINE=off")
    if engine == "mock":
        return MOCK_TEXT

    try:
        response = httpx.post(f"{settings.stt_server_url.rstrip('/')}/transcribe", content=audio_wav,
                              headers={"Content-Type": "audio/wav"}, timeout=settings.stt_timeout_seconds)
    except httpx.HTTPError as exc:
        logger.warning("STT server unreachable: %s", exc)
        raise STTUnavailableError(str(exc)) from exc

    if response.status_code in (400, 413):
        detail = _detail(response)
        raise InvalidAudioError(detail or "음성 파일을 읽을 수 없습니다.")
    if response.status_code != 200:
        logger.warning("STT server returned %s: %s", response.status_code, response.text[:200])
        raise STTUnavailableError(f"status {response.status_code}")

    try:
        text = response.json().get("text")
    except ValueError as exc:
        raise STTUnavailableError("invalid STT response") from exc
    if not isinstance(text, str):
        raise STTUnavailableError("invalid STT response")
    return normalize_transcript(text)


def _detail(response: httpx.Response) -> str | None:
    try:
        detail = response.json().get("detail")
    except ValueError:
        return None
    return detail if isinstance(detail, str) else None
