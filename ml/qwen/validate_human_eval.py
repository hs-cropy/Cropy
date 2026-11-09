"""Validate the format of human evaluation rows against the v2 contract."""

import argparse
import csv
import json
from pathlib import Path

from spec_v2 import format_call

HERE = Path(__file__).resolve().parent
REQUIRED = ("eval_id", "작성자", "context_preset", "발화", "의도한 함수", "인자")


def parse_arguments(value):
    arguments = {}
    for item in value.split(",") if value.strip() else ():
        key, sep, argument = (part.strip() for part in item.partition("="))
        if not sep or not key or not argument or key in arguments:
            raise ValueError(f"잘못되거나 중복된 인자: {item.strip()!r}")
        arguments[key] = argument
    return arguments


def validate(path, presets):
    seen = set()
    count = 0
    errors = []
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source, strict=True)
        if not rows.fieldnames or not set(REQUIRED).issubset(rows.fieldnames):
            raise ValueError("평가 CSV에 필요한 열이 없습니다.")
        if len(rows.fieldnames) != len(set(rows.fieldnames)):
            raise ValueError("평가 CSV에 중복된 열 이름이 있습니다.")

        for row in rows:
            count += 1
            try:
                if None in row or None in row.values():
                    raise ValueError("CSV 열 개수가 헤더와 다릅니다.")
                for column in REQUIRED[:-1]:
                    if not row[column].strip():
                        raise ValueError(f"빈 필수 값: {column}")

                eval_id = row["eval_id"].strip()
                if eval_id in seen:
                    raise ValueError(f"중복 eval_id: {eval_id}")
                seen.add(eval_id)

                preset = row["context_preset"].strip()
                if preset not in presets:
                    raise ValueError(f"등록되지 않은 화면 상태: {preset}")
                format_call(row["의도한 함수"].strip(), parse_arguments(row["인자"]))
            except ValueError as error:
                errors.append(f"{rows.line_num}행: {error}")
    return count, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", nargs="?", type=Path, default=HERE / "eval_human_template.csv")
    options = parser.parse_args()
    try:
        presets = json.loads((HERE / "eval_context_presets.json").read_text(encoding="utf-8-sig"))
        count, errors = validate(options.csv_path, presets)
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f"{error}\n")

    if errors:
        parser.exit(1, "\n".join(errors) + "\n")
    print(f"형식 검증 통과: {count}행 (예시 포함)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
