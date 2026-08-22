"""Fitness weakness assessment. Contract: docs/API.md POST /api/fitness.

M1a — 판정 기준을 "데모 근사"에서 "국민체력100 공식 인증기준"으로 교체.

  * PRIMARY: measurement_item / fitness_norm 테이블(scripts/scrape_norms.py 적재)이
    있으면 연령군별 1·2·3등급 컷으로 항목별 판정 + 종합 참고등급(추정)을 낸다.
    weaknesses.basis = "국민체력100 공식 인증기준(문체부 고시 체계)".
  * FALLBACK: 두 테이블이 없는 데모/레거시 DB 는 이전 DEMO 근사 컷을 그대로 사용하고
    basis = "데모 기준(연령·성별 근사)" 로 정직하게 표기(무중단).

연령군: 유아기(만4~6·비인증)/유소년(11~12)/청소년(13~18)/성인(19~64)/어르신(65+).
만 7~10 세는 공식 기준이 없어 age_gap 처리(유소년 기준 참고 판정 제공).
"""
from __future__ import annotations

import re
from typing import Any, Optional

from .store import Store

# ---------------------------------------------------------------------------
# 공통: 추천/영상 매핑 (fitness_map). 그래프 연동은 다음 배치 — 여기선 무접촉.
# ---------------------------------------------------------------------------
BASIS_OFFICIAL = "국민체력100 공식 인증기준(문체부 고시 체계)"
BASIS_DEMO = "데모 기준(연령·성별 근사)"

# HTML 요인명 → fitness_map 키 (협응력↔협응성 표기 차이 흡수).
_FACTOR_TO_MAP = {"협응력": "협응성"}

# 건강체력 / 운동체력 / 신체조성 요인 분류 (공식 등급 판정용).
HEALTH_FACTORS = ("심폐지구력", "근력", "근지구력", "유연성")
EXERCISE_FACTORS = ("민첩성", "순발력", "협응력", "평형성")
BODY_FACTOR = "신체조성"


def _map_factor(factor: str) -> str:
    return _FACTOR_TO_MAP.get(factor, factor)


def _fmt(n: Any) -> str:
    """숫자 표기: 정수형 float 는 소수점 제거(42.0 → '42')."""
    if n is None:
        return ""
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


# 단위가 '기간/단위' 형식인 항목: chair_stand='30초/회'(30초 동안 몇 회).
# 그대로 이어붙이면 "14" + "30초/회" = "1430초/회" 로 읽혀 값이 뭉개진다.
_PERIOD_UNIT = re.compile(r"^(\d+(?:\.\d+)?(?:초|분|시간))\s*/\s*(.+)$")


def _with_unit(value: Any, unit: Optional[str]) -> str:
    """값+단위 결합 표기. '30초/회' 는 '14회(30초)' 로, 그 밖의 단위는 종전대로 붙인다.

    'ml/kg/min' 처럼 슬래시가 있어도 앞이 기간이 아니면 건드리지 않는다.
    """
    v = _fmt(value)
    u = (unit or "").strip()
    if not u:
        return v
    m = _PERIOD_UNIT.match(u)
    if m:
        return f"{v}{m.group(2)}({m.group(1)})"
    return f"{v}{u}"


# ---------------------------------------------------------------------------
# 연령군 판별
# ---------------------------------------------------------------------------
def age_group_of(age: int) -> str:
    if age <= 6:
        return "유아"          # 만 4~6 (비인증)
    if age <= 10:
        return "gap"           # 만 7~10 (공식 기준 없음)
    if age <= 12:
        return "유소년"
    if age <= 18:
        return "청소년"
    if age <= 64:
        return "성인"
    return "어르신"


# ===========================================================================
# OFFICIAL PATH
# ===========================================================================
# 기존 4키 → 요인별 우선 항목코드(연령군에 존재하는 첫 코드로 해석).
_LEGACY_TARGET = {
    "grip_kg": ["grip_rel"],
    "flex_cm": ["sit_reach"],
    "situp_cnt": ["situp_roll", "crunch_cross", "chair_stand"],
    "shuttle_cnt": ["shuttle_15m", "shuttle_20m", "walk_2min"],
}


