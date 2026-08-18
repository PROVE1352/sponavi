import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitness, fitnessAi, getFitnessItems } from '../api/client'
import type {
  FitnessAiResponse,
  FitnessItem,
  FitnessItemsResponse,
  FitnessRecommendation,
  FitnessResponse,
  GraphNamed,
  GraphVideo,
  Nearby,
  Provenance,
  Sex,
} from '../types'
import { Badge, CheckIcon, InfoIcon, WarnIcon } from './ui'
import { Skeleton } from './Skeleton'
import { toAppError, type AppError } from './ErrorPanel'

type BadgeTone = 'neutral' | 'brand' | 'ok' | 'fail' | 'warn' | 'purple'

// 엣지 출처 → UI 배지(FITNESS_GRAPH §2.3). 근거 없는 추천은 서버가 내보내지 않는다.
function sourceBadge(prov?: Provenance): { label: string; tone: BadgeTone } | null {
  if (!prov) return null
  switch (prov.source) {
    case 'kspo_standard':
      return { label: '공단 공식 기준', tone: 'ok' }
    case 'guideline':
      return { label: '정부 지침', tone: 'brand' }
    case 'kspo_video':
      return { label: '공단 콘텐츠', tone: 'neutral' }
    case 'curated':
      return {
        label: prov.curated_status === 'pending' ? '전문가 큐레이션(검증 중)' : '전문가 큐레이션',
        tone: 'purple',
      }
    default:
      return { label: '참고', tone: 'neutral' }
  }
}

function named(x: GraphNamed | string): { name: string; prov?: Provenance } {
  return typeof x === 'string' ? { name: x } : { name: x.name, prov: x.provenance }
}

function bandTone(band: string): BadgeTone {
  if (band.includes('미달')) return 'fail'
  if (band.includes('1등급')) return 'ok'
  if (band.includes('신체조성') || band.includes('참고')) return 'neutral'
  return 'brand'
}

