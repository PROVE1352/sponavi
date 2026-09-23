// 공공체육시설 조례 감면 — 서버 engine._public_fee_block / _public_fee_curated 의 TS 포트(목 전용).
// 원천은 contract/public_fee.json(= data/public_fee_reductions.json 서울 3구 사본, parity 테스트로 동기).
// 목 fixtures 가 서울 25구뿐이라 성북·송파·노원만 승격되고 나머지 구는 '검증 대기' 그대로다.

import type { AltEdge, FeeReduction, FeeTarget, IncomeClass } from '../types'
import PUBLIC_FEE_JSON from './contract/public_fee.json'

interface RawReduction {
  target: string
  label: string
  rate: string
  condition?: string
  quote: string
  source_url: string
  age_definition?: string
}

interface RawRegion {
  sigungu_cd: string
  sigungu_nm: string
  sido: string
  law: { title: string; article: string; url: string; effective?: string }
  operator?: { name?: string; url?: string }
  scope?: string
  reductions: RawReduction[]
  unverified?: string[]
}

const DATA = PUBLIC_FEE_JSON as unknown as { checked: string; regions: RawRegion[] }

const YOUTH_FALLBACK_MAX = 18
const YOUTH_UNCLEAR_CAVEAT = '청소년·어린이 나이 기준이 조례에 없음 — 시설에 확인'
const SEOUL_MULTICHILD_CAVEAT =
  '다둥이행복카드 발급 기준(자녀 수·막내 나이)은 서울시 카드 사업 기준이며 조례에 없음(미확인)'
const GAP_LABEL: Partial<Record<FeeTarget, string>> = {
  near_poor: '차상위 전용 감면 없음(조례 확인)',
  single_parent: '한부모 감면 없음(조례 확인)',
  basic_livelihood: '기초생활수급 감면 없음(조례 확인)',
  multichild: '다자녀 감면 없음(조례 확인)',
  defector: '북한이탈주민 감면 없음(조례 확인)',
  disability: '장애인 감면 없음(조례 확인)',
}
const CAVEAT_KEYWORDS: [string, FeeTarget][] = [
  ['청소년', 'youth'],
  ['어린이', 'youth'],
  ['나이', 'youth'],
  ['다둥이', 'multichild'],
  ['다자녀', 'multichild'],
  ['수급자', 'basic_livelihood'],
  ['한부모', 'single_parent'],
  ['장애인', 'disability'],
]
const CAVEAT_DATA_NOTES = ['quote', '오기', '기록하지 않음']

export function publicFeeRegion(sigunguCd: string | undefined | null): RawRegion | null {
  if (!sigunguCd) return null
  return DATA.regions.find((r) => r.sigungu_cd === sigunguCd) ?? null
}

export function publicFeeCurated(region: RawRegion | null): string | null {
  if (!region) return null
  const when = region.law?.effective || DATA.checked
  return when ? `공식 확인(조례 ${when})` : '공식 확인(조례)'
}

export function parseYouthAges(text: string | undefined): [number, number][] {
  const out: [number, number][] = []
  for (const part of (text ?? '').split(/[,，;]/)) {
    if (!part.includes('어린이') && !part.includes('청소년')) continue
    for (const m of part.matchAll(/(\d+)\s*세?\s*~\s*(\d+)\s*세/g)) out.push([Number(m[1]), Number(m[2])])
    for (const m of part.matchAll(/(?:^|[^~\d])(\d+)\s*세\s*이하/g)) out.push([0, Number(m[1])])
  }
  return out
}

function youthRanges(r: RawReduction, region: RawRegion): [number, number][] {
  const own = parseYouthAges(r.age_definition)
  if (own.length) return own
  if (r.age_definition) return []
  for (const x of region.reductions) {
    if (x.target !== 'youth') continue
    const rng = parseYouthAges(x.age_definition)
    if (rng.length) return rng
  }
  return []
}

