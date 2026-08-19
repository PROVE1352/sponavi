import { test, expect, type Route } from '@playwright/test'
import { openMain, pickAge, stream } from './helpers'

// 지역 질문 v1.7 계약(PRD FR-12 AC1) — 인라인 검색창 제거, 연령과 같은 2단계 칩.
//   ① 시도 → 시군구 칩만으로 완주 · 검색 input 은 화면 어디에도 없다
//   ② 시군구가 1곳뿐인 시도(세종)는 시도를 고른 순간 확정된다
//   ③ 컴포저 자유입력은 칩/강등 모드에서도 클라이언트 로컬 결정론 매칭으로 동작한다
//      (정확 1건 → 확정 · 복수 → 후보 칩 재질문 · 0건 → 못 찾았다고 말하고 다시 질문)
//   ⑥ 정정 칩은 2단계 흐름 전체를 다시 연다
// 목 모드(VITE_MOCK=1)는 부팅 즉시 칩 모드라 ③④⑤의 경로가 그대로 검증된다(LLM 무호출).
// ⑥만 NLU 에코가 필요해 ?live=1 + route 주입으로 돈다.

// 성별까지 답해 지역 질문(1단계)을 열어 둔 상태로 만든다.
async function openRegionQuestion(page: import('@playwright/test').Page) {
  await openMain(page)
  await pickAge(page, 27)
  await page.getByTestId('chip-sex-M').click()
  await expect(stream(page).getByTestId('question-region_sido')).toBeVisible()
}

async function send(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-send').click()
}

test('① 지역은 시도 → 시군구 2단계 칩 — 인라인 검색창은 없다', async ({ page }) => {
  await openRegionQuestion(page)

  // 검색 input 은 스트림에도 컴포저에도 없다(v1.6 의 region-search 는 폐기)
  await expect(page.getByTestId('region-search')).toHaveCount(0)

  // 1단계: 데이터에 실제로 있는 시도만 칩으로 뜬다(하드코딩 전수 렌더 금지)
  const sidoQ = stream(page).getByTestId('question-region_sido')
  await expect(sidoQ.getByTestId('chip-sido-11')).toHaveText(/서울/)
  await expect(sidoQ.getByTestId('chip-sido-28')).toHaveText(/인천/)
  // 목 데이터에 없는 시도(대전 30)는 렌더되지 않는다
  await expect(page.getByTestId('chip-sido-30')).toHaveCount(0)

  // 2단계: 고른 시도의 시군구만, 라벨은 nm 그대로
  await sidoQ.getByTestId('chip-sido-11').click()
  const regionQ = stream(page).getByTestId('question-region')
  await expect(regionQ).toContainText('서울 안에서')
  await expect(regionQ.getByTestId('chip-region-11290')).toHaveText('성북구')
  await expect(regionQ.getByTestId('chip-region-28260')).toHaveCount(0) // 다른 시도는 섞이지 않는다

  await regionQ.getByTestId('chip-region-11290').click()
  await expect(regionQ.getByTestId('chip-answered')).toContainText('성북구 선택함')

  // 남은 슬롯을 채우면 그대로 판정까지 완주한다
  await page.getByTestId('chip-income-기초생활수급').click()
  await page.getByTestId('chip-dis-no').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(stream(page).getByText(/성북구/).first()).toBeVisible()
})

test('② 시군구가 1곳뿐인 시도(세종)는 시도를 고른 순간 확정된다', async ({ page }) => {
  await openRegionQuestion(page)

  await page.getByTestId('chip-sido-36').click()

  // 2단계를 묻지 않고 다음 질문(소득)으로 넘어간다
  await expect(stream(page).getByTestId('question-region')).toHaveCount(0)
  await expect(page.getByTestId('chip-income-기초생활수급')).toBeVisible()

  // 에코·잠금 마커는 고른 시도가 아니라 확정된 시군구 이름으로 남는다
  await expect(stream(page).getByText('지역: 세종특별자치시')).toBeVisible()
  await expect(
    stream(page).getByTestId('question-region_sido').getByTestId('chip-answered'),
  ).toContainText('세종특별자치시 선택함')
})

