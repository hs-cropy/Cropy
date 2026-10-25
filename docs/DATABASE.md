# CropCare AI - Database Schema

개발과 현재 단일 호스트/Orange Pi 배포는 SQLite를 사용한다. PostgreSQL 이전은 후속 선택 사항이다.
스키마는 `backend/app/models/entities.py`와 `pesticide_usage.py`의 SQLAlchemy 모델이 정의한다.
앱 시작 시 기존 스키마를 보완한 뒤 `Base.metadata.create_all()`로 신규 테이블을 생성한다.

## ER 개요

```
diseases ──< disease_pesticides >── pesticides
    │
    └──< diagnoses (history)
```

## Tables

### diseases

병해 6종 + 정상 3종 = 9행. 모델 클래스와 1:1로 대응한다.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| name | VARCHAR(200) | 병해명 (한글). 예: `무 검은무늬병` |
| name_en | VARCHAR(200) | 영문명 |
| crop_type | VARCHAR(100) | 작물: `고추` / `무` / `배추` |
| category | VARCHAR(50) | `disease` / `normal` (정상=건전주 클래스) |
| description | TEXT | 증상 설명 |
| causes | JSON | 원인 목록 (string 배열) |
| prevention | JSON | 예방 방법 (string 배열) |
| severity | VARCHAR(20) | `low` / `medium` / `high` |
| model_class_id | INTEGER UNIQUE, INDEX | ML 클래스 ID (0~8) |

**`model_class_id`가 시스템의 조인 키다.** 학습 데이터의 클래스 폴더명 앞 숫자
(`2_무검은무늬병`)가 그대로 체크포인트에 기록되고, 추론 결과가 이 값으로 돌아와
`diseases` 행을 찾는다. ImageFolder의 정렬 순서에 의존하지 않으므로 나중에
클래스를 추가해도 기존 ID가 밀리지 않는다.

| model_class_id | 병해 | category |
|---|---|---|
| 0 | 고추 탄저병 | disease |
| 1 | 고추 흰가루병 | disease |
| 2 | 무 검은무늬병 | disease |
| 3 | 무 노균병 | disease |
| 4 | 배추 검은썩음병 | disease |
| 5 | 배추 노균병 | disease |
| 6 | 고추 정상 | normal |
| 7 | 무 정상 | normal |
| 8 | 배추 정상 | normal |

### pesticides

PSIS 제품 식별 정보. 기존 시드에는 23행이 있다. 제품의 사용 조건 칼럼은 이전 호환용이며,
진단 API의 사용 조건은 아래 `pesticide_usages`에서만 가져온다.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| name | VARCHAR(200) | `상표명 (품목명)` 형식 |
| active_ingredient | VARCHAR(200) | 유효성분·제형 |
| registration_no | VARCHAR(50) | `PSIS-{pestiCode}` |
| dilution | VARCHAR(100) | 희석배수 |
| usage_method | TEXT | 사용법 (살포 시기·방법) |
| phi_days | INTEGER | 안전사용기준 — 수확 전 마지막 살포일 |
| reentry_hours | INTEGER | 재입장 시간 (PSIS 미제공, 현재 전부 NULL) |
| safety_notes | TEXT | 안전사용기준·사용횟수 원문 |

### disease_pesticides

병해당 최대 5개 농약을 유효성분이 겹치지 않게 선정해 매핑한다. 현재 25행.

| Column | Type | Description |
|--------|------|-------------|
| disease_id | FK → diseases, PK | |
| pesticide_id | FK → pesticides, PK | |
| priority | INTEGER | 낮을수록 우선 추천 |

정상 클래스(6·7·8)에는 매핑이 없다.

### pesticide_usages

제품과 별도로 작물·병해별 사용 조건을 저장한다. 동일 제품·병해에도 여러 등록 조건을 보존한다.
`id`, 고유 `key`, `disease_id`, `pesticide_id`, `source_usage_key`, `priority`,
`dilution`, `usage_method`, `phi_days`, `reentry_hours`, `safety_notes`,
`source`, `verification_status`, `synced_at`, `source_payload`를 가진다.
`(disease_id, pesticide_id, source_usage_key)`는 유일하다. 응답은 priority와 안정적인 보조 키로 정렬한다.

기존 제품 단위 조건은 작물·병해별 정합성을 입증하지 못하므로 `legacy_unverified`로 이전하며,
수치·사용법은 API에서 숨긴다. 원천 조회가 검증된 사용 조건만 `verified`로 제공한다.
이전 원본 제품 칼럼은 삭제하지 않는다.

### diagnoses

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(36) PK | UUID4 문자열 |
| disease_id | FK → diseases | 최종 확정 병해 |
| confidence | FLOAT | Top-1 신뢰도 |
| top_predictions | JSON | `[{name, confidence}, ...]` (최대 3개) |
| image_path | VARCHAR(500) | 1차 사진의 서버 저장 경로 |
| refined_image_path | VARCHAR(500) | 판별부위 2차 촬영 사진 경로 (미재확정 시 NULL) |
| crop_type | VARCHAR(100) | 사용자 선택값 또는 예측 병해의 작물 |
| created_at | DATETIME | server_default=now() |
| selected_crop | VARCHAR(100) | 사용자 선택; 기존 이력은 추정하지 않고 NULL |
| prediction_mode | VARCHAR(20) | model / mock / legacy |
| model_version | VARCHAR(100) | 본 모델 SHA256 또는 mock-v1 |
| preprocessing_version | VARCHAR(100) | 입력 전처리 규격 |
| pair_model_version | VARCHAR(100) | 해당 실행의 선택적 보조 모델 해시 |
| original_predictions | JSON | 최초 전체 클래스 ID·점수 분포 |
| recapture | JSON | 재촬영 지침, 재촬영 완료 후 NULL |
| updated_at | DATETIME | 마지막 갱신 UTC 시각 |
| revision | INTEGER | 동시 수정 검출용 버전, 기본 1 |

