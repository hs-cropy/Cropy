"""Build and atomically publish one complete PSIS product/usage catalog.

Usage: set PSIS_API_KEY in the shell, then run python scripts/sync_pesticides.py
(backend/.env is not read here, and a key there breaks app Settings validation;
--api-key also works but leaves the key in shell history.)
API guide: https://psis.rda.go.kr/psis/cont/contentMain.ps?menuId=PS00381
The downloadable guide (v1.0) calls startPoint a page number, but the live service
treats it as a 1-based record offset (checked 2026-10-20: startPoint=2 returns
records 2..51, startPoint=51 returns the next 35 of 85 with no overlap).
diseaseWeedName matches substrings even with similarFlag=N (e.g. "검은무늬병" also
returns "세균검은무늬병"), so only exact disease names are kept and the rest are
recorded as excluded. Crop names must match exactly (cropCheck=Y).
SVC01 lists registrations; dilution, safety rules and toxicity are documented
only on the SVC02 detail response, so every selected usage is read from SVC02.
No existing seed is changed until every query and every page has been validated.
"""

import argparse
import json
import logging
import os
import re
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import httpx

SEED_DIR = Path(__file__).resolve().parent.parent / "app" / "data" / "seed"
API_URL = "https://psis.rda.go.kr/openApi/service.do"
DISEASE_QUERIES = {
    "pepper_anthracnose": ("고추", "탄저병"),
    "pepper_powdery_mildew": ("고추", "흰가루병"),
    "radish_alternaria": ("무", "검은무늬병"),
    "radish_downy_mildew": ("무", "노균병"),
    "cabbage_black_rot": ("배추", "검은썩음병"),
    "cabbage_downy_mildew": ("배추", "노균병"),
}
MAX_PER_DISEASE = 5
PAGE_SIZE = 50
# Envelope fields of an SVC01 page. buildTime/displayCount/startPoint are not in
# the v1.0 guide but the live service returns them (checked 2026-10-20).
# Anything else still fails closed.
SVC01_ENVELOPE_FIELDS = frozenset({
    "errorCode", "errorMsg", "totalCount", "list", "resultCode", "resultMsg",
    "buildTime", "displayCount", "startPoint",
})
# The guide allows at most 10 transactions per second per key.
MIN_REQUEST_INTERVAL = 0.12
_last_request_at = float("-inf")


def _request(client: httpx.Client, params: dict) -> str:
    global _last_request_at
    wait = MIN_REQUEST_INTERVAL - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    try:
        response = client.get(API_URL, params=params, timeout=30)
    finally:
        _last_request_at = time.monotonic()
    response.raise_for_status()
    return response.text


def _parse_envelope(payload: str) -> ET.Element:
    # Do not resolve a DTD or allow entity expansion in an external XML payload.
    if "<!DOCTYPE" in payload.upper() or "<!ENTITY" in payload.upper():
        raise ValueError("PSIS XML declarations are not supported")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ValueError("Malformed PSIS XML") from exc
    if root.tag != "service":
        raise ValueError("Unexpected PSIS response envelope")
    fields = [child.tag for child in root]
    if len(fields) != len(set(fields)):
        raise ValueError("Duplicate PSIS response fields")
    error = (root.findtext("errorCode") or "").strip()
    if error or (root.findtext("errorMsg") or "").strip():
        # All documented ERR_101/102/103/104/105/201/901 are errors; unknown
        # future codes must also fail closed. Do not log a provider's raw body.
        raise ValueError("PSIS reported a business error")
    status = (root.findtext("resultCode") or "").strip()
    if status and status not in {"0", "00", "0000", "SUCCESS"}:
        raise ValueError("PSIS reported an unsuccessful result")
    return root


def _parse_page(payload: str) -> tuple[int, list[dict]]:
    root = _parse_envelope(payload)
    if {child.tag for child in root} - SVC01_ENVELOPE_FIELDS:
        raise ValueError("Unexpected PSIS response fields")
    total_text = (root.findtext("totalCount") or "").strip()
    if not re.fullmatch(r"\d+", total_text):
        raise ValueError("PSIS totalCount is missing or invalid")
    container = root.find("list")
    if container is None or any(child.tag != "item" for child in container):
        raise ValueError("PSIS list schema is missing or invalid")
    items = []
    for node in container:
        if any(len(child) for child in node) or len({child.tag for child in node}) != len(node):
            raise ValueError("PSIS item schema is invalid")
        items.append({child.tag: (child.text or "").strip() for child in node})
    return int(total_text), items


