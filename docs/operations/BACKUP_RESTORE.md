# 백업·복원 (도커 배포)

`backend/scripts/backup_db.py`로 SQLite DB와 업로드 사진을 함께 백업하고 복원한다. 스크립트의 동작(쓰기 잠금, 증분, 보관 개수, 복원 검증)은 파일 맨 위 설명을 참고한다.

## 백업 위치

| 경로(컨테이너 안) | 볼륨 | 내용 |
|---|---|---|
| `/data` | `cropcare-data` | 운영 DB(`cropcare.db`)와 업로드 사진 |
| `/backups` | `cropcare-backups` | 정기 백업(`<타임스탬프>/`)과 복원 직전 안전 백업(`pre_restore_*`) |

- compose가 `BACKUP_ROOT=/backups`를 주므로 `--out` 없이 실행해도 볼륨에 만든다. 컨테이너를 다시 만들어도(`docker compose up -d --build`) 백업이 남는다.
- 실제 볼륨 이름은 프로젝트 이름이 앞에 붙는다. 서버(prod 설정)는 `cropy_cropcare-backups`다.
- 두 볼륨은 같은 디스크에 있다. 디스크 고장이나 서버 삭제에 대비하려면 아래 "서버 밖으로 옮기기"로 따로 보관한다.

명령은 저장소 폴더(`~/Cropy`)에서 실행한다.

## 백업

서비스를 켠 채로 실행할 수 있다. 백업하는 동안 앱의 저장이 잠시 기다린다.

```bash
docker compose exec -T backend python scripts/backup_db.py backup
```

- 같은 원본의 최근 7개만 남긴다(`--keep N`, `0`이면 지우지 않음). 안전 백업(`pre_restore_*`)은 지우지 않는다.
- 바뀌지 않은 사진은 직전 백업과 하드링크로 이어서, 백업이 여러 개여도 사진 용량이 그만큼 늘지 않는다.

목록 확인:

```bash
docker compose exec -T backend ls -l /backups
```

## 복원

1. 미리보기. 아무것도 바꾸지 않고 백업을 검증해 무엇이 바뀔지 보여 준다.

   ```bash
   docker compose exec -T backend python scripts/backup_db.py restore /backups/<타임스탬프>
   ```

2. 여유 공간을 확인한다. 복원하는 동안 사진 용량이 잠시 약 3배 필요하다(#147).
3. 백엔드를 멈추고, 같은 설정의 일회용 컨테이너로 복원한다. `exec`는 실행 중인 컨테이너가 있어야 하므로 여기서는 `run`을 쓴다.

   ```bash
   docker compose stop backend
   ```

   ```bash
   docker compose run --rm --no-deps backend python scripts/backup_db.py restore /backups/<타임스탬프> --apply
   ```

   ```bash
   docker compose start backend
   ```

4. 이력·사진과 `GET /api/v1/ready`를 확인한다.

- 복원 직전 상태는 `/backups/pre_restore_*`에 남는다. 복원이 잘못됐으면 이 폴더로 같은 방법으로 되돌린다.
- 복원에 쓴 백업과 안전 백업은 재부팅 뒤 다시 확인할 때까지 지우지 않는다.

## 서버 밖으로 옮기기

백업 볼륨을 묶어 서버의 홈 폴더로 꺼낸 뒤 로컬 PC로 받는다. tar는 하드링크를 그대로 담는다.

```bash
mkdir -p ~/backups
docker run --rm -v cropy_cropcare-backups:/backups:ro -v ~/backups:/out alpine \
  tar czf /out/cropcare-backups-$(date +%Y%m%d).tgz -C /backups .
# 로컬 PC로: scp ubuntu@<고정IP>:~/backups/cropcare-backups-*.tgz .
```

## 확인한 것

- 백업 후 `docker compose up -d --force-recreate backend`로 컨테이너를 다시 만들어도 `/backups`의 백업 목록이 그대로 남는다.
- 복원(`run --rm`)의 안전 백업도 `/backups/pre_restore_*`에 생겨 재생성 뒤에도 남는다.
