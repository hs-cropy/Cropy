"""Apply the fixes found by the first training run's validation errors (2026-11-02, v2_r16_e2).

  LABEL_FIXES         validation groups whose label contradicted the function spec or the train data
  train_patch_seed.tsv train-only rows for patterns train did not cover (assistant identity chit-chat,
                      crop mismatch, result provenance, score meaning, recapture certainty, step-by-step retry)
Validation keeps its rows, so scores stay comparable with the first run. Re-running is a no-op.
"""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import build_dataset_v2 as build
import spec_v2

HERE = Path(__file__).resolve().parent
DATA = HERE / "data_v2"
SOURCE = "seed_train_patch"
FIXED = "human reviewed (검수표_v2), label fixed after v2_r16_e2 eval"
# group -> (current output, new function, new arguments, reason)
LABEL_FIXES = {
    "v11:G_V5_R_103": ("<hs_2>(topic=2)<hs_end>", "get_recapture_guidance", {"topic": "provenance"},
                       "'재촬영 요청의 근거' is topic provenance (재촬영 안내가 나온 근거), not why"),
    "v11:G_V5_R_115": ("<hs_2>(topic=2)<hs_end>", "get_recapture_guidance", {"topic": "provenance"},
                       "same as G_V5_R_103"),
    "v11:G_V5_R_127": ("<hs_2>(topic=2)<hs_end>", "get_recapture_guidance", {"topic": "provenance"},
                       "same as G_V5_R_103"),
    "v11:G_V5_D_105": ("<hs_0>(topic=1)<hs_end>", "get_prediction_metrics", {"topic": "ranking"},
                       "'가장 높게 나온 후보' is ranking in train (46 rows)"),
    "v11:G_V5_D_126": ("<hs_0>(topic=1)<hs_end>", "get_prediction_metrics", {"topic": "ranking"},
                       "same as G_V5_D_105"),
}
RESULT = {"ui_stage": "result", "crop_mismatch": False, "prediction_mode": "model", "category": "disease"}
CONTEXTS = {
    **build.PRESET_CONTEXTS,
    "result_model": {**RESULT, "selected_crop": "배추", "predicted_crop": "배추", "disease_name": "배추 노균병",
                     "confidence": 0.86},
    "result_legacy": {**RESULT, "selected_crop": "무", "predicted_crop": "무", "prediction_mode": "legacy",
                      "disease_name": "무 검은무늬병", "confidence": 0.55},
    "result_normal": {**RESULT, "selected_crop": "고추", "predicted_crop": "고추", "category": "normal",
                      "disease_name": "고추 정상", "confidence": 0.95},
    "result_low": {**RESULT, "selected_crop": "무", "predicted_crop": "무", "disease_name": "무 노균병",
                   "confidence": 0.41, "decision_status": "low_confidence"},
    "result_confusion": {**RESULT, "selected_crop": "무", "predicted_crop": "무", "disease_name": "무 노균병",
                         "confidence": 0.51, "decision_status": "confusion",
                         "top_predictions": [{"name": "무 노균병", "confidence": 0.51},
                                             {"name": "무 검은무늬병", "confidence": 0.46}],
                         "recapture": {"region": "잎 뒷면"}},
    "mismatch": {**RESULT, "selected_crop": "고추", "predicted_crop": "무", "crop_mismatch": True,
                 "disease_name": "무 검은무늬병", "confidence": 0.72, "decision_status": "crop_mismatch"},
    "mismatch_recapture": {**RESULT, "selected_crop": "고추", "predicted_crop": "무", "crop_mismatch": True,
                           "disease_name": "무 노균병", "confidence": 0.58, "decision_status": "crop_mismatch",
                           "recapture": {"region": "잎 뒷면"}},
    "disease_only": {"ui_stage": "result", "category": "disease", "disease_name": "무 검은무늬병"},
}


def patch_rows(path):
    rows = []
    with Path(path).open(encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter="\t"), 1):
            arguments = dict(p.split("=", 1) for p in r["arguments"].split(", ")) if r["arguments"] else {}
            rows.append(dict(case_id=f"seed:train_patch:{i}", split="train", source=SOURCE,
                             group=f"seed:train_patch:{i}", function=r["function"], arguments=arguments,
                             user_text=r["utterance"], context=CONTEXTS[r["context"]],
                             review_status="draft (seed, eval patch)"))
    return rows


def apply(rows, patch):
    """rows: dataset rows; patch: raw patch seed rows. Returns (rows, report)."""
    rows = [r for r in rows if r["source"] != SOURCE]
    report = dict(relabeled=Counter(), patch_added=0, patch_dropped=Counter())
    out = []
    for r in rows:
        fix = LABEL_FIXES.get(r["group"])
        if fix and r["output"] == fix[0]:
            r = dict(r, function=fix[1], arguments=fix[2], output=spec_v2.format_call(fix[1], fix[2]),
                     review_status=FIXED if r["split"] == "validation" else r["review_status"])
        out.append(r)
    for r in out:  # counted on the result so a re-run reports the same numbers
        if r["group"] in LABEL_FIXES and r["output"] == spec_v2.format_call(*LABEL_FIXES[r["group"]][1:3]):
            report["relabeled"][r["group"]] += 1
    stale = set(LABEL_FIXES) - set(report["relabeled"])
    if stale:
        raise ValueError(f"고칠 그룹이 데이터에 없습니다: {sorted(stale)}")

    # Same leakage and duplicate rules as build_dataset_v2.assemble, against the rows already there.
    new, _ = build.assemble(patch)
    val_keys = {build.key(r["user_text"]) for r in out if r["split"] == "validation"}
    labels = {build.exact(r["user_text"]): r["output"] for r in out if r["split"] == "train"}
    for r in new:
        text = build.exact(r["user_text"])
        if build.key(r["user_text"]) in val_keys:
            report["patch_dropped"]["text_in_validation"] += 1
        elif text in labels:
            if labels[text] != r["output"]:
                raise ValueError(f"train에 같은 문장, 다른 정답: {r['user_text']} {labels[text]} vs {r['output']}")
            report["patch_dropped"]["duplicate"] += 1
        else:
            labels[text] = r["output"]
            out.append(r)
            report["patch_added"] += 1
    return out, report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=DATA)
    p.add_argument("--patch", type=Path, default=HERE / "train_patch_seed.tsv")
    a = p.parse_args()
    rows = [json.loads(l) for split in ("train", "validation")
            for l in (a.data / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]
    rows, report = apply(rows, patch_rows(a.patch))
    for split in ("train", "validation"):
        with (a.data / f"{split}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for r in rows:
                if r["split"] == split:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
    old = json.loads((a.data / "summary.json").read_text(encoding="utf-8"))
    summary = build.summarize(rows, old["dropped"])
    summary["human_validated"] = sum(r["labels_human_validated"] for r in rows)
    summary["review"] = old.get("review")
    summary["eval_fixes"] = dict(relabeled=dict(report["relabeled"]), patch_added=report["patch_added"],
                                 patch_dropped=dict(report["patch_dropped"]))
    (a.data / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(dict(summary["eval_fixes"], split=summary["split"]), ensure_ascii=False))


if __name__ == "__main__":
    main()
