import { test, expect, type Page, type Route } from '@playwright/test'
import { openMain, pickAge, pickRegion, pickSpecial, settleTypewriter, stream } from './helpers'

// 2027 확대 대상(정부 예산안 · 국회 심의 전) — 웹 레인.
//   ① 5~18세 · 소득 '그외' 에게만 "혹시 아래에 해당하나요?" 다중 선택(해당 없음 배타) — LLM 0회 칩 경로
//   ② svoucher ✗ 카드에 next_year 블록: 대상 가능(eligible) / 조용한 한 줄(비대상). 2026 ✗ 판정은 그대로,
//      "지금 바로 되는 것 N가지" 에는 섞이지 않는다.
//   ③ 헤더 "글씨 크게" — aria-pressed · <html>.text-large · 새로고침 뒤에도 유지 · 390px 가로 넘침 없음

const QUIET_LINE =
  '2027년부터 3자녀 이상 가구·북한이탈주민·인구감소지역 유·청소년도 대상에 들어갈 예정이에요(정부 예산안)'

// ── ① 질문 ──────────────────────────────────────────────────────────────

async function toIncome(page: Page, age: number) {
  await openMain(page)
  await pickAge(page, age)
  await page.getByTestId('chip-sex-M').click()
  await pickRegion(page, '11290')
}

test('① 16세 · 그외 → 2027 대상 다중 선택 질문(해당 없음 배타) → 장애 질문으로 이어진다', async ({ page }) => {
  await toIncome(page, 16)
  await page.getByTestId('chip-income-그외').click()

  const q = stream(page).getByTestId('question-special')
  await expect(q).toBeVisible()
  await expect(q).toContainText('내년(2027)부터 새로 지원 대상에 들어갈 예정이에요')

  const multi = page.getByTestId('chip-special-multichild')
  const defector = page.getByTestId('chip-special-defector')
  const none = page.getByTestId('chip-special-none')
  const confirm = page.getByTestId('chip-special-confirm')
  await expect(multi).toHaveText('3자녀 이상 가구')
  await expect(defector).toHaveText('북한이탈주민')
  await expect(none).toHaveText('해당 없음')

  // 아무것도 안 골랐으면 완료를 누를 수 없다
  await expect(confirm).toBeDisabled()

  // 두 항목 동시 선택 → 해당 없음을 누르면 둘 다 풀린다(배타)
  await multi.click()
  await defector.click()
  await expect(multi).toHaveAttribute('aria-checked', 'true')
  await expect(defector).toHaveAttribute('aria-checked', 'true')
  await none.click()
  await expect(none).toHaveAttribute('aria-checked', 'true')
  await expect(multi).toHaveAttribute('aria-checked', 'false')
  await expect(defector).toHaveAttribute('aria-checked', 'false')
  // 다른 항목을 고르면 해당 없음이 풀린다
  await multi.click()
  await expect(none).toHaveAttribute('aria-checked', 'false')
  await expect(multi).toHaveAttribute('aria-checked', 'true')

  await confirm.click()
  await expect(stream(page).getByText('2027 대상: 3자녀 이상 가구')).toBeVisible()
  // 답한 질문은 잠긴다(칩이 걷히고 선택 표시만)
  await expect(page.getByTestId('chip-special-multichild')).toHaveCount(0)
  await expect(page.getByTestId('chip-dis-no')).toBeVisible()
})

test('① 조건 밖(27세 그외 · 16세 기초생활수급)에는 묻지 않는다', async ({ page }) => {
  await toIncome(page, 27)
  await page.getByTestId('chip-income-그외').click()
  await expect(page.getByTestId('chip-dis-no')).toBeVisible()
  await expect(page.getByTestId('question-special')).toHaveCount(0)

  await toIncome(page, 16)
  await page.getByTestId('chip-income-기초생활수급').click()
  await expect(page.getByTestId('chip-dis-no')).toBeVisible()
  await expect(page.getByTestId('question-special')).toHaveCount(0)
})

// ── ② next_year 블록 ─────────────────────────────────────────────────────

