# Orange Pi 5 Plus (16GB) 배포 가이드

> 갱신: 2026-10-12. 대상: **Orange Pi 5 Plus / RK3588 / ARM64 / RAM 16GB**.
> 순서: CNN CPU 풀스택 → Qwen/RKLLM NPU → 오프라인 음성 → 전체 측정 → 선택 최적화.
> 현재 저장소는 PyTorch CNN·FastAPI·Next.js 구성이다. 브라우저 오프라인 추론·TTS는 구현되었고 LLM 서버·보드 음성·RKNN 런타임은 추가 작업이며 이 문서의 계획을 구현 완료로 해석하지 않는다.
> 담당·선행 조건·완료 기준: [역할별 이전 백로그](ORANGEPI5_MIGRATION_BACKLOG.md).

## 1. 장치와 제공 환경 확인 (OP-01/06)

- 일반 Orange Pi 5/RK3588S용 이미지와 혼용하지 않는다. 5 Plus용 OS와 보드 리비전을 확인한다.
- 제공 예정 `rkllm-toolkit`의 README, 지원 모델, toolkit/runtime 버전, NPU 드라이버·커널 요구 조건을 기록한다.
- 강의의 Ubuntu 22.04·드라이버 v0.9.8은 제공 환경 예시다. 수령 이미지와 패키지의 실제 조합으로 확정한다.
- 제공 이미지가 있으면 먼저 보존하고 부팅·NPU 예제를 검증한다. 검증 전 임의의 OS 교체·전체 업그레이드로 커널을 바꾸지 않는다.
- 전원·냉각·저장장치, USB 카메라·마이크·스피커를 확인한다. AP 구성은 Linux 드라이버와 AP 모드를 지원하는 무선 장치가 있어야 한다.

```bash
uname -m  # aarch64 확인
uname -r
cat /etc/os-release
free -h
lsblk
```

보드 이미지·커널·패키지·모델 버전과 재현 명령을 실험 기록에 남긴다. 초기 설치에는 인터넷 또는 사전 준비한 오프라인 설치 파일이 필요하다.

## 2. 코드·모델·데이터 전달 (OP-02)

현재 로컬 기본 파일의 SHA256은 `b0b0b4a24af1430778a2bc15ede5cc068e200539dfeb7fc5ced02574a63d4b8b`, ResNet50/9클래스/약 94.4MB이며 img_size가 없어 224로 폴백한다. 실행 설정이 다른 파일을 가리키면 그 해시·해상도를 별도로 기록한다. 10월 6일 256/384 후보는 서비스 교체 보류이며 기본 파일과 혼동하지 않는다. [MODEL_SPEC](../ml/MODEL_SPEC.md) 참조.

Git clone 또는 필요한 파일만 복사한다. PC의 `.venv`, `node_modules`, 빌드 캐시는 제외하고 ARM64에서 다시 설치한다.

| 대상 | 용도·검증 |
|---|---|
| `ml/checkpoints/best_model.pth` | 본 모델. 운영 모드에서 누락/로드 실패 시 진단 503; 해시·전처리·클래스 ID 확인 |
| `ml/checkpoints/pair_mu.pth` | 선택 보조 ResNet18 분류기. 없어도 기본 재촬영 판정·분포 융합은 유지되고 보조 재분배만 생략 |
| SQLite와 uploads | 기존 이력을 옮길 경우 함께 백업·복원. 모델 파일과 별도로 관리 |
| `.rkllm` 및 대응 runtime | OP-08 이후 추가. 파일 전송 전후 체크섬 비교 |

Compose는 `cropcare-data` 볼륨의 `/data/cropcare.db`와 `/data/uploads`를 사용한다. `backend/cropcare.db`를 복사하는 것만으로 Compose DB가 이전되지는 않는다. 서비스 정지 또는 일관성 있는 DB 백업 방식으로 DB와 이미지의 대응 관계를 보존한다.

## 3. ARM64 의존성 검증 (OP-03)

현재 `backend/Dockerfile`은 `python:3.13-slim`, 프론트는 `node:22-alpine`을 사용한다. `backend/requirements.txt`는 torch/torchvision의 `+cpu` 버전을 지정한다. **이 조합의 실제 ARM64 휠 설치 성공을 먼저 검증**한다. 접미사만 제거하면 된다고 가정하지 않는다.

