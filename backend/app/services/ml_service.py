"""Validated, process-cached CNN inference and explicit development demo mode.

Checkpoint replacement takes effect on process restart. A failed checkpoint is
cached as unavailable, logged, and never silently treated as a production model.
"""

import hashlib
import logging
import re
from functools import lru_cache
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
_MOCK_PREDICTIONS: list[tuple[int, float]] = [(0, 0.87), (1, 0.08), (2, 0.03)]
_model_version: str | None = None
_pair_model_version: str | None = None
_mapping_validated = False
_mapping_error = False
# "판별 불가"(not a crop leaf, unusable photo). A 9-class checkpoint without it
# stays valid so code can ship before the model file is replaced.
OTHER_CLASS_ID = 9
MODEL_CLASS_IDS = frozenset(range(10))
OPTIONAL_CLASS_IDS = frozenset({OTHER_CLASS_ID})


class ModelUnavailableError(RuntimeError):
    """No model satisfying the configured inference contract is available."""


def _model_path() -> Path:
    model_path = settings.ml_model_path
    if not model_path.is_absolute():
        model_path = Path(__file__).resolve().parent.parent.parent / model_path
    return model_path


def _read_checkpoint(path: Path, expected_ids: set[int], optional_ids: frozenset[int] = frozenset()):
    """Load only tensor-safe data, validate metadata/state, and hash loaded bytes.

    The checkpoint must cover expected_ids exactly, or expected_ids minus optional_ids.
    """
    import torch
    from torchvision import models

    with path.open("rb") as checkpoint_file:
        digest = hashlib.file_digest(checkpoint_file, "sha256").hexdigest()
        checkpoint_file.seek(0)
        checkpoint = torch.load(checkpoint_file, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict):
        raise ValueError("Checkpoint must be a mapping")
    arch = checkpoint.get("arch", "resnet18")
    constructors = {"resnet18": models.resnet18, "resnet50": models.resnet50}
    if not isinstance(arch, str) or arch not in constructors:
        raise ValueError(f"Unsupported model architecture: {arch!r}")
    num_classes = checkpoint.get("num_classes")
    classes = checkpoint.get("classes")
    if type(num_classes) is not int or num_classes not in (len(expected_ids), len(expected_ids - optional_ids)):
        raise ValueError("Checkpoint class count does not match the inference contract")
    if not isinstance(classes, (list, tuple)) or len(classes) != num_classes:
        raise ValueError("Checkpoint classes are missing or have the wrong length")
    class_ids = []
    for name in classes:
        if not isinstance(name, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)_.+", name):
            raise ValueError("Checkpoint classes must have explicit numbered names")
        class_ids.append(int(name.split("_", 1)[0]))
    if set(class_ids) not in (expected_ids, expected_ids - optional_ids) or len(set(class_ids)) != num_classes:
        raise ValueError("Checkpoint classes contain duplicates or unknown IDs")
    img_size = checkpoint.get("img_size", 224)
    if type(img_size) is not int or not 1 <= img_size <= 2048:
        raise ValueError("Checkpoint image size must be an integer between 1 and 2048")
    state = checkpoint.get("model_state_dict")
    if not isinstance(state, dict) or not state:
        raise ValueError("Checkpoint model_state_dict is missing")
    for name, tensor in state.items():
        if not isinstance(tensor, torch.Tensor) or not torch.isfinite(tensor).all().item():
            raise ValueError(f"Invalid or nonfinite model tensor: {name}")
    model = constructors[arch](weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, num_classes)
    model.load_state_dict(state, strict=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    model.eval()
    return (model, class_ids, device, img_size), digest


@lru_cache(maxsize=1)
def _load_model():
    """Return the validated (model, class_ids, device, image_size), or None."""
    global _model_version, _mapping_validated, _mapping_error
    _model_version = None
    _mapping_validated = False
    _mapping_error = False
    path = _model_path()
    try:
        loaded, _model_version = _read_checkpoint(path, set(MODEL_CLASS_IDS), OPTIONAL_CLASS_IDS)
        return loaded
    except FileNotFoundError:
        logger.warning("Diagnosis model checkpoint is missing: %s", path)
    except Exception:
        logger.exception("Diagnosis model checkpoint failed validation: %s", path)
    return None


@lru_cache(maxsize=1)
def _load_pair_model():
    """Optional 2/3 confusion-pair classifier; invalid models are disabled/logged."""
    global _pair_model_version
    _pair_model_version = None
    if not settings.enable_pair_model:
        return None
    path = _model_path().parent / "pair_mu.pth"
    try:
        loaded, _pair_model_version = _read_checkpoint(path, {2, 3})
        return loaded
    except FileNotFoundError:
        logger.warning("Optional pair model checkpoint is missing: %s", path)
    except Exception:
        logger.exception("Optional pair model disabled after failed validation: %s", path)
    return None


def validate_model_mapping(expected_class_ids: set[int]) -> bool:
    """Check the seeded DB IDs against the loaded checkpoint before readiness."""
    global _mapping_validated, _mapping_error
    loaded = _load_model()
    _mapping_validated = loaded is not None and set(loaded[1]) in (expected_class_ids, expected_class_ids - OPTIONAL_CLASS_IDS)
    _mapping_error = loaded is not None and not _mapping_validated
    if _mapping_error:
        logger.error("Model classes do not match database model_class_id values")
    return _mapping_validated


def load_model(expected_class_ids: set[int] | None = None) -> None:
    """Warm caches at startup; leave unavailable production instances unready."""
    _load_model()
    _load_pair_model()
    if expected_class_ids is not None:
        validate_model_mapping(expected_class_ids)


def is_model_loaded() -> bool:
    return _load_model() is not None


def is_model_ready() -> bool:
    return is_model_loaded() and _mapping_validated


def _require_prediction_mode() -> str:
    if _mapping_error:
        raise ModelUnavailableError("모델 클래스와 병해 데이터가 일치하지 않습니다.")
    if _load_model() is not None:
        return "model"
    if settings.app_env == "development" and settings.allow_mock_predictions:
        return "mock"
    raise ModelUnavailableError("진단 모델을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.")


def get_prediction_context() -> dict[str, str | None]:
    """Stable provenance for loaded weights, with no per-request file hashing."""
    mode = _require_prediction_mode()
    if mode == "mock":
        return {
            "prediction_mode": "mock",
            "model_version": "mock-v1",
            "preprocessing_version": "resize-224-imagenet-v1",
            "pair_model_version": None,
        }
    loaded = _load_model()
    _load_pair_model()
    return {
        "prediction_mode": "model",
        "model_version": _model_version,
        "preprocessing_version": f"resize-{loaded[3]}-imagenet-v1",
        "pair_model_version": _pair_model_version,
    }


def _transform(img_size: int = 224):
    from torchvision import transforms

    return transforms.Compose([
        transforms.Resize((img_size, img_size)),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])


def _predict_probabilities(image_path: Path, loaded) -> list[tuple[int, float]]:
    import torch
    import torch.nn.functional as F
    from PIL import Image

    model, class_ids, device, img_size = loaded
    with Image.open(image_path) as source:
        image = source.convert("RGB")
    tensor = _transform(img_size)(image).unsqueeze(0).to(device)
    with torch.no_grad():
        probs = F.softmax(model(tensor), dim=1)[0]
    pairs = [(class_ids[i], probs[i].item()) for i in range(len(class_ids))]
    pairs.sort(key=lambda pair: pair[1], reverse=True)
    return pairs


def predict_all(image_path: Path) -> list[tuple[int, float]]:
    """Return every class probability, or explicit development demo values."""
    mode = _require_prediction_mode()
    if mode == "mock":
        return list(_MOCK_PREDICTIONS)
    return _predict_probabilities(image_path, _load_model())


def predict(image_path: Path, top_k: int = 3) -> list[tuple[int, float]]:
    return predict_all(image_path)[:top_k]


def predict_pair(image_path: Path) -> dict[int, float] | None:
    """Return optional pair-model probabilities when explicitly enabled."""
    if _require_prediction_mode() == "mock":
        return None
    loaded = _load_pair_model()
    if loaded is None:
        return None
    return dict(_predict_probabilities(image_path, loaded))
