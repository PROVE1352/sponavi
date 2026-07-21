// 목-모드에서 데모 페르소나가 아닌 임의 위저드 입력도 완전 동작하도록 하는 경량 규칙 엔진.
// 계약(docs/API.md) 형태의 AssessResponse/FitnessResponse 를 fixtures 로부터 합성한다.
// ⚠️ 자격 규칙은 데모 근사다. 최종 진실은 server/rules.json (SPEC §3, §0-5). verified 플래그로 구분.

import type {
  AlternativeFacility,
  AssessRequest,
  AssessResponse,
  FitnessRequest,
  FitnessResponse,
  IncomeClass,
  PathEdge,
  ProgramEligibility,
  VoucherFacility,
} from '../types'
import {
  CLASS_LABEL,
  COURSES,
  COVERAGE_ROWS,
  FACILITIES,
  SIGUNGU,
  VIDEOS,
  distKm,
  type RawFacility,
} from './fixtures'

const SVOUCHER_SUBSIDY = 105000
const DVOUCHER_SUBSIDY = 110000
const INCOME_OK: IncomeClass[] = ['기초생활수급', '차상위', '한부모']

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
      program_name: '공공체육시설 프로그램(무료/저가)',
      eligible: true,
      reasons: [{ field: 'income_class', ok: true, message: '누구나 이용 가능한 공공 프로그램입니다' }],
      benefit: '무료 또는 저가(월 0~4만원대) 프로그램',
      apply: { how: '각 구민체육센터·공공체육시설에 직접 등록(전화·방문·홈페이지)', url: 'https://www.seoul.go.kr', docs: ['신분증'] },
      source: { url: 'https://www.seoul.go.kr', checked: '2026-07-20' },
      verified: true,
    },
  ]

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
    const top = alternatives[0]
    path = [
      { from: 'person', to: failed, edge: '자격', result: 'fail', label: failLabel },
      { from: failed, to: 'public_program', edge: '대체경로', result: 'ok', label: wantDisabilitySupport ? '접근성 지원 공공프로그램' : '무료/저가 공공프로그램', curated: '검증 대기' },
      ...(top ? [{ from: 'public_program', to: `facility:${top.id}`, edge: '적합·접근', result: 'ok' as const, label: facHopLabel(top) }] : []),
    ]
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

  return {
    eligibility,
    path,
    nearby: { voucher_facilities: voucherFacilities, alternatives },
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

// --- 체력처방 (데모 근사 기준) ---
export function mockFitness(req: FitnessRequest): FitnessResponse {
  const m = req.measures
  const weaknesses: FitnessResponse['weaknesses'] = []
  // 데모 근사 임계치. 실제 국민체력100 연령·성별 기준표는 키 주입/자료 확보 후.
  if (m.flex_cm !== null && m.flex_cm < 5) weaknesses.push({ item: '유연성', value: m.flex_cm, band: '하위', basis: '데모 기준(연령·성별 근사)' })
  if (m.shuttle_cnt !== null && m.shuttle_cnt < 40) weaknesses.push({ item: '심폐지구력', value: m.shuttle_cnt, band: '하위', basis: '데모 기준(연령·성별 근사)' })
  if (m.grip_kg !== null && m.grip_kg < 32) weaknesses.push({ item: '근력', value: m.grip_kg, band: '하위', basis: '데모 기준(연령·성별 근사)' })
  if (m.situp_cnt !== null && m.situp_cnt < 30) weaknesses.push({ item: '근지구력', value: m.situp_cnt, band: '하위', basis: '데모 기준(연령·성별 근사)' })
  if (weaknesses.length === 0) weaknesses.push({ item: '유연성', value: m.flex_cm, band: '보통', basis: '데모 기준(연령·성별 근사)' })

  const FMAP: Record<string, { exercises: string[]; sports: string[] }> = {
    유연성: { exercises: ['요가', '스트레칭', '필라테스'], sports: ['요가', '필라테스'] },
    심폐지구력: { exercises: ['걷기', '수영', '자전거'], sports: ['수영', '에어로빅'] },
    근력: { exercises: ['홈트', '웨이트', '밴드운동'], sports: ['헬스'] },
    근지구력: { exercises: ['코어운동', '서킷', '수영'], sports: ['수영', '헬스'] },
  }
  const recommendations = weaknesses.map((w) => ({
    weakness: w.item,
    exercises: FMAP[w.item]?.exercises ?? ['걷기'],
    sports: FMAP[w.item]?.sports ?? ['수영'],
    curated: '체대 검증 대기',
  }))
  const filterSports = Array.from(new Set(recommendations.flatMap((r) => r.sports)))
  const videos = weaknesses
    .map((w) => VIDEOS.find((v) => v.for_weakness === w.item))
    .filter((v): v is (typeof VIDEOS)[number] => Boolean(v))
    .map((v) => ({ title: v.title, url: v.url, source: '국민체력100 동영상(15108846)' }))

  return { weaknesses, recommendations, videos, facility_filter_sports: filterSports }
}
