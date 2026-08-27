"""SpoNavi FastAPI app. Endpoints per docs/API.md. Demo mode = fixtures only.

Run: cd server && uvicorn app.main:app --reload

운영 하드닝(관측/성능/보안 기본기)은 미들웨어 스택으로 얹는다. 미들웨어는
'나중에 등록될수록 바깥(outermost)'이므로 아래 등록 순서는 요청 기준
안쪽→바깥 순이다: RateLimit → CORS → SecurityHeaders → GZip → AccessLog.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import engine, fitness
from .models import AssessRequest, ChatNluRequest, FitnessRequest
from .personas import PERSONAS
from .store import REPO_ROOT, get_store

app = FastAPI(title="SpoNavi API", version="1.0")

# ---------------------------------------------------------------------------
# 프로세스 메타 (관측 가능성) — GET /api/health 확장 필드용
# ---------------------------------------------------------------------------
_START_MONO = time.monotonic()


def _resolve_version() -> str:
    """빌드 시 주입된 git short hash. 컨테이너는 ENV SPONAVI_VERSION(Dockerfile
    ARG GIT_SHA)로 받고, 로컬 개발은 git 조회로 폴백, 둘 다 없으면 'dev'."""
    env = os.environ.get("SPONAVI_VERSION")
    if env and env.strip():
        return env.strip()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=2,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    return "dev"


VERSION = _resolve_version()

# 액세스 로거를 직접 배선한다 — uvicorn/root 로깅 설정에 의존하면 핸들러가 없어
# 레코드가 조용히 버려질 수 있다. 자체 스트림 핸들러(메시지=완성된 JSON 한 줄)로
# stderr(=docker logs 캡처)에 확실히 남긴다. propagate=False 로 중복 방지.
_access_log = logging.getLogger("sponavi.access")
if not _access_log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    _access_log.addHandler(_h)
    _access_log.setLevel(logging.INFO)
    _access_log.propagate = False


# ---------------------------------------------------------------------------
# 미들웨어 — 관측/성능/보안 (SPEC 하드닝)
# ---------------------------------------------------------------------------
class AccessLogMiddleware(BaseHTTPMiddleware):
    """구조화 액세스 로그(요청당 JSON 한 줄).

    ★ P-3(개인정보 최소수집): method·path·status·ms 만 기록한다.
      - 쿼리스트링·요청 바디·요청 헤더·클라이언트 IP 등 개인정보는 절대 남기지
        않는다(path 는 url.path 라 쿼리 제외). 로그로 PII 가 새지 않게 한다.
    5xx 는 스택 '요약'(마지막 프레임 한 줄)만 error 로 남긴다 — 본문 미포함.
    """

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        method = request.method
        path = request.url.path  # 쿼리스트링 제외 (P-3)
        try:
            response = await call_next(request)
        except Exception:
            ms = round((time.perf_counter() - start) * 1000, 1)
            # 스택 '요약'만 — 요청 본문/파라미터는 절대 기록하지 않는다 (P-3)
            tb = traceback.format_exc().strip().splitlines()
            summary = tb[-1] if tb else "unhandled exception"
            _access_log.error(json.dumps(
                {"method": method, "path": path, "status": 500, "ms": ms,
                 "error": summary}, ensure_ascii=False))
            raise
        ms = round((time.perf_counter() - start) * 1000, 1)
        rec = {"method": method, "path": path,
               "status": response.status_code, "ms": ms}
        if response.status_code >= 500:
            _access_log.error(json.dumps(rec, ensure_ascii=False))
        else:
            _access_log.info(json.dumps(rec, ensure_ascii=False))
        return response


# self + inline style 허용(Tailwind v4 / MapLibre 인라인 스타일 특성).
# 지도는 MapLibre GL + OpenFreeMap 벡터 타일(v1.8) — 스타일 JSON·타일(pbf)·글리프·
# 스프라이트를 전부 fetch 로 받으므로 connect-src 에 https://tiles.openfreemap.org 가
# 필수다(래스터 타일 <img> 시절의 *.tile.openstreetmap.org 는 더 이상 필요 없음).
# MapLibre 는 워커를 blob: URL 로 띄우므로 worker-src blob: 도 필요하고,
# 스프라이트/래스터(ne2_shaded)는 blob:·data: 로도 그려진다.
# 마커는 자체 DOM 엘리먼트라 외부 이미지 CDN 불필요. 외부 kspo/svoucher 링크는
# <a href> 네비게이션이라 리소스 지시자 대상이 아님(허용 호스트 추가 불필요).
_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    # openapi.kspo.or.kr = 운동영상 썸네일(<img src>, videos.img_url — CQ4A)
    "img-src 'self' data: blob: https://tiles.openfreemap.org "
    "https://openapi.kspo.or.kr; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "worker-src 'self' blob:; "
    "connect-src 'self' https://tiles.openfreemap.org; "
    "font-src 'self' data:"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """보안 응답 헤더(모든 응답 — 에러/429 포함). setdefault 라 개별 응답이
    이미 지정한 값은 덮지 않는다."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Content-Security-Policy", _CSP)
        return response


