// 종목 필터 매칭 1벌(결정 2A). NearbyList·FitnessResult 가 각자 갖고 있던 두 벌을 여기로 합친다.
//
// ★ 별칭 표(헬스 ↔ 체력단련장(업) 등)는 여기 없다 — 서버가 data/sport_alias.json 으로
//   `facility_filter_sports` 를 이미 확장해 내려보낸다. 웹은 정확 일치만 본다(P-2: 판단은 엔진).
export function matchesFilter(sports: string[], filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true
  return sports.some((s) => filter.includes(s))
}
