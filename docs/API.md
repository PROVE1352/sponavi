# API 계약 v1 — 서버·웹 공용 (변경 시 양쪽 합의)

베이스: `/api`. 모든 응답 JSON·한국어 메시지. 에러: `{"error":{"code":"UPPER_SNAKE","message":"..."}}`

## POST /api/assess

요청:
```json
{
  "age": 27, "sex": "M",
  "sigungu_cd": "11290", "sigungu_nm": "성북구",
  "income_class": "기초생활수급 | 차상위 | 한부모 | 그외",
  "disability": { "has": false, "type": null },
  "location": { "lat": 37.60, "lon": 127.02 },
  "special": ["multichild"]
}
```
`location` 없으면 시군구 중심좌표 사용. 둘 다 없거나 시군구코드가 무효면 400 `LOCATION_UNRESOLVED`.
`special`(선택, 기본 `[]`): 2027 예산안 확대 대상 자가선언 — `multichild`(3자녀 이상 다자녀가구) ·
`defector`(북한이탈주민). 어휘 밖 값은 422. **2026 판정에는 쓰이지 않고** svoucher 카드의
`next_year` 블록에만 쓰인다. 인구감소지역은 자가선언이 아니라 서버가 시군구코드로 대조한다.

응답:
```json
{
  "eligibility": [
    {
      "program_id": "svoucher", "program_name": "스포츠강좌이용권",
      "eligible": false,
      "reasons": [ { "field": "income_class", "ok": false, "message": "소득 기준(기초·차상위·한부모)에 해당하지 않습니다" } ],
      "benefit": "월 최대 N만원", "apply": { "how": "...", "url": "...", "docs": ["..."] },
      "source": { "url": "...", "checked": "2026-07-20" }, "verified": true
    }
  ],
  "path": [
    { "from": "person", "to": "svoucher", "edge": "자격", "result": "fail", "label": "소득>기준" },
    { "from": "svoucher", "to": "public_program", "edge": "대체경로", "result": "ok", "label": "무료/저가 공공프로그램", "curated": "검증 대기" },
    { "from": "public_program", "to": "facility:F123", "edge": "적합·접근", "result": "ok", "label": "도보 8분" }
  ],
  "alt_edges": [
    { "to": "tteuntteun", "note": "…", "curated": "공식 확인(2026-07-21)",
      "program": { "id": "tteuntteun", "name": "…", "benefit": "…", "apply_url": "…" } }
  ],
  "nearby": {
    "primary": "voucher | alternatives",
    "voucher_facilities": [ { "id": "V1", "name": "성북 OO스포츠클럽", "source": "voucher", "sports": ["수영"], "lat": 0, "lon": 0, "dist_km": 0.5, "fee_month": 90000, "subsidy": 105000, "copay": 0, "disability_support": null } ],
    "alternatives":       [ { "id": "F1", "name": "성북구민체육센터", "type": "공공체육시설", "sports": ["요가"], "lat": 0, "lon": 0, "dist_km": 0.7, "faci_gb": "공공", "note": "저가 오전시간대", "disability_support": true } ]
  },
  "supply_gap": {
    "radius_km": 3, "voucher_count": 0, "voucher_scope": "sigungu", "alt_count": 2,
    "scope_codes": ["11290"], "scope_label": null, "scope_reason": null,
    "nearest": { "name": "...", "coord_source": "centroid", "dist_km": null, "sigungu_nm": "강북구" },
    "message": "성북구에 장애인스포츠강좌이용권 가맹시설이 없습니다",
    "coverage": { "sigungu": "성북구", "class": "차상위·한부모", "target": 602, "recipient": 9, "rate": 0.015, "year": 2025 }
  },
  "public_fee": null
}
```
규칙: `eligible=true`인 제도가 있으면 path는 직접 경로(자격 ✓ → 신청·근처). 없으면 alt_edges의
**첫 항목**(= 아래 dedupe·공식확인 우선 정렬의 1순위)으로 멀티홉 경로 구성 — 경로 그림의 대체 홉과
`alt_edges[0].to`는 항상 같다. `supply_gap`은 항상 포함(있어도 통계 노출). 이용권 카운트는 구 단위(`voucher_scope:"sigungu"`)이며 행정구역 개편 전환기 영역그룹(FR-05 AC4, 예: 인천 서해구·검단구 ← 옛 서구)이면 `scope_codes`에 합산한 코드들, `scope_label`에 "○○ 일대(옛 △△)", `scope_reason`에 사유가 실린다(그룹이 아니면 자기 코드 1개·null).

### `eligibility[].next_year` — 2027 예산안 확대 대상 (2026-09-23)

svoucher 카드에만, **2026 판정이 소득 사유 하나로만 ✗**(= 연령이 5~18세 안, 비장애)일 때만 붙는다.
2026 판정(`eligible`)은 그대로 두고 나란히 보여 주는 블록이다. 2026 ✓·연령 ✗·dvoucher 카드면 키 자체가 없다.
```json
"next_year": {
  "year": 2027, "basis": "2027년 정부 예산안(국회 심의 전)",
  "eligible": true,
  "matched": [ { "id": "multichild", "label": "3자녀 이상 다자녀가구", "detail": "3자녀 이상 다자녀가구 — 본인 응답" } ],
  "possible_if": ["북한이탈주민", "인구감소지역 거주 유·청소년"],
  "note": "구체적인 신청 자격과 방법은 추후 국민체육진흥공단과 각 지방자치단체가 안내 (2026-09-09 발표 기준)",
  "age_assumed": true, "age_note": "2027년 지원 연령은 발표되지 않아 현행(5~18세)과 같다고 가정한 것 — 확정 기준 아님",
  "apply_hint": "2027년 지원분 신청 시기는 공단 공고 확인 (참고: 2026년 지원분은 2025.11.10~11.28)",
  "sources": [ { "url": "…", "label": "머니투데이(2026-09-04)", "checked": "2026-09-23" } ],
  "curated": "예산안 발표(2026-09-09)", "subsidy_month": 105000
}
```
- 정적 필드 원천 = `data/rules.json` `programs[svoucher].next_year`. 판정은 결정론: `special` 자가선언 +
  `data/depopulation_regions.json`(행안부 인구감소지역, 현행·구 코드 `alias_codes` 모두) 대조. LLM 무관(P-2).
- `matched[].id = "depop_region"`이면 `detail`은 "강원 고성군 — 인구감소지역", `basis`에 지정 고시 근거가
  함께 실리고, 지정 고시의 공식(go.kr) 출처가 `sources` 뒤에 붙는다.
- `eligible`은 **예산안 기준 예상**이다 — 국회 확정 전이므로 화면은 "될 수 있어요"로만 말한다(P-1·P-4).
- **히어로 N·`alt_edges`에 절대 포함되지 않는다**(카드 부속 블록, 경로 그림에도 없음).

### `alt_edges` — 복수 대체경로 (FR-02 AC3 · 2026-08-27 결정 CQ2A)

자격 ✗(또는 dvoucher 자격 ✓ + 예상 4·5순위·미정)일 때 "지금 바로 되는 것" 목록.
`program`은 `rules.json`에 정의가 있을 때만 채워지고 없으면 `null`.

