import type { AltEdge, ProgramEligibility, Selection } from '../types'
import { Badge, CheckIcon, EligibilityMark, InfoIcon, WarnIcon, XIcon } from './ui'

export function EligibilityCard({ p, altEdges }: { p: ProgramEligibility; altEdges?: AltEdge[] }) {
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

      {/* 예상 선정순위 — 신청(소득무관) vs 선정(우선순위제) 구분 (FR-02 AC5, PRD §6) */}
      {p.selection && <SelectionBlock selection={p.selection} />}

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

      {/* 복수 대체경로 / '지금 바로 되는 것' 블록 (FR-02 AC3) */}
      {altEdges && altEdges.length > 0 && <AltRoutesBlock card={p} altEdges={altEdges} />}

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

// 예상 선정순위 블록: "신청은 소득 무관" 강조 + 선정은 우선순위제(대기 가능) 구분.
function SelectionBlock({ selection }: { selection: Selection }) {
  const undetermined = selection.expected_rank == null
  return (
    <div
      data-testid="selection-block"
      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-400/10"
    >
      <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
        신청은 소득과 관계없이 할 수 있어요 · 선정은 우선순위제입니다
      </p>
      <div className="mt-2">
        <Badge tone={undetermined ? 'neutral' : 'warn'} icon={<InfoIcon className="w-3.5 h-3.5" />}>
          {selection.rank_label}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90">{selection.note}</p>
      {selection.tiebreak && (
        <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-200/70">동점 시: {selection.tiebreak}</p>
      )}
      {selection.source?.url && (
        <p className="mt-2 text-xs text-amber-800/70 dark:text-amber-200/60">
          선정순위 출처{' '}
          <a
            href={selection.source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted underline-offset-2"
          >
            공식 안내
          </a>
          {selection.source.checked ? ` · 확인일 ${selection.source.checked}` : ''}
        </p>
      )}
    </div>
  )
}

// 대체경로 블록: 자격 충족·저순위(4·5/미정) dvoucher → '지금 바로 되는 것'(공식 확인 대안 상위 3),
// 자격 미충족 제도 → 일반 대체경로 상위 3.
function AltRoutesBlock({ card, altEdges }: { card: ProgramEligibility; altEdges: AltEdge[] }) {
  const rank = card.selection?.expected_rank
  const lowOrUndetermined = rank === 4 || rank === 5 || rank == null
  const nowAvailable = card.eligible && card.selection != null && lowOrUndetermined

  const items = nowAvailable
    ? altEdges.filter((a) => a.curated.startsWith('공식 확인')).slice(0, 3)
    : altEdges.slice(0, 3)
  if (items.length === 0) return null

  const heading = nowAvailable ? '지금 바로 되는 것' : '대체경로 · 지금 이용 가능한 대안'
  const desc = nowAvailable
    ? '선정을 기다리는 동안, 소득·자격과 무관하게 지금 바로 이용할 수 있는 공식 확인 대안입니다.'
    : '자격이 안 되어도 지금 이용할 수 있는 대안을 우선순위로 안내합니다.'

  return (
    <div
      data-testid={nowAvailable ? 'now-available-block' : 'alt-routes-block'}
      className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-700/15"
    >
      <p className="flex items-center gap-1.5 text-sm font-bold text-brand-800 dark:text-brand-100">
        <CheckIcon className="w-4 h-4" />
        {heading}
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{desc}</p>
      <ul className="mt-3 space-y-2">
        {items.map((a, i) => {
          const official = a.curated.startsWith('공식 확인')
          return (
            <li
              key={`${a.to}-${i}`}
              data-testid={nowAvailable ? 'now-available-item' : 'alt-route-item'}
              className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  {a.program?.name ?? a.note}
                </span>
                <Badge tone={official ? 'ok' : 'purple'} icon={<WarnIcon className="w-3 h-3" />}>
                  {official ? '공식 확인' : `큐레이션 · ${a.curated}`}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{a.program?.benefit ?? a.note}</p>
              {a.program?.apply_url && (
                <a
                  href={a.program.apply_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 underline decoration-dotted underline-offset-2 dark:text-brand-200"
                >
                  출처·신청 링크 열기
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
