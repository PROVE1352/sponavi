// W2 자동재생(딥링크 `#/demo?p=P2&auto=1`)의 **순수** 상태기계.
//
//   심사위원이 QR 을 찍고 손을 대지 않아도 P2 여정이 혼자 재생된다:
//     페르소나 자동 선택(W1) → 판정 도착 → "체력 처방 시작" → PAR-Q 프리셋 →
//     프리필 폼 자동 제출 → 체력 결과 → 시설 필터 적용
//
// 이 파일에는 React·DOM·타이머가 없다(vitest node 환경에서 그대로 돈다).
// 부수효과(타이머·취소 리스너·스크롤·performance.mark)는 useAutoplay.ts 가 소유하고,
// "지금 무엇을 할 차례인가"는 여기 nextStep() 한 곳에서만 정한다.
//
// 설계 근거: docs/designs/kspo-two-sided-product.md W2 행 + "자동재생 실패 모드" 표,
//            docs/PRD.md FR-12 AC10(auto 8ms/자) · ★FR-P2(demo.parq_preset).

import type { DemoPersona, FitnessItem } from '../types'
import type { FitnessFormRow } from '../types_chat'

// 자동재생 중 화면에 뜨는 작은 알림 필(사용자가 멈출 수 있다는 사실을 숨기지 않는다).
export const AUTOPLAY_STATUS_TEXT = '자동 시연 중 · 화면을 터치하면 멈춤'

// PAR-Q 를 자동 통과했다는 사실은 카드 위에 남는다 — 실사용자가 이 화면을 보고
// "문진을 안 했는데 넘어갔다"고 오해하면 안 된다(P-1 정직 표기).
export const PARQ_PRESET_NOTE = '데모 페르소나 문진 프리셋 — 실사용은 직접 확인'

// 사용자 개입 = 즉시 중단. 앱이 스스로 일으키는 scrollTo 는 여기 없다 —
// 'scroll' 을 넣으면 우리 자신의 앵커 스크롤이 자동재생을 죽인다(설계 실패 모드 표).
export const AUTOPLAY_CANCEL_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const
export type AutoplayCancelEvent = (typeof AUTOPLAY_CANCEL_EVENTS)[number]

// 단계별 최소 체류. prefers-reduced-motion 이면 타이프라이터가 즉시 끝나 화면이
// 순간이동해 버린다 — 심사위원이 눈으로 따라올 최소한의 시간을 강제한다.
export const AUTOPLAY_MIN_DWELL_MS = 600
// 한 단계가 이만큼 진전이 없으면 자동재생을 끝낸다(절대 멈춰 선 채로 남지 않게).
export const AUTOPLAY_STEP_TIMEOUT_MS = 4_000
// 네트워크 대기 중(판정·항목 조회·제출)에는 예산을 늘린다 — 느린 회선을 실패로 오인하지 않는다.
export const AUTOPLAY_BUSY_TIMEOUT_MS = 12_000

export function stepDwellMs(reduced: boolean): number {
  return reduced ? AUTOPLAY_MIN_DWELL_MS : 0
}

export function stepTimeoutMs(busy: boolean): number {
  return busy ? AUTOPLAY_BUSY_TIMEOUT_MS : AUTOPLAY_STEP_TIMEOUT_MS
}

// ────────────────────────────── 상태기계 ──────────────────────────────
//
// phase = "다음에 할 일". 각 단계는 앞 단계의 UI 가 실제로 그려질 때까지(settled) 기다린다.

export type AutoplayPhase = 'assess' | 'parq' | 'form' | 'filter' | 'done'

export type AutoplayCommand =
  | { kind: 'start_fitness' }
  | { kind: 'pass_parq' }
  | { kind: 'submit_form'; measures: Record<string, number> }
  | { kind: 'apply_filter'; sports: string[] }

