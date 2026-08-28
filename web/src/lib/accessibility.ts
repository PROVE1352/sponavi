// 접근성 표기 규칙 1벌(P-1 정직성). 한 카드가 "✓ 장애인 지원"과 "접근성 정보 없음"을
// 동시에 말하던 모순(C-3)을 데이터 단계에서 끝낸다 — 화면은 이 함수의 결과만 그린다.
//
// 사실은 세 종류이고 서로 다른 것을 뜻한다:
//   ① 가맹 여부(source='dvoucher')            → "장애인 가맹" 배지. 지원 유형과 무관한 별개 사실.
//   ② 지원 불리언(disability_support)         → 원천이 "지원함"이라고만 말한 값. 유형은 모른다.
//   ③ 지원유형·편의시설(FacilityAccessibility) → 웹 공개조회로 확인된 구체 사실.
//
// 규칙:
//   - "✓ 장애인 지원" 확언은 지원유형(③)이 있을 때만 만든다.
//   - ②만 있으면 확언 대신 "장애인 지원(유형 미상)" — "없음"이라고 말하지 않는다.
//   - "접근성 정보 없음"은 유형도 편의시설도 없고 지원 불리언도 참이 아닐 때만.
//   - 조회 실패는 "없음"과 다른 사실이라 따로 말한다.

import type { Amenity, FacilityAccessibility } from '../types_accessibility'

export const SUPPORT_LABEL = '장애인 지원'
export const UNKNOWN_TYPES_LABEL = '장애인 지원(유형 미상)'
export const NO_INFO_TEXT = '접근성 정보 없음'
export const LOAD_FAILED_TEXT = '접근성 정보를 일시적으로 불러오지 못했습니다'

// confirmed = 유형이 확인됨(✓ 아이콘 허용) / unknown-types = 지원 사실만 있음(✓ 금지)
export type SupportBadge =
  | { kind: 'confirmed'; label: string }
  | { kind: 'unknown-types'; label: string }
  | null

export interface AccessibilityView {
  types: string[]
  amenities: Amenity[]
  badge: SupportBadge
  // 카드 하단 한 줄. null 이면 아무 말도 하지 않는다(배지가 이미 사실을 말한 경우).
  note: 'none' | 'error' | null
}

export function accessibilityView(
  support: boolean | null | undefined,
  data?: FacilityAccessibility,
  error?: boolean,
): AccessibilityView {
  const types = data?.types ?? []
  const amenities = data?.amenities ?? []

  // ① 유형이 확인된 경우에만 확언한다. 이때 "정보 없음"은 있을 수 없다.
  if (types.length > 0) {
    return { types, amenities, badge: { kind: 'confirmed', label: SUPPORT_LABEL }, note: null }
  }

  // ② 유형 미상. 지원 불리언이 참이면 그 사실만 말하고, "없음"으로 뒤집지 않는다.
  const badge: SupportBadge =
    support === true ? { kind: 'unknown-types', label: UNKNOWN_TYPES_LABEL } : null

  // ③ 조회 실패는 "없음"이 아니다 — 실패했다고 그대로 말한다(배지와 공존 가능).
  if (error && !data) return { types, amenities, badge, note: 'error' }

  // ④ 편의시설 태그가 있으면 그 자체가 사실이므로 "없음"이라고 하지 않는다.
  if (amenities.length > 0) return { types, amenities, badge, note: null }

  return { types, amenities, badge, note: badge ? null : 'none' }
}
