"""진단 결과를 음성으로 읽어줄 문장으로 바꾼다.

화면과 음성이 같은 근거(DiagnoseResponse)에서 나오도록 템플릿으로만 만든다.
수치는 DB 값만 쓰고, 확정되지 않은 진단에는 방제 안내를 붙이지 않는다.
TTS 모델은 숫자·기호 발음이 불안정하므로 합성 전에 한글로 풀어 쓴다.
"""

import re

from app.schemas.diagnosis import DiagnoseResponse, PesticideInfo

# 귀로만 듣는 안내라 길면 앞부분을 잊는다. 나머지는 화면에서 확인하도록 넘긴다
MAX_ACTIONS = 2


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


# ── 문장 구성 ────────────────────────────────────────────────────────────────

_ORDINALS = ["첫째", "둘째", "셋째"]


def _headline(result: DiagnoseResponse, uncertain: bool) -> list[str]:
    if result.category == "normal":
        # crop_type은 사용자가 고른 작물일 수 있다. 건강하다고 말하는 대상은 모델이 본 작물이다
        crop = result.predicted_crop or result.crop_type or "작물"
        lines = [f"{crop}{josa(crop, '은', '는')} 건강한 상태로 보여요."]
        if uncertain:
            lines.append("다만 확실하지 않으니 잎 상태를 한 번 더 살펴봐 주세요.")
        return lines

    name = result.disease_name
    if uncertain:
        return [f"{name}일 가능성이 있지만, 비슷한 병해가 여럿 나와 아직 확실하지 않아요."]
    return [f"{name}{euro(name)} 보여요."]


def _usable_pesticides(result: DiagnoseResponse) -> list[PesticideInfo]:
    """지금 안내해도 되는 농약. 이력 화면과 같이 현재 카탈로그의 검증된 사용 조건만 쓴다.

    음성은 저장된 기록에서 만든다. 저장 당시 목록(pesticides)은 그 뒤 등록이 해제되거나
    조건이 바뀌었을 수 있고 검증되지 않은 제품도 있어, 현재 사용 지침으로 읽지 않는다.
    """
    return [p for p in result.current_pesticides if p.verification_status == "verified"]


def _pesticide_lines(pesticides: list[PesticideInfo]) -> list[str]:
    first = pesticides[0]
    name = strip_parenthetical(first.name)
    lines = [f"등록 농약으로는 {name}{josa(name, '이', '가')} 있어요."]
    # 경엽처리·관주처리 같은 사용 방법을 템플릿이 정하지 않는다. 카탈로그 값만 그대로 읽는다
    if first.usage:
        lines.append(f"사용 방법은 {first.usage}{josa(first.usage, '이에요', '예요')}.")
    if first.dilution:
        lines.append(f"희석 배수는 {first.dilution}{josa(first.dilution, '이에요', '예요')}.")
    if first.safety.phi_days is not None:
        lines.append(f"수확 {first.safety.phi_days}일 전까지만 쓸 수 있어요.")
    if len(pesticides) > 1:
        lines.append("다른 농약과 자세한 사용법은 화면에서 확인해 주세요.")
    else:
        lines.append("자세한 사용법은 화면에서 확인해 주세요.")
    return lines


def _actions(result: DiagnoseResponse) -> list[str]:
    """지금 할 일. 귀로 듣기 좋은 설명 문장을 먼저 쓰고, 없는 이전 기록은 제목·예방법으로 대신한다.

    화면(DiagnosisResultView)과 같이 할 일 제목을 기준으로, 같은 자리의 설명이 그 제목의 것일 때만
    설명을 읽는다. 어긋난 설명을 읽으면 화면에 없는 할 일을 귀로만 듣게 된다.
    """
    details = result.management_action_details
    actions = [
        details[index].description
        if index < len(details) and details[index].title == title and details[index].description.strip()
        else title
        for index, title in enumerate(result.management_actions)
    ]
    return (actions or result.prevention)[:MAX_ACTIONS]


def _numbered(items: list[str]) -> list[str]:
    return [f"{_ORDINALS[i]}, {item.rstrip('.')}." for i, item in enumerate(items)]


def build_script(result: DiagnoseResponse) -> list[str]:
    """진단 결과 → 낭독 문장 목록 (병명 → 지금 해야 할 일 순).

    판단은 화면과 같은 decision_status·decision_reasons를 따른다. 임계값을 여기서 다시
    계산하면 서버 설정(LOW_CONFIDENCE_THRESHOLD)과 음성의 단정 수준이 어긋난다.
    서버(decision.decision)는 상태를 항상 사유의 첫 항목으로 두고, 혼동(confusion)은 재촬영
    안내와 함께 저장한다. 그래도 음성은 방제를 단정해 읽으므로 둘 중 한쪽만 확실하지 않다고
    해도 확실하지 않은 쪽으로 읽는다.
    """
    is_normal = result.category == "normal"
    states = {result.decision_status, *result.decision_reasons}
    # 재촬영 안내 없이 혼동만 남은 기록도 후보를 가리지 못한 상태다
    confused_without_guidance = "confusion" in states and not result.recapture
    uncertain = "low_confidence" in states or confused_without_guidance
    lines: list[str] = []

    if result.prediction_mode == "mock":
        lines.append("지금은 시험용 결과예요. 실제 진단이 아니에요.")

    # 작물 잎으로 알아볼 수 없으면 병명도 작물도 말하지 않고 다시 찍는 방법만 알린다
    if "not_crop" in states or result.category == "other":
        lines.append("사진에서 작물 잎을 찾지 못했어요.")
        tips = _actions(result)
        if tips:
            lines.append("이렇게 다시 찍어 주세요.")
            lines += _numbered(tips)
        else:
            lines.append("잎이 잘 보이게 다시 찍어 주세요.")
        return [normalize_for_tts(line) for line in lines]

    # 고른 작물과 사진 속 작물이 다르면 진단 전체가 의심스럽다. 정상 단정·방제 안내 없이
    # 작물 확인부터 요청한다
    if "crop_mismatch" in states or result.crop_mismatch:
        selected = result.selected_crop or result.crop_type or "선택하신 작물"
        predicted = result.predicted_crop or "다른 작물"
        lines.append(f"선택하신 작물은 {selected}인데, 사진은 {predicted} 잎으로 보여요.")
        lines.append("작물을 확인하고 다시 찍어 주세요.")
        return [normalize_for_tts(line) for line in lines]

    lines += _headline(result, uncertain)

    # 재촬영이 필요하면 그것이 지금 할 일의 전부다 — 확정 전에 방제를 권하지 않는다
    if result.recapture:
        lines.append("정확히 가리려면 사진을 한 장 더 찍어 주세요.")
        lines.append(result.recapture.instruction)
        return [normalize_for_tts(line) for line in lines]

    if confused_without_guidance:
        lines.append("정확히 가리려면 병든 부위가 잘 보이게 사진을 한 장 더 찍어 주세요.")
        return [normalize_for_tts(line) for line in lines]

    if not is_normal and uncertain:
        lines.append("방제하기 전에 가까운 농업기술센터에 확인해 보세요.")
        return [normalize_for_tts(line) for line in lines]

    actions = _actions(result)
    if actions:
        lines.append("관리 요령을 알려드릴게요." if is_normal else "지금 할 일을 알려드릴게요.")
        lines += _numbered(actions)

    pesticides = _usable_pesticides(result)
    if not is_normal and pesticides:
        lines += _pesticide_lines(pesticides)

    return [normalize_for_tts(line) for line in lines]
