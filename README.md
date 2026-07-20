# 스포내비 (SpoNavi)

2026 KSPO 공공데이터 활용 경진대회 MVP — 스포츠 복지 접근 내비게이터.
조건 입력 → 자격 판정 → (미달 시) 대체경로로 무료/저가 스포츠 자원 연결. 공급공백은 정직하게 신호.

- 계약: `docs/SPEC.md`, `docs/API.md` (변경 시 서버·웹 합의)
- 실행(데모 모드, 키 불필요): `cd server && uvicorn app.main:app` + `cd web && npm run dev`
- 실데이터 전환: `DATA_GO_KR_KEY=... python scripts/fetch_data.py`
- 판결 제약(아이디어 법정 1심 PIVOT) 준수 — SPEC §0
