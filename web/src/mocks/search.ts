// 목-모드 시설 검색(GET /api/facilities/search). 서버 engine.search_facilities 규칙을 그대로 흉내낸다:
//   · 시군구 코드 안에서 모든 공백 토큰이 name 또는 addr 에 부분일치(AND, 대소문자 무시)
//   · 실좌표 행 먼저(원점 거리순) → 구 중심 폴백 행(이름순)
//   · 이용권 행은 자격 미상 → subsidy/copay = null, fee_month 만
// 원천은 목 fixtures(data/fixtures/facilities.json 사본)다 — 없는 시설을 지어내지 않는다.
import type {
  FacilitySearchParams,
  FacilitySearchResponse,
  SearchAltFacility,
  SearchVoucherFacility,
} from '../types_search'
import { COURSES, FACILITIES, SIGUNGU, type RawFacility } from './fixtures'

const SOURCE = { svoucher: 'voucher', dvoucher: 'dvoucher', public: 'public' } as const
const LIMIT_MAX = 50
const REAL = new Set(['api', 'geocoded'])

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function targetMatches(target: string, age: number): boolean {
  if (target === '유청소년') return age <= 18
  if (target === '성인') return age >= 19 && age <= 64
  if (target === '어르신') return age >= 65
  return true
}

function cheapest(fid: string, age?: number) {
  const cs = COURSES.filter((c) => c.facility_id === fid)
  if (cs.length === 0) return null
  const matched = age == null ? [] : cs.filter((c) => targetMatches(c.target, age))
  const pool = matched.length > 0 ? matched : cs
  return pool.reduce((m, c) => (c.fee_month < m.fee_month ? c : m))
}

export class MockSearchError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function mockFacilitySearch(p: FacilitySearchParams): FacilitySearchResponse {
  const q = p.q.split(/\s+/).filter(Boolean).join(' ')
  if (q.length === 0 || q.length > 30) {
    throw new MockSearchError('INVALID_REQUEST', '입력값 오류(q): 검색어는 1~30자로 입력해 주세요.')
  }
  const sg = SIGUNGU.find((s) => s.cd === p.sigungu_cd)
  const tokens = Array.from(new Set(q.split(' ')))
  const source = SOURCE[p.program]
  const origin =
    p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : sg ? { lat: sg.lat, lon: sg.lon } : null

  const rows = FACILITIES.filter(
    (f) =>
      f.source === source &&
      f.sigungu_cd === p.sigungu_cd &&
      tokens.every((t) => {
        const tl = t.toLowerCase()
        return f.name.toLowerCase().includes(tl) || (f.addr ?? '').toLowerCase().includes(tl)
      }),
  ).map((f) => ({
    f,
    d: origin ? Math.round(haversineKm(origin.lat, origin.lon, f.lat, f.lon) * 100) / 100 : null,
  }))
  rows.sort((a, b) => {
    const ra = REAL.has(a.f.coord_source) ? 0 : 1
    const rb = REAL.has(b.f.coord_source) ? 0 : 1
    if (ra !== rb) return ra - rb
    const da = ra === 0 && a.d != null ? a.d : Infinity
    const db = rb === 0 && b.d != null ? b.d : Infinity
    if (da !== db) return da - db
    return a.f.name.localeCompare(b.f.name)
  })
  const limit = Math.max(1, Math.min(p.limit ?? 30, LIMIT_MAX))
  const picked = rows.slice(0, limit)

  const facilities = picked.map(({ f, d }) => toRow(f, REAL.has(f.coord_source) ? d : null, p))
  return {
    sigungu_cd: p.sigungu_cd,
    sigungu_nm: sg?.nm ?? null,
    scope_codes: [p.sigungu_cd],
    scope_label: null,
    program: p.program,
    q,
    tokens,
    match_fields: ['name', 'addr'],
    eligibility_applied: false,
    total: rows.length,
    truncated: rows.length > facilities.length,
    facilities,
  }
}

function toRow(
  f: RawFacility,
  dist: number | null,
  p: FacilitySearchParams,
): SearchVoucherFacility | SearchAltFacility {
  const course = cheapest(f.id, p.age)
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
      sports: f.sports,
      lat: f.lat,
      lon: f.lon,
      coord_source: f.coord_source,
      dist_km: dist,
      sigungu_nm: f.sigungu_nm,
      faci_gb: null,
      note,
      disability_support: f.disability_support,
      addr: f.addr,
    }
  }
  return {
    id: f.id,
    name: f.name,
    source: f.source,
    sports: f.sports,
    lat: f.lat,
    lon: f.lon,
    coord_source: f.coord_source,
    dist_km: dist,
    sigungu_nm: f.sigungu_nm,
    fee_month: course ? course.fee_month : null,
    subsidy: null,
    copay: null,
    disability_support: f.disability_support,
    addr: f.addr,
  }
}
