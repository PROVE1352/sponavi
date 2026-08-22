"""AI 체력 처방 레이어 (M1b). 계약: docs/ARCHITECTURE.md §6 · docs/FITNESS_GRAPH.md §5.

원칙: **판정·근거는 결정론(공식 컷 + 지식그래프), 문장 렌더링만 LLM.**
  1. 입력(age·sex·measures) → fitness.assess_fitness 로 공식 판정 재사용(약점·비교문·그래프 추천).
  2. 슬롯 구성: 약점(비교문) + 그래프 추천 운동(출처) + FITT 수치사전(정부 지침 하드코드).
  3. LLMProvider 로 렌더 — 슬롯의 수치·운동명만, 창작·시설·가격·진단 금지, JSON 만.
  4. pydantic 스키마 검증(실패 시 1회 재시도 → RulesFallback). 화이트리스트 밖 운동명 드롭.
     처방 항목의 **provenance(출처·티어·검증상태·목적경유)는 서버가 슬롯에서 다시 찾아 덮어쓴다**
     — 프로바이더가 돌려준 provenance 는 신뢰하지 않는다(날조 차단, P-2). FR-08 AC8 의 서버 측 전제.
  5. sqlite 캐시(fitness_ai_cache) — 같은 연령군·성별·측정값·버전 = 같은 답, 재호출 없음.

프로바이더: env SPONAVI_LLM = claude | gemini | off(기본). off/미설정 → RulesFallback 고정
(미설정 서버에서 LLM 없이도 무중단). ClaudeCLIProvider 는 subprocess claude CLI(sonnet).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
from datetime import datetime, timezone
from typing import Optional, Protocol

from pydantic import BaseModel, ValidationError, field_validator

from . import fitness
from .store import Store

CLAUDE_TIMEOUT_S = 90  # ARCHITECTURE §6.1 (실측 42s/건)

# 응답 스키마 버전 — 캐시 키에 섞어 스키마가 바뀌면 옛 캐시가 자동 무효화된다.
#   rx1 = 처방[{운동,목표체력요인,강도,주당빈도}]
#   rx2 = + provenance(출처·티어·검증상태·via_goal)   ← 현행
RESPONSE_SCHEMA_VERSION = "rx2"

# ---------------------------------------------------------------------------
# FITT 수치사전 (정부·국제 지침 하드코드). LLM 은 이 수치만 인용 가능.
#   출처: 보건복지부 한국인 신체활동 지침 2023 · 질병관리청 · WHO 신체활동 가이드라인 2020 · ACSM.
#   성인   유산소 주 150~300분(중강도) / 근력 주 2일 이상
#   청소년 매일 60분 이상(중·고강도) + 뼈부하 주 3일 이상
#   어르신 평형(낙상예방) 주 3일 이상 / 유연성 30~60초 유지 / 근력 8~12회·세트 간 1~2분
# ---------------------------------------------------------------------------
FITT: dict[str, dict[str, str]] = {
    "성인": {
        "유산소": "중강도 주 150~300분 또는 고강도 주 75~150분",
        "근력": "주요 근육군 주 2일 이상",
        "세트": "8~12회 반복 · 2~3세트",
        "유연성": "주요 관절 스트레칭 30~60초 유지",
    },
    "청소년": {
        "유산소": "매일 60분 이상 중·고강도 신체활동",
        "뼈부하": "뼈에 부하를 주는 활동 주 3일 이상",
        "근력": "근육 강화 활동 주 3일 이상",
        "유연성": "스트레칭 30초 유지",
    },
    "어르신": {
        "유산소": "중강도 주 150~300분(가능한 범위에서)",
        "평형": "낙상예방 평형 운동 주 3일 이상",
        "유연성": "주요 관절 스트레칭 30~60초 유지",
        "근력": "8~12회 반복 · 세트 간 1~2분 휴식",
    },
}

_DISCLAIMER = "운동 참고 정보이며 의료 조언이 아닙니다. 통증·질환이 있으면 전문가와 상담하세요."


def _fitt_group(group: str) -> str:
    """fitness.age_group_of 결과 → FITT 밴드. gap/유소년/청소년 = 청소년 지침(WHO 5~17)."""
    if group in ("gap", "유소년", "청소년", "유아"):
        return "청소년"
    if group == "어르신":
        return "어르신"
    return "성인"


def _fitt_for_factor(factor: str, fitt: dict[str, str]) -> tuple[str, str]:
    """체력요인 → (강도, 주당빈도) — FITT 슬롯 수치만 사용."""
    if factor == "심폐지구력":
        return fitt.get("유산소", "중강도 유산소"), "주 3~5회"
    if factor in ("근력", "근지구력"):
        base = fitt.get("근력", "근력 운동")
        setinfo = fitt.get("세트", "")
        intensity = f"{base}{' · ' + setinfo if setinfo else ''}"
        return intensity, "주 2~3회"
    if factor == "유연성":
        return fitt.get("유연성", "정적 스트레칭 30~60초 유지"), "주 3회 이상"
    if factor == "평형성":
        return fitt.get("평형", "평형·균형 운동"), "주 3일 이상"
    if factor in ("민첩성", "순발력", "협응력"):
        return "낮은 강도부터 점진적으로", "주 2~3회"
    if factor == "신체조성":
        # 체중·체지방은 유산소+근력 병행이 지침 — 두 FITT 수치를 함께 인용한다.
        aerobic = fitt.get("유산소", "중강도 유산소")
        strength = fitt.get("근력", "근력 운동")
        return f"{aerobic} + {strength}", "유산소 주 3~5회 · 근력 주 2일 이상"
    return "중강도", "주 3회"


# ---------------------------------------------------------------------------
# 출력 스키마 (pydantic 검증)
# ---------------------------------------------------------------------------
class WeakItem(BaseModel):
    model_config = {"extra": "ignore"}
    항목: str
    등급: str = ""
    근거: str = ""


class RxItem(BaseModel):
    """처방 1항목. provenance 는 **서버가 채우는 필드**(_attach_provenance) —
    프로바이더가 무엇을 넣든 검증 단계에서 통과시킨 뒤 서버 값으로 덮어쓴다."""

    model_config = {"extra": "ignore"}
    운동: str
    목표체력요인: str = ""
    강도: str = ""
    주당빈도: str = ""
    provenance: Optional[dict] = None

    @field_validator("provenance", mode="before")
    @classmethod
    def _drop_non_dict(cls, v):
        # LLM 이 문자열·리스트를 넣어도 스키마 검증을 깨지 않는다(어차피 서버가 덮어씀).
        return v if isinstance(v, dict) else None


class Prescription(BaseModel):
    model_config = {"extra": "ignore"}
    약점: list[WeakItem] = []
    우선순위: list[str] = []
    처방: list[RxItem] = []
    주의: str = ""


def _validate(raw: dict) -> Optional[dict]:
    """스키마 검증 → 통과 시 정규화된 dict, 실패 시 None."""
    try:
        return Prescription.model_validate(raw).model_dump()
    except (ValidationError, TypeError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# 슬롯 구성 (결정론)
# ---------------------------------------------------------------------------
def _build_slots(store: Store, payload: dict, assessment: dict) -> dict:
    age = int(payload.get("age", 0))
    sex = payload.get("sex", "M")
    group = fitness.age_group_of(age)
    fitt = FITT.get(_fitt_group(group), FITT["성인"])

    weaknesses: list[dict] = []
    for w in assessment.get("weaknesses", []):
        weaknesses.append({
            "항목": w.get("name") or w.get("item"),
            "요인": w.get("item"),
            "등급": w.get("band", ""),
            "근거": w.get("comparison") or w.get("band", ""),
        })

    recs: list[dict] = []
    allowed: set[str] = set()
    for r in assessment.get("recommendations", []):
        exs: list[dict] = []
        for e in r.get("exercises", []):
            if isinstance(e, dict):
                name = e.get("name", "")
                prov = e.get("provenance") or None
                src = (prov or {}).get("source", "graph")
            else:                       # fitness_map 폴백(문자열 리스트) — 그래프 근거 없음
                name = str(e)
                prov = None
                src = "fitness_map"
            if not name:
                continue
            # provenance 원본(티어·가중치·curated_status·via_goal)을 그대로 보관 —
            # 응답 경계에서 소실되던 지점(FR-08 AC8).
            exs.append({"운동": name, "출처": src, "provenance": prov})
            allowed.add(name)
        recs.append({"요인": r.get("weakness"), "운동": exs})

    return {
        "연령군": assessment.get("age_group") or group,
        "성별": "남" if sex == "M" else "여",
        "약점": weaknesses,
        "추천": recs,
        "FITT": fitt,
        "allowed_exercises": sorted(allowed),
        "facility_filter_sports": assessment.get("facility_filter_sports", []),
    }


def _provenance_index(slots: dict) -> dict[str, Optional[dict]]:
    """운동명 → provenance. 같은 이름이 여러 요인에 나오면 먼저 나온(상위 요인) 근거를 쓴다."""
    idx: dict[str, Optional[dict]] = {}
    for r in slots.get("추천", []):
        for ex in r.get("운동", []):
            name = ex.get("운동")
            if name and name not in idx:
                idx[name] = ex.get("provenance")
    return idx


def _attach_provenance(rx: dict, slots: dict) -> dict:
    """처방 항목의 provenance 를 슬롯 값으로 **덮어쓴다**(프로바이더 값 불신 — P-2).

    슬롯에 없는 운동명(화이트리스트 미적용 폴백 경로)은 None — 근거 없는 배지를 만들지 않는다.
    """
    idx = _provenance_index(slots)
    out = dict(rx)
    out["처방"] = [{**item, "provenance": idx.get(item.get("운동"))}
                   for item in rx.get("처방", [])]
    return out


def _whitelist_filter(rx: dict, slots: dict) -> dict:
    """처방 운동명이 슬롯(그래프 추천) 밖이면 드롭. 화이트리스트가 비면(추천 없음) 미적용."""
    allowed = set(slots.get("allowed_exercises") or [])
    if not allowed:
        return rx
    kept = [item for item in rx.get("처방", []) if item.get("운동") in allowed]
    out = dict(rx)
    out["처방"] = kept
    return out


# ---------------------------------------------------------------------------
# 프로바이더 (ARCHITECTURE §6.1)
# ---------------------------------------------------------------------------
class LLMProvider(Protocol):
    name: str

    def prescribe(self, slots: dict) -> dict: ...


def _prompt_slots(slots: dict) -> dict:
    """프롬프트용 슬롯 사본 — provenance 는 뺀다.

    출처 배지는 서버가 그래프에서 채우므로 LLM 이 볼 이유가 없고(토큰 낭비),
    보여주면 베껴 쓸 여지만 생긴다(날조 표면 축소).
    """
    out = dict(slots)
    out["추천"] = [
        {**r, "운동": [{k: v for k, v in ex.items() if k != "provenance"}
                       for ex in r.get("운동", [])]}
        for r in slots.get("추천", [])
    ]
    return out


def _build_prompt(slots: dict) -> str:
    """슬롯 → claude 프롬프트. 규칙 명시 + JSON 스키마 예시."""
    slot_json = json.dumps(_prompt_slots(slots), ensure_ascii=False, indent=1)
    schema = ('{"약점":[{"항목":"","등급":"","근거":""}],'
              '"우선순위":[],'
              '"처방":[{"운동":"","목표체력요인":"","강도":"","주당빈도":""}],'
              '"주의":""}')
    return (
        "당신은 국민체력100 데이터 기반 운동처방 보조입니다.\n"
        "아래 [슬롯]의 수치와 운동명만 사용하세요. 다음 규칙을 반드시 지키세요:\n"
        "- 슬롯에 없는 수치·운동명 창작 금지 (allowed_exercises 안의 운동만 처방).\n"
        "- 시설·가격·자격·신청 언급 금지.\n"
        "- 진단·치료 등 의료 조언 금지.\n"
        "- 강도·주당빈도는 FITT 수치사전의 값만 인용.\n"
        "- 출처·근거 배지는 서버가 채운다 — 출처 필드를 만들지 말 것.\n"
        "- 설명 문장 없이 JSON 하나만 출력.\n\n"
        f"[슬롯]\n{slot_json}\n\n"
        f"[출력 스키마 — 이 형태의 JSON 만]\n{schema}\n"
    )


def _extract_json(text: str) -> dict:
    """LLM 출력에서 첫 JSON 오브젝트 추출(코드펜스·서두 문장 허용)."""
    t = text.strip()
    # ```json ... ``` 펜스 제거
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", t, re.DOTALL)
    if fence:
        return json.loads(fence.group(1))
    start = t.find("{")
    end = t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("JSON 오브젝트를 찾지 못함")
    return json.loads(t[start:end + 1])


class ClaudeCLIProvider:
    """현행: subprocess ["claude","-p","--model","sonnet"], stdin 프롬프트, 타임아웃 90s."""

    name = "claude"

    def prescribe(self, slots: dict) -> dict:
        prompt = _build_prompt(slots)
        proc = subprocess.run(
            ["claude", "-p", "--model", "sonnet"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT_S,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"claude CLI exit {proc.returncode}: {proc.stderr[:200]}")
        return _extract_json(proc.stdout)


class GeminiProvider:
    """프로덕션 예약(NotImplemented 스텁): GEMINI_API_KEY 로 동일 프롬프트·스키마 호출 예정.
    선택 시 오케스트레이션이 예외를 잡아 RulesFallback 으로 강등한다(무중단)."""

    name = "gemini"

    def prescribe(self, slots: dict) -> dict:
        raise NotImplementedError(
            "GeminiProvider 는 프로덕션 배포 시 구현 (동일 프롬프트·스키마, GEMINI_API_KEY)")


class RulesFallback:
    """LLM 없이 그래프 추천을 정형 문장으로 조립. 서비스 무중단 보장(off/실패/타임아웃)."""

    name = "rules"

    def prescribe(self, slots: dict) -> dict:
        fitt = slots.get("FITT", {})
        weak = [
            {"항목": w["항목"], "등급": w.get("등급", ""), "근거": w.get("근거", "")}
            for w in slots.get("약점", [])
        ]
        rx: list[dict] = []
        for r in slots.get("추천", []):
            factor = r.get("요인", "")
            intensity, freq = _fitt_for_factor(factor, fitt)
            for ex in r.get("운동", [])[:2]:  # 요인당 상위 2개
                rx.append({
                    "운동": ex["운동"],
                    "목표체력요인": factor,
                    "강도": intensity,
                    "주당빈도": freq,
                    "provenance": ex.get("provenance"),
                })
        priority = [w["항목"] for w in slots.get("약점", [])]
        return {"약점": weak, "우선순위": priority, "처방": rx, "주의": _DISCLAIMER}


def get_provider() -> LLMProvider:
    """env SPONAVI_LLM = claude | gemini | off(기본). off/미설정/미상 → RulesFallback 고정."""
    mode = os.environ.get("SPONAVI_LLM", "off").strip().lower()
    if mode == "claude":
        return ClaudeCLIProvider()
    if mode == "gemini":
        return GeminiProvider()
    return RulesFallback()


def provider_label() -> str:
    """GET /api/health 표기용 — 설정된 프로바이더 라벨."""
    return os.environ.get("SPONAVI_LLM", "off").strip().lower() or "off"


def _run_provider(provider: LLMProvider, slots: dict) -> tuple[dict, str]:
    """검증 통과분 반환 + 실제 사용 프로바이더명. LLM 실패/스키마 실패 → 1회 재시도 → RulesFallback."""
    if isinstance(provider, RulesFallback):
        valid = _validate(provider.prescribe(slots))
        return (valid if valid is not None else _empty_rx(slots)), "rules"

    for _attempt in range(2):  # 최초 + 재시도 1회
        try:
            raw = provider.prescribe(slots)
        except Exception:
            break  # CLI 오류/타임아웃/미구현 → 즉시 폴백
        valid = _validate(raw)
        if valid is not None:
            return valid, provider.name
    # 폴백
    fb = _validate(RulesFallback().prescribe(slots))
    return (fb if fb is not None else _empty_rx(slots)), "rules"


def _empty_rx(slots: dict) -> dict:
    return {"약점": [], "우선순위": [], "처방": [], "주의": _DISCLAIMER}


# ---------------------------------------------------------------------------
# 캐시 (ARCHITECTURE §6.4) — sqlite fitness_ai_cache. 키 = sha256(연령군·성별·측정값·버전).
# ---------------------------------------------------------------------------
def _ensure_cache(conn) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS fitness_ai_cache ("
        "key TEXT PRIMARY KEY, response TEXT, provider TEXT, created TEXT)")


def _versions(conn) -> str:
    """norm/graph/응답스키마 버전 문자열 — 기준표·그래프·스키마 갱신 시 스테일 처방 자동 무효화."""
    def c(table: str) -> int:
        try:
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except Exception:
            return 0
    return f"norm{c('fitness_norm')}.graph{c('graph_edges')}.{RESPONSE_SCHEMA_VERSION}"


def _cache_key(payload: dict, conn) -> str:
    age = int(payload.get("age", 0))
    group = fitness.age_group_of(age)
    sex = payload.get("sex", "M")
    measures = payload.get("measures") or {}
    rounded = {
        k: (round(float(v), 1) if v is not None else None)
        for k, v in sorted(measures.items())
    }
    raw = json.dumps(
        {"g": group, "s": sex, "m": rounded, "v": _versions(conn)},
        ensure_ascii=False, sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# 계산 (캐시 미스에서만 호출) — 슬롯 → 프로바이더 → 화이트리스트
# ---------------------------------------------------------------------------
def _compute(store: Store, payload: dict) -> dict:
    assessment = fitness.assess_fitness(store, payload)
    slots = _build_slots(store, payload, assessment)
    provider = get_provider()
    rx, provider_used = _run_provider(provider, slots)
    rx = _whitelist_filter(rx, slots)
    rx = _attach_provenance(rx, slots)   # 출처는 서버 권위 — 프로바이더 값 폐기
    return {
        "provider": provider_used,
        "age_group": slots["연령군"],
        "age_gap": bool(assessment.get("age_gap")),
        "약점": rx["약점"],
        "우선순위": rx["우선순위"],
        "처방": rx["처방"],
        "주의": rx["주의"] or _DISCLAIMER,
        "facility_filter_sports": slots["facility_filter_sports"],
        "disclaimer": _DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# 공개 진입점 — 캐시 우선, 미스 시 계산 후 적재
# ---------------------------------------------------------------------------
def prescribe(store: Store, payload: dict) -> dict:
    conn = store.conn
    # 캐시는 best-effort — 읽기전용/락 DB(배포 볼륨 RO 등)면 캐시 없이 계산(무중단).
    key: Optional[str] = None
    try:
        _ensure_cache(conn)
        key = _cache_key(payload, conn)
        row = conn.execute(
            "SELECT response FROM fitness_ai_cache WHERE key=?", (key,)).fetchone()
        if row and row[0]:
            return json.loads(row[0])
    except sqlite3.Error:
        key = None

    result = _compute(store, payload)
    payload_json = json.dumps(result, ensure_ascii=False)
    if key is not None:
        try:
            conn.execute(
                "INSERT OR REPLACE INTO fitness_ai_cache (key, response, provider, created) "
                "VALUES (?,?,?,?)",
                (key, payload_json, result.get("provider"), _now()),
            )
            conn.commit()
        except sqlite3.Error:
            pass  # 적재 실패는 무시(다음 호출 시 재계산)
    # 캐시 적중분과 동일 정규화를 보장(라운드트립) → prescribe 반복 호출 동치.
    return json.loads(payload_json)
