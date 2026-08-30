import { test, expect } from '@playwright/test'
import { mapBox, openDemo, openPanel, panel, startPersona } from './helpers'

// 시설 목록 → 지도 확대(2026-08-30 사용자 요청: "시설목록에서 이거 누르면 지도에서 어디인지
// 바로 확대되면서 보이게"). 계약 —
//   ① 목록 행의 **이름**이 버튼이다(행 전체가 아니다 — 행 안의 다른 링크와 섞이지 않는다)
//   ② 누르면 지도 탭으로 바뀌고, 그 좌표로 확대(zoom ≥ 15)되며 마커 하나가 강조된다
//   ③ 모바일에서는 패널이 화면 안으로 들어온다(지도를 보려고 누른 것이므로 이 행동만 예외)
//   ④ 실좌표가 없는 행(구 중심 폴백)은 버튼 대신 "지도 확대 불가"를 말한다(P-1 거짓 정밀도 금지)

test('① 시설 이름을 누르면 지도 탭으로 바뀌고 그 시설로 확대 + 마커 강조', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2')
  await openPanel(page, 'list')

  const locate = panel(page).getByTestId('facility-locate').first()
  await expect(locate).toBeVisible()
  // 이름 버튼의 접근성 이름은 "{시설명} 지도에서 보기"
  const label = await locate.getAttribute('aria-label')
  expect(label, `aria-label ${label}`).toMatch(/ 지도에서 보기$/)

  await locate.click()

  // 지도 탭으로 전환 + 지도가 뷰포트 안(모바일에서는 패널까지 데려간다)
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  const vh = page.viewportSize()!.height
  await expect
    .poll(
      async () => {
        const b = await mapBox(page).boundingBox()
        return b != null && b.y < vh && b.y + b.height > 0
      },
      { message: '지도가 화면 안으로 들어오지 않았다', timeout: 3_000 },
    )
    .toBe(true)

  // 그 시설로 확대된다(fitBounds 의 maxZoom 15 보다 안쪽)
  await expect
    .poll(async () => Number((await mapBox(page).getAttribute('data-zoom')) ?? 0), {
      message: '1.5초 안에 확대되지 않았다',
      timeout: 1_500,
    })
    .toBeGreaterThanOrEqual(15)

  // 강조 마커는 정확히 하나 — 색은 그대로고 크기·테두리로만 구분한다
  await expect(page.getByTestId('marker-focused')).toHaveCount(1)
  const size = await page
    .getByTestId('marker-focused')
    .evaluate((el) => el.getBoundingClientRect().width)
  expect(size, `강조 마커 지름 ${size}px`).toBeGreaterThan(20)
})

test('② 같은 목록에서 다른 시설을 눌러도 강조는 하나만 남는다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2')
  await openPanel(page, 'list')

  const buttons = panel(page).getByTestId('facility-locate')
  const n = await buttons.count()
  expect(n, '실좌표 행이 2개 미만이라 이 검사를 못 한다').toBeGreaterThanOrEqual(2)

  await buttons.nth(0).click()
  await expect(page.getByTestId('marker-focused')).toHaveCount(1)
  const first = await page.getByTestId('marker-focused').getAttribute('aria-label')

  await page.getByTestId('panel-tab-list').click()
  await buttons.nth(1).click()
  await expect(page.getByTestId('marker-focused')).toHaveCount(1)
  const second = await page.getByTestId('marker-focused').getAttribute('aria-label')
  expect(second, '두 번째 지목에서 강조가 옮겨가지 않았다').not.toBe(first)
})

test('④ 구 중심 폴백 좌표 행은 버튼 대신 "지도 확대 불가"를 말한다', async ({ page }) => {
  await openDemo(page)
  // P1 의 이용권 가맹 행은 전부 구 중심 폴백(계약 fixtures), 공공·대안 행은 실좌표다 —
  // 한 목록 안에서 두 규칙이 섞여 있는 것까지 함께 본다.
  await startPersona(page, 'P1')
  await openPanel(page, 'list')

  const approxRows = panel(page).getByTestId('facility-locate-unavailable')
  await expect(approxRows.first()).toBeVisible()
  await expect(approxRows.first()).toContainText('위치 근사 — 지도 확대 불가')
  // 실좌표 행은 같은 목록에서 여전히 버튼을 갖는다
  await expect(panel(page).getByTestId('facility-locate').first()).toBeVisible()
  // 같은 행 안에 지목 버튼이 함께 있지는 않다
  const row = approxRows.first().locator('xpath=ancestor::li[1]')
  await expect(row.getByTestId('facility-locate')).toHaveCount(0)
})
