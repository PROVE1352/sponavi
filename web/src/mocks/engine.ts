// 목-모드에서 데모 페르소나가 아닌 임의 위저드 입력도 완전 동작하도록 하는 경량 규칙 엔진.
// 계약(docs/API.md) 형태의 AssessResponse/FitnessResponse 를 fixtures 로부터 합성한다.
// ⚠️ 자격 규칙은 데모 근사다. 최종 진실은 server/rules.json (SPEC §3, §0-5). verified 플래그로 구분.

import type {
  AltEdge,
  AlternativeFacility,
  AssessRequest,
  AssessResponse,
  IncomeClass,
  NextYear,
  PathEdge,
  ProgramEligibility,
  Selection,
  VoucherFacility,
} from '../types'
import {
  CLASS_LABEL,
  COURSES,
  COVERAGE_ROWS,
  FACILITIES,
  SIGUNGU,
  distKm,
  type RawFacility,
} from './fixtures'
import NEXT_YEAR_JSON from './contract/next_year.json'
import { publicFeeBlock, publicFeeCurated, publicFeeRegion } from './publicFee'

const SVOUCHER_SUBSIDY = 105000
const DVOUCHER_SUBSIDY = 110000
const INCOME_OK: IncomeClass[] = ['기초생활수급', '차상위', '한부모']

// ---- 예상 선정순위(dvoucher) — 결정론. data/rules.json selection_priority 근사 ----
const SELECTION_NOTE = '선정은 우선순위제 — 지자체 예산·경쟁에 따라 대기 가능'
const SELECTION_TIEBREAK =
  '우선선정: 과거 누적 24개월 미만 이용자 → 동일 기준 내 기초생활수급 가구 → 기타 동일 자격은 시군구 자율 선정'
const SELECTION_SOURCE = {
  url: 'https://dvoucher.kspo.or.kr/dvoucher/main/contents.do?menuNo=800011&topMenuNo=800010',
  checked: '2026-07-21',
  note: '공식 선정순위 5단계',
}

function selectionCategory(income: IncomeClass): '수급' | '차상위·한부모' | '비저소득' | null {
  if (income === '기초생활수급') return '수급'
  if (income === '차상위' || income === '한부모') return '차상위·한부모'
  if (income === '그외') return '비저소득'
  return null
}

function selectionRank(age: number, category: ReturnType<typeof selectionCategory>): number | null {
  if (category === null) return null
  const youth = age >= 5 && age <= 18
  if (youth) return category === '비저소득' ? 4 : 1
  if (category === '수급') return 2
  if (category === '차상위·한부모') return 3
  return 5
}

function buildSelection(age: number, income: IncomeClass): Selection {
  const category = selectionCategory(income)
  const rank = selectionRank(age, category)
  const rankLabel =
    rank == null || category == null
      ? '소득 구분 확인 후 안내 — 수급·차상위·한부모 해당 여부를 주민센터·복지로에서 확인하세요'
      : `예상 ${rank}순위(${age >= 5 && age <= 18 ? '유청소년' : '성인'}·${category})`
  return { expected_rank: rank, rank_label: rankLabel, note: SELECTION_NOTE, tiebreak: SELECTION_TIEBREAK, source: SELECTION_SOURCE }
}

// ---- 복수 대체경로(alt_edges) — 목적지 제도 메타(data/rules.json 요약) ----
// rules.json public_program.benefit 과 같은 문구 — '무료/저가'로 단정하지 않는다.
export const PUBLIC_BENEFIT =
  '지자체 공공체육시설 이용료 — 감면 기준은 시군구 조례마다 달라요(청소년·수급자·장애인·다자녀 등). 이용 자격 제한은 없음.'
