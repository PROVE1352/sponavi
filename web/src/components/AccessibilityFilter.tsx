// FR-10 편의시설 칩 필터(클라이언트 필터링). 장애 있음 결과에서 노출.
// 선택 시 해당 편의시설을 (전부) 보유한 시설만 남긴다. 색+텍스트 이중 표기(색맹 안전).
import { AMENITY_CATALOG } from '../types_accessibility'
import { BTN_TEXT, ROW_RULE } from './ui'

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
      className={`pt-3 ${ROW_RULE}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-ink dark:text-ink-dark">편의시설로 거르기</p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            data-testid="accessibility-filter-clear"
            className={`${BTN_TEXT} shrink-0 whitespace-nowrap`}
          >
            필터 해제
          </button>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5 pb-1">
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
                  'min-h-11 rounded-[3px] border-[1.5px] px-2.5 text-[13px] transition-colors ' +
                  (on
                    ? 'border-ink bg-ink font-bold text-paper dark:border-ink-dark dark:bg-ink-dark dark:text-paper-dark'
                    : dim
                      ? 'border-rule text-mute dark:border-rule-dark dark:text-mute-dark'
                      : 'border-ink text-ink hover:bg-tint dark:border-ink-dark dark:text-ink-dark dark:hover:bg-tint-dark')
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
