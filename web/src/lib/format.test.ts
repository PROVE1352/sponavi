// 표기 헬퍼 스모크 테스트(T1A). 지금은 기존 동작만 고정한다 —
// won()/CQ1A(null 3셀) 등 나머지는 Lane W 가 구현과 함께 추가한다.
import { describe, expect, it } from 'vitest'
import { km, percent, weekdays } from './format'

describe('km', () => {
  it('소수 첫째 자리로 반올림해 km 를 붙인다', () => {
    expect(km(1.6)).toBe('1.6km')
    expect(km(0.34)).toBe('0.3km')
  })

  it('정수도 소수 한 자리로 맞춘다', () => {
    expect(km(3)).toBe('3.0km')
    expect(km(0)).toBe('0.0km')
  })
})

describe('weekdays', () => {
  it('요일 마스크(월화수목금토일)를 가운뎃점으로 잇는다', () => {
    expect(weekdays('1010100')).toBe('월·수·금')
    expect(weekdays('0000011')).toBe('토·일')
    expect(weekdays('1111111')).toBe('월·화·수·목·금·토·일')
  })

  it('선택된 요일이 없거나 마스크가 짧으면 있는 만큼만 낸다', () => {
    expect(weekdays('0000000')).toBe('')
    expect(weekdays('')).toBe('')
    expect(weekdays('11')).toBe('월·화')
  })
})

describe('percent', () => {
  it('비율(0~1)을 소수 첫째 자리 퍼센트로 쓴다', () => {
    expect(percent(0.214)).toBe('21.4%')
    expect(percent(1)).toBe('100.0%')
    expect(percent(0)).toBe('0.0%')
  })
})
