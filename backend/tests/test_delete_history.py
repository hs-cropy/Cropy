"""DELETE /history/{id}: a device removes its own record, photos and cached replies."""
from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.entities import Diagnosis, DiagnosisRequest
from app.services import diagnosis_service as service


@pytest.fixture(autouse=True)
def fixed_predictions(monkeypatch):
    monkeypatch.setattr(service, "predict_all", lambda _: [(0, .9), (1, .1)])
    monkeypatch.setattr(service, "predict_pair", lambda _: None)


@pytest.fixture
def devices(client):
    with TestClient(app) as a, TestClient(app) as b:
        yield a, b


def diagnose(c, image, headers=None):
    response = c.post("/api/v1/diagnose", headers=headers or {}, files={"file": ("x.jpg", image, "image/jpeg")})
    assert response.status_code == 200, response.text
    return response.json()


def stored(url):
    return settings.upload_dir / url.rsplit("/", 1)[1]


def test_owner_deletes_record_and_both_photos(devices, sample_image, second_image):
    a, _ = devices
    created = diagnose(a, sample_image)
    refined = a.post(f"/api/v1/diagnose/{created['id']}/refine", files={"file": ("y.jpg", second_image, "image/jpeg")}).json()
    photos = [stored(refined["image_url"]), stored(refined["refined_image_url"])]
    assert all(p.is_file() for p in photos)
    response = a.delete(f"/api/v1/history/{created['id']}")
    assert response.status_code == 204 and response.content == b""
    assert a.get(f"/api/v1/history/{created['id']}").status_code == 404
    assert created["id"] not in [i["id"] for i in a.get("/api/v1/history").json()["items"]]
    assert not any(p.exists() for p in photos)
    assert a.get(refined["image_url"]).status_code == 404
    assert a.delete(f"/api/v1/history/{created['id']}").status_code == 404


def test_other_device_cannot_delete(devices, sample_image):
    a, b = devices
    created = diagnose(a, sample_image)
    response = b.delete(f"/api/v1/history/{created['id']}")
    assert response.status_code == 404 and response.json()["code"] == "DIAGNOSIS_NOT_FOUND"
    assert a.get(f"/api/v1/history/{created['id']}").status_code == 200
    assert stored(created["image_url"]).is_file()


def test_replayed_request_key_does_not_return_deleted_record(devices, sample_image):
    a, _ = devices
    headers = {"Idempotency-Key": "delete-then-replay"}
    first = diagnose(a, sample_image, headers)
    assert a.delete(f"/api/v1/history/{first['id']}").status_code == 204
    with SessionLocal() as db:
        assert not [r for r in db.query(DiagnosisRequest).all() if r.response.get("id") == first["id"]]
    again = diagnose(a, sample_image, headers)
    assert again["id"] != first["id"]
    assert a.get(f"/api/v1/history/{again['id']}").status_code == 200


def test_records_without_a_device_cannot_be_deleted(devices, sample_image):
    a, _ = devices
    with SessionLocal() as db:
        legacy = service.diagnose_image(db, sample_image, "legacy.jpg", None)
    assert a.delete(f"/api/v1/history/{legacy.id}").status_code == 404
    with SessionLocal() as db:
        assert db.get(Diagnosis, legacy.id) is not None
