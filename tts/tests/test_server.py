"""TTS 서버 테스트 — 가짜 MeloTTS로 돌려 모델·PyTorch 없이 실행한다.

    tts/.venv/Scripts/python -m pytest tts/tests
"""

import io
import sys
import types
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

SAMPLE_RATE = 44100
AUDIO = np.array([-2.0, -0.5, 0.0, 0.5, 2.0], dtype=np.float32)  # 범위 밖 값은 잘라서 쓴다


@pytest.fixture
def model(monkeypatch):
    """melo.api.TTS와 pecab을 가짜로 바꾼다. behavior를 바꿔 실패를 주입한다."""
    behavior = SimpleNamespace(init_error=None, synth_error=None, speakers={"KR": 0}, calls=[])

    class FakeTTS:
        def __init__(self, language, device):
            if behavior.init_error:
                raise behavior.init_error
            self.hps = SimpleNamespace(data=SimpleNamespace(spk2id=behavior.speakers, sampling_rate=SAMPLE_RATE))

        def tts_to_file(self, text, speaker_id, output_path, speed=1.0, quiet=False):
            behavior.calls.append((text, speaker_id, output_path, speed))
            if behavior.synth_error:
                raise behavior.synth_error
            return AUDIO

    melo, api, pecab = (types.ModuleType(name) for name in ("melo", "melo.api", "pecab"))
    api.TTS, melo.api, pecab.PeCab = FakeTTS, api, object
    for name, module in {"melo": melo, "melo.api": api, "pecab": pecab}.items():
        monkeypatch.setitem(sys.modules, name, module)
    # _load_model이 sys.modules에 넣는 형태소 분석기·unidic 자리는 테스트가 끝나면 되돌린다
    saved = {name: sys.modules.get(name) for name in ("eunjeon", "mecab", "unidic")}
    monkeypatch.setattr(server, "_state", {})
    yield behavior
    for name, module in saved.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


@pytest.fixture
def client(model):
    with TestClient(server.app) as test_client:  # lifespan: 모델 로드와 예열
        yield test_client


def test_startup_loads_and_warms_up_the_model(client, model):
    assert model.calls == [("안녕하세요.", 0, None, 1.0)]
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "model": "melotts-kr-pretrained", "speaker": "KR", "sample_rate": SAMPLE_RATE}


def test_synthesize_returns_a_wav_from_the_model(client, model):
    res = client.post("/synthesize", json={"text": "고추 탄저병으로 보여요.", "speed": 0.9})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert model.calls[-1] == ("고추 탄저병으로 보여요.", 0, None, 0.9)
    with wave.open(io.BytesIO(res.content), "rb") as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, SAMPLE_RATE)
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    assert samples.tolist() == [-32767, -16383, 0, 16383, 32767]


@pytest.mark.parametrize(
    "body",
    [{}, {"text": ""}, {"text": "가" * (server.MAX_CHARS + 1)}, {"text": "가", "speed": 0.4}, {"text": "가", "speed": 1.6}],
    ids=["missing", "empty", "too-long", "too-slow", "too-fast"],
)
def test_invalid_requests_are_rejected_before_synthesis(client, model, body):
    assert client.post("/synthesize", json=body).status_code == 422
    assert len(model.calls) == 1  # 예열만 했다


def test_synthesis_failure_returns_a_generic_error(client, model):
    model.synth_error = RuntimeError(r"C:\models\checkpoint.pth 읽기 실패")
    res = client.post("/synthesize", json={"text": "안녕하세요."})
    assert res.status_code == 500
    assert res.json() == {"detail": "음성 합성에 실패했습니다."}  # 내부 경로·예외는 응답에 싣지 않는다


@pytest.mark.parametrize("failure", ["load", "speaker", "warmup"])
def test_startup_fails_when_the_model_is_not_ready(model, failure):
    # 준비되지 않은 모델로 /health가 ok를 돌려주면 안 된다 — 기동 자체가 실패해야 한다
    if failure == "load":
        model.init_error = OSError("체크포인트를 내려받지 못했습니다")
    elif failure == "speaker":
        model.speakers = {"EN-US": 0}
    else:
        model.synth_error = RuntimeError("예열 실패")
    with pytest.raises((OSError, RuntimeError)):
        with TestClient(server.app):
            pass
