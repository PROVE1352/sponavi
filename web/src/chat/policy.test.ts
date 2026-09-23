// 2027 확대 대상 질문(special) — 결정론 정책 고정.
//   · 5~18세 + 소득 '그외' 일 때만, 소득 다음 · 장애 앞에 묻는다
//   · "해당 없음"은 배타 선택이고 요청 값은 [] 이다
//   · 묻지 않은 사람(조건 밖·페르소나)은 항상 special: [] 로 나간다
import { describe, expect, it } from 'vitest'
import { EMPTY_SLOTS, type ChatSlots } from '../types_chat'
import type { Sigungu } from '../types'
import {
  SPECIAL_NONE_ID,
  needsSpecial,
  nextQuestion,
  questionSpec,
  slotsFromRequest,
  specialAnswerChip,
  specialFromSelection,
  toAssessRequest,
  toggleSpecialSelection,
} from './policy'

const SG: Sigungu[] = [{ cd: '11290', nm: '성북구', lat: 37.6057, lon: 127.017 } as Sigungu]

function slots(p: Partial<ChatSlots>): ChatSlots {
  return {
    ...EMPTY_SLOTS,
    age_band: '10s',
    sex: 'F',
    sido_cd: '11',
    sigungu_cd: '11290',
    sigungu_nm: '성북구',
    ...p,
  }
}

describe('needsSpecial / nextQuestion', () => {
  it('16세 · 그외 → 소득 다음에 special 을 묻는다(장애보다 먼저)', () => {
    const s = slots({ age: 16, income_class: '그외' })
    expect(needsSpecial(s)).toBe(true)
    expect(nextQuestion(s)).toBe('special')
    expect(nextQuestion({ ...s, special: [] })).toBe('disability')
  })

  it('경계 5세·18세는 묻고, 4세·19세는 묻지 않는다', () => {
    for (const age of [5, 18]) expect(nextQuestion(slots({ age, income_class: '그외' }))).toBe('special')
    for (const age of [4, 19, 27]) expect(nextQuestion(slots({ age, income_class: '그외' }))).toBe('disability')
  })

  it('소득이 그외가 아니면 묻지 않는다', () => {
    for (const income_class of ['기초생활수급', '차상위', '한부모'] as const) {
      expect(nextQuestion(slots({ age: 12, income_class }))).toBe('disability')
    }
  })

  it('소득을 아직 안 골랐으면 소득이 먼저다', () => {
    expect(nextQuestion(slots({ age: 12 }))).toBe('income')
  })

  it('questionSpec(special)은 다중 선택 3칩(해당 없음 포함)', () => {
    const spec = questionSpec('special', { sigungu: [], personas: [] })
    expect(spec.select).toBe('multi')
    expect(spec.chips.map((c) => c.label)).toEqual(['3자녀 이상 가구', '북한이탈주민', '해당 없음'])
    expect(spec.text).toContain('2027')
  })
})

describe('toggleSpecialSelection — 해당 없음 배타', () => {
  it('해당 없음을 고르면 나머지가 풀린다', () => {
    const a = toggleSpecialSelection(['special-multichild', 'special-defector'], SPECIAL_NONE_ID)
    expect(a).toEqual([SPECIAL_NONE_ID])
  })

  it('다른 것을 고르면 해당 없음이 풀린다', () => {
    expect(toggleSpecialSelection([SPECIAL_NONE_ID], 'special-defector')).toEqual(['special-defector'])
  })

  it('두 항목은 함께 고를 수 있고, 다시 누르면 풀린다', () => {
    const both = toggleSpecialSelection(['special-multichild'], 'special-defector')
    expect(both).toEqual(['special-multichild', 'special-defector'])
    expect(toggleSpecialSelection(both, 'special-multichild')).toEqual(['special-defector'])
  })

  it('해당 없음 = 빈 목록, 선택 → 요청 값', () => {
    expect(specialFromSelection([SPECIAL_NONE_ID])).toEqual([])
    expect(specialFromSelection(['special-defector', 'special-multichild'])).toEqual(['multichild', 'defector'])
    const chip = specialAnswerChip([SPECIAL_NONE_ID])
    expect(chip.action).toEqual({ kind: 'answer', question: 'special', slots: { special: [] } })
    expect(chip.label).toBe('해당 없음')
  })
})

describe('toAssessRequest.special', () => {
  const full = { disability_has: false, disability_type: null }

  it('조건에 맞고 고른 값이 있으면 그대로 보낸다', () => {
    const req = toAssessRequest(slots({ age: 16, income_class: '그외', special: ['multichild'], ...full }), SG)
    expect(req?.special).toEqual(['multichild'])
  })

  it('조건 밖이면 슬롯에 값이 남아 있어도 [] (나이를 나중에 고친 경우)', () => {
    const req = toAssessRequest(slots({ age: 30, income_class: '그외', special: ['defector'], ...full }), SG)
    expect(req?.special).toEqual([])
  })

  it('special 을 아직 안 골랐으면 요청을 만들지 않는다', () => {
    expect(toAssessRequest(slots({ age: 16, income_class: '그외', ...full }), SG)).toBeNull()
  })

  it('페르소나(special 없음)는 [] 로 채워져 질문 없이 완주한다', () => {
    const s = slotsFromRequest({
      age: 16,
      sex: 'M',
      sigungu_cd: '11290',
      sigungu_nm: '성북구',
      income_class: '그외',
      disability: { has: false, type: null },
    })
    expect(s.special).toEqual([])
    expect(nextQuestion(s)).toBeNull()
  })
})
