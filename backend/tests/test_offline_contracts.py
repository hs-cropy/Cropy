import json
from pathlib import Path
import pytest
from datetime import datetime, timezone

from app.core.config import settings


@pytest.fixture(autouse=True)
def offline_bundle(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    diseases = json.loads((Path(__file__).resolve().parents[1] / "app/data/seed/diseases.json").read_text(encoding="utf-8"))
    manifest = {"version": "a" * 64, "model_version": "b" * 64, "preprocessing_version": "browser-test", "diseases": diseases}
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (bundle / ("manifest-" + "a" * 16 + ".json")).write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(settings, "offline_bundle_dir", bundle)


def test_browser_manifest_and_sync_are_idempotent(client, sample_image):
    response = client.get("/api/v1/offline/manifest")
    assert response.status_code == 200
    manifest = response.json()
    metadata = dict(client_record_id="eee4d0d5-bba4-432e-bc74-376491cdf699", selected_crop="고추",
        model_version=manifest["model_version"], preprocessing_version=manifest["preprocessing_version"],
        bundle_version=manifest["version"], created_at=datetime.now(timezone.utc).isoformat(),
        predictions=[{"class_id": i, "confidence": .92 if i == 0 else .01} for i in range(9)])
    def sync(meta):
        return client.post("/api/v1/offline/records", data={"metadata": json.dumps(meta)},
                           files={"file": ("x.jpg", sample_image, "image/jpeg")})
    first, repeat = sync(metadata), sync(metadata)
    assert first.status_code == repeat.status_code == 200
    assert first.json()["id"] == repeat.json()["id"]
    assert first.json()["prediction_mode"] == "browser"
    assert first.json()["content_status"] == "snapshot"
    metadata["selected_crop"] = "무"
    assert sync(metadata).status_code == 409


def test_browser_sync_rejects_unknown_model_and_bad_distribution(client, sample_image):
    meta = dict(client_record_id="41c9cdf2-2fd7-4a4b-a050-9861a83f3931", selected_crop="무",
        model_version="unknown", preprocessing_version="unknown", bundle_version="unknown",
        created_at=datetime.now(timezone.utc).isoformat(),
        predictions=[{"class_id": i, "confidence": .8} for i in range(9)])
    response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(meta)},
                           files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert response.status_code in (400, 409, 422)
    assert response.json()["code"] in ("INVALID_DISTRIBUTION", "UNSUPPORTED_BUNDLE", "VALIDATION_ERROR")


def test_two_valid_photos_fit_offline_request_limit(client, sample_image):
    manifest = client.get("/api/v1/offline/manifest").json()
    predictions = [{"class_id": i, "confidence": .92 if i == 0 else .01} for i in range(9)]
    meta = dict(client_record_id="12c9cdf2-2fd7-4a4b-a050-9861a83f3931",
        model_version=manifest["model_version"], preprocessing_version=manifest["preprocessing_version"],
        bundle_version=manifest["version"], created_at=datetime.now(timezone.utc).isoformat(),
        predictions=predictions, refined_predictions=predictions)
    photo = sample_image + b"\0" * (700000 - len(sample_image))
    response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(meta)},
        files={"file": ("original.jpg", photo, "image/jpeg"), "refined_file": ("second.jpg", photo, "image/jpeg")})
    assert response.status_code == 200, response.text
    assert response.json()["is_refined"]


def ten_class_manifest():
    bundle = settings.offline_bundle_dir
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    manifest.update(version="c" * 64, class_ids=list(range(10)))
    (bundle / ("manifest-" + "c" * 16 + ".json")).write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def test_ten_class_bundle_syncs_other_and_rejects_nine_class_records(client, sample_image):
    manifest = ten_class_manifest()
    def sync(record_id, count, top):
        meta = dict(client_record_id=record_id, selected_crop="배추", model_version=manifest["model_version"],
            preprocessing_version=manifest["preprocessing_version"], bundle_version=manifest["version"],
            created_at=datetime.now(timezone.utc).isoformat(),
            predictions=[{"class_id": i, "confidence": 1 - .01 * (count - 1) if i == top else .01} for i in range(count)])
        return client.post("/api/v1/offline/records", data={"metadata": json.dumps(meta)},
                           files={"file": ("x.jpg", sample_image, "image/jpeg")})
    other = sync("5f0c2a57-3d1e-4f43-9a8a-2b8f3c1d9e01", 10, 9)
    assert other.status_code == 200, other.text
    body = other.json()
    assert (body["decision_status"], body["crop_mismatch"], body["crop_type"]) == ("not_crop", False, "배추")
    # #179: 판별 불가 기록은 서버에 남기지 않는다. 다시 보내도 같은 답이고 이력에 나오지 않는다
    assert body["save_status"] == "skipped" and body["image_url"] is None and body["speech_script"]
    again = sync("5f0c2a57-3d1e-4f43-9a8a-2b8f3c1d9e01", 10, 9)
    assert again.status_code == 200 and again.json()["save_status"] == "skipped"
    listed = [item["id"] for item in client.get("/api/v1/history", params={"size": 100}).json()["items"]]
    assert "5f0c2a57-3d1e-4f43-9a8a-2b8f3c1d9e01" not in listed
    assert client.get("/api/v1/history/5f0c2a57-3d1e-4f43-9a8a-2b8f3c1d9e01").status_code == 404
    assert sync("5f0c2a57-3d1e-4f43-9a8a-2b8f3c1d9e02", 9, 0).status_code == 422
    meta = dict(client_record_id="5f0c2a57-3d1e-4f43-9a8a-2b8f3c1d9e03", model_version=manifest["model_version"],
        preprocessing_version=manifest["preprocessing_version"], bundle_version=manifest["version"],
        created_at=datetime.now(timezone.utc).isoformat(),
        predictions=[{"class_id": 42 if i == 9 else i, "confidence": .1} for i in range(10)])
    response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(meta)},
                           files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 422


def test_top1_pair_policy_matches_server_rule_on_sync(client, sample_image):
    # 브라우저 묶음 policy 의 trigger="top1" 쌍: 첫 사진은 확신해도 재촬영, 재촬영 반영 결과는 마진 규칙만.
    from app.services.recapture import CONFUSION_PAIRS
    bundle = settings.offline_bundle_dir
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    manifest.update(version="d" * 64, policy={"version": "decision-v3", "low_confidence_threshold": .5,
        "confusion_margin": .2, "second_photo_weight": .6,
        "pairs": [{"ids": sorted(ids), **entry} for ids, entry in CONFUSION_PAIRS.items()]})
    (bundle / ("manifest-" + "d" * 16 + ".json")).write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    confident = [{"class_id": i, "confidence": .92 if i == 3 else .01} for i in range(9)]
    def sync(record_id, refined=None):
        meta = dict(client_record_id=record_id, selected_crop="무", model_version=manifest["model_version"],
            preprocessing_version=manifest["preprocessing_version"], bundle_version=manifest["version"],
            created_at=datetime.now(timezone.utc).isoformat(), predictions=confident)
        files = {"file": ("x.jpg", sample_image, "image/jpeg")}
        if refined:
            meta["refined_predictions"] = refined
            files["refined_file"] = ("y.jpg", sample_image, "image/jpeg")
        response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(meta)}, files=files)
        assert response.status_code == 200, response.text
        return response.json()
    first = sync("7a1b2c3d-0000-4000-8000-000000000001")
    assert first["recapture"]["region"] == "잎 뒷면" and first["decision_status"] == "confusion"
    refined = sync("7a1b2c3d-0000-4000-8000-000000000002", confident)
    assert refined["recapture"] is None and refined["is_refined"]
