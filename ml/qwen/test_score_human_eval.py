import csv
import json
import tempfile
import unittest
from pathlib import Path

from score_human_eval import read_gold, read_predictions, score


class ScoreHumanEvalTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_review_status_and_excluded_rows(self):
        path = self.root / "gold.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.writer(file)
            writer.writerow([
                "eval_id", "작성자", "의도한 함수", "인자", "검수결과(ok/수정/삭제)"
            ])
            writer.writerows([
                ["A", "테스트", "clarify_request", "target=product", "OK"],
                ["B", "테스트", "clarify_request", "target=product", " Ok "],
                ["C", "테스트", "clarify_request", "target=product", ""],
                ["EX01", "예시", "clarify_request", "target=product", "ok"],
            ])

        gold, excluded = read_gold(path)
        self.assertEqual(set(gold), {"A", "B"})
        self.assertEqual(excluded, 2)

    def test_out_of_scope_output_is_counted_and_duplicates_fail(self):
        path = self.root / "predictions.jsonl"
        output = "<hs_5>(target=7)<hs_end>"
        gold = {"A": ("clarify_request", {"target": "product"})}
        rows = [
            {"eval_id": "A", "output": output},
            {"eval_id": "EX01", "output": output},
        ]
        path.write_text("\n".join(map(json.dumps, rows)), encoding="utf-8")
        predictions, ignored = read_predictions(path, gold)
        self.assertEqual(predictions, {"A": output})
        self.assertEqual(ignored, 1)

        for duplicate in rows:
            with self.subTest(duplicate=duplicate["eval_id"]):
                path.write_text(
                    "\n".join(map(json.dumps, [*rows, duplicate])), encoding="utf-8"
                )
                with self.assertRaises(ValueError):
                    read_predictions(path, gold)

    def test_failure_types_and_accuracy_denominator(self):
        expected = ("clarify_request", {"target": "product"})
        gold = dict.fromkeys(["correct", "missing", "invalid", "function", "arguments"], expected)
        result = score(gold, {
            "correct": "<hs_5>(target=7)<hs_end>",
            "invalid": "not a call",
            "function": "<hs_8>()<hs_end>",
            "arguments": "<hs_5>(target=8)<hs_end>",
        })

        self.assertEqual(result["total"], 5)
        self.assertAlmostEqual(result["function_accuracy"], 0.4)
        self.assertAlmostEqual(result["exact_accuracy"], 0.2)
        self.assertEqual(result["failures"], {
            "missing": "missing_output",
            "invalid": "invalid_output",
            "function": "wrong_function",
            "arguments": "wrong_arguments",
        })


if __name__ == "__main__":
    unittest.main()
