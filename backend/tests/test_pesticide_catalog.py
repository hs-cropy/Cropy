"""Registration conditions belong to each crop/disease use, never the product."""

import json
import logging
import sys
from datetime import datetime, timezone
from xml.sax.saxutils import escape

import httpx
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.entities import Disease, DiseasePesticide, Pesticide
from app.services import seed as seed_module
from scripts import sync_pesticides as sync


DISEASES = [
    {"key": "radish_downy_mildew", "name": "무 노균병", "crop_type": "무", "model_class_id": 3},
    {"key": "cabbage_downy_mildew", "name": "배추 노균병", "crop_type": "배추", "model_class_id": 5},
]
QUERIES = {"radish_downy_mildew": ("무", "노균병"), "cabbage_downy_mildew": ("배추", "노균병")}
SYNCED = "2026-09-23T03:00:00+00:00"


def item(code="123", sequence="1", crop="무", phi="수확3일전", **changes):
    return {
        "pestiCode": code, "diseaseUseSeq": sequence, "pestiBrandName": "제품A",
        "pestiKorName": "성분A 수화제", "cropName": crop, "diseaseWeedName": "노균병",
        "pestiUse": "경엽처리", "dilutUnit": "1000배", "useSuittime": phi, "useNum": "3회",
        **changes,
    }


def xml(items=(), total=None, code=None):
    records = "".join("<item>" + "".join(f"<{key}>{escape(value)}</{key}>" for key, value in row.items()) + "</item>" for row in items)
    status = f"<resultCode>{code}</resultCode>" if code else ""
    return f"<service>{status}<totalCount>{len(items) if total is None else total}</totalCount><list>{records}</list></service>"


DETAIL_FIELDS = ("pestiKorName", "pestiBrandName", "cropName", "diseaseWeedName", "pestiUse", "dilutUnit", "useSuittime", "useNum")


def detail_xml(row=None, **changes):
    fields = {**{key: row[key] for key in DETAIL_FIELDS if key in row}, **changes} if row else changes
    return "<service>" + "".join(f"<{key}>{escape(value)}</{key}>" for key, value in fields.items()) + "</service>"


def client_for(payload, detail=None):
    """SVC01 answers with ``payload``; SVC02 mirrors the listed item unless ``detail`` overrides it."""
    listed = {}
    def reply(request):
        params = request.url.params
        if params["serviceCode"] == "SVC02":
            row = listed[(params["pestiCode"], params["diseaseUseSeq"])]
            return detail(request, row) if detail else detail_xml(row)
        text = payload(request) if callable(payload) else payload
        try:
            listed.update({(row["pestiCode"], row["diseaseUseSeq"]): row for row in sync._parse_page(text)[1]})
        except ValueError:
            pass  # Error payloads are exercised by the code under test.
        return text
    return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=reply(request))))


@pytest.fixture(autouse=True)
def no_rate_limit_delay(monkeypatch):
    monkeypatch.setattr(sync, "MIN_REQUEST_INTERVAL", 0)


