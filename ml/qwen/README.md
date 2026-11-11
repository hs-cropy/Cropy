# Qwen 기능 선택 데이터 v2 (`hs-call-v2`)

v11 데이터를 마음AI HomeIoT 예시(`[AI Expo] 2025 AI Expo HomeIoT 데이터 시트.xlsx`) 형식에 맞춰 다시 구성한 학습 데이터다. **기능 이름과 인자 의미는 v11/v12 계약을 그대로 유지**하고, 출력 형식과 데이터 구성만 바꿨다. validation은 사람 검수를 마쳤고(아래 "검수 반영"), train은 아직 사람 승인 전(`labels_human_validated: false`)이다.

## 왜 바꿨나

| 문제 (v11) | 근거 | v2 |
|---|---|---|
| 인자 값마다 새 특수 토큰 (49개, 최신 계획 58개) | 10/15 파일럿(pilot50) 평가 24건 중 기능 정답 10건, 그 10건이 모두 새로 추가한 한 기능. 나머지 7개 기능은 0건 | 기능 토큰 9개 + 종료 1개. 인자는 일반 텍스트 숫자 |
| 시스템 프롬프트에 계약 JSON 통째로 | 예시는 함수별 docstring에 정수 의미를 설명 | 함수마다 `def` + docstring, 규칙 9줄 |
| 범위 밖 발화 14% (`handle_scope_limit`)뿐, 일반 잡담 없음 | 예시는 ChitChat이 42% | `chit_chat()` 추가 |
| 존칭 어미 75%, 사투리 약 1.5% | 주 사용자는 고령 농업인 | 반말·사투리 변형 추가, 존칭 40% |
| 사용 안내(`get_usage_guidance`) 39행 | v12 초안이 작음 | 화면 상태별 시드 추가 |

## 출력 형식

```
<hs_번호>(인자=값, ...)<hs_end>
<hs_4>(topic=2, product=1)<hs_end>   # get_pesticide_information(dilution, current)
<hs_8>()<hs_end>                     # chit_chat()
```

| 번호 | 함수 | 인자 |
|---|---|---|
| 0 | get_diagnosis | topic 1~7 |
| 1 | get_prediction_metrics | topic 1~5 |
| 2 | get_recapture_guidance | topic 1~4 |
| 3 | get_care_information | topic 1~3 |
| 4 | get_pesticide_information | topic 1~11, product 1~2 |
| 5 | clarify_request | target 1~8 |
| 6 | handle_scope_limit | reason 1~3 |
| 7 | get_usage_guidance | topic 1~6, delivery 1~2 |
| 8 | chit_chat | (없음) |

정수는 v11 계약의 값 순서(1부터)라 v11 ↔ v2 변환은 손실이 없다(`spec_v2.from_v11`). 값의 뜻은 `spec_v2.py`의 `FUNCTIONS`와 생성된 `system_prompt.txt`에 있다.

`handle_scope_limit`와 `chit_chat`의 경계: 진단 기능과 관련 있지만 지원하지 않는 요청(다른 작물, 물 주기 같은 실행 요청, 작물이 아닌 사진)은 `handle_scope_limit`. 진단·농약·앱 사용과 무관한 대화(인사, 날씨, 일상, 다른 분야 질문, 농사 일상 잡담)는 `chit_chat`.

## 만들기

```bash
# openpyxl 필요 (v11 엑셀 읽기용)
python ml/qwen/build_dataset_v2.py
```

결과: `ml/qwen/data_v2/`

| 파일 | 내용 |
|---|---|
| `train.jsonl`, `validation.jsonl` | 행마다 `user_text`, `context`(압축), `function`, `arguments`, `output`(v2 문자열), 출처·변형 종류·원본 행 ID |
| `summary.json` | 분포와 제외 건수 |
| `system_prompt.txt` | 학습·추론에 쓰는 시스템 프롬프트 |
| `review_sample.csv` | 생성된 변형 300건 검수표 |

