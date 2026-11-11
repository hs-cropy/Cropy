"""SQLite DB + 업로드 이미지 백업·복구.

project_work_report의 남은 작업 "운영 DB 백업·마이그레이션·복구 리허설"(높음) 대응.
`app.core.config`를 import하지 않고 독립 실행된다. 이 스크립트는 backend/scripts/
소유(이서하)이고 config.py는 backend/app/ 소유(박성호)라, 결합을 피하려고 같은
환경변수(DATABASE_URL, UPLOAD_DIR)를 직접 읽는다. 기본값도 core/config.py의
Settings 기본값과 맞춰뒀다.

일관성: 서비스를 멈추고 실행하는 것이 원칙이다. 실행 중에 돌리더라도 망가진 백업을
"완료"로 남기지 않도록 두 가지를 한다.
  - 백업하는 동안 원본 DB에 쓰기 잠금(BEGIN IMMEDIATE)을 잡는다. rollback 저널과 WAL
    모드 모두에서 앱은 그동안 커밋하지 못하므로 커밋 뒤의 이전 사진·복구 초안 삭제도
    일어나지 않는다. 이력 조회 같은 읽기는 막지 않는다. 잠금이 길어지면 앱의 저장이 시간
    초과(기본 5초)로 실패할 수 있다(앱은 이때 .pending 복구 초안을 남긴다).
  - 잠금은 사진·초안 *생성*은 막지 못한다. 그래서 복사가 끝난 뒤 백업 안의 DB와 초안이
    참조하는 사진이 백업에 모두 있는지 확인한다. 운영 폴더에는 있는데 백업에 없으면
    백업 도중 생긴 파일이므로 실패한다. 운영 폴더에도 없는 참조(예전부터 없던 사진)는
    manifest에 개수만 기록한다.
같은 백업 폴더나 같은 운영 DB·업로드를 쓰는 백업·보관 정리·복원(--apply)은 작업 잠금
(백업 폴더 안과 DB·업로드 폴더 옆의 .cropy-backup.lock 파일)으로 한 번에 하나만 돈다.
이미 실행 중이면 기다리지 않고 실패하므로, 정기 실행이 겹쳐도 앞 작업을 망가뜨리지 않는다.
업로드 정리(cleanup_uploads.py)와는 잠금을 공유하지 않으니 운영 절차로 겹치지 않게 한다.
완료 표시(manifest)는 백업 파일을 저장장치에 내린(fsync) 뒤 원자적으로 쓰고, 보관 정리는 그 뒤에
한다. 실제 보장은 파일시스템·저장장치에 달려 있고, 윈도에서는 폴더 항목까지는 내리지 못한다.
복원(--apply) 뒤의 운영 DB·사진은 따로 저장장치에 내리지 않는다. "applied": true는 복원 직후
전원이 끊겨도 그 상태가 남는다는 뜻이 아니므로, 입력 백업과 안전 백업을 지우지 말고 재부팅 뒤
다시 확인한다. 실행 계정은 원본을 읽을 권한 외에 백업 폴더와 DB·업로드 폴더의 부모에 잠금
파일을 만들 권한이 있어야 한다(없으면 잠금 없이 진행하지 않고 실패한다).
WAL 모드에서는 최근 커밋이 cropcare.db-wal에 있으므로 DB 파일만 복사하는 수동 백업은
쓰지 않는다(이 스크립트는 SQLite 백업 API로 WAL 내용까지 담는다).

증분 백업: 업로드 사진은 저장 후 바뀌지 않으므로, 같은 원본의 직전 완료 백업에 크기·
수정 시각이 같은 파일이 있으면 복사하지 않고 하드링크로 연결한다. 내용까지 비교하지는
않으므로 사진을 제자리에서 고치는 운영은 하지 않는다. 하드링크가 안 되면 복사한다.

보관 개수 제한: 백업이 끝난 뒤, 이 스크립트가 같은 원본(DB·업로드 경로)으로 만든 정기
백업만 최근 --keep개를 남기고 지운다. 복원 직전 안전 백업(pre_restore_*), 표시가 없는
예전 백업, 다른 원본의 백업, 링크 폴더는 지우지 않는다.

복원: 서비스를 멈춘 뒤 실행한다. 백업 구성을 먼저 검증하고, 새 DB·사진을 임시 위치에
완전히 준비·검증한 다음 교체한다. 교체 직전 현재 DB(손상돼도)와 저널 파일은 원시 파일
그대로, 사진은 전체 복사로 안전 백업에 남긴다. 교체 중 실패하면 원래 상태로 되돌리고,
되돌리지 못한 단계가 있으면 서비스를 시작하지 말라는 안내와 함께 경로를 출력한다.
교체 전까지 원래 사진·준비 사본·안전 백업이 함께 있어 사진 용량이 잠시 약 3배 든다. 미리보기가
새로 쓸 양과 남은 공간(disk_space)을 보여 주고, 모자라면 --apply는 시작하지 않고 실패한다.

지원하지 않는 구성: DB 파일이 업로드 폴더 안에 있는 경우, 링크가 들어 있는 백업.

Usage (backend 디렉터리에서):
    # 백업 (backups/<timestamp>/ 에 생성, 같은 원본의 최근 7개만 유지.
    # 환경변수 BACKUP_ROOT가 있으면 그 아래. 도커 운영은 docs/operations/BACKUP_RESTORE.md)
    python scripts/backup_db.py backup

    # 직전 백업과 연결하지 않고 전체 복사 / 보관 개수 제한 끄기
    python scripts/backup_db.py backup --full --keep 0

    # 어떤 파일이 복원될지만 보기 (기본, 아무것도 안 건드림. 백업 구성과 필요한 공간은 확인한다)
    python scripts/backup_db.py restore backups/20260928T120000Z

    # 실제 복원
    python scripts/backup_db.py restore backups/20260928T120000Z --apply
"""

import argparse
import json
import os
import shutil
import sqlite3
import stat
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

if os.name == "nt":
    import msvcrt
else:
    import fcntl

