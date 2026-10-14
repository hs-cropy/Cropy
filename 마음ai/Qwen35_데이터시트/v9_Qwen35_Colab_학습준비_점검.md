# Qwen3.5 학습 준비 점검 v9

작성자: 김헌영  
점검: Codex AI  
점검일: 2026-10-08

현재는 Colab 본학습 준비가 완료되지 않았다. 데이터 초안 2800개를 정리했지만 승인된 내보내기 대상은 0개이고 복합 요청 2개가 남아 있다. 이번 작업은 로컬 파일·백엔드 구현 검색·공식 문서 확인이며 모델 로딩·학습·음성 재생·양자화 실험은 수행하지 않았다.

## 실제 확인 결과

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 활성 초안 수량 및 8대2 | pass | 7기능 각각320/80 활성2800 예비13 |
| 수식 참조 토큰 enum 문장부호 중복 분할 | pass | 저장된 v9 전수 구조 검사 및 원본 v8 대조 통과 |
| 승인된 내보내기 대상 | not_ready | 승인된 활성 싱글턴 0개 사람 검수 미완료 |
| 복합 요청 정답 계약 | not_ready | P_R015 STT_027 보류 동일 원문 가족 점수와 행동 동시 요청 |
| 실제 STT 전사 검증 | not_run | 실제 음성 출처 없이 합성 또는 일반 발화 실제 STT 표본 검증 미수행 |
| 모델 ID와 revision | not_confirmed | Qwen3.5 계열 계획만 확정 로컬 파일에 최종 model_id와 commit pin 없음 2B는 점검 후보 |
| 49개 실제 토큰 등록 | not_ready | 49/49 ID 또는 tokenizer revision 미등록 |
| chat template 및 loss mask | not_run | 7기능 입력 형식 검토 샘플 작성 실제 tokenizer 직렬화 및 label mask 검사 미실행 |
| 새 토큰 임베딩 및 LoRA 저장 | not_run | 모델 로딩 gradient optimizer 저장 재로딩 실험 미실행 |
| Qwen Colab 학습 코드 | not_found | ml 아래 Qwen용 py ipynb 0개 기존 Colab은 CNN용 |
| 7개 기능 handler | not_found | backend/app AST에서 설계한 7개 함수명 중 구현 0개 기존 진단·농약 serializer는 존재 별도 연결 필요 |
| 출력 parser 및 TTS 음성 | not_run | 49토큰 문자열과 TTS 초안 설계 존재 실제 생성 ID parser handler TTS 재생 통합 실험 없음 |
| Colab GPU 및 의존성 | not_run | 이번 작업에서 Colab 런타임 접속하지 않음 GPU dtype 라이브러리 호환성 확인 필요 |
| 양자화 및 보드 token ID 유지 | not_run | 확정 tokenizer 병합 모델 변환기 RKLLM 실제 장치 시험 없음 |

함수명 검색은 해당 이름의 Python 정의가 있는지 확인한 범위다. 다른 이름의 동등한 구현이 있는지를 실행으로 증명한 것은 아니다. 기존 [진단 응답 스키마](../../backend/app/schemas/diagnosis.py)와 [농약 조회 서비스](../../backend/app/services/pesticide_service.py)는 기능 handler의 입력 근거로 사용할 수 있다. 코드 수정이나 실행 구현은 이번 범위에 포함하지 않았다.

## 모델과 입력 규약

