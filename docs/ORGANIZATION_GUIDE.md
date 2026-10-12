# 문서 분류·작성 규칙

## 카테고리 기준

- 기획·협업·백로그 → `project/`; 제품 요구사항·기능 → `product/`
- 화면·시나리오 → `design/`; 구조·DB → `architecture/`; API 계약 → `api/`
- 모델·데이터 계획 → `ml/`; 실제 운영·배포 → `operations/`; 하드웨어·연동 → `device/`
- 인큐박스 문서 → `incubox/`; 발표 자료 → `presentations/`
- 제출 양식 → `templates/`; 외부 수업 참고 자료 → `references/`
- 날짜가 있는 주간보고·작업보고·제출본 → `reports/`의 해당 주차 폴더

## 주차 계산

`주차 = ((기준 날짜 - 2026-08-31)의 일수 // 7) + 1`이다. 주간 기간은 월요일 00:00~일요일 23:59다. 6주차는 2026-10-05~2026-10-11, 7주차는 2026-10-12~2026-10-18이다. 전체 학기 주차는 [주차 목차](reports/README.md)에서 확인한다.

보고 대상 기간이 한 주면 해당 주차에 보관한다. 여러 주를 묶은 기존 보고서는 작성·제출 주차에 보관하고, 본문에 보고 대상 기간을 표기한 뒤 다른 관련 주차 목차에서 연결한다. 실적 날짜를 파일명이나 수정 시간으로 추정해 새 성과를 만들어내지 않는다.

## 원문과 파일 보존

- PDF·HWP·PPTX 등 제출본은 내용과 파일 해시를 유지한다.
- 옛 주차 표기를 담은 원문에는 새 주차 기준 안내를 추가하고, 실제 보고 기간·실적·실험 수치는 유지한다.
- 외부 원본과 대용량 모델·데이터는 계속 로컬 또는 기존 원본 위치에서 관리한다.
- 실험 증빙은 CSV·JSON·코드와 같은 원본 폴더에 두고 목차로 연결한다.
- 중복 원본 양식은 `templates/course/legacy/`에 보존한다.

## 새 문서를 추가할 때

1. 목적에 맞는 카테고리 또는 주차를 선택한다.
2. 날짜가 있는 보고서는 `주간보고_YYYYMMDD.md` 또는 주제를 포함한 이름을 쓴다.
3. 제목, 작성일, 보고 대상 기간, 작성자를 적고 해당 폴더 README에 링크를 추가한다.
4. Markdown과 PDF/HWP는 같은 주제와 날짜로 묶고, 문서 링크는 상대 경로로 쓴다. 다른 기능 브랜치에만 있는 증빙은 검증한 커밋의 GitHub 링크로 연결하고, 미추적 자료는 별도 보관 경로로 표시한다.
5. 파일을 이동하면 참조 링크와 카테고리·주차 목차도 함께 수정한다.

<details>
<summary>이번 정리의 이전 경로 → 새 경로</summary>

