# AWS Lightsail 단일 서버 배포 가이드

> 갱신: 2026-10-26. 대상: **AWS Lightsail 서울 / Ubuntu 24.04 x86_64 / 2 vCPU · RAM 4GB (`medium_3_0`, $24/월)**.
> 기존 `docker-compose.yml`에 `docker-compose.prod.yml`을 덮어써서 frontend·backend·Caddy 세 컨테이너를 한 서버에 올린다.
> Caddy가 Let's Encrypt 인증서를 자동 발급해 HTTPS로 받고, 외부에는 80·443만 열린다.
> 단말(오렌지파이) 배포는 [ORANGEPI5_DEPLOY.md](ORANGEPI5_DEPLOY.md)를 따른다.

```
브라우저 ──443──▶ caddy ──▶ frontend:3000 ──/api·/uploads──▶ backend:8000
                                                          ├─ /models (ml/checkpoints, 읽기 전용)
                                                          └─ /data   (cropy_cropcare-data: SQLite·업로드 사진)
```

## 1. 인스턴스 준비

- Lightsail → 서울(ap-northeast-2) → Linux/Ubuntu 24.04 → `medium_3_0`. x86을 고른다. `backend/requirements.txt`의 torch `+cpu` 휠을 그대로 쓰기 위해서다.
- 고정 IP를 만들어 인스턴스에 연결한다. 인스턴스에 연결되지 않은 고정 IP는 요금이 붙는다.
- 방화벽: TCP 22, 80, 443과 UDP 443만 연다. 22는 가능하면 내 IP로 제한한다. 3000·8000은 열지 않는다.
  IPv6 방화벽은 IPv4와 따로 관리된다. IPv6 탭도 같은 규칙으로 맞추거나 IPv6를 끈다.
- 주소는 `<고정IP>.sslip.io`를 쓴다. 별도 DNS 설정 없이 그 IP로 풀린다. 도메인을 구매하면 A 레코드를 고정 IP로 두고 그 도메인으로 바꾼다.
- SSH 키: Lightsail 기본 키(.pem)를 받았다면 아래 `ssh`·`scp`에 `-i <키.pem>`을 붙인다.

## 2. 서버 설정

