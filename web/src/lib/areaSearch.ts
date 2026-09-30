// "이 지역에서 다시 찾기"(GET /api/facilities/in-bounds) — 웹 쪽 순수 함수·상수·문구 1벌.
//
// 계약 단일 본은 mocks/contract/area_search.json 이다. 아래 상수는 그 값과 같아야 하고
// (lib/areaSearch.test.ts 가 대조한다), 서버 engine 상수도 같은 JSON 을 pytest 가 대조한다.
//
// 정직성(SPEC §0): 범위 판정은 좌표가 확인된 시설만 한다. 근사 좌표 시설은 점으로 찍지 않고
// "정확한 위치를 확인할 수 없는 N곳(시군구 전체 수)"으로 따로 말한다. 합계 숫자 하나로 뭉치지 않는다
// — 이용권과 공공 원천에 같은 시설이 있어 두 번 세게 된다.
import type { AreaBounds, FacilitySearchProgram, UnlocatedArea } from '../types_search'

export const AREA_MAX_DIAG_KM = 20
export const AREA_LIMIT = 50
export const KOREA_BOUNDS = { min_lat: 32.5, max_lat: 39.6, min_lon: 124.0, max_lon: 132.5 } as const
export const EARTH_R_KM = 6371.0088
export const Q_MAX = 30
// ⌘/Ctrl+휠 확대는 MapLibre 가 originalEvent 를 싣지 않는다 — 직전 휠 입력으로 사용자 조작을 가린다.
export const MOD_WHEEL_WINDOW_MS = 300
// 6자리 반올림에서 생기는 1e-6 차이를 흡수한다(같은 화면인가 판정).
export const BOUNDS_EPS_DEG = 5e-6

// ── 좌표·범위 ──────────────────────────────────────────────────────────────
export interface LngLatLike {
  lat: number
  lng: number
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6

export function toAreaBounds(sw: LngLatLike, ne: LngLatLike): AreaBounds {
  return {
    min_lat: round6(sw.lat),
    min_lon: round6(sw.lng),
    max_lat: round6(ne.lat),
    max_lon: round6(ne.lng),
  }
}

// store.haversine_km 과 같은 식(asin(min(1, sqrt(a)))).
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => d * (Math.PI / 180)
  const p1 = rad(lat1)
  const p2 = rad(lat2)
  const dphi = rad(lat2 - lat1)
  const dlmb = rad(lon2 - lon1)
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

// 경도 폭(max_lon − min_lon)이 이보다 크면 haversine 은 반대편 짧은 길로 재어 폭을 잃는다
// (−180~180 이면 위도 차만 남는다). 그런 범위는 대각선과 상관없이 too_wide(서버 AREA_MAX_LON_SPAN_DEG).
export const AREA_MAX_LON_SPAN_DEG = 180

// 범위 대각선(km) — 서버 engine.area_diag_km 과 같은 식. 보통은 haversine(남서 → 북동 모서리)이고,
// 경도 폭이 180° 를 넘으면 범위를 읽는 방향 그대로(서→동 긴 길) 위도 평균의 경도 호 + 위도 호로 평면 근사한다
// (거절 메시지의 "대각선 약 …km"가 위도 차 같은 거짓 숫자가 되지 않게).
export function diagKm(b: AreaBounds): number {
  if (b.max_lon - b.min_lon > AREA_MAX_LON_SPAN_DEG) {
    const rad = (d: number) => d * (Math.PI / 180)
    const dx = rad(b.max_lon - b.min_lon) * Math.cos(rad((b.min_lat + b.max_lat) / 2))
    const dy = rad(b.max_lat - b.min_lat)
    return EARTH_R_KM * Math.hypot(dx, dy)
  }
  return haversineKm(b.min_lat, b.min_lon, b.max_lat, b.max_lon)
}

export function overlapsKorea(b: AreaBounds): boolean {
  const k = KOREA_BOUNDS
  return b.max_lat >= k.min_lat && b.min_lat <= k.max_lat && b.max_lon >= k.min_lon && b.min_lon <= k.max_lon
}

export type AreaGate = 'ok' | 'invalid' | 'outside' | 'too_wide'

// 서버 검증 순서(§3.2 3~5단계)를 그대로 따른다: invalid → outside → too_wide → ok.
// bearing·pitch 가 0 이 아니면 getBounds() 가 보이는 화면과 달라지므로 invalid(방어용 — 지도 설정으로는 도달하지 않는다).
export function areaGate(b: AreaBounds, cam?: { bearing?: number; pitch?: number }): AreaGate {
  const v = [b.min_lat, b.min_lon, b.max_lat, b.max_lon]
  if (!v.every((x) => Number.isFinite(x))) return 'invalid'
  if (cam && (Math.abs(cam.bearing ?? 0) > 1e-9 || Math.abs(cam.pitch ?? 0) > 1e-9)) return 'invalid'
  if (b.min_lat < -90 || b.max_lat > 90 || b.min_lon < -180 || b.max_lon > 180) return 'invalid'
  if (!(b.min_lat < b.max_lat && b.min_lon < b.max_lon)) return 'invalid'
  if (!overlapsKorea(b)) return 'outside'
  if (diagKm(b) > AREA_MAX_DIAG_KM || b.max_lon - b.min_lon > AREA_MAX_LON_SPAN_DEG) return 'too_wide'
  return 'ok'
}

export function sameBounds(
  a: AreaBounds | null | undefined,
  b: AreaBounds | null | undefined,
  eps: number = BOUNDS_EPS_DEG,
): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.min_lat - b.min_lat) <= eps &&
    Math.abs(a.min_lon - b.min_lon) <= eps &&
    Math.abs(a.max_lat - b.max_lat) <= eps &&
    Math.abs(a.max_lon - b.max_lon) <= eps
  )
}

