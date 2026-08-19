"""운영 하드닝 계약 검증: 확장 헬스 · 보안 헤더 · 레이트리밋(버킷/봉투/헤더).

전부 TestClient(app.main:app) 기준 — serve.py 정적 마운트와 무관하게 API 층을
검증한다. 레이트리밋 카운터는 conftest 의 autouse fixture 가 케이스마다 리셋한다.
"""
import pytest

from app.main import _rate_limiter


# ---------------------------------------------------------------------------
# 1) 관측 가능성 — /api/health 확장
# ---------------------------------------------------------------------------
def test_health_extended_fields(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert set(data) >= {
        "status", "mode", "llm", "data_built", "version", "uptime_s"
    }
    assert data["status"] == "ok"
    assert data["mode"] in ("db", "fixtures")
    # data_built: DB 빌드 스탬프 or 파일 mtime ISO (DB 없으면 None 허용)
    assert data["data_built"] is None or isinstance(data["data_built"], str)
    if isinstance(data["data_built"], str):
        assert "T" in data["data_built"]  # ISO 8601
    assert isinstance(data["version"], str) and data["version"]
    assert isinstance(data["uptime_s"], (int, float)) and data["uptime_s"] >= 0


# ---------------------------------------------------------------------------
# 3) 보안 기본기 — 보안 헤더
# ---------------------------------------------------------------------------
def test_security_headers_present(client):
    r = client.get("/api/health")
    h = r.headers
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "DENY"
    assert h["Referrer-Policy"] == "strict-origin-when-cross-origin"
    csp = h["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "'unsafe-inline'" in csp                       # Tailwind/MapLibre
    # 지도 = MapLibre GL + OpenFreeMap 벡터 타일(v1.8): 스타일 JSON·pbf·글리프·
    # 스프라이트를 fetch 로 받으므로 connect-src 허용이 필수, 워커는 blob: 로 뜬다.
    assert "connect-src 'self' https://tiles.openfreemap.org" in csp
    assert "worker-src 'self' blob:" in csp
    assert "blob:" in csp.split("img-src")[1].split(";")[0]
    assert "openstreetmap.org" not in csp                 # 래스터 타일 시절 잔재 없음
    assert "frame-ancestors 'none'" in csp


# ---------------------------------------------------------------------------
# 3) 보안 기본기 — 레이트리밋
# ---------------------------------------------------------------------------
def test_rate_limit_buckets_config():
    # 계약 한도: /api/fitness/ai 6/분, 그 외 /api/* 120/분, 정적은 무제한
    assert _rate_limiter.default_per_min == 120
    assert _rate_limiter.ai_per_min == 6
    assert _rate_limiter._limit_for("/api/fitness/ai") == (6, "ai")
    assert _rate_limiter._limit_for("/api/assess") == (120, "api")
    assert _rate_limiter._limit_for("/api/health") == (120, "api")
    assert _rate_limiter._limit_for("/") == (None, None)
    assert _rate_limiter._limit_for("/assets/index-abc.js") == (None, None)


def test_rate_limit_enforced_with_envelope(client):
    # 'api' 버킷 한도를 낮춰 초과 → 429 + 한국어 에러 봉투(+보안 헤더 유지) 확인
    _rate_limiter.reset()
    prev_enabled, prev_limit = _rate_limiter.enabled, _rate_limiter.default_per_min
    _rate_limiter.enabled = True
    _rate_limiter.default_per_min = 3
    try:
        codes = [client.get("/api/health").status_code for _ in range(4)]
    finally:
        _rate_limiter.default_per_min = prev_limit
        _rate_limiter.enabled = prev_enabled
        _rate_limiter.reset()

    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429
    # 마지막 429 응답 형태 재확인
    _rate_limiter.enabled = True
    _rate_limiter.default_per_min = 1
    try:
        client.get("/api/health")                 # 1회 소진
        blocked = client.get("/api/health")       # 2회차 → 429
    finally:
        _rate_limiter.default_per_min = prev_limit
        _rate_limiter.enabled = prev_enabled
        _rate_limiter.reset()
    assert blocked.status_code == 429
    body = blocked.json()
    assert set(body["error"]) >= {"code", "message"}
    assert body["error"]["code"] == "RATE_LIMITED"
    assert "너무 많" in body["error"]["message"]  # 한국어 봉투
    # 429 에도 보안 헤더가 얹혀야 한다(SecurityHeaders 가 RateLimit 바깥)
    assert blocked.headers["X-Content-Type-Options"] == "nosniff"


def test_rate_limit_disabled_bypasses(client):
    _rate_limiter.reset()
    prev_enabled, prev_limit = _rate_limiter.enabled, _rate_limiter.default_per_min
    _rate_limiter.enabled = False
    _rate_limiter.default_per_min = 1
    try:
        codes = [client.get("/api/health").status_code for _ in range(5)]
    finally:
        _rate_limiter.default_per_min = prev_limit
        _rate_limiter.enabled = prev_enabled
        _rate_limiter.reset()
    assert codes == [200] * 5  # 비활성 시 한도 무시(벤치/특수 운영용)


def test_rate_limit_ai_bucket_isolated_from_api(client):
    # 'ai' 버킷과 'api' 버킷은 독립 카운트 — ai 를 소진해도 일반 api 는 통과
    _rate_limiter.reset()
    prev_enabled, prev_ai = _rate_limiter.enabled, _rate_limiter.ai_per_min
    _rate_limiter.enabled = True
    _rate_limiter.ai_per_min = 0  # ai 는 즉시 차단
    try:
        ai_resp = client.post("/api/fitness/ai", json={"age": 27, "sex": "M",
                              "measures": {"grip_kg": 30}})
        api_resp = client.get("/api/health")
    finally:
        _rate_limiter.ai_per_min = prev_ai
        _rate_limiter.enabled = prev_enabled
        _rate_limiter.reset()
    assert ai_resp.status_code == 429          # ai 버킷 차단
    assert api_resp.status_code == 200         # api 버킷은 영향 없음
