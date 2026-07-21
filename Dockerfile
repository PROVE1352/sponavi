# SpoNavi 단일 컨테이너: FastAPI(API) + web/dist(정적) — ARCHITECTURE §7
FROM python:3.12-slim

# 빌드 시 주입되는 git short hash → GET /api/health version (관측 가능성).
ARG GIT_SHA=unknown
ENV SPONAVI_VERSION=$GIT_SHA \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv/server
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 리포 레이아웃 재현 (store.py의 REPO_ROOT 상대 해석과 일치)
COPY server/app ./app
COPY data /srv/data
COPY web/dist /srv/web/dist

# 비루트 실행(uid 1000). /srv 소유권 이전 — RO 볼륨(sponavi.db)이라도 읽기는 가능.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /srv
USER appuser

EXPOSE 8100

# curl 미포함(slim) → python urllib 원라이너로 헬스 체크. 실패 시 예외 → unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8100/api/health', timeout=3)"]

# A1 4코어 감안 워커 2(메모리 여유 충분 — 워커당 앱+mmap, 합계 수백 MB 수준).
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "2"]
