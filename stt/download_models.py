"""STT 모델 파일을 stt/models/에 내려받고 sha256을 확인한다 (처음 한 번, 약 240MB).

    stt/.venv/Scripts/python stt/download_models.py

보드가 인터넷에 연결되지 않으면 PC에서 받은 stt/models/ 폴더를 그대로 복사하면 된다.
이미 있고 해시가 맞는 파일은 다시 받지 않는다.
"""

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

MODEL_DIR = Path(os.getenv("STT_MODEL_DIR", Path(__file__).resolve().parent / "models"))
SENSEVOICE = "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main"
FILES = [
    # (저장 경로, 주소, sha256)
    ("sense-voice-2024-07-17/model.int8.onnx", f"{SENSEVOICE}/model.int8.onnx",
     "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51"),
    ("sense-voice-2024-07-17/tokens.txt", f"{SENSEVOICE}/tokens.txt",
     "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc"),
    ("silero_vad.onnx", "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
     "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    for name, url, expected in FILES:
        path = MODEL_DIR / name
        if path.is_file() and sha256(path) == expected:
            print(f"있음  {name}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + ".part")
        print(f"받는 중 {name}")
        urllib.request.urlretrieve(url, part)
        actual = sha256(part)
        if actual != expected:
            part.unlink()
            print(f"해시 불일치 {name}: {actual}", file=sys.stderr)
            return 1
        part.replace(path)
    print(f"완료: {MODEL_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
