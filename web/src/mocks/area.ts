// 목-모드 지도 범위 검색(GET /api/facilities/in-bounds). 서버 engine.area_search 규칙(계약서 §3.2~3.5)을
// 그대로 흉내낸다 — 좌표 등급(real/placeholder/far/shared_point/geocoded_approx/centroid) · 강건 중심 · 서로 다른 증거
// 좌표 수 · 영역그룹 합산 · 모호한 이름의 시도 접두.
//
// 그룹·시도·모호 이름 표와 좌표 규칙 값은 계약 JSON(contract/area_search.json)에서 읽는다 —
// 여기서 손으로 한 벌 더 적으면 서버와 갈라진다. 원천은 목 fixtures 다(없는 시설을 지어내지 않는다).
import CONTRACT_JSON from './contract/area_search.json'
import type { Sigungu } from '../types'
import type {
  AreaBounds,
  FacilityAreaParams,
  FacilityAreaResponse,
  SearchAltFacility,
  SearchVoucherFacility,
  UnlocatedArea,
} from '../types_search'
import { COURSES, FACILITIES, SIGUNGU, type RawCourse, type RawFacility } from './fixtures'
import { AREA_MAX_DIAG_KM, AREA_MAX_LON_SPAN_DEG, diagKm, haversineKm, overlapsKorea } from '../lib/areaSearch'

interface ContractGroup {
  id: string
  label: string
  members: string[]
}

const C = CONTRACT_JSON as unknown as {
  limit_default: number
  limit_max: number
  q_max: number
  coord_rules: {
    placeholder_min_areas: number
    suspect_max_km: number
    robust_min_rows: number
    geocoded_building_no_regex: string
    shared_point_min_names: number
    api_building_no_regex: string
  }
  evidence: { min_distinct_points: number }
  ambiguous_labels: string[]
  sido_names: Record<string, string>
  sigungu_groups: ContractGroup[]
}

const BNO_RE = new RegExp(C.coord_rules.geocoded_building_no_regex)
// api 주소는 '양덕동477'·'체육로90'처럼 번지가 붙어 적힌다 — 한 점 공유 판정에는 느슨한 식을 쓴다.
const API_BNO_RE = new RegExp(C.coord_rules.api_building_no_regex)
const AMBIGUOUS = new Set(C.ambiguous_labels)
const GROUP_OF = new Map<string, ContractGroup>()
for (const g of C.sigungu_groups) for (const m of g.members) GROUP_OF.set(m, g)

const SOURCE = { svoucher: 'voucher', dvoucher: 'dvoucher', public: 'public' } as const
const PROGRAMS = new Set(['svoucher', 'dvoucher', 'public'])

export type CoordClass =
  | 'real'
  | 'placeholder'
  | 'far'
  | 'no_ref'
  | 'shared_point'
  | 'geocoded_approx'
  | 'centroid'

export interface MockAreaData {
  facilities: RawFacility[]
  courses: RawCourse[]
  sigungu: Sigungu[]
}

export const DEFAULT_AREA_DATA: MockAreaData = { facilities: FACILITIES, courses: COURSES, sigungu: SIGUNGU }

