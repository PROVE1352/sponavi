#!/usr/bin/env python3
"""M1a — 국민체력100 인증기준(등급 컷오프) 스크레이퍼.

단일 서버렌더 페이지(로그인 불필요, User-Agent 필요)를 1회 fetch 하여 파싱하고,
sponavi.db 에 두 테이블을 idempotent 하게 적재한다.

  measurement_item(code PK, name, unit, factor, age_groups, higher_better, alt_group)
  fitness_norm(item_code, sex, age_min, age_max, grade, cut_value, cut_rule, source, checked)

연령군: 유소년기(11~12)/청소년기(13~18)/성인기(19~64)/어르신기(65+).
  * 유아기(만4~6)는 4단계 비인증(열매/꽃/새싹/씨앗) — 적재 대상 아님(스킵).
  * 등급은 1·2·3만 적재. 4~6등급은 숫자표가 없고 코드 파생 규칙(fitness.py)이 담당.
  * 어르신 4~6등급 축소세트(절대악력·8자보행)는 스킵.

파서 주의(실측 반영):
  - thead 3행: (성별/연령 | 요인 colspan | 항목명+단위). 3번째 행(항목명)이 열 정의 원천.
  - 같은 요인 2열 colspan = 택1 대체항목(심폐 20m왕복/스텝, 성인 민첩 10m왕복/반응,
    순발 멀리뛰기/체공, 어르신 심폐 2분/6분걷기, 청소년 근지구력 윗몸/반복점프) → alt_group.
    단 어르신 "근지능 (상지, 하지)" colspan=2 는 택1 아님(상지=근력·하지=근지구력, 분리).
  - tbody 는 rowspan/colspan 을 그리드로 해소(성별 셀·성인 3등급 신체조성 셀이 rowspan).
  - 3등급표는 운동체력 대신 신체조성(BMI·체지방률·WHtR) — 부등호/범위 문자열 셀은 cut_rule.

사용:
  python scripts/scrape_norms.py               # 라이브 fetch → data/sponavi.db
  python scripts/scrape_norms.py --html a.html # 로컬 캐시 파싱(오프라인)
  python scripts/scrape_norms.py --db /tmp/x.db
"""
from __future__ import annotations

import argparse
import html as _html
import re
import sqlite3
import sys
import urllib.request
from pathlib import Path

URL = "https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
SOURCE = "문체부 고시 체계·nfa 인증기준(2026-07-21 확인)"
CHECKED = "2026-07-21"

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / "data" / "sponavi.db"

GROUP_ORDER = ["유소년", "청소년", "성인", "어르신"]

