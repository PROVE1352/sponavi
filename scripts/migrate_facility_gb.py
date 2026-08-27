#!/usr/bin/env python3
"""Migrate an existing data/sponavi.db in place: add + populate `facilities.faci_gb`.

시설 구분 배지(OV6)용 컬럼을 전체 재빌드 없이 기존 DB에 채운다. source='public' 은
"공공체육시설"이 아니라 raw `faci_gb_nm` 기준 신고/공공/등록 3종이 섞여 있다
(개방 행 기준 신고 73,544 · 공공 43,691 · 등록 628 — 앱이 전부 '공공'으로 라벨하면 70%가 거짓).

  * public            : raw public_facility.json 의 faci_gb_nm (신고|공공|등록)
  * voucher/dvoucher  : 원천에 그 필드가 없음 → NULL 유지

조인 키는 scripts/build_db.py 의 신규 빌드 경로와 **같은 함수**를 쓴다
(public_is_closed 로 폐업 행을 같은 규칙으로 거르고, public_base_id + dedupe_id 로
같은 순서의 id 를 만든다) — 그래서 "제자리 마이그레이션 == 재빌드"가 구성상 보장된다.

Idempotent: 여러 번 실행해도 같은 결과(같은 raw → 같은 id → 같은 값).
Usage: python scripts/migrate_facility_gb.py [--db PATH] [--raw PATH]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from build_db import (  # noqa: E402  (id·필터·필드 규칙을 빌드와 공유)
    dedupe_id,
    public_base_id,
    public_faci_gb,
    public_is_closed,
)

DEFAULT_DB = REPO_ROOT / "data" / "sponavi.db"
DEFAULT_RAW = REPO_ROOT / "data" / "raw" / "public_facility.json"


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())


def raw_pairs(rows) -> tuple[list[tuple], Counter]:
    """raw public 행 → [(faci_gb, facility_id)] + raw 개방행 분포.

    빌드와 같은 순서·같은 규칙으로 id 를 만든다(폐업 제외 후 파일 순서대로 dedupe).
    """
    seen: set[str] = set()
    pairs: list[tuple] = []
    dist: Counter = Counter()
    for r in rows:
        if public_is_closed(r):
            continue
        fid = dedupe_id(public_base_id(r), seen)
        gb = public_faci_gb(r)
        pairs.append((gb, fid))
        dist[gb or "(NULL)"] += 1
    return pairs, dist


def migrate(db: Path, raw: Path) -> dict:
    if not db.exists():
        sys.exit(f"[migrate] DB 없음: {db}")
    if not raw.exists():
        sys.exit(f"[migrate] raw 없음: {raw} (bulk_fetch 결과 필요 — 네트워크 재수집 아님)")

    rows = json.loads(raw.read_text(encoding="utf-8"))
    pairs, raw_dist = raw_pairs(rows)

    conn = sqlite3.connect(str(db))
    try:
        if not _has_column(conn, "facilities", "faci_gb"):
            conn.execute("ALTER TABLE facilities ADD COLUMN faci_gb TEXT")

        # 1) 이용권 시설: 원천에 없는 필드 → 항상 NULL(재실행·재빌드 동치 보장)
        conn.execute(
            "UPDATE facilities SET faci_gb=NULL "
            "WHERE source NOT IN ('public') AND faci_gb IS NOT NULL"
        )
        # 2) public: raw 의 faci_gb_nm 을 같은 id 규칙으로 조인해 채운다
        conn.executemany(
            "UPDATE facilities SET faci_gb=? WHERE id=? AND source='public'", pairs
        )
        conn.commit()

        db_dist = conn.execute(
            "SELECT COALESCE(faci_gb,'(NULL)'), COUNT(*) FROM facilities "
            "WHERE source='public' GROUP BY faci_gb ORDER BY COUNT(*) DESC"
        ).fetchall()
        n_public = conn.execute(
            "SELECT COUNT(*) FROM facilities WHERE source='public'"
        ).fetchone()[0]
        n_filled = conn.execute(
            "SELECT COUNT(*) FROM facilities WHERE source='public' AND faci_gb IS NOT NULL"
        ).fetchone()[0]
        n_leak = conn.execute(
            "SELECT COUNT(*) FROM facilities WHERE source<>'public' AND faci_gb IS NOT NULL"
        ).fetchone()[0]
        return {
            "raw_rows": len(rows),
            "raw_open": len(pairs),
            "raw_dist": raw_dist,
            "db_dist": db_dist,
            "public": n_public,
            "filled": n_filled,
            "leak": n_leak,
        }
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="facilities.faci_gb 제자리 마이그레이션(OV6)")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--raw", default=str(DEFAULT_RAW))
    args = ap.parse_args()
    rep = migrate(Path(args.db), Path(args.raw))

    rate = (rep["filled"] / rep["public"] * 100) if rep["public"] else 0.0
    print(f"[migrate] {args.db} faci_gb 적용 완료")
    print(f"  raw {rep['raw_rows']}행 중 개방 {rep['raw_open']}행 "
          f"(폐업 등 {rep['raw_rows'] - rep['raw_open']}행은 빌드에서 제외되는 행)")
    print("  raw 개방행 분포: "
          + ", ".join(f"{k}={v}" for k, v in rep["raw_dist"].most_common()))
    print("  DB public 분포:  "
          + ", ".join(f"{k}={v}" for k, v in rep["db_dist"]))
    print(f"  채움률(source='public'): {rep['filled']}/{rep['public']} = {rate:.2f}%")
    print(f"  voucher/dvoucher 오염(NULL 아님): {rep['leak']}건")
    same = dict(rep["db_dist"]) == dict(rep["raw_dist"])
    print(f"  재빌드 동치(raw 개방행 분포 == DB public 분포): {'OK' if same else '불일치'}")


if __name__ == "__main__":
    main()
