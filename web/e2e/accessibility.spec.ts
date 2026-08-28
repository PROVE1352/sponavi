import { test, expect } from '@playwright/test'
import { openDemo, openPanel, panel, shot, startPersona, stream } from './helpers'

// FR-10 접근성(dvoucher 웹 보조 소스) — 목 모드(VITE_MOCK=1).
// P3(지체장애) 퀵스타트 칩 → 스트림 시설 카드에 접근성 태그 + 패널 목록 탭의
// 편의시설 칩 필터 1개 적용 시 리스트 감소(AC4). 서버 없이 동작.
//
// ※ 시설 행은 스트림 요약 카드와 패널 목록 두 곳에 렌더된다 — 필터는 패널 목록의 상태이므로
//    카운트 검사는 항상 패널로 스코프한다.

test.beforeEach(async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P3')
})

test('P3 → 접근성 태그 + 편의시설 필터 칩 적용 시 리스트 감소 (FR-10)', async ({ page }) => {
  // 스트림 단독으로도 접근성 태그가 보인다(FR-12 AC3)
  const streamTags = stream(page).getByTestId('access-tags').first()
  await expect(streamTags).toBeVisible()
  await expect(streamTags).toContainText('지체') // 장애지원유형(AC2)
  await expect(streamTags).toContainText('장애인 화장실') // 보유 편의시설 태그(AC2)

  // 후속 칩으로 패널 목록 탭 열기
  await openPanel(page, 'list')

  // 편의시설 필터가 장애 결과에서 노출된다
  await expect(panel(page).getByTestId('accessibility-filter')).toBeVisible()

  // 장애인 가맹시설(D01) 1곳
  const rows = panel(page).getByTestId('dvoucher-facility')
  await expect(rows).toHaveCount(1)

  // 블록 하단 고정 출처(AC3)
  await expect(panel(page).getByTestId('accessibility-source')).toContainText('확인일 2026-07-21')

  // 필터 칩 적용: D01 이 갖지 않은 '휠체어 대여(06)' → 리스트 1 → 0 (감소, AC4)
  const chip = panel(page).getByTestId('amenity-chip-06')
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(panel(page).getByTestId('dvoucher-facility')).toHaveCount(0)
  await expect(panel(page).getByTestId('amenity-empty')).toBeVisible()

  await shot(page, 'e2e-shots/P3-accessibility-filter.png')

  // 칩 해제 시 복귀(감소가 필터 때문임을 확증)
  await chip.click()
  await expect(panel(page).getByTestId('dvoucher-facility')).toHaveCount(1)
})

// C-3(P-1): 한 카드가 "✓ 장애인 지원"(확언)과 "접근성 정보 없음"을 동시에 말하면 안 된다.
// 확언은 지원유형이 확인된 카드에만, 유형을 모르면 "장애인 지원(유형 미상)"이라고 적는다.
test('시설 카드는 "✓ 장애인 지원"과 "접근성 정보 없음"을 동시에 말하지 않는다 (C-3 · P-1)', async ({
  page,
}) => {
  await openPanel(page, 'list')
  const cards = panel(page).locator('li') // 가맹·대안 시설 행 전부

  // ① 지원유형이 확인된 가맹시설(D01)만 확언 배지를 단다 — 유형이 카드 안에 함께 보인다.
  const dvoucher = panel(page).getByTestId('dvoucher-facility').first()
  await expect(dvoucher.getByTestId('support-confirmed')).toHaveText('장애인 지원')
  await expect(dvoucher.getByTestId('access-tags')).toContainText('지체')
  await expect(dvoucher.getByTestId('access-none')).toHaveCount(0)

  // ② 지원유형 소스가 없는 공공·대안 카드는 확언 대신 "유형 미상"으로 적는다.
  const publicCard = panel(page)
    .locator('li')
    .filter({ hasText: '성북구민체육센터' })
    .first()
  await expect(publicCard.getByTestId('support-unknown-types')).toHaveText('장애인 지원(유형 미상)')
  await expect(publicCard.getByTestId('support-confirmed')).toHaveCount(0)

  // ③ 불변식: 확언 배지를 단 카드에는 "접근성 정보 없음"이 존재하지 않는다.
  const contradictions = await cards.evaluateAll((nodes) =>
    nodes.filter(
      (n) =>
        n.querySelector('[data-testid="support-confirmed"]') != null &&
        (n.textContent ?? '').includes('접근성 정보 없음'),
    ).length,
  )
  expect(contradictions, '확언 배지 + "접근성 정보 없음" 동시 표기').toBe(0)
})

test('P3 → 보유 편의시설 칩(장애인 화장실)은 리스트를 유지한다', async ({ page }) => {
  await openPanel(page, 'list')
  await expect(panel(page).getByTestId('dvoucher-facility')).toHaveCount(1)
  // D01 이 보유한 편의시설(01) 칩 → 여전히 1곳(양성 필터)
  await panel(page).getByTestId('amenity-chip-01').click()
  await expect(panel(page).getByTestId('dvoucher-facility')).toHaveCount(1)
  await expect(panel(page).getByTestId('amenity-empty')).toHaveCount(0)
})
