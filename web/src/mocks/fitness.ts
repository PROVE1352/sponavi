// 체력 처방 목-모드 데이터. 서버 계약(공식 경로) 형태를 그대로 재현해
// 목모드에서 전체 플로우(항목 카탈로그 → 판정 → 그래프 추천 → AI 처방)를 시연한다.
// ⚠️ 데모 근사값이다. 실 판정 정본은 server(국민체력100 공식 컷 + 지식그래프).

import type {
  FitnessAiResponse,
  FitnessItem,
  FitnessItemsResponse,
  FitnessRecommendation,
  FitnessRequest,
  FitnessResponse,
  GraphNamed,
  GraphVideo,
  Provenance,
  Weakness,
} from '../types'

// 1x1 회색 썸네일(오프라인 프리뷰에서도 깨지지 않게 self-contained data URI).
const THUMB =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="%23cbd5e1"/><text x="80" y="50" font-size="12" fill="%23475569" text-anchor="middle">KSPO</text></svg>'

function hint(hb: number | null): string {
  if (hb === 0) return '낮을수록 좋음(시간 단축)'
  if (hb === null) return '건강범위 충족(신체조성)'
  return '높을수록 좋음'
}

interface RawItem {
  code: string
  name: string
  unit: string | null
  factor: string
  alt_group: string | null
  higher_better: number | null
}

const ADULT: RawItem[] = [
  { code: 'grip_rel', name: '상대악력', unit: '%', factor: '근력', alt_group: null, higher_better: 1 },
  { code: 'crunch_cross', name: '교차윗몸 일으키기', unit: '회', factor: '근지구력', alt_group: null, higher_better: 1 },
  { code: 'reaction_time', name: '반응시간', unit: '초', factor: '민첩성', alt_group: '민첩성_10m반응', higher_better: 0 },
  { code: 'shuttle_10m_run', name: '10m 왕복 달리기', unit: '초', factor: '민첩성', alt_group: '민첩성_10m반응', higher_better: 0 },
  { code: 'air_time', name: '체공시간', unit: '초', factor: '순발력', alt_group: '순발력_멀리뛰기체공', higher_better: 1 },
  { code: 'standing_jump', name: '제자리 멀리뛰기', unit: 'cm', factor: '순발력', alt_group: '순발력_멀리뛰기체공', higher_better: 1 },
  { code: 'bmi', name: 'BMI', unit: '㎏/㎡', factor: '신체조성', alt_group: null, higher_better: null },
  { code: 'body_fat', name: '체지방률', unit: '%', factor: '신체조성', alt_group: null, higher_better: null },
  { code: 'shuttle_20m', name: '20m 왕복 오래달리기', unit: '회', factor: '심폐지구력', alt_group: '심폐_왕복스텝', higher_better: 1 },
  { code: 'treadmill_step', name: '트레드밀/스텝검사', unit: 'ml/kg/min', factor: '심폐지구력', alt_group: '심폐_왕복스텝', higher_better: 1 },
  { code: 'sit_reach', name: '앉아윗몸 앞으로 굽히기', unit: 'cm', factor: '유연성', alt_group: null, higher_better: 1 },
]

const SENIOR: RawItem[] = [
  { code: 'grip_rel', name: '상대악력', unit: '%', factor: '근력', alt_group: null, higher_better: 1 },
  { code: 'chair_stand', name: '의자에 앉았다 일어서기', unit: '30초/회', factor: '근지구력', alt_group: null, higher_better: 1 },
  { code: 'walk_2min', name: '2분 제자리 걷기', unit: '회', factor: '심폐지구력', alt_group: '심폐_걷기', higher_better: 1 },
  { code: 'walk_6min', name: '6분 걷기', unit: 'm', factor: '심폐지구력', alt_group: '심폐_걷기', higher_better: 1 },
  { code: 'sit_reach', name: '앉아윗몸 앞으로 굽히기', unit: 'cm', factor: '유연성', alt_group: null, higher_better: 1 },
  { code: 'agility_3m', name: '3m 왕복 걷기', unit: '초', factor: '평형성', alt_group: null, higher_better: 0 },
  { code: 'fig8_walk', name: '8자보행', unit: '초', factor: '협응력', alt_group: null, higher_better: 0 },
]

