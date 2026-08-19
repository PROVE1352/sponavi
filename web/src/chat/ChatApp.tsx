// 챗 단일 UI 셸(App 대체, ARCHITECTURE §11.4).
//   헤더(로고·데모 배지·다크 토글) + 오프라인 배너
//   본문 = 채팅 스트림 + 하단 고정 컴포저 + 컨텍스트 패널
//   푸터(데이터 기준일·출처·면책)는 **데모 페이지 전용**(v1.4) — 실사용 랜딩은 대화만 남긴다.
//   OSM 저작자 표시는 지도 안의 Leaflet attribution 컨트롤이 소유한다(제거 금지).

import { useEffect, useState } from 'react'
import { DATA_BUILT_FALLBACK, IS_MOCK, getHealth, type HealthResponse } from '../api/client'
import { Badge, WarnIcon } from '../components/ui'
import { ChatProvider } from './store'
import { useChatController } from './useChatController'
import { ChatStream } from './ChatStream'
import { Composer } from './Composer'
import { ContextPanel } from './ContextPanel'
import { useIsDemo } from './route'
import { BOT_NAME } from './policy'
import type { MessageHandlers } from './messages'

function Header({
  demo,
  dark,
  onToggleTheme,
}: {
  demo: boolean
  dark: boolean
  onToggleTheme: () => void
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
        <a href="#top" className="flex min-w-0 items-center gap-2.5" aria-label="스포내비 맨 위로">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white">
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
          {/* 목모드 "데모 데이터" 배지는 데모 페이지 소관(FR-12 AC5 v1.4) */}
          {IS_MOCK && demo && (
            <span data-testid="demo-badge">
              <Badge tone="warn" icon={<WarnIcon className="w-3.5 h-3.5" />}>
                데모 데이터
              </Badge>
            </span>
          )}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
            className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-slate-300 px-4 text-sm font-semibold text-slate-700 transition-colors duration-200 ease-out hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
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
    <footer
      data-testid="page-footer"
      className="mt-auto border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60"
    >
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

function ChatShell({ demo }: { demo: boolean }) {
  const { state, sigungu, onChip, onSend, onRetry, setPanel, setFilterSports, applyFilter, fitness } =
    useChatController(demo)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  // 푸터(데이터 기준일·버전)는 데모 페이지에만 있으므로 health 조회도 거기서만 한다.
  useEffect(() => {
    if (!demo) return
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [demo])

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

  const handlers: MessageHandlers = {
    onChip,
    onRetry,
    onOpenPanel: (tab) => setPanel(true, tab),
    // 종목 필터 + 목록 탭 전환 + 나비 한 줄 안내(부수효과는 컨트롤러가 소유).
    onApplyFilter: applyFilter,
    // 칩·지역 검색은 질문 버블 아래 인라인으로 렌더된다(FR-12 AC1 v1.6) —
    // 그래서 시군구 목록과 "열려 있는 질문"이 메시지 렌더러로 내려간다.
    sigungu,
    activeQuestionId: state.activeQuestionId,
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

      <Header demo={demo} dark={dark} onToggleTheme={toggleTheme} />

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
            llmMode={state.llmMode}
            pending={state.pending}
            onSend={(t) => void onSend(t)}
          />
        </main>
      </div>

      {demo && <Footer health={health} />}
    </div>
  )
}

export default function ChatApp() {
  const demo = useIsDemo()
  // 해시 라우트 전환은 "다른 페이지로 이동"이다 — key 로 대화를 통째로 새로 시작한다.
  // (메인↔데모 사이에서 인사 시퀀스가 다르므로 부팅을 다시 태워야 하고,
  //  지난 페이지의 대화·판정이 넘어오지 않는 편이 P-3 비저장 원칙에도 맞다.)
  return (
    <ChatProvider key={demo ? 'demo' : 'main'}>
      <ChatShell demo={demo} />
    </ChatProvider>
  )
}
