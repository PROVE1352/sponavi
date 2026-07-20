#!/usr/bin/env python3
"""전국 벌크 다운로드 — 5개 KSPO API의 전 페이지를 data/raw/<key>.json 으로.
API 필터 파라미터가 엔드포인트마다 제각각이라 필터 없이 전량 수신 후 SQLite에서 쿼리한다.
페이지당 1000행 상한(실측). 데이터셋마다 완료 즉시 저장(중단 안전). 진행 로그 stderr.
"""
import json, os, ssl, sys, time, urllib.request, urllib.parse, urllib.error
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
KEY = None
for line in (Path(__file__).resolve().parent.parent / ".env").read_text().splitlines():
    if line.startswith("DATA_GO_KR_KEY="):
        KEY = line.split("=", 1)[1].strip()
if not KEY:
    sys.exit("DATA_GO_KR_KEY 없음")

CTX = ssl.create_default_context()
PER = 1000
TIMEOUT = 60
RETRY = 6

APIS = {
    "voucher_facility":  "SRVC_OD_API_FACIL_MNG/todz_api_facil_mng_i",
    "voucher_course":    "SRVC_OD_API_FACIL_COURSE/todz_api_facil_course_i",
    "dvoucher_facility": "SRVC_OD_API_FACIL_MNG_DVOUCHER/TODZ_API_MNG_DVOUCHER_I",
    "dvoucher_course":   "SRVC_DVOUCHER_FACI_COURSE/TODZ_DVOUCHER_FACI_COURSE",
    "public_facility":   "SRVC_API_SFMS_FACI/TODZ_API_SFMS_FACI",
}


def _get(url):
    last = None
    for attempt in range(1, RETRY + 1):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last = e
            time.sleep(2.0 * attempt)
    raise RuntimeError(f"{RETRY}회 실패: {last}")


def _items(payload):
    body = (payload.get("response") or {}).get("body") or {}
    items = body.get("items")
    total = body.get("totalCount")
    if isinstance(items, dict):
        it = items.get("item", [])
        return ([it] if isinstance(it, dict) else it), total
    if isinstance(items, list):
        return items, total
    return [], total


def fetch(key, path):
    base = f"https://apis.data.go.kr/B551014/{path}"
    out, page, total = [], 1, None
    while True:
        url = base + "?" + urllib.parse.urlencode(
            {"serviceKey": KEY, "pageNo": page, "numOfRows": PER, "resultType": "json"})
        rows, total = _items(_get(url))
        if not rows:
            break
        out.extend(rows)
        if page == 1 or page % 10 == 0:
            print(f"  [{key}] page {page} · 누적 {len(out)}/{total}", file=sys.stderr, flush=True)
        if total is not None and len(out) >= int(total):
            break
        if len(rows) < PER:
            break
        page += 1
        time.sleep(0.15)
    return out


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    t0 = time.time()
    for key, path in APIS.items():
        if only and key != only:
            continue
        dest = RAW / f"{key}.json"
        if dest.exists() and os.environ.get("SKIP_EXISTING"):
            print(f"[skip] {key} (존재)", file=sys.stderr); continue
        print(f"[fetch] {key} ...", file=sys.stderr, flush=True)
        rows = fetch(key, path)
        dest.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        print(f"[done] {key}: {len(rows)}행 → {dest.name} ({time.time()-t0:.0f}s 누적)", file=sys.stderr, flush=True)
    print(f"전체 완료 {time.time()-t0:.0f}s", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
