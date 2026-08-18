import { test, expect, type Page, type Route } from '@playwright/test'
import { stream } from './helpers'

// 회복탄력성(서버가 아플 때도 품위 있게) — Playwright route 인터셉트로 서버 오류를 주입한다.
// 목 빌드(VITE_MOCK=1)라도 ?live=1 런타임 탈출구로 실네트워크 경로를 강제 → route 로 응답을 준다.
//   ① assess 500 → 스트림 ErrorPanel + 재시도(입력 보존) 성공 흐름
//   ② accessibility 실패 격리 → 시설 카드는 그대로 렌더 + 접근성만 인라인 안내
//   ③ assess 429 → 서버 메시지 그대로 노출 · 무재시도
//   ④ /api/health 로 푸터 데이터 기준일/버전 동적 표기
//   ⑤ 오프라인/재접속 배너
//   ⑥ /api/chat/nlu 실패·provider=rules → "규칙 기반 모드" 강등 라벨 + 칩으로 대화 계속(FR-12 AC4)
// 다른 spec 은 목 모드(?live 없음) 그대로 완주한다.

// ---- 계약-형태 픽스처 (route 로 주입) ----
const SIGUNGU = [{ cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 }]

const PERSONAS = [
  {
    id: 'P1',
    label: '테스트 페르소나',
    summary: '서버 실패/복구 흐름 검증',
    age: 10,
    sex: 'F',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '기초생활수급',
    disability: { has: false, type: null },
    location: { lat: 37.6057, lon: 127.017 },
  },
]

const HEALTH = { status: 'ok', data_built: '2026-07-15', version: 'e2e-1' }

const FITNESS_ITEMS = {
  age: 10,
  age_group: '유소년',
  age_gap: false,
  basis: 'test',
  items: [],
}

const FAQ = [
  {
    key: 'dvoucher_income',
    q: '장애인 이용권도 소득 기준이 있나요?',
    answer: '테스트 답변',
    source_url: 'https://dvoucher.kspo.or.kr',
    checked: '2026-07-20',
  },
]

const ACCESS_OK = {
  D01: {
    types: ['지체'],
    amenities: [{ code: '01', name: '장애인 화장실' }],
    source: '테스트',
    checked: '2026-07-21',
  },
}

// 강등 라벨 문구(PRD §6 사전 · chat/policy.ts T.degraded 와 동일해야 한다).
const DEGRADED_LABEL = '지금은 규칙 기반 모드예요 — 버튼으로 선택해 주세요.'

// provider=rules 응답(LLM off/쿼터 소진 시 서버가 주는 형태 · API.md).
const NLU_RULES = {
  slot_updates: {},
  intent: 'unknown',
  faq_key: null,
  region_candidates: [],
  reply: null,
  provider: 'rules',
}

// dvoucher 가맹시설(D01)을 포함 → 결과 렌더 시 접근성 조회 경로까지 태운다.
const ASSESS_OK = {
  eligibility: [
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: true,
      reasons: [{ field: 'disability', ok: true, message: '테스트: 자격 충족' }],
      benefit: '월 최대 11만원 강좌비 지원',
      apply: { how: '온라인 신청', url: 'https://dvoucher.kspo.or.kr', docs: ['신분증'] },
      source: { url: 'https://dvoucher.kspo.or.kr', checked: '2026-07-21' },
      verified: false,
    },
  ],
  path: [
    { from: 'person', to: 'dvoucher', edge: '자격', result: 'ok', label: '테스트 경로' },
    { from: 'dvoucher', to: 'facility:D01', edge: '적합·접근', result: 'ok', label: '서울장애인체육관' },
  ],
  nearby: {
    voucher_facilities: [
      {
        id: 'D01',
        name: '서울장애인체육관',
        sports: ['수영', '재활운동'],
        lat: 37.6396,
        lon: 127.0257,
        coord_source: 'centroid',
        dist_km: null,
        sigungu_nm: '강북구',
        fee_month: 0,
        subsidy: 110000,
        copay: 0,
        disability_support: true,
        source: 'dvoucher',
        addr: '서울 강북구 한천로 1000',
        course_name: '장애인 재활 수영',
      },
    ],
    alternatives: [
      {
        id: 'P01',
        name: '성북구민체육센터',
        type: '공공체육시설',
        sports: ['요가', '수영'],
        lat: 37.6046,
        lon: 127.0413,
        coord_source: 'api',
        dist_km: 1.6,
        sigungu_nm: '성북구',
        note: '테스트 대안',
        disability_support: true,
        fee_month: 30000,
        source: 'public',
      },
    ],
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 1,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 1,
    nearest: null,
    message: '테스트 · 성북구 가맹 1곳',
    coverage: null,
  },
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

