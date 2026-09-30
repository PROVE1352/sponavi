import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  areaButton,
  assertNoHorizontalScroll,
  dragMap,
  fillMainSlots,
  mapBox,
  mapCanvas,
  mapCenter,
  mapMarkers,
  openDemo,
  openMain,
  userScrollToMap,
  openPanel,
  panel,
  startPersona,
  stream,
  waitForMapIdle,
  waitMoveSettled,
} from './helpers'

// "이 지역에서 다시 찾기"(계약서 v2 §6·§7.3) — 카카오맵 "현 지도에서 검색".
//   ① 사용자가 지도를 직접 움직였을 때만 버튼이 뜬다(프로그램 이동·resize 로는 안 뜬다)
//   ② 누르면 그 범위의 **위치가 확인된** 시설만 지도·목록에 나온다. 지도는 움직이지 않는다
//   ③ 근사 좌표 시설은 점으로 찍지 않고 "정확한 위치를 확인할 수 없는 N곳(시군구 전체 수)"으로 따로 말한다
//   ④ "원래 결과로"는 기존 마커('내 위치' 포함)와 화면 맞춤을 되돌린다
// 목 빌드 기본(390x844). 8번은 ?live=1 + route 주입으로 서버 응답 모양을 고정한다.

const SHOT_DIR = process.env.AREA_SHOT_DIR

// AREA_SHOT_DIR 이 있을 때만 뷰포트 캡처. target 의 윗변을 sticky 헤더 바로 밑에 맞춘다(즉시 스크롤).
async function shotIf(page: Page, name: string, target?: Locator) {
  if (!SHOT_DIR) return
  if (target) {
    await target.evaluate((el) => {
      const h = document.querySelector('header')?.getBoundingClientRect().height ?? 0
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - h - 8, behavior: 'instant' })
    })
  }
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, animations: 'disabled' })
}

function bar(page: Page): Locator {
  return page.getByTestId('area-search-bar')
}

function areaMarkers(page: Page): Locator {
  return mapBox(page).locator('.maplibregl-marker[data-area="true"]')
}

function nonAreaMarkers(page: Page): Locator {
  return mapBox(page).locator('.maplibregl-marker:not([data-area="true"])')
}

function areaRows(scope: Locator): Locator {
  return scope.locator(
    '[data-testid="voucher-facility"], [data-testid="dvoucher-facility"], [data-testid="alt-facility"]',
  )
}

async function areaCountSum(page: Page): Promise<number> {
  return areaMarkers(page).evaluateAll((els) =>
    els.reduce((s, e) => s + Number(e.getAttribute('data-count') ?? 0), 0),
  )
}

// 버튼이 ms 동안 한 번도 나타나지 않는다(프로그램 이동 뒤의 "안 뜸"은 순간이 아니라 구간으로 본다).
async function expectNoButtonFor(page: Page, ms = 500) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    expect(await areaButton(page).count(), '프로그램 이동인데 버튼이 떴다').toBe(0)
    await page.waitForTimeout(50)
  }
}

// 다음 ms 동안 매 애니메이션 프레임마다 "이 지역에서 다시 찾기" 버튼이 **보이는지** 센다(숨은 탭 안의 노드는
// 보이지 않는 것으로 친다). 지목 flyTo(약 0.7초) 도중의 낡은 버튼을 잡는다 — 끝난 뒤 0개인지만 보면 못 잡는다.
async function startButtonFrameSampler(page: Page, ms: number) {
  await page.evaluate((dur) => {
    const w = window as unknown as { __areaBtn: { frames: number; visible: number; done: boolean } }
    w.__areaBtn = { frames: 0, visible: 0, done: false }
    const end = performance.now() + dur
    const tick = () => {
      w.__areaBtn.frames += 1
      const el = document.querySelector<HTMLElement>('[data-testid="area-search-button"]')
      if (el && el.getClientRects().length > 0) w.__areaBtn.visible += 1
      if (performance.now() < end) requestAnimationFrame(tick)
      else w.__areaBtn.done = true
    }
    requestAnimationFrame(tick)
  }, ms)
}

async function buttonFrameSample(page: Page): Promise<{ frames: number; visible: number }> {
  await page.waitForFunction(() => (window as unknown as { __areaBtn: { done: boolean } }).__areaBtn.done)
  return page.evaluate(() => {
    const s = (window as unknown as { __areaBtn: { frames: number; visible: number } }).__areaBtn
    return { frames: s.frames, visible: s.visible }
  })
}

async function dragAndSettle(page: Page, dx = 60, dy = 20) {
  await userScrollToMap(page)
  await dragMap(page, dx, dy)
  await waitMoveSettled(page)
}

async function openMapFor(page: Page, persona: string) {
  await openDemo(page)
  await startPersona(page, persona)
  await openPanel(page, 'map')
  await waitForMapIdle(page)
  await userScrollToMap(page)
}

async function runAreaSearch(page: Page) {
  await dragAndSettle(page)
  await expect(areaButton(page)).toBeVisible()
  await areaButton(page).click()
  await expect(bar(page)).toHaveAttribute('data-status', /done|error/)
}

// 탭 패널(숨김 여부와 상관없이) — 탭 버튼의 aria-controls 로 찾는다(useId 의 ':' 때문에 [id=…] 로).
async function tabPanel(page: Page, tab: 'map' | 'list'): Promise<Locator> {
  const id = await page.getByTestId(`panel-tab-${tab}`).getAttribute('aria-controls')
  return page.locator(`[id="${id}"]`)
}

async function headerBottom(page: Page): Promise<number> {
  return page.locator('header').first().evaluate((el) => el.getBoundingClientRect().bottom)
}

async function rectOf(l: Locator): Promise<{ top: number; bottom: number }> {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
}

// ───────────────────────────── 1 ─────────────────────────────
test('1. 끌기 → 버튼 → 결과 → 되돌리기(지도는 움직이지 않고, 되돌리면 다시 맞춘다)', async ({ page }) => {
  await openMapFor(page, 'P2')
  const c0 = await mapCenter(page)
  const z0 = await mapBox(page).getAttribute('data-zoom')
  const m0 = await mapMarkers(page).count()
  expect(c0).toBeTruthy()
  await expect(areaButton(page)).toHaveCount(0)

  // 2. 끌기 → 멈춘 뒤 버튼(지도 위쪽 60px 안)
  await dragAndSettle(page)
  const c1 = await mapCenter(page)
  const z1 = await mapBox(page).getAttribute('data-zoom')
  expect(c1).not.toBe(c0)
  await expect(areaButton(page)).toBeVisible()
  await expect(areaButton(page)).toHaveText('이 지역에서 다시 찾기')
  const mb = (await mapBox(page).boundingBox())!
  const bb = (await areaButton(page).boundingBox())!
  expect(bb.y - mb.y, `버튼 위치 ${bb.y - mb.y}px`).toBeGreaterThanOrEqual(0)
  expect(bb.y - mb.y).toBeLessThanOrEqual(60)
  await shotIf(page, '390-map-button', panel(page))
  // 390 다크 모드(헤더 토글) — 버튼·막대의 잉크/종이 반전 확인용 캡처
  if (SHOT_DIR) {
    await page.getByRole('button', { name: /다크|라이트/ }).first().click()
    await shotIf(page, '390-map-button-dark', panel(page))
    await page.getByRole('button', { name: /다크|라이트/ }).first().click()
  }

  // 3. 누르면 막대가 지도 **아래**에 — 지도 y 는 그대로
  await areaButton(page).click()
  const b = bar(page)
  await expect(b).toBeVisible()
  await expect(b).toHaveAttribute('data-status', 'done')
  await expect(b).toContainText('이 지도 범위')
  await expect(b.getByTestId('area-search-counts')).toBeVisible()
  const mb2 = (await mapBox(page).boundingBox())!
  expect(Math.abs(mb2.y - mb.y), '지도 y 가 밀렸다').toBeLessThanOrEqual(1)
  const barBox = (await b.boundingBox())!
  expect(barBox.y).toBeGreaterThanOrEqual(mb2.y + mb2.height)
  await expect(areaButton(page)).toHaveCount(0)
  await shotIf(page, '390-map-bar', panel(page))
  if (SHOT_DIR) {
    await page.getByRole('button', { name: /다크|라이트/ }).first().click()
    await shotIf(page, '390-map-bar-dark', panel(page))
    await page.getByRole('button', { name: /다크|라이트/ }).first().click()
  }

  // 4. 카메라는 그대로
  expect(await mapCenter(page)).toBe(c1)
  expect(await mapBox(page).getAttribute('data-zoom')).toBe(z1)

  // 5. 범위 마커 수(묶음 개수 합) = 목록 범위 결과 행 수, 범위 밖 마커('내 위치' 포함) 0
  await expect(nonAreaMarkers(page)).toHaveCount(0)
  const sum = await areaCountSum(page)
  await page.getByTestId('panel-tab-list').click()
  const results = panel(page).getByTestId('area-search-results')
  await expect(results).toBeVisible()
  expect(await areaRows(results).count()).toBe(sum)

  // 6. 목록: 위치 미상 블록(이용권은 목에서 전부 centroid) + 공공 섹션
  const block = results.locator('[data-testid="area-unlocated-block"][data-program]')
  await expect(block.first()).toBeVisible()
  await expect(block.first()).toContainText('정확한 위치를 확인할 수 없어')
  await expect(results.getByTestId('area-search-alt-section')).toBeVisible()
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('지도 범위 결과')
  await shotIf(page, '390-list', panel(page))

  // 7. 원래 결과로 → 막대 사라짐 · 마커 m0('내 위치' 포함) · 다시 맞춤(c0) · 버튼 없음
  await page.getByTestId('panel-tab-map').click()
  await bar(page).getByTestId('area-search-reset').click()
  await expect(bar(page)).toHaveCount(0)
  await expect(mapMarkers(page)).toHaveCount(m0)
  await expect(areaMarkers(page)).toHaveCount(0)
  await expect.poll(() => mapCenter(page)).toBe(c0)
  expect(await mapBox(page).getAttribute('data-zoom')).toBe(z0)
  await expect(areaButton(page)).toHaveCount(0)
  await expect(page.getByTestId('area-search-status')).toHaveText('원래 결과로 돌아왔어요')
  await expect(page.getByTestId('panel-tab-map')).toBeFocused()
  await assertNoHorizontalScroll(page)
})

// ───────────────────────────── 2 ─────────────────────────────
test('2. 너무 넓으면 확대 안내, 한 단계 확대하면 버튼', async ({ page }) => {
  await openMapFor(page, 'P2')
  const zoomOut = mapBox(page).getByRole('button', { name: '축소' })
  const hint = page.getByTestId('area-search-zoom-hint')
  for (let i = 0; i < 4; i++) {
    if (await hint.isVisible()) break
    await zoomOut.click()
    await waitMoveSettled(page)
  }
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText('지도를 조금 더 확대해 주세요')
  await expect(areaButton(page)).toHaveCount(0)
  await expect(page.getByTestId('area-search-live')).toHaveText(
    '지도를 조금 더 확대하면 이 지역에서 다시 찾을 수 있어요',
  )
  await shotIf(page, '390-zoom-hint', panel(page))

  await mapBox(page).getByRole('button', { name: '확대' }).click()
  await waitMoveSettled(page)
  await expect(areaButton(page)).toBeVisible()
  await expect(hint).toHaveCount(0)
})

