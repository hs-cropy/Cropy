"""Existing SQLite history must survive additive startup migrations."""

import sqlite3

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core import database


@pytest.fixture
def legacy_database(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE diseases (id INTEGER PRIMARY KEY);
            INSERT INTO diseases (id) VALUES (7);
            CREATE TABLE diagnoses (
                id VARCHAR(36) PRIMARY KEY,
                disease_id INTEGER NOT NULL REFERENCES diseases(id),
                confidence FLOAT NOT NULL,
                image_path VARCHAR(500),
                created_at DATETIME
            );
            """
        )
        connection.execute(
            "INSERT INTO diagnoses VALUES (?, ?, ?, ?, ?)",
            ("old-diagnosis", 7, 0.87, r"C:\old-device\uploads\leaf.jpg", "2026-09-01 01:02:03"),
        )
    test_engine = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(database, "engine", test_engine)
    yield path, test_engine
    test_engine.dispose()


def test_additive_migration_preserves_history_and_marks_unverifiable_legacy_data(legacy_database):
    _, test_engine = legacy_database
    database.ensure_columns()
    with test_engine.connect() as connection:
        row = connection.execute(text("SELECT * FROM diagnoses")).mappings().one()
    assert row["id"] == "old-diagnosis"
    assert row["disease_id"] == 7
    assert row["confidence"] == 0.87
    assert row["image_path"] == r"C:\old-device\uploads\leaf.jpg"
    assert row["created_at"] == "2026-09-01 01:02:03"
    assert row["prediction_mode"] == "legacy"
    assert row["revision"] == 1
    for name in (
        "selected_crop", "model_version", "preprocessing_version", "pair_model_version",
        "original_predictions", "recapture", "updated_at", "refined_image_path",
    ):
        assert row[name] is None


def test_backup_contains_restorable_original_schema_and_data(legacy_database, tmp_path):
    path, _ = legacy_database
    database.ensure_columns()
    backups = list(path.parent.glob(f"{path.name}.backup-*"))
    assert len(backups) == 1
    restored = tmp_path / "restored.db"
    with sqlite3.connect(backups[0]) as snapshot, sqlite3.connect(restored) as target:
        snapshot.backup(target)
    with sqlite3.connect(restored) as connection:
        assert [row[1] for row in connection.execute("PRAGMA table_info(diagnoses)")] == [
            "id", "disease_id", "confidence", "image_path", "created_at",
        ]
        assert connection.execute("SELECT image_path FROM diagnoses").fetchone() == (
            r"C:\old-device\uploads\leaf.jpg",
        )
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_second_startup_does_not_repeat_migration_or_backup(legacy_database):
    path, test_engine = legacy_database
    database.ensure_columns()
    with test_engine.connect() as connection:
        first_columns = connection.exec_driver_sql("PRAGMA table_info(diagnoses)").all()
    first_backups = list(path.parent.glob(f"{path.name}.backup-*"))
    database.ensure_columns()
    with test_engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA table_info(diagnoses)").all() == first_columns
    assert list(path.parent.glob(f"{path.name}.backup-*")) == first_backups


def test_orphan_references_abort_before_migration_or_backup(legacy_database):
    path, test_engine = legacy_database
    with test_engine.begin() as connection:
        connection.execute(text("UPDATE diagnoses SET disease_id = 999"))
    before = {column["name"] for column in inspect(test_engine).get_columns("diagnoses")}
    with pytest.raises(RuntimeError, match="foreign.key"):
        database.ensure_columns()
    assert {column["name"] for column in inspect(test_engine).get_columns("diagnoses")} == before
    assert list(path.parent.glob(f"{path.name}.backup-*")) == []


def test_failed_alter_rolls_back_every_added_column(legacy_database, monkeypatch):
    _, test_engine = legacy_database
    before = {column["name"] for column in inspect(test_engine).get_columns("diagnoses")}
    monkeypatch.setattr(
        database, "_ADDED_COLUMNS", [*database._ADDED_COLUMNS, ("diagnoses", "broken", "INVALID DEFAULT (")]
    )
    with pytest.raises(OperationalError):
        database.ensure_columns()
    assert {column["name"] for column in inspect(test_engine).get_columns("diagnoses")} == before


def test_failed_backup_leaves_schema_unchanged_and_removes_incomplete_snapshot(legacy_database, monkeypatch):
    path, test_engine = legacy_database
    before = {column["name"] for column in inspect(test_engine).get_columns("diagnoses")}
    real_connect = sqlite3.connect
    targets = []

    def readonly_target(file_path):
        target = real_connect(f"file:{file_path}?mode=ro", uri=True)
        targets.append(target)
        return target

    monkeypatch.setattr(database.sqlite3, "connect", readonly_target)
    with pytest.raises(sqlite3.OperationalError, match="readonly"):
        database.ensure_columns()
    assert {column["name"] for column in inspect(test_engine).get_columns("diagnoses")} == before
    assert list(path.parent.glob(f"{path.name}.backup-*")) == []
    for target in targets:
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            target.execute("SELECT 1")


def test_application_sqlite_connection_enforces_foreign_keys():
    with database.engine.connect() as connection:
        connection.exec_driver_sql("CREATE TEMP TABLE migration_test_parent (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TEMP TABLE migration_test_child (parent_id INTEGER REFERENCES migration_test_parent(id))"
        )
        try:
            with pytest.raises(IntegrityError):
                connection.exec_driver_sql("INSERT INTO migration_test_child VALUES (12345)")
        finally:
            connection.exec_driver_sql("DROP TABLE migration_test_child")
            connection.exec_driver_sql("DROP TABLE migration_test_parent")


def test_empty_database_needs_no_backup_before_create_all(tmp_path, monkeypatch):
    path = tmp_path / "new.db"
    test_engine = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(database, "engine", test_engine)
    try:
        database.ensure_columns()
        assert inspect(test_engine).get_table_names() == []
        assert list(tmp_path.glob("*.backup-*")) == []
    finally:
        test_engine.dispose()