def _resolve_measures(measures: dict, norms: dict) -> dict[str, float]:
    """{legacy_or_code: value} → {official_code: value}. 직접코드가 레거시보다 우선."""
    judged: dict[str, float] = {}
    # 1) 레거시 4키 먼저
    for key, value in measures.items():
        if value is None or key not in _LEGACY_TARGET:
            continue
        for code in _LEGACY_TARGET[key]:
            if code in norms:
                judged[code] = float(value)
                break
    # 2) 공식 항목 코드(직접) — 레거시 매핑을 덮어씀
    for key, value in measures.items():
        if value is None or key in _LEGACY_TARGET:
            continue
        if key in norms:
            judged[key] = float(value)
    return judged


def _numeric_band(value: float, cuts: dict, higher_better: int):
    """→ (band_label, grade|None). higher_better=0 이면 부등호 반전(시간계)."""
    def c(g):
        return cuts.get(g, {}).get("value")
    order = [(1, "1등급 수준"), (2, "2등급 수준"), (3, "3등급 수준")]
    if higher_better:
        for g, label in order:
            cv = c(g)
            if cv is not None and value >= cv:
                return label, g
    else:
        for g, label in order:
            cv = c(g)
            if cv is not None and value <= cv:
                return label, g
    return "기준 미달", None


def _rule_ok(value: float, rule: str) -> bool:
    """신체조성 범위/부등호 규칙 충족 여부. 예: '18.5이상 25미만', '< .50', '7%초과 27%미만'."""
    s = rule.replace("%", "").replace(" ", "").replace("＜", "<").replace("〈", "<")
    num = r"(-?\d*\.?\d+)"
    try:
        m = re.match(rf"^{num}이상{num}미만$", s)
        if m:
            return float(m.group(1)) <= value < float(m.group(2))
        m = re.match(rf"^{num}초과{num}미만$", s)
        if m:
            return float(m.group(1)) < value < float(m.group(2))
        m = re.match(rf"^<{num}$", s)
        if m:
            return value < float(m.group(1))
        m = re.match(rf"^{num}이상$", s)
        if m:
            return value >= float(m.group(1))
        m = re.match(rf"^{num}미만$", s)
        if m:
            return value < float(m.group(1))
    except (ValueError, TypeError):
        return False
    return False


def _body_band(value: float, cuts: dict):
    """신체조성(3등급 건강범위 규칙) 판정 → (band, grade|None)."""
    rule = cuts.get(3, {}).get("rule")
    if rule is None:
        return "판정 기준 없음", None
    if _rule_ok(value, rule):
        return "건강범위(3등급)", 3
    return "기준 미달", None


def _threshold_grade(cuts: dict) -> Optional[int]:
    """미달 판정의 기준선 = 컷이 존재하는 가장 낮은 등급(=가장 높은 번호).
    건강체력→3, 성인 운동체력(1·2등급만 존재)→2."""
    for g in (3, 2, 1):
        cell = cuts.get(g, {})
        if cell.get("value") is not None or cell.get("rule") is not None:
            return g
    return None


def _comparison(meta: dict, value: float, band: str, grade: Optional[int], cuts: dict) -> str:
    """비교문. 예: '교차윗몸 일으키기 38회 — 19~24세 남 3등급 컷 42회 미달'.
    단위가 '기간/단위'(chair_stand='30초/회')면 '14회(30초)' 로 푼다(_with_unit)."""
    name = meta["name"]
    unit = meta["unit"] or ""
    band_lbl = meta["age_band"]
    sexk = "남" if meta.get("sex") == "M" else "여"
    hb = meta["higher_better"]
    val = _with_unit(value, unit)
    if grade is None:
        tg = _threshold_grade(cuts)
        cut = cuts.get(tg, {}).get("value") if tg else None
        cut_r = cuts.get(tg, {}).get("rule") if tg else None
        if cut is not None:
            tail = "초과" if hb == 0 else "미달"
            return (f"{name} {val} — {band_lbl} {sexk} {tg}등급 컷 "
                    f"{_with_unit(cut, unit)} {tail}")
        if cut_r is not None:
            return f"{name} {val} — {band_lbl} {sexk} {tg}등급 건강범위({cut_r}) 벗어남"
        return f"{name} {val} — {band_lbl} {sexk} 기준 미달"
    cut = cuts.get(grade, {}).get("value")
    cut_r = cuts.get(grade, {}).get("rule")
    if cut is not None:
        return f"{name} {val} — {band_lbl} {sexk} {band}(컷 {_with_unit(cut, unit)})"
    if cut_r is not None:
        return f"{name} {val} — {band_lbl} {sexk} {band}({cut_r})"
    return f"{name} {val} — {band_lbl} {sexk} {band}"


