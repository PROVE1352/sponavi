"""공공체육시설 사용료 감면(시군구 조례 원문 확인분) → public_program 대체경로 승격.

원천: data/public_fee_reductions.json (성북 11290 · 송파 11710 · 노원 11350 · 대구 북구 27230 ·
강원 고성 51820). 조례 확인 지역에서만 '공식 확인(조례 …)'이 되고, 이 사람에게 맞는 감면만
`reductions` 로 붙는다. 나머지 지역은 '검증 대기' 그대로(P-1). 히어로 N 은 공식 확인 엣지 수.
"""
from app import store as store_mod
from app.engine import assess

SEONGBUK, SONGPA, NOWON, GANGNAM = "11290", "11710", "11350", "11680"
DAEGU_BUK, GOSEONG = "27230", "51820"
# fixtures(서울 25구)에는 대구 북구·고성군 중심좌표가 없다 — 좌표를 같이 준다(실DB sigungu 값).
LOC = {
    DAEGU_BUK: {"lat": 35.9241, "lon": 128.5629},
    GOSEONG: {"lat": 38.3502, "lon": 128.4803},
}


def _body(age, income="그외", sigungu=SEONGBUK, special=None, disability=None):
    return {
        "age": age, "sex": "M",
        "sigungu_cd": sigungu, "sigungu_nm": "",
        "income_class": income,
        "disability": disability or {"has": False, "type": None},
        "location": LOC.get(sigungu),
        "special": special or [],
    }


def _dis(age, income="그외", sigungu=SEONGBUK):
    return _body(age, income, sigungu, disability={"has": True, "type": "지체"})


def _pp(res):
    return next((e for e in res["alt_edges"] if e["to"] == "public_program"), None)


def _targets_rates(edge):
    return [(r["target"], r["rate"]) for r in edge["reductions"]]


def _hero_n(res):
    """web altRouteItems 와 같은 규칙: '공식 확인' 으로 시작하는 엣지 수(상위 3)."""
    return len([e for e in res["alt_edges"] if e["curated"].startswith("공식 확인")][:3])


# ---------------------------------------------------------------------------
# svoucher ✗ (비장애) 경로
# ---------------------------------------------------------------------------
def test_16_seongbuk_youth_20_with_age_caveat(store):
    res = assess(store, _body(16))
    assert res["eligibility"][0]["eligible"] is False  # 소득 사유 ✗
    pp = _pp(res)
    assert pp["curated"] == "공식 확인(조례 2026-09-17)"
    assert _targets_rates(pp) == [("youth", "20%")]
    youth = pp["reductions"][0]
    # 성북 조례엔 청소년 나이 정의가 없다 → 포함하되 caveat 동반
    assert "나이 기준이 조례에 없음" in youth["caveat"]
    assert youth["quote"].startswith("4. 100분의 20")
    assert youth["source_url"].startswith("https://www.law.go.kr/")
    assert any("나이 기준" in c for c in pp["caveats"])
    # 다둥이 주의문은 다자녀 미선언자에게 붙지 않는다
    assert not any("다둥이" in c for c in pp["caveats"])
    assert pp["law"]["title"].startswith("서울특별시 성북구 체육시설")
    assert pp["law"]["article"].startswith("제10조")
    assert pp["law"]["url"] == "https://www.law.go.kr/ordinInfoP.do?ordinSeq=2168525"
    assert pp["region"]["sigungu_nm"] == "성북구"
    assert pp["operator"]["name"].startswith("성북구도시관리공단")
    assert pp["scope"]
    assert pp["no_reduction_for"] == []


def test_16_multichild_seongbuk_youth_and_multichild(store):
    pp = _pp(assess(store, _body(16, special=["multichild"])))
    assert pp["curated"].startswith("공식 확인(조례")
    # 3자녀(50%) 행만 — '2자녀 이상 30%' 는 상위집합이라 싣지 않는다
    assert _targets_rates(pp) == [("youth", "20%"), ("multichild", "50%")]
    mc = pp["reductions"][1]
    assert "3자녀" in mc["label"]
    assert "다둥이행복카드" in mc["caveat"]            # 서울 카드 기준 미검증
    assert any("다둥이" in c for c in pp["caveats"])
    assert any("중복 감면" in c for c in pp["caveats"])  # 성북: 중복 규정 없음(unverified)


def test_20_single_parent_gap_vs_songpa(store):
    # 20세 한부모: svoucher 연령 ✗. 성북은 한부모 조항 없음 → 정직한 공백.
    pp = _pp(assess(store, _body(20, "한부모")))
    assert pp["reductions"] == []
    assert pp["no_reduction_for"] == ["한부모 감면 없음(조례 확인)"]
    # 송파는 한부모가족 보호대상자 50%
    pp = _pp(assess(store, _body(20, "한부모", SONGPA)))
    assert _targets_rates(pp) == [("single_parent", "50%")]
    assert pp["no_reduction_for"] == []


def test_songpa_youth_uses_ordinance_age_definition(store):
    # 송파: '청소년 18세 이하' — 17세 포함(svoucher ✗ 는 소득 사유)
    pp = _pp(assess(store, _body(17, sigungu=SONGPA)))
    assert [r["target"] for r in pp["reductions"]] == ["youth"]
    assert "caveat" not in pp["reductions"][0]            # 나이 정의가 조례에 있다
    assert pp["reductions"][0]["age_definition"].startswith("영유아")


def test_daegu_buk_near_poor_adult_gap(store):
    # 25세 차상위: svoucher 연령 ✗ → public_program. 대구 북구엔 차상위 조항 없음.
    res = assess(store, _body(25, "차상위", DAEGU_BUK))
    pp = _pp(res)
    assert pp["curated"] == "공식 확인(조례 2026-01-01)"
    assert pp["reductions"] == []            # near_poor 는 데이터에 없으면 아무것도 내지 않는다
    assert pp["no_reduction_for"] == ["차상위 전용 감면 없음(조례 확인)"]


