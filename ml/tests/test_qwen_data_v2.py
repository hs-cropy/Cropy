"""hs-call-v2 format, v11 conversion, speech-style rules and dataset assembly."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qwen_data"))
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
