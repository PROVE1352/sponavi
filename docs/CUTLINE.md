# 컷라인 문서 — 제출 P0 / 드롭 목록 (3심 명령 3, 2026-07-21 확정 · 2026-08-18 챗 전환 편입)

> 실접수마감 2026-10-02. 이 문서가 "무엇을 반드시 내고, 무엇을 버리는가"의 단일 기준.
> **2026-08-18 갱신**: UX를 챗 단일 UI로 전면 전환(v2, PRD FR-12·13 / 아키텍처 §11). 챗 전환이 P0에 편입되고
> 보고서 스크린샷이 챗 UI 확정에 종속됨 — **시각 확정 데드라인 9/5** (이후 스샷 재촬영 → 보고서·증빙).
> **2026-08-27 갱신**(설계 `docs/designs/kspo-two-sided-product.md` + `/plan-eng-review` 확정): 심사는 **발표 없이 보고서 10장 + URL**뿐 —
> 심사위원이 혼자 밟는 경로 위의 거짓 출력은 전부 P0로 편입(§W1 표). **9/17 코드·데이터 동결** 신설, `gap.html` 범위 예외 1건,
> 0일차 3건(push·DNS·중개자 메일) 명시.

## P0 — 제출에 반드시 포함 (전부 완료 ✅ 또는 잔여 명시)

