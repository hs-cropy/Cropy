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
- #149가 배포되기(2026-11-06) 전에는 기본 위치가 컨테이너 안 `/app/backups`였다. 그때 만든 백업은 배포하며 컨테이너를 다시 만들 때 사라졌으므로, 배포 뒤 백업을 한 번 새로 만든다.

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

2. 미리보기 결과의 `disk_space`로 여유 공간을 확인한다. 교체 전까지 원래 사진, 백업에서 꺼낸 준비 사본, 복원 직전 안전 백업이 함께 있어 사진 용량이 잠시 **약 3배** 든다.
   - `needed_bytes`는 복원이 새로 쓸 양(백업의 DB·사진 + 현재 DB·사진), `free_bytes`는 남은 공간이다. 디스크별로 한 줄씩 나온다.
   - `enough`가 `false`면 "공간이 부족합니다" 경고가 함께 나오고, `--apply`는 아무것도 바꾸지 않고 바로 실패한다. 아래 "서버 밖으로 옮기기"로 꺼낸 뒤 오래된 백업을 이름으로 지우고 다시 한다(`docker compose exec -T backend rm -rf /backups/<타임스탬프>`, 복원할 백업은 남긴다).
   - `backup --keep`으로 정리하지 않는다. 새 백업을 먼저 만든 뒤 정리하므로 공간이 부족할 때는 디스크를 더 쓴다.
   - 증분 백업은 바뀌지 않은 사진을 앞뒤 백업과 하드링크로 함께 쓴다. 백업 하나를 지워도 다른 백업이 같은 사진을 쓰고 있으면 그만큼 비지 않는다. 지운 뒤 미리보기를 다시 돌려 `free_bytes`를 확인한다.
   - 계산은 파일 크기의 합이라 실제보다 조금 적다. 여유가 빠듯하면 정리부터 한다.
3. 배포 잠금을 잡는다. 복원하는 동안 자동 배포(`docker compose up -d --force-recreate`)가 돌면 멈춰 둔 백엔드가 다시 떠서 복원 중인 DB·사진에 쓸 수 있다. 스크립트의 잠금은 백업·복원끼리만 막고 앱이나 배포는 막지 못한다.

   ```bash
   exec 9>~/.cropy-deploy.lock && flock 9
   ```

   - 자동 배포와 같은 잠금이다([배포 문서](../AWS_LIGHTSAIL_DEPLOY.md) "코드 업데이트"). 배포가 돌고 있으면 끝날 때까지 기다렸다가 잡힌다.
   - 잡고 있는 동안 들어온 자동 배포는 최대 20분 기다렸다가 잠금이 풀리면 바로 진행한다. 20분을 넘기면 그 배포는 실패(75)하므로, 끝난 뒤 GitHub Actions에서 그 실행을 다시 돌린다.
   - 20분보다 오래 걸릴 작업이면 미리 저장소 Variables의 `DEPLOY_HOST`를 삭제해 자동 배포를 건너뛰게 한다([배포 문서](../AWS_LIGHTSAIL_DEPLOY.md) 7절과 같은 방법. GitHub 변수는 빈 값으로 둘 수 없다). 끝나면 같은 값으로 다시 등록하고, 그동안 건너뛴 배포는 저절로 다시 돌지 않으므로 develop의 마지막 CI 실행을 Actions에서 다시 돌린다.
   - 이 셸에서 `docker compose up`을 직접 실행하지 않는다.
4. 백엔드를 멈추고, 같은 설정의 일회용 컨테이너로 복원한다. `exec`는 실행 중인 컨테이너가 있어야 하므로 여기서는 `run`을 쓴다.

   ```bash
   docker compose stop backend
   ```

   ```bash
   docker compose run --rm --no-deps backend python scripts/backup_db.py restore /backups/<타임스탬프> --apply
   ```

   ```bash
   docker compose start backend
   ```

5. 이력·사진과 `GET /api/v1/ready`를 확인한 뒤 셸을 닫아(`exit`) 배포 잠금을 푼다.

- 복원 직전 상태는 `/backups/pre_restore_*`에 남는다. 복원이 잘못됐으면 이 폴더로 같은 방법으로 되돌린다.
- 복원에 쓴 백업과 안전 백업은 아래 "안전 백업 정리"의 조건을 채울 때까지 지우지 않는다.

## 안전 백업 정리

안전 백업(`pre_restore_*`)은 보관 개수 정리(`--keep`)가 지우지 않는다. 사진 전체 사본이라 복원할 때마다 그만큼 쌓이고, 백업 볼륨은 운영 데이터와 같은 디스크에 있다.

아래가 모두 끝나면 지운다.

1. 복원한 상태로 이력·사진·`/api/v1/ready`를 확인했다.
2. 서버를 재부팅한 뒤 다시 확인했다(복원한 파일은 저장장치에 따로 내리지 않기 때문이다).
3. 그 뒤 새 백업(정기 실행 또는 수동 `backup`)을 한 번 이상 만들었다. 복원한 상태가 새 백업에 담겨 있어야 안전 백업 없이도 돌아갈 곳이 있다.

나중에 되돌릴 가능성이 있으면 지우기 전에 "서버 밖으로 옮기기"로 먼저 꺼내 둔다.

```bash
docker compose exec -T backend ls -l /backups
```

```bash
docker compose exec -T backend cat /backups/pre_restore_<시각-식별자>/manifest.json
```

```bash
docker compose exec -T backend rm -rf /backups/pre_restore_<시각-식별자>
```

- 목록에서 이름을 그대로 복사해 하나씩 지운다. `*`로 한꺼번에 지우지 않는다.
- 백업이 돌고 있지 않을 때 지운다.

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