// 설계 "자동재생 실패 모드" 표의 중단 사유 — 어느 쪽이든 화면은 이미 그려진 것을 유지한다.
export type AutoplayStopReason =
  | 'assess_failed' // /api/assess 실패 → 기존 error 버블 + 재시도
  | 'no_parq_preset' // 페르소나에 문진 프리셋이 없다 → 사용자가 직접 체크
  | 'items_failed' // /api/fitness/items 실패 → 기존 재시도 패널
  | 'no_prefill' // 프리필로 채울 값이 없다 → 폼을 사용자에게 넘긴다
  | 'fitness_failed' // /api/fitness 실패 → 기존 error + 재시도
  | 'timeout' // 단계가 진전 없이 예산 초과

export type AutoplayDecision =
  | { kind: 'wait' }
  | { kind: 'act'; command: AutoplayCommand; next: AutoplayPhase }
  | { kind: 'stop'; reason: AutoplayStopReason }
  | { kind: 'done' }

// 상태기계가 보는 세상 전부. 전부 원시값이라 테스트에서 손으로 만들 수 있다.
export interface AutoplayView {
  phase: AutoplayPhase
  // 등장 큐(ChatStream useRevealQueue)가 조용해졌는가 — DOM 폴링 대신 이 신호만 본다.
  settled: boolean
  // 네트워크 진행 중(pending · itemsLoading · submitting) — 타임아웃 예산을 늘린다.
  busy: boolean
  assessDone: boolean
  assessError: boolean
  parqPreset: boolean
  parqShown: boolean
  formShown: boolean
  itemsError: boolean
  itemsReady: boolean
  // 프리필로 만든 자동 제출값. 비어 있으면 제출 조건 미달(폼의 "1개 이상" 규칙과 동일).
  measures: Record<string, number>
  submitError: boolean
  resultShown: boolean
  filterSports: string[]
}

export function nextStep(v: AutoplayView): AutoplayDecision {
  switch (v.phase) {
    // (a) 페르소나 선택은 W1 이 이미 했다 → 판정 카드가 실제로 그려지길 기다린다.
    // (b) 그다음 "체력 처방 시작" 칩과 같은 액션을 쏜다.
    case 'assess':
      if (v.assessError) return { kind: 'stop', reason: 'assess_failed' }
      if (!v.assessDone || v.busy || !v.settled) return { kind: 'wait' }
      return { kind: 'act', command: { kind: 'start_fitness' }, next: 'parq' }

    // (c) PAR-Q: 프리셋 페르소나만 자동 통과. 아니면 여기서 멈추고 사용자가 직접 체크한다.
    case 'parq':
      if (!v.parqPreset) return { kind: 'stop', reason: 'no_parq_preset' }
      if (!v.parqShown || !v.settled) return { kind: 'wait' }
      return { kind: 'act', command: { kind: 'pass_parq' }, next: 'form' }

    // (d) 측정 폼: 항목 로드 → 프리필 → 자동 제출. 채울 값이 없으면 폼은 사용자 몫이다.
    case 'form':
      if (v.itemsError) return { kind: 'stop', reason: 'items_failed' }
      if (!v.formShown || !v.itemsReady || v.busy) return { kind: 'wait' }
      if (Object.keys(v.measures).length === 0) return { kind: 'stop', reason: 'no_prefill' }
      if (!v.settled) return { kind: 'wait' }
      return { kind: 'act', command: { kind: 'submit_form', measures: v.measures }, next: 'filter' }

    // (e) 결과 도착 → 기존 "이 종목 시설 보기" 액션으로 근처 목록을 좁힌다.
    case 'filter':
      if (v.submitError) return { kind: 'stop', reason: 'fitness_failed' }
      if (!v.resultShown || v.busy || !v.settled) return { kind: 'wait' }
      if (v.filterSports.length === 0) return { kind: 'done' }
      return { kind: 'act', command: { kind: 'apply_filter', sports: v.filterSports }, next: 'done' }

    case 'done':
      return { kind: 'done' }
  }
}

// ────────────────────────────── 프리필 → 자동 제출값 ──────────────────────────────

