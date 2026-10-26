# Cropy - API Specification

**갱신:** 2026-10-12. develop 라우트·Pydantic 응답 스키마 기준.

Base URL: `http://localhost:8000/api/v1`
정적 파일: `http://localhost:8000/uploads/{filename}` (진단 이미지)

업로드 이미지는 서버가 확인한 실제 형식으로 `.jpg` 또는 `.png` 확장자를 정한다.
Content-Type이 없거나 `image/`로 시작하지 않으면 `400 UNSUPPORTED_IMAGE_FORMAT`으로 거부한다. 이 검사를 통과한 파일은 실제 JPEG/PNG 형식과 디코딩을 검사하며, WEBP 등 비지원 이미지 형식이나 손상 파일이면 `400 INVALID_IMAGE`를 반환한다. JPEG/PNG 형식인지, 파일이 손상되지 않았는지 확인하도록 안내한다.
클라이언트 파일명은 저장 형식에 사용하지 않는다. `/uploads`는 `.jpg`·`.jpeg`·`.png`만
고정된 이미지 MIME과 `X-Content-Type-Options: nosniff`로 제공하며, 과거에 저장된
`.html` 등 다른 확장자 경로는 404를 반환한다. 기존 파일은 자동 삭제·변환하지 않는다.

프론트엔드는 `next.config.js`의 rewrite로 `/api/*`·`/uploads/*`를 백엔드로 프록시하므로,
브라우저에서는 동일 출처 상대경로로 호출한다.

대상 작물은 **고추·무·배추** 3종이며, 모델 클래스는 병해 6종 + 정상 3종으로 총 9개다.

## Endpoints

| ID | Method | Path | 설명 |
|---|---|---|---|
| API-01 | POST | /diagnose | 이미지 진단 |
| API-02 | POST | /diagnose/{id}/refine | 판별부위 재촬영 결과 갱신 |
| API-03 | GET | /history | 진단 이력 목록 |
| API-04 | GET | /history/{id} | 진단 상세 |
| API-05 | GET | /diseases | 병해 검색·필터 |
| API-06 | GET | /diseases/{id} | 병해 상세 |
| API-07 | GET | /health | 프로세스 생존 확인 |
| API-08 | GET | /ready | 실제 모델·DB 클래스 준비 확인 |

경로는 Base URL에 이어 붙인다. 코드의 경로 변수 `diagnosis_id`·`disease_id`를 표에서는 `id`로 줄여 표시한다. 위 ID는 문서 식별자다.

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

이 예시는 스키마 설명용이며 실제 요청의 진단·농약 조회 결과가 아니다.

```json
{
  "id": "3f9a1c02-77b1-4e0a-9c31-8a5d2b6e4f10",
  "disease_name": "무 검은무늬병",
  "crop_type": "무",
  "selected_crop": "무",
  "predicted_crop": "무",
  "crop_mismatch": false,
  "prediction_mode": "model",
  "model_version": "b0b0b4a24af1430778a2bc15ede5cc068e200539dfeb7fc5ced02574a63d4b8b",
  "preprocessing_version": "resize-224-imagenet-v1",
  "pair_model_version": null,
  "category": "disease",
  "severity": "medium",
  "confidence": 0.46,
  "top_predictions": [
    {
      "name": "무 검은무늬병",
      "confidence": 0.46
    },
    {
      "name": "무 노균병",
      "confidence": 0.41
    },
    {
      "name": "배추 노균병",
      "confidence": 0.08
    }
  ],
  "description": "병해 증상 설명",
  "causes": [
    "등록된 원인 정보"
  ],
  "pesticides": [],
  "prevention": [
    "등록된 예방 정보"
  ],
  "image_url": "/uploads/example.jpg",
  "refined_image_url": null,
  "created_at": "2026-10-08T03:00:00Z",
  "updated_at": null,
  "recapture": {
    "region": "잎 뒷면",
    "instruction": "잎을 뒤집어 병반이 있는 부위의 뒷면을 근접 촬영하세요.",
    "margin": 0.05,
    "candidates": [
      {
        "name": "무 노균병",
        "cue": "판별부위의 시각 단서"
      },
      {
        "name": "무 검은무늬병",
        "cue": "판별부위의 시각 단서"
      }
    ]
  }
}
```

**진단 응답 필드**

| 필드 | JSON 타입 | 설명 |
|---|---|---|
| id / disease_name | string | 진단 ID / 최상위 후보 병명 |
| crop_type / selected_crop / predicted_crop | string 또는 null | 표시 작물 / 사용자 선택 / 예측 작물 |
| crop_mismatch | boolean | 선택 작물과 예측 작물 불일치 |
| prediction_mode | string | model / mock / legacy |
| model_version / preprocessing_version / pair_model_version | string 또는 null | 모델 해시·전처리·선택 보조 모델 출처 |
| category / severity | string | disease 또는 normal / DB 속성 low·medium·high |
| confidence | number | 모델 분류 점수. 실제 발병 확률 아님 |
| top_predictions | object[] | 상위 후보의 name:string, confidence:number |
| description | string 또는 null | 현재 시드의 병해 설명 |
| causes / prevention | string[] | 원인 / 예방 정보 |
| pesticides | object[] | 작물·병해별 농약 조회 정보 |
| image_url / refined_image_url | string 또는 null | 원본 / 재촬영 이미지 URL |
| created_at / updated_at | ISO 8601 string / string 또는 null | UTC 생성 / 갱신 시각 |
| recapture | object 또는 null | region:string, instruction:string, margin:number, candidates:{name,cue}[] |

