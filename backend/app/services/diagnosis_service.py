import math
import logging
from datetime import datetime, timezone
import uuid
from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Disease, Diagnosis
from app.schemas.diagnosis import (
    DiagnoseResponse,
    DiagnosisSummary,
    DiseaseDetail,
    PaginatedHistory,
    PredictionItem,
)
from app.services.ml_service import predict_all, predict_pair, get_prediction_context
from app.services.pesticide_service import pesticide_infos
from app.services.recapture import apply_pair_specialist, check_recapture, fuse_predictions


class PredictionContractError(RuntimeError):
    """Model output cannot safely be mapped to disease records."""


def _prediction_classes(predictions: list[tuple[int, float]]) -> set[int]:
    if not isinstance(predictions, (list, tuple)) or not predictions:
        raise PredictionContractError("Invalid prediction: expected a nonempty distribution")

    class_ids: set[int] = set()
    for item in predictions:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise PredictionContractError("Invalid prediction: expected class/score pairs")
        class_id, confidence = item
        if not isinstance(class_id, int) or isinstance(class_id, bool) or class_id in class_ids:
            raise PredictionContractError("Invalid prediction: class IDs must be unique integers")
        if (
            not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
            or not 0.0 <= confidence <= 1.0
            or not math.isfinite(confidence)
        ):
            raise PredictionContractError("Invalid prediction: scores must be finite and within [0, 1]")
        class_ids.add(class_id)
    return class_ids


def _diseases_for_classes(db: Session, class_ids: set[int]) -> dict[int, Disease]:
    diseases = {
        disease.model_class_id: disease
        for disease in db.query(Disease).filter(Disease.model_class_id.in_(class_ids)).all()
    }
    if class_ids != diseases.keys():
        raise PredictionContractError("Invalid prediction: a model class has no disease mapping")
    return diseases


class PredictionContractError(RuntimeError):
    """Model output cannot safely be mapped to disease records."""


def _prediction_classes(predictions: list[tuple[int, float]]) -> set[int]:
    if not isinstance(predictions, (list, tuple)) or not predictions:
        raise PredictionContractError("Invalid prediction: expected a nonempty distribution")

    class_ids: set[int] = set()
    for item in predictions:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise PredictionContractError("Invalid prediction: expected class/score pairs")
        class_id, confidence = item
        if not isinstance(class_id, int) or isinstance(class_id, bool) or class_id in class_ids:
            raise PredictionContractError("Invalid prediction: class IDs must be unique integers")
        if (
            not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
            or not 0.0 <= confidence <= 1.0
            or not math.isfinite(confidence)
        ):
            raise PredictionContractError("Invalid prediction: scores must be finite and within [0, 1]")
        class_ids.add(class_id)
    return class_ids


def _diseases_for_classes(db: Session, class_ids: set[int]) -> dict[int, Disease]:
    diseases = {
        disease.model_class_id: disease
        for disease in db.query(Disease).filter(Disease.model_class_id.in_(class_ids)).all()
    }
    if class_ids != diseases.keys():
        raise PredictionContractError("Invalid prediction: a model class has no disease mapping")
    return diseases


logger = logging.getLogger(__name__)

class ModelVersionConflict(RuntimeError):
    pass

def _file_key(value: str | None) -> str | None:
    if not value:
        return None
    # Old rows contain Windows absolute/relative paths; use the current storage root.
    key = PurePosixPath(value.replace("\\", "/")).name
    return key if key not in ("", ".", "..") else None



def _file_key(value: str | None) -> str | None:
    if not value:
        return None
    # Old rows contain Windows absolute/relative paths; use the current storage root.
    key = PurePosixPath(value.replace("\\", "/")).name
    return key if key not in ("", ".", "..") else None


def _upload_path(value: str | None) -> Path | None:
    key = _file_key(value)
    if not key:
        return None
    root = settings.upload_dir.resolve()
    candidate = root / key
    return candidate if candidate.resolve().parent == root else None


