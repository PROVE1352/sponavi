// 자동재생(W2) 순수부 단위 테스트 — 단계 순서·중단 가드·프리필 제출값·취소 이벤트 집합.
// 시간·DOM 은 useAutoplay 몫이라 여기서는 상태기계만 본다(vitest node 환경).

import { describe, expect, it } from 'vitest'
import type { DemoPersona, FitnessItem } from '../types'
import type { FitnessFormRow } from '../types_chat'
import {
  AUTOPLAY_BUSY_TIMEOUT_MS,
  AUTOPLAY_CANCEL_EVENTS,
  AUTOPLAY_MIN_DWELL_MS,
  AUTOPLAY_P2_FALLBACK,
  AUTOPLAY_STEP_TIMEOUT_MS,
  nextStep,
  pickAutoplayPersona,
  prefillMeasures,
  stepDwellMs,
  stepTimeoutMs,
  type AutoplayView,
} from './autoplay'

// 모든 조건이 갖춰진 상태(= 그 단계가 지금 실행돼야 하는 상태). 각 테스트가 한 칸씩 뒤집는다.
function view(over: Partial<AutoplayView> = {}): AutoplayView {
  return {
    phase: 'assess',
    settled: true,
    busy: false,
    assessDone: true,
    assessError: false,
    parqPreset: true,
    parqShown: true,
    formShown: true,
    itemsError: false,
    itemsReady: true,
    measures: { crunch_cross: 35 },
    submitError: false,
    resultShown: true,
    filterSports: ['헬스'],
    ...over,
  }
}

describe('nextStep — 단계 순서', () => {
  it('판정 카드가 그려지면 "체력 처방 시작"을 쏘고 PAR-Q 단계로 넘어간다', () => {
    expect(nextStep(view({ phase: 'assess' }))).toEqual({
      kind: 'act',
      command: { kind: 'start_fitness' },
      next: 'parq',
    })
  })

  it('PAR-Q 프리셋이면 게이트를 자동 통과하고 폼 단계로 넘어간다', () => {
    expect(nextStep(view({ phase: 'parq' }))).toEqual({
      kind: 'act',
      command: { kind: 'pass_parq' },
      next: 'form',
    })
  })

  it('폼은 프리필 측정값으로 자동 제출된다', () => {
    expect(nextStep(view({ phase: 'form' }))).toEqual({
      kind: 'act',
      command: { kind: 'submit_form', measures: { crunch_cross: 35 } },
      next: 'filter',
    })
  })

  it('결과가 뜨면 그 종목으로 시설 필터를 적용하고 끝난다', () => {
    expect(nextStep(view({ phase: 'filter' }))).toEqual({
      kind: 'act',
      command: { kind: 'apply_filter', sports: ['헬스'] },
      next: 'done',
    })
    expect(nextStep(view({ phase: 'done' }))).toEqual({ kind: 'done' })
  })

  it('필터 종목이 없으면 필터를 억지로 걸지 않고 완주로 끝낸다', () => {
    expect(nextStep(view({ phase: 'filter', filterSports: [] }))).toEqual({ kind: 'done' })
  })
})

describe('nextStep — 앞 단계 UI 가 그려질 때까지 기다린다', () => {
  it('등장 큐가 아직 재생 중이면 어느 단계든 대기', () => {
    for (const phase of ['assess', 'parq', 'form', 'filter'] as const) {
      expect(nextStep(view({ phase, settled: false })), phase).toEqual({ kind: 'wait' })
    }
  })

  it('네트워크가 도는 중(판정·항목·제출)에는 대기', () => {
    expect(nextStep(view({ phase: 'assess', busy: true }))).toEqual({ kind: 'wait' })
    expect(nextStep(view({ phase: 'form', busy: true }))).toEqual({ kind: 'wait' })
    expect(nextStep(view({ phase: 'filter', busy: true }))).toEqual({ kind: 'wait' })
  })

  it('아직 카드가 붙지 않았으면 대기', () => {
    expect(nextStep(view({ phase: 'assess', assessDone: false }))).toEqual({ kind: 'wait' })
    expect(nextStep(view({ phase: 'parq', parqShown: false }))).toEqual({ kind: 'wait' })
    expect(nextStep(view({ phase: 'form', formShown: false }))).toEqual({ kind: 'wait' })
    expect(nextStep(view({ phase: 'form', itemsReady: false }))).toEqual({ kind: 'wait' })
    expect(nextStep(view({ phase: 'filter', resultShown: false }))).toEqual({ kind: 'wait' })
  })
})