모델 입력은 `spec_v2.build_messages(user_text, context)`로 만든다. context는 기능 선택에 필요한 필드만 남기고 긴 설명문은 뺀다(`compact_context`).

## 데이터 구성 (현재)

| | train | validation |
|---|---|---|
| 전체 | 4,736 | 1,145 |
| 기존 7개 기능 | 각 503~620 | 각 117~148 |
| chit_chat | 517 | 121 |
| get_usage_guidance | 265 | 68 |

| 출처 | 내용 |
|---|---|
| v11 | 엑셀의 활성 singleton 행(사람 승인 0, AI 검수). 기존 split 유지. STT 띄어쓰기 오류 행 포함 |
| v12_usage | WIP 브랜치의 사용 흐름 초안 중 단일 턴 행(`inputs/usage_v12.jsonl`). 대화 기록이 필요한 26행은 제외 |
| seed | `usage_seed.tsv`(화면 상태별 사용 안내), `chitchat_seed.tsv`(잡담). 시드 단위로 80/20 분할 |

| 변형 | 규칙 |
|---|---|
| banmal | 존칭 어미를 반말로(문장 중간 절 포함). 규칙에 정확히 맞지 않으면 만들지 않음 |
| dialect_jeolla / gyeongsang | 반말 끝을 거여·제·혀 / 의문사 질문의 고·하노·되노로. 의문사가 없으면 경상 변형 없음 |
| dialect_chungcheong | 요 → 유. 규칙이 넓어서 해당 행의 12%만 생성 |
| spacing | 시드만 공백 하나 삭제·추가(v11에는 이미 STT 행 있음) |

변형은 원본과 같은 split·그룹에 둔다. 공백만 다른 문장이 train과 validation에 나뉘지 않게 검사한다.

## 사람이 할 일

1. **변형 검수**: `review_sample.csv`의 300건에 ok/수정/삭제 표시. 어색한 규칙이 보이면 `style.py`를 고친 뒤 다시 만든다.
2. **validation 검수**: 학습 전에 최소한 validation 행의 정답을 사람이 확인한다(현재 전부 AI 검수).
3. **사람 작성 평가셋**: `eval_human_template.csv`에 팀원이 직접 쓴다. 학습 데이터를 보지 않고 쓴다.
   - 목표: 9개 함수 × 25 = 225행
   - 간접 발화 40% 이상(예: "이 약 물에 얼마나 타서 뿌려"가 아니라 "한 말 통에 얼마나 넣어"), 반말 40% 이상, 사투리 15% 이상
   - 문장부호 없이, 숫자는 읽는 형태로(영 점 팔 칠)
   - 화면 상태는 `eval_context_presets.json`의 ID로 고른다
4. 평가셋은 학습에 넣지 않는다. 학습 후 이 평가셋으로 기능·인자 정확도를 따로 잰다.

## 아직 하지 않은 것

- 대화 기록이 필요한 멀티턴(반복·다음 단계 흐름)은 1차 범위에서 제외
- 토픽 세분화 정리(예: 농약 summary·checklist 통합)는 handler 변경이 필요해서 보류
- 이 형식으로 학습하는 Colab 노트북은 다음 단계

## 검수 (2026-10-26 1차 사전 점검)

자동 점검: 같은 문장에 다른 정답 0건, 템플릿을 뗀 질문 기준 train↔validation 겹침 0건.
자동 수정: 생성기 반복 단어(`작업을 작업을`) 20행, v12 문장부호 88행 제거, v11 화면 상태를 `result`로(621행이 `no_photo`로 들어가던 문제).
설명 수정: `confidence`를 "점수 수치와 그 숫자가 무슨 점수인지"로(v11 라벨이 일관되게 이렇게 붙어 있음), "다시 말해 줘" 구분 규칙 추가.
시드 수정: 실행 요청인 "택시 불러 줘·문자 보내 줘·라디오 틀어 줘"를 잡담에서 제외(v11 action 라벨과 충돌).

