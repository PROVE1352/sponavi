"""지도 범위 검색(GET /api/facilities/in-bounds)용 **프로세스 메모리** 공간 인덱스.

DB(data/sponavi.db)는 동결본이라 좌표 인덱스를 만들 수 없다(SQLite 에는 idx_fac_geo 가
없다). 그래서 워커마다 facilities 를 한 번 훑어 메모리 안에 위도 정렬 배열을 만든다.
DB 에는 아무것도 쓰지 않는다 — 스키마·인덱스·행 모두 그대로다.

## 좌표 등급(docs/API.md · 계약 §3.3)
coord_source 가 api·geocoded 라고 해서 전부 실좌표로 치지 않는다(정직성 P-1).

- ``placeholder``     api 행 중, 서로 다른 영역(시군구 또는 영역그룹) 3곳 이상이 **똑같은**
                      (lat, lon)을 함께 쓰는 점에 있는 행. 원천 기본값(세종 한 점 등)이다.
- ``far``             api 행 중, 자기 시군구의 강건 중심(자리표시 점을 뺀 api 행 5개 이상의
                      위·경도 중앙값, 모자라면 시군구 중심점)에서 40km 넘게 떨어진 행.
- ``no_ref``          api 행인데 강건 중심도 시군구 중심점도 없는 행(실 DB 0건).
- ``shared_point``    api 행 중 주소에 번지가 없는 행이, 역시 번지 없는 **다른 이름의** api 행과
                      **똑같은** 좌표를 함께 쓰는 행. 시군구·읍면동·도로 단위로 지오코딩된 근사
                      좌표다('대전광역시 동구' 한 줄 주소 88행이 한 점). 이름이 하나뿐인 점(같은 시설
                      중복 행)과 혼자 있는 점(약수터·공원)은 real 로 둔다.
- ``geocoded_approx`` 번지(건물번호) 없는 주소로 지오코딩된 행 — 동·구 중심에 찍혀 있다.
- ``centroid``        시군구 중심점 폴백 행(과 알 수 없는 coord_source).
- ``no_coord``        lat/lon 이 비어 있는 행(방어용 — 실 DB 0건).
- ``real``            위 어디에도 걸리지 않은 행. **범위 판정에는 이 등급만 쓴다.**

## 구조
- source 별 real 행: (경도 띠, 위도) 순으로 정렬한 열 배열. 띠(``STRIP_DEG``)마다 연속
  구간이라 ``bisect`` 로 위도 구간을 잡은 뒤 경도·검색어로 거른다(전국 위도대를 통째로
  훑지 않는다).
- 증거 배열: real 등급 api 행(모든 source). 위치 미상 묶음 규칙 B(서로 다른 좌표 2곳)용.
- approx 버킷: (source, 영역) → 개수·접은 이름·주소. 위치 미상 묶음 개수용.
- 영역 메타: 이름·표시 이름·소속 코드·규칙 A 기준점(소속 코드별 강건 중심).
"""
from __future__ import annotations

import bisect
import heapq
import math
import re
import statistics
import time
from array import array
from typing import Iterable, Optional, Sequence

from . import engine, region
from .store import haversine_km

SOURCES: tuple[str, ...] = ("voucher", "dvoucher", "public")
_SRC_CODE = {s: i for i, s in enumerate(SOURCES)}

# coord_source 코드
_CS_API, _CS_GEO, _CS_OTHER = 0, 1, 2

# 좌표 등급 코드 → 이름
REAL = "real"
_CLASS_NAMES: tuple[str, ...] = (
    REAL, "placeholder", "far", "no_ref", "geocoded_approx", "centroid", "no_coord", "shared_point",
)
_C_REAL, _C_PH, _C_FAR, _C_NOREF, _C_GEOAPPROX, _C_CENTROID, _C_NOCOORD, _C_SHARED = range(8)

# 경도 띠 폭(도). 20km 화면(경도 폭 ≤ 약 0.23°)이 띠 5~6개에 걸친다.
STRIP_DEG = 0.05

