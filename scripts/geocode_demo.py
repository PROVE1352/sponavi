"""데모 구 시설 실좌표화 — 카카오 주소검색 지오코딩 (M2, CUTLINE 옵션 → 2026-08-19 실행).

구중심 근사(coord_source='centroid') 시설의 addr를 카카오 로컬 주소검색으로 실좌표화한다.
성공 시 lat/lon 갱신 + coord_source='geocoded' — UI는 근사 배지가 떨어지고 거리 표기가 살아난다
(FR-04: 거리·반경 표기는 실좌표 풀에만). 실패·불확실은 centroid 그대로 둔다(정직 우선, P-1).

정당성: 공단 dvoucher 상세페이지도 카카오 지오코더로 실시간 변환하는 것을 실측 확인(E77).

사용:
  KAKAO_REST_API_KEY=... python scripts/geocode_demo.py            # 데모 구(성북·인천서구)
  KAKAO_REST_API_KEY=... python scripts/geocode_demo.py --sigungu 11290 --dry-run

주의:
- idempotent: coord_source='centroid'만 대상 — 재실행해도 geocoded는 건드리지 않는다.
- 오매칭 방어: 결과 좌표가 해당 시군구 중심에서 위경도 0.35도(약 30km+) 넘게 벗어나면 버린다
  — 틀린 실좌표는 구중심 근사보다 나쁘다(자격 오판은 무응답보다 나쁘다의 좌표 버전).
- 요청 간 0.06s 딜레이(예의). 데모 2개 구 ~632콜 ≪ 일 한도.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "data" / "sponavi.db"
KAKAO_URL = "https://dapi.kakao.com/v2/local/search/address.json"
DEMO_SIGUNGU = ["11290", "28260"]  # 성북구 · 인천 서구 (PRD 데모 지역)
MAX_DRIFT_DEG = 0.35  # 시군구 중심 대비 허용 이탈(위경도) — 초과 시 오매칭으로 간주해 폐기
DELAY_S = 0.06


def _key() -> str:
    key = os.environ.get("KAKAO_REST_API_KEY") or os.environ.get("KAKAO_REST_KEY") or ""
    if not key.strip():
        sys.exit("KAKAO_REST_API_KEY 미설정 — .env 값을 셸로 주입해 실행하세요 "
                 "(set -a; . ./.env; set +a)")
    return key.strip()


def _geocode(addr: str, key: str) -> tuple[float, float] | None:
    q = urllib.parse.urlencode({"query": addr, "size": 1})
    req = urllib.request.Request(
        f"{KAKAO_URL}?{q}", headers={"Authorization": f"KakaoAK {key}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    docs = data.get("documents") or []
    if not docs:
        return None
    d = docs[0]
    try:
        return float(d["y"]), float(d["x"])  # (lat, lon)
    except (KeyError, TypeError, ValueError):
        return None


def run(sigungu_list: list[str], dry_run: bool) -> None:
    key = _key()
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    centroids = {
        r["cd"]: (r["lat"], r["lon"])
        for r in db.execute("SELECT cd, lat, lon FROM sigungu WHERE lat IS NOT NULL")
    }

    total = {"ok": 0, "no_result": 0, "drift": 0, "no_addr": 0, "error": 0}
    for cd in sigungu_list:
        if cd not in centroids:
            print(f"[skip] 시군구 {cd}: 중심좌표 없음")
            continue
        c_lat, c_lon = centroids[cd]
        rows = db.execute(
            "SELECT id, name, addr FROM facilities "
            "WHERE sigungu_cd=? AND coord_source='centroid'", (cd,)).fetchall()
        print(f"== {cd}: 대상 {len(rows)}건 ==")
        stats = {"ok": 0, "no_result": 0, "drift": 0, "no_addr": 0, "error": 0}
        for i, row in enumerate(rows, 1):
            addr = (row["addr"] or "").strip()
            if not addr:
                stats["no_addr"] += 1
                continue
            try:
                got = _geocode(addr, key)
            except Exception as exc:  # noqa: BLE001 — 개별 실패는 건너뛰고 계속(부분 성공 허용)
                stats["error"] += 1
                print(f"  [err] {row['name']}: {type(exc).__name__}")
                time.sleep(DELAY_S)
                continue
            if got is None:
                stats["no_result"] += 1
            else:
                lat, lon = got
                if abs(lat - c_lat) > MAX_DRIFT_DEG or abs(lon - c_lon) > MAX_DRIFT_DEG:
                    stats["drift"] += 1  # 오매칭 방어 — centroid 유지
                else:
                    stats["ok"] += 1
                    if not dry_run:
                        db.execute(
                            "UPDATE facilities SET lat=?, lon=?, coord_source='geocoded' "
                            "WHERE id=?", (lat, lon, row["id"]))
            if i % 50 == 0:
                print(f"  … {i}/{len(rows)}")
            time.sleep(DELAY_S)
        if not dry_run:
            db.commit()
        print(f"  결과: {stats}")
        for k in total:
            total[k] += stats[k]

    db.close()
    mode = "DRY-RUN" if dry_run else "적용 완료"
    print(f"== {mode}: {total} ==")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sigungu", nargs="*", default=DEMO_SIGUNGU,
                    help="대상 시군구 코드 (기본: 성북 11290 · 인천서구 28260)")
    ap.add_argument("--dry-run", action="store_true")
    run(ap.parse_args().sigungu, ap.parse_args().dry_run)
