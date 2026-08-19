import { test, expect } from '@playwright/test'
import { openDemo, openPanel, panel, shot, startPersona, stream } from './helpers'

// 페르소나 퀵스타트 칩(FR-12 AC5) → 채팅 스트림 카드 검증 + 심사용 스크린샷.
// 목 모드(VITE_MOCK=1)라 서버·LLM 없이 동작한다(칩 경로는 챗 엔드포인트를 호출하지 않는다).

test.beforeEach(async ({ page }) => {
  await openDemo(page)
})

test('P1 · 10세 여아 기초수급 → 스포츠강좌이용권 예상 자격 ✓ 카드', async ({ page }) => {
  await startPersona(page, 'P1')

  const card = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByText('예상 자격', { exact: true })).toBeVisible()
  // 신청 방법 + 근처 가맹시설·자부담(스트림 단독 완결, FR-12 AC3)
  // v1.7: 시설 카드는 결과 덱의 슬라이드라 요약 헤더와 형제다 — 스트림 범위로 찾는다
  await expect(card.getByText('신청 방법')).toBeVisible()
  await expect(page.getByTestId('facility-summary')).toBeVisible()
  await expect(stream(page).getByText('성북스포츠클럽').first()).toBeVisible()
  await expect(stream(page).getByText('내 부담').first()).toBeVisible()
  // 이용권 공급은 구 단위 카운트로 표기(FR-04 AC2)
  await expect(stream(page).getByTestId('voucher-supply-block')).toContainText('성북구 가맹 4곳')

  await shot(page, 'e2e-shots/P1-svoucher-eligible.png')
})

test('P2 · 27세 낀 계층 → 대체경로 스텝 다이어그램(전문가 큐레이션) + 대체경로 블록', async ({ page }) => {
  await startPersona(page, 'P2')

  // svoucher 는 해당 없음
  const sv = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(sv.getByText('해당 없음', { exact: true })).toBeVisible()

  // 경로 카드(스트림 임베드)에 대체경로 엣지 + 전문가 큐레이션 뱃지
  const path = stream(page).getByRole('region', { name: '추천 경로 시각화' })
  await expect(path).toBeVisible()
  await expect(path.getByText('대체경로')).toBeVisible()
  await expect(path.getByText(/전문가 큐레이션/)).toBeVisible()
  await expect(path.getByText('공공 프로그램')).toBeVisible()

  // 복수 대체경로 블록(FR-02 AC5) — 상위 3개
  await expect(stream(page).getByTestId('alt-routes-block')).toBeVisible()
  await expect(stream(page).getByTestId('alt-route-item')).toHaveCount(3)

  await shot(page, 'e2e-shots/P2-alt-path.png')
})

test('P3 · 14세 지체장애 → 장애인스포츠강좌이용권 예상 자격 ✓ + 미검증 경고', async ({ page }) => {
  await startPersona(page, 'P3')

  const dcard = stream(page).getByRole('article', {
    name: '장애인스포츠강좌이용권 예상 자격 결과',
    exact: true,
  })
  await expect(dcard).toBeVisible()
  await expect(dcard.getByText('예상 자격', { exact: true })).toBeVisible()
  await expect(dcard.getByText('공식 확인 필요 (자격 기준 미검증)')).toBeVisible()

  await shot(page, 'e2e-shots/P3-dvoucher-eligible.png')
})

test('P4 · 72세 청각장애 → 공급공백 배너 + 커버리지 수급률', async ({ page }) => {
  await startPersona(page, 'P4')

  const alert = stream(page).getByRole('alert').filter({ hasText: '가맹시설이 없습니다' })
  await expect(alert).toBeVisible()
  await expect(stream(page).getByText(/가장 가까운 곳은/)).toBeVisible()
  // 정직-신호: 커버리지 수급률 한 줄
  await expect(stream(page).getByText(/수급률은/)).toBeVisible()
  // 연령 초과 → 어르신 특화 대체경로 3개
  await expect(stream(page).getByTestId('alt-route-item')).toHaveCount(3)

  await shot(page, 'e2e-shots/P4-supply-gap.png')
})

test('좌표 정직성: "위치 근사(구 중심)" 배지 + 이용권 블록 "반경" 미표기 (FR-04)', async ({ page }) => {
  // P3: 성북 dvoucher 가맹 0 → 공급공백 + 최근접(강북 D01) 근사좌표 시설 노출
  await startPersona(page, 'P3')

  // FR-04 AC1: 구 중심 폴백 좌표 시설엔 "위치 근사(구 중심)" 배지가 1개 이상 렌더된다
  const approx = stream(page).getByText('위치 근사(구 중심)')
  await expect(approx.first()).toBeVisible()
  expect(await approx.count()).toBeGreaterThanOrEqual(1)

  // FR-04 AC2: 이용권 공급공백 블록은 구 단위 집계라 "반경" 문구가 없어야 한다
  const voucherGap = stream(page).getByTestId('voucher-gap-block')
  await expect(voucherGap).toBeVisible()
  await expect(voucherGap).not.toContainText('반경')

  // 근사좌표 이용권 시설엔 거리(km)도 함께 표기하지 않는다(카피 사전) — 패널 목록에서도 동일.
  await openPanel(page, 'list')
  const voucherSection = panel(page).getByTestId('voucher-section')
  await expect(voucherSection).toBeVisible()
  await expect(voucherSection).not.toContainText('km')
})
