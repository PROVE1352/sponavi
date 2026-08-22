"""체력 지식그래프 조회 (읽기 전용). FITNESS_GRAPH.md §5 리트리벌의 그래프 탐색 홉.

이 모듈은 graph_nodes/graph_edges(+videos) 를 읽어 약점요인 → 운동/종목/영상 서브그래프를
결정론으로 구성한다. **생성(LLM)은 여기서 하지 않는다** — 근거 있는 후보만 골라 넘긴다.

핵심 함수 recommend_for_weakness(factors, age, db_conn) 는 독립 실행형이며, fitness.py 가
이를 호출해 /api/fitness 응답에 근거 경로를 붙이고, ai.py 가 그 provenance 를 처방 항목에 싣는다.

정직성/폴백: graph 테이블이 없으면 빈 dict 를 돌려준다(데모/레거시 DB 안전).
provenance(출처·검증상태·티어)를 모든 후보에 동봉 — 출처 없는 추천은 내보내지 않는다.
멀티홉(운동→목적→요인) 후보의 provenance 는 **두 홉 중 약한 쪽**을 쓴다(_weakest) — 강한 홉을
경로 전체 등급으로 표기하면 거짓 정밀도가 되기 때문(P-1). via_goal/via_goal_source 로 경로를 남긴다.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

# provenance 티어: S(공식) > A(지침) > V(영상) > B(큐레이션)
SOURCE_TIER: dict[str, tuple[str, int]] = {
    "kspo_standard": ("S", 4),
    "guideline": ("A", 3),
    "kspo_video": ("V", 2),
    "curated": ("B", 1),
}

FACTORS = {
    "심폐지구력", "근력", "근지구력", "유연성", "민첩성",
    "순발력", "협응력", "평형성", "신체조성",
}
AGE_GROUPS = ["유아", "유소년", "청소년", "성인", "어르신"]

# 요인당 상한
MAX_EXERCISES = 5
MAX_SPORTS = 3
MAX_VIDEOS = 3


# ---------------------------------------------------------------------------
# 정규화 (build_graph 와 동일 규칙 — 모듈 독립성 위해 복제)
# ---------------------------------------------------------------------------
def _norm_ws(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _norm_factor(raw: str) -> list[str]:
    r = _norm_ws(raw)
    if not r or r == "체력인증":
        return []
    out: list[str] = []
    for part in re.split(r"[/·,]", r):
        p = part.strip()
        if p == "협응성":
            p = "협응력"
        if p in FACTORS:
            out.append(p)
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


_AGE_ALIAS = {"유아기": "유아"}  # 영상 aggrp 실측: 유아는 '유아기'로 표기


def _norm_age(raw: str) -> list[str]:
    r = _norm_ws(raw)
    if r == "공통":
        return list(AGE_GROUPS)
    r = _AGE_ALIAS.get(r, r)
    return [r] if r in AGE_GROUPS else []


def _norm_goal(raw: str) -> str:
    return re.sub(r"\s+", "", str(raw or "")).strip()


def age_to_group(age: int) -> str:
    if age < 7:
        return "유아"
    if age < 13:
        return "유소년"
    if age < 19:
        return "청소년"
    if age < 65:
        return "성인"
    return "어르신"


def _nid(typ: str, name: str) -> str:
    return f"{typ.lower()}:{name}"


def _provenance(source: str, weight: float, curated_status,
                via_goal=None, via_goal_source=None) -> dict:
    tier, _rank = SOURCE_TIER.get(source, ("?", 0))
    p = {"source": source, "tier": tier, "weight": weight,
         "curated_status": curated_status}
    if via_goal:
        p["via_goal"] = via_goal
        # 경로의 두 홉 중 강한 쪽도 남긴다(UI 가 "목적 경유" 를 설명할 수 있게).
        p["via_goal_source"] = via_goal_source
    return p


def _rank(source: str, weight: float) -> tuple[int, float]:
    return (SOURCE_TIER.get(source, ("?", 0))[1], weight or 0.0)


def _weakest(a: tuple, b: tuple) -> tuple:
    """(source, weight, curated_status) 두 홉 중 **약한 쪽**을 경로 신뢰도로 채택.

    멀티홉(Exercise --targets--> Goal --improves--> Factor)에서 목적→요인 엣지가 A급이라도
    운동→목적 엣지가 V급이면 그 운동의 근거는 V급이다. 강한 홉을 경로 전체의 등급으로
    쓰면 거짓 정밀도가 된다(P-1).
    """
    return a if _rank(a[0], a[1]) <= _rank(b[0], b[1]) else b


# ---------------------------------------------------------------------------
# graph presence / small readers
# ---------------------------------------------------------------------------
def graph_available(conn: sqlite3.Connection) -> bool:
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
            "AND name IN ('graph_nodes','graph_edges')").fetchone()
        return bool(row) and row[0] == 2
    except sqlite3.OperationalError:
        return False


def _suits_map(conn: sqlite3.Connection) -> dict[str, set]:
    """Exercise id -> {AgeGroup 이름} (suits 엣지). 나이 필터용."""
    out: dict[str, set] = {}
    for src, dst in conn.execute(
            "SELECT e.src, n.name FROM graph_edges e JOIN graph_nodes n ON n.id=e.dst "
            "WHERE e.rel='suits' AND n.type='AgeGroup'"):
        out.setdefault(src, set()).add(dst)
    return out


def _age_ok(ex_id: str, group: str, suits: dict[str, set]) -> bool:
    """연령 데이터가 없으면(제약 근거 없음) 통과, 있으면 해당 연령군 포함해야 통과."""
    s = suits.get(ex_id)
    return (not s) or (group in s)


# ---------------------------------------------------------------------------
# per-factor builders
# ---------------------------------------------------------------------------
def _exercises_for_factor(conn, factor, group, suits) -> list[dict]:
    fid = _nid("Factor", factor)
    picked: dict[str, dict] = {}   # exercise name -> item (best tier kept)

    def _offer(name, source, weight, cstatus, via_goal=None, via_goal_source=None):
        cur = picked.get(name)
        cand_rank = _rank(source, weight)
        if cur is None or cand_rank > cur["_rank"]:
            picked[name] = {
                "name": name,
                "provenance": _provenance(source, weight, cstatus,
                                          via_goal, via_goal_source),
                "_rank": cand_rank,
            }

    # 직접: Exercise --improves--> Factor
    for src, name, source, weight, cstatus in conn.execute(
            "SELECT e.src, n.name, e.source, e.weight, e.curated_status "
            "FROM graph_edges e JOIN graph_nodes n ON n.id=e.src "
            "WHERE e.dst=? AND e.rel='improves' AND n.type='Exercise'", (fid,)):
        if _age_ok(src, group, suits):
            _offer(name, source, weight, cstatus)

    # 멀티홉: Goal --improves--> Factor, 그 Goal 을 targets 하는 Exercise 를 끌어옴.
    # 경로 등급 = 두 홉 중 약한 쪽(_weakest) — 목적 엣지가 A급이어도 운동→목적이 V급이면 V급.
    for goal_id, goal_name, gsource, gweight, gstatus in conn.execute(
            "SELECT e.src, n.name, e.source, e.weight, e.curated_status "
            "FROM graph_edges e JOIN graph_nodes n ON n.id=e.src "
            "WHERE e.dst=? AND e.rel='improves' AND n.type='Goal'", (fid,)):
        for ex_id, ex_name, esource, eweight, estatus in conn.execute(
                "SELECT e.src, n.name, e.source, e.weight, e.curated_status "
                "FROM graph_edges e JOIN graph_nodes n ON n.id=e.src "
                "WHERE e.dst=? AND e.rel='targets' AND n.type='Exercise'", (goal_id,)):
            if _age_ok(ex_id, group, suits):
                src, w, cs = _weakest((gsource, gweight, gstatus),
                                      (esource, eweight, estatus))
                _offer(ex_name, src, w, cs,
                       via_goal=goal_name, via_goal_source=gsource)

    items = sorted(picked.values(), key=lambda x: x["_rank"], reverse=True)
    for it in items:
        it.pop("_rank", None)
    return items[:MAX_EXERCISES]


def _sports_for_factor(conn, factor) -> list[dict]:
    fid = _nid("Factor", factor)
    picked: dict[str, dict] = {}
    # 종목은 연령 필터 없음(종목 자체는 전 연령 — A급 suits 는 가점 신호일 뿐)
    for name, source, weight, cstatus in conn.execute(
            "SELECT n.name, e.source, e.weight, e.curated_status "
            "FROM graph_edges e JOIN graph_nodes n ON n.id=e.src "
            "WHERE e.dst=? AND e.rel IN ('improves','trains') AND n.type='Sport'", (fid,)):
        cand_rank = _rank(source, weight)
        cur = picked.get(name)
        if cur is None or cand_rank > cur["_rank"]:
            picked[name] = {"name": name,
                            "provenance": _provenance(source, weight, cstatus),
                            "_rank": cand_rank}
    items = sorted(picked.values(), key=lambda x: x["_rank"], reverse=True)
    for it in items:
        it.pop("_rank", None)
    return items[:MAX_SPORTS]


def _videos_for_factor(conn, factor, group, ex_names) -> list[dict]:
    """추천 운동과 정합적인 영상 우선 + 요인 직접매칭 보충. 연령군(또는 공통) 필터."""
    has_videos = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='videos'"
    ).fetchone()[0]
    if not has_videos:
        return []

    def _age_ok_vid(aggrp: str) -> bool:
        groups = _norm_age(aggrp)
        return (not groups) or (group in groups)

    out: list[dict] = []
    seen: set[str] = set()

    def _add(title, url, img_url, op, trng, aim, aggrp, via_goal=None):
        key = url or f"{op}:{trng}"
        if key in seen:
            return
        seen.add(key)
        prov = {"source": "kspo_video", "tier": "V", "op": op}
        if aim:
            prov["aim"] = aim
        if via_goal:
            prov["via_goal"] = via_goal
        # img_url = 썸네일(결과 화면 영상 카드). 값이 없으면 None 유지(정직).
        out.append({"title": title or trng, "url": url, "img_url": img_url or None,
                    "trng_nm": trng, "provenance": prov})

    # 1) 추천 운동과 같은 trng_nm 영상 (정합)
    norm_names = {_norm_ws(x) for x in ex_names}
    if norm_names:
        rows = conn.execute(
            "SELECT title, file_url, img_url, op, trng_nm, aim, aggrp FROM videos "
            "WHERE trng_nm IS NOT NULL AND trng_nm<>''").fetchall()
        for title, url, img_url, op, trng, aim, aggrp in rows:
            if len(out) >= MAX_VIDEOS:
                break
            if _norm_ws(trng) in norm_names and _age_ok_vid(aggrp):
                _add(title, url, img_url, op, trng, aim, aggrp)

    # 2) 보충: 요인 직접 매칭 (근력/근지구력 분리·협응성→협응력 정규화)
    if len(out) < MAX_VIDEOS:
        rows = conn.execute(
            "SELECT title, file_url, img_url, op, trng_nm, aim, aggrp, factor FROM videos "
            "WHERE factor IS NOT NULL AND factor<>''").fetchall()
        for title, url, img_url, op, trng, aim, aggrp, fct in rows:
            if len(out) >= MAX_VIDEOS:
                break
            if factor in _norm_factor(fct) and _age_ok_vid(aggrp):
                _add(title, url, img_url, op, trng, aim, aggrp)
    return out[:MAX_VIDEOS]


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------
def recommend_for_weakness(factors: list, age: int, db_conn: sqlite3.Connection) -> dict:
    """약점요인 리스트 → {요인: {exercises, sports, videos}} 서브그래프.

    - 티어 가중 정렬 S>A>V>B, 연령군 suits 필터(운동), 요인당 운동5·종목3·영상3 상한
    - 각 후보에 provenance(source·tier·curated_status) 동봉
    - graph 테이블 부재 시 빈 dict (폴백 안전)
    """
    if not factors or not graph_available(db_conn):
        return {}
    group = age_to_group(age)
    suits = _suits_map(db_conn)

    result: dict[str, dict] = {}
    for factor in factors:
        f = _norm_ws(factor)
        if f == "협응성":
            f = "협응력"
        exercises = _exercises_for_factor(db_conn, f, group, suits)
        sports = _sports_for_factor(db_conn, f)
        videos = _videos_for_factor(
            db_conn, f, group, [e["name"] for e in exercises])
        result[factor] = {
            "exercises": exercises,
            "sports": sports,
            "videos": videos,
            "age_group": group,
        }
    return result