class RateLimiter:
    """IP·버킷별 슬라이딩 윈도우(메모리). 단일 컨테이너 기준 충분(외부 의존 0).

    - /api/fitness/ai : 분당 ai_per_min(기본 6) — LLM/무거운 경로 보호
    - /api/chat/nlu   : 분당 chat_per_min(기본 20) — 자유 텍스트 NLU(API.md `chat` 버킷)
    - 그 외 /api/*    : 분당 default_per_min(기본 120)
    - 정적/그 외 경로 : 무제한
    워커>1 이면 카운트가 워커별이라 실효 한도는 워커수 배로 근사된다(계약 허용
    — '단일 컨테이너라 충분'). enabled 는 ENV SPONAVI_RATE_LIMIT(off 로 비활성)."""

    def __init__(self, default_per_min: int = 120, ai_per_min: int = 6,
                 chat_per_min: int = 20, window_s: int = 60) -> None:
        self.default_per_min = default_per_min
        self.ai_per_min = ai_per_min
        self.chat_per_min = chat_per_min
        self.window_s = window_s
        self.enabled = os.environ.get(
            "SPONAVI_RATE_LIMIT", "on").strip().lower() not in (
            "off", "0", "false", "no")
        self._hits: dict[tuple, list[float]] = {}

    def reset(self) -> None:
        """카운터 초기화(테스트에서 케이스 간 격리에 사용)."""
        self._hits.clear()

    def _limit_for(self, path: str):
        if path == "/api/fitness/ai":
            return self.ai_per_min, "ai"
        if path == "/api/chat/nlu":
            return self.chat_per_min, "chat"
        if path.startswith("/api/"):
            return self.default_per_min, "api"
        return None, None  # 정적 자산 등 — 무제한

    def allow(self, ip: str, path: str, now: float) -> bool:
        if not self.enabled:
            return True
        limit, bucket = self._limit_for(path)
        if limit is None:
            return True
        key = (ip, bucket)
        window_start = now - self.window_s
        hits = self._hits.get(key)
        if hits is None:
            hits = []
            self._hits[key] = hits
        elif hits and hits[0] <= window_start:
            hits[:] = [t for t in hits if t > window_start]  # 오래된 기록 제거
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


_rate_limiter = RateLimiter()
_RATE_MSG = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."


def _client_ip(request: Request) -> str:
    # 신뢰하는 단일 리버스 프록시(Caddy) 뒤 — X-Forwarded-For 왼쪽 첫 IP.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not _rate_limiter.allow(
            _client_ip(request), request.url.path, time.time()
        ):
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "RATE_LIMITED", "message": _RATE_MSG}},
            )
        return await call_next(request)


# --- 미들웨어 등록 (아래로 갈수록 바깥) -----------------------------------
# 요청 흐름:  AccessLog → GZip → SecurityHeaders → CORS → RateLimit → 라우터
# 응답에도 역순으로 헤더/압축/로그가 얹힌다(429·에러도 보안 헤더·CORS 포함).
app.add_middleware(RateLimitMiddleware)
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
app.add_middleware(SecurityHeadersMiddleware)
# GZip: JSON 응답(assess 등 수 KB)·정적 텍스트 압축. minimum_size 미만은 건너뜀.
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(AccessLogMiddleware)


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
    from . import ai, chat
    from .store import db_mtime_iso, db_path

    store = get_store()
    return {
        "status": "ok",
        "mode": "db" if db_path().exists() else "fixtures",
        "llm": ai.provider_label(),
        # 챗 NLU 프로바이더 라벨(정직 라벨) — 체력처방 llm 과 별도 스위치.
        "chat_llm": chat.provider_label(),
        # 데이터 기준일: DB 내 빌드 스탬프 우선, 없으면 파일 mtime(ISO) 폴백.
        "data_built": store.build_stamp() or db_mtime_iso(),
        "version": VERSION,          # 빌드 시 주입된 git short hash
        "uptime_s": round(time.monotonic() - _START_MONO, 1),
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


def _item_extra(code: str) -> dict:
    """파생 항목(FR-07 AC8): 폼이 BMI 대신 키·몸무게를 받도록 입력 스펙과 공식을 동봉."""
    spec = fitness.DERIVED_ITEMS.get(code)
    if not spec:
        return {}
    return {
        "derived_from": [
            {k: d[k] for k in ("code", "name", "unit", "min", "max")} for d in spec["inputs"]
        ],
        "formula": spec["formula"],
    }


def _item_hint(higher_better, code: str = "") -> str:
    if code in fitness.DERIVED_ITEMS:
        return "키·몸무게를 넣으면 자동 계산 · 건강범위 충족(신체조성)"
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
            "hint": _item_hint(it.get("higher_better"), it["code"]),
            **_item_extra(it["code"]),
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


# --- 챗 NLU (v2 UX) — docs/API.md `/api/chat/*` · PRD FR-13 --------------
# LLM 은 슬롯 추출·연결 멘트·FAQ 라우팅만. 코드 확정·자격 문장은 서버 결정론이다.
@app.post("/api/chat/nlu")
def post_chat_nlu(req: ChatNluRequest) -> dict:
    from . import chat

    start = time.perf_counter()
    resp, meta = chat.run_nlu(get_store(), req.model_dump())
    # ★ P-3: 발화 원문·슬롯은 로그에 남기지 않는다. 관측은 아래 4개 필드만.
    _access_log.info(json.dumps({
        "event": "chat_nlu",
        "provider": resp["provider"],
        "ms": round((time.perf_counter() - start) * 1000, 1),
        "ok": meta["ok"],
        "fallback_reason": meta["fallback_reason"],
    }, ensure_ascii=False))
    return resp


# rules.json verified 필드로 조립한 고정 FAQ 사전(정적·캐시 가능). LLM 무관.
@app.get("/api/chat/faq")
def get_chat_faq() -> list[dict]:
    from . import chat

    return chat.faq_list(get_store())


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
