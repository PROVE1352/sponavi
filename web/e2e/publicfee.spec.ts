import { test, expect } from '@playwright/test'
import { assertNoHorizontalScroll, fillMainSlots, openMain, settleTypewriter, stream } from './helpers'

// 공공체육시설 조례 감면(목 모드, VITE_MOCK=1) — 2026-09-23.
//   성북·송파·노원(목 fixtures 는 서울뿐)은 체육시설 조례 감면 원문 확인 지역 →
//   public_program 이 '공식 확인(조례 …)'으로 올라와 히어로 N 에 들어가고, 이 사람에게 맞는 감면만
//   한 줄로("성북구 구립 체육시설 · 청소년 20% · 3자녀 이상 50%") + 행별 주의 + 조례 조문 링크.
//   조례 미확인 지역은 그대로 "확인 중" 줄.

test('16세 그외 3자녀 성북 → 히어로 공공시설 행: 청소년 20% · 3자녀 이상 50% + 조례 제10조 + 주의', async ({
  page,
}) => {
  await openMain(page)
  await fillMainSlots(page, { age: 16, regionCd: '11290', income: '그외', special: ['multichild'] })
  await settleTypewriter(page)

  const hero = stream(page).getByTestId('alt-routes-block')
  await expect(hero).toBeVisible()
  // 공공시설(조례 확인) + 튼튼머니 = 공식 확인 2. 16세는 문화비 소득공제(19+) 대상이 아니다.
  await expect(hero).toContainText('이용권은 대상이 아니지만, 지금 바로 되는 것 2가지')
  await expect(hero.getByTestId('alt-route-item')).toHaveCount(2)
  await expect(hero.getByTestId('alt-route-pending')).toHaveCount(0)

  const fee = hero.getByTestId('public-fee')
  await expect(fee.getByTestId('public-fee-summary')).toHaveText(
    '성북구 구립 체육시설 · 청소년 20% · 3자녀 이상 50%',
  )
  // 행별 주의: 청소년 나이 정의 없음 · 서울 다둥이카드 기준 미검증
  const caveats = fee.getByTestId('public-fee-caveat')
  await expect(caveats).toHaveCount(2)
  await expect(caveats.first()).toContainText('나이 기준이 조례에 없음')
  await expect(caveats.nth(1)).toContainText('다둥이행복카드')
  // 출처: 조례 조문 링크 + 시행일 + 원문 확인일
  const law = fee.getByTestId('public-fee-law-link')
  await expect(law).toHaveText('조례 제10조')
  await expect(law).toHaveAttribute('href', 'https://www.law.go.kr/ordinInfoP.do?ordinSeq=2168525')
  await expect(fee).toContainText('시행 2026-09-17')
  await expect(fee).toContainText('원문 확인 2026-09-23')
  // 정직한 공백 줄은 해당 사항이 있을 때만
  await expect(fee.getByTestId('public-fee-gap')).toHaveCount(0)

  // 원문 인용·지역 주의는 접어 두되 감추지 않는다
  await fee.locator('summary').click()
  await expect(fee).toContainText('100분의 20')
  await expect(fee.getByTestId('public-fee-region-caveat').first()).toBeVisible()

  await assertNoHorizontalScroll(page)
  await fee.locator('summary').click() // 스크린샷은 접힌 기본 상태로
  // 고정 헤더가 히어로 헤딩을 덮지 않도록(helpers.shot 과 같은 처리) 뒤 요소 캡처
  await page.addStyleTag({ content: '[class*="sticky"]{position:static !important}' })
  await hero.scrollIntoViewIfNeeded()
  await hero.screenshot({ path: 'e2e-shots/publicfee-hero-390.png', animations: 'disabled' })
})

test('25세 차상위 노원 → 차상위 전용 감면 없음(조례 확인) 공백 줄', async ({ page }) => {
  await openMain(page)
  await fillMainSlots(page, { age: 25, regionCd: '11350', income: '차상위' })
  await settleTypewriter(page)

  const fee = stream(page).getByTestId('public-fee')
  await expect(fee.getByTestId('public-fee-summary')).toHaveText(
    '노원구 구립 체육시설 · 해당 감면 없음 · 일반 요금',
  )
  await expect(fee.getByTestId('public-fee-gap')).toHaveText('※ 차상위 전용 감면 없음(조례 확인)')
  await expect(fee.getByTestId('public-fee-law-link')).toHaveText('조례 제7조')
  await assertNoHorizontalScroll(page)
})

test('조례 미확인 지역(강남구) → 공공시설은 N 에 넣지 않고 "확인 중 1건"', async ({ page }) => {
  await openMain(page)
  await fillMainSlots(page, { age: 27, regionCd: '11680', income: '그외' })
  await settleTypewriter(page)

  const hero = stream(page).getByTestId('alt-routes-block')
  await expect(hero).toContainText('지금 바로 되는 것 2가지')
  await expect(hero.getByTestId('alt-route-pending')).toContainText('확인 중 1건')
  await expect(hero.getByTestId('public-fee')).toHaveCount(0)
})