const YOUTH: RawItem[] = [
  { code: 'grip_rel', name: '상대악력', unit: '%', factor: '근력', alt_group: null, higher_better: 1 },
  { code: 'situp_roll', name: '윗몸말아올리기', unit: '회', factor: '근지구력', alt_group: '근지구력_윗몸반복점프', higher_better: 1 },
  { code: 'side_step', name: '반복 옆뛰기', unit: '회', factor: '민첩성', alt_group: null, higher_better: 1 },
  { code: 'standing_jump', name: '제자리 멀리뛰기', unit: 'cm', factor: '순발력', alt_group: null, higher_better: 1 },
  { code: 'bmi', name: 'BMI', unit: '㎏/㎡', factor: '신체조성', alt_group: null, higher_better: null },
  { code: 'shuttle_15m', name: '15m 왕복 오래달리기', unit: '회', factor: '심폐지구력', alt_group: null, higher_better: 1 },
  { code: 'sit_reach', name: '앉아윗몸 앞으로 굽히기', unit: 'cm', factor: '유연성', alt_group: null, higher_better: 1 },
  { code: 'eyehand_cnt', name: '눈-손 협응력 검사', unit: '회', factor: '협응력', alt_group: null, higher_better: 1 },
]

const TEEN: RawItem[] = [
  { code: 'grip_rel', name: '상대악력', unit: '%', factor: '근력', alt_group: null, higher_better: 1 },
  { code: 'situp_roll', name: '윗몸말아올리기', unit: '회', factor: '근지구력', alt_group: '근지구력_윗몸반복점프', higher_better: 1 },
  { code: 'repeat_jump', name: '반복점프', unit: '회', factor: '근지구력', alt_group: '근지구력_윗몸반복점프', higher_better: 1 },
  { code: 'illinois', name: '일리노이 검사', unit: '초', factor: '민첩성', alt_group: null, higher_better: 0 },
  { code: 'air_time', name: '체공시간', unit: '초', factor: '순발력', alt_group: null, higher_better: 1 },
  { code: 'bmi', name: 'BMI', unit: '㎏/㎡', factor: '신체조성', alt_group: null, higher_better: null },
  { code: 'shuttle_20m', name: '20m 왕복 오래달리기', unit: '회', factor: '심폐지구력', alt_group: '심폐_왕복스텝', higher_better: 1 },
  { code: 'treadmill_step', name: '트레드밀/스텝검사', unit: 'ml/kg/min', factor: '심폐지구력', alt_group: '심폐_왕복스텝', higher_better: 1 },
  { code: 'sit_reach', name: '앉아윗몸 앞으로 굽히기', unit: 'cm', factor: '유연성', alt_group: null, higher_better: 1 },
  { code: 'eyehand_sec', name: '눈-손 협응력 검사', unit: '초', factor: '협응력', alt_group: null, higher_better: 0 },
]

function groupOf(age: number): '유아' | 'gap' | '유소년' | '청소년' | '성인' | '어르신' {
  if (age <= 6) return '유아'
  if (age <= 10) return 'gap'
  if (age <= 12) return '유소년'
  if (age <= 18) return '청소년'
  if (age <= 64) return '성인'
  return '어르신'
}

function catalogFor(age: number): RawItem[] {
  const g = groupOf(age)
  if (g === '유아') return []
  if (g === 'gap' || g === '유소년') return YOUTH
  if (g === '청소년') return TEEN
  if (g === '어르신') return SENIOR
  return ADULT
}

const GROUP_LABEL: Record<string, string> = {
  유아: '유아기', gap: '만7~10(공백)', 유소년: '유소년', 청소년: '청소년', 성인: '성인', 어르신: '어르신',
}

