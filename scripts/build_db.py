#!/usr/bin/env python3
"""Materialize the SpoNavi SQLite DB from fixtures (SPEC §6, fixtures -> build_db).

The server itself builds an in-memory SQLite on startup (server/app/store.py), so
this file is optional — it just persists the same schema to data/sponavi.db for
inspection or a file-backed deployment.

Usage: python scripts/build_db.py [--out data/sponavi.db]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app import store  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO_ROOT / "data" / "sponavi.db"))
    args = ap.parse_args()

    out = Path(args.out)
    if out.exists():
        out.unlink()
    s = store.build_store(sqlite_target=str(out))
    n_fac = len(s.facilities())
    n_cov = len(s.conn.execute("SELECT 1 FROM coverage").fetchall())
    n_course = len(s.conn.execute("SELECT 1 FROM courses").fetchall())
    print(f"[build_db] {out} 생성: 시설 {n_fac} · 강좌 {n_course} · 커버리지 {n_cov}행")


if __name__ == "__main__":
    main()
