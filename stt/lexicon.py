"""농업 용어 보정 — STT가 비슷한 소리로 잘못 적은 작물·병명·농약 용어를 사전 단어로 바로잡는다.

SenseVoice는 한국어 일반 문장은 잘 받아 적지만 병명처럼 드문 단어를 소리가 비슷한 글자로 적는다
(탄저병 → 탄접병, 무름병 → 무음병, 희석 → 휘석). 핫워드(인식 중 단어 가중치)도 지원하지 않으므로
인식이 끝난 문장을 사전과 비교해 고친다.

세 글자 이상 용어는 한글을 자모(ㅌㅏㄴㅈㅓㅂㅕㅇ)로 풀어서 편집 거리로 비교한다. 받침 하나, 모음 하나
차이는 고치고 그보다 많이 다르면 그대로 둔다. SenseVoice는 띄어쓰기가 불규칙하므로("탄젖 병") 공백을 빼고
비교하되, 고친 부분 바깥의 원래 문장(띄어쓰기·문장부호 포함)은 건드리지 않는다.

일상어를 용어로 바꾸지 않도록 비교 범위를 좁힌다.
- 두 글자 용어는 자모로 비교하지 않는다. 자모 하나 차이인 일상어가 너무 많다(살펴→살포, 고쳐→고추,
  배출→배추, 해석→희석). 실제로 틀리게 들은 형태만 terms.txt에 "희석 = 휘석"처럼 적어 그대로 바꾼다.
- 자모 비교는 단어 시작에서, 용어와 같은 글자 수로만 한다("다시 촬영"의 "시 촬영"이나 "촬영" 두 글자를
  재촬영으로 보지 않는다).
- 세 글자 용어와 띄어쓰기를 넘는 비교는 자모 하나 차이까지만 고친다("무슨 병"은 무름병과 둘 차이).
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


_FUZZY_MIN_SYLLABLES = 3


def _max_distance(term_compact: str, term_jamo: str, spans_space: bool) -> int:
    # 세 글자 용어는 자모 하나 차이까지(탄저병 ↔ 탄접병). 네 글자 이상은 자모의 1/4까지
    # (검은썩음병 14자모 → 3). 띄어쓰기를 넘는 비교는 앞 단어가 일상어일 때가 많아 1까지만 허용한다.
    if spans_space or len(term_compact) <= _FUZZY_MIN_SYLLABLES:
        return 1
    return len(term_jamo) // 4


@dataclass(frozen=True)
class Correction:
    heard: str  # 원래 문장에서 고친 부분 (띄어쓰기 포함)
    term: str


def load_terms(path: Path) -> list[str]:
    """한 줄에 용어 하나. "희석 = 휘석, 히석"처럼 쓰면 = 뒤의 말을 그대로 앞의 용어로 바꾼다."""
    terms = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            terms.append(line)
    return terms


def _usable(word: str) -> bool:
    # 한 글자(무 등)는 다른 낱말과 너무 쉽게 겹친다. 한글이 아닌 말은 자모 비교가 무의미하다
    return len(word) >= 2 and all(is_hangul(ch) for ch in word)


class Lexicon:
    def __init__(self, terms: list[str]):
        cleaned = []
        aliases = {}  # 틀리게 들은 형태(공백 없음) → 용어
        for entry in dict.fromkeys(terms):
            term, _, heard = entry.partition("=")
            term = term.strip()
            compact = term.replace(" ", "")
            if not _usable(compact):
                continue
            cleaned.append((term, compact, to_jamo(compact)))
            for alias in heard.split(","):
                alias = alias.replace(" ", "")
                if _usable(alias) and alias != compact:
                    aliases[alias] = term
        self.terms = cleaned
        self.aliases = aliases

    def correct(self, text: str) -> tuple[str, list[Correction]]:
        # 공백을 뺀 글자와, 그 글자가 원래 문장 몇 번째인지
        chars = [(ch, i) for i, ch in enumerate(text) if not ch.isspace()]
        compact = "".join(ch for ch, _ in chars)
        # 단어 시작: 문장 처음이거나 바로 앞 글자가 공백·문장부호 등 한글이 아닌 글자
        word_start = [i == 0 or not is_hangul(text[i - 1]) for _, i in chars]

        candidates = []  # (거리, -용어 길이, 시작, 끝, 용어, 바꿀지)

        def exact(word, term):
            size = len(word)
            for start in range(len(compact) - size + 1):
                if compact[start:start + size] == word:
                    candidates.append((0, -size, start, start + size, term, word != term.replace(" ", "")))

        for term, term_compact, term_jamo in self.terms:
            exact(term_compact, term)
            n = len(term_compact)
            if n < _FUZZY_MIN_SYLLABLES:
                continue
            for start in range(len(compact) - n + 1):
                window = compact[start:start + n]
                if window == term_compact or not word_start[start] or not all(is_hangul(ch) for ch in window):
                    continue
                spans_space = chars[start + n - 1][1] - chars[start][1] != n - 1
                d = _distance(to_jamo(window), term_jamo)
                if d <= _max_distance(term_compact, term_jamo, spans_space):
                    candidates.append((d, -n, start, start + n, term, True))
        for alias, term in self.aliases.items():
            exact(alias, term)

        # 가장 가까운 것부터, 같으면 긴 말부터 겹치지 않게 고른다. 정확히 맞은 용어(거리 0)도 자리를
        # 차지해서, 맞게 들은 "배수"가 다른 용어로 바뀌는 일이 없게 한다
        taken = [False] * len(compact)
        chosen = []
        for _, _, start, end, term, replace in sorted(candidates):
            if any(taken[start:end]):
                continue
            for k in range(start, end):
                taken[k] = True
            if replace:
                chosen.append((start, end, term))

        corrections = []
        out = text
        for start, end, term in sorted(chosen, reverse=True):  # 뒤에서부터 바꿔야 앞쪽 위치가 안 밀린다
            lo, hi = chars[start][1], chars[end - 1][1] + 1
            corrections.append(Correction(heard=text[lo:hi], term=term))
            out = out[:lo] + term + out[hi:]
        corrections.reverse()
        return out, corrections
