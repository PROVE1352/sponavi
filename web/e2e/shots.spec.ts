import { test, expect, type Page } from '@playwright/test'

// 심사용 스크린샷 갱신 — 두 뷰포트(모바일 390px · 데스크톱 1280px).
// 기존 e2e-shots 관례에 맞춰 fullPage 캡처. 목 모드(VITE_MOCK=1)라 서버 불필요.

const VIEWPORTS = [
  { tag: '390', width: 390, height: 844 },
  { tag: '1280', width: 1280, height: 900 },
] as const

async function ready(page: Page) {
  await expect(page.getByRole('heading', { name: '스포내비', level: 1 })).toBeVisible()
  await expect(page.getByTestId('persona-P1')).toBeVisible()
}

// 모바일 가로 스크롤 0(요건 4): 문서 스크롤폭이 뷰포트를 넘지 않는다(지도·표는 자체 스크롤).
async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `가로 오버플로 ${overflow}px`).toBeLessThanOrEqual(1)
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.tag}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`랜딩 @${vp.tag}`, async ({ page }) => {
      await page.goto('/')
      await ready(page)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await page.screenshot({ path: `e2e-shots/landing-${vp.tag}.png`, fullPage: true })
    })

    test(`P1 결과(자격 ✓) @${vp.tag}`, async ({ page }) => {
      await page.goto('/')
      await ready(page)
      await page.getByTestId('persona-P1').click()
      await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
      await page.waitForTimeout(1200) // 지도 타일·마커 렌더 여유
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await page.screenshot({ path: `e2e-shots/P1-eligible-${vp.tag}.png`, fullPage: true })
    })

    test(`P5 결과(선정순위 + 지금 바로 되는 것) @${vp.tag}`, async ({ page }) => {
      await page.goto('/')
      await ready(page)
      await page.getByTestId('persona-P5').click()
      await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
      await page.waitForTimeout(1200)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await page.screenshot({ path: `e2e-shots/P5-priority-${vp.tag}.png`, fullPage: true })
    })
  })
}
