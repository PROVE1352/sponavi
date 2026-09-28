#!/usr/bin/env python3
"""SQLite → 정적 `web/public/gap.html` (W3 "뒷면").

앞면(챗 UI)이 시민에게 "지금 바로 되는 것"을 보여준다면, 뒷면은 공단·지자체가
**다음에 할 수 있는 일**을 고르는 표 1장이다. 페이지 제목은 "가맹 유치 우선순위" —
지역을 줄 세우는 순위표가 아니라 전환·확대 대상 후보 목록이다(3심 판사3: 공급공백은
안내로 배치한다).

## 무엇을 세나
시군구(현행 코드) 1행당
  · 장애인 가맹 = facilities(source='dvoucher')
  · 일반 가맹   = facilities(source='voucher')
  · 공공시설    = facilities(source='public' AND faci_gb='공공')   ← **신고·등록 제외**
  · (접기) 신고 / 등록 = 같은 원천의 나머지 두 구분

`source='public'` 을 통째로 "공공체육시설"이라 부르면 70%가 거짓이다
(raw `faci_gb_nm` 기준 신고 73,544 · 공공 43,691 · 등록 628, OV6/E-17).
그래서 이 표의 "공공시설" 열은 `faci_gb='공공'` 만 센다.

## 왜 233행이 아니라 228행인가
2026-07-01 인천 행정체제 개편으로 한 생활권이 옛/신 코드 여럿에 걸쳐 있고 원천이
그 코드들을 섞어 쓴다(옛 서구 28260 은 voucher 383·dvoucher 0). 코드 하나만 세면
"장애인 가맹 0곳"이라는 **거짓 공급공백**이 만들어진다(P-1 위반). 구 단위 카운트는
`region.count_scope` 의 영역그룹대로 합산한다 — engine `_supply_gap` 과 같은 표,
같은 함수. 233 - (3→1) - (4→1) = **228행**.

## 제안 열 (첫 매칭 우선)
  ① dvoucher == 0 ∧ 공공 ≥ 1  → "공공시설 N곳 가맹 전환 후보"
  ② dvoucher == 0 ∧ 공공 == 0  → "—"
  ③ dvoucher ≤ 2 ∧ 공공 ≥ T   → "가맹 확대 후보(공공시설 N곳)"
  ④ 그 외                      → ""
T 는 공공-only 재집계 뒤에야 정할 수 있다(Reviewer Concern 1) → **228행 공공 분포의
75퍼센타일(선형보간, 반올림)** 을 쓴다. 실측 2026-08-27 적재본 기준 T=247.

## 산출물
`web/public/gap.html` (+ `web/public/gap.js`). CSP 가 `script-src 'self'` 라 인라인
스크립트는 차단된다 → 정렬·검색 JS 는 같은 폴더의 외부 파일로 둔다. 스타일은
`style-src 'unsafe-inline'` 이 허용되므로 인라인 `<style>` 로 자급한다(외부 CDN 0).
Vite 가 `web/public/` 을 `web/dist/` 로 복사하므로 배포 파이프라인 변경은 없다.

멱등: 같은 DB → 바이트 동일 출력(데이터 기준일 외에 시각을 찍지 않는다).

Usage: python3 scripts/build_gap.py [--db PATH] [--out PATH] [--threshold N] [--quiet]
"""
from __future__ import annotations

import argparse
import html
import math
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app import region  # noqa: E402  (영역그룹·시도명 — engine 과 같은 표)
from app import store as store_mod  # noqa: E402  (카운트 헬퍼를 재유도하지 않고 재사용)

DEFAULT_OUT = REPO_ROOT / "web" / "public" / "gap.html"
KST = timezone(timedelta(hours=9))

PAGE_TITLE = (
    "가맹 유치 우선순위 — 시군구별 장애인스포츠강좌이용권 가맹 현황과 공공체육시설 후보"
)
SHORT_TITLE = "가맹 유치 우선순위"

# 제안 열 정렬 순위(= 행동 가능성 순). 규칙 평가 순서(첫 매칭)와는 별개다.
RANK_CONVERT = 1   # 가맹 전환 후보
RANK_EXPAND = 2    # 가맹 확대 후보
RANK_NO_SEED = 3   # 전환할 공공시설이 없음("—")
RANK_NONE = 4      # 해당 없음("")


