"""Cropy 보드 음성 에이전트 — 호출어 → 촬영·진단 → 음성 질문 → 스피커 답변.

    STT 가상환경의 파이썬으로 실행한다(sherpa_onnx·numpy가 이미 있다):
    ~/cropy-board-demo/stt/.venv/bin/python board/agent/cropy_agent.py

흐름
    마이크(arecord, 16kHz 모노) → silero VAD로 말 구간 자르기 → 백엔드 /voice/transcribe
    ├─ 대기 중: 호출어("크로피")가 들리면 삑 소리 후 대화 상태로. 호출어 뒤에 말이 이어지면 그 말도 처리
    └─ 대화 중
        ├─ "사진 찍어줘"류  → 카메라 한 장 → /diagnose → /diagnose/{id}/speech(wav) 재생
        └─ 그 밖의 질문     → /voice/select-function(RKLLM) → /voice/function-call → TTS → 재생
    마지막 응답 뒤 ACTIVE_SECONDS 동안 말이 없으면 다시 대기 상태.

촬영은 기능 선택 모델의 9개 기능에 없다(모델은 "사진 찍어줘"를 촬영 방법 안내로 고른다).
그래서 촬영 명령만 여기서 규칙으로 먼저 가로챈다.

모든 설정은 환경변수로 바꾼다(아래 Config). 백엔드·STT·TTS·RKLLM 서버는 각각 따로 떠 있어야 한다.
"""

from __future__ import annotations

import glob
import io
import json
import logging
import os
import queue
import re
import shlex
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

log = logging.getLogger("cropy-agent")

SAMPLE_RATE = 16000
VAD_WINDOW = 512


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


@dataclass
class Config:
    backend: str = _env("CROPY_BACKEND", "http://127.0.0.1:8000/api/v1")
    tts_url: str = _env("CROPY_TTS_URL", "http://127.0.0.1:8100/synthesize")
    tts_speed: float = float(_env("CROPY_TTS_SPEED", "1.2"))
    # 같은 쿠키를 쓰면 백엔드 이력이 한 기기로 묶인다(로그인 없음, 32~64자 영숫자)
    device_cookie: str = _env("CROPY_DEVICE_COOKIE", "orangepi_board_agent_000000000000000")
    mic: str = _env("CROPY_MIC", "plughw:3,0")          # arecord -l 로 확인 (ES8388 내장 = card 3)
    speaker: str = _env("CROPY_SPEAKER", "plughw:3,0")  # aplay -l 로 확인
    # 비우면 find_camera()가 USB 웹캠을 찾는다. RK3588은 보드 자체 영상 장치가 앞 번호를 차지할 수 있고,
    # 웹캠 하나가 videoN(영상)·videoN+1(메타데이터) 두 개를 만들어 /dev/video0 고정은 틀리기 쉽다
    camera: str = _env("CROPY_CAMERA", "")
    # {device}, {out} 자리에 값이 들어간다. 카메라에 맞게 바꿀 수 있다 (예: fswebcam -d {device} -r 1920x1080 --no-banner {out})
    capture_cmd: str = _env(
        "CROPY_CAPTURE_CMD",
        "v4l2-ctl -d {device} --set-fmt-video=width=1920,height=1080,pixelformat=MJPG "
        "--stream-mmap --stream-skip=15 --stream-count=1 --stream-to={out}",
    )
    crop_type: str = _env("CROPY_CROP_TYPE", "")        # 비우면 모델이 작물도 고른다
    vad_model: str = _env("CROPY_VAD_MODEL", str(Path.home() / "cropy-board-demo/stt/models/silero_vad.onnx"))
    # 호출어나 답변 뒤 이 시간 동안은 호출어 없이 이어 말할 수 있다(대화 모드)
    active_seconds: float = float(_env("CROPY_ACTIVE_SECONDS", "20"))
    # 대화 모드에서 호출어 없이 받는 말의 최소 글자 수(공백 제외) — "네" 같은 맞장구·잡음 무시
    followup_min_chars: int = int(_env("CROPY_FOLLOWUP_MIN_CHARS", "4"))
    wake_words: tuple[str, ...] = tuple(
        w for w in _env("CROPY_WAKE_WORDS", "크로피,크롭이,크로비,그로피,코로피,크로피야,크롭피").split(",") if w
    )
    photo_dir: Path = Path(_env("CROPY_PHOTO_DIR", str(Path.home() / "cropy/data/agent_photos")))
    http_timeout: float = float(_env("CROPY_HTTP_TIMEOUT", "90"))


