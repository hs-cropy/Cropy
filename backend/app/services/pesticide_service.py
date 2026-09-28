"""Serialize only conditions whose crop/disease-specific source was verified."""

from datetime import timezone

from sqlalchemy.orm import Session

from app.models.entities import Pesticide
from app.models.pesticide_usage import PesticideUsage
from app.schemas.diagnosis import PesticideInfo, PesticideSafety


def pesticide_infos(db: Session, disease_id: int) -> list[PesticideInfo]:
    rows = (
        db.query(PesticideUsage, Pesticide)
        .join(Pesticide, Pesticide.id == PesticideUsage.pesticide_id)
        .filter(PesticideUsage.disease_id == disease_id)
        .order_by(PesticideUsage.priority, Pesticide.registration_no, PesticideUsage.source_usage_key, PesticideUsage.key)
        .all()
    )
    result = []
    for usage, product in rows:
        verified = usage.verification_status == "verified" and usage.source == "PSIS" and usage.synced_at is not None
        synced_at = usage.synced_at
        if synced_at is not None and synced_at.tzinfo is None:
            synced_at = synced_at.replace(tzinfo=timezone.utc)
        result.append(PesticideInfo(
            name=product.name,
            active_ingredient=product.active_ingredient,
            dilution=usage.dilution if verified else None,
            usage=usage.usage_method if verified else None,
            safety=PesticideSafety(
                phi_days=usage.phi_days if verified else None,
                reentry_hours=usage.reentry_hours if verified else None,
            ),
            safety_notes=usage.safety_notes if verified else "작물·병해별 사용 조건이 확인되지 않았습니다. 제품 표시사항과 PSIS 등록정보를 확인하세요.",
            usage_id=usage.key,
            source=usage.source,
            verification_status="verified" if verified else "legacy_unverified",
            synced_at=synced_at,
        ))
    return result