# ---------------------------------------------------------------------------
# 제안 규칙
# ---------------------------------------------------------------------------
def suggest(dvoucher: int, public_cnt: int, threshold: int) -> tuple[str, int]:
    """(문구, 정렬순위) — **첫 매칭 우선**.

    평가 순서는 아래 그대로다. ①이 먼저이므로 dvoucher==0 이면 공공이 아무리 많아도
    ③("확대")이 아니라 ①("전환")이 붙는다 — 가맹이 하나도 없는 곳에 "확대"는 말이
    되지 않는다.
    """
    if dvoucher == 0 and public_cnt >= 1:
        return f"공공시설 {public_cnt:,}곳 가맹 전환 후보", RANK_CONVERT
    if dvoucher == 0 and public_cnt == 0:
        return "—", RANK_NO_SEED
    if dvoucher <= 2 and public_cnt >= threshold:
        return f"가맹 확대 후보(공공시설 {public_cnt:,}곳)", RANK_EXPAND
    return "", RANK_NONE


def percentile(values: list[int], p: float) -> float:
    """선형보간 백분위(numpy 기본과 같은 정의). 외부 의존 없이 결정론적으로."""
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return float(ordered[int(k)])
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def threshold_from(public_counts: list[int]) -> int:
    """T = 공공시설 수 분포의 75퍼센타일(반올림) = 상위 25% 기준."""
    # C-7 (보류): 심사단이 임계값 재검토를 제안했으나 9/17 코드·데이터 동결 전까지는
    # 규칙·T·행수를 건드리지 않는다. 이번 변경은 레이아웃/문구 한정.
    return int(round(percentile(public_counts, 0.75)))


# ---------------------------------------------------------------------------
# 집계
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class GapRow:
    key: str                    # 그룹 id 또는 시군구코드(멱등 정렬용 안정 키)
    codes: tuple[str, ...]      # 실제로 합산한 코드들
    sido_cd: str
    sido_nm: str
    name: str                   # 표시명(그룹이면 '서해구·검단구 일대(옛 서구)')
    group_id: Optional[str]
    dvoucher: int
    voucher: int
    public: int                 # faci_gb='공공'
    reported: int               # faci_gb='신고'
    registered: int             # faci_gb='등록'


def open_ro(db: Path) -> sqlite3.Connection:
    """읽기 전용 연결 — 표를 뽑느라 서비스 DB 를 건드리지 않는다(9/17 동결 대비)."""
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _faci_gb_counts(conn: sqlite3.Connection) -> dict[str, dict[str, int]]:
    """{시군구코드: {'공공'|'신고'|'등록': n}} — source='public' 한 번의 GROUP BY."""
    out: dict[str, dict[str, int]] = {}
    cur = conn.execute(
        "SELECT sigungu_cd AS cd, faci_gb AS gb, COUNT(*) AS n "
        "FROM facilities WHERE source = 'public' GROUP BY sigungu_cd, faci_gb"
    )
    for r in cur.fetchall():
        out.setdefault(r["cd"] or "", {})[r["gb"] or ""] = int(r["n"])
    return out


def load_rows(conn: sqlite3.Connection) -> list[GapRow]:
    """시군구 마스터 → 영역그룹 합산까지 끝낸 행 목록(멱등 정렬).

    마스터는 `Store.sigungu_all()`(= `/api/meta/sigungu` 와 같은 sigungu 테이블),
    가맹 카운트는 `Store.count_facilities_in_sigungus()`(= engine `_supply_gap` 의
    `voucher_count`) 를 그대로 쓴다. 여기서 SQL 을 다시 짜면 앞면·뒷면 숫자가
    갈라진다.
    """
    store = store_mod.Store(conn, {}, {})
    master = {r["cd"]: r["nm"] for r in store.sigungu_all() if r.get("cd")}
    gb = _faci_gb_counts(conn)

    rows: list[GapRow] = []
    seen: set[str] = set()
    for cd in sorted(master):
        if cd in seen:
            continue
        scope, group = region.count_scope(cd)
        codes = tuple(scope)
        seen.update(codes)
        # 표시명은 그룹 label 이 담당한다 — 잔재 코드(옛 서구)의 이름을 따로 노출하지
        # 않는다. 카운트에는 그 코드도 포함된다(그래서 거짓 0 이 생기지 않는다).
        pub = sum(gb.get(m, {}).get("공공", 0) for m in codes)
        rep = sum(gb.get(m, {}).get("신고", 0) for m in codes)
        reg = sum(gb.get(m, {}).get("등록", 0) for m in codes)
        rows.append(GapRow(
            key=(group["id"] if group else cd),
            codes=codes,
            sido_cd=region.canonical_sido(cd) or cd[:2],
            sido_nm=region.sido_label(cd) or "",
            name=(group["label"] if group else master[cd]),
            group_id=(group["id"] if group else None),
            dvoucher=store.count_facilities_in_sigungus("dvoucher", codes),
            voucher=store.count_facilities_in_sigungus("voucher", codes),
            public=pub,
            reported=rep,
            registered=reg,
        ))

    # 기본 정렬 = 장애인 가맹 asc → 공공 desc → 코드 asc(멱등 보장용 완전 순서)
    rows.sort(key=lambda r: (r.dvoucher, -r.public, r.key))
    return rows


