"""Registration conditions belong to each crop/disease use, never the product."""

import json
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


def client_for(payload):
    return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=payload(request) if callable(payload) else payload)))


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
