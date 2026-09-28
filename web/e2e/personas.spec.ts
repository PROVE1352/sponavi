import { test, expect } from '@playwright/test'
import { openDemo, openPanel, panel, shot, startPersona, stream } from './helpers'

// 페르소나 퀵스타트 칩(FR-12 AC5) → 채팅 스트림 카드 검증 + 심사용 스크린샷.
// 목 모드(VITE_MOCK=1)라 서버·LLM 없이 동작한다(칩 경로는 챗 엔드포인트를 호출하지 않는다).

test.beforeEach(async ({ page }) => {
  await openDemo(page)
})

test('P1 · 10세 여아 기초수급 → 스포츠강좌이용권 예상 자격 ✓ 카드', async ({ page }) => {
  await startPersona(page, 'P1')

  const card = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByText('예상 자격', { exact: true })).toBeVisible()
  // 신청 방법 + 근처 가맹시설·자부담(스트림 단독 완결, FR-12 AC3)
  // v1.7: 시설 카드는 결과 덱의 슬라이드라 요약 헤더와 형제다 — 스트림 범위로 찾는다
  await expect(card.getByText('신청 방법')).toBeVisible()
  await expect(page.getByTestId('facility-summary')).toBeVisible()
  await expect(stream(page).getByText('성북스포츠클럽').first()).toBeVisible()
  await expect(stream(page).getByText('내 부담').first()).toBeVisible()
  // 이용권 공급은 구 단위 카운트로 표기(FR-04 AC2). 목록 길이(4곳)가 아니라 구 카운트(161곳)다.
  await expect(stream(page).getByTestId('voucher-supply-block')).toContainText('성북구 가맹 161곳')
  // FR-04 AC6(OV5): 근처 요약도 "표시한 수 · 구 가맹 수"를 분리해 적는다(같은 화면 모순 봉합)
  await expect(page.getByTestId('facility-summary')).toContainText('근처 4곳 표시 · 성북구 가맹 161곳')

  await shot(page, 'e2e-shots/P1-svoucher-eligible.png')
})

test('P2 · 27세 낀 계층 → 대체경로 스텝 다이어그램(공식 확인 표기) + 대체경로 블록', async ({ page }) => {
  await startPersona(page, 'P2')

  // svoucher 는 해당 없음
  const sv = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(sv.getByText('해당 없음', { exact: true })).toBeVisible()

  // 경로 카드(스트림 임베드)에 대체경로 엣지 + 확인 상태 표기.
  // 성북 공공시설 엣지는 "공식 확인(조례 …)" — 공식 원문 확인이므로 "전문가 큐레이션"이라 부르지 않는다
  // (그 이름은 검증 대기 엣지 몫, lib/pathLabel · SPEC §0-3).
  const path = stream(page).getByRole('region', { name: '추천 경로 시각화' })
  await expect(path).toBeVisible()
  await expect(path.getByText('대체경로')).toBeVisible()
  const curated = path.getByTestId('path-edge-curated')
  await expect(curated).toHaveText(/^공식 확인\(조례 2026-09-17\)$/)
  await expect(path.getByText(/전문가 큐레이션/)).toHaveCount(0)
  await expect(path.getByText('공공 프로그램')).toBeVisible()

  // 레이아웃(2026-09-28 보고서 스샷): 확인 표기·엣지 설명이 좁은 칸에서 글자 단위로 꺾이지 않는다.
  //   대체경로 칸은 충분히 넓고(390 고정 192px) 확인 표기 3줄 이하, 엣지 설명은 4줄 이하.
  const lines = (loc: typeof curated) =>
    loc.evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 16
      return Math.round(el.getBoundingClientRect().height / lh)
    })
  const cBox = (await path.getByTestId('path-edge').nth(1).boundingBox())!
  expect(cBox.width, `대체경로 칸 폭 ${cBox.width}`).toBeGreaterThanOrEqual(180)
  expect(await lines(curated.locator('span').last())).toBeLessThanOrEqual(3)
  const altLabel = path.getByTestId('path-edge-label').nth(1)
  expect(await lines(altLabel), '대체경로 설명이 너무 여러 줄로 꺾였다').toBeLessThanOrEqual(4)

  // 복수 대체경로 히어로(FR-02 AC5 v1.10) — 성북구는 체육시설 조례 감면 원문 확인 지역이라
  // 공공시설이 '공식 확인(조례)'으로 올라와 공식 확인 3개, 검증 대기 0건(2026-09-23).
  await expect(stream(page).getByTestId('alt-routes-block')).toBeVisible()
  await expect(stream(page).getByTestId('alt-route-item')).toHaveCount(3)
  await expect(stream(page).getByTestId('alt-route-pending')).toHaveCount(0)
  // 27세 비저소득에게 맞는 감면은 없다 — 없는 할인을 만들지 않고 일반 요금이라고 말한다
  await expect(stream(page).getByTestId('public-fee-summary')).toHaveText(
    '성북구 구립 체육시설 · 해당 감면 없음 · 일반 요금',
  )

  // 이용권 ✗ → 근처 요약도 가맹 숫자를 앞세우지 않는다(FR-04 AC6: 못 쓰는 수를 강조하지 않음)
  const summary = page.getByTestId('facility-summary')
  await expect(summary).toContainText('근처 대안 3곳 표시')
  await expect(summary).not.toContainText('가맹 161곳')

  await shot(page, 'e2e-shots/P2-alt-path.png')
})