// ── 지도 이동 판정 ───────────────────────────────────────────────────────────
export type MoveClass = 'resize' | 'program' | 'user'
export type LastMove = 'none' | 'user' | 'program'

// movestart 한 번을 분류한다. 앱이 resize()/카메라 메서드를 부르는 동안이면 그쪽이 먼저다.
// originalEvent 가 있으면(드래그·키보드·±·더블클릭) 사용자, ⌘/Ctrl 휠 직후도 사용자.
export function classifyMoveStart(x: {
  resizing: boolean
  programmatic: boolean
  hasOriginalEvent: boolean
  msSinceModWheel: number | null
}): MoveClass {
  if (x.resizing) return 'resize'
  if (x.programmatic) return 'program'
  if (x.hasOriginalEvent) return 'user'
  if (x.msSinceModWheel != null && x.msSinceModWheel >= 0 && x.msSinceModWheel <= MOD_WHEEL_WINDOW_MS) {
    return 'user'
  }
  return 'program'
}

// 카메라 스냅샷(movestart 때 찍어 moveend 때와 비교한다).
export interface CameraSnap {
  lat: number
  lng: number
  zoom: number
  bearing: number
  pitch: number
}
export const CAMERA_EPS = 1e-9

// 카메라가 실제로 바뀌었는가. MapLibre 는 막아 둔 Shift+화살표(회전·기울기)와 줌 한계에서 누른 ±·더블클릭도
// 변화 없는 easeTo 로 처리해 originalEvent 가 달린 movestart/moveend 를 낸다 — 이것을 사용자 이동으로 세면
// 지도가 그대로인데 "이 지역에서 다시 찾기"가 뜨고 낭독된다. 시작 스냅샷이 없으면(짝이 안 맞음) 움직인 것으로 본다.
export function cameraMoved(start: CameraSnap | null | undefined, end: CameraSnap): boolean {
  if (!start) return true
  return (
    Math.abs(start.lat - end.lat) > CAMERA_EPS ||
    Math.abs(start.lng - end.lng) > CAMERA_EPS ||
    Math.abs(start.zoom - end.zoom) > CAMERA_EPS ||
    Math.abs(start.bearing - end.bearing) > CAMERA_EPS ||
    Math.abs(start.pitch - end.pitch) > CAMERA_EPS
  )
}

