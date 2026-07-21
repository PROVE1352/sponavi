#!/usr/bin/env python3
"""Migrate an existing data/sponavi.db in place: add + populate `coord_source`.

좌표 정직성 배지(FR-04/FR-05)용 컬럼을 전체 재빌드 없이 기존 DB에 채운다.
scripts/build_db.py 의 신규 빌드 경로와 동일한 결과가 나오도록 분류 규칙을 맞춘다:

  * voucher / dvoucher : 원본 좌표가 없어 전부 시군구 중심 폴백  → 'centroid'
  * public             : 원본 좌표(faci_lat/lot) 보유 → 'api'
                         원본 좌표가 없어 폴백된 행     → 'centroid'

기존 DB에는 원본 좌표 보유 여부(_own_lat)가 남아있지 않으므로, 폴백 좌표가
곧 그 시군구의 sigungu 테이블 중심좌표(build_db 가 그 값으로 폴백함)와 정확히
일치한다는 사실로 역판정한다. 추가로 build_db 의 전국 최후 폴백값 KOREA_DEFAULT
(중심좌표를 못 구한 시군구)도 centroid 로 본다.

Idempotent: 여러 번 실행해도 같은 결과. Usage: python scripts/migrate_coord_source.py [--db PATH]
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from build_db import KOREA_DEFAULT  # noqa: E402  (전국 최후 폴백 좌표 공유)

DEFAULT_DB = REPO_ROOT / "data" / "sponavi.db"
K_LAT, K_LON = KOREA_DEFAULT


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())


def migrate(db: Path) -> dict:
    if not db.exists():
        sys.exit(f"[migrate] DB 없음: {db}")
    conn = sqlite3.connect(str(db))
    try:
        if not _has_column(conn, "facilities", "coord_source"):
            conn.execute("ALTER TABLE facilities ADD COLUMN coord_source TEXT")

        # 1) 이용권 시설: 전부 시군구 중심 폴백
        conn.execute(
            "UPDATE facilities SET coord_source='centroid' "
            "WHERE source IN ('voucher','dvoucher')"
        )
        # 2) public: 일단 실좌표로 두고
        conn.execute("UPDATE facilities SET coord_source='api' WHERE source='public'")
        # 3) 좌표가 그 시군구 중심좌표와 정확히 일치 → 폴백(centroid)
        conn.execute(
            "UPDATE facilities SET coord_source='centroid' "
            "WHERE source='public' AND id IN ("
            "  SELECT f.id FROM facilities f JOIN sigungu s ON f.sigungu_cd = s.cd "
            "  WHERE f.source='public' AND f.lat = s.lat AND f.lon = s.lon"
            ")"
        )
        # 4) 전국 최후 폴백 좌표(중심좌표 미확보 시군구) → centroid
        conn.execute(
            "UPDATE facilities SET coord_source='centroid' "
            "WHERE source='public' AND lat=? AND lon=?",
            (K_LAT, K_LON),
        )
        conn.commit()

        dist = conn.execute(
            "SELECT source, coord_source, COUNT(*) FROM facilities "
            "GROUP BY source, coord_source ORDER BY source, coord_source"
        ).fetchall()
        n_null = conn.execute(
            "SELECT COUNT(*) FROM facilities WHERE coord_source IS NULL"
        ).fetchone()[0]
        return {"dist": dist, "null": n_null}
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()
    rep = migrate(Path(args.db))
    print(f"[migrate] {args.db} coord_source 적용 완료")
    for source, cs, cnt in rep["dist"]:
        print(f"  {source}/{cs} = {cnt}")
    print(f"  coord_source NULL 잔여: {rep['null']}")


if __name__ == "__main__":
    main()