DEFAULT_DATABASE_URL = "sqlite:///./cropcare.db"
DEFAULT_UPLOAD_DIR = "./uploads"
BACKUP_ROOT = Path(__file__).resolve().parent.parent / "backups"
# 도커에서는 이미지 안(/app/backups)이 컨테이너를 다시 만들 때 사라지므로, compose가 이 변수로
# 볼륨 경로를 준다. 복원 직전 안전 백업도 복원하는 백업 옆에 생겨 같은 볼륨에 남는다
BACKUP_ROOT_ENV = "BACKUP_ROOT"
DEFAULT_KEEP = 7
# 이 스크립트가 만든 백업의 표시. 증분 기준과 보관 정리는 이 표시가 있는 폴더만 다룬다.
TOOL_NAME = "cropy-backup"
MANIFEST_FORMAT = 2
# SQLite가 DB 옆에 두는 파일. 남아 있으면 교체한 DB에 이전 내용이 적용될 수 있다.
SIDECAR_SUFFIXES = ("-journal", "-wal", "-shm")
# 앱이 DB에 쓰는 중이면 쓰기 잠금을 이 시간까지 기다린다.
LOCK_TIMEOUT_SECONDS = 10
# 백업 폴더에 두는 작업 잠금 파일. 같은 폴더의 백업·보관 정리·복원이 동시에 돌지 않게 한다.
LOCK_FILE_NAME = ".cropy-backup.lock"


class UnsupportedDatabaseUrlError(ValueError):
    """SQLite가 아닌 DATABASE_URL(운영 PostgreSQL 등)은 이 스크립트로 다루지 않는다."""


class BackupError(RuntimeError):
    """백업·복원을 시작하거나 끝낼 수 없는 상태. 아무것도 바꾸지 않았거나 되돌렸다."""


def sqlite_path_from_url(database_url: str) -> Path:
    """`sqlite:///relative.db`(상대) / `sqlite:////abs/path.db`(절대) 둘 다 처리한다.

    SQLAlchemy sqlite URL은 스킴 뒤에 항상 슬래시 3개가 오고, 그 다음이 경로다.
    경로가 `/`로 또 시작하면(총 4개) 절대경로, 아니면 상대경로다.
    """
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise UnsupportedDatabaseUrlError(
            f"SQLite URL이 아닙니다 (PostgreSQL 등은 별도 도구 필요): {database_url!r}"
        )
    return Path(database_url[len(prefix):])


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _norm(path: Path) -> str:
    return os.path.normcase(str(Path(path).resolve()))


def _is_within(path: Path, parent: Path) -> bool:
    """path가 parent 자신이거나 그 아래에 있는지. 대소문자를 무시하는 OS도 고려한다."""
    child, base = _norm(path), _norm(parent)
    return child == base or child.startswith(base.rstrip(os.sep) + os.sep)


def _overlaps(a: Path, b: Path) -> bool:
    return _is_within(a, b) or _is_within(b, a)


def _is_link(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)  # Windows 디렉터리 정션 (3.12+)
    return path.is_symlink() or bool(is_junction and is_junction())


