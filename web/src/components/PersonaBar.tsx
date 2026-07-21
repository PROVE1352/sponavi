import type { DemoPersona } from '../types'

// 데모 페르소나 바 — P1~P5 원클릭(SPEC §0-4). GET /api/demo/personas (목 모드에선 mocks).
// "한 번에 체험" 섹션: 사람이 읽는 라벨 + 인구학 캡션 + 기대 결과 요약.
export function PersonaBar({
  personas,
  activeId,
  onSelect,
}: {
  personas: DemoPersona[]
  activeId?: string | null
  onSelect: (p: DemoPersona) => void
}) {
  return (
    <section
      aria-label="한 번에 체험 데모 페르소나"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">한 번에 체험</h2>
        <span className="text-sm text-slate-600 dark:text-slate-400">
          페르소나를 누르면 자격·시설·체력처방 결과가 3초 만에 열립니다
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {personas.map((p) => {
          const active = activeId === p.id
          const demo = `${p.age}세 · ${p.sex === 'F' ? '여성' : '남성'} · ${p.sigungu_nm}`
          return (
            <li key={p.id}>
              <button
                type="button"
                data-testid={`persona-${p.id}`}
                onClick={() => onSelect(p)}
                aria-pressed={active}
                className={`flex min-h-11 w-full flex-col rounded-xl border p-3 text-left transition ${
                  active
                    ? 'border-brand-600 bg-brand-50 ring-1 ring-inset ring-brand-600 dark:border-brand-500 dark:bg-brand-700/25'
                    : 'border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-500/60'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-black ${
                      active
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {p.id}
                  </span>
                  <span className="text-sm font-bold leading-tight text-slate-900 dark:text-white">{p.label}</span>
                </span>
                <span className="mt-1.5 block text-[11px] font-medium text-slate-600 dark:text-slate-400">{demo}</span>
                <span className="mt-1 line-clamp-2 block text-xs leading-snug text-slate-600 dark:text-slate-400">
                  {p.summary}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