function finite(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// 파생 항목(BMI)의 입력 묶음. FitnessForm.derivedInputs 와 같은 규칙 —
// 전부 있고 범위 안일 때만 {키·몸무게}를 그대로 실어 보낸다(계산은 서버가 한다).
function derivedInputsOf(
  item: FitnessItem,
  prefill: Record<string, number>,
): Record<string, number> | null {
  const inputs = item.derived_from ?? []
  if (inputs.length === 0) return null
  const out: Record<string, number> = {}
  for (const d of inputs) {
    const v = finite(prefill[d.code])
    if (v == null) return null
    if (d.min != null && v < d.min) return null
    if (d.max != null && v > d.max) return null
    out[d.code] = v
  }
  return out
}

// 폼이 그리는 행(useFitness.grouped)과 페르소나 프리필로 "자동 제출에 실릴 측정값"을 만든다.
// FitnessFormCard 의 measures 계산과 같은 규칙이라 화면에 보이는 값과 전송값이 어긋나지 않는다:
//   · 파생 항목은 값 대신 입력 묶음(키·몸무게)
//   · alt_group 택1은 폼의 기본 선택 = 첫 옵션
//   · 나머지는 코드값 그대로, 프리필에 없는 항목은 빈 칸(전송 안 함)
export function prefillMeasures(
  grouped: [string, FitnessFormRow[]][],
  prefill: Record<string, number> | null,
): Record<string, number> {
  if (!prefill) return {}
  const m: Record<string, number> = {}
  for (const [, rows] of grouped) {
    for (const row of rows) {
      if (row.kind === 'single' && row.item.derived_from?.length) {
        const d = derivedInputsOf(row.item, prefill)
        if (d) Object.assign(m, d)
        continue
      }
      const code = row.kind === 'single' ? row.item.code : row.options[0].code
      const v = finite(prefill[code])
      if (v != null) m[code] = v
    }
  }
  return m
}

// ────────────────────────────── 페르소나 폴백 ──────────────────────────────

// 실패 모드 표: `/api/demo/personas` 가 죽어도 `p=P2&auto=1` 은 재생돼야 한다(보고서 QR 주소).
// 그래서 P2 **요청 바디만** 클라 상수로 들고 있는다 — 판정·시설·체력은 전부 서버가 계산한다.
// 값 출처: server/app/personas.py P2 body + demo(문진 프리셋·측정 프리필).
// location 은 서버 바디에 없다 — 없는 좌표를 지어내지 않는다(P-1).
export const AUTOPLAY_P2_FALLBACK: DemoPersona = {
  id: 'P2',
  label: '27세 남 · 그 외(낀 계층) · 성북구 · 비장애',
  summary: '이용권 ✗(소득) → 대체경로 → 공공체육시설 + 체력처방 결합',
  age: 27,
  sex: 'M',
  sigungu_cd: '11290',
  sigungu_nm: '성북구',
  income_class: '그외',
  disability: { has: false, type: null },
  location: null,
  demo: {
    fitness: {
      crunch_cross: 35,
      shuttle_20m: 42,
      sit_reach: 6,
      grip_rel: 58,
      height_cm: 175,
      weight_kg: 72,
    },
    parq_preset: true,
  },
}

// 딥링크가 지목한 페르소나를 고른다. 조회가 통째로 비었고(=실패) 자동재생 요청이면
// P2 에 한해 위 상수로 폴백한다 — 다른 id 는 폴백 없이 그냥 멈춘다.
export function pickAutoplayPersona(
  personas: DemoPersona[],
  wanted: string | null,
  auto: boolean,
): { persona: DemoPersona | null; fallback: boolean } {
  if (!wanted) return { persona: null, fallback: false }
  const hit = personas.find((p) => p.id === wanted)
  if (hit) return { persona: hit, fallback: false }
  if (!auto || personas.length > 0) return { persona: null, fallback: false }
  if (wanted !== AUTOPLAY_P2_FALLBACK.id) return { persona: null, fallback: false }
  return { persona: AUTOPLAY_P2_FALLBACK, fallback: true }
}
