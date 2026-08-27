"""페르소나 `demo` 계약 (결정 3A) — 자동재생이 소비하는 체력 프리필·PAR-Q 프리셋.

  * 형태: 모든 페르소나에 top-level `demo = {fitness, parq_preset}`.
  * 값: P2·P5 의 `fitness` 는 실 DB `fitness_norm` 컷 기준으로 약점이 **정확히 1건
    (근지구력)** 나와야 한다 — 데모가 매번 같은 이야기를 하게 하는 게 목적이다.
    (전국 DB 없이는 공식 컷을 못 쓰므로 값 검증은 스킵한다.)
"""
import pytest

from app import fitness
from app.models import FitnessRequest


def test_every_persona_has_demo_contract(personas_by_id):
    assert personas_by_id
    for pid, p in personas_by_id.items():
        assert "demo" in p, pid
        demo = p["demo"]
        assert set(demo) == {"fitness", "parq_preset"}, pid
        assert isinstance(demo["parq_preset"], bool), pid
        assert demo["fitness"] is None or isinstance(demo["fitness"], dict), pid


def test_prefilled_personas_are_p2_p5(personas_by_id):
    prefilled = {pid for pid, p in personas_by_id.items() if p["demo"]["fitness"] is not None}
    assert prefilled == {"P2", "P5"}
    for pid, p in personas_by_id.items():
        # 프리필이 있는 페르소나만 PAR-Q 프리셋을 켠다
        assert p["demo"]["parq_preset"] is (pid in prefilled), pid


@pytest.mark.parametrize("pid", ["P2", "P5"])
def test_demo_fitness_validates_and_yields_one_weakness(db_store, personas_by_id, pid):
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 없이 공식 기준표 검증 불가")
    assert db_store.has_fitness_norms(), "공식 fitness_norm 테이블 필요"

    persona = personas_by_id[pid]
    body = persona["body"]
    demo = persona["demo"]
    # ① 요청 모델 검증 통과 (extra 키 없이 measures 로 그대로 들어간다)
    req = FitnessRequest(age=body["age"], sex=body["sex"], measures=demo["fitness"])
    assert req.measures == {k: float(v) for k, v in demo["fitness"].items()}

    # ② 약점 정확히 1건 = 근지구력
    res = fitness.assess_fitness(db_store, req.model_dump())
    factors = [w["item"] for w in res["weaknesses"]]
    assert factors == ["근지구력"], f"{pid}: {res['weaknesses']}"

    # ③ 나머지 항목은 전부 판정됨(등급 있음) — '무판정'으로 약점을 숨기지 않는다
    graded = {i["code"]: i["grade"] for i in res["items"]}
    assert set(graded) >= {"crunch_cross", "shuttle_20m", "sit_reach", "grip_rel", "bmi"}
    assert graded["crunch_cross"] is None            # 유일한 미달 항목
    assert all(g is not None for c, g in graded.items() if c != "crunch_cross")

    # ④ 키·몸무게는 서버가 BMI 로 파생(FR-07 AC8)
    assert [d["code"] for d in res["derived"]] == ["bmi"]

    # ⑤ 약점 → 추천 → 시설 필터 종목이 나온다(자동재생이 여기서 시설로 이어진다)
    assert res["facility_filter_sports"]
