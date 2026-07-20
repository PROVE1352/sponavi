#!/usr/bin/env python3
"""SpoNavi real-data ETL (key-injected). SPEC §2.

Reads DATA_GO_KR_KEY and pulls five public datasets, normalizing each into the
SAME JSON schema as data/fixtures/*.json, written to data/raw/:

  facilities.json  <- 15107783(이용권 등록시설)   -> source "voucher"
                      15107874(장애인 등록시설)   -> source "dvoucher"
                      15113986(전국 공공체육시설) -> source "public"  (faci_lat/faci_lot)
  courses.json     <- 15107784(이용권 등록강좌)   -> voucher courses
                      15117341(장애인 등록강좌)   -> dvoucher courses

Facilities from the voucher/dvoucher datasets have NO coordinates, so they are
geocoded from `addr`: Kakao address search when KAKAO_REST_KEY is set, otherwise
the sigungu centroid fallback (data/sigungu_centroids.json).

NOTE: This is a key-injected job and is NOT run here (no key available). It is
written to code-review completeness. data.go.kr column names differ per dataset
and per revision, so each mapper tries a list of candidate keys and is easy to
correct against the dataset's spec page. Exact endpoint paths for the odcloud/
apis.data.go.kr gateways should be confirmed on data.go.kr before first run
(marked ENDPOINT below).

Usage:
  DATA_GO_KR_KEY=... [KAKAO_REST_KEY=...] python scripts/fetch_data.py
  DATA_GO_KR_KEY=... python scripts/fetch_data.py --only 15113986   # one source
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Optional
from urllib import error as urlerror
from urllib import parse, request

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"

PER_PAGE = 500
MAX_PAGES = 200            # hard stop guard
RETRY = 5
BACKOFF_SEC = 2.0
TIMEOUT_SEC = 60  # B551014 게이트웨이가 큰 페이지에서 수십 초 걸리는 경우 실측됨

# Seoul pilot filter (SPEC §1): keep only 서울 25개 구.
SEOUL_PREFIX = "11"


# ---------------------------------------------------------------------------
# helpers: filesystem / json
# ---------------------------------------------------------------------------
def _load_centroids() -> dict[str, dict]:
    with (DATA_DIR / "sigungu_centroids.json").open(encoding="utf-8") as fh:
        data = json.load(fh)
    return {c["nm"]: c for c in data.get("centroids", [])}


def _pick(row: dict, *candidates: str, default: Any = None) -> Any:
    """First present, non-empty candidate key (case-insensitive)."""
    lower = {k.lower(): v for k, v in row.items()}
    for c in candidates:
        v = lower.get(c.lower())
        if v not in (None, "", " "):
            return v
    return default


def _to_float(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if f != 0.0 else None
    except (TypeError, ValueError):
        return None


def _sports(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(s).strip() for s in raw if str(s).strip()]
    # comma/slash/space separated
    parts = str(raw).replace("/", ",").replace(" ", ",").split(",")
    return [p.strip() for p in parts if p.strip()]


# ---------------------------------------------------------------------------
# http: paginated data.go.kr fetch (odcloud/apis JSON envelope tolerant)
# ---------------------------------------------------------------------------
def _http_get_json(url: str) -> dict:
    last: Optional[Exception] = None
    for attempt in range(1, RETRY + 1):
        try:
            req = request.Request(url, headers={"Accept": "application/json"})
            with request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urlerror.URLError, urlerror.HTTPError, json.JSONDecodeError, TimeoutError, OSError) as exc:
            # TimeoutError: py3.10+에서 socket timeout이 URLError 밖으로 새는 실측 케이스
            last = exc
            if attempt < RETRY:
                time.sleep(BACKOFF_SEC * attempt)
    raise RuntimeError(f"요청 실패({RETRY}회): {url}\n  원인: {last}")


def _extract_items(payload: dict) -> tuple[list[dict], Optional[int]]:
    """Return (items, total_count) across common data.go.kr envelopes."""
    # odcloud style: {"data":[...], "totalCount":N, "currentCount":..}
    if isinstance(payload.get("data"), list):
        return payload["data"], payload.get("totalCount")
    # standard XML->JSON style: {"response":{"body":{"items":{"item":[...]},"totalCount":N}}}
    body = (payload.get("response") or {}).get("body") or {}
    items = body.get("items")
    total = body.get("totalCount")
    if isinstance(items, dict):
        item = items.get("item", [])
        return (item if isinstance(item, list) else [item]), total
    if isinstance(items, list):
        return items, total
    return [], None


def fetch_all(endpoint: str, service_key: str, extra: Optional[dict] = None) -> list[dict]:
    """Page through an endpoint until exhausted. `service_key` is the decoded key;
    it is URL-encoded here. Supports both page/perPage and pageNo/numOfRows params."""
    collected: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        params = {
            "serviceKey": service_key,
            "page": page,
            "perPage": PER_PAGE,
            "pageNo": page,
            "numOfRows": PER_PAGE,
            "type": "json",
            "returnType": "JSON",
            "resultType": "json",  # B551014 게이트웨이 실검증 파라미터 (docs/ENDPOINTS.md)
        }
        if extra:
            params.update(extra)
        url = f"{endpoint}?{parse.urlencode(params, doseq=True)}"
        payload = _http_get_json(url)
        items, total = _extract_items(payload)
        if not items:
            break
        collected.extend(items)
        if total is not None and len(collected) >= int(total):
            break
        if len(items) < PER_PAGE:
            break
        time.sleep(0.2)  # be polite
    return collected


# ---------------------------------------------------------------------------
# geocoding
# ---------------------------------------------------------------------------
class Geocoder:
    def __init__(self, centroids: dict[str, dict]):
        self.kakao_key = os.environ.get("KAKAO_REST_KEY")
        self.centroids = centroids
        self.hits = 0
        self.fallbacks = 0

    def _kakao(self, addr: str) -> Optional[tuple[float, float]]:
        url = "https://dapi.kakao.com/v2/local/search/address.json?" + parse.urlencode(
            {"query": addr}
        )
        req = request.Request(url, headers={"Authorization": f"KakaoAK {self.kakao_key}"})
        try:
            with request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                docs = json.loads(resp.read().decode("utf-8")).get("documents", [])
            if docs:
                return float(docs[0]["y"]), float(docs[0]["x"])
        except Exception:  # noqa: BLE001 - geocoding is best-effort
            return None
        return None

    def locate(self, addr: str, sigungu_nm: str) -> tuple[Optional[float], Optional[float]]:
        if self.kakao_key and addr:
            got = self._kakao(addr)
            if got:
                self.hits += 1
                return got
        c = self.centroids.get(sigungu_nm)
        if c:
            self.fallbacks += 1
            return c["lat"], c["lon"]
        return None, None


# ---------------------------------------------------------------------------
# mappers: raw row -> fixtures schema
# ---------------------------------------------------------------------------
def _in_seoul(sigungu_cd: Optional[str]) -> bool:
    return bool(sigungu_cd) and str(sigungu_cd).startswith(SEOUL_PREFIX)


def map_voucher_facility(row: dict, source: str, geocoder: Geocoder, idx: int) -> Optional[dict]:
    """15107783 / 15107874: 이용권/장애인 등록시설 (좌표 없음 -> geocode)."""
    sigungu_cd = str(_pick(row, "cd", "sigunguCd", "signguCd", "ctprvnCd", "sido_signgu_cd", default="") or "")
    sigungu_nm = _pick(row, "sigunguNm", "signguNm", "cbhi_nm", "sigungu", default="") or ""
    addr = _pick(row, "addr", "roadNmAddr", "rdnmadr", "adres", "lctnRoadNmAddr", default="") or ""
    if not _in_seoul(sigungu_cd):
        return None
    lat, lon = geocoder.locate(addr, sigungu_nm)
    prefix = "V" if source == "voucher" else "D"
    return {
        "id": f"{prefix}{idx:04d}",
        "source": source,
        "name": _pick(row, "faciNm", "fcltyNm", "name", "bplcNm", default="") or "",
        "sigungu_cd": sigungu_cd,
        "sigungu_nm": sigungu_nm,
        "addr": addr,
        "lat": lat,
        "lon": lon,
        "sports": _sports(_pick(row, "itemNm", "sportNm", "eventNm", "items")),
        "disability_support": (True if source == "dvoucher" else None),
        "phone": _pick(row, "telNo", "tel", "phone", "rprsTelno", default="") or "",
    }


def map_public_facility(row: dict, idx: int) -> Optional[dict]:
    """15113986: 전국 공공체육시설 (faci_lat/faci_lot 좌표 존재)."""
    sigungu_cd = str(_pick(row, "cd", "signguCd", "sigunguCd", "ctprvnCd", default="") or "")
    sigungu_nm = _pick(row, "signguNm", "sigunguNm", "cpb_nm", default="") or ""
    if not _in_seoul(sigungu_cd):
        return None
    lat = _to_float(_pick(row, "faciLat", "faci_lat", "la", "lat"))
    lon = _to_float(_pick(row, "faciLot", "faci_lot", "lo", "lon", "lng"))
    return {
        "id": f"P{idx:04d}",
        "source": "public",
        "name": _pick(row, "faciNm", "fcltyNm", "name", default="") or "",
        "sigungu_cd": sigungu_cd,
        "sigungu_nm": sigungu_nm,
        "addr": _pick(row, "faciRoadAddr", "rdnmadr", "addr", "faciAddr", default="") or "",
        "lat": lat,
        "lon": lon,
        "sports": _sports(_pick(row, "ftypeNm", "itemNm", "sportNm", "faciGbNm")),
        # public facilities: disability_support unknown unless a barrier-free flag exists
        "disability_support": _bool_or_none(_pick(row, "cvltGbnCd", "disabledConvFacYn", "bfYn")),
        "phone": _pick(row, "faciTel", "tel", "telNo", default="") or "",
    }


def _bool_or_none(v: Any) -> Optional[bool]:
    if v in (None, "", " "):
        return None
    s = str(v).strip().upper()
    if s in ("Y", "1", "TRUE", "T", "있음"):
        return True
    if s in ("N", "0", "FALSE", "F", "없음"):
        return False
    return None


def map_course(row: dict, facility_index: dict[str, str], idx: int, target_default: str) -> Optional[dict]:
    """15107784 / 15117341: 등록강좌. facility_index maps raw facility id/name->our id."""
    raw_fac = str(_pick(row, "faciCd", "fcltyCd", "faciNm", "fcltyNm", default="") or "")
    facility_id = facility_index.get(raw_fac)
    if not facility_id:
        return None  # course whose facility was filtered out (non-Seoul) or unmatched
    return {
        "id": f"C{idx:05d}",
        "facility_id": facility_id,
        "name": _pick(row, "lctreNm", "courseNm", "name", default="") or "",
        "sport": _pick(row, "itemNm", "sportNm", "eventNm", default="") or "",
        "weekday_mask": _weekday_mask(_pick(row, "lctreDayNm", "weekday", "dayNm")),
        "start": _pick(row, "lctreBgngHr", "startTime", "start", default="") or "",
        "end": _pick(row, "lctreEndHr", "endTime", "end", default="") or "",
        "fee_month": _to_int(_pick(row, "lctreCost", "fee", "amount", "feeMonth")),
        "target": _pick(row, "trgtNm", "target", default=target_default) or target_default,
    }


def _to_int(v: Any) -> Optional[int]:
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return None


_DAYS = ["월", "화", "수", "목", "금", "토", "일"]


def _weekday_mask(raw: Any) -> str:
    if not raw:
        return "0000000"
    s = str(raw)
    return "".join("1" if d in s else "0" for d in _DAYS)


# ---------------------------------------------------------------------------
# source registry.  ENDPOINT: confirm exact gateway path on data.go.kr per id.
# ---------------------------------------------------------------------------
# 2026-07-20 실호출 검증 완료 — docs/ENDPOINTS.md (오퍼레이션 대소문자 서비스마다 다름 주의)
SOURCES = {
    "15107783": {"kind": "facility", "source": "voucher",  "endpoint": "https://apis.data.go.kr/B551014/SRVC_OD_API_FACIL_MNG/todz_api_facil_mng_i",                "name": "스포츠강좌이용권 등록시설"},
    "15107874": {"kind": "facility", "source": "dvoucher", "endpoint": "https://apis.data.go.kr/B551014/SRVC_OD_API_FACIL_MNG_DVOUCHER/TODZ_API_MNG_DVOUCHER_I",   "name": "장애인스포츠강좌이용권 등록시설"},
    "15113986": {"kind": "public",   "source": "public",   "endpoint": "https://apis.data.go.kr/B551014/SRVC_API_SFMS_FACI/TODZ_API_SFMS_FACI",                    "name": "전국 공공체육시설"},
    "15107784": {"kind": "course",   "source": "voucher",  "endpoint": "https://apis.data.go.kr/B551014/SRVC_OD_API_FACIL_COURSE/todz_api_facil_course_i",         "name": "스포츠강좌이용권 등록강좌"},
    "15117341": {"kind": "course",   "source": "dvoucher", "endpoint": "https://apis.data.go.kr/B551014/SRVC_DVOUCHER_FACI_COURSE/TODZ_DVOUCHER_FACI_COURSE",      "name": "장애인스포츠강좌이용권 등록강좌"},
}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def _die_no_key() -> None:
    sys.stderr.write(
        "\n[스포내비 fetch_data] 환경변수 DATA_GO_KR_KEY 가 없습니다.\n"
        "실데이터를 받으려면 공공데이터포털(data.go.kr)에서 아래 5개 API 활용신청 후\n"
        "발급받은 '일반 인증키(Decoding)'를 환경변수로 주입하세요:\n"
        "  - 15107783 스포츠강좌이용권 등록시설\n"
        "  - 15107784 스포츠강좌이용권 등록강좌\n"
        "  - 15107874 장애인스포츠강좌이용권 등록시설\n"
        "  - 15117341 장애인스포츠강좌이용권 등록강좌\n"
        "  - 15113986 전국 공공체육시설\n\n"
        "실행 예:\n"
        "  DATA_GO_KR_KEY=발급키 [KAKAO_REST_KEY=카카오키] python scripts/fetch_data.py\n\n"
        "키가 없어도 앱은 data/fixtures/*.json 으로 완전히 동작합니다(데모 모드).\n\n"
    )
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description="SpoNavi 실데이터 ETL (키 주입형)")
    ap.add_argument("--only", help="특정 data.go.kr id 하나만 처리")
    args = ap.parse_args()

    service_key = os.environ.get("DATA_GO_KR_KEY")
    if not service_key:
        _die_no_key()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    geocoder = Geocoder(_load_centroids())

    ids = [args.only] if args.only else list(SOURCES.keys())
    facilities: list[dict] = []
    courses: list[dict] = []
    # raw facility id/name -> our synthetic facility id, per voucher-kind, for course join
    facility_index: dict[str, str] = {}

    # facilities first (so courses can join)
    fac_counter = 0
    for sid in ids:
        spec = SOURCES.get(sid)
        if not spec or spec["kind"] not in ("facility", "public"):
            continue
        print(f"[fetch] {sid} {spec['name']} ...", file=sys.stderr)
        rows = fetch_all(spec["endpoint"], service_key)
        print(f"        {len(rows)}행 수신", file=sys.stderr)
        for row in rows:
            fac_counter += 1
            if spec["kind"] == "public":
                rec = map_public_facility(row, fac_counter)
            else:
                rec = map_voucher_facility(row, spec["source"], geocoder, fac_counter)
            if not rec:
                continue
            facilities.append(rec)
            raw_key = str(_pick(row, "faciCd", "fcltyCd", "faciNm", "fcltyNm", default=rec["id"]))
            facility_index[raw_key] = rec["id"]

    # courses
    course_counter = 0
    for sid in ids:
        spec = SOURCES.get(sid)
        if not spec or spec["kind"] != "course":
            continue
        print(f"[fetch] {sid} {spec['name']} ...", file=sys.stderr)
        rows = fetch_all(spec["endpoint"], service_key)
        print(f"        {len(rows)}행 수신", file=sys.stderr)
        target_default = "장애인" if spec["source"] == "dvoucher" else "전연령"
        for row in rows:
            course_counter += 1
            rec = map_course(row, facility_index, course_counter, target_default)
            if rec:
                courses.append(rec)

    # write outputs (fixtures schema + provenance header)
    if any(SOURCES[i]["kind"] in ("facility", "public") for i in ids):
        out = {
            "_source": "실데이터 ETL 산출물 (scripts/fetch_data.py). data.go.kr 15107783/15107874/15113986.",
            "_geocode": f"kakao_hits={geocoder.hits}, centroid_fallbacks={geocoder.fallbacks}",
            "facilities": facilities,
        }
        (RAW_DIR / "facilities.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[write] data/raw/facilities.json ({len(facilities)}건)", file=sys.stderr)

    if any(SOURCES[i]["kind"] == "course" for i in ids):
        out = {
            "_source": "실데이터 ETL 산출물 (scripts/fetch_data.py). data.go.kr 15107784/15117341.",
            "courses": courses,
        }
        (RAW_DIR / "courses.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[write] data/raw/courses.json ({len(courses)}건)", file=sys.stderr)

    print(
        f"[done] 시설 {len(facilities)} · 강좌 {len(courses)} · "
        f"지오코딩(kakao {geocoder.hits}/폴백 {geocoder.fallbacks})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
