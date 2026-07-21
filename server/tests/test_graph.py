"""체력 지식그래프 빌드 + 조회(graph.py) 검증.

hermetic: 임시 :memory: DB 에 대표 courses/videos 를 심고 scripts/build_graph 로 실제
그래프를 빌드한 뒤(=계약의 '빌드 후'), server/app/graph.recommend_for_weakness 를 검증한다.
data/sponavi.db 의 실적재 상태에 의존하지 않는다(신규 체크아웃·데모 DB 안전).
"""
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "server"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import build_graph  # noqa: E402  (scripts/build_graph.py)
from app import graph  # noqa: E402  (server/app/graph.py)

# courses.sport DISTINCT 34종 실측 (2026-07)
SPORTS_34 = [
    "태권도", "기타종목", "헬스", "수영", "필라테스", "댄스(줌바 등)", "복싱",
    "축구(풋살)", "합기도", "탁구", "요가", "무용(발레 등)", "검도", "줄넘기",
    "유도", "주짓수", "농구", "종합체육시설", "배드민턴", "골프", "볼링", "테니스",
    "클라이밍", "롤러인라인", "당구", "승마", "에어로빅", "야구", "빙상(스케이트)",
    "크로스핏", "스쿼시", "클라이밍(암벽등반)", "배구", "펜싱",
]

# (op, trng_nm, title, file_url, aggrp, factor, aim) — 실데이터 형태 축약
VIDEO_ROWS = [
    # TRNG_GUIDE: 요인×연령
    ("TODZ_VDO_TRNG_GUIDE_I", "제자리 걷기", "제자리 걷기", "http://v/1.mp4", "공통", "심폐지구력", ""),
    ("TODZ_VDO_TRNG_GUIDE_I", "앉았다 일어서기", "앉았다 일어서기", "http://v/2.mp4", "어르신", "근력/근지구력", ""),
    ("TODZ_VDO_TRNG_GUIDE_I", "한 발 서기", "한 발 서기", "http://v/3.mp4", "어르신", "평형성", ""),
    ("TODZ_VDO_TRNG_GUIDE_I", "어깨 돌리기", "어깨 돌리기", "http://v/4.mp4", "성인", "유연성", ""),
    ("TODZ_VDO_TRNG_GUIDE_I", "손 뼉치기 스텝", "협응 스텝", "http://v/5.mp4", "유소년", "협응성", ""),
    # TRNG_VIDEO: 성인 심폐 (연령 매칭 운동 존재 확인용)
    ("TODZ_VDO_TRNG_VIDEO_I", "실내 자전거타기", "실내 자전거타기", "http://v/6.mp4", "성인", "심폐지구력", ""),
    # ROUTINE: 목적(낙상/요통) — 공통
    ("TODZ_VDO_ROUTINE_I", "누워서 다리 당기기", "요통 예방 운동", "http://v/7.mp4", "공통", "유연성", "요통 예방"),
    ("TODZ_VDO_ROUTINE_I", "앉아 균형 잡기", "낙상 예방 운동", "http://v/8.mp4", "공통", "평형성", "낙상 예방"),
    ("TODZ_VDO_ROUTINE_I", "옆으로 다리 들기", "낙상 예방 운동", "http://v/9.mp4", "공통", "", "낙상 예방"),
    # VIEW_ALL: 공통필드만(요인/목적 없음) — Exercise 노드 기여, 중복 태그
    ("TODZ_VDO_VIEW_ALL_LIST_I", "제자리 걷기", "제자리 걷기", "http://v/1.mp4", "공통", "", ""),
    # FTNS_CERT: 측정법(체력인증) — improves 생성 안 됨 확인용
    ("TODZ_VDO_FTNS_CERT_I", "허리둘레", "허리둘레", "http://v/10.mp4", "공통", "체력인증", ""),
]


@pytest.fixture(scope="module")
def gconn():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE courses (id TEXT, sport TEXT)")
    conn.executemany("INSERT INTO courses (id, sport) VALUES (?,?)",
                     [(f"c{i}", s) for i, s in enumerate(SPORTS_34)])
    conn.execute(
        "CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT, oper_nm TEXT, "
        "trng_nm TEXT, title TEXT, file_url TEXT, img_url TEXT, len TEXT, descr TEXT, "
        "aggrp TEXT, factor TEXT, level TEXT, place TEXT, tool TEXT, aim TEXT)")
    conn.executemany(
        "INSERT INTO videos (op, trng_nm, title, file_url, aggrp, factor, aim) "
        "VALUES (?,?,?,?,?,?,?)", VIDEO_ROWS)
    conn.commit()
    build_graph.build(conn)
    yield conn
    conn.close()


# ---------------------------------------------------------------------------
# 노드/엣지 기본
# ---------------------------------------------------------------------------
def test_node_counts(gconn):
    def cnt(t):
        return gconn.execute("SELECT COUNT(*) FROM graph_nodes WHERE type=?", (t,)).fetchone()[0]
    assert cnt("Factor") == 9
    assert cnt("AgeGroup") == 5
    assert cnt("Sport") == 34          # courses.sport DISTINCT 실측
    assert cnt("Exercise") > 0
    assert cnt("Goal") >= 2            # 낙상예방·요통예방 최소