사람 검수표: `python ml/qwen/build_review_sheet.py` → `data_v2/검수표_v2.xlsx`
(정책 결정 8건, validation 대표 303행 중 확인필요 20행, 변형 300행)

## 검수 반영 (2026-10-27, 김헌영)

```bash
python ml/qwen/apply_review.py   # 검수표_v2.xlsx → train/validation.jsonl, summary.json (다시 돌려도 같음)
```

- 정책 결정: D4만 B(제품이 하나뿐인 화면의 "보이는 상품"은 `product=current`), 나머지는 A(현재 정답 유지). D8은 해당 행이 없어 A.
- validation 303그룹: 302 ok, 1 삭제("재품 에이랑 비중 어떤게 더 효과쩌긴가요", 오타가 심함). 변형 포함 2행 삭제, 2행 라벨 변경.
- "주식 지금 사도 돼"는 `chit_chat` 유지. 주식 같은 결정을 대신 판단하지 않는 것은 잡담 답변 규칙에서 막는다.
- 변형 300행: 모두 ok.
- 결과: validation 1,160행 전부 `labels_human_validated: true`. train 4,830행은 AI 검수 상태 그대로.

## 1차 학습 결과와 보정 (2026-11-02)

1차 학습(`v2_r16_e2`, A100 70분, validation 1,160행): 형식 100%, 기능 97.2%, 인자까지 정답 93.8%. train 300행 표본 99.7%.

틀린 72건을 문장 단위로 보고 고친 것:

```bash
python ml/qwen/apply_eval_fixes.py      # validation 라벨 5그룹 수정 + train 보강 (다시 돌려도 같음)
python ml/qwen/build_train_notebook.py  # data_v2/qwen_v2b_data.jsonl.xz + 노트북(RUN_NAME v2b_r16_e2)
```

- 라벨 수정(validation 22행): "재촬영 요청의 **근거**가 기록돼 있나요"는 `get_recapture_guidance(topic=provenance)`(기존 why). "가장 높게 나온 병명 후보"는 `get_prediction_metrics(topic=ranking)`(기존 get_diagnosis, v2c에서 원복).
- train 보강(`train_patch_seed.tsv` 60문장 → 변형 포함 284행, train에만): 앱에게 이름·하는 일을 묻는 잡담, 선택 작물과 안내 작물이 다른 상황(`clarify_request(target=crop)`), 임시 응답/모델 분류 구분(`get_diagnosis(topic=provenance)`), 점수 의미(confidence/limits/ranking), 재촬영하면 확정되는지, 다시 시도 순서(step_by_step). validation과 띄어쓰기만 다른 문장은 넣지 않는다.
- validation 행은 그대로라 1차 결과와 비교할 수 있다. 라벨을 고친 22행 기준으로 1차 결과를 다시 매기면 기능 97.8%, 인자까지 95.7%.
- 남긴 것(정책 경계라 데이터로 밀지 않음): D1·D3 문장, "고추 가루 병"(stt/disease).

## 2차 결과와 v2c (2026-11-02)

2차 학습(`v2b_r16_e2`, 위 보정 반영): 기능 97.5%, 인자까지 93.4%로 1차 재채점(97.8%/95.7%)보다 낮았다. 문장 그룹 508개 중 21개를 새로 맞히고 38개를 새로 틀렸다.

