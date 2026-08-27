"""W3 뒷면 `gap.html` 빌더 (`scripts/build_gap.py`).

두 층을 나눠 본다.
  * 순수 규칙 — `suggest()` 는 DB 없이도 **첫 매칭 우선**이 지켜지는지 단위 검증.
  * 실 DB 산출물 — 전국 DB(data/sponavi.db) 가 있을 때만: 행 수(영역그룹 합산 후),
    거짓 공급공백이 없는지(인천 옛 서구), 실제로 "가맹 전환 후보"가 붙는 두 곳,
    그리고 페이지 프레이밍(P-1·판사3: 안내 문구, 줄 세우기 아님).
"""
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import build_gap  # noqa: E402
from app import region  # noqa: E402
from app import store as store_mod  # noqa: E402

T = 247  # 실측 T(공공시설 수 75퍼센타일). 규칙 단위 테스트는 이 값에 의존하지 않는다.


# ---------------------------------------------------------------------------
# 제안 규칙 (DB 불필요)
# ---------------------------------------------------------------------------
def test_suggest_rule1_zero_dvoucher_with_public():
    text, rank = build_gap.suggest(0, 57, T)
    assert text == "공공시설 57곳 가맹 전환 후보"
    assert rank == build_gap.RANK_CONVERT


def test_suggest_rule2_zero_dvoucher_no_public():
    text, rank = build_gap.suggest(0, 0, T)
    assert text == "—"
    assert rank == build_gap.RANK_NO_SEED


def test_suggest_rule3_thin_dvoucher_many_public():
    text, rank = build_gap.suggest(2, 325, T)
    assert text == "가맹 확대 후보(공공시설 325곳)"
    assert rank == build_gap.RANK_EXPAND
    # 경계: 정확히 T 면 포함, T-1 이면 빈칸
    assert build_gap.suggest(2, T, T)[1] == build_gap.RANK_EXPAND
    assert build_gap.suggest(2, T - 1, T)[1] == build_gap.RANK_NONE


def test_suggest_rule4_default_empty():
    text, rank = build_gap.suggest(3, 1000, T)   # 가맹 3곳 → ③ 대상 아님
    assert text == ""
    assert rank == build_gap.RANK_NONE


def test_suggest_first_match_wins():
    """dvoucher==0 이면 공공이 T 를 넘어도 ①(전환)이지 ③(확대)이 아니다.

    가맹이 하나도 없는 곳에 "확대"를 권하면 문장이 성립하지 않는다 — 규칙 순서가
    그 뜻을 지킨다."""
    text, rank = build_gap.suggest(0, T + 500, T)
    assert rank == build_gap.RANK_CONVERT
    assert "전환 후보" in text and "확대" not in text


def test_threshold_is_p75_rounded():
    # 0..100 균등 분포의 75퍼센타일 = 75
    assert build_gap.threshold_from(list(range(101))) == 75
    assert build_gap.percentile([1, 2, 3, 4], 0.5) == 2.5
    assert build_gap.threshold_from([]) == 0


# ---------------------------------------------------------------------------
# 실 DB 산출물
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def built(tmp_path_factory):
    db = store_mod.db_path()
    if not db.exists():
        pytest.skip("전국 DB(data/sponavi.db) 필요")
    out = tmp_path_factory.mktemp("gap") / "gap.html"
    summary = build_gap.build(db=db, out=out)
    summary["html"] = out.read_text(encoding="utf-8")
    return summary


def _row(summary, *, code=None, group_id=None):
    for r in summary["rows"]:
        if group_id and r.group_id == group_id:
            return r
        if code and not group_id and r.codes == (code,):
            return r
    raise AssertionError(f"행 없음: code={code} group_id={group_id}")


def test_row_count_is_group_merged_sigungu_count(built):
    """233행(마스터) − 영역그룹 합산분 = 228행. 그룹은 1행으로만 나온다."""
    conn = build_gap.open_ro(store_mod.db_path())
    try:
        master = {r["cd"] for r in store_mod.Store(conn, {}, {}).sigungu_all()}
    finally:
        conn.close()
    merged = sum(len([m for m in g["members"] if m in master]) - 1
                 for g in region.SIGUNGU_GROUPS)
    assert len(built["rows"]) == len(master) - merged
    assert built["html"].count("<tr data-i=") == len(built["rows"])
    # 그룹 멤버 코드는 각각 딱 한 행에만 속한다(중복 계상 없음)
    seen = [c for r in built["rows"] for c in r.codes]
    assert len(seen) == len(set(seen)) == len(master)


