"""Add train rows for the patterns the 2026-11-10 real-speech test showed (v2d).

Five teammates spoke 151 questions to the deployed model (STT -> Qwen); 147 were judged. With the right text
the model was still wrong on 22 of 119. Train sentences are long and written ("화면을 보고 질문할게요 ..."),
real ones are short and spoken ("이거 왜 걸린 거야"). `real_speech_patch_seed.tsv` holds new short sentences
for those patterns:

  crop named in the question   same as the screen -> get_diagnosis(result), another supported crop ->
                               clarify_request(crop), unsupported crop -> handle_scope_limit(crop)
  short direct questions       severity meaning, causes, prevention, what to do first, where this comes from
  pesticide                    how to use, wait before harvest ("약 친 거 먹어도 돼"), ingredient with fillers
  two requests at once         clarify_request(topic)

The same sentence appears under several screens with different answers (무가 시들시들해요: 무 screen ->
diagnosis, 고추 screen -> crop check), so the answer has to come from the context, not the crop word.

The test utterances themselves are never trained on: `real_speech_eval.jsonl` stays the held-out set, and a
patch row whose text equals a test utterance (spaces ignored) is dropped. The patch was still written after
reading those errors, so the score on that set is optimistic; a new round of recordings is the clean check.

v2e (2026-11-11, after the v2d runs): a symptom named on the screen's own crop ("고추 잎에 뭐가 생겼어요") is
get_diagnosis(observation), not result (user ruling); plus rows for what v2d pulled the wrong way: pesticide
list, past records -> clarify_request(record), vague requests, and short sentences on the photo_ready screen.

Train only; validation keeps its rows so scores stay comparable. Re-running is a no-op.
"""
import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

import build_dataset_v2 as build
import spec_v2

HERE = Path(__file__).resolve().parent
DATA = HERE / "data_v2"
SOURCE = "seed_real_speech"
EVAL = HERE / "real_speech_eval.jsonl"
RESULT = {"ui_stage": "result", "crop_mismatch": False, "prediction_mode": "model", "category": "disease"}
# Like the result screens the testers used (eval_context_presets P05): one product, severity shown.
CONTEXTS = {
    "rs_gochu": {**RESULT, "selected_crop": "고추", "predicted_crop": "고추", "disease_name": "고추 탄저병",
                 "confidence": 0.91, "top_predictions": [{"name": "고추 탄저병", "confidence": 0.91},
                                                         {"name": "고추 흰가루병", "confidence": 0.05}],
                 "severity": "high", "pesticides": ["포룸디 (디메토모르프.디티아논 수화제)"]},
    "rs_mu": {**RESULT, "selected_crop": "무", "predicted_crop": "무", "disease_name": "무 노균병",
              "confidence": 0.83, "top_predictions": [{"name": "무 노균병", "confidence": 0.83},
                                                      {"name": "무 검은무늬병", "confidence": 0.11}],
              "severity": "medium", "pesticides": ["미리스타 (디메토모르프 수화제)"]},
    "rs_baechu": {**RESULT, "selected_crop": "배추", "predicted_crop": "배추", "disease_name": "배추 검은썩음병",
                  "confidence": 0.88, "top_predictions": [{"name": "배추 검은썩음병", "confidence": 0.88},
                                                          {"name": "배추 노균병", "confidence": 0.07}],
                  "severity": "low", "pesticides": ["메가폰 (가스가마이신 입상수화제)"]},
    # v2e: the first patch was result screens only and short sentences on other screens drifted with it.
    "rs_photo_gochu": {"ui_stage": "photo_ready", "selected_crop": "고추"},
    "rs_photo_mu": {"ui_stage": "photo_ready", "selected_crop": "무"},
    "rs_photo_baechu": {"ui_stage": "photo_ready", "selected_crop": "배추"},
}


def speech_text(text):
    """What the model should be given for a transcript: training text has no punctuation (v11 rule)."""
    return build.clean(re.sub(r"[？。，！、]", "", text))