// ───────────────────────────── 3 ─────────────────────────────
test('3. 프로그램 이동(첫 맞춤·탭 전환·키워드·지목)에는 버튼이 뜨지 않는다', async ({ page }) => {
  // (a) 첫 로딩
  await openMapFor(page, 'P2')
  await expectNoButtonFor(page)

  // (b) 목록 → 지도 탭
  await page.getByTestId('panel-tab-list').click()
  await page.getByTestId('panel-tab-map').click()
  await expectNoButtonFor(page)

  // (c) 키워드 제출(결과 점이 지도에 얹히며 다시 맞춘다)
  await page.getByTestId('panel-tab-list').click()
  const input = panel(page).getByTestId('facility-search-input')
  await input.fill('아리랑로')
  await input.press('Enter')
  await expect(panel(page).getByTestId('facility-search-results')).toBeVisible()
  await page.getByTestId('panel-tab-map').click()
  await expectNoButtonFor(page)

  // (d) 목록에서 시설 지목(flyTo)
  await page.getByTestId('panel-tab-list').click()
  await panel(page).getByTestId('facility-locate').first().click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expectNoButtonFor(page, 1_200)

  // (e) 끌어서 버튼이 뜬 상태에서 목록 지목 → 비행(약 0.7초) **도중에도** 버튼이 한 프레임도 보이지 않는다.
  //     끝난 뒤 0개인지만 보면 비행 내내 떠 있던 낡은 버튼(누르면 중간 화면으로 검색된다)을 못 잡는다.
  await dragAndSettle(page)
  await expect(areaButton(page)).toBeVisible()
  await expect(page.getByTestId('area-search-live')).toHaveText('이 지역에서 다시 찾을 수 있어요')
  await page.getByTestId('panel-tab-list').click()
  await startButtonFrameSampler(page, 1_500)
  await panel(page).getByTestId('facility-locate').first().click()
  const sample = await buttonFrameSample(page)
  expect(sample.frames, '프레임 표본이 너무 적다').toBeGreaterThan(20)
  expect(sample.visible, `비행 중 버튼이 ${sample.visible}프레임 보였다`).toBe(0)
  await expect(areaButton(page)).toHaveCount(0)
  await expect(page.getByTestId('marker-focused')).toBeVisible()
  // 없는 버튼을 낭독 노드가 계속 말하지 않는다(숨김이면 비운다)
  await expect(page.getByTestId('area-search-live')).toHaveText('')
})

test('3b. 숨은 지도에서 미뤄 둔 화면 맞춤도 앱의 이동 — 지도 탭이 돌아오는 프레임에 낡은 버튼이 없다', async ({ page }) => {
  // 사용자가 먼저 끌어 둔 상태(lastMove=user)에서 목록 탭의 키워드 결과로 점이 바뀌면 맞춤은 0px 라 미뤄진다.
  // 지도 탭으로 돌아오는 커밋이 낡은 버튼을 한 프레임 그린 뒤에야 RO 콜백의 맞춤이 거두면, 곧 옮겨질 옛 화면
  // 위에 버튼이 보인다(50ms 폴링으로는 못 잡는다 — 매 프레임 센다).
  await openMapFor(page, 'P2')
  await dragAndSettle(page)
  await expect(areaButton(page)).toBeVisible()
  const c1 = await mapCenter(page)
  await page.getByTestId('panel-tab-list').click()
  const input = panel(page).getByTestId('facility-search-input')
  await input.fill('아리랑로')
  await input.press('Enter')
  await expect(panel(page).getByTestId('facility-search-results')).toBeVisible()
  await startButtonFrameSampler(page, 1_500)
  await page.getByTestId('panel-tab-map').click()
  const sample = await buttonFrameSample(page)
  expect(sample.frames, '프레임 표본이 너무 적다').toBeGreaterThan(20)
  expect(sample.visible, `미뤄 둔 맞춤 직전 낡은 버튼이 ${sample.visible}프레임 보였다`).toBe(0)
  await expect(areaButton(page)).toHaveCount(0)
  // 미뤄 둔 맞춤은 실제로 실행됐다(키워드 결과 점으로 화면이 옮겨졌다)
  await expect.poll(() => mapCenter(page)).not.toBe(c1)
  await expect(page.getByTestId('area-search-live')).toHaveText('')
})

test('3c. 팝업은 "이 지역에서 다시 찾기" 버튼 위 — 지목 팝업을 연 채 조금 끌어도 이름·닫기(×)가 보이고 ×는 팝업만 닫는다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P2')
  await openPanel(page, 'list')
  await panel(page).getByTestId('facility-locate').first().click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('marker-focused')).toBeVisible()
  const popup = mapBox(page).locator('.maplibregl-popup')
  await expect(popup).toHaveCount(1)
  await waitMoveSettled(page) // 지목 비행(약 0.7초)이 끝날 때까지
  await userScrollToMap(page)

  // 지도 박스 (0.2, 0.85) 지점을 잡고 아래로 12px — 팝업은 열린 채(closeOnMove 아님), 사용자 이동이라 버튼이 뜬다
  const mb = (await mapBox(page).boundingBox())!
  const x0 = mb.x + mb.width * 0.2
  const y0 = mb.y + mb.height * 0.85
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x0, y0 + 12, { steps: 4 })
  await page.mouse.up()
  await waitMoveSettled(page)
  await expect(areaButton(page)).toBeVisible()
  await expect(popup).toHaveCount(1)
  const bb = (await areaButton(page).boundingBox())!
  const pb = (await popup.boundingBox())!
  const overlaps = bb.x < pb.x + pb.width && pb.x < bb.x + bb.width && bb.y < pb.y + pb.height && pb.y < bb.y + bb.height
  expect(overlaps, '준비: 버튼 자리와 팝업이 겹쳐야 한다').toBe(true)

  // 닫기(×)와 시설 이름 가운데의 맨 위 요소는 팝업이다(버튼이 덮지 않는다)
  const topAt = async (loc: Locator) => {
    const b = (await loc.boundingBox())!
    return page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y)
        if (el?.closest('.maplibregl-popup')) return 'popup'
        if (el?.closest('[data-testid="area-search-button"]')) return 'button'
        return el?.tagName ?? null
      },
      [b.x + b.width / 2, b.y + b.height / 2],
    )
  }
  const close = popup.locator('.maplibregl-popup-close-button')
  expect(await topAt(close), '닫기(×)가 버튼 밑에 가렸다').toBe('popup')
  expect(await topAt(popup.locator('.map-popup b')), '시설 이름이 버튼 밑에 가렸다').toBe('popup')

  // ×를 누르면 팝업만 닫힌다 — 범위 검색은 시작되지 않는다
  const cb = (await close.boundingBox())!
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await expect(popup).toHaveCount(0)
  await expect(bar(page)).toHaveCount(0)
  await expect(page.getByTestId('area-search-status')).toHaveText('')
  await expect(areaButton(page)).toBeVisible()
})

test('3d. waitMoveSettled 는 관성 이동이 끝난 뒤(moveend) 돌아온다 — e2e 도구 검증', async ({ page }) => {
  // data-center 는 moveend 에서만 바뀐다. 150px 드래그는 mouseup 뒤 약 0.5초 관성으로 미끄러지는데,
  // "300ms 동안 그대로"만 보면 그 도중에 이동 전 가운데를 들고 돌아왔다.
  await openMapFor(page, 'P2')
  const c0 = await mapCenter(page)
  await dragMap(page, -150, 0)
  await waitMoveSettled(page)
  // 돌아온 **그 순간**의 상태를 읽는다(자동 재시도 단언은 moveend 까지 기다려 버려 도구의 결함을 가린다)
  const at = await mapBox(page).evaluate((el) => ({
    moving: el.getAttribute('data-moving'),
    center: el.getAttribute('data-center'),
  }))
  expect(at.moving, '돌아왔을 때 지도가 아직 움직이는 중이다(관성 도중 반환)').toBe('false')
  const c1 = at.center
  expect(c1, '돌아왔을 때 가운데가 아직 이동 전 값이다(관성 도중 반환)').not.toBe(c0)
  await page.waitForTimeout(800)
  expect(await mapCenter(page), '돌아온 뒤에도 지도가 더 움직였다').toBe(c1)
  await expect(areaButton(page)).toBeVisible()
})

