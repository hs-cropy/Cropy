"""Bounded wait for a diagnosis slot, and SQLite WAL for concurrent reads/writes."""
import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine
from app.main import app
from app.services import diagnosis_service


@pytest.fixture(autouse=True)
def fixed_predictions(monkeypatch):
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda _: [(0, .9), (1, .1)])
    monkeypatch.setattr(diagnosis_service, "predict_pair", lambda _: None)


@pytest.fixture
def busy_server(client, monkeypatch):
    # Every slot is taken by another (long) diagnosis.
    monkeypatch.setattr(settings, "diagnosis_queue_timeout_seconds", .05)
    original = app.state.diagnosis_limiter
    app.state.diagnosis_limiter = asyncio.Semaphore(0)
    yield
    app.state.diagnosis_limiter = original


def test_queued_diagnosis_gives_up_with_retryable_busy(client, busy_server, sample_image):
    response = client.post("/api/v1/diagnose", files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 503
    assert response.json()["code"] == "SERVER_BUSY" and response.json()["retryable"] is True
    assert response.headers["retry-after"] == "5"


def test_busy_rejection_does_not_leak_a_slot(client, sample_image, monkeypatch):
    monkeypatch.setattr(settings, "diagnosis_queue_timeout_seconds", .05)
    limiter = app.state.diagnosis_limiter = asyncio.Semaphore(1)
    try:
        asyncio.run(limiter.acquire())  # another diagnosis holds the only slot
        busy = client.post("/api/v1/diagnose", files={"file": ("x.jpg", sample_image, "image/jpeg")})
        assert busy.json()["code"] == "SERVER_BUSY"
        limiter.release()  # that diagnosis finishes
        assert client.post("/api/v1/diagnose", files={"file": ("x.jpg", sample_image, "image/jpeg")}).status_code == 200
        assert not limiter.locked()
    finally:
        app.state.diagnosis_limiter = asyncio.Semaphore(settings.max_concurrent_diagnoses)


def test_every_slot_route_is_bounded(client, busy_server, sample_image):
    created = {"refine": "/api/v1/diagnose/00000000-0000-0000-0000-000000000000/refine",
               "save": "/api/v1/results/00000000-0000-0000-0000-000000000000/save"}
    assert client.post(created["refine"], files={"file": ("x.jpg", sample_image, "image/jpeg")}).json()["code"] == "SERVER_BUSY"
    assert client.post(created["save"]).json()["code"] == "SERVER_BUSY"


def test_offline_sync_is_bounded(client, busy_server, sample_image):
    metadata = {"client_record_id": str(uuid4()), "model_version": "m", "preprocessing_version": "p",
                "bundle_version": "a" * 64, "created_at": datetime.now(timezone.utc).isoformat(),
                "predictions": [{"class_id": i, "confidence": .1} for i in range(10)]}
    response = client.post("/api/v1/offline/records", data={"metadata": json.dumps(metadata)},
                           files={"file": ("x.jpg", sample_image, "image/jpeg")})
    assert response.status_code == 503 and response.json()["code"] == "SERVER_BUSY"


def test_sqlite_uses_write_ahead_log(client):
    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
