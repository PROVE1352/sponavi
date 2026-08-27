#!/usr/bin/env bash
# 스포내비 배포: 로컬 빌드 → rsync → 서버 docker build/up → 워치독 설치 → (DNS 있으면) Caddy → 스모크
#
# 사용:
#   bash deploy/deploy.sh              # 코드만 배포 — 서버 DB 는 건드리지 않는다(기본)
#   bash deploy/deploy.sh --with-db    # 코드 + data/sponavi.db 푸시 — '의도한' 데이터 갱신에만
#
# 기본 배포가 `--exclude 'data/sponavi.db*'` 로 DB 를 아예 빼는 이유(결정 5A):
#   예전엔 코드만 고쳐도 매번 로컬 DB(+ -shm/-wal)가 서버로 따라 올라가서, 서버 정본을
#   로컬 테스트 DB 로 덮어쓰는 사고가 항상 한 발짝 앞에 있었다. 이제 데이터 푸시는 명시적이다.
# FREEZE.sha 규약(결정 OV7)과 --with-db 를 언제 쓰는지는 deploy/README.md 참고.
#
# ssh host: stockllm = 오라클 A1
set -euo pipefail
HOST=stockllm
REMOTE_DIR='~/sponavi'
DOMAIN=sponavi.kro.kr
DB_REL='data/sponavi.db'
FREEZE_REL='data/FREEZE.sha'
HEALTH_URL='http://127.0.0.1:8100/api/health'

WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    -h|--help) echo "사용: deploy.sh [--with-db]"; exit 0 ;;
    *) echo "알 수 없는 인자: $arg" >&2; echo "사용: deploy.sh [--with-db]" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

# --- 헬퍼 -------------------------------------------------------------------
is_sha256() { printf '%s' "${1:-}" | grep -Eq '^[0-9a-f]{64}$'; }

# 서버 DB 지문(캐시 테이블 제외 .dump sha256). rsync 가 scripts/ 를 올려두므로 서버에서 같은
# 스크립트를 돌린다 — 로컬/서버가 같은 방식으로 계산해야 대조가 의미 있다.
# 성공: 지문 64자를 stdout 으로. 실패: non-zero + 실패 사유를 stdout 으로(호출부가 그대로 보여준다).
server_fingerprint() {
  ssh "$HOST" "bash $REMOTE_DIR/scripts/db_fingerprint.sh $REMOTE_DIR/$DB_REL" 2>&1
}

# /api/health 한 방 — 서버 안에서 컨테이너 포트로 직접(외부 도메인·Caddy 와 무관하게).
health_json() { ssh "$HOST" "curl -sf $HEALTH_URL" 2>/dev/null || true; }

