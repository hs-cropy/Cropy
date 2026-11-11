"""STT 서버 테스트 — 가짜 sherpa-onnx로 돌려 모델 파일 없이 실행한다.

    stt/.venv/Scripts/python -m pytest stt/tests
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


def make_wav(samples, rate=16000, channels=1, width=2) -> bytes:
    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes() if width == 2 else pcm.astype("<i4").tobytes())
    return buf.getvalue()


def zero_rate_wav() -> bytes:
    """헤더의 샘플레이트가 0인 wav (wave 모듈로는 만들 수 없어 직접 쓴다)."""
    import struct
    data = b"\x00\x01" * 100
    fmt = struct.pack("<HHIIHH", 1, 1, 0, 0, 2, 16)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", len(data)) + data


def speech(seconds, rate=16000):
    return 0.3 * np.ones(int(seconds * rate), dtype=np.float32)


@pytest.fixture
def engine(monkeypatch, tmp_path):
    """sherpa_onnx를 가짜로 바꾼다. 인식기는 texts를 차례로 돌려주고, VAD는 0이 아닌 구간을 말소리로 본다."""
    behavior = SimpleNamespace(texts=[], decoded=[], init_error=None, decode_error=None, threads=None)

    class Stream:
        def accept_waveform(self, rate, samples):
            assert rate == 16000
            self.samples = np.asarray(samples)
            self.result = SimpleNamespace(text="")

    class Recognizer:
        @classmethod
        def from_sense_voice(cls, model, tokens, num_threads, language, use_itn):
            if behavior.init_error:
                raise behavior.init_error
            assert language == "ko"
            behavior.threads = num_threads
            return cls()

        def create_stream(self):
            return Stream()

        def decode_stream(self, stream):
            if behavior.decode_error:
                raise behavior.decode_error
            behavior.decoded.append(len(stream.samples))
            if np.any(stream.samples):  # 예열(무음)에는 빈 결과
                stream.result.text = behavior.texts.pop(0) if behavior.texts else ""

    class Vad:
        def __init__(self, config, buffer_size_in_seconds):
            self.buf, self.segments = [], []

        def reset(self):
            self.buf, self.segments = [], []

        def accept_waveform(self, samples):
            assert len(samples) <= server.VAD_WINDOW
            self.buf.append(np.asarray(samples))

        def flush(self):
            x = np.concatenate(self.buf) if self.buf else np.zeros(0)
            voiced = np.flatnonzero(np.diff(np.concatenate([[0], (x != 0).astype(int), [0]])))
            self.segments = [x[a:b] for a, b in zip(voiced[::2], voiced[1::2])]

        def empty(self):
            return not self.segments

        @property
        def front(self):
            return SimpleNamespace(samples=self.segments[0])

        def pop(self):
            self.segments.pop(0)

    fake = types.ModuleType("sherpa_onnx")
    fake.OfflineRecognizer = Recognizer
    fake.VoiceActivityDetector = Vad
    fake.VadModelConfig = lambda: SimpleNamespace(silero_vad=SimpleNamespace())
    monkeypatch.setitem(sys.modules, "sherpa_onnx", fake)

    model_dir = tmp_path / "models"
    (model_dir / "sense-voice-2024-07-17").mkdir(parents=True)
    for name in ("sense-voice-2024-07-17/model.int8.onnx", "sense-voice-2024-07-17/tokens.txt", "silero_vad.onnx"):
        (model_dir / name).write_bytes(b"x")
    monkeypatch.setattr(server, "SENSEVOICE_DIR", model_dir / "sense-voice-2024-07-17")
    monkeypatch.setattr(server, "VAD_MODEL", model_dir / "silero_vad.onnx")
    monkeypatch.setattr(server, "_state", {})
    behavior.model_dir = model_dir
    return behavior


@pytest.fixture
def client(engine):
    with TestClient(server.app) as test_client:
        yield test_client


def post(client, body):
    return client.post("/transcribe", content=body, headers={"Content-Type": "audio/wav"})


def test_health_reports_the_loaded_model(client, engine):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "model": "sensevoice-small-2024-07-17-int8",
                          "threads": server.THREADS, "vad": True, "terms": len(server._state["lexicon"].terms)}
    assert engine.threads == server.THREADS
    assert engine.decoded == [16000]  # 예열 1초


def test_transcribe_returns_corrected_text(client, engine):
    engine.texts = ["이곳 탄접병 맞 아요."]
    res = post(client, make_wav(np.concatenate([np.zeros(8000), speech(1.5), np.zeros(8000)])))
    assert res.status_code == 200
    body = res.json()
    assert body["text"] == "이곳 탄저병 맞 아요."
    assert body["raw_text"] == "이곳 탄접병 맞 아요."
    assert body["corrections"] == [{"heard": "탄접병", "term": "탄저병"}]
    assert body["speech"] is True
    assert body["audio_seconds"] == 2.5
    assert engine.decoded[-1] == 24000  # VAD가 앞뒤 무음을 잘라 말소리 1.5초만 인식했다


def test_each_speech_segment_is_decoded_and_joined(client, engine):
    engine.texts = ["고추 잎에", "반점이 생겼어요"]
    res = post(client, make_wav(np.concatenate([speech(1), np.zeros(16000), speech(1)])))
    assert res.json()["text"] == "고추 잎에 반점이 생겼어요"
    assert engine.decoded[1:] == [16000, 16000]


def test_silence_returns_no_speech_without_decoding(client, engine):
    res = post(client, make_wav(np.zeros(32000)))
    assert res.status_code == 200
    assert res.json()["text"] == "" and res.json()["speech"] is False
    assert engine.decoded == [16000]  # 예열뿐


def test_stereo_44k_is_converted_to_16k_mono(client, engine):
    engine.texts = ["다시 찍어 볼까요?"]
    stereo = np.repeat(speech(1, rate=44100), 2)
    res = post(client, make_wav(stereo, rate=44100, channels=2))
    assert res.json()["text"] == "다시 찍어 볼까요?"
    assert engine.decoded[-1] == 16000


@pytest.mark.parametrize(
    ("body", "status"),
    [
        (b"", 400),
        (b"not a wav file", 400),
        (make_wav(speech(0.5), width=4), 400),
        (make_wav(speech(server.MAX_SECONDS + 1, rate=8000), rate=8000), 400),
        (zero_rate_wav(), 400),
    ],
    ids=["empty", "not-wav", "32bit", "too-long", "zero-rate"],
)
def test_bad_audio_is_rejected_before_decoding(client, engine, body, status):
    assert post(client, body).status_code == status
    assert engine.decoded == [16000]


def test_oversized_body_is_rejected(client, engine, monkeypatch):
    monkeypatch.setattr(server, "MAX_BYTES", 100)
    assert post(client, make_wav(speech(1))).status_code == 413


def test_decode_failure_returns_a_generic_error(client, engine):
    engine.decode_error = RuntimeError(r"C:\models\model.int8.onnx 실행 실패")
    res = post(client, make_wav(speech(1)))
    assert res.status_code == 500
    assert res.json() == {"detail": "음성 인식에 실패했습니다."}


def test_vad_can_be_turned_off(engine, monkeypatch):
    monkeypatch.setattr(server, "USE_VAD", False)
    engine.texts = ["고마워"]
    with TestClient(server.app) as client:
        assert client.get("/health").json()["vad"] is False
        res = post(client, make_wav(np.concatenate([np.zeros(8000), speech(1)])))
    assert res.json()["text"] == "고마워"
    assert engine.decoded[-1] == 24000  # 무음까지 통째로 인식


@pytest.mark.parametrize("missing", ["sense-voice-2024-07-17/model.int8.onnx", "silero_vad.onnx"])
def test_startup_fails_when_a_model_file_is_missing(engine, missing):
    (engine.model_dir / missing).unlink()
    with pytest.raises(RuntimeError, match="download_models.py"):
        with TestClient(server.app):
            pass


def test_startup_fails_when_the_recognizer_cannot_load(engine):
    engine.init_error = RuntimeError("onnx 로드 실패")
    with pytest.raises(RuntimeError):
        with TestClient(server.app):
            pass