def data_date(conn: sqlite3.Connection, db: Path) -> tuple[str, str]:
    """(표시용 'YYYY-MM-DD HH:MM KST', 근거 문구).

    `GET /api/health` 의 `data_built` 와 같은 값 — DB meta 스탬프가 있으면 그것,
    없으면 DB 파일 시각(store.db_mtime_iso 와 같은 규칙)."""
    stamp = store_mod.Store(conn, {}, {}).build_stamp()
    if stamp:
        try:
            dt = datetime.fromisoformat(stamp)
        except ValueError:
            return stamp, "DB 빌드 스탬프(meta.built_at)"
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M"), "DB 빌드 스탬프(meta.built_at)"
    # 헤더 문구는 "무엇을 근거로 찍은 시각인가"만 말한다. 스탬프가 없다는 사실은
    # 독자에게 쓸모없는 내부 사정이라 괄호 주석을 붙이지 않는다(C-8 헤더 정리).
    dt = datetime.fromtimestamp(db.stat().st_mtime, tz=timezone.utc)
    return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M"), "DB 파일 시각"


# ---------------------------------------------------------------------------
# 렌더
# ---------------------------------------------------------------------------
CSS = """
:root{
  color-scheme:light;
  /* B · 종이 메모 — 카드·그림자·알약 없이 괘선(rule)만으로 층을 만든다. */
  --paper:#f7f3ea; --ink:#1f2a44; --muted:#6b6357; --rule:#d9d0c1; --tint:#ebe4d4;
  --accent:#c0532b; --accent-dk:#8f3a1c; --ok:#3d6b3a;
  --serif:'Nanum Myeongjo','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
  --sans:'Gowun Dodum','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;padding:0;background:var(--paper);color:var(--ink);
  font-family:var(--sans);line-height:1.7;font-size:15px;
}
a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
a:hover{color:var(--accent-dk)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,'DejaVu Sans Mono',monospace;
  font-size:12px;background:var(--tint);padding:1px 4px;border-radius:2px}
/* 한 단 흐름(모바일) = 제목 → 안내 → 표. 900px 부터 왼쪽 안내 + 오른쪽 표 2단. */
.page{
  max-width:1440px;margin:0 auto;padding:20px 16px 56px;
  display:grid;grid-template-columns:minmax(0,1fr);gap:22px;
}
.side{display:flex;flex-direction:column;gap:14px;min-width:0}
.main{display:flex;flex-direction:column;min-width:0}
.back{display:inline-block;font-size:13.5px;text-underline-offset:4px}
h1{
  font-family:var(--serif);font-size:26px;font-weight:800;line-height:1.28;letter-spacing:-.01em;
  margin:0;padding-top:10px;border-top:2px solid var(--ink);
}
h1 .sub{
  display:block;margin-top:9px;font-family:var(--sans);font-size:13.5px;font-weight:400;
  line-height:1.65;color:var(--muted);letter-spacing:0;
}
.lede{margin:0;font-size:13.5px;line-height:1.7;color:var(--muted)}
.lede b{color:var(--ink)}
/* 제안 규칙·한계 — 표 위(모바일)/표 왼쪽(데스크톱) 첫 화면에서 읽힌다. 상자가 아니라 점선 괘선. */
.brief{
  margin:0;padding:14px 0;font-size:13px;line-height:1.7;color:var(--muted);
  border-top:1px dashed var(--rule);border-bottom:1px dashed var(--rule);
}
.brief p{margin:0}
.brief p+p{margin-top:9px;padding-top:9px;border-top:1px dashed var(--rule)}
.brief b{color:var(--ink)}
.brief .k{color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums}
/* 기본 정렬(장애인 가맹 오름차순)이 "최하위 목록"으로 읽히지 않게 표 가까이 둔다. */
.disclaim{margin:0;font-size:13px;line-height:1.7;color:var(--muted)}
.disclaim b{color:var(--ink)}
.controls{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;margin:0 0 10px}
.summary{margin:0;flex:1 1 auto;font-size:13px;color:var(--muted)}
.summary b{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
/* 검색은 상자가 아니라 밑줄 한 줄. */
#q{
  flex:1 1 260px;min-width:0;min-height:40px;padding:9px 2px;font:inherit;font-size:14px;
  border:0;border-bottom:1.5px solid var(--ink);border-radius:0;background:transparent;color:inherit;
}
#q::placeholder{color:var(--muted)}
#q:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.vh{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
.tnote{margin:0 0 10px;font-size:12.5px;line-height:1.65;color:var(--muted)}
.hint{margin:0 0 6px;text-align:center;font-size:12.5px;color:var(--muted)}
@media (min-width:768px){.hint{display:none}}
/* 접기 버튼도 알약이 아니라 밑줄 글자. */
.toggle{
  flex:0 0 100%;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:2px 0;
  font-size:13.5px;color:var(--accent);background:none;border:0;cursor:pointer;user-select:none;
  text-decoration:underline;text-underline-offset:4px;white-space:nowrap;align-self:flex-start;
}
.toggle::before{content:"＋"}
.toggle:hover{color:var(--accent-dk)}
#det:checked ~ .controls .toggle{color:var(--ink)}
#det:checked ~ .controls .toggle::before{content:"−"}
#det:focus-visible ~ .controls .toggle{outline:2px solid var(--accent);outline-offset:3px}
/* 가로 스크롤 영역은 키보드로도 밀 수 있어야 한다(tabindex="0" + 포커스 표시). */
.wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.wrap:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
table{border-collapse:separate;border-spacing:0;width:100%;min-width:560px}
th,td{text-align:left;white-space:nowrap}
thead th{
  position:sticky;top:0;z-index:2;background:var(--paper);color:var(--ink);
  font-size:13px;font-weight:700;padding:10px 12px;border-bottom:2px solid var(--ink);cursor:pointer;
}
thead th:hover{color:var(--accent)}
thead th:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
thead th::after{content:"";margin-left:5px;font-size:11px}
thead th[aria-sort="none"]:hover::after{content:"▲";opacity:.35}
thead th[aria-sort="ascending"]::after{content:"▲"}
thead th[aria-sort="descending"]::after{content:"▼"}
tbody td{
  font-size:14px;padding:7px 12px;line-height:1.35;background:var(--paper);
  border-bottom:1px dashed var(--rule);
}
.num{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:hover td{background:var(--tint)}
/* 첫 열 고정 — 가로로 밀어도 시군구 이름이 남는다(C-8). */
tbody td:first-child,thead th:first-child{
  position:sticky;left:0;z-index:1;background:var(--paper);border-right:1px solid var(--rule);
}
/* 세로 괘선은 가로 스크롤이 실제로 일어나는 좁은 화면에서만 — 넓은 화면에선 표를 상자로 보이게 한다. */
@media (min-width:900px){tbody td:first-child,thead th:first-child{border-right:0}}
thead th:first-child{z-index:3}
tbody tr:hover td:first-child{background:var(--tint)}
tbody tr[hidden]{display:none}
.sido{display:block;font-size:11px;line-height:1.25;color:var(--muted)}
.nm{color:var(--ink)}
/* 0 은 "잘못"이 아니라 "다음에 할 수 있는 일"의 표시다 — 상자 없이 색과 굵기로만. */
.zero{color:var(--accent);font-weight:700}
.s-cv{color:var(--accent)}
.s-ex{color:var(--ok)}
.s-no{color:var(--muted)}
.col-det{display:none}
#det:checked ~ .wrap .col-det{display:table-cell}
.empty{margin:14px 2px 0;font-size:14px;color:var(--muted)}
.notes{
  margin:26px 0 0;padding-top:16px;border-top:1px dashed var(--rule);
  font-size:13px;line-height:1.7;color:var(--muted);
}
.notes h2{font-family:var(--serif);font-size:16px;font-weight:800;color:var(--ink);margin:0 0 10px}
.notes ol{margin:0;padding-left:20px}
.notes li{margin-bottom:9px}
.notes b{color:var(--ink)}
@media (min-width:900px){
  .page{
    grid-template-columns:380px minmax(0,1fr);gap:36px;padding:32px 28px 64px;align-items:start;
  }
  .side{position:sticky;top:32px;align-self:start;gap:16px}
  h1{font-size:34px;padding-top:12px}
  h1 .sub{font-size:14px}
  .lede,.brief,.disclaim{font-size:13.5px}
  #q{flex:0 1 260px}
  .notes{grid-column:1 / -1;margin-top:8px}
}
@media (min-width:1180px){
  .page{gap:48px;padding:36px 48px 72px}
}
@media (max-width:520px){
  .page{padding:16px 14px 48px}
  h1{font-size:23px}
  th,td{padding:9px 10px}
  .brief{font-size:12.5px;line-height:1.65}
  .disclaim,.lede{font-size:12.5px}
}
"""


