// 공용 UI 프리미티브. 상태 표기는 색+아이콘+텍스트 삼중(색맹 안전).
import type { ReactNode } from 'react'

export function CheckIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function XIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M6.3 6.3a1 1 0 0 1 1.4 0L10 8.6l2.3-2.3a1 1 0 1 1 1.4 1.4L11.4 10l2.3 2.3a1 1 0 0 1-1.4 1.4L10 11.4l-2.3 2.3a1 1 0 0 1-1.4-1.4L8.6 10 6.3 7.7a1 1 0 0 1 0-1.4Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function WarnIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M9.1 2.6a1 1 0 0 1 1.8 0l7 12.1a1 1 0 0 1-.9 1.5H3a1 1 0 0 1-.9-1.5l7-12.1ZM10 7a.9.9 0 0 0-.9 1l.2 3.2a.7.7 0 0 0 1.4 0l.2-3.2A.9.9 0 0 0 10 7Zm0 6.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function InfoIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1 2a.9.9 0 0 0-.9.9v4.2a.9.9 0 0 0 1.8 0V9.9A.9.9 0 0 0 10 9Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

type Tone = 'neutral' | 'brand' | 'ok' | 'fail' | 'warn' | 'purple'

const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 ring-slate-200 dark:ring-slate-700',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-700/25 dark:text-brand-100 ring-brand-100 dark:ring-brand-700/40',
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-500/30',
  fail: 'bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200 ring-rose-200 dark:ring-rose-500/30',
  warn: 'bg-amber-50 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200 ring-amber-200 dark:ring-amber-400/30',
  purple: 'bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200 ring-violet-200 dark:ring-violet-500/30',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE[tone]}`}
    >
      {icon}
      {children}
    </span>
  )
}

// 좌표 정직성 배지(FR-04 AC1): 이용권 등 시군구 중심 폴백 좌표 시설에 부착.
// 카피 사전 고정 문구: "위치 근사(구 중심)". 거리(km)는 함께 표기하지 않는다.
export function ApproxLocationBadge() {
  return (
    <Badge tone="warn" icon={<InfoIcon className="w-3 h-3" />}>
      위치 근사(구 중심)
    </Badge>
  )
}

// 예상 자격 삼중 표기: 색 + 아이콘 + 텍스트
export function EligibilityMark({ eligible }: { eligible: boolean }) {
  return eligible ? (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white">
      <CheckIcon className="w-5 h-5" />
      예상 자격
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-500 px-3 py-1.5 text-sm font-bold text-white dark:bg-slate-600">
      <XIcon className="w-5 h-5" />
      해당 없음
    </span>
  )
}