def fetch_registrations(client: httpx.Client, api_key: str, crop: str, disease: str) -> tuple[list[dict], dict, int]:
    """Read every SVC01 page for one crop/disease.

    Returns (exact matches, excluded disease names with counts, source totalCount).
    Every returned record, matched or not, is validated; any inconsistency fails closed.
    """
    received, matched, excluded, seen = 0, [], {}, set()
    expected_total = None
    while True:
        total, records = _parse_page(_request(client, {
            "apiKey": api_key, "serviceCode": "SVC01", "serviceType": "AA001",
            "cropName": crop, "cropCheck": "Y", "diseaseWeedName": disease,
            "similarFlag": "N", "displayCount": str(PAGE_SIZE), "startPoint": str(received + 1),
        }))
        if expected_total is not None and total != expected_total:
            raise ValueError("PSIS totalCount changed during pagination")
        expected_total = total
        if len(records) > PAGE_SIZE or received + len(records) > total:
            raise ValueError("PSIS page exceeds declared count")
        if not records and received != total:
            raise ValueError("PSIS pagination ended before totalCount")
        for record in records:
            required = ("pestiCode", "diseaseUseSeq", "pestiBrandName", "pestiKorName", "cropName", "diseaseWeedName")
            if any(not record.get(field) for field in required):
                raise ValueError("PSIS item is missing registration identity")
            if record["cropName"] != crop:
                raise ValueError("PSIS item does not match the requested crop")
            identity = (record["pestiCode"], record["diseaseUseSeq"])
            if identity in seen:
                raise ValueError("PSIS returned duplicate usage or repeated page")
            seen.add(identity)
            if record["diseaseWeedName"] == disease:
                matched.append(record)
            else:
                name = record["diseaseWeedName"]
                excluded[name] = excluded.get(name, 0) + 1
        received += len(records)
        if received == total:
            return matched, excluded, total


def fetch_items(client: httpx.Client, api_key: str, crop: str, disease: str) -> list[dict]:
    """Registrations whose crop and disease names match exactly."""
    return fetch_registrations(client, api_key, crop, disease)[0]


def fetch_detail(client: httpx.Client, api_key: str, record: dict) -> dict:
    """Read one usage's SVC02 detail and confirm it is the listed registration."""
    root = _parse_envelope(_request(client, {
        "apiKey": api_key, "serviceCode": "SVC02",
        "pestiCode": record["pestiCode"], "diseaseUseSeq": record["diseaseUseSeq"],
    }))
    if any(len(child) for child in root):
        raise ValueError("PSIS detail schema is invalid")
    detail = {child.tag: (child.text or "").strip() for child in root}
    for field in ("pestiKorName", "pestiBrandName", "cropName", "diseaseWeedName"):
        if detail.get(field) != record[field]:
            raise ValueError("PSIS detail does not match the listed registration")
    return detail


def parse_phi_days(value: str) -> int | None:
    # Preserve the raw text in safety_notes; only normalize a single clear rule.
    match = re.fullmatch(r"\s*수확\s*(\d+)\s*일\s*전(?:까지)?\s*", value)
    return int(match.group(1)) if match else None


def clean_text(value: str) -> str:
    """PSIS uses "-" for an empty field; treat it as missing."""
    value = (value or "").strip()
    return "" if re.fullmatch(r"[\s\-]*", value) else value


def is_aerial_use(value) -> bool:
    """Drone/helicopter application, e.g. "발병 초부터 경엽처리(무인항공)".

    Aerial rates such as "100㎖/10a" are near-undiluted volumes per area. Shown next to
    a ground-spray dilution like "2000배" they invite a dangerous mix-up, and Cropy's
    users apply pesticides themselves, so aerial uses are left out of the catalog.
    """
    # Any mention of aircraft counts: "(무인항공)", "(항공)", "항공살포", "무인헬기", "드론", "무인기".
    return bool(re.search(r"항\s*공|헬\s*기|드\s*론|무인\s*(비행|기)", value or ""))


def clean_dilution(value: str) -> str | None:
    # Live values look like "1000배 -" (ground spray) or "- 100㎖/10a" (aerial spray).
    return re.sub(r"[\s\-~/]+$", "", re.sub(r"^[\s\-]+", "", clean_text(value))) or None


def to_pesticide(item: dict, key: str) -> dict:
    return {
        "key": key,
        "name": f"{item['pestiBrandName']} ({item['pestiKorName']})",
        "active_ingredient": item["pestiKorName"],
        # PSIS pestiCode is a stable source identifier, not a legal registration number.
        "registration_no": f"PSIS-{item['pestiCode']}",
    }


