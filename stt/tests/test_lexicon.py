"""용어 보정 테스트 — 실제 SenseVoice가 틀리게 적은 문장(2026-11-05 PC 비교 실험)을 쓴다."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lexicon import Lexicon, load_terms, to_jamo  # noqa: E402

TERMS = load_terms(Path(__file__).resolve().parents[1] / "terms.txt")


@pytest.fixture(scope="module")
def lexicon():
    return Lexicon(TERMS)


def test_to_jamo_splits_syllables_and_keeps_other_characters():
    assert to_jamo("탄저병") == "ㅌㅏㄴㅈㅓㅂㅕㅇ"
    assert to_jamo("값 2개?") == "ㄱㅏㅂㅅ 2ㄱㅐ?"


@pytest.mark.parametrize(
    ("heard", "expected"),
    [
        ("이곳 탄접병 맞 아요.", "이곳 탄저병 맞 아요."),
        ("배추 무음병 에 쓸 약 알려 줘.", "배추 무름병 에 쓸 약 알려 줘."),
        ("농약휘석 배 수가 얼마 예요.", "농약희석 배 수가 얼마 예요."),
        ("고추 역병이랑 탄젖 병이 어떻게 달라요?", "고추 역병이랑 탄저병이 어떻게 달라요?"),
        ("배추 검은썩 은병 예 방하 는 법 알려 줘.", "배추 검은썩음병 예 방하 는 법 알려 줘."),
        ("이곳 한접병 맞아요.", "이곳 탄저병 맞아요."),
        ("수학 며칠 전 까지 약 칠 수 있 어요.", "수확 며칠 전 까지 약 칠 수 있 어요."),
    ],
)
def test_misheard_terms_are_corrected(lexicon, heard, expected):
    text, corrections = lexicon.correct(heard)
    assert text == expected
    assert corrections


@pytest.mark.parametrize(
    "text",
    [
        "다시 찍어 볼까요?",
        "고마워 오늘은 여기까지.",
        "방금 진단 결과 다시 말해 줘.",
        "농약 희석 배수가 얼마예요",  # 배수가 배추로 바뀌면 안 된다
        "확률 이 몇 퍼센트로 나왔어요.",
        "고추 잎에 갈색 반점이 생겼어요",
    ],
)
def test_correct_sentences_are_left_unchanged(lexicon, text):
    assert lexicon.correct(text) == (text, [])


def test_correction_reports_what_was_heard(lexicon):
    _, corrections = lexicon.correct("고추 역병이랑 탄젖 병이")
    assert [(c.heard, c.term) for c in corrections] == [("탄젖 병", "탄저병")]


def test_far_words_are_not_forced_into_terms(lexicon):
    # 두 글자 용어는 자모 하나 차이까지만 고친다 — "매주"(ㅁ·ㅈ 두 군데)는 배추가 아니다
    assert lexicon.correct("매주 물을 줘요") == ("매주 물을 줘요", [])


def test_single_syllable_and_non_hangul_terms_are_ignored():
    assert Lexicon(["무", "PHI", "고추"]).terms == [("고추", "고추", "ㄱㅗㅊㅜ")]
