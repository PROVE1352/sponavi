import { test, expect, type Page } from '@playwright/test'

// 체력 처방 전면 재구축(목 모드, VITE_MOCK=1):
//   페르소나 결과 → 체력 섹션 열기 → PAR-Q 게이트 통과 → 연령군 동적 폼 →
//   판정 칩+비교문+출처 배지+영상 카드 → AI 처방 버튼 → "기본 규칙 처방" 라벨.

async function openResultFor(page: Page, id: string) {
  await page.getByTestId(`persona-${id}`).click()
  await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
}

async function openFitness(page: Page) {
  await page.getByTestId('fitness-section').getByRole('button').first().click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '스포내비', level: 1 })).toBeVisible()
  await expect(page.getByTestId('persona-P2')).toBeVisible()
})

test('P2 성인 → PAR-Q → 동적 폼 → 판정 칩·비교문·출처 배지·영상 카드 → 기본 규칙 처방', async ({ page }) => {
  await openResultFor(page, 'P2') // 27세 성인
  await openFitness(page)

  // PAR-Q 게이트: 폼 앞단 고지 + 체크 후 계속
  const parq = page.getByTestId('parq-gate')
  await expect(parq).toBeVisible()
  await expect(parq).toContainText('160/100mmHg')
  await page.getByTestId('parq-check').check()
  await page.getByTestId('parq-continue').click()

  // 연령군(성인) 동적 폼 — 성인 전용 항목이 렌더된다
  const form = page.getByTestId('fitness-form')
  await expect(form).toBeVisible()
  await expect(form).toContainText('교차윗몸 일으키기')

  // 값 입력(둘 다 기준 미달 유도) → 판정
  await page.getByTestId('fit-input-crunch_cross').fill('5')
  await page.getByTestId('fit-input-sit_reach').fill('-3')
  await page.getByTestId('fitness-submit').click()

  const result = page.getByTestId('fitness-result')
  await expect(result).toBeVisible()

  // ① band 칩 + 비교문(실측 컷 인용)
  await expect(page.getByTestId('item-band').first()).toBeVisible()
  await expect(result.getByText('기준 미달').first()).toBeVisible()
  await expect(result).toContainText('3등급 컷')

  // ② 참고등급(추정) + 인증센터 안내
  await expect(result.getByText('참고 등급(추정)')).toBeVisible()
  await expect(result).toContainText('체력인증센터(무료)')

  // ③ 출처 배지 + 영상 카드
  await expect(page.getByTestId('source-badge').first()).toBeVisible()
  await expect(result.getByText('공단 공식 기준').first()).toBeVisible()
  await expect(result.getByText('전문가 큐레이션(검증 중)').first()).toBeVisible()
  await expect(page.getByTestId('video-card').first()).toBeVisible()

  // ④ 근처 강좌 연동 버튼(카운트 표기)
  await expect(page.getByTestId('facility-filter-apply')).toBeVisible()

  // ⑤ AI 처방 → provider=rules → "기본 규칙 처방"
  await page.getByTestId('ai-prescribe-btn').click()
  await expect(page.getByTestId('ai-result')).toBeVisible()
  await expect(page.getByTestId('ai-provider-label')).toHaveText('기본 규칙 처방')
  await expect(page.getByTestId('ai-rx').first()).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/F1-fitness-prescription.png', fullPage: true })
})

test('P1 만10세 → 체력 섹션에 만7~10 공백 고지 배너', async ({ page }) => {
  await openResultFor(page, 'P1') // 10세 → age_gap
  await openFitness(page)

  const banner = page.getByTestId('fitness-gap-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('공식 기준이 없')
  await expect(banner).toContainText('유소년')
})