# "사진 찍어줘", "찍어 줘", "촬영해 줘", "다시 찍어" … 촬영 '방법'을 묻는 질문(어떻게 찍어?)은 제외한다
CAPTURE = re.compile(r"(사진|촬영|찍어|찍자|찍을래|찰칵)")
CAPTURE_EXCLUDE = re.compile(r"(어떻게|방법|어디를|어느|왜)")


def wants_capture(text: str) -> bool:
    return bool(CAPTURE.search(text)) and not CAPTURE_EXCLUDE.search(text)


# "종료해 줘", "그만", "끝내" — 웹앱 frontend/src/features/voice/lib/exitIntent.ts와 같은 규칙.
# 모델(기능 선택)에는 종료 기능이 없어 에이전트가 먼저 가로챈다. 질문이 섞이거나 문장이 길면 명령으로 보지 않는다.
# STT가 "종료"를 "종묘·종려·조묘·동료"로 적은 사례가 있다. 종묘(씨·모종)는 농사 말이라 '해·하'가 바로 붙을 때만 받는다.
# 보드에서는 "그만하자"의 앞이 잘려 "만 하자"로 들어온 사례도 있다(2026-11-26)
EXIT = re.compile(r"(종료|[종조동](?:묘|려|료)(?:해|하)|^만하자|그만|끝내|끝낼|끝|멈춰|나가|닫아|꺼\s?줘|꺼$|됐어|이제\s?됐|여기까지)")
EXIT_EXCLUDE = re.compile(r"(어떻게|어떡|방법|왜|뭐|무엇|언제|어디|되나|될까|하나요|할까|병|약|농약|찍)")
EXIT_MAX_CHARS = 14  # 공백 뺀 글자 수. "이제 그만 종료해 줘" 정도까지
EXIT_TEXT = "대화를 마칠게요. 필요하면 크로피라고 불러 주세요."


def wants_exit(text: str) -> bool:
    t = re.sub(r"[\s,.!?~。？]", "", text)
    return 0 < len(t) <= EXIT_MAX_CHARS and bool(EXIT.search(t)) and not EXIT_EXCLUDE.search(t)


CAPTURE_FALLBACKS = (
    # 해상도는 그대로 두고 MJPG만 (1080p를 지원하지 않는 웹캠)
    "v4l2-ctl -d {device} --set-fmt-video=pixelformat=MJPG --stream-mmap --stream-skip=15 --stream-count=1 --stream-to={out}",
    "v4l2-ctl -d {device} --set-fmt-video=width=1280,height=720,pixelformat=MJPG "
    "--stream-mmap --stream-skip=15 --stream-count=1 --stream-to={out}",
)


def _formats(device: str) -> str:
    try:
        r = subprocess.run(["v4l2-ctl", "-d", device, "--list-formats"], capture_output=True, text=True, timeout=5)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def find_camera() -> str | None:
    """영상을 내보내는 장치 중 MJPG를 주는 USB 웹캠을 우선 고른다. 메타데이터 노드는 형식 목록이 비어 걸러진다."""
    candidates = []
    for pattern in ("/dev/v4l/by-id/*-video-index0", "/dev/v4l/by-path/*usb*-video-index0", "/dev/video*"):
        for path in sorted(glob.glob(pattern)):
            real = os.path.realpath(path)
            if re.fullmatch(r"/dev/video\d+", real) and real not in [c[1] for c in candidates]:
                candidates.append((path, real))
    fallback = None
    for path, real in candidates:
        formats = _formats(real)
        if "MJPG" in formats:
            return path
        if fallback is None and re.search(r"\[\d+\]:", formats):
            fallback = path
    return fallback


