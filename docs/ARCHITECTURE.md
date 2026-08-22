# 스포내비 아키텍처 v1

> 작성 2026-07-20. 현 MVP(동작 중) 구조의 확정 기술문서 + M1(AI 처방)·M3(배포) 설계 계약.
> 원칙: **틀리면 안 되는 것은 결정론, 섬세함이 값인 것만 AI. 데이터는 전량 로컬 적재 후 쿼리.**

## 1. 시스템 개요

```
                    ┌───────────────────────── 오프라인 파이프라인 ─────────────────────────┐
  KSPO 오픈API 5종 ────▶ bulk_fetch.py ──┐
   (28만 행, ~282콜)                      │
  운동영상 API 7종 ────▶ fetch_videos.py ─┤
   (15,045행, ~50콜)                      ├─▶ data/raw/* ─▶ build_db.py ──▶ sponavi.db
  sv/dv 웹 공개조회 ──▶ scrape_sv/dv.py ──┤    (전량 보존)   (매핑·조인·정규화)    (SQLite)
   (접근성·신청기간, E74~76)               │               build_graph.py ─▶ graph_* 테이블
  nfa 인증기준 HTML ──▶ scrape_norms.py ──┘               (지식그래프, docs/FITNESS_GRAPH.md)
                    └──────────────────────────────────────────────────────────────────┘

  브라우저(모바일 우선)                          FastAPI 서버 (server/app)
 ┌─────────────────────┐   /api (JSON)   ┌──────────────────────────────────────────┐
 │ React 19 + Vite     │ ◀─────────────▶ │ main.py   엔드포인트·CORS·에러봉투           │
 │  위저드 → 결과 3블록  │                 │ engine.py 자격판정·대체경로·거리·공급공백 (결정론) │
 │  경로시각화·MapLibre │                 │ store.py  SQLite 쿼리 (없으면 fixtures 폴백)  │
 │  목모드(VITE_MOCK)   │                 │ fitness.py 룰 기반 약점판정 (AI 폴백겸용)      │
 └─────────────────────┘                 │ ai.py[M1] LLM 처방 (프로바이더 추상화)        │
                                         └───────────────┬──────────────────────────┘
                                                         │ shell-out / SDK
                                              ┌──────────┴──────────┐
                                              │ LLMProvider          │
                                              │  now: claude CLI     │
                                              │  prod: Gemini API    │
                                              │  fail: rules 폴백     │
                                              └─────────────────────┘
```

- 실시간 외부 API 호출 없음(오프라인 적재) → 심사 시연 중 외부 장애·rate limit 무관.
- rules.json(자격·대체경로·fitness_map)이 결정론 레인의 단일 진실. 공식 출처·확인일 포함.

## 2. 컴포넌트 상세

### 2.1 web/ (React 19 · Vite 7 · TS · Tailwind v4 · MapLibre GL+OpenFreeMap — v1.8, 구 Leaflet+OSM)
- **[v2 2026-08-18] UX 전면 전환**: 위저드 → 챗 단일 UI + 컨텍스트 패널(계약 §11). 아래 결과 블록 컴포넌트들은 챗 스트림·패널에 그대로 재사용.
- 화면(v1, §11 전환 전 기록): 위저드(입력) → 결과[자격카드 | 경로 스텝다이어그램 | 지도+리스트] + 공급공백 배너 + 체력처방 스텝 + 페르소나 4버튼.
- `VITE_MOCK=1` 목모드: 서버 없이 계약-형태 목으로 완전 동작(개발·시연 이중화).
- `api/client.ts`가 서버 응답 변형(personas 중첩 body 등)을 흡수 — 계약 방어층.

