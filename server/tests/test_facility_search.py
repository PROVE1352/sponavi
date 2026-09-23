"""GET /api/facilities/search — 시설 이름·주소 키워드 검색.

이용권 가맹시설 대부분은 구 중심 폴백 좌표라 지도 이동으로는 다른 동의 시설을 못 찾는다
(대구 북구 실측). 이 검색은 자격 판정을 하지 않으므로 이용권 행의 subsidy/copay 는
null(자격 미상)이어야 한다 — 0 이면 "지원 없음" 거짓 판정, 차감이면 거짓 금액(P-1).

격리: 세션 store 를 건드리지 않도록 fixtures 로 새 in-memory store 를 만들고 테스트 행을
끼워 넣은 뒤 app.main.get_store 를 그 store 로 바꿔 끼운다(실 DB 무접촉).
"""
from __future__ import annotations

import pytest

from app import engine
from app import store as store_mod

CD = "11290"  # 성북구 (fixtures centroid 있음)

_ROWS = [
    # id, source, name, addr, coord_source, lat, lon
    ("T1", "voucher", "구암태권도장", "서울특별시 성북구 구암로32길 6-16", "centroid", 37.5894, 127.0167),
    ("T2", "voucher", "무태검도관", "서울 성북구 조야동 52번지", "centroid", 37.5894, 127.0167),
    ("T3", "voucher", "100% 필라테스", "서울특별시 성북구 보문로 1", "centroid", 37.5894, 127.0167),
    ("T4", "voucher", "A_bly PT센터", "서울특별시 성북구 보문로 3", "centroid", 37.5894, 127.0167),
    ("T5", "voucher", "AxbLY 짐", "서울특별시 성북구 보문로 5", "centroid", 37.5894, 127.0167),
    ("T6", "dvoucher", "구암장애인수영장", "서울특별시 성북구 구암로 10", "centroid", 37.5894, 127.0167),
    ("T7", "public", "구암 생활체육공원", "서울특별시 성북구 구암로 240 (구암동)", "api", 37.60, 127.02),
    ("T8", "public", "구암 먼 체육관", "서울특별시 성북구 구암로 900", "api", 37.64, 127.06),
    # 다른 구 — 같은 키워드라도 나오면 안 된다
    ("T9", "voucher", "구암태권도 강남점", "서울특별시 강남구 구암로 1", "centroid", 37.5, 127.05),
]


@pytest.fixture()
def sstore(monkeypatch):
    s = store_mod.build_store()
    for (fid, src, name, addr, cs, lat, lon) in _ROWS:
        cd = "11680" if fid == "T9" else CD
        s.conn.execute(
            "INSERT INTO facilities (id, source, name, sido_cd, sigungu_cd, sigungu_nm, addr, "
            "lat, lon, coord_source, sports, disability_support, phone) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (fid, src, name, cd[:2], cd, "성북구", addr, lat, lon, cs, "태권도", None, None),
        )
    s.conn.execute(
        "INSERT INTO courses (id, facility_id, source, name, sport, fee_month, target) "
        "VALUES ('C-T1','T1','voucher','주3회 태권도','태권도',90000,'유청소년')"
    )
    s.conn.commit()
    # 구 코드 별칭(전환기 입력) — 99290 → 11290
    s._sigungu_alias["99290"] = CD
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "get_store", lambda: s)
    return s


def _ids(resp) -> list[str]:
    return [f["id"] for f in resp["facilities"]]


def _get(client, **params):
    return client.get("/api/facilities/search", params=params)


def test_tokens_are_anded_over_name_and_addr(client, sstore):
    # '구암로'(주소) + '태권도'(이름) 둘 다 만족하는 행만
    r = _get(client, sigungu_cd=CD, q="  구암로   태권도 ")
    assert r.status_code == 200
    body = r.json()
    assert _ids(body) == ["T1"]
    assert body["tokens"] == ["구암로", "태권도"]
    assert body["q"] == "구암로 태권도"
    # 한 토큰만이면 이름 매칭·주소 매칭 둘 다 잡힌다
    assert set(_ids(_get(client, sigungu_cd=CD, q="조야동").json())) == {"T2"}
    assert set(_ids(_get(client, sigungu_cd=CD, q="무태").json())) == {"T2"}