_UPPER = re.compile(r"[A-Z]")
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
# 한 점 공유 판정의 이름 키에서 지우는 공백(웹 목 mocks/area.ts 와 같은 글자 집합 — 명시적으로 적는다).
_NAME_WS = re.compile("[ \t\n\r\f\v\u00a0\u3000]+")


def fold(s: Optional[str]) -> str:
    """ASCII A–Z 만 소문자로 — SQLite LIKE 의 대소문자 규칙과 같다(한글·전각은 그대로)."""
    if not s:
        return ""
    return s.translate(_ASCII_LOWER) if _UPPER.search(s) else s


def name_key(s: Optional[str]) -> str:
    """한 점 공유(shared_point) 판정용 이름 키 — ASCII 소문자 + 공백 제거.
    '동충동 체육시설'과 '동충동체육시설'은 같은 시설(중복 행)로 본다."""
    return _NAME_WS.sub("", fold(s))


def fold_bytes(s: Optional[str]) -> bytes:
    """접은 문자열의 UTF-8 바이트. 인덱스는 이름·주소를 이 형태로 들고 있다(메모리 약 30%↓).

    UTF-8 은 자기 동기화 부호라 ``tok.encode() in s.encode()`` ⇔ ``tok in s`` 이다 —
    바이트 부분일치가 글자 경계를 어긋나게 잡는 일이 없다."""
    return fold(s).encode("utf-8", "surrogatepass")


def _matcher(tokens: Sequence[str]):
    """토큰 AND 매칭 함수 (name_f, addr_f) -> bool. 토큰이 없으면 None.

    토큰마다 ``tok in name_f or tok in addr_f`` — 이름·주소를 이어 붙이지 않는다."""
    toks = [fold_bytes(t) for t in tokens if t]
    if not toks:
        return None
    if len(toks) == 1:
        t = toks[0]
        return lambda n, a: t in n or t in a
    return lambda n, a: all(t in n or t in a for t in toks)


class _Cols:
    """(경도 띠, 위도) 정렬 열 배열 + 띠별 연속 구간."""

    __slots__ = ("lat", "lon", "strip_keys", "strip_span")

    def __init__(self) -> None:
        self.lat = array("d")
        self.lon = array("d")
        self.strip_keys: list[int] = []            # 정렬된 띠 번호
        self.strip_span: list[tuple] = []          # (start, end, lon_min, lon_max)

    def ranges(self, min_lat: float, min_lon: float, max_lat: float, max_lon: float):
        """범위와 겹치는 띠마다 (lo, hi, interior). interior=True 면 그 띠의 모든 경도가
        범위 안이라 경도 검사를 건너뛰어도 된다(띠의 실제 최소·최대 경도로 판정)."""
        keys = self.strip_keys
        if not keys:
            return
        s0 = math.floor(min_lon / STRIP_DEG) - 1   # 부동소수 경계 여유 1칸
        s1 = math.floor(max_lon / STRIP_DEG) + 1
        k0 = bisect.bisect_left(keys, s0)
        k1 = bisect.bisect_right(keys, s1)
        lat = self.lat
        for k in range(k0, k1):
            start, end, lo_min, lo_max = self.strip_span[k]
            if lo_max < min_lon or lo_min > max_lon:
                continue
            lo = bisect.bisect_left(lat, min_lat, start, end)
            hi = bisect.bisect_right(lat, max_lat, lo, end)
            if lo < hi:
                yield lo, hi, (lo_min >= min_lon and lo_max <= max_lon)


