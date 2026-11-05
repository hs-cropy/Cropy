"""STT 서버 — sherpa-onnx로 SenseVoice-Small을 CPU에서 돌려 한국어 음성을 글자로 바꾼다.

    stt/.venv/Scripts/python -m uvicorn server:app --app-dir stt --host 127.0.0.1 --port 8200

    POST /transcribe  body: wav(16비트 PCM, 모노/스테레오, 샘플레이트 무관) → {"text": ..., ...}
    GET  /health      모델·스레드·VAD 사용 여부

처리 순서: wav 읽기 → 16kHz 모노 → VAD로 말소리 구간만 자름 → SenseVoice 인식 → 농업 용어 보정(lexicon.py).
보드(오렌지파이 5)에서는 NPU를 Qwen(RKLLM)이 쓰므로 이 서버는 CPU 전용이다. 큰 코어(A76)에 고정해 띄운다.
"""

import io
import logging
import os
import threading
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from lexicon import Lexicon, load_terms

HERE = Path(__file__).resolve().parent
MODEL_DIR = Path(os.getenv("STT_MODEL_DIR", HERE / "models"))
# sherpa-onnx의 'sense-voice-...-int8-2025-09-09' 패키지는 광둥어 미세조정판이라 한국어가 중국어로 나온다.
# 반드시 2024-07-17 원본을 쓴다 (download_models.py가 받는 파일)
SENSEVOICE_DIR = MODEL_DIR / "sense-voice-2024-07-17"
VAD_MODEL = MODEL_DIR / "silero_vad.onnx"
TERMS_FILE = Path(os.getenv("STT_TERMS", HERE / "terms.txt"))
THREADS = int(os.getenv("STT_THREADS", "2"))
USE_VAD = os.getenv("STT_VAD", "1") != "0"

SAMPLE_RATE = 16000
MAX_SECONDS = 30  # 농가 질문은 길어야 10초 안팎이다. 이보다 길면 CPU를 오래 붙잡는다
MAX_BYTES = 6 * 1024 * 1024  # 48kHz 스테레오 30초가 약 5.8MB
VAD_WINDOW = 512  # silero VAD가 16kHz에서 받는 묶음 크기

logger = logging.getLogger("stt")

# 인식기·VAD 객체는 하나를 같이 쓴다. 인식은 한 번에 하나씩 한다 — 보드에서 동시에 돌리면 둘 다 느려진다
_lock = threading.Lock()
_state: dict = {}


class AudioError(ValueError):
    """받을 수 없는 오디오 — 메시지는 그대로 응답에 싣는다."""


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    """16비트 PCM wav → float32 모노 [-1, 1]와 원래 샘플레이트."""
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels, width, rate, frames = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
            if width != 2:
                raise AudioError("16비트 PCM wav만 받습니다.")
            if frames / rate > MAX_SECONDS:
                raise AudioError(f"{MAX_SECONDS}초보다 긴 음성은 받지 않습니다.")
            pcm = np.frombuffer(wav.readframes(frames), dtype="<i2")
    except (wave.Error, EOFError) as exc:
        raise AudioError("wav 파일이 아닙니다.") from exc
    samples = pcm.astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples[: len(samples) // channels * channels].reshape(-1, channels).mean(axis=1)
    return samples, rate


def to_16k(samples: np.ndarray, rate: int) -> np.ndarray:
    # VAD가 16kHz만 받는다. 말소리 인식에는 선형 보간으로 충분하다
    if rate == SAMPLE_RATE or len(samples) == 0:
        return samples
    n = int(round(len(samples) * SAMPLE_RATE / rate))
    return np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples).astype(np.float32)


def _require(path: Path) -> str:
    if not path.is_file():
        raise RuntimeError(f"모델 파일이 없습니다: {path} — stt/download_models.py를 먼저 실행하세요.")
    return str(path)


def _load() -> None:
    import sherpa_onnx

    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=_require(SENSEVOICE_DIR / "model.int8.onnx"),
        tokens=_require(SENSEVOICE_DIR / "tokens.txt"),
        num_threads=THREADS,
        language="ko",
        use_itn=True,  # 숫자·문장부호를 넣어 준다 ("몇 퍼센트" → "몇 퍼센트로", "2퍼센트")
    )
    vad = None
    if USE_VAD:
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = _require(VAD_MODEL)
        config.silero_vad.threshold = 0.5
        config.silero_vad.min_silence_duration = 0.3
        config.silero_vad.min_speech_duration = 0.2
        config.silero_vad.max_speech_duration = MAX_SECONDS
        config.silero_vad.window_size = VAD_WINDOW
        config.sample_rate = SAMPLE_RATE
        config.num_threads = 1
        vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=MAX_SECONDS + 5)
    _state.update(recognizer=recognizer, vad=vad, lexicon=Lexicon(load_terms(TERMS_FILE)))


def _decode(samples: np.ndarray) -> str:
    recognizer = _state["recognizer"]
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    return stream.result.text.strip()


def _speech_segments(samples: np.ndarray) -> list[np.ndarray]:
    vad = _state["vad"]
    vad.reset()
    for start in range(0, len(samples), VAD_WINDOW):
        vad.accept_waveform(samples[start:start + VAD_WINDOW])
    vad.flush()
    segments = []
    while not vad.empty():
        segments.append(np.asarray(vad.front.samples, dtype=np.float32))
        vad.pop()
    return segments


def transcribe(samples: np.ndarray) -> dict:
    started = time.perf_counter()
    with _lock:
        segments = _speech_segments(samples) if _state["vad"] is not None else [samples]
        raw = " ".join(text for text in (_decode(seg) for seg in segments) if text)
    text, corrections = _state["lexicon"].correct(raw)
    return {
        "text": text,
        "raw_text": raw,
        "corrections": [{"heard": c.heard, "term": c.term} for c in corrections],
        "speech": bool(segments) and bool(raw),
        "audio_seconds": round(len(samples) / SAMPLE_RATE, 2),
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load()
    # 예열 — 첫 인식은 그래프 준비로 느리다. VAD를 거치지 않고 인식기만 데운다
    _decode(np.zeros(SAMPLE_RATE, dtype=np.float32))
    logger.info("SenseVoice 준비 완료 (스레드 %d, VAD %s)", THREADS, "켜짐" if _state["vad"] else "꺼짐")
    yield


app = FastAPI(title="CropCare STT", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "sensevoice-small-2024-07-17-int8",
        "threads": THREADS,
        "vad": _state.get("vad") is not None,
        "terms": len(_state["lexicon"].terms),
    }


@app.post("/transcribe")
async def transcribe_endpoint(request: Request):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="음성 파일이 너무 큽니다.")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="음성이 비어 있습니다.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="음성 파일이 너무 큽니다.")
    try:
        samples, rate = read_wav(data)
    except AudioError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        return await run_in_threadpool(transcribe, to_16k(samples, rate))
    except Exception:
        logger.exception("transcription failed")
        raise HTTPException(status_code=500, detail="음성 인식에 실패했습니다.")
