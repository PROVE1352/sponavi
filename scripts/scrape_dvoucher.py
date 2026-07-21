#!/usr/bin/env python3
"""Scrape dvoucher(장애인스포츠강좌이용권) 시설 공개조회 → 접근성 보조 소스.

공식 API(data/raw/dvoucher_facility.json)에는 접근성 필드가 없다. 그러나 공단 웹
시설검색(dvoucher.kspo.or.kr)은 시설별 **장애지원유형**과 **편의시설**을 공개한다
(robots.txt는 게시판만 차단, 시설조회는 공개). 이 스크립트가 그 보조 소스를 수집한다.
DR-4: 전부 NULL 허용 애드온 — 실패해도 API-only로 전 기능 동작.

수집(2단계):
  ① 전체 목록 스윕(무필터): 시설별 {bizrno, alsfc_sn, name, addr, phone,
     disability_types[], photo_url, intro}
  ② 편의시설 세트 멤버십: 편의시설 코드별(cvntlCd) 필터 스윕 → 해당 시설
     (bizrno, alsfc_sn) 집합 → 각 시설 amenities[] 태깅.

AJAX 계약(실사 2026-07-21):
  POST /course/memberFacilityListAjax.do — form#frm 전체 직렬화 + pageLimit + pageNo.
  페이지네이션 파라미터는 **pageNo**(pageIndex 아님). 편의시설 필터는 cvntlCd+arrCvntlCd
  둘 다 세팅. 총건수는 id="totCnt". 행: fn_goCourse('bizrno','alsfcSn').
  실측: 전체 10,011 · 휠체어대여(06) 577 · 수중리프트(09) 177.

견고성: 요청 간 1s 딜레이(예의), 재시도 3회, **페이지 단위 append 저장(jsonl)**로
중단 안전 + 재실행 시 이어받기. stdlib만 사용(외부 의존 없음).

사용:
  python scripts/scrape_dvoucher.py --scraped-at 2026-07-21 \
      --out data/raw/dvoucher_web_accessibility.json
"""
from __future__ import annotations

import argparse
import html as htmlmod
import http.cookiejar
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

BASE = "https://dvoucher.kspo.or.kr"
LIST_URL = BASE + "/course/memberFacilityList.do?menuNo=8&topMenuNo=1"
AJAX_URL = BASE + "/course/memberFacilityListAjax.do"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
SOURCE_LABEL = "dvoucher.kspo.or.kr 시설 공개조회(memberFacilityListAjax.do)"


# ---------------------------------------------------------------------------
# session
# ---------------------------------------------------------------------------
class _FormParser(HTMLParser):
    """form#frm 의 hidden/text input(name,value) 를 그대로 뽑는다."""

    def __init__(self) -> None:
        super().__init__()
        self.in_frm = False
        self.fields: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form" and (a.get("id") == "frm" or a.get("name") == "frm"):
            self.in_frm = True
        if self.in_frm and tag == "input" and a.get("name"):
            typ = (a.get("type") or "text").lower()
            if typ in ("text", "hidden", "search"):
                self.fields.append((a["name"], a.get("value", "") or ""))

    def handle_endtag(self, tag):
        if tag == "form" and self.in_frm:
            self.in_frm = False


def _options(html: str, sel_id: str) -> list[tuple[str, str]]:
    m = re.search(r'<select id="' + sel_id + r'"[^>]*>(.*?)</select>', html, re.S)
    if not m:
        return []
    return [
        (v, htmlmod.unescape(t).strip())
        for v, t in re.findall(r'<option value="([0-9]+)">([^<]*)</option>', m.group(1))
    ]


def _tot_cnt(html: str) -> int | None:
    m = re.search(r'id="totCnt"[^>]*>\s*([\d,]+)', html)
    return int(m.group(1).replace(",", "")) if m else None


