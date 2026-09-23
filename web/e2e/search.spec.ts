import { test, expect } from '@playwright/test'
import { openDemo, openPanel, panel, startPersona } from './helpers'

// 동·도로명·시설명 검색(2026-09-23 팀원 요청: "대구 북구를 고르면 칠곡 쪽만 뜨고, 지도를 옮겨도
// 검색도 선택도 안 된다"). 이용권 가맹시설은 대부분 구 중심 근사 좌표라 지도 이동으로는 못 찾는다 —
// 그 구 안에서 이름·주소 키워드로 찾는다. 계약 —
//   ① 제출(버튼/Enter)해야 검색된다 · 결과 수는 aria-live 로 "N곳 찾음"
//   ② 결과가 아래 목록을 대신한다 · 이용권 행은 수강료만(자격 판정 없음) · 근사 행은 위치 근사 배지
//   ③ 실좌표 결과는 이름을 눌러 지도에서 확대된다
//   ④ 0건이면 도로명 주소 한계를 정직하게 안내 · "검색 지우기"로 원래 목록 복귀

test('검색 → 결과 → 지도 지목 → 지우기', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2') // 성북구 · 비장애 → svoucher
  await openPanel(page, 'list')

  const p = panel(page)
  const form = p.getByTestId('facility-search')
  await expect(form).toBeVisible()
  const input = form.getByLabel('동·도로명·시설명으로 찾기')
  await expect(input).toBeVisible()
  const status = p.getByTestId('facility-search-status')
  await expect(status).toHaveAttribute('aria-live', 'polite')

  // 원래 목록(검색 전)
  await expect(p.getByTestId('facility-search-results')).toHaveCount(0)
  const before = await p.getByTestId('alt-facility').count()

  // ① 타이핑만으로는 검색하지 않는다
  await input.fill('아리랑로')
  await expect(p.getByTestId('facility-search-results')).toHaveCount(0)
  // Enter = form submit
  await input.press('Enter')

  const results = p.getByTestId('facility-search-results')
  await expect(results).toBeVisible()
  await expect(status).toHaveText('"아리랑로" 2곳 찾음')
  // 390px 에서 가로 스크롤이 생기지 않는다
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `가로 넘침 ${overflow}px`).toBeLessThanOrEqual(0)
  if (process.env.SEARCH_SHOT) {
    await form.scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.SEARCH_SHOT })
  }

  // ② 이용권 행: 근사 배지 + 수강료만(지원·자부담 칸 없음)
  const v = results.getByTestId('voucher-facility')
  await expect(v).toHaveCount(1)
  await expect(v).toContainText('돈암수영아카데미')
  await expect(v).toContainText('위치 근사(구 중심)')
  await expect(v.getByTestId('fee-only')).toContainText('110,000원')
  await expect(v).not.toContainText('내 부담')
  await expect(v.getByTestId('facility-locate-unavailable')).toBeVisible()
  await expect(results.getByTestId('search-fee-note')).toBeVisible()

  // ③ 실좌표 공공 행 → 이름 버튼 → 지도 확대 + 강조 1개
  const alt = results.getByTestId('alt-facility')
  await expect(alt).toHaveCount(1)
  await expect(alt).toContainText('아리랑체육관')
  await alt.getByTestId('facility-locate').click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('marker-focused')).toHaveCount(1)
  await expect(page.getByTestId('marker-focused')).toHaveAttribute('aria-label', /아리랑체육관/)

  // ④ 0건 안내 (버튼 제출)
  await page.getByTestId('panel-tab-list').click()
  await input.fill('없는동이름')
  await form.getByTestId('facility-search-submit').click()
  await expect(status).toHaveText('"없는동이름" 0곳 찾음')
  await expect(p.getByTestId('facility-search-zero')).toHaveText(
    '도로명 주소에는 동 이름이 없을 수 있어요. 도로명(예: 구암로)이나 시설 이름으로도 찾아보세요.',
  )

  // 검색 지우기 → 원래 목록
  await form.getByTestId('facility-search-clear').click()
  await expect(p.getByTestId('facility-search-results')).toHaveCount(0)
  await expect(p.getByTestId('facility-search-zero')).toHaveCount(0)
  await expect(p.getByTestId('alt-facility')).toHaveCount(before)
  await expect(input).toHaveValue('')
})

test('빈 검색어는 제출되지 않는다(찾기 버튼 비활성)', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2')
  await openPanel(page, 'list')
  const form = panel(page).getByTestId('facility-search')
  await form.getByLabel('동·도로명·시설명으로 찾기').fill('   ')
  await expect(form.getByTestId('facility-search-submit')).toBeDisabled()
})
