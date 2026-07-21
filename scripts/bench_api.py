#!/usr/bin/env python3
"""로컬 서버 대상 지연(latency) 벤치 — p50/p95/p99 표 출력.

대상 엔드포인트(각 N회, 기본 100):
  - POST /api/assess       (P1 페이로드: 10세·기초수급·성북구·비장애)
  - POST /api/assess       (P4 페이로드: 72세·청각장애·성북구, 연령초과)
  - POST /api/fitness       (27세·남 4항목 측정값)
  - GET  /api/fitness/items (age=27)

이미 떠 있는 서버를 때린다(서버를 띄우지 않는다). 순차 호출로 '요청당 지연'을
측정한다(NFR-1: p95 < 500ms). 표준 라이브러리만 사용.

사용:
  python scripts/bench_api.py [--base-url http://127.0.0.1:8100] [--n 100]

레이트리밋 때문에 순차 400+회가 429 로 막히지 않도록, 벤치 대상 서버는
SPONAVI_RATE_LIMIT=off 로 띄우는 것을 권장(원지연 측정 목적).
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request

P1_BODY = {
    "age": 10, "sex": "F",
    "sigungu_cd": "11290", "sigungu_nm": "성북구",
    "income_class": "기초생활수급",
    "disability": {"has": False, "type": None},
}
P4_BODY = {
    "age": 72, "sex": "M",
    "sigungu_cd": "11290", "sigungu_nm": "성북구",
    "income_class": "그외",
    "disability": {"has": True, "type": "청각"},
}
FITNESS_BODY = {
    "age": 27, "sex": "M",
    "measures": {"grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25},
}


def _call(url: str, body: dict | None) -> tuple[int, float]:
    """단일 호출 → (status, elapsed_ms). 예외는 (0, elapsed) 로 신호."""
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if body is not None else "GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        e.read()
        status = e.code
    except Exception:
        status = 0
    return status, (time.perf_counter() - t0) * 1000.0


def _pct(values: list[float], p: float) -> float:
    """가장 가까운 순위(nearest-rank) 백분위수."""
    if not values:
        return float("nan")
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(p / 100.0 * len(s) + 0.5)) - 1))
    return s[k]


def bench(base: str, name: str, path: str, body: dict | None, n: int) -> dict:
    url = base.rstrip("/") + path
    # 워밍업(코드 캐시/커넥션) — 측정 제외
    for _ in range(3):
        _call(url, body)
    samples: list[float] = []
    statuses: dict[int, int] = {}
    for _ in range(n):
        st, ms = _call(url, body)
        samples.append(ms)
        statuses[st] = statuses.get(st, 0) + 1
    ok = statuses.get(200, 0)
    return {
        "name": name,
        "n": n,
        "ok": ok,
        "statuses": statuses,
        "p50": _pct(samples, 50),
        "p95": _pct(samples, 95),
        "p99": _pct(samples, 99),
        "min": min(samples),
        "max": max(samples),
        "mean": statistics.fmean(samples),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="SpoNavi API latency bench (p50/p95/p99)")
    ap.add_argument("--base-url", default="http://127.0.0.1:8100")
    ap.add_argument("--n", type=int, default=100)
    args = ap.parse_args()

    targets = [
        ("POST /api/assess (P1)", "/api/assess", P1_BODY),
        ("POST /api/assess (P4)", "/api/assess", P4_BODY),
        ("POST /api/fitness", "/api/fitness", FITNESS_BODY),
        ("GET  /api/fitness/items?age=27", "/api/fitness/items?age=27", None),
    ]

    # 서버 헬스 확인
    hs, _ = _call(args.base_url.rstrip("/") + "/api/health", None)
    if hs != 200:
        print(f"[!] 서버 헬스 실패(status={hs}) @ {args.base_url} — 서버가 떠 있는지 확인")
        return 2

    rows = [bench(args.base_url, name, path, body, args.n) for name, path, body in targets]

    NFR_P95 = 500.0
    print(f"\nSpoNavi API 벤치 — base={args.base_url}, n={args.n}/endpoint (ms)\n")
    header = f"{'endpoint':32} {'n':>4} {'ok':>4} {'p50':>8} {'p95':>8} {'p99':>8} {'max':>9}  status"
    print(header)
    print("-" * len(header))
    breaches = []
    for r in rows:
        flag = "  <-- p95>NFR" if r["p95"] > NFR_P95 else ""
        if r["p95"] > NFR_P95:
            breaches.append(r)
        st = ",".join(f"{k}:{v}" for k, v in sorted(r["statuses"].items()))
        print(f"{r['name']:32} {r['n']:>4} {r['ok']:>4} "
              f"{r['p50']:>8.1f} {r['p95']:>8.1f} {r['p99']:>8.1f} {r['max']:>9.1f}  {st}{flag}")
    print(f"\nNFR-1 임계: p95 < {NFR_P95:.0f}ms")
    if breaches:
        print(f"[!] p95 초과 {len(breaches)}건 — 원인 분석 필요(인덱스/쿼리):")
        for r in breaches:
            print(f"    - {r['name']}: p95={r['p95']:.1f}ms")
    else:
        print("[OK] 모든 엔드포인트 p95 < 임계")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
