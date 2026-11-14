"""기능 선택 모델 자산 검사(check_assets.py). 실제 모델 없이 작은 가짜 폴더로 계약 검사를 확인한다."""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qwen"))
import check_assets  # noqa: E402
import spec_v2  # noqa: E402


def good_labels():
    heads = [{"function": name, "argument": arg, "values": [v for v, _ in values]}
             for name, args, _ in spec_v2.FUNCTIONS for arg, values in args.items()]
    return {"functions": list(spec_v2.NAMES), "heads": heads}


def good_prompt():
    functions = {name: [[arg, len(values)] for arg, values in args.items()] for name, args, _ in spec_v2.FUNCTIONS}
    tokens = {token: 248077 + i for i, token in enumerate(spec_v2.NEW_TOKENS)}
    return {"functions": functions, "new_tokens": tokens, "stop_token": spec_v2.END}


def test_labels_in_spec_order_pass():
    assert check_assets.check_labels(good_labels()) == []


def test_labels_with_swapped_functions_fail():
    labels = good_labels()
    labels["functions"][0], labels["functions"][1] = labels["functions"][1], labels["functions"][0]
    assert any("순서" in e for e in check_assets.check_labels(labels))


def test_labels_missing_head_fail():
    labels = good_labels()
    labels["heads"] = [h for h in labels["heads"] if h["function"] != "get_pesticide_information"]
    errors = check_assets.check_labels(labels)
    assert any("get_pesticide_information.topic" in e for e in errors)


def test_prompt_in_spec_order_pass():
    assert check_assets.check_prompt(good_prompt()) == []


def test_prompt_with_wrong_value_count_fail():
    prompt = good_prompt()
    prompt["functions"]["get_diagnosis"] = [["topic", 6]]
    assert check_assets.check_prompt(prompt)


def test_folder_size_and_hash(tmp_path):
    (tmp_path / "labels.json").write_text(json.dumps(good_labels()), encoding="utf-8")
    model = tmp_path / "model_int8.onnx"
    model.write_bytes(b"onnx")
    digest = hashlib.sha256(b"onnx").hexdigest()
    labels_bytes = (tmp_path / "labels.json").read_bytes()
    manifest = {"assets": {"mobile_clf": {"files": {
        "model_int8.onnx": {"bytes": 4, "sha256": digest},
        "labels.json": {"bytes": len(labels_bytes), "sha256": hashlib.sha256(labels_bytes).hexdigest()},
    }}}}
    assert check_assets.check_folder("mobile_clf", tmp_path, manifest) == []

    model.write_bytes(b"ONNX")  # 같은 크기, 다른 내용
    assert any("SHA-256" in e for e in check_assets.check_folder("mobile_clf", tmp_path, manifest))


def test_missing_hash_is_written_only_with_flag(tmp_path):
    (tmp_path / "a.bin").write_bytes(b"abc")
    manifest = {"assets": {"web_qwen": {"files": {"a.bin": {"bytes": 3, "sha256": None}}}}}
    assert check_assets.check_folder("web_qwen", tmp_path, manifest) == []
    assert manifest["assets"]["web_qwen"]["files"]["a.bin"]["sha256"] is None
    check_assets.check_folder("web_qwen", tmp_path, manifest, write=True)
    assert manifest["assets"]["web_qwen"]["files"]["a.bin"]["sha256"] == hashlib.sha256(b"abc").hexdigest()


def test_repository_manifest_lists_four_kinds():
    manifest = json.loads(check_assets.MANIFEST.read_text(encoding="utf-8"))
    assert set(manifest["assets"]) == {"server", "mobile_clf", "web_qwen", "board_rkllm"}
