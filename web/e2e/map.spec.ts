import { test, expect, type Page } from '@playwright/test'
import {
  expectMapMounted,
  mapBox,
  mapMarkers,
  openDemo,
  openPanel,
  panel,
  startPersona,
} from './helpers'

// 지도(v1.8) — MapLibre GL + OpenFreeMap 벡터 타일. 여기서 지키는 계약 넷:
//   ① 캔버스 + DOM 마커가 실제로 붙는다(패널 상주 1인스턴스)
//   ② 마커는 색 + 이름/분류 텍스트 + aria 삼중 인코딩(색맹 안전) — 색만으로 의미를 주지 않는다
//   ③ "© OpenStreetMap 기여자" 저작자표시가 지도 안에 항상 있다(제거 금지, 라이선스 의무)
//   ④ 타일이 하나도 못 와도 지도 카드·범례·시설 목록은 살아 있다(지도는 보조 표면)

// CSS 변수 3색의 실제 값(index.css @theme). 마커 배경색이 이 값에서 벗어나면
// 범례와 지도가 어긋난다 — 그래서 범례가 아니라 실제 렌더 색을 잰다.
const COLOR = {
  voucher: 'rgb(3, 105, 161)', // --color-marker-voucher (파랑)
  public: 'rgb(4, 120, 87)', // --color-marker-public (초록)
  disability: 'rgb(124, 58, 237)', // --color-marker-disability (보라)
} as const

function markersOfKind(page: Page, kind: string) {
  return mapMarkers(page).and(page.locator(`[data-kind="${kind}"]`))
}

async function bg(page: Page, kind: string): Promise<string> {
  return markersOfKind(page, kind)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
}

test('P1 지도 — 캔버스 + 마커가 붙고, 마커는 색·텍스트·aria 삼중 인코딩이다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P1')
  await openPanel(page, 'map')
  await expectMapMounted(page)

  // 내 위치 1 + 가맹 4 + 공공 1 (목 데이터 성북구)
  await expect(mapMarkers(page)).toHaveCount(6)
  await expect(markersOfKind(page, 'person')).toHaveCount(1)
  await expect(markersOfKind(page, 'voucher')).toHaveCount(4)
  await expect(markersOfKind(page, 'public')).toHaveCount(1)

  // 대체텍스트: 이름 · 분류 · 거리(또는 근사 안내)까지 낭독된다
  const voucher = markersOfKind(page, 'voucher').first()
  const label = await voucher.getAttribute('aria-label')
  expect(label).toContain('이용권 가맹')
  await expect(voucher).toHaveAttribute('title', String(label)) // 마우스 호버도 같은 문구
  // 목 데이터의 가맹시설은 좌표가 구 중심(centroid) — 거리 대신 근사 사실을 말한다
  expect(label).toContain('위치 근사')

  await expect(markersOfKind(page, 'person')).toHaveAttribute('aria-label', '내 위치')

  // 색은 디자인 토큰 그대로(파랑=가맹, 초록=공공)
  expect(await bg(page, 'voucher')).toBe(COLOR.voucher)
  expect(await bg(page, 'public')).toBe(COLOR.public)

  // 캔버스는 스크린리더에 지역(region)으로 이름이 붙는다
  await expect(mapBox(page).locator('canvas.maplibregl-canvas')).toHaveAttribute(
    'aria-label',
    '근처 스포츠 자원 지도',
  )
})

test('P5 지도 — 장애인 가맹은 보라, 공공은 초록으로 갈린다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P5')
  await openPanel(page, 'map')
  await expectMapMounted(page)

  await expect(markersOfKind(page, 'dvoucher')).toHaveCount(1)
  const d = markersOfKind(page, 'dvoucher').first()
  expect(await d.getAttribute('aria-label')).toContain('장애인 가맹')
  expect(await bg(page, 'dvoucher')).toBe(COLOR.disability)
  expect(await bg(page, 'public')).toBe(COLOR.public)
})

test('저작자표시 — © OpenStreetMap 기여자 + OpenFreeMap 이 지도 안에 있다', async ({ page }) => {
  await openDemo(page)
  await startPersona(page, 'P1')
  await openPanel(page, 'map')
  await expectMapMounted(page)

  const attrib = mapBox(page).locator('.maplibregl-ctrl-attrib')
  await expect(attrib).toBeVisible()
  // 문구는 항상 지도 안에 있다(우리가 넣는 OSM 기여자 + 타일 소스의 제공자 표기)
  await expect(attrib).toContainText('OpenStreetMap 기여자')
  await expect(attrib).toContainText('OpenFreeMap')
  await expect(attrib).toContainText('OpenMapTiles')

  // 좁은 카드라 compact(ⓘ)로 접혀 있다 — 한 번 눌러 읽을 수 있어야 한다
  const inner = attrib.locator('.maplibregl-ctrl-attrib-inner')
  if (!(await inner.isVisible())) {
    await attrib.locator('summary.maplibregl-ctrl-attrib-button').click()
  }
  await expect(inner).toBeVisible()

  // 펼친 상태에서 저작권 링크가 실제로 눌린다(라이선스 링크 유지)
  await expect(inner.getByRole('link', { name: 'OpenStreetMap' }).first()).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  )
})

test('타일이 전부 실패해도 지도 카드·범례·시설 목록은 살아 있다', async ({ page }) => {
  // 스타일 JSON·타일·글리프·스프라이트 전부 차단 = 오프라인/타일 장애 상황
  await page.route('**tiles.openfreemap.org/**', (r) => r.abort())

  await openDemo(page)
  await startPersona(page, 'P1')
  await openPanel(page, 'map')

  // 지도는 살아 있고(캔버스·마커·저작자표시·범례), 앱은 죽지 않는다
  await expectMapMounted(page)
  await expect(mapBox(page).locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')
  const legend = panel(page).getByTestId('map-legend')
  await expect(legend).toBeVisible()
  await expect(legend).toContainText('이용권 가맹')
  await expect(legend).toContainText('공공/대안')
  await expect(legend).toContainText('장애인 가맹')

  // 정보는 목록으로도 완결된다(지도 없이도 같은 정보 — FR-12 AC3)
  await page.getByTestId('panel-tab-list').click()
  await expect(panel(page).getByTestId('voucher-section')).toBeVisible()
})
