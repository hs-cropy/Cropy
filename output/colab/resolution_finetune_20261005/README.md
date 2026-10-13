# 256px / 384px 미세조정 비교

[Colab 노트북 열기](https://colab.research.google.com/drive/1zp83JNRj-g0-Bb4Y6x4Ewl8QmBm16ywq)

기존 최고 모델의 가중치에서 시작해 대조군 256px와 실험군 384px를 각각 5에폭 미세조정한다. 두 실행은 동일한 시작 체크포인트와 학습률 1e-5, batch 16, seed 42, AdamW, cosine 스케줄러, 클래스 균형 샘플링을 사용한다. 크롭·반전·회전·색상 증강, weight decay 1e-4, label smoothing 0.1, FP32도 같다. 옵티마이저와 스케줄러는 원본 학습에서 이어받지 않고 새로 시작한다.

학습 32,513장과 검증 4,070장의 기존 분할을 유지한다. 검증 이미지를 학습에 추가하지 않는다. 원본 모델과 데이터는 보존하고 다음 경로에 저장한다.

```text
MyDrive/cropy_runs/resolution_finetune_20261005/
  finetune_256/
  finetune_384/
  comparison/comparison.md
  comparison/comparison.json
  setup_256.json
  setup_384.json
  memory_preflight.json
  training_256.log
  training_384.log
```

각 실행의 `initial_val_metrics.json`은 해당 해상도에서 학습 전(epoch 0)에 평가한 결과다. `best_model.pth`는 epoch 0~5에서 검증 Macro F1이 가장 높은 모델이며 동률이면 앞선 에폭을 선택한다. 개선되지 않으면 epoch 0이 남을 수 있다. 비교 보고서는 이 최고 모델 비교와 동일한 학습 기간인 마지막 epoch 5 비교를 구분한다. 원본 256px 모델은 별도의 기준으로 표시한다.

Colab에서 모두 실행하면 데이터·코드·시작 모델의 해시를 확인하고 384px·batch 16의 메모리 점검을 거친 후 256px와 384px를 순서대로 학습한다. 중단되면 같은 노트북을 모두 실행한다. 완료된 에폭의 모델·옵티마이저·스케줄러·난수 상태를 복원하며, 학습 코드·환경·설정이 달라지면 자동 재개를 거부한다. 새 설정으로 기존 폴더를 재사용하지 않는다.

검증 항목: ML 테스트 82개 통과, 소규모 실제 ResNet18 CPU 학습에서 연속 실행과 중단·재개의 전체 체크포인트 일치, 시작 모델 보존, 학습률이 다른 재개 거부, 비교 보고서 생성 확인. CPU 점검은 학습 18장·검증 18장과 64/96px를 사용한 실행 경로 확인이며 성능 개선 근거가 아니다. 자세한 기록은 `verification.json`과 `../resolution_finetune_smoke_20261005/verification.json`에 있다.

현재 실험 상태는 `verification.json`에 기록한다. 전체 학습이 끝나기 전에는 성능 개선 여부를 판단하지 않는다. 결과는 이미 분석한 검증셋과 단일 seed의 성능이며 독립적인 테스트 성능이 아니다.
