import { test, expect, type Page } from '@playwright/test'
import { assertNoHorizontalScroll, openChat, shot, startPersona } from './helpers'

// 심사용 스크린샷 갱신(챗 UI) — 두 뷰포트(모바일 390px · 데스크톱 1280px) × 3장면.
//   랜딩 챗 / P1 판정 스트림+패널 / P5 선정순위 카드
// 목 모드(VITE_MOCK=1)라 서버 불필요. 시나리오별 스샷(P2·P3·P4·F1·P5-selection)은 각 spec 소유.

const VIEWPORTS = [
  { tag: '390', width: 390, height: 844 },
  { tag: '1280', width: 1280, height: 900 },
] as const

// 데스크톱(lg)은 패널이 상시 노출, 모바일은 접힘 → 스샷에는 펼쳐서 담는다.
async function expandPanel(page: Page, tag: string) {
  if (tag !== '390') return
  await page.getByTestId('panel-toggle').click()
  await expect(page.getByTestId('panel-tab-map')).toBeVisible()
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.tag}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`랜딩 챗 @${vp.tag}`, async ({ page }) => {
      await openChat(page)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await shot(page, `e2e-shots/landing-${vp.tag}.png`)
    })

    test(`P1 판정 스트림 + 패널(자격 ✓) @${vp.tag}`, async ({ page }) => {
      await openChat(page)
      await startPersona(page, 'P1')
      await expandPanel(page, vp.tag)
      await expect(page.locator('.leaflet-container')).toBeVisible()
      await page.waitForTimeout(1200) // 지도 타일·마커 렌더 여유(유일한 고정 대기)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await shot(page, `e2e-shots/P1-eligible-${vp.tag}.png`)
    })

    test(`P5 판정(선정순위 + 지금 바로 되는 것) @${vp.tag}`, async ({ page }) => {
      await openChat(page)
      await startPersona(page, 'P5')
      await expect(page.getByTestId('now-available-block')).toBeVisible()
      await expandPanel(page, vp.tag)
      await expect(page.locator('.leaflet-container')).toBeVisible()
      await page.waitForTimeout(1200)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await shot(page, `e2e-shots/P5-priority-${vp.tag}.png`)
    })
  })
}
