"""지도 범위 검색 성능 측정(계약 §4.5) — 기본은 skip.

실행(실 DB 는 immutable 읽기 전용으로만 연다):

    SPONAVI_DB=/nonexistent SPONAVI_RO_DB=/Users/kyuchan/sponavi/data/sponavi.db \\
    SPONAVI_BENCH=1 .venv/bin/python -m pytest tests/test_area_perf.py -s

목표(로컬 Apple Silicon, 인덱스 빌드 뒤): engine.area_search 1회 p95 ≤ 5ms(재조회·직렬화 포함),
빌드 ≤ 3초, tracemalloc current ≤ 40MB. 단언은 느슨하게(p95 ≤ 20ms, 빌드 ≤ 5초, current ≤ 60MB).
"""
from __future__ import annotations

import bisect
import math
import os
import random
import resource
import sqlite3
import statistics
import sys
import time
import tracemalloc
from pathlib import Path

import pytest

import app.main as main_mod
from app import engine
from app import store as store_mod
from app.area_index import AreaIndex

pytestmark = pytest.mark.skipif(
    os.environ.get("SPONAVI_BENCH") != "1", reason="SPONAVI_BENCH=1 일 때만 측정한다"
)

_MAXRSS_SCALE = 1 if sys.platform == "darwin" else 1024  # macOS=bytes, Linux=KiB


@pytest.fixture(autouse=True)
def _guard_get_store(monkeypatch):
    def _unpatched():
        raise AssertionError("app.main.get_store 가 패치되지 않았다(실 DB 보호)")

    monkeypatch.setattr(main_mod, "get_store", _unpatched)


