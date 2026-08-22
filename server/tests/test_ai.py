"""AI 체력 처방 (ai.py + POST /api/fitness/ai) — ARCHITECTURE §6 계약 검증.

커버리지:
  ① SPONAVI_LLM 미설정 → provider="rules", 출력 스키마 유효(pydantic 검증 통과 형태)
  ② 캐시 적중: 같은 입력 2회 → 동일 응답, 계산(_compute)은 1회
  ③ 화이트리스트: LLM 처방의 슬롯 밖 운동명은 드롭
  ④ RulesFallback 은 FITT 수치사전만 인용(그래프 추천 운동으로 조립)
  ⑤ 프로바이더 선택 env 스위치
  ⑥ 처방 항목의 provenance = 슬롯(그래프) 값 — 프로바이더가 준 출처는 덮어쓴다 (FR-08 AC8)
"""
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app import ai  # noqa: E402
from app import fitness  # noqa: E402
from app import store as store_mod  # noqa: E402

WEAK_PAYLOAD = {"age": 27, "sex": "M", "measures": {"flex_cm": -3}}
# 그래프 경로(실DB) 검증용 — 심폐지구력 약점 / 신체조성(BMI) 약점
GRAPH_PAYLOAD = {"age": 30, "sex": "M", "measures": {"shuttle_20m": 30}}
BODY_PAYLOAD = {"age": 30, "sex": "M", "measures": {"bmi": 31.0}}


def _graph_db_ready(path: str) -> bool:
    """graph+norm 적재 여부 + **현행 시드로 재빌드됐는지**(신체조성 지침 엣지) 확인."""
    try:
        con = sqlite3.connect(path)
        n = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
            "AND name IN ('graph_nodes','graph_edges','fitness_norm')").fetchone()[0]
        if n != 3:
            con.close()
            return False
        fresh = con.execute(
            "SELECT COUNT(*) FROM graph_edges WHERE dst='factor:신체조성' "
            "AND rel='improves' AND source='guideline'").fetchone()[0]
        con.close()
        return fresh > 0
    except sqlite3.OperationalError:
        return False


@pytest.fixture(scope="module")
def off_store():
    """공식 규준 + 그래프가 적재된 실DB 스토어(검증 게이트 전제)."""
    db = str(store_mod.db_path())
    if not Path(db).exists() or not _graph_db_ready(db):
        pytest.skip("data/sponavi.db(graph+norm) 미적재/구버전 — "
                    "python scripts/build_graph.py 선행 필요")
    return store_mod.open_db_store(db)


def _fresh_store():
    """fixtures 인메모리 스토어(그래프 없음) — 캐시 테이블도 매번 새로 격리."""
    return store_mod.build_store()


