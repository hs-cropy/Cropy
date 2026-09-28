"""Invalid model output must never become a saved disease diagnosis."""

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.models.entities import Diagnosis
from app.services import diagnosis_service
from app.services.seed import seed_database


VALID = [(2, 0.45), (3, 0.40), (0, 0.10), (1, 0.05)]


@pytest.fixture
def diagnosis_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'diagnoses.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "uploads")
    with Session(engine) as db:
        seed_database(db)
        yield db
    engine.dispose()


@pytest.mark.parametrize(
    "predictions",
    [
        [],
        None,
        [(0,)],
        [(999, 0.99)],
        [(0, 0.90), (999, 0.10)],
        [(0, 0.90), (0, 0.10)],
        [("0", 0.90)],
        [(0.0, 0.90)],
        [(True, 0.90)],
        [(0, float("nan"))],
        [(0, float("inf"))],
        [(0, -0.01)],
        [(0, 1.01)],
        [(0, "0.90")],
        [(0, True)],
    ],
    ids=[
        "empty", "none", "malformed-item", "unknown-primary", "unknown-secondary",
        "duplicate", "string-id", "float-id", "bool-id", "nan", "infinity",
        "negative", "above-one", "string-score", "bool-score",
    ],
)
def test_invalid_initial_prediction_leaves_no_diagnosis_or_file(
    diagnosis_db, sample_image, monkeypatch, predictions
):
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda path: predictions)

    with pytest.raises(diagnosis_service.PredictionContractError, match="prediction"):
        diagnosis_service.diagnose_image(diagnosis_db, sample_image, "leaf.jpg", None)

    assert diagnosis_db.query(Diagnosis).count() == 0
    assert list(settings.upload_dir.iterdir()) == []


def test_valid_top_three_does_not_require_normalized_or_nine_class_output(
    diagnosis_db, sample_image, monkeypatch
):
    monkeypatch.setattr(
        diagnosis_service, "predict_all", lambda path: [(0, 0.87), (1, 0.08), (2, 0.03)]
    )

    result = diagnosis_service.diagnose_image(diagnosis_db, sample_image, "leaf.jpg", None)

    assert result.confidence == 0.87
    assert len(result.top_predictions) == 3
    assert diagnosis_db.query(Diagnosis).count() == 1
    assert len(list(settings.upload_dir.iterdir())) == 1


@pytest.mark.parametrize(
    "first,second,pair",
    [
        ([], VALID, None),
        (VALID, [], None),
        ([(2, 0.45), (3, 0.40), (0, 0.10), (999, 0.05)], VALID, None),
        (VALID, [(2, 0.45), (3, 0.40), (0, 0.10), (999, 0.05)], None),
        (VALID, [(2, 0.45), (3, 0.40), (0, 0.15)], None),
        (VALID, [(2, 0.45), (3, 0.40), (0, 0.10), (0, 0.05)], None),
        (VALID, [(2, float("nan")), (3, 0.40), (0, 0.10), (1, 0.05)], None),
        (VALID, VALID, {2: float("nan"), 3: 0.5}),
        (VALID, VALID, {2: -0.2, 3: 1.2}),
        (VALID, VALID, {2: 0.5, 999: 0.5}),
        (VALID, VALID, {"2": 0.5, 3: 0.5}),
        (VALID, VALID, {2: 1.0}),
        (VALID, VALID, {}),
    ],
    ids=[
        "empty-first", "empty-second", "unknown-tail-first", "unknown-tail-second",
        "class-set-mismatch", "duplicate-second", "nan-second", "nan-pair",
        "out-of-range-pair", "unknown-pair", "string-pair-id", "one-class-pair",
        "empty-pair",
    ],
)
def test_invalid_refinement_preserves_diagnosis_and_existing_images(
    diagnosis_db, sample_image, second_image, monkeypatch, first, second, pair
):
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda path: VALID)
    created = diagnosis_service.diagnose_image(diagnosis_db, sample_image, "leaf.jpg", None)
    diagnosis = diagnosis_db.get(Diagnosis, created.id)
    previous_refined_path = settings.upload_dir / "previous-refined.jpg"
    previous_refined_path.write_bytes(second_image)
    diagnosis.original_predictions = None  # Legacy rows re-infer the original image.
    diagnosis.refined_image_path = str(previous_refined_path)
    diagnosis_db.commit()
    before = (
        diagnosis.disease_id, diagnosis.confidence, diagnosis.top_predictions,
        diagnosis.image_path, diagnosis.refined_image_path,
    )
    files_before = set(settings.upload_dir.iterdir())
    monkeypatch.setattr(
        diagnosis_service, "predict_all",
        lambda path: first if path.name == Path(diagnosis.image_path).name else second,
    )
    monkeypatch.setattr(diagnosis_service, "predict_pair", lambda path: pair)

    with pytest.raises(diagnosis_service.PredictionContractError, match="prediction"):
        diagnosis_service.refine_diagnosis(
            diagnosis_db, created.id, second_image, "underside.jpg"
        )

    diagnosis_db.refresh(diagnosis)
    assert (
        diagnosis.disease_id, diagnosis.confidence, diagnosis.top_predictions,
        diagnosis.image_path, diagnosis.refined_image_path,
    ) == before
    assert diagnosis_db.query(Diagnosis).count() == 1
    assert set(settings.upload_dir.iterdir()) == files_before


