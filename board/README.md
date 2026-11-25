# 오렌지파이 5 Plus 단독 실행

노트북 없이 보드 하나로 **호출어 → 촬영·진단 → 음성 질문 → 스피커 답변**을 돌리는 구성이다.
2026-11-24 보드(Orange Pi 1.2.2 Jammy, 커널 6.1.99-rockchip, RAM 16GB)에서 원격으로 설치·확인했다.

```
마이크 ─ cropy-agent ─┬─ "크로피" 호출어 · "사진 찍어줘" 규칙 (에이전트 안)
  (arecord)           ├─ 백엔드 :8000 ── CNN ResNet50 10클래스 (CPU)
                      │     ├─ /voice/transcribe ──── STT :8200 SenseVoice (CPU)
                      │     ├─ /voice/select-function ─ RKLLM :8300 Qwen W8A8 (NPU)
                      │     └─ /voice/function-call ── 답변 문장
                      └─ TTS :8100 MeloTTS (CPU) ─ aplay ─ 스피커
```

## 보드의 파일 위치

| 구성 | 위치 | 서비스 | 파이썬 |
|---|---|---|---|
| 기능 선택(RKLLM) | `~/cropy_qwen/` (모델 `.rkllm` 2.9GB, `librkllmrt.so`) | `cropy-selector` | 시스템 3.10 |
| STT | `~/cropy-board-demo/stt/` | `cropy-stt` | 3.10 venv |
| 백엔드 + CNN | `~/cropy/backend/`, 모델 `~/cropy/models/` | `cropy-backend` | 3.12 venv (uv) |
| TTS | `~/cropy/tts/` | `cropy-tts` | 3.11 venv (uv) |
| 에이전트 | `~/cropy/board/agent/cropy_agent.py` | `cropy-agent` | STT venv 재사용 |
| 설정·데이터·로그 | `~/cropy/board.env`, `~/cropy/data/`, `~/cropy/logs/*.log` | | |

백엔드·TTS 코드는 `origin/develop` a4da3c6을 `git archive`로 옮겼다(`~/cropy/DEPLOYED_COMMIT`).

## 다시 설치할 때

```bash
# PC: 코드·모델 복사
git archive --format=tar origin/develop backend tts board | ssh orangepi 'mkdir -p ~/cropy && tar -x -C ~/cropy'
scp ml/checkpoints/full512_resnet50_other10_v1.pth orangepi:cropy/models/

# 보드: uv로 파이썬 받기 (보드 기본은 3.10, python3-venv 없음)
python3 ~/cropy_qwen/pip-25.3.pyz install --user uv
export PATH=$HOME/.local/bin:$PATH && uv python install 3.12 3.11

# 백엔드 — torch는 반드시 CPU 인덱스에서. PyPI aarch64 휠은 CUDA 빌드라 venv가 4.7GB(CPU판 843MB)
cd ~/cropy/backend && uv venv -p 3.12 .venv
VIRTUAL_ENV=.venv uv pip install torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cpu
grep -vE '^(--extra-index-url|torch|torchvision)' requirements.txt > /tmp/req.txt && VIRTUAL_ENV=.venv uv pip install -r /tmp/req.txt

# TTS (첫 기동 때 Hugging Face에서 한국어 모델을 받는다. 이후 서비스는 HF_HUB_OFFLINE=1)
cd ~/cropy && uv venv -p 3.11 tts/.venv
uv pip install --python tts/.venv/bin/python --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match -r tts/requirements.txt

# STT venv (sherpa-onnx 2.0.1 등)
cd ~/cropy-board-demo/stt && python3 -m venv --without-pip .venv && .venv/bin/python ~/cropy_qwen/pip-25.3.pyz install pip && .venv/bin/pip install -r requirements.txt

# 서비스 — 로그인 없이 부팅 때 뜨도록 linger (sudo 불필요했다)
cp ~/cropy/board/board.env.example ~/cropy/board.env
mkdir -p ~/.config/systemd/user ~/cropy/logs && cp ~/cropy/board/systemd/*.service ~/.config/systemd/user/
loginctl enable-linger && systemctl --user daemon-reload
systemctl --user enable --now cropy-selector cropy-stt cropy-tts cropy-backend cropy-agent
```

