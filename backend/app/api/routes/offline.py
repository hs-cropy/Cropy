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
from app.core.uploads import write_image
from app.api.documentation import IMAGE_DESCRIPTION, ManifestResponse, OFFLINE_EXAMPLES, UPLOAD_ERRORS, error_response
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
    if version is not None:
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


@router.get("/manifest", summary="현재 브라우저 모델 묶음 조회",
            description="현재 manifest.json을 반환합니다. 모델 URL·해시·전처리·클래스·정책 및 검증 정보를 제공합니다. model_url은 프론트엔드 정적 자산 경로입니다. 묶음이 준비되지 않았으면 503입니다.",
            responses={200: {"model": ManifestResponse},
                       503: error_response("오프라인 모델을 먼저 준비해 주세요.", "OFFLINE_BUNDLE_UNAVAILABLE", True)})
def manifest():
    return load_manifest()


class LocalPrediction(BaseModel):
    class_id: StrictInt = Field(description="클래스 ID 0~8. 분포 내에서 각각 한 번씩 포함")
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, description="확률(0~1). 9개 합계는 1±0.001")


class LocalRecord(BaseModel):
    client_record_id: UUID = Field(description="기기에서 만든 기록 UUID. 중복 동기화 방지 키")
    selected_crop: CropType | None = None
    model_version: str = Field(max_length=100)
    preprocessing_version: str = Field(max_length=100)
    bundle_version: str = Field(min_length=64, max_length=64, pattern="^[0-9a-f]{64}$",
                                description="manifest.version과 일치하는 64자리 소문자 16진수 묶음 해시")
    created_at: datetime = Field(description="시간대 포함 촬영 시각. 2000년 이후, 서버 현재 시각+5분 이하")
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
        write_image(original, content)
        if second:
            write_image(second, refined_content)
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


@router.post("/records", response_model=DiagnoseResponse, summary="기기 진단 기록을 서버에 동기화",
             description="브라우저에서 생성한 예측값과 사진을 저장합니다. 서버 모델 재추론은 수행하지 않으며 prediction_mode=browser입니다. metadata는 JSON 객체를 문자열로 직렬화한 multipart 폼 필드입니다. predictions는 클래스 0~8을 각각 포함한 9개 확률이고 합계는 1±0.001이어야 합니다. created_at은 시간대가 필요하고 2000년 이후·서버 현재 시각+5분 이하여야 합니다. 버전들은 해당 묶음 manifest와 일치해야 합니다. 재촬영 시 refined_predictions와 refined_file을 함께 보내세요. client_record_id로 중복을 판별하며 동일 ID에 다른 내용을 보내면 409입니다. HTTP 200의 save_status도 확인하세요.",
             responses={200: OFFLINE_EXAMPLES, **UPLOAD_ERRORS,
                        400: error_response("EMPTY_IMAGE, UNSUPPORTED_IMAGE_FORMAT, INVALID_IMAGE, 잘못된 multipart(HTTP_ERROR) 또는 재촬영 사진·예측값 누락(MISSING_REFINEMENT_EVIDENCE)", "MISSING_REFINEMENT_EVIDENCE", example_detail="재촬영 사진과 예측값을 함께 보내 주세요."),
                        409: error_response("지원하지 않는 묶음(UNSUPPORTED_BUNDLE), 요청 키 충돌(IDEMPOTENCY_CONFLICT), 기존 기록 충돌(DIAGNOSIS_CHANGED)", "UNSUPPORTED_BUNDLE", example_detail="모델과 전처리 버전이 일치하지 않습니다."),
                        503: error_response("DB(DATABASE_UNAVAILABLE), 사진 저장소(IMAGE_STORAGE_UNAVAILABLE), 복구 저장소(RECOVERY_STORAGE_UNAVAILABLE) 사용 불가", "DATABASE_UNAVAILABLE", True, example_detail="기록 처리에 실패했습니다. 다시 시도해 주세요.")})
async def sync_record(request: Request, metadata: str = Form(..., max_length=20000,
                      description="LocalRecord 스키마의 JSON 문자열. 필수: client_record_id(UUID), model_version(100자 이하), preprocessing_version(100자 이하), bundle_version(64자리 소문자 16진수), created_at(시간대 포함), predictions(9개 class_id/confidence). 선택: selected_crop(고추/무/배추), refined_predictions(동일한 9개 분포). 예시의 버전은 실제 manifest 값으로 교체하세요. 버전 형식 오류는 422, 정상 형식의 미지원 묶음은 409입니다.",
                      json_schema_extra={"contentMediaType": "application/json",
                                         "contentSchema": {"$ref": "#/components/schemas/LocalRecord"},
                                         "examples": [json.dumps({"client_record_id": "4da54046-bae9-4249-a4b3-85d17b83ee40", "selected_crop": "고추",
                                            "model_version": "manifest의 model_version", "preprocessing_version": "manifest의 preprocessing_version",
                                            "bundle_version": "a" * 64, "created_at": "2026-10-15T09:00:00+09:00",
                                            "predictions": [{"class_id": i, "confidence": .6 if i == 0 else .05} for i in range(9)]}, ensure_ascii=False)]}),
                      file: UploadFile = File(..., description=IMAGE_DESCRIPTION),
                      refined_file: UploadFile | None = File(None, description="재촬영 사진. metadata.refined_predictions와 함께 전송")):
    try:
        LocalRecord.model_validate_json(metadata)
    except ValidationError:
        raise APIError(422, "VALIDATION_ERROR", "로컬 기록의 모델·예측값·촬영 시각을 확인해 주세요.")
    async with request.app.state.diagnosis_limiter:
        content, extension = await _read_image_upload(file)
        second, second_extension = await _read_image_upload(refined_file) if refined_file else (None, None)
        return await run_in_threadpool(_with_session, import_record, metadata, content, extension, second, second_extension)
