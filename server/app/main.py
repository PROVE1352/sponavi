"""SpoNavi FastAPI app. Endpoints per docs/API.md. Demo mode = fixtures only.

Run: cd server && uvicorn app.main:app --reload
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import engine, fitness
from .models import AssessRequest, FitnessRequest
from .personas import PERSONAS
from .store import get_store

app = FastAPI(title="SpoNavi API", version="1.0")

# CORS: local Vite dev server (SPEC §6)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error(code: str, message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


# --- contract-shaped error envelope --------------------------------------
@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    msg = first.get("msg", "요청 형식이 올바르지 않습니다")
    return _error("INVALID_REQUEST", f"입력값 오류({loc}): {msg}", status=422)


@app.exception_handler(engine.AssessError)
async def _assess_error_handler(request: Request, exc: engine.AssessError) -> JSONResponse:
    return _error(exc.code, exc.message, status=400)


# --- endpoints ------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    # mode는 store 소스 선택 로직과 동일 기준 (db=전국 실데이터, fixtures=데모)
    from .store import db_path
    from . import ai

    return {
        "status": "ok",
        "mode": "db" if db_path().exists() else "fixtures",
        "llm": ai.provider_label(),
    }


@app.post("/api/assess")
def post_assess(req: AssessRequest) -> dict:
    return engine.assess(get_store(), req.model_dump())


@app.post("/api/fitness")
def post_fitness(req: FitnessRequest) -> dict:
    return fitness.assess_fitness(get_store(), req.model_dump())


# 전 측정항목 → LLM(또는 규칙) 처방. SPONAVI_LLM 미설정 서버는 provider="rules" 고정.
@app.post("/api/fitness/ai")
def post_fitness_ai(req: FitnessRequest) -> dict:
    from . import ai

    return ai.prescribe(get_store(), req.model_dump())


# 웹 동적 폼용 항목 카탈로그 (연령군별 공식 측정항목). 공식 테이블 없으면 데모 4항목.
_DEMO_ITEMS = [
    {"code": "shuttle_cnt", "name": "왕복오래달리기", "unit": "회", "factor": "심폐지구력", "alt_group": None, "higher_better": 1},
    {"code": "grip_kg", "name": "악력", "unit": "kg", "factor": "근력", "alt_group": None, "higher_better": 1},
    {"code": "situp_cnt", "name": "윗몸일으키기", "unit": "회", "factor": "근지구력", "alt_group": None, "higher_better": 1},
    {"code": "flex_cm", "name": "앉아윗몸앞으로굽히기", "unit": "cm", "factor": "유연성", "alt_group": None, "higher_better": 1},
]


def _item_hint(higher_better) -> str:
    if higher_better == 0:
        return "낮을수록 좋음(시간 단축)"
    if higher_better is None:
        return "건강범위 충족(신체조성)"
    return "높을수록 좋음"


_GROUP_LABEL = {"유아": "유아기", "gap": "만7~10(공백)", "유소년": "유소년",
                "청소년": "청소년", "성인": "성인", "어르신": "어르신"}


@app.get("/api/fitness/items")
def get_fitness_items(age: int) -> dict:
    store = get_store()
    group = fitness.age_group_of(age)
    catalog_age = 11 if group == "gap" else age
    raw = store.fitness_items(catalog_age)
    official = bool(raw)
    if not raw and not store.has_fitness_norms():
        raw = _DEMO_ITEMS  # 데모 폴백 — 폼 유지
    items = [
        {
            "code": it["code"], "name": it["name"], "unit": it["unit"],
            "factor": it["factor"], "alt_group": it.get("alt_group"),
            "higher_better": it.get("higher_better"),
            "hint": _item_hint(it.get("higher_better")),
        }
        for it in raw
    ]
    resp: dict = {
        "age": age,
        "age_group": _GROUP_LABEL.get(group, group),
        "age_gap": group == "gap",
        "basis": fitness.BASIS_OFFICIAL if official else fitness.BASIS_DEMO,
        "items": items,
    }
    if group == "gap":
        resp["message"] = "만 7~10세는 국민체력100 공식 기준이 없어 유소년(11~12세) 항목을 참고로 제공합니다."
    elif group == "유아":
        resp["message"] = "유아기(만4~6)는 4단계 비인증 기준으로, 등급 판정 항목이 없습니다."
    return resp


@app.get("/api/meta/sigungu")
def get_sigungu() -> list[dict]:
    return get_store().all_centroids()


@app.get("/api/demo/personas")
def get_personas() -> list[dict]:
    return PERSONAS


# FR-10 접근성 보조 소스(dvoucher 웹). engine 무접촉 — 별도 API 로만 노출.
# 데이터 없는 id 는 응답에서 생략(P-1: 없는 것과 미상을 구분).
_ACCESS_SOURCE = "장애인이용권 웹 공개 정보"


@app.get("/api/accessibility")
def get_accessibility(ids: str = "") -> dict:
    id_list = [s for s in (ids.split(",") if ids else []) if s.strip()]
    data = get_store().accessibility_for([s.strip() for s in id_list])
    return {
        fid: {
            "types": v["types"],
            "amenities": v["amenities"],
            "source": _ACCESS_SOURCE,
            "checked": v.get("checked"),
        }
        for fid, v in data.items()
    }