const OFFICIAL = '공식 확인(2026-07-21)'
const PENDING = '검증 대기'
const ALT_PROG = {
  public_program: { id: 'public_program', name: '공공체육시설 프로그램', benefit: PUBLIC_BENEFIT, apply_url: 'https://www.kspo.or.kr' },
  tteuntteun: { id: 'tteuntteun', name: '튼튼머니(스포츠활동 인센티브)', benefit: '만 4세+ 누구나 · 소득 무관 · 연 최대 5만 포인트 적립', apply_url: 'https://nfa.kspo.or.kr/spoint/selectSpointIntro.kspo' },
  culture_deduction: { id: 'culture_deduction', name: '체육시설 문화비 소득공제', benefit: '헬스장·수영장 이용료 30% 소득공제(총급여 7천만원 이하 근로소득자)', apply_url: 'https://www.culture.go.kr/deduction' },
  senior_voucher: { id: 'senior_voucher', name: '어르신 스포츠 상품권', benefit: '기초연금 수급 65세+ · 상품권 최대 15만원(제로페이 스포츠시설)', apply_url: 'https://ssvoucher.co.kr' },
  senior_free_class: { id: 'senior_free_class', name: '어르신 스포츠강좌 프로그램(무료 강좌)', benefit: '65세+ 누구나 · 소득 무관 무료 강좌', apply_url: 'https://www.mcst.go.kr' },
}

// 대상 제도 자체의 연령 범위(서버 engine._program_age_ok 와 같은 규칙, rules.json age_min/max).
// 대체경로도 '그 제도의 대상'일 때만 안내한다 — 16세에게 근로소득자용 소득공제 ✗.
const ALT_AGE: Record<string, [number | null, number | null]> = {
  public_program: [0, 200],
  tteuntteun: [4, null],
  culture_deduction: [19, null],
  senior_voucher: [65, null],
  senior_free_class: [65, null],
}

function altAgeOk(to: string, age: number): boolean {
  const [min, max] = ALT_AGE[to] ?? [null, null]
  return (min == null || age >= min) && (max == null || age <= max)
}

const isOfficial = (e: AltEdge) => e.curated.startsWith('공식 확인')

// 서버 _matching_alt_edges + _collect_alt_edges 미러: 연령 게이트 → public_program 조례 승격
// (조례 확인 지역만) → '공식 확인' 먼저(안정 정렬).
function buildAltEdges(o: {
  disabled: boolean
  eligible: boolean
  ageOk: boolean
  incomeOk: boolean
  rank: number | null
  age: number
  req: AssessRequest
}): AltEdge[] {
  const region = publicFeeRegion(o.req.sigungu_cd)
  const promoted = publicFeeCurated(region)
  const edges = buildAltEdgesUngated(o)
    .filter((e) => altAgeOk(e.to, o.age))
    .map((e) => {
      if (e.to !== 'public_program' || !promoted) return e
      const block = publicFeeBlock(region, {
        age: o.req.age,
        income_class: o.req.income_class,
        special: o.req.special ?? [],
        disability_has: o.req.disability.has,
      })
      return { ...e, curated: isOfficial(e) ? e.curated : promoted, ...block }
    })
  return [...edges.filter(isOfficial), ...edges.filter((e) => !isOfficial(e))]
}

// 경로 그림에서 시설 홉을 이을 수 있는 대체 제도(장소 기반). 서버 _PLACE_BASED_PROGRAMS 와 같다.
const PLACE_BASED = new Set(['public_program'])

// ---- 내년(2027) 예산안 확대 대상 — 서버 engine._next_year 미러 ----
// 정적 필드는 contract/next_year.json(= rules.json svoucher.next_year 사본, parity 테스트로 동기).
// 목 fixtures 는 서울 25구뿐이라 인구감소지역은 매칭되지 않는다(서울엔 지정 지역이 없다).
function buildNextYear(special: string[]): NextYear & { age_assumed: boolean; age_note: string } {
  const matched: NextYear['matched'] = []
  const possibleIf: string[] = []
  for (const cat of NEXT_YEAR_JSON.added_categories) {
    if (cat.id !== 'depop_region' && special.includes(cat.id)) {
      matched.push({ id: cat.id, label: cat.label, detail: `${cat.label} — 본인 응답` })
    } else {
      possibleIf.push(cat.label)
    }
  }
  return {
    year: NEXT_YEAR_JSON.year,
    basis: NEXT_YEAR_JSON.basis,
    eligible: matched.length > 0,
    matched,
    possible_if: possibleIf,
    note: NEXT_YEAR_JSON.note,
    age_assumed: NEXT_YEAR_JSON.age_assumed,
    age_note: NEXT_YEAR_JSON.age_note,
    apply_hint: NEXT_YEAR_JSON.apply_hint,
    sources: NEXT_YEAR_JSON.sources,
    curated: NEXT_YEAR_JSON.curated,
    subsidy_month: NEXT_YEAR_JSON.subsidy_month,
  }
}