function parse(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 동적 폼 행: 단일 항목 / alt_group 택1(셀렉트+입력 한 슬롯).
type FormRow =
  | { kind: 'single'; item: FitnessItem }
  | { kind: 'alt'; altGroup: string; factor: string; options: FitnessItem[] }

function buildRows(items: FitnessItem[]): FormRow[] {
  const altMap = new Map<string, FitnessItem[]>()
  for (const it of items) {
    if (it.alt_group) {
      const arr = altMap.get(it.alt_group) ?? []
      arr.push(it)
      altMap.set(it.alt_group, arr)
    }
  }
  const rows: FormRow[] = []
  const consumed = new Set<string>()
  for (const it of items) {
    if (it.alt_group) {
      const group = altMap.get(it.alt_group)!
      if (group.length >= 2) {
        if (!consumed.has(it.alt_group)) {
          consumed.add(it.alt_group)
          rows.push({ kind: 'alt', altGroup: it.alt_group, factor: it.factor, options: group })
        }
        continue
      }
    }
    rows.push({ kind: 'single', item: it })
  }
  return rows
}

export function FitnessStep({
  age,
  sex,
  nearby,
  onApplyFilter,
  openSignal = 0,
}: {
  age: number
  sex: Sex
  nearby: Nearby
  onApplyFilter: (sports: string[]) => void
  // 챗에서 intent=start_fitness 로 블록을 펼칠 때 증가한다(0이면 아무 일도 하지 않음).
  openSignal?: number
}) {
  const [open, setOpen] = useState(false)
  // PAR-Q 스크리닝 응답: 로컬 상태로만 두고 어디에도 저장·전송하지 않는다(ARCHITECTURE §8).
  const [parqOk, setParqOk] = useState(false)

  // 외부(챗 정책)에서 블록 전개를 요청한 경우. 닫는 조작은 사용자만 한다.
  useEffect(() => {
    if (openSignal > 0) setOpen(true)
  }, [openSignal])

  const [items, setItems] = useState<FitnessItemsResponse | null>(null)
  const [itemsError, setItemsError] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [altChoice, setAltChoice] = useState<Record<string, string>>({})
  const itemsToken = useRef(0)

  const [result, setResult] = useState<FitnessResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<AppError | null>(null)

  const [ai, setAi] = useState<FitnessAiResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<AppError | null>(null)
  const aiAbort = useRef<AbortController | null>(null)
  const aiCanceled = useRef(false)

  // 측정항목 카탈로그 조회. 실패 시 폼 대신 재시도 패널을 띄운다(itemsError).
  const loadItems = useCallback((a: number) => {
    const token = ++itemsToken.current
    setItemsLoading(true)
    setItemsError(false)
    getFitnessItems(a)
      .then((r) => {
        if (token !== itemsToken.current) return
        setItems(r)
        const initial: Record<string, string> = {}
        for (const row of buildRows(r.items)) {
          if (row.kind === 'alt') initial[row.altGroup] = row.options[0].code
        }
        setAltChoice(initial)
        setItemsError(false)
      })
      .catch(() => {
        if (token !== itemsToken.current) return
        setItems(null)
        setItemsError(true)
      })
      .finally(() => {
        if (token === itemsToken.current) setItemsLoading(false)
      })
  }, [])

  // 위저드 나이 변경(다른 페르소나) → 폼·결과 리셋 후 카탈로그 재조회.
  useEffect(() => {
    setResult(null)
    setAi(null)
    setAiError(null)
    setSubmitError(null)
    setValues({})
    setAltChoice({})
    loadItems(age)
  }, [age, loadItems])

  const rows = useMemo(() => (items ? buildRows(items.items) : []), [items])

  const measures = useMemo(() => {
    const m: Record<string, number | null> = {}
    for (const row of rows) {
      const code =
        row.kind === 'single' ? row.item.code : (altChoice[row.altGroup] ?? row.options[0].code)
      const v = parse(values[code] ?? '')
      if (v != null) m[code] = v
    }
    return m
  }, [rows, values, altChoice])

  const canSubmit = Object.keys(measures).length > 0

  async function submit() {
    setLoading(true)
    setAi(null)
    setAiError(null)
    setSubmitError(null)
    try {
      const res = await fitness({ age, sex, measures })
      setResult(res)
    } catch (e) {
      setSubmitError(toAppError(e)) // POST 는 자동 재시도 없음 → 수동 재시도 버튼 제공
    } finally {
      setLoading(false)
    }
  }

  async function requestAi() {
    aiCanceled.current = false
    const ctrl = new AbortController()
    aiAbort.current = ctrl
    setAiError(null)
    setAiLoading(true)
    try {
      const res = await fitnessAi({ age, sex, measures }, ctrl.signal)
      if (aiCanceled.current) return
      setAi(res)
    } catch (e) {
      if (aiCanceled.current) return
      const err = toAppError(e)
      if (err.kind !== 'canceled') setAiError(err) // 429 는 err.message 를 그대로 노출
    } finally {
      if (aiAbort.current === ctrl) aiAbort.current = null
      if (!aiCanceled.current) setAiLoading(false)
    }
  }

  // 사용자가 "처방 생성"을 취소 — 실서버는 요청을 중단하고, 목/느린 응답은 결과를 버린다.
  function cancelAi() {
    aiCanceled.current = true
    aiAbort.current?.abort()
    aiAbort.current = null
    setAiLoading(false)
  }

  // 항목을 factor 로 그룹핑(표시).
  const grouped = useMemo(() => {
    const map = new Map<string, FormRow[]>()
    for (const row of rows) {
      const f = row.kind === 'single' ? row.item.factor : row.factor
      const arr = map.get(f) ?? []
      arr.push(row)
      map.set(f, arr)
    }
    return Array.from(map.entries())
  }, [rows])

  return (
    <section
      data-testid="fitness-section"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="text-base font-bold text-slate-900 dark:text-white">체력 처방 (선택)</span>
          <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
            측정값을 넣으면 약점 판정·운동 추천·AI 처방을 받아요
          </span>
        </span>
        <span className="text-slate-600 dark:text-slate-400" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          {/* 만 7~10 공백 고지 */}
          {items?.age_gap && (
            <div
              data-testid="fitness-gap-banner"
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200"
            >
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {items.message ??
                  '이 연령은 국민체력100 공식 기준이 없습니다 — 유소년(11~12세) 기준을 참고로 제공합니다.'}
              </span>
            </div>
          )}

          {!parqOk ? (
            <ParqGate onContinue={() => setParqOk(true)} />
          ) : itemsLoading ? (
            <FitnessFormSkeleton />
          ) : itemsError ? (
            <ItemsRetryPanel onRetry={() => loadItems(age)} />
          ) : items && items.items.length === 0 ? (
            <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
              {items.message ?? '이 연령군은 등급 판정 측정항목이 없습니다.'}
            </p>
          ) : (
            <>
              <DynamicForm
                grouped={grouped}
                values={values}
                altChoice={altChoice}
                onValue={(code, v) => setValues((s) => ({ ...s, [code]: v }))}
                onAlt={(altGroup, code) => setAltChoice((s) => ({ ...s, [altGroup]: code }))}
              />
              <button
                type="button"
                data-testid="fitness-submit"
                onClick={submit}
                disabled={loading || !canSubmit}
                className="min-h-11 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? '분석 중…' : canSubmit ? '체력 판정 받기' : '측정값을 1개 이상 입력하세요'}
              </button>
              {submitError && (
                <div
                  role="alert"
                  data-testid="fitness-submit-error"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
                >
                  <span className="inline-flex items-center gap-2">
                    <WarnIcon className="h-4 w-4 shrink-0" />
                    {submitError.kind === 'ratelimit'
                      ? submitError.message
                      : '체력 판정을 불러오지 못했습니다.'}
                  </span>
                  <button
                    type="button"
                    data-testid="fitness-submit-retry"
                    onClick={submit}
                    className="rounded-md px-2 py-1 text-xs font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900 dark:text-rose-200"
                  >
                    다시 시도
                  </button>
                </div>
              )}
            </>
          )}

          {result && (
            <FitnessResult
              result={result}
              nearby={nearby}
              onApplyFilter={onApplyFilter}
              ai={ai}
              aiLoading={aiLoading}
              aiError={aiError}
              onRequestAi={requestAi}
              onCancelAi={cancelAi}
            />
          )}

          {/* 하단 고정 고지 */}
          <p className="border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
            운동 참고 정보이며 의료 조언이 아닙니다. 공식 체력 인증은 전국 체력인증센터(무료)에서 받을 수 있습니다.
          </p>
        </div>
      )}
    </section>
  )
}

