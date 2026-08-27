"""Assessment engine: pure eligibility rules + curated alt-path graph + supply gap.
No LLM, no fabrication — everything derives from data/rules.json + fixtures.
Contract: docs/API.md POST /api/assess.
"""
from __future__ import annotations

import math
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


def _representative_fee(store: Store, facility_id: str, age: int) -> Optional[int]:
    """Cheapest course fee for the applicant's age band (fallback: cheapest overall)."""
    courses = store.courses_for(facility_id)
    if not courses:
        return None
    age_matched = [c for c in courses if _target_matches_age(c.get("target", ""), age)]
    pool = age_matched or courses
    fees = [c["fee_month"] for c in pool if c.get("fee_month") is not None]
    return min(fees) if fees else None


def _course_note(store: Store, facility_id: str, age: int) -> Optional[str]:
    courses = store.courses_for(facility_id)
    if not courses:
        return None
    age_matched = [c for c in courses if _target_matches_age(c.get("target", ""), age)]
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
        fee = _representative_fee(store, f["id"], age)
        copay = None if fee is None else max(0, fee - row_subsidy)
        out.append({
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
        })
        if len(out) >= NEARBY_LIMIT:
            break
    return out


def _alternatives(
    store: Store, lat: float, lon: float, age: int, disability_filter: bool
) -> list[dict]:
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
        out.append({
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
        })
        if len(out) >= NEARBY_LIMIT:
            break
    return out


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


def _matching_alt_edges(store: Store, pid: str, active: set) -> list[dict]:
    """매칭 대체경로 엣지를 `to` 기준으로 유일화한 목록 (결정 CQ2A).

    같은 대상 제도로 가는 엣지가 사유별로 여러 개다(예: svoucher→public_program 이
    income_fail·age_fail 두 벌) — 그대로 내보내면 UI 에 같은 줄이 중복된다.

    - note·when·filter 는 rules 순서상 **첫** 매칭 엣지 것을 쓴다.
    - curated 는 중복 중 **가장 강한** 값(공식 확인 > 검증 대기).
    - 출력 순서는 공식 확인 먼저(그 안에서는 rules 순서), 그 다음 나머지.
    """
    order: list[str] = []
    picked: dict[str, dict] = {}
    for e in store.edges_from(pid):
        when = e.get("when", "any")
        if when != "any" and _WHEN_TO_FAIL.get(when) not in active:
            continue
        to = e["to"]
        curated = e.get("curated", "검증 대기")
        if to not in picked:
            order.append(to)
            picked[to] = {**e, "curated": curated}
        elif _curated_rank(curated) < _curated_rank(picked[to]["curated"]):
            picked[to]["curated"] = curated
    # sorted 는 안정 정렬 — 같은 등급 안에서는 rules 순서가 그대로 남는다.
    return sorted((picked[to] for to in order), key=lambda e: _curated_rank(e["curated"]))


def _build_path(
    store: Store, *, card: dict, failed: list[str],
    voucher_facilities: list[dict], alternatives: list[dict],
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
    edges = _matching_alt_edges(store, pid, set(failed))
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
    if alternatives:
        top = alternatives[0]
        path.append({
            "from": to, "to": f"facility:{top['id']}", "edge": "적합·접근",
            "result": "ok", "label": _facility_hop_label(top),
        })
    return path, disability_filter


def _collect_alt_edges(
    store: Store, *, card: dict, failed: list[str], selection_rank: Optional[int],
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
    for e in _matching_alt_edges(store, pid, active):
        prog = store.program(e["to"])
        program_info = None
        if prog:
            program_info = {
                "id": prog["id"],
                "name": prog["name"],
                "benefit": prog.get("benefit"),
                "apply_url": (prog.get("apply") or {}).get("url"),
            }
        out.append({
            "to": e["to"],
            "note": e.get("note", e["to"]),
            "curated": e["curated"],
            "program": program_info,
        })
    return out


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
                "좌표 또는 유효한 서울 시군구코드가 필요합니다(위치를 확인할 수 없습니다).",
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

    subsidy = program.get("subsidy_month", 0)
    voucher_facilities = _voucher_facilities(
        store, source, lat, lon, subsidy, age, eligible=card["eligible"]
    )

    # need the alt edge's disability filter before building alternatives -> peek path once
    # build path with a provisional (unfiltered) alt list, extract filter, then rebuild alts.
    provisional_alts = _alternatives(store, lat, lon, age, disability_filter=disability_has)
    path, edge_filter = _build_path(
        store, card=card, failed=failed,
        voucher_facilities=voucher_facilities, alternatives=provisional_alts,
    )
    disability_filter = disability_has or edge_filter
    alternatives = _alternatives(store, lat, lon, age, disability_filter=disability_filter)
    # rebuild the final facility hop against filtered alternatives
    if not card["eligible"]:
        path, _ = _build_path(
            store, card=card, failed=failed,
            voucher_facilities=voucher_facilities, alternatives=alternatives,
        )

    supply_gap = _supply_gap(
        store, source=source, lat=lat, lon=lon,
        disability_has=disability_has, disability_filter=disability_filter,
        age=age, sigungu_cd=sigungu_cd, income_class=income_class,
    )

    # 복수 대체경로(매칭 엣지 전부) — UI는 상위 N개 렌더(FR-02 AC3).
    selection_rank = (card.get("selection") or {}).get("expected_rank")
    alt_edges = _collect_alt_edges(
        store, card=card, failed=failed, selection_rank=selection_rank
    )

    return {
        "eligibility": [card],
        "path": path,
        "alt_edges": alt_edges,
        "nearby": {
            # 결정 1A: 자격 ✗ 면 가맹시설이 1순위가 될 수 없다(⚠#10) — 웹은 이 순서대로
            # 덱·리스트를 배치한다. 자격 판정은 서버 소유(P-2).
            "primary": "voucher" if card["eligible"] else "alternatives",
            "voucher_facilities": voucher_facilities,
            "alternatives": alternatives,
        },
        "supply_gap": supply_gap,
    }
