from sqlalchemy import Column, Float, ForeignKey, Integer, String, Text, DateTime, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class Disease(Base):
    __tablename__ = "diseases"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    name_en = Column(String(200))
    crop_type = Column(String(100), nullable=False)
    category = Column(String(50), default="disease")
    description = Column(Text)
    causes = Column(JSON, default=list)
    prevention = Column(JSON, default=list)
    severity = Column(String(20))  # 판별 불가(category other)는 NULL. seed가 항상 값을 준다
    management_actions = Column(JSON, default=list)
    model_class_id = Column(Integer, unique=True, index=True)

    pesticides = relationship(
        "Pesticide",
        secondary="disease_pesticides",
        back_populates="diseases",
    )
    diagnoses = relationship("Diagnosis", back_populates="disease")


class Pesticide(Base):
    __tablename__ = "pesticides"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    active_ingredient = Column(String(200))
    registration_no = Column(String(50))
    dilution = Column(String(100))
    usage_method = Column(Text)
    phi_days = Column(Integer)
    reentry_hours = Column(Integer)
    safety_notes = Column(Text)

    diseases = relationship(
        "Disease",
        secondary="disease_pesticides",
        back_populates="pesticides",
    )


class DiseasePesticide(Base):
    __tablename__ = "disease_pesticides"

    disease_id = Column(Integer, ForeignKey("diseases.id"), primary_key=True)
    pesticide_id = Column(Integer, ForeignKey("pesticides.id"), primary_key=True)
    priority = Column(Integer, default=1)


class Diagnosis(Base):
    __tablename__ = "diagnoses"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    disease_id = Column(Integer, ForeignKey("diseases.id"), nullable=False)
    confidence = Column(Float, nullable=False)
    top_predictions = Column(JSON, default=list)
    image_path = Column(String(500))
    # 판별부위 2차 촬영으로 재확정한 경우의 사진 경로 (미재확정 시 NULL)
    refined_image_path = Column(String(500))
    crop_type = Column(String(100))
    selected_crop = Column(String(100))
    prediction_mode = Column(String(20), default="legacy", server_default="legacy")
    model_version = Column(String(100))
    preprocessing_version = Column(String(100))
    pair_model_version = Column(String(100))
    original_predictions = Column(JSON)
    recapture = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True))
    revision = Column(Integer, nullable=False, default=1, server_default="1")
    content_snapshot = Column(JSON)
    severity_snapshot = Column(String(20))

    __mapper_args__ = {"version_id_col": revision}

    disease = relationship("Disease", back_populates="diagnoses")


class DiagnosisRequest(Base):
    __tablename__ = "diagnosis_requests"
    key = Column(String(64), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    response = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
