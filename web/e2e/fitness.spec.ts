import { test, expect, type Page } from '@playwright/test'
import {
  assertNoHorizontalScroll,
  fillMainSlots,
  openDemo,
  openMain,
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

// FR-08 AC8 — 처방 항목의 "왜 이 운동?" 펼침(그래프 근거 경로 + 출처 배지 + FITT 출처).
// 목모드 처방은 요인당 상위 2개라, 아래 4개 값이 4티어 배지·목적 경유·근거 없음을 모두 만든다:
//   반응시간(민첩성) = 정부·국제 지침 A + 전문가 큐레이션(검증 중) B
//   체공시간(순발력) = fitness_map 폴백(근거 없음)
//   BMI(신체조성)   = 정부·국제 지침 A
//   앉아윗몸(유연성) = 공단 공식 기준 S + 공단 콘텐츠 V(목적 경유)
async function submitFourWeaknesses(page: Page) {
  await page.getByTestId('fit-input-reaction_time').fill('0.9')
  await page.getByTestId('fit-input-air_time').fill('0.1')
  // BMI 는 직접 입력칸이 없다(FR-07 AC8) — 키·몸무게를 넣으면 자동 계산된다(170cm·90kg → 31.1)
  await page.getByTestId('fit-input-height_cm').fill('170')
  await page.getByTestId('fit-input-weight_kg').fill('90')
  await expect(page.getByTestId('fit-derived-bmi')).toContainText('31.1')
  await page.getByTestId('fit-input-sit_reach').fill('-3')
  await page.getByTestId('fitness-submit').click()
  await expect(page.getByTestId('fitness-result')).toBeVisible()
}

// 처방 1항목의 펼침 3인방. summary 의 aria-label 이 항목별로 유일해서 운동명으로 집는다.
function rxWhy(page: Page, exercise: string) {
  const toggle = page.getByLabel(`왜 이 운동? ${exercise}`, { exact: true })
  return {
    toggle,
    details: toggle.locator('xpath=..'),
    panel: toggle.locator('xpath=following-sibling::ul[@data-testid="rx-why-panel"]'),
  }
}

test('추천 블록 — 신체조성 약점·연결 종목 배지·목적 경유 한국어 표기 (FR-08 AC8)', async ({ page }) => {
  await startPersona(page, 'P2')
  await startFitnessThroughParq(page)
  await submitFourWeaknesses(page)

  const result = page.getByTestId('fitness-result')

  // 신체조성은 등급 컷이 아니라 건강범위 규칙으로 판정된다 — 벗어나면 약점 블록이 선다
  await expect(result).toContainText('건강범위(18.5이상 25미만) 벗어남')
  await expect(result.getByTestId('rec-block').filter({ hasText: '신체조성' })).toBeVisible()

  // 연결 종목이 출처 배지와 함께 한 줄로 보인다(B티어의 '검증 중'을 화면에서 감추지 않음)
  const sports = result.getByTestId('rec-sport')
  await expect(sports.first()).toBeVisible()
  await expect(sports.filter({ hasText: '배드민턴' })).toContainText('전문가 큐레이션(검증 중)')

  // 멀티홉은 한국어로("via {goal}" 잔재 없음)
  await expect(result.getByTestId('rec-via-goal').filter({ hasText: '스트레칭' })).toHaveText(
    '스트레칭 목적 경유',
  )
  await expect(result.getByText(/via 스트레칭/)).toHaveCount(0)

  await assertNoHorizontalScroll(page)
})

test('AI 처방 "왜 이 운동?" 펼침 — 근거 경로·출처 배지·FITT 출처, 키보드 완주 (FR-08 AC8)', async ({
  page,
}) => {
  await startPersona(page, 'P2')
  await startFitnessThroughParq(page)
  await submitFourWeaknesses(page)

  await page.getByTestId('ai-prescribe-btn').click()
  const ai = page.getByTestId('ai-result')
  await expect(ai).toBeVisible()

  // 근거 있는 항목에는 펼침, 없는 항목에는 "근거 정보 없음"(P-1 — 배지를 지어내지 않는다)
  await expect(ai.getByTestId('rx-why-toggle').first()).toBeVisible()
  await expect(ai.getByTestId('rx-why-none').first()).toContainText('근거 정보 없음')
  expect(await ai.getByTestId('rx-why-none').count()).toBe(2) // 순발력 2건(fitness_map)

  // ① 직접 근거(S) — 펼치기 전에는 닫혀 있고, 키보드만으로 Enter 열기 / Space 닫기(A11Y-1)
  const flex = rxWhy(page, '스트레칭')
  await expect(flex.details).toHaveJSProperty('open', false)
  await flex.toggle.focus()
  await page.keyboard.press('Enter')
  await expect(flex.details).toHaveJSProperty('open', true)
  await expect(flex.panel).toBeVisible()
  await expect(flex.panel).toContainText('근거 경로: 약점 유연성 ← 스트레칭')
  await expect(flex.panel.getByTestId('rx-why-badge')).toHaveText('공단 공식 기준')
  await expect(flex.panel).toContainText('FITT 수치: 정부·국제 지침')
  await page.keyboard.press('Space')
  await expect(flex.details).toHaveJSProperty('open', false)

  // ② 목적 경유(멀티홉): 경로 문장 + 최약 링크 고지 + 경로 등급 배지(V)
  const via = rxWhy(page, '어깨 돌리기')
  await via.toggle.click()
  await expect(via.panel).toContainText('어깨 돌리기 → 스트레칭 목적 운동 → 유연성')
  await expect(via.panel).toContainText('스트레칭 목적 경유')
  await expect(via.panel).toContainText('두 홉 중 약한 쪽')
  await expect(via.panel.getByTestId('rx-why-badge')).toHaveText('공단 콘텐츠')

  // ③ 검증 대기(B티어)는 펼침 안에서도 "검증 중"으로 그대로 표기된다
  const pending = rxWhy(page, '방향전환 훈련')
  await pending.toggle.click()
  await expect(pending.panel.getByTestId('rx-why-badge')).toHaveText('전문가 큐레이션(검증 중)')

  // ④ 4티어 배지가 처방 안에서 모두 등장한다(S·A·V·B)
  for (const label of ['공단 공식 기준', '정부·국제 지침', '공단 콘텐츠', '전문가 큐레이션(검증 중)']) {
    expect(
      await ai.getByTestId('rx-why-badge').filter({ hasText: label }).count(),
      `${label} 배지 없음`,
    ).toBeGreaterThan(0)
  }

  await assertNoHorizontalScroll(page)
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

test('BMI 는 직접 입력칸 없이 키·몸무게로 자동 계산되고, 결과에 계산 출처가 남는다 (FR-07 AC8)', async ({ page }) => {
  // ★ v1.10(3A): 데모 페르소나로 들어오면 측정값이 프리필된다 — "빈 폼에서 한 칸만 채운다"가
  //   전제인 이 검사는 프리필이 없는 메인(실사용) 경로로 간다. 27세 성인 = BMI 항목이 있는 연령군.
  await openMain(page)
  await fillMainSlots(page)
  await startFitnessThroughParq(page)
  const form = page.getByTestId('fitness-form')
  await expect(form).toBeVisible()
  await expect(page.getByTestId('fit-prefill-note')).toHaveCount(0)         // 메인은 프리필 없음
  await expect(page.getByTestId('fit-input-bmi')).toHaveCount(0)            // 직접 입력칸 없음
  await expect(page.getByTestId('fit-derived-field-bmi')).toBeVisible()
  // 하나만 넣으면 계산 안 됨(+ 제출도 이 항목만으론 불가)
  await page.getByTestId('fit-input-height_cm').fill('170')
  await expect(page.getByTestId('fit-derived-bmi')).toContainText('모두 넣으면')
  await expect(page.getByTestId('fitness-submit')).toBeDisabled()
  await page.getByTestId('fit-input-weight_kg').fill('70')
  await expect(page.getByTestId('fit-derived-bmi')).toContainText('24.2')
  await page.getByTestId('fitness-submit').click()
  const result = page.getByTestId('fitness-result')
  await expect(result).toBeVisible()
  await expect(result.getByTestId('derived-note-bmi')).toContainText('키 170cm')
  await expect(result.getByTestId('derived-note-bmi')).toContainText('24.2')
})
