# LLM 기능 호출 handler

## 목적

LLM의 hs-call-v2 출력을 검증하고, 현재 진단 기록에 있는 근거로 사용자 안내를 반환한다.

사진을 새로 분석하거나 기존 판정 상태를 변경하지 않는다. 안내할 근거가 부족하면 `insufficient_information`을 반환한다.

## 호출 방법

모델 폴더의 `cropy_prompt.json`에서 함수 계약을 읽어 handler에 전달한다.

```python

from app.services.llm_function_parser import load_function_contract

from app.services.llm_function_handler import handle_function_output

contract = load_function_contract(

&#x20;   "/path/to/model/cropy_prompt.json"

)

response = handle_function_output(

&#x20;   output="<hs_2>(topic=2)<hs_end>",

&#x20;   context=context,

&#x20;   contract=contract,

)

```

위 예시는 현재 v2 함수 순서에서 재촬영 이유를 요청하는 호출이다. 실제 함수 번호는 전달한 모델 계약의 함수 순서에 따라 해석한다.

이 모듈은 LLM 실행, HTTP API 연결, DB 조회, TTS 합성을 수행하지 않는다.

## v2 파서와의 연결

출력 형식은 다음과 같다.

```text

<hs_번호>(인자=정수)<hs_end>

```

예시:

```text

<hs_0>(topic=1)<hs_end>

<hs_2>(topic=2)<hs_end>

<hs_4>(topic=2, product=1)<hs_end>

<hs_8>()<hs_end>

```

- 함수 번호는 0부터 시작한다.

- 인자 값은 1부터 시작한다.

- 파서는 모델 계약에 있는 함수 순서, 인자 이름·순서·범위를 검증한다.

- 농약 제품 인자 이름은 `product`이다.

- 이전 v11의 함수명 토큰과 `<hs-end>` 형식은 사용하지 않는다.

- handler는 파서가 반환한 함수 이름과 정수 인자를 사용한다.

모델 계약의 함수표에는 인자별 허용 개수가 들어 있다. handler의 정수별 의미는 현재 hs-call-v2 학습 계약을 따른다.

핸들러는 인자 이름과 허용 개수를 추가 확인한다. 안내 기능은 `topic`, 확인 질문은 `target`을 사용한다. 다르면 `InvalidFunctionContract`를 발생시킨다.

허용 개수만으로는 같은 개수 안에서 의미가 재배열된 변경까지 감지할 수 없다. 학습 계약의 인자 의미나 순서가 바뀌면 handler와 테스트도 함께 갱신해야 한다.

## 구현 범위

| 기능 | 지원하는 topic |
|---|---|
| `get_diagnosis` | result, severity, observation, provenance, impact, food_safety, change |
| `get_prediction_metrics` | confidence, ranking, distribution, limits, comparison |
| `get_recapture_guidance` | where, why, certainty, provenance |
| `get_care_information` | causes, prevention, priority |

`chit_chat`은 인자 없이 짧은 응답과 앱 기능 안내를 반환한다.

다음 기능은 파서에서 유효하게 분석되더라도 아직 handler가 구현되어 있지 않다.


- `handle_scope_limit`


미구현 기능은 `FunctionHandlerNotImplemented`를 발생시킨다. 이를 사용자 질문이 서비스 범위를 벗어났다는 응답으로 바꾸지 않는다.

## 응답 형식

```json

{

&#x20; "function_name": "get_recapture_guidance",

&#x20; "status": "ok",

&#x20; "text": "사진에서 고추·무·배추 잎을 알아보기 어려워서예요."

}

```

현재 구현에서 사용하는 상태는 다음과 같다.

| status | 의미 |
|---|---|
| `ok` | 저장된 근거나 명시적인 한계 설명으로 안내할 수 있음 |
| `insufficient_information` | 요청한 내용을 안내할 근거가 부족함 |
| `needs_clarification` | 답변에 필요한 대상을 사용자에게 다시 확인함 |

`ok`는 확진이나 정보의 추가 검증이 완료됐다는 뜻이 아니다.

## 확인 질문

`clarify_request`는 작물, 병명, 질문 주제, 점수, 심각도, 진단 기록, 농약 제품, 음성 인식(`stt`) 순으로 여덟 가지 `target`을 지원한다. 예를 들어 `<hs_5>(target=7)<hs_end>`는 사용자에게 농약 제품 이름을 알려 달라고 요청한다. 어떤 작물이나 제품을 뜻하는지 추측하지 않는다.

