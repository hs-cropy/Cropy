"""Score Qwen predictions against reviewed human evaluation rows."""

import argparse
import csv
import json
from pathlib import Path

from spec_v2 import format_call, parse_call


def read_gold(path):
    gold = {}
    excluded_count = 0
    with path.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file, strict=True):
            if row["작성자"].strip() == "예시" or row["검수결과(ok/수정/삭제)"].strip().lower() != "ok":
                excluded_count += 1
                continue
            key = row["eval_id"].strip()
            if not key or key in gold:
                raise ValueError(f"비어 있거나 중복된 평가 ID: {key!r}")
            arguments = {}
            for pair in row["인자"].split(",") if row["인자"].strip() else ():
                name, _, value = (part.strip() for part in pair.partition("="))
                if not name or not value or name in arguments:
                    raise ValueError(f"{key}: 잘못되거나 중복된 정답 인자: {pair!r}")
                arguments[name] = value
            gold[key] = parse_call(format_call(row["의도한 함수"].strip(), arguments))
    if not gold:
        raise ValueError("채점할 검수 완료(ok) 행이 없습니다.")
    return gold, excluded_count


def read_predictions(path, gold):
    predictions = {}
    seen = set()
    ignored_count = 0
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        item = json.loads(line)
        if not isinstance(item, dict) or not isinstance(item.get("eval_id"), str) or not isinstance(item.get("output"), str):
            raise ValueError(f"출력 {number}행: eval_id와 output은 문자열이어야 합니다.")
        key = item["eval_id"].strip()
        if not key or key in seen:
            raise ValueError(f"출력 {number}행: 비어 있거나 중복된 ID: {key!r}")
        seen.add(key)
        if key not in gold:
            ignored_count += 1
            continue
        predictions[key] = item["output"]
    return predictions, ignored_count


def score(gold, predictions):
    function_correct = exact_correct = 0
    failures = {}
    for key, expected in gold.items():
        if key not in predictions:
            failures[key] = "missing_output"
            continue
        try:
            actual = parse_call(predictions[key])
        except ValueError:
            failures[key] = "invalid_output"
            continue
        if actual[0] != expected[0]:
            failures[key] = "wrong_function"
            continue
        function_correct += 1
        if actual == expected:
            exact_correct += 1
        else:
            failures[key] = "wrong_arguments"

    total = len(gold)
    return {
        "total": total,
        "function_accuracy": function_correct / total,
        "exact_accuracy": exact_correct / total,
        "failure_counts": {
            reason: list(failures.values()).count(reason)
            for reason in ("missing_output", "invalid_output", "wrong_function", "wrong_arguments")
        },
        "failures": failures,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gold_csv", type=Path)
    parser.add_argument("predictions_jsonl", type=Path)
    args = parser.parse_args()
    try:
        gold, excluded_count = read_gold(args.gold_csv)
        predictions, ignored_count = read_predictions(args.predictions_jsonl, gold)
    except (OSError, ValueError, TypeError, AttributeError, KeyError, csv.Error) as error:
        parser.exit(1, f"채점 실패: {error}\n")
    result = score(gold, predictions)
    result["excluded_gold_row_count"] = excluded_count
    result["ignored_output_count"] = ignored_count
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
