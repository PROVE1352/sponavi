// 경로 그림(PathDiagram) 대체경로 엣지의 확인 상태 표기 — 순수 함수(단위 테스트 대상).
//
// 서버 alt_edges.curated 는 두 갈래다(SPEC §0-3·§0-5, engine._curated_rank):
//   · "공식 확인(…)"  — 공식 원문(조례·공단 고시)으로 확인된 엣지. 확인 주체가 공식 원문이므로
//                      "전문가 큐레이션"이라고 부르면 거꾸로 약하게 말하는 셈이 된다.
//   · 그 밖("검증 대기" 등) — 사람이 검증하는 큐레이션 규칙 테이블. "전문가 큐레이션" 프레이밍.
// "AI 추론"이라는 말은 어느 쪽에도 쓰지 않는다(§0-3).

export interface CuratedLabel {
  official: boolean
  text: string
}

export const OFFICIAL_PREFIX = '공식 확인'

export function curatedLabel(curated: string | null | undefined): CuratedLabel | null {
  const c = (curated ?? '').trim()
  if (c === '') return null
  if (c.startsWith(OFFICIAL_PREFIX)) return { official: true, text: c }
  return { official: false, text: `전문가 큐레이션 · ${c}` }
}

// 엣지 칸 폭 등급 — 긴 엣지 설명(대체경로 note)·확인 표기가 좁은 칸에 갇히면
// 글자 단위로 줄이 바뀌어 읽을 수 없다(2026-09-28 보고서 스샷).
//   wide   : 확인 표기가 붙는 대체경로 엣지 또는 아주 긴 설명(> 24자)
//   medium : 한 줄로는 안 들어가는 보통 설명(> 10자 — "나이>기준 / 소득>기준", 시설명 · 거리)
//   narrow : 짧은 설명("예상 자격 충족" 등)
export type EdgeWidth = 'wide' | 'medium' | 'narrow'
export const WIDE_EDGE_LABEL_CHARS = 24
export const MEDIUM_EDGE_LABEL_CHARS = 10

export function edgeWidth(label: string, curated?: string | null): EdgeWidth {
  if (Boolean(curated && curated.trim()) || label.length > WIDE_EDGE_LABEL_CHARS) return 'wide'
  if (label.length > MEDIUM_EDGE_LABEL_CHARS) return 'medium'
  return 'narrow'
}
