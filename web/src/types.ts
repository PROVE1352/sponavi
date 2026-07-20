// docs/API.md v1 계약 타입. 서버·웹 공용 형태를 그대로 반영한다.

export type Sex = 'M' | 'F'

// 소득계층 자가선언 (API.md: 기초생활수급 | 차상위 | 한부모 | 그외)
export type IncomeClass = '기초생활수급' | '차상위' | '한부모' | '그외'

export type DisabilityType =
  | '지체'
  | '시각'
  | '청각'
  | '지적'
  | '뇌병변'
  | '기타'

export interface Disability {
  has: boolean
  type: DisabilityType | null
}

export interface LatLon {
  lat: number
  lon: number
}

// ---- POST /api/assess ----

export interface AssessRequest {
  age: number
  sex: Sex
  sigungu_cd: string
  sigungu_nm: string
  income_class: IncomeClass
  disability: Disability
  location?: LatLon | null
}

export interface EligibilityReason {
  field: string
  ok: boolean
  message: string
}

export interface ApplyInfo {
  how: string
  url: string
  docs: string[]
}

export interface SourceRef {
  url: string
  checked: string
}

export interface ProgramEligibility {
  program_id: string
  program_name: string
  eligible: boolean
  reasons: EligibilityReason[]
  benefit: string
  apply: ApplyInfo
  source: SourceRef
  verified: boolean
}

export type EdgeResult = 'ok' | 'fail'

export interface PathEdge {
  from: string
  to: string
  edge: string
  result: EdgeResult
  label: string
  // 대체경로 시드 엣지에는 전문가 큐레이션 플래그가 붙는다(SPEC §0-3).
  curated?: string
}

export interface VoucherFacility {
  id: string
  name: string
  sports: string[]
  lat: number
  lon: number
  dist_km: number
  fee_month: number
  subsidy: number
  copay: number
  disability_support: boolean | null
  // 화면 표기용(가맹 voucher | 장애인 dvoucher). 계약 확장(옵셔널).
  source?: 'voucher' | 'dvoucher'
  addr?: string
  course_name?: string
}

export interface AlternativeFacility {
  id: string
  name: string
  type: string
  sports: string[]
  lat: number
  lon: number
  dist_km: number
  note: string
  disability_support: boolean | null
  fee_month?: number
  addr?: string
  source?: 'public' | 'dvoucher'
}

export interface Nearby {
  voucher_facilities: VoucherFacility[]
  alternatives: AlternativeFacility[]
}

export interface CoverageStat {
  sigungu: string
  class: string
  target: number
  recipient: number
  rate: number
  year: number
}

export interface SupplyGap {
  radius_km: number
  voucher_count: number
  alt_count: number
  nearest: { name: string; dist_km: number } | null
  message: string
  coverage: CoverageStat | null
}

export interface AssessResponse {
  eligibility: ProgramEligibility[]
  path: PathEdge[]
  nearby: Nearby
  supply_gap: SupplyGap
}

// ---- POST /api/fitness ----

export interface FitnessMeasures {
  grip_kg: number | null
  situp_cnt: number | null
  flex_cm: number | null
  shuttle_cnt: number | null
}

export interface FitnessRequest {
  age: number
  sex: Sex
  measures: FitnessMeasures
}

export interface Weakness {
  item: string
  value: number | null
  band: string
  basis: string
}

export interface FitnessRecommendation {
  weakness: string
  exercises: string[]
  sports: string[]
  curated: string
}

export interface FitnessVideo {
  title: string
  url: string
  source: string
}

export interface FitnessResponse {
  weaknesses: Weakness[]
  recommendations: FitnessRecommendation[]
  videos: FitnessVideo[]
  facility_filter_sports: string[]
}

// ---- GET /api/meta/sigungu ----

export interface Sigungu {
  cd: string
  nm: string
  lat: number
  lon: number
}

// ---- GET /api/demo/personas ----
// SPEC §5의 P1~P4를 assess 요청 바디 배열로 반환.
export interface DemoPersona extends AssessRequest {
  id: string
  label: string // 데모 바 버튼용 짧은 설명
  summary: string // 기대 결과 한 줄
}

// ---- 에러 규약 ----
export interface ApiError {
  error: { code: string; message: string }
}
