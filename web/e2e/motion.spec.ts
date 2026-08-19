import { test, expect } from '@playwright/test'
import {
  assertNoHorizontalScroll,
  deck,
  fillMainSlots,
  openDemo,
  openMain,
  pickAge,
  pickRegion,
  settleTypewriter,
  snapContainerCount,
  startPersona,
  stream,
} from './helpers'

// v1.5 UX 계약 (PRD FR-12 AC6·AC9·AC10·AC11) —
//   ① 카드 가로 스와이프 카루셀: 판정 카드·시설 카드가 자체 스냅 컨테이너를 갖는다(페이지 가로 스크롤은 0)
//   ② 봇 발화 타이프라이터: 모션 ON 이면 순차 표시 → 완성, 최종 상태는 항상 완전한 문장
//   ③ prefers-reduced-motion: 타이프라이터·순차 등장·등장 모션 즉시/비활성
//   ④ 연령 2단계 칩(연령대 → 세부 나이)만으로 판정 완주 + 정확 나이로만 판정
// v1.6 확장(AC10) —
//   ⑧ 연속 봇 메시지 순차 등장: 인사 타이핑 완료 → 타이핑 인디케이터 → 첫 질문 → 칩

test('① 390px 결과 덱 — 결과 전체가 단일 스냅 스크롤 컨테이너 + 넘김 힌트·진행 표시를 갖고, 페이지 가로 스크롤은 0', async ({
  page,
}) => {
  await openDemo(page)
  await startPersona(page, 'P1')

  // v1.7: 판정 카드·공급공백·시설이 카루셀 여러 개가 아니라 덱 하나로 합쳐졌다(FR-12 AC9)
  const cards = deck(page)
  await expect(cards).toBeVisible()
  await expect(cards).toHaveAttribute('tabindex', '0') // 키보드 스크롤 가능
  await expect(cards).toHaveAttribute('aria-label', /판정 결과 카드 \d+장, 좌우로 이동/)

  const style = await cards.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { overflowX: cs.overflowX, snapType: cs.scrollSnapType }
  })
  expect(style.overflowX).toBe('auto')
  expect(style.snapType).toContain('x')

  // 실제로 옆으로 넘길 것이 있다(트랙이 컨테이너보다 넓다) + 슬라이드가 스냅 정렬·85% 피크를 갖는다
  const geom = await cards.evaluate((el) => {
    const first = el.querySelector('li')!
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      snapAlign: getComputedStyle(first).scrollSnapAlign,
      ratio: first.getBoundingClientRect().width / el.clientWidth,
      alignItems: getComputedStyle(el.querySelector('ul')!).alignItems,
    }
  })
  expect(geom.scrollWidth).toBeGreaterThan(geom.clientWidth)
  expect(geom.snapAlign).toBe('start')
  expect(geom.ratio).toBeGreaterThan(0.8)
  expect(geom.ratio).toBeLessThan(0.9) // 다음 카드가 살짝 보이는 피크
  expect(geom.alignItems).toBe('flex-start') // 높이 차가 커도 컨테이너가 출렁이지 않는다

  // 스냅 컨테이너는 결과 영역 통틀어 하나뿐이다(덱 안에 카루셀을 또 넣지 않는다)
  expect(await snapContainerCount(page)).toBe(1)
  await expect(page.getByTestId('assess-carousel')).toHaveCount(0)
  await expect(page.getByTestId('facility-carousel')).toHaveCount(0)

  // 넘김 힌트(나비 톤) + 진행 표시(시각 점 + 텍스트)
  await expect(page.getByTestId('carousel-hint').first()).toContainText('옆으로 넘기')
  await expect(page.getByTestId('deck-progress')).toContainText('1 /')

  // ★ 덱은 자체 컨테이너로 스크롤한다 — 페이지는 여전히 가로 스크롤 0(NFR-4)
  await assertNoHorizontalScroll(page)

  // 실제 가로 스크롤이 동작한다(스와이프 대체 = 프로그램 스크롤) + 진행 표시가 따라온다
  await cards.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: 'instant' as ScrollBehavior }))
  expect(await cards.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(page.getByTestId('deck-progress')).toContainText('2 /')
  await assertNoHorizontalScroll(page)
})