def test_other_sigungu_excluded(client, sstore):
    assert "T9" not in _ids(_get(client, sigungu_cd=CD, q="구암").json())


def test_like_wildcards_escaped(client, sstore):
    # % 는 글자 그대로 — '%' 검색이 전부 매칭되면 안 된다
    assert _ids(_get(client, sigungu_cd=CD, q="%").json()) == ["T3"]
    assert _ids(_get(client, sigungu_cd=CD, q="100%").json()) == ["T3"]
    # _ 도 글자 그대로 — 'A_bly' 가 'AxbLY' 를 잡으면 안 된다
    assert _ids(_get(client, sigungu_cd=CD, q="A_bly").json()) == ["T4"]
    assert _ids(_get(client, sigungu_cd=CD, q="_").json()) == ["T4"]
    # 역슬래시 입력도 오류 없이 0건
    r = _get(client, sigungu_cd=CD, q="\\")
    assert r.status_code == 200 and r.json()["total"] == 0


def test_ascii_case_insensitive(client, sstore):
    assert set(_ids(_get(client, sigungu_cd=CD, q="a_BLY").json())) == {"T4"}
    assert set(_ids(_get(client, sigungu_cd=CD, q="axbly").json())) == {"T5"}
    assert set(_ids(_get(client, sigungu_cd=CD, q="pt센터").json())) == {"T4"}


def test_alias_code_resolves_to_current(client, sstore):
    r = _get(client, sigungu_cd="99290", q="구암로 태권도")
    assert r.status_code == 200
    assert r.json()["sigungu_cd"] == CD
    assert _ids(r.json()) == ["T1"]


def test_sigungu_group_scope_codes():
    # 인천 영역그룹: 한 코드로 물어도 그룹 전체 코드가 검색 범위다(assess 카운트와 같은 규칙)
    codes, g = engine.region.count_scope("28275")
    assert set(codes) == {"28260", "28275", "28290"} and g is not None


@pytest.mark.parametrize("q", ["", "   ", "　", "가" * 31])
def test_q_validation_422(client, sstore, q):
    r = _get(client, sigungu_cd=CD, q=q)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_REQUEST"


def test_q_30_chars_ok(client, sstore):
    assert _get(client, sigungu_cd=CD, q="가" * 30).status_code == 200


def test_missing_or_bad_sigungu(client, sstore):
    assert _get(client, q="구암").status_code == 422
    assert _get(client, sigungu_cd="abc", q="구암").status_code == 422
    r = _get(client, sigungu_cd="00000", q="구암")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "LOCATION_UNRESOLVED"


def test_bad_program_422(client, sstore):
    assert _get(client, sigungu_cd=CD, q="구암", program="gym").status_code == 422


def test_limit_cap_total_truncated(client, sstore):
    r = _get(client, sigungu_cd=CD, q="보문로", limit=1).json()
    assert r["total"] == 3 and len(r["facilities"]) == 1 and r["truncated"] is True
    r = _get(client, sigungu_cd=CD, q="보문로", limit=999).json()
    assert r["total"] == 3 and len(r["facilities"]) == 3 and r["truncated"] is False
    assert _get(client, sigungu_cd=CD, q="보문로", limit=0).status_code == 422
    # 서버 상한 SEARCH_LIMIT_MAX 로 잘린다
    for i in range(engine.SEARCH_LIMIT_MAX + 5):
        sstore.conn.execute(
            "INSERT INTO facilities (id, source, name, sigungu_cd, sigungu_nm, addr, lat, lon, "
            "coord_source, sports) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (f"CAP{i:03d}", "voucher", f"캡시설{i}", CD, "성북구", "성북구 캡로",
             37.5894, 127.0167, "centroid", "헬스"),
        )
    r = _get(client, sigungu_cd=CD, q="캡로", limit=999).json()
    assert r["total"] == engine.SEARCH_LIMIT_MAX + 5
    assert len(r["facilities"]) == engine.SEARCH_LIMIT_MAX and r["truncated"] is True


