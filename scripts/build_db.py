#!/usr/bin/env python3
"""Materialize the nationwide Doenayo SQLite DB from bulk raw JSON.

    data/raw/{voucher_facility,voucher_course,dvoucher_facility,dvoucher_course,
              public_facility}.json   (scripts/bulk_fetch.py output, whole-country)
      -> data/sponavi.db  (schema = server/app/store.SCHEMA_SQL)

Idempotent: rebuilds the file from scratch each run, so re-running after more raw
files land (bulk_fetch still downloading) simply folds them in. Any missing raw
file is skipped with a clear notice; the build works with whatever exists (even
voucher_facility alone is enough for a Seoul demo).

Mapping (per server field survey 2026-07-20, see task brief):
  * sigungu code  : voucher/dvoucher use local_cd verbatim (city-level, e.g.
                    고양시=41280). public has no numeric sigungu code, so we map
                    addr_ctpv_nm(시도)->code + addr_cpb_nm(시군구명, e.g.
                    "고양시 덕양구") to the voucher/dvoucher name index (best match).
  * coordinates   : public = its own faci_lat/faci_lot. voucher/dvoucher have no
                    coords -> sigungu centroid (Seoul seed + mean of that sigungu's
                    public-facility coords), sido-centroid, then national fallback.
  * sports        : facility main_event_nm/ftype_nm + its courses' item/종목.
  * courses       : voucher_course joins voucher_facility by (brno, facil_sn).
                    dvoucher_course carries busi_reg_no but dvoucher_facility has
                    NO business-number field -> cannot be joined (kept unjoined).

Usage: python scripts/build_db.py [--out data/sponavi.db] [--quiet]
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app import region  # noqa: E402  (지역 코드 정규화 단일 표 — 서버와 공유)
from app import store as store_mod  # noqa: E402  (SCHEMA_SQL + paths)

RAW = REPO_ROOT / "data" / "raw"
DATA = REPO_ROOT / "data"

# 시도 명칭·구 코드 표는 server/app/region.py 하나만 쓴다(적재와 조회가 같은 표).
SIDO_NAME_TO_CD = region.SIDO_NAME_TO_CD
KOREA_DEFAULT = (36.5, 127.8)  # geographic center — last-resort facility coord

# public_facility field-name candidates (defensive: exact names may vary by page)
PF_LAT = ("faci_lat", "FACI_LAT")
PF_LON = ("faci_lot", "FACI_LOT", "faci_lon")
PF_NAME = ("faci_nm", "FACI_NM")
PF_ROAD = ("faci_road_addr", "FACI_ROAD_ADDR")
PF_ADDR = ("faci_addr", "FACI_ADDR")
PF_STAT = ("faci_stat_nm", "FACI_STAT_NM")
PF_TYPE = ("ftype_nm", "FTYPE_NM")
PF_COB = ("fcob_nm", "FCOB_NM")
PF_CD = ("faci_cd", "FACI_CD")
PF_GB = ("faci_gb_nm", "FACI_GB_NM")   # 시설 구분: 신고 | 공공 | 등록 (OV6)
# 시도 name sources (addr_ctpv_nm is often null → cp_nm/fmng_cp_nm always present)
PF_SIDO = ("addr_ctpv_nm", "cp_nm", "fmng_cp_nm")
# 시군구 name sources (cpb_nm is city-level like voucher & only ~1% null;
# addr_cpb_nm is 자치구-level "고양시 덕양구")
PF_SIGUNGU = ("cpb_nm", "addr_cpb_nm", "fmng_cpb_nm")


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def _load(key: str):
    p = RAW / f"{key}.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[warn] {key}.json 파싱 실패 → 스킵: {e}", file=sys.stderr)
        return None
    if not isinstance(data, list):
        print(f"[warn] {key}.json 이 배열이 아님 → 스킵", file=sys.stderr)
        return None
    return data


def _first(row: dict, keys):
    for k in keys:
        if k in row and row[k] not in (None, ""):
            return row[k]
    return None


def _digits(v):
    if v is None:
        return None
    d = re.sub(r"[^0-9]", "", str(v))
    return d or None


def _cd5(v):
    d = _digits(v)
    return d.zfill(5)[:5] if d else None


def _int_amt(v):
    d = _digits(v)
    return int(d) if d is not None else None


def _norm(s):
    return re.sub(r"\s+", "", str(s or "")).strip()


def _clean(s):
    return str(s or "").strip()


def _sport(s):
    s = _clean(s)
    return s or None


def _float(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


def _in_korea(lat, lon):
    return lat is not None and lon is not None and 32.5 <= lat <= 39.6 and 124.0 <= lon <= 132.5


# ---------------------------------------------------------------------------
# public 시설 행 규칙 한 벌 — 신규 빌드(이 파일)와 제자리 마이그레이션
# (scripts/migrate_facility_gb.py)이 **같은 함수**를 써서 "재빌드 == 마이그레이션"을 보장한다.
# ---------------------------------------------------------------------------
CLOSED_MARKS = ("폐업", "폐쇄", "말소", "취소")


def public_is_closed(row) -> bool:
    """빌드에서 제외되는 행(폐업·폐쇄·말소·취소)."""
    return any(bad in _clean(_first(row, PF_STAT)) for bad in CLOSED_MARKS)


def public_base_id(row) -> str:
    """public 시설 id = 'public-' + faci_cd 의 숫자만(faci_cd 없으면 'public-x').
    같은 base 가 겹치면 삽입 순서대로 dedupe_id 가 -2, -3 … 을 붙인다."""
    cd = _digits(_first(row, PF_CD))
    return f"public-{cd}" if cd else "public-x"


def public_faci_gb(row):
    """공공 raw 시설 구분(faci_gb_nm): 신고 | 공공 | 등록. 없으면 None."""
    return _clean(_first(row, PF_GB)) or None


def dedupe_id(base: str, seen: set) -> str:
    """id 충돌 회피: base, base-2, base-3 … (seen 을 제자리 갱신)."""
    if base not in seen:
        seen.add(base)
        return base
    i = 2
    while f"{base}-{i}" in seen:
        i += 1
    fid = f"{base}-{i}"
    seen.add(fid)
    return fid


def course_target(name, desc=None) -> str:
    """Extract a target band matching engine vocabulary
    (전연령|유청소년|성인|어르신|장애인). fee==0 (free) is signalled separately."""
    text = f"{name or ''} {desc or ''}"
    if "장애" in text:
        return "장애인"
    if any(k in text for k in ("어르신", "실버", "노인", "시니어")):
        return "어르신"
    if any(k in text for k in ("유아", "어린이", "초등", "청소년", "주니어", "키즈", "유소년", "학생", "아동")):
        return "유청소년"
    if "성인" in text:
        return "성인"
    return "전연령"


sido_cd_from_name = region.sido_cd_from_name


# ---------------------------------------------------------------------------
# sigungu master (code<->name) from voucher + dvoucher
# ---------------------------------------------------------------------------
def build_sigungu_master(vf, df):
    """원천 local_cd/local_nm → (현행 마스터, 구코드 별칭, 이름 인덱스, 미해소).

    API 가 전환기라 구·신 시도코드를 섞어 준다(29·46 ↔ 12, 42→51, 45→52).
    마스터 단계에서 현행 코드 하나로 접고, 구 코드는 버리는 대신 별칭으로 남긴다
    (입력으로 구 코드가 와도 결정론으로 해석되도록 — server/app/region.py).
    """
    raw: dict[str, str] = {}
    for r in (vf or []) + (df or []):
        cd = _cd5(r.get("local_cd"))
        nm = _clean(r.get("local_nm"))
        if cd and nm:
            raw.setdefault(cd, nm)
    code2nm, alias, unresolved = region.canonicalize_master(raw)
    nm2code_by_sido = region.build_name_index(code2nm)
    return code2nm, alias, nm2code_by_sido, unresolved


def sido_candidates(row):
    """Ordered candidate 시도 codes for a public row (현행 코드). cp_nm/fmng_cp_nm are
    always present when addr_ctpv_nm is null; road/jibun address first token is a
    last resort. '전남광주통합특별시'·'광주광역시'·'전라남도' 는 전부 12 로 접힌다."""
    cands: list[str] = []

    def add(s):
        if s and s not in cands:
            cands.append(s)

    for k in PF_SIDO:
        add(region.sido_cd_from_name(row.get(k)))
    for k in PF_ROAD + PF_ADDR:
        v = row.get(k)
        toks = str(v or "").split()
        if toks:
            add(region.sido_cd_from_name(toks[0]))
    return cands


def map_public_code(row, nm2code_by_sido, sole):
    """public row -> (sigungu_cd|None, sido_cd|None, how).

    이름 대조(기존) → 개칭 별칭 → 주소 앞 2토큰 → 시군구 1곳뿐인 시도 순.
    규칙 본체는 region.resolve_sigungu 가 소유한다(마이그레이션 스크립트와 공유)."""
    cands = sido_candidates(row)
    if not cands:
        return None, None, "sido_fail"
    names = [row.get(k) for k in PF_SIGUNGU if _norm(row.get(k))]
    addr = _clean(_first(row, PF_ROAD)) or _clean(_first(row, PF_ADDR))
    return region.resolve_sigungu(cands, names, addr, nm2code_by_sido, sole)


# ---------------------------------------------------------------------------
# centroids
# ---------------------------------------------------------------------------
def build_centroids(seed_json, public_facs):
    """Return (centroid[cd]->(lat,lon), sido_centroid[sido]->(lat,lon))."""
    centroid: dict[str, tuple] = {}
    acc: dict[str, list] = defaultdict(lambda: [0.0, 0.0, 0])
    for pf in public_facs:
        cd, lat, lon = pf["sigungu_cd"], pf["_own_lat"], pf["_own_lon"]
        if cd and _in_korea(lat, lon):
            a = acc[cd]
            a[0] += lat
            a[1] += lon
            a[2] += 1
    for cd, (sla, slo, n) in acc.items():
        if n:
            centroid[cd] = (sla / n, slo / n)
    # Seoul seed authoritative (overwrites public means for Seoul 25)
    for c in seed_json.get("centroids", []):
        centroid[c["cd"]] = (c["lat"], c["lon"])
    # sido centroid = mean of that sido's sigungu centroids
    sido_acc: dict[str, list] = defaultdict(lambda: [0.0, 0.0, 0])
    for cd, (la, lo) in centroid.items():
        a = sido_acc[cd[:2]]
        a[0] += la
        a[1] += lo
        a[2] += 1
    sido_centroid = {s: (a[0] / a[2], a[1] / a[2]) for s, a in sido_acc.items() if a[2]}
    return centroid, sido_centroid


def make_coord_resolvers(centroid, sido_centroid):
    def sigungu_coord(cd):
        """Real centroid or (None, None) — for applicant-location resolution."""
        if cd in centroid:
            return centroid[cd]
        s = region.canonical_sido(cd)
        if s in sido_centroid:
            return sido_centroid[s]
        return (None, None)

    def facility_coord(cd):
        """Never-null — national default last resort (keeps haversine safe)."""
        la, lo = sigungu_coord(cd) if cd else (None, None)
        return (la, lo) if la is not None else KOREA_DEFAULT

    return sigungu_coord, facility_coord


# ---------------------------------------------------------------------------
# facility / course assembly
# ---------------------------------------------------------------------------
def assemble(vf, vc, df, dc, pf, nm2code_by_sido, code2nm, alias):
    """Parse raw rows into intermediate dicts (coords filled later).

    시설의 시군구 코드는 여기서 현행 코드로 접는다(alias). 이름도 현행 마스터 값을
    쓴다 — 원천 local_nm 은 구 코드 시절 표기가 섞여 있다."""
    report = {}
    recoded = Counter()

    def canon(cd):
        """구 코드 → 현행 코드(+집계). 별칭에 없으면 그대로 둔다."""
        if cd and cd in alias:
            recoded[(cd, alias[cd])] += 1
            return alias[cd]
        return cd

    # ---- voucher facilities (dedupe by (brno, facil_sn), union main_event) ----
    vfac: dict[tuple, dict] = {}
    for r in vf or []:
        brno = _digits(r.get("brno"))
        sn = _clean(r.get("facil_sn"))
        key = (brno, sn)
        cd = canon(_cd5(r.get("local_cd")))
        if key not in vfac:
            vfac[key] = {
                "id": f"voucher-{brno}-{sn}",
                "source": "voucher",
                "name": _clean(r.get("facil_nm")),
                "sido_cd": (cd or "")[:2] or None,
                "sigungu_cd": cd,
                "sigungu_nm": code2nm.get(cd) or _clean(r.get("local_nm")),
                "addr": _clean(r.get("road_addr")) or _clean(r.get("faci_daddr")),
                "sports": set(),
                "disability_support": None,
                "brno": brno,
                "facil_sn": sn,
                "status": None,
                "phone": None,
            }
        ev = _sport(r.get("main_event_nm"))
        if ev:
            vfac[key]["sports"].add(ev)
    report["voucher_facility"] = len(vfac)

    # ---- voucher courses join (brno, facil_sn) ----
    courses: list[dict] = []
    vc_matched = 0
    for i, r in enumerate(vc or []):
        key = (_digits(r.get("brno")), _clean(r.get("facil_sn")))
        fac = vfac.get(key)
        if fac:
            vc_matched += 1
        sport = _sport(r.get("item_nm"))
        courses.append({
            "id": f"vc-{i}",
            "facility_id": fac["id"] if fac else None,
            "source": "voucher",
            "name": _clean(r.get("course_nm")),
            "sport": sport,
            "fee_month": _int_amt(r.get("settl_amt")),
            "weekday_mask": _clean(r.get("lectr_weekday_val")) or None,
            "start_tm": _clean(r.get("start_tm")) or None,
            "end_tm": _clean(r.get("equip_tm")) or None,
            "target": course_target(r.get("course_nm"), r.get("course_seta_desc_cn")),
            "disability_types": None,
        })
        if fac and sport:
            fac["sports"].add(sport)
    report["voucher_course"] = len(vc or [])
    report["voucher_course_matched"] = vc_matched

    # ---- dvoucher facilities (disability-dedicated => disability_support=1) ----
    dfac: list[dict] = []
    for i, r in enumerate(df or []):
        cd = canon(_cd5(r.get("local_cd")))
        ev = _sport(r.get("main_event_nm"))
        dfac.append({
            "id": f"dvoucher-{i}",
            "source": "dvoucher",
            "name": _clean(r.get("facil_nm")),
            "sido_cd": (cd or "")[:2] or None,
            "sigungu_cd": cd,
            "sigungu_nm": code2nm.get(cd) or _clean(r.get("local_nm")),
            "addr": _clean(r.get("road_addr")) or _clean(r.get("faci_daddr")),
            "sports": {ev} if ev else set(),
            "disability_support": 1,
            "brno": None,
            "facil_sn": None,
            "status": None,
            "phone": _digits(r.get("res_telno")),
        })
    report["dvoucher_facility"] = len(dfac)

    # ---- dvoucher courses: busi_reg_no present but dvoucher_facility has no
    #      business-number field -> cannot join. Kept with facility_id=NULL. ----
    for i, r in enumerate(dc or []):
        courses.append({
            "id": f"dc-{i}",
            "facility_id": None,
            "source": "dvoucher",
            "name": _clean(r.get("course_nm")),
            "sport": _sport(r.get("cntnt_fst")),
            "fee_month": _int_amt(r.get("settl_amt")),
            "weekday_mask": _clean(r.get("weekday")) or None,
            "start_tm": _clean(r.get("start_time")) or None,
            "end_tm": _clean(r.get("end_time")) or None,
            "target": course_target(r.get("course_nm")),
            "disability_types": _clean(r.get("dspsn_ty_nm")) or None,
        })
    report["dvoucher_course"] = len(dc or [])
    report["dvoucher_course_unjoined"] = len(dc or [])

    # ---- public facilities (drop 폐업; map name->code; own coords) ----
    pfac: list[dict] = []
    how_ctr: Counter = Counter()
    public_code_names: dict[str, str] = {}
    dropped_closed = 0
    sole = region.sole_sigungu(nm2code_by_sido)
    for r in pf or []:
        status = _clean(_first(r, PF_STAT))
        if public_is_closed(r):
            dropped_closed += 1
            continue
        cd, sido, how = map_public_code(r, nm2code_by_sido, sole)
        how_ctr[how] += 1
        sigungu_nm = _clean(_first(r, ("addr_cpb_nm", "cpb_nm", "fmng_cpb_nm")))
        # 이름이 비었거나(주소·단일시군구로 확정) 폐지 지명이었던 행(개칭 별칭)은
        # 마스터의 현행 명칭으로 표시한다 — 없어진 구 이름을 그대로 보여주지 않는다.
        if cd and (how in ("rename", "addr", "sole") or not sigungu_nm):
            sigungu_nm = code2nm.get(cd) or sigungu_nm
        if cd and sigungu_nm:
            public_code_names.setdefault(cd, sigungu_nm)
        lat = _float(_first(r, PF_LAT))
        lon = _float(_first(r, PF_LON))
        sports = set()
        for s in (_sport(_first(r, PF_TYPE)), _sport(_first(r, PF_COB))):
            if s:
                sports.add(s)
        blob = " ".join(_clean(_first(r, k)) for k in (PF_NAME, PF_TYPE, PF_COB))
        pfac.append({
            "id": public_base_id(r),   # 중복 base 는 삽입 시 -2, -3 … (dedupe_id)
            "faci_gb": public_faci_gb(r),
            "source": "public",
            "name": _clean(_first(r, PF_NAME)),
            "sido_cd": sido or ((cd or "")[:2] or None),
            "sigungu_cd": cd,
            "sigungu_nm": sigungu_nm,
            "addr": _clean(_first(r, PF_ROAD)) or _clean(_first(r, PF_ADDR)),
            "_own_lat": lat if _in_korea(lat, lon) else None,
            "_own_lon": lon if _in_korea(lat, lon) else None,
            "sports": sports,
            "disability_support": 1 if "장애" in blob else None,
            "brno": None,
            "facil_sn": None,
            "status": status or None,
            "phone": None,
        })
    report["public_facility"] = len(pfac)
    report["public_dropped_closed"] = dropped_closed
    report["public_map_how"] = dict(how_ctr)
    report["public_code_names"] = public_code_names
    report["recoded"] = dict(recoded)
    return vfac, dfac, pfac, courses, report


# ---------------------------------------------------------------------------
# write DB
# ---------------------------------------------------------------------------
def write_db(out: Path, vfac, dfac, pfac, courses, code2nm, alias, public_code_names,
             seed_json, sigungu_coord, facility_coord):
    if out.exists():
        out.unlink()
    conn = sqlite3.connect(str(out))
    store_mod.create_schema(conn)

    # facilities: fill coords, join sports -> comma text, de-dupe ids
    seen_ids: set[str] = set()

    def _insert_fac(f, lat, lon, coord_source):
        fid = dedupe_id(f["id"], seen_ids)
        conn.execute(
            "INSERT INTO facilities "
            "(id, source, name, sido_cd, sigungu_cd, sigungu_nm, addr, lat, lon, "
            " coord_source, faci_gb, sports, disability_support, brno, facil_sn, "
            " status, phone) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                fid, f["source"], f["name"], f["sido_cd"], f["sigungu_cd"],
                f["sigungu_nm"], f["addr"], lat, lon, coord_source,
                f.get("faci_gb"),   # public 만 채워진다(이용권 원천엔 없는 필드)
                ",".join(sorted(s for s in f["sports"] if s)),
                f["disability_support"], f["brno"], f["facil_sn"],
                f["status"], f["phone"],
            ),
        )

    # 좌표 정직성: voucher/dvoucher 는 실좌표가 없어 전부 시군구 중심 폴백(centroid).
    # public 은 원본 좌표(_own_lat) 보유 시 실좌표(api), 폴백 시 centroid.
    for f in vfac.values():
        la, lo = facility_coord(f["sigungu_cd"])
        _insert_fac(f, la, lo, "centroid")
    for f in dfac:
        la, lo = facility_coord(f["sigungu_cd"])
        _insert_fac(f, la, lo, "centroid")
    for f in pfac:
        la, lo = f["_own_lat"], f["_own_lon"]
        if la is None:
            la, lo = facility_coord(f["sigungu_cd"])
            coord_source = "centroid"
        else:
            coord_source = "api"
        _insert_fac(f, la, lo, coord_source)

    # courses
    for c in courses:
        conn.execute(
            "INSERT OR IGNORE INTO courses "
            "(id, facility_id, source, name, sport, fee_month, weekday_mask, "
            " start_tm, end_tm, target, disability_types) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                c["id"], c["facility_id"], c["source"], c["name"], c["sport"],
                c["fee_month"], c["weekday_mask"], c["start_tm"], c["end_tm"],
                c["target"], c["disability_types"],
            ),
        )

    # coverage — from fixtures (서울 15구 실측; 전국 미확보라 그대로, SPEC)
    cov = json.loads((DATA / "fixtures" / "coverage_seoul_2025.json").read_text("utf-8"))
    cyear = cov.get("year")
    for r in cov.get("rows", []):
        conn.execute(
            "INSERT INTO coverage "
            "(sigungu_cd, sigungu_nm, class, target, recipient, pop, facil_cnt, year) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                r["sigungu_cd"], r["sigungu_nm"], r.get("class"), r.get("target"),
                r.get("recipient"), r.get("pop"), r.get("facil_cnt"),
                r.get("year", cyear),
            ),
        )

    # sigungu — union(master, seoul seed, public-mapped), coords from centroids.
    # 마스터는 이미 현행 코드만 남긴 상태(region.canonicalize_master).
    sig: dict[str, str] = dict(code2nm)
    for c in seed_json.get("centroids", []):
        sig.setdefault(c["cd"], c["nm"])
    for cd, nm in public_code_names.items():
        sig.setdefault(cd, nm)
    for cd in sorted(sig):
        la, lo = sigungu_coord(cd)
        conn.execute(
            "INSERT OR REPLACE INTO sigungu (cd, nm, sido_cd, lat, lon) VALUES (?,?,?,?,?)",
            (cd, sig[cd], cd[:2], la, lo),
        )

    # sigungu_alias — 구 코드로 들어온 입력(챗 NLU·assess 요청)을 현행 코드로 해석하는 표.
    for old, new in sorted(alias.items()):
        reason = "sido_merge" if old[:2] in region.SIDO_MERGE else "sido_recode"
        conn.execute(
            "INSERT OR REPLACE INTO sigungu_alias (old_cd, new_cd, reason) VALUES (?,?,?)",
            (old, new, reason),
        )

    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DATA / "sponavi.db"))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)

    vf = _load("voucher_facility")
    vc = _load("voucher_course")
    df = _load("dvoucher_facility")
    dc = _load("dvoucher_course")
    pf = _load("public_facility")

    present = [k for k, v in [
        ("voucher_facility", vf), ("voucher_course", vc),
        ("dvoucher_facility", df), ("dvoucher_course", dc),
        ("public_facility", pf)] if v is not None]
    missing = [k for k, v in [
        ("voucher_facility", vf), ("voucher_course", vc),
        ("dvoucher_facility", df), ("dvoucher_course", dc),
        ("public_facility", pf)] if v is None]
    print(f"[build_db] raw 확보: {', '.join(present) or '(없음)'}")
    if missing:
        print(f"[build_db] raw 미확보(스킵): {', '.join(missing)}  "
              f"→ bulk_fetch 완료 후 재실행하면 반영됨(idempotent)")
    if vf is None and df is None and pf is None:
        sys.exit("[build_db] 시설 raw가 하나도 없어 빌드 불가")

    code2nm, alias, nm2code_by_sido, unresolved = build_sigungu_master(vf, df)
    if unresolved:
        print(f"[build_db] ⚠ 구 시군구코드 {len(unresolved)}건을 현행 코드로 옮기지 못함 "
              f"(추측 매핑 금지 — 구 코드 그대로 적재):", file=sys.stderr)
        for u in unresolved:
            print(f"    {u['cd']} {u['nm']} — {u['reason']}", file=sys.stderr)
    vfac, dfac, pfac, courses, rep = assemble(
        vf, vc, df, dc, pf, nm2code_by_sido, code2nm, alias
    )
    seed_json = json.loads((DATA / "sigungu_centroids.json").read_text("utf-8"))
    centroid, sido_centroid = build_centroids(seed_json, pfac)
    sigungu_coord, facility_coord = make_coord_resolvers(centroid, sido_centroid)

    conn = write_db(out, vfac, dfac, pfac, courses, code2nm, alias,
                    rep["public_code_names"], seed_json, sigungu_coord, facility_coord)

    # ---- report (actual queries) ----
    q = lambda sql, *a: conn.execute(sql, a).fetchone()[0]  # noqa: E731
    n_fac = q("SELECT COUNT(*) FROM facilities")
    n_course = q("SELECT COUNT(*) FROM courses")
    n_cov = q("SELECT COUNT(*) FROM coverage")
    n_sig = q("SELECT COUNT(*) FROM sigungu")
    n_sig_geo = q("SELECT COUNT(*) FROM sigungu WHERE lat IS NOT NULL")
    by_src = conn.execute(
        "SELECT source, COUNT(*) FROM facilities GROUP BY source ORDER BY source"
    ).fetchall()
    by_coord = conn.execute(
        "SELECT source, coord_source, COUNT(*) FROM facilities "
        "GROUP BY source, coord_source ORDER BY source, coord_source"
    ).fetchall()
    by_gb = conn.execute(
        "SELECT COALESCE(faci_gb,'(NULL)'), COUNT(*) FROM facilities "
        "WHERE source='public' GROUP BY faci_gb ORDER BY COUNT(*) DESC"
    ).fetchall()
    sb = q("SELECT COUNT(*) FROM facilities WHERE sigungu_cd = '11290'")
    n_alias = q("SELECT COUNT(*) FROM sigungu_alias")
    n_null = q("SELECT COUNT(*) FROM facilities WHERE sigungu_cd IS NULL")
    n_legacy = q(
        "SELECT COUNT(*) FROM facilities WHERE substr(sigungu_cd,1,2) IN ('29','46','42','45')"
    )

    print(f"\n[build_db] {out} 생성 완료")
    print(f"  facilities {n_fac} · courses {n_course} · coverage {n_cov}행 · "
          f"sigungu {n_sig}({n_sig_geo} 좌표보유) · sigungu_alias {n_alias}")
    print(f"  지역 정규화: 구코드 시설 잔여 {n_legacy}건 · sigungu_cd NULL {n_null}건")
    if rep.get("recoded"):
        top = sorted(rep["recoded"].items(), key=lambda kv: -kv[1])[:5]
        print("  구→현행 재코딩 상위: "
              + ", ".join(f"{o}→{n}={c}" for (o, n), c in top))
    print(f"  source 분포: {', '.join(f'{s}={c}' for s, c in by_src)}")
    print(f"  coord_source 분포: {', '.join(f'{s}/{cs}={c}' for s, cs, c in by_coord)}")
    print(f"  public faci_gb 분포: {', '.join(f'{g}={c}' for g, c in by_gb) or '(없음)'}")
    print(f"  성북구(11290) 시설 {sb}개")
    print(f"  voucher_course 매칭: {rep.get('voucher_course_matched',0)}/"
          f"{rep.get('voucher_course',0)}")
    if rep.get("dvoucher_course_unjoined"):
        print(f"  dvoucher_course {rep['dvoucher_course_unjoined']}건: 시설 조인키 없음 "
              f"→ facility_id=NULL(미조인, 보존)")
    how = rep.get("public_map_how") or {}
    if how:
        tot = sum(how.values())
        matched = tot - how.get("nomatch", 0) - how.get("sido_fail", 0)
        print(f"  public 시군구→코드 매칭: {matched}/{tot} "
              f"({(matched/tot*100 if tot else 0):.1f}%) 상세={how} "
              f"(name=이름대조 · rename=개칭별칭 · addr=주소토큰 · sole=시군구 1곳뿐인 시도)")
        print(f"  public 폐업 제외: {rep.get('public_dropped_closed',0)}건")
    else:
        print("  public_facility 미확보 → 전국 centroid 근사 없음(Seoul seed만). "
              "완료 후 재실행 필요")
    conn.close()


if __name__ == "__main__":
    main()