def catalog(products=None, usages=None):
    return {
        "schema_version": 1, "source": "PSIS", "synced_at": SYNCED,
        "queries": [{"disease_key": key, "crop": crop, "disease": disease, "count": 1} for key, (crop, disease) in QUERIES.items()],
        "products": products if products is not None else [{"key": "psis_123", "name": "제품A", "registration_no": "PSIS-123", "active_ingredient": "성분A"}],
        "usages": usages if usages is not None else [
            {"key": "radish:123:1", "disease_key": "radish_downy_mildew", "pesticide_key": "psis_123", "source_usage_key": "123:1", "priority": 2, "phi_days": 3, "dilution": "1000배", "usage_method": "경엽처리", "verification_status": "verified"},
            {"key": "cabbage:123:2", "disease_key": "cabbage_downy_mildew", "pesticide_key": "psis_123", "source_usage_key": "123:2", "priority": 1, "phi_days": 21, "dilution": "500배", "usage_method": "관주처리", "verification_status": "verified"},
        ],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    directory = tmp_path / "seed"
    directory.mkdir()
    monkeypatch.setattr(seed_module, "SEED_DIR", directory)
    (directory / "diseases.json").write_text(json.dumps(DISEASES), encoding="utf-8")
    engine = create_engine(f"sqlite:///{tmp_path / 'catalog.db'}")
    event.listen(engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
    # Importing seed must register all of its tables before create_all.
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        yield db, directory
    engine.dispose()


def write_catalog(directory, data):
    (directory / "pesticide_catalog.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


@pytest.mark.parametrize("payload", [
    "<service><errorCode>ERR_101</errorCode></service>",
    "<service><errorCode>ERR_901</errorCode><totalCount>0</totalCount><list/></service>",
    "<html><body>maintenance</body></html>",
    "<service><totalCount>0</totalCount><unexpected/></service>",
    "<service><list/></service>",
    "<service><totalCount>broken</totalCount><list/></service>",
    "<service><errorMsg>temporarily unavailable</errorMsg><totalCount>0</totalCount><list/></service>",
    "<service><totalCount>0</totalCount><totalCount>12</totalCount><list/></service>",
    "<service><totalCount>0</totalCount><list/><list/></service>",
    "<service>",
])
def test_error_or_unknown_xml_cannot_be_treated_as_no_registrations(payload):
    with client_for(payload) as client, pytest.raises(ValueError):
        sync.fetch_items(client, "fake-test-key", "무", "노균병")


def test_explicit_zero_is_a_valid_empty_result():
    with client_for(xml()) as client:
        assert sync.fetch_items(client, "fake-test-key", "무", "노균병") == []


def test_live_svc01_envelope_with_build_time_and_paging_echo_is_accepted():
    # The live service (2026-10-20) adds buildTime/displayCount/startPoint, absent from the v1.0 guide.
    row = item()
    records = "<item>" + "".join(f"<{key}>{escape(value)}</{key}>" for key, value in row.items()) + "</item>"
    payload = (f"<service><totalCount>1</totalCount><buildTime>23:20:04[981]</buildTime><list>{records}</list>"
               "<displayCount>50</displayCount><startPoint>1</startPoint></service>")
    with client_for(payload) as client:
        assert [r["pestiCode"] for r in sync.fetch_items(client, "fake-test-key", "무", "노균병")] == ["123"]


def test_fetches_later_pages_without_assuming_a_short_page_is_complete():
    first = item()
    later = item(sequence="2", phi="수확21일전")
    def reply(request):
        assert request.url.params["cropCheck"] == "Y"
        return xml([first] if request.url.params["startPoint"] == "1" else [later], total=2)
    with client_for(reply) as client:
        records = sync.fetch_items(client, "fake-test-key", "무", "노균병")
    assert [row["useSuittime"] for row in records] == ["수확3일전", "수확21일전"]


def test_repeated_or_truncated_pages_fail_closed():
    with client_for(xml([item()], total=2)) as client, pytest.raises(ValueError):
        sync.fetch_items(client, "fake-test-key", "무", "노균병")


def _offset_service(rows, total=None):
    """Live PSIS behaviour (2026-10-20): startPoint is a 1-based record offset, not a page number."""
    def reply(request):
        start = int(request.url.params["startPoint"])
        size = int(request.url.params["displayCount"])
        return xml(rows[start - 1:start - 1 + size], total=len(rows) if total is None else total)
    return reply


def test_pagination_sends_record_offsets_like_the_live_service():
    rows = [item(sequence=str(index)) for index in range(1, 86)]
    starts = []
    service = _offset_service(rows)
    def reply(request):
        starts.append(request.url.params["startPoint"])
        return service(request)
    with client_for(reply) as client:
        result = sync.fetch_items(client, "fake-test-key", "무", "노균병")
    assert starts == ["1", "51"]
    assert [row["diseaseUseSeq"] for row in result] == [str(index) for index in range(1, 86)]


def test_page_number_semantics_would_be_caught_as_repeated_records():
    # If startPoint were sent as 2 against an offset service, page 2 would repeat 49 records.
    rows = [item(sequence=str(index)) for index in range(1, 86)]
    service = _offset_service(rows)
    def page_number_reply(request):
        page = int(request.url.params["startPoint"])
        request.url = request.url.copy_merge_params({"startPoint": "2" if page > 1 else "1"})
        return service(request)
    with client_for(page_number_reply) as client, pytest.raises(ValueError):
        sync.fetch_items(client, "fake-test-key", "무", "노균병")


@pytest.mark.parametrize("changes", [{"pestiCode": ""}, {"diseaseUseSeq": ""}, {"cropName": "배추"}, {"diseaseWeedName": ""}])
def test_missing_identity_or_wrong_crop_is_rejected(changes):
    with client_for(xml([item(**changes)])) as client, pytest.raises(ValueError):
        sync.fetch_items(client, "fake-test-key", "무", "노균병")


def test_substring_disease_matches_are_excluded_and_recorded_not_fatal():
    # Live: "검은무늬병" with similarFlag=N also returns "세균검은무늬병"; "탄저병" returns "전착효과(탄저병)".
    rows = [item(sequence="1"), item(sequence="2", diseaseWeedName="세균노균병"),
            item(sequence="3", diseaseWeedName="전착효과(노균병)"), item(sequence="4", diseaseWeedName="세균노균병")]
    with client_for(xml(rows)) as client:
        matched, excluded, total = sync.fetch_registrations(client, "fake-test-key", "무", "노균병")
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    assert [row["diseaseUseSeq"] for row in matched] == ["1"]
    assert excluded == {"세균노균병": 2, "전착효과(노균병)": 1}
    assert total == 4
    assert catalog["queries"] == [{"disease_key": "radish_downy_mildew", "crop": "무", "disease": "노균병", "count": 1,
                                   "source_total": 4, "excluded_disease_names": {"세균노균병": 2, "전착효과(노균병)": 1},
                                   "excluded_aerial_usages": 0}]
    assert [usage["source_usage_key"] for usage in catalog["usages"]] == ["123:1"]


@pytest.mark.parametrize("method,aerial", [
    ("발병 초부터 경엽처리(무인항공)", True),   # live value (캐스팅, 무 노균병)
    ("무인헬기 살포", True), ("드론 방제", True), ("항공방제", True),
    ("경엽처리(항공)", True), ("항공살포", True), ("항공 살포", True), ("무인 항공 방제", True), ("무인기 살포", True),
    ("발병 초부터 경엽처리", False), ("관주처리", False), ("토양혼화", False), ("", False), (None, False),
])
def test_aerial_use_detection(method, aerial):
    assert sync.is_aerial_use(method) is aerial


@pytest.mark.parametrize("where", ["list", "detail"])
def test_plain_aerial_wording_is_excluded_from_list_or_detail(where):
    # 리뷰: "(항공)"·"항공살포"가 걸러지지 않아 항공 사용량이 verified로 저장됐다.
    listed = item(pestiUse="경엽처리(항공)" if where == "list" else "발병 초부터 경엽처리", dilutUnit="- 100㎖/10a")
    def detail(request, row):
        return detail_xml(row, pestiUse="경엽처리(항공)", dilutUnit="- 100㎖/10a")
    with client_for(xml([listed]), detail) as client:
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    assert catalog["usages"] == [] and catalog["products"] == []
    assert catalog["queries"][0]["excluded_aerial_usages"] == 1


def test_product_excluded_by_its_detail_does_not_use_up_a_slot():
    # 리뷰: 상세에서 제외된 A가 슬롯을 차지해 정상 제품 B가 선택되지 않았다.
    rows = [item(code="A", pestiKorName="성분A"), item(code="B", pestiKorName="성분B")]
    def detail(request, row):
        aerial = request.url.params["pestiCode"] == "A"
        return detail_xml(row, pestiUse="경엽처리(무인항공)" if aerial else "발병 초부터 경엽처리")
    with client_for(xml(rows), detail) as client:
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")},
                                     max_per_disease=1)
    assert [(u["pesticide_key"], u["priority"]) for u in catalog["usages"]] == [("psis_B", 1)]
    assert [p["key"] for p in catalog["products"]] == ["psis_B"]


def test_aerial_usages_are_excluded_and_never_take_a_product_slot():
    # Live: 캐스팅 has a ground use (2000배) and an aerial use (- 100㎖/10a).
    rows = [
        item(code="1", sequence="1", pestiKorName="성분A", pestiUse="경엽처리(무인항공)", dilutUnit="- 100㎖/10a"),
        item(code="2", sequence="1", pestiKorName="성분B", pestiUse="발병 초부터 경엽처리", dilutUnit="2000배 -"),
        item(code="2", sequence="2", pestiKorName="성분B", pestiUse="발병 초부터 경엽처리(무인항공)"),
        item(code="3", sequence="1", pestiKorName="성분C"),
    ]
    with client_for(xml(rows)) as client:
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")},
                                     max_per_disease=2)
    assert [(u["source_usage_key"], u["dilution"]) for u in catalog["usages"]] == [("2:1", "2000배"), ("3:1", "1000배")]
    assert sorted(p["key"] for p in catalog["products"]) == ["psis_2", "psis_3"]  # aerial-only product 1 is absent
    assert catalog["queries"][0]["excluded_aerial_usages"] == 2


def test_aerial_use_revealed_only_by_the_detail_is_also_excluded():
    def detail(request, row):
        return detail_xml(row, pestiUse="발병 초부터 경엽처리(무인항공)")
    with client_for(xml([item()]), detail) as client:
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    assert catalog["usages"] == [] and catalog["products"] == []
    assert catalog["queries"][0]["excluded_aerial_usages"] == 1


def test_duplicates_are_rejected_even_among_excluded_names():
    rows = [item(sequence="1"), item(sequence="2", diseaseWeedName="세균노균병"), item(sequence="2", diseaseWeedName="세균노균병")]
    with client_for(xml(rows)) as client, pytest.raises(ValueError):
        sync.fetch_items(client, "fake-test-key", "무", "노균병")


def test_same_product_preserves_every_crop_and_usage_condition():
    def reply(request):
        crop = request.url.params["cropName"]
        return xml([item(crop=crop, phi="수확3일전" if crop == "무" else "수확21일전", sequence="1" if crop == "무" else "2")])
    with client_for(reply) as client:
        result = sync.build_catalog(client, "fake-test-key", queries=QUERIES)
    assert len(result["products"]) == 1
    assert [(row["disease_key"], row["phi_days"]) for row in result["usages"]] == [("radish_downy_mildew", 3), ("cabbage_downy_mildew", 21)]
    assert {row["source_usage_key"] for row in result["usages"]} == {"123:1", "123:2"}


def test_multiple_uses_of_selected_product_survive_product_limit():
    with client_for(xml([item(sequence="1"), item(sequence="2", phi="수확21일전")])) as client:
        result = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")}, max_per_disease=1)
    assert [row["phi_days"] for row in result["usages"]] == [3, 21]


def test_partial_query_failure_preserves_previous_catalog(tmp_path):
    target = tmp_path / "pesticide_catalog.json"
    target.write_text("old complete snapshot", encoding="utf-8")
    def reply(request):
        return xml([item()]) if request.url.params["cropName"] == "무" else "<service><errorCode>ERR_901</errorCode></service>"
    with client_for(reply) as client, pytest.raises(ValueError):
        sync.sync_catalog(client, "fake-test-key", target, queries=QUERIES)
    assert target.read_text(encoding="utf-8") == "old complete snapshot"


def test_atomic_publish_failure_preserves_previous_catalog(tmp_path, monkeypatch):
    target = tmp_path / "pesticide_catalog.json"
    target.write_text("old complete snapshot", encoding="utf-8")
    def interrupted_replace(source, destination):
        raise OSError("simulated interruption")
    monkeypatch.setattr(sync.os, "replace", interrupted_replace)
    with client_for(xml()) as client, pytest.raises(OSError):
        sync.sync_catalog(client, "fake-test-key", target, queries=QUERIES)
    assert target.read_text(encoding="utf-8") == "old complete snapshot"
    assert list(tmp_path.iterdir()) == [target]


def test_all_queries_explicitly_empty_can_publish_one_complete_catalog(tmp_path):
    target = tmp_path / "pesticide_catalog.json"
    with client_for(xml()) as client:
        sync.sync_catalog(client, "fake-test-key", target, queries=QUERIES)
    result = json.loads(target.read_text(encoding="utf-8"))
    assert result["products"] == []
    assert result["usages"] == []
    assert [row["count"] for row in result["queries"]] == [0, 0]


@pytest.mark.parametrize("value,want", [("수확3일전", 3), ("수확 21 일 전", 21), ("수확 3~7일전", None), ("수확3일전 또는 수확21일전", None)])
def test_phi_does_not_guess_a_number_from_ambiguous_source(value, want):
    assert sync.parse_phi_days(value) == want


@pytest.mark.parametrize("raw,want", [
    ("1000배 -", "1000배"),            # live ground-spray value
    ("- 100㎖/10a", "100㎖/10a"),       # live aerial-spray value
    ("60배 3ℓ/10a", "60배 3ℓ/10a"),     # guide example
    ("-", None), ("", None), (None, None),
])
def test_dilution_values_are_cleaned_like_live_psis_data(raw, want):
    assert sync.clean_dilution(raw) == want


def test_dash_placeholders_are_treated_as_missing_not_shown():
    # Live: microbial products have useNum "-" and a non-PHI rule such as "발생초기".
    def detail(request, row):
        return detail_xml(row, useSuittime="발생초기", useNum="-", toxicName="저독성", fishToxicGubun="Ⅲ급", dilutUnit="-")
    with client_for(xml([item(useNum="-", dilutUnit="-")]), detail) as client:
        usage = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})["usages"][0]
    assert usage["safety_notes"] == "안전사용기준: 발생초기 / 독성: 저독성 / 어독성: Ⅲ급"
    assert usage["phi_days"] is None
    assert usage["dilution"] is None


