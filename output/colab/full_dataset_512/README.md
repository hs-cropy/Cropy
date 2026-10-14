# 전체 데이터 Colab 업로드 묶음

1. Google Drive에서 `MyDrive/cropy_full_512` 폴더를 만듭니다.
2. 이 폴더의 `cropy_full_512.zip`과 `training_code.zip`을 그곳에 업로드합니다.
3. `cropy_full_colab.ipynb`를 Colab에서 열고 GPU 런타임을 선택합니다.
4. 위에서부터 셀을 실행합니다. 학습 결과는 Drive의 `cropy_runs/full512_resnet50_v1`에 저장됩니다.

데이터 ZIP 크기: **3.73GB**. 이미지 **36,583장**(학습 32,513 / 검증 4,070)과 원본 JSON 라벨을 포함합니다.

이미지는 원본의 긴 변을 최대 512px로 줄인 JPEG 품질 95 사본입니다. 파일 수·공식 분할은 유지하지만 원본 해상도 학습과는 구분해야 합니다. 원본은 로컬에 보존돼 있습니다. 박스 좌표는 원본 크기 기준이므로 이 묶음은 분류용입니다.

ResNet50, 학습 입력 256px, batch 16, 20 epoch, 클래스 균형 샘플링을 기본값으로 사용합니다. ImageNet 가중치에서 시작하며 기존 Cropy 모델은 사용하지 않습니다. 최적 모델 선택 지표는 Validation Macro F1입니다. 별도의 최종 test는 없습니다.

매 epoch 마지막 체크포인트를 저장합니다. 연결이 끊기면 같은 설정·RUN 경로로 다시 실행해 마지막 완료 epoch부터 재개합니다. 실제 Colab GPU 실행은 사용자가 진행하며, 로컬에서는 소규모 CPU 학습·중단·재개와 체크포인트를 검증했습니다.

- [노트북](cropy_full_colab.ipynb)
- [데이터 묶음](cropy_full_512.zip)
- [학습 코드 묶음](training_code.zip)
- [데이터 검증 요약](package_summary.json)

SHA-256: `52dea0080285d76b6cbc09c2659c052a18f20ef620d05bca462203e64e6872ee`
