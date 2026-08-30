// "맨 아래로" 버튼(FAB) — 대화 바닥에서 멀어졌을 때만 나타나는 작은 원형 버튼.
//
// 왜 필요한가: 카드 CTA("지도에서 보기")나 패널 열기는 화면을 위쪽(패널·덱 머리)으로 데려간다.
// 그 뒤 다시 대화로 돌아오려면 폰에서 몇 번을 굴려야 했다 — 여기서 1탭으로 돌려준다.
//
// 위치는 **컴포저 바로 위**다. 컴포저 높이는 상황에 따라 자라므로(칩 모드 고지 한 줄)
// 매직 넘버 대신 실측한다. 컴포저는 sticky 라 문서 끝에서는 뷰포트 바닥을 떠나는데,
// 그때도 "컴포저 윗변에서 12px" 규칙이 그대로 지켜지도록 top 을 기준으로 잰다.
//
// ※ 모바일 패널(<lg)은 오버레이가 아니라 스트림 위쪽 문서 흐름에 있는 접이식 시트다
//   (ContextPanel: order-1 / lg:order-2). 그래서 이 버튼과 겹칠 일이 없어 별도 회피가 없다.

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { fabVisible } from './scrollFab'

// 컴포저 윗변과 버튼 아랫변 사이 여백.
const CLEARANCE_PX = 12
// 컴포저를 아직 못 쟀을 때의 보수적 폴백(입력줄 44 + 상하 패딩 24).
const FALLBACK_COMPOSER_H = 68

function ChevronDownIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 8l5 5 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ScrollToBottomFab({
  composerRef,
  onPress,
}: {
  // 버튼을 얹을 기준(하단 고정 컴포저). 높이를 하드코딩하지 않기 위해 실측한다.
  composerRef: RefObject<HTMLElement | null>
  onPress: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [offset, setOffset] = useState(FALLBACK_COMPOSER_H + CLEARANCE_PX)
  const raf = useRef(0)

  useEffect(() => {
    const measure = () => {
      raf.current = 0
      const doc = document.documentElement
      // 바닥까지 남은 거리. 0 = 문서 끝(액션 칩이 컴포저 위로 온전히 보이는 상태).
      const gap = doc.scrollHeight - (window.scrollY + window.innerHeight)
      setVisible(fabVisible(gap))
      const el = composerRef.current
      const top = el
        ? el.getBoundingClientRect().top
        : window.innerHeight - FALLBACK_COMPOSER_H
      setOffset(Math.round(Math.max(CLEARANCE_PX, window.innerHeight - top + CLEARANCE_PX)))
    }
    // 스크롤은 프레임당 한 번만 잰다(passive + rAF) — 레이아웃 읽기를 연타하지 않는다.
    const schedule = () => {
      if (raf.current) return
      raf.current = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // 문서가 자라는 경우(새 버블·카드·지도 타일)는 스크롤 이벤트가 없다 → 높이를 직접 지켜본다.
    const observed = [document.body, composerRef.current].filter(
      (el): el is HTMLElement => el != null,
    )
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule)
      for (const el of observed) ro.observe(el)
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [composerRef])

  return (
    <button
      type="button"
      data-testid="scroll-bottom-fab"
      aria-label="맨 아래로"
      // 숨김 상태는 DOM 에 남되(등장·퇴장 전환을 위해) 포커스·낭독·클릭 대상에서는 빠진다.
      data-visible={visible ? 'true' : 'false'}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? 0 : -1}
      onClick={onPress}
      style={{ bottom: `${offset}px` }}
      className="press fab-pop fixed right-4 z-40 grid h-11 w-11 place-items-center rounded-full bg-brand-600 text-white shadow-card hover:bg-brand-700"
    >
      <ChevronDownIcon className="h-5 w-5" />
    </button>
  )
}
