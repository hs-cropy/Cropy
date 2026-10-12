"""GPU-free behavioral tests of all independently distributed Colab modules."""

import datetime
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

VARIANTS = [
    "Colab_파일럿_v10",
    "Colab_파일럿_v11",
    "Colab_검수전_실험_v11",
    "Colab_검수전_100step_v12",
]


@pytest.fixture(params=VARIANTS)
def pilot(request):
    path = (
        Path(__file__).resolve().parents[1]
        / "Qwen35_데이터시트"
        / request.param
        / "cropy_qwen_pilot.py"
    )
    spec = importlib.util.spec_from_file_location("qwen_" + request.param, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def review():
    return {
        "decision": "approved",
        "reviewer": "김검수",
        "blind_reviewed_at": "2026-10-11",
        "reference_checked_at": "2026-10-12",
        "blind_function": "show_info",
        "blind_arguments": '{"topic":"disease"}',
        "blind_return_status": "success",
        "blind_tts": "병해 정보를 보여드립니다",
        "notes": "독립 판정 후 원문 대조 완료",
    }


@pytest.fixture
def gold():
    return {
        "function_name": "show_info",
        "arguments_json": '{"topic":"disease"}',
        "expected_return_status": "success",
    }


def freeze_utc(monkeypatch, pilot, instant):
    class FrozenDate(datetime.date):
        @classmethod
        def today(cls):
            return instant.date()  # Emulate a UTC-hosted Colab runtime.

    class FrozenDatetime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)

    # Patch this module only, never the shared datetime module or sys.path.
    monkeypatch.setattr(
        pilot,
        "datetime",
        SimpleNamespace(
            date=FrozenDate,
            datetime=FrozenDatetime,
            timezone=datetime.timezone,
            timedelta=datetime.timedelta,
        ),
    )


@pytest.mark.parametrize(
    "instant,review_date,accepted",
    [
        ("2026-10-11T14:59:00+00:00", "2026-10-12", False),  # 23:59 KST
        ("2026-10-11T15:00:00+00:00", "2026-10-12", True),  # midnight KST
        ("2026-10-11T23:59:00+00:00", "2026-10-12", True),  # 08:59 KST
        ("2026-10-12T00:00:00+00:00", "2026-10-12", True),  # 09:00 KST
        ("2026-10-12T00:00:00+00:00", "2026-10-13", False),  # actual future
    ],
)
def test_review_date_uses_kst_day(
    pilot, monkeypatch, review, gold, instant, review_date, accepted
):
    freeze_utc(monkeypatch, pilot, datetime.datetime.fromisoformat(instant))
    review.update(blind_reviewed_at=review_date, reference_checked_at=review_date)
    if accepted:
        assert pilot.review_accept(review, gold) is True
    else:
        with pytest.raises(ValueError, match="Invalid review date"):
            pilot.review_accept(review, gold)


@pytest.mark.parametrize(
    "field,value",
    [
        ("blind_reviewed_at", "2026-10-13"),
        ("reference_checked_at", "2026-10-14"),
        ("reference_checked_at", "not-a-date"),
        ("blind_arguments", "not-json"),
        ("blind_function", "other_function"),
        ("blind_arguments", '{"topic":"prevention"}'),
        ("blind_return_status", "failure"),
        ("reviewer", "ChatGPT"),
        ("reviewer", "Codex"),
        ("reviewer", "AI reviewer"),
        ("reviewer", "챗지피티"),
    ],
)
def test_review_rejects_invalid_approval(
    pilot, monkeypatch, review, gold, field, value
):
    freeze_utc(
        monkeypatch,
        pilot,
        datetime.datetime(2026, 10, 12, 3, tzinfo=datetime.timezone.utc),
    )
    review[field] = value
    with pytest.raises(ValueError):
        pilot.review_accept(review, gold)


@pytest.mark.parametrize(
    "field",
    [
        "reviewer",
        "blind_reviewed_at",
        "reference_checked_at",
        "blind_function",
        "blind_arguments",
        "blind_return_status",
        "blind_tts",
        "notes",
    ],
)
def test_review_requires_independent_fields(pilot, review, gold, field):
    del review[field]
    with pytest.raises(ValueError, match="independent review fields"):
        pilot.review_accept(review, gold)


@pytest.mark.parametrize("decision", [None, "pending", "rejected"])
def test_unapproved_rows_are_not_accepted(pilot, gold, decision):
    assert pilot.review_accept({"decision": decision}, gold) is False


@pytest.fixture
def definitions():
    return {
        "show_info": {
            "required": ["topic", "product_ref"],
            "properties": {
                "topic": {"enum": ["disease", "prevention"]},
                "product_ref": {"enum": ["current", "previous"]},
            },
        }
    }


def test_parse_valid_call_preserves_schema_arguments(pilot, definitions):
    assert pilot.parse_output(
        ["<hs_show_info>", "<hs_topic_disease>", "<hs_product_current>", "<hs-end>"],
        definitions,
    ) == ("show_info", {"topic": "disease", "product_ref": "current"})


@pytest.mark.parametrize(
    "tokens,error",
    [
        ([], "hs-end"),
        (["<hs_show_info>", "<hs_topic_disease>", "<hs_product_current>"], "hs-end"),
        (["<hs_show_info>", "<hs-end>", "<hs-end>"], "hs-end"),
        (["<hs_show_info>", "<hs-end>", "trailing text"], "hs-end"),
        (["<hs_unknown>", "<hs-end>"], "Unknown function"),
        (["not-a-function", "<hs-end>"], "Unknown function"),
        (
            [
                "<hs_show_info>",
                "<hs_product_current>",
                "<hs_topic_disease>",
                "<hs-end>",
            ],
            "argument order",
        ),
        (
            [
                "<hs_show_info>",
                "<hs_unknown_disease>",
                "<hs_product_current>",
                "<hs-end>",
            ],
            "argument order",
        ),
        (
            [
                "<hs_show_info>",
                "<hs_topic_unknown>",
                "<hs_product_current>",
                "<hs-end>",
            ],
            "Unknown enum",
        ),
        (["<hs_show_info>", "<hs_topic_disease>", "<hs-end>"], "argument count"),
        (
            [
                "<hs_show_info>",
                "<hs_topic_disease>",
                "<hs_product_current>",
                "<hs_show_info>",
                "<hs_topic_prevention>",
                "<hs_product_previous>",
                "<hs-end>",
            ],
            "multiple calls",
        ),
    ],
)
def test_parse_rejects_invalid_call(pilot, definitions, tokens, error):
    with pytest.raises(ValueError, match=error):
        pilot.parse_output(tokens, definitions)
