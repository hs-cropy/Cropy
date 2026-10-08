"""API retries preserve trustworthy results without rerunning inference."""
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Diagnosis
from app.services import diagnosis_service as service
from app.core.database import SessionLocal
from app.services.result_recovery import commit_result, request_context
from app.schemas.diagnosis import DiagnoseResponse


def test_diagnosis_idempotency_and_payload_conflict(client, sample_image, second_image, monkeypatch):
    calls = []
    monkeypatch.setattr(service, "predict_all", lambda _: calls.append(1) or [(0, .9), (1, .1)])
    headers = {"Idempotency-Key": "diagnosis-replay"}
    first = client.post("/api/v1/diagnose?crop_type=고추", headers=headers, files={"file": ("x.jpg", sample_image, "image/jpeg")})
    again = client.post("/api/v1/diagnose?crop_type=고추", headers=headers, files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert first.status_code == again.status_code == 200
    assert first.json()["id"] == again.json()["id"] and len(calls) == 1
    conflict = client.post("/api/v1/diagnose?crop_type=고추", headers=headers, files={"file": ("x.jpg", second_image, "image/jpeg")})
    assert conflict.status_code == 409 and conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"


def test_save_failure_returns_result_and_recovery_does_not_reinfer(client, sample_image, monkeypatch):
    calls = []
    monkeypatch.setattr(service, "predict_all", lambda _: calls.append(1) or [(0, .9), (1, .1)])
    real_commit = Session.commit
    def fail(self):
        raise OperationalError("COMMIT", {}, RuntimeError("disk unavailable"))
    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail)
        response = client.post("/api/v1/diagnose", files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 200
    body = response.json()
    assert body["save_status"] == "failed" and body["recovery_token"]
    assert client.get(f"/api/v1/history/{body['id']}").status_code == 404
    saved = client.post(f"/api/v1/results/{body['recovery_token']}/save")
    assert saved.status_code == 200 and saved.json()["save_status"] == "saved"
    assert saved.json()["id"] == body["id"] and len(calls) == 1
    again = client.post(f"/api/v1/results/{body['recovery_token']}/save")
    assert again.status_code == 200 and again.json()["id"] == body["id"]


def test_failed_result_retry_key_reuses_pending_result(client, sample_image, monkeypatch):
    calls = []
    monkeypatch.setattr(service, "predict_all", lambda _: calls.append(1) or [(0, .9), (1, .1)])
    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", lambda _: (_ for _ in ()).throw(OperationalError("COMMIT", {}, Exception())))
        first = client.post("/api/v1/diagnose", headers={"Idempotency-Key": "pending-replay"}, files={"file": ("x.jpg", sample_image, "image/jpeg")})
    again = client.post("/api/v1/diagnose", headers={"Idempotency-Key": "pending-replay"}, files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert again.status_code == 200 and again.json()["save_status"] == "failed"
    assert first.json()["id"] == again.json()["id"] and len(calls) == 1


def test_unknown_recovery_token_cannot_submit_arbitrary_result(client):
    result = client.post("/api/v1/results/../../unknown/save", json={"disease_name": "invented"})
    assert result.status_code in (404, 422)
    result = client.post("/api/v1/results/00000000-0000-0000-0000-000000000000/save")
    assert result.status_code == 404 and result.json()["code"] == "RESULT_NOT_FOUND"


def test_concurrent_refinement_retry_returns_winner_without_deleting_its_photo(client, sample_image, monkeypatch):
    monkeypatch.setattr(service, "predict_all", lambda _: [(0, .9), (1, .1)])
    response = client.post("/api/v1/diagnose", files={"file": ("x.jpg", sample_image, "image/jpeg")}).json()
    context = request_context("refine:" + response["id"], "concurrent-retry", b"same-photo")
    winner_file = settings.upload_dir / "winner-refine.jpg"
    loser_file = settings.upload_dir / "loser-refine.jpg"
    winner_file.write_bytes(sample_image)
    loser_file.write_bytes(sample_image)
    with SessionLocal() as loser, SessionLocal() as winner:
        old = loser.get(Diagnosis, response["id"])
        revision = old.revision
        new = winner.get(Diagnosis, response["id"])
        new.refined_image_path = winner_file.name
        with winner.no_autoflush:
            expected = service._response(winner, new)
        commit_result(winner, new, expected, context, True, revision)
        old.refined_image_path = loser_file.name
        with loser.no_autoflush:
            stale = service._response(loser, old)
        actual = commit_result(loser, old, stale, context, True, revision)
        assert actual.refined_image_url == expected.refined_image_url
    assert winner_file.read_bytes() == sample_image
    assert not loser_file.exists()


def test_expired_recovery_does_not_create_history(client, sample_image, monkeypatch):
    import json
    from datetime import datetime, timedelta, timezone
    monkeypatch.setattr(service, "predict_all", lambda _: [(0, .9), (1, .1)])
    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", lambda _: (_ for _ in ()).throw(OperationalError("COMMIT", {}, Exception())))
        response = client.post("/api/v1/diagnose", files={"file": ("x.jpg", sample_image, "image/jpeg")}).json()
    draft = settings.upload_dir / ".pending" / (response["recovery_token"] + ".json")
    data = json.loads(draft.read_text(encoding="utf-8"))
    data["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    draft.write_text(json.dumps(data), encoding="utf-8")
    saved = client.post(f"/api/v1/results/{response['recovery_token']}/save")
    assert saved.status_code == 410 and saved.json()["code"] == "RESULT_EXPIRED"
    assert client.get(f"/api/v1/history/{response['id']}").status_code == 404