@pytest.mark.parametrize("code,name", [("51820", "고성군"), ("47940", "울릉군")])
def test_zero_dvoucher_rows_get_convert_suggestion(built, code, name):
    """강원 고성군·경북 울릉군 = 실 DB에서 장애인 가맹 0곳인 두 곳.

    둘 다 공공시설이 있으므로 "—"가 아니라 전환 후보가 붙어야 한다(규칙 ①)."""
    r = _row(built, code=code)
    assert r.name == name
    assert r.dvoucher == 0
    assert r.public >= 1
    text, rank = build_gap.suggest(r.dvoucher, r.public, built["threshold"])
    assert rank == build_gap.RANK_CONVERT
    assert text == f"공공시설 {r.public:,}곳 가맹 전환 후보"
    assert text in built["html"]


def test_incheon_old_seogu_merged_once_and_not_a_fake_gap(built):
    """옛 서구(28260)는 독립 행이 아니라 영역그룹 1행으로만 존재하고 가맹이 있다.

    코드 하나만 세면 28260 은 dvoucher 0 → "장애인 가맹 0곳"이라는 거짓 공백이 된다
    (FR-05 AC4). 합산 후에는 0 이 아니어야 한다."""
    g = _row(built, group_id="28-seohae-geomdan")
    assert set(g.codes) == {"28260", "28275", "28290"}
    assert g.dvoucher > 0 and g.voucher > 0
    assert not any(r.codes == ("28260",) for r in built["rows"])
    # engine `_supply_gap` 의 voucher_count 와 같은 값이어야 한다(앞면·뒷면 일치)
    conn = build_gap.open_ro(store_mod.db_path())
    try:
        store = store_mod.Store(conn, {}, {})
        scope, _ = region.count_scope("28260")
        assert g.dvoucher == store.count_facilities_in_sigungus("dvoucher", scope)
        assert g.voucher == store.count_facilities_in_sigungus("voucher", scope)
    finally:
        conn.close()
    # 합친 사실을 문구로 밝힌다(P-1)
    assert "옛 서구" in built["html"] and g.name in built["html"]


def test_public_column_counts_only_faci_gb_gonggong(built):
    """"공공시설" 열 = source='public' AND faci_gb='공공'. 신고·등록은 별도 열."""
    conn = build_gap.open_ro(store_mod.db_path())
    try:
        total = {
            (r["gb"] or ""): r["n"] for r in conn.execute(
                "SELECT faci_gb AS gb, COUNT(*) AS n FROM facilities "
                "WHERE source='public' GROUP BY faci_gb"
            )
        }
    finally:
        conn.close()
    assert sum(r.public for r in built["rows"]) == total["공공"]
    assert sum(r.reported for r in built["rows"]) == total["신고"]
    assert sum(r.registered for r in built["rows"]) == total["등록"]
    assert total["공공"] != sum(total.values())  # 뭉치면 거짓이 되는 이유(E-17)


def test_page_framing_and_shape(built):
    html = built["html"]
    assert build_gap.PAGE_TITLE in html
    assert "가맹 유치 우선순위" in html
    # 판사3: 안내이지 줄 세우기가 아니다 — 비난 어휘 금지
    assert "고발" not in html
    assert "결함" not in html
    # 되돌아가는 길 + 정렬 JS(CSP script-src 'self' 라 외부 파일)
    assert 'href="/"' in html
    assert '<script src="gap.js" defer></script>' in html
    assert (built["out"].parent / "gap.js").exists()
    assert "T=" in html and str(built["threshold"]) in html
    assert built["bytes"] < 150_000


def test_default_sort_and_idempotent(built, tmp_path):
    """기본 정렬 = 장애인 가맹 asc → 공공 desc, 두 번 돌려도 바이트 동일."""
    order = [(r.dvoucher, -r.public, r.key) for r in built["rows"]]
    assert order == sorted(order)
    out = tmp_path / "again.html"
    build_gap.build(db=store_mod.db_path(), out=out)
    first = out.read_bytes()
    build_gap.build(db=store_mod.db_path(), out=out)
    assert out.read_bytes() == first
    assert first.decode("utf-8") == built["html"]