### 2.2 server/ (FastAPI · Python 3.11+ · 의존 최소)
- `engine.py` — 순수함수 규칙 평가: eligibility(사유 배열 생성) → 실패 시 alt_edges 순차 평가로 멀티홉 path 구성 → 하버사인 거리 → supply_gap(반경 3km 카운트 + coverage 조인). LLM·네트워크 무접촉.
- `store.py` — `data/sponavi.db` 존재 시 SQL(인덱스: sigungu_cd·source·facility_id), 부재 시 fixtures. 공개 함수 시그니처가 계약이라 데이터소스 교체가 상위에 불가시.
- **반경 쿼리 전략**: 하버사인 전행 스캔 금지 — 위경도 바운딩박스 프리필터(`idx_fac_geo`, Δ≈radius/111km)로 후보 축소 후 하버사인 정밀 계산. 15.5만 행 기준 벤치를 §9 게이트에 포함.
- 에러 봉투 `{"error":{"code":"UPPER_SNAKE","message":"한국어"}}` 통일.

### 2.3 데이터 파이프라인 (scripts/)
- `bulk_fetch.py` — 5개 API 전량(페이지 1000행 상한 실측). 소스별 완료 즉시 저장(중단 안전), 재시도 6회·타임아웃 60s(게이트웨이 지연 실측 반영). **호출 ~282회 ≪ 일 10,000 한도.**
- `build_db.py` — idempotent(매번 재생성). 핵심 정규화:
  - 시군구코드: voucher/dvoucher=`local_cd` 그대로. public=시군구명→코드 역매핑(99.2% 실측; '전남광주통합' 라벨은 [46,29] 팬아웃 역판별).
  - 좌표: public=`faci_lat/lot` 실좌표, 그 외=sigungu centroid 폴백(서울 seed + public 좌표 평균).
  - 폐업 제외(public 34,925건), 강좌 조인 voucher=(brno,facil_sn) 95.9%.
  - **dvoucher 강좌는 시설과 공통키가 API에 실부재** → facility_id NULL 보존(시군구 레벨 노출).
- **웹 보조 소스 스크레이퍼 (2026-07-21 실사 E74~78 반영, 신규)**:
  - `scrape_dvoucher.py` — ①목록 스윕(`memberFacilityListAjax.do`, 10,016건·페이지당 10행 ~1,000콜): 시설별 **장애지원유형**·사진·소개 ②편의시설 11종 필터 스윕(필터별 재조회, 세트 멤버십으로 태깅 ~1,100콜) ③상세는 데모 구만(차량지원·support-table). 요청 간 1s 딜레이(예의), 폼 전체 직렬화 필수(부분 파라미터 = 에러 실측).
  - `scrape_svoucher.py` — 시설 목록(`memberFacilityListAjaxView.do`, 25,036건). **신청기간·대면/비대면**은 시설 단위 강좌 페이지(~25k콜)라 후순위(야간 배치·M2).
  - **조인 검증**: 웹(bizrno,alsfcSn) ↔ API(brno,facil_sn) 표본 200건 대사를 build_db 게이트로 — 불일치율 기록 후 임계 초과 시 웹 필드 미적재(정직 우선).
  - **폴백 원칙**: 웹 필드는 전부 NULL 허용 애드온 — 스크레이핑 실패해도 API-only로 전 기능 동작. 제출물 표기 "공단 웹서비스 공개 조회 파싱(보조)".
- `scrape_norms.py` — nfa 인증기준 HTML 1페이지 → `fitness_norm`(공식 컷). 파서 주의는 FITNESS_GRAPH §4(연령군별 헤더·colspan 대체항목·어르신 표 15개·부등호 문자열 셀).
- `fetch_videos.py` — 영상 API 7 오퍼레이션 전량(~50콜) → 그래프 Exercise 노드·V급 엣지 원천.
- 갱신 전략: 월 1회 bulk_fetch+scrape_* → build_db → build_graph (cron 후보, 배포 후). **크론 실패 시 `/api/health`에 데이터 기준일 stale 표시.**