- 좋아진 것: 잡담 94.2→100%, 되묻기 91.4→98.6%, 사용 안내 95.8→100%, 임시 응답/모델 분류 구분.
- 나빠진 것: 관리 방법을 "효과 순으로 순서 매겨 줘"(13행)가 `get_prediction_metrics(topic=ranking)`로, 점수 분포·비교 질문이 confidence·ranking으로 갔다. 보강에 넣은 점수 의미 문장(confidence/limits/ranking 10문장)의 부작용으로 본다. 농약 topic 3→4 같은 변화는 보강과 무관해 학습 한 번의 흔들림으로 본다.
- "가장 높게 나온 병명 후보를 알려줘"는 2차가 `get_diagnosis(result)`로 답했다. train에서 "가장 높은 후보"는 점수(confidence)나 다음 후보(ranking)를 묻는 문장뿐이고 이 문장과 같은 꼴은 없다. 그래서 1차 보정에서 바꾼 ranking 라벨을 사람 검수 라벨로 되돌렸다(위 "train 46행"은 잘못 센 수).

v2c = v2b에서 점수 의미 10문장 제거, "가장 높게 나온 병명 후보" 라벨 원복. train 5,062 / validation 1,160(재촬영 근거 14행만 수정).
v2c validation 라벨로 다시 매기면 1차 기능 97.2%·인자까지 95.0%, 2차 98.2%·94.1%.

```bash
git checkout 2243e4c^ -- ml/qwen/data_v2/train.jsonl ml/qwen/data_v2/validation.jsonl ml/qwen/data_v2/summary.json
python ml/qwen/apply_eval_fixes.py
python ml/qwen/build_train_notebook.py  # data_v2/qwen_v2c_data.jsonl.xz + 노트북(RUN_NAME v2c_r16_e2)
```

## v2c 결과와 결정 (2026-11-02)

v2c 라벨(validation 1,160행) 기준 세 번의 학습:

| 학습 | 기능 | 인자까지 | 틀린 행 |
|---|---|---|---|
| `v2_r16_e2` (1차) | 97.2% | 95.0% | 58 |
| `v2b_r16_e2` | 98.2% | 94.1% | 69 |
| `v2c_r16_e2` | 97.5% | 94.8% | 60 |

- v2c는 1차와 비교해 18그룹(34행)을 새로 맞히고 22그룹(36행)을 새로 틀렸다. 차이 2행은 학습 한 번의 흔들림과 구분할 수 없다.
- v2c가 나아진 곳: 잡담 94.2→100%, 되묻기 91.4→94.3%. 나빠진 곳: 농약 98.6→88.5%(날씨별 사용 조건·재사용 간격·희석 조건 질문이 등록 여부·안전사용기준으로 감). 농약 하락은 v2b에서도 같아 보강 데이터와 관련 있을 수 있다.
- "가장 높게 나온 병명 후보를 알려줘"는 1차·v2c가 ranking, v2b가 diagnosis로 답했다. 학습마다 갈리는 애매한 문장이라 어느 쪽 답도 앱 동작에는 문제가 없다.
- 결정: 서버에는 1차 어댑터(`v2_r16_e2/adapter`)를 쓴다. 점수가 같은 수준이면 농약 질문을 더 정확히 고르는 쪽을 택한다. 데이터 보정은 여기서 멈추고, 더 비교하려면 seed를 바꿔 여러 번 학습해 평균을 본다.

## v3s: 한 줄 시스템 프롬프트 (2026-11-02)

보드(RK3588 NPU, RKLLM)는 발화마다 프롬프트 전체를 다시 처리하므로, 규칙·함수 설명(약 1,100 토큰)을 빼고 한 줄 프롬프트(`spec_v2.SHORT_PROMPT`)로 학습해 봤다. 데이터·설정·seed는 v2c와 같고 프롬프트만 다르다.

| 학습 | 형식 | 기능 | 인자까지 | 학습 시간(A100) |
|---|---|---|---|---|
| `v2c_r16_e2` | 100% | 97.5% | 94.8% | 약 70분 |
| `v3s_r16_e2` | 99.4% | 97.2% | **80.8%** | 8분 |