// ───────────────────────────── 4 ─────────────────────────────
test('3e. 원래 결과로(K4): 다시 맞춘 지도 위에 낡은 "이 지역에서 다시 찾기"가 한 프레임도 없다', async ({ page }) => {
  // 결과 뒤 지도를 더 끌어 버튼이 뜬 상태에서 '원래 결과로' → 되돌림 커밋은 끌어 둔 lastMove='user' 를 들고 있었고,
  // 다시 맞춤(fitBounds)은 그 커밋의 effect 에서 동기로 끝나지만 movestart 의 program 표시는 페인트 뒤에 렌더됐다 —
  // 이미 원래 화면(c0)으로 돌아간 지도 위에 버튼이 한 프레임 그려지고, 그 프레임에 누르면 되돌린 범위로 검색이 났다.
  await openMapFor(page, 'P2')
  const c0 = await mapCenter(page)
  await runAreaSearch(page)
  await dragAndSettle(page, 40, 0)
  await expect(areaButton(page)).toBeVisible()
  // '원래 결과로' 클릭 순간(캡처 리스너)부터 매 애니메이션 프레임: 버튼이 보이는가 · 지도 가운데
  await bar(page)
    .getByTestId('area-search-reset')
    .evaluate((reset) => {
      const w = window as unknown as { __k4: { btn: boolean; center: string | null }[] }
      w.__k4 = []
      reset.addEventListener(
        'click',
        () => {
          const end = performance.now() + 600
          const tick = () => {
            const b = document.querySelector<HTMLElement>('[data-testid="area-search-button"]')
            w.__k4.push({
              btn: b != null && b.getClientRects().length > 0,
              center: document.querySelector('[data-testid="nearby-map"]')?.getAttribute('data-center') ?? null,
            })
            if (performance.now() < end) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        },
        { capture: true, once: true },
      )
    })
  await bar(page).getByTestId('area-search-reset').click()
  await page.waitForTimeout(800)
  const frames = await page.evaluate(
    () => (window as unknown as { __k4: { btn: boolean; center: string | null }[] }).__k4,
  )
  expect(frames.length, '표본 프레임이 너무 적다').toBeGreaterThan(5)
  const stale = frames.filter((f) => f.btn)
  expect(stale, `되돌린 뒤 버튼이 보인 프레임: ${JSON.stringify(stale.slice(0, 3))}`).toHaveLength(0)
  await expect(bar(page)).toHaveCount(0)
  expect(await mapCenter(page)).toBe(c0)
  await expect(areaButton(page)).toHaveCount(0)
})

test('4. resize(탭 전환·시트 접기)에도 버튼은 유지된다', async ({ page }) => {
  await openMapFor(page, 'P2')
  await dragAndSettle(page)
  await expect(areaButton(page)).toBeVisible()

  await page.getByTestId('panel-tab-list').click()
  await page.getByTestId('panel-tab-map').click()
  await expect(areaButton(page)).toBeVisible()

  await page.getByTestId('panel-toggle').click() // 접기
  await expect(page.getByTestId('panel-body')).toBeHidden()
  await page.getByTestId('panel-toggle').click() // 펼치기
  await expect(page.getByTestId('panel-body')).toBeVisible()
  await expect(areaButton(page)).toBeVisible()
})

// ───────────────────────────── 5 ─────────────────────────────
test('5. 키보드 경로와 낭독(항상 마운트된 상태 노드 2개)', async ({ page }) => {
  await openMapFor(page, 'P2')
  const status = page.getByTestId('area-search-status')
  const live = page.getByTestId('area-search-live')
  const statusH = await status.elementHandle()
  const liveH = await live.elementHandle()

  // 0. 막아 둔 Shift+화살표(회전)는 변화 없는 easeTo 라 originalEvent 가 달려 와도 사용자 이동이 아니다 —
  //    지도는 그대로인데 버튼이 뜨고 낭독되면 안 된다(결과를 보이기 전, lastMove=none 상태에서 잰다).
  const c0 = await mapCenter(page)
  const z0 = await mapBox(page).getAttribute('data-zoom')
  await mapCanvas(page).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(800)
  expect(await mapCenter(page)).toBe(c0)
  expect(await mapBox(page).getAttribute('data-zoom')).toBe(z0)
  await expect(areaButton(page)).toHaveCount(0)
  await expect(live).toHaveText('')

  // 1. 캔버스 포커스 → 화살표(사용자 이동) → 낭독
  await mapCanvas(page).focus()
  await page.keyboard.press('ArrowRight')
  await waitMoveSettled(page)
  await expect(live).toHaveText('이 지역에서 다시 찾을 수 있어요')

  // 2. Shift+Tab 한 번에 버튼 → Enter → 완료 낭독 + 포커스는 막대
  await page.keyboard.press('Shift+Tab')
  await expect(areaButton(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(status).toHaveText(/이 지도 범위: .*찾음/)
  await expect(bar(page)).toBeFocused()
  // 끝난 로딩("찾는 중이에요")을 낭독 노드에 남기지 않는다
  await expect(live).toHaveText('')

  // 3. 상태가 바뀌어도 같은 노드(항상 마운트)
  expect(await statusH!.evaluate((a, b) => a === b, await status.elementHandle())).toBe(true)
  expect(await liveH!.evaluate((a, b) => a === b, await live.elementHandle())).toBe(true)

  // 4. 회전·박스 줌 막힘
  await mapCanvas(page).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(400)
  await expect(mapBox(page)).toHaveAttribute('data-bearing', '0')
  const z = await mapBox(page).getAttribute('data-zoom')
  await page.keyboard.down('Shift')
  await dragMap(page, 80, 60)
  await page.keyboard.up('Shift')
  await waitMoveSettled(page)
  expect(await mapBox(page).getAttribute('data-zoom')).toBe(z)
  await expect(mapBox(page)).toHaveAttribute('data-bearing', '0')
})

// ───────────────────────────── 6 ─────────────────────────────
test('6. 키워드와 함께: 범위 q · 같은 범위 재검색 · q 빼기 · 되돌리면 키워드 결과', async ({ page }) => {
  await openMapFor(page, 'P2')
  const p = panel(page)
  await page.getByTestId('panel-tab-list').click()
  const input = p.getByTestId('facility-search-input')
  await input.fill('아리랑로')
  await input.press('Enter')
  await expect(p.getByTestId('facility-search-status')).toHaveText('"아리랑로" 2곳 찾음')
  const kwRows = await areaRows(p.getByTestId('facility-search-results')).count()

  // 1. 범위 검색은 키워드 q 를 이어받는다
  await page.getByTestId('panel-tab-map').click()
  await runAreaSearch(page)
  await expect(bar(page).getByTestId('area-search-q')).toHaveText('‘아리랑로’ 포함')
  const c = await mapCenter(page)

  // 2. 범위 모드에서 폼 제출 = 같은 범위를 새 q 로(지도는 그대로)
  await page.getByTestId('panel-tab-list').click()
  await expect(p.getByTestId('facility-search')).toContainText('이 지도 범위 안에서 이름·주소로 찾아요')
  await expect(input).toHaveValue('아리랑로')
  await input.fill('체육')
  await input.press('Enter')
  await expect(bar(page).getByTestId('area-search-q')).toHaveText('‘체육’ 포함')
  expect(await mapCenter(page)).toBe(c)

  // 3. q 빼고 다시 찾기(막대)
  await bar(page).getByTestId('area-search-drop-q').click()
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await expect(bar(page).getByTestId('area-search-q')).toHaveCount(0)
  expect(await mapCenter(page)).toBe(c)
  await expect(input).toHaveValue('')

  // 3b. 폼의 "검색 지우기"도 범위 모드에서는 같은 범위를 q 없이 다시 찾는다(K3)
  await input.fill('체육')
  await input.press('Enter')
  await expect(bar(page).getByTestId('area-search-q')).toHaveText('‘체육’ 포함')
  await p.getByTestId('facility-search-clear').click()
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await expect(bar(page).getByTestId('area-search-q')).toHaveCount(0)
  await expect(p.getByTestId('area-search-results')).toBeVisible()
  expect(await mapCenter(page)).toBe(c)

  // 4. 원래 결과로 → 키워드 결과가 다시
  await bar(page).getByTestId('area-search-reset').click()
  await expect(p.getByTestId('area-search-results')).toHaveCount(0)
  await expect(p.getByTestId('facility-search-results')).toBeVisible()
  await expect(p.getByTestId('facility-search-status')).toHaveText('"아리랑로" 2곳 찾음')
  expect(await areaRows(p.getByTestId('facility-search-results')).count()).toBe(kwRows)
  await expect(input).toHaveValue('아리랑로')
  await expect(page.getByTestId('panel-tab-list')).toBeFocused()

  // 5. 검색 지우기 → 근처 목록
  await p.getByTestId('facility-search-clear').click()
  await expect(p.getByTestId('facility-search-results')).toHaveCount(0)
  await expect(p.getByRole('heading', { level: 2 })).toHaveText('근처 자원')
})

// ───────────────────────────── 7 ─────────────────────────────
test('7. 장애 있음: 공공·대안은 ‘장애’ 표기와 관계없이 모두 보인다는 안내 + 내 지역 기준', async ({ page }) => {
  await openMapFor(page, 'P5')
  // 첫 맞춤이 좁아(장애인 가맹 6곳이 한 점) 두 단계 넓혀 공공 시설이 범위에 들어오게 한다(사용자 이동).
  const zoomOut = mapBox(page).getByRole('button', { name: '축소' })
  await zoomOut.click()
  await waitMoveSettled(page)
  await zoomOut.click()
  await waitMoveSettled(page)
  await expect(areaButton(page)).toBeVisible()
  await areaButton(page).click()
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await expect(bar(page).getByTestId('area-bar-disability-note')).toHaveText(
    '공공·대안은 ‘장애’ 표기와 관계없이 모두 보여요',
  )
  await expect(page.getByTestId('panel-count-basis')).toHaveText('내 지역 기준')
  await expect(bar(page).getByTestId('area-search-counts')).toContainText('장애인 가맹')
  await page.getByTestId('panel-tab-list').click()
  await expect(panel(page).getByTestId('area-search-alt-section')).toBeVisible()
  await expect(panel(page).getByTestId('area-alt-disability-note')).toContainText(
    '이용할 수 있는지는 시설에 확인해 주세요.',
  )
})

// ───────────────────────────── 8 · 라이브 응답 주입 ─────────────────────────────
const L_SIGUNGU = [{ cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 }]
const L_PERSONAS = [
  {
    id: 'P1',
    label: '테스트 페르소나',
    summary: '지도 범위 검색 검증',
    age: 27,
    sex: 'M',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    income_class: '기초생활수급',
    disability: { has: false, type: null },
    location: { lat: 37.6057, lon: 127.017 },
  },
]
const L_ASSESS = {
  eligibility: [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: false,
      reasons: [{ field: 'age', ok: false, message: '테스트: 연령 초과' }],
      benefit: '테스트',
      apply: { how: '온라인 신청', url: 'https://svoucher.kspo.or.kr', docs: ['신분증'] },
      source: { url: 'https://svoucher.kspo.or.kr', checked: '2026-07-21' },
      verified: true,
    },
  ],
  path: [{ from: 'person', to: 'svoucher', edge: '자격', result: 'fail', label: '테스트 경로' }],
  nearby: {
    voucher_facilities: [
      {
        id: 'V01',
        name: '성북스포츠클럽',
        sports: ['수영'],
        lat: 37.6061,
        lon: 127.0242,
        coord_source: 'centroid',
        dist_km: null,
        sigungu_nm: '성북구',
        fee_month: 95000,
        subsidy: 0,
        copay: 95000,
        disability_support: null,
        source: 'voucher',
      },
    ],
    alternatives: [
      {
        id: 'P01',
        name: '성북구민체육센터',
        type: '공공체육시설',
        sports: ['요가'],
        lat: 37.6046,
        lon: 127.0413,
        coord_source: 'api',
        dist_km: 1.6,
        sigungu_nm: '성북구',
        note: '테스트 대안',
        disability_support: true,
        fee_month: 30000,
        source: 'public',
        faci_gb: '공공',
      },
    ],
    primary: 'alternatives',
  },
  supply_gap: {
    radius_km: 3,
    voucher_count: 1,
    voucher_scope: 'sigungu',
    sigungu_nm: '성북구',
    alt_count: 1,
    nearest: null,
    message: '테스트 · 성북구 가맹 1곳',
    coverage: null,
  },
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

interface UA {
  sigungu_cd: string
  label: string
  count: number
  display_label?: string
  scope_codes?: string[]
}

function ua(a: UA) {
  return {
    sigungu_cd: a.sigungu_cd,
    sigungu_nm: a.label,
    sido_nm: null,
    label: a.label,
    display_label: a.display_label ?? a.label,
    scope_codes: a.scope_codes ?? [a.sigungu_cd],
    count: a.count,
    included_by: ['center'],
  }
}

function boundsOf(url: URL) {
  const p = url.searchParams
  return {
    min_lat: Number(p.get('min_lat')),
    min_lon: Number(p.get('min_lon')),
    max_lat: Number(p.get('max_lat')),
    max_lon: Number(p.get('max_lon')),
  }
}

// 범위 안에 실좌표 행을 흩어 놓는다(서로 다른 좌표 — 마커 묶음 없이).
function spot(url: URL, i: number) {
  const b = boundsOf(url)
  const f = ((i % 7) + 1) / 9
  const g = ((Math.floor(i / 7) % 7) + 1) / 9
  return {
    lat: b.min_lat + (b.max_lat - b.min_lat) * f,
    lon: b.min_lon + (b.max_lon - b.min_lon) * g,
  }
}

function vRow(url: URL, i: number) {
  return {
    id: `GV${i}`,
    name: `테스트가맹${i}`,
    source: 'voucher',
    sports: ['수영'],
    ...spot(url, i),
    coord_source: 'geocoded',
    dist_km: null,
    sigungu_nm: '성북구',
    fee_month: 90000,
    subsidy: null,
    copay: null,
    disability_support: null,
    addr: `서울 성북구 테스트로 ${i + 1}`,
  }
}

function pRow(url: URL, i: number) {
  return {
    id: `GP${i}`,
    name: `테스트공공${i}`,
    type: '공공체육시설',
    sports: ['배드민턴'],
    ...spot(url, i + 3),
    coord_source: 'api',
    dist_km: null,
    sigungu_nm: '성북구',
    faci_gb: '공공',
    note: '',
    disability_support: false,
    addr: `서울 성북구 공공로 ${i + 1}`,
  }
}

function areaBody(
  url: URL,
  opt: { total: number; rows?: unknown[]; areas?: ReturnType<typeof ua>[]; truncated?: boolean },
) {
  const p = url.searchParams
  const b = boundsOf(url)
  const q = p.get('q')
  const rows = opt.rows ?? []
  const areas = opt.areas ?? []
  return {
    bounds: b,
    center: { lat: (b.min_lat + b.max_lat) / 2, lon: (b.min_lon + b.max_lon) / 2 },
    diag_km: 3.2,
    max_diag_km: 20,
    program: p.get('program'),
    q,
    tokens: q ? q.split(' ') : [],
    match_fields: ['name', 'addr'],
    coord_sources: ['api', 'geocoded'],
    coord_rules: {
      placeholder_min_areas: 3,
      suspect_max_km: 40,
      robust_min_rows: 5,
      geocoded_requires_building_no: true,
      shared_point_min_names: 2,
    },
    order: 'center_distance',
    eligibility_applied: false,
    total: opt.total,
    truncated: opt.truncated ?? opt.total > rows.length,
    facilities: rows,
    unlocated: { total: areas.reduce((s, a) => s + a.count, 0), count_basis: 'whole_area', areas },
  }
}

type AreaReply = { status: number; body: unknown; delayMs?: number }
type AreaHandler = (program: string, url: URL) => AreaReply

interface Live {
  setArea: (h: AreaHandler) => void
  areaUrls: URL[]
  searchUrls: URL[]
  setSearchDelay: (ms: number) => void
}

async function openLiveMap(page: Page, opts: { disability?: boolean } = {}): Promise<Live> {
  let handler: AreaHandler = (_program, url) => ({ status: 200, body: areaBody(url, { total: 0 }) })
  let searchDelay = 0
  const areaUrls: URL[] = []
  const searchUrls: URL[] = []
  await page.route('**/api/meta/sigungu', (r) => json(r, L_SIGUNGU))
  const personas = opts.disability
    ? L_PERSONAS.map((x) => ({ ...x, disability: { has: true, type: '지체' } }))
    : L_PERSONAS
  await page.route('**/api/demo/personas', (r) => json(r, personas))
  await page.route('**/api/health', (r) => json(r, { status: 'ok', data_built: '2026-07-15' }))
  await page.route('**/api/chat/faq', (r) => json(r, []))
  await page.route('**/api/fitness/items**', (r) =>
    json(r, { age: 27, age_group: '성인', age_gap: false, basis: 'test', items: [] }),
  )
  await page.route('**/api/accessibility**', (r) => json(r, {}))
  await page.route('**/api/assess', (r) => json(r, L_ASSESS))
  await page.route('**/api/facilities/search**', async (route) => {
    const url = new URL(route.request().url())
    searchUrls.push(url)
    if (searchDelay) await new Promise((res) => setTimeout(res, searchDelay))
    const program = url.searchParams.get('program')!
    const q = url.searchParams.get('q')!
    const rows =
      program === 'public'
        ? [
            {
              id: 'SP1',
              name: '검색공공체육관',
              type: '공공체육시설',
              sports: ['탁구'],
              lat: 37.6008,
              lon: 127.0117,
              coord_source: 'api',
              dist_km: 1.2,
              sigungu_nm: '성북구',
              faci_gb: '공공',
              note: '',
              disability_support: false,
              addr: '서울 성북구 아리랑로 82',
            },
          ]
        : []
    await json(route, {
      sigungu_cd: url.searchParams.get('sigungu_cd'),
      sigungu_nm: null,
      scope_codes: [url.searchParams.get('sigungu_cd')],
      scope_label: null,
      program,
      q,
      tokens: q.split(' '),
      match_fields: ['name', 'addr'],
      eligibility_applied: false,
      total: rows.length,
      truncated: false,
      facilities: rows,
    })
  })
  await page.route('**/api/facilities/in-bounds**', async (route) => {
    const url = new URL(route.request().url())
    areaUrls.push(url)
    const r = handler(url.searchParams.get('program')!, url)
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs))
    await json(route, r.body, r.status)
  })

  await page.goto('/?live=1#/demo')
  await expect(stream(page)).toBeVisible()
  await page.getByTestId('chip-persona-P1').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(page.getByTestId('chip-act-restart')).toBeVisible()
  await openPanel(page, 'map')
  await waitForMapIdle(page)
  await userScrollToMap(page)
  return {
    setArea: (h) => {
      handler = h
    },
    areaUrls,
    searchUrls,
    setSearchDelay: (ms) => {
      searchDelay = ms
    },
  }
}

async function resetArea(page: Page) {
  await page.getByTestId('panel-tab-map').click()
  await bar(page).getByTestId('area-search-reset').click()
  await expect(bar(page)).toHaveCount(0)
}

test('8a. 라이브: 쿼리 · 잘림 · 창원형 · A2형 · 중립', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)

  // 잘림: 이용권 1,234곳 중 50곳(실좌표 geocoded), 공공 1곳
  live.setArea((program, url) =>
    program === 'svoucher'
      ? { status: 200, body: areaBody(url, { total: 1234, rows: Array.from({ length: 50 }, (_, i) => vRow(url, i)) }) }
      : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await runAreaSearch(page)
  // 요청 쿼리: 범위 네 값 + program (키워드가 없으면 q 없음)
  expect(live.areaUrls.length).toBe(2)
  for (const u of live.areaUrls) {
    for (const k of ['min_lat', 'min_lon', 'max_lat', 'max_lon', 'program']) expect(u.searchParams.has(k), k).toBe(true)
    expect(u.searchParams.has('q')).toBe(false)
    expect(u.searchParams.get('limit')).toBe('50')
  }
  expect(live.areaUrls.map((u) => u.searchParams.get('program')).sort()).toEqual(['public', 'svoucher'])
  // 같은 종류·같은 좌표는 한 마커로 묶고 개수 배지(좌표를 흩뜨리지 않는다)
  const grouped = areaMarkers(page).and(page.locator('[data-count="2"]'))
  await expect(grouped).toHaveCount(1)
  await expect(grouped.locator('.marker-count')).toHaveText('2')
  await expect(grouped).toHaveAttribute('aria-label', /^같은 자리 2곳 · 이용권 가맹 · /)
  await shotIf(page, '390-live-truncated-map', panel(page))
  await expect(bar(page).getByTestId('area-search-counts')).toHaveText('이용권 가맹 1,234곳 · 공공·대안 1곳')
  await expect(bar(page).getByTestId('area-search-map-cap')).toContainText('지도에는 가운데에서 가까운 51곳만 찍었어요')
  expect(await areaCountSum(page)).toBe(51)
  await page.getByTestId('panel-tab-list').click()
  const vs = p.getByTestId('area-search-voucher-section')
  await expect(vs).toContainText('1,234곳 중 50곳 표시')
  await expect(vs.getByTestId('area-search-truncated-note')).toHaveText(
    '지도를 더 확대한 뒤 다시 찾으면 빠진 곳도 볼 수 있어요',
  )
  await expect(vs.getByTestId('search-fee-note')).toBeVisible()
  const txt = await p.getByTestId('area-search-results').innerText()
  expect(txt).not.toMatch(/\d(\.\d)?km/)
  expect(txt).not.toContain('도보')
  await resetArea(page)

  // 창원형: 이용권 0 + [48120 창원시 638] · 공공 3
  live.setArea((program, url) =>
    program === 'svoucher'
      ? { status: 200, body: areaBody(url, { total: 0, areas: [ua({ sigungu_cd: '48120', label: '창원시', count: 638 })] }) }
      : { status: 200, body: areaBody(url, { total: 303, rows: [0, 1, 2].map((i) => pRow(url, i)) }) },
  )
  await runAreaSearch(page)
  await expect(bar(page).getByTestId('area-unlocated')).toHaveText(
    /창원시 이용권 가맹시설 638곳은 정확한 위치를 확인할 수 없어 지도에 없어요 · 시군구 전체 수/,
  )
  await expect(bar(page).getByTestId('area-unlocated')).toContainText('창원시 안에서 찾기')
  await page.getByTestId('panel-tab-list').click()
  const zero = p.locator('[data-testid="area-section-zero"][data-program="svoucher"]')
  await expect(zero).toHaveText('위치가 확인된 이용권 가맹시설 0곳')
  const next = zero.locator('xpath=following-sibling::*[1]')
  await expect(next).toHaveAttribute('data-testid', 'area-unlocated-block')
  await expect(next).toContainText('창원시 이용권 가맹시설 638곳은 정확한 위치를 확인할 수 없어 지도에 없어요')
  await expect(next).toContainText('겹치는 시군구 일부는 빠질 수 있어요')
  await expect(p.getByTestId('area-search-alt-section')).toContainText('303곳 중 3곳 표시')
  await shotIf(page, '390-live-changwon-list', p)
  await resetArea(page)

  // A2형: 이용권 0 [] + 공공 1 → 이용권 일반 안내(목록·막대), 버튼에 내 시군구
  live.setArea((program, url) =>
    program === 'svoucher'
      ? { status: 200, body: areaBody(url, { total: 0 }) }
      : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await runAreaSearch(page)
  const guideBar = bar(page).getByTestId('area-voucher-guide')
  await expect(guideBar).toContainText('이용권 가맹시설은 대부분 정확한 위치가 없어 지도 범위로는 찾기 어려워요')
  await expect(guideBar.getByRole('button')).toHaveText('성북구 안에서 찾기')
  await page.getByTestId('panel-tab-list').click()
  await expect(p.getByTestId('area-search-results').getByTestId('area-voucher-guide')).toBeVisible()
  await expect(p.getByTestId('area-search-results').getByTestId('area-search-zero')).toHaveCount(0)
  await resetArea(page)

  // 중립: 둘 다 0 [] → 원인을 단정하지 않는다(일반 안내 없음)
  live.setArea((_program, url) => ({ status: 200, body: areaBody(url, { total: 0 }) }))
  await runAreaSearch(page)
  await expect(bar(page).getByTestId('area-search-zero')).toContainText('이 지도 범위에서 찾은 시설이 없어요.')
  await expect(bar(page).getByTestId('area-voucher-guide')).toHaveCount(0)
  await page.getByTestId('panel-tab-list').click()
  const res = p.getByTestId('area-search-results')
  await expect(res.getByTestId('area-search-zero')).toBeVisible()
  await expect(res.getByTestId('area-voucher-guide')).toHaveCount(0)
  await expect(res.getByTestId('area-search-voucher-section')).toHaveCount(0)
})

test('8b. 라이브: 두 영역 → 주소로 찾기(범위 덮어쓰기·거리 없음) → 내 지역으로', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)
  // 키워드를 켠 상태에서 범위 검색 → 쿼리에 q
  await page.getByTestId('panel-tab-list').click()
  const input = p.getByTestId('facility-search-input')
  await input.fill('수영')
  await input.press('Enter')
  await expect(p.getByTestId('facility-search-results')).toBeVisible()
  // 내 시군구 검색은 거리 원점을 보낸다(대조군)
  expect(live.searchUrls.at(-1)!.searchParams.has('lat')).toBe(true)
  await page.getByTestId('panel-tab-map').click()

  live.setArea((program, url) =>
    program === 'svoucher'
      ? {
          status: 200,
          body: areaBody(url, {
            total: 0,
            areas: [
              ua({ sigungu_cd: '28237', label: '부평구', count: 283 }),
              ua({ sigungu_cd: '28245', label: '계양구', count: 169 }),
            ],
          }),
        }
      : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  live.areaUrls.length = 0
  await runAreaSearch(page)
  expect(live.areaUrls.every((u) => u.searchParams.get('q') === '수영')).toBe(true)
  await expect(bar(page).getByTestId('area-unlocated')).toContainText(
    '부평구 등 시군구 2곳의 이용권 가맹시설 ‘수영’ 포함 452곳은 정확한 위치를 확인할 수 없어 지도에 없어요 · 시군구 전체 수',
  )
  // 영역이 여럿이면 "위치 확인 안 된 곳 보기" → 목록 탭의 이용권 블록으로 포커스
  await bar(page).getByRole('button', { name: '위치 확인 안 된 곳 보기' }).click()
  await expect(page.getByTestId('panel-tab-list')).toHaveAttribute('aria-selected', 'true')
  const block = p.locator('[data-testid="area-unlocated-block"][data-program="svoucher"]')
  await expect(block).toBeFocused()
  const btns = block.getByTestId('area-unlocated-search')
  await expect(btns).toHaveCount(2)
  const labels = await btns.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(labels).toEqual(['부평구에서 이름·주소로 찾기', '계양구에서 이름·주소로 찾기'])
  await shotIf(page, '390-live-two-areas', p)

  // 하나를 누르면: 목록 탭 · 도움말 "{부평구} 안에서" · 요청은 그 시군구·범위 q·거리 원점 없음
  live.searchUrls.length = 0
  await btns.first().click()
  await expect(p.getByTestId('area-search-results')).toHaveCount(0)
  await expect(p.getByTestId('facility-search')).toContainText('부평구 안에서 시설 이름·주소로 찾아요')
  await expect(p.getByTestId('facility-search-results')).toBeVisible()
  await expect(input).toHaveValue('수영')
  await expect(input).toBeFocused()
  expect(live.searchUrls.length).toBeGreaterThanOrEqual(2)
  for (const u of live.searchUrls) {
    expect(u.searchParams.get('sigungu_cd')).toBe('28237')
    expect(u.searchParams.get('q')).toBe('수영')
    expect(u.searchParams.has('lat')).toBe(false)
    expect(u.searchParams.has('lon')).toBe(false)
  }
  const kw = await p.getByTestId('facility-search-results').innerText()
  expect(kw).toContain('검색공공체육관')
  expect(kw).not.toMatch(/\d(\.\d)?km/)
  expect(kw).not.toContain('도보')

  // 내 지역으로 → 도움말 원래대로 · 결과 지움 · 입력칸 q 는 남김
  await p.getByTestId('facility-search-scope-reset').click()
  await expect(p.getByTestId('facility-search')).toContainText('성북구 안에서 시설 이름·주소로 찾아요')
  await expect(p.getByTestId('facility-search-results')).toHaveCount(0)
  await expect(p.getByTestId('facility-search-scope-reset')).toHaveCount(0)
  await expect(input).toHaveValue('수영')

  // 대상의 scope_codes 에 내 시군구가 있으면 덮어쓰지 않는다
  live.setArea((program, url) =>
    program === 'svoucher'
      ? {
          status: 200,
          body: areaBody(url, {
            total: 0,
            areas: [ua({ sigungu_cd: '11305', label: '성북·강북 일대', count: 7, scope_codes: ['11305', '11290'] })],
          }),
        }
      : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await page.getByTestId('panel-tab-map').click()
  await runAreaSearch(page)
  await page.getByTestId('panel-tab-list').click()
  await p.getByTestId('area-unlocated-search').click()
  await expect(p.getByTestId('facility-search')).toContainText('성북구 안에서 시설 이름·주소로 찾아요')
  await expect(p.getByTestId('facility-search-scope-reset')).toHaveCount(0)
})

test('8e. 라이브: 검색어 없이 다른 시군구 "주소로 찾기" → 내 지역 목록을 그 시군구 결과처럼 두지 않는다', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)
  live.setArea((program, url) =>
    program === 'svoucher'
      ? {
          status: 200,
          body: areaBody(url, {
            total: 0,
            areas: [
              ua({ sigungu_cd: '11410', label: '서대문구', count: 142 }),
              ua({ sigungu_cd: '11380', label: '은평구', count: 230 }),
            ],
          }),
        }
      : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await runAreaSearch(page)
  await bar(page).getByRole('button', { name: '위치 확인 안 된 곳 보기' }).click()
  const block = p.locator('[data-testid="area-unlocated-block"][data-program="svoucher"]')
  await expect(block).toBeFocused()
  live.searchUrls.length = 0
  await block.getByRole('button', { name: '서대문구에서 이름·주소로 찾기' }).click()

  // 도움말은 "서대문구 안에서" — 그 밑에 성북구(내 지역) 목록·거리·도보가 오면 서대문구 결과처럼 읽힌다
  const input = p.getByTestId('facility-search-input')
  await expect(p.getByTestId('facility-search')).toContainText('서대문구 안에서 시설 이름·주소로 찾아요')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  const pending = p.getByTestId('facility-search-scope-pending')
  await expect(pending).toHaveText(
    '서대문구 안에서 찾을 시설 이름이나 주소를 입력해 주세요 · 내 지역 근처 목록은 ‘내 지역으로’를 누르면 다시 보여요',
  )
  await expect(p.getByTestId('voucher-section')).toHaveCount(0)
  await expect(p.getByTestId('alt-facility')).toHaveCount(0)
  const listText = await p.locator('[role="tabpanel"]:not([hidden])').innerText()
  expect(listText).not.toContain('성북구민체육센터')
  expect(listText).not.toMatch(/\d(\.\d)?km/)
  expect(listText).not.toContain('도보')
  expect(live.searchUrls).toHaveLength(0) // 검색어가 없으니 요청도 없다
  await shotIf(page, '390-live-scope-pending', p)

  // 덮어쓴 채 검색 → 그 시군구 결과(거리 없음) → "검색 지우기"면 다시 안내(내 지역 목록 아님)
  await input.fill('체육')
  await input.press('Enter')
  await expect(p.getByTestId('facility-search-results')).toBeVisible()
  expect(live.searchUrls.every((u) => u.searchParams.get('sigungu_cd') === '11410')).toBe(true)
  await expect(pending).toHaveCount(0)
  await p.getByTestId('facility-search-clear').click()
  await expect(p.getByTestId('facility-search-results')).toHaveCount(0)
  await expect(pending).toBeVisible()
  await expect(p.getByTestId('alt-facility')).toHaveCount(0)

  // 내 지역으로 → 안내가 사라지고 내 지역 근처 목록이 돌아온다
  await p.getByTestId('facility-search-scope-reset').click()
  await expect(pending).toHaveCount(0)
  await expect(p.getByTestId('facility-search')).toContainText('성북구 안에서 시설 이름·주소로 찾아요')
  await expect(p.getByTestId('alt-facility').first()).toContainText('성북구민체육센터')
})

