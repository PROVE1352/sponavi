"""2027 예산안 확대 대상(next_year) + 대체경로 연령 게이트.

- next_year 는 svoucher 카드가 2026 기준 **소득 사유 하나로만** ✗ 일 때만 붙는다.
  2026 판정(eligible)을 바꾸지 않고, alt_edges(히어로 N)에도 들어가지 않는다.
- 인구감소지역 대조는 data/depopulation_regions.json 을 쓰지만, 이 파일은 다른 레인이
  만든다 — 여기서는 **테스트 전용 픽스처**를 주입해 로직만 검증한다(가짜 데이터 파일 금지).
- 대체경로는 대상 제도 자체의 연령 범위를 통과해야 나온다(16세 → 문화비 소득공제 ✗).
"""
import pytest

from app import chat
from app import store as store_mod
from app.engine import assess

SEONGBUK = "11290"
# 강원 고성군(현행 51820). fixtures 스토어엔 서울 25 좌표뿐이라 위치는 좌표로 준다.
GOSEONG_CD = "51820"
GOSEONG_LOC = {"lat": 38.3502, "lon": 128.4803}

# 테스트 전용 — 실제 지정 목록이 아니다(스키마만 맞춘 최소 픽스처).
DEPOP_FIXTURE = {
    "basis": "테스트 픽스처",
    "count": 1,
    "sources": [{"url": "https://example.test/depop", "checked": "2026-09-23", "label": "테스트 출처"}],
    "regions": [
        {"sido": "강원특별자치도", "sigungu_nm": "고성군", "sigungu_cd": "51820",
         "alias_codes": ["42820"]},
    ],
}


@pytest.fixture()
def depop_store():
    st = store_mod.build_store()
    st.set_depopulation(DEPOP_FIXTURE)
    return st


def _body(age, income="그외", sigungu=SEONGBUK, special=None, loc=None, disability=None):
    return {
        "age": age, "sex": "M",
        "sigungu_cd": sigungu, "sigungu_nm": "",
        "income_class": income,
        "disability": disability or {"has": False, "type": None},
        "location": loc,
        "special": special or [],
    }


def _card(res):
    return res["eligibility"][0]


# --------------------------------------------------------------------------
# TASK 2 — 대체경로 연령 게이트
# --------------------------------------------------------------------------
def test_16_no_culture_deduction(store):
    res = assess(store, _body(16))
    tos = [e["to"] for e in res["alt_edges"]]
    assert "culture_deduction" not in tos
    assert "tteuntteun" in tos  # 만 4세+ 는 그대로
    hops = [p["to"] for p in res["path"] if p["edge"] == "대체경로"]
    assert "culture_deduction" not in hops


def test_27_keeps_culture_deduction(store):
    # 조례 미확인 지역: 공식 확인 2종이 앞. (성북구는 public_program 이 조례로 승격돼 맨 앞)
    tos = [e["to"] for e in assess(store, _body(27, sigungu="11680"))["alt_edges"]]
    assert tos[:2] == ["tteuntteun", "culture_deduction"]
    tos = [e["to"] for e in assess(store, _body(27))["alt_edges"]]
    assert tos == ["public_program", "tteuntteun", "culture_deduction"]


def test_culture_deduction_rule_age_and_note(store):
    p = store.program("culture_deduction")
    assert p["eligibility"]["age_min"] == 19
    assert "미성년자는 안내 대상에서 제외" in p["income_note"]


def test_under_4_gets_no_tteuntteun(store):
    """3세: 이용권 연령 ✗, 튼튼머니(만 4세+)도 대상 아님 → 공공시설만."""
    tos = [e["to"] for e in assess(store, _body(3))["alt_edges"]]
    assert "tteuntteun" not in tos
    assert tos == ["public_program"]


# --------------------------------------------------------------------------
# TASK 1 — next_year
# --------------------------------------------------------------------------
def test_16_multichild_next_year_eligible(store):
    res = assess(store, _body(16, special=["multichild"]))
    c = _card(res)
    assert c["eligible"] is False            # 2026 판정은 그대로
    ny = c["next_year"]
    assert ny["year"] == 2027
    assert ny["eligible"] is True
    assert [m["id"] for m in ny["matched"]] == ["multichild"]
    assert "북한이탈주민" in ny["possible_if"]
    assert "3자녀 이상 다자녀가구" not in ny["possible_if"]
    assert ny["age_assumed"] is True and ny["age_note"]
    assert "국회 심의 전" in ny["basis"]
    assert ny["subsidy_month"] == 105000
    assert all(s["url"] and s["checked"] for s in ny["sources"])


def test_16_plain_next_year_not_eligible_lists_all(store):
    ny = _card(assess(store, _body(16)))["next_year"]
    assert ny["eligible"] is False
    assert ny["matched"] == []
    assert len(ny["possible_if"]) == 3


def test_16_depop_region_matched(depop_store):
    res = assess(depop_store, _body(16, sigungu=GOSEONG_CD, loc=GOSEONG_LOC))
    ny = _card(res)["next_year"]
    assert ny["eligible"] is True
    m = [x for x in ny["matched"] if x["id"] == "depop_region"]
    assert m and m[0]["detail"] == "강원 고성군 — 인구감소지역"
    assert "인구감소지역 거주 유·청소년" not in ny["possible_if"]
    assert any(s["url"] == "https://example.test/depop" for s in ny["sources"])