function row(r: RawReduction, caveat?: string): FeeReduction {
  const out: FeeReduction = {
    target: r.target as FeeTarget,
    label: r.label,
    rate: r.rate,
    condition: r.condition || null,
    quote: r.quote,
    source_url: r.source_url,
  }
  if (r.age_definition) out.age_definition = r.age_definition
  if (caveat) out.caveat = caveat
  return out
}

export interface FeePerson {
  age: number
  income_class: IncomeClass
  special?: string[]
  disability_has: boolean
}

export function publicFeeBlock(region: RawRegion | null, person: FeePerson): Partial<AltEdge> | null {
  if (!region) return null
  const special = new Set(person.special ?? [])
  const seoul = region.sido.startsWith('서울')
  const wanted: FeeTarget[] = []
  if (person.income_class === '기초생활수급') wanted.push('basic_livelihood')
  else if (person.income_class === '차상위') wanted.push('near_poor')
  else if (person.income_class === '한부모') wanted.push('single_parent')
  if (special.has('multichild')) wanted.push('multichild')
  if (special.has('defector')) wanted.push('defector')
  if (person.disability_has) wanted.push('disability')

  const matched: FeeReduction[] = []
  const matchedTargets = new Set<FeeTarget>()
  let youthUnclear = false
  for (const r of region.reductions) {
    if (r.target !== 'youth') continue
    const ranges = youthRanges(r, region)
    if (ranges.length) {
      if (ranges.some(([lo, hi]) => lo <= person.age && person.age <= hi)) matched.push(row(r))
    } else if (person.age <= YOUTH_FALLBACK_MAX) {
      youthUnclear = true
      matched.push(row(r, YOUTH_UNCLEAR_CAVEAT))
    }
  }
  if (matched.some((m) => m.target === 'youth')) matchedTargets.add('youth')

  for (const target of wanted) {
    let rows = region.reductions.filter((r) => r.target === target)
    if (target === 'multichild' && rows.length) {
      const three = rows.filter((r) => ['3자녀', '세 자녀'].some((k) => r.label.includes(k)))
      if (three.length) rows = three
    }
    for (const r of rows) matched.push(row(r, target === 'multichild' && seoul ? SEOUL_MULTICHILD_CAVEAT : undefined))
    if (rows.length) matchedTargets.add(target)
  }

  const noReductionFor = wanted
    .filter((t) => !matchedTargets.has(t) && GAP_LABEL[t])
    .map((t) => GAP_LABEL[t] as string)

  const caveats: string[] = []
  for (const text of region.unverified ?? []) {
    if (CAVEAT_DATA_NOTES.some((k) => text.includes(k))) continue
    let targets = new Set(CAVEAT_KEYWORDS.filter(([k]) => text.includes(k)).map(([, t]) => t))
    if (targets.has('multichild')) targets = new Set<FeeTarget>(['multichild'])
    if (targets.size && ![...targets].some((t) => matchedTargets.has(t))) continue
    caveats.push(text)
  }
  if (youthUnclear && !caveats.some((c) => c.includes('나이'))) caveats.unshift(YOUTH_UNCLEAR_CAVEAT)
  if (new Set(matched.map((m) => m.target)).size >= 2) {
    const hasRule = region.reductions.some(
      (r) => r.target === 'other' && [r.label, r.condition, r.quote].join(' ').includes('중복'),
    )
    if (hasRule) caveats.push('감면 사유가 둘 이상이면 가장 높은 감면율 하나만 적용(조례)')
  }

  return {
    region: { sigungu_cd: region.sigungu_cd, sigungu_nm: region.sigungu_nm, sido: region.sido },
    law: {
      title: region.law.title,
      article: region.law.article,
      url: region.law.url,
      effective: region.law.effective ?? null,
    },
    operator: { name: region.operator?.name ?? '', url: region.operator?.url || null },
    scope: region.scope,
    checked: DATA.checked,
    reductions: matched,
    no_reduction_for: noReductionFor,
    caveats,
  }
}
