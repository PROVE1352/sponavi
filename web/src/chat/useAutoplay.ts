// 자동재생 구동부(W2) — 순수 상태기계(autoplay.ts)에 시간·DOM·취소를 붙인다.
//
//   진행 신호 : ChatStream 의 등장 큐 → 스토어 reveal 브리지(DOM 폴링 없음)
//   시간      : 단계별 최소 체류(모션 최소화 600ms) + 진전 없음 타임아웃(절대 멈춰 서지 않음)
//   스크롤    : 단계마다 앵커(PAR-Q → 폼 → 결과)를 화면 안으로. 앱이 일으킨 스크롤이므로
//               취소 트리거가 아니다(설계 실패 모드 표).
//   취소      : wheel/touchmove/pointerdown/keydown 한 번이면 그 자리에서 끝. 이미 그려진
//               화면은 그대로 남고 사용자가 이어서 조작한다.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTOPLAY_CANCEL_EVENTS,
  nextStep,
  stepDwellMs,
  stepTimeoutMs,
  type AutoplayCommand,
  type AutoplayPhase,
  type AutoplayView,
} from './autoplay'
import { prefersReducedMotion, setAutoPacing } from './Typewriter'

// 단계별로 화면에 데려갈 앵커. 덱 도착 뒤 ChatStream 은 바닥 추종을 끄므로
// 자동재생은 스스로 뷰포트를 옮겨야 한다(설계 "스크롤 정책").
const STEP_ANCHOR: Record<AutoplayCommand['kind'], string | null> = {
  start_fitness: '[data-testid="parq-gate"]',
  pass_parq: '[data-testid="fitness-form-card"]',
  submit_form: '[data-testid="fitness-result"]',
  // 필터 적용은 기존 applyFilter 가 패널까지 데려간다(panelFocus) — 여기서 또 옮기지 않는다.
  apply_filter: null,
}

// sticky 헤더가 카드 머리를 덮지 않도록 남기는 여백(ChatStream 덱 오프셋과 같은 값).
const ANCHOR_TOP_OFFSET_PX = 72

export interface AutoplayHandle {
  running: boolean
}