농약 객체: `name`은 string, `dilution/usage/active_ingredient/safety_notes/usage_id/source`는 string 또는 null, `verification_status`는 string, `synced_at`은 ISO 8601 string 또는 null이다. `safety`의 `phi_days/reentry_hours`는 integer 또는 null이다. 누락값을 0이나 임의 사용량으로 바꾸지 않는다.

**필드 참고**

- `prediction_mode`: `model` / `mock` / `legacy`. 기존 이력은 출처를 추정하지 않고 legacy로 표시한다.
- `model_version`: 실제 로드 가중치의 SHA256 또는 `mock-v1`. `preprocessing_version`은 전처리 규격,
  `pair_model_version`은 해당 실행에서 사용 가능한 선택적 보조 모델의 해시다.
- `created_at`, `updated_at`: UTC offset이 포함된 시각. 최초 생성과 마지막 재촬영 시각을 구분한다.
- 농약 항목은 `usage_id`, `source`, `verification_status`, `synced_at`을 포함한다.
  `legacy_unverified`의 희석비·사용법·PHI·재입장 시간은 null이다. 원천 재동기화로
  작물·병해별 사용 조건이 확인된 항목만 `verified`로 제공한다. `usage_id`를 목록 키로 사용한다.
- `category`: `disease` | `normal` — `normal`은 정상 클래스 분류 결과이며 질병 부재를 보증하지 않고 `pesticides`가 비어 있다.
- `severity`: `low` | `medium` | `high`. DB 병해 속성이며 사진에서 측정한 진행 정도가 아니다.
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
      "created_at": "2026-10-08T03:00:00Z",
      "refined_image_url": null,
      "prediction_mode": "model"
    }
  ],
  "total": 42,
  "page": 1,
  "size": 20
}
```

**Errors:** `422` — page < 1, size가 1~100 범위 밖, 지원하지 않는 crop_type

---

### GET /history/{id}

진단 상세. `/diagnose`와 동일한 스키마이며 저장된 `recapture`를 포함해 재촬영을 이어갈 수 있다.
이미 재촬영했거나 지침을 저장하지 않은 기존 이력은 null이다.

**Errors:** `404` — 기록 없음

---

### GET /diseases

병해 목록 (검색·필터).

**Query:** `q` (병해명 부분일치), `crop_type` (정확일치: `고추` / `무` / `배추`). 미지원 crop_type은 422.

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
    "pesticides": []
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
## Figma 연동 보완 API — 2026-10-08

기존 `detail`과 진단·이력 엔드포인트를 유지하면서 아래 계약을 추가했다.

| 엔드포인트/필드 | 용도 |
|---|---|
| `GET /api/v1/history?crop_type=무&severity=high&page=1&size=20` | 작물·등급 필터. `total`은 최종 필터 건수, `crop_total`은 작물 조건 건수, `unfiltered_total`은 전체 건수 |
| 이력 요약 `category`, `severity`, `is_refined`, `content_status` | 정상/병해·등급·재촬영·과거 안내 상태 표시 |
| 진단 `management_actions`, `content_version`, `content_status` | 관리 안내와 당시 콘텐츠 버전. 이전 스냅샷 없는 기록은 `current_reference` |
| `current_pesticides` | 당시 `pesticides`와 구분한 현재 카탈로그. 과거 이력의 최신 조건 확인에 사용 |
| `decision_status`, `decision_reasons`, `policy_version` | 작물 불일치 → 혼동 → 낮은 신뢰도 우선순위와 모든 해당 이유 |
| `initial_predictions`, `is_refined` | 최초 상위 후보와 재촬영 여부 |
| `save_status`, `recovery_token` | `saved` 또는 DB 저장 실패의 `failed`. 실패해도 보관 성공한 경우 결과를 반환 |
| `POST /api/v1/results/{token}/save` | 서버에 보관된 결과만 재저장. 임의 진단 JSON은 받지 않으며 재추론하지 않음 |
| `GET /api/v1/capabilities` | 사진 형식·용량·픽셀, 판단 기준, 실행 준비, 복구 보관 시간 |
| `GET /api/v1/offline/manifest` | 준비된 브라우저 모델·전처리·병해 안내 묶음 메타데이터 |
| `POST /api/v1/offline/records` | multipart `metadata`, `file`, 선택적 `refined_file`로 기기 기록 동기화 |

진단·재촬영의 선택적 `Idempotency-Key`는 최대 128자다. 같은 작업·키·사진·작물은 동일 응답을 재사용한다. 다른 본문이면 `409 IDEMPOTENCY_CONFLICT`다. 성공 응답은 진단과 같은 DB 트랜잭션에 저장한다. 기존 기록보다 오래된 복구 결과는 `409 DIAGNOSIS_CHANGED`, 만료 초안은 `410 RESULT_EXPIRED`다. 기본 복구 TTL은 24시간이며 `RECOVERY_TTL_HOURS`로 1~168시간 설정한다.

오류 응답은 `detail`, `code`, `retryable`, `request_id`를 제공하며 응답 헤더에도 `X-Request-ID`가 있다. 대표 코드: `UNSUPPORTED_IMAGE_FORMAT`(Content-Type 누락 또는 이미지 외 형식), `INVALID_IMAGE`, `EMPTY_IMAGE`, `IMAGE_TOO_LARGE`, `IMAGE_RESOLUTION_TOO_LARGE`, `REQUEST_TOO_LARGE`, `MODEL_UNAVAILABLE`, `MODEL_VERSION_CONFLICT`, `DIAGNOSIS_NOT_FOUND`, `DATABASE_UNAVAILABLE`, `SAVE_FAILED`, `RECOVERY_STORAGE_UNAVAILABLE`.

오프라인 metadata는 UUID `client_record_id`, 선택적 `selected_crop`, timezone이 있는 `created_at`, `model_version`, `preprocessing_version`, `bundle_version`, 9개 고유 클래스의 합계 1인 `predictions`를 요구한다. `refined_predictions`가 있으면 재촬영 사진도 있어야 한다. 동일 UUID의 동일 본문 재전송은 중복 저장하지 않는다. 기기 확률은 클라이언트 생성값이며 서버 검증을 병해 정확도 검증으로 해석하지 않는다. 상세 준비·배포·검증 범위는 [오프라인 실행 가이드](OFFLINE_WEB.md)를 참조한다.

### GET /ready

실제 체크포인트와 DB 클래스 매핑이 검증되면 200, 그 외에는 503이다.
`status`, `model_loaded`, `prediction_mode`(`model`/`mock`/`unavailable`), `version`을 반환한다.
개발용 Mock은 시연을 허용하더라도 실제 모델 준비 완료로 표시하지 않는다.
모델 파일·실행 설정 변경은 프로세스 재시작 후 반영된다.

## 통신 형식과 인증·보안

REST/HTTP, 요청 파일은 multipart/form-data, 응답은 JSON이다. `crop_type`은 query로 전송한다. 오류는 `detail`을 가진 JSON이며 일반 HTTP 오류는 문자열, FastAPI 입력 검증 422는 오류 항목 배열일 수 있다.

현재 앱에는 로그인·API 인증이 없다. 대신 서버가 첫 요청에 익명 기기 쿠키 `cropy_device`(무작위 값, 1년, `HttpOnly; SameSite=Lax`, HTTPS 프록시 뒤에서는 `Secure`)를 발급하고, 진단 기록을 그 기기 단위로 분리한다. `GET /history`, `GET /history/{id}`, `POST /diagnose/{id}/refine`, `POST /results/{token}/save`는 같은 기기의 기록만 다루며, 다른 기기의 기록은 404다. `Idempotency-Key`와 복구 토큰도 기기별로 구분된다. 기기 분리 이전의 기록(`device_id` 없음)은 어느 기기에도 보이지 않는다. 쿠키를 지우거나 다른 브라우저를 쓰면 다른 기기로 취급되며, 이는 기록 분리일 뿐 인증이 아니다. 브라우저는 같은 출처(Next.js rewrite)로 호출하므로 쿠키가 자동으로 전송된다. `NEXT_PUBLIC_API_URL`로 다른 출처를 직접 호출하면 쿠키가 전송되지 않는다. CORS는 허용 출처 설정이며 인증이 아니다. 이미지 정적 URL(`/uploads/...`)은 추측하기 어려운 UUID 파일명이지만 기기별 접근 검사는 하지 않는다. HTTPS는 배포 프록시에서 설정하며 Compose 기본 구성 자체는 TLS를 제공하지 않는다. 카메라·마이크를 통합할 때 대상 브라우저의 보안 컨텍스트를 확인한다.

## 내부·예정 인터페이스

현재 CNN↔백엔드는 동일 Python 프로세스의 함수 호출이다. 입력은 검증된 이미지 경로, 출력은 전체/Top-3 `(model_class_id, score)`이며 체크포인트 규격은 [MODEL_SPEC](MODEL_SPEC.md)를 따른다. 프론트는 [api.ts](../frontend/src/lib/api.ts)와 [응답 타입](../frontend/src/types/diagnosis.ts)을 사용한다. nullable 응답과 TypeScript 선택 필드의 정합은 후속 코드 보완 대상이다.

Qwen 기능 토큰/handler와 STT 통합은 계획 단계다. 브라우저 카메라 촬영과 Web Speech API TTS 안내는 구현되어 있으며 보드 음성 통합과 구분한다. 데이터 시트의 get_diagnosis 등 기능명을 현재 REST 엔드포인트로 간주하지 않는다. 실제 호출·인자·오류·시간 제한은 [LLM 계획](LLM_FINETUNING_PLAN.md)에 따라 통합 시 확정한다.
