#!/usr/bin/env python3
"""기존 data/sponavi.db 를 제자리에서 지역 코드 정규화한다(전체 재빌드 없이).

`scripts/build_db.py` 의 신규 빌드 경로와 **같은 결과**가 나오도록 같은 표
(`server/app/region.py`)를 쓴다. 하는 일:

  ① sigungu_alias 표 생성·적재 — 구 시군구코드 → 현행 코드(마스터에서 도출)
  ② facilities.sigungu_cd/sido_cd 재코딩 (29·46→12, 42→51, 45→52)
  ③ sigungu_cd IS NULL 행 채우기 — 개칭 별칭(인천 남구→미추홀구) → 주소 앞 2토큰
     → 시군구가 1곳뿐인 시도. 판단 재료는 저장된 (sido_cd, sigungu_nm, addr) 뿐.
  ④ sigungu 마스터에서 구 코드 행 제거
  ⑤ 시군구 중심좌표 재계산(공공 실좌표 평균 + 서울 시드) → sigungu 좌표 갱신 +
     centroid 폴백 좌표를 쓰던 시설 좌표 재적용

Idempotent: 여러 번 실행해도 같은 결과.

정합 증명(선례: 커밋 a261f47 "마이그레이션=재빌드 정합 증명"):
    python scripts/build_db.py --out /tmp/rebuild.db
    python scripts/migrate_region_codes.py --db data/sponavi.db
    python scripts/migrate_region_codes.py --db data/sponavi.db --verify-against /tmp/rebuild.db
→ 시군구별·source별 시설 카운트가 전부 일치해야 종료코드 0.

재빌드와 **의도적으로 다른 곳 하나**: `coord_source='geocoded'` 행(카카오 지오코딩
실좌표, scripts/geocode_demo.py)은 원천 raw 에 없어 재빌드로 복원되지 않는다.
이 스크립트는 centroid 폴백 좌표만 다시 쓰므로 geocoded 실좌표를 보존한다.

Usage: python scripts/migrate_region_codes.py [--db PATH] [--verify-against PATH] [--dry-run]
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "server"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from app import region  # noqa: E402
from app import store as store_mod  # noqa: E402
from build_db import KOREA_DEFAULT  # noqa: E402  (전국 최후 폴백 좌표 공유)

DEFAULT_DB = REPO_ROOT / "data" / "sponavi.db"
SEED = REPO_ROOT / "data" / "sigungu_centroids.json"


# ---------------------------------------------------------------------------
def _master(conn: sqlite3.Connection) -> dict[str, str]:
    return {
        r[0]: r[1]
        for r in conn.execute("SELECT cd, nm FROM sigungu WHERE nm IS NOT NULL AND nm != ''")
    }


def _recompute_centroids(conn: sqlite3.Connection) -> dict[str, tuple]:
    """build_db.build_centroids 와 같은 규칙: 공공 실좌표(coord_source='api') 평균
    → 서울 시드로 덮어씀 → 시도 평균. 반환은 sigungu_coord(cd) 결과 전체."""
    import json

    acc: dict[str, list] = defaultdict(lambda: [0.0, 0.0, 0])
    for cd, lat, lon in conn.execute(
        "SELECT sigungu_cd, lat, lon FROM facilities "
        "WHERE source='public' AND coord_source='api' AND sigungu_cd IS NOT NULL "
        "AND lat IS NOT NULL AND lon IS NOT NULL"
    ):
        a = acc[cd]
        a[0] += lat
        a[1] += lon
        a[2] += 1
    centroid = {cd: (a[0] / a[2], a[1] / a[2]) for cd, a in acc.items() if a[2]}
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    for c in seed.get("centroids", []):
        centroid[c["cd"]] = (c["lat"], c["lon"])

    sido_acc: dict[str, list] = defaultdict(lambda: [0.0, 0.0, 0])
    for cd, (la, lo) in centroid.items():
        a = sido_acc[cd[:2]]
        a[0] += la
        a[1] += lo
        a[2] += 1
    sido_centroid = {s: (a[0] / a[2], a[1] / a[2]) for s, a in sido_acc.items() if a[2]}

    out: dict[str, tuple] = {}
    for (cd,) in conn.execute("SELECT cd FROM sigungu"):
        if cd in centroid:
            out[cd] = centroid[cd]
        else:
            s = region.canonical_sido(cd)
            out[cd] = sido_centroid.get(s, (None, None))
    return out


def migrate(db: Path, dry_run: bool = False) -> dict:
    if not db.exists():
        sys.exit(f"[migrate] DB 없음: {db}")
    conn = sqlite3.connect(str(db))
    rep: dict = {}
    try:
        store_mod.create_schema(conn)  # sigungu_alias 등 신규 표 (IF NOT EXISTS)

        # ① 크로스워크 도출 (마스터에서, 추측 금지)
        master = _master(conn)
        alias, unresolved = region.build_crosswalk(master)
        rep["alias"] = alias
        rep["unresolved"] = unresolved
        canonical = {cd: nm for cd, nm in master.items() if cd not in alias}
        index = region.build_name_index(canonical)
        sole = region.sole_sigungu(index)

        if dry_run:
            rep["recoded"] = conn.execute(
                "SELECT COUNT(*) FROM facilities WHERE sigungu_cd IN (%s)"
                % ",".join("?" * len(alias)), list(alias)
            ).fetchone()[0] if alias else 0
            rep["null_before"] = conn.execute(
                "SELECT COUNT(*) FROM facilities WHERE sigungu_cd IS NULL"
            ).fetchone()[0]
            return rep

        for old, new in sorted(alias.items()):
            reason = "sido_merge" if old[:2] in region.SIDO_MERGE else "sido_recode"
            conn.execute(
                "INSERT OR REPLACE INTO sigungu_alias (old_cd, new_cd, reason) VALUES (?,?,?)",
                (old, new, reason),
            )

        # ② 시설 재코딩. 이용권(voucher/dvoucher) 이름은 마스터 값으로 맞춘다
        #    (build_db 가 그 소스의 sigungu_nm 을 마스터에서 채우기 때문).
        n_recoded = 0
        for old, new in sorted(alias.items()):
            cur = conn.execute(
                "UPDATE facilities SET sigungu_cd = ?, sido_cd = ? WHERE sigungu_cd = ?",
                (new, new[:2], old),
            )
            n_recoded += cur.rowcount
        conn.execute(
            "UPDATE facilities SET sigungu_nm = "
            "  (SELECT nm FROM sigungu WHERE cd = facilities.sigungu_cd) "
            "WHERE source IN ('voucher','dvoucher') "
            "  AND sigungu_cd IN (SELECT cd FROM sigungu) "
            "  AND sigungu_nm IS NOT (SELECT nm FROM sigungu WHERE cd = facilities.sigungu_cd)"
        )
        rep["recoded"] = n_recoded

        # ③ sigungu_cd NULL 채우기 — 저장 컬럼(sido_cd, sigungu_nm, addr)만으로
        rows = conn.execute(
            "SELECT id, sido_cd, sigungu_nm, addr FROM facilities WHERE sigungu_cd IS NULL"
        ).fetchall()
        how_ctr: dict[str, int] = defaultdict(int)
        for fid, sido, nm, addr in rows:
            # 저장된 sido_cd 도 구 코드일 수 있다(구 빌드가 '전남광주'를 46 으로 적었다).
            sido = region.canonical_sido(sido)
            cd, _, how = region.resolve_sigungu(
                [sido] if sido else [], [nm] if nm else [], addr, index, sole
            )
            how_ctr[how] += 1
            if not cd:
                continue
            new_nm = canonical.get(cd) if how in ("rename", "addr", "sole") else (nm or canonical.get(cd))
            conn.execute(
                "UPDATE facilities SET sigungu_cd = ?, sido_cd = ?, sigungu_nm = ? WHERE id = ?",
                (cd, cd[:2], new_nm or nm, fid),
            )
        rep["null_filled"] = dict(how_ctr)

        # ④ 마스터에서 구 코드 행 제거
        for old in sorted(alias):
            conn.execute("DELETE FROM sigungu WHERE cd = ?", (old,))

        # ⑤ 중심좌표 재계산 → sigungu 갱신 + centroid 폴백 시설 좌표 재적용
        coords = _recompute_centroids(conn)
        for cd, (la, lo) in coords.items():
            conn.execute("UPDATE sigungu SET lat = ?, lon = ? WHERE cd = ?", (la, lo, cd))
        k_lat, k_lon = KOREA_DEFAULT
        conn.execute(
            "UPDATE facilities SET "
            "  lat = COALESCE((SELECT lat FROM sigungu WHERE cd = facilities.sigungu_cd), ?), "
            "  lon = COALESCE((SELECT lon FROM sigungu WHERE cd = facilities.sigungu_cd), ?) "
            "WHERE coord_source = 'centroid'",
            (k_lat, k_lon),
        )

        conn.commit()

        q = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
        rep["sigungu"] = q("SELECT COUNT(*) FROM sigungu")
        rep["alias_rows"] = q("SELECT COUNT(*) FROM sigungu_alias")
        rep["null_after"] = q("SELECT COUNT(*) FROM facilities WHERE sigungu_cd IS NULL")
        rep["legacy_after"] = q(
            "SELECT COUNT(*) FROM facilities "
            "WHERE substr(sigungu_cd,1,2) IN ('29','46','42','45')"
        )
        return rep
    finally:
        conn.close()


# ---------------------------------------------------------------------------
def _counts(path: Path) -> dict:
    conn = sqlite3.connect(str(path))
    try:
        return {
            (cd, src): n
            for cd, src, n in conn.execute(
                "SELECT sigungu_cd, source, COUNT(*) FROM facilities GROUP BY 1, 2"
            )
        }
    finally:
        conn.close()


def verify(db: Path, rebuilt: Path) -> int:
    """마이그레이션 결과 ≡ 전체 재빌드 결과 (시군구별·source별 시설 카운트)."""
    a, b = _counts(db), _counts(rebuilt)
    keys = sorted(set(a) | set(b), key=lambda k: (k[0] or "", k[1] or ""))
    diffs = [(k, a.get(k, 0), b.get(k, 0)) for k in keys if a.get(k, 0) != b.get(k, 0)]
    print(f"[verify] 마이그레이션 {db}  ≟  재빌드 {rebuilt}")
    print(f"  비교 키(시군구×source): {len(keys)}개 · 총 시설 "
          f"{sum(a.values())} vs {sum(b.values())}")
    if not diffs:
        print("  ✅ 시군구별·source별 시설 카운트 전부 일치")
        return 0
    print(f"  ❌ 불일치 {len(diffs)}건 (상위 20)")
    for k, x, y in diffs[:20]:
        print(f"    {k}: 마이그레이션={x} 재빌드={y}")
    return 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--verify-against", default=None,
                    help="build_db.py 로 새로 만든 DB 경로 — 카운트 정합만 검증하고 종료")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.verify_against:
        sys.exit(verify(Path(args.db), Path(args.verify_against)))

    rep = migrate(Path(args.db), dry_run=args.dry_run)
    if rep.get("unresolved"):
        print(f"[migrate] ⚠ 현행 코드로 옮기지 못한 구 시군구코드 {len(rep['unresolved'])}건 "
              f"(추측 매핑 금지 — 그대로 둠):", file=sys.stderr)
        for u in rep["unresolved"]:
            print(f"    {u['cd']} {u['nm']} — {u['reason']}", file=sys.stderr)
    if args.dry_run:
        print(f"[migrate] (dry-run) 재코딩 대상 시설 {rep.get('recoded', 0)}건 · "
              f"sigungu_cd NULL {rep.get('null_before', 0)}건 · "
              f"별칭 {len(rep.get('alias', {}))}건")
        return
    print(f"[migrate] {args.db} 지역 코드 정규화 완료")
    print(f"  sigungu_alias {rep['alias_rows']}건 · sigungu 마스터 {rep['sigungu']}행")
    print(f"  시설 재코딩 {rep['recoded']}건")
    print(f"  sigungu_cd NULL 채움: {rep['null_filled']} → 잔여 {rep['null_after']}건")
    print(f"  구코드 시설 잔여: {rep['legacy_after']}건")


if __name__ == "__main__":
    main()