def test_same_ingredient_product_takes_the_slot_when_the_first_is_excluded_by_detail():
    rows = [item(code="A", pestiKorName="같은성분"), item(code="B", pestiKorName="같은성분")]
    def detail(request, row):
        aerial = request.url.params["pestiCode"] == "A"
        return detail_xml(row, pestiUse="경엽처리(무인항공)" if aerial else "발병 초부터 경엽처리")
    with client_for(xml(rows), detail) as client:
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    assert [(u["pesticide_key"], u["priority"]) for u in catalog["usages"]] == [("psis_B", 1)]


def test_partly_excluded_product_keeps_its_ground_uses_and_priorities_stay_consecutive():
    rows = [item(code="A", sequence="1", pestiKorName="성분A"), item(code="A", sequence="2", pestiKorName="성분A"),
            item(code="B", sequence="1", pestiKorName="성분B")]
    def detail(request, row):
        aerial = (request.url.params["pestiCode"], request.url.params["diseaseUseSeq"]) == ("A", "2")
        return detail_xml(row, pestiUse="경엽처리(무인항공)" if aerial else "발병 초부터 경엽처리")
    with client_for(xml(rows), detail) as client:
        catalog = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    assert [(u["source_usage_key"], u["priority"]) for u in catalog["usages"]] == [("A:1", 1), ("B:1", 2)]
    assert catalog["queries"][0]["excluded_aerial_usages"] == 1