- **`to`는 유일하다.** 같은 대상 제도로 가는 엣지가 사유별로 여러 개여도(예:
  `svoucher → public_program`이 `income_fail`·`age_fail` 두 벌) 한 줄로 합친다.
  - `note`는 rules 순서상 **첫** 매칭 엣지 것.
  - `curated`는 중복 중 **가장 강한** 값(`공식 확인…` > `검증 대기`). 없는 검증을
    만들지 않으므로 전부 `검증 대기`면 승격되지 않는다.
- **정렬: `공식 확인…`이 앞, 그 밖(`검증 대기`)이 뒤.** 같은 등급 안에서는 rules 순서 유지.
- `path`의 `대체경로` 홉은 이 목록의 **첫 항목**과 같다(OV4).
- 헤딩의 N(“지금 바로 되는 것 N가지”)은 **`공식 확인` 항목 수만** 센다 — `검증 대기`는
  헤딩 밖 "확인 중 1건"으로 뺀다(P-1).
- **대상 제도 자체의 연령 범위**(`eligibility.age_min/age_max`, null=무제한)가 사람의 나이를 벗어나면
  그 엣지는 빠진다(2026-09-23). 예: 문화비 소득공제는 `age_min: 19`(근로소득자 요건 — 설계 결정)라
  16세에게는 안 나오고, 3세에게는 튼튼머니(만 4세+)도 안 나온다. `path`의 대체 홉도 같은 목록을 쓴다.
- 실측(27세·비장애·그외, 조례 미확인 지역 예: 강남구): `["tteuntteun"(공식), "culture_deduction"(공식),
  "public_program"(검증 대기)]` — 3줄, dedupe 전에는 5줄이었다. P2(성북구)는 아래 조례 승격으로
  `["public_program"(공식 확인(조례 2026-09-17)), "tteuntteun", "culture_deduction"]` — N=3.
- **`public_program` 조례 승격 (2026-09-23)**: 사람의 시군구(구 코드는 `sigungu_alias`로 현행 해석)가
  `data/public_fee_reductions.json`(시군구 체육시설 조례 감면 원문 확인분 — 현재 성북·송파·노원·대구 북구·
  강원 고성)에 있으면 `curated`를 `"공식 확인(조례 {시행일})"`로 올리고 아래 필드를 붙인다. 없으면
  `검증 대기` 그대로이고 필드도 없다(파일 자체가 없어도 같다).
  - `region{sigungu_cd,sigungu_nm,sido}` · `law{title,article,url,effective}` · `operator{name,url}` · `scope`
  - `reductions[]`: **이 사람에게 맞는** 감면만 `{target,label,rate,condition,quote,source_url,
    age_definition?,caveat?}`. youth=조례의 청소년·어린이 나이 범위(정의가 없으면 18세 이하로 보고
    `caveat`), basic_livelihood=기초생활수급, single_parent=한부모, multichild=`special` 다자녀(3자녀 행이
    있으면 그것만 · 서울은 다둥이카드 기준 미검증 `caveat`), disability=장애. near_poor·defector 는
    데이터에 조항이 있을 때만(현재 없음). `other`(중복 불가 등)는 감면이 아니라 싣지 않는다.
  - `no_reduction_for[]`: 이 사람에게 해당하는데 조례에 조항이 없는 정직한 공백(예: 차상위 →
    `"차상위 전용 감면 없음(조례 확인)"`).
  - `caveats[]`: 지역 `unverified` 중 이 사람과 관련된 문장(대상 키워드가 없으면 지역 공통) + 서로 다른
    사유 2개 이상 매칭 시 중복 불가 안내. 인용 표기 메모는 싣지 않는다.
- **최상위 `public_fee` (2026-09-28)**: 위 조례 감면 블록은 이용권 **자격과 무관하게** 받을 수 있으므로
  (예: 노원 14세 한부모 = 이용권 ✓ + 구립 체육시설 한부모 20%, 대구 북구 12세 차상위 = 이용권 ✓ + 청소년 50%)
  응답 최상위에도 `public_fee`로 싣는다. 내용·모양은 `public_program` 엣지 블록과 같다(같은 매칭 함수):
  `{region, law, operator, scope, checked, reductions, no_reduction_for, caveats}`. 조례 미확인 지역이면 `null`.
  - 웹은 `alt_edges`에 `public_program`이 있으면 거기서 이미 보여 주므로 따로 그리지 않는다(중복 렌더 금지).
    없을 때(자격 ✓ 등) `reductions`가 1개 이상이면 "함께 받을 수 있는 것 · 구립(군립) 체육시설 감면"
    블록으로 보여 준다. **히어로 N("지금 바로 되는 것 N가지")에는 세지 않는다.**
- **경로 시설 홉은 장소 기반 대안(`public_program`)일 때만** 잇는다. 대체 홉이 튼튼머니·문화비
  소득공제·어르신 상품권이면 경로는 그 제도 노드에서 끝난다(적립·등록 시설 데이터가 없으므로 근처
  공공시설을 붙이면 거짓 연결이다).

### `nearby` (2026-08-27 · 결정 1A·OV1·OV3·OV6)

- **`nearby.primary`**: `"voucher" | "alternatives"` — 이 응답을 만든 이용권 카드가
  `eligible=true`면 `"voucher"`, 아니면 `"alternatives"`. **웹은 이 순서대로** 덱·리스트를
  배치한다. 자격 ✗ 사용자에게 가맹시설이 1순위로 뜨던 문제(⚠#10)를 서버가 판정한다(P-2 —
  자격 판단은 클라가 하지 않는다).
- **`voucher_facilities[].source`**: `"voucher" | "dvoucher"` — 그 행이 어느 이용권의
  가맹시설인지. 장애인 가맹 배지·FR-10 접근성 블록의 원천이다(`v.source === 'dvoucher'`).
- **`subsidy`/`copay` 의미 — 자격 인지(결정 1A)**:
  - `eligible=true` : `subsidy` = 제도 지원금, `copay = max(0, fee_month - subsidy)`.
  - `eligible=false`: **`subsidy = 0`, `copay = fee_month`** (`fee_month`가 null이면 `copay`도 null).
    받지 못할 지원금을 차감해 "자부담 0원 = 무료"라고 표기하면 거짓 금액이다(P-1).
  - 세 값 모두 `number | null`. `null`은 "미등록 — 시설 문의"로 렌더한다(등록강좌 수강료 결측).
- **`alternatives` 정렬(OV1)**: **실좌표(`coord_source` = `api`·`geocoded`) 행이 먼저**,
  시군구 중심 폴백(`centroid`) 행이 뒤. 각 그룹 안에서는 거리 오름차순이고, 잘라내기
  (최대 6곳)는 정렬 **후**에 한다. 폴백 행은 거리를 밝힐 수 없어(FR-04) 목록 머리를
  차지하면 "근처"를 보여주지 못한다.
- **`alternatives[].faci_gb`**: `"공공" | "신고" | "등록" | null` — 시설 구분(원천
  `faci_cd` 조인, `facilities.faci_gb` 컬럼). AltRow 배지·`gap.html`·성공기준이 같은
  컬럼을 쓴다. 컬럼이 없는 옛 DB에서는 `null`(없는 배지를 만들지 않는다).

## GET /api/facilities/search (2026-09-23 · 동·도로명·시설명 검색)

`?sigungu_cd=27230&q=구암로&program=svoucher&limit=30[&lat=…&lon=…][&age=…]`

배경: 이용권 가맹시설 28,772곳 중 실좌표(`coord_source=geocoded`)는 약 538곳뿐이고 나머지는
시군구 중심 폴백이라, 지도를 옮겨도 목록이 바뀌지 않는다(대구 북구 실측: 가맹 273곳 전부 `centroid`).
그래서 **그 시군구 안에서 이름·주소 키워드**로 찾는다.

