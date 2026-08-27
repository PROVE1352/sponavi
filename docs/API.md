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
  "location": { "lat": 37.60, "lon": 127.02 }
}
```
`location` 없으면 시군구 중심좌표 사용.

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
  }
}
```
규칙: `eligible=true`인 제도가 있으면 path는 직접 경로(자격 ✓ → 신청·근처). 없으면 alt_edges의
**첫 항목**(= 아래 dedupe·공식확인 우선 정렬의 1순위)으로 멀티홉 경로 구성 — 경로 그림의 대체 홉과
`alt_edges[0].to`는 항상 같다. `supply_gap`은 항상 포함(있어도 통계 노출). 이용권 카운트는 구 단위(`voucher_scope:"sigungu"`)이며 행정구역 개편 전환기 영역그룹(FR-05 AC4, 예: 인천 서해구·검단구 ← 옛 서구)이면 `scope_codes`에 합산한 코드들, `scope_label`에 "○○ 일대(옛 △△)", `scope_reason`에 사유가 실린다(그룹이 아니면 자기 코드 1개·null).

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
- 실측(P2 = 27세·비장애·그외): `["tteuntteun"(공식), "culture_deduction"(공식),
  "public_program"(검증 대기)]` — 3줄, dedupe 전에는 5줄이었다.

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
    "income_class": null, "disability": { "has": null, "type": null }
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
