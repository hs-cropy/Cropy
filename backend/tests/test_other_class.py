"""Class 9 "판별 불가": loader transition, decision priority and stored crop."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.models.entities import Disease
from app.services import diagnosis_service as service
from app.services import ml_service
from app.services.decision import decision
from app.services.seed import seed_database


CONTEXT = dict(prediction_mode="model", model_version="model-a", preprocessing_version="resize-256-imagenet-v1", pair_model_version=None)
OTHER = [(9, .9), (2, .06), (3, .04)]


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr(service, "get_prediction_context", lambda: dict(CONTEXT))
    monkeypatch.setattr(service, "predict_all", lambda _: OTHER)
    monkeypatch.setattr(service, "predict_pair", lambda _: None)
    with Session(engine) as session:
        seed_database(session)
        yield session
    engine.dispose()


def test_seed_maps_class_9_to_other_without_pesticides(db):
    other = db.query(Disease).filter(Disease.model_class_id == 9).one()
    assert (other.name, other.category) == ("판별 불가", "other")
    assert other.pesticides == []
    assert {d.model_class_id for d in db.query(Disease).all()} == set(range(10))


@pytest.mark.parametrize("crop,stored", [("고추", "고추"), (None, None)])
def test_other_overrides_mismatch_confusion_and_crop(db, sample_image, crop, stored):
    result = service.diagnose_image(db, sample_image, "leaf.jpg", crop)
    assert (result.decision_status, result.decision_reasons) == ("not_crop", ["not_crop"])
    assert result.crop_mismatch is False and result.recapture is None
    assert result.crop_type == stored and result.category == "other"
    assert result.policy_version.startswith("decision-v3")
    history = service.get_history(db, 1, 10)
    assert history.items[0].crop_type == stored
    assert service.get_diagnosis_detail(db, result.id).decision_status == "not_crop"


def test_other_has_no_severity_and_stays_out_of_severity_filters(db, sample_image):
    result = service.diagnose_image(db, sample_image, "leaf.jpg", None)
    assert result.severity is None
    assert service.get_history(db, 1, 10).items[0].severity is None
    assert service.get_history(db, 1, 10, severity="low").total == 0


def test_crop_results_keep_previous_decisions():
    assert decision(.3, True, {"region": "잎 뒷면"}, "disease", .5)["decision_reasons"] == \
        ["crop_mismatch", "confusion", "low_confidence"]
    assert decision(.3, True, None, "other", .5)["decision_reasons"] == ["not_crop"]
    assert decision(.9, False, None, "normal", .5)["decision_status"] == "normal"


@pytest.fixture
def model_path(tmp_path, monkeypatch):
    monkeypatch.setattr(ml_service.settings, "ml_model_path", tmp_path / "model.pth")
    monkeypatch.setattr(ml_service.settings, "enable_pair_model", False)
    ml_service._load_model.cache_clear()
    yield tmp_path / "model.pth"
    ml_service._load_model.cache_clear()


def save(path, count):
    torch = pytest.importorskip("torch")
    models = pytest.importorskip("torchvision.models")
    model = models.resnet18(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, count)
    torch.save(dict(arch="resnet18", num_classes=count, classes=[f"{i}_c" for i in range(count)],
                    img_size=32, model_state_dict=model.state_dict()), path)


@pytest.mark.parametrize("count,database,ready", [
    (10, set(range(10)), True),
    (9, set(range(10)), True),    # code ships before the 10-class model file
    (9, set(range(9)), True),
    (10, set(range(9)), False),   # class 9 needs its 판별 불가 row
])
def test_loader_accepts_both_model_generations(model_path, count, database, ready):
    save(model_path, count)
    ml_service.load_model(database)
    assert ml_service.is_model_ready() is ready


def test_loader_rejects_other_class_counts(model_path):
    save(model_path, 11)
    assert ml_service.is_model_loaded() is False
