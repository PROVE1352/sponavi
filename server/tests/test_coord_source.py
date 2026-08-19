"""좌표 정직성 배지 (FR-04/FR-05): coord_source 분류 + 근사좌표 거리 미노출.

fixtures 기준: 이용권(voucher/dvoucher)=구 중심 폴백(centroid), 공공(public)=실좌표(api).
전국 실 DB 에선 public 일부도 centroid 이지만, 여기선 데모 fixtures 계약을 검증한다.
"""
import pytest

from app.engine import assess


def _body(age, income="그외", disability=None, sigungu="11290"):
    return {
        "age": age, "sex": "M", "sigungu_cd": sigungu, "sigungu_nm": "",
        "income_class": income,
        "disability": disability or {"has": False, "type": None},
        "location": None,
    }


# ① store 레이어: 이용권 = centroid, 공공 = api
def test_voucher_dvoucher_rows_are_centroid(store):
    for src in ("voucher", "dvoucher"):
        facs = store.facilities(src)
        assert facs, f"{src} fixtures 비어있음"
        assert all(f["coord_source"] == "centroid" for f in facs), src


def test_public_rows_are_api(store):
    pub = store.facilities("public")
    assert pub
    assert all(f["coord_source"] == "api" for f in pub)


# ② 응답: centroid 시설엔 dist_km 미노출(null), api 시설엔 실수 km
def test_voucher_facilities_hide_distance(store):
    # P1: svoucher 자격 → 성북 voucher 가맹시설(전부 centroid) → 거리 미표기
    res = assess(store, _body(10, "기초생활수급"))
    vfs = res["nearby"]["voucher_facilities"]
    assert vfs
    for f in vfs:
        assert f["coord_source"] == "centroid"
        assert f["dist_km"] is None


def test_public_alternatives_show_distance(store):
    # P2: 소득 탈락 → 공공 대안(실좌표 api) → km 노출
    res = assess(store, _body(27, "그외"))
    alts = res["nearby"]["alternatives"]
    assert alts
    for a in alts:
        assert a["coord_source"] == "api"
        assert isinstance(a["dist_km"], (int, float))


def test_centroid_facility_path_label_has_no_distance(store):
    # 근사좌표 시설 홉 라벨엔 'Nonekm' 가 찍히면 안 된다(거리 미표기 = 이름만)
    res = assess(store, _body(10, "기초생활수급"))
    for hop in res["path"]:
        assert "Nonekm" not in hop["label"]


def test_geocoded_facility_exposes_distance():
    """M2 지오코딩(coord_source='geocoded')은 실좌표 — 거리 노출 대상(FR-04).

    2026-08-19 실배치에서 발견: _is_api가 'api'만 인정해 geocoded 시설의
    dist_km가 None으로 나갔다. 실좌표 집합은 {'api','geocoded'}."""
    from app import engine

    fac = {"coord_source": "geocoded", "dist_km": 1.2, "name": "지오코딩 시설"}
    assert engine._expose_dist(fac) == 1.2
    assert "1.2km" in engine._facility_hop_label(fac)
    approx = {"coord_source": "centroid", "dist_km": 1.2, "name": "근사 시설"}
    assert engine._expose_dist(approx) is None