def clean_for_tts(text: str) -> str:
    """MeloTTS 한국어 전처리는 ';' 등 일부 기호에서 KeyError로 실패한다. 읽을 때 쉬는 자리로 바꾼다."""
    text = re.sub(r"[;·/|•…]+", ", ", text)
    text = re.sub(r"[\"'“”‘’()\[\]{}<>*#_~^`]", " ", text)
    return re.sub(r"\s+", " ", re.sub(r"\s*,\s*(,\s*)+", ", ", text)).strip(" ,")


def split_sentences(text: str, max_chars: int = 60) -> list[str]:
    """문장부호·쌍반점에서 나누고, 너무 긴 조각은 쉼표에서 한 번 더 나눈다."""
    parts = []
    for piece in re.split(r"(?<=[.?!])\s+|;\s*", text or ""):
        piece = clean_for_tts(piece)
        while len(piece) > max_chars and ", " in piece[:max_chars]:
            cut = piece[:max_chars].rfind(", ")
            parts.append(piece[:cut])
            piece = piece[cut + 2:]
        if re.search(r"[가-힣A-Za-z0-9]", piece):
            parts.append(piece)
    return parts


def _compact(text: str) -> str:
    return re.sub(r"[\s.,!?~·]", "", text)


def split_wake(text: str, wake_words: tuple[str, ...]) -> tuple[bool, str]:
    """호출어가 있으면 (True, 호출어 뒤 나머지 말)."""
    compact = _compact(text)
    for word in sorted(wake_words, key=len, reverse=True):
        at = compact.find(word)
        if at >= 0:
            rest = compact[at + len(word):]
            rest = re.sub(r"^(야|아|님|씨)", "", rest)
            return True, rest
    return False, ""


# ---------------------------------------------------------------- 오디오 입출력