| 이전 경로 | 새 경로 |
| --- | --- |
| `[N+3팀(크래파스)]+산학협력프로젝트 교과목 수행계획서.hwp` | docs/references/course/planning/N+3팀(크래파스)+산학협력프로젝트 교과목 수행계획서.hwp (로컬 보관: `docs/references/course/planning/[N+3팀(크래파스)]+산학협력프로젝트 교과목 수행계획서.hwp`) |
| `[N+3팀(크래파스)]+산학협력프로젝트 교과목 수행계획서.pdf` | docs/references/course/planning/N+3팀(크래파스)+산학협력프로젝트 교과목 수행계획서.pdf (로컬 보관: `docs/references/course/planning/[N+3팀(크래파스)]+산학협력프로젝트 교과목 수행계획서.pdf`) |
| `docs/API_SPEC.md` | [docs/api/API_SPEC.md](api/API_SPEC.md) |
| `docs/ARCHITECTURE.md` | [docs/architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) |
| `docs/BACKEND_OPERATIONS.md` | [docs/operations/BACKEND_OPERATIONS.md](operations/BACKEND_OPERATIONS.md) |
| `docs/BACKLOG.md` | [docs/project/BACKLOG.md](project/BACKLOG.md) |
| `docs/DATABASE.md` | [docs/architecture/DATABASE.md](architecture/DATABASE.md) |
| `docs/DEVICE_HARDWARE.md` | [docs/device/DEVICE_HARDWARE.md](device/DEVICE_HARDWARE.md) |
| `docs/INCUBOX_API_SPEC.md` | [docs/incubox/INCUBOX_API_SPEC.md](incubox/INCUBOX_API_SPEC.md) |
| `docs/INCUBOX_DATABASE.md` | [docs/incubox/INCUBOX_DATABASE.md](incubox/INCUBOX_DATABASE.md) |
| `docs/INCUBOX_FIRMWARE.md` | [docs/incubox/INCUBOX_FIRMWARE.md](incubox/INCUBOX_FIRMWARE.md) |
| `docs/INCUBOX_HARDWARE.md` | [docs/incubox/INCUBOX_HARDWARE.md](incubox/INCUBOX_HARDWARE.md) |
| `docs/INCUBOX_INVENTION.md` | [docs/incubox/INCUBOX_INVENTION.md](incubox/INCUBOX_INVENTION.md) |
| `docs/INCUBOX_PIPELINE.md` | [docs/incubox/INCUBOX_PIPELINE.md](incubox/INCUBOX_PIPELINE.md) |
| `docs/INCUBOX_PLAN.md` | [docs/incubox/INCUBOX_PLAN.md](incubox/INCUBOX_PLAN.md) |
| `docs/INCUBOX_PROTOCOL.md` | [docs/incubox/INCUBOX_PROTOCOL.md](incubox/INCUBOX_PROTOCOL.md) |
| `docs/INCUBOX_UI_SPEC.md` | [docs/incubox/INCUBOX_UI_SPEC.md](incubox/INCUBOX_UI_SPEC.md) |
| `docs/INCUBOX_VALIDATION.md` | [docs/incubox/INCUBOX_VALIDATION.md](incubox/INCUBOX_VALIDATION.md) |
| `docs/LLM_FINETUNING_PLAN.md` | [docs/ml/LLM_FINETUNING_PLAN.md](ml/LLM_FINETUNING_PLAN.md) |
| `docs/MODEL_SPEC.md` | [docs/ml/MODEL_SPEC.md](ml/MODEL_SPEC.md) |
| `docs/OFFLINE_WEB.md` | [docs/operations/OFFLINE_WEB.md](operations/OFFLINE_WEB.md) |
| `docs/OFFLINE_WEB.pdf` | [docs/operations/OFFLINE_WEB.pdf](operations/OFFLINE_WEB.pdf) |
| `docs/ORANGEPI5_DEPLOY.md` | [docs/operations/ORANGEPI5_DEPLOY.md](operations/ORANGEPI5_DEPLOY.md) |
| `docs/ORANGEPI5_MIGRATION_BACKLOG.md` | [docs/operations/ORANGEPI5_MIGRATION_BACKLOG.md](operations/ORANGEPI5_MIGRATION_BACKLOG.md) |
| `docs/PRD.md` | [docs/product/PRD.md](product/PRD.md) |
| `docs/QUANTIZATION.md` | [docs/ml/QUANTIZATION.md](ml/QUANTIZATION.md) |
| `docs/QWEN35_DATASET_SHEET_PLAN.md` | [docs/ml/QWEN35_DATASET_SHEET_PLAN.md](ml/QWEN35_DATASET_SHEET_PLAN.md) |
| `docs/STITCH_PROMPTS.md` | [docs/design/STITCH_PROMPTS.md](design/STITCH_PROMPTS.md) |
| `docs/SUDA_INTEGRATION.md` | [docs/device/SUDA_INTEGRATION.md](device/SUDA_INTEGRATION.md) |
| `docs/TECH_STACK.md` | [docs/architecture/TECH_STACK.md](architecture/TECH_STACK.md) |
| `docs/superpowers/plans/2026-10-08-backend-design-contracts.md` | [docs/project/implementation-plans/2026-10-08-backend-design-contracts.md](project/implementation-plans/2026-10-08-backend-design-contracts.md) |
| `docs/templates/19. 클라우드 프로그램 사용계획서.hwp` | docs/templates/course/19. 클라우드 프로그램 사용계획서.hwp (로컬 보관: `docs/templates/course/19. 클라우드 프로그램 사용계획서.hwp`) |
| `docs/templates/[붙임 5.] 모바일시스템응용프로젝트 주차별 주간보고 양식.hwp` | [docs/templates/course/붙임 5. 모바일시스템응용프로젝트 주차별 주간보고 양식.hwp](templates/course/%5B%EB%B6%99%EC%9E%84%205.%5D%20%EB%AA%A8%EB%B0%94%EC%9D%BC%EC%8B%9C%EC%8A%A4%ED%85%9C%EC%9D%91%EC%9A%A9%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EC%A3%BC%EC%B0%A8%EB%B3%84%20%EC%A3%BC%EA%B0%84%EB%B3%B4%EA%B3%A0%20%EC%96%91%EC%8B%9D.hwp) |
| `docs/templates/incubox_record_sheet.md` | [docs/templates/incubox/incubox_record_sheet.md](templates/incubox/incubox_record_sheet.md) |
| `docs/xpdocs/01_시나리오_스케치.md` | [docs/design/01_시나리오_스케치.md](design/01_%EC%8B%9C%EB%82%98%EB%A6%AC%EC%98%A4_%EC%8A%A4%EC%BC%80%EC%B9%98.md) |
| `docs/xpdocs/02_스토리보드.md` | [docs/design/02_스토리보드.md](design/02_%EC%8A%A4%ED%86%A0%EB%A6%AC%EB%B3%B4%EB%93%9C.md) |
| `docs/xpdocs/03_프로젝트_기획서_초안.md` | [docs/project/03_프로젝트_기획서_초안.md](project/03_%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8_%EA%B8%B0%ED%9A%8D%EC%84%9C_%EC%B4%88%EC%95%88.md) |
| `docs/xpdocs/04_디자인_시스템.md` | [docs/design/04_디자인_시스템.md](design/04_%EB%94%94%EC%9E%90%EC%9D%B8_%EC%8B%9C%EC%8A%A4%ED%85%9C.md) |
| `docs/xpdocs/05_주간보고_02주차.md` | [docs/reports/week03_20260914-20260920/주간보고_20260914_원자료.md](reports/week03_20260914-20260920/%EC%A3%BC%EA%B0%84%EB%B3%B4%EA%B3%A0_20260914_%EC%9B%90%EC%9E%90%EB%A3%8C.md) |
| `docs/xpdocs/06_웹앱_기능명세서.md` | [docs/product/06_웹앱_기능명세서.md](product/06_%EC%9B%B9%EC%95%B1_%EA%B8%B0%EB%8A%A5%EB%AA%85%EC%84%B8%EC%84%9C.md) |
| `docs/xpdocs/07_ERD.md` | [docs/architecture/07_ERD.md](architecture/07_ERD.md) |
| `docs/xpdocs/08_스프린트_백로그.md` | [docs/project/08_스프린트_백로그.md](project/08_%EC%8A%A4%ED%94%84%EB%A6%B0%ED%8A%B8_%EB%B0%B1%EB%A1%9C%EA%B7%B8.md) |
| `docs/xpdocs/09_2주차_파트별_작업계획.md` | [docs/project/planning/파트별_작업계획_20260908-20260914.md](project/planning/%ED%8C%8C%ED%8A%B8%EB%B3%84_%EC%9E%91%EC%97%85%EA%B3%84%ED%9A%8D_20260908-20260914.md) |
| `docs/xpdocs/10_팀_프로젝트_규칙.md` | [docs/project/10_팀_프로젝트_규칙.md](project/10_%ED%8C%80_%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8_%EA%B7%9C%EC%B9%99.md) |
| `docs/xpdocs/11_기획_발표_대본.md` | [docs/presentations/planning/11_기획_발표_대본.md](presentations/planning/11_%EA%B8%B0%ED%9A%8D_%EB%B0%9C%ED%91%9C_%EB%8C%80%EB%B3%B8.md) |
| `docs/xpdocs/12_프로젝트_개요_양식.md` | [docs/project/12_프로젝트_개요_양식.md](project/12_%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8_%EA%B0%9C%EC%9A%94_%EC%96%91%EC%8B%9D.md) |
| `docs/xpdocs/13_스프린트_로그_백로그_최신현황_20260928.md` | [docs/reports/week05_20260928-20261004/13_스프린트_로그_백로그_최신현황_20260928.md](reports/week05_20260928-20261004/13_%EC%8A%A4%ED%94%84%EB%A6%B0%ED%8A%B8_%EB%A1%9C%EA%B7%B8_%EB%B0%B1%EB%A1%9C%EA%B7%B8_%EC%B5%9C%EC%8B%A0%ED%98%84%ED%99%A9_20260928.md) |
| `docs/xpdocs/14_기능별_이슈_PR_재구성_20260928.md` | [docs/reports/week05_20260928-20261004/14_기능별_이슈_PR_재구성_20260928.md](reports/week05_20260928-20261004/14_%EA%B8%B0%EB%8A%A5%EB%B3%84_%EC%9D%B4%EC%8A%88_PR_%EC%9E%AC%EA%B5%AC%EC%84%B1_20260928.md) |
| `docs/xpdocs/15_기능별_브랜치_커밋_정리_20261008.md` | [docs/reports/week06_20261005-20261011/15_기능별_브랜치_커밋_정리_20261008.md](reports/week06_20261005-20261011/15_%EA%B8%B0%EB%8A%A5%EB%B3%84_%EB%B8%8C%EB%9E%9C%EC%B9%98_%EC%BB%A4%EB%B0%8B_%EC%A0%95%EB%A6%AC_20261008.md) |
| `docs/xpdocs/16_이슈_PR_게시_20261009.md` | [docs/reports/week06_20261005-20261011/16_이슈_PR_게시_20261009.md](reports/week06_20261005-20261011/16_%EC%9D%B4%EC%8A%88_PR_%EA%B2%8C%EC%8B%9C_20261009.md) |
| `docs/xpdocs/[N]3팀(크래파스)13_스프린트_로그_백로그_최신현황_20260928.pdf` | [docs/reports/week05_20260928-20261004/N3팀(크래파스)13_스프린트_로그_백로그_최신현황_20260928.pdf](reports/week05_20260928-20261004/%5BN%5D3%ED%8C%80%28%ED%81%AC%EB%9E%98%ED%8C%8C%EC%8A%A4%2913_%EC%8A%A4%ED%94%84%EB%A6%B0%ED%8A%B8_%EB%A1%9C%EA%B7%B8_%EB%B0%B1%EB%A1%9C%EA%B7%B8_%EC%B5%9C%EC%8B%A0%ED%98%84%ED%99%A9_20260928.pdf) |
| `docs/xpdocs/[붙임 1.] 산학협력프로젝트 교과목 수행계획서 (1).hwp` | [docs/templates/course/legacy/붙임 1. 산학협력프로젝트 교과목 수행계획서 (1).hwp](templates/course/legacy/%5B%EB%B6%99%EC%9E%84%201.%5D%20%EC%82%B0%ED%95%99%ED%98%91%EB%A0%A5%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EA%B5%90%EA%B3%BC%EB%AA%A9%20%EC%88%98%ED%96%89%EA%B3%84%ED%9A%8D%EC%84%9C%20%281%29.hwp) |
| `docs/xpdocs/[붙임 5.] 모바일시스템응용프로젝트 주차별 주간보고 양식.hwp` | [docs/templates/course/legacy/붙임 5. 모바일시스템응용프로젝트 주차별 주간보고 양식.hwp](templates/course/legacy/%5B%EB%B6%99%EC%9E%84%205.%5D%20%EB%AA%A8%EB%B0%94%EC%9D%BC%EC%8B%9C%EC%8A%A4%ED%85%9C%EC%9D%91%EC%9A%A9%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EC%A3%BC%EC%B0%A8%EB%B3%84%20%EC%A3%BC%EA%B0%84%EB%B3%B4%EA%B3%A0%20%EC%96%91%EC%8B%9D.hwp) |
| `output/[N]3팀(크래파스)20260924cnn모델결과보고서.pdf` | [docs/reports/week04_20260921-20260927/N3팀(크래파스)20260924cnn모델결과보고서.pdf](reports/week04_20260921-20260927/%5BN%5D3%ED%8C%80%28%ED%81%AC%EB%9E%98%ED%8C%8C%EC%8A%A4%2920260924cnn%EB%AA%A8%EB%8D%B8%EA%B2%B0%EA%B3%BC%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf) |
| `output/[N]3팀(크래파스)3주차 주간 보고서 (1).pdf` | [docs/reports/week05_20260928-20261004/N3팀(크래파스)3주차 주간 보고서 (1).pdf](reports/week05_20260928-20261004/%5BN%5D3%ED%8C%80%28%ED%81%AC%EB%9E%98%ED%8C%8C%EC%8A%A4%293%EC%A3%BC%EC%B0%A8%20%EC%A3%BC%EA%B0%84%20%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf) |
| `output/[N]3팀(크래파스)4주차 주간 보고서 (1).pdf` | [docs/reports/week05_20260928-20261004/N3팀(크래파스)4주차 주간 보고서 (1).pdf](reports/week05_20260928-20261004/%5BN%5D3%ED%8C%80%28%ED%81%AC%EB%9E%98%ED%8C%8C%EC%8A%A4%294%EC%A3%BC%EC%B0%A8%20%EC%A3%BC%EA%B0%84%20%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf) |
| `output/presentations/cropy_10min.pdf` | [docs/presentations/archive/cropy_10min.pdf](presentations/archive/cropy_10min.pdf) |
| `output/presentations/cropy_10min.pptx` | [docs/presentations/archive/cropy_10min.pptx](presentations/archive/cropy_10min.pptx) |
| `output/presentations/cropy_발표대본.md` | [docs/presentations/archive/cropy_발표대본.md](presentations/archive/cropy_%EB%B0%9C%ED%91%9C%EB%8C%80%EB%B3%B8.md) |
| `output/presentations/cropy_발표대본.pdf` | [docs/presentations/archive/cropy_발표대본.pdf](presentations/archive/cropy_%EB%B0%9C%ED%91%9C%EB%8C%80%EB%B3%B8.pdf) |
| `output/project_work_report_20260924.md` | [docs/reports/week04_20260921-20260927/project_work_report_20260924.md](reports/week04_20260921-20260927/project_work_report_20260924.md) |
| `presentation/01_수행계획서.md` | [docs/presentations/week05_20260928-20261004/01_수행계획서.md](presentations/week05_20260928-20261004/01_%EC%88%98%ED%96%89%EA%B3%84%ED%9A%8D%EC%84%9C.md) |
| `presentation/02_주간보고서.md` | [docs/reports/week05_20260928-20261004/주간보고_20261001_진행현황.md](reports/week05_20260928-20261004/%EC%A3%BC%EA%B0%84%EB%B3%B4%EA%B3%A0_20261001_%EC%A7%84%ED%96%89%ED%98%84%ED%99%A9.md) |
| `presentation/03_발표흐름과대본.md` | [docs/presentations/week05_20260928-20261004/03_발표흐름과대본.md](presentations/week05_20260928-20261004/03_%EB%B0%9C%ED%91%9C%ED%9D%90%EB%A6%84%EA%B3%BC%EB%8C%80%EB%B3%B8.md) |
| `presentation/04_3·4주차_발표대본_8분.md` | [docs/presentations/week05_20260928-20261004/04_발표대본_8분.md](presentations/week05_20260928-20261004/04_%EB%B0%9C%ED%91%9C%EB%8C%80%EB%B3%B8_8%EB%B6%84.md) |
| `presentation/04_3·4주차_발표대본_8분.pdf` | [docs/presentations/week05_20260928-20261004/04_발표대본_8분.pdf](presentations/week05_20260928-20261004/04_%EB%B0%9C%ED%91%9C%EB%8C%80%EB%B3%B8_8%EB%B6%84.pdf) |
| `presentation/05_3·4주차_발표대본_5분.md` | [docs/presentations/week05_20260928-20261004/05_발표대본_5분.md](presentations/week05_20260928-20261004/05_%EB%B0%9C%ED%91%9C%EB%8C%80%EB%B3%B8_5%EB%B6%84.md) |
| `presentation/05_3·4주차_발표대본_5분.pdf` | [docs/presentations/week05_20260928-20261004/05_발표대본_5분.pdf](presentations/week05_20260928-20261004/05_%EB%B0%9C%ED%91%9C%EB%8C%80%EB%B3%B8_5%EB%B6%84.pdf) |
| `report/7주차 - 02. 모바일시스템응용프로젝트 개발 문서 가이드 V1.0.hwp` | docs/references/course/7주차 - 02. 모바일시스템응용프로젝트 개발 문서 가이드 V1.0.hwp (로컬 보관: `docs/references/course/7주차 - 02. 모바일시스템응용프로젝트 개발 문서 가이드 V1.0.hwp`) |
| `report/7주차 - 02. 모바일시스템응용프로젝트 개발 문서 가이드 V1.0.pdf` | docs/references/course/7주차 - 02. 모바일시스템응용프로젝트 개발 문서 가이드 V1.0.pdf (로컬 보관: `docs/references/course/7주차 - 02. 모바일시스템응용프로젝트 개발 문서 가이드 V1.0.pdf`) |
| `report/AI_모델_개선_보고서_20261006.md` | [docs/reports/week06_20261005-20261011/AI_모델_개선_보고서_20261006.md](reports/week06_20261005-20261011/AI_%EB%AA%A8%EB%8D%B8_%EA%B0%9C%EC%84%A0_%EB%B3%B4%EA%B3%A0%EC%84%9C_20261006.md) |
| `report/AI_모델_개선_작업보고서_20261006.md` | [docs/reports/week06_20261005-20261011/AI_모델_개선_작업보고서_20261006.md](reports/week06_20261005-20261011/AI_%EB%AA%A8%EB%8D%B8_%EA%B0%9C%EC%84%A0_%EC%9E%91%EC%97%85%EB%B3%B4%EA%B3%A0%EC%84%9C_20261006.md) |
| `report/Cropy_Figma_백엔드_검토_20261008.md` | [docs/reports/week06_20261005-20261011/Cropy_Figma_백엔드_검토_20261008.md](reports/week06_20261005-20261011/Cropy_Figma_%EB%B0%B1%EC%97%94%EB%93%9C_%EA%B2%80%ED%86%A0_20261008.md) |
| `report/Cropy_UIUX_디자인_주간보고서_20261007.md` | [docs/reports/week06_20261005-20261011/Cropy_UIUX_디자인_주간보고서_20261007.md](reports/week06_20261005-20261011/Cropy_UIUX_%EB%94%94%EC%9E%90%EC%9D%B8_%EC%A3%BC%EA%B0%84%EB%B3%B4%EA%B3%A0%EC%84%9C_20261007.md) |
| `report/Cropy_백엔드_보완_작업보고서_20261008.md` | [docs/reports/week06_20261005-20261011/Cropy_백엔드_보완_작업보고서_20261008.md](reports/week06_20261005-20261011/Cropy_%EB%B0%B1%EC%97%94%EB%93%9C_%EB%B3%B4%EC%99%84_%EC%9E%91%EC%97%85%EB%B3%B4%EA%B3%A0%EC%84%9C_20261008.md) |
| `report/Cropy_백엔드_보완_작업보고서_20261008.pdf` | [docs/reports/week06_20261005-20261011/Cropy_백엔드_보완_작업보고서_20261008.pdf](reports/week06_20261005-20261011/Cropy_%EB%B0%B1%EC%97%94%EB%93%9C_%EB%B3%B4%EC%99%84_%EC%9E%91%EC%97%85%EB%B3%B4%EA%B3%A0%EC%84%9C_20261008.pdf) |
| `report/[N]3팀(크래파스)데이터셋_구축_및_성능_개선_결과_보고서_3주차_4주차.pdf` | [docs/reports/week05_20260928-20261004/N3팀(크래파스)데이터셋_구축_및_성능_개선_결과_보고서_20260928.pdf](reports/week05_20260928-20261004/%5BN%5D3%ED%8C%80%28%ED%81%AC%EB%9E%98%ED%8C%8C%EC%8A%A4%29%EB%8D%B0%EC%9D%B4%ED%84%B0%EC%85%8B_%EA%B5%AC%EC%B6%95_%EB%B0%8F_%EC%84%B1%EB%8A%A5_%EA%B0%9C%EC%84%A0_%EA%B2%B0%EA%B3%BC_%EB%B3%B4%EA%B3%A0%EC%84%9C_20260928.pdf) |
| `report/dependabot_PR검토_및_수정순서_20260929.md` | [docs/reports/week05_20260928-20261004/dependabot_PR검토_및_수정순서_20260929.md](reports/week05_20260928-20261004/dependabot_PR%EA%B2%80%ED%86%A0_%EB%B0%8F_%EC%88%98%EC%A0%95%EC%88%9C%EC%84%9C_20260929.md) |
| `report/dependabot_review_20260929.md` | [docs/reports/week05_20260928-20261004/dependabot_review_20260929.md](reports/week05_20260928-20261004/dependabot_review_20260929.md) |
| `report/데이터셋_구축_및_성능_개선_결과_보고서_3주차_4주차.md` | [docs/reports/week05_20260928-20261004/데이터셋_구축_및_성능_개선_결과_보고서_20260928.md](reports/week05_20260928-20261004/%EB%8D%B0%EC%9D%B4%ED%84%B0%EC%85%8B_%EA%B5%AC%EC%B6%95_%EB%B0%8F_%EC%84%B1%EB%8A%A5_%EA%B0%9C%EC%84%A0_%EA%B2%B0%EA%B3%BC_%EB%B3%B4%EA%B3%A0%EC%84%9C_20260928.md) |
| `report/스프린트_로그_백로그_검토_20260928.md` | [docs/reports/week05_20260928-20261004/스프린트_로그_백로그_검토_20260928.md](reports/week05_20260928-20261004/%EC%8A%A4%ED%94%84%EB%A6%B0%ED%8A%B8_%EB%A1%9C%EA%B7%B8_%EB%B0%B1%EB%A1%9C%EA%B7%B8_%EA%B2%80%ED%86%A0_20260928.md) |
| `report/커밋_정리_20260928.md` | [docs/reports/week05_20260928-20261004/커밋_정리_20260928.md](reports/week05_20260928-20261004/%EC%BB%A4%EB%B0%8B_%EC%A0%95%EB%A6%AC_20260928.md) |
| `report/클라우드 프로그램 사용계획서.hwp` | [docs/project/cloud/클라우드 프로그램 사용계획서.hwp](project/cloud/%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C%20%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8%20%EC%82%AC%EC%9A%A9%EA%B3%84%ED%9A%8D%EC%84%9C.hwp) |
| `report/클라우드 프로그램 사용계획서.pdf` | [docs/project/cloud/클라우드 프로그램 사용계획서.pdf](project/cloud/%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C%20%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8%20%EC%82%AC%EC%9A%A9%EA%B3%84%ED%9A%8D%EC%84%9C.pdf) |
| `report/클라우드_프로그램_사용계획서_Colab_초안.md` | [docs/project/cloud/클라우드_프로그램_사용계획서_Colab_초안.md](project/cloud/%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C_%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8_%EC%82%AC%EC%9A%A9%EA%B3%84%ED%9A%8D%EC%84%9C_Colab_%EC%B4%88%EC%95%88.md) |
| `report/클라우드_프로그램_사용계획서_Colab_초안.pdf` | [docs/project/cloud/클라우드_프로그램_사용계획서_Colab_초안.pdf](project/cloud/%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C_%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8_%EC%82%AC%EC%9A%A9%EA%B3%84%ED%9A%8D%EC%84%9C_Colab_%EC%B4%88%EC%95%88.pdf) |
| `report/팀별_LLM_학습_데이터_문제점_분석_보고서_3주차_4주차.md` | [docs/reports/week05_20260928-20261004/팀별_LLM_학습_데이터_문제점_분석_보고서_20260928.md](reports/week05_20260928-20261004/%ED%8C%80%EB%B3%84_LLM_%ED%95%99%EC%8A%B5_%EB%8D%B0%EC%9D%B4%ED%84%B0_%EB%AC%B8%EC%A0%9C%EC%A0%90_%EB%B6%84%EC%84%9D_%EB%B3%B4%EA%B3%A0%EC%84%9C_20260928.md) |
| `report/프로토타입시연링크.txt` | [docs/design/프로토타입시연링크.txt](design/%ED%94%84%EB%A1%9C%ED%86%A0%ED%83%80%EC%9E%85%EC%8B%9C%EC%97%B0%EB%A7%81%ED%81%AC.txt) |

