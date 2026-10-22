# 백엔드 API / Swagger 안내

실제 구현 기준: `backend/app/main.py`, `backend/app/api/routes/`, 요청 제한·오류 미들웨어 및 관련 서비스. 2026-10-15 기준 업무 API는 **12개**이며, 별도로 이미지 정적 제공 경로가 있습니다.

## 실행·접속

저장소 루트에서 기존 백엔드 가상환경을 사용합니다. 처음 설치한다면 루트 README의 Backend 절을 먼저 따르세요.

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

- Swagger UI: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/openapi.json>
- ReDoc: <http://localhost:8000/redoc>

Swagger에서 태그별 API를 펼치고 **Try it out → Execute**로 실제 서버를 호출합니다. POST 요청은 사진·기록을 저장할 수 있습니다. Swagger UI 자산은 FastAPI 기본 외부 CDN을 사용하므로 처음 열 때 인터넷 연결이 필요할 수 있습니다.

공유용 OpenAPI 파일은 서버 실행 후 내려받습니다. 코드를 변경했다면 다시 내려받아야 합니다.

```powershell
Invoke-WebRequest http://localhost:8000/openapi.json -OutFile openapi.json
```

## 전체 업무 API

모든 경로는 `/api/v1`로 시작합니다. 요청·응답 필드와 오류 스키마는 Swagger에서 확인합니다.

| 메서드 | 경로 | 역할 | 주요 입력 |
| --- | --- | --- | --- |
| GET | `/health` | 서버 생존 확인 | 없음 |
| GET | `/ready` | 실제 모델 추론 준비 확인 | 없음 |
| GET | `/capabilities` | 지원 작물·한도·판단 정책·기능 조회 | 없음 |
| POST | `/diagnose` | 사진 진단 | multipart `file`, 쿼리 `crop_type`, 선택 헤더 `Idempotency-Key` |
| POST | `/diagnose/{diagnosis_id}/refine` | 두 번째 사진으로 재확정 | 경로 ID, multipart `file`, 선택 헤더 `Idempotency-Key` |
| POST | `/results/{token}/save` | 저장 실패 결과 복구 | 경로 `recovery_token`, 본문 없음 |
| GET | `/history` | 저장된 이력 목록 | `page`, `size`, `crop_type`, `severity` |
| GET | `/history/{diagnosis_id}` | 이력 상세 | 경로 ID |
| GET | `/diseases` | 병해·정상 클래스 목록 | `q`(이름 부분 검색), `crop_type` |
| GET | `/diseases/{disease_id}` | 클래스 상세 | DB 정수 ID(모델 클래스 ID와 구분) |
| GET | `/offline/manifest` | 브라우저 모델 묶음 조회 | 없음 |
| POST | `/offline/records` | 기기 진단 기록 동기화 | multipart `metadata`, `file`, 선택 `refined_file` |

추가 HTTP 경로:

- `GET/HEAD /uploads/{filename}`: 업로드 이미지 제공. JPEG/PNG만 허용하며 없는 파일·차단된 확장자는 404입니다. `X-Content-Type-Options: nosniff` 헤더를 포함합니다. OpenAPI 업무 경로로 등록되지 않은 StaticFiles 마운트입니다.
- `/docs`, `/docs/oauth2-redirect`, `/redoc`, `/openapi.json`: FastAPI가 등록하는 문서 경로입니다. OAuth 리다이렉트 페이지가 존재해도 앱에 인증이 구현되어 있다는 뜻은 아닙니다.
- ONNX `/offline-assets/…` 파일은 프론트엔드가 제공합니다. 백엔드는 묶음 메타데이터를 반환합니다.

현재 백엔드에는 로그인·사용자별 이력 분리, 이력 삭제 API가 구현되어 있지 않습니다.

## 진단·저장 흐름

1. `/capabilities`의 `upload`에서 파일 형식·바이트·픽셀 상한을 확인합니다. 기본 파일 한도는 100 MiB, 해상도 상한은 210,000,000픽셀이지만 환경 설정에 따라 달라집니다.
2. `/ready`가 200이면 DB 연결과 실제 모델 준비가 완료된 상태입니다. `/health`의 200만으로 추론 준비를 판단하지 않습니다. 개발용 mock도 `/ready`에서는 503입니다.
3. `/diagnose`의 **file**에 JPG/PNG, HEIC/HEIF, DNG(RAW), WebP, AVIF 사진을 넣고 파일 파트의 Content-Type을 해당 `image/*`로 지정합니다. MIME 누락·`application/octet-stream`도 실제 디코딩 검증 후 허용합니다. 새 형식 및 긴 변 4096픽셀 초과 사진은 JPEG로 변환합니다. DNG 압축 방식별 지원은 서버 디코더에 따라 달라집니다. 작물은 폼 항목이 아니라 **쿼리 `crop_type`**입니다.
4. `prediction_mode`, `decision_status`, `decision_reasons`, `recapture`를 확인합니다. 낮은 신뢰도나 작물 불일치 결과도 HTTP 200일 수 있습니다.
5. `save_status=failed`이면 진단은 완료됐지만 DB 저장에 실패한 것입니다. `recovery_token`을 `/results/{token}/save`에 넣어 POST합니다. 기본 보관 시간은 24시간이며 실제 값은 `/capabilities`를 확인합니다.

