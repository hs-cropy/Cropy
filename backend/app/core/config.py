from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "CropCare AI"
    app_version: str = "1.0.0"
    app_env: Literal["development", "production"] = "development"
    allow_mock_predictions: bool = True
    enable_pair_model: bool = False
    max_concurrent_diagnoses: int = Field(default=1, ge=1, le=4)
    # 진단 자리를 기다리는 최대 시간(초). Next.js 프록시 제한(약 30초)보다 짧게 둔다
    diagnosis_queue_timeout_seconds: float = Field(default=20, gt=0, le=300)
    database_url: str = "sqlite:///./cropcare.db"
    upload_dir: Path = Path("./uploads")
    ml_model_path: Path = Path("../ml/checkpoints/best_model.pth")
    cors_origins: str = "http://localhost:3000"
    max_upload_mb: int = Field(default=100, gt=0)
    max_image_pixels: int = Field(default=210_000_000, gt=0)
    # 요청 본문 수신: 데이터가 끊긴 채 기다리는 시간 / 전체 수신 상한 (초)
    # Next.js rewrite 프록시가 약 30초 무응답이면 끊으므로 그보다 짧게 두어 408이 먼저 도착하게 한다
    upload_idle_timeout_seconds: float = Field(default=20, gt=0, le=600)
    upload_timeout_seconds: float = Field(default=300, gt=0, le=3600)
    low_confidence_threshold: float = Field(default=0.5, ge=0, le=1)
    recovery_ttl_hours: int = Field(default=24, ge=1, le=168)
    offline_bundle_dir: Path = Path("../frontend/public/offline-assets")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def max_request_bytes(self) -> int:
        return self.max_upload_bytes + 64 * 1024


settings = Settings()
