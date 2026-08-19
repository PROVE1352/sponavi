import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { settleTypewriter, stream } from './helpers'

// 접지 답변 레인(v1.9 · PRD FR-13 AC9 · API.md `/api/chat/nlu` 의 `answer`).
//   ① answer + faq_key → 나비 버블이 answer 를 말하고, 그 아래 컴팩트 출처 카드가 붙는다
//      (같은 턴의 reply 는 쓰지 않는다 — 버블 두 개가 잇달아 나오면 수다스럽다).
//      정직성(§6 사전): 버블 보조 줄에 "AI 안내 · 출처는 아래 카드에서 확인해 주세요".
//   ② answer=null + faq_key → v1.8 까지의 전체 FAQ 카드 그대로(폐기 시 카드 폴백 회귀).
// 목 모드는 NLU 를 호출하지 않으므로(칩 모드) ?live=1 + route 주입으로 돈다.

const SIGUNGU = [{ cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 }]

const FAQ = [
  {
    key: 'dvoucher_income',
    q: '장애인 이용권도 소득 기준이 있나요?',
    answer:
      '장애인스포츠강좌이용권은 소득과 관계없이 신청할 수 있습니다.\n다만 선정은 우선순위제라, 예산에 따라 대기가 생길 수 있습니다.',
    source_url: 'https://dvoucher.kspo.or.kr',
    checked: '2026-07-20',
  },
]

// 서버 fact-lock 을 통과했다고 가정한 접지 답변(재료 = 위 FAQ 사전 전문).
const GROUNDED =
  '장애인스포츠강좌이용권은 소득과 관계없이 신청할 수 있어요. 다만 선정은 우선순위제라 예산에 따라 대기가 생길 수 있어요.'
// 같은 턴에 딸려 온 연결 멘트 — answer 가 있으면 화면에 쓰이지 않아야 한다.
const REPLY = '궁금하실 만한 부분이에요.'
const SUB_WITH_CARD = 'AI 안내 · 출처는 아래 카드에서 확인해 주세요'

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

// answer 만 갈아끼우고 나머지 주변 엔드포인트는 성공으로 고정한다.
async function stubNlu(page: Page, answer: string | null) {
  await page.route('**/api/meta/sigungu', (r) => json(r, SIGUNGU))
  await page.route('**/api/chat/faq', (r) => json(r, FAQ))
  await page.route('**/api/health', (r) => json(r, { status: 'ok', data_built: '2026-07-20' }))
  await page.route('**/api/chat/nlu', (r) =>
    json(r, {
      slot_updates: {},
      intent: 'ask_faq',
      faq_key: 'dvoucher_income',
      region_candidates: [],
      reply: REPLY,
      answer,
      provider: 'openai',
    }),
  )
}

async function ask(page: Page, text: string) {
  await page.goto('/?live=1')
  await expect(stream(page)).toBeVisible()
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-send').click()
  await settleTypewriter(page)
}

test('① answer + faq_key → 접지 답변 버블 + 컴팩트 출처 카드 + AI 안내 보조 줄 (FR-13 AC9)', async ({
  page,
}) => {
  await stubNlu(page, GROUNDED)
  await ask(page, '장애인 이용권도 소득 기준이 있나요?')

  // 본문은 나비 버블이 말한다(카드 본문 재탕이 아니라 answer 그대로)
  await expect(stream(page).getByText(GROUNDED)).toBeVisible()
  // reply 와 둘 다 왔지만 화면에는 answer 만 — 연속 버블 금지
  await expect(stream(page).getByText(REPLY)).toHaveCount(0)

  // 정직성 보조 줄(§6 사전) — 이모지 없이 "AI 안내"임을 밝히고 출처를 가리킨다
  const sub = stream(page).getByTestId('bot-sub').filter({ hasText: 'AI 안내' })
  await expect(sub).toHaveText(SUB_WITH_CARD)

  // 출처 카드는 딱 1장, 컴팩트 형태(질문 제목 + 출처·확인일만 펼침)
  const card = stream(page).getByTestId('faq-answer')
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-compact', 'true')
  await expect(card).toContainText('장애인 이용권도 소득 기준이 있나요?')
  await expect(card).toContainText('확인일 2026-07-20')
  await expect(card.getByRole('link', { name: 'https://dvoucher.kspo.or.kr' })).toBeVisible()

  // 중복 본문은 접혀 있고(같은 사실을 두 번 읽히지 않는다), 펴면 원문 그대로 볼 수 있다
  const body = card.getByTestId('faq-answer-body')
  await expect(body).toBeHidden()
  await card.getByTestId('faq-answer-fold').locator('summary').click()
  await expect(body).toBeVisible()
  await expect(body).toContainText('소득과 관계없이')

  const vios = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const critical = vios.violations.filter((v) => v.impact === 'critical')
  expect(
    critical,
    `axe 위반:\n${vios.violations.map((v) => `[${v.impact}] ${v.id}`).join('\n')}`,
  ).toHaveLength(0)
})

test('② answer=null + faq_key → 기존 전체 FAQ 카드로 폴백 (v1.8 회귀)', async ({ page }) => {
  await stubNlu(page, null)
  await ask(page, '장애인 이용권도 소득 기준이 있나요?')

  // 접지 답변이 폐기됐으므로 이 턴의 본문은 카드가 말한다 — 보조 줄도 없다
  await expect(stream(page).getByTestId('bot-sub').filter({ hasText: 'AI 안내' })).toHaveCount(0)
  // answer 가 없을 때만 연결 멘트(reply)가 쓰인다
  await expect(stream(page).getByText(REPLY)).toBeVisible()

  const card = stream(page).getByTestId('faq-answer')
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-compact', 'false')
  // 본문은 접히지 않고 처음부터 펼쳐진 상태(줄바꿈 보존도 그대로)
  await expect(card.getByTestId('faq-answer-fold')).toHaveCount(0)
  const body = card.getByTestId('faq-answer-body')
  await expect(body).toBeVisible()
  await expect(body).toContainText('소득과 관계없이')
  expect(await body.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-line')
  await expect(card).toContainText('확인일 2026-07-20')
})
