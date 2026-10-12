"""Apply one complete catalog snapshot; legacy product conditions stay unverified."""

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.entities import Disease, DiseasePesticide, Pesticide
from app.models.pesticide_usage import PesticideUsage


SEED_DIR = Path(__file__).resolve().parent.parent / "data" / "seed"
PESTICIDE_FIELDS = ("name", "active_ingredient", "registration_no", "dilution", "usage_method", "phi_days", "reentry_hours", "safety_notes")
USAGE_FIELDS = ("source_usage_key", "dilution", "usage_method", "phi_days", "reentry_hours", "safety_notes", "priority", "source", "verification_status", "synced_at", "source_payload")


def _disease_values(item: dict) -> dict:
    return {
        "name": item["name"], "name_en": item.get("name_en"), "crop_type": item["crop_type"],
        "category": item.get("category", "disease"), "description": item.get("description"),
        "causes": item.get("causes", []), "prevention": item.get("prevention", []),
        "severity": item.get("severity", "medium"),
        "management_actions": item.get("management_actions", []),
    }


def _apply(entity, values: dict) -> None:
    for field, value in values.items():
        if getattr(entity, field) != value:
            setattr(entity, field, value)


def _required_text(item: dict, key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid pesticide catalog field: {key}")
    return value


def _load_catalog(diseases: list[dict]) -> tuple[list[dict], list[dict]]:
    path = SEED_DIR / "pesticide_catalog.json"
    disease_keys = {row["key"] for row in diseases}
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("schema_version") != 1 or data.get("source") != "PSIS":
            raise ValueError("Unsupported pesticide catalog schema/source")
        synced_at = datetime.fromisoformat(_required_text(data, "synced_at"))
        if synced_at.tzinfo is None:
            raise ValueError("Catalog synced_at must include a timezone")
        synced_at = synced_at.astimezone(timezone.utc)
        for field in ("products", "usages", "queries"):
            if not isinstance(data.get(field), list) or not all(isinstance(row, dict) for row in data[field]):
                raise ValueError(f"Invalid catalog {field}")
        required_queries = {row["key"] for row in diseases if row.get("category", "disease") == "disease"}
        query_keys = [_required_text(row, "disease_key") for row in data["queries"]]
        if set(query_keys) != required_queries or len(query_keys) != len(set(query_keys)):
            raise ValueError("Catalog must contain every disease query exactly once")
        query_map = {row["disease_key"]: row for row in data["queries"]}
        disease_map = {row["key"]: row for row in diseases}
        usage_counts = Counter(row.get("disease_key") for row in data["usages"])
        for query in data["queries"]:
            if type(query.get("count")) is not int or query["count"] < 0:
                raise ValueError("Invalid catalog query count")
            if query.get("crop") != disease_map[query["disease_key"]]["crop_type"]:
                raise ValueError("Catalog query crop does not match disease metadata")
            _required_text(query, "disease")
            if usage_counts[query["disease_key"]] > query["count"]:
                raise ValueError("Catalog usages exceed the declared source count")
        products = data["products"]
        usages = [dict(row, source="PSIS", synced_at=synced_at) for row in data["usages"]]
        registrations = [_required_text(row, "registration_no") for row in products]
        if len(registrations) != len(set(registrations)):
            raise ValueError("Duplicate product registration in catalog")
        for row in usages:
            if row.get("verification_status") != "verified":
                raise ValueError("Catalog usage has no verified source")
            if row.get("disease_key") not in query_map:
                raise ValueError("Usage has no disease query in this catalog")
            payload = row.get("source_payload")
            if payload is not None:
                query = query_map[row["disease_key"]]
                if (not isinstance(payload, dict) or payload.get("cropName") != query["crop"]
                        or payload.get("diseaseWeedName") != query["disease"]
                        or f"{payload.get('pestiCode')}:{payload.get('diseaseUseSeq')}" != row.get("source_usage_key")):
                    raise ValueError("Usage source payload does not match query/identity")
    else:
        products = json.loads((SEED_DIR / "pesticides.json").read_text(encoding="utf-8"))
        mappings = json.loads((SEED_DIR / "disease_pesticides.json").read_text(encoding="utf-8"))
        # Conditions stay on the legacy product row for compatibility only.
        usages = [
            {"key": f"legacy:{row['disease_key']}:{row['pesticide_key']}",
             "disease_key": row["disease_key"], "pesticide_key": row["pesticide_key"],
             "source_usage_key": f"legacy:{row['pesticide_key']}",
             "priority": row.get("priority", 1), "source": "legacy_seed",
             "verification_status": "legacy_unverified", "synced_at": None}
            for row in mappings
        ]

    product_keys = [_required_text(row, "key") for row in products]
    if len(product_keys) != len(set(product_keys)):
        raise ValueError("Duplicate pesticide key")
    for row in products:
        _required_text(row, "name")
    usage_keys = [_required_text(row, "key") for row in usages]
    if len(usage_keys) != len(set(usage_keys)):
        raise ValueError("Duplicate pesticide usage key")
    source_keys = set()
    for row in usages:
        if row.get("disease_key") not in disease_keys or row.get("pesticide_key") not in product_keys:
            raise ValueError("Pesticide usage references an unknown disease/product")
        source_key = (row["disease_key"], row["pesticide_key"], _required_text(row, "source_usage_key"))
        if source_key in source_keys:
            raise ValueError("Duplicate source usage")
        source_keys.add(source_key)
        if type(row.get("priority")) is not int or row["priority"] < 1:
            raise ValueError("Usage priority must be a positive integer")
        for field in ("phi_days", "reentry_hours"):
            value = row.get(field)
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError(f"Invalid usage {field}")
    return products, usages


def seed_database(db: Session) -> None:
    """Upsert products by registration, uses by source key; preserve disease history."""
    diseases_data = json.loads((SEED_DIR / "diseases.json").read_text(encoding="utf-8"))
    # Validate the complete snapshot before making any ORM mutation.
    pesticides_data, usages_data = _load_catalog(diseases_data)
    try:
        pesticide_map = {}
        for item in pesticides_data:
            values = {field: item.get(field) for field in PESTICIDE_FIELDS}
            registration = values["registration_no"]
            query = db.query(Pesticide)
            if registration:
                query = query.filter(Pesticide.registration_no == registration)
            else:
                # Only old seeds without a registration identifier need this fallback.
                query = query.filter(Pesticide.registration_no.is_(None), Pesticide.name == values["name"])
            pesticide = query.order_by(Pesticide.id).first()
            if pesticide is None:
                pesticide = Pesticide(**values)
                db.add(pesticide)
            else:
                _apply(pesticide, values)
            pesticide_map[item["key"]] = pesticide
        db.flush()

        disease_map = {}
        for item in diseases_data:
            disease = db.query(Disease).filter_by(model_class_id=item["model_class_id"]).first()
            values = _disease_values(item)
            if disease is None:
                disease = Disease(model_class_id=item["model_class_id"], **values)
                db.add(disease)
            else:
                _apply(disease, values)
            disease_map[item["key"]] = disease
        db.flush()

        desired_usage_keys = {row["key"] for row in usages_data}
        for usage in db.query(PesticideUsage).all():
            if usage.key not in desired_usage_keys:
                db.delete(usage)
        db.flush()
        desired_pairs = {}
        for item in usages_data:
            disease_id = disease_map[item["disease_key"]].id
            pesticide_id = pesticide_map[item["pesticide_key"]].id
            values = {field: item.get(field) for field in USAGE_FIELDS}
            values.update(disease_id=disease_id, pesticide_id=pesticide_id)
            usage = db.query(PesticideUsage).filter_by(key=item["key"]).first()
            if usage is None:
                db.add(PesticideUsage(key=item["key"], **values))
            else:
                _apply(usage, values)
            pair = (disease_id, pesticide_id)
            desired_pairs[pair] = min(desired_pairs.get(pair, item["priority"]), item["priority"])
        db.flush()

        existing_pairs = {(row.disease_id, row.pesticide_id): row for row in db.query(DiseasePesticide).all()}
        for pair, priority in desired_pairs.items():
            if pair in existing_pairs:
                existing_pairs[pair].priority = priority
            else:
                db.add(DiseasePesticide(disease_id=pair[0], pesticide_id=pair[1], priority=priority))
        for pair, row in existing_pairs.items():
            if pair not in desired_pairs:
                db.delete(row)
        db.flush()

        keep_ids = {product.id for product in pesticide_map.values()}
        for product in db.query(Pesticide).all():
            if product.id not in keep_ids:
                db.delete(product)
        db.commit()
    except Exception:
        db.rollback()
        raise