def _open_ro_db_store() -> store_mod.Store | None:
    path = Path(os.environ.get("SPONAVI_RO_DB") or (store_mod.data_dir() / "sponavi.db"))
    if not path.exists():
        return None
    conn = store_mod.connect_shared(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        conn.execute("SELECT rowid, coord_source FROM facilities LIMIT 1").fetchall()
    except sqlite3.Error:
        conn.close()
        return None
    ddir = store_mod.data_dir()
    return store_mod.Store(
        conn,
        store_mod._read_json(ddir / "rules.json"),
        store_mod._read_json(ddir / "sigungu_centroids.json"),
        store_mod._read_optional_json(ddir / "depopulation_regions.json"),
        store_mod._read_optional_json(ddir / "public_fee_reductions.json"),
    )


@pytest.fixture(scope="module")
def bench_store():
    s = _open_ro_db_store()
    if s is None:
        pytest.skip("실 DB 없음 — SPONAVI_RO_DB 로 경로 지정")
    yield s
    s.conn.close()


def _pct(vals: list[float], q: float) -> float:
    v = sorted(vals)
    return v[max(0, min(len(v) - 1, math.ceil(q * len(v)) - 1))]


def _search(s, b, program, q=None):
    return engine.area_search(
        s, min_lat=b[0], min_lon=b[1], max_lat=b[2], max_lon=b[3], program=program, q=q,
    )


def test_build_time_and_memory(bench_store):
    # ① ru_maxrss: 이 프로세스의 첫 빌드(추적 없음) 전후 고수위
    rss0 = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * _MAXRSS_SCALE
    t0 = time.perf_counter()
    bench_store.area_index()
    build_s = time.perf_counter() - t0
    rss1 = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * _MAXRSS_SCALE
    # ② tracemalloc: 인덱스만 따로 한 벌 더 빌드해 current(살아남은 크기)·peak 를 잰다
    tracemalloc.start()
    idx = AreaIndex.build(bench_store)
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    mb = 1024 * 1024
    print(
        f"\n[area-perf] build {build_s * 1000:.0f}ms (추적 없음) · tracemalloc current "
        f"{current / mb:.1f}MB peak {peak / mb:.1f}MB · ru_maxrss {rss0 / mb:.1f}→{rss1 / mb:.1f}MB"
        f" (+{(rss1 - rss0) / mb:.1f}MB)\n[area-perf] stats(추적 빌드 — build_ms 는 tracemalloc 오버헤드 포함)"
        f" {idx.stats()}"
    )
    assert build_s <= 5.0
    assert current <= 60 * mb


def _densest_public_band(s, height_deg: float) -> float:
    """20km 높이 위도대 가운데 real 공공 행이 가장 많은 구간의 시작 위도."""
    lats = sorted(
        r[0] for r in s.conn.execute(
            "SELECT lat FROM facilities WHERE source='public' AND coord_source='api'"
        )
    )
    best = max(
        range(0, len(lats), 25),
        key=lambda i: bisect.bisect_right(lats, lats[i] + height_deg) - i,
    )
    return lats[best]


def test_query_latency_named_bounds(bench_store):
    s = bench_store
    s.area_index()
    stripe_h = 0.1797  # 대각선 19.98km(폭 0.0001°)
    lat0 = _densest_public_band(s, stripe_h)
    bounds = {
        "성북 z15": (37.585, 127.010, 37.598, 127.028),
        "성북 8.6km": (37.56, 126.99, 37.62, 127.05),
        "서울 18.7km": (37.51, 126.90, 37.62, 127.06),
        "인천 서구 10km": (37.5205, 126.6099, 37.5712, 126.7037),
        "창원": (35.20, 128.58, 35.26, 128.66),
        "20km 세로 막대": (lat0, 127.0, lat0 + stripe_h, 127.0001),
    }
    for name, b in bounds.items():
        assert engine.area_bounds_problem(*b) is None, name
    rows = []
    worst = 0.0
    for name, b in bounds.items():
        for program in ("svoucher", "dvoucher", "public"):
            for q in (None, "수영"):
                for _ in range(3):
                    _search(s, b, program, q)
                ts = []
                for _ in range(30):
                    t = time.perf_counter()
                    body = _search(s, b, program, q)
                    ts.append((time.perf_counter() - t) * 1000)
                p50, p95 = _pct(ts, 0.5), _pct(ts, 0.95)
                worst = max(worst, p95)
                rows.append((name, program, q or "-", body["total"], p50, p95))
    print("\n[area-perf] 범위 × program × q — 워밍업 3회 뒤 30회 (ms)")
    print(f"  {'범위':16s} {'program':8s} {'q':4s} {'total':>6s} {'p50':>6s} {'p95':>6s}")
    for name, program, q, total, p50, p95 in rows:
        print(f"  {name:16s} {program:8s} {q:4s} {total:6d} {p50:6.2f} {p95:6.2f}")
    print(f"  최악 p95 = {worst:.2f}ms (목표 ≤ 5ms)")
    assert worst <= 20.0


def test_query_latency_random_1000(bench_store):
    """무작위 범위 1,000회 — 중심 = 무작위 실좌표 공공 행, 대각선 0.5~20km(390·1280 화면비),
    program 무작위, 30% 는 검색어 포함. 평균·p50·p95·p99·최대를 출력한다."""
    s = bench_store
    s.area_index()
    rng = random.Random(20260930)
    pts = [
        (r[0], r[1]) for r in s.conn.execute(
            "SELECT lat, lon FROM facilities WHERE coord_source='api'"
        )
    ]
    words = ["수영", "태권도", "헬스", "요가", "체육관", "로", "동", "필라테스", "센터", "배드민턴"]

    def rand_bounds():
        la, lo = rng.choice(pts)
        diag = rng.uniform(0.5, 20.0)
        w, h = rng.choice([(348, 256), (469, 320)])
        dh, dw = diag * h / math.hypot(w, h), diag * w / math.hypot(w, h)
        dlat = dh / 111.0
        dlon = dw / (111.0 * math.cos(math.radians(la)))
        while True:
            b = (la - dlat / 2, lo - dlon / 2, la + dlat / 2, lo + dlon / 2)
            if engine.area_bounds_problem(*b) is None:
                return b
            dlat *= 0.98
            dlon *= 0.98

    reqs = [
        (rand_bounds(), rng.choice(["svoucher", "dvoucher", "public"]),
         rng.choice(words) if rng.random() < 0.3 else None)
        for _ in range(1000)
    ]
    for b, p, q in reqs[:20]:
        _search(s, b, p, q)
    ts: list[float] = []
    by_prog: dict[str, list[float]] = {}
    for b, p, q in reqs:
        t = time.perf_counter()
        _search(s, b, p, q)
        dt = (time.perf_counter() - t) * 1000
        ts.append(dt)
        by_prog.setdefault(p, []).append(dt)
    print(
        f"\n[area-perf] 무작위 1,000회: 평균 {statistics.mean(ts):.2f}ms · p50 {_pct(ts, .5):.2f}"
        f" · p95 {_pct(ts, .95):.2f} · p99 {_pct(ts, .99):.2f} · 최대 {max(ts):.2f}"
    )
    for p, v in sorted(by_prog.items()):
        print(f"  {p:8s} n={len(v)} 평균 {statistics.mean(v):.2f} p95 {_pct(v, .95):.2f} 최대 {max(v):.2f}")
    assert _pct(ts, 0.95) <= 20.0
