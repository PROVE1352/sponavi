"""Pydantic request models (validation only). Responses are built as plain dicts
by engine/fitness to keep the contract shape verbatim (docs/API.md)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class Measures(BaseModel):
    model_config = {"extra": "ignore"}

    grip_kg: Optional[float] = None
    situp_cnt: Optional[float] = None
    flex_cm: Optional[float] = None
    shuttle_cnt: Optional[float] = None


class FitnessRequest(BaseModel):
    model_config = {"extra": "ignore"}

    age: int = Field(ge=0, le=200)
    sex: Literal["M", "F"] = "M"
    measures: Measures = Field(default_factory=Measures)
