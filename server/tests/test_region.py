"""지역 코드 정규화 (WP1). 순수 표 검증 + 전국 DB 회귀.

배경: 2026-07-01 전남광주통합특별시(12) 출범으로 광주(29)·전남(46) 코드가, 그리고
강원(42→51)·전북(45→52) 재코딩으로 구·신 코드가 원천 API 에 섞여 들어온다. 축이
갈라진 상태에서는 "광주 북구(29170)에 장애인이용권 가맹 0곳" 같은 **거짓 공급공백**이
뜬다(P-1 위반). 여기 테스트는 그 축이 하나로 접혀 있는지를 지킨다.
"""
import pytest

from app import region


# ---------------------------------------------------------------------------
# ① 표 자체 (DB 없이)
# ---------------------------------------------------------------------------
def test_legacy_sido_table():
    assert region.canonical_sido("29170") == "12"
    assert region.canonical_sido("46110") == "12"
    assert region.canonical_sido("42110") == "51"
    assert region.canonical_sido("45110") == "52"
    assert region.canonical_sido("11290") == "11"  # 현행 코드는 그대로
    assert region.canonical_sido(None) is None


def test_legacy_sido_names_resolve_to_current_code():
    # 사용자가 개편 전 이름으로 말해도 현행 시도로 간다
    for nm in ("광주", "광주광역시", "전남", "전라남도", "전남광주통합특별시"):
        assert region.sido_cd_from_name(nm) == "12"
    assert region.sido_cd_from_name("강원도") == "51"
    assert region.sido_cd_from_name("전라북도") == "52"
    assert region.sido_cd_from_name("인천광역시") == "28"
    assert region.sido_cd_from_name("없는도") is None  # 지어내지 않는다
    # 폐지된 시도 접두는 표에 남지 않는다(사용자에게 노출될 라벨의 원천)
    assert not ({"29", "46", "42", "45"} & set(region.SIDO_NAMES))


def test_crosswalk_is_derived_from_names_not_guessed():
    master = {
        "29170": "북구", "46110": "목포시", "46230": "광양시",
        "12300": "북구", "12110": "목포시", "12190": "광양시",
        "42110": "춘천시", "51110": "춘천시",
        "45110": "전주시", "52110": "전주시",
    }
    alias, unresolved = region.build_crosswalk(master)
    assert unresolved == []
    assert alias["29170"] == "12300"
    assert alias["46110"] == "12110"
    # 통합은 코드 뒷자리가 보존되지 않는다 — 이름으로만 도출된다(46230 → 12190)
    assert alias["46230"] == "12190"
    # 재코딩은 뒷 3자리 보존
    assert alias["42110"] == "51110"
    assert alias["45110"] == "52110"


def test_crosswalk_refuses_to_guess_when_name_is_ambiguous_or_missing():
    # 통합 대상 시도에 같은 이름이 둘 → 추측하지 않고 unresolved
    alias, unresolved = region.build_crosswalk(
        {"29170": "북구", "12300": "북구", "12777": "북구"}
    )
    assert "29170" not in alias
    assert [u["cd"] for u in unresolved] == ["29170"]
    # 대응 코드가 아예 없어도 unresolved
    alias, unresolved = region.build_crosswalk({"46110": "목포시"})
    assert alias == {}
    assert unresolved and unresolved[0]["cd"] == "46110"
    # 재코딩인데 이름이 다르면 매핑하지 않는다
    alias, unresolved = region.build_crosswalk({"42110": "춘천시", "51110": "원주시"})
    assert alias == {}
    assert unresolved and unresolved[0]["cd"] == "42110"


def test_canonicalize_master_keeps_unresolved_codes():
    canonical, alias, unresolved = region.canonicalize_master(
        {"29170": "북구", "12300": "북구", "46110": "목포시"}
    )
    assert alias == {"29170": "12300"}
    assert "29170" not in canonical          # 해소된 구 코드는 마스터에서 빠지고
    assert "46110" in canonical              # 못 옮긴 구 코드는 시설을 잃지 않게 남긴다
    assert [u["cd"] for u in unresolved] == ["46110"]


def test_resolve_sigungu_fallback_ladder():
    # 36 의 이름은 마스터 표기 그대로 '세종시' — 주소의 '세종특별자치시'와 다르다
    index = {"28": {"미추홀구": "28170", "서구": "28260"}, "36": {"세종시": "36110"}}
    sole = region.sole_sigungu(index)
    # ① 이름 대조
    assert region.resolve_sigungu(["28"], ["서구"], None, index, sole)[0] == "28260"
    # ② 개칭 별칭 — 폐지된 '인천 남구'는 미추홀구로
    cd, _, how = region.resolve_sigungu(["28"], ["남구"], None, index, sole)
    assert (cd, how) == ("28170", "rename")
    # ③ 주소 앞 2토큰(정확 일치만)
    cd, _, how = region.resolve_sigungu(
        ["28"], [], "인천광역시 서구 가좌로11번길 7 (가좌동)", index, sole
    )
    assert (cd, how) == ("28260", "addr")
    # 3번째 토큰(도로명)은 보지 않는다 — 우연 일치 방지
    assert region.resolve_sigungu(["28"], [], "인천광역시 부평구 서구로 1", index, sole)[0] != "28260"
    # ④ 시군구가 1곳뿐인 시도
    cd, _, how = region.resolve_sigungu(["36"], [], "세종특별자치시 조치원읍 행복1길 3", index, sole)
    assert (cd, how) == ("36110", "sole")
    # 근거가 없으면 None — 지어내지 않는다
    assert region.resolve_sigungu(["28"], ["없는구"], "없는시 없는로 1", index, sole)[0] is None


