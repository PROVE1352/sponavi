# TODOS

## Web

### 한글 조합 중 Enter → 조합 확정 후 자동 전송 (카톡 PC 방식)

**What:** `web/src/chat/Composer.tsx`에서 IME 조합 중 Enter를 `compositionend` 이후 자동 전송으로 처리. 크롬·사파리·안드로이드 IME의 이벤트 순서 차이를 흡수.

**Why:** 한국어 전용 챗에서 Enter를 두 번 눌러야 전송되는 마찰 — EDGE_CASES #11의 실제 증상. (2026-08-27 /plan-eng-review: `isComposing` 가드는 네이티브 form 동작과 같아 no-op이라 삭제. 증상은 브라우저 기본 동작이며 #11은 🟡로 재분류.)

**Context:** Composer는 네이티브 `<form onSubmit>`만 있고 keydown/composition 핸들러가 0개. 브라우저 기본은 조합 중 Enter 미전송(keyCode 229). 시작점: `compositionstart/compositionend` 상태 + pending-enter 플래그 → compositionend 직후 submit. e2e로는 IME를 못 흔드니 실기기 3개(아이폰 사파리·갤럭시 크롬·맥 크롬)에서 이중 전송 여부 확인 필수. 심사 경로(칩·페르소나 기본)와 무관하므로 10/2 제출 이후 권장.

**Effort:** S
**Priority:** P3
**Depends on:** None (10/2 이후)

## QA

### e2e reduced-motion 분리로 벽시계 단축

**What:** Playwright 프로젝트를 `motion`(타이프라이터·순차 등장 검증)과 `reduced-motion`(나머지 전부, `prefers-reduced-motion: reduce`)으로 분리해 대부분의 spec이 애니메이션 대기 없이 돌게 함.

**Why:** 현재 e2e 14 spec이 workers 1·모션 대기로 ~7분. W1에서 여정 spec이 추가되면 +1분. 회귀 루프가 느리면 에이전트 병렬 코딩에서 e2e를 건너뛰게 됨(2026-08-27 성능 리뷰 관찰).

**Context:** `web/playwright.config.ts`는 단일 프로젝트(390×844, VITE_MOCK=1, workers 1, fullyParallel false). `motion.spec.ts`만 모션을 단정하고 나머지는 `settleTypewriter()` 대기를 씀. 시작점: projects 2개 + `use.reducedMotion: 'reduce'`, motion.spec만 기본 프로젝트. 기존 백로그 "e2e 7분(모션 때문 — reduced-motion 분리)"와 동일 항목.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Product

### 소득-only 회색지대 페르소나 P6 (16세 · 그 외 · 성북구)

**What:** 연령은 적격(5~18)인데 소득 계층 '그 외'로만 탈락하는 데모 페르소나를 추가해 "이용권 소득 회색지대"를 화면에서 직접 보여줌.

**Why:** 현재 P2(27세)는 연령·소득 둘 다 탈락이라 "성인은 대상 밖"으로 읽힘(2026-08-27 외부 의견 #4). 소득-only 회색지대는 1심 법정이 지목한 near-poor 서사이고 보고서 서사 강화 재료. 단 페르소나 6개는 데모 버튼 포화라 W1 범위 밖.

**Context:** `server/app/personas.py` PERSONAS에 항목 추가 + `demo.fitness`(15~19세 기준표 값) + 계약 JSON(`web/src/mocks/contract/`) + e2e 페르소나 카운트 재정합. 유소년 기준표(만7~10 공백 등)는 `fitness_norm` 확인 필요.

**Effort:** M
**Priority:** P4
**Depends on:** W1 T6(페르소나 demo 계약) 완료

## Infrastructure

### refresh_data.sh의 DB rsync 함정 (quick-check 스킵 + FREEZE.sha 미갱신)

**What:** `scripts/refresh_data.sh:79` 부근의 DB rsync가 `deploy.sh --with-db`와 같은 규약(`--ignore-times`, WAL 체크포인트, 본체만 전송, 전송 후 서버 지문→`data/FREEZE.sha` 갱신)을 따르게 하거나, 아예 `deploy.sh --with-db`를 호출하도록 바꿈.

**Why:** 2026-08-27 Lane O 실측 — `rsync -az --inplace`는 크기+mtime(1초)만 비교해 같은 크기·같은 초의 DB를 내용이 달라도 조용히 건너뜀. 또 refresh가 DB를 밀어도 FREEZE.sha가 안 바뀌어 다음 기본 배포의 동결 대조가 거짓 경고를 냄.

**Context:** deploy/README.md에 "refresh 후 `deploy.sh --with-db` 1회"로 문서화만 해 둔 상태. 월간 갱신(refresh_data.sh)은 9/17 동결 이후엔 금지이므로 10/2 제출 전에는 실행하지 않음. 시작점: refresh_data.sh의 rsync 블록을 deploy.sh의 2b/2c/5c 블록 호출로 대체.

**Effort:** S
**Priority:** P2
**Depends on:** deploy.sh --with-db (W1 T11)

## 모의심사 (b) 이월 (2026-08-28)
- [ ] **C-7 gap.html 제안 임계값 재검토(보류)** — 현행 ③ "장애인 가맹 ≤2 + 공공 ≥ T(247, p75)"가 의성군(3·공공779)·봉화군(3·434)·군위군(3·284)을 배제. 패널 제안: "장애인 가맹 ≤ p25 **또는** 공공 ≥ p75" 2축. 설계 결정(T=247 단일축)을 뒤집는 일이라 사용자 판단 후 진행.
- [ ] **C-10 대표 처방 컷을 AI 경로로 재촬영** — 현재 F1 스샷은 `provider: rules` 폴백(로컬에서 .env 미로드). 프로덕션(LLM on)에서 재촬영. D-7 캡션이 임시 방어.
- [ ] **D-13 PDF 내보내기 직전 정리** — 상단 메타 주석 4줄·하단 분량 가이드 삭제, 10장 초과 시 정직성 표 7→5행(「통계가 없는 지역」·「처방 문장의 작성자」 본문 흡수), 2순위 §시장 세 번째 불릿.
- [ ] **C-12 사람 게이트** — 조달 실단가·계약형태 / 중개기관 회신 1건 / 공단 보도자료 원문 URL / 제도 밖 성인 모수. 이 4건 없이는 발전가능성 6.5 천장.
