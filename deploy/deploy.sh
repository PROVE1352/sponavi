#!/usr/bin/env bash
# 스포내비 배포: 로컬 빌드 → rsync → 서버 docker build/up → 워치독 설치 → (DNS 있으면) Caddy → 스모크
# 사용: bash deploy/deploy.sh   (ssh host: stockllm = 오라클 A1)
set -euo pipefail
HOST=stockllm
REMOTE_DIR='~/sponavi'
DOMAIN=sponavi.kro.kr

cd "$(dirname "$0")/.."

# 빌드 스탬프(관측 가능성): 로컬 git short hash 를 컨테이너에 주입한다.
# (rsync 가 .git 을 제외하므로 서버에선 git 조회 불가 → 여기서 캡처해 넘긴다.)
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "== GIT_SHA=$GIT_SHA =="

echo "== 1. 웹 빌드 =="
# VITE_MOCK=0 강제 — web/.env 에 남은 VITE_MOCK=1 이 목 번들을 몰래 굽는 사고 방지
# (2026-08-18 실배포에서 발생: 셸 env 가 .env 보다 우선이므로 여기서 못박는다)
(cd web && VITE_MOCK=0 npm run build)

echo "== 2. rsync =="
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude '.venv' \
  --exclude data/raw --exclude web/e2e-shots --exclude '__pycache__' \
  ./ "$HOST:$REMOTE_DIR/"

echo "== 3. 서버 빌드·기동 =="
ssh "$HOST" "cd $REMOTE_DIR && GIT_SHA=$GIT_SHA docker compose -f deploy/compose.sponavi.yaml up -d --build"

echo "== 4. 워치독 설치(systemd 5분 주기, 멱등) =="
ssh "$HOST" "bash -s" <<'REMOTE'
set -euo pipefail
sudo install -d -m 755 /opt/sponavi
sudo install -m 755 ~/sponavi/deploy/watchdog.sh                /opt/sponavi/watchdog.sh
sudo install -m 644 ~/sponavi/deploy/sponavi-watchdog.service   /etc/systemd/system/sponavi-watchdog.service
sudo install -m 644 ~/sponavi/deploy/sponavi-watchdog.timer     /etc/systemd/system/sponavi-watchdog.timer
sudo systemctl daemon-reload
sudo systemctl enable --now sponavi-watchdog.timer
sudo systemctl status --no-pager sponavi-watchdog.timer | head -3 || true
REMOTE

echo "== 5. 컨테이너 스모크 =="
ssh "$HOST" 'sleep 3; curl -sf http://127.0.0.1:8100/api/health && echo && curl -sf -o /dev/null -w "static %{http_code}\n" http://127.0.0.1:8100/'

echo "== 6. Caddy 라우트 (DNS 등록돼 있을 때만) =="
if nslookup "$DOMAIN" >/dev/null 2>&1; then
  ssh "$HOST" "grep -q '$DOMAIN' /etc/caddy/Caddyfile || { printf '\n%s {\n\treverse_proxy 127.0.0.1:8100\n}\n' '$DOMAIN' | sudo tee -a /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy; }"
  echo "https://$DOMAIN 라우트 적용"
else
  echo "SKIP: $DOMAIN 미등록(NXDOMAIN) — 내도메인.한국에서 A레코드 193.123.163.215 등록 후 재실행하면 라우트만 추가됨"
fi
echo "== 완료 =="
