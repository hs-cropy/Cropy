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
    low_confidence_threshold: float = Field(default=0.8, ge=0, le=1)
    recovery_ttl_hours: int = Field(default=24, ge=1, le=168)
    offline_bundle_dir: Path = Path("../frontend/public/offline-assets")

    # 음성 안내 (app/services/tts_service.py 참고)
    tts_engine: Literal["off", "mock", "http"] = "off"
    tts_server_url: str = "http://127.0.0.1:8100"
    tts_timeout_seconds: float = Field(default=60, gt=0)
    # 캐시 wav 최대 개수(0이면 제한 없음). 오래 안 쓴 파일부터 지운다
    tts_cache_max_files: int = Field(default=500, ge=0)
    # 캐시 키에 들어간다. 학습한 목소리로 바꾸면 이 값도 바꿔야 옛 음성이 재사용되지 않는다
    tts_voice: str = "melo-kr-pretrained"
    # 고령 사용자 기준으로 기본보다 약간 느리게 읽는다
    tts_speed: float = Field(default=0.9, ge=0.5, le=1.5)
    tts_cache_dir: Path = Path("./tts_cache")

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
