"""Preview or remove old upload files that no diagnosis references."""

import argparse
import math
from pathlib import Path
import stat
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.entities import Diagnosis
from app.services.diagnosis_service import _file_key


def _age_hours(value: str) -> float:
    hours = float(value)
    if not math.isfinite(hours) or hours < 0:
        raise argparse.ArgumentTypeError("minimum age must be a finite, nonnegative number")
    return hours


def _old_direct_file(path: Path, root: Path, cutoff: float) -> bool:
    try:
        info = path.lstat()
        return (
            stat.S_ISREG(info.st_mode)
            and not path.is_symlink()
            and path.resolve(strict=True).parent == root
            and info.st_mtime < cutoff
        )
    except FileNotFoundError:
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Preview old unreferenced uploads; preserve every referenced diagnosis image.",
        epilog=(
            "Examples (from backend/):\n"
            "  python scripts/cleanup_uploads.py\n"
            "  python scripts/cleanup_uploads.py --min-age-hours 72\n"
            "  python scripts/cleanup_uploads.py --apply --min-age-hours 72\n"
            "Run --apply during maintenance after reviewing the dry run. "
            "This command never removes diagnosis rows or files inside subdirectories."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--apply", action="store_true", help="delete listed orphans (default: dry run)")
    parser.add_argument(
        "--min-age-hours", type=_age_hours, default=24.0,
        help="only consider files older than this many hours (default: 24)",
    )
    args = parser.parse_args(argv)
    root = settings.upload_dir.resolve(strict=True)
    if not root.is_dir():
        parser.error(f"upload directory is not a directory: {root}")

    # Only SELECT the path columns. Do not migrate, seed or modify the database.
    with SessionLocal() as db:
        referenced = {
            key.casefold()
            for row in db.query(Diagnosis.image_path, Diagnosis.refined_image_path).yield_per(500)
            for value in row
            if (key := _file_key(value))
        }
    cutoff = time.time() - args.min_age_hours * 3600
    candidates = [
        path for path in sorted(root.iterdir())
        if path.name.casefold() not in referenced and _old_direct_file(path, root, cutoff)
    ]
    print(f"{'Apply' if args.apply else 'Dry run'}: {len(candidates)} orphan upload(s) in {root}")
    for path in candidates:
        # Recheck scope, type and age immediately before unlink. unlink never
        # follows a subsequently substituted symlink and is never recursive.
        if args.apply:
            if not _old_direct_file(path, root, cutoff):
                continue
            path.unlink(missing_ok=True)
            print(f"Deleted: {path}")
        else:
            print(f"Would delete: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