describe('nextStep — 실패 모드 표대로 중단한다(빈 화면·무한 루프 없음)', () => {
  it('/api/assess 실패 → 기존 error 버블에 맡기고 중단', () => {
    expect(nextStep(view({ phase: 'assess', assessError: true, assessDone: false }))).toEqual({
      kind: 'stop',
      reason: 'assess_failed',
    })
  })

  it('문진 프리셋이 없는 페르소나는 PAR-Q 앞에서 멈춘다(사용자가 직접 체크)', () => {
    expect(nextStep(view({ phase: 'parq', parqPreset: false }))).toEqual({
      kind: 'stop',
      reason: 'no_parq_preset',
    })
  })

  it('/api/fitness/items 실패 → 폼을 그릴 수 없으니 중단(기존 재시도 패널)', () => {
    expect(nextStep(view({ phase: 'form', itemsError: true, itemsReady: false }))).toEqual({
      kind: 'stop',
      reason: 'items_failed',
    })
  })

  it('프리필로 채울 값이 하나도 없으면 폼을 사용자에게 넘긴다', () => {
    expect(nextStep(view({ phase: 'form', measures: {} }))).toEqual({
      kind: 'stop',
      reason: 'no_prefill',
    })
  })

  it('/api/fitness 실패 → error + 재시도에 맡기고 중단', () => {
    expect(nextStep(view({ phase: 'filter', submitError: true, resultShown: false }))).toEqual({
      kind: 'stop',
      reason: 'fitness_failed',
    })
  })
})

describe('페이싱·취소 계약', () => {
  it('모션 최소화면 단계마다 최소 체류를 강제한다(즉시 표시로 화면이 순간이동하지 않게)', () => {
    expect(stepDwellMs(true)).toBe(AUTOPLAY_MIN_DWELL_MS)
    expect(AUTOPLAY_MIN_DWELL_MS).toBe(600)
    // 일반 모드는 타이프라이터·인디케이터가 이미 체류를 만든다 — 추가 지연 없음.
    expect(stepDwellMs(false)).toBe(0)
  })

  it('진전 없음 예산: 네트워크 대기 중에는 더 길게 준다', () => {
    expect(stepTimeoutMs(false)).toBe(AUTOPLAY_STEP_TIMEOUT_MS)
    expect(stepTimeoutMs(true)).toBe(AUTOPLAY_BUSY_TIMEOUT_MS)
    expect(AUTOPLAY_STEP_TIMEOUT_MS).toBeLessThan(AUTOPLAY_BUSY_TIMEOUT_MS)
  })

  it('취소 트리거는 사용자 입력 4종뿐 — 앱 자체 스크롤은 포함하지 않는다', () => {
    expect([...AUTOPLAY_CANCEL_EVENTS]).toEqual(['wheel', 'touchmove', 'pointerdown', 'keydown'])
    expect([...AUTOPLAY_CANCEL_EVENTS]).not.toContain('scroll')
  })
})

// ────────────────────────────── 프리필 → 자동 제출값 ──────────────────────────────

function item(code: string, over: Partial<FitnessItem> = {}): FitnessItem {
  return {
    code,
    name: code,
    unit: null,
    factor: '근력',
    alt_group: null,
    higher_better: 1,
    hint: '',
    ...over,
  }
}

