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
        ("동약 어째 쓰는겨.", "농약 어째 쓰는겨."),  # 평가 페이지 실제 발화
        # 평가 페이지 실제 발화(2026-11-06): 작물명과 병명을 붙여 써 병명이 단어 중간에 온 경우
        ("고충탄접병가 아닌 거 같은데?", "고추 탄저병가 아닌 거 같은데?"),
        ("이거 고주탄접병이 아닌 거 같은데?", "이거 고추 탄저병이 아닌 거 같은데?"),
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
        # 두 글자 용어와 자모 하나 차이인 일상어 (PR #145 리뷰)
        "잎을 살펴봐야 하나요",  # 살포
        "다시 고쳐 주세요",  # 고추
        "병이 퍼지는 걸 방지하려면",  # 방제
        "물이 배출이 안 돼요",  # 배추
        "배치 해 주세요",  # 배추
        "모델 점수의 해석 한계를 알려주세요",  # 희석
        "약 후보 이름과 개수를 알려주세요",  # 배수
        # 세 글자 이상 용어의 일부·단어 경계를 넘는 비교 (Qwen v2 학습 발화에서 찾은 것)
        "방금 배추를 촬영했어요",  # 재촬영 (두 글자만)
        "다시 촬영 안내가 어디서 나온 건가요",  # 재촬영 (단어 중간 "시 촬영")
        "추가 촬영이 필요한 이유만 알려주세요",  # 재촬영
        "토마토 무슨 병이야",  # 무름병 (띄어쓰기를 넘으면 자모 하나 차이까지만)
        "토마토 무슨병이야",  # 무름병 (세 글자 용어는 자모 하나 차이까지만)
        "빈 화분인데 작물 병으로 설명해주세요",  # 무름병
        "사용 방법을 자료에서 확인해주세요",  # 수확 ("서 확")
        "예방 자료의 내용을 알려주세요",  # 방제 ("방 자")
        # 조사가 붙은 증상 표현 — 끝 글자가 "병"이 아니면 병명으로 보지 않는다 (PR #145 리뷰)
        "잎에 검은무늬가 생겼어요",  # 검은무늬병
        "검은무늬는 왜 생겨요",  # 검은무늬병
        "검은썩음이 번졌어요",  # 검은썩음병
        "잎에 흰가루가 묻어 있어요",  # 흰가루병
        "고추 탄저가 의심돼요",  # 고추 탄저병
    ],
)
def test_correct_sentences_are_left_unchanged(lexicon, text):
    assert lexicon.correct(text) == (text, [])


def test_alias_lines_map_heard_forms_to_term():
    lexicon = Lexicon(["희석 = 휘석, 히 석", "배수"])
    assert [t for t, _, _ in lexicon.terms] == ["희석", "배수"]
    assert lexicon.aliases == {"휘석": "희석", "히석": "희석"}
    text, corrections = lexicon.correct("농약 히 석 배수")
    assert text == "농약 희석 배수"
    assert [(c.heard, c.term) for c in corrections] == [("히 석", "희석")]


def test_two_syllable_terms_are_not_fuzzy_matched():
    # 별칭이 없으면 자모 하나 차이라도 바꾸지 않는다
    assert Lexicon(["살포"]).correct("살퍼 해요") == ("살퍼 해요", [])


def test_correction_reports_what_was_heard(lexicon):
    _, corrections = lexicon.correct("고추 역병이랑 탄젖 병이")
    assert [(c.heard, c.term) for c in corrections] == [("탄젖 병", "탄저병")]


def test_far_words_are_not_forced_into_terms(lexicon):
    # 두 글자 용어는 자모 하나 차이까지만 고친다 — "매주"(ㅁ·ㅈ 두 군데)는 배추가 아니다
    assert lexicon.correct("매주 물을 줘요") == ("매주 물을 줘요", [])


def test_single_syllable_and_non_hangul_terms_are_ignored():
    assert Lexicon(["무", "PHI", "고추"]).terms == [("고추", "고추", "ㄱㅗㅊㅜ")]
