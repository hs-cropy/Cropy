"""실제 녹음으로 STT(인식 + 용어 보정)를 평가한다. 사전이나 설정을 바꾼 뒤 돌려서 전후를 비교한다.

    stt/.venv/Scripts/python stt/eval_recordings.py [--log eval/logs/eval_log.jsonl] [--audio eval/logs/audio] [--no-vad]

입력: 평가 페이지가 남긴 기록(jsonl, 한 줄에 한 건)과 녹음 폴더.
- audio_id: 녹음 파일 이름(<audio_id>.wav)
- stt_ok: 사람이 표시한 STT 맞음/틀림. 표시가 없는 건은 건너뛴다
- 정답 문장: 틀림이면 stt_truth(사람이 적은 실제 발화), 맞음이면 stt_text(사람이 맞다고 본 그때의 결과)
  → 맞음으로 표시된 건의 정답은 그때 설정의 출력이라, 그 설정에 조금 유리하다

녹음과 기록은 개인 음성이라 저장소에 올리지 않는다(eval/logs/는 gitignore).
출력: 글자 오류율(CER, 띄어쓰기·문장부호 제외), 문장 전체 일치 수, 틀린 문장 목록.
"""

import argparse
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import server  # noqa: E402


def norm(text: str) -> str:
    return re.sub(r"[\s.,?!~·'\"]", "", text)


def edit_distance(ref: str, hyp: str) -> int:
    row = list(range(len(hyp) + 1))
    for i, a in enumerate(ref, 1):
        prev, row[0] = row[0], i
        for j, b in enumerate(hyp, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (a != b))
    return row[-1]


def load_cases(log: Path, audio: Path) -> list[tuple[str, str, Path]]:
    cases = []
    for line in log.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        path = audio / f"{row.get('audio_id')}.wav"
        if not isinstance(row.get("stt_ok"), bool) or not path.is_file():
            continue
        truth = row.get("stt_truth") if row["stt_ok"] is False and row.get("stt_truth") else (row.get("stt_text") or row.get("stt_raw"))
        if truth:
            cases.append((row["audio_id"], truth, path))
    return cases


def main() -> int:
    root = HERE.parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", type=Path, default=root / "eval" / "logs" / "eval_log.jsonl")
    ap.add_argument("--audio", type=Path, default=root / "eval" / "logs" / "audio")
    ap.add_argument("--no-vad", action="store_true")
    args = ap.parse_args()

    cases = load_cases(args.log, args.audio)
    if not cases:
        print("평가할 녹음이 없습니다.", file=sys.stderr)
        return 1
    server.USE_VAD = not args.no_vad
    server._load()

    errors = chars = exact = 0
    wrong = []
    for _, truth, path in cases:
        samples, rate = server.read_wav(path.read_bytes())
        text = server.transcribe(server.to_16k(samples, rate))["text"]
        ref, hyp = norm(truth), norm(text)
        errors += edit_distance(ref, hyp)
        chars += len(ref)
        if ref == hyp:
            exact += 1
        else:
            wrong.append((truth, text))
    print(f"녹음 {len(cases)}건 · CER {100 * errors / chars:.1f}% · 문장 일치 {exact}/{len(cases)}")
    for truth, text in wrong:
        print(f"  {truth}  →  {text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