def _build_cols(rows: list[int], lat: array, lon: array) -> tuple[_Cols, list[int]]:
    """행 번호들을 (경도 띠, 위도) 순으로 정렬해 열 배열을 만든다. 정렬된 행 번호도 돌려준다.

    튜플 키 대신 안정 정렬 두 번(위도 → 띠)으로 같은 순서를 만든다(빌드 중 메모리 절약)."""
    order = sorted(rows, key=lat.__getitem__)
    order.sort(key=lambda i: math.floor(lon[i] / STRIP_DEG))
    cols = _Cols()
    cols.lat = array("d", (lat[i] for i in order))
    cols.lon = array("d", (lon[i] for i in order))
    cur = None
    start = 0
    lo_min = lo_max = 0.0
    for pos, i in enumerate(order):
        v = lon[i]
        s = math.floor(v / STRIP_DEG)
        if s != cur:
            if cur is not None:
                cols.strip_keys.append(cur)
                cols.strip_span.append((start, pos, lo_min, lo_max))
            cur, start, lo_min, lo_max = s, pos, v, v
        else:
            if v < lo_min:
                lo_min = v
            if v > lo_max:
                lo_max = v
    if cur is not None:
        cols.strip_keys.append(cur)
        cols.strip_span.append((start, len(order), lo_min, lo_max))
    return cols, order


class _RealSet:
    """한 source 의 real 등급 행."""

    __slots__ = ("cols", "rowid", "ids", "names", "addrs")

    def __init__(self, cols: _Cols, rowid: array, ids: list, names: list, addrs: list):
        self.cols = cols
        self.rowid = rowid
        self.ids = ids
        self.names = names
        self.addrs = addrs


class _Bucket:
    """(source, 영역) 의 approx 행 — 개수와 검색어 매칭용 접은 이름·주소."""

    __slots__ = ("count", "names", "addrs")

    def __init__(self) -> None:
        self.count = 0
        self.names: list[bytes] = []
        self.addrs: list[bytes] = []