- 함수는 그대로 잘 고르지만 인자 번호가 무너졌다. 관리 정보 topic 2→3, 범위 밖 reason 3→1, 재촬영 topic 4→3처럼 번호를 하나씩 밀려 고르고, 없는 번호(`reason=4`)도 나왔다(형식 오류 7행).
- 인자 번호의 뜻은 프롬프트의 함수 설명에서 읽고 있다는 뜻이다. 한 줄 프롬프트는 쓰지 않는다(`build_train_notebook.py`의 `SHORT_PROMPT = False`).
- 보드 응답 속도는 프롬프트를 줄이는 대신, 매번 같은 시스템 프롬프트 앞부분을 한 번만 계산해 두는 방식(RKLLM 프롬프트 캐시)으로 줄이는 것을 먼저 확인한다. 보드에서 아직 확인하지 않았다.

## 병합과 평균 모델 (2026-11-03)

학습 없이 `build_merge_eval_notebook.py` 노트북으로 확인했다(v2c validation 라벨).

| 모델 | 형식 | 기능 | 인자까지 |
|---|---|---|---|
| `v2_r16_e2` 어댑터 | 100% | 97.2% | 95.0% |
| `v2_r16_e2` 병합 (`v2_r16_e2/merged_hf`) | 100% | 97.2% | 95.1% |
| 세 run 다수결 (참고, 보드에서 못 씀) | - | - | 96.6% |
| 평균 모델 `soup_v2_v2b_v2c` (16개씩 생성) | 100% | 98.4% | **96.9%** |
| 평균 모델 `soup_v2_v2b_v2c` (한 건씩 생성, `soup_v2_v2b_v2c/merged_hf`) | 100% | 98.4% | **97.0%** |

- 병합: 어댑터와 1,158/1,160행 같은 답, 저장 후 다시 불러와도 같다. 새 토큰 임베딩까지 제대로 합쳐진다.
- 평균 모델: 세 run의 병합 가중치 평균. 1차보다 17그룹(33행)을 더 맞히고 7그룹(11행)을 더 틀렸다. 1,140행이 세 run 다수결 답과 같다. 재촬영 100%, 잡담 100%.
  더 틀린 것은 대부분 농약 "날씨별 사용 조건", "다시 쓰는 간격과 최대 횟수"(topic 3 사용 방법·시기 → 4 수확 전 사용 금지 기간)로, v2b·v2c도 같은 쪽으로 갔다. 라벨 경계를 팀과 정해야 한다.
- 평균 모델은 묶음 생성으로 평가했으므로, 한 건씩 생성으로 다시 평가하고 `soup_v2_v2b_v2c/merged_hf`로 저장한다(노트북 `RUN_MERGE = False`, `SAVE_SOUP = True`). 결과가 같으면 보드·서버에는 평균 모델을 쓴다.

한 건씩 생성으로 다시 평가한 평균 모델은 97.0%다. 16개씩 생성과 다른 답은 1행뿐이고(한 건씩 쪽이 맞음), 저장 후 다시 불러와도 같다.

**결정(2026-11-03): 보드·서버에는 평균 모델 `cropy_qwen_v2/soup_v2_v2b_v2c/merged_hf`를 쓴다.** 어댑터가 아니라 병합된 모델이므로 PEFT 없이 그대로 불러온다. 프롬프트·토큰 정보는 같은 폴더의 `cropy_prompt.json`. (2026-11-11 6 run 평균 모델로 교체 — 맨 아래 "실제 발화 보강과 6 run 평균")

## 웹(브라우저) Qwen과 휴대폰 측정 (2026-11-06 ~ 11-10)

`onnx_web/`: 평균 모델을 transformers.js(WebGPU, q4f16)로 돌리는 묶음과 휴대폰 측정 페이지 `mobile_test/`. PC에서 `serve.py`로 묶음을 서빙하고 cloudflared 터널로 휴대폰에서 연다.

