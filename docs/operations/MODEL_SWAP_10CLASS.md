# 10클래스(판별 불가) 모델 교체 절차

> 대상: Lightsail 서버 운영자. 작성 2026-10-27.

손 사진·물건 사진도 병해로 나오던 문제를 `9_기타`(판별 불가) 클래스로 해결한 모델이다.

| 항목 | 값 |
|---|---|
| 파일 | `full512_resnet50_other10_v1.pth` (94,425,833바이트) |
| SHA256 | `bf9dff87e908f3b6d55a33f07f52537072eb0e40f4fc948aeed10632cd0ac3e4` |
| 구조 | ResNet50, 10클래스, 입력 256 |
| 검증 | val 99.57%, Macro F1 0.958, 작물 사진 → 판별 불가 1/4,070 |

## 순서가 중요하다

**코드 배포(develop 머지 → 자동 배포)가 끝난 뒤에 모델을 바꾼다.**
이전 코드는 9클래스 모델만 받아서, 모델을 먼저 바꾸면 모델 로드가 실패하고 진단·`/api/v1/ready`가 503이 된다.
새 코드는 9클래스·10클래스를 모두 받으므로 코드만 먼저 배포된 상태는 안전하다.

배포 확인: `curl -s https://<주소>/api/v1/capabilities` 의 `decision.version`이 `decision-v2`면 새 코드다.

## 교체

```bash
# 로컬 PC: 파일을 서버로 올린다 (기존 파일을 덮지 않게 다른 이름으로)
scp full512_resnet50_other10_v1.pth ubuntu@<고정IP>:~/Cropy/ml/checkpoints/

# 서버
cd ~/Cropy/ml/checkpoints
sha256sum full512_resnet50_other10_v1.pth          # 위 SHA256과 같은지 확인
cp -p best_model.pth best_model_9class.pth          # 되돌리기용 보관
cp full512_resnet50_other10_v1.pth best_model.pth.new && mv best_model.pth.new best_model.pth

# 모델은 프로세스 시작 시 한 번만 읽으므로 backend 를 다시 만든다
cd ~/Cropy
docker compose up -d --force-recreate backend
docker compose ps                                    # backend 가 healthy 가 될 때까지
```

## 확인

- [ ] `curl https://<주소>/api/v1/ready` → 200
- [ ] `docker compose logs --tail=50 backend` 에 `failed validation` 없음
- [ ] 손이나 물건 사진 진단 → "작물 잎을 찾지 못했어요" 화면, 이력에 "판별 불가"
- [ ] 실제 작물 사진 진단 → 이전처럼 병명 표시

## 되돌리기

```bash
cd ~/Cropy/ml/checkpoints && cp -p best_model_9class.pth best_model.pth
cd ~/Cropy && docker compose up -d --force-recreate backend
```

새 코드는 9클래스 모델로도 정상 동작한다. 이미 저장된 "판별 불가" 기록은 그대로 열린다.

## 오프라인 화면(선택)

`/offline` 브라우저 진단 묶음은 서버 진단과 별개다. 10클래스로 바꾸려면 모델 파일이 있는 PC에서 묶음을 만들고, 서버의 `frontend/public/offline-assets/`로 옮긴 뒤 프론트를 다시 빌드한다([OFFLINE_WEB.md](../OFFLINE_WEB.md)).

```bash
cd backend
python scripts/export_browser_model.py --checkpoint ../ml/checkpoints/full512_resnet50_other10_v1.pth
```
