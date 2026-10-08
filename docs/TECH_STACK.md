# cropy 기술 스택

> 갱신: 2026-10-08. 현재 로컬 의존성 선언과 구현 기준이며 실제 설치 버전은 환경별로 기록한다.
> AI 기반 농작물 병해충 진단 및 스마트 방제 지원 플랫폼에서 사용하는 기술을 계층별로 정리한 문서입니다.
> 버전은 `backend/requirements.txt`, `frontend/package.json`, `ml/requirements.txt` 기준입니다.

## 한눈에 보기

| 계층 | 기술 | 버전 | 역할 |
|------|------|------|------|
| 프론트엔드 | Next.js (React) | 15.x (React 19) | 모바일 퍼스트 웹 앱 |
| 스타일링 | Tailwind CSS | 3.4.x | 현재 코드의 브라운/카키/옐로 디자인 토큰 |
| 백엔드 | FastAPI | 0.115.x | REST API 서버 |
| DB | SQLite + SQLAlchemy | 2.0.x (ORM) | 진단 이력·병해·농약 데이터 저장 |
| AI/ML | PyTorch + torchvision | 2.12.x (+cpu) | ResNet50 기반 9클래스 병해 분류 |
| 배포 | Docker Compose | - | 백엔드 + 프론트 단일 호스트 배포 |
| 언어 | TypeScript / Python | 5.7 / 3.13 | 프론트 / 백엔드·ML |

---

## 1. 프론트엔드 (`frontend/`)

**Next.js 15 + React 19 + TypeScript** 조합의 웹 앱입니다. 스마트폰으로 밭에서 바로 사진을 찍어 올리는 사용 흐름에 맞춰 **모바일 퍼스트**로 설계했습니다.

