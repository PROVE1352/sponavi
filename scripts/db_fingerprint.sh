#!/usr/bin/env bash
# 스포내비 DB 지문 — '캐시 테이블을 뺀 .dump' 의 sha256 (결정 OV7).
#
# 왜 파일 해시가 아니라 덤프 해시인가:
#   · 같은 데이터라도 VACUUM·페이지 배치·mtime 때문에 파일 바이트는 달라진다.
#   · `fitness_ai_cache` 는 로컬에서 pytest 를 돌릴 때마다 행이 늘어난다.
#     → 이름에 'cache' 가 든 테이블은 전부 지문에서 뺀다.
#
# 사용:
#   bash scripts/db_fingerprint.sh [db경로]     # 기본 data/sponavi.db
#   표준출력 = sha256 64자 한 줄(파이프로 받기 쉽게). 진단 메시지는 전부 stderr.
#
# 종료코드: 0 성공 / 2 인자·파일 문제 / 3 의존성 없음(sqlite3·sha 도구) / 4 지문 계산 실패
set -euo pipefail

case "${1:-}" in
  -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
esac

DB="${1:-data/sponavi.db}"

die() { printf 'db_fingerprint: %s\n' "$2" >&2; exit "$1"; }

command -v sqlite3 >/dev/null 2>&1 \
  || die 3 "sqlite3 없음 — 맥: brew install sqlite / 우분투: sudo apt-get install -y sqlite3"

# sha256 도구 감지: 우분투 sha256sum, 맥 shasum -a 256 (둘 다 '<해시>  -' 형식으로 찍는다)
if command -v sha256sum >/dev/null 2>&1; then
  SHA=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  SHA=(shasum -a 256)
else
  die 3 "sha256sum(우분투)도 shasum(맥)도 없다"
fi

[ -f "$DB" ] || die 2 "DB 파일 없음: $DB"

# 무결성 게이트(2026-08-28 사고): 남의 WAL 을 되감은 DB 도 .dump 는 그럴듯하게 나와 지문이 '일치'로
# 보일 수 있다. 지문 전에 quick_check 가 ok 가 아니면 손상으로 보고 실패시킨다.
QC="$(sqlite3 "$DB" 'PRAGMA quick_check;' 2>&1 | head -1)"
[ "$QC" = "ok" ] || die 4 "DB 손상(quick_check): $QC — -wal/-shm 잔존 여부 확인 후 --with-db 로 다시 밀어라"

# 대상 테이블: sqlite 내부 테이블 제외 + 이름에 cache 가 든 테이블 제외, 이름 오름차순 고정.
# (정렬을 고정해야 맥/우분투·로컬/서버가 같은 순서로 덤프한다.)
TABLES="$(sqlite3 "$DB" \
  "SELECT name FROM sqlite_master WHERE type='table' \
     AND name NOT LIKE 'sqlite\_%' ESCAPE '\' \
     AND lower(name) NOT LIKE '%cache%' ORDER BY name;")"
CACHE_TABLES="$(sqlite3 "$DB" \
  "SELECT name FROM sqlite_master WHERE type='table' \
     AND lower(name) LIKE '%cache%' ORDER BY name;")"

[ -n "$TABLES" ] || die 4 "지문 대상 테이블이 없다(빈 DB?): $DB"

TMP="$(mktemp "${TMPDIR:-/tmp}/sponavi-fp.XXXXXX")"
trap 'rm -f "$TMP"' EXIT INT TERM

# 파이프 대신 임시파일에 모은다 — 파이프 안 서브셸에서 sqlite3 가 죽으면
# 잘린 덤프로 '조용히 틀린' 해시가 나오기 때문(set -e 가 바깥까지 못 온다).
while IFS= read -r t; do
  [ -n "$t" ] || continue
  printf -- '-- table: %s\n' "$t" >>"$TMP"
  sqlite3 "$DB" ".dump '$t'" >>"$TMP"
done <<EOF
$TABLES
EOF

# ⚠️ sqlite3 의 `.dump <이름>` 은 이름을 LIKE 패턴으로 해석한다 — '_' 가 임의 1글자 와일드카드다.
#    (3.51 실측: `.dump fitness_ai_cache` 가 fitnessXaiXcache 까지 함께 뱉는다. 따옴표를 씌워도 같다.)
#    우리 테이블 이름엔 '_' 가 흔하므로, 빼기로 한 캐시 테이블이 덤프에 섞였는지 확인하고 시끄럽게 죽는다.
while IFS= read -r c; do
  [ -n "$c" ] || continue
  if grep -Eq '^CREATE TABLE ("|\[)?'"$c"'("|\])?[ (]' "$TMP"; then
    die 4 "캐시 테이블 '$c' 가 덤프에 섞였다(.dump 의 '_' 와일드카드 충돌) — 지문을 신뢰할 수 없다"
  fi
done <<EOF
$CACHE_TABLES
EOF

"${SHA[@]}" < "$TMP" | awk '{print $1}'
