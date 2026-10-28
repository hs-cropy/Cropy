from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import diagnosis, diseases, health, offline
from app.api.documentation import COMMON_ERRORS, DESCRIPTION, TAGS
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, ensure_columns
from app.core.uploads import ImageStaticFiles
from app.core.request_limits import RequestBodyLimitMiddleware
from app.core.device import DeviceMiddleware
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
    description=DESCRIPTION,
    openapi_tags=TAGS,
    responses=COMMON_ERRORS,
    swagger_ui_parameters={"displayRequestDuration": True, "filter": True},
    lifespan=lifespan,
)

app.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=lambda: settings.max_request_bytes,
                   route_limits={"/api/v1/offline/records": lambda: 2 * settings.max_upload_bytes + 64 * 1024},
                   idle_timeout=lambda: settings.upload_idle_timeout_seconds,
                   total_timeout=lambda: settings.upload_timeout_seconds)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(DeviceMiddleware)
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

# metadata is JSON text inside multipart, so FastAPI cannot discover its inner
# Pydantic model automatically. Keep that schema tied to the runtime validator.
_default_openapi = app.openapi


def openapi_with_local_record():
    document = _default_openapi()
    schemas = document["components"]["schemas"]
    if "LocalRecord" not in schemas:
        record = offline.LocalRecord.model_json_schema(ref_template="#/components/schemas/{model}")
        schemas.update(record.pop("$defs", {}))
        schemas["LocalRecord"] = record
    return document


app.openapi = openapi_with_local_record