def _parse_created_at(value) -> datetime | None:
    """시간대가 있는 ISO 8601만 받아 UTC로 바꾼다. 형식이 다르면 None."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _read_manifest(directory: Path) -> dict | None:
    """완료된 백업이면 manifest를, 아니면(작성 중·손상·다른 폴더) None을 돌려준다."""
    try:
        data = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _own_backups(backup_root: Path, db_path: Path, upload_dir: Path,
                 kinds: set[str]) -> list[tuple[int, datetime, str, Path]]:
    """같은 원본으로 이 스크립트가 만든 완료 백업을 (순번, UTC 생성 시각, 이름, 경로)로 돌려준다.

    RTC가 없는 보드는 재부팅 뒤 시계가 과거로 돌아갈 수 있어, 생성 순서는 시각이 아니라
    manifest의 순번(sequence)으로 정한다. 순번이 없는 예전 백업은 -1로 두고 시각으로만 정렬한다.
    """
    if not backup_root.is_dir():
        return []
    found = []
    for directory in backup_root.iterdir():
        if not directory.is_dir() or _is_link(directory):
            continue
        manifest = _read_manifest(directory)
        if (not manifest or manifest.get("tool") != TOOL_NAME or manifest.get("format") != MANIFEST_FORMAT
                or manifest.get("kind") not in kinds):
            continue
        if (os.path.normcase(str(manifest.get("source_db", ""))) != _norm(db_path)
                or os.path.normcase(str(manifest.get("source_uploads", ""))) != _norm(upload_dir)):
            continue  # 다른 DB·업로드의 백업 집합은 기준으로도, 정리 대상으로도 쓰지 않는다
        created = _parse_created_at(manifest.get("created_at"))
        if created is not None:
            sequence = manifest.get("sequence")
            found.append((sequence if type(sequence) is int and sequence >= 0 else -1, created, directory.name, directory))
    return found


def _next_sequence(backup_root: Path, db_path: Path, upload_dir: Path) -> int:
    existing = _own_backups(backup_root, db_path, upload_dir, {"backup", "pre_restore"})
    return max((entry[0] for entry in existing), default=-1) + 1


def find_latest_backup(backup_root: Path, db_path: Path, upload_dir: Path, exclude: Path | None = None) -> Path | None:
    """증분의 기준이 될, 같은 원본의 가장 최근 완료 백업(업로드 포함)을 찾는다.

    manifest는 백업의 마지막 단계에서 쓰므로 manifest가 없는 폴더(중간에 멈춘 백업)는
    제외된다. 예전 형식·다른 도구의 폴더도 같은 경로의 다른 내용을 담을 수 있어 제외한다.
    """
    candidates = [
        entry for entry in _own_backups(backup_root, db_path, upload_dir, {"backup", "pre_restore"})
        if (entry[3] / "uploads").is_dir() and not _is_link(entry[3] / "uploads")
        and not (exclude is not None and _norm(entry[3]) == _norm(exclude))
    ]
    return max(candidates)[3] if candidates else None


def _raise(error: OSError) -> None:
    # os.walk는 기본적으로 읽지 못한 폴더를 조용히 건너뛴다. 그러면 사진이 빠진 백업이
    # "완료"로 남으므로 즉시 실패시킨다.
    raise error


def _iter_upload_files(upload_dir: Path):
    """(상대 경로, lstat) 순회. 링크·정션·특수 파일은 따라가지도, 백업하지도 않는다."""
    for current, dirs, files in os.walk(upload_dir, followlinks=False, onerror=_raise):
        dirs[:] = [name for name in dirs if not _is_link(Path(current, name))]
        for name in files:
            path = Path(current, name)
            info = path.lstat()
            if stat.S_ISREG(info.st_mode):
                yield path.relative_to(upload_dir), info


def _count_upload_files(upload_dir: Path) -> int:
    return sum(1 for _ in _iter_upload_files(upload_dir))


def _first_link(directory: Path) -> Path | None:
    """폴더 안의 링크·정션·특수 파일 중 처음 발견한 것. 없으면 None."""
    for current, dirs, files in os.walk(directory, followlinks=False, onerror=_raise):
        for name in dirs + files:
            path = Path(current, name)
            if _is_link(path) or not (path.is_dir() or stat.S_ISREG(path.lstat().st_mode)):
                return path
    return None


def _file_key(value) -> str | None:
    """앱(diagnosis_service._file_key)·cleanup_uploads.py와 같은 규칙으로 사진 파일명을 얻는다.

    예전 기록에는 Windows 절대·상대 경로가 들어 있으므로 마지막 이름만 쓴다.
    """
    if not isinstance(value, str) or not value:
        return None
    key = PurePosixPath(value.replace("\\", "/")).name
    return key if key not in ("", ".", "..") else None


def _referenced_photos(db_file: Path, uploads: Path) -> set[str]:
    """DB의 진단 기록과 .pending 복구 초안이 참조하는 사진 파일명."""
    keys: set[str] = set()
    connection = sqlite3.connect(Path(db_file).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(diagnoses)")}
        wanted = [name for name in ("image_path", "refined_image_path") if name in columns]
        if wanted:
            for row in connection.execute(f"SELECT {', '.join(wanted)} FROM diagnoses"):
                keys.update(key for value in row if (key := _file_key(value)))
    finally:
        connection.close()
    pending = uploads / ".pending"
    if pending.is_dir():
        for draft in pending.glob("*.json"):
            try:
                fields = json.loads(draft.read_text(encoding="utf-8"))["fields"]
                values = [fields.get(name) for name in ("image_path", "refined_image_path")]
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                # cleanup_uploads.py와 같이, 읽을 수 없는 초안을 추측해서 넘기지 않는다.
                raise BackupError(f"복구 초안을 읽을 수 없습니다: {draft.name}") from exc
            keys.update(key for value in values if (key := _file_key(value)))
    return keys


def _check_references(out_dir: Path, upload_dir: Path) -> dict:
    """백업 안의 DB·초안이 참조하는 사진이 백업에 있는지 확인한다.

    운영 폴더에는 있는데 백업에 없으면 백업 도중 생긴 파일이므로 실패한다.
    """
    backup_uploads = out_dir / "uploads"
    missing = sorted(key for key in _referenced_photos(out_dir / "cropcare.db", backup_uploads)
                     if not (backup_uploads / key).is_file())
    raced = [key for key in missing if (upload_dir / key).is_file()]
    if raced:
        raise BackupError(
            f"백업하는 동안 새 사진·복구 초안이 생겨 DB와 사진의 시점이 맞지 않습니다 ({len(raced)}개, 예: {raced[0]}). "
            "서비스를 멈추고 다시 실행하세요."
        )
    return {"missing_referenced_files": len(missing), "missing_referenced_examples": missing[:20]}


def _copy_uploads(upload_dir: Path, dest: Path, base: Path | None) -> dict:
    """업로드를 복사하되, 기준 백업에 같은 파일이 있으면 하드링크로 연결한다.

    하드링크는 이전 *백업* 파일에만 건다. 운영 중인 업로드 원본에 링크하면 원본이
    수정될 때 백업까지 바뀌기 때문이다.
    """
    stats = {"upload_file_count": 0, "linked_files": 0, "copied_files": 0, "copied_bytes": 0}
    dest.mkdir(parents=True, exist_ok=True)
    for relative, info in _iter_upload_files(upload_dir):
        source, target = upload_dir / relative, dest / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        linked = False
        previous = base / relative if base is not None else None
        # 중간 폴더가 링크·정션이면 마지막 파일만 봐서는 알 수 없다. 실제 경로가 기준 백업
        # 안에 있고 운영 업로드 밖에 있을 때만 연결한다 (운영 원본에 링크하면 안 된다).
        if (previous is not None and not _is_link(previous)
                and _is_within(previous, base) and not _is_within(previous, upload_dir)):
            try:
                old = previous.lstat()
            except OSError:
                old = None
            if (old is not None and stat.S_ISREG(old.st_mode)
                    and old.st_size == info.st_size and old.st_mtime_ns == info.st_mtime_ns):
                try:
                    os.link(previous, target)
                    linked = True
                except OSError:
                    linked = False  # FAT·네트워크 드라이브 등은 하드링크를 지원하지 않는다
        if linked:
            stats["linked_files"] += 1
        else:
            shutil.copy2(source, target)
            stats["copied_files"] += 1
            stats["copied_bytes"] += info.st_size
        stats["upload_file_count"] += 1
    return stats


@contextmanager
def _writes_blocked(db_path: Path):
    """다른 연결의 쓰기를 막는 동안 실행한다. journal_mode를 돌려준다.

    BEGIN IMMEDIATE로 쓰기 잠금을 잡는다. rollback 저널·WAL 모드 모두에서 다른 연결은
    커밋하지 못하고, 읽기(이력 조회 등)는 계속된다. 읽기 잠금(BEGIN + SELECT)은 WAL에서
    쓰기를 막지 못하므로 쓰지 않는다. 잠금을 잡은 연결로 backup()을 부르면 멈추므로
    스냅샷은 _snapshot_db가 다른 연결로 뜬다.
    """
    connection = sqlite3.connect(str(db_path), isolation_level=None, timeout=LOCK_TIMEOUT_SECONDS)
    try:
        journal_mode = str(connection.execute("PRAGMA journal_mode").fetchone()[0]).lower()
        try:
            connection.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as exc:
            raise BackupError(
                f"앱이 DB에 쓰는 중이라 {LOCK_TIMEOUT_SECONDS}초 안에 잠금을 얻지 못했습니다. 잠시 후 다시 실행하세요."
            ) from exc
        yield journal_mode
    finally:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        connection.close()


def _snapshot_db(db_path: Path, target_path: Path) -> None:
    """SQLite 온라인 백업 API로 스냅샷을 뜬다. WAL에 있는 커밋된 내용도 포함된다.

    백업 API는 원본의 WAL 설정까지 복사한다. 그대로 두면 이후 읽기 전용 검사가 백업
    폴더에 -wal·-shm 파일을 남기므로, 스냅샷은 rollback 저널(DELETE)로 바꿔 파일 하나로
    둔다. 복원한 뒤 앱이 열면 다시 WAL로 바뀐다.
    """
    source = sqlite3.connect(str(db_path), timeout=LOCK_TIMEOUT_SECONDS)
    try:
        target = sqlite3.connect(str(target_path))
        try:
            source.backup(target)
            target.execute("PRAGMA journal_mode=DELETE")
        finally:
            target.close()
    finally:
        source.close()


def _check_integrity(db_path: Path) -> None:
    """구조 손상과 외래 키 위반을 모두 확인한다 (docs/SQLITE_OPERATIONS.md 복구 기준)."""
    connection = sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()[0]
        violation = connection.execute("PRAGMA foreign_key_check").fetchone()
    except sqlite3.DatabaseError as exc:
        raise BackupError(f"SQLite 파일로 읽을 수 없습니다: {db_path}") from exc
    finally:
        connection.close()
    if result != "ok":
        raise BackupError(f"DB 무결성 검사 실패 ({result}): {db_path}")
    if violation is not None:
        raise BackupError(f"DB 외래 키 위반이 있습니다 (테이블 {violation[0]}): {db_path}")


@contextmanager
def _lock_file(path: Path):
    """잠금 파일 하나에 OS 잠금을 건다. 이미 잠겨 있으면 기다리지 않고 바로 실패한다.

    OS 잠금이라 프로세스가 죽으면 저절로 풀린다(잠금 파일은 남아도 된다).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(path, "a+b")
    locked = False
    try:
        try:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError as exc:
            raise BackupError(f"같은 운영 데이터나 백업 폴더를 쓰는 다른 백업·복원이 실행 중입니다. "
                              f"끝난 뒤 다시 실행하세요 (잠금: {path})") from exc
        yield
    finally:
        if locked and os.name == "nt":
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        handle.close()