test('8c. 라이브: 부분 실패 · 전부 실패 → 다시 시도 · 422 너무 넓음', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)

  // 이용권 500 + 공공 200 → 부분 실패(이용권 쪽 0건·안내 없음)
  live.setArea((program, url) =>
    program === 'svoucher'
      ? { status: 500, body: { error: { code: 'INTERNAL', message: '서버 내부 오류' } } }
      : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await runAreaSearch(page)
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await expect(bar(page).getByTestId('area-search-partial')).toHaveText(
    '이용권 가맹시설 찾기가 실패해 공공·대안 시설만 보여요.',
  )
  await expect(bar(page).getByTestId('area-search-counts')).toHaveText('이용권 가맹 확인 실패 · 공공·대안 1곳')
  await expect(bar(page).getByTestId('area-voucher-guide')).toHaveCount(0)
  await expect(page.getByTestId('area-search-status')).toContainText('이용권 가맹 확인 실패')
  await page.getByTestId('panel-tab-list').click()
  const res = p.getByTestId('area-search-results')
  await expect(res.getByTestId('area-section-failed')).toHaveText('이용권 가맹시설을 확인하지 못했어요')
  await expect(res.locator('[data-testid="area-section-zero"][data-program="svoucher"]')).toHaveCount(0)
  await expect(res.getByTestId('area-voucher-guide')).toHaveCount(0)
  await shotIf(page, '390-live-partial', p)
  await resetArea(page)

  // 둘 다 500 → 오류 + 포커스는 막대 → 다시 시도로 성공
  let fail = true
  live.setArea((program, url) =>
    fail
      ? { status: 500, body: { error: { code: 'INTERNAL', message: '서버 내부 오류' } } }
      : program === 'svoucher'
        ? { status: 200, body: areaBody(url, { total: 0 }) }
        : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await runAreaSearch(page)
  await expect(bar(page)).toHaveAttribute('data-status', 'error')
  await expect(bar(page)).toContainText('이 지역을 찾지 못했어요: 서버 내부 오류')
  await expect(bar(page)).toBeFocused()
  await expect(page.getByTestId('area-search-status')).toHaveText('이 지역을 찾지 못했어요: 서버 내부 오류')
  fail = false
  // 다시 시도 뒤 로딩 동안 포커스는 그 버튼에(aria-disabled — disabled 로 바꾸면 포커스가 날아간다)
  const slowOk = (program: string, url: URL): AreaReply =>
    program === 'svoucher'
      ? { status: 200, delayMs: 1_200, body: areaBody(url, { total: 0 }) }
      : { status: 200, delayMs: 1_200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) }
  live.setArea(slowOk)
  const retry = bar(page).getByTestId('area-search-retry')
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(bar(page)).toHaveAttribute('data-status', 'loading')
  await expect(retry).toBeFocused()
  await expect(retry).toHaveAttribute('aria-disabled', 'true')
  await expect(retry).toHaveAttribute('aria-busy', 'true')
  await expect(bar(page)).toHaveAttribute('data-status', 'done', { timeout: 5_000 })
  await expect(bar(page).getByTestId('area-search-counts')).toHaveText('이용권 가맹 0곳 · 공공·대안 1곳')
  await expect(bar(page)).toBeFocused()
  await resetArea(page)

  // 429 요청 과다 → "잠시 후 다시 시도" 안내와 함께 다시 시도 버튼이 있다(누르면 성공)
  let limited = true
  live.setArea((program, url) =>
    limited
      ? { status: 429, body: { error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' } } }
      : program === 'svoucher'
        ? { status: 200, body: areaBody(url, { total: 0 }) }
        : { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) },
  )
  await runAreaSearch(page)
  await expect(bar(page)).toHaveAttribute('data-status', 'error')
  await expect(bar(page)).toContainText('이 지역을 찾지 못했어요: 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
  await expect(areaButton(page)).toHaveCount(0) // 지도 위 버튼은 거둬졌다 — 막대의 다시 시도가 유일한 수단
  const retry429 = bar(page).getByTestId('area-search-retry')
  await expect(retry429).toBeVisible()
  limited = false
  await retry429.click()
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await expect(bar(page).getByTestId('area-search-counts')).toHaveText('이용권 가맹 0곳 · 공공·대안 1곳')
  await resetArea(page)

  // 422 AREA_TOO_WIDE → 다시 시도 없음 · 확대 안내
  live.setArea(() => ({
    status: 422,
    body: { error: { code: 'AREA_TOO_WIDE', message: '지도 범위가 너무 넓어요(대각선 약 24.3km, 최대 20km). 지도를 조금 더 확대해 주세요.' } },
  }))
  await runAreaSearch(page)
  await expect(bar(page)).toHaveAttribute('data-status', 'error')
  await expect(bar(page).getByTestId('area-search-retry')).toHaveCount(0)
  await expect(bar(page)).toContainText('지도를 조금 더 확대해 주세요')
})

test('8f. 라이브: 장애 있음 + 공공 실패 → "공공·대안은 모두 보여요" 안내를 실패 문구 옆에 두지 않는다', async ({ page }) => {
  const live = await openLiveMap(page, { disability: true })
  const p = panel(page)
  const failPublic: AreaHandler = (program, url) =>
    program === 'public'
      ? { status: 500, body: { error: { code: 'INTERNAL', message: '서버 내부 오류' } } }
      : { status: 200, body: areaBody(url, { total: 0, areas: [ua({ sigungu_cd: '11290', label: '성북구', count: 55 })] }) }
  live.setArea(failPublic)
  await runAreaSearch(page)
  // 장애 있음 → 주 이용권은 dvoucher(클라이언트는 5xx 를 한 번 더 시도하므로 public 은 두 번 올 수 있다)
  expect([...new Set(live.areaUrls.map((u) => u.searchParams.get('program')))].sort()).toEqual(['dvoucher', 'public'])
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await expect(bar(page).getByTestId('area-search-partial')).toHaveText(
    '공공·대안 시설 찾기가 실패해 장애인 가맹시설만 보여요.',
  )
  // "공공·대안은 ‘장애’ 표기와 관계없이 모두 보여요"는 공공을 못 찾은 사실과 서로 반박한다
  await expect(bar(page).getByTestId('area-bar-disability-note')).toHaveCount(0)
  await expect(bar(page)).not.toContainText('모두 보여요')
  await expect(page.getByTestId('panel-count-basis')).toHaveText('내 지역 기준')
  await page.getByTestId('panel-tab-list').click()
  const res = p.getByTestId('area-search-results')
  await expect(res.locator('[data-testid="area-section-failed"][data-program="public"]')).toHaveText(
    '공공·대안 시설을 확인하지 못했어요',
  )
  await expect(res.getByTestId('area-alt-disability-note')).toHaveCount(0)
  await expect(res).not.toContainText('모두 보여요')
  await resetArea(page)

  // 대조: 공공이 성공하면 두 안내가 제자리에 있다
  live.setArea((program, url) =>
    program === 'public'
      ? { status: 200, body: areaBody(url, { total: 1, rows: [pRow(url, 0)] }) }
      : failPublic(program, url),
  )
  await runAreaSearch(page)
  await expect(bar(page).getByTestId('area-search-partial')).toHaveCount(0)
  await expect(bar(page).getByTestId('area-bar-disability-note')).toHaveText(
    '공공·대안은 ‘장애’ 표기와 관계없이 모두 보여요',
  )
  await page.getByTestId('panel-tab-list').click()
  await expect(p.getByTestId('area-alt-disability-note')).toContainText('이용할 수 있는지는 시설에 확인해 주세요.')
})

test('8d. 라이브: 로딩 중 이동 · 늦은 응답 버리기 · 키워드 응답 경쟁', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)
  const slow: AreaHandler = (program, url) => ({
    status: 200,
    delayMs: 1_500,
    body:
      program === 'svoucher'
        ? areaBody(url, { total: 0 })
        : areaBody(url, { total: 1, rows: [pRow(url, 0)] }),
  })

  // 로딩 중에 지도를 움직이면 버튼이 다시 살아나고, 끝난 뒤 제목은 "찾았던 범위"
  live.setArea(slow)
  await dragAndSettle(page)
  await areaButton(page).click()
  await expect(areaButton(page)).toHaveText('이 지역에서 찾는 중…')
  await expect(areaButton(page)).toHaveAttribute('aria-disabled', 'true')
  await dragAndSettle(page, -40, 30)
  await expect(areaButton(page)).toHaveText('이 지역에서 다시 찾기')
  await expect(bar(page)).toHaveAttribute('data-status', 'done', { timeout: 5_000 })
  await expect(areaButton(page)).toBeVisible()
  await expect(bar(page)).toContainText('찾았던 범위')
  await resetArea(page)

  // 늦은 응답 버리기: 누르고 곧바로 원래 결과로 → 응답이 와도 막대·범위 마커 없음
  await dragAndSettle(page)
  await areaButton(page).click()
  await expect(bar(page)).toHaveAttribute('data-status', 'loading')
  await bar(page).getByTestId('area-search-reset').click()
  await page.waitForTimeout(2_000)
  await expect(bar(page)).toHaveCount(0)
  await expect(areaMarkers(page)).toHaveCount(0)
  await expect(page.getByTestId('panel-count-basis')).toHaveCount(0)

  // 키워드 응답 경쟁: 키워드 응답이 범위 결과 뒤에 와도 지도는 튀지 않는다
  live.setArea((program, url) => ({
    status: 200,
    body:
      program === 'svoucher'
        ? areaBody(url, { total: 0 })
        : areaBody(url, { total: 1, rows: [pRow(url, 0)] }),
  }))
  live.setSearchDelay(1_500)
  await page.getByTestId('panel-tab-list').click()
  await p.getByTestId('facility-search-input').fill('탁구')
  await p.getByTestId('facility-search-input').press('Enter')
  await page.getByTestId('panel-tab-map').click()
  await runAreaSearch(page)
  const c = await mapCenter(page)
  await page.waitForTimeout(2_000) // 키워드 응답 도착
  expect(await mapCenter(page)).toBe(c)
  await expect(nonAreaMarkers(page)).toHaveCount(0)
  await expect(areaMarkers(page).first()).toBeVisible()
})

