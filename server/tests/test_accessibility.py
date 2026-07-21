"""FR-10 접근성 보조 소스 — 로더 조인 로직(단위) + API 계약(없는 id 생략·빈 테이블 폴백).

engine 무접촉 원칙 검증 포함: 접근성은 GET /api/accessibility 로만 흐르고 assess 응답
계약은 그대로다. 로더 조인은 DB(dvoucher)→웹 방향 매칭(정규화 시설명 + 주소 디스앰비그).
"""
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "server"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from app import store as store_mod  # noqa: E402
import load_accessibility as loader  # noqa: E402


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _store_with_access():
    """fixtures 스토어 + facility_accessibility 테이블/샘플 행."""
    s = store_mod.build_store()
    s.conn.executescript(loader.SCHEMA)
    rows = [
        ("D01", "disability_type", "01", "지체", "dvoucher", "2026-07-21"),
        ("D01", "disability_type", "05", "뇌병변", "dvoucher", "2026-07-21"),
        ("D01", "amenity", "01", "장애인 화장실", "dvoucher", "2026-07-21"),
        ("D01", "amenity", "02", "장애인용 엘리베이터", "dvoucher", "2026-07-21"),
        ("D01", "amenity", "04", "주출입구 단차없음", "dvoucher", "2026-07-21"),
    ]
    s.conn.executemany(
        "INSERT INTO facility_accessibility "
        "(facility_id, kind, code, name, source, checked) VALUES (?,?,?,?,?,?)",
        rows,
    )
    s.conn.commit()
    return s


# ---------------------------------------------------------------------------
# loader join logic (unit)
# ---------------------------------------------------------------------------
def test_norm_strips_all_whitespace():
    assert loader.norm(" 금만 검도관 ") == "금만검도관"
    assert loader.norm(None) == ""


def test_match_web_unique_name():
    web = [{"name": "가나 센터", "addr": "서울특별시 성북구 A로 1"}]
    idx = loader.index_web(web)
    hit = loader.match_web({"name": "가나센터", "sigungu_nm": "성북구"}, idx)
    assert hit is web[0]


def test_match_web_disambiguates_by_sigungu_in_addr():
    web = [
        {"name": "행복 센터", "addr": "서울특별시 성북구 B로 2"},
        {"name": "행복 센터", "addr": "부산광역시 해운대구 C로 3"},
    ]
    idx = loader.index_web(web)
    hit = loader.match_web({"name": "행복센터", "sigungu_nm": "해운대구"}, idx)
    assert hit["addr"].startswith("부산")


def test_match_web_ambiguous_returns_none():
    # 같은 이름·같은 시군구명 주소 2개 → 추정 금지(P-1) → None
    web = [
        {"name": "중복 센터", "addr": "서울특별시 성북구 X로 1"},
        {"name": "중복 센터", "addr": "서울특별시 성북구 Y로 2"},
    ]
    idx = loader.index_web(web)
    assert loader.match_web({"name": "중복센터", "sigungu_nm": "성북구"}, idx) is None


def test_match_web_no_candidate_returns_none():
    idx = loader.index_web([{"name": "다른 센터", "addr": "서울"}])
    assert loader.match_web({"name": "없는센터", "sigungu_nm": "성북구"}, idx) is None


def test_build_rows_maps_types_and_amenities():
    web_fac = {
        "disability_types": ["지체", "지적"],
        "amenities": [{"code": "06", "name": "휠체어 대여"}],
    }
    dis_map = {"지체": "01", "지적": "08"}
    rows = loader.build_rows(web_fac, "dvoucher-9", "2026-07-21", dis_map)
    kinds = {r[1] for r in rows}
    assert kinds == {"disability_type", "amenity"}
    amen = [r for r in rows if r[1] == "amenity"][0]
    assert amen[2] == "06" and amen[3] == "휠체어 대여"
    # 모든 행에 facility_id/checked/source 공통
    assert all(r[0] == "dvoucher-9" and r[5] == "2026-07-21" and r[4] == loader.SOURCE for r in rows)