def _image_url(value: str | None) -> str | None:
    key = _file_key(value)
    return f"/uploads/{key}" if key else None


def _remove_file(path: Path | None) -> None:
    if path is None or path.resolve().parent != settings.upload_dir.resolve():
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.exception("Unable to remove unreferenced upload %s", path.name)


def _response(db: Session, diagnosis: Diagnosis) -> DiagnoseResponse:
    disease = diagnosis.disease
    return DiagnoseResponse(
        id=diagnosis.id, disease_name=disease.name, crop_type=diagnosis.crop_type,
        selected_crop=diagnosis.selected_crop, predicted_crop=disease.crop_type,
        crop_mismatch=bool(diagnosis.selected_crop and diagnosis.selected_crop != disease.crop_type),
        prediction_mode=diagnosis.prediction_mode or "legacy", model_version=diagnosis.model_version,
        preprocessing_version=diagnosis.preprocessing_version, pair_model_version=diagnosis.pair_model_version,
        category=disease.category, severity=disease.severity, confidence=diagnosis.confidence,
        top_predictions=[PredictionItem(**p) for p in (diagnosis.top_predictions or [])],
        description=disease.description, causes=disease.causes or [],
        pesticides=pesticide_infos(db, disease.id), prevention=disease.prevention or [],
        image_url=_image_url(diagnosis.image_path), refined_image_url=_image_url(diagnosis.refined_image_path),
        created_at=diagnosis.created_at, updated_at=diagnosis.updated_at,
        recapture=diagnosis.recapture,
    )


def diagnose_image(db: Session, file_bytes: bytes, filename: str, crop_type: str | None) -> DiagnoseResponse:
    context = get_prediction_context()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    saved_path = settings.upload_dir / f"{uuid.uuid4()}{Path(filename).suffix or '.jpg'}"
    try:
        saved_path.write_bytes(file_bytes)
        predictions = predict_all(saved_path)
        diseases = _diseases_for_classes(db, _prediction_classes(predictions))
        primary = diseases[predictions[0][0]]
        top = [PredictionItem(name=diseases[c].name, confidence=p) for c, p in predictions[:3]]
        guidance = check_recapture(predictions, {c: d.name for c, d in diseases.items()})
        now = datetime.now(timezone.utc)
        diagnosis = Diagnosis(
            disease=primary, confidence=predictions[0][1], top_predictions=[p.model_dump() for p in top],
            image_path=saved_path.name, crop_type=crop_type or primary.crop_type, selected_crop=crop_type,
            original_predictions=[list(p) for p in predictions],
            recapture=guidance.model_dump() if guidance else None, created_at=now, updated_at=now,
            **context,
        )
        db.add(diagnosis)
        db.flush()
        result = _response(db, diagnosis)
        db.commit()
    except Exception:
        db.rollback()
        _remove_file(saved_path)
        raise
    return result


