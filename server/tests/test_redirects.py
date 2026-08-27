"""짧은 주소 리다이렉트 (결정 4A) — `app.serve` 의 mount("/") 앞 명시 라우트 2개.

  * `/demo?…` → `/#/demo?…` (쿼리를 해시 안쪽으로 보존)
  * `/gap`    → `/gap.html`
`app.serve` 는 `app.main` 의 app 객체에 라우트를 얹으므로 import 만으로 등록된다.
"""
import pytest

from app import serve  # noqa: F401  (import 부수효과로 라우트 등록)
from app.store import REPO_ROOT


def test_demo_redirect_preserves_query(client):
    r = client.get("/demo?p=P2&auto=1", follow_redirects=False)
    assert r.status_code == 302
    # 보고서 QR 주소 — 쿼리는 fragment 안쪽에 그대로 실린다
    assert r.headers["location"] == "/#/demo?p=P2&auto=1"


def test_demo_redirect_without_query(client):
    r = client.get("/demo", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/#/demo"


def test_gap_redirect(client):
    r = client.get("/gap", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/gap.html"


def test_root_still_serves_index(client):
    if not (REPO_ROOT / "web" / "dist" / "index.html").exists():
        pytest.skip("web/dist 미빌드 — 정적 서빙 검증 불가")
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    # 새 배포 즉시 반영(캐시 정책 회귀)
    assert r.headers.get("cache-control") == "no-cache"
