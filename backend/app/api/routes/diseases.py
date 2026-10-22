from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.documentation import DATABASE_ERROR, error_response
from app.schemas.diagnosis import CropType, DiseaseDetail
from app.services import diagnosis_service

router = APIRouter(responses={503: DATABASE_ERROR})


@router.get("", response_model=list[DiseaseDetail], summary="병해충·정상 클래스 목록 조회",
            description="검색어와 작물로 참고 정보를 조회합니다. 일치 항목이 없으면 빈 배열입니다. 농약 정보는 검증 상태와 함께 제공합니다.")
def list_diseases(
    q: str | None = Query(None, description="병해 이름 검색어", examples=["탄저"]),
    crop_type: CropType | None = Query(None, description="작물 필터", examples=["고추"]),
    db: Session = Depends(get_db),
):
    return diagnosis_service.list_diseases(db, q, crop_type)


@router.get("/{disease_id}", response_model=DiseaseDetail, summary="병해충·정상 클래스 상세 조회",
            description="병해 목록의 정수 id로 설명·원인·예방·농약 참고 정보를 조회합니다. 모델 클래스 ID와는 다릅니다.",
            responses={404: error_response("병해충 정보를 찾을 수 없습니다.", "NOT_FOUND")})
def get_disease(disease_id: int, db: Session = Depends(get_db)):
    result = diagnosis_service.get_disease(db, disease_id)
    if not result:
        raise HTTPException(status_code=404, detail="병해충 정보를 찾을 수 없습니다.")
    return result
