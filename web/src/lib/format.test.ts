// 표기 헬퍼 스모크 테스트(T1A). 지금은 기존 동작만 고정한다 —
// won()/CQ1A(결측 null) 케이스는 Lane W(T8)가 구현과 함께 붙였다.
import { describe, expect, it } from 'vitest'
import {
  dedupeDisplayTitles,
  displayTitle,
  km,
  percent,
  splitDateTokens,
  weekdays,
  won,
  wonKorean,
  wonPlain,
} from './format'

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

describe('won', () => {
  it('결측(null)은 0원이 아니라 "미등록·시설 문의"다 (CQ1A · P-1)', () => {
    expect(won(null)).toBe('미등록·시설 문의')
  })

  it('실제 0원은 "무료"다 — null 과 다른 뜻', () => {
    expect(won(0)).toBe('무료')
  })

  it('양수는 천 단위 구분 + 원', () => {
    expect(won(110000)).toBe('110,000원')
    expect(won(5000)).toBe('5,000원')
  })
})

describe('wonPlain', () => {
  it('0도 "무료"로 바꾸지 않고 그대로 0원이라고 쓴다(자부담 셀)', () => {
    expect(wonPlain(0)).toBe('0원')
    expect(wonPlain(105000)).toBe('105,000원')
  })
})

// C-5: 영상 카드 제목의 "-1" 은 이름이 아니라 원천의 변형 번호다(표시용으로만 뗀다).
describe('displayTitle', () => {
  it('★ C-5 회귀: 끝에 붙은 변형 번호를 표시용으로 떼어낸다', () => {
    expect(displayTitle('교차윗몸일으키기-1')).toBe('교차윗몸일으키기')
    expect(displayTitle('교차윗몸일으키기_2')).toBe('교차윗몸일으키기')
    expect(displayTitle('반복 옆뛰기-10')).toBe('반복 옆뛰기')
  })

  it('꼬리가 없으면 그대로 둔다', () => {
    expect(displayTitle('윗몸 말아올리기')).toBe('윗몸 말아올리기')
    expect(displayTitle('스텝검사')).toBe('스텝검사')
  })

  it('이름의 일부인 숫자·중간 하이픈은 건드리지 않는다', () => {
    expect(displayTitle('1분 플랭크')).toBe('1분 플랭크')
    expect(displayTitle('20m 왕복오래달리기')).toBe('20m 왕복오래달리기')
    expect(displayTitle('셔틀런-20m 구간')).toBe('셔틀런-20m 구간')
  })

  it('꼬리를 떼면 아무것도 안 남는 제목은 원문을 유지한다(빈 이름 금지)', () => {
    expect(displayTitle('-1')).toBe('-1')
    expect(displayTitle('_3')).toBe('_3')
  })
})

describe('dedupeDisplayTitles', () => {
  it('꼬리를 떼서 이름이 겹치면 두 번째부터 (2)·(3)으로 구별한다', () => {
    expect(
      dedupeDisplayTitles(['교차윗몸일으키기', '교차윗몸일으키기-1', '윗몸 말아올리기']),
    ).toEqual(['교차윗몸일으키기', '교차윗몸일으키기 (2)', '윗몸 말아올리기'])
    expect(dedupeDisplayTitles(['걷기-1', '걷기-2', '걷기-3'])).toEqual([
      '걷기',
      '걷기 (2)',
      '걷기 (3)',
    ])
  })

  it('겹치지 않으면 접미사를 붙이지 않는다', () => {
    expect(dedupeDisplayTitles(['스텝검사', '걷기 운동'])).toEqual(['스텝검사', '걷기 운동'])
    expect(dedupeDisplayTitles([])).toEqual([])
  })
})

describe('wonKorean', () => {
  it('만·천 단위로 읽는다', () => {
    expect(wonKorean(105000)).toBe('10만 5천 원')
    expect(wonKorean(110000)).toBe('11만 원')
    expect(wonKorean(5000)).toBe('5천 원')
  })

  it('딱 떨어지지 않거나 0 이하면 숫자 그대로', () => {
    expect(wonKorean(105500)).toBe('105,500원')
    expect(wonKorean(0)).toBe('0원')
  })
})

describe('splitDateTokens', () => {
  it('날짜 토큰(접두 포함)을 홀수 인덱스로 떼어 낸다', () => {
    expect(splitDateTokens('공식 확인(조례 2026-09-17)')).toEqual(['공식 확인(조례 ', '2026-09-17', ')'])
    expect(splitDateTokens('출처 · 확인일 2026-09-23')).toEqual(['출처 · ', '확인일 2026-09-23', ''])
    expect(splitDateTokens('날짜 없음')).toEqual(['날짜 없음'])
  })
})
