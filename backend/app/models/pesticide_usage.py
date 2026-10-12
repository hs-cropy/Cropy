"""Crop/disease-specific registration conditions, separate from product identity."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

from app.core.database import Base


class PesticideUsage(Base):
    __tablename__ = "pesticide_usages"
    __table_args__ = (
        UniqueConstraint("disease_id", "pesticide_id", "source_usage_key", name="uq_pesticide_usage_source"),
    )

    id = Column(Integer, primary_key=True)
    key = Column(String(250), nullable=False, unique=True)
    disease_id = Column(Integer, ForeignKey("diseases.id"), nullable=False, index=True)
    pesticide_id = Column(Integer, ForeignKey("pesticides.id"), nullable=False, index=True)
    source_usage_key = Column(String(200), nullable=False)
    dilution = Column(String(150))
    usage_method = Column(Text)
    phi_days = Column(Integer)
    reentry_hours = Column(Integer)
    safety_notes = Column(Text)
    priority = Column(Integer, nullable=False, default=1)
    source = Column(String(50), nullable=False)
    verification_status = Column(String(40), nullable=False, default="legacy_unverified")
    synced_at = Column(DateTime(timezone=True))
    source_payload = Column(JSON)
