import { useEffect, useState } from 'react'
import type {
  AssessRequest,
  DisabilityType,
  IncomeClass,
  Sex,
  Sigungu,
} from '../types'

const INCOME_OPTIONS: { value: IncomeClass; label: string; hint: string }[] = [
  { value: '기초생활수급', label: '기초생활수급', hint: '생계·의료·주거·교육급여 수급' },
  { value: '차상위', label: '차상위계층', hint: '차상위 본인부담경감·자활 등' },
  { value: '한부모', label: '한부모가정', hint: '한부모가족 지원 대상' },
  { value: '그외', label: '그 외 (해당 없음)', hint: '위 소득 지원에 해당하지 않음 · 낀 계층' },
]

const DISABILITY_TYPES: DisabilityType[] = ['지체', '시각', '청각', '지적', '뇌병변', '기타']

export function Wizard({
  sigungu,
  prefill,
  onSubmit,
  loading,
}: {
  sigungu: Sigungu[]
  prefill?: AssessRequest | null
  onSubmit: (req: AssessRequest) => void
  loading?: boolean
}) {
  const [age, setAge] = useState('10')
  const [sex, setSex] = useState<Sex>('F')
  const [sigunguCd, setSigunguCd] = useState('11290')
  const [income, setIncome] = useState<IncomeClass>('기초생활수급')
  const [hasDisability, setHasDisability] = useState(false)
  const [disabilityType, setDisabilityType] = useState<DisabilityType>('지체')

  useEffect(() => {
    if (!prefill) return
    setAge(String(prefill.age))
    setSex(prefill.sex)
    setSigunguCd(prefill.sigungu_cd)
    setIncome(prefill.income_class)
    setHasDisability(prefill.disability.has)
    if (prefill.disability.type) setDisabilityType(prefill.disability.type)
  }, [prefill])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const sg = sigungu.find((s) => s.cd === sigunguCd)
    const req: AssessRequest = {
      age: Number(age) || 0,
      sex,
      sigungu_cd: sigunguCd,
      sigungu_nm: sg?.nm ?? '',
      income_class: income,
      disability: { has: hasDisability, type: hasDisability ? disabilityType : null },
      location: sg ? { lat: sg.lat, lon: sg.lon } : null,
    }
    onSubmit(req)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">내 상황 입력</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        입력값은 저장되지 않고 이번 확인에만 쓰입니다. (로그인·개인정보 저장 없음)
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {/* 나이 */}
        <label className="block">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">나이 (만)</span>
          <input
            type="number"
            min={0}
            max={120}
            required
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </label>

        {/* 성별 */}
        <div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">성별</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="성별">
            {(['F', 'M'] as Sex[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sex === s}
                onClick={() => setSex(s)}
                className={`min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                  sex === s
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/25 dark:text-brand-100'
                    : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                {s === 'F' ? '여성' : '남성'}
              </button>
            ))}
          </div>
        </div>

        {/* 시군구 */}
        <label className="block sm:col-span-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">시군구 (서울 25개 구)</span>
          <select
            value={sigunguCd}
            onChange={(e) => setSigunguCd(e.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            {sigungu.map((s) => (
              <option key={s.cd} value={s.cd}>
                {s.nm}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 소득계층 4택 */}
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">소득 계층 (자가 선언)</legend>
        <div role="radiogroup" aria-label="소득 계층 (자가 선언)" className="mt-2 grid gap-2 sm:grid-cols-2">
          {INCOME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={income === opt.value}
              onClick={() => setIncome(opt.value)}
              className={`rounded-lg border p-3 text-left transition ${
                income === opt.value
                  ? 'border-brand-600 bg-brand-50 dark:bg-brand-700/25'
                  : 'border-slate-300 dark:border-slate-700'
              }`}
            >
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{opt.label}</span>
              <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{opt.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* 장애 유무/유형 */}
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">장애 여부</legend>
        <div role="radiogroup" aria-label="장애 여부" className="mt-2 grid grid-cols-2 gap-2">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={hasDisability === v}
              onClick={() => setHasDisability(v)}
              className={`min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                hasDisability === v
                  ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/25 dark:text-brand-100'
                  : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {v ? '장애 있음' : '비장애'}
            </button>
          ))}
        </div>
        {hasDisability && (
          <label className="mt-3 block">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">장애 유형</span>
            <select
              value={disabilityType}
              onChange={(e) => setDisabilityType(e.target.value as DisabilityType)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {DISABILITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}장애
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={loading}
        className="mt-6 w-full rounded-xl bg-brand-600 px-4 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? '확인 중…' : '내 예상 자격 확인하기'}
      </button>
    </form>
  )
}
