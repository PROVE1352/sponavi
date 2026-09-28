import { test, expect } from '@playwright/test'
import {
  assertNoHorizontalScroll,
  deck,
  expectAtBottom,
  expectMapMounted,
  fillMainSlots,
  longestRun,
  openDemo,
  openMain,
  panel,
  settleTypewriter,
  snapContainerCount,
  startPersona,
  stream,
  traceViewport,
  viewportTrace,
} from './helpers'

// 모바일 결과 덱 v1.7 계약(PRD FR-12 AC9) — 사용자 원문: "휴대폰일 경우 상하가 너무 많이 움직임".
//   ① 390px 결과는 단일 덱 하나(판정 → 공백·커버리지 → 시설) + 덱 밖 히어로로 통합된다(v1.10 6A)
//   ② 결과 세로 길이가 v1.6(개별 메시지 나열) 대비 크게 줄어든다
//   ③ 오토스크롤: 덱 시작점으로 먼저 한 번 → 후속 안내가 등장하면 바닥(액션 칩)으로 내려가고
//      거기서부터 바닥 추종을 재개한다(2026-08-28 사용자 결정 · v1.11)
//   ④ 데스크톱(lg+)은 기존 세로 블록 유지
//   ⑤ "지도에서 보기"·"시설 목록 보기"는 패널을 열고 실제로 화면에 데려온다(실기기 피드백)

// v1.6 실측(390px, 목 데이터): 결과 블록(판정 카드 최상단 ~ 시설 요약 최하단) 세로 길이
//   P1 1502px · P5 2697px · 메인 칩 완주 1562px
// 덱은 "가장 높은 슬라이드 1장 + 힌트/진행 표시"라 이 값들을 밑돌아야 한다.
// ★ v1.10 재측정: 히어로('지금 바로 되는 것' 전폭 블록)와 근처 강좌 3행이 덱 밖·앵커 안으로
//   올라와 앵커 높이에 합산된다(설계 6A). 실측 P5 2279 · P2 1590 · P1 1391 · 메인 1429
//   → 상한 2400(여전히 v1.6 나열 2697 아래). "덱 자체가 짧다"는 ① 의 슬라이드 구성이 본다.
const DECK_MAX_H = 2400

async function resultBlockHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-result-anchor]') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().height) : -1
  })
}

test('① 390px — 판정 결과 = 덱 밖 히어로 + 단일 덱(6A)', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P5')
  await settleTypewriter(page)

  const d = deck(page)
  await expect(d).toBeVisible()
  // 결과 영역의 가로 스냅 컨테이너는 이 덱 하나뿐이다
  expect(await snapContainerCount(page)).toBe(1)

  // ★ v1.10(6A): '지금 바로 되는 것'은 덱 슬라이드가 아니다 — 덱 밖, 그러나 같은 결과 메시지
  //   (앵커 [data-result-anchor]) 안에서 덱보다 먼저 온다. 그래서 폰 첫 화면에 스와이프 없이 보인다.
  const anchor = page.locator('[data-result-anchor]')
  await expect(d.getByTestId('now-available-block')).toHaveCount(0)
  await expect(anchor.getByTestId('now-available-block')).toBeVisible()
  // 계약 JSON = 공식 확인 3(성북 조례 감면 공공시설·튼튼머니·소득공제) → 본문 3줄, 확인 중 없음
  await expect(anchor.getByTestId('now-available-item')).toHaveCount(3)
  await expect(anchor.getByTestId('alt-route-pending')).toHaveCount(0)

  // 슬라이드 구성: 판정 카드 → 공급공백·커버리지 → 근처 자원(시설 요약 + 미리보기 목록)
  await expect(d.getByRole('article', { name: /예상 자격 결과/ }).first()).toBeVisible()
  await expect(d.getByTestId('selection-block')).toBeVisible()
  // 계약 갱신(T2A): 성북 장애인 가맹은 41곳 — 공급공백이 아니라 구 단위 공급 블록이 온다
  await expect(d.getByTestId('voucher-supply-block')).toContainText('성북구 가맹 41곳')
  await expect(d.getByText(/수급률은/)).toBeVisible() // 커버리지(같은 슬라이드)
  await expect(d.getByTestId('dvoucher-facility').first()).toBeVisible()
  await expect(d.getByTestId('facility-summary')).toBeVisible()
  // 슬라이드 수 = 판정 3 + 공백 1 + 근처 자원 1 = 5 (대체경로 슬라이드 없음).
  // 시설 행은 각자 슬라이드가 아니라 '근처 자원' 슬라이드 안의 목록이다(2026-09-28: 행마다 한 장이라 "1 / 8"로 부풀던 것).
  await expect(page.getByTestId('deck-progress')).toContainText('/ 5')
  await expect(d.getByTestId('facility-summary').getByTestId('dvoucher-facility')).toHaveCount(3)

  // 결과가 세로 버블로 쌓이지 않는다 — 결과 메시지는 스트림에 딱 하나
  await expect(anchor).toHaveCount(1)
  await assertNoHorizontalScroll(page)
})

