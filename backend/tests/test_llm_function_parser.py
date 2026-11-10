import json

import pytest

from app.services.llm_function_parser import (
    InvalidFunctionContract,
    InvalidFunctionOutput,
    load_function_contract,
    parse_function_output,
)


@pytest.fixture
def document():
    return {
        "system_prompt": "테스트용 프롬프트",
        "stop_token": "<hs_end>",
        "functions": {
            "get_diagnosis": [["topic", 7]],
            "get_prediction_metrics": [["topic", 5]],
            "get_recapture_guidance": [["topic", 4]],
            "get_care_information": [["topic", 3]],
            "get_pesticide_information": [["topic", 11], ["product", 2]],
            "clarify_request": [["target", 8]],
            "handle_scope_limit": [["reason", 3]],
            "get_usage_guidance": [["topic", 6], ["delivery", 2]],
            "chit_chat": [],
        },
    }


def load(tmp_path, document):
    path = tmp_path / "cropy_prompt.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return load_function_contract(path)


@pytest.fixture
def contract(tmp_path, document):
    return load(tmp_path, document)


@pytest.mark.parametrize(
    "output,name,arguments",
    [
        ("<hs_0>(topic=1)<hs_end>", "get_diagnosis", {"topic": 1}),
        (
            "<hs_4>(topic=2, product=1)<hs_end>",
            "get_pesticide_information",
            {"topic": 2, "product": 1},
        ),
        (
            "<hs_7>(topic=6, delivery=2)<hs_end>",
            "get_usage_guidance",
            {"topic": 6, "delivery": 2},
        ),
        ("<hs_8>()<hs_end>", "chit_chat", {}),
    ],
)
def test_v2_examples(contract, output, name, arguments):
    result = parse_function_output(output, contract)
    assert result.function_name == name
    assert result.arguments == arguments


def test_model_file_controls_function_order_and_range(tmp_path, document):
    document["functions"] = {"chit_chat": [], "get_diagnosis": [["topic", 2]]}
    contract = load(tmp_path, document)

    assert parse_function_output(
        "<hs_0>()<hs_end>", contract
    ).function_name == "chit_chat"
    assert parse_function_output(
        "<hs_1>(topic=2)<hs_end>", contract
    ).arguments == {"topic": 2}

    with pytest.raises(InvalidFunctionOutput):
        parse_function_output("<hs_1>(topic=3)<hs_end>", contract)


def test_contract_preserves_prompt(contract):
    assert contract.system_prompt == "테스트용 프롬프트"
    assert contract.stop_token == "<hs_end>"


@pytest.mark.parametrize("index", range(9))
def test_argument_boundaries(contract, index):
    specification = contract.functions[index]
    for upper in (False, True):
        arguments = {
            key: count if upper else 1
            for key, count in specification.arguments
        }
        body = ", ".join(f"{key}={value}" for key, value in arguments.items())
        result = parse_function_output(
            f"<hs_{index}>({body})<hs_end>", contract
        )
        assert result.arguments == arguments


@pytest.mark.parametrize(
    "output",
    [
        None,
        123,
        "",
        "설명입니다.",
        '{"function": "get_diagnosis"}',
        "<hs_get_diagnosis><hs_topic_result><hs-end>",
        "<hs_9>()<hs_end>",
        "<hs_0>(topic=0)<hs_end>",
        "<hs_0>(topic=-1)<hs_end>",
        "<hs_0>(topic=8)<hs_end>",
        "<hs_0>(topic=1.5)<hs_end>",
        "<hs_0>(topic=True)<hs_end>",
        "<hs_0>()<hs_end>",
        "<hs_0>(topic=1, topic=2)<hs_end>",
        "<hs_4>(product=1, topic=2)<hs_end>",
        "<hs_4>(topic=2, product_ref=1)<hs_end>",
        "<hs_4>(topic=2,product=1)<hs_end>",
        "<hs_8>(topic=1)<hs_end>",
        "<hs_0>(topic=1)",
        "<hs_0>(topic=1)<hs-end>",
        "설명 <hs_0>(topic=1)<hs_end>",
        "<hs_0>(topic=1)<hs_end> 설명",
        "```<hs_0>(topic=1)<hs_end>```",
        "<hs_0>(topic=1)<hs_end><hs_8>()<hs_end>",
        "x" * 513,
    ],
)
def test_invalid_output(contract, output):
    with pytest.raises(InvalidFunctionOutput):
        parse_function_output(output, contract)


def test_outer_whitespace(contract):
    result = parse_function_output(
        " \n<hs_0>(topic=1)<hs_end>\n", contract
    )
    assert result.arguments == {"topic": 1}


@pytest.mark.parametrize(
    "table",
    [
        {},
        [],
        {"bad-name": []},
        {"get_diagnosis": {}},
        {"get_diagnosis": [["topic", 0]]},
        {"get_diagnosis": [["topic", True]]},
        {"get_diagnosis": [["topic", "7"]]},
        {"get_diagnosis": [["topic", 7], ["topic", 7]]},
        {"get_diagnosis": [["topic"]]},
    ],
)
def test_invalid_function_table(tmp_path, document, table):
    document["functions"] = table
    with pytest.raises(InvalidFunctionContract):
        load(tmp_path, document)


@pytest.mark.parametrize("field", ["system_prompt", "functions", "stop_token"])
def test_missing_contract_fields(tmp_path, document, field):
    document.pop(field)
    with pytest.raises(InvalidFunctionContract):
        load(tmp_path, document)


def test_wrong_stop_token(tmp_path, document):
    document["stop_token"] = "<hs-end>"
    with pytest.raises(InvalidFunctionContract):
        load(tmp_path, document)


def test_duplicate_json_key(tmp_path):
    path = tmp_path / "cropy_prompt.json"
    path.write_text(
        '{"system_prompt":"a","system_prompt":"b"}',
        encoding="utf-8",
    )
    with pytest.raises(InvalidFunctionContract):
        load_function_contract(path)
