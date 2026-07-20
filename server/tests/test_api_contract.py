"""계약 형태 검증 (SPEC §7): uvicorn 대신 TestClient로 4페르소나 POST + 필드/형태 확인."""
import pytest


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200


def test_meta_sigungu_25(client):
    r = client.get("/api/meta/sigungu")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 25
    for row in rows:
        assert set(row) >= {"cd", "nm", "lat", "lon"}


def test_personas_endpoint_p4_confirmed(client):
    r = client.get("/api/demo/personas")
    assert r.status_code == 200
    ps = r.json()
    assert [p["id"] for p in ps] == ["P1", "P2", "P3", "P4"]
    p4 = ps[3]
    # P4 확정: 72세 청각장애(연령 초과) — dvoucher 소득무관 + 연령상한 69
    assert p4["body"]["age"] == 72
    assert p4["body"]["disability"]["has"] is True


ELIG_KEYS = {"program_id", "program_name", "eligible", "reasons", "benefit", "apply", "source", "verified"}
FAC_KEYS = {"id", "name", "sports", "lat", "lon", "dist_km", "fee_month", "subsidy", "copay", "disability_support"}
ALT_KEYS = {"id", "name", "type", "sports", "lat", "lon", "dist_km", "note", "disability_support"}
SG_KEYS = {"radius_km", "voucher_count", "alt_count", "nearest", "message", "coverage"}


@pytest.mark.parametrize("pid", ["P1", "P2", "P3", "P4"])
def test_assess_contract_shape_for_personas(client, personas_by_id, pid):
    body = personas_by_id[pid]["body"]
    r = client.post("/api/assess", json=body)
    assert r.status_code == 200, r.text
    data = r.json()

    # top-level
    assert set(data) >= {"eligibility", "path", "nearby", "supply_gap"}

    # eligibility cards
    assert isinstance(data["eligibility"], list) and data["eligibility"]
    for card in data["eligibility"]:
        assert ELIG_KEYS <= set(card)
        assert isinstance(card["reasons"], list)
        for reason in card["reasons"]:
            assert set(reason) >= {"field", "ok", "message"}
        assert card["source"]["checked"] == "2026-07-20"

    # path is a non-empty edge array with person origin
    assert data["path"] and data["path"][0]["from"] == "person"
    for hop in data["path"]:
        assert set(hop) >= {"from", "to", "edge", "result", "label"}

    # nearby
    for f in data["nearby"]["voucher_facilities"]:
        assert FAC_KEYS <= set(f)
    for a in data["nearby"]["alternatives"]:
        assert ALT_KEYS <= set(a)

    # supply_gap always present
    assert SG_KEYS <= set(data["supply_gap"])


def test_assess_persona_expectations(client, personas_by_id):
    # P1 자격 O
    p1 = client.post("/api/assess", json=personas_by_id["P1"]["body"]).json()
    assert p1["eligibility"][0]["eligible"] is True

    # P2 자격 X + 대체경로
    p2 = client.post("/api/assess", json=personas_by_id["P2"]["body"]).json()
    assert p2["eligibility"][0]["eligible"] is False
    assert any(h["edge"] == "대체경로" for h in p2["path"])

    # P4 자격 X (연령)
    p4 = client.post("/api/assess", json=personas_by_id["P4"]["body"]).json()
    assert p4["eligibility"][0]["eligible"] is False
    assert any(r["field"] == "age" and not r["ok"] for r in p4["eligibility"][0]["reasons"])


def test_fitness_contract_shape(client):
    r = client.post("/api/fitness", json={
        "age": 27, "sex": "M",
        "measures": {"grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25},
    })
    assert r.status_code == 200
    data = r.json()
    assert set(data) >= {"weaknesses", "recommendations", "videos", "facility_filter_sports"}
    for w in data["weaknesses"]:
        assert set(w) >= {"item", "value", "band", "basis"}


def test_error_envelope_on_bad_request(client):
    # 잘못된 income_class -> {"error":{"code","message"}}
    r = client.post("/api/assess", json={"age": 10, "income_class": "부자"})
    assert r.status_code == 422
    assert set(r.json()["error"]) >= {"code", "message"}


def test_unresolvable_location_error(client):
    # 좌표 없음 + 알 수 없는 시군구 -> 계약 에러 형태
    r = client.post("/api/assess", json={
        "age": 10, "sex": "M", "sigungu_cd": "99999",
        "income_class": "기초생활수급", "disability": {"has": False},
    })
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "LOCATION_UNRESOLVED"