class Session:
    def __init__(self, delay: float, retries: int) -> None:
        self.delay = delay
        self.retries = retries
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cj)
        )
        self.opener.addheaders = [("User-Agent", UA)]
        self.base_form: dict[str, str] = {}
        self.amenity_catalog: list[tuple[str, str]] = []
        self.disability_catalog: list[tuple[str, str]] = []
        self._last = 0.0

    def _throttle(self) -> None:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def bootstrap(self) -> int:
        """GET list page → cookies + base form fields + catalogs. Returns totCnt."""
        html = self._raw_get(LIST_URL)
        fp = _FormParser()
        fp.feed(html)
        # last-wins per name (form has no dup names of interest)
        self.base_form = {n: v for n, v in fp.fields}
        self.amenity_catalog = _options(html, "cvntlCd")
        self.disability_catalog = _options(html, "dispTyCd")
        # the list page GET returns the shell; totCnt comes from the ajax. Fetch p1.
        first = self.post(page_no=1, page_limit=10)
        tot = _tot_cnt(first)
        if not self.amenity_catalog:
            raise RuntimeError("편의시설(cvntlCd) 코드 목록을 폼에서 찾지 못했습니다")
        return tot or 0

    def _raw_get(self, url: str) -> str:
        last_err: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._throttle()
            try:
                req = urllib.request.Request(url)
                with self.opener.open(req, timeout=40) as r:
                    return r.read().decode("utf-8", "replace")
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"GET 실패({url}): {last_err}")

    def post(self, *, page_no: int, page_limit: int, cvntl: str = "") -> str:
        form = dict(self.base_form)
        form["pageLimit"] = str(page_limit)
        form["pageNo"] = str(page_no)
        if cvntl:
            form["cvntlCd"] = cvntl
            form["arrCvntlCd"] = cvntl
        body = urllib.parse.urlencode(form).encode("utf-8")
        last_err: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._throttle()
            try:
                req = urllib.request.Request(AJAX_URL, data=body)
                req.add_header(
                    "Content-Type",
                    "application/x-www-form-urlencoded; charset=UTF-8",
                )
                req.add_header("X-Requested-With", "XMLHttpRequest")
                req.add_header("Referer", LIST_URL)
                with self.opener.open(req, timeout=40) as r:
                    return r.read().decode("utf-8", "replace")
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(
            f"POST 실패(pageNo={page_no}, cvntl={cvntl!r}): {last_err}"
        )


# ---------------------------------------------------------------------------
# row parsing
# ---------------------------------------------------------------------------
_LI_RE = re.compile(r"<li>.*?</li>", re.S)
_GO_RE = re.compile(r"fn_goCourse\('([^']*)'\s*,\s*'([^']*)'\);?\">([^<]*)</a>")
_DD_RE = re.compile(r"<dd>(.*?)</dd>", re.S)
_IMG_RE = re.compile(r'<div class="fac-list-thum"><img[^>]*src="([^"]+)"')
_TAG_RE = re.compile(r"<[^>]+>")


def _text(raw: str) -> str:
    return htmlmod.unescape(_TAG_RE.sub("", raw)).strip()


def parse_facilities(page_html: str) -> list[dict]:
    """AJAX 목록 조각 → 시설 dict 리스트. dt-anchor(fn_goCourse) 있는 li만."""
    out: list[dict] = []
    for li in _LI_RE.findall(page_html):
        g = _GO_RE.search(li)
        if not g:
            continue
        bizrno, alsfc_sn, name = g.group(1).strip(), g.group(2).strip(), _text(g.group(3))
        dds = [_text(d) for d in _DD_RE.findall(li)]
        addr = phone = intro = ""
        dis_types: list[str] = []
        for i, d in enumerate(dds):
            if d.startswith("장애지원 강좌"):
                after = d.split(":", 1)[1].strip() if ":" in d else ""
                dis_types = [t.strip() for t in re.split(r"[,/]", after) if t.strip()]
            elif i == 0:
                addr = d
            elif i == 1 and re.search(r"\d", d):
                phone = d
            elif d and not d.startswith("장애지원"):
                # last non-classified dd = 소개문 (첫 두 dd/장애지원 제외)
                if i >= 2:
                    intro = d
        photo = None
        pm = _IMG_RE.search(li)
        if pm:
            src = pm.group(1)
            if "no_image" not in src and "downloadThumbFile" in src:
                photo = (BASE + src) if src.startswith("/") else src
        out.append({
            "bizrno": bizrno,
            "alsfc_sn": alsfc_sn,
            "name": name,
            "addr": addr,
            "phone": phone.lstrip("-") or None,
            "disability_types": dis_types,
            "photo_url": photo,
            "intro": (intro[:1000] or None),
        })
    return out