@pytest.mark.parametrize(
    "pair,expected_confidence",
    [(None, 0.58), ({2: 0.9, 3: 0.1}, 0.792), ({4: 0.9, 5: 0.1}, 0.58)],
    ids=["no-specialist", "matching-specialist", "unrelated-specialist"],
)
def test_valid_refinement_preserves_optional_specialist_behavior(
    diagnosis_db, sample_image, second_image, monkeypatch, pair, expected_confidence
):
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda path: VALID)
    created = diagnosis_service.diagnose_image(diagnosis_db, sample_image, "leaf.jpg", None)
    diagnosis = diagnosis_db.get(Diagnosis, created.id)
    monkeypatch.setattr(
        diagnosis_service, "predict_all",
        lambda path: VALID if path.name == Path(diagnosis.image_path).name
        else [(3, 0.7), (2, 0.2), (0, 0.05), (1, 0.05)],
    )
    monkeypatch.setattr(diagnosis_service, "predict_pair", lambda path: pair)

    result = diagnosis_service.refine_diagnosis(
        diagnosis_db, created.id, second_image, "underside.jpg"
    )

    assert result.confidence == pytest.approx(expected_confidence)
    assert result.id == created.id
    assert result.refined_image_url
    assert diagnosis_db.query(Diagnosis).count() == 1


def test_unknown_initial_prediction_returns_503_without_creating_history(
    client, sample_image, monkeypatch
):
    total_before = client.get("/api/v1/history").json()["total"]
    files_before = set(settings.upload_dir.iterdir())
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda path: [(999, 0.99)])

    result = client.post(
        "/api/v1/diagnose", files={"file": ("leaf.jpg", sample_image, "image/jpeg")}
    )

    assert result.status_code == 503
    assert "disease_name" not in result.json()
    assert client.get("/api/v1/history").json()["total"] == total_before
    assert set(settings.upload_dir.iterdir()) == files_before


def test_unknown_refinement_prediction_returns_503_and_preserves_history(
    client, sample_image, second_image, monkeypatch
):
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda path: VALID)
    created = client.post(
        "/api/v1/diagnose", files={"file": ("leaf.jpg", sample_image, "image/jpeg")}
    ).json()
    history_url = f"/api/v1/history/{created['id']}"
    before = client.get(history_url).json()
    files_before = set(settings.upload_dir.iterdir())
    monkeypatch.setattr(diagnosis_service, "predict_all", lambda path: [(999, 0.99)])

    result = client.post(
        f"/api/v1/diagnose/{created['id']}/refine",
        files={"file": ("underside.jpg", second_image, "image/jpeg")},
    )

    assert result.status_code == 503
    assert client.get(history_url).json() == before
    assert set(settings.upload_dir.iterdir()) == files_before
