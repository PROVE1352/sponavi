// 챗 UI(FR-12) e2e 공용 앵커. 스펙은 전부 "칩을 누르고 스트림 카드를 읽는" 형태라
// 화면 진입·턴 완료 대기를 여기 모은다. 고정 sleep 은 쓰지 않는다(지도 타일만 예외, shots.spec).

import { expect, type Locator, type Page } from '@playwright/test'

export const PERSONA_IDS = ['P1', 'P2', 'P3', 'P4', 'P5'] as const

// 채팅 스트림(role="log") — 봇/사용자 발화와 모든 결과 카드가 여기 안에 붙는다.
export function stream(page: Page): Locator {
  return page.getByTestId('chat-stream')
}

// 컨텍스트 패널(지도·시설 목록). 판정 전에는 존재하지 않는다.
export function panel(page: Page): Locator {
  return page.getByTestId('context-panel')
}

// 메인 랜딩(실사용 전용, v1.4) — 인사 버블 1개 다음 곧바로 첫 질문(나이 칩)까지.
// 데모 문구·P1~P5 칩은 여기 없다(FR-12 AC5).
export async function openMain(page: Page): Promise<void> {
  await page.goto('/')
  await expect(stream(page)).toBeVisible()
  await expect(page.getByTestId('composer')).toBeVisible()
  // v1.5: 첫 질문은 연령대(1단계) 칩이다 — 세부 나이 칩은 그 다음 턴에 나온다.
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
}

// 연령 2단계 칩(FR-12 AC6 v1.5): 연령대 → 세부 나이.
// 80·90대는 "70대 이상"의 마지막 칩을 타고 한 단계씩 올라간다.
export async function pickAge(page: Page, age: number): Promise<void> {
  const top = age <= 9 ? 'u9' : age >= 70 ? '70s' : `${Math.floor(age / 10)}0s`
  await page.getByTestId(`chip-ageband-${top}`).click()
  if (age >= 80) await page.getByTestId('chip-ageband-80s').click()
  if (age >= 90) await page.getByTestId('chip-ageband-90s').click()
  await page.getByTestId(`chip-age-${age}`).click()
}

// 데모 페이지(/#/demo) — 심사·시연 진입로. 퀵스타트 칩(P1~P5)이 인사 메시지 안에 렌더될 때까지.
// 페르소나 1클릭 완주에 기대는 스펙은 전부 이 문 하나로 들어온다(FR-12 AC5 v1.4).
export async function openDemo(page: Page): Promise<void> {
  await page.goto('/#/demo')
  await expect(stream(page)).toBeVisible()
  await expect(page.getByTestId('composer')).toBeVisible()
  await expect(page.getByTestId('chip-persona-P1')).toBeVisible()
  await expect(page.getByTestId('chip-persona-P5')).toBeVisible()
}

// 지역 2단계 칩(FR-12 AC1 v1.7): 시도(코드 앞 2자리) → 시군구. 인라인 검색창은 없다.
export async function pickRegion(page: Page, regionCd: string): Promise<void> {
  await page.getByTestId(`chip-sido-${regionCd.slice(0, 2)}`).click()
  await page.getByTestId(`chip-region-${regionCd}`).click()
}

// 메인에서 칩만으로 슬롯 5개를 채워 판정까지 간다(퀵스타트 없이 실사용 경로 완주).
export async function fillMainSlots(
  page: Page,
  opts: {
    age?: number
    sex?: string
    regionCd?: string
    income?: string
    disability?: string
    // 2027 확대 대상(5~18세 · 그외에게만 묻는다). 칩 id 꼬리: 'multichild' | 'defector' | 'none'
    special?: string[]
  } = {},
): Promise<void> {
  const age = opts.age ?? 27
  const income = opts.income ?? '기초생활수급'
  await pickAge(page, age)
  await page.getByTestId(`chip-sex-${opts.sex ?? 'M'}`).click()
  await pickRegion(page, opts.regionCd ?? '11290')
  await page.getByTestId(`chip-income-${income}`).click()
  if (age >= 5 && age <= 18 && (income === '그외' || income === 'unknown')) {
    await pickSpecial(page, opts.special ?? ['none'])
  }
  await page.getByTestId(`chip-dis-${opts.disability ?? 'no'}`).click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(page.getByTestId('chip-act-restart')).toBeVisible()
}

