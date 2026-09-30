"""GET /api/facilities/in-bounds — 지도 범위 검색("이 지역에서 다시 찾기").

정직성(SPEC §0 · P-1): 범위 판정에는 **좌표 등급 real** 행만 쓴다. 시군구 중심점·자리표시 점·
먼 행·번지 없는 geocoded 는 점으로 찍지 않고 시군구 전체 수(unlocated)로 따로 알린다.

안전(계약 §1):
- 실 DB(data/sponavi.db)는 동결본이다. 이 파일은 실 DB 를 **immutable 읽기 전용**으로만 연다
  (`ro_db_store`, 경로 = SPONAVI_RO_DB 또는 data/sponavi.db) — `mode=ro` 만으로도 WAL DB 에
  -wal/-shm 이 생기므로 immutable=1 이 필수다. 실 DB 로는 engine 을 직접 호출한다.
- `_guard_get_store`(autouse)가 `app.main.get_store` 를 "패치 안 됨 → AssertionError" 로
  바꾼다. HTTP 테스트는 반드시 area_store 계열 픽스처(astore/xstore/rstore)로 바꿔 끼운다.
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

import pytest

import app.main as main_mod
from app import engine, region
from app import store as store_mod
from app.area_index import AreaIndex

REPO = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO / "web" / "src" / "mocks" / "contract" / "area_search.json"
URL = "/api/facilities/in-bounds"

A = {"min_lat": 37.595, "min_lon": 127.005, "max_lat": 37.612, "max_lon": 127.045}
A_T = (A["min_lat"], A["min_lon"], A["max_lat"], A["max_lon"])


@pytest.fixture(scope="module")
def contract() -> dict:
    if not CONTRACT_PATH.exists():  # 웹 트리 없이 서버만 체크아웃한 경우
        pytest.skip(f"계약 JSON 없음: {CONTRACT_PATH}")
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 픽스처 — 실 DB 무접촉 가드 · 계약 dataset store · 실 DB immutable 읽기
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _guard_get_store(monkeypatch):
    def _unpatched():
        raise AssertionError(
            "app.main.get_store 가 패치되지 않았다 — area_store 계열 픽스처를 써야 한다"
            "(실 DB 를 RW 로 여는 경로 차단)"
        )

    monkeypatch.setattr(main_mod, "get_store", _unpatched)


def _insert_facilities(s: store_mod.Store, rows: list[dict]) -> None:
    for f in rows:
        cd = f["sigungu_cd"]
        s.conn.execute(
            "INSERT INTO facilities (id, source, name, sido_cd, sigungu_cd, sigungu_nm, addr, "
            "lat, lon, coord_source, sports, disability_support, phone) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f["id"], f["source"], f["name"], cd[:2], cd, f.get("sigungu_nm"), f.get("addr"),
                f["lat"], f["lon"], f["coord_source"], ",".join(f.get("sports") or []),
                f.get("disability_support"), f.get("phone"),
            ),
        )
    s.conn.commit()


def _make_store(contract: dict, dataset: str | None = None) -> store_mod.Store:
    """fixtures in-memory store + 계약 dataset(행: sido_cd=cd[:2]·sports ''·disability NULL,
    중심점: s._sigungu). 끝에 invalidate_area_index()."""
    s = store_mod.build_store()
    if dataset:
        ds = contract["datasets"][dataset]
        for c in ds["extra_sigungu"]:
            s._sigungu[c["cd"]] = {"cd": c["cd"], "nm": c["nm"], "lat": c["lat"], "lon": c["lon"]}
        _insert_facilities(s, ds["extra_facilities"])
    s.invalidate_area_index()
    return s


@pytest.fixture()
def area_store(monkeypatch, contract):
    """팩토리: area_store(dataset=None) → 그 store 로 get_store 를 바꿔 끼운다."""

    def factory(dataset: str | None = None) -> store_mod.Store:
        s = _make_store(contract, dataset)
        monkeypatch.setattr(main_mod, "get_store", lambda: s)
        return s

    return factory


@pytest.fixture()
def astore(area_store):
    return area_store(None)


@pytest.fixture()
def xstore(area_store):
    return area_store("x")


@pytest.fixture()
def rstore(area_store):
    return area_store("robust")


@pytest.fixture()
def sstore(area_store):
    return area_store("shared")


def open_ro_db_store() -> store_mod.Store | None:
    """실 DB 를 immutable 읽기 전용으로 연 Store. 없거나 전국 적재본이 아니면 None.
    SPONAVI_DB 와 분리된 SPONAVI_RO_DB 만 본다(없으면 data/sponavi.db)."""
    path = Path(os.environ.get("SPONAVI_RO_DB") or (store_mod.data_dir() / "sponavi.db"))
    if not path.exists():
        return None
    # 앱과 같은 공유 커넥션 설정(문장 캐시 없음) — 스레드 경합 테스트도 이 경로를 쓴다.
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
def ro_db_store():
    s = open_ro_db_store()
    if s is None:
        pytest.skip("실 DB 없음(또는 전국 적재본 아님) — SPONAVI_RO_DB 로 경로 지정")
    yield s
    s.conn.close()


def _get(client, **params):
    return client.get(URL, params=params)


def _ids(body: dict) -> list[str]:
    return [f["id"] for f in body["facilities"]]


def _unl(body: dict) -> list[list]:
    return [
        [a["sigungu_cd"], a["label"], a["display_label"], a["count"]]
        for a in body["unlocated"]["areas"]
    ]


def _err(r) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


def _engine(s, bounds, program="svoucher", q=None, limit=50, age=None) -> dict:
    return engine.area_search(
        s, min_lat=bounds[0], min_lon=bounds[1], max_lat=bounds[2], max_lon=bounds[3],
        program=program, q=q, limit=limit, age=age,
    )


def _d2_order(rows: list[dict], bounds) -> list[str]:
    """계약 §3.4-4 정렬을 테스트 쪽에서 독립 구현 — (d2, id)."""
    clat = (bounds[0] + bounds[2]) / 2
    clon = (bounds[1] + bounds[3]) / 2
    k = math.cos(clat * (math.pi / 180))
    return [
        r["id"] for r in sorted(
            rows,
            key=lambda r: ((r["lat"] - clat) ** 2 + ((r["lon"] - clon) * k) ** 2, r["id"]),
        )
    ]


# ---------------------------------------------------------------------------
# 검증과 에러 (V1~V5)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("missing", ["min_lat", "min_lon", "max_lat", "max_lon"])
def test_v1_missing_coordinate_422(client, astore, missing):
    params = {k: v for k, v in A.items() if k != missing}
    assert _err(_get(client, **params)) == (422, "INVALID_REQUEST")


@pytest.mark.parametrize("override", [
    {"max_lat": 91},
    {"min_lon": -181},
    {"min_lat": "nan"},
    {"max_lon": "inf"},
    {"min_lat": "-inf"},
    {"max_lat": A["min_lat"]},                       # min == max
    {"min_lat": A["max_lat"], "max_lat": A["min_lat"]},  # min > max
    {"min_lon": A["max_lon"], "max_lon": A["min_lon"]},
])
def test_v2_invalid_numbers_and_order_422(client, astore, override):
    r = _get(client, **{**A, **override})
    assert _err(r) == (422, "INVALID_REQUEST")


def test_v2_bounds_message(client, astore):
    r = _get(client, **{**A, "min_lat": A["max_lat"], "max_lat": A["min_lat"]})
    assert r.json()["error"]["message"] == (
        "입력값 오류(bounds): min_lat<max_lat, min_lon<max_lon 이어야 합니다."
    )


def test_v2_isfinite_guard_in_engine():
    # ge/le 를 우회한 직접 호출도 math.isfinite 로 막힌다.
    for bad in (float("nan"), float("inf"), -float("inf")):
        assert engine.area_bounds_problem(bad, 127.0, 37.6, 127.1)[0] == "INVALID_REQUEST"
        assert engine.area_bounds_problem(37.5, 127.0, 37.6, bad)[0] == "INVALID_REQUEST"


def test_v3_outside_korea(client, astore):
    r = _get(client, min_lat=35.0, min_lon=140.0, max_lat=35.1, max_lon=140.1)
    assert _err(r) == (422, "AREA_OUT_OF_RANGE")
    assert r.json()["error"]["message"] == "대한민국 밖의 범위예요. 국내 지역에서만 찾을 수 있어요."
    # 일부만 겹치면 통과(범위를 자르지 않는다) — 대각선 약 11.9km
    r = _get(client, min_lat=39.55, min_lon=125.0, max_lat=39.65, max_lon=125.05)
    assert r.status_code == 200
    assert r.json()["bounds"]["max_lat"] == 39.65
    assert abs(r.json()["diag_km"] - 11.9) < 0.05
    # 국외이면서 너무 넓으면 OUT_OF_RANGE 가 먼저
    r = _get(client, min_lat=35.0, min_lon=140.0, max_lat=35.5, max_lon=140.5)
    assert _err(r) == (422, "AREA_OUT_OF_RANGE")


def test_v4_diag_boundary(client, astore):
    ok = _get(client, min_lat=37.5, min_lon=127.0, max_lat=37.6798, max_lon=127.0001, program="public")
    assert ok.status_code == 200
    assert ok.json()["diag_km"] == 20.0 and ok.json()["max_diag_km"] == 20
    bad = _get(client, min_lat=37.5, min_lon=127.0, max_lat=37.68, max_lon=127.0001, program="public")
    assert _err(bad) == (422, "AREA_TOO_WIDE")
    msg = bad.json()["error"]["message"]
    assert "km" in msg and "20.0km" in msg and "최대 20km" in msg
    # 정확히 20 은 허용(> 20 만 거부)
    assert engine.AREA_MAX_DIAG_KM == 20.0


@pytest.mark.parametrize("min_lon,max_lon", [(-180, 180), (-179.95, 180), (-100, 130)])
def test_v4_lon_span_over_180_is_too_wide(client, astore, min_lon, max_lon):
    # haversine 은 반대편 짧은 길로 잰다 — −180~180 이면 sin²(Δλ/2)≈0 이라 대각선이 위도 차(11.1km)만 남아
    # "20km 이내"로 통과했고, 가운데(lon 0, 아프리카)에서 가까운 순으로 한반도 서쪽 끝 시설이 나왔다.
    assert max_lon - min_lon > engine.AREA_MAX_LON_SPAN_DEG
    prob = engine.area_bounds_problem(37.5, min_lon, 37.6, max_lon)
    assert prob is not None and prob[0] == "AREA_TOO_WIDE"
    # 메시지의 대각선은 서→동 긴 길 그대로 잰 값이다(위도 차 11.1km 같은 거짓 숫자가 아니다)
    m = re.search(r"대각선 약 ([0-9.]+)km", prob[1])
    assert m and float(m.group(1)) > 1000, prob[1]
    assert engine.area_diag_km(37.5, min_lon, 37.6, max_lon) > 1000
    r = _get(client, min_lat=37.5, min_lon=min_lon, max_lat=37.6, max_lon=max_lon, program="public")
    assert _err(r) == (422, "AREA_TOO_WIDE"), r.text


def test_v4_lon_span_within_180_uses_haversine():
    # 폭 180° 이하는 그대로 haversine(응답 diag_km 도 같은 함수) — 기존 경계 값이 바뀌지 않는다.
    b = (37.5, 127.0, 37.6798, 127.0001)
    assert engine.area_diag_km(*b) == store_mod.haversine_km(*b)
    assert engine.area_bounds_problem(*b) is None
    # 정확히 180° 는 긴 길 분기로 가지 않지만, 반대편을 지나는 haversine 이라 어차피 넓다
    assert engine.area_bounds_problem(37.5, 0.0, 37.6, 180.0)[0] == "AREA_TOO_WIDE"


def test_v5_program_limit_q(client, astore):
    assert _err(_get(client, **A, program="gym")) == (422, "INVALID_REQUEST")
    assert _err(_get(client, **A, limit=0)) == (422, "INVALID_REQUEST")
    r = _get(client, **A, program="public", limit=999)
    assert r.status_code == 200 and len(r.json()["facilities"]) == 3
    for q in ("   ", "　", "가" * 31):
        r = _get(client, **A, q=q)
        assert _err(r) == (422, "INVALID_REQUEST"), q
        assert r.json()["error"]["message"] == "입력값 오류(q): 검색어는 1~30자로 입력해 주세요."
    assert _get(client, **A, q="가" * 30).status_code == 200
    # q 파라미터가 없으면 키워드 조건이 없다
    body = _get(client, **A, program="public").json()
    assert body["q"] is None and body["tokens"] == []
    assert _err(_get(client, **A, age=121)) == (422, "INVALID_REQUEST")


# ---------------------------------------------------------------------------
# 정직성 (H1~H10)
# ---------------------------------------------------------------------------
def test_h1_centroid_rows_never_plotted(client, xstore):
    # V01~V04 좌표를 모두 덮는 범위 — 좌표가 범위 안이어도 centroid 는 나오지 않는다
    b = {"min_lat": 37.59, "min_lon": 127.0, "max_lat": 37.62, "max_lon": 127.04}
    idx = xstore.area_index()
    for program in ("svoucher", "dvoucher", "public"):
        body = _get(client, **b, program=program).json()
        ids = _ids(body)
        assert not {"V01", "V02", "V03", "V04"} & set(ids)
        for f in body["facilities"]:
            assert f["coord_source"] in ("api", "geocoded")
            assert idx.coord_class(f["id"]) == "real"


def test_h2_geocoded_with_building_no_is_plotted(client, xstore):
    body = _get(client, **A).json()
    assert _ids(body) == ["X02"]
    assert body["facilities"][0]["coord_source"] == "geocoded"


def test_h3_geocoded_without_building_no_is_approx(client, xstore):
    body = _get(client, **A).json()
    assert "X01" not in _ids(body)
    assert _unl(body) == [["11290", "성북구", "성북구", 5]]  # V01~V04 + X01
    body = _get(client, **A, q="검도").json()
    assert _ids(body) == [] and _unl(body) == [["11290", "성북구", "성북구", 1]]


def test_h4_placeholder_rows_counted_only_in_own_candidate_area(client, xstore):
    body = _get(client, **A, program="public").json()
    assert not {"X03", "X04", "X05"} & set(_ids(body))
    # 11290 만 후보 영역 → X03(자리표시) + X06(먼 행) = 2. X04(강북)·X05(용산)는 안 세진다.
    assert _unl(body) == [["11290", "성북구", "성북구", 2]]
    # 강북이 후보가 되는 범위에서는 강북의 X04 만 강북 수에 들어간다
    b = {"min_lat": 37.615, "min_lon": 126.995, "max_lat": 37.625, "max_lon": 127.005}
    assert _unl(_get(client, **b, program="public").json()) == [["11305", "강북구", "강북구", 1]]


def test_h5_far_row_not_plotted_even_if_coords_look_real(client, xstore):
    b = {"min_lat": 35.175, "min_lon": 129.07, "max_lat": 35.185, "max_lon": 129.08}
    body = _get(client, **b, program="public").json()
    assert "X06" not in _ids(body) and body["total"] == 0
    assert xstore.area_index().coord_class("X06") == "far"


def test_h6_evidence_counts_distinct_points(client, xstore):
    one = {"min_lat": 37.6195, "min_lon": 126.9995, "max_lat": 37.6205, "max_lon": 127.0005}
    two = {"min_lat": 37.615, "min_lon": 126.995, "max_lat": 37.625, "max_lon": 127.005}
    # X07·X08 는 같은 좌표 → 증거 1곳 → 강북 불포함
    assert _unl(_get(client, **one, program="dvoucher").json()) == []
    # X09 가 더해지면 서로 다른 좌표 2곳 → 포함(D01 = 1)
    body = _get(client, **two, program="dvoucher").json()
    assert _unl(body) == [["11305", "강북구", "강북구", 1]]
    assert body["unlocated"]["areas"][0]["included_by"] == ["evidence"]


def test_h7_rule_a_uses_robust_center(client, rstore):
    cen = {"min_lat": 37.635, "min_lon": 127.02, "max_lat": 37.645, "max_lon": 127.03}
    med = {"min_lat": 37.6203, "min_lon": 127.0003, "max_lat": 37.6205, "max_lon": 127.0005}
    # DB 중심점(시드 37.6398,127.0256)을 덮어도 강건 중심이 아니면 A 불성립
    assert _unl(_get(client, **cen, program="dvoucher").json()) == []
    body = _get(client, **med, program="dvoucher").json()
    assert _unl(body) == [["11305", "강북구", "강북구", 1]]
    assert body["unlocated"]["areas"][0]["included_by"] == ["center"]
    body = _get(client, **med, program="public").json()
    assert _ids(body) == ["R03"] and _unl(body) == []


def test_h8_sigungu_group_merged(client, xstore):
    b = {"min_lat": 37.54, "min_lon": 126.67, "max_lat": 37.55, "max_lon": 126.68}
    body = _get(client, **b).json()
    assert len(body["unlocated"]["areas"]) == 1
    area = body["unlocated"]["areas"][0]
    assert area["label"] == "서해구·검단구 일대(옛 서구)"
    assert area["display_label"] == area["label"]
    assert area["scope_codes"] == ["28260", "28275", "28290"]
    assert area["count"] == 4 and area["sigungu_cd"] == "28260"
    assert area["sigungu_nm"] == "서구" and area["sido_nm"] == "인천광역시"
    assert body["unlocated"]["total"] == 4
    # 그 sigungu_cd 로 주소 검색에 바로 쓸 수 있다
    r = client.get("/api/facilities/search", params={"sigungu_cd": area["sigungu_cd"], "q": "인천"})
    assert r.status_code == 200
    assert {f["id"] for f in r.json()["facilities"]} == {"X10", "X11", "X12", "X13"}


def test_h9_display_label_for_ambiguous_names(client, xstore):
    b = {"min_lat": 35.865, "min_lon": 128.55, "max_lat": 35.875, "max_lon": 128.565}
    area = _get(client, **b).json()["unlocated"]["areas"][0]
    assert (area["sigungu_cd"], area["label"], area["display_label"]) == (
        "27170", "서구", "대구광역시 서구"
    )


def test_h10_q_narrows_unlocated(client, astore):
    assert _unl(_get(client, **A).json()) == [["11290", "성북구", "성북구", 4]]
    body = _get(client, **A, q="수영").json()
    assert _unl(body) == [["11290", "성북구", "성북구", 1]]  # 돈암수영아카데미
    assert body["unlocated"]["total"] == 1
    assert _get(client, **A, q="없는검색어").json()["unlocated"]["areas"] == []


def test_h11_shared_point_api_rows_are_approx(client, sstore):
    """번지 없는 api 행이 다른 이름의 번지 없는 행과 좌표를 똑같이 함께 쓰면 근사(shared_point)다.
    실 DB: '대전광역시 동구' 한 줄 주소 88행이 한 점에 real 로 찍혀 '같은 자리 50곳' 마커가 됐다."""
    idx = sstore.area_index()
    for fid in ("S01", "S02", "S03"):  # '서울특별시 강북구' — 이름 셋이 한 점
        assert idx.coord_class(fid) == "shared_point", fid
    # 같은 시설 중복 행(이름 키가 같다 — 공백만 다름)은 real, 혼자 있는 점(약수터)도 real
    assert idx.coord_class("S04") == "real" and idx.coord_class("S05") == "real"
    assert idx.coord_class("S06") == "real"
    # api 주소는 번지가 붙어 적힌다('삼양로10') — api 정규식으로는 번지가 있다(geocoded 식이면 없다)
    assert idx.coord_class("S07") == "real" and idx.coord_class("S08") == "real"
    assert engine.AREA_API_BNO_RE.search("서울특별시 강북구 삼양로10(미아동)")
    assert not engine.AREA_GEOCODED_BNO_RE.search("서울특별시 강북구 삼양로10(미아동)")
    b = {"min_lat": 37.62, "min_lon": 127.005, "max_lat": 37.645, "max_lon": 127.035}
    body = _get(client, **b, program="public").json()
    assert not {"S01", "S02", "S03"} & set(_ids(body))
    assert _ids(body) == ["S04", "S05", "S07", "S08", "S06"]
    assert _unl(body) == [["11305", "강북구", "강북구", 3]]
    st = idx.stats()
    assert st["shared_points"] == 1 and st["shared_rows"] == 3
    assert st["classes"]["public"]["shared_point"] == 3


def test_h11_api_building_no_regex_examples():
    rx = engine.AREA_API_BNO_RE
    for addr in ("양덕동477", "조원동775-1", "성남동3110번지", "의정부시 체육로90", "문학동482번지외",
                 "죽전동 1003-235번지일원", "화성시 진안동 588일원", "산본로276,1층(금정동)",
                 "연수구 컨벤시아대로 81. 지하1층 (송도동)", "서울 성북구 종암로 25", "고척2동산9-14"):
        assert rx.search(addr), addr
    for addr in ("대전광역시 동구", "서울 성북구 장위3동", "경기도 양평군 용문면 다문1리", "서울 성북구 동소문동7가",
                 "전남광주통합특별시 순천시 중앙로", "부안읍", "", "지하1층"):
        assert not rx.search(addr), addr


def _shared_evidence_store(with_numbers: bool) -> store_mod.Store:
    s = store_mod.build_store()
    addr = (lambda i: f"서울특별시 강북구 도봉로 {i}") if with_numbers else (lambda i: "서울특별시 강북구")
    rows = [
        {"id": f"E0{i}", "source": "public", "coord_source": "api", "sigungu_cd": "11305",
         "sigungu_nm": "강북구", "name": f"강북시설{i}", "addr": addr(i), "lat": 37.61, "lon": 127.0}
        for i in (1, 2, 3)
    ]
    rows.append({"id": "E04", "source": "public", "coord_source": "api", "sigungu_cd": "11305",
                 "sigungu_nm": "강북구", "name": "강북외딴약수터", "addr": "서울특별시 강북구 번동",
                 "lat": 37.612, "lon": 127.002})
    _insert_facilities(s, rows)
    s.invalidate_area_index()
    return s


def test_h11_shared_point_rows_are_not_evidence():
    # 한 점 공유 행은 증거(규칙 B)가 아니다 — 남는 증거는 외딴 1곳뿐이라 강북은 후보가 아니다.
    b = (37.605, 126.995, 37.615, 127.005)
    s = _shared_evidence_store(with_numbers=False)
    assert s.area_index().coord_class("E01") == "shared_point"
    body = _engine(s, b, "dvoucher")
    assert _unl(body) == []
    # 같은 배치에 번지가 있으면(real) 증거가 서로 다른 좌표 2곳 → 강북 포함(D01 = 1)
    s2 = _shared_evidence_store(with_numbers=True)
    assert s2.area_index().coord_class("E01") == "real"
    assert _unl(_engine(s2, b, "dvoucher")) == [["11305", "강북구", "강북구", 1]]


# ---------------------------------------------------------------------------
# 정렬과 잘림 (O1·O2)
# ---------------------------------------------------------------------------
def test_o1_center_distance_then_id(client, astore, xstore):
    body = _get(client, **A, program="public").json()
    assert _ids(body) == ["P02", "P03", "P01"]
    assert body["order"] == "center_distance"
    one = {"min_lat": 37.6195, "min_lon": 126.9995, "max_lat": 37.6205, "max_lon": 127.0005}
    assert _ids(_get(client, **one, program="public").json()) == ["X07", "X08"]


def test_o2_limit_and_truncation(client, astore):
    # 성북에 real 등급 이용권 행(번지 있는 geocoded) 55개 — 서버 상한 50 으로 잘린다
    rows = [
        {"id": f"O{i:02d}", "source": "voucher", "coord_source": "geocoded", "sigungu_cd": "11290",
         "sigungu_nm": "성북구", "name": f"오투태권도{i}", "addr": f"서울 성북구 보문로 {i + 1}",
         "lat": 37.598 + (i % 11) * 0.0011, "lon": 127.008 + (i // 11) * 0.0071}
        for i in range(55)
    ]
    _insert_facilities(astore, rows)
    astore.invalidate_area_index()
    body = _get(client, **A, limit=999).json()
    assert body["total"] == 55 and len(body["facilities"]) == 50 and body["truncated"] is True
    expect = _d2_order(rows, A_T)
    assert _ids(body) == expect[:50]
    body = _get(client, **A, limit=2).json()
    assert _ids(body) == expect[:2] and body["total"] == 55 and body["truncated"] is True
    body = _get(client, **A).json()  # 기본 limit 50
    assert len(body["facilities"]) == 50 and body["truncated"] is True


# ---------------------------------------------------------------------------
# program 과 q (P1·P2)
# ---------------------------------------------------------------------------
_P_ROWS = [
    {"id": "D10", "source": "dvoucher", "coord_source": "geocoded", "sigungu_cd": "11290",
     "sigungu_nm": "성북구", "name": "성북장애인수영교실", "addr": "서울 성북구 종암로 30",
     "lat": 37.6, "lon": 127.03, "disability_support": 1},
    {"id": "PN1", "source": "public", "coord_source": "api", "sigungu_cd": "11290",
     "sigungu_nm": "성북구", "name": "미상체육관", "addr": "서울 성북구 아리랑로 10",
     "lat": 37.601, "lon": 127.02, "disability_support": None},
]


def test_p1_program_filter(client, xstore):
    _insert_facilities(xstore, _P_ROWS)
    xstore.invalidate_area_index()
    sv = _get(client, **A, program="svoucher").json()
    assert _ids(sv) == ["X02"] and all(f["source"] == "voucher" for f in sv["facilities"])
    dv = _get(client, **A, program="dvoucher").json()
    assert _ids(dv) == ["D10"] and dv["facilities"][0]["source"] == "dvoucher"
    pub = _get(client, **A, program="public").json()
    assert set(_ids(pub)) == {"P01", "P02", "P03", "PN1"}
    assert all("source" not in f and f["type"] == "공공체육시설" for f in pub["facilities"])
    assert pub["program"] == "public" and sv["program"] == "svoucher"


# 성북 토큰 행 — LIKE 대조(P2). real 등급(번지 있는 geocoded·api)과 approx 가 섞여 있다.
_LIKE_ROWS = [
    ("L01", "voucher", "구암태권도장", "서울특별시 성북구 구암로32길 6-16", "geocoded", 37.590, 127.010),
    ("L02", "voucher", "무태검도관", "서울 성북구 조야동 52번지", "geocoded", 37.591, 127.011),
    ("L03", "voucher", "100% 필라테스", "서울특별시 성북구 보문로 1", "geocoded", 37.592, 127.012),
    ("L04", "voucher", "A_bly PT센터", "서울특별시 성북구 보문로 3", "geocoded", 37.593, 127.013),
    ("L05", "voucher", "AxbLY 짐", "서울특별시 성북구 보문로 5", "geocoded", 37.594, 127.014),
    ("L06", "voucher", "AXBLY 스튜디오", "서울 성북구 구암로", "geocoded", 37.595, 127.015),
    ("L07", "voucher", "구암 태권도", "서울 성북구 구암로 7", "centroid", 37.5894, 127.0167),
    ("L08", "voucher", "100%짐", "서울 성북구 보문로 9", "centroid", 37.5894, 127.0167),
    ("L09", "voucher", "구암태권도 멀리", "서울 성북구 구암로 99", "geocoded", 37.65, 127.10),
    ("L10", "voucher", "백슬래시\\짐", "서울 성북구 보문로 11", "geocoded", 37.596, 127.016),
    ("L11", "public", "구암 생활체육공원", "서울특별시 성북구 구암로 240 (구암동)", "api", 37.60, 127.02),
    ("L12", "public", "A_BLY 체육관", "서울 성북구 보문로 13", "api", 37.61, 127.03),
    ("L13", "public", "axbly 센터", "서울 성북구 보문로 15", "centroid", 37.5894, 127.0167),
    ("L14", "public", "PT 100% 공원", "서울 성북구 구암로 17", "api", 37.615, 127.045),
]
_LIKE_TOKENS = [
    ["구암로", "태권도"], ["AXBLY"], ["axbly"], ["A_bly"], ["a_BLY"], ["_"], ["%"], ["100%"],
    ["pt센터"], ["PT"], ["구암"], ["\\"], ["보문로"], ["체육"], ["구암로32길", "6-16"], ["없음"],
]


def test_p2_q_matches_sqlite_like(contract):
    s = store_mod.build_store()
    _insert_facilities(s, [
        {"id": i, "source": src, "name": n, "addr": a, "coord_source": cs, "lat": la, "lon": lo,
         "sigungu_cd": "11290", "sigungu_nm": "성북구"}
        for (i, src, n, a, cs, la, lo) in _LIKE_ROWS
    ])
    s.invalidate_area_index()
    idx = s.area_index()
    b = (37.58, 127.00, 37.62, 127.05)
    assert engine.area_bounds_problem(*b) is None
    for source in ("voucher", "public"):
        for tokens in _LIKE_TOKENS:
            sql_rows = s.search_facilities(source, ["11290"], tokens)
            expect_real = {
                f["id"] for f in sql_rows
                if idx.coord_class(f["id"]) == "real"
                and b[0] <= f["lat"] <= b[2] and b[1] <= f["lon"] <= b[3]
            }
            expect_approx = sum(1 for f in sql_rows if idx.coord_class(f["id"]) != "real")
            total, rowids = idx.real_hits(source, b, tokens, None)
            got_real = {
                r[0] for r in s.conn.execute(
                    f"SELECT id FROM facilities WHERE rowid IN ({','.join('?' * len(rowids))})",
                    rowids,
                )
            } if rowids else set()
            assert total == len(rowids) == len(got_real)
            assert got_real == expect_real, (source, tokens)
            unl = {a["sigungu_cd"]: a["count"] for a in idx.unlocated(source, b, tokens)}
            assert unl.get("11290", 0) == expect_approx, (source, tokens)
    # 대조가 공허하지 않은지(실제로 양쪽 경로를 탔는지)
    assert idx.coord_class("L06") == "geocoded_approx" and idx.coord_class("L01") == "real"
    assert {a["sigungu_cd"] for a in idx.unlocated("voucher", b, [])} == {"11290"}


# ---------------------------------------------------------------------------
# 행 모양과 장애 표기 (S1·S2)
# ---------------------------------------------------------------------------
def test_s1_row_keys_match_search_and_contract(client, xstore, contract):
    sv = _get(client, **A).json()["facilities"]
    pub = _get(client, **A, program="public").json()["facilities"]
    assert sv and pub
    for row in sv:
        assert sorted(row) == contract["row_keys"]["voucher"]
        assert row["subsidy"] is None and row["copay"] is None and row["dist_km"] is None
    for row in pub:
        assert sorted(row) == contract["row_keys"]["public"]
        assert row["dist_km"] is None
    s_sv = engine.search_facilities(xstore, sigungu_cd="11290", q="종암")["facilities"]
    s_pub = engine.search_facilities(xstore, sigungu_cd="11290", q="체육", program="public")["facilities"]
    assert set(s_sv[0]) == set(sv[0]) and set(s_pub[0]) == set(pub[0])
    assert sv[0]["addr"] == "서울 성북구 종암로 25"


def test_s1_fee_month_fallback(client, xstore):
    xstore.conn.execute(
        "INSERT INTO courses (id, facility_id, source, name, sport, fee_month, target) VALUES "
        "('CX1','X02','voucher','유소년 태권도','태권도',90000,'유청소년'),"
        "('CX2','X02','voucher','성인 태권도','태권도',120000,'성인')"
    )
    xstore.conn.commit()

    def fee(**kw):
        return _get(client, **A, **kw).json()["facilities"][0]["fee_month"]

    assert fee(age=10) == 90000
    assert fee(age=30) == 120000
    assert fee(age=70) == 90000  # 맞는 강좌 없음 → 전체 강좌 중 최저(폴백)
    assert fee() == 90000


def test_s2_disability_not_filtered(client, xstore):
    _insert_facilities(xstore, _P_ROWS)
    xstore.invalidate_area_index()
    pub = {f["id"]: f for f in _get(client, **A, program="public").json()["facilities"]}
    assert pub["PN1"]["disability_support"] is None
    assert pub["P02"]["disability_support"] is False and pub["P03"]["disability_support"] is False
    assert pub["P01"]["disability_support"] is True
    dv = _get(client, **A, program="dvoucher").json()["facilities"]
    assert dv and all(f["disability_support"] is True for f in dv)


# ---------------------------------------------------------------------------
# 인덱스 (I1~I3)
# ---------------------------------------------------------------------------
def test_i1_invalidate_picks_up_new_rows(client, astore):
    assert _get(client, **A, program="public").json()["total"] == 3
    _insert_facilities(astore, [{
        "id": "NEW1", "source": "public", "coord_source": "api", "sigungu_cd": "11290",
        "sigungu_nm": "성북구", "name": "새체육관", "addr": "서울 성북구 보문로 7",
        "lat": 37.6035, "lon": 127.025,
    }])
    assert _get(client, **A, program="public").json()["total"] == 3  # 캐시 그대로
    astore.invalidate_area_index()
    body = _get(client, **A, program="public").json()
    assert body["total"] == 4 and _ids(body)[0] == "NEW1"


def test_i2_concurrent_first_build_once(monkeypatch):
    s = store_mod.build_store()
    calls: list[int] = []
    orig = AreaIndex.build.__func__

    def slow_build(cls, store):
        calls.append(1)
        time.sleep(0.05)
        return orig(cls, store)

    monkeypatch.setattr(AreaIndex, "build", classmethod(slow_build))
    barrier = threading.Barrier(4)
    got: list = []

    def worker():
        barrier.wait()
        got.append(s.area_index())

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1
    assert len(got) == 4 and all(g is got[0] for g in got)


def _concurrency_store(s: store_mod.Store) -> store_mod.Store:
    """성북 A 범위에 real 이용권·공공 행 40개씩 + 강좌 2개씩 — 요청마다 courses_for 를 수십 번 부른다."""
    rows, courses = [], []
    for i in range(40):
        la, lo = 37.598 + (i % 8) * 0.0015, 127.008 + (i // 8) * 0.006
        rows.append({"id": f"CV{i:02d}", "source": "voucher", "coord_source": "geocoded", "sigungu_cd": "11290",
                     "sigungu_nm": "성북구", "name": f"동시태권도{i}", "addr": f"서울 성북구 보문로 {i + 1}",
                     "lat": la, "lon": lo})
        rows.append({"id": f"CP{i:02d}", "source": "public", "coord_source": "api", "sigungu_cd": "11290",
                     "sigungu_nm": "성북구", "name": f"동시체육관{i}", "addr": f"서울 성북구 화랑로 {i + 1}",
                     "lat": la + 0.0003, "lon": lo + 0.0003})
        for fid, src in ((f"CV{i:02d}", "voucher"), (f"CP{i:02d}", "public")):
            courses += [(f"{fid}-a", fid, src, "유소년", "태권도", 90000 + i, "유청소년"),
                        (f"{fid}-b", fid, src, "성인", "태권도", 120000 + i, "성인")]
    _insert_facilities(s, rows)
    s.conn.executemany(
        "INSERT INTO courses (id, facility_id, source, name, sport, fee_month, target) VALUES (?,?,?,?,?,?,?)",
        courses,
    )
    s.conn.commit()
    s.invalidate_area_index()
    s.area_index()
    return s


def _hammer(s: store_mod.Store, rounds: int = 40) -> list[str]:
    errors: list[str] = []

    def call(fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001 — 경합 증상(InterfaceError·IndexError…)을 모두 모은다
            errors.append(f"{type(e).__name__}: {e}")

    jobs = [
        lambda: _engine(s, A_T, "svoucher", age=10),
        lambda: _engine(s, A_T, "public", age=10),
        lambda: engine.search_facilities(s, sigungu_cd="11290", q="동시", program="svoucher", age=30),
        lambda: engine.search_facilities(s, sigungu_cd="11290", q="동시", program="public", age=30),
    ]
    for _ in range(rounds):
        ts = [threading.Thread(target=call, args=(j,)) for j in jobs]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
    return errors


def test_i4_concurrent_requests_on_shared_connection(tmp_path):
    """웹은 "이 지역에서 다시 찾기" 한 번에 in-bounds 2건(이용권+공공)을 **동시에** 보낸다. 워커는 커넥션 하나를
    스레드풀이 함께 쓰므로, 문장 캐시가 같은 준비된 문장을 두 스레드에 주면 InterfaceError·IndexError(500)가
    났다. 앱이 여는 두 경로(fixtures 메모리 DB · 파일 DB) 모두에서 동시 호출이 깨지지 않아야 한다."""
    mem = _concurrency_store(store_mod.build_store())
    assert _hammer(mem) == []
    path = tmp_path / "concurrency.db"  # 실 DB 가 아니라 스크래치 파일 DB(open_db_store 경로)
    built = _concurrency_store(store_mod.build_store(str(path)))
    built.conn.close()
    filed = store_mod.open_db_store(str(path))
    try:
        filed.area_index()
        assert _hammer(filed) == []
    finally:
        filed.conn.close()


def test_i4_shared_connection_has_no_statement_cache():
    # 회귀 가드: 문장 캐시를 다시 켜면 위 경합이 돌아온다(원인 — 같은 SQL 이면 같은 sqlite3_stmt).
    assert store_mod.SHARED_CONN_CACHED_STATEMENTS == 0


def test_i3_coord_classes(xstore):
    idx = xstore.area_index()
    assert idx.coord_class("X01") == "geocoded_approx"
    assert idx.coord_class("X03") == "placeholder"
    assert idx.coord_class("X06") == "far"
    assert idx.coord_class("V01") == "centroid"
    assert idx.coord_class("P01") == "real"
    assert idx.coord_class("NOPE") is None
    st = idx.stats()
    assert st["classes"]["public"]["placeholder"] == 3 and st["placeholder_points"] == 1
    assert st["build_ms"] >= 0


# ---------------------------------------------------------------------------
# 기타 (M1·C1·C2)
# ---------------------------------------------------------------------------
def test_m1_rate_limit_bucket_and_security_headers(client, astore):
    assert main_mod._rate_limiter._limit_for(URL)[1] == "api"
    r = _get(client, **A)
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert "Content-Security-Policy" in r.headers


def test_m1_response_envelope(client, astore):
    body = _get(client, **A, program="public", q="  체육  ").json()
    assert body["bounds"] == A
    assert body["center"] == {"lat": 37.6035, "lon": 127.025}
    assert body["diag_km"] == 4.0 and body["max_diag_km"] == 20
    assert body["q"] == "체육" and body["tokens"] == ["체육"]
    assert body["match_fields"] == ["name", "addr"]
    assert body["coord_sources"] == ["api", "geocoded"]
    assert body["coord_rules"] == {
        "placeholder_min_areas": 3, "suspect_max_km": 40, "robust_min_rows": 5,
        "geocoded_requires_building_no": True, "shared_point_min_names": 2,
    }
    assert body["order"] == "center_distance" and body["eligibility_applied"] is False
    assert body["unlocated"] == {"total": 0, "count_basis": "whole_area", "areas": []}
    area = _get(client, **A).json()["unlocated"]["areas"][0]
    assert set(area) == {
        "sigungu_cd", "sigungu_nm", "sido_nm", "label", "display_label", "scope_codes",
        "count", "included_by",
    }


def test_c1_contract_constants_match_server(contract):
    assert contract["max_diag_km"] == engine.AREA_MAX_DIAG_KM
    assert contract["max_lon_span_deg"] == engine.AREA_MAX_LON_SPAN_DEG
    assert contract["limit_default"] == engine.AREA_LIMIT_DEFAULT
    assert contract["limit_max"] == engine.AREA_LIMIT_MAX
    assert contract["q_max"] == engine.SEARCH_Q_MAX
    assert contract["korea_bounds"] == engine.KOREA_BOUNDS
    # 지구 반지름: store.haversine_km 이 쓰는 값(1도 위도 호 길이로 역산)
    one_deg = store_mod.haversine_km(0.0, 0.0, 1.0, 0.0)
    assert abs(one_deg - math.radians(1) * contract["earth_radius_km"]) < 1e-9
    assert contract["order"] == "center_distance"
    assert contract["real_coord_sources"] == sorted(engine._REAL_COORD_SOURCES)
    rules = contract["coord_rules"]
    assert rules["placeholder_min_areas"] == engine.AREA_PLACEHOLDER_MIN_AREAS
    assert rules["suspect_max_km"] == engine.AREA_SUSPECT_MAX_KM
    assert rules["robust_min_rows"] == engine.AREA_ROBUST_MIN_ROWS
    assert rules["geocoded_building_no_regex"] == engine.AREA_GEOCODED_BNO_PATTERN
    assert rules["shared_point_min_names"] == engine.AREA_SHARED_POINT_MIN_NAMES
    assert rules["api_building_no_regex"] == engine.AREA_API_BNO_PATTERN
    assert set(rules) == {
        "placeholder_min_areas", "suspect_max_km", "robust_min_rows", "geocoded_building_no_regex",
        "shared_point_min_names", "api_building_no_regex",
    }
    assert contract["evidence"]["min_distinct_points"] == engine.AREA_EVIDENCE_MIN_POINTS
    assert set(contract["ambiguous_labels"]) == engine.AREA_AMBIGUOUS_LABELS
    for k, v in contract["sido_names"].items():
        assert region.sido_label(k) == v, k
    assert contract["sigungu_groups"] == [
        {"id": g["id"], "label": g["label"], "members": list(g["members"])}
        for g in region.SIGUNGU_GROUPS
    ]


def test_c1_building_no_regex_examples():
    bno = engine.AREA_GEOCODED_BNO_RE
    for addr in ("서울 성북구 종암로 25", "서울 성북구 구암로32길 6-16", "서울 성북구 조야동 52번지",
                 "강원 영월군 산 12", "강원 영월군 산12-3", "서울 성북구 보문로 1 (보문동)",
                 "서울 성북구 보문로 1, 2층"):
        assert bno.search(addr), addr
    for addr in ("서울 성북구 하월곡동", "인천 서구", "서울 성북구 장위3동", "서울 성북구 동소문동7가",
                 "", "서울 성북구 구암로"):
        assert not bno.search(addr), addr


def test_c2_contract_cases_http(client, contract, monkeypatch):
    stores = {ds: _make_store(contract, ds) for ds in (None, *contract["datasets"])}
    current: dict = {}
    monkeypatch.setattr(main_mod, "get_store", lambda: current["s"])
    for name, case in contract["cases"].items():
        current["s"] = stores[case.get("dataset")]
        r = _get(client, **case["params"])
        if "error" in case:
            assert _err(r) == (case["error"]["status"], case["error"]["code"]), name
            continue
        if "expect_status" in case:
            assert r.status_code == case["expect_status"], name
            continue
        assert r.status_code == 200, (name, r.text)
        body = r.json()
        exp = case["expect"]
        got = {
            "ids": _ids(body), "total": body["total"], "truncated": body["truncated"],
            "unlocated": _unl(body),
        }
        assert got == exp, name


# ---------------------------------------------------------------------------
# 실 DB 회귀 (ro_db_store · engine 직접 호출) — `-k real_db`
# ---------------------------------------------------------------------------
REAL_BOUNDS = {
    "seongbuk_z15": (37.585, 127.010, 37.598, 127.028),
    "incheon_seo_10km": (37.5205, 126.6099, 37.5712, 126.7037),
    "changwon": (35.20, 128.58, 35.26, 128.66),
    "sejong_z15": (36.493, 127.258, 36.503, 127.273),
    "suwon_gunpo": (37.255, 126.970, 37.267, 126.988),
    "seoul_18_7km": (37.51, 126.90, 37.62, 127.06),
}
_OTHER_SIDO_ADDR = re.compile(
    r"^(부산|대구|대전|광주|울산|세종|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)"
)


def _all_hits(s, source, bounds, tokens=()) -> list[sqlite3.Row]:
    _, rowids = s.area_index().real_hits(source, bounds, list(tokens), None)
    out = []
    for i in range(0, len(rowids), 500):
        chunk = rowids[i:i + 500]
        out.extend(s.conn.execute(
            f"SELECT id, name, addr, lat, lon, sigungu_cd, coord_source FROM facilities "
            f"WHERE rowid IN ({','.join('?' * len(chunk))})", chunk,
        ).fetchall())
    return out


def test_real_db_r1_only_real_class_rows(ro_db_store):
    idx = ro_db_store.area_index()
    for key in ("seongbuk_z15", "incheon_seo_10km", "changwon", "sejong_z15"):
        for program in ("svoucher", "dvoucher", "public"):
            body = _engine(ro_db_store, REAL_BOUNDS[key], program)
            for f in body["facilities"]:
                assert f["coord_source"] in ("api", "geocoded"), (key, program, f["id"])
                assert idx.coord_class(f["id"]) == "real", (key, program, f["id"])
                assert f["dist_km"] is None


def test_real_db_r2_changwon(ro_db_store):
    body = _engine(ro_db_store, REAL_BOUNDS["changwon"], "svoucher")
    assert body["total"] == 0
    assert [tuple(u) for u in _unl(body)] == [("48120", "창원시", "창원시", 638)]


def test_real_db_r3_sejong_placeholder(ro_db_store):
    body = _engine(ro_db_store, REAL_BOUNDS["sejong_z15"], "svoucher")
    assert [a["sigungu_cd"] for a in body["unlocated"]["areas"]] == ["36110"]
    rows = _all_hits(ro_db_store, "public", REAL_BOUNDS["sejong_z15"])
    assert rows, "세종 z15 public 실좌표 행이 비었다"
    near = lambda r: abs(r["lat"] - 36.497877) < 5e-7 and abs(r["lon"] - 127.265434) < 5e-7  # noqa: E731
    assert not [r["id"] for r in rows if near(r)]
    # 그 점(원천 기본값 — 영역 100곳 넘게 한 점에 쌓임)의 행은 하나도 real 이 아니다.
    # 좌표가 **똑같은** 행은 자리표시 점이고, 소수 10자리로 잘려 저장된 1행은 똑같지 않아
    # 자리표시 점으로 묶이지 않지만(반올림 없음 — 계약 §3.3) 먼 행 규칙에 걸린다.
    idx = ro_db_store.area_index()
    at_point = ro_db_store.conn.execute(
        "SELECT id, lat, lon FROM facilities WHERE coord_source='api' "
        "AND lat BETWEEN 36.4978765 AND 36.4978775 AND lon BETWEEN 127.2654335 AND 127.2654345"
    ).fetchall()
    assert len(at_point) > 400
    classes = [idx.coord_class(r["id"]) for r in at_point]
    assert "real" not in classes
    assert classes.count("placeholder") > 400


def test_real_db_r4_suwon_excludes_gunpo(ro_db_store):
    for program in ("svoucher", "dvoucher", "public"):
        body = _engine(ro_db_store, REAL_BOUNDS["suwon_gunpo"], program)
        codes = {c for a in body["unlocated"]["areas"] for c in [a["sigungu_cd"], *a["scope_codes"]]}
        assert "41410" not in codes, program
        assert all(f["sigungu_nm"] != "군포시" for f in body["facilities"]), program


def test_real_db_r5_seoul_no_other_sido_rows(ro_db_store):
    rows = _all_hits(ro_db_store, "public", REAL_BOUNDS["seoul_18_7km"])
    assert len(rows) > 1000
    assert not [r["name"] for r in rows if "박종우태권도" in (r["name"] or "")]
    others = [(r["name"], r["addr"]) for r in rows if _OTHER_SIDO_ADDR.match(r["addr"] or "")]
    assert others == []


def test_real_db_r6_seongbuk_geocoded_without_building_no(ro_db_store):
    s = ro_db_store
    idx = s.area_index()
    bno = engine.AREA_GEOCODED_BNO_RE
    geo = s.conn.execute(
        "SELECT id, addr FROM facilities WHERE source='voucher' AND coord_source='geocoded' "
        "AND sigungu_cd='11290'"
    ).fetchall()
    no_bno = {r["id"] for r in geo if not bno.search(r["addr"] or "")}
    assert len(no_bno) == 17
    hits = {r["id"] for r in _all_hits(s, "voucher", REAL_BOUNDS["seongbuk_z15"])}
    assert not (no_bno & hits)
    body = _engine(s, REAL_BOUNDS["seongbuk_z15"], "svoucher")
    unl = {a["sigungu_cd"]: a["count"] for a in body["unlocated"]["areas"]}
    area_rows = s.conn.execute(
        "SELECT id FROM facilities WHERE source='voucher' AND sigungu_cd='11290'"
    ).fetchall()
    approx = sum(1 for r in area_rows if idx.coord_class(r["id"]) != "real")
    assert unl["11290"] == approx


def test_real_db_r7_incheon_group(ro_db_store):
    body = _engine(ro_db_store, REAL_BOUNDS["incheon_seo_10km"], "svoucher")
    labels = [a["label"] for a in body["unlocated"]["areas"]]
    codes = [a["sigungu_cd"] for a in body["unlocated"]["areas"]]
    assert "서해구·검단구 일대(옛 서구)" in labels
    assert "28275" not in codes and "28290" not in codes


def test_real_db_r8_ambiguous_labels_derived(ro_db_store):
    conn = ro_db_store.conn
    old = {r[0] for r in conn.execute("SELECT old_cd FROM sigungu_alias")}
    prefixes: dict[str, set] = {}
    for cd, nm in conn.execute(
        "SELECT cd, nm FROM sigungu WHERE lat IS NOT NULL AND lon IS NOT NULL"
    ):
        if cd in old or not nm:
            continue
        prefixes.setdefault(nm, set()).add(cd[:2])
    derived = {nm for nm, p in prefixes.items() if len(p) >= 2}
    assert derived == engine.AREA_AMBIGUOUS_LABELS


# 실 DB 에서 번지 없는 api 행이 한 점에 몰린 곳(시군구·읍면동 단위 지오코딩) — 예전엔 real 로 찍혔다.
SHARED_CASES = {
    # 범위, 그 점, 주소
    "daejeon_donggu": ((36.30577, 127.44681, 36.31777, 127.46281), (36.3117696265, 127.45480709), "대전광역시 동구"),
    "gapyeong": ((37.8254, 127.5016, 37.8374, 127.5176), (37.8314413101, 127.509570182), "경기도 가평군"),
}


def test_real_db_r9_shared_point_not_plotted(ro_db_store):
    s = ro_db_store
    idx = s.area_index()
    for key, (b, (plat, plon), addr) in SHARED_CASES.items():
        at_point = s.conn.execute(
            "SELECT id FROM facilities WHERE coord_source='api' AND lat=? AND lon=? AND addr=?",
            (plat, plon, addr),
        ).fetchall()
        assert len(at_point) >= 30, key
        assert {idx.coord_class(r["id"]) for r in at_point} == {"shared_point"}, key
        rows = _all_hits(s, "public", b)
        assert not [r["id"] for r in rows if r["lat"] == plat and r["lon"] == plon], key
        body = _engine(s, b, "public")
        assert all(not (f["lat"] == plat and f["lon"] == plon) for f in body["facilities"]), key
        # 점으로 찍지 않은 행은 그 시군구의 위치 미상 수로 간다
        cd = s.conn.execute(
            "SELECT sigungu_cd FROM facilities WHERE id=?", (at_point[0]["id"],)
        ).fetchone()[0]
        unl = {a["sigungu_cd"]: a["count"] for a in body["unlocated"]["areas"]}
        assert unl.get(s.canonical_sigungu(cd), 0) >= len(at_point), key


def test_real_db_r9_shared_point_keeps_real_sites(ro_db_store):
    """번지가 붙어 적힌 종합운동장('양덕동477')과 혼자 있는 점은 real 로 남는다."""
    s = ro_db_store
    idx = s.area_index()
    masan = s.conn.execute(
        "SELECT id FROM facilities WHERE coord_source='api' AND addr='양덕동477'"
    ).fetchall()
    assert len(masan) >= 5
    assert {idx.coord_class(r["id"]) for r in masan} == {"real"}
    # 불변식: real 등급 api 행 가운데 번지 없는 행끼리 좌표가 똑같으면 이름 키가 하나뿐이다.
    from app.area_index import name_key

    rx = engine.AREA_API_BNO_RE
    by_point: dict = {}
    for r in s.conn.execute("SELECT id, name, addr, lat, lon FROM facilities WHERE coord_source='api'"):
        if rx.search(r["addr"] or "") or idx.coord_class(r["id"]) != "real":
            continue
        by_point.setdefault((r["lat"], r["lon"]), set()).add(name_key(r["name"]))
    assert not [p for p, names in by_point.items() if len(names) >= engine.AREA_SHARED_POINT_MIN_NAMES]
    st = idx.stats()
    assert st["shared_rows"] > 0 and st["classes"]["public"]["shared_point"] == st["shared_rows"]


def test_real_db_reference_table(ro_db_store, capsys):
    """§3.5 참고값 — 단언하지 않고 출력만 한다(-s 로 확인)."""
    lines = []
    for key, b in REAL_BOUNDS.items():
        for program in ("svoucher", "dvoucher", "public"):
            body = _engine(ro_db_store, b, program)
            unl = [(a["sigungu_cd"], a["display_label"], a["count"]) for a in body["unlocated"]["areas"]]
            lines.append(f"{key:18s} {program:8s} total={body['total']:5d} unlocated={unl}")
    st = ro_db_store.area_index().stats()
    with capsys.disabled():
        print("\n[area] 실 DB 참고값(§3.5)")
        for ln in lines:
            print("  " + ln)
        print(f"  classes={st['classes']} placeholder_points={st['placeholder_points']} "
              f"placeholder_rows={st['placeholder_rows']} shared_points={st['shared_points']} "
              f"shared_rows={st['shared_rows']}")
