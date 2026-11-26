"""보드 성능 측정 — 서비스 5개가 떠 있는 상태에서 실행한다 (표준 라이브러리만, 시스템 python3).

    python3 ~/cropy/board/bench_board.py --image ~/cropy/data/bench/pepper_anthracnose.jpg

재는 것 (첫 1회는 예열로 빼고 중앙값·p95):
    CNN 진단(/diagnose), 기능 선택(/voice/select-function, RKLLM), 답변 문장(/voice/function-call),
    TTS 합성 시간과 실시간 대비 배속, STT(/voice/transcribe, TTS로 만든 질문 음성), 질문 → 첫 답 음성 준비,
    서비스별 메모리(RSS), 전체 메모리, CPU 온도(측정 전·후·최고), 디스크.
결과는 ~/cropy/logs/bench_YYYYmmdd_HHMM.json 과 화면 요약.
"""

import argparse
import io
import json
import os
import re
import statistics
import subprocess
import threading
import time
import urllib.request
import uuid
import wave
from pathlib import Path

B = "http://127.0.0.1:8000/api/v1"
TTS = "http://127.0.0.1:8100/synthesize"
COOKIE = "cropy_device=board_bench_00000000000000000000000000"
QUESTIONS = ["이 질병 뭐야?", "어떻게 관리해?", "약 뭐 써?", "희석 배수는?", "점수가 몇이야?",
             "다시 찍어야 돼?", "먹어도 돼?", "원인이 뭐야?", "뭐부터 해야 돼?", "고마워", "수박도 돼?"]
SENTENCES = ["고추 탄저병으로 보여요.", "병든 과실과 잔재를 주변에 남기지 마세요.",
             "희석 배수는 오백 배예요.", "수확 칠 일 전까지만 쓸 수 있어요.", "사진 분석 결과이며 확진이 아닙니다."]
UNITS = ["cropy-selector", "cropy-stt", "cropy-tts", "cropy-backend", "cropy-agent"]


def req(method, url, body=None, ctype=None, timeout=180):
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Cookie", COOKIE)
    if ctype:
        r.add_header("Content-Type", ctype)
    t = time.perf_counter()
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        data = resp.read()
    return data, time.perf_counter() - t


def jpost(path, payload):
    data, s = req("POST", B + path, json.dumps(payload, ensure_ascii=False).encode(), "application/json")
    return json.loads(data), s


def stats(values):
    v = sorted(values)
    if not v:
        return None
    return {"n": len(v), "median": round(statistics.median(v), 3), "p95": round(v[min(len(v) - 1, int(len(v) * 0.95))], 3),
            "min": round(v[0], 3), "max": round(v[-1], 3)}


def temps():
    out = {}
    for z in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
        try:
            out[(z / "type").read_text().strip()] = int((z / "temp").read_text()) / 1000
        except OSError:
            pass
    return out


class TempWatch:
    def __init__(self):
        self.peak, self.stop = 0.0, threading.Event()

    def run(self):
        while not self.stop.is_set():
            self.peak = max([self.peak, *temps().values()])
            time.sleep(1)


def rss_mb(unit):
    pid = subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", unit],
                         capture_output=True, text=True).stdout.strip()
    if not pid or pid == "0":
        return None
    # uvicorn 등 자식 프로세스까지 합친다
    pids = [pid] + subprocess.run(["pgrep", "-P", pid], capture_output=True, text=True).stdout.split()
    total = 0
    for p in pids:
        try:
            m = re.search(r"VmRSS:\s+(\d+)", Path(f"/proc/{p}/status").read_text())
            total += int(m.group(1)) if m else 0
        except OSError:
            pass
    return round(total / 1024)


def multipart(path):
    boundary = uuid.uuid4().hex
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
            "Content-Type: image/jpeg\r\n\r\n").encode()
    return head + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def wav_seconds(data):
    with wave.open(io.BytesIO(data)) as w:
        return w.getnframes() / w.getframerate()


