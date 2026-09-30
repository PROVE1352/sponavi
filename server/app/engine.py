"""Assessment engine: pure eligibility rules + curated alt-path graph + supply gap.
No LLM, no fabrication — everything derives from data/rules.json + fixtures.
Contract: docs/API.md POST /api/assess.
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional

from . import region
from .store import Store, haversine_km

# distance parameters
SUPPLY_GAP_RADIUS_KM = 3.0   # SPEC/contract: honesty signal radius
NEARBY_RADIUS_KM = 6.0       # display radius for nearby facility lists
NEARBY_LIMIT = 6

# applicant income_class -> coverage fixture class code (S=기초수급, N=차상위·한부모)
_COVERAGE_CLASS = {
    "기초생활수급": ("S", "기초수급"),
    "차상위": ("N", "차상위·한부모"),
    "한부모": ("N", "차상위·한부모"),
    "그외": ("N", "차상위·한부모"),  # default (matches API.md example: 그외 신청자 → N 통계)
}


def _round_km(v: float) -> float:
    return round(v, 2)


# ---------------------------------------------------------------------------
# 좌표 정직성 (FR-04/FR-05): 실좌표(api·geocoded)만 거리(km) 노출, 시군구 중심 폴백
# (centroid)은 거리 미표기. 내부 정렬·최근접 판단엔 폴백 거리도 쓰되(방향성), 사용자
# 노출 수치엔 금지. geocoded는 카카오 지오코딩 실좌표(scripts/geocode_demo.py, M2).
# ---------------------------------------------------------------------------
_REAL_COORD_SOURCES = frozenset({"api", "geocoded"})


def _is_real_coord(fac: dict) -> bool:
    return fac.get("coord_source") in _REAL_COORD_SOURCES


def _expose_dist(fac: dict) -> Optional[float]:
    """사용자 노출용 거리. 실좌표면 km, 근사좌표(구 중심)면 None(미표기)."""
    return fac["dist_km"] if _is_real_coord(fac) else None


def _facility_hop_label(fac: dict) -> str:
    """경로 다이어그램 시설 홉 라벨. 근사좌표엔 'Nonekm'를 찍지 않는다."""
    d = fac.get("dist_km")
    if _is_real_coord(fac) and d is not None:
        return f"{fac['name']} · {d}km"
    return fac["name"]


def _primary_program_id(disability_has: bool) -> str:
    """비장애=svoucher, 장애=dvoucher (SPEC §5 프레이밍)."""
    return "dvoucher" if disability_has else "svoucher"


def _primary_source(disability_has: bool) -> str:
    """이용권 가맹시설 소스: 비장애=voucher, 장애=dvoucher."""
    return "dvoucher" if disability_has else "voucher"


# ---------------------------------------------------------------------------
# 예상 선정순위 (dvoucher) — 결정론. data/rules.json dvoucher.selection_priority 원천.
# 신청은 소득무관(자격), 선정은 우선순위제(예산·경쟁) — UI가 둘을 반드시 구분(PRD §6).
# 공식 5단계:
#   1순위 5~18 수급·차상위·한부모 / 2순위 19+ 수급 / 3순위 19+ 차상위·한부모
#   4순위 5~18 비저소득 / 5순위 19+ 비저소득
# income_class 허용값(models.py)만 매핑 — 그 외('모름' 계열)는 순위 미정(None) 처리.
# ---------------------------------------------------------------------------
_SELECTION_CATEGORY = {
    "기초생활수급": "수급",
    "차상위": "차상위·한부모",
    "한부모": "차상위·한부모",
    "그외": "비저소득",
}


def _selection_category(income_class: str) -> Optional[str]:
    """소득 자가선언 → 선정순위 소득범주. 미확인 값이면 None(순위 미정)."""
    return _SELECTION_CATEGORY.get(income_class)


def _is_youth(age: int) -> bool:
    return 5 <= age <= 18


def _selection_rank(age: int, category: Optional[str]) -> Optional[int]:
    """(age, 소득범주) → 예상 선정순위 1~5. 소득범주 미정이면 None."""
    if category is None:
        return None
    if _is_youth(age):
        # 5~18: 수급·차상위·한부모 모두 1순위, 비저소득만 4순위
        return 4 if category == "비저소득" else 1
    # 19세 이상
    if category == "수급":
        return 2
    if category == "차상위·한부모":
        return 3
    return 5  # 비저소득


def _rank_label(rank: Optional[int], age: int, category: Optional[str]) -> str:
    if rank is None or category is None:
        # 순위 미정: 소득 구분 확인 후 안내 + 확인 방법
        return "소득 구분 확인 후 안내 — 수급·차상위·한부모 해당 여부를 주민센터·복지로(bokjiro.go.kr)에서 확인하세요"
    age_label = "유청소년" if _is_youth(age) else "성인"
    return f"예상 {rank}순위({age_label}·{category})"


def _build_selection(program: dict, *, age: int, income_class: str) -> dict:
    """dvoucher 자격 카드용 selection 객체(계약). rules 원문 tiebreak·source 그대로 전달."""
    sp = program.get("selection_priority") or {}
    category = _selection_category(income_class)
    rank = _selection_rank(age, category)
    return {
        "expected_rank": rank,
        "rank_label": _rank_label(rank, age, category),
        "note": "선정은 우선순위제 — 지자체 예산·경쟁에 따라 대기 가능",
        "tiebreak": sp.get("tiebreak"),
        "source": sp.get("source"),
    }


# ---------------------------------------------------------------------------
# eligibility
# ---------------------------------------------------------------------------
def _eval_program(program: dict, *, age: int, income_class: str, disability_has: bool) -> dict:
    """Evaluate one program -> eligibility card with per-field reasons."""
    elig = program["eligibility"]
    reasons: list[dict] = []
    failed: set[str] = set()

    # age
    amin, amax = elig.get("age_min", 0), elig.get("age_max", 200)
    age_ok = amin <= age <= amax
    reasons.append({
        "field": "age",
        "ok": age_ok,
        "message": (
            f"지원 연령({amin}~{amax}세)에 해당합니다 (현재 {age}세)"
            if age_ok
            else f"지원 연령({amin}~{amax}세)을 벗어났습니다 (현재 {age}세)"
        ),
    })
    if not age_ok:
        failed.add("age")

    # income
    inc_rule = elig.get("income_classes", "any")
    if inc_rule == "any":
        income_ok = True
        income_msg = "소득 요건 없음(대상 누구나)" if program["id"] != "dvoucher" else "소득 무관(등록 장애인 대상, 저소득 우선선정)"
    else:
        income_ok = income_class in inc_rule
        allowed = "·".join(inc_rule)
        income_msg = (
            f"소득 기준({allowed})에 해당합니다"
            if income_ok
            else f"소득 기준({allowed})에 해당하지 않습니다"
        )
    reasons.append({"field": "income_class", "ok": income_ok, "message": income_msg})
    if not income_ok:
        failed.add("income")

    # disability
    dis_rule = elig.get("disability", "any")
    if dis_rule == "required":
        dis_ok = disability_has
        dis_msg = "장애인 등록 대상입니다" if dis_ok else "장애인 등록이 확인되지 않습니다(비장애)"
    elif dis_rule == "none":
        dis_ok = not disability_has
        dis_msg = "비장애 대상입니다" if dis_ok else "이 제도는 비장애 대상입니다"
    else:  # any
        dis_ok = True
        dis_msg = "장애 여부 무관"
    reasons.append({"field": "disability", "ok": dis_ok, "message": dis_msg})
    if not dis_ok:
        failed.add("disability")

    eligible = len(failed) == 0
    src = (program.get("sources") or [{}])[0]
    card = {
        "program_id": program["id"],
        "program_name": program["name"],
        "eligible": eligible,
        "reasons": reasons,
        "benefit": program.get("benefit"),
        "apply": program.get("apply"),
        "source": {"url": src.get("url"), "checked": src.get("checked")},
        "verified": program.get("verified", False),
        "_failed": sorted(failed),  # internal, stripped before response
    }
    # dvoucher: 자격(소득무관)과 별개로 예상 선정순위(우선순위제)를 부착. FR-02 AC5.
    if program["id"] == "dvoucher" and eligible:
        card["selection"] = _build_selection(program, age=age, income_class=income_class)
    return card


# ---------------------------------------------------------------------------
# nearby facilities
# ---------------------------------------------------------------------------
def _target_matches_age(target: str, age: int) -> bool:
    if target in ("전연령", "장애인"):
        return True
    if target == "유청소년":
        return age <= 18
    if target == "성인":
        return 19 <= age <= 64
    if target == "어르신":
        return age >= 65
    return True


def _representative_fee(store: Store, facility_id: str, age: Optional[int]) -> Optional[int]:
    """Cheapest course fee for the applicant's age band (fallback: cheapest overall).
    age=None(시설 검색 — 나이 미상)이면 전체 강좌 중 최저."""
    courses = store.courses_for(facility_id)
    if not courses:
        return None
    age_matched = (
        [c for c in courses if _target_matches_age(c.get("target", ""), age)]
        if age is not None else []
    )
    pool = age_matched or courses
    fees = [c["fee_month"] for c in pool if c.get("fee_month") is not None]
    return min(fees) if fees else None


def _course_note(store: Store, facility_id: str, age: Optional[int]) -> Optional[str]:
    courses = store.courses_for(facility_id)
    if not courses:
        return None
    age_matched = (
        [c for c in courses if _target_matches_age(c.get("target", ""), age)]
        if age is not None else []
    )
    pool = age_matched or courses
    priced = [c for c in pool if c.get("fee_month") is not None]
    if not priced:
        return None
    cheapest = min(priced, key=lambda c: c["fee_month"])
    if cheapest["fee_month"] == 0:
        return f"무료 프로그램: {cheapest['name']}"
    return f"최저 월 {cheapest['fee_month']:,}원 강좌: {cheapest['name']}"


def _with_distance(facilities: list[dict], lat: float, lon: float) -> list[dict]:
    out = []
    for f in facilities:
        d = haversine_km(lat, lon, f["lat"], f["lon"])
        out.append({**f, "dist_km": _round_km(d)})
    out.sort(key=lambda f: f["dist_km"])
    return out


def _bbox(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    """반경 원을 포함하는 위경도 사각형. 1° 위도 ≈ 111km, 경도는 cos(위도) 보정."""
    dlat = radius_km / 111.0
    coslat = max(0.1, math.cos(math.radians(lat)))
    dlon = radius_km / (111.0 * coslat)
    return (lat - dlat, lat + dlat, lon - dlon, lon + dlon)


def _nearest_facility(store: Store, source: str, lat: float, lon: float) -> Optional[dict]:
    """확장 링 탐색: 링 내 최소거리 ≤ 링 반경이면 전역 최솟값이 증명된다
    (박스 밖 점은 축 거리만으로 링 반경 초과). 최후엔 전량 폴백."""
    for radius in (10.0, 50.0, None):
        bbox = _bbox(lat, lon, radius) if radius is not None else None
        cand = _with_distance(store.facilities(source, bbox=bbox), lat, lon)
        if not cand:
            continue
        if radius is None or cand[0]["dist_km"] <= radius:
            return cand[0]
    return None


def _voucher_facilities(
    store: Store, source: str, lat: float, lon: float, subsidy: int, age: int,
    *, eligible: bool,
) -> list[dict]:
    """이용권 가맹시설 행. `eligible` 은 이 시설을 만든 제도 카드의 자격 판정이다.

    자격 미충족(✗)인데 지원금을 차감하면 "자부담 0원 = 무료"라는 거짓 금액이 나간다
    (판결 제약 P-1). 비적격이면 지원금 0 · 자부담 = 수강료 그대로 (결정 1A).
    """
    facs = _with_distance(
        store.facilities(source, bbox=_bbox(lat, lon, NEARBY_RADIUS_KM)), lat, lon
    )
    row_subsidy = subsidy if eligible else 0
    out = []
    for f in facs:
        if f["dist_km"] > NEARBY_RADIUS_KM:
            continue
        out.append(_voucher_row(store, f, source, age, row_subsidy))
        if len(out) >= NEARBY_LIMIT:
            break
    return out


def _voucher_row(
    store: Store, f: dict, source: str, age: Optional[int], row_subsidy: Optional[int],
) -> dict:
    """이용권 가맹시설 1행 직렬화 — assess nearby 와 시설 검색이 같은 모양을 쓴다.

    row_subsidy=None 은 "자격 미상"(시설 검색): 지원금·자부담을 계산하지 않고 둘 다
    null 로 둔다. 판정 없이 지원금을 차감하면 거짓 금액, 0 으로 두면 "지원 없음"이라는
    거짓 판정이 된다(P-1·P-2)."""
    fee = _representative_fee(store, f["id"], age)
    if row_subsidy is None:
        copay = None
    else:
        copay = None if fee is None else max(0, fee - row_subsidy)
    return {
        "id": f["id"],
        "name": f["name"],
        # 이용권 종류(voucher|dvoucher) — 웹의 장애인 가맹 배지·접근성 블록 원천(OV3).
        "source": source,
        "sports": f["sports"],
        "lat": f["lat"],
        "lon": f["lon"],
        "coord_source": f["coord_source"],
        # 이용권 시설은 시군구 중심 폴백(근사) → 거리 미표기(null).
        "dist_km": _expose_dist(f),
        "sigungu_nm": f["sigungu_nm"],
        "fee_month": fee,
        "subsidy": row_subsidy,
        "copay": copay,
        "disability_support": f["disability_support"],
    }


def _alternatives(
    store: Store, lat: float, lon: float, age: int, disability_filter: bool,
    public_only: bool = False,
) -> list[dict]:
    """근처 공공·대안 시설 행(최대 NEARBY_LIMIT).

    public_only=True 는 경로 그림의 '공공체육시설 → 시설' 홉용: 원천 구분(faci_gb)이 '공공'인
    행만 남긴다. 신고·등록(민간 헬스장 등)을 공공체육시설 조례 감면 뒤에 이으면 그 시설이 구립인
    것처럼 읽힌다(FR-04 AC7 · P-1). faci_gb 컬럼이 없는 옛 DB(None)는 거르지 않는다."""
    facs = _with_distance(
        store.facilities("public", bbox=_bbox(lat, lon, NEARBY_RADIUS_KM)), lat, lon
    )
    # OV1: 실좌표(api·geocoded) 행 우선, 시군구 중심 폴백(centroid)은 후순위.
    # 폴백 행은 거리를 못 밝히므로(FR-04) 목록 머리를 차지하면 "근처"를 못 보여준다.
    # 같은 그룹 안에서는 거리 오름차순 유지(안정 정렬 — _with_distance 가 이미 정렬).
    facs.sort(key=lambda f: (
        f.get("coord_source") == "centroid",
        f["dist_km"] if f["dist_km"] is not None else float("inf"),
    ))
    out = []
    for f in facs:
        if f["dist_km"] > NEARBY_RADIUS_KM:
            continue
        if disability_filter and not f["disability_support"]:
            continue
        if public_only and f.get("faci_gb") not in ("공공", None):
            continue
        out.append(_alt_row(store, f, age))
        if len(out) >= NEARBY_LIMIT:
            break
    return out


def _alt_row(store: Store, f: dict, age: Optional[int]) -> dict:
    """공공·대안 시설 1행 직렬화 — assess nearby 와 시설 검색이 같은 모양을 쓴다."""
    return {
        "id": f["id"],
        "name": f["name"],
        "type": "공공체육시설",
        "sports": f["sports"],
        "lat": f["lat"],
        "lon": f["lon"],
        "coord_source": f["coord_source"],
        # public 은 대부분 실좌표 → km 노출. 폴백 행만 미표기(null).
        "dist_km": _expose_dist(f),
        "sigungu_nm": f["sigungu_nm"],
        # 시설 구분(공공/신고/등록) — AltRow 배지·gap.html 이 같은 컬럼을 쓴다(OV6).
        # 마이그레이션 전 DB 는 컬럼이 없어 None (없는 배지를 만들지 않는다).
        "faci_gb": f.get("faci_gb"),
        "note": _course_note(store, f["id"], age),
        "disability_support": f["disability_support"],
    }


# ---------------------------------------------------------------------------
# supply gap + coverage
# ---------------------------------------------------------------------------
def _voucher_label(disability_has: bool) -> str:
    return "장애인스포츠강좌이용권" if disability_has else "스포츠강좌이용권"


def _sigungu_nm(store: Store, sigungu_cd: Optional[str]) -> Optional[str]:
    """사용자 시군구명(구 단위 가맹 라벨용). 좌표 없이 이름만 조회."""
    if not sigungu_cd:
        return None
    c = store.centroid(sigungu_cd)
    return c.get("nm") if c else None


def _coverage(store: Store, sigungu_cd: str, income_class: str) -> Optional[dict]:
    rows = store.coverage_rows(sigungu_cd)
    if not rows:
        return None  # SPEC: 데이터 없는 구는 coverage null
    code, label = _COVERAGE_CLASS.get(income_class, ("N", "차상위·한부모"))
    match = next((r for r in rows if r["class"] == code), None)
    if match is None:
        match = rows[0]
        label = "기초수급" if match["class"] == "S" else "차상위·한부모"
    target = match["target"]
    recipient = match["recipient"]
    rate = round(recipient / target, 3) if target else None
    return {
        "sigungu": match["sigungu_nm"],
        "class": label,
        "target": target,
        "recipient": recipient,
        "rate": rate,
        "year": match["year"],
    }


def _supply_gap(
    store: Store, *, source: str, lat: float, lon: float,
    disability_has: bool, disability_filter: bool, age: int,
    sigungu_cd: str, income_class: str,
) -> dict:
    # FR-04 AC2: 이용권 시설은 실좌표가 아니므로 "반경 N km" 금지.
    #            사용자 시군구(sigungu_cd) 일치 = "OO구 가맹 N곳"(구 단위 카운트, SQL COUNT).
    user_sigungu_nm = _sigungu_nm(store, sigungu_cd)
    # FR-05 AC4: 행정구역 개편 전환기로 한 생활권이 옛/신 코드 여럿에 걸친 곳(인천 서해구·
    #            검단구 ← 옛 서구 등)은 영역그룹으로 합산한다 — 한 코드만 세면 거짓 공급공백.
    scope_codes, group = region.count_scope(sigungu_cd)
    if scope_codes:
        voucher_count = store.count_facilities_in_sigungus(source, scope_codes)
    else:
        voucher_count = 0  # 시군구 미상(좌표만 입력) → 구 단위 카운트 근거 없음

    # 공공 대안 풀은 실좌표(api 위주) → 반경 유지 (bbox 프리필터, 결과 동일).
    alt_all = _with_distance(
        store.facilities("public", bbox=_bbox(lat, lon, SUPPLY_GAP_RADIUS_KM)), lat, lon
    )
    if disability_filter:
        alt_all = [f for f in alt_all if f["disability_support"]]
    alt_in = [f for f in alt_all if f["dist_km"] <= SUPPLY_GAP_RADIUS_KM]

    # 최근접 이용권 시설: 확장 링 탐색(내부 거리 — 방향성). 노출은 coord_source 규칙.
    nearest = None
    n = _nearest_facility(store, source, lat, lon)
    if n is not None:
        nearest = {
            "name": n["name"],
            "coord_source": n["coord_source"],
            "dist_km": _expose_dist(n),      # 실좌표만 km, 근사면 None
            "sigungu_nm": n["sigungu_nm"],   # 근사 시설 노출용 '△△구'
        }

    label = _voucher_label(disability_has)
    # 그룹이면 문구에 '일대(옛 ○○)'를 밝힌다 — 어느 코드들을 합쳤는지 숨기지 않는다(P-1).
    where = (group["label"] if group else None) or user_sigungu_nm or "이 지역"
    # 헤드라인은 짧게. 최근접 상세(실좌표면 km, 아니면 '△△구')는 nearest 구조체로 전달
    # (표기 규칙은 소비자가 coord_source 로 판단 — 문구 중복 방지).
    if voucher_count == 0:
        # FR-05 AC1: 카운트 0 → 경고 헤드라인.
        message = f"{where}에 {label} 가맹시설이 없습니다"
    else:
        # FR-04 AC2: 이용권은 구 단위 카운트. 예: "스포츠강좌이용권 · 성북구 가맹 41곳"
        message = f"{label} · {where} 가맹 {voucher_count}곳"

    return {
        "radius_km": SUPPLY_GAP_RADIUS_KM,   # 공공 대안 카운트(alt_count) 기준 반경
        "voucher_count": voucher_count,
        "voucher_scope": "sigungu",          # 이용권 카운트 기준: 구 단위(반경 아님)
        "sigungu_nm": user_sigungu_nm,
        "scope_codes": list(scope_codes),     # 실제로 센 코드들(그룹이면 여럿)
        "scope_label": group["label"] if group else None,
        "scope_reason": group["reason"] if group else None,
        "alt_count": len(alt_in),
        "nearest": nearest,
        "message": message,
        "coverage": _coverage(store, sigungu_cd, income_class),
    }


# ---------------------------------------------------------------------------
# path
# ---------------------------------------------------------------------------
_FAIL_LABEL = {"age": "나이>기준", "income": "소득>기준", "disability": "장애요건"}
_WHEN_TO_FAIL = {"age_fail": "age", "income_fail": "income", "disability_fail": "disability"}
_CURATED_OFFICIAL = "공식 확인"


def _curated_rank(curated: Any) -> int:
    """정렬·병합용 큐레이션 강도. '공식 확인…' 0 · 그 밖('검증 대기') 1."""
    return 0 if str(curated or "").startswith(_CURATED_OFFICIAL) else 1


def _program_age_ok(program: Optional[dict], age: Optional[int]) -> bool:
    """대상 제도 자체의 연령 범위(age_min/age_max, null = 무제한)가 이 사람을 포함하는가.
    대체경로도 '그 제도의 대상'이어야 안내한다 — 16세에게 근로소득자용 소득공제를
    내미는 식의 오안내 차단(P-1). 제도 정의가 없거나 age 미상이면 걸러내지 않는다."""
    if not program or age is None:
        return True
    elig = program.get("eligibility") or {}
    amin, amax = elig.get("age_min"), elig.get("age_max")
    if amin is not None and age < amin:
        return False
    if amax is not None and age > amax:
        return False
    return True


def _matching_alt_edges(
    store: Store, pid: str, active: set, age: Optional[int] = None,
    sigungu_cd: Optional[str] = None,
) -> list[dict]:
    """매칭 대체경로 엣지를 `to` 기준으로 유일화한 목록 (결정 CQ2A).

    같은 대상 제도로 가는 엣지가 사유별로 여러 개다(예: svoucher→public_program 이
    income_fail·age_fail 두 벌) — 그대로 내보내면 UI 에 같은 줄이 중복된다.

    - note·when·filter 는 rules 순서상 **첫** 매칭 엣지 것을 쓴다.
    - curated 는 중복 중 **가장 강한** 값(공식 확인 > 검증 대기).
    - 출력 순서는 공식 확인 먼저(그 안에서는 rules 순서), 그 다음 나머지.
    - 대상 제도의 연령 범위가 이 사람의 나이를 벗어나면 뺀다(_program_age_ok).
    - public_program 은 사람의 시군구에 **조례 원문 확인분**(data/public_fee_reductions.json)이
      있을 때만 '공식 확인(조례 …)'으로 승격한다. 없으면 rules 의 '검증 대기' 그대로.
    """
    order: list[str] = []
    picked: dict[str, dict] = {}
    for e in store.edges_from(pid):
        when = e.get("when", "any")
        if when != "any" and _WHEN_TO_FAIL.get(when) not in active:
            continue
        to = e["to"]
        if not _program_age_ok(store.program(to), age):
            continue
        curated = e.get("curated", "검증 대기")
        if to not in picked:
            order.append(to)
            picked[to] = {**e, "curated": curated}
        elif _curated_rank(curated) < _curated_rank(picked[to]["curated"]):
            picked[to]["curated"] = curated
    if _PUBLIC_PROGRAM in picked:
        promoted = _public_fee_curated(store.public_fee_region(sigungu_cd), store)
        if promoted and _curated_rank(promoted) < _curated_rank(picked[_PUBLIC_PROGRAM]["curated"]):
            picked[_PUBLIC_PROGRAM]["curated"] = promoted
    # sorted 는 안정 정렬 — 같은 등급 안에서는 rules 순서가 그대로 남는다.
    return sorted((picked[to] for to in order), key=lambda e: _curated_rank(e["curated"]))


# ---------------------------------------------------------------------------
# 공공체육시설 사용료 감면 — 시군구 조례 원문 확인분(data/public_fee_reductions.json)
# ---------------------------------------------------------------------------
_PUBLIC_PROGRAM = "public_program"
# 경로 그림에서 '시설' 홉을 이을 수 있는 대체 제도(장소 기반). 튼튼머니·문화비 소득공제·
# 어르신 상품권은 시설 데이터가 없으므로 여기 없다.
_PLACE_BASED_PROGRAMS = frozenset({_PUBLIC_PROGRAM})
# 나이 정의가 조례에 없을 때의 보수적 폴백(다른 4개 시군구 조례가 모두 18세를 상한으로 둔다).
_YOUTH_FALLBACK_MAX = 18
_YOUTH_UNCLEAR_CAVEAT = "청소년·어린이 나이 기준이 조례에 없음 — 시설에 확인"
_SEOUL_MULTICHILD_CAVEAT = (
    "다둥이행복카드 발급 기준(자녀 수·막내 나이)은 서울시 카드 사업 기준이며 조례에 없음(미확인)"
)
# 이 사람에게 해당하는데 조례에 조항이 없을 때의 정직한 공백 문구.
_GAP_LABEL = {
    "near_poor": "차상위 전용 감면 없음(조례 확인)",
    "single_parent": "한부모 감면 없음(조례 확인)",
    "basic_livelihood": "기초생활수급 감면 없음(조례 확인)",
    "multichild": "다자녀 감면 없음(조례 확인)",
    "defector": "북한이탈주민 감면 없음(조례 확인)",
    "disability": "장애인 감면 없음(조례 확인)",
}
# region.unverified 문장 → 관련 대상. 대상 키워드가 없는 문장은 지역 공통 주의.
_CAVEAT_KEYWORDS = (
    ("청소년", "youth"), ("어린이", "youth"), ("나이", "youth"),
    ("다둥이", "multichild"), ("다자녀", "multichild"),
    ("수급자", "basic_livelihood"), ("한부모", "single_parent"), ("장애인", "disability"),
)
# 인용 표기·수집 메모(사용자에게 의미 없는 데이터 주석)는 caveat 로 내보내지 않는다.
_CAVEAT_DATA_NOTES = ("quote", "오기", "기록하지 않음")


def _public_fee_curated(region_row: Optional[dict], store: Store) -> Optional[str]:
    """조례 확인 지역이면 '공식 확인(조례 {시행일 또는 확인일})', 아니면 None."""
    if not region_row:
        return None
    law = region_row.get("law") or {}
    when = law.get("effective") or store.public_fees.get("checked")
    return f"공식 확인(조례 {when})" if when else "공식 확인(조례)"


def _parse_youth_ages(text: Optional[str]) -> list[tuple[int, int]]:
    """'어린이 6~12세, 청소년 18세 이하' → [(6,12),(0,18)]. 어린이·청소년 구절만 본다
    (영유아·노인 구절 제외). 숫자가 없으면 [] = 정의 없음."""
    out: list[tuple[int, int]] = []
    for part in re.split(r"[,，;]", text or ""):
        if "어린이" not in part and "청소년" not in part:
            continue
        for lo, hi in re.findall(r"(\d+)\s*세?\s*~\s*(\d+)\s*세", part):
            out.append((int(lo), int(hi)))
        for hi in re.findall(r"(?:^|[^~\d])(\d+)\s*세\s*이하", part):
            out.append((0, int(hi)))
    return out


def _youth_ranges(reduction: dict, region_row: dict) -> list[tuple[int, int]]:
    """감면 행 자체의 age_definition → 없으면 같은 지역 다른 youth 행의 정의."""
    own = _parse_youth_ages(reduction.get("age_definition"))
    if own:
        return own
    if reduction.get("age_definition"):
        return []  # 정의 칸은 있는데 숫자가 없다 = "정의 없음(미확인)"
    for r in region_row.get("reductions") or []:
        if r.get("target") == "youth":
            rng = _parse_youth_ages(r.get("age_definition"))
            if rng:
                return rng
    return []


def _reduction_row(r: dict, **extra: Any) -> dict:
    row = {
        "target": r.get("target"),
        "label": r.get("label"),
        "rate": r.get("rate"),
        "condition": r.get("condition") or None,
        "quote": r.get("quote"),
        "source_url": r.get("source_url"),
    }
    if r.get("age_definition"):
        row["age_definition"] = r["age_definition"]
    row.update({k: v for k, v in extra.items() if v is not None})
    return row


def _public_fee_block(
    region_row: Optional[dict], person: dict, checked: Optional[str] = None,
) -> Optional[dict]:
    """public_program 대체경로에 붙일 '이 사람에게 맞는 감면' 블록. 조례 미확인 지역이면 None.

    매칭은 결정론(P-2): youth=조례의 청소년·어린이 나이 범위(정의 없으면 18세 이하 폴백 +
    caveat), basic_livelihood=기초생활수급, single_parent=한부모, multichild=special 자가선언,
    disability=장애 있음. near_poor·defector 는 데이터에 조항이 있을 때만(현재 5개 지역 모두
    없음 → no_reduction_for 로 정직하게 밝힌다). '중복 불가' 같은 other 행은 감면이 아니다."""
    if not region_row:
        return None
    age = person.get("age")
    income = person.get("income_class")
    special = set(person.get("special") or [])
    disability_has = bool(person.get("disability_has"))
    reductions = region_row.get("reductions") or []
    seoul = str(region_row.get("sido") or "").startswith("서울")

    # 이 사람에게 해당하는 대상 범주(자가선언 기준)
    wanted: list[str] = []
    if income == "기초생활수급":
        wanted.append("basic_livelihood")
    elif income == "차상위":
        wanted.append("near_poor")
    elif income == "한부모":
        wanted.append("single_parent")
    if "multichild" in special:
        wanted.append("multichild")
    if "defector" in special:
        wanted.append("defector")
    if disability_has:
        wanted.append("disability")

    matched: list[dict] = []
    matched_targets: set[str] = set()
    youth_unclear = False
    if age is not None:
        for r in reductions:
            if r.get("target") != "youth":
                continue
            ranges = _youth_ranges(r, region_row)
            if ranges:
                if any(lo <= age <= hi for lo, hi in ranges):
                    matched.append(_reduction_row(r))
            elif age <= _YOUTH_FALLBACK_MAX:
                youth_unclear = True
                matched.append(_reduction_row(r, caveat=_YOUTH_UNCLEAR_CAVEAT))
    if any(m["target"] == "youth" for m in matched):
        matched_targets.add("youth")

    for target in wanted:
        rows = [r for r in reductions if r.get("target") == target]
        if target == "multichild" and rows:
            # special 'multichild' = 3자녀 이상(models.py). 3자녀 행이 있으면 그것만 —
            # '2자녀 이상' 행은 더 낮은 율의 상위집합이라 나열하면 혼란만 준다.
            three = [r for r in rows if any(k in (r.get("label") or "") for k in ("3자녀", "세 자녀"))]
            rows = three or rows
        for r in rows:
            caveat = _SEOUL_MULTICHILD_CAVEAT if (target == "multichild" and seoul) else None
            matched.append(_reduction_row(r, caveat=caveat))
        if rows:
            matched_targets.add(target)

    no_reduction_for = [
        _GAP_LABEL[t] for t in wanted if t not in matched_targets and t in _GAP_LABEL
    ]

    caveats: list[str] = []
    for text in region_row.get("unverified") or []:
        if any(k in text for k in _CAVEAT_DATA_NOTES):
            continue
        targets = {t for k, t in _CAVEAT_KEYWORDS if k in text}
        if "multichild" in targets:
            # 다둥이 문장의 '나이'는 막내 나이(카드 기준)다 — 청소년 감면과 무관.
            targets = {"multichild"}
        if targets and not (targets & matched_targets):
            continue
        caveats.append(text)
    if youth_unclear and not any("나이" in c for c in caveats):
        caveats.insert(0, _YOUTH_UNCLEAR_CAVEAT)
    if len({m["target"] for m in matched}) >= 2:
        for r in reductions:
            blob = " ".join(str(r.get(k) or "") for k in ("label", "condition", "quote"))
            if r.get("target") == "other" and "중복" in blob:
                caveats.append("감면 사유가 둘 이상이면 가장 높은 감면율 하나만 적용(조례)")
                break

    law = region_row.get("law") or {}
    operator = region_row.get("operator") or {}
    return {
        "region": {
            "sigungu_cd": region_row.get("sigungu_cd"),
            "sigungu_nm": region_row.get("sigungu_nm"),
            "sido": region_row.get("sido"),
        },
        "law": {
            "title": law.get("title"),
            "article": law.get("article"),
            "url": law.get("url"),
            "effective": law.get("effective"),
        },
        "operator": {"name": operator.get("name"), "url": operator.get("url") or None},
        "scope": region_row.get("scope"),
        "checked": checked,  # 조례 원문 확인일(파일 최상위 checked)
        "reductions": matched,
        "no_reduction_for": no_reduction_for,
        "caveats": caveats,
    }


def _build_path(
    store: Store, *, card: dict, failed: list[str],
    voucher_facilities: list[dict], alternatives: list[dict], age: Optional[int] = None,
    sigungu_cd: Optional[str] = None,
) -> tuple[list[dict], bool]:
    """Returns (path, disability_filter_from_edge)."""
    pid = card["program_id"]
    path: list[dict] = []

    if card["eligible"]:
        path.append({
            "from": "person", "to": pid, "edge": "자격",
            "result": "ok", "label": "예상 자격 충족",
        })
        if voucher_facilities:
            top = voucher_facilities[0]
            path.append({
                "from": pid, "to": f"facility:{top['id']}", "edge": "적합·접근",
                "result": "ok", "label": _facility_hop_label(top),
            })
        return path, False

    # ineligible -> fail node + first matching curated alt edge
    fail_label = " / ".join(_FAIL_LABEL.get(f, f) for f in failed) or "자격 미충족"
    path.append({
        "from": "person", "to": pid, "edge": "자격",
        "result": "fail", "label": fail_label,
    })

    # OV4: 주 경로도 dedupe 목록의 1순위(공식 확인 우선)를 쓴다 — alt_edges 첫 줄과
    # 경로 그림의 대체 홉이 어긋나지 않는다.
    edges = _matching_alt_edges(store, pid, set(failed), age, sigungu_cd)
    if not edges:
        return path, False
    edge = edges[0]

    disability_filter = bool((edge.get("filter") or {}).get("disability_support"))
    to = edge["to"]
    path.append({
        "from": pid, "to": to, "edge": "대체경로",
        "result": "ok", "label": edge.get("note", to),
        "curated": edge["curated"],
    })
    # 시설 홉은 대체 제도가 '장소 기반'(공공체육시설)일 때만 잇는다. 튼튼머니·소득공제 뒤에
    # 가장 가까운 공공시설을 붙이면 "그 체육관이 튼튼머니 적립시설"이라는 거짓 연결이 된다
    # (튼튼머니 적립시설·소득공제 등록시설 데이터는 없다 — P-1). 그런 경로는 제도 노드에서 끝난다.
    if to in _PLACE_BASED_PROGRAMS and alternatives:
        top = alternatives[0]
        path.append({
            "from": to, "to": f"facility:{top['id']}", "edge": "적합·접근",
            "result": "ok", "label": _facility_hop_label(top),
        })
    return path, disability_filter


def _collect_alt_edges(
    store: Store, *, card: dict, failed: list[str], selection_rank: Optional[int],
    age: Optional[int] = None, sigungu_cd: Optional[str] = None,
    person: Optional[dict] = None,
) -> list[dict]:
    """복수 대체경로: 주 제도의 매칭 엣지를 수집(FR-02 AC3). `to` 기준 유일 · 공식 확인
    우선(CQ2A) — 주 경로(path)는 그 1순위를 쓰고, 응답 top-level 엔 전부를 동봉해
    UI가 상위 N개를 렌더하도록 한다.

    - 자격 미충족(failed) 카드: failed 사유에 맞는 엣지 매칭.
    - dvoucher 자격 충족이나 예상 선정순위가 낮거나(4·5) 미정: 신청은 되지만 대기 가능 →
      income_fail 계열 '지금 바로 되는' 대안도 함께 노출.
    """
    pid = card["program_id"]
    active = set(failed)
    if card["eligible"] and pid == "dvoucher" and selection_rank in (4, 5, None):
        active.add("income")

    out: list[dict] = []
    for e in _matching_alt_edges(store, pid, active, age, sigungu_cd):
        prog = store.program(e["to"])
        program_info = None
        if prog:
            program_info = {
                "id": prog["id"],
                "name": prog["name"],
                "benefit": prog.get("benefit"),
                "apply_url": (prog.get("apply") or {}).get("url"),
            }
        row = {
            "to": e["to"],
            "note": e.get("note", e["to"]),
            "curated": e["curated"],
            "program": program_info,
        }
        if e["to"] == _PUBLIC_PROGRAM:
            block = _public_fee_block(
                store.public_fee_region(sigungu_cd), person or {},
                checked=store.public_fees.get("checked"),
            )
            if block is not None:
                row.update(block)
        out.append(row)
    return out


# ---------------------------------------------------------------------------
# 내년(2027) 예상 — 정부 예산안 기준 확대 대상. 2026 판정을 대체하지 않는 "나란히" 블록.
# ---------------------------------------------------------------------------
# 시도 정식명 → 짧은 표기(상세 문구용). 표에 없으면 원문 그대로(지어내지 않는다).
_SIDO_SHORT = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북",
    "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남",
    "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
    "전남광주통합특별시": "전남광주",
}


def _depop_detail(reg: dict) -> str:
    sido = str(reg.get("sido") or "").strip()
    sido = _SIDO_SHORT.get(sido, sido)
    where = " ".join(x for x in (sido, str(reg.get("sigungu_nm") or "").strip()) if x)
    return f"{where or '거주 지역'} — 인구감소지역"


def _source_row(src: dict, fallback_label: str) -> Optional[dict]:
    url = (src or {}).get("url")
    if not url:
        return None
    return {
        "url": url,
        "label": src.get("label") or fallback_label,
        "checked": src.get("checked"),
    }


def _next_year(
    store: Store, program: dict, *, card: dict, failed: list[str], age: int,
    sigungu_cd: Optional[str], special: list[str],
) -> Optional[dict]:
    """svoucher 카드가 2026 기준 **소득 사유 하나로만** ✗ 일 때(= 연령은 범위 안)
    2027 예산안의 확대 대상에 해당하는지 결정론으로 본다.

    - 판정 재료: 자가선언(special: 다자녀·북한이탈주민) + 시군구코드의 인구감소지역 대조.
      LLM 은 관여하지 않는다(P-2).
    - 예산안(국회 심의 전)이므로 결과는 '확정'이 아니다 — basis·note·curated 로 밝히고,
      2027 연령 범위는 현행과 같다고 **가정**했음을 age_assumed/age_note 로 싣는다(P-1).
    - 히어로 "지금 바로 되는 것 N" 이나 alt_edges 에는 절대 들어가지 않는다(카드 부속).
    """
    ny = program.get("next_year")
    if not ny or program.get("id") != "svoucher" or card.get("eligible"):
        return None
    if set(failed) != {"income"}:
        return None
    amin, amax = ny.get("age_min"), ny.get("age_max")
    if (amin is not None and age < amin) or (amax is not None and age > amax):
        return None

    declared = set(special or [])
    matched: list[dict] = []
    possible_if: list[str] = []
    extra_sources: list[dict] = []
    for cat in ny.get("added_categories") or []:
        cid, label = cat.get("id"), cat.get("label")
        hit: Optional[dict] = None
        if cid == "depop_region":
            reg = store.depopulation_region(sigungu_cd)
            if reg is not None:
                basis = store.depopulation.get("basis") or "인구감소지역 지정"
                # 지정 근거(고시일·재지정 여부)를 숨기지 않는다 — 명단은 바뀔 수 있다(P-1).
                hit = {"id": cid, "label": label, "detail": _depop_detail(reg), "basis": basis}
                rows = [
                    r for r in (
                        _source_row(src if isinstance(src, dict) else {"url": src}, basis)
                        for src in store.depopulation.get("sources") or []
                    ) if r
                ]
                # 공식(go.kr) 출처만 카드에 싣는다. 공식 출처가 없을 때만 전부.
                official = [r for r in rows if ".go.kr" in r["url"]]
                extra_sources.extend(official or rows)
        elif cid in declared:
            hit = {"id": cid, "label": label, "detail": f"{label} — 본인 응답"}
        if hit:
            matched.append(hit)
        else:
            possible_if.append(label)

    sources = [
        r for r in (_source_row(s, "2027 예산안 보도") for s in ny.get("sources") or []) if r
    ] + extra_sources
    return {
        "year": ny.get("year"),
        "basis": ny.get("basis"),
        "eligible": bool(matched),
        "matched": matched,
        "possible_if": possible_if,
        "note": ny.get("note"),
        "age_assumed": bool(ny.get("age_assumed", True)),
        "age_note": ny.get("age_note"),
        "apply_hint": ny.get("apply_hint"),
        "sources": sources,
        "curated": ny.get("curated"),
        "subsidy_month": ny.get("subsidy_month"),
    }


# ---------------------------------------------------------------------------
# public entry
# ---------------------------------------------------------------------------
class AssessError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def assess(store: Store, payload: dict) -> dict:
    age = payload["age"]
    income_class = payload.get("income_class", "그외")
    disability = payload.get("disability") or {}
    disability_has = bool(disability.get("has"))
    # 구 시군구코드(전환기 잔존 입력, 예: 광주 북구 29170)는 현행 코드로 먼저 해석한다.
    # 이 한 줄이 없으면 시설·커버리지·공급공백이 전부 빈 코드를 조회해 "가맹 0곳"이라는
    # 거짓 공급공백이 뜬다(P-1). 정규화 표는 DB sigungu_alias = server/app/region.py.
    sigungu_cd = store.canonical_sigungu(payload.get("sigungu_cd"))

    # resolve location
    loc = payload.get("location")
    if loc and loc.get("lat") is not None and loc.get("lon") is not None:
        lat, lon = float(loc["lat"]), float(loc["lon"])
    else:
        centroid = store.centroid(sigungu_cd) if sigungu_cd else None
        if not centroid:
            raise AssessError(
                "LOCATION_UNRESOLVED",
                "좌표 또는 유효한 시군구코드가 필요합니다(위치를 확인할 수 없습니다).",
            )
        lat, lon = centroid["lat"], centroid["lon"]

    primary_id = _primary_program_id(disability_has)
    source = _primary_source(disability_has)
    program = store.program(primary_id)
    if not program:
        raise AssessError("PROGRAM_MISSING", f"제도 정의를 찾을 수 없습니다: {primary_id}")

    card = _eval_program(
        program, age=age, income_class=income_class, disability_has=disability_has
    )
    failed = card.pop("_failed")
    # 2027 예산안 확대 대상(나란히 표기) — 2026 판정(eligible)은 그대로 둔다.
    ny = _next_year(
        store, program, card=card, failed=failed, age=age,
        sigungu_cd=sigungu_cd, special=list(payload.get("special") or []),
    )
    if ny is not None:
        card["next_year"] = ny

    subsidy = program.get("subsidy_month", 0)
    voucher_facilities = _voucher_facilities(
        store, source, lat, lon, subsidy, age, eligible=card["eligible"]
    )

    # need the alt edge's disability filter before building alternatives -> peek path once
    # build path with a provisional (unfiltered) alt list, extract filter, then rebuild alts.
    provisional_alts = _alternatives(store, lat, lon, age, disability_filter=disability_has)
    path, edge_filter = _build_path(
        store, card=card, failed=failed,
        voucher_facilities=voucher_facilities, alternatives=provisional_alts, age=age,
        sigungu_cd=sigungu_cd,
    )
    disability_filter = disability_has or edge_filter
    alternatives = _alternatives(store, lat, lon, age, disability_filter=disability_filter)
    # rebuild the final facility hop against filtered alternatives — 홉은 원천 '공공' 시설만
    # (신고·등록 민간 시설을 '공공체육시설' 대체경로 뒤에 잇지 않는다).
    if not card["eligible"]:
        path, _ = _build_path(
            store, card=card, failed=failed,
            voucher_facilities=voucher_facilities,
            alternatives=_alternatives(
                store, lat, lon, age, disability_filter=disability_filter, public_only=True,
            ),
            age=age, sigungu_cd=sigungu_cd,
        )

    supply_gap = _supply_gap(
        store, source=source, lat=lat, lon=lon,
        disability_has=disability_has, disability_filter=disability_filter,
        age=age, sigungu_cd=sigungu_cd, income_class=income_class,
    )

    # 복수 대체경로(매칭 엣지 전부) — UI는 상위 N개 렌더(FR-02 AC3).
    selection_rank = (card.get("selection") or {}).get("expected_rank")
    alt_edges = _collect_alt_edges(
        store, card=card, failed=failed, selection_rank=selection_rank, age=age,
        sigungu_cd=sigungu_cd,
        person={
            "age": age, "income_class": income_class, "disability_has": disability_has,
            "special": list(payload.get("special") or []),
        },
    )

    # 조례 감면(공공체육시설 사용료)은 이용권 자격과 **무관하게** 받을 수 있다 — 이용권 대상자도
    # 구립 체육센터 요금을 감면받는다(예: 노원 14세 한부모 20%, 대구 북구 12세 청소년 50%).
    # 대체경로(public_program) 엣지에만 붙이면 자격 ✓ 사용자는 이 사실을 못 본다(2026-09-28 평가).
    # 같은 매칭 함수를 쓰므로 엣지 블록과 내용이 같다. 조례 미확인 지역이면 None(지어내지 않는다).
    public_fee = _public_fee_block(
        store.public_fee_region(sigungu_cd),
        {
            "age": age, "income_class": income_class, "disability_has": disability_has,
            "special": list(payload.get("special") or []),
        },
        checked=store.public_fees.get("checked"),
    )

    return {
        "eligibility": [card],
        "path": path,
        "alt_edges": alt_edges,
        "public_fee": public_fee,
        "nearby": {
            # 결정 1A: 자격 ✗ 면 가맹시설이 1순위가 될 수 없다(⚠#10) — 웹은 이 순서대로
            # 덱·리스트를 배치한다. 자격 판정은 서버 소유(P-2).
            "primary": "voucher" if card["eligible"] else "alternatives",
            "voucher_facilities": voucher_facilities,
            "alternatives": alternatives,
        },
        "supply_gap": supply_gap,
    }


# ---------------------------------------------------------------------------
# 시설 키워드 검색 — GET /api/facilities/search (docs/API.md)
# 이용권 가맹시설 대부분은 좌표가 구 중심 폴백이라 지도를 옮겨도 목록이 바뀌지 않는다.
# 대신 이름·주소(동·도로명) 부분일치로 그 구 안의 시설을 찾는다. 자격 판정은 하지 않는다.
# ---------------------------------------------------------------------------
SEARCH_PROGRAMS = {"svoucher": "voucher", "dvoucher": "dvoucher", "public": "public"}
SEARCH_LIMIT_DEFAULT = 30
SEARCH_LIMIT_MAX = 50
SEARCH_Q_MAX = 30


def search_facilities(
    store: Store, *, sigungu_cd: str, q: str, program: str = "svoucher",
    limit: int = SEARCH_LIMIT_DEFAULT, lat: Optional[float] = None,
    lon: Optional[float] = None, age: Optional[int] = None,
) -> dict:
    """q 는 호출부(main)에서 trim·길이 검증을 마친 값. 토큰 = 공백 분리(중복 제거, 순서 보존).

    정렬: 실좌표 행 먼저(거리 오름차순 — 원점 = lat/lon, 없으면 시군구 중심) → 구 중심 폴백 행(이름순).
    total 은 잘라내기 **전** 일치 수, truncated = total > len(facilities)."""
    source = SEARCH_PROGRAMS.get(program)
    if source is None:
        raise AssessError("INVALID_PROGRAM", f"알 수 없는 제도입니다: {program}")
    cd = store.canonical_sigungu(sigungu_cd)
    if not cd or not store.centroid(cd):
        raise AssessError(
            "LOCATION_UNRESOLVED", "유효한 시군구코드가 필요합니다(지역을 확인할 수 없습니다)."
        )
    scope_codes, group = region.count_scope(cd)
    tokens = list(dict.fromkeys(q.split()))
    rows = store.search_facilities(source, scope_codes, tokens)

    # 원점: 요청 좌표, 없으면 시군구 중심(assess 와 같은 폴백). 거리는 실좌표 행만 노출된다.
    if lat is None or lon is None:
        c = store.centroid(cd)
        lat, lon = c["lat"], c["lon"]
    for f in rows:
        f["dist_km"] = (
            _round_km(haversine_km(lat, lon, f["lat"], f["lon"]))
            if f.get("lat") is not None and f.get("lon") is not None
            else None
        )

    def _key(f: dict):
        real = _is_real_coord(f)
        dist = f["dist_km"] if (real and f["dist_km"] is not None) else float("inf")
        return (not real, dist, f["name"] or "", f["id"])

    rows.sort(key=_key)
    total = len(rows)
    picked = rows[: max(1, min(int(limit), SEARCH_LIMIT_MAX))]
    if source == "public":
        facilities = [_alt_row(store, f, age) for f in picked]
    else:
        # 자격 미상 — subsidy/copay = null (fee_month 만 사실로 싣는다).
        facilities = [_voucher_row(store, f, source, age, None) for f in picked]
    # 검색은 매칭 근거(주소)를 보여 줘야 한다 — 검색 응답에만 addr 를 싣는다.
    for row, f in zip(facilities, picked):
        row["addr"] = f.get("addr")

    return {
        "sigungu_cd": cd,
        "sigungu_nm": _sigungu_nm(store, cd),
        "scope_codes": list(scope_codes),
        "scope_label": group["label"] if group else None,
        "program": program,
        "q": q,
        "tokens": tokens,
        "match_fields": ["name", "addr"],
        "eligibility_applied": False,
        "total": total,
        "truncated": total > len(facilities),
        "facilities": facilities,
    }


# ---------------------------------------------------------------------------
# 지도 범위 검색 — GET /api/facilities/in-bounds (docs/API.md)
# "이 지역에서 다시 찾기": 화면 범위 안의 **위치가 확인된(real 등급)** 시설만 점으로 돌려주고,
# 정확한 위치를 확인할 수 없는 시설(시군구 중심점·자리표시 점·먼 행·번지 없는 geocoded·번지 없이 한 점을
# 함께 쓰는 api)은 시군구 전체 수로 따로 알린다(unlocated). 자격 판정·지원금 차감 없음(search 와 같다).
# 좌표 등급·공간 인덱스는 프로세스 메모리 안에서만 만든다(app/area_index.py, DB 무변경).
# 상수는 web/src/mocks/contract/area_search.json 과 같아야 한다(tests C1).
# ---------------------------------------------------------------------------
AREA_MAX_DIAG_KM = 20.0
# 경도 폭(max_lon − min_lon)이 이보다 크면 haversine 은 지구 반대편 **짧은 길**로 재어 범위의 폭을 잃는다
# (min_lon=−180·max_lon=180 이면 sin²(Δλ/2)≈0 이라 대각선이 위도 차만 남는다). 그런 범위는 대각선과
# 상관없이 AREA_TOO_WIDE 다 — 범위 판정·가운데 계산은 min_lon ≤ lon ≤ max_lon(긴 길)로 읽기 때문이다.
AREA_MAX_LON_SPAN_DEG = 180.0
AREA_LIMIT_DEFAULT = 50
AREA_LIMIT_MAX = 50
KOREA_BOUNDS = {"min_lat": 32.5, "max_lat": 39.6, "min_lon": 124.0, "max_lon": 132.5}
AREA_PLACEHOLDER_MIN_AREAS = 3
AREA_SUSPECT_MAX_KM = 40.0
AREA_ROBUST_MIN_ROWS = 5
AREA_GEOCODED_BNO_PATTERN = r"(?:^|[\s,])(?:산\s?)?[0-9]+(?:-[0-9]+)?(?:번지)?(?=$|[\s,(])"
AREA_GEOCODED_BNO_RE = re.compile(AREA_GEOCODED_BNO_PATTERN)
# 한 점 공유(shared_point): api 행 중 주소에 번지(지번·건물번호)가 없는 행이, 역시 번지 없는 **다른 이름의**
# api 행과 좌표를 **똑같이**(반올림 없음) 함께 쓰면 시군구·읍면동·도로 단위로 지오코딩된 근사 좌표다
# (실 DB: '대전광역시 동구' 한 줄 주소 88행이 한 점, '경기도 가평군' 31행이 한 점). 이름이 하나뿐인 점
# (같은 시설 중복 행)과 혼자 있는 점(약수터·공원)은 그대로 둔다. api 주소는 '양덕동477'·'체육로90'처럼
# 번지가 붙어 적히는 일이 흔해서 geocoded 정규식보다 느슨한 식을 쓴다 — 숫자 뒤에 한글·숫자가 이어지면
# ('장위3동'·'다문1리'·'2층') 번지가 아니다.
AREA_SHARED_POINT_MIN_NAMES = 2
AREA_API_BNO_PATTERN = r"[0-9]+(?:-[0-9]+)?(?:번지)?(?:일원|외)?(?![0-9가-힣])"
AREA_API_BNO_RE = re.compile(AREA_API_BNO_PATTERN)
AREA_EVIDENCE_MIN_POINTS = 2
# 전국에서 이름이 겹치는 시군구명 — unlocated.display_label 에 시도명을 붙인다(tests R8 가
# 실 DB 에서 도출한 집합과 대조한다).
AREA_AMBIGUOUS_LABELS = frozenset({"강서구", "고성군", "남구", "동구", "북구", "서구", "중구"})

_AREA_BOUNDS_MSG = "입력값 오류(bounds): min_lat<max_lat, min_lon<max_lon 이어야 합니다."
_AREA_OUTSIDE_MSG = "대한민국 밖의 범위예요. 국내 지역에서만 찾을 수 있어요."


def _num(v: float):
    """정수값 float 은 int 로(JSON 에 20 이 아니라 20.0 이 찍히지 않게)."""
    return int(v) if float(v).is_integer() else v


def area_diag_km(min_lat: float, min_lon: float, max_lat: float, max_lon: float) -> float:
    """범위의 대각선(km). 보통은 haversine(남서 모서리 → 북동 모서리).

    경도 폭이 AREA_MAX_LON_SPAN_DEG(180°)를 넘으면 haversine 은 반대편 짧은 길로 재어 폭을 잃는다
    (−180~180 이면 위도 차 11.1km 만 남아 "20km 이내"로 통과했다). 이 경우는 범위를 읽는 방향 그대로
    (서→동 긴 길) 위도 평균에서의 경도 호와 위도 호로 평면 근사한다 — 20km 를 넘는 것은 자명하지만
    거절 메시지의 "대각선 약 …km"가 거짓 숫자가 되지 않게 한다. 웹 lib/areaSearch.ts diagKm 과 같은 식."""
    if max_lon - min_lon > AREA_MAX_LON_SPAN_DEG:
        r = 6371.0088  # store.haversine_km 과 같은 반지름(계약 JSON earth_radius_km)
        phi_m = math.radians((min_lat + max_lat) / 2)
        dx = math.radians(max_lon - min_lon) * math.cos(phi_m)
        dy = math.radians(max_lat - min_lat)
        return r * math.hypot(dx, dy)
    return haversine_km(min_lat, min_lon, max_lat, max_lon)


def area_bounds_problem(
    min_lat: float, min_lon: float, max_lat: float, max_lon: float,
) -> Optional[tuple[str, str]]:
    """검증 3~5단계(계약 §3.2). 문제가 없으면 None, 있으면 (code, message).

    3. 유한수 · min<max(엄격) → INVALID_REQUEST
    4. KOREA_BOUNDS 와 전혀 겹치지 않음 → AREA_OUT_OF_RANGE (일부만 겹치면 통과, 자르지 않음)
    5. 대각선 > AREA_MAX_DIAG_KM(정확히 20 은 허용) 또는 경도 폭 > 180° → AREA_TOO_WIDE
       (경도 폭 180° 초과는 haversine 이 짧은 길로 재는 구멍 — area_diag_km)"""
    vals = (min_lat, min_lon, max_lat, max_lon)
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
        return "INVALID_REQUEST", _AREA_BOUNDS_MSG
    if not (min_lat < max_lat and min_lon < max_lon):
        return "INVALID_REQUEST", _AREA_BOUNDS_MSG
    kb = KOREA_BOUNDS
    if (
        max_lat < kb["min_lat"] or min_lat > kb["max_lat"]
        or max_lon < kb["min_lon"] or min_lon > kb["max_lon"]
    ):
        return "AREA_OUT_OF_RANGE", _AREA_OUTSIDE_MSG
    d = area_diag_km(min_lat, min_lon, max_lat, max_lon)
    if d > AREA_MAX_DIAG_KM or max_lon - min_lon > AREA_MAX_LON_SPAN_DEG:
        return (
            "AREA_TOO_WIDE",
            f"지도 범위가 너무 넓어요(대각선 약 {d:.1f}km, 최대 {_num(AREA_MAX_DIAG_KM)}km). "
            "지도를 조금 더 확대해 주세요.",
        )
    return None


def area_search(
    store: Store, *, min_lat: float, min_lon: float, max_lat: float, max_lon: float,
    program: str = "svoucher", q: Optional[str] = None,
    limit: int = AREA_LIMIT_DEFAULT, age: Optional[int] = None,
) -> dict:
    """범위(양 끝 포함) 안 real 등급 시설 + 위치 미상 묶음. 범위 검증은 호출부(main)가
    area_bounds_problem 으로 마친 뒤 부른다.

    - 정렬: 지도 가운데에서 가까운 순(위도 보정 평면 거리 제곱), 같으면 id 순.
    - total = 잘라내기 전 일치 수, truncated = total > len(facilities).
    - 행 모양 = GET /api/facilities/search 와 같다(_voucher_row/_alt_row + addr).
      dist_km 는 항상 null(거리 원점이 없다). 장애 필터 없음(키워드 검색 계열)."""
    source = SEARCH_PROGRAMS.get(program)
    if source is None:
        raise AssessError("INVALID_PROGRAM", f"알 수 없는 제도입니다: {program}")
    qs = " ".join(q.split()) if q is not None else ""
    tokens = list(dict.fromkeys(qs.split()))
    lim = max(1, min(int(limit), AREA_LIMIT_MAX))
    bounds = (min_lat, min_lon, max_lat, max_lon)

    idx = store.area_index()
    total, top_rowids = idx.real_hits(source, bounds, tokens, lim)

    picked: list[dict] = []
    if top_rowids:
        marks = ",".join("?" for _ in top_rowids)
        cur = store.conn.execute(
            f"SELECT rowid AS _area_rowid, * FROM facilities WHERE rowid IN ({marks})",
            top_rowids,
        )
        by_rowid = {r["_area_rowid"]: r for r in cur.fetchall()}
        for rid in top_rowids:  # 뽑은 순서(가운데 거리순)로 맞춘다
            r = by_rowid.get(rid)
            if r is None:
                continue
            f = store._facility_row(r)
            # 직렬화 직전 재확인: 실좌표 원천 + real 등급만 점으로 내보낸다(P-1).
            if f["coord_source"] not in _REAL_COORD_SOURCES or idx.is_nonreal(f["id"]):
                continue
            f["dist_km"] = None  # 거리 원점 없음 — 거리 미표기
            picked.append(f)

    if source == "public":
        facilities = [_alt_row(store, f, age) for f in picked]
    else:
        # 자격 미상 — subsidy/copay = null (fee_month 만 사실로 싣는다).
        facilities = [_voucher_row(store, f, source, age, None) for f in picked]
    for row, f in zip(facilities, picked):
        row["addr"] = f.get("addr")

    areas = idx.unlocated(source, bounds, tokens)
    clat = (min_lat + max_lat) / 2
    clon = (min_lon + max_lon) / 2
    return {
        "bounds": {"min_lat": min_lat, "min_lon": min_lon, "max_lat": max_lat, "max_lon": max_lon},
        "center": {"lat": round(clat, 7), "lon": round(clon, 7)},
        "diag_km": round(area_diag_km(min_lat, min_lon, max_lat, max_lon), 1),
        "max_diag_km": _num(AREA_MAX_DIAG_KM),
        "program": program,
        "q": qs or None,
        "tokens": tokens,
        "match_fields": ["name", "addr"],
        "coord_sources": ["api", "geocoded"],
        "coord_rules": {
            "placeholder_min_areas": AREA_PLACEHOLDER_MIN_AREAS,
            "suspect_max_km": _num(AREA_SUSPECT_MAX_KM),
            "robust_min_rows": AREA_ROBUST_MIN_ROWS,
            "geocoded_requires_building_no": True,
            "shared_point_min_names": AREA_SHARED_POINT_MIN_NAMES,
        },
        "order": "center_distance",
        "eligibility_applied": False,
        "total": total,
        "truncated": total > len(facilities),
        "facilities": facilities,
        "unlocated": {
            "total": sum(a["count"] for a in areas),
            "count_basis": "whole_area",
            "areas": areas,
        },
    }