export function mockFitnessItems(age: number): FitnessItemsResponse {
  const g = groupOf(age)
  const raw = catalogFor(age)
  const items: FitnessItem[] = raw.map((it) => ({
    code: it.code, name: it.name, unit: it.unit, factor: it.factor,
    alt_group: it.alt_group, higher_better: it.higher_better, hint: hint(it.higher_better),
  }))
  const resp: FitnessItemsResponse = {
    age,
    age_group: GROUP_LABEL[g] ?? g,
    age_gap: g === 'gap',
    basis: '국민체력100 공식 인증기준(문체부 고시 체계)',
    items,
  }
  if (g === 'gap') resp.message = '만 7~10세는 국민체력100 공식 기준이 없어 유소년(11~12세) 항목을 참고로 제공합니다.'
  else if (g === '유아') resp.message = '유아기(만4~6)는 4단계 비인증 기준으로, 등급 판정 항목이 없습니다.'
  return resp
}

// 데모 3등급 근사 컷(코드→컷값). 신체조성(hb=null)은 판정 생략.
const DEMO_CUT: Record<string, number> = {
  grip_rel: 45, crunch_cross: 35, reaction_time: 0.35, shuttle_10m_run: 11,
  air_time: 0.5, standing_jump: 190, shuttle_20m: 35, treadmill_step: 35, sit_reach: 8,
  chair_stand: 18, walk_2min: 90, walk_6min: 500, agility_3m: 8, fig8_walk: 22,
  situp_roll: 30, side_step: 40, shuttle_15m: 50, eyehand_cnt: 15,
  repeat_jump: 30, illinois: 18, eyehand_sec: 12,
}

// 그래프 추천 목(요인→운동·종목·영상 + provenance). 4개 출처 배지가 모두 등장하도록 구성.
function P(source: Provenance['source'], tier: Provenance['tier'], pending = false): Provenance {
  return { source, tier, weight: tier === 'S' ? 1 : 0.5, curated_status: pending ? 'pending' : null }
}
function ex(name: string, p: Provenance): GraphNamed {
  return { name, provenance: p }
}
function vid(title: string, aim?: string): GraphVideo {
  return { title, url: 'https://nfa.kspo.or.kr/', img_url: THUMB, trng_nm: title, provenance: { source: 'kspo_video', tier: 'V', ...(aim ? { aim } : {}) } }
}

const GRAPH: Record<string, { exercises: GraphNamed[]; sports: GraphNamed[]; videos: GraphVideo[] }> = {
  심폐지구력: {
    exercises: [ex('걷기', P('kspo_standard', 'S')), ex('조깅', P('kspo_standard', 'S')), ex('실내 자전거타기', P('kspo_video', 'V'))],
    sports: [ex('수영', P('kspo_standard', 'S')), ex('에어로빅', P('guideline', 'A')), ex('복싱', P('curated', 'B', true))],
    videos: [vid('스텝검사'), vid('걷기 운동')],
  },
  근력: {
    exercises: [ex('웨이트 트레이닝', P('kspo_standard', 'S')), ex('밴드 운동', P('kspo_video', 'V')), ex('코어 강화', P('curated', 'B', true))],
    sports: [ex('헬스', P('kspo_standard', 'S')), ex('클라이밍', P('curated', 'B', true))],
    videos: [vid('앉았다 일어서기'), vid('밴드 근력 운동')],
  },
  근지구력: {
    exercises: [ex('교차 윗몸 일으키기', P('kspo_video', 'V')), ex('자전거', P('kspo_standard', 'S')), ex('플랭크', P('curated', 'B', true))],
    sports: [ex('헬스', P('kspo_standard', 'S')), ex('유도', P('curated', 'B', true))],
    videos: [vid('교차 윗몸 일으키기'), vid('윗몸 말아 올리기')],
  },
  유연성: {
    exercises: [ex('스트레칭', P('kspo_standard', 'S')), ex('어깨 돌리기', P('kspo_video', 'V')), ex('요통 예방 운동', P('guideline', 'A'))],
    sports: [ex('요가', P('kspo_standard', 'S')), ex('필라테스', P('kspo_standard', 'S'))],
    videos: [vid('어깨 돌리기'), vid('요통 예방 운동', '요통 예방')],
  },
  민첩성: {
    exercises: [ex('사다리 드릴', P('guideline', 'A')), ex('방향전환 훈련', P('curated', 'B', true))],
    sports: [ex('배드민턴', P('curated', 'B', true)), ex('탁구', P('curated', 'B', true))],
    videos: [vid('반복 옆뛰기')],
  },
  순발력: {
    exercises: [ex('점프 스쿼트', P('guideline', 'A')), ex('제자리 멀리뛰기', P('kspo_video', 'V'))],
    sports: [ex('태권도', P('curated', 'B', true))],
    videos: [vid('제자리 멀리뛰기')],
  },
  협응력: {
    exercises: [ex('손 뼉치기 스텝', P('kspo_video', 'V')), ex('줄넘기', P('kspo_video', 'V'))],
    sports: [ex('탁구', P('curated', 'B', true)), ex('배드민턴', P('curated', 'B', true))],
    videos: [vid('협응 스텝')],
  },
  평형성: {
    exercises: [ex('한 발 서기', P('kspo_video', 'V')), ex('앉아 균형 잡기', P('guideline', 'A'))],
    sports: [ex('요가', P('guideline', 'A')), ex('승마', P('curated', 'B', true))],
    videos: [vid('낙상 예방 운동', '낙상 예방')],
  },
}

