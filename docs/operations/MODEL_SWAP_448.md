# 448px 입력 모델 교체 절차

> 대상: Lightsail 서버 운영자. 작성 2026-11-02.

입력 해상도를 256→448px로 올린 ResNet50 10클래스 모델이다. 작업자 분리 시험셋에서 무노균병 recall이 74%→88%로 올랐고 나빠진 클래스가 없어 교체 후보로 올린다([모델 명세](../MODEL_SPEC.md#실험-2-입력-해상도-256448px-2026-10-30--부분-개선-후보-채택)).

| 항목 | 값 |
|---|---|
| 파일 | `full512_resnet50_448_other10_v1.pth` (94,425,769바이트) |
| 위치 | Drive `cropy_testset/cropy_448_handoff_20261102/` |
| SHA256 | `274527c5742da193fc0e9b1eda60744c94fb758210823e56175b7e8e957e45e7` |
| 구조 | ResNet50, 10클래스, **입력 448** (체크포인트 `img_size=448`) |
| 학습 | 공식 train 37,753장, 8 epoch 중 6 선택, `ml/cropy_full448_colab.ipynb` |
| 공식 val 4,635장 | 99.68% / Macro F1 0.962 (현재 모델 99.57% / 0.958), 작물 사진 → 판별 불가 0장(현재 1장) |

공식 val 질병별 recall 비교(현재 → 새 모델): 무검은무늬병 92.1%→93.4%(70→71/76), 무노균병 70.8%→66.7%(17→16/24), 배추검은썩음병 98.2%→100%. 무노균병 1장 감소는 24장 표본의 잡음 범위이고, 이 val은 학습 작업자와 겹쳐 일반화를 말해 주지 않는다. 교체 근거는 시험셋(미학습 작업자) 결과다.

## 코드 변경은 없다

백엔드 `ml_service.py`는 체크포인트의 `arch`·`img_size`를 읽어 448로 전처리한다. 10클래스 코드가 이미 배포돼 있으면(`/api/v1/capabilities`의 `decision.version`이 `decision-v2`) 모델 파일만 바꾸면 된다.

추론 비용은 1장당 약 2.4배다(노트북 CPU 22스레드 기준 78ms→185ms). Lightsail CPU에서는 더 느릴 수 있으니 교체 뒤 진단 응답 시간을 한 번 확인한다.

## 교체

```bash
# 로컬 PC
scp full512_resnet50_448_other10_v1.pth ubuntu@<고정IP>:~/Cropy/ml/checkpoints/

# 서버
cd ~/Cropy/ml/checkpoints
sha256sum full512_resnet50_448_other10_v1.pth       # 위 SHA256과 같은지 확인
cp -p best_model.pth best_model_256_other10.pth     # 되돌리기용 보관
cp full512_resnet50_448_other10_v1.pth best_model.pth.new && mv best_model.pth.new best_model.pth

cd ~/Cropy
docker compose up -d --force-recreate backend
docker compose ps                                    # backend 가 healthy 가 될 때까지
```

## 확인

- [ ] `curl https://<주소>/api/v1/ready` → 200
- [ ] `docker compose logs --tail=50 backend` 에 `failed validation` 없음
- [ ] 작물 사진 진단 응답 시간이 이전과 비교해 수용 가능(목표 1장 1초 이내)
- [ ] 손이나 물건 사진 진단 → "판별 불가"
- [ ] 무 잎 사진 진단 → 병명 표시

## 되돌리기

```bash
cd ~/Cropy/ml/checkpoints && cp -p best_model_256_other10.pth best_model.pth
cd ~/Cropy && docker compose up -d --force-recreate backend
```

코드는 그대로 두고 모델만 되돌린다.

## 오프라인 화면(선택)

`/offline` 브라우저 묶음은 별개다. 448 입력은 브라우저 추론 부담이 커지므로 오프라인 묶음은 256 모델을 유지해도 된다. 바꾸려면 [OFFLINE_WEB.md](../OFFLINE_WEB.md) 절차로 다시 만든다.