// PAR-Q 게이트: 폼 앞단 스크리닝 고지. 응답은 저장·전송하지 않는다.
function ParqGate({ onContinue }: { onContinue: () => void }) {
  const [checked, setChecked] = useState(false)
  return (
    <div
      data-testid="parq-gate"
      className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
    >
      <div className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-100" />
        <p className="text-sm text-slate-700 dark:text-slate-200">
          심장질환·흉통 등 문진 항목에 해당하거나 혈압이 <b>160/100mmHg 이상</b>이면 측정·고강도 운동 전
          전문가와 상담하세요.
        </p>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          data-testid="parq-check"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        해당 없음, 계속하기
      </label>
      <button
        type="button"
        data-testid="parq-continue"
        onClick={onContinue}
        disabled={!checked}
        className="mt-3 min-h-11 w-full rounded-lg border-2 border-brand-600 px-4 py-2 font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-100 dark:hover:bg-brand-700/20"
      >
        측정값 입력하기
      </button>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">이 문진 응답은 저장·전송되지 않습니다.</p>
    </div>
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
  grouped: [string, FormRow[]][]
  values: Record<string, string>
  altChoice: Record<string, string>
  onValue: (code: string, v: string) => void
  onAlt: (altGroup: string, code: string) => void
}) {
  const inputCls =
    'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
  return (
    <div data-testid="fitness-form" className="space-y-4">
      {grouped.map(([factor, frows]) => (
        <div key={factor}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            {factor}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {frows.map((row) => {
              if (row.kind === 'single') {
                const it = row.item
                return (
                  <label key={it.code} className="block text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{it.name}</span>
                    {it.unit && <span className="ml-1 text-xs text-slate-600 dark:text-slate-400">({it.unit})</span>}
                    <input
                      type="number"
                      inputMode="decimal"
                      data-testid={`fit-input-${it.code}`}
                      value={values[it.code] ?? ''}
                      onChange={(e) => onValue(it.code, e.target.value)}
                      className={inputCls}
                    />
                    <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-slate-400">{it.hint}</span>
                  </label>
                )
              }
              const code = altChoice[row.altGroup] ?? row.options[0].code
              const active = row.options.find((o) => o.code === code) ?? row.options[0]
              return (
                <div key={row.altGroup} className="text-sm">
                  <span className="text-slate-700 dark:text-slate-200">{row.factor} (택1)</span>
                  <select
                    data-testid={`fit-alt-${row.altGroup}`}
                    aria-label={`${row.factor} 측정 종목 선택`}
                    value={code}
                    onChange={(e) => onAlt(row.altGroup, e.target.value)}
                    className={inputCls}
                  >
                    {row.options.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.name}
                        {o.unit ? ` (${o.unit})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    inputMode="decimal"
                    data-testid={`fit-input-${active.code}`}
                    aria-label={`${active.name} 값 입력${active.unit ? ` (단위 ${active.unit})` : ''}`}
                    value={values[active.code] ?? ''}
                    onChange={(e) => onValue(active.code, e.target.value)}
                    className={inputCls}
                    placeholder={active.hint}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function FitnessResult({
  result,
  nearby,
  onApplyFilter,
  ai,
  aiLoading,
  aiError,
  onRequestAi,
  onCancelAi,
}: {
  result: FitnessResponse
  nearby: Nearby
  onApplyFilter: (sports: string[]) => void
  ai: FitnessAiResponse | null
  aiLoading: boolean
  aiError: AppError | null
  onRequestAi: () => void
  onCancelAi: () => void
}) {
  const items = result.items ?? []
  const rg = result.reference_grade
  const sports = result.facility_filter_sports ?? []
  const matchCount = useMemo(() => {
    if (sports.length === 0) return 0
    const set = new Set(sports)
    return [...nearby.voucher_facilities, ...nearby.alternatives].filter((f) =>
      f.sports.some((s) => set.has(s)),
    ).length
  }, [sports, nearby])

  return (
    <div data-testid="fitness-result" className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ok" icon={<CheckIcon className="h-3.5 w-3.5" />}>
          국민체력100 공식 인증기준
        </Badge>
        {result.age_group && (
          <span className="text-xs text-slate-600 dark:text-slate-400">{result.age_group}</span>
        )}
      </div>

      {/* ① 항목별 band 칩 + 비교문 */}
      {items.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">항목별 판정</h4>
          <ul className="mt-2 space-y-1.5">
            {items.map((it) => (
              <li
                key={it.code}
                data-testid="item-band"
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge tone={bandTone(it.band)}>{it.band}</Badge>
                <span className="text-slate-600 dark:text-slate-300">{it.comparison}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ② 참고등급(추정) + 미입력 요인 + 인증센터 안내 */}
      {rg && (
        <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <Badge tone="warn" icon={<InfoIcon className="h-3.5 w-3.5" />}>
              {rg.label}
            </Badge>
            {rg.grade != null && (
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {rg.grade}등급 수준(추정)
              </span>
            )}
          </div>
          {rg.missing.length > 0 && (
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              미입력 요인: {rg.missing.join(', ')} — 전 항목 측정 시에만 공식 등급이 확정됩니다.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            자가입력 기준 추정값입니다. <b>공식 인증은 체력인증센터(무료)</b>에서 받을 수 있습니다.
          </p>
        </div>
      )}

      {/* ③ 약점별 추천 블록 (출처 배지 + 영상 카드) */}
      {result.recommendations.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">약점별 추천</h4>
          {result.recommendations.map((r, i) => (
            <RecommendationBlock key={i} rec={r} />
          ))}
        </div>
      ) : (
        result.weaknesses.length === 0 && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            입력한 항목에서는 기준 미달 약점이 발견되지 않았습니다.
          </p>
        )
      )}

      {/* ④ 이 운동 되는 근처 강좌 — 시설 리스트 필터 연동 */}
      {sports.length > 0 && (
        <button
          type="button"
          data-testid="facility-filter-apply"
          onClick={() => onApplyFilter(sports)}
          className="min-h-11 w-full rounded-lg border-2 border-brand-600 px-4 py-2.5 text-left font-semibold text-brand-700 transition hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-700/20"
        >
          이 운동 되는 근처 강좌 보기 · {sports.join(' · ')}
          <span className="ml-1 font-normal text-brand-700 dark:text-brand-100">
            (근처 {matchCount}곳)
          </span>
        </button>
      )}

      {/* ⑤ AI 처방 — 진행 문구("최대 1분") + 취소, 실패 시(429 등) 정직한 안내 */}
      <div className="space-y-2">
        {!aiLoading && (
          <button
            type="button"
            data-testid="ai-prescribe-btn"
            onClick={onRequestAi}
            className="min-h-11 w-full rounded-lg bg-slate-800 px-4 py-2.5 font-semibold text-white transition hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            {ai || aiError ? 'AI 처방 다시 받기' : 'AI 처방 받기'}
          </button>
        )}
        {aiLoading && (
          <div
            role="status"
            data-testid="ai-progress"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
          >
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300"
              />
              처방 문장을 만드는 중 — 최대 1분
            </span>
            <button
              type="button"
              data-testid="ai-cancel"
              onClick={onCancelAi}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              취소
            </button>
          </div>
        )}
        {aiError && !aiLoading && (
          <div
            role="alert"
            data-testid="ai-error"
            className={`rounded-lg border p-3 text-sm ${
              aiError.kind === 'ratelimit'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200'
                : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
            }`}
          >
            {aiError.kind === 'ratelimit'
              ? aiError.message
              : 'AI 처방을 불러오지 못했어요. 위 규칙 기반 추천을 참고하시고, 잠시 후 다시 시도해 주세요.'}
          </div>
        )}
        {ai && <AiResult ai={ai} />}
      </div>
    </div>
  )
}

function RecommendationBlock({ rec }: { rec: FitnessRecommendation }) {
  const exercises = (rec.exercises as (GraphNamed | string)[]).map(named)
  const videos = (rec.videos ?? []) as GraphVideo[]
  return (
    <div data-testid="rec-block" className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="font-semibold text-slate-800 dark:text-slate-100">{rec.weakness}</p>

      <ul className="mt-2 space-y-1.5">
        {exercises.map((e, i) => {
          const badge = sourceBadge(e.prov)
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{e.name}</span>
              {badge && (
                <span data-testid="source-badge">
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </span>
              )}
              {e.prov?.via_goal && <span className="text-xs text-slate-600 dark:text-slate-400">via {e.prov.via_goal}</span>}
            </li>
          )
        })}
      </ul>

      {videos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {videos.slice(0, 3).map((v, i) => (
            <li key={i} data-testid="video-card" className="w-32">
              <a href={v.url ?? '#'} target="_blank" rel="noreferrer noopener" className="block">
                {v.img_url ? (
                  <img
                    src={v.img_url}
                    alt={v.title}
                    className="h-[72px] w-32 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                  />
                ) : (
                  <div className="grid h-[72px] w-32 place-items-center rounded-md bg-slate-100 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    영상
                  </div>
                )}
                <span className="mt-1 block truncate text-xs text-brand-700 underline underline-offset-2 dark:text-brand-100">
                  {v.title}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AiResult({ ai }: { ai: FitnessAiResponse }) {
  const isAi = ai.provider === 'claude' || ai.provider === 'gemini'
  return (
    <div data-testid="ai-result" className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <Badge tone={isAi ? 'purple' : 'brand'}>
          <span data-testid="ai-provider-label">{isAi ? 'AI 보조 처방' : '기본 규칙 처방'}</span>
        </Badge>
        <span className="text-xs text-slate-600 dark:text-slate-400">provider: {ai.provider}</span>
      </div>

      {ai.처방.length > 0 && (
        <ul className="space-y-2">
          {ai.처방.map((rx, i) => (
            <li key={i} data-testid="ai-rx" className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900">
              <p className="font-semibold text-slate-800 dark:text-slate-100">
                {rx.운동}
                <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-400">
                  {rx.목표체력요인}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                강도: {rx.강도} · 빈도: {rx.주당빈도}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-600 dark:text-slate-400">{ai.주의}</p>
    </div>
  )
}
