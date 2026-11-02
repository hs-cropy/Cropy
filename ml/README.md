# cropy 모델 실험 기록

## 새 그룹 분할 후보 — 2026-09-21

전체 원본 해시 점검과 작업자/작업자+날짜 후보 비교를 완료했다. 작업자안은 train 2,739 / val 785 / test 722이며 모든 클래스가 있고 작업자·동일 해시의 분할 간 중복은 0이다. 동일 바이트를 한 장만 남긴 별도 목록도 생성했다. 후보만 작성했으며 기존 파일 이동·학습은 하지 않았다. 권장안 및 한계: [분할 후보 보고서](../output/colab/group_split_candidates_20260921/report.md).

## 전체 라벨 연결 — 2026-09-21

제공된 TAR 18개 안의 ZIP을 검증하고 JSON 91,041개를 읽었다. 현재 이미지 4,246장 모두 고유 라벨과 연결됐으며 날짜 불일치 2건을 기록했다. 정상 1,500장은 모두 공식 Validation 출처이므로 현재 자료만 공식 분할대로 재배치하면 정상 학습 데이터가 없어지는 제약을 확인했다. [전체 라벨 연결 보고서](../output/colab/full_label_audit_20260921/report.md).

## 제공 설명서 확인 — 2026-09-21

가이드라인 PDF 6쪽의 도식에서 날짜 앞 코드는 수집 작업자 ID, S01 위치는 동일 객체 촬영 순서임을 확인했다. 작업자+날짜를 개체 ID로 단정하지 않는다. 실제 파일의 추가 접미사 및 증강본 매핑은 미확인이고 전체 라벨은 아직 확보 전이다. [문서 확인 결과](../output/colab/aihub_research_20260921/document_findings.md).

## AI Hub 공식 조사 — 2026-09-21

공식 dataSetSn=147 페이지와 파일 목록에서 고추·무·배추 Training/Validation 라벨 18개를 식별했다. 원본 외 증강 이미지가 포함되므로 파생 관계 확인도 분할 조건에 추가한다. 날짜 앞 코드·S01의 의미와 설명서 본문은 미확인, 라벨 다운로드는 미완료다. [공식 조사 보고서](../output/colab/aihub_research_20260921/report.md), [라벨 파일키 목록](../output/colab/aihub_research_20260921/required_labels.csv).

## 원천 메타데이터 조사 — 2026-09-18

라벨 JSON 360개 중 현재 데이터셋에 연결되는 이미지가 128/4,246장임을 확인했다. worker는 전부 비어 있고 개체·농장·세션 ID의 명시적 정의는 없다. 날짜 앞 파일명 코드의 의미를 로컬 자료만으로 확정할 수 없어 새 그룹 분할은 아직 적용하지 않았다. [메타데이터 조사 보고서](../output/colab/metadata_audit_20260918/report.md) 참조.

## 분할 독립성 점검 — 2026-09-18

train↔val 동일 이미지 2쌍, train↔test 4쌍을 발견했고 원본 SHA256 일치까지 확인했다. 현재 val/test를 완전히 독립된 일반화 성능으로 해석하지 않는다. 기존 자료는 보존하고, 촬영 그룹 의미 확인 및 새 분할 설계를 해상도 실험의 선행 작업으로 둔다. [점검 보고서](../output/colab/split_audit_20260918/report.md), [점검 코드](audit_dataset_split.py).

## 후속 검증 — 원본·축소 이미지 비교 (2026-09-18)

동일 val 637장을 같은 체크포인트·224 전처리·로컬 CPU에서 비교했다. 원본은 **94.66%(603/637)**, 축소본은 **96.23%(613/637)**로, 이번 조건에서는 원본 사용이 개선으로 이어지지 않았다. 축소본 예측은 이전 Colab 결과와 637장 모두 일치했다. 기존 모델·서비스 전처리를 유지한다. 재학습과 test 평가는 하지 않았다.

상세 수치·해석·재현 방법: [원본·축소 비교 보고서](../output/colab/val_source_comparison_20260918/report.md). 실행 코드: [compare_val_sources.py](compare_val_sources.py).

모델 구조·클래스 정의는 [모델 명세](../docs/MODEL_SPEC.md), 보드 이전은 [이전 백로그](../docs/ORANGEPI5_MIGRATION_BACKLOG.md)를 따른다.

## 3주차 Colab CNN 실험 — 2026-09-18 결과 확인

**결론: 일반·균형 샘플링 이어학습 모두 시작 모델의 전체 val 정확도를 넘지 못해 기존 모델을 유지했다.** 새 체크포인트 저장 및 배포 모델 교체는 없다.