def to_16k_mono(data):
    """TTS 44.1kHz wav → 16kHz (STT 입력과 같게, 선형 보간 없이 간단 추림은 품질이 나빠 표준 audioop 사용)."""
    import audioop  # Python 3.10 표준 (3.13에서 제거)
    with wave.open(io.BytesIO(data)) as w:
        frames, rate, ch, width = w.readframes(w.getnframes()), w.getframerate(), w.getnchannels(), w.getsampwidth()
    if ch > 1:
        frames = audioop.tomono(frames, width, 0.5, 0.5)
    frames, _ = audioop.ratecv(frames, width, 1, rate, 16000, None)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as o:
        o.setnchannels(1), o.setsampwidth(width), o.setframerate(16000), o.writeframes(frames)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--diagnose-runs", type=int, default=10)
    args = ap.parse_args()
    image = Path(args.image).expanduser()
    result = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "uname": os.uname().release,
              "os": next((l.split("=", 1)[1].strip('"') for l in Path("/etc/os-release").read_text().splitlines()
                          if l.startswith("PRETTY_NAME")), ""),
              "temp_before": temps()}
    watch = TempWatch()
    threading.Thread(target=watch.run, daemon=True).start()

    # 1) CNN 진단
    body, ctype = multipart(image)
    times, last = [], None
    for i in range(args.diagnose_runs + 1):
        data, s = req("POST", B + "/diagnose", body, ctype)
        last = json.loads(data)
        if i:
            times.append(s)
    result["diagnose_s"] = stats(times)
    result["diagnosis"] = {k: last.get(k) for k in ("crop_type", "disease_name", "confidence", "prediction_mode")}
    did = last["id"]
    print("진단", result["diagnose_s"], result["diagnosis"], flush=True)

    # 2) 기능 선택 + 답변 문장 + 첫 문장 TTS (질문 → 첫 답 음성 준비)
    sel, ans, first, calls = [], [], [], []
    for i, q in enumerate(QUESTIONS):
        r, s1 = jpost("/voice/select-function", {"utterance": q, "diagnosis_id": did, "ui_stage": "result"})
        a, s2 = jpost("/voice/function-call", {"function_call": r["function_call"], "diagnosis_id": did,
                                               "ui_stage": "result", "source": "board_rkllm"})
        text = re.split(r"(?<=[.?!])\s+|;\s*", a.get("text", ""))[0][:60] or "네."
        _, s3 = req("POST", TTS, json.dumps({"text": re.sub(r"[;·]", ",", text), "speed": 0.9},
                                            ensure_ascii=False).encode(), "application/json")
        calls.append({"q": q, "call": r["function_call"], "status": a.get("status")})
        if i:
            sel.append(s1), ans.append(s2), first.append(s1 + s2 + s3)
    result["select_s"], result["answer_s"], result["question_to_first_audio_s"] = stats(sel), stats(ans), stats(first)
    result["calls"] = calls
    print("기능 선택", result["select_s"], "\n질문→첫 음성", result["question_to_first_audio_s"], flush=True)

    # 3) TTS 배속
    synth, audio, rtf, wavs = [], [], [], []
    for i, t in enumerate([SENTENCES[0]] + SENTENCES):
        data, s = req("POST", TTS, json.dumps({"text": t, "speed": 0.9}, ensure_ascii=False).encode(), "application/json")
        if i:
            d = wav_seconds(data)
            synth.append(s), audio.append(d), rtf.append(s / d), wavs.append(data)
    result["tts_synth_s"], result["tts_audio_s"], result["tts_rtf"] = stats(synth), stats(audio), stats(rtf)
    print("TTS 합성/음성 배속", result["tts_rtf"], flush=True)

    # 4) STT (TTS로 만든 질문 음성)
    stt, texts = [], []
    for i, q in enumerate([QUESTIONS[0]] + QUESTIONS[:6]):
        data, _ = req("POST", TTS, json.dumps({"text": q, "speed": 1.0}, ensure_ascii=False).encode(), "application/json")
        wav16 = to_16k_mono(data)
        out, s = req("POST", B + "/voice/transcribe", wav16, "audio/wav")
        if i:
            stt.append(s), texts.append({"said": q, "heard": json.loads(out).get("text"), "audio_s": round(wav_seconds(wav16), 2)})
    result["stt_s"], result["stt_texts"] = stats(stt), texts
    print("STT", result["stt_s"], flush=True)

    # 5) 자원
    watch.stop.set()
    result["temp_after"], result["temp_peak"] = temps(), watch.peak
    result["rss_mb"] = {u: rss_mb(u) for u in UNITS}
    mem = subprocess.run(["free", "-m"], capture_output=True, text=True).stdout.splitlines()[1].split()
    result["mem_mb"] = {"total": int(mem[1]), "used": int(mem[2]), "available": int(mem[6])}
    df = subprocess.run(["df", "-m", "/"], capture_output=True, text=True).stdout.splitlines()[1].split()
    result["disk_mb"] = {"total": int(df[1]), "used": int(df[2]), "free": int(df[3])}
    print("메모리", result["rss_mb"], result["mem_mb"], "온도 최고", watch.peak, flush=True)

    out = Path.home() / "cropy/logs" / time.strftime("bench_%Y%m%d_%H%M.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("저장:", out)


if __name__ == "__main__":
    main()