# ---------------------------------------------------------------------------
# store.accessibility_for / facilities_with_amenity
# ---------------------------------------------------------------------------
def test_accessibility_for_returns_and_omits_missing():
    s = _store_with_access()
    out = s.accessibility_for(["D01", "NOPE"])
    assert "D01" in out and "NOPE" not in out  # 없는 id 는 생략(P-1)
    assert out["D01"]["types"] == ["지체", "뇌병변"]
    codes = {a["code"] for a in out["D01"]["amenities"]}
    assert codes == {"01", "02", "04"}
    assert out["D01"]["checked"] == "2026-07-21"


def test_accessibility_for_empty_input():
    s = _store_with_access()
    assert s.accessibility_for([]) == {}


def test_accessibility_for_missing_table_fallback():
    # 테이블 없는 데모 스토어 → 빈 결과(폴백 안전, DR-4)
    s = store_mod.build_store()
    assert s.accessibility_for(["D01"]) == {}


def test_facilities_with_amenity_and_semantics():
    s = _store_with_access()
    # D01 은 01·02·04 보유 → 01 단독, 01+02 조합 모두 매칭
    assert "D01" in s.facilities_with_amenity(None, ["01"])
    assert "D01" in s.facilities_with_amenity(None, ["01", "02"])
    # 06(휠체어) 은 없음 → 01+06 조합(AND) 미매칭
    assert "D01" not in s.facilities_with_amenity(None, ["01", "06"])
    # sigungu 한정(D01 = 강북구 11305)
    assert "D01" in s.facilities_with_amenity("11305", ["01"])
    assert "D01" not in s.facilities_with_amenity("11290", ["01"])
    assert s.facilities_with_amenity(None, []) == set()


def test_facilities_with_amenity_missing_table_fallback():
    s = store_mod.build_store()
    assert s.facilities_with_amenity(None, ["01"]) == set()


# ---------------------------------------------------------------------------
# API 계약 (GET /api/accessibility)
# ---------------------------------------------------------------------------
def test_endpoint_missing_table_fallback(monkeypatch):
    # 접근성 테이블 없는 데모 스토어 → 빈 응답(전 기능 폴백 안전, DR-4)
    from fastapi.testclient import TestClient

    from app import main as main_mod

    s = store_mod.build_store()  # 테이블 없음
    monkeypatch.setattr(main_mod, "get_store", lambda: s)
    c = TestClient(main_mod.app)
    r = c.get("/api/accessibility", params={"ids": "dvoucher-1,dvoucher-2"})
    assert r.status_code == 200
    assert r.json() == {}


def test_endpoint_no_ids(client):
    r = client.get("/api/accessibility")
    assert r.status_code == 200
    assert r.json() == {}


def test_endpoint_returns_source_and_omits_missing(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main as main_mod

    s = _store_with_access()
    monkeypatch.setattr(main_mod, "get_store", lambda: s)
    c = TestClient(main_mod.app)
    r = c.get("/api/accessibility", params={"ids": "D01,GHOST"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"D01"}  # 없는 id 생략
    assert body["D01"]["source"] == "장애인이용권 웹 공개 정보"
    assert body["D01"]["checked"] == "2026-07-21"
    assert {a["code"] for a in body["D01"]["amenities"]} == {"01", "02", "04"}


def test_assess_contract_unaffected_by_accessibility(client, personas_by_id):
    # engine 무접촉 회귀: assess 응답에 접근성 필드가 새어들지 않는다
    body = personas_by_id["P3"]["body"]
    data = client.post("/api/assess", json=body).json()
    assert set(data) >= {"eligibility", "path", "nearby", "supply_gap"}
    # 접근성 필드가 assess 응답(시설 dict)에 새어들지 않는다 — 별도 API 로만 노출
    for f in data["nearby"]["voucher_facilities"]:
        assert "amenities" not in f and "types" not in f
