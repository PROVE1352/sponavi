// 채팅 스트림. role="log" + aria-live="polite" 로 새 봇 메시지를 낭독한다(FR-12 AC8).
// 자동 스크롤은 "바닥에 붙어 있을 때만" — 사용자가 위로 스크롤 중이면 강제로 끌어내리지 않는다.
//
// ★ v1.6 순차 등장(FR-12 AC10): 연속된 화자 발화는 동시에 마운트되지 않는다.
//     앞 버블 타이핑 완료 → 타이핑 인디케이터(점 3개) → 다음 버블 등장·타이핑
//   부팅(인사 → 첫 질문)도 같은 규칙을 탄다 — 질문이 인사보다 먼저 떠 있지 않는다.
//   사용자 입력(칩·전송)이 들어오면 남은 시퀀스를 그 자리에서 전부 완료한다(대기 강제 금지).
//   prefers-reduced-motion 이면 인디케이터·지연·타이프라이터 전부 생략하고 즉시 표시.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../types_chat'
import { MessageView, NabiAvatar, type MessageHandlers } from './messages'
import { BOT_NAME, T } from './policy'
import { useChat } from './store'
import { prefersReducedMotion, typingDurationMs } from './Typewriter'

const STICK_THRESHOLD_PX = 160
// 결과 덱이 도착했을 때 화면 위쪽에 남겨 둘 여백(sticky 헤더가 덱 머리를 덮지 않도록).
const DECK_TOP_OFFSET_PX = 72
// 결과 덱이 도착한 뒤 "덱 시작점"에 머무는 최소 시간. 후속 안내가 바닥으로 데려가기 전에
// 덱 머리(히어로)를 실제로 보여 주기 위한 것 — 이게 없으면 덱 이동이 끝나기도 전에
// 바닥 이동이 겹쳐 두 스크롤이 다투고, 사용자는 덱을 스쳐 지나가기만 한다(FR-12 AC9 v1.11).
const DECK_HOLD_MS = 1000
// 타이핑 인디케이터 노출 시간(계약 범위 300~600ms 의 짧은 쪽 — 대화가 굼떠지지 않게).
const INDICATOR_MS = 320
// 앞 버블의 마지막 글자가 실제로 화면에 박히는 시점은 타이프라이터의 rAF 프레임 경계다.
// 계산상 종료 시각에 프레임 두어 개를 얹어야 "완료 → 다음" 순서가 눈으로도 어긋나지 않는다.
const TYPING_TAIL_MS = 60
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
// 예약해 둔 바닥 이동을 취소시키는 사용자 개입(자동재생 취소 트리거와 같은 목록).
// 덱을 보는 동안 사용자가 먼저 움직였다면 화면 주도권은 사용자 것이다.
const TAKEOVER_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const

// 타이프라이터가 붙는 메시지 = 화자가 "말하는" 버블(발화·질문).
// 카드·고지 블록·사용자 버블은 여기 해당하지 않는다 — 순서만 지켜 등장한다.
function spokenTextOf(m: ChatMessage): string | null {
  if (m.role !== 'bot') return null
  if (m.kind === 'bot_text') return m.text
  if (m.kind === 'chip_question') return m.text
  return null
}

// 스트림에게 보내는 "화면을 여기로" 요청. 스크롤을 컨트롤러가 직접 하지 않는 이유는
// 두 가지다: ① 등장 큐가 그 메시지를 연 뒤여야 앵커가 존재하고, ② 같은 커밋에서
// 바닥 추종(stick)을 먼저 손봐야 두 스크롤이 다투지 않는다.
//   anchor = 그 메시지 머리를 화면 위쪽에(체력 처방 카드 등) · 바닥 추종은 끈 채로
//   bottom = 문서 맨 아래로 + 바닥 추종 재개(결과 뒤 후속 안내 — 여기서부터 다시 일반 대화)
export interface StreamFocus {
  id: string
  seq: number
  mode: 'anchor' | 'bottom'
  // 사용자가 직접 누른 이동인가("맨 아래로" 버튼). true 면 연출 대기(DECK_HOLD_MS)도,
  // 개입 취소(TAKEOVER_EVENTS)도 걸지 않는다 — 그 클릭 자체가 이미 사용자의 의사다.
  // 목적지가 문서 바닥이라 앵커 메시지가 열려 있을 필요도 없다.
  immediate?: boolean
}

// immediate 요청이 쓰는 앵커 id. 실제 메시지를 가리키지 않는다(바닥이 목적지다).
export const FOCUS_BOTTOM_NOW_ID = '__bottom_now__'

