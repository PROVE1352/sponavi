// 봇 발화 타이프라이터(FR-12 AC10).
//
// 스크린리더 계약이 이 구현의 형태를 결정한다: 문자 단위로 DOM 을 갈아 끼우면
// aria-live 스트림이 글자마다 낭독을 다시 시작한다. 그래서 "완성 문장은 처음부터
// DOM 에 통째로 있고, 아직 안 나온 뒷부분만 투명(opacity:0)"으로 둔다.
//   · 낭독은 메시지가 붙는 순간 완성 문장 1회 — 문자 단위 갱신 없음
//   · 레이아웃이 처음부터 최종 크기 — 타이핑 중 버블이 커지며 스트림이 흔들리지 않음
//   · 최종 상태는 항상 완전 — 중간에 끊겨도 문장이 잘리지 않음
//
// prefers-reduced-motion 이면(도중에 켜져도) 즉시 전체 표시.

import { useEffect, useState } from 'react'

// 15~25ms/자 범위의 빠른 쪽. 인사 버블(약 67자)이 1초 남짓에 끝나 랜딩이 굼떠 보이지 않는다.
// 긴 문장은 아래 총 시간 상한에 맞춰 자동으로 더 빨라진다.
const MS_PER_CHAR = 16
const MAX_TOTAL_MS = 2500

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

// 이 문장을 다 치는 데 걸리는 시간. 순차 등장 큐(ChatStream)가 "앞 버블이 언제 끝나는지"를
// 알아야 하므로 재생 속도 계산을 여기 한 곳에 두고 양쪽이 같은 값을 쓴다(FR-12 AC10 v1.6).
export function typingDurationMs(text: string): number {
  const len = text.length
  if (len === 0) return 0
  return Math.max(1, Math.min(MS_PER_CHAR, MAX_TOTAL_MS / len)) * len
}

export function Typewriter({
  text,
  animate,
  onDone,
}: {
  text: string
  animate: boolean
  // 본문이 다 나온 시점(보조 줄 노출 트리거). 완료는 한 번만 통지된다.
  onDone?: () => void
}) {
  const [shown, setShown] = useState(() => (animate && !prefersReducedMotion() ? 0 : text.length))

  useEffect(() => {
    // animate=false = 더 이상 최신 발화가 아니다(새 메시지 도착·칩 입력) → 즉시 완료.
    if (!animate) {
      setShown(text.length)
      return
    }
    const mq = window.matchMedia(REDUCED_MOTION_QUERY)
    if (mq.matches) {
      setShown(text.length)
      return
    }

    const per = Math.max(1, Math.min(MS_PER_CHAR, MAX_TOTAL_MS / Math.max(1, text.length)))
    const start = performance.now()
    let raf = 0
    const step = () => {
      const i = Math.min(text.length, Math.floor((performance.now() - start) / per))
      setShown(i)
      if (i < text.length) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    // 재생 중에 모션 최소화가 켜지면(설정 변경·e2e emulateMedia) 그 자리에서 완성한다.
    const onChange = () => {
      if (!mq.matches) return
      cancelAnimationFrame(raf)
      setShown(text.length)
    }
    mq.addEventListener('change', onChange)
    return () => {
      cancelAnimationFrame(raf)
      mq.removeEventListener('change', onChange)
    }
  }, [animate, text])

  const done = shown >= text.length
  useEffect(() => {
    if (done) onDone?.()
  }, [done, onDone])

  return (
    <span data-testid="typewriter" data-typing={done ? 'false' : 'true'}>
      {shown > 0 && <span>{text.slice(0, shown)}</span>}
      {!done && (
        <span data-testid="typewriter-pending" className="opacity-0">
          {text.slice(shown)}
        </span>
      )}
    </span>
  )
}
