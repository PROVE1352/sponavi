#!/usr/bin/env bash
# 스포내비 배포: 로컬 빌드 → rsync → 서버 docker build/up → (DNS 있으면) Caddy 라우트 → 스모크
# 사용: bash deploy/deploy.sh   (ssh host: stockllm = 오라클 A1)
set -euo pipefail
HOST=stockllm
REMOTE_DIR='~/sponavi'
DOMAIN=sponavi.kro.kr

cd "$(dirname "$0")/.."

echo "== 1. 웹 빌드 =="
(cd web && npm run build)

echo "== 2. rsync =="
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude '.venv' \
  --exclude data/raw --exclude web/e2e-shots --exclude '__pycache__' \
  ./ "$HOST:$REMOTE_DIR/"

echo "== 3. 서버 빌드·기동 =="
ssh "$HOST" "cd $REMOTE_DIR && docker compose -f deploy/compose.sponavi.yaml up -d --build"

echo "== 4. 컨테이너 스모크 =="
ssh "$HOST" 'sleep 3; curl -sf http://127.0.0.1:8100/api/health && echo && curl -sf -o /dev/null -w "static %{http_code}\n" http://127.0.0.1:8100/'

echo "== 5. Caddy 라우트 (DNS 등록돼 있을 때만) =="
if nslookup "$DOMAIN" >/dev/null 2>&1; then
  ssh "$HOST" "grep -q '$DOMAIN' /etc/caddy/Caddyfile || { printf '\n%s {\n\treverse_proxy 127.0.0.1:8100\n}\n' '$DOMAIN' | sudo tee -a /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy; }"
  echo "https://$DOMAIN 라우트 적용"
else
  echo "SKIP: $DOMAIN 미등록(NXDOMAIN) — 내도메인.한국에서 A레코드 193.123.163.215 등록 후 재실행하면 라우트만 추가됨"
fi
echo "== 완료 =="
