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

export interface DemoRoute {
  demo: boolean
  // ?p=P2 — 퀵스타트 칩을 대신 눌러 줄 페르소나 id(QR·딥링크). 없으면 null.
  p: string | null
  // ?auto=1 — 자동재생. W1 은 파싱만 하고 무시한다(W2 구현).
  auto: boolean
}

// OV10: `#/demo` 는 접두사다 — 뒤에 해시 쿼리(`#/demo?p=P2&auto=1`)가 붙어도 데모 페이지다.
// URLSearchParams 만 쓰고 라우터는 들이지 않는다(의존성 0 유지).
export function parseDemoHash(hash: string): DemoRoute {
  const [path, query = ''] = hash.split('?')
  const clean = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
  if (clean !== DEMO_HASH) return { demo: false, p: null, auto: false }
  const q = new URLSearchParams(query)
  const p = q.get('p')
  const auto = q.get('auto')
  return {
    demo: true,
    p: p && p.trim() !== '' ? p.trim() : null,
    auto: auto === '1' || auto === 'true',
  }
}

export function readDemo(prev: boolean): boolean {
  if (typeof window === 'undefined') return prev
  const h = window.location.hash
  if (parseDemoHash(h).demo) return true
  if (h === '' || h === '#' || h === '#/') return false
  return prev // 앵커 해시(#top 등) — 라우트 아님
}

// 지금 해시가 가리키는 데모 딥링크 옵션(페르소나 자동 선택용). 라우트가 아니면 전부 비어 있다.
export function readDemoRoute(): DemoRoute {
  if (typeof window === 'undefined') return { demo: false, p: null, auto: false }
  return parseDemoHash(window.location.hash)
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
