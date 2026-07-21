#!/usr/bin/env python3
"""KSPO 운동영상 카탈로그 수집 → data/raw/videos_*.json + sponavi.db `videos` 테이블.

FITNESS_GRAPH.md §1·§4-3 의 "영상 카탈로그 적재" 단계. 운동영상 패키지 서비스
(SRVC_TODZ_VDO_PKG) 의 오퍼레이션 7종을 전량 수집한다(2026-07 실호출 검증):

  op                          totalCount(실측)  비고
  TODZ_VDO_FTNS_CERT_I            426   인증측정법 (ftns_fctr_nm=체력인증)
  TODZ_VDO_TRNG_VIDEO_I        1,668   처방동영상 (trng_plc_nm 장소)
  TODZ_VDO_MSCL_TRNG_I           671   근골격계 재활 (trng_step_nm 단계)
  TODZ_VDO_STD_FTNS_I          1,827   생애주기 표준 (trng_week_nm 주차)
  TODZ_VDO_ROUTINE_I           2,150   목적별 루틴 (trng_aim_nm: 낙상/요통/골다공증…)
  TODZ_VDO_TRNG_GUIDE_I        8,303   운동처방가이드 (ftns_fctr_nm·ftns_lvl_nm·
                                        aggrp_nm·trng_mscl_part·trng_plc_nm·tool_nm)
  TODZ_VDO_VIEW_ALL_LIST_I    15,045   통합 = 위 6종의 합집합(oper_nm 태그, 공통필드만)

공통 필드: trng_nm, vdo_ttl_nm, file_url, img_file_url, vdo_len, vdo_desc, aggrp_nm.
※ file_url 은 베이스 디렉터리('http://openapi.kspo.or.kr/web/video/') 뿐이라
  재생 URL = file_url + file_nm 로 조립해 저장한다(img_file_url 은 이미 폴더 포함).

베이스: https://apis.data.go.kr/B551014/SRVC_TODZ_VDO_PKG/{op}
파라미터: serviceKey(.env DATA_GO_KR_KEY, Decoding 89자 — urlencode 로 %인코딩),
          pageNo, numOfRows, resultType=json. 개발계정 일 10,000건.

멱등(idempotent): 각 op 를 data/raw/videos_<op>.json 으로 저장(중단 안전, --skip-existing
로 재사용) 후, videos 테이블을 매 실행 DROP→재생성해 raw 전량을 재적재한다.
(이 스크립트는 videos 테이블만 소유; 다른 테이블은 건드리지 않는다.)

Usage:
  DATA_GO_KR_KEY=... python scripts/fetch_videos.py               # 전량 수집+적재
  python scripts/fetch_videos.py --skip-existing                  # raw 있으면 재다운로드 생략
  python scripts/fetch_videos.py --load-only                      # 네트워크 없이 raw→DB 적재만
  python scripts/fetch_videos.py --only TODZ_VDO_ROUTINE_I        # 한 op 만
  python scripts/fetch_videos.py --rows 500                       # 페이지 크기(기본 300)
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
RAW = REPO_ROOT / "data" / "raw"
DB_PATH = REPO_ROOT / "data" / "sponavi.db"

BASE = "https://apis.data.go.kr/B551014/SRVC_TODZ_VDO_PKG/"
VIDEO_BASE = "http://openapi.kspo.or.kr/web/video/"  # file_url 가 빈 경우 조립 폴백

# op -> 실측 totalCount (수집 완주 검증용)
OPS: dict[str, int] = {
    "TODZ_VDO_FTNS_CERT_I": 426,
    "TODZ_VDO_TRNG_VIDEO_I": 1668,
    "TODZ_VDO_MSCL_TRNG_I": 671,
    "TODZ_VDO_STD_FTNS_I": 1827,
    "TODZ_VDO_ROUTINE_I": 2150,
    "TODZ_VDO_TRNG_GUIDE_I": 8303,
    "TODZ_VDO_VIEW_ALL_LIST_I": 15045,
}

DEFAULT_ROWS = 300           # 실측: 300~500 은 <3s, 1000 은 ~120s(느림) → 300 기본
TIMEOUT = 120                # 게이트웨이가 큰 페이지에서 느림(실측)
RETRY = 6
CTX = ssl.create_default_context()


# ---------------------------------------------------------------------------
# key + http
# ---------------------------------------------------------------------------
def _load_key() -> Optional[str]:
    env = os.environ.get("DATA_GO_KR_KEY")
    if env:
        return env.strip()
    envfile = REPO_ROOT / ".env"
    if envfile.exists():
        for line in envfile.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATA_GO_KR_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def _get(url: str) -> dict:
    last: Optional[Exception] = None
    for attempt in range(1, RETRY + 1):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                OSError, json.JSONDecodeError) as e:
            last = e
            if attempt < RETRY:
                time.sleep(2.0 * attempt)
    raise RuntimeError(f"{RETRY}회 요청 실패: {last}\n  url={url.split('serviceKey=')[0]}")


def _items(payload: dict) -> tuple[list[dict], Optional[int]]:
    """{'response':{'body':{'items':{'item':[...]},'totalCount':N}}} 봉투 파싱."""
    header = (payload.get("response") or {}).get("header") or {}
    code = header.get("resultCode")
    if code not in (None, "00", "0", "INFO-0", "INFO-00"):
        raise RuntimeError(f"API resultCode={code} msg={header.get('resultMsg')}")
    body = (payload.get("response") or {}).get("body") or {}
    items = body.get("items")
    total = body.get("totalCount")
    total = int(total) if total not in (None, "") else None
    if isinstance(items, dict):
        it = items.get("item", [])
        return ([it] if isinstance(it, dict) else it), total
    if isinstance(items, list):
        return items, total
    return [], total


def fetch_op(op: str, key: str, rows: int) -> list[dict]:
    out: list[dict] = []
    page = 1
    total: Optional[int] = None
    while True:
        url = BASE + op + "?" + urllib.parse.urlencode({
            "serviceKey": key, "pageNo": page, "numOfRows": rows, "resultType": "json",
        })
        batch, total = _items(_get(url))
        if not batch:
            break
        out.extend(batch)
        if page == 1 or page % 10 == 0:
            print(f"    [{op}] page {page} · 누적 {len(out)}/{total}", file=sys.stderr, flush=True)
        if total is not None and len(out) >= total:
            break
        if len(batch) < rows:
            break
        page += 1
        time.sleep(0.15)
    return out


# ---------------------------------------------------------------------------
# normalize + db
# ---------------------------------------------------------------------------
def _clean(v) -> str:
    return str(v).strip() if v not in (None, "") else ""


def _video_url(row: dict) -> str:
    """재생 URL = file_url(베이스 디렉터리) + file_nm. file_url 이 이미 파일까지면 그대로."""
    fu = _clean(row.get("file_url"))
    fn = _clean(row.get("file_nm"))
    if fu and fn and fu.endswith("/"):
        return fu + fn
    if fu and fn and not fu.lower().endswith((".mp4", ".mov", ".webm")):
        return fu.rstrip("/") + "/" + fn
    if fu:
        return fu
    return (VIDEO_BASE + fn) if fn else ""


VIDEOS_SCHEMA = """
DROP TABLE IF EXISTS videos;
CREATE TABLE videos (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    op       TEXT,    -- 소스 오퍼레이션 (TODZ_VDO_*)
    oper_nm  TEXT,    -- VIEW_ALL 통합목록의 원 오퍼레이션 한글명(있을 때)
    trng_nm  TEXT,    -- 운동/측정 명 (Exercise canonical)
    title    TEXT,    -- vdo_ttl_nm 영상 제목
    file_url TEXT,    -- 재생 URL (file_url+file_nm 조립)
    img_url  TEXT,    -- img_file_url (썸네일 폴더)
    len      TEXT,    -- vdo_len (초)
    descr    TEXT,    -- vdo_desc 설명
    aggrp    TEXT,    -- aggrp_nm 연령군 (유아/유소년/청소년/성인/어르신/공통)
    factor   TEXT,    -- ftns_fctr_nm 체력요인 (근력/근지구력, 심폐지구력, …)
    level    TEXT,    -- ftns_lvl_nm 수준
    place    TEXT,    -- trng_plc_nm 장소
    tool     TEXT,    -- tool_nm 도구
    aim      TEXT     -- trng_aim_nm 목적(ROUTINE)
);
CREATE INDEX idx_videos_op     ON videos(op);
CREATE INDEX idx_videos_trng   ON videos(trng_nm);
CREATE INDEX idx_videos_factor ON videos(factor);
CREATE INDEX idx_videos_aim    ON videos(aim);
CREATE INDEX idx_videos_aggrp  ON videos(aggrp);
"""


def load_videos(conn: sqlite3.Connection, raw_by_op: dict[str, list[dict]]) -> dict[str, int]:
    """videos 테이블을 재생성하고 raw 전량 적재. op별 적재행수 반환."""
    conn.executescript(VIDEOS_SCHEMA)
    counts: dict[str, int] = {}
    for op, rows in raw_by_op.items():
        n = 0
        for row in rows:
            conn.execute(
                "INSERT INTO videos (op, oper_nm, trng_nm, title, file_url, img_url, "
                " len, descr, aggrp, factor, level, place, tool, aim) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    op,
                    _clean(row.get("oper_nm")) or None,
                    _clean(row.get("trng_nm")),
                    _clean(row.get("vdo_ttl_nm")),
                    _video_url(row),
                    _clean(row.get("img_file_url")),
                    _clean(row.get("vdo_len")),
                    _clean(row.get("vdo_desc")),
                    _clean(row.get("aggrp_nm")),
                    _clean(row.get("ftns_fctr_nm")),
                    _clean(row.get("ftns_lvl_nm")),
                    _clean(row.get("trng_plc_nm")),
                    _clean(row.get("tool_nm")),
                    _clean(row.get("trng_aim_nm")),
                ),
            )
            n += 1
        counts[op] = n
    conn.commit()
    return counts


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def _raw_path(op: str) -> Path:
    return RAW / f"videos_{op}.json"


def main() -> None:
    ap = argparse.ArgumentParser(description="KSPO 운동영상 카탈로그 수집·적재")
    ap.add_argument("--only", help="특정 오퍼레이션 하나만")
    ap.add_argument("--rows", type=int, default=DEFAULT_ROWS, help="페이지당 행수(기본 300)")
    ap.add_argument("--skip-existing", action="store_true",
                    help="data/raw/videos_<op>.json 있으면 재다운로드 생략")
    ap.add_argument("--load-only", action="store_true",
                    help="네트워크 없이 기존 raw → DB 적재만")
    ap.add_argument("--db", default=str(DB_PATH))
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    ops = [args.only] if args.only else list(OPS.keys())
    for op in ops:
        if op not in OPS:
            sys.exit(f"알 수 없는 오퍼레이션: {op} (가능: {', '.join(OPS)})")

    # ---- fetch phase ----
    if not args.load_only:
        key = _load_key()
        if not key:
            sys.exit(
                "\n[fetch_videos] DATA_GO_KR_KEY 없음.\n"
                "  공공데이터포털 운동영상 API 활용신청 후 .env 의 DATA_GO_KR_KEY(Decoding) 설정,\n"
                "  또는 이미 받아둔 raw 가 있으면 --load-only 로 적재만 하세요.\n"
            )
        t0 = time.time()
        for op in ops:
            dest = _raw_path(op)
            if args.skip_existing and dest.exists():
                print(f"[skip] {op} (raw 존재)", file=sys.stderr)
                continue
            print(f"[fetch] {op} (예상 {OPS[op]}행) ...", file=sys.stderr, flush=True)
            rows = fetch_op(op, key, args.rows)
            dest.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
            flag = "" if len(rows) >= OPS[op] else f"  ⚠ 예상 {OPS[op]} 미달"
            print(f"[done] {op}: {len(rows)}행 → {dest.name} "
                  f"({time.time()-t0:.0f}s 누적){flag}", file=sys.stderr, flush=True)

    # ---- load phase (raw → DB, videos 테이블 재생성) ----
    raw_by_op: dict[str, list[dict]] = {}
    for op in ops:
        p = _raw_path(op)
        if not p.exists():
            print(f"[warn] {p.name} 없음 → 적재 제외", file=sys.stderr)
            continue
        raw_by_op[op] = json.loads(p.read_text(encoding="utf-8"))

    if not raw_by_op:
        sys.exit("[fetch_videos] 적재할 raw 가 없습니다.")

    # --only 일 때는 그 op 만 갈아끼우면 다른 op 가 사라지므로, 전체 raw 를 함께 적재
    if args.only:
        for op in OPS:
            if op in raw_by_op:
                continue
            p = _raw_path(op)
            if p.exists():
                raw_by_op[op] = json.loads(p.read_text(encoding="utf-8"))

    conn = sqlite3.connect(args.db)
    try:
        counts = load_videos(conn, raw_by_op)
        total = conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
        distinct_trng = conn.execute(
            "SELECT COUNT(DISTINCT trng_nm) FROM videos WHERE trng_nm<>''"
        ).fetchone()[0]
    finally:
        conn.close()

    print("\n[fetch_videos] videos 테이블 적재 완료")
    for op in OPS:
        if op in counts:
            exp = OPS[op]
            ok = "OK" if counts[op] >= exp else f"⚠<{exp}"
            print(f"  {op:26s} {counts[op]:6d}행  (예상 {exp}, {ok})")
    print(f"  ─ 총 {total}행 적재 · distinct trng_nm(Exercise 후보) {distinct_trng}종")


if __name__ == "__main__":
    main()
