"""Speech-style variants for user utterances (no punctuation, v11 rule).

The target users are older farmers who often speak in 반말 and regional
dialect, while 75% of v11 utterances end in 존칭. These rules only rewrite the
sentence ending and return None when no rule matches exactly, so an unusual
sentence is skipped rather than mangled. Every generated row is marked for
human review.
"""
import re

# Longest/most specific endings first. (존칭 ending, 반말 ending)
_BANMAL = [
    ("해 주실 수 있나요", "해 줄 수 있어"), ("주실 수 있나요", "줄 수 있어"), ("주실 수 있을까요", "줄 수 있어"),
    ("해 주시겠어요", "해 줄래"), ("주시겠어요", "줄래"), ("해 주세요", "해 줘"), ("주세요", "줘"),
    ("알려주실래요", "알려줄래"), ("하실래요", "할래"), ("하세요", "해"), ("보세요", "봐"),
    ("인가요", "인가"), ("건가요", "거야"), ("는 건가요", "는 거야"), ("을까요", "을까"), ("ㄹ까요", "ㄹ까"),
    ("나요", "나"), ("까요", "까"), ("가요", "가"), ("ㄴ가요", "ㄴ가"),
    ("입니까", "이야"), ("습니까", "어"), ("있습니다", "있어"), ("합니다", "해"),
    ("이에요", "이야"), ("예요", "야"), ("에요", "야"), ("해요", "해"), ("돼요", "돼"), ("되나요", "되나"),
    ("죠", "지"), ("네요", "네"), ("군요", "구나"), ("데요", "데"),
]
# Plain 요 after these syllables can simply be dropped (있어요 -> 있어, 나와요 -> 나와).
_DROP_YO = set("어아여와워줘봐돼해래대지게네야겨려워쳐져")


def _ending(text):
    for polite, plain in _BANMAL:
        if text.endswith(polite):
            return text[: -len(polite)] + plain
    if text.endswith("요") and len(text) >= 2 and text[-2] in _DROP_YO:
        return text[:-1]
    return None


def to_banmal(text):
    """Rewrite the final ending, and safe 요 endings of earlier clauses (v11 joins two clauses)."""
    words = text.strip().split(" ")
    last = _ending(" ".join(words))
    if last is None:
        return None
    words = last.split(" ")
    for i, word in enumerate(words[:-1]):
        if len(word) >= 2 and word.endswith("요") and word[-2] in _DROP_YO | {"게"}:
            words[i] = word[:-1]
    return " ".join(words)


def is_honorific(text):
    return bool(re.search(r"(요|니까|습니다|세요)$", text.strip()))


# Conservative regional endings. Each returns None unless its pattern matches the whole ending.
def chungcheong(text):
    """존칭 요 -> 유 in every clause ending (열었어요 ... 하나요 -> 열었어유 ... 하나유)."""
    text = text.strip()
    if not text.endswith("요"):
        return None
    return " ".join(word[:-1] + "유" if len(word) >= 2 and word.endswith("요") else word for word in text.split(" "))


def jeolla(text):
    """반말 거야 -> 거여, 지 -> 제, 해 -> 혀."""
    text = text.strip()
    for plain, local in (("거야", "거여"), ("는 거지", "는 거제"), ("하지", "하제"), ("이지", "이제")):
        if text.endswith(plain):
            return text[: -len(plain)] + local
    if re.search(r"(어떻게|뭘|왜|어찌) ?해$", text):
        return text[:-1] + "혀"
    return None


_WH = r"(뭐|무슨|어디|어떤|어느|왜|언제|얼마|몇|누가|어떻게)"


def gyeongsang(text):
    """의문사 질문의 반말 끝: 야 -> 고, 해 -> 하노, 돼 -> 되노 (무슨 병이야 -> 무슨 병이고)."""
    text = text.strip()
    if not re.search(_WH, text):
        return None
    for plain, local in (("이야", "이고"), ("거야", "기고"), ("뭐야", "뭐꼬"), ("해", "하노"), ("돼", "되노"), ("야", "고")):
        if text.endswith(plain):
            return text[: -len(plain)] + local
    return None


def dialect_variants(text):
    """[(dialect, variant)] for the 존칭 original and its 반말 form."""
    banmal = to_banmal(text) if is_honorific(text) else text
    out = []
    if is_honorific(text) and (v := chungcheong(text)):
        out.append(("chungcheong", v))
    if banmal:
        for name, rule in (("jeolla", jeolla), ("gyeongsang", gyeongsang)):
            if v := rule(banmal):
                out.append((name, v))
    return out
