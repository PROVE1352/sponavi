import { describe, expect, it } from 'vitest'
import { FAB_GAP_PX, fabVisible } from './scrollFab'

// "맨 아래로" 버튼의 노출 판정(순수). 임계 근처의 경계와 비정상 입력만 본다 —
// 스크롤 자체는 브라우저 몫이라 여기서 흉내내지 않는다.
describe('fabVisible', () => {
  it('바닥에 붙어 있으면 감춘다', () => {
    expect(fabVisible(0)).toBe(false)
  })

  it('임계(160px) 이하는 감춘다 — 경계값 포함', () => {
    expect(fabVisible(1)).toBe(false)
    expect(fabVisible(FAB_GAP_PX - 1)).toBe(false)
    expect(fabVisible(FAB_GAP_PX)).toBe(false)
  })

  it('임계를 넘으면 보여 준다', () => {
    expect(fabVisible(FAB_GAP_PX + 1)).toBe(true)
    expect(fabVisible(700)).toBe(true)
  })

  it('임계는 인자로 바꿀 수 있다', () => {
    expect(fabVisible(130, 120)).toBe(true)
    expect(fabVisible(130, 200)).toBe(false)
  })

  it('음수 gap(고무줄 스크롤)·NaN 은 바닥으로 본다', () => {
    expect(fabVisible(-40)).toBe(false)
    expect(fabVisible(Number.NaN)).toBe(false)
    expect(fabVisible(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('기본 임계는 120~200px 사이다(계약 범위)', () => {
    expect(FAB_GAP_PX).toBeGreaterThanOrEqual(120)
    expect(FAB_GAP_PX).toBeLessThanOrEqual(200)
  })
})
