# CropCare AI - API Specification

Base URL: `http://localhost:8000/api/v1`
정적 파일: `http://localhost:8000/uploads/{filename}` (진단 이미지)

업로드 이미지는 서버가 확인한 실제 형식으로 `.jpg` 또는 `.png` 확장자를 정한다.
WEBP 등 JPEG/PNG 외 형식은 지원하지 않으며 업로드 시 400을 반환한다.
클라이언트 파일명은 저장 형식에 사용하지 않는다. `/uploads`는 `.jpg`·`.jpeg`·`.png`만
고정된 이미지 MIME과 `X-Content-Type-Options: nosniff`로 제공하며, 과거에 저장된
`.html` 등 다른 확장자 경로는 404를 반환한다. 기존 파일은 자동 삭제·변환하지 않는다.

프론트엔드는 `next.config.js`의 rewrite로 `/api/*`·`/uploads/*`를 백엔드로 프록시하므로,
브라우저에서는 동일 출처 상대경로로 호출한다.

대상 작물은 **고추·무·배추** 3종이며, 모델 클래스는 병해 6종 + 정상 3종으로 총 9개다.

## Endpoints

| Method | Path | 설명 |
|--------|------|------|
| POST | `/diagnose` | 이미지 진단 |
| POST | `/diagnose/{id}/refine` | 판별부위 2차 촬영으로 재확정 |
| GET | `/history` | 진단 이력 목록 |
| GET | `/history/{id}` | 진단 상세 |
| GET | `/diseases` | 병해 목록 (검색·필터) |
| GET | `/diseases/{id}` | 병해 상세 |
| GET | `/health` | 헬스체크 |
| GET | `/ready` | 실제 모델·클래스 매핑 준비 확인 |

---

### POST /diagnose

병해 이미지 진단.

**Request:** `multipart/form-data`

| Field | In | Type | Required | 설명 |
|-------|-----|------|----------|------|
| file | body | image (jpg/png) | Yes | `Content-Type`은 `image/*`, 실제 형식은 JPEG 또는 PNG여야 한다 |
| crop_type | query | string | No | `고추` / `무` / `배추`. 생략 시 예측된 병해의 작물로 채운다 |

`crop_type`은 허용 작물 enum이다. 미지원 값은 422로 거부한다. 응답의 `selected_crop`은
사용자 선택, `predicted_crop`은 모델이 선택한 병해의 작물, `crop_mismatch`는 둘의 불일치다.
기존 `crop_type`은 선택값이 있으면 선택값, 없으면 예측 작물을 사용한다. 선택값으로 모델
점수를 강제 재정규화하지 않는다.

**Response:** `200 OK`

```json
{
  "id": "3f9a1c02-77b1-4e0a-9c31-8a5d2b6e4f10",
  "disease_name": "무 검은무늬병",
  "crop_type": "무",
  "category": "disease",
  "severity": "medium",
  "confidence": 0.46,
  "top_predictions": [
    { "name": "무 검은무늬병", "confidence": 0.46 },
    { "name": "무 노균병", "confidence": 0.41 },
    { "name": "배추 노균병", "confidence": 0.08 }
  ],
  "description": "잎에 동심원 무늬의 흑갈색 원형 반점이 생기고 병반 주위가 황변합니다. ...",
  "causes": ["고온다습과 잦은 강우", "연작 토양", "질소 부족으로 약해진 잎", "종자 감염"],
  "pesticides": [
    {
      "name": "마스터키 (가스가마이신.티플루자마이드 액상수화제)",
      "dilution": "2000배 -",
      "usage": "발병 초부터 경엽처리",
      "safety": { "phi_days": 14, "reentry_hours": null },
      "active_ingredient": "가스가마이신.티플루자마이드 액상수화제",
      "safety_notes": "안전사용기준: 수확14일전 / 사용횟수: 2회 이내"
    }
  ],
  "prevention": ["건전 종자 사용 및 종자 소독", "3년 이상 연작 회피", "균형 시비"],
  "image_url": "/uploads/3f9a1c02-....jpg",
  "refined_image_url": null,
  "created_at": "2026-07-02T12:00:00Z",
  "recapture": {
    "region": "잎 뒷면",
    "instruction": "잎을 뒤집어 병반이 있는 부위의 뒷면을 근접 촬영하세요.",
    "margin": 0.05,
    "candidates": [
      { "name": "무 노균병", "cue": "뒷면에 회백색 솜털 같은 곰팡이(포자층)가 보이면 노균병입니다." },
      { "name": "무 검은무늬병", "cue": "뒷면이 깨끗하고 앞면 병반이 동심원(과녁) 무늬면 검은무늬병입니다." }
    ]
  }
}
```

**필드 참고**

