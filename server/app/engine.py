"""Assessment engine: pure eligibility rules + curated alt-path graph + supply gap.
No LLM, no fabrication — everything derives from data/rules.json + fixtures.
Contract: docs/API.md POST /api/assess.
"""
from __future__ import annotations

from typing import Any, Optional

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
# 좌표 정직성 (FR-04/FR-05): 실좌표(api)만 거리(km) 노출, 시군구 중심 폴백(centroid)은
# 거리 미표기. 내부 정렬·최근접 판단엔 폴백 거리도 쓰되(방향성), 사용자 노출 수치엔 금지.
# ---------------------------------------------------------------------------
def _is_api(fac: dict) -> bool:
    return fac.get("coord_source") == "api"


def _expose_dist(fac: dict) -> Optional[float]:
    """사용자 노출용 거리. 실좌표면 km, 근사좌표(구 중심)면 None(미표기)."""
    return fac["dist_km"] if _is_api(fac) else None


def _facility_hop_label(fac: dict) -> str:
    """경로 다이어그램 시설 홉 라벨. 근사좌표엔 'Nonekm'를 찍지 않는다."""
    d = fac.get("dist_km")
    if _is_api(fac) and d is not None:
        return f"{fac['name']} · {d}km"
    return fac["name"]


def _primary_program_id(disability_has: bool) -> str:
    """비장애=svoucher, 장애=dvoucher (SPEC §5 프레이밍)."""
    return "dvoucher" if disability_has else "svoucher"


def _primary_source(disability_has: bool) -> str:
    """이용권 가맹시설 소스: 비장애=voucher, 장애=dvoucher."""
    return "dvoucher" if disability_has else "voucher"


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
    return {
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


def _voucher_facilities(
    store: Store, source: str, lat: float, lon: float, subsidy: int, age: int
) -> list[dict]:
    facs = _with_distance(store.facilities(source), lat, lon)
    out = []
    for f in facs:
        if f["dist_km"] > NEARBY_RADIUS_KM:
            continue
        fee = _representative_fee(store, f["id"], age)
        copay = None if fee is None else max(0, fee - subsidy)
        out.append({
            "id": f["id"],
            "name": f["name"],
            "sports": f["sports"],
            "lat": f["lat"],
            "lon": f["lon"],
            "coord_source": f["coord_source"],
            # 이용권 시설은 시군구 중심 폴백(근사) → 거리 미표기(null).
            "dist_km": _expose_dist(f),
            "sigungu_nm": f["sigungu_nm"],
            "fee_month": fee,
            "subsidy": subsidy,
            "copay": copay,
            "disability_support": f["disability_support"],
        })
        if len(out) >= NEARBY_LIMIT:
            break
    return out


def _alternatives(
    store: Store, lat: float, lon: float, age: int, disability_filter: bool
) -> list[dict]:
    facs = _with_distance(store.facilities("public"), lat, lon)
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
    source_facs = store.facilities(source)
    voucher_all = _with_distance(source_facs, lat, lon)  # 정렬됨 — 최근접 선정용(내부 거리)

    # FR-04 AC2: 이용권 시설은 실좌표가 아니므로 "반경 N km" 금지.
    #            사용자 시군구(sigungu_cd) 일치 = "OO구 가맹 N곳"(구 단위 카운트).
    user_sigungu_nm = _sigungu_nm(store, sigungu_cd)
    if sigungu_cd:
        voucher_count = sum(1 for f in source_facs if f["sigungu_cd"] == sigungu_cd)
    else:
        voucher_count = 0  # 시군구 미상(좌표만 입력) → 구 단위 카운트 근거 없음

    # 공공 대안 풀은 실좌표(api 위주) → 반경 유지.
    alt_all = _with_distance(store.facilities("public"), lat, lon)
    if disability_filter:
        alt_all = [f for f in alt_all if f["disability_support"]]
    alt_in = [f for f in alt_all if f["dist_km"] <= SUPPLY_GAP_RADIUS_KM]

    # 최근접 이용권 시설: 내부 거리로 선정(방향성). 노출은 coord_source 규칙.
    nearest = None
    if voucher_all:
        n = voucher_all[0]
        nearest = {
            "name": n["name"],
            "coord_source": n["coord_source"],
            "dist_km": _expose_dist(n),      # 실좌표만 km, 근사면 None
            "sigungu_nm": n["sigungu_nm"],   # 근사 시설 노출용 '△△구'
        }

    label = _voucher_label(disability_has)
    where = user_sigungu_nm or "이 지역"
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

    edge = None
    for e in store.edges_from(pid):
        when = e.get("when", "any")
        if when == "any" or _WHEN_TO_FAIL.get(when) in failed:
            edge = e
            break

    if edge is None:
        return path, False

    disability_filter = bool((edge.get("filter") or {}).get("disability_support"))
    to = edge["to"]
    path.append({
        "from": pid, "to": to, "edge": "대체경로",
        "result": "ok", "label": edge.get("note", to),
        "curated": edge.get("curated", "검증 대기"),
    })
    if alternatives:
        top = alternatives[0]
        path.append({
            "from": to, "to": f"facility:{top['id']}", "edge": "적합·접근",
            "result": "ok", "label": _facility_hop_label(top),
        })
    return path, disability_filter


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
    sigungu_cd = payload.get("sigungu_cd")

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
    voucher_facilities = _voucher_facilities(store, source, lat, lon, subsidy, age)

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

    return {
        "eligibility": [card],
        "path": path,
        "nearby": {
            "voucher_facilities": voucher_facilities,
            "alternatives": alternatives,
        },
        "supply_gap": supply_gap,
    }