def test_program_filter_dvoucher_and_public(client, sstore):
    sv = _get(client, sigungu_cd=CD, q="구암").json()
    assert set(_ids(sv)) == {"T1"}  # dvoucher·public 제외
    dv = _get(client, sigungu_cd=CD, q="구암", program="dvoucher").json()
    assert _ids(dv) == ["T6"]
    assert dv["facilities"][0]["source"] == "dvoucher"
    pub = _get(client, sigungu_cd=CD, q="구암", program="public").json()
    assert set(_ids(pub)) == {"T7", "T8"}
    assert pub["facilities"][0]["type"] == "공공체육시설"


def test_voucher_row_shape_eligibility_unknown(client, sstore):
    row = _get(client, sigungu_cd=CD, q="구암로 태권도").json()["facilities"][0]
    # assess nearby.voucher_facilities 와 같은 키 + addr
    assert set(row) == {
        "id", "name", "source", "sports", "lat", "lon", "coord_source", "dist_km",
        "sigungu_nm", "fee_month", "subsidy", "copay", "disability_support", "addr",
    }
    assert row["fee_month"] == 90000
    # 자격 판정 없음 → 지원금·자부담 미상(null). 0 이면 '지원 없음'이라는 거짓 판정.
    assert row["subsidy"] is None and row["copay"] is None
    # 구 중심 폴백 → 거리 미표기
    assert row["coord_source"] == "centroid" and row["dist_km"] is None
    assert row["addr"].endswith("구암로32길 6-16")


def test_public_sorted_by_distance_when_origin_given(client, sstore):
    r = _get(client, sigungu_cd=CD, q="구암", program="public", lat=37.60, lon=127.02).json()
    assert _ids(r) == ["T7", "T8"]
    assert r["facilities"][0]["dist_km"] == 0.0
    assert r["facilities"][1]["dist_km"] > 1
    # 위도만 오면 422
    assert _get(client, sigungu_cd=CD, q="구암", lat=37.6).status_code == 422
    # 원점 없으면 시군구 중심에서 잰다(assess 폴백과 같음) — 실좌표 행만 거리 노출
    r = _get(client, sigungu_cd=CD, q="구암", program="public").json()
    assert all(f["dist_km"] is not None for f in r["facilities"])
    r = _get(client, sigungu_cd=CD, q="구암").json()
    assert all(f["dist_km"] is None for f in r["facilities"])  # 이용권 = centroid


def test_shape_matches_assess_nearby_serializer(sstore):
    """검색 행과 assess 행이 같은 직렬화기를 쓰는지(키 집합) 확인."""
    res = engine.assess(sstore, {
        "age": 12, "sex": "M", "sigungu_cd": CD, "income_class": "기초생활수급",
        "disability": {"has": False, "type": None},
    })
    v = res["nearby"]["voucher_facilities"]
    a = res["nearby"]["alternatives"]
    sv = engine.search_facilities(sstore, sigungu_cd=CD, q="구암로")
    pub = engine.search_facilities(sstore, sigungu_cd=CD, q="구암", program="public")
    if v:
        assert set(sv["facilities"][0]) - {"addr"} == set(v[0])
    if a:
        assert set(pub["facilities"][0]) - {"addr"} == set(a[0])


def test_rate_limit_and_security_headers_apply(client, sstore):
    r = _get(client, sigungu_cd=CD, q="구암")
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert "Content-Security-Policy" in r.headers
    from app.main import _rate_limiter

    assert _rate_limiter._limit_for("/api/facilities/search")[1] == "api"