```bash
sudo apt update && sudo apt upgrade -y

# Docker 공식 저장소 버전을 설치한다. Ubuntu 기본 docker.io 패키지에는 compose 플러그인이
# 들어 있지 않고, 별도 패키지 버전은 docker-compose.prod.yml 의 `!reset` 을 못 읽을 수 있다
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# torch 설치와 next build 가 겹치면 4GB 로는 모자랄 수 있어 스왑을 둔다 (한 번만 실행)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

docker 그룹은 다시 로그인해야 적용된다. 로그아웃 후 다시 접속해서 확인한다.

```bash
docker compose version   # v2.24.4 이상
```

## 3. 코드·모델·설정 반입

저장소가 비공개라 서버에서 바로 clone 할 수 없다. 둘 중 하나를 쓴다.

- **로컬에서 묶어 보내기 (자격 증명을 서버에 두지 않는다)**
  ```bash
  # 로컬 PC, 저장소 루트에서. 로컬 브랜치가 뒤처져 있으면 예전 코드가 나가므로 원격 기준으로 묶는다
  git fetch origin
  git archive --format=tar.gz -o cropy.tgz origin/<브랜치>
  scp cropy.tgz ubuntu@<고정IP>:~
  # 서버 (처음 배포)
  mkdir -p ~/Cropy && tar xzf ~/cropy.tgz -C ~/Cropy && rm ~/cropy.tgz
  ```
  업데이트는 6절의 "코드 업데이트"를 따른다. 기존 디렉터리에 덮어 풀면 새 버전에서 지운 파일이 남아 빌드에 섞인다.
- **Deploy key**: 저장소 관리자가 서버의 공개키를 읽기 전용 Deploy key로 등록하면 `git clone git@github.com:hs-cropy/Cropy.git ~/Cropy` 후 `git pull`로 업데이트할 수 있다.

설정 파일을 만든다.

```bash
cd ~/Cropy
cp deploy/.env.example .env && nano .env   # SITE_ADDRESS=<고정IP>.sslip.io
```

`.env`의 `COMPOSE_FILE`이 두 compose 파일을 함께 읽게 하므로, 이 디렉터리에서는 `-f` 없이 `docker compose`만 쓰면 된다.

체크포인트는 저장소에 없다. 디렉터리를 먼저 만들고 로컬 PC에서 올린 뒤 양쪽 해시를 비교한다. 모델이 없으면 `/api/v1/ready`와 진단이 503을 돌려준다.
backend 는 `ml/checkpoints`와 `frontend/public/offline-assets`를 마운트한다. 둘 다 묶음에 들어 있지 않아서, `up`을 먼저 하면 Docker가 root 소유로 만들어 나중에 scp가 막힌다. 미리 만들어 둔다.

```bash
# 서버
mkdir -p ~/Cropy/ml/checkpoints ~/Cropy/frontend/public/offline-assets
# 로컬 PC
scp ml/checkpoints/best_model.pth ubuntu@<고정IP>:~/Cropy/ml/checkpoints/
sha256sum ml/checkpoints/best_model.pth
# 서버
sha256sum ~/Cropy/ml/checkpoints/best_model.pth
```

## 4. 실행

```bash
cd ~/Cropy
docker compose config -q    # 설정 확인 (SITE_ADDRESS 누락 시 여기서 멈춘다)
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose build        # 빌드를 먼저 끝내 메모리 사용을 나눈다
docker compose up -d
docker compose ps           # backend 가 healthy 가 될 때까지 기다린다 (모델 로드)
```

## 5. 검증

- [ ] `curl -I https://<주소>` → 200, 인증서 발급자가 Let's Encrypt
- [ ] `curl https://<주소>/api/v1/ready` → 200 (mock 이면 실패)
- [ ] `curl -I http://<주소>` → https 로 리다이렉트
- [ ] 외부에서 `http://<고정IP>:3000` 접속이 막혀 있다
- [ ] 실제 작물 사진으로 진단 → 결과·이력 상세 이미지 표시, 재촬영 후 결과 갱신
- [ ] 진단 1건 소요 시간 측정. 30초에 가까우면 아래 "알려진 제약" 참고
- [ ] 휴대폰(LTE)에서 카메라 권한 허용·촬영
- [ ] `sudo reboot` 후 네 컨테이너(backend·frontend·caddy·stt)가 다시 뜬다(`restart: unless-stopped`)
- [ ] `docker compose exec backend python -c "import urllib.request;print(urllib.request.urlopen('http://stt:8200/health').read())"` → STT 준비. 음성 모드에서 질문 하나를 받아 적는 시간을 기록한다
- [ ] `docker stats`, `free -m` 으로 메모리 사용량 기록
- [ ] 48MP급 큰 사진(HEIC·JPEG, 가능하면 DNG)을 진단하며 `docker stats`로 backend 최대 메모리를 확인하고, OOM 재시작이 없는지 본다
- [ ] 6천만 픽셀을 넘는 사진(예: 200MP 모드)은 413으로 거절된다

## 6. 운영

```bash
docker compose logs --tail=100 backend   # 로그 (컨테이너별 10MB × 3개까지 보관)
docker image prune -f                    # 재빌드가 쌓이면 디스크 정리
docker builder prune -f --filter until=168h   # 7일 지난 빌드 캐시 정리 (자동 배포가 성공하면 알아서 한다)
```

### 자동 배포

develop 에 push(머지)되어 CI 가 모두 통과하면 `.github/workflows/ci.yml`의 `deploy` 잡이 서버에 배포한다.