### 2.4 DB (SQLite 운영 · MySQL DDL 제공)
- 테이블: `sigungu`(허브) / `facilities`(15.5만) / `courses`(9만) / `coverage`(수급 통계) + M1용 `measurement_item`·`fitness_norm`. ERD·MySQL 8.0 DDL은 `docs/schema.mysql.sql`.
- 허브 조인: 자격판정 지역·시설검색·커버리지·공급공백이 전부 `sigungu_cd` 한 키.

#### 지역 코드 정규화 (2026-08-22, `server/app/region.py` + `sigungu_alias`)
허브 키가 하나여도 **그 키의 표기가 둘이면 조인이 조용히 갈라진다**. 공단 API 는 전환기라
구·신 코드를 섞어 주고(2026-07-01 광주 29·전남 46 → 전남광주통합특별시 12, 강원 42→51,
전북 45→52), 그 결과 광주 북구를 29170 으로 물으면 dvoucher 0건 → "가맹 0곳"이라는 **거짓
공급공백**이 떴다. 그래서 코드 축을 적재 시점에 하나로 접고, 표는 한 곳에서만 소유한다.
- 통합(29·46→12)은 코드 뒷자리가 보존되지 않아 **이름으로** 크로스워크를 도출한다(통합 시도
  안의 이름 유일성을 실제로 검증한 뒤에만 — 충돌하면 추측하지 않고 unresolved 로 보고).
  재코딩(42→51, 45→52)은 뒷 3자리 + 이름 일치까지 확인될 때만 매핑한다. 실측 45건.
- 마스터(`sigungu`)에는 현행 코드만 남기고(278→233), 구 코드는 `sigungu_alias(old_cd,
  new_cd, reason)` 로 옮긴다. 입력으로 구 코드가 오면 `store.canonical_sigungu()` 가
  결정론으로 해석한다(`engine.assess` 진입점 1곳).
- 공공시설의 시군구는 이름 대조 → **개칭 별칭**(인천 남구→미추홀구) → 주소 앞 2토큰 정확일치
  → 시군구가 1곳뿐인 시도 순으로 확정한다. 이 사다리로 미매칭 964건 → 0건(117,863/117,863).
- **분할은 정규화하지 않는다.** 2026-07-01 인천 개편에서 서구(28260)는 서해구(28275)·
  검단구(28290) 둘에 걸친다 — 1:N 은 이름만으로 갈 수 없으므로 구 코드를 그대로 두고 문서에
  남긴다(§5 한계표). 추측 매핑 금지. **대신 카운트 영역그룹**(`region.SIGUNGU_GROUPS`,
  FR-05 AC4): 공급공백의 구 단위 카운트만 옛/신 코드를 합산하고(서해구·검단구 일대 ← 옛 서구,
  제물포구·영종구 일대 ← 옛 중구·동구) 응답 `scope_codes/scope_label/scope_reason` 으로 밝힌다.
  시설·마스터 코드는 그대로다.
- 적재(`scripts/build_db.py`)와 제자리 이관(`scripts/migrate_region_codes.py`)이 같은 표를
  쓰고, 후자는 `--verify-against` 로 전체 재빌드 결과와 시군구×source 카운트 일치를 증명한다.
- **[스키마 v2 개정 예정 — 일괄 1회 마이그레이션(build_db 재생성이라 비용 최소)]**
  1. `facilities.coord_source ENUM('api','centroid','geocoded')` — 좌표 배지(FR-04)·M2 지오코딩의 전제(source로 유추하는 현행 방식은 지오코딩 도입 시 붕괴).
  2. `facility_accessibility`(facility_id, kind{disability_type|amenity|vehicle}, code, name, source, checked) — dvoucher 웹 장애유형 8종·편의시설 11종·차량지원.
  3. `courses` 확장: `apply_start/apply_end`(신청기간)·`online_yn`(대면/비대면)·`intro`(소개) — 전부 NULL 허용(웹 소스).
  4. `fitness_norm` 구조 교체: p20/p50/p80 → **등급컷**(grade{1,2,3}, cut_value DECIMAL NULL, cut_rule VARCHAR NULL — "BMI 18.5이상 25미만" 같은 문자열 규칙 셀 보존, 둘 중 하나 필수) + source·checked.
  5. `measurement_field_map`(item_code ↔ api_field 'item_fNNN', 미상 필드는 미등재) — 입력폼(공식 항목명)과 백분위 규준(API 필드)의 이름공간 연결.
  6. `graph_nodes`/`graph_edges` — FITNESS_GRAPH §2 스키마(엣지에 source·evidence·curated_status 필수).

