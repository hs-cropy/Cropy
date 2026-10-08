"""Figma history, immutable content and shared decision contracts."""
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.models.entities import Diagnosis
from app.services import diagnosis_service as service
from app.services.seed import seed_database


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr(service, "get_prediction_context", lambda: dict(
        prediction_mode="model", model_version="m1", preprocessing_version="p1", pair_model_version=None))
    monkeypatch.setattr(service, "predict_all", lambda _: [(2, .6), (3, .25), (7, .15)])
    monkeypatch.setattr(service, "predict_pair", lambda _: None)
    with Session(engine) as session:
        seed_database(session)
        yield session
    engine.dispose()


def test_history_filters_grade_and_counts_before_pagination(db, sample_image, monkeypatch):
    service.diagnose_image(db, sample_image, "a.jpg", "무")
    monkeypatch.setattr(service, "predict_all", lambda _: [(0, .9), (1, .1)])
    high = service.diagnose_image(db, sample_image, "a.jpg", "고추")
    result = service.get_history(db, 1, 1, "고추", "high")
    assert result.total == 1 and result.unfiltered_total == 2 and result.crop_total == 1
    assert result.items[0].id == high.id and result.items[0].severity == "high"
    empty = service.get_history(db, 1, 1, "고추", "low")
    assert empty.total == 0 and empty.unfiltered_total == 2 and empty.crop_total == 1


def test_saved_content_does_not_change_when_catalog_content_changes(db, sample_image):
    created = service.diagnose_image(db, sample_image, "a.jpg", "무")
    disease = db.get(Diagnosis, created.id).disease
    disease.description = "changed after diagnosis"
    disease.severity = "high"
    disease.name = "renamed"
    db.commit()
    detail = service.get_diagnosis_detail(db, created.id)
    assert detail.description == created.description
    assert detail.severity == "medium" and detail.disease_name == created.disease_name
    assert detail.content_status == "snapshot"
    assert service.get_history(db, 1, 20, None, "medium").items[0].id == created.id


def test_legacy_content_is_explicitly_current_reference(db, sample_image):
    created = service.diagnose_image(db, sample_image, "a.jpg", "무")
    db.get(Diagnosis, created.id).content_snapshot = None
    db.commit()
    assert service.get_diagnosis_detail(db, created.id).content_status == "current_reference"


def test_refinement_preserves_remaining_ambiguity(db, sample_image, monkeypatch):
    monkeypatch.setattr(service, "predict_all", lambda _: [(2, .51), (3, .43), (7, .06)])
    created = service.diagnose_image(db, sample_image, "a.jpg", "무")
    refined = service.refine_diagnosis(db, created.id, sample_image, "b.jpg")
    assert refined.recapture is not None
    assert refined.decision_status == "confusion"
    assert refined.is_refined is True and refined.policy_version
    assert refined.initial_predictions[0].confidence == .51


def test_low_confidence_and_crop_mismatch_are_distinct_reasons(db, sample_image, monkeypatch):
    monkeypatch.setattr(service, "predict_all", lambda _: [(2, .4), (7, .35), (3, .25)])
    created = service.diagnose_image(db, sample_image, "a.jpg", "고추")
    assert created.decision_status == "crop_mismatch"
    assert set(created.decision_reasons) == {"crop_mismatch", "low_confidence"}
    assert created.management_actions


