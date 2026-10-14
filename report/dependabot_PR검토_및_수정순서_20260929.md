# 최신 PR 보안 경고 대응 검토 및 수정 순서

조회일: 2026-09-29. 열린 PR #2, #18~#27의 최신 커밋·변경 파일을 GitHub에서 조회했다. 경고는 여전히 46건 모두 open이다. 이번 작업은 검토와 계획 수립이며 코드·의존성·원격 PR은 변경하지 않았다.

## 기존 변경으로 해결되는가

| PR | 확인한 변경 | 보안 경고에 대한 판단 |
|---|---|---|
| #2 | ESLint/Prettier 및 package-lock 변경 | 경고 대상 패키지는 기존 버전 유지. Next 15.5.20, sharp 0.34.5, PostCSS 8.5.16 및 Next 내부 8.4.31, nanoid 3.3.15, Browserslist 4.28.4, baseline-browser-mapping 2.10.40. 해결되지 않음 |
| #18 | 시드·백업·마이그레이션 | CI의 시드 누락 문제 해결. 취약 의존성 변경 없음 |
| #19 | 모델 준비 상태·진단 검증 | 의존성 패치 없음 |
| #20 | 요청 전체 크기 제한, 실제 이미지 형식·픽셀·디코딩 검증, 업로드 정리 | 일부 입력 공격 완화. requirements 변경이 없어 취약 패키지 자체는 그대로 |
| #21 | 농약 카탈로그 | 해당 패키지 변경 없음 |
| #22~#24 | 학습·데이터 감사·평가 | 해당 런타임 의존성 패치 없음 |
| #25~#26 | 계획·운영·실험 문서 | 패치 없음 |
| #27 | pytest·lint·build CI | 보안 패치나 보안 스캔 추가는 아님 |

#20의 RequestBodyLimitMiddleware는 main.py에 등록되어 multipart 파싱 전에 실제 수신 바이트 수를 제한한다. 따라서 이전 조사에서 파일 크기 검사만 언급한 설명은 불완전했다. 전체 요청 상한은 큰 요청 위험을 줄이지만 상한 이내 악성 헤더의 CPU 비용이나 라이브러리의 다른 취약점을 해결하지 않는다. JPEG/PNG 판별 역시 Image.open 이후이므로 모든 플러그인 파싱 위험이 사라졌다고 단정하지 않는다.

## 작업 순서

1. **기준과 재현 환경 고정**: 실제 배포 브랜치·커밋·OS를 확인하고 frontend lockfile과 backend 고정 버전을 기록한다. 현재 보고된 46건은 main 기준이다. 업데이트 작업은 별도 브랜치에서 진행한다.
2. **프론트 보안 PR 우선**: 최신 develop에서 Next 15.5.24, sharp 0.35.4를 최소 패치 기준으로 검토한다. 호환되는 최신 패치 및 설치 가능한 의존 범위를 레지스트리에서 확인한 뒤 선택한다. Next의 sharp 의존 범위가 맞지 않으면 단순 루트 추가로 해결됐다고 판단하지 않는다. 필요 시 호환되는 Next 버전 또는 검증된 override를 선택한다. #2의 eslint-config-next도 Next에 맞춰 조정한다. #2의 lint 설정을 반영하되 #18~#26 전체 병합을 기다릴 필요는 없다.
3. **프론트 하위 의존성 정리**: PostCSS 8.5.23, nanoid 3.3.18, Browserslist 4.28.7, baseline-browser-mapping 2.11.0을 최소 패치 기준으로 검토한다. 모든 lockfile 경로를 확인하고 특히 Next 내부 PostCSS를 빠뜨리지 않는다. 호환 범위 밖 강제 업데이트는 피하고 npm ci, lint, build, 페이지·API proxy·이미지 표시를 검증한다. 의존성상 함께 해결되면 2번 PR에 포함하고 별도 호환 작업이면 나눈다.
4. **백엔드 업로드 의존성 PR 병행**: Pillow 12.3.0, python-multipart 0.0.31을 최소 기준으로 검토한다. #20의 방어 코드를 유지하면서 호환성을 확인한다. #18→#19→#20의 의존 순서를 지키되 보안 패치가 장기간 대기하면 develop에 최소 의존성 패치를 먼저 만들고 #20에 반영해 확장 검증한다. 별도 이슈의 MPO 지원은 보안 패치 범위에 섞지 않는다.
5. **ML 런타임 별도 PR**: torch 2.13.0 기준 패치 및 CPU wheel 가용성·torchvision 호환 조합을 확인한다. 학습 알고리즘 변경 없이 체크포인트 로딩, 전처리, 고정 샘플 추론 회귀, CPU 실행을 검증한다. torch.jit.script 직접 호출은 이전 로컬 조사에서 발견하지 못했으므로 Critical/업로드 경로보다 후순위로 둔다.
6. **CI와 통합 검증**: #18과 #2 반영 후 #27을 최신 develop에 맞춰 CI를 확인한다. 연쇄 PR도 검사하려면 pull_request 대상 브랜치 제한을 조정한다. 필수 검사 규칙 설정 여부를 확인하고 npm audit 및 Python 의존성 스캔을 별도 보안 검사로 추가 검토한다. 일반 pytest 통과만으로 보안 경고 해결을 선언하지 않는다.
7. **배포·재스캔**: 검증된 수정사항을 develop에서 통합한 뒤 팀 절차에 따라 main과 실제 실행 환경에 반영한다. Dependabot 재스캔으로 46건 각각의 상태를 확인하고 잔여 전이 의존성을 추적한다. 경고를 dismiss하는 것으로 해결을 대신하지 않는다.

## 완료 기준

- 알려진 취약 버전이 모든 관련 의존 경로에서 제거되었음.
- 백엔드 전체 테스트 및 손상 파일·형식·픽셀·요청 크기·재촬영 회귀 통과.
- 프론트 lint/build와 실제 화면·업로드·프록시 연결 정상.
- 실제 모델 로딩과 추론 회귀 확인. 테스트의 mock 동작만으로 추론 검증을 대신하지 않음.
- main Dependabot 재스캔과 배포된 버전을 각각 확인함.

## 근거

- [PR 목록](https://github.com/hs-cropy/Cropy/pulls)
- [#2](https://github.com/hs-cropy/Cropy/pull/2): 확인 커밋 97ed5bf4da6bb8129d39c5fa33b40470c0f2cdac
- [#20](https://github.com/hs-cropy/Cropy/pull/20): 확인 커밋 fea54028b1fcd482e26a6dac52d9a3bfd0da7e93
- [#27](https://github.com/hs-cropy/Cropy/pull/27): 확인 커밋 ba4faa5d8ae66b4d027631da398c29dedde2a6eb
- [전체 경고](https://github.com/hs-cropy/Cropy/security/dependabot), [46건 상세 조사](dependabot_review_20260929.md)
