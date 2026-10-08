"""Upload maintenance never deletes referenced, young, nested or linked files."""

import os
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.entities import Diagnosis, Disease


@pytest.fixture
def cleanup_store(tmp_path, monkeypatch):
    from scripts import cleanup_uploads

    root = tmp_path / "uploads"
    root.mkdir()
    engine = create_engine(f"sqlite:///{tmp_path / 'history.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)
    monkeypatch.setattr(cleanup_uploads.settings, "upload_dir", root)
    monkeypatch.setattr(cleanup_uploads, "SessionLocal", session)
    with session() as db:
        db.add(Disease(id=1, name="Test disease", crop_type="Test crop", model_class_id=0))
        db.add(Diagnosis(
            id="protected-history", disease_id=1, confidence=0.8,
            image_path=r"C:\old-device\uploads\ORIGINAL.jpg",
            refined_image_path="/old-linux-device/uploads/refined.png",
        ))
        db.commit()
    yield cleanup_uploads, root, session
    engine.dispose()


def _file(root, name, age_hours=48):
    path = root / name
    path.write_bytes(b"saved upload")
    old = time.time() - age_hours * 3600
    os.utime(path, (old, old))
    return path


def test_default_dry_run_lists_only_old_unreferenced_direct_files(cleanup_store, capsys):
    cleanup, root, session = cleanup_store
    orphan = _file(root, "orphan.jpg")
    _file(root, "original.jpg")
    _file(root, "refined.png")
    _file(root, "young.jpg", age_hours=1)
    nested = root / "nested"
    nested.mkdir()
    _file(nested, "nested-orphan.jpg")

    assert cleanup.main([]) == 0
    output = capsys.readouterr().out
    assert "dry run" in output.lower()
    assert str(orphan.resolve()) in output
    assert "original.jpg" not in output
    assert "refined.png" not in output
    assert "young.jpg" not in output
    assert "nested-orphan.jpg" not in output
    assert orphan.read_bytes() == b"saved upload"
    with session() as db:
        assert db.query(Diagnosis).one().image_path == r"C:\old-device\uploads\ORIGINAL.jpg"


def test_explicit_apply_removes_old_orphans_and_preserves_other_files(cleanup_store, capsys):
    cleanup, root, session = cleanup_store
    orphan = _file(root, "orphan.jpg")
    original = _file(root, "original.jpg")
    refined = _file(root, "refined.png")
    young = _file(root, "young.jpg", age_hours=1)
    assert cleanup.main(["--apply"]) == 0
    assert not orphan.exists()
    assert original.is_file() and refined.is_file() and young.is_file()
    assert "deleted" in capsys.readouterr().out.lower()
    with session() as db:
        assert db.query(Diagnosis).count() == 1


def test_age_threshold_is_configurable(cleanup_store):
    cleanup, root, _ = cleanup_store
    old = _file(root, "old.jpg", age_hours=3)
    young = _file(root, "young.jpg", age_hours=1)
    assert cleanup.main(["--apply", "--min-age-hours", "2"]) == 0
    assert not old.exists()
    assert young.exists()


@pytest.mark.parametrize("age", ["-1", "nan", "inf"])
def test_invalid_age_cannot_disable_cleanup_safety(cleanup_store, age):
    cleanup, root, _ = cleanup_store
    orphan = _file(root, "orphan.jpg")
    with pytest.raises(SystemExit) as error:
        cleanup.main(["--apply", "--min-age-hours", age])
    assert error.value.code == 2
    assert orphan.exists()


def test_symbolic_links_are_skipped_even_when_target_is_old(cleanup_store, tmp_path, capsys):
    cleanup, root, _ = cleanup_store
    outside = _file(tmp_path, "outside.jpg")
    link = root / "linked.jpg"
    try:
        link.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"Symlinks unavailable on this host: {exc}")
    assert cleanup.main(["--apply"]) == 0
    assert link.is_symlink()
    assert outside.read_bytes() == b"saved upload"
    assert "linked.jpg" not in capsys.readouterr().out


def test_help_describes_preview_and_apply_without_querying_database(capsys):
    from scripts import cleanup_uploads

    with pytest.raises(SystemExit) as error:
        cleanup_uploads.main(["--help"])
    assert error.value.code == 0
    output = capsys.readouterr().out
    assert "--apply" in output and "--min-age-hours" in output
    assert "python scripts/cleanup_uploads.py" in output