## 3. 결정론 엔진 계약 (레인1·2)

- 입력(자가선언): 나이·성별·시군구·소득계층·장애{유무,유형}. **개인정보 저장 없음**(요청-응답 한정).
- eligibility 평가 순서: 장애→dvoucher, 비장애→svoucher (주 제도 1개). 각 조건마다 `{field, ok, message}` 사유 생성 — 이 사유가 UI "왜?"의 원천.
- **예상 선정순위(3심 반영)**: dvoucher 대상자는 rules.json `selection_priority`(공식 5단계)로 나이·소득계층 → 예상 순위를 결정론 계산해 카드에 표기 — "신청은 소득 무관 / 선정은 우선순위" 이중 구조(FR-02 AC3). LLM 무관여.
- path 생성: 자격 성립 → [person→제도✓→시설]. 실패 → alt_edges에서 조건(`income_fail`/`age_fail`) **매칭 엣지 전부 평가** — 주 경로는 최상위 1개로 그리되 응답에 나머지 매칭 엣지를 `alternatives_edges`로 동봉, UI가 상위 3개 노출(FR-02 AC5 — 3심에서 "첫 매칭 break로 엣지 9개 중 1개만 노출"이 치명결함 판정됨). 엣지의 `curated` 필드가 UI 뱃지로.
- supply_gap: **이용권(voucher/dvoucher)은 사용자 시군구 기반 "구 단위 가맹 N곳"**(centroid 좌표 위 반경 계산 금지 — FR-04 AC2), public/대안만 실좌표 반경 카운트. 최근접 표기는 실좌표면 km, 근사면 시군구명. + coverage(시군구·계층). **항상 반환**(정직 신호 상시).

## 4. API 표면

| 엔드포인트 | 역할 | 상태 |
|---|---|---|
| POST `/api/assess` | 자격판정+경로+근처자원+공급공백 | ✅ |
| POST `/api/fitness` | 룰 기반 약점→운동 (AI 폴백 겸용) | ✅ |
| POST `/api/fitness/ai` [M1] | 전 측정항목 → LLM 처방 | 설계 확정(§6) |
| GET `/api/meta/sigungu` · `/api/demo/personas` | 메타·데모 | ✅ |
| GET `/api/health` | `{status, mode: db\|fixtures, llm: 프로바이더}` | 라벨 갱신 예정 |

## 5. 관측된 실데이터 한계와 아키텍처적 대응 (날조 금지의 구조화)