1. develop 최신 커밋인지 확인한다. 예전 실행을 다시 돌려도 구버전이 배포되지 않는다.
2. `git archive HEAD` 묶음을 SSH 표준입력으로 서버에 보낸다.
3. 서버의 `~/bin/cropy-deploy-entry`(`deploy/cropy-deploy-entry.sh`)가 요청을 검증하고 잠금을 건 뒤 `~/Cropy.new`에 묶음을 푼다. 다른 배포가 돌고 있으면 최대 20분 기다리고, 그래도 끝나지 않으면 실패(75)한다.
4. 묶음 안의 `deploy/remote-update.sh`가 아래 "코드 업데이트"와 같은 절차로 교체한다. 빌드가 실패하면 교체하지 않는다. 새 버전이 5분 안에 준비되지 않으면 지금 실행 중이던 이미지(`:prev`)와 이전 디렉터리로 되돌리고 잡을 실패로 끝낸다. 배포는 SSH 세션과 떨어져 돌아서, 러너가 취소되거나 연결이 끊겨도 서버에서 끝까지 진행된다. DB 는 되돌리지 않는다.
5. 외부에서 `https://<주소>/api/v1/ready` 200 을 확인한다.

배포는 한 번에 하나씩 돈다. 러너가 취소된 뒤에도 서버 배포는 계속 돌 수 있고, 다음 배포는 그것을 기다린다. 서버 로그는 `~/deploy-logs/`에 최근 20개가 남는다. 문서만 바뀐 머지도 배포되며, 컨테이너를 다시 만들 때 몇 초 끊긴다.

수동 실행: Actions → CI → Run workflow 에서 develop 을 고른다. `dry_run`(기본 켜짐)은 묶음 전송·설정 검증·디스크 확인까지만 하고 교체하지 않는다. 끄면 실제로 배포한다.

**설정 (한 번만)**

- 배포 전용 키를 만든다. 개인 접속 키와 따로 둔다.
  ```bash
  ssh-keygen -t ed25519 -N "" -C gha-cropy-deploy -f cropy-deploy
  ```
- 서버에 진입 스크립트를 설치하고 공개키를 등록한다. `command=`로 이 키는 진입 스크립트만 실행할 수 있다.
  ```bash
  # 로컬 PC
  scp deploy/cropy-deploy-entry.sh ubuntu@<고정IP>:~/cropy-deploy-entry
  # 서버
  mkdir -p ~/bin && mv ~/cropy-deploy-entry ~/bin/ && chmod 755 ~/bin/cropy-deploy-entry
  echo 'restrict,command="/home/ubuntu/bin/cropy-deploy-entry" <cropy-deploy.pub 내용>' >> ~/.ssh/authorized_keys
  ```
- 호스트 키를 구해 서버에서 본 지문과 맞는지 대조한다.
  ```bash
  ssh-keyscan -t ed25519 <고정IP> > deploy_known_hosts && ssh-keygen -lf deploy_known_hosts   # 로컬 PC
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub                                         # 서버
  ```
- GitHub 저장소 설정에 등록하고, 로컬의 비밀키 파일은 지운다.
  - Secrets: `DEPLOY_SSH_KEY`(cropy-deploy 비밀키 전체), `DEPLOY_KNOWN_HOSTS`(deploy_known_hosts 내용)
  - Variables: `DEPLOY_HOST`(고정 IP. 호스트 키를 IP 로 받았으므로 sslip.io 이름이 아니라 같은 IP 를 넣는다), `DEPLOY_USER`(`ubuntu`), `SITE_ADDRESS`(`<고정IP>.sslip.io`)

**주의:** 비공개 저장소 무료 플랜이라 브랜치 보호와 Environment 제한을 쓸 수 없어 Secret 은 저장소 전체에 열려 있다. push 권한이 있는 사람은 워크플로를 고쳐 배포 키를 꺼낼 수 있고, docker 를 다룰 수 있는 배포 키는 사실상 서버 root 권한이다. 데모 기간에만 쓰고 종료할 때 바로 폐기한다.

진입 스크립트(`deploy/cropy-deploy-entry.sh`)를 고쳤다면 서버의 `~/bin/cropy-deploy-entry`도 다시 설치해야 한다. `remote-update.sh`는 묶음에 들어 있어 자동으로 최신이 쓰인다.

### 코드 업데이트