- 실행 노트북: [cropy_week3.ipynb](cropy_week3.ipynb)
- 결과 원본: [cropy_week3_results.zip](../output/colab/cropy_week3_results.zip)
- 실행 폴더 기록: `cropy_20260917_153350_081310`, 학습 로그: `training_153932_043541/`. 폴더 시각의 시간대는 기록되지 않아 한국 시각의 실행일로 단정하지 않는다.
- 결과 확인일: 2026-09-18, 담당: 김헌영(PM·모델).

### 환경과 데이터

| 항목 | 실제 기록 |
|---|---|
| 환경 | Colab / Tesla T4 / PyTorch 2.11.0+cu128 / torchvision 0.26.0+cu128 |
| 모델 | ResNet50, 9클래스 |
| 입력 | RGB 224×224, ImageNet 정규화, TTA 없음 |
| 해상도 결정 | 기존 체크포인트에 img_size가 없어 서비스와 동일하게 224 적용 |
| 데이터 | 기존 Colab 번들의 축소·JPEG 재인코딩 이미지, train 2,972 / val 637 / test 637 |
| 이번 평가 | val만 사용. 결과 ZIP에 test 평가 산출물 없음 |
| 이어학습 | 동일 시작 모델, seed 42, 각 12 epoch, batch 32, lr 2e-5 |
| 변경 변수 | 일반 샘플링(control) / 역빈도 균형 샘플링(balanced) |
| 저장 조건 | 시작 모델의 전체 val 정확도를 엄격하게 초과한 경우에만 저장 |

체크포인트 SHA256:
`b0b0b4a24af1430778a2bc15ede5cc068e200539dfeb7fc5ced02574a63d4b8b`

입력 번들 SHA256:
`46d1ec14e16984b9557f659f2b92bcfbb8d612cabd10ecad3bff34c6a6abd162`

결과의 해시를 현재 로컬 체크포인트 및 입력 ZIP과 대조해 일치를 확인했다. 예측 CSV에서 혼동행렬과 정확도를 다시 계산해 평가 JSON과 일치함을 확인했다.

### 기준 모델 val 결과

| 클래스 | 정답 / 평가 수 | 클래스별 정확도 |
|---|---:|---:|
| 고추탄저병 | 73 / 75 | 97.33% |
| 고추흰가루병 | 73 / 75 | 97.33% |
| 무검은무늬병 | 71 / 75 | 94.67% |
| 무노균병 | 28 / 38 | 73.68% |
| 배추검은썩음병 | 74 / 75 | 98.67% |
| 배추노균병 | 70 / 74 | 94.59% |
| 고추정상 | 74 / 75 | 98.67% |
| 무정상 | 75 / 75 | 100.00% |
| 배추정상 | 75 / 75 | 100.00% |
| **전체** | **613 / 637** | **96.23%** |

총 오류 24건 중 무 두 병해 간 혼동은 13건(54.17%)이다. 무검은무늬병→무노균병 4건, 역방향 9건이며, 무노균병→고추정상 1건을 포함하면 실제 무 병해 이미지의 오류는 14건이다.

오류 메모에는 촬영 거리·잎 방향·조명·배경 차이, 축소 화면에서 병징 확인이 어려운 사례, 높은 분류 점수의 오분류를 기록했다. 라벨 오류나 데이터 불균형이 원인이라고 확정하지 않았다.

### 이어학습 로그와 채택 결과

| 실험 | 이어학습 epoch 중 최고 전체 val (로그 반올림 값) | 마지막 epoch 전체 val | 새 모델 저장 | 채택 |
|---|---:|---:|---|---|
| 일반 샘플링 | 96.2% (epoch 1) | 95.9% | 없음 | 기존 baseline |
| 균형 샘플링 | 96.1% (epoch 1, 12) | 96.1% | 없음 | 기존 baseline |

균형 샘플링 epoch 3에서 무노균병은 약 84%로 상승했으나 무검은무늬병은 약 84%, 전체는 95.9%였다. 특정 클래스 개선이 전체 성능 개선으로 이어지지 않았다. 클래스별 로그는 정수 반올림 값이며 저장되지 않은 epoch의 정밀 평가 결과로 취급하지 않는다.

`comparison_val.csv`의 baseline/control/balanced는 정확도와 체크포인트 해시가 모두 같다. 이는 **새 후보가 저장되지 않아 같은 baseline을 세 번 평가한 결과**다. 서로 다른 학습 모델의 성능이 같다는 증거가 아니다. 로그 마지막 `Best val accuracy: 96.2%`에도 시작 모델 성능이 포함된다.

### 한계와 다음 작업

