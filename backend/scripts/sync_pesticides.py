"""Build and atomically publish one complete PSIS product/usage catalog.

Usage: python scripts/sync_pesticides.py --api-key <PSIS_API_KEY>
API guide: https://psis.rda.go.kr/psis/cont/contentMain.ps?menuId=PS00381
The downloadable guide defines startPoint as a page number, starting at 1.
No existing seed is changed until every query and every page has been validated.
"""

import argparse
import json
import os
import re
import sys
import tempfile
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


def _parse_page(payload: str) -> tuple[int, list[dict]]:
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
    if len(fields) != len(set(fields)) or set(fields) - {"errorCode", "errorMsg", "totalCount", "list", "resultCode", "resultMsg"}:
        raise ValueError("Unexpected or duplicate PSIS response fields")
    error = (root.findtext("errorCode") or "").strip()
    if error or (root.findtext("errorMsg") or "").strip():
        # All documented ERR_101/102/103/104/105/201/901 are errors; unknown
        # future codes must also fail closed. Do not log a provider's raw body.
        raise ValueError("PSIS reported a business error")
    status = (root.findtext("resultCode") or "").strip()
    if status and status not in {"0", "00", "0000", "SUCCESS"}:
        raise ValueError("PSIS reported an unsuccessful result")
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


def fetch_items(client: httpx.Client, api_key: str, crop: str, disease: str) -> list[dict]:
    items, seen = [], set()
    expected_total = None
    page = 1
    while True:
        response = client.get(API_URL, params={
            "apiKey": api_key, "serviceCode": "SVC01", "serviceType": "AA001",
            "cropName": crop, "cropCheck": "Y", "diseaseWeedName": disease,
            "similarFlag": "N", "displayCount": str(PAGE_SIZE), "startPoint": str(page),
        }, timeout=30)
        response.raise_for_status()
        total, records = _parse_page(response.text)
        if expected_total is not None and total != expected_total:
            raise ValueError("PSIS totalCount changed during pagination")
        expected_total = total
        if len(records) > PAGE_SIZE or len(items) + len(records) > total:
            raise ValueError("PSIS page exceeds declared count")
        if not records and len(items) != total:
            raise ValueError("PSIS pagination ended before totalCount")
        for record in records:
            required = ("pestiCode", "diseaseUseSeq", "pestiBrandName", "pestiKorName", "cropName", "diseaseWeedName")
            if any(not record.get(field) for field in required):
                raise ValueError("PSIS item is missing registration identity")
            if record["cropName"] != crop or record["diseaseWeedName"] != disease:
                raise ValueError("PSIS item does not match the requested crop/disease")
            identity = (record["pestiCode"], record["diseaseUseSeq"])
            if identity in seen:
                raise ValueError("PSIS returned duplicate usage or repeated page")
            seen.add(identity)
            items.append(record)
        if len(items) == total:
            return items
        page += 1


def parse_phi_days(value: str) -> int | None:
    # Preserve the raw text in safety_notes; only normalize a single clear rule.
    match = re.fullmatch(r"\s*수확\s*(\d+)\s*일\s*전(?:까지)?\s*", value)
    return int(match.group(1)) if match else None


def clean_dilution(value: str) -> str | None:
    return re.sub(r"[\s\-~/]+$", "", (value or "").strip()) or None


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
        records = fetch_items(client, api_key, crop, disease)
        query_results.append({"disease_key": disease_key, "crop": crop, "disease": disease, "count": len(records)})
        selected, ingredients = {}, set()
        for record in records:
            code, ingredient = record["pestiCode"], record["pestiKorName"]
            if code not in selected:
                if ingredient in ingredients or len(selected) >= max_per_disease:
                    continue
                selected[code] = len(selected) + 1
                ingredients.add(ingredient)
            key = f"psis_{code}"
            product = to_pesticide(record, key)
            if key in products and product != products[key]:
                raise ValueError("Conflicting identity for one PSIS product")
            products[key] = product
            source_key = f"{code}:{record['diseaseUseSeq']}"
            notes = " / ".join(f"{label}: {record[field]}" for label, field in (("안전사용기준", "useSuittime"), ("사용횟수", "useNum")) if record.get(field))
            usages.append({
                "key": f"{disease_key}:{source_key}", "disease_key": disease_key,
                "pesticide_key": key, "source_usage_key": source_key,
                "dilution": clean_dilution(record.get("dilutUnit", "")),
                "usage_method": record.get("pestiUse") or None,
                "phi_days": parse_phi_days(record.get("useSuittime", "")),
                "reentry_hours": None, "safety_notes": notes or None,
                "priority": selected[code], "verification_status": "verified",
                "source_payload": record,
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
