"""Build the hs-call-v2 training set from v11, the v12 usage draft and new seeds.

Sources (all keep their own split; seeds split 80/20 by seed so variants never cross):
  v11      03/04/02 sheets of Cropy_Qwen35_기능별400_검수대기_v11.xlsx, active singleton rows
  usage    inputs/usage_v12.jsonl (v12 draft, single-turn rows only)
  seeds    usage_seed.tsv (get_usage_guidance), chitchat_seed.tsv (chit_chat)
Augmentation (same split and group as the source row, marked for human review):
  banmal   존칭 -> 반말 ending rewrite
  dialect  jeolla / gyeongsang endings, plus a sampled share of chungcheong 요 -> 유
  spacing  STT-like spacing noise, seeds only (v11 already has STT rows)
Every row keeps labels_human_validated=false: nothing here is human approved.
"""
import argparse
import csv
import hashlib
import json
import random
import re
from collections import Counter
from pathlib import Path

import spec_v2
import style

HERE = Path(__file__).resolve().parent
CHUNGCHEONG_SHARE = 0.12  # rule is too broad to apply to every 존칭 row
SEED_VAL_SHARE = 0.2
# Neutral states for rows whose label does not depend on the screen (chit-chat).
PRESET_CONTEXTS = {
    "no_photo": {"ui_stage": "no_photo"},
    "photo_ready": {"ui_stage": "photo_ready"},
    "analyzing": {"ui_stage": "analyzing"},
    "error": {"ui_stage": "error"},
    "result": {"ui_stage": "result", "selected_crop": "고추", "predicted_crop": "고추", "crop_mismatch": False,
               "prediction_mode": "model", "category": "disease", "disease_name": "고추 탄저병",
               "confidence": 0.91, "pesticides": ["포룸디 (디메토모르프.디티아논 수화제)"]},
}


def stable(*parts):
    return int(hashlib.sha256("\0".join(map(str, parts)).encode()).hexdigest()[:12], 16)


def load_v11(path):
    import openpyxl  # only needed for this source
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    def table(name):
        rows = list(wb[name].iter_rows(values_only=True))
        header = [(h or "").split("(")[-1].rstrip(")") for h in rows[4]]
        return [dict(zip(header, r)) for r in rows[5:] if any(r)]
    contexts = {r["context_id"]: json.loads(r["context_json"]) for r in table("02_근거컨텍스트") if r["context_id"]}
    splits = {r["conversation_id"]: r for r in table("04_검수분할")}
    rows = []
    for r in table("03_대화데이터"):
        if r["record_type"] != "data" or r["phase"] != "singleton":
            continue
        meta = splits[r["conversation_id"]]
        function, arguments = spec_v2.from_v11(r["llm_output"])
        rows.append(dict(case_id=f"v11:{r['conversation_id']}:{r['turn_index']}", split=meta["split"], source="v11",
                         group=f"v11:{meta['scenario_group_id']}", function=function, arguments=arguments,
                         user_text=r["user_text"], context=contexts.get(r["context_id"], {}),
                         review_status=f"{meta['review_status']} by {meta['reviewer']}"))
    return rows


def load_usage(path):
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        rows.append(dict(case_id=f"v12:{r['case_id']}", split=r["split"], source="v12_usage", group=f"v12:{r['group']}",
                         function=r["function"], arguments=r["arguments"], user_text=r["user_text"],
                         context=r["context"], review_status="draft (v12 synthetic)"))
    return rows


def load_seeds(path, function):
    rows = []
    with Path(path).open(encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter="\t"), 1):
            if function == "chit_chat":
                arguments, stage = {}, sorted(PRESET_CONTEXTS)[stable("ctx", r["utterance"]) % len(PRESET_CONTEXTS)]
            else:
                arguments, stage = {"topic": r["topic"], "delivery": r["delivery"]}, r["ui_stage"]
            split = "validation" if stable("split", r["utterance"]) % 100 < SEED_VAL_SHARE * 100 else "train"
            rows.append(dict(case_id=f"seed:{function}:{i}", split=split, source=f"seed_{function}",
                             group=f"seed:{function}:{i}", function=function, arguments=arguments,
                             user_text=r["utterance"], context=PRESET_CONTEXTS[stage], review_status="draft (seed)"))
    return rows


def spacing_noise(text, key):
    """Drop or insert one space, like STT segmentation errors (deterministic)."""
    rng = random.Random(stable("space", key))
    spaces = [i for i, ch in enumerate(text) if ch == " "]
    if spaces and rng.random() < 0.5:
        i = rng.choice(spaces)
        return text[:i] + text[i + 1:]
    inner = [i for i in range(1, len(text)) if text[i - 1] != " " and text[i] != " "]
    if not inner:
        return None
    i = rng.choice(inner)
    return text[:i] + " " + text[i:]


