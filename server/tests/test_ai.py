"""AI 체력 처방 (ai.py + POST /api/fitness/ai) — ARCHITECTURE §6 계약 검증.

커버리지:
  ① SPONAVI_LLM 미설정 → provider="rules", 출력 스키마 유효(pydantic 검증 통과 형태)
  ② 캐시 적중: 같은 입력 2회 → 동일 응답, 계산(_compute)은 1회
  ③ 화이트리스트: LLM 처방의 슬롯 밖 운동명은 드롭
  ④ RulesFallback 은 FITT 수치사전만 인용(그래프 추천 운동으로 조립)
  ⑤ 프로바이더 선택 env 스위치
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app import ai  # noqa: E402
from app import store as store_mod  # noqa: E402

WEAK_PAYLOAD = {"age": 27, "sex": "M", "measures": {"flex_cm": -3}}


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
