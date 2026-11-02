from itertools import product

import pytest

from app.services.llm_function_parser import (
    FUNCTION_ARGUMENTS,
    InvalidFunctionOutput,
    parse_function_output,
)


@pytest.mark.parametrize(
    "output,function_name,arguments",
    [
        (
            "<hs_clarify_request><hs_target_product><hs-end>",
            "clarify_request",
            {"target": "product"},
        ),
        (
            "<hs_get_pesticide_information>"
            "<hs_topic_reentry><hs_product_current><hs-end>",
            "get_pesticide_information",
            {"topic": "reentry", "product_ref": "current"},
        ),
        (
            "<hs_get_care_information><hs_topic_priority><hs-end>",
            "get_care_information",
            {"topic": "priority"},
        ),
    ],
)
def test_v11_reference_examples(output, function_name, arguments):
    result = parse_function_output(output)
    assert result.function_name == function_name
    assert result.arguments == arguments


@pytest.mark.parametrize("function_name", list(FUNCTION_ARGUMENTS))
def test_all_declared_argument_combinations(function_name):
    specification = FUNCTION_ARGUMENTS[function_name]
    for values in product(*(allowed for _, allowed in specification)):
        tokens = [f"<hs_{function_name}>"]
        expected = {}

        for (argument, _), value in zip(specification, values):
            prefix = "product" if argument == "product_ref" else argument
            tokens.append(f"<hs_{prefix}_{value}>")
            expected[argument] = value

        tokens.append("<hs-end>")
        result = parse_function_output("".join(tokens))

        assert result.function_name == function_name
        assert result.arguments == expected


def test_outer_whitespace_is_allowed():
    result = parse_function_output(
        " \n<hs_get_diagnosis><hs_topic_result><hs-end>\n "
    )
    assert result.arguments == {"topic": "result"}


@pytest.mark.parametrize(
    "output",
    [
        None,
        123,
        "",
        " ",
        "안내 문장입니다.",
        '{"function": "get_diagnosis"}',
        "<hs_unknown><hs_topic_result><hs-end>",
        "<hs_get_diagnosis><hs_topic_unknown><hs-end>",
        "<hs_get_diagnosis><hs_topic_causes><hs-end>",
        "<hs_get_diagnosis><hs_topic_result>",
        "<hs_get_diagnosis><hs-end>",
        "<hs_get_diagnosis><hs_topic_result><hs-end><hs-end>",
        "<hs_get_diagnosis><hs_topic_result><hs_topic_result><hs-end>",
        "<hs_get_diagnosis> <hs_topic_result><hs-end>",
        "설명: <hs_get_diagnosis><hs_topic_result><hs-end>",
        "<hs_get_diagnosis><hs_topic_result><hs-end>추가 설명",
        "```<hs_get_diagnosis><hs_topic_result><hs-end>```",
        "<hs_get_pesticide_information><hs_topic_list><hs-end>",
        (
            "<hs_get_pesticide_information>"
            "<hs_product_current><hs_topic_list><hs-end>"
        ),
        (
            "<hs_get_pesticide_information>"
            "<hs_topic_list><hs_product_unknown><hs-end>"
        ),
        (
            "<hs_get_diagnosis><hs_topic_result><hs-end>"
            "<hs_get_care_information><hs_topic_causes><hs-end>"
        ),
        "<hs_get_diagnosis><hs_topic_result><hs-end>" + " " * 513,
    ],
)
def test_invalid_output_is_rejected(output):
    with pytest.raises(InvalidFunctionOutput):
        parse_function_output(output)