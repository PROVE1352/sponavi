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
def client():
    # patch the app singleton to a fresh store, then return a TestClient
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
