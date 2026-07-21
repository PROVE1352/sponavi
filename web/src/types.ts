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

// 예상 선정순위(dvoucher). 신청은 소득무관(자격)·선정은 우선순위제(예산·경쟁)를 구분(FR-02 AC5).
export interface SelectionSource {
  url?: string
  checked?: string
  note?: string
}

export interface Selection {
  // 공식 5단계 예상 순위(1~5). 소득 구분 미정이면 null.
  expected_rank: number | null
  rank_label: string
  note: string
  tiebreak: string | null
  source: SelectionSource | null
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
  // dvoucher 자격 카드에만 부착.
  selection?: Selection
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

// 좌표 출처(FR-04): api=실좌표, centroid=시군구 중심 폴백(위치 근사), geocoded=M2 예약.
export type CoordSource = 'api' | 'centroid' | 'geocoded'

export interface VoucherFacility {
  id: string
  name: string
  sports: string[]
  lat: number
  lon: number
  // 근사좌표(centroid)면 서버가 null → 거리 미표기.
  dist_km: number | null
  coord_source?: CoordSource
  sigungu_nm?: string
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
  dist_km: number | null
  coord_source?: CoordSource
  sigungu_nm?: string
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
  // 이용권 카운트 기준: 'sigungu'=구 단위(실좌표 아님), 'radius'=반경(실좌표 풀).
  voucher_scope?: 'sigungu' | 'radius'
  sigungu_nm?: string | null
  alt_count: number
  // 근사좌표 최근접이면 dist_km=null·sigungu_nm 노출.
  nearest:
    | { name: string; dist_km: number | null; coord_source?: CoordSource; sigungu_nm?: string }
    | null
  message: string
  coverage: CoverageStat | null
}

// 복수 대체경로(FR-02 AC3): 매칭 엣지 전부. UI는 상위 N개 렌더.
export interface AltEdgeProgram {
  id: string
  name: string
  benefit: string | null
  apply_url: string | null
}

export interface AltEdge {
  to: string
  note: string
  // 전문가 큐레이션 상태: "공식 확인(...)" | "검증 대기".
  curated: string
  program: AltEdgeProgram | null
}

export interface AssessResponse {
  eligibility: ProgramEligibility[]
  path: PathEdge[]
  // 매칭 엣지 전부(주 경로는 path 최상위 1개 유지). 구버전 응답 호환 위해 옵셔널.
  alt_edges?: AltEdge[]
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