def refine_diagnosis(db: Session, diagnosis_id: str, file_bytes: bytes, filename: str) -> DiagnoseResponse | None:
    diagnosis = db.query(Diagnosis).filter(Diagnosis.id == diagnosis_id).first()
    if not diagnosis:
        return None
    context = get_prediction_context()
    if diagnosis.model_version and any(
        getattr(diagnosis, key) != context[key]
        for key in ("model_version", "preprocessing_version", "prediction_mode")
    ):
        raise ModelVersionConflict("모델이 변경되었습니다. 새 진단을 시작해 주세요.")
    original_path = _upload_path(diagnosis.image_path)
    if original_path is None or not original_path.is_file():
        raise ValueError("원본 진단 이미지를 찾을 수 없어 재확정할 수 없습니다.")
    # Legacy rows have no provenance/distribution: re-evaluate once and record it.
    dist1 = diagnosis.original_predictions or predict_all(original_path)
    class_ids = _prediction_classes(dist1)
    diseases = _diseases_for_classes(db, class_ids)
    old_second = _upload_path(diagnosis.refined_image_path)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    second_path = settings.upload_dir / f"{uuid.uuid4()}{Path(filename).suffix or '.jpg'}"
    try:
        second_path.write_bytes(file_bytes)
        dist2 = predict_all(second_path)
        if _prediction_classes(dist2) != class_ids:
            raise PredictionContractError("Invalid prediction: refinement class sets differ")
        pair = predict_pair(second_path)
        if pair is not None:
            if not isinstance(pair, dict) or len(pair) != 2:
                raise PredictionContractError("Invalid prediction: specialist must return two classes")
            pair_ids = _prediction_classes(list(pair.items()))
            if pair_ids - class_ids:
                _diseases_for_classes(db, pair_ids - class_ids)
        fused = apply_pair_specialist(fuse_predictions(dist1, dist2), pair, dist1)
        _prediction_classes(fused)
        primary = diseases[fused[0][0]]
        diagnosis.disease = primary
        diagnosis.confidence = fused[0][1]
        diagnosis.top_predictions = [dict(name=diseases[c].name, confidence=p) for c, p in fused[:3]]
        diagnosis.crop_type = diagnosis.selected_crop or primary.crop_type
        diagnosis.image_path = original_path.name
        diagnosis.refined_image_path = second_path.name
        diagnosis.original_predictions = [list(p) for p in dist1]
        diagnosis.recapture = None
        diagnosis.updated_at = datetime.now(timezone.utc)
        for key, value in context.items():
            setattr(diagnosis, key, value)
        db.flush()
        result = _response(db, diagnosis)
        db.commit()
    except Exception:
        db.rollback()
        _remove_file(second_path)
        raise
    # Never remove an old image until the new row is committed, nor remove an
    # original image if a damaged legacy row happens to reference it twice.
    if old_second and old_second != original_path and old_second != second_path:
        _remove_file(old_second)
    return result


def get_history(db: Session, page: int, size: int, crop_type: str | None = None) -> PaginatedHistory:
    query = db.query(Diagnosis)
    if crop_type:
        query = query.filter(Diagnosis.crop_type == crop_type)
    total = query.count()
    items = query.order_by(Diagnosis.created_at.desc(), Diagnosis.id.desc()).offset((page - 1) * size).limit(size).all()
    return PaginatedHistory(
        items=[DiagnosisSummary(
            id=d.id, disease_name=d.disease.name, confidence=d.confidence, crop_type=d.crop_type,
            image_url=_image_url(d.image_path), refined_image_url=_image_url(d.refined_image_path),
            prediction_mode=d.prediction_mode or "legacy", created_at=d.created_at,
        ) for d in items], total=total, page=page, size=size,
    )


def get_diagnosis_detail(db: Session, diagnosis_id: str) -> DiagnoseResponse | None:
    diagnosis = db.query(Diagnosis).filter(Diagnosis.id == diagnosis_id).first()
    return _response(db, diagnosis) if diagnosis else None


def list_diseases(db: Session, q: str | None, crop_type: str | None) -> list[DiseaseDetail]:
    query = db.query(Disease)
    if q:
        query = query.filter(Disease.name.contains(q))
    if crop_type:
        query = query.filter(Disease.crop_type == crop_type)

    return [
        DiseaseDetail(
            id=d.id,
            name=d.name,
            name_en=d.name_en,
            crop_type=d.crop_type,
            category=d.category,
            description=d.description,
            causes=d.causes or [],
            prevention=d.prevention or [],
            severity=d.severity,
            pesticides=pesticide_infos(db, d.id),
        )
        for d in query.all()
    ]


def get_disease(db: Session, disease_id: int) -> DiseaseDetail | None:
    disease = db.query(Disease).filter(Disease.id == disease_id).first()
    if not disease:
        return None

    return DiseaseDetail(
        id=disease.id,
        name=disease.name,
        name_en=disease.name_en,
        crop_type=disease.crop_type,
        category=disease.category,
        description=disease.description,
        causes=disease.causes or [],
        prevention=disease.prevention or [],
        severity=disease.severity,
        pesticides=pesticide_infos(db, disease.id),
    )