# ---------------------------------------------------------------------------
# 항목 카탈로그 — 정규화된 표 헤더(항목명+단위) → 정식 항목 정의.
# 항목별 factor / higher_better / alt_group(택1 쌍 키) 는 문체부 고시 체계에 따라 고정.
# (label, code, name, unit, factor, higher_better, alt_group)
#   higher_better: 1=높을수록 좋음, 0=낮을수록(시간계) 좋음, None=신체조성(범위 규칙).
# ---------------------------------------------------------------------------
_ITEM_TABLE: list[tuple] = [
    # 심폐지구력
    ("15m 왕복 오래달리기 (회)", "shuttle_15m", "15m 왕복 오래달리기", "회", "심폐지구력", 1, None),
    ("20m 왕복 오래달리기 (회)", "shuttle_20m", "20m 왕복 오래달리기", "회", "심폐지구력", 1, "심폐_왕복스텝"),
    ("트레드밀/ 스텝검사 (ml/kg/min)", "treadmill_step", "트레드밀/스텝검사", "ml/kg/min", "심폐지구력", 1, "심폐_왕복스텝"),
    ("2분 제자리 걷기 (회)", "walk_2min", "2분 제자리 걷기", "회", "심폐지구력", 1, "심폐_걷기"),
    ("6분 걷기 (m)", "walk_6min", "6분 걷기", "m", "심폐지구력", 1, "심폐_걷기"),
    # 근력
    ("상대악력 (%)", "grip_rel", "상대악력", "%", "근력", 1, None),
    # 근지구력
    ("윗몸말아 올리기 (회)", "situp_roll", "윗몸말아올리기", "회", "근지구력", 1, "근지구력_윗몸반복점프"),
    ("반복점프 (회)", "repeat_jump", "반복점프", "회", "근지구력", 1, "근지구력_윗몸반복점프"),
    ("교차윗몸 일으키기 (회)", "crunch_cross", "교차윗몸 일으키기", "회", "근지구력", 1, None),
    ("의자에 앉았다 일어서기 (30초/회)", "chair_stand", "의자에 앉았다 일어서기", "30초/회", "근지구력", 1, None),
    # 유연성
    ("앉아윗몸 앞으로 굽히기 (cm)", "sit_reach", "앉아윗몸 앞으로 굽히기", "cm", "유연성", 1, None),
    ("앉아 윗몸 앞으로 굽히기 (cm)", "sit_reach", "앉아윗몸 앞으로 굽히기", "cm", "유연성", 1, None),
    # 민첩성
    ("반복 옆뛰기 (회)", "side_step", "반복 옆뛰기", "회", "민첩성", 1, None),
    ("일리노이 (초)", "illinois", "일리노이 검사", "초", "민첩성", 0, None),
    ("10미터 왕복 달리기 (초)", "shuttle_10m_run", "10m 왕복 달리기", "초", "민첩성", 0, "민첩성_10m반응"),
    ("반응시간 (초)", "reaction_time", "반응시간", "초", "민첩성", 0, "민첩성_10m반응"),
    # 순발력  (체공시간은 시간계지만 길수록 좋음 → higher_better=1)
    ("제자리 멀리뛰기 (cm)", "standing_jump", "제자리 멀리뛰기", "cm", "순발력", 1, "순발력_멀리뛰기체공"),
    ("체공시간 (초)", "air_time", "체공시간", "초", "순발력", 1, "순발력_멀리뛰기체공"),
    # 협응력 (유소년=회 클수록 / 청소년=초 짧을수록 → 코드·higher_better 분리)
    ("눈-손 협응력 검사 (회)", "eyehand_cnt", "눈-손 협응력 검사", "회", "협응력", 1, None),
    ("눈-손 협응력 검사 (초)", "eyehand_sec", "눈-손 협응력 검사", "초", "협응력", 0, None),
    ("8자보행 (초)", "fig8_walk", "8자보행", "초", "협응력", 0, None),
    # 평형성 (어르신 3m 왕복 걷기)
    ("3m (초)", "agility_3m", "3m 왕복 걷기", "초", "평형성", 0, None),
    # 신체조성 (3등급 — 범위/부등호 문자열 → cut_rule)
    ("BMI (㎏/㎡)", "bmi", "BMI", "㎏/㎡", "신체조성", None, None),
    ("허리둘레 -신장비 (WHtR)", "whtr", "허리둘레-신장비", "WHtR", "신체조성", None, None),
    ("체지방률 (%)", "body_fat", "체지방률", "%", "신체조성", None, None),
]


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", _html.unescape(s or ""))


