import type { DemoPersona } from '../types'

// 데모 페르소나 바 — P1~P4 원클릭(SPEC §0-4). GET /api/demo/personas (목 모드에선 mocks).
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
    <section aria-label="데모 페르소나" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-bold text-slate-900 dark:text-white">데모 페르소나</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">클릭 한 번으로 결과를 확인하세요</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {personas.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`persona-${p.id}`}
            onClick={() => onSelect(p)}
            aria-pressed={activeId === p.id}
            className={`rounded-xl border p-3 text-left transition ${
              activeId === p.id
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-700/25'
                : 'border-slate-200 hover:border-brand-400 dark:border-slate-700'
            }`}
          >
            <span className="block text-sm font-bold text-slate-900 dark:text-white">{p.label}</span>
            <span className="mt-1 block text-xs leading-snug text-slate-500 dark:text-slate-400">{p.summary}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