| 항목 | 상태 |
|---|---|
| 전국 실데이터 서비스 (시설 15.5만·강좌 9만, 자격판정+선정순위+대체경로) | ✅ 배포 운영 중 |
| 좌표 정직성 (근사 배지·구 단위 카운트) — 판결 명령 | ✅ |
| 접근성 필터 (장애유형·편의시설 10종) | ~~✅~~ → **🔨 2026-08-27 정정** — 목(mock)에서만 렌더. 엔진의 voucher 행에 `source` 필드가 없어 **프로덕션에서는 장애인 가맹 배지·FR-10 접근성 블록이 미렌더**(EDGE #17/E-13). 데이터·필터 로직은 있으므로 `source` 착지(W1 T3) 후 ✅ |
| 체력 레인 (공식 컷오프 1,052행 판정 + 지식그래프 추천 + AI/룰 처방) | ✅ |
| 공급공백 신호 (강원 고성군 5:0 실데이터 · 인천 재편 영역그룹으로 거짓양성 제거) | ✅ 2026-08-22 — 인천 서구 383:0 은 코드 전환기 잔재로 확정(실영역 445:114), P4 → 고성군, 엔진 FR-05 AC4 |
| 지역 코드 정규화 (구 시도코드 45건 크로스워크 + 시군구 미매칭 964→0) | ✅ (2026-08-22) |
| 디자인 폴리시 + A11Y(axe 0) + 모바일 | ✅ |
| 테스트 회귀 (서버 121·e2e 20) | ✅ (v1 기준 — 챗 전환 시 e2e 재작성 포함) |
| **챗 UX 전환 (v2)** — 챗 스트림+패널, OpenAI NLU+칩 폴백, 기존 카드 임베드 | 🔨 진행 — C1 계약 완료(8/18) → C2 웹+C4 서버 병렬 → **시각 확정 9/5** |
| **HTTPS 도메인** (doenayo.kro.kr) | ⏳ DNS A레코드 등록(사용자 1분) → deploy.sh 재실행. **2026-08-27 사용자 결정: 등록 시점을 W1 맨 끝으로 미룸** — 그 전까지 HTTP·IP 배포로 작업하고, geolocation(EDGE #13)·mixed-content(#9)·"주의 요함" 경고는 DNS 이후에만 검증 가능 |
| **활용사례 보고서 10장** | 초안 v0.1 완료 — 잔여: 팀명·**스샷(챗 UI 확정 후 전면 재촬영)**·시장 수치 1개·인터뷰後 헤드라인 |
| **증빙자료(붙임2)** — 구축일 2026-07-21·운영주체·URL·기대효과·데이터활용부분 | 보고서에서 발췌 조립(반나절) |
| 개인정보 동의서(붙임3) 자필 서명 | ⏳ 사용자 |
| 접수 폼 제출 (gov-eformsign) | ⏳ 사용자, 9월 중 권장(수정 제출 가능 규정 활용) |

## W1 P0 — 심사 경로 위의 코드 (2026-08-27 확정, 8/27~9/3)

> 근거: 심사는 **발표 없이 보고서 10장 + 서비스 URL**뿐이다. 심사위원은 혼자 URL을 열고 아무도 옆에서 설명하지 않는다.
> 그래서 **그가 밟는 경로 위의 거짓 출력은 전부 P0**이고, 그 밖은 문서·구성이다(설계 Premise 6).
> 아래 13건은 전부 **계획 확정 · 코드 미착지** 상태다 — 착지 전에는 이 문서·EDGE_CASES 어디에도 ✅를 쓰지 않는다(P-1).

| # | 항목 | 한 줄 |
|---|---|---|
| T0 | 0일차(사람) | `git push`(✅ 2026-08-27) · DNS A레코드(⏳ 사용자 결정으로 맨 마지막) · 중개자 메일 초안(⏳) |
| T1 | 서버 engine 계약 | `_voucher_facilities(..., eligible)` 비적격 `subsidy=0/copay=fee` · `nearby.primary` · `_alternatives` 실좌표 우선 정렬 · voucher 행 `source` · `_collect_alt_edges` `to` dedupe(공식 확인 우선) · `_build_path` 정합 · API.md (EDGE #15·#16·#17·#20, 1A·CQ2A·OV1·OV3·OV4) — ✅ 반영(2026-08-27, master d811430) |
| T2 | 썸네일 복구 | `fetch_videos.py` 폴더+`img_file_nm` https 조립 · `main.py` CSP `img-src` · videos 재적재 · `FitnessResult` `<img onError>` (EDGE #9) — ✅ 반영(2026-08-27, master d811430) |
| T3 | `faci_gb` 마이그레이션 | `scripts/migrate_facility_gb.py`(ALTER+raw 조인, 재빌드 동치) · `build_db.py` · `store.py` (EDGE #21) — ✅ 반영(2026-08-27, master d811430) |
| T4 | 종목 별칭(C-27) | `data/sport_alias.json` + `fitness.py facility_filter_sports` 확장 · `web/src/lib/sports.ts` 1벌 (EDGE C-27) — ✅ 반영(2026-08-27, master d811430) |
| T5 | 챗 reply·slot 정합 | `chat.py _reconcile_reply` + D-08/D-10 패턴 표 — W2 이월 허용 (EDGE #14) — ✅ 반영(2026-08-27, master d811430) |
| T6 | 페르소나 `demo` 계약 | `personas.py demo:{fitness,parq_preset}` P2·P5 프리필 · API.md · `DemoPersona` · `normalizePersona` 보존 · `FitnessForm initialValues` · 목 (PRD ★FR-P2) — ✅ 반영(2026-08-27, master d811430) |
| T7 | 라우팅 | `serve.py` `/demo?…`→`/#/demo?…`(쿼리 보존)·`/gap`→`/gap.html` + TestClient · `route.ts` prefix+`p=` 파싱(`auto`는 W2) (EDGE F-09) — ✅ 반영(2026-08-27, master d811430) |
| T8 | 웹 금액·순서·배지 | 타입 nullable · `won(null)`→"미등록·시설 문의" 3셀 · 섹션 요약 1줄 · `FacilityCounts`/ContextPanel `supply_gap.voucher_count` 문구 · `AltRow` 공공/신고·등록 배지 · `nearby.primary` 순서 (EDGE #8·#10·#18·#19·#21) — ✅ 반영(2026-08-27, master d811430) |
| T9 | 히어로 위계 | `AltRoutesBlock` 덱 밖 전폭(`assess_result` 래퍼 안·CardDeck 앞) · 헤딩 `eligible` 분기·N=공식 확인 수·"확인 중 1건" · ✗ 사유 한 줄 전부 · CTA=기존 칩 · 인라인 강좌 3행 · e2e deck/p5/personas/shots 재정합 (PRD FR-02 AC5, FR-12 AC9) — ✅ 반영(2026-08-27, master d811430) |
| T10 | 테스트 인프라 | vitest(`npm test`) · 계약 JSON `web/src/mocks/contract/*.json` 웹 목 import · `server/tests/test_mock_parity.py` — ✅ 반영(2026-08-27, master d811430) |
| T11 | 배포 안전 | `deploy.sh` 기본 `--exclude 'data/sponavi.db*'` · `--with-db` · `scripts/db_fingerprint.sh`(캐시 제외) · FREEZE.sha 흐름 · 스모크 `data_built` 단언 (EDGE G-05·G-07) — ✅ 반영(2026-08-27, master d811430) |
| T12 | 문서 정합 | EDGE_CASES §0·A~G · 이 문서 · PRD v1.10 · REPORT_DRAFT §4 (`API.md`는 T1) — ✅ 반영(2026-08-27, master d811430) |
| T13 | HTTPS·관찰(사람) — ⏳ 도메인은 맨 마지막(사용자 결정) | DNS 후 `deploy.sh --with-db` 1회(T2·T3 반영) → https 200 · 낯선 사람 3명 QR 주소 60초 관찰 기록 — **맨 마지막** |

**자동재생(`auto=1`)은 W1이 아니다** — W2(9/6~9/10). W1에서 끝내는 것은 QR 주소가 동작하게 만드는 부분까지다:
서버 리다이렉트(`/demo?…`→`/#/demo?…` 쿼리 보존, `/gap`→`/gap.html`) + `readDemo` 의 해시 내 `p=` 페르소나 선택 파싱.

## 범위 예외 1건 — `gap.html` (2026-08-27)

PRD §8·SPEC §1의 **"B2G 대시보드 UI 제외"는 유지**하되, **정적 표 1장 `web/public/gap.html`("가맹 유치 우선순위")만 예외**로 둔다(W3).
`scripts/build_gap.py` 가 빌드 타임에 SQLite → 순수 HTML+JS 정렬 30줄로 생성하며 **React 라우트·API 엔드포인트·e2e 를 늘리지 않는다**.
"공공시설" 집계는 `facilities.faci_gb='공공'` 만 센다(신고·등록 제외 — T13 과 같은 컬럼). 대시보드 UI·로그인·저장은 여전히 범위 밖.
문서 반영: PRD §8 예외 1줄 + 이 행.

## 9/17 코드·데이터 동결 (2026-08-27 신설)

- **9/17이 하드스톱.** 이후 코드 수정은 **거짓 출력(P-1) 봉합만** 허용하고, **DB 재빌드·`refresh_data.sh` 는 금지**한다(재빌드 시 geocoded 619건 소실 → 데모 구 거리 전부 "미표기" 회귀 + 보고서 수치 이탈, EDGE G-04). 인프라 복구·인증서 갱신은 예외.
- **`deploy.sh` 기본은 DB 미동봉** — `--exclude 'data/sponavi.db*'`. DB 를 밀 때만 `deploy.sh --with-db`(썸네일 videos 재적재가 첫 사용처). 코드 배포가 데이터를 조용히 덮어쓰던 경로를 막는다.
- **`data/FREEZE.sha`** = **캐시 테이블을 제외한** `.dump` 의 sha256(`scripts/db_fingerprint.sh`). 파일 해시를 쓰지 않는 이유는 `fitness_ai_cache` 가 테스트마다 자라기 때문이다.
- **정본은 마지막 `deploy.sh --with-db` 직후의 프로덕션 DB** — 그 시점 지문을 `data/FREEZE.sha` 와 서버 양쪽에 기록하고, 이후 봉합 배포는 해시 일치 확인 후에만 나간다.

## 0일차 (2026-08-27)

| 항목 | 상태 |
|---|---|
| `git push` (미푸시 42커밋 108파일, 서버에 .git 없음) | ✅ 2026-08-27 완료 |
| DNS A레코드 (doenayo.kro.kr) | ⏳ **사용자 결정으로 W1 맨 끝으로 연기** — 그 전 작업은 HTTP·IP 배포에서 진행 |
| 중개자 메일 초안 1통 | ⏳ 미작성 — 수신처(성북장애인복지관·특수학교·주민센터 중 1) 미정. "보냈다·답 없었다"도 보고서의 정직한 한 줄이 된다 |

## 사람 게이트 (제출 품질에 영향, 코드 아님)

- 7/27 인터뷰(프로토콜 확정본 있음) → 헤드라인 3번 절 생사 → 보고서·히어로 갱신
- 7/31 복지자격 검수자 1인 → 신뢰성 서술 1줄 + 혐의 B 해소
- 8/초 중개자 채널 1곳 → 보고서 "확산 경로" 실증 1줄

## 드롭 — 하지 않기로 확정 (3심 판사2 순서 그대로)

1. **문화비 소득공제 시설 태깅 크롤링** — 유일 미실증 경로. 제도는 대체경로 텍스트로만 안내(이미 반영).
2. **FR-11 신청기간 수집** (~25k 요청) — 강좌 신청기간 표시 없이 제출. 보고서 발전방향 1줄로만.
3. **그래프 B티어 체대 검증** — "검증 중" 배지 상태로 제출(정직성 서사의 일부로 소화).

## 옵션 (여유 시에만, P0 아님)

- ~~M2 데모 구(성북·인천서구) 지오코딩~~ → **완료(2026-08-19)**: 카카오 주소검색 배치(scripts/geocode_demo.py) 619/632건 실좌표화(97.9%, 오매칭 방어 0건 폐기·실패 13건 근사 유지), 엔진 실좌표 집합에 geocoded 편입 — 데모 구 거리 표기·마커 실위치 활성. 잔여 구 확장은 선택(전국 ~15만 콜, 일 한도 내 2일).
- ~~Gemini 프로덕션 전환~~ → **OpenAI 무료 티어(250만 토큰/일)로 챗 NLU 확정(2026-08-18)**. 체력 처방(`SPONAVI_LLM`)의 OpenAI 통합은 별도 옵션으로 잔존 — 룰 폴백 정직 라벨 제출 가능 논리는 유지.
- 다작 응모(모의심사 위원B 제안) — 8월 말 재검토.


> 2026-08-28: W2 자동재생 반영(master 4412ef6, vitest 39·e2e 81/81, 실측 2.4~2.6초).