## 재촬영 안내

### why: 다시 촬영하는 이유

`recapture`가 없어도 저장된 판정 상태와 사유로 답한다.

다음 순서로 확인한다.

1. 판별 불가

2. 작물 불일치

3. 후보 혼동

4. 낮은 신뢰도

판별 불가는 공통 함수 `_is_not_crop()`으로 확인한다. 작물 불일치는 `crop_mismatch` 값도 함께 확인한다.

저장된 재촬영 지침이 있으면 이유와 함께 전달한다. 판별 불가이고 저장된 촬영 방법이 있으면 해당 방법도 전달한다.

판정 이유를 확인할 수 없으면 점수 차이만으로 이유를 추측하지 않고 `insufficient_information`을 반환한다.

### where: 다시 찍을 곳과 방법

저장된 `recapture`의 부위와 촬영 지침이 모두 있으면 해당 내용을 전달한다.

해당 정보가 충분하지 않더라도 판별 불가 결과에 `management_actions`가 있으면 저장된 일반 촬영 방법으로 안내한다.

다른 결과의 일반 관리 행동은 촬영 지침으로 간주하지 않는다. 예를 들어 병든 부위 제거 안내를 다시 찍는 방법으로 전달하지 않는다.

활용할 촬영 정보가 없으면 `insufficient_information`을 반환한다.

### certainty: 재촬영의 한계

재촬영은 추가 단서를 얻는 방법이며 확진이나 후보 구분 성공을 보장하지 않는다고 설명한다.

저장된 촬영 지침이 있으면 함께 전달한다.

### provenance: 안내의 출처

저장된 재촬영 안내가 있으면 진단 당시 함께 저장된 안내임을 설명한다. 이 답변을 위해 사진을 새로 분석했다고 표현하지 않는다.

사용자 문장에 `recapture` 같은 내부 필드 이름을 노출하지 않는다.

저장된 재촬영 안내가 없으면 `insufficient_information`을 반환한다.

## 진단 안내

### result

저장된 분류 후보와 기존 판정 상태를 전달한다.

- 판별 불가에서는 병해 후보를 확정적으로 안내하지 않는다.

- 작물 불일치, 후보 혼동, 낮은 신뢰도 상태를 유지한다.

- 정상 분류가 병해 부재나 식용 안전을 보장한다고 말하지 않는다.

- 사진 분석 결과를 확진으로 표현하지 않는다.

### severity

등록된 병해 정보의 심각도를 안내한다.

사진에서 측정한 진행 정도나 실제 피해 수준과 구분한다. 판별 불가, 값 누락 또는 의미를 확인할 수 없는 값이면 `insufficient_information`을 반환한다.

### observation

병해 후보에 등록된 `description`이 있으면 일반적인 증상 설명으로 전달한다.

사진에서 해당 증상을 직접 관찰했다는 의미가 아님을 함께 안내한다. 판별 불가이거나 병해 범주가 아니거나 설명이 없으면 `insufficient_information`을 반환한다.

### provenance

기록의 분석 출처를 구분한다.

- `model`: 서버의 AI 모델

- `browser`: 브라우저에서 실행한 AI 모델

- `mock`: 데모

- 그 외: 출처를 확인할 수 없음

### impact, food_safety, change

현재 입력만으로 실제 피해량, 식용 안전, 회복·악화 추세를 판단하지 않는다.

해당 한계를 설명하고 `insufficient_information`을 반환한다.

## 점수 안내

### confidence

`0.79` 같은 내부 수치를 `79%`로 표시한다.

AI가 매긴 점수이며 실제 발병 확률이나 피해 수준이 아님을 함께 설명한다.

### ranking, distribution

현재 기록에 있는 후보 이름과 점수를 전달한다.

- `ranking`은 점수가 높은 순서로 표시한다.

- `distribution`은 전달받은 후보 순서를 유지한다.

- 기록에 없는 후보의 점수는 추정하지 않는다.

- 후보가 없으면 `insufficient_information`을 반환한다.

### comparison

기록된 후보 중 점수가 높은 두 후보를 비교한다.

예를 들어 `0.80`과 `0.15`는 각각 `80%`, `15%`로 표시하고 차이는 `65퍼센트포인트`로 안내한다.

후보가 두 개 미만이면 `insufficient_information`을 반환한다. 점수 차이로 재촬영 여부나 기존 판정을 새로 결정하지 않는다.

### limits

