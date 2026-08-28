// 종목 매칭 1벌(2A) — 별칭 확장은 서버 몫이라 여기선 정확 일치만 고정한다.
import { describe, expect, it } from 'vitest'
import { countMatching, matchesFilter, nearbyMatchText, poolCountText } from './sports'

describe('matchesFilter', () => {
  it('필터가 비어 있으면(또는 없으면) 전부 통과 — 필터 미적용', () => {
    expect(matchesFilter(['수영', '헬스'], [])).toBe(true)
    expect(matchesFilter(['수영'], undefined)).toBe(true)
  })

  it('한 종목이라도 겹치면 통과', () => {
    expect(matchesFilter(['수영', '헬스'], ['헬스'])).toBe(true)
    expect(matchesFilter(['요가', '필라테스'], ['수영', '요가'])).toBe(true)
  })

  it('겹치는 종목이 없으면 탈락 — 부분 문자열·별칭은 여기서 보지 않는다', () => {
    expect(matchesFilter(['탁구'], ['수영'])).toBe(false)
    expect(matchesFilter(['체력단련장(업)'], ['헬스'])).toBe(false)
    expect(matchesFilter([], ['헬스'])).toBe(false)
  })
})

// C-4: 좌측 CTA 의 "근처 N곳"과 우측 패널의 전체 카운트가 서로 반박하는 것처럼 읽히던 문제.
// 부분집합이라는 관계를 숫자와 함께 적는다.
describe('countMatching / nearbyMatchText', () => {
  const FACILITIES = [
    { sports: ['요가', '수영', '헬스'] },
    { sports: ['필라테스', '요가'] },
    { sports: ['헬스'] },
  ]

  it('필터 통과 수(matched)와 필터 이전 전체(total)를 함께 센다', () => {
    expect(countMatching(FACILITIES, ['요가', '필라테스'])).toEqual({ matched: 2, total: 3 })
  })

  it('필터가 없으면 전부 통과 — 두 숫자가 같다', () => {
    expect(countMatching(FACILITIES, [])).toEqual({ matched: 3, total: 3 })
    expect(countMatching(FACILITIES, undefined)).toEqual({ matched: 3, total: 3 })
  })

  it('★ C-4 회귀: 부분집합이면 전체 수를 같이 적어 관계를 보여 준다', () => {
    expect(nearbyMatchText({ matched: 4, total: 6 })).toBe('이 종목 근처 4곳 · 전체 6곳')
    expect(nearbyMatchText({ matched: 2, total: 3 })).toBe('이 종목 근처 2곳 · 전체 3곳')
  })

  it('걸러진 게 없으면 같은 숫자를 두 번 말하지 않는다', () => {
    expect(nearbyMatchText({ matched: 3, total: 3 })).toBe('근처 3곳')
    expect(nearbyMatchText({ matched: 0, total: 0 })).toBe('근처 0곳')
  })

  it('풀 배지는 필터가 실제로 걸러냈을 때만 부분 수를 덧붙인다', () => {
    expect(poolCountText('공공·대안', { matched: 3, total: 3 })).toBe('공공·대안 3곳')
    expect(poolCountText('공공·대안', { matched: 2, total: 3 })).toBe('공공·대안 3곳 · 이 종목 2곳')
    expect(poolCountText('공공·대안', { matched: 0, total: 6 })).toBe('공공·대안 6곳 · 이 종목 0곳')
  })

  it('필터에 걸려 하나도 안 남아도 전체 수는 숨기지 않는다', () => {
    const c = countMatching(FACILITIES, ['볼링'])
    expect(c).toEqual({ matched: 0, total: 3 })
    expect(nearbyMatchText(c)).toBe('이 종목 근처 0곳 · 전체 3곳')
  })
})