def _reference_grade(factor_best: dict, present_factors: set, missing_factors: list) -> dict:
    """공식 규칙(전 항목 통과제 + 4~6 파생)을 입력 항목만으로 추정."""
    def health_pass(g: int) -> bool:
        return all(
            f in present_factors and factor_best.get(f) is not None and factor_best[f] <= g
            for f in HEALTH_FACTORS
        )

    def exercise_pass(g: int) -> bool:
        return any(
            f in present_factors and factor_best.get(f) is not None and factor_best[f] <= g
            for f in EXERCISE_FACTORS
        )

    body_present = BODY_FACTOR in present_factors
    body_ok = factor_best.get(BODY_FACTOR) == 3

    grade: Optional[int] = None
    for g in (1, 2):
        if health_pass(g) and exercise_pass(g):
            grade = g
            break
    if grade is None and health_pass(3) and (body_ok or not body_present):
        grade = 3
    if grade is None:
        cardio3 = factor_best.get("심폐지구력") is not None
        strength3 = factor_best.get("근력") is not None
        if cardio3 and strength3:
            grade = 4
        elif cardio3 or strength3:
            grade = 5
        else:
            grade = 6

    return {
        "grade": grade,
        "label": "참고 등급(추정)",
        "rule": "건강체력 전항목 최저기준 통과제(1등급 상위30%·2등급 50%·3등급 70%)"
                " + 운동체력 1개 통과, 4~6등급은 심폐·근력 파생",
        "missing": missing_factors,
        "note": "공식 등급은 전 항목 측정 시에만 확정됩니다. 입력된 항목만으로 추정한 참고값입니다.",
    }


