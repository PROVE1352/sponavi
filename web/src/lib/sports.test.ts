// 종목 매칭 1벌(2A) — 별칭 확장은 서버 몫이라 여기선 정확 일치만 고정한다.
import { describe, expect, it } from 'vitest'
import { matchesFilter } from './sports'

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
