import { test, expect } from '@playwright/test'
import {
  assertNoHorizontalScroll,
  deck,
  fillMainSlots,
  openDemo,
  openMain,
  panel,
  settleTypewriter,
  snapContainerCount,
  startPersona,
  stream,
} from './helpers'

// 모바일 결과 덱 v1.7 계약(PRD FR-12 AC9) — 사용자 원문: "휴대폰일 경우 상하가 너무 많이 움직임".
//   ① 390px 결과는 단일 덱 하나(판정 → 대체경로 → 공백·커버리지 → 시설)로 통합된다
//   ② 결과 세로 길이가 v1.6(개별 메시지 나열) 대비 크게 줄어든다
//   ③ 오토스크롤은 덱 시작점으로 한 번만 — 결과 시퀀스가 바닥을 연쇄 추종하지 않는다
//   ④ 데스크톱(lg+)은 기존 세로 블록 유지
//   ⑤ "지도에서 보기"·"시설 목록 보기"는 패널을 열고 실제로 화면에 데려온다(실기기 피드백)

// v1.6 실측(390px, 목 데이터): 결과 블록(판정 카드 최상단 ~ 시설 요약 최하단) 세로 길이
//   P1 1502px · P5 2697px · 메인 칩 완주 1562px
// 덱은 "가장 높은 슬라이드 1장 + 힌트/진행 표시"라 이 값들을 크게 밑돌아야 한다.
const DECK_MAX_H = 1100

async function resultBlockHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-result-anchor]') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().height) : -1
  })
}

test('① 390px — 판정 결과가 단일 덱으로 통합된다(판정·대체경로·공백·시설 슬라이드)', async ({
  page,
}) => {
  await openDemo(page)
  await startPersona(page, 'P5')
  await settleTypewriter(page)

  const d = deck(page)
  await expect(d).toBeVisible()
  // 결과 영역의 가로 스냅 컨테이너는 이 덱 하나뿐이다
  expect(await snapContainerCount(page)).toBe(1)

  // 슬라이드 구성: 판정 카드 → 지금 바로 되는 것 → 공급공백·커버리지 → 시설 요약 → 시설 카드
  await expect(d.getByRole('article', { name: /예상 자격 결과/ }).first()).toBeVisible()
  await expect(d.getByTestId('selection-block')).toBeVisible()
  await expect(d.getByTestId('now-available-block')).toBeVisible()
  await expect(d.getByTestId('now-available-item')).toHaveCount(3)
  await expect(d.getByTestId('voucher-gap-block')).toBeVisible() // 공급공백
  await expect(d.getByText(/수급률은/)).toBeVisible() // 커버리지(같은 슬라이드)
  await expect(d.getByTestId('facility-summary')).toBeVisible()
  await expect(d.getByTestId('dvoucher-facility').first()).toBeVisible()

  // 결과가 세로 버블로 쌓이지 않는다 — 결과 메시지는 스트림에 딱 하나
  await expect(page.locator('[data-result-anchor]')).toHaveCount(1)
  await assertNoHorizontalScroll(page)
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

test('③ 오토스크롤 — 결과 도착 시 덱 시작점으로 한 번만 이동한다(바닥 연쇄 추종 금지)', async ({
  page,
}) => {
  await openDemo(page)
  await startPersona(page, 'P1')
  await settleTypewriter(page)

  // 덱 시작점이 화면 위쪽(헤더 아래)에 와 있다
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector('[data-result-anchor]') as HTMLElement | null
          return el ? Math.round(el.getBoundingClientRect().top) : 99999
        }),
      { message: '결과 덱 시작점이 화면 위쪽에 오지 않았다' },
    )
    .toBeLessThan(220)

  const top = await page.evaluate(() => {
    const el = document.querySelector('[data-result-anchor]') as HTMLElement | null
    return el ? Math.round(el.getBoundingClientRect().top) : 99999
  })
  expect(top).toBeGreaterThan(-60)

  // 후속 칩까지 도착했지만 바닥으로 끌려 내려가지 않았다
  await expect(page.getByTestId('chip-act-restart')).toBeAttached()
  const atBottom = await page.evaluate(
    () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40,
  )
  expect(atBottom, '결과 시퀀스가 바닥까지 연쇄 스크롤했다').toBe(false)
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

test('⑤ 390px — "지도에서 보기"·"시설 목록 보기"가 패널을 열고 화면으로 데려온다', async ({
  page,
}) => {
  await openDemo(page)
  await startPersona(page, 'P1')
  await settleTypewriter(page)

  // 결과까지 내려온 상태 — 이 시점에 패널(스트림 위쪽)은 화면 밖에 있다
  const before = await panel(page).boundingBox()
  const vh = page.viewportSize()!.height
  expect(before, '패널 박스를 못 잡았다').not.toBeNull()
  expect(before!.y + before!.height, '시작 상태에서 이미 패널이 화면 안이다').toBeLessThan(0)

  // 덱 안의 "지도에서 보기" → 지도 탭 활성 + 패널이 뷰포트 안으로 들어온다
  await deck(page).getByTestId('open-map-panel').click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('panel-body')).toBeVisible()
  // 패널 본문이 실제로 뷰포트 안에 들어온다(위로 벗어나 있지도, 아래로 밀려 있지도 않다)
  await expect
    .poll(
      async () => {
        const b = await page.getByTestId('panel-body').boundingBox()
        return b && b.y < vh && b.y + b.height > 0
      },
      { message: '지도 패널이 화면 안으로 들어오지 않았다' },
    )
    .toBe(true)
  await expect(page.locator('.leaflet-container')).toBeVisible()

  // 스트림 후속 칩("시설 목록 보기")도 같은 동작 — 목록 탭으로 전환되고 다시 데려온다
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }))
  await page.getByTestId('chip-act-list').click()
  await expect(page.getByTestId('panel-tab-list')).toHaveAttribute('aria-selected', 'true')
  await expect
    .poll(
      async () => {
        const b = await page.getByTestId('panel-body').boundingBox()
        return b && b.y < vh && b.y + b.height > 0
      },
      { message: '목록 패널이 화면 안으로 들어오지 않았다' },
    )
    .toBe(true)
  await expect(panel(page).getByTestId('voucher-section')).toBeVisible()

  // 나비도 한 줄로 알려 준다(정직: 어디가 바뀌었는지)
  await expect(stream(page).getByText(/패널에 열어 두었어요/).first()).toBeAttached()
})