def _esc(s: object) -> str:
    return html.escape(str(s), quote=True)


def _q_text(row: GapRow) -> str:
    """검색 대조용 문자열(공백 제거). 시도 별칭·코드까지 넣어 '강원 고성'도 잡힌다.

    이미 들어간 문자열의 부분열인 별칭('광주광역시' 안의 '광주')은 넣지 않는다 —
    검색 결과는 같고 228행 × 별칭이라 파일 크기에만 영향을 준다."""
    acc = ""
    for part in (row.name, row.sido_nm, *region.SIDO_NAMES.get(row.sido_cd, ()), *row.codes):
        p = region.norm(part)
        if p and p not in acc:
            acc += p
    return acc


def render(rows: list[GapRow], *, threshold: int, date_label: str, date_basis: str) -> str:
    total = len(rows)
    zero_dv = sum(1 for r in rows if r.dvoucher == 0)
    suggested = sum(
        1 for r in rows if suggest(r.dvoucher, r.public, threshold)[1] != RANK_NONE
    )
    blank = total - suggested   # 표 위 요약이 "빈칸도 규칙"이라고 말할 때 쓰는 수
    pubs = [r.public for r in rows]

    body: list[str] = []
    for i, r in enumerate(rows):
        text, rank = suggest(r.dvoucher, r.public, threshold)
        # 알약(배지) 없이 색만으로 구분한다 — 전환=주홍, 확대=초록, '—'=흐린 회색.
        sug = ""
        if rank == RANK_CONVERT:
            sug = f'<span class="s-cv">{_esc(text)}</span>'
        elif rank == RANK_EXPAND:
            sug = f'<span class="s-ex">{_esc(text)}</span>'
        elif rank == RANK_NO_SEED:
            sug = f'<span class="s-no">{_esc(text)}</span>'
        dv = (f'<span class="zero">{r.dvoucher:,}</span>' if r.dvoucher == 0
              else f"{r.dvoucher:,}")
        body.append(
            f'<tr data-i="{i}" data-q="{_esc(_q_text(r))}">'
            f'<td data-v="{_esc(r.sido_nm + r.name)}">'
            f'<span class="sido">{_esc(r.sido_nm)}</span>'
            f'<span class="nm">{_esc(r.name)}</span></td>'
            f'<td class="num" data-v="{r.dvoucher}">{dv}</td>'
            f'<td class="num" data-v="{r.voucher}">{r.voucher:,}</td>'
            f'<td class="num" data-v="{r.public}">{r.public:,}</td>'
            f'<td class="num col-det" data-v="{r.reported}">{r.reported:,}</td>'
            f'<td class="num col-det" data-v="{r.registered}">{r.registered:,}</td>'
            f'<td data-v="{rank}">{sug}</td>'
            "</tr>"
        )

    group_note = " · ".join(
        f'{_esc(g["label"])} = <code>{"·".join(g["members"])}</code>'
        for g in region.SIGUNGU_GROUPS
    )

    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f7f3ea">