function comparison(name: string, value: number, unit: string | null, cut: number, hb: number | null): string {
  const u = unit ?? ''
  const tail = hb === 0 ? '초과' : '미달'
  return `${name} ${value}${u} — 3등급 컷 ${cut}${u} ${tail}`
}

export function mockFitness(req: FitnessRequest): FitnessResponse {
  const g = groupOf(req.age)
  const cat = catalogFor(req.age)
  const byCode = new Map(cat.map((c) => [c.code, c]))
  const measures = req.measures ?? {}

  const items: NonNullable<FitnessResponse['items']> = []
  const weaknesses: Weakness[] = []
  const measuredFactors = new Set<string>()
  const basis = '국민체력100 공식 인증기준(문체부 고시 체계)' + (g === 'gap' ? ' · 유소년(11~12) 기준 참고 적용(만7~10 공식 기준 없음)' : '')

  for (const [code, raw] of Object.entries(measures)) {
    const value = raw
    const it = byCode.get(code)
    if (value == null || !it) continue
    measuredFactors.add(it.factor)
    const cut = DEMO_CUT[code]
    let band = '측정 완료'
    let grade: number | null = 3
    if (it.higher_better === null) {
      band = '신체조성 참고'
      grade = null
    } else if (cut != null) {
      const pass = it.higher_better === 0 ? value <= cut : value >= cut
      band = pass ? '3등급 수준 이상' : '기준 미달'
      grade = pass ? 3 : null
      if (!pass) {
        weaknesses.push({
          item: it.factor,
          name: it.name,
          value,
          unit: it.unit,
          band: '기준 미달',
          cut,
          cut_grade: 3,
          comparison: comparison(it.name, value, it.unit, cut, it.higher_better),
          basis,
        })
      }
    }
    items.push({
      code, name: it.name, factor: it.factor, value, unit: it.unit,
      band, grade,
      comparison: grade === null && it.higher_better !== null
        ? comparison(it.name, value, it.unit, cut ?? 0, it.higher_better)
        : `${it.name} ${value}${it.unit ?? ''} — ${band}`,
      basis,
    })
  }

  // 약점 요인(중복 제거) → 그래프 추천
  const weakFactors: string[] = []
  for (const w of weaknesses) if (!weakFactors.includes(w.item)) weakFactors.push(w.item)

  const recommendations: FitnessRecommendation[] = []
  const recSports: string[] = []
  const videos: FitnessResponse['videos'] = []
  const seenVid = new Set<string>()
  for (const factor of weakFactors) {
    const block = GRAPH[factor]
    if (!block) continue
    recommendations.push({
      weakness: factor,
      exercises: block.exercises,
      sports: block.sports,
      videos: block.videos,
      source: 'graph',
    })
    for (const s of block.sports) if (!recSports.includes(s.name)) recSports.push(s.name)
    for (const v of block.videos) {
      const key = v.url ?? v.title
      if (key && !seenVid.has(key)) {
        seenVid.add(key)
        videos.push({ title: v.title, url: v.url, img_url: v.img_url, trng_nm: v.trng_nm, source: '국민체력100 운동영상(공단 콘텐츠)' })
      }
    }
  }

  // 참고 등급(추정) — 데모 파생
  const allFactors = Array.from(new Set(cat.map((c) => c.factor)))
  const missing = allFactors.filter((f) => !measuredFactors.has(f))
  const fail = weaknesses.length
  const grade = fail === 0 ? 2 : fail <= 1 ? 3 : fail <= 2 ? 4 : 5
  const reference_grade = items.length
    ? {
        grade,
        label: '참고 등급(추정)',
        rule: '건강체력 전항목 최저기준 통과제 + 운동체력 1개 통과, 4~6등급은 심폐·근력 파생',
        missing,
        note: '공식 등급은 전 항목 측정 시에만 확정됩니다. 입력된 항목만으로 추정한 참고값입니다.',
      }
    : null

  const resp: FitnessResponse = {
    age_group: GROUP_LABEL[g] ?? g,
    age_gap: g === 'gap',
    sex: req.sex,
    basis,
    items,
    weaknesses,
    reference_grade,
    recommendations,
    videos,
    facility_filter_sports: recSports,
  }
  if (g === 'gap') resp.message = '이 연령은 국민체력100 공식 기준이 없습니다. 유소년(11~12세) 기준을 참고로 제공합니다.'
  return resp
}

