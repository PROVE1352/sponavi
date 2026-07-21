"""Production entrypoint: API + static web/dist (same-origin, client BASE='/api').

Run: uvicorn app.serve:app --host 0.0.0.0 --port 8100
Dev는 기존대로 app.main:app + Vite dev server를 쓴다.

미들웨어(관측/보안/GZip/레이트리밋)는 app.main 에서 이미 얹혀 있고, 여기서는
정적 자산 캐시 정책만 추가한다(해시 파일명은 1년 immutable, index.html 은 no-cache).
"""
from __future__ import annotations

from pathlib import Path

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


if _dist.exists():
    # 라우트 등록 이후의 mount이므로 /api/*가 우선 매칭된다. html=True로 SPA 진입점 서빙.
    app.mount("/", CachedStaticFiles(directory=_dist, html=True), name="web")
