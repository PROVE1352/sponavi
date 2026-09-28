// 공공체육시설 조례 감면 — 목 포트(mocks/publicFee.ts) ↔ 서버 계약(contract/public_fee.json cases),
// 히어로 N(공식 확인만) · 경로 시설 홉(장소 기반만) · 한 줄 요약 표기.
import { describe, expect, it } from 'vitest'
import type { AltEdge, AssessRequest } from '../types'
import { feeSummaryLine } from '../lib/publicFee'
import { mockAssess } from './engine'
import { PERSONA_RESPONSES } from './personas'
import { parseYouthAges } from './publicFee'
import PUBLIC_FEE_JSON from './contract/public_fee.json'

type Case = { body: AssessRequest; expected: Partial<AltEdge>; hero_official_tos: string[] }
const CASES = (PUBLIC_FEE_JSON as unknown as { cases: Record<string, Case> }).cases

const pp = (edges: AltEdge[] | undefined) => (edges ?? []).find((e) => e.to === 'public_program')
const officialTos = (edges: AltEdge[] | undefined) =>
  (edges ?? []).filter((e) => e.curated.startsWith('공식 확인')).map((e) => e.to)

describe('목 엔진 public_program ↔ 서버 계약 cases', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const res = mockAssess(c.body)
      const edge = pp(res.alt_edges)
      expect(edge).toBeDefined()
      for (const [k, v] of Object.entries(c.expected)) {
        expect(edge?.[k as keyof AltEdge], `${name}.${k}`).toEqual(v)
      }
      expect(officialTos(res.alt_edges)).toEqual(c.hero_official_tos)
    })
  }
})

describe('parseYouthAges', () => {
  it('어린이·청소년 구절만 범위로 읽는다', () => {
    expect(parseYouthAges('영유아 5세 이하, 어린이 6~12세, 청소년 18세 이하')).toEqual([
      [6, 12],
      [0, 18],
    ])
    expect(parseYouthAges('어린이 5~12세 또는 초등학생, 청소년 13~18세 또는 중·고등학생 (제2조)')).toEqual([
      [5, 12],
      [13, 18],
    ])
    expect(parseYouthAges('조례·시행규칙에 정의 없음(미확인)')).toEqual([])
  })
})

describe('feeSummaryLine', () => {
  it('16세 다자녀 성북 → 청소년 20% · 3자녀 이상 50%', () => {
    const edge = pp(mockAssess(CASES.P16_seongbuk_multichild.body).alt_edges)!
    expect(feeSummaryLine(edge)).toBe('성북구 구립 체육시설 · 청소년 20% · 3자녀 이상 50%')
  })

  it('맞는 감면이 없으면 일반 요금이라고 말한다', () => {
    const edge = pp(PERSONA_RESPONSES.P2.alt_edges)!
    expect(feeSummaryLine(edge)).toBe('성북구 구립 체육시설 · 해당 감면 없음 · 일반 요금')
  })

  it('군 단위는 군립 · 긴 율은 짧게', () => {
    const edge = pp(PERSONA_RESPONSES.P4.alt_edges)!
    expect(feeSummaryLine(edge)).toBe('고성군 군립 체육시설 · 장애인 50%')
  })

  it('조례 미확인 지역(블록 없음)은 요약하지 않는다', () => {
    const edge = pp(mockAssess(CASES.P16_gangnam_uncovered.body).alt_edges)!
    expect(edge.curated).toBe('검증 대기')
    expect(feeSummaryLine(edge)).toBeNull()
  })
})

describe('히어로 N · 경로', () => {
  it('P2·P4·P5 페르소나: 조례 확인 지역이라 공식 확인 3가지(to 유일)', () => {
    for (const pid of ['P2', 'P4', 'P5']) {
      const edges = PERSONA_RESPONSES[pid].alt_edges ?? []
      expect(new Set(edges.map((e) => e.to)).size, pid).toBe(edges.length)
      expect(officialTos(edges).length, pid).toBe(3)
      expect(edges[0].to, pid).toBe('public_program')
    }
  })

  it('조례 미확인 지역: 튼튼머니가 1순위면 경로는 제도 노드에서 끝난다(시설 홉 없음)', () => {
    const res = mockAssess({
      age: 27,
      sex: 'M',
      sigungu_cd: '11680',
      sigungu_nm: '강남구',
      income_class: '그외',
      disability: { has: false },
    } as AssessRequest)
    const alt = res.path.find((p) => p.edge === '대체경로')
    expect(alt?.to).toBe('tteuntteun')
    expect(res.path.at(-1)?.to).toBe('tteuntteun')
    expect(res.path.some((p) => p.to.startsWith('facility:'))).toBe(false)
  })

  it('조례 확인 지역: 공공 프로그램 뒤 시설 홉의 from 은 public_program', () => {
    const res = mockAssess(CASES.P16_seongbuk.body)
    const fac = res.path.filter((p) => p.to.startsWith('facility:'))
    for (const f of fac) expect(f.from).toBe('public_program')
    expect(res.path.find((p) => p.edge === '대체경로')?.curated).toBe('공식 확인(조례 2026-09-17)')
  })
})

// 2026-09-28: 조례 감면은 이용권 자격과 무관 — 응답 최상위 public_fee(서버 test_public_fee_eligible 와 같은 계약).
type EligibleCase = {
  body: AssessRequest
  expected_public_fee: unknown
  expected_alt_edge_tos: string[]
}
const ELIGIBLE = Object.entries(
  (PUBLIC_FEE_JSON as unknown as { eligible_cases: Record<string, EligibleCase | string> }).eligible_cases,
).filter(([k]) => !k.startsWith('_')) as [string, EligibleCase][]

describe('최상위 public_fee — 이용권 자격 ✓ 사용자도 조례 감면을 본다', () => {
  it('계약 eligible_cases 가 비어 있지 않다', () => {
    expect(ELIGIBLE.length).toBeGreaterThan(0)
  })
  for (const [name, c] of ELIGIBLE) {
    it(`${name} — 목 엔진 = 서버 계약`, () => {
      const res = mockAssess(c.body)
      expect(res.public_fee).toEqual(c.expected_public_fee)
      expect((res.alt_edges ?? []).map((e) => e.to)).toEqual(c.expected_alt_edge_tos)
    })
  }

  it('노원 14세 한부모 → 한부모 20% (자격 ✓ 이라 대체경로 엣지는 없다)', () => {
    const res = mockAssess(ELIGIBLE.find(([k]) => k === 'N14_nowon_single_parent')![1].body)
    expect(pp(res.alt_edges)).toBeUndefined()
    expect(res.public_fee!.reductions!.find((r) => r.target === 'single_parent')?.rate).toBe('20%')
  })

  it('페르소나: public_program 엣지가 있으면 최상위 블록은 그 블록과 같다(P2·P4·P5)', () => {
    for (const pid of ['P2', 'P4', 'P5']) {
      const res = PERSONA_RESPONSES[pid]
      const edge = pp(res.alt_edges)!
      expect(res.public_fee?.reductions, pid).toEqual(edge.reductions)
      expect(res.public_fee?.region, pid).toEqual(edge.region)
    }
  })

  it('P1(성북 10세 기초수급, 자격 ✓)에도 성북 조례 블록이 실린다', () => {
    const pf = PERSONA_RESPONSES.P1.public_fee
    expect(pf?.region?.sigungu_nm).toBe('성북구')
    expect((pf?.reductions ?? []).length).toBeGreaterThan(0)
  })
})
