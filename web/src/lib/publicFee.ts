// 공공체육시설 조례 감면 표기 헬퍼(순수 함수) — 히어로 public_program 행의 한 줄 요약.
// 예: "성북구 구립 체육시설 · 청소년 20% · 3자녀 이상 50%". 원문 율·라벨은 서버가 준 그대로이고,
// 여기선 '짧게 부르는 법'만 정한다(새 수치를 만들지 않는다).
import type { AltEdge, FeeReduction } from '../types'

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

function feeShortLabel(r: FeeReduction): string {
  switch (r.target) {
    case 'youth':
      if (r.label.includes('청소년') || r.label.includes('어린이')) {
        return r.label.includes('단체') ? '청소년 단체' : '청소년'
      }
      return r.label
    case 'multichild':
      if (/3자녀|세 자녀/.test(r.label)) return '3자녀 이상'
      if (/2자녀|두 자녀/.test(r.label)) return '2자녀'
      return '다둥이카드'
    case 'disability':
      return '장애인'
    case 'basic_livelihood':
      return '기초수급'
    case 'single_parent':
      return '한부모'
    default:
      return r.label
  }
}

function feeShortRate(rate: string): string {
  const head = rate.split('(')[0].trim()
  if (head.length <= 14) return head
  return head.match(/\d+(?:~\d+)?%/)?.[0] ?? '요금 차등'
}

export function feeSummaryParts(reductions: FeeReduction[]): string[] {
  return uniq(
    reductions.map((r) =>
      // '청소년 30%, 어린이 50%' 처럼 율 안에 대상이 이미 있으면 율만 쓴다.
      /청소년|어린이/.test(r.rate) ? r.rate : `${feeShortLabel(r)} ${feeShortRate(r.rate)}`,
    ),
  )
}

export function feeSummaryLine(a: AltEdge): string | null {
  if (!a.region || !a.reductions) return null
  const kind = a.region.sigungu_nm.endsWith('군') ? '군립' : '구립'
  const parts = feeSummaryParts(a.reductions)
  return [`${a.region.sigungu_nm} ${kind} 체육시설`, ...(parts.length ? parts : ['해당 감면 없음 · 일반 요금'])].join(
    ' · ',
  )
}