def to_wav(samples: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def beep(freqs=(880, 1320), seconds=0.12) -> bytes:
    parts = []
    for f in freqs:
        t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
        tone = 0.35 * np.sin(2 * np.pi * f * t)
        fade = np.minimum(1, np.minimum(t, t[::-1]) / 0.01)
        parts.append(tone * fade)
        parts.append(np.zeros(int(SAMPLE_RATE * 0.03)))
    return to_wav(np.concatenate(parts).astype(np.float32))


class Microphone:
    """arecord를 띄워 float32 묶음을 큐에 넣는다. 말하는 동안(mute)에는 버린다 — 자기 목소리 재인식 방지."""

    def __init__(self, device: str):
        self.device = device
        self.q: queue.Queue[np.ndarray] = queue.Queue(maxsize=400)
        self.muted = threading.Event()
        self.proc: subprocess.Popen | None = None

    def start(self) -> None:
        cmd = ["arecord", "-q", "-D", self.device, "-f", "S16_LE", "-r", str(SAMPLE_RATE), "-c", "1", "-t", "raw"]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        threading.Thread(target=self._read, daemon=True).start()
        log.info("마이크 시작: %s", " ".join(cmd))

    def _read(self) -> None:
        assert self.proc and self.proc.stdout
        nbytes = VAD_WINDOW * 2
        while True:
            chunk = self.proc.stdout.read(nbytes)
            if not chunk or len(chunk) < nbytes:
                err = self.proc.stderr.read().decode(errors="replace") if self.proc.stderr else ""
                log.error("마이크 입력이 끊겼습니다: %s", err.strip())
                self.q.put(np.zeros(0, dtype=np.float32))  # 종료 신호
                return
            if self.muted.is_set():
                continue
            samples = np.frombuffer(chunk, dtype="<i2").astype(np.float32) / 32768.0
            try:
                self.q.put_nowait(samples)
            except queue.Full:
                pass  # 처리(진단·RKLLM)가 길어 밀린 소리는 버린다

    def drain(self) -> None:
        while not self.q.empty():
            try:
                self.q.get_nowait()
            except queue.Empty:
                break


class Speaker:
    def __init__(self, device: str, mic: Microphone):
        self.device = device
        self.mic = mic

    def play(self, wav: bytes) -> None:
        self.mic.muted.set()
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(wav)
                path = f.name
            subprocess.run(["aplay", "-q", "-D", self.device, path], check=False, timeout=120)
            os.unlink(path)
        finally:
            time.sleep(0.25)  # 스피커 잔향이 마이크에 들어가지 않게
            self.mic.drain()
            self.mic.muted.clear()


# ---------------------------------------------------------------- 백엔드·TTS 호출

class Api:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.cookie = f"cropy_device={cfg.device_cookie}"

    def _request(self, method: str, url: str, body: bytes | None = None, ctype: str | None = None) -> tuple[int, bytes, str]:
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Cookie", self.cookie)
        if ctype:
            req.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=self.cfg.http_timeout) as r:
                return r.status, r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")

    def json(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        status, data, _ = self._request(method, self.cfg.backend + path, body, "application/json" if body else None)
        result = json.loads(data or b"{}")
        if status >= 400:
            raise RuntimeError(f"{path} {status}: {result.get('detail') or result}")
        return result

    def transcribe(self, samples: np.ndarray) -> str:
        status, data, _ = self._request("POST", self.cfg.backend + "/voice/transcribe", to_wav(samples), "audio/wav")
        if status >= 400:
            raise RuntimeError(f"transcribe {status}: {data[:200]!r}")
        return json.loads(data).get("text", "").strip()

    def diagnose(self, image: Path) -> dict:
        boundary = uuid.uuid4().hex
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{image.name}\"\r\n"
                f"Content-Type: image/jpeg\r\n\r\n").encode()
        body = head + image.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
        query = f"?crop_type={urllib.parse.quote(self.cfg.crop_type)}" if self.cfg.crop_type else ""
        status, data, _ = self._request("POST", f"{self.cfg.backend}/diagnose{query}", body,
                                        f"multipart/form-data; boundary={boundary}")
        result = json.loads(data or b"{}")
        if status >= 400:
            raise RuntimeError(f"diagnose {status}: {result.get('detail') or result}")
        return result

    def diagnosis_script(self, diagnosis_id: str) -> list[str]:
        result = self.json("GET", f"/diagnose/{diagnosis_id}/speech/script")
        return result.get("sentences") or ([result["text"]] if result.get("text") else [])

    def tts(self, text: str) -> bytes | None:
        body = json.dumps({"text": text[:500], "speed": self.cfg.tts_speed}, ensure_ascii=False).encode()
        status, data, ctype = self._request("POST", self.cfg.tts_url, body, "application/json")
        if status != 200 or "audio" not in ctype:
            log.error("TTS 실패 %s: %r", status, data[:200])
            return None
        return data


# ---------------------------------------------------------------- 에이전트

@dataclass
class State:
    active_until: float = 0.0
    diagnosis_id: str | None = None
    history: list[str] = field(default_factory=list)