test('P2 · 시설 출처 라벨은 원천(faci_gb) 그대로 — 신고 시설을 "공공체육시설"이라 부르지 않는다 (FR-04 AC7)', async ({
  page,
}) => {
  await startPersona(page, 'P2')
  await openPanel(page, 'list')

  const list = panel(page).getByTestId('panel-body')
  // 목 계약: P01·P03 = 공공, P07 돈암동체력단련장 = 신고(실DB 성북 대안의 62%가 신고 시설)
  const row = list.locator('li').filter({ hasText: '돈암동체력단련장' }).first()
  await expect(row).toContainText('신고 체육시설')
  await expect(row).not.toContainText('공공체육시설')
  await expect(list.getByText('공공체육시설').first()).toBeVisible() // 공공 행은 그대로 공공
})

test('딥링크 /#/demo?p=P2 — 칩을 누르지 않아도 P2 로 판정까지 간다 (OV10, LLM 0회)', async ({
  page,
}) => {
  const chatCalls: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/chat/')) chatCalls.push(r.url())
  })

  await page.goto('/#/demo?p=P2')
  // beforeEach 가 이미 /#/demo 에 있어 위 goto 는 해시만 바꾼다(문서 재로드 없음).
  // 실제 QR·리다이렉트 진입은 "새로 로드"이므로 그 상황을 그대로 만든다 — p= 는 부팅 때 읽는다.
  await page.reload()
  // 페르소나 칩을 클릭하지 않았는데 판정 결과가 온다(칩 경로와 같은 코드)
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  // 사용자 버블 = 칩을 누른 것과 같은 에코(칩 라벨과 문구가 같아 마지막 것을 본다)
  await expect(stream(page).getByText('P2 · 낀 계층 청년').last()).toBeVisible()
  await expect(stream(page).getByTestId('alt-routes-block')).toBeVisible()
  // 후속 칩 묶음도 칩 경로와 같다(FAQ 칩 포함) — 딥링크만 다른 화면이 되지 않는다
  await expect(page.getByTestId('chip-act-fitness')).toBeVisible()
  await expect(page.getByTestId('chip-faq-dvoucher_income')).toBeVisible()
  expect(chatCalls, '딥링크가 챗 엔드포인트를 호출했다').toHaveLength(0)

  // 데모 칩 노출 순서는 클라 고정 상수(P2 → P5 → P1 → P3 → P4)
  const ids = await page
    .getByTestId('chat-stream')
    .locator('[data-testid^="chip-persona-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(ids).toEqual([
    'chip-persona-P2',
    'chip-persona-P5',
    'chip-persona-P1',
    'chip-persona-P3',
    'chip-persona-P4',
  ])
})

test('P3 · 14세 지체장애 → 장애인스포츠강좌이용권 예상 자격 ✓ + 미검증 경고', async ({ page }) => {
  await startPersona(page, 'P3')

  const dcard = stream(page).getByRole('article', {
    name: '장애인스포츠강좌이용권 예상 자격 결과',
    exact: true,
  })
  await expect(dcard).toBeVisible()
  await expect(dcard.getByText('예상 자격', { exact: true })).toBeVisible()
  await expect(dcard.getByText('공식 확인 필요 (자격 기준 미검증)')).toBeVisible()

  await shot(page, 'e2e-shots/P3-dvoucher-eligible.png')
})

test('P4 · 72세 청각장애(강원 고성군) → 공급공백 배너 + 최근접 안내', async ({ page }) => {
  await startPersona(page, 'P4')

  const alert = stream(page).getByRole('alert').filter({ hasText: '가맹시설이 없습니다' })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('고성군')
  await expect(stream(page).getByText(/가장 가까운 곳은/)).toBeVisible()
  // 커버리지(수급률)는 서울 15구 실측분뿐 — 인천은 데이터가 없으므로 그 줄을 만들지 않는다(P-1).
  await expect(stream(page).getByText(/수급률은/)).toHaveCount(0)
  // 연령 초과 → 공공시설(고성군 조례: 등록 장애인 50%) + 어르신 상품권·무료강좌 = 공식 확인 3
  await expect(stream(page).getByTestId('alt-route-item')).toHaveCount(3)
  await expect(stream(page).getByTestId('alt-route-pending')).toHaveCount(0)
  await expect(stream(page).getByTestId('public-fee-summary')).toHaveText('고성군 군립 체육시설 · 장애인 50%')

  await shot(page, 'e2e-shots/P4-supply-gap.png')
})