// 요청이 끝났을 때: 요청 뒤에 사용자가 지도를 움직이지 않았으면 버튼을 거둔다(none).
export function settleAfterRequest(lastMove: LastMove, reqSeq: number, userMoveSeq: number): LastMove {
  return reqSeq === userMoveSeq ? 'none' : lastMove
}

export type AreaControl = 'hidden' | 'loading' | 'button' | 'zoom_in' | 'outside'

export function areaControlState(x: {
  mapFailed: boolean
  requestPending: boolean
  lastMove: LastMove
  gate: AreaGate
  sameAsShown: boolean
}): AreaControl {
  if (x.mapFailed) return 'hidden'
  if (x.requestPending) return 'loading'
  if (x.lastMove !== 'user') return 'hidden'
  if (x.gate === 'invalid') return 'hidden'
  if (x.gate === 'outside') return 'outside'
  if (x.gate === 'too_wide') return 'zoom_in'
  if (x.sameAsShown) return 'hidden'
  return 'button'
}

// ── 결과 섹션 계획(0건 규칙은 섹션마다 따로) ───────────────────────────────────
export type SideResult =
  | { status: 'ok'; total: number; areas: UnlocatedArea[] }
  | { status: 'failed' }

export type SectionKind = 'rows' | 'zero+unlocated' | 'zero+guide' | 'zero' | 'failed'
export interface SectionPlan {
  kind: SectionKind
  // 위치 미상 블록을 둘 것인가(행이 있어도 areas 가 있으면 섹션 끝에 둔다)
  unlocated: boolean
}

// 실패한 쪽은 failed(0건 문구·안내·위치 미상 모두 없음 — 모르는 것을 0 으로 말하지 않는다).
// 둘 다 ok·0건·위치 미상 없음이면 neutral(원인을 단정하지 않는다).
// 이용권 0건 + 위치 미상 없음 → 일반 안내(zero+guide): 실좌표 이용권은 사실상 성북·인천 서구뿐이라
// "가맹 0곳"으로 읽히면 거짓 공급 공백이 된다. 공공 0건은 원인 문구 없이 zero.
export function areaSectionPlan(
  v: SideResult,
  p: SideResult,
): { voucher: SectionPlan; public: SectionPlan; neutral: boolean } {
  const neutral =
    v.status === 'ok' &&
    p.status === 'ok' &&
    v.total === 0 &&
    p.total === 0 &&
    v.areas.length === 0 &&
    p.areas.length === 0
  const plan = (s: SideResult, side: 'voucher' | 'public'): SectionPlan => {
    if (s.status === 'failed') return { kind: 'failed', unlocated: false }
    const has = s.areas.length > 0
    if (s.total > 0) return { kind: 'rows', unlocated: has }
    if (has) return { kind: 'zero+unlocated', unlocated: true }
    if (side === 'voucher' && !neutral) return { kind: 'zero+guide', unlocated: false }
    return { kind: 'zero', unlocated: false }
  }
  return { voucher: plan(v, 'voucher'), public: plan(p, 'public'), neutral }
}

