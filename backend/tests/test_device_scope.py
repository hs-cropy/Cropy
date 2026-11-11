"""Anonymous device cookie: each browser sees only its own diagnosis records."""
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.device import COOKIE_NAME
from app.main import app
from app.services import diagnosis_service as service


@pytest.fixture(autouse=True)
def fixed_predictions(monkeypatch):
    monkeypatch.setattr(service, "predict_all", lambda _: [(0, .9), (1, .1)])
    monkeypatch.setattr(service, "predict_pair", lambda _: None)


@pytest.fixture
def devices(client):
    # `client` runs the app lifespan; extra clients keep separate cookie jars.
    with TestClient(app) as a, TestClient(app) as b:
        yield a, b


def diagnose(c, image, headers=None):
    response = c.post("/api/v1/diagnose", headers=headers or {}, files={"file": ("x.jpg", image, "image/jpeg")})
    assert response.status_code == 200, response.text
    return response.json()


def test_cookie_is_issued_once_as_http_only(devices):
    a, _ = devices
    first = a.get("/api/v1/history")
    cookie = first.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=") and "HttpOnly" in cookie and "SameSite=Lax" in cookie
    assert "Secure" not in cookie
    assert "set-cookie" not in a.get("/api/v1/history").headers


def test_cookie_is_secure_behind_https_proxy(devices):
    a, _ = devices
    # Next.js appends its own hop to Caddy's header.
    response = a.get("/api/v1/health", headers={"X-Forwarded-Proto": "https,http"})
    assert "Secure" in response.headers["set-cookie"]


def test_invalid_cookie_is_replaced(devices):
    a, _ = devices
    a.cookies.set(COOKIE_NAME, "bad value!")
    assert a.get("/api/v1/history").headers["set-cookie"].startswith(f"{COOKIE_NAME}=")


def test_other_device_cannot_list_read_or_refine(devices, sample_image, second_image):
    a, b = devices
    created = diagnose(a, sample_image)
    assert created["id"] in [i["id"] for i in a.get("/api/v1/history").json()["items"]]
    assert created["id"] not in [i["id"] for i in b.get("/api/v1/history").json()["items"]]
    assert b.get(f"/api/v1/history/{created['id']}").status_code == 404
    refine = b.post(f"/api/v1/diagnose/{created['id']}/refine", files={"file": ("y.jpg", second_image, "image/jpeg")})
    assert refine.status_code == 404
    assert a.get(f"/api/v1/history/{created['id']}").status_code == 200


def test_same_request_key_on_two_devices_creates_two_records(devices, sample_image):
    a, b = devices
    headers = {"Idempotency-Key": "shared-device-key"}
    assert diagnose(a, sample_image, headers)["id"] != diagnose(b, sample_image, headers)["id"]


def test_recovery_token_is_bound_to_its_device(devices, sample_image, monkeypatch):
    a, b = devices
    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", lambda _: (_ for _ in ()).throw(OperationalError("COMMIT", {}, Exception())))
        failed = diagnose(a, sample_image)
    assert failed["save_status"] == "failed"
    stolen = b.post(f"/api/v1/results/{failed['recovery_token']}/save")
    assert stolen.status_code == 404 and stolen.json()["code"] == "RESULT_NOT_FOUND"
    saved = a.post(f"/api/v1/results/{failed['recovery_token']}/save")
    assert saved.status_code == 200 and saved.json()["id"] == failed["id"]
    assert b.post(f"/api/v1/results/{failed['recovery_token']}/save").status_code == 404


def test_records_from_before_device_scoping_are_hidden(devices, sample_image):
    a, _ = devices
    with SessionLocal() as db:
        legacy = service.diagnose_image(db, sample_image, "legacy.jpg", None)  # device_id=None
    assert legacy.id not in [i["id"] for i in a.get("/api/v1/history").json()["items"]]
    assert a.get(f"/api/v1/history/{legacy.id}").status_code == 404


def test_device_cookie_survives_malformed_cookie_before_it(devices):
    a, _ = devices
    token = a.get("/api/v1/history").cookies[COOKIE_NAME]
    for header in (f'theme={{"x":1}}; {COOKIE_NAME}={token}', f"x=a b; {COOKIE_NAME}={token}"):
        with TestClient(app) as fresh:
            response = fresh.get("/api/v1/history", headers={"Cookie": header})
            assert "set-cookie" not in response.headers


@pytest.fixture
def offline_bundle(tmp_path, monkeypatch):
    import json
    from pathlib import Path
    from app.core.config import settings
    diseases = json.loads((Path(__file__).resolve().parents[1] / "app/data/seed/diseases.json").read_text(encoding="utf-8"))
    manifest = {"version": "a" * 64, "model_version": "b" * 64, "preprocessing_version": "browser-test", "diseases": diseases}
    for name in ("manifest.json", "manifest-" + "a" * 16 + ".json"):
        (tmp_path / name).write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(settings, "offline_bundle_dir", tmp_path)
    return manifest


def test_offline_resend_after_lost_cookie_returns_record_to_new_cookie(devices, sample_image, second_image, offline_bundle):
    import json
    from datetime import datetime, timezone
    a, b = devices
    meta = json.dumps(dict(client_record_id="0b9d1c7e-2f4a-4c61-9a3e-5d2f8e7b6a10", selected_crop="고추",
        model_version=offline_bundle["model_version"], preprocessing_version=offline_bundle["preprocessing_version"],
        bundle_version=offline_bundle["version"], created_at=datetime.now(timezone.utc).isoformat(),
        predictions=[{"class_id": i, "confidence": .92 if i == 0 else .01} for i in range(9)]))
    def sync(c, metadata, image):
        return c.post("/api/v1/offline/records", data={"metadata": metadata}, files={"file": ("x.jpg", image, "image/jpeg")})
    first = sync(a, meta, sample_image)
    assert first.status_code == 200, first.text
    # The response (and its Set-Cookie) never reached the phone: the resend arrives as a new device.
    resend = sync(b, meta, sample_image)
    assert resend.status_code == 200, resend.text
    assert resend.json()["id"] == first.json()["id"]
    assert first.json()["id"] in [i["id"] for i in b.get("/api/v1/history").json()["items"]]
    assert sync(b, meta, sample_image).json()["id"] == first.json()["id"]  # cached for the new device now
    # Same record ID with different content is still a conflict.
    assert sync(a, meta, second_image).status_code == 409