export function useAutoplay({
  armed,
  view,
  progress,
  onCommand,
}: {
  // 딥링크가 자동재생을 요청했고 페르소나까지 확정됐는가(메인 페이지에서는 항상 false).
  armed: boolean
  view: Omit<AutoplayView, 'phase'>
  // 등장 큐가 지금까지 연 버블 수. "진전이 있었는가"의 유일한 근거 —
  // 긴 발화 하나가 타임아웃에 걸리지 않도록 버블이 열릴 때마다 예산을 새로 준다.
  progress: number
  onCommand: (command: AutoplayCommand) => void
}): AutoplayHandle {
  const [running, setRunning] = useState(false)

  const runningRef = useRef(false)
  const startedRef = useRef(false)
  const endedRef = useRef(false)
  const phaseRef = useRef<AutoplayPhase>('assess')
  // 이번 단계의 최소 체류가 끝나는 시각.
  const dwellUntil = useRef(0)
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepKey = useRef('')
  const rafId = useRef(0)

  // 최신 입력값(렌더마다 갱신). 콜백 정체성이 바뀌어도 구동부는 재시작되지 않는다.
  const viewRef = useRef(view)
  const progressRef = useRef(progress)
  const commandRef = useRef(onCommand)
  useEffect(() => {
    viewRef.current = view
    progressRef.current = progress
    commandRef.current = onCommand
  })

  const clearTimers = useCallback(() => {
    if (tickTimer.current) clearTimeout(tickTimer.current)
    if (stepTimer.current) clearTimeout(stepTimer.current)
    tickTimer.current = null
    stepTimer.current = null
    stepKey.current = ''
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = 0
  }, [])

  // 종료(완주·중단·취소)는 한 번만. 이미 그려진 화면은 손대지 않는다.
  const finish = useCallback(
    (outcome: string) => {
      if (endedRef.current || !runningRef.current) return
      endedRef.current = true
      runningRef.current = false
      clearTimers()
      let ms = 0
      try {
        performance.mark('autoplay:done')
        ms = performance.measure('autoplay', 'autoplay:start', 'autoplay:done').duration
      } catch {
        // 측정 실패(마크 유실 등)가 시연을 막지는 않는다.
      }
      // 30초 예산의 실측치. UI 로는 내보내지 않는다(콘솔 1회).
      console.info(`[autoplay] ${outcome} ${Math.round(ms)}ms`)
      setRunning(false)
    },
    [clearTimers],
  )

  // 다음 단계의 카드가 붙는 즉시 화면 안으로. 아직 없으면 몇 프레임 기다린다.
  const scrollAnchor = useCallback((selector: string) => {
    let tries = 0
    const step = () => {
      const list = document.querySelectorAll<HTMLElement>(selector)
      const el = list[list.length - 1]
      if (!el) {
        if (tries++ < 90) rafId.current = requestAnimationFrame(step)
        return
      }
      const top = el.getBoundingClientRect().top + window.scrollY - ANCHOR_TOP_OFFSET_PX
      window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
    rafId.current = requestAnimationFrame(step)
  }, [])

  // 반환 타입을 명시한다 — 본문이 자기 자신을 다시 예약하므로 추론이 순환한다.
  const tick = useCallback<() => void>(() => {
    if (!runningRef.current) return
    const v: AutoplayView = { ...viewRef.current, phase: phaseRef.current }
    const decision = nextStep(v)

    if (decision.kind === 'stop') {
      finish(`stopped:${decision.reason}`)
      return
    }
    if (decision.kind === 'done') {
      finish('done')
      return
    }
    if (decision.kind === 'wait') {
      // 진전(단계 전환·상태 변화·버블 1개 열림)이 있을 때마다 예산을 새로 준다.
      const key = `${v.phase}|${v.busy}|${progressRef.current}`
      if (stepKey.current !== key) {
        stepKey.current = key
        if (stepTimer.current) clearTimeout(stepTimer.current)
        stepTimer.current = setTimeout(() => finish('stopped:timeout'), stepTimeoutMs(v.busy))
      }
      return
    }

    // act — 최소 체류를 채운 뒤 실행한다.
    const rest = dwellUntil.current - performance.now()
    if (rest > 0) {
      if (tickTimer.current) clearTimeout(tickTimer.current)
      tickTimer.current = setTimeout(() => tick(), rest)
      return
    }
    phaseRef.current = decision.next
    dwellUntil.current = performance.now() + stepDwellMs(prefersReducedMotion())
    stepKey.current = ''
    if (stepTimer.current) clearTimeout(stepTimer.current)
    commandRef.current(decision.command)
    const anchor = STEP_ANCHOR[decision.command.kind]
    if (anchor) scrollAnchor(anchor)
    // 새 단계를 곧바로 한 번 평가한다(다음 렌더를 기다리지 않는다).
    if (tickTimer.current) clearTimeout(tickTimer.current)
    tickTimer.current = setTimeout(() => tick(), 0)
  }, [finish, scrollAnchor])

  // ── 시작: 딥링크가 요청했고 페르소나가 확정된 순간 1회 ──────────────────
  useEffect(() => {
    if (!armed || startedRef.current) return
    startedRef.current = true
    runningRef.current = true
    endedRef.current = false
    phaseRef.current = 'assess'
    dwellUntil.current = 0
    try {
      performance.mark('autoplay:start')
    } catch {
      // 측정 불가 환경 — 재생 자체는 계속한다.
    }
    // 첫 버블부터 8ms/자로 나오도록 상태 반영을 기다리지 않고 지금 켠다(끄기는 아래 훅이 담당).
    setAutoPacing(true)
    setRunning(true)
  }, [armed])

  // 자동재생 중에만 타이프라이터를 8ms/자로 당긴다(PRD FR-12 AC10 v1.10 단서).
  useEffect(() => {
    if (!running) return
    setAutoPacing(true)
    return () => setAutoPacing(false)
  }, [running])

  // 취소 리스너는 재생 중에만 붙어 있다. 앱 자체 scrollTo 는 여기 없다 —
  // 'scroll' 을 듣지 않으므로 단계별 앵커 이동이 자동재생을 죽이지 않는다.
  useEffect(() => {
    if (!running) return
    const onUserInput = () => finish('canceled')
    for (const type of AUTOPLAY_CANCEL_EVENTS) {
      window.addEventListener(type, onUserInput, { once: true, capture: true })
    }
    return () => {
      for (const type of AUTOPLAY_CANCEL_EVENTS) {
        window.removeEventListener(type, onUserInput, { capture: true })
      }
    }
  }, [running, finish])

  // 렌더마다(=상태가 바뀔 때마다) 한 번 평가한다. tick 은 멱등이다.
  useEffect(() => {
    if (!runningRef.current) return
    tick()
  })

  useEffect(() => clearTimers, [clearTimers])

  return { running }
}
