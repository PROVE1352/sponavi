"""Production entrypoint: API + static web/dist (same-origin, client BASE='/api').

Run: uvicorn app.serve:app --host 0.0.0.0 --port 8100
Dev는 기존대로 app.main:app + Vite dev server를 쓴다.

미들웨어(관측/보안/GZip/레이트리밋)는 app.main 에서 이미 얹혀 있고, 여기서는
정적 자산 캐시 정책만 추가한다(해시 파일명은 1년 immutable, index.html 은 no-cache).
"""
from __future__ import annotations

from pathlib import Path

from starlette.requests import Request
from starlette.responses import RedirectResponse
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from .main import app
from .store import REPO_ROOT

_dist = Path(REPO_ROOT) / "web" / "dist"


class CachedStaticFiles(StaticFiles):
    """정적 자산 캐시 헤더:
    - /assets/* : Vite 해시 파일명이라 내용이 바뀌면 URL 도 바뀐다 → 1년 immutable.
    - index.html(및 SPA html 폴백) : no-cache — 새 배포를 즉시 반영해야 하므로
      항상 재검증. (content-type 으로 판별 → 경로에 무관하게 안전.)
    """

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        ctype = response.headers.get("content-type", "")
        if ctype.startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        elif path.startswith("assets/") or "/assets/" in path:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# ---------------------------------------------------------------------------
# 짧은 주소 (결정 4A) — mount("/") 앞에 명시 라우트로 둔다. 뒤에 두면 StaticFiles 가
# 먼저 잡아 404 가 된다. 라우트는 mount 유무와 무관하게 항상 등록한다.
# ---------------------------------------------------------------------------
@app.get("/demo", include_in_schema=False)
async def demo_redirect(request: Request) -> RedirectResponse:
    """보고서 QR 주소 `/demo?p=P2&auto=1` → SPA 해시 라우트 `/#/demo?p=P2&auto=1`.

    쿼리는 **해시 안쪽**으로 옮긴다 — 클라(route.ts)가 `location.search` 가 아니라
    해시 내부를 읽고, PDF 링크 추출에서 fragment 가 탈락하지 않도록 QR 은 `/demo` 를
    찍기 때문이다.
    """
    query = request.url.query
    target = f"/#/demo?{query}" if query else "/#/demo"
    return RedirectResponse(target, status_code=302)


@app.get("/gap", include_in_schema=False)
async def gap_redirect() -> RedirectResponse:
    """뒷면(공급공백 정적 표)의 짧은 주소. 실체는 `web/public/gap.html`(W3 산출물)."""
    return RedirectResponse("/gap.html", status_code=302)


if _dist.exists():
    # 라우트 등록 이후의 mount이므로 /api/*와 위 짧은 주소가 우선 매칭된다.
    # html=True로 SPA 진입점 서빙.
    app.mount("/", CachedStaticFiles(directory=_dist, html=True), name="web")
