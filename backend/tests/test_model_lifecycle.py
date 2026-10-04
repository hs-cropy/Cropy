"""Model startup contracts, explicit demo mode, and readiness checks."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import health
from app.services import ml_service


@pytest.fixture
def model_settings(tmp_path, monkeypatch):
    """Avoid the developer's checkpoint and isolate process-wide model caches."""
    monkeypatch.setattr(ml_service.settings, "ml_model_path", tmp_path / "model.pth")
    monkeypatch.setattr(ml_service.settings, "app_env", "development")
    monkeypatch.setattr(ml_service.settings, "allow_mock_predictions", True)
    monkeypatch.setattr(ml_service.settings, "enable_pair_model", False)
    ml_service._load_model.cache_clear()
    ml_service._load_pair_model.cache_clear()
    yield ml_service.settings
    ml_service._load_model.cache_clear()
    ml_service._load_pair_model.cache_clear()


@pytest.fixture(scope="module")
def checkpoint():
    # A real, untrained ResNet state exercises strict architecture/state loading.
    torch = pytest.importorskip("torch")
    models = pytest.importorskip("torchvision.models")
    model = models.resnet18(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, 9)
    return {
        "arch": "resnet18",
        "num_classes": 9,
        "classes": [f"{i}_class" for i in range(9)],
        "img_size": 32,
        "model_state_dict": model.state_dict(),
    }


def save_checkpoint(settings, checkpoint):
    import torch

    torch.save(checkpoint, settings.ml_model_path)


@pytest.mark.parametrize("app_env,allow_mock", [("production", True), ("production", False), ("development", False)])
def test_missing_model_rejects_predictions_unless_demo_enabled(model_settings, app_env, allow_mock):
    model_settings.app_env = app_env
    model_settings.allow_mock_predictions = allow_mock
    with pytest.raises(Exception, match="모델|model"):
        ml_service.predict_all(Path("unused.jpg"))


def test_explicit_development_mock_has_provenance_but_is_not_ready(model_settings):
    ml_service.load_model(set(range(9)))
    assert ml_service.predict_all(Path("unused.jpg"))
    assert ml_service.get_prediction_context() == {
        "prediction_mode": "mock",
        "model_version": "mock-v1",
        "preprocessing_version": "resize-224-imagenet-v1",
        "pair_model_version": None,
    }
    assert ml_service.is_model_ready() is False


def test_corrupt_model_logs_failure_and_refuses_production_prediction(model_settings, caplog):
    model_settings.app_env = "production"
    model_settings.ml_model_path.write_bytes(b"not a checkpoint")
    ml_service.load_model(set(range(9)))
    assert ml_service.is_model_ready() is False
    assert "model.pth" in caplog.text
    with pytest.raises(ml_service.ModelUnavailableError):
        ml_service.predict_all(Path("unused.jpg"))


def test_valid_checkpoint_requires_mapping_and_keeps_loaded_metadata(model_settings, checkpoint):
    import hashlib

    save_checkpoint(model_settings, checkpoint)
    expected_hash = hashlib.sha256(model_settings.ml_model_path.read_bytes()).hexdigest()
    ml_service.load_model()
    assert ml_service.is_model_loaded() is True
    assert ml_service.is_model_ready() is False
    assert ml_service.validate_model_mapping(set(range(9))) is True
    assert ml_service.is_model_ready() is True
    expected = {
        "prediction_mode": "model",
        "model_version": expected_hash,
        "preprocessing_version": "resize-32-imagenet-v1",
        "pair_model_version": None,
    }
    assert ml_service.get_prediction_context() == expected
    # Model provenance describes loaded weights, not a newly replaced path.
    model_settings.ml_model_path.write_bytes(b"replacement awaits restart")
    assert ml_service.get_prediction_context() == expected


def test_database_mapping_mismatch_blocks_prediction_and_readiness(model_settings, checkpoint):
    save_checkpoint(model_settings, checkpoint)
    ml_service.load_model({0, 1})
    assert ml_service.is_model_ready() is False
    with pytest.raises(ml_service.ModelUnavailableError):
        ml_service.predict_all(Path("unused.jpg"))


