import { describe, expect, it } from 'vitest'
import { curatedLabel, edgeWidth } from './pathLabel'

describe('curatedLabel — 경로 그림 대체경로 확인 상태', () => {
  it('"공식 확인"으로 시작하면 전문가 큐레이션이라고 부르지 않는다', () => {
    const l = curatedLabel('공식 확인(조례 2026-09-17)')
    expect(l).toEqual({ official: true, text: '공식 확인(조례 2026-09-17)' })
    expect(l!.text).not.toContain('전문가 큐레이션')
    expect(curatedLabel('공식 확인(2026-07-21)')!.official).toBe(true)
  })

  it('검증 대기 엣지는 "전문가 큐레이션" 프레이밍(SPEC §0-3)', () => {
    expect(curatedLabel('검증 대기')).toEqual({ official: false, text: '전문가 큐레이션 · 검증 대기' })
  })

  it('AI 추론이라는 말은 어떤 값에서도 만들지 않는다', () => {
    for (const c of ['검증 대기', '공식 확인(2026-07-21)', '예산안 발표(2026-09-09)']) {
      expect(curatedLabel(c)!.text).not.toMatch(/AI/)
    }
  })

  it('비어 있으면 배지 없음', () => {
    expect(curatedLabel(undefined)).toBeNull()
    expect(curatedLabel('')).toBeNull()
    expect(curatedLabel('  ')).toBeNull()
  })
})

describe('edgeWidth — 긴 엣지 설명은 넓은 칸', () => {
  it('짧은 라벨 → narrow, 보통 길이 → medium', () => {
    expect(edgeWidth('예상 자격 충족')).toBe('narrow')
    expect(edgeWidth('나이>기준 / 소득>기준')).toBe('medium')
    expect(edgeWidth('파이널유도멀티짐 성북점 · 0.24km')).toBe('medium')
  })
  it('확인 표기가 붙는 대체경로 엣지는 늘 wide', () => {
    expect(edgeWidth('이용권 소득기준 미달 → 공공체육시설 프로그램(요금 감면은 시군구 조례)', '공식 확인(조례 2026-09-17)')).toBe('wide')
    expect(edgeWidth('짧음', '검증 대기')).toBe('wide')
  })
})
