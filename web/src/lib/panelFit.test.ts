import { describe, expect, it } from 'vitest'
import { stickyRegionMaxHeight } from './panelFit'

describe('stickyRegionMaxHeight — 범위 모드 지도 탭의 막대 칸 한도', () => {
  const base = { viewportH: 720, stickyTop: 72, belowContainer: 0, above: 400, below: 12, minPx: 72 }

  it('패널 전체(sticky top + 칸 위 + 칸 + 칸 아래)가 뷰포트에 딱 맞는다', () => {
    const h = stickyRegionMaxHeight(base)
    expect(h).toBe(720 - 72 - 400 - 12)
    expect(base.stickyTop + base.above + h + base.below).toBe(base.viewportH)
  })

  it('데모 푸터만큼 컨테이너가 일찍 끝나면 그만큼 줄인다(대화 바닥에서 패널이 밀려 올라가지 않게)', () => {
    expect(stickyRegionMaxHeight({ ...base, belowContainer: 89 })).toBe(720 - 72 - 89 - 400 - 12)
  })

  it('"글씨 크게"로 머리·범례가 자라면 자란 만큼만 줄인다(고정 16rem 처럼 과하게 줄지 않는다)', () => {
    const large = { ...base, stickyTop: 85.5, above: 480 }
    expect(stickyRegionMaxHeight(large)).toBe(Math.floor(720 - 85.5 - 480 - 12))
  })

  it('남는 높이가 최소값보다 작으면 최소값(막대 첫 줄은 보이게)', () => {
    expect(stickyRegionMaxHeight({ ...base, viewportH: 540 })).toBe(72)
    expect(stickyRegionMaxHeight({ ...base, viewportH: 400 })).toBe(72)
  })

  it('음수 컨테이너 아래 값은 0 으로 본다', () => {
    expect(stickyRegionMaxHeight({ ...base, belowContainer: -5 })).toBe(stickyRegionMaxHeight(base))
  })
})