- `prefix_state.py`: 고정 시스템 프롬프트(1,161토큰) 뒤의 디코더 상태를 미리 계산해 둔다(fp16 23MB). 휴대폰은 사용자 문장 ~110토큰만 처리한다. 2B에서 전체 처리와 60/60 같은 답.
- 측정 페이지: 파일을 먼저 기기에 저장(①)하고 불러오기(②), 입력을 128토큰씩 나눠 처리, 질문마다 생성 캐시를 명시적으로 해제(`return_dict_in_generate`; 없으면 질문당 ~25MB GPU 누수로 아이폰이 6문장 뒤 죽었다), CPU(wasm) 경로는 q4 그래프 + 임베딩만 WebGPU(`?cpu=1`, 교차 출처 격리로 멀티스레드).

| 기기 | 2B q4f16 (1.34GB) | 0.8B q4f16 (576MB) | CPU(wasm) 경로 |
|---|---|---|---|
| PC Chrome (RTX, 22코어) | 동작, 질문당 ~1초 | 동작 | 동작하지만 25~45초/질문 |
| iPhone Safari (iOS 18.7) | 불러오기 중 탭 종료 | 11/6 로드 성공, 11/10 세션 생성 중 종료 | 로드 중 종료 |

**결론(2026-11-10): 아이폰 Safari에서는 온디바이스 Qwen이 안 된다.** 탭 메모리 한도 때문이고 PWA·iPhone Chrome(WebKit)도 같다. 오파이·안드로이드 Chrome·PC는 Qwen 그대로.

## 아이폰용 소형 분류기 (2026-11-10 ~ 11-11)

Qwen 대신 같은 입력(발화 + 화면 상태 JSON)에서 같은 `<hs_N>(arg=k)` 호출을 내는 분류기. `build_classifier_notebook.py` → `cropy_fs_classifier_colab.ipynb`(Colab, v2c 데이터). KoELECTRA-small-v3 인코더 + 기능 헤드 1개 + 기능별 인자 헤드 10개, 행마다 자기 기능의 헤드에만 손실. 결과는 Drive `cropy_qwen_v2/clf_*/`(eval_metrics.json, model_int8.onnx, 토크나이저).

| 실험 | 기능 | 인자까지 | 메모 |
|---|---|---|---|
| v1 small, e10, lr 5e-5, [CLS] | 74.0 | 54.0 | 손실이 계속 내려가는 중 |
| v2 small, e30, lr 1.5e-4, 평균 풀링 | 78.3 | 54.6 | train 100% — 과소적합이 아니라 지름길 학습 |
| v3 + 작물 바꿔치기 증강 | 88.9 | 61.6 | 재촬영 인자 5.5%: 문맥 전체를 외움 |
| v4 + 문맥 섞기 증강 | 91.6 | 86.6 | 재촬영 89.1, 범위 밖 98.0. 시드 3개 평균 84.0(82.7~86.6) |
| v5 base-v3 인코더(110M) | 88.7 | 82.2 | small보다 낮고 int8 손실 4p → 인코더 확대 종료 |
| v7/v8 + 겹치는 topic 접기 (시드 2개) | 93.5 / 93.9 | **88.2 / 89.2** | int8 88.1 / 88.8 |

- 지름길: 학습 데이터에서 인자 라벨이 작물·화면 상태와 거의 1:1이라 문장을 안 읽고도 맞힐 수 있었다. 작물 바꿔치기(한 작물만 나오는 행 +7,622)와 문맥 섞기(같은 기능·다른 라벨 행의 문맥을 빌려 복사)로 끊었다.
- topic 접기는 **분류기 라벨에서만** 한다(데이터·Qwen·핸들러 불변). 예측 지표 comparison→ranking, limits→confidence, 재촬영 provenance→certainty, 농약 checklist→verification. 남은 오답은 진단↔예측 지표 경계, 짧은 사용법 발화→잡담, 명확화 target 혼동.
- 아이폰 측정(`mobile_test/clf.html`, `serve.py` 네 번째 인자로 분류기 폴더 → `/clf/`): iPhone Safari에서 int8 13.9MB 로드 4.7초, 16문장 12/16(PC와 출력 동일), 문장당 중앙값 68~81ms, 16문장×5회 반복해도 속도·탭 유지. onnxruntime-web wasm 단일 스레드.