# --------------------------------------------------------------------------
# ① 미설정 → provider=rules, 스키마 유효
# --------------------------------------------------------------------------
def test_endpoint_rules_default_and_schema(client, monkeypatch):
    monkeypatch.delenv("SPONAVI_LLM", raising=False)
    r = client.post("/api/fitness/ai", json={
        "age": 30, "sex": "M", "measures": {"shuttle_20m": 30},
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["provider"] == "rules"
    # 스키마 키 존재 (pydantic Prescription 형태)
    assert {"약점", "우선순위", "처방", "주의", "provider"} <= set(d)
    assert isinstance(d["처방"], list) and d["처방"]
    for rx in d["처방"]:
        assert {"운동", "목표체력요인", "강도", "주당빈도"} <= set(rx)
    # 약점 근거에 공식 비교문(실측 컷 인용)
    assert d["약점"] and "컷" in d["약점"][0]["근거"]
    assert "의료 조언" in d["주의"]


def test_schema_validation_helper():
    ok = ai._validate({
        "약점": [{"항목": "유연성", "등급": "하위", "근거": "x"}],
        "우선순위": ["유연성"],
        "처방": [{"운동": "요가", "목표체력요인": "유연성", "강도": "a", "주당빈도": "주3"}],
        "주의": "참고",
    })
    assert ok is not None and ok["처방"][0]["운동"] == "요가"
    # 필수 필드(항목/운동) 누락 → None
    assert ai._validate({"처방": [{"목표체력요인": "유연성"}]}) is None


# --------------------------------------------------------------------------
# ② 캐시 적중 — 동일 응답 + 계산 1회
# --------------------------------------------------------------------------
def test_cache_hit_single_compute(monkeypatch):
    monkeypatch.delenv("SPONAVI_LLM", raising=False)
    st = _fresh_store()
    calls = {"n": 0}
    orig = ai._compute

    def counting(store, payload):
        calls["n"] += 1
        return orig(store, payload)

    monkeypatch.setattr(ai, "_compute", counting)
    r1 = ai.prescribe(st, WEAK_PAYLOAD)
    r2 = ai.prescribe(st, WEAK_PAYLOAD)
    assert calls["n"] == 1, "2회 호출이지만 계산은 1회(캐시 적중)"
    assert r1 == r2
    assert r1["provider"] == "rules"


def test_cache_key_versioned_by_norm_and_graph(monkeypatch):
    st = _fresh_store()
    k1 = ai._cache_key(WEAK_PAYLOAD, st.conn)
    # 측정값이 바뀌면 키가 달라진다
    k2 = ai._cache_key({"age": 27, "sex": "M", "measures": {"flex_cm": 20}}, st.conn)
    assert k1 != k2
    # 버전 문자열이 키에 반영(그래프/규준 갱신 시 스테일 무효화)
    assert "graph" in ai._versions(st.conn)


# --------------------------------------------------------------------------
# ③ 화이트리스트 — 슬롯 밖 운동명 드롭
# --------------------------------------------------------------------------
def test_whitelist_drops_out_of_slot(monkeypatch):
    st = _fresh_store()

    class FakeClaude:
        name = "claude"

        def prescribe(self, slots):
            allowed = slots["allowed_exercises"]
            in_slot = allowed[0]
            return {
                "약점": [{"항목": "유연성", "등급": "하위", "근거": "x"}],
                "우선순위": ["유연성"],
                "처방": [
                    {"운동": in_slot, "목표체력요인": "유연성", "강도": "a", "주당빈도": "주3"},
                    {"운동": "우주유영", "목표체력요인": "유연성", "강도": "a", "주당빈도": "주3"},
                ],
                "주의": "참고",
            }

    monkeypatch.setattr(ai, "get_provider", lambda: FakeClaude())
    out = ai.prescribe(st, WEAK_PAYLOAD)
    names = [rx["운동"] for rx in out["처방"]]
    assert "우주유영" not in names, "슬롯(화이트리스트) 밖 운동은 드롭"
    assert names, "슬롯 안 운동은 유지"
    assert out["provider"] == "claude"


def test_invalid_llm_output_retries_then_falls_back(monkeypatch):
    st = _fresh_store()

    class BadClaude:
        name = "claude"

        def prescribe(self, slots):
            # 처방 항목에 필수 필드(운동) 누락 → pydantic 검증 실패
            return {"처방": [{"목표체력요인": "유연성", "강도": "a"}]}

    monkeypatch.setattr(ai, "get_provider", lambda: BadClaude())
    out = ai.prescribe(st, WEAK_PAYLOAD)
    # 검증 실패 1회 재시도 후 RulesFallback 으로 강등
    assert out["provider"] == "rules"
    assert out["처방"], "폴백 처방이 채워진다"


# --------------------------------------------------------------------------
# ④ RulesFallback — FITT 수치사전만 인용
# --------------------------------------------------------------------------
def test_rules_fallback_uses_fitt_numbers():
    fb = ai.RulesFallback()
    slots = {
        "FITT": ai.FITT["성인"],
        "약점": [{"항목": "심폐지구력", "요인": "심폐지구력", "등급": "기준 미달", "근거": "..."}],
        "추천": [{"요인": "심폐지구력", "운동": [{"운동": "걷기", "출처": "kspo_standard"}]}],
        "allowed_exercises": ["걷기"],
    }
    out = fb.prescribe(slots)
    assert out["처방"][0]["운동"] == "걷기"
    # 강도가 FITT 성인 유산소 수치를 인용
    assert "150" in out["처방"][0]["강도"]
    assert out["처방"][0]["주당빈도"]


# --------------------------------------------------------------------------
# ⑤ 프로바이더 선택 env 스위치
# --------------------------------------------------------------------------
def test_provider_env_switch(monkeypatch):
    monkeypatch.delenv("SPONAVI_LLM", raising=False)
    assert isinstance(ai.get_provider(), ai.RulesFallback)
    monkeypatch.setenv("SPONAVI_LLM", "off")
    assert isinstance(ai.get_provider(), ai.RulesFallback)
    monkeypatch.setenv("SPONAVI_LLM", "claude")
    assert isinstance(ai.get_provider(), ai.ClaudeCLIProvider)
    monkeypatch.setenv("SPONAVI_LLM", "gemini")
    assert isinstance(ai.get_provider(), ai.GeminiProvider)


def test_gemini_is_notimplemented_stub(monkeypatch):
    import pytest
    with pytest.raises(NotImplementedError):
        ai.GeminiProvider().prescribe({"약점": [], "추천": [], "FITT": {}})


def test_extract_json_from_fenced_output():
    txt = "여기 있습니다:\n```json\n{\"약점\": [], \"처방\": []}\n```\n끝"
    d = ai._extract_json(txt)
    assert d == {"약점": [], "처방": []}


# --------------------------------------------------------------------------
# ⑥ 처방 provenance — 서버(그래프)가 소유, 프로바이더 값은 덮어쓴다
# --------------------------------------------------------------------------
def test_rx_provenance_matches_slots(off_store, monkeypatch):
    """처방 항목의 provenance 가 그래프 추천(슬롯)의 provenance 와 동일해야 한다."""
    monkeypatch.delenv("SPONAVI_LLM", raising=False)
    # 캐시를 타지 않는 _compute 로 직접 계산(파일DB 캐시 오염·적중 방지)
    out = ai._compute(off_store, GRAPH_PAYLOAD)
    assert out["처방"], "그래프 추천 기반 처방이 있어야 한다"

    assessment = fitness.assess_fitness(off_store, GRAPH_PAYLOAD)
    slots = ai._build_slots(off_store, GRAPH_PAYLOAD, assessment)
    idx = ai._provenance_index(slots)
    assert idx, "슬롯에 provenance 가 실려야 한다(응답 경계 소실 회귀)"

    for item in out["처방"]:
        prov = item["provenance"]
        assert prov == idx[item["운동"]]
        assert prov["source"] in ("kspo_standard", "guideline", "kspo_video", "curated")
        assert prov["tier"] in ("S", "A", "V", "B")
        assert "curated_status" in prov          # B급이면 pending 배지 원천


def test_provider_provenance_is_overwritten_by_server(off_store, monkeypatch):
    """LLM 이 '공단 공식 기준·검증완료' 라고 우겨도 서버 슬롯 값으로 덮어쓴다(P-2)."""
    fake = {"source": "kspo_standard", "tier": "S", "weight": 1.0,
            "curated_status": "verified", "via_goal": "존재하지않는목적"}

    class LyingClaude:
        name = "claude"

        def prescribe(self, slots):
            names = slots["allowed_exercises"]
            return {
                "약점": [{"항목": "심폐지구력", "등급": "기준 미달", "근거": "x"}],
                "우선순위": ["심폐지구력"],
                "처방": [{"운동": names[0], "목표체력요인": "심폐지구력",
                          "강도": "a", "주당빈도": "주3", "provenance": fake}],
                "주의": "참고",
            }

    monkeypatch.setattr(ai, "get_provider", lambda: LyingClaude())
    out = ai._compute(off_store, GRAPH_PAYLOAD)
    assert out["provider"] == "claude"
    assert out["처방"], "화이트리스트 통과분이 남아야 한다"
    for item in out["처방"]:
        assert item["provenance"] != fake, "프로바이더 provenance 가 그대로 나가면 안 된다"
        assert item["provenance"].get("via_goal") != "존재하지않는목적"


def test_llm_junk_provenance_does_not_break_schema():
    """provenance 가 dict 가 아니어도 스키마 검증은 통과(어차피 서버가 덮어씀)."""
    ok = ai._validate({
        "처방": [{"운동": "걷기", "목표체력요인": "심폐지구력", "강도": "a",
                  "주당빈도": "주3", "provenance": "공단 공식"}],
    })
    assert ok is not None
    assert ok["처방"][0]["provenance"] is None


def test_prompt_slots_hide_provenance():
    """프롬프트에는 provenance 를 넣지 않는다(토큰·날조 표면 축소)."""
    slots = {"추천": [{"요인": "유연성", "운동": [
        {"운동": "요가", "출처": "kspo_standard",
         "provenance": {"source": "kspo_standard", "tier": "S"}}]}]}
    pslots = ai._prompt_slots(slots)
    assert "provenance" not in pslots["추천"][0]["운동"][0]
    assert pslots["추천"][0]["운동"][0]["운동"] == "요가"
    assert "provenance" in slots["추천"][0]["운동"][0], "원본 슬롯은 그대로"
    assert "provenance" not in ai._build_prompt(slots)


def test_rules_fallback_carries_provenance():
    fb = ai.RulesFallback()
    prov = {"source": "guideline", "tier": "A", "weight": 0.8, "curated_status": None}
    out = fb.prescribe({
        "FITT": ai.FITT["성인"],
        "약점": [{"항목": "신체조성", "요인": "신체조성", "등급": "기준 미달", "근거": "..."}],
        "추천": [{"요인": "신체조성", "운동": [
            {"운동": "걷기", "출처": "guideline", "provenance": prov}]}],
        "allowed_exercises": ["걷기"],
    })
    assert out["처방"][0]["provenance"] == prov


# --------------------------------------------------------------------------
# 신체조성 FITT (유산소+근력 병행) · 캐시 키 스키마 버전
# --------------------------------------------------------------------------
def test_fitt_for_body_composition_quotes_both():
    intensity, freq = ai._fitt_for_factor("신체조성", ai.FITT["성인"])
    assert "150~300분" in intensity        # 유산소 수치
    assert "주 2일 이상" in intensity       # 근력 수치
    assert freq


def test_body_composition_prescription_from_graph(off_store, monkeypatch):
    """BMI 약점(신체조성) → 지침(A급) 연결로 처방이 비지 않는다."""
    monkeypatch.delenv("SPONAVI_LLM", raising=False)
    out = ai._compute(off_store, BODY_PAYLOAD)
    assert out["처방"], "신체조성 처방이 비면 안 된다(고아 요인 회귀)"
    assert all(i["목표체력요인"] == "신체조성" for i in out["처방"])
    assert any(i["provenance"]["tier"] == "A" for i in out["처방"])


def test_cache_key_includes_response_schema_version():
    st = _fresh_store()
    v = ai._versions(st.conn)
    assert ai.RESPONSE_SCHEMA_VERSION in v, "응답 스키마가 바뀌면 캐시가 무효화돼야 한다"
    assert "norm" in v and "graph" in v