- 이번 수치는 축소 번들의 val 결과이며, MODEL_SPEC의 원본 데이터 평가·test 정확도와 직접 비교하지 않는다.
- 단일 seed·한 가지 학습 조건이다. 균형 샘플링 일반의 효과나 무효를 단정하지 않는다.
- 전체 val 정확도만으로 저장했으므로 클래스별 절충이 다른 후보는 보존되지 않았다. 추가 실험이 필요하면 평가·저장 기준을 사전에 정한다.
- 보드 CPU 지연·메모리·온도, RKLLM 변환, Qwen 및 음성 통합은 이번 실험으로 검증되지 않았다.
- 이번 CNN 실험은 종료하고 baseline을 유지한다. 다음은 모델 전달 규격 정리와 Qwen 기본 모델 평가 세트 준비다. 보드 미수령 중에는 보드 검증을 대기로 남긴다.

### 주간보고 기재용

> Colab에서 ResNet50 기준 모델의 축소 이미지 val 637장을 평가해 정확도 96.23%(613장 정답)를 확인했다. 무 병해 오류 14건을 분석하고 동일 시작 모델·해상도·학습 조건에서 일반 및 균형 샘플링 이어학습을 각 12 epoch 수행했다. 두 실험 모두 기준 모델의 전체 val 정확도를 넘지 못해 기존 모델을 유지했다. 평가표·혼동행렬·예측 CSV·학습 로그와 환경 정보를 보관했다. test 평가와 보드 성능 검증은 수행하지 않았다.

## 작업자 분리 Colab 기준선 준비 (2026-09-21)

- `cropy_group_baseline.ipynb`와 `train_group_baseline.py`, `pack_group_baseline.py`를 추가했다.
- `worker_unique_candidate.csv` 기준 원본 4,235장(train 2,728 / val 785 / test 722)을 별도 ZIP으로 묶었다. 기존 dataset 및 cropy 체크포인트는 보존한다.
- ImageNet V2 초기화 ResNet50 / 224 / seed 42 / 20 epoch / 일반 샘플링으로 새 기준선을 만든다. 기존 cropy 모델 이어학습은 사용하지 않는다.
- epoch별 전체 정확도, 클래스별 재현율, macro F1을 기록한다. 최고 val 정확도로 모델을 선택하며 test는 기본 비활성화한다.
- 실행 안내: `output/colab/group_baseline_20260921/실행안내.md`.
- 상태: 실행 준비. Colab 학습 및 새 성능 측정은 아직 수행하지 않았다. 과거 val 96.23%와 직접 비교하지 않는다.

## 작업자 분리 기준선 학습 결과 (2026-09-22)

- Colab T4에서 ImageNet V2 ResNet50 / 224 / seed 42 / 20 epoch 완료. 최고 모델 epoch 20.
- val 721/785 = 91.85%, macro F1 0.9035. 무노균병 재현율 69.39%, 배추노균병 76.47%, 무검은무늬병 81.61%.
- 무 병해 상호 혼동 28건, 배추노균병을 정상으로 예측 14건. test는 이번 분석에서도 사용하지 않았으며 서비스 모델은 교체하지 않았다.
- 결과 ZIP 지표·예측·분할·체크포인트 메타데이터의 정합성을 검증했다. 전체 재추론은 수행하지 않았다.
- 상세: `output/colab/group_baseline_analysis_20260922/report.md`. 과거 val 96.23%와 직접 비교하지 않는다.

## 주요 오류 사진 검토 (2026-09-22)

- 무 병해 혼동 28장과 배추노균병→정상 14장, 총 42장의 미리보기 및 라벨 메타데이터를 검토했다.
- 42장 라벨 클래스 코드 일치. 6장 라벨 치수 0/0을 발견했으나 실제 이미지는 정상이며 현재 분류 학습은 해당 치수를 사용하지 않는다.
- 작업자별 오류율은 해당 클래스 val 전체를 분모로 계산했다. 무노균병과 배추노균병 val은 각각 작업자 1명이라 작업자 효과를 단정할 수 없다.
- 보고서 및 원본 링크 갤러리: `output/colab/error_review_20260922/report.md`, `index.html`.
- 라벨 수정·새 학습·test 평가는 수행하지 않았다. 다음은 입력 256만 변경하는 대조 실험 준비다.

## 256 입력 비교 실험 준비 (2026-09-22)

- `cropy_group_256.ipynb` 추가. 기존 원본 ZIP 재사용, 최신 실행기 내장, results_256에 별도 저장.
- 학습 스크립트에 `--img-size` 224/256 선택 추가(기본 224). test 전처리는 체크포인트 img_size를 사용한다.
- 같은 ImageNet 초기화/seed/batch/20 epoch에서 256만 변경. 224 기준선 비교표 및 독립 다운로드 셀 포함. test 실행 셀 제외.
- 안내: `output/colab/group_baseline_20260921/256_실행안내.md`. 256 GPU 학습은 아직 수행하지 않았다.

## 전체 데이터 Colab 학습 (2026-10-02)

