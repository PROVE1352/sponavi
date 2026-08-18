// 채팅 스트림. role="log" + aria-live="polite" 로 새 봇 메시지를 낭독한다(FR-12 AC8).
// 자동 스크롤은 "바닥에 붙어 있을 때만" — 사용자가 위로 스크롤 중이면 강제로 끌어내리지 않는다.

import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../types_chat'
import { MessageView, NabiAvatar, type MessageHandlers } from './messages'
import { BOT_NAME, T } from './policy'

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
    el.scrollIntoView({ behavior: 'smooth', block: 'end' })
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
        <MessageView
          key={m.id}
          msg={m}
          h={handlers}
          showSender={m.role === 'bot' && (i === 0 || messages[i - 1].role !== 'bot')}
        />
      ))}

      {pending && (
        <div className="flex items-start gap-2" data-testid="chat-pending">
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
