// "맨 아래로" 버튼(FAB) — 대화 바닥에서 멀어졌을 때만 나타나는 작은 원형 버튼.
//
// 왜 필요한가: 카드 CTA("지도에서 보기")나 패널 열기는 화면을 위쪽(패널·덱 머리)으로 데려간다.
// 그 뒤 다시 대화로 돌아오려면 폰에서 몇 번을 굴려야 했다 — 여기서 1탭으로 돌려준다.
//
// 위치(v1.12, 2026-09-28): **컴포저 줄 안, 보내기 버튼 왼쪽**. 예전에는 컴포저 위에 떠 있는
// 고정 버튼이었는데, 스트림 오른쪽 끝의 글(출처 줄·설명·버튼·거리)을 덮었다(보고서 스샷).
// 컴포저는 원래 콘텐츠가 없는 띠라 여기 두면 어떤 내용도 가리지 않는다.
// 숨김 상태에서는 폭 0 으로 접혀 입력칸 폭을 빼앗지 않는다(index.css .fab-pop).

import { useEffect, useRef, useState } from 'react'
import { fabVisible } from './scrollFab'

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

export function ScrollToBottomFab({ onPress }: { onPress: () => void }) {
  const [visible, setVisible] = useState(false)
  const raf = useRef(0)

  useEffect(() => {
    const measure = () => {
      raf.current = 0
      const doc = document.documentElement
      // 바닥까지 남은 거리. 0 = 문서 끝(액션 칩이 컴포저 위로 온전히 보이는 상태).
      const gap = doc.scrollHeight - (window.scrollY + window.innerHeight)
      setVisible(fabVisible(gap))
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
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule)
      ro.observe(document.body)
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [])

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
      // 그림자 없음 — 종이 원판 + 1px 잉크 괘선. 옆의 보내기(잉크 채움)와 구별되게 채우지 않는다.
      className="press fab-pop grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-ink bg-paper text-ink dark:border-ink-dark dark:bg-paper-dark dark:text-ink-dark"
    >
      <ChevronDownIcon className="h-5 w-5" />
    </button>
  )
}
