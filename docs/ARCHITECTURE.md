# 스포내비 아키텍처 v1

> 작성 2026-07-20. 현 MVP(동작 중) 구조의 확정 기술문서 + M1(AI 처방)·M3(배포) 설계 계약.
> 원칙: **틀리면 안 되는 것은 결정론, 섬세함이 값인 것만 AI. 데이터는 전량 로컬 적재 후 쿼리.**

## 1. 시스템 개요

```
                         ┌──────────────────────── 오프라인 파이프라인 ────────────────────────┐
  KSPO 오픈API 5종  ──▶  bulk_fetch.py  ──▶  data/raw/*.json  ──▶  build_db.py  ──▶  sponavi.db
  (전국 28만 행, ~282콜)   (재시도·페이지네이션)      (전량 보존)          (매핑·조인·정규화)     (SQLite 57MB)
                         └──────────────────────────────────────────────────────────────────┘

  브라우저(모바일 우선)                          FastAPI 서버 (server/app)
 ┌─────────────────────┐   /api (JSON)   ┌──────────────────────────────────────────┐
 │ React 19 + Vite     │ ◀─────────────▶ │ main.py   엔드포인트·CORS·에러봉투           │
 │  위저드 → 결과 3블록  │                 │ engine.py 자격판정·대체경로·거리·공급공백 (결정론) │
 │  경로시각화·Leaflet  │                 │ store.py  SQLite 쿼리 (없으면 fixtures 폴백)  │
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

### 2.1 web/ (React 19 · Vite 7 · TS · Tailwind v4 · Leaflet+OSM)
- 화면: 위저드(입력) → 결과[자격카드 | 경로 스텝다이어그램 | 지도+리스트] + 공급공백 배너 + 체력처방 스텝 + 페르소나 4버튼.
- `VITE_MOCK=1` 목모드: 서버 없이 계약-형태 목으로 완전 동작(개발·시연 이중화).
- `api/client.ts`가 서버 응답 변형(personas 중첩 body 등)을 흡수 — 계약 방어층.

### 2.2 server/ (FastAPI · Python 3.11+ · 의존 최소)
- `engine.py` — 순수함수 규칙 평가: eligibility(사유 배열 생성) → 실패 시 alt_edges 순차 평가로 멀티홉 path 구성 → 하버사인 거리 → supply_gap(반경 3km 카운트 + coverage 조인). LLM·네트워크 무접촉.
- `store.py` — `data/sponavi.db` 존재 시 SQL(인덱스: sigungu_cd·source·facility_id), 부재 시 fixtures. 공개 함수 시그니처가 계약이라 데이터소스 교체가 상위에 불가시.
- 에러 봉투 `{"error":{"code":"UPPER_SNAKE","message":"한국어"}}` 통일.

### 2.3 데이터 파이프라인 (scripts/)
- `bulk_fetch.py` — 5개 API 전량(페이지 1000행 상한 실측). 소스별 완료 즉시 저장(중단 안전), 재시도 6회·타임아웃 60s(게이트웨이 지연 실측 반영). **호출 ~282회 ≪ 일 10,000 한도.**
- `build_db.py` — idempotent(매번 재생성). 핵심 정규화:
  - 시군구코드: voucher/dvoucher=`local_cd` 그대로. public=시군구명→코드 역매핑(99.2% 실측; '전남광주통합' 라벨은 [46,29] 팬아웃 역판별).
  - 좌표: public=`faci_lat/lot` 실좌표, 그 외=sigungu centroid 폴백(서울 seed + public 좌표 평균).
  - 폐업 제외(public 34,925건), 강좌 조인 voucher=(brno,facil_sn) 95.9%.
  - **dvoucher 강좌는 시설과 공통키가 API에 실부재** → facility_id NULL 보존(시군구 레벨 노출).
- 갱신 전략: 월 1회 bulk_fetch → build_db (cron 후보, 배포 후).

### 2.4 DB (SQLite 운영 · MySQL DDL 제공)
- 테이블: `sigungu`(허브) / `facilities`(15.5만) / `courses`(9만) / `coverage`(수급 통계) + M1용 `measurement_item`·`fitness_norm`. ERD·MySQL 8.0 DDL은 `docs/schema.mysql.sql`.
- 허브 조인: 자격판정 지역·시설검색·커버리지·공급공백이 전부 `sigungu_cd` 한 키.

## 3. 결정론 엔진 계약 (레인1·2)

- 입력(자가선언): 나이·성별·시군구·소득계층·장애{유무,유형}. **개인정보 저장 없음**(요청-응답 한정).
- eligibility 평가 순서: 장애→dvoucher, 비장애→svoucher (주 제도 1개). 각 조건마다 `{field, ok, message}` 사유 생성 — 이 사유가 UI "왜?"의 원천.
- path 생성: 자격 성립 → [person→제도✓→시설]. 실패 → alt_edges에서 조건(`income_fail`/`age_fail`) 매칭 첫 엣지로 [person→제도✗→대안→시설]. 엣지의 `curated` 필드가 UI "전문가 큐레이션" 뱃지로.
- supply_gap: 반경 내 source별 카운트 + 최근접 + coverage(시군구·계층). **항상 반환**(정직 신호 상시).

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
| voucher/dvoucher 좌표 없음 | centroid 폴백 + `dist_km`에 "구 중심 기준" 라벨 → M2 카카오 지오코딩 |
| dvoucher 강좌 조인키 없음 | 시군구 레벨 노출 + 공단 데이터 개선 제안(제출물 소재) |
| coverage 서울 15구뿐 | 없는 구 null → UI "데이터 없음" (거짓 통계 금지) |
| public 접근성 필드 없음 | disability_support NULL·휴리스틱 96건만 1, UI '미상' 구분 |

## 6. [M1 계약] AI 체력 처방 레이어

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
  `{"약점":[{항목,등급,근거}], "우선순위":[], "처방":[{운동,목표체력요인,강도,주당빈도}], "주의":""}`
- 후처리(결정론): 처방 운동명 → fitness_map/종목 사전으로 정규화 → `facilities.sports` 매칭 → "이 운동 되는 근처 강좌" 반환. **LLM은 시설·가격·자격을 절대 언급하지 않음**(프롬프트 금지 + 후처리에서 무시).
- UI 표기: "AI 보조 처방(전문가 큐레이션 규칙 검증) · 의료 조언 아님".

### 6.4 비용·성능
- 캐시: (연령군·성별·항목값 반올림) 해시 → SQLite 캐시 테이블, TTL 없음(같은 입력=같은 답).
- 비동기 UI(처방 스텝만 로딩 상태), 실측 42s → 캐시 적중 시 0s.

## 7. [M3] 배포 아키텍처 (기존 오라클 A1 재사용)

```
사용자 ── HTTPS ──▶ Caddy(시스템) ──▶ sponavi.kro.kr → 127.0.0.1:8100 (FastAPI 컨테이너)
                        ├─ stockllm.kro.kr → :8765        ├─ 정적 web/dist 서빙(FastAPI StaticFiles)
                        └─ nodian.kro.kr  → :3000         └─ sponavi.db 볼륨 마운트(빌드 산출물)