## 운용

```bash
systemctl --user status 'cropy-*'           # 상태
systemctl --user stop cropy-agent           # 마이크를 다른 데 쓸 때 에이전트만 끄기
tail -f ~/cropy/logs/agent.log              # 들은 말·고른 기능·응답 시간
for u in 8300/health 8200/health 8100/health 8000/api/v1/ready; do curl -s localhost:$u; echo; done
```

에이전트 설정은 `~/cropy/agent.env`(없어도 됨)에 환경변수로 둔다. 주요 값: `CROPY_MIC`·`CROPY_SPEAKER`
(기본 `plughw:3,0` = 보드 내장 ES8388), `CROPY_CAMERA`(비우면 자동 선택), `CROPY_CAPTURE_CMD`, `CROPY_WAKE_WORDS`.

카메라만 점검 (에이전트가 카메라를 잡고 있지 않게 먼저 멈춘다):

```bash
systemctl --user stop cropy-agent
v4l2-ctl --list-devices; ls -l /dev/v4l/by-id/
cd ~/cropy && CROPY_CAMERA_TEST=1 ~/cropy-board-demo/stt/.venv/bin/python board/agent/cropy_agent.py
# 성공하면 찍힌 jpg 경로가 나온다. 장치별 형식(MJPG/YUYV)과 시도마다의 실패 이유가 로그에 찍힌다
systemctl --user start cropy-agent
```

`CROPY_CAMERA`를 비우면 `/dev/v4l/by-id/*-video-index0` → `/dev/video*` 중 MJPG를 내는 장치를 고른다.
RK3588은 보드 자체 영상 장치가 앞 번호를 차지할 수 있고, 웹캠 하나가 영상·메타데이터 두 노드를 만들어
`/dev/video0` 고정은 틀리기 쉽다. 특정 장치를 쓰려면 `~/cropy/agent.env`에 `CROPY_CAMERA=/dev/v4l/by-id/...`.

마이크 없이 흐름만 확인:

```bash
cd ~/cropy && CROPY_AGENT_SELFTEST="여보세요 크로피 사진 찍어줘|이 질병 뭐야?|어떻게 관리해?" \
  CROPY_SELFTEST_PHOTO=/path/to/pepper.jpg ~/cropy-board-demo/stt/.venv/bin/python board/agent/cropy_agent.py
```

## 2026-11-24 측정 (셀프테스트, 고추 탄저병 사진)

| 단계 | 시간 |
|---|---|
| 진단 (CNN CPU, 92.6% 고추 탄저병) | 약 2초 |
| 기능 선택 (RKLLM NPU) | 10.3~12.6초, 대부분 prefill 9.5초 |
| TTS | 실시간의 약 1.5배 (3초 음성에 4.7초). 문장 단위로 합성하며 재생해 첫 소리 4~9초 |
| 질문 끝 → 답변 첫 소리 | 약 20초 |

## 남은 일

- **카메라 미연결**: `/dev/video*` 없음. 연결 후 `CROPY_CAPTURE_CMD`가 그 카메라에서 동작하는지 확인.
- **마이크 입력 무음**: 내장 코덱으로 녹음은 되지만 RMS≈1(무음). 마이크 연결·입력 경로(amixer) 확인 필요.
- **스피커**: `aplay -D plughw:3,0` 실제 소리 확인 필요(현장).
- **RKLLM 시스템 프롬프트 캐시**: 요청마다 `KV cache reuse failed ... Cache cleared`. 범위 지정
  `rkllm_clear_kv_cache`는 동작하지 않았다(생성을 콜백에서 멈춘 상태에서만 유효). 프롬프트 캐시 파일 방식 시험 필요.
- 재부팅 후 자동 기동은 설정만 했고 실제 재부팅 시험은 안 했다.
