"""SQLite DB + 업로드 이미지 백업·복구.

project_work_report의 남은 작업 "운영 DB 백업·마이그레이션·복구 리허설"(높음) 대응.
`app.core.config`를 import하지 않고 독립 실행된다. 이 스크립트는 backend/scripts/
소유(이서하)이고 config.py는 backend/app/ 소유(박성호)라, 결합을 피하려고 같은
환경변수(DATABASE_URL, UPLOAD_DIR)를 직접 읽는다. 기본값도 core/config.py의
Settings 기본값과 맞춰뒀다.

일관성: 서비스를 멈추고 실행하는 것이 원칙이다. 실행 중에 돌리더라도 망가진 백업을
"완료"로 남기지 않도록 다음을 한다.
  - 백업하는 동안 원본 DB에 쓰기 잠금(BEGIN IMMEDIATE)을 잡는다. rollback 저널과 WAL
    모드 모두에서 앱은 그동안 커밋하지 못하므로 커밋 뒤의 이전 사진·복구 초안 삭제도
    일어나지 않는다. 이력 조회 같은 읽기는 막지 않는다. 잠금이 길어지면 앱의 저장이 시간
    초과(기본 5초)로 실패할 수 있다(앱은 이때 .pending 복구 초안을 남긴다).
WAL 모드에서는 최근 커밋이 cropcare.db-wal에 있으므로 DB 파일만 복사하는 수동 백업은
쓰지 않는다(이 스크립트는 SQLite 백업 API로 WAL 내용까지 담는다).
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

# 앱이 DB에 쓰는 중이면 쓰기 잠금을 이 시간까지 기다린다.
LOCK_TIMEOUT_SECONDS = 10


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
