"""backup_db.py 테스트. 실제 sqlite 파일을 tmp_path에 만들어 검증하므로 프로젝트의
진짜 DB·업로드는 건드리지 않는다."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from scripts import backup_db
from scripts.backup_db import (
    BackupError,
    UnsupportedDatabaseUrlError,
    sqlite_path_from_url,
)


# ---- 경로·manifest 기반 ----


def test_sqlite_path_from_url_relative():
    assert sqlite_path_from_url("sqlite:///./cropcare.db") == Path("./cropcare.db")


def test_sqlite_path_from_url_absolute():
    assert sqlite_path_from_url("sqlite:////data/cropcare.db") == Path("/data/cropcare.db")


def test_sqlite_path_from_url_rejects_non_sqlite():
    with pytest.raises(UnsupportedDatabaseUrlError):
        sqlite_path_from_url("postgresql://user:pass@host/db")


def test_is_within_and_overlaps_compare_whole_path_parts(tmp_path):
    data = tmp_path / "data"
    assert backup_db._is_within(data / "uploads", data)
    assert backup_db._is_within(data, data)
    # 이름 앞부분만 같은 형제 폴더(data-old)는 안쪽이 아니다
    assert not backup_db._is_within(tmp_path / "data-old", data)
    assert backup_db._overlaps(data, data / "uploads") and backup_db._overlaps(data / "uploads", data)
    assert not backup_db._overlaps(data / "uploads", data / "backups")


@pytest.mark.parametrize("value, expected", [
    ("2026-10-15T10:00:00+09:00", "2026-10-15T01:00:00+00:00"),
    ("2026-10-15T01:00:00+00:00", "2026-10-15T01:00:00+00:00"),
    ("2026-10-15T01:00:00", None),  # 시간대가 없으면 순서를 정할 수 없다
    ("not-a-date", None),
    (None, None),
])
def test_created_at_is_read_as_utc_only_with_a_time_zone(value, expected):
    parsed = backup_db._parse_created_at(value)
    assert (parsed.isoformat() if parsed else None) == expected


def test_read_manifest_returns_none_for_missing_broken_or_non_object(tmp_path):
    assert backup_db._read_manifest(tmp_path) is None
    (tmp_path / "manifest.json").write_text("{broken", encoding="utf-8")
    assert backup_db._read_manifest(tmp_path) is None
    (tmp_path / "manifest.json").write_text("[1, 2]", encoding="utf-8")
    assert backup_db._read_manifest(tmp_path) is None
    (tmp_path / "manifest.json").write_text(json.dumps({"kind": "backup"}), encoding="utf-8")
    assert backup_db._read_manifest(tmp_path) == {"kind": "backup"}


def test_symlink_is_detected_as_a_link(tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    assert not backup_db._is_link(target)
    try:
        (tmp_path / "link").symlink_to(target, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"심볼릭 링크를 만들 수 없는 환경: {exc}")
    assert backup_db._is_link(tmp_path / "link")


# ---- SQLite 스냅샷 ----


def _make_sqlite_db(path: Path, value: str) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.execute("CREATE TABLE marker (value TEXT)")
        conn.execute("INSERT INTO marker (value) VALUES (?)", (value,))
        conn.commit()
    finally:
        conn.close()


def _read_marker(path: Path) -> str:
    conn = sqlite3.connect(str(path))
    try:
        return conn.execute("SELECT value FROM marker").fetchone()[0]
    finally:
        conn.close()


def _use_wal(db_path: Path) -> None:
    """앱(PR #104)처럼 DB를 WAL 모드로 바꾼다. 설정은 DB 파일에 영구 저장된다."""
    conn = sqlite3.connect(str(db_path))
    try:
        assert conn.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    finally:
        conn.close()


@pytest.fixture
def source_db(tmp_path):
    db_path = tmp_path / "current" / "cropcare.db"
    db_path.parent.mkdir()
    _make_sqlite_db(db_path, "original")
    return db_path


@pytest.mark.parametrize("journal", ["delete", "wal"])
def test_writes_are_blocked_but_reads_continue_while_the_snapshot_is_taken(source_db, journal):
    # 리뷰 3: 스냅샷 이후 앱이 커밋하고 이전 사진을 지우면 백업 DB가 없는 사진을 가리킨다.
    # WAL에서는 읽기 트랜잭션이 쓰기를 막지 못하므로 두 모드 모두 쓰기 잠금으로 막는다
    if journal == "wal":
        _use_wal(source_db)
    with backup_db._writes_blocked(source_db) as journal_mode:
        app = sqlite3.connect(str(source_db), timeout=0)
        try:
            assert app.execute("SELECT count(*) FROM marker").fetchone()[0] == 1
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                app.execute("INSERT INTO marker (value) VALUES ('during-backup')")
                app.commit()
            app.rollback()
        finally:
            app.close()
    assert journal_mode == journal
    with closing(sqlite3.connect(str(source_db))) as app:  # 잠금은 풀렸다
        app.execute("INSERT INTO marker (value) VALUES ('after-backup')")
        app.commit()


def test_busy_write_lock_fails_with_a_retry_message(source_db, monkeypatch):
    monkeypatch.setattr(backup_db, "LOCK_TIMEOUT_SECONDS", 0)
    app = sqlite3.connect(str(source_db), isolation_level=None)
    app.execute("BEGIN IMMEDIATE")  # 앱이 저장 중인 상태
    try:
        with pytest.raises(BackupError, match="잠금"):
            with backup_db._writes_blocked(source_db):
                pass
    finally:
        app.execute("ROLLBACK")
        app.close()


def test_snapshot_includes_commits_not_yet_checkpointed(source_db, tmp_path):
    # WAL에서는 최근 커밋이 cropcare.db-wal에만 있을 수 있다. DB 파일만 복사하면 빠진다.
    _use_wal(source_db)
    holder = sqlite3.connect(str(source_db))
    holder.execute("PRAGMA wal_autocheckpoint=0")
    holder.execute("INSERT INTO marker (value) VALUES ('only-in-wal')")
    holder.commit()
    target = tmp_path / "snapshot.db"
    try:
        assert source_db.with_name(source_db.name + "-wal").stat().st_size > 0
        backup_db._snapshot_db(source_db, target)
    finally:
        holder.close()
    with closing(sqlite3.connect(str(target))) as snapshot:
        assert "only-in-wal" in [row[0] for row in snapshot.execute("SELECT value FROM marker")]


def test_wal_snapshot_is_a_single_rollback_journal_file(source_db, tmp_path):
    # 백업 API는 WAL 설정까지 복사한다. 그대로 두면 읽기 전용 검사가 -wal·-shm을 남긴다.
    _use_wal(source_db)
    target = tmp_path / "out" / "cropcare.db"
    target.parent.mkdir()
    backup_db._snapshot_db(source_db, target)
    backup_db._check_integrity(target)
    assert not list(target.parent.glob("cropcare.db-*"))
    with closing(sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"


def test_corrupt_source_db_cannot_be_locked_or_snapshotted(source_db):
    source_db.write_bytes(b"not a database")
    with pytest.raises(sqlite3.DatabaseError):
        with backup_db._writes_blocked(source_db):
            pass


def test_integrity_check_rejects_damaged_files_and_foreign_key_violations(source_db, tmp_path):
    backup_db._check_integrity(source_db)
    garbage = tmp_path / "garbage.db"
    garbage.write_bytes(b"garbage")
    with pytest.raises(BackupError, match="SQLite"):
        backup_db._check_integrity(garbage)
    with closing(sqlite3.connect(str(source_db))) as conn:
        conn.executescript("""
            CREATE TABLE diseases (id INTEGER PRIMARY KEY);
            CREATE TABLE findings (disease_id INTEGER REFERENCES diseases(id));
            INSERT INTO findings VALUES (999);
        """)
    with pytest.raises(BackupError, match="외래 키"):
        backup_db._check_integrity(source_db)
