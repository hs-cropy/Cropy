"""TTS 서버 — 사전학습 MeloTTS 한국어 기본 목소리로 문장을 wav로 합성한다.

백엔드(app/services/tts_service.py, TTS_ENGINE=http)가 호출한다.
MeloTTS는 의존성(구버전 transformers 등)이 백엔드와 충돌해 별도 Python 3.11 환경에서 띄운다.

    tts/.venv/Scripts/python -m uvicorn server:app --app-dir tts --host 127.0.0.1 --port 8100

    POST /synthesize  {"text": "고추 탄저병으로 보여요.", "speed": 0.9}  → audio/wav
    GET  /health      모델·화자·샘플레이트

숫자·기호를 한글로 풀어 쓰는 일은 백엔드(speech_script.normalize_for_tts)가 이미 했다고 가정한다.
"""

import importlib.machinery
import io
import logging
import os
import sys
import threading
import types
import wave
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

LANGUAGE = os.getenv("TTS_LANGUAGE", "KR")
SPEAKER = os.getenv("TTS_SPEAKER", "KR")
DEVICE = os.getenv("TTS_DEVICE", "cpu")
# 백엔드 낭독 문장은 길어야 300자 안팎이다. 이보다 길면 요청 하나가 CPU를 오래 붙잡는다
MAX_CHARS = 1000

logger = logging.getLogger("tts")

# MeloTTS 모델 객체는 동시 호출을 고려하지 않았다. 합성은 한 번에 하나씩 한다
_lock = threading.Lock()
_state: dict = {}


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    speed: float = Field(default=1.0, ge=0.5, le=1.5)


def _register_korean_analyzer() -> None:
    """g2pkk(MeloTTS의 한국어 발음 변환)가 찾는 형태소 분석기를 pecab으로 연결한다.

    g2pkk는 윈도우에선 'eunjeon', 그 밖에선 'mecab'(python-mecab-ko)을 찾고, 없으면 실행 중에
    `pip install`을 직접 실행한다. eunjeon은 C++ 빌드 도구가 있어야 설치되고, python-mecab-ko는
    윈도우에서 일본어용 'MeCab' 패키지와 폴더가 겹친다(대소문자를 구분하지 않으므로).
    pecab은 같은 사전(mecab-ko-dic) 결과를 내는 순수 파이썬 구현이라 어느 플랫폼에서나 그대로 동작한다.
    """
    from pecab import PeCab

    analyzer = PeCab()
    for name in ("eunjeon", "mecab"):
        module = types.ModuleType(name)
        # __spec__이 있어야 g2pkk의 importlib.util.find_spec이 '설치됨'으로 보고 pip를 부르지 않는다
        module.__spec__ = importlib.machinery.ModuleSpec(name, None)
        module.Mecab = module.MeCab = lambda: analyzer  # eunjeon.Mecab() / mecab.MeCab()
        sys.modules[name] = module


def _load_model() -> None:
    # MeloTTS는 한국어만 써도 일본어 모듈까지 불러오며 MeCab 사전을 연다. MeCab은 'unidic'을
    # 먼저 찾는데, 이 패키지는 사전 데이터(약 770MB)를 따로 내려받아야 해서 설치 직후엔 비어 있다.
    # 가져오기를 막아 함께 설치된 unidic-lite(경량 사전)를 쓰게 한다. 한국어 합성과는 무관하다.
    sys.modules.setdefault("unidic", None)
    _register_korean_analyzer()
    from melo.api import TTS

    model = TTS(language=LANGUAGE, device=DEVICE)
    speakers = model.hps.data.spk2id
    if SPEAKER not in speakers:
        raise RuntimeError(f"화자 '{SPEAKER}'가 없습니다. 사용 가능: {list(speakers)}")
    _state.update(model=model, speaker_id=speakers[SPEAKER], sample_rate=model.hps.data.sampling_rate)


def _to_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    pcm = (np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buf.getvalue()


def _synthesize(text: str, speed: float) -> bytes:
    with _lock:
        # output_path=None이면 파일로 쓰지 않고 오디오 배열을 돌려준다
        audio = _state["model"].tts_to_file(text, _state["speaker_id"], None, speed=speed, quiet=True)
    return _to_wav(audio, _state["sample_rate"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 첫 실행 때 체크포인트와 BERT를 내려받는다(수백 MB). 첫 요청이 아니라 기동 시점에 치른다
    _load_model()
    _synthesize("안녕하세요.", 1.0)  # 예열 — 첫 합성은 그래프 준비로 느리다
    logger.info("MeloTTS %s/%s 준비 완료 (%d Hz)", LANGUAGE, SPEAKER, _state["sample_rate"])
    yield


app = FastAPI(title="CropCare TTS", lifespan=lifespan)


@app.get("/health")
async def health():
    # 이벤트 루프에서 바로 답한다 — 합성을 기다리는 요청이 스레드풀을 모두 차지해도 늦어지지 않는다
    return {
        "status": "ok",
        "model": f"melotts-{LANGUAGE.lower()}-pretrained",
        "speaker": SPEAKER,
        "sample_rate": _state["sample_rate"],
    }


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    # 동기 함수라 스레드풀(기본 40개)에서 돈다. 합성은 _lock으로 하나씩이라 나머지 요청은 스레드를 쥔 채 기다린다
    try:
        audio = _synthesize(req.text, req.speed)
    except Exception:
        logger.exception("synthesis failed")
        raise HTTPException(status_code=500, detail="음성 합성에 실패했습니다.")
    return Response(content=audio, media_type="audio/wav")
