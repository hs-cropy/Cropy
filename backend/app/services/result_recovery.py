"""Server-only durable drafts and transactionally cached successful responses."""
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from app.core.config import settings
from app.core.errors import APIError
from app.models.entities import Diagnosis, DiagnosisRequest
from app.schemas.diagnosis import DiagnoseResponse


def request_context(operation, key, content, crop=None):
    if key is None:
        return None
    digest = hashlib.sha256((operation + "\0" + key).encode()).hexdigest()
    fingerprint = hashlib.sha256((crop or "").encode() + b"\0" + content).hexdigest()
    return {"key": digest, "fingerprint": fingerprint}


def _root():
    root = settings.upload_dir / ".pending"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise APIError(503, "RECOVERY_STORAGE_UNAVAILABLE",
                       "결과를 보관할 공간을 확보하지 못했습니다. 다시 시도해 주세요.", True) from exc
    return root


def _path(token):
    try:
        token = str(UUID(token))
    except (ValueError, TypeError, AttributeError):
        raise APIError(404, "RESULT_NOT_FOUND", "저장할 결과를 찾을 수 없습니다.")
    return _root() / f"{token}.json"


def _read(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if datetime.fromisoformat(data["expires_at"]) < datetime.now(timezone.utc):
        raise APIError(410, "RESULT_EXPIRED", "결과 보관 시간이 지났습니다. 새 진단을 시작해 주세요.")
    return data


def _cached(db, context):
    entry = db.get(DiagnosisRequest, context["key"])
    if entry:
        if entry.fingerprint != context["fingerprint"]:
            raise APIError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키로 다른 사진이나 작물을 보낼 수 없습니다.")
        return DiagnoseResponse.model_validate(entry.response)


def lookup(db, context):
    if not context:
        return None
    found = _cached(db, context)
    if found:
        return found
    for path in _root().glob("*.json"):
        try:
            data = _read(path)
        except (APIError, FileNotFoundError):
            continue  # Expired drafts are not reused.
        if data.get("request", {}).get("key") == context["key"]:
            if data["request"]["fingerprint"] != context["fingerprint"]:
                raise APIError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키로 다른 사진이나 작물을 보낼 수 없습니다.")
            result = DiagnoseResponse.model_validate(data["response"])
            return result.model_copy(update={"save_status": "failed", "recovery_token": data["token"]})


def _stage(db, context, response):
    if context:
        db.add(DiagnosisRequest(key=context["key"], fingerprint=context["fingerprint"],
                                response=response.model_dump(mode="json")))


def _recovery_context(token):
    return request_context("recovery", token, b"")


def commit_result(db, diagnosis, result, request=None, recover=False, expected_revision=None):
    if diagnosis.content_snapshot:
        diagnosis.content_snapshot = {**diagnosis.content_snapshot, "decision": {
            field: getattr(result, field) for field in ("decision_status", "decision_reasons", "policy_version")}}
    token = str(uuid4())
    path = None
    if recover:
        data = {"token": token, "request": request or {}, "expected_revision": expected_revision,
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=settings.recovery_ttl_hours)).isoformat(),
                "fields": {col.name: getattr(diagnosis, col.name) for col in Diagnosis.__table__.columns if col.name != "revision"},
                "response": result.model_dump(mode="json")}
        data["fields"]["disease_id"] = diagnosis.disease.id
        path = _path(token)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
                temporary = file.name
                json.dump(data, file, ensure_ascii=False, default=lambda v: v.isoformat())
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        except OSError as exc:
            if temporary:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
            raise APIError(503, "RECOVERY_STORAGE_UNAVAILABLE", "결과를 보관할 공간을 확보하지 못했습니다. 다시 시도해 주세요.", True) from exc
    _stage(db, request, result)
    if recover:
        _stage(db, _recovery_context(token), result)
    try:
        db.flush()
        db.commit()
    except StaleDataError:
        db.rollback()
        if path:
            path.unlink(missing_ok=True)
        existing = _cached(db, request) if request else None
        if existing:
            from app.services.diagnosis_service import _remove_file, _upload_path
            if result.refined_image_url not in (existing.image_url, existing.refined_image_url):
                _remove_file(_upload_path(result.refined_image_url))
            return existing
        raise
    except SQLAlchemyError:
        db.rollback()
        if request:
            try:
                existing = _cached(db, request)
            except APIError:
                if path:
                    path.unlink(missing_ok=True)
                raise
            except SQLAlchemyError:
                db.rollback()
                existing = None
            if existing:
                if path:
                    path.unlink(missing_ok=True)
                # A competing worker committed the identical request.
                from app.services.diagnosis_service import _remove_file, _upload_path
                for name in ((result.refined_image_url,) if expected_revision else (result.image_url, result.refined_image_url)):
                    if name and name not in (existing.image_url, existing.refined_image_url):
                        _remove_file(_upload_path(name))
                return existing
        if not recover:
            raise
        return result.model_copy(update={"save_status": "failed", "recovery_token": token})
    except Exception:
        if path:
            path.unlink(missing_ok=True)
        raise
    if path:
        path.unlink(missing_ok=True)
    return result


def save_result(db, token):
    recovery = _recovery_context(token)
    path = _path(token)
    existing = _cached(db, recovery)
    if existing:
        return existing
    if not path.is_file():
        raise APIError(404, "RESULT_NOT_FOUND", "저장할 결과를 찾을 수 없습니다.")
    data = _read(path)
    fields = data["fields"]
    for key in ("created_at", "updated_at"):
        if fields.get(key):
            fields[key] = datetime.fromisoformat(fields[key])
    expected = data["expected_revision"]
    diagnosis = db.get(Diagnosis, fields["id"])
    if expected is not None:
        if diagnosis is None or diagnosis.revision != expected:
            raise APIError(409, "DIAGNOSIS_CHANGED", "기록이 변경되어 이전 결과로 덮어쓸 수 없습니다. 최신 기록을 확인해 주세요.")
        for key, value in fields.items():
            setattr(diagnosis, key, value)
    else:
        if diagnosis is not None:
            raise APIError(409, "DIAGNOSIS_CHANGED", "기록이 이미 존재합니다. 이력에서 확인해 주세요.")
        diagnosis = Diagnosis(**fields)
        db.add(diagnosis)
    result = DiagnoseResponse.model_validate(data["response"])
    _stage(db, data["request"] or None, result)
    _stage(db, recovery, result)
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        existing = _cached(db, recovery)
        if existing:
            return existing
        raise APIError(409, "DIAGNOSIS_CHANGED", "기록이 변경되었습니다. 최신 기록을 확인해 주세요.")
    except IntegrityError:
        db.rollback()
        existing = _cached(db, recovery)
        if existing:
            return existing
        raise
    except SQLAlchemyError:
        db.rollback()
        raise APIError(503, "SAVE_FAILED", "이력에 저장하지 못했습니다. 결과는 보관 중이니 다시 저장해 주세요.", True)
    path.unlink(missing_ok=True)
    # Old refinement files are retained during recovery. The orphan cleanup
    # script removes them only after its existing grace period.
    return result
