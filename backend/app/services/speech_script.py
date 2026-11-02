"""진단 결과를 음성으로 읽어줄 문장으로 바꾼다.

TTS 모델은 숫자·기호 발음이 불안정하므로 합성 전에 한글로 풀어 쓴다.
"""

import re


def _has_final_consonant(word: str) -> bool:
    last = word.rstrip()[-1:]
    if not ("가" <= last <= "힣"):
        return False
    return (ord(last) - ord("가")) % 28 != 0


def josa(word: str, with_final: str, without_final: str) -> str:
    return with_final if _has_final_consonant(word) else without_final


def euro(word: str) -> str:
    """'으로/로' — 받침이 ㄹ이면 '로'를 쓴다."""
    last = word.rstrip()[-1:]
    if "가" <= last <= "힣" and (ord(last) - ord("가")) % 28 == 8:
        return "로"
    return josa(word, "으로", "로")


def strip_parenthetical(name: str) -> str:
    # "명가 (가스가마이신.티아디닐 액상수화제)" → "명가". 유효성분은 화면에서 본다
    return re.sub(r"\s*\(.*?\)", "", name).strip()


# ── 숫자 읽기 ────────────────────────────────────────────────────────────────

_SINO_DIGITS = "영일이삼사오육칠팔구"
_SINO_UNITS = ["", "십", "백", "천"]

# 고유어로 읽는 단위. 그 외(배·일·회·도·퍼센트 등)는 한자어로 읽는다
_NATIVE_COUNTERS = ("시간", "번", "개", "가지", "살")
_NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"]
_NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"]


def _sino_under_10000(n: int) -> str:
    out = []
    for pos in range(3, -1, -1):
        digit = n // 10**pos % 10
        if digit == 0:
            continue
        # 십·백·천 앞의 '일'은 읽지 않는다 (천 배, 백 배)
        word = "" if digit == 1 and pos > 0 else _SINO_DIGITS[digit]
        out.append(word + _SINO_UNITS[pos])
    return "".join(out)


def sino_number(n: int) -> str:
    if n == 0:
        return "영"
    parts = []
    for unit, size in (("억", 10**8), ("만", 10**4)):
        if n >= size:
            head = n // size
            parts.append(("" if head == 1 and unit == "만" else sino_number(head)) + unit)
            n %= size
    if n:
        parts.append(_sino_under_10000(n))
    return " ".join(parts)


def native_number(n: int) -> str:
    """관형형 고유어 수사 (1~99). 단위 앞에서 쓰는 형태: 한 시간, 스무 번."""
    tens, ones = divmod(n, 10)
    if tens == 2 and ones == 0:
        return "스무"
    return _NATIVE_TENS[tens] + _NATIVE_ONES[ones]


def _read_number(text: str, native: bool) -> str:
    if "." in text:
        whole, frac = text.split(".", 1)
        return f"{sino_number(int(whole))} 점 " + " ".join(_SINO_DIGITS[int(d)] for d in frac)
    n = int(text)
    if native and 0 < n < 100:
        return native_number(n)
    return sino_number(n)


# 괄호를 벗겨 이어 읽을 때 괄호 뒤 조사를 표시해 두었다가, 숫자를 한글로 바꾼 뒤 괄호 안
# 마지막 말에 맞춰 다시 고른다 ("횟수(3번)를" → "횟수 세 번을")
_JOSA_PAIRS = {"을": ("을", "를"), "를": ("을", "를"), "이": ("이", "가"), "가": ("이", "가"),
               "은": ("은", "는"), "는": ("은", "는"), "과": ("과", "와"), "와": ("과", "와")}
_JOSA_PATTERN = "으로|로|" + "|".join(_JOSA_PAIRS)
_JOSA_MARK = "\x00"
_MARKED_JOSA = re.compile(rf"(\S){_JOSA_MARK}({_JOSA_PATTERN}){_JOSA_MARK}")


