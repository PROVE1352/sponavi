"""Fitness weakness assessment. Contract: docs/API.md POST /api/fitness.

IMPORTANT (SPEC §3): no official 국민체력100 cutoff table is bundled, so the
thresholds below are explicitly DEMO approximations. Every weakness is labeled
`basis="데모 기준(연령·성별 근사)"` so the UI can badge it as such — never
presented as an official standard. Swap in real cutoffs when available.
"""
from __future__ import annotations

from typing import Any, Optional

from .store import Store

# measure key -> fitness dimension (matches rules.json fitness_map.weakness)
MEASURE_ITEM = {
    "grip_kg": "근력",
    "situp_cnt": "근지구력",
    "flex_cm": "유연성",
    "shuttle_cnt": "심폐지구력",
}

BASIS = "데모 기준(연령·성별 근사)"


def _age_band(age: int) -> str:
    if age < 13:
        return "child"
    if age < 19:
        return "teen"
    if age < 40:
        return "adult"
    if age < 65:
        return "middle"
    return "senior"


# DEMO lower/upper cutoffs by (measure, band, sex). value < lower => 하위(약점),
# lower<=value<upper => 보통, value>=upper => 상위. Higher is better for all four.
# Rough, illustrative — NOT an official standard.
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


def _band(measure: str, value: float, age: int, sex: str) -> str:
    band = _age_band(age)
    sex = sex if sex in ("M", "F") else "M"
    lo, hi = _CUT[measure][band][sex]
    if value < lo:
        return "하위"
    if value < hi:
        return "보통"
    return "상위"


def assess_fitness(store: Store, payload: dict) -> dict:
    age = payload["age"]
    sex = payload.get("sex", "M")
    measures = payload.get("measures") or {}

    weaknesses: list[dict] = []
    for key, item in MEASURE_ITEM.items():
        value = measures.get(key)
        if value is None:
            continue
        band = _band(key, value, age, sex)
        if band == "하위":
            weaknesses.append({
                "item": item,
                "value": value,
                "band": band,
                "basis": BASIS,
            })

    # recommendations from rules.json fitness_map
    fmap = {m["weakness"]: m for m in store.fitness_map}
    recommendations: list[dict] = []
    rec_sports: list[str] = []
    for w in weaknesses:
        entry = fmap.get(w["item"])
        if not entry:
            continue
        recommendations.append({
            "weakness": w["item"],
            "exercises": entry.get("exercises", []),
            "sports": entry.get("sports", []),
            "curated": "체대 검증 대기",
        })
        for s in entry.get("sports", []):
            if s not in rec_sports:
                rec_sports.append(s)

    # videos: fixtures filtered by matched weaknesses
    weak_items = {w["item"] for w in weaknesses}
    videos = []
    from .store import load_videos
    for v in load_videos():
        if v.get("for_weakness") in weak_items:
            videos.append({
                "title": v.get("title"),
                "url": v.get("url"),
                "source": v.get("source"),
            })

    return {
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "videos": videos,
        "facility_filter_sports": rec_sports,
    }
