"""운영에서 자동 API 문서를 닫았는지 확인(2026-09-30). 계약 정본은 docs/API.md."""
from fastapi.testclient import TestClient

from app.main import app


def test_auto_docs_closed():
    c = TestClient(app)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert c.get(path).status_code == 404, path
