from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import diagnosis, diseases, health, offline
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, ensure_columns
from app.core.uploads import ImageStaticFiles
from app.core.request_limits import RequestBodyLimitMiddleware
from app.core.errors import RequestIdMiddleware, install_error_handlers
from app.models.entities import Disease
from app.services.ml_service import load_model
from app.services.seed import seed_database

settings.upload_dir.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_columns()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
        model_classes = {d.model_class_id for d in db.query(Disease).all()}
    finally:
        db.close()
    load_model(model_classes)
    app.state.diagnosis_limiter = asyncio.Semaphore(settings.max_concurrent_diagnoses)
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI 기반 농작물 병해충 진단 및 스마트 방제 지원 플랫폼",
    lifespan=lifespan,
)

app.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=lambda: settings.max_request_bytes,
                   route_limits={"/api/v1/offline/records": lambda: 2 * settings.max_upload_bytes + 64 * 1024})
app.add_middleware(RequestIdMiddleware)
install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(diagnosis.router, prefix="/api/v1", tags=["diagnosis"])
app.include_router(diseases.router, prefix="/api/v1/diseases", tags=["diseases"])
app.include_router(offline.router, prefix="/api/v1/offline", tags=["offline"])
app.mount("/uploads", ImageStaticFiles(directory=str(settings.upload_dir)), name="uploads")