test('8g. 라이브: 첫 범위 검색이 둘 다 실패(prev 없음)한 동안 늦게 온 키워드 결과도 지도에서 지목된다', async ({ page }) => {
  // 범위 결과가 없으면 목록은 늦게 온 키워드 결과로 바뀐다. 지도가 옛 기본 마커로 동결돼 있으면 그 행의 "지도에서 보기"는
  // 지도 탭으로만 바뀌고 확대·팝업·강조가 없다(지목 색인에 그 시설이 없다) — 목록과 지도가 같은 것을 보여야 한다.
  const live = await openLiveMap(page)
  const p = panel(page)
  live.setArea(() => ({ status: 500, body: { error: { code: 'INTERNAL', message: '서버에 일시적인 문제가 발생했습니다.' } } }))
  live.setSearchDelay(2_500)
  await page.getByTestId('panel-tab-list').click()
  await p.getByTestId('facility-search-input').fill('탁구')
  await p.getByTestId('facility-search-input').press('Enter')
  await page.getByTestId('panel-tab-map').click()
  await dragAndSettle(page)
  await areaButton(page).click()
  await expect(bar(page)).toHaveAttribute('data-status', 'error')
  const c = await mapCenter(page)

  await page.getByTestId('panel-tab-list').click()
  const locate = p
    .getByTestId('facility-search-results')
    .getByRole('button', { name: '검색공공체육관 지도에서 보기' })
  await expect(locate).toBeVisible({ timeout: 8_000 })
  // 늦게 온 키워드 결과가 와도 카메라는 그대로(범위 모드 — 화면 맞춤 없음)
  expect(await mapCenter(page)).toBe(c)
  await locate.click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')
  await expect(mapBox(page).getByTestId('marker-focused')).toHaveCount(1)
  await expect(mapBox(page).locator('.maplibregl-popup')).toContainText('검색공공체육관')
  await expect.poll(() => mapCenter(page), { message: '지목했는데 지도가 움직이지 않았다' }).not.toBe(c)
  // 범위 막대(오류)는 그대로 — 같은 범위를 다시 시도할 수 있다
  await expect(bar(page)).toHaveAttribute('data-status', 'error')
  await expect(bar(page).getByTestId('area-search-retry')).toBeVisible()
})