class Agent:
    def __init__(self, cfg: Config):
        import sherpa_onnx  # STT 가상환경에 있다

        self.cfg = cfg
        self.api = Api(cfg)
        self.mic = Microphone(cfg.mic)
        self.speaker = Speaker(cfg.speaker, self.mic)
        self.state = State()
        vc = sherpa_onnx.VadModelConfig()
        vc.silero_vad.model = cfg.vad_model
        vc.silero_vad.threshold = 0.5
        vc.silero_vad.min_silence_duration = 0.6   # 문장 끝 판단. 짧으면 말 중간에 끊긴다
        vc.silero_vad.min_speech_duration = 0.25
        vc.silero_vad.max_speech_duration = 15
        vc.silero_vad.window_size = VAD_WINDOW
        vc.sample_rate = SAMPLE_RATE
        vc.num_threads = 1
        self.vad = sherpa_onnx.VoiceActivityDetector(vc, buffer_size_in_seconds=30)
        self.cfg.photo_dir.mkdir(parents=True, exist_ok=True)

    # -- 말하기
    def say(self, text: str | list[str]) -> None:
        """문장 단위로 합성하면서 앞 문장을 재생한다. 보드 CPU의 MeloTTS는 실시간보다 약 1.5배 느려,
        통째로 합성하면 긴 안내는 수십 초 동안 아무 소리가 없다."""
        sentences = split_sentences(text) if isinstance(text, str) else [s for t in text for s in split_sentences(t)]
        if not sentences:
            return
        log.info("말하기: %s", " ".join(sentences))
        ready: queue.Queue[bytes | None] = queue.Queue()

        def synth() -> None:
            for sentence in sentences:
                wav = self.api.tts(sentence)
                if wav:
                    ready.put(wav)
            ready.put(None)

        started = time.time()
        threading.Thread(target=synth, daemon=True).start()
        first = True
        while (wav := ready.get()) is not None:
            if first:
                log.info("첫 소리까지 %.1fs (%d문장)", time.time() - started, len(sentences))
                first = False
            self.speaker.play(wav)
        log.info("말하기 끝 %.1fs", time.time() - started)

    def chime(self) -> None:
        self.speaker.play(beep())

    # -- 동작
    def capture(self) -> Path:
        """설정한 명령 → 같은 MJPG 기본 해상도 → 1280x720 순으로 시도하고, JPEG가 맞는지 확인한다."""
        device = self.cfg.camera or find_camera()
        if not device:
            raise RuntimeError("영상 입력 장치를 찾지 못했습니다 (v4l2-ctl --list-devices 확인)")
        out = self.cfg.photo_dir / time.strftime("photo_%Y%m%d_%H%M%S.jpg")
        errors = []
        for template in (self.cfg.capture_cmd, *CAPTURE_FALLBACKS):
            out.unlink(missing_ok=True)
            cmd = template.format(device=shlex.quote(device), out=shlex.quote(str(out)))
            try:
                r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            except subprocess.TimeoutExpired:
                errors.append(f"시간 초과: {cmd}")
                continue
            data = out.read_bytes()[:3] if out.is_file() else b""
            if r.returncode == 0 and data.startswith(b"\xff\xd8") and out.stat().st_size >= 10_000:
                log.info("촬영: %s (%d KB, %s)", out, out.stat().st_size // 1024, device)
                return out
            why = r.stderr.strip()[-200:] or ("JPEG가 아님(MJPG 미지원 형식)" if data else "파일 없음")
            errors.append(f"exit {r.returncode}: {why} | {cmd}")
            log.warning("촬영 시도 실패 (%s): %s", device, errors[-1])
        raise RuntimeError(f"촬영 실패 ({device}): " + " / ".join(errors))

    def handle_capture(self) -> None:
        self.say("사진을 찍을게요. 잎이나 열매를 카메라 앞에 대 주세요.")
        try:
            photo = self.capture()
        except Exception as e:
            log.error("%s", e)
            self.say("카메라로 사진을 찍지 못했어요. 카메라 연결을 확인해 주세요.")
            return
        self.chime()
        try:
            result = self.api.diagnose(photo)
        except Exception as e:
            log.error("진단 실패: %s", e)
            self.say("사진을 분석하지 못했어요. 다시 찍어 볼까요?")
            return
        self.state.diagnosis_id = result.get("id")
        log.info("진단: %s %s %.3f (id=%s)", result.get("crop_type"), result.get("disease_name"),
                 result.get("confidence") or 0, self.state.diagnosis_id)
        # 백엔드 /speech(wav)는 긴 안내를 통째로 합성해 응답 제한(20초)을 넘긴다 → 문장 목록을 받아 이어 읽는다
        try:
            sentences = self.api.diagnosis_script(self.state.diagnosis_id) if self.state.diagnosis_id else []
        except Exception as e:
            log.error("낭독 문장 실패: %s", e)
            sentences = []
        self.say(sentences or f"{result.get('disease_name', '결과')}로 보여요.")

    def handle_question(self, text: str) -> None:
        ui_stage = "result" if self.state.diagnosis_id else "no_photo"
        started = time.time()
        try:
            sel = self.api.json("POST", "/voice/select-function",
                                {"utterance": text, "diagnosis_id": self.state.diagnosis_id, "ui_stage": ui_stage})
            call = sel["function_call"]
            payload = {"function_call": call, "ui_stage": ui_stage, "source": "board_rkllm"}
            if self.state.diagnosis_id:
                payload["diagnosis_id"] = self.state.diagnosis_id
            else:
                payload["context"] = sel.get("context") or {"ui_stage": ui_stage}
            answer = self.api.json("POST", "/voice/function-call", payload)
        except Exception as e:
            log.error("질문 처리 실패: %s", e)
            self.say("지금은 질문에 답하기 어려워요. 잠시 뒤 다시 말씀해 주세요.")
            return
        speech = answer.get("text") or ""
        log.info("기능: %s → %s/%s (%.1fs)", call, answer.get("function_name"), answer.get("status"), time.time() - started)
        self.say(speech or "답변을 준비하지 못했어요.")

    def handle_command(self, text: str) -> None:
        if wants_exit(text):
            log.info("대화 종료 명령")
            self.say(EXIT_TEXT)
            self.state.active_until = 0.0
            return
        if wants_capture(text):
            self.handle_capture()
        else:
            self.handle_question(text)
        self.state.active_until = time.time() + self.cfg.active_seconds

    def on_utterance(self, text: str) -> None:
        now = time.time()
        active = now < self.state.active_until
        woke, rest = split_wake(text, self.cfg.wake_words)
        log.info("들음%s: %s", " (대화 중)" if active else "", text)
        if woke:
            self.state.active_until = now + self.cfg.active_seconds
            if len(rest) >= 2:
                self.handle_command(rest)
            else:
                self.chime()
            return
        # 종료 명령("종료해", "그만")은 짧아서 최소 글자 수보다 먼저 본다
        if active and (wants_exit(text) or len(_compact(text)) >= self.cfg.followup_min_chars):
            self.handle_command(text)

    # -- 루프
    def run(self) -> None:
        self.mic.start()
        log.info("카메라: %s", self.cfg.camera or f"{find_camera()} (자동 선택)")
        log.info("대기 중 — 호출어: %s", ", ".join(self.cfg.wake_words))
        while True:
            samples = self.mic.q.get()
            if samples.size == 0:
                raise SystemExit("마이크 입력이 끊겨 종료합니다 (systemd가 다시 띄운다).")
            if self.mic.muted.is_set():
                continue
            self.vad.accept_waveform(samples)
            while not self.vad.empty():
                segment = np.asarray(self.vad.front.samples, dtype=np.float32)
                self.vad.pop()
                try:
                    text = self.api.transcribe(segment)
                except Exception as e:
                    log.error("STT 실패: %s", e)
                    continue
                if text:
                    self.on_utterance(text)
                    self.vad.reset()  # 처리하는 동안 쌓인 구간은 버린다


def main() -> None:
    logging.basicConfig(level=os.getenv("CROPY_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config()
    if os.getenv("CROPY_CAMERA_TEST"):
        # 촬영만 한 번: 서비스(cropy-agent)를 멈춘 뒤 실행한다. 다른 프로그램이 카메라를 잡고 있으면 실패한다
        for path in sorted(glob.glob("/dev/video*")):
            log.info("%s: %s", path, " ".join(re.findall(r"'(\w+)'", _formats(path))) or "형식 없음")
        cfg.photo_dir.mkdir(parents=True, exist_ok=True)
        print(Agent.capture(type("A", (), {"cfg": cfg})()))
        return
    if os.getenv("CROPY_AGENT_SELFTEST"):
        # 마이크 없이 흐름만 확인: 촬영 대신 파일, 발화 대신 문장
        agent = Agent(cfg)
        photo = os.getenv("CROPY_SELFTEST_PHOTO")
        if photo:
            agent.capture = lambda: Path(photo)  # type: ignore[method-assign]
        for line in os.getenv("CROPY_AGENT_SELFTEST").split("|"):
            agent.on_utterance(line)
        return
    Agent(cfg).run()


if __name__ == "__main__":
    main()