test('② 봇 발화 타이프라이터 — 순차 표시 후 완성 문장으로 끝난다 (모션 ON)', async ({ page }) => {
  await page.goto('/')

  // 인사 버블이 타이핑 중인 순간을 잡는다(설계상 최대 2.5s 재생)
  const tw = page.getByTestId('typewriter').first()
  await expect(tw).toHaveAttribute('data-typing', 'true')
  // 아직 안 나온 뒷부분은 투명하게 자리만 잡고 있다(레이아웃 흔들림 0 · 낭독은 완성 문장 1회)
  await expect(page.getByTestId('typewriter-pending').first()).toBeAttached()

  // 끝나면 완성 문장 — 중간에서 멈추지 않는다
  await expect(tw).toHaveAttribute('data-typing', 'false')
  await expect(page.getByTestId('typewriter-pending')).toHaveCount(0)
  await expect(stream(page).getByText('안녕하세요, 스포내비 안내자 나비예요.')).toBeVisible()

  // 보조 줄(비저장 고지)은 본문 완료 뒤 보인다
  const sub = stream(page).getByTestId('bot-sub')
  await expect(sub).toHaveClass(/opacity-100/)

  // 진행 중 새 입력이 와도 앞 발화는 완성 상태로 남는다(끊긴 문장 금지)
  await pickAge(page, 27)
  await settleTypewriter(page)
  await expect(stream(page).getByText('안녕하세요, 스포내비 안내자 나비예요.')).toBeVisible()
  await expect(page.locator('[data-typing="true"]')).toHaveCount(0)
})

test('③ prefers-reduced-motion — 타이프라이터는 즉시 전체 표시, 등장 모션은 없다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const tw = page.getByTestId('typewriter').first()
  await expect(tw).toHaveAttribute('data-typing', 'false')
  await expect(page.getByTestId('typewriter-pending')).toHaveCount(0)
  await expect(stream(page).getByText('안녕하세요, 스포내비 안내자 나비예요.')).toBeVisible()

  // 메시지 등장 애니메이션도 비활성
  const anim = await stream(page)
    .locator('.msg-in')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName)
  expect(anim).toBe('none')

  // v1.6: 순차 등장 연출도 통째로 생략 — 인사와 첫 질문·칩이 인디케이터 없이 한 번에 있다
  await expect(page.getByTestId('typing-indicator')).toHaveCount(0)
  await expect(stream(page).getByTestId('question-age_band')).toBeVisible()
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
  await expect(stream(page)).toHaveAttribute('data-sequencing', 'false')
})

test('④ 연령 2단계 칩(연령대 → 세부 나이)만으로 판정 완주 — 정확 나이로만 판정한다', async ({
  page,
}) => {
  await openMain(page)

  // 1단계: 연령대 8종(9세 이하 ~ 70대 이상)
  for (const id of ['u9', '10s', '20s', '30s', '40s', '50s', '60s', '70s']) {
    await expect(page.getByTestId(`chip-ageband-${id}`)).toBeVisible()
  }

  // 연령대만 골라서는 판정으로 넘어가지 않는다 — 세부 나이를 다시 묻는다
  await page.getByTestId('chip-ageband-20s').click()
  await expect(stream(page).getByText(/몇 세이신지 골라 주세요/)).toBeVisible()
  await expect(page.getByTestId('chip-age-20')).toBeVisible()
  await expect(page.getByTestId('chip-age-29')).toBeVisible()
  await expect(page.getByTestId('chip-sex-M')).toHaveCount(0) // 다음 질문으로 넘어가지 않았다

  // 2단계: 정확 나이 선택 → 나머지 슬롯 → 판정 완주
  await page.getByTestId('chip-age-27').click()
  await page.getByTestId('chip-sex-M').click()
  await pickRegion(page, '11290')
  await page.getByTestId('chip-income-기초생활수급').click()
  await page.getByTestId('chip-dis-no').click()

  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  // 판정에 쓰인 값은 구간 대표값이 아니라 고른 정확 나이다
  await expect(stream(page).getByText(/27세/).first()).toBeVisible()
  await assertNoHorizontalScroll(page)
})

test('⑤ 70대 이상 → 80세 이상 → 세부 나이까지 이어지고, 나이 정정은 2단계로 재진입한다', async ({
  page,
}) => {
  await openMain(page)

  // 70대 이상의 마지막 칩으로 한 단계 위 구간(80세 이상)까지 갈 수 있다
  await page.getByTestId('chip-ageband-70s').click()
  await expect(page.getByTestId('chip-age-70')).toBeVisible()
  await expect(page.getByTestId('chip-age-79')).toBeVisible()
  await page.getByTestId('chip-ageband-80s').click()
  await expect(page.getByTestId('chip-age-85')).toBeVisible()
  await page.getByTestId('chip-age-85').click()

  // 이어서 성별 질문으로 넘어간다(정확 나이 확정)
  await expect(page.getByTestId('chip-sex-F')).toBeVisible()
})

