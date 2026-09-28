import { test, expect, type Page } from '@playwright/test'
import {
  expectAtBottom,
  expectMapMounted,
  fillMainSlots,
  openMain,
  settleTypewriter,
} from './helpers'

// "맨 아래로" 버튼(FAB) 계약 —
//   ① 바닥에 붙어 있으면 없는 것과 같다(data-visible=false · 클릭·포커스 대상 아님)
//   ② 바닥에서 조금만 멀어져도 나타난다(임계 160px) — 컴포저 줄 안(보내기 왼쪽), 화면 안.
//      스트림 위에 떠 있지 않으므로 어떤 내용도 덮지 않는다(v1.12 — 떠 있던 버튼이 출처 줄·설명을 가렸다)
//   ③ 누르면 문서 맨 아래로 부드럽게 내려가고 **바닥 추종이 재개**된다
//      (다음 봇 버블이 다시 화면에 따라온다 = 덱 규칙을 되돌리는 유일한 사용자 조작)
//   ④ 자동재생이 화면을 소유하는 동안에는 아예 렌더하지 않는다
//   ⑤ prefers-reduced-motion 이면 이동(translate/scale) 없이 즉시 나타나고 사라진다

function fab(page: Page) {
  return page.getByTestId('scroll-bottom-fab')
}

// 문서 바닥까지 남은 거리(0 = 바닥).
function gapToBottom(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight),
  )
}

test('① 바닥에서는 숨고, ② 위로 올라가면 컴포저 줄 안(보내기 왼쪽)에 나타난다', async ({ page }) => {
  await openMain(page)
  await fillMainSlots(page)
  await settleTypewriter(page)
  await expectAtBottom(page, '판정 후속 안내 뒤 바닥에 있지 않다(FAB 시작 조건)')

  // ① 바닥 = 숨김. DOM 에는 남아 있지만 보이지도, 눌리지도, 낭독되지도 않는다.
  await expect(fab(page)).toHaveAttribute('data-visible', 'false')
  await expect(fab(page)).toHaveAttribute('aria-hidden', 'true')
  await expect(fab(page)).not.toBeVisible()

  // ② 조금만 위로 올라가도(≈ 한 번 굴린 거리) 나타난다
  await page.evaluate(() => window.scrollBy(0, -700))
  await expect(fab(page)).toHaveAttribute('data-visible', 'true', { timeout: 1_000 })
  await expect(fab(page)).toBeVisible()
  await expect(fab(page)).toHaveAttribute('aria-label', '맨 아래로')
  // 등장 전환(180ms: opacity + translateY 8px + scale)이 끝난 뒤에 위치를 잰다 —
  // 재생 중에는 축소·하강한 중간 상태라 박스가 실제 배치와 다르다.
  await expect(fab(page)).toHaveCSS('transform', 'none')

  const vp = page.viewportSize()!
  const box = (await fab(page).boundingBox())!
  const composer = (await page.getByTestId('composer').boundingBox())!
  const send = (await page.getByTestId('composer-send').boundingBox())!
  const input = (await page.getByTestId('composer-input').boundingBox())!
  expect(box, 'FAB 박스를 못 잡았다').not.toBeNull()

  // 44×44 원형 탭 타깃(폭 전환이 끝난 뒤)
  await expect.poll(async () => Math.round((await fab(page).boundingBox())!.width)).toBe(44)
  expect(Math.round(box.height), `FAB 높이 ${box.height}`).toBe(44)

  // 화면 안 · 화면 아래쪽
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  expect(box.y, 'FAB 가 화면 위쪽 절반에 있다').toBeGreaterThan(vp.height / 2)

  // ★ 컴포저 띠 안에 들어 있다 = 스트림 내용 위에 떠 있지 않다
  expect(box.y, 'FAB 가 컴포저 윗변 위로 삐져나왔다').toBeGreaterThanOrEqual(composer.y)
  expect(box.y + box.height).toBeLessThanOrEqual(composer.y + composer.height)
  // 보내기 바로 왼쪽(간격 10px = gap-2.5), 입력칸·보내기와 겹치지 않는다
  const fb = (await fab(page).boundingBox())!
  expect(Math.round(send.x - (fb.x + fb.width)), '보내기와의 간격').toBe(10)
  expect(fb.x, 'FAB 가 입력칸과 겹친다').toBeGreaterThanOrEqual(input.x + input.width - 1)

  // 스트림 오른쪽 끝의 글자를 덮지 않는다 — FAB 중심점의 최상위 요소가 FAB 자신이다
  const topIsFab = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="scroll-bottom-fab"]')!
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return hit != null && el.contains(hit)
  })
  expect(topIsFab).toBe(true)
})

