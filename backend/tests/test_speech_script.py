"""음성 안내 문장: 숫자·단위 정규화와 조사."""

import pytest

from app.services.speech_script import euro, josa, native_number, normalize_for_tts, sino_number, strip_parenthetical


@pytest.mark.parametrize(
    "n, expected",
    [(0, "영"), (1, "일"), (10, "십"), (14, "십사"), (500, "오백"), (1000, "천"),
     (2025, "이천이십오"), (10000, "만"), (35000, "삼만 오천")],
)
def test_sino_number(n, expected):
    assert sino_number(n) == expected


@pytest.mark.parametrize("n, expected", [(1, "한"), (2, "두"), (20, "스무"), (24, "스물네")])
def test_native_number(n, expected):
    assert native_number(n) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("물에 1000배로", "물에 천 배로"),
        ("1,000배", "천 배"),
        ("수확 2일 전", "수확 이 일 전"),
        ("3회 이내", "삼 회 이내"),
        ("24시간 후", "스물네 시간 후"),
        ("고온다습(25~30℃)", "고온다습 이십오에서 삼십 도"),
        ("갈색~흑갈색 병반", "갈색에서 흑갈색 병반"),
        ("곰팡이(포자층)가 보이면", "곰팡이가 보이면"),
        ("동심원(과녁) 무늬", "동심원 과녁 무늬"),
        ("2개월 뒤", "이 개월 뒤"),
        ("3개를", "세 개를"),
        ("0.5%", "영 점 오 퍼센트"),
        ("배수·통풍 관리", "배수, 통풍 관리"),
        ("세균(Xanthomonas) 감염", "세균 감염"),
        ("V자로 노래지면", "브이 자로 노래지면"),
        ("물 20L당 10mL", "물 이십 리터당 십 밀리리터"),
        ("100㎖/10a", "백 밀리리터 십 아르당"),
        ("2kg을", "이 킬로그램을"),
    ],
)
def test_normalize_for_tts(text, expected):
    assert normalize_for_tts(text) == expected


def test_josa_follows_the_last_syllable():
    assert josa("탄저병", "이", "가") == "이"
    assert josa("명가", "이", "가") == "가"
    assert euro("시들음") == "으로"
    assert euro("이물") == "로"  # ㄹ 받침은 '로'
    assert euro("명가") == "로"


def test_strip_parenthetical_drops_active_ingredients():
    assert strip_parenthetical("명가 (가스가마이신.티아디닐 액상수화제)") == "명가"
