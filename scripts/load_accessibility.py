#!/usr/bin/env python3
"""dvoucher 웹 접근성 보조 소스 → sponavi.db `facility_accessibility` 적재.

입력 : data/raw/dvoucher_web_accessibility.json (scripts/scrape_dvoucher.py 산출)
대상 : data/sponavi.db 의 facilities(source='dvoucher') 행

조인(★DR-4 정직 원칙):
  원계약은 웹 bizrno ↔ facilities.brno / alsfc_sn ↔ facil_sn 조인을 지시한다.
  그러나 공식 dvoucher API(dvoucher_facility.json)에는 **사업자번호 필드가 없어**
  build_db.py 가 dvoucher 행의 brno·facil_sn 을 전부 NULL 로 넣는다(코드 주석 명시).
  → brno 조인은 구조적으로 0% 다. 이 로더는 그 사실을 **측정해 보고**하고,
    실제로 가용한 조인키(정규화 시설명 + 주소 시군구 디스앰비그)로 대사·적재한다.

대사 방향(중요 — 정직 신호 P-1):
  웹(10,011) ⊋ API 스냅샷(DB dvoucher 8,919). 따라서 '웹→DB 매칭률'은 스냅샷 크기비
  (8919/10011 ≈ 89.1%)가 구조적 상한이라, 조인 '품질'이 아니라 '스냅샷 커버리지'를
  잰다. 적재 게이트는 우리가 **실제 서빙하는 시설(DB dvoucher)이 접근성으로 올바로
  엮이는가**를 재는 **DB→웹** 방향으로 판정한다(200 표본). 두 방향 수치와 구조적
  상한을 모두 출력해 아무것도 숨기지 않는다.

적재 전 표본 200건 대사 — 일치율 출력. **90% 미만이면 적재 중단**(미적재 보고).
매칭 안 되는 웹 시설(공식 API 스냅샷보다 신규 등록분)은 스킵 카운트로 보고한다.
idempotent: 재실행 시 source='dvoucher' 접근성 행을 지우고 재적재.

사용:
  python scripts/load_accessibility.py \
      --json data/raw/dvoucher_web_accessibility.json --db data/sponavi.db
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

SOURCE = "dvoucher"          # facility_accessibility.source 토큰(facilities.source 규약과 통일)
SAMPLE_N = 200
MATCH_THRESHOLD = 0.90       # DR-4: 90% 미만이면 미적재

SCHEMA = """
CREATE TABLE IF NOT EXISTS facility_accessibility (
    facility_id TEXT,
    kind        TEXT,   -- 'disability_type' | 'amenity'
    code        TEXT,
    name        TEXT,
    source      TEXT,
    checked     TEXT
);
CREATE INDEX IF NOT EXISTS idx_fa_fid  ON facility_accessibility(facility_id);
CREATE INDEX IF NOT EXISTS idx_fa_kind ON facility_accessibility(kind);
CREATE INDEX IF NOT EXISTS idx_fa_code ON facility_accessibility(code);
"""


def norm(s: str | None) -> str:
    return re.sub(r"\s+", "", s or "")


def load_db_index(conn: sqlite3.Connection):
    """정규화 시설명 -> [dvoucher facility 행] + brno 컬럼 실태 측정."""
    cur = conn.execute(
        "SELECT id, name, sigungu_cd, sigungu_nm, addr, brno, facil_sn "
        "FROM facilities WHERE source='dvoucher'"
    )
    rows = cur.fetchall()
    by_name: dict[str, list[sqlite3.Row]] = {}
    brno_present = 0
    for r in rows:
        by_name.setdefault(norm(r["name"]), []).append(r)
        if r["brno"] not in (None, ""):
            brno_present += 1
    return rows, by_name, brno_present


def index_web(web: list[dict]) -> dict[str, list[dict]]:
    idx: dict[str, list[dict]] = {}
    for w in web:
        idx.setdefault(norm(w.get("name")), []).append(w)
    return idx


def match_web(db_row: sqlite3.Row, web_by_name: dict) -> dict | None:
    """DB dvoucher 시설 → 대응 웹 시설 1건(정규화 시설명 + 주소 시군구 디스앰비그).
    우리가 서빙하는 시설에 접근성 웹 레코드를 붙이는 방향(품질 판정용)."""
    cands = web_by_name.get(norm(db_row["name"]), [])
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]
    sg = norm(db_row["sigungu_nm"])
    if sg:
        disamb = [c for c in cands if sg in norm(c.get("addr"))]
        if len(disamb) == 1:
            return disamb[0]
    # 여전히 모호 → 추정 금지(P-1), 미매칭 처리
    return None


def build_rows(web_fac: dict, fac_id: str, checked: str,
               dis_name2code: dict[str, str]) -> list[tuple]:
    out: list[tuple] = []
    for t in web_fac.get("disability_types") or []:
        out.append((fac_id, "disability_type", dis_name2code.get(norm(t)), t, SOURCE, checked))
    for a in web_fac.get("amenities") or []:
        out.append((fac_id, "amenity", a.get("code"), a.get("name"), SOURCE, checked))
    return out


def run(args) -> int:
    json_path = Path(args.json)
    if not json_path.is_absolute():
        json_path = REPO_ROOT / json_path
    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = REPO_ROOT / db_path

    if not json_path.exists():
        print(f"[load] 입력 JSON 없음: {json_path}  (스크레이퍼 먼저 실행)", file=sys.stderr)
        return 2
    if not db_path.exists():
        print(f"[load] DB 없음: {db_path}  (build_db.py 먼저 실행)", file=sys.stderr)
        return 2

    doc = json.loads(json_path.read_text(encoding="utf-8"))
    web = doc.get("facilities", [])
    checked = doc.get("scraped_at") or ""
    dis_name2code = {norm(d["name"]): d["code"] for d in doc.get("disability_catalog", [])}
    # 리스트 텍스트는 개별 유형("지적","청각")도 나오므로 부분 별칭 보강
    for d in doc.get("disability_catalog", []):
        for part in re.split(r"[/·]", d["name"]):
            dis_name2code.setdefault(norm(part), d["code"])
    print(f"[load] 웹 시설 {len(web)}건 · 확인일 {checked} · DB {db_path.name}", flush=True)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    db_rows, by_name, brno_present = load_db_index(conn)
    print(
        f"[load] DB dvoucher 시설 {len(db_rows)}건 · brno 채워진 행 {brno_present}건",
        flush=True,
    )

    # ---- 조인키 실태(원계약 brno vs 실제 가용키) ----
    if brno_present == 0:
        print(
            "[load] ⚠ 원계약 조인키(facilities.brno)가 전부 NULL — 공식 API에 사업자번호 "
            "필드가 없어 build_db 가 NULL 로 적재(구조적). brno 조인 = 0%.\n"
            "       → 실제 가용키(정규화 시설명 + 주소 시군구 디스앰비그)로 대사·적재한다.",
            flush=True,
        )

    web_by_name = index_web(web)

    # ---- 표본 200건 대사 (게이트 = DB→웹 방향) ----
    step = max(1, len(db_rows) // SAMPLE_N)
    sample = db_rows[::step][:SAMPLE_N]
    s_uniq = s_disamb = s_none = 0
    for r in sample:
        cands = web_by_name.get(norm(r["name"]), [])
        if len(cands) == 1:
            s_uniq += 1
        elif len(cands) > 1 and match_web(r, web_by_name) is not None:
            s_disamb += 1
        else:
            s_none += 1
    s_matched = s_uniq + s_disamb
    rate = s_matched / len(sample) if sample else 0.0

    # 웹→DB 방향(참고): 스냅샷 커버리지 상한 확인용 (by_name = DB 명 인덱스)
    w_matched = sum(1 for wf in web if norm(wf.get("name")) in by_name)
    ceil_ratio = len(db_rows) / len(web) if web else 0.0

    print(
        f"[load] === 표본 {len(sample)}건 대사 (게이트: DB→웹) ===\n"
        f"  명일치(유일)={s_uniq}  명일치(주소 디스앰비그)={s_disamb}  미매칭={s_none}\n"
        f"  DB→웹 일치율 = {s_matched}/{len(sample)} = {rate*100:.1f}%  (임계 {MATCH_THRESHOLD*100:.0f}%)\n"
        f"  [참고] 웹→DB 명매칭 = {w_matched}/{len(web)} = {w_matched/len(web)*100:.1f}% "
        f"(구조적 상한 {ceil_ratio*100:.1f}% = 스냅샷 크기비 · 조인 품질 아님)",
        flush=True,
    )
    if rate < MATCH_THRESHOLD:
        print(
            f"[load] ✖ DB→웹 일치율 {rate*100:.1f}% < {MATCH_THRESHOLD*100:.0f}% → 적재 중단(DR-4 정직 원칙). "
            "조인 정합성 재점검 필요.",
            file=sys.stderr,
        )
        conn.close()
        return 3

    # ---- 전량 조인 + 적재 (DB dvoucher 시설 순회 → 웹 접근성 부착) ----
    conn.executescript(SCHEMA)
    conn.execute("DELETE FROM facility_accessibility WHERE source=?", (SOURCE,))  # idempotent

    matched = 0
    ins_rows: list[tuple] = []
    for r in db_rows:
        wf = match_web(r, web_by_name)
        if wf is None:
            continue
        rows = build_rows(wf, r["id"], checked, dis_name2code)
        if rows:
            matched += 1
            ins_rows.extend(rows)
    db_unmatched = len(db_rows) - matched
    # 웹 시설 중 DB 스냅샷 밖(신규 등록분) — 스킵 카운트
    skipped = len(web) - w_matched

    # 동일 (facility_id, kind, code) 중복 제거(합집합)
    dedup = {}
    for row in ins_rows:
        dedup[(row[0], row[1], row[2], row[3])] = row
    final_rows = list(dedup.values())

    conn.executemany(
        "INSERT INTO facility_accessibility "
        "(facility_id, kind, code, name, source, checked) VALUES (?,?,?,?,?,?)",
        final_rows,
    )
    conn.commit()

    n_fac = conn.execute(
        "SELECT COUNT(DISTINCT facility_id) FROM facility_accessibility WHERE source=?",
        (SOURCE,),
    ).fetchone()[0]
    n_amen = conn.execute(
        "SELECT COUNT(*) FROM facility_accessibility WHERE source=? AND kind='amenity'",
        (SOURCE,),
    ).fetchone()[0]
    n_dis = conn.execute(
        "SELECT COUNT(*) FROM facility_accessibility WHERE source=? AND kind='disability_type'",
        (SOURCE,),
    ).fetchone()[0]
    conn.close()

    print(
        f"[load] === 적재 완료 ===\n"
        f"  DB dvoucher {len(db_rows)}건 중 접근성 부착 = {matched} "
        f"({matched/len(db_rows)*100:.1f}%) · 무매칭·무데이터 DB시설 = {db_unmatched}\n"
        f"  웹 신규분(스냅샷 밖, 미적재) = {skipped}\n"
        f"  facility_accessibility 행 = {len(final_rows)} "
        f"(고유 시설 {n_fac} · 편의시설 {n_amen} · 장애유형 {n_dis})",
        flush=True,
    )
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="dvoucher 접근성 보조 소스 적재")
    ap.add_argument("--json", default="data/raw/dvoucher_web_accessibility.json")
    ap.add_argument("--db", default="data/sponavi.db")
    args = ap.parse_args()
    sys.exit(run(args))


if __name__ == "__main__":
    main()
