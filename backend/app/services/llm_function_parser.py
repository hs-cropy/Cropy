"""LLM 기능 토큰을 검증한다. 함수를 실행하거나 인자를 추측하지 않는다."""

import re
from dataclasses import dataclass


# 기능별 인자 순서와 허용 값. 데이터시트의 기능 계약을 따른다.
FUNCTION_ARGUMENTS = {
    "get_diagnosis": (
        ("topic", (
            "result", "severity", "observation", "provenance",
            "impact", "food_safety", "change",
        )),
    ),
    "get_prediction_metrics": (
        ("topic", (
            "confidence", "ranking", "distribution", "limits", "comparison",
        )),
    ),
    "get_recapture_guidance": (
        ("topic", ("where", "why", "certainty", "provenance")),
    ),
    "get_care_information": (
        ("topic", ("causes", "prevention", "priority")),
    ),
    "get_pesticide_information": (
        ("topic", (
            "list", "dilution", "usage", "phi", "reentry",
            "verification", "ingredient", "summary", "checklist",
            "comparison", "mixing",
        )),
        ("product_ref", ("current", "all")),
    ),
    "clarify_request": (
        ("target", (
            "crop", "disease", "topic", "confidence",
            "severity", "record", "product", "stt",
        )),
    ),
    "handle_scope_limit": (
        ("reason", ("crop", "action", "input")),
    ),
}

_TOKEN = re.compile(r"<hs_[a-z_]+>|<hs-end>")
_MAX_OUTPUT_CHARS = 512


class InvalidFunctionOutput(ValueError):
    """기능 토큰의 형식이나 인자가 계약과 일치하지 않는다."""


@dataclass
class ParsedFunctionCall:
    function_name: str
    arguments: dict[str, str]


def parse_function_output(output: str) -> ParsedFunctionCall:
    """앞뒤 공백만 허용하고 완전한 단일 기능 호출을 분석한다."""
    if not isinstance(output, str):
        raise InvalidFunctionOutput("output must be a string")

    if len(output) > _MAX_OUTPUT_CHARS:
        raise InvalidFunctionOutput("output is too long")

    text = output.strip()
    tokens = _TOKEN.findall(text)

    # 自然言語・JSON・コードフェンス・トークン間の文字を許可しない。
    if not tokens or "".join(tokens) != text:
        raise InvalidFunctionOutput("output must contain only function tokens")

    if tokens[-1] != "<hs-end>":
        raise InvalidFunctionOutput("missing end token")

    function_name = tokens[0][4:-1]
    specification = FUNCTION_ARGUMENTS.get(function_name)
    if specification is None:
        raise InvalidFunctionOutput("unknown function")

    if len(tokens) != len(specification) + 2:
        raise InvalidFunctionOutput("incorrect argument count")

    arguments = {}
    for token, (argument, allowed_values) in zip(
        tokens[1:-1], specification
    ):
        prefix = "product" if argument == "product_ref" else argument
        allowed_tokens = {
            f"<hs_{prefix}_{value}>": value
            for value in allowed_values
        }
        if token not in allowed_tokens:
            raise InvalidFunctionOutput(
                f"invalid or out-of-order argument: {argument}"
            )
        arguments[argument] = allowed_tokens[token]

    return ParsedFunctionCall(
        function_name=function_name,
        arguments=arguments,
    )