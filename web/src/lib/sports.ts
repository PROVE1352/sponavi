// 종목 필터 매칭 1벌(결정 2A). NearbyList·FitnessResult 가 각자 갖고 있던 두 벌을 여기로 합친다.
//
// ★ 별칭 표(헬스 ↔ 체력단련장(업) 등)는 여기 없다 — 서버가 data/sport_alias.json 으로
//   `facility_filter_sports` 를 이미 확장해 내려보낸다. 웹은 정확 일치만 본다(P-2: 판단은 엔진).
export function matchesFilter(sports: string[], filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true
  return sports.some((s) => filter.includes(s))
}

// C-4(P-1): "근처 N곳"을 종목 필터 뒤 부분집합인 채로 던져두면, 옆 패널의 전체 카운트
// ("공공·대안 M곳")와 나란히 놓였을 때 두 숫자가 서로를 반박하는 것처럼 읽힌다.
// 부분집합이라는 사실을 숫자 옆에 함께 적어 관계가 보이게 한다.
export interface NearbyMatchCount {
  matched: number // 종목 필터를 통과한 시설 수
  total: number // 필터 이전 근처 자원 전체(가맹 + 공공·대안)
}

export function countMatching(
  facilities: { sports: string[] }[],
  filter?: string[],
): NearbyMatchCount {
  return {
    matched: facilities.filter((f) => matchesFilter(f.sports, filter)).length,
    total: facilities.length,
  }
}

// 카피 사전 고정 문구. 부분/전체를 한 줄에 붙여 쓴다 —
// 전체와 같으면 굳이 두 번 말하지 않는다(필터가 아무것도 걸러내지 않은 경우).
export function nearbyMatchText(c: NearbyMatchCount): string {
  if (c.matched === c.total) return `근처 ${c.total}곳`
  return `이 종목 근처 ${c.matched}곳 · 전체 ${c.total}곳`
}

// 풀 카운트 배지("공공·대안 6곳" 등). 필터가 실제로 뭔가를 걸러냈을 때만 부분 수를 덧붙인다 —
// 필터 걸린 목록 위에 전체 수만 떠 있으면 목록과 배지가 서로 반박하는 것처럼 읽힌다(C-4).
export function poolCountText(label: string, c: NearbyMatchCount): string {
  if (c.matched === c.total) return `${label} ${c.total}곳`
  return `${label} ${c.total}곳 · 이 종목 ${c.matched}곳`
}
