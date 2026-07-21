"""그래프 연동 추천 (M1b) — /api/fitness 응답의 recommendations 가 지식그래프 경유인지 검증.

전제: data/sponavi.db 에 graph_nodes/graph_edges/videos 적재(검증 게이트에서 빌드).
폴백: 데모 스토어(fixtures, 그래프 없음)는 fitness_map 으로 무중단 폴백.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app import store as store_mod  # noqa: E402
from app.fitness import assess_fitness  # noqa: E402


def _db_ready(path: str) -> bool:
    try:
        con = sqlite3.connect(path)
        n = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
            "AND name IN ('graph_nodes','graph_edges','fitness_norm')").fetchone()[0]
        con.close()
        return n == 3
    except sqlite3.OperationalError:
        return False


@pytest.fixture(scope="module")
def off_store():
    db = str(store_mod.db_path())
    if not Path(db).exists() or not _db_ready(db):
        pytest.skip("data/sponavi.db(graph+norm) 미적재 — 빌드 게이트 선행 필요")
    return store_mod.open_db_store(db)


# --------------------------------------------------------------------------
# ① 약점요인 → 그래프 추천(운동·종목·영상) + provenance 동봉
# --------------------------------------------------------------------------
def test_recommendations_come_from_graph_with_provenance(off_store):
    res = assess_fitness(off_store, {
        "age": 30, "sex": "M", "measures": {"shuttle_20m": 30},
    })
    assert res["weaknesses"], "심폐지구력 약점이 잡혀야 한다"
    assert res["recommendations"], "그래프 추천이 있어야 한다"
    rec = res["recommendations"][0]
    assert rec["source"] == "graph"
    # 운동·종목은 {name, provenance} dict, 각 provenance 에 출처·티어
    assert rec["exercises"] and isinstance(rec["exercises"][0], dict)
    for ex in rec["exercises"]:
        assert ex["name"]
        assert ex["provenance"]["source"] in (
            "kspo_standard", "guideline", "kspo_video", "curated")
        assert ex["provenance"]["tier"] in ("S", "A", "V", "B")
    for sp in rec["sports"]:
        assert sp["provenance"]["source"]
    # 상한 준수
    assert len(rec["exercises"]) <= 5
    assert len(rec["sports"]) <= 3


def test_video_cards_carry_img_url_and_url(off_store):
    res = assess_fitness(off_store, {
        "age": 30, "sex": "M", "measures": {"shuttle_20m": 30},
    })
    rec = res["recommendations"][0]
    assert rec["videos"], "요인당 영상 카드가 있어야 한다"
    for v in rec["videos"]:
        assert "img_url" in v and "url" in v and "title" in v
    # 상위 videos(플랫) 도 썸네일 동반
    assert any(v.get("img_url") for v in res["videos"])


def test_facility_filter_sports_from_graph_dedup(off_store):
    res = assess_fitness(off_store, {
        "age": 30, "sex": "M", "measures": {"shuttle_20m": 30, "crunch_cross": 3},
    })
    fs = res["facility_filter_sports"]
    assert fs, "그래프 종목 이름 목록"
    assert len(fs) == len(set(fs)), "중복 제거"
    # 그래프 종목(수영·헬스 등)이 나와야 — fitness_map 폴백 아님
    all_sport_names = {
        sp["name"] for r in res["recommendations"] for sp in r["sports"]
    }
    assert set(fs) <= all_sport_names


# --------------------------------------------------------------------------
# ② 폴백: 그래프 없는 데모 스토어 → fitness_map(문자열 exercises)
# --------------------------------------------------------------------------
def test_demo_store_falls_back_to_fitness_map(store):
    # store fixture = fixtures 인메모리(그래프·norm 없음)
    assert store.has_fitness_norms() is False
    res = assess_fitness(store, {
        "age": 27, "sex": "M", "measures": {"flex_cm": -3},
    })
    assert res["recommendations"]
    rec = res["recommendations"][0]
    # 폴백 shape: exercises 는 문자열 리스트 + curated 라벨
    assert rec["exercises"] and isinstance(rec["exercises"][0], str)
    assert rec["curated"] == "체대 검증 대기"
