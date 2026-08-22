"""파생 측정항목 (FR-07 AC8) — 키·몸무게 → BMI 서버 계산.

QA 실사용 피드백: 사용자는 자기 BMI 를 모른다. 폼은 키·몸무게를 받고 서버가 결정론으로 계산한다(P-2).
"""
import pytest

from app.fitness import DERIVED_ITEMS, derive_measures, assess_fitness


def test_bmi_is_derived_from_height_weight():
    out, derived = derive_measures({"height_cm": 170, "weight_kg": 70})
    assert out["bmi"] == 24.2                      # 70 / 1.70² = 24.22 → 1자리
    assert derived == [{"code": "bmi", "value": 24.2,
                        "from": {"height_cm": 170.0, "weight_kg": 70.0},
                        "formula": "몸무게(kg) ÷ 키(m)²"}]
    assert out["height_cm"] == 170                 # 원본 입력은 보존(판정엔 쓰이지 않음)


def test_direct_bmi_wins_over_derived():
    out, derived = derive_measures({"bmi": 30, "height_cm": 170, "weight_kg": 70})
    assert out["bmi"] == 30 and derived == []


@pytest.mark.parametrize("m", [
    {"height_cm": 170},                            # 몸무게 없음
    {"weight_kg": 70},                             # 키 없음
    {"height_cm": 17, "weight_kg": 70},            # 키 범위 밖(오타)
    {"height_cm": 170, "weight_kg": 700},          # 몸무게 범위 밖
    {"height_cm": "abc", "weight_kg": 70},         # 숫자 아님
    {"height_cm": None, "weight_kg": 70},
])
def test_no_derivation_when_inputs_missing_or_out_of_range(m):
    out, derived = derive_measures(m)
    assert "bmi" not in out and derived == []


def test_string_numbers_are_accepted():
    out, _ = derive_measures({"height_cm": "170", "weight_kg": "70"})
    assert out["bmi"] == 24.2


def test_assess_response_carries_derived(store):
    res = assess_fitness(store, {"age": 27, "sex": "M",
                                 "measures": {"height_cm": 170, "weight_kg": 70}})
    assert res["derived"][0]["code"] == "bmi" and res["derived"][0]["value"] == 24.2


def _need(db_store):
    if db_store is None:
        pytest.skip("공식 기준(data/sponavi.db) 필요")


def test_items_catalog_marks_bmi_as_derived(client, db_store):
    _need(db_store)
    items = client.get("/api/fitness/items?age=30").json()["items"]
    bmi = next(i for i in items if i["code"] == "bmi")
    assert [d["code"] for d in bmi["derived_from"]] == ["height_cm", "weight_kg"]
    assert bmi["formula"] == DERIVED_ITEMS["bmi"]["formula"]
    assert "자동 계산" in bmi["hint"]
    # 파생 아닌 항목엔 derived_from 이 없다
    assert "derived_from" not in next(i for i in items if i["code"] != "bmi")


def test_official_bmi_judged_from_height_weight(client, db_store):
    _need(db_store)
    ok = client.post("/api/fitness", json={"age": 30, "sex": "M",
                                           "measures": {"height_cm": 170, "weight_kg": 70}}).json()
    bmi = next(i for i in ok["items"] if i["code"] == "bmi")
    assert bmi["value"] == 24.2 and "건강범위" in bmi["band"]
    assert ok["derived"][0]["value"] == 24.2
    bad = client.post("/api/fitness", json={"age": 30, "sex": "M",
                                            "measures": {"height_cm": 170, "weight_kg": 90}}).json()
    bmi2 = next(i for i in bad["items"] if i["code"] == "bmi")
    assert bmi2["value"] == 31.1 and bmi2["band"] == "기준 미달"
    assert "31.1" in bmi2["comparison"]
    assert any(w["item"] == "신체조성" for w in bad["weaknesses"])
