"""국민체력100 공식 인증기준 판정 (M1a).

전제: scripts/scrape_norms.py 가 data/sponavi.db 에 measurement_item / fitness_norm
을 적재한 상태(검증 게이트에서 실행). 테이블이 없으면 fixture 가 1회 self-heal 한다.

커버리지:
  ① 수기 대조 3표본이 DB와 정확 일치
  ② 비교문 형식(실제 컷 인용)
  ③ 만 7~10세 공백(age_gap) 응답
  ④ higher_better 반전 판정(시간계 항목)
  ⑤ 참고등급 파생규칙(4·5·6등급 및 정상 등급)
  ⑥ items API 연령군별 카탈로그
"""
import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app import store as store_mod  # noqa: E402

# scripts/scrape_norms.py 를 파일 경로로 로드(패키지 아님).
_spec = importlib.util.spec_from_file_location(
    "scrape_norms", ROOT / "scripts" / "scrape_norms.py"
)
scrape_norms = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scrape_norms)


def _db_has_norms(path: str) -> bool:
    try:
        con = sqlite3.connect(path)
        n = con.execute("SELECT COUNT(*) FROM fitness_norm").fetchone()[0]
        con.close()
        return n > 0
    except sqlite3.OperationalError:
        return False


@pytest.fixture(scope="module")
def off_store():
    """data/sponavi.db(공식 norm 적재) 백엔드 스토어. 미적재 시 1회 self-heal."""
    db = str(store_mod.db_path())
    if not Path(db).exists() or not _db_has_norms(db):
        scrape_norms.build(db)  # 안전망: 검증 순서상 보통 실행 안 됨
    s = store_mod.open_db_store(db)
    assert s.has_fitness_norms(), "fitness_norm 테이블 미적재"
    return s


# --------------------------------------------------------------------------
# ① 수기 대조 표본 == DB
# --------------------------------------------------------------------------
def test_handcheck_samples_match_db(off_store):
    ok, report = scrape_norms.verify(off_store.conn)
    assert ok, "\n".join(report)


def test_handcheck_via_store_layer(off_store):
    # 스토어 조회 계층으로도 원문값 재확인 (성인/어르신/유소년 1등급 남 대표값)
    def cut(age, sex, code, grade):
        return off_store.fitness_norms(age, sex)[code]["cuts"][grade]["value"]

    assert cut(20, "M", "shuttle_20m", 1) == 62      # 성인 20m왕복
    assert cut(20, "M", "air_time", 1) == 0.605      # 성인 체공시간
    assert cut(66, "M", "walk_6min", 1) == 677       # 어르신 6분걷기
    assert cut(66, "M", "fig8_walk", 1) == 21.0      # 어르신 8자보행
    assert cut(11, "M", "shuttle_15m", 1) == 77      # 유소년 15m왕복
    assert cut(11, "M", "eyehand_cnt", 1) == 18      # 유소년 눈-손 협응


# --------------------------------------------------------------------------
# ② 비교문 형식 + 공식 basis
# --------------------------------------------------------------------------
def test_comparison_string_cites_real_cut(off_store):
    from app.fitness import assess_fitness
    res = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"crunch_cross": 38},
    })
    w = res["weaknesses"]
    assert len(w) == 1 and w[0]["item"] == "근지구력"
    # 계약 예시 형식과 정확히 일치 (성인 19~24 남 교차윗몸 3등급 컷=42)
    assert w[0]["comparison"] == "교차윗몸 일으키기 38회 — 19~24세 남 3등급 컷 42회 미달"
    assert w[0]["basis"] == "국민체력100 공식 인증기준(문체부 고시 체계)"
    assert "데모" not in w[0]["basis"]
    assert w[0]["cut"] == 42.0


def test_weakness_shape_backcompat_keys(off_store):
    from app.fitness import assess_fitness
    res = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"grip_rel": 20},
    })
    for wk in res["weaknesses"]:
        assert {"item", "value", "band", "basis"} <= set(wk)  # 웹/계약 하위호환


def test_pass_is_not_weakness(off_store):
    from app.fitness import assess_fitness
    # 성인 19~24 남 상대악력 1등급 컷 62.6 → 70 이면 1등급 수준(약점 아님)
    res = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"grip_rel": 70},
    })
    assert all(w["item"] != "근력" for w in res["weaknesses"])
    grip = [i for i in res["items"] if i["code"] == "grip_rel"][0]
    assert grip["band"] == "1등급 수준" and grip["grade"] == 1


# --------------------------------------------------------------------------
# ④ higher_better 반전 (시간계 항목)
# --------------------------------------------------------------------------
def test_higher_better_reversal_time_item(off_store):
    from app.fitness import assess_fitness
    # 10m 왕복(초, 낮을수록 좋음): 느리면 미달, 빠르면 상위. 반응시간도 동일.
    slow = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"shuttle_10m_run": 15.0}})
    fast = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"shuttle_10m_run": 9.0}})
    slow_it = [i for i in slow["items"] if i["code"] == "shuttle_10m_run"][0]
    fast_it = [i for i in fast["items"] if i["code"] == "shuttle_10m_run"][0]
    assert slow_it["band"] == "기준 미달"
    assert fast_it["grade"] == 1 and "초과" in slow_it["comparison"]


def test_higher_better_normal_count_item(off_store):
    from app.fitness import assess_fitness
    # 회수 항목(높을수록 좋음): 낮으면 미달, 높으면 상위 — 방향 반대.
    lo = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"crunch_cross": 5}})
    hi = assess_fitness(off_store, {
        "age": 22, "sex": "M", "measures": {"crunch_cross": 60}})
    assert [i for i in lo["items"]][0]["band"] == "기준 미달"
    assert [i for i in hi["items"]][0]["grade"] == 1