```
- Docker 단일 컨테이너(웹 정적+API), compose로 재시작 자동. 인증서는 Caddy 자동(kro.kr LE 한도 시 ZeroSSL EAB — 기보유 노하우).
- **PWA 주의(실전 교훈)**: nodian 서비스워커 denylist 사례처럼, 도메인 분리로 SW 간섭 원천 차단.
- DB는 서버에서 월 1회 파이프라인 재실행(키는 서버 .env).

## 8. 보안·개인정보

- 입력(소득계층·장애 등 민감)은 **저장하지 않음** — 요청 처리 후 폐기, 로그에 바디 미기록.
- LLM 전송분은 측정수치·연령군·성별만(이름·주소 없음). 캐시 키는 해시.
- 자격 표현은 항상 "예상"+공식 링크 — 법적 판정 아님 고지.

## 9. 품질 전략

- 서버 pytest 42+ (자격 매트릭스·경계나이·라우팅·공급공백·copay·계약 형태) — CI 후보.
- 웹 tsc+vite build + 목모드 Playwright 4페르소나.
- 통합: 실서버 Playwright(P1~P4 기대문구+스크린샷) — 릴리스 게이트.
- M1 추가: 프롬프트 회귀(고정 프로필 3종 스냅샷), 스키마 검증 실패→폴백 테스트.

## 10. v2 로드맵(기획서 §9 이후) — 기록해두는 판단

- **운동명 온톨로지**: 국민체력100 처방 코퍼스(운동명 고유 889종, 표기 요동 실측)를 임베딩+큐레이션으로 canonical 정규화 → 처방↔강좌 시맨틱 매칭 고도화. *GraphRAG는 비채택* — 자격·경로는 결정론이어야 하고(오판 리스크), 우리 데이터는 정형이라 SQL 그래프 탐색이 정확·저렴(판단 근거 기록, 2026-07-20).
- 커버리지 전국화, 지자체용 공백 대시보드(발전가능성 축), 알림(신규 가맹 시 재안내).
