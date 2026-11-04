"""SQLite DB + 업로드 이미지 백업·복구.

project_work_report의 남은 작업 "운영 DB 백업·마이그레이션·복구 리허설"(높음) 대응.
`app.core.config`를 import하지 않고 독립 실행된다. 이 스크립트는 backend/scripts/
소유(이서하)이고 config.py는 backend/app/ 소유(박성호)라, 결합을 피하려고 같은
환경변수(DATABASE_URL, UPLOAD_DIR)를 직접 읽는다. 기본값도 core/config.py의
Settings 기본값과 맞춰뒀다.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path


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