**결정(2026-11-11): 아이폰 Safari에서는 Qwen 대신 이 분류기(v8 int8)로 기능을 고른다.** 출력 형식이 같아 핸들러는 그대로. 정확도는 Qwen 97.0 대비 88.7이므로 Safari 외 기기는 Qwen을 유지하는 이중 구성.

## 실제 발화 보강과 6 run 평균 (2026-11-10 ~ 11-11)

11/10 팀원 5명이 평가 페이지(STT → Qwen)로 배포 모델에 151문장을 말했다(판정 147). 학습 문장은 길고 문어체("화면을 보고 질문할게요 …"), 실제 발화는 짧은 구어체("이거 왜 걸린 거야")라서, 그 형태의 문장을 학습에 더했다.

- `real_speech_eval.jsonl`: 실제 발화 시험 세트 147행(문장 부호 제거, 테스터 이름 없음). 학습에 쓰지 않고 채점만 한다. 정답 중 애매한 것은 사용자가 판정(`gold_note`).
- `real_speech_patch_seed.tsv` + `apply_real_speech_patch.py`: 짧은 구어체 씨앗 문장을 화면 상태별로 학습에만 더한다. 시험 문장과 같은 문장(공백 무시)은 버린다. validation은 그대로라 점수를 비교할 수 있다.
  - v2d: 씨앗 132개 → 학습 +464행 (`data_v2/qwen_v2d_data.jsonl.xz`)
  - v2e: 증상 말하기 → 진단 관찰, 농약 전체 목록, 지난 기록·막연한 요청 되묻기, 사진 준비 화면 문장 추가, 씨앗 155개 → +535행 (`data_v2/qwen_v2e_data.jsonl.xz`, 지금 `train.jsonl`)
- 시험 세트는 보강 문장을 쓰기 전에 읽었으므로 실제 발화 점수는 낙관적이다. 새 녹음으로 다시 재는 것이 깨끗한 확인이다.

한 건씩 생성, Colab A100 bf16. 실제 발화는 정답 9건을 사용자 판정으로 고친 기준(인자까지 144행, 기능 147행).

| 모델 | validation 인자까지 | 실제 발화 인자까지 | 실제 발화 기능 |
|---|---|---|---|
| 이전 배포 `soup_v2_v2b_v2c` | 96.98% | 71.5% | 78.2% |
| v2d 3시드 평균 `soup_v2d_3seed` | 95.4% | 82.6% | 88.4% |
| v2e 3시드 평균 `soup_v2e_3seed` | 94.4% | 81.3% | 88.4% |
| **6 run 평균 `soup_v2abc_v2d_6run`** (v2·v2b·v2c + v2d 3시드) | **97.07%** | **78.5%** | **85.7%** |

- v2d·v2e는 실제 발화를 크게 올렸지만 validation이 떨어졌다. validation 오답은 약 20개 문장 틀(말투 변형이 함께 틀림)에 몰려 있다: "병명 후보"를 순위로, "어느 항목인가요"를 되묻지 않고 바로 답, 심각도↔피해 영향. 짧은 질문에 바로 답하게 한 보강이 "애매하면 되묻기"와 부딪힌 것으로 본다.
- 같은 방식의 보강을 두 번 해도 validation이 회복되지 않아 보강은 멈췄다. 대신 학습 없이 이전 배포 3 run과 v2d 3시드를 평균 냈다(`build_merge_eval_notebook.py`의 현재 설정, 결과 Drive `merge_eval_soup6/`).
- 6 run 평균은 이전 배포 모델 대비 실제 발화 기능 기준 17건을 고치고 6건을 새로 틀렸다. 남은 약점: "이게 탄저병일 확률이 얼마나 돼" → 진단 결과, 화면과 다른 작물 병명 질문 → 작물 확인 대신 진단 결과, 증상 말하기 → 관찰 대신 결과.
- L4(1행 × 16 누적)와 A100의 같은 시드 차이는 시드 편차 수준이었다(v2d 시드 1: 94.0 / 94.6).
- PC CPU float32(평가 서버와 같은 방식)에서도 실제 발화 114/144(79.2%), Colab과 143/144 같은 답.