| 기술 | 버전 | 왜 쓰는가 |
|------|------|-----------|
| [Next.js](https://nextjs.org) | ^15.1 | React 프레임워크. App Router 사용, `output: "standalone"`으로 Docker 이미지를 최소화 |
| React | ^19.0 | UI 컴포넌트 라이브러리 |
| TypeScript | ^5.7 | 정적 타입으로 API 응답 타입(`src/types/diagnosis.ts`) 안전하게 관리 |
| Tailwind CSS | ^3.4 | 유틸리티 클래스 기반 스타일링. 브라운/카키/옐로 토큰으로 서비스 아이덴티티 구현 |
| @iconify/tailwind + Lucide | ^1.2 | 아이콘을 CSS 클래스로 사용 (별도 아이콘 컴포넌트 불필요) |
| PostCSS + Autoprefixer | - | Tailwind 빌드 파이프라인 |

### 구조

```
frontend/src/
├── app/              # App Router 페이지 (홈=진단, history=이력)
├── components/       # AppBar, BottomNav, DiagnoseForm,
│                     # DiagnosisResult, RecapturePanel, TextSizeToggle
├── lib/api.ts        # 백엔드 API 호출 래퍼
└── types/            # API 응답 타입 정의
```

### 핵심 설계: API 프록시 (rewrites)

브라우저는 **프론트엔드 오리진 하나만** 호출합니다. `next.config.js`의 rewrite가 `/api/*`와 `/uploads/*`를 백엔드로 프록시하므로:

- **CORS 설정이 필요 없음** — 브라우저 입장에선 같은 오리진
- 백엔드 포트를 외부에 열 필요 없음
- 주의: `localhost` 대신 `127.0.0.1`을 명시 (Node가 localhost를 IPv6로 먼저 해석해 uvicorn 연결이 실패하는 문제 회피)

---

## 2. 백엔드 (`backend/`)

**FastAPI + Python 3.13** REST API 서버입니다. 이미지 업로드를 받아 ML 추론을 수행하고, 병해 정보·농약 추천·진단 이력을 제공합니다.

| 기술 | 버전 | 왜 쓰는가 |
|------|------|-----------|
| [FastAPI](https://fastapi.tiangolo.com) | 0.115.6 | 비동기 REST API 프레임워크. `/docs`에서 Swagger 문서 자동 생성 |
| Uvicorn | 0.34.0 | ASGI 서버 (프로덕션에서도 단일 워커 — 워커마다 모델이 메모리에 복제되기 때문) |
| SQLAlchemy | 2.0.36 | ORM. 진단 이력, 병해, 농약 테이블 관리 |
| SQLite | - | 파일 기반 DB. 단일 호스트 규모에 충분하고 별도 DB 서버 없이 단일 호스트 운영 |
| Pydantic (+settings) | 2.10 / 2.7 | 요청·응답 스키마 검증, 환경변수 기반 설정(`core/config.py`) |
| Pillow | 11.0.0 | 업로드 이미지 검증·전처리 |
| python-multipart | 0.0.20 | 이미지 파일 업로드(multipart/form-data) 파싱 |
| aiofiles | 24.1.0 | 업로드 파일 비동기 저장 |
| httpx | 0.28.1 | PSIS(농약안전정보시스템) API 동기화 스크립트(`scripts/sync_pesticides.py`)에서 사용 |
| pytest | 9.1.1 | 테스트 (`backend/tests/`) |

### 구조 (계층형 아키텍처)

```
backend/app/
├── main.py           # 앱 진입점
├── api/routes/       # 엔드포인트 (diagnose, history, diseases, health …)
├── services/         # 비즈니스 로직
│   ├── ml_service.py        # 모델 로드·추론 (모델 검증·개발 시연·운영 오류 구분)
│   ├── diagnosis_service.py # 진단 처리·이력 저장
│   ├── recapture.py         # 혼동쌍 접전 시 판별부위 재촬영 유도 (특허 출원 대상)
│   └── seed.py              # 병해·농약 시드 데이터
├── models/           # SQLAlchemy 모델
├── schemas/          # Pydantic 스키마
└── core/             # 설정, DB 세션
```

### 주요 API

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/v1/diagnose` | 이미지 진단 |
| POST | `/api/v1/diagnose/{id}/refine` | 판별부위 2차 촬영으로 재확정 |
| GET | `/api/v1/history`, `/api/v1/history/{id}` | 진단 이력 |
| GET | `/api/v1/diseases` | 병해충 목록 |
| GET | `/api/v1/health` | 프로세스 생존 확인 |
| GET | `/api/v1/ready` | 실제 모델·DB 클래스 준비 확인 |

---

## 3. AI / ML (`ml/`)

**PyTorch** 기반 이미지 분류 파이프라인입니다.

| 기술 | 버전 | 왜 쓰는가 |
|------|------|-----------|
| PyTorch | 2.12.1+cpu (서빙) / ≥2.6 (학습) | 딥러닝 프레임워크 |
| torchvision | 0.27.1+cpu | 사전학습 ResNet 백본, 이미지 변환 |
| NumPy | ≥2.1 | 수치 연산 |

### 모델

- **ResNet50** 전이학습, **9클래스** — 고추·무·배추 3작물 × (병해 + 정상)
- 기본 모델의 원본 평가 기록은 val 94.7% / test 93.1%, 축소 번들 val은 96.23%다. 기존 분할 중복이 있어 독립 성능으로 단정하지 않는다.
- 최신 별도 256 후보는 val 4,070장 정확도 99.5823% / Macro F1 0.962436이며 서비스 교체 보류다. [모델 명세](MODEL_SPEC.md)의 버전별 표를 따른다.
- 학습은 Colab GPU. 기존 번들은 `pack_for_colab.py`/`train_colab.ipynb`, 최신 전체 데이터는 `train_full_colab.py`/`cropy_full_colab.ipynb` 사용. 현재 CPU 휠 선언 기준 서빙하며 코드에는 CUDA 사용 가능 시 선택 분기가 있다.
- 백엔드는 `+cpu` 휠을 선언한다. Docker 이미지 크기·빌드 시간은 실제 빌드 환경에서 측정한다.
- 체크포인트에 백본 정보가 기록되어 백엔드가 resnet18/50을 자동 인식

### 스크립트

| 파일 | 역할 |
|------|------|
| `train.py` | 학습 (`--arch`, `--resume` 지원, val 정확도 개선 시에만 저장) |
| `evaluate.py` | test 분할 정확도·혼동행렬 |
| `predict.py` | 단건 추론 |
| `prepare_dataset.py` / `prepare_pair.py` | 기존 9클래스 / 무 혼동쌍 학습 데이터 준비 |
| `train_full_colab.py` | 공식 전체 분할 학습·Macro F1 모델 선택·이어학습 |
| `compare_crop_ablation.py` / `compare_resolution_finetune.py` | 크롭 제거 / 256·384 미세조정 대조 실험 |
| `pack_for_colab.py` | Colab 학습 번들 생성 |

체크포인트(`ml/checkpoints/*.pth`)는 Git에서 제외한다. 모델이 없을 때는 `APP_ENV=development`와 `ALLOW_MOCK_PREDICTIONS=true`가 모두 설정되어야 시연한다. 운영은 모델 미로드·계약 오류 시 진단 503이다. 선택 보조 모델은 기본 비활성화다.

---

## 4. 데이터 & 외부 연동

| 항목 | 기술 |
|------|------|
| 진단 이력·병해·농약 DB | SQLite (`cropcare.db`) |
| 업로드 이미지 | 로컬 파일시스템 (`uploads/`, Docker에선 볼륨) |
| 농약 데이터 | **PSIS(농약안전정보시스템) OpenAPI** — `sync_pesticides.py`로 등록농약 시드 갱신 (API 키 필요) |

---

## 5. 배포 (Docker)

```
docker compose up -d --build   →   http://localhost:3000
```

| 항목 | 내용 |
|------|------|
| 백엔드 이미지 | `python:3.13-slim` + CPU 전용 torch |
| 프론트 이미지 | `node:22-alpine` 멀티스테이지 빌드 (deps → builder → runner), Next.js standalone 출력 |
| 네트워크 | 백엔드는 `expose`만 (외부 미노출), 프론트만 3000 포트 공개 |
| 영속화 | `cropcare-data` 볼륨에 SQLite + 업로드 이미지, `ml/checkpoints`는 읽기전용 마운트 |
| 준비 상태 검사 | `/api/v1/ready` 30초 간격, start_period 60초. Mock은 ready 실패 |

⚠️ **주의**: `BACKEND_ORIGIN`은 **빌드 시점** 인자(build args)입니다. Next.js standalone이 rewrite 목적지를 빌드 산출물에 굳혀 넣기 때문에 런타임 환경변수로는 바꿀 수 없고, 변경 시 `docker compose up -d --build`로 재빌드해야 합니다.

### 로컬 개발 실행

```bash
# Backend
cd backend && .venv\Scripts\activate
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev   # http://localhost:3000
```

---

## 6. 기술 선택 이유 요약

- **Next.js rewrite 프록시** → CORS 제거, 단일 오리진, 백엔드 비노출
- **SQLite** → 단일 호스트 MVP에 서버 DB 운영 부담 없이 충분
- **CPU 전용 torch 휠** → CUDA가 필요 없는 호스트의 서빙 의존성 구성
- **Colab 학습 / 로컬 서빙 분리** → 학습 GPU와 현장 추론 환경을 별도로 관리
- **Mock 모드** → 체크포인트 없이도 전체 스택 개발·테스트 가능

## 7. 목표 단말과 추가 기술

목표는 Orange Pi 5 Plus/RK3588/ARM64/RAM 16GB다. 현재 의존성의 ARM64 휠·OS·NPU 드라이버 호환은 별도 검증한다. CNN ONNX 변환과 브라우저 ONNX Runtime Web/WASM 실행, IndexedDB 기록과 서버 동기화는 구현했다. CNN RKNN, Qwen3.5/RKLLM, 음성 명령/STT와 단말 에이전트는 미구현이다. 기기의 한국어 로컬 음성이 있으면 결과 읽기를 제공한다. [오프라인 가이드](OFFLINE_WEB.md)를 참조한다. SUDA는 지원·SDK를 확인할 대안이다.

학습 보고서의 Colab PyTorch 2.11.0+cu130/T4와 백엔드 선언 2.12.1+cpu는 서로 다른 환경이다. 버전 선언을 설치 성공이나 보드 실행 완료로 표시하지 않는다.