<meta name="description" content="스포내비 뒷면 — 시군구별 장애인스포츠강좌이용권 가맹 수·일반 가맹 수·공공체육시설 수와 가맹 유치 제안. 국민체육진흥공단·공공데이터포털 공개 데이터 기준.">
<meta name="robots" content="index,follow">
<title>{_esc(PAGE_TITLE)} · 스포내비</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23f7f3ea'/%3E%3Ctext x='32' y='46' font-family='serif' font-size='42' font-weight='800' fill='%231f2a44' text-anchor='middle'%3ES%3C/text%3E%3C/svg%3E">
<style>
/* 자체 호스팅 웹폰트(외부 CDN 0 — CSP 가 구글 폰트를 막는다). web/src/index.css 와 같은 파일. */
@font-face{{font-family:'Nanum Myeongjo';font-style:normal;font-weight:800;font-display:swap;
  src:url('/fonts/NanumMyeongjo-ExtraBold.woff2') format('woff2');}}
@font-face{{font-family:'Gowun Dodum';font-style:normal;font-weight:400;font-display:swap;
  src:url('/fonts/GowunDodum-Regular.woff2') format('woff2');}}
{CSS}</style>
</head>
<body>
<div class="page">
<div class="side">
<a class="back" href="/">← 스포내비로 돌아가기</a>
<h1>{_esc(SHORT_TITLE)}<span class="sub">시군구별 장애인스포츠강좌이용권 가맹 현황과 공공체육시설 후보</span></h1>
<p class="lede">
  국민체육진흥공단 스포츠강좌이용권 <b>등록시설</b> 자료(일반·장애인 2종)와
  공공데이터포털 <b>전국 공공체육시설</b> 자료를 시군구 단위로 맞춘 표입니다.
  데이터 기준 <b>{_esc(date_label)}</b> (KST, {_esc(date_basis)}).
