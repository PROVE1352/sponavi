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

// ── 종목 이름 요약(2026-09-28) ──────────────────────────────────────────
// facility_filter_sports 는 추천 원문 + 시설 데이터 표기(별칭)를 이어 붙인 목록이라
// "헬스 · 유도 · 주짓수 · 체력단련장 · 체력단련장업 · 기타체육시설(체력단련장) · 투기체육관"처럼
// 같은 시설 종류가 표기만 달리 여러 번 나온다. 화면 문구에서는
//   ① 표기 변형을 하나로 접고(체력단련장업·기타체육시설(체력단련장) → 체력단련장)
//   ② 앞에서 최대 3개 + "외 N"으로 줄인다(서버가 추천 원문을 앞에 두므로 앞 3개가 추천 종목).
// 필터 자체(매칭)는 원래 목록 그대로 쓴다 — 여기는 표시 전용이다.

// 표기 변형 → 대표 이름. 뜻이 같은 것만 접는다(헬스↔체력단련장 같은 별칭은 서버 소관이라 건드리지 않는다).
export function canonicalSportName(s: string): string {
  let t = s.trim()
  // "기타체육시설(체력단련장)" → "체력단련장" (원천의 '기타 분류 + 괄호 세부종류' 표기)
  const m = /^기타체육시설\((.+)\)$/.exec(t)
  if (m) t = m[1].trim()
  // "체력단련장업"·"수영장업"·"무도학원업" → 업종 접미사 '업' 제거(시설 종류는 같다)
  if (t.length > 2 && /(장|원|관|설)업$/.test(t)) t = t.slice(0, -1)
  // "체력단련장(업)" 표기도 같은 것
  t = t.replace(/\(업\)$/, '')
  return t
}

export function dedupeSportNames(sports: string[]): string[] {
  const out: string[] = []
  for (const s of sports) {
    const c = canonicalSportName(s)
    if (c !== '' && !out.includes(c)) out.push(c)
  }
  return out
}

export interface SportSummary {
  shown: string[] // 화면에 적는 이름(최대 max개)
  rest: number // 나머지 개수("외 N")
  all: string[] // 접은 뒤 전체(title·펼침 목록용)
  text: string // "헬스 · 유도 · 주짓수 외 2"
}

export const SPORT_SUMMARY_MAX = 3

export function summarizeSports(
  sports: string[],
  max: number = SPORT_SUMMARY_MAX,
  sep: string = ' · ',
): SportSummary {
  const all = dedupeSportNames(sports)
  const shown = all.slice(0, max)
  const rest = all.length - shown.length
  const text = shown.join(sep) + (rest > 0 ? ` 외 ${rest}` : '')
  return { shown, rest, all, text }
}

// ── 공공·대안 풀 라벨(2026-09-28, P5 모순) ─────────────────────────────
// 장애가 있는 사용자의 공공·대안 목록은 서버가 원천 데이터에 '장애' 표기가 있는 공공체육시설만
// 남긴다(engine._alternatives disability_filter). 그 사실을 빼고 "공공·대안 0곳"이라고만 쓰면,
// 바로 위 히어로의 "공공체육시설 프로그램(구립 체육시설 · 장애인 감면)"과 서로 반박하는 것처럼
// 읽힌다(P-1). 숫자 옆에 어떤 기준으로 센 수인지를 함께 적는다.
export const ALT_POOL_LABEL = '공공·대안'
export const ALT_POOL_LABEL_DISABILITY = '장애인 표기 공공·대안'

export function altPoolLabel(disabilityFiltered: boolean): string {
  return disabilityFiltered ? ALT_POOL_LABEL_DISABILITY : ALT_POOL_LABEL
}
