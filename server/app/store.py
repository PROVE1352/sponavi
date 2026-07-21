"""Data store: query layer over a SQLite DB (facilities/courses/coverage/sigungu)
plus parsed rules + Seoul centroids. SPEC §6 (fixtures -> SQLite -> nationwide DB).

Data source resolution (get_store):
  1. data/sponavi.db present  -> load the prebuilt nationwide DB (scripts/build_db.py)
  2. otherwise                -> build an in-memory DB from data/fixtures/*.json (demo mode)

The public surface (Store methods, module helpers) is IDENTICAL in both modes so
engine.py / fitness.py never learn which data source is live (docs/API.md contract
is unchanged). Only the bytes behind the tables differ.

An override dir (env SPONAVI_DATA_DIR) lets tests / ETL output point elsewhere.
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


def db_path() -> Path:
    """Prebuilt nationwide SQLite (scripts/build_db.py). Used if it exists."""
    override = os.environ.get("SPONAVI_DB")
    return Path(override) if override else (data_dir() / "sponavi.db")


# ---------------------------------------------------------------------------
# canonical schema — shared by the fixtures build (below) and scripts/build_db.py
# so both produce byte-compatible tables the query helpers can read uniformly.
# facilities.sports / courses.* renames are internal; _facility_row + courses_for
# re-expose exactly the dict shape engine.py expects.
# ---------------------------------------------------------------------------
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS facilities (
    id                 TEXT PRIMARY KEY,
    source             TEXT,            -- voucher | dvoucher | public
    name               TEXT,
    sido_cd            TEXT,
    sigungu_cd         TEXT,
    sigungu_nm         TEXT,
    addr               TEXT,
    lat                REAL,
    lon                REAL,
    coord_source       TEXT,            -- api(실좌표) | centroid(시군구 중심 폴백) | geocoded(M2 예약)
    sports             TEXT,            -- comma-joined
    disability_support INTEGER,         -- 0 | 1 | NULL(unknown)
    brno               TEXT,
    facil_sn           TEXT,
    status             TEXT,
    phone              TEXT
);
CREATE TABLE IF NOT EXISTS courses (
    id               TEXT PRIMARY KEY,
    facility_id      TEXT,
    source           TEXT,
    name             TEXT,
    sport            TEXT,
    fee_month        INTEGER,
    weekday_mask     TEXT,
    start_tm         TEXT,
    end_tm           TEXT,
    target           TEXT,
    disability_types TEXT
);
CREATE TABLE IF NOT EXISTS coverage (
    sigungu_cd TEXT,
    sigungu_nm TEXT,
    class      TEXT,
    target     INTEGER,
    recipient  INTEGER,
    pop        INTEGER,
    facil_cnt  INTEGER,
    year       INTEGER
);
CREATE TABLE IF NOT EXISTS sigungu (
    cd      TEXT PRIMARY KEY,
    nm      TEXT,
    sido_cd TEXT,
    lat     REAL,
    lon     REAL
);
CREATE INDEX IF NOT EXISTS idx_fac_sigungu ON facilities(sigungu_cd);
CREATE INDEX IF NOT EXISTS idx_fac_source  ON facilities(source);
CREATE INDEX IF NOT EXISTS idx_course_fac  ON courses(facility_id);
CREATE INDEX IF NOT EXISTS idx_cov_cd      ON coverage(sigungu_cd);
"""


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)


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


def _split_sports(raw: Optional[str]) -> list[str]:
    return [s for s in (raw or "").split(",") if s]


