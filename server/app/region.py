"""지역 코드 정규화 — 구(舊) 행정코드를 현행 코드로 옮기는 **단일 표**.

`scripts/build_db.py`(적재)와 서버(`store`/`engine`/`chat`)가 같은 표를 import 한다.
표가 두 곳에 있으면 "DB는 12300인데 챗은 29170으로 찾는" 종류의 어긋남이 생긴다.

## 왜 필요한가 (실측 2026-08-22, data/raw 2026-07-21 적재본)
공단 voucher/dvoucher API 는 **전환기라 구·신 코드를 섞어서** 준다.

  * 2026-07-01 전남광주통합특별시 출범: 광주광역시(29) + 전라남도(46) → **12**.
    voucher 일부 행은 아직 29xxx·46xxx 로 온다.
  * 강원특별자치도(42→51, 2023-06) · 전북특별자치도(45→52, 2024-01) 도 같은 혼재.

정규화 전에는 사용자가 "광주 북구"(29170)를 고르면 그 코드에 dvoucher 가 0건이라
**"장애인이용권 가맹 0곳" 이라는 거짓 공급공백**이 떴다. 실제 dvoucher 가맹은
12xxx 쪽에 있었다. P-1(정직성) 위반이라 코드 축을 먼저 하나로 모은다.

## 이 모듈이 하는 일 / 하지 않는 일
- 한다: 시도 단위 통합·재코딩(1:1) 크로스워크를 **데이터에서 도출**하고 검증한다.
- 한다: 개칭 시군구(예: 인천 남구 → 미추홀구) 별칭을 데이터로 확인된 것만 둔다.
- **하지 않는다**: 분할(1:N)된 시군구를 추측으로 한쪽에 붙이지 않는다.
  (2026-07-01 인천 개편에서 서구(28260) → 서해구(28275)·검단구(28290) 처럼
   구코드 하나가 신코드 여럿에 걸치는 경우는 크로스워크 대상이 아니다 —
   기존 코드를 그대로 두고 docs 에 남긴다. 추측 매핑 금지.)
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

# ---------------------------------------------------------------------------
# ① 시도 코드 — 구 → 현행
# ---------------------------------------------------------------------------
# 시도 통합: 시군구 코드가 통째로 다시 매겨졌다 → 뒷 3자리 보존 안 됨(이름으로 도출).
SIDO_MERGE = {
    "29": "12",  # 광주광역시   → 전남광주통합특별시 (2026-07-01)
    "46": "12",  # 전라남도     → 전남광주통합특별시 (2026-07-01)
}
# 시도 재코딩: 관할 구역은 그대로, 앞 2자리만 바뀌었다 → 뒷 3자리 보존.
SIDO_RECODE = {
    "42": "51",  # 강원도   → 강원특별자치도 (2023-06-11)
    "45": "52",  # 전라북도 → 전북특별자치도 (2024-01-18)
}
LEGACY_SIDO: dict[str, str] = {**SIDO_MERGE, **SIDO_RECODE}

# ---------------------------------------------------------------------------
# ② 시도 명칭 — [0] 이 정식 표시명, 뒤는 입력 매칭용 별칭(구 시도명 포함)
# ---------------------------------------------------------------------------
SIDO_NAMES: dict[str, tuple[str, ...]] = {
    "11": ("서울특별시", "서울시", "서울"),
    # 통합 시도: 구 시도명("광주"·"전남")도 여기로 들어와야 한다.
    "12": (
        "전남광주통합특별시", "광주광역시", "전라남도",
        "광주전남", "전남광주", "광주시", "광주", "전남",
    ),
    "26": ("부산광역시", "부산시", "부산"),
    "27": ("대구광역시", "대구시", "대구"),
    "28": ("인천광역시", "인천시", "인천"),
    "30": ("대전광역시", "대전시", "대전"),
    "31": ("울산광역시", "울산시", "울산"),
    "36": ("세종특별자치시", "세종시", "세종"),
    "41": ("경기도", "경기"),
    "43": ("충청북도", "충북"),
    "44": ("충청남도", "충남"),
    "47": ("경상북도", "경북"),
    "48": ("경상남도", "경남"),
    "50": ("제주특별자치도", "제주도", "제주"),
    "51": ("강원특별자치도", "강원도", "강원"),
    "52": ("전북특별자치도", "전라북도", "전북"),
}

# 이름 → 현행 시도코드. 긴 이름 우선(부분일치가 짧은 별칭에 먼저 걸리지 않게).
SIDO_NAME_TO_CD: dict[str, str] = {
    nm: cd for cd, names in SIDO_NAMES.items() for nm in names
}
_SIDO_NAME_SORTED: list[tuple[str, str]] = sorted(
    SIDO_NAME_TO_CD.items(), key=lambda kv: -len(kv[0])
)

# ---------------------------------------------------------------------------
# ③ 개칭 시군구 — (현행 시도코드, 구 시군구명) → 현행 시군구명
# ---------------------------------------------------------------------------
# 근거: data/raw/public_facility.json 의 시군구명 필드가 개칭 전 명칭으로 남아 있어
# 마스터(voucher/dvoucher local_nm)와 대조되지 않는 행이 생긴다. 아래는 그 분포를
# 전수 조사해 **실제로 실패 사유였던 것만** 올린 표다(추측 별칭 금지).
#   · 인천 남구 → 미추홀구 (2018-07-01 개칭) : public 723건이 이 사유로 미매칭이었다.
RENAMED_SIGUNGU: dict[tuple[str, str], str] = {
    ("28", "남구"): "미추홀구",
}

_WS = re.compile(r"\s+")


def norm(s) -> str:
    """공백 제거 정규화 — 이름 대조의 유일한 형태."""
    return _WS.sub("", str(s or "")).strip()


# ---------------------------------------------------------------------------
# 시도
# ---------------------------------------------------------------------------
def canonical_sido(cd: Optional[str]) -> Optional[str]:
    """시도코드(또는 시군구코드 앞 2자리)를 현행 시도코드로."""
    if not cd:
        return None
    s = str(cd)[:2]
    return LEGACY_SIDO.get(s, s)


def sido_cd_from_name(nm) -> Optional[str]:
    """시도명(정식·약칭·구 명칭) → 현행 시도코드. 못 찾으면 None(지어내지 않음)."""
    n = norm(nm)
    if not n:
        return None
    hit = SIDO_NAME_TO_CD.get(n)
    if hit:
        return hit
    for k, v in _SIDO_NAME_SORTED:  # 긴 이름 우선
        if n.startswith(k) or k.startswith(n):
            return v
    return None


def sido_label(cd: Optional[str]) -> Optional[str]:
    names = SIDO_NAMES.get(canonical_sido(cd) or "")
    return names[0] if names else None


# ---------------------------------------------------------------------------
# 시군구 크로스워크 (구 코드 → 현행 코드) — 데이터에서 도출, 추측 금지
# ---------------------------------------------------------------------------
class CrosswalkError(RuntimeError):
    """구 코드를 현행 코드로 옮길 근거가 데이터에 없다 — 추측하지 않고 멈춘다."""


def build_crosswalk(code2nm: dict[str, str]) -> tuple[dict[str, str], list[dict]]:
    """시군구 마스터(cd→nm)에서 (alias, unresolved) 를 도출한다.

    · 통합(29·46 → 12): **이름으로** 대조한다. 통합 시도 안에서 이름이 유일해야
      하며(광주 자치구 5 + 전남 시·군 22 는 겹치지 않는다 — 아래에서 실제 검증),
      0건이거나 2건 이상이면 그 코드는 unresolved 로 남긴다.
    · 재코딩(42→51, 45→52): 뒷 3자리를 보존한 신코드가 마스터에 있고 **이름까지
      같을 때만** 매핑한다. 이름이 다르면 unresolved.

    반환: (alias{old_cd: new_cd}, unresolved[{cd, nm, reason}])
    """
    alias: dict[str, str] = {}
    unresolved: list[dict] = []

    # 통합 대상 시도별 이름 인덱스 + 이름 충돌 검사
    merge_targets = sorted(set(SIDO_MERGE.values()))
    name_index: dict[str, dict[str, list[str]]] = {}
    for tgt in merge_targets:
        idx: dict[str, list[str]] = {}
        for cd, nm in code2nm.items():
            if cd[:2] == tgt:
                idx.setdefault(norm(nm), []).append(cd)
        name_index[tgt] = idx

    for cd in sorted(code2nm):
        sido, nm = cd[:2], code2nm[cd]
        if sido in SIDO_MERGE:
            tgt = SIDO_MERGE[sido]
            hits = sorted(name_index.get(tgt, {}).get(norm(nm), []))
            if len(hits) == 1:
                alias[cd] = hits[0]
            else:
                unresolved.append({
                    "cd": cd, "nm": nm,
                    "reason": f"{tgt} 안에서 이름 '{nm}' 대조 {len(hits)}건",
                })
        elif sido in SIDO_RECODE:
            tgt_cd = SIDO_RECODE[sido] + cd[2:]
            tgt_nm = code2nm.get(tgt_cd)
            if tgt_nm is not None and norm(tgt_nm) == norm(nm):
                alias[cd] = tgt_cd
            else:
                unresolved.append({
                    "cd": cd, "nm": nm,
                    "reason": f"{tgt_cd} 없음/이름 불일치(={tgt_nm})",
                })
    return alias, unresolved


def canonicalize_master(code2nm: dict[str, str]) -> tuple[dict[str, str], dict[str, str], list[dict]]:
    """마스터를 현행 코드만 남긴 것으로 접는다.

    반환: (canonical{cd→nm}, alias{old→new}, unresolved)
    해소되지 않은 구 코드는 **버리지 않고** canonical 에 남긴다 — 그 코드로 적재된
    시설을 통째로 잃는 편이 거짓 0 보다 낫다는 판단은 성립하지 않는다(둘 다 나쁘다).
    대신 리포트로 드러낸다.
    """
    alias, unresolved = build_crosswalk(code2nm)
    canonical = {cd: nm for cd, nm in code2nm.items() if cd not in alias}
    return canonical, alias, unresolved


# ---------------------------------------------------------------------------
# 시군구 이름 → 코드 (공공시설 매핑용). build_db 와 migrate 스크립트가 공유한다.
# ---------------------------------------------------------------------------
def build_name_index(canonical: dict[str, str]) -> dict[str, dict[str, str]]:
    """{시도코드: {정규화 시군구명: 시군구코드}}"""
    idx: dict[str, dict[str, str]] = {}
    for cd, nm in sorted(canonical.items()):
        idx.setdefault(cd[:2], {}).setdefault(norm(nm), cd)
    return idx


def sole_sigungu(index: dict[str, dict[str, str]]) -> dict[str, str]:
    """시군구가 딱 1곳인 시도(예: 세종) → 그 코드. 이름 없이도 확정 가능."""
    return {s: next(iter(v.values())) for s, v in index.items() if len(v) == 1}


def match_name(idx: dict[str, str], raw) -> tuple[Optional[str], Optional[str]]:
    """한 시도의 이름 인덱스에서 시군구명을 찾는다 → (cd, how) 또는 (None, None).

    build_db 가 쓰던 4단 규칙 그대로: 정확 → "고양시 덕양구"의 앞 토막 →
    "고양시" ⊂ "고양시덕양구" 접두 → 마지막 토큰(구/군).
    """
    q = norm(raw)
    if not q or not idx:
        return None, None
    if q in idx:
        return idx[q], "exact"
    parts = str(raw or "").split()
    if len(parts) >= 2:
        first = norm(parts[0])
        if first in idx:
            return idx[first], "citytoken"
    for nm, cd in idx.items():
        if len(nm) >= 2 and q.startswith(nm):
            return cd, "prefix"
    if len(parts) >= 2:
        last = norm(parts[-1])
        if last in idx:
            return idx[last], "lasttoken"
    return None, None


def addr_tokens(addr) -> list[str]:
    """주소 앞 2토큰 — 시군구명 후보. ("인천광역시 서구 가좌로11번길 7" → 인천광역시, 서구)

    3번째 토큰부터는 도로명("가좌로11번길")이라 시군구명과 우연히 겹칠 위험만 있고
    얻을 게 없다. 여기서 쓰는 대조는 **정확 일치뿐**(접두 추정 금지).
    """
    return str(addr or "").split()[:2]


def resolve_sigungu(
    sido_candidates: Iterable[str],
    names: Iterable[str],
    addr: Optional[str],
    index: dict[str, dict[str, str]],
    sole: dict[str, str],
) -> tuple[Optional[str], Optional[str], str]:
    """공공시설 1행 → (시군구코드, 시도코드, how). 못 찾으면 (None, 첫 후보, "nomatch").

    순서(뒤로 갈수록 약한 근거이고, 앞 단계가 실패했을 때만 쓴다):
      ① name    — 시군구명 필드를 마스터 이름 인덱스에 대조 (기존 동작)
      ② rename  — 개칭 별칭(RENAMED_SIGUNGU) 적용 후 재대조
      ③ addr    — 주소 앞 2토큰 정확 일치(개칭 별칭 포함)
      ④ sole    — 그 시도에 시군구가 1곳뿐이면 확정(세종)
    """
    cands = [c for c in sido_candidates if c]
    name_list = [n for n in names if norm(n)]

    for s in cands:
        idx = index.get(s, {})
        for nm in name_list:
            cd, how = match_name(idx, nm)
            if cd:
                return cd, s, "name"

    for s in cands:
        idx = index.get(s, {})
        for nm in name_list:
            alt = RENAMED_SIGUNGU.get((s, norm(nm)))
            if alt and norm(alt) in idx:
                return idx[norm(alt)], s, "rename"

    toks = addr_tokens(addr)
    for s in cands:
        idx = index.get(s, {})
        for tk in toks:
            t = norm(tk)
            t = norm(RENAMED_SIGUNGU.get((s, t), t))
            if t in idx:
                return idx[t], s, "addr"

    for s in cands:
        if s in sole:
            return sole[s], s, "sole"

    return None, (cands[0] if cands else None), "nomatch"
