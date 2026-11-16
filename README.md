# Cropy

**AI 기반 농작물 병해충 진단 및 스마트 방제 지원 플랫폼**

문서 기준일 2026-10-08 · 앱 선언 버전 1.0.0 · Author: 김헌영

## 팀원별 기여

<!-- contributions:start -->

| 이름 | 역할 | 커밋 | 비율 | 머지된 PR | 추가 줄 | 삭제 줄 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 김헌영 | PM · 모델 | 262 | 55.4% | 69 | +62,501 | -6,794 |
| 고명준 | 카메라 · 음성 | 119 | 25.2% | 12 | +24,141 | -2,965 |
| 김민서 | 프론트엔드 | 45 | 9.5% | 4 | +11,047 | -4,167 |
| 이서하 | 디바이스 · 인프라 | 25 | 5.3% | 24 | +5,222 | -127 |
| 박성호 | 백엔드 | 22 | 4.7% | 18 | +5,117 | -1,536 |

> 2026-11-17 기준 `develop` 브랜치 집계, 매일 자동 갱신. 커밋은 머지 커밋을 제외하고, 변경 줄은 데이터·산출물·잠금 파일을 제외합니다.
> 회의·노션 문서·하드웨어 작업처럼 저장소 밖에서 한 일은 반영되지 않습니다.

<!-- contributions:end -->

## 기능

- 📷 사진 업로드 → CNN 기반 병해충 진단
- 📊 신뢰도 및 Top-N 예측 제공
- 🔍 혼동되는 두 병해가 접전이면 판별부위(예: 잎 뒷면) 재촬영을 유도하고 결과를 재확정
- 📋 병 설명, 발병 원인, 예방 방법
- 💊 농약 정보와 검증 상태 조회 (미검증 사용 조건은 숨김)
- 📁 진단 이력 저장 및 조회

## 프로젝트 구조

```
cropy/
├── docs/          # PRD, Architecture, API, DB, Model 스펙
├── backend/       # FastAPI REST API
├── frontend/      # Next.js 웹 앱
├── ml/            # PyTorch 학습·추론
└── data/          # 데이터셋 (학습용)
```

## 빠른 시작

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

API 문서: http://localhost:8000/docs

전체 12개 API 목록과 Swagger 실행·입력·오류 안내: [백엔드 API / Swagger](docs/operations/API_SWAGGER.md)

### 2. Frontend

```bash
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
npm run storybook   # (별도 터미널) 공통 컴포넌트 모음 http://localhost:6006
```

웹 앱: http://localhost:3000

### 3. ML 모델 학습 (선택)

```bash
cd ml
pip install -r requirements.txt
python train.py --data-dir ../data/dataset --epochs 20 --arch resnet50
```

학습된 모델은 `ml/checkpoints/best_model.pth`에 저장됩니다.
개발 모드에서 `ALLOW_MOCK_PREDICTIONS=true`이면 모델이 없을 때 예시 진단을 반환합니다. 운영 모드는 실제 모델 없이는 진단을 503으로 차단합니다. [운영·복구 안내](docs/BACKEND_OPERATIONS.md)를 참고하세요.