- 노트북: [cropy_full_colab.ipynb](cropy_full_colab.ipynb). 실행기: [train_full_colab.py](train_full_colab.py).
- 업로드 안내: [전체 데이터 묶음](../output/colab/full_dataset_512/README.md).
- 중복 제거된 공식 Training 32,513장 / Validation 4,070장을 사용한다. 업로드용 이미지는 긴 변 512px 사본이며 원본은 보존한다.
- ResNet50, 입력 256px, 클래스 균형 샘플링, 검증 Macro F1 기준 선택. 기존 Cropy 모델을 사용하지 않고 ImageNet 초기화로 시작한다.
- Drive에 epoch별 마지막 상태를 저장해 이어 학습한다. 별도 최종 test 평가 및 서비스 모델 교체는 수행하지 않는다.

## 256 입력 비교 결과 확인 (2026-09-24)

앞 절의 준비 상태 이후 Colab 실행 결과를 확보했다. 같은 val 785장에서 224는 721장 정답(91.85%), 256은 726장 정답(92.48%)이다. 개선 17건·악화 12건이며 단일 seed의 val 비교다. test 평가 및 서비스 모델 교체는 하지 않았다. [256 분석 보고서](../output/colab/group256_analysis_20260924/report.md)를 참조한다.

## 작업자 분리 시험셋과 기준선 (2026-10-28)

- 공식 Validation 4,070장 중 4,063장이 Training과 같은 작업자·날짜 묶음이라 val 99.6%는 새 촬영자 성능을 말해 주지 않는다.
- `plan_worker_split.py`로 작업자 78명을 통째로 train/val/test에 배정했다. 배정표 `worker_split_v1/workers.json`, 집계 `worker_split_v1/split_summary.json`. 사진별 목록은 `output/colab/worker_testset_20261028/worker_split_v1.csv`(미커밋).
- `cropy_testset_baseline_colab.ipynb`: 재분할 → 서버 모델과 같은 설정으로 8 epoch 학습 → 시험 작업자 사진으로 새 모델·서버 모델 평가. 결과 `worker_split_v1/baseline_v1_test_report.json`, Drive `cropy_testset/baseline_v1/`.
- 기준선(시험 11,434장): 정확도 98.0%, macro F1 0.899, 무검은무늬병 recall 53.8%, 무노균병 74.4%. 무 질병 작업자 정확도 57~63%. 상세와 한계는 [모델 명세](../docs/MODEL_SPEC.md#작업자-분리-시험셋과-기준선-2026-10-28).
- 이후 모델 실험은 이 시험셋으로 판정한다. 서비스 모델은 교체하지 않았다.
- 실험 1(백본 ConvNeXt-Tiny, `cropy_testset_convnext_colab.ipynb` + `train_full_colab_convnext.py`): macro F1 0.905, 무검은무늬병 52.4%, 무노균병 80.8%. 판정 기준(10%p) 미달로 기각. 결과 `worker_split_v1/convnext_v1_test_report.json`, Drive `cropy_testset/convnext_v1/`.
- 실험 2(입력 448px, `cropy_testset_hires448_colab.ipynb`): macro F1 0.917, 무검은무늬병 54.2%, 무노균병 88.5%(+14.1%p). 무노균병만 기준 통과, 채택 후보. 서버 교체 전 전체 데이터 재학습과 추론 시간 측정 필요. 결과 `worker_split_v1/hires448_v1_test_report.json`, Drive `cropy_testset/hires448_v1/`.
- 교체 후보 재학습: `cropy_full448_colab.ipynb`가 서버 모델과 같은 전체 데이터(10클래스)로 448px ResNet50을 학습하고 공식 val로 서버 모델과 비교한다. 백엔드는 체크포인트 `img_size`를 읽으므로 코드 수정 불필요. CPU 추론 256px 78ms → 448px 185ms(배치 1).
- 재학습 결과(2026-11-02): 공식 val 99.68% / Macro F1 0.962, 회귀 없음. 교체 절차 [MODEL_SWAP_448.md](../docs/operations/MODEL_SWAP_448.md). 결과 `worker_split_v1/full448_v1_val_report.json`, 모델 Drive `cropy_testset/cropy_448_handoff_20261102/`.
- 실험 3(무 질병 전용 2단계 분류기, `cropy_testset_pair_colab.ipynb`): 시험셋 무 질병 290장에서 전용 단독은 본 모델과 차이 없음(McNemar p=0.47), 재분배 규칙 적용 시 악화. 기각. 오류는 11월 중순 이후·피해 정도 2~3 검은무늬병에 집중, 학습 데이터에 심한 검은무늬병이 거의 없음 → 데이터 수집이 다음 단계. 결과 `worker_split_v1/pair_v1_test_report.json`.