export class MockAreaError extends Error {
  code: string
  status: number
  constructor(code: string, status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

const MSG_Q = '입력값 오류(q): 검색어는 1~30자로 입력해 주세요.'
const MSG_BOUNDS = '입력값 오류(bounds): min_lat<max_lat, min_lon<max_lon 이어야 합니다.'
const MSG_OUTSIDE = '대한민국 밖의 범위예요. 국내 지역에서만 찾을 수 있어요.'

// ASCII A–Z 만 소문자로(SQLite LIKE 와 같은 대소문자 규칙 — 한글은 대소문자가 없다).
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

// 한 점 공유 판정의 이름 키 — ASCII 소문자 + 공백 제거(서버 area_index.name_key 와 같은 글자 집합).
function nameKey(s: string | null | undefined): string {
  return asciiLower(s ?? '').replace(/[ \t\n\r\f\v\u00a0\u3000]+/g, '')
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function inBounds(lat: number, lon: number, b: AreaBounds): boolean {
  return lat >= b.min_lat && lat <= b.max_lat && lon >= b.min_lon && lon <= b.max_lon
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

interface Prepared {
  f: RawFacility
  cd: string
  area: string
  coordSource: string
  cls: CoordClass
  nameF: string
  addrF: string
}

interface Index {
  rows: Prepared[]
  centroid: (cd: string) => Sigungu | undefined
  ref: (cd: string) => { lat: number; lon: number } | null
  classOf: Map<string, CoordClass>
}

// 목에는 구 코드 별칭 표가 없다 — canonical_sigungu 는 항등(표에 없는 코드는 그대로, store.py 와 같은 뜻).
const canonical = (cd: string) => cd
const areaKeyOf = (cd: string) => GROUP_OF.get(cd)?.id ?? cd

const cache = new WeakMap<MockAreaData, Index>()

function buildIndex(data: MockAreaData): Index {
  const hit = cache.get(data)
  if (hit) return hit
  const sg = new Map(data.sigungu.map((s) => [s.cd, s]))
  const centroid = (cd: string) => sg.get(canonical(cd))
  const base = data.facilities.map((f) => {
    const cd = canonical(f.sigungu_cd)
    const coordSource = f.coord_source || (f.source === 'public' ? 'api' : 'centroid')
    return { f, cd, area: areaKeyOf(cd), coordSource }
  })
  // 1. 자리표시 점: 좌표가 **똑같은** api 행이 서로 다른 영역 3곳 이상에 걸쳐 있으면(원천 기본값).
  const areasAt = new Map<string, Set<string>>()
  const ptKey = (lat: number, lon: number) => `${lat}|${lon}`
  for (const r of base) {
    if (r.coordSource !== 'api') continue
    const k = ptKey(r.f.lat, r.f.lon)
    if (!areasAt.has(k)) areasAt.set(k, new Set())
    areasAt.get(k)!.add(r.area)
  }
  const placeholder = new Set<string>()
  for (const [k, s] of areasAt) if (s.size >= C.coord_rules.placeholder_min_areas) placeholder.add(k)

  // 1b. 한 점 공유: 자리표시 점이 아닌 번지 없는 api 행을 좌표가 똑같은 것끼리 묶어, 이름 키가
  //     서로 다른 것이 shared_point_min_names 개 이상이면 근사(시군구·읍면동 단위 지오코딩 — 먼 행 판정이 먼저).
  const namesAt = new Map<string, Set<string>>()
  for (const r of base) {
    if (r.coordSource !== 'api' || API_BNO_RE.test(r.f.addr ?? '')) continue
    const k = ptKey(r.f.lat, r.f.lon)
    if (placeholder.has(k)) continue
    if (!namesAt.has(k)) namesAt.set(k, new Set())
    namesAt.get(k)!.add(nameKey(r.f.name))
  }
  const isShared = (r: (typeof base)[number]) =>
    r.coordSource === 'api' &&
    !API_BNO_RE.test(r.f.addr ?? '') &&
    (namesAt.get(ptKey(r.f.lat, r.f.lon))?.size ?? 0) >= C.coord_rules.shared_point_min_names

  // 2. 강건 중심: 코드별 자리표시 아닌 api 행이 5개 이상이면 (median lat, median lon), 아니면 DB 중심점.
  const apiByCode = new Map<string, { lat: number; lon: number }[]>()
  for (const r of base) {
    if (r.coordSource !== 'api' || placeholder.has(ptKey(r.f.lat, r.f.lon))) continue
    if (!apiByCode.has(r.cd)) apiByCode.set(r.cd, [])
    apiByCode.get(r.cd)!.push({ lat: r.f.lat, lon: r.f.lon })
  }
  const refCache = new Map<string, { lat: number; lon: number } | null>()
  const ref = (cdRaw: string) => {
    const cd = canonical(cdRaw)
    if (refCache.has(cd)) return refCache.get(cd)!
    const pts = apiByCode.get(cd) ?? []
    let out: { lat: number; lon: number } | null
    if (pts.length >= C.coord_rules.robust_min_rows) {
      out = { lat: median(pts.map((p) => p.lat)), lon: median(pts.map((p) => p.lon)) }
    } else {
      const c = centroid(cd)
      out = c ? { lat: c.lat, lon: c.lon } : null
    }
    refCache.set(cd, out)
    return out
  }

  // 3. 등급
  const classOf = new Map<string, CoordClass>()
  const rows: Prepared[] = base.map((r) => {
    let cls: CoordClass
    if (r.coordSource === 'api') {
      const rf = ref(r.cd)
      if (placeholder.has(ptKey(r.f.lat, r.f.lon))) cls = 'placeholder'
      else if (rf == null) cls = 'no_ref'
      else if (haversineKm(r.f.lat, r.f.lon, rf.lat, rf.lon) > C.coord_rules.suspect_max_km) cls = 'far'
      else if (isShared(r)) cls = 'shared_point'
      else cls = 'real'
    } else if (r.coordSource === 'geocoded') {
      cls = BNO_RE.test(r.f.addr ?? '') ? 'real' : 'geocoded_approx'
    } else {
      cls = 'centroid'
    }
    classOf.set(r.f.id, cls)
    return { ...r, cls, nameF: asciiLower(r.f.name ?? ''), addrF: asciiLower(r.f.addr ?? '') }
  })
  const idx: Index = { rows, centroid, ref, classOf }
  cache.set(data, idx)
  return idx
}

// 테스트·보고용: 목 fixtures 한 행의 좌표 등급.
export function mockCoordClass(id: string, data: MockAreaData = DEFAULT_AREA_DATA): CoordClass | undefined {
  return buildIndex(data).classOf.get(id)
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function matches(r: Prepared, tokens: string[]): boolean {
  return tokens.every((t) => r.nameF.includes(t) || r.addrF.includes(t))
}

function targetMatches(target: string, age: number): boolean {
  if (target === '유청소년') return age <= 18
  if (target === '성인') return age >= 19 && age <= 64
  if (target === '어르신') return age >= 65
  return true
}

// _representative_fee: 나이에 맞는 강좌 중 최저가 → 없으면 전체 최저가(폴백) → age 가 없으면 전체 최저가.
function cheapest(courses: RawCourse[], fid: string, age?: number): RawCourse | null {
  const cs = courses.filter((c) => c.facility_id === fid)
  if (cs.length === 0) return null
  const matched = age == null ? [] : cs.filter((c) => targetMatches(c.target, age))
  const pool = matched.length > 0 ? matched : cs
  return pool.reduce((m, c) => (c.fee_month < m.fee_month ? c : m))
}

function toRow(
  f: RawFacility,
  courses: RawCourse[],
  age: number | undefined,
): SearchVoucherFacility | SearchAltFacility {
  const course = cheapest(courses, f.id, age)
  if (f.source === 'public') {
    const note = course
      ? course.fee_month === 0
        ? `무료 프로그램: ${course.name}`
        : `최저 월 ${course.fee_month.toLocaleString('ko-KR')}원 강좌: ${course.name}`
      : ''
    return {
      id: f.id,
      name: f.name,
      type: '공공체육시설',
      sports: f.sports ?? [],
      lat: f.lat,
      lon: f.lon,
      coord_source: f.coord_source,
      dist_km: null,
      sigungu_nm: f.sigungu_nm,
      faci_gb: null,
      note,
      disability_support: f.disability_support ?? null,
      addr: f.addr,
    }
  }
  return {
    id: f.id,
    name: f.name,
    source: f.source,
    sports: f.sports ?? [],
    lat: f.lat,
    lon: f.lon,
    coord_source: f.coord_source,
    dist_km: null,
    sigungu_nm: f.sigungu_nm,
    fee_month: course ? course.fee_month : null,
    subsidy: null,
    copay: null,
    disability_support: f.disability_support ?? null,
    addr: f.addr,
  }
}

export function mockAreaSearch(
  p: FacilityAreaParams,
  data: MockAreaData = DEFAULT_AREA_DATA,
): FacilityAreaResponse {
  // 1. 요청 모양(FastAPI 검증 실패 → INVALID_REQUEST)
  const lat = [p.min_lat, p.max_lat]
  const lon = [p.min_lon, p.max_lon]
  const bad =
    !lat.every(isNum) ||
    !lon.every(isNum) ||
    lat.some((x) => x < -90 || x > 90) ||
    lon.some((x) => x < -180 || x > 180) ||
    !PROGRAMS.has(p.program) ||
    (p.limit != null && (!Number.isInteger(p.limit) || p.limit < 1)) ||
    (p.age != null && (!Number.isInteger(p.age) || p.age < 0 || p.age > 120))
  if (bad) throw new MockAreaError('INVALID_REQUEST', 422, '입력값 오류: 요청 형식이 올바르지 않습니다.')
  // 2. q(있을 때만): 공백을 접은 뒤 1~30자
  let q: string | null = null
  if (p.q != null) {
    q = p.q.split(/\s+/).filter(Boolean).join(' ')
    if (q.length === 0 || q.length > C.q_max) throw new MockAreaError('INVALID_REQUEST', 422, MSG_Q)
  }
  // 3. 엄격 부등호
  if (!(p.min_lat < p.max_lat && p.min_lon < p.max_lon)) {
    throw new MockAreaError('INVALID_REQUEST', 422, MSG_BOUNDS)
  }
  const bounds: AreaBounds = { min_lat: p.min_lat, min_lon: p.min_lon, max_lat: p.max_lat, max_lon: p.max_lon }
  // 4. 한국과 전혀 겹치지 않음
  if (!overlapsKorea(bounds)) throw new MockAreaError('AREA_OUT_OF_RANGE', 422, MSG_OUTSIDE)
  // 5. 대각선 20km 초과(정확히 20 은 허용) 또는 경도 폭 180° 초과(haversine 이 짧은 길로 재는 구멍)
  const d = diagKm(bounds)
  if (d > AREA_MAX_DIAG_KM || p.max_lon - p.min_lon > AREA_MAX_LON_SPAN_DEG) {
    throw new MockAreaError(
      'AREA_TOO_WIDE',
      422,
      `지도 범위가 너무 넓어요(대각선 약 ${d.toFixed(1)}km, 최대 20km). 지도를 조금 더 확대해 주세요.`,
    )
  }

  const idx = buildIndex(data)
  const source = SOURCE[p.program]
  const tokens = q ? Array.from(new Set(q.split(' '))) : []
  const tokensF = tokens.map(asciiLower)
  const limit = Math.min(p.limit ?? C.limit_default, C.limit_max)

  // 범위 판정: 좌표 등급 real 행만.
  const clat = (p.min_lat + p.max_lat) / 2
  const clon = (p.min_lon + p.max_lon) / 2
  const k = Math.cos(clat * (Math.PI / 180))
  const hits = idx.rows
    .filter(
      (r) =>
        r.f.source === source &&
        r.cls === 'real' &&
        (r.coordSource === 'api' || r.coordSource === 'geocoded') &&
        inBounds(r.f.lat, r.f.lon, bounds) &&
        matches(r, tokensF),
    )
    .map((r) => ({ r, d2: (r.f.lat - clat) ** 2 + ((r.f.lon - clon) * k) ** 2 }))
  hits.sort((a, b) => a.d2 - b.d2 || cmpStr(a.r.f.id, b.r.f.id))
  const picked = hits.slice(0, limit)
  const facilities = picked.map(({ r }) => toRow(r.f, data.courses, p.age))

  // 위치 미상 묶음: 후보 영역(A 강건 중심 · B 서로 다른 증거 좌표 2곳 이상)의 approx 행 수(영역 전체).
  const approxCount = new Map<string, number>()
  for (const r of idx.rows) {
    if (r.f.source !== source || r.cls === 'real') continue
    if (!matches(r, tokensF)) continue
    approxCount.set(r.area, (approxCount.get(r.area) ?? 0) + 1)
  }
  const areas: UnlocatedArea[] = []
  for (const [area, count] of approxCount) {
    if (count === 0) continue
    const group = C.sigungu_groups.find((g) => g.id === area)
    const members = group ? group.members : [area]
    const named = members.find((cd) => idx.centroid(cd) != null)
    if (!named) continue // 이름을 붙일 수 없는 영역(실 DB 0건)
    const byCenter = members.some((cd) => {
      const rf = idx.ref(cd)
      return rf != null && inBounds(rf.lat, rf.lon, bounds)
    })
    const pts = new Set<string>()
    for (const r of idx.rows) {
      if (r.area !== area || r.cls !== 'real' || r.coordSource !== 'api') continue
      if (inBounds(r.f.lat, r.f.lon, bounds)) pts.add(`${r.f.lat}|${r.f.lon}`)
    }
    const byEvidence = pts.size >= C.evidence.min_distinct_points
    if (!byCenter && !byEvidence) continue
    const nm = idx.centroid(named)!.nm
    const sido = C.sido_names[named.slice(0, 2)] ?? null
    const label = group ? group.label : nm
    const included: Array<'center' | 'evidence'> = []
    if (byCenter) included.push('center')
    if (byEvidence) included.push('evidence')
    areas.push({
      sigungu_cd: named,
      sigungu_nm: nm,
      sido_nm: sido,
      label,
      display_label: AMBIGUOUS.has(label) && sido ? `${sido} ${label}` : label,
      scope_codes: [...members],
      count,
      included_by: included,
    })
  }
  areas.sort((a, b) => b.count - a.count || cmpStr(a.sigungu_cd, b.sigungu_cd))

  return {
    bounds,
    center: { lat: clat, lon: clon },
    diag_km: Math.round(d * 10) / 10,
    max_diag_km: AREA_MAX_DIAG_KM,
    program: p.program,
    q,
    tokens,
    match_fields: ['name', 'addr'],
    coord_sources: ['api', 'geocoded'],
    coord_rules: {
      placeholder_min_areas: C.coord_rules.placeholder_min_areas,
      suspect_max_km: C.coord_rules.suspect_max_km,
      robust_min_rows: C.coord_rules.robust_min_rows,
      geocoded_requires_building_no: true,
      shared_point_min_names: C.coord_rules.shared_point_min_names,
    },
    order: 'center_distance',
    eligibility_applied: false,
    total: hits.length,
    truncated: hits.length > facilities.length,
    facilities,
    unlocated: {
      total: areas.reduce((s, a) => s + a.count, 0),
      count_basis: 'whole_area',
      areas,
    },
  }
}
