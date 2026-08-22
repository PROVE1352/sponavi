import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Result } from 'axe-core'
import { expectMapMounted, openDemo, openMain, openPanel, startFitnessThroughParq, startPersona } from './helpers'

// 릴리스 게이트 3·9 — 접근성: axe-core "critical" 위반 0 (채팅 스트림 포함).
// (serious 이하 위반은 게이트 대상이 아니며 참고용으로 함께 출력한다.)
// 목 모드(VITE_MOCK=1)라 서버 없이 랜딩·판정·체력 폼 3면을 검사한다.
// v1.4: 랜딩면은 실사용 메인(/), 판정·체력면은 데모 페이지(/#/demo) 경유.

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

async function expectNoCritical(page: Page) {
  const vios = await violations(page)
  const critical = vios.filter((v) => v.impact === 'critical')
  expect(critical, `axe 위반:\n${summarize(vios)}`).toHaveLength(0)
}

test('메인 랜딩 챗(인사 1버블 + 첫 질문 칩 + 컴포저) axe critical 0', async ({ page }) => {
  await openMain(page)
  // 스트림은 라이브 리전으로 낭독된다(FR-12 AC8)
  const log = page.getByRole('log')
  await expect(log).toBeVisible()
  await expect(log).toHaveAttribute('aria-live', 'polite')

  await expectNoCritical(page)
})

test('판정 스트림 + 컨텍스트 패널(P5: 자격·선정순위·지도·접근성 필터) axe critical 0', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P5')
  await openPanel(page, 'map')
  // 지도(단일 MapLibre 인스턴스)가 실제로 붙은 뒤 검사한다.
  // 캔버스 자체는 axe 대상이 아니다 — 검사 대상은 그 주변(마커 aria·저작자표시·범례).
  await expectMapMounted(page)
  await expect(page.getByTestId('selection-block')).toBeVisible()

  await expectNoCritical(page)

  // 목록 탭(편의시설 칩 필터 · 시설 행)도 같은 게이트
  await page.getByTestId('panel-tab-list').click()
  await expect(page.getByTestId('context-panel').getByTestId('accessibility-filter')).toBeVisible()
  await expectNoCritical(page)
})

test('체력 폼 턴(PAR-Q 통과 후 연령군 동적 폼) axe critical 0', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2')
  await startFitnessThroughParq(page)
  await expect(page.getByTestId('fitness-form')).toBeVisible()

  await expectNoCritical(page)
})

test('체력 판정 결과 + AI 처방 "왜 이 운동?" 펼침(FR-08 AC8) axe critical 0', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2')
  await startFitnessThroughParq(page)
  await page.getByTestId('fit-input-reaction_time').fill('0.9')
  await page.getByTestId('fit-input-air_time').fill('0.1')
  await page.getByTestId('fit-input-bmi').fill('31')
  await page.getByTestId('fit-input-sit_reach').fill('-3')
  await page.getByTestId('fitness-submit').click()
  await expect(page.getByTestId('fitness-result')).toBeVisible()

  await page.getByTestId('ai-prescribe-btn').click()
  await expect(page.getByTestId('ai-result')).toBeVisible()

  // 접힌 상태 · 펼친 상태 둘 다 같은 게이트를 통과해야 한다
  await expectNoCritical(page)
  const toggles = page.getByTestId('rx-why-toggle')
  const n = await toggles.count()
  for (let i = 0; i < n; i += 1) await toggles.nth(i).click()
  await expect(page.getByTestId('rx-why-panel').first()).toBeVisible()
  await expectNoCritical(page)
})