function buildAltEdgesUngated(o: {
  disabled: boolean
  eligible: boolean
  ageOk: boolean
  incomeOk: boolean
  rank: number | null
}): AltEdge[] {
  const edges: AltEdge[] = []
  if (!o.disabled) {
    // svoucher: 소득·연령 미달 매칭 엣지 전부
    if (!o.incomeOk) edges.push({ to: 'public_program', note: '이용권 소득기준 미달 → 공공체육시설 프로그램(요금 감면은 시군구 조례)', curated: PENDING, program: ALT_PROG.public_program })
    else if (!o.ageOk) edges.push({ to: 'public_program', note: '이용권 지원연령(5~18) 초과 → 공공체육시설 프로그램', curated: PENDING, program: ALT_PROG.public_program })
    if (!o.incomeOk || !o.ageOk) edges.push({ to: 'tteuntteun', note: '만 4세+ 소득무관 포인트 적립', curated: OFFICIAL, program: ALT_PROG.tteuntteun })
    if (!o.incomeOk) edges.push({ to: 'culture_deduction', note: '근로소득자면 헬스장·수영장 30% 소득공제', curated: OFFICIAL, program: ALT_PROG.culture_deduction })
    return edges
  }
  if (!o.eligible && !o.ageOk) {
    // dvoucher 연령 초과 → 어르신 특화 대체경로
    edges.push({ to: 'public_program', note: '장애인 이용권 연령 초과 → 장애인 지원 공공체육시설', curated: PENDING, program: ALT_PROG.public_program })
    edges.push({ to: 'senior_voucher', note: '연령 초과 어르신 → 기초연금 수급 시 어르신 스포츠 상품권', curated: OFFICIAL, program: ALT_PROG.senior_voucher })
    edges.push({ to: 'senior_free_class', note: '65세+ 누구나 → 어르신 무료 스포츠강좌(소득 무관)', curated: OFFICIAL, program: ALT_PROG.senior_free_class })
    return edges
  }
  if (o.eligible && (o.rank === 4 || o.rank === 5 || o.rank == null)) {
    // dvoucher 자격 ✓ 이나 예상 4·5순위/미정 → '지금 바로 되는 것'(공식 확인 대안)
    // 조례 확인 지역(목: 성북·송파·노원)에서만 buildAltEdges 가 '공식 확인(조례 …)'으로 승격한다.
    edges.push({ to: 'public_program', note: '→ 장애인 지원 공공체육시설(요금 감면은 시군구 조례)', curated: PENDING, program: ALT_PROG.public_program })
    edges.push({ to: 'tteuntteun', note: '만 4세+ 소득무관 포인트 적립', curated: OFFICIAL, program: ALT_PROG.tteuntteun })
    edges.push({ to: 'culture_deduction', note: '근로소득자면 헬스장·수영장 이용료 30% 소득공제', curated: OFFICIAL, program: ALT_PROG.culture_deduction })
  }
  return edges
}

function centroid(cd: string) {
  return SIGUNGU.find((s) => s.cd === cd) ?? { lat: 37.5665, lon: 126.978 }
}

function repFee(facilityId: string): number {
  const fees = COURSES.filter((c) => c.facility_id === facilityId).map((c) => c.fee_month)
  if (fees.length === 0) return 100000
  return Math.min(...fees)
}

function repCourse(facilityId: string): string | undefined {
  return COURSES.find((c) => c.facility_id === facilityId)?.name
}

// 사용자 노출용 거리: 실좌표(api)만 km, 근사좌표(구 중심)는 null(거리 미표기).
function exposeDist(f: RawFacility, from: { lat: number; lon: number }): number | null {
  if (f.coord_source !== 'api') return null
  return Math.round(distKm(from, f) * 10) / 10
}

function toVoucher(f: RawFacility, from: { lat: number; lon: number }, subsidy: number): VoucherFacility {
  const fee = repFee(f.id)
  return {
    id: f.id,
    name: f.name,
    sports: f.sports,
    lat: f.lat,
    lon: f.lon,
    coord_source: f.coord_source,
    dist_km: exposeDist(f, from),
    sigungu_nm: f.sigungu_nm,
    fee_month: fee,
    subsidy,
    copay: Math.max(0, fee - subsidy),
    disability_support: f.disability_support,
    source: f.source === 'dvoucher' ? 'dvoucher' : 'voucher',
    addr: f.addr,
    course_name: repCourse(f.id),
  }
}

