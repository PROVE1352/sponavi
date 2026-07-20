"""Data store: loads fixtures + rules + centroids into an in-memory SQLite DB
and exposes typed query helpers. SPEC §6 (fixtures -> SQLite).

The server runs fully in demo mode from data/fixtures/*.json with no key.
An override dir (env SPONAVI_DATA_DIR) lets fetch_data.py output or tests
point elsewhere.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

# repo_root/server/app/store.py -> parents[2] == repo_root
REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    override = os.environ.get("SPONAVI_DATA_DIR")
    return Path(override) if override else (REPO_ROOT / "data")


def fixtures_dir() -> Path:
    """Fixtures live in data/fixtures; real ETL output (data/raw) can override."""
    override = os.environ.get("SPONAVI_FIXTURES_DIR")
    if override:
        return Path(override)
    return data_dir() / "fixtures"


# ---------------------------------------------------------------------------
# geo
# ---------------------------------------------------------------------------
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometers."""
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------------------
# raw json loaders
# ---------------------------------------------------------------------------
def _read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


class Store:
    """In-memory data access layer backed by SQLite (facilities/courses/coverage)
    plus parsed rules + centroids."""

    def __init__(self, conn: sqlite3.Connection, rules: dict, centroids: dict) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self.rules = rules
        # index programs by id
        self.programs: dict[str, dict] = {p["id"]: p for p in rules.get("programs", [])}
        self.alt_edges: list[dict] = rules.get("alt_edges", [])
        self.fitness_map: list[dict] = rules.get("fitness_map", [])
        self._centroids: dict[str, dict] = {
            c["cd"]: c for c in centroids.get("centroids", [])
        }

    # -- programs / rules ---------------------------------------------------
    def program(self, pid: str) -> Optional[dict]:
        return self.programs.get(pid)

    def edges_from(self, pid: str) -> list[dict]:
        return [e for e in self.alt_edges if e.get("from") == pid]

    # -- centroids ----------------------------------------------------------
    def centroid(self, sigungu_cd: str) -> Optional[dict]:
        return self._centroids.get(sigungu_cd)

    def all_centroids(self) -> list[dict]:
        return [self._centroids[k] for k in self._centroids]

    # -- facilities ---------------------------------------------------------
    @staticmethod
    def _facility_row(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "source": row["source"],
            "name": row["name"],
            "sigungu_cd": row["sigungu_cd"],
            "sigungu_nm": row["sigungu_nm"],
            "addr": row["addr"],
            "lat": row["lat"],
            "lon": row["lon"],
            "sports": json.loads(row["sports_json"]),
            "disability_support": (
                None
                if row["disability_support"] is None
                else bool(row["disability_support"])
            ),
            "phone": row["phone"],
        }

    def facilities(self, source: Optional[str] = None) -> list[dict]:
        if source is None:
            cur = self.conn.execute("SELECT * FROM facilities")
        else:
            cur = self.conn.execute(
                "SELECT * FROM facilities WHERE source = ?", (source,)
            )
        return [self._facility_row(r) for r in cur.fetchall()]

    def courses_for(self, facility_id: str) -> list[dict]:
        cur = self.conn.execute(
            "SELECT * FROM courses WHERE facility_id = ?", (facility_id,)
        )
        return [dict(r) for r in cur.fetchall()]

    # -- coverage -----------------------------------------------------------
    def coverage_rows(self, sigungu_cd: str) -> list[dict]:
        cur = self.conn.execute(
            "SELECT * FROM coverage WHERE sigungu_cd = ?", (sigungu_cd,)
        )
        return [dict(r) for r in cur.fetchall()]

    def coverage_year(self) -> Optional[int]:
        cur = self.conn.execute("SELECT year FROM coverage LIMIT 1")
        row = cur.fetchone()
        return row["year"] if row else None


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def _build_conn(
    facilities: dict, courses: dict, coverage: dict, target: str = ":memory:"
) -> sqlite3.Connection:
    conn = sqlite3.connect(target, check_same_thread=False)
    conn.executescript(
        """
        CREATE TABLE facilities (
            id TEXT PRIMARY KEY, source TEXT, name TEXT,
            sigungu_cd TEXT, sigungu_nm TEXT, addr TEXT,
            lat REAL, lon REAL, sports_json TEXT,
            disability_support INTEGER, phone TEXT
        );
        CREATE TABLE courses (
            id TEXT PRIMARY KEY, facility_id TEXT, name TEXT, sport TEXT,
            weekday_mask TEXT, start TEXT, end TEXT,
            fee_month INTEGER, target TEXT
        );
        CREATE TABLE coverage (
            sigungu_cd TEXT, sigungu_nm TEXT, pop INTEGER, facil_cnt INTEGER,
            class TEXT, target INTEGER, recipient INTEGER, year INTEGER
        );
        CREATE INDEX idx_fac_source ON facilities(source);
        CREATE INDEX idx_course_fac ON courses(facility_id);
        CREATE INDEX idx_cov_cd ON coverage(sigungu_cd);
        """
    )
    for f in facilities.get("facilities", []):
        ds = f.get("disability_support")
        conn.execute(
            "INSERT INTO facilities VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                f["id"], f["source"], f["name"], f["sigungu_cd"], f["sigungu_nm"],
                f.get("addr"), f["lat"], f["lon"], json.dumps(f["sports"], ensure_ascii=False),
                None if ds is None else int(bool(ds)), f.get("phone"),
            ),
        )
    for c in courses.get("courses", []):
        conn.execute(
            "INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?)",
            (
                c["id"], c["facility_id"], c["name"], c["sport"],
                c.get("weekday_mask"), c.get("start"), c.get("end"),
                c.get("fee_month"), c.get("target"),
            ),
        )
    year = coverage.get("year")
    for r in coverage.get("rows", []):
        conn.execute(
            "INSERT INTO coverage VALUES (?,?,?,?,?,?,?,?)",
            (
                r["sigungu_cd"], r["sigungu_nm"], r.get("pop"), r.get("facil_cnt"),
                r.get("class"), r.get("target"), r.get("recipient"), r.get("year", year),
            ),
        )
    conn.commit()
    return conn


def build_store(sqlite_target: str = ":memory:") -> Store:
    ddir = data_dir()
    fdir = fixtures_dir()
    facilities = _read_json(fdir / "facilities.json")
    courses = _read_json(fdir / "courses.json")
    coverage = _read_json(fdir / "coverage_seoul_2025.json")
    rules = _read_json(ddir / "rules.json")
    centroids = _read_json(ddir / "sigungu_centroids.json")
    conn = _build_conn(facilities, courses, coverage, sqlite_target)
    return Store(conn, rules, centroids)


# raw videos list lives in courses.json (fixtures) — separate small helper
def load_videos() -> list[dict]:
    data = _read_json(fixtures_dir() / "courses.json")
    return data.get("videos", [])


@lru_cache(maxsize=1)
def get_store() -> Store:
    """Process-wide singleton for the app. Tests can call build_store() directly."""
    return build_store()
