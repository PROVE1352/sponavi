import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Result } from 'axe-core'

// 릴리스 게이트 5 — 접근성: axe-core "critical" 위반 0.
// (serious 대비 위반 등은 게이트 대상이 아니며 참고용으로 함께 출력한다.)
// 목 모드(VITE_MOCK=1)라 서버 없이 랜딩·결과 화면을 검사한다.

async function violations(page: Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return results.violations
}

function summarize(vios: Result[]): string {
  if (vios.length === 0) return '위반 없음'
  return vios
    .map((v) => `[${v.impact}] ${v.id} (노드 ${v.nodes.length}) — ${v.help}`)
    .join('\n')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '스포내비', level: 1 })).toBeVisible()
})

test('랜딩(히어로+페르소나+위저드) axe critical 0', async ({ page }) => {
  const vios = await violations(page)
  const critical = vios.filter((v) => v.impact === 'critical')
  expect(critical, `axe 위반:\n${summarize(vios)}`).toHaveLength(0)
})

test('결과 화면(P5: 자격·선정순위·지도·접근성 필터) axe critical 0', async ({ page }) => {
  await page.getByTestId('persona-P5').click()
  await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
  await expect(page.getByTestId('accessibility-filter')).toBeVisible()

  const vios = await violations(page)
  const critical = vios.filter((v) => v.impact === 'critical')
  expect(critical, `axe 위반:\n${summarize(vios)}`).toHaveLength(0)
})

test('체력 처방 폼(연령군 동적 폼·PAR-Q 통과 후) axe critical 0', async ({ page }) => {
  await page.getByTestId('persona-P2').click()
  await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
  // 체력 섹션 펼치고 PAR-Q 통과 → 폼(대체항목 select/input 포함)까지 렌더
  await page.getByTestId('fitness-section').getByRole('button').first().click()
  await page.getByTestId('parq-check').check()
  await page.getByTestId('parq-continue').click()
  await expect(page.getByTestId('fitness-form')).toBeVisible()

  const vios = await violations(page)
  const critical = vios.filter((v) => v.impact === 'critical')
  expect(critical, `axe 위반:\n${summarize(vios)}`).toHaveLength(0)
})