def parse_keys(page_html: str) -> list[tuple[str, str]]:
    """편의시설 필터 페이지 → (bizrno, alsfc_sn) 키만."""
    keys = []
    for li in _LI_RE.findall(page_html):
        g = _GO_RE.search(li)
        if g:
            keys.append((g.group(1).strip(), g.group(2).strip()))
    return keys


# ---------------------------------------------------------------------------
# progress (jsonl, resume-safe)
# ---------------------------------------------------------------------------
class Progress:
    """append-only jsonl. 재실행 시 완료 페이지를 건너뛰고 데이터는 dedup 재구성."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.facilities: dict[tuple[str, str], dict] = {}
        self.amenity_sets: dict[str, set[tuple[str, str]]] = {}
        self.done: set[tuple] = set()
        self._fh = None

    def load(self) -> None:
        if not self.path.exists():
            return
        with self.path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = rec.get("t")
                if t == "fac":
                    self.facilities[(rec["bizrno"], rec["alsfc_sn"])] = rec["f"]
                elif t == "amem":
                    self.amenity_sets.setdefault(rec["code"], set()).add(
                        (rec["bizrno"], rec["alsfc_sn"])
                    )
                elif t == "done":
                    self.done.add((rec["phase"], rec.get("code", ""), rec["page"]))

    def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = self.path.open("a", encoding="utf-8")

    def _write(self, rec: dict) -> None:
        self._fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def add_facility(self, page: int, fac: dict) -> None:
        key = (fac["bizrno"], fac["alsfc_sn"])
        self.facilities[key] = fac
        self._write({"t": "fac", "bizrno": key[0], "alsfc_sn": key[1], "f": fac})

    def add_amem(self, code: str, key: tuple[str, str]) -> None:
        self.amenity_sets.setdefault(code, set()).add(key)
        self._write({"t": "amem", "code": code, "bizrno": key[0], "alsfc_sn": key[1]})

    def mark_done(self, phase: str, page: int, code: str = "") -> None:
        self.done.add((phase, code, page))
        self._write({"t": "done", "phase": phase, "code": code, "page": page})
        self._fh.flush()

    def is_done(self, phase: str, page: int, code: str = "") -> bool:
        return (phase, code, page) in self.done

    def close(self) -> None:
        if self._fh:
            self._fh.close()


# ---------------------------------------------------------------------------
# main sweep
# ---------------------------------------------------------------------------
def run(args) -> int:
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path
    state_path = Path(args.state) if args.state else out_path.with_suffix(
        out_path.suffix + ".jsonl"
    )

    sess = Session(delay=args.delay, retries=args.retries)
    print(f"[scrape] bootstrap {LIST_URL}", flush=True)
    list_total = sess.bootstrap()
    print(
        f"[scrape] totCnt={list_total} · 편의시설코드 {len(sess.amenity_catalog)}종 "
        f"· 장애유형 {len(sess.disability_catalog)}종 · pageLimit={args.page_limit} "
        f"· delay={args.delay}s",
        flush=True,
    )
    amenity_names = dict(sess.amenity_catalog)
    disability_names = dict(sess.disability_catalog)

    prog = Progress(state_path)
    prog.load()
    if prog.facilities or prog.done:
        print(
            f"[scrape] 이어받기: 시설 {len(prog.facilities)}건 · "
            f"완료 페이지 {len(prog.done)}개 (state={state_path.name})",
            flush=True,
        )
    prog.open()

    pl = args.page_limit

    # ---- phase 1: 전체 목록 스윕 ----
    list_pages = math.ceil(list_total / pl) if list_total else 0
    if args.max_list_pages:
        list_pages = min(list_pages, args.max_list_pages)
    for p in range(1, list_pages + 1):
        if prog.is_done("list", p):
            continue
        html = sess.post(page_no=p, page_limit=pl)
        facs = parse_facilities(html)
        for f in facs:
            prog.add_facility(p, f)
        prog.mark_done("list", p)
        if p % 10 == 0 or p == list_pages:
            print(
                f"[scrape] 목록 {p}/{list_pages}p · 누적 시설 {len(prog.facilities)}",
                flush=True,
            )

    # ---- phase 2: 편의시설 세트 멤버십 ----
    amenity_counts: dict[str, int] = {}
    for code, name in sess.amenity_catalog:
        first = sess.post(page_no=1, page_limit=pl, cvntl=code)
        cnt = _tot_cnt(first) or 0
        amenity_counts[code] = cnt
        pages = math.ceil(cnt / pl) if cnt else 0
        # page 1 을 재활용 저장
        if not prog.is_done("amenity", 1, code):
            for key in parse_keys(first):
                prog.add_amem(code, key)
            prog.mark_done("amenity", 1, code)
        for p in range(2, pages + 1):
            if prog.is_done("amenity", p, code):
                continue
            html = sess.post(page_no=p, page_limit=pl, cvntl=code)
            for key in parse_keys(html):
                prog.add_amem(code, key)
            prog.mark_done("amenity", p, code)
        got = len(prog.amenity_sets.get(code, set()))
        print(
            f"[scrape] 편의시설 {code}({name}) totCnt={cnt} 수집={got}"
            f"{'  ⚠불일치' if got != cnt else ''}",
            flush=True,
        )

    prog.close()

    # ---- assemble final json ----
    facilities = []
    for key, f in prog.facilities.items():
        ams = [
            {"code": c, "name": amenity_names.get(c, c)}
            for c, _ in sess.amenity_catalog
            if key in prog.amenity_sets.get(c, set())
        ]
        facilities.append({**f, "amenities": ams})
    facilities.sort(key=lambda x: (x["bizrno"], x["alsfc_sn"]))

    scraped_at = args.scraped_at or date.today().isoformat()
    doc = {
        "scraped_at": scraped_at,
        "source": SOURCE_LABEL,
        "source_label_ko": "공단 웹서비스 공개 조회(보조)",
        "list_total": list_total,
        "collected": len(facilities),
        "amenity_catalog": [{"code": c, "name": n} for c, n in sess.amenity_catalog],
        "disability_catalog": [
            {"code": c, "name": n} for c, n in sess.disability_catalog
        ],
        "amenity_counts": amenity_counts,
        "facilities": facilities,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- verification ----
    n_amen = sum(1 for f in facilities if f["amenities"])
    n_dis = sum(1 for f in facilities if f["disability_types"])
    print("\n[scrape] === 검증 ===", flush=True)
    print(f"  목록 총건수(totCnt) = {list_total}", flush=True)
    print(f"  수집 시설(고유 bizrno+alsfc_sn) = {len(facilities)}", flush=True)
    match = "일치" if len(facilities) == list_total else "차이(웹 중복키/동시변경 가능)"
    print(f"  총건수 대비 = {match}", flush=True)
    print(f"  편의시설 태그 보유 시설 = {n_amen}", flush=True)
    print(f"  장애지원유형 보유 시설 = {n_dis}", flush=True)
    for code, name in sess.amenity_catalog:
        print(
            f"    - {code} {name}: totCnt={amenity_counts.get(code,0)} "
            f"수집={len(prog.amenity_sets.get(code,set()))}",
            flush=True,
        )
    print(f"\n[scrape] 저장 완료: {out_path}", flush=True)
    print(f"[scrape] 진행 로그(jsonl): {state_path}", flush=True)
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="dvoucher 접근성 보조 소스 스크레이퍼")
    ap.add_argument("--out", default="data/raw/dvoucher_web_accessibility.json")
    ap.add_argument("--state", default=None, help="진행 jsonl 경로(기본 <out>.jsonl)")
    ap.add_argument("--scraped-at", default=None, help="확인일 YYYY-MM-DD (미지정=오늘)")
    ap.add_argument("--page-limit", type=int, default=100)
    ap.add_argument("--delay", type=float, default=1.0, help="요청 간 최소 간격(초)")
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--max-list-pages", type=int, default=0, help="테스트용 상한(0=무제한)")
    args = ap.parse_args()
    try:
        sys.exit(run(args))
    except KeyboardInterrupt:
        print("\n[scrape] 중단됨 — 재실행하면 jsonl 에서 이어받습니다.", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
