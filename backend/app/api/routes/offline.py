"""Model bundle metadata and explicitly client-generated diagnosis imports."""
import hashlib
import json
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel, Field, StrictInt, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.errors import APIError
from app.models.entities import Diagnosis
from app.schemas.diagnosis import CropType, DiagnoseResponse, RecaptureGuidance
from app.services import diagnosis_service as service
from app.services.recapture import fuse_predictions
from app.services.decision import decision
from app.services.result_recovery import lookup, request_context, commit_result
from app.api.routes.diagnosis import _read_image_upload, _with_session

router = APIRouter()


def load_manifest(version=None):
    path = settings.offline_bundle_dir / "manifest.json"
    if version:
        if len(version) != 64 or any(c not in "0123456789abcdef" for c in version):
            raise APIError(409, "UNSUPPORTED_BUNDLE", "지원하는 오프라인 모델 버전을 확인할 수 없습니다.")
        path = settings.offline_bundle_dir / f"manifest-{version[:16]}.json"
    if not path.is_file():
        raise APIError(503 if not version else 409, "OFFLINE_BUNDLE_UNAVAILABLE" if not version else "UNSUPPORTED_BUNDLE",
                       "오프라인 모델을 먼저 준비해 주세요.", not version)
    data = json.loads(path.read_text(encoding="utf-8"))
    if version and data["version"] != version:
        raise APIError(409, "UNSUPPORTED_BUNDLE", "오프라인 모델 버전이 일치하지 않습니다.")
    return data


@router.get("/manifest")
def manifest():
    return load_manifest()


class LocalPrediction(BaseModel):
    class_id: StrictInt
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)


class LocalRecord(BaseModel):
    client_record_id: UUID
    selected_crop: CropType | None = None
    model_version: str = Field(max_length=100)
    preprocessing_version: str = Field(max_length=100)
    bundle_version: str = Field(max_length=64)
    created_at: datetime
    predictions: list[LocalPrediction] = Field(min_length=9, max_length=9)
    refined_predictions: list[LocalPrediction] | None = Field(default=None, min_length=9, max_length=9)

    @model_validator(mode="after")
    def valid_distributions(self):
        for dist in (self.predictions, self.refined_predictions):
            if dist and ({p.class_id for p in dist} != set(range(9)) or abs(sum(p.confidence for p in dist) - 1) > .001):
                raise ValueError("invalid complete distribution")
        if self.created_at.tzinfo is None or self.created_at < datetime(2000, 1, 1, tzinfo=timezone.utc) or self.created_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("invalid capture timestamp")
        return self


def import_record(db, metadata, content, extension, refined_content, refined_extension):
    m = LocalRecord.model_validate_json(metadata)
    canonical = m.model_dump_json()
    payload = content + b"\0" + (refined_content or b"") + b"\0" + canonical.encode()
    context = request_context("browser-sync", str(m.client_record_id), payload)
    existing = lookup(db, context)
    if existing:
        return existing
    bundle = load_manifest(m.bundle_version)
    if m.model_version != bundle["model_version"] or m.preprocessing_version != bundle["preprocessing_version"]:
        raise APIError(409, "UNSUPPORTED_BUNDLE", "모델과 전처리 버전이 일치하지 않습니다.")
    if bool(refined_content) != bool(m.refined_predictions):
        raise APIError(400, "MISSING_REFINEMENT_EVIDENCE", "재촬영 사진과 예측값을 함께 보내 주세요.")
    dist1 = sorted([(p.class_id, p.confidence) for p in m.predictions], key=lambda p: p[1], reverse=True)
    dist = dist1
    policy = bundle.get("policy", {})
    if m.refined_predictions:
        dist = fuse_predictions(dist1, [(p.class_id, p.confidence) for p in m.refined_predictions], policy.get("second_photo_weight", .6))
    diseases = service._diseases_for_classes(db, set(range(9)))
    primary = diseases[dist[0][0]]
    source = next(d for d in bundle["diseases"] if d["model_class_id"] == dist[0][0])
    snapshot = dict(disease_name=source["name"], predicted_crop=source["crop_type"], category=source["category"],
                    severity=source["severity"], description=source.get("description"), causes=source.get("causes", []),
                    prevention=source.get("prevention", []), management_actions=source.get("management_actions", []),
                    pesticides=source.get("pesticides", []), version=bundle["version"])
    id = str(m.client_record_id)
    if db.get(Diagnosis, id):
        raise APIError(409, "DIAGNOSIS_CHANGED", "동기화된 기록이 이미 존재합니다. 새 진단으로 저장해 주세요.")
    original = settings.upload_dir / f"{uuid4()}{extension}"
    second = settings.upload_dir / f"{uuid4()}{refined_extension}" if refined_content else None
    names = {d["model_class_id"]: d["name"] for d in bundle["diseases"]}
    guidance = None
    pair = next((pair for pair in policy.get("pairs", []) if set(pair["ids"]) == {i for i, _ in dist[:2]}), None)
    margin = dist[0][1] - dist[1][1]
    if pair and margin < policy.get("confusion_margin", .2):
        guidance = RecaptureGuidance(region=pair["region"], instruction=pair["instruction"], margin=round(margin, 4),
            candidates=[dict(name=names[i], cue=pair["cues"][str(i)]) for i in pair["ids"]])
    snapshot["decision"] = decision(dist[0][1], bool(m.selected_crop and m.selected_crop != source["crop_type"]),
                                    guidance, source["category"], policy.get("low_confidence_threshold", .5))
    try:
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        original.write_bytes(content)
        if second:
            second.write_bytes(refined_content)
        record = Diagnosis(id=id, disease=primary, confidence=dist[0][1],
            top_predictions=[dict(name=names[i], confidence=p) for i, p in dist[:3]],
            original_predictions=[list(p) for p in dist1], image_path=original.name,
            refined_image_path=second.name if second else None, selected_crop=m.selected_crop,
            crop_type=m.selected_crop or source["crop_type"], prediction_mode="browser",
            model_version=m.model_version, preprocessing_version=m.preprocessing_version,
            recapture=guidance.model_dump() if guidance else None, content_snapshot=snapshot,
            severity_snapshot=source["severity"], created_at=m.created_at, updated_at=datetime.now(timezone.utc))
        db.add(record)
        with db.no_autoflush:
            result = service._response(db, record)
        return commit_result(db, record, result, context, True)
    except Exception:
        db.rollback()
        service._remove_file(original)
        service._remove_file(second)
        raise


@router.post("/records", response_model=DiagnoseResponse)
async def sync_record(request: Request, metadata: str = Form(..., max_length=20000),
                      file: UploadFile = File(...), refined_file: UploadFile | None = File(None)):
    try:
        LocalRecord.model_validate_json(metadata)
    except ValidationError:
        raise APIError(422, "VALIDATION_ERROR", "로컬 기록의 모델·예측값·촬영 시각을 확인해 주세요.")
    async with request.app.state.diagnosis_limiter:
        content, extension = await _read_image_upload(file)
        second, second_extension = await _read_image_upload(refined_file) if refined_file else (None, None)
        return await run_in_threadpool(_with_session, import_record, metadata, content, extension, second, second_extension)
