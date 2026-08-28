import { test, expect, type Page } from '@playwright/test'
import { assertNoHorizontalScroll, stream } from './helpers'

// 자동재생 딥링크(W2, 목모드) — 보고서 QR 이 가리키는 주소 그대로.
// 서버가 `/demo?p=P2&auto=1` → `/#/demo?p=P2&auto=1` 로 보낸다(설계 4A). 여기서는 해시로 직행한다.
//
//   심사위원은 화면을 건드리지 않는다: 페르소나 자동 선택 → 판정 → 체력 처방 시작 →
//   PAR-Q 프리셋(라벨 표기) → 프리필 폼 자동 제출 → 체력 결과 → 시설 필터.
//   30초 예산은 설계 "자동재생 30초" 게이트다.

const AUTO_URL = '/#/demo?p=P2&auto=1'

// 자동재생은 끝날 때 측정치를 콘솔에 딱 한 줄 남긴다(UI 로는 내보내지 않는다).
function autoplayLog(page: Page): string[] {
  const lines: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[autoplay]')) lines.push(t.slice(t.indexOf('[autoplay]')))
  })
  return lines
}

test('p=P2&auto=1 — 사용자 입력 0회로 체력 결과 + 필터 적용 시설까지 (30초 예산)', async ({
  page,
}) => {
  const logs = autoplayLog(page)
  const started = Date.now()
  await page.goto(AUTO_URL)

  // 자동재생 중이라는 사실과 멈추는 법을 숨기지 않는다.
  const status = page.getByTestId('autoplay-status')
  await expect(status).toBeVisible()
  await expect(status).toContainText('자동 시연 중')

  // ① PAR-Q 는 데모 프리셋으로 통과하되, 그 사실이 카드에 남는다(★FR-P2 · P-1 정직 표기)
  await expect(page.getByTestId('parq-preset-note')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('parq-preset-note')).toContainText('실사용은 직접 확인')

  // ② 측정 폼은 페르소나 값으로 미리 채워져 자동 제출된다(3A 프리필 재사용)
  await expect(page.getByTestId('fitness-form-card')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('fit-prefill-note')).toBeVisible()

  // ③ 체력 결과 카드
  const result = page.getByTestId('fitness-result')
  await expect(result).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('item-band').first()).toBeVisible()

  // ④ 처방 종목으로 근처 시설 목록이 좁혀진 채 열려 있다
  const panel = page.getByTestId('context-panel')
  await expect(page.getByTestId('panel-tab-list')).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByText(/운동 필터:/)).toBeVisible()
  expect(await panel.locator('li').count(), '필터 적용 후 남은 시설 0곳').toBeGreaterThan(0)

  // ⑤ 끝나면 상태 필은 사라지고, 측정 로그는 딱 한 줄
  await expect(status).toHaveCount(0, { timeout: 30_000 })
  const elapsed = Date.now() - started
  expect(logs.length, `자동재생 로그 ${logs.length}줄`).toBe(1)
  expect(logs[0]).toMatch(/^\[autoplay\] done \d+ms$/)
  expect(elapsed, `자동재생 ${elapsed}ms — 30초 예산 초과`).toBeLessThan(30_000)
  console.log(`[e2e] 자동재생 실측: ${logs[0]} · 페이지 로드부터 ${elapsed}ms`)

  // ⑥ /api/fitness/ai 는 자동재생에서 호출하지 않는다(설계 실패 모드 표)
  await expect(page.getByTestId('ai-result')).toHaveCount(0)
  await assertNoHorizontalScroll(page)
})

test('자동재생 중 wheel 한 번 = 즉시 중단, 그 뒤는 사용자 조작', async ({ page }) => {
  const logs = autoplayLog(page)
  await page.goto(AUTO_URL)
  await expect(page.getByTestId('autoplay-status')).toBeVisible()

  // 사용자가 화면을 굴렸다 = 개입. 앱 자체 scrollTo 와 달리 이건 취소 트리거다.
  await page.mouse.wheel(0, 120)
  await expect(page.getByTestId('autoplay-status')).toHaveCount(0)

  // 이미 그려진 것(판정 결과)은 그대로 남는다 — 취소가 화면을 되돌리지 않는다.
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()

  // 3초 동안 자동 진행이 더 없다(체력 레인이 저절로 열리지 않는다).
  // ※ 여기서만 고정 대기를 쓴다 — "아무 일도 일어나지 않음"은 앵커로 기다릴 수 없다.
  await page.waitForTimeout(3_000)
  await expect(page.getByTestId('parq-gate')).toHaveCount(0)
  await expect(page.getByTestId('fitness-result')).toHaveCount(0)
  expect(logs[0]).toMatch(/^\[autoplay\] canceled \d+ms$/)

  // 사용자가 직접 이어서 진행할 수 있다(칩은 살아 있고, 문진은 손으로 통과한다).
  await page.getByTestId('chip-act-fitness').click()
  const parq = page.getByTestId('parq-gate')
  await expect(parq).toBeVisible()
  await expect(page.getByTestId('parq-preset-note')).toHaveCount(0) // 자동 통과가 아니므로 라벨 없음
  await expect(page.getByTestId('fitness-form')).toHaveCount(0)
})

test('prefers-reduced-motion — 타이프라이터가 즉시라도 단계마다 최소 체류를 지킨다', async ({
  page,
}) => {
  const logs = autoplayLog(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(AUTO_URL)

  await expect(page.getByTestId('fitness-result')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('parq-preset-note')).toBeVisible()
  await expect(page.getByTestId('context-panel').getByText(/운동 필터:/)).toBeVisible()
  await expect(page.getByTestId('autoplay-status')).toHaveCount(0, { timeout: 30_000 })

  // 연출이 전부 즉시라 화면이 순간이동한다 → 단계 사이 600ms 체류를 강제한다.
  // 자동 실행 4번(처방 시작·문진·제출·필터) 중 뒤 3번이 체류를 통과하므로 최소 1.8초.
  const ms = Number(/(\d+)ms/.exec(logs[0] ?? '')?.[1] ?? 0)
  expect(logs[0]).toMatch(/^\[autoplay\] done \d+ms$/)
  expect(ms, `모션 최소화 자동재생 ${ms}ms — 체류가 없다`).toBeGreaterThanOrEqual(1_800)
  expect(ms, `모션 최소화 자동재생 ${ms}ms — 30초 예산 초과`).toBeLessThan(30_000)
})

test('p 없는 auto=1 은 아무것도 자동으로 하지 않는다', async ({ page }) => {
  await page.goto('/#/demo?auto=1')
  await expect(page.getByTestId('chip-persona-P2')).toBeVisible()
  await expect(page.getByTestId('autoplay-status')).toHaveCount(0)

  await page.waitForTimeout(2_000)
  await expect(stream(page).getByTestId('assess-cards')).toHaveCount(0)
  await expect(page.getByTestId('parq-gate')).toHaveCount(0)
})