// ── 문구(§6.12 글자 그대로) ───────────────────────────────────────────────────
export const AREA_TEXT = {
  button: '이 지역에서 다시 찾기',
  buttonLoading: '이 지역에서 찾는 중…',
  zoomHint: '지도를 조금 더 확대해 주세요',
  outside: '국내 지역에서만 찾을 수 있어요',
  liveButton: '이 지역에서 다시 찾을 수 있어요',
  liveZoom: '지도를 조금 더 확대하면 이 지역에서 다시 찾을 수 있어요',
  liveOutside: '국내 지역에서만 찾을 수 있어요',
  liveLoading: '이 지역에서 찾는 중이에요',
  barSub: '위치가 확인된 시설만 세고, 지도 가운데에서 가까운 순으로 보여요',
  unlocatedSub:
    '지도에 점으로 찍지 않았어요 · 지도 범위와 겹쳐 보이는 시군구의 전체 수라 범위 밖 시설도 섞여 있고, 겹치는 시군구 일부는 빠질 수 있어요',
  unlocatedSearch: '주소로 찾기',
  unlocatedMore: '위치 확인 안 된 곳 보기',
  neutralZero: '이 지도 범위에서 찾은 시설이 없어요.',
  reset: '원래 결과로',
  resetAnnounce: '원래 결과로 돌아왔어요',
  retry: '다시 시도',
  truncatedNote: '지도를 더 확대한 뒤 다시 찾으면 빠진 곳도 볼 수 있어요',
  barDisability: '공공·대안은 ‘장애’ 표기와 관계없이 모두 보여요',
  listDisability:
    '지도 범위 검색의 공공·대안 시설은 ‘장애’ 표기와 관계없이 모두 보여요. 이용할 수 있는지는 시설에 확인해 주세요.',
  filterNote: '지도 범위 결과에는 운동 필터가 적용되지 않아요',
  panelBasis: '내 지역 기준',
  listTitle: '지도 범위 결과',
  formHelp: '이 지도 범위 안에서 이름·주소로 찾아요',
  scopeReset: '내 지역으로',
  loading: '이 지역에서 찾는 중…',
} as const

export function countText(n: number): string {
  return `${n.toLocaleString('ko-KR')}곳`
}

const NOUNS: Record<FacilitySearchProgram, { short: string; long: string }> = {
  svoucher: { short: '이용권 가맹', long: '이용권 가맹시설' },
  dvoucher: { short: '장애인 가맹', long: '장애인 가맹시설' },
  public: { short: '공공·대안', long: '공공·대안 시설' },
}

export function programNoun(program: FacilitySearchProgram, form: 'short' | 'long'): string {
  return NOUNS[program][form]
}

export function barTitle(sameAsShown: boolean): string {
  return sameAsShown ? '이 지도 범위' : '찾았던 범위'
}

export function qIncludedText(q: string): string {
  return `‘${q}’ 포함`
}

export function dropQText(q: string): string {
  return `‘${q}’ 빼고 다시 찾기`
}

type SideCount = { status: 'ok'; total: number } | { status: 'failed' }

function sidePart(program: FacilitySearchProgram, s: SideCount): string {
  const short = programNoun(program, 'short')
  return s.status === 'failed' ? `${short} 확인 실패` : `${short} ${countText(s.total)}`
}

// `{short V} {V}곳 · 공공·대안 {P}곳` — 합계는 쓰지 않는다(두 원천에 같은 시설이 있어 이중 집계).
export function barCounts(
  voucherProgram: FacilitySearchProgram,
  v: SideCount,
  p: SideCount,
): string {
  return `${sidePart(voucherProgram, v)} · ${sidePart('public', p)}`
}

export function mapCapText(n: number): string {
  return `지도에는 가운데에서 가까운 ${countText(n)}만 찍었어요 · 더 확대한 뒤 다시 찾으면 빠진 곳도 볼 수 있어요`
}

// 위치 미상 제목. where='bar' 는 결과 막대(끝에 "· 시군구 전체 수"), 'block' 은 목록의 블록 제목.
export function unlocatedHeadline(
  program: FacilitySearchProgram,
  areas: UnlocatedArea[],
  q?: string | null,
  where: 'bar' | 'block' = 'block',
): string {
  const long = programNoun(program, 'long')
  const qPart = q ? ` ${qIncludedText(q)}` : ''
  const m = areas.reduce((s, a) => s + a.count, 0)
  const tail = `${countText(m)}은 정확한 위치를 확인할 수 없어 지도에 없어요`
  const k = areas.length
  let head: string
  if (k === 1) head = `${areas[0].display_label} ${long}${qPart} ${tail}`
  else if (where === 'bar') head = `${areas[0]?.display_label ?? ''} 등 시군구 ${k}곳의 ${long}${qPart} ${tail}`
  else head = `시군구 ${k}곳의 ${long}${qPart} ${tail}`
  return where === 'bar' ? `${head} · 시군구 전체 수` : head
}