// FITT 수치사전(정부 지침) — 목 규칙 처방이 인용하는 값.
function fittFor(factor: string, group: string): { 강도: string; 주당빈도: string } {
  const aerobicAdult = '중강도 주 150~300분 또는 고강도 주 75~150분'
  const aerobicYouth = '매일 60분 이상 중·고강도 신체활동'
  const aerobic = group === '청소년' || group === '유소년' || group === '만7~10(공백)' ? aerobicYouth : aerobicAdult
  if (factor === '심폐지구력') return { 강도: aerobic, 주당빈도: '주 3~5회' }
  if (factor === '근력' || factor === '근지구력') return { 강도: '주요 근육군 · 8~12회 반복 2~3세트', 주당빈도: '주 2~3회' }
  if (factor === '유연성') return { 강도: '정적 스트레칭 30~60초 유지', 주당빈도: '주 3회 이상' }
  if (factor === '평형성') return { 강도: '낙상예방 평형·균형 운동', 주당빈도: '주 3일 이상' }
  return { 강도: '낮은 강도부터 점진적으로', 주당빈도: '주 2~3회' }
}

// AI(규칙 폴백) 처방 — 목모드는 provider="rules"(기본 규칙 처방).
export function mockFitnessAi(req: FitnessRequest): FitnessAiResponse {
  const f = mockFitness(req)
  const group = f.age_group ?? '성인'
  const 처방: FitnessAiResponse['처방'] = []
  for (const r of f.recommendations) {
    const fitt = fittFor(r.weakness, group)
    const exs = (r.exercises as GraphNamed[]).slice(0, 2)
    for (const e of exs) {
      처방.push({ 운동: e.name, 목표체력요인: r.weakness, 강도: fitt.강도, 주당빈도: fitt.주당빈도 })
    }
  }
  return {
    provider: 'rules',
    age_group: group,
    age_gap: f.age_gap,
    약점: f.weaknesses.map((w) => ({ 항목: w.name ?? w.item, 등급: w.band, 근거: w.comparison ?? w.band })),
    우선순위: f.weaknesses.map((w) => w.name ?? w.item),
    처방,
    주의: '운동 참고 정보이며 의료 조언이 아닙니다. 통증·질환이 있으면 전문가와 상담하세요.',
    facility_filter_sports: f.facility_filter_sports,
    disclaimer: '운동 참고 정보이며 의료 조언이 아닙니다. 통증·질환이 있으면 전문가와 상담하세요.',
  }
}

// 기본 샘플(위저드 나이 없을 때 client 폴백).
export const FITNESS_RESPONSE: FitnessResponse = mockFitness({
  age: 27, sex: 'M', measures: { sit_reach: -3, shuttle_20m: 25 },
})