def patch_rows(path):
    rows = []
    with Path(path).open(encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter="\t"), 1):
            arguments = dict(p.split("=", 1) for p in r["arguments"].split(", ")) if r["arguments"] else {}
            rows.append(dict(case_id=f"seed:real_speech:{i}", split="train", source=SOURCE,
                             group=f"seed:real_speech:{i}", function=r["function"], arguments=arguments,
                             user_text=r["utterance"], context=CONTEXTS[r["context"]],
                             review_status="draft (seed, real-speech patch)"))
    return rows


def apply(rows, patch, eval_texts):
    rows = [r for r in rows if r["source"] != SOURCE]
    report = dict(added=0, dropped=Counter(), same_text_other_answer=0)
    # assemble() keeps one row per sentence, so each screen is assembled on its own: the crop rows repeat a
    # sentence under several screens on purpose.
    by_screen = {}
    for r in patch:
        by_screen.setdefault(json.dumps(r["context"], sort_keys=True, ensure_ascii=False), []).append(r)
    new = [r for group in by_screen.values() for r in build.assemble(group)[0]]
    val_keys = {build.key(r["user_text"]) for r in rows if r["split"] == "validation"}
    eval_keys = {build.key(speech_text(t)) for t in eval_texts}
    old = {}
    for r in rows:
        if r["split"] == "train":
            old.setdefault(build.exact(r["user_text"]), set()).add(r["output"])
    seen, answers = set(), {}
    for r in new:
        text, k = build.exact(r["user_text"]), build.key(r["user_text"])
        same = (text, json.dumps(r["context"], sort_keys=True, ensure_ascii=False))
        if r["augmentation"] == "spacing" and build.stable("rs_spacing", r["case_id"]) % 3:
            report["dropped"]["spacing_thinned"] += 1  # every form of a seed gets one; a third keeps the patch near 7% of train
        elif k in val_keys:
            report["dropped"]["text_in_validation"] += 1
        elif k in eval_keys:
            report["dropped"]["text_in_real_speech_eval"] += 1
        elif same in seen or old.get(text) == {r["output"]}:
            report["dropped"]["duplicate"] += 1
        else:
            # The same words under another screen may need another answer; that is the point of the crop rows.
            report["same_text_other_answer"] += bool(old.get(text)) or text in answers and answers[text] != r["output"]
            answers.setdefault(text, r["output"])
            seen.add(same)
            rows.append(r)
            report["added"] += 1
    return rows, report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=DATA)
    p.add_argument("--patch", type=Path, default=HERE / "real_speech_patch_seed.tsv")
    a = p.parse_args()
    rows = [json.loads(l) for split in ("train", "validation")
            for l in (a.data / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]
    eval_texts = [json.loads(l)["user_text"] for l in EVAL.read_text(encoding="utf-8").splitlines()]
    rows, report = apply(rows, patch_rows(a.patch), eval_texts)
    with (a.data / "train.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            if r["split"] == "train":
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    old = json.loads((a.data / "summary.json").read_text(encoding="utf-8"))
    summary = build.summarize(rows, old["dropped"])
    summary["human_validated"] = sum(r["labels_human_validated"] for r in rows)
    summary["review"], summary["eval_fixes"] = old.get("review"), old.get("eval_fixes")
    patch = [r for r in rows if r["source"] == SOURCE]
    summary["real_speech_patch"] = dict(added=report["added"], dropped=dict(report["dropped"]),
                                        same_text_other_answer=report["same_text_other_answer"],
                                        by_function=dict(Counter(r["function"] for r in patch).most_common()),
                                        by_augmentation=dict(Counter(r["augmentation"] for r in patch).most_common()))
    (a.data / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(dict(summary["real_speech_patch"], split=summary["split"]), ensure_ascii=False))


if __name__ == "__main__":
    main()