</p>
<div class="brief">
  <p><b>제안 규칙</b>(임계값까지 공개합니다) — ① 장애인 가맹 <b>0곳</b>이고 공공시설 <b>1곳 이상</b>이면
     <b>전환 후보</b>, ② 장애인 가맹 <b>0곳</b>이고 공공시설도 <b>0곳</b>이면 “—”(전환할 공공시설이 없음),
     ③ 장애인 가맹 <b>2곳 이하</b>이고 공공시설이
     <span class="k">{threshold:,}곳 이상</span>(T = 이 표 {total}개 시군구 공공시설 수의 75퍼센타일)이면
     <b>확대 후보</b>. ④ 나머지 <b>{blank:,}행</b>이 빈칸인 것도 규칙입니다 —
     근거가 없으면 제안을 만들지 않습니다.</p>
  <p><b>한계</b> — 가맹 수는 등록시설 자료에 실린 <b>시설 수</b>일 뿐 실제 강좌 수·정원이 아니고,
     공공시설이 있다고 곧바로 가맹이 되는 것도 아닙니다(시설 유형·운영 주체·접근성 확인 필요).
     확인 대상을 좁히는 용도입니다 — 정의·출처·합산 규칙은
     <a href="#notes">표 아래 “표 읽는 법 · 출처”</a>에 그대로 적어 두었습니다.</p>
</div>
<p class="disclaim">지역을 줄 세우려는 표가 아니라, <b>다음에 할 수 있는 일</b>(가맹 전환·확대 대상)을
  고르기 위한 목록입니다. 기본 정렬이 장애인 가맹 오름차순이라 <b>0곳</b>이 맨 위에 오지만
  이는 순위가 아니라 <b>먼저 확인해 볼 곳</b>이라는 뜻입니다. 열 제목을 누르면 다시 정렬됩니다.</p>
</div>
<div class="main">
<input class="vh" type="checkbox" id="det">
<div class="controls">
  <p class="summary">
    전국 <b>{total:,}</b>개 시군구 ·
    장애인 가맹 0곳 <b>{zero_dv:,}</b>개 ·
    제안이 붙은 곳 <b>{suggested:,}</b>개 ·
    표시 중 <b id="shown">{total:,}</b>개
  </p>
  <label class="sr" for="q">시군구 검색</label>
  <input id="q" type="search" placeholder="시군구 검색 (예: 고성, 강원, 서해구)" autocomplete="off">
  <label class="toggle" for="det">신고·등록 시설 수 함께 보기</label>
</div>
<p class="tnote" id="tnote">기준: 구(시군구) 단위 카운트 — 반경이 아닙니다. “공공시설”은 원천 데이터의 시설 구분이 ‘공공’인 시설만 셉니다(신고·등록 제외).</p>
<p class="hint" aria-hidden="true">← 옆으로 넘겨보세요 →</p>
<div class="wrap" tabindex="0" role="region" aria-label="시군구별 가맹·공공시설 표 (좌우로 스크롤됩니다)">
<table id="gap" aria-describedby="tnote">
  <caption class="sr">시군구별 장애인 가맹·일반 가맹·공공체육시설 수와 가맹 유치 제안</caption>
  <thead><tr>
    <th scope="col" aria-sort="none">시군구</th>
    <th scope="col" class="num" aria-sort="ascending">장애인 가맹</th>
    <th scope="col" class="num" aria-sort="none">일반 가맹</th>
    <th scope="col" class="num" aria-sort="none">공공시설</th>
    <th scope="col" class="num col-det" aria-sort="none">신고</th>
    <th scope="col" class="num col-det" aria-sort="none">등록</th>
    <th scope="col" aria-sort="none">제안</th>
  </tr></thead>
  <tbody>
{chr(10).join(body)}
  </tbody>