- `--arch resnet18|resnet50`: 백본 선택 (체크포인트에 기록되어 백엔드/평가 스크립트가 자동 인식)
- `--resume <checkpoint>`: 기존 체크포인트에서 이어 학습 (현재 val 정확도보다 좋아질 때만 저장)
- `python evaluate.py`: test 분할로 전체/클래스별 정확도와 혼동행렬 출력
- GPU 학습(Colab): `python pack_for_colab.py`로 `colab_bundle.zip` 생성 → `train_colab.ipynb`를 Colab에서 실행

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/v1/diagnose` | 이미지 진단 |
| POST | `/api/v1/diagnose/{id}/refine` | 판별부위 2차 촬영으로 재확정 |
| GET | `/api/v1/history` | 진단 이력 |
| GET | `/api/v1/history/{id}` | 진단 상세 |
| GET | `/api/v1/diseases` | 병해충 목록 |
| GET | `/api/v1/diseases/{id}` | 병해 상세 |
| GET | `/api/v1/health` | 프로세스 생존 확인 |
| GET | `/api/v1/ready` | 실제 모델·DB 클래스 준비 확인 |

자세한 스펙은 [docs/API_SPEC.md](docs/API_SPEC.md) 참고.

## 문서

- [7주차 문서 최신화 현황·제출 준비](docs/DOCUMENT_STATUS.md) - 구현 기준, 관련 이슈, 남은 제출 작업

- [PRD](docs/PRD.md) - 제품 요구사항
- [Architecture](docs/ARCHITECTURE.md) - 시스템 구조
- [API Spec](docs/API_SPEC.md) - REST API
- [Database](docs/DATABASE.md) - DB 스키마
- [Model Spec](docs/MODEL_SPEC.md) - 현재 기본 모델·최신 후보·검증 한계
- [배포 가이드](docs/ORANGEPI5_DEPLOY.md) · [운영·복구](docs/BACKEND_OPERATIONS.md)
- [LLM 계획](docs/LLM_FINETUNING_PLAN.md) · [양자화 계획](docs/QUANTIZATION.md)

### 인큐박스 (잠복감염 검사기, 기획 단계 · 비공개)

- [기획안](docs/INCUBOX_PLAN.md) - 왜·무엇·로드맵 (시작점)
- [검정 절차서](docs/INCUBOX_PROTOCOL.md) - 채취·소독·배양·판독 SOP, [기록지](docs/templates/incubox_record_sheet.md)
- [하드웨어](docs/INCUBOX_HARDWARE.md) - 챔버·트레이·카메라·전기·BOM
- [펌웨어](docs/INCUBOX_FIRMWARE.md) - 장치 상태기계·촬영·온습도·업로드 큐
- [API](docs/INCUBOX_API_SPEC.md) · [DB](docs/INCUBOX_DATABASE.md) · [파이프라인](docs/INCUBOX_PIPELINE.md) - 백엔드 확장
- [UI](docs/INCUBOX_UI_SPEC.md) - 앱 화면
- [검증 계획](docs/INCUBOX_VALIDATION.md) - Phase 0~3 지표·통과 기준·일정
- [발명신고서](docs/INCUBOX_INVENTION.md) - 청구항 초안·선행기술·출원 체크리스트

## 기술 스택

- **Frontend:** Next.js 15, TypeScript, Tailwind CSS
- **Backend:** FastAPI, SQLAlchemy, SQLite
- **ML:** PyTorch, ResNet50 (AI Hub 노지 작물 질병 진단 데이터셋)

고추·무·배추 병해 6종 + 정상 3종의 9클래스를 분류합니다. 기본 경로 체크포인트는 기존 ResNet50/224이며 SHA256은 [MODEL_SPEC](docs/MODEL_SPEC.md)에 기록했습니다. 기존 원본 평가의 val 94.7% / test 93.1%는 분할 중복이 확인된 과거 결과입니다.

최신 별도 256 미세조정 후보의 val 4,070장 결과는 정확도 99.5823% / Macro F1 0.962436입니다. 무노균병 재현율이 저하되어 서비스 교체를 보류했고 독립 test 결과는 없습니다. [최신 보고서](report/AI_모델_개선_보고서_20261006.md)를 참고하세요.

목표 단말은 Orange Pi 5 Plus/RK3588/RAM 16GB입니다. Qwen/RKLLM·STT/TTS·CNN 양자화·보드 실측은 개발·검증 예정이며 현재 스마트폰은 웹 클라이언트입니다.

## 배포 (Docker)

```bash
docker compose up -d --build   # → http://localhost:3000
```

브라우저는 프론트엔드 오리진 하나만 호출합니다. `/api`와 `/uploads`는 Next.js
rewrite가 backend 컨테이너로 프록시하므로 백엔드 포트를 외부에 열 필요도,
CORS를 설정할 필요도 없습니다.

**체크포인트는 별도로 준비해야 합니다.** `ml/checkpoints/`가 `/models`로 마운트되며,
Compose는 운영 모드이며 `best_model.pth`가 없으면 준비 상태가 실패합니다. 확인:

```bash
curl http://localhost:3000/api/v1/ready   # HTTP 200이어야 실제 진단 준비 완료
```

진단 이력(SQLite)과 업로드 이미지는 `cropcare-data` 볼륨에 남아 컨테이너를
다시 만들어도 보존됩니다.

서버 한 대에 HTTPS로 올리는 절차(Caddy, `docker-compose.prod.yml`)는
[AWS Lightsail 배포 가이드](docs/AWS_LIGHTSAIL_DEPLOY.md)를 참고하세요.

### 다른 도메인에 배포할 때

`BACKEND_ORIGIN`은 **빌드 시점**에 주입됩니다. Next.js standalone 산출물은
rewrite 목적지를 빌드 때 굳혀 넣으므로 런타임 환경변수로는 바뀌지 않습니다.
값을 바꾸려면 다시 빌드하세요.

```bash
docker compose build --build-arg BACKEND_ORIGIN=https://api.example.com frontend
```

프론트와 백엔드를 서로 다른 도메인에 올려 브라우저가 백엔드를 직접 호출하게 하려면,
백엔드의 `CORS_ORIGINS`를 프론트 도메인으로 바꾸고 프론트는 HTTPS/HTTP가 섞이지
않도록 맞춰야 합니다.

## 테스트

```bash
cd backend
.venv\Scripts\python -m pytest tests
```

체크포인트는 Git에서 제외합니다. 모델 없는 시연은 개발 환경에서 명시적으로 허용해야 하며 운영 모드는 진단 503입니다. 테스트는 개별 fixture로 모델/시연/오류 상태를 검증합니다. 테스트 통과 여부는 해당 실행 결과로 확인하며 보드·실제 모델 정확도 검증과 구분합니다.

## 농약 데이터 동기화 (PSIS)

PSIS 동기화 코드는 작물·병해별 카탈로그를 갱신합니다. 현재 데이터가 최신 등록정보인지와 실제 동기화 성공 여부는 별도로 확인해야 합니다. 기존 미검증 시드의 사용 조건은 제공하지 않습니다.

```bash
cd backend
.venv\Scripts\python scripts/sync_pesticides.py  # PSIS_API_KEY 환경변수 설정 후 실행
```

API 키는 [PSIS OpenAPI 신청](https://psis.rda.go.kr/psis/share/api/apiReqstAddForm.ps?menuId=PS00383)에서 발급받습니다. 실행 후 백엔드를 재시작하면 DB에 반영됩니다.

## 다음 단계

1. 문서의 최신 구현·모델 기준으로 제출용 6종 구성 정리
2. 테스트 계획·결과 통합, 보드·실제 휴대폰·오프라인 실측 보충
3. Qwen 기능 데이터 검수·소량 시험과 단말 통합
4. 사용자 인증 및 농장별 이력 관리