def test_depop_matches_legacy_alias_code(depop_store):
    res = assess(depop_store, _body(16, sigungu="42820", loc=GOSEONG_LOC))
    assert [m["id"] for m in _card(res)["next_year"]["matched"]] == ["depop_region"]


def test_seoul_not_depop(depop_store):
    ny = _card(assess(depop_store, _body(16)))["next_year"]
    assert "인구감소지역 거주 유·청소년" in ny["possible_if"]


def test_real_depop_file_goseong(db_store):
    """실데이터 파일이 있으면 강원 고성군(51820)이 들어 있어야 한다(없으면 스킵)."""
    st = db_store or store_mod.build_store()
    if not st.depopulation:
        pytest.skip("data/depopulation_regions.json 없음")
    if st.depopulation_region(GOSEONG_CD) is None:
        pytest.skip("실데이터에 51820 없음")
    res = assess(st, _body(16, sigungu=GOSEONG_CD, loc=GOSEONG_LOC))
    assert "depop_region" in [m["id"] for m in _card(res)["next_year"]["matched"]]


def test_10_chasangwi_no_next_year(store):
    c = _card(assess(store, _body(10, "차상위", special=["multichild"])))
    assert c["eligible"] is True
    assert "next_year" not in c


def test_27_no_next_year(store):
    c = _card(assess(store, _body(27, special=["multichild", "defector"])))
    assert "next_year" not in c


def test_disabled_no_next_year(store):
    c = _card(assess(store, _body(16, special=["multichild"],
                                  disability={"has": True, "type": "지체"})))
    assert c["program_id"] == "dvoucher"
    assert "next_year" not in c


def test_next_year_absent_from_alt_edges(store):
    res = assess(store, _body(16, special=["multichild", "defector"]))
    for e in res["alt_edges"]:
        assert "next_year" not in e
        assert e["to"] in {p["id"] for p in store.rules["programs"]}
        assert e["to"] != "svoucher"
    assert all(p["edge"] != "next_year" for p in res["path"])


# --------------------------------------------------------------------------
# API 계약 — special 검증
# --------------------------------------------------------------------------
def test_api_special_accepted_and_validated(client):
    ok = client.post("/api/assess", json={**_body(16, special=["defector"]), "location": None})
    assert ok.status_code == 200
    ny = ok.json()["eligibility"][0]["next_year"]
    assert [m["id"] for m in ny["matched"]] == ["defector"]
    bad = client.post("/api/assess", json={**_body(16), "special": ["rich"]})
    assert bad.status_code in (400, 422)


def test_location_error_is_nationwide_wording(client):
    r = client.post("/api/assess", json={**_body(16, sigungu="99999")})
    assert r.status_code == 400
    assert "서울" not in r.json()["error"]["message"]


# --------------------------------------------------------------------------
# 챗 NLU — special 슬롯 (LLM 출력 + 발화 단서 확인)
# --------------------------------------------------------------------------
class _Fake:
    name = "openai"

    def __init__(self, payload):
        self.payload = payload

    def nlu(self, text, slots, phase, grounding=""):
        return dict(self.payload)


def _out(**kw):
    base = {
        "age": None, "sex": None, "region_text": None, "income_class": None,
        "disability_has": None, "disability_type": None, "special": None,
        "intent": "provide_info", "faq_key": None, "reply": None, "answer": None,
    }
    base.update(kw)
    return base


@pytest.mark.parametrize("text,llm,expected", [
    ("저희 집 세 자녀예요", ["multichild"], ["multichild"]),
    ("우리 애가 셋째예요", ["multichild"], ["multichild"]),
    ("다자녀 가구예요", ["multichild"], ["multichild"]),
    ("탈북해서 왔어요", ["defector"], ["defector"]),
    ("북한이탈주민이에요", ["defector", "bogus"], ["defector"]),
    # 발화에 단서 없음 → LLM 이 골라도 드롭(자가선언 창작 차단)
    ("애가 둘이에요", ["multichild"], None),
    ("16살이에요", ["defector"], None),
])
def test_chat_special_slot(monkeypatch, store, text, llm, expected):
    monkeypatch.setattr(chat, "get_provider", lambda: _Fake(_out(special=llm)))
    resp = chat.nlu(store, {"text": text, "slots": {}, "phase": "collect"})
    assert resp["slot_updates"].get("special") == expected


def test_chat_schema_has_special():
    schema = chat._schema()
    assert "special" in schema["properties"] and "special" in schema["required"]
    assert schema["properties"]["special"]["items"]["enum"] == ["multichild", "defector"]


def test_chat_safe_slots_whitelists_special():
    got = chat._safe_slots({"special": ["multichild", "admin", "defector"], "eligible": True})
    assert got == {"special": ["multichild", "defector"]}


def test_api_special_null_is_empty(client):
    r = client.post("/api/assess", json={**_body(16), "special": None})
    assert r.status_code == 200
    assert r.json()["eligibility"][0]["next_year"]["matched"] == []