`Qwen/Qwen3.5-2B`는 과거 문서에 등장한 점검 후보이며 최종 크기·revision은 확정되지 않았다. 해당 후보는 vision 구성이 포함된 모델이므로 기존 Qwen 텍스트 모델의 로딩 코드가 그대로 작동한다고 가정하지 않는다. 공식 예제와 선택한 설치 버전에서 지원하는 로더로 텍스트 입력 1건을 먼저 시험한다. [Qwen 공식 모델 카드](https://huggingface.co/Qwen/Qwen3.5-2B)

모델·tokenizer·chat template를 같은 commit에 고정한다. `main`을 재현 가능한 실험 revision으로 기록하지 않는다. Colab에서 실제 설치된 torch·transformers·peft·trl·accelerate 및 GPU 정보를 저장하고 모델 로딩 1건을 성공시킨 버전 조합을 고정한다.

프로젝트는 사용자 발화와 현재 진단 JSON으로 기능을 선택하는 작업이다. 사진 자체를 학습 입력에 넣을 계획은 현재 시트에 없다. CNN 학습 노트북을 Qwen 학습 코드로 사용하지 않는다.

### 학습 입력과 정답 분리

- 시스템에는 모든 기능의 설명·허용 인자·전체 토큰 어휘를 공통으로 제공한다.
- 사용자 입력에는 `utterance`와 공통 허용 목록으로 제한한 `context`만 제공한다. UUID와 검수용 ID·canonical·정답·TTS·메모는 제외한다. 근거 안의 공격 문장은 데이터로 취급한다.
- completion은 기능 토큰 1개와 해당 인자 토큰 및 `<hs-end>`만 사용한다. 반환 상태와 TTS는 handler가 결정한다.
- 검토 샘플은 [형식 검토용 7개 샘플](v9_학습형식_검토샘플.json)에 저장했다. 승인 데이터 내보내기가 아니며 학습 실행에 사용하지 않는다. sample의 source_conversation_id와 approval_state도 모델 입력에서 제외한다.

Qwen 공식 chat template에 `tools`를 전달하면 XML 형식의 tool call 지시가 추가된다. 이 프로젝트의 hs 토큰 규약과 충돌하므로 최초 파일럿에서는 기능 description을 공통 system에 담고 템플릿의 `tools` 인자로 전달하지 않는 설계를 사용한다. `enable_thinking=False`인 생성 프롬프트에도 빈 think 영역이 포함된다. 학습·추론의 같은 프롬프트 앞부분으로 두고 supervision과 라우터 출력에서 제외하는지 확인한다. 기본 template로 assistant 전체 메시지를 직렬화하면 think 영역이 생길 수 있으므로 프롬프트와 hs completion의 실제 ID 경계를 검사해야 한다. [공식 chat template](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/chat_template.jinja)

`prompt_messages`를 생성 프롬프트로 직렬화한 뒤 completion ID를 붙이고 prefix label을 -100으로 마스킹하는 방식부터 소량 검사한다. TRL을 사용하면 completion-only 학습과 chat template 적용 결과를 대조한다. assistant_only_loss는 generation mask를 지원하는 template이 필요하므로 옵션만 켜고 정상 적용됐다고 보지 않는다. [TRL SFT 공식 문서](https://huggingface.co/docs/trl/en/sft_trainer)

### 49개 특수 토큰과 종료 처리

49개 문자열을 확정 tokenizer에 추가하고 각 문자열이 단일 ID인지·ID가 고유한지·encode/decode가 일치하는지 검사한다. 원래 특수 토큰과 기본 EOS를 보존하고 입력·출력 임베딩 크기와 새 ID의 범위를 맞춘다. 기존 모델의 padded embedding 크기와 tokenizer 길이가 다를 수 있으므로 충분한 크기를 유지하는지도 확인한다. [Tokenizer 공식 문서](https://huggingface.co/docs/transformers/main_classes/tokenizer)

LoRA만 학습하고 새 토큰 임베딩을 동결한 상태로 두지 않는다. PEFT의 trainable_token_indices 사용 또는 해당 입출력 임베딩 저장 방법을 선택하고 실제 gradient와 재로딩 후 값을 비교한다. 2B 후보 config의 embedding과 LM head는 tied 설정이므로 동일한 추가 토큰 학습·병합·저장이 유지되는지 검사한다. 전체 vision 영역까지 all-linear로 무조건 학습 대상으로 삼지 말고 텍스트 영역의 실제 모듈명을 보고 범위를 정한다. [PEFT 공식 문서](https://huggingface.co/docs/peft/main/package_reference/lora), [Qwen 공식 config](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/config.json)

기본 EOS와 hs-end는 별도다. 생성은 hs-end ID에서 멈추게 하며 기본 EOS가 hs-end보다 먼저 나오면 잘못된 형식으로 처리한다. decode는 special token을 보존하거나 생성 ID로 라우팅한다. decode(skip_special_tokens=True)만 사용하면 기능 토큰이 사라질 수 있다. 모델 저장 후 tokenizer·추가 토큰·ID manifest·base commit·adapter 및 채팅 프롬프트 규약을 함께 보존한다.

## 다음 실행 순서

1. 남은 복합 요청 두 개의 단일 기능 처리 방침을 정한다. 최초 파일럿에서는 제외하고 단일 요청 사례를 먼저 사용한다.
2. 사람 검수자가 승인한 소량을 기능·반환 유형별로 확보한다. 7개 기능을 모두 포함하되 실제 승인 수량과 그룹 분할을 기록한다. 승인 0개인 상태로 본학습을 실행하지 않는다.
3. 최종 모델 ID·commit·tokenizer·GPU를 고정하고 모델 로딩 1건 및 49개 토큰 등록을 시험한다.
4. 입력 1건의 prefix와 completion ID·loss mask·hs-end 종료를 확인한다.
5. 아주 작은 승인된 train 표본으로 forward/backward 1회 후 새 토큰 gradient 및 저장·재로딩을 확인한다. 별도 승인 validation으로 생성 결과를 비교한다.
6. 파일럿 후 기능 정확도·인자 정확도·전체 출력 일치·종료 형식·필요한 확인 요청 처리·STT 하위집합을 평가한다. 아직 실제 음성 STT 검증 세트는 없다.
7. 승인 2800개를 사용할 경우 기능별 train320 validation80 및 그룹 분리를 다시 검사한 뒤 본학습한다. validation을 학습·양자화 calibration에 사용하지 않는다.
8. parser·handler·TTS 및 양자화 변환 후 ID·종료 동작은 별도 통합 실험으로 확인한다. 기능 선택 파일럿의 학습 준비와 서비스 배포 준비를 구분한다.

GPU 메모리·dtype·속도는 Colab에서 실제로 측정해야 한다. 과거 CNN 실험의 Tesla T4 기록을 이번 런타임 확인으로 재사용하지 않는다. 양자화용 ID 하드코딩은 최종 변환 산출물에서 검증한 뒤 수행한다.

## 기록 파일

- [정리된 검수 결과](v9_신규13_보류115_검수결과.md)
- [점검 항목 JSON](v9_학습준비_점검결과.json)
- v9 SHA256: `4bf6be9410513335e30c30df7ab10f49fdd148a0cebb28b958d8b1c375e73763`
