"""Persistence, crop/provenance contracts, portability and failure compensation."""
import asyncio
from pathlib import Path
import time
import threading

import httpx
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.models.entities import Diagnosis
from app.services import diagnosis_service as service
from app.services.seed import seed_database


CONTEXT = dict(prediction_mode="model", model_version="model-a", preprocessing_version="resize-224-imagenet-v1", pair_model_version=None)
DIST = [(2, .6), (3, .25), (7, .15)]


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr(service, "get_prediction_context", lambda: dict(CONTEXT), raising=False)
    monkeypatch.setattr(service, "predict_all", lambda _: DIST)
    monkeypatch.setattr(service, "predict", lambda _: DIST, raising=False)
    monkeypatch.setattr(service, "predict_pair", lambda _: None)
    with Session(engine) as session:
        seed_database(session)
        yield session
    engine.dispose()


def test_inference_failure_leaves_no_file_or_diagnosis(db, sample_image, monkeypatch):
    def fail(_):
        raise RuntimeError("inference failed")
    monkeypatch.setattr(service, "predict_all", fail)
    monkeypatch.setattr(service, "predict", fail, raising=False)
    with pytest.raises(RuntimeError):
        service.diagnose_image(db, sample_image, "leaf.jpg", None)
    assert list(settings.upload_dir.iterdir()) == []
    assert db.query(Diagnosis).count() == 0


def test_commit_failure_rolls_back_and_removes_new_file(db, sample_image, monkeypatch):
    def fail():
        raise RuntimeError("commit failed")
    monkeypatch.setattr(db, "commit", fail)
    with pytest.raises(RuntimeError):
        service.diagnose_image(db, sample_image, "leaf.jpg", None)
    assert list(settings.upload_dir.iterdir()) == []
    assert not db.new
    assert db.query(Diagnosis).count() == 0


def test_initial_provenance_crop_and_recapture_survive_history(db, sample_image):
    created = service.diagnose_image(db, sample_image, "leaf.jpg", "고추")
    detail = service.get_diagnosis_detail(db, created.id)
    assert detail.selected_crop == "고추"
    assert detail.predicted_crop == "무"
    assert detail.crop_mismatch is True
    assert detail.prediction_mode == "model"
    assert detail.model_version == "model-a"
    assert detail.created_at.utcoffset().total_seconds() == 0
    record = db.get(Diagnosis, created.id)
    assert record.image_path == Path(record.image_path).name
    assert record.original_predictions == [[2, .6], [3, .25], [7, .15]]


def test_recapture_persists_without_reinference(db, sample_image, monkeypatch):
    monkeypatch.setattr(service, "predict_all", lambda _: [(2, .45), (3, .4), (7, .15)])
    monkeypatch.setattr(service, "predict", lambda _: [(2, .45), (3, .4), (7, .15)], raising=False)
    created = service.diagnose_image(db, sample_image, "leaf.jpg", None)
    detail = service.get_diagnosis_detail(db, created.id)
    assert detail.recapture == created.recapture
    assert detail.recapture is not None


def test_refine_rejects_changed_model_and_preserves_state(db, sample_image, monkeypatch):
    created = service.diagnose_image(db, sample_image, "leaf.jpg", None)
    before = set(settings.upload_dir.iterdir())
    monkeypatch.setattr(service, "get_prediction_context", lambda: {**CONTEXT, "model_version": "model-b"}, raising=False)
    with pytest.raises(RuntimeError, match="model|모델"):
        service.refine_diagnosis(db, created.id, sample_image, "second.jpg")
    assert set(settings.upload_dir.iterdir()) == before
    assert db.get(Diagnosis, created.id).refined_image_path is None


def test_replaced_refinement_removed_only_after_commit(db, sample_image):
    created = service.diagnose_image(db, sample_image, "leaf.jpg", None)
    first = service.refine_diagnosis(db, created.id, sample_image, "second.jpg")
    old_name = first.refined_image_url.rsplit("/", 1)[-1]
    new = service.refine_diagnosis(db, created.id, sample_image, "third.jpg")
    assert not (settings.upload_dir / old_name).exists()
    assert (settings.upload_dir / new.refined_image_url.rsplit("/", 1)[-1]).exists()
    assert len(list(settings.upload_dir.iterdir())) == 2


def test_failed_refinement_commit_keeps_old_images_and_record(db, sample_image, monkeypatch):
    created = service.diagnose_image(db, sample_image, "leaf.jpg", None)
    first = service.refine_diagnosis(db, created.id, sample_image, "second.jpg")
    files_before = set(settings.upload_dir.iterdir())
    def fail():
        raise RuntimeError("commit failed")
    monkeypatch.setattr(db, "commit", fail)
    with pytest.raises(RuntimeError):
        service.refine_diagnosis(db, created.id, sample_image, "third.jpg")
    assert set(settings.upload_dir.iterdir()) == files_before
    assert service.get_diagnosis_detail(db, created.id).refined_image_url == first.refined_image_url


def test_windows_legacy_path_uses_current_upload_root(db, sample_image):
    created = service.diagnose_image(db, sample_image, "leaf.jpg", None)
    record = db.get(Diagnosis, created.id)
    name = Path(record.image_path).name
    record.image_path = 'C:\\old-machine\\uploads\\' + name
    db.commit()
    assert service.get_diagnosis_detail(db, created.id).image_url == '/uploads/' + name
    assert service.refine_diagnosis(db, created.id, sample_image, "second.jpg") is not None


def test_invalid_selected_crop_is_rejected(client, sample_image):
    response = client.post('/api/v1/diagnose?crop_type=unsupported', files={'file': ('x.jpg', sample_image, 'image/jpeg')})
    assert response.status_code == 422


def test_model_conflict_api_returns_409(client, sample_image, monkeypatch):
    monkeypatch.setattr(service, "get_prediction_context", lambda: dict(CONTEXT))
    monkeypatch.setattr(service, "predict_all", lambda _: DIST)
    created = client.post('/api/v1/diagnose', files={'file': ('x.jpg', sample_image, 'image/jpeg')}).json()
    monkeypatch.setattr(service, "get_prediction_context", lambda: {**CONTEXT, "model_version": "changed"})
    response = client.post(f"/api/v1/diagnose/{created['id']}/refine", files={'file': ('x.jpg', sample_image, 'image/jpeg')})
    assert response.status_code == 409
    assert client.get(f"/api/v1/history/{created['id']}").json()["model_version"] == "model-a"


def test_history_crop_filter_and_refinement_summary(db, sample_image):
    first = service.diagnose_image(db, sample_image, "leaf.jpg", "무")
    service.diagnose_image(db, sample_image, "leaf.jpg", "고추")
    service.refine_diagnosis(db, first.id, sample_image, "second.jpg")
    history = service.get_history(db, 1, 20, "무")
    assert history.total == 1
    assert history.items[0].id == first.id
    assert history.items[0].refined_image_url is not None
