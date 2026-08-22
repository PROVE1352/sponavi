"""약점 판정 — 데모 폴백 경로 (SPEC §3, API POST /api/fitness).

`store` fixture 는 fixtures 기반 인메모리 DB(공식 measurement_item/fitness_norm 없음)
이므로 fitness.py 는 데모 근사 컷으로 폴백한다. 이 파일은 그 무중단 폴백 계약을 검증한다.
(공식 인증기준 경로는 test_fitness_official.py 가 data/sponavi.db 로 검증.)
"""
from app.fitness import _with_unit, assess_fitness


def test_store_fixture_is_fallback_path(store):
    # 데모 폴백 전제: 이 스토어에는 공식 norm 테이블이 없다.
    assert store.has_fitness_norms() is False


def test_flexibility_weakness_demo_basis(store):
    # API.md 예시: 27M flex_cm=-3 -> 유연성 하위 (데모 폴백)
    res = assess_fitness(store, {
        "age": 27, "sex": "M",
        "measures": {"grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25},
    })
    items = {w["item"]: w for w in res["weaknesses"]}
    assert "유연성" in items
    assert items["유연성"]["value"] == -3
    assert items["유연성"]["band"] == "하위"
    assert "데모" in items["유연성"]["basis"]


def test_recommendations_and_filter_sports(store):
    res = assess_fitness(store, {
        "age": 27, "sex": "M",
        "measures": {"grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25},
    })
    weak_items = {r["weakness"] for r in res["recommendations"]}
    assert "유연성" in weak_items
    for r in res["recommendations"]:
        assert r["curated"] == "체대 검증 대기"
        assert isinstance(r["sports"], list)
    # facility_filter_sports = 추천 종목 합집합
    assert res["facility_filter_sports"]
    assert set(res["facility_filter_sports"]) & {"요가", "필라테스", "수영", "헬스"}


def test_strong_value_not_weakness(store):
    # 악력 매우 높음 -> 근력 약점 아님
    res = assess_fitness(store, {
        "age": 27, "sex": "M", "measures": {"grip_kg": 60},
    })
    assert all(w["item"] != "근력" for w in res["weaknesses"])


def test_null_measures_skipped(store):
    res = assess_fitness(store, {
        "age": 27, "sex": "M",
        "measures": {"grip_kg": None, "situp_cnt": None, "flex_cm": None, "shuttle_cnt": None},
    })
    assert res["weaknesses"] == []
    assert res["recommendations"] == []
    assert res["facility_filter_sports"] == []


def test_videos_labeled_and_filtered(store):
    res = assess_fitness(store, {
        "age": 27, "sex": "M", "measures": {"flex_cm": -3},
    })
    # 유연성 약점 -> 유연성 동영상 포함, 각 동영상은 출처 표기
    assert any("유연성" in (v["title"] or "") for v in res["videos"])
    for v in res["videos"]:
        assert v["source"]


# ---------------------------------------------------------------------------
# 단위 결합 표기 (_with_unit) — '기간/단위' 형식 단위의 값 뭉개짐 회귀
#   chair_stand 단위는 '30초/회'(30초 동안 몇 회). 그대로 이어붙이면 '1430초/회'.
# ---------------------------------------------------------------------------
def test_with_unit_period_unit_is_unpacked():
    assert _with_unit(14, "30초/회") == "14회(30초)"
    assert _with_unit(15.0, "30초/회") == "15회(30초)"      # 정수형 float 소수점 제거
    assert _with_unit(12, "60초/회") == "12회(60초)"


def test_with_unit_plain_units_unchanged():
    # 기존 비교문 형식 보존(공백 없이 붙임) — API.md 예시 문자열과 동치
    assert _with_unit(38, "회") == "38회"
    assert _with_unit(-3, "cm") == "-3cm"
    assert _with_unit(12.5, "초") == "12.5초"
    assert _with_unit(31, "㎏/㎡") == "31㎏/㎡"        # 슬래시가 있어도 기간이 아니면 그대로
    assert _with_unit(45.2, "ml/kg/min") == "45.2ml/kg/min"
    assert _with_unit(28, None) == "28"
    assert _with_unit(28, "") == "28"