function scrollToBottom(behavior: ScrollBehavior) {
  // 컴포저가 sticky 라 "요소를 뷰포트 바닥에 맞추기"로는 마지막 칩이 컴포저에 가린다.
  // 문서 맨 아래로 내려가면 컴포저가 제자리(본문 끝)로 돌아와 칩이 온전히 보인다.
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior })
}

// 스트림에 붙은 메시지를 하나씩 여는 큐. 스토어는 메시지를 즉시 다 밀어넣고,
// "언제 보일지"는 여기서만 정한다(대화 상태와 연출을 분리 — 판정 로직은 대기하지 않는다).
function useRevealQueue(messages: ChatMessage[]) {
  const [revealed, setRevealed] = useState(0)
  const [indicator, setIndicator] = useState(false)
  const [reduced, setReduced] = useState(prefersReducedMotion)
  const revealedAt = useRef(0)

  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 직전 공개 시각. 앞 버블의 타이핑이 언제 끝나는지 계산하는 기준점이다.
  useEffect(() => {
    revealedAt.current = performance.now()
  }, [revealed])

  useEffect(() => {
    // 대화 초기화(처음부터 다시)로 스트림이 짧아졌다 → 시퀀스를 처음부터 다시 태운다.
    if (revealed > messages.length) {
      setIndicator(false)
      setRevealed(0)
      return
    }
    if (revealed >= messages.length) {
      setIndicator(false)
      return
    }
    if (reduced) {
      setIndicator(false)
      setRevealed(messages.length)
      return
    }

    // 사용자 발화가 큐에 들어왔다 = 사용자가 답을 했다 → 앞선 연출을 기다리게 하지 않는다.
    const userAhead = messages.findIndex((m, i) => i >= revealed && m.role === 'user')
    if (userAhead >= 0) {
      setIndicator(false)
      setRevealed(userAhead + 1)
      return
    }

    const prev = revealed > 0 ? messages[revealed - 1] : null
    const prevSpoken = prev ? spokenTextOf(prev) : null
    const prevEnd = prevSpoken ? typingDurationMs(prevSpoken) + TYPING_TAIL_MS : 0
    const rest = prevSpoken ? revealedAt.current + prevEnd - performance.now() : 0
    const wait = Math.max(0, rest)
    // 인디케이터는 "연속된 화자 발화" 사이에만 — 카드나 사용자 답변 뒤 첫 마디는 바로 나온다.
    const withIndicator = prev?.role === 'bot' && spokenTextOf(messages[revealed]) != null

    if (!withIndicator) {
      const t = setTimeout(() => setRevealed((n) => n + 1), wait)
      return () => clearTimeout(t)
    }
    const t1 = setTimeout(() => setIndicator(true), wait)
    const t2 = setTimeout(() => {
      setIndicator(false)
      setRevealed((n) => n + 1)
    }, wait + INDICATOR_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [messages, reduced, revealed])

  const visible = useMemo(
    () => (revealed >= messages.length ? messages : messages.slice(0, revealed)),
    [messages, revealed],
  )
  return {
    visible,
    indicator,
    revealed: Math.min(revealed, messages.length),
    settled: revealed >= messages.length && !indicator,
  }
}

// 화자가 다음 말을 준비하는 동안의 점 3개. 낭독 대상이 아니다(aria-hidden) —
// 스크린리더에는 완성된 문장만 1회 전달된다(FR-12 AC8·AC10).
function TypingIndicator() {
  return (
    <div
      className="msg-in flex items-start gap-2"
      data-testid="typing-indicator"
      aria-hidden="true"
    >
      <NabiAvatar />
      <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card dark:border-slate-700 dark:bg-slate-900">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

export function ChatStream({
  messages,
  pending,
  panelFocus,
  focus,
  handlers,
}: {
  messages: ChatMessage[]
  pending: boolean
  // "패널을 봐 달라"는 요청 횟수. 셸이 패널로 스크롤하는 동안 스트림은 바닥 추종을 멈춘다 —
  // 안 그러면 같은 프레임에 두 스크롤이 다투다 패널이 다시 화면 밖으로 밀린다.
  panelFocus: number
  // "화면을 이 메시지로" 요청. 같은 id 를 다시 눌러도 seq 가 오르면 다시 데려간다.
  focus?: StreamFocus | null
  handlers: MessageHandlers
}) {
  const { visible, indicator, revealed, settled } = useRevealQueue(messages)

  // 연출 진행도를 스토어로 올린다(W2 자동재생의 진행 신호). 자동재생은 이 값만 보고
  // 다음 단계로 넘어간다 — DOM 을 폴링하지 않는다. 값이 그대로면 리듀서가 상태를 유지한다.
  const { dispatch } = useChat()
  useEffect(() => {
    dispatch({ type: 'setReveal', revealed, settled })
  }, [dispatch, revealed, settled])

  // 타이프라이터는 "방금 열린 마지막 버블" 하나만 재생한다(FR-12 AC10).
  // 큐가 한 번에 하나씩만 열기 때문에 재생 대상은 항상 마지막 메시지다.
  //   · 다음 메시지가 열리면 → 앞의 것은 그 즉시 완성
  //   · 사용자 발화가 붙으면(= 칩을 눌렀다) → 재생 중이던 것도 즉시 완성(null)
  // 어느 쪽이든 최종 상태는 항상 완전한 문장이다 — 끊긴 채 남는 버블이 없다.
  const typingId = useMemo(() => {
    const last = visible[visible.length - 1]
    return last && spokenTextOf(last) ? last.id : null
  }, [visible])

  const boxRef = useRef<HTMLDivElement>(null)
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

  // ★ 결과 덱 도착(FR-12 AC9 v1.7): 바닥 추종을 멈추고 "덱 시작점"으로 딱 한 번 이동한다.
  //   결과는 이제 메시지 하나라, 바닥을 따라가면 사용자는 덱의 아랫동아리만 보게 된다.
  //   이후 후속 칩이 붙어도 강제로 끌어내리지 않는다 — 사용자가 직접 바닥까지 내려오면
  //   스크롤 리스너가 stick 을 다시 켜고 평소의 대화 추종으로 돌아간다.
  //   ※ 이 훅은 아래 바닥 추종 훅보다 먼저 선언돼야 한다(같은 커밋에서 stick 을 먼저 끈다).
  const deckShown = useRef<string | null>(null)
  // 덱 시작점으로 이동한 시각 — 후속 안내의 바닥 이동이 이 이동을 덮치지 않게 하는 기준점.
  const deckScrollAt = useRef(0)
  useEffect(() => {
    const deck = [...visible].reverse().find((m) => m.kind === 'assess_result')
    if (!deck || deckShown.current === deck.id) return
    deckShown.current = deck.id
    stick.current = false
    autoUntil.current = Date.now() + 1400
    deckScrollAt.current = Date.now()
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-result-anchor="${deck.id}"]`)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - DECK_TOP_OFFSET_PX
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [visible])

  // ★ 지목 스크롤(v1.10~v1.11): 요청 1건당 정확히 한 번 움직인다. 등장 큐가 아직 그 메시지를
  //   열지 않았으면 앵커가 없다 → 열리는 커밋에서 다시 돈다(문진 카드는 앞 버블의 타이핑이
  //   끝난 뒤에야 마운트된다).
  //     anchor : 카드 머리를 화면 위쪽에 — 바닥 추종은 끈 채로(덱 규칙 그대로)
  //     bottom : 결과 뒤 후속 안내가 도착했다 = "이제부터 다시 평범한 대화"
  //              → 문서 맨 아래(액션 칩)로 한 번 내려가고 바닥 추종을 **재개**한다.
  //              덱 시작점 이동 직후라면 DECK_HOLD_MS 만큼 기다린다 — 덱을 먼저 보여 준 뒤
  //              내려가야 하고, 진행 중인 덱 스크롤과 겹치면 서로를 끊어먹는다.
  //     bottom + immediate : "맨 아래로" 버튼(FAB). 사용자가 직접 누른 이동이라
  //              덱 대기도, 개입 취소도, 앵커 대기도 없이 이 자리에서 바로 내려간다.
  //   ※ 덱 훅보다 **뒤에**, 바닥 추종 훅보다 **앞에** 선언돼야 한다(같은 커밋 순서).
  const focusDone = useRef(0)
  // 예약된 바닥 이동. 취소는 이 한 곳으로 모은다 — 사용자가 먼저 움직였거나(개입),
  // 다른 이동 요청(카드 지목·패널 열기)이 들어오면 예약은 없던 일이 된다.
  const bottomTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomOff = useRef<(() => void) | null>(null)
  const stopBottom = useCallback(() => {
    if (bottomTimer.current) clearTimeout(bottomTimer.current)
    bottomTimer.current = null
    bottomOff.current?.()
    bottomOff.current = null
  }, [])
  useEffect(() => stopBottom, [stopBottom])
  useEffect(() => {
    if (!focus || focus.seq === focusDone.current) return
    // 사용자가 직접 누른 "맨 아래로"는 앵커를 기다리지 않는다 — 목적지가 문서 바닥이다.
    const now = focus.mode === 'bottom' && focus.immediate === true
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-focus-anchor="${focus.id}"]`)
    if (!el && !now) return
    focusDone.current = focus.seq
    stopBottom()
    if (focus.mode === 'bottom') {
      // 즉시 요청: 예약도 개입 감시도 없이 이 자리에서 내려간다. 예약(setTimeout)을 끼우면
      // 버튼의 pointerdown·keydown 이 곧바로 자기 이동을 취소해 버린다.
      if (now) {
        stick.current = true
        autoUntil.current = Date.now() + 1400
        scrollToBottom(prefersReducedMotion() ? 'auto' : 'smooth')
        return
      }
      const wait = Math.max(0, deckScrollAt.current + DECK_HOLD_MS - Date.now())
      const onTakeover = () => stopBottom()
      for (const type of TAKEOVER_EVENTS) {
        window.addEventListener(type, onTakeover, { capture: true, passive: true })
      }
      bottomOff.current = () => {
        for (const type of TAKEOVER_EVENTS) {
          window.removeEventListener(type, onTakeover, { capture: true })
        }
      }
      bottomTimer.current = setTimeout(() => {
        stopBottom()
        stick.current = true
        autoUntil.current = Date.now() + 1400
        scrollToBottom(prefersReducedMotion() ? 'auto' : 'smooth')
      }, wait)
      return
    }
    if (!el) return // anchor 모드는 앵커가 있어야만 여기 온다(위에서 걸러진다)
    stick.current = false
    autoUntil.current = Date.now() + 1400
    const top = el.getBoundingClientRect().top + window.scrollY - DECK_TOP_OFFSET_PX
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [focus, stopBottom, visible])

  // 패널 열기 요청 → 이번 턴의 바닥 추종은 포기한다(셸이 패널로 데려간다).
  // ※ 아래 바닥 추종 훅보다 먼저 선언돼야 같은 커밋에서 stick 이 먼저 꺼진다.
  const panelFocusSeen = useRef(panelFocus)
  useEffect(() => {
    if (panelFocus === panelFocusSeen.current) return
    panelFocusSeen.current = panelFocus
    stopBottom()
    stick.current = false
    autoUntil.current = Date.now() + 1400
  }, [panelFocus, stopBottom])

  // 새 메시지가 열리면 바닥으로. 부드럽게 따라간다(AC11) —
  // 모션 최소화 선호면 즉시 이동(CSS 로는 못 막는 JS 스크롤이다).
  useEffect(() => {
    if (!stick.current) return
    autoUntil.current = Date.now() + 1400
    scrollToBottom(prefersReducedMotion() ? 'auto' : 'smooth')
  }, [visible.length, indicator, pending])

  // 높이가 뒤늦게 자라는 것들(칩 fade-in · 카드 · 지도 타일)도 따라간다.
  // 스크롤 자체는 높이를 바꾸지 않으므로 되먹임 루프가 생기지 않는다.
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.getBoundingClientRect().height
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height
      const grew = h > last + 1
      last = h
      if (!grew || !stick.current) return
      autoUntil.current = Date.now() + 600
      scrollToBottom(prefersReducedMotion() ? 'auto' : 'smooth')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={boxRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={pending}
      data-testid="chat-stream"
      // 순차 등장이 아직 진행 중인가(e2e 앵커 — 고정 sleep 없이 "연출 끝"을 기다린다).
      data-sequencing={settled ? 'false' : 'true'}
      className="flex min-w-0 flex-col gap-4 py-4"
    >
      {visible.map((m, i) => (
        // msg-in = 등장 모션(fade + 8px 상승, 200ms ease-out · FR-12 AC11).
        // 마운트 시 한 번만 재생되고 reduced-motion 에서는 비활성.
        <div
          key={m.id}
          className="msg-in min-w-0"
          // 결과 덱의 시작점 — 도착 시 여기로 한 번만 스크롤한다.
          data-result-anchor={m.kind === 'assess_result' ? m.id : undefined}
          // 지목 스크롤의 착지점(메시지 래퍼 그대로).
          data-focus-anchor={m.id}
        >
          <MessageView
            msg={m}
            h={handlers}
            showSender={m.role === 'bot' && (i === 0 || visible[i - 1].role !== 'bot')}
            typing={m.id === typingId}
          />
        </div>
      ))}

      {indicator && <TypingIndicator />}

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
    </div>
  )
}
