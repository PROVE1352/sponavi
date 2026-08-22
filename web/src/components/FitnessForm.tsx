// 측정 폼 턴 (FR-07) — 연령군 동적 카탈로그를 그리는 순수 뷰.
// 값 상태는 이 카드의 로컬 상태이고, 조회·제출·에러 상태는 useFitness() 훅이 소유한다.
//   AC1 대체항목(alt_group) 택1은 한 슬롯(셀렉트+입력) · AC2 전 항목 선택 입력(최소 1개)
//   AC3 단위·측정법 힌트 · AC4 인증센터 안내 · AC6 만 7~10 공백 고지 배너

import { useMemo, useState } from 'react'
import type { FitnessItem } from '../types'
import type { FitnessFormRow, FitnessLaneApi } from '../types_chat'
import { Skeleton } from './Skeleton'
import { WarnIcon } from './ui'

function parse(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 파생 항목(FR-07 AC8)의 입력 묶음이 전부 유효할 때만 {code: value}, 아니면 null.
// 서버가 같은 범위 규칙으로 다시 계산한다 — 여기 값은 전송·표시용이지 판정이 아니다(P-2).
function derivedInputs(item: FitnessItem, values: Record<string, string>): Record<string, number> | null {
  const inputs = item.derived_from ?? []
  if (inputs.length === 0) return null
  const out: Record<string, number> = {}
  for (const d of inputs) {
    const v = parse(values[d.code] ?? '')
    if (v == null) return null
    if (d.min != null && v < d.min) return null
    if (d.max != null && v > d.max) return null
    out[d.code] = v
  }
  return out
}

// 화면 미리보기용 계산(서버 fitness.derive_measures 와 같은 공식). BMI 만 지원.
export function previewDerived(code: string, inputs: Record<string, number>): number | null {
  if (code === 'bmi') {
    const h = inputs.height_cm
    const w = inputs.weight_kg
    if (!h || !w) return null
    return Math.round((w / Math.pow(h / 100, 2)) * 10) / 10
  }
  return null
}

// 결과 카드와 함께 잔존해야 하는 하단 고정 고지(FR-07 AC4 · FR-08 AC5).
export const FITNESS_DISCLAIMER =
  '운동 참고 정보이며 의료 조언이 아닙니다. 공식 체력 인증은 전국 체력인증센터(무료)에서 받을 수 있습니다.'

export function FitnessFormCard({
  lane,
  // 지난 회차(다른 상황)의 폼 턴이면 조작을 잠근다 — 기록으로만 남는다.
  locked = false,
  onSubmit,
}: {
  lane: FitnessLaneApi
  locked?: boolean
  onSubmit: (measures: Record<string, number>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [altChoice, setAltChoice] = useState<Record<string, string>>({})

  // 입력된 값만 모은다 — 빈 칸은 전송하지 않는다(전 항목 선택 입력).
  const measures = useMemo(() => {
    const m: Record<string, number> = {}
    for (const [, rows] of lane.grouped) {
      for (const row of rows) {
        // 파생 항목(BMI): 값 대신 입력 묶음(키·몸무게)을 보낸다 — 전부 유효할 때만.
        if (row.kind === 'single' && row.item.derived_from?.length) {
          const d = derivedInputs(row.item, values)
          if (d) Object.assign(m, d)
          continue
        }
        const code =
          row.kind === 'single' ? row.item.code : (altChoice[row.altGroup] ?? row.options[0].code)
        const v = parse(values[code] ?? '')
        if (v != null) m[code] = v
      }
    }
    return m
  }, [lane.grouped, values, altChoice])

  const canSubmit = Object.keys(measures).length > 0

  return (
    <section
      data-testid="fitness-form-card"
      aria-label="체력 측정값 입력"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
    >
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">측정값 입력</h3>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
          아는 항목만 넣으셔도 됩니다. 1개 이상 입력하면 판정할 수 있습니다.
        </p>
      </div>

      {/* 만 7~10 공백 고지(FR-07 AC6). 지난 회차 카드는 현재 레인 상태를 비추지 않는다. */}
      {!locked && lane.gapMessage && (
        <div
          data-testid="fitness-gap-banner"
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200"
        >
          <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{lane.gapMessage}</span>
        </div>
      )}

      {locked ? (
        <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
          지난 단계의 입력 화면입니다. 새로 고른 상황은 아래 최신 단계에서 이어서 진행됩니다.
        </p>
      ) : lane.itemsLoading ? (
        <FitnessFormSkeleton />
      ) : lane.itemsError ? (
        <ItemsRetryPanel onRetry={lane.reloadItems} />
      ) : lane.emptyMessage ? (
        <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
          {lane.emptyMessage}
        </p>
      ) : (
        <>
          <DynamicForm
            grouped={lane.grouped}
            values={values}
            altChoice={altChoice}
            onValue={(code, v) => setValues((s) => ({ ...s, [code]: v }))}
            onAlt={(altGroup, code) => setAltChoice((s) => ({ ...s, [altGroup]: code }))}
          />
          <button
            type="button"
            data-testid="fitness-submit"
            onClick={() => onSubmit(measures)}
            disabled={lane.submitting || !canSubmit}
            className="min-h-11 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {lane.submitting ? '분석 중…' : canSubmit ? '체력 판정 받기' : '측정값을 1개 이상 입력하세요'}
          </button>
          {lane.submitError && (
            <div
              role="alert"
              data-testid="fitness-submit-error"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
            >
              <span className="inline-flex items-center gap-2">
                <WarnIcon className="h-4 w-4 shrink-0" />
                {lane.submitError.kind === 'ratelimit'
                  ? lane.submitError.message
                  : '체력 판정을 불러오지 못했습니다.'}
              </span>
              <button
                type="button"
                data-testid="fitness-submit-retry"
                onClick={() => onSubmit(measures)}
                className="rounded-md px-2 py-1 text-xs font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900 dark:text-rose-200"
              >
                다시 시도
              </button>
            </div>
          )}
        </>
      )}

      <p className="border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        {FITNESS_DISCLAIMER}
      </p>
    </section>
  )
}

// 측정항목 로딩 자리표시(동적 폼 모양).
function FitnessFormSkeleton() {
  return (
    <div data-testid="fitness-form-skeleton" role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">측정항목을 불러오는 중입니다…</span>
      <Skeleton className="h-4 w-24" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  )
}

// 측정항목 조회 실패 → 빈 폼 대신 재시도 패널(입력 흐름 보호).
function ItemsRetryPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-testid="fitness-items-error"
      className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-500/40 dark:bg-rose-500/10"
    >
      <p className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-100">
        <WarnIcon className="h-4 w-4 shrink-0" />
        측정항목을 불러오지 못했습니다
      </p>
      <p className="mt-1 text-rose-800 dark:text-rose-200/90">
        잠시 후 다시 시도해 주세요. 결과와 다른 정보는 그대로 유지됩니다.
      </p>
      <button
        type="button"
        data-testid="fitness-items-retry"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700"
      >
        다시 시도
      </button>
    </div>
  )
}

function DynamicForm({
  grouped,
  values,
  altChoice,
  onValue,
  onAlt,
}: {
  grouped: [string, FitnessFormRow[]][]
  values: Record<string, string>
  altChoice: Record<string, string>
  onValue: (code: string, v: string) => void
  onAlt: (altGroup: string, code: string) => void
}) {
  // ★ text-base(16px) 고정: 모바일 사파리는 16px 미만 입력에 포커스하면 페이지를 확대해 버린다
  //   — 확대되면 폼이 화면 밖으로 밀려 사용자가 손으로 되돌려야 한다(v1.7 실기기 피드백).
  //   min-h-11(44px) 터치 타겟과 함께 폼 전 항목에 같은 클래스를 쓴다.
  const fieldCls =
    'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 transition-colors duration-200 hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-slate-600'
  const labelCls = 'text-sm font-medium break-keep text-slate-700 dark:text-slate-200'
  const hintCls = 'mt-1 block text-xs leading-snug break-keep text-slate-600 dark:text-slate-400'

  return (
    <div data-testid="fitness-form" className="space-y-5">
      {grouped.map(([factor, frows]) => (
        <div key={factor}>
          <h4 className="mb-2 text-xs font-bold tracking-wide text-slate-600 dark:text-slate-400">
            {factor}
          </h4>
          {/* 390px 에서는 1열(입력 한 칸이 화면 폭을 온전히 쓴다) — 좁은 2열은 숫자가 잘린다 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {frows.map((row) => {
              if (row.kind === 'single' && row.item.derived_from?.length) {
                const it = row.item
                const d = derivedInputs(it, values)
                const preview = d ? previewDerived(it.code, d) : null
                return (
                  <fieldset key={it.code} className="min-w-0" data-testid={`fit-derived-field-${it.code}`}>
                    <legend className={labelCls}>
                      {it.name}
                      <span className="ml-1 font-normal text-slate-600 dark:text-slate-400">
                        (자동 계산{it.unit ? ` · ${it.unit}` : ''})
                      </span>
                    </legend>
                    {/* 입력 2칸(키·몸무게)을 한 줄에 — 390px 에서도 숫자 3~4자리는 충분히 들어간다 */}
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {it.derived_from!.map((inp) => (
                        <label key={inp.code} className="block min-w-0">
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {inp.name} ({inp.unit})
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            autoComplete="off"
                            min={inp.min}
                            max={inp.max}
                            data-testid={`fit-input-${inp.code}`}
                            value={values[inp.code] ?? ''}
                            onChange={(e) => onValue(inp.code, e.target.value)}
                            className={fieldCls}
                          />
                        </label>
                      ))}
                    </div>
                    <span
                      data-testid={`fit-derived-${it.code}`}
                      aria-live="polite"
                      className={hintCls}
                    >
                      {preview != null
                        ? `${it.name} ${preview} — ${it.formula ?? '자동 계산'} (자동 계산, 판정은 서버가 같은 공식으로)`
                        : `${it.derived_from!.map((x) => x.name).join('·')}를 모두 넣으면 ${it.name}가 계산됩니다`}
                    </span>
                    {it.hint && <span className={hintCls}>{it.hint}</span>}
                  </fieldset>
                )
              }
              if (row.kind === 'single') {
                const it = row.item
                return (
                  <label key={it.code} className="block min-w-0">
                    <span className={labelCls}>
                      {it.name}
                      {it.unit && (
                        <span className="ml-1 font-normal text-slate-600 dark:text-slate-400">
                          ({it.unit})
                        </span>
                      )}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoComplete="off"
                      data-testid={`fit-input-${it.code}`}
                      value={values[it.code] ?? ''}
                      onChange={(e) => onValue(it.code, e.target.value)}
                      className={fieldCls}
                    />
                    {it.hint && <span className={hintCls}>{it.hint}</span>}
                  </label>
                )
              }
              const code = altChoice[row.altGroup] ?? row.options[0].code
              const active = row.options.find((o) => o.code === code) ?? row.options[0]
              const selectId = `fit-alt-${row.altGroup}-select`
              const valueId = `fit-alt-${row.altGroup}-value`
              return (
                <div key={row.altGroup} className="min-w-0">
                  {/* 택1 슬롯: 종목 셀렉트 + 값 입력이 각각 한 줄을 온전히 쓴다(390px 에서 서로 밀리지 않게) */}
                  <label htmlFor={selectId} className={labelCls}>
                    {row.factor} (택1)
                  </label>
                  <select
                    id={selectId}
                    data-testid={`fit-alt-${row.altGroup}`}
                    aria-label={`${row.factor} 측정 종목 선택`}
                    value={code}
                    onChange={(e) => onAlt(row.altGroup, e.target.value)}
                    className={fieldCls}
                  >
                    {row.options.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.name}
                        {o.unit ? ` (${o.unit})` : ''}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={valueId} className={`${labelCls} mt-2 block`}>
                    {active.name}
                    {active.unit && (
                      <span className="ml-1 font-normal text-slate-600 dark:text-slate-400">
                        ({active.unit})
                      </span>
                    )}
                  </label>
                  <input
                    id={valueId}
                    type="number"
                    inputMode="decimal"
                    autoComplete="off"
                    data-testid={`fit-input-${active.code}`}
                    value={values[active.code] ?? ''}
                    onChange={(e) => onValue(active.code, e.target.value)}
                    className={fieldCls}
                  />
                  {active.hint && <span className={hintCls}>{active.hint}</span>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