1. 선택 Python·OS·ARM64에 맞는 torch/torchvision 호환 조합과 휠을 확인한다.
2. 깨끗한 환경에서 설치, `import torch, torchvision`, 모델 로드 및 단건 추론을 수행한다.
3. 성공한 버전·인덱스·설치 명령을 고정한다. 기존 x86 환경을 깨뜨리지 않도록 ARM64 의존성 파일 또는 빌드 설정을 별도로 관리한다.
4. 별도 requirements 파일을 사용할 때 Dockerfile의 COPY와 pip 설치 대상도 함께 수정한다. 해당 파일·설정은 아직 구현된 것으로 간주하지 않는다.
5. `npm ci`와 프로덕션 빌드를 실행한다. 빌드 시간·메모리는 환경별로 측정하며 고정 예상값을 합격 조건으로 쓰지 않는다.

## 4. CNN CPU 풀스택 실행 (OP-04)

### Docker Compose

Docker가 설치되어 있고 3절의 ARM64 빌드 설정을 검증한 뒤 실행한다.

```bash
cd ~/cropy
docker compose up -d --build
docker compose ps
curl http://localhost:3000/api/v1/health
docker compose logs --tail=100 backend
```

`/api/v1/ready`의 HTTP 200을 확인한다. Compose healthcheck도 이 경로를 사용하며 mock은 준비 상태가 아니다. 네이티브 실행도 `APP_ENV=production`, `ALLOW_MOCK_PREDICTIONS=false`를 설정한다. FE→BE 프록시는 `BACKEND_ORIGIN=http://backend:8000`을 빌드 인자로 사용하며 목적지를 바꾸면 프론트를 다시 빌드한다.

### 네이티브 실행

검증한 Python으로 `backend/.venv`를 만들고 3절에서 확정한 의존성을 설치한다. 백엔드 실행 예:

```bash
cd ~/cropy/backend
source .venv/bin/activate
APP_ENV=production ALLOW_MOCK_PREDICTIONS=false ML_MODEL_PATH=../ml/checkpoints/best_model.pth uvicorn app.main:app --host 0.0.0.0 --port 8000
```

프론트는 별도 터미널에서 실행한다.

```bash
cd ~/cropy/frontend
npm ci
npm run build
npm run start
```

네이티브 프록시는 기본 `127.0.0.1:8000`, Compose는 내부 서비스명 `backend:8000`을 사용한다. CNN은 단일 워커로 시작한다. 워커 수를 늘리면 모델도 프로세스별로 로드될 수 있다.

### 최초 통과 조건

- 실제 이미지로 병해·정상 결과, 농약 정보 없음, 이력 상세를 확인한다.
- 재촬영 요청과 2차 사진에 대한 결과 갱신을 확인한다.
- PC와 같은 체크포인트·입력으로 후보·점수를 비교한다.
- 최초 모델 로드와 예열 이후 처리 시간을 구분한다.

## 5. 스마트폰 접속·카메라·AP (OP-11)