function toAlt(f: RawFacility, from: { lat: number; lon: number }): AlternativeFacility {
  return {
    id: f.id,
    name: f.name,
    type: f.disability_support ? '공공체육시설(접근성 지원)' : '공공체육시설',
    sports: f.sports,
    lat: f.lat,
    lon: f.lon,
    coord_source: f.coord_source,
    dist_km: exposeDist(f, from),
    sigungu_nm: f.sigungu_nm,
    note: f.disability_support ? '접근성 지원 · 저가/무료 프로그램' : '저가 프로그램',
    disability_support: f.disability_support,
    fee_month: repFee(f.id),
    source: 'public',
    // OV6: 시설 구분 배지. 목 fixtures 의 대안 풀은 전부 공공체육시설이다
    // (신고/등록이 섞인 모습은 페르소나 canned 응답에서 본다).
    faci_gb: '공공',
    addr: f.addr,
  }
}

// 경로 시설 홉 라벨: 근사좌표엔 'nullkm' 대신 이름만.
function facHopLabel(f: { name: string; coord_source?: string; dist_km: number | null }): string {
  return f.coord_source === 'api' && f.dist_km != null ? `${f.name} · ${f.dist_km}km` : f.name
}

export function mockAssess(req: AssessRequest): AssessResponse {
  const from = req.location ?? centroid(req.sigungu_cd)
  const disabled = req.disability.has
  const ageOkVoucher = req.age >= 5 && req.age <= 18
  const incomeOk = INCOME_OK.includes(req.income_class)
  const ageOkDvoucher = req.age >= 5 && req.age <= 69

  const svoucherEligible = !disabled && ageOkVoucher && incomeOk
  const dvoucherEligible = disabled && ageOkDvoucher

  // --- eligibility 카드 ---
  const svoucherReasons = disabled
    ? [{ field: 'route', ok: false, message: '장애인은 장애인스포츠강좌이용권 대상입니다 (중복 지원 불가)' }]
    : [
        { field: 'age', ok: ageOkVoucher, message: ageOkVoucher ? `만 ${req.age}세 · 지원 연령(만 5~18세)에 해당합니다` : `지원 연령(만 5~18세)을 벗어납니다 (${req.age}세)` },
        { field: 'income_class', ok: incomeOk, message: incomeOk ? `${req.income_class} · 소득 지원 대상입니다` : '소득 기준(기초·차상위·한부모)에 해당하지 않습니다' },
      ]

  const dvoucherReasons = !disabled
    ? [{ field: 'disability', ok: false, message: '장애 등록 정보가 없어 장애인 이용권 대상이 아닙니다' }]
    : [
        { field: 'age', ok: ageOkDvoucher, message: ageOkDvoucher ? `만 ${req.age}세 · 장애인 이용권 연령 범위에 해당합니다 (공식 확인 필요)` : `연령 ${req.age}세 · 장애인 이용권 상한(만 69세)을 초과합니다 (공식 확인 필요)` },
        { field: 'disability', ok: true, message: `${req.disability.type ?? '장애'} 등록 · 장애인 이용권 대상입니다` },
      ]

  const eligibility: ProgramEligibility[] = [
    {
      program_id: 'svoucher',
      program_name: '스포츠강좌이용권',
      eligible: svoucherEligible,
      reasons: svoucherReasons,
      benefit: '월 최대 10만 5천원 강좌비 지원 (유청소년 기준)',
      apply: { how: '온라인 신청 → 이용권 카드 발급 → 가맹시설 결제 시 자동 차감', url: 'https://svoucher.kspo.or.kr', docs: ['신분증', '기초·차상위·한부모 증명서'] },
      source: { url: 'https://svoucher.kspo.or.kr', checked: '2026-07-20' },
      verified: true,
    },
    {
      program_id: 'dvoucher',
      program_name: '장애인스포츠강좌이용권',
      eligible: dvoucherEligible,
      reasons: dvoucherReasons,
      benefit: '월 최대 11만원 강좌비 지원 (장애인) · 금액·기준 공식 확인 필요',
      apply: { how: '온라인 신청 → 이용권 발급 → 장애인 가맹시설에서 이용', url: 'https://dvoucher.kspo.or.kr', docs: ['신분증', '장애인등록증', '소득 증빙(해당 시)'] },
      source: { url: 'https://dvoucher.kspo.or.kr', checked: '2026-07-20' },
      verified: false,
    },
    {
      program_id: 'public_program',
      program_name: '공공체육시설 프로그램',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다' }],
      benefit: PUBLIC_BENEFIT,
      apply: { how: '각 구민체육센터·공공체육시설에 직접 등록(전화·방문·홈페이지)', url: 'https://www.seoul.go.kr', docs: ['신분증'] },
      source: { url: 'https://www.seoul.go.kr', checked: '2026-07-20' },
      verified: true,
    },
  ]

  // 예상 선정순위(dvoucher 자격 충족 시) + 복수 대체경로(alt_edges)
  const dvoucherRank = dvoucherEligible ? selectionRank(req.age, selectionCategory(req.income_class)) : null
  if (dvoucherEligible) eligibility[1].selection = buildSelection(req.age, req.income_class)
  const altEdges = buildAltEdges({
    disabled,
    eligible: disabled ? dvoucherEligible : svoucherEligible,
    ageOk: disabled ? ageOkDvoucher : ageOkVoucher,
    incomeOk,
    rank: dvoucherRank,
    age: req.age,
    req,
  })
  // 2027 예산안(국회 심의 전) — svoucher 가 소득 사유 하나로만 ✗ 일 때만. 2026 판정·alt_edges 와 별개.
  if (!disabled && ageOkVoucher && !incomeOk) {
    eligibility[0].next_year = buildNextYear(req.special ?? [])
  }

  // --- 근처 자원 ---
  const inSigungu = FACILITIES.filter((f) => f.sigungu_cd === req.sigungu_cd)
  const publicFacilities = inSigungu.filter((f) => f.source === 'public')
  const dvoucherAll = FACILITIES.filter((f) => f.source === 'dvoucher').sort((a, b) => distKm(from, a) - distKm(from, b))

  // 정렬은 내부 실거리(방향성) 기준 — 노출 dist_km 은 근사좌표면 null 이라 정렬 키로 못 씀.
  const byDist = (a: RawFacility, b: RawFacility) => distKm(from, a) - distKm(from, b)

  let voucherFacilities: VoucherFacility[] = []
  if (svoucherEligible) {
    voucherFacilities = inSigungu
      .filter((f) => f.source === 'voucher')
      .sort(byDist)
      .map((f) => toVoucher(f, from, SVOUCHER_SUBSIDY))
  } else if (dvoucherEligible) {
    // 장애인 가맹시설(가까운 순). 성북엔 없으므로 강북 D01 등 인접 구가 잡힌다(공급공백 신호).
    voucherFacilities = dvoucherAll.slice(0, 3).map((f) => toVoucher(f, from, DVOUCHER_SUBSIDY))
  }

  const wantDisabilitySupport = disabled
  const altSource = wantDisabilitySupport
    ? publicFacilities.filter((f) => f.disability_support).concat(publicFacilities.filter((f) => !f.disability_support))
    : publicFacilities
  const alternatives = [...altSource].sort(byDist).map((f) => toAlt(f, from))

  // --- 경로 ---
  let path: PathEdge[]
  if (svoucherEligible) {
    const top = voucherFacilities[0]
    path = [
      { from: 'person', to: 'svoucher', edge: '자격', result: 'ok', label: '연령·소득 충족' },
      ...(top ? [{ from: 'svoucher', to: `facility:${top.id}`, edge: '적합·접근', result: 'ok' as const, label: facHopLabel(top) }] : []),
    ]
  } else if (dvoucherEligible) {
    const top = voucherFacilities[0]
    path = [
      { from: 'person', to: 'dvoucher', edge: '자격', result: 'ok', label: '장애인 이용권 대상(공식 확인 필요)' },
      ...(top ? [{ from: 'dvoucher', to: `facility:${top.id}`, edge: '적합·접근', result: 'ok' as const, label: facHopLabel(top) }] : []),
    ]
  } else {
    const failed = disabled ? 'dvoucher' : 'svoucher'
    const failLabel = disabled ? '연령 초과' : incomeOk ? '연령 초과' : '소득 미달'
    // 대체 홉 = alt_edges 1순위(서버 OV4). 시설 홉은 장소 기반 대안(public_program)일 때만 —
    // 튼튼머니·소득공제 뒤에 근처 공공시설을 붙이면 '그 시설이 적립·등록 시설'이라는 거짓 연결이다.
    const alt = altEdges[0]
    const top = alternatives[0]
    path = [{ from: 'person', to: failed, edge: '자격', result: 'fail', label: failLabel }]
    if (alt) {
      path.push({ from: failed, to: alt.to, edge: '대체경로', result: 'ok', label: alt.note, curated: alt.curated })
      if (PLACE_BASED.has(alt.to) && top) {
        path.push({ from: alt.to, to: `facility:${top.id}`, edge: '적합·접근', result: 'ok', label: facHopLabel(top) })
      }
    }
  }

  // --- 공급공백 (좌표 정직성 FR-04/FR-05) ---
  const radius = 3
  const countVoucherSource = disabled ? 'dvoucher' : 'voucher'
  // 이용권 시설은 구 중심 폴백 좌표 → "반경" 대신 사용자 시군구 일치("구 단위 가맹 N곳").
  const voucherCount = FACILITIES.filter(
    (f) => f.source === countVoucherSource && f.sigungu_cd === req.sigungu_cd,
  ).length
  // 공공 대안은 실좌표 → 반경 유지(노출 dist_km 기준, 근사=null 은 제외).
  const altInRadius = alternatives.filter((a) => a.dist_km != null && a.dist_km <= radius).length
  // 최근접 이용권 시설: 내부 거리로 선정, 노출은 coord_source 규칙.
  const nearestF = [...FACILITIES.filter((f) => f.source === countVoucherSource)].sort(
    (a, b) => distKm(from, a) - distKm(from, b),
  )[0]
  const nearest = nearestF
    ? {
        name: nearestF.name,
        coord_source: nearestF.coord_source,
        dist_km: nearestF.coord_source === 'api' ? Math.round(distKm(from, nearestF) * 10) / 10 : null,
        sigungu_nm: nearestF.sigungu_nm,
      }
    : null

  // 커버리지: 구 단위 차상위·한부모(N) 수급률 (정직-신호)
  const covRow = COVERAGE_ROWS.find((r) => r.sigungu_cd === req.sigungu_cd && r.class === 'N')
  const coverage = covRow
    ? { sigungu: covRow.sigungu_nm, class: CLASS_LABEL[covRow.class], target: covRow.target, recipient: covRow.recipient, rate: Math.round((covRow.recipient / covRow.target) * 1000) / 1000, year: 2025 }
    : null

  const userSigunguNm = SIGUNGU.find((s) => s.cd === req.sigungu_cd)?.nm ?? req.sigungu_nm ?? '이 지역'
  const label = disabled ? '장애인스포츠강좌이용권' : '스포츠강좌이용권'
  const message =
    voucherCount === 0
      ? `${userSigunguNm}에 ${label} 가맹시설이 없습니다`
      : `${label} · ${userSigunguNm} 가맹 ${voucherCount}곳`

  // 서버 assess 최상위 public_fee 미러 — 이용권 자격과 무관(조례 확인 지역만).
  const publicFee = publicFeeBlock(publicFeeRegion(req.sigungu_cd), {
    age: req.age,
    income_class: req.income_class,
    special: req.special ?? [],
    disability_has: req.disability.has,
  })

  return {
    eligibility,
    path,
    alt_edges: altEdges,
    public_fee: publicFee,
    nearby: {
      voucher_facilities: voucherFacilities,
      alternatives,
      // 1A: 이용권 카드가 적격일 때만 가맹시설이 1순위(⚠#10 — ✗ 사용자에게 가맹 1순위 금지).
      primary: (disabled ? dvoucherEligible : svoucherEligible) ? 'voucher' : 'alternatives',
    },
    supply_gap: {
      radius_km: radius,
      voucher_count: voucherCount,
      voucher_scope: 'sigungu',
      sigungu_nm: userSigunguNm,
      alt_count: altInRadius,
      nearest,
      message,
      coverage,
    },
  }
}

// 체력처방 목은 mocks/fitness.ts 로 이동(공식 경로 형태 재현: 항목 카탈로그·판정·그래프 추천·AI).
