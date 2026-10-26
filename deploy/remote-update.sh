#!/usr/bin/env bash
# 서버에서 새 버전으로 교체한다. cropy-deploy-entry 가 ~/Cropy.new 에 묶음을 푼 뒤 실행한다.
# 절차는 docs/AWS_LIGHTSAIL_DEPLOY.md 6절 "코드 업데이트"와 같다.
#   remote-update.sh update|check <커밋 SHA>
# 새 버전이 준비 상태가 되지 않으면 이전 이미지(:prev)와 디렉터리로 되돌리고 실패로 끝낸다.
set -euo pipefail

mode="$1"
sha="$2"
CUR="$HOME/Cropy"
NEW="$HOME/Cropy.new"
OLD="$HOME/Cropy.old"
SERVICES=(backend frontend)

echo "== $(date -u +%FT%TZ) $mode ${sha:0:7}"

# 저장소에 없는 파일(.env, 모델, 오프라인 묶음)을 지금 버전에서 가져온다
cp "$CUR/.env" "$NEW/"
mkdir -p "$NEW/ml" "$NEW/frontend/public"
cp -a "$CUR/ml/checkpoints" "$NEW/ml/"
if [ -d "$CUR/frontend/public/offline-assets" ]; then
  # 처음 배포한 서버에서는 root 소유일 수 있다. 소유권 경고가 나도 복사는 된다
  cp -a "$CUR/frontend/public/offline-assets" "$NEW/frontend/public/" || true
fi
mkdir -p "$NEW/frontend/public/offline-assets"

cd "$NEW"
docker compose config -q

# .env 를 직접 자르면 따옴표·CRLF 가 남을 수 있어 compose 가 해석한 값을 쓴다
site="$(docker compose config | sed -n 's/^ *SITE_ADDRESS: *//p' | head -1 | tr -d "\"'\r")"
if [ -z "$site" ]; then
  echo "!! SITE_ADDRESS 를 읽지 못했다"
  exit 1
fi
free_gb="$(df --output=avail -BG "$HOME" | tail -1 | tr -dc 0-9)"
echo "디스크 여유 ${free_gb:-?}GB, 주소 $site"
free -m | sed -n 2,3p
if [ -z "$free_gb" ] || [ "$free_gb" -lt 5 ]; then
  echo "!! 디스크 여유가 5GB 미만이거나 확인되지 않아 중단한다 (docker image prune, builder prune 필요)"
  exit 1
fi

if [ "$mode" = check ]; then
  echo "== 점검 통과. 교체하지 않는다"
  cd "$HOME" && rm -rf "$NEW"
  exit 0
fi

# 되돌릴 이미지는 태그가 아니라 지금 실행 중인 컨테이너의 이미지로 정한다.
# 지난 빌드가 중간에 실패해 태그만 바뀐 경우에도 실제로 돌던 버전으로 되돌릴 수 있다
for service in "${SERVICES[@]}"; do
  running="$(docker inspect -f '{{.Image}}' "cropy-$service-1" 2>/dev/null || true)"
  if [ -n "$running" ]; then
    docker tag "$running" "cropy-$service:prev"
  elif docker image inspect "cropy-$service" >/dev/null 2>&1; then
    docker tag "cropy-$service" "cropy-$service:prev"
  fi
done

restore_images() {
  for service in "${SERVICES[@]}"; do
    if docker image inspect "cropy-$service:prev" >/dev/null 2>&1; then
      docker tag "cropy-$service:prev" "cropy-$service"
    fi
  done
}

# 빌드하는 동안 지금 서비스는 그대로 돈다. 일부만 빌드되고 실패해도 태그를 되돌려 둔다
if ! docker compose build; then
  echo "!! 빌드 실패. 교체하지 않는다"
  restore_images
  exit 1
fi

# backend 가 healthy 이고, Caddy·frontend 를 거친 /api/v1/ready 가 200 일 때까지 최대 5분 기다린다
wait_ready() {
  local status deadline=$((SECONDS + 300))
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(docker inspect -f '{{.State.Health.Status}}' cropy-backend-1 2>/dev/null || echo none)"
    if [ "$status" = healthy ] &&
      curl -fsS -o /dev/null --max-time 10 --resolve "$site:443:127.0.0.1" "https://$site/api/v1/ready"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

# 지우지 못한 디렉터리(root 소유 파일 등)가 남으면 다음 mv 가 그 안으로 들어가 버린다
remove_dir() {
  rm -rf "$1" 2>/dev/null || sudo -n rm -rf "$1" 2>/dev/null || true
  [ ! -e "$1" ]
}

moved=0
# 조건문 안에서 부르는 함수에는 set -e 가 걸리지 않아 단계마다 실패를 직접 돌려준다
switch_and_start() {
  remove_dir "$OLD" || { echo "!! $OLD 를 지우지 못했다"; return 1; }
  mv "$CUR" "$OLD" || return 1
  moved=1
  mv "$NEW" "$CUR" || return 1
  cd "$CUR" || return 1
  # 이미지가 그대로인 서비스도 다시 만들어야 옮겨 간 ~/Cropy.old 를 마운트한 채로 남지 않는다
  docker compose up -d --force-recreate || return 1
  wait_ready
}

rollback() {
  echo "!! 새 버전이 준비되지 않아 이전 버전으로 되돌린다"
  cd "$HOME"
  # 이번 배포가 옮긴 경우에만 되돌린다. 두 번째 mv 가 실패했을 수 있어 ~/Cropy 유무는 따로 본다
  if [ "$moved" = 1 ] && [ -d "$OLD" ]; then
    if [ -d "$CUR" ]; then
      bad="$HOME/Cropy.bad"
      remove_dir "$bad" || bad="$HOME/Cropy.bad-$(date -u +%Y%m%dT%H%M%SZ)"
      mv "$CUR" "$bad"
      echo "실패한 버전은 $bad 에 남겼다"
    fi
    mv "$OLD" "$CUR"
  fi
  restore_images
  cd "$CUR"
  docker compose up -d --force-recreate
  if wait_ready; then
    echo "== 되돌리기 완료"
  else
    echo "!! 되돌린 뒤에도 준비되지 않았다. 서버에서 직접 확인해야 한다"
  fi
}

if ! switch_and_start; then
  if [ -d "$CUR" ]; then
    docker compose -f "$CUR/docker-compose.yml" -f "$CUR/docker-compose.prod.yml" \
      --project-directory "$CUR" logs --tail=50 backend || true
  fi
  rollback
  exit 1
fi

remove_dir "$OLD" || echo "경고: $OLD 를 지우지 못했다. 다음 배포 전에 정리해야 한다"
docker image prune -f >/dev/null || true
echo "== $(date -u +%FT%TZ) 배포 완료 ${sha:0:7}"
docker compose ps --format '{{.Service}} {{.Status}}'
