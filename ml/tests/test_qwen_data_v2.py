"""hs-call-v2 format, v11 conversion, speech-style rules and dataset assembly."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qwen"))
import build_dataset_v2 as build
import spec_v2
import style


def every_call():
    for name, args, _ in spec_v2.FUNCTIONS:
        combos = [{}]
        for arg, values in args.items():
            combos = [dict(c, **{arg: v}) for c in combos for v, _ in values]
        for combo in combos:
            yield name, combo


def test_every_call_round_trips_and_uses_one_token_per_function():
    calls = list(every_call())
    assert len(calls) > 60
    for name, arguments in calls:
        text = spec_v2.format_call(name, arguments)
        assert spec_v2.parse_call(text) == (name, arguments)
        assert text.startswith(f"<hs_{spec_v2.NAMES.index(name)}>(") and text.endswith("<hs_end>")
    assert spec_v2.format_call("get_pesticide_information", {"topic": "dilution", "product": "current"}) == \
        "<hs_4>(topic=2, product=1)<hs_end>"
    assert spec_v2.format_call("chit_chat", {}) == "<hs_8>()<hs_end>"
    assert len(spec_v2.NEW_TOKENS) == len(spec_v2.FUNCTIONS) + 1


@pytest.mark.parametrize("bad", ["<hs_9>()<hs_end>", "<hs_4>(product=1, topic=2)<hs_end>", "<hs_0>(topic=8)<hs_end>",
                                 "<hs_0>(topic=0)<hs_end>", "<hs_0>(topic=1)", "답변: <hs_0>(topic=1)<hs_end>",
                                 "<hs_8>(topic=1)<hs_end>", "<hs_0>(topic=1)<hs_end><hs_end>"])
def test_parse_rejects_malformed_calls(bad):
    with pytest.raises(ValueError):
        spec_v2.parse_call(bad)


def test_v11_tokens_convert_losslessly():
    for name, arguments in every_call():
        if name == "chit_chat":
            continue
        v11 = f"<hs_{name}>" + "".join(f"<hs_{k}_{v}>" for k, v in arguments.items()) + "<hs-end>"
        assert spec_v2.from_v11(v11) == (name, arguments)
    with pytest.raises(ValueError):
        spec_v2.from_v11("<hs_get_diagnosis><hs_topic_dilution><hs-end>")


def test_docstrings_number_every_value_and_prompt_has_no_contract_json():
    prompt = spec_v2.system_prompt()
    for name, args, _ in spec_v2.FUNCTIONS:
        assert f"def {name}(" in prompt
        for values in args.values():
            for number, (_, meaning) in enumerate(values, 1):
                assert f"{number} {meaning}" in prompt
    assert '"get_diagnosis":{' not in prompt


def test_short_prompt_is_one_line_and_used_by_build_messages():
    short = spec_v2.system_prompt(short=True)
    assert "\n" not in short and "<hs_end>" in short and len(short) < len(spec_v2.system_prompt()) // 10
    messages = spec_v2.build_messages("고마워요", {"ui_stage": "no_photo"}, short=True)
    assert messages[0] == {"role": "system", "content": short}


def test_compact_context_keeps_decision_fields_only():
    context = spec_v2.compact_context({"diagnosis": {"disease_name": "무노균병", "category": "disease",
                                                     "description": "긴 설명" * 50, "crop_mismatch": False,
                                                     "recapture": {"region": "잎 뒷면", "instruction": "..."},
                                                     "current_pesticides": [{"name": "A"}, {"name": "B"}]},
                                       "ui_stage": "result"})
    assert context == {"ui_stage": "result", "crop_mismatch": False, "category": "disease", "disease_name": "무노균병",
                       "recapture": {"region": "잎 뒷면"}, "pesticides": ["A", "B"]}
    assert spec_v2.compact_context({}) == {"ui_stage": "no_photo"}


@pytest.mark.parametrize("polite,plain", [
    ("이번 분류 점수를 알려주세요", "이번 분류 점수를 알려줘"),
    ("배추 사진을 확인하고 있어요 버전 정보가 빠져 있나요", "배추 사진을 확인하고 있어 버전 정보가 빠져 있나"),
    ("점수가 가까운 건가요", "점수가 가까운 거야"),
    ("이게 뭐예요", "이게 뭐야"),
    ("물어볼게요 그 약을 어떻게 쓰나요", "물어볼게 그 약을 어떻게 쓰나"),
])
def test_banmal_rewrites_every_clause(polite, plain):
    assert style.to_banmal(polite) == plain


def test_unmatched_endings_are_skipped_not_guessed():
    assert style.to_banmal("그 약 말고 그거요") is None
    assert style.gyeongsang("병이 심한 거야") is None  # no question word
    assert style.chungcheong("알려줘") is None


def test_dialect_rules():
    assert style.chungcheong("화면을 열었어요 왜 다시 찍나요") == "화면을 열었어유 왜 다시 찍나유"
    assert style.gyeongsang("무슨 병이야") == "무슨 병이고"
    assert style.gyeongsang("약을 얼마나 타야 해") == "약을 얼마나 타야 하노"
    assert style.jeolla("확진된 거야") == "확진된 거여"


def row(case_id, split, text, function="chit_chat", arguments=None, source="seed_chit_chat"):
    return dict(case_id=case_id, split=split, source=source, group=case_id, function=function,
                arguments=arguments or {}, user_text=text, context={}, review_status="draft")


def test_assembly_keeps_spacing_variants_out_of_the_other_split():
    rows, dropped = build.assemble([
        row("a", "validation", "오늘 날씨 어때요"),
        row("b", "train", "오늘날씨 어때요"),          # spacing variant of a validation sentence
        row("c", "train", "고마워요"), row("d", "train", "고마워요"),  # exact duplicate
        row("e", "train", "배 추 정상이면 병은 없는 거네", "get_diagnosis", {"topic": "result"}, "v11"),
        row("f", "train", "배추 정상이면 병은 없는 거네", "get_diagnosis", {"topic": "result"}, "v11"),
    ])
    train = [r["user_text"] for r in rows if r["split"] == "train"]
    assert "오늘날씨 어때요" not in train and train.count("고마워요") == 1
    assert {"배 추 정상이면 병은 없는 거네", "배추 정상이면 병은 없는 거네"} <= set(train)  # STT rows kept
    assert dropped["train_text_in_validation"] >= 1 and dropped["duplicate"] >= 1
    for r in rows:
        assert spec_v2.parse_call(r["output"]) == (r["function"], r["arguments"])
        assert r["labels_human_validated"] is False
        if r["source_case_id"] == "a":  # every variant of a validation seed stays in validation
            assert r["split"] == "validation"


def test_clean_removes_punctuation_and_generator_doubled_words():
    assert build.clean("요청한 농약을 주문하는 작업을 작업을 지금 완료해주세요") == "요청한 농약을 주문하는 작업을 지금 완료해주세요"
    assert build.clean("병 이름 설명하고 예방 안내를 한 번에 해 주시겠어요?") == "병 이름 설명하고 예방 안내를 한 번에 해 주시겠어요"
    assert build.clean("됐다 됐어") == "됐다 됐어"


def test_review_applies_decisions_verdicts_and_variant_edits():
    import apply_review as review

    rows, _ = build.assemble([
        row("p", "validation", "보이는 상품이 검증됐는지 확인해 줘요", "get_pesticide_information",
            {"topic": "verification", "product": "all"}, "v12"),
        row("q", "validation", "재품 에이랑 비중 어떤게 더 효과쩌긴가요", "get_pesticide_information",
            {"topic": "comparison", "product": "all"}, "v11"),
        row("r", "validation", "주식 지금 사도 돼"),
        row("s", "train", "이 약은 몇 배로 타나요", "get_pesticide_information", {"topic": "dilution", "product": "all"}),
    ])
    for r in rows:
        r["group"] = {"p": "v12:eval-dialogue-product_review"}.get(r["source_case_id"], "g_" + r["source_case_id"])
    verdicts = [dict(group="v12:eval-dialogue-product_review", text="보이는 상품이 검증됐는지 확인해 줘요", verdict="ok", label=""),
                dict(group="g_q", text="재품 에이랑 비중 어떤게 더 효과쩌긴가요", verdict="삭제", label=""),
                dict(group="g_r", text="주식 지금 사도 돼", verdict="수정", label="handle_scope_limit(reason=action)")]
    variant = next(r for r in rows if r["source_case_id"] == "s" and r["augmentation"] == "banmal")
    variants = [dict(case_id=variant["case_id"], verdict="수정", text="이 약은 몇 배로 타?")]

    out, report = review.apply(rows, {"D1": "A", "D4": "B"}, verdicts, variants)
    by_source = {}
    for r in out:
        by_source.setdefault(r["source_case_id"], []).append(r)
    assert "q" not in by_source and report["deleted"] >= 1  # the row and its variants
    assert {r["output"] for r in by_source["p"]} == {"<hs_4>(topic=6, product=1)<hs_end>"}
    assert {r["function"] for r in by_source["r"]} == {"handle_scope_limit"}
    assert "이 약은 몇 배로 타" in [r["user_text"] for r in by_source["s"]]
    assert all(r["labels_human_validated"] == (r["split"] == "validation") for r in out)
    assert review.apply(out, {"D4": "B"}, verdicts, variants)[1] == dict(report, deleted=0, relabeled=0, retexted=0)

    with pytest.raises(ValueError):
        review.apply(rows, {"D7": "B"}, [], [])  # rule changes are not relabels
    with pytest.raises(ValueError):
        review.parse_label("handle_scope_limit(reason=weather)")


def test_eval_fixes_relabel_groups_and_add_train_only_patch(monkeypatch):
    import apply_eval_fixes as fixes

    monkeypatch.setattr(fixes, "LABEL_FIXES", {"g_v": ("<hs_2>(topic=2)<hs_end>", "get_recapture_guidance",
                                                       {"topic": "provenance"}, "test")})
    rows, _ = build.assemble([
        row("v", "validation", "재촬영 요청의 근거가 기록돼 있나요", "get_recapture_guidance", {"topic": "why"}, "v11"),
        row("w", "validation", "오늘 날씨 어때요"),
        row("t", "train", "고마워요"),
    ])
    for r in rows:
        r["group"] = "g_" + r["source_case_id"]
    patch = [row("p1", "train", "너 이름이 뭐니", source=fixes.SOURCE),
             row("p2", "train", "오늘날씨 어때요", source=fixes.SOURCE),  # spacing variant of validation
             row("p3", "train", "고마워요", source=fixes.SOURCE)]          # already in train, same label

    out, report = fixes.apply(rows, patch)
    assert {r["output"] for r in out if r["group"] == "g_v"} == {"<hs_2>(topic=4)<hs_end>"}
    added = [r for r in out if r["source"] == fixes.SOURCE]
    assert added and {r["split"] for r in added} == {"train"} and "너 이름이 뭐니" in [r["user_text"] for r in added]
    assert report["patch_dropped"]["text_in_validation"] >= 1 and report["patch_dropped"]["duplicate"] >= 1
    assert len([r for r in out if r["split"] == "validation"]) == len([r for r in rows if r["split"] == "validation"])
    again, report2 = fixes.apply(out, patch)
    assert again == out and report2 == report

    with pytest.raises(ValueError):  # same sentence with another label in train
        fixes.apply(rows, [row("p4", "train", "고마워요", "get_usage_guidance",
                               {"topic": "next_step", "delivery": "brief"}, fixes.SOURCE)])
