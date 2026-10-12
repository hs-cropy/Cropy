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
    database_url: str = "sqlite:///./cropcare.db"
    upload_dir: Path = Path("./uploads")
    ml_model_path: Path = Path("../ml/checkpoints/best_model.pth")
    cors_origins: str = "http://localhost:3000"
    max_upload_mb: int = Field(default=10, gt=0)
    max_image_pixels: int = Field(default=40_000_000, gt=0)
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
