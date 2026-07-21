// FR-10 접근성 보조 소스(dvoucher 웹 공개조회) 타입. GET /api/accessibility 계약.
// ★ types.ts(다른 에이전트 소유)를 건드리지 않도록 접근성 타입은 이 파일에 격리한다.
// engine/assess 응답과 무관한 애드온 — 없어도 전 기능 동작(DR-4).

export interface Amenity {
  code: string
  name: string
}

export interface FacilityAccessibility {
  types: string[] // 장애지원유형 이름 목록 (예: ["지체","뇌병변"])
  amenities: Amenity[] // 보유 편의시설
  source: string // "장애인이용권 웹 공개 정보"
  checked: string | null // 확인일 YYYY-MM-DD
}

// id -> 접근성. 데이터 없는 id 는 키 자체가 없음(P-1: 없는 것과 미상을 구분).
export type AccessibilityMap = Record<string, FacilityAccessibility>

// 편의시설 칩 카탈로그. dvoucher 사이트 #cvntlCd 옵션과 동일(코드 05 없음 → 실제 10종).
// FR-10 AC1 "편의시설 11종" 은 코드가 11까지 있음을 뜻하며 실제 선택지는 10개.
export const AMENITY_CATALOG: Amenity[] = [
  { code: '01', name: '장애인 화장실' },
  { code: '02', name: '장애인용 엘리베이터' },
  { code: '03', name: '장애인전용 주차구역' },
  { code: '04', name: '주출입구 단차없음' },
  { code: '06', name: '휠체어 대여' },
  { code: '07', name: '시각장애인 편의서비스' },
  { code: '08', name: '청각장애인 편의서비스' },
  { code: '09', name: '수중리프트' },
  { code: '10', name: '가족 샤워실' },
  { code: '11', name: '장애인 이동차량 지원' },
]

// 블록 하단 고정 출처 문구(FR-10 AC3).
export function accessibilitySourceLine(checked: string | null | undefined): string {
  const date = checked || '—'
  return `장애인스포츠강좌이용권 웹 공개 정보 기준 · 확인일 ${date}`
}