# 문자열 필드 1개만 뽑는다(jq 의존 없이). 값이 null 이거나 없으면 빈 문자열.
health_field() {
  printf '%s' "${1:-}" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

# 빌드 스탬프(관측 가능성): 로컬 git short hash 를 컨테이너에 주입한다.
# (rsync 가 .git 을 제외하므로 서버에선 git 조회 불가 → 여기서 캡처해 넘긴다.)
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "== GIT_SHA=$GIT_SHA / 모드=$([ "$WITH_DB" -eq 1 ] && echo '코드+DB(--with-db)' || echo '코드만') =="

# --- 0. FREEZE 대조 (기본 배포에서만, rsync 전) -------------------------------
# 정본 = '마지막 --with-db 푸시 직후의 프로덕션 DB'. 그 시점 지문이 data/FREEZE.sha 다.
if [ "$WITH_DB" -eq 0 ] && [ -f "$FREEZE_REL" ]; then
  echo "== 0. FREEZE 대조 =="
  FROZEN="$(tr -d ' \t\r\n' < "$FREEZE_REL")"
  CURRENT="$(server_fingerprint || true)"
  if ! is_sha256 "$CURRENT"; then
    echo "[!] 서버 지문 계산 실패 — 대조를 건너뛴다."
    echo "    이유: ${CURRENT:-(출력 없음)}"
    echo "    (서버에 sqlite3 가 없으면: ssh $HOST 'sudo apt-get install -y sqlite3')"
    echo "    기본 배포는 서버 DB 를 건드리지 않으므로 그대로 진행한다."
  elif [ "$CURRENT" = "$FROZEN" ]; then
    echo "OK — 서버 DB = 프리즈 정본 ($FROZEN)"
  else
    echo "[!] 서버 DB 가 프리즈 정본과 다르다."
    echo "    FREEZE.sha(로컬): $FROZEN"
    echo "    서버 현재 지문   : $CURRENT"
    echo "    정본은 '마지막 --with-db 푸시 직후의 프로덕션 DB' 다 —"
    echo "    즉 그 뒤로 서버 DB 가 바뀌었거나(누가 밀었거나 갱신했거나), FREEZE.sha 가 낡았다."
    echo "    이번 배포는 코드만 올리므로 DB 를 덮어쓰지는 않는다(컨테이너는 재기동된다)."
    if [ -t 0 ]; then
      printf '계속 진행할까? [y/N] '
      read -r ANS
      case "$ANS" in
        y|Y|yes|YES) ;;
        *) echo "중단."; exit 1 ;;
      esac
    else
      echo "중단 — 비대화형 셸에서는 사람 확인 없이 진행하지 않는다."
      exit 1
    fi
  fi
fi

echo "== 1. 웹 빌드 =="
# VITE_MOCK=0 강제 — web/.env 에 남은 VITE_MOCK=1 이 목 번들을 몰래 굽는 사고 방지
# (2026-08-18 실배포에서 발생: 셸 env 가 .env 보다 우선이므로 여기서 못박는다)
(cd web && VITE_MOCK=0 npm run build)

echo "== 2. rsync (코드) =="
# data/sponavi.db* 제외 = 본체·-shm·-wal 전부 제외. --delete 는 '제외된 파일'을 지우지 않으므로
# (--delete-excluded 를 안 쓴다) 서버의 DB 는 그대로 살아 있다.
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude '.venv' \
  --exclude data/raw --exclude web/e2e-shots --exclude '__pycache__' \
  --exclude 'data/sponavi.db*' \
  ./ "$HOST:$REMOTE_DIR/"

DATA_BUILT_BEFORE=''
if [ "$WITH_DB" -eq 1 ]; then
  echo "== 2b. DB 푸시 준비 =="
  [ -f "$DB_REL" ] || { echo "없음: $DB_REL — 밀 DB 가 로컬에 없다." >&2; exit 1; }

  # 푸시 직전 서버의 data_built 를 잡아둔다(5b 에서 '정말 바뀌었나' 비교용).
  DATA_BUILT_BEFORE="$(health_field "$(health_json)" data_built)"
  echo "푸시 전 서버 data_built: ${DATA_BUILT_BEFORE:-(못 읽음)}"

  # WAL 을 본체 파일에 접어넣는다 — 본체 1개만 올려도 완전하도록.
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_REL" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
    echo "wal_checkpoint(TRUNCATE) 완료"
  elif [ -f "$DB_REL-wal" ]; then
    echo "[X] sqlite3 가 없는데 $DB_REL-wal 이 있다 — 체크포인트를 못 해서" >&2
    echo "    본체만 올리면 최근 트랜잭션이 빠진 DB 가 올라간다. sqlite3 설치 후 다시." >&2
    exit 1
  fi

  echo "== 2c. rsync (DB 본체 1개만) =="
  # -shm/-wal 은 절대 올리지 않는다:
  #   · -wal/-shm 은 '그 순간의 본체 파일'과 짝(솔트·체크섬)이다. 따로 복사해 붙이면 서버
  #     SQLite 가 남의 WAL 을 되감아 DB 를 깨뜨리거나 유령 데이터를 읽는다.
  #   · 위에서 체크포인트로 다 접어넣었으니 본체만으로 완전하다.
  #   · 서버 컨테이너는 이 파일을 :ro 로 물고 있어 -wal 을 만들지도 않는다(compose 참고).
  # --inplace: '단일 파일 바인드마운트' 라 inode 가 바뀌면 컨테이너가 새 내용을 못 본다
  #            (refresh_data.sh:79 와 같은 이유).
  # --ignore-times: rsync 기본 판정은 '크기 + mtime(1초 단위)' 이라, 크기가 같고 같은 초에
  #            만들어진 DB 는 내용이 달라도 조용히 건너뛴다(로컬 실측). --with-db 는 사람이
  #            일부러 미는 것이므로 판정을 건너뛰고 무조건 보낸다(전송량은 델타로 줄어든다).
  rsync -az --inplace --ignore-times "$DB_REL" "$HOST:$REMOTE_DIR/$DB_REL"