def test_daegu_buk_youth_50_and_age_window(store):
    pp = _pp(assess(store, _body(14, sigungu=DAEGU_BUK)))
    assert ("youth", "50%") in _targets_rates(pp)
    assert all(r["target"] == "youth" for r in pp["reductions"])
    # 같은 대상(youth) 두 행은 '둘 이상 사유' 가 아니다 → 중복 불가 문구 없음
    assert not any("가장 높은 감면율" in c for c in pp["caveats"])
    # 조례 정의 5~18세 — 4세는 청소년·어린이 감면 대상이 아니다
    pp4 = _pp(assess(store, _body(4, sigungu=DAEGU_BUK)))
    assert pp4 is not None and pp4["reductions"] == []


def test_goseong_child_falls_back_to_region_age_definition(store):
    # 10세 그외: 고성 '청소년 30% / 어린이 50%'(7~18) + 볼링센터 학생(정의 없음 → 지역 정의 폴백)
    pp = _pp(assess(store, _body(10, sigungu=GOSEONG)))
    labels = [r["label"] for r in pp["reductions"]]
    assert labels == ["청소년 30% / 어린이 50%", "볼링센터 학생"]
    assert pp["curated"] == "공식 확인(조례 2025-11-21)"
    # 고성은 다자녀 조항이 없다
    pp = _pp(assess(store, _body(10, sigungu=GOSEONG, special=["multichild"])))
    assert pp["no_reduction_for"] == ["다자녀 감면 없음(조례 확인)"]


def test_defector_declared_gap(store):
    pp = _pp(assess(store, _body(16, special=["defector"])))
    assert "북한이탈주민 감면 없음(조례 확인)" in pp["no_reduction_for"]
    assert "defector" not in {r["target"] for r in pp["reductions"]}


# ---------------------------------------------------------------------------
# dvoucher 경로 — 연령 초과(✗) · 자격 ✓ 저순위(지금 바로 되는 것)
# ---------------------------------------------------------------------------
def test_p4_goseong_dvoucher_age_over_disability_50(store):
    res = assess(store, _body(72, sigungu=GOSEONG, disability={"has": True, "type": "청각"}))
    pp = _pp(res)
    assert pp["curated"].startswith("공식 확인(조례")
    assert _targets_rates(pp) == [("disability", "50%")]
    # 병합 셀 주의문(수급자·한부모·장애인 50%)은 장애인 감면이 붙었으니 싣는다
    assert any("병합 셀" in c for c in pp["caveats"])
    assert _hero_n(res) == 3


def test_p5_seongbuk_low_rank_now_available_includes_public_program(store):
    res = assess(store, _dis(32))
    assert res["eligibility"][0]["eligible"] is True
    pp = _pp(res)
    assert pp["curated"].startswith("공식 확인(조례")
    assert _targets_rates(pp) == [("disability", "50%")]
    assert [e["to"] for e in res["alt_edges"]] == ["public_program", "tteuntteun", "culture_deduction"]
    assert _hero_n(res) == 3


def test_75_near_poor_disabled_nowon(store):
    pp = _pp(assess(store, _dis(75, "차상위", NOWON)))
    assert _targets_rates(pp) == [("disability", "50% (동행 보호자 1명 전액 면제)")]
    assert pp["no_reduction_for"] == ["차상위 전용 감면 없음(조례 확인)"]


# ---------------------------------------------------------------------------
# 미확인 지역 · 히어로 N · 별칭 · 경로
# ---------------------------------------------------------------------------
def test_uncovered_region_stays_pending(store):
    res = assess(store, _body(16, sigungu=GANGNAM))
    pp = _pp(res)
    assert pp["curated"] == "검증 대기"
    for k in ("reductions", "no_reduction_for", "law", "caveats"):
        assert k not in pp
    assert _hero_n(res) == 1  # 튼튼머니만(16세 → 문화비 소득공제 제외)


def test_hero_n_counts_verified_public_program_unique(store):
    covered = assess(store, _body(27))
    uncovered = assess(store, _body(27, sigungu=GANGNAM))
    for res in (covered, uncovered):
        tos = [e["to"] for e in res["alt_edges"]]
        assert len(tos) == len(set(tos))
    assert _hero_n(covered) == 3
    assert _hero_n(uncovered) == 2


def test_alias_code_resolves_to_covered_region():
    st = store_mod.build_store()
    st._sigungu_alias = {"42820": GOSEONG}          # 강원 42→51 전환기 입력
    assert st.public_fee_region("42820")["sigungu_nm"] == "고성군"
    assert st.public_fee_region(GANGNAM) is None
    assert st.public_fee_region(None) is None


def test_missing_file_means_all_pending(store):
    st = store_mod.build_store()
    st.set_public_fees(None)
    pp = _pp(assess(st, _body(16)))
    assert pp["curated"] == "검증 대기" and "reductions" not in pp


def test_path_never_links_non_place_program_to_facility(store):
    bodies = [
        _body(27, sigungu=GANGNAM), _body(16, sigungu=GANGNAM), _body(27),
        _body(3), _dis(72, sigungu=GANGNAM), _dis(72),
    ]
    for b in bodies:
        path = assess(store, b)["path"]
        alt = [p for p in path if p["edge"] == "대체경로"]
        fac = [p for p in path if p["to"].startswith("facility:")]
        if alt and alt[0]["to"] != "public_program":
            assert not fac, f"{alt[0]['to']} 뒤에 시설 홉이 붙었다: {fac}"
        for f in fac:
            if alt:
                assert f["from"] == "public_program"
