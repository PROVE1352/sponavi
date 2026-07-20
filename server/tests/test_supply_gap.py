"""공급공백 계산 + 커버리지 조인 (SPEC §7, §0.1)."""
import pytest

from app.engine import SUPPLY_GAP_RADIUS_KM, assess


def _body(age, income="그외", disability=None, sigungu="11290"):
    return {
        "age": age, "sex": "M", "sigungu_cd": sigungu, "sigungu_nm": "",
        "income_class": income,
        "disability": disability or {"has": False, "type": None},
        "location": None,
    }


def test_supply_gap_always_present(store):
    res = assess(store, _body(10, "기초생활수급"))
    sg = res["supply_gap"]
    assert sg["radius_km"] == SUPPLY_GAP_RADIUS_KM
    assert "voucher_count" in sg and "alt_count" in sg and "message" in sg


def test_seongbuk_dvoucher_zero_gap(store):
    # 성북구 dvoucher 가맹시설 0 -> 공급공백 배너 (fixtures 설계)
    res = assess(store, _body(30, "그외", {"has": True, "type": "지체"}))
    sg = res["supply_gap"]
    assert sg["voucher_count"] == 0
    assert "장애인스포츠강좌이용권" in sg["message"]
    assert sg["nearest"] is not None  # 가장 가까운 곳(강북 D01) 노출
    assert sg["nearest"]["dist_km"] > SUPPLY_GAP_RADIUS_KM


def test_seongbuk_voucher_has_supply(store):
    # 비장애 이용권 가맹시설은 성북에 존재 -> gap 아님
    res = assess(store, _body(10, "기초생활수급"))
    assert res["supply_gap"]["voucher_count"] >= 1


def test_coverage_null_when_district_absent(store):
    # 강남구(11680)는 coverage fixtures(미리보기 15개 구: 종로~양천)에 없음 -> null
    res = assess(store, _body(10, "기초생활수급", sigungu="11680"))
    assert res["supply_gap"]["coverage"] is None


def test_coverage_seongbuk_real_rows(store):
    # 2026-07-20 실측 반영: 성북구(11290) 기초수급 1920명 중 560명 수령(29.2%)
    res = assess(store, _body(10, "기초생활수급"))
    cov = res["supply_gap"]["coverage"]
    assert cov is not None and cov["sigungu"] == "성북구"
    assert cov["target"] == 1920 and cov["recipient"] == 560


def test_coverage_join_present_district_default_class(store):
    # 성동구(11200) 그외 -> N(차상위·한부모) 통계
    res = assess(store, _body(30, "그외", sigungu="11200"))
    cov = res["supply_gap"]["coverage"]
    assert cov is not None
    assert cov["sigungu"] == "성동구"
    assert cov["class"] == "차상위·한부모"
    assert cov["target"] == 602 and cov["recipient"] == 9
    assert cov["rate"] == round(9 / 602, 3)
    assert cov["year"] == 2025


def test_coverage_join_basic_livelihood_class(store):
    # 기초생활수급 -> S(기초수급) 통계
    res = assess(store, _body(10, "기초생활수급", sigungu="11200"))
    cov = res["supply_gap"]["coverage"]
    assert cov["class"] == "기초수급"
    assert cov["target"] == 752 and cov["recipient"] == 161
