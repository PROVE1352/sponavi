import { describe, expect, it } from 'vitest'
import { MockSearchError, mockFacilitySearch } from './search'

// 목 시설 검색이 서버 계약(docs/API.md GET /api/facilities/search)과 같은 규칙인지.
describe('mockFacilitySearch', () => {
  it('모든 토큰이 이름 또는 주소에 있어야 한다(AND)', () => {
    const r = mockFacilitySearch({ sigungu_cd: '11290', q: ' 아리랑로  수영 ', program: 'svoucher' })
    expect(r.q).toBe('아리랑로 수영')
    expect(r.tokens).toEqual(['아리랑로', '수영'])
    expect(r.facilities.map((f) => f.id)).toEqual(['V02'])
  })

  it('이용권 행은 자격 미상 — subsidy/copay 는 null, 수강료만', () => {
    const r = mockFacilitySearch({ sigungu_cd: '11290', q: '아리랑로', program: 'svoucher' })
    const v = r.facilities[0] as { subsidy: unknown; copay: unknown; fee_month: unknown; dist_km: unknown }
    expect(v.subsidy).toBeNull()
    expect(v.copay).toBeNull()
    expect(v.fee_month).toBe(110000)
    expect(v.dist_km).toBeNull() // 구 중심 폴백 → 거리 미표기
    expect(r.eligibility_applied).toBe(false)
  })

  it('program 필터와 시군구 범위', () => {
    const pub = mockFacilitySearch({ sigungu_cd: '11290', q: '아리랑', program: 'public' })
    expect(pub.facilities.map((f) => f.id)).toEqual(['P02'])
    expect(pub.facilities[0].dist_km).not.toBeNull()
    const other = mockFacilitySearch({ sigungu_cd: '11680', q: '아리랑', program: 'svoucher' })
    expect(other.total).toBe(0)
  })

  it('limit 으로 자르고 total·truncated 를 싣는다', () => {
    const r = mockFacilitySearch({ sigungu_cd: '11290', q: '성북', program: 'svoucher', limit: 1 })
    expect(r.total).toBe(4)
    expect(r.facilities).toHaveLength(1)
    expect(r.truncated).toBe(true)
  })

  it('빈 검색어·30자 초과는 거절', () => {
    expect(() => mockFacilitySearch({ sigungu_cd: '11290', q: '   ', program: 'svoucher' })).toThrow(
      MockSearchError,
    )
    expect(() =>
      mockFacilitySearch({ sigungu_cd: '11290', q: '가'.repeat(31), program: 'svoucher' }),
    ).toThrow(MockSearchError)
  })
})