// 목록 탭 스크롤 칸 맨 위의 sticky 결과 막대(목록 탭이 보일 때 그 탭 패널 안의 막대 — 막대는 활성 탭에만 그린다).
function listBar(page: Page): Locator {
  return panel(page).locator('[role="tabpanel"]:not([hidden]) [data-testid="area-search-bar"]')
}

test('8h. 라이브: "위치 확인 안 된 곳 보기" — 목록을 끝까지 내려 둔 뒤에도 블록이 sticky 막대 밑에 가리지 않는다', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)
  const areas = ['부평구', '계양구', '남동구', '연수구', '미추홀구', '서해구·검단구 일대(옛 서구)'].map((label, i) =>
    ua({ sigungu_cd: `2823${i}`, label, count: 100 + i }),
  )
  live.setArea((program, url) =>
    program === 'svoucher'
      ? { status: 200, body: areaBody(url, { total: 20, rows: Array.from({ length: 20 }, (_, i) => vRow(url, i)), areas }) }
      : { status: 200, body: areaBody(url, { total: 20, rows: Array.from({ length: 20 }, (_, i) => pRow(url, i)) }) },
  )
  await runAreaSearch(page)
  await page.getByTestId('panel-tab-list').click()
  const list = await tabPanel(page, 'list')
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  const block = p.locator('[data-testid="area-unlocated-block"][data-program="svoucher"]')
  // 준비: 끝까지 내리면 (막대 밑 띠보다 긴) 블록의 윗변이 sticky 막대 밑에 걸린다
  expect((await rectOf(block)).top, '준비: 블록 윗변이 막대 밑에 걸려 있어야 한다').toBeLessThan(
    (await rectOf(listBar(page))).bottom,
  )
  await page.getByTestId('panel-tab-map').click()
  await bar(page).getByRole('button', { name: '위치 확인 안 된 곳 보기' }).click()
  await expect(page.getByTestId('panel-tab-list')).toHaveAttribute('aria-selected', 'true')
  await expect(block).toBeFocused()
  const b = await rectOf(block)
  expect(b.top, '블록 윗변이 sticky 결과 막대 밑에 가렸다').toBeGreaterThanOrEqual((await rectOf(listBar(page))).bottom - 0.5)
  expect(b.top, '블록 윗변이 sticky 헤더 밑에 가렸다').toBeGreaterThanOrEqual((await headerBottom(page)) - 0.5)
  expect(b.top).toBeLessThan(await page.evaluate(() => window.innerHeight))
})

test('8i. 라이브: 목록 탭에서 결과가 바뀌면(K2 제출 · q 빼기 · 원래 결과로) 목록은 맨 위부터 다시 보인다', async ({ page }) => {
  const live = await openLiveMap(page)
  const p = panel(page)
  live.setArea((program, url) =>
    program === 'svoucher'
      ? { status: 200, body: areaBody(url, { total: 30, rows: Array.from({ length: 30 }, (_, i) => vRow(url, i)) }) }
      : { status: 200, body: areaBody(url, { total: 30, rows: Array.from({ length: 30 }, (_, i) => pRow(url, i)) }) },
  )
  await runAreaSearch(page)
  await page.getByTestId('panel-tab-list').click()
  const list = await tabPanel(page, 'list')
  const toBottom = () =>
    list.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      return el.scrollTop
    })
  const scrollTop = () => list.evaluate((el) => el.scrollTop)
  const h2 = p.locator('h2')
  const expectFromTop = async (msg: string) => {
    await expect.poll(scrollTop, { message: `${msg}: 옛 scrollTop 이 남았다` }).toBe(0)
    // 목록 머리(h2)가 sticky 막대 밑이 아니라 그 아래에 보인다
    expect((await rectOf(h2)).top, `${msg}: h2 가 막대 밑에 가렸다`).toBeGreaterThanOrEqual(
      (await rectOf(listBar(page))).bottom - 0.5,
    )
  }

  // K2: 범위 모드 폼 제출(키보드 Enter — 입력칸을 향해 칸을 굴리지 않게 제출 직전에 다시 끝까지 내린다)
  const input = p.getByTestId('facility-search-input')
  await input.evaluate((el: HTMLInputElement) => el.focus({ preventScroll: true }))
  await page.keyboard.type('테스트')
  expect(await toBottom()).toBeGreaterThan(400)
  await page.keyboard.press('Enter')
  await expect(listBar(page).getByTestId('area-search-q')).toHaveText('‘테스트’ 포함')
  await expect(h2).toHaveText('지도 범위 결과')
  await expectFromTop('K2 제출')

  // q 빼기(sticky 막대의 버튼 — 막대는 늘 보인다)
  expect(await toBottom()).toBeGreaterThan(400)
  await listBar(page).getByTestId('area-search-drop-q').click()
  await expect(listBar(page).getByTestId('area-search-q')).toHaveCount(0)
  await expect(listBar(page)).toHaveAttribute('data-status', 'done')
  await expectFromTop('q 빼기')

  // 원래 결과로 → 근처 목록(h2 '근처 자원')도 맨 위부터
  expect(await toBottom()).toBeGreaterThan(400)
  await listBar(page).getByTestId('area-search-reset').click()
  await expect(bar(page)).toHaveCount(0)
  await expect(h2).toHaveText('근처 자원')
  await expect.poll(scrollTop, { message: '원래 결과로: 옛 scrollTop 이 남았다' }).toBe(0)
})

// ───────────────────────────── 9 · 1280 ─────────────────────────────
test.describe('1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('9. 버튼은 가운데, 컨트롤과 겹치지 않고 · 막대는 PC 패널에 · 목록 끝까지 보인다', async ({ page }) => {
    await openMapFor(page, 'P2')
    await dragAndSettle(page)
    const btn = areaButton(page)
    await expect(btn).toBeVisible()
    const mb = (await mapBox(page).boundingBox())!
    const bb = (await btn.boundingBox())!
    expect(Math.abs(bb.x + bb.width / 2 - (mb.x + mb.width / 2))).toBeLessThanOrEqual(2)
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    for (const sel of ['.maplibregl-ctrl-top-right .maplibregl-ctrl', '.maplibregl-ctrl-attrib']) {
      const o = (await mapBox(page).locator(sel).first().boundingBox())!
      expect(overlaps(bb, o), `버튼이 ${sel} 와 겹친다`).toBe(false)
    }
    const legend = (await panel(page).getByTestId('map-legend').boundingBox())!
    expect(overlaps(bb, legend)).toBe(false)
    await shotIf(page, '1280-map-button')

    await btn.click()
    await expect(bar(page)).toBeVisible()
    await expect(bar(page)).toHaveAttribute('data-status', 'done')
    await shotIf(page, '1280-map-bar')

    await page.getByTestId('panel-tab-list').click()
    await expect(bar(page)).toBeVisible()
    const list = panel(page).locator('[role="tabpanel"]:not([hidden])')
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const lastBottom = await list.evaluate((el) => {
      const section = el.querySelector('section')
      const last = section?.lastElementChild ?? el.lastElementChild
      return last ? last.getBoundingClientRect().bottom : 0
    })
    expect(lastBottom).toBeLessThanOrEqual(900)
    await expect(bar(page)).toBeInViewport()
    await shotIf(page, '1280-list')
  })
})

