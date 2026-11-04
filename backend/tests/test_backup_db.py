"""backup_db.py 테스트. 실제 sqlite 파일을 tmp_path에 만들어 검증하므로 프로젝트의
진짜 DB·업로드는 건드리지 않는다."""

import json
import os
import shutil
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


# ---- 사진 복사·참조 확인 ----


def _add_diagnosis(db_path: Path, image_path, refined_image_path=None) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS diagnoses (id TEXT, image_path TEXT, refined_image_path TEXT)")
        conn.execute("INSERT INTO diagnoses VALUES (?, ?, ?)", (str(image_path), image_path, refined_image_path))
        conn.commit()
    finally:
        conn.close()


def _write_draft(pending: Path, name: str, image_path, refined_image_path=None) -> None:
    """앱(result_recovery.commit_result)이 남기는 복구 초안과 같은 모양."""
    pending.mkdir(parents=True, exist_ok=True)
    draft = {"token": name, "expires_at": "2099-01-01T00:00:00+00:00",
             "fields": {"image_path": image_path, "refined_image_path": refined_image_path}}
    (pending / f"{name}.json").write_text(json.dumps(draft), encoding="utf-8")


@pytest.fixture
def live(tmp_path):
    """운영 중인 DB와 업로드 폴더를 흉내 낸다. 진단 기록과 복구 초안(.pending)도 포함한다."""
    db_path = tmp_path / "current" / "cropcare.db"
    db_path.parent.mkdir()
    _make_sqlite_db(db_path, "original")
    # 예전 기록에는 Windows 절대 경로가 들어 있다. 앱처럼 마지막 이름(a.jpg)으로 해석해야 한다.
    _add_diagnosis(db_path, r"C:\old-device\uploads\a.jpg")
    upload_dir = tmp_path / "current" / "uploads"
    upload_dir.mkdir()
    (upload_dir / "a.jpg").write_bytes(b"photo-a")
    (upload_dir / "b.jpg").write_bytes(b"photo-b")
    _write_draft(upload_dir / ".pending", "draft", "b.jpg")
    return db_path, upload_dir, tmp_path / "backups"


def _copy(upload_dir: Path, dest: Path) -> dict:
    return backup_db._copy_uploads(upload_dir, dest)


def test_uploads_and_pending_drafts_are_copied(live, tmp_path):
    _, upload_dir, _ = live
    dest = tmp_path / "out" / "uploads"
    stats = _copy(upload_dir, dest)
    assert (stats["upload_file_count"], stats["copied_files"]) == (3, 3)
    assert (dest / "a.jpg").read_bytes() == b"photo-a"
    assert (dest / ".pending" / "draft.json").exists()
    assert backup_db._count_upload_files(dest) == 3


def test_symlinked_uploads_are_neither_followed_nor_copied(live, tmp_path):
    _, upload_dir, _ = live
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("outside", encoding="utf-8")
    try:
        (upload_dir / "link.jpg").symlink_to(outside / "secret.txt")
        (upload_dir / "linkdir").symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"심볼릭 링크를 만들 수 없는 환경: {exc}")
    dest = tmp_path / "out" / "uploads"
    assert _copy(upload_dir, dest)["upload_file_count"] == 3
    assert not (dest / "link.jpg").exists() and not (dest / "linkdir").exists()
    assert backup_db._first_link(upload_dir) is not None
    assert backup_db._first_link(dest) is None


def test_unreadable_upload_subfolder_fails_instead_of_skipping(live, tmp_path, monkeypatch):
    # 2차 리뷰 2: os.walk가 읽지 못한 폴더를 조용히 건너뛰면 사진이 빠진 "완료" 백업이 생긴다.
    _, upload_dir, _ = live
    real_walk = os.walk

    def walk_with_denied_subfolder(top, *args, **kwargs):
        for entry in real_walk(top, *args, **kwargs):
            yield entry
            if Path(entry[0]) == Path(top) and kwargs.get("onerror"):
                kwargs["onerror"](PermissionError(13, "Permission denied", str(Path(top) / ".pending")))

    monkeypatch.setattr(backup_db.os, "walk", walk_with_denied_subfolder)
    with pytest.raises(PermissionError):
        _copy(upload_dir, tmp_path / "out" / "uploads")


@pytest.mark.skipif(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
                    reason="실제 권한 오류는 비root POSIX에서만 재현된다")
def test_real_permission_error_in_upload_subfolder_fails(live, tmp_path):
    _, upload_dir, _ = live
    locked = upload_dir / "locked"
    locked.mkdir()
    (locked / "c.jpg").write_bytes(b"photo-c")
    locked.chmod(0)
    try:
        with pytest.raises(PermissionError):
            _copy(upload_dir, tmp_path / "out" / "uploads")
    finally:
        locked.chmod(0o755)


@pytest.mark.parametrize("value, expected", [
    (r"C:\old-device\uploads\a.jpg", "a.jpg"),
    ("uploads/b.jpg", "b.jpg"),
    ("c.jpg", "c.jpg"),
    ("..", None), ("", None), (None, None),
])
def test_photo_file_key_uses_the_last_name_like_the_app(value, expected):
    assert backup_db._file_key(value) == expected


def test_referenced_photos_come_from_diagnoses_and_recovery_drafts(live):
    db_path, upload_dir, _ = live
    _write_draft(upload_dir / ".pending", "refine", "a.jpg", r"uploads\c.jpg")
    assert backup_db._referenced_photos(db_path, upload_dir) == {"a.jpg", "b.jpg", "c.jpg"}


def test_unreadable_recovery_draft_is_an_error_not_a_guess(live):
    db_path, upload_dir, _ = live
    (upload_dir / ".pending" / "broken.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(BackupError, match="복구 초안"):
        backup_db._referenced_photos(db_path, upload_dir)


def _copied_backup(live, tmp_path) -> Path:
    """_check_references가 보는 모양(cropcare.db + uploads)의 백업 폴더를 만든다."""
    db_path, upload_dir, _ = live
    out = tmp_path / "out"
    _copy(upload_dir, out / "uploads")
    shutil.copy2(db_path, out / "cropcare.db")
    return out


def test_references_missing_everywhere_are_recorded_not_fatal(live, tmp_path):
    # 예전부터 사진이 없던 기록 때문에 백업이 영원히 실패하면 안 된다.
    db_path, upload_dir, _ = live
    _add_diagnosis(db_path, "gone-long-ago.jpg")
    out = _copied_backup(live, tmp_path)
    result = backup_db._check_references(out, upload_dir)
    assert result == {"missing_referenced_files": 1, "missing_referenced_examples": ["gone-long-ago.jpg"]}


def test_photo_created_after_the_copy_fails_the_check(live, tmp_path):
    # 2차 리뷰 3: 잠금은 사진·초안 생성을 막지 못한다. 초안만 있고 사진은 없는 백업이 완료되면 안 된다.
    _, upload_dir, _ = live
    out = _copied_backup(live, tmp_path)
    (upload_dir / "late.jpg").write_bytes(b"late")
    _write_draft(out / "uploads" / ".pending", "late", "late.jpg")
    with pytest.raises(BackupError, match="서비스를 멈추고"):
        backup_db._check_references(out, upload_dir)