def test_detail_values_win_when_list_and_detail_disagree():
    listed = item(dilutUnit="1000배", useSuittime="수확3일전", useNum="3회")
    def detail(request, row):
        return detail_xml(row, dilutUnit="2000배", useSuittime="수확7일전", useNum="2회")
    with client_for(xml([listed]), detail) as client:
        usage = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})["usages"][0]
    assert (usage["dilution"], usage["phi_days"]) == ("2000배", 7)
    assert usage["safety_notes"].startswith("안전사용기준: 수확7일전 / 사용횟수: 2회")


def test_cli_never_logs_the_api_key_even_when_info_logging_is_on(tmp_path, monkeypatch, caplog):
    secret = "secret-psis-key-0000"
    monkeypatch.setenv("PSIS_API_KEY", secret)
    monkeypatch.setattr(sys, "argv", ["sync_pesticides.py", "--output", str(tmp_path / "catalog.json")])
    monkeypatch.setattr(sync, "DISEASE_QUERIES", {"radish_downy_mildew": ("무", "노균병")})
    fake = client_for(xml([item()]))
    monkeypatch.setattr(sync.httpx, "Client", lambda *args, **kwargs: fake)
    caplog.set_level(logging.INFO)
    try:
        sync.main()
    finally:
        for name in ("httpx", "httpcore"):
            logging.getLogger(name).setLevel(logging.NOTSET)
    assert (tmp_path / "catalog.json").exists()
    assert secret not in caplog.text