진단·재촬영의 `Idempotency-Key`는 선택 사항이며 1~128자입니다. 같은 작업에서 같은 키와 같은 사진·작물은 보관된 결과를 재사용합니다. 같은 키로 다른 내용을 보내면 `409 IDEMPOTENCY_CONFLICT`입니다.

전체 본문 제한은 일반 요청에서 파일 한도+64 KiB, `/offline/records`에서 파일 한도×2+64 KiB입니다. 이미지별 용량·픽셀 검증도 별도로 수행합니다.

## 오프라인 기록 입력

`/offline/records`는 서버 추론 없이 기기에서 생성한 결과를 저장합니다. `metadata`는 **JSON 문자열인 multipart 폼 필드**입니다. Swagger 입력 예시의 버전을 실제 manifest 값으로 바꿔 사용합니다.

| JSON 필드 | 규칙 |
| --- | --- |
| `client_record_id` | 필수 UUID, 기기에서 생성한 기록 ID 겸 중복 방지 키 |
| `selected_crop` | 선택 항목, 고추/무/배추 또는 null |
| `model_version` | 필수, 100자 이하, 해당 manifest와 일치 |
| `preprocessing_version` | 필수, 100자 이하, 해당 manifest와 일치 |
| `bundle_version` | 필수, manifest의 `version` 값(정확히 64자리 소문자 hex). 빈 값·길이·문자 형식 오류는 422, 올바른 형식의 미지원 버전은 409 |
| `created_at` | 필수, 시간대 포함, 2000년 이후·서버 현재 시각+5분 이하 |
| `predictions` | 필수, `{class_id, confidence}` 9개. 정수 ID 0~8이 한 번씩, 확률 0~1, 합계 1±0.001 |
| `refined_predictions` | 선택, 동일 규칙의 9개 분포. 제공 시 `refined_file`도 필수 |

동일 기록 ID의 다른 입력은 충돌합니다. 동기화 결과는 `prediction_mode=browser`이며 `save_status`와 복구 토큰도 확인해야 합니다.

OpenAPI의 `metadata.contentSchema`는 실제 입력 검증 모델에서 생성한 `LocalRecord` 스키마를 참조합니다. 전송 형식은 계속 문자열이며 JSON 객체 본문으로 바뀌지 않습니다.

## 오류 응답

```json
{
  "detail": "요청 항목을 확인해 주세요.",
  "code": "VALIDATION_ERROR",
  "retryable": false,
  "request_id": "c60fdccb-782e-4f84-a847-dfe2408f744a"
}
```

`request_id`는 응답 헤더 `X-Request-ID`와 같습니다. 422도 FastAPI 기본 검증 오류 배열이 아닌 위 객체입니다. `/ready`의 503은 예외적으로 `status`, `database_connected`, `model_loaded`, `prediction_mode`, `version`을 반환합니다.

| 상태 | 대표 코드·조건 |
| --- | --- |
| 400 | `EMPTY_IMAGE`, `INVALID_IMAGE`, `UNSUPPORTED_IMAGE_FORMAT`, `REFINEMENT_UNAVAILABLE`, `MISSING_REFINEMENT_EVIDENCE`, 잘못된 multipart의 `HTTP_ERROR` |
| 404 | `DIAGNOSIS_NOT_FOUND`, `RESULT_NOT_FOUND`, 병해 조회의 `NOT_FOUND` |
| 409 | `IDEMPOTENCY_CONFLICT`, `MODEL_VERSION_CONFLICT`, `DIAGNOSIS_CHANGED`, `UNSUPPORTED_BUNDLE` |
| 410 | `RESULT_EXPIRED` — 복구 결과 보관 만료 |
| 413 | `REQUEST_TOO_LARGE`, `IMAGE_TOO_LARGE`, `IMAGE_RESOLUTION_TOO_LARGE` |
| 422 | `VALIDATION_ERROR` |
| 500 | 처리되지 않은 서버 예외. 일반 텍스트 `Internal Server Error`일 수 있으며 공통 JSON 형식 보장 없음 |
| 503 | `MODEL_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`, `RECOVERY_STORAGE_UNAVAILABLE`, `SAVE_FAILED`, `OFFLINE_BUNDLE_UNAVAILABLE` |

각 API가 반환하는 상태·코드의 범위는 Swagger의 해당 Responses 설명을 확인하세요. 요청 파싱 단계의 기타 HTTP 오류에는 `HTTP_ERROR`가 사용될 수 있습니다.

사진 저장 실패는 `503 IMAGE_STORAGE_UNAVAILABLE`로 반환하며 부분 파일 정리와 DB 롤백을 수행합니다. 복구 저장소 디렉터리 생성 실패는 `503 RECOVERY_STORAGE_UNAVAILABLE`입니다. 이미 진단 결과를 생성했지만 DB 저장에 실패한 `200 + save_status=failed`와 구분하세요.

## 유지보수·검증

라우트의 `summary`, `description`, `responses`와 Pydantic 필드 설명이 문서 원본입니다. 공통 문서 설정은 `backend/app/api/documentation.py`에 있습니다. 문서 전용 응답 스키마는 기존 런타임 응답을 필터링하지 않습니다.

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
```

`tests/test_openapi.py`는 등록된 전체 API의 문서 포함 여부, 실제 422 응답과 스키마 일치, readiness 응답 계약을 검증합니다.

작성 방식 참고: [FastAPI 추가 응답 문서](https://fastapi.tiangolo.com/advanced/additional-responses/), [태그·메타데이터](https://fastapi.tiangolo.com/tutorial/metadata/).