| 파라미터 | 규칙 |
|---|---|
| `sigungu_cd` | 필수, 숫자 5자리(아니면 422). assess 와 같은 정규화 — 구 코드는 `sigungu_alias`로 현행 코드로 해석하고, 영역그룹(`region.SIGUNGU_GROUPS`, 인천 서해·검단 등)이면 그룹 전 코드를 검색한다. 좌표 없는/모르는 코드는 400 `LOCATION_UNRESOLVED`. |
| `q` | 필수. 앞뒤 공백 제거·연속 공백 1칸으로 접은 뒤 **1~30자**(아니면 422 `INVALID_REQUEST`). |
| `program` | `svoucher`(기본) · `dvoucher` · `public`. 밖의 값은 422. |
| `limit` | 기본 30, 1 미만 422, **50 초과는 50으로 자른다**. |
| `lat`,`lon` | 선택(둘 다 또는 둘 다 없음, 한쪽만이면 422). 거리 원점 — 없으면 시군구 중심(assess 와 같은 폴백). 실좌표 행의 `dist_km`·거리순 정렬에 쓴다. |
| `age` | 선택(0~120). 대표 수강료(`fee_month`)를 그 나이 강좌 중 최저로 고른다. 없으면 전체 강좌 중 최저. |

매칭: `q`를 공백으로 나눈 **모든 토큰**이 `name` 또는 `addr`에 부분일치(AND). 파라미터 바인딩 +
`LIKE … ESCAPE '\'`라 `%`·`_`·`\`는 글자 그대로 찾는다. ASCII 대소문자 무시(한글은 해당 없음).
정렬: 실좌표(`api`·`geocoded`) 행 먼저(원점에서 거리순) → 구 중심 폴백 행(이름순).

응답(실측, 대구 북구 `q=구암로`, `limit=2`):
```json
{
  "sigungu_cd": "27230", "sigungu_nm": "북구", "scope_codes": ["27230"], "scope_label": null,
  "program": "svoucher", "q": "구암로", "tokens": ["구암로"], "match_fields": ["name", "addr"],
  "eligibility_applied": false, "total": 27, "truncated": true,
  "facilities": [
    { "id": "voucher-5479700149-25830", "name": "GOOD BOXING 굿복싱", "source": "voucher",
      "sports": ["복싱"], "lat": 35.9241, "lon": 128.5629, "coord_source": "centroid", "dist_km": null,
      "sigungu_nm": "북구", "fee_month": 100000, "subsidy": null, "copay": null,
      "disability_support": null, "addr": "대구광역시 북구 구암로32길 6-16" }
  ]
}
```
- **행 모양 = assess `nearby`와 같은 직렬화기**(`engine._voucher_row` / `_alt_row`) + `addr`(매칭 근거).
  `program=public`이면 `alternatives[]` 모양(`type`·`faci_gb`·`note`).
- **자격 판정 없음(`eligibility_applied:false`)** — 이용권 행은 `subsidy = null`, `copay = null`,
  `fee_month`만 사실로 싣는다. 지원금을 빼면 거짓 금액, `0`을 넣으면 "지원 없음(자격 ✗)"이라는
  거짓 판정이 되기 때문이다(P-1·P-2). 웹은 수강료만 보여 주고 지원·자부담은 위 자격 판정을 따르라고 적는다.
- 근사 행(`centroid`)은 `dist_km:null`(FR-04) — 웹은 "위치 근사(구 중심)" 배지, 지도 확대 불가.
- `total` = 잘라내기 전 일치 수, `truncated = total > facilities.length`.
- **알려진 한계**: 도로명 주소(예: "구암로32길 6-16")에는 법정동 이름이 없어서 동 이름으로는 일부 시설이
  빠진다. 지번 주소("팔달동 52번지")·괄호 동 표기("(구암동)")가 있는 행만 동 이름으로 잡힌다 —
  웹은 0건일 때 도로명·시설 이름으로도 찾아보라고 안내한다.
- 레이트리밋: 일반 `api` 버킷(120/min). 쿼리스트링(검색어)은 액세스 로그에 남지 않는다(P-3).

## GET /api/facilities/in-bounds (2026-09-30 · 지도 범위 검색 "이 지역에서 다시 찾기")

`?min_lat=37.595&min_lon=127.005&max_lat=37.612&max_lon=127.045&program=public[&q=…][&limit=50][&age=…]`

카카오맵 "현 지도에서 검색"과 같은 기능이다. 사용자가 지도를 직접 움직인 뒤 버튼을 누르면 웹이
**화면 범위(bounds)** 로 이 API 를 부른다(주 이용권 program 1번 + `public` 1번, 동시에 2요청).
범위 판정에는 **좌표 등급이 `real`인 행만** 쓰고, 정확한 위치를 확인할 수 없는 시설은 점으로
찍지 않고 **시군구 전체 수**(`unlocated`)로 따로 알린다(SPEC §0 — 근사 좌표를 실좌표처럼 쓰지 않는다).
배경: 이용권 가맹 28,772곳 중 실좌표는 538곳(성북 11290·인천 서구 28260 일대)뿐이라, 그 밖의
지역에서 이용권 실좌표 결과 0곳은 정상이다 — 이것을 "가맹 0곳"처럼 보이게 하면 거짓 공급 공백이다.

| 파라미터 | 규칙 |
|---|---|
| `min_lat`, `max_lat` | 필수 float, −90~90(아니면 422). |
| `min_lon`, `max_lon` | 필수 float, −180~180(아니면 422). |
| `program` | `svoucher`(기본) · `dvoucher` · `public`. 밖의 값은 422. |
| `q` | 선택. 앞뒤 공백 제거·연속 공백 1칸으로 접은 뒤 **1~30자**(아니면 422). **파라미터가 없으면 키워드 조건이 없다.** |
| `limit` | 기본 50, 1 미만 422, **50 초과는 50으로 자른다**. |
| `age` | 선택(0~120). 이용권 행의 대표 수강료(`fee_month`)를 고르는 기준 — search 와 같다. |

범위는 **양 끝 포함**이다.

### 검증 순서와 에러 (서버·웹 게이트·목이 같은 순서)

1. FastAPI 검증(누락·범위 밖·`nan`·`inf`·program·limit·age) → 422 `INVALID_REQUEST`
2. `q`가 있는데 접은 뒤 비었거나 30자 초과 → 422 `INVALID_REQUEST`
   `입력값 오류(q): 검색어는 1~30자로 입력해 주세요.`
3. 유한수가 아니거나 `min_lat < max_lat`·`min_lon < max_lon`(엄격)이 아님 → 422 `INVALID_REQUEST`
   `입력값 오류(bounds): min_lat<max_lat, min_lon<max_lon 이어야 합니다.` (`math.isfinite`로 한 번 더 막는다)
4. 국내 범위(lat 32.5–39.6, lon 124.0–132.5)와 **전혀 겹치지 않음** → 422 `AREA_OUT_OF_RANGE`
   `대한민국 밖의 범위예요. 국내 지역에서만 찾을 수 있어요.` — 일부만 겹치면 통과하고, 범위를 자르지 않는다.
5. 대각선(`haversine(min_lat,min_lon,max_lat,max_lon)`)이 **20km 초과**(정확히 20은 허용), 또는
   **경도 폭(`max_lon − min_lon`)이 180° 초과** → 422 `AREA_TOO_WIDE`
   `지도 범위가 너무 넓어요(대각선 약 {d:.1f}km, 최대 20km). 지도를 조금 더 확대해 주세요.`
   경도 폭 규칙의 이유: haversine 은 지구 반대편 **짧은 길**로 잰다. `min_lon=-180&max_lon=180` 이면
   sin²(Δλ/2)≈0 이라 대각선이 위도 차(11.1km)만 남아 통과했고, 가운데(lon 0)에서 가까운 순으로 한반도 서쪽
   끝 시설이 나왔다. 범위 판정은 `min_lon ≤ lon ≤ max_lon`(긴 길)로 읽으므로 폭 180° 초과는 거절한다.
   이때 메시지의 `{d}`는 서→동 긴 길 그대로(위도 평균의 경도 호 + 위도 호, 평면 근사) 잰 값이다
   (`engine.area_diag_km` = 웹 `diagKm` · 계약 JSON `max_lon_span_deg`, cases `E_lon_wrap_*`).

봉투는 다른 에러와 같은 `{"error": {"code", "message"}}`. 20km 근거(위도 37.5): 1280 화면 z12 17.2km 허용 ·
z11.5 24.3km 거부, 390 화면 z11.5 18.5km 허용 · z11 26km 거부 — 처음 맞춤에서 축소 1번은 되고 2번은 안 된다.

### 좌표 등급 (`coord_class`, 워커 메모리 안에서 인덱스 빌드 때 1회)

`coord_source`가 `api`·`geocoded`라고 해서 모두 실좌표로 치지 않는다. 실 DB 를 보면 api 좌표에도
원천 기본값·다른 시도 좌표·시군구 단위 좌표가 섞여 있다(예: '경기도 군포시 … 그린당구장' 좌표가 전남,
'부산 북구 …' 행이 서울 좌표, 세종 한 점에 영역 113곳의 api 438행, '대전광역시 동구' 한 줄 주소 88행이 한 점).
행마다 `cd' = canonical_sigungu(sigungu_cd)`, 영역 키 = 영역그룹이면 그룹 id, 아니면 `cd'`.

| 등급 | 규칙 | 이유 |
|---|---|---|
| `placeholder` | api 행을 좌표 (lat, lon)가 **똑같은**(반올림 없음) 것끼리 묶어, 한 점에 서로 다른 영역 키가 **3개 이상** | 원천 기본값(자리표시 점) — 전국 13점 |
| `far` | api 행이 자기 시군구 **강건 중심**에서 **40km 초과** | 주소는 자기 시군구인데 좌표가 딴 곳 |
| `no_ref` | api 행인데 강건 중심·시군구 중심점이 모두 없음 | 판정 불가(실 DB 0건) |
| `shared_point` | api 행인데 주소에 **번지가 없고**(아래 api 정규식 불일치), 역시 번지 없는 **다른 이름의** api 행과 좌표가 **똑같다** — 자리표시 점을 뺀 번지 없는 api 행을 좌표 (lat, lon)가 똑같은 것끼리 묶어 이름 키(ASCII 소문자 + 공백 제거)가 **2개 이상**이면 그 행들 전부. 먼 행 판정이 먼저다 | 시군구·읍면동·도로 단위로 지오코딩된 근사 좌표 — '대전광역시 동구' 88행, '경기도 가평군' 31행, '인천광역시 남동구' 13행이 각각 한 점(전국 147점·500행). 같은 시설 중복 행(이름 키 하나)과 혼자 있는 점(약수터·공원)은 real 로 둔다 |
| `geocoded_approx` | geocoded 행인데 주소에 **건물번호(번지)가 없다** — 정규식 `(?:^\|[\s,])(?:산\s?)?[0-9]+(?:-[0-9]+)?(?:번지)?(?=$\|[\s,(])` 불일치 | '서울 성북구 하월곡동'처럼 동·구 중심점에 찍혀 있다(30행) |
| `centroid` | 시군구 중심점 폴백(과 알 수 없는 coord_source) | 근사 좌표 |
| `real` | 위 어디에도 걸리지 않음 | **범위 판정에는 이 등급만** 쓴다 |

- **api 번지 정규식**(한 점 공유 판정에만): `[0-9]+(?:-[0-9]+)?(?:번지)?(?:일원|외)?(?![0-9가-힣])`. api 주소는
  '양덕동477'(마산종합운동장 6행)·'의정부시 체육로90'·'문학동482번지외'처럼 번지가 붙어 적혀 geocoded 정규식으로는
  번지가 없는 것으로 읽힌다 — 그래서 이 판정만 느슨한 식을 쓴다. 숫자 뒤에 한글·숫자가 이어지면('장위3동'·'다문1리'·
  '2층') 번지가 아니다. 계약 JSON `coord_rules.api_building_no_regex`·`shared_point_min_names`(2)와 같다(tests C1).
- **강건 중심** `ref(code)`: 그 코드의 api 행 가운데 자리표시 점이 아닌 행이 **5개 이상**이면
  `(median(lat), median(lon))`(짝수 개면 가운데 둘 평균), 아니면 `store.centroid(code)`, 그것도 없으면 없음.
  build_db 의 시군구 중심점은 공공시설 좌표의 **평균**이라 오염에 끌려간다(옹진 31.5km·군포 11.3km 등 14곳이
  강건 중심과 5km 넘게 차이, 군포 중심점은 수원 시가지 안) — 그래서 중앙값을 쓴다.
- `coord_source`가 NULL이면 `_facility_row`와 같은 폴백(public→api, 그 밖→centroid).
- 응답 행의 `coord_source`는 원래 값(`api`/`geocoded`)을 그대로 싣는다. 직렬화 직전에 실좌표 원천이고
  real 등급인지 한 번 더 확인한다.
- 실 DB 분포(2026-09-30): public api real 105,438 · placeholder 477(13점) · far 496 · shared_point 500(147점) /
  voucher geocoded real 508 · geocoded_approx 30 / dvoucher geocoded real 41 / public geocoded real 40 / 나머지 centroid.
  자리표시 점 수·행 수는 좌표 **똑같음**(반올림 없음) 기준이다 — 소수 6자리로 반올림해 묶으면 영역 114곳·439행,
  전국 482행이 되지만 그것은 이 규칙이 아니다.
- 좌표 등급·공간 인덱스는 **프로세스 메모리 안에만** 만든다(`app/area_index.py`, 워커당 첫 요청 때 지연 빌드,
  약 0.5초·tracemalloc 약 36MB). DB(동결본)의 스키마·인덱스·행은 바꾸지 않는다.

### 위치 미상 묶음 (`unlocated`)

뜻: **지도 범위와 겹쳐 보이는 시군구 영역에서, 이 program(과 q)에 맞지만 정확한 위치를 확인할 수 없어 점으로
찍지 않은 시설의 영역 전체 수.** 영역그룹(인천 서해·검단 28260/28275/28290, 제물포·영종)은 한 항목으로 합친다.

후보 영역(A 또는 B):
- **A 중심** — 영역 소속 코드 중 하나라도 **강건 중심** 점이 범위 안에 있다(DB 중심점이 아니다).
- **B 증거** — 그 영역의 **증거 행**(real 등급 api 행, geocoded 제외)이 범위 안에 **서로 다른 좌표로 2곳 이상**
  있다. 좌표가 같은 행은 1곳으로 센다.

`count` = 그 영역에서 요청 source 의 비real 등급 행 가운데 q 에 맞는 행의 수(q 없으면 전부). count 0 은 빼고,
소속 코드 중 중심점이 있는 코드가 하나도 없어 이름을 붙일 수 없는 영역도 뺀다(실 DB 0건).
정렬 = count 내림차순, 같으면 `sigungu_cd` 오름차순. `unlocated.total` = count 합.

| 필드 | 값 |
|---|---|
| `sigungu_cd` | `/api/facilities/search`에 그대로 쓸 수 있는 코드. 그룹이면 소속 목록 순서로 중심점이 있는 첫 코드 |
| `sigungu_nm` | `store.centroid(sigungu_cd).nm` |
| `sido_nm` | `region.sido_label(sigungu_cd[:2])` |
| `label` | 그룹이면 그룹 label, 아니면 `sigungu_nm` |
| `display_label` | `label`이 전국에서 겹치는 이름(강서구·고성군·남구·동구·북구·서구·중구)이면 `"{sido_nm} {label}"`, 아니면 `label`. 예: `대구광역시 서구` |
| `scope_codes` | 그룹이면 소속 코드 전부, 아니면 `[cd']` |
| `count` | 위 규칙의 수 |
| `included_by` | `["center"]` · `["evidence"]` · 둘 다 — 설명용(목·서버 대조 대상 아님) |

**이 수가 말하지 않는 것**(`count_basis: "whole_area"`): 시군구 폴리곤이 없으므로 "이 N곳이 이 범위 안에 있다"는
뜻이 **아니다**. 범위 밖 시설이 섞여 있고, 범위와 겹치는 시군구 일부는 빠질 수 있다(A·B 를 모두 못 채우는 경우,
예: 옹진 섬). 웹 문구도 "정확한 위치를 확인할 수 없어 지도에 없어요 · 시군구 전체 수"로 적는다.

### 정렬 · 행 모양 · 그 밖

- **정렬**: 지도 가운데에서 가까운 순. `clat=(min_lat+max_lat)/2`, `clon=(min_lon+max_lon)/2`,
  `k=cos(clat·π/180)`, `d2=(lat−clat)²+((lon−clon)·k)²`, 키 `(d2, id)`. 상위 N개만 DB 에서 다시 읽는다.
- `total` = 잘라내기 전 일치 수, `truncated = total > facilities.length`.
- **`dist_km`는 항상 `null`** — 거리 원점(내 위치)이 없다. 화면 가운데는 사용자의 위치가 아니다.
- **행 모양 = `/api/facilities/search`와 같다**(키 집합 동일, `engine._voucher_row`/`_alt_row` + `addr`).
  이용권 행은 `subsidy`·`copay` = `null`(자격 미상), `fee_month` = 그 나이 강좌 중 최저, 맞는 강좌가 없으면
  **전체 강좌 중 최저(폴백)**, `age` 없으면 전체 최저. 공공 행에는 `source` 키가 없다(마커 종류는 응답 `program`으로).
- **장애 필터를 적용하지 않는다**(키워드 검색 계열) — `disability_support`는 원천 값(true/false/null) 그대로.
  웹은 장애 있음일 때 "‘장애’ 표기와 관계없이 모두 보여요"라고 밝힌다.
- `eligibility_applied`는 항상 `false`. `q`는 접은 문자열 또는 `null`, `tokens`는 공백 분리(중복 제거·순서 유지).
- **q 매칭**: 모든 토큰이 이름 **또는** 주소에 부분일치(AND). 대소문자는 ASCII A–Z 만 무시하고 `%`·`_`·`\`는
  글자 그대로 — 결과 집합이 SQLite `LIKE … ESCAPE '\'`(search)와 같다(tests P2).
- 레이트리밋: 일반 `api` 버킷(IP당 120/min, 워커별). 쿼리스트링(좌표·검색어)은 액세스 로그에 남지 않는다(P-3).
  웹은 버튼·범위 모드 폼 제출·다시 시도 때만 부른다. 429 도 막대의 "다시 시도" 대상이다(서버가 "잠시 후 다시
  시도"라고 말한다 — 422 만 같은 요청이면 같은 답이라 다시 시도 없이 확대·국내 안내).
- **동시 요청**: 웹은 한 번에 2요청(주 이용권 + `public`)을 동시에 보낸다. 워커는 SQLite 커넥션 하나를 스레드풀이
  함께 쓰므로 **문장 캐시 없이** 연다(`store.connect_shared`, `cached_statements=0`). 캐시가 같은 SQL 의 준비된
  문장을 두 스레드에 주면 `InterfaceError: bad parameter or other API misuse`·`IndexError`로 500 이 났다
  (in-bounds·search·assess 가 서로 겹쳐도 같다 — tests I4). 비용은 in-bounds 1회 약 0.1ms.

응답(fixtures, `program=public`, 위 쿼리):
```json
{
  "bounds": {"min_lat": 37.595, "min_lon": 127.005, "max_lat": 37.612, "max_lon": 127.045},
  "center": {"lat": 37.6035, "lon": 127.025},
  "diag_km": 4.0, "max_diag_km": 20,
  "program": "public", "q": null, "tokens": [], "match_fields": ["name", "addr"],
  "coord_sources": ["api", "geocoded"],
  "coord_rules": {"placeholder_min_areas": 3, "suspect_max_km": 40, "robust_min_rows": 5, "geocoded_requires_building_no": true, "shared_point_min_names": 2},
  "order": "center_distance", "eligibility_applied": false,
  "total": 3, "truncated": false,
  "facilities": [
    {"id": "P02", "name": "아리랑체육관", "type": "공공체육시설", "sports": ["배드민턴", "탁구"],
     "lat": 37.6008, "lon": 127.0117, "coord_source": "api", "dist_km": null, "sigungu_nm": "성북구",
     "faci_gb": null, "note": null, "disability_support": false, "addr": "서울 성북구 아리랑로 82"}
  ],
  "unlocated": {"total": 0, "count_basis": "whole_area", "areas": []}
}
```
(`facilities`는 P02·P03·P01 3행 중 첫 행만 적었다. 같은 범위 `program=svoucher`면 `total: 0`,
`unlocated.areas = [{"sigungu_cd": "11290", "label": "성북구", "count": 4, "included_by": ["evidence"], …}]`.)

실측(실 DB 2026-09-30 적재본, immutable 읽기 전용으로 engine 직접 호출 · 위 예시와 같은 공통 키는 일부 생략) — 창원
`35.20–35.26, 128.58–128.66`, `program=svoucher`:
```json
{
  "bounds": {"min_lat": 35.2, "min_lon": 128.58, "max_lat": 35.26, "max_lon": 128.66},
  "center": {"lat": 35.23, "lon": 128.62}, "diag_km": 9.9, "max_diag_km": 20,
  "program": "svoucher", "q": null, "tokens": [], "order": "center_distance", "eligibility_applied": false,
  "total": 0, "truncated": false, "facilities": [],
  "unlocated": {"total": 638, "count_basis": "whole_area", "areas": [
    {"sigungu_cd": "48120", "sigungu_nm": "창원시", "sido_nm": "경상남도", "label": "창원시",
     "display_label": "창원시", "scope_codes": ["48120"], "count": 638, "included_by": ["center", "evidence"]}
  ]}
}
```
(가맹 638곳이 전부 시군구 중심점 한 점에 겹쳐 있다 — 점으로 찍지 않고 "창원시 이용권 가맹시설 638곳은 정확한
위치를 확인할 수 없어 지도에 없어요 · 시군구 전체 수"로 안내한다.) 세종 z15 `36.493–36.503, 127.258–127.273`,
`program=public&limit=2`:
```json
{
  "diag_km": 1.7, "program": "public", "total": 46, "truncated": true,
  "facilities": [
    {"id": "public-402423995300201524", "name": "(사) 아라유소년 야구협회", "type": "공공체육시설",
     "sports": ["야구장", "야구장업"], "lat": 36.4978768912545, "lon": 127.265433458684,
     "coord_source": "api", "dist_km": null, "sigungu_nm": "세종시", "faci_gb": "신고", "note": null,
     "disability_support": null, "addr": "인천광역시  검단구 한들로 66-34"},
    {"id": "public-459794317379985360", "name": "한국파워점핑줄넘기클럽", "type": "공공체육시설",
     "sports": ["줄넘기", "체육교습업"], "lat": 36.4978768912545, "lon": 127.265433458684,
     "coord_source": "api", "dist_km": null, "sigungu_nm": "세종시", "faci_gb": "신고", "note": null,
     "disability_support": null, "addr": "세종특별자치시 갈매로 388(어진동)"}
  ],
  "unlocated": {"total": 95, "count_basis": "whole_area", "areas": [
    {"sigungu_cd": "36110", "sigungu_nm": "세종시", "sido_nm": "세종특별자치시", "label": "세종시",
     "display_label": "세종시", "scope_codes": ["36110"], "count": 95, "included_by": ["center", "evidence"]}
  ]}
}
```
(옛 방식 — coord_source 만 보면 — 이 범위 public 은 487곳이고 대부분 세종 한 점에 쌓인 다른 지역 시설이다.
위 첫 행이 보여 주듯 40km 안쪽·한 영역 안의 오염은 아직 남는다 — 아래 한계.)

### 알려진 한계

- 40km 안쪽·한 영역 안의 좌표 오염은 걸러지지 않는다. 세종 z15 public 46곳 중 2곳의 주소가 세종이 아니다
  (청주 주소 1행, 세종 코드로 적재된 인천 주소 1행 — 세종시청 좌표). 크기 반영 반경은 실제 외곽 시설을
  떨어뜨리는 역효과가 있어 쓰지 않았다.
- geocoded 행은 번지가 있어도 카카오가 근사 좌표를 줬을 수 있다(geocode_demo.py 가 address_type 을 검사하지 않음).
- 한 점 공유(`shared_point`)는 **번지 없는** api 행끼리만 본다. 번지가 있는 행이 근사 좌표를 함께 쓰는 경우는
  걸러지지 않는다(예: 완주산업단지 공원 4곳 — 용암리 766-1·840·829·823 — 이 한 점, 양평 용문면 여러 마을의
  게이트볼장이 면 주소 '용문로 389'로 적혀 한 점). 반대로 한 공원 안의 서로 다른 시설(예: '동락공원 족구장'·
  '동락공원 축구장', 주소 '경상북도 구미시 진미동')은 좌표가 실제로 맞더라도 주소로 확인할 수 없어 위치 미상으로
  뺀다(보수적 선택 — 주소 검색으로는 찾는다).
- 위치 미상 수는 시군구 전체 수라 범위 밖 시설이 섞이고, 겹치는 시군구 일부는 빠질 수 있다.
- 기존 `/api/assess`·`/api/facilities/search`에는 좌표 등급을 적용하지 않았다 — 자리표시 점·먼 행·한 점 공유 행의
  `dist_km`가 그대로 노출된다(후속 과제).
- 웹 지도의 **'내 위치'**(검은 점)는 여전히 시군구 중심점이다(요청에 위치가 없으면 서울시청). 범위 결과를 보이는
  동안에만 숨기고, 기본 화면·키워드 결과에서는 그대로 찍힌다.
- 범위 결과 마커는 **같은 종류·같은 좌표**만 한 마커(`같은 자리 N곳`)로 묶는다. 종류가 다른 시설(이용권 가맹·장애인
  가맹·공공)이 같은 좌표에 있으면 마커가 최대 3개 겹친다.
- MapLibre 확대·축소(±) 버튼은 29px 로 권장 44px 보다 작다(이번 범위 밖). 두 손가락 팬·핀치는 headless Chromium 의
  CDP 터치로만 확인했고 실기기에서는 검증하지 않았다.

## GET /api/fitness/items?age=N

연령군별 공식 측정항목 카탈로그(폼 동적 렌더). 항목: `{code,name,unit,factor,alt_group,higher_better,hint}`.
**파생 항목(FR-07 AC8)**은 `derived_from`(입력 스펙 `[{code,name,unit,min,max}]`)과 `formula`를 추가로 싣는다 —
현재 `bmi`: `derived_from=[height_cm(키,cm,100~250), weight_kg(몸무게,kg,20~300)]`, `formula="몸무게(kg) ÷ 키(m)²"`.
폼은 이 항목의 값 대신 입력들을 `measures`에 넣고, 서버가 계산한다(직접 `bmi`가 오면 그것이 우선).

## POST /api/fitness

요청: `{ "age": 27, "sex": "M", "measures": { "grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25 } }`
(4항목만 MVP: 악력·윗몸말아올리기·앉아윗몸앞으로굽히기·왕복오래달리기. null 허용)
`measures`에 `height_cm`·`weight_kg`가 오면 서버가 `bmi`를 계산해 판정에 넣고, 응답 `derived: [{code:"bmi", value, from:{height_cm,weight_kg}, formula}]`로 근거를 돌려준다(FR-07 AC8). 범위 밖·누락이면 계산하지 않고 `derived=[]`.

응답:
```json
{
  "weaknesses": [ { "item": "유연성", "value": -3, "band": "하위", "basis": "데모 기준(연령·성별 근사)" } ],
  "recommendations": [ { "weakness": "유연성", "exercises": ["요가","스트레칭"], "sports": ["요가","필라테스"], "curated": "체대 검증 대기" } ],
  "videos": [ { "title": "...", "url": "...", "source": "국민체력100 동영상(15108846)" } ],
  "facility_filter_sports": ["요가","필라테스"]
}
```
(`facility_filter_sports`는 아래 별칭 확장을 거친 뒤의 배열이다 — 예시는 별칭이 없는 종목이라 그대로.)
`videos`는 fixtures(2~3개)로 충분 — 실 API 연동은 키 주입 후.

**`facility_filter_sports` 종목 별칭 확장(2026-08-27 · 결정 2A · C-27)**: 추천은 "헬스"라고
말하는데 공공체육시설 데이터의 `sports`는 "체력단련장업"이라 근처 시설 매칭이 0건이었다.
서버가 **추천 종목 + 시설 데이터 표기(별칭)**를 이어 붙여 내보낸다 — 추천 원문이 앞, 별칭이
뒤, 중복 제거, 순서 보존. 예: `["헬스","유도","주짓수"]` →
`["헬스","유도","주짓수","체력단련장","체력단련장업","기타체육시설(체력단련장)","투기체육관"]`.
- 표의 소유자는 **`data/sport_alias.json` 하나**(`sigungu_alias` 선례 — 사람이 고치는 데이터).
  키 = 추천 종목명, 값 = `facilities.sports`에 **실재하는** 표기만(없는 표기를 지어내지
  않는다, P-1). `_`로 시작하는 키는 주석이며 데이터가 아니다.
- 파일이 없으면 확장 없이 원본 그대로 나간다(무중단).
- 공공체육시설 데이터에 대응 표기가 없는 추천 종목(요가·필라테스·탁구·볼링·배구·스쿼시·
  펜싱·무용)은 비워 둔다 — 파일 `_meta.no_alias`에 그대로 적어 둔다.
- 웹은 이 배열을 그대로 소비한다(매칭 로직 1벌: `web/src/lib/sports.ts`).

공식 경로(measurement_item/fitness_norm 적재 DB)에서는 `items[]`/`weaknesses[]` 에 실측 컷
인용 `comparison` 이 붙는다. 값+단위 표기는 단위가 **'기간/단위'**(`chair_stand` = `30초/회`)면
`14회(30초)` 로 풀어 쓴다 — `14` + `30초/회` 를 그대로 이어붙이면 `1430초/회` 가 되기 때문.
그 밖의 단위(`회`·`cm`·`초`·`%`·`㎏/㎡`·`ml/kg/min`)는 종전대로 붙인다. `value`/`unit` 원본
필드는 바뀌지 않는다.

## POST /api/fitness/ai

요청: `POST /api/fitness` 와 동일 바디. 응답(실측, 30세 남 `shuttle_20m=30`, LLM off):
```json
{
  "provider": "rules",
  "age_group": "성인",
  "age_gap": false,
  "약점": [ { "항목": "20m 왕복 오래달리기", "등급": "기준 미달",
             "근거": "20m 왕복 오래달리기 30회 — 30~34세 남 3등급 컷 31회 미달" } ],
  "우선순위": ["20m 왕복 오래달리기"],
  "처방": [
    { "운동": "걷기", "목표체력요인": "심폐지구력",
      "강도": "중강도 주 150~300분 또는 고강도 주 75~150분", "주당빈도": "주 3~5회",
      "provenance": { "source": "kspo_standard", "tier": "S", "weight": 1.0,
                      "curated_status": null } }
  ],
  "주의": "운동 참고 정보이며 의료 조언이 아닙니다. 통증·질환이 있으면 전문가와 상담하세요.",
  "facility_filter_sports": ["수영", "복싱", "축구(풋살)",
                             "수영장", "수영장업", "권투", "투기체육관", "축구", "축구장", "풋살장"],
  "disclaimer": "…"
}
```
- `provider`: `claude|gemini|rules` — UI 정직 라벨의 원천(FR-08 AC3).
- **`처방[].provenance`** (FR-08 AC8 서버 측): 그래프 엣지 출처. **서버 소유 필드**다 —
  LLM 이 돌려준 provenance 는 신뢰하지 않고 서버가 슬롯(그래프 추천)에서 운동명으로 다시 찾아
  덮어쓴다(P-2 날조 차단). 근거가 없으면 `null`(배지 없음 — 없는 출처를 만들지 않는다).
  - `source`: `kspo_standard`(S 공단 공식) · `guideline`(A 정부·국제 지침) ·
    `kspo_video`(V 공단 콘텐츠 분류) · `curated`(B 전문가 큐레이션)
  - `tier`: `S|A|V|B` · `weight`: 0~1 · `curated_status`: `pending|null`(B급은 "검증 중" 배지)
  - `via_goal` / `via_goal_source`: 멀티홉(운동 →targets→ 목적 →improves→ 요인) 경로일 때만.
    예: `{"source":"curated","tier":"B","curated_status":"pending",
    "via_goal":"PAPS4-5등급학생체력증진","via_goal_source":"curated"}`.
    **경로 등급 = 두 홉 중 약한 쪽**(강한 홉을 경로 전체 등급으로 올려 쓰지 않는다 — P-1).
- **소비처(웹)**: `FitnessResult.tsx` 처방 항목의 "왜 이 운동?" 펼침(FR-08 AC8) — 근거 경로 한 줄 +
  출처 배지 + FITT 수치 출처. `provenance` 가 `null` 이면 펼침 대신 "근거 정보 없음"을 렌더한다
  (구버전 캐시·그래프 미연결 항목 — 없는 배지를 만들지 않는다).
- 캐시 키 = 연령군·성별·측정값(반올림) + `norm{건수}.graph{건수}.{응답스키마버전}` 해시.
  응답 스키마 버전(`rx2` = provenance 포함)이 바뀌면 옛 캐시는 자동 무효화된다.

## GET /api/meta/sigungu
`[ { "cd": "11290", "nm": "성북구", "lat": 37.6, "lon": 127.02 } ]` — **전국 시군구**(현행
행정코드, 실 DB 233개 / DB 없는 fixtures 데모는 서울 25). `cd` 오름차순.

- 좌표를 구하지 못한 시군구는 목록에 넣지 않는다(지도에 못 찍는 좌표를 지어내지 않음, P-1).
  서울 25는 `data/sigungu_centroids.json` 시드 좌표가 우선한다.
- **구(舊) 코드는 나오지 않는다.** 2026-07-01 광주(29)+전남(46) → 전남광주통합특별시(12),
  강원(42)→51, 전북(45)→52. 구 코드는 `sigungu_alias(old_cd → new_cd)` 표에만 남는다.
- 구 코드가 **입력으로** 들어오면(전환기 잔존 링크·저장된 값) 서버가 결정론으로 현행 코드로
  해석한다 — `POST /api/assess` 의 `sigungu_cd` 에 `29170`(구 광주 북구)을 주면 `12300` 과
  같은 결과가 나온다. 별칭에 없는 코드는 지어내지 않고 그대로 조회한다.
- 표의 소유자는 `server/app/region.py` 하나이고, 적재(`scripts/build_db.py`)와 조회가 공유한다.

## GET /api/demo/personas
SPEC §5의 P1~P5를 assess 요청 바디 배열로 반환. 웹은 이걸 페르소나 버튼으로 렌더.

```json
[ { "id": "P2", "label": "27세 남 · 그 외(낀 계층) · 성북구 · 비장애",
    "expected": "…",
    "body": { "age": 27, "sex": "M", "sigungu_cd": "11290", "…": "…" },
    "demo": {
      "fitness": { "crunch_cross": 35, "shuttle_20m": 42, "sit_reach": 6,
                   "grip_rel": 58, "height_cm": 175, "weight_kg": 72 },
      "parq_preset": true
    } } ]
```

**`demo` (2026-08-27 · 결정 3A)** — 자동재생이 소비하는 프리필 계약. **모든 페르소나가
두 키를 항상 싣는다**(키 생략 없음, 웹 `normalizePersona`가 보존).
- `demo.fitness`: `POST /api/fitness`의 `measures`에 그대로 넣는 값 dict, 또는 `null`.
  항목 코드는 `GET /api/fitness/items` 카탈로그 기준(악력은 kg가 아니라 `grip_rel` %).
  키·몸무게를 실어 BMI는 서버가 파생한다(FR-07 AC8).
- `demo.parq_preset`: PAR-Q 문진을 데모용으로 미리 채울지(`boolean`). 채운 화면에는
  "데모 페르소나 문진 프리셋 — 실사용은 직접 확인" 라벨이 붙는다(P-1).
- 현재 값: **P2·P5만** `fitness` 있음 + `parq_preset:true`, P1·P3·P4는
  `{"fitness": null, "parq_preset": false}`.
- 값의 근거: 실 DB `fitness_norm` 연령·성별 컷 실측이며 **약점이 정확히 1건(근지구력)**
  나오도록 골랐다 — P2는 25~29세 3등급 컷 38 대비 35, P5는 30~34세 컷 35 대비 33.
  회귀 방지는 `server/tests/test_personas_demo.py`.

## POST /api/chat/nlu (v2 챗 — 자유 텍스트 이해 전용, 2026-08-18)

칩(버튼) 입력은 이 엔드포인트를 호출하지 않는다 — 클라 상태기계가 슬롯을 직접 갱신하고
기존 `/api/assess` 등을 호출한다. 자유 텍스트가 왔을 때만 호출.

요청:
```json
{
  "text": "저 14살이고 성북구 살아요",
  "slots": {
    "age": null, "sex": null, "sigungu_cd": null,
    "income_class": null, "disability": { "has": null, "type": null },
    "special": []
  },
  "phase": "collect"
}
```
`phase`: `collect | fitness | qa` — 현재 대화 단계 힌트(추출 대상 슬롯 제한용).

응답:
```json
{
  "slot_updates": { "age": 14, "sigungu_cd": "11290", "sigungu_nm": "서울특별시 성북구" },
  "intent": "provide_info",
  "faq_key": null,
  "region_candidates": [],
  "reply": "성북구에 사시는군요!",
  "answer": null,
  "provider": "openai"
}
```
- `intent`: `provide_info | ask_faq | start_fitness | show_map | restart | unknown`
- `region_candidates`: 시군구 모호 시 `[{cd, nm}]` — 클라가 칩으로 재질문 (예: "서구" → 인천/광주/대구 서구)
- `reply`: 후필터 통과분만. 폐기·폴백 시 `null` — 클라는 템플릿 발화 사용.
- `answer`: 질문형 발화에 대한 자연어 답변(2~4문장) — fact-lock 통과분만. 비질문·재료 밖 질문·
  폐기·폴백 시 `null`. `reply`(공감·전환 한 줄)와 역할이 다르다 — `answer`가 있으면 클라가 본문으로 쓰고,
  `null`이면 기존 `faq_key` 카드로 폴백한다.
- `provider`: `openai | rules`

규칙:
- LLM은 지역을 **원문 문자열까지만** 추출한다. 시군구 코드 확정은 서버가 sigungu 테이블 대조로
  결정론 수행(정확 1건→확정, 복수→region_candidates, 0건→미갱신). LLM이 코드를 고르지 않는다.
- `slot_updates`는 AssessRequest 필드 검증(pydantic) 통과분만 반영. enum 밖 값은 버린다.
- `special`(2026-09-23): LLM 이 `multichild`/`defector` 배열로 추출하되, 어휘 밖 값은 버리고 **발화에
  해당 단서가 있을 때만** 채택한다(다자녀: "다자녀·셋째·세 자녀·아이가 셋·삼남매…", 북한이탈주민:
  "탈북·북한이탈·새터민…"). 자가선언이 곧 판정 재료라 LLM 창작을 결정론으로 한 번 더 막는다.
  `rules` 폴백에서는 다른 슬롯과 같이 비어 있다(규칙 슬롯 추출 경로 없음).
- `reply` 후필터: 숫자·금액·%·프로그램명·자격 단정 표현 감지 시 폐기(null). 사실 문장은 전부
  클라 템플릿+엔진 출력(P-2).
- `reply` **정합 보정**(2026-08-27 · 결정 CQ5A · ⚠#14): 후필터 통과 후, `slot_updates`와
  어긋나는 발화를 템플릿으로 바꾼다. ① `slot_updates`가 비었는데 "확인해 뒀어요/기록했어요"
  류(D-08) → 중립 템플릿("아직 반영된 정보는 없어요 …", 사실·자격 단정 없음). ② `slot_updates`가
  있는데 "확인이 필요해요/확실하지 않아요" 류(D-10) → 확정 템플릿("확인했어요 — …"). 그 밖은
  원문 그대로, `null`은 `null`. 템플릿은 슬롯 값을 되읊지 않는다(값 자체가 사실 문장이 될 수 있음).
- `answer` 접지 레인(v1.9 · FR-13 AC9): 재료는 서버가 시스템 프롬프트에 주입한 **검증 텍스트
  (`GET /api/chat/faq` 사전 전문)뿐** — LLM은 그 안의 사실만 표현한다(원천 불변, 표현 주체만 LLM).
- `answer` fact-lock 후필터: ①숫자 토큰(자릿수 콤마 제거 정규화)이 재료 원문에 전부 실재 ②제도명
  (rules.json 프로그램명 + `…이용권/바우처/수당/연금/포인트/카드/권` 형태)이 재료에 실재 ③2인칭
  자격 단정("당신·고객님·회원님 … 자격/대상/선정/받을 수 있") 상시 차단 ④400자 상한·URL 표기 금지.
  하나라도 걸리면 `answer=null`(무응답이 오답보다 낫다).
- `answer` 채택 시에도 출처는 동반한다 — `faq_key` 라우팅은 그대로 나가므로 클라가 해당 카드를 붙인다.
- `provider:"rules"`(off/실패/쿼터 소진)면 `slot_updates`는 항상 빈 객체 — 클라는 칩 모드 강등 +
  정직 라벨("규칙 기반 모드").
- 발화 원문·슬롯은 서버 로그에 기록하지 않는다(P-3). 관측 로그는 `{provider, ms, ok, fallback_reason}`만.
- 레이트리밋: `chat` 버킷 20/min.

## GET /api/chat/faq (v2 챗)

```json
[ { "key": "dvoucher_income", "q": "장애인 이용권도 소득 기준이 있나요?",
    "answer": "…", "source_url": "…", "checked": "2026-07-20" } ]
```
- 답변 본문은 rules.json의 `verified` 필드에서만 조립(SPEC §0-5 날조 금지) — LLM은 자유 질문을
  `faq_key`로 라우팅하고, 이 사전 전문을 재료로 받아 `answer`만 표현한다(v1.9 접지 레인, 위 참조).
- 칩 모드(FAQ 목록 버튼)와 NLU 라우팅(`intent:ask_faq`) 양쪽이 같은 사전을 소비한다. 정적·캐시 가능.

## 짧은 주소 리다이렉트 (2026-08-27 · 결정 4A)

`/api` 밖의 서버 라우트 2개. `server/app/serve.py`가 `mount("/", …)` **앞**에 등록한다
(뒤에 두면 정적 서빙이 먼저 잡아 404). 개발 서버(`app.main` 단독)에는 없다.

| 요청 | 응답 | 비고 |
|---|---|---|
| `GET /demo?p=P2&auto=1` | `302` → `Location: /#/demo?p=P2&auto=1` | 쿼리를 **해시 안쪽**으로 보존 |
| `GET /demo` | `302` → `Location: /#/demo` | 쿼리 없으면 그대로 |
| `GET /gap` | `302` → `Location: /gap.html` | 뒷면 공급공백 정적 표(W3 산출물) |

- 보고서 QR은 `/demo?p=P2&auto=1`을 찍는다 — PDF 링크 추출에서 fragment(`#…`)가 탈락하는
  것을 피하려고 서버가 해시 주소로 넘긴다. 클라(`web/src/chat/route.ts`)는 `location.search`가
  아니라 **해시 내부**의 쿼리를 읽는다.
- `/`는 그대로 `index.html`(`Cache-Control: no-cache`)을 서빙한다.
