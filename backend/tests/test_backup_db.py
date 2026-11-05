"""backup_db.py 테스트. 실제 sqlite 파일을 tmp_path에 만들어 검증하므로 프로젝트의
진짜 DB·업로드는 건드리지 않는다."""

import json
from pathlib import Path

import pytest

from scripts import backup_db
from scripts.backup_db import (
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