@pytest.mark.parametrize("blank", ["-", "", None])
def test_blank_detail_fields_are_never_back_filled_from_the_list(blank):
    # 리뷰: 상세가 "-"·빈 값·누락인데 목록의 1000배·수확3일전·3회로 채워 verified로 저장했다.
    listed = item(dilutUnit="1000배", useSuittime="수확3일전", useNum="3회", pestiUse="경엽처리")
    def detail(request, row):
        fields = {"pestiKorName": row["pestiKorName"], "pestiBrandName": row["pestiBrandName"],
                  "cropName": row["cropName"], "diseaseWeedName": row["diseaseWeedName"]}
        if blank is not None:
            fields.update(dilutUnit=blank, useSuittime=blank, useNum=blank, pestiUse=blank)
        return detail_xml(**fields)
    with client_for(xml([listed]), detail) as client:
        usage = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})["usages"][0]
    assert (usage["dilution"], usage["usage_method"], usage["phi_days"], usage["safety_notes"]) == (None, None, None, None)


def test_usage_conditions_and_toxicity_come_from_svc02_detail():
    # The SVC01 response spec has no dilution/safety fields; SVC02 documents them.
    listed = {key: value for key, value in item().items() if key not in {"dilutUnit", "useSuittime", "useNum", "pestiUse"}}
    requests = []
    def detail(request, row):
        requests.append(dict(request.url.params))
        return detail_xml(row, pestiUse="발병초 경엽처리", dilutUnit="2000배 -", useSuittime="수확 7일 전까지",
                          useNum="3회 이내", toxicName="저독성", fishToxicGubun="Ⅲ급")
    with client_for(xml([listed]), detail) as client:
        result = sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    assert requests == [{"apiKey": "fake-test-key", "serviceCode": "SVC02", "pestiCode": "123", "diseaseUseSeq": "1"}]
    usage = result["usages"][0]
    assert (usage["dilution"], usage["usage_method"], usage["phi_days"]) == ("2000배", "발병초 경엽처리", 7)
    assert usage["safety_notes"] == "안전사용기준: 수확 7일 전까지 / 사용횟수: 3회 이내 / 독성: 저독성 / 어독성: Ⅲ급"
    assert usage["source_payload"]["detail"]["toxicName"] == "저독성"
    assert usage["source_usage_key"] == "123:1"


