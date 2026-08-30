// 챗 단일 UI 셸(App 대체, ARCHITECTURE §11.4).
//   헤더(로고·데모 배지·다크 토글) + 오프라인 배너
//   본문 = 채팅 스트림 + 하단 고정 컴포저 + 컨텍스트 패널
//   푸터(데이터 기준일·출처·면책)는 **데모 페이지 전용**(v1.4) — 실사용 랜딩은 대화만 남긴다.
//   OSM 저작자 표시는 지도 안의 MapLibre AttributionControl 이 소유한다(제거 금지).

import { useEffect, useRef, useState } from 'react'
import { DATA_BUILT_FALLBACK, IS_MOCK, getHealth, type HealthResponse } from '../api/client'
import { Badge, WarnIcon } from '../components/ui'
import { ChatProvider } from './store'
import { useChatController } from './useChatController'
import { ChatStream } from './ChatStream'
import { Composer } from './Composer'
import { ContextPanel } from './ContextPanel'
import { ScrollToBottomFab } from './ScrollToBottomFab'
import { useIsDemo } from './route'
import { AUTOPLAY_STATUS_TEXT } from './autoplay'
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
    // 제호 아래 2px 잉크 괘선 — 화면에서 가장 굵은 선이 여기 하나다(B·종이 메모).
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper dark:border-ink-dark dark:bg-paper-dark">
      <div className="mx-auto flex max-w-7xl items-baseline justify-between gap-3 px-5 pt-4 pb-2.5">
        <a href="#top" className="flex min-w-0 items-baseline gap-2.5" aria-label="되나요 맨 위로">
          <span className="font-serif shrink-0 text-[22px] leading-none font-extrabold tracking-[-0.02em] text-ink dark:text-ink-dark">
            되나요
          </span>
          <span className="min-w-0 truncate text-[12px] text-mute dark:text-mute-dark">
            스포츠 복지, 되는지 바로 확인
          </span>
        </a>
        <div className="flex shrink-0 items-baseline gap-3">
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
            className="press inline-flex min-h-11 items-center bg-transparent text-[13px] text-mute underline decoration-1 underline-offset-4 hover:text-ink dark:text-mute-dark dark:hover:text-ink-dark"
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
      className="mt-auto border-t border-rule bg-paper dark:border-rule-dark dark:bg-paper-dark"
    >
      <div className="mx-auto w-full max-w-7xl space-y-1.5 px-5 py-4 text-[11px] leading-relaxed text-mute dark:text-mute-dark">
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
  const {
    state,
    onChip,
    onSend,
    onRetry,
    openPanel,
    setPanel,
    setFilterSports,
    applyFilter,
    fitness,
    fitnessPrefill,
    autoplayRunning,
    parqPreset,
    streamFocus,
    scrollToBottom,
  } = useChatController(demo)
  const panelRef = useRef<HTMLDivElement>(null)
  // "맨 아래로" 버튼이 컴포저 바로 위에 앉도록 실측용 앵커를 넘긴다.
  const composerRef = useRef<HTMLDivElement>(null)
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

  // "지도에서 보기"·"시설 목록 보기"를 눌렀을 때(panelFocus 증가) 패널까지 데려간다.
  // 모바일에서 패널은 스트림 위쪽이라, 결과까지 내려온 사용자에게는 상태만 바꿔서는
  // 아무 일도 일어나지 않은 것처럼 보인다(v1.7 실기기 피드백).
  useEffect(() => {
    if (state.panelFocus === 0) return
    const el = panelRef.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // 레이아웃(탭 전환·시트 펼침)이 반영된 다음 프레임에 위치를 잰다.
    const raf = requestAnimationFrame(() => {
      const top = el.getBoundingClientRect().top + window.scrollY - 60
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [state.panelFocus, state.panel.tab])

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
    // ★ 칩과 동일 경로(openPanel): 상태만 바꾸면 모바일에서 "눌러도 아무 일 없는" 버튼이 된다.
    onOpenPanel: openPanel,
    // 종목 필터 + 목록 탭 전환 + 화자 한 줄 안내(부수효과는 컨트롤러가 소유).
    onApplyFilter: applyFilter,
    // 칩은 질문 버블 아래 인라인으로 렌더된다(FR-12 AC1 v1.6) —
    // 그래서 "열려 있는 질문"이 메시지 렌더러로 내려간다.
    activeQuestionId: state.activeQuestionId,
    fitness,
    // 3A: 데모 페르소나를 골랐다면 체력 폼이 그 값으로 미리 채워진다(심사 1클릭 경로).
    fitnessPrefill,
    // W2: 자동재생이 문진을 프리셋으로 통과시켰다는 표기(PAR-Q 카드 안).
    parqPreset,
  }

  return (
    <div
      id="top"
      className="flex min-h-dvh flex-col overflow-x-clip bg-paper text-ink dark:bg-paper-dark dark:text-ink-dark"
    >
      {!online && (
        // 알약·그림자 없이 괘선 한 줄 + tint 바탕. 색맹 안전: 아이콘 + 문장 병기.
        <div
          role="status"
          data-testid="offline-banner"
          className="flex items-center justify-center gap-2 border-b border-rule bg-tint px-5 py-2 text-center text-xs text-ink dark:border-rule-dark dark:bg-tint-dark dark:text-ink-dark"
        >
          <WarnIcon className="h-3.5 w-3.5 shrink-0 text-accent-ink dark:text-accent-ink-dark" />
          오프라인 상태입니다 — 네트워크 연결을 확인해 주세요. 다시 연결되면 자동으로 사라집니다.
        </div>
      )}

      <Header demo={demo} dark={dark} onToggleTheme={toggleTheme} />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-5 lg:flex-row lg:items-start lg:gap-6">
        {state.lastAssess && (
          <ContextPanel
            anchorRef={panelRef}
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
          <h1 className="sr-only">되나요 — 스포츠 복지 자격·시설·체력, 되는지 바로 확인하기</h1>
          <ChatStream
            messages={state.messages}
            pending={state.pending}
            panelFocus={state.panelFocus}
            // "체력 처방 시작"처럼 사용자가 스스로 연 카드로 데려가는 요청(v1.10).
            focus={streamFocus}
            handlers={handlers}
          />
          <Composer
            boxRef={composerRef}
            llmMode={state.llmMode}
            pending={state.pending}
            onSend={(t) => void onSend(t)}
          />
        </main>
      </div>

      {/* "맨 아래로" — 바닥에서 멀어졌을 때만 나타난다(카드 CTA 로 위쪽에 올라간 뒤의 복귀 1탭).
          자동재생 중에는 화면 소유권이 자동재생에 있으므로 아예 렌더하지 않는다. */}
      {!autoplayRunning && (
        <ScrollToBottomFab composerRef={composerRef} onPress={scrollToBottom} />
      )}

      {/* W2 자동재생 상태 필. 끝나거나 사용자가 개입하면 사라진다.
          클릭을 가로채지 않는다(pointer-events-none) — 화면 어디를 눌러도 취소가 먼저 걸린다. */}
      {autoplayRunning && (
        <div
          data-testid="autoplay-status"
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-5"
        >
          <span className="rounded-[3px] border border-rule bg-tint px-3.5 py-1.5 text-xs text-ink dark:border-rule-dark dark:bg-tint-dark dark:text-ink-dark">
            {AUTOPLAY_STATUS_TEXT}
          </span>
        </div>
      )}

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
