"""카운트 영역그룹 (FR-05 AC4, region.SIGUNGU_GROUPS) — 2026-07-01 인천 개편 전환기 거짓 공급공백 차단.

실측(2026-07-21 적재본, 정규화 후): 옛 서구 28260 voucher 383·dvoucher 0 / 서해구 28275 33·70 /
검단구 28290 29·44 — 한 코드만 세면 "장애인 가맹 0곳"(거짓). 합치면 445:114.
"""
import pytest

from app import region
from app.engine import assess


def _body(cd, *, age=30, disability=True):
    return {
        "age": age, "sex": "M", "sigungu_cd": cd, "sigungu_nm": "",
        "income_class": "그외",
        "disability": {"has": disability, "type": "지체" if disability else None},
        "location": None,
    }


def test_count_scope_table():
    assert region.count_scope(None) == ((), None)
    codes, g = region.count_scope("11290")
    assert codes == ("11290",) and g is None                      # 그룹 아님 → 자기 코드만
    for cd in ("28260", "28275", "28290"):
        codes, g = region.count_scope(cd)
        assert codes == ("28260", "28275", "28290")
        assert g and "옛 서구" in g["label"]
    codes, g = region.count_scope("28140")
    assert set(codes) == {"28110", "28125", "28140", "28155"}
    # 그룹 멤버는 서로 겹치지 않는다
    seen = [m for grp in region.SIGUNGU_GROUPS for m in grp["members"]]
    assert len(seen) == len(set(seen))


def _need(db_store):
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 필요")


@pytest.mark.parametrize("cd", ["28260", "28275", "28290"])
def test_incheon_seogu_group_has_no_false_gap(db_store, cd):
    _need(db_store)
    sg = assess(db_store, _body(cd))["supply_gap"]
    assert sg["voucher_count"] == 114                 # 70 + 44 (+0), 세 코드 어디서 들어와도 동일
    assert "없습니다" not in sg["message"]
    assert "일대" in sg["message"] and "옛 서구" in sg["message"]
    assert sg["voucher_scope"] == "sigungu"           # 여전히 구 단위 카운트(반경 아님, FR-04 AC2)
    assert sorted(sg["scope_codes"]) == ["28260", "28275", "28290"]
    assert sg["scope_label"] and sg["scope_reason"]


def test_incheon_jung_dong_group(db_store):
    _need(db_store)
    sg = assess(db_store, _body("28140"))["supply_gap"]  # 옛 동구: 단독이면 dvoucher 0(거짓)
    assert sg["voucher_count"] == 38                   # 2 + 13 + 0 + 23
    assert "없습니다" not in sg["message"]


def test_non_group_district_unchanged(db_store):
    _need(db_store)
    sg = assess(db_store, _body("11290"))["supply_gap"]
    assert sg["scope_codes"] == ["11290"] and sg["scope_label"] is None


def test_goseong_is_a_real_gap(db_store):
    """P4(강원 고성군): 장애인이용권 가맹 0곳은 전환기 잔재가 아닌 실제 공백 — 배너 + 최근접 속초시."""
    _need(db_store)
    sg = assess(db_store, _body("51820", age=72))["supply_gap"]
    assert sg["voucher_count"] == 0 and "없습니다" in sg["message"]
    assert sg["nearest"]["sigungu_nm"] == "속초시"
    assert sg["nearest"]["dist_km"] is None           # 근사좌표 → km 미표기(FR-04 AC2)
