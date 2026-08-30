// 공용 UI 프리미티브. 상태 표기는 색+아이콘+텍스트 삼중(색맹 안전).
//
// ★ B · 종이 메모(docs/designs/b-paper-tokens.md): 카드·그림자·알약 없음.
//   경계는 괘선으로만 — 큰 전환 2px ink / 항목 1px dashed rule / 목록 행 1px rule.
//   radius ≤ 3px. 배지는 "채운 알약"이 아니라 1px rule 테두리의 텍스트 토큰이다.
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

// 아래 방향 셰브론(히어로 CTA 우측) — 텍스트 화살표(↓) 대신 같은 뜻의 아이콘.
export function ChevronDownIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

// 영상 자리표시(썸네일 실패·부재) 안의 재생 표시.
export function PlayIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

// ── 종이 메모 공용 클래스(문자열 상수로 1벌 유지) ─────────────────────────
// 큰 전환(제도 판정·히어로·체력 판정 등) 위의 2px 잉크 괘선.
export const SECTION_RULE = 'border-t-2 border-ink pt-4 dark:border-ink-dark'
// 항목 사이의 1px 점선.
export const ITEM_RULE = 'border-t border-dashed border-rule dark:border-rule-dark'
// 목록 행 사이의 1px 실선.
export const ROW_RULE = 'border-t border-rule dark:border-rule-dark'
// 강조 박스(참고 등급·선정순위·요금) — tint 배경 radius 3, 그림자 없음.
export const TINT_BOX = 'rounded-[3px] bg-tint p-3.5 dark:bg-tint-dark'
// 1차 버튼: 잉크 채움 + 종이색 글자 + 명조.
// (justify-* 는 호출부에서 지정한다 — 같은 속성 유틸을 두 번 넣지 않기 위해.)
export const BTN_INK =
  'press flex min-h-[52px] w-full items-center gap-2 rounded-[3px] bg-ink px-4 font-serif text-[16px] font-extrabold text-paper transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-ink-dark dark:text-paper-dark'
// 2차 버튼: 1.5px 잉크 테두리 네모(답 칩과 같은 문법).
export const BTN_LINE =
  'press flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[3px] border-[1.5px] border-ink px-4 py-2 text-[15px] font-bold text-ink transition-colors hover:bg-tint disabled:opacity-50 dark:border-ink-dark dark:text-ink-dark dark:hover:bg-tint-dark'
// 3차(보조) 버튼: 밑줄 텍스트.
export const BTN_TEXT =
  'inline-flex min-h-11 items-center text-[13px] text-mute underline decoration-1 underline-offset-4 hover:text-ink dark:text-mute-dark dark:hover:text-ink-dark'
// 본문 링크(인주색 밑줄).
export const LINK_ACCENT =
  'text-accent-ink underline underline-offset-[3px] hover:opacity-80 dark:text-accent-ink-dark'

type Tone = 'neutral' | 'brand' | 'ok' | 'fail' | 'warn' | 'purple'

// 텍스트 토큰(옛 Badge). 알약·채움 금지 — 1px rule 테두리 + radius 2 + 11.5px 잉크 글자.
// tone 은 호출부 호환을 위해 남기지만 색을 바꾸지 않는다(11.5px 작은 글자는 잉크/뮤트만 쓴다).
export function Badge({
  tone: _tone = 'neutral',
  icon,
  children,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-rule px-1.5 py-[1px] text-[11.5px] leading-[1.5] text-ink dark:border-rule-dark dark:text-ink-dark">
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

// 공식 확인 표기(색+아이콘+텍스트) — 채운 배지가 아니라 초록 체크 + 작은 글자.
export function OkNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-ok dark:text-ok-dark ${className}`}
    >
      <CheckIcon className="w-3 h-3 shrink-0" />
      {children}
    </span>
  )
}

// 예상 자격 삼중 표기: 색 + 아이콘 + 텍스트 (✓ 예상 자격 = ok / ✗ 해당 없음 = 인주)
export function EligibilityMark({ eligible }: { eligible: boolean }) {
  return eligible ? (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-bold text-ok dark:text-ok-dark">
      <CheckIcon className="w-3.5 h-3.5 shrink-0" />
      예상 자격
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-bold text-accent-ink dark:text-accent-ink-dark">
      <XIcon className="w-3.5 h-3.5 shrink-0" />
      해당 없음
    </span>
  )
}
