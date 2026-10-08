# Qwen3.5 검수 전 100 step 비교 실험 v12

작성자: 김헌영  
일자: 2026-10-08

20step에서 검증 28개 모두 hs-end만 출력했습니다. 다음 실험은 동일 데이터와 기본 모델에서 총100step을 학습하고 학습·검증의 생성 결과를 함께 비교합니다. 기존20step 모델을 이어서 학습하는 방식이 아닙니다.

## 업로드할 파일

기존 원본 XLSX는 그대로 사용합니다. 새 폴더의 노트북과 helper를 Drive에 추가하세요.

```text
MyDrive/cropy_qwen_v11/
  Cropy_Qwen35_기능별400_검수대기_v11.xlsx
  Colab_검수전_100step_v12/
    Cropy_Qwen35_검수전_100step_v12.ipynb
    cropy_qwen_pilot.py
```

이 helper는 앞서 발생한 BatchEncoding 오류 수정과 새 진단 함수가 포함돼 있습니다. 이전 폴더의 helper를 대신 사용하면 새 진단 함수를 찾지 못하므로 이 폴더의 파일을 업로드합니다.

## 실행 순서

1. 새 노트북을 Colab에서 엽니다.
2. 이전 모델이 메모리에 남지 않도록 런타임을 다시 시작하고 GPU를 선택합니다. 가능하면 이전과 같은 Tesla T4로 비교합니다.
3. 모든 셀을 순서대로 실행합니다. 사람 검수표나 대조용 CSV는 이 실험에 필요하지 않습니다.
4. 설치한 패키지 때문에 런타임 재시작 안내가 나오면 재시작하고 처음부터 실행합니다.
5. 데이터 선택 셀에서 기존 실험과 같은 학습112개·검증28개 확인 메시지를 확인합니다.
6. 토큰 등록·입력 마스킹·gradient 검사를 통과하면 총100step 학습합니다. 20step 간격으로 중간 체크포인트를 저장하고 최근2개를 유지합니다.
7. 학습이 끝나면 학습112개·검증28개를 자유 생성으로 평가하고 첫 위치의 정답 함수와 종료 토큰 확률을 기록합니다. 최종 어댑터 저장 후 검증28개 재로딩 대조를 진행합니다.

## 유지한 조건과 변경점

모델 Qwen/Qwen3.5-2B의 commit, 원본 SHA256, 프롬프트 SHA256, seed10810, 토큰 ID, 학습112개·검증28개의 ID·순서는 이전 결과에 고정했습니다. LoRA와 4bit 로딩, 초기 학습률2e-4, batch1 및 gradient accumulation4도 유지했습니다.

Transformers5.19.0·PEFT0.21.2·Accelerate1.15.0·bitsandbytes0.50.2·tokenizers0.23.2를 이전 버전으로 설치합니다. PyTorch와 GPU는 실제값을 기록하고 이전 환경과 차이가 있으면 environment_comparison.json에 남깁니다. 기록된 필드의 일치가 전체 환경 동일성을 보장하지는 않습니다.

변경은 총 학습step20→100과 진단·중간 저장 추가입니다. 선형 학습률 감소는 종료step이 달라 경로도 달라집니다. 따라서 총step을 바꾼 비교이지 모든 step의 학습률이 똑같은 실험은 아닙니다.

첫 위치 진단은 Qwen3.5의 logits_to_keep=1을 사용해 마지막 위치의 출력만 계산합니다. [공식 Qwen3.5 API](https://huggingface.co/docs/transformers/model_doc/qwen3_5)를 참고했습니다.

## 결과 위치와 확인 파일

결과는 `MyDrive/cropy_qwen_v11/unreviewed_100step_v12_실행시각`에 저장됩니다.

| 파일 | 확인 항목 |
|---|---|
| train_metrics.json | 학습loss·시간·완료epoch |
| train_generation_metrics.json | 학습112개 생성의 함수·인자·완전일치·종료만 출력 비율 |
| train_generation_cases.json | 학습 사례별 출력과 첫 토큰 확률·순위 |
| eval_metrics.json | 검증28개 생성 지표 |
| eval_cases.json | 검증 사례별 출력과 첫 토큰 확률·순위 |
| comparison_20_vs_100.json | 기존20step 대비 검증 지표의 변화 |
| reload_check.json | 저장 전후 토큰과 검증 출력 일치 |
| environment.json / environment_comparison.json | 실제 실행환경 및 이전 기록과 차이 |

`end_only`는 종료 토큰만 출력한 비율이며 낮아지는지 확인합니다. `first_token_correct`는 실제 생성의 첫 토큰이 정답 함수 토큰인 비율입니다. `first_position`의 expected_probability·end_probability·expected_rank는 함수 토큰을 출력할 위치에서 모델이 정답과 종료 토큰에 준 확률·순위입니다.

학습에서도 end_only가 높으면 학습량·출력 가중치·마스킹 경로를 점검하고, 학습은 맞추는데 검증이 낮으면 일반화·데이터 구성을 점검합니다. 어느 쪽도 현재 결과가 나오기 전에 원인으로 단정하지 않습니다.

## 시간과 확인 범위

기존20step 학습은 약11분16초였습니다. 같은 속도를 단순히5배로 계산하면100step 학습만 약56분20초이며 추가 평가·저장 시간과 실제 GPU 환경에 따라 달라집니다.

로컬에서는 기존 사례 ID·원본·프롬프트 해시 연결, 새 종료 출력 진단 테스트4개, 기존 helper의 BatchEncoding 처리와 노트북 구문을 확인했습니다. 100step GPU 학습은 아직 실행하지 않았습니다. 사람 승인 상태도 바꾸지 않았습니다.
