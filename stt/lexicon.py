"""농업 용어 보정 — STT가 비슷한 소리로 잘못 적은 작물·병명·농약 용어를 사전 단어로 바로잡는다.

SenseVoice는 한국어 일반 문장은 잘 받아 적지만 병명처럼 드문 단어를 소리가 비슷한 글자로 적는다
(탄저병 → 탄접병, 무름병 → 무음병, 희석 → 휘석). 핫워드(인식 중 단어 가중치)도 지원하지 않으므로
인식이 끝난 문장을 사전과 비교해 고친다.

비교는 한글을 자모(ㅌㅏㄴㅈㅓㅂㅕㅇ)로 풀어서 편집 거리로 한다. 받침 하나, 모음 하나 차이는 고치고
그보다 많이 다르면 그대로 둔다. SenseVoice는 띄어쓰기가 불규칙하므로("탄젖 병") 공백을 빼고 비교하되,
고친 부분 바깥의 원래 문장(띄어쓰기·문장부호 포함)은 건드리지 않는다.
"""

from dataclasses import dataclass
from pathlib import Path

_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"]
# 겹받침은 소리 나는 대로 비교할 필요가 없어 두 자모로 푼다
_JONG = ["", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ",
         "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]


def is_hangul(ch: str) -> bool:
    return 0xAC00 <= ord(ch) <= 0xD7A3


def to_jamo(text: str) -> str:
    out = []
    for ch in text:
        if is_hangul(ch):
            code = ord(ch) - 0xAC00
            out.append(_CHO[code // 588] + _JUNG[(code % 588) // 28] + _JONG[code % 28])
        else:
            out.append(ch)
    return "".join(out)


def _distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def _max_distance(term_jamo: str) -> int:
    # 두 글자 용어(자모 6개 이하)는 한 군데만 달라도 다른 단어가 되기 쉬워 1까지만 허용한다.
    # 그보다 긴 용어는 자모의 1/4까지(탄저병 8자모 → 2: "한접병"도 고친다)
    return 1 if len(term_jamo) <= 6 else len(term_jamo) // 4


@dataclass(frozen=True)
class Correction:
    heard: str  # 원래 문장에서 고친 부분 (띄어쓰기 포함)
    term: str


def load_terms(path: Path) -> list[str]:
    terms = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            terms.append(line)
    return terms


class Lexicon:
    def __init__(self, terms: list[str]):
        cleaned = []
        for term in dict.fromkeys(terms):
            compact = term.replace(" ", "")
            # 한 글자 용어(무 등)는 다른 낱말과 너무 쉽게 겹친다. 한글이 아닌 용어는 자모 비교가 무의미하다
            if len(compact) >= 2 and all(is_hangul(ch) for ch in compact):
                cleaned.append((term, compact, to_jamo(compact)))
        self.terms = cleaned

    def correct(self, text: str) -> tuple[str, list[Correction]]:
        # 공백을 뺀 글자와, 그 글자가 원래 문장 몇 번째인지
        chars = [(ch, i) for i, ch in enumerate(text) if not ch.isspace()]
        compact = "".join(ch for ch, _ in chars)

        candidates = []  # (거리, -용어 길이, 시작, 끝, 용어)
        for term, term_compact, term_jamo in self.terms:
            n = len(term_compact)
            limit = _max_distance(term_jamo)
            for size in {n - 1, n, n + 1} if n >= 3 else {n}:
                for start in range(len(compact) - size + 1):
                    window = compact[start:start + size]
                    if not all(is_hangul(ch) for ch in window):
                        continue
                    if window == term_compact:
                        d = 0
                    else:
                        d = _distance(to_jamo(window), term_jamo)
                        if d > limit:
                            continue
                    candidates.append((d, -n, start, start + size, term))

        # 가장 가까운 것부터, 같으면 긴 용어부터 겹치지 않게 고른다. 정확히 맞은 용어(거리 0)도 자리를
        # 차지해서, 맞게 들은 "배수"가 "배추"로 바뀌는 일이 없게 한다
        taken = [False] * len(compact)
        chosen = []
        for d, _, start, end, term in sorted(candidates):
            if any(taken[start:end]):
                continue
            for k in range(start, end):
                taken[k] = True
            if d > 0:
                chosen.append((start, end, term))

        corrections = []
        out = text
        for start, end, term in sorted(chosen, reverse=True):  # 뒤에서부터 바꿔야 앞쪽 위치가 안 밀린다
            lo, hi = chars[start][1], chars[end - 1][1] + 1
            corrections.append(Correction(heard=text[lo:hi], term=term))
            out = out[:lo] + term + out[hi:]
        corrections.reverse()
        return out, corrections
