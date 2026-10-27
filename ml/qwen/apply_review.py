"""Apply the human review in 검수표_v2.xlsx back onto data_v2.

  1_결정필요  a non-A choice relabels the rows of that decision's groups (DECISION_EFFECTS)
  2_검증셋    삭제 drops the representative row and its variants, 수정 relabels them ('함수(인자=값, ...)')
  3_변형      삭제 drops the variant, 수정 replaces its text
Validation rows of every reviewed group get labels_human_validated=true. Re-running is a no-op.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import build_dataset_v2 as build
import build_review_sheet
import spec_v2

DATA = Path(__file__).resolve().parent / "data_v2"
DECISION_GROUPS = {code: groups for code, *_, groups in build_review_sheet.DECISIONS}
# (decision, choice) -> label patch for the rows of that decision's groups. Choices that change
# seeds or rules (D5~D8 B/C) are not relabels, so they stop the script instead.
DECISION_EFFECTS = {
    ("D1", "B"): ("get_prediction_metrics", {"topic": "limits"}),
    ("D1", "C"): ("get_recapture_guidance", {"topic": "certainty"}),
    ("D4", "B"): ("get_pesticide_information", {"product": "current"}),
}
REVIEWED = "human reviewed (검수표_v2)"


def parse_label(text):
    """'get_pesticide_information(topic=verification, product=current)' -> (function, arguments)."""
    match = re.fullmatch(r"\s*(\w+)\((.*)\)\s*", text or "")
    if not match:
        raise ValueError(f"수정 정답은 함수(인자=값) 형태여야 합니다: {text!r}")
    arguments = dict(pair.split("=", 1) for pair in re.split(r",\s*", match.group(2)) if pair)
    arguments = {k.strip(): v.strip() for k, v in arguments.items()}
    spec_v2.format_call(match.group(1), arguments)  # validates names and values
    return match.group(1), arguments


def relabel(row, function, arguments):
    if function == row["function"]:
        arguments = {**row["arguments"], **arguments}
    return dict(row, function=function, arguments=arguments, output=spec_v2.format_call(function, arguments))


def apply(rows, decisions, verdicts, variants):
    """rows: dataset rows; decisions: {code: choice}; verdicts: [{group, text, verdict, label}];
    variants: [{case_id, verdict, text}]. Returns (rows, report)."""
    report = dict(decisions={c: v for c, v in decisions.items() if v != "A"}, deleted=0, relabeled=0, retexted=0)
    by_id = {r["case_id"]: r for r in rows}
    drop, patch = set(), {}  # case_id -> (function, arguments)

    for code, choice in decisions.items():
        if choice in ("A", "", None):
            continue
        if (code, choice) not in DECISION_EFFECTS:
            raise ValueError(f"{code}={choice}는 라벨 변경이 아니라 규칙·시드 수정이 필요합니다")
        for r in rows:
            if r["group"] in DECISION_GROUPS[code]:
                patch[r["case_id"]] = DECISION_EFFECTS[code, choice]

    for v in verdicts:
        if v["verdict"] in ("ok", "", None):
            continue
        reps = [r for r in rows if r["split"] == "validation" and r["group"] == v["group"]
                and r["augmentation"] == "original" and r["user_text"] == v["text"]]
        lineage = {r["case_id"] for r in rows if any(r["source_case_id"] == rep["case_id"] for rep in reps)}
        if v["verdict"] == "삭제":
            drop |= lineage
        elif v["verdict"] == "수정":
            label = parse_label(v["label"])
            patch.update(dict.fromkeys(lineage, label))
        else:
            raise ValueError(f"알 수 없는 판정 {v['verdict']!r} ({v['text']})")

    texts = {}
    for v in variants:
        if v["verdict"] == "삭제":
            drop.add(v["case_id"])
        elif v["verdict"] == "수정":
            texts[v["case_id"]] = build.clean(v["text"])
        elif v["verdict"] not in ("ok", "", None):
            raise ValueError(f"알 수 없는 판정 {v['verdict']!r} ({v['case_id']})")

    reviewed_groups = {v["group"] for v in verdicts if v["verdict"]}
    out = []
    for r in rows:
        if r["case_id"] in drop:
            report["deleted"] += 1
            continue
        if r["case_id"] in patch:
            new = relabel(r, *patch[r["case_id"]])
            report["relabeled"] += new["output"] != r["output"]
            r = new
        if r["case_id"] in texts and texts[r["case_id"]] != r["user_text"]:
            r = dict(r, user_text=texts[r["case_id"]])
            report["retexted"] += 1
        if r["split"] == "validation" and r["group"] in reviewed_groups:
            r = dict(r, labels_human_validated=True, review_status=REVIEWED)
        out.append(r)
    missing = set(texts) - set(by_id)
    if missing:
        raise ValueError(f"데이터에 없는 변형 case_id: {sorted(missing)[:5]}")
    return out, report


def read_sheet(path):
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True)

    def table(name):
        rows = list(wb[name].iter_rows(values_only=True))
        return [dict(zip(rows[0], r)) for r in rows[1:] if any(c is not None for c in r)]

    def norm(value):
        return (value or "").strip() if isinstance(value, str) or value is None else str(value)

    decisions = {r["ID"]: norm(r["결정(A/B/C)"]).upper() for r in table("1_결정필요")}
    verdicts = [dict(group=r["그룹"], text=r["발화(대표)"], verdict=norm(r["판정"]), label=norm(r["수정 정답"]))
                for r in table("2_검증셋")]
    variants = [dict(case_id=r["case_id"], verdict=norm(r["판정"]), text=norm(r["수정 문장"]))
                for r in table("3_변형")]
    return decisions, verdicts, variants


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=DATA)
    p.add_argument("--sheet", type=Path, default=None)
    a = p.parse_args()
    decisions, verdicts, variants = read_sheet(a.sheet or a.data / "검수표_v2.xlsx")
    rows = [json.loads(l) for split in ("train", "validation")
            for l in (a.data / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]
    rows, report = apply(rows, decisions, verdicts, variants)
    for split in ("train", "validation"):
        with (a.data / f"{split}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for r in rows:
                if r["split"] == split:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
    old = json.loads((a.data / "summary.json").read_text(encoding="utf-8"))
    summary = build.summarize(rows, old["dropped"])
    summary["human_validated"] = sum(r["labels_human_validated"] for r in rows)
    summary["review"] = dict(decisions=report["decisions"],
                             validation=dict(Counter(v["verdict"] for v in verdicts if v["verdict"])),
                             variants=dict(Counter(v["verdict"] for v in variants if v["verdict"])))
    (a.data / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(dict(report, human_validated=summary["human_validated"], split=summary["split"]),
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