test('①-b 390px — P2(✗) 첫 화면에서 스와이프 없이 히어로가 보인다(6A 성공기준)', async ({
  page,
}) => {
  await openDemo(page)
  // v1.11: 후속 안내가 화면을 바닥으로 데려가므로 "첫 화면"은 최종 상태가 아니라 **구간**이다.
  // 덱 시작점에 머무는 동안 히어로가 실제로 보였는지를 궤적으로 본다(스쳐 지나감과 구별).
  await traceViewport(page, { hero: '[data-testid="alt-routes-block"]' })
  await startPersona(page, 'P2')
  await settleTypewriter(page)

  const hero = stream(page).getByTestId('alt-routes-block')
  await expect(hero).toBeVisible()
  const vh = page.viewportSize()!.height
  const held = longestRun(
    await viewportTrace(page),
    (sp) => sp.boxes.hero != null && sp.boxes.hero.top < vh && sp.boxes.hero.bottom > 0,
  )
  // 오토스크롤이 앵커를 화면 위쪽에 붙인 뒤 히어로가 최소 0.4초는 화면에 머문다(가로 스와이프 0회)
  expect(held, `히어로가 화면에 머문 연속 샘플 ${held}개(50ms 간격)`).toBeGreaterThanOrEqual(8)
  // 결과 카드 하단 인라인 강좌는 3행까지만(전체 목록은 패널)
  const rows = stream(page).getByTestId('inline-facilities').locator('> ul > li')
  expect(await rows.count(), '인라인 강좌는 3행 이하').toBeLessThanOrEqual(3)
})

test('② 390px — 결과 세로 길이가 v1.6 개별 메시지 나열보다 크게 줄었다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P5') // v1.6 결과 블록 실측 2697px
  await settleTypewriter(page)
  const p5 = await resultBlockHeight(page)
  expect(p5, `P5 결과 메시지 높이 ${p5}px`).toBeGreaterThan(0)
  expect(p5, `P5 결과 메시지 높이 ${p5}px`).toBeLessThan(DECK_MAX_H)

  await openMain(page)
  await fillMainSlots(page) // v1.6 결과 블록 실측 1562px
  await settleTypewriter(page)
  const main = await resultBlockHeight(page)
  expect(main, `메인 결과 메시지 높이 ${main}px`).toBeLessThan(DECK_MAX_H)
})

test('③ 오토스크롤 — 덱 시작점에 먼저 머문 뒤, 후속 안내가 오면 바닥(액션 칩)으로 내려간다', async ({
  page,
}) => {
  await openDemo(page)
  await traceViewport(page, { anchor: '[data-result-anchor]', chip: '[data-testid="chip-act-restart"]' })
  await startPersona(page, 'P1')
  await settleTypewriter(page)

  // ② 후속 안내("더 필요하신 게 있으면…")가 열리면 액션 칩까지 내려간다(2026-08-28 결정)
  await expectAtBottom(page, '후속 안내가 왔는데 바닥(액션 칩)까지 내려가지 않았다')
  const chip = await page.getByTestId('chip-act-restart').boundingBox()
  const vh = page.viewportSize()!.height
  expect(chip, '후속 칩 박스를 못 잡았다').not.toBeNull()
  expect(chip!.y, `후속 칩 top ${chip!.y}`).toBeGreaterThanOrEqual(0)
  expect(chip!.y + chip!.height, '후속 칩이 화면 아래에 잘려 있다').toBeLessThanOrEqual(vh)

  // ① 그전에 덱 시작점(헤더 아래)에 실제로 **머물렀다** — 바닥으로 스쳐 지나간 게 아니다
  const trace = await viewportTrace(page)
  const held = longestRun(
    trace,
    (s) => s.boxes.anchor != null && s.boxes.anchor.top > -60 && s.boxes.anchor.top < 220,
  )
  expect(held, `덱 시작점에 머문 연속 샘플 ${held}개(50ms 간격)`).toBeGreaterThanOrEqual(6)
  // 순서: 덱 시작점 체류가 바닥 도달보다 먼저다
  const restedAt = trace.findIndex(
    (s) => s.boxes.anchor != null && s.boxes.anchor.top > -60 && s.boxes.anchor.top < 220,
  )
  const bottomAt = trace.findIndex((s) => s.gap <= 2 && s.boxes.chip != null)
  expect(restedAt, '덱 시작점 체류가 기록되지 않았다').toBeGreaterThanOrEqual(0)
  expect(bottomAt, '바닥 도달이 기록되지 않았다').toBeGreaterThan(restedAt)
})

