# 작업 기록과 로컬 실험 산출물

이 폴더에는 실험 원본과 함께 읽는 분석 보고서, 재현 코드와 평가 지표를 보관한다. 주간보고·제출본은 [주차별 보고 목차](../docs/reports/README.md), 발표 자료는 [발표 목차](../docs/presentations/README.md)에서 확인한다.

## 버전 관리 범위

- 포함: 팀 작성 Markdown, 분석 Python 코드, 검증 요약·평가 지표·실험 설정·예측 비교, 팀 작성 발표 파일과 제출용 PDF.
- 제외: 학습 번들·결과 ZIP·체크포인트, AI Hub 원천 이미지·라벨과 상세 라벨 복제, 제공 문서 원문·다운로드 페이지, 임시 복제본·실행 로그.
- 원천 라벨에서 파생한 상세 매핑과 분할 후보 CSV, 실제 manifest는 로컬에 보존한다. 보고서에 기재된 해시·집계와 생성 코드로 실험 조건을 추적한다.
- 제외된 원본을 참조하는 링크는 로컬 자료가 있어야 열린다. 보고서의 주요 지표는 본문에도 기록하였다.

## 기록 해석

- `backend_review_20260923/probe.py` 및 `evidence.json`은 수정 전 결함의 재현 기록이다. 현재 회귀 검증은 `backend/tests/`를 사용한다.
- 학습 데이터 후보 4,246장과 중복 제거 후 실제 번들 4,235장을 구분한다. 실제 학습은 train 2,728 / val 785 / test 722이다.
- PDF·발표 파일은 생성 당시 스냅샷이다. 이후 수정이 있는 경우 Markdown 원본과 최신 검증 기록을 기준으로 한다.
- CNN 검증 정확도, 연결 테스트, LLM 학습 계획은 서로 다른 검증 범위이다. 카메라 통합 테스트를 현장 정확도나 LLM 학습 성과로 해석하지 않는다.

## 주요 문서

- [전체 작업 보고서](../docs/reports/week04_20260921-20260927/project_work_report_20260924.md)
- [카메라 통합 검증](https://github.com/hs-cropy/Cropy/blob/77fafcad5a69a9a094c304a44db61596bfd73207/output/camera_integration_20260928.md)
- [224 기준선](colab/group_baseline_analysis_20260922/report.md)
- [256 대조 실험](colab/group256_analysis_20260924/report.md)
- [제출 보고서](../docs/reports/README.md)