test('③ 컴포저에 "성북구" — 칩 모드에서도 로컬 매칭으로 바로 확정된다 (LLM 무호출)', async ({
  page,
}) => {
  const chatCalls: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/chat/')) chatCalls.push(r.url())
  })

  await openRegionQuestion(page)
  await send(page, '성북구')

  // 자유 입력은 사용자 버블로 남고, 지역은 칩을 누른 것과 똑같이 확정된다
  await expect(stream(page).getByText('성북구', { exact: true }).first()).toBeVisible()
  await expect(
    stream(page).getByTestId('question-region_sido').getByTestId('chip-answered'),
  ).toContainText('성북구 선택함')
  // 강등 안내로 새지 않는다(지역 질문이 열려 있으면 로컬 매칭이 답한다)
  await expect(stream(page).getByText('지금은 규칙 기반 모드예요 — 버튼으로 선택해 주세요.')).toHaveCount(
    0,
  )

  // 다음 질문으로 넘어가고 판정까지 완주 — 확정된 시군구가 실제로 슬롯에 들어갔다
  await page.getByTestId('chip-income-기초생활수급').click()
  await page.getByTestId('chip-dis-no').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await expect(stream(page).getByText(/성북구/).first()).toBeVisible()

  expect(chatCalls, `챗 엔드포인트 호출:\n${chatCalls.join('\n')}`).toHaveLength(0)
})

test('④ 컴포저에 "서구" — 동명 지역은 후보 칩으로 되묻고, 없는 이름은 못 찾았다고 말한다', async ({
  page,
}) => {
  await openRegionQuestion(page)
  await send(page, '서구')

  // 복수 후보: 같은 이름이 여러 시도에 있으므로 시도 통칭을 붙여 구분해 준다
  await expect(stream(page).getByText('같은 이름의 지역이 여러 곳이에요. 어디신가요?')).toBeVisible()
  const cands = stream(page).locator('[data-testid^="chip-region-"]')
  await expect(cands).toHaveCount(4)
  await expect(page.getByTestId('chip-region-28260')).toHaveText('인천 서구')
  await expect(page.getByTestId('chip-region-26140')).toHaveText('부산 서구')

  // 후보 칩은 살아 있는 질문이라 그대로 확정된다
  await page.getByTestId('chip-region-28260').click()
  await expect(page.getByTestId('chip-income-기초생활수급')).toBeVisible()
  await expect(stream(page).getByText('지역: 인천 서구')).toBeVisible()
})

test('⑤ 목록에 없는 지역명은 지어내지 않고 다시 묻는다', async ({ page }) => {
  await openRegionQuestion(page)
  await send(page, '없는동네시')

  await expect(
    stream(page).getByText(/그 이름의 지역을 목록에서 찾지 못했어요/),
  ).toBeVisible()
  // 다시 고를 수 있게 같은 단계의 칩을 새로 내어 준다(슬롯은 비어 있는 채)
  await expect(stream(page).getByTestId('question-region_sido')).toHaveCount(2)
  await expect(page.getByTestId('chip-sido-11')).toBeVisible()
  await expect(page.getByTestId('chip-income-기초생활수급')).toHaveCount(0)
})

test('⑥ 지역 정정 칩은 2단계(시도 → 시군구) 흐름 전체를 다시 연다', async ({ page }) => {
  // 정정 칩은 NLU 가 슬롯을 갱신했을 때의 에코에서 나온다 → ?live=1 + route 로 응답을 준다.
  const json = (r: Route, body: unknown) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/meta/sigungu', (r) =>
    json(r, [
      { cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 },
      { cd: '11305', nm: '강북구', lat: 37.6396, lon: 127.0257 },
      { cd: '28260', nm: '서구', lat: 37.5455, lon: 126.6759 },
    ]),
  )
  await page.route('**/api/chat/faq', (r) => json(r, []))
  await page.route('**/api/chat/nlu', (r) =>
    json(r, {
      slot_updates: { sigungu_cd: '11290', sigungu_nm: '성북구' },
      intent: 'provide_info',
      faq_key: null,
      region_candidates: [],
      reply: null,
      provider: 'openai',
    }),
  )

  await page.goto('/?live=1')
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
  await pickAge(page, 27)
  await page.getByTestId('chip-sex-M').click()
  await page.getByTestId('composer-input').fill('성북구 살아요')
  await page.getByTestId('composer-send').click()

  // NLU 에코 = 정정 칩("지역 성북구")
  const edit = page.getByTestId('chip-edit-region')
  await expect(edit).toHaveText(/지역 성북구/)

  await edit.click()
  // 1단계부터 다시 — 시도 칩이 열리고, 시군구 칩은 아직 없다
  await expect(stream(page).getByTestId('question-region_sido').last()).toBeVisible()
  await expect(page.getByTestId('chip-sido-11')).toBeVisible()
  await expect(page.getByTestId('chip-sido-28')).toBeVisible()
  await expect(page.getByTestId('chip-region-11290')).toHaveCount(0)

  await page.getByTestId('chip-sido-11').click()
  await expect(page.getByTestId('chip-region-11290')).toBeVisible()
  await expect(page.getByTestId('chip-region-11305')).toBeVisible()
})