test('P3 · 성북구 → 공급공백 배너에 커버리지 수급률 한 줄 (정직 신호, 데이터 있는 구)', async ({
  page,
}) => {
  await startPersona(page, 'P3')
  await expect(stream(page).getByText(/수급률은/)).toBeVisible()
})

test('좌표 정직성: "위치 근사(구 중심)" 배지 + 이용권 블록 "반경" 미표기 (FR-04)', async ({ page }) => {
  // P3: 성북 dvoucher 가맹 0 → 공급공백 + 최근접(강북 D01) 근사좌표 시설 노출
  await startPersona(page, 'P3')

  // FR-04 AC1: 구 중심 폴백 좌표 시설엔 "위치 근사(구 중심)" 배지가 1개 이상 렌더된다
  const approx = stream(page).getByText('위치 근사(구 중심)')
  await expect(approx.first()).toBeVisible()
  expect(await approx.count()).toBeGreaterThanOrEqual(1)

  // FR-04 AC2: 이용권 공급공백 블록은 구 단위 집계라 "반경" 문구가 없어야 한다
  const voucherGap = stream(page).getByTestId('voucher-gap-block')
  await expect(voucherGap).toBeVisible()
  await expect(voucherGap).not.toContainText('반경')

  // 근사좌표 이용권 시설엔 거리(km)도 함께 표기하지 않는다(카피 사전) — 패널 목록에서도 동일.
  await openPanel(page, 'list')
  const voucherSection = panel(page).getByTestId('voucher-section')
  await expect(voucherSection).toBeVisible()
  await expect(voucherSection).not.toContainText('km')
})

test('경로 그림 1280px — 가로 스크롤 없이 스트림 폭에 들어오고 대체경로 칸이 넉넉하다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await startPersona(page, 'P2')
  const path = stream(page).getByRole('region', { name: '추천 경로 시각화' })
  await expect(path).toBeVisible()
  const scroller = path.getByRole('group', { name: '경로 단계 (좌우로 스크롤)' })
  const over = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(over, '1280 에서 경로 그림이 가로로 넘친다').toBeLessThanOrEqual(1)
  const curated = path.getByTestId('path-edge-curated')
  await expect(curated).toBeVisible()
  const box = (await path.getByTestId('path-edge').nth(1).boundingBox())!
  expect(box.width, `대체경로 칸 폭 ${box.width}`).toBeGreaterThanOrEqual(150)
  const curLines = await curated.locator('span').last().evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16
    return Math.round(el.getBoundingClientRect().height / lh)
  })
  expect(curLines, '1280 에서 확인 표기가 3줄을 넘는다').toBeLessThanOrEqual(2)
  const lines = await path.getByTestId('path-edge-label').nth(1).evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16
    return Math.round(el.getBoundingClientRect().height / lh)
  })
  expect(lines, '1280 에서 대체경로 설명이 3줄을 넘는다').toBeLessThanOrEqual(3)
})

// 2026-09-28: 조례 감면은 이용권 자격과 무관 — 자격 ✓(P1)에게도 "함께 받을 수 있는 것" 블록,
// 대체경로가 이미 같은 블록을 보여 주는 P2 에는 다시 그리지 않는다(중복 렌더 금지 · 히어로 N 불변).
test('P1 · 자격 ✓ 에도 "함께 받을 수 있는 것 · 구립 체육시설 감면"이 보이고, P2 에는 중복되지 않는다', async ({
  page,
}) => {
  await startPersona(page, 'P1')
  const extra = stream(page).getByTestId('public-fee-extra')
  await expect(extra).toBeVisible()
  await expect(extra).toContainText('함께 받을 수 있는 것 · 구립 체육시설 감면')
  await expect(extra.getByTestId('public-fee-summary')).toContainText('성북구 구립 체육시설')
  await expect(extra.getByTestId('public-fee-law-link')).toHaveText('조례 제10조')
  // 히어로(지금 바로 되는 것)는 만들지 않는다
  await expect(stream(page).getByTestId('alt-routes-block')).toHaveCount(0)

  // 같은 해시(#/demo)로 다시 가면 대화가 그대로 남는다 — 메인을 거쳐 데모를 새로 시작한다.
  await page.goto('/')
  await page.reload()
  await openDemo(page)
  await startPersona(page, 'P2')
  await expect(stream(page).getByTestId('alt-routes-block')).toBeVisible()
  await expect(stream(page).getByTestId('public-fee-extra')).toHaveCount(0)
  await expect(stream(page).getByTestId('public-fee-summary')).toHaveCount(1)
})