fi

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

if [ "$WITH_DB" -eq 1 ]; then
  echo "== 5b. data_built 변화 확인 (--with-db) =="
  DATA_BUILT_AFTER="$(health_field "$(health_json)" data_built)"
  echo "  before: ${DATA_BUILT_BEFORE:-(못 읽음)}"
  echo "  after : ${DATA_BUILT_AFTER:-(못 읽음)}"
  if [ -z "$DATA_BUILT_AFTER" ]; then
    echo "[X] 실패 — 배포 후 /api/health 에서 data_built 를 못 읽었다." >&2
    exit 1
  fi
  if [ "$DATA_BUILT_AFTER" = "$DATA_BUILT_BEFORE" ]; then
    echo "[X] 실패 — data_built 가 그대로다. 새 DB 가 컨테이너에 반영되지 않았다." >&2
    echo "    확인: 바인드마운트 inode(--inplace), 서버 파일 권한, 그리고 애초에 로컬 DB 가" >&2
    echo "    서버와 다른 내용이었는지(내용이 같으면 mtime 까지 같아 data_built 도 안 변한다)." >&2
    exit 1
  fi
  echo "OK — 새 DB 반영됨"

  echo "== 5c. FREEZE.sha 기록 (--with-db) =="
  # 지문은 '서버에서' 계산한다 — 정본은 로컬 파일이 아니라 프로덕션에 올라간 그 DB 다.
  FP="$(server_fingerprint || true)"
  if is_sha256 "$FP"; then
    printf '%s\n' "$FP" > "$FREEZE_REL"
    ssh "$HOST" "printf '%s\n' '$FP' > $REMOTE_DIR/$FREEZE_REL"
    echo "FREEZE.sha = $FP"
    echo "  로컬: $FREEZE_REL  (커밋해 두면 다음 기본 배포부터 자동 대조)"
    echo "  서버: $REMOTE_DIR/$FREEZE_REL"
  else
    echo "[!] 서버 지문 계산 실패 — FREEZE.sha 를 기록하지 못했다(배포 자체는 성공)."
    echo "    이유: ${FP:-(출력 없음)}"
    echo "    고친 뒤 서버에서 직접 계산해 양쪽에 적어라:"
    echo "      ssh $HOST 'bash $REMOTE_DIR/scripts/db_fingerprint.sh $REMOTE_DIR/$DB_REL'"
  fi
fi

echo "== 6. Caddy 라우트 (DNS 등록돼 있을 때만) =="
if nslookup "$DOMAIN" >/dev/null 2>&1; then
  ssh "$HOST" "grep -q '$DOMAIN' /etc/caddy/Caddyfile || { printf '\n%s {\n\treverse_proxy 127.0.0.1:8100\n}\n' '$DOMAIN' | sudo tee -a /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy; }"
  echo "https://$DOMAIN 라우트 적용"
else
  echo "SKIP: $DOMAIN 미등록(NXDOMAIN) — 내도메인.한국에서 A레코드 193.123.163.215 등록 후 재실행하면 라우트만 추가됨"
fi
echo "== 완료 =="
