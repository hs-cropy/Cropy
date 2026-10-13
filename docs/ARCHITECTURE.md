# cropy - Architecture

**갱신:** 2026-10-12. 현재 로컬 웹앱 구현과 목표 단말 구성을 구분한다.

## 단말 목표와 현재 구현

목표 단말은 **Orange Pi 5 Plus / RK3588 / ARM64 / RAM 16GB**다. 서버 추론은 PyTorch이며 브라우저 오프라인 경로는 ONNX Runtime WASM을 사용한다. RKNN/RKLLM 보드 런타임은 연결되지 않았다. 보드 OS·드라이버·ARM64 의존성·자원 실측은 [배포 가이드](ORANGEPI5_DEPLOY.md)에 따라 확인한다.

```text
현재: 스마트폰/PC 브라우저 → Next.js 프록시 → FastAPI 프로세스
                                                 ├─ PyTorch CNN
                                                 ├─ SQLite / 이미지 파일
                                                 └─ 병해·농약 카탈로그 조회
목표: Orange Pi 5 Plus 내부에 웹·API·CNN·DB 배치
      카메라·마이크 → 단말 입력 → 진단/질문 근거 → Qwen/RKLLM
      검증된 handler/문장 → 화면·TTS → 스피커
```

스마트폰 브라우저는 준비된 ONNX 모델을 내려받은 뒤 오프라인 추론·기기 기록 저장·서버 동기화를 수행할 수 있다. 실제 기기 성능은 추가 검증 대상이다. 브라우저 TTS 안내는 구현되었으며 Qwen 기능 토큰·STT·보드 단말 에이전트는 계획이다. SUDA는 SDK와 보드 지원을 확인한 뒤 선택 비교할 대안이다. 인터넷 없는 전체 흐름과 NPU 경합은 실기기에서 검증한다.

## 시스템 구성

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│  ML Engine  │
│  (Next.js)  │     │  (FastAPI)  │     │  (PyTorch)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   SQLite    │
                    │  (SQLAlch.) │
                    └─────────────┘