새 이미지 경로는 저장 루트에 독립적인 파일명만 기록한다. 기존 Windows·절대 경로는
basename을 추출하여 현재 UPLOAD_DIR에서 읽는다. DB와 해당 이미지 파일을 함께 이전해야 한다.
SQLite가 반환하는 naive UTC 시각은 API에서 UTC offset을 명시한다. 외부에서 임의로 로컬 시각을
넣은 데이터는 자동으로 판단할 수 없으므로 별도 확인한다.

`POST /diagnose/{id}/refine`은 새 행을 만들지 않고 **기존 행의
`disease_id` · `confidence` · `top_predictions` · `refined_image_path`를 갱신한다.**
`image_path`(1차 사진)는 보존되므로 어떤 두 장으로 재확정했는지 추적할 수 있다.

## 스키마 변경

마이그레이션 도구를 도입하기 전까지, 나중에 추가된 칼럼은 앱 시작 시
`ensure_columns()`(`app/core/database.py`)가 보완한다. `create_all()`은 이미 존재하는
테이블에 칼럼을 추가하지 못하므로, 누락된 칼럼만 `ALTER TABLE ... ADD COLUMN`으로
덧붙여 기존 진단 이력을 보존한다. 멱등이며 대상 목록은 `_ADDED_COLUMNS`에 있다.

칼럼을 추가할 때는 SQLAlchemy 모델과 `_ADDED_COLUMNS` 양쪽을 함께 갱신해야 한다.
칼럼 삭제·타입 변경은 지원하지 않는다. SQLite 연결마다 FK를 활성화하고, 기동 시 기존 FK 위반을
검사한다. 위반이 있으면 자동 삭제·보정 없이 기동을 중단한다. 기존 파일에 추가할 칼럼이 있으면
먼저 `<DB>.backup-<UTC시각>-<UUID>` 백업을 만들고 단일 쓰기 트랜잭션으로 ALTER한다.
실패 시 ALTER를 rollback한다. 백업·복원 절차는 [BACKEND_OPERATIONS](BACKEND_OPERATIONS.md)를 참고한다.

## Seed Data

`backend/app/data/seed/`의 diseases.json과 농약 카탈로그를 앱 시작 시 적재한다.
새 `pesticide_catalog.json`이 있으면 단일 버전 묶음을 우선하며, 없으면 기존 JSON 3종을 읽는다.

| 파일 | 행 수 | 출처 |
|------|-------|------|
| `diseases.json` | 9 | 수기 작성 (증상·원인·예방) |
| `pesticides.json` | 23 | 과거 제품 시드; 작물별 사용 조건 미검증 |
| `disease_pesticides.json` | 25 | 과거 연결 시드 |
| `pesticide_catalog.json` | 동기화 결과에 따름 | PSIS 제품·작물·병해별 사용 조건을 담은 원자적 스냅샷 |

**시드 JSON이 목표 상태다.** 시딩은 매 기동마다 DB를 그 상태로 맞춘다.

| 대상 | 식별 기준 | 동작 |
|------|-----------|------|
| 농약 | `registration_no` (원천 식별자 없는 과거 자료만 이름 호환) | 추가·갱신, 완전한 선택 목록에서 제외되면 삭제 |
| 질병 | `model_class_id` | 없으면 추가, 있으면 내용 갱신, 삭제하지 않음 |
| 매핑 | (disease, pesticide) | JSON에 있는 조합만 남기고 나머지는 삭제, `priority` 갱신 |

동기화는 모든 작물·병해 조회와 페이지를 검증한 뒤 단일 카탈로그를 원자적으로 교체한다.
업무 오류·잘못된 응답·부분 실패는 기존 카탈로그를 변경하지 않는다. 정상 0건과 실패를 구분한다.
조회에서 선택한 목록에서 빠진 것만으로 등록 취소라고 단정하지 않는다.

**질병 행만 삭제하지 않는다.** `diagnoses.disease_id`가 FK로 참조하므로 클래스를
지우면 과거 진단 이력이 깨진다. 클래스 제거는 수동 마이그레이션 대상이다.

시딩 실패는 트랜잭션을 롤백한다. 운영 DB를 삭제해 재적재하지 말고
[백업·복구 절차](BACKEND_OPERATIONS.md)를 따른다.


진단 결과 카드: diseases.summary_message(TEXT), management_action_details(JSON)를
추가하며 seed로 갱신한다. 새 진단 content_snapshot에 함께 보존한다. 기존 진단
스냅샷·이전 기록에 없는 새 필드는 응답에서 null/[]이며 현재 문구를 소급하지 않는다.