def _assess_official(store: Store, age: int, sex: str, measures: dict) -> dict:
    group = age_group_of(age)

    # 유아기(만4~6): 4단계 비인증 — 등급 판정 대상 아님.
    if group == "유아":
        return _empty_result(
            age_group="유아기",
            message="유아기(만4~6)는 열매·꽃·새싹·씨앗 4단계 비인증 기준으로, 등급 판정 대상이 아닙니다.",
            basis=BASIS_OFFICIAL,
            certifiable=False,
        )

    # 판정에 쓸 연령군 컷 선택 (7~10 세는 유소년 기준을 참고로 적용).
    age_gap = group == "gap"
    ref_age = 11 if age_gap else age
    norms = store.fitness_norms(ref_age, sex)
    if not norms:
        # 공식 테이블은 있으나 해당 연령 컷이 없음 → 데모 폴백(무중단).
        return _assess_demo(store, age, sex, measures)

    # 각 meta 에 sex 주입(비교문 성별 표기용).
    for e in norms.values():
        e["meta"]["sex"] = sex

    gap_note = " · 유소년(11~12) 기준 참고 적용(만7~10 공식 기준 없음)" if age_gap else ""
    basis = BASIS_OFFICIAL + gap_note

    judged = _resolve_measures(measures, norms)

    items: list[dict] = []
    weaknesses: list[dict] = []
    factor_best: dict[str, Optional[int]] = {}
    present_factors: set[str] = set()

    for code, value in judged.items():
        meta = norms[code]["meta"]
        cuts = norms[code]["cuts"]
        factor = meta["factor"]
        present_factors.add(factor)
        if factor == BODY_FACTOR or meta["higher_better"] is None:
            band, grade = _body_band(value, cuts)
        else:
            band, grade = _numeric_band(value, cuts, meta["higher_better"])
        # 요인별 최고(최소 숫자) 등급 갱신 — alt 항목은 택1(둘 중 좋은 쪽).
        if grade is not None:
            prev = factor_best.get(factor)
            factor_best[factor] = grade if prev is None else min(prev, grade)
        else:
            factor_best.setdefault(factor, None)

        comparison = _comparison(meta, value, band, grade, cuts)
        item = {
            "code": code,
            "name": meta["name"],
            "factor": _map_factor(factor),
            "value": value,
            "unit": meta["unit"],
            "band": band,
            "grade": grade,
            "comparison": comparison,
            "basis": basis,
        }
        items.append(item)
        if grade is None:
            tg = _threshold_grade(cuts)
            weaknesses.append({
                "item": _map_factor(factor),   # fitness_map 키 (추천 연동)
                "name": meta["name"],
                "value": value,
                "unit": meta["unit"],
                "band": band,                  # "기준 미달"
                "cut": cuts.get(tg, {}).get("value") if tg else None,
                "cut_grade": tg,
                "comparison": comparison,
                "basis": basis,
            })

    # 미입력 요인 목록 (참고등급 정직성).
    missing_factors = [
        _map_factor(f) for f in (*HEALTH_FACTORS, *EXERCISE_FACTORS, BODY_FACTOR)
        if f not in present_factors and _factor_in_group(norms, f)
    ]
    reference_grade = _reference_grade(factor_best, present_factors, missing_factors) if judged else None

    # 약점 요인 → 추천/영상/시설 필터 (중복 요인 제거).
    weak_factors: list[str] = []
    for w in weaknesses:
        if w["item"] not in weak_factors:
            weak_factors.append(w["item"])
    recommendations, videos, filter_sports = _recommend_tail_graph(store, weak_factors, age)

    result = {
        "age_group": {"gap": "만7~10(공백)", "유소년": "유소년", "청소년": "청소년",
                      "성인": "성인", "어르신": "어르신"}.get(group, group),
        "age_gap": age_gap,
        "sex": sex,
        "basis": basis,
        "items": items,
        "weaknesses": weaknesses,
        "reference_grade": reference_grade,
        "recommendations": recommendations,
        "videos": videos,
        "facility_filter_sports": filter_sports,
    }
    if age_gap:
        result["message"] = "이 연령은 국민체력100 공식 기준이 없습니다. 유소년(11~12세) 기준을 참고로 제공합니다."
    return result


def _factor_in_group(norms: dict, factor: str) -> bool:
    """해당 연령군 카탈로그에 이 요인 항목이 존재하는지(어르신엔 순발/신체조성 없음 등)."""
    return any(e["meta"]["factor"] == factor for e in norms.values())


# ===========================================================================
# DEMO FALLBACK (구 DB / 테이블 부재) — 이전 근사 컷 그대로, basis="데모 기준".
# ===========================================================================
# measure key -> fitness dimension (matches rules.json fitness_map.weakness)
MEASURE_ITEM = {
    "grip_kg": "근력",
    "situp_cnt": "근지구력",
    "flex_cm": "유연성",
    "shuttle_cnt": "심폐지구력",
}


def _demo_age_band(age: int) -> str:
    if age < 13:
        return "child"
    if age < 19:
        return "teen"
    if age < 40:
        return "adult"
    if age < 65:
        return "middle"
    return "senior"


# DEMO lower/upper cutoffs by (measure, band, sex). value < lower => 하위(약점).
_CUT: dict[str, dict[str, dict[str, tuple[float, float]]]] = {
    "grip_kg": {
        "child":  {"M": (12, 20), "F": (11, 18)},
        "teen":   {"M": (28, 40), "F": (20, 30)},
        "adult":  {"M": (36, 48), "F": (22, 32)},
        "middle": {"M": (32, 44), "F": (20, 30)},
        "senior": {"M": (26, 38), "F": (16, 26)},
    },
    "situp_cnt": {
        "child":  {"M": (18, 32), "F": (15, 28)},
        "teen":   {"M": (30, 45), "F": (22, 36)},
        "adult":  {"M": (28, 42), "F": (20, 34)},
        "middle": {"M": (22, 36), "F": (16, 28)},
        "senior": {"M": (12, 24), "F": (8, 18)},
    },
    "flex_cm": {
        "child":  {"M": (2, 12), "F": (5, 15)},
        "teen":   {"M": (3, 13), "F": (7, 17)},
        "adult":  {"M": (0, 11), "F": (5, 16)},
        "middle": {"M": (-2, 9), "F": (3, 14)},
        "senior": {"M": (-4, 7), "F": (0, 11)},
    },
    "shuttle_cnt": {
        "child":  {"M": (20, 45), "F": (15, 35)},
        "teen":   {"M": (40, 70), "F": (25, 50)},
        "adult":  {"M": (35, 62), "F": (22, 45)},
        "middle": {"M": (25, 50), "F": (16, 36)},
        "senior": {"M": (14, 32), "F": (10, 24)},
    },
}


