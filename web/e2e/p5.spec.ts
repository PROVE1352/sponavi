import { test, expect, type Page } from '@playwright/test'

// FR-P5 (목 모드, VITE_MOCK=1): P5 원클릭 →
//   장애인 이용권 자격 ✓(신청은 소득 무관) + 예상 5순위(성인·비저소득) +
//   '지금 바로 되는 것' 블록에 공식 확인 대안 3개.

async function clickPersona(page: Page, id: string) {
  await page.getByTestId(`persona-${id}`).click()
  await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '스포내비', level: 1 })).toBeVisible()
  // 데모 바에 P5 버튼이 렌더된다(FR-06: P1~P5)
  await expect(page.getByTestId('persona-P5')).toBeVisible()
})

test('P5 · 지체장애 비저소득 성인 → 자격 ✓(소득무관) + 예상 5순위 + 지금 바로 되는 것 3개', async ({ page }) => {
  await clickPersona(page, 'P5')

  const dcard = page.getByRole('article', { name: '장애인스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(dcard).toBeVisible()

  // 자격은 충족(예상 자격) — 신청은 소득과 관계없이
  await expect(dcard.getByText('예상 자격', { exact: true })).toBeVisible()
  await expect(dcard.getByText(/신청은 소득과 관계없이/)).toBeVisible()

  // 선정은 우선순위제 — 예상 5순위(성인·비저소득)
  await expect(dcard.getByText(/예상 5순위/)).toBeVisible()
  await expect(dcard.getByTestId('selection-block')).toContainText('우선순위제')

  // '지금 바로 되는 것' 고정 블록: 항목 3개 렌더
  const block = page.getByTestId('now-available-block')
  await expect(block).toBeVisible()
  await expect(block.getByText('지금 바로 되는 것')).toBeVisible()
  await expect(page.getByTestId('now-available-item')).toHaveCount(3)

  await page.screenshot({ path: 'e2e-shots/P5-selection-priority.png', fullPage: true })
})

test('P2 · 낀 계층 → 대체경로 카드 블록에 대안 상위 3개 확장', async ({ page }) => {
  await clickPersona(page, 'P2')

  // 비장애 income_fail: svoucher 카드의 대체경로 블록에 alt_edges 상위 3개
  const block = page.getByTestId('alt-routes-block')
  await expect(block).toBeVisible()
  await expect(page.getByTestId('alt-route-item')).toHaveCount(3)
})
