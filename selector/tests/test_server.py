"""기능 선택 서버(소형 분류기) 테스트.

모델 없이 도는 테스트와, 실제 분류기 폴더가 있을 때만 도는 테스트가 있다.
    CLF_DIR=C:/cropy/eval/clf8 python -m pytest selector/tests
    CLF_DIR=... CLF_REF=<ref.json> python -m pytest selector/tests   # validation 1,160행이 기준 출력과 같은지
ref.json 은 frontend/src/features/voice/lib/mobileClf.model.test.ts 가 쓰는 파일과 같다
(행마다 utterance, context, ctx, ids, type_ids, output).
"""

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

LABELS = {"functions": ["get_diagnosis", "chit_chat"],
          "heads": [{"function": "get_diagnosis", "argument": "topic", "values": ["result", "severity", "observation"]}]}


def test_assemble_call_counts_values_from_one():
    outputs = {"fn_logits": [3.0, 1.0], "get_diagnosis.topic": [0.1, 0.2, 0.9]}
    assert server.assemble_call(LABELS, outputs) == "<hs_0>(topic=3)<hs_end>"


def test_assemble_call_without_arguments():
    outputs = {"fn_logits": [0.0, 2.0], "get_diagnosis.topic": [9.0, 0.0, 0.0]}
    assert server.assemble_call(LABELS, outputs) == "<hs_1>()<hs_end>"


def test_context_text_matches_training_serialization():
    context = {"ui_stage": "result", "disease_name": "고추 탄저병", "confidence": 1.0, "crop_mismatch": False}
    assert server.context_text(context) == '{"ui_stage":"result","disease_name":"고추 탄저병","confidence":1.0,"crop_mismatch":false}'


def test_clf_v2_context_renames_keys_and_counts_pesticides():
    context = {"ui_stage": "result", "disease_name": "무 노균병", "confidence": 0.9,
               "top_predictions": [{"name": "무 노균병", "confidence": 0.9}], "recapture": {"region": "잎 뒷면"},
               "pesticides": ["가", "나", "다"]}
    assert server.context_text(context, "clf_v2") == (
        '{"단계":"result","병명":"무 노균병","점수":0.9,"후보":[{"이름":"무 노균병","점수":0.9}],'
        '"재촬영":{"부위":"잎 뒷면"},"농약":3}')
    assert context["pesticides"] == ["가", "나", "다"]  # 받은 화면 상태는 바꾸지 않는다


def test_context_without_format_is_unchanged():
    context = {"ui_stage": "result", "pesticides": ["가"]}
    assert server.context_text(context, None) == '{"ui_stage":"result","pesticides":["가"]}'


def write_bundle(root: Path, base_url="/offline-assets/function/mobile_clf/abcd") -> Path:
    folder = root / "function" / "mobile_clf" / "abcd"
    folder.mkdir(parents=True)
    (root / "function-models.json").write_text(json.dumps({"mobile_clf": {"version": "v1", "base_url": base_url}}), encoding="utf-8")
    return folder


def test_model_dir_follows_function_models_json(tmp_path, monkeypatch):
    monkeypatch.delenv("CLF_DIR", raising=False)
    monkeypatch.setenv("OFFLINE_ASSETS", str(tmp_path))
    folder = write_bundle(tmp_path)
    assert server.model_dir() == (folder.resolve(), "v1")


def test_model_dir_rejects_paths_outside_bundle(tmp_path, monkeypatch):
    monkeypatch.delenv("CLF_DIR", raising=False)
    monkeypatch.setenv("OFFLINE_ASSETS", str(tmp_path))
    write_bundle(tmp_path, base_url="/offline-assets/../../etc")
    with pytest.raises(ValueError):
        server.model_dir()


def test_missing_bundle_reports_error_and_select_is_503(tmp_path, monkeypatch):
    monkeypatch.delenv("CLF_DIR", raising=False)
    monkeypatch.setenv("OFFLINE_ASSETS", str(tmp_path))
    with TestClient(server.app) as client:
        health = client.get("/health").json()
        assert health["status"] == "error" and "function-models.json" in health["error"]
        assert client.post("/select", json={"utterance": "이거 무슨 병이야", "context": {}}).status_code == 503


CLF_DIR = os.getenv("CLF_DIR")
CLF_REF = os.getenv("CLF_REF")


@pytest.mark.skipif(not CLF_DIR, reason="CLF_DIR(실제 분류기 폴더)가 없다")
def test_real_model_answers_select():
    with TestClient(server.app) as client:
        assert client.get("/health").json()["status"] == "ready"
        body = client.post("/select", json={"utterance": "이거 무슨 병이야",
                                            "context": {"ui_stage": "result", "disease_name": "고추 탄저병", "confidence": 0.92}}).json()
        assert body["function_call"].startswith("<hs_") and body["function_call"].endswith("<hs_end>")


@pytest.mark.skipif(not (CLF_DIR and CLF_REF), reason="CLF_DIR·CLF_REF 가 없다")
def test_real_model_matches_reference_rows():
    rows = json.loads(Path(CLF_REF).read_text(encoding="utf-8"))
    server.load()
    assert server._state["status"] == "ready"
    bad_ctx, bad_ids, bad_out = [], [], []
    for row in rows:
        if server.context_text(row["context"], server._state["labels"].get("context_format")) != row["ctx"]:
            bad_ctx.append(row["utterance"])
        enc = server._state["tokenizer"].encode(row["utterance"], row["ctx"])
        if enc.ids != row["ids"] or enc.type_ids != row["type_ids"]:
            bad_ids.append(row["utterance"])
        if server.classify(row["utterance"], row["context"]) != row["output"]:
            bad_out.append(row["utterance"])
    assert bad_ctx == [] and bad_ids == []
    assert bad_out == [], f"{len(bad_out)}/{len(rows)} 행의 출력이 기준과 다르다"
