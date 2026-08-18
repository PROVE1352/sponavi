import { test, expect } from '@playwright/test'
import { fillMainSlots, openDemo, openMain, startPersona, stream } from './helpers'

// v1.4 UX 계약 — 메인/데모 분리 + 경로 시각화 배치 + 모바일 상단 시트(PRD FR-12 AC3·AC5·AC7, FR-03).
//   ① 메인 랜딩 = 실사용 전용: 데모 문구·P1~P5 칩·푸터·컴포저 고지 없음, 인사 1버블 뒤 곧바로 첫 질문
//   ② /#/demo  = 시연 전용: P1~P5 퀵스타트 칩 + 데모 배지 + 푸터(기준일·출처·면책)
//   ③ 경로 시각화 = 메인 결과 부재 / 데모 결과 항시 노출
//   ④ 390px 결과 도착 → 컨텍스트 패널 자동 표시(슬라이드다운) + 접기 유지
//   ⑤ prefers-reduced-motion → 애니메이션 없이 즉시 표시

test('① 메인 랜딩은 실사용 전용 — 데모 문구·퀵스타트 칩·푸터·컴포저 고지 없이 첫 질문부터', async ({
  page,
}) => {
  await openMain(page)

  // 인사는 버블 1개: 자기소개 + 안내 + 보조 한 줄 고지(비저장 + 외부 AI 전송)
  await expect(stream(page).getByText('안녕하세요, 스포내비 안내자 나비예요.')).toBeVisible()
  const sub = stream(page).getByTestId('bot-sub')
  await expect(sub).toHaveCount(1)
  await expect(sub).toContainText('저장하지 않고')
  await expect(sub).toContainText('외부 AI')
  await expect(sub).toContainText('이름·연락처는 묻지 않습니다')

  // 곧바로 첫 질문(나이 1단계 = 연령대) — 질문 버블 + 연령대 칩이 이미 렌더돼 있다(v1.5)
  await expect(stream(page).getByText(/먼저 나이를 알려주세요/)).toBeVisible()
  await expect(page.getByTestId('chip-ageband-u9')).toBeVisible()
  await expect(page.getByTestId('chip-ageband-70s')).toBeVisible()
  // 세부 나이 칩은 연령대를 고르기 전에는 없다
  await expect(page.getByTestId('chip-age-27')).toHaveCount(0)

  // 데모 요소는 하나도 없다
  for (const id of ['P1', 'P2', 'P3', 'P4', 'P5']) {
    await expect(page.getByTestId(`chip-persona-${id}`)).toHaveCount(0)
  }
  await expect(page.getByTestId('chip-manual-start')).toHaveCount(0)
  await expect(page.getByTestId('demo-badge')).toHaveCount(0)
  await expect(stream(page).getByText(/체험/)).toHaveCount(0)

  // 푸터(데이터 기준일·출처·면책)는 데모 페이지 소관 — 메인엔 없다
  await expect(page.getByTestId('page-footer')).toHaveCount(0)
  await expect(page.getByTestId('footer-data-built')).toHaveCount(0)

  // 컴포저 상시 고지도 인사 버블로 이전됐다 — 컴포저엔 남아 있지 않다
  const composer = page.getByTestId('composer')
  await expect(composer).not.toContainText('외부 API로 전송')
  await expect(page.getByTestId('composer-notice')).toHaveCount(0)
})

test('② /#/demo 는 P1~P5 퀵스타트 칩 + 데모 배지 + 푸터를 갖는다', async ({ page }) => {
  await openDemo(page)

  for (const id of ['P1', 'P2', 'P3', 'P4', 'P5']) {
    await expect(page.getByTestId(`chip-persona-${id}`)).toBeVisible()
  }
  await expect(stream(page).getByText(/시연용 데모 페이지/)).toBeVisible()
  await expect(page.getByTestId('demo-badge')).toBeVisible()

  // 기준일·출처·면책의 보관처는 데모 페이지 푸터
  await expect(page.getByTestId('page-footer')).toBeVisible()
  await expect(page.getByTestId('footer-data-built')).toContainText('데이터 기준')

  // 고지 이전은 데모에서도 동일(컴포저엔 상시 고지 없음)
  await expect(page.getByTestId('composer-notice')).toHaveCount(0)
})

test('③ 경로 시각화 — 메인 결과엔 없고 데모 결과엔 항시 노출된다 (FR-03 v1.4)', async ({ page }) => {
  const pathCard = () => stream(page).getByRole('region', { name: '추천 경로 시각화' })

  // 메인: 칩만으로 슬롯 5개를 채워 판정까지 — 결과가 나와도 경로 카드는 없다
  await openMain(page)
  await fillMainSlots(page)
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(pathCard()).toHaveCount(0)
  // 접힘 UI 자체가 없다("왜 이 결과인가?" 펼침 버튼도 두지 않는다)
  await expect(stream(page).getByRole('button', { name: /왜 이 결과인가/ })).toHaveCount(0)

  // 데모: 같은 판정에서 경로 카드가 펼쳐진 채로 함께 온다
  await openDemo(page)
  await startPersona(page, 'P2')
  await expect(pathCard()).toBeVisible()
  await expect(pathCard().getByText('대체경로')).toBeVisible()
})

test('④ 390px — 결과 도착 시 컨텍스트 패널이 자동으로 펼쳐지고(슬라이드다운) 접기가 동작한다', async ({
  page,
}) => {
  await openDemo(page)
  // 판정 전에는 패널 자체가 없다
  await expect(page.getByTestId('context-panel')).toHaveCount(0)

  await startPersona(page, 'P1')

  // 자동 표시: 별도 조작 없이 본문(지도/목록 탭)이 펼쳐진 상태로 존재한다
  const body = page.getByTestId('panel-body')
  await expect(body).toBeVisible()
  await expect(page.getByTestId('panel-tab-map')).toBeVisible()
  const toggle = page.getByTestId('panel-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveText('접기')

  // 나타날 때 위에서 아래로 슬라이드(200~300ms, ease-out)
  await expect(body).toHaveClass(/sheet-slide-down/)
  const anim = await body.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { name: cs.animationName, duration: cs.animationDuration }
  })
  expect(anim.name).toBe('sheet-slide-down')
  const ms = Number.parseFloat(anim.duration) * 1000
  expect(ms).toBeGreaterThanOrEqual(200)
  expect(ms).toBeLessThanOrEqual(300)

  // 접기 버튼 유지: 접으면 본문이 사라지고, 다시 펼치면 돌아온다
  await toggle.click()
  await expect(body).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveText('지도·목록 펼치기')

  await toggle.click()
  await expect(body).toBeVisible()
  await expect(page.getByTestId('panel-tab-map')).toBeVisible()
})

test('⑤ prefers-reduced-motion — 패널은 애니메이션 없이 즉시 표시된다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openDemo(page)
  await startPersona(page, 'P1')

  const body = page.getByTestId('panel-body')
  await expect(body).toBeVisible()
  const name = await body.evaluate((el) => getComputedStyle(el).animationName)
  expect(name).toBe('none')
})
