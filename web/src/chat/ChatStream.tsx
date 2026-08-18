// 채팅 스트림. role="log" + aria-live="polite" 로 새 봇 메시지를 낭독한다(FR-12 AC8).
// 자동 스크롤은 "바닥에 붙어 있을 때만" — 사용자가 위로 스크롤 중이면 강제로 끌어내리지 않는다.

import { useEffect, useMemo, useRef } from 'react'
import type { ChatMessage } from '../types_chat'
import { MessageView, NabiAvatar, type MessageHandlers } from './messages'
import { BOT_NAME, T } from './policy'
import { prefersReducedMotion } from './Typewriter'

const STICK_THRESHOLD_PX = 160

export function ChatStream({
  messages,
  pending,
  handlers,
}: {
  messages: ChatMessage[]
  pending: boolean
  handlers: MessageHandlers
}) {
  // 타이프라이터는 "가장 마지막 나비 발화" 하나만 재생한다(FR-12 AC10).
  //   · 뒤에 새 나비 발화가 붙으면 → 앞의 것은 그 즉시 완성(스캔이 최신 것만 잡는다)
  //   · 뒤에 사용자 발화가 붙으면(= 칩을 눌렀다) → 재생 중이던 것도 즉시 완성(null)
  // 어느 쪽이든 최종 상태는 항상 완전한 문장이다 — 끊긴 채 남는 버블이 없다.
  const typingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.role === 'user') return null
      if (m.kind === 'bot_text') return m.id
    }
    return null
  }, [messages])

  const endRef = useRef<HTMLDivElement>(null)
  // 바닥에 붙어 있는가. 사용자가 위로 스크롤하면 false → 강제 스크롤하지 않는다.
  const stick = useRef(true)
  // 우리가 일으킨 스크롤이 끝날 때까지는 스크롤 이벤트로 stick 을 뒤집지 않는다.
  const autoUntil = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < autoUntil.current) return
      const doc = document.documentElement
      stick.current = window.innerHeight + window.scrollY >= doc.scrollHeight - STICK_THRESHOLD_PX
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 새 메시지가 붙으면 바닥으로. 카드·지도가 뒤늦게 커지므로 몇 번 더 확인해 따라간다.
  useEffect(() => {
    if (!stick.current) return
    const el = endRef.current
    if (!el) return
    autoUntil.current = Date.now() + 1400
    // 부드럽게 따라간다(AC11). 모션 최소화 선호면 즉시 이동 — CSS 로는 못 막는 JS 스크롤이다.
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'end' })
    const timers = [250, 700, 1200].map((ms) =>
      setTimeout(() => {
        const doc = document.documentElement
        const atBottom =
          window.innerHeight + window.scrollY >= doc.scrollHeight - STICK_THRESHOLD_PX
        if (!atBottom) {
          autoUntil.current = Date.now() + 400
          el.scrollIntoView({ behavior: 'instant', block: 'end' })
        }
      }, ms),
    )
    return () => timers.forEach(clearTimeout)
  }, [messages.length, pending])

  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={pending}
      data-testid="chat-stream"
      className="flex min-w-0 flex-col gap-4 py-4"
    >
      {messages.map((m, i) => (
        // msg-in = 등장 모션(fade + 8px 상승, 200ms ease-out · FR-12 AC11).
        // 마운트 시 한 번만 재생되고 reduced-motion 에서는 비활성.
        <div key={m.id} className="msg-in min-w-0">
          <MessageView
            msg={m}
            h={handlers}
            showSender={m.role === 'bot' && (i === 0 || messages[i - 1].role !== 'bot')}
            typing={m.id === typingId}
          />
        </div>
      ))}

      {pending && (
        <div className="msg-in flex items-start gap-2" data-testid="chat-pending">
          <NabiAvatar />
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">{BOT_NAME}</p>
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
              </span>
              {T.assessing}
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} aria-hidden="true" />
    </div>
  )
}
