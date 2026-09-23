"""예상 선정순위(dvoucher) + 복수 대체경로(alt_edges) 계약 (FR-02 AC3·AC5, FR-P5).

- 순위 매트릭스: 공식 5단계(1~5순위) 각 1케이스 + 소득 미정 1케이스.
- dvoucher 자격 카드 selection 객체 계약 형태(rules 원문 tiebreak·source 그대로).
- alt_edges: P2(비장애 소득·연령 미달) 요청 시 매칭 엣지 전부 수집(rules 파생 수와 일치)·curated 필드.
- P5 assess 응답에 selection.expected_rank == 5.
"""
import pytest

from app.engine import (
    _rank_label,
    _selection_category,
    _selection_rank,
    assess,
)


def _card(res):
    return res["eligibility"][0]


def _body(age, income="그외", disability=None, sigungu="11290", loc=None):
    return {
        "age": age, "sex": "M",
        "sigungu_cd": sigungu, "sigungu_nm": "",
        "income_class": income,
        "disability": disability or {"has": False, "type": None},
        "location": loc,
    }


def _disabled(age, income):
    """dvoucher 자격 성립 입력(5~69세·등록장애·소득무관)."""
    return _body(age, income, {"has": True, "type": "지체"})


# --- 순위 매트릭스: 1~5순위 각 1케이스 (dvoucher 자격 충족 → assess 경유) ---------
@pytest.mark.parametrize("age,income,expected_rank,label_head", [
    (10, "기초생활수급", 1, "예상 1순위(유청소년·수급)"),
    (14, "한부모", 1, "예상 1순위(유청소년·차상위·한부모)"),
    (30, "기초생활수급", 2, "예상 2순위(성인·수급)"),
    (40, "차상위", 3, "예상 3순위(성인·차상위·한부모)"),
    (10, "그외", 4, "예상 4순위(유청소년·비저소득)"),
    (32, "그외", 5, "예상 5순위(성인·비저소득)"),
])
def test_selection_rank_matrix(store, age, income, expected_rank, label_head):
    res = assess(store, _disabled(age, income))
    card = _card(res)
    assert card["program_id"] == "dvoucher" and card["eligible"] is True
    sel = card["selection"]
    assert sel["expected_rank"] == expected_rank
    assert sel["rank_label"] == label_head


def test_selection_rank_undetermined():
    # '모름' 계열 소득값 → 순위 미정(None) + "소득 구분 확인 후 안내" 문구
    assert _selection_category("모름") is None
    assert _selection_category("미상") is None
    assert _selection_rank(30, None) is None
    label = _rank_label(None, 30, None)
    assert "소득 구분 확인 후 안내" in label
    # 확인 방법 문구 포함
    assert "주민센터" in label or "복지로" in label


# --- dvoucher 자격 카드 selection 계약 형태 ---------------------------------
def test_dvoucher_selection_contract_shape(store):
    res = assess(store, _disabled(32, "그외"))
    card = _card(res)
    sel = card["selection"]
    assert set(sel) >= {"expected_rank", "rank_label", "note", "tiebreak", "source"}
    # 신청(소득무관)과 선정(우선순위제)을 구분하는 note (PRD §6 카피 규칙)
    assert "우선순위" in sel["note"]
    assert "대기" in sel["note"]
    # tiebreak·source 는 rules dvoucher.selection_priority 원문 그대로
    dv = store.program("dvoucher")
    sp = dv["selection_priority"]
    assert sel["tiebreak"] == sp["tiebreak"]
    assert sel["source"] == sp["source"]
    # source 는 계약상 url/checked 를 포함
    assert set(sel["source"]) >= {"url", "checked"}


def test_selection_only_on_eligible_dvoucher(store):
    # 비장애(svoucher 경로) 카드엔 selection 없음
    assert "selection" not in _card(assess(store, _body(10, "기초생활수급")))
    # 자격 미충족 dvoucher(연령 초과) 카드엔 selection 없음
    over = _card(assess(store, _disabled(72, "그외")))
    assert over["program_id"] == "dvoucher" and over["eligible"] is False
    assert "selection" not in over


# --- 복수 대체경로 alt_edges ------------------------------------------------
def test_alt_edges_present_on_response(store):
    res = assess(store, _body(27, "그외"))
    assert "alt_edges" in res
    assert isinstance(res["alt_edges"], list)


