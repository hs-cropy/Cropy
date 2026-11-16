# 기능 선택 모델 자산 (#164)

발화와 화면 상태를 받아 `<hs_N>(인자=값)<hs_end>` 한 줄을 내는 기능 선택 모델의 배포 파일을 정리한다. 어느 기기 모델이든 출력 계약이 같아서 그 뒤(`/api/v1/voice/function-call`, 핸들러, 낭독)는 공용이다.

```
[녹음] → [STT] → [기능 선택기] → "<hs_N>(topic=k)<hs_end>" → [백엔드 핸들러] → 답변 문장 → [낭독]
                      ↑ 여기만 기기별
```

모델 파일은 크기 때문에 저장소에 넣지 않는다. 원본은 김헌영 Google Drive `cropy_qwen_v2/`에 있고 팀원에게는 비공개로 공유한다. 파일 목록·크기·SHA-256은 `model_assets.json`이 기준이다.

## 자산 목록

| 종류 (`kind`) | 쓰는 곳 | Drive 위치 | 형식·크기 | 정확도 (인자까지) | 계약 파일 |
|---|---|---|---|---|---|
| `server` | 서버 경유 (`select_server.py`) | `soup_v2abc_v2d_6run/merged_hf` | safetensors 4.4GB | validation 97.07%, 실제 발화 78.5% | `cropy_prompt.json` |
| `mobile_clf` | 휴대폰 기기 안 (#167)·운영 서버 (#192) | `clf_koelectra-small-v3_mean_lr0.00015_e8_swap_ctx_merge_enrich_distill_ctx_clf_v2_s20261110` (11차) | ONNX int8 13.9MB | validation 92.8% (기능 97.0%), 앱 시험셋 기능 83.9% | `labels.json` (`context_format: clf_v2`) |
| `web_qwen` | WebGPU PC 기기 안 (#168) | `web_onnx/2b_soup6/bundle` | ONNX q4f16 1.34GB | 같은 300행 95.67%, 실제 발화 77.1% | `files.json` |
| `board_rkllm` | 오렌지파이5 Plus NPU (#169) | `rkllm_soup6/cropy_qwen_w8a8_rk3588.rkllm` | RKLLM W8A8 2.74GB | 같은 300행 97.0% (PC 시뮬레이션) | `cropy_prompt.json` |

- 정확도는 모두 6 run 평균 모델 기준(분류기 제외)이다. 근거는 `README.md`의 "실제 발화 보강과 6 run 평균"과 분류기 절.
- `server`·`mobile_clf`는 SHA-256까지 기록했다. `web_qwen`·`board_rkllm`은 Drive에만 있어 크기만 적었다. 받은 사람이 `--write`로 채운다(아래).
- 보드용은 보드 실측 전이다(보드는 11/12 수령, 측정 계획은 #169).

## 받아서 두는 곳

| 종류 | 둘 곳 | 이어지는 설정 |
|---|---|---|
| `server` | 아무 폴더 (예: `eval/models/merged_hf`) | `QWEN_DIR=<폴더> python -m uvicorn select_server:app --port 8300` (`ml/qwen/`), 백엔드 `FUNCTION_SELECTOR_ENGINE=http` |
| `mobile_clf`, `web_qwen` | 아무 폴더 (`web_qwen`은 먼저 256MB 이하로 나누고 프롬프트 상태를 만든다: `docs/OFFLINE_WEB.md`) | `backend/scripts/export_browser_model.py --function-bundle mobile_clf=<폴더> --function-bundle web_qwen=<폴더>` → `frontend/public/offline-assets/function/<kind>/<version>/`에 복사되고 `function-models.json`이 갱신된다 (`docs/OFFLINE_WEB.md`, #166) |
| `board_rkllm` | 보드의 모델 폴더 | `docs/reports/week11/오렌지파이_Qwen_보드_배포_가이드.md`, #169 |

## 검사

배포 전에 받은 폴더를 검사한다. 파일·크기·SHA-256과 계약 파일의 함수 순서를 본다. 함수 번호가 어긋나면 `<hs_4>`가 다른 기능으로 가서 엉뚱한 답이 나오기 때문이다.

```bash
python ml/qwen/check_assets.py server  <merged_hf 폴더>
python ml/qwen/check_assets.py mobile_clf <분류기 폴더>
python ml/qwen/check_assets.py web_qwen <bundle 폴더> --write     # sha256이 비어 있으면 기록
python ml/qwen/check_assets.py board_rkllm <rkllm 파일이 있는 폴더> --write
```

| 계약 파일 | 확인하는 것 |
|---|---|
| `cropy_prompt.json` | 함수 이름 순서, 함수별 (인자, 값 개수), 새 토큰 `<hs_0>`~`<hs_8>`·`<hs_end>`, 종료 토큰이 `spec_v2.FUNCTIONS`와 같은지 |
| `labels.json` | 함수 순서, 인자별 값 이름과 순서가 `spec_v2`와 같은지, 빠진 헤드가 없는지 |

2026-11-15 이 PC의 `server`(`eval/models/merged_hf`)와 `mobile_clf`(`eval/clf8`)는 검사를 통과했다. 2026-11-16 11차 `mobile_clf`도 통과했다. 11차는 입력 형식이 `clf_v2`라 서버 #192와 휴대폰 선택기가 그 변환을 가진 버전이어야 한다(v8 묶음은 형식이 없어 그대로 동작).
