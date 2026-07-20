"""약점 판정 (SPEC §3, API POST /api/fitness)."""
from app.fitness import assess_fitness


def test_flexibility_weakness_demo_basis(store):
    # API.md 예시: 27M flex_cm=-3 -> 유연성 하위
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
