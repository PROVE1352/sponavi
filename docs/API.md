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
  "nearby": {
    "voucher_facilities": [ { "id": "V1", "name": "성북 OO스포츠클럽", "sports": ["수영"], "lat": 0, "lon": 0, "dist_km": 0.5, "fee_month": 90000, "subsidy": 105000, "copay": 0, "disability_support": null } ],
    "alternatives":       [ { "id": "F1", "name": "성북구민체육센터", "type": "공공체육시설", "sports": ["요가"], "lat": 0, "lon": 0, "dist_km": 0.7, "note": "저가 오전시간대", "disability_support": true } ]
  },
  "supply_gap": {
    "radius_km": 3, "voucher_count": 0, "alt_count": 2,
    "nearest": { "name": "...", "dist_km": 4.2 },
    "message": "반경 3km 내 이용권 가맹시설이 없습니다",
    "coverage": { "sigungu": "성북구", "class": "차상위·한부모", "target": 602, "recipient": 9, "rate": 0.015, "year": 2025 }
  }
}
```
규칙: `eligible=true`인 제도가 있으면 path는 직접 경로(자격 ✓ → 신청·근처). 없으면 alt_edges를
순서대로 평가해 첫 성립 대안으로 멀티홉 경로 구성. `supply_gap`은 항상 포함(있어도 통계 노출).

## POST /api/fitness

요청: `{ "age": 27, "sex": "M", "measures": { "grip_kg": 30, "situp_cnt": 20, "flex_cm": -3, "shuttle_cnt": 25 } }`
(4항목만 MVP: 악력·윗몸말아올리기·앉아윗몸앞으로굽히기·왕복오래달리기. null 허용)

응답:
```json
{
  "weaknesses": [ { "item": "유연성", "value": -3, "band": "하위", "basis": "데모 기준(연령·성별 근사)" } ],
  "recommendations": [ { "weakness": "유연성", "exercises": ["요가","스트레칭"], "sports": ["요가","필라테스"], "curated": "체대 검증 대기" } ],
  "videos": [ { "title": "...", "url": "...", "source": "국민체력100 동영상(15108846)" } ],
  "facility_filter_sports": ["요가","필라테스"]
}
```
`videos`는 fixtures(2~3개)로 충분 — 실 API 연동은 키 주입 후.

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
  "facility_filter_sports": ["수영", "복싱", "축구(풋살)"],
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
- 캐시 키 = 연령군·성별·측정값(반올림) + `norm{건수}.graph{건수}.{응답스키마버전}` 해시.
  응답 스키마 버전(`rx2` = provenance 포함)이 바뀌면 옛 캐시는 자동 무효화된다.

## GET /api/meta/sigungu
`[ { "cd": "11290", "nm": "성북구", "lat": 37.6, "lon": 127.02 } ]` — 서울 25구.

## GET /api/demo/personas
SPEC §5의 P1~P4를 assess 요청 바디 배열로 반환. 웹은 이걸 버튼 4개로 렌더.

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