| 한계(실측) | 대응 |
|---|---|
| voucher/dvoucher 좌표 없음 — **공단 자체 DB도 빈값 확인(E77: 상세페이지가 카카오 지오코더로 실시간 변환+실패 2곳 하드코딩)** | centroid 폴백 + coord_source 플래그 + "위치 근사" 배지(FR-04) → M2 카카오 지오코딩(공단과 동일 방식 — 정당성 실증됨) |
| dvoucher 강좌 조인키 없음 | 시군구 레벨 노출 + 공단 데이터 개선 제안(제출물 소재) |
| coverage 서울 15구뿐 | 없는 구 null → UI "데이터 없음" (거짓 통계 금지) |
| API에 접근성 필드 없음 | **dvoucher 웹 공개조회로 해소(E76)**: 시설별 장애지원유형 8종·편의시설 11종(휠체어대여 577·수중리프트 177 실측) → facility_accessibility 적재. public은 여전히 '미상' 구분 |
| 측정결과 API 2011~2019·유아 없음·오프셋 100만 페이징 한계(E80) | 백분위 보조 규준에 "측정 데이터 기준 시점" 표기, 판정 정본은 공식 컷(E79), 유아는 영상 콘텐츠로만 대응 |
| 만 7~10세 공식 기준 공백(E79) | 입력폼에서 숨기지 않고 고지 + 유소년 콘텐츠 참고 제공 |
| **행정구역 개편 전환기 — 원천이 구·신 코드 혼재**(2026-07-01 광주+전남→12, 인천 구 재편; 강원 42→51·전북 45→52) | 적재 시 현행 코드로 정규화 + `sigungu_alias` 로 구 코드 입력 해석(§2.4 지역 코드 정규화). 크로스워크는 데이터에서 도출하고 근거 없으면 unresolved 로 보고 |
| **분할된 시군구는 1:1 매핑 불가** — 인천 서구(28260)가 서해구(28275)·검단구(28290) 둘에 걸친다. voucher 는 아직 28260(383곳)을, dvoucher 는 신코드(70+44곳)만 쓴다 | 구 코드 그대로 유지(추측 매핑 금지). **주의: 28260 의 "dvoucher 0곳"은 공급 부재가 아니라 코드 전환기 잔재일 수 있다** — 같은 주소·같은 시설이 28260(voucher)과 28290(dvoucher) 양쪽에 존재하는 것을 실측(예: "CM건강운동센터 검단점" 이음5로 34). → **2026-08-22 확정: 코드 전환기 잔재.** 영역그룹 카운트(FR-05 AC4)로 거짓 배너 차단, P4 데모는 강원 고성군(실제 0곳)으로 이동 |

## 6. [M1 계약] AI 체력 처방 레이어

> 2026-07-21 실사로 상향: 판정 기준은 공식 컷오프(nfa 인증기준표 스크레이핑), 추천은 체력 지식그래프 경유로 확정 — 상세 `docs/FITNESS_GRAPH.md`. 아래 6.1~6.4 계약(프로바이더·캐시·후처리)은 유효하며, 6.3의 입력에 "그래프 서브그래프 슬롯"이 추가된다.

### 6.1 프로바이더 추상화
```python
class LLMProvider(Protocol):
    name: str
    def prescribe(self, profile: FitnessProfile) -> Prescription: ...

# 구현체
ClaudeCLIProvider   # 현행: subprocess ["claude","-p","--model","sonnet"], 타임아웃 90s (실측 42s/건)
GeminiProvider      # 프로덕션: GEMINI_API_KEY, 동일 프롬프트·스키마
RulesFallback       # LLM 실패/타임아웃 시 fitness_map 규칙 — 서비스 무중단 보장
# 선택: env SPONAVI_LLM=claude|gemini|off (off=폴백 고정)
```

### 6.2 입력 — measurement_item 전 항목
- 연령군(유아·청소년·성인·어르신)별 해당 항목만 동적 폼(카탈로그 쿼리). null 허용(측정한 것만).
- 항목 예: 신장·체중·체지방률·허리둘레·혈압 / 악력(좌·우·상대) / 윗몸말아올리기·교차윗몸 / 앉아윗몸앞으로굽히기 / 왕복오래달리기·스텝검사·6분걷기·VO₂max / 제자리멀리뛰기·반복점프 / 일리노이·10m왕복 / 8자보행·의자앉았다일어서기(어르신) / 협응력(유아) — `measurement_item.factor`로 9개 체력요인 분류.

### 6.3 프롬프트·출력 계약
- 시스템: "국민체력100 데이터 기반 운동처방 보조. 진단·치료 조언 금지. JSON만."
- 입력 직렬화: 프로필 + 항목별 {값, 단위, 요인, higher_better} + (있으면) fitness_norm 등급.
- 출력 JSON 스키마(서버 pydantic 검증, 실패 시 1회 재시도 후 폴백):
  `{"약점":[{항목,등급,근거}], "우선순위":[], "처방":[{운동,목표체력요인,강도,주당빈도,provenance}], "주의":""}`
  `provenance` 는 **서버가 채우는 필드** — LLM 이 무엇을 돌려주든 슬롯(그래프 추천)의 출처로
  덮어쓴다(P-2 날조 차단). 프롬프트에는 아예 넣지 않는다. 상세 계약은 API.md `/api/fitness/ai`.
