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
  await expect(page.getByTestId('chip-age-27')).toBeVisible()
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

// 메인에서 칩만으로 슬롯 5개를 채워 판정까지 간다(퀵스타트 없이 실사용 경로 완주).
export async function fillMainSlots(
  page: Page,
  opts: { age?: string; sex?: string; regionCd?: string; income?: string; disability?: string } = {},
): Promise<void> {
  await page.getByTestId(`chip-age-${opts.age ?? '27'}`).click()
  await page.getByTestId(`chip-sex-${opts.sex ?? 'M'}`).click()
  await page.getByTestId('region-search').fill('성북')
  await page.getByTestId(`chip-region-${opts.regionCd ?? '11290'}`).click()
  await page.getByTestId(`chip-income-${opts.income ?? '기초생활수급'}`).click()
  await page.getByTestId(`chip-dis-${opts.disability ?? 'no'}`).click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(page.getByTestId('chip-act-restart')).toBeVisible()
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
  await page.addStyleTag({ content: '[class*="sticky"]{position:static !important}' })
  await page.screenshot({ path, fullPage: true })
}

// 모바일 가로 스크롤 0(요건 4): 문서 스크롤폭이 뷰포트를 넘지 않는다(지도·표는 자체 스크롤).
export async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `가로 오버플로 ${overflow}px`).toBeLessThanOrEqual(1)
}
