import { useEffect, useRef, useState } from 'react'
import { IS_MOCK, ApiCallError, assess, getPersonas, getSigungu } from './api/client'
import type { AssessRequest, AssessResponse, DemoPersona, Sigungu } from './types'
import { PersonaBar } from './components/PersonaBar'
import { Wizard } from './components/Wizard'
import { ResultView } from './components/ResultView'
import { Badge, WarnIcon } from './components/ui'

export default function App() {
  const [sigungu, setSigungu] = useState<Sigungu[]>([])
  const [personas, setPersonas] = useState<DemoPersona[]>([])
  const [prefill, setPrefill] = useState<AssessRequest | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const [req, setReq] = useState<AssessRequest | null>(null)
  const [data, setData] = useState<AssessResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSigungu().then(setSigungu).catch(() => setSigungu([]))
    getPersonas().then(setPersonas).catch(() => setPersonas([]))
  }, [])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  async function run(request: AssessRequest, personaId: string | null) {
    setLoading(true)
    setError(null)
    setActiveId(personaId)
    try {
      const res = await assess(request)
      setReq(request)
      setData(res)
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (e) {
      const msg = e instanceof ApiCallError ? `${e.message} (${e.code})` : '결과를 불러오지 못했습니다. 서버 연결을 확인하세요.'
      setError(msg)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  function onPersona(p: DemoPersona) {
    setPrefill(p)
    void run(p, p.id)
  }

  function onWizard(request: AssessRequest) {
    setPrefill(request)
    void run(request, null)
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white">S</span>
            <div>
              <h1 className="text-lg font-black leading-none text-slate-900 dark:text-white">스포내비</h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">스포츠 복지 내비게이터</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {IS_MOCK && <Badge tone="warn" icon={<WarnIcon className="w-3.5 h-3.5" />}>목 모드(데모)</Badge>}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="다크/라이트 전환"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-700"
            >
              {dark ? '라이트' : '다크'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-sm">
          <h2 className="text-xl font-bold leading-snug sm:text-2xl">
            조건만 입력하면, 받을 수 있는 스포츠 복지를 찾아드립니다
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-brand-50/90">
            자격이 되면 신청 방법까지, 안 되면 무료·저가 대체경로까지. 없는 자원은 있는 척하지 않고
            그대로 알려드립니다.
          </p>
        </section>

        {personas.length > 0 && <PersonaBar personas={personas} activeId={activeId} onSelect={onPersona} />}

        <Wizard sigungu={sigungu} prefill={prefill} onSubmit={onWizard} loading={loading} />

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            <WarnIcon className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        <div ref={resultRef}>
          {data && req && (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">결과</h2>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {req.sigungu_nm} · {req.age}세 · {req.sex === 'F' ? '여성' : '남성'}
                  {req.disability.has ? ` · ${req.disability.type}장애` : ''}
                </span>
              </div>
              <ResultView req={req} data={data} />
            </>
          )}
        </div>
      </main>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-400 dark:text-slate-500">
        <p>
          스포내비 MVP · 2026 KSPO 공공데이터 활용 경진대회 출품용. 표시 정보는 데모용 fixtures 기반이며,
          최종 자격·혜택은 각 공식 신청처(svoucher.kspo.or.kr / dvoucher.kspo.or.kr)에서 확인하세요.
        </p>
        <p className="mt-1">지도 &copy; OpenStreetMap 기여자.</p>
      </footer>
    </div>
  )
}
