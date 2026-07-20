import { useState } from 'react'
import { fitness } from '../api/client'
import type { FitnessMeasures, FitnessResponse, Sex } from '../types'
import { Badge, InfoIcon, WarnIcon } from './ui'

const FIELDS: { key: keyof FitnessMeasures; label: string; unit: string; placeholder: string }[] = [
  { key: 'grip_kg', label: '악력', unit: 'kg', placeholder: '예: 30' },
  { key: 'situp_cnt', label: '윗몸말아올리기', unit: '회', placeholder: '예: 20' },
  { key: 'flex_cm', label: '앉아윗몸앞으로굽히기', unit: 'cm', placeholder: '예: -3' },
  { key: 'shuttle_cnt', label: '왕복오래달리기', unit: '회', placeholder: '예: 25' },
]

export function FitnessStep({
  age,
  sex,
  onApplyFilter,
}: {
  age: number
  sex: Sex
  onApplyFilter: (sports: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<FitnessResponse | null>(null)
  const [loading, setLoading] = useState(false)

  function parse(v: string): number | null {
    if (v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  async function submit() {
    setLoading(true)
    try {
      const measures: FitnessMeasures = {
        grip_kg: parse(values.grip_kg ?? ''),
        situp_cnt: parse(values.situp_cnt ?? ''),
        flex_cm: parse(values.flex_cm ?? ''),
        shuttle_cnt: parse(values.shuttle_cnt ?? ''),
      }
      const res = await fitness({ age, sex, measures })
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="text-base font-bold text-slate-900 dark:text-white">체력 처방 (선택)</span>
          <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">측정값을 넣으면 약점·추천 운동을 알려드려요</span>
        </span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="text-slate-700 dark:text-slate-200">{f.label}</span>
                <span className="ml-1 text-xs text-slate-400">({f.unit})</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? '분석 중…' : '체력 약점 분석'}
          </button>

          {result && <FitnessResult result={result} onApplyFilter={onApplyFilter} />}
        </div>
      )}
    </section>
  )
}

function FitnessResult({
  result,
  onApplyFilter,
}: {
  result: FitnessResponse
  onApplyFilter: (sports: string[]) => void
}) {
  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center gap-2">
        <Badge tone="warn" icon={<WarnIcon className="w-3.5 h-3.5" />}>데모 기준 (국민체력100 근사)</Badge>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">약점</h4>
        <ul className="mt-2 flex flex-wrap gap-2">
          {result.weaknesses.map((w, i) => (
            <li key={i}>
              <Badge tone={w.band === '하위' ? 'fail' : 'neutral'}>
                {w.item} · {w.band}
                {w.value != null ? ` (${w.value})` : ''}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{result.weaknesses[0]?.basis}</p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">추천 운동</h4>
        <ul className="mt-2 space-y-2">
          {result.recommendations.map((r, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-100">{r.weakness}</span>
                <Badge tone="purple">{r.curated}</Badge>
              </div>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                운동: {r.exercises.join(', ')} · 종목: {r.sports.join(', ')}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {result.videos.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">운동 동영상</h4>
          <ul className="mt-2 space-y-1">
            {result.videos.map((v, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <InfoIcon className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-100" />
                <a href={v.url} target="_blank" rel="noreferrer noopener" className="text-brand-700 underline underline-offset-2 dark:text-brand-100">
                  {v.title}
                </a>
                <span className="text-xs text-slate-400">· {v.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.facility_filter_sports.length > 0 && (
        <button
          type="button"
          onClick={() => onApplyFilter(result.facility_filter_sports)}
          className="w-full rounded-lg border-2 border-brand-600 px-4 py-2.5 font-semibold text-brand-700 transition hover:bg-brand-50 dark:text-brand-100 dark:hover:bg-brand-700/20"
        >
          이 운동 되는 근처 시설 보기 ({result.facility_filter_sports.join(' · ')})
        </button>
      )}
    </div>
  )
}