</table>
</div>
<p class="empty" id="none" hidden>검색어와 맞는 시군구가 없습니다.</p>
</div>
<div class="notes" id="notes">
<h2>표 읽는 법 · 출처</h2>
<ol>
  <li><b>출처</b> — 장애인 가맹·일반 가맹: 국민체육진흥공단 스포츠강좌이용권 등록시설 자료 2종.
      공공시설·신고·등록: 공공데이터포털 「전국 공공체육시설」(15113986) 원천 데이터의 시설 구분값(공공·신고·등록) 기준.
      한 원천을 전부 “공공체육시설”이라 부르면 다수가 민간 신고 시설이라 사실과 어긋납니다 —
      그래서 <b>공공 {sum(r.public for r in rows):,} / 신고 {sum(r.reported for r in rows):,} /
      등록 {sum(r.registered for r in rows):,}</b> 을 나눠 셉니다.</li>
  <li><b>카운트 단위</b> — 이용권 가맹시설은 공개 좌표가 없어 반경으로 셀 수 없습니다.
      모든 숫자는 <b>구(시군구) 단위</b> 카운트이며, 앱 화면의 “○○구 가맹 N곳”과 같은 값입니다.</li>
  <li><b>영역그룹 합산</b> — 2026-07-01 인천 행정체제 개편으로 한 생활권이 옛·신 코드에 걸쳐
      있고 원천이 두 코드를 섞어 씁니다. 코드 하나만 세면 없는 공백이 생기므로 다음은 합쳐서
      한 행으로 표시합니다: {group_note}. 그래서 표는 233행이 아니라 <b>{total}행</b>입니다.</li>
  <li><b>제안 규칙</b>(위에서부터 처음 맞는 하나만 붙습니다) —
      ① 장애인 가맹 0곳이고 공공시설이 1곳 이상 → “공공시설 N곳 가맹 전환 후보”,
      ② 장애인 가맹 0곳이고 공공시설도 0곳 → “—”(전환할 공공시설이 없어 다른 수단이 필요),
      ③ 장애인 가맹 2곳 이하이고 공공시설 ≥ <b>T={threshold:,}</b> → “가맹 확대 후보”,
      ④ 그 외 빈칸. <b>T={threshold:,}</b> 은 이 표 {total}개 시군구 공공시설 수 분포의
      <b>75퍼센타일</b>(상위 25% 기준, 최소 {min(pubs):,} · 중앙값 {percentile(pubs, 0.5):,.1f} ·
      최대 {max(pubs):,})입니다.</li>
  <li><b>한계</b> — 가맹 수는 등록시설 자료에 실린 시설 수일 뿐 실제 수강 가능 강좌 수·정원이
      아닙니다. 공공시설이 있다고 곧바로 가맹이 되는 것도 아닙니다(시설 유형·운영 주체·
      접근성 확인 필요). 이 표는 확인 대상을 좁히는 용도입니다.</li>
</ol>
<p style="margin-top:14px"><a class="back" href="/">← 스포내비로 돌아가기</a></p>
</div>
</div>
<script src="gap.js" defer></script>
</body>
</html>
"""


GAP_JS = """/* gap.html 정렬·검색 — 순수 JS, 의존성 0.
   서버 CSP 가 script-src 'self' 라 인라인 <script> 는 실행되지 않는다 → 외부 파일.
   scripts/build_gap.py 가 함께 배치한다(수정은 그 스크립트에서). */
