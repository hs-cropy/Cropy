#!/usr/bin/env bash
# 자동 배포 진입점. 서버의 ~/bin/cropy-deploy-entry 에 한 번만 설치한다.
# 배포 키는 authorized_keys 의 command= 로 이 스크립트만 실행할 수 있다.
#   restrict,command="/home/ubuntu/bin/cropy-deploy-entry" ssh-ed25519 AAAA... gha-cropy-deploy
#
# 요청(SSH_ORIGINAL_COMMAND)은 커밋 SHA 40자, 또는 점검만 하는 "check:<SHA>" 이다.
# 표준입력으로 받은 git archive 묶음(tar.gz)을 ~/Cropy.new 에 풀고, 묶음 안의
# deploy/remote-update.sh 에 나머지를 맡긴다. 그래서 배포 로직은 저장소에서 리뷰를 거친다.
set -euo pipefail

request="${SSH_ORIGINAL_COMMAND:-}"
mode=update
sha="$request"
if [[ "$request" == check:* ]]; then
  mode=check
  sha="${request#check:}"
fi
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "잘못된 배포 요청입니다" >&2
  exit 2
fi

# 배포가 겹치면 디렉터리 교체가 꼬인다. 잠금(fd 9)은 아래에서 띄운 배포 프로세스가 끝날 때까지 유지된다
exec 9>"$HOME/.cropy-deploy.lock"
if ! flock -n 9; then
  echo "다른 배포가 진행 중입니다" >&2
  exit 75
fi

rm -rf "$HOME/Cropy.new"
mkdir -p "$HOME/Cropy.new"
tar xz -C "$HOME/Cropy.new"

mkdir -p "$HOME/deploy-logs"
log="$HOME/deploy-logs/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:7}-$mode.log"
# 로그는 최근 20개만 남긴다
find "$HOME/deploy-logs" -name '*.log' -printf '%T@ %p\n' | sort -rn | tail -n +21 | cut -d' ' -f2- | xargs -r rm -f

# SSH 연결이 끊겨도(러너 취소·타임아웃·네트워크) 교체 도중에 죽지 않도록 배포를 세션에서 떼어 내
# 파일로만 출력하게 하고, 여기서는 그 로그를 보여 주며 끝나기를 기다린다
: >"$log"
setsid bash "$HOME/Cropy.new/deploy/remote-update.sh" "$mode" "$sha" >>"$log" 2>&1 </dev/null &
pid=$!
tail -n +1 -f --pid="$pid" "$log" || true
wait "$pid"
