// 챗 단일 UI 셸(App 대체, ARCHITECTURE §11.4).
//   헤더(로고·데모 배지·다크 토글) + 오프라인 배너
//   본문 = 채팅 스트림 + 하단 고정 컴포저 + 컨텍스트 패널
//   푸터(데이터 기준일·출처·면책) 상시 — PRD §6 사전.

import { useEffect, useMemo, useState } from 'react'
import { DATA_BUILT_FALLBACK, IS_MOCK, getHealth, type HealthResponse } from '../api/client'
import type { ChipQuestionMsg } from '../types_chat'
import { Badge, WarnIcon } from '../components/ui'
import { ChatProvider } from './store'
import { useChatController } from './useChatController'
import { ChatStream } from './ChatStream'
import { Composer } from './Composer'
import { ContextPanel } from './ContextPanel'
import { BOT_NAME } from './policy'
import type { MessageHandlers } from './messages'

function Header({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
        <a href="#top" className="flex min-w-0 items-center gap-2.5" aria-label="스포내비 홈으로">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white shadow-sm ring-1 ring-inset ring-white/25">
            S
          </span>
          <span className="min-w-0 leading-none">
            <span className="block truncate text-base font-black tracking-tight text-slate-900 dark:text-white">
              스포내비
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-600 dark:text-slate-400">
              스포츠 복지 내비게이터
            </span>
          </span>
        </a>
        <div className="flex shrink-0 items-center gap-2">
          {IS_MOCK && (
            <Badge tone="warn" icon={<WarnIcon className="w-3.5 h-3.5" />}>
              데모 데이터
            </Badge>
          )}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {dark ? '라이트' : '다크'}
          </button>
        </div>
      </div>
    </header>
  )
}

function Footer({ health }: { health: HealthResponse | null }) {
  const dataBuilt = health?.data_built ?? DATA_BUILT_FALLBACK
  const version = typeof health?.version === 'string' ? health.version : null
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="mx-auto w-full max-w-7xl space-y-1.5 px-4 py-4 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
        <p>
          <span data-testid="footer-data-built">데이터 기준 {dataBuilt}</span>
          {version && <span data-testid="footer-version"> · v{version}</span>} · 출처: 국민체육진흥공단
          공공데이터(문화체육관광부) + 공단 웹 공개 조회(보조) · 자격 안내는 '예상'이며 최종 확인은 공식
          신청처 · 운동 정보는 의료 조언이 아님
        </p>
        <p>지도 &copy; OpenStreetMap 기여자.</p>
      </div>
    </footer>
  )
}

function ChatShell() {
  const { state, sigungu, onChip, onSend, onRetry, setPanel, setFilterSports, applyFilter, fitness } =
    useChatController()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  // 컴포저가 그릴 현재 질문(스트림의 chip_question 중 활성 1개).
  const activeQuestion = useMemo<ChipQuestionMsg | null>(() => {
    if (!state.activeQuestionId) return null
    const m = state.messages.find((x) => x.id === state.activeQuestionId)
    return m && m.kind === 'chip_question' ? m : null
  }, [state.activeQuestionId, state.messages])

  const handlers: MessageHandlers = {
    onChip,
    onRetry,
    onOpenPanel: (tab) => setPanel(true, tab),
    // 종목 필터 + 목록 탭 전환 + 나비 한 줄 안내(부수효과는 컨트롤러가 소유).
    onApplyFilter: applyFilter,
    fitness,
  }

  return (
    <div id="top" className="flex min-h-dvh flex-col overflow-x-clip">
      {!online && (
        <div
          role="status"
          data-testid="offline-banner"
          className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950"
        >
          <WarnIcon className="h-3.5 w-3.5 shrink-0" />
          오프라인 상태입니다 — 네트워크 연결을 확인해 주세요. 다시 연결되면 자동으로 사라집니다.
        </div>
      )}

      <Header dark={dark} onToggleTheme={toggleTheme} />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 lg:flex-row lg:items-start lg:gap-6">
        {state.lastAssess && (
          <ContextPanel
            req={state.lastAssess.req}
            data={state.lastAssess.data}
            open={state.panel.open}
            tab={state.panel.tab}
            filterSports={state.filterSports}
            onToggle={(open) => setPanel(open)}
            onTab={(tab) => setPanel(state.panel.open, tab)}
            onClearFilter={() => setFilterSports(undefined)}
          />
        )}

        <main className="order-2 flex min-w-0 flex-1 flex-col lg:order-1">
          <h1 className="sr-only">스포내비 — {BOT_NAME}와 함께 스포츠 복지 확인하기</h1>
          <ChatStream messages={state.messages} pending={state.pending} handlers={handlers} />
          <Composer
            question={activeQuestion}
            sigungu={sigungu}
            llmMode={state.llmMode}
            pending={state.pending}
            onChip={onChip}
            onSend={(t) => void onSend(t)}
          />
        </main>
      </div>

      <Footer health={health} />
    </div>
  )
}

export default function ChatApp() {
  return (
    <ChatProvider>
      <ChatShell />
    </ChatProvider>
  )
}
