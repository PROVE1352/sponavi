import { test, expect, type Page } from '@playwright/test'
import { PERSONA_IDS, openDemo, startPersona, stream } from './helpers'

// 릴리스 게이트 9 (PRD §9-9) —
//   "칩 경로 P1~P5가 LLM off 상태로 e2e 완주(강등 라벨 포함) + 채팅 스트림 axe critical 0"
// 여기서는 앞 절을 지킨다(axe 는 axe.spec.ts).
//   · 목 모드(VITE_MOCK=1) = LLM off 와 동등: 부팅 즉시 칩 모드 + 강등 라벨 상시.
//   · 칩 입력은 /api/chat/* 를 단 한 번도 호출하지 않는다(ARCHITECTURE §11.1 · FR-12 AC7 고지의 근거).

// 페르소나별 "완주했다"의 증거 카드.
const EXPECTED: Record<string, (page: Page) => Promise<void>> = {
  P1: async (page) => {
    const card = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
    await expect(card.getByText('예상 자격', { exact: true })).toBeVisible()
  },
  P2: async (page) => {
    await expect(stream(page).getByTestId('alt-routes-block')).toBeVisible()
  },
  P3: async (page) => {
    const card = stream(page).getByRole('article', {
      name: '장애인스포츠강좌이용권 예상 자격 결과',
      exact: true,
    })
    await expect(card.getByText('예상 자격', { exact: true })).toBeVisible()
    await expect(stream(page).getByTestId('voucher-gap-block')).toBeVisible()
  },
  P4: async (page) => {
    await expect(stream(page).getByRole('alert').filter({ hasText: '가맹시설이 없습니다' })).toBeVisible()
  },
  P5: async (page) => {
    await expect(stream(page).getByTestId('selection-block')).toContainText('우선순위제')
    await expect(stream(page).getByTestId('now-available-item')).toHaveCount(3)
  },
}

for (const id of PERSONA_IDS) {
  test(`게이트9 · ${id} 칩 경로 완주 (LLM off · 강등 라벨 · 챗 엔드포인트 0회)`, async ({ page }) => {
    const chatCalls: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/chat/')) chatCalls.push(`${r.method()} ${r.url()}`)
    })

    await openDemo(page)

    // 강등 라벨(FR-12 AC4): AI 인 척 하지 않고 "규칙 기반 모드"임을 상시 표기한다.
    await expect(page.getByTestId('chips-mode-label')).toHaveText(
      '지금은 규칙 기반 모드예요 — 버튼으로 선택해 주세요.',
    )

    await startPersona(page, id)

    // 완주 = 경로 카드 + 자격 카드 + 시설 요약 + 후속 칩
    await expect(stream(page).getByRole('region', { name: '추천 경로 시각화' })).toBeVisible()
    await EXPECTED[id](page)
    await expect(page.getByTestId('facility-summary')).toBeVisible()
    await expect(page.getByTestId('chip-act-map')).toBeVisible()
    await expect(page.getByTestId('chip-act-fitness')).toBeVisible()

    // 칩만으로 완주 → 챗(LLM) 엔드포인트 무호출
    expect(chatCalls, `챗 엔드포인트 호출:\n${chatCalls.join('\n')}`).toHaveLength(0)
  })
}

test('게이트9 · 후속 칩(FAQ → 지도 → 처음부터)으로 대화가 이어진다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P1')

  // FAQ 칩 → 확인된 답변 카드(출처·확인일 동반)
  await page.getByTestId('chip-faq-dvoucher_income').click()
  const faq = stream(page).getByTestId('faq-answer')
  await expect(faq).toBeVisible()
  await expect(faq).toContainText('소득과 관계없이')
  await expect(faq).toContainText('확인일 2026-07-20')
  // 답변 본문은 원문 줄바꿈을 그대로 살린다(서버 사전의 여러 줄 답변이 한 줄로 뭉치지 않게)
  const ws = await page
    .getByTestId('faq-answer-body')
    .evaluate((el) => getComputedStyle(el).whiteSpace)
  expect(ws).toBe('pre-line')

  // 지도 칩 → 컨텍스트 패널 열림
  await page.getByTestId('chip-act-map').click()
  await expect(page.getByTestId('panel-tab-map')).toHaveAttribute('aria-selected', 'true')

  // 처음부터 → 확인 질문 → 예 → 대화 초기화 + 퀵스타트 칩 재제시
  await page.getByTestId('chip-act-restart').click()
  await expect(stream(page).getByText(/처음부터 다시 시작할까요/)).toBeVisible()
  await page.getByTestId('chip-restart-yes').click()
  await expect(stream(page).getByText('처음부터 다시 시작할게요.')).toBeVisible()
  await expect(page.getByTestId('chip-persona-P1')).toBeVisible()
  // 초기화 = 지난 판정 컨텍스트(패널·카드)도 함께 사라진다(P-3 비저장)
  await expect(page.getByTestId('context-panel')).toHaveCount(0)
  await expect(stream(page).getByTestId('assess-cards')).toHaveCount(0)
})
