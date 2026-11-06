# LLM 기능 호출 파서

## 계약

모델 폴더의 cropy_prompt.json에서 system_prompt, functions,
stop_token을 읽는다. 함수표를 운영 코드에 중복 정의하지 않는다.

functions 객체의 순서가 0부터 시작하는 함수 번호를 결정한다.
각 함수의 목록은 [인자 이름, 허용 값 개수]이며 인자 순서도 보존한다.
인자 값은 1부터 시작하는 정수다.

예시:
`<hs_4>(topic=2, product=1)<hs_end>`

파싱 결과:
- function_name: get_pesticide_information
- arguments: {"topic": 2, "product": 1}

함수표에는 정수의 의미 문자열이 없으므로 파서는 정수를 그대로 반환한다.
정수와 의미의 대응 및 지원 기능 실행은 handler의 별도 책임이다.
모델 변경 시 handler 의미 대응도 함께 검토해야 한다.

## 사용

1. load_function_contract(path)로 모델 계약을 한 번 읽는다.
2. parse_function_output(output, contract)에 모델 출력과 계약을 전달한다.

기본 함수표나 이전 v11 형식으로 자동 대체하지 않는다.
계약 파일이 없거나 손상되면 정상 준비 상태로 취급하지 않는다.

## 검증 규칙

앞뒤 공백만 허용한다.
함수 번호, 인자 이름·순서·개수·정수 범위와 종료 토큰을 검사한다.
자연어·JSON·코드 블록·복수 호출·이전 토큰 형식은 거부한다.
입력 길이는 앞뒤 공백을 포함해 최대 512자다.

잘못된 계약은 InvalidFunctionContract,
잘못된 출력은 InvalidFunctionOutput 예외로 구분한다.
파일 읽기 실패는 해당 파일 예외를 호출 측에 전달한다.

## 범위

모델 추론이나 함수를 실행하지 않는다.
형식 검증 성공은 사용자 의도에 맞는 기능 선택을 보장하지 않는다.
새 기능도 계약에 있으면 파싱할 수 있지만 handler 구현 여부는 별개다.
실제 모델·API·TTS 연결과 handler 변경은 이 PR 범위 밖이다.

## 검증 결과

- 파서 단위 테스트: 55 passed
- 전체 백엔드 테스트: 508 passed, 24 skipped, 1 warning
- git diff --check 통과
- Qwen 명세 기준 커밋: 7c1231a32455e939af1c1f0814e39ed722ef4ac6
- 해당 커밋의 명세로 재구성한 계약과 validation 1,160건 대조:
  함수명·정수 인자 모두 일치

실제 배포 모델 폴더의 cropy_prompt.json 및 모델 추론은
이번 검증에서 직접 확인하지 않았다.