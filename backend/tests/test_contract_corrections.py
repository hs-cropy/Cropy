"""Regressions found while comparing the live API with its published contract."""
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

from app.core.config import settings


@pytest.fixture
def local_metadata(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    diseases = json.loads((Path(__file__).resolve().parents[1] / "app/data/seed/diseases.json").read_text(encoding="utf-8"))
    manifest = {"version": "a" * 64, "model_version": "b" * 64,
                "preprocessing_version": "browser-test", "diseases": diseases}
    for name in ("manifest.json", "manifest-" + "a" * 16 + ".json"):
        (bundle / name).write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(settings, "offline_bundle_dir", bundle)
    return {"client_record_id": str(uuid4()), "model_version": "b" * 64,
            "preprocessing_version": "browser-test", "bundle_version": "a" * 64,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "predictions": [{"class_id": i, "confidence": .6 if i == 0 else .05} for i in range(9)]}


@pytest.mark.parametrize("version", ["", "a" * 63, "a" * 65, "A" * 64, "g" * 64, "a" * 63 + "\n"])
def test_malformed_bundle_rejected_before_saving(client, sample_image, local_metadata, version):
    before = client.get("/api/v1/history").json()["total"]
    local_metadata["bundle_version"] = version
    response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(local_metadata)},
                           files={"file": ("leaf.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert client.get("/api/v1/history").json()["total"] == before


def test_well_formed_unknown_bundle_is_conflict(client, sample_image, local_metadata):
    local_metadata["bundle_version"] = "c" * 64
    response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(local_metadata)},
                           files={"file": ("leaf.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 409
    assert response.json()["code"] == "UNSUPPORTED_BUNDLE"


@pytest.mark.parametrize("operation", ["diagnose", "refine", "offline", "offline_refined"])
def test_partial_image_write_failure_is_json_and_rolls_back(client, sample_image, local_metadata, monkeypatch, operation):
    files = {"file": ("leaf.jpg", sample_image, "image/jpeg")}
    original = None
    if operation == "refine":
        original = client.post("/api/v1/diagnose", files=files).json()
        path = f"/api/v1/diagnose/{original['id']}/refine"
    else:
        path = "/api/v1/offline/records" if operation.startswith("offline") else "/api/v1/diagnose"
    if operation == "offline_refined":
        local_metadata["refined_predictions"] = local_metadata["predictions"]
        files["refined_file"] = ("second.jpg", sample_image, "image/jpeg")
    before = client.get("/api/v1/history").json()["total"]
    old_files = set(settings.upload_dir.glob("*.jpg"))
    write_bytes = Path.write_bytes
    image_writes = 0

    def fail_write(self, data):
        nonlocal image_writes
        if self.parent == settings.upload_dir and self.suffix == ".jpg":
            image_writes += 1
            if operation == "offline_refined" and image_writes == 1:
                return write_bytes(self, data)
            write_bytes(self, data[:8])  # A disk may fail after creating a partial file.
            raise OSError("simulated disk full; private storage path")
        return write_bytes(self, data)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "write_bytes", fail_write)
        response = client.post(path, files=files,
                               data={"metadata": json.dumps(local_metadata)} if operation.startswith("offline") else None)
    assert response.status_code == 503
    assert response.json()["code"] == "IMAGE_STORAGE_UNAVAILABLE"
    assert response.json()["retryable"] is True
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert "private storage" not in response.text
    assert client.get("/api/v1/history").json()["total"] == before
    assert set(settings.upload_dir.glob("*.jpg")) == old_files
    if original:
        detail = client.get(f"/api/v1/history/{original['id']}").json()
        assert detail["refined_image_url"] is None
        assert detail["image_url"] == original["image_url"]


@pytest.mark.parametrize("directory,code", [("uploads", "IMAGE_STORAGE_UNAVAILABLE"),
                                            (".pending", "RECOVERY_STORAGE_UNAVAILABLE")])
def test_storage_directory_creation_failure_is_json(client, sample_image, monkeypatch, directory, code):
    mkdir = Path.mkdir
    target = settings.upload_dir if directory == "uploads" else settings.upload_dir / ".pending"

    def fail_mkdir(self, *args, **kwargs):
        if self == target:
            raise PermissionError("simulated directory permission failure")
        return mkdir(self, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "mkdir", fail_mkdir)
        response = client.post("/api/v1/diagnose", files={"file": ("leaf.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 503
    assert response.json()["code"] == code


def test_operation_examples_match_refine_and_offline_semantics(client):
    doc = client.get("/openapi.json").json()
    for path, field, expected in [("/api/v1/diagnose/{diagnosis_id}/refine", "is_refined", True),
                                   ("/api/v1/offline/records", "prediction_mode", "browser")]:
        examples = doc["paths"][path]["post"]["responses"]["200"]["content"]["application/json"]["examples"]
        for example in examples.values():
            assert example["value"][field] == expected
            if field == "is_refined":
                assert example["value"]["refined_image_url"]
                assert example["value"]["initial_predictions"]


def test_offline_metadata_exposes_validated_json_contract(client):
    doc = client.get("/openapi.json").json()
    body = doc["components"]["schemas"]["Body_sync_record_api_v1_offline_records_post"]
    metadata = body["properties"]["metadata"]
    assert metadata["type"] == "string"  # Wire format must stay multipart JSON text.
    ref = metadata["contentSchema"]["$ref"].split("/")[-1]
    record = doc["components"]["schemas"][ref]
    assert "bundle_version" in record["required"]
    assert record["properties"]["bundle_version"]["minLength"] == 64
    assert record["properties"]["bundle_version"]["pattern"] == "^[0-9a-f]{64}$"
