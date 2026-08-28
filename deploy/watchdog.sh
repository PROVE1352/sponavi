#!/usr/bin/env bash
# 되나요 워치독: 컨테이너 헬스 실패 시 자동 재시작 + 로그 한 줄.
# systemd timer(5분 주기)로 호출된다. 멱등 — 정상/기동중이면 아무 것도 안 한다.
set -euo pipefail

CONTAINER="${SPONAVI_CONTAINER:-sponavi}"
LOG="${SPONAVI_WATCHDOG_LOG:-/var/log/sponavi-watchdog.log}"

ts() { date -Is; }

# 헬스 상태 조회. 컨테이너가 없거나 헬스체크 미정의면 빈 값/에러 → "missing".
status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"

case "$status" in
  healthy|starting|running)
    # 정상(healthy) 또는 기동 유예(starting) 또는 헬스 미정의 running — 개입 안 함.
    exit 0
    ;;
  *)
    # unhealthy | exited | missing | created 등 → 재시작 시도(+한 줄 기록).
    if docker restart "$CONTAINER" >/dev/null 2>&1; then
      action="restart-ok"
    else
      action="restart-failed"
    fi
    echo "$(ts) container=$CONTAINER status=$status action=$action" >> "$LOG" 2>/dev/null || true
    ;;
esac
