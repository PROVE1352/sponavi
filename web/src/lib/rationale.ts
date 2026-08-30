// 처방 항목의 "왜 이 운동인가"를 문장으로 만든다(순수 함수 — DOM·React 없음).
//
// 배경: 항목별 근거 블록은 결과 카드에서 걷어냈다(2026-08-30 사용자 결정 — 카드가 길어져
// 정작 처방이 안 읽혔다). 대신 "근거는 채팅으로 물어보면 나온다"가 새 약속이고,
// 그 문장을 만드는 곳이 여기다. 라벨 사전은 결과 카드의 근거 표기와 **같은 것을 쓴다** —
// 두 표면이 같은 엣지를 두고 다른 말을 하면 그 자체가 신뢰 문제다(P-1).

import type { AiPrescription, Provenance } from '../types'

// FITT(강도·주당빈도) 수치의 출처. 항목마다 반복하지 않고 발화 끝에 한 번만 적는다 —
// 처방 전체가 같은 지침을 인용하므로 항목별로 붙이면 같은 문장이 4번 나온다.
export const FITT_SOURCE = 'FITT 수치: 정부·국제 지침(보건복지부 2023 · WHO 2020 · ACSM)'

// 근거가 없는 항목(레거시 fitness_map 폴백). 지어내지 않고 없다고 말한다(P-1).
export const NO_EVIDENCE = '근거 정보 없음 — 연결된 그래프 근거를 확인할 수 없습니다'

// 엣지 출처 → 사람이 읽는 근거 라벨(FITNESS_GRAPH §2.3 · 카피 사전 고정 문구).
export function sourceLabel(prov?: Provenance | null): string | null {
  if (!prov) return null
  switch (prov.source) {
    case 'kspo_standard':
      return '공단 공식 기준'
    case 'guideline':
      return '정부·국제 지침'
    case 'kspo_video':
      return '공단 콘텐츠'
    case 'curated':
      return prov.curated_status === 'pending' ? '전문가 큐레이션(검증 중)' : '전문가 큐레이션'
    default:
      return '참고'
  }
}

// 멀티홉 표기(FITNESS_GRAPH §3.5): "via {goal}" 대신 한국어로.
export function viaGoalLabel(prov?: Provenance | null): string | null {
  return prov?.via_goal ? `${prov.via_goal} 목적 경유` : null
}

// 근거 경로 — 어느 약점에서 이 운동으로 이어졌는가.
// 목적을 경유한 멀티홉이면 그 홉까지 적고, 경로 등급이 약한 쪽이라는 사실도 함께 밝힌다
// (서버가 이미 약한 쪽으로 내려 잡아 보낸다 — 화면은 그 사실을 바꾸지 않고 설명만 한다).
export function evidencePath(rx: AiPrescription): string {
  const factor = (rx.목표체력요인 ?? '').trim()
  const name = (rx.운동 ?? '').trim()
  const via = rx.provenance?.via_goal?.trim()
  const head = `근거 경로: 약점 ${factor} ← `
  return via ? `${head}${via} 목적 운동 ← ${name} (두 홉 중 약한 쪽 등급)` : `${head}${name}`
}

// 항목 하나의 근거 문장(경로 + 출처). 근거가 없으면 없다고만 말한다.
export function rationaleOf(rx: AiPrescription): string {
  const label = sourceLabel(rx.provenance)
  if (!label) return NO_EVIDENCE
  return `${evidencePath(rx)} · 출처: ${label}`
}

// 발화에 들어갈 줄 목록. 같은 운동이 여러 약점에 중복 추천되면 한 번만 적는다.
export function rationaleLines(list: AiPrescription[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const rx of list) {
    const line = `${(rx.운동 ?? '').trim()} — ${rationaleOf(rx)}`
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}
