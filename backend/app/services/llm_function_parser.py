"""모델 폴더의 함수 계약을 읽어 hs-call-v2 출력을 검증한다."""

import json
import re
from dataclasses import dataclass
from pathlib import Path


_MAX_OUTPUT_CHARS = 512
_IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*", re.ASCII)
_CALL = re.compile(
    r"<hs_([0-9]+)>\("
    r"((?:[a-z_]+=-?[0-9]+(?:, [a-z_]+=-?[0-9]+)*)?)"
    r"\)<hs_end>",
    re.ASCII,
)


class InvalidFunctionContract(ValueError):
    """모델 함수표가 지원하는 계약 구조와 일치하지 않는다."""


class InvalidFunctionOutput(ValueError):
    """모델 출력이 함수 계약과 일치하지 않는다."""


@dataclass(frozen=True)
class FunctionSpec:
    name: str
    arguments: tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class FunctionContract:
    system_prompt: str
    functions: tuple[FunctionSpec, ...]
    stop_token: str


@dataclass
class ParsedFunctionCall:
    function_name: str
    arguments: dict[str, int]


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidFunctionContract("duplicate JSON key")
        result[key] = value
    return result


def load_function_contract(path: str | Path) -> FunctionContract:
    """JSON의 함수·인자 순서를 보존한다. 모델이나 코드를 실행하지 않는다."""
    try:
        document = json.loads(
            Path(path).read_text(encoding="utf-8-sig"),
            object_pairs_hook=_unique_object,
        )
    except json.JSONDecodeError as error:
        raise InvalidFunctionContract("invalid JSON") from error

    if not isinstance(document, dict):
        raise InvalidFunctionContract("contract must be an object")

    prompt = document.get("system_prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise InvalidFunctionContract("missing system prompt")

    if document.get("stop_token") != "<hs_end>":
        raise InvalidFunctionContract("unsupported stop token")

    table = document.get("functions")
    if not isinstance(table, dict) or not table:
        raise InvalidFunctionContract("missing function table")

    functions = []
    for name, arguments in table.items():
        if not isinstance(name, str) or not _IDENTIFIER.fullmatch(name):
            raise InvalidFunctionContract("invalid function name")
        if not isinstance(arguments, list):
            raise InvalidFunctionContract("arguments must be a list")

        seen = set()
        checked = []
        for item in arguments:
            if not isinstance(item, list) or len(item) != 2:
                raise InvalidFunctionContract("invalid argument specification")
            argument, count = item
            if (
                not isinstance(argument, str)
                or not _IDENTIFIER.fullmatch(argument)
                or argument in seen
            ):
                raise InvalidFunctionContract("invalid or duplicate argument")
            if type(count) is not int or count < 1:
                raise InvalidFunctionContract("argument count must be positive")
            seen.add(argument)
            checked.append((argument, count))

        functions.append(FunctionSpec(name, tuple(checked)))

    return FunctionContract(prompt, tuple(functions), "<hs_end>")


def parse_function_output(
    output: str,
    contract: FunctionContract,
) -> ParsedFunctionCall:
    """단일 호출을 분석하고 모델 계약의 정수 인자를 반환한다."""
    if not isinstance(output, str):
        raise InvalidFunctionOutput("output must be a string")
    if len(output) > _MAX_OUTPUT_CHARS:
        raise InvalidFunctionOutput("output is too long")

    match = _CALL.fullmatch(output.strip())
    if match is None:
        raise InvalidFunctionOutput("malformed v2 call")

    index = int(match.group(1))
    if index >= len(contract.functions):
        raise InvalidFunctionOutput("unknown function index")

    specification = contract.functions[index]
    raw = match.group(2)
    pairs = [pair.split("=") for pair in raw.split(", ")] if raw else []

    if [key for key, _ in pairs] != [
        key for key, _ in specification.arguments
    ]:
        raise InvalidFunctionOutput("incorrect argument names or order")

    arguments = {}
    for (key, value), (_, count) in zip(pairs, specification.arguments):
        number = int(value)
        if not 1 <= number <= count:
            raise InvalidFunctionOutput("argument is out of range")
        arguments[key] = number

    return ParsedFunctionCall(specification.name, arguments)
