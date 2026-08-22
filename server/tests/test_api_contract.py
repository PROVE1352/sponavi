"""계약 형태 검증 (SPEC §7): uvicorn 대신 TestClient로 4페르소나 POST + 필드/형태 확인."""
import pytest


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200


def test_meta_sigungu_nationwide(client, db_store):
    """전국 시군구 목록(서울 25 고정이 아니다). 좌표 없는 행은 내보내지 않는다."""
    r = client.get("/api/meta/sigungu")
    assert r.status_code == 200
    rows = r.json()
    for row in rows:
        assert set(row) >= {"cd", "nm", "lat", "lon"}
        assert row["lat"] is not None and row["lon"] is not None
    codes = {row["cd"] for row in rows}
    assert "11290" in codes  # 서울 시드는 항상
    if db_store is None:
        assert len(rows) == 25  # fixtures 데모 = 서울 25
        return
    # 전국 DB: 서울 밖 시도가 실제로 들어 있고, 구 시도코드는 남아 있지 않다
    assert len(rows) > 200
    sidos = {c[:2] for c in codes}
    assert {"12", "28", "51", "52"} <= sidos
    assert not (sidos & {"29", "46", "42", "45"})


def test_personas_endpoint_p5_included(client):
    r = client.get("/api/demo/personas")
    assert r.status_code == 200
    ps = r.json()
    assert [p["id"] for p in ps] == ["P1", "P2", "P3", "P4", "P5"]
    p4 = ps[3]
    # P4 확정: 72세 청각장애(연령 초과) — dvoucher 소득무관 + 연령상한 69
    assert p4["body"]["age"] == 72
    assert p4["body"]["disability"]["has"] is True
    # P5: 32세 지체장애 비저소득(그외) — dvoucher 자격 ✓ 이나 예상 5순위
    p5 = ps[4]
    assert p5["body"]["age"] == 32
    assert p5["body"]["disability"]["has"] is True
    assert p5["body"]["income_class"] == "그외"


ELIG_KEYS = {"program_id", "program_name", "eligible", "reasons", "benefit", "apply", "source", "verified"}
FAC_KEYS = {"id", "name", "sports", "lat", "lon", "dist_km", "coord_source", "fee_month", "subsidy", "copay", "disability_support"}
ALT_KEYS = {"id", "name", "type", "sports", "lat", "lon", "dist_km", "coord_source", "note", "disability_support"}
SG_KEYS = {"radius_km", "voucher_count", "alt_count", "nearest", "message", "coverage"}


def _assert_coord_honesty(f):
    """FR-04: 실좌표(api·geocoded)만 dist_km(수치), 근사좌표(centroid)는 dist_km=None.

    geocoded = 카카오 지오코딩 실좌표(M2, 2026-08-19 데모 구 배치)."""
    assert f["coord_source"] in ("api", "centroid", "geocoded")
    if f["coord_source"] in ("api", "geocoded"):
        assert isinstance(f["dist_km"], (int, float))
    else:
        assert f["dist_km"] is None


@pytest.mark.parametrize("pid", ["P1", "P2", "P3", "P4", "P5"])
def test_assess_contract_shape_for_personas(client, personas_by_id, db_store, pid):
    body = personas_by_id[pid]["body"]
    # P4는 PRD ★FR-P4로 인천 서구(28260) — 서울 fixtures 데모에는 없는 지역이다.
    if db_store is None and not body["sigungu_cd"].startswith("11"):
        pytest.skip("전국 DB 없이 검증 불가(서울 fixtures 데모)")
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
        _assert_coord_honesty(f)
    for a in data["nearby"]["alternatives"]:
        assert ALT_KEYS <= set(a)
        _assert_coord_honesty(a)

    # supply_gap always present
    assert SG_KEYS <= set(data["supply_gap"])
    # 이용권(voucher/dvoucher)은 실좌표 아님 → 구 단위 카운트, 메시지에 "반경" 금지
    assert data["supply_gap"].get("voucher_scope") == "sigungu"
    assert "반경" not in data["supply_gap"]["message"]


def test_assess_persona_expectations(client, personas_by_id, db_store):
    # P1 자격 O
    p1 = client.post("/api/assess", json=personas_by_id["P1"]["body"]).json()
    assert p1["eligibility"][0]["eligible"] is True

    # P2 자격 X + 대체경로
    p2 = client.post("/api/assess", json=personas_by_id["P2"]["body"]).json()
    assert p2["eligibility"][0]["eligible"] is False
    assert any(h["edge"] == "대체경로" for h in p2["path"])

    # P4 자격 X (연령) — 강원 고성군(51820), 전국 DB 필요
    if db_store is None:
        pytest.skip("P4(강원 고성군)는 전국 DB 필요")
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
