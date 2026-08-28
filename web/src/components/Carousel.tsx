// 카드 가로 스와이프 카루셀(FR-12 AC9).
//
// 세로로 쌓인 카드가 스트림을 한없이 길게 만드는 문제의 해법 — 모바일(<lg)에서는
// 카드를 옆으로 넘겨 보고, 데스크톱(lg+)에서는 원래의 그리드·목록으로 되돌린다.
// 문법은 PathDiagram 과 동일하다: tabIndex=0 스크롤 컨테이너 + 엣지 그라데이션 + 넘김 힌트.
//
// ★ 스크롤은 이 컨테이너가 자체적으로 갖는다 — 페이지(document) 가로 스크롤은 0(NFR-4).
// 폭·스냅은 index.css 의 .snap-track 이 직계 아이템(li)에 부여한다.

import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export const SWIPE_HINT = '← 옆으로 넘겨보세요 →'

// ── 결과 덱(FR-12 AC9 v1.7) ─────────────────────────────────────────────
// 모바일(<lg)에서 판정 결과 블록 전체를 슬라이드 하나씩으로 넘겨 보는 단일 컨테이너.
// CardCarousel 과 문법(스냅·엣지 페이드·넘김 힌트·키보드 스크롤)은 같고, 두 가지가 다르다:
//   ① 슬라이드 높이가 제각각이라 상단 정렬(items-start)한다 — 컨테이너가 출렁이지 않는다.
//   ② 스크롤 위치를 읽어 "3 / 9" 진행 표시를 준다(시각 + 텍스트).
// ★ 결과 영역의 가로 스크롤 컨테이너는 이것 하나뿐이다 — 안에 카루셀을 또 넣지 않는다.
export function CardDeck({
  ariaLabel,
  hint,
  count,
  testId,
  children,
}: {
  ariaLabel: string
  // 안내 톤의 넘김 안내 한 줄(정책 템플릿에서 내려온다).
  hint: string
  count: number
  testId: string
  children: ReactNode
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const onScroll = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const slide = el.querySelector<HTMLElement>('.deck-track > *')
    const step = slide ? slide.getBoundingClientRect().width + 12 : el.clientWidth
    if (step <= 0) return
    const i = Math.round(el.scrollLeft / step)
    setIndex(Math.max(0, Math.min(count - 1, i)))
  }, [count])

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        data-testid={testId}
        className="snap-x snap-mandatory overflow-x-auto pb-2"
      >
        <ul className="deck-track">{children}</ul>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 h-full w-10 bg-gradient-to-l from-slate-50 to-transparent dark:from-[#0b1220]"
      />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p data-testid="carousel-hint" className="text-xs text-slate-600 dark:text-slate-400">
          {hint}
        </p>
        <p
          data-testid="deck-progress"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
        >
          <span aria-hidden="true" className="inline-flex gap-1">
            {Array.from({ length: count }, (_, i) => (
              <span
                key={i}
                className={
                  'h-1.5 w-1.5 rounded-full ' +
                  (i === index ? 'bg-brand-600 dark:bg-brand-100' : 'bg-slate-300 dark:bg-slate-600')
                }
              />
            ))}
          </span>
          {index + 1} / {count}
        </p>
      </div>
    </div>
  )
}

export function CardCarousel({
  ariaLabel,
  count,
  layout = 'grid',
  fade = 'page',
  testId,
  children,
}: {
  // 예: "예상 자격 카드 2장, 좌우로 이동"
  ariaLabel: string
  // 아이템이 1개뿐이면 넘길 것이 없다 — 힌트·그라데이션을 숨긴다.
  count: number
  // lg+ 에서의 복귀 형태: grid = 판정 카드(xl 2열) · stack = 시설 카드 세로 목록
  layout?: 'grid' | 'stack'
  // 엣지 그라데이션이 녹아들 배경: page = 스트림 배경 · card = 흰 카드 안쪽
  fade?: 'page' | 'card'
  testId?: string
  children: ReactNode
}) {
  const many = count > 1
  const fadeFrom =
    fade === 'card'
      ? 'from-white dark:from-slate-900'
      : 'from-slate-50 dark:from-[#0b1220]'

  return (
    <div className="relative">
      <div
        // 키보드로도 스크롤할 수 있어야 한다(axe scrollable-region-focusable).
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        data-testid={testId}
        className="snap-x snap-mandatory overflow-x-auto pb-2 lg:snap-none lg:overflow-x-visible lg:pb-0"
      >
        <ul className={`snap-track ${layout === 'grid' ? 'snap-track--grid' : 'snap-track--stack'}`}>
          {children}
        </ul>
      </div>

      {/* 오른쪽 엣지 페이드 — 다음 카드가 이어짐을 색으로 알린다(모바일 한정) */}
      {many && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 right-0 h-full w-10 bg-gradient-to-l to-transparent lg:hidden ${fadeFrom}`}
        />
      )}
      {many && (
        <p
          data-testid="carousel-hint"
          className="mt-1 text-center text-xs text-slate-600 lg:hidden dark:text-slate-400"
        >
          {SWIPE_HINT}
        </p>
      )}
    </div>
  )
}