(function () {
  var t = document.getElementById('gap');
  if (!t || !t.tHead || !t.tBodies.length) return;
  var body = t.tBodies[0];
  var rows = [].slice.call(body.rows);
  var heads = [].slice.call(t.tHead.rows[0].cells);
  var cur = 1, dir = 1; // 초기 상태 = 장애인 가맹 asc (HTML 이 이미 그 순서로 나온다)
  function val(tr, i) {
    var raw = tr.cells[i].getAttribute('data-v');
    var n = Number(raw);
    return raw !== null && raw !== '' && !isNaN(n) ? n : String(raw === null ? '' : raw);
  }
  function sort(i) {
    dir = i === cur ? -dir : 1;
    cur = i;
    heads.forEach(function (h, j) {
      h.setAttribute('aria-sort', j === i ? (dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    rows.slice().sort(function (a, b) {
      var x = val(a, i), y = val(b, i);
      var c = x < y ? -1 : x > y ? 1 : 0;
      return c ? c * dir : Number(a.dataset.i) - Number(b.dataset.i);
    }).forEach(function (tr) { body.appendChild(tr); });
  }
  heads.forEach(function (h, i) {
    h.tabIndex = 0;
    h.addEventListener('click', function () { sort(i); });
    h.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(i); }
    });
  });
  var q = document.getElementById('q');
  var shown = document.getElementById('shown');
  var none = document.getElementById('none');
  function filter() {
    var s = q.value.replace(/\\s+/g, ''), n = 0;
    rows.forEach(function (tr) {
      var hit = !s || tr.dataset.q.indexOf(s) >= 0;
      tr.hidden = !hit;
      if (hit) n++;
    });
    shown.textContent = n.toLocaleString('ko-KR');
    none.hidden = n > 0;
  }
  q.addEventListener('input', filter);
  filter();
})();
"""


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------
def build(db: Optional[Path] = None, out: Optional[Path] = None,
          threshold: Optional[int] = None) -> dict:
    """gap.html(+gap.js) 을 쓰고 요약 통계를 돌려준다. 테스트가 이 함수를 쓴다."""
    db = Path(db) if db else store_mod.db_path()
    out = Path(out) if out else DEFAULT_OUT
    conn = open_ro(db)
    try:
        rows = load_rows(conn)
        date_label, date_basis = data_date(conn, db)
    finally:
        conn.close()

    pubs = [r.public for r in rows]
    t = threshold if threshold is not None else threshold_from(pubs)
    hits: dict[int, int] = {RANK_CONVERT: 0, RANK_EXPAND: 0, RANK_NO_SEED: 0, RANK_NONE: 0}
    for r in rows:
        hits[suggest(r.dvoucher, r.public, t)[1]] += 1

    doc = render(rows, threshold=t, date_label=date_label, date_basis=date_basis)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    (out.parent / "gap.js").write_text(GAP_JS, encoding="utf-8")

    return {
        "rows": rows,
        "out": out,
        "bytes": len(doc.encode("utf-8")),
        "threshold": t,
        "date_label": date_label,
        "date_basis": date_basis,
        "public_min": min(pubs) if pubs else 0,
        "public_median": percentile(pubs, 0.5),
        "public_p75": percentile(pubs, 0.75),
        "public_max": max(pubs) if pubs else 0,
        "hits": hits,
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="SQLite → web/public/gap.html")
    ap.add_argument("--db", type=Path, default=None, help="기본: data/sponavi.db")
    ap.add_argument("--out", type=Path, default=None, help=f"기본: {DEFAULT_OUT}")
    ap.add_argument("--threshold", type=int, default=None,
                    help="제안 규칙 ③의 T. 기본: 공공시설 수 75퍼센타일(반올림)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    db = args.db or store_mod.db_path()
    if not Path(db).exists():
        print(f"[gap] DB 없음: {db}", file=sys.stderr)
        return 2

    s = build(db=db, out=args.out, threshold=args.threshold)
    if args.quiet:
        return 0

    rows = s["rows"]
    print(f"[gap] {s['out']}  ({s['bytes']:,} bytes)")
    print(f"[gap] 행 {len(rows)}개 (영역그룹 {len(region.SIGUNGU_GROUPS)}개 합산 후) · "
          f"데이터 기준 {s['date_label']} KST — {s['date_basis']}")
    print(f"[gap] 공공시설 수 분포: min {s['public_min']:,} · "
          f"median {s['public_median']:,.1f} · p75 {s['public_p75']:,.2f} · "
          f"max {s['public_max']:,}  → T={s['threshold']:,} (상위 25% 기준)")
    h = s["hits"]
    print(f"[gap] 제안: ①전환 후보 {h[RANK_CONVERT]} · ③확대 후보 {h[RANK_EXPAND]} · "
          f"②'—'(공공 0) {h[RANK_NO_SEED]} · ④빈칸 {h[RANK_NONE]} "
          f"→ 문구가 붙는 행 {len(rows) - h[RANK_NONE]}/{len(rows)}")
    for r in rows[:8]:
        text, _ = suggest(r.dvoucher, r.public, s["threshold"])
        print(f"       {r.sido_nm} {r.name}: 장애인 {r.dvoucher} · 일반 {r.voucher} · "
              f"공공 {r.public} · {text or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
