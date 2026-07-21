#!/usr/bin/env bash
# 스포내비 월간 데이터 갱신 — 원커맨드(로컬 실행 전용, 수동 트리거).
#
# 파이프라인(순서 고정):
#   bulk_fetch → build_db → load_accessibility → scrape_norms
#   → fetch_videos --load-only → build_graph → (서버 테스트 검증)
#   → rsync db → 컨테이너 재시작
#
# ⚠️ bulk_fetch / scrape_norms 는 외부 공공 API 를 호출한다(키·호출량 존재).
#    그래서 cron 자동 등록을 '하지 않는다' — 사람이 확인하고 수동 실행한다.
#
# 사용:
#   bash scripts/refresh_data.sh              # 전체(외부 fetch 포함) + 배포
#   SKIP_FETCH=1 bash scripts/refresh_data.sh # 기존 data/raw 로 재빌드만(네트워크 X)
#   NO_DEPLOY=1 bash scripts/refresh_data.sh  # 빌드·검증만, rsync/재시작 생략
#
# 환경변수:
#   PYTHON      스크립트 실행 파이썬(기본 python3)
#   HOST        배포 대상 ssh 호스트(기본 stockllm)
#   REMOTE_DIR  원격 리포 경로(기본 ~/sponavi)
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PYTHON="${PYTHON:-python3}"
HOST="${HOST:-stockllm}"
REMOTE_DIR="${REMOTE_DIR:-~/sponavi}"
DB="data/sponavi.db"
PYTEST="server/.venv/bin/pytest"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# --- 1. ETL 파이프라인 --------------------------------------------------------
if [ "${SKIP_FETCH:-0}" = "1" ]; then
  step "1. bulk_fetch  [SKIP_FETCH=1 — 건너뜀]"
else
  step "1. bulk_fetch (외부 공공 API 호출)"
  "$PYTHON" scripts/bulk_fetch.py
fi

step "2. build_db → $DB"
"$PYTHON" scripts/build_db.py --out "$DB"

step "3. load_accessibility (dvoucher 웹 보조 소스)"
"$PYTHON" scripts/load_accessibility.py --json data/raw/dvoucher_web_accessibility.json --db "$DB"

if [ "${SKIP_FETCH:-0}" = "1" ]; then
  step "4. scrape_norms  [SKIP_FETCH=1 — 건너뜀]"
else
  step "4. scrape_norms (국민체력100 인증기준)"
  "$PYTHON" scripts/scrape_norms.py --db "$DB"
fi

step "5. fetch_videos --load-only (raw → DB, 네트워크 없음)"
"$PYTHON" scripts/fetch_videos.py --load-only --db "$DB"

step "6. build_graph (체력 지식그래프)"
"$PYTHON" scripts/build_graph.py --db "$DB"

# --- 2. 검증(신규 DB 로 서버 테스트) -----------------------------------------
step "7. 테스트 검증 (server && pytest -q)"
if [ -x "$PYTEST" ]; then
  ( cd server && .venv/bin/pytest -q )
else
  echo "[!] $PYTEST 없음 — server/.venv 를 먼저 만드세요(python -m venv). 검증 생략 불가 → 중단."
  exit 1
fi

# --- 3. 배포(rsync db → 재시작) ----------------------------------------------
if [ "${NO_DEPLOY:-0}" = "1" ]; then
  step "8. 배포 [NO_DEPLOY=1 — rsync/재시작 생략]"
  echo "로컬 빌드·검증 완료: $ROOT/$DB"
  exit 0
fi

step "8. rsync DB → $HOST:$REMOTE_DIR/$DB (단일 파일 바인드마운트 → --inplace)"
# --inplace: 바인드마운트된 파일의 inode 를 유지해 컨테이너가 새 내용을 확실히 읽게 한다.
rsync -az --inplace "$DB" "$HOST:$REMOTE_DIR/$DB"

step "9. 컨테이너 재시작 (새 DB 반영)"
ssh "$HOST" "cd $REMOTE_DIR && docker compose -f deploy/compose.sponavi.yaml restart"

step "10. 스모크"
ssh "$HOST" 'sleep 3; curl -sf http://127.0.0.1:8100/api/health && echo'

echo
echo "완료 — 월간 갱신 반영됨."