웹 묶음(q4f16, ONNX Runtime, `web_onnx/2b_soup6/bundle`)으로도 확인했다(`eval_web_onnx.py --split real_speech`):

| 웹 q4f16 | validation 300행 인자까지 | 실제 발화 인자까지 | 실제 발화 기능 |
|---|---|---|---|
| 이전 모델 (`web_onnx/2b`) | 97.33% | 70.8% | 74.8% |
| 6 run 평균 (`web_onnx/2b_soup6`) | 95.67% | **77.1%** | **87.8%** |

validation 300행에서 5행을 잃고 실제 발화에서 9행(기능 기준 19행)을 얻는다. 양자화로 float와 달라지는 답은 실제 발화 12행이며, 농약 "전체 목록"(product=2)을 "지금 화면 제품"(product=1)으로 답하는 쪽이 많다. 오프라인 웹 묶음도 `web_onnx/2b_soup6`을 쓴다.

RKLLM W8A8(RK3588, PC 시뮬레이터, L4에서 변환 976초, 2.735 GB)도 새 모델로 다시 만들었다(`rkllm_soup6/cropy_qwen_w8a8_rk3588.rkllm`):

| RKLLM W8A8 시뮬 (validation 300행) | 기능 | 인자까지 | 같은 행 float | float와 같은 답 |
|---|---|---|---|---|
| 이전 모델 (`rkllm/`) | 99.67% | 98.00% | 98.33% | 99.67% |
| 6 run 평균 (`rkllm_soup6/`) | 99.33% | 97.00% | 97.33% | 98.33% |

인자까지 3행 차이는 float 모델끼리의 차이(같은 300행 float 97.33% vs 98.33%)와 같다. 다만 float와 다른 답을 내는 행은 1행 → 5행으로 늘었다. 재촬영 안내 인자(100% → 92.7%)와 농약 인자(94.3% → 91.4%)에서 잃는다. 실제 발화도 RKLLM 시뮬로 쟀다(`rkllm/sim_real_speech_rkllm.py`). 툴킷은 `.rkllm`을 다시 읽지 못하므로 보드 파일과 같은 설정·같은 보정 데이터(`data_quant.json`)로 다시 양자화해 채점한다:

| RKLLM W8A8 시뮬 | 실제 발화 인자까지 (144행) | 실제 발화 기능 (147행) | 같은 행 float | float와 같은 답 |
|---|---|---|---|---|
| 이전 모델 | 75.0% | 78.9% | 71.5% | 91.0% |
| 6 run 평균 | **79.2%** | **87.1%** | 78.5% | 96.5% |

보드에서도 인자까지 6행, 기능 12행을 얻는다. 새 모델은 양자화로 답이 바뀌는 행이 5행뿐이다(이전 13행). 보드도 `rkllm_soup6`을 쓴다.

**결정(2026-11-11): 보드·서버에는 6 run 평균 모델 `cropy_qwen_v2/soup_v2abc_v2d_6run/merged_hf`를 쓴다.** validation을 지키면서 실제 발화가 올랐다. 이전 모델은 Drive `soup_v2_v2b_v2c/merged_hf`에 그대로 있다. 데모·RKLLM·웹 ONNX 노트북 빌더는 새 모델을 가리키도록 바꿨고, RKLLM(`rkllm_soup6`)·웹 묶음(`web_onnx/2b_soup6`)도 새 모델로 다시 변환했다(11/11).