// 짧은 노트북 화면(대화 바닥 = 기본 상태). 패널은 lg:sticky 라, 지도 탭에 높이 한도가 없으면 결과 막대만큼
// 패널이 뷰포트보다 길어져 컨테이너 바닥에 밀려 올라간다(1280x720 에서 지도 135px·탭이 헤더 밑).
for (const vp of [
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
]) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp })

    test(`9b. ${vp.width}x${vp.height}: 대화 바닥에서 지도 탭 막대가 생겨도 패널이 밀려 올라가지 않는다`, async ({ page }) => {
      await openDemo(page)
      await startPersona(page, 'P2')
      await openPanel(page, 'map')
      await waitForMapIdle(page)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const header = page.locator('header').first()
      const hb = await header.evaluate((el) => el.getBoundingClientRect().bottom)
      const mb0 = (await mapBox(page).boundingBox())!

      await dragMap(page, 60, 20)
      await waitMoveSettled(page)
      await expect(areaButton(page)).toBeVisible()
      await areaButton(page).click()
      await expect(bar(page)).toHaveAttribute('data-status', 'done')
      await page.waitForTimeout(200)

      // 지도 y 는 그대로, 탭은 헤더 밑이 아니다, 패널 바닥은 뷰포트 안
      const mb1 = (await mapBox(page).boundingBox())!
      expect(Math.abs(mb1.y - mb0.y), `지도가 ${mb0.y - mb1.y}px 밀려 올라갔다`).toBeLessThanOrEqual(1)
      const tab = (await page.getByTestId('panel-tab-map').boundingBox())!
      expect(tab.y, '지도 탭 버튼이 sticky 헤더 밑에 들어갔다').toBeGreaterThanOrEqual(hb - 1)
      const pb = (await panel(page).boundingBox())!
      expect(pb.y + pb.height, '패널이 뷰포트보다 길다').toBeLessThanOrEqual(vp.height + 1)

      // 다시 끌면 버튼이 헤더 밑이 아니라 보이고, 그 가운데를 누르면 버튼이 받는다
      await dragMap(page, -50, 15)
      await waitMoveSettled(page)
      await expect(areaButton(page)).toBeVisible()
      const bb = (await areaButton(page).boundingBox())!
      expect(bb.y).toBeGreaterThanOrEqual(hb - 1)
      const hit = await page.evaluate(
        ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="area-search-button"]'),
        [bb.x + bb.width / 2, bb.y + bb.height / 2],
      )
      expect(hit, '버튼 가운데가 다른 요소(헤더)에 가렸다').toBe(true)
      const zoomIn = (await mapBox(page).getByRole('button', { name: '확대' }).boundingBox())!
      expect(zoomIn.y).toBeGreaterThanOrEqual(hb - 1)

      // 막대는 지도 아래의 막대 칸 안에서 스크롤해 끝까지 볼 수 있다(지도·범례는 칸 밖 — 스크롤되지 않는다).
      // 칸은 맨 위(막대 머리 줄: 제목·원래 결과로)부터 보인다.
      await expect(bar(page).getByTestId('area-search-reset')).toBeInViewport({ ratio: 1 })
      const region = panel(page).getByTestId('map-bar-region')
      await region.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      const mb2 = (await mapBox(page).boundingBox())!
      expect(Math.abs(mb2.y - mb0.y), '막대 칸을 굴렸는데 지도가 함께 움직였다').toBeLessThanOrEqual(1)
      // 끝까지 굴리면 막대 아랫변이 칸 안에 들어온다(마지막 줄이 보인다)
      const rb = await rectOf(region)
      const barBottom = (await rectOf(bar(page))).bottom
      expect(barBottom, '막대 칸을 끝까지 굴려도 막대 끝이 칸 밖이다').toBeLessThanOrEqual(rb.bottom + 1)
      expect(barBottom).toBeGreaterThan(rb.top)
      await expect(bar(page).locator('> :last-child')).toBeInViewport()
      expect(barBottom).toBeLessThanOrEqual(vp.height)
      await assertNoHorizontalScroll(page)
    })
  })
}

// 폭을 차지하는 스크롤바(Windows Chrome 기본 · macOS "스크롤 막대 항상 보기"). Playwright 헤드리스는 --hide-scrollbars
// 로 돌아 기본 e2e 로는 잡히지 않는다 — 그 인자를 뺀 브라우저를 따로 띄우고 15px 스크롤바를 주입한다.
test('9c. 1280x720 클래식 스크롤바: 막대 칸에 스크롤바가 생겨도 지도 폭·보이는 범위는 그대로 — 제목 "이 지도 범위", 재검색에도 출렁이지 않는다', async ({
  playwright,
  baseURL,
}) => {
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 720 } })
    await openDemo(page)
    await page.addStyleTag({
      content: '*::-webkit-scrollbar{width:15px;height:15px}*::-webkit-scrollbar-thumb{background:#888}',
    })
    const gutter = await page.evaluate(() => {
      const d = document.createElement('div')
      d.style.cssText = 'position:absolute;top:-999px;width:100px;height:50px;overflow-y:scroll'
      document.body.appendChild(d)
      const g = d.offsetWidth - d.clientWidth
      d.remove()
      return g
    })
    expect(gutter, '준비: 스크롤바가 폭을 차지해야 한다(클래식 스크롤바 에뮬레이션)').toBeGreaterThanOrEqual(10)
    await startPersona(page, 'P2')
    await openPanel(page, 'map')
    await waitForMapIdle(page)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const mapWidth = () => mapBox(page).evaluate((el) => el.clientWidth)
    const w0 = await mapWidth()
    // 요청 시작부터 완료 뒤까지 매 프레임 지도 폭을 적는다(로딩 중 막대가 접혔다 다시 자라도 출렁이면 안 된다)
    const sampleWidths = () =>
      page.evaluate(() => {
        const w = window as unknown as { __mw: number[]; __mwOn: boolean }
        w.__mw = []
        w.__mwOn = true
        const el = document.querySelector<HTMLElement>('[data-testid="nearby-map"]')!
        const tick = () => {
          w.__mw.push(el.clientWidth)
          if (w.__mwOn) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    const stopWidths = () =>
      page.evaluate(() => {
        const w = window as unknown as { __mw: number[]; __mwOn: boolean }
        w.__mwOn = false
        return [...new Set(w.__mw)]
      })

    await dragMap(page, 60, 20)
    await waitMoveSettled(page)
    await expect(areaButton(page)).toBeVisible()
    await sampleWidths()
    await areaButton(page).click()
    await expect(bar(page)).toHaveAttribute('data-status', 'done')
    await page.waitForTimeout(400)
    expect(await stopWidths(), '검색 동안 지도 폭이 바뀌었다').toEqual([w0])
    // 막대 칸에는 실제로 폭을 차지하는 스크롤바가 생겼다(이 경로를 지나갔다)
    const region = panel(page).getByTestId('map-bar-region')
    const sb = await region.evaluate((el: HTMLElement) => ({ over: el.scrollHeight > el.clientHeight, bar: el.offsetWidth - el.clientWidth }))
    expect(sb.over, '준비: 막대 칸이 넘쳐야 한다').toBe(true)
    expect(sb.bar).toBeGreaterThanOrEqual(10)
    await expect(bar(page)).toContainText('이 지도 범위')
    await expect(bar(page)).not.toContainText('찾았던 범위')
    await expect(areaButton(page)).toHaveCount(0)

    // 재검색: 로딩 중 막대가 접혔다가 완료 때 다시 자라도 지도 폭은 그대로
    await dragMap(page, -40, 0)
    await waitMoveSettled(page)
    await expect(areaButton(page)).toBeVisible()
    await sampleWidths()
    await areaButton(page).click()
    await expect(bar(page)).toHaveAttribute('data-status', 'done')
    await page.waitForTimeout(400)
    expect(await stopWidths(), '재검색 동안 지도 폭이 바뀌었다').toEqual([w0])
    await expect(bar(page)).toContainText('이 지도 범위')
  } finally {
    await browser.close()
  }
})

// "글씨 크게" + 짧은 노트북 화면, 실사용 메인(/). 범위 검색을 하지 않은 기본 지도 탭은 HEAD 와 같아야 한다 —
// 범위 막대 때문에 둔 높이 한도가 늘 걸리면 지도 하단·ⓘ·범례가 내부 스크롤 뒤로 숨는다(기존 기능 회귀).
for (const vp of [
  { width: 1280, height: 720 },
  { width: 1366, height: 657 },
]) {
  test.describe(`${vp.width}x${vp.height} 글씨 크게`, () => {
    test.use({ viewport: vp })

    test(`9d. ${vp.width}x${vp.height} 글씨 크게: 기본 지도 탭은 내부 스크롤이 없고 범례·ⓘ 가 보인다 · 범위 모드에서도 지도·범례는 가리지 않는다`, async ({ page }) => {
      await openMain(page)
      await page.getByTestId('text-size-toggle').click()
      await expect(page.getByTestId('text-size-toggle')).toHaveAttribute('aria-pressed', 'true')
      await fillMainSlots(page)
      await openPanel(page, 'map')
      await waitForMapIdle(page)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(200)
      const mapPanel = await tabPanel(page, 'map')
      const legend = panel(page).getByTestId('map-legend')
      const attrib = mapBox(page).locator('.maplibregl-ctrl-attrib')
      const inner = await mapPanel.evaluate((el) => ({
        oy: getComputedStyle(el).overflowY,
        sh: el.scrollHeight,
        ch: el.clientHeight,
      }))
      expect(inner.sh - inner.ch, `기본 지도 탭이 내부 스크롤 상자다(${JSON.stringify(inner)})`).toBeLessThanOrEqual(1)
      const region0 = await panel(page)
        .getByTestId('map-bar-region')
        .evaluate((el) => getComputedStyle(el).overflowY)
      expect(region0, '범위 모드가 아닌데 막대 칸에 스크롤이 걸렸다').toBe('visible')
      await expect(legend).toBeInViewport({ ratio: 1 })
      await expect(attrib).toBeInViewport({ ratio: 1 })
      const vh = vp.height
      expect((await rectOf(legend)).bottom).toBeLessThanOrEqual(vh)

      // 범위 모드: 막대 칸만 스크롤 — 지도·범례·ⓘ 는 칸 밖이라 가리지 않고, 막대 끝(원래 결과로)까지 굴려 볼 수 있다
      await dragMap(page, 60, 20)
      await waitMoveSettled(page)
      await expect(areaButton(page)).toBeVisible()
      await areaButton(page).click()
      await expect(bar(page)).toHaveAttribute('data-status', 'done')
      await page.waitForTimeout(200)
      await expect(legend).toBeInViewport({ ratio: 1 })
      await expect(attrib).toBeInViewport({ ratio: 1 })
      await expect(areaButton(page)).toHaveCount(0)
      await expect(bar(page).getByTestId('area-search-reset')).toBeInViewport({ ratio: 1 })
      const region = panel(page).getByTestId('map-bar-region')
      await region.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      const rb = await rectOf(region)
      const barBottom = (await rectOf(bar(page))).bottom
      expect(barBottom, '막대 칸을 끝까지 굴려도 막대 끝이 칸 밖이다').toBeLessThanOrEqual(rb.bottom + 1)
      expect(barBottom).toBeGreaterThan(rb.top)
      await expect(bar(page).locator('> :last-child')).toBeInViewport()
      await expect(legend).toBeInViewport({ ratio: 1 })
      await assertNoHorizontalScroll(page)
    })
  })
}

// ───────────────────────────── 10 ─────────────────────────────
test('10. 390: 키보드로 시작한 검색이 끝나면 막대가 sticky 헤더 밑에 가리지 않는다', async ({ page }) => {
  // 가림은 **키보드**로 시작해 focus() 가 기본 스크롤을 쓸 때 생긴다(포인터면 preventScroll — 스크롤 없음).
  // 그래서 막대가 헤더 밑에 걸친 상태를 만든 뒤 폼 Enter(K2 · via=keyboard)로 다시 찾고, 도와주는 스크롤
  // (scrollIntoViewIfNeeded) 없이 잰다. scroll-margin-top(data-focus-anchor) 규칙이 빠지면 막대가 헤더 밑에 남는다.
  await openMapFor(page, 'P2')
  await runAreaSearch(page)
  await page.getByTestId('panel-tab-list').click()
  const p = panel(page)
  const header = page.locator('header').first()
  const headerBottom = async () => {
    const h = (await header.boundingBox())!
    return h.y + h.height
  }
  // 막대의 윗변이 뷰포트 y≈10(헤더 72px 밑)에 오게 창을 굴린다 — 입력칸은 그 아래 화면 안에 있다.
  await bar(page).evaluate((el) => {
    window.scrollBy({ top: el.getBoundingClientRect().top - 10, behavior: 'instant' })
  })
  const before = (await bar(page).boundingBox())!
  expect(before.y, '준비: 막대가 헤더 밑에 걸쳐 있어야 한다').toBeLessThan((await headerBottom()) - 20)
  const input = p.getByTestId('facility-search-input')
  expect(await input.evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true)
  // 스크롤을 일으키지 않고 입력칸에 포커스 → 타이핑 → Enter(키보드 제출)
  await input.evaluate((el: HTMLInputElement) => el.focus({ preventScroll: true }))
  await page.keyboard.type('체육')
  await page.keyboard.press('Enter')
  await expect(bar(page).getByTestId('area-search-q')).toHaveText('‘체육’ 포함')
  await expect(bar(page)).toBeFocused()
  await expect
    .poll(async () => (await bar(page).boundingBox())!.y - (await headerBottom()), {
      message: '키보드 완료 뒤 막대가 sticky 헤더 밑에 가렸다',
    })
    .toBeGreaterThanOrEqual(-1)

  // 포인터로 시작한 지도 탭 검색은 화면을 움직이지 않는다(막대는 지도 바로 아래)
  await page.getByTestId('panel-tab-map').click()
  await userScrollToMap(page)
  await dragAndSettle(page)
  await areaButton(page).click()
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  const b = (await bar(page).boundingBox())!
  expect(b.y).toBeGreaterThanOrEqual(await headerBottom())
})

