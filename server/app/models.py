"""Pydantic request models (validation only). Responses are built as plain dicts
by engine/fitness to keep the contract shape verbatim (docs/API.md)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class Disability(BaseModel):
    has: bool = False
    type: Optional[str] = None


class Location(BaseModel):
    lat: Optional[float] = None
    lon: Optional[float] = None


class AssessRequest(BaseModel):
    model_config = {"extra": "ignore"}  # tolerate persona _meta fields

    age: int = Field(ge=0, le=200)
    sex: Literal["M", "F"] = "M"
    sigungu_cd: Optional[str] = None
    sigungu_nm: Optional[str] = None
    income_class: Literal["기초생활수급", "차상위", "한부모", "그외"] = "그외"
    disability: Disability = Field(default_factory=Disability)
    location: Optional[Location] = None
    # 2027 예산안 확대 대상 자가선언(3자녀 이상 다자녀가구 / 북한이탈주민). 2026 판정에는
    # 쓰이지 않고 svoucher 카드의 next_year 블록에만 쓰인다(engine._next_year).
    special: list[Literal["multichild", "defector"]] = Field(default_factory=list)

    @field_validator("special", mode="before")
    @classmethod
    def _special_null_is_empty(cls, v):
        # 챗 슬롯 초기값이 null 이다(web types_chat) — 미응답은 빈 목록과 같다.
        return [] if v is None else v


class ChatNluRequest(BaseModel):
    """POST /api/chat/nlu (docs/API.md · PRD FR-13).

    text  : 사용자 자유 발화(칩 입력은 이 엔드포인트를 호출하지 않는다). 500자 상한.
    slots : 현재 클라 슬롯 상태(범주값). 서버는 화이트리스트 통과분만 LLM 에 싣는다.
    phase : 대화 단계 힌트 — 추출 대상 슬롯 제한용.
    """

    model_config = {"extra": "ignore"}

    text: str = Field(min_length=1, max_length=500)
    slots: dict[str, Any] = Field(default_factory=dict)
    phase: Literal["collect", "fitness", "qa"] = "collect"


class FitnessRequest(BaseModel):
    """POST /api/fitness.

    measures 는 측정항목 코드→값 dict (예: {"grip_rel": 55.3, "sit_reach": 12}).
    기존 4키(grip_kg/situp_cnt/flex_cm/shuttle_cnt)도 하위호환으로 수용하며
    fitness.py 가 연령군에 맞는 공식 항목으로 매핑한다. 값은 숫자 또는 null."""

    model_config = {"extra": "ignore"}

    age: int = Field(ge=0, le=200)
    sex: Literal["M", "F"] = "M"
    measures: dict[str, Optional[float]] = Field(default_factory=dict)
