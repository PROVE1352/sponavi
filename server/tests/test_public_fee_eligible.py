"""조례 감면(공공체육시설 사용료)은 이용권 자격과 무관 — 응답 최상위 `public_fee` (2026-09-28).

이전에는 `public_program` 대체경로 엣지에만 감면 블록이 붙어, 이용권 자격 ✓ 사용자는 구립 체육센터
감면을 전혀 못 봤다(노원 14세 한부모 20%, 대구 북구 12세 청소년 50%). 최상위 블록은 엣지 블록과
같은 매칭 함수를 쓰므로 둘의 내용은 같아야 한다.
"""
import json
from pathlib import Path

import pytest

from app.engine import _public_fee_block, assess
from app.personas import PERSONAS

CONTRACT = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks" / "contract" / "public_fee.json"

_BLOCK_KEYS = ("region", "law", "operator", "scope", "checked", "reductions", "no_reduction_for", "caveats")


def _person(age, income, special=(), disability=False):
    return {"age": age, "income_class": income, "special": list(special), "disability_has": disability}


def test_nowon_14_single_parent_eligible_still_gets_20pct(store):
    body = {
        "age": 14, "sex": "F", "sigungu_cd": "11350", "sigungu_nm": "노원구",
        "income_class": "한부모", "disability": {"has": False, "type": None},
    }
    res = assess(store, body)
    assert res["eligibility"][0]["eligible"] is True
    # 자격 ✓ → 대체경로에는 public_program 이 없다(그래서 최상위 블록이 필요했다)
    assert all(e["to"] != "public_program" for e in res["alt_edges"])
    pf = res["public_fee"]
    assert pf is not None
    assert pf["region"]["sigungu_nm"] == "노원구"
    sp = [r for r in pf["reductions"] if r["target"] == "single_parent"]
    assert sp and sp[0]["rate"] == "20%"


def test_daegu_bukgu_12_near_poor_gets_youth_50pct(store):
    # 대구 북구는 fixtures(서울 25구)에 좌표가 없어 assess 대신 블록 함수를 직접 본다(같은 함수).
    region = store.public_fee_region("27230")
    assert region is not None, "data/public_fee_reductions.json 에 대구 북구가 없다"
    pf = _public_fee_block(region, _person(12, "차상위"), checked=store.public_fees.get("checked"))
    youth = [r for r in pf["reductions"] if r["target"] == "youth"]
    assert youth and all(r["rate"] == "50%" for r in youth)
    assert "차상위 전용 감면 없음(조례 확인)" in pf["no_reduction_for"]


def test_daegu_bukgu_assess_carries_public_fee(db_store):
    if db_store is None:
        pytest.skip("data/sponavi.db 없음")
    body = {
        "age": 12, "sex": "M", "sigungu_cd": "27230", "sigungu_nm": "북구",
        "income_class": "차상위", "disability": {"has": False, "type": None},
    }
    res = assess(db_store, body)
    assert res["eligibility"][0]["eligible"] is True
    assert [r["rate"] for r in res["public_fee"]["reductions"] if r["target"] == "youth"][:1] == ["50%"]


def test_uncovered_region_public_fee_is_null(store):
    # 강남구는 조례 원문 미확인 — 없는 감면을 만들지 않는다(P-1).
    body = {
        "age": 14, "sex": "F", "sigungu_cd": "11680", "sigungu_nm": "강남구",
        "income_class": "한부모", "disability": {"has": False, "type": None},
    }
    assert assess(store, body)["public_fee"] is None


@pytest.mark.parametrize("pid", ["P2", "P5"])
def test_top_level_block_equals_alt_edge_block(store, pid):
    """자격 ✗(또는 저순위)라 public_program 엣지가 있을 때, 최상위 블록 = 엣지 블록."""
    body = next(p["body"] for p in PERSONAS if p["id"] == pid)
    res = assess(store, body)
    edge = next(e for e in res["alt_edges"] if e["to"] == "public_program")
    for k in _BLOCK_KEYS:
        assert res["public_fee"][k] == edge[k], f"{pid}.{k}"


def test_contract_eligible_cases_match_server(store):
    if not CONTRACT.exists():
        pytest.skip("웹 계약 JSON 없음")
    cases = json.loads(CONTRACT.read_text(encoding="utf-8")).get("eligible_cases", {})
    cases = {k: v for k, v in cases.items() if not k.startswith("_")}
    assert cases, "eligible_cases 가 비었다"
    for name, case in cases.items():
        res = assess(store, case["body"])
        assert res["public_fee"] == case["expected_public_fee"], name
        assert [e["to"] for e in res["alt_edges"]] == case["expected_alt_edge_tos"], name