파일 업로드 확인은 `http://<보드IP>:3000`으로 시작할 수 있지만, 스마트폰의 라이브 카메라·마이크 `getUserMedia()`는 보안 컨텍스트가 필요하다. 보드의 LAN IP는 스마트폰에서 localhost 예외가 아니다. [MDN 근거](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

- INF는 로컬 DNS/호스트명과 대상 스마트폰이 신뢰하는 HTTPS 인증서 구성을 마련한다. 로컬 CA 사용 시 신뢰 설치까지 포함한다.
- 인증서 경고 무시만으로 완료 처리하지 않는다. CAM이 실제 대상 브라우저에서 권한 허용·촬영·거부 후 복구를 확인한다.
- 인터넷 없는 AP 시연은 인증서 신뢰·이름 해석도 오프라인에서 동작해야 한다. 인터넷 터널 연결로 대체 검증하지 않는다.
- 보드 자체 브라우저의 localhost 또는 네이티브 카메라 경로를 선택하면 그 실행 구조를 기록한다.

NetworkManager와 AP 지원 어댑터를 쓰는 경우의 예시이며 인터페이스 이름·IP는 실제 환경에서 확인한다.

```bash
nmcli device status
# wlan0은 실제 무선 인터페이스 이름으로 바꾼다.
sudo nmcli device wifi hotspot ifname wlan0 ssid cropy password '<실제비밀번호>'
nmcli connection show
```

자동 연결은 생성된 실제 연결 이름에 설정한다. AP 재부팅 복구와 인터넷 없는 스마트폰 접속까지 검증한다.

## 6. Qwen/RKLLM 및 음성 연결 (OP-06~14)

1. 제공 패키지의 기본 예제로 변환→보드 응답을 먼저 검증한다.
2. 선정 Qwen 기본 모델을 프로젝트 캘리브레이션 데이터로 W8A8 변환한다. 정확한 명령은 패키지 문서에 맞춰 기록한다.
3. 동일 질문으로 서버 원본과 보드 응답을 비교한다. 모델 파일만 생성되었다고 완료 처리하지 않는다.
4. runtime·서버를 구성하고 모델 준비 상태, 타임아웃·복구를 확인한다. 서버·음성 예제의 패키지 포함 여부는 수령 후 확인한다.
5. BE가 진단 JSON과 사용자 질문을 연결한다. LLM 실패 시 기존 진단 결과와 템플릿 안내를 유지한다.
6. CAM은 제공 VAD/STT/TTS 예제를 우선 검증하고, 자기 음성 재인식 방지와 한국어 낭독을 확인한다.
7. 검증된 응답을 화면·TTS에 동일하게 전달한다. 숫자 포함 문장은 검증 전에 낭독하지 않는다.

[LLM 파인튜닝 계획](../ml/LLM_FINETUNING_PLAN.md)은 기본 모델의 반복 실패가 확인된 경우 적용한다. CNN의 RKNN과 LLM의 RKLLM은 별도 도구·산출물이다.

## 7. 측정과 선택 최적화 (OP-05/16~20)

현재 보드 실측 결과는 없다. 이전 문서의 CPU 0.3~1초·백엔드 1.5~2GB는 배포 성능을 보장하는 수치로 사용하지 않는다.

- 첫 로드, 예열 후 최초 진단, 원본·새 사진을 다시 처리하는 재촬영의 시간을 각각 측정한다.
- 단건 CNN 전처리 포함 1초 이내를 초기 목표로 두되 이는 예상치가 아니다. 재촬영·전체 음성 응답 목표는 기준선 뒤 확정한다.
- 전체 모델을 로드한 상태에서 30회 진단 및 30분 반복 운용의 중앙값/p95, 피크 RAM, 오류, 온도·전력 상태를 기록한다.
- LLM이 NPU를 사용해도 시스템 RAM을 공유한다. STT/TTS 및 LLM의 CPU 작업과 경합도 측정한다.
- CPU 스레드 수는 비교 실험한다. `OMP_NUM_THREADS`나 코드의 `torch.set_num_threads()` 설정은 코어 고정을 의미하지 않는다. 현재 앱이 읽지 않는 임의 환경변수로 설정 완료를 주장하지 않는다.
- 목표를 만족하면 CNN CPU를 유지한다. 미달일 때 CPU 튜닝·ONNX·RKNN INT8을 비교한다. ONNX INT8을 RKNN의 필수 중간 단계로 삼지 않는다.
- 변환 시 전체·클래스별 정확도, 전체 출력 분포, 재촬영, 선택 보조 모델을 검증한다. CNN도 NPU로 옮기면 Qwen과 순차 실행 및 자원 경합을 확인한다.

## 8. 오프라인·자동 시작·복구 (OP-15)

현재 진단의 주요 경로는 로컬 모델·SQLite·파일을 사용하지만, **전체 앱의 완전 오프라인 검증은 별도 작업**이다. 프론트 CSS의 외부 폰트 import를 로컬화하거나 대체하고 브라우저 캐시 없는 상태로 검증한다. 브라우저 음성이 항상 오프라인이라고 가정하지 않는다.

- Compose는 restart 정책과 Docker 부팅 시작을 확인한다. 네이티브 방식은 실제 계정·경로를 반영한 systemd 단위를 INF가 작성한다.
- 기동 순서만으로 모델 준비를 보장하지 않는다. 의존 API의 준비 확인과 재시도를 검증한다.
- 모델·음성 파일을 미리 배치한 뒤 인터넷을 차단하고 최초 진단→재촬영→후속 질문→낭독을 확인한다.
- 재부팅·프로세스 종료 후 자동 복구, DB와 업로드 보존, 백업의 실제 복원을 검증한다.
- 오프라인 시각 유지 수단과 시간대를 확인한다. 인증서 유효성 및 이력 시각도 함께 점검한다.

## 9. 최종 체크리스트

- [ ] 5 Plus용 OS·커널·NPU 드라이버·toolkit/runtime 버전 기록
- [ ] ARM64 의존성 설치·import·모델 로드·프론트 빌드 재현
- [ ] 모델 해시·전처리·클래스 계약 확인, model_loaded=true
- [ ] 실제 이미지 진단·재촬영·이력 조회
- [ ] Qwen 기본 모델 변환·원본 대비 평가·서버 복구
- [ ] 스마트폰 HTTPS/AP 및 카메라·마이크 권한 확인
- [ ] 인터넷 차단·캐시 없는 UI·음성 통합 검증
- [ ] 재부팅·DB/업로드 보존·백업 복원
- [ ] 전체 RAM·지연·온도·전원 실측 및 선택 최적화 판단
- [ ] OP Issue에 환경·검증 결과·미해결 제약 기록

## 10. 설정값과 모델 업데이트

| 설정 | 기본값/배포값 | 역할 |
|---|---|---|
| APP_ENV | 로컬 development / Compose production | 시연과 운영 구분 |
| ALLOW_MOCK_PREDICTIONS | 로컬 true / Compose false | 개발 환경만 모델 없는 시연 허용 |
| ML_MODEL_PATH | ../ml/checkpoints/best_model.pth / Compose /models/best_model.pth | 실제 서빙 모델 |
| ENABLE_PAIR_MODEL | false | 명시적 보조 모델 활성화 |
| MAX_CONCURRENT_DIAGNOSES | 1 | 프로세스별 동시 진단 제한 |
| MAX_UPLOAD_MB / MAX_IMAGE_PIXELS | 10 / 40,000,000 | 파일 MiB·픽셀 상한 |
| DATABASE_URL / UPLOAD_DIR | 네이티브 cropcare.db/uploads / Compose /data 아래 | 데이터 영속 경로 |
| CORS_ORIGINS | http://localhost:3000 | 브라우저가 API를 직접 호출할 때 허용 출처 |
| BACKEND_ORIGIN | 네이티브 기본 127.0.0.1:8000 / Compose http://backend:8000 | 프론트 빌드 인자 |
| PSIS_API_KEY | 기본값 없음 | 농약 동기화 스크립트 전용, 비밀값을 문서·로그에 기록하지 않음 |

운영에선 APP_ENV=production을 명시하고 /ready의 200을 확인한다. 개발 mock은 ready 성공이 아니다. 프론트 프록시·API 선언·모델·OS·의존성 버전을 묶어 배포 기록에 남긴다.

모델 교체는 검증된 후보 선정 → 기존 모델·설정·DB/이미지 백업 → 서비스 정지/일관성 있는 보존 → 새 파일·해시 확인 → 재시작 → ready·단건 진단·재촬영·이력 확인 순서다. 로드 모델은 프로세스 캐시에 있어 파일 덮어쓰기만으로 바뀌지 않는다. 새 모델과 옛 이력 재촬영의 409는 버전 보호 동작이다.

실패하면 보존한 모델·호환 코드·설정으로 되돌려 재시작한다. DB 변경이 있으면 [운영 복구](BACKEND_OPERATIONS.md)의 백업 절차를 따른다. 자동 OTA·모델 다운로드·롤백은 구현되어 있지 않다.

## 11. 미검증 항목의 기록

이 문서의 ARM64 설치·Qwen/RKLLM·보드 음성·보드 오프라인·보드 자원 결과는 아직 실행 증거가 없다. 브라우저 오프라인 구현과 검증 범위는 [별도 가이드](OFFLINE_WEB.md)를 참조한다. 실제 OS·커널·드라이버·toolkit/runtime·모델 revision과 명령·결과를 확인 후 채운다. 과거 PC 회귀·가상 카메라 결과를 실기기 결과로 대체하지 않는다.
