"""시설 구분 컬럼 facilities.faci_gb (OV6): 적재 결과 + 조인 키 규칙.

source='public' 을 전부 "공공체육시설"로 라벨하면 70%가 거짓이다 — 원천(faci_gb_nm)은
신고/공공/등록 3종이 섞여 있다. 컬럼이 실제로 그 3종으로 채워졌는지(전국 DB), 그리고
빌드·마이그레이션이 공유하는 조인 키 함수가 raw 행에서 무엇을 만드는지 검증한다.
"""
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from build_db import (  # noqa: E402  (scripts/build_db.py — 빌드와 같은 규칙)
    dedupe_id,
    public_base_id,
    public_faci_gb,
    public_is_closed,
)
from migrate_facility_gb import raw_pairs  # noqa: E402  (제자리 마이그레이션과 같은 규칙)

GB_VALUES = {"신고", "공공", "등록"}


def _gb_dist(db_store) -> dict:
    rows = db_store.conn.execute(
        "SELECT COALESCE(faci_gb,'(NULL)'), COUNT(*) FROM facilities "
        "WHERE source='public' GROUP BY faci_gb"
    ).fetchall()
    return {k: n for k, n in rows}


# ---------------------------------------------------------------------------
# ① 전국 DB 적재 결과
# ---------------------------------------------------------------------------
def test_faci_gb_has_three_kinds(db_store):
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 없이 검증 불가")
    dist = _gb_dist(db_store)
    assert GB_VALUES <= set(dist), f"신고/공공/등록 3종이 모두 있어야 한다: {dist}"
    # OV6 의 근거: '공공'이 소수파다(전부 공공체육시설이라는 라벨이 거짓인 이유)
    assert dist["신고"] > dist["공공"], dist


def test_faci_gb_fill_rate(db_store):
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 없이 검증 불가")
    total = db_store.conn.execute(
        "SELECT COUNT(*) FROM facilities WHERE source='public'"
    ).fetchone()[0]
    filled = db_store.conn.execute(
        "SELECT COUNT(*) FROM facilities WHERE source='public' AND faci_gb IS NOT NULL"
    ).fetchone()[0]
    assert total
    assert filled / total >= 0.95, f"채움률 {filled}/{total}"


def test_voucher_rows_have_null_faci_gb(db_store):
    """이용권 원천엔 faci_gb_nm 필드가 없다 — 추측해 채우지 않는다(NULL 유지)."""
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 없이 검증 불가")
    leak = db_store.conn.execute(
        "SELECT COUNT(*) FROM facilities WHERE source<>'public' AND faci_gb IS NOT NULL"
    ).fetchone()[0]
    assert leak == 0


def test_store_rows_expose_faci_gb(db_store):
    """store.facilities() 행 dict 에 faci_gb 가 실려야 engine 이 통과시킬 수 있다."""
    if db_store is None:
        pytest.skip("전국 DB(data/sponavi.db) 없이 검증 불가")
    facs = db_store.facilities("public", bbox=(37.58, 37.62, 127.00, 127.05))  # 성북 일대
    assert facs
    assert all("faci_gb" in f for f in facs)
    assert {f["faci_gb"] for f in facs} <= GB_VALUES | {None}


def test_fixtures_store_always_has_the_key(store):
    """데모(fixtures) DB 는 원천에 구분값이 없다 — 키는 있고 값은 None(추측 금지)."""
    facs = store.facilities("public")
    assert facs
    assert all("faci_gb" in f for f in facs)


def test_facility_row_tolerates_missing_column():
    """faci_gb 컬럼이 아예 없는 구 DB(마이그레이션 전)도 죽지 않고 None 으로 읽힌다."""
    import sqlite3

    from app.store import Store

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE f (id TEXT, source TEXT, name TEXT, sigungu_cd TEXT, sigungu_nm TEXT, "
        "addr TEXT, lat REAL, lon REAL, sports TEXT, disability_support INTEGER, phone TEXT)"
    )
    conn.execute(
        "INSERT INTO f VALUES ('public-1','public','X구민체육센터','11290','성북구','주소',"
        "37.6,127.0,'헬스',NULL,NULL)"
    )
    row = conn.execute("SELECT * FROM f").fetchone()
    d = Store._facility_row(row)
    assert d["faci_gb"] is None
    assert d["coord_source"] == "api"    # 구 DB 폴백 규칙은 그대로
    conn.close()


# ---------------------------------------------------------------------------
# ② 조인 키 규칙 (raw 행 → facility id) — 빌드와 마이그레이션이 공유하는 함수
# ---------------------------------------------------------------------------
RAW_ROW = {
    "faci_cd": "E1DE682A80811DA7E71A53B2F1D45637",
    "faci_nm": "위드미 댄스",
    "faci_gb_nm": "신고",
    "faci_stat_nm": "정상운영",
}


def test_public_base_id_is_digits_of_faci_cd():
    assert public_base_id(RAW_ROW) == "public-168280811771532145637"
    assert public_base_id({"faci_cd": "0AB1"}) == "public-01"
    assert public_base_id({}) == "public-x"            # 키 없음 → 최후 폴백
    assert public_base_id({"faci_cd": "ABC"}) == "public-x"   # 숫자 0개


def test_public_faci_gb_and_closed_filter():
    assert public_faci_gb(RAW_ROW) == "신고"
    assert public_faci_gb({"faci_gb_nm": "  "}) is None
    assert public_is_closed(RAW_ROW) is False
    for status in ("폐업", "폐쇄", "말소", "취소"):
        assert public_is_closed({"faci_stat_nm": status}) is True


def test_dedupe_id_keeps_insert_order():
    seen: set[str] = set()
    assert [dedupe_id("public-1", seen) for _ in range(3)] == [
        "public-1", "public-1-2", "public-1-3"
    ]


def test_raw_pairs_skips_closed_and_pairs_gb_with_id():
    """마이그레이션 조인 쌍 = (faci_gb, id). 폐업 행은 빌드처럼 빠지고,
    id 는 폐업 제외 후 파일 순서대로 붙는다(빌드와 같은 순서)."""
    rows = [
        RAW_ROW,
        {"faci_cd": "9", "faci_gb_nm": "공공", "faci_stat_nm": "폐업"},      # 제외
        {"faci_cd": "7", "faci_gb_nm": "등록", "faci_stat_nm": "정상운영"},
        {"faci_cd": "7", "faci_gb_nm": "공공", "faci_stat_nm": "정상운영"},  # 같은 base
    ]
    pairs, dist = raw_pairs(rows)
    assert pairs == [
        ("신고", "public-168280811771532145637"),
        ("등록", "public-7"),
        ("공공", "public-7-2"),
    ]
    assert dict(dist) == {"신고": 1, "등록": 1, "공공": 1}