```

ML 엔진은 별도 프로세스가 아니라 백엔드 프로세스 안에서 동작한다.
`app/services/ml_service.py`가 체크포인트를 `lru_cache`로 한 번만 로드해 상주시키고,
앱 시작(lifespan) 때 예열한다. 개발 환경에서 명시적으로 허용한 경우만 고정 분포의
Mock 결과를 반환한다. 운영은 실제 모델과 클래스 매핑이 유효해야 진단할 수 있다.
`/api/v1/ready`로 준비 상태를 확인한다. 이미지 검증·추론·DB 처리는 작업 스레드에서
실행하고 프로세스별 세마포어로 동시 진단 수를 제한한다.

개발 환경에서 프론트엔드는 `next.config.js`의 rewrite로 `/api/*`와 `/uploads/*`를
`localhost:8000`으로 프록시한다. 브라우저는 동일 출처로만 통신한다.

## 디렉터리 구조

```
cropy/
├── docs/                 # 프로젝트 문서
├── backend/              # FastAPI REST API
│   ├── app/
│   │   ├── api/routes/   # diagnosis, diseases, health
│   │   ├── core/         # 설정(pydantic-settings), DB 엔진·세션
│   │   ├── models/       # SQLAlchemy 엔티티
│   │   ├── schemas/      # Pydantic 스키마
│   │   ├── services/     # 진단·추론·유도촬영·시딩 로직
│   │   └── data/seed/    # 병해·농약 시드 JSON
│   ├── scripts/          # sync_pesticides.py (PSIS 동기화)
│   └── tests/            # pytest (API 스모크 + 유도촬영 단위)
├── frontend/             # Next.js 웹 앱 (App Router)
│   └── src/
│       ├── app/          # 라우트: / , /history , /history/[id]
│       ├── components/   # DiagnoseForm, DiagnosisResult, RecapturePanel …
│       ├── lib/api.ts    # 백엔드 호출
│       └── types/        # 백엔드 스키마와 대응하는 TS 타입
├── ml/                   # CNN 학습·평가·추론
│   ├── prepare_dataset.py    # AI Hub 원천 → ImageFolder 9클래스
│   ├── prepare_pair.py       # 무 혼동쌍 2클래스 데이터셋
│   ├── train.py / evaluate.py / predict.py
│   └── checkpoints/          # *.pth (git 제외)
├── data/                 # 원천·가공 데이터셋 (git 제외)
└── docker-compose.yml    # 백엔드 + 프론트 단일 호스트 배포
```

## 배포 구성

`docker-compose.yml`은 두 컨테이너를 띄우고 프론트엔드 포트만 외부에 노출한다.

```
브라우저 ──▶ frontend:3000 ──(rewrite)──▶ backend:8000
                                             │
                            /models (ro)  ───┤  체크포인트 (호스트 마운트)
                            /data (volume) ──┘  SQLite + 업로드 이미지
```

브라우저가 백엔드를 직접 호출하지 않으므로 CORS 설정이 필요 없고, API가 반환하는
`/uploads/...` 상대경로 이미지도 같은 오리진에서 해결된다.

`BACKEND_ORIGIN`은 런타임이 아니라 **빌드 인자**다. Next.js standalone 산출물은
`next.config.js`를 포함하지 않고 rewrite 목적지를 빌드 시점에 굳혀 넣기 때문에,
환경변수로 주면 조용히 무시된다.

## 기술 스택

| 계층 | 기술 |
|------|------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 3, Iconify(Lucide) |
| Backend | FastAPI 0.143, SQLAlchemy 2.0, Pydantic v2 |
| ML | PyTorch, torchvision — ResNet50 fine-tune (9클래스) + ResNet18 혼동쌍 분류기 |
| Database | SQLite (현재 개발·단일 호스트 운영), PostgreSQL은 후속 선택 사항 |
| Storage | 로컬 파일 시스템 — `backend/uploads/`, `StaticFiles`로 서빙 |

## 데이터 흐름

### 1차 진단

1. Frontend → `POST /api/v1/diagnose` (multipart image)
2. JPEG·PNG 형식·전체 디코딩·픽셀 수를 검증하고 실제 형식에 따라 `uploads/{uuid}.jpg|png`로 저장
3. ML 추론 → 클래스별 softmax → 상위 3개 `(model_class_id, confidence)`
4. 모델 출력의 ID·점수와 `diseases` 매핑을 검증 → 병해 설명·원인·예방·연관 농약 조회.
   계약 오류는 임의 병명으로 대체하지 않고 503 처리하며 새 파일을 정리
5. **유도촬영 판정**: 상위 두 후보가 사전 정의된 혼동쌍이고 마진 < 0.20이면
   판별부위 재촬영 지침(`recapture`)을 응답에 동봉
6. `diagnoses` 테이블에 이력 저장 → 통합 결과 JSON 반환

### 재확정 (유도촬영이 발동한 경우)

7. 사용자가 지정된 부위를 촬영 → `POST /api/v1/diagnose/{id}/refine`
8. 1차·2차 사진의 **전체 클래스 분포**를 각각 추론
9. 가중 평균으로 융합 (2차 촬영 가중 0.6 — 표적 부위이므로 더 신뢰)
10. 혼동쌍 전용 분류기가 있고 1차 상위 두 후보가 그 쌍이면, 쌍 내부 비중만 재분배
    (합계 질량 보존 → 쌍 밖 클래스는 영향 없음)
11. 기존 `diagnoses` 행을 갱신하고 재확정 결과 반환

유도촬영·융합의 상세 설계와 실측 근거는 [MODEL_SPEC.md](MODEL_SPEC.md)를 참고.

## 외부 연동

- **농약안전정보시스템(PSIS) OpenAPI** — 구현 완료.
  `backend/scripts/sync_pesticides.py`가 작물×병해별 등록 농약을 조회해
  시드 JSON을 재생성한다. 농약 추천은 학습 문제가 아니라 법적 등재 정보의
  조회 문제이므로 모델이 아닌 공공데이터로 해결한다.
- 농촌진흥청 작물병해충 정보 — 미연동. 현재 병해 설명·원인·예방은 수기 시드 데이터다.

## 알려진 구조적 제약

- **인증 없음.** 진단 이력이 전역 공유된다 (사용자·농장 개념 Phase 2).
- **마이그레이션 도구 없음.** `create_all()`로 스키마를 만들고, 추가된 칼럼만
  `ensure_columns()`가 보완한다 (칼럼 삭제·타입 변경은 미지원).
  시드 데이터는 매 기동마다 JSON을 목표 상태로 동기화한다
  ([DATABASE.md](DATABASE.md#seed-data) 참고).
- **보관기간·자동 정리 정책 미확정.** 수동 고아 파일 정리 도구가 있으며 업로드 크기는
  `MAX_UPLOAD_MB`(기본 10MB), 이미지 픽셀 수는 `MAX_IMAGE_PIXELS`(기본 40,000,000)로
  제한되고 2차 촬영 사진도 DB에 기록된다. 모델 출력 검증 실패 시 이번 요청 파일은
  정리하며 일반 추론·DB 실패에도 롤백과 새 파일 제거를 수행한다. 재촬영 교체는
  커밋 후 이전 파일을 제거하고, 오래된 미참조 파일은 `cleanup_uploads.py`로 정리한다.
  ASGI 계층에서 multipart 파싱 전 실제 수신량을 제한하고 파일별 크기도 별도로 검사한다.
- **이미지 정적 제공.** `/uploads`는 JPEG·PNG 확장자만 고정 MIME과 `nosniff`로 제공한다.
  기존 `.html` 등 비허용 확장자 파일은 디스크에 보존되지만 해당 URL은 404가 된다.
- **단일 프로세스 전제.** 모델을 프로세스 메모리에 상주시키므로 워커를 늘리면
  워커 수만큼 모델 메모리가 필요하다. ResNet50 기본 체크포인트는 약 94.4MB(십진 단위)이며 파일 크기와 실행 RAM은 다르다.

## 데이터 보호와 모듈 간 계약

사용자 사진은 이력 이미지로 로컬 저장하고 정적 URL로 제공한다. 현재 인증과 사용자별 접근 제어가 없어 공유 환경의 개인정보 보호 설계는 추가 작업이다. 서버 모델 해시·전처리·prediction_mode와 재촬영 출처를 이력에 기록한다. 데이터 보관기간·음성 로그 범위는 운영 정책으로 확정한다.

CNN→백엔드 계약은 [모델 명세](MODEL_SPEC.md), 백엔드→프론트 계약은 [API 명세](API_SPEC.md), 화면 구현 범위는 [기능명세](xpdocs/06_웹앱_기능명세서.md)에 정의한다. 최신 UI/UX 보고서의 시안은 현재 코드의 구현 완료를 의미하지 않는다.
