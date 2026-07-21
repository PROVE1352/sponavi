"""Production entrypoint: API + static web/dist (same-origin, client BASE='/api').

Run: uvicorn app.serve:app --host 0.0.0.0 --port 8100
Dev는 기존대로 app.main:app + Vite dev server를 쓴다.
"""
from __future__ import annotations

from pathlib import Path

from fastapi.staticfiles import StaticFiles

from .main import app
from .store import REPO_ROOT

_dist = Path(REPO_ROOT) / "web" / "dist"
if _dist.exists():
    # 라우트 등록 이후의 mount이므로 /api/*가 우선 매칭된다. html=True로 SPA 진입점 서빙.
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