ITEM_DEFS: dict[str, dict] = {}
for _label, _code, _name, _unit, _factor, _hb, _alt in _ITEM_TABLE:
    ITEM_DEFS[_norm(_label)] = {
        "code": _code, "name": _name, "unit": _unit,
        "factor": _factor, "higher_better": _hb, "alt_group": _alt,
    }


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------
def fetch_html(url: str = URL, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# HTML → cell rows → rowspan/colspan grid
# ---------------------------------------------------------------------------
def _clean(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", _html.unescape(s)).strip()


class _Cell:
    __slots__ = ("text", "rs", "cs")

    def __init__(self, text: str, rs: int, cs: int) -> None:
        self.text, self.rs, self.cs = text, rs, cs


def _cell_rows(section_html: str) -> list[list[_Cell]]:
    rows: list[list[_Cell]] = []
    for tr in re.findall(r"<tr>(.*?)</tr>", section_html, re.S):
        cells: list[_Cell] = []
        for m in re.finditer(r"<t[hd]([^>]*)>(.*?)</t[hd]>", tr, re.S):
            attrs = m.group(1)
            rs = int((re.search(r'rowspan="(\d+)"', attrs) or [0, "1"])[1])
            cs = int((re.search(r'colspan="(\d+)"', attrs) or [0, "1"])[1])
            cells.append(_Cell(_clean(m.group(2)), rs, cs))
        rows.append(cells)
    return rows


def _build_grid(cell_rows: list[list[_Cell]]) -> list[list[str]]:
    """rowspan/colspan 을 해소한 2차원 텍스트 그리드."""
    grid: list[list[str]] = []
    pending: dict[int, tuple[str, int]] = {}  # col -> (text, remaining_rows)
    for cells in cell_rows:
        row: dict[int, str] = {}
        col = 0
        oi = 0
        while oi < len(cells) or any(rem > 0 for _, rem in pending.values()):
            if col in pending and pending[col][1] > 0:
                txt, rem = pending[col]
                row[col] = txt
                pending[col] = (txt, rem - 1)
                col += 1
                continue
            if oi < len(cells):
                cell = cells[oi]
                oi += 1
                for k in range(cell.cs):
                    row[col + k] = cell.text
                    if cell.rs > 1:
                        pending[col + k] = (cell.text, cell.rs - 1)
                col += cell.cs
                continue
            break
        pending = {k: v for k, v in pending.items() if v[1] > 0}
        width = (max(row) + 1) if row else 0
        grid.append([row.get(i, "") for i in range(width)])
    return grid


# ---------------------------------------------------------------------------
# section / grade splitting
# ---------------------------------------------------------------------------
def _sections(html: str) -> list[tuple[str, str]]:
    """(group_key, section_html) — 유아기 제외, 성인기 CLOSE 이후 전체가 어르신기."""

    def find(marker_regex: str) -> int:
        m = re.search(marker_regex, html)
        if not m:
            raise ValueError(f"marker not found: {marker_regex}")
        return m.start()

    o_youth = find(r"<!--\s*유소년기\s*-->")
    o_teen = find(r"<!--\s*청소년기\s*-->")
    o_adult = find(r"<!--\s*성인기\s*-->")
    c_adult = find(r"<!--\s*//\s*성인기\s*-->")
    return [
        ("유소년", html[o_youth:o_teen]),
        ("청소년", html[o_teen:o_adult]),
        ("성인", html[o_adult:c_adult]),
        ("어르신", html[c_adult:]),
    ]


def _grade_tables(section_html: str):
    """yield (grade:int, sex:'M'/'F', items:list[str], grid) — thead 있는 데이터표만."""
    parts = re.split(r"comGradeTit grade(\d)", section_html)
    for i in range(1, len(parts), 2):
        grade = int(parts[i])
        chunk = parts[i + 1]
        for mm in re.finditer(r"<!-- (남자|여자) 등급 -->(.*?)</table>", chunk, re.S):
            sex = "M" if mm.group(1) == "남자" else "F"
            tbl = mm.group(2) + "</table>"
            thead = re.search(r"<thead>(.*?)</thead>", tbl, re.S)
            tbody = re.search(r"<tbody>(.*?)</tbody>", tbl, re.S)
            if not thead or not tbody:
                continue
            head = _cell_rows(thead.group(1))
            if len(head) < 3:
                continue
            items = [c.text for c in head[2]]
            grid = _build_grid(_cell_rows(tbody.group(1)))
            yield grade, sex, items, grid


# ---------------------------------------------------------------------------
# value / age helpers
# ---------------------------------------------------------------------------
def _parse_age(s: str) -> tuple[int, int]:
    s = s.strip()
    if "이상" in s:
        return int(re.search(r"\d+", s).group()), 200
    m = re.match(r"(\d+)\s*~\s*(\d+)", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    if re.fullmatch(r"\d+", s):
        return int(s), int(s)
    raise ValueError(f"unparseable age band: {s!r}")


def _classify(v: str):
    """('num', float) | ('rule', str) | ('empty', None)."""
    v = v.strip()
    if not v:
        return "empty", None
    if re.fullmatch(r"-?\d+(?:\.\d+)?", v):
        return "num", float(v)
    return "rule", v


# ---------------------------------------------------------------------------
# parse whole document
# ---------------------------------------------------------------------------
def parse_norms(html: str):
    """→ (items: dict[code]->def(+age_groups set), norms: list[dict])."""
    items: dict[str, dict] = {}
    norms: list[dict] = []

    for group, sec_html in _sections(html):
        for grade, sex, labels, grid in _grade_tables(sec_html):
            if grade not in (1, 2, 3):
                continue  # 4~6등급은 코드 파생(어르신 축소세트 포함 스킵)
            defs = []
            for lab in labels:
                d = ITEM_DEFS.get(_norm(lab))
                if d is None:
                    raise ValueError(
                        f"unknown measurement item {lab!r} "
                        f"({group} {grade}등급 {sex}) — 카탈로그 미등록"
                    )
                defs.append(d)
            for row in grid:
                if len(row) < 2:
                    continue
                age_txt = row[1]
                try:
                    age_min, age_max = _parse_age(age_txt)
                except ValueError:
                    continue
                for col, d in enumerate(defs):
                    idx = 2 + col
                    if idx >= len(row):
                        continue
                    kind, val = _classify(row[idx])
                    if kind == "empty":
                        continue
                    code = d["code"]
                    it = items.setdefault(
                        code, {**d, "groups": set()}
                    )
                    it["groups"].add(group)
                    norms.append({
                        "item_code": code,
                        "sex": sex,
                        "age_min": age_min,
                        "age_max": age_max,
                        "grade": grade,
                        "cut_value": val if kind == "num" else None,
                        "cut_rule": val if kind == "rule" else None,
                    })
    return items, norms


# ---------------------------------------------------------------------------
# DB load (idempotent: drop + recreate only these two tables)
# ---------------------------------------------------------------------------
def create_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS fitness_norm;
        DROP TABLE IF EXISTS measurement_item;
        CREATE TABLE measurement_item (
            code          TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            unit          TEXT,
            factor        TEXT NOT NULL,
            age_groups    TEXT,            -- comma-joined group keys
            higher_better INTEGER,         -- 1 | 0 | NULL(신체조성)
            alt_group     TEXT             -- 택1 쌍 묶음 키 | NULL
        );
        CREATE TABLE fitness_norm (
            item_code TEXT NOT NULL,
            sex       TEXT NOT NULL,       -- 'M' | 'F'
            age_min   INTEGER NOT NULL,
            age_max   INTEGER NOT NULL,
            grade     INTEGER NOT NULL,    -- 1 | 2 | 3
            cut_value REAL,                -- 숫자 컷 (NULL 이면 cut_rule)
            cut_rule  TEXT,                -- 문자열 규칙 (범위/부등호)
            source    TEXT,
            checked   TEXT,
            FOREIGN KEY (item_code) REFERENCES measurement_item(code)
        );
        CREATE INDEX idx_norm_lookup ON fitness_norm(item_code, sex, age_min, age_max, grade);
        CREATE INDEX idx_norm_age ON fitness_norm(age_min, age_max, sex);
        """
    )


def load(conn: sqlite3.Connection, items: dict, norms: list) -> None:
    for code, d in items.items():
        groups = ",".join(g for g in GROUP_ORDER if g in d["groups"])
        conn.execute(
            "INSERT INTO measurement_item "
            "(code, name, unit, factor, age_groups, higher_better, alt_group) "
            "VALUES (?,?,?,?,?,?,?)",
            (code, d["name"], d["unit"], d["factor"], groups,
             d["higher_better"], d["alt_group"]),
        )
    for n in norms:
        conn.execute(
            "INSERT INTO fitness_norm "
            "(item_code, sex, age_min, age_max, grade, cut_value, cut_rule, source, checked) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (n["item_code"], n["sex"], n["age_min"], n["age_max"], n["grade"],
             n["cut_value"], n["cut_rule"], SOURCE, CHECKED),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# self-verification against hand-checked samples (fail-closed gate)
# ---------------------------------------------------------------------------
SAMPLES = [
    ("성인 1등급 남 19~24세", "M", 19, 1, {
        "shuttle_20m": 62, "treadmill_step": 47.6, "grip_rel": 62.6,
        "crunch_cross": 55, "sit_reach": 16.1, "shuttle_10m_run": 9.9,
        "reaction_time": 0.301, "standing_jump": 229, "air_time": 0.605,
    }),
    ("어르신 1등급 남 65~69세", "M", 65, 1, {
        "walk_2min": 122, "walk_6min": 677, "grip_rel": 55.3,
        "chair_stand": 25, "sit_reach": 11.4, "agility_3m": 5.3,
        "fig8_walk": 21.0,
    }),
    ("유소년 1등급 남 11세", "M", 11, 1, {
        "shuttle_15m": 77, "grip_rel": 46.5, "situp_roll": 36,
        "sit_reach": 11.5, "side_step": 33, "standing_jump": 161.0,
        "eyehand_cnt": 18,
    }),
]


def verify(conn: sqlite3.Connection) -> tuple[bool, list[str]]:
    ok = True
    report: list[str] = []
    for desc, sex, age, grade, expect in SAMPLES:
        report.append(f"[{desc}]")
        for code, exp in expect.items():
            cur = conn.execute(
                "SELECT cut_value FROM fitness_norm "
                "WHERE item_code=? AND sex=? AND grade=? "
                "AND age_min<=? AND age_max>=?",
                (code, sex, grade, age, age),
            )
            row = cur.fetchone()
            got = row[0] if row else None
            match = got is not None and abs(got - float(exp)) < 1e-9
            ok = ok and match
            report.append(
                f"  {'OK ' if match else 'FAIL'} {code:16s} expect={exp} got={got}"
            )
    return ok, report


# ---------------------------------------------------------------------------
# orchestration
# ---------------------------------------------------------------------------
def build(db_path: str | Path, html: str | None = None) -> dict:
    if html is None:
        html = fetch_html()
    items, norms = parse_norms(html)
    conn = sqlite3.connect(str(db_path))
    try:
        create_tables(conn)
        load(conn, items, norms)
        ok, report = verify(conn)
    finally:
        conn.close()
    # per (group x sex x grade) counts
    by = {}
    for n in norms:
        # resolve group from age range against known group bands
        for g, lo, hi in [("유소년", 11, 12), ("청소년", 13, 18),
                          ("성인", 19, 64), ("어르신", 65, 200)]:
            if lo <= n["age_min"] <= hi:
                key = (g, n["sex"], n["grade"])
                by[key] = by.get(key, 0) + 1
                break
    return {
        "items": len(items), "norms": len(norms),
        "by_group": by, "verify": report, "ok": ok, "html_bytes": len(html),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="scrape 국민체력100 인증기준 → sponavi.db")
    ap.add_argument("--db", default=str(DEFAULT_DB), help="target sqlite (default data/sponavi.db)")
    ap.add_argument("--html", default=None, help="parse a local HTML file instead of fetching")
    args = ap.parse_args(argv)

    html = None
    if args.html:
        html = Path(args.html).read_text(encoding="utf-8")

    r = build(args.db, html=html)

    print(f"fetched/parsed HTML: {r['html_bytes']:,} bytes")
    print(f"measurement_item rows: {r['items']}")
    print(f"fitness_norm rows: {r['norms']}")
    print("적재 행수 (연령군 × 성별 × 등급):")
    for (g, s, gr) in sorted(r["by_group"], key=lambda k: (GROUP_ORDER.index(k[0]), k[1], k[2])):
        print(f"  {g:4s} {s} {gr}등급: {r['by_group'][(g, s, gr)]}")
    print("\n수기 대조 검증:")
    for line in r["verify"]:
        print(line)
    if not r["ok"]:
        print("\n[FAIL] 수기 대조 표본 불일치 — 적재 중단/검토 필요", file=sys.stderr)
        return 1
    print(f"\n[OK] 전 표본 일치. DB={args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