class Store:
    """Query layer backed by SQLite (facilities/courses/coverage/sigungu)
    plus parsed rules + Seoul centroid seed."""

    def __init__(self, conn: sqlite3.Connection, rules: dict, centroids: dict) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self.rules = rules
        # index programs by id
        self.programs: dict[str, dict] = {p["id"]: p for p in rules.get("programs", [])}
        self.alt_edges: list[dict] = rules.get("alt_edges", [])
        self.fitness_map: list[dict] = rules.get("fitness_map", [])
        # Seoul 25 seed — authoritative for GET /api/meta/sigungu (pilot region)
        # and the primary applicant-location fallback (docs/API.md).
        self._centroids: dict[str, dict] = {
            c["cd"]: c for c in centroids.get("centroids", [])
        }
        # nationwide sigungu centroids (from the DB table, coords may be sparse) —
        # secondary fallback so non-Seoul sigungu codes still resolve to a location.
        self._sigungu: dict[str, dict] = {}
        try:
            cur = self.conn.execute(
                "SELECT cd, nm, lat, lon FROM sigungu "
                "WHERE lat IS NOT NULL AND lon IS NOT NULL"
            )
            for r in cur.fetchall():
                self._sigungu[r["cd"]] = {
                    "cd": r["cd"], "nm": r["nm"], "lat": r["lat"], "lon": r["lon"],
                }
        except sqlite3.OperationalError:
            pass  # sigungu table absent (legacy DB) — seed-only fallback

    # -- programs / rules ---------------------------------------------------
    def program(self, pid: str) -> Optional[dict]:
        return self.programs.get(pid)

    def edges_from(self, pid: str) -> list[dict]:
        return [e for e in self.alt_edges if e.get("from") == pid]

    # -- centroids ----------------------------------------------------------
    def centroid(self, sigungu_cd: str) -> Optional[dict]:
        # Seoul seed first (pilot), then nationwide sigungu table.
        return self._centroids.get(sigungu_cd) or self._sigungu.get(sigungu_cd)

    def all_centroids(self) -> list[dict]:
        # GET /api/meta/sigungu -> Seoul 25 (docs/API.md; pilot region SPEC §1).
        return [self._centroids[k] for k in self._centroids]

    # -- facilities ---------------------------------------------------------
    @staticmethod
    def _facility_row(row: sqlite3.Row) -> dict:
        ds = row["disability_support"]
        # coord_source: 좌표 정직성 신호. api=실좌표, centroid=시군구 중심 폴백.
        # 컬럼이 없거나 NULL인 레거시/데모 DB는 source로 폴백(public→api, 이용권→centroid).
        keys = row.keys()
        if "coord_source" in keys and row["coord_source"]:
            coord_source = row["coord_source"]
        else:
            coord_source = "api" if row["source"] == "public" else "centroid"
        return {
            "id": row["id"],
            "source": row["source"],
            "name": row["name"],
            "sigungu_cd": row["sigungu_cd"],
            "sigungu_nm": row["sigungu_nm"],
            "addr": row["addr"],
            "lat": row["lat"],
            "lon": row["lon"],
            "coord_source": coord_source,
            "sports": _split_sports(row["sports"]),
            "disability_support": None if ds is None else bool(ds),
            "phone": row["phone"],
        }

    def facilities(self, source: Optional[str] = None) -> list[dict]:
        if source is None:
            cur = self.conn.execute(
                "SELECT * FROM facilities WHERE lat IS NOT NULL AND lon IS NOT NULL"
            )
        else:
            cur = self.conn.execute(
                "SELECT * FROM facilities "
                "WHERE source = ? AND lat IS NOT NULL AND lon IS NOT NULL",
                (source,),
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

    # -- accessibility (FR-10) ---------------------------------------------
    # dvoucher 웹 보조 소스(scripts/load_accessibility.py). 별도 테이블
    # facility_accessibility(facility_id, kind, code, name, source, checked).
    # ★ engine 무접촉: 이 데이터는 assess 응답이 아니라 GET /api/accessibility 로만
    #   흘린다. 테이블이 없는 데모/레거시 DB 는 빈 결과(폴백 안전, DR-4 애드온).
    def accessibility_for(self, facility_ids: list[str]) -> dict[str, dict]:
        """{facility_id: {types:[str], amenities:[{code,name}], checked:str}}.
        데이터 없는 id 는 딕셔너리에서 생략(P-1: 미상과 구분)."""
        ids = [i for i in (facility_ids or []) if i]
        if not ids:
            return {}
        out: dict[str, dict] = {}
        try:
            qmarks = ",".join("?" for _ in ids)
            cur = self.conn.execute(
                f"SELECT facility_id, kind, code, name, checked "
                f"FROM facility_accessibility WHERE facility_id IN ({qmarks}) "
                f"ORDER BY facility_id, kind, code",
                ids,
            )
            rows = cur.fetchall()
        except sqlite3.OperationalError:
            return {}  # 테이블 없음 → 폴백 안전
        for r in rows:
            entry = out.setdefault(
                r["facility_id"], {"types": [], "amenities": [], "checked": None}
            )
            if r["checked"] and not entry["checked"]:
                entry["checked"] = r["checked"]
            if r["kind"] == "disability_type":
                if r["name"] and r["name"] not in entry["types"]:
                    entry["types"].append(r["name"])
            elif r["kind"] == "amenity":
                if not any(a["code"] == r["code"] for a in entry["amenities"]):
                    entry["amenities"].append({"code": r["code"], "name": r["name"]})
        return out

    def facilities_with_amenity(
        self, sigungu_cd: Optional[str], codes: list[str]
    ) -> set[str]:
        """지정 편의시설 코드를 (전부) 보유한 시설 id 집합. sigungu_cd 주면 그 구로 한정.
        codes 비면 빈 집합. 테이블 없으면 빈 집합(폴백 안전)."""
        want = [c for c in (codes or []) if c]
        if not want:
            return set()
        try:
            qmarks = ",".join("?" for _ in want)
            params: list = list(want)
            sql = (
                "SELECT fa.facility_id AS fid, COUNT(DISTINCT fa.code) AS n "
                "FROM facility_accessibility fa "
            )
            if sigungu_cd:
                sql += "JOIN facilities f ON f.id = fa.facility_id "
            sql += f"WHERE fa.kind='amenity' AND fa.code IN ({qmarks}) "
            if sigungu_cd:
                sql += "AND f.sigungu_cd = ? "
                params.append(sigungu_cd)
            sql += "GROUP BY fa.facility_id HAVING n = ?"
            params.append(len(set(want)))
            cur = self.conn.execute(sql, params)
            return {r["fid"] for r in cur.fetchall()}
        except sqlite3.OperationalError:
            return set()

    # -- fitness norms (M1a: 국민체력100 공식 인증기준) ----------------------
    # scripts/scrape_norms.py 가 적재한 measurement_item / fitness_norm 테이블.
    # 두 테이블이 없는 데모/레거시 DB 는 빈 결과 → fitness.py 가 데모 컷으로
    # 폴백(무중단, DR-4). 조회는 연령대(age_min<=age<=age_max)로 연령군을 자동 선택.
    def has_fitness_norms(self) -> bool:
        try:
            row = self.conn.execute("SELECT COUNT(*) AS n FROM fitness_norm").fetchone()
            return bool(row and row["n"])
        except sqlite3.OperationalError:
            return False

    @staticmethod
    def _age_band_label(age_min: int, age_max: int) -> str:
        if age_max >= 200:
            return f"{age_min}세 이상"
        if age_min == age_max:
            return f"{age_min}세"
        return f"{age_min}~{age_max}세"

    def fitness_items(self, age: int) -> list[dict]:
        """해당 연령(연령군)에 적용되는 측정항목 카탈로그. 테이블/행 없으면 []."""
        try:
            cur = self.conn.execute(
                "SELECT DISTINCT mi.code, mi.name, mi.unit, mi.factor, "
                "       mi.higher_better, mi.alt_group "
                "FROM measurement_item mi "
                "JOIN fitness_norm fn ON fn.item_code = mi.code "
                "WHERE fn.age_min <= ? AND fn.age_max >= ? "
                "ORDER BY mi.factor, mi.code",
                (age, age),
            )
            rows = cur.fetchall()
        except sqlite3.OperationalError:
            return []
        return [
            {
                "code": r["code"], "name": r["name"], "unit": r["unit"],
                "factor": r["factor"], "higher_better": r["higher_better"],
                "alt_group": r["alt_group"],
            }
            for r in rows
        ]

    def fitness_norms(self, age: int, sex: str) -> dict:
        """{code: {"meta": {...}, "cuts": {grade: {"value","rule"}}}} for age/sex.
        테이블/행 없으면 {} (폴백 안전)."""
        sx = sex if sex in ("M", "F") else "M"
        try:
            cur = self.conn.execute(
                "SELECT fn.item_code, fn.grade, fn.cut_value, fn.cut_rule, "
                "       fn.age_min, fn.age_max, "
                "       mi.name, mi.unit, mi.factor, mi.higher_better, mi.alt_group "
                "FROM fitness_norm fn "
                "JOIN measurement_item mi ON mi.code = fn.item_code "
                "WHERE fn.sex = ? AND fn.age_min <= ? AND fn.age_max >= ?",
                (sx, age, age),
            )
            rows = cur.fetchall()
        except sqlite3.OperationalError:
            return {}
        out: dict[str, dict] = {}
        for r in rows:
            entry = out.setdefault(r["item_code"], {
                "meta": {
                    "code": r["item_code"], "name": r["name"], "unit": r["unit"],
                    "factor": r["factor"], "higher_better": r["higher_better"],
                    "alt_group": r["alt_group"],
                    "age_min": r["age_min"], "age_max": r["age_max"],
                    "age_band": self._age_band_label(r["age_min"], r["age_max"]),
                },
                "cuts": {},
            })
            entry["cuts"][r["grade"]] = {"value": r["cut_value"], "rule": r["cut_rule"]}
        return out


# ---------------------------------------------------------------------------
# fixtures build (demo mode) — maps data/fixtures/*.json into the canonical schema
# ---------------------------------------------------------------------------
def _build_conn(
    facilities: dict, courses: dict, coverage: dict, centroids: dict,
    target: str = ":memory:",
) -> sqlite3.Connection:
    conn = sqlite3.connect(target, check_same_thread=False)
    create_schema(conn)

    fac_source: dict[str, str] = {}
    for f in facilities.get("facilities", []):
        fac_source[f["id"]] = f["source"]
        ds = f.get("disability_support")
        cd = f.get("sigungu_cd") or ""
        # 데모 fixtures: 필드 있으면 그대로, 없으면 public→api / 이용권→centroid 기본값.
        coord_source = f.get("coord_source") or ("api" if f["source"] == "public" else "centroid")
        conn.execute(
            "INSERT INTO facilities "
            "(id, source, name, sido_cd, sigungu_cd, sigungu_nm, addr, lat, lon, "
            " coord_source, sports, disability_support, brno, facil_sn, status, phone) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f["id"], f["source"], f["name"], cd[:2], cd, f.get("sigungu_nm"),
                f.get("addr"), f["lat"], f["lon"], coord_source,
                ",".join(f.get("sports", [])),
                None if ds is None else int(bool(ds)),
                None, None, None, f.get("phone"),
            ),
        )
    for c in courses.get("courses", []):
        conn.execute(
            "INSERT INTO courses "
            "(id, facility_id, source, name, sport, fee_month, weekday_mask, "
            " start_tm, end_tm, target, disability_types) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                c["id"], c["facility_id"], fac_source.get(c["facility_id"]),
                c["name"], c.get("sport"), c.get("fee_month"),
                c.get("weekday_mask"), c.get("start"), c.get("end"),
                c.get("target"), None,
            ),
        )
    year = coverage.get("year")
    for r in coverage.get("rows", []):
        conn.execute(
            "INSERT INTO coverage "
            "(sigungu_cd, sigungu_nm, class, target, recipient, pop, facil_cnt, year) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                r["sigungu_cd"], r["sigungu_nm"], r.get("class"),
                r.get("target"), r.get("recipient"), r.get("pop"),
                r.get("facil_cnt"), r.get("year", year),
            ),
        )
    for c in centroids.get("centroids", []):
        cd = c["cd"]
        conn.execute(
            "INSERT OR IGNORE INTO sigungu (cd, nm, sido_cd, lat, lon) VALUES (?,?,?,?,?)",
            (cd, c.get("nm"), cd[:2], c.get("lat"), c.get("lon")),
        )
    conn.commit()
    return conn