test('③ 누르면 맨 아래로 내려가고 바닥 추종이 재개된다(다음 봇 버블도 따라온다)', async ({
  page,
}) => {
  await openMain(page)
  await fillMainSlots(page)
  await settleTypewriter(page)
  await expectAtBottom(page, '판정 후속 안내 뒤 바닥에 있지 않다(FAB 시작 조건)')

  await page.evaluate(() => window.scrollBy(0, -700))
  await expect(fab(page)).toHaveAttribute('data-visible', 'true', { timeout: 1_000 })
  expect(await gapToBottom(page), '위로 올라가지 않았다').toBeGreaterThan(160)

  // 클릭 = 문서 맨 아래. 덱 대기(DECK_HOLD_MS)도, 자기 pointerdown 에 의한 취소도 없다.
  await fab(page).click()
  await expect.poll(gapToBottom.bind(null, page), {
    message: 'FAB 를 눌렀는데 2.5초 안에 바닥에 닿지 않았다',
    timeout: 2_500,
  }).toBeLessThanOrEqual(2)
  await expect(fab(page)).toHaveAttribute('data-visible', 'false')

  // 바닥 추종 재개: 여기서부터는 평범한 대화 — 새 봇 버블이 다시 화면에 따라온다
  await page.getByTestId('chip-act-restart').click()
  await expect(page.getByTestId('chip-restart-no')).toBeVisible()
  await settleTypewriter(page)
  await expectAtBottom(page, 'FAB 로 내려온 뒤 바닥 추종이 재개되지 않았다')
  const vh = page.viewportSize()!.height
  const keep = (await page.getByTestId('chip-restart-no').boundingBox())!
  expect(keep.y).toBeGreaterThanOrEqual(0)
  expect(keep.y + keep.height, '새 칩이 화면 아래로 잘려 있다').toBeLessThanOrEqual(vh)
  await expect(fab(page)).toHaveAttribute('data-visible', 'false')
})

test('④ 자동재생이 화면을 소유하는 동안에는 버튼 자체가 없다', async ({ page }) => {
  await page.goto('/#/demo?p=P2&auto=1')

  const status = page.getByTestId('autoplay-status')
  await expect(status).toBeVisible()
  await expect(fab(page), '자동재생 중에 FAB 가 렌더됐다').toHaveCount(0)

  // 자동재생이 끝나 화면 소유권이 대화로 돌아오면 다시 붙는다(숨김 상태로).
  await expect(status).toHaveCount(0, { timeout: 30_000 })
  await expect(fab(page)).toHaveCount(1)
})

test('⑤ prefers-reduced-motion — 등장·퇴장에 이동·축소가 없다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openMain(page)
  await fillMainSlots(page)
  await expectAtBottom(page, '판정 후속 안내 뒤 바닥에 있지 않다(FAB 시작 조건)')

  // 숨김 상태에서도 transform 을 쓰지 않는다(전역 reduce 규칙 + .fab-pop 이중 방어)
  await expect(fab(page)).toHaveAttribute('data-visible', 'false')
  expect(await fab(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none')

  await page.evaluate(() => window.scrollBy(0, -700))
  await expect(fab(page)).toHaveAttribute('data-visible', 'true', { timeout: 1_000 })
  expect(await fab(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none')

  // 눌러도 같은 계약 — 애니메이션 없이 즉시 바닥
  await fab(page).click()
  await expect.poll(gapToBottom.bind(null, page), {
    message: '모션 최소화에서 FAB 가 바닥으로 데려가지 못했다',
    timeout: 2_500,
  }).toBeLessThanOrEqual(2)
})

test('⑥ 패널을 연 뒤에도 FAB 는 바닥까지 데려가고, 뒤늦은 레이아웃 성장까지 따라간다', async ({
  page,
}) => {
  await openMain(page)
  await fillMainSlots(page)
  await settleTypewriter(page)

  // 지도 패널을 연다(문서가 스트림 밖에서 크게 자라는 상황 — 제보의 재현 조건)
  await page.getByTestId('chip-act-map').click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('panel-body')).toBeVisible()

  // 패널이 자리를 잡을 때까지(지도 마운트 + 바닥 복귀 완료) 기다렸다가 올라간다.
  await expectMapMounted(page)
  await expectAtBottom(page, '"지도에서 보기" 뒤 바닥으로 돌아오지 않았다')

  // 실제 손가락처럼 굴린다 — 휠·터치는 우리 스크롤 보호창(autoUntil) 안이라도 즉시 개입으로 잡혀
  // 바닥 추종이 풀린다(지도 타일이 자라는 동안 손을 다시 끌어내리지 않는다).
  // ※ 합성 휠은 실기기와 달리 진행 중인 smooth 스크롤 애니메이션을 취소하지 못한다 —
  //   지도 타일이 계속 도착하는 동안에는 한 번 더 굴려야 할 수 있어 폴링으로 굴린다.
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, -800)
        return fab(page).getAttribute('data-visible')
      },
      { message: '위로 굴렸는데 FAB 가 나타나지 않았다', timeout: 8_000 },
    )
    .toBe('true')

  await fab(page).click()
  await expect.poll(gapToBottom.bind(null, page), {
    message: '패널이 열린 상태에서 FAB 가 바닥으로 데려가지 못했다',
    timeout: 2_500,
  }).toBeLessThanOrEqual(2)

  // ★ 바닥에 닿은 뒤 문서가 더 자라도(지도 타일·이미지가 뒤늦게 도착하는 상황) 따라간다.
  //   스트림 밖에서 자라는 경우까지 보려고 body 에 직접 붙인다(React 소유 노드는 건드리지 않는다).
  await page.evaluate(() => {
    const grow = document.createElement('div')
    grow.id = 'e2e-late-growth'
    grow.style.height = '600px'
    document.body.appendChild(grow)
  })
  await expect.poll(gapToBottom.bind(null, page), {
    message: '뒤늦은 레이아웃 성장(600px)을 바닥 추종이 따라가지 못했다',
    timeout: 1_000,
  }).toBeLessThanOrEqual(2)
})