def _demo_band(measure: str, value: float, age: int, sex: str) -> str:
    band = _demo_age_band(age)
    sex = sex if sex in ("M", "F") else "M"
    lo, hi = _CUT[measure][band][sex]
    if value < lo:
        return "하위"
    if value < hi:
        return "보통"
    return "상위"


def _assess_demo(store: Store, age: int, sex: str, measures: dict) -> dict:
    weaknesses: list[dict] = []
    for key, item in MEASURE_ITEM.items():
        value = measures.get(key)
        if value is None:
            continue
        band = _demo_band(key, value, age, sex)
        if band == "하위":
            weaknesses.append({
                "item": item,
                "value": value,
                "band": band,
                "basis": BASIS_DEMO,
            })
    weak_factors = [w["item"] for w in weaknesses]
    recommendations, videos, filter_sports = _recommend_tail(store, weak_factors)
    return {
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "videos": videos,
        "facility_filter_sports": filter_sports,
    }


# ---------------------------------------------------------------------------
# 공유: 추천 / 영상 / 시설 필터 종목 (fitness_map)
# ---------------------------------------------------------------------------
def _recommend_tail(store: Store, weak_factors: list[str]):
    fmap = {m["weakness"]: m for m in store.fitness_map}
    recommendations: list[dict] = []
    rec_sports: list[str] = []
    for factor in weak_factors:
        entry = fmap.get(factor)
        if not entry:
            continue
        recommendations.append({
            "weakness": factor,
            "exercises": entry.get("exercises", []),
            "sports": entry.get("sports", []),
            "curated": "체대 검증 대기",
        })
        for s in entry.get("sports", []):
            if s not in rec_sports:
                rec_sports.append(s)

    weak_set = set(weak_factors)
    videos: list[dict] = []
    from .store import load_videos
    for v in load_videos():
        if v.get("for_weakness") in weak_set:
            videos.append({
                "title": v.get("title"),
                "url": v.get("url"),
                "source": v.get("source"),
            })
    return recommendations, videos, rec_sports


# ---------------------------------------------------------------------------
# 그래프 연동 추천 (M1b): 약점요인 → 요인별 {운동·종목·영상 + provenance}.
# 각 후보에 출처(kspo_standard/guideline/kspo_video/curated)를 동봉해 UI 배지 원천이 된다.
# 그래프 테이블 부재/빈 결과 시 fitness_map 폴백(무중단, DR-4).
# ---------------------------------------------------------------------------
def _recommend_from_graph(store: Store, weak_factors: list[str], age: int):
    """graph.recommend_for_weakness 서브그래프를 /api/fitness 응답형으로 조립.
    그래프가 없거나 매칭 0이면 None 을 돌려 폴백을 유도한다."""
    from . import graph
    sub = graph.recommend_for_weakness(weak_factors, age, store.conn)
    if not sub:
        return None

    recommendations: list[dict] = []
    rec_sports: list[str] = []
    videos: list[dict] = []
    seen_vid: set[str] = set()
    for factor in weak_factors:
        block = sub.get(factor)
        if not block:
            continue
        recommendations.append({
            "weakness": factor,
            "exercises": block["exercises"],   # [{name, provenance}]
            "sports": block["sports"],         # [{name, provenance}]
            "videos": block["videos"],         # [{title,url,img_url,trng_nm,provenance}]
            "source": "graph",
        })
        for sp in block["sports"]:
            if sp["name"] not in rec_sports:
                rec_sports.append(sp["name"])
        for v in block["videos"]:
            key = v.get("url") or v.get("trng_nm") or ""
            if key and key not in seen_vid:
                seen_vid.add(key)
                videos.append({
                    "title": v.get("title"),
                    "url": v.get("url"),
                    "img_url": v.get("img_url"),
                    "trng_nm": v.get("trng_nm"),
                    "source": "국민체력100 운동영상(공단 콘텐츠)",
                })
    if not recommendations:
        return None
    return recommendations, videos, rec_sports