def test_detail_is_requested_only_for_selected_products():
    rows = [item(code="1", pestiKorName="성분A"), item(code="2", pestiKorName="성분B")]
    codes = []
    def detail(request, row):
        codes.append(request.url.params["pestiCode"])
        return detail_xml(row)
    with client_for(xml(rows), detail) as client:
        sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")}, max_per_disease=1)
    assert codes == ["1"]


@pytest.mark.parametrize("make_detail", [
    lambda row: "<service><errorCode>ERR_201</errorCode></service>",
    lambda row: "<service><errorMsg>temporarily unavailable</errorMsg></service>",
    lambda row: detail_xml(row, pestiBrandName="다른제품"),
    lambda row: detail_xml(row, cropName="배추"),
    lambda row: detail_xml(row, diseaseWeedName="탄저병"),
    lambda row: "<service><pestiKorName><b>nested</b></pestiKorName></service>",
    lambda row: "<html><body>maintenance</body></html>",
])
def test_bad_or_mismatched_detail_preserves_previous_catalog(tmp_path, make_detail):
    target = tmp_path / "pesticide_catalog.json"
    target.write_text("old complete snapshot", encoding="utf-8")
    with client_for(xml([item()]), lambda request, row: make_detail(row)) as client, pytest.raises(ValueError):
        sync.sync_catalog(client, "fake-test-key", target, queries={"radish_downy_mildew": ("무", "노균병")})
    assert target.read_text(encoding="utf-8") == "old complete snapshot"


