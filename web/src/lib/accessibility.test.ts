// C-3(P-1 정직성): 한 카드가 "✓ 장애인 지원"과 "접근성 정보 없음"을 동시에 말하지 않는다.
// 판정은 accessibilityView 한 곳에서만 나오므로, 그 불변식을 여기서 못 박는다.
import { describe, expect, it } from 'vitest'
import {
  NO_INFO_TEXT,
  SUPPORT_LABEL,
  UNKNOWN_TYPES_LABEL,
  accessibilityView,
} from './accessibility'
import type { FacilityAccessibility } from '../types_accessibility'

const TOILET = { code: '01', name: '장애인 화장실' }

function acc(partial: Partial<FacilityAccessibility> = {}): FacilityAccessibility {
  return {
    types: [],
    amenities: [],
    source: '장애인이용권 웹 공개 정보',
    checked: '2026-07-21',
    ...partial,
  }
}

describe('accessibilityView — 확언(✓)은 지원유형이 있을 때만', () => {
  it('지원유형이 있으면 "✓ 장애인 지원" 확언 + 정보 없음 문구는 만들지 않는다', () => {
    const v = accessibilityView(true, acc({ types: ['시각', '청각'] }))
    expect(v.badge).toEqual({ kind: 'confirmed', label: SUPPORT_LABEL })
    expect(v.types).toEqual(['시각', '청각'])
    expect(v.note).toBeNull()
  })

  it('지원유형이 없으면 불리언이 참이어도 확언하지 않는다 — "유형 미상"으로 적는다', () => {
    const v = accessibilityView(true)
    expect(v.badge).toEqual({ kind: 'unknown-types', label: UNKNOWN_TYPES_LABEL })
    expect(v.badge?.label).not.toBe(SUPPORT_LABEL)
  })

  it('★ C-3 회귀: 지원 불리언이 참이면 "접근성 정보 없음"이라고 말하지 않는다', () => {
    // 국제복싱체육관 사례 — 배지는 "지원함", 본문은 "정보 없음"이던 모순.
    const v = accessibilityView(true, undefined, false)
    expect(v.note).toBeNull()
    expect(v.badge?.kind).toBe('unknown-types')
  })

  it('지원 사실도 유형도 없을 때만 "접근성 정보 없음"이 나온다', () => {
    const v = accessibilityView(null)
    expect(v.badge).toBeNull()
    expect(v.note).toBe('none')
    expect(NO_INFO_TEXT).toBe('접근성 정보 없음')
  })

  it('유형은 비었지만 편의시설 태그가 있으면 "없음"이 아니다', () => {
    const v = accessibilityView(null, acc({ amenities: [TOILET] }))
    expect(v.note).toBeNull()
    expect(v.amenities).toEqual([TOILET])
    expect(v.badge).toBeNull() // 편의시설만으로 "지원함"을 확언하지는 않는다
  })

  it('빈 응답(유형·편의시설 모두 없음)은 지원 사실이 없으면 "없음"', () => {
    const v = accessibilityView(false, acc())
    expect(v.note).toBe('none')
    expect(v.badge).toBeNull()
  })

  it('조회 실패는 "없음"과 다른 사실 — 실패로 적고, 지원 배지와 공존할 수 있다', () => {
    expect(accessibilityView(null, undefined, true).note).toBe('error')
    const withSupport = accessibilityView(true, undefined, true)
    expect(withSupport.note).toBe('error')
    expect(withSupport.badge?.kind).toBe('unknown-types')
  })
})

describe('accessibilityView — 불변식', () => {
  const supports: (boolean | null | undefined)[] = [true, false, null, undefined]
  const datas: (FacilityAccessibility | undefined)[] = [
    undefined,
    acc(),
    acc({ types: ['지체'] }),
    acc({ amenities: [TOILET] }),
    acc({ types: ['지체'], amenities: [TOILET] }),
  ]

  it('어떤 입력 조합에서도 확언(✓)과 "정보 없음"이 동시에 서지 않는다', () => {
    for (const s of supports)
      for (const d of datas)
        for (const e of [true, false]) {
          const v = accessibilityView(s, d, e)
          const affirms = v.badge?.kind === 'confirmed'
          expect(affirms && v.note === 'none', `support=${s} data=${!!d} error=${e}`).toBe(false)
          // 확언은 반드시 근거(지원유형)를 동반한다
          if (affirms) expect(v.types.length).toBeGreaterThan(0)
        }
  })
})
