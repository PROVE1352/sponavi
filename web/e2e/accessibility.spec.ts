import { test, expect } from '@playwright/test'

// FR-10 접근성(dvoucher 웹 보조 소스) — 목 모드(VITE_MOCK=1).
// P3(지체장애) 클릭 → 장애인 가맹시설(D01)에 접근성 태그 렌더 +
// 편의시설 필터 칩 1개 적용 시 리스트 감소(AC4). 서버 없이 동작.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '스포내비', level: 1 })).toBeVisible()
  await expect(page.getByTestId('persona-P3')).toBeVisible()
})

test('P3 → 접근성 태그 + 편의시설 필터 칩 적용 시 리스트 감소 (FR-10)', async ({ page }) => {
  await page.getByTestId('persona-P3').click()
  await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()

  // 편의시설 필터가 장애 결과에서 노출된다
  await expect(page.getByTestId('accessibility-filter')).toBeVisible()

  // 장애인 가맹시설(D01) 1곳 + 접근성 태그(지원유형 + 편의시설)
  const rows = page.getByTestId('dvoucher-facility')
  await expect(rows).toHaveCount(1)
  const tags = page.getByTestId('access-tags').first()
  await expect(tags).toBeVisible()
  await expect(tags).toContainText('지체') // 장애지원유형(AC2)
  await expect(tags).toContainText('장애인 화장실') // 보유 편의시설 태그(AC2)

  // 블록 하단 고정 출처(AC3)
  await expect(page.getByTestId('accessibility-source')).toContainText('확인일 2026-07-21')

  // 필터 칩 적용: D01 이 갖지 않은 '휠체어 대여(06)' → 리스트 1 → 0 (감소, AC4)
  const chip = page.getByTestId('amenity-chip-06')
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page.getByTestId('dvoucher-facility')).toHaveCount(0)
  await expect(page.getByTestId('amenity-empty')).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/P3-accessibility-filter.png', fullPage: true })

  // 칩 해제 시 복귀(감소가 필터 때문임을 확증)
  await chip.click()
  await expect(page.getByTestId('dvoucher-facility')).toHaveCount(1)
})

test('P3 → 보유 편의시설 칩(장애인 화장실)은 리스트를 유지한다', async ({ page }) => {
  await page.getByTestId('persona-P3').click()
  await expect(page.getByTestId('dvoucher-facility')).toHaveCount(1)
  // D01 이 보유한 편의시설(01) 칩 → 여전히 1곳(양성 필터)
  await page.getByTestId('amenity-chip-01').click()
  await expect(page.getByTestId('dvoucher-facility')).toHaveCount(1)
  await expect(page.getByTestId('amenity-empty')).toHaveCount(0)
})
