import { useEffect, useRef, useState } from 'react'
import {
  DATA_BUILT_FALLBACK,
  IS_MOCK,
  assess,
  getHealth,
  getPersonas,
  getSigungu,
  type HealthResponse,
} from './api/client'
import type { AssessRequest, AssessResponse, DemoPersona, Sigungu } from './types'
import { PersonaBar } from './components/PersonaBar'
import { Wizard } from './components/Wizard'
import { ResultView } from './components/ResultView'
import { ResultSkeleton } from './components/Skeleton'
import { ErrorPanel, toAppError, type AppError } from './components/ErrorPanel'
import { Badge, WarnIcon } from './components/ui'

function PinIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 2a6 6 0 0 0-6 6c0 4.2 5.1 9.4 5.6 9.9a.6.6 0 0 0 .8 0C10.9 17.4 16 12.2 16 8a6 6 0 0 0-6-6Zm0 8.2A2.2 2.2 0 1 1 10 5.8a2.2 2.2 0 0 1 0 4.4Z" />
    </svg>
  )
}

export default function App() {
  const [sigungu, setSigungu] = useState<Sigungu[]>([])
  const [personas, setPersonas] = useState<DemoPersona[]>([])
  const [prefill, setPrefill] = useState<AssessRequest | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const [req, setReq] = useState<AssessRequest | null>(null)
  const [data, setData] = useState<AssessResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const lastAttempt = useRef<{ request: AssessRequest; personaId: string | null } | null>(null)

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSigungu().then(setSigungu).catch(() => setSigungu([]))
    getPersonas().then(setPersonas).catch(() => setPersonas([]))
    // 푸터 데이터 기준일/버전(옵셔널 — 서버가 추가 중). 실패해도 폴백으로 렌더.
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  // 오프라인/재접속 감지 → 상단 미니 배너 토글.
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

  async function run(request: AssessRequest, personaId: string | null) {
    lastAttempt.current = { request, personaId } // 입력 보존 재시도용
    setLoading(true)
    setError(null)
    setActiveId(personaId)
    try {
      const res = await assess(request)
      setReq(request)
      setData(res)
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (e) {
      setError(toAppError(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // 마지막 시도를 그대로(입력 보존) 재호출.
  function retryAssess() {
    const a = lastAttempt.current
    if (a) void run(a.request, a.personaId)
  }

  function onPersona(p: DemoPersona) {
    setPrefill(p)
    void run(p, p.id)
  }

  function onWizard(request: AssessRequest) {
    setPrefill(request)
    void run(request, null)
  }

  const dataBuilt = health?.data_built ?? DATA_BUILT_FALLBACK
  const version = typeof health?.version === 'string' ? health.version : null

  return (
    <div id="top" className="flex min-h-dvh flex-col overflow-x-clip">
      {/* 오프라인 미니 배너 — 재접속되면 자동 사라짐 */}
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
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <a href="#top" className="flex items-center gap-2.5" aria-label="스포내비 홈으로">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white shadow-sm ring-1 ring-inset ring-white/25">
              S
            </span>
            <span className="leading-none">
              <span className="block text-base font-black tracking-tight text-slate-900 dark:text-white">스포내비</span>
              <span className="mt-0.5 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                스포츠 복지 내비게이터
              </span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            {IS_MOCK && (
              <Badge tone="warn" icon={<WarnIcon className="w-3.5 h-3.5" />}>
                데모 데이터
              </Badge>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {dark ? '라이트' : '다크'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">
        {/* ── 히어로: 서비스명 + 핵심 서사 + 부제(신뢰 축) ── */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 px-6 py-9 text-white shadow-hero sm:px-9 sm:py-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-accent-400/20 blur-2xl"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-brand-400/20 blur-3xl"
          />
          <div className="relative">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand-50 ring-1 ring-inset ring-white/25">
              <PinIcon className="h-3.5 w-3.5 text-accent-300" />
              공공데이터 기반 스포츠 복지 안내
            </p>
            <h1 className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-black tracking-tight sm:text-4xl">스포내비</span>
              <span className="text-base font-semibold text-brand-100 sm:text-lg">스포츠 복지 사각지대 내비게이터</span>
            </h1>
            <p className="mt-4 max-w-2xl text-lg font-bold leading-snug sm:text-2xl">
              정보가 안 닿고, 닿아도 갈 곳이 없다 — 스포내비는 자격·시설·체력처방을 한 번에 안내합니다.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-100/90 sm:text-base">
              국민체육진흥공단 공공데이터 기반 · 모든 안내에 공식 출처와 확인일
            </p>
          </div>
        </section>

        {personas.length > 0 && <PersonaBar personas={personas} activeId={activeId} onSelect={onPersona} />}

        <Wizard sigungu={sigungu} prefill={prefill} onSubmit={onWizard} loading={loading} />

        <div ref={resultRef}>
          {loading ? (
            <ResultSkeleton />
          ) : error ? (
            <ErrorPanel error={error} onRetry={retryAssess} retrying={loading} />
          ) : data && req ? (
            <>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">결과</h2>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {req.sigungu_nm} · {req.age}세 · {req.sex === 'F' ? '여성' : '남성'}
                  {req.disability.has ? ` · ${req.disability.type}장애` : ''}
                </span>
              </div>
              <ResultView req={req} data={data} />
            </>
          ) : null}
        </div>
      </main>

      {/* ── 전 화면 고정 푸터: 데이터 기준·출처·고지 ── */}
      <footer className="mt-auto border-t border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="mx-auto w-full max-w-5xl space-y-2.5 px-4 py-6 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-600 text-[10px] font-black text-white">
                S
              </span>
              스포내비
            </span>
            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
              GitHub<span className="text-slate-500 dark:text-slate-500">(공개 예정)</span>
            </span>
            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
              문의<span className="text-slate-500 dark:text-slate-500">(준비 중)</span>
            </span>
          </div>
          <p>
            <span data-testid="footer-data-built">데이터 기준 {dataBuilt}</span>
            {version && <span data-testid="footer-version"> · v{version}</span>} · 출처: 국민체육진흥공단
            공공데이터(문화체육관광부) + 공단 웹 공개 조회(보조) · 본 서비스의 자격 안내는 '예상'이며 최종 확인은
            공식 신청처 · 운동 정보는 의료 조언이 아님
          </p>
          <p className="text-slate-600 dark:text-slate-400">지도 &copy; OpenStreetMap 기여자.</p>
        </div>
      </footer>
    </div>
  )
}