// 목 모드(목 엔진이 next_year 를 만든다): 16세 · 성북구 · 그외 · 3자녀 → "대상이 될 수 있어요".
test('② 목 엔진: 16세 그외 3자녀 → svoucher ✗ 그대로 + 2027 대상 가능 블록', async ({ page }) => {
  await toIncome(page, 16)
  await page.getByTestId('chip-income-그외').click()
  await pickSpecial(page, ['multichild'])
  await page.getByTestId('chip-dis-no').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await settleTypewriter(page)

  const card = stream(page).getByRole('article', { name: '스포츠강좌이용권 예상 자격 결과', exact: true })
  await expect(card).toContainText('해당 없음') // 2026 ✗ 는 손대지 않는다
  const block = card.getByTestId('next-year-block')
  await expect(block).toHaveAttribute('data-eligible', 'true')
  await expect(block).toContainText('2027년부터 대상이 될 수 있어요')
  await expect(block).toContainText('2027년 정부 예산안 · 국회 확정 전')
  await expect(block).toContainText('월 10만 5천 원')
  await expect(block.getByTestId('next-year-matched')).toHaveCount(1)
  await expect(block.getByTestId('next-year-sources').getByRole('link').first()).toBeVisible()
  await expect(block.getByTestId('next-year-sources')).toContainText('확인일')

  // 히어로("지금 바로 되는 것")에는 2027 이야기가 섞이지 않는다
  const hero = stream(page).getByTestId('alt-routes-block')
  if ((await hero.count()) > 0) await expect(hero).not.toContainText('2027')
})

// 라이브 경로(route 주입): 요청 바디의 special 과 두 가지 렌더를 계약 그대로 확인한다.
const SIGUNGU = [{ cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 }]

const NEXT_YEAR_BASE = {
  year: 2027,
  basis: '2027년 정부 예산안(국회 심의 전)',
  note: '구체적인 신청 자격과 방법은 추후 국민체육진흥공단과 각 지방자치단체가 안내',
  apply_hint: '2027년 지원분 신청 시기는 공단 공고 확인',
  sources: [{ url: 'https://example.org/budget-2027', label: '예산안 보도(테스트)', checked: '2026-09-23' }],
  curated: '예산안 발표(2026-09-09)',
  subsidy_month: 105000,
}

