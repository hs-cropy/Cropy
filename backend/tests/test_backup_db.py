"""backup_db.py 테스트. 실제 sqlite 파일을 tmp_path에 만들어 검증하므로 프로젝트의
진짜 DB·업로드는 건드리지 않는다."""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing
from pathlib import Path

import pytest

from scripts import backup_db
from scripts.backup_db import (
    LOCK_FILE_NAME,
    BackupError,
    UnsupportedDatabaseUrlError,
    backup,
    find_latest_backup,
    prune_backups,
    restore,
    run_backup,
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
    return backup_db._copy_uploads(upload_dir, dest, None)  # 기준 백업 없이 전체 복사


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


# ---- 작업 잠금·디스크 동기화 ----


def test_a_held_lock_fails_the_next_job_immediately(tmp_path):
    lock = tmp_path / "backups" / LOCK_FILE_NAME
    with backup_db._lock_file(lock):
        with pytest.raises(BackupError, match="실행 중"):
            with backup_db._lock_file(lock):
                pass
    with backup_db._lock_file(lock):  # 작업이 끝나면 풀린다
        pass


def test_a_lock_held_by_a_killed_process_is_released(tmp_path):
    # OS 잠금이라 작업이 강제 종료돼도 남은 잠금 파일 때문에 다음 작업이 막히지 않는다
    lock = tmp_path / "backups" / LOCK_FILE_NAME
    holder = subprocess.Popen(
        [sys.executable, "-c",
         "import sys, time\n"
         "from pathlib import Path\n"
         "from scripts import backup_db\n"
         "with backup_db._lock_file(Path(sys.argv[1])):\n"
         "    print('locked', flush=True)\n"
         "    time.sleep(60)\n",
         str(lock)],
        cwd=Path(backup_db.__file__).resolve().parent.parent, stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "locked"
        with pytest.raises(BackupError, match="실행 중"):
            with backup_db._lock_file(lock):
                pass
    finally:
        holder.kill()
        holder.wait(10)
        holder.stdout.close()
    # Windows는 강제 종료된 프로세스의 잠금을 종료 직후가 아니라 조금 뒤에 풀 수 있다
    deadline = time.monotonic() + 10
    while True:
        try:
            with backup_db._lock_file(lock):
                break
        except BackupError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.05)


def test_a_failed_lock_releases_the_locks_already_taken(tmp_path):
    # 잠금 세 개 중 뒤의 것을 못 잡으면 앞서 잡은 백업 폴더·DB 잠금도 풀려야 다음 작업이 돈다
    root, db_path, upload_dir = tmp_path / "backups", tmp_path / "data" / "cropcare.db", tmp_path / "data" / "uploads"
    upload_lock = upload_dir.parent / f".{upload_dir.name}{LOCK_FILE_NAME}"
    with backup_db._lock_file(upload_lock):
        with pytest.raises(BackupError, match="실행 중"):
            with backup_db._exclusive(root, db_path, upload_dir):
                pass
        with backup_db._lock_file(root / LOCK_FILE_NAME), \
                backup_db._lock_file(db_path.parent / f".{db_path.name}{LOCK_FILE_NAME}"):
            pass
    with backup_db._exclusive(root, db_path, upload_dir):
        pass
    # 업로드 폴더는 복원 때 통째로 바뀌므로 잠금 파일은 폴더 안이 아니라 옆에 있다
    assert not upload_dir.exists() and upload_lock.exists()


def test_manifest_is_published_atomically_after_the_files_are_synced(tmp_path, monkeypatch):
    out = tmp_path / "b1"
    (out / "uploads" / "nested").mkdir(parents=True)
    (out / "cropcare.db").write_bytes(b"db")
    (out / "uploads" / "nested" / "a.jpg").write_bytes(b"a")
    synced = []
    real_fsync = backup_db._fsync
    monkeypatch.setattr(backup_db, "_fsync", lambda path: (synced.append(Path(path)), real_fsync(path))[1])

    backup_db._sync_tree(out)
    assert {out / "cropcare.db", out / "uploads" / "nested" / "a.jpg"} <= set(synced)
    backup_db._write_manifest(out, {"kind": "backup"})

    assert json.loads((out / "manifest.json").read_text(encoding="utf-8")) == {"kind": "backup"}
    assert not list(out.glob(".manifest-*.tmp"))


def test_failed_manifest_publish_leaves_no_partial_manifest(tmp_path, monkeypatch):
    out = tmp_path / "b1"
    out.mkdir()

    def disk_full(*args, **kwargs):
        raise OSError("No space left on device")

    monkeypatch.setattr(backup_db.os, "replace", disk_full)
    with pytest.raises(OSError):
        backup_db._write_manifest(out, {"kind": "backup"})
    assert list(out.iterdir()) == []


# ---- backup ----


def _entries(root: Path) -> list[str]:
    """백업 폴더의 항목 이름. 작업 잠금 파일은 백업이 아니므로 뺀다."""
    return sorted(path.name for path in root.iterdir() if path.name != LOCK_FILE_NAME)


def _manifest(directory: Path) -> dict:
    return json.loads((directory / "manifest.json").read_text(encoding="utf-8"))


def _snapshot(db_path: Path, upload_dir: Path) -> tuple:
    files = sorted((str(p.relative_to(upload_dir)), p.read_bytes()) for p in upload_dir.rglob("*") if p.is_file())
    return db_path.read_bytes(), files


def test_backup_copies_db_uploads_and_pending_drafts(live):
    db_path, upload_dir, root = live
    manifest = backup(db_path, upload_dir, root / "b1")

    assert manifest["db_backed_up"] is True
    assert (manifest["upload_file_count"], manifest["copied_files"]) == (3, 3)
    assert manifest["tool"] == "cropy-backup" and manifest["kind"] == "backup"
    assert manifest["journal_mode"] == "delete"
    assert _read_marker(root / "b1" / "cropcare.db") == "original"
    assert (root / "b1" / "uploads" / "a.jpg").read_bytes() == b"photo-a"
    assert (root / "b1" / "uploads" / ".pending" / "draft.json").exists()


@pytest.mark.parametrize("missing", ["db", "uploads"])
def test_missing_source_fails_without_creating_a_backup(live, tmp_path, missing):
    # 리뷰 1: 잘못된 경로로 실행해도 빈 "완료" 백업이 생기면 안 된다.
    db_path, upload_dir, root = live
    wrong_db = tmp_path / "typo.db" if missing == "db" else db_path
    wrong_uploads = tmp_path / "typo_uploads" if missing == "uploads" else upload_dir
    with pytest.raises(BackupError):
        backup(wrong_db, wrong_uploads, root / "empty")
    assert not root.exists()  # 잠금 파일도 만들지 않았다
    assert not (tmp_path / "typo.db").exists()  # sqlite3.connect가 빈 DB를 만들지 않았다


def test_backup_refuses_to_mix_into_an_existing_backup(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "same")
    with pytest.raises(FileExistsError):
        backup(db_path, upload_dir, root / "same")


@pytest.mark.parametrize("where", ["inside_uploads", "contains_db"])
def test_backup_output_must_not_overlap_live_data(live, where):
    db_path, upload_dir, _ = live
    out_dir = upload_dir / "backups" / "b1" if where == "inside_uploads" else db_path.parent
    with pytest.raises(BackupError):
        backup(db_path, upload_dir, out_dir)
    assert not (upload_dir / "backups").exists()


def test_db_inside_upload_folder_is_rejected_up_front(live):
    # 2차 리뷰 8: 업로드 폴더를 옮기면 그 안의 DB까지 옮겨져 교체가 중간에 실패한다.
    _, upload_dir, root = live
    nested_db = upload_dir / "cropcare.db"
    _make_sqlite_db(nested_db, "nested")
    before = _snapshot(nested_db, upload_dir)
    with pytest.raises(BackupError, match="업로드 폴더 안"):
        backup(nested_db, upload_dir, root / "b1")
    assert _snapshot(nested_db, upload_dir) == before


def test_failed_backup_leaves_no_folder(live, monkeypatch):
    db_path, upload_dir, root = live

    def broken_copy(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(backup_db.shutil, "copy2", broken_copy)
    with pytest.raises(OSError):
        backup(db_path, upload_dir, root / "b1")
    assert not (root / "b1").exists()


def test_wal_recapture_during_backup_cannot_split_db_and_photos(live, monkeypatch):
    # PR #104 검토에서 재현: WAL에서 백업 도중 재촬영 결과가 커밋되고 이전 사진이 지워지면,
    # 백업 DB가 없는 사진을 가리키는데도 백업이 "성공"으로 끝났다.
    db_path, upload_dir, root = live
    _use_wal(db_path)
    (upload_dir / "old-refine.jpg").write_bytes(b"old")
    with closing(sqlite3.connect(str(db_path))) as conn:
        conn.execute("UPDATE diagnoses SET refined_image_path = 'old-refine.jpg'")
        conn.commit()
    real_copy = backup_db._copy_uploads

    def copy_during_recapture(*args, **kwargs):
        (upload_dir / "new-refine.jpg").write_bytes(b"new")
        app = sqlite3.connect(str(db_path), timeout=0)
        try:
            app.execute("UPDATE diagnoses SET refined_image_path = 'new-refine.jpg'")
            app.commit()
            (upload_dir / "old-refine.jpg").unlink()  # diagnosis_service: 커밋 뒤 이전 사진 삭제
        except sqlite3.OperationalError:
            app.rollback()
        finally:
            app.close()
        return real_copy(*args, **kwargs)

    monkeypatch.setattr(backup_db, "_copy_uploads", copy_during_recapture)
    manifest = backup(db_path, upload_dir, root / "b1")

    with closing(sqlite3.connect(str(root / "b1" / "cropcare.db"))) as snapshot:
        refined = snapshot.execute("SELECT refined_image_path FROM diagnoses").fetchone()[0]
    assert (root / "b1" / "uploads" / refined).exists()
    assert manifest["missing_referenced_files"] == 0


def test_photo_and_draft_created_during_backup_cannot_complete_a_backup(live, monkeypatch):
    # 2차 리뷰 3: 잠금은 사진·초안 생성을 막지 못한다. 초안만 있고 사진은 없는 백업이 완료되면 안 된다.
    db_path, upload_dir, root = live
    real_copy = backup_db._copy_uploads

    def copy_then_app_writes(source, dest, *args):
        stats = real_copy(source, dest, *args)
        (upload_dir / "late.jpg").write_bytes(b"late")
        _write_draft(dest / ".pending", "late", "late.jpg")
        return stats

    monkeypatch.setattr(backup_db, "_copy_uploads", copy_then_app_writes)
    with pytest.raises(BackupError, match="서비스를 멈추고"):
        backup(db_path, upload_dir, root / "b1")
    assert not (root / "b1").exists()


def test_backup_with_a_foreign_key_violation_is_not_completed(live):
    # 3차 리뷰 2: 복원 검증에서 거부될 백업을 "완료"로 남기면 안 된다.
    db_path, upload_dir, root = live
    with closing(sqlite3.connect(str(db_path))) as conn:
        conn.executescript("""
            CREATE TABLE diseases (id INTEGER PRIMARY KEY);
            CREATE TABLE findings (disease_id INTEGER REFERENCES diseases(id));
            INSERT INTO findings VALUES (999);
        """)
    with pytest.raises(BackupError, match="외래 키"):
        backup(db_path, upload_dir, root / "bad")
    assert not (root / "bad").exists()


def test_backup_is_flushed_to_disk_before_it_is_marked_complete(live, monkeypatch):
    # 4차 리뷰 3: 복사가 끝났다고 저장장치에 기록된 것은 아니다. 완료 표시(manifest)는 백업 안의 모든
    # 파일을 내린 뒤에 쓴다
    db_path, upload_dir, root = live
    synced = []
    real_fsync = backup_db._fsync
    monkeypatch.setattr(backup_db, "_fsync", lambda path: (synced.append(Path(path)), real_fsync(path))[1])
    real_write = backup_db._write_manifest

    def check_then_write(directory, manifest):
        files = [path for path in Path(directory).rglob("*") if path.is_file()]
        assert files and all(path in synced for path in files)
        real_write(directory, manifest)

    monkeypatch.setattr(backup_db, "_write_manifest", check_then_write)
    out = root / "b1"
    backup(db_path, upload_dir, out)
    assert _manifest(out)["kind"] == "backup"
    assert not list(out.glob(".manifest-*.tmp"))


def test_help_prints_on_a_cp949_console():
    # Windows에서 출력을 파일·파이프로 넘기면 cp949로 인코딩된다. 못 쓰는 문자가 있으면 --help가 멈춘다.
    backup_db._build_parser().format_help().encode("cp949")


def test_backup_fails_at_once_while_another_job_holds_the_lock(live):
    # 같은 백업 폴더나 운영 데이터를 쓰는 다른 작업이 돌고 있으면 기다리지 않고 실패한다
    db_path, upload_dir, root = live
    with backup_db._lock_file(root / LOCK_FILE_NAME):
        with pytest.raises(BackupError, match="실행 중"):
            backup(db_path, upload_dir, root / "b1")
    assert _entries(root) == []
    backup(db_path, upload_dir, root / "b1")  # 잠금이 풀리면 다시 된다


# ---- incremental ----


def _hard_links_supported(directory: Path) -> bool:
    source, target = directory / ".link-probe", directory / ".link-probe-2"
    source.write_bytes(b"x")
    try:
        os.link(source, target)
        return True
    except OSError:
        return False
    finally:
        target.unlink(missing_ok=True)
        source.unlink(missing_ok=True)


@pytest.fixture
def needs_hard_links(tmp_path):
    if not _hard_links_supported(tmp_path):
        pytest.skip("이 파일시스템은 하드링크를 지원하지 않는다 (복사 대체는 별도 테스트)")


def test_first_backup_has_no_base_and_links_nothing(live):
    db_path, upload_dir, root = live
    manifest = backup(db_path, upload_dir, root / "b1")
    assert manifest["base_backup"] is None
    assert (manifest["linked_files"], manifest["copied_files"]) == (0, 3)


def test_unchanged_uploads_are_hard_linked_to_the_previous_backup(live, needs_hard_links):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    (upload_dir / "c.jpg").write_bytes(b"photo-c")
    manifest = backup(db_path, upload_dir, root / "b2")

    assert manifest["base_backup"] == "b1"
    assert (manifest["linked_files"], manifest["copied_files"]) == (3, 1)
    assert manifest["copied_bytes"] == len(b"photo-c")
    assert os.path.samefile(root / "b1" / "uploads" / "a.jpg", root / "b2" / "uploads" / "a.jpg")
    assert (root / "b2" / "uploads" / "c.jpg").read_bytes() == b"photo-c"
    # 증분 연결은 이전 백업끼리만 한다. 운영 원본과는 같은 파일이면 안 된다.
    assert not os.path.samefile(upload_dir / "a.jpg", root / "b2" / "uploads" / "a.jpg")


def test_changed_upload_is_copied_and_previous_backup_keeps_old_content(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    (upload_dir / "a.jpg").write_bytes(b"photo-a-edited")
    manifest = backup(db_path, upload_dir, root / "b2")

    assert manifest["copied_bytes"] >= len(b"photo-a-edited")
    assert (root / "b2" / "uploads" / "a.jpg").read_bytes() == b"photo-a-edited"
    assert (root / "b1" / "uploads" / "a.jpg").read_bytes() == b"photo-a"


def test_deleted_upload_is_not_carried_into_the_next_backup(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    (upload_dir / "b.jpg").unlink()
    backup(db_path, upload_dir, root / "b2")
    assert not (root / "b2" / "uploads" / "b.jpg").exists()
    assert (root / "b1" / "uploads" / "b.jpg").exists()


def test_incomplete_backup_without_manifest_is_never_used_as_base(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    partial = root / "zz_partial" / "uploads"
    partial.mkdir(parents=True)
    (partial / "a.jpg").write_bytes(b"truncated")

    assert find_latest_backup(root, db_path, upload_dir) == (root / "b1").resolve()
    assert backup(db_path, upload_dir, root / "b2")["base_backup"] == "b1"


@pytest.mark.parametrize("change", [
    {"tool": "other-app"},
    {"format": 1},
    {"source_uploads": "/elsewhere/uploads"},
    {"source_db": "/elsewhere/cropcare.db"},
    {"created_at": "not-a-date"},
])
def test_foreign_or_unidentified_folder_is_never_used_as_base(live, change):
    # 리뷰 6: 같은 경로·크기·시각의 다른 내용을 하드링크하면 백업이 엉뚱한 사진을 담는다.
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "foreign")
    (root / "foreign" / "uploads" / "a.jpg").write_bytes(b"other-app-a")  # 같은 크기 아님은 중요치 않다
    os.utime(root / "foreign" / "uploads" / "a.jpg", ns=(0, (upload_dir / "a.jpg").stat().st_mtime_ns))
    manifest = _manifest(root / "foreign")
    manifest.update(change)
    (root / "foreign" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    result = backup(db_path, upload_dir, root / "b2")
    assert result["base_backup"] is None
    assert (root / "b2" / "uploads" / "a.jpg").read_bytes() == b"photo-a"


def _link_directory(link: Path, target: Path) -> None:
    """Windows는 권한 없이 만들 수 있는 정션을, 그 외는 심볼릭 링크를 만든다."""
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


def test_link_inside_base_backup_never_hard_links_live_files(live, needs_hard_links):
    # 2차 리뷰 4: 기준 백업의 중간 폴더가 운영 .pending을 가리키는 링크면 운영 원본에 연결된다.
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    shutil.rmtree(root / "b1" / "uploads" / ".pending")
    try:
        _link_directory(root / "b1" / "uploads" / ".pending", upload_dir / ".pending")
    except OSError as exc:
        pytest.skip(f"링크를 만들 수 없는 환경: {exc}")

    backup(db_path, upload_dir, root / "b2")

    live_draft, new_draft = upload_dir / ".pending" / "draft.json", root / "b2" / "uploads" / ".pending" / "draft.json"
    assert not os.path.samefile(live_draft, new_draft)
    live_draft.write_text(json.dumps({"fields": {"image_path": "a.jpg"}}), encoding="utf-8")
    assert json.loads(new_draft.read_text(encoding="utf-8"))["fields"]["image_path"] == "b.jpg"


def test_hard_link_failure_falls_back_to_copy(live, monkeypatch):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")

    def no_links(source, target):
        raise OSError("hard links unsupported")

    monkeypatch.setattr(backup_db.os, "link", no_links)
    manifest = backup(db_path, upload_dir, root / "b2")
    assert (manifest["linked_files"], manifest["copied_files"]) == (0, 3)
    assert (root / "b2" / "uploads" / "a.jpg").read_bytes() == b"photo-a"


def test_full_option_copies_without_linking(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    manifest = backup(db_path, upload_dir, root / "b2", incremental=False)
    assert manifest["base_backup"] is None
    assert manifest["linked_files"] == 0
    assert not os.path.samefile(root / "b1" / "uploads" / "a.jpg", root / "b2" / "uploads" / "a.jpg")


# ---- retention ----


def _set_created_at(directory: Path, value) -> None:
    manifest = _manifest(directory)
    manifest["created_at"] = value
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _drop_sequence(directory: Path) -> None:
    """순번(sequence)을 기록하기 전의 예전 백업처럼 만든다."""
    manifest = _manifest(directory)
    del manifest["sequence"]
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_backups_get_increasing_sequence_numbers(live):
    db_path, upload_dir, root = live
    assert [backup(db_path, upload_dir, root / name)["sequence"] for name in ("b1", "b2", "b3")] == [0, 1, 2]


def test_prune_keeps_newest_backups_and_survivors_stay_readable(live):
    db_path, upload_dir, root = live
    for index, name in enumerate(["b1", "b2", "b3", "b4"]):
        backup(db_path, upload_dir, root / name)
        _set_created_at(root / name, f"2026-10-0{index + 1}T00:00:00+00:00")

    removed = prune_backups(root, 2, db_path, upload_dir, protect=root / "b4")

    assert sorted(path.name for path in removed) == ["b1", "b2"]
    assert _entries(root) == ["b3", "b4"]
    # b3·b4의 하드링크 원본이 b1이었어도 데이터는 남아 있어야 한다.
    assert (root / "b4" / "uploads" / "a.jpg").read_bytes() == b"photo-a"
    assert _read_marker(root / "b3" / "cropcare.db") == "original"


def test_prune_orders_legacy_backups_by_real_time_across_utc_offsets(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "utc")
    backup(db_path, upload_dir, root / "seoul")
    # 서울 10:00(+09:00) = UTC 01:00 이므로 UTC 02:00 백업이 더 최신이다. 문자열 정렬은 반대다.
    _set_created_at(root / "seoul", "2026-10-15T10:00:00+09:00")
    _set_created_at(root / "utc", "2026-10-15T02:00:00+00:00")
    for name in ("seoul", "utc"):
        _drop_sequence(root / name)

    removed = prune_backups(root, 1, db_path, upload_dir)
    assert [path.name for path in removed] == ["seoul"]


def test_clock_going_back_does_not_make_an_old_backup_look_newest(live):
    # 3차 리뷰 3: RTC 없는 보드가 재부팅 뒤 과거 시각으로 돌아가면, 시각 정렬은 실제로 오래된
    # "미래 시각" 백업을 남기고 최근 백업을 지우며, 증분 기준도 그 오래된 백업으로 잡는다.
    db_path, upload_dir, root = live
    for name, created in [("old_future", "2030-01-01T00:00:00+00:00"),
                          ("recent1", "2020-01-01T00:00:00+00:00"),
                          ("recent2", "2020-01-02T00:00:00+00:00")]:
        backup(db_path, upload_dir, root / name)
        _set_created_at(root / name, created)

    assert find_latest_backup(root, db_path, upload_dir) == (root / "recent2").resolve()
    removed = prune_backups(root, 2, db_path, upload_dir, protect=root / "recent2")
    assert [path.name for path in removed] == ["old_future"]


@pytest.mark.parametrize("missing", ["db", "uploads"])
def test_failed_backup_never_prunes_good_backups(live, tmp_path, missing):
    # 리뷰 1: 잘못된 경로로 실행해도 정상 백업이 지워지면 안 된다.
    db_path, upload_dir, root = live
    run_backup(db_path, upload_dir, root / "good", keep=1)
    wrong_db = tmp_path / "typo.db" if missing == "db" else db_path
    wrong_uploads = tmp_path / "typo_uploads" if missing == "uploads" else upload_dir

    with pytest.raises(BackupError):
        run_backup(wrong_db, wrong_uploads, root / "empty", keep=1)
    assert _entries(root) == ["good"]


def test_backup_that_restore_would_reject_does_not_prune_good_backups(live):
    # 3차 리뷰 2: 외래 키 위반 DB의 백업이 "완료"되면 보관 정리가 정상 백업을 지운다.
    db_path, upload_dir, root = live
    run_backup(db_path, upload_dir, root / "good", keep=1)
    with closing(sqlite3.connect(str(db_path))) as conn:
        conn.executescript("""
            CREATE TABLE diseases (id INTEGER PRIMARY KEY);
            CREATE TABLE findings (disease_id INTEGER REFERENCES diseases(id));
            INSERT INTO findings VALUES (999);
        """)

    with pytest.raises(BackupError, match="외래 키"):
        run_backup(db_path, upload_dir, root / "bad", keep=1)
    assert not (root / "bad").exists()
    assert _entries(root) == ["good"]


def test_prune_never_touches_unmarked_safety_foreign_or_other_source_folders(live, tmp_path):
    db_path, upload_dir, root = live
    legacy = root / "20260928T061946Z"  # 이 기능 이전 형식(표시 없음)의 실제 백업
    (legacy / "uploads").mkdir(parents=True)
    (legacy / "manifest.json").write_text(json.dumps({"created_at": "2026-09-28T06:19:46+00:00"}), encoding="utf-8")
    (root / "notes").mkdir()
    (root / "notes" / "readme.txt").write_text("keep me", encoding="utf-8")
    other_db = tmp_path / "other" / "cropcare.db"
    other_db.parent.mkdir()
    _make_sqlite_db(other_db, "other")
    other_uploads = tmp_path / "other" / "uploads"
    other_uploads.mkdir()
    backup(other_db, other_uploads, root / "other-set")
    bad_time = root / "bad-time"
    backup(db_path, upload_dir, bad_time)
    _set_created_at(bad_time, "2026-10-01T00:00:00")  # 시간대 없음
    backup(db_path, upload_dir, root / "b1")
    backup(db_path, upload_dir, root / "b2")

    removed = prune_backups(root, 1, db_path, upload_dir, protect=root / "b2")

    assert [path.name for path in removed] == ["b1"]
    assert set(_entries(root)) == {"20260928T061946Z", "notes", "other-set", "bad-time", "b2"}


def test_prune_with_zero_keep_disables_deletion(live):
    db_path, upload_dir, root = live
    for name in ["b1", "b2", "b3"]:
        backup(db_path, upload_dir, root / name)
    assert prune_backups(root, 0, db_path, upload_dir) == []
    assert len(_entries(root)) == 3


def test_prune_never_removes_the_backup_just_created(live):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "new")
    backup(db_path, upload_dir, root / "newer")
    _set_created_at(root / "new", "2027-01-01T00:00:00+00:00")  # 시계가 틀어진 경우
    for name in ("new", "newer"):
        _drop_sequence(root / name)  # 순번이 없으면 시각으로만 정렬되어 "newer"가 더 오래돼 보인다
    assert prune_backups(root, 1, db_path, upload_dir, protect=root / "newer") == []
    assert (root / "newer").exists()


def test_prune_rejects_negative_keep(live):
    db_path, upload_dir, root = live
    with pytest.raises(ValueError):
        prune_backups(root, -1, db_path, upload_dir)


class _PausedJob:
    """백업·복원 작업을 스레드에서 돌리다 backup_db의 한 함수에 처음 들어갈 때 멈춰 둔다.

    멈춘 동안 다른 작업을 시도해 본다. 두 번째 호출부터는 멈추지 않으므로, 잠금이 없으면 뒤의 작업이
    실제로 끝까지 진행되어 테스트가 실패한다. 스레드의 예외는 끝날 때 다시 올린다.
    """

    def __init__(self, monkeypatch, function_name, job):
        self.inside, self.release = threading.Event(), threading.Event()
        self.result = self.error = None
        real = getattr(backup_db, function_name)

        def paused(*args, **kwargs):
            if not self.inside.is_set():
                self.inside.set()
                if not self.release.wait(30):
                    raise AssertionError("테스트가 멈춘 작업을 재개하지 않았다")
            return real(*args, **kwargs)

        def run():
            try:
                self.result = job()
            except BaseException as exc:  # 스레드 밖에서 다시 올린다
                self.error = exc

        monkeypatch.setattr(backup_db, function_name, paused)
        self._unpatch = lambda: monkeypatch.setattr(backup_db, function_name, real)
        self.thread = threading.Thread(target=run)

    def __enter__(self):
        self.thread.start()
        if not self.inside.wait(30):
            self._finish()  # with 본문과 __exit__이 실행되지 않으므로 여기서 정리한다
            raise AssertionError("작업이 멈출 지점에 오지 않았다")
        return self

    def __exit__(self, exc_type, *_):
        self._finish()
        if self.error is not None and exc_type is None:
            raise self.error

    def _finish(self):
        self.release.set()
        try:
            self.thread.join(30)
            assert not self.thread.is_alive()
        finally:
            self._unpatch()


def test_backups_to_the_same_folder_never_run_at_once(live, monkeypatch):
    # 4차 리뷰 1: 같은 출력 폴더를 쓰는 두 실행 중 실패한 쪽이 다른 쪽의 완료 백업을 지웠다.
    # 같은 백업 폴더의 작업은 작업 잠금으로 막고, 뒤의 작업은 기다리지 않고 실패한다
    db_path, upload_dir, root = live
    out = root / "20261104T000000Z"
    with _PausedJob(monkeypatch, "_snapshot_db", lambda: backup(db_path, upload_dir, out)) as first:
        with pytest.raises(BackupError, match="실행 중"):
            backup(db_path, upload_dir, out)
        with pytest.raises(BackupError, match="실행 중"):
            backup(db_path, upload_dir, root / "other")

    assert first.result["kind"] == "backup"
    assert (out / "manifest.json").is_file() and (out / "cropcare.db").is_file()
    assert _entries(root) == ["20261104T000000Z"]
    backup(db_path, upload_dir, root / "next")  # 잠금은 작업이 끝나면 풀린다


def test_backup_and_prune_hold_the_folder_lock_together(live, monkeypatch):
    # 정리가 다른 작업이 증분 기준으로 쓰는 백업을 지우지 않도록 백업과 정리를 한 잠금 안에서 한다
    db_path, upload_dir, root = live
    with _PausedJob(monkeypatch, "_snapshot_db", lambda: backup(db_path, upload_dir, root / "b1")):
        with pytest.raises(BackupError, match="실행 중"):
            run_backup(db_path, upload_dir, root / "b2", keep=1)
    manifest, removed = run_backup(db_path, upload_dir, root / "b2", keep=1)
    assert [path.name for path in removed] == ["b1"] and manifest["base_backup"] == "b1"


# ---- restore: 미리보기 ----


def _file_hashes(root: Path) -> dict[str, str]:
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_file()}


@pytest.fixture
def snapshot_to_restore(tmp_path):
    """복원 대상: 새 DB·사진이 담긴 정상 백업."""
    src_db = tmp_path / "src" / "cropcare.db"
    src_db.parent.mkdir()
    _make_sqlite_db(src_db, "new-data")
    src_uploads = tmp_path / "src" / "uploads"
    src_uploads.mkdir()
    (src_uploads / "new.jpg").write_bytes(b"new")
    backup_dir = tmp_path / "backups" / "snap1"
    backup(src_db, src_uploads, backup_dir)
    return backup_dir


def test_restore_preview_validates_but_does_not_touch_anything(live, snapshot_to_restore):
    db_path, upload_dir, _ = live
    before = _snapshot(db_path, upload_dir)
    plan = restore(snapshot_to_restore, db_path, upload_dir, apply=False)
    assert plan["applied"] is False
    assert plan["upload_file_count"] == 1
    assert _snapshot(db_path, upload_dir) == before


@pytest.mark.parametrize("damage", ["db", "uploads", "count", "corrupt_db", "manifest"])
def test_incomplete_or_damaged_backup_is_rejected(live, snapshot_to_restore, damage):
    # 리뷰 4: 구성 파일이 빠진 백업으로 DB·사진 시점을 섞으면 안 된다.
    db_path, upload_dir, _ = live
    if damage == "db":
        (snapshot_to_restore / "cropcare.db").unlink()
    elif damage == "uploads":
        shutil.rmtree(snapshot_to_restore / "uploads")
    elif damage == "count":
        (snapshot_to_restore / "uploads" / "new.jpg").unlink()
    elif damage == "corrupt_db":
        (snapshot_to_restore / "cropcare.db").write_bytes(b"garbage")
    else:
        (snapshot_to_restore / "manifest.json").write_text("{broken", encoding="utf-8")
    before = _snapshot(db_path, upload_dir)

    with pytest.raises(BackupError):
        restore(snapshot_to_restore, db_path, upload_dir, apply=False)
    assert _snapshot(db_path, upload_dir) == before


def test_restore_rejects_a_backup_inside_the_upload_folder(live, snapshot_to_restore):
    # 리뷰 2: 업로드 폴더를 바꾸는 복원이 입력 백업까지 지우면 안 된다.
    db_path, upload_dir, _ = live
    nested = upload_dir / "backups" / "snap"
    shutil.copytree(snapshot_to_restore, nested)
    with pytest.raises(BackupError):
        restore(nested, db_path, upload_dir, apply=False)


def test_restore_rejects_a_db_inside_the_upload_folder(live, snapshot_to_restore):
    _, upload_dir, _ = live
    with pytest.raises(BackupError, match="업로드 폴더 안"):
        restore(snapshot_to_restore, upload_dir / "cropcare.db", upload_dir, apply=False)


def test_backup_with_links_is_rejected(live, snapshot_to_restore, tmp_path):
    db_path, upload_dir, _ = live
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    try:
        (snapshot_to_restore / "uploads" / "evil.jpg").symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"심볼릭 링크를 만들 수 없는 환경: {exc}")
    with pytest.raises(BackupError, match="링크"):
        restore(snapshot_to_restore, db_path, upload_dir, apply=False)


def test_backup_with_foreign_key_violation_is_rejected(live, snapshot_to_restore):
    db_path, upload_dir, _ = live
    with closing(sqlite3.connect(str(snapshot_to_restore / "cropcare.db"))) as conn:
        conn.executescript("""
            CREATE TABLE diseases (id INTEGER PRIMARY KEY);
            CREATE TABLE findings (disease_id INTEGER REFERENCES diseases(id));
            INSERT INTO findings VALUES (999);
        """)
    with pytest.raises(BackupError, match="외래 키"):
        restore(snapshot_to_restore, db_path, upload_dir, apply=False)


def test_restore_without_manifest_raises(tmp_path):
    empty_dir = tmp_path / "not_a_backup"
    empty_dir.mkdir()
    with pytest.raises(FileNotFoundError):
        restore(empty_dir, tmp_path / "db.sqlite", tmp_path / "uploads", apply=False)


def test_backup_with_a_hot_rollback_journal_is_checked_on_a_copy(live, snapshot_to_restore):
    # 4차 리뷰 2: 강제 종료로 남은 rollback 저널을 그대로 열어 검사하면 SQLite가 되돌리려다
    # 읽기 전용 오류를 내, 복구할 수 있는 백업을 미리보기 단계에서 거부했다
    db_path, upload_dir, _ = live
    backup_db_file = snapshot_to_restore / "cropcare.db"
    crash = (
        "import os, sqlite3, sys\n"
        "c = sqlite3.connect(sys.argv[1], isolation_level=None)\n"
        "c.execute('PRAGMA journal_mode=DELETE')\n"
        "c.execute('CREATE TABLE filler (v TEXT)')\n"
        "c.execute('PRAGMA cache_size=1')\n"  # 바뀐 페이지를 DB 파일에 내보내 진짜 hot journal을 만든다
        "c.execute('BEGIN')\n"
        "c.execute(\"UPDATE marker SET value='uncommitted'\")\n"
        "c.executemany('INSERT INTO filler VALUES (?)', [('x' * 500,)] * 2000)\n"
        "os._exit(1)\n"
    )
    assert subprocess.run([sys.executable, "-c", crash, str(backup_db_file)], check=False).returncode == 1
    assert (snapshot_to_restore / "cropcare.db-journal").stat().st_size > 0
    before = _file_hashes(snapshot_to_restore)

    assert restore(snapshot_to_restore, db_path, upload_dir, apply=False)["applied"] is False
    assert _file_hashes(snapshot_to_restore) == before  # 검사는 사본에서 했다


# ---- 복원 직전 안전 백업 ----


def _safety_backup(db_path: Path, upload_dir: Path, root: Path) -> Path:
    safety_dir = root / "pre_restore_test"
    safety_dir.mkdir(parents=True)
    backup_db._safety_backup(db_path, upload_dir, safety_dir)
    return safety_dir


def test_safety_backup_keeps_a_corrupt_db_and_its_journal_as_raw_files(live):
    # 리뷰 5: 손상된 현재 DB도 읽지 않고 원시 파일 그대로 남겨야 나중에 살펴볼 수 있다
    db_path, upload_dir, root = live
    db_path.write_bytes(b"corrupted-current-db")
    db_path.with_name(db_path.name + "-journal").write_bytes(b"stale-journal")

    safety_dir = _safety_backup(db_path, upload_dir, root)

    assert (safety_dir / "cropcare.db").read_bytes() == b"corrupted-current-db"
    assert (safety_dir / "cropcare.db-journal").read_bytes() == b"stale-journal"
    manifest = _manifest(safety_dir)
    assert manifest["kind"] == "pre_restore" and manifest["raw_copy"] is True
    assert manifest["sidecars"] == ["cropcare.db-journal"]


def test_safety_backup_names_journals_after_the_saved_db(live, tmp_path):
    # 3차 리뷰 1: DB 이름이 cropcare.db가 아니면 저널을 원래 이름(app.db-wal)으로 두어 인식되지 않았다
    _, upload_dir, root = live
    db_path = tmp_path / "current" / "app.db"
    _make_sqlite_db(db_path, "original")
    db_path.with_name("app.db-wal").write_bytes(b"live-wal")

    safety_dir = _safety_backup(db_path, upload_dir, root)

    assert (safety_dir / "cropcare.db-wal").read_bytes() == b"live-wal"
    assert not (safety_dir / "app.db-wal").exists()


def test_safety_backup_copies_photos_without_linking_to_any_backup(live):
    # 안전 백업은 이것만 믿고 운영 데이터를 바꾸므로, 다른 백업과 하드링크로 묶지 않는다
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")

    safety_dir = _safety_backup(db_path, upload_dir, root)

    manifest = _manifest(safety_dir)
    assert (manifest["upload_file_count"], manifest["linked_files"]) == (3, 0)
    assert not os.path.samefile(root / "b1" / "uploads" / "a.jpg", safety_dir / "uploads" / "a.jpg")
    assert manifest["sequence"] == 1  # 정기 백업과 같은 순번을 이어 쓴다


def test_safety_backup_is_synced_before_its_manifest(live, monkeypatch):
    db_path, upload_dir, root = live
    synced = []
    real_fsync = backup_db._fsync
    monkeypatch.setattr(backup_db, "_fsync", lambda path: (synced.append(Path(path)), real_fsync(path))[1])
    real_write = backup_db._write_manifest

    def check_then_write(directory, manifest):
        files = [path for path in Path(directory).rglob("*") if path.is_file()]
        assert files and all(path in synced for path in files)
        real_write(directory, manifest)

    monkeypatch.setattr(backup_db, "_write_manifest", check_then_write)
    assert _manifest(_safety_backup(db_path, upload_dir, root))["kind"] == "pre_restore"


def test_safety_backup_of_a_device_without_data(tmp_path):
    safety_dir = _safety_backup(tmp_path / "fresh" / "cropcare.db", tmp_path / "fresh" / "uploads", tmp_path / "b")
    manifest = _manifest(safety_dir)
    assert manifest["db_backed_up"] is False
    assert manifest["upload_file_count"] == 0 and manifest["warning_uploads_missing"] is True


# ---- restore: 실제 복원 ----


def test_restore_apply_overwrites_and_keeps_safety_backup(live, snapshot_to_restore):
    db_path, upload_dir, _ = live
    plan = restore(snapshot_to_restore, db_path, upload_dir, apply=True)

    assert plan["applied"] is True
    assert _read_marker(db_path) == "new-data"
    assert (upload_dir / "new.jpg").exists()
    assert not (upload_dir / "a.jpg").exists()
    assert not list(upload_dir.parent.glob(".restore-*")) and not list(upload_dir.parent.glob(".pre-restore-*"))

    # 덮어쓰기 직전 상태가 안전 백업으로 남아있어야 한다
    safety_dir = Path(plan["safety_backup_dir"])
    assert _read_marker(safety_dir / "cropcare.db") == "original"
    assert (safety_dir / "uploads" / "a.jpg").read_bytes() == b"photo-a"
    assert (safety_dir / "uploads" / ".pending" / "draft.json").exists()
    assert _manifest(safety_dir)["kind"] == "pre_restore"
    assert _manifest(safety_dir)["linked_files"] == 0


def test_wal_backup_restores_and_live_wal_files_are_set_aside(live, snapshot_to_restore):
    db_path, upload_dir, _ = live
    _use_wal(db_path)
    for suffix in ("-wal", "-shm"):
        sidecar = db_path.with_name(db_path.name + suffix)
        if not sidecar.exists():
            sidecar.write_bytes(b"live-" + suffix.encode())
    _use_wal(snapshot_to_restore / "cropcare.db")

    plan = restore(snapshot_to_restore, db_path, upload_dir, apply=True)

    assert _read_marker(db_path) == "new-data"
    safety_dir = Path(plan["safety_backup_dir"])
    assert (safety_dir / "cropcare.db-wal").exists() and (safety_dir / "cropcare.db-shm").exists()


def test_restore_works_when_current_db_is_corrupt_and_keeps_raw_copy(live, snapshot_to_restore):
    # 리뷰 5: 손상된 현재 DB 때문에 정상 백업으로 복원하지 못하면 안 된다.
    db_path, upload_dir, _ = live
    db_path.write_bytes(b"corrupted-current-db")
    hot_journal = db_path.with_name(db_path.name + "-journal")
    hot_journal.write_bytes(b"stale-journal")

    plan = restore(snapshot_to_restore, db_path, upload_dir, apply=True)

    assert _read_marker(db_path) == "new-data"
    assert not hot_journal.exists()  # 이전 저널이 새 DB에 적용되지 않도록 치웠다
    safety_dir = Path(plan["safety_backup_dir"])
    assert (safety_dir / "cropcare.db").read_bytes() == b"corrupted-current-db"
    assert (safety_dir / "cropcare.db-journal").read_bytes() == b"stale-journal"


def test_restore_onto_an_empty_device(tmp_path, snapshot_to_restore):
    db_path = tmp_path / "fresh" / "cropcare.db"
    upload_dir = tmp_path / "fresh" / "uploads"
    restore(snapshot_to_restore, db_path, upload_dir, apply=True)
    assert _read_marker(db_path) == "new-data"
    assert (upload_dir / "new.jpg").read_bytes() == b"new"


def test_failure_while_staging_leaves_live_data_untouched(live, snapshot_to_restore, monkeypatch):
    # 리뷰 7: 사진 복사 중 실패하면 새 DB와 비어 있는 업로드가 남으면 안 된다.
    db_path, upload_dir, _ = live
    before = _snapshot(db_path, upload_dir)

    def disk_full(*args, **kwargs):
        raise OSError("No space left on device")

    monkeypatch.setattr(backup_db.shutil, "copytree", disk_full)
    with pytest.raises(OSError):
        restore(snapshot_to_restore, db_path, upload_dir, apply=True)
    assert _snapshot(db_path, upload_dir) == before
    assert not list(upload_dir.parent.glob(".restore-*"))


def test_failure_while_swapping_rolls_everything_back(live, snapshot_to_restore, monkeypatch):
    db_path, upload_dir, _ = live
    journal = db_path.with_name(db_path.name + "-journal")
    journal.write_bytes(b"live-journal")
    before = _snapshot(db_path, upload_dir)
    real_replace = os.replace

    def fail_on_db_swap(source, target):
        if Path(target) == db_path.resolve():
            raise OSError("file is in use")
        return real_replace(source, target)

    monkeypatch.setattr(backup_db.os, "replace", fail_on_db_swap)
    with pytest.raises(OSError):
        restore(snapshot_to_restore, db_path, upload_dir, apply=True)

    assert _snapshot(db_path, upload_dir) == before
    assert journal.read_bytes() == b"live-journal"
    assert not list(upload_dir.parent.glob(".restore-*")) and not list(upload_dir.parent.glob(".pre-restore-*"))


def test_rollback_keeps_going_when_one_step_fails_and_reports_it(live, snapshot_to_restore, monkeypatch):
    # 2차 리뷰 5: 저널 되돌리기가 실패해도 업로드 되돌리기는 계속해야 한다.
    db_path, upload_dir, _ = live
    journal = db_path.with_name(db_path.name + "-journal")
    journal.write_bytes(b"live-journal")
    before_uploads = _snapshot(db_path, upload_dir)[1]
    real_replace = os.replace

    def flaky_replace(source, target):
        if Path(target) == db_path.resolve():
            raise OSError("file is in use")
        if Path(target) == journal.resolve():
            raise OSError("journal rollback failed")
        return real_replace(source, target)

    monkeypatch.setattr(backup_db.os, "replace", flaky_replace)
    with pytest.raises(BackupError, match="서비스를 시작하지 말고") as caught:
        restore(snapshot_to_restore, db_path, upload_dir, apply=True)

    assert "pre_restore_" in str(caught.value) and "journal" in str(caught.value)
    assert _read_marker(db_path) == "original"  # DB는 교체되지 않았다
    assert _snapshot(db_path, upload_dir)[1] == before_uploads  # 업로드는 되돌렸다
    assert not journal.exists()  # 되돌리지 못한 저널은 DB 옆 임시 이름에 남는다
    leftover = list(db_path.parent.glob(".restore-*-cropcare.db-journal"))
    assert len(leftover) == 1 and leftover[0].read_bytes() == b"live-journal"


def test_journal_is_moved_within_the_db_folder_not_to_another_volume(live, snapshot_to_restore, monkeypatch):
    # 2차 리뷰 6: 안전 백업이 다른 디스크에 있으면 볼륨 간 이동이 실패한다.
    db_path, upload_dir, _ = live
    journal = db_path.with_name(db_path.name + "-wal")
    journal.write_bytes(b"live-wal")
    moves = []
    real_replace = os.replace

    def recording_replace(source, target):
        moves.append((Path(source), Path(target)))
        return real_replace(source, target)

    monkeypatch.setattr(backup_db.os, "replace", recording_replace)
    plan = restore(snapshot_to_restore, db_path, upload_dir, apply=True)

    journal_moves = [(s, t) for s, t in moves if s.name.endswith("-wal")]
    assert journal_moves and all(t.parent == db_path.parent.resolve() for _, t in journal_moves)
    assert not list(db_path.parent.glob(".restore-*"))  # 성공 후 옮긴 저널은 지웠다
    assert (Path(plan["safety_backup_dir"]) / "cropcare.db-wal").read_bytes() == b"live-wal"


def test_safety_backup_name_collision_never_deletes_existing_folders(live, snapshot_to_restore, monkeypatch):
    # 2차 리뷰 1·7: 이름이 겹친 기존 안전 백업이나 복원 입력을 실패 정리에서 지우면 안 된다.
    db_path, upload_dir, _ = live
    monkeypatch.setattr(backup_db, "_timestamp", lambda: "20261015T000000Z")

    class FixedUUID:
        hex = "deadbeefcafebabe"

    monkeypatch.setattr(backup_db, "uuid4", lambda: FixedUUID())
    existing = snapshot_to_restore.parent / "pre_restore_20261015T000000Z-deadbeef"
    existing.mkdir()
    (existing / "keep.txt").write_text("earlier safety backup", encoding="utf-8")
    before = _snapshot(db_path, upload_dir)

    with pytest.raises(BackupError, match="임시 경로가 이미"):
        restore(snapshot_to_restore, db_path, upload_dir, apply=True)
    assert (existing / "keep.txt").read_text(encoding="utf-8") == "earlier safety backup"

    # 복원 입력 자체가 그 이름이어도 지우지 않는다.
    shutil.rmtree(existing)
    shutil.copytree(snapshot_to_restore, existing)
    with pytest.raises(BackupError):
        restore(existing, db_path, upload_dir, apply=True)
    assert (existing / "manifest.json").exists() and (existing / "cropcare.db").exists()
    assert _snapshot(db_path, upload_dir) == before


def test_db_inside_upload_folder_is_rejected_before_restoring(live, snapshot_to_restore):
    # 2차 리뷰 8: 업로드 폴더를 옮기면 그 안의 DB까지 옮겨져 교체가 중간에 실패한다.
    _, upload_dir, _ = live
    nested_db = upload_dir / "cropcare.db"
    _make_sqlite_db(nested_db, "nested")
    before = _snapshot(nested_db, upload_dir)
    with pytest.raises(BackupError, match="업로드 폴더 안"):
        restore(snapshot_to_restore, nested_db, upload_dir, apply=True)
    assert _snapshot(nested_db, upload_dir) == before


# ---- restore: 저널·하드링크·동시 실행 ----


@pytest.mark.parametrize("db_name", ["cropcare.db", "app.db"])
def test_restoring_a_safety_backup_keeps_commits_only_in_its_wal(live, tmp_path, db_name):
    # 3차 리뷰 1: 안전 백업의 -wal에만 있는 커밋이 DB 본체만 복사하는 복원에서 조용히 사라졌다.
    # DB 이름이 cropcare.db가 아니면 저널이 원래 이름으로 저장돼 아예 인식되지 않았다.
    _, upload_dir, root = live
    db_path = tmp_path / "current" / db_name
    if db_name != "cropcare.db":
        shutil.copy2(live[0], db_path)
    _use_wal(db_path)
    holder = sqlite3.connect(str(db_path))
    holder.execute("PRAGMA wal_autocheckpoint=0")
    holder.execute("INSERT INTO marker (value) VALUES ('only-in-wal')")
    holder.commit()
    try:
        safety_dir = root / "pre_restore_test"
        safety_dir.mkdir(parents=True)
        backup_db._safety_backup(db_path, upload_dir, safety_dir)
    finally:
        holder.close()
    assert (safety_dir / "cropcare.db-wal").stat().st_size > 0

    restore(safety_dir, db_path, upload_dir, apply=True)

    with closing(sqlite3.connect(str(db_path))) as conn:
        assert {row[0] for row in conn.execute("SELECT value FROM marker")} == {"original", "only-in-wal"}
    assert (safety_dir / "cropcare.db-wal").stat().st_size > 0  # 복원 입력은 바뀌지 않는다
    assert not list(db_path.parent.glob(".restore-*"))


def test_safety_backup_with_a_hot_rollback_journal_is_checked_and_restored(live):
    # 4차 리뷰 2: 강제 종료로 남은 rollback 저널을 그대로 열어 검사하면 SQLite가 되돌리려다
    # 읽기 전용 오류를 내, 복구할 수 있는 안전 백업을 미리보기 단계에서 거부했다
    db_path, upload_dir, root = live
    crash = (
        "import os, sqlite3, sys\n"
        "c = sqlite3.connect(sys.argv[1], isolation_level=None)\n"
        "c.execute('PRAGMA journal_mode=DELETE')\n"
        "c.execute('CREATE TABLE filler (v TEXT)')\n"
        "c.execute('PRAGMA cache_size=1')\n"  # 바뀐 페이지를 DB 파일에 내보내 진짜 hot journal을 만든다
        "c.execute('BEGIN')\n"
        "c.execute(\"UPDATE marker SET value='uncommitted'\")\n"
        "c.executemany('INSERT INTO filler VALUES (?)', [('x' * 500,)] * 2000)\n"
        "os._exit(1)\n"
    )
    assert subprocess.run([sys.executable, "-c", crash, str(db_path)], check=False).returncode == 1  # 의도한 강제 종료
    assert (db_path.parent / "cropcare.db-journal").stat().st_size > 0
    safety_dir = root / "pre_restore_crash"
    safety_dir.mkdir(parents=True)
    backup_db._safety_backup(db_path, upload_dir, safety_dir)
    before = _file_hashes(safety_dir)

    assert restore(safety_dir, db_path, upload_dir, apply=False)["applied"] is False
    restore(safety_dir, db_path, upload_dir, apply=True)

    assert _read_marker(db_path) == "original"  # 커밋되지 않은 변경은 저널로 되돌려졌다
    assert _file_hashes(safety_dir) == before  # 복원 입력(저널 포함)은 바뀌지 않는다
    assert (safety_dir / "cropcare.db-journal").stat().st_size > 0


def test_restored_uploads_are_independent_of_incremental_backup(live, tmp_path):
    db_path, upload_dir, root = live
    backup(db_path, upload_dir, root / "b1")
    backup(db_path, upload_dir, root / "b2")  # a.jpg는 b1과 하드링크로 연결될 수 있다

    target_uploads = tmp_path / "restored" / "uploads"
    restore(root / "b2", tmp_path / "restored" / "cropcare.db", target_uploads, apply=True)
    (target_uploads / "a.jpg").write_bytes(b"edited-after-restore")

    assert (root / "b1" / "uploads" / "a.jpg").read_bytes() == b"photo-a"
    assert (root / "b2" / "uploads" / "a.jpg").read_bytes() == b"photo-a"


@pytest.fixture
def two_backup_folders(live, tmp_path):
    """같은 운영 데이터를 서로 다른 백업 폴더에 다른 시점으로 백업해 둔다. (A, B)."""
    db_path, upload_dir, _ = live
    a = tmp_path / "backups-a" / "a"
    backup(db_path, upload_dir, a)
    with closing(sqlite3.connect(str(db_path))) as conn:
        conn.execute("UPDATE marker SET value = 'second'")
        conn.commit()
    (upload_dir / "c.jpg").write_bytes(b"photo-c")
    b = tmp_path / "backups-b" / "b"
    backup(db_path, upload_dir, b)
    return a, b


def test_restores_from_different_backup_folders_never_mix_db_and_photos(live, two_backup_folders, monkeypatch):
    # 5차 리뷰: 백업 폴더만 잠그면, 다른 폴더의 백업으로 같은 운영 데이터를 복원하는 두 작업이 동시에
    # 돌아 한쪽 사진과 다른 쪽 DB가 섞였다(둘 다 성공으로 끝났다). 운영 DB·업로드도 잠근다
    db_path, upload_dir, _ = live
    a, b = two_backup_folders
    with _PausedJob(monkeypatch, "_safety_backup", lambda: restore(a, db_path, upload_dir, apply=True)) as first:
        with pytest.raises(BackupError, match="실행 중"):
            restore(b, db_path, upload_dir, apply=True)

    assert first.result["applied"] is True
    assert _read_marker(db_path) == "original"
    assert sorted(path.name for path in upload_dir.iterdir() if path.is_file()) == ["a.jpg", "b.jpg"]


def test_backup_and_restore_on_the_same_data_never_overlap_across_folders(live, two_backup_folders, monkeypatch):
    db_path, upload_dir, _ = live
    a, b = two_backup_folders
    with _PausedJob(monkeypatch, "_snapshot_db", lambda: backup(db_path, upload_dir, a.parent / "a2")):
        with pytest.raises(BackupError, match="실행 중"):
            restore(b, db_path, upload_dir, apply=True)
    with _PausedJob(monkeypatch, "_safety_backup", lambda: restore(a, db_path, upload_dir, apply=True)):
        with pytest.raises(BackupError, match="실행 중"):
            run_backup(db_path, upload_dir, b.parent / "b2", keep=0)
    assert _read_marker(db_path) == "original"


def test_restore_apply_waits_for_no_backup_on_the_same_folder(live, monkeypatch):
    # 4차 리뷰 1: 백업이 도는 동안 같은 백업 폴더의 복원은 기다리지 않고 실패한다. 미리보기는 쓰지 않으므로 된다
    db_path, upload_dir, root = live
    good = root / "good"
    backup(db_path, upload_dir, good)
    with _PausedJob(monkeypatch, "_snapshot_db", lambda: backup(db_path, upload_dir, root / "b2")):
        with pytest.raises(BackupError, match="실행 중"):
            restore(good, db_path, upload_dir, apply=True)
        assert restore(good, db_path, upload_dir, apply=False)["applied"] is False


def test_default_backup_root_follows_the_env(monkeypatch, tmp_path):
    # 도커에서는 compose가 BACKUP_ROOT로 볼륨 경로를 준다 — 이미지 안 백업은 재생성 때 사라진다
    monkeypatch.delenv(backup_db.BACKUP_ROOT_ENV, raising=False)
    assert backup_db.default_backup_root() == backup_db.BACKUP_ROOT
    monkeypatch.setenv(backup_db.BACKUP_ROOT_ENV, "  ")
    assert backup_db.default_backup_root() == backup_db.BACKUP_ROOT
    monkeypatch.setenv(backup_db.BACKUP_ROOT_ENV, str(tmp_path / "volume"))
    assert backup_db.default_backup_root() == tmp_path / "volume"


def test_backup_command_writes_under_backup_root_env(monkeypatch, tmp_path):
    db_path, upload_dir = tmp_path / "data" / "cropcare.db", tmp_path / "data" / "uploads"
    upload_dir.mkdir(parents=True)
    sqlite3.connect(db_path).close()
    root = tmp_path / "volume"
    monkeypatch.setenv(backup_db.BACKUP_ROOT_ENV, str(root))
    monkeypatch.setattr(sys, "argv", ["backup_db.py", "--database-url", f"sqlite:///{db_path}",
                                      "--upload-dir", str(upload_dir), "backup"])
    backup_db.main()
    backups = [p for p in root.iterdir() if p.is_dir()]
    assert len(backups) == 1 and (backups[0] / "manifest.json").is_file()  # 볼륨 쪽에 완료된 백업이 생겼다