점수는 후보를 비교하기 위한 값이며 실제 발병 확률이나 피해 수준을 의미하지 않는다고 설명한다.

백분율과 점수 차이는 소수점 둘째 자리까지 표시하고 불필요한 끝자리 0은 제거한다.

## 원인·예방·관리 안내

- `causes`: 저장된 `causes`로 일반적인 원인을 설명한다. 사진 속 작물의 실제 원인을 확인했다고 말하지 않는다.
- `prevention`: 저장된 `prevention`과 `management_actions`를 안내한다.
- `priority`: `management_actions`에서 비어 있지 않은 첫 항목을 저장된 순서대로 안내한다.
- 해당 정보가 없거나 재촬영이 필요한 불확실한 판정이면 `insufficient_information`을 반환한다.

## 입력 검증과 출처 표시

handler는 응답 전에 다음 검증을 다시 수행한다.

```python

DiagnosisLLMInput.model_validate(context.model_dump())

```

생성 후 직접 수정된 객체의 잘못된 수치도 검증한다. 검증 실패를 정상 안내로 바꾸지 않는다.

Mock 결과에는 다음 문구를 붙인다.

```text

데모 결과이며 실제 모델 진단이 아닙니다.

```

알 수 없는 분석 출처에는 다음 문구를 붙인다.

```text

추론 출처가 확인되지 않은 기록입니다.

```

`model`과 `browser`는 알려진 분석 출처로 처리한다. 템플릿 대체 응답도 같은 출처 기준을 사용한다.

판별 불가 여부는 `llm_guidance._is_not_crop()`을 공유하고, handler의 출처 문구는 `_response()`에서 공통 처리한다.

## 오류 구분

| 오류 | 의미 |

|---|---|

| `InvalidFunctionOutput` | 출력 형식, 함수 번호 또는 인자가 모델 계약과 맞지 않음 |

| `InvalidFunctionContract` | 모델 계약 구조 또는 구현된 handler의 인자 구성이 지원 범위와 맞지 않음 |

| `FunctionHandlerNotImplemented` | 유효한 기능이지만 handler가 아직 구현되지 않음 |

| `ValidationError` | 진단 입력이 스키마 검증을 통과하지 못함 |

## 테스트

`backend` 디렉터리에서 실행한다.

```powershell

.\.venv\\Scripts\\python.exe -m pytest tests/test_llm_function_parser.py tests/test_llm_function_handler.py tests/test_llm_guidance.py -q

```

주요 확인 항목:

- v2 호출 형식과 정수 인자 처리

- 잘못된 출력 거부와 미구현 기능 구분

- 저장된 재촬영 안내 전달

- 재촬영 안내가 없어도 저장된 판정 사유로 이유 설명

- 판별 불가의 저장된 일반 촬영 방법 활용

- 관리 행동을 촬영 지침으로 잘못 해석하지 않음

- 점수의 백분율 표시와 퍼센트포인트 차이

- 실제 발병 확률로 해석하지 않음

- 등록된 증상 설명과 실제 사진 관찰 구분

- Mock 및 분석 출처 표시

- 입력 객체를 변경하지 않음

- 수정된 잘못된 입력의 재검증

테스트의 `FunctionContract`는 테스트용 계약이다. 배포 모델의 실제 응답 생성이나 보드 실행을 검증한 것은 아니다.

## 통합 상태

이 변경은 파서와 저장된 진단 컨텍스트를 연결하는 서비스 계층 구현이다.

실제 모델 호출, API 연결, TTS 연결 및 Orange Pi 실행은 별도 통합과 검증이 필요하다. 선행 PR #127이 develop에 반영된 뒤 최신 develop 기준으로 최종 확인한다.

### 앱 사용 안내

\`get_usage_guidance\`는 \`topic\` 1~6과 \`delivery\` 1~2를 받는다.
호출부에서 \`ui_stage\`를 제공하면 현재 화면에 맞는 다음 행동을 안내한다.
화면 상태가 필요한 요청에 해당 정보가 없거나 직전 안내를 다시 들을 수 없는 경우에는
\`insufficient_information\`을 반환한다.

### 농약 정보 안내

\`get_pesticide_information\`은 진단 기록의 PSIS 검증 항목만 사용한다.
현재 제품이 모호하면 제품 이름을 되묻고, 확인된 정보가 없거나
혼용 가능 여부를 확인할 수 없으면 정보 부족 응답을 반환한다.
제품 선택 식별자를 받기 전에는 기록에 제품이 하나일 때만 현재 제품으로 처리한다.