test('⑥ 데모 P1~P5 원클릭은 연령 2단계와 무관하게 그대로 완주한다', async ({ page }) => {
  await openDemo(page)
  // 프리필 페르소나는 나이 질문 자체를 거치지 않는다
  await expect(page.getByTestId('chip-ageband-20s')).toHaveCount(0)
  await startPersona(page, 'P4') // 72세 — 연령대 칩으로는 두 단계가 필요한 나이
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(stream(page).getByText(/72세/).first()).toBeVisible()
})

test('⑦ 메인 실사용 경로(연령 2단계 포함) 완주 후에도 카루셀·컴포저 카피가 계약대로다', async ({
  page,
}) => {
  await openMain(page)
  // 컴포저 플레이스홀더(사용자 확정 카피)
  await expect(page.getByTestId('composer-input')).toHaveAttribute('placeholder', '메시지를 입력하세요')

  await fillMainSlots(page)
  await expect(deck(page)).toBeVisible()
  expect(await snapContainerCount(page)).toBe(1)
  await assertNoHorizontalScroll(page)
})

test('⑧ 부팅 순차 등장 — 인사 타이핑 완료 → 타이핑 인디케이터 → 첫 질문 → 칩 (FR-12 AC10 v1.6)', async ({
  page,
}) => {
  // 등장 순서·간격을 프레임 단위로 기록한다(고정 sleep 없이 "먼저 뜨지 않았음"을 증명).
  await page.addInitScript(() => {
    const marks: Record<string, number> = {}
    ;(window as unknown as { __marks: Record<string, number> }).__marks = marks
    const seen = (key: string, el: Element | null) => {
      if (el && marks[key] == null) marks[key] = performance.now()
    }
    const tick = () => {
      const greet = document.querySelector('[data-testid="typewriter"]')
      seen('greet', greet)
      if (greet?.getAttribute('data-typing') === 'false') seen('greetDone', greet)
      seen('indicator', document.querySelector('[data-testid="typing-indicator"]'))
      seen('question', document.querySelector('[data-testid="question-age_band"]'))
      seen('chips', document.querySelector('[data-testid="inline-chips"]'))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await page.goto('/')

  // 인사 버블이 타이핑되는 동안 첫 질문 버블은 아직 없다("미리 떠 있음" 금지)
  await expect(stream(page).getByText('안녕하세요, 스포내비 안내자 나비예요.')).toBeVisible()
  await expect(stream(page).getByTestId('question-age_band')).toHaveCount(0)

  // 인디케이터는 낭독 대상이 아니다(완성 문장만 1회 낭독 — AC8)
  const dots = page.getByTestId('typing-indicator')
  await expect(dots).toBeVisible()
  await expect(dots).toHaveAttribute('aria-hidden', 'true')
  await expect(dots.locator('.typing-dot')).toHaveCount(3)

  // 시퀀스가 끝나면 질문 버블과 그 아래 칩까지 도착해 있다
  await settleTypewriter(page)
  await expect(stream(page).getByTestId('question-age_band')).toBeVisible()
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
  await expect(page.getByTestId('typing-indicator')).toHaveCount(0)

  const marks = await page.evaluate(
    () => (window as unknown as { __marks: Record<string, number> }).__marks,
  )
  // 순서: 인사 → (인사 타이핑 완료) → 인디케이터 → 질문 → 칩
  expect(marks.greet).toBeLessThan(marks.greetDone)
  expect(marks.greetDone).toBeLessThanOrEqual(marks.indicator)
  expect(marks.indicator).toBeLessThan(marks.question)
  expect(marks.question).toBeLessThan(marks.chips)
  // 인사는 실제로 한 글자씩 찍혔고(즉시 완성 아님), 인디케이터는 300~600ms 머문다
  expect(marks.greetDone - marks.greet).toBeGreaterThan(400)
  expect(marks.question - marks.indicator).toBeGreaterThanOrEqual(280)
  // 질문의 칩은 그 버블 타이핑이 끝난 뒤에 나타난다
  expect(marks.chips - marks.question).toBeGreaterThan(280)
})