# ① S급 엣지 실존 (kspo_standard, improves) — 3개 스팟
def test_s_tier_edges_exist(gconn):
    def has(src, dst):
        return gconn.execute(
            "SELECT COUNT(*) FROM graph_edges WHERE src=? AND dst=? "
            "AND rel='improves' AND source='kspo_standard'", (src, dst)).fetchone()[0]
    assert has("sport:수영", "factor:심폐지구력")     # 수영→심폐지구력
    assert has("sport:헬스", "factor:근력")           # 헬스→근력
    assert has("sport:요가", "factor:유연성")         # 요가→유연성
    # S급 엣지에 원문+URL evidence 동봉
    row = gconn.execute(
        "SELECT evidence, weight FROM graph_edges WHERE src='sport:수영' "
        "AND dst='factor:심폐지구력' AND source='kspo_standard'").fetchone()
    assert "kspo.or.kr" in row[0] and row[1] == 1.0


# ② B급 엣지는 curated_status='pending' (trains, curated)
def test_b_tier_pending(gconn):
    rows = gconn.execute(
        "SELECT rel, curated_status, weight FROM graph_edges WHERE source='curated'").fetchall()
    assert rows, "B급(curated) 엣지가 있어야 한다"
    for rel, cstatus, weight in rows:
        assert rel == "trains"
        assert cstatus == "pending"
        assert weight in (0.5, 0.3)     # ●=0.5 / ○=0.3
    # 대표 셀: 태권도→민첩성(●), 승마→평형성(●)
    assert gconn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE src='sport:태권도' AND dst='factor:민첩성' "
        "AND source='curated'").fetchone()[0]


def test_v_and_a_tiers(gconn):
    # V급 improves: 영상 요인축 (제자리 걷기→심폐지구력)
    assert gconn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE source='kspo_video' AND rel='improves' "
        "AND src='exercise:제자리 걷기' AND dst='factor:심폐지구력'").fetchone()[0]
    # '근력/근지구력' 분리 → 두 요인 improves
    for f in ("근력", "근지구력"):
        assert gconn.execute(
            "SELECT COUNT(*) FROM graph_edges WHERE rel='improves' AND source='kspo_video' "
            "AND src='exercise:앉았다 일어서기' AND dst=?", (f"factor:{f}",)).fetchone()[0]
    # 협응성→협응력 정규화
    assert gconn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE dst='factor:협응력' AND source='kspo_video'"
    ).fetchone()[0]
    # 체력인증은 improves 미생성
    assert gconn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE src='exercise:허리둘레' AND rel='improves'"
    ).fetchone()[0] == 0
    # A급 suits: 줄넘기→청소년(뼈부하), 낙상예방→어르신 (AgeGroup id = 'agegroup:*')
    assert gconn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE source='guideline' AND rel='suits' "
        "AND src='sport:줄넘기' AND dst='agegroup:청소년'").fetchone()[0]
    assert gconn.execute(
        "SELECT COUNT(*) FROM graph_edges WHERE source='guideline' AND rel='suits' "
        "AND src='goal:낙상예방' AND dst='agegroup:어르신'").fetchone()[0]


# ③ recommend: 심폐지구력(성인 30) → 수영 포함 + provenance
def test_recommend_cardio_adult(gconn):
    out = graph.recommend_for_weakness(["심폐지구력"], 30, gconn)
    assert "심폐지구력" in out
    block = out["심폐지구력"]
    sport_names = [s["name"] for s in block["sports"]]
    assert "수영" in sport_names
    # 모든 후보에 provenance(source·tier) 동봉
    for s in block["sports"]:
        assert s["provenance"]["source"] and s["provenance"]["tier"] in ("S", "A", "V", "B")
    # 수영은 S티어여야(정렬 최상위 근처)
    swim = next(s for s in block["sports"] if s["name"] == "수영")
    assert swim["provenance"]["source"] == "kspo_standard"
    assert swim["provenance"]["tier"] == "S"
    # 상한 준수
    assert len(block["sports"]) <= 3
    assert len(block["exercises"]) <= 5
    assert len(block["videos"]) <= 3


# ④ recommend: 평형성(어르신 70) → 낙상예방 계열 노출
def test_recommend_balance_senior(gconn):
    out = graph.recommend_for_weakness(["평형성"], 70, gconn)
    block = out["평형성"]
    # 멀티홉(평형성 ← Goal 낙상예방 ← targets 운동) 로 낙상예방 계열이 근거와 함께 노출
    via_goal_ex = [e for e in block["exercises"]
                   if e["provenance"].get("via_goal") == "낙상예방"]
    fall_videos = [v for v in block["videos"]
                   if (v["provenance"].get("aim") or "").replace(" ", "") == "낙상예방"]
    assert via_goal_ex or fall_videos, "평형성 추천에 낙상예방 계열이 있어야 한다"
    # 직접 평형성 운동(한 발 서기)도 연령(어르신) 필터 통과
    ex_names = [e["name"] for e in block["exercises"]]
    assert "한 발 서기" in ex_names
    # provenance 필수
    for e in block["exercises"]:
        assert "source" in e["provenance"]


# 연령 suits 필터: 유소년 전용 운동은 성인 추천에서 제외
def test_age_filter_excludes_youth_only(gconn):
    out = graph.recommend_for_weakness(["협응력"], 30, gconn)
    ex_names = [e["name"] for e in out["협응력"]["exercises"]]
    # '손 뼉치기 스텝'은 aggrp=유소년 → 성인(30) 추천에서 빠져야
    assert "손 뼉치기 스텝" not in ex_names


# ⑤ 그래프 부재 → 빈 dict (폴백 안전)
def test_fallback_no_graph():
    conn = sqlite3.connect(":memory:")
    assert graph.graph_available(conn) is False
    assert graph.recommend_for_weakness(["심폐지구력"], 30, conn) == {}
    conn.close()


def test_empty_factors(gconn):
    assert graph.recommend_for_weakness([], 30, gconn) == {}
