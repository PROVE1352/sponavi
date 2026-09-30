// GET /api/facilities/search — 시설 이름·주소(동·도로명) 키워드 검색 (docs/API.md).
// types.ts 는 다른 레인이 소유하므로 검색 전용 타입은 여기 둔다.
import type { AlternativeFacility, VoucherFacility } from './types'

export type FacilitySearchProgram = 'svoucher' | 'dvoucher' | 'public'

export interface FacilitySearchParams {
  sigungu_cd: string
  q: string
  program: FacilitySearchProgram
  limit?: number
  // 거리 원점 — 없으면 서버가 시군구 중심을 쓴다(assess 와 같은 폴백).
  lat?: number
  lon?: number
  // 대표 수강료를 그 나이 강좌 중 최저로 고른다(assess 행과 같은 기준).
  age?: number
}

// 이용권 행: assess 와 같은 직렬화기지만 **자격 판정이 없어** subsidy/copay 가 null 이다.
export type SearchVoucherFacility = VoucherFacility & { addr?: string | null }
export type SearchAltFacility = AlternativeFacility & { addr?: string | null }

export interface FacilitySearchResponse {
  sigungu_cd: string
  sigungu_nm: string | null
  scope_codes: string[]
  scope_label: string | null
  program: FacilitySearchProgram
  q: string
  tokens: string[]
  match_fields: string[]
  eligibility_applied: false
  total: number
  truncated: boolean
  facilities: Array<SearchVoucherFacility | SearchAltFacility>
}

// 지도에 얹을 검색 결과 점(실좌표 행만). 근사(구 중심) 행은 지도에 찍지 않는다.
export interface SearchMapPoint {
  id: string
  name: string
  lat: number
  lon: number
  kind: 'voucher' | 'dvoucher' | 'public'
  dist_km: number | null
  detail?: string
}

// 컨텍스트 패널이 목록에 넘기는 검색 범위(현재 결과의 요청에서 온다).
export interface FacilitySearchScope {
  sigungu_cd: string
  sigungu_nm?: string
  // 현재 결과의 주 이용권(비장애=svoucher / 장애=dvoucher)
  voucherProgram: 'svoucher' | 'dvoucher'
  origin?: { lat: number; lon: number } | null
  age?: number
  // 내 시군구가 아닌 곳으로 검색 범위를 덮어쓴 검색("{label} 안에서 찾기")인가.
  // 이때는 거리 원점을 보내지 않고 행의 dist_km 를 null 로 둔다 — 다른 시군구 중심에서 잰 거리를
  // "내 거리"처럼 보이지 않게 한다(P-1).
  override?: boolean
}

// ── GET /api/facilities/in-bounds — "이 지역에서 다시 찾기"(지도 범위 검색, docs/API.md) ──
// 위치가 확인된(좌표 등급 real) 행만 범위 판정에 쓰고, 나머지는 unlocated 로 시군구 전체 수만 싣는다.
export interface AreaBounds {
  min_lat: number
  min_lon: number
  max_lat: number
  max_lon: number
}

export interface FacilityAreaParams extends AreaBounds {
  program: FacilitySearchProgram
  q?: string
  limit?: number
  age?: number
}

export interface UnlocatedArea {
  sigungu_cd: string
  sigungu_nm: string | null
  sido_nm: string | null
  label: string
  display_label: string
  scope_codes: string[]
  count: number
  included_by: Array<'center' | 'evidence'>
}

export interface FacilityAreaResponse {
  bounds: AreaBounds
  center: { lat: number; lon: number }
  diag_km: number
  max_diag_km: number
  program: FacilitySearchProgram
  q: string | null
  tokens: string[]
  match_fields: string[]
  coord_sources: Array<'api' | 'geocoded'>
  coord_rules: Record<string, number | boolean>
  order: 'center_distance'
  eligibility_applied: false
  total: number
  truncated: boolean
  facilities: Array<SearchVoucherFacility | SearchAltFacility>
  unlocated: { total: number; count_basis: 'whole_area'; areas: UnlocatedArea[] }
}

// 범위 결과를 지도에 찍는 점(좌표 등급 real 행만). 종류는 응답의 program 으로 정한다
// (공공 행에는 source 키가 없다).
export interface AreaMapPoint {
  id: string
  name: string
  lat: number
  lon: number
  kind: 'voucher' | 'dvoucher' | 'public'
  detail?: string
}