def _unwrap_parenthesis(match: re.Match) -> str:
    inner, particle = match.group(1), match.group(2)
    return f" {inner}{_JOSA_MARK}{particle}{_JOSA_MARK}" if particle else f" {inner}"


def _repick_josa(match: re.Match) -> str:
    word, particle = match.group(1), match.group(2)
    if particle in ("으로", "로"):
        return word + euro(word)
    return word + josa(word, *_JOSA_PAIRS[particle])


_SYMBOLS = [
    (re.compile(r"\s*\([A-Za-z][A-Za-z .]*\)"), ""),  # 학명 괄호 "세균(Xanthomonas)" — 귀로는 의미가 없다
    (re.compile(r"\bV자"), "브이 자"),
    (re.compile(r"(?<=\d),(?=\d{3})"), ""),  # 1,000 → 1000
    (re.compile(r"\s*(°C|℃)"), "도"),
    (re.compile(r"\s*%"), "퍼센트"),
    (re.compile(r"\s*[~～]\s*|(?<=\d)\s*–\s*(?=\d)"), "에서 "),  # 25~30, 갈색~흑갈색
    # 괄호는 귀로 구분되지 않는다. 숫자가 없는 보충 설명 뒤에 조사가 붙으면("곰팡이(포자층)가")
    # 괄호 안을 뺀다. 시간·배수·온도처럼 숫자가 있는 괄호는 뜻이 담겨 있어 괄호만 벗겨 읽는다
    (re.compile(r"\s*\([^()\d]*\)(?=[가-힣])"), ""),
    (re.compile(rf"\s*\(\s*([^()]*?)\s*\)(?:({_JOSA_PATTERN})(?![가-힣]))?"), _unwrap_parenthesis),
    # 단위 바로 뒤에 '당'·조사가 붙기도 해서(20L당) \b 대신 영문자가 이어지지 않는지만 본다
    (re.compile(r"(?<=\d)\s*(?:mL|㎖)(?![A-Za-z])", re.IGNORECASE), "밀리리터"),
    (re.compile(r"(?<=\d)\s*(?:kg|㎏)(?![A-Za-z])"), "킬로그램"),
    (re.compile(r"(?<=\d)\s*g(?![A-Za-z])"), "그램"),
    (re.compile(r"(?<=\d)\s*(?:L|ℓ)(?![A-Za-z])"), "리터"),
    (re.compile(r"\s*/\s*(\d+)\s*a(?![A-Za-z])"), r" \1아르당"),  # 100mL/10a → 백 밀리리터 십 아르당
    (re.compile(r"\s*[·/]\s*"), ", "),
]

# 숫자 뒤 단위(배·일·회 …)를 함께 잡아 띄어 쓴다. 범위의 '에서'는 조사라 붙여 둔다.
# '개월'은 '개'로 시작하지만 한자어로 읽는다 (이 개월). '번'은 횟수(두 번)로 읽으므로
# 번호(1번 농약)를 뜻하는 문장은 템플릿에서 숫자 대신 다른 표현을 써야 한다.
_NATIVE_PATTERN = "|".join("개(?!월)" if c == "개" else c for c in _NATIVE_COUNTERS)
_NUMBER = re.compile(r"(\d+(?:\.\d+)?)\s*(?:(" + _NATIVE_PATTERN + r")|((?!에서)[가-힣]))?")


def normalize_for_tts(text: str) -> str:
    """숫자·단위·기호를 한글 발음으로 풀어 쓴다."""
    for pattern, repl in _SYMBOLS:
        text = pattern.sub(repl, text)

    def replace(match: re.Match) -> str:
        number, native, other = match.group(1), match.group(2), match.group(3)
        following = native or other or ""
        spoken = _read_number(number, native=bool(native))
        return f"{spoken} {following}" if following else spoken

    text = _NUMBER.sub(replace, text)
    text = _MARKED_JOSA.sub(_repick_josa, text).replace(_JOSA_MARK, "")
    return re.sub(r"\s{2,}", " ", text).strip()
