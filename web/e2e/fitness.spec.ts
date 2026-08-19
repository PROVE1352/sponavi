import { test, expect } from '@playwright/test'
import {
  assertNoHorizontalScroll,
  openDemo,
  shot,
  startFitnessThroughParq,
  startPersona,
  stream,
} from './helpers'

// 체력 레인 3턴(목 모드, VITE_MOCK=1):
//   판정 결과 → "체력 처방 시작" 칩 → PAR-Q 게이트(통과 전 폼 미노출) → 연령군 동적 폼 →
//   판정 칩+비교문+참고등급(추정)+출처 배지+영상 카드 → AI 처방(rules) "기본 규칙 처방" →
//   "이 운동 되는 근처 강좌" 적용 시 패널 목록 탭 전환.

test.beforeEach(async ({ page }) => {
  await openDemo(page)
})

test('P2 성인 → PAR-Q → 동적 폼 → 판정 칩·비교문·출처 배지·영상 카드 → 기본 규칙 처방', async ({ page }) => {
  await startPersona(page, 'P2') // 27세 성인
  await startFitnessThroughParq(page)

  // 연령군(성인) 동적 폼 — 성인 전용 항목이 렌더된다
  const form = page.getByTestId('fitness-form')
  await expect(form).toBeVisible()
  await expect(form).toContainText('교차윗몸 일으키기')
  // 대체항목(alt_group) 택1은 한 슬롯(셀렉트 + 입력)
  await expect(page.getByTestId('fit-alt-심폐_왕복스텝')).toBeVisible()

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

  // 레인 종료 후에는 후속 칩이 '체력 처방 시작' 없이 다시 제시된다(-fit 묶음)
  await expect(page.getByTestId('chip-act-restart-fit')).toBeVisible()
  await expect(page.getByTestId('chip-act-fitness-fit')).toHaveCount(0)

  await shot(page, 'e2e-shots/F1-fitness-prescription.png')
})

test('처방 → "이 운동 되는 근처 강좌" 적용 시 종목 필터 + 패널 목록 탭 전환 (FR-09 AC1)', async ({ page }) => {
  await startPersona(page, 'P2')
  await startFitnessThroughParq(page)

  await page.getByTestId('fit-input-sit_reach').fill('-3')
  await page.getByTestId('fitness-submit').click()
  await expect(page.getByTestId('fitness-result')).toBeVisible()

  const apply = page.getByTestId('facility-filter-apply')
  await expect(apply).toContainText('요가')
  await apply.click()

  // 목록 탭으로 전환 + 필터 배지 + 나비 한 줄 안내
  const tab = page.getByTestId('panel-tab-list')
  await expect(tab).toBeVisible()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('context-panel').getByText(/운동 필터:/)).toBeVisible()
  await expect(stream(page).getByText(/고르신 종목만 남겨서/)).toBeVisible()
})

test('390px 측정 폼 — 입력 폭·글자 크기·터치 타겟이 모바일에서 깨지지 않는다 (v1.7)', async ({
  page,
}) => {
  await startPersona(page, 'P2')
  await startFitnessThroughParq(page)
  const form = page.getByTestId('fitness-form')
  await expect(form).toBeVisible()

  // 폼 전 항목 실측: 입력/셀렉트 한 칸이 카드 폭을 온전히 쓰고, 글자·터치 타겟이 규격 이상
  const fields = await form.evaluate((root) =>
    [...root.querySelectorAll('input, select')].map((el) => {
      const cs = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const parent = (el.parentElement as HTMLElement).getBoundingClientRect()
      return {
        tag: el.tagName,
        testId: el.getAttribute('data-testid'),
        fontPx: Number.parseFloat(cs.fontSize),
        height: box.height,
        width: box.width,
        parentWidth: parent.width,
        labelled:
          el.hasAttribute('aria-label') ||
          (el.id !== '' && document.querySelector(`label[for="${el.id}"]`) != null) ||
          el.closest('label') != null,
      }
    }),
  )
  expect(fields.length).toBeGreaterThan(0)
  for (const f of fields) {
    // ① 16px 미만이면 모바일 사파리가 포커스 시 페이지를 확대해 폼이 화면 밖으로 밀린다
    expect(f.fontPx, `${f.tag} ${f.testId} 글자 ${f.fontPx}px`).toBeGreaterThanOrEqual(16)
    // ② 터치 타겟 44px
    expect(f.height, `${f.tag} ${f.testId} 높이 ${f.height}px`).toBeGreaterThanOrEqual(44)
    // ③ 한 칸이 부모 폭을 그대로 쓴다(택1 슬롯의 셀렉트+입력이 서로 밀리지 않는다)
    expect(f.width, `${f.tag} ${f.testId} 폭 ${f.width} / 부모 ${f.parentWidth}`).toBeGreaterThan(
      f.parentWidth - 2,
    )
    // ④ 이름표가 붙어 있다(스크린리더·터치 라벨)
    expect(f.labelled, `${f.tag} ${f.testId} 라벨 없음`).toBe(true)
  }

  // 제출 버튼도 같은 규격 + 폼 때문에 페이지가 옆으로 넘치지 않는다
  const submit = await page.getByTestId('fitness-submit').boundingBox()
  expect(submit!.height).toBeGreaterThanOrEqual(44)
  expect(submit!.width).toBeGreaterThan(280)
  await assertNoHorizontalScroll(page)
})

test('P1 만10세 → 측정 폼에 만7~10 공백 고지 배너 (FR-07 AC6)', async ({ page }) => {
  await startPersona(page, 'P1') // 10세 → age_gap
  await startFitnessThroughParq(page)

  const banner = page.getByTestId('fitness-gap-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('공식 기준이 없')
  await expect(banner).toContainText('유소년')
})