def build_store(sqlite_target: str = ":memory:") -> Store:
    """Demo-mode store built from fixtures (unchanged contract). Tests use this."""
    ddir = data_dir()
    fdir = fixtures_dir()
    facilities = _read_json(fdir / "facilities.json")
    courses = _read_json(fdir / "courses.json")
    coverage = _read_json(fdir / "coverage_seoul_2025.json")
    rules = _read_json(ddir / "rules.json")
    centroids = _read_json(ddir / "sigungu_centroids.json")
    conn = _build_conn(facilities, courses, coverage, centroids, sqlite_target)
    return Store(conn, rules, centroids)


def open_db_store(path: str) -> Store:
    """Load the prebuilt nationwide DB (scripts/build_db.py output)."""
    conn = sqlite3.connect(path, check_same_thread=False)
    ddir = data_dir()
    rules = _read_json(ddir / "rules.json")
    centroids = _read_json(ddir / "sigungu_centroids.json")
    return Store(conn, rules, centroids)


# raw videos list lives in courses.json (fixtures) — separate small helper
def load_videos() -> list[dict]:
    data = _read_json(fixtures_dir() / "courses.json")
    return data.get("videos", [])


@lru_cache(maxsize=1)
def get_store() -> Store:
    """Process-wide singleton for the app. Prefers the prebuilt nationwide DB
    (data/sponavi.db) when present, else falls back to fixtures (demo mode).
    Tests can call build_store() directly for a deterministic fixtures store."""
    db = db_path()
    if db.exists():
        return open_db_store(str(db))
    return build_store()
