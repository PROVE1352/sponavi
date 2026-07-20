import type { ProgramEligibility } from '../types'
import { Badge, CheckIcon, EligibilityMark, InfoIcon, WarnIcon, XIcon } from './ui'

export function EligibilityCard({ p }: { p: ProgramEligibility }) {
  const eligible = p.eligible
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
        eligible
          ? 'border-emerald-300 dark:border-emerald-500/40'
          : 'border-slate-200 dark:border-slate-800'
      }`}
      aria-label={`${p.program_name} 예상 자격 결과`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{p.program_name}</h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{p.benefit}</p>
        </div>
        <EligibilityMark eligible={eligible} />
      </header>

      {!p.verified && (
        <div className="mt-3">
          <Badge tone="warn" icon={<WarnIcon className="w-3.5 h-3.5" />}>
            공식 확인 필요 (자격 기준 미검증)
          </Badge>
        </div>
      )}

      {/* 사유 문장 — 각 항목 ✓/✗ 삼중 표기 */}
      <ul className="mt-4 space-y-2">
        {p.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {r.ok ? (
              <CheckIcon className="mt-0.5 w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <XIcon className="mt-0.5 w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            )}
            <span className="text-slate-700 dark:text-slate-200">{r.message}</span>
          </li>
        ))}
      </ul>

      {/* 신청법·서류·링크 (예상 자격일 때) */}
      {eligible && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <InfoIcon className="w-4 h-4 text-brand-600 dark:text-brand-100" />
            신청 방법
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.apply.how}</p>
          {p.apply.docs.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">준비 서류</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {p.apply.docs.map((d, i) => (
                  <li key={i}>
                    <Badge tone="neutral">{d}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <a
            href={p.apply.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            공식 신청 페이지 열기
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
              <path d="M11 3a1 1 0 1 0 0 2h2.6l-6.3 6.3a1 1 0 1 0 1.4 1.4L15 6.4V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" />
              <path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" />
            </svg>
          </a>
        </div>
      )}

      {/* 출처·확인일 각주 */}
      <footer className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        출처{' '}
        <a
          href={p.source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300"
        >
          {p.source.url}
        </a>{' '}
        · 확인일 {p.source.checked}
        {!p.verified && ' · 자격 기준은 공식 신청처에서 최종 확인하세요'}
      </footer>
    </article>
  )
}
