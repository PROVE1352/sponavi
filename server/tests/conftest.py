import sys
from pathlib import Path

import pytest

# make `app` importable (server/ on path)
SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from app import store as store_mod  # noqa: E402
from app.personas import PERSONAS  # noqa: E402


@pytest.fixture(scope="session")
def store():
    return store_mod.build_store()


@pytest.fixture(scope="session")
def personas_by_id():
    return {p["id"]: p for p in PERSONAS}


@pytest.fixture(scope="session")
def db_store():
    """전국 DB(data/sponavi.db)가 있을 때만 그 Store, 없으면 None.

    지역 코드 정규화(구코드 별칭·전국 시군구)는 fixtures(서울 25) 로는 검증할 수 없다 —
    DB 없는 환경에서는 해당 테스트를 스킵한다."""
    db = store_mod.db_path()
    if not db.exists():
        return None
    return store_mod.open_db_store(str(db))


@pytest.fixture(scope="session")
def client():
    # patch the app singleton to a fresh store, then return a TestClient
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """레이트리밋 카운터를 케이스마다 초기화한다. 세션 스코프 client 로 전체
    스위트가 누적하면 분당 한도(120)를 넘어 기존 테스트가 429 로 깨질 수 있는데,
    개별 테스트는 /api 호출이 소수라 케이스 간 리셋으로 충분히 격리된다."""
    from app.main import _rate_limiter

    _rate_limiter.reset()
    yield
    _rate_limiter.reset()