def augment(row):
    out = []
    text = row["user_text"]
    banmal = style.to_banmal(text) if style.is_honorific(text) else None
    if banmal and banmal != text:
        out.append(("banmal", banmal))
    for dialect, variant in style.dialect_variants(text):
        if dialect == "chungcheong" and stable("cc", row["case_id"]) % 100 >= CHUNGCHEONG_SHARE * 100:
            continue
        out.append((f"dialect_{dialect}", variant))
    if row["source"].startswith("seed_"):
        for base in [text] + [v for _, v in out]:
            if noisy := spacing_noise(base, row["case_id"] + base):
                out.append(("spacing", noisy))
    return [dict(row, case_id=f"{row['case_id']}#{kind}{n}", user_text=variant, augmentation=kind,
                 source_case_id=row["case_id"], review_status="draft (augmented)")
            for n, (kind, variant) in enumerate(out)]


def key(text):
    """Leakage key: spacing variants of one sentence must stay in one split."""
    return re.sub(r"\s", "", text)


def exact(text):
    """Duplicate key: spacing variants are intended STT rows, so only collapse repeated spaces."""
    return re.sub(r"\s+", " ", text.strip())


def assemble(base_rows):
    """Augment, attach v2 outputs, drop duplicates, and keep validation texts out of train."""
    rows = []
    for row in base_rows:
        rows.append(dict(row, augmentation="original", source_case_id=row["case_id"]))
        rows.extend(augment(row))
    val_keys = {key(r["user_text"]) for r in rows if r["split"] == "validation"}
    seen, kept, dropped = set(), [], Counter()
    for r in rows:
        k = (r["split"], exact(r["user_text"]))
        if k in seen:
            dropped["duplicate"] += 1
            continue
        if r["split"] == "train" and key(r["user_text"]) in val_keys:
            dropped["train_text_in_validation"] += 1
            continue
        seen.add(k)
        output = spec_v2.format_call(r["function"], r["arguments"])
        assert spec_v2.parse_call(output) == (r["function"], r["arguments"])
        kept.append(dict(r, output=output, context=spec_v2.compact_context(r["context"]),
                         labels_human_validated=False))
    return kept, dropped


def summarize(rows, dropped):
    def by(field, split=None):
        return dict(Counter(r[field] for r in rows if split is None or r["split"] == split).most_common())
    honorific = sum(style.is_honorific(r["user_text"]) for r in rows)
    return dict(format="hs-call-v2", new_tokens=spec_v2.NEW_TOKENS, rows=len(rows),
                split=by("split"), train_function=by("function", "train"),
                validation_function=by("function", "validation"), source=by("source"),
                augmentation=by("augmentation"), honorific_share=round(honorific / len(rows), 3),
                dropped=dict(dropped), system_prompt_chars=len(spec_v2.system_prompt()),
                human_validated=0)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--v11", type=Path, default=Path("마음ai/Qwen35_데이터시트/Cropy_Qwen35_기능별400_검수대기_v11.xlsx"))
    p.add_argument("--usage", type=Path, default=HERE / "inputs/usage_v12.jsonl")
    p.add_argument("--out", type=Path, default=Path("마음ai/Qwen35_데이터시트/v2_호출형식"))
    p.add_argument("--review-sample", type=int, default=300)
    a = p.parse_args()
    base = (load_v11(a.v11) + load_usage(a.usage) + load_seeds(HERE / "usage_seed.tsv", "get_usage_guidance")
            + load_seeds(HERE / "chitchat_seed.tsv", "chit_chat"))
    rows, dropped = assemble(base)
    a.out.mkdir(parents=True, exist_ok=True)
    for split in ("train", "validation"):
        with (a.out / f"{split}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for r in rows:
                if r["split"] == split:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
    summary = summarize(rows, dropped)
    (a.out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (a.out / "system_prompt.txt").write_text(spec_v2.system_prompt(), encoding="utf-8")
    # Human check of generated text: every augmentation kind, deterministic sample.
    augmented = sorted((r for r in rows if r["augmentation"] != "original"), key=lambda r: stable("review", r["case_id"]))
    originals = {r["case_id"]: r["user_text"] for r in rows if r["augmentation"] == "original"}
    with (a.out / "review_sample.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["case_id", "augmentation", "원문", "변형", "function", "arguments", "output", "판정(ok/수정/삭제)", "메모"])
        for r in augmented[:a.review_sample]:
            w.writerow([r["case_id"], r["augmentation"], originals.get(r["source_case_id"], ""), r["user_text"],
                        r["function"], json.dumps(r["arguments"], ensure_ascii=False), r["output"], "", ""])
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
