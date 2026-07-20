import { test, expect, type Page } from '@playwright/test'

// 4페르소나 원클릭 → 각 기대 결과 렌더 확인 + 스크린샷 4장(web/e2e-shots/).
// 목 모드(VITE_MOCK=1)라 서버 없이 동작.

async function clickPersona(page: Page, id: string) {
  await page.getByTestId(`persona-${id}`).click()
  // 결과 렌더 대기: 경로 시각화 섹션이 나타난다.
  await expect(page.getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '스포내비', level: 1 })).toBeVisible()
  await expect(page.getByTestId('persona-P1')).toBeVisible()
})

test('P1 · 10세 여아 기초수급 → 스포츠강좌이용권 예상 자격 ✓ 카드', async ({ page }) => {
  await clickPersona(page, 'P1')

  const card = page.getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByText('예상 자격', { exact: true })).toBeVisible()
  // 신청 방법·근처 가맹시설·자부담 계산
  await expect(card.getByText('신청 방법')).toBeVisible()
  const list = page.getByRole('region', { name: '근처 자원 목록' })
  await expect(list.getByText('성북스포츠클럽').first()).toBeVisible()
  await expect(list.getByText('내 부담').first()).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/P1-svoucher-eligible.png', fullPage: true })
})

test('P2 · 27세 낀 계층 → 대체경로 스텝 다이어그램(전문가 큐레이션)', async ({ page }) => {
  await clickPersona(page, 'P2')

  // svoucher 는 해당 없음
  const sv = page.getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(sv.getByText('해당 없음', { exact: true })).toBeVisible()
  // 경로 시각화에 대체경로 + 전문가 큐레이션 뱃지
  const path = page.getByRole('region', { name: '추천 경로 시각화' })
  await expect(path.getByText('대체경로')).toBeVisible()
  await expect(path.getByText(/전문가 큐레이션/)).toBeVisible()
  await expect(path.getByText('공공 프로그램')).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/P2-alt-path.png', fullPage: true })
})

test('P3 · 14세 지체장애 → 장애인스포츠강좌이용권 예상 자격 ✓ 카드', async ({ page }) => {
  await clickPersona(page, 'P3')

  const dcard = page.getByRole('article', { name: '장애인스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(dcard).toBeVisible()
  await expect(dcard.getByText('예상 자격', { exact: true })).toBeVisible()
  await expect(dcard.getByText('공식 확인 필요 (자격 기준 미검증)')).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/P3-dvoucher-eligible.png', fullPage: true })
})

test('P4 · 72세 청각장애 → 공급공백 배너', async ({ page }) => {
  await clickPersona(page, 'P4')

  const alert = page.getByRole('alert').filter({ hasText: '가맹시설이 없습니다' })
  await expect(alert).toBeVisible()
  await expect(page.getByText(/가장 가까운 곳은/)).toBeVisible()
  // 정직-신호: 커버리지 수급률 한 줄
  await expect(page.getByText(/수급률은/)).toBeVisible()

  await page.screenshot({ path: 'e2e-shots/P4-supply-gap.png', fullPage: true })
})