test('10b. 390: 폼의 찾기·검색 지우기는 누른 방식대로 — 포인터는 화면을 굴리지 않고, 키보드는 막대를 헤더 밑에서 꺼낸다', async ({ page }) => {
  // §6.11: 포인터로 시작했으면 focus({preventScroll}), 키보드로 시작했으면 기본 스크롤. 폼 제출(K2)이 방식과
  // 상관없이 keyboard 로 고정되면 마우스로 누른 '찾기'도 창이 62px 튀고, 검색 지우기(K3)가 방식을 갱신하지
  // 않으면 직전 다른 동작의 방식을 이어 쓴다.
  await openMapFor(page, 'P2')
  await runAreaSearch(page)
  await page.getByTestId('panel-tab-list').click()
  const p = panel(page)
  const header = page.locator('header').first()
  const headerBottom = () => header.evaluate((el) => el.getBoundingClientRect().bottom)
  // 막대 윗변을 뷰포트 y≈10(헤더 밑)에 둔다
  const tuck = async () => {
    await bar(page).evaluate((el) => {
      window.scrollBy({ top: el.getBoundingClientRect().top - 10, behavior: 'instant' })
    })
    const y = await bar(page).evaluate((el) => el.getBoundingClientRect().top)
    expect(y, '준비: 막대가 헤더 밑에 걸쳐 있어야 한다').toBeLessThan((await headerBottom()) - 20)
  }
  const view = async () => ({
    y: await page.evaluate(() => window.scrollY),
    bar: await bar(page).evaluate((el) => el.getBoundingClientRect().top),
  })
  const input = p.getByTestId('facility-search-input')
  const submit = p.getByTestId('facility-search-submit')
  const clear = p.getByTestId('facility-search-clear')
  const typeQ = async (q: string) => {
    await input.evaluate((el: HTMLInputElement) => el.focus({ preventScroll: true }))
    await page.keyboard.type(q)
  }

  // 1. '찾기'를 마우스로 → K2 → 포커스는 막대로 가되 화면은 그대로
  await tuck()
  await typeQ('체육')
  await expect(submit).toBeInViewport({ ratio: 1 })
  const v0 = await view()
  await submit.click()
  await expect(bar(page).getByTestId('area-search-q')).toHaveText('‘체육’ 포함')
  await expect(bar(page)).toBeFocused()
  await page.waitForTimeout(300)
  const v1 = await view()
  expect(Math.abs(v1.y - v0.y), `포인터 제출인데 창이 ${v1.y - v0.y}px 굴렀다`).toBeLessThanOrEqual(1)
  expect(Math.abs(v1.bar - v0.bar), '포인터 제출인데 막대가 움직였다').toBeLessThanOrEqual(1)

  // 2. 직전이 포인터여도, 키보드로 누른 '검색 지우기'(K3)는 키보드 스크롤 — 막대가 헤더 밑에서 나온다
  await clear.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }))
  await page.keyboard.press('Enter')
  await expect(bar(page).getByTestId('area-search-q')).toHaveCount(0)
  await expect(bar(page)).toBeFocused()
  await expect
    .poll(async () => (await bar(page).evaluate((el) => el.getBoundingClientRect().top)) - (await headerBottom()), {
      message: '키보드 검색 지우기 뒤 막대가 sticky 헤더 밑에 남았다',
    })
    .toBeGreaterThanOrEqual(-1)

  // 3. 직전이 키보드여도, 마우스로 누른 '검색 지우기'는 화면을 굴리지 않는다
  await typeQ('체육')
  await page.keyboard.press('Enter')
  await expect(bar(page).getByTestId('area-search-q')).toHaveText('‘체육’ 포함')
  await tuck()
  await expect(clear).toBeInViewport({ ratio: 1 })
  const v2 = await view()
  await clear.click()
  await expect(bar(page).getByTestId('area-search-q')).toHaveCount(0)
  await expect(bar(page)).toBeFocused()
  await page.waitForTimeout(300)
  const v3 = await view()
  expect(Math.abs(v3.y - v2.y), `포인터 지우기인데 창이 ${v3.y - v2.y}px 굴렀다`).toBeLessThanOrEqual(1)
})

test('10c. 390: 탭 전환 + 포커스(K6 입력칸 · K4 탭 버튼)는 sticky 헤더 밑(뷰포트 "안")에 걸린 대상도 꺼낸다', async ({ page }) => {
  // 옛 규칙은 "뷰포트 밖(top<0)이면 scrollIntoView" 라, 0 ≤ top < 헤더 바닥(72px)에 걸린 대상은 가린 채 포커스만 줬다.
  await openMapFor(page, 'P2')
  await runAreaSearch(page)
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  const p = panel(page)

  // K6: 막대의 "{…} 안에서 찾기" — 탭 버튼이 헤더 밑으로 들어가게 창을 내려 두면, 바뀐 목록 탭의 입력칸이 헤더 밑이다
  const tabs = page.getByTestId('panel-tab-map')
  await tabs.evaluate((el) => {
    window.scrollBy({ top: el.getBoundingClientRect().bottom + 12, behavior: 'instant' })
  })
  const searchIn = bar(page).getByRole('button', { name: /안에서 찾기$/ }).first()
  await expect(searchIn).toBeInViewport()
  await searchIn.click()
  const input = p.getByTestId('facility-search-input')
  await expect(input).toBeFocused()
  await expect
    .poll(async () => (await rectOf(input)).top - (await headerBottom(page)), {
      message: 'K6 입력칸이 sticky 헤더 밑에 가렸다',
    })
    .toBeGreaterThanOrEqual(-0.5)
  expect((await rectOf(input)).bottom).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight))

  // K4: 키보드로 '원래 결과로' → 활성 탭 버튼(지도)으로 포커스 — 탭 버튼이 헤더에 일부 걸려 있어도 꺼낸다
  await page.getByTestId('panel-tab-map').click()
  await userScrollToMap(page)
  await runAreaSearch(page)
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await tabs.evaluate((el) => {
    window.scrollBy({ top: el.getBoundingClientRect().top - 38, behavior: 'instant' })
  })
  expect((await rectOf(tabs)).top, '준비: 탭 버튼이 헤더 밑에 걸려 있어야 한다').toBeLessThan((await headerBottom(page)) - 20)
  await bar(page)
    .getByTestId('area-search-reset')
    .evaluate((el: HTMLElement) => el.focus({ preventScroll: true }))
  await page.keyboard.press('Enter')
  await expect(bar(page)).toHaveCount(0)
  await expect(tabs).toBeFocused()
  await expect
    .poll(async () => (await rectOf(tabs)).top - (await headerBottom(page)), {
      message: 'K4 탭 버튼이 sticky 헤더 밑에 가렸다',
    })
    .toBeGreaterThanOrEqual(-0.5)
})

// ───────────────────────────── 11 · 터치 ─────────────────────────────
test.describe('터치', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('11. 두 손가락 팬은 버튼 · 한 손가락은 페이지 스크롤', async ({ page }) => {
    await openMapFor(page, 'P2')
    const cdp = await page.context().newCDPSession(page)
    const mb = (await mapBox(page).boundingBox())!
    const cx = mb.x + mb.width / 2
    const cy = mb.y + mb.height / 2

    // 한 손가락: 협조 제스처라 지도가 아니라 페이지가 스크롤된다
    const y0 = await page.evaluate(() => window.scrollY)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 12 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(600)
    await expect(areaButton(page)).toHaveCount(0)
    const y1 = await page.evaluate(() => window.scrollY)
    expect(y1, '한 손가락 드래그가 페이지를 스크롤하지 않았다').not.toBe(y0)

    // 두 손가락 팬
    await userScrollToMap(page)
    const mb2 = (await mapBox(page).boundingBox())!
    const x = mb2.x + mb2.width / 2
    const y = mb2.y + mb2.height / 2
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    })
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 30 + i * 6, y: y + i * 2, id: 1 },
          { x: x + 30 + i * 6, y: y + i * 2, id: 2 },
        ],
      })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await waitMoveSettled(page)
    await expect(areaButton(page)).toBeVisible()
  })
})

// ───────────────────────────── 12 ─────────────────────────────
test('12. 범위 결과가 보이는 패널 axe critical 0', async ({ page }) => {
  await openMapFor(page, 'P2')
  await runAreaSearch(page)
  const check = async () => {
    const r = await new AxeBuilder({ page })
      .include('[data-testid="context-panel"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const critical = r.violations.filter((v) => v.impact === 'critical')
    expect(
      critical,
      r.violations.map((v) => `[${v.impact}] ${v.id} — ${v.help}`).join('\n') || '위반 없음',
    ).toHaveLength(0)
  }
  await check()
  await page.getByTestId('panel-tab-list').click()
  await expect(panel(page).getByTestId('area-search-results')).toBeVisible()
  await check()
})

// ───────────────────────────── 13 ─────────────────────────────
test('13. 근처 목록을 내려 둔 뒤 지도 탭에서 범위 검색 → 목록 탭은 맨 위(h2·폼·섹션 머리)부터 보인다', async ({ page }) => {
  // 목록 탭 패널은 hidden 만 토글된다 — 옛 scrollTop(근처 목록 끝)이 그대로 돌아와 새 결과가 중간 행부터 보였다.
  await openDemo(page)
  await startPersona(page, 'P1')
  await openPanel(page, 'list')
  const p = panel(page)
  const list = await tabPanel(page, 'list')
  const st0 = await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  expect(st0, '준비: 근처 목록이 스크롤되어 있어야 한다').toBeGreaterThan(200)

  await page.getByTestId('panel-tab-map').click()
  await waitForMapIdle(page)
  await userScrollToMap(page)
  await dragMap(page, 50, 30)
  await waitMoveSettled(page)
  await areaButton(page).click()
  await expect(bar(page)).toHaveAttribute('data-status', 'done')
  await page.getByTestId('panel-tab-list').click()
  await expect(p.getByTestId('area-search-results')).toBeVisible()
  expect(await list.evaluate((el) => el.scrollTop), '범위 결과가 옛 scrollTop 에서 시작했다').toBe(0)
  const barBottom = (await rectOf(listBar(page))).bottom
  const h2 = p.locator('h2')
  await expect(h2).toHaveText('지도 범위 결과')
  expect((await rectOf(h2)).top, 'h2 가 sticky 막대 밑에 가렸다').toBeGreaterThanOrEqual(barBottom - 0.5)
  await expect(p.getByTestId('facility-search')).toContainText('이 지도 범위 안에서 이름·주소로 찾아요')
  const firstSection = p.getByTestId('area-search-results').locator('> div').first()
  expect((await rectOf(firstSection)).top).toBeGreaterThanOrEqual(barBottom - 0.5)

  // 목록 탭에서 범위 결과를 끝까지 내린 뒤 '원래 결과로' → 근처 목록도 맨 위부터
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await listBar(page).getByTestId('area-search-reset').click()
  await expect(bar(page)).toHaveCount(0)
  await expect(h2).toHaveText('근처 자원')
  expect(await list.evaluate((el) => el.scrollTop), '원래 결과로 뒤 옛 scrollTop 이 남았다').toBe(0)
})
