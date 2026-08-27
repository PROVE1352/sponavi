"""웹 목(VITE_MOCK=1)과 실 store 응답의 계약 대조 (T2A).

`web/src/mocks/contract/*.json` 은 웹 목과 이 테스트가 함께 읽는 **단일 본**이다.
목이 손으로 적은 값과 실DB 응답이 갈라지면 심사 화면(목)과 프로덕션이 다른 말을 하게 되므로,
여기서 계약 JSON ↔ `engine.assess` 실측을 맞대어 본다.

전국 DB(data/sponavi.db)가 있어야 의미가 있다 — 없으면 스킵한다(fixtures 서울 25구로는
가맹 수·수강료 결측 같은 실DB 사실을 검증할 수 없다). Lane S/D 가 서버 계약(source·primary·
faci_gb·수강료 null·별칭)을 넣기 전에는 이 파일이 빨간 게 정상이고, 그게 이 테스트의 용도다.
"""
import json
import sqlite3
from pathlib import Path

import pytest

from app.engine import assess
from app.personas import PERSONAS

CONTRACT_DIR = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks" / "contract"

OFFICIAL_PREFIX = "공식 확인"
PENDING = "검증 대기"


def _contract(name: str) -> dict:
    path = CONTRACT_DIR / f"{name}.json"
    if not path.exists():                      # 웹 트리 없이 서버만 체크아웃한 경우
        pytest.skip(f"계약 JSON 없음: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _body(pid: str) -> dict:
    for p in PERSONAS:
        if p["id"] == pid:
            return p["body"]
    raise AssertionError(f"페르소나 {pid} 가 app/personas.py 에 없다")


def _assess(db_store, pid: str) -> dict:
    if db_store is None:
        pytest.skip("data/sponavi.db 없음 — 실DB 계약 대조 스킵")
    try:
        return assess(db_store, _body(pid))
    except sqlite3.OperationalError as e:
        # test_fitness_official 의 self-heal(scrape_norms.build)이 체력 기준표 3테이블만 든
        # data/sponavi.db 를 만들어 두면 db_store 는 None 이 아닌데 시설 테이블이 없다.
        # 그건 '반쪽 DB'지 계약 위반이 아니므로 스킵한다(scripts/build_db.py 로 채워야 한다).
        if "no such table" in str(e) or "no such column" in str(e):
            pytest.skip(f"data/sponavi.db 가 전국 적재본이 아니다 — {e}")
        raise


def _demo(personas_by_id: dict, pid: str) -> dict:
    """페르소나의 demo 블록. 없으면 KeyError 대신 '무엇이 빠졌는지'를 말한다(3A 미반영 신호)."""
    p = personas_by_id[pid]
    assert "demo" in p, (
        f"{pid} 에 최상위 demo 블록이 없다(3A 미반영).\n"
        f"  기대: demo={{'fitness': ..., 'parq_preset': ...}}\n"
        f"  실제 키: {sorted(p)}"
    )
    return p["demo"]


def _curated_kind(curated: str) -> str:
    """큐레이션 문자열을 '공식 확인' / '검증 대기' 두 갈래로만 접는다(확인일은 비교 대상 아님)."""
    return OFFICIAL_PREFIX if str(curated).startswith(OFFICIAL_PREFIX) else PENDING


def _edge_shape(edges) -> list[tuple[str, str]]:
    return [(e["to"], _curated_kind(e["curated"])) for e in edges]


# ---------------------------------------------------------------------------
# alt_edges — to 유일 · '공식 확인' 우선 (CQ2A)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("pid", ["P1", "P2", "P5"])
def test_alt_edges_match_contract(db_store, pid):
    expected = _edge_shape(_contract("alt_edges")[pid])
    actual = _edge_shape(_assess(db_store, pid)["alt_edges"])
    assert actual == expected, (
        f"{pid} alt_edges 불일치\n"
        f"  계약(alt_edges.json): {expected}\n"
        f"  실DB(engine.assess) : {actual}"
    )


@pytest.mark.parametrize("pid", ["P1", "P2", "P5"])
def test_alt_edges_unique_by_to(db_store, pid):
    tos = [e["to"] for e in _assess(db_store, pid)["alt_edges"]]
    assert len(tos) == len(set(tos)), f"{pid} alt_edges 의 to 가 중복됐다: {tos}"


# ---------------------------------------------------------------------------
# nearby.primary — 자격 인지 정렬 (1A)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("pid,expected", [("P1", "voucher"), ("P2", "alternatives"), ("P5", "voucher")])
def test_nearby_primary(db_store, pid, expected):
    nearby = _assess(db_store, pid)["nearby"]
    assert "primary" in nearby, f"{pid} nearby 에 primary 키가 없다 (1A 미반영)"
    assert nearby["primary"] == expected, (
        f"{pid} nearby.primary 불일치: 기대 {expected!r} · 실제 {nearby['primary']!r}"
    )


# ---------------------------------------------------------------------------
# voucher 행 — source 필수(OV3) · P5 수강료 전량 결측(OV13)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("pid", ["P1", "P2", "P5"])
def test_voucher_rows_carry_source(db_store, pid):
    rows = _assess(db_store, pid)["nearby"]["voucher_facilities"]
    missing = [r["id"] for r in rows if r.get("source") not in ("voucher", "dvoucher")]
    assert not missing, f"{pid} voucher 행에 source 가 없다(OV3): {missing}"


def test_p5_voucher_fees_all_null(db_store):
    expected_count = _contract("facilities")["fee_null_count_P5"]
    rows = _assess(db_store, "P5")["nearby"]["voucher_facilities"]
    fees = [(r["id"], r["fee_month"], r["subsidy"], r["copay"]) for r in rows]
    assert len(rows) == expected_count, (
        f"P5 장애인 가맹 행 수 불일치: 계약 {expected_count} · 실DB {len(rows)}\n  {fees}"
    )
    not_null = [f for f in fees if f[1] is not None]
    assert not not_null, f"P5 수강료가 전부 결측이어야 한다(OV13). 값이 있는 행: {not_null}"


def test_p5_dvoucher_row_shape(db_store):
    """계약 JSON 의 dvoucher_row(표준형)와 실DB 행의 '모양'이 같은지 — 키·null 3셀·좌표 출처."""
    template = _contract("facilities")["dvoucher_row"]
    rows = _assess(db_store, "P5")["nearby"]["voucher_facilities"]
    assert rows, "P5 장애인 가맹 행이 비었다"
    row = rows[0]
    missing_keys = [k for k in template if not k.startswith("_") and k not in row]
    assert not missing_keys, f"실DB 행에 없는 계약 키: {missing_keys}\n  실제 키: {sorted(row)}"
    for cell in ("fee_month", "subsidy", "copay"):
        assert row[cell] is None, f"dvoucher 표준형은 {cell} 가 null 이어야 한다: {row[cell]!r}"
    assert row["coord_source"] == template["coord_source"]
    assert row["disability_support"] is True


# ---------------------------------------------------------------------------
# alternatives — 실좌표 우선(OV1) · faci_gb 배지(OV6)
# ---------------------------------------------------------------------------
def test_alternatives_real_coords_first(db_store):
    alts = _assess(db_store, "P2")["nearby"]["alternatives"]
    if not alts:
        pytest.skip("P2 대안 0곳 — 정렬 검증할 행이 없다")
    kinds = [a.get("coord_source") for a in alts]
    seen_centroid = False
    for a, k in zip(alts, kinds):
        if k == "centroid":
            seen_centroid = True
        elif seen_centroid:
            raise AssertionError(f"실좌표 행이 centroid 뒤에 왔다(OV1): {kinds} · {a['name']}")


def test_alternatives_carry_faci_gb(db_store):
    alts = _assess(db_store, "P2")["nearby"]["alternatives"]
    if not alts:
        pytest.skip("P2 대안 0곳 — faci_gb 검증할 행이 없다")
    missing = [a["id"] for a in alts if "faci_gb" not in a]
    assert not missing, f"대안 행에 faci_gb 키가 없다(OV6): {missing}"
    bad = [(a["id"], a["faci_gb"]) for a in alts if a["faci_gb"] not in ("공공", "신고", "등록", None)]
    assert not bad, f"faci_gb 값이 계약 밖이다: {bad}"


# ---------------------------------------------------------------------------
# supply_gap — 구 단위 가맹 수(OV5)
# ---------------------------------------------------------------------------
def test_supply_gap_seongbuk_voucher_count(db_store):
    expected = _contract("facilities")["supply_gap_seongbuk_voucher_count"]
    actual = _assess(db_store, "P2")["supply_gap"]["voucher_count"]
    assert actual == expected, (
        "성북구 스포츠강좌이용권 구 단위 가맹 수 불일치\n"
        f"  계약(facilities.json supply_gap_seongbuk_voucher_count): {expected}\n"
        f"  실DB(P2 supply_gap.voucher_count)                     : {actual}"
    )


def test_supply_gap_seongbuk_dvoucher_count(db_store):
    """P5(장애인 이용권) 쪽 구 단위 가맹 수. 계약 JSON 값은 잠정 —
    어긋나면 실DB 값으로 facilities.json 을 고치면 목·테스트가 함께 따라온다."""
    expected = _contract("facilities")["supply_gap_seongbuk_dvoucher_count"]
    actual = _assess(db_store, "P5")["supply_gap"]["voucher_count"]
    assert actual == expected, (
        "성북구 장애인스포츠강좌이용권 구 단위 가맹 수 불일치\n"
        f"  계약(facilities.json supply_gap_seongbuk_dvoucher_count): {expected}\n"
        f"  실DB(P5 supply_gap.voucher_count)                      : {actual}"
    )


# ---------------------------------------------------------------------------
# GET /api/demo/personas 의 demo 프리필 (3A) — DB 없이도 돈다
# ---------------------------------------------------------------------------
def test_every_persona_has_demo_block(personas_by_id):
    missing = [pid for pid, p in personas_by_id.items() if "demo" not in p]
    assert not missing, f"페르소나 최상위 demo 블록이 없다(3A): {missing}"
    contract = _contract("personas_demo")
    for pid in personas_by_id:
        demo = _demo(personas_by_id, pid)
        assert set(demo) == {"fitness", "parq_preset"}, (
            f"{pid} demo 키 계약 위반: 기대 ['fitness', 'parq_preset'] · 실제 {sorted(demo)}"
        )
        assert demo["parq_preset"] == contract[pid]["parq_preset"], (
            f"{pid} parq_preset 불일치: 계약 {contract[pid]['parq_preset']} · 실제 {demo['parq_preset']}"
        )


@pytest.mark.parametrize("pid", ["P1", "P3", "P4"])
def test_personas_without_prefill(personas_by_id, pid):
    contract = _contract("personas_demo")[pid]
    assert contract["fitness"] is None                       # 계약 자체가 프리필 없음
    actual = _demo(personas_by_id, pid)["fitness"]
    assert actual is None, f"{pid} 은 체력 프리필이 없어야 한다(계약 null) · 실제: {actual}"


def test_p2_prefill_exact(personas_by_id):
    """P2 는 설계문서 실측표 그대로 — dict 전체를 강제한다."""
    expected = _contract("personas_demo")["P2"]["fitness"]
    actual = _demo(personas_by_id, "P2")["fitness"]
    assert actual == expected, (
        "P2 체력 프리필 불일치\n"
        f"  계약(personas_demo.json): {expected}\n"
        f"  실제(app/personas.py)   : {actual}"
    )


def test_p5_prefill_weak_item(personas_by_id):
    """P5 는 crunch_cross(30~34 남 컷 35 미달) 한 항목만 확정 계약이고,
    나머지 '정상 범위' 값은 Lane S 가 기준표로 확정한다 — 그래서 여기선 강제하지 않는다."""
    expected = _contract("personas_demo")["P5"]["fitness"]
    actual = _demo(personas_by_id, "P5")["fitness"]
    assert actual is not None, "P5 체력 프리필이 비었다"
    assert actual.get("crunch_cross") == expected["crunch_cross"], (
        "P5 crunch_cross 불일치\n"
        f"  계약: {expected['crunch_cross']} · 실제: {actual.get('crunch_cross')}"
    )
    unknown = [k for k in actual if k not in expected]
    assert not unknown, f"P5 프리필에 계약에 없는 항목 코드: {unknown} (계약: {sorted(expected)})"