// assess 를 제외한 주변 엔드포인트를 성공으로 고정(테스트의 관심사만 실패를 주입).
async function stubAmbient(page: Page) {
  await page.route('**/api/meta/sigungu', (r) => json(r, SIGUNGU))
  await page.route('**/api/demo/personas', (r) => json(r, PERSONAS))
  await page.route('**/api/health', (r) => json(r, HEALTH))
  await page.route('**/api/chat/faq', (r) => json(r, FAQ))
  await page.route('**/api/fitness/items**', (r) => json(r, FITNESS_ITEMS))
  await page.route('**/api/accessibility**', (r) => json(r, ACCESS_OK))
}

// ?live=1 랜딩 — 퀵스타트 칩(P1)이 뜰 때까지.
async function openLive(page: Page) {
  await page.goto('/?live=1')
  await expect(page.getByTestId('chat-stream')).toBeVisible()
  await expect(page.getByTestId('chip-persona-P1')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await stubAmbient(page)
})

test('① assess 500 → 스트림 에러 패널 + [다시 시도]로 복구 (입력 보존)', async ({ page }) => {
  let calls = 0
  await page.route('**/api/assess', async (route) => {
    calls += 1
    if (calls === 1) {
      await json(route, { error: { code: 'INTERNAL', message: '서버 내부 오류' } }, 500)
    } else {
      await json(route, ASSESS_OK)
    }
  })

  await openLive(page)
  await page.getByTestId('chip-persona-P1').click()

  // 에러 패널: 정직 카피 + 상세(HTTP 500) — 거짓 데이터로 대체하지 않는다
  const panel = stream(page).getByTestId('error-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('데이터는 사라지지 않았어요')
  await expect(page.getByTestId('error-detail')).toContainText('500')
  // 실패 시 결과 카드는 렌더되지 않는다
  await expect(stream(page).getByTestId('assess-cards')).toHaveCount(0)

  // 재시도 → 두 번째 호출 성공 → 결과 렌더(에러 메시지는 대화 기록으로 남는다)
  await page.getByTestId('assess-retry').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(page.getByTestId('facility-summary')).toBeVisible()
  expect(calls).toBe(2)
})

test('② accessibility 실패 격리 → 시설 카드는 렌더, 접근성만 인라인 안내', async ({ page }) => {
  await page.route('**/api/assess', (r) => json(r, ASSESS_OK))

  let accessCalls = 0
  // beforeEach 의 성공 라우트보다 나중 등록 → 이 실패 라우트가 우선한다.
  await page.route('**/api/accessibility**', async (route) => {
    accessCalls += 1
    await json(route, { error: { code: 'INTERNAL', message: 'x' } }, 500)
  })

  await openLive(page)
  await page.getByTestId('chip-persona-P1').click()

  // 결과와 시설 카드는 완전히 렌더된다(부분 실패가 전체를 무너뜨리지 않는다)
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(stream(page).getByTestId('dvoucher-facility')).toHaveCount(1)

  // 접근성 조회만 실패 → 행별 인라인 표기("정보 없음"과 구분)
  await expect(stream(page).getByTestId('access-error-inline').first()).toBeVisible()
  // 패널 목록에는 전체 안내 배너 + 재시도
  await expect(page.getByTestId('context-panel').getByTestId('accessibility-error')).toHaveCount(1)

  // 멱등 GET 은 1회 자동 재시도 → HTTP 시도 2회 이상
  expect(accessCalls).toBeGreaterThanOrEqual(2)
})

test('③ assess 429 → 서버 메시지를 그대로 노출', async ({ page }) => {
  const serverMsg = '요청이 너무 많습니다. 30초 후 다시 시도해 주세요.'
  let calls = 0
  await page.route('**/api/assess', async (route) => {
    calls += 1
    await json(route, { error: { code: 'RATE_LIMIT', message: serverMsg } }, 429)
  })

  await openLive(page)
  await page.getByTestId('chip-persona-P1').click()

  const panel = stream(page).getByTestId('error-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('요청이 몰리고 있어요') // 429 전용 헤드라인
  await expect(page.getByTestId('error-message')).toHaveText(serverMsg) // 서버 메시지 그대로
  // 429 는 자동 재시도하지 않는다(요청 폭주를 악화시키지 않음)
  expect(calls).toBe(1)
})

test('④ /api/health 로 푸터 데이터 기준일·버전 동적 표기', async ({ page }) => {
  await page.route('**/api/assess', (r) => json(r, ASSESS_OK))
  await openLive(page)
  await expect(page.getByTestId('footer-data-built')).toHaveText('데이터 기준 2026-07-15')
  await expect(page.getByTestId('footer-version')).toContainText('e2e-1')
})

test('⑤ 오프라인/재접속 → 상단 미니 배너 토글', async ({ page, context }) => {
  await page.goto('/') // 배너 로직은 목/실서버와 무관 — 기본 로드로 검증
  await expect(page.getByTestId('chat-stream')).toBeVisible()
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)

  await context.setOffline(true)
  const banner = page.getByTestId('offline-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('오프라인 상태입니다')

  await context.setOffline(false)
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)
})

test('⑥-a /api/chat/nlu 500 → "규칙 기반 모드" 강등 라벨 + 칩으로 대화 계속 (FR-12 AC4)', async ({ page }) => {
  await page.route('**/api/assess', (r) => json(r, ASSESS_OK))
  let nluCalls = 0
  await page.route('**/api/chat/nlu', async (route) => {
    nluCalls += 1
    await json(route, { error: { code: 'INTERNAL', message: 'x' } }, 500)
  })

  await openLive(page)
  // LLM 이 살아 있다고 가정된 초기 상태에는 강등 라벨이 없다
  await expect(page.getByTestId('chips-mode-label')).toHaveCount(0)

  await page.getByTestId('composer-input').fill('27살 남자고 성북구에 살아요')
  await page.getByTestId('composer-send').click()

  // 자유 입력은 사용자 버블로 남고(정직), 실패는 AI 인 척 하지 않고 강등으로 말한다
  await expect(stream(page).getByText('27살 남자고 성북구에 살아요')).toBeVisible()
  await expect(stream(page).getByText(DEGRADED_LABEL)).toBeVisible()
  await expect(page.getByTestId('chips-mode-label')).toHaveText(DEGRADED_LABEL)
  expect(nluCalls).toBe(1)

  // 강등 뒤에도 칩 경로로 대화가 그대로 이어진다
  await page.getByTestId('chip-persona-P1').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()

  // 강등 상태의 자유 입력은 더 이상 NLU 를 호출하지 않는다(즉시 칩 안내)
  await page.getByTestId('composer-input').fill('그럼 지도 보여줘')
  await page.getByTestId('composer-send').click()
  await expect(stream(page).getByText('그럼 지도 보여줘')).toBeVisible()
  expect(nluCalls).toBe(1)
})

test('⑥-b /api/chat/nlu provider="rules" → 같은 강등 라벨 (LLM off 계약)', async ({ page }) => {
  await page.route('**/api/assess', (r) => json(r, ASSESS_OK))
  let nluCalls = 0
  await page.route('**/api/chat/nlu', async (route) => {
    nluCalls += 1
    await json(route, NLU_RULES)
  })

  await openLive(page)
  await expect(page.getByTestId('chips-mode-label')).toHaveCount(0)

  await page.getByTestId('composer-input').fill('나는 32살 지체장애가 있어요')
  await page.getByTestId('composer-send').click()

  await expect(page.getByTestId('chips-mode-label')).toHaveText(DEGRADED_LABEL)
  await expect(stream(page).getByText(DEGRADED_LABEL)).toBeVisible()
  expect(nluCalls).toBe(1)

  // 강등 후 칩 완주(LLM off 상태의 릴리스 게이트 9와 동일 경로)
  await page.getByTestId('chip-persona-P1').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(page.getByTestId('chip-act-restart')).toBeVisible()
})
