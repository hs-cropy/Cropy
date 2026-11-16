"""오프라인 화면의 기기 안 받아 적기 묶음 폴더를 만든다.

    python stt/make_browser_bundle.py <출력 폴더>
    backend/.venv/Scripts/python backend/scripts/export_browser_model.py --function-bundle stt=<출력 폴더> --output <offline-assets>

서버 STT 와 같은 모델(stt/models/sense-voice-2024-07-17, download_models.py 로 받음)을 쓴다. 브라우저의 onnxruntime-web 은
모델 메타데이터를 읽지 못하므로 특징 정규화 값(neg_mean·inv_stddev)과 언어·ITN 번호를 sensevoice.json 으로 꺼내 둔다.
용어 보정 사전(terms.txt)도 함께 넣어 서버와 같은 보정을 한다. 계산 방식은 frontend/public/offline/voice-stt.mjs.
"""
import json
import shutil
import sys
from pathlib import Path

import onnxruntime as ort

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / "models" / "sense-voice-2024-07-17"


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    model = MODEL_DIR / "model.int8.onnx"
    meta = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"]).get_modelmeta().custom_metadata_map
    if meta.get("model_type") != "sense_voice_ctc" or meta.get("normalize_samples") != "0":
        raise SystemExit(f"예상한 SenseVoice 모델이 아닙니다: {meta.get('model_type')}")
    info = {
        "model": "sense-voice-2024-07-17 int8",
        "sample_rate": 16000,
        "lang_ko": int(meta["lang_ko"]),
        "with_itn": int(meta["with_itn"]),
        "lfr_window_size": int(meta["lfr_window_size"]),
        "lfr_window_shift": int(meta["lfr_window_shift"]),
        "neg_mean": [float(x) for x in meta["neg_mean"].split(",")],
        "inv_stddev": [float(x) for x in meta["inv_stddev"].split(",")],
    }
    if info["lfr_window_size"] != 7 or info["lfr_window_shift"] != 6 or len(info["neg_mean"]) != 560:
        raise SystemExit("LFR 설정이 voice-stt.mjs 와 다릅니다")
    for name in ("model.int8.onnx", "tokens.txt"):
        shutil.copyfile(MODEL_DIR / name, out / name)
    shutil.copyfile(HERE / "terms.txt", out / "terms.txt")
    (out / "sensevoice.json").write_text(json.dumps(info), encoding="utf-8")
    print("묶음 폴더:", out)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