def build_catalog(client: httpx.Client, api_key: str, *, queries=None, max_per_disease=MAX_PER_DISEASE) -> dict:
    if type(max_per_disease) is not int or max_per_disease < 1:
        raise ValueError("max_per_disease must be positive")
    queries = DISEASE_QUERIES if queries is None else queries
    if not queries:
        raise ValueError("A catalog must include disease queries")
    products, usages, query_results = {}, [], []
    for disease_key, (crop, disease) in queries.items():
        records, excluded, source_total = fetch_registrations(client, api_key, crop, disease)
        # Aerial (drone/helicopter) uses are filtered before selection so they never
        # take one of the max_per_disease product slots.
        ground = [record for record in records if not is_aerial_use(record.get("pestiUse"))]
        query = {"disease_key": disease_key, "crop": crop, "disease": disease, "count": len(records),
                 "source_total": source_total, "excluded_disease_names": excluded,
                 "excluded_aerial_usages": len(records) - len(ground)}
        query_results.append(query)
        selected, ingredients = {}, set()
        for record in ground:
            code, ingredient = record["pestiCode"], record["pestiKorName"]
            if code not in selected and (ingredient in ingredients or len(selected) >= max_per_disease):
                continue
            key = f"psis_{code}"
            product = to_pesticide(record, key)
            if key in products and product != products[key]:
                raise ValueError("Conflicting identity for one PSIS product")
            source_key = f"{code}:{record['diseaseUseSeq']}"
            detail = fetch_detail(client, api_key, record)
            if is_aerial_use(detail.get("pestiUse")):
                query["excluded_aerial_usages"] += 1  # the list said ground spray; the detail says otherwise
                continue
            # A product takes a slot only once one of its uses survives the detail check,
            # so a product excluded here never crowds out a later valid one.
            if code not in selected:
                selected[code] = len(selected) + 1
                ingredients.add(ingredient)
            products[key] = product
            # Use conditions come only from SVC02, the documented source. A blank or "-"
            # detail field stays empty; never back-fill it from the SVC01 list copy,
            # which would publish an unconfirmed value as verified.
            value = lambda field: clean_text(detail.get(field))
            notes = " / ".join(f"{label}: {value(field)}" for label, field in (
                ("안전사용기준", "useSuittime"), ("사용횟수", "useNum"),
                ("독성", "toxicName"), ("어독성", "fishToxicGubun"),
            ) if value(field))
            usages.append({
                "key": f"{disease_key}:{source_key}", "disease_key": disease_key,
                "pesticide_key": key, "source_usage_key": source_key,
                "dilution": clean_dilution(value("dilutUnit")),
                "usage_method": value("pestiUse") or None,
                "phi_days": parse_phi_days(value("useSuittime")),
                "reentry_hours": None, "safety_notes": notes or None,
                "priority": selected[code], "verification_status": "verified",
                "source_payload": {**record, "detail": detail},
            })
    return {"schema_version": 1, "source": "PSIS", "synced_at": datetime.now(timezone.utc).isoformat(),
            "queries": query_results, "products": list(products.values()), "usages": usages}


def sync_catalog(client: httpx.Client, api_key: str, target: Path, **options) -> dict:
    catalog = build_catalog(client, api_key, **options)
    target = Path(target)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, prefix=f".{target.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(catalog, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-key", default=os.environ.get("PSIS_API_KEY"))
    parser.add_argument("--max-per-disease", type=int, default=MAX_PER_DISEASE)
    parser.add_argument("--output", type=Path, default=SEED_DIR / "pesticide_catalog.json")
    args = parser.parse_args()
    # httpx logs each request URL, which carries the API key, at INFO level.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    if not args.api_key:
        parser.error("PSIS API 키가 필요합니다 (--api-key 또는 PSIS_API_KEY).")
    try:
        with httpx.Client() as client:
            result = sync_catalog(client, args.api_key, args.output, max_per_disease=args.max_per_disease)
    except (httpx.HTTPError, ValueError, OSError) as exc:
        # httpx exceptions include a URL with the API key; never print them.
        sys.exit(f"PSIS 동기화 실패 ({type(exc).__name__}). 기존 카탈로그를 유지합니다.")
    print(f"카탈로그 갱신 완료: 제품 {len(result['products'])}개, 작물·병해별 사용 조건 {len(result['usages'])}개")
    print("백엔드 재시작 시 DB에 반영됩니다.")


if __name__ == "__main__":
    main()