test('③-b 후속 안내 뒤에는 바닥 추종이 재개된다 — 다음 봇 버블도 화면에 따라온다', async ({
  page,
}) => {
  await openMain(page)
  await fillMainSlots(page, { income: '그외' })

  // 덱 시작점보다 아래(= 실제로 더 내려왔다) + 액션 칩이 화면 안
  const deckTop = await page.evaluate(() => {
    const el = document.querySelector('[data-result-anchor]') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().top + window.scrollY - 72) : -1
  })
  await expectAtBottom(page, '후속 안내가 왔는데 바닥까지 내려가지 않았다')
  const y = await page.evaluate(() => Math.round(window.scrollY))
  expect(y, `scrollY ${y} · 덱 시작점 ${deckTop}`).toBeGreaterThan(deckTop)
  const vh = page.viewportSize()!.height
  const chip = await page.getByTestId('chip-act-restart').boundingBox()
  expect(chip!.y).toBeGreaterThanOrEqual(0)
  expect(chip!.y + chip!.height).toBeLessThanOrEqual(vh)

  // 여기서부터는 평범한 대화 — 새 봇 버블(처음부터 확인 질문)이 오면 다시 바닥에 붙는다
  await page.getByTestId('chip-act-restart').click()
  await expect(stream(page).getByText(/처음부터 다시 시작할까요/)).toBeVisible()
  await settleTypewriter(page)
  await expectAtBottom(page, '후속 안내 뒤 새 버블에서 바닥 추종이 재개되지 않았다')
  const keep = await page.getByTestId('chip-restart-no').boundingBox()
  expect(keep!.y).toBeGreaterThanOrEqual(0)
  expect(keep!.y + keep!.height, '새 칩이 화면 아래에 잘려 있다').toBeLessThanOrEqual(vh)
})

test.describe('데스크톱', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('④ lg+ 는 덱이 아니라 기존 세로 블록(그리드 + 배너 + 시설 요약)을 유지한다', async ({
    page,
  }) => {
    await openDemo(page)
    await startPersona(page, 'P1')

    await expect(page.getByTestId('result-deck')).toHaveCount(0)
    await expect(page.getByTestId('assess-carousel')).toBeVisible()
    await expect(page.getByTestId('facility-carousel')).toBeVisible()
    await expect(page.getByTestId('facility-summary')).toBeVisible()
  })
})

test('⑤ 390px — "지도에서 보기"·"시설 목록 보기"는 패널을 열되 화면은 바닥에 남긴다', async ({
  page,
}) => {
  await openDemo(page)
  await startPersona(page, 'P1')
  await settleTypewriter(page)
  await expectAtBottom(page, '결과 뒤 바닥에 있지 않다(⑤ 시작 조건)')

  // 덱 안의 "지도에서 보기" → 지도 탭이 열린다
  await deck(page).getByTestId('open-map-panel').click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('panel-body')).toBeVisible()
  await expectMapMounted(page)

  // ★ 2026-08-30 사용자 결정: 패널로 데려가지 않는다. 모바일에서 패널은 스트림 위쪽이라
  //   패널까지 끌고 가면 방금 붙은 답과 액션 칩이 화면 밖으로 밀린다(제보: scrollY 2836 → 12).
  //   지도 타일·패널이 뒤늦게 커져도 결국 바닥에 닿아 있어야 한다(레이아웃 성장 추종).
  await expectAtBottom(page, '"지도에서 보기" 뒤 화면이 바닥에 남지 않았다')
  const vh = page.viewportSize()!.height
  const mapChip = await page.getByTestId('chip-act-list').boundingBox()
  expect(mapChip!.y).toBeGreaterThanOrEqual(0)
  expect(mapChip!.y + mapChip!.height, '액션 칩이 화면 밖으로 밀렸다').toBeLessThanOrEqual(vh)

  // 스트림 후속 칩("시설 목록 보기")도 같은 규칙 — 탭만 바뀌고 화면은 바닥
  await page.getByTestId('chip-act-list').click()
  await expect(page.getByTestId('panel-tab-list')).toHaveAttribute('aria-selected', 'true')
  await expect(panel(page).getByTestId('voucher-section')).toBeVisible()
  await expectAtBottom(page, '"시설 목록 보기" 뒤 화면이 바닥에 남지 않았다')

  // 화자도 한 줄로 알려 준다(정직: 어디가 바뀌었는지). 방향("옆")은 말하지 않는다 —
  // 폰에서 패널은 옆이 아니라 위다.
  await expect(stream(page).getByText(/패널에 열어 두었어요/).first()).toBeAttached()
  await expect(stream(page).getByText(/옆 패널/)).toHaveCount(0)
})

test('⑤-b 메인 경로에서도 패널 칩은 화면을 바닥에 남긴다(지도·목록 둘 다)', async ({ page }) => {
  await openMain(page)
  await fillMainSlots(page)
  await settleTypewriter(page)

  for (const [chip, tab] of [
    ['chip-act-map', 'map'],
    ['chip-act-list', 'list'],
  ] as const) {
    // 일부러 위로 올라간 상태에서 누른다 — "누르면 바닥으로 돌아온다"가 계약이다
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))
    await page.getByTestId(chip).click()
    await expect(page.getByTestId(`panel-tab-${tab}`)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('panel-body')).toBeVisible()
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => document.documentElement.scrollHeight - window.innerHeight - Math.round(window.scrollY),
          ),
        { message: `${chip} 을 눌렀는데 3초 안에 바닥으로 돌아오지 않았다`, timeout: 3_000 },
      )
      .toBeLessThanOrEqual(2)
  }
})
