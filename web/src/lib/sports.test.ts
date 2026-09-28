// 종목 매칭 1벌(2A) — 별칭 확장은 서버 몫이라 여기선 정확 일치만 고정한다.
import { describe, expect, it } from 'vitest'
import {
  altPoolLabel,
  canonicalSportName,
  countMatching,
  dedupeSportNames,
  matchesFilter,
  nearbyMatchText,
  poolCountText,
  summarizeSports,
} from './sports'

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

describe('summarizeSports — 버튼·버블·필터 칩의 종목 이름 요약', () => {
  const HEALTH = ['헬스', '유도', '주짓수', '체력단련장', '체력단련장업', '기타체육시설(체력단련장)', '투기체육관']

  it('표기 변형(체력단련장/체력단련장업/기타체육시설(체력단련장))을 하나로 접는다', () => {
    expect(dedupeSportNames(HEALTH)).toEqual(['헬스', '유도', '주짓수', '체력단련장', '투기체육관'])
    expect(canonicalSportName('체력단련장업')).toBe('체력단련장')
    expect(canonicalSportName('기타체육시설(체력단련장)')).toBe('체력단련장')
    expect(canonicalSportName('체력단련장(업)')).toBe('체력단련장')
    expect(canonicalSportName('수영장업')).toBe('수영장')
    // 뜻이 다른 별칭(헬스 ↔ 체력단련장)은 접지 않는다 — 별칭 표는 서버 소관
    expect(canonicalSportName('헬스')).toBe('헬스')
    expect(canonicalSportName('유도')).toBe('유도')
  })

  it('최대 3개 + "외 N", 전체 목록은 all 로 남긴다', () => {
    const s = summarizeSports(HEALTH)
    expect(s.text).toBe('헬스 · 유도 · 주짓수 외 2')
    expect(s.shown).toEqual(['헬스', '유도', '주짓수'])
    expect(s.rest).toBe(2)
    expect(s.all).toEqual(['헬스', '유도', '주짓수', '체력단련장', '투기체육관'])
  })

  it('3개 이하면 "외" 없이 전부', () => {
    expect(summarizeSports(['수영', '수영장', '수영장업']).text).toBe('수영 · 수영장')
    expect(summarizeSports(['헬스']).text).toBe('헬스')
    expect(summarizeSports([]).text).toBe('')
  })

  it('구분자를 바꿀 수 있다(봇 한 줄은 가운뎃점만)', () => {
    expect(summarizeSports(HEALTH, 3, '·').text).toBe('헬스·유도·주짓수 외 2')
  })
})

describe('altPoolLabel — 공공·대안 풀이 어떤 기준으로 센 수인지', () => {
  it('장애 필터가 걸리면 "장애인 표기"를 함께 적는다', () => {
    expect(altPoolLabel(false)).toBe('공공·대안')
    expect(altPoolLabel(true)).toBe('장애인 표기 공공·대안')
    expect(poolCountText(altPoolLabel(true), { matched: 0, total: 0 })).toBe('장애인 표기 공공·대안 0곳')
  })
})
