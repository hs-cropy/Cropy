"""기능 선택 모델 묶음(function-models.json): 매니페스트 병합과 내보내기 스크립트 (#166)."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from app.core.config import settings

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/export_browser_model.py"
spec = importlib.util.spec_from_file_location("export_browser_model", SCRIPT)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

CNN = {"version": "a" * 64, "model_version": "b" * 64, "preprocessing_version": "browser-test", "diseases": []}


@pytest.fixture
def bundle_dir(tmp_path, monkeypatch):
    target = tmp_path / "bundle"
    target.mkdir()
    (target / "manifest.json").write_text(json.dumps(CNN), encoding="utf-8")
    monkeypatch.setattr(settings, "offline_bundle_dir", target)
    return target


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def mobile_source(root):
    for name in exporter.MOBILE_CLF_FILES:
        write(root / name, name.encode() * 3)
    return root


def test_manifest_without_function_models_is_unchanged(client, bundle_dir):
    body = client.get("/api/v1/offline/manifest").json()
    assert body == CNN
    assert "function_models" not in body


def test_manifest_merges_function_models_without_changing_cnn_version(client, bundle_dir, tmp_path):
    exporter.publish_function_bundle("mobile_clf", mobile_source(tmp_path / "clf"), bundle_dir)
    body = client.get("/api/v1/offline/manifest").json()
    assert body["version"] == CNN["version"]
    bundle = body["function_models"]["mobile_clf"]
    assert [f["name"] for f in bundle["files"]] == exporter.MOBILE_CLF_FILES
    # manifest.json 파일 자체는 그대로다 (기록 동기화의 ?version= 아카이브도 영향 없음)
    assert json.loads((bundle_dir / "manifest.json").read_text(encoding="utf-8")) == CNN


def test_unreadable_function_models_file_is_ignored(client, bundle_dir):
    (bundle_dir / "function-models.json").write_text("{broken", encoding="utf-8")
    body = client.get("/api/v1/offline/manifest").json()
    assert body == CNN


def test_publish_writes_per_file_sha_and_copies_into_version_folder(tmp_path):
    target = tmp_path / "out"
    source = mobile_source(tmp_path / "clf")
    bundle = exporter.publish_function_bundle("mobile_clf", source, target)
    assert bundle["base_url"] == f"/offline-assets/function/mobile_clf/{bundle['version'][:16]}"
    assert bundle["total_bytes"] == sum(f["bytes"] for f in bundle["files"])
    folder = target / "function/mobile_clf" / bundle["version"][:16]
    for entry in bundle["files"]:
        data = (folder / entry["name"]).read_bytes()
        assert entry["bytes"] == len(data)
        assert entry["sha256"] == hashlib.sha256(data).hexdigest()
    assert json.loads((target / "function-models.json").read_text(encoding="utf-8")) == {"mobile_clf": bundle}
    # 같은 내용을 다시 등록하면 version 이 같다
    assert exporter.publish_function_bundle("mobile_clf", source, target)["version"] == bundle["version"]


def test_publish_keeps_other_kinds_and_changes_version_with_content(tmp_path):
    target = tmp_path / "out"
    first = exporter.publish_function_bundle("mobile_clf", mobile_source(tmp_path / "clf"), target)
    qwen = tmp_path / "qwen"
    write(qwen / "config.json", b"{}")
    write(qwen / "onnx/decoder_q4f16.onnx_data", b"x" * 10)
    write(qwen / "prefix_q4f16.json", b"{}")
    write(qwen / "prefix_q4f16.bin", b"p" * 4)
    (qwen / "files.json").write_text(json.dumps([["config.json", 2], ["onnx/decoder_q4f16.onnx_data", 10]]), encoding="utf-8")
    web = exporter.publish_function_bundle("web_qwen", qwen, target)
    assert [f["name"] for f in web["files"]] == ["config.json", "onnx/decoder_q4f16.onnx_data", "prefix_q4f16.json", "prefix_q4f16.bin"]
    # files.json 에 prefix 가 이미 있어도 한 번만 들어간다
    (qwen / "files.json").write_text(json.dumps([["config.json", 2], ["prefix_q4f16.bin", 4]]), encoding="utf-8")
    deduped = exporter.publish_function_bundle("web_qwen", qwen, tmp_path / "out2")
    assert [f["name"] for f in deduped["files"]] == ["config.json", "prefix_q4f16.bin", "prefix_q4f16.json"]
    assert (target / "function/web_qwen" / web["version"][:16] / "onnx/decoder_q4f16.onnx_data").is_file()
    models = json.loads((target / "function-models.json").read_text(encoding="utf-8"))
    assert models == {"mobile_clf": first, "web_qwen": web}
    write(tmp_path / "clf/labels.json", b"changed")
    assert exporter.publish_function_bundle("mobile_clf", tmp_path / "clf", target)["version"] != first["version"]


def test_publish_rejects_missing_files_unknown_kind_and_size_mismatch(tmp_path):
    source = mobile_source(tmp_path / "clf")
    (source / "labels.json").unlink()
    with pytest.raises(ValueError, match="labels.json"):
        exporter.publish_function_bundle("mobile_clf", source, tmp_path / "out")
    with pytest.raises(ValueError, match="알 수 없는"):
        exporter.publish_function_bundle("ios_clf", source, tmp_path / "out")
    qwen = tmp_path / "qwen"
    write(qwen / "config.json", b"{}")
    (qwen / "files.json").write_text(json.dumps([["config.json", 99]]), encoding="utf-8")
    with pytest.raises(ValueError, match="크기"):
        exporter.publish_function_bundle("web_qwen", qwen, tmp_path / "out")
    for name in ["../outside", "/abs/file", "C:x", "C:/abs", "a\\b", "./a", "a/../b"]:
        (qwen / "files.json").write_text(json.dumps([[name, 2]]), encoding="utf-8")
        with pytest.raises(ValueError, match="묶음 밖"):
            exporter.publish_function_bundle("web_qwen", qwen, tmp_path / "out")
    (qwen / "files.json").write_text(json.dumps([["config.json"]]), encoding="utf-8")
    with pytest.raises(ValueError, match="형식"):
        exporter.publish_function_bundle("web_qwen", qwen, tmp_path / "out")
    assert not (tmp_path / "out/function-models.json").exists()


def test_publish_rejects_file_too_big_for_browser_cache(tmp_path, monkeypatch):
    # Chrome은 1GB가 넘는 응답을 Cache Storage에 넣지 못한다. 한도를 낮춰 나누지 않은 큰 파일을 막는지 본다
    monkeypatch.setattr(exporter, "MAX_BUNDLE_FILE_BYTES", 8)
    source = mobile_source(tmp_path / "clf")
    with pytest.raises(ValueError, match="shard_bundle"):
        exporter.publish_function_bundle("mobile_clf", source, tmp_path / "out")
    assert not (tmp_path / "out/function-models.json").exists()
