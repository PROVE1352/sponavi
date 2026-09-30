import { describe, expect, it } from 'vitest'
import CONTRACT_JSON from './contract/area_search.json'
import type { Sigungu } from '../types'
import type { FacilityAreaParams, FacilityAreaResponse } from '../types_search'
import { COURSES, FACILITIES, SIGUNGU, type RawFacility } from './fixtures'
import { DEFAULT_AREA_DATA, MockAreaError, mockAreaSearch, mockCoordClass, type MockAreaData } from './area'

// 목 지도 범위 검색이 계약 JSON(서버 pytest C2 와 같은 cases)과 같은 답을 내는지.
// 비교 필드: ids(순서 포함)·total·truncated·unlocated [sigungu_cd,label,display_label,count](순서 포함)·error.

interface ExtraFacility {
  id: string
  source: RawFacility['source']
  coord_source: RawFacility['coord_source']
  sigungu_cd: string
  sigungu_nm: string
  name: string
  addr: string
  lat: number
  lon: number
}
interface Dataset {
  extra_sigungu: Sigungu[]
  extra_facilities: ExtraFacility[]
}
interface Case {
  dataset?: string
  params: FacilityAreaParams
  expect?: {
    ids: string[]
    total: number
    truncated: boolean
    unlocated: [string, string, string, number][]
  }
  expect_status?: number
  error?: { status: number; code: string }
}

const J = CONTRACT_JSON as unknown as {
  datasets: Record<string, Dataset>
  cases: Record<string, Case>
  row_keys: { voucher: string[]; public: string[] }
  limit_default: number
  limit_max: number
}

function dataFor(name?: string): MockAreaData {
  if (!name) return DEFAULT_AREA_DATA
  const ds = J.datasets[name]
  const sigungu = [...SIGUNGU]
  for (const s of ds.extra_sigungu) {
    const have = sigungu.find((x) => x.cd === s.cd)
    if (have) {
      // 목 SIGUNGU 에 이미 있는 코드는 값이 같아야 한다(계약 §5).
      expect(have, `SIGUNGU ${s.cd}`).toEqual(s)
    } else {
      sigungu.push(s)
    }
  }
  const facilities: RawFacility[] = [
    ...FACILITIES,
    ...ds.extra_facilities.map((f) => ({
      ...f,
      sports: [],
      phone: '',
      disability_support: null,
    })),
  ]
  return { facilities, courses: COURSES, sigungu }
}

const cache = new Map<string, MockAreaData>()
function data(name?: string): MockAreaData {
  const key = name ?? ''
  if (!cache.has(key)) cache.set(key, dataFor(name))
  return cache.get(key)!
}

function run(c: Case): { res?: FacilityAreaResponse; err?: MockAreaError } {
  try {
    return { res: mockAreaSearch(c.params, data(c.dataset)) }
  } catch (e) {
    if (e instanceof MockAreaError) return { err: e }
    throw e
  }
}

describe('mockAreaSearch — 계약 JSON cases', () => {
  for (const [name, c] of Object.entries(J.cases)) {
    it(name, () => {
      const { res, err } = run(c)
      if (c.error) {
        expect(err, `${name}: 오류가 나야 한다`).toBeDefined()
        expect([err!.status, err!.code]).toEqual([c.error.status, c.error.code])
        return
      }
      expect(err, `${name}: ${err?.code} ${err?.message}`).toBeUndefined()
      if (c.expect_status != null) {
        expect(c.expect_status).toBe(200)
        return
      }
      const ex = c.expect!
      expect(res!.facilities.map((f) => f.id)).toEqual(ex.ids)
      expect(res!.total).toBe(ex.total)
      expect(res!.truncated).toBe(ex.truncated)
      expect(
        res!.unlocated.areas.map((a) => [a.sigungu_cd, a.label, a.display_label, a.count]),
      ).toEqual(ex.unlocated)
      expect(res!.unlocated.total).toBe(ex.unlocated.reduce((s, u) => s + u[3], 0))
    })
  }
})