// 2027 확대 대상 다중 선택 → "선택 완료".
export async function pickSpecial(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) await page.getByTestId(`chip-special-${id}`).click()
  await page.getByTestId('chip-special-confirm').click()
}

// 퀵스타트 칩 1회 클릭 → 판정 턴 완료(카드 + 후속 칩)까지 대기.
// 후속 칩(chip-act-restart)은 runAssess 가 밀어넣는 마지막 메시지라 "턴 끝" 앵커로 쓴다.
export async function startPersona(page: Page, id: string): Promise<void> {
  await page.getByTestId(`chip-persona-${id}`).click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(page.getByTestId('facility-summary')).toBeVisible()
  await expect(page.getByTestId('chip-act-restart')).toBeVisible()
}

// 후속 칩으로 컨텍스트 패널의 특정 탭을 연다.
// v1.4부터 패널은 결과 도착 시 이미 펼쳐져 있으므로 이 함수는 탭 전환이 본체다.
export async function openPanel(page: Page, tab: 'map' | 'list'): Promise<void> {
  await page.getByTestId(tab === 'map' ? 'chip-act-map' : 'chip-act-list').click()
  const t = page.getByTestId(`panel-tab-${tab}`)
  await expect(t).toBeVisible()
  await expect(t).toHaveAttribute('aria-selected', 'true')
}

// 체력 레인 3턴: "체력 처방 시작" 칩 → PAR-Q 게이트 통과 → 동적 폼.
// 게이트를 통과하기 전에는 폼이 없다(FR-07 AC5) — 그 사실도 여기서 함께 검사한다.
export async function startFitnessThroughParq(page: Page): Promise<void> {
  await page.getByTestId('chip-act-fitness').click()
  const parq = page.getByTestId('parq-gate')
  await expect(parq).toBeVisible()
  await expect(parq).toContainText('160/100mmHg')
  await expect(page.getByTestId('fitness-form')).toHaveCount(0) // 게이트 전 폼 미노출
  await page.getByTestId('parq-check').check()
  await page.getByTestId('parq-continue').click()
  await expect(page.getByTestId('fitness-form-card')).toBeVisible()
}

// 심사용 fullPage 캡처. 챗 UI 는 sticky 헤더·컴포저·패널을 쓰는데, fullPage 스샷은
// sticky 요소를 "현재 스크롤 위치"에 박아 넣어 긴 대화 이미지 한가운데를 가린다.
// 캡처 직전에만 문서 흐름(static)으로 되돌려 헤더는 맨 위, 컴포저는 맨 아래에 담는다.
// (레이아웃 검사인 assertNoHorizontalScroll 은 반드시 이 호출 전에 한다.)
export async function shot(page: Page, path: string): Promise<void> {
  // 타이프라이터(FR-12 AC10)가 재생 중이면 문장이 잘린 채로 찍힌다 — 완료를 기다린다.
  await settleTypewriter(page)
  await page.addStyleTag({ content: '[class*="sticky"]{position:static !important}' })
  // 등장 모션(msg-in)이 진행 중인 프레임을 잡지 않도록 애니메이션은 종료 상태로 고정.
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
}

// 봇 발화 연출이 완전히 끝날 때까지 — 순차 등장 큐가 남은 버블을 다 열고(FR-12 AC10 v1.6),
// 진행 중인 타이프라이터도 전부 완성된 상태. 고정 sleep 대신 이 두 앵커만 본다.
export async function settleTypewriter(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-testid="chat-stream"]')
      if (!s || s.getAttribute('data-sequencing') === 'true') return false
      return document.querySelectorAll('[data-typing="true"]').length === 0
    },
    { timeout: 15_000 },
  )
}

// ── 지도(MapLibre GL + OpenFreeMap 벡터 타일, v1.8) ──────────────────────
// 캔버스 하나 + DOM 마커. Leaflet 시절의 .leaflet-container 앵커를 대체한다.
export function mapBox(page: Page): Locator {
  return page.getByTestId('nearby-map')
}

export function mapCanvas(page: Page): Locator {
  return mapBox(page).locator('canvas.maplibregl-canvas')
}

export function mapMarkers(page: Page): Locator {
  return mapBox(page).locator('[data-testid="map-marker"]')
}

// 지도가 화면에 붙었는지(캔버스 + 마커). 타일 도착 여부와는 무관하다.
export async function expectMapMounted(page: Page): Promise<void> {
  await expect(mapCanvas(page)).toBeVisible()
  await expect(mapMarkers(page).first()).toBeVisible()
}

