"""자격 매트릭스 + 대체경로 라우팅 + 자부담 계산 (SPEC §7)."""
import pytest

from app.engine import assess


def _card(res):
    return res["eligibility"][0]


def _body(age, income="그외", disability=None, sigungu="11290", loc=None):
    return {
        "age": age, "sex": "M",
        "sigungu_cd": sigungu, "sigungu_nm": "",
        "income_class": income,
        "disability": disability or {"has": False, "type": None},
        "location": loc,
    }


# --- persona expectations -------------------------------------------------
def test_p1_svoucher_eligible(store):
    res = assess(store, _body(10, "기초생활수급"))
    c = _card(res)
    assert c["program_id"] == "svoucher"
    assert c["eligible"] is True
    # 직접 경로: person -> svoucher(ok) -> facility
    assert res["path"][0]["result"] == "ok"
    assert res["path"][0]["to"] == "svoucher"
    # 근처 가맹시설 존재 + 자부담 계산됨
    assert len(res["nearby"]["voucher_facilities"]) > 0


def test_p2_svoucher_income_fail_routes_to_alternative(store):
    res = assess(store, _body(27, "그외"))
    c = _card(res)
    assert c["eligible"] is False
    assert any(r["field"] == "income_class" and not r["ok"] for r in c["reasons"])
    # 대체경로: svoucher -x-> 공식 확인 1순위(OV4 — dedupe 목록의 첫 항목과 같다)
    edges = [p for p in res["path"] if p["edge"] == "대체경로"]
    assert edges and edges[0]["to"] == res["alt_edges"][0]["to"]
    assert edges[0]["to"] == "tteuntteun"
    assert edges[0]["curated"].startswith("공식 확인")
    # 검증 대기인 공공체육시설 대안은 사라지지 않고 alt_edges 에 남는다
    assert "public_program" in {a["to"] for a in res["alt_edges"]}


def test_p3_dvoucher_eligible_but_gap(store):
    res = assess(store, _body(14, "차상위", {"has": True, "type": "지체"}))
    c = _card(res)
    assert c["program_id"] == "dvoucher"
    assert c["eligible"] is True
    # 성북구 dvoucher 가맹시설 0 -> 공급공백
    assert res["supply_gap"]["voucher_count"] == 0
    assert "없습니다" in res["supply_gap"]["message"]
    # 접근성(장애지원) 공공 대안만 노출
    for alt in res["nearby"]["alternatives"]:
        assert alt["disability_support"] is True


def test_p4_dvoucher_age_over_69(store):
    res = assess(store, _body(72, "그외", {"has": True, "type": "청각"}))
    c = _card(res)
    assert c["program_id"] == "dvoucher"
    assert c["eligible"] is False
    # 연령 초과가 실패 사유
    assert any(r["field"] == "age" and not r["ok"] for r in c["reasons"])
    # dvoucher는 소득무관 -> income reason은 ok여야 함
    assert any(r["field"] == "income_class" and r["ok"] for r in c["reasons"])
    # age_fail 대체경로 -> 공식 확인 1순위(어르신 상품권), public_program 은 alt_edges 에 잔존
    edges = [p for p in res["path"] if p["edge"] == "대체경로"]
    assert edges and edges[0]["to"] == res["alt_edges"][0]["to"]
    assert edges[0]["curated"].startswith("공식 확인")
    assert "public_program" in {a["to"] for a in res["alt_edges"]}


# --- age boundaries (svoucher 5~18) --------------------------------------
@pytest.mark.parametrize("age,expected", [(4, False), (5, True), (18, True), (19, False)])
def test_svoucher_age_boundary(store, age, expected):
    res = assess(store, _body(age, "기초생활수급"))
    age_ok = next(r["ok"] for r in _card(res)["reasons"] if r["field"] == "age")
    assert age_ok is expected


# --- age boundaries (dvoucher 5~69) --------------------------------------
@pytest.mark.parametrize("age,expected", [(4, False), (5, True), (69, True), (70, False)])
def test_dvoucher_age_boundary(store, age, expected):
    res = assess(store, _body(age, "그외", {"has": True, "type": "지체"}))
    age_ok = next(r["ok"] for r in _card(res)["reasons"] if r["field"] == "age")
    assert age_ok is expected


# --- income gate ----------------------------------------------------------
@pytest.mark.parametrize("income,ok", [
    ("기초생활수급", True), ("차상위", True), ("한부모", True), ("그외", False),
])
def test_svoucher_income_gate(store, income, ok):
    res = assess(store, _body(10, income))
    inc_ok = next(r["ok"] for r in _card(res)["reasons"] if r["field"] == "income_class")
    assert inc_ok is ok


def test_dvoucher_is_income_agnostic(store):
    # 소득 '그외'라도 dvoucher income reason은 ok (소득무관)
    res = assess(store, _body(30, "그외", {"has": True, "type": "시각"}))
    inc_ok = next(r["ok"] for r in _card(res)["reasons"] if r["field"] == "income_class")
    assert inc_ok is True


# --- copay 계산 (적격): copay = max(0, fee_month - subsidy) ----------------
def test_copay_calculation(store):
    res = assess(store, _body(10, "기초생활수급"))
    assert _card(res)["eligible"] is True
    for f in res["nearby"]["voucher_facilities"]:
        assert f["subsidy"] == 105000
        if f["fee_month"] is not None:
            assert f["copay"] == max(0, f["fee_month"] - f["subsidy"])
        else:
            assert f["copay"] is None


def test_copay_never_negative(store):
    # 성북 voucher 강좌 최저 수강료(V02 청소년 수영 110000 등) - subsidy 105000 -> 0 이상
    res = assess(store, _body(14, "기초생활수급"))
    for f in res["nearby"]["voucher_facilities"]:
        assert f["copay"] is None or f["copay"] >= 0


# --- ✗ 자부담 수학 (결정 1A): 비적격이면 지원금 0 · 자부담 = 수강료 -----------
def test_copay_ineligible_gets_no_subsidy(store):
    # P2(27세·그외): svoucher 연령·소득 미달 → 받지 못할 지원금을 차감하면 거짓 금액(P-1)
    res = assess(store, _body(27, "그외"))
    assert _card(res)["eligible"] is False
    facs = res["nearby"]["voucher_facilities"]
    assert facs, "성북 voucher 가맹시설 fixtures 비어있음"
    for f in facs:
        assert f["subsidy"] == 0
        assert f["copay"] == f["fee_month"]  # None 이면 None 그대로


def test_nearby_primary_follows_eligibility(store):
    # ⚠#10: ✗ 판정 사용자에게 가맹시설을 1순위로 내보내지 않는다
    assert assess(store, _body(27, "그외"))["nearby"]["primary"] == "alternatives"
    # P1(10세·기초생활수급): 자격 ✓ → 가맹시설이 1순위
    assert assess(store, _body(10, "기초생활수급"))["nearby"]["primary"] == "voucher"


def test_voucher_rows_carry_source(store):
    # OV3: 장애인 가맹 배지·FR-10 접근성 블록의 원천 필드
    for body, expected in ((_body(10, "기초생활수급"), "voucher"),
                           (_body(14, "차상위", {"has": True, "type": "지체"}), "dvoucher")):
        for f in assess(store, body)["nearby"]["voucher_facilities"]:
            assert f["source"] == expected