- 후처리(결정론): 처방 운동명 → fitness_map/종목 사전으로 정규화 → `facilities.sports` 매칭 → "이 운동 되는 근처 강좌" 반환. **LLM은 시설·가격·자격을 절대 언급하지 않음**(프롬프트 금지 + 후처리에서 무시).
- UI 표기: "AI 보조 처방(전문가 큐레이션 규칙 검증) · 의료 조언 아님".

### 6.4 비용·성능
- 캐시 키: (연령군·성별·항목값 반올림) 해시 **+ norm_version + graph_version + 응답스키마버전** — 기준표·그래프·응답 스키마 갱신 시 스테일 처방 자동 무효화. SQLite 캐시 테이블, TTL 없음(같은 키=같은 답).
- 비동기 UI(처방 스텝만 로딩 상태), 실측 42s → 캐시 적중 시 0s. 페르소나 4종은 배포 시 사전 캐시(워밍).

## 7. [M3] 배포 아키텍처 (기존 오라클 A1 재사용)

```
사용자 ── HTTPS ──▶ Caddy(시스템) ──▶ sponavi.kro.kr → 127.0.0.1:8100 (FastAPI 컨테이너)
                        ├─ stockllm.kro.kr → :8765        ├─ 정적 web/dist 서빙(FastAPI StaticFiles)
                        └─ nodian.kro.kr  → :3000         └─ sponavi.db 볼륨 마운트(빌드 산출물)
```
- Docker 단일 컨테이너(웹 정적+API), compose로 재시작 자동. 인증서는 Caddy 자동(kro.kr LE 한도 시 ZeroSSL EAB — 기보유 노하우).
- **PWA 주의(실전 교훈)**: nodian 서비스워커 denylist 사례처럼, 도메인 분리로 SW 간섭 원천 차단.
- DB는 서버에서 월 1회 파이프라인 재실행(키는 서버 .env). 크론 실패 = `/api/health`의 데이터 기준일로 감지(수동 점검 주 1회, v1은 알림 없음 — 기록해두는 트레이드오프).
- **⚠ 운영 리스크(E23)**: 이용권 등록강좌 API는 운영단계 전환 시 자동승인이 아닌 **심의승인** — 제출 일정 역산에 심의 기간 반영, 승인 전엔 개발계정(일 10,000콜)로 충분(월 1회 전량 ~282콜).

## 8. 보안·개인정보

- 입력(소득계층·장애 등 민감)은 **저장하지 않음** — 요청 처리 후 폐기, 로그에 바디 미기록. **체력측정값·PAR-Q 스크리닝 응답도 동일 원칙**(건강정보 민감도는 소득 이상).
- LLM 전송분은 측정수치·연령군·성별만(이름·주소 없음). 캐시 키는 해시.
- 자격 표현은 항상 "예상"+공식 링크 — 법적 판정 아님 고지. 체력 등급은 항상 "참고 등급(추정)" — 공식 인증은 체력인증센터만 가능(제도상 자가측정=비인증, E79).

## 9. 품질 전략

- 서버 pytest 42+ (자격 매트릭스·경계나이·라우팅·공급공백·copay·계약 형태) — CI 후보.
- 웹 tsc+vite build + 목모드 Playwright 4페르소나.
- 통합: 실서버 Playwright(P1~P4 기대문구+스크린샷) — 릴리스 게이트.
- M1 추가: 프롬프트 회귀(고정 프로필 3종 스냅샷), 스키마 검증 실패→폴백 테스트, **컷오프 파서 회귀(공식 페이지 수기 대조 표본 3개 — 성인남19-24·어르신남65-69·유소년남11 고정), 캐시 버전 무효화 테스트(graph_version 변경 → 재계산)**.
- 성능 벤치: 반경 쿼리(바운딩박스+하버사인) 15.5만 행 p95 측정 — NFR-1(500ms) 게이트에 편입.

