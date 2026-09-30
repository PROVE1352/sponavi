import { describe, expect, it } from 'vitest'
import { REVEAL_GAP_PX, revealDelta } from './reveal'

// 보이는 띠: sticky 헤더(72px) 밑 ~ 뷰포트 바닥(844px) — 390x844 창.
const WIN = { top: 72, bottom: 844 }

describe('revealDelta — sticky 가림 밑의 포커스 대상을 꺼낸다', () => {
  it('다 보이면 굴리지 않는다', () => {
    expect(revealDelta({ top: 72, bottom: 116 }, WIN)).toBe(0)
    expect(revealDelta({ top: 400, bottom: 844 }, WIN)).toBe(0)
  })

  it('헤더 밑에 통째로 걸린 입력칸(top 26 / bottom 70) → 윗변이 헤더 바닥 + 틈에 오게 위로 굴린다', () => {
    // 리뷰 재현 K6: 뷰포트 "안"(top ≥ 0)이라 옛 규칙으로는 굴러가지 않았다.
    const d = revealDelta({ top: 26, bottom: 70 }, WIN)
    expect(d).toBe(26 - (72 + REVEAL_GAP_PX))
    expect(26 - d).toBe(72 + REVEAL_GAP_PX)
  })

  it('헤더에 일부만 걸린 탭 버튼(top 38 / bottom 82)도 꺼낸다', () => {
    const d = revealDelta({ top: 38, bottom: 82 }, WIN)
    expect(38 - d).toBe(80)
  })

  it('뷰포트 위로 벗어난 대상도 같은 규칙(헤더 바닥 기준)', () => {
    expect(-120 - revealDelta({ top: -120, bottom: -76 }, WIN)).toBe(80)
  })

  it('아래로 넘치면 아랫변을 바닥 − 틈에 맞춘다', () => {
    const d = revealDelta({ top: 820, bottom: 864 }, WIN)
    expect(d).toBe(864 - (844 - REVEAL_GAP_PX))
    expect(864 - d).toBe(844 - REVEAL_GAP_PX)
  })

  it('띠보다 큰 대상은 아래로 넘쳐도 윗변을 가리지 않는다(윗변 우선)', () => {
    const r = { top: 300, bottom: 1300 }
    const d = revealDelta(r, WIN)
    expect(r.top - d).toBe(72 + REVEAL_GAP_PX)
  })

  it('목록 칸 sticky 막대(바닥 472) 밑에 걸린 블록(top 299) → 막대 바닥 + 틈으로 내린다', () => {
    // 리뷰 재현 Z: 칸 안 scroll-margin 72px 로는 250px 막대를 넘지 못했다.
    const band = { top: 472, bottom: 760 }
    const d = revealDelta({ top: 299, bottom: 520 }, band)
    expect(299 - d).toBe(472 + REVEAL_GAP_PX)
  })

  it('띠 아래에 통째로 있는 대상은 아랫변을 맞추되 윗변이 가림 위로 올라가지 않는다', () => {
    const band = { top: 200, bottom: 500 }
    const d = revealDelta({ top: 900, bottom: 960 }, band)
    expect(960 - d).toBe(500 - REVEAL_GAP_PX)
    const big = { top: 900, bottom: 1400 }
    expect(big.top - revealDelta(big, band)).toBe(200 + REVEAL_GAP_PX)
  })
})