function assessWith(nextYear: Record<string, unknown>) {
  return {
    eligibility: [
      {
        program_id: 'svoucher',
        program_name: '스포츠강좌이용권',
        eligible: false,
        reasons: [
          { field: 'age', ok: true, message: '연령 조건(만 5~18세) 충족' },
          { field: 'income', ok: false, message: '소득 조건 미충족(기초·차상위·한부모 대상)' },
        ],
        benefit: '월 10.5만원 강좌비 지원',
        apply: { how: '온라인 신청', url: 'https://svoucher.kspo.or.kr', docs: [] },
        source: { url: 'https://svoucher.kspo.or.kr', checked: '2026-07-21' },
        verified: true,
        next_year: nextYear,
      },
    ],
    path: [{ from: 'person', to: 'svoucher', edge: '자격', result: 'fail', label: '소득' }],
    alt_edges: [
      {
        to: 'public_sports',
        note: '공공체육시설',
        curated: '공식 확인(테스트)',
        program: { id: 'public', name: '공공체육시설 강좌', benefit: '누구나 이용', apply_url: null },
      },
    ],
    nearby: { voucher_facilities: [], alternatives: [], primary: 'alternatives' },
    supply_gap: {
      radius_km: 3,
      voucher_count: 0,
      voucher_scope: 'sigungu',
      sigungu_nm: '성북구',
      alt_count: 0,
      nearest: null,
      message: '테스트',
      coverage: null,
    },
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function liveFlow(page: Page, special: string[], nextYear: Record<string, unknown>) {
  const bodies: Record<string, unknown>[] = []
  await page.route('**/api/meta/sigungu', (r) => json(r, SIGUNGU))
  await page.route('**/api/chat/faq', (r) => json(r, []))
  await page.route('**/api/health', (r) => json(r, { status: 'ok', data_built: '2026-07-20' }))
  await page.route('**/api/accessibility**', (r) => json(r, {}))
  await page.route('**/api/assess', (r) => {
    bodies.push(JSON.parse(r.request().postData() ?? '{}'))
    return json(r, assessWith(nextYear))
  })
  await page.goto('/?live=1')
  await expect(page.getByTestId('chip-ageband-10s')).toBeVisible()
  await pickAge(page, 16)
  await page.getByTestId('chip-sex-F').click()
  // 시군구가 하나뿐인 시도는 2단계 없이 그 자리에서 확정된다(세종과 같은 경로)
  await page.getByTestId('chip-sido-11').click()
  await page.getByTestId('chip-income-그외').click()
  await pickSpecial(page, special)
  await page.getByTestId('chip-dis-no').click()
  await expect(stream(page).getByTestId('assess-cards')).toBeVisible()
  await settleTypewriter(page)
  return bodies
}

test('② 라이브 계약: special 이 요청에 실리고, eligible=true 블록이 matched·금액·근거를 보인다', async ({ page }) => {
  const bodies = await liveFlow(page, ['multichild', 'defector'], {
    ...NEXT_YEAR_BASE,
    eligible: true,
    matched: [
      { id: 'multichild', label: '3자녀 이상 다자녀가구', detail: '3자녀 이상 다자녀가구 — 본인 응답' },
      { id: 'defector', label: '북한이탈주민', detail: '본인 응답' },
    ],
    possible_if: ['인구감소지역 거주 유·청소년'],
  })
  expect(bodies).toHaveLength(1)
  expect(bodies[0].special).toEqual(['multichild', 'defector'])

  const block = stream(page).getByTestId('next-year-block')
  await expect(block).toHaveAttribute('data-eligible', 'true')
  await expect(block.getByTestId('next-year-matched')).toHaveCount(2)
  await expect(block).toContainText('3자녀 이상 다자녀가구')
  await expect(block).toContainText('월 10만 5천 원')
  await expect(block).toContainText('2027년 정부 예산안 · 국회 확정 전')
  await expect(block).toContainText(NEXT_YEAR_BASE.note)
  await expect(block).toContainText(NEXT_YEAR_BASE.apply_hint)
  await expect(block.getByRole('link', { name: '예산안 보도(테스트)' })).toHaveAttribute(
    'href',
    'https://example.org/budget-2027',
  )
  await expect(block).toContainText('확인일 2026-09-23')

  // "지금 바로 되는 것 N가지" 의 N 은 공식 확인 대안 수(1)뿐 — 2027 은 세지 않는다
  const hero = stream(page).getByTestId('alt-routes-block')
  await expect(hero).toContainText('지금 바로 되는 것 1가지')
  await expect(hero).not.toContainText('2027')
})

test('② 라이브 계약: 해당 없음 → special [] · eligible=false 는 조용한 한 줄 + 출처만', async ({ page }) => {
  const bodies = await liveFlow(page, ['none'], {
    ...NEXT_YEAR_BASE,
    eligible: false,
    matched: [],
    possible_if: ['3자녀 이상 다자녀가구', '북한이탈주민', '인구감소지역 거주 유·청소년'],
  })
  expect(bodies[0].special).toEqual([])

  const block = stream(page).getByTestId('next-year-block')
  await expect(block).toHaveAttribute('data-eligible', 'false')
  await expect(block).toContainText(QUIET_LINE)
  await expect(block).not.toContainText('대상이 될 수 있어요')
  await expect(block).not.toContainText('10만 5천')
  await expect(block.getByTestId('next-year-sources')).toContainText('확인일 2026-09-23')
})

// ── ③ 글씨 크게 ─────────────────────────────────────────────────────────

test('③ 글씨 크게: aria-pressed · <html> 클래스 · 글자 실제로 커짐 · 새로고침 유지 · 390px 넘침 없음', async ({
  page,
}) => {
  await openMain(page)
  const toggle = page.getByTestId('text-size-toggle')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  const chip = page.getByTestId('chip-ageband-20s')
  const before = await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/(^|\s)text-large(\s|$)/)
  const after = await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(after).toBeGreaterThan(before * 1.1)
  // px 임의값 글자(헤더 로고 22px)도 같이 커진다
  const logo = await page
    .locator('header a[href="#top"] span')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(logo).toBeGreaterThan(22 * 1.1)

  const noOverflow = async () => {
    const m = await page.evaluate(() => {
      const h = document.querySelector('header > div') as HTMLElement
      return {
        doc: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        header: h.scrollWidth - h.clientWidth,
      }
    })
    expect(m.doc).toBeLessThanOrEqual(m.vw)
    expect(m.header).toBeLessThanOrEqual(0)
  }
  await noOverflow()

  await page.reload()
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/(^|\s)text-large(\s|$)/)
  await expect(page.getByTestId('text-size-toggle')).toHaveAttribute('aria-pressed', 'true')
  await noOverflow()

  // 다시 끄면 새로고침 뒤에도 꺼진 채
  await page.getByTestId('text-size-toggle').click()
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)text-large(\s|$)/)
  await page.reload()
  await expect(page.getByTestId('chip-ageband-20s')).toBeVisible()
  await expect(page.getByTestId('text-size-toggle')).toHaveAttribute('aria-pressed', 'false')
})

test('③ 글씨 크게: 데모 페이지 헤더(데모 배지 포함)도 390px 에서 넘치지 않는다', async ({ page }) => {
  await page.goto('/#/demo')
  await expect(page.getByTestId('chip-persona-P1')).toBeVisible()
  await page.getByTestId('text-size-toggle').click()
  const m = await page.evaluate(() => {
    const h = document.querySelector('header > div') as HTMLElement
    return { doc: document.documentElement.scrollWidth, vw: window.innerWidth, header: h.scrollWidth - h.clientWidth }
  })
  expect(m.doc).toBeLessThanOrEqual(m.vw)
  expect(m.header).toBeLessThanOrEqual(0)
})
