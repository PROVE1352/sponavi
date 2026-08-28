#!/usr/bin/env bash
# 되나요 업타임 프로브(W3, 설계문서 OV/Reviewer Concern 2) — 맥 launchd 가 5분마다 실행.
# 워치독(systemd)은 컨테이너 헬스만 재시작하고 VM 프리즈(8/3 stockllm 사례)는 못 잡으므로 외부에서 찌른다.
# 실패 시: macOS 알림 + 로그 1줄. 성공 시: 로그 1줄(조용). 연속 실패 3회부터 알림(깜빡임 억제).
set -u
URL="${SPONAVI_PROBE_URL:-https://doenayo.kro.kr/api/health}"
LOG="${HOME}/Library/Logs/sponavi-uptime.log"
STATE="${HOME}/Library/Logs/sponavi-uptime.state"
mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%d %H:%M:%S'; }
code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null); code="${code:-000}"
fails=$(cat "$STATE" 2>/dev/null || echo 0)
if [ "$code" = "200" ]; then
  [ "$fails" -ge 3 ] && osascript -e 'display notification "복구됨 ('"$URL"')" with title "되나요 업타임"' >/dev/null 2>&1
  echo 0 > "$STATE"; echo "$(ts) OK 200" >> "$LOG"; exit 0
fi
fails=$((fails+1)); echo "$fails" > "$STATE"; echo "$(ts) FAIL http=$code (연속 $fails)" >> "$LOG"
if [ "$fails" -eq 3 ] || [ $((fails % 12)) -eq 0 ]; then
  osascript -e 'display notification "http='"$code"' 연속 '"$fails"'회 — ssh stockllm 확인" with title "되나요 다운 의심" sound name "Basso"' >/dev/null 2>&1
fi
exit 1