def test_requests_are_spaced_to_the_documented_rate_limit(monkeypatch):
    monkeypatch.setattr(sync, "MIN_REQUEST_INTERVAL", 0.12)
    monkeypatch.setattr(sync, "_last_request_at", float("-inf"))
    clock, sleeps = [100.0], []
    monkeypatch.setattr(sync.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(sync.time, "sleep", lambda seconds: (sleeps.append(seconds), clock.__setitem__(0, clock[0] + seconds)))
    with client_for(xml([item()])) as client:
        sync.build_catalog(client, "fake-test-key", queries={"radish_downy_mildew": ("무", "노균병")})
    # One SVC01 page, then one SVC02 detail issued without any time passing.
    assert sleeps == [pytest.approx(0.12)]


def test_synced_catalog_loads_into_database_as_verified(store, tmp_path):
    db, directory = store
    def reply(request):
        crop = request.url.params["cropName"]
        return xml([item(crop=crop, sequence="1" if crop == "무" else "2")])
    def detail(request, row):
        return detail_xml(row, toxicName="저독성")
    with client_for(reply, detail) as client:
        sync.sync_catalog(client, "fake-test-key", directory / "pesticide_catalog.json", queries=QUERIES)
    seed_module.seed_database(db)
    from app.services.pesticide_service import pesticide_infos
    radish = db.query(Disease).filter_by(model_class_id=3).one()
    info = pesticide_infos(db, radish.id)[0]
    assert (info.verification_status, info.source, info.dilution, info.safety.phi_days) == ("verified", "PSIS", "1000배", 3)
    assert "독성: 저독성" in info.safety_notes


def test_catalog_conditions_are_scoped_to_disease_and_idempotent(store):
    db, directory = store
    write_catalog(directory, catalog())
    seed_module.seed_database(db)
    seed_module.seed_database(db)
    from app.models.pesticide_usage import PesticideUsage
    from app.services.pesticide_service import pesticide_infos
    assert db.query(Pesticide).count() == 1
    assert db.query(PesticideUsage).count() == 2
    radish = db.query(Disease).filter_by(model_class_id=3).one()
    cabbage = db.query(Disease).filter_by(model_class_id=5).one()
    first = pesticide_infos(db, radish.id)[0]
    second = pesticide_infos(db, cabbage.id)[0]
    assert (first.safety.phi_days, first.dilution, first.usage) == (3, "1000배", "경엽처리")
    assert (second.safety.phi_days, second.dilution, second.usage) == (21, "500배", "관주처리")
    assert first.verification_status == "verified"
    assert first.source == "PSIS"
    assert first.synced_at == datetime(2026, 9, 23, 3, tzinfo=timezone.utc)


def test_registration_identity_survives_product_rename(store):
    db, directory = store
    original = catalog()
    write_catalog(directory, original)
    seed_module.seed_database(db)
    pesticide_id = db.query(Pesticide).one().id
    original["products"][0]["name"] = "새 상표명"
    write_catalog(directory, original)
    seed_module.seed_database(db)
    assert db.query(Pesticide).one().id == pesticide_id
    assert db.query(Pesticide).one().name == "새 상표명"


def test_deregistered_products_and_usages_are_removed_with_foreign_keys_enabled(store):
    db, directory = store
    write_catalog(directory, catalog())
    seed_module.seed_database(db)
    empty = catalog([], [])
    for query in empty["queries"]:
        query["count"] = 0
    write_catalog(directory, empty)
    seed_module.seed_database(db)
    from app.models.pesticide_usage import PesticideUsage
    assert db.query(PesticideUsage).count() == 0
    assert db.query(Pesticide).count() == 0
    assert db.query(DiseasePesticide).count() == 0
    assert db.query(Disease).count() == 2


def test_invalid_catalog_does_not_partially_update_database(store):
    db, directory = store
    write_catalog(directory, catalog())
    seed_module.seed_database(db)
    invalid = catalog()
    invalid["products"][0]["name"] = "should never persist"
    invalid["usages"][1]["pesticide_key"] = "nonexistent"
    write_catalog(directory, invalid)
    with pytest.raises(ValueError):
        seed_module.seed_database(db)
    assert db.query(Pesticide).one().name == "제품A"


def test_legacy_conditions_are_never_returned_as_verified_for_each_crop(store):
    db, directory = store
    product = {"key": "a", "name": "기존 제품", "registration_no": "PSIS-123", "phi_days": 3, "dilution": "1000배", "usage_method": "관주", "reentry_hours": 12, "safety_notes": "수확3일전"}
    mappings = [{"disease_key": row["key"], "pesticide_key": "a", "priority": 1} for row in DISEASES]
    (directory / "pesticides.json").write_text(json.dumps([product]), encoding="utf-8")
    (directory / "disease_pesticides.json").write_text(json.dumps(mappings), encoding="utf-8")
    seed_module.seed_database(db)
    from app.services.pesticide_service import pesticide_infos
    for disease in db.query(Disease).all():
        result = pesticide_infos(db, disease.id)[0]
        assert result.name == "기존 제품"
        assert result.verification_status == "legacy_unverified"
        assert result.synced_at is None
        assert result.dilution is None and result.usage is None
        assert result.safety.phi_days is None and result.safety.reentry_hours is None
        assert "수확3일전" not in (result.safety_notes or "")


def test_priority_and_stable_registration_tie_order(store):
    db, directory = store
    products = [{"key": key, "name": key, "registration_no": key} for key in ["Z", "B", "A"]]
    usages = [{"key": key, "pesticide_key": key, "disease_key": "radish_downy_mildew", "source_usage_key": key, "verification_status": "verified", "priority": priority} for key, priority in [("Z", 1), ("B", 3), ("A", 3)]]
    data = catalog(products, usages)
    data["queries"][0]["count"] = 3
    data["queries"][1]["count"] = 0
    write_catalog(directory, data)
    seed_module.seed_database(db)
    from app.services.pesticide_service import pesticide_infos
    disease = db.query(Disease).filter_by(model_class_id=3).one()
    assert [row.name for row in pesticide_infos(db, disease.id)] == ["Z", "A", "B"]


@pytest.mark.parametrize("mutation", ["wrong_crop", "empty_disease", "zero_with_usage", "unknown_disease", "missing_query", "same_registration", "normal_class", "wrong_payload"])
def test_inconsistent_catalog_cannot_replace_existing_state(store, mutation):
    db, directory = store
    write_catalog(directory, catalog())
    seed_module.seed_database(db)
    invalid = catalog()
    invalid["products"][0]["name"] = "should never persist"
    if mutation == "wrong_crop":
        invalid["queries"][0]["crop"] = "배추"
    elif mutation == "empty_disease":
        invalid["queries"][0]["disease"] = ""
    elif mutation == "zero_with_usage":
        invalid["queries"][0]["count"] = 0
    elif mutation == "unknown_disease":
        invalid["usages"][0]["disease_key"] = "pepper_healthy"
    elif mutation == "missing_query":
        invalid["queries"].pop()
    elif mutation == "normal_class":
        (directory / "diseases.json").write_text(json.dumps([*DISEASES, {"key": "pepper_healthy", "name": "고추 정상", "crop_type": "고추", "category": "normal", "model_class_id": 6}]), encoding="utf-8")
        invalid["usages"][0]["disease_key"] = "pepper_healthy"
    elif mutation == "wrong_payload":
        invalid["usages"][0]["source_payload"] = item(crop="배추")
    else:
        invalid["products"].append({**invalid["products"][0], "key": "duplicate"})
    write_catalog(directory, invalid)
    with pytest.raises(ValueError):
        seed_module.seed_database(db)
    assert db.query(Pesticide).one().name == "제품A"


def test_same_name_with_different_registration_stays_two_products(store):
    db, directory = store
    data = catalog()
    data["products"].append({**data["products"][0], "key": "psis_456", "registration_no": "PSIS-456"})
    data["usages"][1]["pesticide_key"] = "psis_456"
    write_catalog(directory, data)
    db.autoflush = False
    seed_module.seed_database(db)
    seed_module.seed_database(db)
    assert {row.registration_no for row in db.query(Pesticide).all()} == {"PSIS-123", "PSIS-456"}


def test_legacy_to_verified_upgrade_preserves_product_identity(store):
    db, directory = store
    product = {"key": "old", "name": "Old name", "registration_no": "PSIS-123", "phi_days": 3}
    (directory / "pesticides.json").write_text(json.dumps([product]), encoding="utf-8")
    (directory / "disease_pesticides.json").write_text(json.dumps([{"disease_key": "radish_downy_mildew", "pesticide_key": "old"}]), encoding="utf-8")
    seed_module.seed_database(db)
    original_id = db.query(Pesticide).one().id
    write_catalog(directory, catalog())
    seed_module.seed_database(db)
    from app.models.pesticide_usage import PesticideUsage
    assert db.query(Pesticide).one().id == original_id
    assert {row.verification_status for row in db.query(PesticideUsage)} == {"verified"}
    assert db.query(Pesticide).one().phi_days is None


def test_database_error_rolls_back_changed_product_and_existing_usages(store):
    db, directory = store
    write_catalog(directory, catalog())
    seed_module.seed_database(db)
    changed = catalog()
    changed["products"][0]["name"] = "should roll back"
    changed["usages"][0]["phi_days"] = 99
    write_catalog(directory, changed)
    from sqlalchemy.exc import IntegrityError
    def reject_usage_update(connection, cursor, statement, parameters, context, many):
        if statement.startswith("UPDATE pesticide_usages"):
            raise IntegrityError(statement, parameters, Exception("simulated constraint failure"))
    event.listen(db.bind, "before_cursor_execute", reject_usage_update)
    try:
        with pytest.raises(IntegrityError):
            seed_module.seed_database(db)
    finally:
        event.remove(db.bind, "before_cursor_execute", reject_usage_update)
    assert db.query(Pesticide).one().name == "제품A"
    from app.models.pesticide_usage import PesticideUsage
    assert db.query(PesticideUsage).filter_by(key="radish:123:1").one().phi_days == 3