class AreaIndex:
    """빌드 뒤 읽기 전용. 여러 스레드가 동시에 조회해도 안전하다(공유 상태를 바꾸지 않는다)."""

    def __init__(self) -> None:
        self._real: dict[str, _RealSet] = {}
        self._ev_cols = _Cols()
        self._ev_area = array("H")
        self._approx: dict[str, dict[int, _Bucket]] = {s: {} for s in SOURCES}
        self._approx_targets: dict[str, frozenset] = {s: frozenset() for s in SOURCES}
        self._areas: list[dict] = []                # 영역 메타(인덱스 = 영역 번호)
        self._nonreal: dict[str, str] = {}          # 비real id → 등급 이름
        self._stats: dict = {}

    # ------------------------------------------------------------------ build
    @classmethod
    def build(cls, store) -> "AreaIndex":
        """facilities 를 ORDER BY 없이 한 번 훑어 인덱스를 만든다(DB 무변경)."""
        t0 = time.perf_counter()
        self = cls()

        # -- 1단계: 필드별 임시 리스트 ------------------------------------------
        cur = store.conn.cursor()
        cur.row_factory = None  # 튜플 — sqlite3.Row 생성 비용·메모리 절약
        cur.execute(
            "SELECT rowid, id, source, coord_source, sigungu_cd, lat, lon, name, addr "
            "FROM facilities"
        )
        rowids = array("q")
        ids: list[str] = []
        src = array("b")
        cs = array("b")
        code_of = array("i")          # 행 → 코드 번호
        lat = array("d")
        lon = array("d")
        has_coord = bytearray()
        names: list[bytes] = []      # 접은 이름(UTF-8)
        addrs: list[bytes] = []      # 접은 주소(UTF-8)
        geo_bno = bytearray()        # geocoded 행의 번지 유무(원문 주소 정규식)
        api_nobno: dict[int, str] = {}  # 번지 없는 api 행 → 이름 키(한 점 공유 판정용)

        codes: list[Optional[str]] = []             # 코드 번호 → 현행 코드(cd')
        code_idx: dict[Optional[str], int] = {}     # 원 코드 → 코드 번호
        intern: dict[bytes, bytes] = {}             # 같은 바이트열은 한 벌만(메모리)
        bno = engine.AREA_GEOCODED_BNO_RE
        api_bno = engine.AREA_API_BNO_RE

        def _code(raw: Optional[str]) -> int:
            k = code_idx.get(raw)
            if k is None:
                cd = store.canonical_sigungu(raw) if raw else None
                k = len(codes)
                codes.append(cd)
                code_idx[raw] = k
            return k

        for (rid, fid, source, coord_source, sigungu_cd, la, lo, name, addr) in cur:
            sc = _SRC_CODE.get(source)
            if sc is None:
                continue  # 알 수 없는 source — 어떤 program 으로도 조회되지 않는다
            if not coord_source:
                # _facility_row 와 같은 폴백: public → api, 그 밖 → centroid
                coord_source = "api" if source == "public" else "centroid"
            rowids.append(rid)
            ids.append(fid)
            src.append(sc)
            cs.append(
                _CS_API if coord_source == "api"
                else _CS_GEO if coord_source == "geocoded" else _CS_OTHER
            )
            code_of.append(_code(sigungu_cd))
            ok = la is not None and lo is not None
            has_coord.append(1 if ok else 0)
            lat.append(float(la) if ok else 0.0)
            lon.append(float(lo) if ok else 0.0)
            b = fold_bytes(name)
            names.append(intern.setdefault(b, b))
            b = fold_bytes(addr)
            addrs.append(intern.setdefault(b, b))
            geo_bno.append(
                1 if (coord_source == "geocoded" and bno.search(addr or "")) else 0
            )
            if coord_source == "api" and ok and not api_bno.search(addr or ""):
                api_nobno[len(ids) - 1] = name_key(name)
        cur.close()
        del intern
        n_rows = len(ids)

        # -- 코드 → 영역 ---------------------------------------------------------
        area_idx: dict = {}             # 영역 키 → 영역 번호
        area_keys: list = []
        area_members: list[tuple] = []
        area_group: list[Optional[dict]] = []
        code_area = array("i")          # 코드 번호 → 영역 번호

        def _area_of(cd: Optional[str]) -> int:
            if cd is None:
                key, members, group = None, (), None
            else:
                members, group = region.count_scope(cd)
                key = group["id"] if group else cd
            k = area_idx.get(key)
            if k is None:
                k = len(area_keys)
                area_idx[key] = k
                area_keys.append(key)
                area_members.append(tuple(members))
                area_group.append(group)
            return k

        for cd in codes:
            code_area.append(_area_of(cd))
        # 그룹 소속 코드는 행이 없어도 규칙 A 기준점을 가져야 한다.
        member_codes: set[str] = set()
        for g in region.SIGUNGU_GROUPS:
            _area_of(g["members"][0])
            member_codes.update(g["members"])

        # -- 2단계: 자리표시 점 → 강건 중심 → 등급 -----------------------------
        # 자리표시 점: api 행을 위도로 정렬해 같은 위도 구간마다 경도가 **똑같은** 행끼리
        # 묶는다(반올림 없음). 한 점에 서로 다른 영역이 min_areas 곳 이상이면 자리표시 점.
        min_areas = engine.AREA_PLACEHOLDER_MIN_AREAS
        api_rows = [i for i in range(n_rows) if cs[i] == _CS_API and has_coord[i]]
        api_rows.sort(key=lat.__getitem__)
        is_ph = bytearray(n_rows)
        placeholder_points = 0
        run_start = 0
        n_api = len(api_rows)
        while run_start < n_api:
            la0 = lat[api_rows[run_start]]
            run_end = run_start + 1
            while run_end < n_api and lat[api_rows[run_end]] == la0:
                run_end += 1
            if run_end - run_start >= min_areas:
                by_lon: dict[float, list[int]] = {}
                for j in range(run_start, run_end):
                    i = api_rows[j]
                    by_lon.setdefault(lon[i], []).append(i)
                for members in by_lon.values():
                    if len(members) < min_areas:
                        continue
                    if len({code_area[code_of[i]] for i in members}) >= min_areas:
                        placeholder_points += 1
                        for i in members:
                            is_ph[i] = 1
            run_start = run_end

        # 한 점 공유: 자리표시 점이 아닌 번지 없는 api 행을 좌표가 **똑같은** 것끼리 묶어, 서로 다른
        # 이름 키가 min_names 개 이상이면 그 행들은 shared_point(먼 행 판정이 먼저다).
        min_names = engine.AREA_SHARED_POINT_MIN_NAMES
        by_point: dict[tuple[float, float], list[int]] = {}
        for i in api_nobno:
            if not is_ph[i]:
                by_point.setdefault((lat[i], lon[i]), []).append(i)
        is_shared = bytearray(n_rows)
        shared_points = 0
        for members in by_point.values():
            if len(members) < min_names:
                continue
            if len({api_nobno[i] for i in members}) >= min_names:
                shared_points += 1
                for i in members:
                    is_shared[i] = 1
        del by_point, api_nobno

        # 강건 중심 재료: cd'(현행 코드)별 자리표시 점이 아닌 api 행 좌표.
        # 같은 cd' 로 모이는 원 코드(별칭)가 여럿일 수 있으므로 cd' 기준으로 모은다.
        by_cd: dict[str, tuple[array, array]] = {}
        for i in api_rows:
            if is_ph[i]:
                continue
            cd = codes[code_of[i]]
            if cd is None:
                continue
            vals = by_cd.get(cd)
            if vals is None:
                vals = by_cd[cd] = (array("d"), array("d"))
            vals[0].append(lat[i])
            vals[1].append(lon[i])
        del api_rows

        min_rows = engine.AREA_ROBUST_MIN_ROWS
        ref_by_cd: dict[str, Optional[tuple[float, float]]] = {}

        def _ref(cd: Optional[str]) -> Optional[tuple[float, float]]:
            """강건 중심: api 행 ≥ min_rows 면 위·경도 중앙값(짝수면 가운데 둘 평균),
            아니면 store.centroid(cd), 그것도 없으면 None."""
            if cd is None:
                return None
            if cd in ref_by_cd:
                return ref_by_cd[cd]
            vals = by_cd.get(cd)
            if vals is not None and len(vals[0]) >= min_rows:
                r = (statistics.median(vals[0]), statistics.median(vals[1]))
            else:
                c = store.centroid(cd)
                r = (
                    (float(c["lat"]), float(c["lon"]))
                    if c and c.get("lat") is not None and c.get("lon") is not None
                    else None
                )
            ref_by_cd[cd] = r
            return r

        suspect_km = engine.AREA_SUSPECT_MAX_KM
        cls_arr = bytearray(n_rows)
        for i in range(n_rows):
            c = cs[i]
            if not has_coord[i]:
                k = _C_NOCOORD
            elif c == _CS_API:
                if is_ph[i]:
                    k = _C_PH
                else:
                    r = _ref(codes[code_of[i]])
                    if r is None:
                        k = _C_NOREF
                    elif haversine_km(lat[i], lon[i], r[0], r[1]) > suspect_km:
                        k = _C_FAR
                    elif is_shared[i]:
                        k = _C_SHARED
                    else:
                        k = _C_REAL
            elif c == _CS_GEO:
                # 번지(건물번호) 없는 주소는 동·구 중심에 지오코딩된 근사 좌표다.
                k = _C_REAL if geo_bno[i] else _C_GEOAPPROX
            else:
                k = _C_CENTROID
            cls_arr[i] = k

        # -- 영역 메타 ------------------------------------------------------------
        for cd in member_codes:
            _ref(cd)
        ambiguous = engine.AREA_AMBIGUOUS_LABELS
        areas: list[dict] = []
        for a, key in enumerate(area_keys):
            members = area_members[a]
            group = area_group[a]
            refs = [r for r in (_ref(m) for m in members) if r is not None]
            meta = {
                "key": key, "nameable": False, "ref_points": refs,
                "sigungu_cd": None, "sigungu_nm": None, "sido_nm": None,
                "label": None, "display_label": None, "scope_codes": list(members),
            }
            named = next((m for m in members if store.centroid(m)), None)
            if named is not None:
                nm = store.centroid(named).get("nm")
                label = group["label"] if group else nm
                if label:
                    sido_nm = region.sido_label(named[:2])
                    meta.update({
                        "nameable": True,
                        "sigungu_cd": named,
                        "sigungu_nm": nm,
                        "sido_nm": sido_nm,
                        "label": label,
                        "display_label": (
                            f"{sido_nm} {label}" if (label in ambiguous and sido_nm) else label
                        ),
                    })
            areas.append(meta)
        self._areas = areas

        # -- 3단계: 배열 ----------------------------------------------------------
        class_counts: dict[str, dict[str, int]] = {s: {} for s in SOURCES}
        real_rows: dict[int, list[int]] = {k: [] for k in range(len(SOURCES))}
        ev_rows: list[int] = []
        for i in range(n_rows):
            k = cls_arr[i]
            sname = SOURCES[src[i]]
            cname = _CLASS_NAMES[k]
            cc = class_counts[sname]
            cc[cname] = cc.get(cname, 0) + 1
            if k == _C_REAL:
                real_rows[src[i]].append(i)
                if cs[i] == _CS_API:
                    ev_rows.append(i)  # 증거 = real 등급 api 행(geocoded 제외)
            else:
                self._nonreal[ids[i]] = cname
                a = code_area[code_of[i]]
                if not areas[a]["nameable"]:
                    continue  # 이름을 붙일 수 없는 영역 — 묶음에서 뺀다(실 DB 0건)
                b = self._approx[sname].get(a)
                if b is None:
                    b = self._approx[sname][a] = _Bucket()
                b.count += 1
                b.names.append(names[i])
                b.addrs.append(addrs[i])
        for sname in SOURCES:
            self._approx_targets[sname] = frozenset(self._approx[sname])

        for sc, rows in real_rows.items():
            cols, order = _build_cols(rows, lat, lon)
            self._real[SOURCES[sc]] = _RealSet(
                cols,
                array("q", (rowids[i] for i in order)),
                [ids[i] for i in order],
                [names[i] for i in order],
                [addrs[i] for i in order],
            )
        ev_cols, ev_order = _build_cols(ev_rows, lat, lon)
        self._ev_cols = ev_cols
        self._ev_area = array("H", (code_area[code_of[i]] for i in ev_order))

        self._stats = {
            "rows": n_rows,
            "classes": class_counts,
            "placeholder_points": placeholder_points,
            "placeholder_rows": sum(c.get("placeholder", 0) for c in class_counts.values()),
            "shared_points": shared_points,
            "shared_rows": sum(c.get("shared_point", 0) for c in class_counts.values()),
            "areas": len(areas),
            "build_ms": round((time.perf_counter() - t0) * 1000, 1),
        }
        return self

    # ------------------------------------------------------------------ query
    def real_hits(
        self, source: str, bounds: Sequence[float], tokens: Iterable[str] = (),
        limit: Optional[int] = None,
    ) -> tuple[int, list[int]]:
        """범위 안 real 행 (total, rowid 목록 — 지도 가운데에서 가까운 순, 같으면 id 순).

        bounds = (min_lat, min_lon, max_lat, max_lon), 양 끝 포함. limit=None 이면 전부."""
        rs = self._real.get(source)
        if rs is None:
            return 0, []
        min_lat, min_lon, max_lat, max_lon = bounds
        match = _matcher(list(tokens))
        cols = rs.cols
        lonv = cols.lon
        names, addrs = rs.names, rs.addrs
        hits: list[int] = []
        for lo, hi, interior in cols.ranges(min_lat, min_lon, max_lat, max_lon):
            if match is None:
                if interior:
                    hits.extend(range(lo, hi))
                else:
                    hits.extend([i for i in range(lo, hi) if min_lon <= lonv[i] <= max_lon])
            elif interior:
                hits.extend([i for i in range(lo, hi) if match(names[i], addrs[i])])
            else:
                hits.extend([
                    i for i in range(lo, hi)
                    if min_lon <= lonv[i] <= max_lon and match(names[i], addrs[i])
                ])
        total = len(hits)
        if not total or (limit is not None and limit <= 0):
            return total, []

        # 정렬 키 = (d2, id). d2 는 위도 보정 평면 거리 제곱 — 웹 목과 같은 식·같은 순서.
        clat = (min_lat + max_lat) / 2
        clon = (min_lon + max_lon) / 2
        k = math.cos(clat * (math.pi / 180))
        latv = cols.lat
        d2s = [
            (latv[i] - clat) * (latv[i] - clat)
            + ((lonv[i] - clon) * k) * ((lonv[i] - clon) * k)
            for i in hits
        ]
        ids = rs.ids
        if limit is not None and total > limit:
            thr = heapq.nsmallest(limit, d2s)[-1]
            cand = [(d, ids[i], i) for d, i in zip(d2s, hits) if d <= thr]
        else:
            cand = [(d, ids[i], i) for d, i in zip(d2s, hits)]
        cand.sort()
        if limit is not None:
            cand = cand[:limit]
        rowid = rs.rowid
        return total, [rowid[i] for _, _, i in cand]

    def unlocated(
        self, source: str, bounds: Sequence[float], tokens: Iterable[str] = (),
    ) -> list[dict]:
        """위치 미상 묶음 — 후보 영역(A 강건 중심 ∨ B 서로 다른 증거 좌표 2곳)의
        approx 행 수(영역 전체 수). count 0 은 뺀다. count 내림차순, sigungu_cd 오름차순."""
        buckets = self._approx.get(source)
        if not buckets:
            return []
        targets = self._approx_targets[source]
        min_lat, min_lon, max_lat, max_lon = bounds
        areas = self._areas

        center: set[int] = set()
        for a in targets:
            for rl, ro in areas[a]["ref_points"]:
                if min_lat <= rl <= max_lat and min_lon <= ro <= max_lon:
                    center.add(a)
                    break

        need = engine.AREA_EVIDENCE_MIN_POINTS
        evidence: set[int] = set()
        seen: dict[int, set] = {}
        ev_area = self._ev_area
        latv, lonv = self._ev_cols.lat, self._ev_cols.lon
        for lo, hi, interior in self._ev_cols.ranges(min_lat, min_lon, max_lat, max_lon):
            for i in range(lo, hi):
                a = ev_area[i]
                if a not in targets or a in evidence:
                    continue
                x = lonv[i]
                if not interior and not (min_lon <= x <= max_lon):
                    continue
                pts = seen.get(a)
                if pts is None:
                    seen[a] = {(latv[i], x)}
                else:
                    pts.add((latv[i], x))
                    if len(pts) >= need:
                        evidence.add(a)
            if len(evidence) == len(targets):
                break

        match = _matcher(list(tokens))
        out: list[dict] = []
        for a in center | evidence:
            b = buckets[a]
            if match is None:
                count = b.count
            else:
                count = sum(1 for n, ad in zip(b.names, b.addrs) if match(n, ad))
            if count <= 0:
                continue
            m = areas[a]
            out.append({
                "sigungu_cd": m["sigungu_cd"],
                "sigungu_nm": m["sigungu_nm"],
                "sido_nm": m["sido_nm"],
                "label": m["label"],
                "display_label": m["display_label"],
                "scope_codes": list(m["scope_codes"]),
                "count": count,
                "included_by": sorted(
                    (["center"] if a in center else []) + (["evidence"] if a in evidence else [])
                ),
            })
        out.sort(key=lambda e: (-e["count"], e["sigungu_cd"]))
        return out

    # ------------------------------------------------------------- reporting
    def coord_class(self, fac_id: str) -> Optional[str]:
        """시설 id 의 좌표 등급. 모르는 id 면 None(테스트·보고용 — O(n) 탐색 포함)."""
        c = self._nonreal.get(fac_id)
        if c is not None:
            return c
        for rs in self._real.values():
            if fac_id in rs.ids:
                return REAL
        return None

    def is_nonreal(self, fac_id: str) -> bool:
        """직렬화 직전 재확인용 O(1) — 비real 등급으로 분류된 id 인가."""
        return fac_id in self._nonreal

    def stats(self) -> dict:
        return dict(self._stats)
