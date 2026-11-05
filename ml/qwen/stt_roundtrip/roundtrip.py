"""Turn validation utterances into real STT output: MeloTTS -> (noise) -> SenseVoice STT servers.

Why: every Qwen accuracy so far used typed sentences. The mentor's top concern is STT errors (words written the way
they sound). This makes the same validation rows the way the board/web will actually see them, so the deployed
model can be scored on them (eval_web_onnx.py --texts) without changing labels.

Needs the local servers: tts/ (MeloTTS, :8100) and stt/ (sherpa-onnx SenseVoice + term correction, :8200).
Writes --out (jsonl, appended so a rerun resumes): case_id, condition, speed, text (typed), stt_raw (before term
correction), stt_text (after), cer_raw, cer_text. WAVs are cached in --wav-dir.

Conditions: clean, snr10, snr5 (white noise at that SNR on the synthesized speech). Speed 0.9/1.0/1.1 per case
(deterministic). One synthetic voice only — real recordings (older speakers, field noise) are still needed.
"""
import argparse
import hashlib
import io
import json
import lzma
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--split", default="validation")
ap.add_argument("--out", required=True)
ap.add_argument("--wav-dir", required=True)
ap.add_argument("--conditions", default="clean,snr10,snr5")
ap.add_argument("--tts", default="http://127.0.0.1:8100/synthesize")
ap.add_argument("--stt", default="http://127.0.0.1:8200/transcribe")
ap.add_argument("--limit", type=int, default=0)
args = ap.parse_args()

SPEEDS = (0.9, 1.0, 1.1)
rows = [json.loads(l) for l in lzma.decompress(Path(args.data).read_bytes()).decode("utf-8").splitlines()]
rows = [r for r in rows if r["split"] == args.split and not r["user_text"].startswith("[")]
if args.limit:
    rows = rows[: args.limit]
conditions = [c for c in args.conditions.split(",") if c]
out, wav_dir = Path(args.out), Path(args.wav_dir)
wav_dir.mkdir(parents=True, exist_ok=True)
done = set()
if out.exists():
    done = {(d["case_id"], d["condition"]) for d in map(json.loads, out.read_text(encoding="utf-8").splitlines())}


def stable(key):
    return int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)


def post(url, body, content_type, tries=6):
    # servers may restart while a long run is going (shared dev machine); wait and retry instead of dying
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": content_type})
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except (ConnectionError, urllib.error.URLError, TimeoutError) as e:
            if attempt == tries - 1:
                raise
            print(f"  retry {attempt + 1} after {type(e).__name__}", flush=True)
            time.sleep(10 * (attempt + 1))


def read_wav(data):
    with wave.open(io.BytesIO(data)) as w:
        rate, n, width = w.getframerate(), w.getnframes(), w.getsampwidth()
        assert width == 2 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(n), np.int16).astype(np.float32) / 32768.0, rate


def write_wav(samples, rate):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


def add_noise(samples, snr_db, seed):
    rng = np.random.default_rng(seed)
    voiced = samples[np.abs(samples) > 0.01]  # speech power, not the silence MeloTTS pads around it
    power = float(np.mean(voiced ** 2)) if voiced.size else float(np.mean(samples ** 2))
    noise = rng.normal(0.0, np.sqrt(power / 10 ** (snr_db / 10)), samples.shape)
    return (samples + noise).astype(np.float32)


def cer(ref, hyp):
    a, b = ref.replace(" ", ""), hyp.replace(" ", "")
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return round(prev[-1] / max(1, len(a)), 4)


start, n_new = time.time(), 0
with out.open("a", encoding="utf-8") as f:
    for i, r in enumerate(rows, 1):
        todo = [c for c in conditions if (r["case_id"], c) not in done]
        if not todo:
            continue
        speed = SPEEDS[stable("speed" + r["case_id"]) % 3]
        key = hashlib.sha256(f'{r["user_text"]}|{speed}'.encode()).hexdigest()[:16]
        clean_path = wav_dir / f"{key}.wav"
        if not clean_path.exists():
            clean_path.write_bytes(post(args.tts, json.dumps({"text": r["user_text"], "speed": speed}).encode(), "application/json"))
        clean, rate = read_wav(clean_path.read_bytes())
        for cond in todo:
            audio = clean if cond == "clean" else add_noise(clean, float(cond[3:]), stable(cond + r["case_id"]))
            res = json.loads(post(args.stt, write_wav(audio, rate), "audio/wav"))
            f.write(json.dumps(dict(case_id=r["case_id"], function=r["function"], condition=cond, speed=speed,
                                    text=r["user_text"], stt_raw=res["raw_text"], stt_text=res["text"],
                                    corrections=res["corrections"], cer_raw=cer(r["user_text"], res["raw_text"]),
                                    cer_text=cer(r["user_text"], res["text"])), ensure_ascii=False) + "\n")
            n_new += 1
        f.flush()
        if i % 50 == 0 or i == len(rows):
            print(f"{i}/{len(rows)} rows, {n_new} new results, {(time.time() - start) / 60:.1f} min", flush=True)
print("done", out)