const ADULT_ROWS: [string, FitnessFormRow[]][] = [
  ['근지구력', [{ kind: 'single', item: item('crunch_cross') }]],
  [
    '심폐지구력',
    [
      {
        kind: 'alt',
        altGroup: '심폐_왕복스텝',
        factor: '심폐지구력',
        options: [item('shuttle_20m'), item('treadmill_step')],
      },
    ],
  ],
  [
    '신체조성',
    [
      {
        kind: 'single',
        item: item('bmi', {
          derived_from: [
            { code: 'height_cm', name: '키', unit: 'cm', min: 100, max: 250 },
            { code: 'weight_kg', name: '몸무게', unit: 'kg', min: 20, max: 300 },
          ],
        }),
      },
      { kind: 'single', item: item('body_fat') },
    ],
  ],
]

describe('prefillMeasures — 폼이 계산하는 measures 와 같은 규칙', () => {
  it('P2 프리필: 택1은 첫 옵션, BMI 는 키·몸무게 입력으로, 없는 항목은 빈 칸', () => {
    expect(prefillMeasures(ADULT_ROWS, AUTOPLAY_P2_FALLBACK.demo.fitness)).toEqual({
      crunch_cross: 35,
      shuttle_20m: 42,
      height_cm: 175,
      weight_kg: 72,
    })
  })

  it('파생 입력이 하나라도 빠지거나 범위를 벗어나면 BMI 를 만들지 않는다', () => {
    expect(prefillMeasures(ADULT_ROWS, { height_cm: 175 })).toEqual({})
    expect(prefillMeasures(ADULT_ROWS, { height_cm: 5, weight_kg: 72 })).toEqual({})
  })

  it('프리필이 없으면 자동 제출값도 없다(= 폼은 사용자 몫)', () => {
    expect(prefillMeasures(ADULT_ROWS, null)).toEqual({})
    expect(prefillMeasures([], { crunch_cross: 35 })).toEqual({})
  })
})

// ────────────────────────────── 페르소나 폴백 ──────────────────────────────

const P5: DemoPersona = {
  id: 'P5',
  label: '테스트',
  summary: '테스트',
  age: 33,
  sex: 'M',
  sigungu_cd: '11290',
  sigungu_nm: '성북구',
  income_class: '그외',
  disability: { has: false, type: null },
  demo: { fitness: null, parq_preset: true },
}

describe('pickAutoplayPersona — 조회 실패 폴백은 P2 딥링크에만', () => {
  it('목록에 있으면 그대로 쓴다', () => {
    expect(pickAutoplayPersona([P5], 'P5', true)).toEqual({ persona: P5, fallback: false })
  })

  it('p 가 없으면 아무것도 고르지 않는다(auto 만 있는 링크)', () => {
    expect(pickAutoplayPersona([P5], null, true)).toEqual({ persona: null, fallback: false })
  })

  it('조회가 실패(빈 배열)해도 p=P2&auto=1 은 클라 상수 바디로 시작한다', () => {
    expect(pickAutoplayPersona([], 'P2', true)).toEqual({
      persona: AUTOPLAY_P2_FALLBACK,
      fallback: true,
    })
    // 폴백 바디는 판정에 필요한 5슬롯 + 체력 프리필·문진 프리셋을 갖춘다.
    expect(AUTOPLAY_P2_FALLBACK.age).toBe(27)
    expect(AUTOPLAY_P2_FALLBACK.sigungu_cd).toBe('11290')
    expect(AUTOPLAY_P2_FALLBACK.demo.parq_preset).toBe(true)
  })

  it('P2 가 아닌 id·자동재생이 아닌 링크·조회 성공 시에는 폴백하지 않는다', () => {
    expect(pickAutoplayPersona([], 'P5', true)).toEqual({ persona: null, fallback: false })
    expect(pickAutoplayPersona([], 'P2', false)).toEqual({ persona: null, fallback: false })
    expect(pickAutoplayPersona([P5], 'P2', true)).toEqual({ persona: null, fallback: false })
  })
})
