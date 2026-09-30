// 포커스를 옮긴 대상이 sticky 요소 밑에 가리지 않게 — 스크롤 양을 재는 순수 함수(vitest 대상).
//
// 패널의 포커스 이동(K4 탭 버튼 · K6 검색 입력칸 · "위치 확인 안 된 곳 보기" 블록)은 두 겹의 가림을 겪는다.
//   · 창: sticky 헤더(72px, "글씨 크게"면 더) — 헤더 밑(0 ≤ top < 헤더 바닥)에 걸린 대상은 뷰포트 "안"이라
//     "뷰포트 밖이면 scrollIntoView" 규칙으로는 굴러가지 않는다.
//   · 목록 스크롤 칸: 칸 맨 위의 sticky 결과 막대(약 250px) — 대상의 scroll-margin-top(헤더 높이)으로는 모자란다.
// 그래서 "보이는 띠"(가림 아래 ~ 바닥)를 직접 재고, 대상이 띠 밖에 걸치면 그만큼만 굴린다.
// DOM 을 읽고 실제로 굴리는 쪽은 chat/ContextPanel 의 revealFocused 다.

export interface Band {
  top: number
  bottom: number
}

// 대상 윗변과 가림 사이의 숨 쉴 틈(포커스 링 3px + 여백).
export const REVEAL_GAP_PX = 8

// 보이는 띠(band) 안에 대상(r)을 들이려면 얼마나 굴려야 하는가(px). 양수 = 아래로(내용이 위로 올라감),
// 음수 = 위로, 0 = 이미 다 보인다. 창에는 scrollBy(delta), 스크롤 칸에는 scrollTop += delta 로 쓴다.
//   · 윗변이 가려졌으면 윗변을 띠 윗변 + gap 에 맞춘다.
//   · 아래로 넘쳤으면 아랫변을 띠 바닥 − gap 에 맞추되, 그 때문에 윗변이 가려지지는 않게(큰 대상은 윗변 우선).
export function revealDelta(r: Band, band: Band, gap: number = REVEAL_GAP_PX): number {
  if (r.top >= band.top && r.bottom <= band.bottom) return 0
  const toTop = r.top - (band.top + gap)
  if (r.top < band.top) return toTop
  return Math.min(r.bottom - (band.bottom - gap), toTop)
}