@contextmanager
def _exclusive(backup_root: Path, db_path: Path, upload_dir: Path):
    """같은 백업 폴더나 같은 운영 DB·업로드를 쓰는 백업·보관 정리·복원이 동시에 돌지 않게 한다.

    백업 폴더만 잠그면, 다른 폴더의 백업으로 같은 운영 데이터를 복원하는 두 작업이 동시에 돌아
    한쪽의 사진과 다른 쪽의 DB가 섞인다(예외 없이 끝나 되돌리기로도 잡히지 않는다). 그래서 운영
    DB와 업로드도 각각 잠근다. 복원은 업로드 폴더를 통째로 바꾸므로 잠금 파일은 폴더 옆에 둔다.
    정기 실행이 겹쳐도 기다리지 않고 바로 실패한다.
    """
    with (_lock_file(backup_root / LOCK_FILE_NAME),
          _lock_file(db_path.parent / f".{db_path.name}{LOCK_FILE_NAME}"),
          _lock_file(upload_dir.parent / f".{upload_dir.name}{LOCK_FILE_NAME}")):
        yield


def _fsync(path: Path) -> None:
    """파일이나 폴더 항목을 저장장치에 내린다. 폴더는 POSIX에서만 열 수 있어 그 밖에서는 건너뛴다."""
    if path.is_dir():
        if os.name == "nt":
            return
        fd = os.open(path, os.O_RDONLY)
    else:
        # 윈도에서는 쓰기 권한으로 연 핸들만 디스크에 내릴 수 있다
        fd = os.open(path, (os.O_RDWR | os.O_BINARY) if os.name == "nt" else os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _sync_tree(root: Path) -> None:
    """완료 표시를 쓰기 전에 백업 안의 파일과 폴더를 모두 저장장치에 내린다.

    복사가 끝났다고 디스크에 기록된 것은 아니다. 내리지 않은 채 보관 정리로 이전 백업을 지우고
    전원이 끊기면 새 백업과 이전 백업을 함께 잃을 수 있다. 실제 보장은 파일시스템에 달려 있다.
    """
    for directory, _, files in os.walk(root):
        for name in files:
            _fsync(Path(directory) / name)
        _fsync(Path(directory))


def _write_manifest(directory: Path, manifest: dict) -> None:
    """완료 표시를 남긴다. 임시 이름에 쓰고 저장장치에 내린 뒤 이름을 바꿔, 반쯤 쓴 manifest가 남지 않게 한다."""
    temporary = directory / f".manifest-{uuid4().hex}.tmp"
    try:
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        _fsync(temporary)
        os.replace(temporary, directory / "manifest.json")
    finally:
        temporary.unlink(missing_ok=True)
    _fsync(directory)
    _fsync(directory.parent)


def backup(db_path: Path, upload_dir: Path, out_dir: Path, *, incremental: bool = True) -> dict:
    """DB와 업로드 디렉터리를 out_dir 아래로 백업하고 manifest를 반환한다.

    DB와 업로드 폴더가 모두 있어야 한다. 원본이 없으면 아무것도 만들지 않고 실패한다.
    manifest는 모든 복사가 끝나고 저장장치에 내린 뒤 마지막에 쓴다. 중간에 실패하면 만든 폴더를 지운다.
    같은 백업 폴더(out_dir의 부모)나 같은 운영 DB·업로드를 쓰는 다른 작업과는 동시에 돌지 않는다.
    """
    db_path, upload_dir, out_dir = _check_backup_paths(db_path, upload_dir, out_dir)
    with _exclusive(out_dir.parent, db_path, upload_dir):
        return _backup(db_path, upload_dir, out_dir, incremental=incremental)


def _check_backup_paths(db_path: Path, upload_dir: Path, out_dir: Path) -> tuple[Path, Path, Path]:
    """원본과 출력 경로를 검사해 절대 경로로 돌려준다.

    작업 잠금은 백업 폴더에 잠금 파일을 만들므로, 잘못된 설정(예: 업로드 폴더 안의 백업 폴더)에서
    아무것도 만들지 않도록 잠금보다 먼저 검사한다.
    """
    db_path, upload_dir, out_dir = Path(db_path).resolve(), Path(upload_dir).resolve(), Path(out_dir).resolve()
    if not db_path.is_file():
        raise BackupError(f"DB 파일이 없습니다. DATABASE_URL을 확인하세요: {db_path}")
    if not upload_dir.is_dir():
        raise BackupError(f"업로드 폴더가 없습니다. UPLOAD_DIR을 확인하세요: {upload_dir}")
    if _is_within(db_path, upload_dir):
        raise BackupError("DB 파일이 업로드 폴더 안에 있는 구성은 지원하지 않습니다")
    if _overlaps(out_dir, upload_dir) or _is_within(db_path, out_dir):
        raise BackupError("백업 폴더는 DB·업로드 폴더와 겹치지 않는 곳이어야 합니다")
    return db_path, upload_dir, out_dir


def _backup(db_path: Path, upload_dir: Path, out_dir: Path, *, incremental: bool) -> dict:
    db_path, upload_dir, out_dir = _check_backup_paths(db_path, upload_dir, out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f"이미 내용이 있는 폴더에는 백업하지 않습니다: {out_dir}")

    base = find_latest_backup(out_dir.parent, db_path, upload_dir, exclude=out_dir) if incremental else None
    created_new = not out_dir.exists()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict = {
        "tool": TOOL_NAME,
        "format": MANIFEST_FORMAT,
        "kind": "backup",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_db": str(db_path),
        "source_uploads": str(upload_dir),
        "db_backed_up": True,
        "base_backup": base.name if base else None,
        "sequence": _next_sequence(out_dir.parent, db_path, upload_dir),
    }
    try:
        with _writes_blocked(db_path) as journal_mode:
            manifest["journal_mode"] = journal_mode
            _snapshot_db(db_path, out_dir / "cropcare.db")
            manifest.update(_copy_uploads(upload_dir, out_dir / "uploads", base / "uploads" if base else None))
            manifest.update(_check_references(out_dir, upload_dir))
        # 복원 검증에서 거부될 백업을 "완료"로 남기면, 보관 정리가 그 백업을 근거로 정상 백업을
        # 지운다. 잠금을 푼 뒤(앱 쓰기를 오래 막지 않도록) 스냅샷을 복원과 같은 기준으로 검사한다.
        _check_integrity(out_dir / "cropcare.db")
        _sync_tree(out_dir)
        _write_manifest(out_dir, manifest)
    except BaseException:
        # 작업 잠금 안이라 out_dir에는 이번 실행이 쓴 것만 있다
        if created_new:
            shutil.rmtree(out_dir, ignore_errors=True)
        else:
            for child in out_dir.iterdir():
                shutil.rmtree(child) if child.is_dir() else child.unlink()
        raise
    return manifest


def prune_backups(backup_root: Path, keep: int, db_path: Path, upload_dir: Path,
                  protect: Path | None = None) -> list[Path]:
    """같은 원본의 정기 백업 중 최근 keep개만 남기고 지운다. 지운 폴더 목록을 반환한다.

    keep이 0이면 아무것도 지우지 않는다. 표시 없는 폴더, 안전 백업, 다른 원본의 백업,
    생성 시각을 해석할 수 없는 폴더, 링크 폴더는 대상이 아니다. 하드링크로 연결된
    파일은 다른 백업에 링크가 남아 있으면 지워도 데이터가 사라지지 않는다.
    """
    if keep < 0:
        raise ValueError("keep must be zero or positive")
    if keep == 0:
        return []
    ours = sorted(_own_backups(backup_root, Path(db_path).resolve(), Path(upload_dir).resolve(), {"backup"}),
                  reverse=True)
    removed = []
    for *_, directory in ours[keep:]:
        if protect is not None and _norm(directory) == _norm(protect):
            continue  # 방금 만든 백업은 어떤 경우에도 남긴다
        shutil.rmtree(directory)
        removed.append(directory)
    return removed


def run_backup(db_path: Path, upload_dir: Path, out_dir: Path, keep: int, incremental: bool = True):
    """백업이 끝까지 성공했을 때만 보관 정리를 한다. (manifest, 지운 폴더 목록).

    백업과 보관 정리를 한 작업 잠금 안에서 한다. 사이에 다른 작업이 끼어들면 그 작업이 증분
    기준으로 쓰는 백업을 정리가 지울 수 있다.
    """
    db_path, upload_dir, out_dir = _check_backup_paths(db_path, upload_dir, out_dir)
    backup_root = out_dir.parent
    with _exclusive(backup_root, db_path, upload_dir):
        manifest = _backup(db_path, upload_dir, out_dir, incremental=incremental)
        removed = prune_backups(backup_root, keep, db_path, upload_dir, protect=out_dir)
    return manifest, removed


def _validate_backup(backup_dir: Path) -> dict:
    """복원 전에 백업 구성을 검증한다. 하나라도 빠지면 아무것도 바꾸지 않고 실패한다."""
    if not (backup_dir / "manifest.json").exists():
        raise FileNotFoundError(f"백업 디렉터리가 아닙니다 (manifest.json 없음): {backup_dir}")
    manifest = _read_manifest(backup_dir)
    if manifest is None:
        raise BackupError(f"manifest.json을 읽을 수 없습니다: {backup_dir}")
    if manifest.get("db_backed_up") is not True or not (backup_dir / "cropcare.db").is_file():
        raise BackupError("백업에 DB가 없습니다. 서로 다른 시점의 DB·사진이 섞이지 않도록 복원하지 않습니다")
    uploads = backup_dir / "uploads"
    if not uploads.is_dir() or _is_link(uploads):
        raise BackupError("백업에 업로드 폴더가 없습니다. DB만 복원하지 않습니다")
    link = _first_link(uploads)
    if link is not None:
        # 복원하면 링크가 운영 업로드 폴더 밖의 파일을 가리키게 된다.
        raise BackupError(f"백업에 링크·특수 파일이 있어 복원하지 않습니다: {link}")
    expected = manifest.get("upload_file_count")
    actual = _count_upload_files(uploads)
    if type(expected) is not int or expected != actual:
        raise BackupError(f"백업의 사진 수가 manifest와 다릅니다 (기록 {expected}, 실제 {actual})")
    # 안전 백업에는 강제 종료로 남은 rollback 저널(-journal)이 함께 있을 수 있다. 원본 백업을 그대로
    # 열면 SQLite가 저널을 되돌리려다 읽기 전용 오류로 실패하므로, 복원과 같이 저널을 반영한 사본을 검사한다
    with tempfile.TemporaryDirectory(prefix="cropy-restore-check-") as scratch:
        checked = Path(scratch) / "cropcare.db"
        try:
            _materialize_db(backup_dir / "cropcare.db", checked)
        except sqlite3.DatabaseError as exc:
            raise BackupError(f"백업 DB를 SQLite 파일로 읽을 수 없습니다: {backup_dir / 'cropcare.db'}") from exc
        _check_integrity(checked)
    return manifest


def _materialize_db(source: Path, target: Path) -> None:
    """백업 DB를 저널(-wal·-journal)까지 반영한 독립 파일 하나로 target에 만든다.

    DB 본체만 복사하면 안전 백업의 -wal에만 있는 커밋이 빠진 채 무결성 검사를 통과한다.
    백업 폴더를 열면 체크포인트가 백업 자체를 바꾸므로, 사본에서 저널을 반영한다.
    -shm은 SQLite가 -wal로 다시 만들므로 복사하지 않는다.
    """
    copies = [target.with_name(target.name + suffix) for suffix in ("-wal", "-journal")]
    try:
        shutil.copy2(source, target)
        for copy, suffix in zip(copies, ("-wal", "-journal")):
            sidecar = source.with_name(source.name + suffix)
            if sidecar.exists():
                shutil.copy2(sidecar, copy)
        connection = sqlite3.connect(str(target))
        try:
            connection.execute("PRAGMA journal_mode=DELETE")  # WAL은 체크포인트, 남은 rollback 저널은 되돌림
        finally:
            connection.close()
        leftover = _sidecars(target)
        if leftover:
            raise BackupError(f"백업 DB의 저널을 반영하지 못했습니다: {leftover[0].name}")
    except BaseException:
        for path in (target, *copies, target.with_name(target.name + "-shm")):
            path.unlink(missing_ok=True)
        raise


def _sidecars(db_path: Path) -> list[Path]:
    return [db_path.with_name(db_path.name + suffix) for suffix in SIDECAR_SUFFIXES
            if db_path.with_name(db_path.name + suffix).exists()]


def _safety_backup(db_path: Path, upload_dir: Path, safety_dir: Path) -> None:
    """복원 직전 상태를 비어 있는 safety_dir에 독립 사본으로 남긴다.

    DB가 손상돼도 읽지 않고 원시 파일 그대로 보존한다. 폴더 생성은 호출자가 한다.
    """
    manifest = {
        "tool": TOOL_NAME, "format": MANIFEST_FORMAT, "kind": "pre_restore", "raw_copy": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_db": str(db_path), "source_uploads": str(upload_dir),
        "db_backed_up": db_path.is_file(), "sidecars": [], "linked_files": 0,
        "sequence": _next_sequence(safety_dir.parent, db_path, upload_dir),
    }
    if db_path.is_file():
        shutil.copy2(db_path, safety_dir / "cropcare.db")
    for sidecar in _sidecars(db_path):
        # DB를 cropcare.db로 저장하므로 저널도 같은 이름에 맞춘다. 원래 이름(예: app.db-wal)으로
        # 두면 SQLite가 이 DB의 저널로 인식하지 못해 WAL에만 있는 커밋이 복원에서 빠진다.
        name = "cropcare.db" + sidecar.name[len(db_path.name):]
        shutil.copy2(sidecar, safety_dir / name)
        manifest["sidecars"].append(name)
    if upload_dir.is_dir():
        manifest.update(_copy_uploads(upload_dir, safety_dir / "uploads", None))
    else:
        manifest["upload_file_count"] = 0
        manifest["warning_uploads_missing"] = True
    # 이 안전 백업만 믿고 운영 데이터를 교체하므로, 교체 전에 저장장치에 내린다
    _sync_tree(safety_dir)
    _write_manifest(safety_dir, manifest)


def _tree_bytes(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).lstat().st_size
            except FileNotFoundError:
                pass
    return total


def _existing_ancestor(path: Path) -> Path:
    while not path.exists() and path.parent != path:
        path = path.parent
    return path


def _disk_space(backup_dir: Path, db_path: Path, upload_dir: Path, safety_parent: Path) -> list[dict]:
    """복원(--apply)이 새로 쓰는 양을 파일시스템별로 모아 남은 공간과 비교한다.

    교체 전까지 원래 사진·준비한 사본·안전 백업이 함께 있어 사진 용량이 잠시 약 3배 든다.
    새로 쓰는 것은 준비 사본(백업의 DB·저널·사진)과 안전 백업(현재 DB·저널·사진)이다.
    파일 크기의 합이라 블록 단위 낭비를 빼므로 실제로 필요한 양보다 작거나 같다 — 이보다 남은 공간이
    적으면 복원은 중간에 실패할 가능성이 크다. 남은 공간(disk_usage().free)은 root용 예약 공간을 뺀
    값이라 root로 실행하면 실제로는 될 수도 있지만, 운영 디스크를 끝까지 채우지 않도록 안전한 쪽으로 거절한다.
    """
    def db_bytes(path: Path) -> int:
        # 안전 백업으로 되돌릴 때는 저널(-wal·-journal)도 함께 있고, 준비 사본은 저널을 반영한 DB다
        return sum(item.stat().st_size for item in [path, *_sidecars(path)] if item.is_file())

    current_db = db_bytes(db_path)
    writes = [
        (db_path.parent, db_bytes(backup_dir / "cropcare.db")),
        (upload_dir.parent, _tree_bytes(backup_dir / "uploads")),
        (safety_parent, current_db + (_tree_bytes(upload_dir) if upload_dir.is_dir() else 0)),
    ]
    by_device: dict[int, dict] = {}
    for target, size in writes:
        probe = _existing_ancestor(target)
        entry = by_device.setdefault(probe.stat().st_dev, {"path": str(probe), "needed_bytes": 0})
        entry["needed_bytes"] += size
    for entry in by_device.values():
        entry["free_bytes"] = shutil.disk_usage(entry["path"]).free
        entry["enough"] = entry["free_bytes"] >= entry["needed_bytes"]
    return list(by_device.values())


def _space_shortage(plan: dict) -> str | None:
    short = [entry for entry in plan.get("disk_space", []) if not entry["enough"]]
    if not short:
        return None
    return "; ".join(
        f"{entry['path']}에 {entry['needed_bytes'] / 2**20:.1f}MB가 필요한데 {entry['free_bytes'] / 2**20:.1f}MB만 남았습니다"
        for entry in short)


def restore(backup_dir: Path, db_path: Path, upload_dir: Path, apply: bool) -> dict:
    """backup_dir의 내용을 db_path·upload_dir로 복원한다. 서비스를 멈춘 뒤 실행한다.

    apply=False(기본)면 백업 구성만 검증하고 계획을 반환한다 — 아무것도 바꾸지 않는다.
    apply=True면 ① 새 DB·사진을 임시 위치에 준비·검증 ② 현재 상태를 안전 백업 ③ 교체
    순서로 진행하고, 교체 중 실패하면 원래 DB·사진·저널 파일을 되돌린다.
    교체와 되돌리기는 모두 운영 DB·업로드와 같은 폴더 안의 이름 변경이다.
    apply=True면 안전 백업을 두는 백업 폴더나 같은 운영 DB·업로드를 쓰는 다른 작업과 동시에 돌지 않는다.
    """
    # 미리보기(쓰기 없음)로 먼저 검증해, 잘못된 구성이면 잠금 파일도 만들지 않는다
    plan = _restore(backup_dir, db_path, upload_dir, apply=False)
    if not apply:
        return plan
    with _exclusive(Path(backup_dir).resolve().parent, Path(db_path).resolve(), Path(upload_dir).resolve()):
        return _restore(backup_dir, db_path, upload_dir, apply=True)


def _restore(backup_dir: Path, db_path: Path, upload_dir: Path, apply: bool) -> dict:
    backup_dir, db_path, upload_dir = Path(backup_dir).resolve(), Path(db_path).resolve(), Path(upload_dir).resolve()
    if _is_within(db_path, upload_dir):
        raise BackupError("DB 파일이 업로드 폴더 안에 있는 구성은 지원하지 않습니다")
    manifest = _validate_backup(backup_dir)
    # 이름이 겹치면 다른 복원의 안전 백업이나 복원 입력을 건드릴 수 있으므로 고유 이름을 쓴다.
    token = f"{_timestamp()}-{uuid4().hex[:8]}"
    safety_dir = backup_dir.parent / f"pre_restore_{token}"
    if (_overlaps(backup_dir, upload_dir) or _is_within(db_path, backup_dir)
            or _overlaps(safety_dir, upload_dir) or _is_within(db_path, safety_dir)
            or _overlaps(safety_dir, backup_dir)):
        raise BackupError("백업·안전 백업 폴더가 운영 DB·업로드 폴더나 서로와 겹쳐 복원하지 않습니다")

    plan = {
        "backup_dir": str(backup_dir),
        "backup_created_at": manifest.get("created_at"),
        "will_restore_db": True,
        "will_restore_uploads": True,
        "upload_file_count": manifest["upload_file_count"],
        "disk_space": _disk_space(backup_dir, db_path, upload_dir, safety_dir.parent),
        "applied": False,
    }
    if not apply:
        return plan
    shortage = _space_shortage(plan)
    if shortage:
        # 공간이 모자라면 준비나 안전 백업 중에 실패한다. 데이터는 안전하지만 시간만 쓰므로 시작하지 않는다
        raise BackupError(f"복원할 공간이 부족해 시작하지 않습니다: {shortage}")

    staged_db = db_path.with_name(f".restore-{token}-{db_path.name}")
    staged_uploads = upload_dir.with_name(f".restore-{token}-{upload_dir.name}")
    previous_uploads = upload_dir.with_name(f".pre-restore-{token}-{upload_dir.name}")
    for path in (staged_db, staged_uploads, previous_uploads, safety_dir):
        if path.exists():
            raise BackupError(f"임시 경로가 이미 있습니다: {path}")

    # ① 준비: 실패해도 운영 데이터는 그대로다.
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        upload_dir.parent.mkdir(parents=True, exist_ok=True)
        _materialize_db(backup_dir / "cropcare.db", staged_db)
        _check_integrity(staged_db)
        shutil.copytree(backup_dir / "uploads", staged_uploads, symlinks=True)
        if _count_upload_files(staged_uploads) != manifest["upload_file_count"]:
            raise BackupError("임시 위치로 복사한 사진 수가 백업과 다릅니다")
    except BaseException:
        staged_db.unlink(missing_ok=True)
        shutil.rmtree(staged_uploads, ignore_errors=True)
        raise

    # ② 안전 백업: 이번 실행이 배타적으로 만든 폴더에만 쓰고, 실패하면 그 폴더만 지운다.
    try:
        safety_dir.mkdir(parents=False, exist_ok=False)
    except BaseException:
        staged_db.unlink(missing_ok=True)
        shutil.rmtree(staged_uploads, ignore_errors=True)
        raise
    try:
        _safety_backup(db_path, upload_dir, safety_dir)
    except BaseException:
        staged_db.unlink(missing_ok=True)
        shutil.rmtree(staged_uploads, ignore_errors=True)
        shutil.rmtree(safety_dir, ignore_errors=True)
        raise
    plan["safety_backup_dir"] = str(safety_dir)

    # ③ 교체: 운영 DB·업로드와 같은 폴더 안의 이름 변경이라 각 단계가 원자적이고 되돌릴 수 있다.
    done: list[tuple[Path, Path]] = []
    moved_sidecars: list[Path] = []
    try:
        if upload_dir.exists():
            os.replace(upload_dir, previous_uploads)
            done.append((upload_dir, previous_uploads))
        os.replace(staged_uploads, upload_dir)
        done.append((staged_uploads, upload_dir))
        for sidecar in _sidecars(db_path):
            # 남겨 두면 이전 저널이 새 DB에 적용될 수 있다. DB와 같은 폴더로 옮겨(다른 볼륨으로
            # 옮기지 않는다) 되돌릴 수 있게 하고, 성공하면 지운다. 안전 백업에 사본이 있다.
            moved = sidecar.with_name(f".restore-{token}-{sidecar.name}")
            os.replace(sidecar, moved)
            done.append((sidecar, moved))
            moved_sidecars.append(moved)
        os.replace(staged_db, db_path)
    except BaseException as failure:
        # 한 단계가 실패해도 나머지는 계속 되돌린다. 되돌리지 못한 경로는 모아서 알린다.
        unrecovered = []
        for original, moved in reversed(done):
            try:
                os.replace(moved, original)
            except OSError as exc:
                unrecovered.append(f"{moved} → {original} ({exc})")
        staged_db.unlink(missing_ok=True)
        # staged_uploads 경로에는 준비한 사본만 있거나(되돌리기 성공) 아무것도 없다(실패).
        shutil.rmtree(staged_uploads, ignore_errors=True)
        if unrecovered:
            raise BackupError(
                "복원이 실패했고 일부를 원래대로 되돌리지 못했습니다. 서비스를 시작하지 말고 "
                f"안전 백업({safety_dir})으로 수동 복구하세요. 되돌리지 못한 항목: " + "; ".join(unrecovered)
            ) from failure
        raise
    for moved in moved_sidecars:
        moved.unlink(missing_ok=True)
    shutil.rmtree(previous_uploads, ignore_errors=True)  # 안전 백업에 전체 사본이 있다
    plan["applied"] = True
    return plan


def default_backup_root() -> Path:
    """--out이 없을 때 백업을 만들 폴더. 환경변수 BACKUP_ROOT가 있으면 그 경로를 쓴다."""
    configured = os.environ.get(BACKUP_ROOT_ENV, "").strip()
    return Path(configured) if configured else BACKUP_ROOT


def _non_negative_int(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("0 이상의 정수여야 합니다")
    return number


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--upload-dir", default=os.environ.get("UPLOAD_DIR", DEFAULT_UPLOAD_DIR))

    sub = parser.add_subparsers(dest="command", required=True)

    backup_parser = sub.add_parser("backup", help="현재 DB·업로드를 백업한다")
    backup_parser.add_argument("--out", type=Path, default=None, help=f"기본: {default_backup_root()}/<타임스탬프> (환경변수 {BACKUP_ROOT_ENV}로 바꿈)")
    backup_parser.add_argument("--full", action="store_true", help="직전 백업과 연결하지 않고 전체 복사한다")
    backup_parser.add_argument("--keep", type=_non_negative_int, default=DEFAULT_KEEP,
                               help=f"같은 원본의 최근 N개 정기 백업만 남긴다 (기본 {DEFAULT_KEEP}, 0이면 지우지 않음)")

    restore_parser = sub.add_parser("restore", help="백업으로부터 복원한다 (기본은 미리보기)")
    restore_parser.add_argument("backup_dir", type=Path)
    restore_parser.add_argument("--apply", action="store_true", help="명시해야 실제로 덮어쓴다")

    return parser


def main() -> None:
    args = _build_parser().parse_args()
    db_path = sqlite_path_from_url(args.database_url)
    upload_dir = Path(args.upload_dir)

    try:
        if args.command == "backup":
            out_dir = args.out or (default_backup_root() / _timestamp())
            manifest, removed = run_backup(db_path, upload_dir, out_dir, args.keep, incremental=not args.full)
            print(f"백업 완료: {out_dir}")
            print(json.dumps(manifest, ensure_ascii=False, indent=2))
            if manifest.get("warning"):
                print(f"경고: {manifest['warning']}", file=sys.stderr)
            for path in removed:
                print(f"보관 개수({args.keep}개) 초과로 삭제: {path}")

        elif args.command == "restore":
            plan = restore(args.backup_dir, db_path, upload_dir, apply=args.apply)
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            shortage = _space_shortage(plan)
            if shortage and not args.apply:
                print(f"경고: 복원할 공간이 부족합니다. --apply는 시작하지 않고 실패합니다. {shortage}", file=sys.stderr)
            if not args.apply:
                print("\n미리보기입니다. 서비스를 멈춘 뒤 --apply를 추가하면 복원합니다.")
    except (BackupError, FileExistsError, FileNotFoundError, sqlite3.Error, OSError) as exc:
        sys.exit(f"{args.command} 실패 ({type(exc).__name__}): {exc}")


if __name__ == "__main__":
    main()
