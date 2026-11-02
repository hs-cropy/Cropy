\# LLM 기능 handler



\## 구현 범위



기능 토큰을 파서로 검증한 뒤 현재 DiagnosisLLMInput에서

근거를 읽어 안내 문장을 만든다. 새로운 추론이나 DB 조회는 실행하지 않는다.



지원 기능:

\- get\_diagnosis: 분류 후보, 심각도 참고 속성, 추론 출처와 정보 한계

\- get\_prediction\_metrics: 모델 점수, 제공된 후보 목록과 점수 비교

\- get\_recapture\_guidance: 저장된 재촬영 부위·지침·이유·출처와 확정 한계



\## 처리 원칙



\- 입력 컨텍스트의 수치를 처리 전에 다시 검증한다.

\- 판별 불가를 병해 후보로 설명하지 않는다.

\- Mock 결과를 실제 모델 진단과 구분한다.

\- 작물 불일치·후보 혼동·낮은 신뢰도 상태를 유지한다.

\- severity는 DB 참고 속성이며 사진에서 측정한 진행 정도가 아니다.

\- confidence는 실제 발병 확률이나 피해 수준이 아니다.

\- 점수 차이로 재촬영 여부를 새로 판정하지 않는다.

\- 없는 관찰 소견·피해·식용 안전·회복 추세는 정보 부족으로 반환한다.

\- 재촬영 확정 한계는 안내가 없어도 설명할 수 있다.



현재 지원 기능은 ok 또는 insufficient\_information을 반환한다.

형식이 잘못된 출력은 InvalidFunctionOutput,

아직 구현되지 않은 기능은 FunctionHandlerNotImplemented 예외로 구분한다.



needs\_clarification과 unsupported\_scope는 응답 계약에 정의되어 있지만,

해당 기능 handler는 아직 구현하지 않았다.



\## 검증 및 제한



파서·handler 테스트 65개가 Windows 로컬에서 통과했다.



실제 Qwen/RKLLM 호출, HTTP API, 화면·TTS 연결,

농약·관리·확인 질문·지원 범위 handler는 이번 변경에 포함하지 않는다.



전체 백엔드 테스트: 525 passed, 24 skipped, 1 warning.

git diff --check 통과.