# ---------------------------------------------------------------------------
# ② 전국 DB 회귀 (data/sponavi.db 있을 때만)
# ---------------------------------------------------------------------------
def _need_db(db_store):
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 없음 — 지역 정규화 회귀는 DB 필요")


def test_db_has_no_legacy_sigungu_codes(db_store):
    _need_db(db_store)
    bad = db_store.conn.execute(
        "SELECT COUNT(*) FROM facilities "
        "WHERE substr(sigungu_cd,1,2) IN ('29','46','42','45')"
    ).fetchone()[0]
    assert bad == 0
    bad_master = db_store.conn.execute(
        "SELECT COUNT(*) FROM sigungu WHERE substr(cd,1,2) IN ('29','46','42','45')"
    ).fetchone()[0]
    assert bad_master == 0


def test_gwangju_bukgu_no_false_supply_gap(db_store):
    """★ 회귀 원점: 광주 북구는 dvoucher 가맹이 실재한다 — 구코드로 물어도 마찬가지."""
    _need_db(db_store)
    from app.engine import assess

    assert db_store.canonical_sigungu("29170") == "12300"  # 구 코드 → 현행
    n = db_store.count_facilities_in_sigungu("dvoucher", "12300")
    assert n > 0, "광주 북구 dvoucher 가맹 0 — 코드 축이 다시 갈라졌다"

    body = {
        "age": 14, "sex": "F", "income_class": "차상위",
        "disability": {"has": True, "type": "지체"},
    }
    for cd in ("12300", "29170"):  # 현행 코드 · 구 코드 둘 다 같은 결과여야 한다
        res = assess(db_store, dict(body, sigungu_cd=cd, sigungu_nm="북구"))
        gap = res["supply_gap"]
        assert gap["voucher_count"] == n
        assert gap["sigungu_nm"] == "북구"
        assert "없습니다" not in gap["message"]  # 거짓 공급공백 배너 금지


def test_meta_sigungu_covers_merged_and_recoded_sido(db_store):
    _need_db(db_store)
    rows = db_store.all_centroids()
    by_sido: dict[str, int] = {}
    for r in rows:
        by_sido[r["cd"][:2]] = by_sido.get(r["cd"][:2], 0) + 1
    # 통합 시도(12) = 광주 자치구 5 + 전남 시군 22
    assert by_sido.get("12") == 27
    assert by_sido.get("51", 0) >= 18   # 강원특별자치도
    assert by_sido.get("52", 0) >= 14   # 전북특별자치도
    assert by_sido.get("28", 0) >= 14   # 인천
    assert by_sido.get("11") == 25      # 서울 시드
    assert not ({"29", "46", "42", "45"} & set(by_sido))
    for r in rows:
        assert r["nm"] and r["lat"] is not None and r["lon"] is not None


def test_sigungu_alias_table_loaded(db_store):
    _need_db(db_store)
    n = db_store.conn.execute("SELECT COUNT(*) FROM sigungu_alias").fetchone()[0]
    assert n >= 45, "구→현행 시군구 별칭이 비어 있다(적재 누락)"
    # 별칭이 가리키는 현행 코드는 반드시 마스터에 있어야 한다
    dangling = db_store.conn.execute(
        "SELECT COUNT(*) FROM sigungu_alias a "
        "LEFT JOIN sigungu s ON a.new_cd = s.cd WHERE s.cd IS NULL"
    ).fetchone()[0]
    assert dangling == 0


def test_public_facilities_sigungu_resolved(db_store):
    """개칭·폐지 지명(인천 남구 등)으로 미매칭이던 964건이 해소됐는가."""
    _need_db(db_store)
    n_null = db_store.conn.execute(
        "SELECT COUNT(*) FROM facilities WHERE sigungu_cd IS NULL"
    ).fetchone()[0]
    assert n_null == 0, f"시군구 미매칭 시설 {n_null}건 잔존"
    # 인천 남구 → 미추홀구(28170) 로 흡수됐다
    n_michu = db_store.count_facilities_in_sigungu("public", "28170")
    assert n_michu >= 700
    # 폐지된 지명이 화면 라벨로 남지 않는다
    stale = db_store.conn.execute(
        "SELECT COUNT(*) FROM facilities WHERE sido_cd='28' AND sigungu_nm='남구'"
    ).fetchone()[0]
    assert stale == 0


def test_persona_p4_region_is_incheon_seogu(db_store):
    """PRD ★FR-P4: P4 데모 지역 = 인천 서구(28260)."""
    from app.personas import PERSONAS

    p4 = {p["id"]: p for p in PERSONAS}["P4"]
    assert p4["body"]["sigungu_cd"] == "28260"
    assert p4["body"]["sigungu_nm"] == "서구"
    _need_db(db_store)
    c = db_store.centroid("28260")
    assert c and c["nm"] == "서구"