export function unlocatedItemText(a: UnlocatedArea): string {
  return `${a.display_label} ${countText(a.count)}`
}

export function unlocatedSearchLabel(a: UnlocatedArea): string {
  return `${a.display_label}에서 이름·주소로 찾기`
}

export function searchInText(label: string): string {
  return `${label} 안에서 찾기`
}

export function voucherGuide(program: FacilitySearchProgram): string {
  return `${programNoun(program, 'long')}은 대부분 정확한 위치가 없어 지도 범위로는 찾기 어려워요`
}

export function sectionZeroText(program: FacilitySearchProgram): string {
  return `위치가 확인된 ${programNoun(program, 'long')} 0곳`
}

export function sectionFailedText(program: FacilitySearchProgram): string {
  return `${programNoun(program, 'long')}을 확인하지 못했어요`
}

export function partialText(voucherProgram: FacilitySearchProgram, failed: 'voucher' | 'public'): string {
  const longV = programNoun(voucherProgram, 'long')
  return failed === 'voucher'
    ? `${longV} 찾기가 실패해 공공·대안 시설만 보여요.`
    : `공공·대안 시설 찾기가 실패해 ${longV}만 보여요.`
}

// 막대의 "다시 시도" 대상인가. 네트워크·타임아웃·5xx 에 더해 429(요청 과다)도 — 서버가 "잠시 후 다시
// 시도해 주세요"라고 말하는데 누를 곳이 없으면 안내와 조작이 어긋난다(같은 요청도 시간이 지나면 답이 다르다).
// 422 는 같은 요청이면 같은 답이라 빼고, 확대·국내 안내만 한다.
export function areaErrorRetryable(kind: string): boolean {
  return kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'ratelimit'
}

export function errorText(message: string): string {
  return `이 지역을 찾지 못했어요: ${message}`
}

export function scopeOverrideHelp(label: string): string {
  return `${label} 안에서 시설 이름·주소로 찾아요`
}

// 검색 범위를 다른 시군구로 덮어썼는데 아직 검색어가 없을 때 목록 본문 — 내 지역 근처 목록을 두지 않는다.
// 바로 위 도움말이 "{label} 안에서"라서, 그 밑의 내 지역 시설(거리·도보 포함)이 그 시군구 결과처럼 읽힌다(SPEC §0).
export function scopeOverridePrompt(label: string): string {
  return `${label} 안에서 찾을 시설 이름이나 주소를 입력해 주세요 · 내 지역 근처 목록은 ‘내 지역으로’를 누르면 다시 보여요`
}

// 완료 낭독: `이 지도 범위: {short V} {V}곳, 공공·대안 {P}곳 찾음`
//   (+ 위치 미상 M>0 · + 부분 실패). 실패한 쪽은 숫자로 말하지 않고 "확인 실패"로만 말한다.
export function doneAnnouncement(
  voucherProgram: FacilitySearchProgram,
  v: SideResult,
  p: SideResult,
): string {
  const parts: string[] = []
  if (v.status === 'ok') parts.push(`${programNoun(voucherProgram, 'short')} ${countText(v.total)}`)
  if (p.status === 'ok') parts.push(`공공·대안 ${countText(p.total)}`)
  let s = `이 지도 범위: ${parts.join(', ')} 찾음`
  const m = v.status === 'ok' ? v.areas.reduce((acc, a) => acc + a.count, 0) : 0
  if (m > 0) {
    s += ` · 위치 확인 안 된 ${programNoun(voucherProgram, 'long')} ${countText(m)}은 시군구 전체 수로 따로 안내`
  }
  if (v.status === 'failed') s += ` · ${programNoun(voucherProgram, 'short')} 확인 실패`
  if (p.status === 'failed') s += ` · ${programNoun('public', 'short')} 확인 실패`
  return s
}

// 응답 program → 지도 마커 종류(공공 행에는 source 키가 없다).
export function markerKindOf(program: FacilitySearchProgram): 'voucher' | 'dvoucher' | 'public' {
  return program === 'svoucher' ? 'voucher' : program
}