// 벡터 타일 렌더 완료(map 'idle' → data-map-ready)를 기다린다. 고정 sleep 대신 쓴다.
// 타일이 못 오는 환경(오프라인·차단)에서는 조용히 넘어간다 — 지도는 보조 표면이라
// 타일 실패가 스펙을 깨뜨리면 안 된다(오프라인 내성 원칙).
export async function waitForMapIdle(page: Page, timeout = 8_000): Promise<boolean> {
  await expectMapMounted(page)
  try {
    await mapBox(page).and(page.locator('[data-map-ready="true"]')).waitFor({ timeout })
    return true
  } catch {
    return false
  }
}

// 결과 덱(FR-12 AC9 v1.7) — 모바일(<lg)에서 판정 결과 전체가 담기는 단일 스와이프 컨테이너.
export function deck(page: Page): Locator {
  return page.getByTestId('result-deck')
}

// 결과 영역의 "가로 스크롤 스냅 컨테이너" 개수. 덱은 단 하나여야 한다(중첩 카루셀 금지).
export async function snapContainerCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="chat-stream"]')
    if (!root) return -1
    return [...root.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el)
      return cs.overflowX === 'auto' && cs.scrollSnapType.includes('x')
    }).length
  })
}

// 모바일 가로 스크롤 0(요건 4): 문서 스크롤폭이 뷰포트를 넘지 않는다(지도·표는 자체 스크롤).
export async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `가로 오버플로 ${overflow}px`).toBeLessThanOrEqual(1)
}

// ── 스크롤 궤적 기록기 (FR-12 AC9 v1.11) ────────────────────────────────
// "덱 시작점에 먼저 머물렀다 → 후속 안내가 오자 바닥으로 내려갔다"처럼 **중간 상태**가 있는
// 동작은 최종 상태만 봐서는 검증할 수 없다. 그렇다고 고정 sleep 으로 그 순간을 노리면
// 기기 속도에 따라 흔들린다 — 50ms 간격으로 위치를 계속 적어 두고 나중에 읽는다.
export interface ViewportSample {
  t: number
  y: number
  // 문서 끝까지 남은 거리(0 = 바닥에 붙음)
  gap: number
  // 이름 → 뷰포트 기준 상/하단(요소가 아직 없으면 null)
  boxes: Record<string, { top: number; bottom: number } | null>
}

export async function traceViewport(page: Page, targets: Record<string, string>): Promise<void> {
  await page.evaluate((sel) => {
    const w = window as unknown as { __trace?: unknown[]; __traceId?: number }
    if (w.__traceId) clearInterval(w.__traceId)
    const samples: unknown[] = []
    w.__trace = samples
    const t0 = performance.now()
    w.__traceId = window.setInterval(() => {
      const boxes: Record<string, { top: number; bottom: number } | null> = {}
      for (const [name, css] of Object.entries(sel)) {
        const el = document.querySelector(css)
        const r = el?.getBoundingClientRect()
        boxes[name] = r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null
      }
      samples.push({
        t: Math.round(performance.now() - t0),
        y: Math.round(window.scrollY),
        gap: Math.round(document.documentElement.scrollHeight - window.innerHeight - window.scrollY),
        boxes,
      })
    }, 50)
  }, targets)
}

export async function viewportTrace(page: Page): Promise<ViewportSample[]> {
  return page.evaluate(
    () => (window as unknown as { __trace?: ViewportSample[] }).__trace ?? [],
  ) as Promise<ViewportSample[]>
}

// 궤적에서 "조건을 만족한 채 연속으로 머문" 최대 샘플 수(1 샘플 = 50ms).
// 스쳐 지나간 프레임과 실제로 멈춰 있던 구간을 구별하는 데 쓴다.
export function longestRun(
  samples: ViewportSample[],
  ok: (s: ViewportSample) => boolean,
): number {
  let best = 0
  let run = 0
  for (const s of samples) {
    run = ok(s) ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

// 지금 화면이 문서 바닥에 붙어 있는가(액션 칩이 컴포저 위로 온전히 보이는 상태).
export async function expectAtBottom(page: Page, message: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            document.documentElement.scrollHeight - window.innerHeight - Math.round(window.scrollY),
        ),
      { message, timeout: 8_000 },
    )
    .toBeLessThanOrEqual(2)
}
