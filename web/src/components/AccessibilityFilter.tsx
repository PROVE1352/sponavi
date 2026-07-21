// FR-10 편의시설 칩 필터(클라이언트 필터링). 장애 있음 결과에서 노출.
// 선택 시 해당 편의시설을 (전부) 보유한 시설만 남긴다. 색+텍스트 이중 표기(색맹 안전).
import { AMENITY_CATALOG } from '../types_accessibility'

export function AccessibilityFilter({
  selected,
  onToggle,
  onClear,
  available,
}: {
  selected: string[]
  onToggle: (code: string) => void
  onClear: () => void
  // 현재 결과에 실제 존재하는 편의시설 코드(있으면 없는 칩은 흐리게 — 추정 아님, 안내).
  available?: Set<string>
}) {
  const selSet = new Set(selected)
  return (
    <div
      data-testid="accessibility-filter"
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/10"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-violet-800 dark:text-violet-200">
          편의시설로 거르기
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            data-testid="accessibility-filter-clear"
            className="rounded-md px-2 py-1 text-xs font-medium text-violet-700 underline underline-offset-2 hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100"
          >
            필터 해제
          </button>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {AMENITY_CATALOG.map((a) => {
          const on = selSet.has(a.code)
          const dim = available ? !available.has(a.code) : false
          return (
            <li key={a.code}>
              <button
                type="button"
                aria-pressed={on}
                data-testid={`amenity-chip-${a.code}`}
                onClick={() => onToggle(a.code)}
                className={
                  'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ' +
                  (on
                    ? 'bg-violet-600 text-white ring-violet-600'
                    : dim
                      ? 'bg-white/50 text-slate-500 ring-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:ring-slate-700'
                      : 'bg-white text-violet-800 ring-violet-200 hover:bg-violet-100 dark:bg-slate-800 dark:text-violet-200 dark:ring-violet-500/40')
                }
              >
                {on ? '✓ ' : ''}
                {a.name}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
