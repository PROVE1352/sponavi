// 해시 라우트 2개(라우터 의존성 없음 — hashchange 리스너만 쓴다, ARCHITECTURE §11.4).
//
//   /        → 메인 = 실사용 랜딩. 인사 + 비저장 고지 다음 곧바로 첫 질문(FR-12 AC5 v1.4)
//   /#/demo  → 데모 페이지 = 심사·시연 진입로. P1~P5 퀵스타트 칩 · 경로 시각화 · 데모 배지
//
// 두 페이지는 같은 ChatApp 이다. 차이는 인사 시퀀스·경로 카드·배지뿐이며,
// 판정/체력/패널 등 나머지 대화 계약은 완전히 동일하다.
//
// ★ `#top`(로고의 본문 이동 앵커)처럼 라우트가 아닌 해시는 현재 페이지를 바꾸지 않는다 —
//   데모 시연 중 로고를 눌렀다고 메인으로 튕기면 안 된다.

import { useEffect, useState } from 'react'

export const DEMO_HASH = '#/demo'

export function readDemo(prev: boolean): boolean {
  if (typeof window === 'undefined') return prev
  const h = window.location.hash
  if (h === DEMO_HASH || h === `${DEMO_HASH}/`) return true
  if (h === '' || h === '#' || h === '#/') return false
  return prev // 앵커 해시(#top 등) — 라우트 아님
}

export function useIsDemo(): boolean {
  const [demo, setDemo] = useState(() => readDemo(false))
  useEffect(() => {
    const onHash = () => setDemo((prev) => readDemo(prev))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return demo
}
