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

    return {"status": "ok", "mode": "db" if db_path().exists() else "fixtures"}


@app.post("/api/assess")
def post_assess(req: AssessRequest) -> dict:
    return engine.assess(get_store(), req.model_dump())


@app.post("/api/fitness")
def post_fitness(req: FitnessRequest) -> dict:
    return fitness.assess_fitness(get_store(), req.model_dump())


@app.get("/api/meta/sigungu")
def get_sigungu() -> list[dict]:
    return get_store().all_centroids()


@app.get("/api/demo/personas")
def get_personas() -> list[dict]:
    return PERSONAS