## 10. v2 로드맵(기획서 §9 이후) — 기록해두는 판단

- **운동명 온톨로지 → 체력 지식그래프로 승격 (2026-07-21 갱신)**: GraphRAG 판단을 레인별로 분리 — **자격·경로 레인은 비채택 유지**(결정론이어야 하고, 정형 데이터라 SQL이 정확·저렴 — 2026-07-20 판단 유효), **처방 레인은 채택**. 처방 질의는 멀티홉(약점요인→운동→종목→접근성→강좌)이고 매 홉에 출처 있는 엣지가 필요해 그래프가 정합. 설계 전문: `docs/FITNESS_GRAPH.md` (공식 컷오프 스크레이핑·엣지 provenance 5등급·공급 인지 처방). 임베딩은 운동명 정규화 잔여분에만 — R은 벡터가 아니라 그래프 탐색.
- 커버리지 전국화, 지자체용 공백 대시보드(발전가능성 축), 알림(신규 가맹 시 재안내).
- **3심 확정 우선순위 (2026-07-21)**: 실접수마감 10/2(재판부 확인). 범위 압박 시 **드롭 순서 고정 — ①문화비 소득공제 크롤링(유일 미실증 경로) ②FR-11 신청기간(~25k콜) ③그래프 B티어 큐레이션**. 헤드라인은 PRD §0.5(삼중 장벽, 3번 절 7/27 조건부). 작업 규율: 조사·문서 1건 = 구현 FR 1개 선행(3심 명령 1의 커플링 규칙) — "완벽한 기소장, 미완성 제품" 궤도 차단.

## 11. [C 계약] 챗 오케스트레이션 (v2 UX, 2026-08-18)

> UX 전면 전환: 위저드 → **챗 단일 UI + 컨텍스트 패널**(데스크톱 우측 ~40%, 모바일 상단 접이식 시트).
> FITNESS_GRAPH §5와 동일 문법: **[결정론 대화정책(클라)] → [LLM은 NLU만] → [후처리 결정론(서버)] → [카드 렌더(기존 컴포넌트)]**.
> 요구는 PRD FR-12·13, HTTP 계약은 API.md `/api/chat/*`.

### 11.1 역할 분담 — 서버 무상태 유지가 제1 제약

```
[칩/버튼 입력]   → 클라 상태기계(policy.ts)가 슬롯 직접 갱신 — LLM 0회, 서버 챗 엔드포인트 무호출
[자유 텍스트]    → POST /api/chat/nlu — LLM 허용 역할 3가지뿐:
                   ① 슬롯 추출(지역은 원문 문자열까지 — 코드 매칭은 서버 결정론)
                   ② 연결 멘트(후필터 통과분만 — 숫자·제도명 감지 시 폐기)
                   ③ FAQ 라우팅(faq_key만 — 답변 본문은 rules.json 조립 사전)
[슬롯 완성]      → 클라가 기존 /api/assess 호출 → 판정·경로·시설·공백 카드를 스트림에 임베드
[체력 레인]      → PAR-Q 턴 → 측정 폼 턴 → /api/fitness → /api/fitness/ai (기존 계약 §6 그대로)
```

- 대화 상태(messages·slots·phase)는 **전부 클라이언트**(P-3 비저장, 2-worker 무상태 유지). 서버 세션 금지.
- 자격 오판은 무응답보다 나쁘다(1심 판사2) — LLM이 자격·금액·위치·순위를 문장으로 생성하는 경로는 구조적으로 존재하지 않는다.

### 11.2 프로바이더 (ai.py 패턴 미러 — server/app/chat.py)

