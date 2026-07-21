# SpoNavi 단일 컨테이너: FastAPI(API) + web/dist(정적) — ARCHITECTURE §7
FROM python:3.12-slim

WORKDIR /srv/server
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 리포 레이아웃 재현 (store.py의 REPO_ROOT 상대 해석과 일치)
COPY server/app ./app
COPY data /srv/data
COPY web/dist /srv/web/dist

EXPOSE 8100
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8100"]
