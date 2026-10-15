# API 명세 보완 검증 기록

2026-10-15, `origin/develop`의 `ebfb0ca8db314155b753702fff58968550304f75`를 기준으로 수정했다. 업무 API 12개의 경로·메서드는 모두 유지한다.

## 변경

- 오프라인 bundle_version은 정확히 64자리 소문자 16진수로 검증한다. 잘못된 형식은 422, 정상 형식의 미지원 묶음은 409다.
- 이미지 저장 실패는 IMAGE_STORAGE_UNAVAILABLE 503으로 응답한다. 기존 rollback·부분 파일 정리 흐름을 유지한다.
- 복구 디렉터리 생성 실패는 RECOVERY_STORAGE_UNAVAILABLE 503으로 응답한다.
- 최신 DB 준비 상태 검사와 농약 안전값의 엄격한 0 이상 정수 검증, LLM 모듈을 보존했다.
- readiness 필드, 농약 제약, multipart metadata 내부 스키마, 응답·오류 예시를 문서화했다.

## 검증 결과

- requirements.txt에 고정된 14개 패키지 버전 일치, pip check 통과. 주요 버전은 FastAPI 0.143.0, Starlette 1.7.0, Pydantic 2.10.3, Torch 2.13.0+cpu다.
- 수정 브랜치 전체 백엔드 테스트: **347 passed, 1 skipped**. Windows 심볼릭 링크 권한으로 1개 제외. TestClient 및 ONNX exporter 관련 사용 중단 예고 3건이 있다.
- 격리된 서버와 DB 복사본에서 실제 모델 HTTP 요청 46건을 수행했다. 사진 9장의 추론, 이력, 중복 요청, 재촬영, 오프라인 입력 및 오류 응답을 확인했다.
- 잘못된 번들 3종은 422, 정상 형식의 없는 번들은 409, 유효한 번들은 200이었다.
- 수정 브랜치에서 이미지 쓰기와 복구 폴더 생성에 OSError를 주입하여 각각 503 JSON과 해당 오류 코드를 확인했다.
- 수정 서버 OpenAPI에서 docs/api/openapi.json을 생성하고, 이를 입력으로 openapi.html을 생성했다. 모든 로컬 참조와 HTML 내장 명세의 일치를 검사했다.

체크포인트 SHA256: `b0b0b4a24af1430778a2bc15ede5cc068e200539dfeb7fc5ced02574a63d4b8b`.

수정 전 develop에서도 headless Chrome으로 실제 사진의 ONNX 추론, 오프라인 새로고침·이력 유지, 동기화, 서버 커밋 후 응답 유실 및 중복 없는 재시도를 확인했다. 실제 iPhone 검증이나 모델 정확도 평가를 의미하지 않는다. DB 저장 실패 후 recovery_token을 통한 복구 성공 흐름은 이번 범위에 포함하지 않는다.

## 문서 배포 순서

이 문서는 수정 브랜치의 명세다. 백엔드 PR이 develop에 병합된 후 병합 결과에서 명세를 다시 확인하고, `hs-cropy/locallife-api-docs`의 `docs/api-docs.json`과 `docs/api-docs.html`을 갱신한다. README, index.html 및 .nojekyll은 유지한다. 배포 후 공개 JSON·HTML과 해당 코드의 OpenAPI를 대조한다.