@pytest.mark.parametrize("changes", [
    {"arch": "alexnet"},
    {"num_classes": 8},
    {"num_classes": True},
    {"classes": [f"{i}_class" for i in range(8)] + ["7_duplicate"]},
    {"classes": [f"{i}_class" for i in range(8)] + ["999_unknown"]},
    {"classes": ["unmapped"] * 9},
    {"img_size": 0},
    {"img_size": 4096},
    {"img_size": 224.5},
    {"model_state_dict": {}},
])
def test_invalid_checkpoint_is_unavailable(model_settings, checkpoint, changes):
    save_checkpoint(model_settings, {**checkpoint, **changes})
    assert ml_service.is_model_loaded() is False


def test_nonfinite_weights_are_rejected(model_settings, checkpoint):
    import torch

    state = dict(checkpoint["model_state_dict"])
    state["fc.bias"] = torch.full_like(state["fc.bias"], float("nan"))
    save_checkpoint(model_settings, {**checkpoint, "model_state_dict": state})
    assert ml_service.is_model_loaded() is False


class UnsafeCheckpointValue:
    pass


def test_checkpoint_custom_pickle_objects_are_not_deserialized(model_settings, checkpoint):
    save_checkpoint(model_settings, {**checkpoint, "custom": UnsafeCheckpointValue()})
    assert ml_service.is_model_loaded() is False


def test_pair_model_requires_explicit_enablement(model_settings, checkpoint):
    import torch

    pair_path = model_settings.ml_model_path.parent / "pair_mu.pth"
    state = dict(checkpoint["model_state_dict"])
    state["fc.weight"] = state["fc.weight"][:2]
    state["fc.bias"] = state["fc.bias"][:2]
    torch.save({**checkpoint, "num_classes": 2, "classes": ["2_black", "3_downy"], "model_state_dict": state}, pair_path)
    assert ml_service._load_pair_model() is None
    save_checkpoint(model_settings, checkpoint)
    ml_service.load_model(set(range(9)))
    assert ml_service.is_model_ready() is True
    assert ml_service.get_prediction_context()["pair_model_version"] is None


def test_opted_in_pair_loads_provenance_and_disabled_invalid_pair_is_logged(model_settings, checkpoint, caplog):
    import hashlib
    import torch

    save_checkpoint(model_settings, checkpoint)
    model_settings.enable_pair_model = True
    state = dict(checkpoint["model_state_dict"])
    state["fc.weight"] = state["fc.weight"][:2]
    state["fc.bias"] = state["fc.bias"][:2]
    pair_path = model_settings.ml_model_path.parent / "pair_mu.pth"
    torch.save({**checkpoint, "num_classes": 2, "classes": ["2_black", "3_downy"], "model_state_dict": state}, pair_path)
    ml_service.load_model(set(range(9)))
    assert ml_service.get_prediction_context()["pair_model_version"] == hashlib.sha256(pair_path.read_bytes()).hexdigest()
    pair_path.write_bytes(b"corrupt pair")
    ml_service._load_pair_model.cache_clear()
    ml_service.load_model(set(range(9)))
    assert ml_service.is_model_ready() is True
    assert ml_service.get_prediction_context()["pair_model_version"] is None
    assert "pair_mu.pth" in caplog.text


def test_health_stays_live_while_ready_rejects_mock(model_settings):
    ml_service.load_model(set(range(9)))
    app = FastAPI()
    app.include_router(health.router, prefix="/api/v1")
    with TestClient(app) as client:
        assert client.get("/api/v1/health").status_code == 200
        ready = client.get("/api/v1/ready")
    assert ready.status_code == 503
    assert ready.json()["prediction_mode"] == "mock"


def test_ready_requires_loaded_model_and_valid_database_mapping(model_settings, checkpoint):
    save_checkpoint(model_settings, checkpoint)
    ml_service.load_model(set(range(9)))
    app = FastAPI()
    app.include_router(health.router, prefix="/api/v1")
    with TestClient(app) as client:
        ready = client.get("/api/v1/ready")
    assert ready.status_code == 200
    assert ready.json()["prediction_mode"] == "model"