describe('mockAreaSearch — 행 모양·정직성', () => {
  const box = { min_lat: 37.595, min_lon: 127.005, max_lat: 37.612, max_lon: 127.045 }

  it('행 키가 row_keys 와 같고 subsidy·copay·dist_km 는 null, 모든 행이 real 등급', () => {
    const d = data('x')
    const v = mockAreaSearch({ ...box, program: 'svoucher' }, d)
    const p = mockAreaSearch({ ...box, program: 'public' }, d)
    expect(v.facilities.length).toBeGreaterThan(0)
    expect(p.facilities.length).toBeGreaterThan(0)
    for (const f of v.facilities) {
      expect(Object.keys(f).sort()).toEqual([...J.row_keys.voucher].sort())
      const r = f as { subsidy: unknown; copay: unknown; dist_km: unknown }
      expect(r.subsidy).toBeNull()
      expect(r.copay).toBeNull()
      expect(r.dist_km).toBeNull()
      expect(mockCoordClass(f.id, d)).toBe('real')
    }
    for (const f of p.facilities) {
      expect(Object.keys(f).sort()).toEqual([...J.row_keys.public].sort())
      expect(f.dist_km).toBeNull()
      expect(mockCoordClass(f.id, d)).toBe('real')
    }
    expect(v.eligibility_applied).toBe(false)
    expect(v.unlocated.count_basis).toBe('whole_area')
  })

  it('limit 999 → 50 으로 자른다(범위 안 real 행 55개) · 기본값 50 · limit 0 은 거절', () => {
    // 기본 목 데이터는 범위 안 real 행이 3개뿐이라 상한을 시험할 수 없다 — 서버 O2 와 같은 55행을 더한다.
    const extra: RawFacility[] = Array.from({ length: 55 }, (_, i) => ({
      id: `O${String(i).padStart(2, '0')}`,
      source: 'voucher' as const,
      name: `오투태권도${i}`,
      sigungu_cd: '11290',
      sigungu_nm: '성북구',
      addr: `서울 성북구 보문로 ${i + 1}`,
      lat: 37.598 + (i % 11) * 0.0011,
      lon: 127.008 + Math.floor(i / 11) * 0.0071,
      coord_source: 'geocoded' as const,
      sports: ['태권도'],
      disability_support: null,
      phone: '',
    }))
    const d: MockAreaData = { ...DEFAULT_AREA_DATA, facilities: [...FACILITIES, ...extra] }
    expect(mockCoordClass('O00', d)).toBe('real')
    const r = mockAreaSearch({ ...box, program: 'svoucher', limit: 999 }, d)
    expect(r.total).toBe(55)
    expect(r.facilities).toHaveLength(J.limit_max)
    expect(r.truncated).toBe(true)
    // 상한으로 잘린 50행은 가운데 거리순 앞쪽 50행이다(아무 50행이 아니다)
    const clat = (box.min_lat + box.max_lat) / 2
    const clon = (box.min_lon + box.max_lon) / 2
    const k = Math.cos(clat * (Math.PI / 180))
    const d2 = (f: RawFacility) => (f.lat - clat) ** 2 + ((f.lon - clon) * k) ** 2
    const expected = [...extra].sort((a, b) => d2(a) - d2(b) || (a.id < b.id ? -1 : 1)).map((f) => f.id)
    expect(r.facilities.map((f) => f.id)).toEqual(expected.slice(0, J.limit_max))
    const def = mockAreaSearch({ ...box, program: 'svoucher' }, d)
    expect(def.facilities).toHaveLength(J.limit_default)
    expect(def.truncated).toBe(true)
    const two = mockAreaSearch({ ...box, program: 'svoucher', limit: 2 }, d)
    expect(two.facilities.map((f) => f.id)).toEqual(expected.slice(0, 2))
    expect(two.total).toBe(55)
    expect(() => mockAreaSearch({ ...box, program: 'public', limit: 0 })).toThrow(MockAreaError)
  })

  it('좌표 등급: 번지 없는 geocoded·자리표시 점·먼 행·centroid', () => {
    const d = data('x')
    expect(mockCoordClass('X01', d)).toBe('geocoded_approx')
    expect(mockCoordClass('X02', d)).toBe('real')
    expect(mockCoordClass('X03', d)).toBe('placeholder')
    expect(mockCoordClass('X06', d)).toBe('far')
    expect(mockCoordClass('V01', d)).toBe('centroid')
    expect(mockCoordClass('P01', d)).toBe('real')
  })

  it('한 점 공유: 번지 없는 api 행이 다른 이름과 좌표를 똑같이 함께 쓰면 근사(서버 H11 과 같은 판정)', () => {
    const d = data('shared')
    for (const id of ['S01', 'S02', 'S03']) expect(mockCoordClass(id, d), id).toBe('shared_point')
    expect(mockCoordClass('S04', d)).toBe('real') // 같은 시설 중복(이름 키가 같다)
    expect(mockCoordClass('S05', d)).toBe('real')
    expect(mockCoordClass('S06', d)).toBe('real') // 혼자 있는 점
    expect(mockCoordClass('S07', d)).toBe('real') // '삼양로10' — api 식으로는 번지가 있다
    expect(mockCoordClass('S08', d)).toBe('real')
    const r = mockAreaSearch(
      { min_lat: 37.62, min_lon: 127.005, max_lat: 37.645, max_lon: 127.035, program: 'public' },
      d,
    )
    expect(r.coord_rules.shared_point_min_names).toBe(2)
    expect(r.facilities.some((f) => f.lat === 37.63 && f.lon === 127.02)).toBe(false)
  })

  it('q 가 30자를 넘거나 공백뿐이면 INVALID_REQUEST', () => {
    const e1 = (() => {
      try {
        mockAreaSearch({ ...box, program: 'public', q: '가'.repeat(31) })
      } catch (e) {
        return e as MockAreaError
      }
    })()
    expect(e1?.code).toBe('INVALID_REQUEST')
    expect(() => mockAreaSearch({ ...box, program: 'public', q: '   ' })).toThrow(MockAreaError)
  })

  it('AREA_TOO_WIDE 메시지에 대각선 km 가 들어간다', () => {
    try {
      mockAreaSearch({ min_lat: 37.4, min_lon: 126.8, max_lat: 37.7, max_lon: 127.2, program: 'svoucher' })
      throw new Error('거절되지 않았다')
    } catch (e) {
      expect((e as MockAreaError).code).toBe('AREA_TOO_WIDE')
      expect((e as MockAreaError).message).toMatch(/대각선 약 \d+\.\dkm/)
    }
  })

  it('수강료는 나이에 맞는 강좌 중 최저가, 맞는 강좌가 없으면 전체 최저가(폴백), 나이 없으면 전체 최저가', () => {
    // 강좌가 하나뿐이면 나이 매칭·최저가 규칙과 상관없이 늘 그 강좌가 뽑혀 규칙을 가를 수 없다(서버 S1 과 같은 대조).
    // X02(종암태권도, 번지 있는 geocoded = real)에 강좌 셋: 유청소년 90,000 · 성인 120,000 · 성인 100,000.
    //   age 10 → 유청소년만 맞음 → 90,000
    //   age 30 → 성인 둘 중 최저 → 100,000 (전체 최저 90,000 이 아니다 — 나이 매칭을 먼저 한다)
    //   age 70 → 맞는 강좌 없음 → 폴백 전체 최저 90,000
    //   age 없음 → 전체 최저 90,000 (최고가 120,000 이 아니다)
    const base = data('x')
    const extra = (id: string, target: string, fee: number) => ({
      id,
      facility_id: 'X02',
      name: `${target} 태권도`,
      sport: '태권도',
      weekday_mask: '1010100',
      start: '18:00',
      end: '18:50',
      fee_month: fee,
      target,
    })
    const d: MockAreaData = {
      ...base,
      courses: [
        ...COURSES,
        extra('CX1', '성인', 120000),
        extra('CX2', '유청소년', 90000),
        extra('CX3', '성인', 100000),
      ],
    }
    const fee = (age?: number) => {
      const r = mockAreaSearch({ ...box, program: 'svoucher', ...(age != null ? { age } : {}) }, d)
      const row = r.facilities.find((f) => f.id === 'X02') as { fee_month: number | null } | undefined
      expect(row, `X02 가 범위 결과에 있어야 한다(age=${age})`).toBeDefined()
      return row!.fee_month
    }
    expect(fee(10)).toBe(90000)
    expect(fee(30)).toBe(100000)
    expect(fee(70)).toBe(90000)
    expect(fee(undefined)).toBe(90000)
    // 강좌 순서를 뒤집어도 같다(첫 행이 아니라 최저가를 고른다)
    const rev: MockAreaData = { ...d, courses: [...d.courses].reverse() }
    const r30 = mockAreaSearch({ ...box, program: 'svoucher', age: 30 }, rev)
    expect((r30.facilities.find((f) => f.id === 'X02') as { fee_month: number | null }).fee_month).toBe(100000)
  })
})
