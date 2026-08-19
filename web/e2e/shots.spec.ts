import { test, expect } from '@playwright/test'
import { assertNoHorizontalScroll, openDemo, openMain, shot, startPersona, waitForMapIdle } from './helpers'

// 심사용 스크린샷 갱신(챗 UI) — 두 뷰포트(모바일 390px · 데스크톱 1280px) × 3장면.
//   랜딩 챗(= 실사용 메인) / P1 판정 스트림+패널 / P5 선정순위 카드
// v1.4: 랜딩 장면은 메인(/), 페르소나 결과 장면은 데모 페이지(/#/demo) 경유로 찍는다.
// 목 모드(VITE_MOCK=1)라 서버 불필요. 시나리오별 스샷(P2·P3·P4·F1·P5-selection)은 각 spec 소유.

const VIEWPORTS = [
  { tag: '390', width: 390, height: 844 },
  { tag: '1280', width: 1280, height: 900 },
] as const

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.tag}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`랜딩 챗 @${vp.tag}`, async ({ page }) => {
      await openMain(page) // 실사용 랜딩(인사 1버블 + 첫 질문)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await shot(page, `e2e-shots/landing-${vp.tag}.png`)
    })

    test(`P1 판정 스트림 + 패널(자격 ✓) @${vp.tag}`, async ({ page }) => {
      await openDemo(page)
      await startPersona(page, 'P1')
      // 패널은 결과 도착과 함께 자동으로 펼쳐진다(v1.4) — 별도 펼치기 조작 없음
      await expect(page.getByTestId('panel-tab-map')).toBeVisible()
      await waitForMapIdle(page) // 벡터 타일 렌더 완료('idle')까지 — 고정 대기 없음
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await shot(page, `e2e-shots/P1-eligible-${vp.tag}.png`)
    })

    test(`P5 판정(선정순위 + 지금 바로 되는 것) @${vp.tag}`, async ({ page }) => {
      await openDemo(page)
      await startPersona(page, 'P5')
      await expect(page.getByTestId('now-available-block')).toBeVisible()
      await expect(page.getByTestId('panel-tab-map')).toBeVisible()
      await waitForMapIdle(page)
      if (vp.tag === '390') await assertNoHorizontalScroll(page)
      await shot(page, `e2e-shots/P5-priority-${vp.tag}.png`)
    })
  })
}