- `prediction_mode`: `model` / `mock` / `legacy`. 기존 이력은 출처를 추정하지 않고 legacy로 표시한다.
- `model_version`: 실제 로드 가중치의 SHA256 또는 `mock-v1`. `preprocessing_version`은 전처리 규격,
  `pair_model_version`은 해당 실행에서 사용 가능한 선택적 보조 모델의 해시다.
- `created_at`, `updated_at`: UTC offset이 포함된 시각. 최초 생성과 마지막 재촬영 시각을 구분한다.
- 농약 항목은 `usage_id`, `source`, `verification_status`, `synced_at`을 포함한다.
  `legacy_unverified`의 희석비·사용법·PHI·재입장 시간은 null이다. 원천 재동기화로
  작물·병해별 사용 조건이 확인된 항목만 `verified`로 제공한다. `usage_id`를 목록 키로 사용한다.
- `category`: `disease` | `normal` — `normal`은 병징이 없는 건전주 예측이며 `pesticides`가 비어 있다.
- `severity`: `low` | `medium` | `high`
- `refined_image_url`: 판별부위 2차 촬영으로 재확정한 경우 그 사진의 URL.
  재확정 전에는 `null`이다.
- `recapture`: **혼동쌍 유도촬영 지침.** 상위 두 후보가 사전 정의된 혼동쌍이고 신뢰도 마진이
  임계값(0.20) 미만일 때만 채워지고, 그 외에는 `null`이다. 자세한 동작은
  [MODEL_SPEC.md](MODEL_SPEC.md#혼동쌍-유도촬영)를 참고.

**Errors**

| Status | 조건 |
|--------|------|
| 400 | `Content-Type`이 이미지가 아님 / 빈 파일 / JPEG·PNG가 아님 / 이미지 검증·전체 디코딩 실패 |
| 413 | 파일 크기가 `MAX_UPLOAD_MB`(기본 10MB) 초과 / 픽셀 수가 `MAX_IMAGE_PIXELS`(기본 40,000,000) 초과 / Pillow의 이미지 크기 보호 오류 |
| 422 | `file` 필드 누락 / 지원하지 않는 작물 |
| 503 | 운영 모델 누락·손상 또는 모델 출력·클래스 ID·점수·병해 DB 매핑이 유효하지 않음 |

`Content-Type`만 신뢰하지 않고 실제 형식·픽셀 수·파일 구조와 전체 디코딩을 확인한 뒤
저장한다. 원본 바이트는 유지하며 재인코딩이나 EXIF 회전을 자동 적용하지 않는다.
ASGI 계층에서 multipart 파싱 전에 전체 요청을 `MAX_UPLOAD_MB`에 64KiB를 더한 한도로 제한한다.
Content-Length가 크면 본문을 읽기 전에 413, 헤더가 없거나 거짓이면 실제 수신량으로 제한한다.
허용된 요청은 제한된 임시 버퍼에서 다시 읽고, 개별 파일에는 별도로 `MAX_UPLOAD_MB`를 적용한다.
이는 저속 업로드 타임아웃이나 연결 개수 제한을 대체하지 않는다.

유효하지 않은 모델 출력을 임의 병명으로 대체하지 않는다. 이때 진단을 저장하지 않고
이번 요청이 생성한 이미지를 정리한 뒤 503을 반환한다. 일반 추론·DB 실패에도 rollback과
새 파일 정리를 수행한다. `APP_ENV=development`와 `ALLOW_MOCK_PREDICTIONS=true`인 경우에만
모델 없이 시연 결과를 반환한다. production은 이 옵션과 무관하게 실제 모델이 필요하다.

---

### POST /diagnose/{id}/refine

`recapture` 지침에 따라 촬영한 **판별부위 2차 사진**으로 진단을 재확정한다 (다시점 융합).

저장된 1차 전체 분포와 2차 사진의 분포를 가중 평균(2차 가중 0.6)하고,
혼동쌍 전용 분류기가 있고 1차 진단의 상위 두 후보가 그 분류기의 쌍일 때
쌍 내부의 상대 비중을 재분배한다. 합계 질량은 보존되므로 쌍 밖 클래스는 영향받지 않는다.

1차 분포가 없는 기존 이력만 현재 모델로 원본을 다시 추론하고 출처를 기록한다.
새 이력의 본 모델·전처리·시연 여부가 달라졌으면 혼합하지 않고 409를 반환한다.
보조 모델은 `ENABLE_PAIR_MODEL=true`로 명시적으로 활성화해야 한다.

**Request:** `multipart/form-data` — `file` (image), 경로 파라미터 `id`는 1차 진단 ID.

**Response:** `200 OK` — `/diagnose`와 동일한 스키마. 단 `recapture`는 항상 `null`이다
(재확정 결과에는 추가 유도를 하지 않는다).

기존 진단 레코드의 `disease_id` · `confidence` · `top_predictions` ·
`refined_image_path`가 **갱신**되며, 새 레코드가 생기지 않는다.
따라서 `/history/{id}`는 재확정 결과와 2차 사진 URL을 함께 반환한다.
`image_url`은 1차 사진을 그대로 가리킨다.
성공적으로 DB에 반영한 뒤 이전 재촬영 파일을 정리한다. 동시에 같은 진단을 수정하면
revision 충돌을 409로 반환하고 이번 요청의 파일만 정리한다.

**Errors**

| Status | 조건 |
|--------|------|
| 400 | 이미지가 아님 / 빈 파일 / JPEG·PNG가 아님 / 검증·디코딩 불가 / 원본 진단 이미지가 디스크에 없음 |
| 413 | 파일 크기 또는 픽셀 수 상한 초과 / Pillow의 이미지 크기 보호 오류 |
| 404 | 해당 `id`의 진단 기록 없음 |
| 409 | 본 모델/전처리/모드 변경 또는 동시 수정 충돌 |
| 503 | 원본·2차 사진·보조 모델의 출력 또는 병해 DB 매핑이 유효하지 않음 |

모델 출력 오류 시 기존 진단과 이전 사진 참조를 유지하며, 이번 요청의 새 사진만 정리한다.

---

### GET /history

진단 이력 목록 (최신순).

**Query:** `page` (기본 1, ≥1), `size` (기본 20, 1~100), `crop_type` (선택, 허용 작물 enum)

목록 항목은 `refined_image_url`, `prediction_mode`도 포함한다. 생성 시각과 ID 순으로 안정적으로 정렬한다.

**Response:** `200 OK`

```json
{
  "items": [
    {
      "id": "3f9a1c02-...",
      "disease_name": "무 검은무늬병",
      "confidence": 0.46,
      "crop_type": "무",
      "image_url": "/uploads/3f9a1c02-....jpg",
      "created_at": "2026-07-02T12:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "size": 20
}
```

**Errors:** `422` — `page < 1` 또는 `size > 100`

---

### GET /history/{id}

진단 상세. `/diagnose`와 동일한 스키마이며 저장된 `recapture`를 포함해 재촬영을 이어갈 수 있다.
이미 재촬영했거나 지침을 저장하지 않은 기존 이력은 null이다.

**Errors:** `404` — 기록 없음

---

### GET /diseases

병해 목록 (검색·필터).

**Query:** `q` (병해명 부분일치), `crop_type` (정확일치: `고추` / `무` / `배추`)

**Response:** `200 OK` — `DiseaseDetail` 배열

```json
[
  {
    "id": 3,
    "name": "무 검은무늬병",
    "name_en": "Radish Alternaria Black Spot",
    "crop_type": "무",
    "category": "disease",
    "description": "잎에 동심원 무늬의 흑갈색 원형 반점이 생기고 ...",
    "causes": ["고온다습과 잦은 강우", "연작 토양"],
    "prevention": ["건전 종자 사용 및 종자 소독", "3년 이상 연작 회피"],
    "severity": "medium",
    "pesticides": [ { "name": "마스터키 (...)", "dilution": "2000배 -", "...": "..." } ]
  }
]
```

---

### GET /diseases/{id}

병해 상세 (설명, 원인, 예방, 연관 농약). `id`는 DB PK이며 모델 클래스 ID와 다르다.

**Errors:** `404` — 해당 병해 없음

---

### GET /health

헬스체크.

```json
{ "status": "ok", "model_loaded": true, "version": "1.0.0" }
```

`/health`는 프로세스 생존 확인이다. 모델 실패여도 200이므로 실제 진단 준비 여부는 `/ready`로 확인한다.

### GET /ready

실제 체크포인트와 DB 클래스 매핑이 검증되면 200, 그 외에는 503이다.
`status`, `model_loaded`, `prediction_mode`(`model`/`mock`/`unavailable`), `version`을 반환한다.
개발용 Mock은 시연을 허용하더라도 실제 모델 준비 완료로 표시하지 않는다.
모델 파일·실행 설정 변경은 프로세스 재시작 후 반영된다.

## 진단 피드백 계약 확장

`GET /api/v1/history`는 severity=high|medium|low 필터와 unfiltered_total/crop_total/total 건수를 제공한다. 요약은 category/severity/is_refined/content_status를 제공한다.

신규 결과는 병해 안내·관리 행동·당시 농약 조회를 스냅샷으로 저장한다. content_version/content_status/current_pesticides/initial_predictions와 decision_status/decision_reasons/policy_version을 제공한다. 스냅샷 없는 과거 기록은 current_reference다.

## 오류와 준비 상태

오류는 detail/code/retryable/request_id와 X-Request-ID를 제공한다. GET /api/v1/capabilities는 사진 형식·크기·픽셀, 판단 정책과 실행 준비 상태를 제공한다.
