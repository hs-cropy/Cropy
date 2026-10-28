from contextlib import closing
from datetime import datetime, timezone
import logging
from pathlib import Path
import sqlite3
from uuid import uuid4

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)
_is_sqlite = make_url(settings.database_url).get_backend_name() == "sqlite"
engine = create_engine(settings.database_url, connect_args={"check_same_thread": False} if _is_sqlite else {})


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# create_all()은 이미 존재하는 테이블에 칼럼을 추가하지 못한다. 마이그레이션 도구를
# 도입하기 전까지, 나중에 생긴 칼럼만 누락 시 덧붙여 기존 DB(진단 이력)를 보존한다.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("diseases", "management_actions", "JSON"),
    ("diseases", "summary_message", "TEXT"),
    ("diseases", "management_action_details", "JSON"),
    ("diagnoses", "content_snapshot", "JSON"),
    ("diagnoses", "severity_snapshot", "VARCHAR(20)"),
    ("diagnoses", "refined_image_path", "VARCHAR(500)"),
    ("diagnoses", "selected_crop", "VARCHAR(100)"),
    ("diagnoses", "prediction_mode", "VARCHAR(20) DEFAULT 'legacy'"),
    ("diagnoses", "model_version", "VARCHAR(100)"),
    ("diagnoses", "preprocessing_version", "VARCHAR(100)"),
    ("diagnoses", "pair_model_version", "VARCHAR(100)"),
    ("diagnoses", "original_predictions", "JSON"),
    ("diagnoses", "recapture", "JSON"),
    ("diagnoses", "updated_at", "TIMESTAMP"),
    ("diagnoses", "revision", "INTEGER NOT NULL DEFAULT 1"),
    ("diagnoses", "device_id", "VARCHAR(64)"),
]


def _missing_columns(connection: Connection) -> list[tuple[str, str, str]]:
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    columns = {table: {c["name"] for c in inspector.get_columns(table)} for table in tables}
    return [entry for entry in _ADDED_COLUMNS if entry[0] in tables and entry[1] not in columns[entry[0]]]


def _check_sqlite_foreign_keys(connection: Connection) -> None:
    violation = connection.exec_driver_sql("PRAGMA foreign_key_check").first()
    if violation is not None:
        raise RuntimeError(
            f"SQLite foreign-key violation in {violation[0]}; refusing schema migration. "
            "Repair or restore the existing database before restarting."
        )


def _backup_sqlite_database(connection: Connection) -> None:
    database_path = next(
        (row[2] for row in connection.exec_driver_sql("PRAGMA database_list") if row[1] == "main"), ""
    )
    if not database_path:
        return  # In-memory databases have no existing file to protect.
    source_path = Path(database_path).resolve()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = source_path.with_name(f"{source_path.name}.backup-{stamp}-{uuid4().hex}")
    # Exclusive creation avoids replacing any previous backup, even on a name collision.
    with backup_path.open("xb"):
        pass
    try:
        with closing(sqlite3.connect(backup_path)) as target:
            connection.connection.driver_connection.backup(target)
    except BaseException:
        backup_path.unlink(missing_ok=True)
        raise
    logger.info("SQLite backup created before migration: %s", backup_path)


def ensure_columns() -> None:
    """Preserve legacy rows with backed-up, atomic additive schema changes."""
    _add_missing_columns()
    # index=True only applies to new tables; existing DBs got device_id via ALTER.
    # A new database has no table yet; create_all() then builds the index itself.
    with engine.begin() as connection:
        if inspect(connection).has_table("diagnoses"):
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_diagnoses_device_id ON diagnoses (device_id)"))


def _add_missing_columns() -> None:
    with engine.connect() as connection:
        sqlite = connection.dialect.name == "sqlite"
        if sqlite:
            _check_sqlite_foreign_keys(connection)
        if not _missing_columns(connection):
            return
        if sqlite:
            # backup() must run before opening a write transaction on its source.
            _backup_sqlite_database(connection)
        connection.commit()
        try:
            if sqlite:
                # sqlite3's default DDL handling otherwise autocommits each ALTER.
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                _check_sqlite_foreign_keys(connection)
            # Reinspect under the write lock in case another startup already migrated.
            for table, column, ddl_type in _missing_columns(connection):
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
            connection.commit()
        except BaseException:
            connection.rollback()
            raise


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