def test_alt_edges_p2_unique_and_official_first(store):
    """P2(27세 비장애 그외): svoucher 연령·소득 동시 미달 → 대체경로 3종.

    결정 CQ2A — 같은 `to` 로 가는 엣지가 사유별로 여럿이라도 한 줄로 합친다
    (svoucher→public_program 은 income_fail·age_fail 두 벌, →tteuntteun 도 두 벌).
    """
    # 조례 미확인 지역(강남구) 기준 — 성북구 승격 케이스는 test_public_fee.py.
    res = assess(store, _body(27, "그외", sigungu="11680"))
    alts = res["alt_edges"]

    # ① to 는 유일하다
    tos = [a["to"] for a in alts]
    assert len(tos) == len(set(tos))
    # ② 대상 제도 3종
    assert set(tos) == {"public_program", "tteuntteun", "culture_deduction"}
    # ③ '공식 확인' 엣지가 '검증 대기'보다 앞에 온다
    ranks = [0 if a["curated"].startswith("공식 확인") else 1 for a in alts]
    assert ranks == sorted(ranks)
    assert alts[0]["curated"].startswith("공식 확인")
    assert {a["to"] for a in alts if a["curated"].startswith("공식 확인")} == {
        "tteuntteun", "culture_deduction"
    }
    # ④ 경로 그림의 대체 홉 = dedupe 목록 1순위 (OV4)
    hops = [p for p in res["path"] if p["edge"] == "대체경로"]
    assert hops and hops[0]["to"] == alts[0]["to"]

    # 각 항목 계약 형태 + curated 필드 존재
    for a in alts:
        assert set(a) >= {"to", "note", "curated", "program"}
        assert isinstance(a["curated"], str) and a["curated"]
        # program 정보는 store.program(to) 있으면 채워짐
        if a["program"] is not None:
            assert set(a["program"]) >= {"id", "name", "benefit", "apply_url"}


def test_alt_edges_dedupe_keeps_first_note_and_best_curated(store):
    """중복 병합 규칙: note 는 rules 순서상 첫 매칭 엣지, curated 는 가장 강한 값."""
    res = assess(store, _body(27, "그외", sigungu="11680"))  # 조례 미확인 지역
    by_to = {a["to"]: a for a in res["alt_edges"]}
    sv = store.edges_from("svoucher")

    def first_edge(to):
        return next(e for e in sv if e["to"] == to)

    for to, alt in by_to.items():
        assert alt["note"] == first_edge(to).get("note", to)
    # tteuntteun 은 income_fail·age_fail 두 벌 모두 '공식 확인' → 그대로 유지
    assert by_to["tteuntteun"]["curated"].startswith("공식 확인")
    # public_program 은 두 벌 모두 '검증 대기' → 승격되지 않는다(없는 검증을 만들지 않음)
    assert by_to["public_program"]["curated"] == "검증 대기"


def test_alt_edges_empty_for_high_priority_eligible(store):
    # 자격 충족 + 고순위(1순위) dvoucher는 대체경로 노출 불필요 → 빈 배열
    assert assess(store, _disabled(14, "차상위"))["alt_edges"] == []
    # 자격 충족 svoucher(P1)도 빈 배열
    assert assess(store, _body(10, "기초생활수급"))["alt_edges"] == []


def test_alt_edges_eligible_low_rank_dvoucher_surfaces_alternative(store):
    # 자격은 되지만 예상 5순위(비저소득 성인) → 대기 가능 → income_fail 대안 노출
    alts = assess(store, _disabled(32, "그외"))["alt_edges"]
    assert len(alts) >= 1
    assert all(set(a) >= {"to", "note", "curated", "program"} for a in alts)


# --- P5 페르소나: dvoucher 자격 충족 + 예상 5순위 ---------------------------
def test_p5_selection_rank_5(store):
    res = assess(store, _disabled(32, "그외"))
    card = _card(res)
    assert card["program_id"] == "dvoucher"
    assert card["eligible"] is True
    assert card["selection"]["expected_rank"] == 5


def test_p5_persona_body_matches(personas_by_id):
    # personas.py P5 계약: 32세 지체장애 비저소득 성북구
    assert "P5" in personas_by_id
    body = personas_by_id["P5"]["body"]
    assert body["age"] == 32
    assert body["disability"]["has"] is True
    assert body["income_class"] == "그외"
    assert body["sigungu_cd"] == "11290"