# --------------------------------------------------------------------------
# ③ 만 7~10세 공백
# --------------------------------------------------------------------------
def test_age_gap_7_to_10(off_store):
    from app.fitness import assess_fitness
    res = assess_fitness(off_store, {
        "age": 8, "sex": "F", "measures": {"sit_reach": 2}})
    assert res["age_gap"] is True
    assert "공식 기준이 없습니다" in res["message"]
    # 참고 제공 시 basis 에 명시
    assert res["items"], "유소년 기준 참고 판정 제공"
    assert "참고" in res["items"][0]["basis"] and "만7~10" in res["items"][0]["basis"]


def test_age_infant_non_certified(off_store):
    from app.fitness import assess_fitness
    res = assess_fitness(off_store, {"age": 5, "sex": "F", "measures": {"sit_reach": 2}})
    assert res["weaknesses"] == []
    assert "비인증" in res["message"]


# --------------------------------------------------------------------------
# ⑤ 참고등급 파생규칙 (정상 + 4/5/6)
# --------------------------------------------------------------------------
def _grade(off_store, measures, age=22, sex="M"):
    from app.fitness import assess_fitness
    res = assess_fitness(off_store, {"age": age, "sex": sex, "measures": measures})
    return res["reference_grade"]


def test_reference_grade_label_and_missing(off_store):
    rg = _grade(off_store, {"crunch_cross": 38})
    assert rg["label"] == "참고 등급(추정)"
    assert isinstance(rg["missing"], list) and rg["missing"]  # 미입력 항목 동봉


def test_reference_grade_4_cardio_and_strength_ge3(off_store):
    # 심폐(20m 3등급컷 41)·근력(상대악력 3등급컷 51.8)만 3등급 통과 → 4등급 파생
    rg = _grade(off_store, {"shuttle_20m": 45, "grip_rel": 55})
    assert rg["grade"] == 4


def test_reference_grade_5_cardio_only(off_store):
    # 심폐만 3등급 이상, 근력 미입력 → 5등급 파생
    rg = _grade(off_store, {"shuttle_20m": 45})
    assert rg["grade"] == 5


def test_reference_grade_6_neither(off_store):
    # 유연성만 통과, 심폐·근력 모두 미충족/미입력 → 6등급
    rg = _grade(off_store, {"sit_reach": 50})
    assert rg["grade"] == 6


def test_reference_grade_1_all_pass(off_store):
    # 건강체력 4항목 전부 1등급 + 운동체력 1개 1등급 → 1등급
    rg = _grade(off_store, {
        "shuttle_20m": 70, "grip_rel": 65, "crunch_cross": 60,
        "sit_reach": 20, "shuttle_10m_run": 9.0,
    })
    assert rg["grade"] == 1


# --------------------------------------------------------------------------
# ⑥ items API 연령군별 카탈로그
# --------------------------------------------------------------------------
def test_items_api_adult(client):
    r = client.get("/api/fitness/items", params={"age": 30})
    assert r.status_code == 200
    d = r.json()
    assert d["age_group"] == "성인"
    codes = {it["code"] for it in d["items"]}
    assert {"grip_rel", "sit_reach", "crunch_cross", "shuttle_20m",
            "shuttle_10m_run", "standing_jump", "bmi"} <= codes
    # alt_group 노출 (택1 쌍)
    assert any(it["alt_group"] for it in d["items"])
    # 힌트 존재
    for it in d["items"]:
        assert it["hint"]


def test_items_api_senior(client):
    d = client.get("/api/fitness/items", params={"age": 70}).json()
    assert d["age_group"] == "어르신"
    codes = {it["code"] for it in d["items"]}
    assert {"walk_2min", "walk_6min", "chair_stand", "agility_3m", "fig8_walk"} <= codes
    # 성인 전용 항목은 없어야
    assert "crunch_cross" not in codes and "standing_jump" not in codes


def test_items_api_youth_and_teen(client):
    youth = client.get("/api/fitness/items", params={"age": 11}).json()
    assert youth["age_group"] == "유소년"
    ycodes = {it["code"] for it in youth["items"]}
    assert {"shuttle_15m", "side_step", "eyehand_cnt"} <= ycodes

    teen = client.get("/api/fitness/items", params={"age": 15}).json()
    assert teen["age_group"] == "청소년"
    tcodes = {it["code"] for it in teen["items"]}
    assert {"illinois", "eyehand_sec", "repeat_jump"} <= tcodes


def test_items_api_gap_references_youth(client):
    d = client.get("/api/fitness/items", params={"age": 8}).json()
    assert d["age_gap"] is True
    assert d["items"]  # 유소년 참고 카탈로그
    assert "7~10" in d["message"] or "7-10" in d["message"]


# --------------------------------------------------------------------------
# 하위호환 레거시 키 (grip_kg 등) — 공식 모드에서도 매핑
# --------------------------------------------------------------------------
def test_legacy_keys_mapped(client):
    r = client.post("/api/fitness", json={
        "age": 27, "sex": "M",
        "measures": {"grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25},
    })
    assert r.status_code == 200
    d = r.json()
    assert {"weaknesses", "recommendations", "videos", "facility_filter_sports"} <= set(d)
    # 레거시 flex_cm → 공식 sit_reach 로 매핑되어 판정됨
    names = {i["code"] for i in d.get("items", [])}
    assert "sit_reach" in names