| `docs/xpdocs/14_카메라_파트_구현_기획.md` | [docs/design/14_카메라_파트_구현_기획.md](design/14_%EC%B9%B4%EB%A9%94%EB%9D%BC_%ED%8C%8C%ED%8A%B8_%EA%B5%AC%ED%98%84_%EA%B8%B0%ED%9A%8D.md) |

| `docs/xpdocs/15_카메라_구현_현황.md` | [docs/design/15_카메라_구현_현황.md](design/15_%EC%B9%B4%EB%A9%94%EB%9D%BC_%EA%B5%AC%ED%98%84_%ED%98%84%ED%99%A9.md) |

| `docs/xpdocs/17_음성안내_TTS_구현_기획.md` | [docs/design/17_음성안내_TTS_구현_기획.md](design/17_%EC%9D%8C%EC%84%B1%EC%95%88%EB%82%B4_TTS_%EA%B5%AC%ED%98%84_%EA%B8%B0%ED%9A%8D.md) |

</details>

## 선행 문서와 병합 순서

이 정리는 #40·#62·#63의 검토와 병합을 먼저 마친 뒤 #66을 병합하는 순서다. 로컬 통합에서는 선행 문서의 최신 내용을 이동 경로에 반영했다. 모델·데이터 증빙 중 #59·#60에 속한 파일의 상대 링크는 해당 PR의 develop 반영을 전제로 한다. 이 파일들은 미추적 로컬 자료와 구분하며, 실제 병합 직전에 최종 트리의 링크를 다시 확인한다.