자동 배포가 쓰는 절차이며, 자동 배포가 안 될 때는 손으로 한다. 손으로 할 때는 자동 배포와 겹치지 않게 먼저 잠금을 잡는다(`exec 9>~/.cropy-deploy.lock && flock 9`). 자동 배포는 잠금이 풀릴 때까지 최대 20분 기다렸다가 바로 진행하므로, 작업이 끝나면 셸을 닫아 잠금을 푼다. 20분 넘게 잡고 있으면 그 자동 배포는 실패한다.
새 디렉터리에 풀어 빌드한 뒤 디렉터리를 바꿔 끼운다. 빌드하는 동안 기존 서비스는 그대로 돈다.
프로젝트 이름이 `cropy`로 고정되어 있어 디렉터리를 바꿔도 DB·업로드 사진 볼륨은 그대로 이어진다.

```bash
# 로컬 PC: 3절처럼 git fetch 후 origin/<브랜치>로 묶어 scp 로 보낸다
# 서버
rm -rf ~/Cropy.new && mkdir -p ~/Cropy.new && tar xzf ~/cropy.tgz -C ~/Cropy.new && rm ~/cropy.tgz
cp ~/Cropy/.env ~/Cropy.new/
mkdir -p ~/Cropy.new/ml ~/Cropy.new/frontend/public
cp -a ~/Cropy/ml/checkpoints ~/Cropy.new/ml/
cp -a ~/Cropy/frontend/public/offline-assets ~/Cropy.new/frontend/public/   # ONNX 를 올렸다면 함께 옮겨진다

# 롤백용으로 지금 이미지에 태그를 남기고 새 이미지를 빌드한다
docker tag cropy-backend cropy-backend:prev && docker tag cropy-frontend cropy-frontend:prev
cd ~/Cropy.new && docker compose build

# 바꿔 끼우고 세 컨테이너를 모두 다시 만든다 (끊김은 몇 초)
cd ~ && mv ~/Cropy ~/Cropy.old && mv ~/Cropy.new ~/Cropy
cd ~/Cropy && docker compose up -d --force-recreate
docker compose ps   # backend healthy 확인 후
rm -rf ~/Cropy.old
```

- `--force-recreate` 가 필요하다. 이미지가 그대로인 서비스(caddy, 코드가 안 바뀐 backend)는 `up -d` 만으로는 다시 만들어지지 않고, 실행 중인 컨테이너의 마운트는 옮겨 간 `~/Cropy.old` 를 계속 본다. 그 상태로 `Cropy.old` 를 지우면 모델·Caddyfile·offline-assets 마운트가 사라진다.
- 3절의 mkdir 없이 처음 배포한 서버는 `offline-assets` 가 root 소유라 `cp -a` 가 "failed to preserve ownership" 을 낼 수 있다. 복사는 되므로 계속 진행해도 된다.
- 롤백: 디렉터리만 되돌리면 `cropy-backend`·`cropy-frontend` 태그가 이미 새 이미지를 가리켜 새 코드가 그대로 뜬다. 남겨 둔 태그로 되돌린다.
  ```bash
  cd ~ && mv ~/Cropy ~/Cropy.bad && mv ~/Cropy.old ~/Cropy
  docker tag cropy-backend:prev cropy-backend && docker tag cropy-frontend:prev cropy-frontend
  cd ~/Cropy && docker compose up -d --force-recreate
  ```

진단 이력과 사진은 `cropy_cropcare-data` 볼륨에 있다. 서비스를 켠 채 백업·복원하는 방법과 백업 볼륨(`cropy_cropcare-backups`)은 [백업·복원](operations/BACKUP_RESTORE.md)을 따른다. 아래는 서비스를 멈추고 데이터 볼륨을 통째로 저장소 밖에 묶는 방법이다.

```bash
mkdir -p ~/backups
docker compose stop backend
docker run --rm -v cropy_cropcare-data:/data -v ~/backups:/backup alpine \
  tar czf /backup/cropcare-data-$(date +%Y%m%d).tgz -C /data .
docker compose start backend
# 로컬 PC로: scp ubuntu@<고정IP>:~/backups/cropcare-data-*.tgz .
```