def _recommend_tail_graph(store: Store, weak_factors: list[str], age: int):
    """그래프 우선 → 부재/빈 결과 시 fitness_map 폴백(무중단)."""
    out = _recommend_from_graph(store, weak_factors, age)
    if out is not None:
        return out
    return _recommend_tail(store, weak_factors)


def _empty_result(age_group: str, message: str, basis: str, certifiable: bool = True) -> dict:
    return {
        "age_group": age_group,
        "age_gap": False,
        "certifiable": certifiable,
        "message": message,
        "basis": basis,
        "items": [],
        "weaknesses": [],
        "reference_grade": None,
        "recommendations": [],
        "videos": [],
        "facility_filter_sports": [],
    }


# ===========================================================================
# entry point
# ===========================================================================
# ---------------------------------------------------------------------------
# 파생 항목 (FR-07 AC8) — 사용자는 자기 BMI 를 모른다(QA 실사용 피드백). 키·몸무게를 받아
# **서버가** 계산한다(결정론, P-2). bmi = 몸무게(kg) ÷ 키(m)² (WHO 표준 정의).
#   · 직접 bmi 값이 오면 그것이 우선(측정기·인바디 값 존중).
#   · 키 100~250cm·몸무게 20~300kg 범위 밖이면 계산하지 않는다 — 오타로 나온 값을 판정에 넣는
#     것보다 비우는 편이 정직하다(P-1). 계산 근거는 응답 derived[] 로 그대로 돌려준다.
# ---------------------------------------------------------------------------
DERIVED_ITEMS: dict[str, dict] = {
    "bmi": {
        "inputs": [
            {"code": "height_cm", "name": "키", "unit": "cm", "min": 100, "max": 250},
            {"code": "weight_kg", "name": "몸무게", "unit": "kg", "min": 20, "max": 300},
        ],
        "formula": "몸무게(kg) ÷ 키(m)²",
    },
}


def _derive_bmi(height_cm: float, weight_kg: float) -> float:
    return round(weight_kg / ((height_cm / 100.0) ** 2), 1)


def derive_measures(measures: dict) -> tuple[dict, list[dict]]:
    """입력 measures 에서 파생 항목을 계산해 채운 **사본**과 계산 근거 목록을 돌려준다.
    직접값이 있으면 건드리지 않고, 입력이 모자라거나 범위 밖이면 계산하지 않는다."""
    out = dict(measures or {})
    derived: list[dict] = []
    for code, spec in DERIVED_ITEMS.items():
        if out.get(code) is not None:
            continue  # 직접값 우선
        vals: dict[str, float] = {}
        ok = True
        for inp in spec["inputs"]:
            raw = out.get(inp["code"])
            try:
                fv = float(raw) if raw is not None else None
            except (TypeError, ValueError):
                fv = None
            if fv is None or not (inp["min"] <= fv <= inp["max"]):
                ok = False
                break
            vals[inp["code"]] = fv
        if not ok:
            continue
        if code != "bmi":
            continue  # 현재 파생 항목은 bmi 뿐
        value = _derive_bmi(vals["height_cm"], vals["weight_kg"])
        out[code] = value
        derived.append({"code": code, "value": value, "from": vals, "formula": spec["formula"]})
    return out, derived


def assess_fitness(store: Store, payload: dict) -> dict:
    age = int(payload.get("age", 0))
    sex = payload.get("sex", "M")
    measures, derived = derive_measures(payload.get("measures") or {})
    if store.has_fitness_norms():
        result = _assess_official(store, age, sex, measures)
    else:
        result = _assess_demo(store, age, sex, measures)
    result["derived"] = derived  # 계산 근거(키·몸무게 → BMI) — 화면이 "자동 계산" 출처를 밝힌다
    return result
