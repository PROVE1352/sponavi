#!/usr/bin/env python3
"""체력 지식그래프 빌드 → sponavi.db `graph_nodes` / `graph_edges` (멱등).

FITNESS_GRAPH.md §2(스키마)·§3(종목34×요인 매트릭스)·§4(빌드 파이프라인)의 계약 구현.
소스 1·2·3·5 를 정규화해 노드/엣지로 적재한다(코퍼스 채굴 P급=소스4 는 다음 배치 M1c).

노드 5종:
  Factor    체력요인 9  (심폐지구력·근력·근지구력·유연성·민첩성·순발력·협응력·평형성·신체조성)
  Sport     종목 34     (courses.sport DISTINCT 실측)
  Exercise  운동        (videos.trng_nm distinct — 공백 정규화·중복 정리 + KSPO 시드운동)
  AgeGroup  연령군 5    (유아·유소년·청소년·성인·어르신)   ※만 7~10 공백은 FITNESS_GRAPH §1
  Goal      목적        (videos.trng_aim_nm distinct: 낙상예방·요통예방·골다공증예방·…)

엣지 (provenance 필수 — 출처 없는 엣지는 존재하지 않는다):
  S급 kspo_standard w=1.0  improves  KSPO 공식 요인→운동 매핑(nfa selectFitnessStandard.kspo)
  V급 kspo_video    w=0.7  improves/suits/targets  영상 카탈로그 분류축(요인·연령·목적)
  A급 guideline     w=0.8  suits     정부·국제 지침(청소년 뼈부하 / 노인 평형)
  B급 curated       w=0.5(●)/0.3(○)  trains  §3 매트릭스 B셀 (curated_status='pending')

Usage:
  python scripts/build_graph.py [--db data/sponavi.db]
전제: videos 테이블(scripts/fetch_videos.py) + courses 테이블(scripts/build_db.py) 존재.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "data" / "sponavi.db"

# ---------------------------------------------------------------------------
# 상수: 요인·연령군·정규화
# ---------------------------------------------------------------------------
FACTORS = [
    "심폐지구력", "근력", "근지구력", "유연성", "민첩성",
    "순발력", "협응력", "평형성", "신체조성",
]
AGE_GROUPS = ["유아", "유소년", "청소년", "성인", "어르신"]

KSPO_URL = "https://nfa.kspo.or.kr/classroom/program/selectFitnessStandard.kspo"

TIER_WEIGHT = {"kspo_standard": 1.0, "guideline": 0.8, "kspo_video": 0.7}
MARK_WEIGHT = {"●": 0.5, "○": 0.3}


def norm_ws(s) -> str:
    """공백 정규화: 앞뒤 strip + 내부 연속 공백 1칸."""
    return re.sub(r"\s+", " ", str(s or "")).strip()


def norm_factor(raw: str) -> list[str]:
    """영상 ftns_fctr_nm → canonical Factor 노드명 리스트.
    '근력/근지구력' 은 두 요인으로 분리, '협응성'→'협응력', '체력인증'→제외."""
    r = norm_ws(raw)
    if not r or r == "체력인증":
        return []
    out: list[str] = []
    for part in re.split(r"[/·,]", r):
        p = part.strip()
        if not p:
            continue
        if p == "협응성":
            p = "협응력"
        if p in FACTORS:
            out.append(p)
    # dedup preserve order
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


AGE_ALIAS = {"유아기": "유아"}  # 영상 aggrp 실측: 유아는 '유아기'로 표기됨


def norm_age(raw: str) -> list[str]:
    """영상 aggrp_nm → AgeGroup 노드명 리스트. '공통'→전 연령군, '유아기'→유아."""
    r = norm_ws(raw)
    if r == "공통":
        return list(AGE_GROUPS)
    r = AGE_ALIAS.get(r, r)
    if r in AGE_GROUPS:
        return [r]
    return []


def norm_goal(raw: str) -> str:
    """영상 trng_aim_nm → Goal 노드명(내부 공백 제거). '낙상 예방'→'낙상예방'."""
    return re.sub(r"\s+", "", str(raw or "")).strip()


def age_to_group(age: int) -> str:
    if age < 7:
        return "유아"
    if age < 13:      # 만 7~10 공식공백이나 콘텐츠 매칭은 유소년으로 근사
        return "유소년"
    if age < 19:
        return "청소년"
    if age < 65:
        return "성인"
    return "어르신"


# ---------------------------------------------------------------------------
# S급: KSPO 공식 요인→운동 매핑 (selectFitnessStandard.kspo 원문)
# (src_type, src_name, dst_factor)  — evidence 는 아래 문구 사전에서
# ---------------------------------------------------------------------------
KSPO_EVIDENCE = {
    "심폐지구력": "심폐지구력이 낮으면 오래 걷기·조깅·수영을 권장 (KSPO 건강체력기준)",
    "근력": "근력·근지구력이 낮으면 짐 옮기기·웨이트(헬스)·자전거를 권장 (KSPO 건강체력기준)",
    "근지구력": "근력·근지구력이 낮으면 짐 옮기기·웨이트(헬스)·자전거를 권장 (KSPO 건강체력기준)",
    "유연성": "유연성이 낮으면 스트레칭·요가·필라테스를 권장 (KSPO 건강체력기준)",
    "평형성": "평형성·민첩성이 낮은 어르신은 낙상예방·생활동작 운동을 권장 (KSPO 건강체력기준)",
    "민첩성": "평형성·민첩성이 낮은 어르신은 낙상예방·생활동작 운동을 권장 (KSPO 건강체력기준)",
}
# 수영·헬스·요가·필라테스는 Sport 노드에 직결(계약). 나머지는 Exercise/Goal.
KSPO_S_EDGES = [
    ("Sport", "수영", "심폐지구력"),
    ("Sport", "헬스", "근력"),
    ("Sport", "헬스", "근지구력"),
    ("Sport", "요가", "유연성"),
    ("Sport", "필라테스", "유연성"),
    ("Exercise", "걷기", "심폐지구력"),
    ("Exercise", "조깅", "심폐지구력"),
    ("Exercise", "자전거", "근력"),
    ("Exercise", "자전거", "근지구력"),
    ("Exercise", "짐 옮기기", "근력"),
    ("Exercise", "짐 옮기기", "근지구력"),
    ("Exercise", "스트레칭", "유연성"),
    ("Exercise", "생활동작", "평형성"),
    ("Exercise", "생활동작", "민첩성"),
    ("Goal", "낙상예방", "평형성"),
    ("Goal", "낙상예방", "민첩성"),
]
# KSPO 매핑에서 파생되는 시드 Exercise/Goal (영상에 없어도 노드 생성)
KSPO_SEED_EXERCISES = ["걷기", "조깅", "자전거", "짐 옮기기", "스트레칭", "생활동작"]
KSPO_SEED_GOALS = ["낙상예방"]

# ---------------------------------------------------------------------------
# A급: 정부·국제 지침 (source='guideline')
#   1) 청소년 뼈부하 주3일(점프): 줄넘기·농구·배구 → suits 청소년
#   2) 노인 평형성 주3일: 낙상예방 → suits 어르신
# ---------------------------------------------------------------------------
GUIDELINE_SUITS = [
    ("Sport", "줄넘기", "청소년",
     "청소년 뼈부하 운동 주3일(점프·달리기): 줄넘기·농구·배구 (복지부·WHO 2020)"),
    ("Sport", "농구", "청소년",
     "청소년 뼈부하 운동 주3일(점프·달리기): 줄넘기·농구·배구 (복지부·WHO 2020)"),
    ("Sport", "배구", "청소년",
     "청소년 뼈부하 운동 주3일(점프·달리기): 줄넘기·농구·배구 (복지부·WHO 2020)"),
    ("Goal", "낙상예방", "어르신",
     "노인 평형성 운동 주3일: 낙상예방 (복지부 2023·WHO 2020)"),
]

# ---------------------------------------------------------------------------
# B급: FITNESS_GRAPH §3 종목34×요인 매트릭스의 B티어 셀 (source='curated', pending)
#   rel='trains' (Sport→Factor), weight ●=0.5 / ○=0.3
#   컬럼 약칭 → canonical Factor. S/P/A 셀은 제외(B셀만).
# ---------------------------------------------------------------------------
COL = {"심폐": "심폐지구력", "근력": "근력", "근지구력": "근지구력", "유연": "유연성",
       "민첩": "민첩성", "순발": "순발력", "협응": "협응력", "평형": "평형성"}
# (DB 종목명 리스트, [(컬럼약칭, 마크)...])  — 그룹행은 각 DB 종목으로 전개
MATRIX_B: list[tuple[list[str], list[tuple[str, str]]]] = [
    (["수영"], [("근지구력", "○"), ("유연", "○")]),
    (["필라테스"], [("근지구력", "○"), ("평형", "○")]),
    (["에어로빅"], [("협응", "○")]),
    (["줄넘기"], [("협응", "○")]),
    (["태권도"], [("심폐", "○"), ("근지구력", "○"), ("유연", "●"),
                  ("민첩", "●"), ("순발", "●"), ("협응", "○")]),
    (["복싱"], [("심폐", "●"), ("근지구력", "○"), ("민첩", "●"), ("순발", "●")]),
    (["축구(풋살)"], [("심폐", "●"), ("민첩", "●"), ("순발", "○"), ("협응", "○")]),
    (["농구", "배구"], [("심폐", "●"), ("민첩", "○"), ("순발", "●"), ("협응", "○")]),
    (["배드민턴", "탁구", "테니스", "스쿼시"],
     [("심폐", "○"), ("민첩", "●"), ("순발", "○"), ("협응", "●")]),
    (["검도", "펜싱"], [("심폐", "○"), ("민첩", "●"), ("순발", "●"), ("협응", "○")]),
    (["유도", "주짓수", "합기도"],
     [("근력", "●"), ("근지구력", "●"), ("유연", "○"), ("평형", "○")]),
    (["클라이밍", "클라이밍(암벽등반)"],
     [("근력", "●"), ("근지구력", "●"), ("유연", "○"), ("협응", "●")]),
    (["크로스핏"], [("심폐", "●"), ("근력", "●"), ("근지구력", "●"), ("순발", "○")]),
    (["댄스(줌바 등)", "무용(발레 등)"],
     [("심폐", "●"), ("유연", "●"), ("협응", "●"), ("평형", "○")]),
    (["골프"], [("유연", "○"), ("순발", "○"), ("협응", "●")]),
    (["볼링", "당구", "야구"], [("순발", "○"), ("협응", "●")]),
    (["롤러인라인", "빙상(스케이트)"], [("심폐", "○"), ("민첩", "○"), ("평형", "●")]),
    (["승마"], [("근지구력", "○"), ("평형", "●")]),
]


# ---------------------------------------------------------------------------
# 빌드
# ---------------------------------------------------------------------------
SCHEMA = """
DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
CREATE TABLE graph_nodes (
    id    TEXT PRIMARY KEY,   -- 'factor:심폐지구력' 등 type:name
    type  TEXT,               -- Factor|Sport|Exercise|AgeGroup|Goal
    name  TEXT,
    attrs TEXT                -- JSON
);
CREATE TABLE graph_edges (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    src            TEXT,   -- graph_nodes.id
    dst            TEXT,   -- graph_nodes.id
    rel            TEXT,   -- improves|suits|targets|trains
    source         TEXT,   -- kspo_standard|kspo_video|guideline|curated
    evidence       TEXT,   -- 원문/URL/빈도 (JSON)
    weight         REAL,
    curated_status TEXT    -- pending(B급) | NULL
);
CREATE INDEX idx_ge_dst  ON graph_edges(dst, rel);
CREATE INDEX idx_ge_src  ON graph_edges(src, rel);
CREATE INDEX idx_ge_src2 ON graph_edges(source);
CREATE INDEX idx_gn_type ON graph_nodes(type);
"""


def nid(typ: str, name: str) -> str:
    return f"{typ.lower()}:{name}"


class GraphBuilder:
    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        # edge key (src,dst,rel,source) -> row dict (evidence 병합)
        self.edges: dict[tuple, dict] = {}

    def add_node(self, typ: str, name: str, **attrs) -> str:
        i = nid(typ, name)
        node = self.nodes.get(i)
        if node is None:
            self.nodes[i] = {"id": i, "type": typ, "name": name, "attrs": attrs}
        else:
            node["attrs"].update({k: v for k, v in attrs.items() if v is not None})
        return i

    def add_edge(self, src: str, dst: str, rel: str, source: str, weight: float,
                 evidence: dict, curated_status=None) -> None:
        key = (src, dst, rel, source)
        row = self.edges.get(key)
        if row is None:
            self.edges[key] = {
                "src": src, "dst": dst, "rel": rel, "source": source,
                "weight": weight, "curated_status": curated_status,
                "evidence": dict(evidence),
            }
        else:
            # 같은 엣지 재관측 → op별 건수 등 evidence 병합
            for k, v in evidence.items():
                if isinstance(v, int) and isinstance(row["evidence"].get(k), int):
                    row["evidence"][k] += v
                else:
                    row["evidence"].setdefault(k, v)
            row["weight"] = max(row["weight"], weight)


def build(conn: sqlite3.Connection) -> dict:
    g = GraphBuilder()

    # ---- 노드: Factor / AgeGroup ----
    for f in FACTORS:
        g.add_node("Factor", f)
    for a in AGE_GROUPS:
        g.add_node("AgeGroup", a)

    # ---- 노드: Sport (courses.sport DISTINCT) ----
    sports = [r[0] for r in conn.execute(
        "SELECT DISTINCT sport FROM courses WHERE sport IS NOT NULL AND sport<>'' "
        "ORDER BY sport").fetchall()]
    for s in sports:
        g.add_node("Sport", s)
    sport_set = set(sports)

    # ---- 노드: Exercise (videos.trng_nm 정규화 distinct) + attrs(ops/건수) ----
    ex_ops: dict[str, set] = defaultdict(set)
    ex_count: dict[str, int] = defaultdict(int)
    for op, trng in conn.execute(
            "SELECT op, trng_nm FROM videos WHERE trng_nm IS NOT NULL AND trng_nm<>''"):
        name = norm_ws(trng)
        if not name:
            continue
        ex_ops[name].add(op)
        ex_count[name] += 1
    for name in ex_ops:
        g.add_node("Exercise", name,
                   video_count=ex_count[name], ops=sorted(ex_ops[name]))
    for name in KSPO_SEED_EXERCISES:                 # 시드(영상에 없어도 생성)
        g.add_node("Exercise", name, kspo_seed=True)

    # ---- 노드: Goal (videos.trng_aim_nm 정규화 distinct) ----
    goal_count: dict[str, int] = defaultdict(int)
    for (aim,) in conn.execute(
            "SELECT aim FROM videos WHERE aim IS NOT NULL AND aim<>''"):
        gname = norm_goal(aim)
        if gname:
            goal_count[gname] += 1
    for gname in goal_count:
        g.add_node("Goal", gname, video_count=goal_count[gname])
    for gname in KSPO_SEED_GOALS:                    # 낙상예방 시드 보장
        g.add_node("Goal", gname)

    # =====================================================================
    # 엣지
    # =====================================================================
    # ---- S급: KSPO 공식 매핑 (improves, kspo_standard) ----
    for src_type, src_name, factor in KSPO_S_EDGES:
        if src_type == "Sport" and src_name not in sport_set:
            continue  # 강좌DB에 없는 종목이면 skip(정직성)
        src = g.add_node(src_type, src_name)
        dst = nid("Factor", factor)
        g.add_edge(src, dst, "improves", "kspo_standard", 1.0,
                   {"text": KSPO_EVIDENCE.get(factor, ""), "url": KSPO_URL})

    # ---- V급: 영상 분류축 (kspo_video) ----
    # improves: ftns_fctr_nm → Factor (요인 있는 op: GUIDE/ROUTINE/FTNS_CERT)
    fctr_rows = conn.execute(
        "SELECT op, trng_nm, factor FROM videos WHERE factor IS NOT NULL AND factor<>''"
    ).fetchall()
    for op, trng, factor in fctr_rows:
        ex = norm_ws(trng)
        if not ex:
            continue
        for f in norm_factor(factor):
            g.add_edge(nid("Exercise", ex), nid("Factor", f), "improves",
                       "kspo_video", TIER_WEIGHT["kspo_video"], {op: 1})
    # suits: aggrp_nm → AgeGroup (전 op; '공통'→전 연령군; dedup)
    agg_rows = conn.execute(
        "SELECT DISTINCT trng_nm, aggrp FROM videos WHERE aggrp IS NOT NULL AND aggrp<>''"
    ).fetchall()
    for trng, aggrp in agg_rows:
        ex = norm_ws(trng)
        if not ex:
            continue
        for a in norm_age(aggrp):
            g.add_edge(nid("Exercise", ex), nid("AgeGroup", a), "suits",
                       "kspo_video", TIER_WEIGHT["kspo_video"], {"aggrp": aggrp})
    # targets: trng_aim_nm → Goal (ROUTINE)
    aim_rows = conn.execute(
        "SELECT DISTINCT trng_nm, aim FROM videos WHERE aim IS NOT NULL AND aim<>''"
    ).fetchall()
    for trng, aim in aim_rows:
        ex = norm_ws(trng)
        gname = norm_goal(aim)
        if ex and gname:
            g.add_edge(nid("Exercise", ex), nid("Goal", gname), "targets",
                       "kspo_video", TIER_WEIGHT["kspo_video"], {"aim": aim})

    # ---- A급: 지침 (suits, guideline) ----
    for src_type, src_name, age, text in GUIDELINE_SUITS:
        if src_type == "Sport" and src_name not in sport_set:
            continue
        src = g.add_node(src_type, src_name)
        g.add_edge(src, nid("AgeGroup", age), "suits", "guideline",
                   TIER_WEIGHT["guideline"], {"text": text})

    # ---- B급: §3 매트릭스 (trains, curated, pending) ----
    for db_sports, cells in MATRIX_B:
        for sp in db_sports:
            if sp not in sport_set:
                print(f"[warn] 매트릭스 종목 '{sp}' 가 courses.sport 에 없음 → skip",
                      file=sys.stderr)
                continue
            for col_abbr, mark in cells:
                factor = COL[col_abbr]
                g.add_edge(nid("Sport", sp), nid("Factor", factor), "trains",
                           "curated", MARK_WEIGHT[mark],
                           {"matrix": f"{'주효과' if mark=='●' else '부효과'}({mark})",
                            "note": "FITNESS_GRAPH §3 · 체대 검증 대기"},
                           curated_status="pending")

    # =====================================================================
    # 적재
    # =====================================================================
    conn.executescript(SCHEMA)
    for n in g.nodes.values():
        conn.execute(
            "INSERT INTO graph_nodes (id, type, name, attrs) VALUES (?,?,?,?)",
            (n["id"], n["type"], n["name"], json.dumps(n["attrs"], ensure_ascii=False)))
    for e in g.edges.values():
        conn.execute(
            "INSERT INTO graph_edges (src, dst, rel, source, evidence, weight, curated_status) "
            "VALUES (?,?,?,?,?,?,?)",
            (e["src"], e["dst"], e["rel"], e["source"],
             json.dumps(e["evidence"], ensure_ascii=False), e["weight"],
             e["curated_status"]))
    conn.commit()
    return _stats(conn)


# ---------------------------------------------------------------------------
# 통계
# ---------------------------------------------------------------------------
def _stats(conn: sqlite3.Connection) -> dict:
    q = conn.execute
    nodes_by_type = dict(q(
        "SELECT type, COUNT(*) FROM graph_nodes GROUP BY type ORDER BY type").fetchall())
    edges_total = q("SELECT COUNT(*) FROM graph_edges").fetchone()[0]
    edges_by_source = dict(q(
        "SELECT source, COUNT(*) FROM graph_edges GROUP BY source ORDER BY source").fetchall())
    edges_by_rel = dict(q(
        "SELECT rel, COUNT(*) FROM graph_edges GROUP BY rel ORDER BY rel").fetchall())
    # 요인별 연결 운동 수 (improves Exercise→Factor)
    per_factor = q(
        "SELECT n.name, COUNT(DISTINCT e.src) "
        "FROM graph_edges e JOIN graph_nodes n ON n.id=e.dst "
        "WHERE e.rel='improves' AND n.type='Factor' "
        "AND e.src IN (SELECT id FROM graph_nodes WHERE type='Exercise') "
        "GROUP BY n.name ORDER BY 2 DESC").fetchall()
    # 요인별 연결 종목 수 (improves/trains Sport→Factor)
    per_factor_sport = q(
        "SELECT n.name, COUNT(DISTINCT e.src) "
        "FROM graph_edges e JOIN graph_nodes n ON n.id=e.dst "
        "WHERE n.type='Factor' AND e.src IN (SELECT id FROM graph_nodes WHERE type='Sport') "
        "GROUP BY n.name ORDER BY 2 DESC").fetchall()
    # 고아 노드 (엣지 미접속)
    orphans = q(
        "SELECT type, name FROM graph_nodes "
        "WHERE id NOT IN (SELECT src FROM graph_edges UNION SELECT dst FROM graph_edges) "
        "ORDER BY type, name").fetchall()
    return {
        "nodes_by_type": nodes_by_type,
        "nodes_total": sum(nodes_by_type.values()),
        "edges_total": edges_total,
        "edges_by_source": edges_by_source,
        "edges_by_rel": edges_by_rel,
        "per_factor_exercise": per_factor,
        "per_factor_sport": per_factor_sport,
        "orphans": orphans,
    }


def print_stats(st: dict) -> None:
    print("\n[build_graph] 그래프 적재 완료")
    print(f"  노드 {st['nodes_total']}개: " +
          " · ".join(f"{t}={c}" for t, c in st["nodes_by_type"].items()))
    tier_label = {"kspo_standard": "S", "guideline": "A", "kspo_video": "V", "curated": "B"}
    print(f"  엣지 {st['edges_total']}개 (티어별): " +
          " · ".join(f"{tier_label.get(s,'?')}/{s}={c}"
                     for s, c in st["edges_by_source"].items()))
    print(f"  rel별: " + " · ".join(f"{r}={c}" for r, c in st["edges_by_rel"].items()))
    print("  요인별 연결 운동 수:")
    for name, c in st["per_factor_exercise"]:
        print(f"      {name:8s} {c:4d}")
    print("  요인별 연결 종목 수:")
    for name, c in st["per_factor_sport"]:
        print(f"      {name:8s} {c:4d}")
    orphans = st["orphans"]
    print(f"  고아 노드 {len(orphans)}개" +
          (": " + ", ".join(f"{t}:{n}" for t, n in orphans) if orphans else ""))


def main() -> None:
    ap = argparse.ArgumentParser(description="체력 지식그래프 빌드")
    ap.add_argument("--db", default=str(DB_PATH))
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)
    try:
        for tbl in ("videos", "courses"):
            n = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                (tbl,)).fetchone()[0]
            if not n:
                sys.exit(f"[build_graph] '{tbl}' 테이블 없음 — "
                         f"{'fetch_videos.py' if tbl=='videos' else 'build_db.py'} 먼저 실행")
        st = build(conn)
    finally:
        conn.close()
    print_stats(st)


if __name__ == "__main__":
    main()