`caddy_data` 볼륨에는 발급받은 인증서가 있다. 지우면 재발급하게 되고, sslip.io 는 여러 사람이 쓰는 도메인이라 Let's Encrypt 발급 한도에 걸릴 수 있다.

## 7. 종료

Lightsail 은 인스턴스를 정지해도 요금이 나간다. 그만 쓸 때는 **삭제**한다.

1. 자동 배포를 먼저 끈다. 서버가 없으면 develop 머지마다 deploy 잡이 실패한다.
   - Variables 의 `DEPLOY_HOST`를 지우면 deploy 잡이 건너뛰어진다. 이후 `ci.yml`의 `deploy` 잡을 지우는 PR 을 올린다
   - Secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`와 Variables 를 삭제한다
2. 6절의 방법으로 데이터를 백업해 로컬로 받는다.
3. 인스턴스를 삭제한다.
4. 고정 IP를 해제한다.
5. 스냅샷을 만들었다면 함께 삭제한다.
6. 다음 날 Cost Explorer 에서 Lightsail 사용량이 0인지 확인한다.

## 알려진 제약

- **인증 없음:** 앱에 로그인이 없어 주소를 아는 사람은 누구나 쓸 수 있고, `/uploads` 사진도 공개된다. 데모 기간에만 쓰고 주소를 공개하지 않는다.
- **이미지 픽셀 한도:** 4GB 서버에서 큰 HEIF/RAW 한 장으로 메모리가 바닥나지 않도록 `docker-compose.prod.yml`에서 `MAX_IMAGE_PIXELS`를 6천만으로 낮췄다(기본 2억1천만). 디코드 피크가 기본값 대비 약 1/3.5로 줄어 수백 MB 안쪽이 된다. 8비트 RGB는 픽셀당 3바이트지만 16비트 PNG·HEIF 디코드 버퍼·RAW(DNG) 처리는 그 2~3배가 들 수 있어 5절에서 실측한다. 진단은 한 번에 하나씩만 처리된다(`MAX_CONCURRENT_DIAGNOSES=1`). 12·48·50MP 사진은 통과하고, 64·108·200MP 모드는 413으로 거절된다(프론트 문구는 "사진 용량이 너무 커요"). 파일 크기 한도(100MB)는 프론트 안내·사전 검증과 맞추고 DNG를 받기 위해 그대로 둔다.
- **프록시 30초:** Next.js rewrite 프록시는 기본 30초 안에 backend 응답이 없으면 500을 돌려준다. Caddy 응답 대기 시간(120초)으로는 해결되지 않는다. 실측 진단 시간이 길면 `frontend/next.config.js`에 `experimental.proxyTimeout`을 둔다.
- **CORS_ORIGINS:** 브라우저가 같은 주소로만 호출하므로 `http://localhost:3000` 그대로 둬도 동작한다.
- **음성 질문:** 받아 적기는 `stt` 컨테이너(SenseVoice int8, 모델 약 240MB는 이미지 빌드 때 받는다)가 한다. 기능 선택 모델(Qwen 2B)은 float32로 약 9GB라 이 서버에 올리지 않는다(`FUNCTION_SELECTOR_ENGINE`은 기본 `off`). 휴대폰은 기기 안 분류기(`mobile_clf`), WebGPU PC는 브라우저 Qwen(`web_qwen`)이 고르므로 그 묶음을 오프라인 묶음과 같은 방법으로 넣어 둬야 한다. 묶음이 없는 기기는 서버 선택으로 넘어가 503이 난다.
- **오프라인 묶음:** `frontend/public/offline-assets`의 ONNX 모델은 저장소에 없다. `/offline` 화면을 시연하려면 빌드 전에 서버로 옮겨야 프론트 이미지에 들어간다([OFFLINE_WEB.md](OFFLINE_WEB.md)). 서버 진단에는 영향이 없다.
- **프로젝트 이름:** prod 설정은 프로젝트 이름을 `cropy`로 고정한다. 개발 PC에서 prod 파일을 함께 쓰면 로컬 스택과 같은 볼륨을 공유하므로 개발 PC에서는 쓰지 않는다.
