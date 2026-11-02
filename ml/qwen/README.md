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

- 라벨 수정(validation 22행): "재촬영 요청의 **근거**가 기록돼 있나요"는 `get_recapture_guidance(topic=provenance)`(기존 why). "가장 높게 나온 병명 후보"는 train 46행과 같게 `get_prediction_metrics(topic=ranking)`(기존 get_diagnosis). 두 경우 모두 모델 답이 함수 설명과 맞았다.
- train 보강(`train_patch_seed.tsv` 60문장 → 변형 포함 284행, train에만): 앱에게 이름·하는 일을 묻는 잡담, 선택 작물과 안내 작물이 다른 상황(`clarify_request(target=crop)`), 임시 응답/모델 분류 구분(`get_diagnosis(topic=provenance)`), 점수 의미(confidence/limits/ranking), 재촬영하면 확정되는지, 다시 시도 순서(step_by_step). validation과 띄어쓰기만 다른 문장은 넣지 않는다.
- validation 행은 그대로라 1차 결과와 비교할 수 있다. 라벨을 고친 22행 기준으로 1차 결과를 다시 매기면 기능 97.8%, 인자까지 95.8%.
- 남긴 것(정책 경계라 데이터로 밀지 않음): D1·D3 문장, "고추 가루 병"(stt/disease).
