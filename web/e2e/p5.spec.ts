import { test, expect } from '@playwright/test'
import { openDemo, openPanel, panel, shot, startPersona, stream } from './helpers'

// FR-P5 (목 모드, VITE_MOCK=1): P5 퀵스타트 칩 1회 →
//   장애인 이용권 자격 ✓(신청은 소득 무관) + 예상 5순위(성인·비저소득) +
//   '지금 바로 되는 것' 블록에 **공식 확인 대안 3개**.
//   (실DB 계약 = 공공시설(성북 조례 감면 원문 확인, 2026-09-23 승격)·튼튼머니·문화비 소득공제 —
//    헤딩의 N 은 공식 확인만 센다. 조례 미확인 지역이면 공공시설은 다시 "확인 중"으로 빠진다)

test.beforeEach(async ({ page }) => {
  await openDemo(page)
})

test('P5 · 지체장애 비저소득 성인 → 자격 ✓(소득무관) + 예상 5순위 + 지금 바로 되는 것 3개', async ({ page }) => {
  await startPersona(page, 'P5')

  const dcard = stream(page).getByRole('article', {
    name: '장애인스포츠강좌이용권 예상 자격 결과',
    exact: true,
  })
  await expect(dcard).toBeVisible()

  // 자격은 충족(예상 자격) — 신청은 소득과 관계없이
  await expect(dcard.getByText('예상 자격', { exact: true })).toBeVisible()
  await expect(dcard.getByText(/신청은 소득과 관계없이/)).toBeVisible()

  // 선정은 우선순위제 — 예상 5순위(성인·비저소득)
  await expect(dcard.getByText(/예상 5순위/)).toBeVisible()
  await expect(dcard.getByTestId('selection-block')).toContainText('우선순위제')

  // '지금 바로 되는 것' 고정 블록(3심 명령 4) — v1.10 부터 판정 카드 밖 전폭 히어로다(6A).
  const block = stream(page).getByTestId('now-available-block')
  await expect(block).toBeVisible()
  await expect(block.getByText('지금 바로 되는 것')).toBeVisible()
  // 공식 확인 3건(공공시설 조례 감면 포함) — 검증 대기가 없으니 "확인 중" 줄도 없다(P-1)
  await expect(stream(page).getByTestId('now-available-item')).toHaveCount(3)
  await expect(block.getByTestId('alt-route-pending')).toHaveCount(0)
  // 공공시설 행: 이 사람에게 맞는 감면(등록 장애인 50%) + 조례 조문 링크
  await expect(block.getByTestId('public-fee-summary')).toHaveText('성북구 구립 체육시설 · 장애인 50%')
  await expect(block.getByTestId('public-fee-law-link')).toHaveText('조례 제10조')
  // 히어로 CTA 는 후속 칩과 같은 액션(체력 레인) — 새 진입로를 만들지 않는다
  await expect(block.getByTestId('hero-fitness-cta')).toBeVisible()

  await shot(page, 'e2e-shots/P5-selection-priority.png')
})

test('P2 · 낀 계층 → 히어로 "이용권은 대상이 아니지만 …3가지" (성북 조례 감면 승격)', async ({ page }) => {
  await startPersona(page, 'P2')

  // 비장애 income_fail: 히어로 헤딩의 N 은 공식 확인 엣지 수만 센다(FR-02 AC5 v1.10).
  // 성북구는 공공시설 조례 감면이 원문 확인돼 공식 확인 3(공공시설·튼튼머니·소득공제).
  const block = stream(page).getByTestId('alt-routes-block')
  await expect(block).toBeVisible()
  await expect(block).toContainText('이용권은 대상이 아니지만, 지금 바로 되는 것 3가지')
  await expect(stream(page).getByTestId('alt-route-item')).toHaveCount(3)
  // 검증 대기 엣지가 없으니 "확인 중" 줄도 없다
  await expect(stream(page).getByTestId('alt-route-pending')).toHaveCount(0)
  // '지금 바로 되는 것'(자격 ✓·저순위 전용)과 혼동되지 않는다
  await expect(stream(page).getByTestId('now-available-block')).toHaveCount(0)

  // ✗ 카드의 첫 줄에 실패 사유가 전부(27세 = 소득 + 연령, FR-02 AC1 v1.10)
  const sv = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  const line = sv.getByTestId('fail-reason-line')
  await expect(line).toContainText('소득')
  await expect(line).toContainText('연령')
})

test('P5 · 수강료 미등록 6곳 — 섹션 요약 1줄 + 행은 "미등록", "무료"·"−0원" 금지 (CQ1A·OV13)', async ({
  page,
}) => {
  await startPersona(page, 'P5')
  await openPanel(page, 'list')

  const section = panel(page).getByTestId('voucher-section')
  await expect(section).toBeVisible()
  // 결측을 행마다 반복하지 않고 섹션 상단에서 한 번에 밝힌다(FR-04 AC4 v1.10)
  await expect(section.getByTestId('voucher-fee-summary')).toContainText('총 6곳 · 수강료 미등록 6곳')
  // 행에는 3셀(수강료/지원/자부담) 대신 한 줄 안내만 — 없는 값을 0원·무료로 채우지 않는다(P-1)
  await expect(section.getByTestId('fee-unknown')).toHaveCount(6)
  await expect(section.getByTestId('fee-unknown').first()).toContainText('수강료 미등록 · 시설 문의')
  await expect(section).not.toContainText('무료')
  await expect(section).not.toContainText('−0원')
})

// C-3(P-1): 장애인 가맹 6곳 중 지원유형이 공개된 곳은 1곳뿐이다(D01). 나머지 5곳은
// 원천에 "지원함" 불리언만 있고 유형이 없다 — 예전엔 그 카드가 "✓ 장애인 지원"과
// "접근성 정보 없음"을 동시에 말했다. 확언은 유형이 있을 때만, 없으면 "유형 미상"으로.
test('P5 · 장애인 가맹 6곳 — 확언(✓)은 지원유형이 있는 카드만, 나머지는 "유형 미상" (C-3)', async ({
  page,
}) => {
  await startPersona(page, 'P5')
  await openPanel(page, 'list')

  const section = panel(page).getByTestId('voucher-section')
  const rows = section.getByTestId('dvoucher-facility')
  await expect(rows).toHaveCount(6)

  // ① 유형이 공개된 1곳만 확언 — 그 카드 안에 근거(지원유형)가 함께 보인다
  await expect(section.getByTestId('support-confirmed')).toHaveCount(1)
  const confirmed = rows.filter({ hasText: '서울장애인체육관' }).first()
  await expect(confirmed.getByTestId('access-tags')).toContainText('지체')

  // ② 유형을 모르는 5곳은 "없음"이 아니라 "유형 미상" — 지원 사실 자체는 지우지 않는다
  await expect(section.getByTestId('support-unknown-types')).toHaveCount(5)
  await expect(section.getByTestId('support-unknown-types').first()).toHaveText(
    '장애인 지원(유형 미상)',
  )

  // ③ 어느 카드도 "✓ 장애인 지원"과 "접근성 정보 없음"을 동시에 말하지 않는다
  await expect(section.getByTestId('access-none')).toHaveCount(0)
  const contradictions = await rows.evaluateAll((nodes) =>
    nodes.filter(
      (n) =>
        n.querySelector('[data-testid="support-confirmed"]') != null &&
        (n.textContent ?? '').includes('접근성 정보 없음'),
    ).length,
  )
  expect(contradictions, '확언 배지 + "접근성 정보 없음" 동시 표기').toBe(0)
})
