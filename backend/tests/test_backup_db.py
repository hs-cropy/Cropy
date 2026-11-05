"""backup_db.py 테스트. 실제 sqlite 파일을 tmp_path에 만들어 검증하므로 프로젝트의
진짜 DB·업로드는 건드리지 않는다."""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
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