```python
class ChatProvider(Protocol):
    name: str
    def nlu(self, text: str, slots: dict, phase: str, grounding: str = "") -> dict: ...
    # grounding(v1.9 AC9): 서버가 주입하는 [참고 자료](FAQ 사전 전문) — 접지 답변 레인의 유일한 사실 원천

OpenAIProvider   # httpx → chat.completions + structured output.
                 # env SPONAVI_OPENAI_MODEL(기본 gpt-5.4-mini), 타임아웃 12s
RulesFallback    # 빈 slot_updates + provider="rules" — 클라가 칩 모드 강등(정직 라벨)
# 선택: env SPONAVI_CHAT_LLM=openai|off · OPENAI_API_KEY는 compose environment 주입
# (.env는 이미지에 미포함 — .dockerignore에 .env 추가가 이 계약의 일부)
```

- 재시도: 스키마 검증 실패 시 1회(예외는 즉시 폴백) — `ai._run_provider` 문법.
- 캐시 없음(발화 유일성으로 무의미). SSE 없음(턴 응답이 짧아 v1 불필요 — 도입 시 starlette `text/event-stream` GZip 제외 동작의 버전 핀 필요, 기록만).
- 쿼터: OpenAI 무료 일일 토큰(250만/일). 소진·429·타임아웃 → RulesFallback. 레이트리밋 `chat` 버킷 20/min(자유 텍스트에만 발생).
- `/api/health`에 `chat_llm` 라벨 추가(기존 `llm` 라벨과 별도).

### 11.3 프라이버시 (무료 티어 = 데이터 공유 조건)

- NLU 전송분 = **현재 발화 + 범주화 슬롯 상태만**. 대화 이력 전문 미전송. 이름·연락처는 애초에 수집하지 않음(FR-01 AC4 계승).
- 컴포저 고지 상시: "자유 입력은 AI 이해를 위해 외부 API로 전송됩니다. 버튼 입력은 전송되지 않습니다."(FR-12 AC7)
- 로그: 발화·슬롯 금지. `{provider, ms, ok, fallback_reason}`만(기존 sponavi.access 규약 연장).

### 11.4 웹 구조

- `ChatApp.tsx`(App 대체): 헤더(다크토글·데모배지 유지) + 스트림(`role="log"` aria-live) + 컴포저(입력+칩) + 패널.
- `chat/store.tsx`: useReducer+Context(신규 의존성 없음) — messages·slots·phase·panel·filterSports(구 ResultView 소유분 이주)·llmMode.
- `chat/policy.ts`: 결정론 대화 정책 — 질문 순서(나이→성별→지역→소득→장애→판정), 칩 정의, 발화 템플릿(§6 정직성 사전 준수), P1~P5 퀵스타트 칩.
- 재사용: EligibilityCard(+SelectionBlock·AltRoutesBlock export 승격), SupplyGapBanner, PathDiagram, AccessibilityFilter, ErrorPanel, ui.tsx 전부. NearbyList의 VoucherRow·AltRow export 승격 = 챗 임베드 시설 카드. FitnessStep은 useFitness() 훅 + ParqGate/측정폼/FitnessResult 3분할. FitnessResult 는 추천 블록(운동·연결 종목 출처 배지, 멀티홉 "목적 경유")과 AI 처방 항목별 "왜 이 운동?" 펼침(FR-08 AC8)을 소유 — 근거 문장은 전부 서버 provenance 를 옮긴 것이고 화면이 만들지 않는다(P-2).
- 지도(MapLibre GL, v1.8에서 Leaflet 대체)는 **패널 상주 1인스턴스**(메시지별 재마운트 금지 — fitBounds·타일 재요청 방지). 스타일: 라이트 positron·다크 dark(OpenFreeMap, 키 불필요), CSP connect-src/worker-src 계약은 main.py.
- 목모드: 칩 경로가 기존 mocks/engine·personas를 그대로 소비 — nlu 목 불필요, e2e는 서버·LLM 없이 완주.
